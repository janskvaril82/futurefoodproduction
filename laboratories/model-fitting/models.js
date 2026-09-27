/* ==========================================================================
   models.js — growth functions, self-starting values, least-squares fitting,
   information criteria, cross-validation, parametric bootstrap and the
   polynomial over-fitting demo for /laboratories/model-fitting/ (ES module).

   All fitting uses fitLM (Levenberg–Marquardt) from /assets/js/stats.js.
   Parameterisations follow Lesson 10.1 (Eqs. 10.1.4–10.1.6):
     linear       W = a + b t
     exponential  W = W0 exp(r t)
     logistic     W = K / (1 + exp(−r (t − ti)))
     Gompertz     W = K exp(−exp(−r (t − ti)))
     Richards     W = K [1 + ν exp(−r (t − ti))]^(−1/ν)
     expolinear   W = (cm / rm) ln(1 + exp(rm (t − tb)))      (Goudriaan & Monteith 1990)
   ========================================================================== */
import { fitLM, linreg, ols, mean, quantile, mulberry32, randn, crossValidate, normCdf, tInv } from '/assets/js/stats.js';

const softplus = x => (x > 35 ? x : Math.log1p(Math.exp(x)));
const finite = a => a.every(Number.isFinite);
const ssq = (g, t, y, p) => { let s = 0; for (let i = 0; i < t.length; i++) { const e = y[i] - g(t[i], p); s += e * e; } return s; };

/* ------------------------------------------------------------ helpers for starting values */
function range(t) { let lo = Infinity, hi = -Infinity; for (const v of t) { if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; }
/** Mean of y at each unique t (sorted). */
export function meansByTime(t, y) {
  const m = new Map();
  t.forEach((v, i) => { const k = +v; const o = m.get(k) || { s: 0, n: 0, sl: 0, pos: 0 }; o.s += y[i]; o.n++; if (y[i] > 0) { o.sl += Math.log(y[i]); o.pos++; } m.set(k, o); });
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, o]) => ({ t: k, y: o.s / o.n, g: o.pos === o.n ? Math.exp(o.sl / o.n) : o.s / o.n, n: o.n }));
}
function lr(x, y) { if (x.length < 2) return null; const r = linreg(x, y); return isFinite(r.slope) && isFinite(r.intercept) ? r : null; }

/* ------------------------------------------------------------ model catalogue */
export const MODELS = {
  linear: {
    label: 'Linear', color: 'c5', k: 2,
    names: ['a', 'b'], tex: ['a', 'b'],
    f: (t, p) => p[0] + p[1] * t,
    eq: 'W = a + b·t',
    units: u => [u.y, `${u.y} d⁻¹`],
    meaning: ['intercept: the size the line predicts at t = 0 (often negative for sigmoid data — a sign of misfit)', 'absolute growth rate, assumed constant over the whole period'],
    starts(t, y) { const r = lr(t, y); return r ? [[r.intercept, r.slope]] : [[mean(y), 0]]; },
    bounds: () => null
  },
  exponential: {
    label: 'Exponential', color: 'c3', k: 2,
    names: ['W0', 'r'], tex: ['W_0', 'r'],
    f: (t, p) => p[0] * Math.exp(p[1] * t),
    eq: 'W = W₀·e^(r·t)',
    units: u => [u.y, 'd⁻¹'],
    meaning: ['size at t = 0 (back-extrapolated)', 'relative growth rate (RGR): new growth per unit of existing size per day, assumed constant'],
    starts(t, y) {
      const idx = y.map((v, i) => i).filter(i => y[i] > 0);
      const r = lr(idx.map(i => t[i]), idx.map(i => Math.log(y[i])));
      const out = r ? [[Math.exp(r.intercept), r.slope]] : [];
      // early-phase start: only the first half of the dates
      const [t0, t1] = range(t); const early = idx.filter(i => t[i] <= t0 + 0.5 * (t1 - t0));
      const r2 = lr(early.map(i => t[i]), early.map(i => Math.log(y[i])));
      if (r2) out.push([Math.exp(r2.intercept), r2.slope]);
      return out.length ? out : [[Math.max(1e-6, Math.min(...y.filter(v => v > 0))), 0.1]];
    },
    bounds: (t, y) => [[1e-12, Infinity], [-5, 5]]
  },
  logistic: {
    label: 'Logistic', color: 'c0', k: 3,
    names: ['K', 'r', 'ti'], tex: ['K', 'r', 't_i'],
    f: (t, p) => p[0] / (1 + Math.exp(-p[1] * (t - p[2]))),
    eq: 'W = K / (1 + e^(−r·(t − tᵢ)))',
    units: u => [u.y, 'd⁻¹', 'd'],
    meaning: ['asymptote: final size the curve approaches', 'intrinsic rate: the RGR of a very small plant; RGR falls linearly with size', 'inflection time: when W = K/2 and growth is fastest'],
    starts: (t, y) => sigmoidStarts(t, y, (yy, K) => Math.log(yy / (K - yy))),
    bounds: (t, y) => sigBounds(t, y)
  },
  gompertz: {
    label: 'Gompertz', color: 'c1', k: 3,
    names: ['K', 'r', 'ti'], tex: ['K', 'r', 't_i'],
    f: (t, p) => p[0] * Math.exp(-Math.exp(-p[1] * (t - p[2]))),
    eq: 'W = K·exp(−e^(−r·(t − tᵢ)))',
    units: u => [u.y, 'd⁻¹', 'd'],
    meaning: ['asymptote: final size', 'rate constant: the RGR itself decays exponentially with this rate', 'inflection time: when W = K/e ≈ 0.37 K and growth is fastest'],
    starts: (t, y) => sigmoidStarts(t, y, (yy, K) => -Math.log(-Math.log(yy / K))),
    bounds: (t, y) => sigBounds(t, y)
  },
  richards: {
    label: 'Richards', color: 'c2', k: 4,
    names: ['K', 'r', 'ti', 'nu'], tex: ['K', 'r', 't_i', '\\nu'],
    f: (t, p) => (p[3] < 1e-6 ? p[0] * Math.exp(-Math.exp(-p[1] * (t - p[2]))) : p[0] * Math.pow(1 + p[3] * Math.exp(-p[1] * (t - p[2])), -1 / p[3])),
    eq: 'W = K·[1 + ν·e^(−r·(t − tᵢ))]^(−1/ν)',
    units: u => [u.y, 'd⁻¹', 'd', '–'],
    meaning: ['asymptote: final size', 'rate parameter', 'inflection time', 'shape: ν = 1 is the logistic, ν → 0 the Gompertz; the inflection lies at W = K(1 + ν)^(−1/ν)'],
    starts(t, y) {
      const out = [];
      for (const nu of [1, 0.3, 2.5]) {
        const base = nu === 1 ? MODELS.logistic : MODELS.gompertz;
        for (const s of base.starts(t, y).slice(0, 2)) out.push([s[0], s[1], s[2], nu]);
      }
      return out;
    },
    bounds: (t, y) => [...sigBounds(t, y), [0.005, 25]]
  },
  expolinear: {
    label: 'Expolinear', color: 'c4', k: 3,
    names: ['cm', 'rm', 'tb'], tex: ['c_m', 'r_m', 't_b'],
    f: (t, p) => p[0] / p[1] * softplus(p[1] * (t - p[2])),
    eq: 'W = (c_m / r_m)·ln(1 + e^(r_m·(t − t_b)))',
    units: u => [`${u.y} d⁻¹`, 'd⁻¹', 'd'],
    meaning: ['maximum absolute growth rate reached once the canopy closes (linear phase)', 'maximum relative growth rate in the early exponential phase', '“lost time”: where the linear asymptote crosses zero'],
    starts(t, y) {
      const m = meansByTime(t, y); const n = m.length; if (n < 3) return [[1, 0.2, t[0]]];
      const [t0, t1] = range(t);
      const late = m.filter(o => o.t >= t0 + 0.6 * (t1 - t0)); const early = m.filter(o => o.t <= t0 + 0.45 * (t1 - t0) && o.g > 0);
      const rl = lr(late.map(o => o.t), late.map(o => o.y)) || lr(m.map(o => o.t), m.map(o => o.y));
      let cm = rl && rl.slope > 0 ? rl.slope : Math.max(1e-6, (m[n - 1].y - m[0].y) / Math.max(1e-9, t1 - t0));
      let tb = rl && rl.slope > 0 ? -rl.intercept / rl.slope : t0 + 0.5 * (t1 - t0);
      const re = lr(early.map(o => o.t), early.map(o => Math.log(o.g)));
      let rm = re && re.slope > 0.005 ? re.slope : 0.2;
      tb = Math.min(t1, Math.max(t0 - (t1 - t0), tb));
      return [[cm, rm, tb], [cm, rm * 2, tb], [cm * 1.2, 0.5 * rm, tb + 0.1 * (t1 - t0)]];
    },
    bounds: (t, y) => { const [t0, t1] = range(t); const R = Math.max(1e-9, t1 - t0); return [[1e-12, Infinity], [1e-4, 10], [t0 - 3 * R, t1 + 3 * R]]; }
  }
};
export const MODEL_KEYS = Object.keys(MODELS);

function sigBounds(t, y) {
  const [t0, t1] = range(t); const R = Math.max(1e-9, t1 - t0); const ym = Math.max(...y.map(Math.abs), 1e-9);
  return [[ym * 0.3, ym * 200], [1e-4, 20], [t0 - 3 * R, t1 + 6 * R]];
}
/** Starting values for 3-parameter sigmoids by linearisation z(y; K) = r (t − ti) for several trial asymptotes. */
function sigmoidStarts(t, y, zf) {
  const [t0, t1] = range(t); const R = Math.max(1e-9, t1 - t0);
  const m = meansByTime(t, y).filter(o => o.y > 0); const ymax = Math.max(...y);
  const out = [];
  for (const fK of [1.08, 1.3, 1.8, 3, 6]) {
    const K = fK * ymax; const pts = m.filter(o => o.y < K);
    const r = lr(pts.map(o => o.t), pts.map(o => zf(o.y, K)));
    if (r && r.slope > 1e-4) out.push([K, r.slope, -r.intercept / r.slope]);
  }
  if (!out.length) out.push([1.2 * ymax, 4 / R, t0 + 0.6 * R]);
  return out;
}

/* ------------------------------------------------------------ fitting */
/**
 * Fit one model by least squares. opt.log = true fits ln W (proportional errors).
 * Returns a result object; result.ok = false with result.why when the model cannot be fitted.
 */
export function fitModel(key, t, y, opt = {}) {
  const M = MODELS[key]; const log = !!opt.log; const n = t.length, k = M.k;
  const fail = why => ({ key, ok: false, why, n, k });
  if (n < k + 2) return fail(`needs at least ${k + 2} observations`);
  if (log && y.some(v => !(v > 0))) return fail('ln W undefined for values ≤ 0');
  const g = log ? (x, p) => { const v = M.f(x, p); return v > 0 ? Math.log(v) : NaN; } : M.f;
  const yy = log ? y.map(Math.log) : y;
  const bounds = M.bounds(t, y);
  const starts = opt.start ? [opt.start] : M.starts(t, y);
  let best = null;
  for (const p0 of starts) {
    if (!finite(p0)) continue;
    const q0 = bounds ? p0.map((v, i) => Math.min(bounds[i][1], Math.max(bounds[i][0], v))) : p0;
    if (!isFinite(ssq(g, t, yy, q0))) continue;
    let r;
    try { r = fitLM(g, t, yy, q0, { bounds, maxIter: opt.maxIter || 300 }); } catch (e) { continue; }
    if (!isFinite(r.sse) || !finite(r.params)) continue;
    if (!best || r.sse < best.sse) best = r;
  }
  if (!best) return fail('no starting value gave a finite fit');
  const p = best.params, sse = best.sse;
  const my = mean(yy); const sst = yy.reduce((s, v) => s + (v - my) ** 2, 0);
  const K = k + 1;                                   // + residual variance (Lesson 10.1, Eq. 10.1.9)
  const aic = n * Math.log(sse / n) + 2 * K;
  const aicc = aic + (n - K - 1 > 0 ? 2 * K * (K + 1) / (n - K - 1) : Infinity);
  const bic = n * Math.log(sse / n) + K * Math.log(n);
  const s = Math.sqrt(sse / Math.max(1, n - k));
  const tc = n - k > 0 ? tInv(0.975, n - k) : NaN;
  const res = {
    key, ok: true, log, n, k, params: p, se: best.se, sse, s, rmse: Math.sqrt(sse / n), r2: sst > 0 ? 1 - sse / sst : NaN,
    aic, aicc, bic, lmAic: best.aic, lmAicc: best.aicc, converged: best.converged, iterations: best.iterations,
    ci: p.map((v, i) => [v - tc * best.se[i], v + tc * best.se[i]]), tcrit: tc,
    predict: x => M.f(x, p), residuals: yy.map((v, i) => v - g(t[i], p))
  };
  res.fitted = t.map(x => M.f(x, p));
  // flag boundary solutions (parameter pinned to a bound → estimate not meaningful)
  res.atBound = bounds ? p.map((v, i) => Math.abs(v - bounds[i][0]) < 1e-9 * Math.max(1, Math.abs(bounds[i][0])) || Math.abs(v - bounds[i][1]) < 1e-9 * Math.max(1, Math.abs(bounds[i][1]))) : p.map(() => false);
  return res;
}

/** Fit every model and add ΔAICc and Akaike weights. */
export function fitAll(t, y, opt = {}) {
  const out = {};
  for (const key of MODEL_KEYS) out[key] = fitModel(key, t, y, opt);
  const ok = MODEL_KEYS.filter(k => out[k].ok && isFinite(out[k].aicc));
  const min = Math.min(...ok.map(k => out[k].aicc));
  const sumW = ok.reduce((s, k) => s + Math.exp(-(out[k].aicc - min) / 2), 0);
  ok.forEach(k => { out[k].dAicc = out[k].aicc - min; out[k].w = Math.exp(-out[k].dAicc / 2) / sumW; });
  out.best = ok.length ? ok.reduce((a, b) => (out[a].aicc <= out[b].aicc ? a : b)) : null;
  return out;
}

/* ------------------------------------------------------------ derived quantities */
/** First time at which the fitted curve reaches `target` (bisection on a fine grid); NaN if never within tMax. */
export function timeTo(f, target, t0, tMax) {
  const N = 1200; let prevT = t0, prevV = f(t0);
  if (prevV >= target) return t0;
  for (let i = 1; i <= N; i++) {
    const tt = t0 + (tMax - t0) * i / N, v = f(tt);
    if (v >= target) { let a = prevT, b = tt; for (let j = 0; j < 50; j++) { const m = (a + b) / 2; if (f(m) >= target) b = m; else a = m; } return (a + b) / 2; }
    prevT = tt; prevV = v;
  }
  return NaN;
}
/** Biologically meaningful derived quantities for a fitted parameter vector. */
export function derived(key, p) {
  const out = [];
  if (key === 'linear') out.push({ name: 'Absolute growth rate', value: p[1], unit: 'y d⁻¹' });
  if (key === 'exponential') { out.push({ name: 'Relative growth rate', value: p[1], unit: 'd⁻¹' }); out.push({ name: 'Doubling time ln 2 / r', value: Math.LN2 / p[1], unit: 'd' }); }
  if (key === 'logistic') { out.push({ name: 'Maximum growth rate rK/4', value: p[1] * p[0] / 4, unit: 'y d⁻¹' }); out.push({ name: 'Size at inflection K/2', value: p[0] / 2, unit: 'y' }); out.push({ name: 'Early doubling time ln 2 / r', value: Math.LN2 / p[1], unit: 'd' }); }
  if (key === 'gompertz') { out.push({ name: 'Maximum growth rate rK/e', value: p[1] * p[0] / Math.E, unit: 'y d⁻¹' }); out.push({ name: 'Size at inflection K/e', value: p[0] / Math.E, unit: 'y' }); out.push({ name: 'Lag time tᵢ − 1/r (Zwietering)', value: p[2] - 1 / p[1], unit: 'd' }); }
  if (key === 'richards') { const nu = p[3]; out.push({ name: 'Maximum growth rate rK(1+ν)^(−(1+ν)/ν)', value: p[1] * p[0] * Math.pow(1 + nu, -(1 + nu) / nu), unit: 'y d⁻¹' }); out.push({ name: 'Size at inflection K(1+ν)^(−1/ν)', value: p[0] * Math.pow(1 + nu, -1 / nu), unit: 'y' }); }
  if (key === 'expolinear') { out.push({ name: 'Early doubling time ln 2 / r_m', value: Math.LN2 / p[1], unit: 'd' }); out.push({ name: 'Size where exponential meets linear phase (c_m/r_m)·ln 2', value: p[0] / p[1] * Math.LN2, unit: 'y' }); }
  return out;
}
/** Relative growth rate (1/W)(dW/dt) of a fitted curve, by central differences. */
export const rgrOf = (f, t, h = 1e-3) => { const w = f(t); return w > 0 ? (f(t + h) - f(t - h)) / (2 * h) / w : NaN; };

/* ------------------------------------------------------------ residual diagnostics */
/** Wald–Wolfowitz runs test on the signs of residuals ordered in time (normal approximation). */
export function runsTest(res) {
  const s = res.filter(v => v !== 0 && isFinite(v)).map(v => v > 0);
  const n1 = s.filter(Boolean).length, n2 = s.length - n1, n = s.length;
  if (n1 < 2 || n2 < 2) return { runs: NaN, expected: NaN, z: NaN, p: NaN, n1, n2 };
  let runs = 1; for (let i = 1; i < n; i++) if (s[i] !== s[i - 1]) runs++;
  const E = 2 * n1 * n2 / n + 1, V = 2 * n1 * n2 * (2 * n1 * n2 - n) / (n * n * (n - 1));
  const z = (runs - E) / Math.sqrt(V);
  return { runs, expected: E, z, p: 2 * (1 - normCdf(Math.abs(z))), n1, n2 };
}

/* ------------------------------------------------------------ cross-validation */
/**
 * Out-of-sample RMSE of a model (on the fitted scale).
 * scheme: 'kfold' (5 random folds, stats.js crossValidate) | 'loo' | 'future' (last 30 % of dates) | 'group' (leave one group out).
 */
export function cvModel(key, t, y, g, { log = false, scheme = 'kfold', seed = 1 } = {}) {
  const yy = log ? y.map(v => (v > 0 ? Math.log(v) : NaN)) : y;
  const fitFn = (xt, ytr) => {
    const r = fitModel(key, xt, log ? ytr.map(Math.exp) : ytr, { log, maxIter: 150 });
    if (!r.ok) { const m = mean(ytr); return () => m; }       // a failed fit predicts the training mean
    return x => { const v = r.predict(x); return log ? (v > 0 ? Math.log(v) : NaN) : v; };
  };
  const n = t.length;
  if (scheme === 'future') {
    const ut = [...new Set(t)].sort((a, b) => a - b); if (ut.length < 5) return { rmse: NaN, note: 'too few dates' };
    const cut = ut[Math.max(2, Math.floor(0.7 * ut.length)) - 1];
    const tr = t.map((v, i) => i).filter(i => t[i] <= cut), te = t.map((v, i) => i).filter(i => t[i] > cut);
    const pred = fitFn(tr.map(i => t[i]), tr.map(i => yy[i]));
    const e = te.map(i => (yy[i] - pred(t[i])) ** 2);
    return { rmse: Math.sqrt(mean(e)), note: `trained on t ≤ ${+cut.toFixed(2)}, tested on ${te.length} later points`, nTest: te.length };
  }
  if (scheme === 'group') {
    const gs = [...new Set(g)]; if (gs.length < 3) return { rmse: NaN, note: 'needs ≥ 3 groups' };
    const e = [];
    for (const gv of gs) {
      const tr = t.map((v, i) => i).filter(i => g[i] !== gv), te = t.map((v, i) => i).filter(i => g[i] === gv);
      const pred = fitFn(tr.map(i => t[i]), tr.map(i => yy[i]));
      te.forEach(i => e.push((yy[i] - pred(t[i])) ** 2));
    }
    return { rmse: Math.sqrt(mean(e)), note: `${gs.length} groups left out one at a time` };
  }
  const folds = scheme === 'loo' ? n : Math.min(5, n);
  const r = crossValidate(t, yy, fitFn, folds, mulberry32(seed));
  return { rmse: r.rmse, note: scheme === 'loo' ? `${n} leave-one-out fits` : `${folds}-fold` };
}

/* ------------------------------------------------------------ parametric bootstrap */
/**
 * Parametric bootstrap of a fitted model (Efron & Tibshirani): simulate new data sets from the
 * fitted curve plus Gaussian noise with the residual SD (on the log scale for proportional errors),
 * refit each, and collect curves, parameters and the time to reach the target.
 * Returns a runner: runner.step(nReps) → progress fraction; runner.result() → summary.
 */
export function makeBootstrap(fit, t, y, { B = 250, grid, target, tMax, seed = 7 } = {}) {
  const rng = mulberry32(seed); const M = MODELS[fit.key]; const log = fit.log;
  const curves = [], params = [], tstar = []; let done = 0, failed = 0;
  const yhat = t.map(x => M.f(x, fit.params));
  return {
    get done() { return done; },
    step(nReps) {
      for (let r = 0; r < nReps && done < B; r++, done++) {
        const ys = yhat.map(v => (log ? v * Math.exp(fit.s * randn(rng)) : v + fit.s * randn(rng)));
        const f2 = fitModel(fit.key, t, ys, { log, start: fit.params, maxIter: 120 });
        if (!f2.ok) { failed++; continue; }
        params.push(f2.params);
        curves.push(grid.map(x => M.f(x, f2.params)));
        tstar.push(target > 0 ? timeTo(x => M.f(x, f2.params), target, grid[0], tMax) : NaN);
      }
      return done / B;
    },
    result() {
      const m = grid.length; const lo = [], hi = [], plo = [], phi = [], med = [];
      const nr = mulberry32(seed + 1);
      for (let j = 0; j < m; j++) {
        const col = curves.map(c => c[j]).filter(Number.isFinite);
        lo.push(quantile(col, 0.025)); hi.push(quantile(col, 0.975)); med.push(quantile(col, 0.5));
        // prediction band for one new observation: add noise to each bootstrap curve
        const pc = col.map(v => (log ? v * Math.exp(fit.s * randn(nr)) : v + fit.s * randn(nr)));
        plo.push(quantile(pc, 0.025)); phi.push(quantile(pc, 0.975));
      }
      const reached = tstar.filter(Number.isFinite);
      const pse = fit.params.map((_, i) => { const col = params.map(p => p[i]); const mu = mean(col); return Math.sqrt(col.reduce((s, v) => s + (v - mu) ** 2, 0) / Math.max(1, col.length - 1)); });
      return {
        n: curves.length, failed, lo, hi, plo, phi, med, tstar: reached,
        fracReached: tstar.length ? reached.length / tstar.length : NaN,
        tq: reached.length ? [quantile(reached, 0.025), quantile(reached, 0.5), quantile(reached, 0.975)] : [NaN, NaN, NaN],
        paramSE: pse
      };
    }
  };
}

/* ------------------------------------------------------------ polynomials (over-fitting demo) */
/** Legendre polynomials P1..Pd at x ∈ [−1, 1] (P0 = intercept is added by ols). */
function legendreRow(x, d) { const P = [1, x]; for (let n = 1; n < d; n++) P.push(((2 * n + 1) * x * P[n] - n * P[n - 1]) / (n + 1)); return P.slice(1, d + 1); }
/** Least-squares polynomial of degree d (orthogonal Legendre basis on the data's time range). */
export function polyFit(t, y, d, tRange) {
  const [a, b] = tRange || range(t); const sc = x => (b > a ? 2 * (x - a) / (b - a) - 1 : 0);
  if (d === 0) { const m = mean(y); return { predict: () => m, ok: true, df: 1 }; }
  const X = t.map(x => legendreRow(sc(x), d));
  const r = ols(X, y); if (!r) return { ok: false };
  return { ok: true, df: d + 1, beta: r.beta, predict: x => { const row = legendreRow(sc(x), d); return r.beta[0] + row.reduce((s, v, i) => s + v * r.beta[i + 1], 0); } };
}
/** Training and cross-validated RMSE for polynomial degrees 0..maxDeg. */
export function polyCurve(t, y, maxDeg, { scheme = 'loo', seed = 3 } = {}) {
  const out = []; const n = t.length; const rr = range(t);
  for (let d = 0; d <= maxDeg; d++) {
    if (d + 2 > n) break;
    const f = polyFit(t, y, d, rr); if (!f.ok) break;
    const tr = Math.sqrt(mean(t.map((x, i) => (y[i] - f.predict(x)) ** 2)));
    const fitFn = (xt, yt) => { const g = polyFit(xt, yt, d, rr); return g.ok ? g.predict : () => mean(yt); };
    let cv;
    if (scheme === 'future') {
      const ut = [...new Set(t)].sort((p, q) => p - q); const cut = ut[Math.max(2, Math.floor(0.7 * ut.length)) - 1];
      const itr = t.map((v, i) => i).filter(i => t[i] <= cut), ite = t.map((v, i) => i).filter(i => t[i] > cut);
      if (d + 2 > itr.length || !ite.length) break;
      const g = fitFn(itr.map(i => t[i]), itr.map(i => y[i]));
      cv = Math.sqrt(mean(ite.map(i => (y[i] - g(t[i])) ** 2)));
    } else {
      const folds = scheme === 'loo' || n <= 12 ? n : Math.min(10, n);
      cv = crossValidate(t, y, fitFn, folds, mulberry32(seed)).rmse;
    }
    out.push({ d, train: tr, cv });
  }
  return out;
}
