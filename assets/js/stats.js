/* ==========================================================================
   stats.js — statistics for the course laboratories (ES module)
   Descriptives, distributions (normal, t, F, χ², binomial, studentised range),
   t-tests, ANOVA (one-way, randomised block), Tukey HSD, Brown–Forsythe,
   regression (simple, multiple), Levenberg–Marquardt curve fitting, power,
   Cronbach's α, seeded random numbers.
   All p-values are two-sided unless stated otherwise.
   ========================================================================== */

/* ------------------------------------------------------------ descriptives */
export const sum = a => a.reduce((s, v) => s + v, 0);
export const mean = a => a.length ? sum(a) / a.length : NaN;
export function variance(a, sample = true) { const n = a.length; if (n < (sample ? 2 : 1)) return NaN; const m = mean(a); return a.reduce((s, v) => s + (v - m) ** 2, 0) / (n - (sample ? 1 : 0)); }
export const sd = (a, sample = true) => Math.sqrt(variance(a, sample));
export const se = a => sd(a) / Math.sqrt(a.length);
export function quantile(a, p) { // Hyndman & Fan type 7 (R default, Excel PERCENTILE.INC)
  const s = [...a].sort((x, y) => x - y); const n = s.length; if (!n) return NaN;
  const h = (n - 1) * p; const lo = Math.floor(h), hi = Math.ceil(h);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}
export const median = a => quantile(a, 0.5);
export function skewness(a) { const n = a.length, m = mean(a), s = sd(a, false); return a.reduce((t, v) => t + ((v - m) / s) ** 3, 0) / n; }
export function kurtosis(a) { const n = a.length, m = mean(a), s = sd(a, false); return a.reduce((t, v) => t + ((v - m) / s) ** 4, 0) / n - 3; }
export function describe(a) {
  a = a.filter(Number.isFinite);
  const n = a.length, m = mean(a), s = sd(a);
  const tc = n > 1 ? tInv(0.975, n - 1) : NaN;
  return { n, mean: m, sd: s, se: s / Math.sqrt(n), cv: s / m, min: Math.min(...a), q1: quantile(a, .25), median: median(a), q3: quantile(a, .75), max: Math.max(...a), iqr: quantile(a, .75) - quantile(a, .25), ci95: [m - tc * s / Math.sqrt(n), m + tc * s / Math.sqrt(n)], skew: skewness(a), kurt: kurtosis(a) };
}
export function histogram(a, bins = 10, lo, hi) {
  lo = lo ?? Math.min(...a); hi = hi ?? Math.max(...a); if (hi === lo) hi = lo + 1;
  const w = (hi - lo) / bins, counts = new Array(bins).fill(0), edges = [];
  for (let i = 0; i <= bins; i++) edges.push(lo + i * w);
  a.forEach(v => { let k = Math.floor((v - lo) / w); if (k === bins) k--; if (k >= 0 && k < bins) counts[k]++; });
  return { edges, counts, width: w, centers: edges.slice(0, -1).map(e => e + w / 2) };
}
export function qqData(a) { const s = [...a].sort((x, y) => x - y); const n = s.length; return s.map((v, i) => [normInv((i + 1 - 0.375) / (n + 0.25)), v]); } // Blom plotting positions

/* ------------------------------------------------------------ special fns */
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
export function lnGamma(z) {
  if (z < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z))) - lnGamma(1 - z);
  z -= 1; let x = LANCZOS[0]; for (let i = 1; i < 9; i++) x += LANCZOS[i] / (z + i);
  const t = z + 7.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
export const gammaFn = z => Math.exp(lnGamma(z));
function betacf(a, b, x) {
  const MAXIT = 300, EPS = 3e-16, FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
/** Regularised incomplete beta I_x(a,b). */
export function betainc(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
/** Regularised lower incomplete gamma P(a,x). */
export function gammainc(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) { let ap = a, s = 1 / a, del = s; for (let n = 0; n < 500; n++) { ap++; del *= x / ap; s += del; if (Math.abs(del) < Math.abs(s) * 1e-15) break; } return s * Math.exp(-x + a * Math.log(x) - lnGamma(a)); }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-15) break; }
  return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}
export function erf(x) { // W. J. Cody-grade via incomplete gamma
  return x >= 0 ? gammainc(0.5, x * x) : -gammainc(0.5, x * x);
}

/* ------------------------------------------------------------ distributions */
export const normPdf = (x, m = 0, s = 1) => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
/** Standard normal CDF by Hart's (1968) double-precision algorithm as given by West (2005, Wilmott Magazine):
 *  |error| < 1e-15 everywhere and accurate relative tails, ~15x faster than the incomplete-gamma route. */
function phiHart(x) {
  const z = Math.abs(x); let c;
  if (z > 37) c = 0;
  else {
    const e = Math.exp(-z * z / 2);
    if (z < 7.07106781186547) {
      let n = 3.52624965998911e-2 * z + 0.700383064443688; n = n * z + 6.37396220353165; n = n * z + 33.912866078383; n = n * z + 112.079291497871; n = n * z + 221.213596169931; n = n * z + 220.206867912376;
      let d = 8.83883476483184e-2 * z + 1.75566716318264; d = d * z + 16.064177579207; d = d * z + 86.7807322029461; d = d * z + 296.564248779674; d = d * z + 637.333633378831; d = d * z + 793.826512519948; d = d * z + 440.413735824752;
      c = e * n / d;
    } else { let f = z + 0.65; f = z + 4 / f; f = z + 3 / f; f = z + 2 / f; f = z + 1 / f; c = e / f / 2.506628274631; }
  }
  return x > 0 ? 1 - c : c;
}
export const normCdf = (x, m = 0, s = 1) => phiHart((x - m) / s);
export function normInv(p, m = 0, s = 1) { // Acklam + one Halley refinement
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425; let q, r, x;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p <= 1 - pl) { q = p - 0.5; r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  else { q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const e = normCdf(x) - p; const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2); x = x - u / (1 + x * u / 2);
  return m + s * x;
}
export function tPdf(t, df) { return Math.exp(lnGamma((df + 1) / 2) - lnGamma(df / 2)) / Math.sqrt(df * Math.PI) * Math.pow(1 + t * t / df, -(df + 1) / 2); }
export function tCdf(t, df) { if (!isFinite(df) || df > 1e7) return normCdf(t); const x = df / (df + t * t); const p = 0.5 * betainc(x, df / 2, 0.5); return t > 0 ? 1 - p : p; }
export function tInv(p, df) {
  if (!isFinite(df) || df > 1e7) return normInv(p);
  let lo = -1e3, hi = 1e3;
  let x = normInv(p);
  for (let i = 0; i < 100; i++) { const f = tCdf(x, df) - p; if (Math.abs(f) < 1e-12) break; const d = tPdf(x, df); let nx = x - f / d; if (!isFinite(nx) || nx < lo || nx > hi) nx = (lo + hi) / 2; if (f > 0) hi = x; else lo = x; x = nx; }
  return x;
}
export function fCdf(x, d1, d2) { if (x <= 0) return 0; return betainc(d1 * x / (d1 * x + d2), d1 / 2, d2 / 2); }
export function fPdf(x, d1, d2) { if (x <= 0) return 0; return Math.exp(0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * x + d2)) - Math.log(x) - (lnGamma(d1 / 2) + lnGamma(d2 / 2) - lnGamma((d1 + d2) / 2))); }
export function fInv(p, d1, d2) { let lo = 0, hi = 1e4; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (fCdf(m, d1, d2) < p) lo = m; else hi = m; } return (lo + hi) / 2; }
export function chi2Cdf(x, k) { return x <= 0 ? 0 : gammainc(k / 2, x / 2); }
export function chi2Pdf(x, k) { return x <= 0 ? 0 : Math.exp((k / 2 - 1) * Math.log(x) - x / 2 - (k / 2) * Math.LN2 - lnGamma(k / 2)); }
export function chi2Inv(p, k) { let lo = 0, hi = Math.max(100, k * 10); for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (chi2Cdf(m, k) < p) lo = m; else hi = m; } return (lo + hi) / 2; }
export function lnChoose(n, k) { return lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1); }
export function binomPmf(k, n, p) { if (k < 0 || k > n) return 0; if (p === 0) return k === 0 ? 1 : 0; if (p === 1) return k === n ? 1 : 0; return Math.exp(lnChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p)); }
export function binomCdf(k, n, p) { let s = 0; for (let i = 0; i <= k; i++) s += binomPmf(i, n, p); return Math.min(1, s); }
/** P(X ≥ k) for X ~ Bin(n, p). */
export function binomUpper(k, n, p) { let s = 0; for (let i = Math.max(0, k); i <= n; i++) s += binomPmf(i, n, p); return Math.min(1, s); }
/** Smallest k with P(X ≥ k) ≤ alpha — critical number of correct answers in discrimination tests. */
export function binomCritical(n, p0, alpha = 0.05) { for (let k = 0; k <= n; k++) if (binomUpper(k, n, p0) <= alpha) return k; return n + 1; }

/* Studentised range distribution (Tukey). Numerical integration.
   P(Q ≤ q | k groups, df) = ∫ f_s(s) · P∞(q·s) ds,   P∞(w) = k ∫ φ(z)[Φ(z) − Φ(z − w)]^{k−1} dz */
function ptukeyInf(w, k) {
  if (w <= 0) return 0;
  const n = 160, a = -8, b = 8, h = (b - a) / n; let s = 0;
  for (let i = 0; i <= n; i++) { const z = a + i * h; const f = normPdf(z) * Math.pow(normCdf(z) - normCdf(z - w), k - 1); s += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * f; }
  return Math.min(1, k * s * h / 3);
}
export function ptukey(q, k, df) {
  if (q <= 0) return 0;
  if (!isFinite(df) || df > 5000) return ptukeyInf(q, k);
  const lnC = (df / 2) * Math.log(df) - lnGamma(df / 2) - (df / 2 - 1) * Math.LN2;
  const sd_ = 1 / Math.sqrt(2 * df);
  const lo = Math.max(1e-6, 1 - 8 * sd_), hi = 1 + 10 * sd_ + (df < 5 ? 3 : 0);
  const n = 120, h = (hi - lo) / n; let s = 0;
  for (let i = 0; i <= n; i++) {
    const x = lo + i * h;
    const f = Math.exp(lnC + (df - 1) * Math.log(x) - df * x * x / 2) * ptukeyInf(q * x, k);
    s += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * f;
  }
  return Math.min(1, Math.max(0, s * h / 3));
}
/** Quantile of the studentised range: bracket, then Illinois (modified regula falsi) — ~8 ptukey calls instead of 60. */
export function qtukey(p, k, df) {
  if (!(p > 0)) return 0; if (p >= 1) return Infinity;
  const f = q => ptukey(q, k, df) - p;
  let a = 0, fa = -p, b = 4, fb = f(b);
  while (fb < 0 && b < 1e4) { a = b; fa = fb; b *= 2; fb = f(b); }
  let side = 0, c = b, prev = NaN;
  for (let i = 0; i < 80; i++) {
    c = (a * fb - b * fa) / (fb - fa); const fc = f(c);
    if (fc === 0 || Math.abs(c - prev) < 1e-9 * Math.max(1, c)) return c;
    prev = c;
    if (fc > 0) { b = c; fb = fc; if (side === -1) fa /= 2; side = -1; }
    else { a = c; fa = fc; if (side === 1) fb /= 2; side = 1; }
  }
  return c;
}

/* ------------------------------------------------------------ tests */
function tResult(t, df, diff, seDiff, extra = {}) {
  const p = 2 * (1 - tCdf(Math.abs(t), df)); const tc = tInv(0.975, df);
  return Object.assign({ t, df, p, diff, se: seDiff, ci95: [diff - tc * seDiff, diff + tc * seDiff], tCrit: tc }, extra);
}
export function tTestOne(a, mu = 0) { const n = a.length, m = mean(a), s = sd(a); return tResult((m - mu) / (s / Math.sqrt(n)), n - 1, m - mu, s / Math.sqrt(n), { d: (m - mu) / s }); }
export function tTestPaired(a, b) { return tTestOne(a.map((v, i) => v - b[i]), 0); }
export function tTestWelch(a, b) {
  const n1 = a.length, n2 = b.length, v1 = variance(a), v2 = variance(b);
  const seD = Math.sqrt(v1 / n1 + v2 / n2); const df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
  const sp = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
  return tResult((mean(a) - mean(b)) / seD, df, mean(a) - mean(b), seD, { d: (mean(a) - mean(b)) / sp, welch: true });
}
export function tTestPooled(a, b) {
  const n1 = a.length, n2 = b.length; const sp2 = ((n1 - 1) * variance(a) + (n2 - 1) * variance(b)) / (n1 + n2 - 2);
  const seD = Math.sqrt(sp2 * (1 / n1 + 1 / n2));
  return tResult((mean(a) - mean(b)) / seD, n1 + n2 - 2, mean(a) - mean(b), seD, { d: (mean(a) - mean(b)) / Math.sqrt(sp2), sp: Math.sqrt(sp2) });
}
/** One-way ANOVA. groups: array of arrays. */
export function anova1(groups) {
  groups = groups.map(g => g.filter(Number.isFinite)).filter(g => g.length);
  const all = groups.flat(); const N = all.length, k = groups.length, gm = mean(all);
  const means = groups.map(mean), ns = groups.map(g => g.length);
  const ssb = groups.reduce((s, g, i) => s + ns[i] * (means[i] - gm) ** 2, 0);
  const ssw = groups.reduce((s, g, i) => s + g.reduce((t, v) => t + (v - means[i]) ** 2, 0), 0);
  const df1 = k - 1, df2 = N - k, msb = ssb / df1, msw = ssw / df2, F = msb / msw;
  return { F, df1, df2, p: 1 - fCdf(F, df1, df2), ssb, ssw, sst: ssb + ssw, msb, msw, eta2: ssb / (ssb + ssw), means, ns, grandMean: gm, k, N };
}
/** Tukey HSD pairwise comparisons after one-way ANOVA (Tukey–Kramer for unequal n). */
export function tukeyHSD(groups, names) {
  const A = anova1(groups); const qc = qtukey(0.95, A.k, A.df2); const out = [];
  for (let i = 0; i < A.k; i++) for (let j = i + 1; j < A.k; j++) {
    const diff = A.means[j] - A.means[i]; const seP = Math.sqrt(A.msw / 2 * (1 / A.ns[i] + 1 / A.ns[j]));
    const q = Math.abs(diff) / seP;
    out.push({ a: names ? names[i] : i, b: names ? names[j] : j, diff, lwr: diff - qc * seP, upr: diff + qc * seP, q, p: 1 - ptukey(q, A.k, A.df2) });
  }
  return { anova: A, qCrit: qc, pairs: out };
}
/** Tukey HSD after a randomised complete block ANOVA (panellists/shelves as blocks). m[block][treatment]. */
export function tukeyRCBD(m, names) {
  const A = anovaRCBD(m), b = m.length, t = m[0].length, dfe = A.error.df;
  const seP = Math.sqrt(A.error.ms / b), qc = qtukey(0.95, t, dfe), out = [];
  for (let i = 0; i < t; i++) for (let j = i + 1; j < t; j++) {
    const diff = A.tMeans[j] - A.tMeans[i], q = Math.abs(diff) / seP;
    out.push({ a: names ? names[i] : i, b: names ? names[j] : j, diff, lwr: diff - qc * seP, upr: diff + qc * seP, q, p: 1 - ptukey(q, t, dfe) });
  }
  return { anova: A, qCrit: qc, pairs: out };
}
/** Randomised complete block ANOVA (two-way without interaction). m[block][treatment]. */
export function anovaRCBD(m) {
  const b = m.length, t = m[0].length, all = m.flat(), N = all.length, gm = mean(all);
  const tMeans = Array.from({ length: t }, (_, j) => mean(m.map(r => r[j])));
  const bMeans = m.map(r => mean(r));
  const sst = all.reduce((s, v) => s + (v - gm) ** 2, 0);
  const sstr = b * tMeans.reduce((s, v) => s + (v - gm) ** 2, 0);
  const ssb = t * bMeans.reduce((s, v) => s + (v - gm) ** 2, 0);
  const sse = sst - sstr - ssb; const dft = t - 1, dfb = b - 1, dfe = dft * dfb;
  const mst = sstr / dft, msb = ssb / dfb, mse = sse / dfe;
  return { treatment: { ss: sstr, df: dft, ms: mst, F: mst / mse, p: 1 - fCdf(mst / mse, dft, dfe) }, block: { ss: ssb, df: dfb, ms: msb, F: msb / mse, p: 1 - fCdf(msb / mse, dfb, dfe) }, error: { ss: sse, df: dfe, ms: mse }, total: { ss: sst, df: N - 1 }, tMeans, bMeans, grandMean: gm };
}
/** Brown–Forsythe (median-centred Levene) test for equal variances. */
export function leveneBF(groups) { const z = groups.map(g => { const md = median(g); return g.map(v => Math.abs(v - md)); }); const A = anova1(z); return { F: A.F, df1: A.df1, df2: A.df2, p: A.p }; }
/** One-sided exact binomial test P(X ≥ k | n, p0). */
export function binomTest(k, n, p0) { return { k, n, p0, pOneSided: binomUpper(k, n, p0), prop: k / n }; }
export function chiSquareTest(obs) {
  const r = obs.length, c = obs[0].length, rs = obs.map(sum), cs = obs[0].map((_, j) => sum(obs.map(row => row[j]))), N = sum(rs);
  let x2 = 0; const exp = obs.map((row, i) => row.map((v, j) => { const e = rs[i] * cs[j] / N; x2 += (v - e) ** 2 / e; return e; }));
  const df = (r - 1) * (c - 1); return { chi2: x2, df, p: 1 - chi2Cdf(x2, df), expected: exp };
}

/* ------------------------------------------------------------ correlation & regression */
export function pearson(x, y) {
  const n = x.length, mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  const r = sxy / Math.sqrt(sxx * syy); const t = r * Math.sqrt((n - 2) / (1 - r * r));
  return { r, r2: r * r, t, df: n - 2, p: 2 * (1 - tCdf(Math.abs(t), n - 2)), n };
}
function ranks(a) { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; }
export function spearman(x, y) { return pearson(ranks(x), ranks(y)); }
/** Simple linear regression y = a + b x with inference. */
export function linreg(x, y) {
  const n = x.length, mx = mean(x), my = mean(y);
  let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); }
  const b = sxy / sxx, a = my - b * mx;
  const fitted = x.map(v => a + b * v), resid = y.map((v, i) => v - fitted[i]);
  const sse = sum(resid.map(r => r * r)), sst = sum(y.map(v => (v - my) ** 2)), df = n - 2;
  const s = Math.sqrt(sse / df), seB = s / Math.sqrt(sxx), seA = s * Math.sqrt(1 / n + mx * mx / sxx);
  const tc = tInv(0.975, df);
  return {
    intercept: a, slope: b, r2: 1 - sse / sst, r: Math.sign(b) * Math.sqrt(Math.max(0, 1 - sse / sst)), n, df, s, sse, sst,
    seSlope: seB, seIntercept: seA, tSlope: b / seB, pSlope: 2 * (1 - tCdf(Math.abs(b / seB), df)),
    ciSlope: [b - tc * seB, b + tc * seB], ciIntercept: [a - tc * seA, a + tc * seA],
    fitted, residuals: resid, rmse: Math.sqrt(sse / n),
    predict: v => a + b * v,
    ciMean: v => { const h = tc * s * Math.sqrt(1 / n + (v - mx) ** 2 / sxx); return [a + b * v - h, a + b * v + h]; },
    piObs: v => { const h = tc * s * Math.sqrt(1 + 1 / n + (v - mx) ** 2 / sxx); return [a + b * v - h, a + b * v + h]; }
  };
}
/* small dense linear algebra */
export function matInv(A) {
  const n = A.length, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null; [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c]; for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map(r => r.slice(n));
}
export const matMul = (A, B) => A.map(r => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
export const transpose = A => A[0].map((_, j) => A.map(r => r[j]));
/** Ordinary least squares. X: rows of predictors (without intercept column); adds intercept by default. */
export function ols(X, y, { intercept = true } = {}) {
  const Xd = X.map(r => intercept ? [1, ...r] : [...r]); const n = Xd.length, p = Xd[0].length;
  const Xt = transpose(Xd); const XtXi = matInv(matMul(Xt, Xd)); if (!XtXi) return null;
  const beta = matMul(XtXi, matMul(Xt, y.map(v => [v]))).map(r => r[0]);
  const fitted = Xd.map(r => r.reduce((s, v, k) => s + v * beta[k], 0)); const resid = y.map((v, i) => v - fitted[i]);
  const sse = sum(resid.map(r => r * r)), my = mean(y), sst = sum(y.map(v => (v - my) ** 2)); const df = n - p; const s2 = sse / df;
  const seB = XtXi.map((r, i) => Math.sqrt(s2 * r[i])); const t = beta.map((b, i) => b / seB[i]);
  return { beta, se: seB, t, p: t.map(v => 2 * (1 - tCdf(Math.abs(v), df))), r2: 1 - sse / sst, adjR2: 1 - (sse / df) / (sst / (n - 1)), fitted, residuals: resid, df, sse, rmse: Math.sqrt(sse / n), n, k: p };
}

/* ------------------------------------------------------------ nonlinear fitting */
/**
 * Levenberg–Marquardt least squares.
 * model(x, params) → y.  Returns { params, se, sse, rmse, r2, aic, aicc, bic, converged, iterations, predict }.
 */
export function fitLM(model, xs, ys, p0, { maxIter = 200, tol = 1e-10, lambda = 1e-3, bounds } = {}) {
  let p = [...p0]; const n = xs.length, k = p.length;
  const resid = pp => ys.map((y, i) => y - model(xs[i], pp));
  const sseOf = r => r.reduce((s, v) => s + v * v, 0);
  const clampP = pp => bounds ? pp.map((v, i) => Math.min(bounds[i]?.[1] ?? Infinity, Math.max(bounds[i]?.[0] ?? -Infinity, v))) : pp;
  let r = resid(p), sse = sseOf(r), it = 0, converged = false, stalled = false, J;
  const jac = pp => xs.map(x => pp.map((v, j) => { const h = Math.max(1e-8, Math.abs(v) * 1e-6); const a = [...pp], b = [...pp]; a[j] += h; b[j] -= h; return (model(x, a) - model(x, b)) / (2 * h); }));
  for (; it < maxIter; it++) {
    J = jac(p);
    const JtJ = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => J.reduce((s, row) => s + row[i] * row[j], 0)));
    const Jtr = Array.from({ length: k }, (_, i) => J.reduce((s, row, q) => s + row[i] * r[q], 0));
    let improved = false;
    for (let tries = 0; tries < 20; tries++) {
      const A = JtJ.map((row, i) => row.map((v, j) => i === j ? v * (1 + lambda) + 1e-12 : v));
      const Ai = matInv(A); if (!Ai) { lambda *= 10; continue; }
      const dp = Ai.map(row => row.reduce((s, v, j) => s + v * Jtr[j], 0));
      const pn = clampP(p.map((v, i) => v + dp[i])); const rn = resid(pn); const sn = sseOf(rn);
      if (isFinite(sn) && sn < sse) {
        const rel = (sse - sn) / Math.max(sse, 1e-300);
        p = pn; r = rn; sse = sn; lambda = Math.max(lambda / 10, 1e-12); improved = true;
        if (rel < tol) converged = true; break;
      }
      lambda *= 10;
    }
    // no downhill step even with a huge damping factor: a (local) minimum, or stuck against a bound
    if (!improved) { stalled = true; converged = true; break; }
    if (converged) break;
  }
  J = jac(p);
  const JtJ = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => J.reduce((s, row) => s + row[i] * row[j], 0)));
  const cov = matInv(JtJ); const s2 = sse / Math.max(1, n - k);
  const my = mean(ys), sst = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  const atBound = bounds ? p.map((v, i) => v === bounds[i]?.[0] || v === bounds[i]?.[1]) : p.map(() => false);
  return {
    params: p, se: cov ? cov.map((row, i) => Math.sqrt(Math.max(0, row[i] * s2))) : p.map(() => NaN),
    sse, rmse: Math.sqrt(sse / n), r2: 1 - sse / sst, n, k, aic: aic(n, sse, k), aicc: aicc(n, sse, k), bic: bic(n, sse, k),
    converged, stalled, atBound, status: converged && !stalled ? 'tolerance' : stalled ? (atBound.some(Boolean) ? 'at-bound' : 'stalled') : 'max-iterations',
    iterations: it, residuals: r, predict: x => model(x, p)
  };
}
/** Akaike information criterion for least-squares fits (Gaussian errors), k = number of fitted parameters;
 *  the error variance counts as one more estimated parameter, hence k + 1. */
export const aic = (n, sse, k) => n * Math.log(sse / n) + 2 * (k + 1);
export const aicc = (n, sse, k) => aic(n, sse, k) + (2 * (k + 1) * (k + 2)) / Math.max(1, n - k - 2);
/** Bayesian (Schwarz) information criterion, same parameter count as aic(). */
export const bic = (n, sse, k) => n * Math.log(sse / n) + (k + 1) * Math.log(n);

/**
 * Cross-validation for a fit function: fitFn(xTrain, yTrain) → predict(x).
 * crossValidate(xs, ys, fitFn, 5)                         random 5-fold (as before; rng optional 5th argument)
 * crossValidate(xs, ys, fitFn, { k: 5, mode: 'ordered' }) contiguous blocks in the given order (time series)
 * crossValidate(xs, ys, fitFn, { groups: plantIds })      leave-one-group-out (e.g. leave one plant out)
 * Returns { rmse, mse, foldRmse: [...] }.
 */
export function crossValidate(xs, ys, fitFn, folds = 5, rng = Math.random) {
  const o = typeof folds === 'object' && folds ? folds : { k: folds, rng };
  const n = xs.length, R = o.rng || rng;
  let sets;
  if (o.groups) { const keys = [...new Set(o.groups)]; sets = keys.map(g => xs.map((_, i) => i).filter(i => o.groups[i] === g)); }
  else if (o.mode === 'ordered') { const k = Math.min(o.k || 5, n); sets = Array.from({ length: k }, (_, f) => xs.map((_, i) => i).filter(i => Math.floor(i * k / n) === f)); }
  else { const k = Math.min(o.k || 5, n); const idx = shuffle(xs.map((_, i) => i), R); sets = Array.from({ length: k }, (_, f) => idx.filter((_, j) => j % k === f)); }
  const errs = [], foldRmse = [];
  for (const test of sets) {
    if (!test.length) continue;
    const inTest = new Set(test), train = xs.map((_, i) => i).filter(i => !inTest.has(i));
    const pred = fitFn(train.map(i => xs[i]), train.map(i => ys[i]));
    const fe = test.map(i => (ys[i] - pred(xs[i])) ** 2); errs.push(...fe); foldRmse.push(Math.sqrt(mean(fe)));
  }
  return { rmse: Math.sqrt(mean(errs)), mse: mean(errs), foldRmse };
}

/* ------------------------------------------------------------ power */
/** Approximate power of a two-sided two-sample t-test (n per group, Cohen's d). Shifted-t approximation. */
export function powerTwoSample(d, n, alpha = 0.05) {
  // exact: T' = (Z + δ)/S with S = √(V/df), V ~ χ²(df) → power = ∫ [1 − Φ(t_c s − δ) + Φ(−t_c s − δ)] f_S(s) ds
  const df = 2 * n - 2, tc = tInv(1 - alpha / 2, df), delta = d * Math.sqrt(n / 2);
  if (!(df > 0)) return NaN;
  const lnC = Math.log(2) + (df / 2) * Math.log(df / 2) - lnGamma(df / 2);   // f_S(s) = 2(df/2)^{df/2} s^{df−1} e^{−df s²/2} / Γ(df/2)
  const sd = 1 / Math.sqrt(2 * df), lo = Math.max(1e-9, 1 - 9 * sd - (df < 6 ? 0.6 : 0)), hi = 1 + 12 * sd + (df < 6 ? 2.5 : 0);
  const N = 400, h = (hi - lo) / N; let s = 0;
  for (let i = 0; i <= N; i++) {
    const x = lo + i * h, f = Math.exp(lnC + (df - 1) * Math.log(x) - df * x * x / 2);
    s += (i === 0 || i === N ? 1 : i % 2 ? 4 : 2) * f * (1 - normCdf(tc * x - delta) + normCdf(-tc * x - delta));
  }
  return Math.min(1, Math.max(0, s * h / 3));
}
export function sampleSizeTwoSample(d, power = 0.8, alpha = 0.05) { for (let n = 2; n < 100000; n++) if (powerTwoSample(d, n, alpha) >= power) return n; return Infinity; }
/** Power of a one-way ANOVA with k groups, n per group, Cohen's f (noncentral F by simulation-free approximation). */
export function powerAnova(f, k, n, alpha = 0.05) {
  const df1 = k - 1, df2 = k * (n - 1), lam = f * f * k * n, Fc = fInv(1 - alpha, df1, df2);
  // Patnaik approximation of noncentral F by a scaled central F
  const a = (df1 + lam) / df1, nu = (df1 + lam) ** 2 / (df1 + 2 * lam);
  return 1 - fCdf(Fc / a, nu, df2);
}

/* ------------------------------------------------------------ scales & misc */
/** Cronbach's alpha. rows = respondents, cols = items. */
export function cronbachAlpha(rows) {
  const k = rows[0].length; const itemVar = Array.from({ length: k }, (_, j) => variance(rows.map(r => r[j])));
  const totVar = variance(rows.map(r => sum(r)));
  return (k / (k - 1)) * (1 - sum(itemVar) / totVar);
}
export function movingAverage(a, w) { const out = []; let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= w) s -= a[i - w]; out.push(i >= w - 1 ? s / w : NaN); } return out; }
export function ema(a, alpha) { const out = []; let s = a[0]; for (const v of a) { s = alpha * v + (1 - alpha) * s; out.push(s); } return out; }
export function classificationMetrics(tp, fp, tn, fn) {
  const acc = (tp + tn) / (tp + fp + tn + fn), prec = tp / (tp + fp), rec = tp / (tp + fn), spec = tn / (tn + fp);
  return { accuracy: acc, precision: prec, recall: rec, specificity: spec, f1: 2 * prec * rec / (prec + rec) };
}

/* ------------------------------------------------------------ random */
/** Seeded PRNG (mulberry32). const rng = mulberry32(42); rng() → [0,1) */
export function mulberry32(seed) { let a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function randn(rng = Math.random) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
export function shuffle(a, rng = Math.random) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export const randInt = (lo, hi, rng = Math.random) => lo + Math.floor(rng() * (hi - lo + 1));

/** Parse pasted tabular text (CSV/TSV/semicolon, decimal comma tolerated). Returns { headers, rows (numbers|strings), columns }. */
export function parseTable(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [], columns: {} };
  const sep = lines[0].includes('\t') ? '\t' : (lines[0].split(';').length > lines[0].split(',').length ? ';' : ',');
  // RFC 4180-style fields: "a, b" keeps its separator, "" is an escaped quote
  const split = l => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"' && !cur.trim()) { q = true; cur = ''; }
      else if (ch === sep) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim()); return out;
  };
  let headers = split(lines[0]);
  const num = s => { const t = sep === ';' ? s.replace(',', '.') : s; const v = Number(t); return t !== '' && isFinite(v) ? v : s; };
  const hasHeader = headers.some(h => typeof num(h) === 'string');
  const body = (hasHeader ? lines.slice(1) : lines).map(l => split(l).map(num));
  if (!hasHeader) headers = headers.map((_, i) => 'col' + (i + 1));
  const columns = {}; headers.forEach((h, j) => columns[h] = body.map(r => r[j]));
  return { headers, rows: body, columns };
}
