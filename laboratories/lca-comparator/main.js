/* LCA comparator — comparative, attributional LCA of 1 kg of lettuce delivered to a retailer in Västerås/Stockholm.
   Model (Derive tab, Eqs. A1–A9): inventory per kg harvested × characterisation / emission factors, scaled by
   1/(1 − losses). Indicators: GWP100 (IPCC AR6), cumulative energy demand (primary-energy factors from the 2024
   generation mix), on-site blue water, land occupation. Monte Carlo with triangular distributions; factors shared by
   several systems (grid, heat, truck, packaging, N₂O) are drawn once per run (paired comparison). */
import { Controls, Readouts, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, BarChart, downloadCSV } from '/assets/js/plot.js';
import { withAlpha, colormapCSS } from '/assets/js/colors.js';
import { mulberry32, quantile } from '/assets/js/stats.js';

const $ = s => document.querySelector(s);

/* ================================================================= factors */
// Primary-energy factor of a generation mix: physical-energy-content convention (nuclear η 0.33, renewables 1),
// typical thermal efficiencies (assumptions) and 8 % for grid losses and fuel supply (assumption).
const ETA = { coal: 0.37, gas: 0.50, oil: 0.35, nuclear: 0.33, bio: 0.30, hydro: 1, wind: 1, solar: 1, other: 1 };
const TD = 1.08;
const pefOf = sh => { let s = 0; for (const k in sh) s += sh[k] / 100 / ETA[k]; return TD * 3.6 * s; };
// Life-cycle GHG intensity (kg CO₂e kWh⁻¹) and 2024 generation shares (%) — Ember via Our World in Data (2026 release)
const GRID = {
  se: { label: 'Swedish production mix 2024 (35 g)', short: 'SE mix', ef: 0.0349, sh: { hydro: 37.53, wind: 23.50, solar: 2.42, nuclear: 29.43, bio: 5.91, oil: 1.14, gas: 0.06 } },
  secons: { label: 'Swedish consumption mix, IVL (49 g)', short: 'SE cons.', ef: 0.049, sh: null },
  ppa: { label: 'Renewable PPA, wind (11 g)', short: 'Wind PPA', ef: 0.011, sh: { wind: 100 } },
  eu: { label: 'EU-27 average 2024 (211 g)', short: 'EU-27', ef: 0.2112, sh: { coal: 9.77, gas: 15.58, hydro: 13.33, solar: 11.07, wind: 17.71, oil: 3.21, nuclear: 23.42, other: 0.24, bio: 5.66 } },
  pl: { label: 'Poland 2024, coal-heavy (608 g)', short: 'PL mix', ef: 0.6082, sh: { coal: 54.32, gas: 11.89, hydro: 1.23, solar: 10.26, wind: 15.04, oil: 2.64, bio: 4.62 } },
  coal: { label: 'Coal power only (820 g)', short: 'Coal', ef: 0.820, sh: { coal: 100 } },
  es: { label: 'Spain 2024 (146 g)', short: 'ES mix', ef: 0.1462, sh: { coal: 0.92, gas: 18.63, hydro: 12.25, solar: 20.75, wind: 22.14, oil: 3.71, nuclear: 19.41, other: 0.004, bio: 2.20 } }
};
Object.values(GRID).forEach(g => { g.pef = g.sh ? pefOf(g.sh) : null; });
GRID.secons.pef = GRID.se.pef;
// Heat delivered to the greenhouse (per kWh of heat)
const HEAT = {
  bio: { label: 'Biofuel boiler (wood chips)', short: 'Biofuel', ef: 0.023, ced: 4.45, col: '#f2b94b' },
  dh: { label: 'District heating (Västerås 2025)', short: 'District heat', ef: 0.0449, ced: 2.4, col: '#5cc8ef' },
  gas: { label: 'Natural-gas boiler', short: 'Natural gas', ef: 0.262, ced: 4.4, col: '#ff7a59' }
};
// Transport modes: kg CO₂e per t·km (DESNZ 2025 as quoted in Lesson 15.1); CED from 13 MJ per kg CO₂e of fuel
const MJ_PER_KGCO2E_FUEL = 13.0;
const MODE = {
  truck: { label: 'Refrigerated truck', ef: 0.110, ced: 0.110 * MJ_PER_KGCO2E_FUEL },
  rail: { label: 'Rail freight', ef: 0.028, ced: 0.028 * MJ_PER_KGCO2E_FUEL },
  ship: { label: 'Refrigerated ship', ef: 0.013, ced: 0.013 * MJ_PER_KGCO2E_FUEL },
  air: { label: 'Air freight (with RF)', ef: 0.90, ced: 0.53 * MJ_PER_KGCO2E_FUEL }
};
// Other characterisation / emission factors
const F0 = {
  n2o: 0.010 + 0.11 * 0.010 + 0.24 * 0.011, // kg N₂O–N per kg N: EF1 + FracGASF·EF4 + FracLEACH·EF5 (IPCC 2019 Refinement)
  gwpN2O: 273,       // IPCC AR6 GWP100
  nProd: 4.0,        // kg CO₂e per kg N produced (Lesson 1.3, illustrative)
  nCed: 40,          // MJ per kg N (assumption, gas-based ammonia route)
  diesel: 3.3,       // kg CO₂e per L, well-to-wheel (2.68 combustion + 24 % supply chain)
  dieselCed: 43,     // MJ per L (35.8 MJ LHV + 20 % supply chain)
  pack: 5.0,         // kg CO₂e per kg plastic film, cradle-to-grave with incineration (≈ 1.9 + 3.1)
  packCed: 80,       // MJ per kg polyolefin (incl. feedstock)
  otherCed: 15       // MJ per kg CO₂e for substrate, seeds and infrastructure (assumption)
};

/* ================================================================= systems & inventory */
const SYS = [
  { id: 'es', name: 'Open field, Spain', short: 'Field ES', col: '#f2b94b', kind: 'field' },
  { id: 'sf', name: 'Open field, Sweden', short: 'Field SE', col: '#7ee0a0', kind: 'field' },
  { id: 'gh', name: 'Heated greenhouse, Sweden', short: 'Greenhouse', col: '#5cc8ef', kind: 'gh' },
  { id: 'vf', name: 'Vertical farm, Swedish grid', short: 'VF Sweden', col: '#f07ad0', kind: 'vf' },
  { id: 'vc', name: 'Vertical farm, coal-heavy grid', short: 'VF coal grid', col: '#ff8f6b', kind: 'vf' }
];
const SYSMAP = Object.fromEntries(SYS.map(s => [s.id, s]));
// per kg harvested (losses and transport distance per kg delivered); see the Assumptions & sources tab
const INV0 = {
  es: { Y: 3.9, S: 1, el: 0.3, heat: 0, N: 3.8, diesel: 0.005, other: 0.08, pack: 10, water: 50, dist: 3500, mode: 'truck', loss: 10 },
  sf: { Y: 3.3, S: 1, el: 0.2, heat: 0, N: 3.0, diesel: 0.006, other: 0.08, pack: 10, water: 10, dist: 600, mode: 'truck', loss: 7 },
  gh: { Y: 41, S: 1, el: 3.5, heat: 8, N: 2.5, diesel: 0, other: 0.14, pack: 10, water: 20, dist: 600, mode: 'truck', loss: 5 },
  vf: { Y: 115, S: 5, el: 12, heat: 0, N: 2.2, diesel: 0, other: 0.19, pack: 10, water: 2, dist: 20, mode: 'truck', loss: 3 }
};
const SEASON_GH = { winter: { ghHeat: 8, ghEl: 3.5 }, summer: { ghHeat: 1, ghEl: 0.8 } };
const ROWS = [
  { k: 'Y', label: 'Yield per growing area', unit: 'kg m⁻² yr⁻¹', step: 0.1, min: 0.1 },
  { k: 'S', label: 'Growing layers per m² of land', unit: 'm² m⁻²', step: 0.1, min: 0.1 },
  { k: 'el', label: 'Electricity at the farm', unit: 'kWh kg⁻¹', step: 0.1, min: 0 },
  { k: 'heat', label: 'Heat', unit: 'kWh kg⁻¹', step: 0.1, min: 0 },
  { k: 'N', label: 'Fertiliser nitrogen', unit: 'g N kg⁻¹', step: 0.1, min: 0 },
  { k: 'diesel', label: 'Diesel for field work', unit: 'L kg⁻¹', step: 0.001, min: 0 },
  { k: 'other', label: 'Substrate, seeds, CO₂, buildings', unit: 'kg CO₂e kg⁻¹', step: 0.01, min: 0 },
  { k: 'pack', label: 'Plastic packaging', unit: 'g kg⁻¹', step: 1, min: 0 },
  { k: 'water', label: 'On-site blue water use', unit: 'L kg⁻¹', step: 1, min: 0 },
  { k: 'dist', label: 'Transport distance', unit: 'km', step: 10, min: 0 },
  { k: 'mode', label: 'Transport mode', unit: '', type: 'select' },
  { k: 'loss', label: 'Losses, harvest → retailer', unit: '%', step: 1, min: 0, max: 60 }
];
const LINKED = { 'vf.el': 'vfEl', 'gh.heat': 'ghHeat', 'gh.el': 'ghEl', 'es.dist': 'impDist', 'es.mode': 'impMode' };
const inv = JSON.parse(JSON.stringify(INV0));

const CAT = {
  gwp: { label: 'GWP100', unit: 'kg CO₂e kg⁻¹', long: 'Global warming potential, GWP100 (IPCC AR6)', digits: 2, particle: 'smoke' },
  ced: { label: 'Cumulative energy demand', unit: 'MJ kg⁻¹', long: 'Cumulative energy demand (primary energy)', digits: 1, particle: 'spark' },
  water: { label: 'Blue water use', unit: 'L kg⁻¹', long: 'On-site blue water consumption', digits: 1, particle: 'drop' },
  land: { label: 'Land occupation', unit: 'm²·yr kg⁻¹', long: 'Land occupation (m²·yr)', digits: 3, particle: 'land' }
};
const PARTS = {
  gwp: [['el', 'Electricity', '#5cc8ef'], ['heat', 'Heat', '#ff7a59'], ['fert', 'Fertiliser & field N₂O', '#7ee0a0'], ['field', 'Diesel, field work', '#c9cf6a'], ['other', 'Substrate, seeds, buildings', '#a792f0'], ['pack', 'Packaging', '#f07ad0'], ['tr', 'Transport', '#f2b94b'], ['loss', 'Losses (extra production)', '#8a9c92']],
  water: [['onsite', 'On-site blue water', '#5cc8ef'], ['loss', 'Losses (extra production)', '#8a9c92']],
  land: [['onsite', 'Land occupation', '#7ee0a0'], ['loss', 'Losses (extra production)', '#8a9c92']]
};
PARTS.ced = PARTS.gwp;

/* ================================================================= model */
function gridOf(id, p) { return id === 'es' ? GRID.es : id === 'vc' ? GRID[p.gridC] : GRID[p.gridSE]; }
function invOf(id) { return id === 'vc' ? inv.vf : inv[id]; }
function available(id, p) { return !(id === 'sf' && p.season === 'winter'); }
/** Eq. A1: I_c = (1/(1−ℓ)) Σ a_i CF_i,c for the four indicators. `gx` overrides grid/heat/mode factors (Monte Carlo). */
function compute(id, x, p, fx = F0, gx = null) {
  const g = (gx && gx.grid[id]) || gridOf(id, p);
  const h = (gx && gx.heat) || HEAT[p.heat];
  const m = (gx && gx.mode[x.mode]) || MODE[x.mode];
  const soil = id === 'es' || id === 'sf';
  const K = 1 / (1 - Math.min(0.9, x.loss / 100));
  const nKg = x.N / 1000;
  const fin = o => { let s = 0; for (const k in o) s += o[k]; o.loss = s * (K - 1); o.total = s * K; return o; };
  return {
    gwp: fin({ el: x.el * g.ef, heat: x.heat * h.ef, fert: nKg * (fx.nProd + (soil ? fx.n2o * 44 / 28 * fx.gwpN2O : 0)), field: x.diesel * fx.diesel, other: x.other, pack: x.pack / 1000 * fx.pack, tr: x.dist / 1000 * m.ef }),
    ced: fin({ el: x.el * g.pef, heat: x.heat * h.ced, fert: nKg * fx.nCed, field: x.diesel * fx.dieselCed, other: x.other * fx.otherCed, pack: x.pack / 1000 * fx.packCed, tr: x.dist / 1000 * m.ced }),
    water: fin({ onsite: x.water }),
    land: fin({ onsite: 1 / Math.max(1e-6, x.Y * x.S) })
  };
}
function computeAll(p) { const r = {}; SYS.forEach(s => { r[s.id] = compute(s.id, invOf(s.id), p); }); return r; }
/** Eq. A8: grid intensity at which the Swedish vertical farm equals the imported field lettuce. */
function breakEven(res, p) {
  const x = inv.vf, K = 1 / (1 - x.loss / 100);
  const g0 = res.vf.gwp.total / K - x.el * gridOf('vf', p).ef;
  return x.el > 0 ? (res.es.gwp.total / K - g0) / x.el : NaN;
}

/* ================================================================= Monte Carlo (triangular) */
function triRel(u, lo, hi) { // inverse CDF of a triangular distribution with mode 1 (Eq. A9)
  const c = (1 - lo) / (hi - lo);
  return u < c ? lo + Math.sqrt(u * (hi - lo) * (1 - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - 1));
}
const UINV = { Y: 0.15, S: 0.25, el: 0.25, heat: 0.3, N: 0.2, diesel: 0.3, other: 0.4, pack: 0.3, water: 0.3, dist: 0.1, loss: 0.5 };
function monteCarlo(p, N, spread, seed) {
  const rng = mulberry32(seed);
  const T = (lo, hi) => triRel(rng(), Math.max(0.02, 1 - spread * (1 - lo)), 1 + spread * (hi - 1));
  const sym = u => T(1 - u, 1 + u);
  const ids = SYS.filter(s => available(s.id, p)).map(s => s.id);
  const cats = Object.keys(CAT);
  const S = {}, wins = {};
  cats.forEach(c => { S[c] = {}; wins[c] = {}; ids.forEach(id => { S[c][id] = new Float64Array(N); wins[c][id] = 0; }); });
  const drawInv = x => { const o = { mode: x.mode }; for (const k in UINV) o[k] = x[k] * sym(UINV[k]); o.loss = Math.min(60, o.loss); return o; };
  for (let j = 0; j < N; j++) {
    const fx = Object.assign({}, F0, { n2o: F0.n2o * T(0.3, 2.0), nProd: F0.nProd * sym(0.25), pack: F0.pack * sym(0.3), packCed: F0.packCed * sym(0.2), otherCed: F0.otherCed * sym(0.3) });
    const fSE = T(0.7, 1.5), gSE = GRID[p.gridSE], gC = GRID[p.gridC];
    const se = { ef: gSE.ef * fSE, pef: gSE.pef * sym(0.1) };
    const grid = { es: { ef: GRID.es.ef * T(0.8, 1.25), pef: GRID.es.pef * sym(0.1) }, sf: se, gh: se, vf: se, vc: { ef: gC.ef * T(0.85, 1.15), pef: gC.pef * sym(0.1) } };
    const hb = HEAT[p.heat];
    const heat = { ef: hb.ef * sym(p.heat === 'gas' ? 0.08 : p.heat === 'bio' ? 0.5 : 0.3), ced: hb.ced * sym(0.1) };
    const mode = {}; for (const k in MODE) { const f = sym(0.2); mode[k] = { ef: MODE[k].ef * f, ced: MODE[k].ced * f }; }
    const gx = { grid, heat, mode };
    const vfx = drawInv(inv.vf); // VF Sweden and VF coal grid are the same farm
    const tot = {};
    ids.forEach(id => { const x = id === 'vf' || id === 'vc' ? vfx : drawInv(inv[id]); tot[id] = compute(id, x, p, fx, gx); });
    cats.forEach(c => {
      let best = null, bv = Infinity;
      ids.forEach(id => { const v = tot[id][c].total; S[c][id][j] = v; if (v < bv) { bv = v; best = id; } });
      wins[c][best]++;
    });
  }
  const stats = {};
  cats.forEach(c => { stats[c] = {}; ids.forEach(id => { const a = Array.from(S[c][id]); stats[c][id] = { p: wins[c][id] / N, med: quantile(a, 0.5), lo: quantile(a, 0.05), hi: quantile(a, 0.95) }; }); });
  return { ids, S, stats, N };
}
function kdeLog(samples, xs) { // Gaussian KDE on log10 values (Silverman bandwidth); density per log10 unit
  const n = samples.length; const L = new Float64Array(n); let m = 0;
  for (let i = 0; i < n; i++) { L[i] = Math.log10(Math.max(1e-9, samples[i])); m += L[i]; } m /= n;
  let v = 0; for (let i = 0; i < n; i++) v += (L[i] - m) ** 2; const sd = Math.sqrt(v / (n - 1)) || 0.05;
  const h = 1.06 * sd * Math.pow(n, -0.2); const step = Math.max(1, Math.floor(n / 1500));
  return xs.map(x => { const lx = Math.log10(x); let s = 0, cnt = 0; for (let i = 0; i < n; i += step) { const z = (lx - L[i]) / h; s += Math.exp(-0.5 * z * z); cnt++; } return s / (cnt * h * Math.sqrt(2 * Math.PI)); });
}

/* ================================================================= UI */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
SYS.forEach(s => ro.add({ id: s.id, label: s.name, unit: 'kg CO₂e kg⁻¹', digits: 2 }));
ro.add({ id: 'best', label: 'Lowest in this indicator', unit: '', format: v => v })
  .add({ id: 'be', label: 'Break-even grid intensity EF*', unit: 'g CO₂e kWh⁻¹', digits: 0 })
  .add({ id: 'pwin', label: 'Monte Carlo: P(lowest)', unit: '%', digits: 0 });

ui.section('Indicator & season');
ui.segmented({ id: 'cat', label: 'Impact indicator', options: [{ value: 'gwp', label: 'GWP' }, { value: 'ced', label: 'Energy' }, { value: 'water', label: 'Water' }, { value: 'land', label: 'Land' }], value: 'gwp', help: 'GWP100 (IPCC AR6) · cumulative primary energy · on-site blue water · land occupation' });
ui.segmented({ id: 'season', label: 'Month of supply', options: [{ value: 'winter', label: 'January' }, { value: 'summer', label: 'July' }], value: 'winter', help: 'Swedish field lettuce is only available June–October; greenhouse heat and light follow the season.', onChange: v => ui.setMany({ ghHeat: SEASON_GH[v].ghHeat, ghEl: SEASON_GH[v].ghEl }) });
ui.section('Energy supply');
ui.select({ id: 'gridSE', label: 'Grid for Swedish farms', options: ['se', 'secons', 'ppa', 'eu'].map(k => ({ value: k, label: GRID[k].label })), value: 'se' });
ui.select({ id: 'gridC', label: 'Coal-heavy grid (counterfactual farm)', options: ['pl', 'coal'].map(k => ({ value: k, label: GRID[k].label })), value: 'pl' });
ui.segmented({ id: 'heat', label: 'Greenhouse heat source', options: [{ value: 'bio', label: 'Biofuel' }, { value: 'dh', label: 'District heat' }, { value: 'gas', label: 'Natural gas' }], value: 'gas', help: 'Per kWh of heat: wood chips 0.023 · Västerås district heating 0.045 · gas boiler 0.262 kg CO₂e' });
ui.section('Key inventory values');
ui.slider({ id: 'vfEl', label: 'Vertical-farm electricity', min: 4, max: 20, step: 0.5, value: 12, unit: 'kWh kg⁻¹', help: 'Reviews: 8–12.5 (Pennisi et al. 2025); ≈ 15 (Casey et al. 2022)' });
ui.slider({ id: 'ghHeat', label: 'Greenhouse heat demand', min: 0, max: 25, step: 0.5, value: 8, unit: 'kWh kg⁻¹', help: 'January teaching value 8; Swedish annual mean ≈ 250 kWh m⁻² yr⁻¹' });
ui.slider({ id: 'ghEl', label: 'Greenhouse electricity (lights, fans)', min: 0, max: 8, step: 0.1, value: 3.5, unit: 'kWh kg⁻¹' });
ui.slider({ id: 'impDist', label: 'Import distance, Spain → Mälardalen', min: 500, max: 5000, step: 50, value: 3500, unit: 'km', help: 'Road ≈ 3,400–3,500 km; great-circle Almería–Västerås ≈ 2,870 km' });
ui.segmented({ id: 'impMode', label: 'Import transport mode', options: Object.keys(MODE).map(k => ({ value: k, label: MODE[k].label.split(' (')[0].replace('Refrigerated ', '').replace(' freight', '') })), value: 'truck' });
ui.section('Uncertainty');
ui.slider({ id: 'mcN', label: 'Monte Carlo runs N', min: 500, max: 10000, step: 500, value: 3000, digits: 0 });
ui.slider({ id: 'spread', label: 'Uncertainty width (× default ranges)', min: 0.25, max: 2, step: 0.05, value: 1, digits: 2, help: 'Scales every triangular range; 1 = the ranges listed in the Assumptions tab.' });
ui.button({ label: 'Run Monte Carlo again (new seed)', onClick: () => { seed = (seed * 1664525 + 1013904223) >>> 0; runMC(); } });
ui.presets([
  { label: 'January (lesson defaults)', values: { season: 'winter', gridSE: 'se', heat: 'gas', vfEl: 12, impDist: 3500, impMode: 'truck', cat: 'gwp' } },
  { label: 'July: Swedish season', values: { season: 'summer', gridSE: 'se', heat: 'bio', vfEl: 12, impDist: 3500, impMode: 'truck', cat: 'gwp' } },
  { label: 'Best-case vertical farm', values: { season: 'winter', gridSE: 'ppa', vfEl: 8, cat: 'gwp' } },
  { label: 'Renewable greenhouse', values: { season: 'winter', heat: 'bio', gridSE: 'se', cat: 'gwp' } },
  { label: 'Air-freighted import', values: { season: 'winter', impMode: 'air', impDist: 3000, cat: 'gwp' } },
  { label: 'Water and land view', values: { season: 'winter', cat: 'water' } }
]);
ui.saveButton('lca-comparator', () => Object.assign({}, ro.values(), { inventory: JSON.stringify(inv) }));

/* ================================================================= inventory table */
const tbl = $('#inv-table');
function renderTable() {
  const head = `<thead><tr><th>Inventory item (per kg harvested)</th><th>Unit</th>${SYS.map(s => `<th class="num" style="--sc:${s.col}"><span class="sys-dot"></span>${s.short}</th>`).join('')}</tr></thead>`;
  const body = ROWS.map(r => `<tr><td>${r.label}</td><td class="u">${r.unit}</td>${SYS.map(s => {
    if (s.id === 'vc') return `<td class="num same" data-k="${r.k}" data-s="vc" title="Same farm as ‘VF Sweden’: edit that column">${r.type === 'select' ? MODE[inv.vf.mode].label.split(' (')[0] : fmtCell(inv.vf[r.k])}</td>`;
    if (r.type === 'select') return `<td class="num"><select data-k="${r.k}" data-s="${s.id}" aria-label="${r.label}, ${s.short}">${Object.keys(MODE).map(k => `<option value="${k}"${inv[s.id].mode === k ? ' selected' : ''}>${MODE[k].label}</option>`).join('')}</select></td>`;
    return `<td class="num"><input type="number" data-k="${r.k}" data-s="${s.id}" value="${inv[s.id][r.k]}" step="${r.step}" min="${r.min}"${r.max != null ? ` max="${r.max}"` : ''} aria-label="${r.label}, ${s.short}"></td>`;
  }).join('')}</tr>`).join('');
  const foot = `<tfoot><tr><td colspan="2" id="inv-res-lab">Result</td>${SYS.map(s => `<td class="num" data-res="${s.id}">—</td>`).join('')}</tr></tfoot>`;
  tbl.innerHTML = head + `<tbody>${body}</tbody>` + foot;
}
function fmtCell(v) { return typeof v === 'number' ? (+v.toPrecision(4)).toLocaleString('en-GB') : v; }
function syncTable(res, p) {
  tbl.querySelectorAll('input[data-k],select[data-k]').forEach(el => {
    const v = inv[el.dataset.s][el.dataset.k];
    if (document.activeElement !== el && String(el.value) !== String(v)) el.value = v;
    const d = INV0[el.dataset.s][el.dataset.k]; el.classList.toggle('edited', v !== d && !LINKED[el.dataset.s + '.' + el.dataset.k]);
  });
  tbl.querySelectorAll('td.same').forEach(td => { const k = td.dataset.k; td.textContent = k === 'mode' ? MODE[inv.vf.mode].label.split(' (')[0] : fmtCell(inv.vf[k]); });
  const c = CAT[p.cat];
  $('#inv-res-lab').textContent = `${c.label} per kg delivered (${c.unit})`;
  SYS.forEach(s => { const td = tbl.querySelector(`[data-res="${s.id}"]`); td.textContent = available(s.id, p) ? fmt(res[s.id][p.cat].total, c.digits) : 'not in season'; });
}
tbl.addEventListener('change', e => {
  const el = e.target.closest('[data-k]'); if (!el || !el.dataset.s) return;
  const s = el.dataset.s, k = el.dataset.k;
  let v = el.tagName === 'SELECT' ? el.value : +el.value;
  if (el.tagName !== 'SELECT') { if (!isFinite(v)) return; const r = ROWS.find(q => q.k === k); v = Math.max(r.min ?? -Infinity, Math.min(r.max ?? Infinity, v)); }
  const link = LINKED[s + '.' + k];
  if (link) { ui.set(link, v); return; }
  inv[s][k] = v; saveHash(); schedule();
});
$('#inv-reset').addEventListener('click', () => {
  Object.keys(INV0).forEach(s => Object.assign(inv[s], JSON.parse(JSON.stringify(INV0[s]))));
  ui.setMany({ vfEl: INV0.vf.el, ghHeat: SEASON_GH[ui.get('season')].ghHeat, ghEl: SEASON_GH[ui.get('season')].ghEl, impDist: INV0.es.dist, impMode: 'truck' });
  saveHash(); schedule(); window.FFP && FFP.toast && FFP.toast('Inventory reset to the literature defaults');
});
$('#inv-csv').addEventListener('click', () => {
  const p = ui.values(), res = computeAll(p);
  const rows = ROWS.map(r => [r.label, r.unit, ...SYS.map(s => invOf(s.id)[r.k])]);
  Object.keys(CAT).forEach(c => rows.push([CAT[c].label + ' per kg delivered', CAT[c].unit, ...SYS.map(s => available(s.id, p) ? +res[s.id][c].total.toPrecision(4) : 'n/a')]));
  downloadCSV('lca-comparator-lettuce.csv', ['item', 'unit', ...SYS.map(s => s.name)], rows);
});
// edited inventory cells persist in the URL hash (the query string belongs to the Controls)
function saveHash() {
  const d = {}; Object.keys(INV0).forEach(s => ROWS.forEach(r => { if (LINKED[s + '.' + r.k]) return; if (inv[s][r.k] !== INV0[s][r.k]) (d[s] = d[s] || {})[r.k] = inv[s][r.k]; }));
  const h = Object.keys(d).length ? '#inv=' + encodeURIComponent(JSON.stringify(d)) : '';
  history.replaceState(null, '', location.pathname + location.search + h);
}
function loadHash() {
  const m = location.hash.match(/inv=([^&]+)/); if (!m) return;
  try { const d = JSON.parse(decodeURIComponent(m[1])); Object.keys(d).forEach(s => { if (inv[s]) Object.keys(d[s]).forEach(k => { if (k in inv[s]) inv[s][k] = d[s][k]; }); }); } catch (e) { /* ignore malformed hash */ }
}
loadHash();
renderTable();

/* ================================================================= charts */
const chContrib = new BarChart('#ch-contrib', { horizontal: true, stacked: true, y: { label: 'GWP100', unit: 'kg CO₂e kg⁻¹', min: 0 }, height: 290 });
const chBreak = new Plot('#ch-break', { x: { label: 'Grid emission factor', unit: 'g CO₂e kWh⁻¹', min: 0, max: 850 }, y: { label: 'GWP100 per kg delivered', unit: 'kg CO₂e kg⁻¹', min: 0.1, max: 20, log: true }, height: 290 });
const chWin = new BarChart('#ch-win', { y: { label: 'Probability of being lowest', unit: '%', min: 0, max: 100 }, height: 270, legend: false });
const chDist = new Plot('#ch-dist', { x: { label: 'GWP100 per kg delivered (log scale)', unit: 'kg CO₂e kg⁻¹', log: true }, y: { label: 'Density', unit: 'per log₁₀ unit', min: 0 }, height: 270 });
const CATN = ['GWP', 'Energy', 'Water', 'Land'];
const chTrade = new Plot('#ch-trade', { x: { label: 'Impact indicator', min: -0.35, max: 3.35, format: v => Math.abs(v - Math.round(v)) < 1e-6 ? (CATN[Math.round(v)] || '') : '' }, y: { label: 'Relative to imported field lettuce (= 1)', unit: 'log scale', log: true, min: 0.001, max: 100 }, height: 300, crosshair: false });

/* ================================================================= stage (animated supply chain) */
const stageEl = $('#stage');
const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Animated supply chains of lettuce from five production systems to a retailer, with impact particles scaled to each process contribution');
stageEl.appendChild(cv);
const ctx = cv.getContext('2d');
const hud = hudChips(stageEl);
const tip = document.createElement('div'); tip.className = 'lca-tip'; stageEl.appendChild(tip);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'lca-supply-chains.png'; a.click(); } });
let W = 0, H = 0, DPR = 1;
function resize() { DPR = Math.min(window.devicePixelRatio || 1, 2); W = stageEl.clientWidth; H = stageEl.clientHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
new ResizeObserver(resize).observe(stageEl); resize();
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let visible = true; new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(stageEl);

let cur = null;        // latest deterministic results + scenario
let hoverLane = -1;
const particles = [];  // impact particles
const tokens = SYS.map(() => []); // lettuce crates on each lane
const spawnAcc = SYS.map(() => ({ tok: Math.random(), imp: {} }));

function geom() {
  const top = 76, bot = H - 26, lh = (bot - top) / SYS.length;
  const X = { farm: 14, icon: 18, name: 84, cult: W * 0.335, pack: W * 0.47, trA: W * 0.505, trB: W * 0.775, badge: W * 0.805, shop: W * 0.9 };
  return { top, bot, lh, X, y: i => top + (i + 0.5) * lh };
}
function gridColor(ef) { const t = Math.max(0, Math.min(1, Math.log10(Math.max(ef, 0.005) / 0.005) / Math.log10(1 / 0.005))); return colormapCSS('rdylgn', 1 - t); }
function nodeList(id, r, cat) { // contribution groups drawn as nodes for one lane
  const c = r[cat];
  if (cat === 'water' || cat === 'land') return { cult: c.onsite, energy: 0, heat: 0, pack: 0, tr: 0, loss: c.loss };
  return { cult: c.fert + c.field + c.other, energy: c.el, heat: c.heat, pack: c.pack, tr: c.tr, loss: c.loss };
}

function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function drawIcon(kind, id, x, y, s, p, t) { // icon box of size ~ 56×44 scaled by s, top-left (x,y)
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  if (kind === 'field') {
    const sky = id === 'es' ? ['#284b63', '#3a6f8f'] : ['#2c4a5a', '#4f6f7f'];
    const g = ctx.createLinearGradient(0, 0, 0, 44); g.addColorStop(0, sky[0]); g.addColorStop(1, sky[1]);
    rr(0, 0, 56, 44, 7); ctx.fillStyle = g; ctx.fill();
    ctx.save(); rr(0, 0, 56, 44, 7); ctx.clip();
    if (id === 'es') { ctx.fillStyle = '#ffd35a'; ctx.beginPath(); ctx.arc(44, 11, 6, 0, 7); ctx.fill(); ctx.strokeStyle = 'rgba(255,211,90,.7)'; ctx.lineWidth = 1.2; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + t * 0.4; ctx.beginPath(); ctx.moveTo(44 + 8 * Math.cos(a), 11 + 8 * Math.sin(a)); ctx.lineTo(44 + 11 * Math.cos(a), 11 + 11 * Math.sin(a)); ctx.stroke(); } }
    else { ctx.fillStyle = '#dfe8ec'; [[38, 12, 6], [45, 10, 7], [51, 13, 5]].forEach(([cx, cy, r]) => { ctx.beginPath(); ctx.arc(cx + Math.sin(t * 0.3) * 1.5, cy, r, 0, 7); ctx.fill(); }); ctx.fillStyle = '#ffd35a'; ctx.beginPath(); ctx.arc(14, 10, 4, 0, 7); ctx.fill(); }
    ctx.fillStyle = id === 'es' ? '#8a5a32' : '#5a4630'; ctx.beginPath(); ctx.moveTo(0, 26); ctx.lineTo(56, 22); ctx.lineTo(56, 44); ctx.lineTo(0, 44); ctx.fill();
    for (let row = 0; row < 3; row++) for (let k = 0; k < 7; k++) { const px = 4 + k * 7.6 + row * 1.5, py = 29 + row * 5.2 - k * 0.3; ctx.fillStyle = row % 2 ? '#7ee0a0' : '#4fbf78'; ctx.beginPath(); ctx.arc(px, py, 2.6 + row * 0.35, 0, 7); ctx.fill(); }
    ctx.restore();
  } else if (kind === 'gh') {
    rr(0, 0, 56, 44, 7); ctx.fillStyle = '#12252d'; ctx.fill();
    ctx.fillStyle = 'rgba(92,200,239,.18)'; ctx.strokeStyle = 'rgba(160,220,245,.85)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(6, 38); ctx.lineTo(6, 20); for (let k = 0; k < 3; k++) { ctx.lineTo(6 + k * 12 + 6, 12); ctx.lineTo(6 + (k + 1) * 12, 20); } ctx.lineTo(42, 38); ctx.closePath(); ctx.fill(); ctx.stroke();
    for (let k = 0; k < 5; k++) { ctx.fillStyle = '#6fd39a'; ctx.beginPath(); ctx.arc(10 + k * 7, 35, 2.8, 0, 7); ctx.fill(); }
    const h = HEAT[p.heat];
    if (p.heat === 'dh') { ctx.strokeStyle = h.col; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(56, 30); ctx.lineTo(44, 30); ctx.lineTo(42, 34); ctx.stroke(); ctx.fillStyle = h.col; ctx.font = '600 7px Inter, sans-serif'; ctx.fillText('DH', 46, 26); }
    else { ctx.fillStyle = '#39454a'; ctx.fillRect(46, 14, 6, 24); const puff = p.heat === 'gas' ? 'rgba(200,205,210,' : 'rgba(210,180,140,'; for (let k = 0; k < 3; k++) { const ph = (t * 0.5 + k / 3) % 1; ctx.fillStyle = puff + (0.55 * (1 - ph)) + ')'; ctx.beginPath(); ctx.arc(49 + ph * 4, 12 - ph * 12, 2 + ph * 3, 0, 7); ctx.fill(); } ctx.fillStyle = h.col; ctx.beginPath(); ctx.moveTo(47, 38); ctx.quadraticCurveTo(49, 33 + Math.sin(t * 6) * 1, 51, 38); ctx.fill(); }
  } else { // vertical farm (with coal plant for the counterfactual)
    rr(0, 0, 56, 44, 7); ctx.fillStyle = '#1a1622'; ctx.fill();
    ctx.fillStyle = '#2d2838'; ctx.fillRect(6, 6, 30, 34); ctx.strokeStyle = '#4c455e'; ctx.lineWidth = 1; ctx.strokeRect(6, 6, 30, 34);
    for (let k = 0; k < 4; k++) { const yy = 10 + k * 8; ctx.fillStyle = `rgba(240,122,208,${0.75 + 0.2 * Math.sin(t * 2 + k)})`; ctx.fillRect(8, yy, 26, 1.6); for (let q = 0; q < 6; q++) { ctx.fillStyle = '#6fd39a'; ctx.beginPath(); ctx.arc(10 + q * 4.4, yy + 4.6, 1.6, 0, 7); ctx.fill(); } }
    if (id === 'vc') { ctx.fillStyle = '#5d5a55'; ctx.beginPath(); ctx.moveTo(40, 40); ctx.lineTo(42, 22); ctx.lineTo(50, 22); ctx.lineTo(52, 40); ctx.fill(); ctx.fillStyle = '#3c3a37'; ctx.fillRect(50, 12, 3, 28); for (let k = 0; k < 3; k++) { const ph = (t * 0.4 + k / 3) % 1; ctx.fillStyle = `rgba(90,85,80,${0.7 * (1 - ph)})`; ctx.beginPath(); ctx.arc(51.5 + ph * 3, 10 - ph * 10, 2 + ph * 3.5, 0, 7); ctx.fill(); } }
    else { ctx.strokeStyle = '#9fb2a8'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(46, 40); ctx.lineTo(49, 14); ctx.lineTo(52, 40); ctx.moveTo(45, 22); ctx.lineTo(53, 22); ctx.moveTo(44, 28); ctx.lineTo(54, 28); ctx.stroke(); }
  }
  ctx.restore();
}
function drawVehicle(mode, x, y, t) {
  ctx.save(); ctx.translate(x, y);
  if (mode === 'air') { ctx.rotate(-0.08); ctx.fillStyle = '#e6eee9'; ctx.beginPath(); ctx.ellipse(0, 0, 12, 2.6, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(-7, -8); ctx.lineTo(-4, -8); ctx.lineTo(3, 0); ctx.lineTo(-4, 8); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-13, -5); ctx.lineTo(-11, -5); ctx.lineTo(-8, 0); ctx.fill(); }
  else if (mode === 'ship') { ctx.fillStyle = '#c9d6dd'; ctx.beginPath(); ctx.moveTo(-14, -1); ctx.lineTo(14, -1); ctx.lineTo(10, 5); ctx.lineTo(-11, 5); ctx.closePath(); ctx.fill(); ['#f2b94b', '#5cc8ef', '#f07ad0'].forEach((c, k) => { ctx.fillStyle = c; ctx.fillRect(-9 + k * 6, -6, 5, 5); }); ctx.fillStyle = '#e6eee9'; ctx.fillRect(8, -8, 3, 7); }
  else if (mode === 'rail') { ctx.fillStyle = '#9fb2a8'; ctx.fillRect(-16, -5, 12, 8); ctx.fillStyle = '#5cc8ef'; ctx.fillRect(-2, -6, 16, 9); ctx.fillStyle = '#e6eee9'; ctx.fillRect(9, -4, 4, 3); ctx.fillStyle = '#20302a'; [-13, -7, 1, 10].forEach(w => { ctx.beginPath(); ctx.arc(w, 4, 2, 0, 7); ctx.fill(); }); }
  else { ctx.fillStyle = '#e6eee9'; ctx.fillRect(-14, -7, 18, 10); ctx.fillStyle = '#5cc8ef'; ctx.fillRect(4, -4, 7, 7); ctx.fillStyle = '#9be7ff'; ctx.fillRect(7, -3, 3, 3); ctx.fillStyle = '#20302a'; [-9, 0, 8].forEach(w => { ctx.beginPath(); ctx.arc(w, 4, 2.2, 0, 7); ctx.fill(); }); ctx.fillStyle = 'rgba(126,224,160,.9)'; ctx.fillRect(-12, -5, 4, 2); }
  ctx.restore();
}
function drawShop(x, y, w, h) {
  const g = ctx.createLinearGradient(x, y, x + w, y); g.addColorStop(0, '#1d2b26'); g.addColorStop(1, '#16221e');
  rr(x, y, w, h, 12); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = 'rgba(126,224,160,.35)'; ctx.lineWidth = 1.2; ctx.stroke();
  const aw = 16; for (let k = 0; k < 6; k++) { ctx.fillStyle = k % 2 ? '#e6eee9' : '#1d7a4a'; ctx.fillRect(x + 6 + k * (w - 12) / 6, y + 8, (w - 12) / 6, aw); }
  ctx.fillStyle = '#e6eee9'; ctx.font = '700 12px Inter, sans-serif'; ctx.textAlign = 'center';
  ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('Retailer · Västerås / Stockholm', 0, 4); ctx.restore();
  ctx.textAlign = 'left';
}

let lastT = performance.now(), tSec = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!visible || document.hidden || !cur || !W) { lastT = now; return; }
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now; tSec += reduceMotion ? 0 : dt;
  draw(dt);
}
function draw(dt) {
  const { res, p } = cur; const cat = p.cat; const G = geom(); const X = G.X;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const bg = ctx.createRadialGradient(W * 0.45, H * 0.4, 20, W * 0.5, H * 0.5, Math.max(W, H) * 0.8); bg.addColorStop(0, '#14231d'); bg.addColorStop(1, '#070c0a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // column headers
  ctx.font = '600 10.5px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(185,200,192,.8)'; ctx.textAlign = 'center';
  [['CULTIVATION', X.cult], ['PACKING', X.pack], ['TRANSPORT TO RETAILER', (X.trA + X.trB) / 2], ['TOTAL', X.badge + 18]].forEach(([s, x]) => ctx.fillText(s, x, G.top - 10));
  ctx.textAlign = 'left';
  ctx.font = '500 10px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(185,200,192,.75)';
  ctx.fillText(cat === 'water' ? 'Droplets ∝ on-site blue water · node area ∝ contribution · totals per kg delivered' : cat === 'land' ? 'Square area ∝ land occupation per kg · totals per kg delivered' : (cat === 'gwp' ? 'Puffs' : 'Sparks') + ' ∝ contribution · ⚡ line width ∝ kWh per kg, colour = grid intensity (green → red) · ♨ heat', 14, H - 9);
  // max contribution for node scaling (across lanes, current indicator)
  let maxC = 1e-9, maxTot = 1e-9; const nodes = {};
  SYS.forEach(s => { if (!available(s.id, p)) return; const n = nodeList(s.id, res[s.id], cat); nodes[s.id] = n; for (const k in n) maxC = Math.max(maxC, n[k]); maxTot = Math.max(maxTot, res[s.id][cat].total); });
  const ranks = SYS.filter(s => available(s.id, p)).map(s => s.id).sort((a, b) => res[a][cat].total - res[b][cat].total);
  drawShop(X.shop, G.top - 4, W - X.shop - 10, G.bot - G.top + 2);
  SYS.forEach((s, i) => {
    const y = G.y(i), avail = available(s.id, p), x = invOf(s.id);
    ctx.globalAlpha = avail ? 1 : 0.22;
    // lane background
    rr(8, y - G.lh / 2 + 3, X.shop - 16, G.lh - 6, 10); ctx.fillStyle = hoverLane === i ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.025)'; ctx.fill();
    ctx.strokeStyle = withAlpha(s.col, hoverLane === i ? 0.6 : 0.22); ctx.lineWidth = 1; ctx.stroke();
    // farm icon + name
    const isz = Math.min(1.15, (G.lh - 14) / 44);
    drawIcon(s.kind, s.id, X.icon, y - 22 * isz, isz, p, tSec);
    ctx.fillStyle = '#e6eee9'; ctx.font = '650 12px Inter, sans-serif'; ctx.fillText(s.short, X.icon + 60 * isz + 4, y - 8);
    ctx.font = '500 10px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(185,200,192,.85)';
    const sub1 = s.id === 'es' ? 'Almería / Murcia' : s.id === 'sf' ? 'Skåne, summer' : s.id === 'gh' ? `${HEAT[p.heat].short.replace('Natural gas', 'Gas')} heat` : s.id === 'vf' ? `grid: ${GRID[p.gridSE].short}` : `grid: ${GRID[p.gridC].short}`;
    const sub2 = s.id === 'es' || s.id === 'sf' ? `${fmt(x.Y, 1)} kg m⁻² yr⁻¹` : `${fmt(x.Y * x.S, 0)} kg per m² land`;
    ctx.fillText(sub1, X.icon + 60 * isz + 4, y + 6); ctx.fillText(sub2, X.icon + 60 * isz + 4, y + 19);
    if (!avail) { ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(230,238,233,.85)'; ctx.font = '600 12px Inter, sans-serif'; ctx.fillText('Not in season in January — Swedish field lettuce is harvested June–October', X.cult - 40, y + 4); return; }
    const n = nodes[s.id];
    const R = v => 5 + 17 * Math.sqrt(Math.max(0, v) / maxC);
    // flow line farm → shop
    ctx.strokeStyle = withAlpha(s.col, 0.35); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X.cult - 52, y); ctx.lineTo(X.trA, y); ctx.stroke();
    // transport line
    const m = x.mode;
    ctx.setLineDash(m === 'air' ? [2, 5] : m === 'ship' ? [8, 4] : m === 'rail' ? [10, 3] : []);
    ctx.strokeStyle = withAlpha('#f2b94b', 0.55); ctx.lineWidth = 1.5 + 5 * Math.sqrt(n.tr / maxC); ctx.beginPath(); ctx.moveTo(X.trA, y); ctx.lineTo(X.trB, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(242,185,75,.9)'; ctx.font = '500 10px JetBrains Mono, monospace'; ctx.textAlign = 'center';
    ctx.fillText(`${fmt(x.dist, 0)} km · ${MODE[m].label.split(' (')[0].replace('Refrigerated ', 'reefer ').toLowerCase()}`, (X.trA + X.trB) / 2, y - 12);
    ctx.textAlign = 'left';
    const L = Math.max(1, x.dist); const period = 2.2 + 3.2 * Math.log10(L) / 3.7; const ph = (tSec / period + i * 0.23) % 1;
    drawVehicle(m, X.trA + 16 + ph * (X.trB - X.trA - 32), y + (m === 'air' ? -7 - 5 * Math.sin(ph * Math.PI) : 0), tSec);
    // energy inputs above the cultivation node
    const ey = y - G.lh * 0.36;
    if (x.el > 0 && (cat === 'gwp' || cat === 'ced')) {
      const g = gridOf(s.id, p); ctx.strokeStyle = gridColor(g.ef); ctx.lineWidth = 1 + 5 * Math.sqrt(x.el / 20);
      ctx.beginPath(); ctx.moveTo(X.cult - 44, ey); ctx.quadraticCurveTo(X.cult - 20, ey, X.cult - R(n.cult) * 0.7, y - R(n.cult) * 0.6); ctx.stroke();
      ctx.fillStyle = gridColor(g.ef); ctx.font = '700 11px Inter, sans-serif'; ctx.fillText('⚡', X.cult - 58, ey + 4);
      ctx.font = '500 9.5px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(185,200,192,.8)'; ctx.fillText(`${fmt(x.el, 1)} kWh`, X.cult - 40, ey - 5);
    }
    if (x.heat > 0 && (cat === 'gwp' || cat === 'ced')) {
      const h = HEAT[p.heat]; ctx.strokeStyle = h.col; ctx.lineWidth = 1 + 5 * Math.sqrt(x.heat / 20);
      ctx.beginPath(); ctx.moveTo(X.cult + 44, ey); ctx.quadraticCurveTo(X.cult + 20, ey, X.cult + R(n.cult) * 0.7, y - R(n.cult) * 0.6); ctx.stroke();
      ctx.fillStyle = h.col; ctx.font = '700 11px Inter, sans-serif'; ctx.fillText('♨', X.cult + 46, ey + 4);
      ctx.font = '500 9.5px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(185,200,192,.8)'; ctx.fillText(`${fmt(x.heat, 1)} kWh`, X.cult + 60, ey + 4);
    }
    // nodes
    const node = (xx, v, col, lab) => {
      const r = R(v); const gr = ctx.createRadialGradient(xx - r * 0.3, y - r * 0.3, 1, xx, y, r);
      gr.addColorStop(0, withAlpha(col, 0.95)); gr.addColorStop(1, withAlpha(col, 0.35));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(xx, y, r, 0, 7); ctx.fill(); ctx.strokeStyle = withAlpha(col, 0.9); ctx.lineWidth = 1; ctx.stroke();
      if (lab) { ctx.fillStyle = '#e6eee9'; ctx.font = '600 10px JetBrains Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText(lab, xx, y + r + 11); ctx.textAlign = 'left'; }
    };
    const digits = CAT[cat].digits;
    const cultV = n.cult + n.energy + n.heat;
    node(X.cult, cultV, cat === 'water' ? '#5cc8ef' : cat === 'land' ? '#7ee0a0' : '#6fd39a', fmt(cultV, digits));
    if (cat === 'gwp' || cat === 'ced') node(X.pack, n.pack, '#f07ad0', fmt(n.pack, digits));
    else { ctx.fillStyle = 'rgba(240,122,208,.5)'; ctx.beginPath(); ctx.arc(X.pack, y, 4, 0, 7); ctx.fill(); }
    // land patch
    if (cat === 'land') { const side = 4 + 34 * Math.sqrt(res[s.id].land.total / maxTot); ctx.fillStyle = 'rgba(126,224,160,.22)'; ctx.strokeStyle = 'rgba(126,224,160,.8)'; ctx.fillRect(X.cult + 30, y - side / 2, side, side); ctx.strokeRect(X.cult + 30, y - side / 2, side, side); }
    // total badge with rank
    const tot = res[s.id][cat].total, rank = ranks.indexOf(s.id) + 1;
    const bx = X.badge, bw = X.shop - X.badge - 12;
    rr(bx - 4, y - 15, bw, 30, 8); ctx.fillStyle = rank === 1 ? 'rgba(111,211,154,.22)' : 'rgba(255,255,255,.06)'; ctx.fill();
    ctx.strokeStyle = rank === 1 ? 'rgba(111,211,154,.9)' : 'rgba(255,255,255,.15)'; ctx.stroke();
    ctx.fillStyle = rank === 1 ? '#9be7b6' : '#e6eee9'; ctx.font = '700 12.5px JetBrains Mono, monospace'; ctx.fillText(fmt(tot, digits), bx + 2, y + 1);
    ctx.font = '500 9px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(185,200,192,.85)'; ctx.fillText(`rank ${rank}`, bx + 2, y + 11);
    // lettuce tokens
    const sp = spawnAcc[i]; sp.tok += dt * 0.9; while (sp.tok > 1) { sp.tok -= 1; tokens[i].push({ s: 0 }); }
    const path = [[X.cult - 52, y], [X.cult, y], [X.pack, y], [X.trA, y], [X.trB, y], [X.shop + 4, y]];
    const segL = []; let totL = 0; for (let k = 1; k < path.length; k++) { const l = Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]); segL.push(l); totL += l; }
    for (let k = tokens[i].length - 1; k >= 0; k--) {
      const tk = tokens[i][k]; tk.s += dt * 70; if (tk.s >= totL) { tokens[i].splice(k, 1); continue; }
      let d = tk.s, q = 0; while (q < segL.length - 1 && d > segL[q]) { d -= segL[q]; q++; }
      const f = Math.min(1, d / segL[q]); const px = path[q][0] + f * (path[q + 1][0] - path[q][0]), py = path[q][1] + f * (path[q + 1][1] - path[q][1]);
      if (px > X.trA + 6 && px < X.trB - 6) continue; // riding inside the vehicle
      if (px > X.badge - 8 && px < X.shop - 8) continue; // hidden behind the total badge
      ctx.fillStyle = '#7ee0a0'; ctx.beginPath(); ctx.arc(px, py, 3.2, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(px - 1, py - 1, 1.1, 0, 7); ctx.fill();
    }
    // impact particles spawn
    const emit = (key, v, px, py) => {
      if (!(v > 0) || reduceMotion) return; const rate = 7 * Math.sqrt(v / maxC); sp.imp[key] = (sp.imp[key] || Math.random()) + dt * rate;
      while (sp.imp[key] > 1) { sp.imp[key] -= 1; particles.push({ x: px + (Math.random() - 0.5) * 10, y: py, age: 0, life: 1.8 + Math.random(), kind: CAT[cat].particle, lane: i, size: 1.6 + 2.6 * Math.sqrt(v / maxC) }); }
    };
    if (cat === 'water') emit('w', n.cult, X.cult, y - G.lh * 0.45);
    else if (cat !== 'land') { emit('c', n.cult, X.cult, y - R(cultV)); emit('e', n.energy, X.cult - 44, ey); emit('h', n.heat, X.cult + 44, ey); emit('p', n.pack, X.pack, y - R(n.pack)); emit('t', n.tr, X.trA + (X.trB - X.trA) * ph, y - 8); }
    ctx.globalAlpha = 1;
  });
  // particles
  for (let k = particles.length - 1; k >= 0; k--) {
    const q = particles[k]; q.age += dt; if (q.age > q.life) { particles.splice(k, 1); continue; }
    const f = q.age / q.life;
    if (q.kind === 'drop') { q.y += dt * 30; ctx.fillStyle = `rgba(92,200,239,${0.85 * (1 - f)})`; ctx.beginPath(); ctx.moveTo(q.x, q.y - q.size * 1.8); ctx.quadraticCurveTo(q.x + q.size, q.y, q.x, q.y + q.size * 0.8); ctx.quadraticCurveTo(q.x - q.size, q.y, q.x, q.y - q.size * 1.8); ctx.fill(); }
    else if (q.kind === 'spark') { q.y -= dt * 22; ctx.fillStyle = `rgba(242,185,75,${0.9 * (1 - f)})`; ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size); }
    else { q.y -= dt * 18; q.x += Math.sin(q.age * 3 + k) * 0.15; ctx.fillStyle = `rgba(210,218,214,${0.42 * (1 - f)})`; ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (1 + f * 1.4), 0, 7); ctx.fill(); }
  }
  if (particles.length > 900) particles.splice(0, particles.length - 900);
}
requestAnimationFrame(frame);
cv.addEventListener('pointermove', e => {
  if (!cur) return; const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; const G = geom();
  const i = Math.floor((y - G.top) / G.lh); hoverLane = x < G.X.shop && i >= 0 && i < SYS.length ? i : -1;
  if (hoverLane < 0) { tip.style.display = 'none'; return; }
  const s = SYS[hoverLane], p = cur.p, c = CAT[p.cat];
  if (!available(s.id, p)) { tip.innerHTML = `<b>${s.name}</b><br>Not available in January.`; }
  else {
    const o = cur.res[s.id][p.cat]; const parts = PARTS[p.cat].filter(([k]) => o[k] > 0);
    tip.innerHTML = `<b>${s.name}</b><br>${c.long}: <b>${fmt(o.total, c.digits)}</b> ${c.unit}<table>${parts.map(([k, lab, col]) => `<tr><td><i style="background:${col}"></i>${lab}</td><td>${fmt(o[k], c.digits)}</td><td>${fmt(100 * o[k] / o.total, 0)} %</td></tr>`).join('')}</table>`;
  }
  tip.style.display = 'block'; tip.style.left = Math.min(x + 14, W - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(y + 12, H - tip.offsetHeight - 8) + 'px';
});
cv.addEventListener('pointerleave', () => { hoverLane = -1; tip.style.display = 'none'; });

/* ================================================================= update */
let seed = 20260927, mc = null, mcT = 0, raf = 0;
function update() {
  const p = ui.values();
  inv.vf.el = p.vfEl; inv.gh.heat = p.ghHeat; inv.gh.el = p.ghEl; inv.es.dist = p.impDist; inv.es.mode = p.impMode;
  const res = computeAll(p); cur = { res, p };
  const c = CAT[p.cat];
  const ids = SYS.filter(s => available(s.id, p)).map(s => s.id);
  const best = ids.reduce((a, b) => res[a][p.cat].total <= res[b][p.cat].total ? a : b);
  const bv = res[best][p.cat].total;
  SYS.forEach(s => {
    const it = ro.items[s.id]; it.unit = c.unit; it.digits = c.digits;
    if (!available(s.id, p)) { ro.set(s.id, NaN, null, 'not in season in January'); return; }
    const v = res[s.id][p.cat].total, ratio = v / bv;
    ro.set(s.id, v, s.id === best ? 'ok' : ratio <= 1.5 ? 'warn' : 'bad', s.id === best ? 'lowest' : `${fmt(ratio, 1)} × the lowest`);
  });
  ro.set('best', SYSMAP[best].short, 'ok', c.label);
  const be = breakEven(res, p) * 1000; const g = GRID[p.gridSE].ef * 1000;
  ro.set('be', be > 0 ? be : NaN, be > 0 && g <= be ? 'ok' : 'bad', be > 0 ? `VF Sweden beats the import below this; chosen grid ${fmt(g, 0)} g` : 'no grid is clean enough: non-electric inputs exceed the import');
  hud.set('cat', `<b>${c.label}</b> ${c.unit} · ${p.season === 'winter' ? 'January' : 'July'} · ${GRID[p.gridSE].short} · ${HEAT[p.heat].short.toLowerCase()} heat`);
  // contributions
  const parts = PARTS[p.cat];
  chContrib.y.label = c.label; chContrib.y.unit = c.unit;
  chContrib.set(ids.map(id => SYSMAP[id].short), parts.map(([k, lab, col]) => ({ label: lab, values: ids.map(id => res[id][p.cat][k] || 0), color: col })));
  // break-even
  drawBreak(res, p, be);
  drawTrade(res, p, ids);
  syncTable(res, p);
  clearTimeout(mcT); mcT = setTimeout(runMC, 160);
}
function drawBreak(res, p, be) {
  const xs = []; for (let e = 0; e <= 850; e += 10) xs.push(e);
  const x = inv.vf, K = 1 / (1 - x.loss / 100); const g0 = res.vf.gwp.total / K - x.el * gridOf('vf', p).ef;
  chBreak.line('vf', xs, xs.map(e => K * (x.el * e / 1000 + g0)), { color: SYSMAP.vf.col, width: 2.6, label: 'Vertical farm (any grid)' });
  chBreak.line('es', xs, xs.map(() => res.es.gwp.total), { color: SYSMAP.es.col, width: 2.4, label: 'Imported field lettuce' });
  const gh = inv.gh, Kg = 1 / (1 - gh.loss / 100), g0g = res.gh.gwp.total / Kg - gh.el * gridOf('gh', p).ef;
  chBreak.line('gh', xs, xs.map(e => Kg * (gh.el * e / 1000 + g0g)), { color: SYSMAP.gh.col, width: 2.2, dash: [6, 4], label: `Greenhouse (${HEAT[p.heat].short.toLowerCase()})` });
  if (available('sf', p)) { const sf = inv.sf, Ks = 1 / (1 - sf.loss / 100), g0s = res.sf.gwp.total / Ks - sf.el * gridOf('sf', p).ef; chBreak.line('sf', xs, xs.map(e => Ks * (sf.el * e / 1000 + g0s)), { color: SYSMAP.sf.col, width: 2.2, dash: [2, 3], label: 'Swedish field (July)' }); } else chBreak.remove('sf');
  ['ppa', 'se', 'eu', 'pl'].forEach((k, j) => chBreak.vline('g' + k, GRID[k].ef * 1000, { color: 'muted', dash: [2, 4], width: 1, label: j === 1 ? '' : GRID[k].short }));
  chBreak.point('vfNow', gridOf('vf', p).ef * 1000, res.vf.gwp.total, { color: SYSMAP.vf.col, r: 5 });
  chBreak.point('vcNow', gridOf('vc', p).ef * 1000, res.vc.gwp.total, { color: SYSMAP.vc.col, r: 5, label: 'VF coal grid' });
  if (be > 0 && be < 850) chBreak.point('be', be, res.es.gwp.total, { color: 'ink', r: 4.5, label: `EF* = ${fmt(be, 0)} g`, guides: true }); else chBreak.remove('be');
}
function drawTrade(res, p, ids) {
  const cats = ['gwp', 'ced', 'water', 'land'];
  ids.forEach(id => { const ys = cats.map(c => res[id][c].total / res.es[c].total); const vc = id === 'vc'; chTrade.line('l' + id, [0, 1, 2, 3], ys, { color: SYSMAP[id].col, width: vc ? 1.6 : 2.2, dash: vc ? [5, 4] : null, label: SYSMAP[id].short, tipExtra: () => '× import' }); chTrade.scatter('s' + id, [0, 1, 2, 3], ys, { color: SYSMAP[id].col, r: vc ? 3 : 5, hollow: vc, noTip: true }); });
  SYS.forEach(s => { if (!ids.includes(s.id)) { chTrade.remove('l' + s.id); chTrade.remove('s' + s.id); } });
  chTrade.hline('one', 1, { color: 'muted', dash: [4, 4], label: 'imported field lettuce' });
}
function runMC() {
  const p = ui.values();
  mc = monteCarlo(p, Math.round(p.mcN), p.spread, seed);
  const c = CAT[p.cat], st = mc.stats[p.cat];
  chWin.y.label = `P(lowest ${c.label})`;
  chWin.set(mc.ids.map(id => SYSMAP[id].short), [{ label: 'P(lowest)', values: mc.ids.map(id => 100 * st[id].p), colors: mc.ids.map(id => SYSMAP[id].col), format: v => fmt(v, 1) + ' %' }]);
  const lead = mc.ids.reduce((a, b) => st[a].p >= st[b].p ? a : b);
  const se = 100 * Math.sqrt(st[lead].p * (1 - st[lead].p) / mc.N);
  ro.set('pwin', 100 * st[lead].p, st[lead].p > 0.9 ? 'ok' : st[lead].p > 0.6 ? 'warn' : 'bad', `${SYSMAP[lead].short} · ± ${fmt(se, 1)} pp (SE), N = ${mc.N.toLocaleString('en-GB')}`);
  // densities on a common log grid
  let lo = Infinity, hi = -Infinity; mc.ids.forEach(id => { lo = Math.min(lo, st[id].lo); hi = Math.max(hi, st[id].hi); });
  lo = Math.max(lo / 2, 1e-4); hi = hi * 2;
  const xs = []; for (let k = 0; k <= 160; k++) xs.push(lo * Math.pow(hi / lo, k / 160));
  chDist.setAxis('x', { label: `${c.label} per kg delivered (log scale)`, unit: c.unit, log: true, min: Math.pow(10, Math.floor(Math.log10(lo))), max: Math.pow(10, Math.ceil(Math.log10(hi))) });
  SYS.forEach(s => { if (!mc.ids.includes(s.id)) chDist.remove('d' + s.id); });
  mc.ids.forEach(id => chDist.line('d' + id, xs, kdeLog(mc.S[p.cat][id], xs), { color: SYSMAP[id].col, width: 2, fill: 0.12, label: SYSMAP[id].short }));
}
ui.onChange(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); }
update();
window.__lca = { compute: id => compute(id, invOf(id), ui.values()), inv, GRID, HEAT, breakEven: () => breakEven(computeAll(ui.values()), ui.values()), mc: () => mc && mc.stats };
