/* Neural network playground for yield — UI, live training, animated network, charts,
   and a back-propagation step-through on a tiny 2–3–1 network.
   Network: ./mlp.js   ·   synthetic greenhouse data: ./gen.js (see the Derive tab). */
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, BarChart, linspace, downloadCSV } from '/assets/js/plot.js';
import { mean, ols, mulberry32, randn, shuffle } from '/assets/js/stats.js';
import { withAlpha } from '/assets/js/colors.js';
import { MLP, ACT, scaler } from './mlp.js';
import { INPUTS, generate, split, trueYield } from './gen.js';

const $ = s => document.querySelector(s);
const sig = (v, d = 3) => (Number.isFinite(v) ? (+v.toPrecision(d)).toLocaleString('en-GB', { maximumFractionDigits: 6 }) : '—');
const POS = '#5cc8ef', NEG = '#f2994a', INK = '#e6eee9', MUTED = '#8fa39a';

/* ======================================================================= controls */
const ui = new Controls('#controls', { url: true });
ui.segmented({ id: 'mode', label: 'Mode', options: [{ value: 'train', label: 'Train the network' }, { value: 'bp', label: 'Backprop step-through' }], value: 'train' });
const playBtns = ui.buttons([{ label: '❚❚ Pause', variant: 'primary', onClick: () => togglePlay() }, { label: 'Step one epoch', onClick: () => { pause(); trainEpochs(1); refreshAll(true); } }, { label: 'Reset weights', onClick: () => { resetNet(); refreshAll(true); } }]);
const bestBtn = ui.button({ label: 'Early stopping: restore the best-validation weights', onClick: () => restoreBest() });
const bpBtns = ui.buttons([{ label: '◀ Back', onClick: () => bpGo(-1) }, { label: 'Next step ▶', variant: 'primary', onClick: () => bpGo(1) }, { label: 'New example', onClick: () => { bpNewExample(); } }, { label: 'Reset tiny net', onClick: () => { bpReset(); } }]);
ui.slider({ id: 'bplr', label: 'Learning rate of the tiny network η', min: 0.05, max: 2, step: 0.05, value: 0.5, help: 'Step-through mode: one sample, loss L = ½(ŷ − y)² as in Lesson 10.2 (Eq. 10.2.8).' });
ui.section('Data (synthetic greenhouse)');
ui.slider({ id: 'n', label: 'Greenhouse cycles in the data set', min: 20, max: 3000, value: 400, log: true, format: v => Math.round(v).toLocaleString('en-GB'), help: 'Each sample = one cycle with its own DLI, temperature, CO₂ and VPD.' });
ui.slider({ id: 'noise', label: 'Noise (coefficient of variation)', min: 0, max: 0.3, step: 0.01, value: 0.08, format: v => Math.round(v * 100) + ' %' });
ui.slider({ id: 'val', label: 'Validation share', min: 0.1, max: 0.5, step: 0.05, value: 0.3, format: v => Math.round(v * 100) + ' %' });
ui.segmented({ id: 'design', label: 'How the inputs vary', options: [{ value: 'random', label: 'Designed experiment' }, { value: 'greenhouse', label: 'Real greenhouse' }], value: 'random', help: '“Real greenhouse”: sunny periods are bright, warm, dry and ventilated (low CO₂) — the inputs are correlated.' });
ui.number({ id: 'seed', label: 'Data seed', value: 42, step: 1, min: 1 });
INPUTS.forEach(v => ui.toggle({ id: 'use_' + v.key, label: `Input: ${v.long} (${v.label})`, value: true }));
ui.button({ label: 'Download the data set (CSV)', onClick: () => downloadCSV('synthetic-greenhouse-yield.csv', ['dli_mol_m2_d', 'temperature_C', 'co2_umol_mol', 'vpd_kPa', 'yield_g_head', 'noise_free_yield_g_head', 'set'], DATA.map((r, i) => [+r.dli.toFixed(3), +r.T.toFixed(3), +r.co2.toFixed(1), +r.vpd.toFixed(4), +r.y.toFixed(2), +r.ytrue.toFixed(2), SPLIT.isVal[i] ? 'validation' : 'training'])) });
ui.section('Network');
ui.slider({ id: 'layers', label: 'Hidden layers', min: 1, max: 3, step: 1, value: 1 });
ui.slider({ id: 'width', label: 'Neurons per hidden layer', min: 2, max: 32, step: 1, value: 12 });
ui.segmented({ id: 'act', label: 'Activation function', options: [{ value: 'tanh', label: 'tanh' }, { value: 'relu', label: 'ReLU' }, { value: 'sigmoid', label: 'sigmoid' }], value: 'tanh' });
ui.section('Training');
ui.segmented({ id: 'opt', label: 'Optimiser', options: [{ value: 'sgd', label: 'SGD' }, { value: 'momentum', label: 'Momentum' }, { value: 'adam', label: 'Adam' }], value: 'adam' });
ui.slider({ id: 'lr', label: 'Learning rate η', min: 0.0001, max: 1, value: 0.01, log: true, format: v => +v.toPrecision(2) + '' });
ui.segmented({ id: 'batch', label: 'Mini-batch size', options: [{ value: 1, label: '1' }, { value: 8, label: '8' }, { value: 32, label: '32' }, { value: 0, label: 'all' }], value: 32 });
ui.slider({ id: 'l2', label: 'L2 penalty λ', min: 0, max: 0.05, step: 0.0005, value: 0, digits: 4, help: 'Adds λ Σ w² to the loss: large weights (wiggly functions) become expensive.' });
ui.slider({ id: 'speed', label: 'Training speed', min: 1, max: 200, step: 1, value: 40, unit: 'epochs s⁻¹', help: 'Upper limit; large networks on large data sets train more slowly in the browser.' });
ui.presets([
  { label: 'Good default', values: { mode: 'train', n: 400, noise: 0.08, design: 'random', layers: 1, width: 12, act: 'tanh', opt: 'adam', lr: 0.01, batch: 32, l2: 0 }, onApply: () => { resetAll(); play(); } },
  { label: 'Few data, big network', values: { mode: 'train', n: 40, noise: 0.1, design: 'random', layers: 3, width: 32, act: 'relu', opt: 'adam', lr: 0.01, batch: 8, l2: 0 }, onApply: () => { resetAll(); play(); } },
  { label: '… now regularised', values: { mode: 'train', n: 40, noise: 0.1, design: 'random', layers: 3, width: 32, act: 'relu', opt: 'adam', lr: 0.01, batch: 8, l2: 0.02 }, onApply: () => { resetAll(); play(); } },
  { label: 'Learning rate too high', values: { mode: 'train', n: 400, design: 'random', layers: 1, width: 12, act: 'tanh', opt: 'sgd', lr: 0.9, batch: 1, l2: 0 }, onApply: () => { resetAll(); play(); } },
  { label: 'Correlated greenhouse data', values: { mode: 'train', n: 400, noise: 0.08, design: 'greenhouse', layers: 1, width: 12, act: 'tanh', opt: 'adam', lr: 0.01, batch: 32, l2: 0 }, onApply: () => { resetAll(); play(); } }
]);
ui.saveButton('neural-network', () => ro.values());

/* ======================================================================= readouts */
const ro = new Readouts('#readouts');
ro.add({ id: 'epoch', label: 'Epochs trained', unit: '', digits: 0 })
  .add({ id: 'train', label: 'Training RMSE', unit: 'g', digits: 1 })
  .add({ id: 'valr', label: 'Validation RMSE', unit: 'g', digits: 1 })
  .add({ id: 'r2', label: 'Validation R²', unit: '', digits: 3 })
  .add({ id: 'lin', label: 'Linear regression, validation RMSE', unit: 'g', digits: 1 })
  .add({ id: 'floor', label: 'Noise floor (true function)', unit: 'g', digits: 1 })
  .add({ id: 'params', label: 'Trainable parameters', unit: '', digits: 0 })
  .add({ id: 'ratio', label: 'Training samples per parameter', unit: '', digits: 2 });

/* ======================================================================= charts */
const chLoss = new Plot('#ch-loss', { x: { label: 'Epoch', min: 0 }, y: { label: 'RMSE', unit: 'g', log: true }, legend: true });
const chPvo = new Plot('#ch-pvo', { x: { label: 'Observed yield', unit: 'g head⁻¹' }, y: { label: 'Predicted yield', unit: 'g head⁻¹' }, legend: true, crosshair: false });
const pdPlots = INPUTS.map(v => new Plot('#pd-' + v.key, { x: { label: v.label, unit: v.unit, min: v.min, max: v.max }, y: { label: 'Yield', unit: 'g' }, legend: false, height: 190 }));
const chImp = new BarChart('#ch-imp', { y: { label: 'Increase in validation RMSE', unit: 'g', min: 0 }, legend: true });

/* ======================================================================= data & model state */
let DATA = [], SPLIT = null, KEYS = [], SCL = null, X = [], Y = [], YM = 0, YS = 1, LIN = null, NET = null, epoch = 0, HIST = [], BEST = null, FLOOR = NaN;
let playing = true, probe = 0, rng = mulberry32(1);
const params = () => ui.values();

function buildData() {
  const p = params();
  DATA = generate({ n: Math.round(p.n), noise: p.noise, design: p.design, seed: Math.round(p.seed) || 1 });
  const sp = split(DATA.length, p.val, Math.round(p.seed) || 1);
  SPLIT = { train: sp.train, val: sp.val, isVal: new Uint8Array(DATA.length) }; sp.val.forEach(i => { SPLIT.isVal[i] = 1; });
  FLOOR = Math.sqrt(mean(sp.val.map(i => (DATA[i].y - DATA[i].ytrue) ** 2)));
  buildFeatures();
  const ys = DATA.map(r => r.y), my = mean(ys);
  $('#nn-preview').innerHTML = `<table class="nn-prev"><caption class="muted" style="caption-side:top;text-align:left;font:500 .74rem var(--font-sans);padding-bottom:3px">First rows of the current data set — ${DATA.length} cycles (${SPLIT.train.length} training, ${SPLIT.val.length} validation); yield ${fmt(my, 0)} ± ${fmt(Math.sqrt(mean(ys.map(v => (v - my) ** 2))), 0)} g</caption><tr><th>DLI</th><th>T</th><th>CO₂</th><th>VPD</th><th>yield (g)</th><th>set</th></tr>${DATA.slice(0, 5).map((r, i) => `<tr><td>${fmt(r.dli, 1)}</td><td>${fmt(r.T, 1)}</td><td>${fmt(r.co2, 0)}</td><td>${fmt(r.vpd, 2)}</td><td>${fmt(r.y, 1)}</td><td class="${SPLIT.isVal[i] ? 'v' : ''}">${SPLIT.isVal[i] ? 'valid.' : 'train'}</td></tr>`).join('')}</table>`;
}
function buildFeatures() {
  const p = params();
  KEYS = INPUTS.filter(v => p['use_' + v.key]).map(v => v.key);
  if (!KEYS.length) { KEYS = ['dli']; ui.set('use_dli', true, true); }
  const tr = SPLIT.train.map(i => DATA[i]);
  SCL = scaler(tr, KEYS);
  X = DATA.map(r => SCL.x(r));
  YM = mean(tr.map(r => r.y)); YS = Math.sqrt(mean(tr.map(r => (r.y - YM) ** 2))) || 1;
  Y = DATA.map(r => (r.y - YM) / YS);
  const L = ols(SPLIT.train.map(i => Array.from(X[i])), SPLIT.train.map(i => Y[i]));
  LIN = L ? { beta: L.beta, predict: x => { let s = L.beta[0]; for (let j = 0; j < x.length; j++) s += L.beta[j + 1] * x[j]; return s; } } : { beta: [0], predict: () => 0 };
  PD_TRUE = null;
}
function resetNet() {
  const p = params();
  const sizes = [KEYS.length, ...Array(Math.round(p.layers)).fill(Math.round(p.width)), 1];
  NET = new MLP(sizes, p.act, 1000 + Math.round(p.seed) * 7 + sizes.join('').length);
  epoch = 0; HIST = []; BEST = null; rng = mulberry32(99);
  record();
}
function resetAll() { buildData(); resetNet(); refreshAll(true); }

const rmseG = (f, idx) => Math.sqrt(mean(idx.map(i => ((f(X[i]) - Y[i]) * YS) ** 2)));
function record() {
  const tr = Math.sqrt(NET.mse(X, Y, SPLIT.train)) * YS, va = Math.sqrt(NET.mse(X, Y, SPLIT.val)) * YS;
  HIST.push([epoch, tr, va]);
  if (HIST.length > 1500) HIST = HIST.filter((h, i) => i % 2 === 0 || i === HIST.length - 1);
  if (Number.isFinite(va) && (!BEST || va < BEST.val)) BEST = { val: va, epoch, snap: NET.snapshot() };
}
function trainEpochs(k) {
  const p = params();
  for (let e = 0; e < k; e++) {
    NET.epoch(X, Y, SPLIT.train, { batch: +p.batch, lr: p.lr, l2: p.l2, opt: p.opt, rng });
    epoch++;
    record();
    if (!Number.isFinite(HIST[HIST.length - 1][1])) { pause(); window.FFP?.toast?.('Training diverged — lower the learning rate and reset the weights'); break; }
  }
}
function restoreBest() { if (!BEST) return; pause(); NET.restore(BEST.snap); HIST.push([epoch, Math.sqrt(NET.mse(X, Y, SPLIT.train)) * YS, BEST.val]); refreshAll(true); window.FFP && FFP.toast && FFP.toast(`Restored the weights of epoch ${BEST.epoch} (validation RMSE ${fmt(BEST.val, 1)} g)`); }

/* ---------- play / pause: a SimClock whose "time" is measured in epochs (speed = epochs per second) ---------- */
let debt = 0, lastChart = 0, lastPD = 0, lastProbe = 0, visible = true;
const clock = new SimClock({
  speed: ui.get('speed'), maxDt: 1,
  onStep: dt => {
    if (ui.get('mode') !== 'train' || !NET || !playing) return;
    debt += dt; const t0 = performance.now();
    while (debt >= 1 && performance.now() - t0 < 14) { trainEpochs(1); debt -= 1; if (!playing) break; }
    if (debt > 3) debt = 3;
    if (epoch >= 20000) pause();
  }
});
function pause() { playing = false; clock.pause(); playBtns[0].innerHTML = '▶ Train'; }
function play() { if (ui.get('mode') !== 'train') return; playing = true; clock.speed = ui.get('speed'); clock.play(); playBtns[0].innerHTML = '❚❚ Pause'; }
function togglePlay() { playing ? pause() : play(); }
new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe($('#stage'));
function loop(now) {
  const p = params();
  if (playing && p.mode === 'train' && NET) {
    if (now - lastProbe > 1700) { lastProbe = now; probe = (probe + 1) % SPLIT.val.length; }
    if (now - lastChart > 160) { lastChart = now; drawLoss(); drawPvo(); drawReadouts(); }
    if (now - lastPD > 1200) { lastPD = now; drawPD(); drawImp(); }
  }
  if (visible) drawStage(now / 1000);
  requestAnimationFrame(loop);
}

/* ======================================================================= stage: network diagram */
const stageEl = $('#stage');
const cv = document.createElement('canvas'); stageEl.appendChild(cv); const ctx = cv.getContext('2d');
const hud = hudChips(stageEl);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'neural-network.png'; a.click(); } });
const legend = document.createElement('div'); legend.className = 'stage-legend'; stageEl.appendChild(legend);
legend.innerHTML = `<span style="color:${POS}">━</span> w &gt; 0 &nbsp;<span style="color:${NEG}">━</span> w &lt; 0 &nbsp;· width ∝ |w|<div style="margin-top:3px">node = activation: <span style="color:${NEG}">●</span> − <span style="color:#6b7a74">●</span> 0 <span style="color:${POS}">●</span> +</div>`;
const hint = document.createElement('div'); hint.className = 'stage-hint nn-hint'; stageEl.appendChild(hint);
const bpPanel = document.createElement('div'); bpPanel.className = 'nn-bp-panel'; bpPanel.hidden = true; stageEl.appendChild(bpPanel);
let W = 0, H = 0;
function resize() { const r = stageEl.getBoundingClientRect(); const d = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height; cv.width = Math.round(W * d); cv.height = Math.round(H * d); ctx.setTransform(d, 0, 0, d, 0, 0); }
new ResizeObserver(resize).observe(stageEl); resize();

const mix = (c1, c2, t) => { const a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16); const r = (a >> 16) + ((b >> 16) - (a >> 16)) * t, g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t, bl = (a & 255) + ((b & 255) - (a & 255)) * t; return `rgb(${r | 0},${g | 0},${bl | 0})`; };
const actColor = v => { const t = Math.max(-1, Math.min(1, v)); return t >= 0 ? mix('#35423d', POS, t) : mix('#35423d', NEG, -t); };
function layout(sizes) {
  const L = sizes.length; const left = 170, right = 190, top = 104, bottom = 64;
  const xs = sizes.map((_, l) => left + (W - left - right) * (L === 1 ? 0.5 : l / (L - 1)));
  return sizes.map((n, l) => { const avail = H - top - bottom; const sp = Math.min(44, avail / n); const y0 = top + (avail - sp * (n - 1)) / 2; return Array.from({ length: n }, (_, j) => ({ x: xs[l], y: y0 + j * sp, r: Math.max(3.2, Math.min(13, sp * 0.33)) })); });
}
function drawStage(t) {
  ctx.clearRect(0, 0, W, H);
  if (ui.get('mode') === 'bp') { drawBP(); return; }
  if (!NET) return;
  const vi = SPLIT.val[probe % SPLIT.val.length]; const row = DATA[vi];
  const yhat = NET.forward(X[vi]) * YS + YM;
  const P = layout(NET.sizes);
  // edges
  for (let l = 0; l < NET.L; l++) {
    const nin = NET.sizes[l], nout = NET.sizes[l + 1], Wl = NET.W[l]; let mx = 1e-9; for (let k = 0; k < Wl.length; k++) mx = Math.max(mx, Math.abs(Wl[k]));
    for (let j = 0; j < nout; j++) for (let i = 0; i < nin; i++) {
      const w = Wl[j * nin + i], m = Math.abs(w) / mx; if (m < 0.03) continue;
      const a = P[l][i], b = P[l + 1][j];
      ctx.strokeStyle = withAlpha(w > 0 ? POS : NEG, 0.08 + 0.6 * m); ctx.lineWidth = 0.4 + 3.2 * m;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  // signal pulses: strongest contributions |w·a| for the probed sample
  if (playing) {
    for (let l = 0; l < NET.L; l++) {
      const nin = NET.sizes[l], nout = NET.sizes[l + 1], Wl = NET.W[l], al = NET.a[l]; const c = [];
      for (let j = 0; j < nout; j++) for (let i = 0; i < nin; i++) c.push([Math.abs(Wl[j * nin + i] * al[i]), i, j, Wl[j * nin + i] * al[i]]);
      c.sort((u, v) => v[0] - u[0]); const top = c.slice(0, 40); const mx = top[0]?.[0] || 1;
      top.forEach(([m, i, j, s], k) => { const a = P[l][i], b = P[l + 1][j]; const ph = (t * 0.9 + k * 0.137 + l * 0.33) % 1; const x = a.x + (b.x - a.x) * ph, y = a.y + (b.y - a.y) * ph; ctx.fillStyle = withAlpha(s > 0 ? POS : NEG, 0.35 + 0.65 * m / mx); ctx.beginPath(); ctx.arc(x, y, 1.6 + 2.2 * m / mx, 0, Math.PI * 2); ctx.fill(); });
    }
  }
  // nodes
  const range = ACT[NET.act].range;
  P.forEach((col, l) => col.forEach((nd, j) => {
    let v = NET.a[l][j];
    if (l > 0 && l < NET.L) v = NET.act === 'sigmoid' ? 2 * v - 1 : NET.act === 'relu' ? Math.min(1, v / 2) : v;
    else if (l === 0) v = v / 2; else v = v / 2;
    ctx.fillStyle = actColor(v); ctx.strokeStyle = 'rgba(230,238,233,.55)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(nd.x, nd.y, l === 0 || l === NET.L ? 11 : nd.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }));
  // labels
  ctx.textBaseline = 'middle'; ctx.font = '600 12.5px Inter, sans-serif';
  P[0].forEach((nd, j) => { const k = KEYS[j], inp = INPUTS.find(v => v.key === k); ctx.fillStyle = INK; ctx.textAlign = 'right'; ctx.fillText(inp.label, nd.x - 18, nd.y - 7); ctx.fillStyle = MUTED; ctx.font = '500 11px "JetBrains Mono", monospace'; ctx.fillText(`${fmt(row[k], inp.digits)} ${inp.unit}`, nd.x - 18, nd.y + 8); ctx.font = '600 12.5px Inter, sans-serif'; });
  const o = P[NET.L][0]; ctx.textAlign = 'left'; ctx.fillStyle = INK; ctx.fillText(`ŷ = ${fmt(yhat, 0)} g`, o.x + 20, o.y - 16);
  ctx.font = '500 11px "JetBrains Mono", monospace'; ctx.fillStyle = MUTED; ctx.fillText(`observed y = ${fmt(row.y, 0)} g`, o.x + 20, o.y + 2); ctx.fillText(`noise-free = ${fmt(row.ytrue, 0)} g`, o.x + 20, o.y + 17);
  ctx.textAlign = 'center'; ctx.fillStyle = MUTED; ctx.font = '600 11px Inter, sans-serif';
  P.forEach((col, l) => { const lab = l === 0 ? `inputs (${col.length})` : l === NET.L ? 'output (linear)' : `hidden ${l} · ${col.length} ${NET.act}`; ctx.fillText(lab, col[0].x, 88); });
  hint.textContent = `probe: validation sample ${probe % SPLIT.val.length + 1}/${SPLIT.val.length} · click a point in the scatter plot to choose`;
}

/* ======================================================================= charts */
function drawLoss() {
  chLoss.clear(); if (!HIST.length) return;
  chLoss.line('tr', HIST.map(h => h[0]), HIST.map(h => h[1]), { color: 'water', width: 2, label: 'Training RMSE' });
  chLoss.line('va', HIST.map(h => h[0]), HIST.map(h => h[2]), { color: 'magenta', width: 2.4, label: 'Validation RMSE' });
  const lv = rmseG(LIN.predict, SPLIT.val); chLoss.hline('lin', lv, { color: 'amber', label: `linear regression ${fmt(lv, 1)} g` });
  if (Number.isFinite(FLOOR) && FLOOR > 0) chLoss.hline('floor', FLOOR, { color: 'muted', label: `noise floor ${fmt(FLOOR, 1)} g`, dash: [2, 3] });
  if (BEST && BEST.epoch > 0) chLoss.vline('best', BEST.epoch, { color: 'accent', label: `best validation (epoch ${BEST.epoch})` });
  chLoss.setAxis('x', { min: 0, max: Math.max(10, epoch) });
}
function drawPvo() {
  chPvo.clear(); if (!NET) return;
  const tr = SPLIT.train, va = SPLIT.val; const back = v => v * YS + YM;
  const lo = Math.min(...DATA.map(r => r.y)), hi = Math.max(...DATA.map(r => r.y));
  chPvo.line('one', [lo, hi], [lo, hi], { color: 'muted', dash: [4, 4], label: '1 : 1 line', width: 1.2 });
  const trS = tr.length > 600 ? tr.filter((_, i) => i % Math.ceil(tr.length / 600) === 0) : tr;
  chPvo.scatter('tr', trS.map(i => DATA[i].y), trS.map(i => back(NET.predict(X[i]))), { color: 'water', r: 2.6, hollow: true, label: 'Training samples' });
  if ($('#pvo-lin').checked) chPvo.scatter('lin', va.map(i => DATA[i].y), va.map(i => back(LIN.predict(X[i]))), { color: 'amber', r: 2.6, shape: 'diamond', label: 'Linear regression (validation)' });
  chPvo.scatter('va', va.map(i => DATA[i].y), va.map(i => back(NET.predict(X[i]))), { color: 'magenta', r: 3.4, label: 'Validation samples (network)' });
  const pi = va[probe % va.length]; chPvo.point('probe', DATA[pi].y, back(NET.predict(X[pi])), { color: 'accent', r: 6, label: 'probed sample' });
  chPvo.setAxis('x', { min: 0, max: hi * 1.05 }); chPvo.setAxis('y', { min: 0, max: hi * 1.05 });
}
chPvo.on('click', e => {
  if (!e.inside || !NET) return; const va = SPLIT.val; let best = -1, bd = Infinity;
  va.forEach((i, k) => { const dx = chPvo.px(DATA[i].y) - e.px, dy = chPvo.py(NET.predict(X[i]) * YS + YM) - e.py; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = k; } });
  if (best >= 0 && bd < 900) { probe = best; lastProbe = performance.now() + 4000; drawPvo(); }
});
$('#pvo-lin').addEventListener('change', drawPvo);

let PD_TRUE = null;
const PD_N = 21;
function pdRows() { const idx = DATA.map((_, i) => i); return idx.length > 160 ? shuffle(idx, mulberry32(5)).slice(0, 160) : idx; }
function pdFor(fn, key, rowsIdx) {
  const inp = INPUTS.find(v => v.key === key); const g = linspace(inp.min, inp.max, PD_N);
  return { g, y: g.map(v => mean(rowsIdx.map(i => fn({ ...DATA[i], [key]: v })))) };
}
function drawPD() {
  if (!NET) return; const rows = pdRows();
  if (!PD_TRUE) PD_TRUE = Object.fromEntries(INPUTS.map(v => [v.key, pdFor(trueYield, v.key, rows)]));
  const nnF = r => NET.predict(SCL.x(r)) * YS + YM, linF = r => LIN.predict(SCL.x(r)) * YS + YM;
  INPUTS.forEach((v, k) => {
    const pl = pdPlots[k]; pl.clear();
    const tp = PD_TRUE[v.key]; pl.line('true', tp.g, tp.y, { color: 'ink', width: 1.6, dash: [5, 4], label: 'true response (generator)' });
    if (KEYS.includes(v.key)) {
      const lp = pdFor(linF, v.key, rows), np = pdFor(nnF, v.key, rows);
      pl.line('lin', lp.g, lp.y, { color: 'amber', width: 1.6, label: 'linear regression' });
      pl.line('nn', np.g, np.y, { color: 'magenta', width: 2.6, label: 'neural network' });
    } else pl.text('off', (v.min + v.max) / 2, mean(tp.y), 'not used as input', { color: 'muted', align: 'center' });
    // rug of training data
    pl.custom('rug', (c, P, pal) => { c.strokeStyle = withAlpha(pal.muted, 0.5); c.lineWidth = 1; const y0 = P.plotRect.top + P.plotRect.height; SPLIT.train.slice(0, 300).forEach(i => { const X0 = P.px(DATA[i][v.key]); c.beginPath(); c.moveTo(X0, y0); c.lineTo(X0, y0 - 5); c.stroke(); }); });
  });
}
function permImportance(f) {
  const va = SPLIT.val; const base = rmseG(f, va); const r = mulberry32(17);
  return KEYS.map((k, j) => {
    const perm = shuffle(va, r); let s = 0;
    va.forEach((i, n) => { const x = Float64Array.from(X[i]); x[j] = X[perm[n]][j]; s += ((f(x) - Y[i]) * YS) ** 2; });
    return Math.max(0, Math.sqrt(s / va.length) - base);
  });
}
function drawImp() {
  if (!NET) return;
  const labs = KEYS.map(k => INPUTS.find(v => v.key === k).label);
  chImp.set(labs, [{ label: 'Neural network', values: permImportance(x => NET.predict(x)), color: 'magenta', format: v => fmt(v, 1) }, { label: 'Linear regression', values: permImportance(LIN.predict), color: 'amber', format: v => fmt(v, 1) }]);
}
function drawReadouts() {
  if (!NET || !HIST.length) return;
  const h = HIST[HIST.length - 1]; const lv = rmseG(LIN.predict, SPLIT.val);
  const va = SPLIT.val, yv = va.map(i => DATA[i].y), my = mean(yv); const sst = yv.reduce((s, v) => s + (v - my) ** 2, 0);
  const sse = va.reduce((s, i) => s + (NET.predict(X[i]) * YS + YM - DATA[i].y) ** 2, 0);
  ro.set('epoch', epoch, null, playing ? 'training…' : 'paused');
  if (!Number.isFinite(h[1])) { ro.set('train', NaN, 'bad', '<b>diverged</b> — lower η, then Reset weights'); ro.set('valr', NaN, 'bad', 'diverged'); ro.set('epoch', epoch, 'bad', 'paused'); return; }
  ro.set('train', h[1], null, h[2] > 1.5 * h[1] ? '<b>much lower than validation: over-fitting</b>' : 'fit to the data it learns from');
  ro.set('valr', h[2], h[2] < lv * 0.8 ? 'ok' : h[2] < lv ? 'warn' : 'bad', BEST ? `best ${fmt(BEST.val, 1)} g at epoch ${BEST.epoch}` : '');
  ro.set('r2', 1 - sse / sst, null, 'on data the network never trained on');
  ro.set('lin', lv, null, `baseline with ${KEYS.length + 1} coefficients`);
  ro.set('floor', FLOOR, null, 'RMSE of the noise-free generator — no model can beat it on average');
  ro.set('params', NET.nParams, null, NET.sizes.join('–'));
  const ratio = SPLIT.train.length / NET.nParams; ro.set('ratio', ratio, ratio >= 5 ? 'ok' : ratio >= 1 ? 'warn' : 'bad', ratio < 1 ? 'more parameters than data points!' : `${SPLIT.train.length} training samples`);
  hud.set('ep', `Epoch <b>${epoch}</b> · ${ui.get('opt') === 'sgd' ? 'SGD' : ui.get('opt') === 'momentum' ? 'SGD + momentum' : 'Adam'} · η = <b>${sig(ui.get('lr'), 2)}</b>`);
  hud.set('loss', `RMSE train <b>${fmt(h[1], 1)}</b> g · validation <b>${fmt(h[2], 1)}</b> g`);
  hud.set('arch', `${NET.sizes.join('–')} · <b>${NET.nParams}</b> parameters`);
}
function refreshAll(now) { drawLoss(); drawPvo(); drawReadouts(); if (now) { drawPD(); drawImp(); } }

/* ======================================================================= back-propagation step-through (2–3–1 tanh) */
const BP = { w1: null, b1: null, w2: null, b2: 0, step: 0, k: 0, x: [0, 0], y: 0, lossAfter: NaN };
const BP_STEPS = ['Inputs and target', 'Forward: hidden pre-activations', 'Forward: hidden activations', 'Forward: output and loss', 'Backward: output error and output gradients', 'Backward: hidden errors', 'Backward: input-weight gradients', 'Update the weights'];
function bpReset() {
  const r = mulberry32(2026 + Math.round(ui.get('seed')));
  const lim = Math.sqrt(6 / 5), r2 = v => Math.round(v * 100) / 100;
  BP.w1 = [0, 1, 2].map(() => [r2((2 * r() - 1) * lim), r2((2 * r() - 1) * lim)]); BP.b1 = [0, 0, 0];
  BP.w2 = [0, 1, 2].map(() => r2((2 * r() - 1) * Math.sqrt(6 / 4))); BP.b2 = 0;
  BP.step = 0; bpNewExample(true);
}
function bpNewExample(keepStep) {
  const tr = SPLIT.train; BP.k = tr[Math.floor(mulberry32(BP.k + 77)() * tr.length)];
  const row = DATA[BP.k]; const s = scaler(tr.map(i => DATA[i]), ['dli', 'T']);
  BP.x = Array.from(s.x(row)); BP.y = (row.y - YM) / YS; BP.row = row;
  if (!keepStep) BP.step = 0; bpCompute(); drawBPPanel();
}
function bpForward(w1, b1, w2, b2) { const z = w1.map((w, j) => w[0] * BP.x[0] + w[1] * BP.x[1] + b1[j]); const h = z.map(Math.tanh); const yh = w2.reduce((s, w, j) => s + w * h[j], b2); return { z, h, yh, L: 0.5 * (yh - BP.y) ** 2 }; }
function bpCompute() {
  const F = bpForward(BP.w1, BP.b1, BP.w2, BP.b2); Object.assign(BP, F);
  BP.dout = BP.yh - BP.y; BP.gw2 = BP.h.map(h => BP.dout * h); BP.gb2 = BP.dout;
  BP.dh = BP.h.map((h, j) => BP.dout * BP.w2[j] * (1 - h * h)); BP.gw1 = BP.dh.map(d => [d * BP.x[0], d * BP.x[1]]); BP.gb1 = BP.dh.slice();
  // numerical check of ∂L/∂w₁₁ by central differences
  const e = 1e-5; const wp = BP.w1.map(r => r.slice()), wm = BP.w1.map(r => r.slice()); wp[0][0] += e; wm[0][0] -= e;
  BP.num = (bpForward(wp, BP.b1, BP.w2, BP.b2).L - bpForward(wm, BP.b1, BP.w2, BP.b2).L) / (2 * e);
  const eta = ui.get('bplr');
  BP.nw1 = BP.w1.map((r, j) => r.map((w, k) => w - eta * BP.gw1[j][k])); BP.nb1 = BP.b1.map((b, j) => b - eta * BP.gb1[j]);
  BP.nw2 = BP.w2.map((w, j) => w - eta * BP.gw2[j]); BP.nb2 = BP.b2 - eta * BP.gb2;
  BP.after = bpForward(BP.nw1, BP.nb1, BP.nw2, BP.nb2);
}
function bpGo(d) {
  if (d > 0 && BP.step === BP_STEPS.length - 1) { BP.w1 = BP.nw1; BP.b1 = BP.nb1; BP.w2 = BP.nw2; BP.b2 = BP.nb2; BP.step = 0; bpCompute(); drawBPPanel(); window.FFP && FFP.toast && FFP.toast('Weights updated — the same example again: watch the loss fall'); return; }
  BP.step = Math.max(0, Math.min(BP_STEPS.length - 1, BP.step + d)); drawBPPanel();
}
const f3 = v => (Math.abs(v) < 5e-4 ? '0.000' : v.toFixed(3).replace('-', '−'));
const plus = v => (v < 0 ? `− ${f3(-v)}` : `+ ${f3(v)}`);
const t3 = v => (Math.abs(v) < 5e-4 ? '0.000' : v.toFixed(3));
const tex = (s, disp) => (window.FFP && FFP.tex ? FFP.tex(s, disp) : s);
function drawBPPanel() {
  const s = BP.step; const x = BP.x, r = BP.row; let html = `<div class="nn-bp-step">Step ${s + 1} of ${BP_STEPS.length}</div><h4>${BP_STEPS[s]}</h4>`;
  if (s === 0) html += `<p>A training example: DLI = ${fmt(r.dli, 1)} mol m⁻² d⁻¹, T = ${fmt(r.T, 1)} °C, yield = ${fmt(r.y, 0)} g. Standardised with the training-set means and SDs:</p><p class="nn-eq">${tex(`x_1 = ${t3(x[0])},\\quad x_2 = ${t3(x[1])},\\quad y = ${t3(BP.y)}`)}</p><p>The tiny network has 2 inputs, 3 tanh hidden neurons and a linear output: 13 parameters.</p>`;
  if (s === 1) html += `<p class="nn-eq">${tex('z_j = w_{j1}x_1 + w_{j2}x_2 + b_j')}</p>` + BP.z.map((z, j) => `<p class="nn-num">z${'₁₂₃'[j]} = (${f3(BP.w1[j][0])})(${f3(x[0])}) + (${f3(BP.w1[j][1])})(${f3(x[1])}) ${plus(BP.b1[j])} = <b>${f3(z)}</b></p>`).join('');
  if (s === 2) html += `<p class="nn-eq">${tex('h_j = \\tanh(z_j)')}</p>` + BP.h.map((h, j) => `<p class="nn-num">h${'₁₂₃'[j]} = tanh(${f3(BP.z[j])}) = <b>${f3(h)}</b></p>`).join('');
  if (s === 3) html += `<p class="nn-eq">${tex('\\hat y = \\sum_j w_{2,j}h_j + b_2,\\qquad L = \\tfrac12(\\hat y - y)^2')}</p><p class="nn-num">ŷ = ${BP.w2.map((w, j) => `(${f3(w)})(${f3(BP.h[j])})`).join(' + ')} ${plus(BP.b2)} = <b>${f3(BP.yh)}</b></p><p class="nn-num">L = ½(${f3(BP.yh)} − ${f3(BP.y)})² = <b>${BP.L.toFixed(4)}</b></p><p>In grams: ŷ = ${fmt(BP.yh * YS + YM, 0)} g versus y = ${fmt(r.y, 0)} g.</p>`;
  if (s === 4) html += `<p class="nn-eq">${tex('\\delta_{\\text{out}} = \\hat y - y,\\qquad \\frac{\\partial L}{\\partial w_{2,j}} = \\delta_{\\text{out}}\\,h_j,\\qquad \\frac{\\partial L}{\\partial b_2} = \\delta_{\\text{out}}')}</p><p class="nn-num">δ_out = ${f3(BP.yh)} − ${f3(BP.y)} = <b>${f3(BP.dout)}</b></p>` + BP.gw2.map((g, j) => `<p class="nn-num">∂L/∂w₂,${'₁₂₃'[j]} = (${f3(BP.dout)})(${f3(BP.h[j])}) = <b>${f3(g)}</b></p>`).join('');
  if (s === 5) html += `<p class="nn-eq">${tex('\\delta_j = \\delta_{\\text{out}}\\,w_{2,j}\\,(1-h_j^2)')}</p>` + BP.dh.map((d, j) => `<p class="nn-num">δ${'₁₂₃'[j]} = (${f3(BP.dout)})(${f3(BP.w2[j])})(1 − ${f3(BP.h[j])}²) = <b>${f3(d)}</b></p>`).join('') + `<p>The error flows backwards through each outgoing weight and is scaled by the local slope of tanh.</p>`;
  if (s === 6) html += `<p class="nn-eq">${tex('\\frac{\\partial L}{\\partial w_{jk}} = \\delta_j\\,x_k,\\qquad \\frac{\\partial L}{\\partial b_j} = \\delta_j')}</p>` + BP.gw1.map((g, j) => `<p class="nn-num">∂L/∂w${'₁₂₃'[j]}₁ = <b>${f3(g[0])}</b>, ∂L/∂w${'₁₂₃'[j]}₂ = <b>${f3(g[1])}</b></p>`).join('') + `<p class="nn-check">Gradient check: back-propagation gives ∂L/∂w₁₁ = ${BP.gw1[0][0].toFixed(6)}; central differences give ${BP.num.toFixed(6)} ✓</p>`;
  if (s === 7) html += `<p class="nn-eq">${tex('w \\leftarrow w - \\eta\\,\\frac{\\partial L}{\\partial w}')}</p><p class="nn-num">η = ${ui.get('bplr')}: e.g. w₁₁: ${f3(BP.w1[0][0])} → <b>${f3(BP.nw1[0][0])}</b>, w₂,₁: ${f3(BP.w2[0])} → <b>${f3(BP.nw2[0])}</b></p><p class="nn-num">Loss on this example: ${BP.L.toFixed(4)} → <b>${BP.after.L.toFixed(4)}</b> ${BP.after.L < BP.L ? '(fell ✓)' : '(rose — η too large!)'}</p><p>Press <em>Next step</em> to apply the update and start again with the new weights.</p>`;
  bpPanel.innerHTML = html;
  if (ui.get('mode') === 'bp') hud.set('loss', `Loss on this example L = ½(ŷ − y)² = <b>${BP.L.toFixed(4)}</b>`);
}
function drawBP() {
  if (!BP.w1) return;
  const s = BP.step; const cx = W * 0.64; const nodes = { x: [[W * 0.1, H * 0.36], [W * 0.1, H * 0.7]], h: [[W * 0.33, H * 0.26], [W * 0.33, H * 0.52], [W * 0.33, H * 0.78]], o: [W * 0.55, H * 0.52] };
  const fwd = s >= 1 && s <= 3, bwd = s >= 4 && s <= 6;
  const edge = (a, b, w, tpos, lab, glab, active, back) => {
    ctx.strokeStyle = withAlpha(w > 0 ? POS : NEG, 0.25 + 0.6 * Math.min(1, Math.abs(w))); ctx.lineWidth = 1 + 3 * Math.min(1.5, Math.abs(w));
    if (active) { ctx.shadowColor = back ? '#f07ad0' : POS; ctx.shadowBlur = 10; }
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.shadowBlur = 0;
    const mx = a[0] + (b[0] - a[0]) * tpos, my = a[1] + (b[1] - a[1]) * tpos;
    ctx.font = '600 10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(13,21,18,.88)'; ctx.fillRect(mx - 29, my - 16, 58, glab ? 29 : 15);
    ctx.fillStyle = INK; ctx.fillText(lab, mx, my - 8);
    if (glab) { ctx.fillStyle = '#f07ad0'; ctx.fillText(glab, mx, my + 6); }
  };
  const showG1 = s >= 6, showG2 = s >= 4;
  nodes.x.forEach((a, k) => nodes.h.forEach((b, j) => edge(a, b, BP.w1[j][k], k === 0 ? 0.3 : 0.64, `w=${f3(BP.w1[j][k])}`, showG1 ? `∇${f3(BP.gw1[j][k])}` : '', (fwd && s === 1) || (bwd && s === 6), bwd)));
  nodes.h.forEach((a, j) => edge(a, nodes.o, BP.w2[j], 0.45, `w=${f3(BP.w2[j])}`, showG2 ? `∇${f3(BP.gw2[j])}` : '', (fwd && s === 3) || (bwd && (s === 4 || s === 5)), bwd));
  const node = (p, r, val, lab, sub, hi) => { ctx.fillStyle = actColor(val); ctx.strokeStyle = hi ? '#f07ad0' : 'rgba(230,238,233,.7)'; ctx.lineWidth = hi ? 3 : 1.5; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = INK; ctx.font = '700 13px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(lab, p[0], p[1] + 4); if (sub) { ctx.font = '500 11px "JetBrains Mono", monospace'; ctx.fillStyle = MUTED; sub.forEach((t, i) => ctx.fillText(t, p[0], p[1] + r + 15 + i * 14)); } };
  node(nodes.x[0], 22, BP.x[0] / 2, 'x₁', ['DLI', `= ${f3(BP.x[0])}`], s === 0); node(nodes.x[1], 22, BP.x[1] / 2, 'x₂', ['T', `= ${f3(BP.x[1])}`], s === 0);
  nodes.h.forEach((p, j) => node(p, 22, s >= 2 ? BP.h[j] : 0, `h${'₁₂₃'[j]}`, [s >= 1 ? `z=${f3(BP.z[j])}` : '', s >= 2 ? `h=${f3(BP.h[j])}` : '', s >= 5 ? `δ=${f3(BP.dh[j])}` : ''].filter(Boolean), s === 1 || s === 2 || s === 5));
  node(nodes.o, 26, s >= 3 ? BP.yh / 2 : 0, 'ŷ', [s >= 3 ? `ŷ=${f3(BP.yh)}` : '', `y=${f3(BP.y)}`, s >= 3 ? `L=${BP.L.toFixed(4)}` : '', s >= 4 ? `δ=${f3(BP.dout)}` : ''].filter(Boolean), s === 3 || s === 4);
  ctx.fillStyle = s >= 4 ? '#f07ad0' : POS; ctx.font = '700 12px Inter, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(s === 0 ? 'The tiny network (2–3–1, tanh)' : s <= 3 ? 'FORWARD PASS  →' : s <= 6 ? '←  BACKWARD PASS (chain rule)' : 'GRADIENT-DESCENT UPDATE', W * 0.04, 76);
  ctx.fillStyle = MUTED; ctx.font = '500 11px Inter, sans-serif'; ctx.fillText('w = weight · magenta ∇ = gradient ∂L/∂w · node colour = activation', W * 0.04, H - 16);
}

/* ======================================================================= mode switching & events */
function applyMode() {
  const bp = ui.get('mode') === 'bp';
  playBtns[0].parentElement.style.display = bp ? 'none' : ''; bestBtn.parentElement.style.display = bp ? 'none' : '';
  bpBtns[0].parentElement.style.display = bp ? '' : 'none'; ui.show('bplr', bp);
  bpPanel.hidden = !bp; legend.style.display = bp ? 'none' : '';
  if (bp) { pause(); if (!BP.w1) bpReset(); else drawBPPanel(); hud.set('ep', 'Back-propagation, one example at a time'); hud.set('loss', `Loss L = ½(ŷ − y)² = <b>${BP.L.toFixed(4)}</b>`); hud.remove('arch'); }
  else { hud.set('arch', ''); hint.textContent = ''; drawReadouts(); play(); }
}
const DATA_IDS = new Set(['n', 'noise', 'val', 'design', 'seed']);
const NET_IDS = new Set(['layers', 'width', 'act']);
let deb = null; const pending = new Set();
ui.onChange((st, id) => {
  if (id === 'mode') { applyMode(); return; }
  if (id === 'speed') { clock.speed = st.speed; return; }
  if (id === 'bplr') { if (BP.w1) { bpCompute(); drawBPPanel(); } return; }
  pending.add(id); clearTimeout(deb);
  deb = setTimeout(() => {
    const ids = [...pending]; pending.clear();
    if (ids.some(i => DATA_IDS.has(i))) { buildData(); resetNet(); BP.w1 = null; if (ui.get('mode') === 'bp') bpReset(); }
    else if (ids.some(i => i && i.startsWith('use_'))) { buildFeatures(); resetNet(); }
    else if (ids.some(i => NET_IDS.has(i))) resetNet();
    refreshAll(true);
  }, ids0(id) ? 0 : 150);
});
function ids0(id) { return id === 'lr' || id === 'l2' || id === 'speed' || id === 'opt' || id === 'batch'; }
document.addEventListener('ffp:theme', () => refreshAll(true));
document.addEventListener('ffp:math', () => { if (ui.get('mode') === 'bp') drawBPPanel(); });

buildData(); resetNet(); trainEpochs(1); applyMode(); refreshAll(true);
if (ui.get('mode') === 'bp') pause(); else play();
requestAnimationFrame(loop);
