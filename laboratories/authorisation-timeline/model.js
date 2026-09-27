/* Stochastic model of the EU novel-food procedures under Regulation (EU) 2015/2283.
   Shared by the Authorisation timeline simulator and the Novel food navigator.
   Calibration (see the Derive and Sources tabs of /laboratories/authorisation-timeline/):
   - Le Bloch et al. (2025), npj Science of Food 9:117 — 292 applications 2018–2024:
     Commission validity check 114 ± 181 d; EFSA suitability check 185 ± 122 d; EFSA evaluation
     629 ± 338 d with 2.7 ± 1.9 requests for data answered in 130 d on average (cumulative 353 ± 299 d);
     EFSA exceeded the net nine months in 26 % of cases (overrun 156 ± 212 d); publication 48 ± 16 d;
     79/91 opinions positive; 30/292 applications invalid under the Transparency Regulation (297 ± 121 d).
   - Risk-management phase: dates in the recitals of 11 implementing regulations 2021–2025 (VALIDATION_ART10).
   - Traditional-food notifications: dates in the recitals of 6 implementing regulations 2018–2021 (VALIDATION_TF). */
import { mulberry32, randn } from '../../assets/js/stats.js';

export const MONTH = 30.44;              // days per month
export const EFSA_CLOCK = 9 * MONTH;     // Art. 11(1): nine months (net)
export const EFSA_CLOCK_TF = 6 * MONTH;  // Art. 17(1): six months (net)
export const OBJ_WINDOW = 4 * MONTH;     // Art. 15(2): four months
export const IN_FORCE = 21;              // OJ publication (≈1 d) + entry into force on the 20th day

export const LE_BLOCH = {
  A: { mean: 114, sd: 181, min: 0, max: 1430, n: 194 },
  B: { mean: 185, sd: 122, min: 15, max: 758, n: 194 },
  C: { mean: 629, sd: 338, min: 179, max: 1714, n: 88 },
  D: { mean: 48, sd: 16, min: 26, max: 107, n: 91 },
  W: { mean: 937, sd: 436, min: 330, max: 2314, n: 91 },
  stops: { mean: 2.7, sd: 1.9, min: 0, max: 8 },
  resp: { mean: 130, min: 0, max: 733 },
  cumResp: { mean: 353, sd: 299, min: 0, max: 1213 },
  overrun: { share: 0.26, mean: 156, sd: 212, min: 5, max: 951 },
  positive: 79 / 91, invalid: 30 / 292, invalidTime: { mean: 297, sd: 121, min: 74, max: 570 }
};

/* Real procedures (dates from the recitals of the implementing regulations; see Sources tab). */
export const VALIDATION_ART10 = [
  { name: 'Dried Tenebrio molitor larva', act: '(EU) 2021/882', celex: '32021R0882', sub: '2018-02-13', mandate: '2018-07-03', opinion: '2020-11-24', ir: '2021-06-01' },
  { name: 'Locusta migratoria (frozen, dried, powder)', act: '(EU) 2021/1975', celex: '32021R1975', sub: '2018-12-28', mandate: '2019-07-09', opinion: '2021-05-25', ir: '2021-11-12' },
  { name: 'Tenebrio molitor larva (frozen, dried, powder)', act: '(EU) 2022/169', celex: '32022R0169', sub: '2018-12-28', mandate: '2019-08-09', opinion: '2021-07-07', ir: '2022-02-08' },
  { name: 'Acheta domesticus (frozen, dried, powder)', act: '(EU) 2022/188', celex: '32022R0188', sub: '2018-12-28', mandate: '2019-09-04', opinion: '2021-07-07', ir: '2022-02-10' },
  { name: 'Bovine milk β-lactoglobulin', act: '(EU) 2022/2534', celex: '32022R2534', sub: '2020-07-22', mandate: '2020-11-05', opinion: '2022-02-28', ir: '2022-12-21' },
  { name: 'Acheta domesticus partially defatted powder', act: '(EU) 2023/5', celex: '32023R0005', sub: '2019-07-24', mandate: '2020-07-08', opinion: '2022-03-23', ir: '2023-01-03' },
  { name: 'Alphitobius diaperinus larvae', act: '(EU) 2023/58', celex: '32023R0058', sub: '2018-01-07', mandate: '2018-07-17', opinion: '2022-04-26', ir: '2023-01-05' },
  { name: 'Apple fruit cell culture biomass', act: '(EU) 2023/2847', celex: '32023R2847', sub: '2020-04-14', mandate: '2020-12-02', opinion: '2023-05-24', ir: '2023-12-20' },
  { name: 'Lemna protein concentrate', act: '(EU) 2024/1048', celex: '32024R1048', sub: '2018-12-28', mandate: '2021-05-13', opinion: '2023-02-28', ir: '2024-04-09' },
  { name: 'UV-treated Tenebrio molitor powder', act: '(EU) 2025/89', celex: '32025R0089', sub: '2019-07-30', mandate: '2020-05-17', opinion: '2023-03-28', ir: '2025-01-20' },
  { name: 'Lemna minor and L. gibba plants', act: '(EU) 2025/153', celex: '32025R0153', sub: '2020-05-20', mandate: '2020-10-27', opinion: '2022-09-28', ir: '2025-01-29' }
];
export const VALIDATION_TF = [
  { name: 'Haskap berries (Lonicera caerulea)', act: '(EU) 2018/1991', celex: '32018R1991', notif: '2018-01-26', fwd: '2018-02-28', ir: '2018-12-13' },
  { name: 'Fonio (Digitaria exilis) grains', act: '(EU) 2018/2016', celex: '32018R2016', notif: '2018-01-23', fwd: '2018-02-28', ir: '2018-12-18' },
  { name: 'Sorghum syrup', act: '(EU) 2018/2017', celex: '32018R2017', notif: '2018-04-05', fwd: '2018-04-30', ir: '2018-12-18' },
  { name: 'Cocoa pulp (first notifier)', act: '(EU) 2020/206', celex: '32020R0206', notif: '2019-01-30', fwd: '2019-05-22', ir: '2020-02-14' },
  { name: 'Cocoa pulp (second notifier)', act: '(EU) 2020/206', celex: '32020R0206', notif: '2019-03-28', fwd: '2019-06-20', ir: '2020-02-14' },
  { name: 'Coffee leaves infusion', act: '(EU) 2020/917', celex: '32020R0917', notif: '2018-11-27', fwd: '2019-09-11', ir: '2020-07-01' },
  { name: 'Fresh Wolffia plants', act: '(EU) 2021/2191', celex: '32021R2191', notif: '2020-09-07', fwd: '2021-01-20', ir: '2021-12-10' }
];
export const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/* ------------------------------------------------------------------ samplers */
export function lognormalPars(mean, sd) { const s2 = Math.log(1 + (sd * sd) / (mean * mean)); return { mu: Math.log(mean) - s2 / 2, sigma: Math.sqrt(s2) }; }
export function lognormal(rng, mean, sd) { const { mu, sigma } = lognormalPars(mean, sd); return Math.exp(mu + sigma * randn(rng)); }
export function lognormalMS(rng, mu, sigma) { return Math.exp(mu + sigma * randn(rng)); }
/** Gamma(k, 1) by Marsaglia & Tsang (2000). */
export function gamma(rng, k) {
  if (k < 1) { const u = rng() || 1e-12; return gamma(rng, k + 1) * Math.pow(u, 1 / k); }
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) { let x, v; do { x = randn(rng); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = rng(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; }
}
export function beta(rng, a, b) { const x = gamma(rng, a), y = gamma(rng, b); return x / (x + y); }
export function poisson(rng, lam) { if (lam <= 0) return 0; if (lam > 40) return Math.max(0, Math.round(lam + Math.sqrt(lam) * randn(rng))); const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= rng(); } while (p > L); return k - 1; }
/** Negative binomial as a gamma–Poisson mixture with the given mean and variance (variance > mean). */
export function negbin(rng, mean, variance) { if (mean <= 0) return 0; if (variance <= mean * 1.0001) return poisson(rng, mean); const r = mean * mean / (variance - mean); return poisson(rng, gamma(rng, r) * mean / r); }

/* ------------------------------------------------------------------ parameters */
export const DEFAULTS = {
  route: 'art10',        // 'art10' | 'tf'
  stops: 2.7,            // mean number of EFSA requests for additional data
  resp: 130,             // mean applicant response time per request (d)
  workload: 1,           // EFSA workload factor (suitability check, running clock, overrun)
  comm: 1,               // Commission speed factor (>1 slower) for validity check and risk management
  pInvalid: 0.103,       // P(invalid: studies not notified, Transparency Regulation) — 30/292
  pNeg: 0.132,           // P(negative EFSA opinion) — 12/91
  pWithdraw: 0.02,       // P(applicant withdraws) per clock stop — ASSUMPTION
  pTerm: 0.02,           // P(Commission terminates / no qualified majority) — ASSUMPTION
  pObj: 0.25,            // P(reasoned safety objection to a traditional-food notification) — ASSUMPTION
  prep: 180              // median time to prepare an Article 16 application after objections (d) — ASSUMPTION
};
/* Risk-management phase E (publication of opinion → adoption of the implementing regulation): lognormal fitted to the
   11 procedures in VALIDATION_ART10 after subtracting the mean publication lag (48 d): median 243 d, sigma 0.60. */
export const E_FIT = { mu: 5.49, sigma: 0.60 };
/* Traditional-food notifications: validity check (notification → forwarding) lognormal median 73 d, sigma 0.89;
   adoption lag after the four-month window lognormal mean 155 d, sd 32 d (VALIDATION_TF). */
export const TF_FIT = { V: { mu: 4.29, sigma: 0.89 }, L: { mean: 155, sd: 32 } };

/* ------------------------------------------------------------------ one simulated procedure */
/** Returns { route, outcome, total, phases:[{key,label,t0,t1,kind}], events:[{t,label,kind}], n, stopDays, active, overrun }.
    kinds: com (Commission), efsa (EFSA running clock / checks), stop (clock stop — applicant), ms (Member States / PAFF), pub, app (applicant) */
export function simulate(P, rng) {
  P = Object.assign({}, DEFAULTS, P);
  return P.route === 'tf' ? simulateTF(P, rng) : simulateArt10(P, rng);
}

function efsaAssessment(P, rng, t, phases, events, clock, stopScale = 1) {
  // number of clock stops: overdispersed count calibrated to 2.7 ± 1.9 (variance/mean = 1.34)
  const meanN = Math.max(0, P.stops * stopScale);
  const n = Math.min(12, negbin(rng, meanN, meanN * 1.337));
  // active (running-clock) time: 74 % finish within the legal clock, 26 % overrun (scaled by workload)
  const pOver = Math.min(0.9, 0.26 * Math.pow(P.workload, 1.5));
  const within = clock * Math.min(1, Math.max(0.5, beta(rng, 6, 1.4) * Math.min(1.25, Math.pow(P.workload, 0.5))));
  const over = rng() < pOver ? lognormal(rng, 156 * P.workload, 212 * P.workload) : 0;
  const active = (over > 0 ? clock : within) + over;
  // split the running clock into n+1 pieces (uniform spacings) and interleave the stops
  const cuts = Array.from({ length: n }, () => rng()).sort((a, b) => a - b);
  const bounds = [0, ...cuts, 1];
  let stopDays = 0, withdrawn = false;
  for (let i = 0; i <= n; i++) {
    const run = active * (bounds[i + 1] - bounds[i]);
    phases.push({ key: 'C', label: i === 0 ? 'EFSA risk assessment' : 'EFSA assessment resumes', t0: t, t1: t + run, kind: 'efsa' }); t += run;
    if (i < n) {
      const r = Math.max(3, lognormal(rng, P.resp, P.resp * 0.79));
      phases.push({ key: 'S', label: `Clock stop ${i + 1}: EFSA request, applicant replies`, t0: t, t1: t + r, kind: 'stop', idx: i + 1 });
      events.push({ t, label: `Request ${i + 1}`, kind: 'stop' });
      t += r; stopDays += r;
      if (rng() < P.pWithdraw) { withdrawn = true; events.push({ t, label: 'Application withdrawn (Art. 10(7))', kind: 'end' }); break; }
    }
  }
  return { t, n, stopDays, active, overrun: over, withdrawn };
}

function simulateArt10(P, rng) {
  const phases = [], events = [];
  let t = 0;
  events.push({ t: 0, label: 'Application submitted (Art. 10(1))', kind: 'start' });
  const A = Math.min(1430, lognormal(rng, 114 * P.comm, 181 * P.comm));
  phases.push({ key: 'A', label: 'Commission validity check', t0: 0, t1: A, kind: 'com' }); t = A;
  events.push({ t, label: 'Valid — forwarded to EFSA (Art. 11(1))', kind: 'com' });
  // Transparency Regulation: studies not notified → application not valid
  if (rng() < P.pInvalid) {
    const tr = Math.max(A + 20, Math.min(570, 297 + 121 * randn(rng)));
    phases.push({ key: 'B', label: 'EFSA suitability check', t0: t, t1: tr, kind: 'efsa' });
    events.push({ t: tr, label: 'Not valid: studies not notified (Art. 32b GFL)', kind: 'end' });
    return { route: 'art10', outcome: 'invalid', total: tr, phases, events, n: 0, stopDays: 0, active: 0, overrun: 0 };
  }
  const B = Math.min(758 * P.workload + 60, lognormal(rng, 185 * P.workload, 122 * P.workload));
  phases.push({ key: 'B', label: 'EFSA suitability check', t0: t, t1: t + B, kind: 'efsa' }); t += B;
  events.push({ t, label: 'Risk assessment starts (9-month clock)', kind: 'efsa' });
  const R = efsaAssessment(P, rng, t, phases, events, EFSA_CLOCK);
  t = R.t;
  if (R.withdrawn) return { route: 'art10', outcome: 'withdrawn', total: t, phases, events, n: R.n, stopDays: R.stopDays, active: R.active, overrun: R.overrun };
  events.push({ t, label: 'EFSA opinion adopted', kind: 'efsa' });
  const D = Math.max(20, lognormal(rng, 48, 16));
  phases.push({ key: 'D', label: 'Publication of the opinion', t0: t, t1: t + D, kind: 'pub' }); t += D;
  events.push({ t, label: 'Opinion published (EFSA Journal)', kind: 'pub' });
  const neg = rng() < P.pNeg;
  if (neg) { events.push({ t, label: 'Negative opinion — not authorised', kind: 'end' }); return { route: 'art10', outcome: 'negative', total: t, phases, events, n: R.n, stopDays: R.stopDays, active: R.active, overrun: R.overrun }; }
  const E = Math.max(60, lognormalMS(rng, E_FIT.mu, E_FIT.sigma) * P.comm);
  const draft = E * (0.62 + 0.18 * rng());
  phases.push({ key: 'E1', label: 'Commission drafts implementing act', t0: t, t1: t + draft, kind: 'com' });
  phases.push({ key: 'E2', label: 'PAFF Committee vote and adoption', t0: t + draft, t1: t + E, kind: 'ms' });
  events.push({ t: t + draft, label: 'PAFF Committee vote (QMV)', kind: 'ms' });
  if (rng() < P.pTerm) { events.push({ t: t + draft, label: 'No qualified majority / procedure terminated (Art. 10(6))', kind: 'end' }); return { route: 'art10', outcome: 'terminated', total: t + draft, phases: phases.slice(0, -1), events, n: R.n, stopDays: R.stopDays, active: R.active, overrun: R.overrun }; }
  t += E;
  events.push({ t, label: 'Implementing regulation adopted', kind: 'com' });
  phases.push({ key: 'F', label: 'Publication in the OJ → entry into force', t0: t, t1: t + IN_FORCE, kind: 'pub' }); t += IN_FORCE;
  events.push({ t, label: 'Authorised — Union list updated', kind: 'auth' });
  return { route: 'art10', outcome: 'authorised', total: t, phases, events, n: R.n, stopDays: R.stopDays, active: R.active, overrun: R.overrun };
}

function simulateTF(P, rng) {
  const phases = [], events = [];
  let t = 0;
  events.push({ t: 0, label: 'Notification submitted (Art. 14)', kind: 'start' });
  const V = Math.min(700, lognormalMS(rng, TF_FIT.V.mu, TF_FIT.V.sigma) * P.comm);
  phases.push({ key: 'V', label: 'Validity check and forwarding', t0: 0, t1: V, kind: 'com' }); t = V;
  events.push({ t, label: 'Forwarded to Member States and EFSA (Art. 15(1))', kind: 'com' });
  phases.push({ key: 'O', label: 'Four-month window for safety objections', t0: t, t1: t + OBJ_WINDOW, kind: 'ms' });
  const objection = rng() < P.pObj;
  if (!objection) {
    t += OBJ_WINDOW; events.push({ t, label: 'No reasoned safety objection', kind: 'ms' });
    const L = Math.max(30, lognormal(rng, TF_FIT.L.mean, TF_FIT.L.sd) * P.comm);
    phases.push({ key: 'L', label: 'Commission authorises (Art. 15(4))', t0: t, t1: t + L, kind: 'com' }); t += L;
    phases.push({ key: 'F', label: 'Publication in the OJ → entry into force', t0: t, t1: t + IN_FORCE, kind: 'pub' }); t += IN_FORCE;
    events.push({ t, label: 'Authorised as traditional food', kind: 'auth' });
    return { route: 'tf', outcome: 'authorised', objection: false, total: t, phases, events, n: 0, stopDays: 0, active: 0, overrun: 0 };
  }
  const tObj = t + OBJ_WINDOW * (0.35 + 0.6 * rng());
  events.push({ t: tObj, label: 'Reasoned safety objection (Art. 15(2))', kind: 'end' });
  t += OBJ_WINDOW;
  const prep = Math.max(30, lognormal(rng, P.prep, P.prep * 0.5));
  phases.push({ key: 'P', label: 'Applicant prepares an application (Art. 16)', t0: t, t1: t + prep, kind: 'app' }); t += prep;
  const V2 = Math.max(10, lognormal(rng, 60 * P.comm, 40 * P.comm));
  phases.push({ key: 'A', label: 'Validity check, forwarding to EFSA', t0: t, t1: t + V2, kind: 'com' }); t += V2;
  const R = efsaAssessment(P, rng, t, phases, events, EFSA_CLOCK_TF, 0.7);
  t = R.t;
  if (R.withdrawn) return { route: 'tf', outcome: 'withdrawn', objection: true, total: t, phases, events, n: R.n, stopDays: R.stopDays, active: R.active, overrun: R.overrun };
  const D = Math.max(20, lognormal(rng, 48, 16));
  phases.push({ key: 'D', label: 'Publication of the opinion', t0: t, t1: t + D, kind: 'pub' }); t += D;
  if (rng() < P.pNeg) { events.push({ t, label: 'Negative opinion — not authorised', kind: 'end' }); return { route: 'tf', outcome: 'negative', objection: true, total: t, phases, events, n: R.n, stopDays: R.stopDays, active: R.active, overrun: R.overrun }; }
  const E = Math.max(45, lognormalMS(rng, E_FIT.mu, E_FIT.sigma) * P.comm * 3 / 7);
  const draft = E * 0.7;
  phases.push({ key: 'E1', label: 'Commission draft (≤ 3 months, Art. 18)', t0: t, t1: t + draft, kind: 'com' });
  phases.push({ key: 'E2', label: 'PAFF Committee vote and adoption', t0: t + draft, t1: t + E, kind: 'ms' }); t += E;
  phases.push({ key: 'F', label: 'Publication in the OJ → entry into force', t0: t, t1: t + IN_FORCE, kind: 'pub' }); t += IN_FORCE;
  events.push({ t, label: 'Authorised as traditional food', kind: 'auth' });
  return { route: 'tf', outcome: 'authorised', objection: true, total: t, phases, events, n: R.n, stopDays: R.stopDays, active: R.active, overrun: R.overrun };
}

/** Run N procedures with a seeded RNG. */
export function runMany(P, N = 1000, seed = 1) {
  const rng = mulberry32(seed);
  const out = new Array(N);
  for (let i = 0; i < N; i++) out[i] = simulate(P, rng);
  return out;
}
export function quantiles(sorted, ps) { const n = sorted.length; return ps.map(p => { if (!n) return NaN; const h = (n - 1) * p, lo = Math.floor(h), hi = Math.ceil(h); return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]); }); }
