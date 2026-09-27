/* ==========================================================================
   sensory-core.js — shared model code for the Module 13 sensory laboratories
   (sensory booth, triangle test, hedonic analyser; the project's sensory-designer
   tool reads the same localStorage record).

   • Serving-order designs: Williams (1949) carry-over-balanced Latin squares for
     rating tests; the six balanced triangle arrangements of ISO 4120:2021 (7.1);
     AB/BA for paired preference.
   • Random three-digit blinding codes (ISO 4120:2021, 5.5) without "meaningful"
     numbers (same lesson rule as /lessons/sensory-methods/, Figure 10).
   • Thurstonian psychometric functions (Ennis, 1993; Brockhoff & Christensen,
     2010) evaluated by Simpson integration, and their inverses (d′).
   • Exact binomial helpers, Clopper–Pearson interval.
   • The project data format, localStorage key 'ffp-sensory-v1':
       { version: 1,
         design: { test: 'hedonic'|'triangle'|'preference',
                   samples: [{ code, label }],      // product codes 'A', 'B', … + names
                   panellists: n,
                   orders: [[code, …], …],          // per panellist, product codes in serving order
                   // optional extensions written by the booth lab:
                   blindCodes: [[583, 214, 796], …], // three-digit codes in serving order
                   created, source, seed },
         responses: [ { panellist, sample, score }   // hedonic (score 1–9) or preference (score 1 = preferred)
                    | { panellist, correct } ] }     // triangle
   ========================================================================== */
import { binomUpper, binomCdf, mulberry32, shuffle, lnGamma } from '/assets/js/stats.js';

export const STORE_KEY = 'ffp-sensory-v1';
export const LETTERS = 'ABCDEFGH';
export const TRI_ORDERS = ['ABB', 'AAB', 'ABA', 'BAA', 'BBA', 'BAB'];

/* ------------------------------------------------------------ serving orders */
/** Williams design for t products: t sequences (even t) or 2t sequences (odd t). Entries are product indices 0…t−1. */
export function williamsSquare(t) {
  if (t < 2) return [[0]];
  const a = [0]; let lo = 1, hi = t - 1, k = 0;
  while (a.length < t) { a.push(k % 2 === 0 ? lo++ : hi--); k++; }
  const rows = [];
  for (let i = 0; i < t; i++) rows.push(a.map(v => (v + i) % t));
  if (t % 2 === 1) for (let i = 0; i < t; i++) rows.push(rows[i].slice().reverse());
  return rows;
}

/** A three-digit code that carries no obvious meaning (no 111-type repeats, no 123/321 runs, no round hundreds, 666, 911, 112). */
export function goodCode(c) {
  const s = String(c);
  if (s.length !== 3) return false;
  if (s[0] === s[1] && s[1] === s[2]) return false;
  const d1 = s.charCodeAt(1) - s.charCodeAt(0), d2 = s.charCodeAt(2) - s.charCodeAt(1);
  if (d1 === d2 && Math.abs(d1) === 1) return false;
  if (/^(666|911|112|100|200|300|400|500|600|700|800|900)$/.test(s)) return false;
  return true;
}
export const GOOD_CODES = (() => { const a = []; for (let c = 100; c <= 999; c++) if (goodCode(c)) a.push(c); return a; })();

/**
 * Build a complete serving plan.
 * test: 'hedonic' (t products, Williams design), 'triangle' (2 products, six arrangements), 'preference' (2 products, AB/BA).
 * uniqueCodes: fresh codes for every panellist (recommended by ISO 4120) or one code per product copy for the whole study.
 */
export function buildDesign({ test = 'hedonic', t = 3, n = 24, labels = [], seed = 1, uniqueCodes = true } = {}) {
  const rng = mulberry32(seed >>> 0 || 1);
  const nProd = test === 'hedonic' ? Math.max(2, Math.min(8, t)) : 2;
  const samples = Array.from({ length: nProd }, (_, i) => ({ code: LETTERS[i], label: (labels[i] || '').trim() || `Product ${LETTERS[i]}` }));
  let base;
  if (test === 'triangle') base = TRI_ORDERS.map(s => s.split('').map(ch => LETTERS.indexOf(ch)));
  else if (test === 'preference') base = [[0, 1], [1, 0]];
  else base = williamsSquare(nProd);
  // A random relabelling of a Williams square keeps position and carry-over balance.
  const perm = test === 'hedonic' ? shuffle([...Array(nProd).keys()], rng) : [...Array(nProd).keys()];
  const seqs = base.map(r => r.map(i => perm[i]));
  const L = seqs[0].length;
  const unique = uniqueCodes && n * L <= 0.85 * GOOD_CODES.length;
  const used = new Set();
  const draw = localUsed => {
    for (let tries = 0; tries < 20000; tries++) {
      const c = GOOD_CODES[Math.floor(rng() * GOOD_CODES.length)];
      if (used.has(c) || (localUsed && localUsed.has(c))) continue;
      if (unique) used.add(c);
      return c;
    }
    return 100 + Math.floor(rng() * 900);
  };
  const shared = uniqueCodes ? null : samples.map(() => { const s = new Set(); const a = draw(s); s.add(a); const b = draw(s); return [a, b]; });
  const orders = [], blindCodes = [], seqIndex = [];
  let block = [];
  for (let i = 0; i < n; i++) {
    if (i % seqs.length === 0) block = shuffle([...Array(seqs.length).keys()], rng);
    const si = block[i % seqs.length], seq = seqs[si];
    seqIndex.push(si);
    orders.push(seq.map(j => samples[j].code));
    if (!shared) { const loc = new Set(); blindCodes.push(seq.map(() => { const c = draw(loc); loc.add(c); return c; })); }
    else { const cnt = {}; blindCodes.push(seq.map(j => { const k = cnt[j] || 0; cnt[j] = k + 1; return shared[j][Math.min(1, k)]; })); }
  }
  return { test, samples, panellists: n, orders, blindCodes, seqs: seqs.map(s => s.map(j => samples[j].code)), seqIndex, seed, uniqueCodes: !!uniqueCodes, uniqueAcrossPanel: unique };
}

/** Index of the odd sample in a triangle order such as ['A','B','B'] → 0. */
export function oddIndex(order) {
  const cnt = {}; order.forEach(c => cnt[c] = (cnt[c] || 0) + 1);
  return order.findIndex(c => cnt[c] === 1);
}

/** Position counts pos[product][position], first-order carry-over counts carry[prev][next], sequence use counts. */
export function balanceStats(design) {
  const codes = design.samples.map(s => s.code), P = codes.length, L = design.orders[0] ? design.orders[0].length : 0;
  const ix = c => codes.indexOf(c);
  const pos = Array.from({ length: P }, () => new Array(L).fill(0));
  const carry = Array.from({ length: P }, () => new Array(P).fill(0));
  design.orders.forEach(o => o.forEach((c, j) => { pos[ix(c)][j]++; if (j > 0) carry[ix(o[j - 1])][ix(c)]++; }));
  const seqCounts = {};
  design.orders.forEach(o => { const k = o.join(''); seqCounts[k] = (seqCounts[k] || 0) + 1; });
  const flatPos = pos.flat().filter((_, k) => true);
  const offDiag = []; carry.forEach((r, i) => r.forEach((v, j) => { if (i !== j) offDiag.push(v); }));
  return {
    pos, carry, seqCounts,
    posRange: flatPos.length ? Math.max(...flatPos) - Math.min(...flatPos) : 0,
    carryRange: offDiag.length ? Math.max(...offDiag) - Math.min(...offDiag) : 0
  };
}

/* ------------------------------------------------------------ project store */
export function loadStudy() {
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); if (s && s.version === 1 && s.design && Array.isArray(s.design.samples)) { if (!Array.isArray(s.responses)) s.responses = []; return s; } } catch (e) { /* corrupt or blocked */ }
  return null;
}
export function saveStudy(study) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(study)); return true; } catch (e) { return false; }
}

/* ------------------------------------------------------------ normal distribution (fast) */
const SQ2PI = Math.sqrt(2 * Math.PI);
/** Standard normal CDF via the Chebyshev erfc approximation (fractional error < 1.2e-7; Press et al., Numerical Recipes). */
export function Phi(x) {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? 1 - r / 2 : r / 2;
}
export const phi = x => Math.exp(-0.5 * x * x) / SQ2PI;
export function simpson(f, a, b, n = 200) { if (n % 2) n++; const h = (b - a) / n; let s = f(a) + f(b); for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h); return s * h / 3; }

/* ------------------------------------------------------------ psychometric functions p_c = f(d′) */
const S3 = Math.sqrt(3), S23 = Math.sqrt(2 / 3);
/** Triangle test (Ennis, 1993): 2∫₀^∞ [Φ(−z√3 + d′√(2/3)) + Φ(−z√3 − d′√(2/3))] φ(z) dz. */
export function pcTriangle(d) { if (!(d > 0)) return 1 / 3; const k = d * S23; return 2 * simpson(z => (Phi(-z * S3 + k) + Phi(-z * S3 - k)) * phi(z), 0, 8.5, 260); }
/** Unspecified tetrad: 1 − 2∫ φ(z)[2Φ(z)Φ(z − d′) − Φ(z − d′)²] dz. */
export function pcTetrad(d) { if (!(d > 0)) return 1 / 3; return 1 - 2 * simpson(z => { const a = Phi(z), b = Phi(z - d); return phi(z) * (2 * a * b - b * b); }, -8.5, 8.5 + d, 360); }
/** Duo–trio (constant reference): 1 − Φ(d′/√2) − Φ(d′/√6) + 2Φ(d′/√2)Φ(d′/√6). */
export function pcDuoTrio(d) { if (!(d > 0)) return 0.5; const a = Phi(d / Math.SQRT2), b = Phi(d / Math.sqrt(6)); return 1 - a - b + 2 * a * b; }
/** 2-AFC: Φ(d′/√2). */
export function pc2AFC(d) { return Phi(Math.max(0, d) / Math.SQRT2); }
/** 3-AFC: ∫ φ(z − d′) Φ(z)² dz. */
export function pc3AFC(d) { if (!(d > 0)) return 1 / 3; return simpson(z => phi(z - d) * Phi(z) ** 2, -8.5, 8.5 + d, 360); }
export const METHODS = {
  triangle: { label: 'Triangle', p0: 1 / 3, f: pcTriangle },
  tetrad: { label: 'Tetrad', p0: 1 / 3, f: pcTetrad },
  duotrio: { label: 'Duo–trio', p0: 1 / 2, f: pcDuoTrio },
  afc3: { label: '3-AFC', p0: 1 / 3, f: pc3AFC },
  afc2: { label: '2-AFC', p0: 1 / 2, f: pc2AFC }
};
/** Invert a monotone psychometric function: d′ with f(d′) = pc (0 if pc ≤ p0, Infinity if above f(dmax)). */
export function invertPc(f, pc, dmax = 12) {
  const f0 = f(0);
  if (!(pc > f0)) return 0;
  if (pc >= f(dmax)) return Infinity;
  let lo = 0, hi = dmax;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(m) < pc) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
export const dprimeTriangle = pc => invertPc(pcTriangle, pc);
/** Slope of a psychometric function (central difference). */
export function slope(f, d, h = 1e-3) { const a = Math.max(0, d - h); return (f(d + h) - f(a)) / (d + h - a); }

/* ------------------------------------------------------------ studentised range (fast, for live updates) */
/* Same integral representation as ptukey in /assets/js/stats.js, but with the fast Φ above and fewer nodes
   (|error| < 1e-4 in q for 2–8 means), so that Tukey HSD can follow a slider in real time. */
function ptukeyInfFast(w, k) { if (w <= 0) return 0; return Math.min(1, k * simpson(z => phi(z) * Math.pow(Math.max(0, Phi(z) - Phi(z - w)), k - 1), -8, 8, 140)); }
export function ptukeyFast(q, k, df) {
  if (q <= 0) return 0;
  if (!isFinite(df) || df > 2000) return ptukeyInfFast(q, k);
  const lnC = (df / 2) * Math.log(df) - lnGamma(df / 2) - (df / 2 - 1) * Math.LN2;
  const sd = 1 / Math.sqrt(2 * df), lo = Math.max(1e-6, 1 - 8 * sd), hi = 1 + 10 * sd + (df < 5 ? 3 : 0);
  return Math.min(1, Math.max(0, simpson(x => Math.exp(lnC + (df - 1) * Math.log(x) - df * x * x / 2) * ptukeyInfFast(q * x, k), lo, hi, 90)));
}
const qCache = new Map();
export function qtukeyFast(p, k, df) {
  const key = p + '|' + k + '|' + df; if (qCache.has(key)) return qCache.get(key);
  let lo = 0, hi = 30; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ptukeyFast(m, k, df) < p) lo = m; else hi = m; }
  const q = (lo + hi) / 2; qCache.set(key, q); return q;
}

/* ------------------------------------------------------------ binomial helpers */
function bisect(g, a, b, it = 70) { for (let i = 0; i < it; i++) { const m = (a + b) / 2; if (g(m) < 0) a = m; else b = m; } return (a + b) / 2; }
/** Clopper–Pearson (exact) confidence interval for a binomial proportion. */
export function clopperPearson(x, n, level = 0.95) {
  if (!(n > 0)) return [NaN, NaN];
  const a = (1 - level) / 2;
  const lo = x <= 0 ? 0 : bisect(p => binomUpper(x, n, p) - a, 0, 1);
  const hi = x >= n ? 1 : bisect(p => a - binomCdf(x, n, p), 0, 1);
  return [lo, hi];
}
/** One-sided upper confidence limit (level) for a proportion (exact). */
export function upperLimit(x, n, level = 0.95) { if (x >= n) return 1; return bisect(p => (1 - level) - binomCdf(x, n, p), 0, 1); }
/** Two-sided exact binomial p-value for H0: p = 0.5 (paired preference). */
export function prefP(x, n) { return Math.min(1, 2 * Math.min(binomUpper(x, n, 0.5), binomCdf(x, n, 0.5))); }
/** Smallest majority count that is significant in a two-sided paired preference test. */
export function prefCritical(n, alpha = 0.05) { for (let x = Math.ceil(n / 2); x <= n; x++) if (prefP(x, n) <= alpha) return x; return n + 1; }

/* ------------------------------------------------------------ formatting */
export function fmtP(p) { if (!isFinite(p)) return '—'; if (p < 0.0001) return '< 0.0001'; if (p < 0.001) return p.toFixed(4); return p.toFixed(3); }
/** "p = 0.012" or "p < 0.0001". */
export const pEq = p => !isFinite(p) ? 'p = —' : p < 0.0001 ? 'p < 0.0001' : 'p = ' + fmtP(p);
export const pad2 = i => String(i).padStart(2, '0');
export const panelId = i => 'P' + pad2(i);
