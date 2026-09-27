/* Nutrient-solution mixer — UI, solver wiring, animated A/B stock tanks, charts and mixing sheet.
   Chemistry in ./model.js (Derive tab, Eqs. N1–N7). */
import { Controls, Readouts, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { BarChart, downloadCSV } from '/assets/js/plot.js';
import { palette, withAlpha, categorical } from '/assets/js/colors.js';
import * as N from './model.js';

const $ = id => document.getElementById(id);
const ION_KEYS = ['NH4', 'K', 'Ca', 'Mg', 'NO3', 'H2PO4', 'SO4', 'Cl'];
const FERT_KEYS = ['CN', 'KNO3', 'NH4NO3', 'MgNO3', 'MKP', 'MAP', 'MgSO4', 'K2SO4', 'CaCl2', 'HNO3', 'H3PO4'];
const SHORT = { CN: 'Calcium nitrate', KNO3: 'Potassium nitrate', NH4NO3: 'Ammonium nitrate', MgNO3: 'Magnesium nitrate', MKP: 'Monopotassium phosphate', MAP: 'Monoammonium phosphate', MgSO4: 'Magnesium sulfate', K2SO4: 'Potassium sulfate', CaCl2: 'Calcium chloride', HNO3: 'Nitric acid', H3PO4: 'Phosphoric acid' };
const ABBR = { CN: 'Ca(NO₃)₂ (CN)', KNO3: 'KNO₃', NH4NO3: 'NH₄NO₃', MgNO3: 'Mg(NO₃)₂', MKP: 'KH₂PO₄', MAP: 'MAP', MgSO4: 'MgSO₄', K2SO4: 'K₂SO₄', CaCl2: 'CaCl₂', HNO3: 'HNO₃', H3PO4: 'H₃PO₄' };
const SALT_COL = { CN: '#e3a13b', KNO3: '#7e6bd6', NH4NO3: '#2aa198', MgNO3: '#5fb760', MKP: '#c7509f', MAP: '#d67ab7', MgSO4: '#58b86a', K2SO4: '#9d7fe0', CaCl2: '#d9b35c', HNO3: '#4b8fd6', H3PO4: '#e0609c', micro: '#8c9aa3' };
const ION_COL = { NH4: '#2aa198', K: '#8a6fe0', Ca: '#e8a33a', Mg: '#4fb563', Na: '#9aa3a8', NO3: '#3f8fd8', H2PO4: '#d6559c', SO4: '#d7c63b', Cl: '#63c3c9', HCO3: '#b0b9be', Fe: '#9c4f1f' };

/* ================================================================ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'ec', label: 'EC estimate, Σ cations ÷ 10', unit: 'dS m⁻¹', digits: 2 })
  .add({ id: 'ecA', label: 'EC estimate, ionic conductivity (APHA)', unit: 'dS m⁻¹', digits: 2 })
  .add({ id: 'bal', label: 'Ion balance: cations | anions', unit: 'meq L⁻¹', format: v => v })
  .add({ id: 'ph', label: 'pH just after mixing (closed tank)', unit: '', digits: 2 })
  .add({ id: 'phO', label: 'pH after CO₂ has degassed (aerated)', unit: '', digits: 2 })
  .add({ id: 'acid', label: 'Acid dose', unit: '', format: v => v })
  .add({ id: 'nh4', label: 'NH₄⁺ share of nitrogen', unit: '%', digits: 1 })
  .add({ id: 'na', label: 'Na⁺ | Cl⁻ from the water', unit: 'mmol L⁻¹', format: v => v })
  .add({ id: 'fit', label: 'Largest deviation from target', unit: '', format: v => v })
  .add({ id: 'gyp', label: 'Working solution: gypsum SI', unit: '', digits: 2 })
  .add({ id: 'stock', label: 'Stock tanks: compatibility', unit: '', format: v => v })
  .add({ id: 'solu', label: 'Stock tanks: highest solubility use', unit: '%', digits: 0 });

ui.section('Target solution');
ui.select({ id: 'recipe', label: 'Crop recipe', options: Object.entries(N.RECIPES).map(([value, r]) => ({ value, label: r.label })), value: 'lettuceNL', onChange: v => loadRecipe(v) });
ui.slider({ id: 'strength', label: 'Strength (fraction of recipe)', min: 0.5, max: 1.5, step: 0.05, value: 1, format: v => fmt(v * 100, 0) + ' %', help: 'Scale all nutrients, e.g. 70–80 % for seedlings or in dull weather.' });
const TGT = { NH4: [0, 3, 0.05], K: [0, 14, 0.05], Ca: [0, 8, 0.05], Mg: [0, 4, 0.05], NO3: [0, 25, 0.05], H2PO4: [0, 3, 0.05], SO4: [0, 7, 0.05], Cl: [0, 3, 0.05] };
Object.entries(TGT).forEach(([k, [mn, mx, st]]) => ui.slider({ id: 't' + k, label: `Target ${N.IONS[k].label}`, min: mn, max: mx, step: st, value: N.RECIPES.lettuceNL.ions[k] || 0, unit: 'mmol L⁻¹' }));
ui.section('Source water (mg L⁻¹)');
ui.select({ id: 'water', label: 'Typical example', options: Object.entries(N.WATERS).map(([value, w]) => ({ value, label: w.label })), value: 'soft', onChange: v => loadWater(v) });
[['wCa', 'Calcium Ca²⁺'], ['wMg', 'Magnesium Mg²⁺'], ['wNa', 'Sodium Na⁺'], ['wK', 'Potassium K⁺'], ['wCl', 'Chloride Cl⁻'], ['wSO4', 'Sulfate SO₄²⁻'], ['wHCO3', 'Bicarbonate HCO₃⁻']].forEach(([id, label]) => ui.number({ id, label, min: 0, max: 1000, step: 0.1, value: N.WATERS.soft[id.slice(1)], unit: 'mg L⁻¹' }));
ui.number({ id: 'wpH', label: 'pH of the water', min: 4, max: 9.5, step: 0.05, value: 8.2, unit: '' });
ui.section('Fertilisers on your shelf');
ui.toggle({ id: 'private', label: 'Private buyer in the EU (Regulation 2019/1148)', value: false, help: 'Nitric acid above 3 % and ammonium nitrate are restricted explosives precursors: not sold to the public.' });
FERT_KEYS.forEach(k => ui.toggle({ id: 'f' + k, label: `${SHORT[k]} <span class="muted" style="font-size:.78em">${N.FERTS[k].formula}</span>`, value: !N.FERTS[k].optional }));
ui.segmented({ id: 'hno3w', label: 'Nitric acid grade', options: [{ value: 38, label: '38 %' }, { value: 60, label: '60 %' }], value: 38 });
ui.segmented({ id: 'h3po4w', label: 'Phosphoric acid grade', options: [{ value: 59, label: '59 %' }, { value: 75, label: '75 %' }, { value: 85, label: '85 %' }], value: 75 });
ui.select({ id: 'fe', label: 'Iron chelate', options: [{ value: 'DTPA', label: 'Fe-DTPA 11 % (pH ≤ 7)' }, { value: 'DTPA6', label: 'Fe-DTPA 6 % (pH ≤ 7)' }, { value: 'EDTA', label: 'Fe-EDTA 13 % (pH ≤ 6)' }, { value: 'EDDHA', label: 'Fe-EDDHA 6 % (pH ≤ 9)' }], value: 'DTPA' });
ui.toggle({ id: 'mchel', label: 'Mn, Zn, Cu as EDTA chelates (not sulfates)', value: false });
ui.section('Acid and pH');
ui.slider({ id: 'tpH', label: 'Target pH', min: 5.0, max: 6.5, step: 0.05, value: 5.8 });
ui.segmented({ id: 'basis', label: 'Acid calculated for', options: [{ value: 'residual', label: '0.5 mM HCO₃⁻ left' }, { value: 'closed', label: 'target pH, closed' }, { value: 'open', label: 'target pH, aerated' }], value: 'closed', help: 'Aerated solutions lose CO₂ and drift upwards unless almost all bicarbonate is neutralised.' });
ui.section('Stock tanks and batch');
ui.segmented({ id: 'F', label: 'Concentration factor', options: [{ value: 50, label: '50×' }, { value: 100, label: '100×' }, { value: 200, label: '200×' }, { value: 400, label: '400×' }], value: 100, help: '100× is the Dutch standard; very concentrated stocks save space but risk crystals.' });
ui.slider({ id: 'Vs', label: 'Volume of each stock tank', min: 2, max: 1000, step: 1, value: 20, unit: 'L', log: true });
ui.slider({ id: 'Vw', label: 'Your system volume (one fill)', min: 5, max: 2000, step: 1, value: 80, unit: 'L', log: true });
ui.slider({ id: 'Tst', label: 'Storage temperature of the stocks', min: 0, max: 25, step: 1, value: 18, unit: '°C', help: 'KNO₃ solubility falls from 316 g L⁻¹ at 20 °C to 133 g L⁻¹ at 0 °C.' });
ui.presets([
  { label: 'Lettuce DWC, Mälaren tap water', values: { recipe: 'lettuceCornell', water: 'soft', strength: 1, private: false, basis: 'open', F: 100, Vs: 20 }, onApply: () => { loadRecipe('lettuceCornell'); loadWater('soft'); } },
  { label: 'Tomato, hard groundwater', values: { recipe: 'tomatoNL', water: 'hard', strength: 1, private: false, fCaCl2: true, basis: 'closed', F: 100, Vs: 1000 }, onApply: () => { loadRecipe('tomatoNL'); loadWater('hard'); } },
  { label: 'Basil, rain water', values: { recipe: 'basilNL', water: 'ro', strength: 1, private: false, basis: 'closed', F: 200, Vs: 50 }, onApply: () => { loadRecipe('basilNL'); loadWater('ro'); } },
  { label: 'Student at home (private buyer)', values: { recipe: 'lettuceCornell', water: 'hard', private: true, strength: 1, basis: 'closed', F: 100, Vs: 10 }, onApply: () => { loadRecipe('lettuceCornell'); loadWater('hard'); } },
  { label: 'Softened-water trap', values: { recipe: 'lettuceNL', water: 'softened', strength: 1, private: false, basis: 'closed' }, onApply: () => { loadRecipe('lettuceNL'); loadWater('softened'); } }
]);
const btns = ui.buttons([
  { label: '🖨 Mixing sheet', variant: 'primary', onClick: () => openSheet() },
  { label: '⬇ CSV', onClick: () => csv() }
]);
ui.saveButton('nutrient-mixer', () => ro.values());

function loadRecipe(key) { const r = N.RECIPES[key]; const v = {}; ION_KEYS.forEach(k => { v['t' + k] = r.ions[k] || 0; }); ui.setMany(v); }
function loadWater(key) { const w = N.WATERS[key]; ui.setMany({ wCa: w.Ca, wMg: w.Mg, wNa: w.Na, wK: w.K || 0, wCl: w.Cl, wSO4: w.SO4, wHCO3: w.HCO3, wpH: w.pH }); }

/* ================================================================ solve */
let R = null; const overrides = {};
function compute() {
  const p = ui.values();
  // EU private-buyer restriction (Regulation (EU) 2019/1148, Annex I)
  ui.enable('fHNO3', !p.private); ui.enable('fNH4NO3', !p.private); ui.enable('hno3w', !p.private);
  const recipe = N.RECIPES[p.recipe];
  const target = { ions: {}, micro: {} };
  ION_KEYS.forEach(k => { target.ions[k] = (p['t' + k] || 0) * p.strength; });
  Object.entries(recipe.micro).forEach(([k, v]) => { target.micro[k] = v * p.strength; });
  const water = { Ca: p.wCa, Mg: p.wMg, Na: p.wNa, K: p.wK, Cl: p.wCl, SO4: p.wSO4, HCO3: p.wHCO3, pH: p.wpH };
  const enabled = {}; FERT_KEYS.forEach(k => { enabled[k] = !!p['f' + k]; });
  if (p.private) { enabled.HNO3 = false; enabled.NH4NO3 = false; }
  const r = N.solveRecipe({ target, water, enabled, fe: p.fe, microChelated: p.mchel, targetPH: p.tpH, basis: p.basis });
  r.target = target; r.p = p; r.water = water; r.recipe = recipe;
  r.bal = N.balance(r.sol); r.ec = N.ecEstimates(r.sol); r.el = N.elementsMgL(r.sol);
  // pH: closed (just after mixing) and after degassing
  const w = N.waterMmol(water); const h0 = Math.pow(10, -p.wpH);
  const car = (() => { const K1 = Math.pow(10, -6.35), K2 = Math.pow(10, -10.33); const a1 = h0 * K1 / (h0 * h0 + h0 * K1 + K1 * K2), a2 = K1 * K2 / (h0 * h0 + h0 * K1 + K1 * K2); return (w.HCO3 - (1e-14 / h0 - h0) * 1000) / (a1 + 2 * a2); })();
  const alk = w.HCO3 - r.H;
  r.phClosed = N.phOf(alk, Math.max(0, car), r.sol.H2PO4); r.phOpen = N.phOpen(alk, r.sol.H2PO4);
  r.sat = N.saturation(r.sol, r.phClosed);
  r.tanks = N.allocate(r.amounts, overrides);
  r.F = +p.F; r.Vs = p.Vs; r.Vw = p.Vw;
  // stock checks
  r.stock = ['A', 'B'].map(t => {
    const am = r.tanks[t]; const chk = N.stockCheck(am, r.F);
    const hasCa = Object.keys(am).some(k => N.FERTS[k].ca), hasS = Object.keys(am).some(k => N.FERTS[k].s), hasP = Object.keys(am).some(k => N.FERTS[k].p);
    const microSulf = t === 'A' && false;
    let maxUse = 0, worst = null;
    Object.entries(am).forEach(([k, a]) => { const sol = N.solubilityAt(k, p.Tst); if (!sol) return; const gL = a * r.F * N.FERTS[k].Munit / 1000; const use = gL / sol * 100; if (use > maxUse) { maxUse = use; worst = k; } });
    const acidInA = t === 'A' && (am.HNO3 || am.H3PO4);
    return { t, am, chk, hasCa, hasS, hasP, clash: hasCa && (hasS || hasP), maxUse, worst, acidInA, microSulf };
  });
  // micronutrient salts always go to B (sulfates) or A (chelates)
  r.microTank = el => (el === 'Fe' || (p.mchel && ['Mn', 'Zn', 'Cu'].includes(el))) ? 'A' : 'B';
  // deviations
  // deviations of the nutrients (Cl⁻ only when the recipe asks for it; excess from the water alone is reported separately)
  let dev = 0, devIon = null; ION_KEYS.forEach(k => { const tg = target.ions[k]; if (k === 'Cl' && tg <= 0) return; const d = Math.abs(r.sol[k] - tg) / Math.max(0.5, tg); if (d > dev) { dev = d; devIon = k; } });
  r.dev = dev; r.devIon = devIon;
  R = r; return r;
}

/* ================================================================ readouts, table, charts */
const gramsWork = (k, a) => a * N.FERTS[k].Munit;                       // g per 1000 L of working solution
const acidM = k => k === 'HNO3' ? N.acidMolarity('HNO3', +R.p.hno3w) : N.acidMolarity('H3PO4', +R.p.h3po4w);
const acidMlPer1000 = (k, a) => a * 1000 / acidM(k);                    // mL per 1000 L of working solution
function massStr(g) { return g >= 1000 ? fmt(g / 1000, 2) + ' kg' : g >= 10 ? fmt(g, 0) + ' g' : g >= 1 ? fmt(g, 1) + ' g' : fmt(g, 2) + ' g'; }
function volStr(ml) { return ml >= 1000 ? fmt(ml / 1000, 2) + ' L' : ml >= 10 ? fmt(ml, 0) + ' mL' : fmt(ml, 1) + ' mL'; }

function updateReadouts(r) {
  const p = r.p;
  ro.set('ec', r.ec.rule, null, `recipe target ≈ ${fmt(r.recipe.ec * p.strength, 1)} dS m⁻¹`);
  ro.set('ecA', r.ec.apha, null, `κ°·y², I = ${fmt(r.ec.I * 1000, 1)} mmol L⁻¹, y = ${fmt(r.ec.y, 3)}`);
  const ibe = r.bal.ibe; ro.set('bal', `${fmt(r.bal.cat, 2)} | ${fmt(r.bal.an, 2)}`, Math.abs(ibe) < 2 ? 'ok' : Math.abs(ibe) < 5 ? 'warn' : 'bad', `ion-balance error ${fmt(ibe, 1)} %`);
  ro.set('ph', r.phClosed, r.phClosed >= 5.3 && r.phClosed <= 6.5 ? 'ok' : 'warn', `CO₂ from neutralised bicarbonate still dissolved`);
  ro.set('phO', r.phOpen, r.phOpen >= 5.3 && r.phOpen <= 6.8 ? 'ok' : 'warn', 'equilibrium with 425 ppm CO₂ (DWC, NFT)');
  const parts = []; if (r.amounts.HNO3 > 1e-4) parts.push(`HNO₃ ${p.hno3w} %: ${volStr(acidMlPer1000('HNO3', r.amounts.HNO3) / 10)}`); if (r.amounts.H3PO4 > 1e-4) parts.push(`H₃PO₄ ${p.h3po4w} %: ${volStr(acidMlPer1000('H3PO4', r.amounts.H3PO4) / 10)}`);
  ro.set('acid', parts.length ? parts.join('<br>') : 'none', null, `${fmt(r.H, 2)} mmol H⁺ L⁻¹ needed ${fmt(r.need.H, 2)} · per 100 L`);
  const n = r.sol.NH4 / Math.max(1e-9, r.sol.NH4 + r.sol.NO3) * 100; ro.set('nh4', n, n <= 15 ? 'ok' : n <= 25 ? 'warn' : 'bad', 'typical 5–10 %');
  const na = r.water.Na / 22.99, cl = r.water.Cl / 35.45; const q = Math.max(na, cl);
  ro.set('na', `${fmt(na, 2)} | ${fmt(cl, 2)}`, q < 1.5 ? 'ok' : q < 2.5 ? 'warn' : 'bad', q < 1.5 ? 'class 1: suitable for recirculation' : q < 2.5 ? 'class 2: avoid recirculation' : 'class 3: salt-sensitive crops suffer');
  ro.set('fit', r.dev < 0.02 ? 'all ions within 2 %' : `${N.IONS[r.devIon].label} ${r.sol[r.devIon] > r.target.ions[r.devIon] ? '+' : '−'}${fmt(r.dev * 100, 0)} %`, r.dev < 0.05 ? 'ok' : r.dev < 0.2 ? 'warn' : 'bad', 'relative to target (or to 0.5 mmol L⁻¹ if smaller)');
  ro.set('gyp', r.sat.gypsum, r.sat.gypsum < -0.3 ? 'ok' : r.sat.gypsum < 0 ? 'warn' : 'bad', `brushite SI ${fmt(r.sat.brushite, 2)} · calcite SI ${fmt(r.sat.calcite, 1)}`);
  const clash = r.stock.filter(s => s.clash); ro.set('stock', clash.length ? `tank ${clash.map(s => s.t).join(' & ')}: Ca + ${clash.some(s => s.hasS) ? 'SO₄' : ''}${clash.some(s => s.hasS) && clash.some(s => s.hasP) ? '/' : ''}${clash.some(s => s.hasP) ? 'PO₄' : ''}` : 'compatible', clash.length ? 'bad' : 'ok', clash.length ? 'precipitates in the concentrate!' : 'calcium kept apart from sulfate and phosphate');
  const mu = Math.max(...r.stock.map(s => s.maxUse)); const w = r.stock.find(s => s.maxUse === mu);
  ro.set('solu', mu, mu < 80 ? 'ok' : mu < 100 ? 'warn' : 'bad', w && w.worst ? `${SHORT[w.worst]} in tank ${w.t} at ${r.p.Tst} °C` : '');
  hud.set('ec', `EC <b>${fmt(r.ec.apha, 2)}</b> dS m⁻¹ · pH <b>${fmt(r.phClosed, 2)}</b> → <b>${fmt(r.phOpen, 2)}</b> aerated`);
  hud.set('mix', `1 L A + 1 L B → <b>${r.F}</b> L solution · stocks <b>${fmt(r.Vs, 0)}</b> L each`);
}

function tableHTML(r) {
  const p = r.p, F = r.F, Vs = r.Vs, Vw = r.Vw;
  const rows = [];
  const add = (tank, key, name, formula, mmol, per1000, stock, fill, colKey, liquid) => rows.push({ tank, key, name, formula, mmol, per1000, stock, fill, colKey, liquid });
  ['A', 'B'].forEach(t => {
    Object.entries(r.tanks[t]).forEach(([k, a]) => {
      const f = N.FERTS[k];
      if (f.acid) { const ml = acidMlPer1000(k, a); add(t, k, `${SHORT[k]} ${k === 'HNO3' ? p.hno3w : p.h3po4w} %`, f.formula, a, volStr(ml), volStr(ml * Vs * F / 1000), volStr(ml * Vw / 1000), k, true); }
      else { const g = gramsWork(k, a); add(t, k, SHORT[k], f.formula, a, massStr(g), massStr(g * Vs * F / 1000), massStr(g * Vw / 1000), k, false); }
    });
    Object.entries(r.micro).forEach(([el, m]) => { if (r.microTank(el) !== t || m.umol <= 0) return; const g = m.gPer1000; add(t, 'm' + el, m.name, `${el} ${fmt(m.umol, 1)} µmol L⁻¹`, null, massStr(g), massStr(g * Vs * F / 1000), massStr(g * Vw / 1000), 'micro', false); });
  });
  const clashT = r.stock.filter(s => s.clash).map(s => s.t);
  let h = `<table class="nm-table"><caption>Weighing list — ${r.recipe.label.replace(/\s*\(.*\)/, '')} at ${fmt(p.strength * 100, 0)} % strength</caption><thead><tr><th>Tank</th><th>Fertiliser</th><th class="num">mmol L⁻¹</th><th class="num">per 1000 L</th><th class="num">stock tank<br>${fmt(Vs, 0)} L · ${F}×</th><th class="num">one fill<br>${fmt(Vw, 0)} L</th><th></th></tr></thead><tbody>`;
  rows.forEach(x => {
    const mov = x.key.startsWith('m') ? '' : `<button type="button" class="nm-move" data-k="${x.key}" title="Move to the other tank">→ ${x.tank === 'A' ? 'B' : 'A'}</button>`;
    h += `<tr class="${clashT.includes(x.tank) && (N.FERTS[x.key]?.ca || N.FERTS[x.key]?.s || N.FERTS[x.key]?.p) ? 'nm-clash' : ''}"><td><span class="nm-tank nm-${x.tank}">${x.tank}</span></td><td class="nm-name"><i class="nm-sw" style="background:${SALT_COL[x.colKey] || '#999'}"></i>${x.name}<span class="muted">${x.formula}</span></td><td class="num">${x.mmol == null ? '–' : fmt(x.mmol, 3)}</td><td class="num">${x.per1000}</td><td class="num"><b>${x.stock}</b></td><td class="num">${x.fill}</td><td>${mov}</td></tr>`;
  });
  h += `</tbody></table>`;
  const notes = [];
  if (r.stock.some(s => s.clash)) notes.push('⚠ Calcium and sulfate or phosphate are in the same concentrate: gypsum or calcium phosphate will precipitate. Move them apart.');
  if (r.stock.some(s => s.acidInA)) notes.push('⚠ Acid in tank A with the iron chelate: keep the A tank above pH 3.5 or chelates break down (van der Lugt 2016).');
  r.stock.forEach(s => { if (s.maxUse >= 100) notes.push(`⚠ ${SHORT[s.worst]} exceeds its solubility in tank ${s.t} at ${p.Tst} °C — lower the concentration factor or enlarge the tanks.`); else if (s.maxUse >= 80) notes.push(`${SHORT[s.worst]} is at ${fmt(s.maxUse, 0)} % of its solubility in tank ${s.t}: crystals may form in a cold store.`); });
  if (p.private) notes.push('Private buyer: nitric acid (> 3 %) and ammonium nitrate are not available to members of the public in the EU (Regulation (EU) 2019/1148); phosphoric acid supplies all the acid, so hard water pushes phosphorus above target.');
  if (p.fe === 'EDTA' && r.phOpen > 6.3) notes.push('Fe-EDTA loses iron above pH ≈ 6.5 — this solution drifts to pH ' + fmt(r.phOpen, 1) + ' when aerated. Use Fe-DTPA or Fe-EDDHA, or acidify further.');
  if (r.excessH > 0.05) notes.push('More acid than bicarbonate: the solution will be strongly acidic. Reduce the acid or raise the target pH.');
  return h + (notes.length ? `<ul class="nm-notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>` : '<p class="nm-ok">✓ No precipitation or solubility problems in the stock tanks.</p>');
}
$('recipe-table').addEventListener('click', e => { const b = e.target.closest('.nm-move'); if (!b) return; const k = b.dataset.k; const inA = R.tanks.A[k] != null; overrides[k] = inA ? 'B' : 'A'; update(); });

const ionChart = new BarChart('#chart-ions', { y: { label: 'Concentration', unit: 'mmol L⁻¹', min: 0 }, height: 300 });
const meqChart = new BarChart('#chart-meq', { y: { label: 'Charge', unit: 'meq L⁻¹', min: 0 }, stacked: true, height: 290 });
const srcChart = new BarChart('#chart-src', { y: { label: 'Concentration', unit: 'mg L⁻¹', min: 0 }, stacked: true, horizontal: true, height: 262 });
function updateCharts(r) {
  const cats = ['NH4', 'K', 'Ca', 'Mg', 'NO3', 'H2PO4', 'SO4', 'Cl', 'Na', 'HCO3'];
  const w = r.water;
  ionChart.set(cats.map(k => N.IONS[k].label), [
    { label: 'Target', values: cats.map(k => r.target.ions[k] ?? 0), color: 'muted' },
    { label: 'Achieved', values: cats.map(k => r.sol[k]), color: 'accent' },
    { label: 'of which from the water', values: cats.map(k => N.waterMmol(w)[k] || 0), color: 'water' }
  ]);
  const cat = ['NH4', 'K', 'Ca', 'Mg', 'Na'], an = ['NO3', 'H2PO4', 'SO4', 'Cl', 'HCO3'];
  meqChart.set(['Cations', 'Anions'], [...cat.map(k => ({ label: N.IONS[k].label, values: [r.sol[k] * N.IONS[k].z, 0], color: ION_COL[k] })), ...an.map(k => ({ label: N.IONS[k].label, values: [0, r.sol[k] * Math.abs(N.IONS[k].z)], color: ION_COL[k] }))]);
  // where each element comes from (mg L⁻¹)
  const els = ['N', 'P', 'K', 'Ca', 'Mg', 'S'];
  const elOf = per => ({ N: ((per.NO3 || 0) + (per.NH4 || 0)) * 14.007, P: (per.H2PO4 || 0) * 30.974, K: (per.K || 0) * 39.098, Ca: (per.Ca || 0) * 40.078, Mg: (per.Mg || 0) * 24.305, S: (per.SO4 || 0) * 32.06 });
  const series = [{ label: 'water', values: els.map(e => elOf(N.waterMmol(w))[e]), color: 'water' }];
  Object.entries(r.amounts).forEach(([k, a]) => { if (a <= 1e-4) return; const per = {}; Object.entries(N.FERTS[k].per).forEach(([i, v]) => { per[i] = v * a; }); series.push({ label: ABBR[k], values: els.map(e => elOf(per)[e]), color: SALT_COL[k] }); });
  srcChart.set(els, series);
}

/* ================================================================ stage: animated A/B tanks */
const stageEl = $('stage');
const cv = document.createElement('canvas'); stageEl.appendChild(cv); const ctx = cv.getContext('2d');
const hud = hudChips(stageEl);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'nutrient-mixer.png'; a.click(); } });
let W = 0, H = 0, DPR = 1, visible = true;
function resize() { DPR = Math.min(2, window.devicePixelRatio || 1); W = stageEl.clientWidth; H = stageEl.clientHeight; cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
new ResizeObserver(resize).observe(stageEl); resize();
new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0.01 }).observe(stageEl);
const rnd = (() => { let a = 12345; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
const parts = { A: [], B: [], W: [] }, flakes = { A: [], B: [] }, drops = [];
let level = { A: 0.7, B: 0.7, W: 0.72 }, sediment = { A: 0, B: 0 };
function targetParticles(r) {
  const mk = (list, conc, n) => { const tot = Object.values(conc).reduce((s, v) => s + v, 0) || 1; const out = []; Object.entries(conc).forEach(([ion, c]) => { const k = Math.round(n * c / tot); for (let i = 0; i < k; i++) out.push(ion); }); return out; };
  ['A', 'B'].forEach(t => {
    const conc = {}; Object.entries(r.tanks[t]).forEach(([k, a]) => Object.entries(N.FERTS[k].per).forEach(([i, v]) => { if (i === 'H') return; conc[i] = (conc[i] || 0) + v * a; }));
    if (t === 'A' && r.micro.Fe) conc.Fe = r.micro.Fe.umol / 1000 * 30;
    const tot = Object.values(conc).reduce((s, v) => s + v, 0);
    const ions = mk(parts[t], conc, Math.round(Math.min(140, 22 + tot * 3)));
    parts[t] = ions.map((ion, i) => parts[t][i] && parts[t][i].ion === ion ? parts[t][i] : { ion, x: rnd(), y: rnd(), vx: 0, vy: 0, ph: rnd() * 6 });
  });
  const concW = {}; ['NH4', 'K', 'Ca', 'Mg', 'Na', 'NO3', 'H2PO4', 'SO4', 'Cl', 'HCO3'].forEach(k => { if (r.sol[k] > 0.02) concW[k] = r.sol[k]; });
  const ionsW = mk(parts.W, concW, 110); parts.W = ionsW.map((ion, i) => parts.W[i] && parts.W[i].ion === ion ? parts.W[i] : { ion, x: rnd(), y: rnd(), vx: 0, vy: 0, ph: rnd() * 6 });
}
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath(); }
function tankGeom() {
  const top = H * 0.2, h = H * 0.5, w = Math.min(W * 0.2, 190);
  return { A: { x: W * 0.05, y: top, w, h }, B: { x: W * 0.05 + w + W * 0.05, y: top, w, h }, W: { x: W * 0.64, y: H * 0.34, w: W * 0.31, h: H * 0.42 } };
}
let lastT = performance.now(), tAnim = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now; tAnim += dt;
  if (!visible || document.hidden || !R || !W) return;
  draw(dt);
}
function draw(dt) {
  const P = palette(); const r = R; const g = tankGeom();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
  // background: bench
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, withAlpha(P.bgSunk.startsWith('#') ? P.bgSunk : '#eeece3', 0.0)); bg.addColorStop(1, withAlpha(P.bgSunk.startsWith('#') ? P.bgSunk : '#eeece3', 0.9));
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = withAlpha(P.ink.startsWith('#') ? P.ink : '#222222', 0.06); ctx.fillRect(0, H * 0.93, W, H * 0.07);
  // levels follow stock volume (capacity = 1.25 × max(Vs, 20 L))
  const cap = Math.max(25, r.Vs * 1.25);
  const lv = Math.min(0.92, Math.max(0.15, r.Vs / cap));
  ['A', 'B'].forEach(t => { level[t] += (lv - level[t]) * Math.min(1, dt * 3); });
  // water pipe
  const pipeY = H * 0.86;
  ctx.strokeStyle = withAlpha(P.water.startsWith('#') ? P.water : '#1c78a3', 0.55); ctx.lineWidth = 10; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(W * 0.02, pipeY); ctx.lineTo(g.W.x + g.W.w * 0.2, pipeY); ctx.lineTo(g.W.x + g.W.w * 0.2, g.W.y + g.W.h * 0.12); ctx.stroke();
  ctx.strokeStyle = withAlpha('#ffffff', 0.55); ctx.lineWidth = 2; ctx.setLineDash([6, 10]); ctx.lineDashOffset = -tAnim * 40;
  ctx.beginPath(); ctx.moveTo(W * 0.02, pipeY); ctx.lineTo(g.W.x + g.W.w * 0.2, pipeY); ctx.lineTo(g.W.x + g.W.w * 0.2, g.W.y + g.W.h * 0.12); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = P.ink2; ctx.font = '600 11px Inter, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`water: ${fmt(r.water.Ca, 0)} mg Ca, ${fmt(r.water.HCO3, 0)} mg HCO₃⁻ per L`, W * 0.02, pipeY + 22);
  // stock tanks
  ['A', 'B'].forEach(t => drawStock(t, g[t], P, r, dt, pipeY));
  // working tank
  drawWorking(g.W, P, r, dt);
  // drops from dosing pumps into the pipe
  if (rnd() < dt * 5) ['A', 'B'].forEach(t => drops.push({ x: g[t].x + g[t].w / 2, y: g[t].y + g[t].h + 26, v: 0, t }));
  for (let i = drops.length - 1; i >= 0; i--) { const d = drops[i]; d.v += 500 * dt; d.y += d.v * dt; if (d.y > pipeY - 4) { drops.splice(i, 1); continue; } ctx.fillStyle = d.t === 'A' ? '#d99a3a' : '#6aa6d8'; ctx.beginPath(); ctx.ellipse(d.x, d.y, 2.6, 3.6, 0, 0, Math.PI * 2); ctx.fill(); }
}
function drawStock(t, b, P, r, dt, pipeY) {
  const s = r.stock.find(x => x.t === t); const am = r.tanks[t];
  // dosing pump + line
  ctx.strokeStyle = withAlpha(P.ink2.startsWith('#') ? P.ink2 : '#333333', 0.5); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(b.x + b.w / 2, b.y + b.h); ctx.lineTo(b.x + b.w / 2, pipeY - 6); ctx.stroke();
  ctx.fillStyle = P.bgElev || '#fff'; ctx.strokeStyle = P.lineStrong || '#999'; ctx.lineWidth = 1.2; rr(b.x + b.w / 2 - 17, b.y + b.h + 6, 34, 18, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = P.muted; ctx.font = '600 9px JetBrains Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText('1 : ' + r.F, b.x + b.w / 2, b.y + b.h + 18.5);
  // tank body
  const hasFe = t === 'A' && r.micro.Fe; const feCol = R.p.fe === 'EDDHA' ? '#7a2a14' : '#b8741f';
  const liqTop = b.y + b.h * (1 - level[t]);
  const lg = ctx.createLinearGradient(0, liqTop, 0, b.y + b.h);
  const base = t === 'A' ? (hasFe ? feCol : '#d8b56a') : '#8dbfe2';
  lg.addColorStop(0, withAlpha(base, t === 'A' ? 0.34 : 0.26)); lg.addColorStop(1, withAlpha(base, t === 'A' ? 0.55 : 0.42));
  ctx.save(); rr(b.x, b.y, b.w, b.h, 14); ctx.clip();
  ctx.fillStyle = withAlpha('#ffffff', 0.35); ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = lg; ctx.fillRect(b.x, liqTop, b.w, b.y + b.h - liqTop);
  // surface wave
  ctx.strokeStyle = withAlpha('#ffffff', 0.8); ctx.lineWidth = 1.5; ctx.beginPath();
  for (let x = 0; x <= b.w; x += 4) { const y = liqTop + Math.sin(x * 0.08 + tAnim * 3) * 1.5; x ? ctx.lineTo(b.x + x, y) : ctx.moveTo(b.x + x, y); } ctx.stroke();
  // ions
  const pl = parts[t];
  pl.forEach(q => { q.ph += dt * 2; q.vx += (rnd() - 0.5) * dt * 0.8; q.vy += (rnd() - 0.5) * dt * 0.8; q.vx *= 0.96; q.vy *= 0.96; q.x += q.vx * dt; q.y += q.vy * dt; if (q.x < 0.04 || q.x > 0.96) q.vx *= -1; if (q.y < 0.04 || q.y > 0.96) q.vy *= -1; q.x = Math.min(0.96, Math.max(0.04, q.x)); q.y = Math.min(0.96, Math.max(0.04, q.y));
    const px = b.x + q.x * b.w, py = liqTop + q.y * (b.y + b.h - liqTop - 6); ctx.fillStyle = ION_COL[q.ion] || '#888'; ctx.beginPath(); ctx.arc(px, py, q.ion === 'Fe' ? 3.2 : 2.3, 0, Math.PI * 2); ctx.fill(); });
  // precipitate: white flakes settling, sediment layer
  const fl = flakes[t];
  if (s && s.clash) { if (rnd() < dt * 30) fl.push({ x: b.x + 8 + rnd() * (b.w - 16), y: liqTop + 4, v: 8 + rnd() * 12, r: 1 + rnd() * 1.8 }); sediment[t] = Math.min(18, sediment[t] + dt * 1.2); }
  else sediment[t] = Math.max(0, sediment[t] - dt * 6);
  for (let i = fl.length - 1; i >= 0; i--) { const f = fl[i]; f.y += f.v * dt; f.x += Math.sin(f.y * 0.1) * 0.3; if (f.y > b.y + b.h - 4 - sediment[t] || !(s && s.clash)) { fl.splice(i, 1); continue; } ctx.fillStyle = 'rgba(250,250,245,0.95)'; ctx.fillRect(f.x, f.y, f.r * 2, f.r * 1.4); }
  if (sediment[t] > 0.5) { ctx.fillStyle = 'rgba(246,244,236,0.95)'; ctx.fillRect(b.x, b.y + b.h - sediment[t], b.w, sediment[t]); ctx.fillStyle = 'rgba(210,205,190,0.8)'; for (let x = 0; x < b.w; x += 7) ctx.fillRect(b.x + x, b.y + b.h - sediment[t] + ((x * 13) % 5), 3, 2); }
  // crystals when near/over solubility
  if (s && s.maxUse >= 95) { ctx.fillStyle = withAlpha('#dfe9f2', 0.95); ctx.strokeStyle = withAlpha('#7a93a8', 0.9); for (let k = 0; k < 7; k++) { const cx = b.x + 16 + k * (b.w - 32) / 6, cy = b.y + b.h - 6 - sediment[t]; ctx.beginPath(); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx + 6, cy - 3); ctx.lineTo(cx + 3, cy + 3); ctx.lineTo(cx - 5, cy + 2); ctx.lineTo(cx - 6, cy - 4); ctx.closePath(); ctx.fill(); ctx.stroke(); } }
  // stirrer
  ctx.strokeStyle = withAlpha(P.ink2.startsWith('#') ? P.ink2 : '#333333', 0.6); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(b.x + b.w * 0.78, b.y - 4); ctx.lineTo(b.x + b.w * 0.78, b.y + b.h * 0.8); ctx.stroke();
  const ang = tAnim * 7; ctx.beginPath(); ctx.ellipse(b.x + b.w * 0.78, b.y + b.h * 0.8, 12 * Math.abs(Math.cos(ang)), 3, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  // outline & graduations
  ctx.strokeStyle = P.lineStrong || '#999'; ctx.lineWidth = 1.6; rr(b.x, b.y, b.w, b.h, 14); ctx.stroke();
  ctx.fillStyle = P.muted; ctx.font = '500 9px JetBrains Mono, monospace'; ctx.textAlign = 'right';
  for (let i = 1; i < 5; i++) { const y = b.y + b.h * (1 - i / 5); ctx.strokeStyle = withAlpha(P.muted.startsWith('#') ? P.muted : '#888888', 0.5); ctx.beginPath(); ctx.moveTo(b.x + 1, y); ctx.lineTo(b.x + 9, y); ctx.stroke(); }
  // lid + motor
  ctx.fillStyle = P.bgElev || '#fff'; ctx.strokeStyle = P.lineStrong || '#999'; rr(b.x - 4, b.y - 12, b.w + 8, 12, 4); ctx.fill(); ctx.stroke();
  rr(b.x + b.w * 0.78 - 9, b.y - 26, 18, 14, 3); ctx.fill(); ctx.stroke();
  // big letter and volume
  ctx.fillStyle = t === 'A' ? '#b86e0b' : '#1c78a3'; ctx.font = '800 30px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(t, b.x + 10, b.y + 34);
  ctx.fillStyle = P.ink2; ctx.font = '600 10.5px Inter, sans-serif'; ctx.fillText(`${fmt(r.Vs, 0)} L · ${r.F}×`, b.x + 34, b.y + 30);
  // contents list
  const items = Object.entries(am).map(([k, a]) => { const f = N.FERTS[k]; if (f.acid) { const ml = acidMlPer1000(k, a) * r.Vs * r.F / 1000; return [k, SHORT[k].replace(' acid', ''), volStr(ml)]; } return [k, SHORT[k].replace('Monopotassium', 'Mono-K').replace('Magnesium', 'Mg').replace('Potassium', 'K').replace('Calcium', 'Ca').replace('Ammonium', 'NH₄').replace('Monoammonium', 'MAP'), massStr(a * f.Munit * r.Vs * r.F / 1000)]; });
  Object.entries(r.micro).forEach(([el, m]) => { if (r.microTank(el) === t && m.umol > 0) items.push(['micro', el + (el === 'Fe' ? ' chelate' : ''), massStr(m.gPer1000 * r.Vs * r.F / 1000)]); });
  ctx.font = '500 10px Inter, sans-serif';
  const lh = 13.5, y0 = Math.max(b.y + 44, b.y + b.h - 10 - items.length * lh);
  items.forEach(([k, name, m], i) => { const y = y0 + i * lh; ctx.fillStyle = withAlpha(P.bgElev.startsWith('#') ? P.bgElev : '#ffffff', 0.78); ctx.fillRect(b.x + 6, y - 10, b.w - 12, 12.5); ctx.fillStyle = SALT_COL[k] || '#999'; ctx.fillRect(b.x + 9, y - 7.5, 7, 7); ctx.fillStyle = P.ink; ctx.textAlign = 'left'; ctx.fillText(name.length > 18 ? name.slice(0, 17) + '…' : name, b.x + 20, y); ctx.textAlign = 'right'; ctx.font = '600 10px JetBrains Mono, monospace'; ctx.fillText(m, b.x + b.w - 9, y); ctx.font = '500 10px Inter, sans-serif'; });
  // warnings badge
  if (s && (s.clash || s.maxUse >= 100)) { ctx.fillStyle = '#c0392b'; rr(b.x + 6, b.y + b.h - 36 - items.length * lh, b.w - 12, 20, 6); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '700 10.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(s.clash ? (s.hasS ? '⚠ gypsum precipitates' : '⚠ Ca-phosphate forms') : '⚠ above solubility', b.x + b.w / 2, b.y + b.h - 22 - items.length * lh); }
}
function drawWorking(b, P, r, dt) {
  level.W += (0.72 - level.W) * dt;
  const liqTop = b.y + b.h * (1 - level.W);
  ctx.save(); rr(b.x, b.y, b.w, b.h, 16); ctx.clip();
  ctx.fillStyle = withAlpha('#ffffff', 0.3); ctx.fillRect(b.x, b.y, b.w, b.h);
  const lg = ctx.createLinearGradient(0, liqTop, 0, b.y + b.h); lg.addColorStop(0, 'rgba(120,190,170,0.28)'); lg.addColorStop(1, 'rgba(60,140,130,0.45)'); ctx.fillStyle = lg; ctx.fillRect(b.x, liqTop, b.w, b.y + b.h - liqTop);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); for (let x = 0; x <= b.w; x += 4) { const y = liqTop + Math.sin(x * 0.06 + tAnim * 2.4) * 1.8; x ? ctx.lineTo(b.x + x, y) : ctx.moveTo(b.x + x, y); } ctx.stroke();
  parts.W.forEach(q => { q.vx += (rnd() - 0.5) * dt * 0.6; q.vy += (rnd() - 0.5) * dt * 0.6; q.vx *= 0.96; q.vy *= 0.96; q.x += q.vx * dt; q.y += q.vy * dt; if (q.x < 0.03 || q.x > 0.97) q.vx *= -1; if (q.y < 0.04 || q.y > 0.96) q.vy *= -1; q.x = Math.min(0.97, Math.max(0.03, q.x)); q.y = Math.min(0.96, Math.max(0.04, q.y));
    ctx.fillStyle = ION_COL[q.ion] || '#888'; ctx.beginPath(); ctx.arc(b.x + q.x * b.w, liqTop + q.y * (b.y + b.h - liqTop - 4), 2.1, 0, Math.PI * 2); ctx.fill(); });
  ctx.restore();
  ctx.strokeStyle = P.lineStrong || '#999'; ctx.lineWidth = 1.6; rr(b.x, b.y, b.w, b.h, 16); ctx.stroke();
  ctx.fillStyle = P.ink2; ctx.font = '700 12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('Working solution', b.x + 12, b.y + 20);
  ctx.font = '500 10.5px Inter, sans-serif'; ctx.fillStyle = P.muted; ctx.fillText(`${fmt(r.Vw, 0)} L system · ${fmt(r.el.N, 0)} mg N L⁻¹`, b.x + 12, b.y + 35);
  // meters
  const meter = (x, y, lab, val, unit, ok) => { ctx.fillStyle = '#18221e'; rr(x, y, 92, 44, 8); ctx.fill(); ctx.fillStyle = ok ? '#8ef0b4' : '#ffb27a'; ctx.font = '600 9px JetBrains Mono, monospace'; ctx.textAlign = 'left'; ctx.fillText(lab, x + 8, y + 13); ctx.font = '700 17px JetBrains Mono, monospace'; ctx.fillText(val, x + 8, y + 34); ctx.font = '500 9px JetBrains Mono, monospace'; ctx.fillStyle = '#9fb8ab'; ctx.fillText(unit, x + 60, y + 34);
    ctx.strokeStyle = '#1b1f22'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x + 46, y + 44); ctx.bezierCurveTo(x + 46, y + 70, x + 46, b.y + 10, x + 46, b.y + 40); ctx.stroke(); ctx.fillStyle = '#26303a'; ctx.fillRect(x + 42, b.y + 38, 8, b.h * 0.45); };
  meter(b.x + b.w * 0.18, b.y - 58, 'EC 25 °C', fmt(r.ec.apha, 2), 'dS/m', Math.abs(r.ec.apha - r.recipe.ec * r.p.strength) < 0.3);
  meter(b.x + b.w * 0.62, b.y - 58, 'pH', fmt(r.phClosed, 2), r.phOpen.toFixed(1) + '*', r.phClosed >= 5.3 && r.phClosed <= 6.5);
  // charge balance gauge
  const gx = b.x + b.w - 30, gy = b.y + 50, gh = b.h - 70, tot = Math.max(r.bal.cat, r.bal.an) || 1;
  ctx.fillStyle = withAlpha('#b86e0b', 0.8); const hc = gh * r.bal.cat / tot; ctx.fillRect(gx, gy + gh - hc, 8, hc);
  ctx.fillStyle = withAlpha('#1c78a3', 0.8); const ha = gh * r.bal.an / tot; ctx.fillRect(gx + 10, gy + gh - ha, 8, ha);
  ctx.fillStyle = P.muted; ctx.font = '600 9px JetBrains Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText('+  −', gx + 9, gy + gh + 12);
}
requestAnimationFrame(frame);

/* ================================================================ mixing sheet + CSV */
function sheetHTML(r) {
  const p = r.p; const d = new Date().toISOString().slice(0, 10);
  const rows = []; ['A', 'B'].forEach(t => { Object.entries(r.tanks[t]).forEach(([k, a]) => { const f = N.FERTS[k]; rows.push([t, f.acid ? `${SHORT[k]} ${k === 'HNO3' ? p.hno3w : p.h3po4w} %` : SHORT[k], f.formula, f.acid ? volStr(acidMlPer1000(k, a) * r.Vs * r.F / 1000) : massStr(a * f.Munit * r.Vs * r.F / 1000), f.acid ? volStr(acidMlPer1000(k, a) * r.Vw / 1000) : massStr(a * f.Munit * r.Vw / 1000)]); }); Object.entries(r.micro).forEach(([el, m]) => { if (r.microTank(el) === t && m.umol > 0) rows.push([t, m.name, `${el} ${fmt(m.umol, 1)} µmol L⁻¹`, massStr(m.gPer1000 * r.Vs * r.F / 1000), massStr(m.gPer1000 * r.Vw / 1000)]); }); });
  const tgt = ION_KEYS.map(k => `<td>${fmt(r.target.ions[k], 2)}</td>`).join(''), ach = ION_KEYS.map(k => `<td>${fmt(r.sol[k], 2)}</td>`).join('');
  return `<header><h2>Mixing sheet — ${r.recipe.label}</h2><p>${d} · strength ${fmt(p.strength * 100, 0)} % · target pH ${fmt(p.tpH, 2)} · stock tanks ${fmt(r.Vs, 0)} L each at ${r.F}× (1 L A + 1 L B per ${r.F} L of water)</p></header>
  <h3>1 · Source water (mg L⁻¹)</h3><p>Ca ${fmt(r.water.Ca, 1)} · Mg ${fmt(r.water.Mg, 1)} · Na ${fmt(r.water.Na, 1)} · K ${fmt(r.water.K, 1)} · Cl ${fmt(r.water.Cl, 1)} · SO₄ ${fmt(r.water.SO4, 1)} · HCO₃ ${fmt(r.water.HCO3, 1)} · pH ${fmt(r.water.pH, 2)}</p>
  <h3>2 · Weigh and dissolve</h3><table><thead><tr><th>Tank</th><th>Fertiliser</th><th>Formula / content</th><th>Per stock tank</th><th>Direct: one ${fmt(r.Vw, 0)} L fill</th><th>✓</th></tr></thead><tbody>${rows.map(x => `<tr><td><b>${x[0]}</b></td><td>${x[1]}</td><td>${x[2]}</td><td><b>${x[3]}</b></td><td>${x[4]}</td><td>☐</td></tr>`).join('')}</tbody></table>
  <h3>3 · Expected working solution</h3><table><thead><tr><th></th>${ION_KEYS.map(k => `<th>${N.IONS[k].label}</th>`).join('')}</tr></thead><tbody><tr><th>Target (mmol L⁻¹)</th>${tgt}</tr><tr><th>Achieved</th>${ach}</tr></tbody></table>
  <p>EC ≈ <b>${fmt(r.ec.apha, 2)} dS m⁻¹</b> (Σ cations/10: ${fmt(r.ec.rule, 2)}) · pH ≈ <b>${fmt(r.phClosed, 2)}</b> after mixing, ≈ ${fmt(r.phOpen, 2)} after aeration · N ${fmt(r.el.N, 0)}, P ${fmt(r.el.P, 0)}, K ${fmt(r.el.K, 0)}, Ca ${fmt(r.el.Ca, 0)}, Mg ${fmt(r.el.Mg, 0)}, S ${fmt(r.el.S, 0)} mg L⁻¹</p>
  <h3>4 · Procedure and safety</h3><ol><li>Fill each tank three-quarters with water. Dissolve the salts one at a time, stirring, in the order listed; then fill to the mark (van der Lugt, 2016).</li><li>Tank A: calcium salts and the iron chelate. Tank B: phosphates, sulfates, micronutrient salts and acids. <b>Never mix the concentrates.</b></li><li>Acids: goggles and gloves; add acid to water, never water to acid. Keep tank A above pH 3.5 (chelates).</li><li>Dose equal volumes of A and B into the water; check EC and pH after 30 minutes of mixing and record them.</li></ol>
  <p class="small">Generated by the Future Food Production nutrient-solution mixer. Recipes are starting points; check your fertiliser labels (purity, hydration water, % Fe) and verify with a laboratory analysis.</p>`;
}
function openSheet() { $('sheet-body').innerHTML = sheetHTML(R); const dlg = $('mix-sheet'); if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
$('sheet-close').addEventListener('click', () => $('mix-sheet').close());
$('sheet-print').addEventListener('click', () => { document.documentElement.classList.add('nm-printing'); window.print(); });
window.addEventListener('afterprint', () => document.documentElement.classList.remove('nm-printing'));
function csv() {
  const r = R, rows = [];
  ['A', 'B'].forEach(t => { Object.entries(r.tanks[t]).forEach(([k, a]) => { const f = N.FERTS[k]; rows.push([t, SHORT[k], f.formula, +a.toFixed(4), f.acid ? +(acidMlPer1000(k, a)).toFixed(1) : +(a * f.Munit).toFixed(2), f.acid ? 'mL' : 'g', f.acid ? +(acidMlPer1000(k, a) * r.Vs * r.F / 1000).toFixed(1) : +(a * f.Munit * r.Vs * r.F / 1000).toFixed(2)]); }); });
  Object.entries(r.micro).forEach(([el, m]) => rows.push([r.microTank(el), m.name, el, +(m.umol / 1000).toFixed(5), +m.gPer1000.toFixed(3), 'g', +(m.gPer1000 * r.Vs * r.F / 1000).toFixed(3)]));
  downloadCSV('nutrient-recipe.csv', ['tank', 'fertiliser', 'formula', 'mmol_per_L_solution', 'per_1000_L_solution', 'unit', `per_stock_tank_${r.Vs}L_${r.F}x`], rows);
}

/* ================================================================ wiring */
function update() { const r = compute(); updateReadouts(r); $('recipe-table').innerHTML = tableHTML(r); updateCharts(r); targetParticles(r); }
let raf = 0; ui.onChange(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
update();
