/* ==========================================================================
   Sampling, noise and filtering — a virtual oscilloscope for greenhouse data.
   Model (Derive tab, Eqs. SP1–SP9):
   • truth T(t) = mean + diurnal cosine + climate-control oscillation
     + Ornstein–Uhlenbeck turbulence (+ optional heating boost), simulated
     every 5 s for 48 h;
   • measurement chain = first-order sensor lag → white noise + spikes →
     ADC quantisation → point sampling or block averaging every Δt;
   • causal filters: moving average, exponential smoothing, running median,
     1-D random-walk Kalman filter (optional innovation gate);
   • metrics: RMSE against the truth, 63 % step lag; Hann-windowed DFT.
   ========================================================================== */
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, downloadCSV } from '/assets/js/plot.js';
import { mulberry32, randn, parseTable } from '/assets/js/stats.js';

/* ------------------------------------------------------------------ constants */
const DT = 5;                          // s, fine simulation step of the "true" world
const DUR = 48 * 3600;                 // s, record length (two days)
const NF = DUR / DT + 1;               // fine points
const T_MEAN = 20;                     // °C
const T_PEAK = 14 * 3600;              // s, time of the diurnal maximum
const TAU_TURB = 60;                   // s, correlation time of turbulent fluctuations
const FSR = [-10, 50];                 // °C, ADC full-scale range
const BOOST = { t0: 28 * 3600, t1: 31 * 3600, dT: 1.5 };   // heating boost, day 2 04:00–07:00
const BURN = 3600;                     // s, metrics ignore the first hour (filter start-up)
const COL = { truth: 'rgba(226,236,230,0.62)', raw: '#ffd84d', ma: '#5cc8ef', ema: '#f07ad0', med: '#ff9f5a', kal: '#6fd39a', grid: 'rgba(120,255,180,0.09)', gridStrong: 'rgba(120,255,180,0.22)' };
const CHART = { truth: 'muted', raw: 'amber', ma: 'water', ema: 'magenta', med: 'c5', kal: 'accent' };
const NAMES = { ma: 'Moving average', ema: 'Exponential smoothing', med: 'Running median', kal: 'Kalman filter' };

const snapDt = v => Math.max(5, Math.round(v / 5) * 5);
function fmtDur(s) {
  if (!isFinite(s)) return '—';
  if (s < 60) return `${+s.toFixed(s < 10 ? 1 : 0)} s`;
  if (s < 3600) { const m = s / 60; return `${+m.toFixed(m < 10 ? 1 : 0)} min`; }
  const h = s / 3600; return `${+h.toFixed(h < 10 ? 2 : 1)} h`;
}
const clock24 = t => { const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60); return { d: d + 1, s: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` }; };

/* ------------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'fs', label: 'Sampling frequency f<sub>s</sub> = 1/Δt', unit: 'h⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'fn', label: 'Nyquist frequency f<sub>N</sub> = f<sub>s</sub>/2', unit: 'h⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'alias', label: 'Period of the oscillation seen in the log', unit: '', format: v => v, note: '&nbsp;' })
  .add({ id: 'q', label: 'ADC step q', unit: '°C', digits: 4, note: '&nbsp;' })
  .add({ id: 'raw', label: 'Raw samples: RMSE vs truth', unit: '°C', digits: 3, note: '&nbsp;' })
  .add({ id: 'ma', label: 'Moving average: RMSE vs truth', unit: '°C', digits: 3, note: '&nbsp;' })
  .add({ id: 'ema', label: 'Exponential smoothing: RMSE vs truth', unit: '°C', digits: 3, note: '&nbsp;' })
  .add({ id: 'med', label: 'Running median: RMSE vs truth', unit: '°C', digits: 3, note: '&nbsp;' })
  .add({ id: 'kal', label: 'Kalman filter: RMSE vs truth', unit: '°C', digits: 3, note: '&nbsp;' })
  .add({ id: 'kinf', label: 'Kalman steady-state gain K<sub>∞</sub>', unit: '', digits: 3, note: '&nbsp;' });

ui.section('Greenhouse air temperature (the truth)');
ui.slider({ id: 'Ad', label: 'Diurnal amplitude', min: 0, max: 8, step: 0.1, value: 4, unit: '°C', help: 'Half the day–night swing around 20 °C; maximum at 14:00' });
ui.slider({ id: 'Pv', label: 'Climate-control oscillation period', min: 2, max: 60, step: 0.5, value: 12, unit: 'min', help: 'Vents or heating cycling around a set point (a limit cycle)' });
ui.slider({ id: 'Av', label: 'Oscillation amplitude', min: 0, max: 2, step: 0.05, value: 0.4, unit: '°C' });
ui.slider({ id: 'turb', label: 'Turbulent fluctuations σ<sub>u</sub>', min: 0, max: 0.5, step: 0.01, value: 0.05, unit: '°C', help: 'Real eddies at the sensor, correlation time 60 s' });
ui.toggle({ id: 'boost', label: 'Heating boost, day 2 04:00–07:00 (+1.5 °C)', value: true });
ui.section('Sensor, ADC and logger');
ui.slider({ id: 'dt', label: 'Logging interval Δt', min: 5, max: 3600, log: true, value: 30, format: v => fmtDur(snapDt(v)), help: 'Snapped to multiples of the 5-s reading interval' });
ui.segmented({ id: 'mode', label: 'Acquisition', options: [{ value: 'point', label: 'One reading per Δt' }, { value: 'block', label: 'Mean of 5-s readings' }], value: 'point', help: 'Block averaging = oversampling + averaging: a digital anti-aliasing filter' });
ui.slider({ id: 'tau', label: 'Sensor time constant τ<sub>s</sub>', min: 0, max: 600, step: 5, value: 20, unit: 's', help: 'Aspirated thermistor ≈ 10–30 s; still air in a shield: minutes' });
ui.slider({ id: 'noise', label: 'White noise σ<sub>v</sub>', min: 0, max: 0.5, step: 0.01, value: 0.25, unit: '°C' });
ui.slider({ id: 'pspike', label: 'Spike probability', min: 0, max: 5, step: 0.1, value: 0.3, unit: '% of readings' });
ui.slider({ id: 'aspike', label: 'Spike size', min: 0.5, max: 10, step: 0.5, value: 4, unit: '°C' });
ui.slider({ id: 'bits', label: 'ADC resolution', min: 6, max: 16, step: 1, value: 12, unit: 'bit', help: 'Full scale −10 … +50 °C' });
ui.section('Filters (causal: past samples only)');
ui.slider({ id: 'maN', label: 'Moving-average window N', min: 1, max: 60, step: 1, value: 3, unit: 'samples' });
ui.slider({ id: 'alpha', label: 'Smoothing factor α', min: 0.01, max: 1, step: 0.01, value: 0.4 });
ui.slider({ id: 'medN', label: 'Median window N', min: 1, max: 31, step: 2, value: 3, unit: 'samples' });
ui.slider({ id: 'sq', label: 'Kalman √Q (true change per sample)', min: 0.001, max: 2, log: true, value: 0.2, unit: '°C' });
ui.toggle({ id: 'autoR', label: 'Kalman R from the sensor specification', value: true, help: 'R = σ<sub>v</sub>² + q²/12 (white noise + quantisation)' });
ui.slider({ id: 'sr', label: 'Kalman √R (manual)', min: 0.01, max: 2, log: true, value: 0.15, unit: '°C' });
ui.toggle({ id: 'gate', label: 'Kalman: reject innovations beyond 3σ', value: false, help: 'Ignores measurements that disagree wildly with the prediction' });
ui.section('Oscilloscope and spectrum');
ui.segmented({ id: 'show', label: 'Filtered traces', options: [{ value: 'all', label: 'All' }, { value: 'ma', label: 'MA' }, { value: 'ema', label: 'EMA' }, { value: 'med', label: 'Median' }, { value: 'kal', label: 'Kalman' }, { value: 'none', label: 'None' }], value: 'all' });
const TDIVS = [60, 300, 600, 1800, 3600, 10800, 17280];
ui.select({ id: 'tdiv', label: 'Time base', options: TDIVS.map(v => ({ value: String(v), label: v === 17280 ? '4.8 h/div (whole record)' : `${fmtDur(v)}/div` })), value: '600' });
ui.toggle({ id: 'join', label: 'Join samples like a dashboard does', value: true });
ui.segmented({ id: 'spec', label: 'Spectrum of', options: [{ value: 'raw', label: 'Raw samples' }, { value: 'ma', label: 'MA' }, { value: 'ema', label: 'EMA' }, { value: 'med', label: 'Median' }, { value: 'kal', label: 'Kalman' }], value: 'raw' });
ui.toggle({ id: 'hann', label: 'Hann window (reduces leakage)', value: true });
ui.segmented({ id: 'speed', label: 'Playback', options: [{ value: 60, label: '1 min/s' }, { value: 600, label: '10 min/s' }, { value: 3600, label: '1 h/s' }], value: 600, persist: false });
const [playBtn] = ui.buttons([
  { label: '❚❚ Pause', variant: 'primary', onClick: () => clock.toggle() },
  { label: 'New noise realisation', onClick: () => { seed++; recompute(); } }
]);
ui.button({ label: 'Download samples and filters (CSV)', onClick: () => exportCSV() });
ui.presets([
  { label: 'Good logger practice', values: { dt: 30, mode: 'point', tau: 20, noise: 0.1, pspike: 0.3, aspike: 4, bits: 12, maN: 4, alpha: 0.35, medN: 5, sq: 0.15, autoR: true, gate: true, Pv: 12, Av: 0.6, tdiv: '600', show: 'all' } },
  { label: 'Aliasing trap (10-min log, 12-min cycle)', values: { dt: 600, mode: 'point', tau: 20, noise: 0.05, pspike: 0, bits: 12, Pv: 12, Av: 0.8, tdiv: '1800', show: 'none', spec: 'raw' } },
  { label: 'Oversample and average', values: { dt: 600, mode: 'block', tau: 20, noise: 0.05, pspike: 0, bits: 12, Pv: 12, Av: 0.8, tdiv: '1800', show: 'none', spec: 'raw' } },
  { label: 'Spiky radio interference', values: { dt: 60, mode: 'point', noise: 0.08, pspike: 3, aspike: 6, maN: 8, alpha: 0.2, medN: 7, gate: false, tdiv: '600', show: 'all' } },
  { label: 'Cheap 8-bit ADC', values: { dt: 60, mode: 'point', noise: 0, pspike: 0, bits: 8, Av: 0.3, turb: 0.05, tdiv: '1800', show: 'ema', alpha: 0.2 } }
]);
ui.saveButton('signal-processing', () => ro.values());

let seed = 1;
let userData = null;                   // { t:[s], z:[°C], name } when the student pastes data

/* ------------------------------------------------------------------ model: truth */
function makeTruth(p) {
  const T = new Float64Array(NF);
  const rng = mulberry32(9001 + seed * 97);
  const a = Math.exp(-DT / TAU_TURB), b = p.turb * Math.sqrt(1 - a * a);
  let u = p.turb * randn(rng);
  const wD = 2 * Math.PI / 86400, wV = 2 * Math.PI / (p.Pv * 60);
  for (let i = 0; i < NF; i++) {
    const t = i * DT;
    u = a * u + b * randn(rng);
    const boost = p.boost && t >= BOOST.t0 && t < BOOST.t1 ? BOOST.dT : 0;
    T[i] = T_MEAN + p.Ad * Math.cos(wD * (t - T_PEAK)) + p.Av * Math.sin(wV * t) + u + boost;
  }
  return T;
}
/** First-order sensor (Eq. SP2): exact update for an input held over each 5-s step. */
function sensorLag(T, tau) {
  if (tau <= 0) return T;
  const S = new Float64Array(NF); const g = 1 - Math.exp(-DT / tau);
  S[0] = T[0];
  for (let i = 1; i < NF; i++) S[i] = S[i - 1] + g * (T[i] - S[i - 1]);
  return S;
}
/** Readings, quantisation and sampling (Eqs. SP2–SP3). */
function sampleSeries(p, Tsens, Ttrue) {
  const m = snapDt(p.dt) / DT;
  const n = Math.floor((NF - 1) / m) + 1;
  const rng = mulberry32(4242 + seed * 131);
  const q = (FSR[1] - FSR[0]) / Math.pow(2, p.bits), codes = Math.pow(2, p.bits) - 1;
  const ps = p.pspike / 100;
  const read = v => {
    let x = v + p.noise * randn(rng), sp = 0;
    if (rng() < ps) { sp = (rng() < 0.5 ? -1 : 1) * p.aspike * (0.6 + 0.4 * rng()); x += sp; }
    const c = Math.max(0, Math.min(codes, Math.round((x - FSR[0]) / q)));
    return [FSR[0] + c * q, sp];
  };
  const t = new Float64Array(n), z = new Float64Array(n), truth = new Float64Array(n), spike = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const idx = k * m; t[k] = idx * DT; truth[k] = Ttrue[idx];
    if (p.mode === 'block' && m > 1) {
      let s = 0, c = 0, anySp = 0;
      for (let j = Math.max(0, idx - m + 1); j <= idx; j++) { const r = read(Tsens[j]); s += r[0]; c++; if (r[1]) anySp = 1; }
      z[k] = s / c; spike[k] = anySp;
    } else { const r = read(Tsens[idx]); z[k] = r[0]; spike[k] = r[1] ? 1 : 0; }
  }
  return { t, z, truth, spike, q, n, m };
}

/* ------------------------------------------------------------------ filters (Eqs. SP5–SP7) */
function filtMA(x, N) {
  const n = x.length, y = new Float64Array(n); let s = 0;
  for (let k = 0; k < n; k++) { s += x[k]; if (k >= N) s -= x[k - N]; y[k] = s / Math.min(k + 1, N); }
  return y;
}
function filtEMA(x, a) {
  const n = x.length, y = new Float64Array(n); let s = x[0];
  for (let k = 0; k < n; k++) { s = a * x[k] + (1 - a) * s; y[k] = s; }
  return y;
}
function filtMedian(x, N) {
  const n = x.length, y = new Float64Array(n); const w = new Float64Array(N); let L = 0;
  const lower = v => { let lo = 0, hi = L; while (lo < hi) { const md = (lo + hi) >> 1; if (w[md] < v) lo = md + 1; else hi = md; } return lo; };
  for (let k = 0; k < n; k++) {
    if (k >= N) { const i = lower(x[k - N]); for (let j = i; j < L - 1; j++) w[j] = w[j + 1]; L--; }
    const i = lower(x[k]); for (let j = L; j > i; j--) w[j] = w[j - 1]; w[i] = x[k]; L++;
    y[k] = L % 2 ? w[(L - 1) >> 1] : 0.5 * (w[L / 2 - 1] + w[L / 2]);
  }
  return y;
}
function kalmanSteady(Q, R) { const Pm = 0.5 * (Q + Math.sqrt(Q * Q + 4 * Q * R)); return { Pm, K: Pm / (Pm + R), P: R * Pm / (Pm + R) }; }
function filtKalman(x, Q, R, gate, x0 = T_MEAN, P0 = 1) {
  const n = x.length, y = new Float64Array(n), P = new Float64Array(n), K = new Float64Array(n); const rej = new Uint8Array(n);
  let xh = x0, Pk = P0, nrej = 0;
  for (let k = 0; k < n; k++) {
    const Pm = Pk + Q, S = Pm + R, inn = x[k] - xh;
    if (gate && k > 10 && Math.abs(inn) > 3 * Math.sqrt(S)) { Pk = Pm; K[k] = 0; rej[k] = 1; nrej++; }
    else { const g = Pm / S; xh += g * inn; Pk = (1 - g) * Pm; K[k] = g; }
    y[k] = xh; P[k] = Pk;
  }
  return { y, P, K, rej, nrej };
}
/** Filter-only lag: time until the output covers 63.2 % of a unit step (Eq. SP9). */
function stepLag(kind, par, dt) {
  const pre = 5, N = 400 + (kind === 'ma' || kind === 'med' ? 2 * par : 0);
  const x = new Float64Array(pre + N); for (let k = pre; k < x.length; k++) x[k] = 1;
  let y;
  if (kind === 'ma') y = filtMA(x, par);
  else if (kind === 'ema') y = filtEMA(x, par);
  else if (kind === 'med') y = filtMedian(x, par);
  else { const st = kalmanSteady(par.Q, par.R); y = filtKalman(x, par.Q, par.R, false, 0, st.P).y; }
  for (let k = pre; k < y.length; k++) if (y[k] >= 1 - Math.exp(-1) - 1e-12) return (k - pre) * dt;
  return NaN;
}
function rmse(y, truth, k0) { let s = 0, c = 0; for (let k = k0; k < y.length; k++) { const d = y[k] - truth[k]; s += d * d; c++; } return c ? Math.sqrt(s / c) : NaN; }

/* ------------------------------------------------------------------ DFT (Eq. SP8) */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const h = len >> 1, ang = -2 * Math.PI / len;
    for (let j = 0; j < h; j++) {
      const wr = Math.cos(ang * j), wi = Math.sin(ang * j);
      for (let i = j; i < n; i += len) { const a = i + h; const br = re[a] * wr - im[a] * wi, bi = re[a] * wi + im[a] * wr; re[a] = re[i] - br; im[a] = im[i] - bi; re[i] += br; im[i] += bi; }
    }
  }
}
/** Single-sided amplitude spectrum in °C versus frequency in h⁻¹, peak-preserving log decimation. */
function spectrum(x, dtSec, hann, fmin, fmax, bins = 520) {
  const n = x.length; let N = 1; while (N < n) N <<= 1;
  const re = new Float64Array(N), im = new Float64Array(N);
  let mean = 0; for (let k = 0; k < n; k++) mean += x[k]; mean /= n;
  let sw = 0;
  for (let k = 0; k < n; k++) { const w = hann ? 0.5 * (1 - Math.cos(2 * Math.PI * k / (n - 1))) : 1; re[k] = (x[k] - mean) * w; sw += w; }
  fft(re, im);
  const df = 3600 / (N * dtSec);                        // h⁻¹ per bin
  const lo = Math.log10(fmin), hi = Math.log10(fmax); const best = new Float64Array(bins).fill(-1), bf = new Float64Array(bins);
  for (let j = 1; j <= N / 2; j++) {
    const f = j * df; if (f < fmin || f > fmax) continue;
    const a = 2 * Math.hypot(re[j], im[j]) / sw; const b = Math.min(bins - 1, Math.floor((Math.log10(f) - lo) / (hi - lo) * bins));
    if (a > best[b]) { best[b] = a; bf[b] = f; }
  }
  const F = [], A = [];
  for (let b = 0; b < bins; b++) if (best[b] >= 0) { F.push(bf[b]); A.push(Math.max(1e-6, best[b])); }
  return { f: F, a: A, df };
}

/* ------------------------------------------------------------------ state + computation */
const S = { key: {} };
function params() { const v = ui.values(); v.dtS = userData ? userData.dt : snapDt(v.dt); v.tdiv = +v.tdiv; v.speed = +v.speed; return v; }
function computeAll() {
  const p = params();
  if (userData) {
    const u = userData;
    Object.assign(S, { t: u.t, z: u.z, truth: null, spike: new Uint8Array(u.z.length), q: NaN, n: u.z.length, m: 1, T: null, user: true });
    S.key = {};
  } else {
    S.user = false;
    const kT = [p.Ad, p.Pv, p.Av, p.turb, p.boost, seed].join('|');
    if (kT !== S.key.T) { S.T = makeTruth(p); S.key.T = kT; S.specTrue = null; S.overview = null; S.key.Ts = null; }
    const kS = kT + '|' + p.tau;
    if (kS !== S.key.Ts) { S.Ts = sensorLag(S.T, p.tau); S.key.Ts = kS; S.key.samp = null; }
    const kP = kS + '|' + [p.dtS, p.mode, p.noise, p.pspike, p.aspike, p.bits].join('|');
    if (kP !== S.key.samp) { Object.assign(S, sampleSeries(p, S.Ts, S.T)); S.key.samp = kP; }
  }
  const x = S.z;
  S.R = p.autoR ? Math.max(1e-6, (S.user ? 0.1 * 0.1 : p.noise * p.noise + S.q * S.q / 12)) : p.sr * p.sr;
  S.Q = p.sq * p.sq;
  S.f = { ma: filtMA(x, p.maN), ema: filtEMA(x, p.alpha), med: filtMedian(x, p.medN) };
  const kf = filtKalman(x, S.Q, S.R, p.gate); S.f.kal = kf.y; S.kalP = kf.P; S.kalRej = kf.rej; S.nrej = kf.nrej;
  S.steady = kalmanSteady(S.Q, S.R);
  S.lag = { ma: stepLag('ma', p.maN, p.dtS), ema: stepLag('ema', p.alpha, p.dtS), med: stepLag('med', p.medN, p.dtS), kal: stepLag('kal', { Q: S.Q, R: S.R }, p.dtS) };
  const k0 = Math.min(S.n - 1, Math.ceil(BURN / p.dtS));
  S.k0 = k0;
  if (!S.user) {
    S.rmse = { raw: rmse(x, S.truth, k0) };
    for (const f of ['ma', 'ema', 'med', 'kal']) S.rmse[f] = rmse(S.f[f], S.truth, k0);
  } else S.rmse = null;
  return p;
}

/* ------------------------------------------------------------------ readouts */
function aliasInfo(p) {
  const fs = 3600 / p.dtS, fN = fs / 2, fv = 60 / p.Pv;
  const fa = Math.abs(fv - fs * Math.round(fv / fs));
  return { fs, fN, fv, fa, aliased: fv > fN * (1 + 1e-9) };
}
function updateReadouts(p) {
  const A = aliasInfo(p);
  ro.set('fs', A.fs, null, `Δt = ${fmtDur(p.dtS)}`);
  const fNnote = S.user ? 'your data' : `oscillation: ${fmt(A.fv, 1)} h⁻¹ (${fmtDur(p.Pv * 60)})`;
  ro.set('fn', A.fN, S.user ? null : (A.aliased ? 'bad' : A.fN < 2.5 * A.fv ? 'warn' : 'ok'), fNnote);
  if (S.user) ro.set('alias', '—', null, 'no known truth for pasted data');
  else if (!A.aliased) ro.set('alias', fmtDur(p.Pv * 60), A.fN < 2.5 * A.fv ? 'warn' : 'ok', A.fN < 2.5 * A.fv ? `true period, but only ${fmt(A.fs / A.fv, 1)} samples per cycle` : `true period — ${fmt(A.fs / A.fv, 1)} samples per cycle`);
  else ro.set('alias', A.fa < 1e-9 ? 'flat line' : fmtDur(3600 / A.fa), 'bad', `aliased: f<sub>a</sub> = ${fmt(A.fa, 2)} h⁻¹ instead of ${fmt(A.fv, 2)} h⁻¹`);
  if (S.user) ro.set('q', NaN, null, 'unknown for pasted data');
  else ro.set('q', S.q, S.q > 0.1 ? 'bad' : S.q > 0.03 ? 'warn' : 'ok', `${p.bits} bit · σ<sub>q</sub> = q/√12 = ${fmt(S.q / Math.sqrt(12), 4)} °C`);
  if (S.user) ro.set('raw', NaN, null, 'needs a known truth');
  else ro.set('raw', S.rmse.raw, null, `white noise alone would give ${fmt(Math.sqrt(p.noise * p.noise + S.q * S.q / 12), 3)} °C`);
  let best = null;
  if (!S.user) for (const f of ['ma', 'ema', 'med', 'kal']) if (!best || S.rmse[f] < S.rmse[best]) best = f;
  const parTxt = { ma: `N = ${p.maN}`, ema: `α = ${fmt(p.alpha, 2)}`, med: `N = ${p.medN}`, kal: `√Q = ${fmt(p.sq, 3)} · √R = ${fmt(Math.sqrt(S.R), 3)} °C` };
  for (const f of ['ma', 'ema', 'med', 'kal']) {
    const st = S.user ? null : f === best ? 'ok' : S.rmse[f] > S.rmse.raw ? 'bad' : null;
    ro.set(f, S.user ? NaN : S.rmse[f], st, `lag ${fmtDur(S.lag[f])} · ` + parTxt[f] + (f === best ? ' · <b>lowest RMSE</b>' : '') + (f === 'kal' && p.gate ? ` · ${S.nrej} rejected` : ''));
  }
  ro.set('kinf', S.steady.K, null, `≈ EMA with α = K<sub>∞</sub>; steady uncertainty ${fmt(Math.sqrt(S.steady.P), 3)} °C`);
  if (W >= 600) hud.set('fs', `f<sub>s</sub> <b>${fmt(A.fs, 1)}</b> h⁻¹ · f<sub>N</sub> <b>${fmt(A.fN, 1)}</b> h⁻¹`); else hud.remove('fs');
  if (!S.user && A.aliased) hud.set('warn', W < 600 ? '<span style="color:#ff8f6b">ALIASING</span>' : `<span style="color:#ff8f6b">ALIASING</span> ${fmtDur(p.Pv * 60)} cycle → ${A.fa < 1e-9 ? 'flat line' : fmtDur(3600 / A.fa)}`);
  else hud.remove('warn');
}

/* ------------------------------------------------------------------ charts */
const logFmt = v => { const e = Math.round(Math.log10(v)); return e >= -3 && e <= 3 ? String(+v.toPrecision(1)) : `1e${e}`; };
const specPlot = new Plot('#chart-spectrum', { x: { label: 'Frequency', unit: 'h⁻¹', log: true, min: 0.02, max: 400, format: logFmt }, y: { label: 'Amplitude', unit: '°C', log: true, min: 1e-4, max: 10, format: logFmt } });
const tradePlot = new Plot('#chart-trade', { x: { label: 'Step lag (63 %)', unit: 'min', min: 0 }, y: { label: 'RMSE vs truth', unit: '°C', min: 0 } });
const kalPlot = new Plot('#chart-kalman', { x: { label: 'Sample number k', unit: '', min: 0, max: 30 }, y: { label: 'Kalman gain K', unit: '', min: 0, max: 1 }, y2: { label: 'Uncertainty √P', unit: '°C', min: 0 } });
const respPlot = new Plot('#chart-response', { x: { label: 'Frequency', unit: 'h⁻¹', min: 0 }, y: { label: 'Amplitude gain |H(f)|', unit: '', min: 0, max: 1.05 } });

function updateSpectrum(p) {
  const A = aliasInfo(p);
  const fmin = S.user ? 3600 / (S.n * p.dtS) * 0.9 : 0.02;
  const fmax = S.user ? A.fN * 1.02 : Math.min(360, Math.max(A.fN * 3, A.fv * 3, 1));
  specPlot.setAxis('x', { min: fmin, max: fmax });
  if (!S.user) {
    if (!S.specTrue) S.specTrue = spectrum(S.T, DT, true, 0.02, 360, 700);
    specPlot.line('true', S.specTrue.f, S.specTrue.a, { color: 'muted', width: 1.4, label: 'True temperature (5-s truth)' });
  } else specPlot.remove('true');
  const which = p.spec;
  const x = which === 'raw' ? S.z : S.f[which];
  const sp = spectrum(x, p.dtS, p.hann, fmin, A.fN, 520);
  specPlot.line('meas', sp.f, sp.a, { color: which === 'raw' ? CHART.raw : CHART[which], width: 2, label: which === 'raw' ? 'Logged samples' : NAMES[which] + ' output' });
  specPlot.region('beyond', A.fN, Math.max(fmax, A.fN * 1.0001), { color: 'danger', alpha: 0.07, label: '' });
  specPlot.vline('fn', A.fN, { color: 'magenta', label: 'Nyquist', dash: [6, 4] });
  if (!S.user && p.Av > 0) specPlot.vline('fv', A.fv, { color: 'muted', label: 'true cycle', dash: [2, 3] }); else specPlot.remove('fv');
  if (!S.user && A.aliased && A.fa > fmin) specPlot.vline('fa', A.fa, { color: 'danger', label: 'alias', dash: [6, 3] }); else specPlot.remove('fa');
  document.getElementById('spec-note').innerHTML = S.user
    ? `Frequency resolution Δf = 1/(N Δt) = ${fmt(sp.df, 3)} h⁻¹ (after zero-padding). Peaks are periodic components of your data.`
    : `Resolution Δf = ${fmt(1 / 48, 3)} h⁻¹ (48-h record). The shaded band above f<sub>N</sub> cannot be represented by the samples: anything there folds back${A.aliased ? ` — the ${fmtDur(p.Pv * 60)} cycle reappears at <b>${fmt(A.fa, 2)} h⁻¹</b>` : ''}.`;
}
function updateKalmanChart() {
  const k = [], K = [], sP = [];
  let P = 1; for (let i = 0; i <= 30; i++) { const Pm = P + S.Q; const g = Pm / (Pm + S.R); P = (1 - g) * Pm; k.push(i + 1); K.push(g); sP.push(Math.sqrt(P)); }
  kalPlot.line('K', k, K, { color: 'accent', width: 2.4, label: 'Gain Kₖ (cold start, P₀ = 1 °C²)' });
  kalPlot.line('sP', k, sP, { color: 'water', width: 2, dash: [6, 4], label: 'Uncertainty √Pₖ', y2: true });
  kalPlot.hline('Kinf', S.steady.K, { color: 'magenta', label: `K∞ = ${fmt(S.steady.K, 3)}` });
}
function updateResponse(p) {
  const A = aliasInfo(p); const fN = A.fN; const n = 300; const f = [], ma = [], ema = [], kal = [];
  const dth = p.dtS / 3600, N = p.maN, a = p.alpha, K = S.steady.K;
  const emaGain = (al, w) => al / Math.hypot(1 - (1 - al) * Math.cos(w), (1 - al) * Math.sin(w));
  for (let i = 0; i <= n; i++) {
    const fi = fN * i / n, w = 2 * Math.PI * fi * dth; f.push(fi);
    ma.push(i === 0 ? 1 : Math.abs(Math.sin(N * w / 2) / (N * Math.sin(w / 2))));
    ema.push(emaGain(a, w)); kal.push(emaGain(K, w));
  }
  respPlot.setAxis('x', { min: 0, max: fN });
  respPlot.line('ma', f, ma, { color: CHART.ma, width: 2.2, label: `Moving average (N = ${N})` });
  respPlot.line('ema', f, ema, { color: CHART.ema, width: 2.2, label: `EMA (α = ${fmt(a, 2)})` });
  respPlot.line('kal', f, kal, { color: CHART.kal, width: 2, dash: [6, 4], label: `Kalman, steady state (K∞ = ${fmt(K, 2)})` });
  if (!S.user && A.fv <= fN) respPlot.vline('fv', A.fv, { color: 'muted', label: 'cycle', dash: [2, 3] }); else respPlot.remove('fv');
  respPlot.hline('half', Math.SQRT1_2, { color: 'muted', label: '−3 dB', dash: [3, 4] });
}
let sweepTimer = null;
function scheduleSweep(p) {
  clearTimeout(sweepTimer);
  sweepTimer = setTimeout(() => {
    if (S.user) {
      tradePlot.clear();
      tradePlot.custom('msg', (ctx, pl, P) => { const r = pl.plotRect; ctx.fillStyle = P.muted; ctx.font = '500 13px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('The RMSE needs a known truth — switch back to the synthetic greenhouse.', r.left + r.width / 2, r.top + r.height / 2); });
      return;
    }
    tradePlot.remove('msg');
    const x = S.z, tr = S.truth, k0 = S.k0, dt = p.dtS;
    const fam = {
      ma: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60].map(N => [stepLag('ma', N, dt), rmse(filtMA(x, N), tr, k0)]),
      ema: [1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1, 0.07, 0.05, 0.035, 0.025, 0.018, 0.012].map(a => [stepLag('ema', a, dt), rmse(filtEMA(x, a), tr, k0)]),
      med: [1, 3, 5, 7, 9, 11, 13, 15, 19, 23, 27, 31].map(N => [stepLag('med', N, dt), rmse(filtMedian(x, N), tr, k0)]),
      kal: [3, 2, 1.4, 1, 0.7, 0.5, 0.35, 0.25, 0.18, 0.12, 0.08, 0.05, 0.035, 0.025, 0.015, 0.01, 0.006, 0.004].map(s => [stepLag('kal', { Q: s * s, R: S.R }, dt), rmse(filtKalman(x, s * s, S.R, p.gate).y, tr, k0)])
    };
    let xmax = 0;
    for (const f of ['ma', 'ema', 'med', 'kal']) xmax = Math.max(xmax, S.lag[f] / 60);
    const xm = Math.max(5, 12 * dt / 60, xmax * 1.5);
    for (const f of ['ma', 'ema', 'med', 'kal']) {
      const pts = fam[f].filter(q => isFinite(q[0]) && isFinite(q[1]) && q[0] / 60 <= xm * 1.001).map(q => [q[0] / 60, q[1]]);
      tradePlot.line(f, pts, { color: CHART[f], width: 1.8, label: NAMES[f], opacity: 0.85 });
      tradePlot.scatter('s-' + f, pts.map(q => q[0]), pts.map(q => q[1]), { color: CHART[f], r: 2.6, noTip: true });
      tradePlot.point('p-' + f, S.lag[f] / 60, S.rmse[f], { color: CHART[f], r: 6 });
    }
    tradePlot.hline('raw', S.rmse.raw, { color: CHART.raw, label: `raw samples ${fmt(S.rmse.raw, 3)} °C`, dash: [5, 4], includeInDomain: true });
    tradePlot.setAxis('x', { min: 0, max: xm });
  }, 160);
}

/* ------------------------------------------------------------------ oscilloscope stage */
const stageEl = document.getElementById('stage');
const cv = document.createElement('canvas'); stageEl.appendChild(cv);
const ctx = cv.getContext('2d');
const hud = hudChips(stageEl); hud.el.style.flexDirection = 'row'; hud.el.style.flexWrap = 'wrap'; hud.el.style.maxWidth = '70%';
stageToolbar(stageEl, {
  onReset: () => { tNow = 10 * 3600; ui.set('tdiv', '600'); },
  onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'sampling-oscilloscope.png'; a.click(); }
});
let W = 0, H = 0, DPR = 1, L = null;
function layout() {
  const side = W >= 760 ? 212 : 0;
  const top = 50, bottom = 62;
  const sx = 16, sy = top, sw = W - sx - 16 - side - (side ? 12 : 0), sh = H - top - bottom - 22;
  return { side, sx, sy, sw, sh, px: sx + sw + 12, ov: { x: sx, y: H - bottom + 10, w: sw, h: bottom - 22 } };
}
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1); W = stageEl.clientWidth; H = stageEl.clientHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cv.style.width = W + 'px'; cv.style.height = H + 'px';
  L = layout(); S.overview = null; draw();
}
new ResizeObserver(resize).observe(stageEl);

let tNow = 10 * 3600;                   // simulated time at the right edge of the screen
let vCenter = 20, vDiv = 1;             // smoothed vertical scale
const VDIVS = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
function spanNow(p) { return p.tdiv * 10; }
function tEnd() { return S.user ? S.t[S.n - 1] : DUR; }
function tStart() { return S.user ? S.t[0] : 0; }

function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

function draw() {
  if (!W || !L || !S.z) return;
  const p = params();
  const c = ctx; c.setTransform(DPR, 0, 0, DPR, 0, 0);
  // bezel
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0f1a16'); g.addColorStop(1, '#070d0b');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const { sx, sy, sw, sh } = L;
  // screen
  roundRect(c, sx - 6, sy - 6, sw + 12, sh + 12, 12); c.fillStyle = '#030806'; c.fill();
  const sg = c.createRadialGradient(sx + sw / 2, sy + sh / 2, 10, sx + sw / 2, sy + sh / 2, Math.max(sw, sh) * 0.7);
  sg.addColorStop(0, '#0a1a12'); sg.addColorStop(1, '#040a07');
  c.fillStyle = sg; c.fillRect(sx, sy, sw, sh);
  // time window
  const span = spanNow(p);
  const t1 = tNow, t0 = t1 - span;
  const X = t => sx + (t - t0) / span * sw;
  // vertical auto-scale from the truth / samples in the window
  let lo = Infinity, hi = -Infinity;
  const kA = Math.max(0, Math.floor((t0 - tStart()) / p.dtS)), kB = Math.min(S.n - 1, Math.ceil((t1 - tStart()) / p.dtS));
  if (!S.user) { const i0 = Math.max(0, Math.floor(t0 / DT)), i1 = Math.min(NF - 1, Math.ceil(t1 / DT)); const st = Math.max(1, Math.floor((i1 - i0) / 800)); for (let i = i0; i <= i1; i += st) { lo = Math.min(lo, S.T[i]); hi = Math.max(hi, S.T[i]); } }
  else for (let k = kA; k <= kB; k++) { const v = S.f.med[k]; if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  if (!isFinite(lo)) { lo = 19; hi = 21; }
  const need = (hi - lo) / 6.2; const targetDiv = VDIVS.find(v => v >= need) || 10; const targetC = (hi + lo) / 2;
  vDiv += (targetDiv - vDiv) * 0.25; vCenter += (targetC - vCenter) * 0.25;
  if (Math.abs(vDiv - targetDiv) < 1e-3) vDiv = targetDiv;
  if (!clock.running && (Math.abs(vDiv - targetDiv) > 1e-3 || Math.abs(vCenter - targetC) > 1e-3 * vDiv)) requestAnimationFrame(draw);
  const Y = v => sy + sh / 2 - (v - vCenter) / vDiv * (sh / 8);
  // graticule
  c.save(); c.beginPath(); c.rect(sx, sy, sw, sh); c.clip();
  c.lineWidth = 1; c.strokeStyle = COL.grid; c.beginPath();
  for (let i = 1; i < 10; i++) { const x = Math.round(sx + i * sw / 10) + 0.5; c.moveTo(x, sy); c.lineTo(x, sy + sh); }
  for (let j = 1; j < 8; j++) { const y = Math.round(sy + j * sh / 8) + 0.5; c.moveTo(sx, y); c.lineTo(sx + sw, y); }
  c.stroke();
  c.strokeStyle = COL.gridStrong; c.beginPath();
  const xc = Math.round(sx + sw / 2) + 0.5, yc = Math.round(sy + sh / 2) + 0.5;
  for (let i = 0; i <= 50; i++) { const x = sx + i * sw / 50; c.moveTo(x, yc - 3); c.lineTo(x, yc + 3); }
  for (let j = 0; j <= 40; j++) { const y = sy + j * sh / 40; c.moveTo(xc - 3, y); c.lineTo(xc + 3, y); }
  c.stroke();
  // heating boost band
  if (!S.user && p.boost && BOOST.t1 > t0 && BOOST.t0 < t1) { c.fillStyle = 'rgba(255,143,107,0.07)'; c.fillRect(X(BOOST.t0), sy, X(BOOST.t1) - X(BOOST.t0), sh); c.fillStyle = 'rgba(255,170,140,0.7)'; c.font = '500 10px "JetBrains Mono", monospace'; c.textAlign = 'left'; c.fillText('heating boost', Math.max(sx + 4, X(BOOST.t0) + 4), sy + 14); }
  const glow = (col, blur) => { c.shadowColor = col; c.shadowBlur = blur; };
  // truth (min/max per pixel column)
  if (!S.user) {
    const i0 = Math.max(0, Math.floor(t0 / DT)), i1 = Math.min(NF - 1, Math.ceil(t1 / DT));
    c.strokeStyle = COL.truth; c.lineWidth = 1.3; glow('rgba(220,255,235,0.35)', 4); c.beginPath();
    const perPx = (i1 - i0) / sw;
    if (perPx > 2) {
      for (let px = 0; px < sw; px++) {
        const a = i0 + Math.floor(px * perPx), b = Math.min(i1, i0 + Math.floor((px + 1) * perPx)); let mn = Infinity, mx = -Infinity;
        for (let i = a; i <= b; i++) { const v = S.T[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
        c.moveTo(sx + px + 0.5, Y(mx)); c.lineTo(sx + px + 0.5, Y(mn) + 0.5);
      }
    } else { for (let i = i0; i <= i1; i++) { const x = X(i * DT), y = Y(S.T[i]); i === i0 ? c.moveTo(x, y) : c.lineTo(x, y); } }
    c.stroke();
  }
  // samples
  const pxPerSample = p.dtS / span * sw;
  const tk = k => S.t[k];
  if (p.join) { c.strokeStyle = 'rgba(255,216,77,0.55)'; c.lineWidth = 1.2; glow('rgba(255,216,77,0.5)', 5); c.beginPath(); for (let k = kA; k <= kB; k++) { const x = X(tk(k)), y = Y(S.z[k]); k === kA ? c.moveTo(x, y) : c.lineTo(x, y); } c.stroke(); }
  // Kalman band
  const show = p.show;
  const on = f => show === 'all' || show === f;
  if (on('kal')) {
    c.shadowBlur = 0; c.fillStyle = 'rgba(111,211,154,0.13)'; c.beginPath();
    for (let k = kA; k <= kB; k++) { const x = X(tk(k)), y = Y(S.f.kal[k] + 2 * Math.sqrt(S.kalP[k])); k === kA ? c.moveTo(x, y) : c.lineTo(x, y); }
    for (let k = kB; k >= kA; k--) c.lineTo(X(tk(k)), Y(S.f.kal[k] - 2 * Math.sqrt(S.kalP[k])));
    c.closePath(); c.fill();
  }
  for (const f of ['ma', 'ema', 'med', 'kal']) {
    if (!on(f)) continue;
    c.strokeStyle = COL[f]; c.lineWidth = 2; glow(COL[f], 7); c.beginPath();
    for (let k = kA; k <= kB; k++) { const x = X(tk(k)), y = Y(S.f[f][k]); k === kA ? c.moveTo(x, y) : c.lineTo(x, y); }
    c.stroke();
  }
  // sample dots and spike markers
  c.shadowBlur = 0;
  const dots = pxPerSample > 2.2, r = Math.min(3.6, Math.max(1.6, pxPerSample / 4));
  for (let k = kA; k <= kB; k++) {
    const sp = S.spike[k] && p.mode === 'point', rj = on('kal') && p.gate && S.kalRej[k];
    if (!dots && !sp && !rj) continue;
    const x = X(tk(k)), y = Math.max(sy + 6, Math.min(sy + sh - 6, Y(S.z[k])));
    if (dots) { c.fillStyle = COL.raw; glow('rgba(255,216,77,0.9)', 6); c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); }
    if (sp) { c.shadowBlur = 0; c.strokeStyle = '#ff6b6b'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, r + 4, 0, 7); c.stroke(); }
    if (rj) { c.shadowBlur = 0; c.strokeStyle = '#6fd39a'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(x - 5, y - 5); c.lineTo(x + 5, y + 5); c.moveTo(x + 5, y - 5); c.lineTo(x - 5, y + 5); c.stroke(); }
  }
  // sample-and-hold strobe at the newest sample
  const kLast = Math.min(S.n - 1, Math.floor((t1 - tStart()) / p.dtS));
  if (kLast >= 0 && tk(kLast) >= t0) {
    const age = (t1 - tk(kLast)) / Math.max(p.dtS, 1);
    const a = Math.max(0.12, 1 - age);
    const x = X(tk(kLast));
    c.shadowBlur = 0; c.strokeStyle = `rgba(255,216,77,${0.35 * a})`; c.lineWidth = 1; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(x, sy); c.lineTo(x, sy + sh); c.stroke(); c.setLineDash([]);
    c.fillStyle = `rgba(255,216,77,${0.9 * a})`; c.font = '600 10px "JetBrains Mono", monospace'; c.textAlign = x > sx + sw - 30 ? 'right' : 'center'; c.fillText('S/H', x > sx + sw - 30 ? x - 4 : x, sy + 14);
  }
  c.restore();
  // screen frame + labels
  c.strokeStyle = 'rgba(120,255,180,0.28)'; c.lineWidth = 1; c.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
  c.fillStyle = 'rgba(200,230,215,0.8)'; c.font = '500 10.5px "JetBrains Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'top';
  for (let i = (sw < 520 ? 2 : 1); i <= 10; i += (sw < 520 ? 2 : 1)) { const t = t0 + i * span / 10; if (t < tStart() - 1) continue; const ck = clock24(Math.max(0, S.user ? t - tStart() : t)); c.fillText(S.user ? '+' + ck.s : ck.s, Math.min(sx + sw - 16, Math.max(sx + 16, sx + i * sw / 10)), sy + sh + 6); }
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left'; c.fillStyle = 'rgba(155,231,182,0.95)';
  c.fillText(`${fmt(vDiv, vDiv < 0.1 ? 2 : vDiv < 1 ? 1 : 0)} °C/div   ${p.tdiv === 17280 ? '4.8 h' : fmtDur(p.tdiv)}/div   centre ${fmt(vCenter, 1)} °C`, sx + 6, sy + sh - 8);
  // y ticks (°C) on the left edge inside the screen
  c.fillStyle = 'rgba(200,230,215,0.55)'; c.font = '500 10px "JetBrains Mono", monospace';
  for (let j = 1; j < 8; j++) { const v = vCenter + (4 - j) * vDiv; c.fillText(fmt(v, vDiv < 0.1 ? 2 : vDiv < 1 ? 1 : 0), sx + 4, sy + j * sh / 8 - 3); }
  drawOverview(p, t0, t1);
  if (L.side) drawPanel(p);
}
function drawOverview(p, t0, t1) {
  const { x, y, w, h } = L.ov; const c = ctx;
  roundRect(c, x - 2, y - 2, w + 4, h + 4, 7); c.fillStyle = '#050b08'; c.fill();
  c.strokeStyle = 'rgba(120,255,180,0.18)'; c.stroke();
  const a0 = tStart(), a1 = tEnd();
  if (!S.overview || S.overview.w !== w) {
    const col = [], src = S.user ? S.z : S.T, dtS = S.user ? p.dtS : DT, n = src.length;
    let mn = Infinity, mx = -Infinity; for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 4000))) { if (src[i] < mn) mn = src[i]; if (src[i] > mx) mx = src[i]; }
    for (let px = 0; px < w; px++) { const i0 = Math.floor(px / w * n), i1 = Math.min(n - 1, Math.floor((px + 1) / w * n)); let a = Infinity, b = -Infinity; for (let i = i0; i <= i1; i++) { if (src[i] < a) a = src[i]; if (src[i] > b) b = src[i]; } col.push([a, b]); }
    S.overview = { w, col, mn, mx, dtS };
  }
  const O = S.overview; const Yo = v => y + h - 3 - (v - O.mn) / (O.mx - O.mn || 1) * (h - 17);
  c.strokeStyle = 'rgba(226,236,230,0.55)'; c.lineWidth = 1; c.beginPath();
  O.col.forEach(([a, b], px) => { c.moveTo(x + px + 0.5, Yo(b)); c.lineTo(x + px + 0.5, Yo(a) + 0.5); }); c.stroke();
  const X = t => x + (t - a0) / (a1 - a0) * w;
  const wx0 = Math.max(x, X(t0)), wx1 = Math.min(x + w, X(t1));
  c.fillStyle = 'rgba(155,231,182,0.16)'; c.fillRect(wx0, y, Math.max(2, wx1 - wx0), h);
  c.strokeStyle = 'rgba(155,231,182,0.8)'; c.strokeRect(wx0 + 0.5, y + 0.5, Math.max(2, wx1 - wx0) - 1, h - 1);
  c.font = '500 9.5px "JetBrains Mono", monospace'; c.textAlign = 'left'; c.textBaseline = 'top';
  if (!S.user) { for (let d = 0; d < 2; d++) { const xx = X(d * 86400); c.strokeStyle = 'rgba(200,230,215,0.25)'; c.beginPath(); c.moveTo(xx + 0.5, y); c.lineTo(xx + 0.5, y + h); c.stroke(); c.fillStyle = 'rgba(200,230,215,0.6)'; c.fillText(`day ${d + 1}`, xx + 5, y + 3); } }
  else { c.fillStyle = 'rgba(200,230,215,0.6)'; c.fillText(userData.name || 'your data', x + 5, y + 3); }
  c.textBaseline = 'alphabetic';
}
function drawPanel(p) {
  const c = ctx, x = L.px, w = L.side; let y = L.sy;
  roundRect(c, x, y - 6, w, L.sh + 12, 10); c.fillStyle = 'rgba(12,22,18,0.92)'; c.fill(); c.strokeStyle = 'rgba(120,255,180,0.14)'; c.stroke();
  const A = aliasInfo(p);
  const line = (txt, col = 'rgba(210,232,220,0.9)', bold = false, dy = 16) => { c.fillStyle = col; c.font = `${bold ? 650 : 500} 11px "JetBrains Mono", monospace`; c.fillText(txt, x + 12, y); y += dy; };
  c.textAlign = 'left'; y += 12;
  line('CHANNELS', 'rgba(155,231,182,0.9)', true, 18);
  const on = f => p.show === 'all' || p.show === f;
  const ch = [['truth', S.user ? 'truth unknown' : 'true air T', !S.user], ['raw', `samples  Δt ${fmtDur(p.dtS)}`, true], ['ma', `MA  N=${p.maN}`, on('ma')], ['ema', `EMA α=${fmt(p.alpha, 2)}`, on('ema')], ['med', `median N=${p.medN}`, on('med')], ['kal', `Kalman ±2√P`, on('kal')]];
  ch.forEach(([k, txt, vis], i) => { c.globalAlpha = vis ? 1 : 0.32; c.fillStyle = k === 'truth' ? '#e2ece6' : COL[k]; c.beginPath(); c.arc(x + 16, y - 4, 4, 0, 7); c.fill(); c.fillStyle = 'rgba(210,232,220,0.92)'; c.font = '500 11px "JetBrains Mono", monospace'; c.fillText(`CH${i + 1} ${txt}`, x + 26, y); y += 16; c.globalAlpha = 1; });
  y += 6; c.strokeStyle = 'rgba(120,255,180,0.14)'; c.beginPath(); c.moveTo(x + 10, y - 8); c.lineTo(x + w - 10, y - 8); c.stroke();
  line('MEASURE', 'rgba(155,231,182,0.9)', true, 18);
  line(`f_s    ${fmt(A.fs, 1).padStart(7)} h⁻¹`);
  line(`f_N    ${fmt(A.fN, 1).padStart(7)} h⁻¹`, A.aliased && !S.user ? '#ff8f6b' : undefined);
  if (!S.user) {
    line(`cycle  ${fmt(A.fv, 2).padStart(7)} h⁻¹`);
    if (A.aliased) { const blink = (performance.now() % 1000) < 650; line(`alias  ${fmt(A.fa, 2).padStart(7)} h⁻¹`, blink ? '#ff8f6b' : 'rgba(255,143,107,0.45)', true); }
    else line(`alias      none`, 'rgba(111,211,154,0.95)');
    line(`q      ${fmt(S.q, 4).padStart(7)} °C`);
  }
  y += 6; c.strokeStyle = 'rgba(120,255,180,0.14)'; c.beginPath(); c.moveTo(x + 10, y - 8); c.lineTo(x + w - 10, y - 8); c.stroke();
  if (!S.user) {
    line('RMSE vs TRUTH  (°C)', 'rgba(155,231,182,0.9)', true, 18);
    const rows = [['raw', 'raw', S.rmse.raw], ['ma', 'MA', S.rmse.ma], ['ema', 'EMA', S.rmse.ema], ['med', 'median', S.rmse.med], ['kal', 'Kalman', S.rmse.kal]];
    const mx = Math.max(...rows.map(r => r[2]));
    rows.forEach(([k, lab, v]) => {
      c.fillStyle = 'rgba(210,232,220,0.9)'; c.font = '500 11px "JetBrains Mono", monospace'; c.fillText(lab.padEnd(7) + fmt(v, 3), x + 12, y);
      const bw = (w - 130) * v / mx; c.fillStyle = COL[k]; c.globalAlpha = 0.75; c.fillRect(x + 118, y - 8, Math.max(1, bw), 7); c.globalAlpha = 1; y += 16;
    });
  } else { line('LAG  (63 % step)', 'rgba(155,231,182,0.9)', true, 18); ['ma', 'ema', 'med', 'kal'].forEach(k => line(`${k.padEnd(7)}${fmtDur(S.lag[k])}`, COL[k])); }
  c.fillStyle = 'rgba(200,230,215,0.5)'; c.font = '500 10px "JetBrains Mono", monospace';
  c.fillText('drag screen: scrub time', x + 12, L.sy + L.sh - 20); c.fillText('wheel: time base', x + 12, L.sy + L.sh - 6);
  c.fillText('click strip below: jump', x + 12, L.sy + L.sh + 26);
}

/* stage interaction: drag to scrub, wheel to change the time base, click on overview to jump */
let drag = null;
cv.addEventListener('pointerdown', e => {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const o = L.ov;
  if (y >= o.y - 4 && y <= o.y + o.h + 4 && x >= o.x && x <= o.x + o.w) { const p = params(); tNow = tStart() + (x - o.x) / o.w * (tEnd() - tStart()) + spanNow(p) / 2; clampT(p); draw(); return; }
  if (x >= L.sx && x <= L.sx + L.sw && y >= L.sy && y <= L.sy + L.sh) { drag = { x, t: tNow, was: clock.running }; clock.pause(); cv.setPointerCapture(e.pointerId); }
});
cv.addEventListener('pointermove', e => { if (!drag) return; const r = cv.getBoundingClientRect(); const p = params(); tNow = drag.t - (e.clientX - r.left - drag.x) / L.sw * spanNow(p); clampT(p); draw(); });
cv.addEventListener('pointerup', () => { drag = null; });
cv.addEventListener('wheel', e => { e.preventDefault(); const i = TDIVS.indexOf(+ui.get('tdiv')); const j = Math.max(0, Math.min(TDIVS.length - 1, i + (e.deltaY > 0 ? 1 : -1))); if (j !== i) ui.set('tdiv', String(TDIVS[j])); }, { passive: false });
function clampT(p) { const span = spanNow(p); tNow = Math.max(tStart() + Math.min(span, tEnd() - tStart()), Math.min(tEnd(), tNow)); }

/* ------------------------------------------------------------------ clock */
const clock = new SimClock({
  speed: 600,
  onStep: dt => { const p = params(); tNow += dt; if (tNow > tEnd()) tNow = tStart() + Math.min(spanNow(p), tEnd() - tStart()); },
  onFrame: t => { draw(); const ck = clock24(tNow); hud.set('t', S.user ? `t = <b>${fmtDur(tNow - tStart())}</b>` : `Day <b>${ck.d}</b> · <b>${ck.s}</b>`); }
});
clock.onState(run => { playBtn.innerHTML = run ? '❚❚ Pause' : '▶ Play'; });
const io = new IntersectionObserver(es => es.forEach(en => { if (!en.isIntersecting && clock.running) { clock.pause(); pausedByScroll = true; } else if (en.isIntersecting && pausedByScroll) { pausedByScroll = false; clock.play(); } }));
let pausedByScroll = false; io.observe(stageEl);

/* ------------------------------------------------------------------ export and user data */
function exportCSV() {
  const p = params();
  const rows = []; for (let k = 0; k < S.n; k++) rows.push([+(S.t[k] / 60).toFixed(3), S.truth ? +S.truth[k].toFixed(4) : '', +S.z[k].toFixed(4), +S.f.ma[k].toFixed(4), +S.f.ema[k].toFixed(4), +S.f.med[k].toFixed(4), +S.f.kal[k].toFixed(4), +Math.sqrt(S.kalP[k]).toFixed(4)]);
  downloadCSV(`signal-processing-dt${p.dtS}s.csv`, ['time_min', 'truth_C', 'sample_C', 'moving_average_C', 'ema_C', 'median_C', 'kalman_C', 'kalman_sd_C'], rows);
}
const upBox = document.getElementById('user-data');
if (upBox) {
  const ta = upBox.querySelector('textarea'), unitSel = upBox.querySelector('select'), msg = upBox.querySelector('.ud-msg');
  // example: 6 h of 1-min readings generated by this laboratory's own model (seed 7) — not measurements
  (function example() {
    const p = Object.assign(ui.values(), { Ad: 4, Pv: 12, Av: 0.6, turb: 0.1, boost: false, tau: 20, noise: 0.12, pspike: 0.8, aspike: 4, bits: 12, dt: 60, mode: 'point' });
    const keep = seed; seed = 7; const T = makeTruth(p); const smp = sampleSeries(p, sensorLag(T, 20), T); seed = keep;
    const lines = ['time_min,temperature_C'];
    for (let k = 540; k < 900; k++) lines.push(`${k - 540},${smp.z[k].toFixed(3)}`);
    ta.value = lines.join('\n');
  })();
  upBox.querySelector('[data-act="apply"]').addEventListener('click', () => {
    try {
      const tb = parseTable(ta.value); if (tb.rows.length < 16) throw new Error('need at least 16 rows');
      const unit = unitSel.value; let t = [], z = [];
      tb.rows.forEach(r => { let tt = r[0]; if (unit === 'iso') tt = Date.parse(tt) / 1000; else tt = +tt * (unit === 'h' ? 3600 : unit === 'min' ? 60 : 1); const v = +r[1]; if (isFinite(tt) && isFinite(v)) { t.push(tt); z.push(v); } });
      if (t.length < 16) throw new Error('could not read numeric time and value columns');
      const d = []; for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]); d.sort((a, b) => a - b); const dt = d[Math.floor(d.length / 2)];
      if (!(dt > 0)) throw new Error('time column must increase');
      const t0 = t[0]; const n = Math.floor((t[t.length - 1] - t0) / dt) + 1; const tt = new Float64Array(n), zz = new Float64Array(n);
      let j = 0; for (let k = 0; k < n; k++) { const tk = t0 + k * dt; while (j < t.length - 2 && t[j + 1] <= tk) j++; const f = t[j + 1] > t[j] ? Math.min(1, Math.max(0, (tk - t[j]) / (t[j + 1] - t[j]))) : 0; tt[k] = tk; zz[k] = z[j] + f * (z[j + 1] - z[j]); }
      userData = { t: tt, z: zz, dt, name: `your data: ${n} samples, Δt = ${fmtDur(dt)}` };
      msg.innerHTML = `Loaded ${t.length} rows; regular grid of ${n} samples at Δt = ${fmtDur(dt)} (gaps linearly interpolated). The oscilloscope, spectrum, Kalman and frequency-response charts now use your data.`;
      tNow = tt[Math.min(n - 1, 120)]; S.overview = null; recompute();
    } catch (err) { msg.textContent = 'Could not use the data: ' + err.message; }
  });
  upBox.querySelector('[data-act="reset"]').addEventListener('click', () => { userData = null; msg.textContent = 'Back to the synthetic greenhouse.'; S.overview = null; tNow = 10 * 3600; recompute(); });
}

/* ------------------------------------------------------------------ update loop */
function recompute() {
  const p = computeAll();
  ui.enable('sr', !p.autoR);
  clampT(p);
  updateReadouts(p);
  updateSpectrum(p);
  updateKalmanChart();
  updateResponse(p);
  scheduleSweep(p);
  draw();
}
let raf = 0;
ui.onChange((st, id) => {
  if (id === 'speed') { clock.speed = +st.speed; return; }
  if (id === 'tdiv' || id === 'show' || id === 'join') { const p = params(); clampT(p); draw(); return; }
  cancelAnimationFrame(raf); raf = requestAnimationFrame(recompute);
});
clock.speed = +ui.get('speed');
resize();
recompute();
clock.play();
window.__sp = { S, params, aliasInfo };
