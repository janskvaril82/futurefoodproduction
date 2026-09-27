/* Growth-curve model fitting — UI, charts and data handling.
   Models, fitting, cross-validation and bootstrap live in ./models.js; example data in ./data.js. */
import { Plot, BarChart, linspace, downloadCSV } from '/assets/js/plot.js';
import { Controls, Readouts, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { parseTable, mean, quantile, histogram, fitLM } from '/assets/js/stats.js';
import { resolveColor, withAlpha, categorical } from '/assets/js/colors.js';
import { MODELS, MODEL_KEYS, fitAll, fitModel, cvModel, makeBootstrap, timeTo, derived, rgrOf, runsTest, polyFit, polyCurve, meansByTime } from './models.js';
import { EXAMPLES, demoGrowLog } from './data.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sq = u => (!u ? '' : /[²³]/.test(u) ? `(${u})²` : u + '²');
const sig = (v, d = 3) => (Number.isFinite(v) ? (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : (+v.toPrecision(d)).toLocaleString('en-GB', { maximumFractionDigits: 6 })) : '—');
const GL_KEY = 'ffp-growlog-v1', PV_KEY = 'ffp-plantvision-series-v1';
const VARS = { fw_g: { label: 'Shoot fresh mass', unit: 'g', target: 250 }, area_cm2: { label: 'Projected leaf area', unit: 'cm²', target: 600 }, height_cm: { label: 'Plant height', unit: 'cm', target: 15 }, leaves: { label: 'Leaf number', unit: 'leaves', target: 20 } };

/* ======================================================================= controls */
const ui = new Controls('#controls', { url: true });
ui.section('Data');
ui.select({ id: 'ds', label: 'Data set', options: [...Object.entries(EXAMPLES).map(([value, e]) => ({ value, label: e.label })), { value: 'pasted', label: 'Your pasted data' }, { value: 'growlog', label: 'Your grow log' }, { value: 'vision', label: 'Image series from the Plant vision lab' }], value: 'fw17' });
ui.select({ id: 'grp', label: 'Fit to', options: [{ value: '__all', label: 'All data pooled' }], value: '__all', persist: false, help: 'Pool all plants, fit one plant or treatment, or fit the mean of each date.' });
ui.section('Models');
ui.select({ id: 'focus', label: 'Model in focus', options: [{ value: 'best', label: 'Best by AICc (automatic)' }, ...MODEL_KEYS.map(k => ({ value: k, label: MODELS[k].label }))], value: 'best', help: 'Residuals, forecast, bootstrap and the parameter table refer to this model.' });
ui.segmented({ id: 'err', label: 'Error model', options: [{ value: 'add', label: 'Additive' }, { value: 'prop', label: 'Proportional (ln W)' }], value: 'add', help: 'Proportional: scatter grows with size — fit ln W, so every point counts in % rather than in grams.' });
ui.toggle({ id: 'all', label: 'Show all six fitted curves', value: true });
ui.toggle({ id: 'logy', label: 'Logarithmic y axis', value: false });
ui.section('Validation');
ui.segmented({ id: 'cv', label: 'Cross-validation', options: [{ value: 'kfold', label: '5-fold' }, { value: 'loo', label: 'Leave-one-out' }, { value: 'future', label: 'Future 30 %' }, { value: 'group', label: 'By plant' }], value: 'kfold', help: '“Future” fits the first 70 % of dates and predicts the rest — an honest test of forecasting. “By plant” leaves out one whole plant or group at a time.' });
ui.section('Harvest forecast');
ui.number({ id: 'target', label: 'Target size W*', value: 250, step: 'any', min: 0 });
ui.segmented({ id: 'B', label: 'Bootstrap refits', options: [{ value: 100, label: '100' }, { value: 250, label: '250' }, { value: 500, label: '500' }, { value: 1000, label: '1000' }], value: 250 });
ui.toggle({ id: 'band', label: 'Show 95 % bands (bootstrap)', value: true });
ui.section('Fit by eye');
ui.toggle({ id: 'manual', label: 'Fit the focus model by hand', value: false, persist: false, help: 'Drag the parameter sliders under the chart and try to beat the optimiser’s sum of squares.' });
ui.section('Over-fitting');
ui.slider({ id: 'deg', label: 'Polynomial degree', min: 0, max: 10, step: 1, value: 3, help: 'A purely empirical curve with d + 1 coefficients.' });
ui.toggle({ id: 'poly', label: 'Draw the polynomial on the main chart', value: false });
ui.presets([
  { label: 'Lettuce FW, 5 plants', values: { ds: 'fw17', err: 'add', focus: 'best', cv: 'kfold', target: 250, logy: false } },
  { label: 'Leaf area (Lesson 10.1)', values: { ds: 'area', err: 'add', focus: 'logistic', cv: 'loo', target: 420, logy: false } },
  { label: 'Only the first two weeks', values: { ds: 'early', err: 'add', focus: 'logistic', cv: 'future', target: 250 } },
  { label: 'Proportional errors', values: { ds: 'hetero', err: 'prop', focus: 'best', cv: 'group', logy: true } },
  { label: 'Compare light levels', values: { ds: 'dli', err: 'prop', focus: 'gompertz', cv: 'kfold', target: 200 } }
]);
ui.saveButton('model-fitting', () => ro.values());
const targetUnitEl = ui.ctl.target.wrap.querySelector('.muted');
const grpSel = ui.ctl.grp.wrap.querySelector('select');

/* ======================================================================= readouts */
const ro = new Readouts('#readouts');
ro.add({ id: 'best', label: 'Best model (lowest AICc)', unit: '', format: v => v })
  .add({ id: 'r2', label: 'R² (focus model)', unit: '', digits: 4 })
  .add({ id: 'rmse', label: 'RMSE (focus model)', unit: '', digits: 2 })
  .add({ id: 'cv', label: 'Cross-validated RMSE', unit: '', digits: 2 })
  .add({ id: 'tstar', label: 'Target reached on day', unit: 'd', digits: 1 })
  .add({ id: 'runs', label: 'Residual runs test', unit: '', format: v => v })
  .add({ id: 'n', label: 'Observations (dates)', unit: '', format: v => v })
  .add({ id: 'nk', label: 'Data points per parameter n/K', unit: '', digits: 1 });

/* ======================================================================= stage & charts */
const stageEl = $('#stage');
const hud = hudChips(stageEl);
stageToolbar(stageEl, { onShot: () => { const c = stageEl.querySelector('canvas'); if (!c) return; const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = 'growth-curve-fit.png'; a.click(); } });
const mainHost = $('#mf-main');
const stageH = () => Math.max(300, stageEl.clientHeight - 64);
const main = new Plot(mainHost, { x: { label: 'Time', unit: 'd' }, y: { label: 'Size', unit: 'g', min: 0 }, legend: true, crosshair: true, height: stageH() });
window.addEventListener('resize', () => { main.box.style.height = stageH() + 'px'; main.redraw(); });
const chResid = new Plot('#ch-resid', { x: { label: 'Time', unit: 'd' }, y: { label: 'Residual', unit: '' }, legend: true });
const chCV = new BarChart('#ch-cv', { y: { label: 'RMSE', unit: '', min: 0 }, legend: true });
const chAIC = new BarChart('#ch-aic', { y: { label: 'Akaike weight', unit: '%', min: 0, max: 100 }, legend: false });
const chPoly = new Plot('#ch-poly', { x: { label: 'Polynomial degree d', min: 0, max: 10 }, y: { label: 'RMSE', unit: '', log: true }, legend: true });
const chHist = new Plot('#ch-hist', { x: { label: 'Day on which the target is reached', unit: 'd' }, y: { label: 'Bootstrap refits', min: 0 }, legend: true, crosshair: false });
const chRGR = new Plot('#ch-rgr', { x: { label: 'Size W (geometric mean of the interval)', unit: '' }, y: { label: 'Relative growth rate', unit: 'd⁻¹' }, legend: true });

/* ======================================================================= data */
let DATA = null;          // { t, y, g, unit, variable, note, gname, groups }
let dataVersion = 0;
const ta = $('#mf-text'), noteEl = $('#mf-note'), mapEl = $('#mf-map');
let GROWLOG = null;
let lastDs = null;
function setDs(v) { ui.set('ds', v, true); lastDs = v; }

function toDays(col) {
  // numeric → as is; ISO dates → days since the first date
  if (col.every(v => typeof v === 'number')) return col;
  const d = col.map(v => Date.parse(String(v)));
  if (d.every(Number.isFinite)) { const m = Math.min(...d); return d.map(v => Math.round((v - m) / 864e5 * 100) / 100); }
  return col.map(v => (typeof v === 'number' ? v : NaN));
}
function buildMapping(tab, preset) {
  const H = tab.headers; const numeric = H.filter(h => tab.columns[h].filter(v => typeof v === 'number').length >= tab.rows.length * 0.8);
  const guessT = preset?.t ?? (H.find(h => /^(day|days|t|time|dat|das|dap|date)/i.test(h)) || numeric[0] || H[0]);
  const guessY = preset?.y ?? (numeric.find(h => h !== guessT) || H[1]);
  const guessG = preset?.g ?? (H.find(h => h !== guessT && h !== guessY && !numeric.includes(h)) || H.find(h => h !== guessT && h !== guessY) || '');
  const opt = (sel) => H.map(h => `<option value="${esc(h)}"${h === sel ? ' selected' : ''}>${esc(h)}</option>`).join('');
  mapEl.innerHTML = `<label>Time column<select id="mf-mt">${opt(guessT)}</select></label><label>Value column<select id="mf-my">${opt(guessY)}</select></label><label>Group column<select id="mf-mg"><option value="">(none)</option>${opt(guessG)}</select></label>`;
  ['#mf-mt', '#mf-my', '#mf-mg'].forEach(s => $(s).addEventListener('change', () => fromText(false)));
}
/** Parse the textarea into DATA. keepMap: keep the current column mapping. */
function fromText(rebuildMap = true, meta = {}) {
  const tab = parseTable(ta.value);
  if (!tab.headers.length || tab.rows.length < 3) { DATA = null; noteEl.innerHTML = '<span class="mf-warn">Paste at least three rows: time, value and (optionally) a group label.</span>'; refresh(); return; }
  if (rebuildMap || !$('#mf-mt')) buildMapping(tab, meta.map);
  const ct = $('#mf-mt').value, cy = $('#mf-my').value, cg = $('#mf-mg').value;
  const tcol = toDays(tab.columns[ct]), ycol = tab.columns[cy], gcol = cg ? tab.columns[cg] : null;
  const t = [], y = [], g = []; let dropped = 0;
  tab.rows.forEach((r, i) => { const tv = tcol[i], yv = ycol[i]; if (typeof yv === 'number' && Number.isFinite(tv) && Number.isFinite(yv)) { t.push(tv); y.push(yv); g.push(gcol ? String(gcol[i] ?? '') : ''); } else dropped++; });
  const unit = meta.unit ?? guessUnit(cy);
  DATA = { t, y, g, unit, variable: meta.variable ?? cy, gname: cg || '', note: meta.note ?? '', dropped };
  DATA.groups = [...new Set(g)].filter(v => v !== '');
  dataVersion++;
  rebuildGroups(meta.grp);
  const n = t.length;
  noteEl.innerHTML = `${meta.note ? esc(meta.note) + '<br>' : ''}<b>${n}</b> observations on <b>${new Set(t).size}</b> dates${DATA.groups.length ? `, <b>${DATA.groups.length}</b> groups in “${esc(cg)}”` : ''}.${dropped ? ` <span class="mf-warn">${dropped} row(s) skipped (missing or non-numeric values).</span>` : ''}`;
  refresh();
}
function guessUnit(h) { h = String(h).toLowerCase(); if (/cm2|cm²|area/.test(h)) return 'cm²'; if (/height|_cm|length/.test(h)) return 'cm'; if (/fw|_g\b|mass|weight|fresh|dry|dw/.test(h)) return 'g'; if (/leaves|leaf_n|count/.test(h)) return 'leaves'; return ''; }
function rebuildGroups(pref) {
  const cur = pref ?? grpSel.value;
  const gs = DATA ? DATA.groups : [];
  const opts = [{ value: '__all', label: 'All data pooled' }];
  if (gs.length) opts.push({ value: '__means', label: 'Mean of each date' });
  gs.forEach(v => opts.push({ value: 'g:' + v, label: `${DATA.gname || 'Group'}: ${v}` }));
  grpSel.innerHTML = opts.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  const val = opts.some(o => o.value === cur) ? cur : '__all';
  ui.set('grp', val, true);
}
function loadExample(key) {
  const e = EXAMPLES[key]; if (!e) return;
  ta.value = e.text();
  GROWLOG = null; $('#mf-gl-bar').hidden = true;
  ui.set('target', e.target, true); targetUnitEl.textContent = e.unit;
  fromText(true, { unit: e.unit, variable: e.variable, note: e.note, grp: key === 'dli' ? 'g:DLI 17' : '__all' });
}
function readGrowLog() { try { const g = JSON.parse(localStorage.getItem(GL_KEY) || 'null'); return g && Array.isArray(g.rows) && g.rows.length ? g : null; } catch (e) { return null; } }
function loadGrowLog(demo = false) {
  const gl = demo ? demoGrowLog() : readGrowLog();
  if (!gl) { noteEl.innerHTML = `<span class="mf-warn">No grow log was found in this browser.</span> Record your measurements with the <a href="/project/grow-log/">Grow log (data tool)</a> first, or press <em>Try a demo grow log</em> to see how it works.`; return false; }
  GROWLOG = gl; GROWLOG.demo = demo;
  const trts = [...new Set(gl.rows.map(r => r.treatment).filter(Boolean))];
  $('#mf-gl-trt').innerHTML = `<option value="">All treatments</option>` + trts.map(t => `<option>${esc(t)}</option>`).join('');
  $('#mf-gl-bar').hidden = false;
  // real logs often have fresh mass only at harvest: pick the first variable measured on at least 4 different days
  const days = k => new Set(gl.rows.filter(r => r[k] !== '' && r[k] != null && Number.isFinite(+r[k])).map(r => r.day ?? r.date)).size;
  const best = ['fw_g', 'area_cm2', 'height_cm', 'leaves'].find(k => days(k) >= 4);
  if (best) $('#mf-gl-var').value = best;
  growLogToText();
  if (ui.get('ds') !== 'growlog' || lastDs !== 'growlog') setDs('growlog');
  return true;
}
function growLogToText() {
  const gl = GROWLOG; const v = $('#mf-gl-var').value, tr = $('#mf-gl-trt').value, by = $('#mf-gl-by').value;
  const start = Date.parse(gl.meta?.startDate || '') || Math.min(...gl.rows.map(r => Date.parse(r.date)).filter(Number.isFinite));
  const rows = gl.rows.filter(r => !tr || r.treatment === tr).map(r => {
    const day = Number.isFinite(+r.day) && r.day !== '' && r.day != null ? +r.day : (Date.parse(r.date) - start) / 864e5;
    return [Math.round(day * 100) / 100, r[v], by === 'plant' ? (r.plant ?? '') : by === 'treatment' ? (r.treatment ?? '') : ''];
  }).filter(r => Number.isFinite(r[0]) && r[1] !== '' && r[1] != null && Number.isFinite(+r[1]));
  const V = VARS[v];
  ta.value = `day,${v}${by !== 'none' ? ',' + by : ''}\n` + rows.map(r => by !== 'none' ? r.join(',') : `${r[0]},${r[1]}`).join('\n');
  ui.set('target', V.target, true); targetUnitEl.textContent = V.unit;
  const title = gl.demo ? 'Demo grow log (SIMULATED data in the course format)' : `Your grow log${gl.meta?.title ? ' “' + gl.meta.title + '”' : ''}${gl.meta?.crop ? ' · ' + gl.meta.crop : ''}`;
  fromText(true, { unit: V.unit, variable: V.label, note: `${title}: ${V.label.toLowerCase()}${tr ? ', treatment “' + tr + '”' : ''}.`, map: { t: 'day', y: v, g: by !== 'none' ? by : '' } });
}
function loadVisionSeries() {
  let s = null; try { s = JSON.parse(localStorage.getItem(PV_KEY) || 'null'); } catch (e) { s = null; }
  if (!s || !Array.isArray(s.rows) || !s.rows.length) { noteEl.innerHTML = `<span class="mf-warn">No image series found.</span> Open the <a href="/laboratories/plant-vision/">Plant vision lab</a>, press <em>Photograph the crop every 3 days</em>, and come back.`; return false; }
  GROWLOG = null; $('#mf-gl-bar').hidden = true;
  ta.value = 'day,area_cm2,plant\n' + s.rows.map(r => `${r.day},${r.area_cm2},${r.plant}`).join('\n');
  ui.set('target', 150, true); targetUnitEl.textContent = 'cm²';
  fromText(true, { unit: 'cm²', variable: 'Projected leaf area (from images)', note: `Projected leaf areas measured by YOUR segmentation pipeline in the Plant vision lab (${s.meta?.created ? new Date(s.meta.created).toLocaleString() : ''}); synthetic images.` });
  return true;
}

$('#mf-fit').addEventListener('click', () => { GROWLOG = null; $('#mf-gl-bar').hidden = true; setDs('pasted'); fromText(true, { unit: DATA?.unit ?? '' }); });
$('#mf-growlog').addEventListener('click', () => { loadGrowLog(false); });
$('#mf-demo').addEventListener('click', () => { loadGrowLog(true); });
['#mf-gl-var', '#mf-gl-trt', '#mf-gl-by'].forEach(s => $(s).addEventListener('change', () => GROWLOG && growLogToText()));
$('#mf-dl-data').addEventListener('click', () => {
  if (!DATA || !FITS) return;
  const S = selection(); const keys = MODEL_KEYS.filter(k => FITS[k].ok);
  downloadCSV('growth-fits.csv', ['time_d', 'value', 'group', ...keys.map(k => 'fit_' + k)], S.t.map((x, i) => [x, S.y[i], S.g[i], ...keys.map(k => +FITS[k].predict(x).toPrecision(6))]));
});
$('#mf-dl-table').addEventListener('click', () => {
  if (!FITS) return;
  const rows = MODEL_KEYS.map(k => { const f = FITS[k]; if (!f.ok) return [MODELS[k].label, f.k, '', '', '', '', '', '', '', f.why]; return [MODELS[k].label, f.k, ...[f.r2, f.rmse, f.aicc, f.dAicc, f.w, f.bic, CV[k]?.rmse].map(v => (Number.isFinite(v) ? +v.toPrecision(6) : '')), f.params.map((p, i) => `${MODELS[k].names[i]}=${+p.toPrecision(5)}±${+f.se[i].toPrecision(3)}`).join('; ')]; });
  downloadCSV('growth-model-comparison.csv', ['model', 'p', 'R2', 'RMSE', 'AICc', 'dAICc', 'akaike_weight', 'BIC', 'CV_RMSE', 'parameters'], rows);
});

/* ======================================================================= selection & fitting */
function selection() {
  if (!DATA) return null;
  const gv = ui.get('grp') || '__all';
  let t = DATA.t, y = DATA.y, g = DATA.g;
  if (gv.startsWith('g:')) { const k = gv.slice(2); const idx = g.map((v, i) => i).filter(i => g[i] === k); t = idx.map(i => DATA.t[i]); y = idx.map(i => DATA.y[i]); g = idx.map(() => k); }
  else if (gv === '__means') { const m = meansByTime(DATA.t, DATA.y); t = m.map(o => o.t); y = m.map(o => o.y); g = m.map(() => 'mean'); }
  // sort by time (stable) so residuals are in time order
  const idx = t.map((v, i) => i).sort((a, b) => t[a] - t[b] || a - b);
  return { t: idx.map(i => t[i]), y: idx.map(i => y[i]), g: idx.map(i => g[i]) };
}
let FITS = null, fitKey = '', CV = {}, cvKey = '', POLY = null, polyKey = '', BOOT = null, bootKey = '', bootRunner = null, bootTimer = null;
const focusKey = () => { const f = ui.get('focus'); return f === 'best' ? FITS?.best : (FITS?.[f]?.ok ? f : FITS?.best); };
const tRange = S => [Math.min(...S.t), Math.max(...S.t)];

function refresh() {
  const p = ui.values();
  if (!DATA) { FITS = null; drawAll(); return; }
  const S = selection();
  $('#mf-warn2').textContent = S.t.length < 4 ? 'This selection has fewer than 4 points — choose another “Fit to” option.' : '';
  if (S.t.length < 4) { FITS = null; drawAll(); return; }
  const key = [dataVersion, p.grp, p.err].join('|');
  if (key !== fitKey) { FITS = fitAll(S.t, S.y, { log: p.err === 'prop' }); fitKey = key; CV = {}; cvKey = ''; POLY = null; polyKey = ''; BOOT = null; bootKey = ''; syncManual(true); }
  drawAll();
  scheduleHeavy();
}

/* ---------- asynchronous heavy work: CV, polynomials, bootstrap */
let heavyT = null;
function scheduleHeavy() { clearTimeout(heavyT); heavyT = setTimeout(runHeavy, 60); }
function runHeavy() {
  if (!FITS) return;
  const p = ui.values(); const S = selection();
  let scheme = p.cv; if (scheme === 'group' && new Set(S.g).size < 3) scheme = 'kfold';
  if (scheme === 'loo' && S.t.length > 60) scheme = 'kfold-auto';
  const ck = fitKey + '|' + scheme;
  if (ck !== cvKey) {
    cvKey = ck; CV = {}; const keys = [...MODEL_KEYS]; const log = p.err === 'prop';
    const next = () => {
      if (cvKey !== ck) return; const k = keys.shift(); if (!k) { drawCV(); drawReadouts(); return; }
      CV[k] = FITS[k].ok ? cvModel(k, S.t, S.y, S.g, { log, scheme: scheme === 'kfold-auto' ? 'kfold' : scheme, seed: 11 }) : { rmse: NaN };
      if (scheme === 'kfold-auto') CV[k].note = '5-fold (leave-one-out would need > 60 refits per model)';
      drawCV(); drawTable(); drawReadouts(); setTimeout(next, 0);
    };
    next();
  }
  const pk = fitKey + '|' + (scheme === 'future' ? 'future' : 'loo');
  if (pk !== polyKey) {
    polyKey = pk;
    setTimeout(() => { if (polyKey !== pk) return; const yy = p.err === 'prop' ? S.y.map(v => (v > 0 ? Math.log(v) : NaN)) : S.y; POLY = S.y.every(v => Number.isFinite(p.err === 'prop' ? Math.log(v) : v)) ? polyCurve(S.t, yy, 10, { scheme: scheme === 'future' ? 'future' : 'loo' }) : []; drawPoly(); drawMain(); }, 10);
  }
  startBootstrap();
}
function startBootstrap() {
  const fk = focusKey(); if (!fk) return;
  const p = ui.values(); const fit = FITS[fk]; const S = selection();
  const bk = [fitKey, fk, p.B, p.target].join('|');
  if (bk === bootKey) return;
  bootKey = bk; BOOT = null; clearTimeout(bootTimer);
  const [a, b] = tRange(S); const R = b - a;
  const tMax = a + 6 * R;
  const grid = linspace(a, xMaxFor(S, fit), 140);
  bootRunner = makeBootstrap(fit, S.t, S.y, { B: +p.B, grid, target: +p.target, tMax, seed: 7 });
  bootRunner.grid = grid;
  const tick = () => {
    if (bootKey !== bk) return;
    const t0 = performance.now(); let frac = 0;
    while (performance.now() - t0 < 30) { frac = bootRunner.step(5); if (frac >= 1) break; }
    if (frac >= 1) { BOOT = bootRunner.result(); BOOT.grid = grid; drawMain(); drawHist(); drawReadouts(); drawParams(); }
    else { hud.set('fc', `Parametric bootstrap… <b>${Math.round(frac * 100)} %</b>`); bootTimer = setTimeout(tick, 0); }
  };
  tick();
}
/** x-axis end: show the forecast of the focus model (target day + margin) but not absurdly far. */
function xMaxFor(S, fit) {
  const [a, b] = tRange(S); const R = Math.max(1e-9, b - a);
  let x = b + 0.15 * R;
  const ts = fit ? timeTo(fit.predict, +ui.get('target'), a, a + 6 * R) : NaN;
  if (Number.isFinite(ts)) x = Math.max(x, Math.min(ts + 0.12 * R, b + 1.5 * R));
  return x;
}

/* ======================================================================= drawing */
function drawAll() { drawMain(); drawTable(); drawParams(); drawGroups(); drawResid(); drawCV(); drawAIC(); drawPoly(); drawHist(); drawRGR(); drawReadouts(); drawManualUI(); }

function unitY() { return DATA?.unit || ''; }
function drawMain() {
  main.clear();
  if (!DATA || !FITS) { hud.set('model', 'No data — paste a table below or choose a data set'); return; }
  const p = ui.values(); const S = selection(); const fk = focusKey(); const fit = FITS[fk];
  const [a, b] = tRange(S); const xmax = xMaxFor(S, fit);
  main.ax.y.label = DATA.variable || 'Size'; main.ax.y.unit = unitY(); main.ax.y.log = !!p.logy; main.ax.y.min = p.logy ? 'auto' : 0;
  main.setAxis('x', { min: Math.min(0, a), max: xmax });
  const grid = linspace(Math.min(0, a), xmax, 220);
  // y range: data, focus curve, its bands and the target — not the wild extrapolations of other models
  if (!p.logy) {
    let top = Math.max(...S.y, +p.target || 0);
    if (fit) top = Math.max(top, ...grid.map(fit.predict).filter(Number.isFinite));
    if (p.band && BOOT && BOOT.grid) top = Math.max(top, ...BOOT.hi.filter(Number.isFinite));
    main.ax.y.max = top * 1.06;
  } else main.ax.y.max = 'auto';
  if (xmax > b) main.region('fc', b, xmax, { color: 'muted', alpha: 0.06, label: 'forecast' });
  // bands
  if (p.band && BOOT && BOOT.grid && fk) {
    const yFloor = 0.5 * Math.min(...S.y.filter(v => v > 0));
    main.band('pi', BOOT.grid, BOOT.plo.map(v => (p.logy ? Math.max(v, yFloor) : v)), BOOT.phi, { color: MODELS[fk].color, alpha: 0.08, label: '95 % prediction band (one plant)' });
    main.band('ci', BOOT.grid, BOOT.lo.map(v => (p.logy ? Math.max(v, yFloor) : v)), BOOT.hi, { color: MODELS[fk].color, alpha: 0.22, label: '95 % band of the curve' });
  }
  // curves
  MODEL_KEYS.forEach(k => {
    const f = FITS[k]; if (!f.ok) return;
    if (k !== fk && !p.all) return;
    main.line('m-' + k, grid, grid.map(f.predict), { color: MODELS[k].color, width: k === fk ? 3.2 : 1.6, dash: k === fk ? null : [5, 4], label: MODELS[k].label + (k === fk ? ' (focus)' : ''), opacity: k === fk ? 1 : 0.85 });
  });
  if (p.poly && POLY) {
    const yy = p.err === 'prop' ? S.y.map(Math.log) : S.y; const pf = polyFit(S.t, yy, Math.min(p.deg, S.t.length - 2), tRange(S));
    if (pf.ok) main.line('poly', grid, grid.map(x => (p.err === 'prop' ? Math.exp(pf.predict(x)) : pf.predict(x))), { color: 'c7', width: 2, dash: [2, 3], label: `Polynomial, degree ${Math.min(p.deg, S.t.length - 2)}` });
  }
  // manual curve & squared residuals
  if (p.manual && MAN && fk) {
    const f = x => MODELS[fk].f(x, MAN.p);
    main.line('man', grid, grid.map(f), { color: 'magenta', width: 2.4, dash: [7, 4], label: 'Your curve' });
    main.custom('sq', (ctx, pl, P) => {
      if (S.t.length > 90) return;
      ctx.strokeStyle = withAlpha(P.magenta, 0.8); ctx.fillStyle = withAlpha(P.magenta, 0.10); ctx.lineWidth = 1;
      S.t.forEach((x, i) => { const X = pl.px(x), Y = pl.py(S.y[i]), Yh = pl.py(f(x)); if (!Number.isFinite(Yh)) return; const d = Yh - Y; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X, Yh); ctx.stroke(); ctx.fillRect(X, Math.min(Y, Yh), Math.abs(d), Math.abs(d)); });
    });
  }
  // data by group
  const gs = [...new Set(S.g)];
  if (gs.length > 1 && gs.length <= 10) gs.forEach((gv, j) => { const idx = S.g.map((v, i) => i).filter(i => S.g[i] === gv); main.scatter('d-' + j, idx.map(i => S.t[i]), idx.map(i => S.y[i]), { color: categorical(j + 1), r: 4, label: gv, shape: ['circle', 'square', 'triangle', 'diamond'][j % 4] }); });
  else main.scatter('d', S.t, S.y, { color: 'ink', r: 4, label: gs[0] === 'mean' ? 'Means per date' : 'Observations' });
  // target and forecast
  const W = +p.target;
  if (W > 0) {
    main.hline('target', W, { color: 'amber', label: `target ${sig(W)} ${unitY()}` });
    const ts = fit ? timeTo(fit.predict, W, a, a + 6 * (b - a)) : NaN;
    if (Number.isFinite(ts) && ts <= xmax) { main.vline('ts', ts, { color: 'magenta', label: `day ${fmt(ts, 1)}` }); main.point('tsp', ts, W, { color: 'magenta', r: 5 }); }
  }
  // HUD
  if (fk) hud.set('model', `Focus: <b>${MODELS[fk].label}</b> · w = <b>${(fit.w ?? 0) < 0.001 ? '&lt; 0.1' : fmt((fit.w ?? NaN) * 100, (fit.w ?? 0) < 0.1 ? 1 : 0)} %</b> · R² <b>${fmt(fit.r2, 3)}</b>`);
  const ts = fit ? timeTo(fit.predict, W, a, a + 6 * (b - a)) : NaN;
  hud.set('fc', W > 0 ? (Number.isFinite(ts) ? `W* = ${sig(W)} ${unitY()} on day <b>${fmt(ts, 1)}</b>${BOOT && BOOT.tstar.length > 5 ? ` (95 %: ${fmt(BOOT.tq[0], 1)}–${fmt(BOOT.tq[2], 1)})` : ''}` : `W* = ${sig(W)} ${unitY()} <b>not reached</b> by this curve`) : 'Set a target size to forecast the harvest');
}

function drawTable() {
  const el = $('#mf-table'); if (!FITS) { el.innerHTML = ''; return; }
  const fk = focusKey(); const scheme = ui.get('cv');
  const cvName = { kfold: '5-fold CV', loo: 'LOO CV', future: 'future CV', group: 'by-plant CV' }[scheme] || 'CV';
  const W = +ui.get('target'); const S = selection(); const [a, b] = tRange(S);
  el.innerHTML = `<caption>Model comparison on ${S.t.length} observations (${ui.get('err') === 'prop' ? 'proportional errors: statistics on the ln scale' : 'additive errors: statistics in ' + (unitY() || 'data units')}). Click a row to put that model in focus.</caption>
  <thead><tr><th>Model</th><th class="num">p</th><th class="num">R²</th><th class="num">RMSE</th><th class="num">${cvName} RMSE</th><th class="num">AICc</th><th class="num">ΔAICc</th><th class="num">Akaike weight</th><th class="num">BIC</th><th class="num">Day of W*</th></tr></thead><tbody>` +
    MODEL_KEYS.map(k => {
      const f = FITS[k];
      if (!f.ok) return `<tr class="mf-na"><td><i class="mf-sw" style="background:${resolveColor(MODELS[k].color)}"></i>${MODELS[k].label}</td><td class="num">${MODELS[k].k}</td><td colspan="8" class="muted">not fitted — ${esc(f.why)}</td></tr>`;
      const ts = W > 0 ? timeTo(f.predict, W, a, a + 6 * (b - a)) : NaN;
      const cvv = CV[k]?.rmse;
      const warn = f.atBound.some(Boolean) ? ' <span class="mf-flag" title="A parameter sits on its bound: the model has collapsed to a simpler one; its SEs are unreliable">bound</span>' : (!f.converged ? ' <span class="mf-flag" title="Levenberg–Marquardt stopped at the iteration limit">slow</span>' : '');
      return `<tr data-k="${k}" class="${k === fk ? 'mf-focus' : ''}${k === FITS.best ? ' mf-best' : ''}"><td><i class="mf-sw" style="background:${resolveColor(MODELS[k].color)}"></i>${MODELS[k].label}${k === FITS.best ? ' <span class="mf-flag ok">best</span>' : ''}${warn}</td><td class="num">${f.k}</td><td class="num">${fmt(f.r2, 4)}</td><td class="num">${sig(f.rmse, 4)}</td><td class="num">${cvv == null ? '…' : sig(cvv, 4)}</td><td class="num">${fmt(f.aicc, 2)}</td><td class="num">${fmt(f.dAicc, 2)}</td><td class="num">${f.w < 0.001 ? '&lt; 0.001' : fmt(f.w, 3)}</td><td class="num">${fmt(f.bic, 2)}</td><td class="num">${Number.isFinite(ts) ? fmt(ts, 1) : '—'}</td></tr>`;
    }).join('') + '</tbody>';
  el.querySelectorAll('tr[data-k]').forEach(tr => tr.addEventListener('click', () => ui.set('focus', tr.dataset.k)));
}

function drawParams() {
  const el = $('#mf-params'); if (!FITS) { el.innerHTML = ''; return; }
  const fk = focusKey(); if (!fk) { el.innerHTML = ''; return; }
  const f = FITS[fk], M = MODELS[fk]; const units = M.units({ y: unitY() || 'units' });
  const bse = BOOT && BOOT.paramSE && bootKey.startsWith(fitKey + '|' + fk + '|') ? BOOT.paramSE : null;
  const dq = derived(fk, f.params).map(d => ({ ...d, unit: d.unit.replace(/^y/, unitY() || 'units') }));
  el.innerHTML = `<caption><b>${M.label}</b>: ${esc(M.eq)} — estimates with standard errors from the Levenberg–Marquardt Jacobian, 95 % confidence intervals (t with ${f.n - f.k} df)${bse ? ' and bootstrap standard errors' : ''}.</caption>
  <thead><tr><th>Parameter</th><th class="num">Estimate</th><th class="num">SE</th>${bse ? '<th class="num">Bootstrap SE</th>' : ''}<th class="num">95 % CI</th><th>Unit</th><th>What it means biologically</th></tr></thead><tbody>` +
    f.params.map((v, i) => `<tr><td>\\(${M.tex[i]}\\)</td><td class="num">${sig(v, 4)}</td><td class="num">${sig(f.se[i], 3)}${f.atBound[i] ? ' <span class="mf-flag">bound</span>' : ''}</td>${bse ? `<td class="num">${sig(bse[i], 3)}</td>` : ''}<td class="num">${sig(f.ci[i][0], 3)} … ${sig(f.ci[i][1], 3)}</td><td>${units[i]}</td><td>${M.meaning[i]}</td></tr>`).join('') +
    dq.map(d => `<tr class="mf-derived"><td colspan="1">derived</td><td class="num">${sig(d.value, 4)}</td><td class="num">—</td>${bse ? '<td></td>' : ''}<td></td><td>${d.unit}</td><td>${d.name}</td></tr>`).join('') + '</tbody>';
  if (window.FFP && FFP.renderMath) FFP.renderMath(el);
}

function drawGroups() {
  const el = $('#mf-groups'); const wrap = $('#mf-groups-wrap');
  if (!DATA || !FITS || DATA.groups.length < 2) { wrap.hidden = true; return; }
  const fk = focusKey(); if (!fk) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const M = MODELS[fk]; const log = ui.get('err') === 'prop'; const W = +ui.get('target');
  const rows = DATA.groups.slice(0, 40).map(gv => {
    const idx = DATA.g.map((v, i) => i).filter(i => DATA.g[i] === gv);
    const t = idx.map(i => DATA.t[i]), y = idx.map(i => DATA.y[i]);
    const f = t.length >= M.k + 2 ? fitAllOne(fk, t, y, log) : null;
    const ts = f && f.ok && W > 0 ? timeTo(f.predict, W, Math.min(...t), Math.min(...t) + 6 * (Math.max(...t) - Math.min(...t))) : NaN;
    return `<tr><td>${esc(gv)}</td><td class="num">${t.length}</td>${M.names.map((_, i) => `<td class="num">${f && f.ok ? `${sig(f.params[i], 4)} <span class="muted">± ${sig(f.se[i], 2)}</span>` : '—'}</td>`).join('')}<td class="num">${f && f.ok ? fmt(f.r2, 3) : (f ? esc(f.why) : 'too few points')}</td><td class="num">${Number.isFinite(ts) ? fmt(ts, 1) : '—'}</td></tr>`;
  });
  el.innerHTML = `<caption>${M.label} fitted separately to each ${esc(DATA.gname || 'group')} — the recommended way to compare treatments: fit per plant, then compare the parameters with a t-test or ANOVA in the <a href="/laboratories/statistics-workbench/">Statistics workbench</a>.</caption><thead><tr><th>${esc(DATA.gname || 'Group')}</th><th class="num">n</th>${M.names.map((_, i) => `<th class="num">\\(${M.tex[i]}\\)</th>`).join('')}<th class="num">R²</th><th class="num">Day of W*</th></tr></thead><tbody>${rows.join('')}</tbody>`;
  if (window.FFP && FFP.renderMath) FFP.renderMath(el);
}
const groupCache = new Map();
function fitAllOne(k, t, y, log) { const key = [dataVersion, k, log, t.join(','), y.join(',')].join('|'); if (!groupCache.has(key)) { if (groupCache.size > 200) groupCache.clear(); groupCache.set(key, fitModel(k, t, y, { log })); } return groupCache.get(key); }

function drawResid() {
  chResid.clear(); if (!FITS) return;
  const fk = focusKey(); if (!fk) return; const f = FITS[fk]; const S = selection();
  const log = ui.get('err') === 'prop';
  chResid.ax.y.unit = log ? 'ln units' : unitY(); chResid.ax.y.label = log ? 'Residual of ln W' : 'Residual';
  const s = f.s; const [a, b] = tRange(S);
  chResid.band('2s', [a, b], [-2 * s, -2 * s], [2 * s, 2 * s], { color: 'muted', alpha: 0.12, label: '±2 s' });
  chResid.hline('zero', 0, { color: 'muted', dash: [2, 2] });
  chResid.scatter('r', S.t, f.residuals, { color: MODELS[fk].color, r: 3.6, label: `${MODELS[fk].label} residuals` });
  const rt = runsTest(f.residuals);
  $('#ch-resid-sub').innerHTML = `Residuals of the ${MODELS[fk].label.toLowerCase()} fit in time order. A good model leaves a patternless band around zero. Runs test: <b>${Number.isFinite(rt.runs) ? rt.runs : '—'}</b> runs of equal sign (≈ ${fmt(rt.expected, 1)} expected if random), p = <b>${fmt(rt.p, 3)}</b>${rt.p < 0.05 ? ' — <span class="mf-warn">systematic pattern: the curve has the wrong shape</span>' : ''}.`;
}
function drawCV() {
  if (!FITS) { chCV.set([], []); return; }
  const keys = MODEL_KEYS.filter(k => FITS[k].ok);
  chCV.y.unit = ui.get('err') === 'prop' ? 'ln units' : unitY();
  chCV.set(keys.map(k => MODELS[k].label), [
    { label: 'Training RMSE (fit to all data)', values: keys.map(k => FITS[k].rmse), color: 'c6', format: v => sig(v, 3) },
    { label: 'Cross-validated RMSE (unseen data)', values: keys.map(k => CV[k]?.rmse ?? NaN), color: 'magenta', format: v => sig(v, 3) }
  ]);
  const note = Object.values(CV).find(c => c && c.note)?.note;
  $('#ch-cv-sub').textContent = `Every model fits its own training data better than data it has not seen. The gap between the bars is the optimism of in-sample fit${note ? ` (${note})` : ''}.`;
}
function drawAIC() {
  if (!FITS) { chAIC.set([], []); return; }
  const keys = MODEL_KEYS.filter(k => FITS[k].ok);
  chAIC.set(keys.map(k => MODELS[k].label), [{ label: 'Akaike weight', values: keys.map(k => 100 * (FITS[k].w ?? 0)), colors: keys.map(k => MODELS[k].color), format: v => (v < 0.05 ? '< 0.1 %' : fmt(v, 1) + ' %') }]);
}
function drawPoly() {
  chPoly.clear(); if (!POLY || !POLY.length) return;
  const d = POLY.map(o => o.d);
  chPoly.line('tr', d, POLY.map(o => Math.max(o.train, 1e-9)), { color: 'c6', width: 2.2, label: 'Training RMSE' });
  chPoly.scatter('trp', d, POLY.map(o => Math.max(o.train, 1e-9)), { color: 'c6', r: 3 });
  chPoly.line('cv', d, POLY.map(o => o.cv), { color: 'magenta', width: 2.4, label: ui.get('cv') === 'future' ? 'Future-30 % RMSE' : 'Leave-one-out RMSE' });
  chPoly.scatter('cvp', d, POLY.map(o => o.cv), { color: 'magenta', r: 3 });
  const fk = focusKey(); if (fk && CV[fk] && Number.isFinite(CV[fk].rmse)) chPoly.hline('gm', CV[fk].rmse, { color: MODELS[fk].color, label: `${MODELS[fk].label} (CV)` });
  const deg = Math.min(ui.get('deg'), d[d.length - 1]);
  chPoly.vline('deg', deg, { color: 'amber', label: `d = ${deg}` });
  const best = POLY.reduce((a, o) => (o.cv < a.cv ? o : a), POLY[0]);
  $('#ch-poly-sub').innerHTML = `Training error always falls as coefficients are added; the error on left-out data reaches a minimum (here at <b>d = ${best.d}</b>) and then rises: over-fitting. A growth function with 3 parameters usually beats any polynomial — and extrapolates sensibly.`;
}
function drawHist() {
  chHist.clear();
  if (!BOOT || !BOOT.tstar.length) { $('#ch-hist-sub').textContent = BOOT ? 'The target is not reached by any bootstrap curve — lower the target or collect later data.' : 'Running the bootstrap…'; return; }
  const ts = BOOT.tstar; const lo = Math.min(...ts), hi = Math.max(...ts);
  const H = histogram(ts, Math.min(30, Math.max(8, Math.round(Math.sqrt(ts.length)))), lo, hi === lo ? lo + 1 : hi);
  const ymax = Math.max(...H.counts);
  chHist.setAxis('x', { min: H.edges[0] - H.width, max: H.edges[H.edges.length - 1] + H.width });
  chHist.setAxis('y', { min: 0, max: ymax * 1.15 });
  chHist.custom('bars', (ctx, pl, P) => { const fk = focusKey(); ctx.fillStyle = withAlpha(resolveColor(fk ? MODELS[fk].color : 'accent'), 0.55); H.counts.forEach((c, i) => { const x0 = pl.px(H.edges[i]), x1 = pl.px(H.edges[i + 1]), y0 = pl.py(0), y1 = pl.py(c); ctx.fillRect(x0 + 0.5, y1, Math.max(1, x1 - x0 - 1), y0 - y1); }); });
  chHist.line('dummy', [H.edges[0], H.edges[H.edges.length - 1]], [0, 0], { color: 'muted', width: 0.5, noTip: true });
  chHist.vline('med', BOOT.tq[1], { color: 'magenta', label: `median ${fmt(BOOT.tq[1], 1)}` });
  chHist.region('ci', BOOT.tq[0], BOOT.tq[2], { color: 'magenta', alpha: 0.08 });
  $('#ch-hist-sub').innerHTML = `${BOOT.n} parametric-bootstrap refits of the focus model. 95 % of them reach the target between day <b>${fmt(BOOT.tq[0], 1)}</b> and <b>${fmt(BOOT.tq[2], 1)}</b>${BOOT.fracReached < 0.999 ? `; <span class="mf-warn">${fmt(100 * (1 - BOOT.fracReached), 0)} % never reach it</span> (asymptote below the target)` : ''}.`;
}
function drawRGR() {
  chRGR.clear(); if (!FITS) return;
  const S = selection(); const m = meansByTime(S.t, S.y).filter(o => o.g > 0);
  const xs = [], ys = [];
  for (let i = 1; i < m.length; i++) { const dt = m[i].t - m[i - 1].t; if (dt <= 0) continue; xs.push(Math.sqrt(m[i].g * m[i - 1].g)); ys.push(Math.log(m[i].g / m[i - 1].g) / dt); }
  chRGR.ax.x.unit = unitY();
  chRGR.scatter('obs', xs, ys, { color: 'ink', r: 4, label: 'Between consecutive dates (data)' });
  const fk = focusKey(); const [a, b] = tRange(S);
  [...new Set([fk, 'logistic', 'gompertz', 'expolinear'])].forEach(k => {
    const f = FITS[k]; if (!f || !f.ok) return;
    const tt = linspace(a, b, 120); const W = tt.map(f.predict); const R = tt.map(x => rgrOf(f.predict, x));
    const pts = W.map((w, i) => [w, R[i]]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] > 0);
    chRGR.line('r-' + k, pts.map(p => p[0]), pts.map(p => p[1]), { color: MODELS[k].color, width: k === fk ? 2.8 : 1.4, dash: k === fk ? null : [5, 4], label: MODELS[k].label });
  });
  chRGR.hline('z', 0, { color: 'muted', dash: [2, 2] });
}
function drawReadouts() {
  if (!FITS) { ['best', 'r2', 'rmse', 'cv', 'tstar', 'runs', 'n', 'nk'].forEach(k => ro.set(k, '—')); return; }
  const fk = focusKey(); const f = FITS[fk]; const S = selection(); const [a, b] = tRange(S);
  const u = ui.get('err') === 'prop' ? 'ln units' : unitY();
  ro.items.rmse.unit = u; ro.items.cv.unit = u;
  const B = FITS[FITS.best];
  ro.set('best', MODELS[FITS.best].label, B.w > 0.6 ? 'ok' : 'warn', `Akaike weight ${fmt(B.w * 100, 0)} %${B.w < 0.6 ? ' — other models are nearly as good' : ''}`);
  ro.set('r2', f.r2, null, `${MODELS[fk].label}; high R² alone proves little`);
  ro.set('rmse', f.rmse, null, `residual SD s = ${sig(f.s, 3)}`);
  const cv = CV[fk]?.rmse; const ratio = cv / f.rmse;
  ro.set('cv', cv ?? NaN, Number.isFinite(ratio) ? (ratio < 1.3 ? 'ok' : ratio < 2 ? 'warn' : 'bad') : null, Number.isFinite(ratio) ? `${fmt(ratio, 2)} × the training RMSE` : 'computing…');
  const W = +ui.get('target'); const ts = W > 0 ? timeTo(f.predict, W, a, a + 6 * (b - a)) : NaN;
  const wid = BOOT && BOOT.tstar.length > 5 ? BOOT.tq[2] - BOOT.tq[0] : NaN;
  ro.set('tstar', ts, Number.isFinite(ts) ? (Number.isFinite(wid) ? (wid < 4 ? 'ok' : wid < 10 ? 'warn' : 'bad') : null) : 'bad', Number.isFinite(ts) ? (Number.isFinite(wid) ? `95 %: ${fmt(BOOT.tq[0], 1)}–${fmt(BOOT.tq[2], 1)} d${ts > b ? ' · extrapolated' : ''}` : 'bootstrap running…') : 'not reached');
  const rt = runsTest(f.residuals);
  ro.set('runs', Number.isFinite(rt.p) ? `p = ${fmt(rt.p, 3)}` : '—', Number.isFinite(rt.p) ? (rt.p < 0.05 ? 'bad' : 'ok') : null, Number.isFinite(rt.p) ? (rt.p < 0.05 ? 'residuals clump: wrong shape' : 'no clear pattern') : 'too few sign changes');
  ro.set('n', `${S.t.length} (${new Set(S.t).size})`);
  const nk = S.t.length / (f.k + 1);
  ro.set('nk', nk, nk >= 5 ? 'ok' : nk >= 3 ? 'warn' : 'bad', nk < 3 ? 'too few data for this model' : `K = p + 1 = ${f.k + 1}`);
}

/* ======================================================================= fit by eye */
let MAN = null;             // { key, p: [...], lo: [...], hi: [...] }
const manEl = $('#mf-manual');
function manualRanges(fk, S) {
  const M = MODELS[fk]; const f = FITS[fk]; const [a, b] = tRange(S); const R = Math.max(1e-9, b - a); const ym = Math.max(...S.y.map(Math.abs));
  return M.names.map((nm, i) => {
    const v = f.ok ? f.params[i] : M.starts(S.t, S.y)[0][i];
    if (nm === 'ti' || nm === 'tb') return [a - 0.5 * R, b + 1.5 * R];
    if (nm === 'nu') return [0.01, 5];
    if (nm === 'a') return [-ym, ym];
    if (nm === 'K') return [0.3 * ym, Math.max(3 * ym, 1.5 * v)];
    return [0, Math.max(2.5 * Math.abs(v), 1e-6)];
  });
}
function syncManual(reset) {
  if (!FITS) { MAN = null; return; }
  const fk = focusKey(); if (!fk) { MAN = null; return; }
  if (!reset && MAN && MAN.key === fk) return;
  const S = selection(); const M = MODELS[fk];
  const guess = M.starts(S.t, S.y)[0].map((v, i) => { const nm = M.names[i]; return nm === 'K' ? v * 1.35 : nm === 'r' || nm === 'rm' ? v * 0.6 : nm === 'ti' || nm === 'tb' ? v + 0.12 * (tRange(S)[1] - tRange(S)[0]) : nm === 'nu' ? 1 : nm === 'W0' ? v * 1.8 : nm === 'b' ? v * 0.8 : v; });
  const rg = manualRanges(fk, S);
  MAN = { key: fk, p: guess.map((v, i) => Math.min(rg[i][1], Math.max(rg[i][0], v))), rg };
}
function manSSE() { const S = selection(); const M = MODELS[MAN.key]; const log = ui.get('err') === 'prop'; let s = 0; S.t.forEach((x, i) => { const v = M.f(x, MAN.p); const e = log ? Math.log(S.y[i]) - Math.log(v) : S.y[i] - v; s += e * e; }); return s; }
function drawManualUI() {
  const on = ui.get('manual') && FITS && MAN;
  manEl.hidden = !on; if (!on) return;
  const fk = focusKey(); if (MAN.key !== fk) syncManual(true);
  const M = MODELS[MAN.key]; const units = M.units({ y: unitY() || 'units' });
  if (manEl.dataset.key !== MAN.key + '|' + fitKey) {
    manEl.dataset.key = MAN.key + '|' + fitKey;
    manEl.innerHTML = `<div class="mf-man-head"><b>Fit the ${M.label.toLowerCase()} model by eye</b><span class="muted">${esc(M.eq)}</span></div>
      <div class="mf-man-grid">${M.names.map((nm, i) => `<div class="mc-var"><div class="mc-lab"><span>\\(${M.tex[i]}\\) <span class="muted">(${units[i]})</span></span><output id="mf-mo-${i}"></output></div><input type="range" id="mf-ms-${i}" min="${MAN.rg[i][0]}" max="${MAN.rg[i][1]}" step="${(MAN.rg[i][1] - MAN.rg[i][0]) / 400}" aria-label="${nm}"></div>`).join('')}</div>
      <div class="mf-man-bar"><div class="mf-man-ro" id="mf-man-ro"></div><div class="mf-man-btns"><button class="btn btn-sm" type="button" id="mf-man-naive">New starting guess</button><button class="btn btn-sm btn-primary" type="button" id="mf-man-lm">Let Levenberg–Marquardt finish from my guess</button></div></div>`;
    M.names.forEach((_, i) => { const r = $('#mf-ms-' + i); r.addEventListener('input', () => { MAN.p[i] = +r.value; updManual(); drawMain(); }); });
    $('#mf-man-naive').addEventListener('click', () => { syncManual(true); updManual(true); drawMain(); });
    $('#mf-man-lm').addEventListener('click', animateLM);
    if (window.FFP && FFP.renderMath) FFP.renderMath(manEl);
  }
  updManual(true);
}
function updManual(setSliders) {
  if (!MAN) return; const M = MODELS[MAN.key];
  M.names.forEach((_, i) => { const r = $('#mf-ms-' + i); if (!r) return; if (setSliders) r.value = MAN.p[i]; r.style.setProperty('--fill', ((MAN.p[i] - MAN.rg[i][0]) / (MAN.rg[i][1] - MAN.rg[i][0]) * 100) + '%'); $('#mf-mo-' + i).textContent = sig(MAN.p[i], 4); });
  const s = manSSE(), opt = FITS[MAN.key].ok ? FITS[MAN.key].sse : NaN; const ratio = s / opt;
  const lg = ui.get('err') === 'prop';
  $('#mf-man-ro').innerHTML = `<span>Your SSE <b>${sig(s, 4)}</b>${lg ? ' (ln units)²' : ` ${sq(unitY())}`}</span><span>Optimiser <b>${sig(opt, 4)}</b></span><span class="${ratio < 1.05 ? 'mf-ok' : ratio < 2 ? 'mf-warnc' : 'mf-bad'}">You ÷ optimiser <b>${Number.isFinite(ratio) ? fmt(ratio, 3) : '—'}</b>${ratio < 1.001 ? ' — as good as the optimiser!' : ''}</span>`;
}
let lmAnim = null;
function animateLM() {
  if (!MAN) return; clearTimeout(lmAnim);
  const S = selection(); const M = MODELS[MAN.key]; const log = ui.get('err') === 'prop';
  const g = log ? (x, p) => { const v = M.f(x, p); return v > 0 ? Math.log(v) : NaN; } : M.f; const yy = log ? S.y.map(Math.log) : S.y;
  const bounds = M.bounds(S.t, S.y); let it = 0; let prev = manSSE();
  const step = () => {
    let r; try { r = fitLM(g, S.t, yy, MAN.p, { bounds, maxIter: 1 }); } catch (e) { return; }
    if (!r.params.every(Number.isFinite) || !Number.isFinite(r.sse)) return;
    MAN.p = r.params; it++; updManual(true); drawMain();
    $('#mf-man-ro').insertAdjacentHTML('beforeend', `<span class="muted">iteration ${it}</span>`);
    if (it < 80 && (prev - r.sse) / Math.max(prev, 1e-300) > 1e-9) { prev = r.sse; lmAnim = setTimeout(step, 140); }
  };
  step();
}

/* ======================================================================= events */
function onDataset(force) {
  const ds = ui.get('ds'); if (ds === lastDs && !force) return; lastDs = ds;
  if (EXAMPLES[ds]) loadExample(ds);
  else if (ds === 'growlog') { if (!loadGrowLog(false)) { const msg = noteEl.innerHTML; setDs('fw17'); loadExample('fw17'); noteEl.innerHTML = msg + '<br>' + noteEl.innerHTML; } }
  else if (ds === 'vision') { if (!loadVisionSeries()) { const msg = noteEl.innerHTML; setDs('fw17'); loadExample('fw17'); noteEl.innerHTML = msg + '<br>' + noteEl.innerHTML; } }
  else if (ds === 'pasted') { if (!DATA) { setDs('fw17'); loadExample('fw17'); } }
}
let raf = 0;
ui.onChange((state, id) => {
  if (id === 'ds') { onDataset(); return; }
  if (id === 'manual' && state.manual) syncManual(true);
  if (id === 'focus' && state.manual) syncManual(true);
  cancelAnimationFrame(raf); raf = requestAnimationFrame(refresh);
});
document.addEventListener('ffp:theme', () => drawAll());
onDataset(true);
