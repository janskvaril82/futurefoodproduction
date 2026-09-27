/* Multi-criteria decision studio — normalisation (min–max, target, vector), weighting (direct, swing, AHP with
   eigenvector and consistency ratio), aggregation (weighted sum, TOPSIS, weighted product) and robustness
   (Monte Carlo rank acceptability, one-at-a-time weight sensitivity). Eqs. M1–M10 (Derive tab), as in Lesson 15.4. */
import { Controls, Readouts, fmt, stageToolbar } from '/assets/js/ui.js';
import { Plot, BarChart, downloadCSV } from '/assets/js/plot.js';
import { withAlpha } from '/assets/js/colors.js';
import { mulberry32, randn, parseTable } from '/assets/js/stats.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CCOL = ['#7ee0a0', '#5cc8ef', '#f2b94b', '#ff8f6b', '#a792f0', '#f07ad0', '#c9cf6a', '#4fd1b5', '#e6a3ff', '#ffd35a'];
const ACOL = ['#ff7a59', '#f2b94b', '#7ee0a0', '#c9cf6a', '#a792f0', '#f07ad0', '#5cc8ef', '#4fd1b5', '#ffd35a', '#e6eee9'];
const RI = [0, 0, 0, 0.58, 0.90, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49]; // Saaty (1980) random index for n = 0…10
const SAATY = [9, 8, 7, 6, 5, 4, 3, 2, 1, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 6, 1 / 7, 1 / 8, 1 / 9];
const saatyLabel = v => v >= 1 ? String(Math.round(v)) : '1/' + Math.round(1 / v);
const snapSaaty = r => SAATY.reduce((b, v) => Math.abs(Math.log(v / r)) < Math.abs(Math.log(b / r)) ? v : b, 1);

/* ================================================================= data (cited defaults) */
// Quality codes: L peer-reviewed LCA · I industry-commissioned study · D derived by conversion · E estimate · J judgement on a constructed scale · T teaching value
const Q = { L: 'peer-reviewed LCA', I: 'industry-commissioned LCA', D: 'derived (unit conversion or relation)', E: 'estimate (no direct data)', J: 'judgement on a constructed scale', T: 'teaching value (Lesson 15.4)' };
const PRESET0 = {
  protein: {
    label: 'Protein sources', note: 'Performance per 100 g of protein (LCA criteria) or on constructed scales',
    crit: [
      { id: 'ghg', name: 'GHG emissions', short: 'GHG', unit: 'kg CO₂e', dir: 'min', target: 1 },
      { id: 'land', name: 'Land use', short: 'Land', unit: 'm²·yr', dir: 'min', target: 3 },
      { id: 'water', name: 'Freshwater use', short: 'Water', unit: 'L', dir: 'min', target: 100 },
      { id: 'cost', name: 'Consumer cost', short: 'Cost', unit: 'scale 1–5', dir: 'min', target: 2 },
      { id: 'nutr', name: 'Nutritional quality', short: 'Nutrition', unit: 'scale 1–5', dir: 'max', target: 4 },
      { id: 'acc', name: 'Consumer acceptance', short: 'Acceptance', unit: 'scale 1–5', dir: 'max', target: 4 },
      { id: 'welf', name: 'Animal welfare', short: 'Welfare', unit: 'scale 1–5', dir: 'max', target: 4 },
      { id: 'trl', name: 'Technology readiness', short: 'TRL', unit: 'TRL 1–9', dir: 'max', target: 8 },
      { id: 'res', name: 'Resilience', short: 'Resilience', unit: 'scale 1–5', dir: 'max', target: 4 }
    ],
    alt: [
      { id: 'beef', name: 'Beef (beef herd)', x: [49.89, 163.6, 728, 4, 5, 5, 2, 9, 3], q: 'LLLJJJJJJ' },
      { id: 'chick', name: 'Chicken', x: [5.70, 7.06, 381, 2, 5, 5, 1, 9, 2], q: 'LLLJJJJJJ' },
      { id: 'pea', name: 'Pea protein', x: [0.44, 3.36, 179, 2, 3, 4, 5, 9, 4], q: 'LLLJJJJJJ' },
      { id: 'myco', name: 'Mycoprotein', x: [0.48, 1.52, 28, 3, 4, 3, 5, 9, 3], q: 'IIIJJJJJJ' },
      { id: 'insect', name: 'Insect protein', x: [1.40, 1.80, 190, 5, 4, 1, 3, 8, 4], q: 'LLEJJJJJJ' },
      { id: 'cult', name: 'Cultivated meat', x: [1.86, 2.7, 450, 5, 4, 2, 4, 6, 2], q: 'DDEJJJJJJ' }
    ],
    direct: [50, 50, 50, 50, 50, 50, 50, 50, 50], swing: [50, 50, 50, 50, 50, 50, 50, 50, 50], ahp: null,
    stake: {
      Environmentalist: [25, 20, 15, 5, 5, 3, 15, 2, 10], Economist: [10, 4, 3, 30, 5, 15, 3, 20, 10],
      Consumer: [10, 2, 2, 25, 20, 25, 10, 4, 2], Farmer: [6, 10, 4, 20, 8, 15, 2, 15, 20]
    }
  },
  lettuce: {
    label: 'Lettuce systems', note: 'Table 1 of Lesson 15.4: 1 kg of lettuce delivered to a Stockholm retailer in January',
    crit: [
      { id: 'clim', name: 'Climate', short: 'Climate', unit: 'kg CO₂e kg⁻¹', dir: 'min', target: 0.5 },
      { id: 'land', name: 'Land', short: 'Land', unit: 'm²·yr kg⁻¹', dir: 'min', target: 0.05 },
      { id: 'water', name: 'Water', short: 'Water', unit: 'L kg⁻¹', dir: 'min', target: 20 },
      { id: 'cost', name: 'Cost', short: 'Cost', unit: 'US$ kg⁻¹', dir: 'min', target: 3 },
      { id: 'sec', name: 'Supply security', short: 'Security', unit: 'scale 1–5', dir: 'max', target: 4 }
    ],
    alt: [
      { id: 'A', name: 'A Field, Almería + truck', col: '#f2b94b', x: [0.62, 0.30, 250, 1.6, 2], q: 'TTTTJ' },
      { id: 'B', name: 'B Greenhouse, gas', col: '#ff7a59', x: [2.52, 0.030, 20, 3.2, 2], q: 'TTTTJ' },
      { id: 'C', name: 'C Greenhouse, heat pump', col: '#5cc8ef', x: [0.55, 0.030, 20, 3.0, 4], q: 'TTTTJ' },
      { id: 'D', name: 'D Vertical farm', col: '#f07ad0', x: [0.84, 0.0087, 2, 7.5, 3], q: 'TTTTJ' }
    ],
    direct: [100, 30, 40, 80, 50], swing: [100, 30, 40, 80, 50],
    // Lesson 15.4, Figure 3 default judgements (climate ≻ land 3, ≻ water 3, = cost, ≻ security 2; …)
    ahp: [[1, 3, 3, 1, 2], [1 / 3, 1, 1 / 2, 1 / 3, 1 / 2], [1 / 3, 2, 1, 1 / 2, 1], [1, 3, 2, 1, 2], [1 / 2, 2, 1, 1 / 2, 1]],
    stake: {
      Environmentalist: [40, 20, 25, 5, 10], Economist: [15, 5, 5, 60, 15], Consumer: [20, 5, 10, 50, 15], Farmer: [15, 15, 10, 30, 30]
    }
  }
};
const NOTES = {
  protein: {
    ghg: 'Beef, chicken and peas: global means of Poore & Nemecek (2018). Mycoprotein: 0.53 kg CO₂e per kg (Carbon Trust, 2023; cradle to processing gate), ÷ 0.11 kg protein per kg. Mealworm: 14 kg CO₂e per kg edible protein (Oonincx & de Boer, 2012). Cultivated meat: 4.0 kg CO₂e per kg with renewable energy at the facility (Sinke et al., 2023), ÷ 0.215 kg protein per kg (their 18–25 %).',
    land: 'Poore & Nemecek (2018); mycoprotein 0.000167 ha per kg (Carbon Trust, 2023); mealworm 18 m² per kg edible protein (Oonincx & de Boer, 2012); cultivated meat derived: about one third of the crop land of chicken (Sinke et al., 2023: “almost three times more efficient in turning crops into meat than chicken”) plus 15 % for renewable-energy land.',
    water: 'Freshwater withdrawals of Poore & Nemecek (2018) per 100 g protein; mycoprotein blue water 31 L per kg (Carbon Trust, 2023). Mealworm and cultivated meat: estimates only — Sinke et al. (2023) found cultivated meat’s blue water between that of chicken and of beef.',
    cost: 'Constructed scale (1 = cheapest, 5 = most expensive for consumers, 2026). Cultivated meat is not sold in the EU as of 2026; techno-economic studies put its cost well above conventional meat (Lesson 12.4).',
    nutr: 'Constructed scale: 5 = complete protein (DIAAS ≥ 100) with key micronutrients; 4 = complete protein, fewer data; 3 = one limiting amino acid (pea: DIAAS ≈ 70, Herreman et al., 2020) but other benefits such as fibre.',
    acc: 'Constructed scale from European consumer research (Module 13): insects meet strong disgust and neophobia; cultivated meat meets naturalness concerns.',
    welf: 'Constructed scale: 5 = no animals; broiler chicken requires many animals per kg of protein; insect sentience is uncertain.',
    trl: 'Technology readiness level: dried mealworm authorised as an EU novel food in 2021 (Regulation (EU) 2021/882); cultivated meat approved in Singapore (2020), the USA (2023) and Israel (2024), not in the EU as of 2026.',
    res: 'Constructed scale: dependence on imported feed, energy, specialised inputs and few producers (Lesson 15.2); insects score higher than chicken because they can be reared on local residual streams in weeks.'
  },
  lettuce: {
    clim: 'Teaching models of Lesson 15.1 (Worked examples 1, 2, 4).', land: 'Yields: field 3.3 kg m⁻² yr⁻¹ (Gargaro et al., 2025), greenhouse ≈ 33, plant factory 115 per m² of cultivation area (Zhuang et al., 2022).',
    water: 'Barbosa et al. (2015) for arid-region field and hydroponic greenhouse lettuce; 95–98 % water recovery of closed plant factories (Kozai, 2013).', cost: 'Vertical farm: levelised cost of Lesson 15.3; A–C illustrative.',
    sec: 'Constructed scale with anchors (Lesson 15.4): 1 long import chain, several exposures … 5 domestic, buffered and redundant.'
  }
};
const clone = o => JSON.parse(JSON.stringify(o));
const DATA = { protein: clone(PRESET0.protein), lettuce: clone(PRESET0.lettuce), custom: null };
function ensure(d) {
  d.inc = d.inc || { crit: d.crit.map(() => true), alt: d.alt.map(() => true) };
  if (!d.ahp) d.ahp = d.crit.map(() => d.crit.map(() => 1));
  d.alt.forEach((a, i) => { a.col = a.col || ACOL[i % ACOL.length]; });
  return d;
}
Object.values(DATA).forEach(d => d && ensure(d));

/* ================================================================= methods */
function active(d) {
  const ci = d.crit.map((_, j) => j).filter(j => d.inc.crit[j]);
  const ai = d.alt.map((_, i) => i).filter(i => d.inc.alt[i]);
  return { ci, ai, crit: ci.map(j => d.crit[j]), alt: ai.map(i => d.alt[i]), X: ai.map(i => ci.map(j => +d.alt[i].x[j])) };
}
const colOf = (X, j) => X.map(r => r[j]);
/** M1–M3: benefit-oriented normalised scores (1 = best). */
function normalise(X, crit, method) {
  return X.map(r => r.map((x, j) => {
    const c = colOf(X, j), lo = Math.min(...c), hi = Math.max(...c), cost = crit[j].dir === 'min';
    if (method === 'target') { const t = crit[j].target; return cost ? Math.min(1, t / Math.max(1e-12, x)) : Math.min(1, x / Math.max(1e-12, t)); }
    if (method === 'vector') { const n = Math.sqrt(c.reduce((s, v) => s + v * v, 0)) || 1; return cost ? 1 - x / n : x / n; }
    return hi === lo ? 1 : cost ? (hi - x) / (hi - lo) : (x - lo) / (hi - lo);
  }));
}
const wsm = (V, w) => V.map(r => r.reduce((s, v, j) => s + w[j] * v, 0));                               // M7
function wpm(X, crit, w) {                                                                             // M10 (ratio normalisation)
  return X.map(r => r.reduce((p, x, j) => { const c = colOf(X, j), lo = Math.min(...c), hi = Math.max(...c); const v = crit[j].dir === 'min' ? lo / Math.max(1e-12, x) : x / Math.max(1e-12, hi); return p * Math.pow(Math.max(1e-9, v), w[j]); }, 1));
}
function topsis(X, crit, w, method) {                                                                  // M8
  let U, benefit;
  if (method === 'vector') { U = X.map(r => r.map((x, j) => { const n = Math.sqrt(colOf(X, j).reduce((s, v) => s + v * v, 0)) || 1; return w[j] * x / n; })); benefit = crit.map(c => c.dir === 'max'); }
  else { U = normalise(X, crit, method).map(r => r.map((v, j) => w[j] * v)); benefit = crit.map(() => true); }
  const best = crit.map((_, j) => benefit[j] ? Math.max(...colOf(U, j)) : Math.min(...colOf(U, j)));
  const worst = crit.map((_, j) => benefit[j] ? Math.min(...colOf(U, j)) : Math.max(...colOf(U, j)));
  return U.map(r => { const dp = Math.sqrt(r.reduce((s, u, j) => s + (u - best[j]) ** 2, 0)), dm = Math.sqrt(r.reduce((s, u, j) => s + (u - worst[j]) ** 2, 0)); return dp + dm > 0 ? dm / (dp + dm) : 0.5; });
}
function scoreBy(agg, X, crit, w, norm) { return agg === 'topsis' ? topsis(X, crit, w, norm) : agg === 'wpm' ? wpm(X, crit, w) : wsm(normalise(X, crit, norm), w); }
function ranks(s) { const o = s.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]); const r = new Array(s.length); o.forEach(([, i], k) => { r[i] = k; }); return r; }
/** M5–M6: principal eigenvector (power iteration), λmax, CI, CR and the most inconsistent judgement. */
function ahp(A) {
  const n = A.length; if (n < 2) return { w: n ? [1] : [], lmax: n, CI: 0, CR: 0 };
  let w = new Array(n).fill(1 / n);
  for (let it = 0; it < 200; it++) { const Aw = A.map(r => r.reduce((s, a, j) => s + a * w[j], 0)); const s = Aw.reduce((a, b) => a + b, 0); const nw = Aw.map(v => v / s); const d = nw.reduce((m, v, i) => Math.max(m, Math.abs(v - w[i])), 0); w = nw; if (d < 1e-12) break; }
  const Aw = A.map(r => r.reduce((s, a, j) => s + a * w[j], 0));
  const lmax = Aw.reduce((s, v, i) => s + v / w[i], 0) / n; const CI = (lmax - n) / (n - 1); const CR = RI[n] ? CI / RI[n] : 0;
  let worst = null, wd = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const e = Math.abs(Math.log(A[i][j] * w[j] / w[i])); if (e > wd) { wd = e; worst = { i, j, now: A[i][j], suggest: snapSaaty(w[i] / w[j]) }; } }
  return { w, lmax, CI, CR, worst };
}
function dominated(X, crit) { // M-check: option k dominated by i
  const out = [];
  X.forEach((rk, k) => { X.forEach((ri, i) => { if (i === k || out.some(o => o.k === k)) return; let ge = true, gt = false; ri.forEach((x, j) => { const better = crit[j].dir === 'min' ? x < rk[j] : x > rk[j], worse = crit[j].dir === 'min' ? x > rk[j] : x < rk[j]; if (worse) ge = false; if (better) gt = true; }); if (ge && gt) out.push({ k, by: i }); }); });
  return out;
}

/* ================================================================= UI: controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'best', label: 'Best alternative', unit: '', format: v => v })
  .add({ id: 'score', label: 'Its score', unit: '', digits: 3 })
  .add({ id: 'margin', label: 'Lead over runner-up', unit: '', digits: 3 })
  .add({ id: 'p1', label: 'Monte Carlo: P(first)', unit: '%', digits: 0 })
  .add({ id: 'agree', label: 'Weighted sum and TOPSIS', unit: '', format: v => v })
  .add({ id: 'cr', label: 'AHP consistency ratio', unit: '', digits: 3 })
  .add({ id: 'dom', label: 'Dominated alternatives', unit: '', format: v => v })
  .add({ id: 'wmax', label: 'Largest weight', unit: '', format: v => v });

ui.section('Decision problem');
ui.segmented({ id: 'preset', label: 'Alternatives and criteria', options: [{ value: 'protein', label: 'Protein sources' }, { value: 'lettuce', label: 'Lettuce systems' }, { value: 'custom', label: 'My data' }], value: 'protein', help: 'Paste your own matrix in the card “Your own decision matrix” below the charts.' });
ui.section('Method');
ui.segmented({ id: 'norm', label: 'Normalisation', options: [{ value: 'minmax', label: 'Min–max' }, { value: 'target', label: 'Target' }, { value: 'vector', label: 'Vector' }], value: 'minmax', help: 'Eqs. M1–M3. The weighted product always uses ratio normalisation (M10).' });
ui.segmented({ id: 'agg', label: 'Aggregation', options: [{ value: 'wsm', label: 'Weighted sum' }, { value: 'topsis', label: 'TOPSIS' }, { value: 'wpm', label: 'Weighted product' }], value: 'wsm' });
ui.segmented({ id: 'wm', label: 'Weighting method', options: [{ value: 'direct', label: 'Direct' }, { value: 'swing', label: 'Swing' }, { value: 'ahp', label: 'AHP matrix' }], value: 'direct', help: 'Direct: points for importance. Swing: points for improving each criterion from its worst to its best value in this set. AHP: pairwise judgements in the matrix card.' });
ui.section('Weights');
const wHost = ui.html('<div id="wbox"></div>').querySelector('#wbox');
ui.section('Robustness');
ui.segmented({ id: 'mcMode', label: 'Monte Carlo weights', options: [{ value: 'smaa', label: 'Uniform (SMAA)' }, { value: 'perturb', label: 'Around mine' }], value: 'perturb', help: 'Uniform: all weight vectors equally likely (Eq. M9). Around mine: each weight × a lognormal factor with the spread below.' });
ui.slider({ id: 'sigma', label: 'Weight spread σ (around mine)', min: 0.05, max: 1.5, step: 0.05, value: 0.4, digits: 2, help: 'σ of ln(weight): 0.4 lets a weight typically vary by a factor of 1.5' });
ui.toggle({ id: 'dataUnc', label: 'Also sample data uncertainty (GSD 1.2)', value: false });
ui.slider({ id: 'mcN', label: 'Monte Carlo draws N', min: 1000, max: 20000, step: 1000, value: 5000, digits: 0 });
ui.button({ label: 'Run Monte Carlo again (new seed)', onClick: () => { seed = (seed * 1664525 + 1013904223) >>> 0; schedule(); } });
ui.section('Display');
ui.segmented({ id: 'view', label: 'Stage view', options: [{ value: 'parallel', label: 'Parallel coordinates' }, { value: 'radar', label: 'Radar' }], value: 'parallel' });
ui.presets([
  { label: 'Lesson 15.4 example', values: { preset: 'lettuce', norm: 'minmax', agg: 'wsm', wm: 'swing', mcMode: 'smaa', dataUnc: false } },
  { label: 'TOPSIS check', values: { preset: 'lettuce', norm: 'vector', agg: 'topsis', wm: 'swing' } },
  { label: 'Strong sustainability', values: { agg: 'wpm' } },
  { label: 'Protein transition', values: { preset: 'protein', norm: 'minmax', agg: 'wsm', wm: 'direct', mcMode: 'perturb' } },
  { label: 'AHP judgements', values: { wm: 'ahp' } }
], 'Method presets');
ui.saveButton('mcda-studio', () => Object.assign({}, ro.values(), { weights: JSON.stringify(curW && curW.map(v => +v.toFixed(3))), data: DATA.custom ? 'custom matrix' : ui.get('preset') }));

/* ---------- weight sliders (own markup: criteria change with the data set) ---------- */
function curData() { const k = ui.get('preset'); return DATA[k] || DATA.protein; }
function renderWeights() {
  const d = curData(), m = ui.get('wm');
  const stakes = d.stake ? Object.keys(d.stake) : [];
  const pres = `<div class="ctl-lab" style="margin-top:4px"><span>Stakeholder weights</span></div><div class="presets">${stakes.map(s => `<button type="button" data-stake="${s}">${s}</button>`).join('')}<button type="button" data-stake="Equal">Equal</button></div>`;
  if (m === 'ahp') { wHost.innerHTML = `<div class="ctl-help">Weights come from the pairwise matrix below the charts (principal eigenvector, Eq. M5).</div><div id="wlist"></div>`; renderWeightBars(); return; }
  const pts = d[m];
  const a = active(d);
  wHost.innerHTML = pres + d.crit.map((c, j) => {
    if (!d.inc.crit[j]) return '';
    let swing = '';
    if (m === 'swing') { const k = a.ci.indexOf(j), col = colOf(a.X, k); const lo = Math.min(...col), hi = Math.max(...col); const worst = c.dir === 'min' ? hi : lo, best = c.dir === 'min' ? lo : hi; swing = `<div class="ctl-help">swing ${fmtV(worst)} → ${fmtV(best)} ${esc(c.unit)}</div>`; }
    return `<div class="ctl mc-w"><div class="ctl-lab"><label for="w-${j}"><i class="wdot" style="background:${CCOL[j % CCOL.length]}"></i>${esc(c.name)}</label><output id="wo-${j}"></output></div><input id="w-${j}" type="range" min="0" max="100" step="1" value="${pts[j]}" aria-label="${m} weight of ${esc(c.name)}">${swing}</div>`;
  }).join('');
  updateWeightOutputs();
}
function fmtV(v) { const a = Math.abs(v); if (Number.isInteger(v)) return fmt(v, 0); return a >= 100 ? fmt(v, 0) : a >= 10 ? fmt(v, 1) : a >= 1 ? fmt(v, 2) : fmt(v, a >= 0.01 ? 3 : 4); }
function renderWeightBars() { const el = $('#wlist'); if (!el || !curW) return; const a = active(curData()); el.innerHTML = a.crit.map((c, k) => `<div class="wbar"><span>${esc(c.short)}</span><i style="width:${100 * curW[k]}%;background:${CCOL[a.ci[k] % CCOL.length]}"></i><b>${fmt(100 * curW[k], 1)} %</b></div>`).join(''); }
function updateWeightOutputs() {
  const d = curData(), m = ui.get('wm'); if (m === 'ahp') return;
  const pts = d[m]; const tot = d.crit.reduce((s, c, j) => s + (d.inc.crit[j] ? pts[j] : 0), 0) || 1;
  d.crit.forEach((c, j) => { const o = $('#wo-' + j), r = $('#w-' + j); if (!o) return; o.textContent = `${pts[j]} pt · ${fmt(100 * pts[j] / tot, 1)} %`; r.style.setProperty('--fill', pts[j] + '%'); });
}
wHost.addEventListener('input', e => { const r = e.target.closest('input[id^="w-"]'); if (!r) return; const d = curData(); d[ui.get('wm')][+r.id.slice(2)] = +r.value; updateWeightOutputs(); saveHash(); schedule(); });
wHost.addEventListener('click', e => {
  const b = e.target.closest('[data-stake]'); if (!b) return; const d = curData(); const s = b.dataset.stake;
  const w = s === 'Equal' ? d.crit.map(() => 50) : d.stake[s].slice();
  d.direct = w.slice(); if (ui.get('wm') !== 'direct') ui.set('wm', 'direct'); else { renderWeights(); schedule(); }
  saveHash(); window.FFP && FFP.toast && FFP.toast(`Weights: ${s}`);
});

/* ================================================================= persistence of the matrix and weights (hash) */
function saveHash() {
  const pack = {}; ['protein', 'lettuce', 'custom'].forEach(k => { const d = DATA[k]; if (!d) return; pack[k] = { x: d.alt.map(a => a.x), inc: d.inc, direct: d.direct, swing: d.swing, ahp: d.ahp.map(r => r.map(v => +v.toFixed(4))), crit: k === 'custom' ? d.crit : undefined, alt: k === 'custom' ? d.alt.map(a => a.name) : undefined, t: d.crit.map(c => c.target) }; });
  history.replaceState(null, '', location.pathname + location.search + '#m=' + encodeURIComponent(JSON.stringify(pack)));
}
function loadHash() {
  const m = location.hash.match(/m=([^&]+)/); if (!m) return;
  try {
    const pack = JSON.parse(decodeURIComponent(m[1]));
    if (pack.custom && pack.custom.crit && pack.custom.alt) DATA.custom = ensure({ label: 'My data', note: 'Your own matrix', crit: pack.custom.crit, alt: pack.custom.alt.map((n, i) => ({ id: 'a' + i, name: n, x: pack.custom.x[i], q: '' })), direct: pack.custom.direct, swing: pack.custom.swing, ahp: pack.custom.ahp, stake: null });
    ['protein', 'lettuce', 'custom'].forEach(k => { const p = pack[k], d = DATA[k]; if (!p || !d) return; if (p.x && p.x.length === d.alt.length) d.alt.forEach((a, i) => { if (p.x[i] && p.x[i].length === a.x.length) a.x = p.x[i].map(Number); }); ['direct', 'swing'].forEach(f => { if (Array.isArray(p[f]) && p[f].length === d.crit.length) d[f] = p[f].map(Number); }); if (Array.isArray(p.ahp) && p.ahp.length === d.crit.length) d.ahp = p.ahp; if (p.inc && p.inc.crit && p.inc.crit.length === d.crit.length && p.inc.alt.length === d.alt.length) d.inc = p.inc; if (Array.isArray(p.t)) p.t.forEach((t, j) => { if (d.crit[j] && isFinite(t)) d.crit[j].target = +t; }); });
  } catch (e) { /* ignore a malformed hash */ }
}
loadHash();

/* ================================================================= charts and cards */
const chMeth = new BarChart('#ch-methods', { y: { label: 'Score', unit: '0–1', min: 0, max: 1 }, height: 300 });
const chSens = new Plot('#ch-sens', { x: { label: 'Weight of the chosen criterion', unit: '', min: 0, max: 1 }, y: { label: 'Score', unit: '', min: 0, max: 1 }, height: 300 });
const chW = new BarChart('#ch-weights', { horizontal: true, y: { label: 'Weight', unit: '%', min: 0 }, height: 300, legend: false });
const sensSel = $('#sens-crit');
sensSel.addEventListener('change', () => schedule());

/* ---------- performance matrix (editable) ---------- */
function renderMatrix() {
  const d = curData(), a = active(d);
  const V = a.X.length ? normalise(a.X, a.crit, ui.get('norm')) : [];
  const head = `<thead><tr><th>Alternative</th>${d.crit.map((c, j) => `<th class="num"><label class="inc"><input type="checkbox" data-ic="${j}"${d.inc.crit[j] ? ' checked' : ''} aria-label="Include ${esc(c.name)}"> ${esc(c.short)}</label><div class="u" title="${c.dir === 'min' ? 'lower is better' : 'higher is better'}">${esc(c.unit)} ${c.dir === 'min' ? '↓' : '↑'}</div></th>`).join('')}</tr></thead>`;
  const body = d.alt.map((al, i) => {
    const k = a.ai.indexOf(i);
    return `<tr class="${d.inc.alt[i] ? '' : 'off'}"><td><label class="inc"><input type="checkbox" data-ia="${i}"${d.inc.alt[i] ? ' checked' : ''} aria-label="Include ${esc(al.name)}"> <i class="adot" style="background:${al.col}"></i>${esc(al.name)}</label></td>${d.crit.map((c, j) => {
      const kj = a.ci.indexOf(j); const v = k >= 0 && kj >= 0 ? V[k][kj] : null; const q = (al.q || '')[j];
      return `<td class="num"><input type="number" step="any" data-a="${i}" data-c="${j}" value="${al.x[j]}" aria-label="${esc(al.name)}, ${esc(c.name)}"><div class="nbar" title="normalised score ${v == null ? '—' : fmt(v, 2)}"><i style="width:${v == null ? 0 : Math.max(0, Math.min(1, v)) * 100}%"></i></div>${q ? `<span class="qb q-${q}" title="${esc(Q[q])}">${q}</span>` : ''}</td>`;
    }).join('')}</tr>`;
  }).join('');
  const tgt = `<tr class="tgt"><td>Target (for target normalisation)</td>${d.crit.map((c, j) => `<td class="num"><input type="number" step="any" data-t="${j}" value="${c.target ?? ''}" aria-label="Target for ${esc(c.name)}"></td>`).join('')}</tr>`;
  $('#mx-table').innerHTML = head + `<tbody>${body}${tgt}</tbody>`;
  const notes = NOTES[ui.get('preset')];
  $('#mx-notes').innerHTML = notes ? d.crit.map(c => notes[c.id] ? `<li><b>${esc(c.name)}.</b> ${esc(notes[c.id])}</li>` : '').join('') : '<li>Your own data: document the source and quality of every value.</li>';
  $('#mx-sub').textContent = d.note;
}
$('#mx-table').addEventListener('change', e => {
  const d = curData(), el = e.target;
  if (el.dataset.ic != null) { d.inc.crit[+el.dataset.ic] = el.checked; if (d.inc.crit.filter(Boolean).length < 2) { d.inc.crit[+el.dataset.ic] = true; el.checked = true; } renderWeights(); }
  else if (el.dataset.ia != null) { d.inc.alt[+el.dataset.ia] = el.checked; if (d.inc.alt.filter(Boolean).length < 2) { d.inc.alt[+el.dataset.ia] = true; el.checked = true; } }
  else if (el.dataset.t != null) { const v = +el.value; if (isFinite(v) && v > 0) d.crit[+el.dataset.t].target = v; }
  else if (el.dataset.a != null) { const v = +el.value; if (isFinite(v)) d.alt[+el.dataset.a].x[+el.dataset.c] = v; }
  saveHash(); matrixDirty = true; schedule();
});
$('#mx-reset').addEventListener('click', () => { const k = ui.get('preset'); if (!PRESET0[k]) return; DATA[k] = ensure(clone(PRESET0[k])); saveHash(); matrixDirty = true; renderWeights(); renderAHP(); schedule(); });
$('#mx-csv').addEventListener('click', () => { const d = curData(); downloadCSV(`mcda-${ui.get('preset')}.csv`, ['alternative', ...d.crit.map(c => `${c.name} (${c.unit}) [${c.dir}]`)], d.alt.map(a => [a.name, ...a.x])); });

/* ---------- AHP matrix card ---------- */
function renderAHP() {
  const d = curData(), a = active(d), n = a.ci.length; const host = $('#ahp-table');
  let h = `<thead><tr><th></th>${a.crit.map(c => `<th>${esc(c.short)}</th>`).join('')}</tr></thead><tbody>`;
  a.ci.forEach((i, r) => {
    h += `<tr><th>${esc(d.crit[i].short)}</th>`;
    a.ci.forEach((j, c) => {
      if (r === c) h += '<td class="diag">1</td>';
      else if (c > r) h += `<td><select data-i="${i}" data-j="${j}" aria-label="${esc(d.crit[i].short)} compared with ${esc(d.crit[j].short)}">${SAATY.map(v => `<option value="${v}"${Math.abs(Math.log(v / d.ahp[i][j])) < 1e-6 ? ' selected' : ''}>${saatyLabel(v)}</option>`).join('')}</select></td>`;
      else h += `<td class="recip">${saatyLabel(1 / d.ahp[j][i])}</td>`;
    });
    h += '</tr>';
  });
  host.innerHTML = h + '</tbody>';
  $('#ahp-n').textContent = n;
}
$('#ahp-table').addEventListener('change', e => { const s = e.target.closest('select'); if (!s) return; const d = curData(), i = +s.dataset.i, j = +s.dataset.j, v = +s.value; d.ahp[i][j] = v; d.ahp[j][i] = 1 / v; saveHash(); renderAHP(); schedule(); });
$('#ahp-consistent').addEventListener('click', () => {
  const d = curData(), a = active(d); const src = d.direct; const tot = a.ci.reduce((s, j) => s + src[j], 0) || 1;
  a.ci.forEach(i => a.ci.forEach(j => { if (i !== j) d.ahp[i][j] = snapSaaty((src[i] / tot) / Math.max(1e-9, src[j] / tot)); }));
  a.ci.forEach(i => a.ci.forEach(j => { if (i < j) d.ahp[j][i] = 1 / d.ahp[i][j]; }));
  saveHash(); renderAHP(); schedule(); window.FFP && FFP.toast && FFP.toast('Matrix filled from your direct weights (snapped to the 1–9 scale)');
});
$('#ahp-fix').addEventListener('click', () => { const d = curData(), a = active(d); const r = ahp(a.ci.map(i => a.ci.map(j => d.ahp[i][j]))); if (!r.worst) return; const i = a.ci[r.worst.i], j = a.ci[r.worst.j]; d.ahp[i][j] = r.worst.suggest; d.ahp[j][i] = 1 / r.worst.suggest; saveHash(); renderAHP(); schedule(); });

/* ---------- CSV import ---------- */
$('#csv-load').addEventListener('click', () => {
  const t = parseTable($('#csv-in').value); const msg = $('#csv-msg');
  try {
    if (t.headers.length < 3 || t.rows.length < 2) throw new Error('Need a header row, at least two criteria and at least two alternatives.');
    const crit = t.headers.slice(1).map((h, j) => { const m = String(h).match(/\[(min|max)\]/i); const unit = (String(h).match(/\(([^)]*)\)/) || [])[1] || ''; const name = String(h).replace(/\[(min|max)\]/i, '').replace(/\([^)]*\)/, '').trim() || 'C' + (j + 1); if (!m) throw new Error(`Criterion “${name}” needs [min] or [max].`); return { id: 'c' + j, name, short: name.length > 11 ? name.slice(0, 10) + '…' : name, unit, dir: m[1].toLowerCase(), target: null }; });
    const alt = t.rows.map((r, i) => { const x = r.slice(1).map(Number); if (x.length !== crit.length || x.some(v => !isFinite(v))) throw new Error(`Row ${i + 2}: every criterion needs a number.`); return { id: 'a' + i, name: String(r[0]), x, q: '' }; });
    crit.forEach((c, j) => { const col = alt.map(a => a.x[j]); c.target = c.dir === 'min' ? Math.min(...col) : Math.max(...col); });
    DATA.custom = ensure({ label: 'My data', note: 'Your own matrix — document the source and quality of every value', crit, alt, direct: crit.map(() => 50), swing: crit.map(() => 50), ahp: null, stake: null });
    msg.textContent = `Loaded ${alt.length} alternatives × ${crit.length} criteria.`; msg.className = 'csv-msg ok';
    saveHash(); if (ui.get('preset') !== 'custom') ui.set('preset', 'custom'); else { renderAll(); }
  } catch (err) { msg.textContent = err.message; msg.className = 'csv-msg bad'; }
});

/* ================================================================= stage: parallel coordinates / radar + animated ranking */
const stageEl = $('#stage');
const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Decision board: normalised performance of every alternative on every criterion, criterion weights, and the animated ranking');
stageEl.appendChild(cv);
const ctx = cv.getContext('2d');
const tip = document.createElement('div'); tip.className = 'mc-tip'; stageEl.appendChild(tip);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'mcda-decision-board.png'; a.click(); } });
let W = 0, H = 0, DPR = 1;
function resize() { DPR = Math.min(window.devicePixelRatio || 1, 2); W = stageEl.clientWidth; H = stageEl.clientHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
new ResizeObserver(resize).observe(stageEl); resize();
let visible = true; new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(stageEl);
const anim = { y: {}, len: {}, v: {} }; // animated values keyed by alternative id
let view = null, hoverAlt = -1, lastNow = performance.now();
function lerpTo(obj, key, target, k) { if (obj[key] == null || !isFinite(obj[key])) obj[key] = target; obj[key] += (target - obj[key]) * k; return obj[key]; }
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastNow) / 1000); lastNow = now;
  if (!visible || document.hidden || !view || !W) return;
  draw(1 - Math.exp(-dt * 9));
}
function draw(k) {
  const { a, V, w, scores, rk, p1, P } = view; const nA = a.alt.length, nC = a.crit.length;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#101c17'); bg.addColorStop(1, '#070c0a'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const LW = W * 0.63, x0 = 46, x1 = LW - 20;
  // weight bar
  ctx.font = '600 10px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(185,200,192,.8)'; ctx.fillText('CRITERION WEIGHTS', x0 - 24, 22);
  let wx = x0 - 24; const wbw = x1 - x0 + 24;
  a.crit.forEach((c, j) => { const ww = wbw * w[j]; ctx.fillStyle = withAlpha(CCOL[a.ci[j] % CCOL.length], 0.85); ctx.fillRect(wx, 30, Math.max(0, ww - 1.5), 12); if (ww > 34) { ctx.fillStyle = '#0b1210'; ctx.font = '700 9.5px JetBrains Mono, monospace'; ctx.fillText(`${fmt(100 * w[j], 0)}%`, wx + 4, 40); } wx += ww; });
  if (P.view === 'radar') drawRadar(k); else drawParallel(k);
  // ranking panel
  const rx = LW + 10, rw = W - rx - 16; const top = 62, rowH = Math.min(58, (H - top - 20) / Math.max(1, nA));
  ctx.fillStyle = 'rgba(185,200,192,.8)'; ctx.font = '600 10px JetBrains Mono, monospace';
  ctx.fillText(trunc(`RANKING · ${P.agg === 'wsm' ? 'WEIGHTED SUM' : P.agg === 'topsis' ? 'TOPSIS' : 'WEIGHTED PRODUCT'}`, rw - 92), rx, 22);
  ctx.fillStyle = 'rgba(185,200,192,.55)'; ctx.font = '500 9.5px JetBrains Mono, monospace';
  ctx.fillText(trunc(P.agg === 'wpm' ? 'ratio normalisation' : `${P.norm === 'minmax' ? 'min–max' : P.norm} · ${P.wm} weights`, rw - 92), rx, 38);
  const smax = Math.max(1e-9, ...scores);
  a.alt.forEach((al, i) => {
    const y = lerpTo(anim.y, al.id, top + rk[i] * rowH, k), len = lerpTo(anim.len, al.id, scores[i] / smax, k);
    const hov = hoverAlt === i, barW = rw - 40 - (p1 ? 76 : 10);
    ctx.fillStyle = hov ? 'rgba(255,255,255,.09)' : 'rgba(255,255,255,.035)'; rrect(rx, y, rw, rowH - 8, 9); ctx.fill();
    ctx.fillStyle = withAlpha(al.col, 0.9); rrect(rx + 30, y + rowH - 23, Math.max(2, barW * len), 7, 3.5); ctx.fill();
    ctx.fillStyle = rk[i] === 0 ? '#9be7b6' : '#e6eee9'; ctx.font = '700 15px JetBrains Mono, monospace'; ctx.fillText(String(rk[i] + 1), rx + 10, y + 21);
    ctx.font = '650 12px Inter, sans-serif'; ctx.fillStyle = '#e6eee9'; ctx.fillText(trunc(al.name, rw - 110), rx + 30, y + 17);
    ctx.font = '600 11.5px JetBrains Mono, monospace'; ctx.textAlign = 'right'; ctx.fillText(fmt(scores[i], 3), rx + rw - 10, y + 17);
    if (p1) { ctx.font = '500 9.5px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(185,200,192,.8)'; ctx.fillText(`P(1st) ${fmt(100 * p1[i], 0)} %`, rx + rw - 10, y + rowH - 16); }
    ctx.textAlign = 'left';
  });
}
function trunc(s, maxW) { if (ctx.measureText(s).width <= maxW) return s; while (s.length > 3 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1); return s + '…'; }
function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
let hitLines = [];
function drawParallel(k) {
  const { a, V, w, rk } = view; const nC = a.crit.length; const LW = W * 0.63, x0 = 46, x1 = LW - 20, yT = 104, yB = H - 46;
  const X = j => nC > 1 ? x0 + (x1 - x0) * j / (nC - 1) : (x0 + x1) / 2, Y = v => yB - (yB - yT) * Math.max(0, Math.min(1, v));
  // axes
  const gap = nC > 1 ? (x1 - x0) / (nC - 1) : 200;
  a.crit.forEach((c, j) => {
    const x = X(j), col = CCOL[a.ci[j] % CCOL.length];
    ctx.strokeStyle = withAlpha(col, 0.35 + 0.6 * Math.min(1, w[j] * nC / 2)); ctx.lineWidth = 1 + 7 * w[j]; ctx.beginPath(); ctx.moveTo(x, yT); ctx.lineTo(x, yB); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillStyle = '#e6eee9'; ctx.font = '650 10.5px Inter, sans-serif'; ctx.fillText(trunc(c.short, gap - 4), x, 62);
    ctx.font = '500 9.5px JetBrains Mono, monospace'; ctx.fillStyle = withAlpha(col, 0.95); ctx.fillText(`${fmt(100 * w[j], 0)} % ${c.dir === 'min' ? '↓' : '↑'}`, x, 76);
    const colv = colOf(a.X, j), lo = Math.min(...colv), hi = Math.max(...colv); const best = c.dir === 'min' ? lo : hi, worst = c.dir === 'min' ? hi : lo;
    ctx.fillStyle = 'rgba(185,200,192,.7)'; ctx.fillText(fmtV(best), x, yT - 9); ctx.fillText(fmtV(worst), x, yB + 14);
    ctx.textAlign = 'left';
  });
  ctx.fillStyle = 'rgba(185,200,192,.55)'; ctx.font = '500 9px JetBrains Mono, monospace'; ctx.save(); ctx.translate(14, (yT + yB) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('normalised score: 0 (worst) → 1 (best)', 0, 0); ctx.restore();
  // alternative polylines, drawn worst first so the leader is on top
  hitLines = [];
  const order = a.alt.map((_, i) => i).sort((p, q) => rk[q] - rk[p]);
  order.forEach(i => {
    const al = a.alt[i]; const pts = a.crit.map((_, j) => [X(j), lerpTo(anim.v, al.id + '|' + j, Y(V[i][j]), k)]);
    hitLines.push({ i, pts });
    const lead = rk[i] === 0, hov = hoverAlt === i, dim = hoverAlt >= 0 && !hov;
    if (lead || hov) { ctx.strokeStyle = withAlpha(al.col, 0.25); ctx.lineWidth = 9; line(pts); }
    ctx.strokeStyle = withAlpha(al.col, dim ? 0.25 : 0.95); ctx.lineWidth = lead || hov ? 3 : 2; line(pts);
    pts.forEach(([x, y]) => { ctx.fillStyle = withAlpha(al.col, dim ? 0.3 : 1); ctx.beginPath(); ctx.arc(x, y, lead || hov ? 4 : 3, 0, 7); ctx.fill(); });
  });
}
function line(pts) { ctx.beginPath(); pts.forEach(([x, y], q) => q ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); }
function drawRadar(k) {
  const { a, V, w, rk } = view; const nC = a.crit.length; const LW = W * 0.63; const cx = LW / 2 + 6, cy = (64 + H) / 2 + 4, R = Math.min(LW * 0.34, (H - 64) * 0.36);
  const ang = j => -Math.PI / 2 + 2 * Math.PI * j / nC;
  for (let g = 1; g <= 4; g++) { ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1; ctx.beginPath(); for (let j = 0; j <= nC; j++) { const t = ang(j % nC); const r = R * g / 4; j ? ctx.lineTo(cx + r * Math.cos(t), cy + r * Math.sin(t)) : ctx.moveTo(cx + r * Math.cos(t), cy + r * Math.sin(t)); } ctx.stroke(); }
  a.crit.forEach((c, j) => {
    const t = ang(j), col = CCOL[a.ci[j] % CCOL.length];
    ctx.strokeStyle = withAlpha(col, 0.35 + 0.6 * Math.min(1, w[j] * nC / 2)); ctx.lineWidth = 1 + 7 * w[j]; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.cos(t), cy + R * Math.sin(t)); ctx.stroke();
    const lx = cx + (R + 24) * Math.cos(t), ly = cy + (R + 18) * Math.sin(t); ctx.textAlign = Math.abs(Math.cos(t)) < 0.2 ? 'center' : Math.cos(t) > 0 ? 'left' : 'right';
    ctx.fillStyle = '#e6eee9'; ctx.font = '650 11px Inter, sans-serif'; ctx.fillText(c.short, lx, ly); ctx.font = '500 9.5px JetBrains Mono, monospace'; ctx.fillStyle = withAlpha(col, 0.95); ctx.fillText(`${fmt(100 * w[j], 0)} %`, lx, ly + 12); ctx.textAlign = 'left';
  });
  hitLines = [];
  const order = a.alt.map((_, i) => i).sort((p, q) => rk[q] - rk[p]);
  order.forEach(i => {
    const al = a.alt[i]; const pts = a.crit.map((_, j) => { const r = R * lerpTo(anim.v, al.id + '|r' + j, Math.max(0.02, Math.min(1, V[i][j])), k); return [cx + r * Math.cos(ang(j)), cy + r * Math.sin(ang(j))]; });
    hitLines.push({ i, pts: pts.concat([pts[0]]) });
    const lead = rk[i] === 0, hov = hoverAlt === i, dim = hoverAlt >= 0 && !hov;
    ctx.fillStyle = withAlpha(al.col, dim ? 0.03 : lead || hov ? 0.18 : 0.07); ctx.beginPath(); pts.forEach(([x, y], q) => q ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = withAlpha(al.col, dim ? 0.25 : 0.95); ctx.lineWidth = lead || hov ? 3 : 1.8; ctx.beginPath(); pts.forEach(([x, y], q) => q ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke();
  });
}
function distSeg(px, py, [x1, y1], [x2, y2]) { const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)); return Math.hypot(px - x1 - t * dx, py - y1 - t * dy); }
cv.addEventListener('pointermove', e => {
  if (!view) return; const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
  let best = -1, bd = 9;
  if (x > W * 0.63) { const top = 62, rowH = Math.min(58, (H - top - 20) / Math.max(1, view.a.alt.length)); view.a.alt.forEach((al, i) => { const yy = anim.y[al.id]; if (y >= yy && y <= yy + rowH - 8) best = i; }); }
  else hitLines.forEach(h => { for (let q = 1; q < h.pts.length; q++) { const d = distSeg(x, y, h.pts[q - 1], h.pts[q]); if (d < bd) { bd = d; best = h.i; } } });
  hoverAlt = best;
  if (best < 0) { tip.style.display = 'none'; return; }
  const { a, V } = view; const al = a.alt[best];
  tip.innerHTML = `<b>${esc(al.name)}</b> · rank ${view.rk[best] + 1}<table>${a.crit.map((c, j) => `<tr><td>${esc(c.short)}</td><td>${fmtV(a.X[best][j])} <small>${esc(c.unit)}</small></td><td>${fmt(V[best][j], 2)}</td></tr>`).join('')}</table>`;
  tip.style.display = 'block'; tip.style.left = Math.min(x + 14, W - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(y + 12, H - tip.offsetHeight - 8) + 'px';
});
cv.addEventListener('pointerleave', () => { hoverAlt = -1; tip.style.display = 'none'; });
requestAnimationFrame(frame);

/* ================================================================= Monte Carlo (M9) */
let seed = 20260927;
function monteCarlo(P, a, w, N) {
  const rng = mulberry32(seed); const nA = a.alt.length, nC = a.crit.length;
  const acc = a.alt.map(() => new Array(nA).fill(0));
  for (let s = 0; s < N; s++) {
    let ws;
    if (P.mcMode === 'smaa') { const e = a.crit.map(() => -Math.log(1 - rng())); const t = e.reduce((x, y) => x + y, 0); ws = e.map(v => v / t); }
    else { const e = w.map(v => Math.max(1e-6, v) * Math.exp(P.sigma * randn(rng))); const t = e.reduce((x, y) => x + y, 0); ws = e.map(v => v / t); }
    const X = P.dataUnc ? a.X.map(r => r.map(x => x * Math.exp(Math.log(1.2) * randn(rng)))) : a.X;
    const r = ranks(scoreBy(P.agg, X, a.crit, ws, P.norm));
    r.forEach((rr, i) => { acc[i][rr]++; });
  }
  return acc.map(row => row.map(c => c / N));
}
function renderAcceptability(A, a) {
  const nA = a.alt.length;
  const cell = v => `<td class="num" style="background:${withAlpha('#1d7a4a', 0.08 + 0.85 * v)};color:${v > 0.45 ? '#fff' : 'inherit'}">${v <= 0 ? '·' : v < 0.0005 ? '&lt;0.1' : fmt(100 * v, v < 0.1 ? 1 : 0)}</td>`;
  $('#acc-table').innerHTML = `<thead><tr><th>Alternative</th>${Array.from({ length: nA }, (_, r) => `<th class="num">rank ${r + 1}</th>`).join('')}</tr></thead><tbody>${a.alt.map((al, i) => `<tr><td><i class="adot" style="background:${al.col}"></i>${esc(al.name)}</td>${A[i].map(cell).join('')}</tr>`).join('')}</tbody>`;
}

/* ================================================================= update */
let curW = null, raf = 0, matrixDirty = true, lastPreset = null, lastWm = null, mcT = 0;
function weightsNow(d, a, m) {
  if (m === 'ahp') { const r = ahp(a.ci.map(i => a.ci.map(j => d.ahp[i][j]))); return { w: r.w, ahp: r }; }
  const pts = a.ci.map(j => d[m][j]); const t = pts.reduce((s, v) => s + v, 0);
  return { w: t > 0 ? pts.map(v => v / t) : pts.map(() => 1 / pts.length), ahp: null };
}
function renderAll() { renderWeights(); renderMatrix(); renderAHP(); schedule(); }
function update() {
  const P = ui.values();
  if (P.preset === 'custom' && !DATA.custom) { ui.set('preset', 'protein'); window.FFP && FFP.toast && FFP.toast('Paste and load your own matrix first (card below the charts)'); return; }
  if (P.preset !== lastPreset || P.wm !== lastWm) { lastPreset = P.preset; lastWm = P.wm; renderWeights(); renderAHP(); matrixDirty = true; }
  const d = curData(), a = active(d);
  const { w, ahp: ah } = weightsNow(d, a, P.wm); curW = w;
  $('#ahp-card').classList.toggle('inactive', P.wm !== 'ahp');
  if (matrixDirty) { renderMatrix(); matrixDirty = false; } else refreshNormBars(d, a, P);
  const V = P.agg === 'wpm' ? a.X.map(r => r.map((x, j) => { const c = colOf(a.X, j), lo = Math.min(...c), hi = Math.max(...c); return a.crit[j].dir === 'min' ? lo / Math.max(1e-12, x) : x / Math.max(1e-12, hi); })) : normalise(a.X, a.crit, P.norm);
  const scores = scoreBy(P.agg, a.X, a.crit, w, P.norm); const rk = ranks(scores);
  const sW = wsm(normalise(a.X, a.crit, P.norm), w), sT = topsis(a.X, a.crit, w, P.norm), sP = wpm(a.X, a.crit, w);
  view = Object.assign(view || {}, { a, V, w, scores, rk, P, p1: view && view.pKey === keyOf(P, d) ? view.p1 : null });
  // readouts
  const order = rk.map((r, i) => [r, i]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
  const b = order[0], s2 = order[1];
  ro.set('best', a.alt[b].name, 'ok', `${P.agg === 'wsm' ? 'weighted sum' : P.agg === 'topsis' ? 'TOPSIS' : 'weighted product'}`);
  ro.set('score', scores[b], null, `runner-up: ${a.alt[s2].name}`);
  const margin = scores[b] - scores[s2]; ro.set('margin', margin, margin > 0.1 ? 'ok' : margin > 0.03 ? 'warn' : 'bad', margin > 0.1 ? 'clear lead' : margin > 0.03 ? 'modest lead' : 'a near tie — check robustness');
  const wW = ranks(sW).indexOf(0), wT = ranks(sT).indexOf(0);
  ro.set('agree', wW === wT ? 'same winner' : 'different winners', wW === wT ? 'ok' : 'warn', wW === wT ? a.alt[wW].name : `WSM: ${a.alt[wW].name}; TOPSIS: ${a.alt[wT].name}`);
  if (ah) ro.set('cr', ah.CR, ah.CR <= 0.1 ? 'ok' : ah.CR <= 0.2 ? 'warn' : 'bad', ah.CR <= 0.1 ? `λmax = ${fmt(ah.lmax, 3)}; acceptably consistent` : `λmax = ${fmt(ah.lmax, 3)}; revise the judgements`);
  else ro.set('cr', NaN, null, 'switch weighting to AHP');
  const dom = dominated(a.X, a.crit); ro.set('dom', dom.length ? dom.map(o => a.alt[o.k].name.split(' (')[0]).join(', ') : 'none', dom.length ? 'warn' : 'ok', dom.length ? dom.map(o => `${a.alt[o.k].name.split(' (')[0]} by ${a.alt[o.by].name.split(' (')[0]}`).join('; ') : 'no alternative is beaten on every criterion');
  const jm = w.indexOf(Math.max(...w)); ro.set('wmax', a.crit[jm].name, null, `${fmt(100 * w[jm], 1)} % · ${P.wm === 'ahp' ? 'AHP eigenvector' : P.wm + ' points'}`);
  // AHP card
  if (ah) { $('#ahp-stats').innerHTML = `λ<sub>max</sub> = <b>${fmt(ah.lmax, 3)}</b> · CI = <b>${fmt(ah.CI, 3)}</b> · RI(${a.ci.length}) = ${fmt(RI[a.ci.length] || 0, 2)} · CR = <b class="${ah.CR <= 0.1 ? 'ok' : 'bad'}">${fmt(ah.CR, 3)}</b> ${ah.CR <= 0.1 ? '— acceptably consistent (≤ 0.10)' : '— above 0.10: revise the judgements'}${ah.worst && ah.CR > 0.05 ? `<br>Most inconsistent judgement: <b>${esc(a.crit[ah.worst.i].short)} vs ${esc(a.crit[ah.worst.j].short)}</b> = ${saatyLabel(ah.worst.now)}; the other judgements imply about ${saatyLabel(ah.worst.suggest)}.` : ''}`; }
  else { const r = ahp(a.ci.map(i => a.ci.map(j => d.ahp[i][j]))); $('#ahp-stats').innerHTML = `Matrix CR = ${fmt(r.CR, 3)}. Select <em>AHP matrix</em> as weighting method to use these weights.`; }
  renderWeightBars(); updateWeightOutputs();
  // charts: methods, weights, sensitivity
  const names = a.alt.map(x => x.name.length > 18 ? x.name.split(' (')[0].replace(', Almería + truck', '').slice(0, 18) : x.name);
  chMeth.set(names, [{ label: `Weighted sum (${P.norm})`, values: sW, color: 'accent', format: v => fmt(v, 2) }, { label: `TOPSIS (${P.norm === 'vector' ? 'vector' : P.norm})`, values: sT, color: 'water', format: v => fmt(v, 2) }, { label: 'Weighted product (ratio)', values: sP, color: 'magenta', format: v => fmt(v, 2) }]);
  chW.set(a.crit.map(c => c.name), [{ label: 'Weight', values: w.map(v => 100 * v), colors: a.ci.map(j => CCOL[j % CCOL.length]), format: v => fmt(v, 1) + ' %' }]);
  // sensitivity selector
  const prevSel = sensSel.value; sensSel.innerHTML = a.crit.map((c, j) => `<option value="${j}">${esc(c.name)}</option>`).join(''); sensSel.value = prevSel && +prevSel < a.crit.length ? prevSel : String(jm);
  const js = +sensSel.value, w0 = w[js]; const xs = []; for (let q = 0; q <= 50; q++) xs.push(q / 50);
  const curves = a.alt.map(() => []);
  xs.forEach(x => { const ws = w.map((v, j) => j === js ? x : (w0 < 1 ? v * (1 - x) / (1 - w0) : (1 - x) / (w.length - 1))); scoreBy(P.agg, a.X, a.crit, ws, P.norm).forEach((s, i) => curves[i].push(s)); });
  chSens.clear();
  a.alt.forEach((al, i) => chSens.line('s' + i, xs, curves[i], { color: al.col, width: rk[i] === 0 ? 2.8 : 1.8, label: al.name }));
  chSens.vline('now', w0, { color: 'ink', label: `current ${fmt(100 * w0, 0)} %`, dash: [4, 3] });
  let lastLead = -1; xs.forEach((x, q) => { let bi = 0; curves.forEach((c, i) => { if (c[q] > curves[bi][q]) bi = i; }); if (lastLead >= 0 && bi !== lastLead) chSens.vline('x' + q, x, { color: 'danger', dash: [2, 3], width: 1, label: `${fmt(100 * x, 0)} %` }); lastLead = bi; });
  $('#sens-note').textContent = `Weights of the other criteria are rescaled in proportion (Eq. 15.4.8). Red lines: weights at which the leader changes.`;
  // Monte Carlo (debounced)
  clearTimeout(mcT); mcT = setTimeout(() => {
    const key = keyOf(P, d); const A = monteCarlo(P, a, w, Math.round(P.mcN)); renderAcceptability(A, a);
    const p1 = A.map(r => r[0]); view.p1 = p1; view.pKey = key;
    const se = 100 * Math.sqrt(p1[b] * (1 - p1[b]) / P.mcN);
    ro.set('p1', 100 * p1[b], p1[b] > 0.8 ? 'ok' : p1[b] > 0.5 ? 'warn' : 'bad', `${a.alt[b].name} · ± ${fmt(se, 1)} pp (SE) · ${P.mcMode === 'smaa' ? 'uniform weights' : `σ = ${fmt(P.sigma, 2)}`}${P.dataUnc ? ' + data' : ''}`);
    $('#acc-sub').textContent = `${Math.round(P.mcN).toLocaleString('en-GB')} draws · ${P.mcMode === 'smaa' ? 'weights uniform over all possible weight vectors (SMAA)' : `your weights × lognormal factors (σ = ${fmt(P.sigma, 2)})`}${P.dataUnc ? ' · performance values × lognormal factors (GSD 1.2)' : ''} · ${P.agg === 'wsm' ? 'weighted sum' : P.agg === 'topsis' ? 'TOPSIS' : 'weighted product'}.`;
  }, 180);
}
function keyOf(P, d) { return [P.preset, P.norm, P.agg, P.wm, P.mcMode, P.sigma, P.dataUnc, P.mcN, seed, JSON.stringify(d.alt.map(a => a.x)), JSON.stringify(d.inc), JSON.stringify(curW)].join('|'); }
function refreshNormBars(d, a, P) {
  const V = normalise(a.X, a.crit, P.norm);
  document.querySelectorAll('#mx-table input[data-a]').forEach(inp => { const i = a.ai.indexOf(+inp.dataset.a), j = a.ci.indexOf(+inp.dataset.c); const bar = inp.parentElement.querySelector('.nbar i'); if (bar) bar.style.width = (i >= 0 && j >= 0 ? Math.max(0, Math.min(1, V[i][j])) * 100 : 0) + '%'; });
}
ui.onChange((s, id) => { if (id === 'norm') matrixDirty = true; schedule(); });
function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); }
renderWeights(); renderMatrix(); renderAHP();
update();
window.__mcda = { DATA, normalise, wsm, topsis, wpm, ahp, active, scoreBy, ranks, monteCarlo, get view() { return view; } };
