/* Triangle test and Thurstonian d′ — simulation and analysis.
   Data-generating model (Derive tab, Eqs. T1–T6): each assessor receives one of the six ISO 4120
   arrangements; perceptions of the two A samples ~ N(0,1), of the B sample ~ N(d′,1); the assessor
   names as odd the sample that is not part of the closest pair (Ennis, 1993). Alternatively, the
   guessing model: a proportion p_d of discriminators answers correctly, the rest guess (p = 1/3).
   Analysis: exact one-sided binomial test (p0 = 1/3), critical numbers, p_d and d′ with Wald and
   exact (Clopper–Pearson) intervals, exact power, and the ISO 4120 similarity test. */
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, linspace, downloadCSV } from '/assets/js/plot.js';
import { palette, withAlpha, resolveColor } from '/assets/js/colors.js';
import { binomPmf, binomUpper, binomCdf, binomCritical, mulberry32, randn, shuffle } from '/assets/js/stats.js';
import { METHODS, pcTriangle, invertPc, slope, clopperPearson, upperLimit, loadStudy, fmtP, pEq, TRI_ORDERS, GOOD_CODES, panelId, oddIndex } from '/laboratories/sensory-booth/sensory-core.js';

const $ = id => document.getElementById(id);
const toast = m => { if (window.FFP && FFP.toast) FFP.toast(m); };
const P0 = 1 / 3;

/* ------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ui.section('What do you want to do?');
ui.segmented({ id: 'mode', label: '', options: [{ value: 'sim', label: 'Simulate a panel' }, { value: 'mine', label: 'Analyse my results' }], value: 'sim' });
ui.section('True sensory difference');
ui.segmented({ id: 'model', label: 'Describe the difference as', options: [{ value: 'dprime', label: 'Thurstonian d′' }, { value: 'pd', label: 'Discriminators p_d' }], value: 'dprime' });
ui.slider({ id: 'd', label: 'd′ (true distance)', min: 0, max: 3, step: 0.05, value: 1.5, unit: 'SD', help: '0 = identical products; 1 = small, 1.5 moderate, ≥ 2 large for untrained assessors.' });
ui.slider({ id: 'pd', label: 'Proportion of discriminators p_d', min: 0, max: 0.9, step: 0.01, value: 0.3, help: 'Guessing model: discriminators are always right, the rest guess (1/3).' });
ui.section('Panel and test');
ui.slider({ id: 'n', label: 'Assessors n', min: 6, max: 120, step: 1, value: 24, help: 'ISO 4120:2021 — typically 24–30 for a difference test; n < 18 is not recommended.' });
ui.segmented({ id: 'alpha', label: 'Significance level α', options: [{ value: 0.05, label: '0.05' }, { value: 0.01, label: '0.01' }, { value: 0.001, label: '0.001' }], value: 0.05 });
ui.slider({ id: 'speed', label: 'Animation speed', min: 0.5, max: 40, step: 0.5, value: 3, unit: 'assessors s⁻¹', log: true, persist: false });
const simBtns = ui.buttons([{ label: 'New panel', variant: 'primary', onClick: () => newPanel(true) }, { label: 'Pause', onClick: () => clock.toggle() }, { label: 'Instant', onClick: () => { revealAll(); } }]);
ui.buttons([{ label: 'Repeat 1000 panels', onClick: () => repeatPanels(1000), title: 'Monte Carlo: run the same experiment 1000 times' }]);
ui.section('My results');
ui.number({ id: 'nObs', label: 'Assessors who took the test', min: 1, max: 1000, step: 1, value: 24 });
ui.number({ id: 'xObs', label: 'Correct answers', min: 0, max: 1000, step: 1, value: 13 });
ui.buttons([{ label: 'Load from project', onClick: loadProject, title: 'Read ffp-sensory-v1 (booth lab / sensory designer)' }, { label: 'Download panel CSV', onClick: downloadPanel }]);
ui.html('<div class="ctl-help" id="src-note">Enter the numbers from your own test, or load them from the project data stored in this browser.</div>');
ui.section('Similarity test (ISO 4120)');
ui.slider({ id: 'pd0', label: 'Largest tolerable p_d0', min: 0.1, max: 0.5, step: 0.01, value: 0.3, help: 'Decide before testing: how many people may notice the change?' });
ui.segmented({ id: 'beta', label: 'Risk β of a false similarity claim', options: [{ value: 0.05, label: '0.05' }, { value: 0.1, label: '0.10' }, { value: 0.2, label: '0.20' }], value: 0.05 });
ui.presets([
  { label: 'No difference', values: { mode: 'sim', model: 'dprime', d: 0, n: 24 }, onApply: () => newPanel(true) },
  { label: 'Moderate · n 24', values: { mode: 'sim', model: 'dprime', d: 1.5, n: 24 }, onApply: () => newPanel(true) },
  { label: 'Large · d′ 2.5', values: { mode: 'sim', model: 'dprime', d: 2.5, n: 24 }, onApply: () => newPanel(true) },
  { label: 'p_d = 0.3 · n 40', values: { mode: 'sim', model: 'pd', pd: 0.3, n: 40 }, onApply: () => newPanel(true) },
  { label: 'Class: 13 of 24', values: { mode: 'mine', nObs: 24, xObs: 13 } },
  { label: 'Similar? 21 of 60', values: { mode: 'mine', nObs: 60, xObs: 21, pd0: 0.3, beta: 0.05 } }
]);
ui.saveButton('triangle-test', () => ro.values());

ro.add({ id: 'x', label: 'Correct answers', format: v => v })
  .add({ id: 'pc', label: 'Proportion correct p̂_c', digits: 3 })
  .add({ id: 'p', label: 'p-value (exact, one-sided)', format: v => fmtP(v) })
  .add({ id: 'xc', label: 'Critical number', format: v => v })
  .add({ id: 'pdh', label: 'Discriminators p̂_d', digits: 2 })
  .add({ id: 'dp', label: 'd′ estimate', digits: 2, unit: 'SD' })
  .add({ id: 'power', label: 'Power (design difference)', digits: 2 })
  .add({ id: 'sim', label: 'Similarity p-value', format: v => fmtP(v) });

/* ------------------------------------------------------------ model */
let panel = [], shown = 0, prog = 0, seed = 11, rng = mulberry32(seed), obsSource = '';
let lastRep = null;
function trueParams(p) {
  if (p.model === 'pd') { const pc = P0 + (1 - P0) * p.pd; return { pc, d: invertPc(pcTriangle, pc), pd: p.pd }; }
  const pc = pcTriangle(p.d); return { pc, d: p.d, pd: Math.max(0, (pc - P0) / (1 - P0)) };
}
/** One assessor: arrangement, codes, perceptions and the choice made by the decision rule. */
function trial(p, arr, r) {
  const codes = []; while (codes.length < 3) { const c = GOOD_CODES[Math.floor(r() * GOOD_CODES.length)]; if (!codes.includes(c)) codes.push(c); }
  const odd = oddIndex(arr.split(''));
  if (p.model === 'pd') {
    const disc = r() < p.pd;
    const chosen = disc ? odd : Math.floor(r() * 3);
    return { arr, codes, odd, chosen, correct: chosen === odd, disc, perc: null };
  }
  const perc = arr.split('').map(ch => (ch === 'B' ? p.d : 0) + randn(r));
  const dist = [[0, 1], [0, 2], [1, 2]].map(([i, j]) => ({ i, j, dd: Math.abs(perc[i] - perc[j]) })).sort((a, b) => a.dd - b.dd);
  const pair = [dist[0].i, dist[0].j], chosen = [0, 1, 2].find(k => !pair.includes(k));
  return { arr, codes, odd, chosen, correct: chosen === odd, perc, pair };
}
function makePanel(p, r) {
  const out = []; let block = [];
  for (let i = 0; i < p.n; i++) { if (i % 6 === 0) block = shuffle(TRI_ORDERS, r); out.push(trial(p, block[i % 6], r)); }
  return out;
}
function newPanel(play) {
  const p = ui.values(); seed = (seed * 1103515245 + 12345) % 2147483647; rng = mulberry32(seed);
  panel = makePanel(p, rng); shown = 0; prog = 0; lastRep = null;
  if (play && p.mode === 'sim') clock.play();
  refresh();
}
function revealAll() { shown = panel.length; prog = shown; clock.pause(); refresh(); }
function observed(p) {
  if (p.mode === 'mine') { const n = Math.max(1, Math.round(p.nObs)), x = Math.max(0, Math.min(n, Math.round(p.xObs))); return { n, x, complete: true }; }
  const n = shown, x = panel.slice(0, shown).filter(t => t.correct).length;
  return { n, x, complete: shown >= panel.length, nPlan: panel.length };
}
function analyse(n, x, p) {
  const pc = n ? x / n : NaN, alpha = +p.alpha;
  const pval = n ? binomUpper(x, n, P0) : NaN, xc = binomCritical(n, P0, alpha);
  const se = Math.sqrt(pc * (1 - pc) / n);
  const pd = Math.max(0, (pc - P0) / (1 - P0)), sePd = se / (1 - P0);
  const cp = clopperPearson(x, n, 0.95);
  const pdCI = cp.map(v => Math.max(0, (v - P0) / (1 - P0)));
  const d = invertPc(pcTriangle, pc);
  const sl = isFinite(d) && d > 0 ? slope(pcTriangle, d) : NaN;
  const seD = isFinite(sl) && sl > 1e-6 ? se / sl : NaN;
  const dCI = cp.map(v => invertPc(pcTriangle, v));
  const pc0 = P0 + (1 - P0) * p.pd0, psim = binomCdf(x, n, pc0);
  let xSimMax = -1; for (let k = 0; k <= n; k++) if (binomCdf(k, n, pc0) <= +p.beta) xSimMax = k; else break;
  const upPd = Math.max(0, (upperLimit(x, n, 1 - +p.beta) - P0) / (1 - P0));
  return { n, x, pc, pval, xc, pd, sePd, pdCI, d, seD, dCI, pc0, psim, xSimMax, upPd, cp };
}

/* ------------------------------------------------------------ stage (2D canvas) */
const stageEl = $('stage');
const cv = document.createElement('canvas'); cv.className = 'tt-canvas'; stageEl.appendChild(cv);
const hud = hudChips(stageEl);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'triangle-test.png'; a.click(); } });
const ctx = cv.getContext('2d');
new ResizeObserver(() => draw()).observe(stageEl);
document.addEventListener('ffp:theme', () => draw());

function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function label(t, x, y, { size = 12, weight = 600, color, align = 'left', base = 'alphabetic', mono = false } = {}) {
  ctx.font = `${weight} ${size}px ${mono ? '"JetBrains Mono", monospace' : 'Inter, sans-serif'}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(t, x, y);
}
function draw() {
  const W = stageEl.clientWidth, H = stageEl.clientHeight; if (!W || !H) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const P = palette(), p = ui.values(), tp = trueParams(p), ob = observed(p), A = analyse(ob.n, ob.x, p);
  const colA = resolveColor('water'), colB = resolveColor('magenta'), ok = P.ok || P.accent, bad = P.danger;
  const top = 58, split = Math.round(W * 0.6), g = 16;
  // ---------------- panel A: perception of the current assessor
  const ax0 = g + 6, ax1 = split - g, ay0 = top, ay1 = Math.round(H * 0.53);
  rr(ax0 - 6, ay0 - 6, ax1 - ax0 + 12, ay1 - ay0 + 12, 12); ctx.fillStyle = withAlpha(P.bgSunk || '#eeeeee', 0.55); ctx.fill();
  const cur = p.mode === 'sim' && shown > 0 ? panel[Math.min(shown, panel.length) - 1] : null;
  const dShow = p.mode === 'sim' ? tp.d : (isFinite(A.d) ? A.d : 3);
  const xmin = -3.4, xmax = Math.max(dShow, 0) + 3.4;
  const X = v => ax0 + 10 + (v - xmin) / (xmax - xmin) * (ax1 - ax0 - 20);
  const base = ay1 - 40, hh = (ay1 - ay0) * 0.4;
  const Y = dens => base - dens / 0.4 * hh;
  label(p.mode === 'sim' ? (cur ? `Assessor ${panelId(shown)} · arrangement ${cur.arr}` : 'Press “New panel” to start the tasting') : `Estimated perceptual distance from your data: d′ = ${isFinite(A.d) ? fmt(A.d, 2) : '> 6'}`, ax0 + 4, ay0 + 12, { size: 12.5, weight: 650, color: P.ink });
  // curves
  [[0, colA, 'A (control)'], [dShow, colB, 'B (test product)']].forEach(([m, c, lab]) => {
    ctx.beginPath(); for (let i = 0; i <= 160; i++) { const v = xmin + (xmax - xmin) * i / 160, yy = Y(Math.exp(-0.5 * (v - m) ** 2) / Math.sqrt(2 * Math.PI)); i ? ctx.lineTo(X(v), yy) : ctx.moveTo(X(v), yy); }
    ctx.lineTo(X(xmax), base); ctx.lineTo(X(xmin), base); ctx.closePath(); ctx.fillStyle = withAlpha(c, 0.13); ctx.fill();
    ctx.beginPath(); for (let i = 0; i <= 160; i++) { const v = xmin + (xmax - xmin) * i / 160, yy = Y(Math.exp(-0.5 * (v - m) ** 2) / Math.sqrt(2 * Math.PI)); i ? ctx.lineTo(X(v), yy) : ctx.moveTo(X(v), yy); }
    ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke();
  });
  const labA = dShow > 0.05;
  label('A (control)', X(0) - (labA ? 26 : 0), Y(0.4) + 4, { size: 11, color: colA, align: labA ? 'right' : 'center' });
  label('B (test)', X(dShow) + (labA ? 26 : 0), Y(0.4) + (labA ? 4 : -10), { size: 11, color: colB, align: labA ? 'left' : 'center' });
  ctx.strokeStyle = P.lineStrong; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(xmin), base); ctx.lineTo(X(xmax), base); ctx.stroke();
  if (p.mode === 'sim') label('perceptions in SD units →', ax1 - 2, ay0 + 12, { size: 10.5, weight: 500, color: P.muted, align: 'right' });
  else if (ob.n > 0 && isFinite(A.dCI[0])) { // exact 95 % interval of d′ drawn under the curves
    const yb = base - 10, x0 = X(Math.max(xmin, A.dCI[0])), x1 = X(Math.min(xmax, isFinite(A.dCI[1]) ? A.dCI[1] : xmax));
    ctx.strokeStyle = colB; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x0, yb); ctx.lineTo(x1, yb); ctx.stroke();
    ctx.lineWidth = 2; [x0, x1].forEach(x => { ctx.beginPath(); ctx.moveTo(x, yb - 6); ctx.lineTo(x, yb + 6); ctx.stroke(); });
    label(`exact 95 % CI of d′: ${fmt(A.dCI[0], 2)}–${isFinite(A.dCI[1]) ? fmt(A.dCI[1], 2) : '∞'}`, (x0 + x1) / 2, yb - 10, { size: 10.5, weight: 600, color: colB, align: 'center' });
  }
  if (labA) { const yd = Y(0.4) + 24; ctx.strokeStyle = P.ink2; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(0), yd); ctx.lineTo(X(dShow), yd); ctx.stroke(); ctx.setLineDash([]); label(`d′ = ${fmt(dShow, 2)}`, (X(0) + X(dShow)) / 2, yd - 4, { size: 11, color: P.ink2, align: 'center', mono: true }); }
  if (cur) {
    // tray: three cups in serving order
    const cupY = ay0 + 34;
    const cx = k => ax0 + 40 + k * 64;
    cur.codes.forEach((c, k) => {
      const isB = cur.arr[k] === 'B';
      rr(cx(k) - 24, cupY, 48, 30, 7); ctx.fillStyle = P.bgElev; ctx.fill(); ctx.strokeStyle = k === cur.chosen ? (cur.correct ? ok : bad) : P.lineStrong; ctx.lineWidth = k === cur.chosen ? 2.5 : 1; ctx.stroke();
      label(String(c), cx(k), cupY + 15, { size: 12.5, weight: 700, color: P.ink, align: 'center', base: 'middle', mono: true });
      label(isB ? 'B' : 'A', cx(k), cupY + 42, { size: 10.5, weight: 700, color: isB ? colB : colA, align: 'center' });
      if (cur.perc) { // dotted line down to the perceived value
        const px = X(cur.perc[k]); ctx.strokeStyle = withAlpha(isB ? colB : colA, 0.7); ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(cx(k), cupY + 48); ctx.lineTo(px, base - 8); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(px, base, 6.5, 0, Math.PI * 2); ctx.fillStyle = isB ? colB : colA; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = P.bgElev; ctx.stroke();
        if (k === cur.chosen) { ctx.beginPath(); ctx.arc(px, base, 11, 0, Math.PI * 2); ctx.strokeStyle = cur.correct ? ok : bad; ctx.lineWidth = 2.5; ctx.stroke(); }
      }
    });
    if (cur.perc) { // bracket over the closest pair
      const [i, j] = cur.pair, xa = X(cur.perc[i]), xb = X(cur.perc[j]), yb = base + 18;
      ctx.strokeStyle = P.ink2; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xa, base + 9); ctx.lineTo(xa, yb); ctx.lineTo(xb, yb); ctx.lineTo(xb, base + 9); ctx.stroke();
      const lx = Math.min(Math.max((xa + xb) / 2, ax0 + 80), ax1 - 80);
      label('closest pair → judged “the same”', lx, yb + 13, { size: 10.5, weight: 600, color: P.ink2, align: 'center' });
    } else {
      label(cur.disc ? 'Discriminator: perceives the difference and picks the odd sample.' : 'Non-discriminator: cannot perceive it and guesses (chance 1/3).', ax0 + 4, base - 6, { size: 11.5, color: P.ink2 });
    }
    const badge = cur.correct ? '✓ correct' : '✗ wrong';
    rr(ax1 - 96, ay0 + 26, 90, 26, 13); ctx.fillStyle = withAlpha(cur.correct ? ok : bad, 0.16); ctx.fill();
    label(badge, ax1 - 51, ay0 + 39, { size: 12.5, weight: 700, color: cur.correct ? ok : bad, align: 'center', base: 'middle' });
    label(`odd sample: ${cur.codes[cur.odd]}`, ax1 - 51, ay0 + 66, { size: 10.5, weight: 500, color: P.muted, align: 'center', mono: true });
  }
  // ---------------- panel B: binomial null distribution
  const bx0 = g + 6, bx1 = split - g, by0 = ay1 + 26, by1 = H - 24;
  const n = Math.max(1, p.mode === 'sim' ? p.n : A.n), xc = binomCritical(n, P0, +p.alpha);
  const pc1 = p.mode === 'sim' ? tp.pc : pcTriangle(1.5);
  const pm0 = [], pm1 = []; let mx = 0; for (let k = 0; k <= n; k++) { pm0.push(binomPmf(k, n, P0)); pm1.push(binomPmf(k, n, pc1)); mx = Math.max(mx, pm0[k], pm1[k]); }
  label(`Number correct if nobody perceives a difference (H₀: p = 1/3, n = ${n})`, bx0, by0 + 2, { size: 12.5, weight: 650, color: P.ink });
  ctx.font = '500 10.5px Inter, sans-serif'; let lx = bx0;
  [[withAlpha(P.muted, 0.7), 'guessing'], [withAlpha(colB, 0.85), `critical region x ≥ ${xc}`], [resolveColor('accent'), p.mode === 'sim' ? `dashed: true difference (p_c = ${fmt(tp.pc, 3)})` : 'dashed: if d′ were 1.5']].forEach(([c, t]) => { ctx.fillStyle = c; ctx.fillRect(lx, by0 + 12, 10, 8); label(t, lx + 14, by0 + 19.5, { size: 10.5, weight: 500, color: P.ink2 }); lx += 26 + ctx.measureText(t).width; });
  const gx = k => bx0 + 26 + (k + 0.5) / (n + 1) * (bx1 - bx0 - 34), gw = Math.max(1.2, (bx1 - bx0 - 34) / (n + 1) - 1.5);
  const gy0 = by0 + 30, gy1 = by1 - 16, GY = v => gy1 - v / mx * (gy1 - gy0);
  ctx.fillStyle = withAlpha(colB, 0.08); ctx.fillRect(gx(xc) - gw / 2 - 1, gy0, gx(n) - gx(xc) + gw + 2, gy1 - gy0);
  for (let k = 0; k <= n; k++) { ctx.fillStyle = k >= xc ? withAlpha(colB, 0.85) : withAlpha(P.muted, 0.55); ctx.fillRect(gx(k) - gw / 2, GY(pm0[k]), gw, gy1 - GY(pm0[k])); }
  ctx.strokeStyle = resolveColor('accent'); ctx.lineWidth = 1.8; ctx.setLineDash([5, 3]); ctx.beginPath(); for (let k = 0; k <= n; k++) { k ? ctx.lineTo(gx(k), GY(pm1[k])) : ctx.moveTo(gx(k), GY(pm1[k])); } ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = P.lineStrong; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx0 + 22, gy1 + 0.5); ctx.lineTo(bx1, gy1 + 0.5); ctx.stroke();
  const step = n <= 30 ? 5 : n <= 60 ? 10 : 20;
  for (let k = 0; k <= n; k += step) label(String(k), gx(k), gy1 + 13, { size: 10, weight: 500, color: P.muted, align: 'center', mono: true });
  if (ob.n > 0) {
    const xo = A.x, xpx = p.mode === 'sim' && !ob.complete ? gx(Math.min(n, xo)) : gx(xo);
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(xpx, gy0 + 18); ctx.lineTo(xpx, gy1); ctx.stroke();
    const txt = p.mode === 'sim' && !ob.complete ? `${xo} correct so far` : `x = ${xo} · ${pEq(A.pval)}`;
    ctx.font = '700 11.5px Inter, sans-serif'; const tw = ctx.measureText(txt).width;
    const tx = Math.min(Math.max(xpx - tw / 2 - 6, bx0), bx1 - tw - 12);
    rr(tx, gy0 + 20, tw + 12, 20, 6); ctx.fillStyle = P.bgElev; ctx.fill(); ctx.strokeStyle = P.lineStrong; ctx.stroke();
    label(txt, tx + 6, gy0 + 30, { size: 11.5, weight: 700, color: P.ink, base: 'middle' });
  }
  // ---------------- panel C: the panel of assessors
  const cx0 = split + 6, cx1 = W - g, cy0 = top;
  rr(cx0 - 6, cy0 - 6, cx1 - cx0 + 12, H - cy0 - 12, 12); ctx.fillStyle = withAlpha(P.bgSunk || '#eeeeee', 0.55); ctx.fill();
  label('The panel', cx0 + 6, cy0 + 12, { size: 12.5, weight: 650, color: P.ink });
  const N = p.mode === 'sim' ? panel.length : A.n;
  const cols = N <= 30 ? 6 : N <= 60 ? 8 : N <= 90 ? 10 : 12, rows = Math.ceil(N / cols);
  const gridTop = cy0 + 26, gridH = H - gridTop - 96, cell = Math.min((cx1 - cx0 - 12) / cols, gridH / Math.max(rows, 1)), gap = Math.max(2, cell * 0.12);
  for (let i = 0; i < N; i++) {
    const r = Math.floor(i / cols), c = i % cols, x = cx0 + 6 + c * cell, y = gridTop + r * cell;
    let st = 'pending';
    if (p.mode === 'sim') { if (i < shown) st = panel[i].correct ? 'ok' : 'bad'; }
    else st = i < A.x ? 'ok' : 'bad';
    rr(x + gap / 2, y + gap / 2, cell - gap, cell - gap, Math.min(7, cell * 0.2));
    ctx.fillStyle = st === 'ok' ? withAlpha(ok, 0.85) : st === 'bad' ? withAlpha(bad, 0.28) : withAlpha(P.muted, 0.12); ctx.fill();
    if (p.mode === 'sim' && i === shown - 1) { ctx.strokeStyle = P.ink; ctx.lineWidth = 2; ctx.stroke(); }
    if (cell > 26) label(st === 'ok' ? '✓' : st === 'bad' ? '✗' : String(i + 1), x + cell / 2, y + cell / 2 + 1, { size: Math.min(13, cell * 0.36), weight: 700, color: st === 'ok' ? '#ffffff' : st === 'bad' ? bad : P.muted, align: 'center', base: 'middle' });
  }
  const ty = H - 64;
  label(`${A.x} correct of ${A.n}${p.mode === 'sim' && !ob.complete ? ` answered (of ${panel.length})` : ''}`, cx0 + 6, ty, { size: 14, weight: 700, color: P.ink });
  const need = binomCritical(p.mode === 'sim' ? panel.length || p.n : A.n, P0, +p.alpha);
  label(`significance needs ≥ ${need} correct (α = ${p.alpha})`, cx0 + 6, ty + 20, { size: 11.5, weight: 500, color: P.muted });
  const barW = cx1 - cx0 - 12, frac = Math.min(1, A.x / Math.max(1, need));
  rr(cx0 + 6, ty + 30, barW, 8, 4); ctx.fillStyle = withAlpha(P.muted, 0.18); ctx.fill();
  rr(cx0 + 6, ty + 30, Math.max(8, barW * frac), 8, 4); ctx.fillStyle = A.x >= need ? ok : resolveColor('amber'); ctx.fill();
}

/* ------------------------------------------------------------ charts */
const powerPlot = new Plot('#chart-power', { x: { label: 'Assessors n', min: 6, max: 120 }, y: { label: 'Power', unit: '', min: 0, max: 1 } });
const psyPlot = new Plot('#chart-psy', { x: { label: 'd′', unit: 'SD', min: 0, max: 4 }, y: { label: 'Probability correct p_c', unit: '', min: 0.3, max: 1 } });
const repPlot = new Plot('#chart-rep', { x: { label: 'Correct answers x in one panel', min: 0, max: 24 }, y: { label: 'Share of panels', unit: '', min: 0 } });
const simPlot = new Plot('#chart-sim', { x: { label: 'Proportion of discriminators p_d', min: 0, max: 1 }, y: { label: '', min: 0, max: 1, format: () => '' }, legend: false, crosshair: false });
let pwTimer = null;
function updatePower(p, tp) {
  clearTimeout(pwTimer);
  pwTimer = setTimeout(() => {
    const ns = []; for (let n = 6; n <= 120; n++) ns.push(n);
    const d = tp.d;
    const show = [['triangle', 'accent', 2.6, null], ['tetrad', 'c2', 1.8, [6, 3]], ['duotrio', 'c3', 1.6, [2, 3]], ['afc2', 'c4', 1.6, [8, 3, 2, 3]]];
    show.forEach(([k, col, w, dash]) => {
      const M = METHODS[k]; const pc1 = k === 'triangle' ? tp.pc : M.f(d);
      const pw = ns.map(n => binomUpper(binomCritical(n, M.p0, +p.alpha), n, pc1));
      powerPlot.line(k, ns, pw, { color: col, width: w, dash, label: M.label + (k === 'afc2' ? ' (directional)' : '') });
    });
    powerPlot.hline('target', 0.8, { color: 'muted', label: '80 %' });
    powerPlot.vline('now', p.mode === 'sim' ? p.n : Math.min(120, p.nObs), { color: 'magenta', label: `n = ${p.mode === 'sim' ? p.n : p.nObs}` });
  }, 60);
}
function updatePsy(p, A, tp) {
  const ds = linspace(0, 4, 121);
  [['triangle', 'accent', 2.6], ['tetrad', 'c2', 1.4], ['duotrio', 'c3', 1.4], ['afc3', 'c5', 1.4], ['afc2', 'c4', 1.4]].forEach(([k, col, w]) => psyPlot.line(k, ds, ds.map(d => METHODS[k].f(d)), { color: col, width: w, label: METHODS[k].label, opacity: k === 'triangle' ? 1 : 0.7 }));
  if (A.n > 0 && isFinite(A.pc)) {
    const lo = A.cp[0], hi = A.cp[1];
    psyPlot.hregion('pcband', Math.max(0.3, lo), Math.min(1, hi), { color: 'magenta', alpha: 0.1 });
    const dLo = A.dCI[0], dHi = isFinite(A.dCI[1]) ? Math.min(4, A.dCI[1]) : 4;
    psyPlot.region('dband', dLo, dHi, { color: 'magenta', alpha: 0.1 });
    psyPlot.hline('pcobs', Math.max(0.3, A.pc), { color: 'magenta', label: `p̂_c = ${fmt(A.pc, 3)}` });
    if (isFinite(A.d) && A.d <= 4) psyPlot.point('est', A.d, A.pc, { color: 'magenta', label: `d′ = ${fmt(A.d, 2)}`, guides: true }); else psyPlot.remove('est');
  }
  if (p.mode === 'sim') psyPlot.vline('true', Math.min(4, tp.d), { color: 'accent', label: 'true d′' }); else psyPlot.remove('true');
}
function updateSim(p, A) {
  simPlot.clear();
  simPlot.custom('sim', (ctx, pl, P) => {
    const r = pl.plotRect, y1 = r.top + r.height * 0.3, y2 = r.top + r.height * 0.68;
    const X = v => pl.px(Math.max(0, Math.min(1, v)));
    ctx.fillStyle = withAlpha(resolveColor('danger'), 0.08); ctx.fillRect(X(p.pd0), r.top, X(1) - X(p.pd0), r.height);
    ctx.strokeStyle = resolveColor('danger'); ctx.setLineDash([6, 4]); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(X(p.pd0), r.top); ctx.lineTo(X(p.pd0), r.top + r.height); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '600 11px Inter, sans-serif'; ctx.fillStyle = resolveColor('danger'); ctx.textAlign = 'left'; ctx.fillText(`tolerable limit p_d0 = ${fmt(p.pd0, 2)}`, X(p.pd0) + 5, r.top + 13);
    if (!(A.n > 0)) return;
    const acc = resolveColor('accent'), mag = resolveColor('magenta');
    // two-sided 95 % CI (difference test view)
    ctx.strokeStyle = mag; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(X(A.pdCI[0]), y1); ctx.lineTo(X(A.pdCI[1]), y1); ctx.stroke();
    [A.pdCI[0], A.pdCI[1]].forEach(v => { ctx.beginPath(); ctx.moveTo(X(v), y1 - 7); ctx.lineTo(X(v), y1 + 7); ctx.stroke(); });
    ctx.beginPath(); ctx.arc(X(A.pd), y1, 5.5, 0, Math.PI * 2); ctx.fillStyle = mag; ctx.fill();
    ctx.fillStyle = P.ink2; ctx.textAlign = 'right'; ctx.fillText(`two-sided 95 % CI (exact) ${fmt(A.pdCI[0], 2)}–${fmt(A.pdCI[1], 2)}: excludes 0? → different`, X(1) - 4, y1 - 12);
    // one-sided upper limit (similarity view)
    ctx.strokeStyle = acc; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(X(0), y2); ctx.lineTo(X(A.upPd), y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(A.upPd), y2 - 7); ctx.lineTo(X(A.upPd), y2 + 7); ctx.stroke();
    ctx.fillStyle = P.ink2; ctx.fillText(`one-sided ${Math.round(100 * (1 - p.beta))} % upper limit ${fmt(A.upPd, 2)}: below p_d0? → similar`, X(1) - 4, y2 - 12); ctx.textAlign = 'left';
    const diff = A.pval <= +p.alpha, simi = A.psim <= +p.beta;
    ctx.font = '700 12px Inter, sans-serif'; ctx.fillStyle = P.ink; ctx.fillText(`${diff ? 'Different' : 'No evidence of a difference'} · ${simi ? 'similar' : 'similarity not shown'}`, X(0) + 4, r.top + r.height - 8);
  }, { noClip: true });
  simPlot.setAxis('x', { min: 0, max: 1 });
}
function updateRep(p, tp) {
  if (!lastRep || lastRep.key !== [p.n, tp.pc, p.model, p.alpha].join('|')) { repPlot.clear(); repPlot.text('hint', 0.5 * p.n, 0.15, 'Press “Repeat 1000 panels” to run the same experiment 1000 times', { align: 'center', color: 'muted' }); repPlot.setAxis('x', { min: 0, max: p.n }); repPlot.setAxis('y', { min: 0, max: 0.3 }); return; }
  const { counts, reps, n } = lastRep, xc = binomCritical(n, P0, +p.alpha);
  repPlot.remove('hint'); repPlot.setAxis('x', { min: -0.5, max: n + 0.5 }); repPlot.setAxis('y', { min: 0, max: 'auto' });
  const share = counts.map(c => c / reps), emp = counts.slice(xc).reduce((a, b) => a + b, 0) / reps;
  const ks = counts.map((_, k) => k);
  repPlot.custom('bars', (ctx, pl, P) => { const w = Math.max(1, pl.px(1) - pl.px(0) - 1.5); ks.forEach(k => { ctx.fillStyle = k >= xc ? withAlpha(resolveColor('magenta'), 0.8) : withAlpha(P.muted, 0.5); const y = pl.py(share[k]); ctx.fillRect(pl.px(k) - w / 2, y, w, pl.py(0) - y); }); });
  repPlot.scatter('frame', ks, share, { color: 'transparent', r: 0, noTip: true });
  repPlot.line('theory', ks, ks.map(k => binomPmf(k, n, tp.pc)), { color: 'accent', width: 2, label: 'binomial Bin(n, p_c)' });
  repPlot.vline('xc', xc - 0.5, { color: 'magenta', label: `x ≥ ${xc}: significant in ${fmt(100 * emp, 1)} % of panels` });
}
function repeatPanels(reps) {
  const p = ui.values(), tp = trueParams(p), r = mulberry32(seed + 77);
  const counts = new Array(p.n + 1).fill(0);
  for (let i = 0; i < reps; i++) { const pan = makePanel(p, r); counts[pan.filter(t => t.correct).length]++; }
  lastRep = { key: [p.n, tp.pc, p.model, p.alpha].join('|'), counts, reps, n: p.n };
  updateRep(p, tp); toast(`${reps} panels simulated`);
}

/* ------------------------------------------------------------ critical-number table */
function renderTable(p, A) {
  const nNow = p.mode === 'sim' ? p.n : A.n, tp = trueParams(p), pc0 = P0 + (1 - P0) * p.pd0;
  const rows = []; for (let n = 6; n <= 120; n++) {
    if (n > 60 && n % 6 && n !== nNow) continue;
    const c05 = binomCritical(n, P0, 0.05), c01 = binomCritical(n, P0, 0.01), c001 = binomCritical(n, P0, 0.001);
    let sm = -1; for (let k = 0; k <= n; k++) { if (binomCdf(k, n, pc0) <= +p.beta) sm = k; else break; }
    const pw = binomUpper(binomCritical(n, P0, +p.alpha), n, tp.pc);
    rows.push(`<tr class="${n === nNow ? 'cur' : ''}"><td class="num">${n}</td><td class="num">${c05 > n ? '—' : c05}</td><td class="num">${c01 > n ? '—' : c01}</td><td class="num">${c001 > n ? '—' : c001}</td><td class="num">${sm < 0 ? '—' : sm}</td><td class="num">${fmt(pw, 2)}</td></tr>`);
  }
  $('crit-table').innerHTML = `<table class="crit"><thead><tr><th class="num">n</th><th class="num">x<sub>c</sub> α 0.05</th><th class="num">α 0.01</th><th class="num">α 0.001</th><th class="num">similar if x ≤ (p<sub>d0</sub> ${fmt(p.pd0, 2)}, β ${p.beta})</th><th class="num">power (α ${p.alpha}, ${p.model === 'pd' ? 'p_d ' + fmt(p.pd, 2) : 'd′ ' + fmt(p.d, 2)})</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  const tr = document.querySelector('#crit-table tr.cur'); if (tr) { const box = $('crit-table'); box.scrollTop = Math.max(0, tr.offsetTop - box.clientHeight / 2); }
}

/* ------------------------------------------------------------ project data */
function loadProject() {
  const s = loadStudy();
  if (!s) { toast('No study stored in this browser — create one in the sensory booth lab'); return; }
  if (s.design.test !== 'triangle') { toast(`The stored study is a ${s.design.test} test, not a triangle test`); return; }
  const rs = s.responses.filter(r => typeof r.correct === 'boolean');
  if (!rs.length) { toast('The stored triangle study has no responses yet'); return; }
  const n = rs.length, x = rs.filter(r => r.correct).length;
  obsSource = `Loaded from the project: ${n} responses of ${s.design.orders ? s.design.orders.length : s.design.panellists} planned (${s.design.samples.map(q => q.code + ' = ' + q.label).join(', ')}).`;
  ui.setMany({ mode: 'mine', nObs: n, xObs: x });
  toast(`Loaded ${x} correct of ${n}`);
}
function downloadPanel() {
  const p = ui.values();
  if (p.mode === 'mine' || !panel.length) { downloadCSV('triangle-result.csv', ['n', 'correct', 'p_value', 'pd_hat', 'dprime'], [(() => { const A = analyse(observed(p).n, observed(p).x, p); return [A.n, A.x, A.pval, A.pd, A.d]; })()]); return; }
  downloadCSV('triangle-simulated-panel.csv', ['assessor', 'arrangement', 'code_left', 'code_middle', 'code_right', 'odd_code', 'chosen_code', 'correct', 'perc_left', 'perc_middle', 'perc_right'], panel.slice(0, shown || panel.length).map((t, i) => [panelId(i + 1), t.arr, ...t.codes, t.codes[t.odd], t.codes[t.chosen], t.correct ? 1 : 0, ...(t.perc ? t.perc.map(v => +v.toFixed(3)) : ['', '', ''])]));
}

/* ------------------------------------------------------------ update */
const clock = new SimClock({ speed: 1, onStep: dt => { const p = ui.values(); prog += dt * p.speed; const k = Math.min(panel.length, Math.floor(prog)); if (k !== shown) { shown = k; refresh(shown < panel.length); } if (shown >= panel.length) clock.pause(); } });
clock.onState(run => { simBtns[1].textContent = run ? 'Pause' : 'Play'; });
let structKey = '';
function refresh(light) {
  const p = ui.values(), tp = trueParams(p), ob = observed(p), A = analyse(ob.n, ob.x, p);
  const sim = p.mode === 'sim';
  ['model', 'd', 'pd', 'speed'].forEach(id => ui.enable(id, sim));
  simBtns.forEach(b => b.disabled = !sim);
  ui.enable('nObs', !sim); ui.enable('xObs', !sim);
  ui.show('d', p.model === 'dprime'); ui.show('pd', p.model === 'pd');
  $('src-note').textContent = obsSource || 'Enter the numbers from your own test, or load them from the project data stored in this browser.';
  // readouts
  const alpha = +p.alpha;
  ro.set('x', ob.n ? `${ob.x} of ${ob.n}` : '—', null, sim && !ob.complete ? 'panel still answering' : sim ? 'simulated panel' : 'your data');
  ro.set('pc', ob.n ? A.pc : NaN, null, 'guessing gives 0.333');
  ro.set('p', ob.n ? A.pval : NaN, ob.n ? (A.pval <= alpha ? 'ok' : null) : null, ob.n ? (A.pval <= alpha ? `significant at α = ${alpha}: a perceptible difference` : 'not significant — not evidence of “no difference”') : '');
  const nPlan = sim ? p.n : A.n, xcPlan = binomCritical(nPlan, P0, alpha);
  ro.set('xc', xcPlan > nPlan ? `impossible (n = ${nPlan})` : `x ≥ ${xcPlan} of ${nPlan}`, xcPlan > nPlan ? 'bad' : null, `smallest x with P(X ≥ x | 1/3) ≤ ${alpha}`);
  ro.set('pdh', ob.n ? A.pd : NaN, null, ob.n ? `95 % CI ${fmt(A.pdCI[0], 2)}–${fmt(A.pdCI[1], 2)} (exact)` : '');
  ro.set('dp', ob.n ? A.d : NaN, null, ob.n ? `${isFinite(A.seD) ? '± ' + fmt(A.seD, 2) + ' (Wald) · ' : ''}exact CI ${fmt(A.dCI[0], 2)}–${isFinite(A.dCI[1]) ? fmt(A.dCI[1], 2) : '∞'}` : '');
  const nDesign = sim ? p.n : A.n, pw = binomUpper(binomCritical(nDesign, P0, alpha), nDesign, tp.pc);
  ro.set('power', pw, pw >= 0.8 ? 'ok' : pw >= 0.5 ? 'warn' : 'bad', `${p.model === 'pd' ? 'p_d = ' + fmt(p.pd, 2) : 'd′ = ' + fmt(p.d, 2)}, n = ${nDesign}`);
  ro.set('sim', ob.n ? A.psim : NaN, ob.n ? (A.psim <= +p.beta ? 'ok' : null) : null, ob.n ? (A.psim <= +p.beta ? `similar: p_d < ${fmt(p.pd0, 2)} (similar if x ≤ ${A.xSimMax})` : `not shown (needs x ≤ ${A.xSimMax < 0 ? '—' : A.xSimMax})`) : '');
  hud.set('n', `${sim ? 'Simulated' : 'Your'} panel · <b>${ob.x}</b> correct of <b>${ob.n}</b>`);
  hud.set('t', sim ? `True ${p.model === 'pd' ? 'p_d' : 'd′'} = <b>${fmt(p.model === 'pd' ? p.pd : p.d, 2)}</b> → p_c = <b>${fmt(tp.pc, 3)}</b>` : `Estimate d′ = <b>${isFinite(A.d) ? fmt(A.d, 2) : '∞'}</b>`);
  hud.set('p', `<b>${ob.n ? pEq(A.pval) : 'p = —'}</b>`);
  draw();
  updatePsy(p, A, tp); updateSim(p, A);
  if (light) return;
  updatePower(p, tp); updateRep(p, tp); renderTable(p, A);
}
ui.onChange((s, id) => {
  const p = ui.values(); const key = [p.n, p.model, p.d, p.pd].join('|');
  if (p.mode === 'sim' && key !== structKey && ['n', 'model', 'd', 'pd'].includes(id)) { structKey = key; newPanel(false); revealAll(); return; }
  refresh();
});
structKey = [ui.get('n'), ui.get('model'), ui.get('d'), ui.get('pd')].join('|');
newPanel(false); revealAll();
// start with a short animated run so that the first view shows the model at work
setTimeout(() => { if (ui.get('mode') === 'sim') newPanel(true); }, 700);
window.__tri = { analyse, trueParams, get panel() { return panel; }, repeatPanels, newPanel, revealAll };
