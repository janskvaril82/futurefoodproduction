/* ==========================================================================
   Bioregenerative life-support loop — UI, animated loop diagram and charts.
   The model (crop productivities, gas, food, water and energy balances) is in
   ./model.js; see the Derive tab (Eqs. S1–S12).
   ========================================================================== */
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, BarChart, Sankey } from '/assets/js/plot.js';
import { CROPS, CROP_KEYS, CREW, HYGIENE, computeLoop, cropPerM2, lightFor } from './model.js';

/* ------------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'area', label: 'Growing area', unit: 'm²', digits: 1, note: '&nbsp;' })
  .add({ id: 'o2', label: 'Oxygen closed by plants (net)', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'co2', label: 'Crew CO₂ removed by plants', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'food', label: 'Food energy closed', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'prot', label: 'Protein closed', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'water', label: 'Clean water from plant transpiration', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'power', label: 'Lighting + auxiliary power', unit: 'kW', digits: 1, note: '&nbsp;' })
  .add({ id: 'kwhmj', label: 'Electricity per unit of food energy', unit: 'kWh MJ⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'res', label: 'Resupply still needed', unit: 'kg d⁻¹', digits: 2, note: '&nbsp;' })
  .add({ id: 'saved', label: 'Resupply avoided over the mission', unit: 't', digits: 2, note: '&nbsp;' })
  .add({ id: 'ined', label: 'Inedible biomass to process', unit: 'kg DW d⁻¹', digits: 2, note: '&nbsp;' })
  .add({ id: 'edible', label: 'Fresh food harvested', unit: 'kg d⁻¹', digits: 2, note: '&nbsp;' });

ui.section('Crew and mission');
ui.slider({ id: 'crew', label: 'Crew size', min: 1, max: 12, step: 1, value: 4 });
ui.segmented({ id: 'hyg', label: 'Hygiene water', options: [{ value: 'iss', label: 'ISS-like' }, { value: 'base', label: 'Planetary base' }], value: 'base', help: 'BVAD Table 4-21: a base with hand washing and showers uses 7.2 kg per person per day more' });
ui.slider({ id: 'days', label: 'Mission length on the surface', min: 30, max: 1000, step: 10, value: 500, unit: 'd', help: 'A conjunction-class Mars mission stays ≈ 500 days' });
ui.section('Growing area per crop');
const AREA_DEF = { wheat: 70, potato: 40, soybean: 25, lettuce: 5, sweetpotato: 30, tomato: 10 };
CROP_KEYS.forEach(k => ui.slider({ id: 'a_' + k, label: `${CROPS[k].label} <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${CROPS[k].color};margin-left:4px"></span>`, min: 0, max: 200, step: 0.5, value: AREA_DEF[k], unit: 'm²' }));
ui.section('Lighting');
ui.segmented({ id: 'lightMode', label: 'Light regime', options: [{ value: 'nominal', label: 'Crop-specific (BVAD)' }, { value: 'uniform', label: 'Same for all crops' }], value: 'nominal', help: 'BVAD nominal daily light integrals range from 17 (lettuce) to 115 mol m⁻² d⁻¹ (wheat)' });
ui.slider({ id: 'ppfd', label: 'PPFD (uniform regime)', min: 150, max: 1600, step: 10, value: 500, unit: 'µmol m⁻² s⁻¹' });
ui.slider({ id: 'photo', label: 'Photoperiod (uniform regime)', min: 8, max: 24, step: 0.5, value: 16, unit: 'h d⁻¹' });
ui.slider({ id: 'eff', label: 'LED photon efficacy', min: 1.5, max: 4, step: 0.05, value: 2.8, unit: 'µmol J⁻¹' });
ui.slider({ id: 'cap', label: 'Photon capture efficiency', min: 0.5, max: 1, step: 0.01, value: 0.9, help: 'Fraction of emitted photons that reach the canopy' });
ui.section('Atmosphere');
ui.slider({ id: 'co2', label: 'CO₂ concentration', min: 400, max: 1500, step: 10, value: 1200, unit: 'µmol mol⁻¹', help: 'The crop model is valid from 330 to 1300 µmol mol⁻¹; crew limit ≈ 5000' });
ui.slider({ id: 'rh', label: 'Relative humidity', min: 50, max: 85, step: 1, value: 75, unit: '%' });
ui.section('Loop processing');
ui.slider({ id: 'fox', label: 'Inedible biomass oxidised', min: 0, max: 100, step: 5, value: 100, unit: '%', help: 'Bioreactors or combustion return its carbon as CO₂ (and consume O₂); the rest is stored' });
ui.slider({ id: 'wrs', label: 'Physico-chemical water recovery', min: 0, max: 98, step: 1, value: 98, unit: '%', help: 'The ISS reached 98 % total water recovery in 2023' });
ui.section('Diagram');
ui.segmented({ id: 'view', label: 'Flows shown', options: [{ value: 'all', label: 'All' }, { value: 'gas', label: 'O₂ · CO₂' }, { value: 'water', label: 'Water' }, { value: 'food', label: 'Food · waste' }], value: 'all' });
const playBtns = ui.buttons([{ label: '▶ Run the mission', variant: 'primary', onClick: () => { if (missionDay >= P.days) missionDay = 0; clock.toggle(); } }, { label: 'Reset', onClick: () => { missionDay = 0; cum = { res: 0, open: 0 }; clock.pause(); } }]);
ui.segmented({ id: 'speed', label: 'Mission days per second', options: [{ value: 2, label: '2' }, { value: 10, label: '10' }, { value: 50, label: '50' }], value: 10, persist: false });
ui.presets([
  { label: 'Salad machine (Veggie-like)', values: { crew: 4, a_wheat: 0, a_potato: 0, a_soybean: 0, a_lettuce: 0.6, a_sweetpotato: 0, a_tomato: 0.3, lightMode: 'uniform', ppfd: 200, photo: 16, co2: 1200 } },
  { label: 'EDEN ISS-like greenhouse', values: { crew: 4, a_wheat: 0, a_potato: 0, a_soybean: 0, a_lettuce: 7, a_sweetpotato: 0, a_tomato: 5.5, lightMode: 'uniform', ppfd: 450, photo: 17, co2: 1000, rh: 65 } },
  { label: '50 % closure', values: { crew: 4, a_wheat: 35, a_potato: 20, a_soybean: 12, a_lettuce: 3, a_sweetpotato: 15, a_tomato: 5, lightMode: 'nominal', co2: 1200, rh: 75, fox: 100 } },
  { label: 'Full closure', values: { crew: 4, a_wheat: 70, a_potato: 40, a_soybean: 25, a_lettuce: 5, a_sweetpotato: 30, a_tomato: 10, lightMode: 'nominal', co2: 1200, rh: 75, fox: 100 } },
  { label: 'Potato & sweet potato base', values: { crew: 4, a_wheat: 0, a_potato: 80, a_soybean: 30, a_lettuce: 5, a_sweetpotato: 60, a_tomato: 5, lightMode: 'nominal', co2: 1200, rh: 75, fox: 100 } }
]);
ui.saveButton('life-support-loop', () => ro.values());

/* ------------------------------------------------------------------ stage: 2D canvas */
const stageEl = document.getElementById('stage');
const cv = document.createElement('canvas'); stageEl.appendChild(cv);
const ctx = cv.getContext('2d');
const hud = hudChips(stageEl);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); const o = document.createElement('canvas'); o.width = cv.width; o.height = cv.height; const c = o.getContext('2d'); c.fillStyle = '#0d1512'; c.fillRect(0, 0, o.width, o.height); c.drawImage(cv, 0, 0); a.href = o.toDataURL('image/png'); a.download = 'life-support-loop.png'; a.click(); } });
let W = 0, H = 0, DPR = 1;
function resize() { DPR = Math.min(2, window.devicePixelRatio || 1); W = stageEl.clientWidth; H = stageEl.clientHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cv.style.width = W + 'px'; cv.style.height = H + 'px'; buildPaths(); }
new ResizeObserver(resize).observe(stageEl);

const COL = { o2: '#5cc8ef', co2: '#f2b94b', water: '#4a8cff', food: '#6fd39a', waste: '#c49a6c', nutr: '#f07ad0', res: '#ff8f6b' };
const NODES = {
  cabin: { cx: 0.5, cy: 0.24, w: 0.27, h: 0.15, title: 'Cabin atmosphere', sub: 'O₂ · CO₂ · humidity', col: '#5cc8ef' },
  crew: { cx: 0.15, cy: 0.56, w: 0.2, h: 0.22, title: 'Crew', sub: 'MELiSSA compartment V', col: '#f2f2f2' },
  plants: { cx: 0.86, cy: 0.56, w: 0.22, h: 0.3, title: 'Higher-plant chamber', sub: 'compartment IVb', col: '#6fd39a' },
  waste: { cx: 0.34, cy: 0.88, w: 0.25, h: 0.13, title: 'Waste processing', sub: 'bioreactors I–III', col: '#c49a6c' },
  water: { cx: 0.655, cy: 0.88, w: 0.262, h: 0.13, title: 'Water recovery', sub: 'condensate + physico-chemical', col: '#4a8cff' }
};
// flows: [id, group, color, P0, C1, C2, P3, label, dashed]
const FLOW_DEF = [
  ['co2c', 'gas', COL.co2, [0.09, 0.45], [0.09, 0.3], [0.22, 0.21], [0.365, 0.21], 'CO₂ exhaled'],
  ['o2c', 'gas', COL.o2, [0.365, 0.275], [0.26, 0.275], [0.19, 0.35], [0.19, 0.45], 'O₂ breathed'],
  ['o2p', 'gas', COL.o2, [0.92, 0.41], [0.92, 0.24], [0.76, 0.21], [0.635, 0.21], 'O₂ from plants'],
  ['co2p', 'gas', COL.co2, [0.635, 0.275], [0.74, 0.275], [0.8, 0.34], [0.8, 0.41], 'CO₂ to plants'],
  ['o2x', 'gas', COL.o2, [0.46, 0.315], [0.46, 0.57], [0.31, 0.6], [0.31, 0.815], 'O₂ for oxidation'],
  ['co2x', 'gas', COL.co2, [0.37, 0.815], [0.37, 0.6], [0.53, 0.52], [0.53, 0.315], 'CO₂ from wastes'],
  ['food', 'food', COL.food, [0.75, 0.52], [0.6, 0.5], [0.4, 0.5], [0.25, 0.52], 'fresh food'],
  ['ined', 'food', COL.waste, [0.77, 0.71], [0.7, 0.775], [0.56, 0.745], [0.465, 0.835], 'inedible biomass'],
  ['sol', 'food', COL.waste, [0.12, 0.67], [0.12, 0.84], [0.17, 0.9], [0.215, 0.9], 'faeces & urine solids'],
  ['nutr', 'food', COL.nutr, [0.44, 0.815], [0.55, 0.68], [0.76, 0.66], [0.82, 0.71], 'nutrients (N, P, K)'],
  ['trans', 'water', COL.water, [0.93, 0.71], [0.95, 0.88], [0.86, 0.9], [0.785, 0.9], 'transpiration → condensate'],
  ['clean', 'water', COL.water, [0.58, 0.945], [0.45, 1.0], [0.05, 0.93], [0.07, 0.67], 'clean water'],
  ['ww', 'water', COL.water, [0.2, 0.67], [0.3, 0.745], [0.48, 0.745], [0.555, 0.815], 'wastewater'],
  ['irr', 'water', COL.water, [0.74, 0.815], [0.76, 0.76], [0.84, 0.76], [0.86, 0.71], 'nutrient solution'],
  ['ro2', 'gas', COL.res, [0.52, 0.0], [0.52, 0.05], [0.52, 0.11], [0.52, 0.162], 'O₂ from Earth', true],
  ['rfood', 'food', COL.res, [0.0, 0.56], [0.015, 0.56], [0.03, 0.56], [0.048, 0.56], 'food from Earth', true],
  ['rwater', 'water', COL.res, [0.66, 1.0], [0.66, 0.985], [0.66, 0.965], [0.66, 0.948], 'water from Earth', true],
  ['o2s', 'gas', COL.o2, [0.57, 0.165], [0.58, 0.11], [0.59, 0.06], [0.6, 0.0], 'O₂ surplus → storage', true],
  ['co2s', 'gas', COL.co2, [0.43, 0.165], [0.42, 0.11], [0.41, 0.06], [0.4, 0.0], 'excess CO₂ → removal', true],
  ['brine', 'water', COL.waste, [0.76, 0.945], [0.77, 0.965], [0.78, 0.98], [0.8, 1.0], 'brine & losses', true],
  ['store', 'food', COL.waste, [0.3, 0.945], [0.29, 0.965], [0.28, 0.98], [0.26, 1.0], 'stored biomass', true]
];
const FLOWS = FLOW_DEF.map(f => ({ id: f[0], group: f[1], color: f[2], p: [f[3], f[4], f[5], f[6]], label: f[7], dashed: !!f[8], value: 0, width: 0, poly: [], len: 0, phase: Math.random() }));
function bez(p, t) { const u = 1 - t; return [u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0], u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1]]; }
function buildPaths() {
  FLOWS.forEach(f => { const pts = []; let L = 0; for (let i = 0; i <= 60; i++) { const q = bez(f.p, i / 60); const x = q[0] * W, y = q[1] * H; if (pts.length) L += Math.hypot(x - pts[pts.length - 1][0], y - pts[pts.length - 1][1]); pts.push([x, y, L]); } f.poly = pts; f.len = L; });
}
function pointAt(f, s) { const P = f.poly; if (!P.length) return [0, 0]; if (s <= 0) return P[0]; for (let i = 1; i < P.length; i++) if (P[i][2] >= s) { const a = P[i - 1], b = P[i], t = (s - a[2]) / Math.max(1e-6, b[2] - a[2]); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; } return P[P.length - 1]; }

/* ------------------------------------------------------------------ model state and derived values */
let P = null, R = null;
function params() {
  const v = ui.values();
  return { crew: v.crew, hyg: v.hyg, areas: Object.fromEntries(CROP_KEYS.map(k => [k, v['a_' + k]])), lightMode: v.lightMode, ppfd: v.ppfd, photo: v.photo, eff: v.eff, cap: v.cap, co2: v.co2, rh: v.rh, fox: v.fox / 100, wrs: v.wrs / 100, days: v.days, view: v.view, speed: v.speed };
}
function setFlowValues() {
  const r = R, g = r.gas, w = r.water;
  const val = {
    co2c: r.demand.co2, o2c: r.demand.o2, o2p: r.S.o2, co2p: r.S.co2, o2x: r.S.o2ox, co2x: r.S.co2ox,
    food: r.S.eFW, ined: r.S.iDW * P.fox, sol: r.N * CREW.solids, nutr: (r.S.iDW * P.fox + r.N * CREW.solids) > 0 ? 0.001 : 0,
    trans: r.S.h2o, clean: r.demand.water, ww: w.wCrew, irr: w.irrigation,
    ro2: g.o2Res, rfood: r.food.foodResMass, rwater: w.waterRes, o2s: g.o2Surplus, co2s: g.co2Scrub, brine: w.brine + w.bioLoss, store: r.S.iDW * (1 - P.fox)
  };
  FLOWS.forEach(f => { f.value = val[f.id] || 0; });
}
function widths() {
  const vis = FLOWS.filter(f => P.view === 'all' || f.group === P.view);
  const mx = Math.max(1e-9, ...vis.map(f => f.value));
  const maxW = Math.min(W, H) * 0.075;
  FLOWS.forEach(f => { const on = (P.view === 'all' || f.group === P.view) && f.value > 1e-6; f.visible = on; f.width = on ? Math.max(2.2, maxW * f.value / mx) : 0; });
}

/* ------------------------------------------------------------------ drawing */
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
const FONT = (s, w = 600) => `${w} ${s}px Inter, system-ui, sans-serif`;
const MONO = s => `500 ${s}px 'JetBrains Mono', ui-monospace, monospace`;
function drawNode(key, lines) {
  const n = NODES[key]; const x = (n.cx - n.w / 2) * W, y = (n.cy - n.h / 2) * H, w = n.w * W, h = n.h * H;
  const g = ctx.createLinearGradient(x, y, x, y + h); g.addColorStop(0, 'rgba(24,36,32,0.96)'); g.addColorStop(1, 'rgba(14,22,20,0.96)');
  ctx.fillStyle = g; roundRect(x, y, w, h, 12); ctx.fill();
  ctx.strokeStyle = n.col; ctx.globalAlpha = 0.75; ctx.lineWidth = 1.6; ctx.stroke(); ctx.globalAlpha = 1;
  const fs = Math.max(10, Math.min(14, W / 62));
  ctx.fillStyle = '#eef5f1'; ctx.font = FONT(fs, 650); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(n.title, x + 10, y + 8);
  ctx.fillStyle = 'rgba(200,215,208,0.7)'; ctx.font = FONT(fs * 0.78, 500); ctx.fillText(n.sub, x + 10, y + 8 + fs * 1.2);
  ctx.font = MONO(fs * 0.8); ctx.fillStyle = '#bfe9d0';
  lines.forEach((l, i) => ctx.fillText(l, x + 10, y + 10 + fs * 2.25 + i * fs * 1.08));
  return { x, y, w, h, fs };
}
function drawCrewIcons(box) {
  const n = Math.min(P.crew, 12), s = Math.min(15, box.h * 0.14, box.w / (Math.min(n, 6) * 1.45 + 1));
  for (let i = 0; i < n; i++) {
    const col = i % 6, row = Math.floor(i / 6); const x = box.x + 14 + (col + 0.5) * s * 1.4, y = box.y + box.h - 8 - (1 - row) * s * 1.55 - s * 0.95;
    ctx.fillStyle = 'rgba(240,244,242,0.85)'; ctx.beginPath(); ctx.arc(x, y, s * 0.32, 0, Math.PI * 2); ctx.fill();
    roundRect(x - s * 0.36, y + s * 0.38, s * 0.72, s * 0.7, s * 0.25); ctx.fill();
    ctx.fillStyle = 'rgba(92,200,239,0.9)'; ctx.fillRect(x - s * 0.18, y - s * 0.1, s * 0.36, s * 0.14);
  }
}
function drawCropBar(box) {
  const tot = R.area; if (tot <= 0) return;
  const x0 = box.x + 10, y0 = box.y + box.h - 22, w = box.w - 20, h = 11;
  let x = x0; CROP_KEYS.forEach(k => { const a = R.crops[k].area; if (a <= 0) return; const ww = w * a / tot; ctx.fillStyle = CROPS[k].color; ctx.fillRect(x, y0, Math.max(1, ww - 1), h); x += ww; });
  ctx.fillStyle = 'rgba(200,215,208,0.65)'; ctx.font = FONT(Math.max(9, box.fs * 0.7), 500); ctx.textBaseline = 'bottom'; ctx.fillText('crop areas', x0, y0 - 2);
}
let hoverFlow = null;
function draw(dt) {
  if (!W || !H || !R) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
  // subtle grid
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0; x < W; x += 28) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); } for (let y = 0; y < H; y += 28) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); } ctx.stroke();
  // bands
  FLOWS.forEach(f => {
    if (!f.visible) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = f.color; ctx.globalAlpha = f === hoverFlow ? 0.62 : 0.3; ctx.lineWidth = f.width;
    if (f.dashed) ctx.setLineDash([Math.max(6, f.width), Math.max(5, f.width * 0.8)]);
    ctx.beginPath(); f.poly.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke(); ctx.restore();
    // arrow head
    const a = f.poly[f.poly.length - 3], b = f.poly[f.poly.length - 1]; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const s = Math.max(6, f.width * 0.55 + 4);
    ctx.fillStyle = f.color; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - s * Math.cos(ang - 0.5), b[1] - s * Math.sin(ang - 0.5)); ctx.lineTo(b[0] - s * Math.cos(ang + 0.5), b[1] - s * Math.sin(ang + 0.5)); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    // particles
    f.phase = (f.phase + dt * 42 / Math.max(40, f.len)) % 1;
    const gap = 26, n = Math.floor(f.len / gap), r = Math.min(4.2, 1.3 + f.width * 0.18);
    ctx.fillStyle = f.color; ctx.globalAlpha = 0.95;
    for (let i = 0; i < n; i++) { const q = pointAt(f, ((i / n + f.phase) % 1) * f.len); ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  });
  // nodes
  const r = R, fsm = v => fmt(v, v < 10 ? 2 : v < 100 ? 1 : 0);
  drawNode('cabin', [`O₂ in ${fsm(r.S.o2 + r.gas.o2Res)} · out ${fsm(r.demand.o2 + r.S.o2ox + r.gas.o2Surplus)} kg d⁻¹`, `CO₂ in ${fsm(r.gas.co2Prod)} · to plants ${fsm(r.S.co2)}`]);
  const crewBox = drawNode('crew', [`${r.N} × 0.82 kg O₂`, `${fmt(r.demand.foodMJ, 0)} MJ d⁻¹ food`]); drawCrewIcons(crewBox);
  const pb = drawNode('plants', [`${fmt(r.area, 1)} m² · ${fmt(r.energy.pLight, 1)} kW`, `${fsm(r.S.eFW)} kg food d⁻¹`, `${fmt(r.S.h2o, r.S.h2o < 100 ? 1 : 0)} kg H₂O d⁻¹`]); drawCropBar(pb);
  drawNode('waste', [`${fsm(r.S.iDW)} kg DW d⁻¹ in`, `${fmt(P.fox * 100, 0)} % oxidised`]);
  drawNode('water', [`WRS ${fmt(P.wrs * 100, 0)} % · in ${fsm(r.water.wCrew)} kg d⁻¹`, `condensate ${fmt(r.S.h2o, r.S.h2o < 100 ? 1 : 0)} kg d⁻¹`]);
  // flow labels
  const fs = Math.max(9, Math.min(11.5, W / 75));
  ctx.font = MONO(fs); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  FLOWS.forEach(f => {
    if (!f.visible) return;
    const LT = { food: 0.5, clean: 0.33, ww: 0.3, trans: 0.3, irr: 0.55, sol: 0.35, ined: 0.62 };
    const DT = { co2s: 0.8, o2s: 0.8 };                       // top outlets: label near the edge, clear of the HUD chips
    const q = f.dashed ? f.poly[Math.floor(f.poly.length * (DT[f.id] ?? 0.35))] : f.poly[Math.floor(f.poly.length * (LT[f.id] ?? 0.45))];
    const txt = f.id === 'nutr' ? f.label : `${f.label} ${fmt(f.value, f.value < 10 ? 2 : f.value < 100 ? 1 : 0)}`;
    const tw = ctx.measureText(txt).width + 10;
    const below = f.id === 'clean' || f.id === 'trans';
    let lx = q[0], ly = q[1] + (f.dashed ? 0 : (below ? 1 : -1) * Math.min(16, f.width / 2 + 9));
    if (f.id === 'ro2') lx += tw / 2 + 6;                     // beside the vertical supply line
    if (f.id === 'rfood') ly = 0.405 * H;                      // above the crew box, not over its text
    lx = Math.min(W - tw / 2 - 4, Math.max(tw / 2 + 4, lx)); ly = Math.min(H - 10, Math.max(10, ly));
    ctx.fillStyle = 'rgba(8,14,12,0.78)'; roundRect(lx - tw / 2, ly - fs * 0.75, tw, fs * 1.5, 5); ctx.fill();
    ctx.fillStyle = f.color; ctx.fillText(txt, lx, ly + 0.5);
  });
  // legend (top right, under the toolbar)
  const rows = [[['O₂', COL.o2], ['CO₂', COL.co2], ['water', COL.water], ['food', COL.food]], [['wastes', COL.waste], ['nutrients', COL.nutr], ['from Earth / out', COL.res]]];
  ctx.font = FONT(Math.max(9, fs * 0.92), 550); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  rows.forEach((row, ri) => { const wRow = row.reduce((a, [t]) => a + ctx.measureText(t).width + 30, 0); let lx = W - 12 - wRow; const ly = 62 + ri * 17; row.forEach(([t, c]) => { ctx.fillStyle = c; ctx.fillRect(lx, ly - 4, 13, 8); ctx.fillStyle = 'rgba(225,235,230,0.85)'; ctx.fillText(t, lx + 17, ly); lx += ctx.measureText(t).width + 30; }); });
  ctx.fillStyle = 'rgba(225,235,230,0.55)'; ctx.textAlign = 'right'; ctx.fillText('band width ∝ mass flow (kg d⁻¹)', W - 12, 62 + 2 * 17);
}
cv.addEventListener('pointermove', e => {
  const rc = cv.getBoundingClientRect(); const x = e.clientX - rc.left, y = e.clientY - rc.top; let best = null, bd = 1e9;
  FLOWS.forEach(f => { if (!f.visible) return; f.poly.forEach(q => { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd && d < Math.max(10, f.width / 2 + 4)) { bd = d; best = f; } }); });
  hoverFlow = best; cv.title = best ? `${best.label}: ${fmt(best.value, 2)} kg d⁻¹` : '';
});
cv.addEventListener('pointerleave', () => { hoverFlow = null; });

/* ------------------------------------------------------------------ charts */
const closureChart = new BarChart('#chart-closure', { stacked: true, y: { label: 'Share of crew demand met', unit: '%', min: 0 }, height: 250 });
const sankey = new Sankey('#chart-sankey', { unit: 'kg d⁻¹', height: 320, digits: 2 });
const areaPlot = new Plot('#chart-area', { x: { label: 'Growing area per crew member', unit: 'm²', min: 0 }, y: { label: 'Closure', unit: '%', min: 0, max: 200 }, y2: { label: 'Lighting per crew member', unit: 'kW', min: 0 } });
const cropTable = document.getElementById('crop-table');
let sankeyMode = 'o2';
document.querySelectorAll('#sankey-mode button').forEach(b => b.addEventListener('click', () => { sankeyMode = b.dataset.v; document.querySelectorAll('#sankey-mode button').forEach(x => x.setAttribute('aria-pressed', x === b)); drawSankey(); }));

function drawClosure() {
  const cats = ['O₂ (net)', 'CO₂ removal', 'Food energy', 'Protein'];
  const r = R; const co2Prod = r.gas.co2Prod;
  const series = CROP_KEYS.filter(k => r.crops[k].area > 0).map(k => {
    const c = r.crops[k];
    return { label: CROPS[k].label, color: CROPS[k].color, values: [100 * (c.o2 - c.o2ox) / r.demand.o2, co2Prod > 0 ? 100 * Math.min(c.co2, co2Prod * c.co2 / Math.max(1e-9, r.S.co2)) / co2Prod : 0, 100 * c.kcal * 4.184e-3 / r.demand.foodMJ, 100 * c.prot / r.demand.prot] };
  });
  if (!series.length) series.push({ label: 'no crops', color: '#888', values: [0, 0, 0, 0] });
  closureChart.set(cats, series); closureChart.refLine(100, 'crew demand', 'danger');
}
function drawSankey() {
  const r = R; const nodes = [], links = [];
  const add = (id, label, color, col) => nodes.push({ id, label, color, col });
  if (sankeyMode === 'o2') {
    sankey.opts.unit = 'kg d⁻¹';
    CROP_KEYS.forEach(k => { if (r.crops[k].o2 > 1e-6) { add('c_' + k, CROPS[k].label, CROPS[k].color, 0); links.push({ source: 'c_' + k, target: 'pool', value: r.crops[k].o2 }); } });
    if (r.gas.o2Res > 1e-6) { add('res', 'Resupply / electrolysis', '#ff8f6b', 0); links.push({ source: 'res', target: 'pool', value: r.gas.o2Res }); }
    add('pool', 'Cabin O₂', '#5cc8ef', 1);
    add('crew', 'Crew respiration', '#eeeeee', 2); links.push({ source: 'pool', target: 'crew', value: r.demand.o2 });
    if (r.S.o2ox > 1e-6) { add('ox', 'Oxidising wastes', '#c49a6c', 2); links.push({ source: 'pool', target: 'ox', value: r.S.o2ox }); }
    if (r.gas.o2Surplus > 1e-6) { add('sur', 'Surplus stored', '#9aa6a0', 2); links.push({ source: 'pool', target: 'sur', value: r.gas.o2Surplus }); }
  } else if (sankeyMode === 'water') {
    sankey.opts.unit = 'kg d⁻¹';
    // balance of the clean-water store (sources → store → uses); treated wastewater also irrigates the plants directly
    const w = r.water;
    const src = [['cond', 'Transpiration condensate', '#4a8cff', r.S.h2o], ['wrs', 'Physico-chemical WRS', '#8fb8ff', w.wrsOut], ['wproc', 'Dried wastes', '#c49a6c', w.wasteWaterRec], ['res', 'Water from Earth', '#ff8f6b', w.waterRes]];
    src.sort((a, b) => a[3] - b[3]).forEach(([id, lab, col, v]) => { if (v > 1e-6) { add(id, lab, col, 0); links.push({ source: id, target: 'clean', value: v }); } });   // largest last keeps the bottom label inside the chart
    add('clean', 'Clean water', '#5cc8ef', 1);
    add('crew', 'Crew use', '#eeeeee', 2); links.push({ source: 'clean', target: 'crew', value: r.demand.water });
    if (w.waterSurplus > 1e-6) { add('sur', 'Surplus stored', '#9aa6a0', 2); links.push({ source: 'clean', target: 'sur', value: w.waterSurplus }); }
    if (w.makeUp > 1e-6) { add('mk', 'Plant irrigation', '#6fd39a', 2); links.push({ source: 'clean', target: 'mk', value: w.makeUp }); }
  } else {
    sankey.opts.unit = 'kW';
    const e = r.energy; const tot = e.pLight + e.pAux;
    add('el', 'Electricity', '#f2b94b', 0);
    add('food', 'Food', '#6fd39a', 4); add('ined', 'Inedible', '#c49a6c', 4);   // small sinks first so their labels sit above the big heat node
    add('led', 'LEDs', '#f07ad0', 1); links.push({ source: 'el', target: 'led', value: e.pLight });
    add('aux', 'Fans, pumps', '#9aa6a0', 1); links.push({ source: 'el', target: 'aux', value: e.pAux });
    add('par', 'PAR light', '#6fd39a', 2); links.push({ source: 'led', target: 'par', value: e.parKW });
    add('heat', 'Heat to reject', '#ef6b61', 4); links.push({ source: 'led', target: 'heat', value: e.pLight - e.parKW }); links.push({ source: 'aux', target: 'heat', value: e.pAux });
    const chem = Math.min(e.chemKW, e.absorbedKW);
    add('chem', 'Biomass', '#c9a36a', 3); links.push({ source: 'par', target: 'chem', value: chem }); links.push({ source: 'par', target: 'heat', value: Math.max(0, e.parKW - chem) });
    links.push({ source: 'chem', target: 'food', value: Math.min(e.foodKW, chem) });
    links.push({ source: 'chem', target: 'ined', value: Math.max(0, chem - e.foodKW) });
    if (tot <= 0) { links.length = 0; }
    if (tot < 1) { sankey.opts.unit = 'W'; links.forEach(l => { l.value *= 1000; }); }   // small (Veggie-sized) systems read better in watts
  }
  sankey.opts.digits = 2; sankey.opts.gap = sankeyMode === 'o2' ? 14 : 28;
  sankey.set({ nodes, links: links.filter(l => l.value > 1e-9) });
}
function drawArea() {
  const r = R; const N = r.N; const aPer = r.area / Math.max(1, N);
  const xs = [], lines = { o2: [], food: [], prot: [], water: [], kw: [] };
  const xmax = Math.max(60, aPer * 1.6);
  for (let i = 0; i <= 80; i++) {
    const a = xmax * i / 80; const f = aPer > 0 ? a / aPer : 0; xs.push(a);
    lines.o2.push(100 * r.closure.o2 * f); lines.food.push(100 * r.closure.food * f); lines.prot.push(100 * r.closure.prot * f); lines.water.push(100 * r.closure.water * f); lines.kw.push((r.energy.pLight + r.energy.pAux) / N * f);
  }
  areaPlot.setAxis('x', { min: 0, max: xmax });
  areaPlot.hregion('ok', 100, 200, { color: 'accent', alpha: 0.05 });
  areaPlot.hline('full', 100, { color: 'danger', label: '100 % of crew demand', dash: [5, 4] });
  areaPlot.line('o2', xs, lines.o2, { color: '#1c9bd1', width: 2.2, label: 'O₂ (net)' });
  areaPlot.line('food', xs, lines.food, { color: 'accent', width: 2.4, label: 'food energy' });
  areaPlot.line('prot', xs, lines.prot, { color: 'magenta', width: 2, label: 'protein' });
  areaPlot.line('water', xs, lines.water, { color: 'water', width: 1.6, dash: [6, 4], label: 'clean water' });
  areaPlot.line('kw', xs, lines.kw, { color: 'amber', width: 1.8, label: 'lighting kW per person', y2: true });
  areaPlot.vline('now', aPer, { color: 'ink', label: `this design: ${fmt(aPer, 1)} m²` });
}
function drawTable() {
  const rows = CROP_KEYS.map(k => {
    const c = R.crops[k], per = c.per, L = lightFor(k, P);
    const mjPerKwh = c.power > 0 ? (c.kcal * 4.184e-3) / (c.power * 24) : NaN;
    return `<tr${c.area > 0 ? '' : ' class="dim"'}><td><span class="sw" style="background:${CROPS[k].color}"></span>${CROPS[k].label}</td><td class="num">${fmt(c.area, 1)}</td><td class="num">${fmt(L.PPF, 0)} · ${fmt(L.H, 0)} h</td><td class="num">${fmt(per.dli, 1)}</td><td class="num">${fmt(per.eDW, 1)}</td><td class="num">${fmt(per.eFW, 0)}</td><td class="num">${fmt(per.o2, 1)}</td><td class="num">${fmt(per.h2o, 2)}</td><td class="num">${fmt(per.kcal, 0)}</td><td class="num">${fmt(per.prot, 2)}</td><td class="num">${fmt(mjPerKwh * 1000, 0)}</td>${per.valid ? '<td></td>' : '<td title="outside the validity range of the crop model">⚠</td>'}</tr>`;
  }).join('');
  cropTable.innerHTML = `<table class="mini-table"><thead><tr><th>Crop</th><th class="num">area</th><th class="num">PPFD · H</th><th class="num">DLI</th><th class="num">edible DW</th><th class="num">edible FW</th><th class="num">O₂</th><th class="num">H₂O</th><th class="num">energy</th><th class="num">protein</th><th class="num">food per kWh</th><th></th></tr><tr class="units"><th></th><th class="num">m²</th><th class="num">µmol m⁻² s⁻¹</th><th class="num">mol m⁻² d⁻¹</th><th class="num">g m⁻² d⁻¹</th><th class="num">g m⁻² d⁻¹</th><th class="num">g m⁻² d⁻¹</th><th class="num">kg m⁻² d⁻¹</th><th class="num">kcal m⁻² d⁻¹</th><th class="num">g m⁻² d⁻¹</th><th class="num">kJ kWh⁻¹</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ------------------------------------------------------------------ readouts and mission clock */
let missionDay = 0, cum = { res: 0, open: 0 };
function updateReadouts() {
  const r = R, pct = v => 100 * v;
  ro.set('area', r.area, null, `${fmt(r.area / r.N, 1)} m² per crew member`);
  const st = v => v >= 0.999 ? 'ok' : v >= 0.5 ? 'warn' : 'bad';
  ro.set('o2', Math.min(pct(r.closure.o2), 999), st(r.closure.o2), r.gas.o2Surplus > 0 ? `surplus ${fmt(r.gas.o2Surplus, 2)} kg d⁻¹ to store` : r.gas.o2Res > 0 ? `short ${fmt(r.gas.o2Res, 2)} kg d⁻¹` : 'balanced');
  ro.set('co2', pct(r.closure.co2), st(r.closure.co2), r.gas.co2Short > 0 ? `plants could fix ${fmt(r.gas.co2Short, 2)} kg d⁻¹ more (CO₂-limited)` : `${fmt(r.gas.co2Scrub, 2)} kg d⁻¹ left for physico-chemical removal`);
  ro.set('food', Math.min(pct(r.closure.food), 999), st(r.closure.food), r.food.foodResMJ > 0 ? `short ${fmt(r.food.foodResMJ, 1)} MJ d⁻¹ (${fmt(r.food.foodResMass, 2)} kg food)` : 'all energy grown');
  ro.set('prot', Math.min(pct(r.closure.prot), 999), st(r.closure.prot), `${fmt(r.S.prot, 0)} of ${fmt(r.demand.prot, 0)} g d⁻¹ (0.8 g kg⁻¹ × 82 kg)`);
  ro.set('water', Math.min(pct(r.closure.water), 100), st(r.closure.water), r.closure.water > 1 ? `transpiration = ${fmt(r.closure.water, 1)} × the crew's clean-water use` : `${fmt(r.S.h2o, 1)} of ${fmt(r.demand.water, 1)} kg d⁻¹`);
  ro.set('power', r.energy.pLight + r.energy.pAux, null, `${fmt((r.energy.pLight + r.energy.pAux) / r.N, 1)} kW per crew member`);
  ro.set('kwhmj', r.energy.kwhPerMJ, null, `${fmt(100 * r.energy.foodKW / Math.max(1e-9, r.energy.pLight + r.energy.pAux), 2)} % of the electricity ends up as food energy`);
  ro.set('res', r.resupply, r.resupply < 0.05 * r.openLoop ? 'ok' : r.resupply < 0.5 * r.openLoop ? 'warn' : 'bad', `O₂ ${fmt(r.gas.o2Res, 2)} · food ${fmt(r.food.foodResMass, 2)} · water ${fmt(r.water.waterRes, 2)} (open loop ${fmt(r.openLoop, 1)})`);
  ro.set('saved', (r.openLoop - r.resupply) * P.days / 1000, null, `over ${P.days} days, compared with no plants`);
  ro.set('ined', r.S.iDW, null, `${fmt(P.fox * 100, 0)} % oxidised → ${fmt(r.S.co2ox, 2)} kg CO₂ d⁻¹ back to the air`);
  ro.set('edible', r.S.eFW, null, `${fmt(r.S.eFW / r.N * 1000, 0)} g per crew member per day`);
}
function updateHud() {
  const d = Math.min(missionDay, P.days);
  hud.set('d', `Mission day <b>${fmt(Math.floor(d), 0)}</b> / ${P.days}`);
  hud.set('r', `Resupply used <b>${fmt(cum.res / 1000, 2)} t</b> · open loop would need <b>${fmt(cum.open / 1000, 2)} t</b>`);
}
const clock = new SimClock({
  speed: 10,
  onStep: dt => { if (missionDay >= P.days) { clock.pause(); return; } const d = Math.min(dt, P.days - missionDay); missionDay += d; cum.res += R.resupply * d; cum.open += R.openLoop * d; },
  onFrame: () => updateHud()
});
clock.onState(run => { playBtns[0].innerHTML = run ? '❚❚ Pause mission' : '▶ Run the mission'; });

/* ------------------------------------------------------------------ main update and animation */
function update() {
  P = params(); clock.speed = +P.speed;
  ui.enable('ppfd', P.lightMode === 'uniform'); ui.enable('photo', P.lightMode === 'uniform');
  R = computeLoop(P);
  setFlowValues(); widths(); updateReadouts(); updateHud();
  drawClosure(); drawSankey(); drawArea(); drawTable();
  const warn = CROP_KEYS.some(k => R.crops[k].area > 0 && !R.crops[k].per.valid);
  if (warn) hud.set('w', '⚠ some crops outside the validity range of the crop model'); else hud.remove('w');
}
let raf = 0;
ui.onChange((st, id) => { if (id === 'speed') { clock.speed = +st.speed; return; } cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
let visible = true; new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0.01 }).observe(stageEl);
let last = performance.now();
function loop(now) { const dt = Math.min(0.1, (now - last) / 1000); last = now; if (visible && !document.hidden) draw(dt); requestAnimationFrame(loop); }
resize(); update(); requestAnimationFrame(loop);
window.__lsl = { get R() { return R; }, get P() { return P; } };
