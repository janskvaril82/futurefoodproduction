/* Sampling distributions and p-values — animated 2D laboratory.
   Four experiments on one canvas:
   (1) the central limit theorem — draw samples from a population and build the sampling distribution of the mean,
   (2) confidence intervals — 100 intervals and their coverage,
   (3) the dance of the p-values (Cumming 2008) — replicate a two-group experiment again and again,
   (4) power — sampling distributions of the t statistic under H₀ (central t) and H₁ (noncentral t).
   Statistics: /assets/js/stats.js; exact noncentral t: ./stats-extra.js (Lenth 1989). */
import * as S from '/assets/js/stats.js';
import * as XS from './stats-extra.js';
import { Controls, Readouts, SimClock, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, linspace } from '/assets/js/plot.js';
import { palette, withAlpha, categorical } from '/assets/js/colors.js';

const $ = s => document.querySelector(s);
const nf = (v, d = 1) => !isFinite(v) ? '—' : (v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
const pTxt = p => p < 0.001 ? '< .001' : p.toFixed(3).replace(/^0/, '');

/* =========================================================== populations */
function makePop(kind, mu, sigma, sep) {
  const P = { kind, mu, sigma };
  if (kind === 'normal') {
    Object.assign(P, { label: 'Normal', pdf: x => S.normPdf(x, mu, sigma), draw: g => mu + sigma * g.z(), skew: 0, lo: mu - 4 * sigma, hi: mu + 4 * sigma });
  } else if (kind === 'lognormal') {
    const s2 = Math.log(1 + (sigma / mu) ** 2), s = Math.sqrt(s2), m = Math.log(mu) - s2 / 2;
    Object.assign(P, { label: 'Right-skewed (lognormal)', pdf: x => x <= 0 ? 0 : Math.exp(-((Math.log(x) - m) ** 2) / (2 * s2)) / (x * s * Math.sqrt(2 * Math.PI)), draw: g => Math.exp(m + s * g.z()), skew: (Math.exp(s2) + 2) * Math.sqrt(Math.exp(s2) - 1), lo: 0, hi: Math.exp(m + 2.75 * s) });
  } else if (kind === 'uniform') {
    const a = mu - Math.sqrt(3) * sigma, b = mu + Math.sqrt(3) * sigma;
    Object.assign(P, { label: 'Uniform', pdf: x => x >= a && x <= b ? 1 / (b - a) : 0, draw: g => a + (b - a) * g.u(), skew: 0, lo: a - 0.25 * (b - a), hi: b + 0.25 * (b - a) });
  } else {
    const k = sep, a = k * sigma, b = Math.sqrt(1 - k * k) * sigma;
    Object.assign(P, { label: 'Bimodal (two sub-populations)', pdf: x => 0.5 * S.normPdf(x, mu - a, b) + 0.5 * S.normPdf(x, mu + a, b), draw: g => (g.u() < 0.5 ? mu - a : mu + a) + b * g.z(), skew: 0, lo: mu - a - 3.6 * b, hi: mu + a + 3.6 * b });
  }
  if (P.lo < 0 && kind !== 'normal') P.lo = Math.max(P.lo, 0);
  return P;
}

/* =========================================================== controls */
const ui = new Controls('#controls', { url: true });
ui.section('Experiment');
ui.segmented({ id: 'mode', label: 'What to explore', options: [{ value: 'clt', label: 'Means (CLT)' }, { value: 'ci', label: 'CIs' }, { value: 'pdance', label: 'p-values' }, { value: 'power', label: 'Power' }], value: 'clt' });
ui.section('Population of fresh weights');
ui.select({ id: 'pop', label: 'Shape', options: [{ value: 'normal', label: 'Normal' }, { value: 'lognormal', label: 'Right-skewed (lognormal) — like plant weights' }, { value: 'uniform', label: 'Uniform' }, { value: 'bimodal', label: 'Bimodal — two sub-populations mixed' }], value: 'lognormal' });
ui.slider({ id: 'mu', label: 'Population mean μ', min: 50, max: 400, step: 5, value: 180, unit: 'g' });
ui.slider({ id: 'sigma', label: 'Population SD σ', min: 5, max: 180, step: 1, value: 60, unit: 'g', help: 'For the lognormal, the ratio σ/μ sets the skew.' });
ui.slider({ id: 'sep', label: 'Separation of the two modes', min: 0.5, max: 0.97, step: 0.01, value: 0.88 });
ui.section('Sampling');
ui.slider({ id: 'n', label: 'Sample size n (per group)', min: 2, max: 100, step: 1, value: 5 });
ui.segmented({ id: 'conf', label: 'Confidence level', options: [{ value: 0.8, label: '80 %' }, { value: 0.9, label: '90 %' }, { value: 0.95, label: '95 %' }, { value: 0.99, label: '99 %' }], value: 0.95 });
ui.toggle({ id: 'useZ', label: 'Use z = 1.96 instead of t (a common mistake)', value: false });
ui.slider({ id: 'd', label: 'True effect d = Δ/σ', min: 0, max: 2, step: 0.05, value: 0.8, help: 'Treatment mean = μ + d·σ. d = 0 means H₀ is true.' });
ui.segmented({ id: 'alpha', label: 'Significance level α', options: [{ value: 0.01, label: '.01' }, { value: 0.05, label: '.05' }, { value: 0.1, label: '.10' }], value: 0.05 });
ui.section('Animation');
ui.slider({ id: 'speed', label: 'Speed', min: 0.5, max: 300, value: 2, log: true, unit: 'samples s⁻¹', format: v => v < 10 ? v.toFixed(1) : Math.round(v) });
const [bPlay] = ui.buttons([{ label: '▶ Play', variant: 'primary', onClick: () => clock.toggle() }, { label: 'Step', onClick: () => { clock.pause(); emit(); } }]);
ui.buttons([{ label: '+100', onClick: () => bulk(100) }, { label: '+1000', onClick: () => bulk(1000) }, { label: 'Reset', onClick: () => reset(true) }]);
ui.presets([
  { label: 'Normal, n = 5', values: { mode: 'clt', pop: 'normal', mu: 180, sigma: 40, n: 5 } },
  { label: 'Skewed weights, n = 3', values: { mode: 'clt', pop: 'lognormal', mu: 180, sigma: 90, n: 3 } },
  { label: 'Very skewed, n = 30', values: { mode: 'clt', pop: 'lognormal', mu: 120, sigma: 120, n: 30 } },
  { label: 'z instead of t, n = 4', values: { mode: 'ci', pop: 'normal', mu: 180, sigma: 60, n: 4, useZ: true, conf: 0.95 } },
  { label: 'p-values when H₀ is true', values: { mode: 'pdance', pop: 'normal', mu: 180, sigma: 60, d: 0, n: 10, alpha: 0.05 } },
  { label: 'Typical project: d = 0.8, n = 6', values: { mode: 'pdance', pop: 'normal', mu: 180, sigma: 60, d: 0.8, n: 6, alpha: 0.05 } },
  { label: 'Power: n for d = 0.8', values: { mode: 'power', pop: 'normal', mu: 180, sigma: 60, d: 0.8, n: 26, alpha: 0.05 } }
]);
let saveInfo = {};
ui.saveButton('sampling-distributions', () => saveInfo);

/* =========================================================== simulation state */
let seed = 1;
const G = (() => { const r = S.mulberry32(20260926); const z = XS.gaussian(r); return { u: r, z }; })();
let pop, st;
function freshState() {
  return {
    k: 0, means: [], sumM: 0, sumM2: 0, sumM3: 0, // CLT
    queue: [], cur: null, lastSample: null, lastMean: null, hist: null,
    ci: [], ciAll: 0, ciHit: 0, ciWidth: 0, covTrace: [], // CI
    exps: [], pAll: [], pHist: new Array(20).fill(0), rej: 0, // p-dance & power
    tvals: []
  };
}
const history = []; // for the √n chart: {n, sd, skew, sdTheory, kind}
const powerRuns = new Map(); // key n|d|alpha → {n, d, alpha, k, rej}

function params() { return ui.values(); }
function sample(n, shift = 0) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = pop.draw(G) + shift; return a; }
function emit() {
  const p = params(); const mode = p.mode;
  if (mode === 'clt' || mode === 'ci') {
    const xs = sample(p.n); const m = S.mean(xs), s = S.sd(xs);
    const q = p.useZ ? S.normInv(1 - (1 - p.conf) / 2) : S.tInv(1 - (1 - p.conf) / 2, p.n - 1);
    const lo = m - q * s / Math.sqrt(p.n), hi = m + q * s / Math.sqrt(p.n);
    st.queue.push({ xs, m, s, lo, hi, hit: lo <= pop.mu && pop.mu <= hi, born: performance.now() });
  } else {
    const a = sample(p.n), b = sample(p.n, p.d * pop.sigma); const T = S.tTestPooled(b, a);
    const tc = S.tInv(1 - (1 - p.conf) / 2, T.df);
    st.queue.push({ a, b, t: T.t, p: T.p, diff: T.diff, lo: T.diff - tc * T.se, hi: T.diff + tc * T.se, born: performance.now() });
  }
  if (st.queue.length > 4) { const extra = st.queue.splice(0, st.queue.length - 2); extra.forEach(commit); }
}
function commit(e) {
  const p = params();
  if (e.xs) {
    st.k++; st.means.push(e.m); st.sumM += e.m; st.sumM2 += e.m * e.m; st.sumM3 += e.m ** 3;
    if (st.hist) { const b = Math.floor((e.m - st.hist.lo) / st.hist.w); if (b >= 0 && b < st.hist.c.length) st.hist.c[b]++; }
    st.ci.unshift({ lo: e.lo, hi: e.hi, m: e.m, hit: e.hit, t: performance.now() }); if (st.ci.length > 100) st.ci.pop();
    st.ciAll++; if (e.hit) st.ciHit++; st.ciWidth += e.hi - e.lo; if (st.ciAll <= 2000 || st.ciAll % 5 === 0) st.covTrace.push([st.ciAll, 100 * st.ciHit / st.ciAll]);
    st.lastSample = e.xs; st.lastMean = e.m;
  } else {
    st.exps.unshift({ ...e, t0: performance.now() }); if (st.exps.length > 26) st.exps.pop();
    st.pAll.push(e.p); st.pHist[Math.min(19, Math.floor(e.p * 20))]++; if (e.p < p.alpha) st.rej++;
    st.tvals.unshift({ t: e.t, rej: e.p < p.alpha, t0: performance.now() }); if (st.tvals.length > 300) st.tvals.pop();
    const key = `${p.n}|${p.d}|${p.alpha}|${p.pop}`; const r = powerRuns.get(key) || { n: p.n, d: p.d, alpha: p.alpha, pop: p.pop, k: 0, rej: 0 }; r.k++; if (e.p < p.alpha) r.rej++; powerRuns.set(key, r);
  }
  dirtyCharts = true;
}
function bulk(k) { for (let i = 0; i < k; i++) { emit(); } const q = st.queue.splice(0); q.forEach(commit); st.cur = null; dirtyCharts = true; }
function reset(user = false) {
  const p = params();
  if (st && st.k >= 200) { const m = st.sumM / st.k, v = st.sumM2 / st.k - m * m; const sd = Math.sqrt(v * st.k / (st.k - 1)); const m3 = st.sumM3 / st.k - 3 * m * st.sumM2 / st.k + 2 * m ** 3; history.push({ n: st.n, sd, skew: m3 / Math.pow(v, 1.5), kind: st.popKind, sigma: st.sigma, mu: st.mu }); }
  pop = makePop(p.pop, p.mu, p.sigma, p.sep);
  st = freshState(); st.n = p.n; st.popKind = p.pop; st.sigma = p.sigma; st.mu = p.mu;
  const nb = 150; st.hist = { lo: pop.lo, w: (pop.hi - pop.lo) / nb, c: new Array(nb).fill(0) };
  dirtyCharts = true; if (user) window.FFP && FFP.toast && FFP.toast('Simulation reset');
}

/* =========================================================== clock */
let acc = 0;
const clock = new SimClock({ speed: 2, onStep: dt => { acc += dt; let guard = 0; while (acc >= 1 && guard++ < 2000) { acc -= 1; emit(); } } });
clock.onState(r => { bPlay.innerHTML = r ? '❚❚ Pause' : '▶ Play'; });

/* =========================================================== canvas stage */
const stageEl = $('#stage'); stageEl.classList.add('light-stage', 'tall');
const cv = document.createElement('canvas'); cv.className = 'sd-canvas'; stageEl.appendChild(cv);
const ctx = cv.getContext('2d');
const hud = hudChips(stageEl);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); const o = document.createElement('canvas'); o.width = cv.width; o.height = cv.height; const c = o.getContext('2d'); c.fillStyle = palette().bgElev; c.fillRect(0, 0, o.width, o.height); c.drawImage(cv, 0, 0); a.href = o.toDataURL('image/png'); a.download = 'sampling-distributions.png'; a.click(); } });
let W = 800, H = 600, DPR = 1;
function resize() { DPR = Math.min(2, window.devicePixelRatio || 1); W = stageEl.clientWidth; H = stageEl.clientHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
new ResizeObserver(resize).observe(stageEl); resize();
let visible = true; new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(stageEl);

const FONT = (s, w = 500) => `${w} ${s}px Inter, system-ui, sans-serif`, MONO = (s, w = 500) => `${w} ${s}px 'JetBrains Mono', ui-monospace, monospace`;
const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
const easeIn = t => t < 0 ? 0 : t > 1 ? 1 : t * t;
function niceStep(range, n) { const r = range / n, e = Math.pow(10, Math.floor(Math.log10(r))), f = r / e; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e; }
function xAxis(P, x0, x1, y, X, label) {
  ctx.strokeStyle = P.lineStrong; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(x0), y + 0.5); ctx.lineTo(X(x1), y + 0.5); ctx.stroke();
  const step = niceStep(x1 - x0, Math.max(4, Math.floor((X(x1) - X(x0)) / 90))); ctx.fillStyle = P.muted; ctx.font = MONO(10.5); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let v = Math.ceil(x0 / step) * step; v <= x1 + 1e-9; v += step) { const px = X(v); ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + 4); ctx.stroke(); ctx.fillText(Math.abs(v) < 1e-9 ? '0' : +v.toPrecision(6), px, y + 6); }
  if (label) { ctx.fillStyle = P.ink2; ctx.font = FONT(11.5, 600); ctx.fillText(label, (X(x0) + X(x1)) / 2, y + 22); }
}
function panelTitle(P, x, y, t, sub) {
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.font = FONT(13, 650); const w = ctx.measureText(t).width;
  ctx.font = FONT(12, 500); const ws = sub ? ctx.measureText(sub).width + 10 : 0;
  ctx.fillStyle = P.bgElev; ctx.fillRect(x - 4, y - 14, w + ws + 8, 19);   // keeps guide lines from running through the text
  ctx.fillStyle = P.ink; ctx.font = FONT(13, 650); ctx.fillText(t, x, y);
  if (sub) { ctx.fillStyle = P.muted; ctx.font = FONT(12, 500); ctx.fillText(sub, x + w + 10, y); }
}
function popCurve(P, X, yBase, hPx, fillCol) {
  const N = 260, xs = linspace(pop.lo, pop.hi, N); const ys = xs.map(pop.pdf); const mx = Math.max(...ys.filter(isFinite)) || 1;
  ctx.beginPath(); ctx.moveTo(X(xs[0]), yBase); xs.forEach((x, i) => ctx.lineTo(X(x), yBase - ys[i] / mx * hPx)); ctx.lineTo(X(xs[N - 1]), yBase); ctx.closePath();
  const g = ctx.createLinearGradient(0, yBase - hPx, 0, yBase); g.addColorStop(0, withAlpha(fillCol, 0.38)); g.addColorStop(1, withAlpha(fillCol, 0.06)); ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); xs.forEach((x, i) => { const Y = yBase - ys[i] / mx * hPx; i ? ctx.lineTo(X(x), Y) : ctx.moveTo(X(x), Y); }); ctx.strokeStyle = fillCol; ctx.lineWidth = 2; ctx.stroke();
  return { mx };
}

/* ---------- mode 1: CLT ---------- */
function drawCLT(P, now) {
  const p = params(); const L = 64, R = W - 26; const X = v => L + (v - pop.lo) / (pop.hi - pop.lo) * (R - L);
  const y1 = 88, y1b = H * 0.31, y2b = H * 0.47, y3t = H * 0.54, y3b = H - 58;
  panelTitle(P, L, y1 - 18, 'Population', `${pop.label} · μ = ${nf(pop.mu, 0)} g · σ = ${nf(pop.sigma, 0)} g${pop.skew ? ` · skewness ${nf(pop.skew, 2)}` : ''}`);
  const { mx } = popCurve(P, X, y1b, y1b - y1, P.accent);
  ctx.strokeStyle = P.ink; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(X(pop.mu), y1 - 4); ctx.lineTo(X(pop.mu), y3b); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = P.ink; ctx.font = FONT(11.5, 650); ctx.textAlign = 'left'; ctx.fillText('μ', X(pop.mu) + 5, y1 + 6);
  // current sample strip
  panelTitle(P, L, y1b + 26, `Sample ${st.k + (st.cur ? 1 : 0)}`, `n = ${p.n} fresh weights drawn at random`);
  ctx.strokeStyle = P.line; ctx.beginPath(); ctx.moveTo(L, y2b + 0.5); ctx.lineTo(R, y2b + 0.5); ctx.stroke();
  const r = Math.max(2.4, Math.min(6.5, 90 / Math.sqrt(p.n + 4)));
  // animation of the current sample
  const Ts = Math.max(0.1, Math.min(2.2, 1.1 / Math.pow(clock.speed, 0.7)));
  if (!st.cur && st.queue.length) { st.cur = st.queue.shift(); st.cur.t0 = now; }
  let showXs = st.lastSample, showMean = st.lastMean, meanProg = 1, cur = st.cur;
  if (cur) {
    const prog = (now - cur.t0) / 1000 / Ts; showXs = cur.xs; showMean = cur.m;
    const stackH = {}; const bw = r * 2.1;
    cur.xs.forEach((x, j) => {
      const tj = j / cur.xs.length * 0.45, f = (prog - tj) / 0.33; if (f < 0) return;
      const key = Math.round((X(x) - L) / bw); stackH[key] = (stackH[key] || 0) + 1;
      const yTop = y1b - pop.pdf(x) / mx * (y1b - y1) * 0.5, yEnd = y2b - r - (stackH[key] - 1) * r * 1.9;
      const Y = f >= 1 ? yEnd : yTop + (yEnd - yTop) * easeIn(f);
      ctx.fillStyle = withAlpha(P.water, 0.9); ctx.beginPath(); ctx.arc(X(x), Y, r, 0, 7); ctx.fill();
      if (f < 1) { ctx.strokeStyle = withAlpha(P.water, 0.25); ctx.lineWidth = r * 0.9; ctx.beginPath(); ctx.moveTo(X(x), Math.max(yTop, Y - 30)); ctx.lineTo(X(x), Y); ctx.stroke(); }
    });
    meanProg = (prog - 0.72) / 0.28;
    if (prog >= 1) { commit(cur); st.cur = null; }
  } else if (showXs) {
    const stackH = {}; const bw = r * 2.1;
    showXs.forEach(x => { const key = Math.round((X(x) - L) / bw); stackH[key] = (stackH[key] || 0) + 1; ctx.fillStyle = withAlpha(P.water, 0.85); ctx.beginPath(); ctx.arc(X(x), y2b - r - (stackH[key] - 1) * r * 1.9, r, 0, 7); ctx.fill(); });
  }
  if (showXs && meanProg > -0.3) {
    const mX = X(showMean); ctx.fillStyle = P.magenta; ctx.strokeStyle = P.magenta; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(mX, y2b + 2); ctx.lineTo(mX - 7, y2b + 12); ctx.lineTo(mX + 7, y2b + 12); ctx.closePath(); ctx.fill();
    ctx.font = MONO(11, 600); ctx.textAlign = 'center'; ctx.fillText(`x̄ = ${nf(showMean, 1)} g`, mX, y2b + 26);
    if (meanProg > 0 && meanProg < 1) { const Y = y2b + 14 + (y3b - 6 - y2b - 14) * easeIn(meanProg); ctx.beginPath(); ctx.arc(mX, Y, 5, 0, 7); ctx.fill(); }
  }
  // sampling distribution of the mean
  const se = pop.sigma / Math.sqrt(p.n);
  panelTitle(P, L, y3t, 'Sampling distribution of the mean', `${st.k} sample means · SE = σ/√n = ${nf(se, 1)} g`);
  const c = st.hist.c; const cmax = Math.max(1, ...c); const w = st.hist.w;
  const theoPeak = st.k * w * S.normPdf(0, 0, se); const scale = (y3b - y3t - 36) / Math.max(cmax, theoPeak * 0.6, 4);
  for (let b = 0; b < c.length; b++) { if (!c[b]) continue; const X0 = X(st.hist.lo + b * w), X1 = X(st.hist.lo + (b + 1) * w); const h = c[b] * scale; ctx.fillStyle = withAlpha(P.magenta, 0.55); ctx.fillRect(X0 + 0.3, y3b - h, Math.max(1, X1 - X0 - 0.6), h); }
  if (st.k > 0) { // normal approximation N(μ, σ/√n)
    ctx.beginPath(); const xs = linspace(pop.mu - 4.5 * se, pop.mu + 4.5 * se, 160); xs.forEach((x, i) => { const Y = y3b - st.k * w * S.normPdf(x, pop.mu, se) * scale; i ? ctx.lineTo(X(x), Y) : ctx.moveTo(X(x), Y); });
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2; ctx.stroke();
    // SE bracket
    const yb = y3b - theoPeak * scale * 0.6; ctx.strokeStyle = P.amber; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(pop.mu - se), yb); ctx.lineTo(X(pop.mu + se), yb); ctx.moveTo(X(pop.mu - se), yb - 5); ctx.lineTo(X(pop.mu - se), yb + 5); ctx.moveTo(X(pop.mu + se), yb - 5); ctx.lineTo(X(pop.mu + se), yb + 5); ctx.stroke();
    ctx.fillStyle = P.amber; ctx.font = MONO(11, 600); ctx.textAlign = 'left'; ctx.fillText('±1 SE', X(pop.mu + se) + 6, yb + 4);
  }
  xAxis(P, pop.lo, pop.hi, y3b, X, 'Fresh weight (g)');
  // legend
  { const lg = 'bars: simulated means · black curve: normal N(μ, σ/√n) predicted by the CLT'; ctx.font = FONT(11.5); const lw = ctx.measureText(lg).width; ctx.fillStyle = P.bgElev; ctx.fillRect(R - lw - 4, y3t + 6, lw + 8, 16); ctx.textAlign = 'right'; ctx.fillStyle = P.muted; ctx.fillText(lg, R, y3t + 18); }
}

/* ---------- mode 2: confidence intervals ---------- */
function drawCI(P, now) {
  const p = params(); const L = 64, R = W - 150; const se = pop.sigma / Math.sqrt(p.n);
  const q = p.useZ ? 1.96 : S.tInv(1 - (1 - p.conf) / 2, p.n - 1);
  const span = Math.max(4.2 * se * (p.useZ ? 1 : q / 1.96), pop.sigma * 0.25);
  const x0 = pop.mu - span, x1 = pop.mu + span; const X = v => L + (v - x0) / (x1 - x0) * (R - L);
  const top = 86, bot = H - 58;
  panelTitle(P, L, top - 18, `${100 * p.conf} % confidence intervals`, `n = ${p.n} · x̄ ± ${p.useZ ? 'z' : 't'}·s/√n, ${p.useZ ? 'z = ' + q.toFixed(2) + ' (wrong for small n!)' : `t = ${q.toFixed(2)} (df ${p.n - 1})`}`);
  if (!st.cur && st.queue.length) { st.cur = st.queue.shift(); st.cur.t0 = now; }
  if (st.cur) { const Ts = Math.max(0.06, Math.min(1.2, 0.8 / Math.pow(clock.speed, 0.7))); if ((now - st.cur.t0) / 1000 >= Ts) { commit(st.cur); st.cur = null; } }
  const rows = 100, rh = (bot - top - 8) / rows;
  // true mean
  ctx.strokeStyle = P.ink; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(X(pop.mu), top - 6); ctx.lineTo(X(pop.mu), bot); ctx.stroke();
  ctx.fillStyle = P.ink; ctx.font = FONT(11.5, 650); ctx.textAlign = 'left'; ctx.fillText(`μ = ${nf(pop.mu, 0)} g`, X(pop.mu) + 6, top + 4);
  st.ci.forEach((c, i) => {
    const age = (now - c.t) / 1000; const slide = ease(age / 0.35); const Y = top + 8 + (i - 1 + slide) * rh + rh / 2; if (Y > bot) return;
    const col = c.hit ? P.water : P.danger; ctx.strokeStyle = withAlpha(col, c.hit ? 0.75 : 1); ctx.lineWidth = Math.max(1.2, Math.min(3, rh * 0.55)) * (c.hit ? 1 : 1.35);
    ctx.beginPath(); ctx.moveTo(Math.max(L - 30, X(c.lo)), Y); ctx.lineTo(Math.min(R + 30, X(c.hi)), Y); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(c.m), Y, Math.max(1.5, Math.min(3.2, rh * 0.5)), 0, 7); ctx.fill();
  });
  // coverage box
  const last = st.ci.length, hits = st.ci.filter(c => c.hit).length;
  const bx = R + 22; ctx.textAlign = 'left'; ctx.fillStyle = P.muted; ctx.font = FONT(11.5, 600); ctx.fillText('last 100', bx, top + 24);
  ctx.fillStyle = P.ink; ctx.font = FONT(30, 700); ctx.fillText(last ? `${hits}` : '—', bx, top + 58); ctx.font = FONT(12, 500); ctx.fillStyle = P.muted; ctx.fillText(`of ${last} caught μ`, bx, top + 76);
  ctx.fillStyle = P.muted; ctx.font = FONT(11.5, 600); ctx.fillText('all intervals', bx, top + 112);
  ctx.fillStyle = st.ciAll && Math.abs(st.ciHit / st.ciAll - p.conf) > 2.5 * Math.sqrt(p.conf * (1 - p.conf) / st.ciAll) ? P.danger : P.accent; ctx.font = FONT(24, 700); ctx.fillText(st.ciAll ? `${(100 * st.ciHit / st.ciAll).toFixed(1)} %` : '—', bx, top + 140);
  ctx.fillStyle = P.muted; ctx.font = FONT(12); ctx.fillText(`of ${st.ciAll} (target ${100 * p.conf} %)`, bx, top + 158);
  ctx.fillStyle = P.water; ctx.fillRect(bx, top + 190, 16, 3); ctx.fillStyle = P.ink2; ctx.fillText('contains μ', bx + 22, top + 195);
  ctx.fillStyle = P.danger; ctx.fillRect(bx, top + 210, 16, 3); ctx.fillStyle = P.ink2; ctx.fillText('misses μ', bx + 22, top + 215);
  xAxis(P, x0, x1, bot, X, 'Fresh weight (g)');
}

/* ---------- mode 3: dance of the p-values ---------- */
const starCol = (P, p) => p < 0.001 ? P.danger : p < 0.01 ? P.magenta : p < 0.05 ? P.amber : p < 0.1 ? P.water : P.muted;
const stars = p => p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : p < 0.1 ? '?' : '';
function drawDance(P, now) {
  const p = params(); const delta = p.d * pop.sigma; const se = pop.sigma * Math.sqrt(2 / p.n);
  const split = W * 0.58; const L = 64, R = split - 96; const x0 = Math.min(0, delta) - 3.6 * se, x1 = Math.max(0, delta) + 3.6 * se; const X = v => L + (v - x0) / (x1 - x0) * (R - L);
  const top = 86, bot = H - 58;
  panelTitle(P, L, top - 18, 'Replicate the experiment', `n = ${p.n}/group · true Δ = ${nf(delta, 1)} g`);
  if (!st.cur && st.queue.length) { st.cur = st.queue.shift(); st.cur.t0 = now; }
  if (st.cur) { const Ts = Math.max(0.06, Math.min(1.2, 0.8 / Math.pow(clock.speed, 0.7))); if ((now - st.cur.t0) / 1000 >= Ts) { commit(st.cur); st.cur = null; } }
  ctx.strokeStyle = P.muted; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(X(0), top - 4); ctx.lineTo(X(0), bot); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = P.muted; ctx.font = FONT(11, 600); ctx.textAlign = 'center'; ctx.fillText('H₀: no difference', X(0), top - 6 + 0);
  if (p.d > 0) { ctx.strokeStyle = P.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(delta), top + 8); ctx.lineTo(X(delta), bot); ctx.stroke(); ctx.fillStyle = P.accent; ctx.fillText('true Δ', X(delta), top + 6); }
  const rows = 25, rh = (bot - top - 16) / rows;
  st.exps.forEach((e, i) => {
    if (i >= rows) return; const age = (now - e.t0) / 1000; const slide = ease(age / 0.3); const Y = top + 16 + (i - 1 + slide) * rh + rh / 2;
    const col = starCol(P, e.p); ctx.globalAlpha = i === 0 ? slide : 1;
    ctx.strokeStyle = withAlpha(col, 0.85); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(Math.max(L - 10, X(e.lo)), Y); ctx.lineTo(Math.min(R + 10, X(e.hi)), Y); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(e.diff), Y, 4, 0, 7); ctx.fill();
    ctx.font = MONO(Math.min(12.5, rh * 0.75), 600); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(`p ${e.p < 0.001 ? '<' : '='} ${pTxt(e.p).replace('< ', '')} ${stars(e.p)}`, R + 16, Y); ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
  });
  xAxis(P, x0, x1, bot, X, 'Difference in mean fresh weight (treatment − control, g)');
  // p-value histogram
  const hL = split + 28, hR = W - 24, hT = top + 14, hB = bot; const tot = st.pAll.length;
  panelTitle(P, hL, top - 18, 'Distribution of p', `${tot} experiments`);
  const c = st.pHist; const expect = tot / 20; const cmax = Math.max(expect * 1.8, ...c, 1); const bw = (hR - hL) / 20;
  c.forEach((v, b) => { const h = v / cmax * (hB - hT - 20); ctx.fillStyle = withAlpha((b + 1) / 20 <= p.alpha + 1e-9 ? P.accent : P.water, (b + 1) / 20 <= p.alpha + 1e-9 ? 0.85 : 0.45); ctx.fillRect(hL + b * bw + 1, hB - h, bw - 2, h); });
  if (tot) { const Y = hB - expect / cmax * (hB - hT - 20); ctx.strokeStyle = P.ink; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(hL, Y); ctx.lineTo(hR, Y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = P.ink; ctx.font = FONT(11, 600); ctx.textAlign = 'right'; ctx.fillText('if H₀ were true (uniform)', hR, Y - 5); }
  ctx.strokeStyle = P.lineStrong; ctx.beginPath(); ctx.moveTo(hL, hB + 0.5); ctx.lineTo(hR, hB + 0.5); ctx.stroke();
  ctx.fillStyle = P.muted; ctx.font = MONO(10.5); ctx.textAlign = 'center'; ctx.textBaseline = 'top'; [0, 0.25, 0.5, 0.75, 1].forEach(v => ctx.fillText(v === 0 ? '0' : v === 1 ? '1' : String(v).replace(/^0/, ''), hL + v * (hR - hL), hB + 6));
  ctx.fillStyle = P.ink2; ctx.font = FONT(11.5, 600); ctx.fillText('p-value', (hL + hR) / 2, hB + 22); ctx.textBaseline = 'alphabetic';
  const pw = XS.powerT(p.d, p.n, { alpha: p.alpha });
  ctx.textAlign = 'right'; ctx.fillStyle = P.accent; ctx.font = FONT(22, 700); ctx.fillText(tot ? `${(100 * st.rej / tot).toFixed(1)} %` : '—', hR, hT + 22);
  ctx.fillStyle = P.ink2; ctx.font = FONT(12, 500); ctx.fillText(`had p < ${String(p.alpha).replace(/^0/, '')} (${p.d === 0 ? 'false positives; expected' : 'power; theory'} ${(100 * (p.d === 0 ? p.alpha : pw)).toFixed(0)} %)`, hR, hT + 40);
}

/* ---------- mode 4: power ---------- */
const tw = { df: 10, ncp: 2, tc: 2, from: null, t0: 0 };
function targetPower() { const p = params(); const df = 2 * p.n - 2; return { df, ncp: p.d * Math.sqrt(p.n / 2), tc: S.tInv(1 - p.alpha / 2, df) }; }
function drawPower(P, now) {
  const p = params(); const tgt = targetPower();
  if (!tw.from || tw.key !== JSON.stringify(tgt)) { tw.from = { df: tw.df, ncp: tw.ncp, tc: tw.tc }; tw.to = tgt; tw.t0 = now; tw.key = JSON.stringify(tgt); }
  const k = ease((now - tw.t0) / 450); tw.df = tw.from.df + (tw.to.df - tw.from.df) * k; tw.ncp = tw.from.ncp + (tw.to.ncp - tw.from.ncp) * k; tw.tc = tw.from.tc + (tw.to.tc - tw.from.tc) * k;
  const { df, ncp, tc } = tw;
  if (!st.cur && st.queue.length) { st.cur = st.queue.shift(); st.cur.t0 = now; }
  if (st.cur) { const Ts = Math.max(0.05, Math.min(0.8, 0.6 / Math.pow(clock.speed, 0.7))); if ((now - st.cur.t0) / 1000 >= Ts) { commit(st.cur); st.cur = null; } }
  const L = 64, R = W - 26, top = 124, bot = H - 96; const t0 = Math.min(-4.2, -tc - 1.2), t1 = Math.max(4.2, ncp + 4.2); const X = v => L + (v - t0) / (t1 - t0) * (R - L);
  const ck = [df.toFixed(4), ncp.toFixed(4), tc.toFixed(4), t0.toFixed(3), t1.toFixed(3)].join('|');
  if (tw.ck !== ck) { const ts = linspace(t0, t1, 300); tw.cache = { ts, h0: ts.map(t => S.tPdf(t, df)), d1: ncp > 1e-6 ? ts.map(t => Xd(t, df, ncp)) : ts.map(t => S.tPdf(t, df)) }; tw.ck = ck; }
  const { ts, h0, d1 } = tw.cache;
  const ymax = Math.max(...h0, ...d1) * 1.1; const Y = v => bot - v / ymax * (bot - top);
  panelTitle(P, L, top - 44, 'Two sampling distributions of the t statistic', `n = ${p.n} per group · df = ${Math.round(df)} · d = ${p.d.toFixed(2)} · α = ${String(p.alpha).replace(/^0/, '')}`);
  const fillArea = (arr, a, b, col) => { ctx.beginPath(); let started = false; ts.forEach((t, i) => { if (t < a || t > b) return; if (!started) { ctx.moveTo(X(t), bot); started = true; } ctx.lineTo(X(t), Y(arr[i])); }); if (!started) return; ctx.lineTo(X(Math.min(b, t1)), bot); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };
  // H1: power (green) outside, beta (amber) inside
  fillArea(d1, tc, t1, withAlpha(P.accent, 0.35)); fillArea(d1, t0, -tc, withAlpha(P.accent, 0.35)); fillArea(d1, -tc, tc, withAlpha(P.amber, 0.28));
  fillArea(h0, tc, t1, withAlpha(P.danger, 0.55)); fillArea(h0, t0, -tc, withAlpha(P.danger, 0.55));
  const line = (arr, col, w, dash) => { ctx.beginPath(); ts.forEach((t, i) => i ? ctx.lineTo(X(t), Y(arr[i])) : ctx.moveTo(X(t), Y(arr[i]))); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); };
  line(h0, P.ink, 2); line(d1, P.accent, 2.6);
  [-tc, tc].forEach(c => { ctx.strokeStyle = P.danger; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(X(c), top - 10); ctx.lineTo(X(c), bot); ctx.stroke(); ctx.setLineDash([]); });
  ctx.fillStyle = P.danger; ctx.font = MONO(11, 600); ctx.textAlign = 'center'; ctx.fillText(`−t crit = ${nf(-tc, 2)}`, X(-tc), top - 14); ctx.fillText(`t crit = ${nf(tc, 2)}`, X(tc), top - 14);
  // labels
  const power = X_power(p); const beta = 1 - power;
  ctx.font = FONT(12.5, 650); ctx.fillStyle = P.ink; ctx.textAlign = 'center'; ctx.fillText('H₀ true (d = 0)', X(0), Y(S.tPdf(0, df)) - 10);
  if (ncp > 0.3) { ctx.fillStyle = P.accent; ctx.fillText(`H₁ true (d = ${p.d.toFixed(2)})`, X(ncp), Y(Xd(ncp, df, ncp)) - 10); }
  const box = (x, y, col, t1s, t2s) => { ctx.fillStyle = withAlpha(col, 0.14); ctx.strokeStyle = col; ctx.lineWidth = 1; const w = 128; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, 40, 8) : ctx.rect(x, y, w, 40); ctx.fill(); ctx.stroke(); ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.font = FONT(11.5, 700); ctx.fillText(t1s, x + 10, y + 16); ctx.font = MONO(12.5, 600); ctx.fillText(t2s, x + 10, y + 32); };
  box(R - 140, top - 4, P.accent, 'Power 1 − β', `${(100 * power).toFixed(1)} %`);
  box(R - 140, top + 44, P.amber, 'β (miss a real effect)', `${(100 * beta).toFixed(1)} %`);
  box(R - 140, top + 92, P.danger, 'α (false positive)', `${(100 * p.alpha).toFixed(1)} %`);
  // simulated experiments rain on the axis
  st.tvals.forEach((e, i) => { const age = (now - e.t0) / 1000; const f = ease(age / 0.5); if (e.t < t0 || e.t > t1) return; ctx.fillStyle = withAlpha(e.rej ? P.accent : P.amber, i < 40 ? 0.9 : 0.35); const yy = bot + 12 + (i % 6) * 5; ctx.beginPath(); ctx.arc(X(e.t), bot - 40 + (yy - bot + 40) * f, 2.6, 0, 7); ctx.fill(); });
  // axis in t and in grams
  const ax = bot + 44; ctx.strokeStyle = P.lineStrong; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, bot + 0.5); ctx.lineTo(R, bot + 0.5); ctx.stroke();
  ctx.fillStyle = P.muted; ctx.font = MONO(10.5); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let v = Math.ceil(t0); v <= t1; v++) { ctx.fillText(String(v).replace('-', '−'), X(v), bot + 4); }
  const g = pop.sigma * Math.sqrt(2 / p.n); ctx.fillStyle = P.ink2; ctx.font = FONT(11.5, 600); ctx.fillText('t statistic of a two-sample test (dots: simulated experiments, green = significant)', (L + R) / 2, ax);
  ctx.fillStyle = P.muted; ctx.font = FONT(11, 500); ctx.fillText(`1 unit of t ≈ ${nf(g, 1)} g difference in means (σ√(2/n) with σ = ${nf(pop.sigma, 0)} g)`, (L + R) / 2, ax + 17); ctx.textBaseline = 'alphabetic';
}
const X_power = p => XS.powerT(p.d, p.n, { alpha: p.alpha });
const Xd = (t, df, ncp) => XS.dnt(t, df, ncp);

/* ---------- render loop ---------- */
let dirtyCharts = true, lastChart = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) return;
  if (visible) {  // the canvas is only redrawn while on screen …
    const P = palette(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    const mode = params().mode;
    try { if (mode === 'clt') drawCLT(P, now); else if (mode === 'ci') drawCI(P, now); else if (mode === 'pdance') drawDance(P, now); else drawPower(P, now); } catch (e) { console.error(e); }
  }
  // … but readouts and charts keep updating while the student scrolls down to look at them
  if (now - lastChart > 250) { lastChart = now; updateReadouts(); if (dirtyCharts) { dirtyCharts = false; updateCharts(); } }
}

/* =========================================================== readouts & charts */
let ro = null, roMode = '';
function updateReadouts() {
  const p = params(); const el = $('#readouts');
  if (roMode !== p.mode) { roMode = p.mode; el.innerHTML = ''; ro = new Readouts(el); const defs = {
    clt: [['se', 'Standard error σ/√n', 'g', 2], ['sdm', 'SD of simulated means', 'g', 2], ['mm', 'Mean of the means', 'g', 1], ['skp', 'Skewness of population', '', 2], ['skm', 'Skewness of the means', '', 2], ['k', 'Samples drawn', '', 0]],
    ci: [['cov', 'Coverage (all intervals)', '%', 1], ['last', 'Caught μ, last 100', '', 0], ['w', 'Mean interval width', 'g', 1], ['q', 'Multiplier used', '', 3], ['k', 'Intervals drawn', '', 0]],
    pdance: [['rej', 'Share with p < α', '%', 1], ['pw', 'Theoretical power', '%', 1], ['med', 'Median p', '', 3], ['k', 'Experiments', '', 0]],
    power: [['pw', 'Power (exact, noncentral t)', '%', 1], ['beta', 'β', '%', 1], ['ncp', 'Noncentrality δ = d√(n/2)', '', 2], ['need', 'n for 80 % power', 'per group', 0], ['emp', 'Simulated power', '%', 1]] }[p.mode];
    defs.forEach(([id, label, unit, digits]) => ro.add({ id, label, unit, digits })); }
  const se = pop.sigma / Math.sqrt(p.n);
  if (p.mode === 'clt') {
    const k = st.k, m = k ? st.sumM / k : NaN, v = k > 1 ? (st.sumM2 / k - m * m) * k / (k - 1) : NaN; const sdm = Math.sqrt(v);
    const m3 = k > 2 ? st.sumM3 / k - 3 * m * st.sumM2 / k + 2 * m ** 3 : NaN; const skm = m3 / Math.pow(v * (k - 1) / k, 1.5);
    ro.set('se', se); ro.set('sdm', sdm, k > 50 ? (Math.abs(sdm / se - 1) < 0.08 ? 'ok' : 'warn') : null, k > 50 ? `ratio to σ/√n: ${(sdm / se).toFixed(3)}` : 'draw more samples');
    ro.set('mm', m, null, `μ = ${nf(pop.mu, 0)} g`); ro.set('skp', pop.skew); ro.set('skm', skm, k > 100 ? (Math.abs(skm) < 0.3 ? 'ok' : 'warn') : null, `theory γ/√n = ${nf(pop.skew / Math.sqrt(p.n), 2)}`); ro.set('k', k);
    hud.set('a', `Samples <b>${k}</b> · n = ${p.n}`); hud.set('b', `SE = σ/√n = <b>${nf(se, 1)} g</b>`);
    saveInfo = { mode: 'CLT', population: pop.label, n: p.n, SE_theory: +se.toFixed(2), SD_of_means: +sdm.toFixed(2), skew_of_means: +skm.toFixed(3), samples: k };
  } else if (p.mode === 'ci') {
    const cov = st.ciAll ? 100 * st.ciHit / st.ciAll : NaN; const q = p.useZ ? 1.96 : S.tInv(1 - (1 - p.conf) / 2, p.n - 1);
    const sdev = st.ciAll ? 2.5 * 100 * Math.sqrt(p.conf * (1 - p.conf) / st.ciAll) : 0;
    ro.set('cov', cov, st.ciAll > 30 ? (Math.abs(cov - 100 * p.conf) <= sdev ? 'ok' : 'bad') : null, `nominal ${100 * p.conf} %`); ro.set('last', st.ci.filter(c => c.hit).length, null, `of ${st.ci.length}`);
    ro.set('w', st.ciAll ? st.ciWidth / st.ciAll : NaN); ro.set('q', q, p.useZ && p.n < 30 ? 'warn' : null, p.useZ ? 'z (ignores that s is estimated)' : `t, df = ${p.n - 1}`); ro.set('k', st.ciAll);
    hud.set('a', `Intervals <b>${st.ciAll}</b> · coverage <b>${isFinite(cov) ? cov.toFixed(1) + ' %' : '—'}</b>`); hud.set('b', `${p.useZ ? 'z' : 't'} interval · n = ${p.n}`);
    saveInfo = { mode: 'CI', population: pop.label, n: p.n, level: p.conf, multiplier: p.useZ ? 'z' : 't', coverage_pct: +cov.toFixed(2), intervals: st.ciAll };
  } else {
    const tot = st.pAll.length; const pw = XS.powerT(p.d, p.n, { alpha: p.alpha }); const emp = tot ? 100 * st.rej / tot : NaN;
    if (p.mode === 'pdance') {
      ro.set('rej', emp, null, p.d === 0 ? 'false-positive rate' : 'empirical power'); ro.set('pw', 100 * pw, null, pop.kind === 'normal' ? 'noncentral t' : 'normal-theory approximation'); ro.set('med', tot ? S.median(st.pAll) : NaN); ro.set('k', tot);
      hud.set('a', `Experiments <b>${tot}</b> · p < α in <b>${isFinite(emp) ? emp.toFixed(1) + ' %' : '—'}</b>`); hud.set('b', `d = ${p.d.toFixed(2)} · n = ${p.n} per group`);
    } else {
      const need = XS.sampleSizeT(p.d, 0.8, { alpha: p.alpha });
      ro.set('pw', 100 * pw, pw >= 0.8 ? 'ok' : pw >= 0.5 ? 'warn' : 'bad'); ro.set('beta', 100 * (1 - pw)); ro.set('ncp', p.d * Math.sqrt(p.n / 2)); ro.set('need', need); ro.set('emp', emp, null, tot ? `${tot} simulated experiments` : 'press Play or +100');
      hud.set('a', `Power <b>${(100 * pw).toFixed(1)} %</b> · β = ${(100 * (1 - pw)).toFixed(1)} %`); hud.set('b', `simulated <b>${tot ? emp.toFixed(1) + ' %' : '—'}</b> of ${tot}`);
    }
    saveInfo = { mode: p.mode, population: pop.label, n: p.n, d: p.d, alpha: p.alpha, theoretical_power_pct: +(100 * pw).toFixed(1), simulated_pct: +emp.toFixed(1), experiments: tot };
  }
}
const cSE = new Plot('#chart-se', { x: { label: 'Sample size n', min: 1, max: 100, log: true }, y: { label: 'Standard error', unit: 'g', min: 0 }, y2: { label: 'Skewness of x̄', min: 0 }, legend: true });
const cCov = new Plot('#chart-cov', { x: { label: 'Number of intervals', min: 0 }, y: { label: 'Coverage', unit: '%', min: 50, max: 100 }, legend: true });
const cP = new Plot('#chart-p', { x: { label: 'p-value threshold u', min: 0, max: 1 }, y: { label: 'Share of experiments with p ≤ u', min: 0, max: 1 }, legend: true });
const cPow = new Plot('#chart-pow', { x: { label: 'n per group', min: 2, max: 60 }, y: { label: 'Power', min: 0, max: 1, format: v => Math.round(v * 100) + '%' }, legend: true });
function updateCharts() {
  const p = params(); const ns = linspace(1, 100, 200);
  cSE.line('se', ns, ns.map(n => pop.sigma / Math.sqrt(n)), { color: 'accent', width: 2.4, label: 'σ/√n (theory)' });
  cSE.line('sk', ns, ns.map(n => pop.skew / Math.sqrt(n)), { color: 'magenta', width: 2, dash: [6, 4], label: 'skewness γ/√n', y2: true });
  const k = st.k; const cur = []; if (k > 20) { const m = st.sumM / k; cur.push([p.n, Math.sqrt((st.sumM2 / k - m * m) * k / (k - 1))]); }
  const hs = history.filter(h => h.kind === p.pop && h.sigma === p.sigma && h.mu === p.mu);
  cSE.scatter('emp', [...hs.map(h => h.n), ...cur.map(c => c[0])], [...hs.map(h => h.sd), ...cur.map(c => c[1])], { color: 'accent', r: 5, label: 'simulated SD of means', shape: 'diamond' });
  cSE.vline('n', p.n, { color: 'muted', label: `n = ${p.n}` });
  const tr = st.covTrace; const K = Math.max(100, tr.length ? tr[tr.length - 1][0] : 100);
  const ks = linspace(5, K, 120); const c = p.conf;
  cCov.band('band', ks, ks.map(k => 100 * (c - 1.96 * Math.sqrt(c * (1 - c) / k))), ks.map(k => 100 * Math.min(1, c + 1.96 * Math.sqrt(c * (1 - c) / k))), { color: 'water', alpha: 0.15, label: '95 % range if calibrated' });
  cCov.hline('nom', 100 * c, { color: 'ink', label: `nominal ${100 * c} %` });
  cCov.line('cov', tr.map(t => t[0]), tr.map(t => t[1]), { color: 'magenta', width: 2, label: 'running coverage' });
  cCov.setAxis('x', { min: 0, max: K });
  // p-value CDF: theory P(p ≤ u) = power at α = u
  const us = linspace(0.001, 1, 120); const df = 2 * p.n - 2, ncp = p.d * Math.sqrt(p.n / 2);
  cP.line('h0', [0, 1], [0, 1], { color: 'muted', width: 1.6, dash: [5, 4], label: 'H₀ true (uniform)' });
  cP.line('th', [0, ...us], [0, ...us.map(u => { const tc = S.tInv(1 - u / 2, df); return 1 - XS.pnt(tc, df, ncp) + XS.pnt(-tc, df, ncp); })], { color: 'accent', width: 2.4, label: `theory, d = ${p.d.toFixed(2)}, n = ${p.n}` });
  const ps = st.pAll.slice().sort((a, b) => a - b); const step = Math.max(1, Math.floor(ps.length / 200));
  const ex = [], ey = []; for (let i = 0; i < ps.length; i += step) { ex.push(ps[i]); ey.push((i + 1) / ps.length); }
  cP.scatter('emp', ex, ey, { color: 'magenta', r: 2.6, label: `simulated (${ps.length})` });
  cP.vline('a', p.alpha, { color: 'danger', label: 'α' });
  const nn = linspace(2, 60, 59);
  [0.5, 0.8, 1.2].forEach((d, i) => cPow.line('d' + i, nn, nn.map(n => XS.powerT(d, n, { alpha: p.alpha })), { color: ['c3', 'c0', 'c1'][i], width: d === 0.8 ? 1.4 : 1.4, dash: [4, 3], label: `d = ${d}` }));
  cPow.line('cur', nn, nn.map(n => XS.powerT(p.d, n, { alpha: p.alpha })), { color: 'magenta', width: 2.8, label: `your d = ${p.d.toFixed(2)}` });
  const runs = [...powerRuns.values()].filter(r => Math.abs(r.d - p.d) < 1e-9 && r.alpha === p.alpha && r.k >= 20);
  cPow.scatter('sim', runs.map(r => r.n), runs.map(r => r.rej / r.k), { color: 'ink', r: 4.5, shape: 'square', label: 'simulated', yErr: runs.map(r => 1.96 * Math.sqrt(Math.max(1e-6, r.rej / r.k * (1 - r.rej / r.k)) / r.k)) });
  cPow.hline('t', 0.8, { color: 'amber', label: '80 %' });
}

/* =========================================================== wiring */
let lastKey = '';
ui.onChange((s, id) => {
  const p = params(); clock.speed = p.speed;
  ui.show('sep', p.pop === 'bimodal'); ui.show('conf', p.mode === 'ci' || p.mode === 'pdance'); ui.show('useZ', p.mode === 'ci'); ui.show('d', p.mode === 'pdance' || p.mode === 'power'); ui.show('alpha', p.mode === 'pdance' || p.mode === 'power');
  const key = [p.pop, p.mu, p.sigma, p.sep, p.n, p.mode, p.useZ, p.conf, p.d, p.alpha].join('|');
  if (key !== lastKey) { lastKey = key; if (id !== 'speed') reset(); }
  dirtyCharts = true;
});
reset(); { const p = params(); clock.speed = p.speed; ui.show('sep', p.pop === 'bimodal'); ui.show('conf', p.mode === 'ci' || p.mode === 'pdance'); ui.show('useZ', p.mode === 'ci'); ui.show('d', p.mode === 'pdance' || p.mode === 'power'); ui.show('alpha', p.mode === 'pdance' || p.mode === 'power'); lastKey = [p.pop, p.mu, p.sigma, p.sep, p.n, p.mode, p.useZ, p.conf, p.d, p.alpha].join('|'); }
// start with some history so charts are not empty, then animate
bulk(params().mode === 'clt' ? 40 : 30);
requestAnimationFrame(frame);
clock.play();
window.__sd = { st: () => st, pop: () => pop, bulk, clock };
