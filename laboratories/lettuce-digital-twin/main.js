/* Lettuce digital twin — UI, simulation loop, data assimilation, charts and 3D coupling.
   Crop model and filter: ./model.js (Derive tab, Eqs. T1–T9). 3D scene: ./scene.js. */
import { createStage } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot } from '/assets/js/plot.js';
import { resolveColor, withAlpha } from '/assets/js/colors.js';
import * as TW from './model.js';
import { buildTwinScene } from './scene.js';

const DAY = TW.DAY, REC = 3 * 3600;
const PARAM_LABEL = { c_eps: 'c_ε (light-use efficiency)', c_lar: 'c_lar,s (leaf-area ratio)', c_grmax: 'c_r,gr,max (max. growth rate)' };

/* ================================================================ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'day', label: 'Crop age', unit: 'd', digits: 1 })
  .add({ id: 'dli', label: 'Daily light integral', unit: 'mol m⁻² d⁻¹', digits: 1 })
  .add({ id: 'fwT', label: 'Physical crop (hidden truth)', unit: 'g head⁻¹', digits: 1 })
  .add({ id: 'fwTw', label: 'Digital twin estimate', unit: 'g head⁻¹', format: v => v })
  .add({ id: 'meas', label: 'Latest measurement', unit: '', format: v => v })
  .add({ id: 'param', label: 'Learned parameter (× Van Henten)', unit: '', format: v => v })
  .add({ id: 'harv', label: 'Twin: harvest day (90 % interval)', unit: '', format: v => v })
  .add({ id: 'harvP', label: 'Model without data: harvest day', unit: '', format: v => v })
  .add({ id: 'err', label: 'Forecast error vs. truth', unit: 'd', digits: 1 })
  .add({ id: 'kwh', label: 'Lamp electricity so far', unit: 'kWh m⁻²', digits: 1 });

ui.section('Climate — known to the twin');
ui.slider({ id: 'ppfd', label: 'PPFD at the canopy', min: 60, max: 500, step: 5, value: 200, unit: 'µmol m⁻² s⁻¹' });
ui.slider({ id: 'photo', label: 'Photoperiod', min: 8, max: 24, step: 0.5, value: 16, unit: 'h d⁻¹' });
ui.slider({ id: 'T', label: 'Air temperature', min: 10, max: 30, step: 0.5, value: 20, unit: '°C' });
ui.slider({ id: 'co2', label: 'CO₂ concentration', min: 400, max: 1500, step: 10, value: 600, unit: 'µmol mol⁻¹' });
ui.slider({ id: 'rho', label: 'Plant density', min: 10, max: 40, step: 1, value: 20, unit: 'plants m⁻²', help: 'Changing it mid-crop re-spaces the plants.' });
ui.slider({ id: 'target', label: 'Harvest target (fresh weight)', min: 120, max: 400, step: 5, value: 250, unit: 'g head⁻¹' });

ui.section('Physical twin — hidden from the model');
ui.select({ id: 'param', label: 'Uncertain parameter', options: Object.entries(TW.UNCERTAIN).map(([k, o]) => ({ value: k, label: o.label })), value: 'c_eps' });
ui.slider({ id: 'cv', label: 'Prior uncertainty (log-SD)', min: 5, max: 40, step: 1, value: 20, unit: '%', help: 'The real crop deviates from Van Henten’s value by a hidden factor drawn from this prior.' });
ui.slider({ id: 'sigP', label: 'Process noise (day-to-day)', min: 0, max: 10, step: 0.5, value: 3, unit: '%', help: 'Random daily variation of canopy photosynthesis that no model captures.' });
ui.toggle({ id: 'reveal', label: 'Reveal the truth (teacher view)', value: true });

ui.section('Measurements');
ui.segmented({ id: 'sensor', label: 'Sensor', options: [{ value: 'camera', label: 'Top camera (area)' }, { value: 'scale', label: 'Weighing gutter' }], value: 'camera' });
ui.slider({ id: 'sig', label: 'Measurement error (log-SD)', min: 1, max: 30, step: 0.5, value: 8, unit: '%', help: 'Camera: segmentation error of projected area. Scale: error of fresh weight per head.' });
ui.slider({ id: 'every', label: 'Measurement interval', min: 1, max: 7, step: 1, value: 1, unit: 'd' });

ui.section('Model · shadow · twin');
ui.segmented({ id: 'mode', label: 'What the digital object does', options: [{ value: 'model', label: 'Model' }, { value: 'shadow', label: 'Shadow' }, { value: 'twin', label: 'Twin' }], value: 'shadow', help: 'Model: no data. Shadow: data flow into the model (EnKF). Twin: the model also acts back on the crop (sets the light).' });
ui.slider({ id: 'Dstar', label: 'Twin: deliver the harvest on day', min: 16, max: 45, step: 1, value: 30, unit: 'd', help: 'Each day the twin re-plans the PPFD so that its median forecast hits this day.' });
ui.slider({ id: 'N', label: 'Ensemble size N', min: 10, max: 200, step: 5, value: 60 });
ui.slider({ id: 'rw', label: 'Parameter random walk', min: 0, max: 5, step: 0.25, value: 1, unit: '% d⁻¹', help: 'Keeps the parameter ensemble from collapsing; allows slow drift.' });

ui.section('Run');
const runBtns = ui.buttons([
  { label: 'Play', variant: 'primary', onClick: () => toggle() },
  { label: 'Reset', onClick: () => restart(false) },
  { label: '+1 day', onClick: () => { clock.pause(); advanceTo(S.t + DAY); S.dirty = true; drawAll(); } }
]);
ui.button({ label: 'Draw a new physical twin', onClick: () => restart(true), title: 'New hidden parameter, transplant size and weather of the plants' });
ui.segmented({ id: 'speed', label: 'Speed', options: [{ value: 0.25, label: '¼ d/s' }, { value: 0.5, label: '½ d/s' }, { value: 1, label: '1 d/s' }, { value: 2, label: '2 d/s' }], value: 1, persist: false });
ui.toggle({ id: 'labels', label: 'Labels in the 3D view', value: true, persist: false });
ui.presets([
  { label: 'Plant factory', values: { ppfd: 200, photo: 16, T: 20, co2: 600, rho: 20, target: 250, sensor: 'camera', sig: 8, every: 1, mode: 'shadow', param: 'c_eps' } },
  { label: 'Winter greenhouse (Van Henten)', values: { ppfd: 110, photo: 10, T: 17, co2: 700, rho: 18, target: 250 } },
  { label: 'CO₂-rich fast crop', values: { ppfd: 300, photo: 18, T: 21, co2: 1000, rho: 20 } },
  { label: 'Noisy camera, tiny ensemble', values: { sensor: 'camera', sig: 20, N: 15 } },
  { label: 'Weighing instead of imaging', values: { sensor: 'scale', sig: 4 } },
  { label: 'A parameter that barely matters', values: { param: 'c_grmax', cv: 30 } },
  { label: 'Closed-loop twin', values: { mode: 'twin', Dstar: 30 } }
]);
ui.saveButton('lettuce-digital-twin', () => Object.assign({ parameter: ui.get('param'), mode: ui.get('mode') }, ro.values()));
function showRelevant() { ui.show('Dstar', ui.get('mode') === 'twin'); }
showRelevant();

const climFromUI = () => { const v = ui.values(); return { ppfd: v.ppfd, photo: v.photo, T: v.T, co2: v.co2 }; };

/* ================================================================ state */
let S = null;
function newState(seed) {
  const v = ui.values(); const key = v.param; const priorSd = v.cv / 100; const sigP = v.sigP / 100;
  const rngT = TW.mulberry(seed * 7919 + 13);
  let z; do { z = TW.gauss(rngT); } while (Math.abs(z) < 0.6 || Math.abs(z) > 2.2);
  const x0 = TW.initialState(v.rho);
  const truth = { x: [x0[0] * Math.exp(0.08 * TW.gauss(rngT)), x0[1] * Math.exp(0.08 * TW.gauss(rngT))], m: Math.exp(priorSd * z), xi: new Map() };
  truth.xiOf = TW.memberXi(truth, sigP, rngT);
  const rngE = TW.mulberry(seed * 104729 + 7), rngP = TW.mulberry(seed * 15485863 + 3);
  const st = {
    seed, key, priorSd, t: 0, truth, rhoP: v.rho, clim: climFromUI(),
    ens: TW.makeEnsemble({ N: v.N, x0, cv0: 0.1, priorSd, rng: rngE }),
    prior: TW.makeEnsemble({ N: Math.min(v.N, 60), x0, cv0: 0.1, priorSd, rng: rngP }),
    nominal: x0.slice(), rngE, rngP, rngM: TW.mulberry(seed * 31337 + 5),
    meas: [], hist: [], fcHist: [], fcNow: null, energy: 0, lastDiag: null, harvestDay: null, stopAt: null, trueHarvest: NaN, dirty: true, loopPPFD: null
  };
  return st;
}
function restart(newTwin) {
  const was = clock.running; clock.pause();
  const seed = S ? (newTwin ? S.seed + 1 : S.seed) : 4;
  S = newState(seed); record(); runForecasts(); S.dirty = true;
  scene3d.buildTray(S.rhoP);
  drawAll(); updateReadouts();
  if (was || newTwin) clock.play();
}

/* ================================================================ simulation */
const sigP = () => ui.get('sigP') / 100;
function lampSeconds(t0, t1, photo) { let t = t0, on = 0; while (t < t1 - 1e-6) { const tb = Math.min(t1, TW.nextSwitch(t, photo)); if (TW.lightOn(t + 1e-3, photo)) on += tb - t; t = tb; } return on; }
function integrate(t0, t1) {
  const key = S.key, c = S.clim, sp = sigP();
  S.truth.x = TW.advance(S.truth.x, t0, t1, c, TW.withParam(key, S.truth.m), S.truth.xiOf);
  for (const m of S.ens) m.x = TW.advance(m.x, t0, t1, c, TW.memberParams(m, key), TW.memberXi(m, sp, S.rngE));
  for (const m of S.prior) m.x = TW.advance(m.x, t0, t1, c, TW.memberParams(m, key), TW.memberXi(m, sp, S.rngP));
  S.nominal = TW.advance(S.nominal, t0, t1, c, TW.VH, null);
  S.energy += lampSeconds(t0, t1, c.photo) * c.ppfd / TW.LED_EFFICACY / 3.6e6;
}
function nextMeasTime(t) {
  const every = ui.get('every'); let d = Math.floor(t / DAY);
  for (let k = 0; k < 20; k++, d++) { const tm = d * DAY + TW.MEAS_HOUR * 3600; if (tm > t + 1e-6 && d % every === 0) return tm; }
  return Infinity;
}
function advanceTo(tEnd) {
  let guard = 0;
  while (S.t < tEnd - 1e-6 && guard++ < 1000) {
    if (S.stopAt !== null && S.t >= S.stopAt - 1e-6) { clock.pause(); break; }
    const tMeas = nextMeasTime(S.t), tRec = (Math.floor(S.t / REC + 1e-9) + 1) * REC;
    const tn = Math.min(tEnd, tMeas, tRec, S.stopAt ?? Infinity);
    integrate(S.t, tn); S.t = tn;
    if (Math.abs(S.t - tRec) < 1e-6) record();
    if (Math.abs(S.t - tMeas) < 1e-6) onMeasurement();
    if (S.harvestDay === null && TW.fwHead(S.truth.x, S.rhoP) >= ui.get('target')) {
      S.harvestDay = S.t / DAY; S.stopAt = S.t + 1.5 * DAY;
      if (window.FFP && FFP.toast) FFP.toast(`Harvest! The physical crop reached ${ui.get('target')} g on day ${fmt(S.harvestDay, 1)}.`);
    }
  }
}
function record() {
  const r = S.rhoP;
  S.hist.push({
    day: S.t / DAY, fwT: TW.fwHead(S.truth.x, r), sdwT: TW.sdwHead(S.truth.x, r),
    fw: TW.stats(S.ens.map(m => TW.fwHead(m.x, r))), sdw: TW.stats(S.ens.map(m => TW.sdwHead(m.x, r))),
    m: TW.stats(S.ens.map(m => Math.exp(m.lp))), fwNom: TW.fwHead(S.nominal, r), sdwNom: TW.sdwHead(S.nominal, r),
    fwPrior: TW.stats(S.prior.map(m => TW.fwHead(m.x, r)))
  });
  S.dirty = true;
}
const gmean = a => Math.exp(a.reduce((s, v) => s + Math.log(v), 0) / a.length);
function onMeasurement() {
  const v = ui.values(); const sig = v.sig / 100; const key = S.key; const lar = TW.UNCERTAIN[key].inH; const assim = v.mode !== 'model';
  let meas, diag = null;
  if (v.sensor === 'camera') {
    meas = TW.measureCamera(S.truth.x, lar ? S.truth.m : 1, S.rhoP, sig, S.rngM);
    const fbar = TW.coverOf(gmean(S.ens.map(m => m.x[1])), lar ? Math.exp(S.ens.reduce((s, m) => s + m.lp, 0) / S.ens.length) : 1);
    meas.R = (sig * TW.elasticity(fbar)) ** 2;
    if (Math.sqrt(meas.R) > 0.5) meas.closed = true;            // quality control: an estimate this uncertain is useless
    if (!meas.closed && assim) diag = TW.analyse(S.ens, meas.y, meas.R, m => TW.hCamera(m, key, S.rhoP), S.rngE);
  } else {
    meas = TW.measureScale(S.truth.x, S.rhoP, sig, S.rngM); meas.R = sig * sig;
    if (assim) diag = TW.analyse(S.ens, meas.y, meas.R, m => TW.hScale(m, S.rhoP), S.rngE);
  }
  meas.day = S.t / DAY; meas.used = !!diag; S.meas.push(meas); S.lastDiag = diag;
  if (assim) for (const m of S.ens) m.lp += (v.rw / 100) * TW.gauss(S.rngE);
  runForecasts();
  if (v.mode === 'twin') closeLoop();
  scene3d.snapshot(); S.dirty = true;
}
function runForecasts() {
  const target = ui.get('target'), key = S.key, sp = sigP(), day = S.t / DAY;
  const tw = S.ens.map(m => TW.forecast(m.x, S.t, S.clim, TW.memberParams(m, key), S.rhoP, target, { maxDay: 90, sigP: sp, rng: S.rngE, record: true }));
  const pr = S.prior.map(m => TW.forecast(m.x, S.t, S.clim, TW.memberParams(m, key), S.rhoP, target, { maxDay: 90, sigP: sp, rng: S.rngP }));
  const nom = TW.forecast(S.nominal, S.t, S.clim, TW.VH, S.rhoP, target, { maxDay: 90 });
  // FW fan: percentiles per future midnight while most members still have data
  const byDay = new Map(); tw.forEach(o => o.fw.forEach(([d, fw]) => { const k = Math.round(d * 4) / 4; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(fw); }));
  const fan = [...byDay.entries()].sort((a, b) => a[0] - b[0]).filter(([, a]) => a.length >= 0.8 * tw.length).map(([d, a]) => ({ d, s: TW.stats(a) }));
  S.fcNow = { day, hs: tw.map(o => o.harvest), tw: TW.stats(tw.map(o => o.harvest)), prior: TW.stats(pr.map(o => o.harvest)), nominal: nom.harvest, fan };
  S.fcHist = S.fcHist.filter(f => f.day < day - 1e-6); S.fcHist.push({ day, tw: S.fcNow.tw, prior: S.fcNow.prior, nominal: nom.harvest });
  S.trueHarvest = S.harvestDay ?? TW.forecast(S.truth.x, S.t, S.clim, TW.withParam(key, S.truth.m), S.rhoP, target, { maxDay: 90, xiOf: S.truth.xiOf }).harvest;
}
/** Digital twin in the strict sense: choose tomorrow's PPFD so that the median forecast harvest equals D*. */
function closeLoop() {
  const Dstar = ui.get('Dstar'), target = ui.get('target'), key = S.key;
  const stride = Math.max(1, Math.ceil(S.ens.length / 24)); const sub = S.ens.filter((_, i) => i % stride === 0);
  const med = ppfd => TW.stats(sub.map(m => TW.forecast(m.x, S.t, Object.assign({}, S.clim, { ppfd }), TW.memberParams(m, key), S.rhoP, target, { maxDay: 90 }).harvest)).p50;
  let lo = 60, hi = 500, ppfd;
  if (med(hi) > Dstar) ppfd = hi; else if (med(lo) < Dstar) ppfd = lo;
  else { for (let i = 0; i < 9; i++) { const mid = (lo + hi) / 2; if (med(mid) > Dstar) lo = mid; else hi = mid; } ppfd = (lo + hi) / 2; }
  const prev = S.clim.ppfd; ppfd = Math.min(prev + 60, Math.max(prev - 60, ppfd));   // at most ±60 µmol m⁻² s⁻¹ per day
  ppfd = Math.round(ppfd / 5) * 5; S.clim.ppfd = ppfd; S.loopPPFD = ppfd; ui.set('ppfd', ppfd, true);
  runForecasts();
}

/* ================================================================ 3D */
const stage = createStage('#stage', {
  background: '#06090b', envIntensity: 0.22, exposure: 1.05,
  camera: { pos: [0.95, 1.92, 3.25], target: [0.12, 0.98, 0.0], fov: 42 },
  controls: { minDistance: 0.35, maxDistance: 6, maxPolarAngle: Math.PI * 0.49 },
  bloom: { strength: 0.75, radius: 0.5, threshold: 1.0 }, ao: { radius: 0.16, intensity: 0.8 }
});
const scene3d = buildTwinScene(stage);
const hud = hudChips(stage.el);
const mask = document.createElement('div'); mask.className = 'stage-legend tw-mask';
mask.innerHTML = '<div class="tw-mask-title">Top camera · segmentation mask</div><canvas width="232" height="170"></canvas><div class="tw-mask-note"></div>';
stage.el.appendChild(mask); const maskCv = mask.querySelector('canvas'), maskNote = mask.querySelector('.tw-mask-note');
const info = document.createElement('div'); info.className = 'stage-legend tw-info'; info.style.display = 'none'; stage.el.appendChild(info);
const labels = {
  crop: stage.addLabel(scene3d.labelAnchors.crop, ''), twin: stage.addLabel(scene3d.labelAnchors.twin, '', { className: 'label3d lg' }),
  camera: stage.addLabel(scene3d.labelAnchors.camera, ''), gauge: stage.addLabel(scene3d.labelAnchors.gauge, '')
};
if (stage.addTool) stage.addTool({ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3"/></svg>', title: 'Look through the top camera', onClick: () => { const p = scene3d.parts.find(q => q.id === 'camera'); stage.flyTo(p.cam[0], p.cam[1], 1.4); } });
const PART_INFO = {
  crop: () => `<b>The physical crop</b> — lettuce in deep-water culture at ${S.rhoP} plants m⁻² under LEDs. Its growth follows Van Henten's model with a hidden parameter deviation and random day-to-day variation: the model can never be exactly right.`,
  camera: () => `<b>Top-view RGB camera</b> — every ${ui.get('every') === 1 ? 'day' : ui.get('every') + ' days'} at 12:00 it photographs the tray. Segmentation gives the projected leaf area; inverting the canopy-cover relation gives a structural dry-weight estimate. Once the canopy closes (cover &gt; 95 %) the image carries no information about mass.`,
  twin: () => `<b>The digital twin</b> — an ensemble of ${S.ens.length} Van Henten models, each with its own state and parameter value. The hologram shows the ensemble mean; the dots on the gauge show every member's fresh weight relative to the harvest target (amber ring); the cyan ring is the mean${ui.get('reveal') ? ', the green ring the truth' : ''}.`,
  lamps: () => `<b>LED fixture</b> — ${S.clim.ppfd} µmol m⁻² s⁻¹ for ${S.clim.photo} h d⁻¹ (DLI ${fmt(TW.dliOf(S.clim), 1)} mol m⁻² d⁻¹)${ui.get('mode') === 'twin' ? '. In twin mode the digital twin sets this value every day (magenta data stream).' : '.'}`
};
let selected = null;
stage.onPick({
  objects: () => scene3d.parts.map(p => p.obj),
  onClick: hit => {
    if (!hit) { selected = null; info.style.display = 'none'; return; }
    const part = scene3d.parts.find(p => { let q = hit.object; while (q) { if (q === p.obj) return true; q = q.parent; } return false; });
    if (!part) return; selected = part.id; stage.flyTo(part.cam[0], part.cam[1], 1.3); info.style.display = ''; info.innerHTML = PART_INFO[selected]() + '<br><small style="opacity:.7">Click empty space to close</small>';
  }
});
stage.onKey('space', () => toggle());

function drawMask() {
  const c = maskCv.getContext('2d'); const W = maskCv.width, Hh = maskCv.height;
  c.fillStyle = '#10161a'; c.fillRect(0, 0, W, Hh);
  const r = S.rhoP, s = 1 / Math.sqrt(r); const nx = Math.max(3, Math.min(7, Math.round(1.12 / s))), nz = Math.max(2, Math.min(6, Math.round(0.9 / s)));
  const sc = Math.min((W - 16) / (nx * s), (Hh - 16) / (nz * s)); const ox = (W - nx * s * sc) / 2, oy = (Hh - nz * s * sc) / 2;
  c.fillStyle = '#2a2f33'; c.fillRect(ox, oy, nx * s * sc, nz * s * sc);
  const lar = TW.UNCERTAIN[S.key].inH ? S.truth.m : 1;
  const potential = -Math.log(Math.max(1e-6, 1 - TW.coverOf(S.truth.x[1], lar))) / r;   // m² per plant before overlap
  const rad = Math.sqrt(potential / Math.PI) * sc;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const cx = ox + (i + 0.5) * s * sc, cy = oy + (j + 0.5) * s * sc;
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, '#b6f5a0'); g.addColorStop(0.75, '#6fd39a'); g.addColorStop(1, '#3f9d62');
    c.fillStyle = g; c.beginPath(); for (let k = 0; k <= 24; k++) { const a = k / 24 * Math.PI * 2; const rr = rad * (1 + 0.08 * Math.sin(a * 5 + i * 1.3 + j)); c[k ? 'lineTo' : 'moveTo'](cx + rr * Math.cos(a), cy + rr * Math.sin(a)); } c.fill();
  }
  const last = S.meas[S.meas.length - 1];
  const f = TW.coverOf(S.truth.x[1], lar);
  maskNote.innerHTML = last && last.kind === 'camera' ? `cover ${fmt(100 * last.f, 0)} % · PLA ${fmt(last.pla, 0)} cm² ${last.closed ? '· <b style="color:#ffb640">canopy closed</b>' : ''}` : `cover ${fmt(100 * f, 0)} %`;
}

/* ================================================================ charts */
const pG = new Plot('#chart-growth', { x: { label: 'Days after transplanting', unit: 'd', min: 0 }, y: { label: 'Structural dry weight', unit: 'g plant⁻¹', log: true }, height: 300 });
const pF = new Plot('#chart-fw', { x: { label: 'Days after transplanting', unit: 'd', min: 0 }, y: { label: 'Fresh weight', unit: 'g head⁻¹', min: 0 }, height: 300 });
const pP = new Plot('#chart-param', { x: { label: 'Days after transplanting', unit: 'd', min: 0 }, y: { label: 'Parameter / Van Henten value', unit: '–' }, height: 280 });
const pH = new Plot('#chart-harvest', { x: { label: 'Day on which the forecast was made', unit: 'd', min: 0 }, y: { label: 'Forecast harvest day', unit: 'd' }, height: 280 });
function xMax() { const h = S.trueHarvest; const f = S.fcNow ? S.fcNow.tw.p95 : 30; return Math.min(80, Math.max(35, Math.ceil(Math.max(isFinite(h) ? h : 0, isFinite(f) ? f : 0, S.t / DAY) + 2))); }
function drawGrowth() {
  const h = S.hist, reveal = ui.get('reveal'), camera = ui.get('sensor') === 'camera', X = xMax();
  const q = camera ? 'sdw' : 'fw', qT = camera ? 'sdwT' : 'fwT', qN = camera ? 'sdwNom' : 'fwNom';
  pG.clear(); pG.setAxis('x', { min: 0, max: X });
  pG.setAxis('y', camera ? { label: 'Structural dry weight', unit: 'g plant⁻¹', log: true, min: 'auto', max: 'auto' } : { label: 'Fresh weight', unit: 'g head⁻¹', log: true, min: 'auto', max: 'auto' });
  const xs = h.map(o => o.day);
  pG.band('band', xs, h.map(o => o[q].p05), h.map(o => o[q].p95), { color: 'magenta', alpha: 0.16 });
  pG.line('nom', xs, h.map(o => o[qN]), { color: 'muted', width: 1.6, dash: [6, 4], label: 'Model, no data' });
  if (reveal) pG.line('truth', xs, h.map(o => o[qT]), { color: 'accent', width: 2.4, label: 'Physical crop (truth)' });
  pG.line('twin', xs, h.map(o => o[q].mean), { color: 'magenta', width: 2.2, label: 'Twin: mean and 90 % band' });
  const val = m => camera ? m.sdwEst : m.fw;
  const ms = S.meas.filter(m => (m.kind === 'camera') === camera);
  const ok = ms.filter(m => !m.closed), bad = ms.filter(m => m.closed);
  if (ok.length) pG.scatter('meas', ok.map(m => m.day), ok.map(val), { color: 'amber', r: 4, shape: 'diamond', label: camera ? 'Camera estimate ±1σ' : 'Weighing ±1σ' });
  if (bad.length) pG.custom('closed', (ctx, plot) => { const R = plot.plotRect; ctx.strokeStyle = resolveColor('muted'); ctx.lineWidth = 1.4; bad.forEach(m => { const X0 = plot.px(m.day); ctx.beginPath(); ctx.moveTo(X0, R.top + R.height - 1); ctx.lineTo(X0, R.top + R.height - 9); ctx.stroke(); }); ctx.fillStyle = resolveColor('muted'); ctx.font = '600 10.5px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('ticks: images rejected (canopy closed)', plot.px(bad[0].day), R.top + R.height - 13); });
  pG.custom('errbars', (ctx, plot) => { ctx.strokeStyle = resolveColor('amber'); ctx.lineWidth = 1.2; ok.forEach(m => { const sd = Math.sqrt(m.R); const X0 = plot.px(m.day); const y = val(m); ctx.beginPath(); ctx.moveTo(X0, plot.py(y * Math.exp(-sd))); ctx.lineTo(X0, plot.py(y * Math.exp(sd))); ctx.stroke(); }); });
  pG.vline('now', S.t / DAY, { color: 'muted', dash: [2, 3] });
}
function drawFW() {
  const h = S.hist, reveal = ui.get('reveal'), target = ui.get('target'), X = xMax();
  pF.clear(); pF.setAxis('x', { min: 0, max: X }); pF.setAxis('y', { min: 0, max: Math.max(target * 1.35, 50) });
  const xs = h.map(o => o.day);
  pF.hline('target', target, { color: 'amber', label: `target ${target} g`, dash: [6, 4] });
  pF.band('band', xs, h.map(o => o.fw.p05), h.map(o => o.fw.p95), { color: 'magenta', alpha: 0.16 });
  const fan = S.fcNow ? S.fcNow.fan : [];
  if (fan.length > 1) {
    pF.band('fan90', fan.map(o => o.d), fan.map(o => o.s.p05), fan.map(o => o.s.p95), { color: 'water', alpha: 0.14 });
    pF.band('fan50', fan.map(o => o.d), fan.map(o => o.s.p25), fan.map(o => o.s.p75), { color: 'water', alpha: 0.2 });
    pF.line('fanmed', fan.map(o => o.d), fan.map(o => o.s.p50), { color: 'water', width: 2, dash: [5, 3], label: 'Forecast median, 50/90 %' });
  }
  pF.line('nom', xs, h.map(o => o.fwNom), { color: 'muted', width: 1.6, dash: [6, 4], label: 'Model, no data' });
  if (reveal) pF.line('truth', xs, h.map(o => o.fwT), { color: 'accent', width: 2.4, label: 'Physical crop (truth)' });
  pF.line('twin', xs, h.map(o => o.fw.mean), { color: 'magenta', width: 2.2, label: 'Twin (mean, 90 %)' });
  const scale = S.meas.filter(m => m.kind === 'scale');
  if (scale.length) pF.scatter('meas', scale.map(m => m.day), scale.map(m => m.fw), { color: 'amber', r: 3.5, shape: 'diamond', label: 'Weighing' });
  if (S.fcNow && isFinite(S.fcNow.tw.p50) && S.harvestDay === null) pF.vline('hmed', S.fcNow.tw.p50, { color: 'water', label: 'forecast', dash: [3, 3] });
  if (reveal && isFinite(S.trueHarvest)) pF.vline('htrue', S.trueHarvest, { color: 'accent', label: S.harvestDay !== null ? 'harvested' : 'true harvest', dash: [2, 2] });
  pF.vline('now', S.t / DAY, { color: 'muted', dash: [2, 3] });
}
function drawParam() {
  const h = S.hist, reveal = ui.get('reveal'), X = xMax(), sd = S.priorSd;
  pP.clear(); pP.setAxis('x', { min: 0, max: X });
  const xs = h.map(o => o.day);
  pP.hregion('prior', Math.exp(-1.645 * sd), Math.exp(1.645 * sd), { color: 'muted', alpha: 0.08, label: 'prior 90 % range' });
  pP.hline('vh', 1, { color: 'muted', dash: [2, 3], label: 'Van Henten (1994)' });
  pP.band('band', xs, h.map(o => o.m.p05), h.map(o => o.m.p95), { color: 'magenta', alpha: 0.18 });
  pP.line('mean', xs, h.map(o => o.m.mean), { color: 'magenta', width: 2.2, label: `Twin estimate of ${PARAM_LABEL[S.key]}` });
  if (reveal) pP.hline('truth', S.truth.m, { color: 'accent', dash: [1, 0], width: 2, label: `truth × ${fmt(S.truth.m, 2)}` });
  pP.vline('now', S.t / DAY, { color: 'muted', dash: [2, 3] });
}
function drawHarvest() {
  const f = S.fcHist, reveal = ui.get('reveal'), X = xMax();
  pH.clear(); pH.setAxis('x', { min: 0, max: X });
  const lo = Math.max(0, Math.min(...f.map(o => o.prior.p05).filter(isFinite), ...f.map(o => o.tw.p05).filter(isFinite)) - 2);
  const hi = Math.max(...f.map(o => o.prior.p95).filter(isFinite), ...f.map(o => o.tw.p95).filter(isFinite), isFinite(S.trueHarvest) ? S.trueHarvest : 0) + 2;
  pH.setAxis('y', { min: isFinite(lo) ? Math.floor(lo / 5) * 5 : 0, max: isFinite(hi) ? Math.ceil(hi / 5) * 5 : 60 });
  const xs = f.map(o => o.day);
  pH.band('prior', xs, f.map(o => o.prior.p05), f.map(o => o.prior.p95), { color: 'muted', alpha: 0.14 });
  pH.line('priorMed', xs, f.map(o => o.prior.p50), { color: 'muted', width: 1.6, dash: [6, 4], label: 'Model without data (median, 90 %)' });
  pH.band('tw90', xs, f.map(o => o.tw.p05), f.map(o => o.tw.p95), { color: 'magenta', alpha: 0.15 });
  pH.band('tw50', xs, f.map(o => o.tw.p25), f.map(o => o.tw.p75), { color: 'magenta', alpha: 0.22 });
  pH.line('twMed', xs, f.map(o => o.tw.p50), { color: 'magenta', width: 2.4, label: 'Twin (median, 50 % and 90 %)', step: true });
  if (reveal && isFinite(S.trueHarvest)) pH.hline('truth', S.trueHarvest, { color: 'accent', width: 2, dash: [1, 0], label: `true harvest day ${fmt(S.trueHarvest, 1)}` });
  pH.line('today', [0, X], [0, X], { color: 'muted', width: 1, dash: [2, 4], noTip: true });
  // current distribution as a sideways histogram at the right edge
  if (S.fcNow) pH.custom('hist', (ctx, plot) => {
    const hs = S.fcNow.hs.filter(isFinite); if (!hs.length) return;
    const y0 = plot._y0, y1 = plot._y1, nb = 24, w = (y1 - y0) / nb; const cnt = new Array(nb).fill(0);
    hs.forEach(v => { const k = Math.floor((v - y0) / w); if (k >= 0 && k < nb) cnt[k]++; });
    const mx = Math.max(...cnt); const R = plot.plotRect; const maxW = R.width * 0.16;
    ctx.fillStyle = withAlpha(resolveColor('magenta'), 0.45);
    cnt.forEach((c, k) => { if (!c) return; const yA = plot.py(y0 + k * w), yB = plot.py(y0 + (k + 1) * w); const wpx = maxW * c / mx; ctx.fillRect(R.left + R.width - wpx, Math.min(yA, yB) + 0.5, wpx, Math.abs(yB - yA) - 1); });
    ctx.fillStyle = resolveColor('muted'); ctx.font = '600 10.5px Inter, sans-serif'; ctx.textAlign = 'right'; ctx.fillText('now: ensemble', R.left + R.width - 2, R.top + 12);
  });
}
function drawDashboard() {
  scene3d.drawDashboard((c, W, Hh) => {
    const g = c.createLinearGradient(0, 0, 0, Hh); g.addColorStop(0, '#07131a'); g.addColorStop(1, '#0b1f28'); c.fillStyle = g; c.fillRect(0, 0, W, Hh);
    c.fillStyle = '#5ee0ff'; c.font = '700 26px Inter, sans-serif'; c.fillText('DIGITAL TWIN · lettuce tray A', 24, 42);
    c.fillStyle = '#8fb5c2'; c.font = '500 17px Inter, sans-serif'; c.fillText({ model: 'mode: digital model (no data)', shadow: 'mode: digital shadow (camera → model)', twin: 'mode: digital twin (camera ↔ lamps)' }[ui.get('mode')], 24, 68);
    const fc = S.fcNow; if (!fc) return;
    c.fillStyle = '#e8f6fb'; c.font = '700 44px "JetBrains Mono", monospace'; c.fillText('day ' + (isFinite(fc.tw.p50) ? fc.tw.p50.toFixed(1) : '—'), 24, 128);
    c.fillStyle = '#8fb5c2'; c.font = '500 17px Inter, sans-serif'; c.fillText('forecast harvest · 90 %: ' + fc.tw.p05.toFixed(1) + '–' + fc.tw.p95.toFixed(1), 24, 154);
    const hs = fc.hs.filter(isFinite); const x0 = 24, x1 = W - 24, yb = Hh - 34, hmax = 92;
    const lo = Math.floor(Math.min(fc.prior.p05, fc.tw.p05) - 1), hi = Math.ceil(Math.max(fc.prior.p95, fc.tw.p95) + 1); const nb = 36, bw = (hi - lo) / nb;
    const cnt = new Array(nb).fill(0); hs.forEach(v => { const k = Math.floor((v - lo) / bw); if (k >= 0 && k < nb) cnt[k]++; }); const mx = Math.max(1, ...cnt);
    c.fillStyle = 'rgba(94,224,255,0.85)'; cnt.forEach((n, k) => { const h = hmax * n / mx; c.fillRect(x0 + (x1 - x0) * k / nb + 1, yb - h, (x1 - x0) / nb - 2, h); });
    c.strokeStyle = 'rgba(143,181,194,0.6)'; c.beginPath(); c.moveTo(x0, yb + 0.5); c.lineTo(x1, yb + 0.5); c.stroke();
    c.fillStyle = '#8fb5c2'; c.font = '500 15px "JetBrains Mono", monospace'; for (let d = Math.ceil(lo / 5) * 5; d <= hi; d += 5) { const X = x0 + (x1 - x0) * (d - lo) / (hi - lo); c.fillText(String(d), X - 8, yb + 22); }
    if (ui.get('reveal') && isFinite(S.trueHarvest)) { const X = x0 + (x1 - x0) * (S.trueHarvest - lo) / (hi - lo); c.strokeStyle = '#62ff9a'; c.lineWidth = 3; c.beginPath(); c.moveTo(X, yb - hmax - 6); c.lineTo(X, yb); c.stroke(); c.lineWidth = 1; }
    c.fillStyle = '#ffb640'; c.font = '600 16px Inter, sans-serif'; c.textAlign = 'right'; c.fillText('PPFD ' + S.clim.ppfd + ' · DLI ' + TW.dliOf(S.clim).toFixed(1), W - 24, 128); c.textAlign = 'left';
  });
}
function drawAll() { if (!S) return; drawGrowth(); drawFW(); drawParam(); drawHarvest(); drawMask(); drawDashboard(); S.dirty = false; }

/* ================================================================ readouts, labels, HUD */
function updateReadouts() {
  const r = S.rhoP, reveal = ui.get('reveal'), day = S.t / DAY;
  const fwE = TW.stats(S.ens.map(m => TW.fwHead(m.x, r))); const fwT = TW.fwHead(S.truth.x, r);
  ro.set('day', day, null, `${String(Math.floor((S.t % DAY) / 3600)).padStart(2, '0')}:${String(Math.floor((S.t % 3600) / 60)).padStart(2, '0')} · lights ${TW.lightOn(S.t, S.clim.photo) ? 'on' : 'off'}`);
  ro.set('dli', TW.dliOf(S.clim), null, `${S.clim.ppfd} µmol m⁻² s⁻¹ × ${S.clim.photo} h${S.loopPPFD !== null && ui.get('mode') === 'twin' ? ' · set by the twin' : ''}`);
  ro.set('fwT', reveal ? fwT : NaN, null, reveal ? `${fmt(TW.dwHead(S.truth.x, r), 2)} g dry matter` : 'hidden — as in reality');
  const relErr = reveal ? Math.abs(fwE.mean - fwT) / fwT : 0;
  ro.set('fwTw', `${fmt(fwE.mean, 1)} ± ${fmt(fwE.sd, 1)}`, reveal ? (relErr < 0.1 ? 'ok' : relErr < 0.25 ? 'warn' : 'bad') : null, 'g head⁻¹ (mean ± SD of the ensemble)');
  const last = S.meas[S.meas.length - 1];
  if (!last) ro.set('meas', '—', null, 'first snapshot at 12:00');
  else if (last.kind === 'camera') ro.set('meas', last.closed ? 'canopy closed' : `${fmt(last.sdwEst, 2)} g`, last.closed ? 'warn' : null, last.closed ? 'cover ≥ 95 %: estimate rejected' : `structural DW · ±${fmt(100 * Math.sqrt(last.R), 0)} % · day ${fmt(last.day, 1)}`);
  else ro.set('meas', `${fmt(last.fw, 1)} g`, null, `fresh weight · ±${fmt(100 * Math.sqrt(last.R), 0)} % · day ${fmt(last.day, 1)}`);
  const ms = TW.stats(S.ens.map(m => Math.exp(m.lp)));
  const pErr = reveal ? Math.abs(Math.log(ms.mean / S.truth.m)) : 0;
  ro.set('param', `${fmt(ms.mean, 2)} ± ${fmt(ms.sd, 2)}`, reveal ? (pErr < 0.08 ? 'ok' : pErr < 0.2 ? 'warn' : 'bad') : null, reveal ? `truth ${fmt(S.truth.m, 2)} · ${PARAM_LABEL[S.key]}` : PARAM_LABEL[S.key]);
  const fc = S.fcNow;
  if (fc) {
    ro.set('harv', `${fmt(fc.tw.p50, 1)} (${fmt(fc.tw.p05, 1)}–${fmt(fc.tw.p95, 1)})`, null, `width ${fmt(fc.tw.p95 - fc.tw.p05, 1)} d · N = ${S.ens.length}`);
    ro.set('harvP', `${fmt(fc.prior.p50, 1)} (${fmt(fc.prior.p05, 1)}–${fmt(fc.prior.p95, 1)})`, null, `nominal model alone: day ${fmt(fc.nominal, 1)}`);
    const e = fc.tw.p50 - S.trueHarvest;
    ro.set('err', reveal && isFinite(e) ? e : NaN, reveal && isFinite(e) ? (Math.abs(e) < 1 ? 'ok' : Math.abs(e) < 3 ? 'warn' : 'bad') : null, reveal ? `true harvest day ${fmt(S.trueHarvest, 1)}` : 'truth hidden');
  }
  ro.set('kwh', S.energy, null, `${fmt(S.energy / Math.max(0.01, TW.fwHead(S.truth.x, r) * r / 1000), 1)} kWh per kg fresh weight so far`);
  const hh = Math.floor((S.t % DAY) / 3600), mm = Math.floor((S.t % 3600) / 60);
  hud.set('t', `Day <b>${Math.floor(day)}</b> · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · lights ${TW.lightOn(S.t, S.clim.photo) ? '<b>ON</b>' : 'off'}`);
  hud.set('m', `${{ model: 'Digital model (no data)', shadow: 'Digital shadow (data → model)', twin: 'Digital twin (data ↔ crop)' }[ui.get('mode')]}`);
}
function updateLabels() {
  const show = ui.get('labels'); Object.values(labels).forEach(l => { l.element.style.display = show ? '' : 'none'; }); if (!show) return;
  const r = S.rhoP, reveal = ui.get('reveal'); const fwE = TW.stats(S.ens.map(m => TW.fwHead(m.x, r)));
  labels.crop.element.innerHTML = `Physical crop<small>${reveal ? fmt(TW.fwHead(S.truth.x, r), 0) + ' g head⁻¹ (truth)' : 'true state hidden'}</small>`;
  labels.twin.element.innerHTML = `Digital ${ui.get('mode') === 'model' ? 'model' : ui.get('mode')}<small>${fmt(fwE.mean, 0)} ± ${fmt(fwE.sd, 0)} g · harvest day ${S.fcNow ? fmt(S.fcNow.tw.p50, 1) : '—'}</small>`;
  const last = S.meas[S.meas.length - 1];
  labels.camera.element.innerHTML = `Top camera<small>${last && last.kind === 'camera' ? (last.closed ? 'canopy closed' : 'PLA ' + fmt(last.pla, 0) + ' cm²') : ui.get('sensor') === 'scale' ? 'idle (weighing)' : 'waiting for 12:00'}</small>`;
  labels.gauge.element.innerHTML = `Ensemble<small>N = ${S.ens.length} · amber = target</small>`;
}

/* ================================================================ clock & frame loop */
const clock = new SimClock({ speed: DAY * +ui.get('speed'), onStep: dt => { if (S) advanceTo(S.t + dt); } });
clock.onState(run => { runBtns[0].innerHTML = run ? 'Pause' : 'Play'; });
function toggle() { if (S.stopAt !== null && S.t >= S.stopAt - 1e-6) { restart(false); clock.play(); return; } clock.toggle(); }
let lastUI = 0, t3 = 0;
stage.onFrame((dt, t) => {
  if (!S) return;
  const r = S.rhoP; const on = TW.lightOn(S.t, S.clim.photo);
  scene3d.setCrop(TW.fwHead(S.truth.x, r));
  const fws = S.ens.map(m => TW.fwHead(m.x, r)); const mean = fws.reduce((s, v) => s + v, 0) / fws.length;
  scene3d.setHolo(mean);
  scene3d.setGauge(fws, ui.get('target'), mean, ui.get('reveal') ? TW.fwHead(S.truth.x, r) : null);
  scene3d.update(dt, t, { light: on ? Math.min(1, 0.15 + S.clim.ppfd / 420) : 0.0, loop: ui.get('mode') === 'twin' });
  t3 += dt; if (t3 > 0.25) { t3 = 0; updateLabels(); }
});
(function uiLoop(now) {
  requestAnimationFrame(uiLoop);
  if (!S || now - lastUI < 250) return; lastUI = now;
  if (clock.running || S.dirty) { updateReadouts(); if (S.dirty) drawAll(); else { drawMask(); } }
})(0);

/* ================================================================ reactions */
ui.onChange((st, id) => {
  if (!S) return;
  if (id === 'speed') { clock.speed = DAY * +st.speed; return; }
  if (id === 'labels') { updateLabels(); return; }
  if (id === 'reveal') { S.dirty = true; drawAll(); updateReadouts(); return; }
  if (['param', 'cv', 'N', 'sigP'].includes(id)) { restart(false); return; }
  if (id === 'mode') { showRelevant(); S.loopPPFD = null; if (st.mode === 'twin') closeLoop(); S.dirty = true; return; }
  if (id === 'rho') { const k = st.rho / S.rhoP; const sc = x => [x[0] * k, x[1] * k]; S.truth.x = sc(S.truth.x); S.ens.forEach(m => { m.x = sc(m.x); }); S.prior.forEach(m => { m.x = sc(m.x); }); S.nominal = sc(S.nominal); S.rhoP = st.rho; scene3d.buildTray(S.rhoP); }
  if (['ppfd', 'photo', 'T', 'co2'].includes(id)) { S.clim = climFromUI(); }
  if (['ppfd', 'photo', 'T', 'co2', 'rho', 'target', 'Dstar'].includes(id)) { if (id === 'Dstar' && st.mode === 'twin') closeLoop(); else runForecasts(); S.dirty = true; }
  if (['sensor', 'sig', 'every'].includes(id)) { S.dirty = true; }
});

/* ================================================================ start */
window.__twLab = { jump(days) { clock.pause(); advanceTo(S.t + days * DAY); drawAll(); updateReadouts(); updateLabels(); }, get S() { return S; } };
restart(false);
setTimeout(() => clock.play(), 800);
