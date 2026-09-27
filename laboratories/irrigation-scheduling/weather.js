/* Irrigation scheduling — stochastic daily weather generator (pure ES module, no DOM).
   A Richardson-type generator (Richardson 1981): precipitation occurrence as a first-order Markov chain, wet-day amounts
   from a gamma distribution, and serially and cross-correlated residuals of maximum temperature, minimum temperature
   and relative sunshine duration, conditioned on wet/dry days. Monthly parameters were estimated from 20 years of daily data
   (2004–2023): Västerås precipitation from SMHI station 96350; all other variables for both sites from NASA POWER
   (MERRA-2 / CERES), with wind converted from 10 m to 2 m (FAO-56 eq. 47) and relative sunshine n/N obtained by inverting
   the Ångström equation with a_s = 0.25, b_s = 0.50 (FAO-56 eq. 35). */

export const SITES = {
  vasteras: {
    name: 'Västerås, Sweden', lat: 59.61, lon: 16.55, z: 15,
    src: 'precipitation: SMHI station 96350 Västerås; other variables: NASA POWER, 59.61° N 16.55° E; 2004–2023',
    r1tx: 0.755, r1tn: 0.763, r1sun: 0.231, cxn: 0.821, cxs: 0.171, annualP: 620,
    pwd: [0.263, 0.21, 0.141, 0.149, 0.23, 0.246, 0.254, 0.293, 0.195, 0.248, 0.296, 0.284],
    pww: [0.443, 0.463, 0.44, 0.345, 0.436, 0.418, 0.431, 0.47, 0.435, 0.439, 0.453, 0.534],
    gk: [1.611, 1.256, 1.473, 1.287, 0.958, 1.048, 0.999, 0.808, 0.851, 1.43, 1.085, 1.627],
    gth: [2.83, 3.266, 2.805, 3.884, 5.471, 6.469, 7.801, 9.443, 6.701, 4.285, 4.488, 2.516],
    txd: [-2.78, -0.92, 4.02, 10.71, 16.23, 20.99, 23.39, 21.91, 17.1, 9.74, 3.36, -1.18],
    txw: [-0.48, -0.47, 2.61, 8.01, 13.76, 18.45, 20.77, 20.13, 15.98, 9.47, 3.79, 0.03],
    tnd: [-7.85, -6.72, -3.32, 1.25, 6.44, 11.29, 13.83, 12.73, 8.82, 3.77, -0.25, -5.37],
    tnw: [-4.73, -5.45, -2.41, 1.6, 6.5, 11.09, 13.35, 12.86, 9.42, 4.93, 0.45, -3.91],
    txs: [4.6, 3.99, 4.15, 3.76, 4.25, 4, 3.54, 3.26, 3.13, 3.49, 4.02, 4.75],
    tns: [5.91, 5.39, 4.3, 2.98, 3.32, 2.93, 2.4, 2.46, 2.66, 3.33, 4.54, 5.84],
    dpd: [-1.91, -2.15, -1.4, -0.88, -0.18, 0.8, 1.26, 0.44, -0.43, -0.87, -1.14, -1.56],
    dpw: [-1.84, -2.11, -1.62, -1.14, -0.87, 0.06, 0.15, -0.28, -0.71, -1.21, -1.22, -1.78],
    dps: [1.58, 1.59, 1.62, 1.44, 1.57, 1.58, 1.5, 1.46, 1.37, 1.15, 1.13, 1.51],
    u2: [1.84, 1.75, 1.84, 1.85, 1.8, 1.75, 1.71, 1.72, 1.88, 1.86, 1.78, 1.8],
    u2s: [0.65, 0.6, 0.61, 0.6, 0.56, 0.57, 0.55, 0.54, 0.64, 0.62, 0.64, 0.65],
    snd: [0.19, 0.347, 0.556, 0.604, 0.63, 0.633, 0.587, 0.561, 0.499, 0.434, 0.267, 0.165],
    snw: [0.053, 0.131, 0.166, 0.249, 0.242, 0.325, 0.306, 0.288, 0.255, 0.147, 0.086, 0.046],
    sns: [0.178, 0.267, 0.303, 0.271, 0.247, 0.246, 0.225, 0.235, 0.268, 0.296, 0.241, 0.152]
  },
  almeria: {
    name: 'Almería, Spain', lat: 36.84, lon: -2.46, z: 20,
    src: 'all variables: NASA POWER, 36.84° N 2.46° W; 2004–2023',
    r1tx: 0.667, r1tn: 0.726, r1sun: 0.312, cxn: 0.758, cxs: 0.18, annualP: 243,
    pwd: [0.097, 0.114, 0.115, 0.117, 0.073, 0.039, 0.008, 0.017, 0.081, 0.093, 0.119, 0.087],
    pww: [0.484, 0.396, 0.563, 0.455, 0.486, 0.242, 0.167, 0.471, 0.4, 0.435, 0.487, 0.461],
    gk: [0.762, 1.158, 1.292, 1.045, 0.636, 1.836, 1.388, 0.792, 0.605, 0.878, 0.631, 0.82],
    gth: [6.766, 3.646, 3.574, 4.166, 6.387, 1.804, 2.882, 5.196, 8.8, 5.801, 7.745, 8.161],
    txd: [14.1, 14.61, 17.31, 19.95, 23.87, 28.36, 31.85, 31.64, 27.41, 23.47, 17.68, 14.6],
    txw: [10.06, 11.52, 13.31, 15.96, 19.03, 23.66, 29.73, 25.91, 23.25, 19.55, 14.62, 13.22],
    tnd: [5.13, 5.28, 6.98, 9.37, 12.99, 17.17, 20.36, 20.62, 17.45, 13.91, 8.46, 6.02],
    tnw: [4.1, 5.13, 6.6, 8.47, 11.31, 15.47, 19.33, 18.49, 16.55, 12.76, 9.1, 7.4],
    txs: [3.13, 3.19, 3.28, 3.06, 3.1, 2.88, 2.39, 2.47, 2.63, 2.95, 3.2, 2.96],
    tns: [2.35, 2.48, 2.58, 2.46, 2.61, 2.62, 2.08, 1.96, 2.06, 2.56, 2.89, 2.61],
    dpd: [2.21, 2.28, 3.13, 3.62, 5.39, 7.6, 9.44, 8.24, 5.4, 3.94, 2.76, 1.91],
    dpw: [0.47, 0.76, 0.99, 1.68, 2.48, 3.92, 5.59, 3.07, 2.41, 1.7, 0.8, 0.03],
    dps: [2.28, 2.23, 2.36, 2.45, 2.81, 3.14, 3.67, 4.04, 3.17, 2.67, 2.28, 2.24],
    u2: [2.8, 3.17, 3.18, 3.06, 2.81, 2.7, 2.66, 2.63, 2.59, 2.46, 2.71, 2.75],
    u2s: [1.58, 1.62, 1.59, 1.4, 1.13, 0.92, 0.88, 0.96, 1.05, 1.14, 1.33, 1.5],
    snd: [0.714, 0.753, 0.786, 0.762, 0.791, 0.822, 0.796, 0.79, 0.752, 0.759, 0.747, 0.685],
    snw: [0.352, 0.381, 0.375, 0.418, 0.464, 0.614, 0.654, 0.566, 0.477, 0.408, 0.366, 0.327],
    sns: [0.232, 0.236, 0.231, 0.222, 0.189, 0.135, 0.119, 0.129, 0.19, 0.201, 0.224, 0.208]
  }
};

/* ------------------------------------------------------------------ random numbers */
export function rng(seed = 1) { let a = seed >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function randn(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
/** Gamma(k, θ) variate — Marsaglia & Tsang (2000), with the k < 1 boost. */
export function gamma(k, theta, r) {
  if (k < 1) return gamma(k + 1, theta, r) * Math.pow(r(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) { let x, v; do { x = randn(r); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = r(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * theta; }
}

/* ------------------------------------------------------------------ dates */
export const DAY = 864e5;
export const dateOfDoy = (year, doy) => new Date(Date.UTC(year, 0, 1) + (doy - 1) * DAY);
export const doyOf = d => Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY) + 1;
export const fmtDate = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const CUM = MDAYS.map((_, m) => MDAYS.slice(0, m).reduce((s, v) => s + v, 0));
const MID = CUM.map((c, m) => c + MDAYS[m] / 2);
/** Linear interpolation of a monthly parameter between mid-month values (cyclic over the year). */
function interp(arr, d) {
  const t = CUM[d.getUTCMonth()] + Math.min(d.getUTCDate(), MDAYS[d.getUTCMonth()]) - 0.5;
  const m = MID.findIndex(x => x > t);
  let a, b, ta, tb;
  if (m === 0) { a = 11; b = 0; ta = MID[11] - 365; tb = MID[0]; }
  else if (m === -1) { a = 11; b = 0; ta = MID[11]; tb = MID[0] + 365; }
  else { a = m - 1; b = m; ta = MID[a]; tb = MID[b]; }
  return arr[a] + (arr[b] - arr[a]) * (t - ta) / (tb - ta);
}

/**
 * Generate `days` days of weather starting at `start` (Date, UTC) for a site. Returns an array of
 * { date, doy, tmax, tmin, tdew, u2, sun (relative sunshine n/N), rain } — temperatures °C, wind m s⁻¹, rain mm.
 */
export function generate({ site = 'vasteras', start, days = 150, seed = 1 }) {
  const S = SITES[site], r = rng(seed * 7717 + 31), out = [];
  let wet = false, x1 = 0, x2 = 0, x3 = 0;
  const q = x => Math.sqrt(1 - x * x);
  for (let d = -40; d < days; d++) {
    const date = new Date(start.getTime() + d * DAY), g = k => interp(S[k], date);
    wet = r() < (wet ? g('pww') : g('pwd'));
    const rain = wet ? Math.max(0, gamma(g('gk'), g('gth'), r)) : 0;
    const z1 = randn(r), z2 = randn(r), z3 = randn(r);
    const e2 = S.cxn * z1 + q(S.cxn) * z2, e3 = S.cxs * z1 + q(S.cxs) * z3;
    x1 = S.r1tx * x1 + q(S.r1tx) * z1; x2 = S.r1tn * x2 + q(S.r1tn) * e2; x3 = S.r1sun * x3 + q(S.r1sun) * e3;
    const tmin = (wet ? g('tnw') : g('tnd')) + g('tns') * x2;
    const tmax = Math.max(tmin + 1, (wet ? g('txw') : g('txd')) + g('txs') * x1);
    const sun = Math.min(1, Math.max(0, (wet ? g('snw') : g('snd')) + g('sns') * x3));
    const tdew = Math.min(tmin - (wet ? g('dpw') : g('dpd')) + g('dps') * randn(r), (tmax + tmin) / 2);
    const u2 = Math.max(0.3, g('u2') + g('u2s') * randn(r));
    if (d >= 0) out.push({ date, doy: doyOf(date), tmax, tmin, tdew, u2, sun, rain });
  }
  return out;
}

/**
 * Illustrative forecast of day i + lead issued on day i: rain events are detected with a probability that falls with lead
 * time, amounts carry a log-normal error, false alarms occur, and ET₀ carries a relative error growing with lead time.
 */
export function forecastDay(truth, lead, r) {
  const pHit = Math.max(0.35, 0.9 - 0.1 * lead), pFalse = Math.min(0.25, 0.05 + 0.04 * lead), sd = 0.35 + 0.15 * lead;
  let rain = 0;
  if (truth.rain >= 1) rain = r() < pHit ? truth.rain * Math.exp(sd * randn(r) - sd * sd / 2) : 0;
  else if (r() < pFalse) rain = 1 + 6 * r();
  return { rain, et0: truth.et0 * Math.max(0.5, 1 + (0.06 + 0.03 * lead) * randn(r)) };
}

/** Example CSV (first 21 days of a generated Västerås season) — shows the accepted columns. */
export function exampleCSV() {
  const w = generate({ site: 'vasteras', start: new Date(Date.UTC(2026, 4, 10)), days: 21, seed: 4 });
  const iso = d => d.toISOString().slice(0, 10);
  return 'date,tmax,tmin,tdew,u2,sun_hours,rain\n' + w.map(x => {
    const N = 24 / Math.PI * Math.acos(Math.max(-1, Math.min(1, -Math.tan(59.61 * Math.PI / 180) * Math.tan(0.409 * Math.sin(2 * Math.PI * x.doy / 365 - 1.39)))));
    return [iso(x.date), x.tmax.toFixed(1), x.tmin.toFixed(1), x.tdew.toFixed(1), x.u2.toFixed(1), (x.sun * N).toFixed(1), x.rain.toFixed(1)].join(',');
  }).join('\n');
}
