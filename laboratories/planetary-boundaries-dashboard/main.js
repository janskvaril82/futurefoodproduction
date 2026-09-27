/* Planetary boundaries dashboard — food-system scenario model for 2050.
   Core model: multilinear interpolation in the published 3 x 3 x 3 x 3 scenario grid of Springmann et al. (2018)
   (diet x technology x loss-and-waste x socio-economic pathway; world totals from the authors' ORA data set),
   per-capita scaling with population, and two optional, transparently parameterised what-if levers
   (alternative proteins, CEA vegetables). Equations PB1-PB7 in the Derive tab. */
import { Controls, Readouts, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { BarChart, downloadCSV } from '/assets/js/plot.js';
import { palette, withAlpha } from '/assets/js/colors.js';
import { SPR } from './data.js';

/* ------------------------------------------------------------ constants */
const IND = [
  { id: 'ghg', short: 'GHG', name: 'Greenhouse-gas emissions (CH₄ + N₂O)', unit: 'Gt CO₂e yr⁻¹', dig: 2 },
  { id: 'land', short: 'Cropland', name: 'Cropland use', unit: 'million km²', dig: 1 },
  { id: 'water', short: 'Bluewater', name: 'Bluewater (irrigation) use', unit: 'km³ yr⁻¹', dig: 0 },
  { id: 'n', short: 'Nitrogen', name: 'Nitrogen fertiliser application', unit: 'Tg N yr⁻¹', dig: 0 },
  { id: 'p', short: 'Phosphorus', name: 'Phosphorus fertiliser application', unit: 'Tg P yr⁻¹', dig: 1 }
];
const BOUNDS = {
  springmann: { label: 'Springmann et al. 2018', c: [4.7, 12.6, 1980, 69, 16], lo: [4.3, 10.6, 780, 52, 8], hi: [5.3, 14.6, 3190, 113, 17] },
  eat: { label: 'EAT–Lancet 2019', c: [5, 13, 2500, 90, 8], lo: null, hi: null }
};
const POP = { SSP1: 8.479, SSP2: 9.187, SSP3: 9.975 };           // billion, 2050 (Springmann et al. 2018, Suppl. Table 1)
const POP2010 = 6.879;
/* vegetables and fruit (temperate + tropical + starchy) in g cap⁻¹ d⁻¹ (Springmann et al. 2018, Suppl. Table 2) */
const DIETFV = { BAU: [327.8, 180.4], HGD: [327.8, 265.2], FLX: [405.4, 208.7] };
const GROUPS = ['Staples', 'Legumes', 'Nuts & seeds', 'Fruit & veg', 'Vegetable oils', 'Sugar', 'Animal products', 'Other crops', 'Alternative proteins', 'CEA electricity'];
const GCOL = ['#e0b43c', '#8e5cc2', '#d9824b', '#3fae62', '#3b8fd0', '#9aa3ad', '#9c5a3c', '#5b6b82', '#c95fa8', '#f4d35e'];
const STAT_COL = ['#1a9850', '#91cf60', '#fc8d59', '#d73027'];
const STAT_TXT = ['below the lower end of the boundary range', 'within the boundary range, below its central value', 'above the central boundary, within its range', 'beyond the boundary range'];
const TECH = ['BMK', 'TECH', 'TECH_p'], TN = [0, 0.5, 1];
const WASTE = ['full_w', 'half_w', 'quart_w'], WN = [0, 0.5, 0.75];
const LEVERS = [
  { id: 'waste', label: 'Less loss & waste', col: '#3b8fd0' },
  { id: 'tech', label: 'Technology & management', col: '#e0b43c' },
  { id: 'diet', label: 'Diet shift', col: '#3fae62' },
  { id: 'alt', label: 'Alternative proteins', col: '#c95fa8' },
  { id: 'cea', label: 'CEA vegetables', col: '#f4d35e' }
];
/* Richardson et al. (2023) Science Advances 9: eadh2458, Table 1 (H = Holocene base, PB = boundary, U = upper end of zone of increasing risk, x = current). */
const EARTH = [
  { proc: 'Climate change', sub: 'CO₂ concentration', H: 280, PB: 350, U: 450, x: 417, unit: 'ppm', food: true },
  { proc: 'Climate change', sub: 'Radiative forcing', H: 0, PB: 1.0, U: 1.5, x: 2.91, unit: 'W m⁻²', food: true },
  { proc: 'Biosphere integrity', sub: 'Genetic (extinctions)', H: 1, PB: 10, U: 100, x: 100, gt: true, unit: 'E/MSY', food: true },
  { proc: 'Biosphere integrity', sub: 'Functional (HANPP)', H: 1.9, PB: 10, U: 20, x: 30, unit: '% of NPP', food: true },
  { proc: 'Land-system change', sub: 'Forest cover', H: 100, PB: 75, U: 54, x: 60, unit: '% of original', food: true },
  { proc: 'Freshwater change', sub: 'Blue water', H: 9.4, PB: 10.2, U: 50, x: 18.2, unit: '% land deviating', food: true },
  { proc: 'Freshwater change', sub: 'Green water', H: 9.8, PB: 11.1, U: 50, x: 15.8, unit: '% land deviating', food: true },
  { proc: 'Biogeochemical flows', sub: 'Nitrogen fixation', H: 0, PB: 62, U: 82, x: 190, unit: 'Tg N yr⁻¹', food: true },
  { proc: 'Biogeochemical flows', sub: 'Phosphorus (regional)', H: 0, PB: 6.2, U: 11.2, x: 17.5, unit: 'Tg P yr⁻¹', food: true },
  { proc: 'Biogeochemical flows', sub: 'Phosphorus (global)', H: 0, PB: 11, U: 100, x: 22.6, unit: 'Tg P yr⁻¹', food: true },
  { proc: 'Ocean acidification', sub: 'Aragonite saturation', H: 3.44, PB: 2.75, U: null, x: 2.8, unit: 'Ω aragonite', food: false },
  { proc: 'Aerosol loading', sub: 'Interhemispheric AOD', H: 0.03, PB: 0.1, U: 0.25, x: 0.076, unit: 'AOD difference', food: false },
  { proc: 'Ozone depletion', sub: 'Stratospheric O₃', H: 290, PB: 276, U: 261, x: 284.6, unit: 'DU', food: false },
  { proc: 'Novel entities', sub: 'Untested chemicals', H: 0, PB: 0, U: null, x: null, unit: '', food: false }
];

/* ------------------------------------------------------------ model */
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function bracket(nodes, x) {
  x = clamp(x, nodes[0], nodes[nodes.length - 1]);
  let i = 0; while (i < nodes.length - 2 && x > nodes[i + 1]) i++;
  const f = (x - nodes[i]) / (nodes[i + 1] - nodes[i]);
  return [i, clamp(f, 0, 1)];
}
/** Multilinear interpolation in the scenario grid (Eq. PB2). Returns 9 arrays (total + 8 groups) x 5 indicators. */
function gridInterp(ssp, dietT, s, t, w) {
  const [ti, tf] = bracket(TN, t), [wi, wf] = bracket(WN, w);
  const out = Array.from({ length: 9 }, () => [0, 0, 0, 0, 0]);
  const dn = s > 0 ? [['BAU', 1 - s], [dietT, s]] : [['BAU', 1]];
  for (const [d, dw] of dn) for (const [ii, iw] of [[ti, 1 - tf], [ti + 1, tf]]) for (const [jj, jw] of [[wi, 1 - wf], [wi + 1, wf]]) {
    const wgt = dw * iw * jw; if (wgt <= 1e-9) continue;
    const g = SPR[`${ssp}|${d}|${WASTE[jj]}|${TECH[ii]}`];
    for (let r = 0; r < 9; r++) for (let k = 0; k < 5; k++) out[r][k] += wgt * g[r][k];
  }
  return out;
}
/** Full scenario: grid + population scaling (PB3) + alternative proteins (PB4) + CEA vegetables (PB5). */
function scenario(p, mask = null) {
  const on = id => !mask || mask.has(id);
  const s = on('diet') ? p.diet / 100 : 0, t = on('tech') ? p.tech / 100 : 0, w = on('waste') ? p.waste / 100 : 0;
  const g = gridInterp(p.ssp, p.dietT, s, t, w);
  const scale = p.pop / POP[p.ssp];
  const groups = g.slice(1).map(a => a.map(v => v * scale));        // 8 groups
  const alt = [0, 0, 0, 0, 0], cea = [0, 0, 0, 0, 0];
  if (on('alt') && p.alt > 0) {
    const a = p.alt / 100, rho = p.altRes / 100;
    for (let k = 0; k < 5; k++) { const A = groups[6][k]; alt[k] = a * rho * A; groups[6][k] = (1 - a) * A; }
  }
  let twh = 0, co2 = 0;
  if (on('cea') && p.cea > 0) {
    const c = p.cea / 100, sv = p.ceaSave / 100;
    const veg = (1 - s) * DIETFV.BAU[0] + s * DIETFV[p.dietT][0], fruit = (1 - s) * DIETFV.BAU[1] + s * DIETFV[p.dietT][1];
    const vf = veg / (veg + fruit);
    for (let k = 0; k < 5; k++) groups[3][k] -= c * vf * groups[3][k] * sv;
    const massKg = veg / 1000 * p.pop * 1e9 * 365 * c;             // kg of vegetables per year grown in CEA
    twh = massKg * p.ceaKwh / 1e9;                                    // TWh yr⁻¹
    co2 = massKg * p.ceaKwh * p.grid / 1e12;                         // Gt CO2 yr⁻¹
    if (p.countEnergy) cea[0] = co2;
  }
  groups.push(alt, cea);
  const tot = [0, 1, 2, 3, 4].map(k => groups.reduce((acc, a) => acc + a[k], 0));
  return { tot, groups, twh, co2 };
}
const bauOf = p => scenario(Object.assign({}, p, { diet: 0, tech: 0, waste: 0, alt: 0, cea: 0 }));
function status(k, v, set) {
  const B = BOUNDS[set];
  if (!B.lo) return v <= B.c[k] ? 1 : 3;
  return v < B.lo[k] ? 0 : v <= B.c[k] ? 1 : v <= B.hi[k] ? 2 : 3;
}
/** Shapley decomposition of the change from BAU into lever contributions (Eq. PB6). */
function shapley(p) {
  const ids = LEVERS.map(l => l.id), n = ids.length, cache = new Map();
  const V = m => { const key = m.join(''); if (!cache.has(key)) cache.set(key, scenario(p, new Set(ids.filter((_, i) => m[i]))).tot); return cache.get(key); };
  const fact = [1, 1, 2, 6, 24, 120];
  const phi = ids.map(() => [0, 0, 0, 0, 0]);
  for (let S = 0; S < (1 << n); S++) {
    const m = ids.map((_, i) => (S >> i) & 1), size = m.reduce((a, b) => a + b, 0);
    for (let i = 0; i < n; i++) if (!m[i]) {
      const w = fact[size] * fact[n - size - 1] / fact[n];
      const m2 = m.slice(); m2[i] = 1;
      const a = V(m), b = V(m2);
      for (let k = 0; k < 5; k++) phi[i][k] += w * (b[k] - a[k]);
    }
  }
  return phi;   // negative = reduction
}

/* ------------------------------------------------------------ UI */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
IND.forEach(d => ro.add({ id: d.id, label: d.name, unit: d.unit, digits: d.dig }));
ro.add({ id: 'safe', label: 'Boundaries respected', unit: 'of 5', digits: 0 })
  .add({ id: 'pop', label: 'Population in 2050', unit: 'billion', digits: 2 })
  .add({ id: 'twh', label: 'CEA electricity demand', unit: 'TWh yr⁻¹', digits: 0 });

ui.section('Socio-economic pathway');
ui.segmented({ id: 'ssp', label: 'Pathway (population + income)', options: [{ value: 'SSP1', label: 'SSP1' }, { value: 'SSP2', label: 'SSP2' }, { value: 'SSP3', label: 'SSP3' }], value: 'SSP2', help: 'SSP1 sustainability (8.5 bn, richer) · SSP2 middle of the road (9.2 bn) · SSP3 regional rivalry (10.0 bn, poorer)', onChange: v => ui.set('pop', POP[v]) });
ui.slider({ id: 'pop', label: 'World population 2050', min: 7.5, max: 11, step: 0.01, value: 9.19, unit: 'bn', help: 'Scales the pathway’s per-capita pressures (Eq. PB3). UN WPP 2024 medium variant ≈ 9.7 bn.' });
ui.section('Levers (Springmann et al. 2018)');
ui.segmented({ id: 'dietT', label: 'Target diet', options: [{ value: 'FLX', label: 'Flexitarian (EAT–Lancet-type)' }, { value: 'HGD', label: 'Dietary guidelines' }], value: 'FLX' });
ui.slider({ id: 'diet', label: 'Diet shift towards target', min: 0, max: 100, step: 1, value: 0, unit: '%', help: 'Share of the world population that adopts the target diet' });
ui.slider({ id: 'tech', label: 'Technology & management', min: 0, max: 100, step: 1, value: 0, unit: '%', help: '0 = business as usual · 50 = TECH (medium ambition) · 100 = TECH+ (high ambition): yield gaps, N- and P-use efficiency, irrigation efficiency, lower emission intensities' });
ui.slider({ id: 'waste', label: 'Food loss & waste reduction', min: 0, max: 75, step: 1, value: 0, unit: '%', help: '50 % = halving (waste/2) · 75 % = reduction to a quarter (waste/4)' });
ui.section('What-if levers (illustrative)');
ui.slider({ id: 'alt', label: 'Animal products replaced by alternative proteins', min: 0, max: 60, step: 1, value: 0, unit: '%' });
ui.slider({ id: 'altRes', label: 'Residual pressure of alternatives', min: 5, max: 60, step: 1, value: 20, unit: '% of replaced', help: 'Default 20 %: diet studies report > 80 % lower GWP, land and water use when animal foods are replaced by novel foods (Mazac et al. 2022); N and P assumed alike.' });
ui.slider({ id: 'cea', label: 'Vegetables grown in CEA (vertical farms)', min: 0, max: 50, step: 1, value: 0, unit: '%' });
ui.slider({ id: 'ceaSave', label: 'CEA saving of cropland, water, N, P', min: 0, max: 100, step: 1, value: 80, unit: '%', help: 'Per kg, relative to field vegetables (illustrative).' });
ui.slider({ id: 'ceaKwh', label: 'CEA electricity use', min: 2, max: 25, step: 0.5, value: 10, unit: 'kWh kg⁻¹', help: 'Illustrative default; plant factories are dominated by lighting and HVAC.' });
ui.slider({ id: 'grid', label: 'Grid carbon intensity', min: 0, max: 1, step: 0.01, value: 0.47, unit: 'kg CO₂ kWh⁻¹', help: 'World 2024 ≈ 0.47 (Ember 2025: 14.6 Gt CO₂ / 30 800 TWh); low-carbon grids ≈ 0.05' });
ui.toggle({ id: 'countEnergy', label: 'Count CEA electricity CO₂ in the GHG pressure', value: true });
ui.section('Display');
ui.segmented({ id: 'bset', label: 'Boundary set', options: [{ value: 'springmann', label: 'Springmann 2018' }, { value: 'eat', label: 'EAT–Lancet 2019' }], value: 'springmann' });
ui.segmented({ id: 'mode', label: 'Flower', options: [{ value: 'food', label: 'Food system 2050' }, { value: 'earth', label: 'Earth system 2023' }], value: 'food' });
ui.toggle({ id: 'groups', label: 'Show food-group composition in petals', value: true });
ui.toggle({ id: 'ghosts', label: 'Show 2010 and BAU-2050 outlines', value: true });
const base0 = { ssp: 'SSP2', pop: 9.19, alt: 0, cea: 0 };
ui.presets([
  { label: 'BAU 2050', values: Object.assign({}, base0, { diet: 0, tech: 0, waste: 0 }) },
  { label: 'Diet only', values: Object.assign({}, base0, { dietT: 'FLX', diet: 100, tech: 0, waste: 0 }) },
  { label: 'Tech only', values: Object.assign({}, base0, { diet: 0, tech: 100, waste: 0 }) },
  { label: 'Waste only', values: Object.assign({}, base0, { diet: 0, tech: 0, waste: 75 }) },
  { label: 'All combined (medium)', values: Object.assign({}, base0, { dietT: 'HGD', diet: 100, tech: 50, waste: 50 }) },
  { label: 'All combined (high)', values: Object.assign({}, base0, { dietT: 'FLX', diet: 100, tech: 100, waste: 75 }) },
  { label: 'Techno-fix', values: Object.assign({}, base0, { diet: 0, tech: 100, waste: 0, alt: 30, cea: 20 }) }
]);
ui.saveButton('planetary-boundaries-dashboard', () => ro.values());
ui.button({ label: 'Download scenario (CSV)', onClick: () => {
  const p = ui.values(), S = scenario(p), B = BOUNDS[p.bset], R = SPR.REF[0], U = bauOf(p).tot;
  downloadCSV('food-system-scenario.csv', ['indicator', 'unit', 'y2010', 'bau2050', 'scenario2050', 'boundary', 'scenario_x_boundary'],
    IND.map((d, k) => [d.name, d.unit, R[k], +U[k].toPrecision(4), +S.tot[k].toPrecision(4), B.c[k], +(S.tot[k] / B.c[k]).toFixed(3)]));
} });

/* ------------------------------------------------------------ flower (canvas) */
const stageEl = document.getElementById('stage');
const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Planetary flower: each petal is one environmental pressure relative to its boundary');
stageEl.appendChild(cv);
const tip = document.createElement('div'); tip.className = 'pb-tip'; stageEl.appendChild(tip);
const hud = hudChips(stageEl);
const legend = document.createElement('div'); legend.className = 'pb-legend'; stageEl.after(legend);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'planetary-flower.png'; a.click(); } });
const ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const stars = Array.from({ length: 220 }, (_, i) => { const r = Math.sin(i * 12.9898) * 43758.5453; const f = r - Math.floor(r); const r2 = Math.sin(i * 78.233) * 12345.678; const g = r2 - Math.floor(r2); return [f, g, 0.3 + ((i * 37) % 10) / 14, (i % 7) / 7]; });
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = stageEl.clientWidth; H = stageEl.clientHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  kick();
}
new ResizeObserver(resize).observe(stageEl);

/* animated display state */
const disp = { food: null, earth: null };
let target = null, raf = 0, visible = true, tAnim = 0, lastT = 0;
new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) kick(); }).observe(stageEl);
function kick() { clearTimeout(ambient); if (!raf) raf = requestAnimationFrame(frame); }
function frame(now) {
  raf = 0;
  if (!visible || !target || !W) return;
  const dt = Math.min(0.05, (now - (lastT || now)) / 1000); lastT = now; tAnim += dt;
  let moving = false;
  const k = 1 - Math.exp(-dt * 7);
  const l1 = (a, b) => { if (a == null || !isFinite(a)) return b; const nv = a + (b - a) * k; if (Math.abs(nv - b) > 1e-3 * Math.max(0.05, Math.abs(b))) moving = true; return nv; };
  disp.food = target.food.map((pt, i) => { const o = disp.food && disp.food[i]; return { x: l1(o && o.x, pt.x), parts: pt.parts.map((v, j) => l1(o && o.parts[j], v)) }; });
  draw();
  if (moving) raf = requestAnimationFrame(frame);
  else ambient = setTimeout(() => { lastT = performance.now(); kick(); }, 60);   // slow ambient twinkle (~16 fps) when idle
}
let ambient = 0;

function polar(cx, cy, r, a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
function sector(c, cx, cy, r0, r1, a0, a1) {
  c.beginPath(); c.arc(cx, cy, r1, a0, a1); c.arc(cx, cy, r0, a1, a0, true); c.closePath();
}
let hitZones = [];
function draw() {
  const c = ctx; c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, W, H);
  // background: deep space gradient + stars
  const bg = c.createRadialGradient(W * 0.5, H * 0.5, 10, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
  bg.addColorStop(0, '#12231d'); bg.addColorStop(1, '#050a08'); c.fillStyle = bg; c.fillRect(0, 0, W, H);
  stars.forEach(([x, y, s, ph]) => { c.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(tAnim * 0.8 + ph * 6.28)); c.fillStyle = '#cfe8dc'; c.fillRect(x * W, y * H, s, s); });
  c.globalAlpha = 1;
  const p = ui.values();
  if (p.mode === 'earth') drawEarth(c, p); else drawFood(c, p);
}
function geometry(nLabels) {
  const cx = W * 0.5, cy = H * 0.5 + 14;
  const Rmax = Math.min(W * 0.5 - (W < 560 ? 70 : 150), H * 0.5 - 60);
  const R0 = Math.max(26, Rmax * 0.16);
  return { cx, cy, Rmax, R0 };
}
function drawCore(c, cx, cy, R0, label) {
  const g = c.createRadialGradient(cx - R0 * 0.35, cy - R0 * 0.35, R0 * 0.1, cx, cy, R0);
  g.addColorStop(0, '#6fb7e6'); g.addColorStop(0.55, '#1f5f8f'); g.addColorStop(1, '#0a2238');
  c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R0 * 0.92, 0, 7); c.fill();
  // stylised continents
  c.save(); c.beginPath(); c.arc(cx, cy, R0 * 0.92, 0, 7); c.clip();
  c.fillStyle = 'rgba(111,190,120,.75)';
  [[-0.3, -0.2, 0.34, 0.22], [0.25, 0.15, 0.28, 0.38], [0.1, -0.45, 0.22, 0.12], [-0.45, 0.35, 0.18, 0.2]].forEach(([x, y, a, b]) => { c.beginPath(); c.ellipse(cx + x * R0, cy + y * R0, a * R0, b * R0, x, 0, 7); c.fill(); });
  c.restore();
  c.strokeStyle = 'rgba(160,230,255,.45)'; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, R0 * 0.95, 0, 7); c.stroke();
  c.fillStyle = '#fff'; c.font = `700 ${Math.max(11, R0 * 0.3)}px Inter, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(label, cx, cy);
}
function drawFood(c, p) {
  const { cx, cy, Rmax, R0 } = geometry();
  const XMAX = 2.6, rOf = x => R0 + (Rmax - R0) * Math.min(x, XMAX) / XMAX;
  const B = BOUNDS[p.bset];
  const n = 5, gap = 0.15, span = 2 * Math.PI / n, aLab = -Math.PI / 2 + span / 2;
  // grid rings, labelled along the empty gap between the first two petals
  c.lineWidth = 1; c.font = '500 10.5px "JetBrains Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
  [0.5, 1.5, 2, 2.5].forEach(x => {
    c.strokeStyle = 'rgba(200,230,215,.10)'; c.setLineDash([2, 5]); c.beginPath(); c.arc(cx, cy, rOf(x), 0, 7); c.stroke(); c.setLineDash([]);
    const [tx, ty] = polar(cx, cy, rOf(x), aLab); c.fillStyle = 'rgba(200,230,215,.5)'; c.fillText(x + '×', tx, ty);
  });
  // safe operating space
  const rb = rOf(1);
  const safe = c.createRadialGradient(cx, cy, R0, cx, cy, rb);
  safe.addColorStop(0, 'rgba(46,160,90,0.03)'); safe.addColorStop(1, 'rgba(46,160,90,0.24)');
  c.fillStyle = safe; c.beginPath(); c.arc(cx, cy, rb, 0, 7); c.arc(cx, cy, R0, 0, 7, true); c.fill();
  hitZones = [];
  const R10 = SPR.REF[0], BAU = target.bau;
  const geo = disp.food.map((pt, k) => {
    const a0 = -Math.PI / 2 + k * span - span / 2 + gap, a1 = a0 + span - 2 * gap, am = (a0 + a1) / 2;
    return { pt, k, a0, a1, am, st: status(k, pt.x * B.c[k], p.bset), r: rOf(pt.x) };
  });
  // petals
  geo.forEach(({ pt, k, a0, a1, am, st, r }) => {
    const col = STAT_COL[st];
    c.save(); c.shadowColor = col; c.shadowBlur = st === 3 ? 22 + 8 * Math.sin(tAnim * 3) : 12;
    const gr0 = c.createRadialGradient(cx, cy, R0, cx, cy, Math.max(r, R0 + 1));
    gr0.addColorStop(0, withAlpha(col, 0.2)); gr0.addColorStop(1, withAlpha(col, 0.9));
    c.fillStyle = gr0; sector(c, cx, cy, R0, r, a0, a1); c.fill(); c.restore();
    if (p.groups) {   // food-group composition as an inner fan
      let acc = 0; const tot = pt.parts.reduce((a, b) => a + Math.max(0, b), 0) || 1;
      const ai0 = a0 + 0.035, ai1 = a1 - 0.035, rIn = R0 + (r - R0) * 0.985;
      pt.parts.forEach((v, gi) => {
        if (v <= 0) return;
        const ra = R0 + (rIn - R0) * acc / tot, rb2 = R0 + (rIn - R0) * (acc + v) / tot; acc += v;
        c.fillStyle = withAlpha(GCOL[gi], 0.92); sector(c, cx, cy, ra, rb2, ai0, ai1); c.fill();
        if (rb2 - ra > 1.5) { c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 0.8; c.beginPath(); c.arc(cx, cy, rb2, ai0, ai1); c.stroke(); }
      });
    }
    c.strokeStyle = col; c.lineWidth = 3.2; c.beginPath(); c.arc(cx, cy, r, a0, a1); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 1; sector(c, cx, cy, R0, r, a0, a1); c.stroke();
    if (pt.x > XMAX) { // overflow arrow
      c.fillStyle = col; c.beginPath(); c.moveTo(...polar(cx, cy, r + 18, am)); c.lineTo(...polar(cx, cy, r + 4, am - 0.05)); c.lineTo(...polar(cx, cy, r + 4, am + 0.05)); c.fill();
    }
  });
  // boundary uncertainty band and boundary ring on top of the petals
  geo.forEach(({ k, a0, a1 }) => {
    if (!B.lo) return;
    c.fillStyle = 'rgba(255,214,120,.16)'; sector(c, cx, cy, rOf(B.lo[k] / B.c[k]), rOf(B.hi[k] / B.c[k]), a0 - 0.05, a1 + 0.05); c.fill();
  });
  const pulse = 0.6 + 0.3 * Math.sin(tAnim * 1.6);
  c.save(); c.shadowColor = '#6fd39a'; c.shadowBlur = 8;
  c.strokeStyle = `rgba(140,235,175,${pulse})`; c.lineWidth = 2.4; c.setLineDash([7, 5]); c.beginPath(); c.arc(cx, cy, rb, 0, 7); c.stroke(); c.setLineDash([]); c.restore();
  const [bx, by] = polar(cx, cy, rb + 12, aLab); c.fillStyle = '#9be7b6'; c.font = '650 11px Inter, system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('boundary', bx + 4, by);
  // ghosts and labels
  geo.forEach(({ pt, k, a0, a1, am, st, r }) => {
    const col = STAT_COL[st];
    if (p.ghosts) {
      c.lineWidth = 1.8;
      c.strokeStyle = 'rgba(255,255,255,.9)'; c.setLineDash([2, 3]); c.beginPath(); c.arc(cx, cy, rOf(R10[k] / B.c[k]), a0 + 0.02, a1 - 0.02); c.stroke();
      c.strokeStyle = 'rgba(255,150,100,.95)'; c.setLineDash([8, 4]); c.beginPath(); c.arc(cx, cy, rOf(BAU[k] / B.c[k]), a0 + 0.02, a1 - 0.02); c.stroke(); c.setLineDash([]);
    }
    const lr = Rmax + 18, [lx, ly] = polar(cx, cy, lr, am);
    c.textAlign = Math.cos(am) > 0.25 ? 'left' : Math.cos(am) < -0.25 ? 'right' : 'center';
    c.textBaseline = 'middle';
    const dy = Math.sin(am) > 0.3 ? 10 : Math.sin(am) < -0.3 ? -10 : 0;
    c.fillStyle = '#e6eee9'; c.font = '650 13.5px Inter, system-ui, sans-serif';
    c.fillText(IND[k].short, lx, ly + dy - 8);
    c.font = '600 11.5px "JetBrains Mono", monospace'; c.fillStyle = col;
    c.fillText(`${fmt(pt.x * B.c[k], IND[k].dig)} · ${fmt(pt.x, 2)}×`, lx, ly + dy + 8);
    hitZones.push({ k, a0, a1, r0: R0, r1: Math.max(r, rOf(1)) });
  });
  drawCore(c, cx, cy, R0, '2050');
}
function earthQ(e) {
  if (e.x == null) return 2.5;
  const q1 = (e.x - e.H) / (e.PB - e.H);
  if (q1 <= 1) return Math.max(0.02, q1);
  if (e.U == null) return q1;
  const q2 = (e.x - e.PB) / (e.U - e.PB);
  if (q2 <= 1) return 1 + q2;
  return 2 + Math.log10(q2);
}
function drawEarth(c, p) {
  const g0 = geometry(), cx = g0.cx, cy = g0.cy + H * 0.035, Rmax = g0.Rmax * 0.9, R0 = g0.R0;
  const QMAX = 3.2, rOf = q => R0 + (Rmax - R0) * Math.min(q, QMAX) / QMAX;
  // zones
  const rb = rOf(1), ru = rOf(2);
  c.fillStyle = 'rgba(46,160,90,.18)'; c.beginPath(); c.arc(cx, cy, rb, 0, 7); c.arc(cx, cy, R0, 0, 7, true); c.fill();
  const zr = c.createRadialGradient(cx, cy, rb, cx, cy, ru); zr.addColorStop(0, 'rgba(240,200,80,.10)'); zr.addColorStop(1, 'rgba(230,120,60,.16)');
  c.fillStyle = zr; c.beginPath(); c.arc(cx, cy, ru, 0, 7); c.arc(cx, cy, rb, 0, 7, true); c.fill();
  c.strokeStyle = 'rgba(111,211,154,.8)'; c.lineWidth = 2; c.setLineDash([7, 5]); c.beginPath(); c.arc(cx, cy, rb, 0, 7); c.stroke();
  c.strokeStyle = 'rgba(255,120,90,.55)'; c.beginPath(); c.arc(cx, cy, ru, 0, 7); c.stroke(); c.setLineDash([]);
  const n = EARTH.length, span = 2 * Math.PI / n, gap = 0.045;
  hitZones = [];
  let lastProc = '';
  EARTH.forEach((e, i) => {
    const a0 = -Math.PI / 2 + i * span + gap, a1 = a0 + span - 2 * gap, am = (a0 + a1) / 2;
    const q = earthQ(e), r = rOf(q);
    const col = e.x == null ? '#8e7cc3' : q <= 1 ? '#3fbf6f' : q <= 2 ? `hsl(${45 - 30 * (q - 1)},90%,55%)` : '#e0453a';
    c.save(); c.shadowColor = col; c.shadowBlur = 12;
    const gr = c.createRadialGradient(cx, cy, R0, cx, cy, r); gr.addColorStop(0, withAlpha(col.startsWith('#') ? col : '#f0a040', 0.25)); gr.addColorStop(1, col.startsWith('hsl') ? col : withAlpha(col, 0.95));
    c.fillStyle = gr; sector(c, cx, cy, R0, r, a0, a1); c.fill(); c.restore();
    if (e.x == null) { // hatch: not quantified
      c.save(); sector(c, cx, cy, R0, r, a0, a1); c.clip(); c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1;
      for (let d = -Rmax; d < Rmax; d += 7) { c.beginPath(); c.moveTo(cx + d, cy - Rmax); c.lineTo(cx + d + Rmax, cy + Rmax); c.stroke(); } c.restore();
    }
    if (e.gt) { c.fillStyle = col; c.beginPath(); c.moveTo(...polar(cx, cy, r + 14, am)); c.lineTo(...polar(cx, cy, r + 3, am - 0.06)); c.lineTo(...polar(cx, cy, r + 3, am + 0.06)); c.fill(); }
    if (e.food) { const [fx, fy] = polar(cx, cy, R0 + 9, am); c.fillStyle = '#f4d35e'; c.beginPath(); c.arc(fx, fy, 3.2, 0, 7); c.fill(); }
    const lr = Rmax + 12, [lx, ly] = polar(cx, cy, lr, am);
    c.textAlign = Math.cos(am) > 0.2 ? 'left' : Math.cos(am) < -0.2 ? 'right' : 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#e6eee9'; c.font = '600 11.5px Inter, system-ui, sans-serif';
    c.fillText(e.sub, lx, ly - 7);
    c.font = '500 10.5px "JetBrains Mono", monospace'; c.fillStyle = col.startsWith('hsl') ? col : col;
    c.fillText(e.x == null ? 'not quantified' : `${e.gt ? '>' : ''}${e.x} ${e.unit}`, lx, ly + 7);
    hitZones.push({ e, a0, a1, r0: R0, r1: Math.max(r, rb) });
    lastProc = e.proc;
  });
  // zone labels on top of the petals, in the gap between the last and the first petal
  c.save(); c.font = '650 11px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.lineWidth = 3.5; c.strokeStyle = 'rgba(5,10,8,.85)';
  [[rb, '#9be7b6', 'boundary'], [ru, '#ffab8f', 'high risk']].forEach(([rr, col, txt]) => { const [tx, ty] = polar(cx, cy, rr, -Math.PI / 2 - 0.02); c.strokeText(txt, tx, ty); c.fillStyle = col; c.fillText(txt, tx, ty); });
  c.restore();
  drawCore(c, cx, cy, R0, '2023');
}
/* hover tooltip */
cv.addEventListener('pointermove', ev => {
  const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
  const g0 = geometry(), cx = g0.cx, cy = g0.cy + (ui.get('mode') === 'earth' ? H * 0.035 : 0); const dx = x - cx, dy = y - cy, rr = Math.hypot(dx, dy);
  let a = Math.atan2(dy, dx); const hit = hitZones.find(z => { let aa = a; while (aa < z.a0) aa += 2 * Math.PI; while (aa > z.a0 + 2 * Math.PI) aa -= 2 * Math.PI; return aa <= z.a1 && rr >= z.r0 && rr <= z.r1 + 8; });
  if (!hit) { tip.style.display = 'none'; return; }
  const p = ui.values();
  if (hit.e) {
    const e = hit.e;
    tip.innerHTML = `<b>${e.proc}</b><br>${e.sub}${e.x == null ? '<br>Transgressed; no single quantitative control variable yet.' : `<br>current <b>${e.gt ? '>' : ''}${e.x}</b> ${e.unit}<br>boundary ${e.PB} · Holocene ${e.H}${e.U != null ? ` · high risk ${e.U}` : ''}`}${e.food ? '<br><span style="color:#f4d35e">● agriculture is a major driver</span>' : ''}`;
  } else {
    const k = hit.k, S = target.S, B = BOUNDS[p.bset], v = S.tot[k];
    const parts = S.groups.map((g, gi) => [GROUPS[gi], g[k]]).filter(q => Math.abs(q[1]) > 1e-6 * Math.abs(v)).sort((q1, q2) => q2[1] - q1[1]).slice(0, 4);
    tip.innerHTML = `<b>${IND[k].name}</b><br>2050: <b>${fmt(v, IND[k].dig)}</b> ${IND[k].unit} (${fmt(v / B.c[k], 2)}× boundary)<br>boundary ${B.c[k]}${B.lo ? ` (range ${B.lo[k]}–${B.hi[k]})` : ''}<br>2010: ${SPR.REF[0][k]} · BAU 2050: ${fmt(target.bau[k], IND[k].dig)}<hr style="border:0;border-top:1px solid rgba(255,255,255,.2);margin:4px 0">${parts.map(q => `<span style="color:${GCOL[GROUPS.indexOf(q[0])]}">■</span> ${q[0]} ${fmt(100 * q[1] / v, 0)} %`).join('<br>')}`;
  }
  tip.style.display = 'block';
  tip.style.left = Math.min(x + 14, W - tip.offsetWidth - 6) + 'px'; tip.style.top = Math.min(y + 10, H - tip.offsetHeight - 6) + 'px';
});
cv.addEventListener('pointerleave', () => { tip.style.display = 'none'; });

/* ------------------------------------------------------------ charts */
const bars = new BarChart('#chart-bars', { y: { label: 'Share of boundary', unit: '%', min: 0 }, height: 270 });
const stack = new BarChart('#chart-groups', { y: { label: 'Share of boundary', unit: '%', min: 0 }, stacked: true, height: 290 });
function makeCanvas(sel, draw) {
  const el = document.querySelector(sel); const c = document.createElement('canvas'); el.appendChild(c);
  const o = { el, c, ctx: c.getContext('2d'), w: 0, h: 0, draw };
  const rs = () => { const d = Math.min(2, window.devicePixelRatio || 1); o.w = el.clientWidth; o.h = el.clientHeight; c.width = o.w * d; c.height = o.h * d; c.style.width = o.w + 'px'; c.style.height = o.h + 'px'; o.ctx.setTransform(d, 0, 0, d, 0, 0); o.draw && o.draw(o); };
  new ResizeObserver(rs).observe(el); document.addEventListener('ffp:theme', () => o.draw && o.draw(o));
  return o;
}
/* waterfall of lever contributions (Shapley values) */
let lastPhi = null, lastS = null, lastBAU = null;
const wf = makeCanvas('#chart-waterfall', o => {
  if (!lastPhi) return;
  const c = o.ctx, P = palette(), p = ui.values(), B = BOUNDS[p.bset];
  c.clearRect(0, 0, o.w, o.h);
  const L = 92, R = 14, T = 26, rowH = (o.h - T - 34) / 5;
  const vmax = Math.max(120, ...lastBAU.map((v, k) => 100 * v / B.c[k]), ...lastS.tot.map((v, k) => 100 * v / B.c[k])) * 1.05;
  const X = v => L + (o.w - L - R) * v / vmax;
  // grid
  c.font = '500 10px "JetBrains Mono", monospace'; c.fillStyle = P.muted; c.textAlign = 'center'; c.textBaseline = 'top';
  for (let v = 0; v <= vmax; v += vmax > 300 ? 100 : 50) { c.strokeStyle = P.line; c.lineWidth = 1; c.beginPath(); c.moveTo(X(v) + .5, T - 6); c.lineTo(X(v) + .5, o.h - 30); c.stroke(); c.fillText(v + '%', X(v), o.h - 26); }
  c.strokeStyle = STAT_COL[3]; c.setLineDash([5, 4]); c.lineWidth = 1.6; c.beginPath(); c.moveTo(X(100), T - 10); c.lineTo(X(100), o.h - 30); c.stroke(); c.setLineDash([]);
  c.fillStyle = STAT_COL[3]; c.textBaseline = 'bottom'; c.font = '650 10.5px Inter, system-ui, sans-serif'; c.fillText('boundary', X(100), T - 10);
  IND.forEach((d, k) => {
    const y = T + k * rowH, h = rowH * 0.62, yy = y + (rowH - h) / 2;
    c.fillStyle = P.ink2; c.font = '600 11.5px Inter, system-ui, sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(d.short, L - 8, yy + h / 2);
    // BAU outline
    const bau = 100 * lastBAU[k] / B.c[k];
    c.strokeStyle = P.muted; c.lineWidth = 1; c.setLineDash([3, 3]); c.strokeRect(X(0), yy, X(bau) - X(0), h); c.setLineDash([]);
    // remaining (scenario)
    const sc = 100 * lastS.tot[k] / B.c[k], st = status(k, lastS.tot[k], p.bset);
    c.fillStyle = withAlpha(STAT_COL[st], 0.85); c.fillRect(X(0), yy + h * 0.18, Math.max(0, X(sc) - X(0)), h * 0.64);
    // lever segments from BAU downwards
    let cur = bau;
    LEVERS.forEach((lv, i) => {
      const dv = 100 * lastPhi[i][k] / B.c[k]; if (Math.abs(dv) < 0.05) return;
      const a = cur, b = cur + dv; cur = b;
      c.fillStyle = withAlpha(lv.col, dv < 0 ? 0.9 : 0.55);
      c.fillRect(X(Math.min(a, b)), yy, Math.abs(X(b) - X(a)), h);
      if (dv > 0) { c.strokeStyle = lv.col; c.lineWidth = 1; c.strokeRect(X(Math.min(a, b)), yy, Math.abs(X(b) - X(a)), h); }
    });
    c.fillStyle = P.ink; c.font = '600 10.5px "JetBrains Mono", monospace'; c.textAlign = 'left';
    c.fillText(fmt(sc, 0) + '%', Math.min(o.w - 40, X(Math.max(sc, bau)) + 5), yy + h / 2);
  });
});
/* combination matrix: 9 rows (technology x waste) by 3 diet groups x 5 pressures */
const DIETS = ['BAU', 'HGD', 'FLX'], DIETLAB = { BAU: 'BAU diet', HGD: 'Guidelines', FLX: 'Flexitarian' };
let matrixCells = [];
const mx = makeCanvas('#chart-matrix', o => {
  const c = o.ctx, P = palette(), p = ui.values(); c.clearRect(0, 0, o.w, o.h);
  const L = 104, T = 44, gx = 10, cols = 15, cw = (o.w - L - 2 * gx - 6) / cols, ch = Math.min(22, (o.h - T - 8) / 9);
  matrixCells = [];
  const cur = { d: p.diet >= 50 ? p.dietT : 'BAU', t: Math.round(p.tech / 50), w: p.waste >= 62.5 ? 2 : p.waste >= 25 ? 1 : 0 };
  c.textBaseline = 'middle';
  DIETS.forEach((d, di) => {
    const x0 = L + di * (5 * cw + gx);
    c.fillStyle = P.ink2; c.font = '650 11px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(DIETLAB[d], x0 + 2.5 * cw, 12);
    IND.forEach((ind, k) => { c.save(); c.translate(x0 + (k + 0.5) * cw, T - 6); c.rotate(-Math.PI / 4); c.font = '500 9.5px Inter, system-ui, sans-serif'; c.fillStyle = P.muted; c.textAlign = 'left'; c.fillText(ind.short.slice(0, 5), 0, 0); c.restore(); });
    for (let ti = 0; ti < 3; ti++) for (let wi = 0; wi < 3; wi++) {
      const row = ti * 3 + wi, y = T + row * ch;
      const S = scenario(Object.assign({}, p, { dietT: d === 'BAU' ? 'FLX' : d, diet: d === 'BAU' ? 0 : 100, tech: TN[ti] * 100, waste: WN[wi] * 100 }));
      IND.forEach((ind, k) => {
        const st = status(k, S.tot[k], p.bset);
        c.fillStyle = STAT_COL[st]; c.fillRect(x0 + k * cw + 1, y + 1, cw - 2, ch - 2);
      });
      matrixCells.push({ x: x0, y, w: 5 * cw, h: ch, d, ti, wi });
      if (cur.d === d && cur.t === ti && cur.w === wi) { c.strokeStyle = P.ink; c.lineWidth = 2.5; c.strokeRect(x0 - 1, y, 5 * cw + 2, ch); }
    }
  });
  c.font = '500 10.5px Inter, system-ui, sans-serif'; c.textAlign = 'right'; c.fillStyle = P.ink2;
  for (let ti = 0; ti < 3; ti++) for (let wi = 0; wi < 3; wi++) c.fillText(`${['BAU', 'TECH', 'TECH+'][ti]} · ${['waste ×1', 'waste/2', 'waste/4'][wi]}`, L - 8, T + (ti * 3 + wi + 0.5) * ch);
});
mx.c.addEventListener('click', ev => {
  const r = mx.c.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
  const cell = matrixCells.find(m => x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h); if (!cell) return;
  ui.setMany(Object.assign({ tech: TN[cell.ti] * 100, waste: WN[cell.wi] * 100, diet: cell.d === 'BAU' ? 0 : 100 }, cell.d === 'BAU' ? {} : { dietT: cell.d }));
});
mx.c.style.cursor = 'pointer';

/* ------------------------------------------------------------ update */
function update() {
  const p = ui.values(), B = BOUNDS[p.bset];
  const S = scenario(p), U = bauOf(p).tot, R = SPR.REF[0];
  target = {
    S, bau: U,
    food: IND.map((d, k) => ({ x: S.tot[k] / B.c[k], parts: S.groups.map(g => g[k] / B.c[k]) }))
  };
  // readouts
  let safe = 0;
  IND.forEach((d, k) => {
    const st = status(k, S.tot[k], p.bset); if (st <= 1) safe++;
    ro.set(d.id, S.tot[k], st <= 1 ? 'ok' : st === 2 ? 'warn' : 'bad', `${fmt(S.tot[k] / B.c[k], 2)}× boundary · ${fmt(100 * (S.tot[k] / R[k] - 1), 0)} % vs 2010`);
  });
  ro.set('safe', safe, safe === 5 ? 'ok' : safe >= 3 ? 'warn' : 'bad', B.label);
  ro.set('pop', p.pop, null, `${p.ssp} default ${POP[p.ssp]} bn`);
  ro.set('twh', S.twh, S.twh > 2000 ? 'bad' : S.twh > 500 ? 'warn' : null, S.co2 > 0 ? `${fmt(S.co2, 2)} Gt CO₂ yr⁻¹${p.countEnergy ? '' : ' (not counted)'}` : 'no CEA share');
  hud.set('scn', `2050 · <b>${p.ssp}</b> · <b>${fmt(p.pop, 2)}</b> bn people`);
  hud.set('safe', p.mode === 'earth' ? 'Richardson et al. 2023 · <b>6 of 9</b> boundaries transgressed' : `Within boundaries: <b>${safe} / 5</b>`);
  legend.innerHTML = p.mode === 'earth'
    ? `<div style="display:flex;gap:10px;flex-wrap:wrap"><span><i style="display:inline-block;width:10px;height:10px;background:#3fbf6f;border-radius:2px"></i> safe</span><span><i style="display:inline-block;width:10px;height:10px;background:#f0a040;border-radius:2px"></i> increasing risk</span><span><i style="display:inline-block;width:10px;height:10px;background:#e0453a;border-radius:2px"></i> high risk</span><span><i style="display:inline-block;width:8px;height:8px;background:#f4d35e;border-radius:50%"></i> agriculture a major driver</span></div><div style="margin-top:3px;color:var(--muted)">radius: linear to boundary and to high-risk limit, logarithmic beyond</div>`
    : `<div style="display:flex;gap:10px;flex-wrap:wrap"><span style="color:var(--ink)"><b>${B.label}</b> boundaries:</span>${STAT_COL.map((col, i) => `<span><i style="display:inline-block;width:10px;height:10px;background:${col};border-radius:2px"></i> ${['< range', '≤ boundary', 'in range', '> range'][i]}</span>`).join('')}</div>${p.ghosts ? '<div style="margin-top:3px;color:var(--muted)">⋯ 2010 &nbsp; ╌ BAU 2050 &nbsp; ▒ boundary uncertainty</div>' : ''}${p.groups ? `<div style="margin-top:4px;display:flex;gap:8px;flex-wrap:wrap;max-width:380px">${GROUPS.map((g, i) => `<span><i style="display:inline-block;width:8px;height:8px;background:${GCOL[i]};border-radius:2px"></i> ${g}</span>`).join('')}</div>` : ''}`;
  kick();
  // charts
  bars.set(IND.map(d => d.short), [
    { label: '2010', values: IND.map((d, k) => 100 * R[k] / B.c[k]), color: '#9aa3ad', format: v => fmt(v, 0) },
    { label: 'BAU 2050', values: IND.map((d, k) => 100 * U[k] / B.c[k]), color: 'danger', format: v => fmt(v, 0) },
    { label: 'Your scenario', values: IND.map((d, k) => 100 * S.tot[k] / B.c[k]), color: 'accent', format: v => fmt(v, 0) }
  ]);
  bars.refLine(100, 'boundary');
  stack.set(IND.map(d => d.short), GROUPS.map((g, i) => ({ label: g, values: IND.map((d, k) => 100 * S.groups[i][k] / B.c[k]), color: GCOL[i] })).filter(s => s.values.some(v => Math.abs(v) > 0.01)));
  stack.refLine(100, 'boundary');
  lastS = S; lastBAU = U; lastPhi = shapley(p);
  wf.draw(wf); mx.draw(mx);
  document.querySelectorAll('[data-live]').forEach(el => { const f = LIVE[el.dataset.live]; if (f) el.textContent = f(p, S, U); });
}
const LIVE = {
  ghgx: (p, S) => fmt(S.tot[0] / BOUNDS[p.bset].c[0], 2),
  landx: (p, S) => fmt(S.tot[1] / BOUNDS[p.bset].c[1], 2)
};
let pend = 0;
ui.onChange(() => { cancelAnimationFrame(pend); pend = requestAnimationFrame(update); });
update();
resize();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => update());
