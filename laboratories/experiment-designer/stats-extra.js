/* ==========================================================================
   stats-extra.js — numerics that complement /assets/js/stats.js
   (Future Food Production · statistics laboratories)

   • exact power from the noncentral t (Lenth 1989, AS 243) and noncentral F
   • Shapiro–Wilk W test (Royston 1995, AS R94 — the algorithm used by R)
   • rank tests: Mann–Whitney/Wilcoxon rank-sum, Wilcoxon signed-rank,
     Kruskal–Wallis, Friedman (exact small-sample distributions where R uses them)
   • Welch's heteroscedastic one-way ANOVA, Fisher's exact test (2×2)
   • Koenker–Breusch–Pagan test, Fisher-z CI for r, effect-size helpers
   • robust table parser (TSV/CSV/semicolon, decimal commas, quotes, NA)
   • APA-7 number formatting
   Validated against R 4.x reference values (see the Sources tab of the lab).
   ========================================================================== */
import { mean, variance, sd, lnGamma, betainc, normCdf, normInv, tCdf, tInv, fCdf, fInv, chi2Cdf, sum } from '../../assets/js/stats.js';

/* ------------------------------------------------------------ noncentral t */
/** P(T ≤ t) for noncentral t with df degrees of freedom and noncentrality delta (Lenth 1989, AS 243). */
export function pnt(t, df, delta) {
  if (!isFinite(t)) return t > 0 ? 1 : 0;
  let neg = false, tt = t, del = delta;
  if (t < 0) { neg = true; tt = -t; del = -delta; }
  const x = tt * tt / (tt * tt + df); let tnc = 0;
  if (x > 0) {
    const lambda = del * del;
    let p = 0.5 * Math.exp(-0.5 * lambda), q = Math.sqrt(2 / Math.PI) * p * del, s = 0.5 - p;
    let a = 0.5; const b = 0.5 * df; const rxb = Math.pow(1 - x, b);
    const albeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
    let xodd = betainc(x, a, b), godd = 2 * rxb * Math.exp(a * Math.log(x) - albeta), xeven = 1 - rxb, geven = b * x * rxb;
    tnc = p * xodd + q * xeven;
    for (let en = 1; en <= 5000; en++) {
      a += 1; xodd -= godd; xeven -= geven; godd *= x * (a + b - 1) / a; geven *= x * (a + b - 0.5) / (a + 0.5);
      p *= lambda / (2 * en); q *= lambda / (2 * en + 1); s -= p; tnc += p * xodd + q * xeven;
      if (2 * s * (xodd - godd) < 1e-13 && en > lambda / 2) break;
    }
  }
  tnc += normCdf(-del);
  tnc = Math.min(1, Math.max(0, tnc));
  return neg ? 1 - tnc : tnc;
}
/** Density of the noncentral t by central differences of pnt (smooth enough for drawing). */
export function dnt(t, df, delta) { const h = 1e-3 * Math.max(1, Math.abs(t)); return Math.max(0, (pnt(t + h, df, delta) - pnt(t - h, df, delta)) / (2 * h)); }

/**
 * Exact power of a t-test.
 * type 'two' — two independent groups, n per group, d = Δ/σ (pooled-variance test)
 * type 'one' — one-sample or paired test with n observations (pairs), d = Δ/σ (σ of differences for paired)
 * sides 2 (default) or 1.
 */
export function powerT(d, n, { alpha = 0.05, type = 'two', sides = 2 } = {}) {
  if (!(n >= 2)) return NaN;
  const df = type === 'two' ? 2 * n - 2 : n - 1;
  const ncp = type === 'two' ? d * Math.sqrt(n / 2) : d * Math.sqrt(n);
  if (df < 1) return NaN;
  if (sides === 1) { const tc = tInv(1 - alpha, df); return 1 - pnt(tc, df, ncp); }
  const tc = tInv(1 - alpha / 2, df);
  return 1 - pnt(tc, df, ncp) + pnt(-tc, df, ncp);
}
/** Smallest integer n in [2, max] with f(n) ≥ target, for f increasing in n (binary search). */
function smallestN(f, target, max) {
  if (f(max) < target) return Infinity;
  let lo = 2, hi = max; if (f(lo) >= target) return lo;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f(m) >= target) hi = m; else lo = m; }
  return hi;
}
export function sampleSizeT(d, power = 0.8, opts = {}) {
  if (!(Math.abs(d) > 0)) return Infinity;
  return smallestN(n => powerT(d, n, opts), power, 100000);
}
/* ------------------------------------------------------------ noncentral F */
/** P(F' ≤ f) for the noncentral F (Poisson mixture of incomplete betas). */
export function pnf(f, d1, d2, lam) {
  if (f <= 0) return 0;
  const x = d1 * f / (d1 * f + d2), mu = lam / 2;
  if (mu < 1e-12) return fCdf(f, d1, d2);
  // start summation at the Poisson mode and walk both ways for stability
  const j0 = Math.floor(mu); let s = 0;
  const w = j => Math.exp(-mu + j * Math.log(mu) - lnGamma(j + 1));
  for (let j = j0; j < j0 + 5000; j++) { const t = w(j) * betainc(x, d1 / 2 + j, d2 / 2); s += t; if (t < 1e-15 && j > j0 + 5) break; }
  for (let j = j0 - 1; j >= 0; j--) { const t = w(j) * betainc(x, d1 / 2 + j, d2 / 2); s += t; if (t < 1e-15 && j < j0 - 5) break; }
  return Math.min(1, s);
}
/** Exact power of one-way ANOVA with k groups of n, Cohen's f (λ = f²kn). */
export function powerAnova(f, k, n, alpha = 0.05) {
  const d1 = k - 1, d2 = k * (n - 1); if (d2 < 1) return NaN;
  const Fc = fInv(1 - alpha, d1, d2);
  return 1 - pnf(Fc, d1, d2, f * f * k * n);
}
export function sampleSizeAnova(f, k, power = 0.8, alpha = 0.05) {
  if (!(f > 0)) return Infinity;
  return smallestN(n => powerAnova(f, k, n, alpha), power, 20000);
}

/* ------------------------------------------------------------ Shapiro–Wilk */
const poly = (c, x) => c.reduce((s, v, i) => s + v * Math.pow(x, i), 0);
/** Shapiro–Wilk W and p-value (Royston 1995; valid for 3 ≤ n ≤ 5000). */
export function shapiroWilk(xIn) {
  const x = xIn.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const n = x.length;
  if (n < 3) return { W: NaN, p: NaN, n };
  const range = x[n - 1] - x[0]; if (range < 1e-12 * Math.max(1, Math.abs(x[0]))) return { W: NaN, p: NaN, n, constant: true };
  const nn2 = Math.floor(n / 2); const a = new Array(nn2 + 1).fill(0); // 1-based
  if (n === 3) a[1] = Math.SQRT1_2;
  else {
    const an25 = n + 0.25; const m = [0]; let summ2 = 0;
    for (let i = 1; i <= nn2; i++) { m[i] = normInv((i - 0.375) / an25); summ2 += m[i] * m[i]; }
    summ2 *= 2; const ssumm2 = Math.sqrt(summ2), rsn = 1 / Math.sqrt(n);
    const c1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056];
    const c2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
    const a1 = poly(c1, rsn) - m[1] / ssumm2;
    let i1, fac;
    if (n > 5) {
      i1 = 3; const a2 = -m[2] / ssumm2 + poly(c2, rsn);
      fac = Math.sqrt((summ2 - 2 * m[1] * m[1] - 2 * m[2] * m[2]) / (1 - 2 * a1 * a1 - 2 * a2 * a2)); a[2] = a2;
    } else { i1 = 2; fac = Math.sqrt((summ2 - 2 * m[1] * m[1]) / (1 - 2 * a1 * a1)); }
    a[1] = a1; for (let i = i1; i <= nn2; i++) a[i] = -m[i] / fac;
  }
  let num = 0; for (let i = 1; i <= nn2; i++) num += a[i] * (x[n - i] - x[i - 1]);
  const mx = mean(x); const ssq = x.reduce((s, v) => s + (v - mx) ** 2, 0);
  const W = Math.min(1, num * num / ssq);
  let p;
  if (n === 3) { p = Math.max(0, 6 / Math.PI * (Math.asin(Math.sqrt(W)) - Math.asin(Math.sqrt(0.75)))); }
  else {
    const w1 = Math.log(1 - W); const xx = Math.log(n);
    let m, s, y;
    if (n <= 11) {
      const gamma = -2.273 + 0.459 * n;
      if (w1 >= gamma) return { W, p: 1e-99, n };
      y = -Math.log(gamma - w1); m = poly([0.544, -0.39978, 0.025054, -6.714e-4], n); s = Math.exp(poly([1.3822, -0.77857, 0.062767, -0.0020322], n));
    } else { y = w1; m = poly([-1.5861, -0.31082, -0.083751, 0.0038915], xx); s = Math.exp(poly([-0.4803, -0.082676, 0.0030302], xx)); }
    p = 1 - normCdf((y - m) / s);
  }
  return { W, p, n };
}

/* ------------------------------------------------------------ ranks */
/** Mid-ranks (1-based) and tie information Σ(t³ − t). */
export function rankData(a) {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); let ties = 0, anyTie = false;
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; const t = j - i + 1; if (t > 1) { ties += t * t * t - t; anyTie = true; } i = j + 1; }
  return { r, ties, anyTie };
}
/** Distribution of the Mann–Whitney W = R₁ − m(m+1)/2 (no ties): counts[w]. */
function mwCounts(m, n) {
  // f[i][j][w] recursion → use 2-D rolling over (items, chosen)
  // choose which of the pooled positions 1..m+n belong to group 1; W = Σ (group-2 items below each group-1 item)
  const maxW = m * n, N = m + n; const dp = Array.from({ length: m + 1 }, () => new Float64Array(maxW + 1)); dp[0][0] = 1;
  for (let k = 1; k <= N; k++) {
    for (let c = Math.min(m, k); c >= 1; c--) {
      // adding element k to group 1 as its c-th member contributes (k − c) to U (number of group-2 items below it)
      const add = k - c; if (add > n) continue;
      const src = dp[c - 1], dst = dp[c];
      for (let w = maxW - add; w >= 0; w--) if (src[w]) dst[w + add] += src[w];
    }
  }
  return dp[m];
}
/** Wilcoxon rank-sum / Mann–Whitney test (two-sided), as in R's wilcox.test (exact if n<50 and no ties). */
export function mannWhitney(x, y) {
  x = x.filter(Number.isFinite); y = y.filter(Number.isFinite);
  const m = x.length, n = y.length; const { r, ties, anyTie } = rankData([...x, ...y]);
  const R1 = sum(r.slice(0, m)); const W = R1 - m * (m + 1) / 2;
  let p, exact = false, z = NaN;
  if (m < 50 && n < 50 && !anyTie) {
    const c = mwCounts(m, n); const tot = c.reduce((s, v) => s + v, 0);
    let lo = 0, hi = 0; for (let w = 0; w < c.length; w++) { if (w <= W) lo += c[w]; if (w >= W) hi += c[w]; }
    p = Math.min(1, 2 * Math.min(lo, hi) / tot); exact = true;
  } else {
    const zz = W - m * n / 2; const sig = Math.sqrt((m * n / 12) * ((m + n + 1) - ties / ((m + n) * (m + n - 1))));
    const corr = 0.5 * Math.sign(zz); z = (zz - corr) / sig; p = 2 * Math.min(normCdf(z), 1 - normCdf(z));
  }
  return { W, U: W, p, exact, z, m, n, rbc: 1 - 2 * W / (m * n) /* rank-biserial (y vs x) */ };
}
/** Wilcoxon signed-rank test on differences d (zeros dropped), two-sided, as R. */
export function wilcoxonSigned(d) {
  const nz = d.filter(v => Number.isFinite(v) && v !== 0); const zeros = d.filter(v => v === 0).length; const n = nz.length;
  if (!n) return { V: 0, p: 1, n: 0, exact: false, zeros };
  const { r, ties, anyTie } = rankData(nz.map(Math.abs)); const V = sum(r.filter((_, i) => nz[i] > 0));
  let p, exact = false, z = NaN;
  if (n < 50 && !anyTie && !zeros) {
    const maxV = n * (n + 1) / 2; const c = new Float64Array(maxV + 1); c[0] = 1;
    for (let k = 1; k <= n; k++) for (let v = maxV; v >= k; v--) c[v] += c[v - k];
    const tot = Math.pow(2, n); let lo = 0, hi = 0; for (let v = 0; v <= maxV; v++) { if (v <= V) lo += c[v]; if (v >= V) hi += c[v]; }
    p = Math.min(1, 2 * Math.min(lo, hi) / tot); exact = true;
  } else {
    const zz = V - n * (n + 1) / 4; const sig = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24 - ties / 48);
    z = (zz - 0.5 * Math.sign(zz)) / sig; p = 2 * Math.min(normCdf(z), 1 - normCdf(z));
  }
  return { V, p, n, exact, z, zeros };
}
/** Kruskal–Wallis rank-sum test (tie-corrected χ² approximation). */
export function kruskalWallis(groups) {
  groups = groups.map(g => g.filter(Number.isFinite)).filter(g => g.length);
  const all = groups.flat(), N = all.length, k = groups.length; const { r, ties } = rankData(all);
  let off = 0, s = 0; groups.forEach(g => { const Rj = sum(r.slice(off, off + g.length)); s += Rj * Rj / g.length; off += g.length; });
  const H = (12 / (N * (N + 1)) * s - 3 * (N + 1)) / (1 - ties / (N * N * N - N));
  return { H, df: k - 1, p: 1 - chi2Cdf(H, k - 1), epsilon2: H / ((N * N - 1) / (N + 1)) };
}
/** Friedman rank test for a complete block design m[block][treatment]. */
export function friedman(m) {
  const b = m.length, k = m[0].length; const R = new Array(k).fill(0); let ties = 0;
  m.forEach(row => { const q = rankData(row); q.r.forEach((v, j) => R[j] += v); ties += q.ties; });
  const Q = 12 * R.reduce((s, v) => s + (v - b * (k + 1) / 2) ** 2, 0) / (b * k * (k + 1) - ties / (k - 1));
  return { Q, df: k - 1, p: 1 - chi2Cdf(Q, k - 1), rankSums: R, W: Q / (b * (k - 1)) /* Kendall's W */ };
}
/** Welch's one-way ANOVA for unequal variances (as R oneway.test, var.equal = FALSE). */
export function welchAnova(groups) {
  groups = groups.map(g => g.filter(Number.isFinite)).filter(g => g.length > 1);
  const k = groups.length; const n = groups.map(g => g.length), m = groups.map(mean), v = groups.map(g => variance(g));
  const w = n.map((ni, i) => ni / v[i]); const sw = sum(w); const mw = sum(w.map((wi, i) => wi * m[i])) / sw;
  const tmp = sum(w.map((wi, i) => (1 - wi / sw) ** 2 / (n[i] - 1))) / (k * k - 1);
  const F = sum(w.map((wi, i) => wi * (m[i] - mw) ** 2)) / ((k - 1) * (1 + 2 * (k - 2) * tmp));
  const df1 = k - 1, df2 = 1 / (3 * tmp);
  return { F, df1, df2, p: 1 - fCdf(F, df1, df2) };
}
/** Fisher's exact test for a 2×2 table [[a,b],[c,d]] (two-sided, as R). */
export function fisherExact2x2(t) {
  const [[a, b], [c, d]] = t; const r1 = a + b, r2 = c + d, c1 = a + c, N = r1 + r2;
  const lnC = (n, k) => lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);
  const P = x => Math.exp(lnC(r1, x) + lnC(r2, c1 - x) - lnC(N, c1));
  const lo = Math.max(0, c1 - r2), hi = Math.min(r1, c1); const p0 = P(a); let p = 0;
  for (let x = lo; x <= hi; x++) { const px = P(x); if (px <= p0 * (1 + 1e-7)) p += px; }
  return { p: Math.min(1, p), oddsRatio: (a * d) / (b * c) };
}
/** Koenker (studentised) Breusch–Pagan test for heteroscedasticity in simple regression. */
export function breuschPagan(x, resid) {
  const e2 = resid.map(r => r * r); const n = x.length; const mx = mean(x), me = mean(e2);
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (e2[i] - me); sxx += (x[i] - mx) ** 2; syy += (e2[i] - me) ** 2; }
  const r2 = syy > 0 && sxx > 0 ? sxy * sxy / (sxx * syy) : 0; const LM = n * r2;
  return { LM, df: 1, p: 1 - chi2Cdf(LM, 1) };
}
/** Fisher-z confidence interval for a correlation coefficient. */
export function corrCI(r, n, level = 0.95) { if (n < 4) return [NaN, NaN]; const z = Math.atanh(Math.max(-0.999999, Math.min(0.999999, r))), se = 1 / Math.sqrt(n - 3), q = normInv(1 - (1 - level) / 2); return [Math.tanh(z - q * se), Math.tanh(z + q * se)]; }
/** Approximate CI of Cohen's d for two independent groups (Hedges & Olkin 1985). */
export function dCI(d, n1, n2, level = 0.95) { const se = Math.sqrt((n1 + n2) / (n1 * n2) + d * d / (2 * (n1 + n2))); const q = normInv(1 - (1 - level) / 2); return [d - q * se, d + q * se]; }
export const hedgesJ = df => 1 - 3 / (4 * df - 1);

/* ------------------------------------------------------------ random helpers */
/** Seeded Gaussian generator with cached second value (Marsaglia polar). */
export function gaussian(rng) { let spare = null; return () => { if (spare !== null) { const s = spare; spare = null; return s; } let u, v, s; do { u = rng() * 2 - 1; v = rng() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0); const m = Math.sqrt(-2 * Math.log(s) / s); spare = v * m; return u * m; }; }

/* ------------------------------------------------------------ table parser */
const NA = new Set(['', 'na', 'n/a', 'nan', 'null', '-', '.', '?', 'missing']);
function splitLine(line, sep) {
  if (sep === 'ws') return line.trim().split(/\s+/);
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out.map(s => s.trim());
}
/**
 * Robust parser for pasted spreadsheet data. Handles tab, semicolon, comma or whitespace separators,
 * decimal commas (Swedish/European Excel), quoted fields, NA markers and missing headers.
 * Returns { headers, rows, columns, types, sep, decimalComma, notes }.
 */
export function parseData(text) {
  const notes = [];
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() && !/^\s*(#|\/\/)/.test(l));
  if (!lines.length) return { headers: [], rows: [], columns: {}, types: {}, notes: ['No data.'] };
  const head = lines.slice(0, 6).join('\n');
  let sep = head.includes('\t') ? '\t' : null;
  if (!sep) { const sc = (head.match(/;/g) || []).length, cc = (head.match(/,/g) || []).length; sep = sc > 0 && sc >= cc / 2 ? ';' : cc > 0 ? ',' : 'ws'; }
  const raw = lines.map(l => splitLine(l, sep));
  const decimalComma = sep !== ',' && raw.some(r => r.some(c => /^[-+−]?\d+,\d+$/.test(c)));
  const toNum = c => {
    let s = String(c).trim().replace(/^[−–]/, '-');
    if (NA.has(s.toLowerCase())) return null;
    if (decimalComma) s = s.replace(/\s/g, '').replace(',', '.');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return undefined;
    return Number(s);
  };
  const isNum = c => { const v = toNum(c); return typeof v === 'number'; };
  // header detection: first row has a non-numeric cell in a column that is mostly numeric below, or all first-row cells are non-numeric
  const first = raw[0], rest = raw.slice(1);
  let hasHeader = false;
  if (rest.length) {
    for (let j = 0; j < first.length; j++) {
      const below = rest.map(r => r[j]).filter(c => c != null && toNum(c) !== null);
      const numShare = below.length ? below.filter(isNum).length / below.length : 0;
      if (!isNum(first[j]) && toNum(first[j]) !== null && numShare > 0.6) { hasHeader = true; break; }
    }
    if (!hasHeader && first.every(c => !isNum(c)) && rest.some(r => r.some(isNum))) {
      // text-only first row followed by rows with numbers: header only if the first row's words are unique
      hasHeader = new Set(first).size === first.length && rest.every(r => !r.every((c, j) => c === first[j]));
      // but a pure categorical table (all text) needs headers too — assume header if values repeat below
    }
    if (!hasHeader && first.every(c => !isNum(c)) && rest.every(r => r.every(c => !isNum(c)))) hasHeader = true;
  }
  const width = Math.max(...raw.map(r => r.length));
  let headers = hasHeader ? first.slice() : Array.from({ length: width }, (_, j) => 'col' + (j + 1));
  while (headers.length < width) headers.push('col' + (headers.length + 1));
  headers = headers.map((h, j) => h || 'col' + (j + 1));
  const seen = {}; headers = headers.map(h => { if (seen[h]) { seen[h]++; return h + '_' + seen[h]; } seen[h] = 1; return h; });
  const body = (hasHeader ? rest : raw).filter(r => r.some(c => c !== ''));
  const types = {}, columns = {};
  headers.forEach((h, j) => {
    const vals = body.map(r => r[j] ?? '');
    const nonNA = vals.filter(c => toNum(c) !== null);
    const nNum = nonNA.filter(isNum).length;
    const numeric = nonNA.length > 0 && nNum / nonNA.length >= 0.8;
    types[h] = numeric ? 'number' : 'text';
    columns[h] = vals.map(c => { const v = toNum(c); if (numeric) return typeof v === 'number' ? v : NaN; return v === null ? null : String(c); });
    if (numeric && nNum < nonNA.length) notes.push(`${nonNA.length - nNum} non-numeric value(s) in “${h}” treated as missing.`);
  });
  const rows = body.map((_, i) => headers.map(h => columns[h][i]));
  if (decimalComma) notes.push('Decimal commas detected and converted.');
  if (!hasHeader) notes.push('No header row detected: columns named col1, col2, …');
  return { headers, rows, columns, types, sep, decimalComma, hasHeader, notes };
}

/* ------------------------------------------------------------ APA formatting */
const MINUS = '−';
/** Number with fixed decimals and a proper minus sign. */
export function num(v, d = 2) { if (v == null || !isFinite(v)) return '—'; const s = Math.abs(v).toFixed(d); return (v < 0 && +s !== 0 ? MINUS : '') + s; }
/** Without leading zero (APA: statistics that cannot exceed 1, e.g. p, r, η²). */
export function nlz(v, d = 2) { const s = num(v, d); return s.replace(/^(−?)0\./, '$1.'); }
/** APA p-value string: "p = .034", "p < .001". */
export function apaP(p) { if (!isFinite(p)) return 'p = —'; if (p < 0.001) return 'p < .001'; if (p > 0.999) return 'p > .999'; return 'p = ' + nlz(p, 3); }
/** Sensible number of decimals for a mean given its SD. */
export function decimalsFor(sdv) { if (!isFinite(sdv) || sdv <= 0) return 2; return Math.max(0, Math.min(4, 2 - Math.floor(Math.log10(sdv)))); }
/** Degrees of freedom: integer if integral, else one decimal. */
export function dfs(df) { return Math.abs(df - Math.round(df)) < 1e-9 ? String(Math.round(df)) : df.toFixed(1); }
export { mean, variance, sd };
