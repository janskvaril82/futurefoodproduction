/* ==========================================================================
   mlp.js — a small, dependency-free multilayer perceptron (ES module)
   Fully connected layers, tanh / ReLU / sigmoid hidden units, linear output,
   objective J = MSE + λ Σ w² (weights only, as in Lesson 10.2, Eq. 10.2.9),
   back-propagation (Rumelhart et al. 1986), mini-batch SGD, SGD with momentum
   (μ = 0.9) or Adam (Kingma & Ba 2015; β₁ = 0.9, β₂ = 0.999, ε = 10⁻⁸).
   Initialisation: Glorot/Xavier uniform (tanh, sigmoid, output) or He normal (ReLU).
   ========================================================================== */
import { mulberry32, randn } from '/assets/js/stats.js';

export const ACT = {
  tanh: { f: z => Math.tanh(z), df: (z, a) => 1 - a * a, range: [-1, 1] },
  relu: { f: z => (z > 0 ? z : 0), df: z => (z > 0 ? 1 : 0), range: [0, 3] },
  sigmoid: { f: z => 1 / (1 + Math.exp(-z)), df: (z, a) => a * (1 - a), range: [0, 1] }
};

export class MLP {
  /** sizes: e.g. [4, 16, 16, 1]; act: 'tanh' | 'relu' | 'sigmoid' */
  constructor(sizes, act = 'tanh', seed = 1) {
    this.sizes = sizes.slice(); this.act = act; this.L = sizes.length - 1; this.A = ACT[act];
    const rng = mulberry32(seed);
    this.W = []; this.b = [];
    for (let l = 0; l < this.L; l++) {
      const nin = sizes[l], nout = sizes[l + 1]; const w = new Float64Array(nin * nout);
      const hidden = l < this.L - 1;
      if (act === 'relu' && hidden) { const sd = Math.sqrt(2 / nin); for (let k = 0; k < w.length; k++) w[k] = sd * randn(rng); }
      else { const lim = Math.sqrt(6 / (nin + nout)); for (let k = 0; k < w.length; k++) w[k] = (2 * rng() - 1) * lim; }
      this.W.push(w); this.b.push(new Float64Array(nout));
    }
    this.z = sizes.map(n => new Float64Array(n)); this.a = sizes.map(n => new Float64Array(n)); this.d = sizes.map(n => new Float64Array(n));
    this.gW = this.W.map(w => new Float64Array(w.length)); this.gb = this.b.map(v => new Float64Array(v.length));
    this.mW = this.W.map(w => new Float64Array(w.length)); this.vW = this.W.map(w => new Float64Array(w.length));
    this.mb = this.b.map(v => new Float64Array(v.length)); this.vb = this.b.map(v => new Float64Array(v.length));
    this.t = 0;
  }
  get nParams() { return this.W.reduce((s, w) => s + w.length, 0) + this.b.reduce((s, v) => s + v.length, 0); }
  /** Forward pass for one input vector; activations stay in this.a / this.z. Returns the output. */
  forward(x) {
    const a = this.a, z = this.z, f = this.A.f; a[0].set(x);
    for (let l = 0; l < this.L; l++) {
      const nin = this.sizes[l], nout = this.sizes[l + 1], W = this.W[l], b = this.b[l], ai = a[l], zo = z[l + 1], ao = a[l + 1];
      const last = l === this.L - 1;
      for (let j = 0; j < nout; j++) {
        let s = b[j]; const o = j * nin;
        for (let i = 0; i < nin; i++) s += W[o + i] * ai[i];
        zo[j] = s; ao[j] = last ? s : f(s);
      }
    }
    return a[this.L][0];
  }
  predict(x) { return this.forward(x); }
  /** Accumulate gradients for the sample in the buffers, given g = ∂J/∂ŷ. */
  backward(g) {
    const d = this.d, a = this.a, z = this.z, df = this.A.df; d[this.L][0] = g;
    for (let l = this.L - 1; l >= 0; l--) {
      const nin = this.sizes[l], nout = this.sizes[l + 1], W = this.W[l], gW = this.gW[l], gb = this.gb[l], dout = d[l + 1], ai = a[l];
      for (let j = 0; j < nout; j++) { const dj = dout[j]; if (dj === 0) continue; gb[j] += dj; const o = j * nin; for (let i = 0; i < nin; i++) gW[o + i] += dj * ai[i]; }
      if (l > 0) {
        const din = d[l], zi = z[l];
        for (let i = 0; i < nin; i++) { let s = 0; for (let j = 0; j < nout; j++) s += W[j * nin + i] * dout[j]; din[i] = s * df(zi[i], ai[i]); }
      }
    }
  }
  zeroGrad() { this.gW.forEach(g => g.fill(0)); this.gb.forEach(g => g.fill(0)); }
  /** One optimisation step on the samples idx (rows of X, targets Y). Returns the batch MSE. */
  trainBatch(X, Y, idx, { lr = 0.01, l2 = 0, opt = 'adam' } = {}) {
    this.zeroGrad(); const m = idx.length; let loss = 0;
    for (const k of idx) { const e = this.forward(X[k]) - Y[k]; loss += e * e; this.backward(2 * e / m); }
    if (l2 > 0) this.W.forEach((W, l) => { const g = this.gW[l]; for (let p = 0; p < W.length; p++) g[p] += 2 * l2 * W[p]; });
    this.step(lr, opt);
    return loss / m;
  }
  step(lr, opt) {
    this.t++;
    const upd = (P, G, M, V) => {
      if (opt === 'adam') {
        const b1 = 0.9, b2 = 0.999, eps = 1e-8, c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
        for (let p = 0; p < P.length; p++) { const g = G[p]; M[p] = b1 * M[p] + (1 - b1) * g; V[p] = b2 * V[p] + (1 - b2) * g * g; P[p] -= lr * (M[p] / c1) / (Math.sqrt(V[p] / c2) + eps); }
      } else if (opt === 'momentum') {
        for (let p = 0; p < P.length; p++) { M[p] = 0.9 * M[p] - lr * G[p]; P[p] += M[p]; }
      } else for (let p = 0; p < P.length; p++) P[p] -= lr * G[p];
    };
    for (let l = 0; l < this.L; l++) { upd(this.W[l], this.gW[l], this.mW[l], this.vW[l]); upd(this.b[l], this.gb[l], this.mb[l], this.vb[l]); }
  }
  /** One epoch of mini-batch training over the (shuffled) training indices. */
  epoch(X, Y, idx, { batch = 32, lr = 0.01, l2 = 0, opt = 'adam', rng = Math.random } = {}) {
    const order = idx.slice(); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const B = batch <= 0 ? order.length : batch; let s = 0, nb = 0;
    for (let k = 0; k < order.length; k += B) { s += this.trainBatch(X, Y, order.slice(k, k + B), { lr, l2, opt }); nb++; }
    return s / nb;
  }
  mse(X, Y, idx) { let s = 0; for (const k of idx) { const e = this.forward(X[k]) - Y[k]; s += e * e; } return idx.length ? s / idx.length : NaN; }
  l2norm() { return this.W.reduce((s, w) => s + w.reduce((t, v) => t + v * v, 0), 0); }
  snapshot() { return { W: this.W.map(w => Float64Array.from(w)), b: this.b.map(v => Float64Array.from(v)) }; }
  restore(s) { s.W.forEach((w, l) => this.W[l].set(w)); s.b.forEach((v, l) => this.b[l].set(v)); }
}

/** Standardisation fitted on the training rows only (no leakage from validation data). */
export function scaler(rows, keys) {
  const mu = keys.map(k => rows.reduce((s, r) => s + r[k], 0) / rows.length);
  const sd = keys.map((k, j) => Math.sqrt(rows.reduce((s, r) => s + (r[k] - mu[j]) ** 2, 0) / Math.max(1, rows.length - 1)) || 1);
  return { mu, sd, keys, x: r => Float64Array.from(keys, (k, j) => (r[k] - mu[j]) / sd[j]) };
}
