/* Protein quality calculator — amino-acid database, blend builder, DIAAS/PDCAAS, optimiser.
   Model: Eqs. P1–P8 in the Derive tab (FAO 2013 DIAAS method applied to protein blends). */
import { Controls, Readouts, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, BarChart, linspace, downloadCSV } from '/assets/js/plot.js';
import { palette, categorical, withAlpha, colormap } from '/assets/js/colors.js';
import { SOURCES, BY_ID, IAA, IAA_LONG, PATTERNS, GROUPS } from './data.js';

const $ = s => document.querySelector(s);
const SLOT_STAGE = ['#6fd39a', '#5cc8ef', '#f07ad0', '#f2b94b'];   // bright slot colours for the dark stage
const slotColor = k => categorical(k);                                 // theme-aware slot colours for charts
const GROUP_COL = { legume: '#3f9d5c', cereal: '#c8912f', tuber: '#8a8f3a', microbial: '#7d62c9', insect: '#c9653a', animal: '#b8404d' };
// one distinct colour per amino acid (Lys blue and SAA red: the two most frequent limiting amino acids)
const AA_COL = ['#7a5cd6', '#2e8b7a', '#8a8f2e', '#1f7fbf', '#d0413a', '#8c99a6', '#d08a12', '#c2419a', '#3f9d5c'];

/* ================================================================ model */
function activeItems(p) {
  const out = [];
  for (let k = 1; k <= 4; k++) {
    const id = p['s' + k];
    if (id && id !== 'none' && BY_ID[id] && p['m' + k] > 0) out.push({ slot: k - 1, src: BY_ID[id], m: p['m' + k] });
  }
  return out;
}
/** Blend on a protein basis (Eqs. P3–P4). items: [{src, m}] with m in any mass unit. */
function blendOf(items) {
  const M = items.reduce((a, it) => a + it.m, 0);
  const P = items.reduce((a, it) => a + it.m * it.src.x, 0);
  if (!(M > 0) || !(P > 0)) return null;
  const w = items.map(it => it.m * it.src.x / P);
  const c = IAA.map((_, i) => items.reduce((a, it, k) => a + w[k] * it.src.c[i], 0));
  const dig = IAA.map((_, i) => items.reduce((a, it, k) => a + w[k] * it.src.dig[i], 0));
  const contrib = items.map((it, k) => IAA.map((_, i) => w[k] * it.src.dig[i]));
  const tdf = items.reduce((a, it, k) => a + w[k] * it.src.tdf, 0);
  return { items, M, P, x: P / M, w, massShare: items.map(it => it.m / M), c, dig, contrib, tdf };
}
/** Scores against a pattern (Eqs. P5–P6). */
function scoreOf(b, r) {
  const ratios = b.dig.map((v, i) => v / r[i]);
  let lim = 0; ratios.forEach((v, i) => { if (v < ratios[lim]) lim = i; });
  const order = ratios.map((v, i) => i).sort((a, c) => ratios[a] - ratios[c]);
  const aasR = b.c.map((v, i) => v / r[i]);
  let alim = 0; aasR.forEach((v, i) => { if (v < aasR[alim]) alim = i; });
  const aas = aasR[alim];
  return { ratios, lim, second: order[1], diaas: 100 * ratios[lim], aas, aasLim: alim, pdcaasRaw: aas * b.tdf, pdcaas: Math.min(1, aas * b.tdf) };
}
/** Daily needs (Eq. P7). */
function needOf(diaas, x, bw, preq) {
  const need = bw * preq / Math.min(1, diaas / 100);
  return { need, grams: need / x };
}
function claimOf(d) {
  if (d >= 100) return { cls: 'ok', text: 'excellent / high quality (DIAAS ≥ 100)', short: 'Excellent quality' };
  if (d >= 75) return { cls: 'warn', text: 'good quality — “source” claim (75–99)', short: 'Good quality' };
  return { cls: 'bad', text: 'no protein-quality claim (DIAAS < 75)', short: 'No quality claim' };
}

/* ================================================================ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'diaas', label: 'DIAAS of the blend', unit: '%', digits: 0 })
  .add({ id: 'lim', label: 'First-limiting amino acid', unit: '', format: v => v })
  .add({ id: 'pdcaas', label: 'PDCAAS (truncated at 1)', unit: '', digits: 2 })
  .add({ id: 'aas', label: 'Amino-acid score (undigested)', unit: '', digits: 2 })
  .add({ id: 'prot', label: 'Protein content of the blend', unit: 'g per 100 g', digits: 1 })
  .add({ id: 'dig', label: 'Ileal digestibility of the IAA', unit: '%', digits: 0 })
  .add({ id: 'need', label: 'Quality-adjusted protein need', unit: 'g d⁻¹', digits: 0 })
  .add({ id: 'grams', label: 'Blend needed per day', unit: 'g d⁻¹', digits: 0 });

const srcOptions = [{ value: 'none', label: '— none —' }].concat(
  Object.keys(GROUPS).flatMap(g => SOURCES.filter(s => s.group === g).map(s => ({ value: s.id, label: `${s.label} · ${s.cp.toFixed(0)} % protein` })))
);
const DEF = { s1: 'wheat', s2: 'pea', s3: 'none', s4: 'none', m1: 76, m2: 24, m3: 0, m4: 0 };
ui.section('Blend — ingredients and mass shares');
for (let k = 1; k <= 4; k++) {
  ui.select({ id: 's' + k, label: `<span class="pq-dot" style="background:${SLOT_STAGE[k - 1]}"></span>Ingredient ${k}`, options: srcOptions, value: DEF['s' + k] });
  ui.slider({ id: 'm' + k, label: 'Mass share', min: 0, max: 100, step: 1, value: DEF['m' + k], unit: '%', help: k === 1 ? 'The four shares always add up to 100 % of the blend mass; moving one rescales the others.' : '' });
}
ui.section('Reference pattern and person');
ui.segmented({ id: 'pat', label: 'FAO (2013) scoring pattern', options: [{ value: 'infant', label: 'Infant' }, { value: 'child', label: '6 mo–3 y' }, { value: 'older', label: 'Older/adult' }], value: 'child', help: 'For regulatory use FAO recommends the 6 mo–3 y pattern for all foods except infant formula.' });
ui.slider({ id: 'bw', label: 'Body mass', min: 5, max: 120, step: 1, value: 70, unit: 'kg' });
ui.slider({ id: 'preq', label: 'Protein requirement', min: 0.66, max: 1.6, step: 0.01, value: 0.83, unit: 'g kg⁻¹ d⁻¹', help: 'WHO/FAO/UNU (2007): adult average requirement 0.66, safe level 0.83 (high-quality protein).' });
ui.section('Best-blend optimiser (grid search)');
ui.select({ id: 'scope', label: 'Search among', options: [{ value: 'selected', label: 'my selected ingredients (best proportions)' }, { value: 'plant', label: 'plant ingredients only' }, { value: 'nonanimal', label: 'plants, fungi, algae and insects' }, { value: 'all', label: 'all 17 ingredients' }], value: 'plant' });
ui.segmented({ id: 'ncomp', label: 'Components', options: [{ value: 2, label: '2' }, { value: 3, label: '3' }], value: 2, help: 'Ignored when optimising your selected ingredients.' });
ui.segmented({ id: 'obj', label: 'Objective', options: [{ value: 'diaas', label: 'Highest DIAAS' }, { value: 'grams', label: 'Fewest grams per day' }], value: 'diaas' });
ui.buttons([{ label: 'Apply best blend', variant: 'primary', onClick: () => applyOpt(0) }]);
ui.section('Display');
ui.toggle({ id: 'outline', label: 'Show undigested content (dashed outline)', value: true });
ui.toggle({ id: 'stack', label: 'Colour petals by ingredient', value: true });
ui.presets([
  { label: 'Bread + pea protein', title: '76 % whole-grain wheat, 24 % pea protein concentrate (≈ 40:60 on a protein basis, the Herreman et al. optimum)', values: { s1: 'wheat', m1: 76, s2: 'pea', m2: 24, s3: 'none', m3: 0, s4: 'none', m4: 0 } },
  { label: 'Rice & beans', title: '60 % polished rice, 40 % faba bean (by mass)', values: { s1: 'rice', m1: 60, s2: 'faba', m2: 40, s3: 'none', m3: 0, s4: 'none', m4: 0 } },
  { label: 'Oat drink + potato protein', title: '85 % dehulled oats, 15 % potato protein concentrate', values: { s1: 'oat', m1: 85, s2: 'potato', m2: 15, s3: 'none', m3: 0, s4: 'none', m4: 0 } },
  { label: 'Cricket pasta', title: '80 % whole-grain wheat, 20 % house-cricket powder', values: { s1: 'wheat', m1: 80, s2: 'cricket', m2: 20, s3: 'none', m3: 0, s4: 'none', m4: 0 } },
  { label: 'Mycoprotein + pea', title: '80 % mycoprotein, 10 % pea protein concentrate, 10 % wheat', values: { s1: 'myco', m1: 80, s2: 'pea', m2: 10, s3: 'wheat', m3: 10, s4: 'none', m4: 0 } }
]);
ui.saveButton('protein-quality', () => ro.values());

/* Keep the four mass shares summing to 100 %. */
let rebalancing = false;
function rebalance(changed) {
  if (rebalancing) return;
  rebalancing = true;
  const p = ui.values();
  const act = [1, 2, 3, 4].filter(k => p['s' + k] !== 'none');
  [1, 2, 3, 4].forEach(k => { ui.enable('m' + k, p['s' + k] !== 'none'); if (p['s' + k] === 'none' && p['m' + k] !== 0) ui.set('m' + k, 0, true); });
  const q = ui.values();
  if (act.length) {
    const kc = changed && act.includes(changed) ? changed : null;
    if (act.length === 1) ui.set('m' + act[0], 100, true);
    else if (kc) {
      const v = Math.min(100, q['m' + kc]);
      const others = act.filter(k => k !== kc);
      const sumO = others.reduce((a, k) => a + q['m' + k], 0);
      let rest = 100 - v;
      others.forEach((k, i) => {
        const share = sumO > 0 ? q['m' + k] / sumO : 1 / others.length;
        const val = i === others.length - 1 ? rest : Math.round((100 - v) * share);
        ui.set('m' + k, Math.max(0, val), true); rest -= Math.max(0, val);
      });
      if (rest !== 0) { const k = others[others.length - 1]; ui.set('m' + k, Math.max(0, ui.get('m' + k) + rest), true); }
    } else {
      const sum = act.reduce((a, k) => a + q['m' + k], 0);
      if (Math.abs(sum - 100) > 0.5) {
        let acc = 0;
        act.forEach((k, i) => { const val = i === act.length - 1 ? 100 - acc : (sum > 0 ? Math.round(q['m' + k] / sum * 100) : Math.round(100 / act.length)); ui.set('m' + k, val, true); acc += val; });
      }
    }
  }
  rebalancing = false;
}

/* ================================================================ stage: amino-acid flower */
const stageEl = $('#stage');
const cv = document.createElement('canvas');
cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Amino-acid flower: each petal is the digestible content of one indispensable amino acid relative to the FAO reference pattern');
stageEl.appendChild(cv);
const ctx = cv.getContext('2d');
const tip = document.createElement('div'); tip.className = 'pq-tip'; stageEl.appendChild(tip);
const hud = hudChips(stageEl);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'amino-acid-flower.png'; a.click(); } });
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = stageEl.clientWidth; H = stageEl.clientHeight;
  if (!W || !H) return;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  hud.el.style.display = W < 640 ? 'none' : '';          // on phones the flower centre already shows DIAAS
  kick();
}
new ResizeObserver(resize).observe(stageEl);

let target = null, disp = null, raf = 0, hoverPetal = -1;
function kick() { if (!raf) raf = requestAnimationFrame(frame); }
function frame() {
  raf = 0;
  if (!target || !W) return;
  if (!disp) disp = JSON.parse(JSON.stringify(target));
  let moving = false;
  const k = 0.22;
  const l = (a, b) => { const v = a + (b - a) * k; if (Math.abs(v - b) > 0.05) moving = true; return Math.abs(v - b) > 0.05 ? v : b; };
  if (disp.stack.length !== target.stack.length) disp.stack = target.stack.map(r => r.map(() => 0));
  disp.stack = target.stack.map((row, s) => row.map((v, i) => l(disp.stack[s] ? disp.stack[s][i] : 0, v)));
  disp.total = target.total.map((v, i) => l(disp.total[i], v));
  disp.undig = target.undig.map((v, i) => l(disp.undig[i], v));
  disp.diaas = l(disp.diaas, target.diaas);
  Object.assign(disp, { lim: target.lim, slots: target.slots, names: target.names, mass: target.mass, prot: target.prot, pat: target.pat, x: target.x, dmean: target.dmean, empty: target.empty, claim: target.claim, outline: target.outline, stackOn: target.stackOn, r: target.r });
  draw();
  if (moving) raf = requestAnimationFrame(frame);
}
function geom() {
  const narrow = W < 640;
  const cx = narrow ? W * 0.5 : W * 0.385, cy = narrow ? (H - 24) / 2 + 4 : H * 0.54;
  const Rmax = narrow ? Math.max(50, Math.min((H - 70) / 2 - 22, W / 2 - 60)) : Math.max(60, Math.min(H * 0.40, W * 0.29));
  const r0 = Rmax * 0.24;
  return { narrow, cx, cy, Rmax, r0, rr: v => r0 + (Rmax - r0) * Math.min(Math.max(v, 0), 200) / 200 };
}
const NP = IAA.length, SPAN = 2 * Math.PI / NP, HALF = SPAN / 2 * 0.80;
const angOf = i => -Math.PI / 2 + i * SPAN;
function petalPath(c, cx, cy, ra, rb, a) {
  c.beginPath();
  c.arc(cx, cy, rb, a - HALF, a + HALF);
  c.arc(cx, cy, ra, a + HALF, a - HALF, true);
  c.closePath();
}
function draw() {
  const c = ctx; c.setTransform(DPR, 0, 0, DPR, 0, 0);
  const d = disp;
  // background
  const bg = c.createRadialGradient(W * 0.38, H * 0.5, 10, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
  bg.addColorStop(0, '#16261f'); bg.addColorStop(1, '#070d0b');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  const g = geom(); const { cx, cy, Rmax, r0, rr } = g;
  // radial guides
  c.save();
  c.lineWidth = 1; c.font = '500 10px "JetBrains Mono", monospace'; c.textAlign = 'left'; c.textBaseline = 'middle';
  [50, 150, 200].forEach(v => { c.strokeStyle = 'rgba(200,230,215,.09)'; c.setLineDash([2, 5]); c.beginPath(); c.arc(cx, cy, rr(v), 0, 7); c.stroke(); });
  c.setLineDash([]);
  // 75 % ring and 100 % ring
  c.strokeStyle = 'rgba(242,185,75,.35)'; c.setLineDash([4, 5]); c.beginPath(); c.arc(cx, cy, rr(75), 0, 7); c.stroke(); c.setLineDash([]);
  const ringGlow = c.createRadialGradient(cx, cy, rr(100) - 6, cx, cy, rr(100) + 6);
  ringGlow.addColorStop(0, 'rgba(155,231,182,0)'); ringGlow.addColorStop(0.5, 'rgba(155,231,182,.22)'); ringGlow.addColorStop(1, 'rgba(155,231,182,0)');
  c.fillStyle = ringGlow; c.beginPath(); c.arc(cx, cy, rr(100) + 6, 0, 7); c.arc(cx, cy, rr(100) - 6, 0, 7, true); c.fill();
  c.strokeStyle = 'rgba(155,231,182,.8)'; c.lineWidth = 1.6; c.beginPath(); c.arc(cx, cy, rr(100), 0, 7); c.stroke();
  c.restore();
  const ringLabels = () => {
    // ring labels in the gaps either side of the top petal (drawn after the petals so they stay visible)
    c.save(); c.font = '600 10px "JetBrains Mono", monospace'; c.textBaseline = 'middle'; c.textAlign = 'center';
    const aR = angOf(0) + SPAN / 2, aLft = angOf(0) - SPAN / 2;
    [[100, 'rgba(155,231,182,.95)', aR], [150, 'rgba(200,230,215,.55)', aR], [200, 'rgba(200,230,215,.55)', aR], [75, 'rgba(242,185,75,.9)', aLft]].forEach(([v, col, a]) => {
      const x = cx + rr(v) * Math.cos(a), y = cy + rr(v) * Math.sin(a);
      const t = v + ' %'; const tw = c.measureText(t).width;
      c.fillStyle = 'rgba(7,13,11,.82)'; roundRect(c, x - tw / 2 - 4, y - 7, tw + 8, 14, 4); c.fill();
      c.fillStyle = col; c.fillText(t, x, y);
    });
    c.restore();
  };
  if (d.empty) {
    c.fillStyle = 'rgba(230,238,233,.8)'; c.font = '600 15px Inter, sans-serif'; c.textAlign = 'center';
    c.fillText('Choose at least one ingredient with a mass share above 0 %', cx, cy);
    return;
  }
  // petals
  for (let i = 0; i < NP; i++) {
    const a = angOf(i);
    const isLim = i === d.lim && d.total[i] < 100.5;
    // undigested outline
    if (d.outline) {
      c.save(); c.setLineDash([3, 4]); c.strokeStyle = 'rgba(230,238,233,.45)'; c.lineWidth = 1.2;
      petalPath(c, cx, cy, r0, rr(d.undig[i]), a); c.stroke(); c.restore();
    }
    // stacked contributions
    let acc = 0;
    const rows = d.stackOn ? d.stack : [d.total];
    rows.forEach((row, s) => {
      const v = row[i]; if (!(v > 0.05)) return;
      const ra = rr(acc), rb = rr(acc + v); acc += v;
      const col = d.stackOn ? SLOT_STAGE[d.slots[s]] : (isLim ? '#ff7a6e' : '#6fd39a');
      const gr = c.createRadialGradient(cx, cy, r0, cx, cy, Math.max(rb, r0 + 1));
      gr.addColorStop(0, withAlpha(col, 0.35)); gr.addColorStop(1, withAlpha(col, 0.92));
      c.fillStyle = gr; petalPath(c, cx, cy, ra, rb, a); c.fill();
      c.strokeStyle = 'rgba(7,13,11,.55)'; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, rb, a - HALF, a + HALF); c.stroke();
    });
    // petal rim
    const rt = rr(d.total[i]);
    c.save();
    if (isLim) { c.shadowColor = '#ff6b5e'; c.shadowBlur = 16; }
    c.strokeStyle = isLim ? '#ff7a6e' : (i === hoverPetal ? '#ffffff' : 'rgba(230,238,233,.55)');
    c.lineWidth = isLim ? 3 : (i === hoverPetal ? 2 : 1.2);
    petalPath(c, cx, cy, r0, rt, a); c.stroke(); c.restore();
    if (d.total[i] > 200) { // overflow tick
      c.fillStyle = 'rgba(230,238,233,.8)'; const tx = cx + (rr(200) + 6) * Math.cos(a), ty = cy + (rr(200) + 6) * Math.sin(a);
      c.beginPath(); c.arc(tx, ty, 3, 0, 7); c.fill();
    }
    // labels
    const lr = Rmax + 22;
    const lx = cx + lr * Math.cos(a), ly = cy + lr * Math.sin(a);
    c.textAlign = Math.abs(Math.cos(a)) < 0.25 ? 'center' : (Math.cos(a) > 0 ? 'left' : 'right');
    c.textBaseline = 'middle';
    c.font = `700 ${isLim ? 14 : 12.5}px Inter, sans-serif`;
    c.fillStyle = isLim ? '#ff8b80' : '#e6eee9';
    c.fillText(IAA[i], lx, ly - 8);
    c.font = '500 11px "JetBrains Mono", monospace';
    c.fillStyle = d.total[i] < 75 ? '#ff9d93' : d.total[i] < 100 ? '#f2c86b' : '#9be7b6';
    c.fillText(Math.round(d.total[i]) + ' %', lx, ly + 7);
  }
  ringLabels();
  // centre disc
  const cl = d.claim;
  const ccol = cl.cls === 'ok' ? '#6fd39a' : cl.cls === 'warn' ? '#f2b94b' : '#ff7a6e';
  const cg = c.createRadialGradient(cx - r0 * 0.3, cy - r0 * 0.3, r0 * 0.1, cx, cy, r0);
  cg.addColorStop(0, '#20342b'); cg.addColorStop(1, '#0a1310');
  c.fillStyle = cg; c.beginPath(); c.arc(cx, cy, r0 * 0.93, 0, 7); c.fill();
  c.strokeStyle = ccol; c.lineWidth = 2.5; c.beginPath(); c.arc(cx, cy, r0 * 0.93, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, d.diaas / 100)); c.stroke();
  c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `750 ${Math.max(16, r0 * 0.56)}px Inter, sans-serif`; c.fillText(Math.round(d.diaas), cx, cy - r0 * 0.1);
  c.font = `600 ${Math.max(9, r0 * 0.17)}px Inter, sans-serif`; c.fillStyle = ccol; c.fillText('DIAAS %', cx, cy + r0 * 0.42);
  // limiting callout
  if (d.total[d.lim] < 100.5) {
    const a = angOf(d.lim), rt = rr(d.total[d.lim]);
    const px = cx + rt * Math.cos(a), py = cy + rt * Math.sin(a);
    c.fillStyle = '#ff7a6e'; c.beginPath(); c.arc(px, py, 4, 0, 7); c.fill();
  }
  // right-hand panel (composition)
  if (!g.narrow) drawPanel(c, d);
  else drawCompact(c, d);
}
function drawPanel(c, d) {
  const x0 = W * 0.705, x1 = W - 18; let y = Math.max(64, H * 0.16);
  const bw = x1 - x0;
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.font = '700 10.5px "JetBrains Mono", monospace'; c.fillStyle = 'rgba(200,230,215,.6)';
  c.fillText('BLEND · MASS / PROTEIN SHARE', x0, y); y += 12;
  // two stacked bars: mass and protein
  [['by mass', d.mass], ['by protein', d.prot]].forEach(([lab, arr]) => {
    let xx = x0 + 70; const h = 12, bw2 = bw - 70;
    c.fillStyle = 'rgba(230,238,233,.7)'; c.font = '500 10px "JetBrains Mono", monospace'; c.fillText(lab, x0, y + 10);
    arr.forEach((v, s) => { const w = bw2 * v; c.fillStyle = SLOT_STAGE[d.slots[s]]; roundRect(c, xx, y, Math.max(0, w - 2), h, 3); c.fill(); xx += w; });
    y += h + 8;
  });
  y += 16;
  d.names.forEach((n, s) => {
    c.fillStyle = SLOT_STAGE[d.slots[s]]; c.beginPath(); c.arc(x0 + 5, y - 4, 5, 0, 7); c.fill();
    c.fillStyle = '#e6eee9'; c.font = '600 12px Inter, sans-serif';
    let name = n; while (c.measureText(name).width > bw - 18 && name.length > 4) name = name.slice(0, -2);
    if (name !== n) name += '…';
    c.fillText(name, x0 + 16, y);
    c.fillStyle = 'rgba(200,230,215,.7)'; c.font = '500 10.5px "JetBrains Mono", monospace';
    c.fillText(`${Math.round(d.mass[s] * 100)} % mass · ${Math.round(d.prot[s] * 100)} % protein`, x0 + 16, y + 14);
    y += 34;
  });
  y += 4;
  c.fillStyle = 'rgba(200,230,215,.6)'; c.font = '700 10.5px "JetBrains Mono", monospace'; c.fillText('BLEND', x0, y); y += 16;
  c.fillStyle = '#e6eee9'; c.font = '500 11.5px Inter, sans-serif';
  c.fillText(`${fmt(d.x * 100, 1)} g protein per 100 g`, x0, y); y += 16;
  c.fillText(`ileal digestibility of IAA ${Math.round(d.dmean * 100)} %`, x0, y); y += 16;
  c.fillText(`pattern: ${d.pat}`, x0, y); y += 22;
  // legend for the outline
  c.save(); c.setLineDash([3, 4]); c.strokeStyle = 'rgba(230,238,233,.6)'; c.lineWidth = 1.2; c.strokeRect(x0, y - 9, 16, 10); c.restore();
  c.fillStyle = 'rgba(230,238,233,.75)'; c.font = '500 10.5px Inter, sans-serif'; c.fillText('undigested content', x0 + 22, y); y += 16;
  c.strokeStyle = 'rgba(155,231,182,.9)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(x0, y - 4); c.lineTo(x0 + 16, y - 4); c.stroke();
  c.fillText('100 % = requirement met', x0 + 22, y); y += 16;
  c.strokeStyle = 'rgba(242,185,75,.7)'; c.setLineDash([4, 5]); c.beginPath(); c.moveTo(x0, y - 4); c.lineTo(x0 + 16, y - 4); c.stroke(); c.setLineDash([]);
  c.fillText('75 % claim threshold', x0 + 22, y); y += 22;
  const ccol = d.claim.cls === 'ok' ? '#6fd39a' : d.claim.cls === 'warn' ? '#f2b94b' : '#ff7a6e';
  c.font = '700 12px Inter, sans-serif'; const t = d.claim.short; const tw = c.measureText(t).width;
  c.fillStyle = withAlpha(ccol, 0.18); roundRect(c, x0, y - 13, tw + 16, 20, 6); c.fill();
  c.strokeStyle = ccol; c.lineWidth = 1; roundRect(c, x0, y - 13, tw + 16, 20, 6); c.stroke();
  c.fillStyle = ccol; c.fillText(t, x0 + 8, y + 1);
}
function drawCompact(c, d) {
  const y = H - 14; let x = 14;
  c.font = '600 11px Inter, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  d.names.forEach((n, s) => {
    c.fillStyle = SLOT_STAGE[d.slots[s]]; c.fillRect(x, y - 9, 9, 9); x += 13;
    const t = `${n.split(' (')[0]} ${Math.round(d.mass[s] * 100)} %`; c.fillStyle = '#e6eee9'; c.fillText(t, x, y); x += c.measureText(t).width + 12;
  });
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
// hover tooltip
cv.addEventListener('pointermove', e => {
  if (!disp || disp.empty) return;
  const rct = cv.getBoundingClientRect(); const x = e.clientX - rct.left, y = e.clientY - rct.top;
  const g = geom(); const dx = x - g.cx, dy = y - g.cy; const r = Math.hypot(dx, dy);
  let a = Math.atan2(dy, dx) + Math.PI / 2; if (a < 0) a += 2 * Math.PI;
  const i = Math.round(a / SPAN) % NP;
  const inside = r > g.r0 && r < g.Rmax + 34;
  const hp = inside ? i : -1;
  if (hp !== hoverPetal) { hoverPetal = hp; draw(); }
  if (hp < 0 || !lastModel) { tip.style.display = 'none'; return; }
  const m = lastModel, R = PATTERNS[m.p.pat].r;
  const rows = m.b.items.map((it, k) => `<div><i style="background:${SLOT_STAGE[it.slot]}"></i>${it.src.label}: ${fmt(m.b.contrib[k][hp], 1)} mg g⁻¹</div>`).join('');
  tip.innerHTML = `<b>${IAA_LONG[hp]}</b><div>digestible ${fmt(m.b.dig[hp], 1)} mg g⁻¹ protein (total ${fmt(m.b.c[hp], 1)})</div><div>reference ${R[hp]} mg g⁻¹ → <b>${fmt(100 * m.s.ratios[hp], 0)} %</b></div>${rows}`;
  tip.style.display = 'block';
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = Math.min(W - tw - 8, x + 14) + 'px'; tip.style.top = Math.min(H - th - 8, Math.max(8, y - th / 2)) + 'px';
});
cv.addEventListener('pointerleave', () => { tip.style.display = 'none'; if (hoverPetal !== -1) { hoverPetal = -1; draw(); } });

/* ================================================================ charts */
const stackChart = new BarChart('#chart-stack', { y: { label: 'Share of reference', unit: '%', min: 0 }, stacked: true, height: 280 });
const compPlot = new Plot('#chart-comp', { x: { label: 'Share of protein from ingredient 2', unit: '%', min: 0, max: 100 }, y: { label: 'Digestible AA / reference', unit: '%', min: 0 }, height: 280 });
const needChart = new BarChart('#chart-need', { horizontal: true, y: { label: 'Mass to eat per day to meet the protein need', unit: 'g d⁻¹', min: 0 }, height: 430, legend: false });

/* ---- ternary landscape (custom canvas) ---- */
const ternEl = $('#chart-tern');
const tcv = document.createElement('canvas'); tcv.style.width = '100%'; tcv.style.height = '100%'; tcv.style.display = 'block'; tcv.style.cursor = 'crosshair';
ternEl.appendChild(tcv);
const ttip = document.createElement('div'); ttip.className = 'plot-tip'; ternEl.style.position = 'relative'; ternEl.appendChild(ttip);
const tctx = tcv.getContext('2d');
let ternCache = { key: '', cells: null, best: null }, ternGeom = null;
new ResizeObserver(() => drawTern()).observe(ternEl);
document.addEventListener('ffp:theme', () => { drawTern(); needAll(); });
/** The three corners of the landscape: ingredients 1–3, or — with only two selected — the two plus the database
    ingredient that gives the highest DIAAS as a third component (a suggestion, drawn with a dashed label). */
function ternSel(p) {
  const act = activeSlots(p);
  if (act.length >= 3) return act.slice(0, 3).map(a => ({ slot: a.slot, src: a.src, m: a.m }));
  if (act.length < 2) return null;
  const r = PATTERNS[p.pat].r; let best = null;
  const inPool = s => p.scope === 'all' ? true : p.scope === 'nonanimal' ? (s.plant || s.nonAnimal) : s.plant;   // same pool as the optimiser
  SOURCES.forEach(s => {
    if (act.some(a => a.src === s) || !inPool(s)) return;
    let bd = -1;
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10 - i; j++) {
      const k = 10 - i - j; if (k === 0) continue;
      const b = blendOf([{ src: act[0].src, m: i }, { src: act[1].src, m: j }, { src: s, m: k }]); if (!b) continue;
      const d = scoreOf(b, r).diaas; if (d > bd) bd = d;
    }
    if (!best || bd > best.d) best = { s, d: bd };
  });
  const free = [0, 1, 2, 3].find(k => !act.some(a => a.slot === k));
  return [act[0], act[1], { slot: free, src: best.s, m: 0, suggested: true }];
}
function ternData(p) {
  const it = ternSel(p);
  if (!it) return null;
  const key = it.map(a => a.src.id).join('|') + '|' + p.pat;
  if (ternCache.key === key) return ternCache;
  const N = 40, r = PATTERNS[p.pat].r, cells = [];
  let best = null;
  const evalAt = (f) => {
    const b = blendOf(it.map((a, k) => ({ src: a.src, m: f[k] })));
    if (!b) return { d: NaN };
    const s = scoreOf(b, r);
    return { d: s.diaas, lim: s.lim };
  };
  const vals = {};
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N - i; j++) {
    const f = [i / N, j / N, (N - i - j) / N]; const v = evalAt(f); vals[i + ',' + j] = v;
    if (!best || v.d > best.d) best = { d: v.d, f };
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < N - i; j++) {
    cells.push([[i, j], [i + 1, j], [i, j + 1]]);
    if (i + j < N - 1) cells.push([[i + 1, j], [i + 1, j + 1], [i, j + 1]]);
  }
  ternCache = { key, N, vals, cells, best, it: it.map(a => a.src), sel: it };
  return ternCache;
}
function drawTern() {
  const w = ternEl.clientWidth, h = ternEl.clientHeight; if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  tcv.width = Math.round(w * dpr); tcv.height = Math.round(h * dpr);
  const c = tctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  const P = palette();
  const p = ui.values();
  const T = ternData(p);
  if (!T) {
    c.fillStyle = P.muted; c.font = '500 13px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('Select at least two ingredients to see the DIAAS landscape of their blends.', w / 2, h / 2 - 10);
    c.fillText('With two, the best third ingredient from the database is suggested.', w / 2, h / 2 + 12);
    ternGeom = null; return;
  }
  const side = Math.min(w - 130, (h - 66) / 0.866);
  const A = [w / 2 - 50, 18], B = [A[0] - side / 2, 18 + side * 0.866], Cc = [A[0] + side / 2, 18 + side * 0.866];
  // barycentric → xy: f = [f1 (A), f2 (B), f3 (C)]
  const xy = (i, j) => { const N = T.N; const f1 = i / N, f2 = j / N, f3 = 1 - f1 - f2; return [f1 * A[0] + f2 * B[0] + f3 * Cc[0], f1 * A[1] + f2 * B[1] + f3 * Cc[1]]; };
  ternGeom = { A, B, C: Cc, T };
  const dmin = 30, dmax = 130;
  const col = d => { const t = (d - dmin) / (dmax - dmin); const q = colormap('rdylgn', t); return `rgb(${q[0] | 0},${q[1] | 0},${q[2] | 0})`; };
  T.cells.forEach(cell => {
    const vs = cell.map(([i, j]) => T.vals[i + ',' + j].d); const dv = (vs[0] + vs[1] + vs[2]) / 3;
    c.fillStyle = col(dv); c.beginPath();
    cell.forEach(([i, j], k) => { const [x, y] = xy(i, j); k ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.closePath(); c.fill(); c.strokeStyle = col(dv); c.lineWidth = 0.6; c.stroke();
  });
  // iso-lines 75 and 100 (marching triangles)
  [[75, '#7a4a00'], [100, '#0b3d20']].forEach(([lev, lc]) => {
    c.strokeStyle = lc; c.lineWidth = 1.6; c.setLineDash(lev === 75 ? [4, 3] : []);
    T.cells.forEach(cell => {
      const pts = cell.map(([i, j]) => ({ p: xy(i, j), v: T.vals[i + ',' + j].d }));
      const seg = [];
      for (let e = 0; e < 3; e++) { const a = pts[e], b = pts[(e + 1) % 3]; if ((a.v - lev) * (b.v - lev) < 0) { const t = (lev - a.v) / (b.v - a.v); seg.push([a.p[0] + t * (b.p[0] - a.p[0]), a.p[1] + t * (b.p[1] - a.p[1])]); } }
      if (seg.length === 2) { c.beginPath(); c.moveTo(seg[0][0], seg[0][1]); c.lineTo(seg[1][0], seg[1][1]); c.stroke(); }
    });
  });
  c.setLineDash([]);
  // frame
  c.strokeStyle = P.lineStrong || P.muted; c.lineWidth = 1.2; c.beginPath(); c.moveTo(...A); c.lineTo(...B); c.lineTo(...Cc); c.closePath(); c.stroke();
  // vertex labels
  c.font = '600 12px Inter, sans-serif'; c.textBaseline = 'middle';
  const lab = (a, pt, align, dy) => {
    c.fillStyle = slotColor(a.slot); c.textAlign = align;
    c.font = a.suggested ? 'italic 600 12px Inter, sans-serif' : '600 12px Inter, sans-serif';
    c.fillText((a.suggested ? '+ suggested: ' : '● ') + a.src.label.split(' (')[0], pt[0], pt[1] + dy);
  };
  lab(T.sel[0], A, 'center', -9); lab(T.sel[1], [B[0] - 8, B[1]], 'left', 14); lab(T.sel[2], [Cc[0] + 8, Cc[1]], 'right', 31);
  // best point & current point
  const fxy = f => [f[0] * A[0] + f[1] * B[0] + f[2] * Cc[0], f[0] * A[1] + f[1] * B[1] + f[2] * Cc[1]];
  const bp = fxy(T.best.f);
  c.fillStyle = '#fff'; c.strokeStyle = '#111'; c.lineWidth = 1.2;
  star(c, bp[0], bp[1], 8); c.fill(); c.stroke();
  const cur = T.sel; const tot = cur.reduce((a, s) => a + (s.suggested ? 0 : (p['m' + (s.slot + 1)] || 0)), 0);
  if (tot > 0) { const f = cur.map(s => (s.suggested ? 0 : (p['m' + (s.slot + 1)] || 0)) / tot); const cp = fxy(f); c.lineWidth = 2.5; c.strokeStyle = '#fff'; c.beginPath(); c.arc(cp[0], cp[1], 6, 0, 7); c.stroke(); c.lineWidth = 1.2; c.strokeStyle = '#111'; c.beginPath(); c.arc(cp[0], cp[1], 8.5, 0, 7); c.stroke(); }
  // colour bar
  const bx = w - 60, by = 24, bh = h - 70;
  for (let k = 0; k < bh; k++) { const d = dmax - (dmax - dmin) * k / bh; c.fillStyle = col(d); c.fillRect(bx, by + k, 14, 1.2); }
  c.strokeStyle = P.line; c.strokeRect(bx, by, 14, bh);
  c.fillStyle = P.muted; c.font = '500 10.5px "JetBrains Mono", monospace'; c.textAlign = 'left';
  [30, 50, 75, 100, 130].forEach(v => { const yy = by + (dmax - v) / (dmax - dmin) * bh; c.fillText(String(v), bx + 18, yy); c.fillRect(bx + 14, yy, 3, 1); });
  c.save(); c.translate(bx - 8, by + bh / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.fillText('DIAAS (%)', 0, 0); c.restore();
  c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = P.ink2 || P.ink; c.font = '600 11.5px Inter, sans-serif';
  c.fillText(`★ best: DIAAS ${Math.round(T.best.d)} %`, 6, 4);
  c.fillStyle = P.muted; c.font = '500 11px Inter, sans-serif';
  T.sel.forEach((a, k) => c.fillText(`${a.src.label.split(' (')[0]} ${Math.round(T.best.f[k] * 100)} %`, 6, 22 + 15 * k));
}
function star(c, x, y, r) { c.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r; c.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); } c.closePath(); }
function ternPick(e) {
  if (!ternGeom) return null;
  const rct = tcv.getBoundingClientRect(); const x = e.clientX - rct.left, y = e.clientY - rct.top;
  const { A, B, C } = ternGeom;
  const det = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
  const f1 = ((B[1] - C[1]) * (x - C[0]) + (C[0] - B[0]) * (y - C[1])) / det;
  const f2 = ((C[1] - A[1]) * (x - C[0]) + (A[0] - C[0]) * (y - C[1])) / det;
  const f3 = 1 - f1 - f2;
  if (f1 < -0.01 || f2 < -0.01 || f3 < -0.01) return null;
  return [f1, f2, f3].map(v => Math.max(0, v));
}
tcv.addEventListener('pointermove', e => {
  const f = ternPick(e); if (!f) { ttip.style.display = 'none'; return; }
  const p = ui.values(); const it = ternGeom.T.sel;
  const b = blendOf(it.map((a, k) => ({ src: a.src, m: f[k] }))); if (!b) return;
  const s = scoreOf(b, PATTERNS[p.pat].r);
  ttip.innerHTML = `${it.map((a, k) => `${a.src.label.split(' (')[0]} ${Math.round(f[k] * 100)} %`).join('<br>')}<br><b>DIAAS ${fmt(s.diaas, 0)} %</b> (${IAA[s.lim]})`;
  ttip.style.display = 'block';
  const rct = tcv.getBoundingClientRect(); const x = e.clientX - rct.left, y = e.clientY - rct.top;
  ttip.style.left = Math.min(ternEl.clientWidth - ttip.offsetWidth - 4, x + 14) + 'px'; ttip.style.top = Math.max(4, y - 30) + 'px';
});
tcv.addEventListener('pointerleave', () => { ttip.style.display = 'none'; });
tcv.addEventListener('click', e => {
  const f = ternPick(e); if (!f || !ternGeom) return;
  const it = ternGeom.T.sel;
  const vals = {}; let acc = 0;
  it.forEach((a, k) => { const v = k === 2 ? 100 - acc : Math.round(f[k] * 100); vals['m' + (a.slot + 1)] = v; acc += v; if (a.suggested && v > 0) vals['s' + (a.slot + 1)] = a.src.id; });
  [1, 2, 3, 4].forEach(k => { if (!it.some(a => a.slot === k - 1)) vals['m' + k] = 0; });
  rebalancing = true; ui.setMany(vals); rebalancing = false;
  [1, 2, 3, 4].forEach(k => ui.enable('m' + k, ui.get('s' + k) !== 'none'));
  schedule();
});
function activeSlots(p) { return [1, 2, 3, 4].map(k => ({ slot: k - 1, id: p['s' + k], m: p['m' + k] })).filter(a => a.id !== 'none' && BY_ID[a.id]).map(a => ({ slot: a.slot, src: BY_ID[a.id], m: a.m })); }

/* ================================================================ optimiser */
let optResults = [];
function optimise(p) {
  const r = PATTERNS[p.pat].r, bw = p.bw, preq = p.preq;
  let pool;
  if (p.scope === 'selected') pool = activeSlots(p).map(a => a.src).filter((s, i, arr) => arr.indexOf(s) === i);
  else pool = SOURCES.filter(s => p.scope === 'all' ? true : p.scope === 'plant' ? s.plant : (s.plant || s.nonAnimal));
  const A = pool.map(s => s.dig.map((v, i) => v / r[i]));
  const X = pool.map(s => s.x);
  const results = [];
  const better = (a, b) => !b || (p.obj === 'grams' ? (a.g < b.g - 1e-9 || (Math.abs(a.g - b.g) < 1e-9 && a.d > b.d)) : (a.d > b.d + 1e-9 || (Math.abs(a.d - b.d) < 1e-9 && a.g < b.g)));
  const evalMix = (idx, ms) => {
    let Pm = 0; for (let k = 0; k < idx.length; k++) Pm += ms[k] * X[idx[k]];
    let mn = Infinity, li = 0;
    for (let i = 0; i < 9; i++) { let v = 0; for (let k = 0; k < idx.length; k++) v += ms[k] * X[idx[k]] * A[idx[k]][i]; v /= Pm; if (v < mn) { mn = v; li = i; } }
    const need = bw * preq / Math.min(1, mn);
    return { d: 100 * mn, lim: li, g: need / (Pm / 100), ms: ms.slice(), idx: idx.slice() };
  };
  const combos = [];
  const n = p.scope === 'selected' ? Math.min(4, pool.length) : +p.ncomp;
  const rec = (start, cur) => { if (cur.length === n) { combos.push(cur.slice()); return; } for (let i = start; i < pool.length; i++) { cur.push(i); rec(i + 1, cur); cur.pop(); } };
  if (n >= 1) rec(0, []);
  const minShare = p.scope === 'selected' ? 0 : 5;
  const step = n === 2 ? 1 : n === 3 ? 2.5 : 5;
  combos.forEach(idx => {
    let best = null;
    if (n === 1) best = evalMix(idx, [100]);
    else if (n === 2) { for (let a = minShare; a <= 100 - minShare; a += step) { const e = evalMix(idx, [a, 100 - a]); if (better(e, best)) best = e; } }
    else if (n === 3) { for (let a = minShare; a <= 100 - 2 * minShare; a += step) for (let b = minShare; b <= 100 - a - minShare; b += step) { const e = evalMix(idx, [a, b, 100 - a - b]); if (better(e, best)) best = e; } }
    else { for (let a = 0; a <= 100; a += step) for (let b = 0; b <= 100 - a; b += step) for (let c = 0; c <= 100 - a - b; c += step) { const e = evalMix(idx, [a, b, c, 100 - a - b - c]); if (better(e, best)) best = e; } }
    if (best) results.push(best);
  });
  results.sort((x, y) => better(x, y) ? -1 : better(y, x) ? 1 : 0);
  optResults = results.slice(0, 8).map(e => ({ ...e, srcs: e.idx.map(i => pool[i]) }));
  renderOpt(p);
}
function renderOpt(p) {
  const el = $('#opt-table'); if (!el) return;
  if (!optResults.length) { el.innerHTML = '<p class="muted">Select at least one ingredient to optimise.</p>'; return; }
  const rows = optResults.map((e, k) => {
    const Pm = e.srcs.reduce((a, s, i) => a + e.ms[i] * s.x, 0);
    const blendTxt = e.srcs.map((s, i) => `${s.label.split(' (')[0]} <b>${Math.round(e.ms[i])} %</b> <span class="muted">(${Math.round(100 * e.ms[i] * s.x / Pm)} % prot.)</span>`).join(' + ');
    const cls = e.d >= 100 ? 'ok' : e.d >= 75 ? 'warn' : 'bad';
    return `<tr data-k="${k}"><td class="num">${k + 1}</td><td>${blendTxt}</td><td class="num pq-${cls}">${Math.round(e.d)}</td><td>${IAA[e.lim]}</td><td class="num">${Math.round(e.g)}</td><td><button class="btn btn-sm" data-apply="${k}" type="button">Apply</button></td></tr>`;
  }).join('');
  el.innerHTML = `<table class="pq-opt"><thead><tr><th class="num">#</th><th>Blend (mass %; protein share)</th><th class="num">DIAAS</th><th>Limiting</th><th class="num">g d⁻¹</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  el.querySelectorAll('[data-apply]').forEach(b => b.addEventListener('click', () => applyOpt(+b.dataset.apply)));
}
function applyOpt(k) {
  const e = optResults[k]; if (!e) return;
  const vals = { s1: 'none', s2: 'none', s3: 'none', s4: 'none', m1: 0, m2: 0, m3: 0, m4: 0 };
  let acc = 0;
  e.srcs.forEach((s, i) => { const v = i === e.srcs.length - 1 ? 100 - acc : Math.round(e.ms[i]); vals['s' + (i + 1)] = s.id; vals['m' + (i + 1)] = v; acc += v; });
  rebalancing = true; ui.setMany(vals); rebalancing = false;
  [1, 2, 3, 4].forEach(k2 => ui.enable('m' + k2, vals['s' + k2] !== 'none'));
  schedule();
  window.FFP && FFP.toast && FFP.toast(`Applied: DIAAS ${Math.round(e.d)} %`);
}

/* ================================================================ update */
let lastModel = null;
function update() {
  const p = ui.values();
  const items = activeItems(p);
  const R = PATTERNS[p.pat].r;
  const b = items.length ? blendOf(items) : null;
  if (!b) {
    target = { empty: true, stack: [], total: Array(9).fill(0), undig: Array(9).fill(0), diaas: 0, lim: 0, slots: [], names: [], mass: [], prot: [], pat: PATTERNS[p.pat].short, x: 0, dmean: 0, claim: claimOf(0), outline: p.outline, stackOn: p.stack };
    disp = null; kick();
    ['diaas', 'pdcaas', 'aas', 'prot', 'dig', 'need', 'grams'].forEach(id => ro.set(id, NaN, null, ''));
    ro.set('lim', '—', null, '');
    return;
  }
  const s = scoreOf(b, R);
  const cl = claimOf(s.diaas);
  const nd = needOf(s.diaas, b.x, p.bw, p.preq);
  lastModel = { p, b, s };
  // readouts
  ro.set('diaas', s.diaas, cl.cls, cl.text);
  ro.set('lim', s.diaas >= 100 ? `none (lowest: ${IAA[s.lim]})` : `${IAA[s.lim]} (${Math.round(100 * s.ratios[s.lim])} %)`, s.diaas >= 100 ? 'ok' : s.diaas >= 75 ? 'warn' : 'bad', `second: ${IAA[s.second]} ${Math.round(100 * s.ratios[s.second])} %`);
  ro.set('pdcaas', s.pdcaas, s.pdcaas >= 1 ? 'ok' : s.pdcaas >= 0.75 ? 'warn' : 'bad', `untruncated ${fmt(s.pdcaasRaw, 2)} · limiting ${IAA[s.aasLim]} · TD<sub>f</sub> ${fmt(b.tdf * 100, 0)} %`);
  ro.set('aas', s.aas, null, `${IAA[s.aasLim]} limiting before digestion`);
  ro.set('prot', b.x * 100, null, b.items.map((it, k) => `${Math.round(b.w[k] * 100)} %`).join(' · ') + ' of protein');
  const dmean = b.dig.reduce((a, v) => a + v, 0) / b.c.reduce((a, v) => a + v, 0);
  ro.set('dig', dmean * 100, dmean >= 0.9 ? 'ok' : dmean >= 0.8 ? 'warn' : 'bad', 'digestible ÷ total IAA');
  ro.set('need', nd.need, null, `${p.bw} kg × ${fmt(p.preq, 2)} g kg⁻¹ d⁻¹ ÷ ${fmt(Math.min(1, s.diaas / 100), 2)}`);
  ro.set('grams', nd.grams, nd.grams < 400 ? 'ok' : nd.grams < 900 ? 'warn' : 'bad', `≈ ${fmt(nd.grams / 1000 * 7, 1)} kg per week`);
  hud.set('a', `DIAAS <b>${Math.round(s.diaas)}</b> % · ${PATTERNS[p.pat].short}`);
  hud.set('b', s.diaas >= 100 ? 'No amino acid below the reference' : `Limiting: <b>${IAA_LONG[s.lim]}</b>`);
  // stage target
  const stack = b.contrib.map(row => row.map((v, i) => 100 * v / R[i]));
  target = {
    empty: false, stack, total: s.ratios.map(v => 100 * v), undig: b.c.map((v, i) => 100 * v / R[i]), diaas: s.diaas, lim: s.lim,
    slots: b.items.map(it => it.slot), names: b.items.map(it => it.src.label), mass: b.massShare, prot: b.w, pat: PATTERNS[p.pat].short, x: b.x, dmean,
    claim: cl, outline: p.outline, stackOn: p.stack
  };
  kick();
  // stacked bars: contributions + digestion losses
  const series = b.items.map((it, k) => ({ label: it.src.label.split(' (')[0], values: b.contrib[k].map((v, i) => +(100 * v / R[i]).toFixed(1)), color: slotColor(it.slot) }));
  series.push({ label: 'lost in digestion', values: b.c.map((v, i) => +(100 * (v - b.dig[i]) / R[i]).toFixed(1)), color: 'rgba(140,150,145,.45)' });
  stackChart.set(IAA, series);
  stackChart.refLine(100, '100 % of reference', 'ink');
  // complementation curve (slots of ingredients 1 and 2)
  drawComp(p);
  drawTern();
  needAll(p, b, s, nd);
  scheduleOpt();
}
function drawComp(p) {
  const act = activeSlots(p);
  const A = act[0], B = act[1];
  const R = PATTERNS[p.pat].r;
  ['env', 'now', 'l0', 'l1', 'ref100', 'ref75', ...IAA].forEach(id => compPlot.remove(id));
  if (!A || !B) { compPlot.setAxis('x', { label: 'Share of protein from ingredient 2' }); compPlot.text('msg', 50, 50, 'Select two ingredients to see how they complement each other', { align: 'center', color: 'muted' }); return; }
  compPlot.remove('msg');
  const xs = linspace(0, 100, 101);
  const curves = IAA.map((_, i) => xs.map(t => 100 * ((1 - t / 100) * A.src.dig[i] + t / 100 * B.src.dig[i]) / R[i]));
  const env = xs.map((_, k) => Math.min(...curves.map(cu => cu[k])));
  // which AAs define the envelope?
  const used = new Set(); xs.forEach((_, k) => { let mi = 0; curves.forEach((cu, i) => { if (cu[k] < curves[mi][k]) mi = i; }); used.add(mi); });
  IAA.forEach((n, i) => compPlot.line(n, xs, curves[i], { color: AA_COL[i], width: used.has(i) ? 2.2 : 1, opacity: used.has(i) ? 0.95 : 0.35, label: used.has(i) ? n : undefined, dash: used.has(i) ? undefined : [3, 3] }));
  compPlot.line('env', xs, env, { color: 'ink', width: 3.2, label: 'DIAAS (lowest ratio)' });
  compPlot.hline('ref100', 100, { color: 'accent', label: '100 %' });
  compPlot.hline('ref75', 75, { color: 'amber', label: '75 %', dash: [3, 4] });
  const onlyTwo = act.length === 2;
  const tot = A.m * A.src.x + B.m * B.src.x;
  if (tot > 0) {
    const t = 100 * B.m * B.src.x / tot;
    const k = Math.round(t);
    compPlot.point('now', t, env[Math.min(100, Math.max(0, k))], { color: 'magenta', r: 6, label: onlyTwo ? 'your blend' : 'ingr. 1 + 2 only', guides: true });
  }
  compPlot.setAxis('x', { label: `Share of protein from ${B.src.label.split(' (')[0]} (rest: ${A.src.label.split(' (')[0]})`, min: 0, max: 100 });
  compPlot.setAxis('y', { min: 0, max: Math.min(260, Math.max(130, Math.ceil(Math.max(...env) / 20) * 20 + 20)) });
}
function needAll(p, b, s, nd) {
  p = p || ui.values();
  if (!b) { const it = activeItems(p); b = it.length ? blendOf(it) : null; if (!b) return; s = scoreOf(b, PATTERNS[p.pat].r); nd = needOf(s.diaas, b.x, p.bw, p.preq); }
  const R = PATTERNS[p.pat].r;
  const rows = SOURCES.map(src => { const bb = blendOf([{ src, m: 1 }]); const ss = scoreOf(bb, R); return { label: src.label, g: needOf(ss.diaas, src.x, p.bw, p.preq).grams, col: GROUP_COL[src.group], d: ss.diaas }; });
  rows.push({ label: '▶ Your blend', g: nd.grams, col: palette().magenta, d: s.diaas, blend: true });
  rows.sort((a, c) => a.g - c.g);
  needChart.set(rows.map(r => r.label), [{ label: 'g per day', values: rows.map(r => Math.round(r.g)), colors: rows.map(r => r.col) }]);
}
let optT = 0;
function scheduleOpt() { clearTimeout(optT); optT = setTimeout(() => optimise(ui.values()), 120); }
let raf2 = 0;
function schedule() { cancelAnimationFrame(raf2); raf2 = requestAnimationFrame(update); }
ui.onChange((state, id) => {
  if (/^m\d$/.test(id || '')) rebalance(+id.slice(1));
  else if (/^s\d$/.test(id || '')) {
    const k = +id.slice(1);
    if (state[id] !== 'none' && !(state['m' + k] > 0)) { rebalancing = true; ui.set('m' + k, Math.round(100 / (activeSlots(state).length || 1)), true); rebalancing = false; rebalance(k); }
    else rebalance(null);
  } else if (!id) rebalance(null);
  schedule();
});
rebalance(null);
update();

/* ================================================================ database table (Sources tab) + CSV */
function buildDB() {
  const el = $('#db-table'); if (!el) return;
  const hdr = `<tr><th>#</th><th>Ingredient</th><th class="num">Protein<br>g/100 g</th>${IAA.map(n => `<th class="num">${n}</th>`).join('')}<th class="num">Ileal<br>dig. %</th><th class="num">TD<sub>f</sub><br>%</th><th class="num">DIAAS<br>child</th><th class="num">DIAAS<br>older</th></tr>`;
  const body = SOURCES.map((s, k) => {
    const b = blendOf([{ src: s, m: 1 }]);
    const sc = scoreOf(b, PATTERNS.child.r), so = scoreOf(b, PATTERNS.older.r);
    return `<tr><td class="num">${k + 1}</td><td class="pq-ing"><span class="pq-sw" style="background:${GROUP_COL[s.group]}"></span>${s.label}${s.inferred ? ' *' : ''}</td><td class="num">${fmt(s.cp, 1)}</td>${s.c.map(v => `<td class="num">${fmt(v, 1)}</td>`).join('')}<td class="num">${Math.round(s.dMean * 100)}</td><td class="num">${Math.round(s.tdf * 100)}</td><td class="num">${Math.round(sc.diaas)}${sc.diaas < 100 ? `<small>${IAA[sc.lim]}</small>` : ''}</td><td class="num">${Math.round(so.diaas)}${so.diaas < 100 ? `<small>${IAA[so.lim]}</small>` : ''}</td></tr>`;
  }).join('');
  const notes = SOURCES.map((s, k) => `<li><b>${s.label}</b> — ${s.form}; ${s.method}. Source: ${s.ref}. Faecal digestibility: ${s.tdfNote}${s.cpNote ? '; protein content: ' + s.cpNote : ''}. <span class="muted">Check: ${s.check}.</span></li>`).join('');
  el.innerHTML = `<table class="pq-db"><caption>Table 2. The laboratory database. Total indispensable amino-acid contents (mg per g protein, N × 6.25), mean ileal digestibility of the nine IAA, faecal crude-protein digestibility used for PDCAAS, and the DIAAS each ingredient receives alone against the FAO (2013) young-child and older-child/adult patterns, with the limiting amino acid. SAA = Met + Cys, AAA = Phe + Tyr. * composition back-calculated from published digestible amounts.</caption><thead>${hdr}</thead><tbody>${body}</tbody></table>
    <h3>Data notes, row by row</h3><ol class="pq-notes">${notes}</ol>`;
}
buildDB();
const csvBtn = $('#db-csv');
if (csvBtn) csvBtn.addEventListener('click', () => {
  downloadCSV('protein-quality-database.csv', ['id', 'ingredient', 'form', 'protein_g_per_100g', ...IAA.map(n => n + '_mg_per_g_protein'), ...IAA.map(n => n + '_digestible_mg_per_g'), 'faecal_digestibility', 'source', 'method'],
    SOURCES.map(s => [s.id, s.label, s.form, +s.cp.toFixed(2), ...s.c.map(v => +v.toFixed(2)), ...s.dig.map(v => +v.toFixed(2)), s.tdf, s.ref, s.method]));
});
document.addEventListener('ffp:tab', () => { setTimeout(() => { drawTern(); }, 30); });
