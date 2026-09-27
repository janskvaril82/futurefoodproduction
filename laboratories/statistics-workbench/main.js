/* Statistics workbench — analyse your own growth data.
   Parsing (robust TSV/CSV with decimal commas), descriptive statistics, t-tests, one-way ANOVA + Tukey HSD
   + Brown–Forsythe + Welch ANOVA, randomised complete block ANOVA, simple linear regression, correlation,
   χ² tests and power analysis. Every result comes with an APA-7 sentence and a plain-language assumption checklist.
   Core statistics: /assets/js/stats.js; exact power, Shapiro–Wilk and rank tests: ./stats-extra.js. */
import * as S from '/assets/js/stats.js';
import * as X from './stats-extra.js';
import { Controls, Readouts, stageToolbar, hudChips } from '/assets/js/ui.js';
import { Plot, BarChart, downloadCSV, linspace } from '/assets/js/plot.js';
import { palette, categorical, withAlpha, colormapCSS, colormapGradient } from '/assets/js/colors.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const { num, nlz, apaP, dfs } = X;

/* =====================================================================
   Example datasets (clearly labelled: simulated teaching data or published textbook data)
   ===================================================================== */
const long = (gname, yname, obj) => `${gname}\t${yname}\n` + Object.entries(obj).map(([k, arr]) => arr.map(v => `${k}\t${v}`).join('\n')).join('\n');
function growLogDemo() {
  const rng = S.mulberry32(20260926), rn = () => S.randn(rng);
  const trts = [['EC 1.2', 0.92], ['EC 1.8', 1.0], ['EC 2.4', 1.04]], days = [7, 14, 21, 28];
  const rows = [];
  trts.forEach(([t, f], ti) => { for (let p = 1; p <= 5; p++) { const vig = f * (1 + 0.08 * rn()); days.forEach(d => {
    const area = 900 * vig / (1 + Math.exp(-(d - 18) / 4.2)) * (1 + 0.04 * rn());
    const row = { date: `2026-10-${String(1 + d).padStart(2, '0')}`, day: d, plant: `${t.replace(' ', '').replace('.', '')}-P${p}`, treatment: t,
      fw_g: d === 28 ? +(0.21 * area * (1 + 0.05 * rn())).toFixed(1) : '', leaves: Math.round(4 + d * 0.62 * vig + rn()), area_cm2: +area.toFixed(0), height_cm: +(4 + 0.42 * d * vig + 0.5 * rn()).toFixed(1),
      ec: +([1.2, 1.8, 2.4][ti] + 0.08 * rn()).toFixed(2), ph: +(5.9 + 0.15 * rn()).toFixed(2), t_water: +(20.5 + 0.6 * rn()).toFixed(1), do_mgl: +(8.1 + 0.3 * rn()).toFixed(1), ppfd: Math.round(250 + 12 * rn()), notes: d === 28 ? 'harvest' : '' };
    rows.push(row); }); } });
  return { version: 1, meta: { group: 'Demo group', system: 'Deep-water culture', crop: 'Butterhead lettuce' }, rows };
}
const EX = {
  led: { label: 'LED spectra → fresh weight (ANOVA)', an: 'anova', map: { y: 'fw_g', group: 'spectrum' },
    note: 'Simulated teaching data. Harvest fresh weight (g) of butterhead lettuce under three LED spectra; one plant per independent hydroponic unit, eight units per spectrum.',
    text: long('spectrum', 'fw_g', { 'Red–blue': [158.2, 171.5, 190.4, 165.9, 182.3, 149.8, 188.7, 176.1], 'White': [181.2, 204.6, 176.9, 193.8, 210.3, 169.4, 188.1, 199.7], 'White + far-red': [214.5, 198.3, 236.9, 205.1, 221.8, 189.6, 243.2, 209.4] }) },
  ec: { label: 'EC of the solution → fresh weight (regression)', an: 'regression', map: { x: 'ec_mS_cm', y: 'fw_g' },
    note: 'Simulated teaching data. Sixteen deep-water-culture units run at eight electrical conductivities (two units each); harvest fresh weight per plant (g). Look at the residual plot and the lack-of-fit test: is a straight line adequate?',
    text: 'unit\tec_mS_cm\tfw_g\n' + [[0.6, 158], [0.6, 166], [0.9, 184], [0.9, 176], [1.2, 190], [1.2, 197], [1.5, 205], [1.5, 199], [1.8, 211], [1.8, 204], [2.1, 210], [2.1, 217], [2.4, 219], [2.4, 213], [2.7, 216], [2.7, 221]].map((r, i) => `U${i + 1}\t${r[0]}\t${r[1]}`).join('\n') },
  paired: { label: 'Nitrate before/after N-free finish (paired t)', an: 'ttest', tt: 'paired', map: { a: 'nitrate_before', b: 'nitrate_after' },
    note: 'Simulated teaching data. Leaf nitrate (mg kg⁻¹ fresh weight) of the same 12 plants before and after three days in a nitrogen-free finishing solution.',
    text: 'plant\tnitrate_before\tnitrate_after\n' + [[3480, 2710], [3120, 2580], [3950, 3240], [2870, 2490], [3610, 2830], [3330, 2760], [4120, 3390], [3050, 2610], [3710, 2950], [3260, 2880], [3890, 3070], [3440, 2690]].map((r, i) => `P${i + 1}\t${r[0]}\t${r[1]}`).join('\n') },
  hedonic: { label: 'Tasting panel, 9-point hedonic (block ANOVA)', an: 'rcbd', map: { y: 'liking', group: 'sample', block: 'panellist' },
    note: 'Simulated teaching data. Twelve panellists each rated three lettuce samples on the 9-point hedonic scale (1 = dislike extremely, 9 = like extremely). Each panellist is a block.',
    text: 'panellist\tsample\tliking\n' + [[7, 6, 8], [6, 5, 7], [8, 7, 8], [5, 5, 6], [7, 6, 7], [6, 4, 7], [8, 7, 9], [4, 4, 6], [7, 5, 7], [6, 6, 8], [7, 6, 8], [5, 3, 6]].map((r, i) => ['NFT', 'Deep-water culture', 'Soil-grown'].map((s, j) => `J${String(i + 1).padStart(2, '0')}\t${s}\t${r[j]}`).join('\n')).join('\n') },
  tipburn: { label: 'Tipburn by growing system (χ²)', an: 'chisq', map: { rowv: 'system', colv: '__counts' },
    note: 'Simulated teaching data. Number of heads with and without tipburn at harvest in three soilless systems (60 heads per system).',
    text: 'system\ttipburn\thealthy\nNFT\t14\t46\nDeep-water culture\t6\t54\nAeroponics\t11\t49' },
  plantgrowth: { label: 'PlantGrowth (textbook check, ANOVA)', an: 'anova', map: { y: 'weight', group: 'group' },
    note: 'Published data (Dobson 1983; the R dataset PlantGrowth): dried plant weight under a control and two treatments. Textbook answer: F(2, 27) = 4.85, p = .016; Tukey trt2 − trt1 p = .012.',
    text: long('group', 'weight', { ctrl: [4.17, 5.58, 5.18, 6.11, 4.50, 4.61, 5.17, 4.53, 5.33, 5.14], trt1: [4.81, 4.17, 4.41, 3.59, 5.87, 3.83, 6.03, 4.89, 4.32, 4.69], trt2: [6.31, 5.12, 5.54, 5.50, 5.37, 5.29, 4.92, 6.15, 5.80, 5.26] }) },
  growdemo: { label: 'Grow-log demo (repeated measurements)', an: 'anova', growlog: true,
    note: 'Simulated grow log in the course format (ffp-growlog-v1): 3 EC treatments × 5 plants measured weekly. Repeated measurements of the same plant are not independent — the workbench uses the final (harvest) row of each plant.' }
};

/* =====================================================================
   Controls
   ===================================================================== */
const ANALYSES = [
  { value: 'describe', label: 'Describe & visualise' }, { value: 'ttest', label: 't-test (one or two groups)' },
  { value: 'anova', label: 'One-way ANOVA + Tukey HSD' }, { value: 'rcbd', label: 'Randomised block ANOVA (RCBD)' },
  { value: 'regression', label: 'Linear regression' }, { value: 'correlation', label: 'Correlation (Pearson / Spearman)' },
  { value: 'chisq', label: 'χ² test of independence' }, { value: 'power', label: 'Power & sample size' }];
const ui = new Controls('#controls', { url: true });
ui.section('Analysis');
ui.select({ id: 'an', label: 'What do you want to do?', options: ANALYSES, value: 'anova' });
ui.segmented({ id: 'tt', label: 't-test type', options: [{ value: 'one', label: 'One sample' }, { value: 'welch', label: 'Welch' }, { value: 'pooled', label: 'Pooled' }, { value: 'paired', label: 'Paired' }], value: 'welch', help: 'Welch is the safe default for two independent groups; pooled assumes equal variances.' });
ui.number({ id: 'mu0', label: 'Reference value μ₀ (one-sample test)', value: 180, step: 'any' });
ui.segmented({ id: 'cor', label: 'Correlation coefficient', options: [{ value: 'pearson', label: 'Pearson r' }, { value: 'spearman', label: 'Spearman ρ' }], value: 'pearson' });
ui.segmented({ id: 'alpha', label: 'Significance level α', options: [{ value: 0.01, label: '0.01' }, { value: 0.05, label: '0.05' }, { value: 0.1, label: '0.10' }], value: 0.05, help: 'Confidence intervals use the matching level (1 − α).' });
ui.segmented({ id: 'tf', label: 'Transform the response', options: [{ value: 'none', label: 'None' }, { value: 'log', label: 'ln(y)' }, { value: 'sqrt', label: '√y' }], value: 'none', help: 'A log transform often fixes right-skewed weights and variances that grow with the mean.' });
ui.section('Power & sample size');
ui.segmented({ id: 'pwDesign', label: 'Design', options: [{ value: 'two', label: 'Two groups' }, { value: 'one', label: 'Paired / one' }, { value: 'anova', label: 'k groups' }], value: 'two' });
ui.slider({ id: 'pwDelta', label: 'Smallest difference worth detecting Δ', min: 1, max: 300, step: 1, value: 25, help: 'In the units of your response (e.g. g of fresh weight).' });
ui.slider({ id: 'pwSD', label: 'Standard deviation σ', min: 1, max: 300, step: 0.5, value: 20, help: 'Between independent units (trays/plants). Use a pilot study or the loaded data.' });
ui.slider({ id: 'pwK', label: 'Number of groups k', min: 2, max: 8, step: 1, value: 3 });
ui.slider({ id: 'pwTarget', label: 'Target power 1 − β', min: 0.5, max: 0.99, step: 0.01, value: 0.8 });
ui.slider({ id: 'pwN', label: 'Planned n per group', min: 2, max: 80, step: 1, value: 6 });
ui.button({ label: 'Use the SD of the loaded data', onClick: () => useDataSD() });
ui.section('Display');
ui.toggle({ id: 'pts', label: 'Show individual observations', value: true });
ui.toggle({ id: 'letters', label: 'Tukey letters above groups', value: true });
ui.toggle({ id: 'bands', label: 'Regression CI and prediction bands', value: true });
ui.presets([
  { label: 'LED spectra', values: { an: 'anova' }, onApply: () => loadExample('led') },
  { label: 'EC regression', values: { an: 'regression' }, onApply: () => loadExample('ec') },
  { label: 'Paired nitrate', values: { an: 'ttest', tt: 'paired' }, onApply: () => loadExample('paired') },
  { label: 'Tasting panel', values: { an: 'rcbd' }, onApply: () => loadExample('hedonic') },
  { label: 'Tipburn χ²', values: { an: 'chisq' }, onApply: () => loadExample('tipburn') },
  { label: 'Plan: n for Δ = 20 g', values: { an: 'power', pwDesign: 'two', pwDelta: 20, pwSD: 22, pwTarget: 0.8, pwN: 6 } }
], 'Examples');
let lastSummary = {};
ui.saveButton('statistics-workbench', () => lastSummary);

/* =====================================================================
   Data state, parsing and column mapping
   ===================================================================== */
let DATA = null, MAP = {}, GROWLOG = null, NOTE = '';
const ta = $('#wb-text'), mapEl = $('#wb-map'), prevEl = $('#wb-preview'), noteEl = $('#wb-note');
const exSel = $('#wb-example');
exSel.innerHTML = '<option value="">Load an example dataset…</option>' + Object.entries(EX).map(([k, e]) => `<option value="${k}">${esc(e.label)}</option>`).join('');
exSel.addEventListener('change', () => { if (exSel.value) { loadExample(exSel.value, true); } });
$('#wb-analyse').addEventListener('click', () => { NOTE = ''; parse(true); });
$('#wb-clear').addEventListener('click', () => { ta.value = ''; NOTE = ''; GROWLOG = null; parse(true); ta.focus(); });
$('#wb-growlog').addEventListener('click', () => loadGrowLog());
$('#wb-download').addEventListener('click', () => { if (DATA && DATA.headers.length) downloadCSV('workbench-data.csv', DATA.headers, DATA.rows.map(r => r.map(v => v == null || (typeof v === 'number' && !isFinite(v)) ? '' : v))); });
$('#wb-copy').addEventListener('click', () => { const t = $('#wb-apa').innerText.trim(); if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => window.FFP && FFP.toast && FFP.toast('Report sentence copied')); });
const glRows = $('#wb-gl-rows');
glRows.addEventListener('change', () => { if (GROWLOG) growLogToText(true); });
let typeT = null; ta.addEventListener('input', () => { clearTimeout(typeT); typeT = setTimeout(() => { NOTE = ''; parse(true); }, 600); });

function loadExample(key, setAnalysis = false) {
  const e = EX[key]; exSel.value = key;
  if (e.growlog) { GROWLOG = growLogDemo(); NOTE = e.note; $('#wb-gl-bar').hidden = false; glRows.value = 'final'; growLogToText(); if (setAnalysis) ui.set('an', e.an); return; }
  GROWLOG = null; $('#wb-gl-bar').hidden = true;
  ta.value = e.text; NOTE = e.note;
  if (setAnalysis) { ui.set('an', e.an, true); ui.set('tt', e.tt || 'welch', true); }
  parse(false, e.map);
  schedule();
}
function loadGrowLog() {
  let gl = null;
  try { gl = JSON.parse(localStorage.getItem('ffp-growlog-v1') || 'null'); } catch (e) { gl = null; }
  if (!gl || !Array.isArray(gl.rows) || !gl.rows.length) {
    noteEl.innerHTML = `<span class="wb-warn">No grow log was found in this browser.</span> Record your measurements in the <a href="/project/grow-log/">Grow log (data tool)</a> first — or try the <em>Grow-log demo</em> example to see how it works.`;
    return;
  }
  GROWLOG = gl; exSel.value = ''; NOTE = `Your grow log${gl.meta && (gl.meta.group || gl.meta.crop) ? ' (' + esc([gl.meta.group, gl.meta.crop, gl.meta.system].filter(Boolean).join(' · ')) + ')' : ''}: ${gl.rows.length} rows.`;
  $('#wb-gl-bar').hidden = false; glRows.value = 'final'; growLogToText();
  if (ui.get('an') === 'power') ui.set('an', 'anova');
}
const GL_COLS = ['date', 'day', 'plant', 'treatment', 'fw_g', 'leaves', 'area_cm2', 'height_cm', 'ec', 'ph', 't_water', 'do_mgl', 'ppfd', 'notes'];
function growLogToText(keepMap = false) {
  let rows = GROWLOG.rows.slice();
  if (glRows.value === 'final') {
    const last = new Map(); rows.forEach(r => { const k = r.plant ?? ''; const p = last.get(k); if (!p || (+r.day || 0) >= (+p.day || 0)) last.set(k, r); });
    rows = [...last.values()];
  }
  const cell = v => v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' ');
  // experimental unit and block come from the plant list of the grow log (meta.plants), when the student defined them
  const plants = new Map(((GROWLOG.meta && GROWLOG.meta.plants) || []).map(p => [String(p.id), p]));
  const info = r => plants.get(String(r.plant ?? '')) || {};
  const hasBlock = rows.some(r => (r.block ?? info(r).block ?? '') !== '');
  const cols = hasBlock ? [...GL_COLS.slice(0, 4), 'unit', 'block', ...GL_COLS.slice(4)] : GL_COLS;
  const val = (r, c) => c === 'block' ? (r.block ?? info(r).block) : c === 'unit' ? (r.unit ?? info(r).unit) : r[c];
  ta.value = cols.join('\t') + '\n' + rows.map(r => cols.map(c => cell(val(r, c))).join('\t')).join('\n');
  const hasFW = rows.some(r => r.fw_g !== '' && r.fw_g != null && isFinite(+r.fw_g));
  // switching between "final row" and "all rows" keeps the variables the student has chosen
  const keep = f => keepMap && MAP[f] && cols.includes(MAP[f]) ? MAP[f] : null;
  parse(false, { y: keep('y') || (hasFW ? 'fw_g' : 'area_cm2'), group: keep('group') || 'treatment', x: keep('x') || 'ec', block: keep('block') || (hasBlock ? 'block' : '') });
  if (hasBlock && !keepMap && ui.get('an') === 'anova') ui.set('an', 'rcbd'); // blocks recorded → analyse them
  schedule();
}

const isNumCol = h => DATA && DATA.types[h] === 'number';
const levelsOf = arr => { const out = []; const s = new Set(); arr.forEach(v => { if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return; if (!s.has(v)) { s.add(v); out.push(v); } }); return out; };
const ID_LIKE = /^(id|unit|plant|panel|panellist|panelist|subject|judge|block|rep|replicate|tray|shelf|date|day|notes?)$/i;
function numericCols() { return DATA.headers.filter(h => isNumCol(h) && !/^(day|date)$/i.test(h)); }
function groupCandidates() { return DATA.headers.filter(h => !isNumCol(h) ? levelsOf(DATA.columns[h]).length >= 2 && levelsOf(DATA.columns[h]).length <= 20 : levelsOf(DATA.columns[h]).length >= 2 && levelsOf(DATA.columns[h]).length <= 10); }

function parse(auto = true, map = null) {
  DATA = X.parseData(ta.value);
  if (!DATA.headers.length) { MAP = {}; buildMapUI(); preview(); schedule(); return; }
  autoMap(map); buildMapUI(); preview(); if (auto) schedule();
}
function autoMap(pref) {
  const H = DATA.headers, nums = numericCols(), txt = H.filter(h => !isNumCol(h));
  const pick = (cands, re) => cands.find(h => re.test(h));
  const m = {};
  m.y = pick(nums, /^(fw|fresh|weight|yield|mass|liking|score|y)/i) || nums.filter(h => !ID_LIKE.test(h)).slice(-1)[0] || nums[0] || '';
  const gc = groupCandidates().filter(h => h !== m.y);
  m.group = pick(gc, /^(treat|trt|group|spectrum|sample|system|cultivar|variety|ec_level|condition)/i) || gc.find(h => !isNumCol(h) && !ID_LIKE.test(h)) || (nums.length >= 2 && !txt.length ? '__cols' : '');
  m.block = pick(H.filter(h => h !== m.group && h !== m.y), /^(block|panel|panellist|panelist|judge|subject|shelf|rep|replicate)/i) || '';
  m.x = pick(nums.filter(h => h !== m.y), /^(ec|x|dose|ppfd|dli|temp|t_)/i) || nums.find(h => h !== m.y) || '';
  m.a = nums[0] || ''; m.b = nums[1] || nums[0] || '';
  m.rowv = txt[0] || ''; m.colv = txt.length >= 2 ? txt[1] : '__counts';
  Object.assign(m, pref || {});
  // validate
  Object.keys(m).forEach(k => { if (m[k] && m[k] !== '__cols' && m[k] !== '__counts' && !H.includes(m[k])) m[k] = ''; });
  MAP = m;
  const lv = MAP.group && MAP.group !== '__cols' ? levelsOf(DATA.columns[MAP.group]).map(String) : (MAP.group === '__cols' ? numericCols() : []);
  MAP.lvlA = lv[0] || ''; MAP.lvlB = lv[lv.length - 1] || '';
}
const FIELDS = {
  y: 'Response variable (y)', group: 'Groups / treatments', lvlA: 'Compare group', lvlB: '… with group', block: 'Blocks (e.g. panellist, shelf)',
  x: 'Predictor (x)', a: 'First measurement (before)', b: 'Second measurement (after)', rowv: 'Rows (categories)', colv: 'Columns (categories or counts)'
};
function fieldsFor(an, tt) {
  if (an === 'describe') return ['y', 'group'];
  if (an === 'ttest') return tt === 'paired' ? ['a', 'b'] : tt === 'one' ? ['y'] : ['y', 'group', 'lvlA', 'lvlB'];
  if (an === 'anova') return ['y', 'group'];
  if (an === 'rcbd') return MAP.group === '__cols' ? ['group', 'block'] : ['y', 'group', 'block'];
  if (an === 'regression' || an === 'correlation') return ['x', 'y'];
  if (an === 'chisq') return ['rowv', 'colv'];
  return ['y', 'group'];
}
function buildMapUI() {
  if (!DATA || !DATA.headers.length) { mapEl.innerHTML = '<p class="muted" style="margin:0">Paste data or load an example to choose variables.</p>'; return; }
  const an = ui.get('an'), tt = ui.get('tt'); const H = DATA.headers, nums = numericCols(), txt = H.filter(h => !isNumCol(h));
  const opts = f => {
    if (f === 'y' || f === 'x' || f === 'a' || f === 'b') return nums.map(h => [h, h]);
    if (f === 'group') return [['', '— none —'], ...groupCandidates().map(h => [h, h]), ...(nums.length >= 2 ? [['__cols', '⟨each numeric column is a group⟩']] : [])];
    if (f === 'block') return [['', '— none —'], ...H.filter(h => h !== MAP.group && h !== MAP.y && levelsOf(DATA.columns[h]).length >= 2).map(h => [h, h]), ...(MAP.group === '__cols' ? [['__rows', '⟨each row is a block⟩']] : [])];
    if (f === 'lvlA' || f === 'lvlB') { const lv = MAP.group === '__cols' ? nums : MAP.group ? levelsOf(DATA.columns[MAP.group]).map(String) : []; return lv.map(v => [v, v]); }
    if (f === 'rowv') return H.filter(h => levelsOf(DATA.columns[h]).length <= 30).map(h => [h, h]);
    if (f === 'colv') return [...H.filter(h => h !== MAP.rowv && !isNumCol(h)).map(h => [h, h]), ...(nums.length ? [['__counts', '⟨numeric columns hold counts⟩']] : [])];
    return [];
  };
  if (an === 'rcbd' && MAP.group === '__cols' && !MAP.block) MAP.block = '__rows';
  mapEl.innerHTML = fieldsFor(an, tt).map(f => `<label class="wb-sel"><span>${FIELDS[f]}</span><select data-f="${f}">${opts(f).map(([v, l]) => `<option value="${esc(v)}"${String(MAP[f] ?? '') === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`).join('')
    + (an === 'power' ? '<p class="muted" style="margin:0;font-size:.84rem">Power analysis uses the sliders on the right. Load data and press “Use the SD of the loaded data” to plan from a pilot study.</p>' : '');
  mapEl.querySelectorAll('select').forEach(s => { MAP[s.dataset.f] = s.value; s.addEventListener('change', () => {
    MAP[s.dataset.f] = s.value;
    if (s.dataset.f === 'group') { const lv = MAP.group === '__cols' ? numericCols() : MAP.group ? levelsOf(DATA.columns[MAP.group]).map(String) : []; MAP.lvlA = lv[0] || ''; MAP.lvlB = lv[lv.length - 1] || ''; buildMapUI(); }
    if (s.dataset.f === 'rowv') buildMapUI();
    schedule();
  }); });
}
function preview() {
  if (!DATA || !DATA.headers.length) { prevEl.innerHTML = ''; noteEl.innerHTML = NOTE ? `<span>${NOTE}</span>` : ''; return; }
  const n = DATA.rows.length, show = DATA.rows.slice(0, 8);
  prevEl.innerHTML = `<div class="wb-scroll"><table class="wb-table wb-prev"><thead><tr>${DATA.headers.map(h => `<th>${esc(h)}<small>${DATA.types[h] === 'number' ? 'number' : 'text'}</small></th>`).join('')}</tr></thead><tbody>${show.map(r => `<tr>${r.map(v => `<td class="${typeof v === 'number' ? 'num' : ''}">${v == null || (typeof v === 'number' && !isFinite(v)) ? '<span class="muted">NA</span>' : esc(v)}</td>`).join('')}</tr>`).join('')}${n > 8 ? `<tr><td colspan="${DATA.headers.length}" class="muted">… ${n - 8} more row(s)</td></tr>` : ''}</tbody></table></div>`;
  noteEl.innerHTML = [NOTE ? `<span>${NOTE}</span>` : '', `<span class="muted">${n} rows × ${DATA.headers.length} columns${DATA.sep ? ' · separator: ' + ({ '\t': 'tab', ';': 'semicolon', ',': 'comma', ws: 'spaces' }[DATA.sep]) : ''}.</span>`, ...DATA.notes.map(t => `<span class="muted">${esc(t)}</span>`)].filter(Boolean).join(' ');
}

/* =====================================================================
   Helpers: variable names, units, transforms
   ===================================================================== */
const NAMES = { fw_g: 'fresh weight', weight: 'weight', area_cm2: 'leaf area', height_cm: 'plant height', leaves: 'leaf number', liking: 'liking', ec: 'EC', ec_mS_cm: 'EC', ph: 'pH', t_water: 'water temperature', do_mgl: 'dissolved oxygen', ppfd: 'PPFD', nitrate_before: 'nitrate (before)', nitrate_after: 'nitrate (after)' };
const UNITS = [[/_g$/, 'g'], [/_cm2$/, 'cm²'], [/_mS_cm$/i, 'mS cm⁻¹'], [/_cm$/, 'cm'], [/_mgl$/, 'mg L⁻¹'], [/^ec$/i, 'mS cm⁻¹'], [/^ppfd$/i, 'µmol m⁻² s⁻¹'], [/^t_water$/, '°C'], [/^nitrate/, 'mg kg⁻¹']];
const vname = h => NAMES[h] || String(h || 'value').replace(/_(g|cm2|cm|mgl|mS_cm)$/i, '').replace(/_/g, ' ');
const vunitRaw = h => { for (const [re, u] of UNITS) if (re.test(h || '')) return u; return ''; };
const tfName = () => ({ none: '', log: 'ln', sqrt: '√' }[ui.get('tf')]);
const vunit = h => ui.get('tf') === 'none' ? vunitRaw(h) : `${tfName()}(${vunitRaw(h) || 'y'})`;
function tf(v) { if (typeof v !== 'number' || !isFinite(v)) return NaN; const t = ui.get('tf'); if (t === 'log') return v > 0 ? Math.log(v) : NaN; if (t === 'sqrt') return v >= 0 ? Math.sqrt(v) : NaN; return v; }
const col = h => (DATA.columns[h] || []).map(v => typeof v === 'number' ? v : NaN);
const u = h => { const s = vunit(h); return s ? ' ' + s : ''; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const alphaV = () => +ui.get('alpha');
const confPct = () => Math.round((1 - alphaV()) * 100);

function groupData() {
  if (!DATA || !DATA.headers.length) return null;
  if (MAP.group === '__cols') { const cs = numericCols(); return { names: cs, values: cs.map(c => col(c).map(tf).filter(Number.isFinite)), label: 'Column', yname: 'value', yh: cs[0] }; }
  if (!MAP.y) return null;
  const y = col(MAP.y).map(tf);
  if (!MAP.group) return { names: [vname(MAP.y)], values: [y.filter(Number.isFinite)], label: '', yname: vname(MAP.y), yh: MAP.y };
  const g = DATA.columns[MAP.group]; const lv = levelsOf(g);
  return { names: lv.map(String), values: lv.map(L => y.filter((v, i) => g[i] === L && Number.isFinite(v))), label: vname(MAP.group), yname: vname(MAP.y), yh: MAP.y };
}

/* =====================================================================
   Statistics helpers
   ===================================================================== */
function tukey(means, ns, mse, dfe, alpha) {
  const k = means.length; const qc = S.qtukey(1 - alpha, k, dfe); const pairs = [];
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
    const diff = means[j] - means[i], se = Math.sqrt(mse / 2 * (1 / ns[i] + 1 / ns[j])), q = Math.abs(diff) / se;
    pairs.push({ i, j, diff, lwr: diff - qc * se, upr: diff + qc * se, q, p: Math.max(0, 1 - S.ptukey(q, k, dfe)) });
  }
  return { qc, pairs };
}
/** Compact letter display from pairwise p-values (sorted-means sweep). */
function letters(means, pairs, alpha) {
  const k = means.length; const ord = means.map((m, i) => i).sort((a, b) => means[b] - means[a]);
  const sig = (a, b) => { const p = pairs.find(q => (q.i === a && q.j === b) || (q.i === b && q.j === a)); return p ? p.p < alpha : false; };
  const intervals = [];
  for (let s = 0; s < k; s++) { let e = s; while (e + 1 < k && ord.slice(s, e + 2).every((a, ii, arr) => arr.every(b => a === b || !sig(a, b)))) e++; if (!intervals.some(([s0, e0]) => s0 <= s && e <= e0)) intervals.push([s, e]); }
  const out = new Array(k).fill('');
  intervals.forEach(([s0, e0], li) => { for (let q = s0; q <= e0; q++) out[ord[q]] += String.fromCharCode(97 + li); });
  return out;
}
function outlierFlags(a) { if (a.length < 4) return a.map(() => false); const q1 = S.quantile(a, 0.25), q3 = S.quantile(a, 0.75), iqr = q3 - q1; return a.map(v => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr); }
function descRow(name, a, dec) {
  const d = S.describe(a); const lvl = 1 - alphaV(); const tc = a.length > 1 ? S.tInv(1 - alphaV() / 2, a.length - 1) : NaN;
  const ci = [d.mean - tc * d.se, d.mean + tc * d.se];
  return { name, d, ci, cells: [esc(name), a.length, num(d.mean, dec), num(d.sd, dec), num(d.se, dec), `[${num(ci[0], dec)}, ${num(ci[1], dec)}]`, num(d.median, dec), `${num(d.min, dec)}–${num(d.max, dec)}`, isFinite(d.cv) ? num(100 * d.cv, 1) : '—'], lvl };
}
const DESC_HEAD = () => ['Group', 'n', 'Mean', 'SD', 'SE', `${confPct()}% CI`, 'Median', 'Range', 'CV %'];
function table(head, rows, { caption = '', numFrom = 1, cls = '' } = {}) {
  return `<div class="wb-scroll"><table class="wb-table ${cls}">${caption ? `<caption>${caption}</caption>` : ''}<thead><tr>${head.map((h, i) => `<th class="${i >= numFrom ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr${r._cls ? ` class="${r._cls}"` : ''}>${r.map((c, i) => `<td class="${i >= numFrom ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function normalityCheck(label, values, alpha) {
  const valid = values.filter(Number.isFinite);
  if (valid.length < 3) return { status: 'info', title: `Normality (${label})`, text: 'Fewer than 3 values — normality cannot be checked. With so few observations, rely on knowledge of the variable and on the design.' };
  const sw = X.shapiroWilk(valid);
  if (!isFinite(sw.W)) return { status: 'warn', title: `Normality (${label})`, text: 'All values are identical — no variation to test.' };
  const small = valid.length < 8;
  if (sw.p < alpha) return { status: 'warn', title: `Normality (${label})`, text: `Shapiro–Wilk W = ${num(sw.W, 3)}, ${apaP(sw.p)}: the values look non-normal. Look at the QQ plot: curved points mean skew (try ln(y)), single far-off points mean outliers. The rank-based alternative below does not assume normality.` };
  return { status: 'ok', title: `Normality (${label})`, text: `Shapiro–Wilk W = ${num(sw.W, 3)}, ${apaP(sw.p)}: no evidence against normality.${small ? ' With fewer than 8 values this test has little power — a non-significant result is weak reassurance.' : ''}` };
}
function independenceCheck(extra = '') {
  if (GROWLOG && glRows.value === 'all') return { status: 'bad', title: 'Independence — pseudo-replication!', text: 'You are analysing <b>all rows</b> of the grow log: each plant appears once per measurement day, so n counts measurements, not plants. Repeated measurements of the same plant are not independent, so the error degrees of freedom are inflated and the p-value is too optimistic. Use <em>Final (harvest) row of each plant</em>, or first summarise each plant (e.g. its growth rate) and analyse one value per plant.' };
  return { status: 'info', title: 'Independence (design, not data)', text: `Each value must come from a separate experimental unit — the thing you randomised the treatment to. Plants sharing one tray, reservoir or light compartment are <em>not</em> independent: average them to one value per unit, or you commit pseudo-replication (see the <a href="/laboratories/experiment-designer/">Experiment designer</a>).${extra}` };
}
function outlierCheck(names, values) {
  const flagged = []; values.forEach((a, i) => { const f = outlierFlags(a); a.forEach((v, j) => { if (f[j]) flagged.push(`${v.toPrecision(4)} (${names[i]})`); }); });
  return flagged.length ? { status: 'warn', title: 'Outliers', text: `${flagged.length} value(s) beyond 1.5 × IQR from the quartiles: ${esc(flagged.slice(0, 6).join(', '))}${flagged.length > 6 ? ' …' : ''}. Check them in your notebook — a typing error? a dead plant? Never delete a value only because it is inconvenient; report analyses with and without it if in doubt.` }
    : { status: 'ok', title: 'Outliers', text: 'No values beyond 1.5 × IQR from the quartiles (Tukey fences).' };
}
function sizeCheck(ns) {
  const mn = Math.min(...ns), mx = Math.max(...ns);
  if (mn < 3) return { status: 'bad', title: 'Sample size', text: `A group has only ${mn} observation(s). Inference needs at least 3 per group — and power is very low below about 5.` };
  if (mn < 5) return { status: 'warn', title: 'Sample size', text: `Smallest group n = ${mn}. Tests work, but power is low and assumption checks are nearly blind. Plan more replicates with the power calculator.` };
  if (mx > 1.5 * mn) return { status: 'warn', title: 'Balance', text: `Unequal group sizes (${mn}–${mx}). Methods here handle this, but unequal n makes tests more sensitive to unequal variances.` };
  return { status: 'ok', title: 'Sample size', text: `n = ${mn === mx ? mn : mn + '–' + mx} per group.` };
}

/* =====================================================================
   Analyses — each returns a result object for the renderers
   ===================================================================== */
function runDescribe() {
  const G = groupData(); if (!G || !G.values.some(a => a.length)) return empty('Choose a numeric response variable.');
  const all = G.values.flat(); const dec = X.decimalsFor(S.sd(all));
  const rows = G.names.map((n, i) => descRow(n, G.values[i], dec)).filter(r => r.d.n);
  const uu = u(G.yh);
  const sent = rows.map(r => `${r.d.n > 0 ? `${G.names.length > 1 ? esc(r.name) + ': ' : ''}M = ${num(r.d.mean, dec)}${uu}, SD = ${num(r.d.sd, dec)}, n = ${r.d.n}` : ''}`).join('; ');
  const apa = `${cap(G.yname)} ${G.names.length > 1 ? 'by ' + esc(G.label || 'group') : ''} (mean ± SD): ${sent}. Error bars in the figure show ${confPct()}% confidence intervals of the mean.`;
  const checks = [...G.values.map((a, i) => normalityCheck(G.names[i], a, alphaV())), outlierCheck(G.names, G.values)];
  const sk = rows.map(r => r.d.skew).filter(Number.isFinite);
  if (sk.some(s => s > 1)) checks.push({ status: 'warn', title: 'Skewness', text: 'Right-skewed data (skewness > 1): the median describes the typical plant better than the mean; consider ln(y).' });
  return { title: 'Descriptive statistics', kind: 'groups', G, dec, apa, checks,
    tables: [table(DESC_HEAD(), rows.map(r => r.cells), { caption: `Descriptive statistics of ${esc(G.yname)}${uu ? ' (' + vunit(G.yh) + ')' : ''}` })],
    ro: [['n (total)', all.length, '', 0], ['Grand mean', S.mean(all), vunit(G.yh), dec], ['Pooled SD', Math.sqrt(S.anova1(G.values.filter(a => a.length > 1)).msw || S.variance(all)), vunit(G.yh), dec], ['Groups', G.names.length, '', 0]],
    hud: `${all.length} observations · ${G.names.length} group(s)`, charts: 'groups' };
}
function empty(msg) { return { title: 'Nothing to analyse yet', kind: 'none', apa: msg, checks: [], tables: [], ro: [], hud: msg, charts: 'none' }; }

function runT() {
  const tt = ui.get('tt'), a = alphaV();
  if (tt === 'paired') return runPaired();
  const G = groupData(); if (!G) return empty('Choose a response variable.');
  if (tt === 'one') {
    const y = MAP.group === '__cols' ? G.values[0] : col(MAP.y).map(tf).filter(Number.isFinite);
    if (y.length < 2) return empty('Need at least two values.');
    const mu0 = tf(+ui.get('mu0')); const r = S.tTestOne(y, mu0); const dec = X.decimalsFor(S.sd(y)); const tc = S.tInv(1 - a / 2, r.df);
    const ci = [r.diff - tc * r.se, r.diff + tc * r.se]; const w = X.wilcoxonSigned(y.map(v => v - mu0)); const uu = u(G.yh);
    const dir = r.p < a ? (r.diff > 0 ? 'was significantly higher than' : 'was significantly lower than') : 'did not differ significantly from';
    const apa = `The mean ${esc(G.yname)} (M = ${num(S.mean(y), dec)}${uu}, SD = ${num(S.sd(y), dec)}, n = ${y.length}) ${dir} the reference value of ${num(mu0, dec)}${uu}, t(${r.df}) = ${num(r.t)}, ${apaP(r.p)}, d = ${num(r.d)}. The mean difference was ${num(r.diff, dec)}${uu}, ${confPct()}% CI [${num(ci[0], dec)}, ${num(ci[1], dec)}].`;
    return { title: 'One-sample t-test', kind: 'groups', G: { names: [G.yname], values: [y], label: '', yname: G.yname, yh: G.yh }, mu0, dec, apa,
      checks: [independenceCheck(), normalityCheck('values', y, a), outlierCheck(['values'], [y]), { status: 'info', title: 'Robust alternative', text: `Wilcoxon signed-rank test against ${num(mu0, dec)}: V = ${num(w.V, 1)}, ${apaP(w.p)}${w.exact ? ' (exact)' : ' (normal approximation)'}.` }],
      tables: [table(['Test', 'Mean', `Difference`, `${confPct()}% CI`, 't', 'df', 'p', 'd'], [['One-sample t', num(S.mean(y), dec), num(r.diff, dec), `[${num(ci[0], dec)}, ${num(ci[1], dec)}]`, num(r.t), r.df, apaP(r.p).replace('p ', ''), num(r.d)]])],
      ro: [['t statistic', r.t, `df ${r.df}`, 2], ['p-value', r.p, 'two-sided', 4], ['Mean − μ₀', r.diff, vunit(G.yh), dec], ["Cohen's d", r.d, '', 2]],
      hud: `t(${r.df}) = ${num(r.t)}, ${apaP(r.p)}`, charts: 'groups', diff: { est: r.diff, ci, label: 'Mean − μ₀' } };
  }
  // two independent groups
  let names = G.names, vals = G.values;
  if (names.length < 2) return empty('Choose a grouping variable with at least two groups (or ⟨each numeric column is a group⟩).');
  let ia = names.indexOf(MAP.lvlA), ib = names.indexOf(MAP.lvlB); if (ia < 0) ia = 0; if (ib < 0 || ib === ia) ib = ia === names.length - 1 ? 0 : names.length - 1;
  const A = vals[ia], B = vals[ib], nA = names[ia], nB = names[ib];
  if (A.length < 2 || B.length < 2) return empty('Each group needs at least two values.');
  const r = tt === 'pooled' ? S.tTestPooled(B, A) : S.tTestWelch(B, A);
  const dec = X.decimalsFor(Math.max(S.sd(A), S.sd(B))); const tc = S.tInv(1 - a / 2, r.df); const ci = [r.diff - tc * r.se, r.diff + tc * r.se];
  const g = r.d * X.hedgesJ(A.length + B.length - 2); const dci = X.dCI(r.d, A.length, B.length, 1 - a); const mw = X.mannWhitney(B, A); const bf = S.leveneBF([A, B]);
  const vr = Math.max(S.variance(A), S.variance(B)) / Math.min(S.variance(A), S.variance(B)); const uu = u(G.yh);
  const MA = `M = ${num(S.mean(A), dec)}${uu}, SD = ${num(S.sd(A), dec)}, n = ${A.length}`, MB = `M = ${num(S.mean(B), dec)}${uu}, SD = ${num(S.sd(B), dec)}, n = ${B.length}`;
  const test = tt === 'pooled' ? "Student's (pooled-variance) t-test" : "Welch's t-test";
  const sigTxt = r.p < a ? `was ${r.diff > 0 ? 'higher' : 'lower'} under ${esc(nB)} (${MB}) than under ${esc(nA)} (${MA})` : `did not differ significantly between ${esc(nB)} (${MB}) and ${esc(nA)} (${MA})`;
  const apa = `${test} showed that ${esc(G.yname)} ${sigTxt}, t(${dfs(r.df)}) = ${num(r.t)}, ${apaP(r.p)}, d = ${num(r.d)}, ${confPct()}% CI [${num(dci[0])}, ${num(dci[1])}]. The mean difference (${esc(nB)} − ${esc(nA)}) was ${num(r.diff, dec)}${uu}, ${confPct()}% CI [${num(ci[0], dec)}, ${num(ci[1], dec)}].`;
  const checks = [independenceCheck(), normalityCheck(nA, A, a), normalityCheck(nB, B, a),
    tt === 'pooled' ? (bf.p < a || vr > 4 ? { status: 'bad', title: 'Equal variances (required by the pooled test)', text: `Variance ratio ${num(vr, 1)}, Brown–Forsythe F(${bf.df1}, ${bf.df2}) = ${num(bf.F)}, ${apaP(bf.p)}. The pooled test is unreliable here — switch to Welch.` } : { status: 'ok', title: 'Equal variances', text: `Variance ratio ${num(vr, 1)}; Brown–Forsythe F(${bf.df1}, ${bf.df2}) = ${num(bf.F)}, ${apaP(bf.p)}.` })
      : { status: 'ok', title: 'Equal variances (not required by Welch)', text: `Welch's test does not assume equal variances (variance ratio ${num(vr, 1)}; Brown–Forsythe ${apaP(bf.p)}).` },
    outlierCheck([nA, nB], [A, B]), sizeCheck([A.length, B.length]),
    { status: 'info', title: 'Robust alternative', text: `Wilcoxon rank-sum (Mann–Whitney) test: W = ${num(mw.W, 1)}, ${apaP(mw.p)}${mw.exact ? ' (exact)' : ' (normal approximation, ties corrected)'}; rank-biserial r = ${nlz(-mw.rbc)}.` }];
  if (names.length > 2) checks.push({ status: 'warn', title: 'More than two groups', text: `Your data have ${names.length} groups. Running several t-tests inflates the false-positive rate — use one-way ANOVA with Tukey HSD instead.` });
  return { title: test, kind: 'groups', G: { names: [nA, nB], values: [A, B], label: G.label, yname: G.yname, yh: G.yh }, dec, apa, checks,
    tables: [table(DESC_HEAD(), [descRow(nA, A, dec).cells, descRow(nB, B, dec).cells], { caption: 'Groups compared' }),
      table(['Test', 'Difference', `${confPct()}% CI`, 't', 'df', 'p', "Cohen's d", "Hedges' g"], [[test.replace("'s t-test", ''), num(r.diff, dec), `[${num(ci[0], dec)}, ${num(ci[1], dec)}]`, num(r.t), dfs(r.df), apaP(r.p).replace('p ', ''), num(r.d), num(g)]])],
    ro: [['t statistic', r.t, `df ${dfs(r.df)}`, 2], ['p-value', r.p, 'two-sided', 4], [`Difference (${nB} − ${nA})`, r.diff, vunit(G.yh), dec], ["Cohen's d", r.d, '', 2], ['Variance ratio', vr, '', 2, vr > 4 ? 'warn' : 'ok']],
    hud: `t(${dfs(r.df)}) = ${num(r.t)}, ${apaP(r.p)}`, charts: 'groups', diff: { est: r.diff, ci, label: `${nB} − ${nA}` } };
}
function runPaired() {
  if (!MAP.a || !MAP.b || MAP.a === MAP.b) return empty('Choose two different numeric columns measured on the same units (e.g. before and after).');
  const A0 = col(MAP.a).map(tf), B0 = col(MAP.b).map(tf); const keep = A0.map((v, i) => Number.isFinite(v) && Number.isFinite(B0[i]));
  const A = A0.filter((_, i) => keep[i]), B = B0.filter((_, i) => keep[i]); const D = B.map((v, i) => v - A[i]); const a = alphaV();
  if (D.length < 2) return empty('Need at least two complete pairs.');
  const r = S.tTestPaired(B, A); const tc = S.tInv(1 - a / 2, r.df); const ci = [r.diff - tc * r.se, r.diff + tc * r.se]; const dec = X.decimalsFor(S.sd(D));
  const w = X.wilcoxonSigned(D); const uu = u(MAP.a); const nA = vname(MAP.a), nB = vname(MAP.b);
  const ch = r.p < a ? `changed significantly` : 'did not change significantly';
  const apa = `A paired t-test showed that the value ${ch} from the first measurement (${esc(nA)}: M = ${num(S.mean(A), dec)}${uu}, SD = ${num(S.sd(A), dec)}) to the second (${esc(nB)}: M = ${num(S.mean(B), dec)}${uu}, SD = ${num(S.sd(B), dec)}), t(${r.df}) = ${num(r.t)}, ${apaP(r.p)}, d<sub>z</sub> = ${num(r.d)}. The mean change was ${num(r.diff, dec)}${uu}, ${confPct()}% CI [${num(ci[0], dec)}, ${num(ci[1], dec)}] (n = ${D.length} pairs).`;
  const rr = S.pearson(A, B).r;
  const checks = [{ status: 'info', title: 'Pairing', text: `Each row must be the same unit measured twice. Correlation between the two measurements r = ${nlz(rr)} — ${rr > 0.3 ? 'pairing removes much of the between-plant variation, which is why the paired test is more powerful here' : 'weak: pairing gains little'}.` },
    normalityCheck('differences', D, a), outlierCheck(['differences'], [D]), sizeCheck([D.length]),
    { status: 'info', title: 'Robust alternative', text: `Wilcoxon signed-rank test: V = ${num(w.V, 1)}, ${apaP(w.p)}${w.exact ? ' (exact)' : ' (normal approximation)'}${w.zeros ? `; ${w.zeros} zero difference(s) dropped` : ''}.` }];
  return { title: 'Paired t-test', kind: 'paired', A, B, D, nA, nB, dec, yh: MAP.a, apa, checks,
    tables: [table(['Measurement', 'n', 'Mean', 'SD'], [[esc(nA), A.length, num(S.mean(A), dec), num(S.sd(A), dec)], [esc(nB), B.length, num(S.mean(B), dec), num(S.sd(B), dec)], ['Difference (2nd − 1st)', D.length, num(r.diff, dec), num(S.sd(D), dec)]]),
      table(['Test', 'Mean change', `${confPct()}% CI`, 't', 'df', 'p', 'd_z'], [['Paired t', num(r.diff, dec), `[${num(ci[0], dec)}, ${num(ci[1], dec)}]`, num(r.t), r.df, apaP(r.p).replace('p ', ''), num(r.d)]])],
    ro: [['t statistic', r.t, `df ${r.df}`, 2], ['p-value', r.p, 'two-sided', 4], ['Mean change', r.diff, vunit(MAP.a), dec], ['Effect size d_z', r.d, '', 2], ['Pairs', D.length, '', 0]],
    hud: `paired t(${r.df}) = ${num(r.t)}, ${apaP(r.p)}`, charts: 'paired', diff: { est: r.diff, ci, label: 'Mean change' } };
}
function runAnova() {
  const G = groupData(); if (!G) return empty('Choose a response and a grouping variable.');
  const keep = G.values.map(a => a.length > 0); const names = G.names.filter((_, i) => keep[i]), vals = G.values.filter((_, i) => keep[i]);
  if (vals.length < 2) return empty('ANOVA needs at least two groups — choose a grouping variable.');
  if (vals.some(v => v.length < 2)) return empty('Every group needs at least two observations.');
  const a = alphaV(); const A = S.anova1(vals); const dec = X.decimalsFor(Math.sqrt(A.msw)); const T = tukey(A.means, A.ns, A.msw, A.df2, a);
  const L = letters(A.means, T.pairs, a); const bf = S.leveneBF(vals); const wa = X.welchAnova(vals); const kw = X.kruskalWallis(vals);
  const resid = vals.flatMap((g, i) => g.map(v => v - A.means[i])); const omega2 = (A.ssb - A.df1 * A.msw) / (A.sst + A.msw);
  const sds = vals.map(v => S.sd(v)); const vr = Math.max(...sds) ** 2 / Math.min(...sds) ** 2; const uu = u(G.yh);
  const sigPairs = T.pairs.filter(p => p.p < a).sort((p, q) => Math.abs(q.diff) - Math.abs(p.diff));
  const pairTxt = p => { const hi = p.diff > 0 ? p.j : p.i, lo = p.diff > 0 ? p.i : p.j; const ci = p.diff > 0 ? [p.lwr, p.upr] : [-p.upr, -p.lwr]; return `${esc(names[hi])} > ${esc(names[lo])} (difference ${num(Math.abs(p.diff), dec)}${uu}, ${confPct()}% CI [${num(ci[0], dec)}, ${num(ci[1], dec)}], ${apaP(p.p)})`; };
  let apa = A.p < a ? `A one-way ANOVA showed that ${esc(G.yname)} differed significantly with ${esc(G.label || 'group')}, F(${A.df1}, ${A.df2}) = ${num(A.F)}, ${apaP(A.p)}, η² = ${nlz(A.eta2)}.`
    : `A one-way ANOVA found no significant effect of ${esc(G.label || 'group')} on ${esc(G.yname)}, F(${A.df1}, ${A.df2}) = ${num(A.F)}, ${apaP(A.p)}, η² = ${nlz(A.eta2)}.`;
  apa += ' Group means (SD): ' + names.map((n, i) => `${esc(n)} ${num(A.means[i], dec)} (${num(sds[i], dec)})`).join(', ') + (uu ? `${uu}` : '') + '.';
  if (A.p < a && names.length > 2) apa += sigPairs.length ? ` Tukey's HSD post-hoc comparisons showed ${sigPairs.map(pairTxt).join('; ')}${T.pairs.length > sigPairs.length ? '; the other pairs did not differ significantly' : ''}.` : " No pair differed significantly in Tukey's HSD test.";
  const checks = [independenceCheck(), normalityCheck('residuals', resid, a),
    bf.p < a || vr > 4 ? { status: 'warn', title: 'Equal variances', text: `Largest/smallest variance = ${num(vr, 1)}; Brown–Forsythe F(${bf.df1}, ${bf.df2}) = ${num(bf.F)}, ${apaP(bf.p)}. Variances differ — report Welch's ANOVA: F(${wa.df1}, ${dfs(wa.df2)}) = ${num(wa.F)}, ${apaP(wa.p)}.` }
      : { status: 'ok', title: 'Equal variances', text: `Brown–Forsythe F(${bf.df1}, ${bf.df2}) = ${num(bf.F)}, ${apaP(bf.p)}; largest/smallest variance = ${num(vr, 1)} (rule of thumb: below 4 is fine). Welch's ANOVA agrees: F(${wa.df1}, ${dfs(wa.df2)}) = ${num(wa.F)}, ${apaP(wa.p)}.` },
    outlierCheck(names, vals), sizeCheck(A.ns),
    { status: 'info', title: 'Robust alternative', text: `Kruskal–Wallis rank-sum test: H(${kw.df}) = ${num(kw.H)}, ${apaP(kw.p)}, ε² = ${nlz(kw.epsilon2)}.` }];
  const anovaRows = [['Between groups', A.df1, num(A.ssb, 2), num(A.msb, 2), num(A.F), apaP(A.p).replace('p ', '')], ['Within groups (error)', A.df2, num(A.ssw, 2), num(A.msw, 2), '', ''], ['Total', A.N - 1, num(A.sst, 2), '', '', '']];
  const tk = T.pairs.map(p => [`${esc(names[p.j])} − ${esc(names[p.i])}`, num(p.diff, dec), `[${num(p.lwr, dec)}, ${num(p.upr, dec)}]`, num(p.q), apaP(p.p).replace('p ', '')].map((c, i) => i === 4 && p.p < a ? `<b>${c}</b>` : c));
  return { title: 'One-way ANOVA', kind: 'groups', G: { names, values: vals, label: G.label, yname: G.yname, yh: G.yh }, dec, letters: L, apa, checks, tukey: T, anova: A,
    tables: [table(['Source', 'df', 'SS', 'MS', 'F', 'p'], anovaRows, { caption: `ANOVA table · η² = ${nlz(A.eta2, 3)} · ω² = ${nlz(omega2, 3)}` }),
      table((h => [h[0], 'Tukey', ...h.slice(1)])(DESC_HEAD()), names.map((n, i) => { const c = descRow(n, vals[i], dec).cells; return [c[0], `<b>${L[i]}</b>`, ...c.slice(1)]; }), { caption: 'Group means (groups sharing a letter do not differ significantly)' }),
      table(['Comparison', 'Difference', `${confPct()}% family-wise CI`, 'q', 'p adj.'], tk, { caption: `Tukey HSD (q crit = ${num(T.qc, 3)}, df = ${A.df2})` })],
    ro: [['F statistic', A.F, `df ${A.df1}, ${A.df2}`, 2], ['p-value', A.p, '', 4], ['η² (effect size)', A.eta2, '', 3], ['Residual SD', Math.sqrt(A.msw), vunit(G.yh), dec], ['Brown–Forsythe p', bf.p, 'equal variances', 3, bf.p < a ? 'warn' : 'ok']],
    hud: `F(${A.df1}, ${A.df2}) = ${num(A.F)}, ${apaP(A.p)}, η² = ${nlz(A.eta2)}`, charts: 'anova', resid };
}
function blockMatrix() {
  if (MAP.group === '__cols') {
    const cs = numericCols().filter(c => c !== MAP.block); const lab = MAP.block && MAP.block !== '__rows' ? DATA.columns[MAP.block] : null;
    const rows = []; const blocks = [];
    DATA.rows.forEach((_, i) => { const r = cs.map(c => tf(DATA.columns[c][i])); if (r.every(Number.isFinite)) { rows.push(r); blocks.push(lab ? String(lab[i]) : 'row ' + (i + 1)); } });
    return { m: rows, trts: cs, blocks, dropped: DATA.rows.length - rows.length };
  }
  if (!MAP.y || !MAP.group || !MAP.block) return null;
  const y = col(MAP.y).map(tf), g = DATA.columns[MAP.group], b = DATA.columns[MAP.block]; const trts = levelsOf(g), blks = levelsOf(b);
  const m = [], blocks = []; let dropped = 0, dup = 0;
  blks.forEach(B => { const row = trts.map(T => { const v = y.filter((_, i) => b[i] === B && g[i] === T && Number.isFinite(y[i])); if (v.length > 1) dup++; return v.length ? S.mean(v) : NaN; }); if (row.every(Number.isFinite)) { m.push(row); blocks.push(String(B)); } else dropped++; });
  return { m, trts: trts.map(String), blocks, dropped, dup };
}
function runRCBD() {
  const M = blockMatrix(); if (!M) return empty('Choose the response, the treatment variable and the block variable.');
  if (M.m.length < 2 || M.trts.length < 2) return empty('Need at least two complete blocks and two treatments.');
  const a = alphaV(); const R = S.anovaRCBD(M.m); const b = M.m.length, t = M.trts.length; const dec = X.decimalsFor(Math.sqrt(R.error.ms));
  const T = tukey(R.tMeans, new Array(t).fill(b), R.error.ms, R.error.df, a); const L = letters(R.tMeans, T.pairs, a);
  const fr = X.friedman(M.m); const cols = M.trts.map((_, j) => M.m.map(r => r[j])); const one = S.anova1(cols);
  const resid = []; M.m.forEach((r, i) => r.forEach((v, j) => resid.push(v - R.bMeans[i] - R.tMeans[j] + R.grandMean)));
  // Tukey's one-degree-of-freedom test for non-additivity
  let num1 = 0; M.m.forEach((r, i) => r.forEach((v, j) => { num1 += v * (R.bMeans[i] - R.grandMean) * (R.tMeans[j] - R.grandMean); }));
  const sb = R.bMeans.reduce((s, v) => s + (v - R.grandMean) ** 2, 0), st = R.tMeans.reduce((s, v) => s + (v - R.grandMean) ** 2, 0);
  const ssN = num1 * num1 / (sb * st); const dfR = R.error.df - 1; const FN = dfR > 0 ? ssN / ((R.error.ss - ssN) / dfR) : NaN; const pN = dfR > 0 ? 1 - S.fCdf(FN, 1, dfR) : NaN;
  const RE = ((b - 1) * R.block.ms + b * (t - 1) * R.error.ms) / ((b * t - 1) * R.error.ms); const pe2 = R.treatment.ss / (R.treatment.ss + R.error.ss);
  const yname = MAP.group === '__cols' ? 'the response' : vname(MAP.y); const uu = MAP.group === '__cols' ? '' : u(MAP.y);
  let apa = R.treatment.p < a ? `A randomised complete block ANOVA (${esc(MAP.block === '__rows' ? 'rows' : vname(MAP.block))} as blocks) showed that ${esc(yname)} differed among ${esc(MAP.group === '__cols' ? 'treatments' : vname(MAP.group))}, F(${R.treatment.df}, ${R.error.df}) = ${num(R.treatment.F)}, ${apaP(R.treatment.p)}, partial η² = ${nlz(pe2)}.`
    : `A randomised complete block ANOVA found no significant difference in ${esc(yname)} among treatments, F(${R.treatment.df}, ${R.error.df}) = ${num(R.treatment.F)}, ${apaP(R.treatment.p)}, partial η² = ${nlz(pe2)}.`;
  apa += ` Treatment means: ${M.trts.map((n, j) => `${esc(n)} ${num(R.tMeans[j], dec)}`).join(', ')}${uu}. Blocking was ${RE > 1.1 ? 'effective' : 'of little benefit'} (blocks F(${R.block.df}, ${R.error.df}) = ${num(R.block.F)}, ${apaP(R.block.p)}; relative efficiency ${num(RE, 2)}).`;
  const sigPairs = T.pairs.filter(p => p.p < a);
  if (R.treatment.p < a && t > 2) apa += sigPairs.length ? ` Tukey's HSD: ${sigPairs.map(p => { const hi = p.diff > 0 ? p.j : p.i, lo = p.diff > 0 ? p.i : p.j; return `${esc(M.trts[hi])} > ${esc(M.trts[lo])} (${apaP(p.p)})`; }).join('; ')}.` : '';
  const checks = [
    { status: 'info', title: 'Blocks and independence', text: `Each block (${esc(MAP.block === '__rows' ? 'row' : vname(MAP.block))}) must contain every treatment once, and treatments must be randomised within blocks. ${M.dropped ? `<b>${M.dropped} incomplete block(s) were dropped.</b> ` : ''}${M.dup ? `${M.dup} cell(s) had several values and were averaged. ` : ''}`},
    normalityCheck('residuals', resid, a),
    isFinite(pN) ? (pN < a ? { status: 'warn', title: 'Additivity (block × treatment)', text: `Tukey's one-degree-of-freedom test for non-additivity: F(1, ${dfR}) = ${num(FN)}, ${apaP(pN)}. Treatment effects seem to depend on the block level — a transformation (ln y) often helps.` } : { status: 'ok', title: 'Additivity (block × treatment)', text: `Tukey's one-degree-of-freedom test: F(1, ${dfR}) = ${num(FN)}, ${apaP(pN)} — no evidence that treatment effects change across blocks.` }) : { status: 'info', title: 'Additivity', text: 'Too few blocks to test additivity.' },
    { status: 'info', title: 'What did blocking buy?', text: `Ignoring the blocks (one-way ANOVA) would give F(${one.df1}, ${one.df2}) = ${num(one.F)}, ${apaP(one.p)}. The block design is ${num(RE, 2)} times as efficient as a completely randomised design — ${RE > 1 ? `the same precision would need about ${Math.ceil(RE * b)} replicates without blocking` : 'blocking did not help here'}.` },
    { status: 'info', title: 'Robust alternative', text: `Friedman rank test: χ²(${fr.df}) = ${num(fr.Q)}, ${apaP(fr.p)}, Kendall's W = ${nlz(fr.W)}. ${MAP.y && /liking|hedonic|score/i.test(MAP.y) ? 'Hedonic scores are ordinal; ANOVA on them is common practice, but check that Friedman agrees.' : ''}` }];
  const rows = [['Blocks', R.block.df, num(R.block.ss, 2), num(R.block.ms, 2), num(R.block.F), apaP(R.block.p).replace('p ', '')], ['Treatments', R.treatment.df, num(R.treatment.ss, 2), num(R.treatment.ms, 2), num(R.treatment.F), apaP(R.treatment.p).replace('p ', '')], ['Error', R.error.df, num(R.error.ss, 2), num(R.error.ms, 2), '', ''], ['Total', R.total.df, num(R.total.ss, 2), '', '', '']];
  return { title: 'Randomised complete block ANOVA', kind: 'groups', G: { names: M.trts, values: cols, label: MAP.group === '__cols' ? 'Treatment' : vname(MAP.group), yname, yh: MAP.y || M.trts[0] }, blocksM: M, dec, letters: L, apa, checks, tukey: T,
    tables: [table(['Source', 'df', 'SS', 'MS', 'F', 'p'], rows, { caption: `RCBD ANOVA · ${b} blocks × ${t} treatments · partial η² = ${nlz(pe2, 3)}` }),
      table(['Treatment', 'Mean', 'Tukey', 'Rank sum (Friedman)'], M.trts.map((n, j) => [esc(n), num(R.tMeans[j], dec), `<b>${L[j]}</b>`, num(fr.rankSums[j], 1)]), { caption: 'Treatment means (same letter = not significantly different)' }),
      table(['Comparison', 'Difference', `${confPct()}% family-wise CI`, 'q', 'p adj.'], T.pairs.map(p => [`${esc(M.trts[p.j])} − ${esc(M.trts[p.i])}`, num(p.diff, dec), `[${num(p.lwr, dec)}, ${num(p.upr, dec)}]`, num(p.q), apaP(p.p).replace('p ', '')]), { caption: `Tukey HSD using the block-adjusted error (MSE = ${num(R.error.ms, 3)}, df = ${R.error.df})` })],
    ro: [['Treatment F', R.treatment.F, `df ${R.treatment.df}, ${R.error.df}`, 2], ['p-value', R.treatment.p, '', 4], ['Partial η²', pe2, '', 3], ['Relative efficiency', RE, 'vs. no blocking', 2, RE > 1.1 ? 'ok' : null], ['Blocks used', b, M.dropped ? `${M.dropped} dropped` : 'complete', 0, M.dropped ? 'warn' : 'ok']],
    hud: `Treatments F(${R.treatment.df}, ${R.error.df}) = ${num(R.treatment.F)}, ${apaP(R.treatment.p)}`, charts: 'anova', resid };
}
function xyData() {
  if (!MAP.x || !MAP.y) return null; const x0 = col(MAP.x), y0 = col(MAP.y).map(tf); const k = x0.map((v, i) => Number.isFinite(v) && Number.isFinite(y0[i]));
  return { x: x0.filter((_, i) => k[i]), y: y0.filter((_, i) => k[i]) };
}
function runRegression() {
  const D = xyData(); if (!D || D.x.length < 3) return empty('Choose a numeric predictor (x) and response (y) with at least 3 complete pairs.');
  if (MAP.x === MAP.y) return empty('Choose different variables for x and y.');
  const a = alphaV(); const L = S.linreg(D.x, D.y); const n = D.x.length; const tc = S.tInv(1 - a / 2, L.df);
  const ciS = [L.slope - tc * L.seSlope, L.slope + tc * L.seSlope], ciI = [L.intercept - tc * L.seIntercept, L.intercept + tc * L.seIntercept];
  const mx = S.mean(D.x); const sxx = D.x.reduce((s, v) => s + (v - mx) ** 2, 0);
  const lev = D.x.map(v => 1 / n + (v - mx) ** 2 / sxx); const sres = L.residuals.map((e, i) => e / (L.s * Math.sqrt(1 - lev[i]))); const cook = L.residuals.map((e, i) => e * e / (2 * L.s * L.s) * lev[i] / (1 - lev[i]) ** 2);
  const bp = X.breuschPagan(D.x, L.residuals); const sw = X.shapiroWilk(L.residuals); const pF = L.pSlope; const F = L.tSlope ** 2;
  // pure-error lack-of-fit test when x values are replicated
  const byX = new Map(); D.x.forEach((v, i) => { if (!byX.has(v)) byX.set(v, []); byX.get(v).push(D.y[i]); });
  const m = byX.size; let ssPE = 0; byX.forEach(ys => { const my = S.mean(ys); ys.forEach(v => ssPE += (v - my) ** 2); }); const dfPE = n - m, dfLOF = m - 2;
  const lof = dfPE > 0 && dfLOF > 0 ? (() => { const Fl = ((L.sse - ssPE) / dfLOF) / (ssPE / dfPE); return { F: Fl, df1: dfLOF, df2: dfPE, p: 1 - S.fCdf(Fl, dfLOF, dfPE) }; })() : null;
  const decY = X.decimalsFor(L.s), decB = X.decimalsFor(L.seSlope); const yn = vname(MAP.y), xn = vname(MAP.x), uy = vunit(MAP.y), ux = vunitRaw(MAP.x);
  const perX = uy && ux ? ` ${uy} per ${ux}` : uy ? ` ${uy} per unit x` : '';
  const apa = `A simple linear regression showed that ${esc(xn)} ${pF < a ? 'significantly predicted' : 'did not significantly predict'} ${esc(yn)}, b = ${num(L.slope, decB)}${perX}, ${confPct()}% CI [${num(ciS[0], decB)}, ${num(ciS[1], decB)}], t(${L.df}) = ${num(L.tSlope)}, ${apaP(pF)}, R² = ${nlz(L.r2)} (n = ${n}). Fitted line: ${esc(yn)} = ${num(L.intercept, decY)} ${L.slope < 0 ? '−' : '+'} ${num(Math.abs(L.slope), decB)} × ${esc(xn)}.`;
  const bigCook = cook.map((c, i) => [c, i]).filter(([c]) => c > 4 / n);
  const checks = [independenceCheck(' Repeated measurements of the same plant over time are not independent — regress per-plant values (e.g. final weight) instead.'),
    lof ? (lof.p < a ? { status: 'warn', title: 'Linearity (lack-of-fit test)', text: `Replicated x values allow a pure-error test: F(${lof.df1}, ${lof.df2}) = ${num(lof.F)}, ${apaP(lof.p)}. The straight line misses a systematic pattern — look for curvature in the residual plot; a quadratic or saturating model may fit better (see the model-fitting laboratory).` } : { status: 'ok', title: 'Linearity (lack-of-fit test)', text: `Pure-error lack-of-fit F(${lof.df1}, ${lof.df2}) = ${num(lof.F)}, ${apaP(lof.p)} — no evidence of curvature. Still inspect the residuals-vs-fitted plot.` })
      : { status: 'info', title: 'Linearity', text: 'Inspect the residuals-vs-fitted plot: residuals should scatter evenly around zero with no curve. (Replicate some x values to allow a formal lack-of-fit test.)' },
    sw.p < a ? { status: 'warn', title: 'Normal residuals', text: `Shapiro–Wilk on residuals W = ${num(sw.W, 3)}, ${apaP(sw.p)}. Slope estimates are still unbiased, but CIs and p-values may be off in small samples.` } : { status: 'ok', title: 'Normal residuals', text: `Shapiro–Wilk on residuals W = ${num(sw.W, 3)}, ${apaP(sw.p)}.` },
    bp.p < a ? { status: 'warn', title: 'Constant variance', text: `Koenker–Breusch–Pagan χ²(1) = ${num(bp.LM)}, ${apaP(bp.p)}: residual spread changes with x (a funnel shape). Consider ln(y) or weighted regression.` } : { status: 'ok', title: 'Constant variance', text: `Koenker–Breusch–Pagan χ²(1) = ${num(bp.LM)}, ${apaP(bp.p)}.` },
    bigCook.length ? { status: 'warn', title: 'Influential points', text: `${bigCook.length} point(s) with Cook's distance > 4/n (${bigCook.slice(0, 4).map(([c, i]) => `x = ${D.x[i]}, D = ${num(c)}`).join('; ')}). Refit without them to see if the conclusion changes.` } : { status: 'ok', title: 'Influential points', text: `No Cook's distance above 4/n = ${num(4 / n)}.` },
    { status: 'info', title: 'Extrapolation', text: `The fit is only supported for ${esc(xn)} between ${num(Math.min(...D.x), 2)} and ${num(Math.max(...D.x), 2)}${ux ? ' ' + ux : ''}. Use the prediction band (not the confidence band) to predict an individual plant.` }];
  return { title: 'Simple linear regression', kind: 'scatter', D, L, lev, sres, cook, xn, yn, ux, uy, decY, apa, checks, lof, tc,
    tables: [table(['Term', 'Estimate', 'SE', `${confPct()}% CI`, 't', 'p'], [['Intercept', num(L.intercept, decY), num(L.seIntercept, decY), `[${num(ciI[0], decY)}, ${num(ciI[1], decY)}]`, num(L.intercept / L.seIntercept), apaP(2 * (1 - S.tCdf(Math.abs(L.intercept / L.seIntercept), L.df))).replace('p ', '')], [`Slope (${esc(xn)})`, num(L.slope, decB), num(L.seSlope, decB), `[${num(ciS[0], decB)}, ${num(ciS[1], decB)}]`, num(L.tSlope), apaP(pF).replace('p ', '')]], { caption: `Coefficients · n = ${n}` }),
      table(['Source', 'df', 'SS', 'MS', 'F', 'p'], [['Regression', 1, num(L.sst - L.sse, 2), num(L.sst - L.sse, 2), num(F), apaP(pF).replace('p ', '')], ...(lof ? [['  Lack of fit', lof.df1, num(L.sse - ssPE, 2), num((L.sse - ssPE) / lof.df1, 2), num(lof.F), apaP(lof.p).replace('p ', '')], ['  Pure error', lof.df2, num(ssPE, 2), num(ssPE / lof.df2, 2), '', '']] : []), ['Residual', L.df, num(L.sse, 2), num(L.sse / L.df, 2), '', ''], ['Total', n - 1, num(L.sst, 2), '', '', '']], { caption: `R² = ${nlz(L.r2, 3)} · residual SE s = ${num(L.s, decY)}${uy ? ' ' + uy : ''}` })],
    ro: [['Slope b', L.slope, perX.trim(), decB], ['p (slope)', pF, '', 4], ['R²', L.r2, '', 3], ['Residual SE', L.s, uy, decY], ['Lack-of-fit p', lof ? lof.p : NaN, lof ? 'pure error' : 'no replicates', 3, lof ? (lof.p < a ? 'warn' : 'ok') : null]],
    hud: `b = ${num(L.slope, decB)}, R² = ${nlz(L.r2)}, ${apaP(pF)}`, charts: 'regression' };
}
function runCorrelation() {
  const D = xyData(); if (!D || D.x.length < 4) return empty('Choose two numeric variables with at least 4 complete pairs.');
  const a = alphaV(), n = D.x.length; const P = S.pearson(D.x, D.y), R = S.spearman(D.x, D.y); const use = ui.get('cor');
  const r = use === 'pearson' ? P : R; const ci = X.corrCI(r.r, n, 1 - a); const xn = vname(MAP.x), yn = vname(MAP.y);
  const sym = use === 'pearson' ? 'r' : 'r<sub>s</sub>';
  const strength = Math.abs(r.r) >= 0.7 ? 'strong' : Math.abs(r.r) >= 0.4 ? 'moderate' : Math.abs(r.r) >= 0.1 ? 'weak' : 'negligible';
  const apa = `${use === 'pearson' ? 'Pearson' : 'Spearman rank'} correlation showed a ${r.p < a ? 'significant ' : ''}${strength} ${r.r >= 0 ? 'positive' : 'negative'} association between ${esc(xn)} and ${esc(yn)}, ${sym}(${n - 2}) = ${nlz(r.r)}, ${confPct()}% CI [${nlz(ci[0])}, ${nlz(ci[1])}], ${apaP(r.p)}${r.p < a ? '' : ' (not significant)'}. ${use === 'pearson' ? `Spearman's ρ = ${nlz(R.r)} (${apaP(R.p)}).` : `Pearson's r = ${nlz(P.r)} (${apaP(P.p)}).`} Correlation does not show that one variable causes the other.`;
  const swx = X.shapiroWilk(D.x), swy = X.shapiroWilk(D.y); const ties = new Set(D.x).size < n || new Set(D.y).size < n;
  const checks = [independenceCheck(),
    use === 'pearson' ? (swx.p < a || swy.p < a ? { status: 'warn', title: 'Normality (Pearson)', text: `Shapiro–Wilk x ${apaP(swx.p)}, y ${apaP(swy.p)}. The Pearson test assumes roughly normal variables; Spearman's ρ is the safer choice here.` } : { status: 'ok', title: 'Normality (Pearson)', text: `Shapiro–Wilk x ${apaP(swx.p)}, y ${apaP(swy.p)}.` }) : { status: 'ok', title: 'No normality needed', text: 'Spearman uses ranks: it measures any monotonic association and is robust to outliers.' },
    { status: Math.abs(P.r - R.r) > 0.15 ? 'warn' : 'ok', title: 'Linearity and outliers', text: Math.abs(P.r - R.r) > 0.15 ? `Pearson (${nlz(P.r)}) and Spearman (${nlz(R.r)}) disagree — a curved relationship or an influential outlier. Look at the scatter plot.` : `Pearson (${nlz(P.r)}) and Spearman (${nlz(R.r)}) agree.` },
    ...(use === 'spearman' && ties ? [{ status: 'info', title: 'Ties', text: 'Tied values present: the p-value uses the t approximation on mid-ranks, which is adequate for n ≥ 10.' }] : []),
    { status: 'info', title: 'Range restriction', text: 'Correlations depend on the range of x you sampled: a narrow range of EC or light gives a weaker r even when the effect is real.' }];
  return { title: use === 'pearson' ? 'Pearson correlation' : 'Spearman rank correlation', kind: 'scatter', D, corr: true, xn, yn, ux: vunitRaw(MAP.x), uy: vunit(MAP.y), apa, checks,
    tables: [table(['Coefficient', 'Estimate', `${confPct()}% CI (Fisher z)`, 't', 'df', 'p'], [['Pearson r', nlz(P.r, 3), (() => { const c = X.corrCI(P.r, n, 1 - a); return `[${nlz(c[0])}, ${nlz(c[1])}]`; })(), num(P.t), P.df, apaP(P.p).replace('p ', '')], ['Spearman ρ', nlz(R.r, 3), (() => { const c = X.corrCI(R.r, n, 1 - a); return `[${nlz(c[0])}, ${nlz(c[1])}]`; })(), num(R.t), R.df, apaP(R.p).replace('p ', '')]], { caption: `n = ${n} pairs` })],
    ro: [[use === 'pearson' ? 'Pearson r' : 'Spearman ρ', r.r, '', 3], ['p-value', r.p, '', 4], ['r²', r.r * r.r, 'shared variance', 3], ['Pairs', n, '', 0]],
    hud: `${use === 'pearson' ? 'r' : 'ρ'} = ${nlz(r.r)}, ${apaP(r.p)}`, charts: 'correlation' };
}
function contingency() {
  if (!MAP.rowv) return null;
  if (MAP.colv === '__counts') {
    const cs = numericCols(); const rl = DATA.columns[MAP.rowv]; if (!cs.length) return null;
    const rows = [], names = [];
    DATA.rows.forEach((_, i) => { const r = cs.map(c => DATA.columns[c][i]); if (r.every(v => Number.isFinite(v) && v >= 0)) { rows.push(r.map(v => Math.round(v))); names.push(String(rl[i])); } });
    return { obs: rows, rn: names, cn: cs, rlab: vname(MAP.rowv), clab: 'outcome' };
  }
  if (!MAP.colv) return null;
  const a = DATA.columns[MAP.rowv], b = DATA.columns[MAP.colv]; const rn = levelsOf(a), cn = levelsOf(b);
  const obs = rn.map(R => cn.map(C => a.filter((v, i) => v === R && b[i] === C).length));
  return { obs, rn: rn.map(String), cn: cn.map(String), rlab: vname(MAP.rowv), clab: vname(MAP.colv) };
}
function runChisq() {
  const C = contingency(); if (!C || C.obs.length < 2 || C.obs[0].length < 2) return empty('Choose two categorical variables (or one label column + count columns). Need at least a 2 × 2 table.');
  const a = alphaV(); const T = S.chiSquareTest(C.obs); const N = C.obs.flat().reduce((s, v) => s + v, 0); const rs = C.obs.map(r => r.reduce((s, v) => s + v, 0)), cs = C.obs[0].map((_, j) => C.obs.reduce((s, r) => s + r[j], 0));
  if (rs.some(v => v === 0) || cs.some(v => v === 0)) return empty('A row or column of the table sums to zero — remove empty categories.');
  const k = Math.min(C.obs.length, C.obs[0].length); const V = Math.sqrt(T.chi2 / (N * (k - 1)));
  const adj = C.obs.map((r, i) => r.map((o, j) => { const e = T.expected[i][j]; return (o - e) / Math.sqrt(e * (1 - rs[i] / N) * (1 - cs[j] / N)); }));
  const E = T.expected.flat(); const low = E.filter(e => e < 5).length; const is22 = C.obs.length === 2 && C.obs[0].length === 2; const fe = is22 ? X.fisherExact2x2(C.obs) : null;
  const apa = `A χ² test of independence ${T.p < a ? 'showed a significant association' : 'found no significant association'} between ${esc(C.rlab)} and ${esc(C.clab)}, χ²(${T.df}, N = ${N}) = ${num(T.chi2)}, ${apaP(T.p)}, Cramér's V = ${nlz(V)}.${fe ? ` Fisher's exact test: ${apaP(fe.p)}, odds ratio = ${num(fe.oddsRatio)}.` : ''} Row percentages: ${C.rn.map((r, i) => `${esc(r)} ${C.cn.map((c, j) => `${num(100 * C.obs[i][j] / rs[i], 1)}% ${esc(c)}`).join(' / ')}`).join('; ')}.`;
  const checks = [{ status: 'info', title: 'Independence', text: 'Each count must be a different individual (plant, head, consumer) counted once. Counting the same plant on several days violates the test.' },
    low === 0 ? { status: 'ok', title: 'Expected counts', text: `All expected counts ≥ 5 (smallest ${num(Math.min(...E), 1)}): the χ² approximation is reliable.` } : { status: low / E.length > 0.2 || Math.min(...E) < 1 ? 'bad' : 'warn', title: 'Expected counts', text: `${low} of ${E.length} cells have expected counts below 5 (smallest ${num(Math.min(...E), 2)}). ${is22 ? "Use Fisher's exact test (reported)." : 'Merge sparse categories or collect more data.'}` },
    { status: 'info', title: 'Where is the association?', text: `Adjusted residuals beyond ±1.96 mark cells with more (+) or fewer (−) counts than independence predicts: ${adj.flatMap((r, i) => r.map((z, j) => Math.abs(z) > 1.96 ? `${esc(C.rn[i])} × ${esc(C.cn[j])} (${num(z)})` : null)).filter(Boolean).join(', ') || 'none'}.` }];
  return { title: 'χ² test of independence', kind: 'mosaic', C, T, adj, rs, cs, N, V, apa, checks,
    tables: [table([esc(C.rlab), ...C.cn.map(esc), 'Total'], [...C.rn.map((r, i) => [esc(r), ...C.obs[i].map((o, j) => `${o} <small class="muted">(${num(T.expected[i][j], 1)})</small>`), rs[i]]), ['Total', ...cs, N]], { caption: 'Observed counts (expected under independence)' }),
      table(['Statistic', 'Value', 'df', 'p'], [['Pearson χ²', num(T.chi2), T.df, apaP(T.p).replace('p ', '')], ["Cramér's V", nlz(V, 3), '', ''], ...(fe ? [["Fisher's exact (2 × 2)", '', '', apaP(fe.p).replace('p ', '')]] : [])])],
    ro: [['χ²', T.chi2, `df ${T.df}`, 2], ['p-value', T.p, '', 4], ["Cramér's V", V, '', 3], ['N', N, '', 0], ['Cells with E < 5', low, `of ${E.length}`, 0, low ? 'warn' : 'ok']],
    hud: `χ²(${T.df}, N = ${N}) = ${num(T.chi2)}, ${apaP(T.p)}`, charts: 'chisq' };
}
function runPower() {
  const p = ui.values(); const a = alphaV(); const d = p.pwDelta / p.pwSD; const design = p.pwDesign;
  const f = d * Math.sqrt(1 / (2 * p.pwK)); // Cohen's minimum-variability pattern: two extreme means Δ apart
  const pw = n => design === 'anova' ? X.powerAnova(f, p.pwK, n, a) : X.powerT(d, n, { alpha: a, type: design });
  const need = design === 'anova' ? X.sampleSizeAnova(f, p.pwK, p.pwTarget, a) : X.sampleSizeT(d, p.pwTarget, { alpha: a, type: design });
  const now = pw(p.pwN);
  const unit = MAP.y ? vunitRaw(MAP.y) : ''; const uu = unit ? ' ' + unit : '';
  const what = design === 'two' ? 'a two-sided two-sample t-test' : design === 'one' ? 'a two-sided paired (or one-sample) t-test' : `a one-way ANOVA with ${p.pwK} groups`;
  const per = design === 'one' ? 'pairs' : 'units per group';
  const apa = `An a priori power analysis for ${what} (α = ${nlz(a, 2)}) showed that ${isFinite(need) ? `n = ${need} ${per}` : 'an impractically large sample'} ${isFinite(need) ? 'are' : 'is'} needed to detect a difference of ${num(p.pwDelta, 1)}${uu} (standard deviation ${num(p.pwSD, 1)}${uu}; Cohen's ${design === 'anova' ? `f = ${num(f)}` : `d = ${num(d)}`}) with ${Math.round(p.pwTarget * 100)}% power. With the planned n = ${p.pwN} ${per}${design === 'one' ? '' : ''}, power is ${Math.round(now * 100)}%.`;
  const checks = [{ status: 'info', title: 'Where does σ come from?', text: 'Use the SD between experimental units from a pilot run, last year\'s project data or the literature. Power is very sensitive to σ: overestimating Δ or underestimating σ is the most common reason for underpowered experiments.' },
    { status: now < 0.5 ? 'bad' : now < p.pwTarget ? 'warn' : 'ok', title: 'Your planned design', text: `n = ${p.pwN} gives ${Math.round(now * 100)}% power${now < 0.5 ? ' — a real effect of this size would be missed more often than found. Increase replication, reduce noise (blocking, uniform conditions) or aim for a larger effect.' : now < p.pwTarget ? ' — below the target.' : ' — meets the target.'}` },
    { status: 'info', title: 'Exact calculation', text: 'Power is computed from the noncentral t (Lenth 1989) or noncentral F distribution — not from a normal approximation — so it is correct for the small n typical of student experiments.' },
    { status: 'warn', title: 'Not after the fact', text: '“Observed power” computed from your own results adds nothing to the p-value (Hoenig & Heisey 2001). Use power to plan; after the experiment, report the confidence interval.' }];
  return { title: 'Power & sample size', kind: 'power', pw, need, now, d, f, design, a, p, apa, checks, unit,
    tables: [table(['Quantity', 'Value'], [["Effect size", design === 'anova' ? `f = ${num(f, 3)}` : `d = ${num(d, 3)}`], ['Required n (target power)', isFinite(need) ? `${need} ${per}` : '> 20 000'], ['Total units', isFinite(need) ? (design === 'two' ? 2 * need : design === 'anova' ? p.pwK * need : need) : '—'], [`Power with n = ${p.pwN}`, `${num(100 * now, 1)}%`], ['Detectable Δ at n = ' + p.pwN + ' (target power)', `${num(mdd(p, a), 1)}${uu}`]], { numFrom: 1 })],
    ro: [['Effect size', design === 'anova' ? f : d, design === 'anova' ? "Cohen's f" : "Cohen's d", 2], ['Required n', need, per, 0], ['Power at planned n', now * 100, '%', 0, now >= p.pwTarget ? 'ok' : now >= 0.5 ? 'warn' : 'bad'], ['Detectable Δ', mdd(p, a), unit || 'units', 1]],
    hud: `n = ${isFinite(need) ? need : '∞'} ${per} for ${Math.round(p.pwTarget * 100)}% power`, charts: 'power' };
}
function mdd(p, a) { // minimal detectable difference at the planned n
  let lo = 0, hi = 50 * p.pwSD; const target = p.pwTarget;
  const pw = D => { const d = D / p.pwSD; return p.pwDesign === 'anova' ? X.powerAnova(d * Math.sqrt(1 / (2 * p.pwK)), p.pwK, p.pwN, a) : X.powerT(d, p.pwN, { alpha: a, type: p.pwDesign }); };
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (pw(m) < target) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
function useDataSD() {
  if (!DATA || !MAP.y) { window.FFP && FFP.toast && FFP.toast('Load data first'); return; }
  const G = groupData(); if (!G) return; const vals = G.values.filter(v => v.length > 1);
  const sdv = vals.length > 1 ? Math.sqrt(S.anova1(vals).msw) : S.sd(vals[0] || []); if (!isFinite(sdv)) return;
  ui.set('pwSD', Math.max(1, Math.min(300, +sdv.toFixed(1))));
  window.FFP && FFP.toast && FFP.toast(`σ = ${num(sdv, 1)} (pooled within-group SD of ${G.yname})`);
}

/* =====================================================================
   Rendering: stage plot (plot.js host + custom drawing), readouts, results, charts
   ===================================================================== */
const stageEl = $('#stage'); stageEl.classList.add('light-stage');
const host = document.createElement('div'); host.className = 'wb-stage-plot'; stageEl.appendChild(host);
const hud = hudChips(stageEl);
const legendEl = document.createElement('div'); legendEl.className = 'wb-legend'; stageEl.appendChild(legendEl);
let SP = null, spKind = '';
stageToolbar(stageEl, { onShot: () => { if (!SP) return; const c = SP.canvas; const out = document.createElement('canvas'); out.width = c.width; out.height = c.height; const ctx = out.getContext('2d'); ctx.fillStyle = palette().bgElev || '#fff'; ctx.fillRect(0, 0, out.width, out.height); ctx.drawImage(c, 0, 0); const a = document.createElement('a'); a.href = out.toDataURL('image/png'); a.download = 'statistics-workbench.png'; a.click(); } });
const stageH = () => Math.max(280, stageEl.clientHeight - 118);
function stagePlot(kind, opts) {
  if (SP) SP.destroy(); host.innerHTML = '';
  SP = new Plot(host, Object.assign({ height: stageH(), legend: true, padding: { top: 14, right: 24, bottom: 48 } }, opts)); spKind = kind; return SP;
}
new ResizeObserver(() => { if (SP) { SP.box.style.height = stageH() + 'px'; SP.redraw(); } }).observe(stageEl);
document.addEventListener('ffp:theme', () => setTimeout(render, 30));

const jit = (i, j) => { const x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return (x - Math.floor(x)) - 0.5; };
function drawGroupsStage(R) {
  const G = R.G, k = G.names.length, p = ui.values();
  const allv = G.values.flat(); const P = stagePlot('groups', {
    x: { label: G.label || '', min: -0.62, max: k - 0.38, format: v => Math.abs(v - Math.round(v)) < 1e-6 && G.names[Math.round(v)] != null ? G.names[Math.round(v)] : '' },
    y: { label: cap(G.yname), unit: vunit(G.yh), min: 'auto', max: 'auto' }, legend: false });
  const a = alphaV();
  // boxes + whiskers + CI (custom layer)
  const stats = G.values.map(v => { const s = [...v].sort((x, y) => x - y); if (!s.length) return null; const q1 = S.quantile(s, 0.25), q3 = S.quantile(s, 0.75), iqr = q3 - q1; const lo = s.find(x => x >= q1 - 1.5 * iqr), hi = [...s].reverse().find(x => x <= q3 + 1.5 * iqr); const m = S.mean(s), se = S.se(s); const tc = s.length > 1 ? S.tInv(1 - a / 2, s.length - 1) : NaN; return { q1, q3, med: S.median(s), lo, hi, m, ci: [m - tc * se, m + tc * se], n: s.length }; });
  P.custom('boxes', (ctx, pl, pal) => {
    stats.forEach((s, i) => {
      if (!s) return; const c = categorical(i); const X0 = pl.px(i - 0.2), X1 = pl.px(i + 0.2), Xc = pl.px(i);
      ctx.fillStyle = withAlpha(c, 0.10); ctx.strokeStyle = withAlpha(c, 0.9); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(X0, pl.py(s.q3), X1 - X0, pl.py(s.q1) - pl.py(s.q3)); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(X0, pl.py(s.med)); ctx.lineTo(X1, pl.py(s.med)); ctx.stroke();
      ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(Xc, pl.py(s.q3)); ctx.lineTo(Xc, pl.py(s.hi)); ctx.moveTo(Xc, pl.py(s.q1)); ctx.lineTo(Xc, pl.py(s.lo));
      ctx.moveTo(pl.px(i - 0.08), pl.py(s.hi)); ctx.lineTo(pl.px(i + 0.08), pl.py(s.hi)); ctx.moveTo(pl.px(i - 0.08), pl.py(s.lo)); ctx.lineTo(pl.px(i + 0.08), pl.py(s.lo)); ctx.stroke();
    });
    if (R.blocksM) { // RCBD: connect each block across treatments
      ctx.lineWidth = 1; ctx.strokeStyle = withAlpha(pal.muted.startsWith('#') ? pal.muted : '#888888', 0.45);
      R.blocksM.m.forEach(row => { ctx.beginPath(); row.forEach((v, j) => { const X = pl.px(j + 0.0), Y = pl.py(v); j ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke(); });
    }
  });
  if (p.pts) G.values.forEach((v, i) => { const fl = outlierFlags(v); P.scatter('pts' + i, v.map((_, j) => i + (R.blocksM ? 0 : jit(i, j) * 0.26)), v, { color: withAlpha(categorical(i), 0.72), r: 4, label: G.names[i], noLegend: true }); const ox = [], oy = []; v.forEach((y, j) => { if (fl[j]) { ox.push(i + (R.blocksM ? 0 : jit(i, j) * 0.26)); oy.push(y); } }); if (ox.length) P.scatter('out' + i, ox, oy, { color: 'danger', r: 7.5, hollow: true, noTip: true }); });
  // mean ± CI diamonds
  P.scatter('means', stats.map((_, i) => i + 0.31), stats.map(s => s ? s.m : NaN), { color: 'ink', r: 5.5, shape: 'diamond', yErr: stats.map(s => s ? (s.ci[1] - s.ci[0]) / 2 : 0), label: `Mean ± ${confPct()}% CI`, noLegend: true });
  if (R.mu0 != null) P.hline('mu0', R.mu0, { color: 'magenta', label: `μ₀ = ${num(R.mu0, R.dec)}` });
  const lab = R.letters && p.letters ? R.letters : null;
  P.custom('letters', (ctx, pl, pal) => {
    ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    stats.forEach((s, i) => {
      if (!s) return; const top = Math.max(s.hi, s.ci[1], ...G.values[i]); const Y = Math.max(pl.plotRect.top + 14, pl.py(top) - 8);
      if (lab) { ctx.fillStyle = categorical(i); ctx.font = '700 15px Inter, sans-serif'; ctx.fillText(lab[i], pl.px(i), Y); }
      ctx.fillStyle = pal.muted; ctx.font = '500 11px JetBrains Mono, monospace'; ctx.fillText(`n = ${s.n}`, pl.px(i), pl.plotRect.top + pl.plotRect.height - 4);
    });
  });
  // make sure letters have headroom
  const top = Math.max(...allv, ...stats.filter(Boolean).map(s => s.ci[1])), bot = Math.min(...allv, ...stats.filter(Boolean).map(s => s.ci[0]));
  const span = (top - bot) || 1; P.setAxis('y', { min: bot - span * 0.12, max: top + span * 0.14 });
  legendEl.innerHTML = `<span><i class="wb-lg-box"></i>box: quartiles & median</span><span><i class="wb-lg-dia"></i>mean ± ${confPct()}% CI</span>${lab ? '<span><b>a, b</b> Tukey letters</span>' : ''}${R.blocksM ? '<span><i class="wb-lg-line"></i>one line per block</span>' : ''}`;
}
function drawPairedStage(R) {
  const P = stagePlot('paired', { x: { label: '', min: -0.45, max: 1.45, format: v => v === 0 ? R.nA : v === 1 ? R.nB : '' }, y: { label: 'Value', unit: vunit(R.yh) }, legend: false });
  P.custom('pairs', (ctx, pl, pal) => {
    R.A.forEach((a, i) => { const b = R.B[i]; ctx.strokeStyle = withAlpha(b >= a ? pal.accent : pal.magenta, 0.55); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(pl.px(0), pl.py(a)); ctx.lineTo(pl.px(1), pl.py(b)); ctx.stroke(); });
    const mA = S.mean(R.A), mB = S.mean(R.B); ctx.strokeStyle = pal.ink; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(pl.px(0), pl.py(mA)); ctx.lineTo(pl.px(1), pl.py(mB)); ctx.stroke();
    ctx.fillStyle = pal.ink; ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`mean change ${num(mB - mA, R.dec)} ${vunit(R.yh)}`, pl.px(0.5) + 10, pl.py((mA + mB) / 2) - 8);
  });
  P.scatter('a', R.A.map(() => 0), R.A, { color: categorical(0), r: 4.5, label: R.nA, noLegend: true });
  P.scatter('b', R.B.map(() => 1), R.B, { color: categorical(1), r: 4.5, label: R.nB, noLegend: true });
  legendEl.innerHTML = `<span><i class="wb-lg-line" style="background:var(--accent)"></i>increase</span><span><i class="wb-lg-line" style="background:var(--magenta)"></i>decrease</span><span><i class="wb-lg-line" style="background:var(--ink);height:3px"></i>mean change</span>`;
}
function drawScatterStage(R) {
  const x0 = Math.min(...R.D.x), x1 = Math.max(...R.D.x), xpad = (x1 - x0 || Math.abs(x0) || 1) * 0.05;
  const P = stagePlot('scatter', { x: { label: cap(R.xn), unit: R.ux, min: x0 - xpad, max: x1 + xpad }, y: { label: cap(R.yn), unit: R.uy }, legend: true });
  const xs = linspace(x0, x1, 80);
  if (!R.corr) {
    if (ui.get('bands')) {
      P.band('pi', xs, xs.map(v => R.L.piObsLevel(v)[0]), xs.map(v => R.L.piObsLevel(v)[1]), { color: 'water', alpha: 0.10, label: `${confPct()}% prediction band` });
      P.band('ci', xs, xs.map(v => R.L.ciLevel(v)[0]), xs.map(v => R.L.ciLevel(v)[1]), { color: 'accent', alpha: 0.22, label: `${confPct()}% confidence band` });
    }
    P.line('fit', xs, xs.map(R.L.predict), { color: 'accent', width: 2.6, label: 'Least-squares line' });
    const inf = R.cook.map((c, i) => c > 4 / R.D.x.length ? i : -1).filter(i => i >= 0);
    if (inf.length) P.scatter('inf', inf.map(i => R.D.x[i]), inf.map(i => R.D.y[i]), { color: 'danger', r: 8, hollow: true, label: "Cook's D > 4/n" });
    P.custom('eq', (ctx, pl, pal) => { ctx.font = '600 13px JetBrains Mono, monospace'; ctx.fillStyle = pal.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(`ŷ = ${num(R.L.intercept, R.decY)} ${R.L.slope < 0 ? '−' : '+'} ${num(Math.abs(R.L.slope), X.decimalsFor(R.L.seSlope))}·x    R² = ${nlz(R.L.r2)}`, pl.plotRect.left + 10, pl.plotRect.top + 8); });
  } else {
    const L = S.linreg(R.D.x, R.D.y); P.line('fit', xs, xs.map(L.predict), { color: 'muted', width: 1.6, dash: [5, 4], label: 'Linear trend (guide)' });
  }
  P.scatter('pts', R.D.x, R.D.y, { color: 'c1', r: 5, label: 'Observations' });
  legendEl.innerHTML = '';
}
function drawMosaicStage(R) {
  const P = stagePlot('mosaic', { x: { label: `${cap(R.C.rlab)} (column width ∝ row total)`, min: 0, max: 1, format: () => '' }, y: { label: `Share within ${R.C.rlab}`, min: 0, max: 1, format: v => Math.round(v * 100) + '%' }, legend: false, crosshair: false });
  const N = R.N, gap = 0.012;
  P.custom('mosaic', (ctx, pl, pal) => {
    let x0 = 0; const k = R.C.rn.length;
    R.C.rn.forEach((rname, i) => {
      const w = R.rs[i] / N * (1 - gap * (k - 1)); let y0 = 0;
      R.C.cn.forEach((cname, j) => {
        const h = R.C.obs[i][j] / R.rs[i]; const z = R.adj[i][j]; const t = 0.5 + Math.max(-1, Math.min(1, z / 4)) / 2;
        const X0 = pl.px(x0), X1 = pl.px(x0 + w), Y0 = pl.py(y0), Y1 = pl.py(y0 + h);
        ctx.fillStyle = colormapCSS('rdbu', t); ctx.fillRect(X0, Y1, X1 - X0, Y0 - Y1);
        ctx.strokeStyle = pal.bgElev || '#fff'; ctx.lineWidth = 2; ctx.strokeRect(X0, Y1, X1 - X0, Y0 - Y1);
        if (Y0 - Y1 > 30 && X1 - X0 > 60) { ctx.fillStyle = Math.abs(z) > 2.2 ? '#fff' : '#1b2420'; ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(cname, (X0 + X1) / 2, (Y0 + Y1) / 2 - 8); ctx.font = '500 11px JetBrains Mono, monospace'; ctx.fillText(`${R.C.obs[i][j]} (${num(100 * h, 0)}%) · z ${num(z, 1)}`, (X0 + X1) / 2, (Y0 + Y1) / 2 + 8); }
        y0 += h;
      });
      x0 += w + gap;
    });
  });
  { let x0 = 0; const k = R.C.rn.length; R.C.rn.forEach((rname, i) => { const w = R.rs[i] / R.N * (1 - gap * (k - 1)); P.text('rl' + i, x0 + w / 2, 0, `${rname} (n = ${R.rs[i]})`, { align: 'center', dy: 14, color: 'ink', size: 12, baseline: 'top' }); x0 += w + gap; }); }
  legendEl.innerHTML = `<span>adjusted residual</span><span class="wb-cbar" style="background:${colormapGradient('rdbu')}"></span><span>−4 … 0 … +4</span><span class="muted">red = fewer, blue = more than expected</span>`;
}
function drawPowerStage(R) {
  const p = R.p; const nMax = Math.max(20, Math.min(200, (isFinite(R.need) ? R.need : 60) * 2, p.pwN * 2));
  const ns = []; for (let n = 2; n <= nMax; n++) ns.push(n);
  const P = stagePlot('power', { x: { label: R.design === 'one' ? 'Number of pairs n' : 'Replicates per group n', min: 2, max: nMax }, y: { label: 'Power (probability of detecting Δ)', min: 0, max: 1, format: v => Math.round(v * 100) + '%' }, legend: true });
  const pwAt = (D, n) => { const d = D / p.pwSD; return R.design === 'anova' ? X.powerAnova(d * Math.sqrt(1 / (2 * p.pwK)), p.pwK, n, R.a) : X.powerT(d, n, { alpha: R.a, type: R.design }); };
  P.hregion('ok', p.pwTarget, 1, { color: 'accent', alpha: 0.07 });
  P.line('lo', ns, ns.map(n => pwAt(p.pwDelta * 0.75, n)), { color: 'muted', width: 1.6, dash: [5, 4], label: `Δ × 0.75 = ${num(p.pwDelta * 0.75, 1)}` });
  P.line('hi', ns, ns.map(n => pwAt(p.pwDelta * 1.25, n)), { color: 'water', width: 1.6, dash: [2, 3], label: `Δ × 1.25 = ${num(p.pwDelta * 1.25, 1)}` });
  P.line('main', ns, ns.map(n => pwAt(p.pwDelta, n)), { color: 'accent', width: 3, label: `Δ = ${num(p.pwDelta, 1)}, σ = ${num(p.pwSD, 1)}` });
  P.hline('target', p.pwTarget, { color: 'amber', label: `target ${Math.round(p.pwTarget * 100)}%` });
  P.hline('alpha', R.a, { color: 'danger', label: `α = ${R.a}`, dash: [2, 3] });
  if (isFinite(R.need) && R.need <= nMax) P.vline('need', R.need, { color: 'amber', label: `n = ${R.need}` });
  P.point('now', p.pwN, R.now, { color: 'magenta', r: 6, label: `planned n = ${p.pwN}: ${Math.round(R.now * 100)}%`, guides: true });
  legendEl.innerHTML = '';
}

/* ---------- chart slots ---------- */
const slots = [1, 2, 3].map(i => ({ card: $('#wb-c' + i), h: $('#wb-c' + i + ' h3'), sub: $('#wb-c' + i + ' .chart-sub'), el: $('#wb-c' + i + ' .chart'), obj: null }));
function slot(i, title, sub, factory) {
  const s = slots[i]; s.card.hidden = false; s.h.textContent = title; s.sub.innerHTML = sub;
  if (s.obj && s.obj.destroy) s.obj.destroy(); s.el.innerHTML = ''; s.obj = factory ? factory(s.el) : null; return s.obj;
}
const hideSlot = i => { slots[i].card.hidden = true; };
function histChart(i, title, sub, names, values, unit) {
  const all = values.flat(); if (!all.length) return hideSlot(i);
  const lo = Math.min(...all), hi = Math.max(...all); const nb = Math.max(5, Math.min(18, Math.round(Math.sqrt(all.length) * 1.6)));
  const P = slot(i, title, sub, el => new Plot(el, { x: { label: 'Value', unit }, y: { label: 'Count', min: 0 }, legend: names.length > 1 }));
  const H = values.map(v => S.histogram(v, nb, lo, hi + 1e-9 * (hi - lo || 1)));
  const w = H[0].width;
  P.custom('bars', (ctx, pl) => { H.forEach((h, g) => { ctx.fillStyle = withAlpha(categorical(g), names.length > 1 ? 0.32 : 0.55); ctx.strokeStyle = withAlpha(categorical(g), 0.9); ctx.lineWidth = 1; h.counts.forEach((c, b) => { if (!c) return; const X0 = pl.px(h.edges[b]) + 1, X1 = pl.px(h.edges[b + 1]) - 1, Y = pl.py(c); ctx.fillRect(X0, Y, X1 - X0, pl.py(0) - Y); ctx.strokeRect(X0, Y, X1 - X0, pl.py(0) - Y); }); }); });
  values.forEach((v, g) => { if (v.length < 2) return; const m = S.mean(v), s = S.sd(v); const xs = linspace(lo - (hi - lo) * 0.1, hi + (hi - lo) * 0.1, 120); P.line('n' + g, xs, xs.map(x => S.normPdf(x, m, s) * v.length * w), { color: categorical(g), width: 2, label: names[g] }); });
  P.line('dom', [lo, hi], [0, Math.max(...H.flatMap(h => h.counts))], { color: 'transparent', width: 0, noTip: true });
  return P;
}
function qqChart(i, title, sub, names, groups) {
  const P = slot(i, title, sub, el => new Plot(el, { x: { label: 'Theoretical normal quantile' }, y: (() => { const mx = Math.max(1e-9, ...groups.flat().map(v => Math.abs(v - S.mean(groups.flat())))) * 1.15; const e = Math.pow(10, Math.floor(Math.log10(mx))); const m = [1, 2, 2.5, 5, 10].map(k => k * e).find(v => v >= mx); return { label: 'Sample quantile (residual)', min: S.mean(groups.flat()) - m, max: S.mean(groups.flat()) + m }; })(), legend: false }));
  const all = groups.flat(); if (all.length < 3) return P; const q = S.qqData(all); const s = S.sd(all), m = S.mean(all);
  const lim = [q[0][0], q[q.length - 1][0]];
  P.band('env', linspace(lim[0], lim[1], 40), linspace(lim[0], lim[1], 40).map(z => m + s * z - 1.96 * s * Math.sqrt(S.normCdf(z) * (1 - S.normCdf(z)) / all.length) / S.normPdf(z)), linspace(lim[0], lim[1], 40).map(z => m + s * z + 1.96 * s * Math.sqrt(S.normCdf(z) * (1 - S.normCdf(z)) / all.length) / S.normPdf(z)), { color: 'muted', alpha: 0.1 });
  P.line('ref', lim, lim.map(z => m + s * z), { color: 'muted', width: 1.6, dash: [6, 4], noTip: true });
  // colour by group: map sorted residual back to its group
  const tagged = groups.flatMap((g, gi) => g.map(v => [v, gi])).sort((a, b) => a[0] - b[0]);
  const colors = tagged.map(t => categorical(t[1]));
  P.scatter('qq', q.map(p => p[0]), q.map(p => p[1]), { colors, color: 'c0', r: 4, label: names.length > 1 ? 'residuals' : names[0] });
  return P;
}
function renderCharts(R) {
  const kind = R.charts; const a = alphaV();
  if (kind === 'none') { [0, 1, 2].forEach(hideSlot); return; }
  if (kind === 'groups' || kind === 'anova') {
    const G = R.G; const unit = vunit(G.yh);
    histChart(0, 'Distribution by group', 'Histogram with a fitted normal curve per group. Look for skew, several peaks or outliers.', G.names, G.values, unit);
    const res = G.values.map(v => { const m = S.mean(v); return v.map(x => x - m); });
    qqChart(1, 'Normal QQ plot of residuals', 'Residual = value − its group mean. Points on the dashed line (inside the grey envelope) mean normal residuals; a curve means skew.', G.names, R.resid ? (R.blocksM ? [R.resid] : res) : res);
    if (R.tukey) {
      const pr = R.tukey.pairs; const names = G.names;
      const P = slot(2, 'Tukey HSD: family-wise confidence intervals', `Each bar is a ${confPct()}% CI for a difference between two means. Intervals that cross zero (dashed) are not significant.`, el => new Plot(el, { x: { label: 'Difference in means', unit }, y: { label: '', min: -0.6, max: pr.length - 0.2, format: () => '' }, legend: false, crosshair: false, padding: { left: 16 } }));
      P.vline('zero', 0, { color: 'muted' });
      P.custom('ci', (ctx, pl, pal) => { pr.forEach((q, k) => { const Y = pl.py(pr.length - 1 - k); const col = q.p < a ? pal.accent : pal.muted; ctx.strokeStyle = col; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(pl.px(q.lwr), Y); ctx.lineTo(pl.px(q.upr), Y); ctx.stroke(); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(pl.px(q.diff), Y, 5.5, 0, 7); ctx.fill(); ctx.font = '600 11.5px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = pal.ink2; ctx.fillText(`${names[q.j]} − ${names[q.i]}   ${apaP(q.p)}`, pl.plotRect.left + 8, Y - 9); }); });
      const ext = pr.flatMap(q => [q.lwr, q.upr, 0]); const sp = Math.max(...ext) - Math.min(...ext); P.setAxis('x', { min: Math.min(...ext) - sp * 0.08, max: Math.max(...ext) + sp * 0.08 });
    } else if (R.diff) {
      const d = R.diff; const P = slot(2, 'Estimated difference', `Point estimate and ${confPct()}% confidence interval. If the interval excludes zero, p < α.`, el => new Plot(el, { x: { label: d.label, unit }, y: { label: '', min: -1, max: 1, format: () => '' }, legend: false }));
      P.vline('zero', 0, { color: 'muted', label: 'no difference' });
      P.custom('ci', (ctx, pl, pal) => { const Y = pl.py(0); ctx.strokeStyle = pal.accent; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(pl.px(d.ci[0]), Y); ctx.lineTo(pl.px(d.ci[1]), Y); ctx.stroke(); ctx.fillStyle = pal.ink; ctx.beginPath(); ctx.arc(pl.px(d.est), Y, 7, 0, 7); ctx.fill(); ctx.font = '600 12px JetBrains Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText(`${num(d.est, R.dec)}  [${num(d.ci[0], R.dec)}, ${num(d.ci[1], R.dec)}]`, pl.px(d.est), Y - 18); });
      const sp = Math.max(Math.abs(d.ci[0]), Math.abs(d.ci[1]), 1e-9); P.setAxis('x', { min: Math.min(0, d.ci[0]) - sp * 0.25, max: Math.max(0, d.ci[1]) + sp * 0.25 });
    } else {
      const P = slot(2, `Means with ${confPct()}% confidence intervals`, 'The CI shows the precision of each mean — not the spread of the plants (that is the SD).', el => new Plot(el, { x: { label: '', min: -0.6, max: G.names.length - 0.4, format: v => Math.abs(v - Math.round(v)) < 1e-6 ? G.names[Math.round(v)] ?? '' : '' }, y: { label: 'Mean', unit }, legend: false }));
      G.values.forEach((v, i) => { if (v.length < 2) return; const m = S.mean(v), tc = S.tInv(1 - a / 2, v.length - 1) * S.se(v); P.scatter('m' + i, [i], [m], { color: categorical(i), r: 6, yErr: [tc], label: G.names[i] }); });
    }
    return;
  }
  if (kind === 'paired') {
    histChart(0, 'Distribution of the differences', 'The paired t-test is a one-sample test on these differences (2nd − 1st).', ['difference'], [R.D], vunit(R.yh));
    qqChart(1, 'QQ plot of the differences', 'Normality matters for the differences only, not for each measurement separately.', ['differences'], [R.D]);
    const d = R.diff; const P = slot(2, 'Mean change with confidence interval', `Mean of the differences and its ${confPct()}% CI.`, el => new Plot(el, { x: { label: 'Mean change', unit: vunit(R.yh) }, y: { label: '', min: -1, max: 1, format: () => '' }, legend: false }));
    P.vline('zero', 0, { color: 'muted', label: 'no change' });
    P.custom('ci', (ctx, pl, pal) => { const Y = pl.py(0); ctx.strokeStyle = pal.accent; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(pl.px(d.ci[0]), Y); ctx.lineTo(pl.px(d.ci[1]), Y); ctx.stroke(); ctx.fillStyle = pal.ink; ctx.beginPath(); ctx.arc(pl.px(d.est), Y, 7, 0, 7); ctx.fill(); ctx.font = '600 12px JetBrains Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText(`${num(d.est, R.dec)}  [${num(d.ci[0], R.dec)}, ${num(d.ci[1], R.dec)}]`, pl.px(d.est), Y - 18); });
    const sp = Math.max(Math.abs(d.ci[0]), Math.abs(d.ci[1])); P.setAxis('x', { min: Math.min(0, d.ci[0]) - sp * 0.25, max: Math.max(0, d.ci[1]) + sp * 0.25 });
    return;
  }
  if (kind === 'regression') {
    const L = R.L; const f0 = Math.min(...L.fitted), f1 = Math.max(...L.fitted), fpad = (f1 - f0 || 1) * 0.05;
    const P1 = slot(0, 'Residuals versus fitted values', 'Should look like a structureless horizontal band. A curve means the relationship is not linear; a funnel means unequal variance.', el => new Plot(el, { x: { label: 'Fitted value', unit: R.uy, min: f0 - fpad, max: f1 + fpad }, y: { label: 'Residual', unit: R.uy }, legend: false }));
    P1.hline('z', 0, { color: 'muted' }); P1.scatter('r', L.fitted, L.residuals, { color: 'c1', r: 4.5, label: 'residual' });
    const gm = new Map(); L.fitted.forEach((f, i) => { const k = f.toFixed(6); if (!gm.has(k)) gm.set(k, [f, []]); gm.get(k)[1].push(L.residuals[i]); }); let ord = [...gm.values()].map(([f, r]) => [f, S.mean(r)]).sort((a, b) => a[0] - b[0]);
    if (ord.length === L.fitted.length) { const w = Math.max(3, Math.round(ord.length / 4)); ord = ord.map((o, i) => { const lo = Math.max(0, i - (w >> 1)), hi = Math.min(ord.length, lo + w); return [o[0], S.mean(ord.slice(lo, hi).map(q => q[1]))]; }); }
    P1.line('sm', ord.map(o => o[0]), ord.map(o => o[1]), { color: 'magenta', width: 2, label: 'running mean (trend guide)' });
    qqChart(1, 'Normal QQ plot of residuals', 'Residuals should follow the dashed line.', ['residuals'], [L.residuals]);
    const b = slot(2, "Cook's distance (influence)", `Influence of each observation on the fitted line. Bars above 4/n = ${num(4 / R.D.x.length)} deserve a second look.`, el => new BarChart(el, { y: { label: "Cook's D", min: 0 }, legend: false, height: 250 }));
    b.set(R.D.x.map((x, i) => `${i + 1}`), [{ label: "Cook's D", values: R.cook, colors: R.cook.map(c => c > 4 / R.D.x.length ? 'danger' : 'c1'), format: v => num(v, 2) }]); b.refLine(4 / R.D.x.length, '4/n', 'amber');
    return;
  }
  if (kind === 'correlation') {
    histChart(0, `Distribution of ${R.xn}`, 'Pearson assumes both variables are roughly normal.', [R.xn], [R.D.x], R.ux);
    histChart(1, `Distribution of ${R.yn}`, 'Skewed variables or outliers? Prefer Spearman.', [R.yn], [R.D.y], R.uy);
    const rk = v => X.rankData(v).r; const P = slot(2, 'Rank scatter (what Spearman sees)', 'Spearman\'s ρ is Pearson\'s r computed on these ranks.', el => new Plot(el, { x: { label: `Rank of ${R.xn}` }, y: { label: `Rank of ${R.yn}` }, legend: false }));
    P.scatter('rk', rk(R.D.x), rk(R.D.y), { color: 'c2', r: 4.5, label: 'ranks' });
    return;
  }
  if (kind === 'chisq') {
    const C = R.C;
    const b1 = slot(0, 'Observed and expected counts', 'Expected = row total × column total / N (what independence predicts).', el => new BarChart(el, { y: { label: 'Count', min: 0 }, horizontal: true, height: 260 }));
    const cats = C.rn.flatMap(r => C.cn.map(c => `${r} · ${c}`)); b1.set(cats, [{ label: 'Observed', values: C.obs.flat(), color: 'c0' }, { label: 'Expected', values: R.T.expected.flat(), color: 'muted', format: v => num(v, 1) }]);
    const b2 = slot(1, 'Adjusted residuals', 'Cells beyond ±1.96 (dashed lines) contribute most to the association.', el => new BarChart(el, { y: { label: 'Adjusted residual', min: 'auto' }, horizontal: true, legend: false, height: 260 }));
    b2.set(cats, [{ label: 'z', values: R.adj.flat(), colors: R.adj.flat().map(z => z > 1.96 ? 'water' : z < -1.96 ? 'danger' : 'muted'), format: v => num(v, 2) }]); b2.refLines([{ v: 1.96, label: '+1.96', color: 'amber' }, { v: -1.96, label: '−1.96', color: 'amber' }]);
    const b3 = slot(2, 'Row percentages', 'Share of each outcome within each row category.', el => new BarChart(el, { y: { label: '%', min: 0, max: 100 }, stacked: true, height: 250 }));
    b3.set(C.rn, C.cn.map((c, j) => ({ label: c, values: C.obs.map((r, i) => 100 * r[j] / R.rs[i]), color: 'c' + j })));
    return;
  }
  if (kind === 'power') {
    const p = R.p; const Ds = linspace(p.pwSD * 0.1, p.pwSD * 3, 60);
    const nFor = D => { const d = D / p.pwSD; return R.design === 'anova' ? X.sampleSizeAnova(d * Math.sqrt(1 / (2 * p.pwK)), p.pwK, p.pwTarget, R.a) : X.sampleSizeT(d, p.pwTarget, { alpha: R.a, type: R.design }); };
    const P1 = slot(0, 'Replicates needed versus the difference to detect', `n per group for ${Math.round(p.pwTarget * 100)}% power at σ = ${num(p.pwSD, 1)}. Halving Δ roughly quadruples n.`, el => new Plot(el, { x: { label: 'Difference Δ', unit: R.unit }, y: { label: 'Required n per group', log: true }, legend: false }));
    P1.line('n', Ds, Ds.map(nFor).map(v => Math.min(v, 1e4)), { color: 'accent', width: 2.4, label: 'required n', step: false }); P1.point('cur', p.pwDelta, Math.min(R.need, 1e4), { color: 'magenta', label: `Δ = ${p.pwDelta}` });
    const ds = linspace(0, 3, 61); const P2 = slot(1, `Power versus effect size at n = ${p.pwN}`, "The sensitivity of your planned experiment. Cohen's d: 0.2 small, 0.5 medium, 0.8 large — plant experiments often need d > 1 to be detected with n ≈ 5.", el => new Plot(el, { x: { label: "Cohen's d = Δ/σ" }, y: { label: 'Power', min: 0, max: 1, format: v => Math.round(v * 100) + '%' }, legend: false }));
    P2.line('p', ds, ds.map(d => R.design === 'anova' ? X.powerAnova(d * Math.sqrt(1 / (2 * p.pwK)), p.pwK, p.pwN, R.a) : X.powerT(d, p.pwN, { alpha: R.a, type: R.design })), { color: 'water', width: 2.4, label: 'power' }); P2.hline('t', p.pwTarget, { color: 'amber' }); P2.point('cur', R.d, R.now, { color: 'magenta', label: `d = ${num(R.d)}` });
    const nn = linspace(2, 60, 59); const P3 = slot(2, 'Precision: expected CI half-width', `Expected ${confPct()}% CI half-width of a difference between two means, t × σ × √(2/n). Plan for the precision you need, not only for significance.`, el => new Plot(el, { x: { label: 'n per group' }, y: { label: 'CI half-width', unit: R.unit, min: 0 }, legend: false }));
    P3.line('w', nn, nn.map(n => S.tInv(1 - R.a / 2, 2 * n - 2) * p.pwSD * Math.sqrt(2 / n)), { color: 'accent', width: 2.4, label: 'half-width' }); P3.hline('d', p.pwDelta, { color: 'magenta', label: 'Δ' });
  }
}

let ro = null;
function renderReadouts(R) {
  const el = $('#readouts'); el.innerHTML = ''; ro = new Readouts(el);
  R.ro.forEach(([label, v, unit, dg, status], i) => { ro.add({ id: 'r' + i, label, unit: unit || '', digits: dg }); ro.set('r' + i, label.startsWith('p') && isFinite(v) && v < 0.0001 ? '< 0.0001' : v, status || null); });
}
function renderResults(R) {
  $('#wb-res-title').textContent = R.title;
  $('#wb-apa').innerHTML = `<p>${R.apa}</p>`;
  $('#wb-tables').innerHTML = R.tables.join('');
  const icon = { ok: '✓', warn: '!', bad: '✕', info: 'i' };
  $('#wb-checks').innerHTML = R.checks.length ? `<h3>Assumption checklist</h3><ul class="wb-checks">${R.checks.map(c => `<li class="${c.status}"><span class="wb-ic" aria-hidden="true">${icon[c.status]}</span><div><b>${c.title}</b><p>${c.text}</p></div></li>`).join('')}</ul>` : '';
}
let RES = null;
function render() {
  if (!RES) return; const R = RES;
  hud.set('t', `<b>${esc(R.title)}</b>`); hud.set('r', R.hud);
  if (R.kind === 'groups') drawGroupsStage(R); else if (R.kind === 'paired') drawPairedStage(R); else if (R.kind === 'scatter') drawScatterStage(R);
  else if (R.kind === 'mosaic') drawMosaicStage(R); else if (R.kind === 'power') drawPowerStage(R);
  else { stagePlot('none', { x: { label: '' }, y: { label: '' }, legend: false }).text('msg', 0.5, 0.5, 'Paste data below or choose an example', { align: 'center', color: 'muted', size: 15 }); legendEl.innerHTML = ''; }
  renderCharts(R);
}
function run() {
  const an = ui.get('an');
  ['tt', 'mu0'].forEach(id => ui.show(id, an === 'ttest')); ui.show('mu0', an === 'ttest' && ui.get('tt') === 'one');
  ui.show('cor', an === 'correlation'); ui.show('bands', an === 'regression'); ui.show('letters', an === 'anova' || an === 'rcbd');
  ['pwDesign', 'pwDelta', 'pwSD', 'pwTarget', 'pwN'].forEach(id => ui.show(id, an === 'power')); ui.show('pwK', an === 'power' && ui.get('pwDesign') === 'anova');
  ui.show('tf', an !== 'chisq' && an !== 'power'); ui.show('pts', ['describe', 'ttest', 'anova', 'rcbd'].includes(an));
  buildMapUI();
  let R;
  try {
    if (an !== 'power' && (!DATA || !DATA.headers.length)) R = empty('Paste your data in the box below, load your grow log, or choose an example dataset.');
    else R = { describe: runDescribe, ttest: runT, anova: runAnova, rcbd: runRCBD, regression: runRegression, correlation: runCorrelation, chisq: runChisq, power: runPower }[an]();
  } catch (err) { console.warn(err); R = empty('These data could not be analysed with the chosen settings: ' + esc(err.message)); }
  if (R.L) { const L = R.L, tc = R.tc, n = R.D.x.length, mx = S.mean(R.D.x), sxx = R.D.x.reduce((s, v) => s + (v - mx) ** 2, 0); L.ciLevel = v => { const h = tc * L.s * Math.sqrt(1 / n + (v - mx) ** 2 / sxx); return [L.predict(v) - h, L.predict(v) + h]; }; L.piObsLevel = v => { const h = tc * L.s * Math.sqrt(1 + 1 / n + (v - mx) ** 2 / sxx); return [L.predict(v) - h, L.predict(v) + h]; }; }
  RES = R; renderReadouts(R); renderResults(R); render();
  lastSummary = { analysis: R.title, report: $('#wb-apa').innerText.trim().slice(0, 600) };
  window.__wb = { R, MAP, DATA };
}
let schedT = null; function schedule() { clearTimeout(schedT); schedT = setTimeout(run, 40); }
ui.onChange((st, id) => { if (id === 'an' || id === 'tt') buildMapUI(); schedule(); });

/* ---------- self-test against published reference values (Sources tab) ---------- */
function selfTest() {
  const el = $('#wb-selftest'); if (!el || el.dataset.done) return; el.dataset.done = '1';
  const ctrl = [4.17, 5.58, 5.18, 6.11, 4.50, 4.61, 5.17, 4.53, 5.33, 5.14], trt1 = [4.81, 4.17, 4.41, 3.59, 5.87, 3.83, 6.03, 4.89, 4.32, 4.69], trt2 = [6.31, 5.12, 5.54, 5.50, 5.37, 5.29, 4.92, 6.15, 5.80, 5.26];
  const g1 = [0.7, -1.6, -0.2, -1.2, -0.1, 3.4, 3.7, 0.8, 0.0, 2.0], g2 = [1.9, 0.8, 1.1, 0.1, -0.1, 4.4, 5.5, 1.6, 4.6, 3.4];
  const sp = [4, 4, 7, 7, 8, 9, 10, 10, 10, 11, 11, 12, 12, 12, 12, 13, 13, 13, 13, 14, 14, 14, 14, 15, 15, 15, 16, 16, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19, 20, 20, 20, 20, 20, 22, 23, 24, 24, 24, 24, 25];
  const di = [2, 10, 4, 22, 16, 10, 18, 26, 34, 17, 28, 14, 20, 24, 28, 26, 34, 34, 46, 26, 36, 60, 80, 20, 26, 54, 32, 40, 32, 40, 50, 42, 56, 76, 84, 36, 46, 68, 32, 48, 52, 56, 64, 66, 54, 70, 92, 93, 120, 85];
  const A = S.anova1([ctrl, trt1, trt2]), T = S.tukeyHSD([ctrl, trt1, trt2]), W = S.tTestWelch(g1, g2), Pd = S.tTestPaired(g1, g2), L = S.linreg(sp, di);
  const cases = [
    ['PlantGrowth one-way ANOVA F', A.F, 4.846088, 'R: anova(lm(weight ~ group, PlantGrowth))'], ['… p-value', A.p, 0.01590996, ''],
    ['Tukey HSD trt2 − trt1, p adj.', T.pairs[2].p, 0.0120064, 'R: TukeyHSD(aov(…))'], ['Brown–Forsythe F', S.leveneBF([ctrl, trt1, trt2]).F, 1.1192, 'R: car::leveneTest(…)'],
    ["Welch's ANOVA F", X.welchAnova([ctrl, trt1, trt2]).F, 5.181, 'R: oneway.test(…)'], ['Kruskal–Wallis H', X.kruskalWallis([ctrl, trt1, trt2]).H, 7.9882, 'R: kruskal.test(…)'],
    ["sleep: Welch t", W.t, -1.860813, 'R: t.test(extra ~ group, sleep)'], ['… Welch df', W.df, 17.77647, ''], ['sleep: paired t', Pd.t, -4.062128, 'R: t.test(…, paired = TRUE)'],
    ['cars: regression slope', L.slope, 3.932409, 'R: lm(dist ~ speed, cars)'], ['… R²', L.r2, 0.6510794, ''],
    ['mtcars mpg: Shapiro–Wilk W', X.shapiroWilk([21.0, 21.0, 22.8, 21.4, 18.7, 18.1, 14.3, 24.4, 22.8, 19.2, 17.8, 16.4, 17.3, 15.2, 10.4, 10.4, 14.7, 32.4, 30.4, 33.9, 21.5, 15.5, 15.2, 13.3, 19.2, 27.3, 26.0, 30.4, 15.8, 19.7, 15.0, 21.4]).W, 0.94756, 'R: shapiro.test(mtcars$mpg)'],
    ['χ² (Agresti party × gender)', S.chiSquareTest([[762, 327, 468], [484, 239, 477]]).chi2, 30.07015, 'R: chisq.test(…)'],
    ['Power, d = 0.5, n = 64 per group', X.powerT(0.5, 64), 0.8014596, 'R: pwr::pwr.t.test(…)'], ['Power, d = 1, n = 5 per group', X.powerT(1, 5), 0.2863, 'noncentral t (exact)']];
  el.innerHTML = table(['Quantity', 'Reference source', 'Workbench', 'Reference', 'Agreement'], cases.map(([n, got, want, src]) => { const ok = Math.abs(got - want) <= 1e-3 * Math.max(1, Math.abs(want)); return [n, `<code>${esc(src)}</code>`, got.toPrecision(6), String(want), ok ? '<span class="wb-ok">✓ agrees</span>' : '<span class="wb-bad">✕ differs</span>']; }), { numFrom: 2, caption: 'Computed live in your browser when this tab opened.' });
}
document.addEventListener('ffp:tab', e => { if (e.detail === 'sources') setTimeout(selfTest, 30); });
if (location.hash === '#sources') setTimeout(selfTest, 500);

/* ---------- boot ---------- */
const startKey = new URLSearchParams(location.search).get('example');
loadExample(EX[startKey] ? startKey : (ui.get('an') === 'regression' ? 'ec' : ui.get('an') === 'chisq' ? 'tipburn' : ui.get('an') === 'rcbd' ? 'hedonic' : ui.get('an') === 'ttest' && ui.get('tt') === 'paired' ? 'paired' : 'led'));
