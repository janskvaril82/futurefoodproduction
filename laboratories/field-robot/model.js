/* ==========================================================================
   Autonomous weeding robot — detection, spot-spraying, work-rate and energy
   model (pure JS, no DOM). Every equation is in the Derive tab (Eqs. R1–R10).

   · detector: equal-variance Gaussian signal-detection model per weed species (R1)
   · speed: motion blur lowers separability (R2); frame rate limits coverage (R3);
     timing jitter shifts the spray pulse (R4)
   · spraying: Boolean coverage by rectangular pulses (R5) — generalises Eq. 11.4.4
     of the lesson; patchy weeds as a log-Gaussian Cox process (R6)
   · outcomes: weed-control efficacy, escapes, crop plants hit (R7)
   · work rate and solar energy balance (R8–R10)
   ========================================================================== */
import { normCdf } from '../../assets/js/stats.js';
import { extraterrestrialRadiation } from '../../assets/js/physics.js';

export const G = 9.81;
export const CROPS = {
  beet: { name: 'Sugar beet (2–4 true leaves)', rowSp: 0.5, plantSp: 0.18, emerge: 0.9, r: 0.03 },
  lettuce: { name: 'Lettuce transplants', rowSp: 0.375, plantSp: 0.3, emerge: 0.97, r: 0.05 }
};
/** Weed species (shares and separability multipliers are illustrative assumptions). */
export const WEEDS = [
  { id: 'fathen', name: 'Fat hen', latin: 'Chenopodium album', kind: 'broadleaf', share: 0.35, dmul: 0.7, r: 0.022, note: 'same plant family as sugar beet (Amaranthaceae): hardest to tell apart' },
  { id: 'chickweed', name: 'Common chickweed', latin: 'Stellaria media', kind: 'broadleaf', share: 0.25, dmul: 1.0, r: 0.028, note: 'small, bright, opposite leaves' },
  { id: 'mayweed', name: 'Scentless mayweed', latin: 'Tripleurospermum inodorum', kind: 'broadleaf', share: 0.15, dmul: 1.15, r: 0.024, note: 'finely divided leaves' },
  { id: 'grass', name: 'Grass weeds', latin: 'Elymus repens, Poa annua', kind: 'grass', share: 0.25, dmul: 1.35, r: 0.02, note: 'monocot: narrow leaves, easiest to separate' }
];
/** Fixed machine constants (documented in the Assumptions tab). */
export const K = {
  footprint: 0.7,       // m, length of each camera footprint along the direction of travel
  camToNozzle: 0.9,     // m, distance from the camera footprint centre to the nozzle line
  tValve: 0.012,        // s, solenoid valve opening delay
  blurScale: 0.003,     // m, characteristic size of the leaf features the classifier needs (b_c)
  etaDrive: 0.75,       // drivetrain + motor efficiency
  pPump: 40,            // W, pump and valves
  fieldEff: 0.9,        // share of time spent working (turns at headlands, refilling)
  pvPR: 0.85,           // performance ratio of the roof PV (temperature, wiring, MPPT)
  etaPV: 0.21,          // roof module efficiency
  gsd: 0.0004           // m per pixel, ground sampling distance of the cameras
};

/* ------------------------------------------------------------------ quadrature over the latent Gaussian field Z (R6) */
const ZN = 81, ZS = [], ZW = [];
(function () { let s = 0; for (let i = 0; i < ZN; i++) { const z = -6 + 12 * i / (ZN - 1); const w = Math.exp(-0.5 * z * z); ZS.push(z); ZW.push(w); s += w; } for (let i = 0; i < ZN; i++) ZW[i] /= s; })();

/* ------------------------------------------------------------------ building blocks */
/** Motion blur length (m) and the factor by which separability shrinks (R2). */
export function blur(v, texpS) { const b = v * texpS; return { b, px: b / K.gsd, f: 1 / Math.sqrt(1 + (b / K.blurScale) ** 2) }; }
/** Share of the ground actually imaged when frames take tinf seconds to process (R3). */
export const coverage = (v, tinfS) => v <= 0 ? 1 : Math.min(1, K.footprint / (v * tinfS));
/** Can the decision reach the nozzle before the plant passes under it? */
export const inTime = (v, tinfS) => v <= 0 || K.camToNozzle / v >= tinfS + K.tValve;
/** Probability that a pulse of length l aimed at a plant of radius r covers it, with timing jitter σ_t (R4). */
export function pHit(v, l, r, sigT) {
  const m = l / 2 - r; if (m <= 0) return 0;
  const s = v * sigT; if (s < 1e-9) return 1;
  return Math.max(0, 2 * normCdf(m / s) - 1);
}
/** Per-species true-positive rates and the crop false-positive rate at threshold τ (R1). */
export function rates(d0, blurF, tau, cov = 1) {
  const tprS = WEEDS.map(w => cov * normCdf(d0 * w.dmul * blurF - tau));
  const tpr = WEEDS.reduce((a, w, i) => a + w.share * tprS[i], 0);
  return { tprS, tpr, fpr: cov * normCdf(-tau) };
}
/** Classifier ROC (no coverage losses): arrays of FPR and TPR, and the AUC. */
export function roc(d0, blurF, n = 161) {
  const fpr = [], tpr = [];
  for (let i = 0; i < n; i++) { const t = 7 - 11 * i / (n - 1); const r = rates(d0, blurF, t, 1); fpr.push(r.fpr); tpr.push(r.tpr); }
  const auc = WEEDS.reduce((a, w) => a + w.share * normCdf(d0 * w.dmul * blurF / Math.SQRT2), 0);
  return { fpr, tpr, auc };
}
/** Posterior probability that a plant with score s is a weed (for the camera display). */
export function pWeed(s, d0, blurF, prior) {
  let lw = 0; WEEDS.forEach(w => { const d = d0 * w.dmul * blurF; lw += w.share * Math.exp(-0.5 * (s - d) ** 2); });
  const lc = Math.exp(-0.5 * s * s); return prior * lw / (prior * lw + (1 - prior) * lc);
}

/* ------------------------------------------------------------------ expected outcomes per hectare (R5–R7) */
export function expected(p, tauOverride) {
  const crop = CROPS[p.crop] || CROPS.beet;
  const tau = tauOverride ?? p.tau, v = p.v, texp = p.texp / 1000, tinf = p.tinf / 1000, sigT = p.jitter / 1000, cell = p.cell;
  const bl = blur(v, texp), cov = coverage(v, tinf), ok = inTime(v, tinf);
  const R = rates(p.d0, bl.f, tau, cov);
  const a = cell * cell;
  const rho = crop.emerge / (crop.rowSp * crop.plantSp);                  // crop plants m⁻²
  const hitS = WEEDS.map(w => ok ? pHit(v, cell, w.r / 2, sigT) : 0);     // weed counted as hit if at least half covered
  const hitC = ok ? pHit(v, cell, 0, sigT) : 0;
  const sig = p.sigma, lam = p.lambda;
  let fT = 0, wce = 0, cropHit = 0;
  for (let i = 0; i < ZN; i++) {
    const lz = lam * Math.exp(sig * ZS[i] - sig * sig / 2);
    const Ldet = lz * R.tpr + rho * R.fpr;
    const e = Math.exp(-a * Ldet);
    fT += ZW[i] * (1 - e);
    let wz = 0; WEEDS.forEach((w, k) => { wz += w.share * (1 - (1 - R.tprS[k] * hitS[k]) * e); });
    wce += ZW[i] * lz * wz;
    cropHit += ZW[i] * (1 - (1 - R.fpr * hitC) * e);
  }
  wce = lam > 0 ? p.eh * wce / lam : 0;
  const precision = lam * R.tpr / Math.max(1e-12, lam * R.tpr + rho * R.fpr);
  // work rate and energy (R8–R10)
  const wWork = crop.rowSp * p.rows;
  const W = 0.36 * v * wWork * K.fieldEff;                                   // ha h⁻¹
  const pDrive = p.mass * G * p.crr * v / K.etaDrive;
  const P = p.p0 + pDrive + K.pPump;                                         // W
  const H = p.kt * extraterrestrialRadiation(p.lat, p.doy) / 3.6;            // kWh m⁻² d⁻¹ on the horizontal roof
  const ePV = p.apv * K.etaPV * H * K.pvPR;                                  // kWh d⁻¹
  const hE = P > 0 ? 1000 * ePV / P : 24;
  const hours = Math.min(24, hE);
  return {
    tau, blur: bl, cov, inTime: ok, tpr: R.tpr, tprS: R.tprS, fpr: R.fpr, precision, rho, a,
    fT, saving: 1 - fT, V: p.Vbc * fT, wce, escapes: lam * (1 - wce), cropHit, cropKill: p.nonsel ? p.eh * cropHit : 0,
    pHitMean: WEEDS.reduce((s, w, k) => s + w.share * hitS[k], 0), hitC,
    wWork, W, P, pDrive, H, ePV, hE, hours, areaDay: W * hours, ePerHa: W > 0 ? P / 1000 / W : Infinity,
    dEff: WEEDS.map(w => p.d0 * w.dmul * bl.f)
  };
}
/** Herbicide saving versus weed-control efficacy as the threshold varies. */
export function tradeoff(p, n = 90) { const out = { wce: [], save: [], tau: [] }; for (let i = 0; i < n; i++) { const t = -3 + 10 * i / (n - 1); const e = expected(p, t); out.wce.push(100 * e.wce); out.save.push(100 * e.saving); out.tau.push(t); } return out; }
/** Speed sweep: efficacy, work rate and energy-limited area per day. */
export function speedSweep(p, n = 60) { const out = { v: [], wce: [], W: [], day: [], cov: [] }; for (let i = 0; i < n; i++) { const v = 0.05 + 3.95 * i / (n - 1); const e = expected({ ...p, v }); out.v.push(v); out.wce.push(100 * e.wce); out.W.push(e.W); out.day.push(e.areaDay); out.cov.push(e.cov); } return out; }

/* ------------------------------------------------------------------ published figures for the trade-off chart */
export const CLAIMS = [
  { who: 'John Deere See & Spray, 2024 (manufacturer)', kind: 'maker', save: [59, 59], wce: null, note: '59 % average herbicide saving on >1 million acres of maize, soybean and cotton (company figure)' },
  { who: 'Ecorobotix ARA (manufacturer)', kind: 'maker', save: [50, 95], wce: null, note: 'savings "from 50 % to over 95 %", depending on target, crop stage and infestation' },
  { who: 'FarmDroid +Spray (manufacturer)', kind: 'maker', save: [94, 94], wce: null, note: '"up to 94 %"' },
  { who: 'Gerhards et al. 2026 — 10 maize trials (independent)', kind: 'indep', save: [2, 73], saveMean: 25, wce: [72, 99], note: 'mean 25 % saving, 72–99 % weed-control efficacy, same yield as broadcast' },
  { who: 'Allmendinger et al. 2024 — on-farm maize (independent)', kind: 'indep', save: [47, 47], saveMean: 47, wce: [86, 86], note: '47 % saving, up to 86 % efficacy, equal to broadcast spraying' }
];
