/* ==========================================================================
   Sensor anomaly detection — six coupled greenhouse streams, injectable
   faults, seven causal detectors and a live evaluation against ground truth.
   Model (Derive tab, Eqs. A1–A8):
   • 3 days × 1440 min of air T, RH, CO₂, EC, pH and DO from a simple
     physically coupled greenhouse (solar forcing, heating, vents, vapour
     pressure, CO₂ enrichment, evapo-concentration and dosing, DO saturation);
   • faults: spike, drift, stuck, offset, dropout, noise burst (A1);
   • detectors: range, rate of change, rolling z-score, Hampel, stuck
     (rolling variance), physical consistency (dew point, DO saturation),
     per-sensor isolation forest (A2–A7); evaluation: confusion matrix,
     precision, recall, F1 and detection delay (A8).
   ========================================================================== */
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, downloadCSV } from '/assets/js/plot.js';
import { mulberry32, randn, classificationMetrics, parseTable } from '/assets/js/stats.js';
import { svp, dewPoint, doSaturation, solarElevation, clearSkyIrradiance, fbm1D } from '/assets/js/physics.js';

/* ------------------------------------------------------------------ constants */
const N = 3 * 1440;          // samples (1 per minute, three days)
const WARM = 60;             // min, detectors warm up before evaluation starts
const GRACE = 10;            // min, alarms this soon after a fault ends are neither true nor false alarms
const SENS = [
  { k: 'T', name: 'Air temperature', unit: '°C', col: '#ff9f7a', sd: 0.05, res: 0.01, m: 2, lo: 5, hi: 40, rate: 0.5, dig: 2 },
  { k: 'RH', name: 'Relative humidity', unit: '%', col: '#5cc8ef', sd: 0.3, res: 0.1, m: 8, lo: 20, hi: 100, rate: 2, dig: 1 },
  { k: 'CO2', name: 'CO₂', unit: 'ppm', col: '#f2c14b', sd: 6, res: 1, m: 150, lo: 300, hi: 1500, rate: 40, dig: 0 },
  { k: 'EC', name: 'EC, nutrient solution', unit: 'mS cm⁻¹', col: '#b6a2ff', sd: 0.008, res: 0.001, m: 0.3, lo: 0.5, hi: 4, rate: 0.05, dig: 3 },
  { k: 'pH', name: 'pH, nutrient solution', unit: '', col: '#f07ad0', sd: 0.015, res: 0.01, m: 0.4, lo: 4.5, hi: 7.5, rate: 0.08, dig: 2 },
  { k: 'DO', name: 'Dissolved oxygen', unit: 'mg L⁻¹', col: '#6fd39a', sd: 0.04, res: 0.01, m: 1.5, lo: 2, hi: 12, rate: 0.25, dig: 2 }
];
const FTYPES = [
  { k: 'spike', label: 'Spike' }, { k: 'drift', label: 'Drift' }, { k: 'stuck', label: 'Stuck (flat line)' },
  { k: 'offset', label: 'Offset jump' }, { k: 'dropout', label: 'Dropout (missing)' }, { k: 'noise', label: 'Noise burst' }
];
const FT_IDX = Object.fromEntries(FTYPES.map((f, i) => [f.k, i]));
const DETS = [
  { k: 'range', name: 'Range check', short: 'range', col: '#c9d4ce', chart: 'muted' },
  { k: 'rate', name: 'Rate of change', short: 'rate', col: '#f2c14b', chart: 'amber' },
  { k: 'z', name: 'Rolling z-score', short: 'z-score', col: '#5cc8ef', chart: 'water' },
  { k: 'hampel', name: 'Hampel (median/MAD)', short: 'Hampel', col: '#f07ad0', chart: 'magenta' },
  { k: 'stuck', name: 'Stuck (rolling variance)', short: 'stuck', col: '#ff9f7a', chart: 'c5' },
  { k: 'cons', name: 'Physical consistency', short: 'consistency', col: '#6fd39a', chart: 'accent' },
  { k: 'iforest', name: 'Isolation forest', short: 'iForest', col: '#b6a2ff', chart: 'c4' }
];
const D_IDX = Object.fromEntries(DETS.map((d, i) => [d.k, i]));
const hhmm = t => { const d = Math.floor(t / 1440), h = Math.floor((t % 1440) / 60), m = Math.floor(t % 60); return `day ${d + 1} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
const durTxt = m => m < 60 ? `${Math.round(m)} min` : `${+(m / 60).toFixed(m % 60 ? 1 : 0)} h`;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const quant = (v, r) => Math.round(v / r) * r;

/* ------------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'prec', label: 'Precision (alarms that were real)', unit: '', digits: 2, note: '&nbsp;' })
  .add({ id: 'rec', label: 'Recall (faulty samples caught)', unit: '', digits: 2, note: '&nbsp;' })
  .add({ id: 'f1', label: 'F1 score', unit: '', digits: 2, note: '&nbsp;' })
  .add({ id: 'events', label: 'Fault events detected', unit: '', format: v => v, note: '&nbsp;' })
  .add({ id: 'delay', label: 'Median detection delay', unit: 'min', digits: 0, note: '&nbsp;' })
  .add({ id: 'fa', label: 'False-alarm episodes per day', unit: 'd⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'best', label: 'Best single detector (F1)', unit: '', format: v => v, note: '&nbsp;' })
  .add({ id: 'seen', label: 'Data evaluated so far', unit: '', format: v => v, note: '&nbsp;' });

ui.section('Detectors');
ui.toggle({ id: 'd_range', label: 'Range check (plausible limits, missing)', value: true });
ui.toggle({ id: 'd_rate', label: 'Rate of change', value: true });
ui.slider({ id: 'rateK', label: 'Rate threshold × physical maximum', min: 0.25, max: 6, step: 0.05, value: 1.5, help: 'Maximum plausible change per minute: 0.5 °C, 2 %RH, 40 ppm, 0.05 mS cm⁻¹, 0.08 pH, 0.25 mg L⁻¹' });
ui.toggle({ id: 'd_z', label: 'Rolling z-score', value: true });
ui.slider({ id: 'zW', label: 'z-score window', min: 10, max: 240, step: 5, value: 60, unit: 'min' });
ui.slider({ id: 'zK', label: 'z-score threshold', min: 1.5, max: 15, step: 0.1, value: 5 });
ui.toggle({ id: 'd_hampel', label: 'Hampel filter (median ± k·MAD)', value: true });
ui.slider({ id: 'hW', label: 'Hampel window', min: 5, max: 61, step: 2, value: 15, unit: 'min' });
ui.slider({ id: 'hK', label: 'Hampel threshold k', min: 1.5, max: 15, step: 0.1, value: 6 });
ui.toggle({ id: 'd_stuck', label: 'Stuck-sensor detector', value: true });
ui.slider({ id: 'sW', label: 'Flat-line window', min: 5, max: 180, step: 5, value: 30, unit: 'min', help: 'Flags when the rolling SD falls below ¼ of the normal sensor noise' });
ui.toggle({ id: 'd_cons', label: 'Physical consistency (dew point, DO)', value: true });
ui.slider({ id: 'cTol', label: 'Consistency tolerance', min: -1, max: 3, step: 0.1, value: 0.5, unit: '°C', help: 'RH: dew point > probe T + tol · T: dew point > air T + tol · DO > (1.1 + tol/10) × saturation' });
ui.toggle({ id: 'd_iforest', label: 'Isolation forest (trained on day 1)', value: true });
ui.slider({ id: 'ifThr', label: 'Anomaly-score threshold', min: 0.45, max: 0.85, step: 0.005, value: 0.74 });
ui.section('Inject a fault');
ui.select({ id: 'ftype', label: 'Fault type', options: FTYPES.map(f => ({ value: f.k, label: f.label })), value: 'drift', persist: false });
ui.select({ id: 'fsens', label: 'Sensor', options: SENS.map((s, j) => ({ value: String(j), label: s.name })), value: '1', persist: false });
ui.slider({ id: 'fmag', label: 'Magnitude (× typical fault size)', min: -3, max: 3, step: 0.25, value: 1.5, persist: false, help: 'Typical size: 2 °C, 8 %RH, 150 ppm, 0.3 mS cm⁻¹, 0.4 pH, 1.5 mg L⁻¹ (spikes are twice as large)' });
ui.slider({ id: 'fdur', label: 'Duration', min: 5, max: 720, step: 5, value: 240, unit: 'min', persist: false });
ui.html('<p class="ctl-help" style="margin:4px 0 0">Tip: <b>click a panel</b> on the stage to inject the fault there, at that time.</p>');
ui.buttons([
  { label: 'Inject at a random time', variant: 'primary', onClick: () => injectRandom() },
  { label: 'Clear all', onClick: () => { faults = []; dataChanged(); } }
]);
ui.buttons([
  { label: 'Default scenario', onClick: () => { faults = defaultFaults(); dataChanged(); } },
  { label: 'Random scenario', onClick: () => { randomScenario(); dataChanged(); } }
]);
const faultListEl = ui.html('<div class="an-faults" aria-live="polite"></div>').firstChild;
ui.section('Charts and playback');
ui.segmented({ id: 'focus', label: 'Focus sensor (score chart)', options: SENS.map((s, j) => ({ value: String(j), label: s.k === 'CO2' ? 'CO₂' : s.k })), value: '1' });
ui.select({ id: 'prDet', label: 'Detector for the PR curve and score chart', options: DETS.map(d => ({ value: d.k, label: d.name })), value: 'z' });
ui.toggle({ id: 'truth', label: 'Show fault-free truth (dashed)', value: false });
ui.segmented({ id: 'speed', label: 'Streaming speed', options: [{ value: 30, label: '½ h/s' }, { value: 60, label: '1 h/s' }, { value: 180, label: '3 h/s' }], value: 60, persist: false });
const [playBtn] = ui.buttons([
  { label: '❚❚ Pause', variant: 'primary', onClick: () => { if (tNow >= N - 1) tNow = 1440; clock.toggle(); } },
  { label: 'Reveal all', onClick: () => { tNow = N - 1; clock.pause(); refreshEval(true); draw(); } }
]);
ui.button({ label: 'Download stream, labels and alarms (CSV)', onClick: () => exportStream() });
ui.presets([
  { label: 'Balanced (default)', values: { d_range: true, d_rate: true, d_z: true, d_hampel: true, d_stuck: true, d_cons: true, d_iforest: true, rateK: 1.5, zW: 60, zK: 5, hW: 15, hK: 6, sW: 30, cTol: 0.5, ifThr: 0.74 } },
  { label: 'Strict: few false alarms', values: { rateK: 3, zK: 9, hK: 10, sW: 60, cTol: 1.5, ifThr: 0.78 } },
  { label: 'Sensitive: catch everything', values: { rateK: 0.8, zK: 3.5, hK: 3.5, sW: 15, cTol: 0, ifThr: 0.66 } },
  { label: 'Simple rules only', values: { d_range: true, d_rate: true, d_z: false, d_hampel: false, d_stuck: false, d_cons: false, d_iforest: false } },
  { label: 'Machine learning only', values: { d_range: false, d_rate: false, d_z: false, d_hampel: false, d_stuck: false, d_cons: false, d_iforest: true } }
]);
ui.saveButton('sensor-anomaly', () => ro.values());

/* ------------------------------------------------------------------ synthetic greenhouse (truth) */
let seed = 3;
function ou(rng, sigma, tau) { const a = Math.exp(-1 / tau), b = sigma * Math.sqrt(1 - a * a); let u = sigma * randn(rng); return () => (u = a * u + b * randn(rng)); }
function makeTruth() {
  const rng = mulberry32(1234 + seed * 17);
  const T = new Float64Array(N), RH = new Float64Array(N), C = new Float64Array(N), EC = new Float64Array(N), PH = new Float64Array(N), DO = new Float64Array(N);
  const I = new Float64Array(N), Tw = new Float64Array(N), DOs = new Float64Array(N), Tp = new Float64Array(N);
  const cloud = [0.95, 0.45, 0.8];
  const nT = ou(rng, 0.15, 15), nE = ou(rng, 0.02, 30), nC = ou(rng, 12, 8), nEC = ou(rng, 0.004, 20), nPH = ou(rng, 0.005, 15), nDO = ou(rng, 0.05, 20);
  let Ta = 17, e = 1.66, Cc = 600, ec = 2.0, ph = 5.95, Is = 0, refill = 0, dose = 0;
  for (let k = 0; k < N; k++) {
    const d = Math.floor(k / 1440), h = (k % 1440) / 60;
    const cs = clearSkyIrradiance(solarElevation(59.6, 268, h - 0.9));   // 25 September at Västerås, solar time ≈ clock − 0.9 h
    const cl = Math.max(0.05, cloud[d] * (1 + (d === 1 ? 0.35 : 0.12) * fbm1D(k / 35, 5 + d)));
    I[k] = cs * cl;
    const set = I[k] > 5 ? 19 : 17;
    let tgt = set + 0.012 * I[k]; if (tgt > 23) tgt = 23 + 0.35 * (tgt - 23);
    Ta += (tgt - Ta) * (1 - Math.exp(-1 / 30));
    T[k] = Ta + nT();
    e += (1.66 + 0.0006 * I[k] - e) * (1 - Math.exp(-1 / 40));
    RH[k] = Math.min(98.5, 100 * (e + nE()) / svp(T[k]));
    const v = clamp((T[k] - 21) / 2.5, 0, 1);
    const ct = I[k] < 10 ? 640 : 800 * (1 - v) + 450 * v;
    Cc += (ct - Cc) * (1 - Math.exp(-1 / 25));
    C[k] = Cc + nC();
    ec += 0.0003 * I[k] / 480; if (ec > 2.18 && refill <= 0) refill = 15;
    if (refill > 0) { ec += (1.95 - ec) * 0.18; refill--; }
    EC[k] = ec + nEC();
    ph += 0.00015 + 0.0004 * I[k] / 480; if (ph > 6.2 && dose <= 0) dose = 12;
    if (dose > 0) { ph += (5.8 - ph) * 0.18; dose--; }
    PH[k] = ph + nPH();
    Is += (I[k] - Is) * (1 - Math.exp(-1 / 90));
    Tw[k] = 19.5 + 0.004 * Is;
    DOs[k] = doSaturation(Tw[k]);
    DO[k] = DOs[k] * (0.93 - 0.05 * Is / 480) + nDO();
    Tp[k] = T[k] + 0.08 * randn(rng);                                       // the RH probe's own temperature sensor
  }
  return { truth: [T, RH, C, EC, PH, DO], I, Tw, DOs, Tp };
}

/* ------------------------------------------------------------------ faults (Eq. A1) */
let faults = [];
let fid = 1;
const F = (j, type, t0, dur, mag, sign = 1) => ({ id: fid++, j, type, t0, dur: type === 'spike' ? 1 : dur, mag, sign, seed: 7 + fid * 13 });
function defaultFaults() {
  return [
    F(5, 'dropout', 1200, 40, 0), F(2, 'stuck', 1920, 300, 0), F(3, 'spike', 2070, 1, -1.2), F(0, 'spike', 2300, 1, 1),
    F(3, 'offset', 2400, 360, 1.2), F(1, 'drift', 2520, 720, 2.5), F(0, 'noise', 2640, 60, 1), F(4, 'noise', 3060, 90, 1),
    F(5, 'drift', 3240, 600, 2), F(2, 'spike', 3550, 1, 1.5), F(4, 'stuck', 3600, 180, 0), F(0, 'offset', 3780, 300, -2), F(2, 'spike', 3820, 1, -1)
  ];
}
function randomScenario() {
  const r = mulberry32((Date.now() & 0xffff) + 99); faults = [];
  for (let i = 0; i < 11; i++) {
    const type = FTYPES[Math.floor(r() * FTYPES.length)].k, j = Math.floor(r() * 6);
    const dur = type === 'spike' ? 1 : type === 'drift' ? 240 + Math.round(r() * 60) * 8 : 20 + Math.round(r() * 30) * 10;
    const mag = (r() < 0.5 ? -1 : 1) * (0.75 + Math.round(r() * 8) * 0.25);
    faults.push(F(j, type, 1440 + 30 + Math.floor(r() * (2 * 1440 - 60 - dur)), dur, mag));
  }
}
function applyFaults(W) {
  const rng = mulberry32(555 + seed * 31);
  const meas = W.truth.map((tr, j) => { const s = SENS[j], m = new Float64Array(N); for (let k = 0; k < N; k++) m[k] = quant(tr[k] + s.sd * randn(rng), s.res); return m; });
  const label = SENS.map(() => new Uint8Array(N)), ltype = SENS.map(() => new Int8Array(N).fill(-1));
  const ordered = [...faults].sort((a, b) => (a.type === 'stuck' || a.type === 'dropout') - (b.type === 'stuck' || b.type === 'dropout'));
  for (const f of ordered) {
    const s = SENS[f.j], x = meas[f.j], a = f.mag * s.m, t1 = Math.min(N, f.t0 + f.dur), frozen = x[f.t0], fr = mulberry32(f.seed);
    for (let k = f.t0; k < t1; k++) {
      if (f.type === 'spike') x[k] = quant(x[k] + 2 * a * f.sign, s.res);
      else if (f.type === 'drift') x[k] = quant(x[k] + a * (k - f.t0 + 1) / (t1 - f.t0), s.res);
      else if (f.type === 'offset') x[k] = quant(x[k] + a, s.res);
      else if (f.type === 'noise') x[k] = quant(x[k] + 0.35 * Math.abs(a || s.m) * randn(fr), s.res);
      else if (f.type === 'stuck') x[k] = frozen;
      else if (f.type === 'dropout') x[k] = NaN;
      label[f.j][k] = 1; ltype[f.j][k] = FT_IDX[f.type];
    }
  }
  // recovery windows: alarms in the GRACE minutes after a fault ends are neither false nor true alarms
  const skip = SENS.map(() => new Uint8Array(N));
  for (const f of faults) { const t1 = Math.min(N, f.t0 + f.dur); for (let k = t1; k < Math.min(N, t1 + GRACE); k++) if (!label[f.j][k]) skip[f.j][k] = 1; }
  return { meas, label, ltype, skip };
}

/* ------------------------------------------------------------------ rolling helpers */
function prefix(x, off) { const n = x.length, S1 = new Float64Array(n + 1), S2 = new Float64Array(n + 1), C = new Float64Array(n + 1); for (let i = 0; i < n; i++) { const v = x[i]; const ok = v === v; S1[i + 1] = S1[i] + (ok ? v - off : 0); S2[i + 1] = S2[i] + (ok ? (v - off) * (v - off) : 0); C[i + 1] = C[i] + (ok ? 1 : 0); } return { S1, S2, C, off }; }
function winStats(P, a, b) { a = Math.max(0, a); if (b < a) return null; const c = P.C[b + 1] - P.C[a]; if (c < 3) return null; const s1 = P.S1[b + 1] - P.S1[a], s2 = P.S2[b + 1] - P.S2[a]; const m = s1 / c; return { mean: m + P.off, sd: Math.sqrt(Math.max(0, (s2 - c * m * m) / (c - 1))), n: c }; }
function medianOf(a, n) { const b = a.slice(0, n).sort((p, q) => p - q); return n % 2 ? b[(n - 1) >> 1] : 0.5 * (b[n / 2 - 1] + b[n / 2]); }

/* ------------------------------------------------------------------ detector scores (Eqs. A2–A6) */
function scoreRange(x, s) { const L = x.length, o = new Float64Array(L); for (let k = 0; k < L; k++) { const v = x[k]; o[k] = v !== v || v < s.lo || v > s.hi ? 1 : 0; } return o; }
function scoreRate(x, s) { const L = x.length, o = new Float64Array(L).fill(NaN); let last = NaN; for (let k = 0; k < L; k++) { const v = x[k]; if (v === v) { if (last === last) o[k] = Math.abs(v - last) / s.rate; last = v; } } return o; }
function scoreZ(x, s, w, P) { const L = x.length, o = new Float64Array(L).fill(NaN); for (let k = 1; k < L; k++) { const v = x[k]; if (v !== v) continue; const st = winStats(P, k - w, k - 1); if (!st || st.n < Math.min(10, w / 2)) continue; o[k] = Math.abs(v - st.mean) / Math.max(st.sd, s.sd); } return o; }
function scoreHampel(x, s, w) {
  const L = x.length, o = new Float64Array(L).fill(NaN); const buf = new Float64Array(w), dev = new Float64Array(w);
  for (let k = 1; k < L; k++) {
    const v = x[k]; if (v !== v) continue; let n = 0;
    for (let i = Math.max(0, k - w); i < k; i++) { const u = x[i]; if (u === u) buf[n++] = u; }
    if (n < Math.max(3, w / 2)) continue;
    const med = medianOf(buf, n); for (let i = 0; i < n; i++) dev[i] = Math.abs(buf[i] - med);
    const mad = medianOf(dev, n);
    o[k] = Math.abs(v - med) / Math.max(1.4826 * mad, s.sd);
  }
  return o;
}
function scoreStuck(x, s, w, P) { const L = x.length, o = new Float64Array(L).fill(NaN); for (let k = w - 1; k < L; k++) { if (x[k] !== x[k]) continue; const st = winStats(P, k - w + 1, k); if (!st || st.n < w * 0.8) continue; o[k] = Math.min(1000, s.sd / Math.max(st.sd, 1e-9)); } return o; }
function scoreCons(meas, W, tolNow) {
  const [T, RH, , , , DO] = meas; const oT = new Float64Array(N).fill(NaN), oRH = new Float64Array(N).fill(NaN), oDO = new Float64Array(N).fill(NaN);
  for (let k = 0; k < N; k++) {
    if (RH[k] === RH[k] && RH[k] > 0) {
      const td = dewPoint(W.Tp[k], RH[k]);
      oRH[k] = td - W.Tp[k];                                     // RH probe inconsistent with its own temperature (RH > 100 %)
      if (T[k] === T[k] && oRH[k] <= tolNow) oT[k] = td - T[k];   // RH plausible: is the air-temperature sensor consistent with it?
    }
    if (DO[k] === DO[k]) oDO[k] = (DO[k] / W.DOs[k] - 1.1) * 10;
  }
  const none = new Float64Array(N).fill(NaN);
  return [oT, oRH, none, none, none, oDO];
}

/* ------------------------------------------------------------------ isolation forest (Eq. A7) */
const cN = n => n > 2 ? 2 * (Math.log(n - 1) + 0.5772156649) - 2 * (n - 1) / n : n === 2 ? 1 : 0;
function features(x, s, P) {
  const L = x.length, F = new Array(L).fill(null); const buf = new Float64Array(15); let last = NaN;
  for (let k = 0; k < L; k++) {
    const v = x[k]; if (v !== v) continue;
    let n = 0; for (let i = Math.max(0, k - 15); i < k; i++) { const u = x[i]; if (u === u) buf[n++] = u; }
    const s15 = winStats(P, k - 14, k), s60 = winStats(P, k - 59, k);
    if (n >= 8 && last === last && s15 && s60) {
      const med = medianOf(buf, n);
      F[k] = [(v - med) / s.sd, (v - last) / s.sd, Math.log10(Math.max(s15.sd, 0.02 * s.sd) / s.sd), Math.log10(Math.max(s60.sd, 0.02 * s.sd) / s.sd)];
    }
    last = v;
  }
  return F;
}
function buildTree(X, idx, depth, hLim, rng) {
  if (depth >= hLim || idx.length <= 1) return { n: idx.length };
  const dims = X[idx[0]].length;
  for (let t = 0; t < dims * 2; t++) {
    const q = Math.floor(rng() * dims); let lo = Infinity, hi = -Infinity;
    for (const i of idx) { const v = X[i][q]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi > lo) { const p = lo + rng() * (hi - lo); const L = [], R = []; for (const i of idx) (X[i][q] < p ? L : R).push(i); return { q, p, l: buildTree(X, L, depth + 1, hLim, rng), r: buildTree(X, R, depth + 1, hLim, rng) }; }
  }
  return { n: idx.length };
}
function iforestScores(Fe, trainEnd, rng, nTrees = 100, psi = 256, trainStart = WARM) {
  const rows = []; for (let k = trainStart; k < trainEnd; k++) if (Fe[k]) rows.push(Fe[k]);
  const out = new Float64Array(Fe.length).fill(NaN); if (rows.length < 32) return out;
  const m = Math.min(psi, rows.length), hLim = Math.ceil(Math.log2(m)), trees = [];
  for (let t = 0; t < nTrees; t++) {
    const idx = []; const used = new Set(); while (idx.length < m) { const i = Math.floor(rng() * rows.length); if (!used.has(i)) { used.add(i); idx.push(i); } }
    trees.push(buildTree(rows, idx, 0, hLim, rng));
  }
  const cm = cN(m);
  for (let k = 0; k < Fe.length; k++) {
    const x = Fe[k]; if (!x) continue; let h = 0;
    for (const tr of trees) { let nd = tr, e = 0; while (nd.n === undefined) { nd = x[nd.q] < nd.p ? nd.l : nd.r; e++; } h += e + cN(nd.n); }
    out[k] = Math.pow(2, -(h / nTrees) / cm);
  }
  return out;
}

/* ------------------------------------------------------------------ pipeline */
const ST = { W: null, D: null, sc: null, key: {} };
function thresholds(p) { return { range: 0.5, rate: p.rateK, z: p.zK, hampel: p.hK, stuck: 4, cons: p.cTol, iforest: p.ifThr }; }
function enabled(p) { return DETS.map(d => !!p['d_' + d.k]); }
function computeData() {
  if (!ST.W || ST.key.seed !== seed) { ST.W = makeTruth(); ST.key.seed = seed; }
  ST.D = applyFaults(ST.W);
  ST.P = ST.D.meas.map(x => { let s = 0, c = 0; for (const v of x) if (v === v) { s += v; c++; } return prefix(x, c ? s / c : 0); });
  ST.sc = DETS.map(() => SENS.map(() => null));
  ST.sc[D_IDX.range] = ST.D.meas.map((x, j) => scoreRange(x, SENS[j]));
  ST.sc[D_IDX.rate] = ST.D.meas.map((x, j) => scoreRate(x, SENS[j]));
  ST.key.z = ST.key.h = ST.key.s = ST.key.c = null; ST.ifPending = true;
}
function computeWindowed(p) {
  if (ST.key.c !== p.cTol) { ST.sc[D_IDX.cons] = scoreCons(ST.D.meas, ST.W, p.cTol); ST.key.c = p.cTol; }
  if (ST.key.z !== p.zW) { ST.sc[D_IDX.z] = ST.D.meas.map((x, j) => scoreZ(x, SENS[j], p.zW, ST.P[j])); ST.key.z = p.zW; }
  if (ST.key.h !== p.hW) { ST.sc[D_IDX.hampel] = ST.D.meas.map((x, j) => scoreHampel(x, SENS[j], p.hW)); ST.key.h = p.hW; }
  if (ST.key.s !== p.sW) { ST.sc[D_IDX.stuck] = ST.D.meas.map((x, j) => scoreStuck(x, SENS[j], p.sW, ST.P[j])); ST.key.s = p.sW; }
  if (ST.ifPending) {
    const rng = mulberry32(2024 + seed);
    ST.sc[D_IDX.iforest] = ST.D.meas.map((x, j) => iforestScores(features(x, SENS[j], ST.P[j]), 1440, rng));
    ST.ifPending = false;
  }
}
function flagsFor(di, j, thr) {
  const s = ST.sc[di][j], o = new Uint8Array(N); if (!s) return o;
  if (DETS[di].k === 'stuck') { for (let k = 0; k < N; k++) o[k] = s[k] > thr ? 1 : 0; return o; }
  for (let k = 0; k < N; k++) o[k] = s[k] > thr ? 1 : 0;
  return o;
}
function combine(p) {
  const th = thresholds(p), en = enabled(p);
  ST.fl = DETS.map((d, di) => SENS.map((s, j) => flagsFor(di, j, th[d.k])));
  ST.E = SENS.map((s, j) => { const e = new Uint8Array(N), first = new Int8Array(N).fill(-1); for (let di = 0; di < DETS.length; di++) { if (!en[di]) continue; const f = ST.fl[di][j]; for (let k = 0; k < N; k++) if (f[k] && first[k] < 0) { first[k] = di; e[k] = 1; } } return { e, first }; });
}

/* ------------------------------------------------------------------ evaluation (Eq. A8) */
function evaluate(tEnd, flagSets = ST.E.map(x => x.e)) {
  let tp = 0, fp = 0, fn = 0, tn = 0, faEp = 0;
  for (let j = 0; j < 6; j++) {
    const L = ST.D.label[j], D = flagSets[j], SK = ST.D.skip[j]; let inFP = false;
    for (let k = WARM; k <= tEnd; k++) {
      if (SK[k]) continue;
      const l = L[k], d = D[k];
      if (l && d) tp++; else if (!l && d) { fp++; if (!inFP) { faEp++; inFP = true; } } else if (l && !d) fn++; else tn++;
      if (!( !l && d)) inFP = false;
    }
  }
  const ev = []; for (const f of faults) { if (f.t0 > tEnd) continue; const D = flagSets[f.j]; let det = -1; for (let k = f.t0; k < Math.min(N, f.t0 + f.dur, tEnd + 1); k++) if (D[k]) { det = k; break; } ev.push({ f, det, delay: det >= 0 ? det - f.t0 : NaN }); }
  return { tp, fp, fn, tn, faEp, ev, days: Math.max(1e-9, (tEnd - WARM + 1) / 1440) };
}
function metrics(c) { const m = classificationMetrics(c.tp, c.fp, c.tn, c.fn); return { prec: c.tp + c.fp ? m.precision : NaN, rec: c.tp + c.fn ? m.recall : NaN, f1: c.tp ? m.f1 : 0 }; }

/* ------------------------------------------------------------------ stage */
const stageEl = document.getElementById('stage');
const cv = document.createElement('canvas'); stageEl.appendChild(cv);
const ctx = cv.getContext('2d');
const hud = hudChips(stageEl); hud.el.style.flexDirection = 'row'; hud.el.style.flexWrap = 'wrap';
const tip = document.createElement('div'); tip.className = 'an-tip'; stageEl.appendChild(tip);
stageToolbar(stageEl, {
  onReset: () => { view = [0, N]; draw(); },
  onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'sensor-anomaly.png'; a.click(); }
});
let W = 0, H = 0, DPR = 1, LY = null, view = [0, N], tNow = 1680;
function layout() {
  const narrow = W < 600; const top = narrow ? 48 : 50, bottom = narrow ? 58 : 46, left = narrow ? 74 : Math.min(168, Math.max(118, W * 0.17)), right = narrow ? 6 : 12, gap = narrow ? 4 : 6;
  const ph = (H - top - bottom - gap * 5) / 6;
  return { narrow, top, bottom, left, right, gap, ph, pw: W - left - right, panels: SENS.map((s, j) => ({ y: top + j * (ph + gap), h: ph })) };
}
function resize() { DPR = Math.min(2, window.devicePixelRatio || 1); W = stageEl.clientWidth; H = stageEl.clientHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cv.style.width = W + 'px'; cv.style.height = H + 'px'; LY = layout(); ST.cache = null; draw(); }
new ResizeObserver(resize).observe(stageEl);
const X = t => LY.left + (t - view[0]) / (view[1] - view[0]) * LY.pw;
const tFromX = x => view[0] + (x - LY.left) / LY.pw * (view[1] - view[0]);
function yRange(j) {
  if (!ST.yr) ST.yr = [];
  if (!ST.yr[j]) { const tr = ST.W.truth[j]; let a = Infinity, b = -Infinity; for (const v of tr) { if (v < a) a = v; if (v > b) b = v; } const s = SENS[j]; ST.yr[j] = [a - 0.9 * s.m, b + 0.9 * s.m]; }
  return ST.yr[j];
}
function columns() {
  const key = [W, view[0], view[1], ST.ver].join('|');
  if (ST.cache && ST.cache.key === key) return ST.cache;
  const cols = Math.max(1, Math.floor(LY.pw)); const span = view[1] - view[0];
  const C = SENS.map((s, j) => {
    const x = ST.D.meas[j], tr = ST.W.truth[j]; const mn = new Float64Array(cols).fill(NaN), mx = new Float64Array(cols).fill(NaN), tv = new Float64Array(cols), k0 = new Int32Array(cols), k1 = new Int32Array(cols);
    for (let c = 0; c < cols; c++) {
      const a = Math.max(0, Math.floor(view[0] + c / cols * span)), b = Math.min(N - 1, Math.max(a, Math.floor(view[0] + (c + 1) / cols * span) - 1));
      k0[c] = a; k1[c] = b; let lo = Infinity, hi = -Infinity; for (let k = a; k <= b; k++) { const v = x[k]; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } }
      if (lo <= hi) { mn[c] = lo; mx[c] = hi; } tv[c] = tr[Math.min(N - 1, (a + b) >> 1)];
    }
    return { mn, mx, tv, k0, k1 };
  });
  ST.cache = { key, cols, C }; return ST.cache;
}
function draw() {
  if (!W || !LY || !ST.E) return;
  const p = ui.values(); const c = ctx; c.setTransform(DPR, 0, 0, DPR, 0, 0);
  hud.set('t', LY.narrow ? `<b>${hhmm(Math.floor(tNow))}</b>` : `Streaming · <b>${hhmm(Math.floor(tNow))}</b>`); if (LY.narrow) hud.remove('s');
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0e1714'); g.addColorStop(1, '#080e0c'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  const CC = columns(); const xNow = X(tNow + 0.5);
  const en = enabled(p);
  c.font = '500 10px "JetBrains Mono", monospace';
  // day / hour grid behind all panels
  const span = view[1] - view[0]; const stepH = span > 2000 ? 360 : span > 700 ? 120 : span > 240 ? 60 : span > 90 ? 15 : 5;
  SENS.forEach((s, j) => {
    const P = LY.panels[j], y0 = P.y, h = P.h, [lo, hi] = yRange(j), Y = v => y0 + h - 8 - (v - lo) / (hi - lo) * (h - 14);
    // panel background
    c.fillStyle = 'rgba(255,255,255,0.028)'; c.fillRect(LY.left, y0, LY.pw, h);
    c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 1; c.beginPath();
    for (let t = Math.ceil(view[0] / stepH) * stepH; t <= view[1]; t += stepH) { const x = Math.round(X(t)) + 0.5; c.moveTo(x, y0); c.lineTo(x, y0 + h); }
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.16)'; c.beginPath(); for (let d = 1; d < 3; d++) { const x = Math.round(X(d * 1440)) + 0.5; if (x > LY.left && x < LY.left + LY.pw) { c.moveTo(x, y0); c.lineTo(x, y0 + h); } } c.stroke();
    // fault bands
    for (const f of faults) {
      if (f.j !== j || f.t0 > view[1] || f.t0 + f.dur < view[0]) continue;
      const xa = X(f.t0), xb = Math.max(xa + 3, X(f.t0 + f.dur));
      c.fillStyle = 'rgba(255,92,92,0.13)'; c.fillRect(xa, y0, xb - xa, h);
      c.fillStyle = 'rgba(255,120,120,0.85)'; c.fillRect(xa, y0, Math.max(2, xb - xa), 2);
      if (xb - xa > 34 || f.type === 'spike') { c.fillStyle = 'rgba(255,170,160,0.95)'; c.textAlign = 'left'; c.fillText(FTYPES[FT_IDX[f.type]].k, Math.min(xa + 3, LY.left + LY.pw - 40), y0 + 12); }
    }
    // clip to the panel
    c.save(); c.beginPath(); c.rect(LY.left, y0, LY.pw, h); c.clip();
    const col = CC.C[j];
    // truth (dashed)
    if (p.truth) { c.strokeStyle = 'rgba(255,255,255,0.35)'; c.setLineDash([4, 4]); c.lineWidth = 1; c.beginPath(); for (let i = 0; i < CC.cols; i++) { const x = LY.left + i + 0.5, y = Y(col.tv[i]); i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); c.setLineDash([]); }
    // measured: revealed part
    c.strokeStyle = s.col; c.lineWidth = 1.4; c.shadowColor = s.col; c.shadowBlur = 4; c.beginPath(); let pen = false;
    for (let i = 0; i < CC.cols; i++) {
      if (col.k0[i] > tNow) break;
      const a = col.mn[i], b = col.mx[i]; if (a !== a) { pen = false; continue; }
      const x = LY.left + i + 0.5, ya = Y(clamp(a, lo, hi)), yb = Y(clamp(b, lo, hi));
      if (!pen) { c.moveTo(x, ya); pen = true; } c.lineTo(x, ya); if (yb !== ya) { c.lineTo(x, yb); }
    }
    c.stroke(); c.shadowBlur = 0;
    // out-of-panel markers and missing data
    for (let i = 0; i < CC.cols; i++) {
      if (col.k0[i] > tNow) break; const x = LY.left + i + 0.5;
      if (col.mx[i] > hi) { c.fillStyle = s.col; c.beginPath(); c.moveTo(x, y0 + 2); c.lineTo(x - 3, y0 + 8); c.lineTo(x + 3, y0 + 8); c.fill(); }
      if (col.mn[i] < lo) { c.fillStyle = s.col; c.beginPath(); c.moveTo(x, y0 + h - 2); c.lineTo(x - 3, y0 + h - 8); c.lineTo(x + 3, y0 + h - 8); c.fill(); }
      if (col.mn[i] !== col.mn[i]) { c.fillStyle = 'rgba(255,120,120,0.5)'; c.fillRect(x - 0.5, y0 + h / 2 - 1, 1.5, 2); }
    }
    // detections on the line: one marker per column, coloured by the first detector that fired
    const E = ST.E[j], L = ST.D.label[j], x0 = ST.D.meas[j];
    let lastX = -99;
    for (let i = 0; i < CC.cols; i++) {
      if (col.k0[i] > tNow) break;
      let hit = -1, kk = -1; for (let k = col.k0[i]; k <= Math.min(col.k1[i], tNow); k++) if (E.e[k]) { hit = E.first[k]; kk = k; break; }
      if (hit < 0 || LY.left + i - lastX < 4) continue; lastX = LY.left + i;
      const v = x0[kk]; const y = v === v ? Y(clamp(v, lo, hi)) : y0 + h / 2;
      c.strokeStyle = DETS[hit].col; c.lineWidth = 1.6; c.beginPath(); c.arc(LY.left + i + 0.5, y, 3.2, 0, 7); c.stroke();
    }
    // evaluation strip: TP green, FP amber, FN red
    for (let i = 0; i < CC.cols; i++) {
      if (col.k0[i] > tNow) break; let tp = 0, fp = 0, fn = 0;
      const SK = ST.D.skip[j];
      for (let k = Math.max(WARM, col.k0[i]); k <= Math.min(col.k1[i], tNow); k++) { if (SK[k]) continue; const l = L[k], d = E.e[k]; if (l && d) tp = 1; else if (!l && d) fp = 1; else if (l && !d) fn = 1; }
      const cc = fn ? '#ff6b6b' : fp ? '#f2c14b' : tp ? '#6fd39a' : null; if (cc) { c.fillStyle = cc; c.fillRect(LY.left + i, y0 + h - 4, 1, 4); }
    }
    // unrevealed future
    if (xNow < LY.left + LY.pw) { c.fillStyle = 'rgba(6,10,9,0.55)'; c.fillRect(Math.max(LY.left, xNow), y0, LY.left + LY.pw - Math.max(LY.left, xNow), h); }
    c.restore();
    // label column
    c.textAlign = 'left'; c.fillStyle = s.col; c.font = LY.narrow ? '650 10px Inter, sans-serif' : '650 11.5px Inter, sans-serif'; c.fillText(LY.narrow ? (s.k === 'CO2' ? 'CO₂' : s.k) : s.name, LY.narrow ? 8 : 12, y0 + (LY.narrow ? 12 : 15));
    const kk = clamp(Math.floor(tNow), 0, N - 1), v = ST.D.meas[j][kk];
    c.font = LY.narrow ? '600 10px "JetBrains Mono", monospace' : '600 13px "JetBrains Mono", monospace'; c.fillStyle = '#e6eee9'; c.fillText(v === v ? (LY.narrow ? v.toFixed(Math.min(s.dig, 1)) : `${v.toFixed(s.dig)} ${s.unit}`) : `— ${LY.narrow ? '' : s.unit}`, LY.narrow ? 8 : 12, y0 + (LY.narrow ? 25 : 33));
    let alarm = false; for (let k = Math.max(0, kk - 10); k <= kk; k++) if (ST.E[j].e[k]) alarm = true;
    const faulty = ST.D.label[j][kk] === 1;
    c.fillStyle = alarm ? '#ff6b6b' : '#6fd39a'; c.beginPath(); c.arc(LY.narrow ? LY.left - 9 : 16, LY.narrow ? y0 + 8 : y0 + h - 12, LY.narrow ? 3.5 : 4.5, 0, 7); c.fill();
    c.font = '500 10px "JetBrains Mono", monospace'; c.fillStyle = 'rgba(210,225,218,0.8)'; if (!LY.narrow) c.fillText(alarm ? 'ALARM' : 'ok', 26, y0 + h - 8.5);
    if (faulty && !LY.narrow) { c.fillStyle = 'rgba(255,150,140,0.9)'; c.fillText('· fault active', 64, y0 + h - 8.5); }
    c.fillStyle = 'rgba(200,215,208,0.42)'; c.textAlign = 'left'; c.font = '500 9px "JetBrains Mono", monospace';
    c.fillText(hi.toFixed(Math.min(2, s.dig)), LY.left + 4, y0 + 10); c.fillText(lo.toFixed(Math.min(2, s.dig)), LY.left + 4, y0 + h - 7);
  });
  // time cursor
  if (xNow >= LY.left && xNow <= LY.left + LY.pw) {
    c.strokeStyle = 'rgba(155,231,182,0.85)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(xNow + 0.5, LY.top - 4); c.lineTo(xNow + 0.5, H - LY.bottom + 2); c.stroke();
  }
  // time axis
  const yA = H - LY.bottom + 14; c.fillStyle = 'rgba(210,225,218,0.75)'; c.font = '500 10px "JetBrains Mono", monospace'; c.textAlign = 'center';
  const lab = [10, 15, 30, 60, 120, 180, 240, 360, 720, 1440].find(m => m / span * LY.pw >= (LY.narrow ? 46 : 58)) || 1440;
  for (let t = Math.ceil(view[0] / lab) * lab; t <= view[1]; t += lab) { const x = X(t); if (x < LY.left + 14 || x > LY.left + LY.pw - 14) continue; const hh = Math.floor((t % 1440) / 60), mm = t % 60; c.fillText(t % 1440 === 0 ? `day ${t / 1440 + 1}` : `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, x, yA); }
  // legend row
  let lx = LY.narrow ? 8 : LY.left; let ly = LY.narrow ? H - 26 : H - 12; c.textAlign = 'left'; c.font = '500 10px Inter, sans-serif';
  DETS.forEach((d, i) => { if (!en[i]) return; if (lx + c.measureText(d.short).width + 14 > W - 6) { lx = 8; ly += 13; } c.strokeStyle = d.col; c.lineWidth = 1.6; c.beginPath(); c.arc(lx + 4, ly - 3.5, 3.2, 0, 7); c.stroke(); c.fillStyle = 'rgba(215,228,221,0.85)'; c.fillText(d.short, lx + 11, ly); lx += c.measureText(d.short).width + 22; });
  lx += 6; [['#6fd39a', 'TP'], ['#f2c14b', 'FP'], ['#ff6b6b', 'FN']].forEach(([cc, t]) => { if (lx + 30 > W - 6) { lx = 8; ly += 13; } c.fillStyle = cc; c.fillRect(lx, ly - 7, 10, 4); c.fillStyle = 'rgba(215,228,221,0.85)'; c.fillText(t, lx + 13, ly); lx += 34; });
  if (lx < LY.left + LY.pw - 150) { c.fillStyle = 'rgba(255,120,120,0.85)'; c.fillRect(lx + 6, ly - 8, 12, 6); c.fillStyle = 'rgba(215,228,221,0.85)'; c.fillText('injected fault', lx + 22, ly); }
}

/* stage interaction: hover tooltip, drag to pan, wheel to zoom, click to inject */
let drag = null;
function hitPanel(y) { return LY.panels.findIndex(P => y >= P.y && y <= P.y + P.h); }
cv.addEventListener('pointerdown', e => { const r = cv.getBoundingClientRect(); drag = { x: e.clientX - r.left, y: e.clientY - r.top, v: [...view], moved: false }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', e => {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (drag) {
    const dx = x - drag.x; if (Math.abs(dx) > 4) drag.moved = true;
    if (drag.moved) { const sp = drag.v[1] - drag.v[0]; let a = drag.v[0] - dx / LY.pw * sp; a = clamp(a, 0, N - sp); view = [a, a + sp]; tip.style.display = 'none'; draw(); return; }
  }
  const j = hitPanel(y); if (j < 0 || x < LY.left || !ST.D) { tip.style.display = 'none'; return; }
  const k = clamp(Math.round(tFromX(x)), 0, N - 1); const s = SENS[j]; const v = ST.D.meas[j][k], tv = ST.W.truth[j][k];
  const fl = DETS.filter((d, di) => enabled(ui.values())[di] && ST.fl[di][j][k]).map(d => `<span style="color:${d.col}">${d.short}</span>`).join(', ');
  const lt = ST.D.ltype[j][k];
  tip.innerHTML = `<b>${s.name}</b> · ${hhmm(k)}<br>measured <b>${v === v ? v.toFixed(s.dig) : 'missing'}</b> ${s.unit} · truth ${tv.toFixed(s.dig)}<br>${lt >= 0 ? `<span style="color:#ff9f95">fault: ${FTYPES[lt].label}</span><br>` : ''}${k > tNow ? '<i>not yet streamed</i>' : fl ? 'flagged by ' + fl : 'no alarm'}`;
  tip.style.display = 'block'; const tw = tip.offsetWidth; tip.style.left = Math.min(W - tw - 8, x + 14) + 'px'; tip.style.top = Math.max(8, y - 10) + 'px';
});
cv.addEventListener('pointerup', e => {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (drag && !drag.moved) { const j = hitPanel(y); if (j >= 0 && x >= LY.left) injectAt(j, clamp(Math.round(tFromX(x)), WARM, N - 2)); }
  drag = null;
});
cv.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
cv.addEventListener('wheel', e => {
  e.preventDefault(); const r = cv.getBoundingClientRect(), x = e.clientX - r.left; const tc = tFromX(clamp(x, LY.left, LY.left + LY.pw));
  const sp = view[1] - view[0]; const ns = clamp(sp * (e.deltaY > 0 ? 1.25 : 0.8), 60, N); let a = tc - (tc - view[0]) * ns / sp; a = clamp(a, 0, N - ns); view = [a, a + ns]; draw();
}, { passive: false });

/* ------------------------------------------------------------------ injecting faults */
function injectAt(j, t0) {
  const p = ui.values(); const type = p.ftype; const dur = type === 'spike' ? 1 : Math.min(p.fdur, N - t0 - 1);
  const mag = type === 'stuck' || type === 'dropout' ? 0 : (p.fmag === 0 ? 1 : p.fmag);
  faults.push(F(j, type, t0, dur, Math.abs(mag), Math.sign(mag) || 1));
  if (type !== 'spike') faults[faults.length - 1].mag = mag;
  if (window.FFP && FFP.toast) FFP.toast(`Injected ${FTYPES[FT_IDX[type]].label.toLowerCase()} on ${SENS[j].name} at ${hhmm(t0)}`);
  dataChanged();
}
function injectRandom() { const p = ui.values(); const dur = p.ftype === 'spike' ? 1 : p.fdur; const r = Math.random(); injectAt(+p.fsens, Math.floor(1440 + r * Math.max(1, N - 1440 - dur - 2))); }
function renderFaultList() {
  if (!faults.length) { faultListEl.innerHTML = '<p class="ctl-help">No faults injected: every alarm now is a false alarm.</p>'; return; }
  faultListEl.innerHTML = `<div class="an-fl-head">${faults.length} injected fault${faults.length > 1 ? 's' : ''}</div>` + faults.slice().sort((a, b) => a.t0 - b.t0).map(f => {
    const ev = ST.lastEval && ST.lastEval.ev.find(e => e.f.id === f.id);
    const st = !ev ? '<span class="an-st wait">upcoming</span>' : ev.det >= 0 ? `<span class="an-st ok">caught ${durTxt(ev.delay)}</span>` : '<span class="an-st bad">missed</span>';
    return `<div class="an-fl"><span class="an-dot" style="background:${SENS[f.j].col}"></span><span>${SENS[f.j].k === 'CO2' ? 'CO₂' : SENS[f.j].k} ${FTYPES[FT_IDX[f.type]].k}<small>${hhmm(f.t0)}${f.type !== 'spike' ? ' · ' + durTxt(f.dur) : ''}</small></span>${st}<button type="button" data-id="${f.id}" aria-label="Remove fault">✕</button></div>`;
  }).join('');
}
faultListEl.addEventListener('click', e => { const b = e.target.closest('button[data-id]'); if (!b) return; faults = faults.filter(f => f.id !== +b.dataset.id); dataChanged(); });

/* ------------------------------------------------------------------ charts */
const prPlot = new Plot('#chart-pr', { x: { label: 'Recall', unit: '', min: 0, max: 1 }, y: { label: 'Precision', unit: '', min: 0, max: 1.02 } });
const scorePlot = new Plot('#chart-score', { x: { label: 'Time', unit: 'h', min: 0, max: 72 }, y: { label: 'Detector score', unit: '', min: 0 } });
const cmEl = document.getElementById('confusion'), matEl = document.getElementById('coverage');
const SWEEP = {
  rate: Array.from({ length: 22 }, (_, i) => 0.2 * Math.pow(60, i / 21)),
  z: Array.from({ length: 22 }, (_, i) => 1.2 * Math.pow(25, i / 21)),
  hampel: Array.from({ length: 22 }, (_, i) => 1.2 * Math.pow(25, i / 21)),
  stuck: Array.from({ length: 18 }, (_, i) => 1.1 * Math.pow(60, i / 17)),
  cons: Array.from({ length: 21 }, (_, i) => -1.5 + i * 0.25),
  iforest: Array.from({ length: 21 }, (_, i) => 0.44 + i * 0.02)
};
function prCurve(p) {
  const dk = p.prDet, di = D_IDX[dk], th = thresholds(p);
  const pts = [], evp = [];
  const list = SWEEP[dk] || [0.5];
  const evRec = c => c.ev.length ? c.ev.filter(e => e.det >= 0).length / c.ev.length : NaN;
  for (const t of list) { const fs = SENS.map((s, j) => flagsFor(di, j, t)); const c = evaluate(N - 1, fs), m = metrics(c); if (isFinite(m.prec) && isFinite(m.rec)) { pts.push([m.rec, m.prec, t]); evp.push([evRec(c), m.prec, t]); } }
  pts.sort((a, b) => a[0] - b[0]); evp.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const cc = evaluate(N - 1, SENS.map((s, j) => flagsFor(di, j, th[dk]))), cur = metrics(cc);
  prPlot.clear();
  if (pts.length > 1) prPlot.line('pr', pts.map(q => q[0]), pts.map(q => q[1]), { color: DETS[di].chart, width: 2.2, label: 'recall per sample', tipExtra: i => `(threshold ${fmt(pts[i][2], 2)})` });
  if (evp.length > 1) prPlot.line('pre', evp.map(q => q[0]), evp.map(q => q[1]), { color: DETS[di].chart, width: 2, dash: [6, 4], label: 'recall per fault event', tipExtra: i => `(threshold ${fmt(evp[i][2], 2)})` });
  prPlot.scatter('prs', pts.map(q => q[0]), pts.map(q => q[1]), { color: DETS[di].chart, r: 2.6, noTip: true });
  const ac = evaluate(N - 1), all = metrics(ac);
  if (isFinite(cur.rec)) { prPlot.point('cur', cur.rec, isFinite(cur.prec) ? cur.prec : 0, { color: 'magenta', r: 6, label: 'current threshold' }); prPlot.point('cure', evRec(cc), isFinite(cur.prec) ? cur.prec : 0, { color: 'magenta', r: 4 }); }
  if (isFinite(all.rec)) prPlot.point('ens', all.rec, isFinite(all.prec) ? all.prec : 0, { color: 'ink', r: 5 });
  const base = (() => { let l = 0, n = 0; for (let j = 0; j < 6; j++) for (let k = WARM; k < N; k++) { l += ST.D.label[j][k]; n++; } return l / n; })();
  prPlot.hline('base', base, { color: 'muted', label: `no-skill line (fault share ${fmt(100 * base, 1)} %)`, dash: [4, 4] });
}
function scoreChart(p) {
  const j = +p.focus, dk = p.prDet, di = D_IDX[dk], s = ST.sc[di][j], th = thresholds(p)[dk];
  const xs = [], ys = []; let mx = 0;
  const vals = []; for (let k = 0; k < N; k++) { const v = s ? s[k] : NaN; if (v === v) vals.push(v); }
  vals.sort((a, b) => a - b); const q99 = vals.length ? vals[Math.floor(0.995 * (vals.length - 1))] : 1;
  const cap = Math.max(th * 2.2, q99 * 1.3, dk === 'cons' ? 2 : 0.1);
  for (let k = 0; k < N; k += 2) { const v = s ? s[k] : NaN; xs.push(k / 60); ys.push(v === v ? Math.max(dk === 'cons' ? -cap : 0, Math.min(cap, v)) : NaN); }
  scorePlot.clear();
  faults.filter(f => f.j === j).forEach((f, i) => scorePlot.region('f' + i, f.t0 / 60, (f.t0 + Math.max(f.dur, 3)) / 60, { color: 'danger', alpha: 0.12 }));
  scorePlot.line('s', xs, ys, { color: DETS[di].chart, width: 1.3, label: `${DETS[di].name} score — ${SENS[j].name}` });
  scorePlot.hline('th', th, { color: 'danger', label: `threshold ${fmt(th, 2)}`, dash: [6, 4] });
  scorePlot.vline('now', tNow / 60, { color: 'muted', label: 'now', dash: [2, 3] });
  scorePlot.setAxis('y', { min: dk === 'cons' ? -Math.min(cap, 6) : 0, max: cap });
  document.getElementById('score-note').innerHTML = {
    range: 'Score 1 = outside the plausible range or missing, 0 = inside.', rate: 'Score = |change per minute| ÷ physically plausible maximum.',
    z: 'Score = |x − rolling mean| ÷ rolling SD over the previous window.', hampel: 'Score = |x − rolling median| ÷ (1.4826 × MAD), a robust z-score.',
    stuck: 'Score = normal noise SD ÷ rolling SD: large when the signal has stopped moving.', cons: 'RH: dew point − probe temperature; T: dew point − air temperature (°C, evaluated only when RH is plausible); DO: (DO/saturation − 1.1) × 10.',
    iforest: 'Score s = 2^(−E[h]/c(ψ)): close to 1 = isolated quickly = anomalous; ≈ 0.5 or lower = normal.'
  }[dk] + ' Shaded: injected faults on this sensor.';
}
function renderConfusion(c, m) {
  const tot = c.tp + c.fp + c.fn + c.tn || 1;
  const cell = (v, cls, lab) => `<div class="cm-cell ${cls}" style="--a:${Math.min(1, 0.15 + 3 * v / tot)}"><div class="cm-n">${v.toLocaleString('en-GB')}</div><div class="cm-l">${lab}</div></div>`;
  cmEl.innerHTML = `<div class="cm-grid"><div></div><div class="cm-h">alarm</div><div class="cm-h">no alarm</div>
    <div class="cm-v">faulty</div>${cell(c.tp, 'tp', 'true positive')}${cell(c.fn, 'fn', 'false negative (missed)')}
    <div class="cm-v">normal</div>${cell(c.fp, 'fp', 'false positive (false alarm)')}${cell(c.tn, 'tn', 'true negative')}</div>
    <div class="cm-m"><span>precision <b>${fmt(m.prec, 2)}</b></span><span>recall <b>${fmt(m.rec, 2)}</b></span><span>F1 <b>${fmt(m.f1, 2)}</b></span><span>accuracy <b>${fmt((c.tp + c.tn) / tot, 3)}</b></span></div>`;
}
function renderCoverage(p, tEnd) {
  const en = enabled(p), th = thresholds(p);
  const out = [];
  const rows = DETS.map((d, di) => {
    const ev = evaluate(tEnd, ST.fl[di]); const m = metrics(ev); out.push({ d, f1: m.f1 });
    const cells = FTYPES.map((ft, ti) => {
      const es = ev.ev.filter(e => e.f.type === ft.k); if (!es.length) return '<td class="cv-na">–</td>';
      const hit = es.filter(e => e.det >= 0); const fr = hit.length / es.length;
      const dl = hit.length ? hit.map(e => e.delay).sort((a, b) => a - b)[Math.floor((hit.length - 1) / 2)] : NaN;
      return `<td style="--f:${fr}" class="cv"><b>${hit.length}/${es.length}</b>${hit.length ? `<small>${durTxt(dl)}</small>` : ''}</td>`;
    }).join('');
    return `<tr class="${en[di] ? '' : 'off'}"><th><i style="background:${d.col}"></i>${d.name}</th>${cells}<td class="num">${fmt(m.prec, 2)}</td><td class="num">${fmt(m.rec, 2)}</td><td class="num">${fmt(m.f1, 2)}</td></tr>`;
  });
  matEl.innerHTML = `<table class="cv-table"><thead><tr><th>Detector</th>${FTYPES.map(f => `<th>${f.k === 'dropout' ? 'drop&shy;out' : f.k}</th>`).join('')}<th>P</th><th>R</th><th>F1</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  return out;
}

/* ------------------------------------------------------------------ screen your own data */
const userEl = document.getElementById('user-data');
const userPlot = userEl ? new Plot('#chart-user', { x: { label: 'Sample number', unit: '' }, y: { label: 'Value', unit: '' } }) : null;
let userRes = null;
function exampleUserData() {
  // air temperature, day 2 06:00–18:00 every 2 min, generated by this laboratory's model, with a +4 °C spike and a 100-min flat line
  const tr = ST.W.truth[0], r = mulberry32(77), lines = ['time_min,air_temperature_C']; let frozen = null;
  for (let k = 1440 + 360, i = 0; k < 1440 + 1080; k += 2, i++) {
    let v = +(tr[k] + 0.05 * randn(r)).toFixed(2); if (i === 90) v = +(v + 4).toFixed(2);
    if (i >= 200 && i < 250) { if (frozen === null) frozen = v; v = frozen; }
    lines.push(`${k - 1440 - 360},${v}`);
  }
  return lines.join('\n');
}
function screenUser() {
  const msg = userEl.querySelector('.ud-msg'), get = k => parseFloat(userEl.querySelector(`[data-k="${k}"]`).value);
  const tb = parseTable(userEl.querySelector('textarea').value); const t = [], x = [];
  tb.rows.forEach(rw => { if (rw.length < 2) return; t.push(rw[0]); const v = typeof rw[1] === 'number' ? rw[1] : parseFloat(String(rw[1]).replace(',', '.')); x.push(isFinite(v) ? v : NaN); });
  if (x.length < 40) { msg.textContent = 'Please paste at least 40 rows with a time and a numeric value.'; return; }
  let sd = get('sd');
  if (!(sd > 0)) { const d = []; for (let i = 1; i < x.length; i++) if (x[i] === x[i] && x[i - 1] === x[i - 1]) d.push(x[i] - x[i - 1]); const md = medianOf(d, d.length); const mad = medianOf(d.map(v => Math.abs(v - md)), d.length); sd = Math.max(1.4826 * mad / Math.SQRT2, 1e-6); }
  const s = { sd, lo: get('lo'), hi: get('hi'), rate: get('rmax') > 0 ? get('rmax') : 10 * sd };
  const P = prefix(x, x.find(v => v === v) || 0), w = Math.min(60, Math.floor(x.length / 4));
  const sc = { range: scoreRange(x, s), rate: scoreRate(x, s), z: scoreZ(x, s, w, P), hampel: scoreHampel(x, s, 15), stuck: scoreStuck(x, s, 30, P), iforest: iforestScores(features(x, s, P), x.length, mulberry32(11), 100, 256, 0) };
  const th = { range: 0.5, rate: 1, z: 5, hampel: 6, stuck: 4, iforest: 0.74 };
  const flags = {}; Object.keys(sc).forEach(k => { flags[k] = Array.from(sc[k], v => v > th[k] ? 1 : 0); });
  userRes = { t, x, flags, sd };
  userPlot.clear();
  const idx = x.map((_, i) => i);
  userPlot.line('x', idx, x, { color: 'water', width: 1.4, label: 'your data' });
  const marks = { range: ['muted', 'square'], rate: ['amber', 'triangle'], z: ['water', 'circle'], hampel: ['magenta', 'diamond'], stuck: ['c5', 'square'], iforest: ['c4', 'circle'] };
  Object.keys(flags).forEach(k => { const xs = [], ys = []; flags[k].forEach((f, i) => { if (f && x[i] === x[i]) { xs.push(i); ys.push(x[i]); } }); if (xs.length) userPlot.scatter('f-' + k, xs, ys, { color: marks[k][0], shape: marks[k][1], r: 4, hollow: true, label: `${DETS[D_IDX[k]].short} (${xs.length})` }); });
  const any = x.map((_, i) => Object.keys(flags).some(k => flags[k][i])).filter(Boolean).length;
  msg.innerHTML = `${x.length} samples · noise σ ${get('sd') > 0 ? 'set to' : 'estimated as'} ${fmt(sd, 3)} (robust, from first differences) · <b>${any}</b> samples flagged by at least one detector (${fmt(100 * any / x.length, 1)} %). Rate threshold ${fmt(s.rate, 3)} per sample; z-score window ${w} samples; Hampel window 15; flat-line window 30.`;
}
if (userEl) {
  userEl.querySelector('[data-act="run"]').addEventListener('click', screenUser);
  userEl.querySelector('[data-act="csv"]').addEventListener('click', () => { if (!userRes) screenUser(); if (!userRes) return; const K = Object.keys(userRes.flags); downloadCSV('screened-sensor-data.csv', ['time', 'value', ...K.map(k => 'flag_' + k)], userRes.x.map((v, i) => [userRes.t[i], v, ...K.map(k => userRes.flags[k][i])])); });
}
function exportStream() {
  const rows = []; for (let k = 0; k < N; k++) rows.push([k, ...SENS.flatMap((s, j) => { const v = ST.D.meas[j][k]; return [v === v ? +v.toFixed(s.dig + 1) : '', ST.D.label[j][k], ST.E[j].e[k]]; })]);
  downloadCSV('sensor-anomaly-stream.csv', ['minute', ...SENS.flatMap(s => [`${s.k}_measured`, `${s.k}_fault_label`, `${s.k}_alarm`])], rows);
}

/* ------------------------------------------------------------------ update logic */
let lastEvalT = -1, lastEvalWall = 0;
function refreshEval(force) {
  const now = performance.now();
  if (!force && now - lastEvalWall < 220) return;
  lastEvalWall = now;
  const tEnd = clamp(Math.floor(tNow), WARM, N - 1); if (!force && tEnd === lastEvalT) return; lastEvalT = tEnd;
  const p = ui.values();
  const c = evaluate(tEnd); ST.lastEval = c; const m = metrics(c);
  renderConfusion(c, m);
  const st = (v, a, b) => !isFinite(v) ? null : v >= a ? 'ok' : v >= b ? 'warn' : 'bad';
  ro.set('prec', m.prec, st(m.prec, 0.8, 0.5), `${c.tp.toLocaleString('en-GB')} of ${(c.tp + c.fp).toLocaleString('en-GB')} alarmed samples were faulty`);
  ro.set('rec', m.rec, st(m.rec, 0.8, 0.5), `${c.tp.toLocaleString('en-GB')} of ${(c.tp + c.fn).toLocaleString('en-GB')} faulty samples flagged`);
  ro.set('f1', m.f1, st(m.f1, 0.75, 0.5), 'harmonic mean of precision and recall');
  const det = c.ev.filter(e => e.det >= 0); const ds = det.map(e => e.delay).sort((a, b) => a - b);
  ro.set('events', `${det.length} / ${c.ev.length}`, c.ev.length ? (det.length === c.ev.length ? 'ok' : det.length >= 0.7 * c.ev.length ? 'warn' : 'bad') : null, c.ev.length ? `${c.ev.length - det.length} missed so far` : 'no faults yet');
  const md = ds.length ? ds[Math.floor((ds.length - 1) / 2)] : NaN;
  ro.set('delay', md, !isFinite(md) ? null : md <= 5 ? 'ok' : md <= 60 ? 'warn' : 'bad', ds.length ? `fastest ${durTxt(ds[0])}, slowest ${durTxt(ds[ds.length - 1])}` : '&nbsp;');
  const fa = c.faEp / c.days; ro.set('fa', fa, fa <= 3 ? 'ok' : fa <= 15 ? 'warn' : 'bad', `${c.faEp} episodes in ${fmt(c.days, 2)} d (6 sensors)`);
  const f1s = renderCoverage(p, tEnd); const best = f1s.slice().sort((a, b) => b.f1 - a.f1)[0];
  ro.set('best', best && best.f1 > 0 ? best.d.short : '—', null, best && best.f1 > 0 ? `${best.d.name}: F1 = ${fmt(best.f1, 2)} alone` : '&nbsp;');
  ro.set('seen', `${fmt((tEnd - WARM + 1) / 60, 1)} h`, null, `up to ${hhmm(tEnd)} · ${(6 * (tEnd - WARM + 1)).toLocaleString('en-GB')} samples`);
  renderFaultList();
  scorePlot.vline('now', tNow / 60, { color: 'muted', label: 'now', dash: [2, 3] });
}
function dataChanged() {
  computeData(); ST.ver = (ST.ver || 0) + 1; ST.cache = null; ST.yr = null;
  scheduleHeavy();
  renderFaultList();
}
let heavyT = null;
function scheduleHeavy() {
  clearTimeout(heavyT);
  heavyT = setTimeout(() => {
    const p = ui.values(); computeWindowed(p); combine(p); ST.cache = null;
    prCurve(p); scoreChart(p); refreshEval(true); draw();
  }, 30);
}
ui.onChange((st, id) => {
  if (id === 'speed') { clock.speed = +st.speed; return; }
  if (['ftype', 'fsens', 'fmag', 'fdur'].includes(id)) { ui.enable('fmag', !['stuck', 'dropout'].includes(st.ftype)); ui.enable('fdur', st.ftype !== 'spike'); return; }
  if (id === 'truth') { draw(); return; }
  if (id === 'focus' || id === 'prDet') { scoreChart(st); prCurve(st); return; }
  scheduleHeavy();
});

/* ------------------------------------------------------------------ clock */
const clock = new SimClock({
  speed: 60,
  onStep: dt => { tNow = Math.min(N - 1, tNow + dt); if (tNow >= N - 1) clock.pause(); },
  onFrame: () => { refreshEval(false); draw(); }
});
clock.onState(run => { playBtn.innerHTML = run ? '❚❚ Pause' : '▶ Stream'; if (!LY || !LY.narrow) hud.set('s', run ? `<b>live</b> · ${ui.get('speed') / 60} h s⁻¹` : 'paused'); });
let pausedByScroll = false;
new IntersectionObserver(es => es.forEach(en => { if (!en.isIntersecting && clock.running) { clock.pause(); pausedByScroll = true; } else if (en.isIntersecting && pausedByScroll) { pausedByScroll = false; clock.play(); } })).observe(stageEl);

faults = defaultFaults();
computeData(); ST.ver = 1;
if (userEl) { userEl.querySelector('textarea').value = exampleUserData(); setTimeout(screenUser, 400); }
{ const p = ui.values(); computeWindowed(p); combine(p); prCurve(p); scoreChart(p); ui.enable('fmag', !['stuck', 'dropout'].includes(p.ftype)); }
clock.speed = +ui.get('speed');
refreshEval(true); draw();
hud.set('t', `Streaming · <b>${hhmm(Math.floor(tNow))}</b>`);
clock.play();
window.__an = { ST, faults: () => faults, evaluate, metrics, ui };
