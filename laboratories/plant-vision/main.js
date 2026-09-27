/* Plant vision lab — procedural canopy images (./scene.js), classical segmentation pipeline (./vision.js),
   calibration of fresh mass against projected area, lesion detection and classifier evaluation. */
import { Controls, Readouts, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, linspace, downloadCSV } from '/assets/js/plot.js';
import { linreg, mean, classificationMetrics, mulberry32, shuffle } from '/assets/js/stats.js';
import { colormap, withAlpha, categorical } from '/assets/js/colors.js';
import { renderScene, LIGHTS, CARD } from './scene.js';
import * as V from './vision.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = v => Math.round(v * 100) + ' %';
const PV_KEY = 'ffp-plantvision-series-v1';
const STEPS = [
  { v: 'rgb', label: '1 · RGB image' }, { v: 'chroma', label: '2 · Chromatic rgb' }, { v: 'index', label: '3 · Colour index' }, { v: 'mask', label: '4 · Threshold' },
  { v: 'open', label: '5 · Opening' }, { v: 'labels', label: '6 · Components' }, { v: 'lesion', label: '7 · Lesions' }, { v: 'result', label: '8 · Result' }
];

/* ======================================================================= controls */
const ui = new Controls('#controls', { url: true });
ui.segmented({ id: 'src', label: 'Image source', options: [{ value: 'synthetic', label: 'Synthetic raft' }, { value: 'photo', label: 'My photo' }], value: 'synthetic', persist: false });
const upWrap = ui.html(`<div class="pv-upload"><label class="btn btn-sm btn-primary" for="pv-file">Upload a photo…</label><input type="file" id="pv-file" accept="image/*" hidden><span class="ctl-help">Top view, whole plants in frame, ideally with a blue 5 × 5 cm card. Processed locally — nothing leaves your computer.</span></div>`);
const secScene = ui.section('Synthetic scene');
const SCENE_IDS = ['day', 'bg', 'cult', 'prev', 'tipburn', 'light', 'bright', 'grad', 'noise', 'camH', 'seed'];
ui.slider({ id: 'day', label: 'Days after transplanting', min: 7, max: 35, step: 1, value: 21, unit: 'd' });
ui.select({ id: 'bg', label: 'Background', options: [{ value: 'black', label: 'Black raft (deep-water culture)' }, { value: 'grey', label: 'Grey plastic tray' }, { value: 'white', label: 'White polystyrene raft' }, { value: 'substrate', label: 'Coir substrate (brown)' }], value: 'black' });
ui.segmented({ id: 'cult', label: 'Cultivar', options: [{ value: 'green', label: 'Green butterhead' }, { value: 'red', label: 'Red oak leaf' }, { value: 'mixed', label: 'Mixed' }], value: 'green' });
ui.slider({ id: 'prev', label: 'Share of infected plants', min: 0, max: 0.8, step: 0.05, value: 0.35, format: pct });
ui.toggle({ id: 'tipburn', label: 'Tipburn on some plants', value: true });
ui.segmented({ id: 'light', label: 'Lighting', options: Object.entries(LIGHTS).map(([value, l]) => ({ value, label: l.label })), value: 'white' });
ui.slider({ id: 'bright', label: 'Exposure', min: 0.35, max: 1.4, step: 0.05, value: 1, format: v => '×' + v.toFixed(2) });
ui.slider({ id: 'grad', label: 'Uneven illumination', min: 0, max: 0.7, step: 0.05, value: 0.25, format: pct });
ui.slider({ id: 'noise', label: 'Sensor noise (SD)', min: 0, max: 25, step: 1, value: 4, unit: 'DN' });
ui.slider({ id: 'camH', label: 'Camera height above the tray', min: 40, max: 200, step: 5, value: 150, unit: 'cm', help: 'Closer cameras enlarge the leaves more than the card on the tray (perspective, Eq. PV6).' });
ui.number({ id: 'seed', label: 'Scene seed', value: 2, step: 1, min: 1 });
ui.section('Colour correction');
ui.toggle({ id: 'wb', label: 'White-balance on the card’s white border', value: false });
ui.section('Segmentation');
ui.select({ id: 'idx', label: 'Colour index', options: Object.entries(V.INDICES).map(([value, x]) => ({ value, label: x.label })), value: 'exg' });
ui.segmented({ id: 'thr', label: 'Threshold', options: [{ value: 'otsu', label: 'Otsu (automatic)' }, { value: 'manual', label: 'Manual' }], value: 'otsu', help: 'Tip: drag in the histogram to set a manual threshold.' });
ui.slider({ id: 't_exg', label: 'ExG threshold', min: -0.4, max: 0.8, step: 0.005, value: 0.1, digits: 3 });
ui.slider({ id: 't_exgr', label: 'ExG − ExR threshold', min: -1.2, max: 1.2, step: 0.01, value: 0, digits: 2 });
ui.slider({ id: 't_gcc', label: 'g threshold', min: 0.2, max: 0.7, step: 0.002, value: 0.37, digits: 3 });
ui.slider({ id: 't_lab', label: '−a* threshold', min: -40, max: 60, step: 0.5, value: 8, digits: 1 });
ui.slider({ id: 'hmin', label: 'Hue from', min: 0, max: 360, step: 1, value: 55, unit: '°' });
ui.slider({ id: 'hmax', label: 'Hue to', min: 0, max: 360, step: 1, value: 175, unit: '°' });
ui.slider({ id: 'smin', label: 'Minimum saturation', min: 0, max: 1, step: 0.01, value: 0.2 });
ui.slider({ id: 'open', label: 'Opening radius (square element)', min: 0, max: 6, step: 1, value: 2, unit: 'px' });
ui.toggle({ id: 'fill', label: 'Fill holes inside plants', value: true, help: 'Pale hearts and midribs can fall below the threshold; background that the image border cannot reach is filled.' });
ui.slider({ id: 'minA', label: 'Ignore objects smaller than', min: 0, max: 20, step: 0.5, value: 3, unit: 'cm²' });
ui.segmented({ id: 'assign', label: 'One plant =', options: [{ value: 'cc', label: 'Connected component' }, { value: 'grid', label: 'Nearest planting hole' }], value: 'cc', help: 'When canopies touch, components merge; assigning pixels to the nearest hole of a known raft grid keeps plants apart.' });
ui.toggle({ id: 'inclLes', label: 'Count lesion pixels as plant area', value: true });
ui.section('Scale');
ui.segmented({ id: 'ref', label: 'Reference', options: [{ value: 'card', label: 'Blue card (auto)' }, { value: 'click', label: 'Click two points' }], value: 'card' });
ui.number({ id: 'refLen', label: 'Card side / clicked length', value: 5, step: 0.1, min: 0.1, unit: 'cm' });
ui.toggle({ id: 'persp', label: 'Correct areas to canopy height', value: false, help: 'Eq. PV6: multiply by ((D − h)/D)², D = camera height, h = canopy height.' });
ui.slider({ id: 'hc', label: 'Canopy height above the reference h', min: 0, max: 20, step: 0.5, value: 8, unit: 'cm' });
ui.section('Calibration: fresh mass from area');
ui.slider({ id: 'calFrac', label: 'Plants harvested for calibration', min: 0.25, max: 0.75, step: 0.05, value: 0.5, format: pct });
ui.segmented({ id: 'calModel', label: 'Calibration model', options: [{ value: 'power', label: 'Power law W = aAᵇ' }, { value: 'linear', label: 'Straight line' }], value: 'power' });
ui.number({ id: 'calA', label: 'Your photo: a (W = aAᵇ)', value: 0.122, step: 0.001, min: 0 });
ui.number({ id: 'calB', label: 'Your photo: b', value: 1.18, step: 0.01, min: 0 });
ui.section('Disease detection');
ui.slider({ id: 'lhmax', label: 'Brown: hue up to', min: 15, max: 70, step: 1, value: 45, unit: '°' });
ui.slider({ id: 'lsmin', label: 'Brown: minimum saturation', min: 0.1, max: 0.8, step: 0.01, value: 0.3 });
ui.slider({ id: 'tau', label: 'Flag a plant when lesions exceed', min: 0, max: 0.1, step: 0.0025, value: 0.01, format: v => (v * 100).toFixed(2) + ' %' });
ui.section('View');
ui.select({ id: 'view', label: 'Pipeline step on the stage', options: STEPS.map(s => ({ value: s.v, label: s.label })), value: 'result' });
ui.buttons([{ label: 'Photograph the crop every 3 days', variant: 'primary', onClick: () => timeSeries() }]);
ui.buttons([{ label: 'Per-plant table (CSV)', onClick: () => dlTable() }, { label: 'Image series (CSV)', onClick: () => dlSeries() }]);
ui.presets([
  { label: 'Ideal: black raft, white LED', values: { src: 'synthetic', bg: 'black', light: 'white', cult: 'green', bright: 1, grad: 0.25, noise: 4, idx: 'exg', thr: 'otsu', wb: false, day: 21, assign: 'cc' } },
  { label: 'Red + blue LEDs', values: { src: 'synthetic', light: 'redblue', bg: 'black', cult: 'green', idx: 'exg', thr: 'otsu', wb: false, assign: 'cc' } },
  { label: '… white-balanced', values: { src: 'synthetic', light: 'redblue', bg: 'black', cult: 'green', idx: 'exg', thr: 'otsu', wb: true, assign: 'cc' } },
  { label: 'Canopies touching (day 33)', values: { src: 'synthetic', day: 33, bg: 'black', light: 'white', assign: 'cc', idx: 'exg', thr: 'otsu' } },
  { label: 'Red lettuce on coir', values: { src: 'synthetic', cult: 'red', bg: 'substrate', light: 'white', idx: 'exg', thr: 'otsu', wb: false, assign: 'cc' } }
]);
ui.saveButton('plant-vision', () => ro.values());

/* ======================================================================= readouts */
const ro = new Readouts('#readouts');
ro.add({ id: 'objs', label: 'Plants found / in image', unit: '', format: v => v })
  .add({ id: 'iou', label: 'Segmentation IoU (vs truth)', unit: '', digits: 3 })
  .add({ id: 'scale', label: 'Pixel scale s', unit: 'mm px⁻¹', digits: 3 })
  .add({ id: 'bias', label: 'Area error vs true projected area', unit: '%', digits: 1 })
  .add({ id: 'cal', label: 'Calibration R² (log–log)', unit: '', digits: 3 })
  .add({ id: 'rmse', label: 'Fresh-mass estimate RMSE', unit: 'g', digits: 1 })
  .add({ id: 'f1', label: 'Symptom detection F1', unit: '', digits: 2 })
  .add({ id: 'thr', label: 'Threshold used', unit: '', format: v => v });

/* ======================================================================= stage */
const stageEl = $('#stage');
const cv = document.createElement('canvas'); cv.className = 'pv-canvas'; stageEl.appendChild(cv); const ctx = cv.getContext('2d', { willReadFrequently: true });
const hud = hudChips(stageEl);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'plant-vision-' + ui.get('view') + '.png'; a.click(); } });
const tip = document.createElement('div'); tip.className = 'pv-tip'; tip.hidden = true; stageEl.appendChild(tip);
const strip = $('#pv-strip');
strip.innerHTML = STEPS.map(s => `<button type="button" data-v="${s.v}" aria-label="${esc(s.label)}"><canvas width="160" height="100"></canvas><span>${esc(s.label)}</span></button>`).join('');
strip.querySelectorAll('button').forEach(b => b.addEventListener('click', () => ui.set('view', b.dataset.v)));

/* ======================================================================= charts */
const chHist = new Plot('#ch-hist', { x: { label: 'Colour index' }, y: { label: 'Pixels', min: 0 }, y2: { label: 'Between-class variance σ²_B', min: 0 }, legend: true, crosshair: false });
const chCal = new Plot('#ch-cal', { x: { label: 'Measured projected area', unit: 'cm²', min: 0 }, y: { label: 'Fresh mass', unit: 'g', min: 0 }, legend: true, crosshair: false });
const chEst = new Plot('#ch-est', { x: { label: 'True fresh mass (weighed)', unit: 'g', min: 0 }, y: { label: 'Estimated from the photo', unit: 'g', min: 0 }, legend: true, crosshair: false });
const chPR = new Plot('#ch-pr', { x: { label: 'Lesion-share threshold τ', unit: '%', min: 0, max: 10 }, y: { label: 'Score', min: 0, max: 1.02 }, legend: true, crosshair: true });
const chTS = new Plot('#ch-ts', { x: { label: 'Days after transplanting', unit: 'd', min: 5, max: 37 }, y: { label: 'Projected leaf area', unit: 'cm²', min: 0 }, legend: true });

/* ======================================================================= state */
let SCENE = null, sceneKey = '', PHOTO = null, R = null, CLICK = [], SERIES = null;
const P = () => ui.values();

function getImage() {
  const p = P();
  if (p.src === 'photo' && PHOTO) return { imageData: PHOTO.imageData, W: PHOTO.W, H: PHOTO.H, photo: true };
  const key = SCENE_IDS.map(k => p[k]).join('|');
  if (key !== sceneKey) { SCENE = renderScene({ seed: Math.round(p.seed) || 1, day: p.day, background: p.bg, cultivar: p.cult, prevalence: p.prev, tipburn: p.tipburn, light: p.light, brightness: p.bright, gradient: p.grad, noise: p.noise, camH: p.camH }); sceneKey = key; }
  return SCENE;
}

/** Run the full pipeline on an image; returns everything needed for views, tables and charts. */
function pipeline(S, p, light = false) {
  const img = S.imageData, W = S.W, H = S.H, n = W * H;
  // colour stage (depends only on the image and the white balance) — cached on the image object
  let K = S._col;
  if (!K || K.wb !== !!p.wb) {
    const C0 = V.channels(img); const ch0 = V.chromatic(C0);
    const card = K ? K.card : V.findBlueCard(C0, ch0);
    let gains = [1, 1, 1];
    if (p.wb && card) { const [x0, y0, x1, y1] = card.bbox; const side = x1 - x0 + 1, e = side * (CARD.size - CARD.inner) / (2 * CARD.inner); gains = V.whiteGains(img, { x0: x0 - e, y0: y0 - e, x1: x1 + e, y1: y1 + e }, CARD.inner / CARD.size); }
    const C = gains.every(g => g === 1) ? C0 : V.channels(img, gains); const ch = C === C0 ? ch0 : V.chromatic(C);
    K = S._col = { wb: !!p.wb, C, ch, hs: V.hsv(C), card, gains, idx: {}, hist: {} };
  }
  const { C, ch, hs, card, gains } = K;
  const I = K.idx[p.idx] || (K.idx[p.idx] = V.colourIndex(p.idx, C, ch, hs));
  // threshold
  const veg = new Uint8Array(n); let t = NaN, h = null, ot = null;
  if (p.idx === 'hsv') { for (let i = 0; i < n; i++) { const hh = hs.H[i]; veg[i] = (p.hmin <= p.hmax ? hh >= p.hmin && hh <= p.hmax : hh >= p.hmin || hh <= p.hmax) && hs.S[i] >= p.smin && hs.V[i] >= 0.1 ? 1 : 0; } h = K.hist.hsv || (K.hist.hsv = V.hist(I, 0, 360, 120)); }
  else {
    if (!K.hist[p.idx]) { const [lo, hi] = V.pRange(I, 0.002, 0.998); const hh = V.hist(I, lo, hi, 128); K.hist[p.idx] = { h: hh, ot: V.otsu(hh) }; }
    h = K.hist[p.idx].h; ot = K.hist[p.idx].ot; t = p.thr === 'otsu' ? ot.t : p['t_' + p.idx]; for (let i = 0; i < n; i++) veg[i] = I[i] > t ? 1 : 0;
  }
  const opened = V.opening(veg, W, H, Math.round(p.open));
  // lesions: brown pixels (low hue, saturated, not too dark/bright) close to vegetation
  const cand = new Uint8Array(n); for (let i = 0; i < n; i++) cand[i] = !opened[i] && (hs.H[i] <= p.lhmax || hs.H[i] >= 350) && hs.S[i] >= p.lsmin && hs.V[i] >= 0.1 && hs.V[i] <= 0.85 ? 1 : 0;
  // scale
  let s = NaN, scaleNote = '';
  if (p.ref === 'card' && card) { s = p.refLen / Math.sqrt(card.area); scaleNote = `blue card: ${card.area} px → ${fmt(Math.sqrt(card.area), 1)} px per ${p.refLen} cm`; }
  else if (p.ref === 'click' && CLICK.length === 2) { const dpx = Math.hypot(CLICK[1][0] - CLICK[0][0], CLICK[1][1] - CLICK[0][1]); s = p.refLen / dpx; scaleNote = `clicked ${fmt(dpx, 0)} px = ${p.refLen} cm`; }
  else if (!S.photo) { s = 1 / S.pxPerCm; scaleNote = 'no reference found — nominal 12 px cm⁻¹ used'; }
  else scaleNote = p.ref === 'card' ? 'no blue card found — click two points on a ruler' : 'click two points on a known length';
  const near = V.dilate(opened, W, H, Math.max(2, Math.round((Number.isFinite(s) ? 0.8 / s : 10))));
  const lesion = new Uint8Array(n); for (let i = 0; i < n; i++) lesion[i] = cand[i] && near[i] ? 1 : 0;
  let obj = new Uint8Array(n); for (let i = 0; i < n; i++) obj[i] = opened[i] || (p.inclLes && lesion[i]) ? 1 : 0;
  if (p.fill) obj = V.fillHoles(obj, W, H);
  const minPx = Number.isFinite(s) ? p.minA / (s * s) : 60;
  // objects
  let labels, comps;
  if (p.assign === 'grid' && S.grid) {
    // drop small specks first, then give every remaining plant pixel to the nearest planting position
    const cc0 = V.components(obj, W, H); const big = new Uint8Array(cc0.comps.length + 2); cc0.comps.forEach(c => { big[c.label] = c.area >= minPx ? 1 : 0; });
    labels = new Int32Array(n); const G = S.grid;
    for (let i = 0; i < n; i++) { if (!obj[i] || !big[cc0.labels[i]]) continue; const x = i % W, y = (i - x) / W; let b = 0, bd = Infinity; for (let k = 0; k < G.length; k++) { const d = (G[k].x - x) ** 2 + (G[k].y - y) ** 2; if (d < bd) { bd = d; b = k; } } labels[i] = b + 1; }
    comps = G.map((g, k) => ({ label: k + 1, area: 0, sx: 0, sy: 0 }));
    for (let i = 0; i < n; i++) if (labels[i]) { const c = comps[labels[i] - 1]; c.area++; c.sx += i % W; c.sy += Math.floor(i / W); }
    comps.forEach(c => { c.cx = c.area ? c.sx / c.area : 0; c.cy = c.area ? c.sy / c.area : 0; });
  } else { const cc = V.components(obj, W, H); labels = cc.labels; comps = cc.comps; }
  const keep = new Uint8Array(comps.length + 2); comps.forEach(c => { keep[c.label] = c.area >= minPx ? 1 : 0; });
  if (!p.inclLes) labels = V.growInto(labels, lesion, W, H);
  // per-object pixel counts
  const nObj = comps.length + 1; const vegPx = new Int32Array(nObj + 1), lesPx = new Int32Array(nObj + 1);
  const NG = 16, gtVotes = S.gtPlant ? new Int32Array((nObj + 1) * NG) : null; const gtP = S.gtPlant;
  for (let i = 0; i < n; i++) { const l = labels[i]; if (!l || !keep[l]) continue; if (lesion[i]) lesPx[l]++; else if (obj[i]) vegPx[l]++; if (gtVotes && gtP[i] >= 0) gtVotes[l * NG + gtP[i]]++; }
  const persp = p.persp ? ((p.camH - p.hc) / p.camH) ** 2 : 1;
  const objs = comps.filter(c => keep[c.label]).map(c => {
    const l = c.label; const px = vegPx[l] + (p.inclLes ? lesPx[l] : 0);
    let gt = -1, gv = 0, gsum = 0; if (gtVotes) for (let k = 0; k < NG; k++) { const v = gtVotes[l * NG + k]; gsum += v; if (v > gv) { gv = v; gt = k; } }
    return { label: l, cx: c.cx, cy: c.cy, px, vegPx: vegPx[l], lesPx: lesPx[l], area: Number.isFinite(s) ? px * s * s * persp : NaN, lesFrac: lesPx[l] / Math.max(1, vegPx[l] + lesPx[l]), gt, purity: gsum ? gv / gsum : 1 };
  }).sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  objs.forEach((o, k) => { o.name = `#${k + 1}`; });
  // segmentation quality against ground truth (vegetation incl. necrotic tissue)
  let iou = NaN, segP = NaN, segR = NaN;
  if (S.gtPlant) { let tp = 0, fp = 0, fn = 0; for (let i = 0; i < n; i++) { const g = S.gtPlant[i] >= 0, m = obj[i] === 1; if (g && m) tp++; else if (m) fp++; else if (g) fn++; } iou = tp / (tp + fp + fn); segP = tp / (tp + fp); segR = tp / (tp + fn); }
  const out = { W, H, C, ch, hs, I, veg, opened, lesion, obj, labels, keep, objs, card, gains, t, h, ot, s, scaleNote, iou, segP, segR, persp, photo: !!S.photo };
  if (!light) out.views = null;
  return out;
}

/** Per-true-plant results (synthetic): measured area, lesion share, truth, calibration split. */
function perPlant(S, Rr, p) {
  if (!S.plants) return null;
  const rows = S.plants.map(pl => ({ pl, objs: Rr.objs.filter(o => o.gt === pl.id) }));
  rows.forEach(r => { r.area = r.objs.reduce((s, o) => s + o.area, 0); r.px = r.objs.reduce((s, o) => s + o.px, 0); const les = r.objs.reduce((s, o) => s + o.lesPx, 0), veg = r.objs.reduce((s, o) => s + o.vegPx, 0); r.lesFrac = les / Math.max(1, les + veg); r.found = r.objs.length > 0; r.merged = r.objs.some(o => o.purity < 0.8); r.ok = r.found && !r.merged; r.symptoms = r.pl.diseased || (r.pl.tipburn && p.day >= 14); });
  // merged objects (outline contains > 20 % of another plant — visible in the image) are credited to the majority plant but excluded from calibration and estimates
  const ids = shuffle(rows.map((_, i) => i), mulberry32(Math.round(p.seed) * 13 + 5)); const nCal = Math.max(3, Math.round(p.calFrac * rows.length));
  ids.forEach((i, k) => { rows[i].cal = k < nCal; });
  return rows;
}
function calibrate(rows, p) {
  const cal = rows.filter(r => r.cal && r.ok && r.area > 0);
  if (cal.length < 3) return null;
  if (p.calModel === 'power') {
    const L = linreg(cal.map(r => Math.log(r.area)), cal.map(r => Math.log(r.pl.fw)));
    const a = Math.exp(L.intercept), b = L.slope;
    return { a, b, r2: L.r2, n: cal.length, predict: A => a * Math.pow(A, b), band: A => L.piObs(Math.log(A)).map(Math.exp), model: 'power', L };
  }
  const L = linreg(cal.map(r => r.area), cal.map(r => r.pl.fw));
  return { a: L.intercept, b: L.slope, r2: L.r2, n: cal.length, predict: A => L.intercept + L.slope * A, band: A => L.piObs(A), model: 'linear', L };
}

/* ======================================================================= views */
/** Pixel painter for one pipeline view (specialised once per view for speed). */
function viewFn(view, Rr) {
  const { C, ch, I, veg, opened, lesion, labels, keep, obj } = Rr; const Rc = C.R, Gc = C.G, Bc = C.B;
  switch (view) {
    case 'rgb': return (i, out, o) => { out[o] = Rc[i]; out[o + 1] = Gc[i]; out[o + 2] = Bc[i]; };
    case 'chroma': return (i, out, o) => { out[o] = Math.min(255, ch.r[i] * 400); out[o + 1] = Math.min(255, ch.g[i] * 400); out[o + 2] = Math.min(255, ch.b[i] * 400); };
    case 'index': { const lut = Rr.lut, lo = Rr.vlo, sc = 255 / (Rr.vhi - Rr.vlo); return (i, out, o) => { let k = Math.round((I[i] - lo) * sc); k = k < 0 ? 0 : k > 255 ? 255 : k; out[o] = lut[3 * k]; out[o + 1] = lut[3 * k + 1]; out[o + 2] = lut[3 * k + 2]; }; }
    case 'mask': return (i, out, o) => { const v = veg[i] ? 245 : 18; out[o] = out[o + 1] = out[o + 2] = v; };
    case 'open': return (i, out, o) => { if (opened[i]) { out[o] = out[o + 1] = out[o + 2] = 245; } else if (veg[i]) { out[o] = 235; out[o + 1] = 60; out[o + 2] = 60; } else { out[o] = out[o + 1] = out[o + 2] = 18; } };
    case 'labels': { const lc = Rr.lcol; return (i, out, o) => { const l = labels[i]; if (l && keep[l]) { const c = lc[l % lc.length]; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; } else if (obj[i]) { out[o] = out[o + 1] = out[o + 2] = 90; } else { out[o] = out[o + 1] = out[o + 2] = 16; } }; }
    case 'lesion': return (i, out, o) => { const gy = 0.3 * Rc[i] + 0.59 * Gc[i] + 0.11 * Bc[i]; if (lesion[i]) { out[o] = 255; out[o + 1] = 40; out[o + 2] = 200; } else if (opened[i]) { out[o] = gy * 0.35; out[o + 1] = 70 + gy * 0.6; out[o + 2] = gy * 0.35; } else { out[o] = out[o + 1] = out[o + 2] = gy * 0.45; } };
    default: return (i, out, o) => { if (lesion[i] && labels[i] && keep[labels[i]]) { out[o] = 255; out[o + 1] = 40; out[o + 2] = 200; } else { out[o] = Rc[i]; out[o + 1] = Gc[i]; out[o + 2] = Bc[i]; } };
  }
}
function prepareViewColours(Rr, p) {
  if (p.idx === 'hsv') { Rr.cmap = 'turbo'; Rr.vlo = 0; Rr.vhi = 360; }
  else { const [lo, hi] = V.INDICES[p.idx].range; const [a, b] = V.pRange(Rr.I, 0.005, 0.995); Rr.vlo = Math.max(lo, a); Rr.vhi = Math.min(hi, b); if (Rr.vhi <= Rr.vlo) { Rr.vlo = a; Rr.vhi = b + 1e-6; } Rr.cmap = 'rdylgn'; }
  Rr.lcol = Array.from({ length: 24 }, (_, k) => { const h = (k * 137.5) % 360; const c = hslToRgb(h / 360, 0.65, 0.55); return c; });
  Rr.lut = new Uint8Array(768); for (let k = 0; k < 256; k++) { const c = colormap(Rr.cmap, k / 255); Rr.lut[3 * k] = c[0]; Rr.lut[3 * k + 1] = c[1]; Rr.lut[3 * k + 2] = c[2]; }
}
function hslToRgb(h, s, l) { const f = n => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); }; return [f(0), f(8), f(4)]; }
let bigImg = null;
function drawStage() {
  if (!R) return; const p = P(); const { W, H } = R; const view = p.view;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; bigImg = null; }
  if (!bigImg) bigImg = ctx.createImageData(W, H);
  const d = bigImg.data; const vf = viewFn(view, R); for (let i = 0, o = 0; i < W * H; i++, o += 4) { vf(i, d, o); d[o + 3] = 255; }
  ctx.putImageData(bigImg, 0, 0);
  // overlays
  if (view === 'result' || view === 'labels') drawOutlines(view === 'result');
  if (R.card) { const [x0, y0, x1, y1] = R.card.bbox; ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.strokeRect(x0 - 3, y0 - 3, x1 - x0 + 7, y1 - y0 + 7); ctx.setLineDash([]); ctx.fillStyle = '#ffd24a'; ctx.font = '600 13px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`reference ${p.refLen} cm`, Math.max(4, x0 - 20), Math.min(H - 6, y1 + 22)); }
  if (CLICK.length) { ctx.strokeStyle = '#ffd24a'; ctx.fillStyle = '#ffd24a'; ctx.lineWidth = 2; ctx.beginPath(); CLICK.forEach(([x, y], k) => { k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); CLICK.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); }); }
  if (p.assign === 'grid' && SCENE && SCENE.grid && !R.photo) { ctx.fillStyle = 'rgba(255,210,74,.9)'; SCENE.grid.forEach(g => { ctx.beginPath(); ctx.arc(g.x, g.y, 3.5, 0, Math.PI * 2); ctx.fill(); }); }
  hud.set('view', `Step: <b>${STEPS.find(s => s.v === view).label}</b>`);
  hud.set('info', view === 'index' || view === 'mask' ? `${V.INDICES[p.idx].label}${Number.isFinite(R.t) ? ` · threshold <b>${fmt(R.t, 3)}</b>${p.thr === 'otsu' && p.idx !== 'hsv' ? ' (Otsu)' : ''}` : ''}` : view === 'open' ? `opening radius <b>${p.open}</b> px · red = removed pixels` : view === 'lesion' ? 'magenta = brown (necrotic) pixels next to plants' : `<b>${R.objs.length}</b> objects · s = <b>${fmt(R.s * 10, 3)}</b> mm px⁻¹`);
}
function drawOutlines(labelsToo) {
  const { W, H, labels, keep } = R; const img = ctx.getImageData(0, 0, W, H); const d = img.data;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; const l = labels[i]; if (!l || !keep[l]) continue;
    if (labels[i - 1] !== l || labels[i + 1] !== l || labels[i - W] !== l || labels[i + W] !== l) { const o = i * 4; d[o] = 255; d[o + 1] = 230; d[o + 2] = 60; }
  }
  ctx.putImageData(img, 0, 0);
  if (!labelsToo) return;
  const rows = R.rows; ctx.textAlign = 'center';
  R.objs.forEach(o => {
    const r = rows ? rows.find(q => q.pl.id === o.gt) : null;
    const flagged = o.lesFrac >= ui.get('tau');
    const est = R.cal ? R.cal.predict(o.area) : (R.photo ? ui.get('calA') * Math.pow(o.area, ui.get('calB')) : NaN);
    const l1 = `${o.name}${flagged ? ' ⚠' : ''}`, l2 = Number.isFinite(o.area) ? `${fmt(o.area, 0)} cm²` : `${o.px} px`, l3 = Number.isFinite(est) ? `≈ ${fmt(est, 0)} g` : '';
    ctx.font = '700 13px Inter, sans-serif'; const w = Math.max(ctx.measureText(l2).width, ctx.measureText(l3).width, 40) + 12;
    ctx.fillStyle = flagged ? 'rgba(120,20,90,.82)' : 'rgba(8,14,12,.72)'; ctx.fillRect(o.cx - w / 2, o.cy - 26, w, l3 ? 50 : 36);
    ctx.fillStyle = '#fff'; ctx.fillText(l1, o.cx, o.cy - 12); ctx.font = '500 11.5px "JetBrains Mono", monospace'; ctx.fillStyle = '#e7f5ec'; ctx.fillText(l2, o.cx, o.cy + 3); if (l3) ctx.fillText(l3, o.cx, o.cy + 17);
    if (r && r.cal) { ctx.fillStyle = '#ffd24a'; ctx.fillText('harvested', o.cx, o.cy + 31); }
  });
}
function drawStrip() {
  if (!R) return; const p = P(); const tw = 160, th = Math.round(160 * R.H / R.W);
  strip.querySelectorAll('button').forEach(b => {
    const c = b.querySelector('canvas'); if (c.height !== th) c.height = th; const cx = c.getContext('2d'); const im = cx.createImageData(tw, th); const step = R.W / tw; const vf = viewFn(b.dataset.v, R);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const i = Math.floor(y * step) * R.W + Math.floor(x * step); const o = (y * tw + x) * 4; vf(i, im.data, o); im.data[o + 3] = 255; }
    cx.putImageData(im, 0, 0); b.setAttribute('aria-pressed', b.dataset.v === p.view);
  });
}

/* ======================================================================= charts & tables */
function drawHist() {
  chHist.clear(); if (!R || !R.h) return; const p = P(); const h = R.h;
  chHist.ax.x.label = p.idx === 'hsv' ? 'Hue (°)' : V.INDICES[p.idx].label;
  const ymax = Math.max(...h.counts) * 1.08;
  chHist.setAxis('x', { min: h.lo, max: h.hi }); chHist.setAxis('y', { min: 0, max: ymax });
  chHist.custom('bars', (c, pl, pal) => { const thr = R.t; h.counts.forEach((v, k) => { const x0 = pl.px(h.lo + k * h.w), x1 = pl.px(h.lo + (k + 1) * h.w); const mid = h.lo + (k + 0.5) * h.w; const isVeg = p.idx === 'hsv' ? (mid >= p.hmin && mid <= p.hmax) : mid > thr; c.fillStyle = withAlpha(isVeg ? pal.accent : pal.muted, 0.7); c.fillRect(x0, pl.py(v), Math.max(1, x1 - x0 - 0.5), pl.py(0) - pl.py(v)); }); });
  chHist.line('dummy', [h.lo, h.hi], [0, 0], { color: 'muted', width: 0.5, noTip: true });
  if (R.ot) { const sb = Array.from(R.ot.sigmaB); chHist.line('sb', h.centres.map((c, k) => h.lo + (k + 1) * h.w), sb, { color: 'magenta', width: 1.8, y2: true, label: 'Otsu: σ²_B(t)' }); }
  if (Number.isFinite(R.t)) chHist.vline('t', R.t, { color: 'amber', label: `threshold ${fmt(R.t, 3)}` });
  if (R.ot && p.thr === 'manual') chHist.vline('to', R.ot.t, { color: 'magenta', dash: [2, 3], label: 'Otsu' });
  if (p.idx === 'hsv') { chHist.vline('h0', p.hmin, { color: 'amber', label: 'from' }); chHist.vline('h1', p.hmax, { color: 'amber', label: 'to' }); }
}
let dragT = false;
chHist.on('pointerdown', e => { if (!e.inside || P().idx === 'hsv') return; dragT = true; setManualT(e.x); });
chHist.on('pointermove', e => { if (dragT && e.inside) setManualT(e.x); });
chHist.on('pointerup', () => { dragT = false; });
function setManualT(x) { const p = P(); const [lo, hi] = V.INDICES[p.idx].range; ui.set('t_' + p.idx, Math.min(hi, Math.max(lo, x)), true); if (p.thr !== 'manual') ui.set('thr', 'manual', true); schedule(); }

function drawCalib() {
  chCal.clear(); chEst.clear(); const rows = R && R.rows; const c = R && R.cal;
  if (!rows || !c) { $('#ch-cal-sub').textContent = R && R.photo ? 'Your photo has no weighed plants. The labels on the stage use W = aAᵇ with the a and b you set under Calibration.' : 'Too few plants with a measured area for calibration.'; $('#ch-est-sub').textContent = ''; return; }
  const cal = rows.filter(r => r.cal && r.ok), val = rows.filter(r => !r.cal && r.ok);
  const Amax = Math.max(...rows.filter(r => r.ok).map(r => r.area), 10) * 1.1; const xs = linspace(Math.max(1, Amax * 0.01), Amax, 80);
  const band = xs.map(c.band); chCal.band('pi', xs, band.map(b => Math.max(0, b[0])), band.map(b => b[1]), { color: 'accent', alpha: 0.14, label: '95 % prediction interval' });
  chCal.line('fit', xs, xs.map(c.predict), { color: 'accent', width: 2.4, label: c.model === 'power' ? `W = ${fmt(c.a, 3)}·A^${fmt(c.b, 2)}` : `W = ${fmt(c.a, 1)} + ${fmt(c.b, 3)}·A` });
  chCal.scatter('cal', cal.map(r => r.area), cal.map(r => r.pl.fw), { color: 'accent', r: 5, label: `harvested for calibration (${cal.length})` });
  chCal.scatter('val', val.map(r => r.area), val.map(r => r.pl.fw), { color: 'magenta', r: 5, hollow: true, label: `other plants (true mass, ${val.length})` });
  chCal.setAxis('x', { min: 0, max: Amax }); chCal.setAxis('y', { min: 0, max: Math.max(...rows.map(r => r.pl.fw), ...cal.map(r => c.predict(r.area))) * 1.35 });
  $('#ch-cal-sub').innerHTML = `Destructive calibration: the harvested plants were weighed; ${c.model === 'power' ? 'a power law was fitted on the log–log scale' : 'a straight line was fitted'} (R² = ${fmt(c.r2, 3)}, n = ${c.n}). Hollow points are the plants that stay in the raft.`;
  const est = val.map(r => c.predict(r.area)); const tru = val.map(r => r.pl.fw); const mx = Math.max(...tru, ...est.filter(Number.isFinite), 10) * 1.1;
  chEst.line('one', [0, mx], [0, mx], { color: 'muted', dash: [4, 4], label: '1 : 1', width: 1.2 });
  chEst.scatter('e', tru, est, { color: 'magenta', r: 5.5, label: 'non-destructive estimate' });
  chEst.setAxis('x', { min: 0, max: mx }); chEst.setAxis('y', { min: 0, max: mx });
  const err = est.map((e, i) => e - tru[i]); const rmse = Math.sqrt(mean(err.map(e => e * e))); const mape = mean(err.map((e, i) => Math.abs(e) / tru[i])) * 100;
  R.rmse = rmse; R.mape = mape;
  $('#ch-est-sub').innerHTML = `${val.length} plants estimated from the photo alone: RMSE <b>${fmt(rmse, 1)} g</b>, mean absolute percentage error <b>${fmt(mape, 1)} %</b>.`;
}
function drawDisease() {
  const el = $('#pv-cm'); chPR.clear(); const rows = R && R.rows;
  if (!rows) { el.innerHTML = '<p class="muted">No ground truth for your own photo — inspect the magenta pixels in step 7 and the flagged plants (⚠) instead.</p>'; return; }
  const tau = ui.get('tau'); let tp = 0, fp = 0, tn = 0, fn = 0;
  rows.forEach(r => { const pred = r.found && r.lesFrac >= tau; r.pred = pred; if (r.symptoms && pred) tp++; else if (!r.symptoms && pred) fp++; else if (r.symptoms) fn++; else tn++; });
  const m = classificationMetrics(tp, fp, tn, fn); R.metrics = m;
  const f = v => (Number.isFinite(v) ? fmt(v, 2) : '—');
  el.innerHTML = `<table class="pv-cm"><tr><td></td><th>truth: symptoms</th><th>truth: healthy</th></tr>
    <tr><th class="pv-rh">flagged</th><td class="tp">${tp}<small>TP</small></td><td class="fp">${fp}<small>FP</small></td></tr>
    <tr><th class="pv-rh">not flagged</th><td class="fn">${fn}<small>FN</small></td><td class="tn">${tn}<small>TN</small></td></tr></table>
    <dl class="kv pv-kv"><dt>Precision</dt><dd>${f(m.precision)}</dd><dt>Recall</dt><dd>${f(m.recall)}</dd><dt>F1</dt><dd>${f(m.f1)}</dd><dt>Accuracy</dt><dd>${f(m.accuracy)}</dd><dt>Specificity</dt><dd>${f(m.specificity)}</dd></dl>`;
  const taus = linspace(0, 0.1, 41); const P_ = [], Rc = [], F = [];
  taus.forEach(t => { let a = 0, b = 0, c = 0, d = 0; rows.forEach(r => { const pr = r.found && r.lesFrac >= t; if (r.symptoms && pr) a++; else if (!r.symptoms && pr) b++; else if (r.symptoms) d++; else c++; }); const mm = classificationMetrics(a, b, c, d); P_.push(Number.isFinite(mm.precision) ? mm.precision : NaN); Rc.push(mm.recall); F.push(Number.isFinite(mm.f1) ? mm.f1 : 0); });
  const tx = taus.map(t => t * 100);
  chPR.line('p', tx, P_, { color: 'water', width: 2, label: 'precision' }); chPR.line('r', tx, Rc, { color: 'magenta', width: 2, label: 'recall' }); chPR.line('f', tx, F, { color: 'accent', width: 2.6, label: 'F1' });
  chPR.vline('tau', tau * 100, { color: 'amber', label: `τ = ${(tau * 100).toFixed(2)} %` });
}
function drawTable() {
  const el = $('#pv-table'); if (!R) return; const tau = ui.get('tau');
  if (R.rows) {
    el.innerHTML = `<caption>Every plant in the synthetic image: what the pipeline measured and the ground truth. “Harvested” plants were weighed to calibrate the area–mass relation; the others are estimated from the photo.</caption><thead><tr><th>Plant</th><th>Object(s)</th><th class="num">Measured area (cm²)</th><th class="num">True area (cm²)</th><th class="num">Area error</th><th class="num">Est. mass (g)</th><th class="num">True mass (g)</th><th class="num">Lesion share</th><th>Flagged</th><th>Truth</th></tr></thead><tbody>` +
      R.rows.map(r => { const est = r.ok && R.cal ? R.cal.predict(r.area) : NaN; const e = r.found ? (r.area / r.pl.trueAreaCm2 - 1) * 100 : NaN; const truth = r.pl.diseased ? (r.pl.tipburn && ui.get('day') >= 14 ? 'lesions + tipburn' : 'lesions (infected)') : r.pl.tipburn && ui.get('day') >= 14 ? 'tipburn' : 'healthy'; const ok = (r.found && r.lesFrac >= tau) === r.symptoms;
        return `<tr class="${r.cal ? 'pv-cal' : ''}"><td>P${r.pl.id + 1}</td><td>${r.found ? r.objs.map(o => o.name).join(' + ') + (r.merged ? ' <span class="pv-bad">merged</span>' : '') : '<span class="pv-bad">missed (merged)</span>'}</td><td class="num">${r.found ? fmt(r.area, 1) : '—'}</td><td class="num">${fmt(r.pl.trueAreaCm2, 1)}</td><td class="num ${Math.abs(e) > 15 ? 'pv-bad' : ''}">${Number.isFinite(e) ? (e > 0 ? '+' : '') + fmt(e, 1) + ' %' : '—'}</td><td class="num">${r.cal ? '<span class="pv-h">harvested</span>' : fmt(est, 1)}</td><td class="num">${fmt(r.pl.fw, 1)}</td><td class="num">${fmt(r.lesFrac * 100, 2)} %</td><td>${r.found && r.lesFrac >= tau ? '⚠ yes' : 'no'}</td><td class="${ok ? '' : 'pv-bad'}">${truth}</td></tr>`; }).join('') + '</tbody>';
  } else {
    el.innerHTML = `<caption>Objects found in your photo (areas need a scale reference; masses use W = aAᵇ with your a and b).</caption><thead><tr><th>Object</th><th class="num">Pixels</th><th class="num">Area (cm²)</th><th class="num">Est. mass (g)</th><th class="num">Lesion share</th><th>Flagged</th></tr></thead><tbody>` +
      R.objs.map(o => `<tr><td>${o.name}</td><td class="num">${o.px}</td><td class="num">${fmt(o.area, 1)}</td><td class="num">${Number.isFinite(o.area) ? fmt(ui.get('calA') * Math.pow(o.area, ui.get('calB')), 1) : '—'}</td><td class="num">${fmt(o.lesFrac * 100, 2)} %</td><td>${o.lesFrac >= tau ? '⚠ yes' : 'no'}</td></tr>`).join('') + '</tbody>';
  }
}
function drawReadouts() {
  if (!R) return; const p = P(); const rows = R.rows;
  const nPl = rows ? rows.length : null; const found = rows ? rows.filter(r => r.found).length : R.objs.length;
  const merged = rows ? R.objs.length < found || rows.some(r => r.objs.length === 0) : false;
  ro.set('objs', rows ? `${R.objs.length} / ${nPl}` : `${R.objs.length}`, rows ? (R.objs.length === nPl ? 'ok' : 'warn') : null, rows ? (R.objs.length < nPl ? 'some plants merged or missed' : R.objs.length > nPl ? 'plants split into pieces' : 'one object per plant') : 'objects in your photo');
  ro.set('iou', R.iou, Number.isFinite(R.iou) ? (R.iou > 0.9 ? 'ok' : R.iou > 0.75 ? 'warn' : 'bad') : null, Number.isFinite(R.iou) ? `precision ${fmt(R.segP, 3)} · recall ${fmt(R.segR, 3)}` : 'no ground truth');
  ro.set('scale', R.s * 10, Number.isFinite(R.s) ? null : 'bad', esc(R.scaleNote));
  if (rows) { const okr = rows.filter(r => r.ok); const e = okr.map(r => r.area / r.pl.trueAreaCm2 - 1); const b = mean(e) * 100; const nm = rows.filter(r => r.merged).length; ro.set('bias', b, Math.abs(b) < 5 ? 'ok' : Math.abs(b) < 15 ? 'warn' : 'bad', (b > 0 ? 'overestimate (perspective? lesions?)' : 'underestimate (dark or red leaves?)') + (nm ? ` · ${nm} merged plant(s) excluded` : '')); }
  else ro.set('bias', NaN, null, 'no ground truth');
  ro.set('cal', R.cal ? R.cal.r2 : NaN, R.cal ? (R.cal.r2 > 0.95 ? 'ok' : R.cal.r2 > 0.85 ? 'warn' : 'bad') : null, R.cal ? (R.cal.model === 'power' ? `a = ${fmt(R.cal.a, 3)}, b = ${fmt(R.cal.b, 2)}` : 'straight line') : 'needs weighed plants');
  ro.set('rmse', R.rmse ?? NaN, Number.isFinite(R.rmse) ? (R.mape < 10 ? 'ok' : R.mape < 20 ? 'warn' : 'bad') : null, Number.isFinite(R.mape) ? `MAPE ${fmt(R.mape, 1)} %` : '');
  const f1 = R.metrics ? R.metrics.f1 : NaN; ro.set('f1', f1, Number.isFinite(f1) ? (f1 > 0.85 ? 'ok' : f1 > 0.6 ? 'warn' : 'bad') : null, R.metrics ? `precision ${fmt(R.metrics.precision, 2)} · recall ${fmt(R.metrics.recall, 2)}` : '');
  ro.set('thr', p.idx === 'hsv' ? `${p.hmin}–${p.hmax}°` : fmt(R.t, 3), null, p.idx === 'hsv' ? 'hue window' : p.thr === 'otsu' ? `Otsu on ${V.INDICES[p.idx].label}` : 'manual');
}

/* ======================================================================= main update */
function run() {
  const p = P(); const ta = performance.now(); const S = getImage(); if (!S) return;
  const t0 = performance.now();
  R = pipeline(S, p); prepareViewColours(R, p);
  R.rows = S.photo ? null : perPlant(S, R, p);
  R.cal = R.rows ? calibrate(R.rows, p) : null;
  const t1 = performance.now();
  drawStage(); drawStrip(); drawHist(); drawCalib(); drawDisease(); drawTable(); drawReadouts();
  window.__pvTiming = { render: t0 - ta, pipeline: t1 - t0, draw: performance.now() - t1 };
  hud.set('time', `analysis ${fmt(t1 - t0, 0)} ms`);
}
let raf = 0; function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(run); }

function applyVisibility() {
  const p = P(); const syn = p.src === 'synthetic';
  SCENE_IDS.forEach(id => ui.show(id, syn)); secScene.style.display = syn ? '' : 'none'; upWrap.style.display = syn ? 'none' : '';
  ['t_exg', 't_exgr', 't_gcc', 't_lab'].forEach(id => ui.show(id, p.thr === 'manual' && id === 't_' + p.idx && p.idx !== 'hsv'));
  ['hmin', 'hmax', 'smin'].forEach(id => ui.show(id, p.idx === 'hsv')); ui.show('thr', p.idx !== 'hsv');
  ui.show('hc', p.persp); ui.show('calA', !syn); ui.show('calB', !syn); ui.show('calFrac', syn); ui.show('calModel', syn); ui.enable('assign', syn);
  if (!syn && p.assign === 'grid') ui.set('assign', 'cc', true);
}
ui.onChange((st, id) => { if (id === 'ref' || id === 'src') CLICK = []; applyVisibility(); if (id === 'view') { drawStage(); drawStrip(); return; } if (id === 'tau') { drawStage(); drawDisease(); drawTable(); drawReadouts(); return; } schedule(); });

/* ---------- upload */
$('#pv-file').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { const im = new Image(); im.onload = () => { const sc = Math.min(1, 1100 / im.width, 760 / im.height); const W = Math.max(1, Math.round(im.width * sc)), H = Math.max(1, Math.round(im.height * sc)); const c = document.createElement('canvas'); c.width = W; c.height = H; const cx = c.getContext('2d'); cx.drawImage(im, 0, 0, W, H); PHOTO = { imageData: cx.getImageData(0, 0, W, H), W, H, name: f.name }; CLICK = []; ui.set('src', 'photo'); window.FFP?.toast?.(`Loaded ${f.name} (${W} × ${H} px)`); }; im.src = rd.result; };
  rd.readAsDataURL(f);
});
/* ---------- stage interaction: hover values, reference clicks */
function imgCoords(ev) { const r = cv.getBoundingClientRect(); const sc = Math.min(r.width / cv.width, r.height / cv.height); const ox = r.left + (r.width - cv.width * sc) / 2, oy = r.top + (r.height - cv.height * sc) / 2; return [(ev.clientX - ox) / sc, (ev.clientY - oy) / sc]; }
cv.addEventListener('pointermove', ev => {
  if (!R) return; const [x, y] = imgCoords(ev); const xi = Math.floor(x), yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= R.W || yi >= R.H) { tip.hidden = true; return; }
  const i = yi * R.W + xi; const l = R.labels[i]; const o = l && R.keep[l] ? R.objs.find(q => q.label === l) : null;
  tip.hidden = false; tip.innerHTML = `x ${xi}, y ${yi}<br>RGB ${Math.round(R.C.R[i])}, ${Math.round(R.C.G[i])}, ${Math.round(R.C.B[i])}<br>rgb ${R.ch.r[i].toFixed(3)}, ${R.ch.g[i].toFixed(3)}, ${R.ch.b[i].toFixed(3)}<br>${ui.get('idx') === 'hsv' ? 'hue' : 'index'} <b>${R.I[i].toFixed(3)}</b> · HSV ${Math.round(R.hs.H[i])}°, ${R.hs.S[i].toFixed(2)}, ${R.hs.V[i].toFixed(2)}<br>${R.lesion[i] ? '<b style="color:#ff7ad0">lesion pixel</b>' : R.opened[i] ? '<b style="color:#9be7b6">plant pixel</b>' : 'background'}${o ? ` · object ${o.name}` : ''}${SCENE && !R.photo && SCENE.gtPlant[i] >= 0 ? ` · truth P${SCENE.gtPlant[i] + 1}` : ''}`;
  const r = stageEl.getBoundingClientRect(); let lx = ev.clientX - r.left + 14, ly = ev.clientY - r.top + 14; if (lx > r.width - 230) lx -= 250; if (ly > r.height - 120) ly -= 130; tip.style.left = lx + 'px'; tip.style.top = ly + 'px';
});
cv.addEventListener('pointerleave', () => { tip.hidden = true; });
cv.addEventListener('click', ev => { if (ui.get('ref') !== 'click') return; const [x, y] = imgCoords(ev); if (CLICK.length >= 2) CLICK = []; CLICK.push([x, y]); schedule(); });

/* ---------- time series: photograph the crop every 3 days */
async function timeSeries() {
  if (ui.get('src') !== 'synthetic') { window.FFP?.toast?.('The image series needs the synthetic raft'); return; }
  const p = P(); const days = []; for (let d = 7; d <= 35; d += 3) days.push(d); const rows = [];
  for (const d of days) {
    hud.set('ts', `Photographing day <b>${d}</b>…`); await new Promise(r => setTimeout(r, 10));
    const S = renderScene({ seed: Math.round(p.seed) || 1, day: d, background: p.bg, cultivar: p.cult, prevalence: p.prev, tipburn: p.tipburn, light: p.light, brightness: p.bright, gradient: p.grad, noise: p.noise, camH: p.camH });
    const Rr = pipeline(S, { ...p, day: d }, true); const pp = perPlant(S, Rr, { ...p, day: d });
    pp.forEach(r => rows.push({ day: d, plant: `P${r.pl.id + 1}`, area_cm2: r.ok ? +r.area.toFixed(1) : '', merged: r.merged, true_area_cm2: +r.pl.trueAreaCm2.toFixed(1) }));
  }
  hud.remove('ts'); SERIES = rows;
  try { localStorage.setItem(PV_KEY, JSON.stringify({ version: 1, meta: { created: Date.now(), index: p.idx, threshold: p.thr, background: p.bg, light: p.light, seed: p.seed }, rows: rows.filter(r => r.area_cm2 !== '') })); } catch (e) { }
  drawSeries(); window.FFP?.toast?.('Image series stored — open the Model-fitting lab and choose “Image series from the Plant vision lab”');
}
function drawSeries() {
  chTS.clear(); if (!SERIES) return; const plants = [...new Set(SERIES.map(r => r.plant))];
  plants.forEach((pl, k) => { const rr = SERIES.filter(r => r.plant === pl && r.area_cm2 !== ''); chTS.line('m' + k, rr.map(r => r.day), rr.map(r => r.area_cm2), { color: categorical(k % 8), width: 1.6, label: k < 4 ? pl : undefined }); chTS.scatter('s' + k, rr.map(r => r.day), rr.map(r => r.area_cm2), { color: categorical(k % 8), r: 2.5 }); });
  const days = [...new Set(SERIES.map(r => r.day))];
  chTS.setAxis('y', { min: 0, max: Math.max(...SERIES.map(r => r.true_area_cm2)) * 1.8 });
  chTS.line('true', days, days.map(d => mean(SERIES.filter(r => r.day === d).map(r => r.true_area_cm2))), { color: 'ink', width: 2.4, dash: [6, 4], label: 'true mean area' });
  chTS.line('meas', days, days.map(d => mean(SERIES.filter(r => r.day === d && r.area_cm2 !== '').map(r => r.area_cm2))), { color: 'magenta', width: 2.8, label: 'measured mean area' });
  $('#ch-ts-sub').innerHTML = `${plants.length} plants × ${days.length} photographs. Stored for the <a href="/laboratories/model-fitting/?ds=vision">Model-fitting lab</a> — fit a growth curve to your own image-based measurements. Plants whose outline merged with a neighbour are left out (${SERIES.filter(r => r.area_cm2 === '').length} of ${SERIES.length} measurements); choose <em>Nearest planting hole</em> to keep them.`;
}
function dlTable() {
  if (!R) return;
  if (R.rows) downloadCSV('plant-vision-plants.csv', ['plant', 'measured_area_cm2', 'true_area_cm2', 'harvested_for_calibration', 'estimated_fw_g', 'true_fw_g', 'lesion_share', 'flagged', 'truth_symptoms'], R.rows.map(r => [`P${r.pl.id + 1}`, r.ok ? +r.area.toFixed(2) : '', +r.pl.trueAreaCm2.toFixed(2), r.cal ? 'yes' : 'no', r.ok && R.cal && !r.cal ? +R.cal.predict(r.area).toFixed(2) : '', +r.pl.fw.toFixed(2), +r.lesFrac.toFixed(4), r.pred ? 'yes' : 'no', r.symptoms ? 'yes' : 'no']));
  else downloadCSV('plant-vision-objects.csv', ['object', 'pixels', 'area_cm2', 'lesion_share'], R.objs.map(o => [o.name, o.px, Number.isFinite(o.area) ? +o.area.toFixed(2) : '', +o.lesFrac.toFixed(4)]));
}
function dlSeries() { if (!SERIES) { window.FFP?.toast?.('Press “Photograph the crop every 3 days” first'); return; } downloadCSV('plant-vision-series.csv', ['day', 'area_cm2', 'plant', 'true_area_cm2'], SERIES.map(r => [r.day, r.area_cm2, r.plant, r.true_area_cm2])); }

document.addEventListener('ffp:theme', () => { drawHist(); drawCalib(); drawDisease(); drawSeries(); });
if (ui.get('src') === 'photo' && !PHOTO) ui.set('src', 'synthetic', true);
applyVisibility(); run();
try { const s = JSON.parse(localStorage.getItem(PV_KEY) || 'null'); if (s && Array.isArray(s.rows) && s.rows.length) { SERIES = s.rows; drawSeries(); } } catch (e) { }
