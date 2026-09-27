/* pH, speciation and nutrient availability — UI, animated canvas stage and charts.
   Chemistry in ./chem.js (Derive tab, Eqs. P1–P7). */
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, linspace } from '/assets/js/plot.js';
import { palette, withAlpha } from '/assets/js/colors.js';
import { carbonateSpecies, phosphateSpecies } from '/assets/js/physics.js';
import * as C from './chem.js';

const $ = id => document.getElementById(id);
const WATERS = {
  soft: { label: 'Soft surface water (Lake Mälaren, Norrvatten 2025)', hco3: 70, pH: 8.2 },
  hard: { label: 'Hard groundwater (Uppsala esker, Vänge 2022)', hco3: 349, pH: 7.3 },
  custom: { label: 'Custom', hco3: null, pH: null }
};
const EL_COL = { N: '#3f8fd8', P: '#d6559c', K: '#8a6fe0', S: '#d1b62c', Ca: '#e8a33a', Mg: '#4fb563', Fe: '#b5562a', Mn: '#9b5de5', B: '#2a9d8f', Cu: '#c9772c', Zn: '#6c8fa6', Mo: '#7f8c3a' };
const CHEL_COL = { EDTA: '#1c78a3', DTPA: '#1d7a4a', EDDHA: '#b23f8c' };

/* ================================================================ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'h', label: 'Hydrogen-ion concentration', unit: 'µmol L⁻¹', digits: 3 })
  .add({ id: 'p', label: 'Phosphate as H₂PO₄⁻ | HPO₄²⁻', unit: '%', format: v => v })
  .add({ id: 'c', label: 'Carbonate: CO₂ | HCO₃⁻ | CO₃²⁻', unit: '%', format: v => v })
  .add({ id: 'fe', label: 'Iron held by chelate: EDTA | DTPA | EDDHA', unit: '%', format: v => v })
  .add({ id: 'av', label: 'Least available nutrient (qualitative)', unit: '', format: v => v })
  .add({ id: 'dose', label: 'Acid to reach the target pH', unit: '', format: v => v })
  .add({ id: 'creep', label: 'After dosing for a closed tank, 24 h of aeration', unit: '', format: v => v })
  .add({ id: 'drift', label: 'Root-driven pH drift, first day', unit: 'pH d⁻¹', digits: 2 })
  .add({ id: 'neutral', label: 'NH₄⁺ share that stops the drift', unit: '%', digits: 1 });

ui.segmented({ id: 'view', label: 'Stage view', options: [{ value: 'sol', label: 'Solution' }, { value: 'root', label: 'Root zone' }, { value: 'titr', label: 'Titration bench' }], value: 'sol', persist: false });
ui.section('Solution pH');
ui.slider({ id: 'pH', label: 'pH of the nutrient solution', min: 3.5, max: 9, step: 0.05, value: 5.8, help: 'Drag here or on the pH scale in the stage.' });
ui.section('Iron chelates');
ui.slider({ id: 'ca', label: 'Ca²⁺ in the solution', min: 0.5, max: 10, step: 0.1, value: 4, unit: 'mmol L⁻¹' });
ui.slider({ id: 'mg', label: 'Mg²⁺ in the solution', min: 0.2, max: 4, step: 0.1, value: 1.5, unit: 'mmol L⁻¹' });
ui.slider({ id: 'feT', label: 'Iron supplied as chelate', min: 5, max: 100, step: 1, value: 20, unit: 'µmol L⁻¹' });
ui.segmented({ id: 'solid', label: 'Iron hydroxide that can form', options: [{ value: 'amorphous', label: 'fresh Fe(OH)₃' }, { value: 'soil', label: 'aged "soil-Fe"' }], value: 'amorphous' });
ui.section('Acid titration of your water');
ui.select({ id: 'water', label: 'Water (typical examples)', options: Object.entries(WATERS).map(([value, w]) => ({ value, label: w.label })), value: 'soft', onChange: v => { const w = WATERS[v]; if (w.hco3 != null) ui.setMany({ hco3: w.hco3, pH0: w.pH }); } });
ui.slider({ id: 'hco3', label: 'Alkalinity as HCO₃⁻', min: 0, max: 500, step: 1, value: 70, unit: 'mg L⁻¹', help: 'Divide by 61.02 for mmol L⁻¹; × 0.82 for mg L⁻¹ as CaCO₃.' });
ui.slider({ id: 'pH0', label: 'pH of the water', min: 6.5, max: 8.8, step: 0.05, value: 8.2 });
ui.select({ id: 'acid', label: 'Acid', options: Object.entries(C.ACIDS).map(([value, a]) => ({ value, label: a.label })), value: 'hno3_38' });
ui.slider({ id: 'tpH', label: 'Target pH', min: 4.5, max: 7, step: 0.05, value: 5.8 });
ui.slider({ id: 'vol', label: 'Water volume to treat', min: 10, max: 2000, step: 1, value: 100, unit: 'L', log: true });
ui.slider({ id: 'ppm', label: 'CO₂ in the air above the tank', min: 400, max: 1500, step: 5, value: 425, unit: 'ppm', help: '≈ 425 outdoors (NOAA 2024 mean 422.8); 800–1000 in CO₂-enriched greenhouses.' });
ui.slider({ id: 'kla', label: 'Aeration k<sub>L</sub>a for CO₂', min: 0.1, max: 8, step: 0.1, value: 2, unit: 'h⁻¹', help: 'About 0.9 × the oxygen k<sub>L</sub>a of the DWC laboratory.' });
ui.section('Root-driven drift');
ui.slider({ id: 'fNH4', label: 'NH₄⁺ share of nitrogen taken up', min: 0, max: 0.5, step: 0.01, value: 0.07, format: v => fmt(v * 100, 0) + ' %' });
ui.slider({ id: 'upN', label: 'Nitrogen uptake of the crop', min: 0.05, max: 1.5, step: 0.01, value: 0.3, unit: 'mmol L⁻¹ d⁻¹', help: '6 lettuces near harvest in 40 L ≈ 0.3 (see Derive, Eq. P6).' });
ui.slider({ id: 'eps', label: 'Excess of other cations over anions taken up (ε)', min: 0.3, max: 1, step: 0.01, value: 0.7, unit: 'meq mmol⁻¹ N' });
ui.slider({ id: 'pT', label: 'Phosphate in the solution (buffer)', min: 0, max: 3, step: 0.05, value: 1.0, unit: 'mmol L⁻¹' });
ui.slider({ id: 'ph1', label: 'pH after the last correction', min: 5, max: 7, step: 0.05, value: 5.8 });
ui.segmented({ id: 'open', label: 'Tank', options: [{ value: 1, label: 'aerated (DWC, NFT)' }, { value: 0, label: 'closed (still)' }], value: 1 });
ui.slider({ id: 'days', label: 'Days to simulate', min: 1, max: 14, step: 1, value: 7, unit: 'd' });
const [btnRun] = ui.buttons([{ label: '▶ Animate', variant: 'primary', onClick: () => startAnim() }, { label: '↺ Reset', onClick: () => resetAnim() }]);
ui.presets([
  { label: 'Soft water + nitric acid', values: { water: 'soft', hco3: 70, pH0: 8.2, acid: 'hno3_38', tpH: 5.8, view: 'titr' } },
  { label: 'Hard water + phosphoric acid', values: { water: 'hard', hco3: 349, pH0: 7.3, acid: 'h3po4_75', tpH: 5.8, view: 'titr' } },
  { label: 'Pure nitrate feeding', values: { fNH4: 0, upN: 0.4, view: 'root', ph1: 5.8 } },
  { label: 'Too much ammonium', values: { fNH4: 0.4, upN: 0.4, view: 'root', ph1: 5.8 } },
  { label: 'Fe-EDTA at pH 7.2', values: { pH: 7.2, view: 'sol', ca: 4 } }
]);
ui.saveButton('ph-availability', () => ro.values());

/* ================================================================ model evaluation */
let S = null;
function compute() {
  const p = ui.values(); p.open = +p.open === 1;
  const s = { p };
  s.carb = carbonateSpecies(p.pH); s.phos = phosphateSpecies(p.pH);
  const opts = { FeT: p.feT * 1e-6, Ca: p.ca * 1e-3, Mg: p.mg * 1e-3, solid: p.solid };
  s.chel = {}; Object.keys(C.CHELATES).forEach(k => { s.chel[k] = C.chelateState(k, p.pH, opts); });
  s.opts = opts;
  s.avail = C.AVAIL.map(a => ({ el: a.el, v: a.f(p.pH) }));
  // titration
  const alk0 = p.hco3 / 61.017; const co2 = C.co2Eq(p.ppm);
  s.alk0 = alk0; s.co2 = co2;
  s.doseC = C.acidDose({ alk0, pH0: p.pH0, acid: p.acid, target: p.tpH, open: false, co2 });
  s.doseO = C.acidDose({ alk0, pH0: p.pH0, acid: p.acid, target: p.tpH, open: true, co2 });
  const aMax = Math.max(1, alk0 * 1.35 + 0.5);
  s.curveC = C.titrationCurve({ alk0, pH0: p.pH0, acid: p.acid, open: false, co2, aMax });
  s.curveO = C.titrationCurve({ alk0, pH0: p.pH0, acid: p.acid, open: true, co2, aMax });
  s.aMax = aMax;
  const CT0 = C.ctFromWater(alk0, p.pH0);
  const isP = C.ACIDS[p.acid].P > 0;
  s.creep = C.degassing({ alk: alk0 - s.doseC, CT0, PT: isP ? s.doseC : 0, co2, kla: p.kla, hours: 24 });
  s.M = C.acidMolarity(C.ACIDS[p.acid]); s.h = C.ACIDS[p.acid].h;
  // root drift
  const pt = p.pT;
  const alk1 = p.open ? C.alkalinity(p.ph1, co2 / carbonateSpecies(p.ph1)[0], pt) : C.alkalinity(p.ph1, 0.5 / carbonateSpecies(p.ph1)[1], pt);
  s.drift = C.rootDrift({ fNH4: p.fNH4, uptakeN: p.upN, eps: p.eps, alk0: alk1, pH0: p.ph1, PT: pt, open: p.open, co2, days: p.days });
  s.driftRef = [0, C.neutralNH4(p.eps), 0.3].map(f => C.rootDrift({ fNH4: f, uptakeN: p.upN, eps: p.eps, alk0: alk1, pH0: p.ph1, PT: pt, open: p.open, co2, days: p.days }));
  S = s; return s;
}
const pc = v => v * 100 < 0.01 ? '< 0.01' : fmt(v * 100, v * 100 < 1 ? 2 : 0);
const mlFor = mmol => mmol * S.p.vol / S.M / S.h;   // mmol L⁻¹ of H⁺ × L ÷ (mol L⁻¹ × H⁺ per molecule) = mL
function readouts(s) {
  const p = s.p, h = Math.pow(10, -p.pH) * 1e6;
  ro.set('h', h, null, `pH ${fmt(p.pH, 2)} = −log₁₀[H⁺]`);
  ro.set('p', `${fmt(s.phos[1] * 100, 1)} | ${fmt(s.phos[2] * 100, 1)}`, s.phos[2] < 0.2 ? 'ok' : s.phos[2] < 0.5 ? 'warn' : 'bad', 'HPO₄²⁻ precipitates with Ca²⁺');
  ro.set('c', `${fmt(s.carb[0] * 100, 0)} | ${fmt(s.carb[1] * 100, 0)} | ${pc(s.carb[2])}`);
  const f = k => fmt(s.chel[k].chel * 100, 0); const mn = Math.min(s.chel.EDTA.chel, s.chel.DTPA.chel);
  ro.set('fe', `${f('EDTA')} | ${f('DTPA')} | ${f('EDDHA')}`, mn > 0.9 ? 'ok' : s.chel.DTPA.chel > 0.9 || s.chel.EDDHA.chel > 0.9 ? 'warn' : 'bad', 'rest precipitates as Fe(OH)₃');
  const low = s.avail.reduce((a, b) => b.v < a.v ? b : a); ro.set('av', `${low.el} (${fmt(low.v * 100, 0)} %)`, low.v > 0.7 ? 'ok' : low.v > 0.45 ? 'warn' : 'bad', p.pH >= 5.5 && p.pH <= 6.5 ? 'inside the 5.5–6.5 window' : 'outside the 5.5–6.5 window');
  ro.set('dose', `${fmt(mlFor(s.doseC), 1)} mL closed · ${fmt(mlFor(s.doseO), 1)} mL aerated`, null, `${C.ACIDS[p.acid].label} for ${fmt(p.vol, 0)} L: ${fmt(s.doseC, 2)} | ${fmt(s.doseO, 2)} mmol H⁺ L⁻¹`);
  const last = s.creep.ph[s.creep.ph.length - 1]; ro.set('creep', `pH ${fmt(p.tpH, 2)} → ${fmt(last, 2)}`, last - p.tpH < 0.3 ? 'ok' : last - p.tpH < 0.8 ? 'warn' : 'bad', 'CO₂ degasses; bicarbonate left behind raises pH');
  const d1 = s.drift.ph[Math.round((s.drift.ph.length - 1) / p.days)] - s.drift.ph[0];
  ro.set('drift', d1, Math.abs(d1) < 0.1 ? 'ok' : Math.abs(d1) < 0.3 ? 'warn' : 'bad', d1 > 0 ? 'alkalinising: excess anion (NO₃⁻) uptake' : 'acidifying: excess cation (NH₄⁺) uptake');
  ro.set('neutral', C.neutralNH4(p.eps) * 100, null, `(1 − ε)/2 with ε = ${fmt(p.eps, 2)}`);
  hud.set('ph', `pH <b>${fmt(p.pH, 2)}</b> · H₂PO₄⁻ <b>${fmt(s.phos[1] * 100, 0)} %</b> · Fe-DTPA <b>${fmt(s.chel.DTPA.chel * 100, 0)} %</b> chelated`);
}

/* ================================================================ charts */
const specPlot = new Plot('#chart-spec', { x: { label: 'pH', min: 2, max: 12 }, y: { label: 'Fraction of total', min: 0, max: 1 } });
const chelPlot = new Plot('#chart-chel', { x: { label: 'pH', min: 3, max: 11 }, y: { label: 'Iron held by the chelate', unit: '%', min: 0, max: 100 } });
const titrPlot = new Plot('#chart-titr', { x: { label: 'Acid added', unit: 'mmol H⁺ L⁻¹', min: 0 }, y: { label: 'pH', min: 3, max: 9 } });
const driftPlot = new Plot('#chart-drift', { x: { label: 'Time', unit: 'd', min: 0 }, y: { label: 'pH of the solution', min: 3.5, max: 9 } });
const PH = linspace(2, 12, 201), PHc = linspace(3, 11, 161);
let lastKeySpec = '';
function charts(s) {
  const p = s.p;
  if (lastKeySpec === '') {
    const ph = PH.map(phosphateSpecies), cb = PH.map(carbonateSpecies);
    specPlot.region('win', 5.5, 6.5, { color: 'accent', alpha: 0.08 });
    specPlot.line('h2po4', PH, ph.map(v => v[1]), { color: '#d6559c', width: 2.4, label: 'H₂PO₄⁻' });
    specPlot.line('hpo4', PH, ph.map(v => v[2]), { color: '#8a3fbf', width: 2.4, label: 'HPO₄²⁻' });
    specPlot.line('h3po4', PH, ph.map(v => v[0]), { color: '#e79bc5', width: 1.6, dash: [5, 3], label: 'H₃PO₄' });
    specPlot.line('co2', PH, cb.map(v => v[0]), { color: '#8a969c', width: 2.2, label: 'CO₂(aq)' });
    specPlot.line('hco3', PH, cb.map(v => v[1]), { color: '#1c9aa0', width: 2.2, label: 'HCO₃⁻' });
    specPlot.line('co3', PH, cb.map(v => v[2]), { color: '#1c5fa3', width: 2, dash: [6, 4], label: 'CO₃²⁻' });
    lastKeySpec = 'x';
  }
  specPlot.vline('now', p.pH, { color: 'ink', dash: [2, 3], label: 'pH ' + fmt(p.pH, 2) });
  // chelates
  const key = [p.ca, p.mg, p.feT, p.solid].join('|');
  if (key !== chelPlot._key) {
    chelPlot._key = key;
    chelPlot.region('win', 5.5, 6.5, { color: 'accent', alpha: 0.08, label: 'hydroponic window' });
    Object.keys(C.CHELATES).forEach(k => chelPlot.line(k, PHc, PHc.map(x => C.chelateState(k, x, s.opts).chel * 100), { color: CHEL_COL[k], width: 2.6, label: C.CHELATES[k].label }));
  }
  chelPlot.vline('now', p.pH, { color: 'ink', dash: [2, 3] });
  Object.keys(C.CHELATES).forEach(k => chelPlot.point('p' + k, p.pH, s.chel[k].chel * 100, { color: CHEL_COL[k], r: 4.5 }));
  // titration
  titrPlot.setAxis('x', { min: 0, max: s.aMax });
  titrPlot.hline('target', p.tpH, { color: 'danger', dash: [6, 4], label: 'target pH ' + fmt(p.tpH, 2) });
  titrPlot.line('closed', s.curveC.xs, s.curveC.ys, { color: 'water', width: 2.6, label: 'closed tank (CO₂ stays)' });
  titrPlot.line('open', s.curveO.xs, s.curveO.ys, { color: 'magenta', width: 2.4, dash: [7, 4], label: 'aerated (CO₂ escapes)' });
  titrPlot.vline('rule', Math.max(0, s.alk0 - 0.5), { color: 'amber', dash: [2, 3], label: 'leave 0.5 mM HCO₃⁻' });
  titrPlot.point('dc', s.doseC, p.tpH, { color: 'water', r: 5 }); titrPlot.point('do', s.doseO, p.tpH, { color: 'magenta', r: 5 });
  if (anim.titr != null) titrPlot.point('now', anim.titr, C.phFromAlk(s.alk0 - anim.titr, { CT: C.ctFromWater(s.alk0, p.pH0), PT: C.ACIDS[p.acid].P ? anim.titr : 0 }), { color: 'ink', r: 6, label: 'burette' }); else titrPlot.remove('now');
  // drift
  driftPlot.setAxis('x', { min: 0, max: p.days });
  driftPlot.hregion('winy', 5.5, 6.5, { color: 'accent', alpha: 0.1, label: '5.5–6.5' });
  const lab = ['0 % NH₄⁺', `${fmt(C.neutralNH4(p.eps) * 100, 0)} % NH₄⁺ (neutral)`, '30 % NH₄⁺'];
  s.driftRef.forEach((d, i) => driftPlot.line('ref' + i, d.ts, d.ph, { color: 'muted', width: 1.4, dash: [4, 4], label: i === 0 ? 'comparison: 0, neutral, 30 % NH₄⁺' : undefined, noLegend: i > 0 }));
  driftPlot.line('drift', s.drift.ts, s.drift.ph, { color: 'accent', width: 2.8, label: `your crop: ${fmt(p.fNH4 * 100, 0)} % NH₄⁺` });
  if (anim.day != null) driftPlot.vline('day', anim.day, { color: 'ink', dash: [2, 3], label: 'day ' + fmt(anim.day, 1) }); else driftPlot.remove('day');
}

/* ================================================================ stage */
const stageEl = $('stage');
const cv = document.createElement('canvas'); stageEl.appendChild(cv); const ctx = cv.getContext('2d');
const hud = hudChips(stageEl);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'ph-availability.png'; a.click(); } });
let W = 0, H = 0, DPR = 1, visible = true;
function resize() { DPR = Math.min(2, window.devicePixelRatio || 1); W = stageEl.clientWidth; H = stageEl.clientHeight; cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
new ResizeObserver(resize).observe(stageEl); resize();
new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0.01 }).observe(stageEl);
const rnd = (() => { let a = 777; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
const lerp = (a, b, t) => a + (b - a) * t;
/** universal-indicator-like colour for a pH (qualitative) */
function phColor(ph, a = 1) {
  const stops = [[3, [214, 48, 49]], [4, [236, 99, 42]], [5, [242, 159, 5]], [6, [226, 204, 36]], [7, [98, 181, 74]], [8, [42, 157, 143]], [9, [53, 104, 176]], [10, [96, 70, 160]]];
  let i = 0; while (i < stops.length - 2 && ph > stops[i + 1][0]) i++;
  const [p0, c0] = stops[i], [p1, c1] = stops[i + 1]; const t = Math.max(0, Math.min(1, (ph - p0) / (p1 - p0)));
  return `rgba(${Math.round(lerp(c0[0], c1[0], t))},${Math.round(lerp(c0[1], c1[1], t))},${Math.round(lerp(c0[2], c1[2], t))},${a})`;
}
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath(); }
const P = () => palette();
const hex = (c, fb) => (c && c.startsWith('#') ? c : fb);

/* particles for the solution view */
const SPEC = [];  // {kind, x, y, vx, vy, s}
const FLAKES = [];
function ensureParticles(s) {
  const want = { h2po4: Math.round(34 * s.phos[1]), hpo4: Math.round(34 * s.phos[2]), co2: Math.round(26 * s.carb[0]), hco3: Math.round(26 * s.carb[1]), co3: Math.round(26 * s.carb[2]) };
  Object.entries(want).forEach(([k, n]) => {
    const have = SPEC.filter(q => q.kind === k);
    for (let i = have.length; i < n; i++) SPEC.push({ kind: k, x: rnd(), y: 0.1 + rnd() * 0.85, vx: 0, vy: 0, ph: rnd() * 6 });
    for (let i = n; i < have.length; i++) SPEC.splice(SPEC.indexOf(have[i]), 1);
  });
}
let pHdrag = false;
function scaleGeom() { return { x0: 34, x1: W - 34, y: 74, h: 18, pmin: 3.5, pmax: 9 }; }
cv.addEventListener('pointerdown', e => { if (ui.get('view') !== 'sol') return; const g = scaleGeom(); const r = cv.getBoundingClientRect(); const y = e.clientY - r.top; if (Math.abs(y - (g.y + g.h / 2)) < 26) { pHdrag = true; cv.setPointerCapture(e.pointerId); setPHfromX(e.clientX - r.left); } });
cv.addEventListener('pointermove', e => { if (!pHdrag) return; const r = cv.getBoundingClientRect(); setPHfromX(e.clientX - r.left); });
cv.addEventListener('pointerup', () => { pHdrag = false; });
function setPHfromX(x) { const g = scaleGeom(); const v = g.pmin + (g.pmax - g.pmin) * Math.max(0, Math.min(1, (x - g.x0) / (g.x1 - g.x0))); ui.set('pH', Math.round(v * 20) / 20); }

let tA = 0, lastNow = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastNow) / 1000); lastNow = now; tA += dt;
  if (!visible || document.hidden || !S || !W) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
  const v = ui.get('view');
  if (v === 'sol') drawSolution(dt); else if (v === 'root') drawRoot(dt); else drawTitration(dt);
}
function drawPHScale(ph, label) {
  const g = scaleGeom(), pal = P();
  const grd = ctx.createLinearGradient(g.x0, 0, g.x1, 0);
  for (let i = 0; i <= 11; i++) { const p = g.pmin + (g.pmax - g.pmin) * i / 11; grd.addColorStop(i / 11, phColor(p, 0.9)); }
  ctx.fillStyle = grd; rr(g.x0, g.y, g.x1 - g.x0, g.h, 6); ctx.fill();
  const X = p => g.x0 + (p - g.pmin) / (g.pmax - g.pmin) * (g.x1 - g.x0);
  ctx.strokeStyle = hex(pal.accent, '#1d7a4a'); ctx.lineWidth = 2; ctx.setLineDash([]); ctx.strokeRect(X(5.5), g.y - 4, X(6.5) - X(5.5), g.h + 8);
  ctx.fillStyle = pal.ink2; ctx.font = '600 10.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('hydroponic window 5.5–6.5', (X(5.5) + X(6.5)) / 2, g.y - 9);
  ctx.font = '500 10px JetBrains Mono, monospace'; ctx.fillStyle = pal.muted;
  for (let p = 4; p <= 9; p++) { ctx.fillText(String(p), X(p), g.y + g.h + 13); }
  const x = X(ph);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1b1f22'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, g.y + g.h / 2, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#1b1f22'; ctx.font = '700 9.5px JetBrains Mono, monospace'; ctx.fillText(ph.toFixed(1), x, g.y + g.h / 2 + 3.5);
  if (label) { ctx.fillStyle = pal.muted; ctx.font = '500 10px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(label, g.x0, g.y + g.h + 28); }
}
const SP_COL = { h2po4: '#d6559c', hpo4: '#8a3fbf', co2: '#9aa4aa', hco3: '#1c9aa0', co3: '#1c5fa3' };
function drawSolution(dt) {
  const s = S, p = s.p, pal = P();
  drawPHScale(p.pH, 'drag the marker to change pH');
  ensureParticles(s);
  // beaker
  const bx = 30, by = 132, bw = Math.min(W * 0.4, 330), bh = H - by - 62;
  const liq = by + bh * 0.12;
  ctx.save(); rr(bx, by, bw, bh, 18); ctx.clip();
  const lg = ctx.createLinearGradient(0, liq, 0, by + bh); lg.addColorStop(0, phColor(p.pH, 0.22)); lg.addColorStop(1, phColor(p.pH, 0.42));
  ctx.fillStyle = lg; ctx.fillRect(bx, liq, bw, by + bh - liq);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); for (let x = 0; x <= bw; x += 4) { const y = liq + Math.sin(x * 0.07 + tA * 2.5) * 1.6; x ? ctx.lineTo(bx + x, y) : ctx.moveTo(bx + x, y); } ctx.stroke();
  // ions
  SPEC.forEach(q => { q.vx += (rnd() - 0.5) * dt * 0.7; q.vy += (rnd() - 0.5) * dt * 0.7; if (q.kind === 'co2') q.vy -= dt * 0.05; q.vx *= 0.95; q.vy *= 0.95; q.x += q.vx * dt; q.y += q.vy * dt; if (q.x < 0.03 || q.x > 0.97) q.vx *= -1; q.x = Math.max(0.03, Math.min(0.97, q.x)); if (q.y > 0.97) { q.vy *= -1; q.y = 0.97; } if (q.y < 0.04) { if (q.kind === 'co2') { q.y = 0.97; q.x = rnd(); } else { q.vy *= -1; q.y = 0.04; } }
    const X = bx + q.x * bw, Y = liq + q.y * (by + bh - liq);
    ctx.fillStyle = SP_COL[q.kind]; ctx.strokeStyle = SP_COL[q.kind];
    if (q.kind === 'co2') { ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(X, Y, 3.2, 0, Math.PI * 2); ctx.stroke(); }
    else if (q.kind === 'hpo4' || q.kind === 'co3') { ctx.beginPath(); ctx.moveTo(X, Y - 4); ctx.lineTo(X + 4, Y); ctx.lineTo(X, Y + 4); ctx.lineTo(X - 4, Y); ctx.closePath(); ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(X, Y, 3, 0, Math.PI * 2); ctx.fill(); } });
  // iron chelates: 3 columns of claws, precipitate flakes
  const keys = ['EDTA', 'DTPA', 'EDDHA'];
  keys.forEach((k, i) => {
    const cx = bx + bw * (0.2 + 0.3 * i), cy = liq + (by + bh - liq) * 0.42;
    const f = s.chel[k].chel; const n = 6;
    for (let j = 0; j < n; j++) {
      const ang = j / n * Math.PI * 2 + tA * 0.4 + i; const rrad = 18 + 4 * Math.sin(tA + j);
      const X = cx + Math.cos(ang) * rrad, Y = cy + Math.sin(ang) * rrad * 0.8;
      const held = j < Math.round(f * n);
      ctx.strokeStyle = CHEL_COL[k]; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X, Y, 6.5, 0.4, Math.PI * 2 - 0.4); ctx.stroke();
      if (held) { ctx.fillStyle = '#b5562a'; ctx.beginPath(); ctx.arc(X, Y, 3.2, 0, Math.PI * 2); ctx.fill(); }
    }
    if (rnd() < dt * 8 * (1 - f)) FLAKES.push({ x: cx + (rnd() - 0.5) * 30, y: cy, v: 12 + rnd() * 10 });
    ctx.fillStyle = pal.ink2; ctx.font = '700 10px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${k} ${fmt(f * 100, 0)} %`, cx, cy + 36);
  });
  for (let i = FLAKES.length - 1; i >= 0; i--) { const fl = FLAKES[i]; fl.y += fl.v * dt; if (fl.y > by + bh - 6) { FLAKES.splice(i, 1); continue; } ctx.fillStyle = 'rgba(150,70,30,0.85)'; ctx.fillRect(fl.x, fl.y, 3, 2); }
  const rust = Math.min(14, 14 * (1 - s.chel.EDTA.chel) + 6 * (1 - s.chel.DTPA.chel));
  if (rust > 0.5) { ctx.fillStyle = 'rgba(150,72,32,0.75)'; ctx.fillRect(bx, by + bh - rust, bw, rust); }
  ctx.restore();
  ctx.strokeStyle = hex(pal.lineStrong, '#999'); ctx.lineWidth = 1.8; rr(bx, by, bw, bh, 18); ctx.stroke();
  ctx.fillStyle = pal.ink; ctx.font = '700 12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('Nutrient solution at this pH', bx + 12, by + 18);
  // legend
  const leg = [['h2po4', 'H₂PO₄⁻', s.phos[1]], ['hpo4', 'HPO₄²⁻', s.phos[2]], ['co2', 'CO₂', s.carb[0]], ['hco3', 'HCO₃⁻', s.carb[1]], ['co3', 'CO₃²⁻', s.carb[2]]];
  ctx.font = '500 10.5px Inter, sans-serif';
  leg.forEach(([k, name, f], i) => { const x = bx + (i % 3) * (bw / 3), y = by + bh + 18 + Math.floor(i / 3) * 16; ctx.fillStyle = SP_COL[k]; ctx.fillRect(x, y - 8, 9, 9); ctx.fillStyle = pal.ink2; ctx.textAlign = 'left'; ctx.fillText(`${name} ${pc(f)} %`, x + 13, y); });
  ctx.fillStyle = '#b5562a'; ctx.beginPath(); ctx.arc(bx + 2 * bw / 3 + 4, by + bh + 30, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = pal.ink2; ctx.fillText('Fe³⁺ in chelate', bx + 2 * bw / 3 + 13, by + bh + 34);
  // availability chart (qualitative)
  const ax = bx + bw + 40, ay = 128, aw = W - ax - 20, ah = H - ay - 28;
  ctx.fillStyle = pal.ink; ctx.font = '700 12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('Relative availability in soilless media — qualitative', ax, ay - 2);
  const rows = C.AVAIL.length, rh = (ah - 26) / rows;
  const pmin = 3.5, pmax = 9, X = ph => ax + 26 + (ph - pmin) / (pmax - pmin) * (aw - 64);
  ctx.fillStyle = withAlpha(hex(pal.accent, '#1d7a4a'), 0.08); ctx.fillRect(X(5.5), ay + 6, X(6.5) - X(5.5), rows * rh);
  C.AVAIL.forEach((a, i) => {
    const yc = ay + 6 + rh * (i + 0.5); const col = EL_COL[a.el];
    ctx.beginPath(); const N = 60;
    for (let k = 0; k <= N; k++) { const ph = pmin + (pmax - pmin) * k / N; const t = a.f(ph) * rh * 0.42; const x = X(ph); k ? ctx.lineTo(x, yc - t) : ctx.moveTo(x, yc - t); }
    for (let k = N; k >= 0; k--) { const ph = pmin + (pmax - pmin) * k / N; const t = a.f(ph) * rh * 0.42; ctx.lineTo(X(ph), yc + t); }
    ctx.closePath(); ctx.fillStyle = withAlpha(col, 0.78); ctx.fill();
    ctx.fillStyle = pal.ink; ctx.font = '700 11px Inter, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(a.el, ax + 18, yc + 4);
    const v = a.f(p.pH); ctx.fillStyle = withAlpha(col, 0.95); ctx.fillRect(ax + aw - 32, yc - 4, 30 * v, 8); ctx.strokeStyle = withAlpha(hex(pal.muted, '#888888'), 0.6); ctx.lineWidth = 1; ctx.strokeRect(ax + aw - 32, yc - 4, 30, 8);
  });
  ctx.strokeStyle = hex(pal.ink, '#1b1f22'); ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(X(p.pH), ay + 4); ctx.lineTo(X(p.pH), ay + 8 + rows * rh); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = pal.muted; ctx.font = '500 10px JetBrains Mono, monospace'; ctx.textAlign = 'center';
  for (let ph = 4; ph <= 9; ph++) ctx.fillText(String(ph), X(ph), ay + 22 + rows * rh);
  ctx.textAlign = 'right'; ctx.fillText('now', ax + aw - 2, ay + 4);
}
function drawRoot(dt) {
  const s = S, p = s.p, pal = P();
  const day = anim.day ?? 0; const idx = Math.min(s.drift.ph.length - 1, Math.round(day / p.days * (s.drift.ph.length - 1)));
  const phNow = s.drift.ph[idx];
  drawPHScale(phNow, `tank pH on day ${fmt(day, 1)} of ${p.days}`);
  // tank + root
  const tx = 30, ty = 128, tw = W * 0.56, th = H - ty - 24;
  ctx.save(); rr(tx, ty, tw, th, 16); ctx.clip();
  ctx.fillStyle = phColor(phNow, 0.2); ctx.fillRect(tx, ty, tw, th);
  const rx = tx + tw / 2, rtop = ty - 10, rbot = ty + th * 0.92;
  const net = (1 - p.fNH4) - p.fNH4 - p.eps;     // + → OH⁻ released
  // rhizosphere halo
  const halo = ctx.createRadialGradient(rx, (rtop + rbot) / 2, 10, rx, (rtop + rbot) / 2, tw * 0.45);
  const haloPH = Math.max(3.5, Math.min(9, phNow + net * 1.6));
  halo.addColorStop(0, phColor(haloPH, 0.55)); halo.addColorStop(1, phColor(phNow, 0)); ctx.fillStyle = halo; ctx.fillRect(tx, ty, tw, th);
  // root with hairs
  const rg = ctx.createLinearGradient(rx - 26, 0, rx + 26, 0); rg.addColorStop(0, '#d9ccab'); rg.addColorStop(0.45, '#f7f1e1'); rg.addColorStop(1, '#cfc09c');
  ctx.fillStyle = rg; ctx.strokeStyle = '#bba77a'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(rx - 26, rtop); ctx.bezierCurveTo(rx - 23, rtop + th * 0.5, rx - 9, rbot - 34, rx, rbot); ctx.bezierCurveTo(rx + 9, rbot - 34, rx + 23, rtop + th * 0.5, rx + 26, rtop); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(187,167,122,0.85)'; ctx.lineWidth = 1;
  for (let i = 0; i < 34; i++) { const yy = rtop + 26 + i * (rbot - rtop - 90) / 34; const side = i % 2 ? 1 : -1; const w0 = 24 - 15 * (yy - rtop) / (rbot - rtop); const len = 12 + (i * 7) % 11; ctx.beginPath(); ctx.moveTo(rx + side * w0, yy); ctx.quadraticCurveTo(rx + side * (w0 + len * 0.6), yy + 2, rx + side * (w0 + len), yy + 7); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('root', rx, rtop + th * 0.45);
  // ion traffic
  anim.ions = anim.ions || [];
  const spawn = (kind, dir) => anim.ions.push({ kind, dir, t: 0, y: rtop + 40 + rnd() * (rbot - rtop - 100), side: rnd() < 0.5 ? -1 : 1, sp: 0.5 + rnd() * 0.5 });
  const rate = 10 * p.upN / 0.3;
  if (rnd() < dt * rate * (1 - p.fNH4)) spawn('NO3', -1);
  if (rnd() < dt * rate * p.fNH4 * 2) spawn('NH4', -1);
  if (net > 0 && rnd() < dt * rate * net) spawn('OH', 1);
  if (net < 0 && rnd() < dt * rate * -net) spawn('H', 1);
  const COL = { NO3: '#3f8fd8', NH4: '#2aa198', OH: '#1c5fa3', H: '#d63031' }, LBL = { NO3: 'NO₃⁻', NH4: 'NH₄⁺', OH: 'HCO₃⁻', H: 'H⁺' };
  for (let i = anim.ions.length - 1; i >= 0; i--) {
    const q = anim.ions[i]; q.t += dt * 0.45 * q.sp; if (q.t > 1) { anim.ions.splice(i, 1); continue; }
    const far = tw * 0.42, near = 28; const d = q.dir < 0 ? lerp(far, near, q.t) : lerp(near, far, q.t);
    const X = rx + q.side * d, Y = q.y + Math.sin(q.t * 9) * 3;
    ctx.fillStyle = COL[q.kind]; ctx.beginPath(); ctx.arc(X, Y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = '600 9px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(LBL[q.kind], X, Y - 7);
  }
  ctx.restore();
  ctx.strokeStyle = hex(pal.lineStrong, '#999'); ctx.lineWidth = 1.8; rr(tx, ty, tw, th, 16); ctx.stroke();
  ctx.fillStyle = pal.ink; ctx.font = '700 12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('Root in the solution: charge balance of uptake', tx + 12, ty + 18);
  // side panel: numbers + sparkline
  const px = tx + tw + 24, pw = W - px - 16;
  ctx.fillStyle = pal.ink2; ctx.font = '600 11.5px Inter, sans-serif';
  const lines = [
    `N uptake ${fmt(p.upN, 2)} mmol L⁻¹ d⁻¹`,
    `NO₃⁻ ${fmt((1 - p.fNH4) * 100, 0)} % · NH₄⁺ ${fmt(p.fNH4 * 100, 0)} %`,
    `other cations − anions: ε = ${fmt(p.eps, 2)}`,
    `net ${net >= 0 ? 'OH⁻ (as HCO₃⁻) out' : 'H⁺ out'}: ${fmt(Math.abs(net * p.upN), 3)} mmol L⁻¹ d⁻¹`
  ];
  lines.forEach((l, i) => ctx.fillText(l, px, ty + 18 + i * 18));
  // sparkline of pH
  const sy = ty + 100, sh = th - 130;
  ctx.strokeStyle = hex(pal.line, '#ddd'); ctx.lineWidth = 1; ctx.strokeRect(px, sy, pw, sh);
  const Y = ph => sy + sh - (ph - 3.5) / 5.5 * sh;
  ctx.fillStyle = withAlpha(hex(pal.accent, '#1d7a4a'), 0.12); ctx.fillRect(px, Y(6.5), pw, Y(5.5) - Y(6.5));
  ctx.strokeStyle = hex(pal.accent, '#1d7a4a'); ctx.lineWidth = 2; ctx.beginPath();
  s.drift.ph.forEach((ph, i) => { const x = px + i / (s.drift.ph.length - 1) * pw; i ? ctx.lineTo(x, Y(ph)) : ctx.moveTo(x, Y(ph)); }); ctx.stroke();
  const xd = px + day / p.days * pw; ctx.fillStyle = hex(pal.ink, '#1b1f22'); ctx.beginPath(); ctx.arc(xd, Y(phNow), 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.muted; ctx.font = '500 10px JetBrains Mono, monospace'; ctx.textAlign = 'left'; ctx.fillText('pH', px + 4, sy + 12); ctx.textAlign = 'right'; ctx.fillText(`${p.days} d`, px + pw - 4, sy + sh - 4);
  ctx.textAlign = 'left'; ctx.fillStyle = pal.ink; ctx.font = '700 22px JetBrains Mono, monospace'; ctx.fillText('pH ' + phNow.toFixed(2), px, sy + sh + 26);
}
function drawTitration(dt) {
  const s = S, p = s.p, pal = P();
  const a = anim.titr ?? 0; const CT0 = C.ctFromWater(s.alk0, p.pH0); const isP = C.ACIDS[p.acid].P > 0;
  const phC = C.phFromAlk(s.alk0 - a, { CT: CT0, PT: isP ? a : 0 });
  const phO = C.phFromAlk(s.alk0 - a, { PT: isP ? a : 0, open: true, co2: s.co2 });
  drawPHScale(phC, `closed tank: pH ${fmt(phC, 2)} · aerated: pH ${fmt(phO, 2)}`);
  // burette
  const bx = W * 0.2, by = 118, bh = H * 0.33;
  ctx.fillStyle = withAlpha('#ffffff', 0.5); ctx.strokeStyle = hex(pal.lineStrong, '#999'); ctx.lineWidth = 1.5; rr(bx - 9, by, 18, bh, 5); ctx.fill(); ctx.stroke();
  const frac = 1 - Math.min(1, a / Math.max(0.01, s.aMax)); ctx.fillStyle = 'rgba(214,72,60,0.45)'; ctx.fillRect(bx - 7, by + 2 + bh * (1 - frac) * 0.96, 14, bh * frac * 0.96);
  for (let i = 1; i < 10; i++) { ctx.strokeStyle = hex(pal.muted, '#888'); ctx.beginPath(); ctx.moveTo(bx - 9, by + bh * i / 10); ctx.lineTo(bx - 2, by + bh * i / 10); ctx.stroke(); }
  ctx.fillStyle = hex(pal.ink2, '#333'); ctx.fillRect(bx - 3, by + bh, 6, 14);
  ctx.font = '600 10.5px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(C.ACIDS[p.acid].label, bx + 16, by + 14); ctx.fillStyle = pal.muted; ctx.fillText(`${fmt(s.M, 2)} mol L⁻¹`, bx + 16, by + 30);
  // tank
  const tx = W * 0.07, ty = by + bh + 34, tw = W * 0.34, th = H - ty - 18;
  ctx.save(); rr(tx, ty, tw, th, 14); ctx.clip();
  const lg = ctx.createLinearGradient(0, ty, 0, ty + th); lg.addColorStop(0, phColor(phC, 0.3)); lg.addColorStop(1, phColor(phC, 0.55)); ctx.fillStyle = lg; ctx.fillRect(tx, ty + 8, tw, th);
  anim.bub = anim.bub || [];
  const fizz = (anim.running ? 1 : 0) * Math.max(0, carbonateSpecies(phC)[0]);
  if (rnd() < dt * 30 * fizz) anim.bub.push({ x: tx + tw * (0.3 + 0.4 * rnd()), y: ty + th - 6, v: 20 + rnd() * 30 });
  for (let i = anim.bub.length - 1; i >= 0; i--) { const b = anim.bub[i]; b.y -= b.v * dt; b.x += Math.sin(b.y * 0.2) * 0.3; if (b.y < ty + 10) { anim.bub.splice(i, 1); continue; } ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = hex(pal.lineStrong, '#999'); ctx.lineWidth = 1.8; rr(tx, ty, tw, th, 14); ctx.stroke();
  // drops
  anim.drops = anim.drops || [];
  if (anim.running && rnd() < dt * 8) anim.drops.push({ y: by + bh + 14, v: 0 });
  for (let i = anim.drops.length - 1; i >= 0; i--) { const d = anim.drops[i]; d.v += 600 * dt; d.y += d.v * dt; if (d.y > ty + 10) { anim.drops.splice(i, 1); continue; } ctx.fillStyle = 'rgba(214,72,60,0.8)'; ctx.beginPath(); ctx.ellipse(bx, d.y, 2.5, 3.5, 0, 0, Math.PI * 2); ctx.fill(); }
  // pH meter
  const mx = tx + tw - 124, my = ty - 66;
  ctx.fillStyle = '#18221e'; rr(mx, my, 120, 58, 9); ctx.fill();
  ctx.fillStyle = Math.abs(phC - p.tpH) < 0.1 ? '#8ef0b4' : '#ffd27a'; ctx.font = '600 10px JetBrains Mono, monospace'; ctx.textAlign = 'left'; ctx.fillText('pH (closed)', mx + 10, my + 16); ctx.font = '700 24px JetBrains Mono, monospace'; ctx.fillText(phC.toFixed(2), mx + 10, my + 44);
  ctx.strokeStyle = '#1b1f22'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(mx + 100, my + 58); ctx.bezierCurveTo(mx + 100, my + 70, tx + tw - 30, ty - 6, tx + tw - 30, ty + 30); ctx.stroke(); ctx.fillStyle = '#2b3136'; ctx.fillRect(tx + tw - 34, ty + 28, 8, th * 0.5);
  // numbers panel
  const nx = W * 0.5, ny = 124; ctx.textAlign = 'left';
  const ml = mlFor(a);
  const rows = [
    ['Water', `${fmt(p.hco3, 0)} mg L⁻¹ HCO₃⁻ = ${fmt(s.alk0, 2)} mmol L⁻¹, pH ${fmt(p.pH0, 2)}`],
    ['Acid added', `${fmt(a, 2)} mmol H⁺ L⁻¹ = ${fmt(ml, 1)} mL for ${fmt(p.vol, 0)} L`],
    ['To reach pH ' + fmt(p.tpH, 2), `${fmt(mlFor(s.doseC), 1)} mL closed · ${fmt(mlFor(s.doseO), 1)} mL aerated`],
    ['Bicarbonate left', `${fmt(Math.max(0, C.ctFromWater(s.alk0, p.pH0) * carbonateSpecies(phC)[1]), 2)} mmol L⁻¹ (closed)`],
    ['CO₂ formed', `${fmt(Math.max(0, C.ctFromWater(s.alk0, p.pH0) * carbonateSpecies(phC)[0]), 2)} mmol L⁻¹ — escapes when aerated`],
    [C.ACIDS[p.acid].P ? 'Phosphorus added' : C.ACIDS[p.acid].anion + ' added', C.ACIDS[p.acid].P ? `${fmt(a * 30.974, 0)} mg P L⁻¹` : `${fmt(a / C.ACIDS[p.acid].h * (C.ACIDS[p.acid].h === 2 ? 32.06 : 14.007), 0)} mg ${C.ACIDS[p.acid].h === 2 ? 'S' : 'N'} L⁻¹`]
  ];
  rows.forEach(([k, v], i) => { ctx.fillStyle = pal.muted; ctx.font = '600 10px JetBrains Mono, monospace'; ctx.fillText(k.toUpperCase(), nx, ny + i * 38); ctx.fillStyle = pal.ink; ctx.font = '600 13px Inter, sans-serif'; ctx.fillText(v, nx, ny + 16 + i * 38); });
  // mini curve of pH creep after dosing (closed dose, then aeration)
  const cx = nx, cy = ny + rows.length * 38 + 10, cw = W - nx - 24, ch = Math.max(60, H - cy - 30);
  ctx.strokeStyle = hex(pal.line, '#ddd'); ctx.lineWidth = 1; ctx.strokeRect(cx, cy, cw, ch);
  const Yc = ph => cy + ch - (ph - 4.5) / 4.5 * ch;
  ctx.strokeStyle = '#b23f8c'; ctx.lineWidth = 2; ctx.beginPath(); s.creep.ph.forEach((ph, i) => { const x = cx + i / (s.creep.ph.length - 1) * cw; i ? ctx.lineTo(x, Yc(ph)) : ctx.moveTo(x, Yc(ph)); }); ctx.stroke();
  ctx.strokeStyle = 'rgba(214,48,49,0.7)'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(cx, Yc(p.tpH)); ctx.lineTo(cx + cw, Yc(p.tpH)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = pal.muted; ctx.font = '500 10px Inter, sans-serif'; ctx.fillText('pH creep when a closed-tank dose is aerated (24 h)', cx + 6, cy + 13);
  ctx.font = '500 9.5px JetBrains Mono, monospace'; ctx.textAlign = 'right';
  [5, 6, 7, 8].forEach(v => ctx.fillText(String(v), cx - 4, Yc(v) + 3));
  ctx.textAlign = 'left'; ctx.fillText('0 h', cx, cy + ch + 12); ctx.textAlign = 'right'; ctx.fillText('24 h', cx + cw, cy + ch + 12);
}

/* ================================================================ animation (SimClock) */
const anim = { titr: null, day: null, running: false };
const clock = new SimClock({
  speed: 1, onStep: dt => {
    const v = ui.get('view');
    if (v === 'titr') {
      // the burette stops at the closed-tank dose, then at the aerated dose, then at the end of the curve
      const stops = [S.doseC, S.doseO, S.aMax].filter(x => x > (anim.stopFrom ?? -1) + 1e-6).sort((a, b) => a - b);
      const next = stops.length ? stops[0] : S.aMax;
      anim.titr = Math.min(next, (anim.titr ?? 0) + dt * S.aMax / 10);
      if (anim.titr >= next - 1e-9) { anim.stopFrom = next; clock.pause(); }
    }
    else { anim.day = Math.min(S.p.days, (anim.day ?? 0) + dt * S.p.days / 10); if (anim.day >= S.p.days) clock.pause(); }
  },
  onFrame: () => { chartThrottle(); }
});
clock.onState(r => { anim.running = r; btnRun.innerHTML = r ? '❚❚ Pause' : '▶ Animate'; });
function startAnim() { if (clock.running) { clock.pause(); return; } const v = ui.get('view'); if (v === 'titr' && (anim.titr ?? 0) >= S.aMax * 0.999) { anim.titr = 0; anim.stopFrom = -1; } if (v !== 'titr' && (anim.day ?? 0) >= S.p.days) anim.day = 0; if (v === 'sol') ui.set('view', 'root'); clock.play(); }
function resetAnim() { clock.pause(); anim.titr = null; anim.stopFrom = -1; anim.day = null; anim.drops = []; anim.bub = []; charts(S); }
let lastC = 0; function chartThrottle() { const n = performance.now(); if (n - lastC > 120) { lastC = n; charts(S); } }

/* ================================================================ wiring */
function update() { const s = compute(); readouts(s); charts(s); }
let raf = 0; ui.onChange(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
update();
requestAnimationFrame(frame);
