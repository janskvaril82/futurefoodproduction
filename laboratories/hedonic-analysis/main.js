/* Hedonic study analyser — 9-point hedonic ratings (panellists × products).
   Models (Derive tab, Eqs. H1–H8): product means with t intervals; randomised complete block ANOVA
   with panellists as blocks (anovaRCBD) versus one-way ANOVA (anova1); relative efficiency of blocking;
   Tukey HSD from the block error term (tukeyRCBD); effect sizes (partial η², d_z); Friedman rank test;
   k-means segmentation of panellist profiles (Lloyd's algorithm, k-means++ start); correlation of liking
   with a covariate such as the Food Neophobia Scale score. Data: example, simulation, paste, or the
   project record 'ffp-sensory-v1' written by the sensory-booth laboratory. */
import { Controls, Readouts, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, BarChart, downloadCSV, linspace } from '/assets/js/plot.js';
import { palette, withAlpha, resolveColor } from '/assets/js/colors.js';
import { anovaRCBD, anova1, tukeyRCBD, mean, sd, describe, mulberry32, randn, parseTable, pearson, linreg, chi2Cdf, tInv, normInv } from '/assets/js/stats.js';
import { loadStudy, qtukeyFast, fmtP, pEq, panelId } from '/laboratories/sensory-booth/sensory-core.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = m => { if (window.FFP && FFP.toast) FFP.toast(m); };
const HED = ['dislike extremely', 'dislike very much', 'dislike moderately', 'dislike slightly', 'neither like nor dislike', 'like slightly', 'like moderately', 'like very much', 'like extremely'];
const clip9 = v => Math.max(1, Math.min(9, Math.round(v)));

/* =============================================================== data generation */
/** Simulated hedonic study: y_ij = μ_j + β_i + s_i·δ_j + ε_ij, rounded to the 9-point scale.
    s_i = 1 for "rejecters" (share q), who like each novel step δ points less; covariate FNS depends on s_i. */
function simulate({ b = 36, t = 3, mu0 = 6.9, step = -0.45, sigB = 0.9, sigE = 1.1, q = 0.33, drop = 0.8, seed = 2026, names } = {}) {
  const r = mulberry32(seed);
  const Y = [], cov = [], truth = [];
  for (let i = 0; i < b; i++) {
    const rej = r() < q ? 1 : 0, beta = sigB * randn(r);
    Y.push(Array.from({ length: t }, (_, j) => clip9(mu0 + step * j + beta - rej * drop * j + sigE * randn(r))));
    cov.push(Math.max(10, Math.min(70, Math.round(rej ? 40 + 8 * randn(r) : 27 + 7 * randn(r)))));
    truth.push(rej);
  }
  return { names: names || Array.from({ length: t }, (_, j) => j === 0 ? 'Wheat 0 %' : `Cricket ${5 * j} %`), ids: Y.map((_, i) => panelId(i + 1)), Y, cov, covName: 'FNS', truth };
}
const EXAMPLE = () => ({ ...simulate({ b: 36, t: 3, mu0: 6.9, step: -0.4, sigB: 0.9, sigE: 1.0, q: 0.35, drop: 1.3, seed: 18 }), source: 'Illustrative example — simulated bread study (not real data)' });
function toCSV(d) {
  const head = ['panellist', ...d.names, ...(d.cov ? [d.covName || 'covariate'] : [])];
  return [head.join(','), ...d.Y.map((row, i) => [d.ids[i], ...row, ...(d.cov ? [d.cov[i]] : [])].join(','))].join('\n');
}
function fromText(text) {
  const T = parseTable(text);
  if (!T.headers.length || !T.rows.length) throw new Error('No table found — paste one row per panellist, one column per product.');
  const isNum = v => typeof v === 'number' && isFinite(v);
  const cols = T.headers.map((h, j) => ({ h, j, num: T.rows.filter(r => isNum(r[j])).length }));
  const idCol = cols.find(c => c.num < T.rows.length * 0.5);
  const covCol = cols.find(c => c !== idCol && /fns|ftns|neophob|covar|age|score/i.test(c.h));
  const prodCols = cols.filter(c => c !== idCol && c !== covCol && c.num >= T.rows.length * 0.5);
  if (prodCols.length < 2) throw new Error('At least two numeric product columns are needed.');
  const Y = [], ids = [], cov = []; let dropped = 0, outOfRange = 0;
  T.rows.forEach((r, i) => {
    const vals = prodCols.map(c => r[c.j]);
    if (!vals.every(isNum)) { dropped++; return; }
    if (vals.some(v => v < 1 || v > 9)) { outOfRange++; return; }
    Y.push(vals); ids.push(idCol ? String(r[idCol.j]) : panelId(i + 1)); cov.push(covCol && isNum(r[covCol.j]) ? r[covCol.j] : NaN);
  });
  if (Y.length < 2) throw new Error('Fewer than two complete panellists after cleaning.');
  const hasCov = covCol && cov.filter(isFinite).length >= 3;
  return { names: prodCols.map(c => c.h), ids, Y, cov: hasCov ? cov : null, covName: hasCov ? covCol.h : '', source: `Pasted data: ${Y.length} complete panellists${dropped ? `, ${dropped} incomplete row(s) dropped` : ''}${outOfRange ? `, ${outOfRange} row(s) outside 1–9 dropped` : ''}` };
}
function fromProject() {
  const s = loadStudy();
  if (!s) throw new Error('No study stored in this browser — design one in the sensory-booth laboratory.');
  if (s.design.test !== 'hedonic') throw new Error(`The stored study is a ${s.design.test} test, not a hedonic test.`);
  const codes = s.design.samples.map(q => q.code), byPan = {};
  s.responses.forEach(r => { if (typeof r.score === 'number' && r.sample != null) (byPan[r.panellist] = byPan[r.panellist] || {})[r.sample] = r.score; });
  const keys = Object.keys(byPan).sort((a, b) => (+a || 0) - (+b || 0));
  const Y = [], ids = [];
  keys.forEach(k => { const o = byPan[k]; if (codes.every(c => typeof o[c] === 'number')) { Y.push(codes.map(c => o[c])); ids.push(isFinite(+k) ? panelId(+k) : String(k)); } });
  if (Y.length < 2) throw new Error(`Only ${Y.length} complete panellist(s) in the stored study — record more responses first.`);
  return { names: s.design.samples.map(q => q.label || q.code), ids, Y, cov: null, covName: '', source: `Project data: ${Y.length} complete of ${keys.length} panellists (${s.design.panellists} planned)` };
}

/* =============================================================== analysis */
function ranksRow(row) { const idx = row.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = new Array(row.length); let ties = 0; for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1, m = j - i + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; if (m > 1) ties += m * m * m - m; i = j + 1; } return { r, ties }; }
function friedman(Y) {
  const b = Y.length, t = Y[0].length; const R = new Array(t).fill(0); let T = 0;
  Y.forEach(row => { const { r, ties } = ranksRow(row); r.forEach((v, j) => R[j] += v); T += ties; });
  const num = 12 / (b * t * (t + 1)) * R.reduce((s, v) => s + v * v, 0) - 3 * b * (t + 1);
  const corr = 1 - T / (b * (t * t * t - t));
  const chi = corr > 1e-12 ? num / corr : NaN;
  return { chi, df: t - 1, p: isFinite(chi) ? 1 - chi2Cdf(chi, t - 1) : NaN, R };
}
function kmeans(X, k, seed, centre) {
  const n = X.length; if (k <= 1 || n < k) return { labels: X.map(() => 0), k: 1, wss: NaN, tss: NaN, share: 0 };
  const P = centre ? X.map(r => { const m = mean(r); return r.map(v => v - m); }) : X;
  const d2 = (a, c) => a.reduce((s, v, j) => s + (v - c[j]) ** 2, 0);
  const rng = mulberry32(seed); let best = null;
  for (let rep = 0; rep < 24; rep++) {
    const C = [P[Math.floor(rng() * n)].slice()];
    while (C.length < k) { const D = P.map(p => Math.min(...C.map(c => d2(p, c)))); const tot = D.reduce((a, b) => a + b, 0); let u = rng() * tot, i = 0; for (; i < n - 1; i++) { u -= D[i]; if (u <= 0) break; } C.push(P[i].slice()); }
    let lab = new Array(n).fill(-1);
    for (let it = 0; it < 100; it++) {
      let changed = false;
      P.forEach((p, i) => { let bi = 0, bd = Infinity; C.forEach((c, j) => { const dd = d2(p, c); if (dd < bd) { bd = dd; bi = j; } }); if (lab[i] !== bi) { lab[i] = bi; changed = true; } });
      C.forEach((c, j) => { const mem = P.filter((_, i) => lab[i] === j); if (mem.length) for (let q = 0; q < c.length; q++) c[q] = mean(mem.map(m => m[q])); });
      if (!changed) break;
    }
    const wss = P.reduce((s, p, i) => s + d2(p, C[lab[i]]), 0);
    if (!best || wss < best.wss - 1e-9) best = { labels: lab.slice(), C: C.map(c => c.slice()), wss };
  }
  const gm = P[0].map((_, q) => mean(P.map(p => p[q])));
  const tss = P.reduce((s, p) => s + d2(p, gm), 0);
  // order segments by their liking of the most novel product (last column), highest first
  const t = X[0].length, segMean = j => mean(X.filter((_, i) => best.labels[i] === j).map(r => r[t - 1]));
  const order = [...Array(k).keys()].sort((a, b) => segMean(b) - segMean(a)), remap = {}; order.forEach((o, i) => remap[o] = i);
  return { labels: best.labels.map(l => remap[l]), k, wss: best.wss, tss, share: tss > 0 ? 1 - best.wss / tss : 0 };
}
function analyse(d) {
  const Y = d.Y, b = Y.length, t = Y[0].length;
  const cols = Array.from({ length: t }, (_, j) => Y.map(r => r[j]));
  const R = anovaRCBD(Y), O = anova1(cols), desc = cols.map(c => describe(c));
  const eta2p = R.treatment.ss / (R.treatment.ss + R.error.ss);
  const RE = ((b - 1) * R.block.ms + b * (t - 1) * R.error.ms) / ((b * t - 1) * R.error.ms);
  const f1 = R.error.df, f2 = t * (b - 1), REc = RE * ((f1 + 1) * (f2 + 3)) / ((f1 + 3) * (f2 + 1));
  const qB = qtukeyFast(0.95, t, R.error.df), hsd = qB * Math.sqrt(R.error.ms / b);
  const qO = qtukeyFast(0.95, t, O.df2), hsdO = qO * Math.sqrt(O.msw / b);
  const pairs = [];
  for (let i = 0; i < t; i++) for (let j = i + 1; j < t; j++) {
    const dv = Y.map(r => r[j] - r[i]), dbar = mean(dv), sdd = sd(dv), tc = tInv(0.975, b - 1);
    pairs.push({ i, j, diff: R.tMeans[j] - R.tMeans[i], dz: sdd > 0 ? dbar / sdd : NaN, ciPaired: [dbar - tc * sdd / Math.sqrt(b), dbar + tc * sdd / Math.sqrt(b)], one: [R.tMeans[j] - R.tMeans[i] - hsdO, R.tMeans[j] - R.tMeans[i] + hsdO] });
  }
  const resid = [], fitted = [];
  Y.forEach((row, i) => row.forEach((v, j) => { const f = R.bMeans[i] + R.tMeans[j] - R.grandMean; fitted.push(f); resid.push(v - f); }));
  return { b, t, cols, R, O, desc, eta2p, RE, REc, hsd, hsdO, pairs, resid, fitted, fr: friedman(Y) };
}
/** Compact letter display from a significance matrix (insert-and-absorb). */
function letters(t, sig, means) {
  let colsL = [[...Array(t).keys()]];
  for (let i = 0; i < t; i++) for (let j = i + 1; j < t; j++) if (sig[i][j]) {
    const next = [];
    colsL.forEach(c => { if (c.includes(i) && c.includes(j)) { next.push(c.filter(x => x !== i)); next.push(c.filter(x => x !== j)); } else next.push(c); });
    colsL = next.filter((c, k) => !next.some((o, m) => m !== k && c.every(x => o.includes(x)) && (o.length > c.length || m < k)));
  }
  colsL.sort((a, b) => Math.max(...b.map(x => means[x])) - Math.max(...a.map(x => means[x])));
  return Array.from({ length: t }, (_, j) => colsL.map((c, k) => c.includes(j) ? 'abcdefgh'[k] : '').join(''));
}

/* =============================================================== controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ui.section('Data');
ui.segmented({ id: 'src', label: 'Source', options: [{ value: 'example', label: 'Example' }, { value: 'sim', label: 'Simulate' }, { value: 'paste', label: 'Pasted' }, { value: 'project', label: 'Project' }], value: 'example', help: 'Pasted: edit the table below the readouts. Project: ratings recorded with the sensory-booth laboratory.' });
ui.section('Simulation (source: Simulate)');
ui.slider({ id: 'b', label: 'Panellists b', min: 8, max: 120, step: 1, value: 36 });
ui.slider({ id: 't', label: 'Products t', min: 2, max: 5, step: 1, value: 3 });
ui.slider({ id: 'mu0', label: 'Mean liking of the control', min: 4, max: 8.5, step: 0.1, value: 6.9, unit: 'points' });
ui.slider({ id: 'step', label: 'Change per novelty step (everyone)', min: -1.5, max: 0.5, step: 0.05, value: -0.4, unit: 'points' });
ui.slider({ id: 'sigB', label: 'Panellist SD (scale use)', min: 0, max: 2, step: 0.05, value: 0.9, unit: 'points', help: 'How differently people use the scale — removed by blocking.' });
ui.slider({ id: 'sigE', label: 'Error SD', min: 0.3, max: 2.5, step: 0.05, value: 1.1, unit: 'points' });
ui.slider({ id: 'q', label: 'Share of rejecters', min: 0, max: 0.7, step: 0.01, value: 0.33, help: 'A hidden segment that likes each novel step less (and scores higher on neophobia).' });
ui.slider({ id: 'drop', label: 'Extra drop for rejecters per step', min: 0, max: 2.5, step: 0.05, value: 0.9, unit: 'points' });
ui.number({ id: 'seed', label: 'Random seed', min: 1, max: 99999, step: 1, value: 2026 });
ui.buttons([{ label: 'Resample panel', onClick: () => ui.set('seed', 1 + Math.floor(Math.random() * 99998)) }]);
ui.section('Analysis and display');
ui.segmented({ id: 'view', label: 'Stage view', options: [{ value: 'dots', label: 'Ratings' }, { value: 'spag', label: 'Panellists' }, { value: 'dist', label: 'Scale use' }, { value: 'resid', label: 'Residuals' }], value: 'dots' });
ui.slider({ id: 'k', label: 'Consumer segments k (k-means)', min: 1, max: 4, step: 1, value: 2, help: 'k = 1 switches segmentation off.' });
ui.toggle({ id: 'centre', label: 'Cluster on the liking pattern (centre each panellist)', value: true, help: 'Removes scale-use differences before clustering.' });
ui.select({ id: 'covT', label: 'Covariate analysis: liking measure', options: [{ value: 'nov', label: 'Novel products minus control' }, { value: 'mean', label: 'Mean liking of all products' }, { value: 'last', label: 'Liking of the most novel product' }], value: 'nov' });
ui.presets([
  { label: 'Illustrative study', values: { src: 'example', k: 2, view: 'dots' } },
  { label: 'No product effect', values: { src: 'sim', b: 30, t: 3, step: 0, q: 0, sigB: 0.9, sigE: 1.2 } },
  { label: 'Huge scale-use differences', values: { src: 'sim', b: 24, t: 3, step: -0.3, q: 0, sigB: 1.8, sigE: 0.9 } },
  { label: 'Love it or hate it', values: { src: 'sim', b: 40, t: 3, step: 0.2, q: 0.45, drop: 1.8, sigB: 0.7, sigE: 0.9, k: 2 } },
  { label: 'Small panel (12)', values: { src: 'sim', b: 12, t: 3, step: -0.4, q: 0.33, sigB: 0.9, sigE: 1.1 } }
]);
ui.section('Outputs');
ui.buttons([{ label: 'Load from project', onClick: () => ui.set('src', 'project') }, { label: 'Download CSV', onClick: () => { if (!data) return; const a = lastA; downloadCSV('hedonic-data.csv', ['panellist', ...data.names, ...(data.cov ? [data.covName] : []), 'segment'], data.Y.map((r, i) => [data.ids[i], ...r, ...(data.cov ? [data.cov[i]] : []), seg ? seg.labels[i] + 1 : 1])); } }]);
ui.saveButton('hedonic-analysis', () => ro.values());

ro.add({ id: 'dims', label: 'Panellists × products', format: v => v })
  .add({ id: 'Fb', label: 'Block ANOVA (products)', format: v => v })
  .add({ id: 'Fo', label: 'One-way ANOVA (ignores panellists)', format: v => v })
  .add({ id: 'eta', label: 'Partial η² (products)', digits: 2 })
  .add({ id: 'hsd', label: 'Tukey HSD (block error)', digits: 2, unit: 'points' })
  .add({ id: 're', label: 'Efficiency of blocking', digits: 2, unit: '×' })
  .add({ id: 'fr', label: 'Friedman rank test', format: v => v })
  .add({ id: 'seg', label: 'Segments (k-means)', format: v => v })
  .add({ id: 'r', label: 'Liking vs covariate', format: v => v });

/* =============================================================== state */
let data = null, lastA = null, seg = null, tukey = null, tukeyKey = '', pasteText = '';
function getData(p) {
  try {
    if (p.src === 'example') return EXAMPLE();
    if (p.src === 'sim') { const d = simulate({ b: p.b, t: p.t, mu0: p.mu0, step: p.step, sigB: p.sigB, sigE: p.sigE, q: p.q, drop: p.drop, seed: p.seed }); d.source = `Simulated panel (seed ${p.seed})`; return d; }
    if (p.src === 'paste') return fromText($('paste').value);
    if (p.src === 'project') return fromProject();
  } catch (e) { $('paste-msg').textContent = e.message; $('paste-msg').className = 'pmsg bad'; toast(e.message); return null; }
}

/* =============================================================== stage canvas */
const stageEl = $('stage');
const cv = document.createElement('canvas'); cv.className = 'ha-canvas'; stageEl.appendChild(cv);
const hud = hudChips(stageEl);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'hedonic-analysis.png'; a.click(); } });
const ctx = cv.getContext('2d');
new ResizeObserver(() => draw()).observe(stageEl);
document.addEventListener('ffp:theme', () => draw());
const segCol = i => resolveColor(['c0', 'c2', 'c3', 'c4'][i] || 'c5');
const prodCol = j => resolveColor('c' + (j + 1));
function T(txt, x, y, { size = 12, w = 600, c, a = 'left', bl = 'alphabetic', mono = false } = {}) { ctx.font = `${w} ${size}px ${mono ? '"JetBrains Mono", monospace' : 'Inter, sans-serif'}`; ctx.fillStyle = c; ctx.textAlign = a; ctx.textBaseline = bl; ctx.fillText(txt, x, y); }
function yAxis(P, L, R, top, bot, Y, verbal) {
  for (let v = 1; v <= 9; v++) {
    const y = Y(v); ctx.strokeStyle = withAlpha(P.line, v === 5 ? 1 : 0.7); ctx.lineWidth = v === 5 ? 1.3 : 1; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
    T(String(v), L - 8, y, { size: 11, w: 600, c: P.muted, a: 'right', bl: 'middle', mono: true });
    if (verbal) T(HED[v - 1], L - 26, y, { size: 10.5, w: 500, c: P.muted, a: 'right', bl: 'middle' });
  }
}
function draw() {
  const W = stageEl.clientWidth, H = stageEl.clientHeight; if (!W || !H) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const P = palette(), p = ui.values();
  if (!data || !lastA) { T('No data to analyse — check the message below the readouts.', W / 2, H / 2, { size: 14, c: P.muted, a: 'center' }); return; }
  const A = lastA, t = A.t, b = A.b, top = 86, bot = H - 58;
  const labs = seg && seg.k > 1 ? seg.labels : null;
  if (p.view === 'dots' || p.view === 'spag') {
    const verbal = W > 760, L = verbal ? 150 : 44, R = W - 18;
    const Y = v => bot - (v - 0.5) / 9 * (bot - top);
    yAxis(P, L, R, top, bot, Y, verbal);
    const band = (R - L) / t, cx = j => L + (j + 0.5) * band;
    const letterSet = tukey ? letters(t, (() => { const s = Array.from({ length: t }, () => new Array(t).fill(false)); tukey.pairs.forEach(q => { s[q.a][q.b] = s[q.b][q.a] = q.p < 0.05; }); return s; })(), A.R.tMeans) : null;
    for (let j = 0; j < t; j++) {
      const name = data.names[j];
      T(name.length > 24 ? name.slice(0, 23) + '…' : name, cx(j), bot + 20, { size: 12.5, w: 650, c: prodCol(j), a: 'center' });
      T(`mean ${fmt(A.desc[j].mean, 2)} · n = ${b}`, cx(j), bot + 37, { size: 10.5, w: 500, c: P.muted, a: 'center' });
      if (letterSet) T(letterSet[j], cx(j), top - 8, { size: 14, w: 700, c: P.ink, a: 'center' });
    }
    if (p.view === 'dots') {
      for (let j = 0; j < t; j++) {
        const col = A.cols[j], counts = {};
        const maxC = Math.max(...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(v => col.filter(x => x === v).length));
        const gap = Math.min(8.5, band * 0.5 / Math.max(1, maxC)), rad = Math.max(2, Math.min(3.8, gap * 0.45));
        const order = col.map((v, i) => i).sort((a, c) => (labs ? labs[a] - labs[c] : 0) || a - c);
        const seen = {}; order.forEach(i => { const v = col[i]; counts[v] = (counts[v] || 0) + 1; });
        order.forEach(i => { const v = col[i], k = seen[v] = (seen[v] || 0) + 1, nV = counts[v]; const x = cx(j) - 0.08 * band + (k - (nV + 1) / 2) * gap; ctx.beginPath(); ctx.arc(x, Y(v), rad, 0, Math.PI * 2); ctx.fillStyle = labs ? withAlpha(segCol(labs[i]), 0.85) : withAlpha(prodCol(j), 0.75); ctx.fill(); });
        // box plot (right of the dots)
        const D = A.desc[j], bx = cx(j) + 0.3 * band, bw = Math.min(16, band * 0.08);
        ctx.strokeStyle = P.ink2; ctx.lineWidth = 1.3;
        const lo = Math.max(D.min, D.q1 - 1.5 * D.iqr), hi = Math.min(D.max, D.q3 + 1.5 * D.iqr);
        ctx.beginPath(); ctx.moveTo(bx, Y(lo)); ctx.lineTo(bx, Y(D.q1)); ctx.moveTo(bx, Y(D.q3)); ctx.lineTo(bx, Y(hi)); ctx.moveTo(bx - bw / 3, Y(lo)); ctx.lineTo(bx + bw / 3, Y(lo)); ctx.moveTo(bx - bw / 3, Y(hi)); ctx.lineTo(bx + bw / 3, Y(hi)); ctx.stroke();
        ctx.fillStyle = withAlpha(prodCol(j), 0.16); ctx.fillRect(bx - bw / 2, Y(D.q3), bw, Y(D.q1) - Y(D.q3)); ctx.strokeRect(bx - bw / 2, Y(D.q3), bw, Y(D.q1) - Y(D.q3));
        ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(bx - bw / 2, Y(D.median)); ctx.lineTo(bx + bw / 2, Y(D.median)); ctx.stroke();
        // mean ± 95 % CI
        const mx = cx(j) + 0.19 * band;
        ctx.strokeStyle = P.ink; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(mx, Y(D.ci95[0])); ctx.lineTo(mx, Y(D.ci95[1])); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(mx - 6, Y(D.ci95[0])); ctx.lineTo(mx + 6, Y(D.ci95[0])); ctx.moveTo(mx - 6, Y(D.ci95[1])); ctx.lineTo(mx + 6, Y(D.ci95[1])); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(mx, Y(D.mean) - 7); ctx.lineTo(mx + 7, Y(D.mean)); ctx.lineTo(mx, Y(D.mean) + 7); ctx.lineTo(mx - 7, Y(D.mean)); ctx.closePath(); ctx.fillStyle = P.ink; ctx.fill(); ctx.strokeStyle = P.bgElev; ctx.lineWidth = 1.5; ctx.stroke();
      }
      T('dots = panellists · ◆ mean with 95 % CI · box = quartiles · letters: means sharing a letter do not differ (Tukey, α = 0.05)', L, top - 26, { size: 10.5, w: 500, c: P.muted });
    } else {
      const jit = i => ((i * 7919) % 97) / 97 - 0.5;
      data.Y.forEach((row, i) => {
        ctx.beginPath(); row.forEach((v, j) => { const x = cx(j) + jit(i) * band * 0.12, y = Y(v + jit(i + 3) * 0.28); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.strokeStyle = labs ? withAlpha(segCol(labs[i]), 0.42) : withAlpha(P.muted, 0.45); ctx.lineWidth = 1.2; ctx.stroke();
      });
      const segs = labs ? seg.k : 1;
      for (let s = 0; s < segs; s++) {
        const rows = data.Y.filter((_, i) => !labs || labs[i] === s); if (!rows.length) continue;
        const m = Array.from({ length: t }, (_, j) => mean(rows.map(r => r[j])));
        ctx.beginPath(); m.forEach((v, j) => j ? ctx.lineTo(cx(j), Y(v)) : ctx.moveTo(cx(j), Y(v))); ctx.strokeStyle = labs ? segCol(s) : P.ink; ctx.lineWidth = 3.4; ctx.stroke();
        m.forEach((v, j) => { ctx.beginPath(); ctx.arc(cx(j), Y(v), 5, 0, Math.PI * 2); ctx.fillStyle = labs ? segCol(s) : P.ink; ctx.fill(); });
        if (labs) T(`segment ${String.fromCharCode(65 + s)} (n = ${rows.length})`, cx(t - 1) + 12, Y(m[t - 1]), { size: 11.5, w: 700, c: segCol(s), bl: 'middle' });
      }
      T('each line = one panellist; parallel lines = scale-use differences that blocking removes; thick lines = segment means', L, top - 26, { size: 10.5, w: 500, c: P.muted });
    }
  } else if (p.view === 'dist') {
    const L = Math.min(220, W * 0.24), R = W - 24, mid = (L + R) / 2, half = (R - L) / 2;
    const rowH = Math.min(110, (bot - top - 40) / t);
    const shade = v => v < 5 ? withAlpha(resolveColor('magenta'), 0.25 + 0.18 * (5 - v)) : v > 5 ? withAlpha(resolveColor('accent'), 0.25 + 0.18 * (v - 5)) : withAlpha(P.muted, 0.35);
    T('Share of panellists in each category (centred on “neither like nor dislike”)', L, top - 22, { size: 11, w: 600, c: P.ink2 });
    for (let j = 0; j < t; j++) {
      const col = A.cols[j], n = col.length, pc = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(v => col.filter(x => x === v).length / n);
      const y = top + 10 + j * rowH, h = Math.min(56, rowH * 0.58);
      T(data.names[j], L - 12, y + h / 2, { size: 12, w: 650, c: prodCol(j), a: 'right', bl: 'middle' });
      let x = mid - (pc[0] + pc[1] + pc[2] + pc[3] + pc[4] / 2) * half;
      pc.forEach((f, k) => { const w = f * half; ctx.fillStyle = shade(k + 1); ctx.fillRect(x, y, w, h); if (w > 24) T(`${Math.round(100 * f)}`, x + w / 2, y + h / 2, { size: 10.5, w: 600, c: P.ink, a: 'center', bl: 'middle', mono: true }); x += w; });
      const dis = pc[0] + pc[1] + pc[2] + pc[3], lik = pc[5] + pc[6] + pc[7] + pc[8];
      T(`${Math.round(100 * dis)} % dislike`, mid - half + 2, y + h + 12, { size: 10.5, w: 600, c: resolveColor('magenta') });
      T(`${Math.round(100 * lik)} % like`, R - 2, y + h + 12, { size: 10.5, w: 600, c: resolveColor('accent'), a: 'right' });
    }
    ctx.strokeStyle = P.ink2; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(mid, top); ctx.lineTo(mid, top + t * rowH); ctx.stroke();
    const ly = bot - 6; let lx = L;
    [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(v => { ctx.fillStyle = shade(v); ctx.fillRect(lx, ly - 10, 14, 12); T(String(v), lx + 18, ly, { size: 10.5, w: 600, c: P.muted, mono: true }); lx += 38; });
    T('1 = dislike extremely … 9 = like extremely', lx + 8, ly, { size: 10.5, w: 500, c: P.muted });
  } else {
    // residuals: vs fitted (left) and normal Q–Q (right)
    const gapX = 40, L1 = 60, R1 = W / 2 - gapX / 2, L2 = W / 2 + gapX / 2 + 30, R2 = W - 20;
    const e = A.resid, f = A.fitted, emax = Math.max(0.5, ...e.map(Math.abs)) * 1.1;
    const Ye = v => (top + bot) / 2 - v / emax * (bot - top) / 2;
    const fx0 = Math.min(...f) - 0.3, fx1 = Math.max(...f) + 0.3, X1 = v => L1 + (v - fx0) / (fx1 - fx0) * (R1 - L1);
    const qq = e.map((v, i) => [v, i]).sort((a, c) => a[0] - c[0]).map(([v], k) => [normInv((k + 1 - 0.375) / (e.length + 0.25)), v]);
    const zx = Math.max(2.5, Math.abs(qq[0][0]) * 1.05), X2 = z => L2 + (z + zx) / (2 * zx) * (R2 - L2);
    [[L1, R1], [L2, R2]].forEach(([l, r]) => { ctx.strokeStyle = P.line; ctx.lineWidth = 1; for (let v = -Math.floor(emax); v <= Math.floor(emax); v++) { ctx.beginPath(); ctx.moveTo(l, Ye(v)); ctx.lineTo(r, Ye(v)); ctx.stroke(); T(String(v), l - 6, Ye(v), { size: 10.5, w: 500, c: P.muted, a: 'right', bl: 'middle', mono: true }); } });
    f.forEach((v, i) => { ctx.beginPath(); ctx.arc(X1(v), Ye(e[i]), 3, 0, Math.PI * 2); ctx.fillStyle = withAlpha(prodCol(i % t), 0.6); ctx.fill(); });
    const s = sd(e);
    ctx.strokeStyle = resolveColor('magenta'); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(X2(-zx), Ye(-zx * s)); ctx.lineTo(X2(zx), Ye(zx * s)); ctx.stroke();
    qq.forEach(([z, v]) => { ctx.beginPath(); ctx.arc(X2(z), Ye(v), 3, 0, Math.PI * 2); ctx.fillStyle = withAlpha(resolveColor('water'), 0.65); ctx.fill(); });
    T('Residual vs fitted value', L1, top - 18, { size: 12, w: 650, c: P.ink }); T('Normal Q–Q plot of residuals', L2, top - 18, { size: 12, w: 650, c: P.ink });
    T('fitted value (points)', (L1 + R1) / 2, bot + 22, { size: 11, w: 500, c: P.muted, a: 'center' }); T('normal quantile', (L2 + R2) / 2, bot + 22, { size: 11, w: 500, c: P.muted, a: 'center' });
    for (let v = Math.ceil(fx0); v <= Math.floor(fx1); v++) T(String(v), X1(v), bot + 6, { size: 10.5, w: 500, c: P.muted, a: 'center', mono: true });
    T('Stripes are expected: ratings are whole numbers. Look for curvature (skew) and outliers.', L1, bot + 42, { size: 10.5, w: 500, c: P.muted });
  }
}

/* =============================================================== charts */
const ssChart = new BarChart('#chart-ss', { horizontal: true, stacked: true, y: { label: 'Sum of squares', unit: 'points²' } });
const tkPlot = new Plot('#chart-tukey', { x: { label: 'Difference in mean liking', unit: 'points' }, y: { label: '', min: -0.6, max: 2.6, format: () => '', nice: false }, legend: false, crosshair: false, padding: { left: 196 } });
const segPlot = new Plot('#chart-seg', { x: { label: 'Product', min: -0.3, max: 2.3, format: () => '' }, y: { label: 'Mean liking', unit: 'points', min: 1, max: 9 } });
const covPlot = new Plot('#chart-cov', { x: { label: 'Covariate', unit: '' }, y: { label: 'Liking measure', unit: 'points' } });
function updateCharts(p) {
  const A = lastA; if (!A) return;
  const Rr = A.R;
  ssChart.set(['One-way ANOVA', 'Block ANOVA'], [
    { label: 'Products', values: [A.O.ssb, Rr.treatment.ss], color: 'accent' },
    { label: 'Panellists (blocks)', values: [0, Rr.block.ss], color: 'amber' },
    { label: 'Error / within products', values: [A.O.ssw, Rr.error.ss], color: '#9aa0a6' }
  ]);
  $('ss-note').innerHTML = `One-way: F(${A.O.df1}, ${A.O.df2}) = ${fmt(A.O.F, 2)}, ${pEq(A.O.p)} · Block design: F(${Rr.treatment.df}, ${Rr.error.df}) = ${fmt(Rr.treatment.F, 2)}, ${pEq(Rr.treatment.p)}. The panellist variation (amber) moved out of the error term.`;
  // Tukey forest plot
  const pairs = tukey ? tukey.pairs : null, np = A.pairs.length;
  tkPlot.clear(); tkPlot.setAxis('y', { min: -0.6, max: np - 0.4 });
  const lo = Math.min(...A.pairs.map(q => q.one[0]), ...(pairs ? pairs.map(q => q.lwr) : [0])), hi = Math.max(...A.pairs.map(q => q.one[1]), ...(pairs ? pairs.map(q => q.upr) : [0]));
  tkPlot.setAxis('x', { min: Math.floor(Math.min(lo, 0) * 2) / 2 - 0.25, max: Math.ceil(Math.max(hi, 0) * 2) / 2 + 0.25 });
  tkPlot.vline('zero', 0, { color: 'muted', dash: [4, 4] });
  tkPlot.custom('forest', (c, pl, Pp) => {
    A.pairs.forEach((q, k) => {
      const y = pl.py(np - 1 - k);
      c.strokeStyle = withAlpha(Pp.muted, 0.7); c.lineWidth = 1.5; c.beginPath(); c.moveTo(pl.px(q.one[0]), y + 9); c.lineTo(pl.px(q.one[1]), y + 9); c.stroke();
      const tq = pairs && pairs[k];
      if (tq) {
        const sig = tq.p < 0.05, col = sig ? resolveColor('magenta') : Pp.ink2;
        c.strokeStyle = col; c.lineWidth = 3; c.beginPath(); c.moveTo(pl.px(tq.lwr), y); c.lineTo(pl.px(tq.upr), y); c.stroke();
        [tq.lwr, tq.upr].forEach(v => { c.beginPath(); c.moveTo(pl.px(v), y - 6); c.lineTo(pl.px(v), y + 6); c.stroke(); });
        c.beginPath(); c.arc(pl.px(tq.diff), y, 5, 0, Math.PI * 2); c.fillStyle = col; c.fill();
      }
    });
  });
  tkPlot.custom('labels', (c, pl, Pp) => {
    c.font = '600 11.5px Inter, sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle';
    A.pairs.forEach((q, k) => { const y = pl.py(np - 1 - k), tq = pairs && pairs[k]; c.fillStyle = Pp.ink; c.fillText(`${short(data.names[q.j])} − ${short(data.names[q.i])}`, pl.plotRect.left - 8, y - 5); c.font = '500 10.5px "JetBrains Mono", monospace'; c.fillStyle = tq && tq.p < 0.05 ? resolveColor('magenta') : Pp.muted; c.fillText(tq ? `${pEq(tq.p)}` : 'computing…', pl.plotRect.left - 8, y + 9); c.font = '600 11.5px Inter, sans-serif'; });
  }, { noClip: true });
  // segment profiles
  segPlot.clear(); segPlot.setAxis('x', { min: -0.3, max: A.t - 0.7 });
  const xs = [...Array(A.t).keys()];
  segPlot.line('all', xs, Rr.tMeans, { color: 'ink', width: 2, dash: [5, 4], label: `all panellists (n = ${A.b})` });
  if (seg && seg.k > 1) for (let s = 0; s < seg.k; s++) { const rows = data.Y.filter((_, i) => seg.labels[i] === s); if (!rows.length) continue; segPlot.line('s' + s, xs, xs.map(j => mean(rows.map(r => r[j]))), { color: ['c0', 'c2', 'c3', 'c4'][s], width: 3, label: `segment ${String.fromCharCode(65 + s)} (n = ${rows.length})` }); segPlot.scatter('sp' + s, xs, xs.map(j => mean(rows.map(r => r[j]))), { color: ['c0', 'c2', 'c3', 'c4'][s], r: 4.5, noTip: true }); }
  segPlot.custom('xl', (c, pl, Pp) => { c.font = '600 11px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'top'; xs.forEach(j => { c.fillStyle = prodCol(j); c.fillText(short(data.names[j]), pl.px(j), pl.plotRect.top + pl.plotRect.height + 6); }); }, { noClip: true });
  // covariate
  covPlot.clear();
  if (data.cov) {
    const ok = data.cov.map((v, i) => isFinite(v) ? i : -1).filter(i => i >= 0);
    const x = ok.map(i => data.cov[i]), y = ok.map(i => covMeasure(data.Y[i], p.covT));
    covPlot.setAxis('x', { label: data.covName || 'Covariate', unit: /fns/i.test(data.covName) ? 'points, 10–70' : '' });
    covPlot.setAxis('y', { label: covLabel(p.covT), unit: 'points' });
    if (x.length >= 4) {
      const lr = linreg(x, y), xg = linspace(Math.min(...x), Math.max(...x), 40);
      covPlot.band('ci', xg, xg.map(v => lr.ciMean(v)[0]), xg.map(v => lr.ciMean(v)[1]), { color: 'accent', alpha: 0.15 });
      covPlot.line('fit', xg, xg.map(v => lr.predict(v)), { color: 'accent', width: 2.2, label: `OLS fit, slope ${fmt(lr.slope, 3)} per point` });
    }
    const labsC = ok.map(i => seg && seg.k > 1 ? seg.labels[i] : 0);
    covPlot.scatter('pts', x, y, { color: 'c0', r: 4.2, colors: labsC.map(l => segCol(l)), label: seg && seg.k > 1 ? 'panellists (coloured by segment)' : 'panellists' });
  } else {
    covPlot.setAxis('x', { label: 'Covariate', unit: '' }); covPlot.setAxis('y', { label: covLabel(p.covT), unit: 'points' });
    covPlot.text('none', 0.5, 0.5, 'No covariate column — add a column named FNS (or covariate) to your pasted data', { align: 'center', color: 'muted' });
  }
}
const short = s => s.length > 16 ? s.slice(0, 15) + '…' : s;
const covMeasure = (row, m) => m === 'mean' ? mean(row) : m === 'last' ? row[row.length - 1] : mean(row.slice(1)) - row[0];
const covLabel = m => m === 'mean' ? 'Mean liking' : m === 'last' ? 'Liking of most novel product' : 'Novel minus control';

/* =============================================================== tables */
function renderTables() {
  const A = lastA; if (!A) return;
  const R = A.R, tk = tukey;
  const desc = `<table class="res"><caption>Product means (95 % CI from each product's own SD)</caption><thead><tr><th>Product</th><th class="num">n</th><th class="num">Mean</th><th class="num">SD</th><th class="num">95 % CI</th><th class="num">Median</th><th class="num">% liking (6–9)</th></tr></thead><tbody>${A.desc.map((d, j) => `<tr><td><b style="color:${prodCol(j)}">${esc(data.names[j])}</b></td><td class="num">${d.n}</td><td class="num">${fmt(d.mean, 2)}</td><td class="num">${fmt(d.sd, 2)}</td><td class="num">${fmt(d.ci95[0], 2)}–${fmt(d.ci95[1], 2)}</td><td class="num">${fmt(d.median, 1)}</td><td class="num">${fmt(100 * A.cols[j].filter(v => v >= 6).length / d.n, 0)} %</td></tr>`).join('')}</tbody></table>`;
  const row = (n, ss, df, ms, F, pv, cls = '') => `<tr class="${cls}"><td>${n}</td><td class="num">${fmt(ss, 2)}</td><td class="num">${df}</td><td class="num">${ms == null ? '' : fmt(ms, 3)}</td><td class="num">${F == null ? '' : fmt(F, 2)}</td><td class="num">${pv == null ? '' : fmtP(pv)}</td></tr>`;
  const an = `<table class="res"><caption>Block ANOVA (panellists as blocks) and one-way ANOVA of the same ratings</caption><thead><tr><th>Source</th><th class="num">SS</th><th class="num">df</th><th class="num">MS</th><th class="num">F</th><th class="num">p</th></tr></thead><tbody>
    ${row('Products', R.treatment.ss, R.treatment.df, R.treatment.ms, R.treatment.F, R.treatment.p, 'hl')}${row('Panellists (blocks)', R.block.ss, R.block.df, R.block.ms, R.block.F, R.block.p)}${row('Error', R.error.ss, R.error.df, R.error.ms)}${row('Total', R.total.ss, R.total.df)}
    <tr class="sep"><td colspan="6">One-way ANOVA (panellists ignored)</td></tr>${row('Products', A.O.ssb, A.O.df1, A.O.msb, A.O.F, A.O.p, 'hl')}${row('Within products', A.O.ssw, A.O.df2, A.O.msw)}</tbody></table>`;
  const tkT = `<table class="res"><caption>Pairwise comparisons: Tukey HSD from the block error term (simultaneous 95 % CI) and paired effect sizes</caption><thead><tr><th>Comparison</th><th class="num">Difference</th><th class="num">Tukey 95 % CI</th><th class="num">p (Tukey)</th><th class="num">Paired 95 % CI</th><th class="num">d<sub>z</sub></th></tr></thead><tbody>${A.pairs.map((q, k) => { const tq = tk && tk.pairs[k]; return `<tr><td>${esc(data.names[q.j])} − ${esc(data.names[q.i])}</td><td class="num">${fmt(q.diff, 2)}</td><td class="num">${tq ? fmt(tq.lwr, 2) + ' to ' + fmt(tq.upr, 2) : '…'}</td><td class="num ${tq && tq.p < 0.05 ? 'sig' : ''}">${tq ? fmtP(tq.p) : '…'}</td><td class="num">${fmt(q.ciPaired[0], 2)} to ${fmt(q.ciPaired[1], 2)}</td><td class="num">${fmt(q.dz, 2)}</td></tr>`; }).join('')}</tbody></table>`;
  $('tables').innerHTML = desc + an + tkT;
}

/* =============================================================== update */
let tkTimer = null;
function update() {
  const p = ui.values();
  ['b', 't', 'mu0', 'step', 'sigB', 'sigE', 'q', 'drop', 'seed'].forEach(id => ui.enable(id, p.src === 'sim'));
  data = getData(p);
  if (!data) { lastA = null; draw(); return; }
  if (p.src !== 'paste') { $('paste-msg').textContent = data.source; $('paste-msg').className = 'pmsg'; }
  else { $('paste-msg').textContent = data.source; $('paste-msg').className = 'pmsg ok'; }
  const A = analyse(data); lastA = A;
  seg = kmeans(data.Y, Math.min(p.k, data.Y.length - 1), 7, p.centre);
  // Tukey from the block error term (stats.js tukeyRCBD) — debounced, it integrates the studentised range numerically
  const key = JSON.stringify(data.Y) + '|' + data.names.join('|');
  if (key !== tukeyKey) {
    tukey = null; clearTimeout(tkTimer);
    const d = data;                                                             // the data set this Tukey run belongs to
    tkTimer = setTimeout(() => { if (!d || d !== data) return; tukey = tukeyRCBD(d.Y, d.names.map((_, j) => j)); tukeyKey = key; readouts(ui.values()); draw(); updateCharts(ui.values()); renderTables(); }, 250);
  }
  readouts(p); draw(); updateCharts(p); renderTables();
}
function readouts(p) {
  const A = lastA; if (!A) return;
  const R = A.R, alpha = 0.05;
  ro.set('dims', `${A.b} × ${A.t}`, A.b >= 20 ? null : 'warn', A.b >= 20 ? data.source.split(':')[0] : 'small panel — interpret with care');
  ro.set('Fb', `F = ${fmt(R.treatment.F, 2)}`, R.treatment.p < alpha ? 'ok' : null, `F(${R.treatment.df}, ${R.error.df}), ${pEq(R.treatment.p)}`);
  ro.set('Fo', `F = ${fmt(A.O.F, 2)}`, A.O.p < alpha ? 'ok' : 'warn', `F(${A.O.df1}, ${A.O.df2}), ${pEq(A.O.p)}`);
  ro.set('eta', A.eta2p, null, `one-way η² = ${fmt(A.O.eta2, 2)}`);
  ro.set('hsd', A.hsd, null, `one-way error would give ${fmt(A.hsdO, 2)}`);
  ro.set('re', A.REc, A.REc >= 1.5 ? 'ok' : null, `a one-way design would need ≈ ${Math.ceil(A.REc * A.b)} panellists per product`);
  ro.set('fr', `χ² = ${fmt(A.fr.chi, 2)}`, A.fr.p < alpha ? 'ok' : null, `df ${A.fr.df}, ${pEq(A.fr.p)} (rank-based check)`);
  if (seg && seg.k > 1) { const sizes = [...Array(seg.k).keys()].map(s => seg.labels.filter(l => l === s).length); ro.set('seg', `${seg.k}: ${sizes.join(' / ')}`, null, `${fmt(100 * seg.share, 0)} % of the ${p.centre ? 'pattern' : 'profile'} variation between segments`); }
  else ro.set('seg', 'off', null, 'set k ≥ 2 to look for segments');
  if (data.cov) { const ok = data.cov.map((v, i) => isFinite(v) ? i : -1).filter(i => i >= 0); const x = ok.map(i => data.cov[i]), y = ok.map(i => covMeasure(data.Y[i], p.covT)); if (x.length >= 4) { const pr = pearson(x, y), z = Math.atanh(pr.r), se = 1 / Math.sqrt(x.length - 3); ro.set('r', `r = ${fmt(pr.r, 2)}`, pr.p < alpha ? 'ok' : null, `95 % CI ${fmt(Math.tanh(z - 1.96 * se), 2)} to ${fmt(Math.tanh(z + 1.96 * se), 2)}, ${pEq(pr.p)} (${data.covName})`); } }
  else ro.set('r', '—', null, 'no covariate in the data');
  hud.set('src', `<b>${esc(data.source.split(' — ')[0])}</b>`);
  hud.set('an', `Block ANOVA F(${R.treatment.df}, ${R.error.df}) = <b>${fmt(R.treatment.F, 2)}</b>, <b>${pEq(R.treatment.p)}</b>`);
}
ui.onChange(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
let raf = 0;
$('paste').value = toCSV(EXAMPLE());
$('paste-run').addEventListener('click', () => { if (ui.get('src') === 'paste') update(); else ui.set('src', 'paste'); });
$('paste-reset').addEventListener('click', () => { $('paste').value = toCSV(EXAMPLE()); if (ui.get('src') === 'paste') update(); });
update();
window.__hed = { analyse, simulate, get data() { return data; }, get tukey() { return tukey; }, kmeans, friedman, letters };
