/* Lettuce digital twin — model core (no DOM, no three.js).
   Crop model: the two-state lettuce growth model of Van Henten (1994, thesis ch. 3.2.3, eqs 3.10–3.21,
   parameters of Table 3.2; see also Van Henten & Van Straten, 1994). Units inside the model are SI:
   kg m⁻² (ground), s, W m⁻² PAR, °C, kg CO₂ m⁻³.
   Data assimilation: stochastic ensemble Kalman filter with perturbed observations (Evensen, 1994, 2003;
   Burgers et al., 1998) on the log-transformed augmented state z = [ln Xn, ln Xs, ln m], where m is the
   multiplier of one uncertain model parameter (joint state–parameter estimation; Evensen, 2009). */

/** Van Henten (1994) Table 3.2 — two-state lettuce model. c_lar is printed as 75×10⁻³; with dry weights in
 *  kg m⁻² it must be read as 75 m² kg⁻¹ (= 75×10⁻³ m² g⁻¹), consistent with the one-state value and Fig. 3.3. */
export const VH = Object.freeze({
  c_alpha: 0.68,        // –, CO₂ → CH₂O conversion (30/44)
  c_beta: 0.8,          // –, yield factor (Sweeney et al., 1981)
  c_bnd: 0.004,         // m s⁻¹, boundary-layer conductance
  c_car1: -1.32e-5,     // m s⁻¹ °C⁻², carboxylation conductance polynomial
  c_car2: 5.94e-4,      // m s⁻¹ °C⁻¹
  c_car3: -2.64e-3,     // m s⁻¹
  c_eps: 17e-9,         // kg CO₂ J⁻¹, light-use efficiency at very high CO₂
  c_fw: 22.5,           // –, fresh weight / dry weight
  c_Gamma: 7.32e-5,     // kg m⁻³, CO₂ compensation point at 20 °C (= 40 ppm)
  c_K: 0.9,             // –, extinction coefficient
  c_lar: 75,            // m² kg⁻¹, shoot structural leaf-area ratio
  c_Q10_Gamma: 2,       // –
  c_Q10_gr: 1.6,        // –
  c_Q10_resp: 2,        // –
  c_grmax: 5e-6,        // s⁻¹, saturation growth rate at 20 °C
  c_resp_s: 3.47e-7,    // s⁻¹, shoot maintenance respiration at 25 °C (0.03 d⁻¹)
  c_resp_r: 1.16e-7,    // s⁻¹, root maintenance respiration at 25 °C (0.01 d⁻¹)
  c_stm: 0.007,         // m s⁻¹, stomatal conductance
  c_tau: 0.07           // –, root dry weight / total dry weight (NFT-grown lettuce)
});
export const RHO_CO2 = 1.83;            // kg m⁻³ — Van Henten (1994): 40 ppm ≡ 7.32×10⁻⁵ kg m⁻³
export const J_PER_UMOL = 1 / 4.57;     // J per µmol PAR photons (daylight; Thimijan & Heins, 1983)
export const LIGHTS_ON = 6;             // h, lights switch on at 06:00
export const MEAS_HOUR = 12;            // h, camera snapshot / weighing at 12:00
export const DAY = 86400;
export const XD0 = 2.7e-3;              // kg m⁻², total dry weight at planting (Van Henten, 1994, experiment 1)
export const XS_FRAC0 = 0.75;           // structural share of dry weight at planting (Van Henten, 1994)
export const LED_EFFICACY = 2.8;        // µmol J⁻¹, for the lamp-electricity readout
export const CLOSED = 0.95;             // projected cover above which the image pipeline reports "canopy closed"

/** Uncertain-parameter options. inH: the parameter also enters the measurement (camera) model. */
export const UNCERTAIN = {
  c_eps: { key: 'c_eps', label: 'Light-use efficiency c_ε', inH: false },
  c_lar: { key: 'c_lar', label: 'Leaf-area ratio c_lar,s', inH: true },
  c_grmax: { key: 'c_grmax', label: 'Max. growth rate c_r,gr,max', inH: false }
};

/* ------------------------------------------------------------------ RNG */
export function mulberry(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function gauss(rng) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/* ------------------------------------------------------------------ climate */
/** Is the lamp on at absolute time t (s)? Photoperiod h (h), lights on at LIGHTS_ON. */
export function lightOn(t, h) {
  if (h >= 24) return true; if (h <= 0) return false;
  const hr = ((t / 3600) % 24 + 24) % 24; const off = LIGHTS_ON + h;
  return off <= 24 ? (hr >= LIGHTS_ON && hr < off) : (hr >= LIGHTS_ON || hr < off - 24);
}
/** Next light switching time strictly after t. */
export function nextSwitch(t, h) {
  if (h >= 24 || h <= 0) return Infinity;
  const d0 = Math.floor(t / DAY) * DAY; let best = Infinity;
  for (let k = -1; k <= 1; k++) { const b = d0 + k * DAY; for (const c of [b + LIGHTS_ON * 3600, b + (LIGHTS_ON + h) * 3600]) if (c > t + 1e-6 && c < best) best = c; }
  return best;
}
/** Model inputs for climate settings clim = {ppfd, photo, T, co2}. */
export function inputs(t, clim) {
  const on = lightOn(t, clim.photo);
  return { I: on ? clim.ppfd * J_PER_UMOL : 0, T: clim.T, C: clim.co2 * RHO_CO2 * 1e-6, on };
}
export const dliOf = clim => clim.ppfd * clim.photo * 3600 / 1e6;

/* ------------------------------------------------------------------ Van Henten model */
/** All intermediate quantities (for readouts and the Derive tab). */
export function fluxes(Xn, Xs, I, T, C, p) {
  const Tc = Math.min(39.5, Math.max(5.5, T));                       // carboxylation polynomial valid 5–40 °C
  const Gamma = p.c_Gamma * Math.pow(p.c_Q10_Gamma, (T - 20) / 10);    // eq. 3.14
  const eps = p.c_eps * Math.max(0, C - Gamma) / (C + 2 * Gamma);      // eq. 3.15
  const gcar = Math.max(1e-6, p.c_car1 * Tc * Tc + p.c_car2 * Tc + p.c_car3); // eq. 3.17
  const gCO2 = 1 / (1 / p.c_bnd + 1 / p.c_stm + 1 / gcar);             // eq. 3.16
  const a = eps * I, b = gCO2 * Math.max(0, C - Gamma);
  const photMax = a + b > 0 ? a * b / (a + b) : 0;                     // eq. 3.13
  const cover = 1 - Math.exp(-p.c_K * p.c_lar * (1 - p.c_tau) * Xs);   // eq. 3.12 (interception)
  const phot = photMax * cover;
  const resp = (p.c_resp_s * (1 - p.c_tau) + p.c_resp_r * p.c_tau) * Xs * Math.pow(p.c_Q10_resp, (T - 25) / 10); // eq. 3.18
  const rgr = p.c_grmax * Xn / (Xs + Xn) * Math.pow(p.c_Q10_gr, (T - 20) / 10); // eq. 3.19
  return { Gamma, eps, gcar, gCO2, photMax, cover, phot, resp, rgr };
}
/** Right-hand side, eqs 3.10–3.11. xi multiplies gross photosynthesis (process noise). */
export function rhs(Xn, Xs, I, T, C, p, xi = 1) {
  const f = fluxes(Xn, Xs, I, T, C, p);
  const growth = f.rgr * Xs;
  return [p.c_alpha * f.phot * xi - growth - f.resp - (1 - p.c_beta) / p.c_beta * growth, growth];
}
function rk4(x, dt, I, T, C, p, xi) {
  const [n0, s0] = x;
  const k1 = rhs(n0, s0, I, T, C, p, xi);
  const k2 = rhs(n0 + dt / 2 * k1[0], s0 + dt / 2 * k1[1], I, T, C, p, xi);
  const k3 = rhs(n0 + dt / 2 * k2[0], s0 + dt / 2 * k2[1], I, T, C, p, xi);
  const k4 = rhs(n0 + dt * k3[0], s0 + dt * k3[1], I, T, C, p, xi);
  return [Math.max(1e-8, n0 + dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])), Math.max(1e-8, s0 + dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]))];
}
/**
 * Integrate x = [Xn, Xs] from t0 to t1 under climate clim, splitting exactly at lamp switching and midnight.
 * xiOf(dayIndex) returns that day's photosynthesis multiplier. Max RK4 step hmax (s).
 */
export function advance(x, t0, t1, clim, p, xiOf, hmax = 3600) {
  let t = t0, y = x;
  while (t < t1 - 1e-6) {
    const tb = nextSwitch(t, clim.photo); const dEnd = (Math.floor(t / DAY + 1e-9) + 1) * DAY;
    const te = Math.min(t1, tb, dEnd, t + hmax); const u = inputs(t + 1e-3, clim);
    const xi = xiOf ? xiOf(Math.floor((t + 1e-3) / DAY)) : 1;
    y = rk4(y, te - t, u.I, u.T, u.C, p, xi); t = te;
  }
  return y;
}
/** Fresh weight per head (g) — eq. 3.21 divided by plant density. */
export const fwHead = (x, rhoP) => VH.c_fw * (x[0] + x[1]) * (1 - VH.c_tau) / rhoP * 1000;
/** Structural dry weight per plant (g). */
export const sdwHead = (x, rhoP) => x[1] / rhoP * 1000;
/** Total dry weight per plant (g). */
export const dwHead = (x, rhoP) => (x[0] + x[1]) / rhoP * 1000;
/** Parameters with one parameter scaled by factor m. */
export function withParam(key, m) { const q = Object.assign({}, VH); q[key] = VH[key] * m; return q; }
/** Initial state [Xn, Xs] (kg m⁻²) for plant density rhoP, transplant size scaled by s. */
export const initialState = (rhoP, s = 1) => { const Xd = XD0 * rhoP / 20 * s; return [(1 - XS_FRAC0) * Xd, XS_FRAC0 * Xd]; };

/* ------------------------------------------------------------------ measurements */
const KAPPA = VH.c_K * VH.c_lar * (1 - VH.c_tau);   // m² kg⁻¹ — nominal, used by the pipeline's inversion
/** Projected canopy cover seen by the top camera for structural DW Xs (kg m⁻²) and leaf-area-ratio multiplier. */
export const coverOf = (Xs, mLar = 1) => 1 - Math.exp(-KAPPA * mLar * Xs);
/** Elasticity of the dry-weight estimate with respect to projected area: A(f) = f / ((1−f)(−ln(1−f))). */
export function elasticity(f) { f = Math.min(0.9989, Math.max(1e-6, f)); return f / ((1 - f) * -Math.log(1 - f)); }
/**
 * Camera + image pipeline: projected leaf area per plant (PLA) with log-normal segmentation error σ;
 * inversion of the cover relation with the NOMINAL leaf-area ratio gives a structural-dry-weight estimate.
 * Returns { pla, plaTrue (cm²), f, fTrue, sdwEst (g plant⁻¹), y = ln sdwEst, closed }.
 */
export function measureCamera(xTrue, mLarTrue, rhoP, sig, rng) {
  const f = coverOf(xTrue[1], mLarTrue);
  const plaTrue = f / rhoP;
  const plaMeas = plaTrue * Math.exp(sig * gauss(rng));
  const fm = Math.min(0.999, rhoP * plaMeas);
  const XsEst = -Math.log(1 - fm) / KAPPA;
  const sdwEst = XsEst / rhoP * 1000;
  return { kind: 'camera', pla: plaMeas * 1e4, plaTrue: plaTrue * 1e4, f: fm, fTrue: f, sdwEst, y: Math.log(sdwEst), closed: fm >= CLOSED };
}
/** Weighing (load cells under a gutter): fresh weight per head with log-normal error σ. */
export function measureScale(xTrue, rhoP, sig, rng) {
  const fw = fwHead(xTrue, rhoP) * Math.exp(sig * gauss(rng));
  return { kind: 'scale', fw, y: Math.log(fw), closed: false };
}
/** Observation operators h(member) in log space. */
export const hCamera = (m, key, rhoP) => { const mL = UNCERTAIN[key].inH ? Math.exp(m.lp) : 1; const f = Math.min(0.999, coverOf(m.x[1], mL)); return Math.log(-Math.log(1 - f) / KAPPA / rhoP * 1000); };
export const hScale = (m, rhoP) => Math.log(fwHead(m.x, rhoP));

/* ------------------------------------------------------------------ ensemble */
/** Create an ensemble around x0 with log-normal initial spread cv0 and parameter prior sd (log). */
export function makeEnsemble({ N, x0, cv0 = 0.1, priorSd = 0.2, rng }) {
  const out = [];
  for (let i = 0; i < N; i++) {
    const e = Math.exp(cv0 * gauss(rng));
    out.push({ x: [x0[0] * e * Math.exp(0.05 * gauss(rng)), x0[1] * e], lp: priorSd * gauss(rng), xi: new Map() });
  }
  return out;
}
export const memberParams = (m, key) => withParam(key, Math.exp(m.lp));
/** Daily photosynthesis multiplier of a member (log-normal, mean 1). */
export function memberXi(m, sigP, rng) { return d => { if (!sigP) return 1; if (!m.xi.has(d)) m.xi.set(d, Math.exp(sigP * gauss(rng) - sigP * sigP / 2)); return m.xi.get(d); }; }
/** Ensemble statistics of an array. */
export function stats(arr) {
  const a = arr.filter(v => isFinite(v)); const n = a.length; if (!n) return { mean: NaN, sd: NaN, p05: NaN, p25: NaN, p50: NaN, p75: NaN, p95: NaN, n: 0 };
  let s = 0; for (const v of a) s += v; const mu = s / n;
  let q = 0; for (const v of a) q += (v - mu) ** 2; const sd = Math.sqrt(q / Math.max(1, n - 1));
  const so = a.sort((x, y) => x - y);
  const qt = pr => { const h = (n - 1) * pr, lo = Math.floor(h), hi = Math.ceil(h); return so[lo] + (h - lo) * (so[hi] - so[lo]); };
  return { mean: mu, sd, p05: qt(0.05), p25: qt(0.25), p50: qt(0.5), p75: qt(0.75), p95: qt(0.95), min: so[0], max: so[n - 1], n };
}
/**
 * EnKF analysis with perturbed observations for a scalar observation y with variance R.
 * hOf(member) → predicted observation. Updates z = [ln Xn, ln Xs, ln m] of every member.
 * Returns diagnostics { innov, S, K, hMean, hSd }.
 */
export function analyse(ens, y, R, hOf, rng) {
  const N = ens.length;
  const Z = ens.map(m => [Math.log(m.x[0]), Math.log(m.x[1]), m.lp]);
  const H = ens.map(hOf);
  const zm = [0, 0, 0]; let hm = 0;
  for (let i = 0; i < N; i++) { for (let j = 0; j < 3; j++) zm[j] += Z[i][j] / N; hm += H[i] / N; }
  const czh = [0, 0, 0]; let chh = 0;
  for (let i = 0; i < N; i++) { const dh = H[i] - hm; chh += dh * dh; for (let j = 0; j < 3; j++) czh[j] += (Z[i][j] - zm[j]) * dh; }
  chh /= (N - 1); for (let j = 0; j < 3; j++) czh[j] /= (N - 1);
  const S = chh + R; const K = czh.map(c => c / S); const sR = Math.sqrt(R);
  for (let i = 0; i < N; i++) {
    const d = y + sR * gauss(rng) - H[i];
    const z = Z[i].map((v, j) => v + K[j] * d);
    ens[i].x = [Math.exp(z[0]), Math.exp(z[1])]; ens[i].lp = z[2];
  }
  return { innov: y - hm, S, K, hMean: hm, hSd: Math.sqrt(chh) };
}
/**
 * Forecast one member from time t: integrate with its parameters and fresh random daily process noise until the
 * fresh weight per head reaches the target (or maxDay). Returns { harvest (day, fractional), fw: [fw at each future
 * midnight], x: final state }.
 */
export function forecast(x, t, clim, p, rhoP, target, { maxDay = 70, sigP = 0, rng, record = false, recordUntil = 1.6, xiOf: xiGiven = null } = {}) {
  let y = x, tt = t; const fwAt = []; let harvest = Infinity;
  let prev = fwHead(y, rhoP);
  if (prev >= target) harvest = t / DAY;
  const xiCache = new Map();
  const xiOf = xiGiven || (d => { if (!sigP) return 1; if (!xiCache.has(d)) xiCache.set(d, Math.exp(sigP * gauss(rng) - sigP * sigP / 2)); return xiCache.get(d); });
  if (record) fwAt.push([t / DAY, prev]);
  while (tt < maxDay * DAY && (harvest === Infinity || record)) {
    const tn = (Math.floor(tt / (DAY / 4) + 1e-9) + 1) * (DAY / 4);   // 6-h checkpoints aligned to the clock
    y = advance(y, tt, tn, clim, p, xiOf, 3600);
    const fw = fwHead(y, rhoP);
    if (harvest === Infinity && fw >= target) { const fr = (target - prev) / Math.max(1e-9, fw - prev); harvest = (tt + fr * (tn - tt)) / DAY; }
    if (record && Math.abs(tn / DAY - Math.round(tn / DAY)) < 1e-6) fwAt.push([tn / DAY, fw]);
    prev = fw; tt = tn;
    if (record && fw > recordUntil * target) break;
  }
  return { harvest, fw: fwAt, x: y };
}
