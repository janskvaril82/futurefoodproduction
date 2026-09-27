/* Cultivated meat techno-economics — plant simulator, cost model, sensitivity and uncertainty.
   Model equations: model.js and the Derive tab (T1–T10). */
import { Controls, Readouts, SimClock, fmt, fmtTime, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, BarChart, downloadCSV } from '/assets/js/plot.js';
import { palette, withAlpha, colormapGradient } from '/assets/js/colors.js';
import { mulberry32, randn, quantile } from '/assets/js/stats.js';
import { model, PRESETS, BENCH, TORNADO, MC_SPEC, withChange, monteCarlo, medPriceFor, densityFor, PHI_MAX, RHO_CELL } from './model.js';

const $ = s => document.querySelector(s);
const money = (v, d) => v == null || !isFinite(v) ? '—' : '$' + fmt(v, d != null ? d : (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2));
const PART_META = [
  { k: 'capital', label: 'Capital charge', short: ['Capital', 'charge'], col: '#c2419a' },
  { k: 'fixed', label: 'Maintenance & insurance', short: ['Mainten.', '& insur.'], col: '#e089c4' },
  { k: 'labour', label: 'Labour', short: ['Labour'], col: '#1f7fbf' },
  { k: 'basal', label: 'Basal medium', short: ['Basal', 'medium'], col: '#d08a12' },
  { k: 'gf', label: 'Growth factors & rec. proteins', short: ['Growth', 'factors'], col: '#d0413a' },
  { k: 'energy', label: 'Electricity', short: ['Electri-', 'city'], col: '#2e8b7a' },
  { k: 'cons', label: 'Consumables & downstream', short: ['Consum-', 'ables'], col: '#7d8a92' }
];

/* ================================================================ controls */
const DEF = PRESETS.find(p => p.id === 'humbird').values;
const ui = new Controls('#controls', { url: true });
ui.presets(PRESETS.map(p => ({ label: p.label, title: `${p.note} Published: ${money(p.pub)} kg⁻¹ (${p.pubRef}).`, values: p.values, onApply: () => { lastPreset = p.id; } })), 'Scenario presets');
ui.section('Cell line');
ui.slider({ id: 'td', label: 'Doubling time t<sub>d</sub>', min: 10, max: 72, step: 1, value: DEF.td, unit: 'h', help: 'Humbird 24 h; CE Delft 30 h; bovine satellite cells in Beefy-9 ≈ 39 h.' });
ui.slider({ id: 'dens', label: 'Harvest cell density N', min: 2, max: 150, log: true, value: DEF.dens, unit: '10⁶ mL⁻¹', format: v => fmt(v, v < 10 ? 1 : 0) });
ui.slider({ id: 'mcell', label: 'Wet mass per cell m<sub>c</sub>', min: 1000, max: 6000, step: 20, value: DEF.mcell, unit: 'pg', help: '3,000 pg ≈ 17.7 µm cell (Humbird); 3,500 µm³ ≈ 3.1 ng (CE Delft).' });
ui.section('Process');
ui.segmented({ id: 'mode', label: 'Production mode', options: [{ value: 'fb', label: 'Fed-batch' }, { value: 'pf', label: 'Perfusion' }], value: DEF.mode });
ui.slider({ id: 'np', label: 'Doublings in the production vessel', min: 0.5, max: 6, step: 0.1, value: DEF.np, help: 'Seeded at N / 2ⁿ, harvested at N (fed-batch only).' });
ui.slider({ id: 'tmat', label: 'Differentiation / maturation hold', min: 0, max: 14, step: 0.5, value: DEF.tmat, unit: 'd' });
ui.slider({ id: 'tturn', label: 'Turnaround (harvest, CIP/SIP, fill)', min: 2, max: 72, step: 1, value: DEF.tturn, unit: 'h' });
ui.slider({ id: 'D', label: 'Perfusion rate', min: 0.2, max: 3, step: 0.1, value: DEF.D, unit: 'RV d⁻¹', help: 'Reactor volumes of fresh medium per day (perfusion only).' });
ui.slider({ id: 'fx', label: 'Extra medium (seed train, feeds, losses)', min: 0, max: 500, step: 1, value: DEF.fx, unit: '%' });
ui.slider({ id: 'avail', label: 'Plant availability', min: 60, max: 98, step: 1, value: DEF.avail, unit: '%' });
ui.slider({ id: 'fail', label: 'Failed (contaminated) batches', min: 0, max: 30, step: 0.5, value: DEF.fail, unit: '%' });
ui.slider({ id: 'yield', label: 'Harvest & dewatering yield', min: 70, max: 100, step: 1, value: DEF.yield, unit: '%' });
ui.section('Plant & capital');
ui.slider({ id: 'cap', label: 'Plant capacity', min: 0.1, max: 100, log: true, value: DEF.cap, unit: 'kt a⁻¹', format: v => fmt(v, v < 1 ? 2 : 1) });
ui.slider({ id: 'vol', label: 'Working volume per reactor', min: 0.2, max: 200, log: true, value: DEF.vol, unit: 'm³', format: v => fmt(v, v < 10 ? 1 : 0) });
ui.segmented({ id: 'capex', label: 'Reactor cost scaling', options: [{ value: 'humbird', label: 'Humbird Eq. 9' }, { value: 'power', label: 'Power law' }], value: DEF.capex, help: 'Humbird: 0.80 M$ + 30.7 k$ m⁻³ per sterile reactor system. Power law: C ∝ Vⁿ.' });
ui.slider({ id: 'nexp', label: 'Scaling exponent n', min: 0.2, max: 1.0, step: 0.05, value: DEF.nexp, help: 'Six-tenths rule: n = 0.6.' });
ui.slider({ id: 'kcap', label: 'Capital-cost multiplier', min: 0.4, max: 2.5, step: 0.05, value: DEF.kcap, unit: '×', help: 'Estimate accuracy at this stage is about −20 % / +40 %.' });
ui.slider({ id: 'fseed', label: 'Seed train & auxiliary reactors', min: 0, max: 200, step: 1, value: DEF.fseed, unit: '% of reactors' });
ui.slider({ id: 'kbop', label: 'Rest-of-plant factor', min: 0, max: 1.5, step: 0.05, value: DEF.kbop, help: '1 = Humbird’s plant with clean rooms, O₂ PSA, media prep; ≈ 0.1 = food-grade plant (CE Delft).' });
ui.slider({ id: 'find', label: 'Indirect-cost factor', min: 1, max: 2.5, step: 0.01, value: DEF.find, unit: '×', help: 'Engineering, construction, fees and contingency (Humbird 1.6 × 1.15 = 1.84).' });
ui.slider({ id: 'irate', label: 'Interest (discount) rate', min: 0, max: 20, step: 0.5, value: DEF.irate, unit: '% a⁻¹' });
ui.slider({ id: 'life', label: 'Plant life / payback time', min: 2, max: 30, step: 1, value: DEF.life, unit: 'a' });
ui.slider({ id: 'ffix', label: 'Maintenance & insurance', min: 0, max: 15, step: 0.1, value: DEF.ffix, unit: '% TCI a⁻¹' });
ui.section('Operating costs & footprint');
ui.slider({ id: 'cmed', label: 'Medium price', min: 0.02, max: 500, log: true, value: DEF.cmed, unit: '$ L⁻¹', format: v => fmt(v, v < 1 ? 3 : v < 10 ? 2 : 1) });
ui.slider({ id: 'gf', label: 'Share of growth factors & recombinant proteins', min: 0, max: 99.9, step: 0.1, value: DEF.gf, unit: '% of medium cost' });
ui.slider({ id: 'elec', label: 'Electricity use', min: 2, max: 40, step: 0.1, value: DEF.elec, unit: 'kWh kg⁻¹', help: 'Sinke et al. (2023) baseline 22.3 kWh kg⁻¹, ~75 % for cooling.' });
ui.slider({ id: 'pel', label: 'Electricity price', min: 0.02, max: 0.4, step: 0.005, value: DEF.pel, unit: '$ kWh⁻¹' });
ui.slider({ id: 'ef', label: 'Grid emission factor', min: 0, max: 0.9, step: 0.01, value: DEF.ef, unit: 'kg CO₂e kWh⁻¹', help: '≈ 0.46 world average; ≈ 0.04 Swedish grid (Lesson 12.4).' });
ui.slider({ id: 'cfmed', label: 'Medium upstream footprint', min: 0.05, max: 1.5, step: 0.01, value: DEF.cfmed, unit: 'kg CO₂e L⁻¹', help: '≈ 0.30 with average-grid suppliers, ≈ 0.21 with renewable suppliers (calibrated to Sinke et al., 2023).' });
ui.slider({ id: 'fte', label: 'Staff', min: 5, max: 500, step: 1, value: DEF.fte, unit: 'FTE' });
ui.slider({ id: 'wage', label: 'Cost per employee (incl. overheads)', min: 20, max: 250, step: 5, value: DEF.wage, unit: 'k$ a⁻¹' });
ui.slider({ id: 'cons', label: 'Consumables & downstream', min: 0, max: 20, step: 0.1, value: DEF.cons, unit: '$ kg⁻¹', help: 'Filters, ATF membranes, centrifugation, cleaning chemicals, water.' });
ui.section('Price parity');
ui.select({ id: 'target', label: 'Compare with', options: [{ value: 'beef', label: BENCH.beef.label }, { value: 'chicken', label: BENCH.chicken.label }, { value: 'conv', label: BENCH.conv.label }, { value: 'humbird', label: BENCH.humbird.label }], value: 'beef' });
ui.slider({ id: 'markup', label: 'Retail price ÷ cost of wet cells', min: 1, max: 4, step: 0.1, value: 2, unit: '×', help: 'Processing, packaging, distribution and margins (Humbird: $25 → ≈ $50 kg⁻¹ retail). Not applied to the production-cost benchmarks.' });
ui.section('Simulation');
const simBtns = ui.buttons([{ label: 'Pause', onClick: () => clock.toggle() }, { label: 'Restart day 0', onClick: () => { clock.reset(0); produced = 0; } }]);
ui.slider({ id: 'speed', label: 'Simulation speed', min: 1, max: 96, log: true, value: 12, unit: 'h s⁻¹', format: v => fmt(v, 0), persist: false });
ui.saveButton('cultivated-meat-economics', () => ro.values());
let lastPreset = null;

/* ================================================================ readouts */
const ro = new Readouts('#readouts');
ro.add({ id: 'cost', label: 'Cost of production (wet cells)', unit: '$ kg⁻¹', digits: 2 })
  .add({ id: 'med', label: 'Medium share of cost', unit: '%', digits: 0 })
  .add({ id: 'capsh', label: 'Capital-related share', unit: '%', digits: 0 })
  .add({ id: 'tci', label: 'Total capital investment', unit: 'M$', digits: 0 })
  .add({ id: 'nr', label: 'Production reactors', unit: '', digits: 0 })
  .add({ id: 'vm', label: 'Medium use', unit: 'L kg⁻¹', digits: 1 })
  .add({ id: 'prod', label: 'Volumetric productivity', unit: 'kg m⁻³ d⁻¹', digits: 1 })
  .add({ id: 'co2', label: 'Carbon footprint', unit: 'kg CO₂e kg⁻¹', digits: 1 })
  .add({ id: 'phi', label: 'Cell volume fraction at harvest', unit: '%', digits: 0 });

/* ================================================================ stage */
const stageEl = $('#stage');
const cv = document.createElement('canvas');
cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Animated cultivated-meat plant: medium preparation, seed train, production bioreactors and harvest');
stageEl.appendChild(cv);
const ctx = cv.getContext('2d');
const hud = hudChips(stageEl);
const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'
};
const tb = stageToolbar(stageEl, { extra: [{ icon: ICON.pause, title: 'Play / pause the plant', onClick: () => clock.toggle() }], onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'cultivated-meat-plant.png'; a.click(); } });
const playBtn = tb.querySelector('button');
let W = 0, H = 0, DPR = 1, visible = true;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = stageEl.clientWidth; H = stageEl.clientHeight; if (!W || !H) return;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cv.style.width = W + 'px'; cv.style.height = H + 'px';
  drawStage();
}
new ResizeObserver(resize).observe(stageEl);
new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(stageEl);

let M = null, P = null, produced = 0;
const clock = new SimClock({
  speed: 12, maxDt: 1,
  onStep: dt => { if (M) produced += M.total > 0 ? (P.cap * 1e6 / 8760) * dt : 0; },
  onFrame: () => { if (visible) drawStage(); }
});
clock.onState(run => { playBtn.innerHTML = run ? ICON.pause : ICON.play; simBtns[0].textContent = run ? 'Pause' : 'Play'; });
clock.play();

const MED = [214, 184, 108], CELL = [226, 104, 122], MAT = [178, 58, 84];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
function hash(i) { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

/** State of production reactor k at simulated time t (h). */
function reactorState(k, n, t) {
  if (P.mode === 'pf') {
    const run = 8760 * (P.avail / 100) / 10, turn = 72;           // ten turnarounds of 72 h a year (Humbird)
    const cyc = run + turn, tau = (t + (k / Math.max(1, n)) * cyc) % cyc;
    if (tau < run) return { phase: 'steady', level: 1, x: 1, turn: false, tau, cyc };
    const u = (tau - run) / turn;
    return { phase: u < 0.35 ? 'harvest' : u < 0.8 ? 'CIP' : 'fill', level: u < 0.35 ? 1 - u / 0.35 : u < 0.8 ? 0.08 : (u - 0.8) / 0.2, x: u < 0.35 ? 1 : 0.1, turn: true, tau, cyc };
  }
  const tg = M.tg, tm = 24 * P.tmat, tt = P.tturn, cyc = M.tc;
  const tau = (t + (k / Math.max(1, n)) * cyc) % cyc;
  const x0 = Math.pow(2, -P.np);
  if (tau < tg) { const f = tau / tg; return { phase: 'growth', level: 0.72 + 0.28 * f, x: x0 * Math.pow(2, P.np * f), tau, cyc }; }
  if (tau < tg + tm) return { phase: 'maturation', level: 1, x: 1, mat: (tau - tg) / Math.max(1, tm), tau, cyc };
  const u = (tau - tg - tm) / Math.max(1e-6, tt);
  if (u < 0.4) return { phase: 'harvest', level: 1 - u / 0.4, x: 1, tau, cyc };
  if (u < 0.8) return { phase: 'CIP', level: 0.06, x: 0, tau, cyc };
  return { phase: 'fill', level: 0.72 * (u - 0.8) / 0.2, x: x0, tau, cyc };
}
const PHASE_COL = { growth: '#6fd39a', maturation: '#f2b94b', harvest: '#f07ad0', CIP: '#5cc8ef', fill: '#c9d4cf', steady: '#6fd39a' };

function drawVessel(c, x, y, w, h, st, k, t, small) {
  // body (stainless steel)
  const cap = Math.min(w * 0.28, h * 0.12);
  const g = c.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, '#56646a'); g.addColorStop(0.18, '#aebcc2'); g.addColorStop(0.42, '#e8eff2'); g.addColorStop(0.7, '#9aa8ae'); g.addColorStop(1, '#4b575c');
  c.fillStyle = g; rr(c, x, y, w, h, cap); c.fill();
  // cut-away window showing the culture
  const ix = x + w * 0.16, iw = w * 0.68, iy = y + cap * 0.9, ih = h - cap * 1.8;
  c.fillStyle = '#10181a'; rr(c, ix, iy, iw, ih, Math.min(6, iw * 0.2)); c.fill();
  const lh = ih * Math.max(0, Math.min(1, st.level));
  if (lh > 1) {
    const col = st.phase === 'maturation' ? mix(CELL, MAT, st.mat || 0) : st.phase === 'CIP' ? [120, 190, 230] : mix(MED, CELL, Math.min(1, st.x));
    const lg = c.createLinearGradient(0, iy + ih - lh, 0, iy + ih);
    lg.addColorStop(0, rgb(col.map(v => Math.min(255, v + 25)), 0.92)); lg.addColorStop(1, rgb(col.map(v => v * 0.72), 0.97));
    c.save(); rr(c, ix, iy, iw, ih, Math.min(6, iw * 0.2)); c.clip();
    c.fillStyle = lg; c.fillRect(ix, iy + ih - lh, iw, lh);
    // bubbles (O₂ sparging) scale with cell density
    if (!small && st.phase !== 'CIP' && st.phase !== 'harvest' && lh > 8) {
      const nb = Math.round(3 + 9 * Math.min(1, st.x));
      c.fillStyle = 'rgba(255,255,255,.55)';
      for (let b = 0; b < nb; b++) {
        const sp = 0.25 + hash(k * 31 + b) * 0.35, ph = hash(k * 17 + b * 3);
        const fy = ((t * sp + ph) % 1);
        const bx = ix + iw * (0.15 + 0.7 * hash(b * 7 + k)) + Math.sin(t * 3 + b) * 1.5;
        const by = iy + ih - fy * lh;
        c.beginPath(); c.arc(bx, by, 0.8 + 1.2 * hash(b + 2 * k), 0, 7); c.fill();
      }
    }
    // surface highlight
    c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(ix, iy + ih - lh, iw, 1.2);
    c.restore();
  }
  // agitator
  if (!small) {
    c.strokeStyle = 'rgba(220,230,235,.8)'; c.lineWidth = 1.2;
    const sx = ix + iw / 2; c.beginPath(); c.moveTo(sx, y + cap * 0.4); c.lineTo(sx, iy + ih * 0.86); c.stroke();
    const rot = Math.sin(t * 6 + k) * 0.5 + 0.5;
    [0.55, 0.84].forEach(fy => { const bw2 = iw * 0.32 * (0.35 + 0.65 * rot); c.fillStyle = 'rgba(220,230,235,.85)'; c.fillRect(sx - bw2, iy + ih * fy - 1.5, 2 * bw2, 3); });
  }
  // jacket bands and rim
  c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(x + 1, y + h * 0.36, w - 2, 2); c.fillRect(x + 1, y + h * 0.66, w - 2, 2);
  c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 1; rr(c, x, y, w, h, cap); c.stroke();
  // status lamp
  if (!small) { c.fillStyle = PHASE_COL[st.phase] || '#ccc'; c.shadowColor = c.fillStyle; c.shadowBlur = 6; c.beginPath(); c.arc(x + w / 2, y + cap * 0.35, Math.max(1.8, w * 0.05), 0, 7); c.fill(); c.shadowBlur = 0; }
}
function drawStage() {
  if (!M || !W) return;
  const c = ctx, t = clock.t; c.setTransform(DPR, 0, 0, DPR, 0, 0);
  const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0f1a17'); bg.addColorStop(1, '#070c0b');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  // floor grid (clean-room tiles)
  c.strokeStyle = 'rgba(160,200,185,.05)'; c.lineWidth = 1;
  for (let gx = 0; gx < W; gx += 28) { c.beginPath(); c.moveTo(gx, H * 0.2); c.lineTo(gx, H); c.stroke(); }
  for (let gy = H * 0.2; gy < H; gy += 28) { c.beginPath(); c.moveTo(0, gy); c.lineTo(W, gy); c.stroke(); }
  const narrow = W < 620;
  const top = narrow ? 70 : 78, bottom = narrow ? 50 : 72;               // HUD row above, timeline + legend below
  const Lw = narrow ? 0 : Math.max(96, Math.min(150, W * 0.15)), Rw = narrow ? 0 : Math.max(110, Math.min(160, W * 0.17));
  const hb = H - bottom - 10;                                             // harvest header
  const gx0 = Lw + 26, gx1 = W - Rw - 26, gy0 = top + 16, gy1 = hb - 10;
  // ---------- production reactors grid
  const nTrue = Math.max(1, Math.round(M.nR)); const MAXD = 40;
  const nDraw = Math.min(nTrue, MAXD);
  const aw = gx1 - gx0, ah = gy1 - gy0;
  let best = null;
  for (let cols = 1; cols <= nDraw; cols++) {
    const rows = Math.ceil(nDraw / cols); const cw = aw / cols, ch = ah / rows; const s = Math.min(cw / 0.62, ch);
    if (!best || s > best.s) best = { cols, rows, cw, ch, s };
  }
  const sizeF = Math.max(0.5, Math.min(1, 0.55 + 0.45 * (Math.log10(P.vol) + 0.7) / (Math.log10(200) + 0.7)));
  const vh = best.s * 0.82 * sizeF, vw = vh * 0.5;
  // medium header (top)
  const hy = gy0 - 10;
  c.strokeStyle = 'rgba(214,184,108,.55)'; c.lineWidth = 3; c.beginPath(); c.moveTo(Lw * 0.5 + 18, hy); c.lineTo(gx1, hy); c.stroke();
  // harvest header (bottom)
  c.strokeStyle = 'rgba(226,104,122,.55)'; c.beginPath(); c.moveTo(gx0, hb); c.lineTo(narrow ? W - 14 : W - Rw * 0.62, hb); c.stroke();
  const flowDots = (x0, y0, x1, n, col, speed) => { c.fillStyle = col; for (let i = 0; i < n; i++) { const f = ((t * speed + i / n) % 1); c.beginPath(); c.arc(x0 + (x1 - x0) * f, y0, 2, 0, 7); c.fill(); } };
  flowDots(Lw * 0.5 + 18, hy, gx1, 14, 'rgba(242,214,140,.95)', 0.02 + 0.03 * Math.min(1, M.vm / 20));
  const states = [];
  let harvesting = 0;
  for (let k = 0; k < nDraw; k++) {
    const col = k % best.cols, row = Math.floor(k / best.cols);
    const cx = gx0 + (col + 0.5) * best.cw, cyb = gy0 + (row + 1) * best.ch - 6;
    const x = cx - vw / 2, y = cyb - vh;
    const st = reactorState(k, nDraw, t); states.push(st);        // drawn reactors are spread over the whole cycle
    if (st.phase === 'harvest' || P.mode === 'pf') harvesting++;
    // drop pipes
    c.strokeStyle = 'rgba(214,184,108,.25)'; c.lineWidth = 1; c.beginPath(); c.moveTo(cx, hy); c.lineTo(cx, y + 2); c.stroke();
    drawVessel(c, x, y, vw, vh, st, k, t, vw < 14);
    if (P.mode === 'pf' && vw >= 12) {           // ATF cell-retention filter beside the vessel
      const fx = x + vw + 2, fw = Math.max(3, vw * 0.18), fh = vh * 0.55, fy = y + vh * 0.3;
      c.fillStyle = '#8fa0a6'; rr(c, fx, fy, fw, fh, fw / 2); c.fill();
      c.strokeStyle = 'rgba(120,190,230,.6)'; c.lineWidth = 1; c.beginPath(); c.moveTo(fx + fw / 2, fy + fh); c.lineTo(fx + fw / 2, fy + fh + 6); c.stroke();
    }
  }
  flowDots(gx0, hb, narrow ? W - 14 : W - Rw * 0.62, 12, 'rgba(240,140,160,.95)', 0.015 + 0.05 * (harvesting / Math.max(1, nDraw)));
  // caption above the grid (below the HUD row): reactors and the two main flows
  const medFlow = M.vm * P.cap * 1e6 / (8760 * P.avail / 100) / 1000, cellFlow = P.cap * 1e6 / (8760 * P.avail / 100) / 1000;
  c.fillStyle = 'rgba(230,238,233,.92)'; c.font = '600 11.5px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
  c.fillText(narrow ? `${fmt(M.nR, M.nR < 10 ? 1 : 0)} × ${fmt(P.vol, P.vol < 10 ? 1 : 0)} m³ reactors · ${money(M.total)} kg⁻¹`
    : `${fmt(M.nR, M.nR < 10 ? 1 : 0)} × ${fmt(P.vol, P.vol < 10 ? 1 : 0)} m³ ${P.mode === 'fb' ? 'fed-batch' : 'perfusion'} reactors (${fmt(M.Vtot, 0)} m³)${nTrue > nDraw ? `, ${nDraw} drawn` : ''} · medium in ${fmt(medFlow, medFlow < 10 ? 1 : 0)} m³ h⁻¹ · cells out ${fmt(cellFlow, cellFlow < 10 ? 2 : 1)} t h⁻¹`, (gx0 + gx1) / 2, hy - 6);
  // ---------- left: medium preparation and seed train
  if (!narrow) {
    const tx = 16, tw = Lw - 22, ty = top + 12, th = Math.min(150, (H - top - bottom) * 0.46);
    drawVessel(c, tx + tw * 0.18, ty, tw * 0.64, th, { phase: 'fill', level: 0.62 + 0.08 * Math.sin(t * 0.3), x: 0 }, 99, t, false);
    c.fillStyle = '#e6eee9'; c.font = '700 11.5px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'top';
    c.fillText('Medium prep', tx + tw / 2, ty + th + 6);
    c.font = '500 10.5px "JetBrains Mono", monospace'; c.fillStyle = 'rgba(214,184,108,.95)';
    c.fillText(`${fmt(M.vm, 1)} L kg⁻¹`, tx + tw / 2, ty + th + 22);
    c.fillText(`${money(P.cmed, P.cmed < 1 ? 3 : 2)} L⁻¹`, tx + tw / 2, ty + th + 36);
    // composition bar
    const bx = tx + 6, bw = tw - 12, by = ty + th + 52;
    c.fillStyle = '#d08a12'; c.fillRect(bx, by, bw * (1 - P.gf / 100), 7);
    c.fillStyle = '#d0413a'; c.fillRect(bx + bw * (1 - P.gf / 100), by, bw * P.gf / 100, 7);
    c.fillStyle = 'rgba(230,238,233,.7)'; c.font = '500 9.5px Inter, sans-serif'; c.fillText(`${fmt(P.gf, 0)} % GF & proteins`, tx + tw / 2, by + 10);
    // seed train
    const sy = H - bottom - 18; const sizes = [0.18, 0.3, 0.46];
    let sx = tx + 2;
    sizes.forEach((f, i) => {
      const h2 = 22 + 70 * f, w2 = h2 * 0.5;
      drawVessel(c, sx, sy - h2, w2, h2, { phase: 'growth', level: 0.85, x: 0.35 + 0.25 * i }, 50 + i, t, true);
      if (i < 2) { c.strokeStyle = 'rgba(240,140,160,.5)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(sx + w2 + 1, sy - 8); c.lineTo(sx + w2 + 7, sy - 8); c.stroke(); }
      sx += w2 + 9;
    });
    c.fillStyle = 'rgba(230,238,233,.75)'; c.font = '600 10.5px Inter, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText('Seed train', tx, sy + 4);
    c.strokeStyle = 'rgba(240,140,160,.45)'; c.lineWidth = 1.5; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(sx - 4, sy - 30); c.lineTo(gx0 - 6, sy - 30); c.stroke(); c.setLineDash([]);
  }
  // ---------- right: harvest, centrifuge and product
  if (!narrow) {
    const rx = W - Rw + 6, rw2 = Rw - 20;
    const r = Math.min(22, rw2 * 0.2);
    const cyc = hb - r - 22;
    // disk-stack centrifuge
    const cxc = rx + rw2 * 0.3;
    c.fillStyle = '#9aa8ae'; c.beginPath(); c.moveTo(cxc - r, cyc - r * 0.6); c.lineTo(cxc + r, cyc - r * 0.6); c.lineTo(cxc + r * 0.55, cyc + r); c.lineTo(cxc - r * 0.55, cyc + r); c.closePath(); c.fill();
    const spin = (t * 40) % 1;
    c.strokeStyle = 'rgba(40,50,55,.6)'; c.lineWidth = 1;
    for (let d = 0; d < 5; d++) { const yy = cyc - r * 0.45 + ((d / 5 + spin) % 1) * r * 1.3; const hw = r * (1 - 0.45 * (yy - (cyc - r * 0.6)) / (1.6 * r)); c.beginPath(); c.moveTo(cxc - hw, yy); c.lineTo(cxc + hw, yy); c.stroke(); }
    c.fillStyle = '#6d7b80'; c.fillRect(cxc - 4, cyc + r, 8, 10);
    c.fillStyle = '#e6eee9'; c.font = '700 11px Inter, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('Dewatering', cxc + r + 6, cyc - 6);
    c.fillStyle = 'rgba(230,238,233,.6)'; c.font = '500 9.5px Inter, sans-serif'; c.fillText('centrifuge', cxc + r + 6, cyc + 8);
    // product bin
    const bx = rx + rw2 * 0.1, bw2 = rw2 * 0.8, by = top + 4, bh = Math.max(50, cyc - r * 0.6 - by - 62);
    c.strokeStyle = 'rgba(230,238,233,.55)'; c.lineWidth = 1.5; rr(c, bx, by, bw2, bh, 8); c.stroke();
    const fillFrac = (produced % (P.cap * 1e6 / 52)) / (P.cap * 1e6 / 52);       // one week's output per bin
    const ph = (bh - 6) * fillFrac;
    const pg = c.createLinearGradient(0, by + bh - ph, 0, by + bh); pg.addColorStop(0, 'rgba(240,150,165,.95)'); pg.addColorStop(1, 'rgba(170,70,95,.95)');
    c.fillStyle = pg; rr(c, bx + 3, by + bh - 3 - ph, bw2 - 6, ph, 5); c.fill();
    c.fillStyle = '#e6eee9'; c.font = '700 11.5px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText('Wet cell mass', bx + bw2 / 2, by + bh + 4);
    c.font = '500 10.5px "JetBrains Mono", monospace'; c.fillStyle = 'rgba(240,160,175,.95)';
    c.fillText(`${fmt(P.cap, P.cap < 1 ? 2 : 1)} kt a⁻¹`, bx + bw2 / 2, by + bh + 20);
    c.fillStyle = 'rgba(230,238,233,.6)'; c.font = '500 9.5px Inter, sans-serif'; c.fillText('bin = one week', bx + bw2 / 2, by + bh + 35);
    c.strokeStyle = 'rgba(240,140,160,.55)'; c.lineWidth = 3; c.beginPath(); c.moveTo(W - Rw * 0.62, hb); c.lineTo(cxc, hb); c.lineTo(cxc, cyc + r + 10); c.stroke();
  }
  // ---------- bottom: cycle timeline of reactor 1
  const lx0 = narrow ? 12 : Lw + 26, lx1 = narrow ? W - 12 : W - Rw - 26, ly = H - bottom + 24, lh = 12;
  const st0 = states[0];
  c.font = '600 10.5px Inter, sans-serif'; c.textBaseline = 'bottom'; c.textAlign = 'left'; c.fillStyle = 'rgba(230,238,233,.8)';
  if (P.mode === 'fb') {
    const segs = [['growth', M.tg], ['maturation', 24 * P.tmat], ['harvest', 0.4 * P.tturn], ['CIP', 0.4 * P.tturn], ['fill', 0.2 * P.tturn]];
    c.fillText(`Batch cycle of reactor 1: ${fmt(M.tc, 0)} h = ${fmt(P.np, 1)} doublings × ${fmt(P.td, 0)} h${P.tmat > 0 ? ` + ${fmt(P.tmat, 1)} d maturation` : ''} + ${fmt(P.tturn, 0)} h turnaround`, lx0, ly - 3);
    let xx = lx0; const tot = M.tc;
    segs.forEach(([ph, d]) => { if (d <= 0) return; const w = (lx1 - lx0) * d / tot; c.fillStyle = withAlpha(PHASE_COL[ph], 0.75); c.fillRect(xx, ly, Math.max(0, w - 1), lh); xx += w; });
  } else {
    c.fillText(`Continuous perfusion: bleed = μ·X·V = ${fmt(M.mu * M.X * P.vol, 1)} kg h⁻¹ per reactor; 10 turnarounds of 72 h a year`, lx0, ly - 3);
    const run = 8760 * (P.avail / 100) / 10, cyc = run + 72;
    c.fillStyle = withAlpha(PHASE_COL.steady, 0.75); c.fillRect(lx0, ly, (lx1 - lx0) * run / cyc - 1, lh);
    c.fillStyle = withAlpha(PHASE_COL.CIP, 0.75); c.fillRect(lx0 + (lx1 - lx0) * run / cyc, ly, (lx1 - lx0) * 72 / cyc, lh);
  }
  if (st0) { const cxp = lx0 + (lx1 - lx0) * (st0.tau / st0.cyc); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(cxp, ly - 1); c.lineTo(cxp - 5, ly - 8); c.lineTo(cxp + 5, ly - 8); c.closePath(); c.fill(); c.fillRect(cxp - 0.75, ly, 1.5, lh); }
  // legend of phases
  if (!narrow) {
    let lgx = lx0; c.font = '500 10px Inter, sans-serif'; c.textBaseline = 'middle';
    (P.mode === 'fb' ? ['growth', 'maturation', 'harvest', 'CIP', 'fill'] : ['steady', 'harvest', 'CIP', 'fill']).forEach(ph => {
      c.fillStyle = PHASE_COL[ph]; c.fillRect(lgx, ly + lh + 10, 9, 9); c.fillStyle = 'rgba(230,238,233,.8)';
      const lab = ph === 'steady' ? 'steady state' : ph; c.fillText(lab, lgx + 13, ly + lh + 15); lgx += c.measureText(lab).width + 30;
    });
  }
  hud.set('t', `Day <b>${Math.floor(t / 24) + 1}</b> · ${String(Math.floor(t % 24)).padStart(2, '0')}:00 · ${fmt(ui.get('speed'), 0)} h s⁻¹`);
  if (narrow) { hud.remove('p'); hud.remove('c'); }
  else {
    hud.set('p', `Produced <b>${fmt(produced / 1000, produced < 1e5 ? 1 : 0)}</b> t`);
    hud.set('c', `Cost <b>${money(M.total)}</b> kg⁻¹ · <b>${fmt(M.CF, 1)}</b> kg CO₂e kg⁻¹`);
  }
}

/* ================================================================ custom canvas charts */
function canvasChart(sel, drawFn) {
  const host = $(sel); const c = document.createElement('canvas'); c.style.display = 'block'; c.style.width = '100%'; c.style.height = '100%';
  host.style.position = 'relative'; host.appendChild(c);
  const tip = document.createElement('div'); tip.className = 'plot-tip'; host.appendChild(tip);
  const obj = { host, c, tip, ctx: c.getContext('2d'), hits: [], draw() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    const d = Math.min(window.devicePixelRatio || 1, 2); c.width = Math.round(w * d); c.height = Math.round(h * d);
    obj.ctx.setTransform(d, 0, 0, d, 0, 0); obj.ctx.clearRect(0, 0, w, h); obj.hits = []; drawFn(obj, w, h, palette());
  } };
  new ResizeObserver(() => obj.draw()).observe(host);
  document.addEventListener('ffp:theme', () => obj.draw());
  c.addEventListener('pointermove', e => {
    const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = obj.hits.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (!hit) { tip.style.display = 'none'; return; }
    tip.innerHTML = hit.html; tip.style.display = 'block';
    tip.style.left = Math.min(host.clientWidth - tip.offsetWidth - 4, x + 12) + 'px'; tip.style.top = Math.max(2, y - tip.offsetHeight - 6) + 'px';
  });
  c.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
  return obj;
}
const niceStep = r => { const e = Math.pow(10, Math.floor(Math.log10(r))); const f = r / e; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e; };

/* ---- waterfall ---- */
const waterfall = canvasChart('#chart-waterfall', (o, w, h, Pal) => {
  if (!M) return;
  const c = o.ctx; const parts = PART_META.map(m => ({ ...m, v: M.parts[m.k] }));
  const total = M.total, tgt = targetCost();
  const ymax = total * 1.12;
  const L = 52, R = 12, T = 14, B = 40, pw = w - L - R, ph = h - T - B;
  const Y = v => T + ph * (1 - v / ymax);
  const step = niceStep(ymax / 5);
  c.font = '500 10.5px "JetBrains Mono", monospace'; c.fillStyle = Pal.muted; c.textAlign = 'right'; c.textBaseline = 'middle'; c.strokeStyle = Pal.line; c.lineWidth = 1;
  for (let v = 0; v <= ymax + 1e-9; v += step) { const yy = Math.round(Y(v)) + 0.5; c.beginPath(); c.moveTo(L, yy); c.lineTo(w - R, yy); c.stroke(); c.fillText(fmt(v, step < 1 ? 1 : 0), L - 6, yy); }
  c.save(); c.translate(13, T + ph / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.fillStyle = Pal.ink2; c.font = '550 12px Inter, sans-serif'; c.fillText('Cost ($ per kg wet cells)', 0, 0); c.restore();
  const nb = parts.length + 1, bw = pw / nb * 0.66;
  let acc = 0;
  parts.forEach((pt, i) => {
    const x = L + (i + 0.5) * pw / nb - bw / 2; const y0 = Y(acc), y1 = Y(acc + pt.v);
    c.fillStyle = pt.col; rr(c, x, Math.min(y0, y1), bw, Math.max(1, Math.abs(y0 - y1)), 3); c.fill();
    if (i < parts.length) { c.strokeStyle = Pal.muted; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(x + bw, y1); c.lineTo(x + pw / nb, y1); c.stroke(); c.setLineDash([]); }
    c.fillStyle = Pal.ink2; c.font = '600 10.5px "JetBrains Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText(pt.v >= 10 ? fmt(pt.v, 0) : fmt(pt.v, pt.v >= 1 ? 1 : 2), x + bw / 2, Math.min(y0, y1) - 2);
    o.hits.push({ x, y: Math.min(y0, y1) - 12, w: bw, h: Math.abs(y0 - y1) + 12, html: `<b>${pt.label}</b><br>${money(pt.v)} kg⁻¹ · ${fmt(100 * pt.v / total, 1)} % of cost` });
    acc += pt.v;
  });
  // total
  const xt = L + (nb - 0.5) * pw / nb - bw / 2;
  c.fillStyle = Pal.ink; rr(c, xt, Y(total), bw, Y(0) - Y(total), 3); c.fill();
  c.fillStyle = Pal.ink; c.font = '700 11.5px "JetBrains Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(money(total), xt + bw / 2, Y(total) - 2);
  o.hits.push({ x: xt, y: Y(total), w: bw, h: Y(0) - Y(total), html: `<b>Total cost of production</b><br>${money(total)} per kg wet cells` });
  // category labels
  c.fillStyle = Pal.ink2; c.font = `550 ${pw / nb < 58 ? 9.5 : 10.5}px Inter, sans-serif`; c.textBaseline = 'top'; c.textAlign = 'center';
  [...parts.map(p => p.short), ['Total']].forEach((lines, i) => {
    const x = L + (i + 0.5) * pw / nb; lines.forEach((ln, j) => c.fillText(ln, x, T + ph + 6 + 12 * j));
  });
  // benchmark lines
  const bl = [{ v: BENCH.humbird.v, lab: 'Humbird threshold $25', col: Pal.amber }, { v: tgt.cost, lab: `parity target ${money(tgt.cost)} (${tgt.short})`, col: Pal.accent }];
  bl.forEach(b => {
    if (b.v > ymax) { c.fillStyle = b.col; c.font = '600 10px Inter, sans-serif'; c.textAlign = 'right'; c.textBaseline = 'top'; c.fillText(`↑ ${b.lab}`, w - R - 2, T + (b === bl[0] ? 0 : 13)); return; }
    const yy = Y(b.v); c.strokeStyle = b.col; c.lineWidth = 1.5; c.setLineDash([6, 4]); c.beginPath(); c.moveTo(L, yy); c.lineTo(w - R, yy); c.stroke(); c.setLineDash([]);
    c.font = '650 10.5px Inter, sans-serif'; const tw = c.measureText(b.lab).width; c.fillStyle = withAlpha(Pal.bgElev.startsWith('#') ? Pal.bgElev : '#ffffff', 0.9); c.fillRect(w - R - tw - 8, yy - 15, tw + 6, 14);
    c.fillStyle = b.col; c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText(b.lab, w - R - 5, yy - 2);
  });
});

/* ---- tornado ---- */
let tornadoRows = [];
const tornado = canvasChart('#chart-tornado', (o, w, h, Pal) => {
  if (!M || !tornadoRows.length) return;
  const c = o.ctx; const base = M.total;
  const rows = tornadoRows.slice(0, 11);
  const lo = Math.min(base, ...rows.map(r => Math.min(r.a, r.b))), hi = Math.max(base, ...rows.map(r => Math.max(r.a, r.b)));
  const span = hi - lo || 1;
  const x0v = lo - span * 0.08, x1v = hi + span * 0.08;
  c.font = '550 11px Inter, sans-serif';
  const lw = Math.min(w * 0.36, Math.max(...rows.map(r => c.measureText(r.label).width)) + 14);
  const L = lw, R = 16, T = 8, B = 36, pw = w - L - R, rh = (h - T - B) / rows.length;
  const X = v => L + pw * (v - x0v) / (x1v - x0v);
  const step = niceStep((x1v - x0v) / 5);
  c.strokeStyle = Pal.line; c.lineWidth = 1; c.fillStyle = Pal.muted; c.font = '500 10.5px "JetBrains Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'top';
  for (let v = Math.ceil(x0v / step) * step; v <= x1v; v += step) { const xx = Math.round(X(v)) + 0.5; c.beginPath(); c.moveTo(xx, T); c.lineTo(xx, h - B); c.stroke(); c.fillText(fmt(v, step < 1 ? 1 : 0), xx, h - B + 4); }
  c.fillStyle = Pal.ink2; c.font = '550 12px Inter, sans-serif'; c.textBaseline = 'bottom'; c.fillText('Cost ($ per kg wet cells)', L + pw / 2, h - 3);
  rows.forEach((r, i) => {
    const y = T + i * rh + rh * 0.18, bh = rh * 0.64;
    [[r.a, r.ta], [r.b, r.tb]].forEach(([v, tx]) => {
      const xa = X(Math.min(base, v)), xb = X(Math.max(base, v));
      c.fillStyle = v < base ? withAlpha(Pal.accent, 0.85) : withAlpha(Pal.danger, 0.8);
      rr(c, xa, y, Math.max(1, xb - xa), bh, 3); c.fill();
      c.fillStyle = Pal.muted; c.font = '500 9.5px "JetBrains Mono", monospace'; c.textBaseline = 'middle';
      c.textAlign = v < base ? 'right' : 'left'; c.fillText(tx, v < base ? xa - 3 : xb + 3, y + bh / 2);
    });
    c.fillStyle = Pal.ink2; c.font = '550 11px Inter, sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(r.label, L - 8, y + bh / 2);
    o.hits.push({ x: 0, y, w, h: bh, html: `<b>${r.label}</b> (${r.txt})<br>${money(r.a)} ↔ ${money(r.b)} kg⁻¹; swing ${money(Math.abs(r.b - r.a))}` });
  });
  c.strokeStyle = Pal.ink; c.lineWidth = 1.5; c.beginPath(); c.moveTo(X(base), T - 4); c.lineTo(X(base), h - B); c.stroke();
  c.fillStyle = Pal.ink; c.font = '650 10.5px Inter, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
});

/* ---- Monte Carlo histogram (Plot + custom bars) ---- */
const mcPlot = new Plot('#chart-mc', { x: { label: 'Cost of production', unit: '$ kg⁻¹', log: true }, y: { label: 'Share of 3,000 draws', unit: '%', min: 0 }, height: 260, legend: false, crosshair: false });
let MC = null;
function runMC() {
  if (!P) return;
  const res = monteCarlo(P, 3000, mulberry32(20260927), randn);
  const s = Array.from(res.cost).sort((a, b) => a - b);
  const q = x => quantile(s, x);
  const lo = Math.max(1e-3, q(0.005)), hi = q(0.995);
  const nb = 36, e0 = Math.log10(lo), e1 = Math.log10(hi);
  const edges = Array.from({ length: nb + 1 }, (_, i) => Math.pow(10, e0 + (e1 - e0) * i / nb));
  const counts = new Array(nb).fill(0);
  s.forEach(v => { let k = Math.floor((Math.log10(v) - e0) / (e1 - e0) * nb); if (k >= 0 && k < nb) counts[k]++; });
  const tgt = targetCost();
  MC = { s, raw: res, p10: q(0.1), p50: q(0.5), p90: q(0.9), pT: s.filter(v => v <= tgt.cost).length / s.length, p25: s.filter(v => v <= 25).length / s.length, edges, counts, co2: Array.from(res.co2).sort((a, b) => a - b) };
  const maxShare = Math.max(...counts) / s.length * 100;
  ['bars', 'p10', 'p50', 'p90', 'det', 'tg', 'dom'].forEach(id => mcPlot.remove(id));
  mcPlot.setAxis('x', { min: edges[0], max: edges[nb] });
  mcPlot.setAxis('y', { min: 0, max: Math.ceil(maxShare * 1.25) });
  mcPlot.custom('bars', (c, pl, Pal) => {
    counts.forEach((n, i) => {
      const x0 = pl.px(edges[i]), x1 = pl.px(edges[i + 1]), y0 = pl.py(0), y1 = pl.py(n / s.length * 100);
      const mid = Math.sqrt(edges[i] * edges[i + 1]);
      c.fillStyle = mid <= tgt.cost ? withAlpha(Pal.accent, 0.8) : mid <= 25 ? withAlpha(Pal.amber, 0.75) : withAlpha(Pal.magenta, 0.7);
      c.fillRect(x0 + 0.5, y1, Math.max(1, x1 - x0 - 1), y0 - y1);
    });
  });
  mcPlot.vline('p10', MC.p10, { color: 'muted', label: 'P10', dash: [3, 3] });
  mcPlot.vline('p50', MC.p50, { color: 'ink', label: 'median', dash: [] });
  mcPlot.vline('p90', MC.p90, { color: 'muted', label: 'P90', dash: [3, 3] });
  if (tgt.cost >= edges[0] && tgt.cost <= edges[nb]) mcPlot.vline('tg', tgt.cost, { color: 'accent', label: 'target', dash: [6, 4] });
  const el = $('#mc-stats');
  if (el) el.innerHTML = `Deterministic <b>${money(M.total)}</b> · median <b>${money(MC.p50)}</b> · 80 % interval <b>${money(MC.p10)}–${money(MC.p90)}</b> kg⁻¹ · P(cost ≤ ${money(tgt.cost)} ${tgt.short}) = <b>${fmt(100 * MC.pT, 1)} %</b> · P(≤ $25) = <b>${fmt(100 * MC.p25, 0)} %</b> · CO₂e 80 % interval ${fmt(quantile(MC.co2, 0.1), 1)}–${fmt(quantile(MC.co2, 0.9), 1)} kg kg⁻¹`;
}

/* ---- "what would have to be true" map ---- */
const mapPlot = new Plot('#chart-map', { x: { label: 'Medium price', unit: '$ L⁻¹', log: true, min: 0.02, max: 100 }, y: { label: 'Harvest cell density', unit: '10⁶ cells mL⁻¹', log: true, min: 2, max: 200 }, height: 320, legend: true, crosshair: false });
function drawMap() {
  if (!P) return;
  const nx = 64, ny = 48, lx0 = Math.log10(0.02), lx1 = Math.log10(100), ly0 = Math.log10(2), ly1 = Math.log10(200);
  const z = [];
  let zmin = Infinity, zmax = -Infinity;
  for (let j = 0; j < ny; j++) {
    const row = []; const dens = Math.pow(10, ly0 + (ly1 - ly0) * (j + 0.5) / ny);
    const r0 = model(Object.assign({}, P, { dens, cmed: 0 }));
    for (let i = 0; i < nx; i++) {
      const cm = Math.pow(10, lx0 + (lx1 - lx0) * (i + 0.5) / nx);
      const v = -Math.log10(r0.total + r0.vm * cm); row.push(v); zmin = Math.min(zmin, v); zmax = Math.max(zmax, v);
    }
    z.push(row);
  }
  mapPlot.heatmap('hm', { z, x0: 0.02, x1: 100, y0: 2, y1: 200, colormap: 'rdylgn', min: -Math.log10(1000), max: -Math.log10(2) });
  const tgt = targetCost();
  const lines = [{ v: 25, id: 'i25', col: '#8a5a00', lab: '$25 kg⁻¹' }, { v: tgt.cost, id: 'itg', col: '#0b4d2a', lab: `${money(tgt.cost)} (${tgt.short})` }];
  lines.forEach(L => {
    const pts = [];
    for (let j = 0; j <= 120; j++) {
      const dens = Math.pow(10, ly0 + (ly1 - ly0) * j / 120);
      const r0 = model(Object.assign({}, P, { dens, cmed: 0 }));
      const cm = (L.v - r0.total) / r0.vm;
      if (cm > 0.02 && cm < 100) pts.push([cm, dens]);
    }
    if (pts.length > 1) mapPlot.line(L.id, pts, { color: L.col, width: 2.4, label: `cost = ${L.lab}` }); else mapPlot.remove(L.id);
  });
  const dphi = PHI_MAX / (P.mcell / RHO_CELL * 1e-12) / 1e6;
  if (dphi < 200) mapPlot.hline('phi', dphi, { color: 'ink', label: 'viscosity limit φ = 0.25', dash: [4, 4] }); else mapPlot.remove('phi');
  mapPlot.point('now', P.cmed, P.dens, { color: 'magenta', r: 6, label: 'this plant' });
  const legend = $('#map-legend');
  if (legend && !legend.dataset.built) {
    legend.dataset.built = '1';
    const pos = v => (100 * Math.log10(v / 2) / Math.log10(500)).toFixed(1) + '%';
    legend.innerHTML = `<div class="cme-cbar" style="background:${colormapGradient('rdylgn', 'to left')}"></div><div class="cme-cticks">${[2, 10, 100, 1000].map(v => `<span style="left:${pos(v)}">$${fmt(v, 0)}</span>`).join('')}</div><div class="cme-clab">cost of production, $ per kg (log scale)</div>`;
  }
}

/* ---- economies of scale ---- */
const scalePlot = new Plot('#chart-scale', { x: { label: 'Plant capacity', unit: 'kt a⁻¹', log: true, min: 0.1, max: 100 }, y: { label: 'Cost', unit: '$ kg⁻¹', log: true }, height: 280 });
function drawScale() {
  if (!P) return;
  const xs = Array.from({ length: 61 }, (_, i) => Math.pow(10, -1 + 3 * i / 60));
  const rs = xs.map(cap => model(Object.assign({}, P, { cap })));
  scalePlot.line('tot', xs, rs.map(r => r.total), { color: 'ink', width: 2.6, label: 'total' });
  scalePlot.line('capx', xs, rs.map(r => r.parts.capital + r.parts.fixed), { color: 'magenta', width: 2, label: 'capital + maintenance' });
  scalePlot.line('med', xs, rs.map(r => r.parts.basal + r.parts.gf), { color: 'amber', width: 2, label: 'medium' });
  scalePlot.line('lab', xs, rs.map(r => r.parts.labour), { color: 'water', width: 1.8, label: 'labour (fixed staff)', dash: [5, 4] });
  scalePlot.vline('now', P.cap, { color: 'magenta', label: 'this plant' });
  const minTot = Math.min(...rs.map(r => r.total)), maxTot = Math.max(...rs.map(r => r.total));
  scalePlot.setAxis('y', { min: Math.pow(10, Math.floor(Math.log10(0.15 * minTot))), max: Math.pow(10, Math.ceil(Math.log10(maxTot * 1.05))) });
}

/* ---- carbon footprint comparison ---- */
const co2Chart = new BarChart('#chart-co2', { horizontal: true, y: { label: 'kg CO₂e per kg meat (cradle to gate)', unit: '', min: 0 }, height: 330, legend: false });
function drawCO2() {
  if (!M) return;
  const Pal = palette();
  const rows = [
    ['▶ This plant (your settings)', M.CF, Pal.magenta],
    ['This plant on a 0.04 kg kWh⁻¹ grid', model(Object.assign({}, P, { ef: 0.04 })).CF, withAlpha(Pal.magenta, 0.55)],
    ['CM 2030, global-average energy', 14.3, Pal.water],
    ['CM 2030, renewable energy at plant', 4.0, Pal.water],
    ['CM 2030, ambitious (all renewable)', 2.8, Pal.water],
    ['Chicken 2030 (ambitious benchmark)', 2.7, Pal.amber],
    ['Pork 2030 (ambitious benchmark)', 5.1, Pal.amber],
    ['Beef, dairy herd 2030 (ambitious)', 8.8, Pal.amber],
    ['Beef, beef herd 2030 (ambitious)', 34.9, Pal.danger]
  ];
  co2Chart.set(rows.map(r => r[0]), [{ label: 'kg CO₂e kg⁻¹', values: rows.map(r => +r[1].toFixed(1)), colors: rows.map(r => r[2]) }]);
}

/* ================================================================ parity */
function targetCost() {
  const p = P || ui.values(); const b = BENCH[p.target] || BENCH.beef;
  const retail = p.target === 'beef' || p.target === 'chicken';
  const cost = retail ? b.v / p.markup : b.v;
  const short = p.target === 'beef' ? 'beef' : p.target === 'chicken' ? 'chicken' : p.target === 'conv' ? 'meat cost' : 'Humbird';
  return { cost, retail, b, short };
}
function drawParity() {
  const el = $('#parity'); if (!el || !M) return;
  const tgt = targetCost();
  const gap = M.total / tgt.cost;
  const mp = medPriceFor(P, tgt.cost);
  const dn = densityFor(P, tgt.cost);
  const fixedPart = M.parts.capital + M.parts.fixed;
  const otherPart = M.total - fixedPart;
  const capCut = otherPart < tgt.cost ? 1 - (tgt.cost - otherPart) / fixedPart : null;
  const med0 = M.total - M.parts.basal - M.parts.gf;
  const row = (ok, html) => `<li class="${ok ? 'ok' : 'bad'}"><span>${ok ? '✓' : '✗'}</span><div>${html}</div></li>`;
  const items = [];
  items.push(row(gap <= 1, `<b>Today’s settings:</b> ${money(M.total)} kg⁻¹ — ${gap <= 1 ? 'already at or below' : fmt(gap, gap < 10 ? 1 : 0) + '× above'} the target of <b>${money(tgt.cost)} kg⁻¹</b>${tgt.retail ? ` (${money(tgt.b.v)} kg⁻¹ retail ÷ ${fmt(P.markup, 1)})` : ''}.`));
  items.push(row(mp.cmed > 0, mp.cmed > 0 ? `<b>Medium alone:</b> the target is reached at a medium price of <b>${money(mp.cmed, 3)} L⁻¹</b> (now ${money(P.cmed, P.cmed < 1 ? 3 : 2)} L⁻¹, i.e. ${mp.cmed >= P.cmed ? 'no cut needed' : fmt(P.cmed / mp.cmed, P.cmed / mp.cmed < 10 ? 1 : 0) + '× cheaper'}).` : `<b>Medium alone cannot do it:</b> even free medium leaves ${money(mp.floor)} kg⁻¹ of capital, labour, energy and consumables — above the target.`));
  items.push(row(dn != null, dn != null ? `<b>Cell density alone:</b> ${dn <= P.dens ? 'not limiting' : `harvest density must rise to <b>${fmt(dn, 0)} × 10⁶ cells mL⁻¹</b> (volume fraction ${fmt(100 * dn / P.dens * M.phi, 0)} %${dn / P.dens * M.phi > PHI_MAX ? ' — beyond the ≈ 25 % viscosity limit' : ''})`}.` : `<b>Cell density alone cannot do it:</b> even 300 × 10⁶ cells mL⁻¹ does not reach the target.`));
  items.push(row(capCut != null && capCut <= 0.9, capCut == null ? `<b>Capital alone cannot do it:</b> operating costs (${money(otherPart)} kg⁻¹) already exceed the target.` : capCut <= 0 ? '<b>Capital:</b> no reduction needed.' : `<b>Capital alone:</b> capital-related costs (${money(fixedPart)} kg⁻¹) must fall by <b>${fmt(100 * capCut, 0)} %</b>.`));
  const dphi = PHI_MAX / (P.mcell / RHO_CELL * 1e-12) / 1e6;
  const both = model(Object.assign({}, P, { cmed: Math.min(P.cmed, 0.1), dens: Math.max(P.dens, 0.9 * dphi) }));
  items.push(row(both.total <= tgt.cost, `<b>Cheap medium and dense cultures together</b> (≤ $0.10 L⁻¹ and ${fmt(Math.max(P.dens, 0.9 * dphi), 0)} × 10⁶ cells mL⁻¹, 90 % of the viscosity limit): ${money(both.total)} kg⁻¹ — ${both.total <= tgt.cost ? 'reaches the target' : `still ${fmt(both.total / tgt.cost, 1)}× the target; capital (${money(both.parts.capital + both.parts.fixed)}), staff (${money(both.parts.labour)}) and energy (${money(both.parts.energy)}) remain`}. Everything except medium costs ${money(med0)} kg⁻¹ at today's settings.`));
  el.innerHTML = `<ul class="cme-parity">${items.join('')}</ul>`;
}

/* ================================================================ update */
function computeTornado() {
  tornadoRows = TORNADO.map(it => {
    const a = model(withChange(P, it, 'lo')).total, b = model(withChange(P, it, 'hi')).total;
    const [ta, tb] = it.txt.split(' / ');
    return { label: it.label, a, b, ta: ta || it.txt, tb: tb || '', txt: it.txt, swing: Math.abs(b - a) };
  }).filter(r => isFinite(r.a) && isFinite(r.b)).sort((x, y) => y.swing - x.swing);
}
function update() {
  P = ui.values();
  // controls relevant to the chosen mode / cost model
  const fb = P.mode === 'fb';
  ui.enable('np', fb); ui.enable('tmat', fb); ui.enable('tturn', fb); ui.enable('D', !fb);
  ui.enable('nexp', P.capex === 'power');
  ui.enable('markup', P.target === 'beef' || P.target === 'chicken');
  clock.speed = P.speed;
  M = model(P);
  const tgt = targetCost();
  const st = M.total <= tgt.cost ? 'ok' : M.total <= 25 ? 'warn' : 'bad';
  ro.set('cost', M.total, st, `target ${money(tgt.cost)} (${tgt.short}) · Humbird threshold $25`);
  const med = M.parts.basal + M.parts.gf;
  ro.set('med', 100 * med / M.total, med / M.total > 0.5 ? 'bad' : med / M.total > 0.25 ? 'warn' : 'ok', `${money(med)} kg⁻¹ · growth factors ${money(M.parts.gf)} kg⁻¹`);
  const capx = M.parts.capital + M.parts.fixed;
  ro.set('capsh', 100 * capx / M.total, null, `CRF ${fmt(M.CRF, 3)} a⁻¹ · ${money(capx)} kg⁻¹`);
  ro.set('tci', M.TCI, null, `${money(M.TCI * 1e6 / (M.Vtot || 1) / 1000, 0)}k per m³ of reactor`);
  ro.set('nr', M.nR, null, `${fmt(P.vol, P.vol < 10 ? 1 : 0)} m³ each · ${fmt(M.QR / 1000, 1)} t a⁻¹ per reactor`);
  ro.set('vm', M.vm, M.vm > 20 ? 'bad' : M.vm > 10 ? 'warn' : 'ok', P.mode === 'fb' ? `${fmt(M.X, 0)} g L⁻¹ at harvest` : `D/(μX) with X = ${fmt(M.X, 0)} g L⁻¹`);
  ro.set('prod', M.prod, null, P.mode === 'fb' ? `cycle ${fmt(M.tc, 0)} h` : `μ = ${fmt(M.mu, 4)} h⁻¹`);
  ro.set('co2', M.CF, M.CF <= 2.7 ? 'ok' : M.CF <= 8.8 ? 'warn' : 'bad', `chicken 2.7 · beef (beef herd) 34.9 (2030 benchmarks)`);
  ro.set('phi', 100 * M.phi, M.phi > PHI_MAX ? 'bad' : M.phi > 0.2 ? 'warn' : 'ok', M.phi > PHI_MAX ? 'beyond the viscosity limit (25 %)' : `${fmt(M.X, 0)} g L⁻¹ wet cells`);
  computeTornado();
  drawStage(); waterfall.draw(); tornado.draw(); drawMap(); drawScale(); drawCO2(); drawParity();
  clearTimeout(mcT); mcT = setTimeout(runMC, 180);
}
let mcT = 0, raf = 0;
ui.onChange(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
document.addEventListener('ffp:theme', () => { drawCO2(); });
update();

/* ================================================================ calibration table (Sources tab) + CSV */
function buildCal() {
  const el = $('#cal-table'); if (!el) return;
  const rows = PRESETS.map(p => { const r = model(p.values); return `<tr><td>${p.label}</td><td>${p.pubRef}</td><td class="num">${money(p.pub)}</td><td class="num">${money(r.total)}</td><td class="num">${fmt(r.TCI, 0)}</td><td class="num">${fmt(r.nR, 0)}</td><td class="num">${fmt(r.vm, 1)}</td></tr>`; }).join('');
  el.innerHTML = `<table><caption>Table 1. The scenario presets reproduce the published cost of production (US$ per kg wet cells) within 2 %. Parameters were set from each study; where a study did not report a parameter this model needs (for example the number of doublings in the production vessel or the turnaround time), it was chosen so that the published plant capacity and investment are reproduced.</caption><thead><tr><th>Preset</th><th>Published case</th><th class="num">Published</th><th class="num">This model</th><th class="num">TCI (M$)</th><th class="num">Reactors</th><th class="num">Medium (L kg⁻¹)</th></tr></thead><tbody>${rows}</tbody></table>`;
}
buildCal();
const csv = $('#mc-csv');
if (csv) csv.addEventListener('click', () => { if (!MC) return; downloadCSV('cultivated-meat-monte-carlo.csv', ['draw', 'cost_usd_per_kg', 'co2e_kg_per_kg'], Array.from(MC.raw.cost).map((v, i) => [i + 1, +v.toFixed(3), +MC.raw.co2[i].toFixed(3)])); });
const spec = $('#mc-spec'); if (spec) spec.innerHTML = MC_SPEC.map(s => `<li>${s.txt}</li>`).join('');
