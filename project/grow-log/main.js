/* ==========================================================================
   Grow log — course-project data tool
   Storage: localStorage 'ffp-growlog-v1' (format documented in /project/growlog-core.js)
   ========================================================================== */
import { Plot } from '/assets/js/plot.js';
import * as G from '/project/growlog-core.js';
import EXAMPLE from './example-data.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = m => (window.FFP && FFP.toast ? FFP.toast(m) : console.log(m));
function download(name, text, type) {
  if (window.FFP && FFP.download) { FFP.download(name, text, type); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 300);
}
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const clone = o => JSON.parse(JSON.stringify(o));
const COLORS = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];

let L = G.load();
let stored = !!L;
if (!L) L = G.emptyLog();
let lastSaved = null;

/* =====================================================================
   persistence and status
   ===================================================================== */
function persist(msg) {
  G.sortLog(L);
  const ok = G.save(L); stored = true; lastSaved = new Date();
  stale = { charts: true, calc: true, quality: true, table: true };
  if (!ok) toast('Could not save — is browser storage blocked?');
  else if (msg) toast(msg);
  status();
}
let stale = { charts: true, calc: true, quality: true, table: true };
function status() {
  const issues = G.validateLog(L);
  const bad = issues.filter(i => i.level === 'bad').length, warn = issues.filter(i => i.level === 'warn').length;
  const el = $('#gl-status');
  el.classList.toggle('warn', !bad && warn > 0); el.classList.toggle('bad', bad > 0);
  const t = lastSaved ? ` · saved ${lastSaved.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '';
  $('span', el).textContent = stored ? `${L.rows.length} rows · ${L.meta.plants.length} plants · ${L.resources.length} system entries${t}` : 'No grow log yet in this browser';
  $('#n-rows').textContent = L.rows.length;
  const n = $('#n-issues'); n.textContent = bad + warn; n.className = 'n' + (bad ? ' bad' : warn ? ' warn' : '');
  const ban = $('#gl-banner');
  if (L.meta.illustrative) { ban.hidden = false; ban.innerHTML = '<b>Illustrative example — simulated data, not measurements.</b> Use it to learn the tool and the analysis; start your own log with <em>New log…</em> before you enter real data. Never report these numbers as your results.'; }
  else ban.hidden = true;
  $('#gl-empty').hidden = stored;
}

/* =====================================================================
   tabs
   ===================================================================== */
const TABS = ['setup', 'entry', 'table', 'charts', 'calc', 'quality', 'help'];
let tab = 'setup';
function showTab(k, noHash) {
  if (!TABS.includes(k)) k = 'setup';
  if (tab === 'entry' && k !== 'entry' && entryDirty && !confirm('You have unsaved values in the entry grid. Leave without saving?')) return;
  if (tab === 'entry' && k !== 'entry') { entryDirty = false; setDirty(false); }
  tab = k;
  $$('#gl-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === k));
  TABS.forEach(t => { $('#p-' + t).hidden = t !== k; });
  if (!noHash) history.replaceState(null, '', '#' + k);
  if (k === 'setup') renderSetup();
  if (k === 'entry') renderEntry();
  if (k === 'table') renderTable();
  if (k === 'charts') renderCharts();
  if (k === 'calc') renderCalc();
  if (k === 'quality') renderQuality();
}
$('#gl-tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });

/* =====================================================================
   toolbar: example, import, export, new
   ===================================================================== */
function slug(s) { return (String(s || 'growlog').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'growlog').slice(0, 40); }
function stamp() { return G.isoToday(); }
function loadExample() {
  if (stored && (L.rows.length || L.meta.plants.length) && !L.meta.illustrative && !confirm('Replace your current grow log with the simulated example? Export a backup first if you want to keep it.')) return;
  L = G.normalise(clone(EXAMPLE)); L.meta.illustrative = true;
  persist('Example loaded (simulated data)');
  entryDate = null; renderAll();
}
$('#gl-example').addEventListener('click', loadExample);
$('#gl-example2').addEventListener('click', loadExample);
$('#gl-start').addEventListener('click', () => { L = G.emptyLog(); persist('New grow log started'); renderSetup(); $('#m-title').focus(); });
$('#gl-new').addEventListener('click', () => {
  if (!confirm('Start a new, empty grow log? The current log in this browser will be replaced. (Export a backup first if you need it.)')) return;
  L = G.emptyLog(); persist('New empty grow log'); entryDate = null; renderAll(); showTab('setup');
});
$('#gl-csv').addEventListener('click', () => { if (!L.rows.length) return toast('No rows to export'); download(`growlog_${slug(L.meta.title)}_${stamp()}.csv`, G.rowsCSV(L), 'text/csv'); });
$('#gl-rcsv').addEventListener('click', () => { if (!L.resources.length) return toast('The system log is empty'); download(`systemlog_${slug(L.meta.title)}_${stamp()}.csv`, G.resourcesCSV(L), 'text/csv'); });
$('#gl-json').addEventListener('click', () => download(`growlog_${slug(L.meta.title)}_${stamp()}.json`, JSON.stringify({ version: 1, meta: L.meta, rows: L.rows, resources: L.resources, exported: new Date().toISOString() }, null, 1), 'application/json'));
$('#gl-xls').addEventListener('click', () => {
  if (!L.rows.length) return toast('No rows to export');
  const T = G.parseCSV(G.rowsCSV(L));
  const cell = v => { const s = String(v ?? ''); if (/^-?\d+(\.\d+)?$/.test(s)) return s.replace('.', ','); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const txt = '﻿' + [T.headers.join(';'), ...T.rows.map(r => r.map(cell).join(';'))].join('\r\n') + '\r\n';
  download(`growlog_${slug(L.meta.title)}_${stamp()}_excel.csv`, txt, 'text/csv');
});
$('#gl-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const text = await f.text();
  const box = $('#gl-import-box');
  let obj = null;
  if (/\.json$/i.test(f.name) || /^\s*\{/.test(text)) { try { obj = JSON.parse(text); } catch (err) { toast('The JSON file could not be read'); return; } }
  if (obj && !Array.isArray(obj.rows)) {
    // a whole "Your progress" backup can contain the grow log under its key
    if (obj['ffp-growlog-v1'] && Array.isArray(obj['ffp-growlog-v1'].rows)) obj = obj['ffp-growlog-v1'];
    else { toast('This JSON file does not contain a grow log'); return; }
  }
  box.hidden = false;
  box.innerHTML = `<b>Import “${esc(f.name)}”</b> — ${obj ? `${obj.rows.length} rows (JSON grow log)` : 'CSV file'}. <button type="button" class="btn btn-sm" data-m="merge">Merge into my log</button> <button type="button" class="btn btn-sm" data-m="replace">Replace my log</button> <button type="button" class="btn btn-sm btn-ghost" data-m="cancel">Cancel</button>`;
  box.onclick = ev => {
    const m = ev.target.dataset.m; if (!m) return;
    box.hidden = true; box.onclick = null;
    if (m === 'cancel') return;
    if (obj) {
      const inc = G.normalise(obj);
      if (m === 'replace') L = inc;
      else {
        inc.rows.forEach(r => { const ex = L.rows.find(x => x.plant === r.plant && x.date === r.date); if (ex) Object.keys(r).forEach(k => { if (r[k] !== null && r[k] !== '') ex[k] = r[k]; }); else L.rows.push(r); });
        inc.resources.forEach(r => L.resources.push(r));
        inc.meta.plants.forEach(p => { if (!L.meta.plants.some(q => q.id === p.id)) L.meta.plants.push(p); });
        inc.meta.treatments.forEach(t => { if (!L.meta.treatments.includes(t)) L.meta.treatments.push(t); });
        ['title', 'crop', 'system', 'startDate', 'group'].forEach(k => { if (!L.meta[k] && inc.meta[k]) L.meta[k] = inc.meta[k]; });
        L = G.normalise(L);
      }
      persist(`Imported ${obj.rows.length} rows`);
    } else {
      const res = G.importCSV(text, L, m);
      L = res.log;
      persist(`${res.kind === 'resources' ? 'System log' : 'Rows'}: ${res.added} added, ${res.updated} updated, ${res.skipped} skipped${res.unknown.length ? ' · ignored columns: ' + res.unknown.slice(0, 5).join(', ') : ''}`);
    }
    entryDate = null; renderAll();
  };
});

/* =====================================================================
   SET-UP
   ===================================================================== */
const META_FIELDS = [['m-title', 'title', 's'], ['m-group', 'group', 's'], ['m-crop', 'crop', 's'], ['m-system', 'system', 's'], ['m-start', 'startDate', 's'], ['m-photo', 'photoperiod_h', 'n'], ['m-area', 'area_m2', 'n'], ['m-lamp', 'lamp_w', 'n']];
META_FIELDS.forEach(([id, key, typ]) => {
  $('#' + id).addEventListener('change', e => {
    const v = e.target.value.trim();
    L.meta[key] = typ === 'n' ? (v === '' ? null : +v) : v;
    if (key === 'startDate') G.recomputeDays(L);
    persist();
  });
});
function renderSetup() {
  META_FIELDS.forEach(([id, key]) => { const el = $('#' + id); if (document.activeElement !== el) el.value = L.meta[key] ?? ''; });
  // treatments
  const counts = {}; L.meta.plants.forEach(p => { counts[p.treatment] = (counts[p.treatment] || 0) + 1; });
  const trts = G.treatmentsOf(L);
  $('#trt-table').innerHTML = `<thead><tr><th>Treatment</th><th>Target EC<small>mS cm⁻¹, optional</small></th><th>Plants</th><th></th></tr></thead><tbody>${trts.map((t, i) => `<tr><td><input type="text" value="${esc(t)}" data-trt="${i}" data-f="name" aria-label="Treatment name"></td><td><input type="number" step="0.05" min="0" value="${L.meta.targets[t] && G.isNum(L.meta.targets[t].ec) ? L.meta.targets[t].ec : ''}" data-trt="${i}" data-f="ec" aria-label="Target EC"></td><td class="ro"><span class="trt-${i % 6}" style="padding:1px 8px;border-radius:6px">${counts[t] || 0}</span></td><td><button type="button" class="del" data-trt-del="${i}" title="Remove treatment" aria-label="Remove treatment">✕</button></td></tr>`).join('') || '<tr><td class="ro" colspan="4">No treatments yet.</td></tr>'}</tbody>`;
  // plants
  const opts = trts.map(t => `<option>${esc(t)}</option>`).join('');
  $('#plant-table').innerHTML = `<thead><tr><th>Plant ID</th><th>Treatment</th><th>Container (unit)</th><th>Block</th><th>Rows</th><th></th></tr></thead><tbody>${L.meta.plants.map((p, i) => `<tr><td><input type="text" value="${esc(p.id)}" data-pl="${i}" data-f="id" aria-label="Plant ID"></td><td><select data-pl="${i}" data-f="treatment" aria-label="Treatment"><option value=""></option>${opts}</select></td><td><input type="text" value="${esc(p.unit)}" data-pl="${i}" data-f="unit" aria-label="Container"></td><td><input type="text" value="${esc(p.block)}" data-pl="${i}" data-f="block" aria-label="Block"></td><td class="ro">${L.rows.filter(r => r.plant === p.id).length}</td><td><button type="button" class="del" data-pl-del="${i}" title="Remove plant" aria-label="Remove plant">✕</button></td></tr>`).join('') || '<tr><td class="ro" colspan="6">No plants yet — generate a list or add plants.</td></tr>'}</tbody>`;
  $$('#plant-table select').forEach(s => { s.value = L.meta.plants[+s.dataset.pl].treatment || ''; });
  const units = new Set(L.meta.plants.map(p => p.unit)), blocks = new Set(L.meta.plants.map(p => p.block).filter(Boolean));
  $('#plant-info').textContent = L.meta.plants.length ? `${L.meta.plants.length} plants in ${units.size} containers${blocks.size ? ' and ' + blocks.size + ' blocks' : ''}.` : '';
}
$('#trt-table').addEventListener('change', e => {
  const el = e.target; if (el.dataset.trt == null) return;
  const trts = G.treatmentsOf(L); const old = trts[+el.dataset.trt];
  if (el.dataset.f === 'name') {
    const nu = el.value.trim(); if (!nu || nu === old) { el.value = old; return; }
    if (trts.includes(nu)) { toast('That treatment already exists'); el.value = old; return; }
    L.meta.treatments = trts.map(t => (t === old ? nu : t));
    L.rows.forEach(r => { if (r.treatment === old) r.treatment = nu; });
    L.meta.plants.forEach(p => { if (p.treatment === old) p.treatment = nu; });
    if (L.meta.targets[old]) { L.meta.targets[nu] = L.meta.targets[old]; delete L.meta.targets[old]; }
  } else {
    const v = el.value.trim();
    if (v === '') delete L.meta.targets[old]; else L.meta.targets[old] = { ec: +v };
  }
  persist(); renderSetup();
});
$('#trt-table').addEventListener('click', e => {
  const b = e.target.closest('[data-trt-del]'); if (!b) return;
  const t = G.treatmentsOf(L)[+b.dataset.trtDel];
  const used = L.rows.filter(r => r.treatment === t).length + L.meta.plants.filter(p => p.treatment === t).length;
  if (used) { toast(`“${t}” is used by ${used} plants/rows — rename it instead, or remove those first`); return; }
  L.meta.treatments = L.meta.treatments.filter(x => x !== t); delete L.meta.targets[t];
  persist(); renderSetup();
});
$('#trt-add').addEventListener('click', () => {
  const v = $('#trt-new').value.trim(); if (!v) return;
  if (G.treatmentsOf(L).includes(v)) return toast('That treatment already exists');
  L.meta.treatments.push(v); $('#trt-new').value = ''; persist(); renderSetup();
});
$('#trt-new').addEventListener('keydown', e => { if (e.key === 'Enter') $('#trt-add').click(); });
$('#plant-table').addEventListener('change', e => {
  const el = e.target; if (el.dataset.pl == null) return;
  const p = L.meta.plants[+el.dataset.pl], f = el.dataset.f, v = el.value.trim();
  if (f === 'id') {
    if (!v || v === p.id) { el.value = p.id; return; }
    if (L.meta.plants.some(q => q.id === v)) { toast('That plant ID already exists'); el.value = p.id; return; }
    L.rows.forEach(r => { if (r.plant === p.id) r.plant = v; });
    if (p.unit === p.id) p.unit = v;
    p.id = v;
  } else if (f === 'treatment') {
    const nRows = L.rows.filter(r => r.plant === p.id && r.treatment && r.treatment !== v).length;
    if (nRows && !confirm(`Also change the treatment in the ${nRows} existing rows of ${p.id}?`)) { el.value = p.treatment; return; }
    p.treatment = v; L.rows.forEach(r => { if (r.plant === p.id) r.treatment = v; });
  } else p[f] = v || (f === 'unit' ? p.id : '');
  persist(); renderSetup();
});
$('#plant-table').addEventListener('click', e => {
  const b = e.target.closest('[data-pl-del]'); if (!b) return;
  const p = L.meta.plants[+b.dataset.plDel]; const n = L.rows.filter(r => r.plant === p.id).length;
  if (n && !confirm(`${p.id} has ${n} rows of data. Remove the plant AND its rows?`)) return;
  L.meta.plants.splice(+b.dataset.plDel, 1); L.rows = L.rows.filter(r => r.plant !== p.id);
  persist(); renderSetup();
});
$('#plant-add').addEventListener('click', () => {
  let k = L.meta.plants.length + 1, id;
  do { id = 'P' + String(k++).padStart(2, '0'); } while (L.meta.plants.some(p => p.id === id));
  L.meta.plants.push({ id, treatment: G.treatmentsOf(L)[0] || '', unit: id, block: '' }); persist(); renderSetup();
});
$('#gen-go').addEventListener('click', () => {
  const trts = G.treatmentsOf(L); if (!trts.length) return toast('Add the treatments first');
  const n = Math.max(1, +$('#gen-n').value || 1), k = Math.max(1, +$('#gen-k').value || 1), pre = ($('#gen-prefix').value || 'P').trim();
  if (L.meta.plants.length && !confirm('Replace the current plant list? Existing measurement rows are kept.')) return;
  const plants = []; let c = 0, u = 0;
  trts.forEach(t => {
    for (let i = 0; i < n; i++) {
      if (k === 1) { c++; const id = pre + String(c).padStart(2, '0'); plants.push({ id, treatment: t, unit: id, block: '' }); }
      else { if (i % k === 0) u++; const unit = pre + String(u).padStart(2, '0'); plants.push({ id: `${unit}-${(i % k) + 1}`, treatment: t, unit, block: '' }); }
    }
  });
  L.meta.plants = plants; persist(`${plants.length} plants created — assign blocks, or randomise in the build guide`); renderSetup();
});

/* =====================================================================
   ENTRY
   ===================================================================== */
const GROUPS = [
  { key: 'sol', label: 'Solution', fields: ['ec', 'ph', 't_water', 'do_mgl'] },
  { key: 'growth', label: 'Growth', fields: ['area_cm2', 'leaves', 'height_cm'] },
  { key: 'light', label: 'PPFD', fields: ['ppfd'] },
  { key: 'harvest', label: 'Harvest', fields: ['fw_g', 'dw_g', 'root_fw_g'] }
];
const SOL = ['ec', 'ph', 't_water', 'do_mgl'];
let groupsOn = new Set(['sol', 'growth']);
let entryDate = null, entryDirty = false;
$('#e-groups').innerHTML = GROUPS.map(g => `<label class="chip-x" style="padding-right:11px"><input type="checkbox" data-g="${g.key}" ${groupsOn.has(g.key) ? 'checked' : ''}> ${g.label}</label>`).join('');
$('#e-groups').addEventListener('change', e => { const g = e.target.dataset.g; if (!g) return; if (e.target.checked) groupsOn.add(g); else groupsOn.delete(g); buildGrid(true); });
function setDirty(on) { entryDirty = on; $('#e-dirty').hidden = !on; }
function defaultEntryDate() {
  const today = G.isoToday();
  return today;
}
function renderEntry() {
  if (!entryDate) entryDate = defaultEntryDate();
  $('#e-date').value = entryDate;
  buildGrid(false);
  renderResEntry();
}
$('#e-date').addEventListener('change', e => {
  const v = e.target.value;
  if (entryDirty && !confirm('Discard the unsaved values of the previous date?')) { e.target.value = entryDate; return; }
  entryDate = v || defaultEntryDate(); setDirty(false); buildGrid(false);
});
function entryFields() { return GROUPS.filter(g => groupsOn.has(g.key)).flatMap(g => g.fields); }
function sortedPlants() { return [...L.meta.plants].sort((a, b) => G.natCmp(a.unit, b.unit) || G.natCmp(a.id, b.id)); }
function buildGrid(keepValues) {
  const prev = {};
  if (keepValues) $$('#e-grid input[data-f]').forEach(i => { prev[i.dataset.p + '|' + i.dataset.f] = i.value; });
  const d = G.dayOf(entryDate, L.meta.startDate);
  $('#e-dat').textContent = d == null ? 'DAT — (set the start date)' : `DAT ${d}`;
  const F = entryFields();
  const plants = sortedPlants();
  if (!plants.length) { $('#e-grid').innerHTML = '<tbody><tr><td class="ro">No plants yet — add them in Set-up.</td></tr></tbody>'; $('#e-info').textContent = ''; return; }
  const trts = G.treatmentsOf(L);
  let html = `<thead><tr><th>Plant</th><th>Treatment</th><th>Unit</th>${F.map(f => `<th>${G.VARS[f].short}<small>${G.VARS[f].unit || '–'}</small></th>`).join('')}<th>Notes</th></tr></thead><tbody>`;
  plants.forEach(p => {
    const row = L.rows.find(r => r.plant === p.id && r.date === entryDate) || {};
    const val = f => (keepValues && prev[p.id + '|' + f] != null ? prev[p.id + '|' + f] : (row[f] ?? ''));
    html += `<tr><td class="pid">${esc(p.id)}</td><td class="trt"><span class="trt-${trts.indexOf(p.treatment) % 6}" style="padding:1px 7px;border-radius:6px">${esc(p.treatment || '—')}</span></td><td class="ro">${esc(p.unit)}</td>${F.map(f => `<td><input type="text" inputmode="decimal" data-p="${esc(p.id)}" data-f="${f}" value="${esc(val(f))}" aria-label="${esc(p.id)} ${G.VARS[f].short}"></td>`).join('')}<td class="note-cell"><input type="text" data-p="${esc(p.id)}" data-f="notes" value="${esc(val('notes'))}" aria-label="${esc(p.id)} notes"></td></tr>`;
  });
  html += '</tbody>';
  $('#e-grid').innerHTML = html;
  $$('#e-grid input[data-f]').forEach(checkCell);
  const existing = L.rows.filter(r => r.date === entryDate).length;
  $('#e-info').textContent = existing ? `${existing} plants already have values on ${entryDate}; saving updates them.` : `No values stored for ${entryDate} yet.`;
  updateEntryMsg();
}
const parseNum = s => { const t = String(s).trim().replace(',', '.'); if (t === '') return null; const v = Number(t); return Number.isFinite(v) ? v : NaN; };
function checkCell(inp) {
  const f = inp.dataset.f, td = inp.parentElement; td.classList.remove('warn', 'bad'); inp.title = '';
  if (f === 'notes') return;
  const v = parseNum(inp.value);
  if (v === null) return;
  if (Number.isNaN(v)) { td.classList.add('bad'); inp.title = 'Not a number'; return; }
  const p = L.meta.plants.find(x => x.id === inp.dataset.p) || {};
  const c = G.checkValue(f, v, L, { treatment: p.treatment });
  if (c) { td.classList.add(c.level); inp.title = c.msg; }
}
function updateEntryMsg() {
  const msgs = $$('#e-grid td.bad input, #e-grid td.warn input').map(i => ({ lvl: i.parentElement.classList.contains('bad') ? 'bad' : 'warn', t: `${i.dataset.p}: ${i.title}` }));
  const el = $('#e-msg');
  el.className = 'msg-line' + (msgs.some(m => m.lvl === 'bad') ? ' bad' : msgs.length ? ' warn' : '');
  el.innerHTML = msgs.length ? msgs.slice(0, 6).map(m => esc(m.t)).join('<br>') + (msgs.length > 6 ? `<br>… and ${msgs.length - 6} more` : '') : '';
}
$('#e-grid').addEventListener('input', e => {
  const inp = e.target; if (!inp.dataset.f) return;
  setDirty(true); checkCell(inp);
  if ($('#e-perunit').checked && SOL.includes(inp.dataset.f)) {
    const p = L.meta.plants.find(x => x.id === inp.dataset.p);
    if (p) L.meta.plants.filter(q => q.unit === p.unit && q.id !== p.id).forEach(q => { const o = $(`#e-grid input[data-p="${CSS.escape(q.id)}"][data-f="${inp.dataset.f}"]`); if (o) { o.value = inp.value; checkCell(o); } });
  }
  updateEntryMsg();
});
$('#e-grid').addEventListener('keydown', e => {
  // Enter moves down the column, like a spreadsheet
  if (e.key !== 'Enter' || !e.target.dataset.f) return;
  e.preventDefault();
  const col = e.target.dataset.f, ins = $$(`#e-grid input[data-f="${col}"]`); const i = ins.indexOf(e.target);
  if (ins[i + (e.shiftKey ? -1 : 1)]) ins[i + (e.shiftKey ? -1 : 1)].focus();
});
$('#e-save').addEventListener('click', () => {
  if (!G.validDate(entryDate)) return toast('Choose a valid date');
  const F = entryFields();
  const bad = $$('#e-grid input[data-f]').filter(i => i.dataset.f !== 'notes' && Number.isNaN(parseNum(i.value)));
  if (bad.length) { bad[0].focus(); return toast('Some cells are not numbers — correct them first'); }
  let added = 0, updated = 0;
  sortedPlants().forEach(p => {
    const get = f => { const i = $(`#e-grid input[data-p="${CSS.escape(p.id)}"][data-f="${f}"]`); return i ? i.value : undefined; };
    const vals = {}; F.forEach(f => { vals[f] = parseNum(get(f)); });
    const note = (get('notes') || '').trim();
    let row = L.rows.find(r => r.plant === p.id && r.date === entryDate);
    const any = Object.values(vals).some(v => v !== null) || note;
    if (!row && !any) return;
    if (!row) { row = G.cleanRow({ date: entryDate, plant: p.id, treatment: p.treatment }); L.rows.push(row); added++; } else updated++;
    F.forEach(f => { if (vals[f] === null) { if (G.EXTRA_COLS.includes(f)) delete row[f]; else row[f] = null; } else row[f] = vals[f]; });
    row.notes = note; row.treatment = row.treatment || p.treatment;
  });
  G.recomputeDays(L);
  setDirty(false);
  persist(`Saved: ${added} new rows, ${updated} updated (${entryDate})`);
  buildGrid(false);
});
$('#e-reset').addEventListener('click', () => { setDirty(false); buildGrid(false); });
window.addEventListener('beforeunload', e => { if (entryDirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- system log entry ---------- */
function unitsList() { return ['ALL', ...[...new Set(L.meta.plants.map(p => p.unit))].sort(G.natCmp)]; }
function renderResEntry() {
  if (!$('#r-date').value) $('#r-date').value = entryDate || G.isoToday();
  const cur = $('#r-unit').value;
  $('#r-unit').innerHTML = unitsList().map(u => `<option value="${esc(u)}">${u === 'ALL' ? 'ALL (whole system: energy meter, climate)' : esc(u)}</option>`).join('');
  if (cur && unitsList().includes(cur)) $('#r-unit').value = cur;
  const recent = L.resources.map((r, i) => ({ r, i })).slice(-14).reverse();
  $('#r-recent').innerHTML = `<thead><tr><th>Date</th><th>Container</th><th>Water<small>L</small></th><th>Meter<small>kWh</small></th><th>Air T<small>°C</small></th><th>RH<small>%</small></th><th>Notes</th><th></th></tr></thead><tbody>${recent.map(({ r, i }) => `<tr><td class="ro">${esc(r.date)}</td><td class="ro">${esc(r.unit)}</td><td class="ro">${r.water_l ?? ''}</td><td class="ro">${r.kwh ?? ''}</td><td class="ro">${r.air_t ?? ''}</td><td class="ro">${r.rh ?? ''}</td><td class="ro" style="white-space:normal">${esc(r.notes)}</td><td><button type="button" class="del" data-rdel="${i}" aria-label="Delete entry">✕</button></td></tr>`).join('') || '<tr><td class="ro" colspan="8">No entries yet.</td></tr>'}</tbody>`;
}
$('#r-recent').addEventListener('click', e => { const b = e.target.closest('[data-rdel]'); if (!b) return; if (!confirm('Delete this system-log entry?')) return; L.resources.splice(+b.dataset.rdel, 1); persist(); renderResEntry(); });
$('#r-add').addEventListener('click', () => {
  const o = { date: $('#r-date').value, unit: $('#r-unit').value || 'ALL', water_l: parseNum($('#r-water').value), kwh: parseNum($('#r-kwh').value), air_t: parseNum($('#r-air').value), rh: parseNum($('#r-rh').value), notes: $('#r-notes').value.trim() };
  const msg = $('#r-msg');
  if (!G.validDate(o.date)) { msg.className = 'msg-line bad'; msg.textContent = 'Choose a date.'; return; }
  if ([o.water_l, o.kwh, o.air_t, o.rh].some(v => Number.isNaN(v))) { msg.className = 'msg-line bad'; msg.textContent = 'Some values are not numbers.'; return; }
  if ([o.water_l, o.kwh, o.air_t, o.rh].every(v => v === null) && !o.notes) { msg.className = 'msg-line warn'; msg.textContent = 'Nothing to add.'; return; }
  const warns = ['water_l', 'air_t', 'rh'].map(f => G.checkValue(f, o[f], L, null)).filter(Boolean);
  const meters = G.energyReadings(L).get(o.unit);
  if (o.kwh !== null && meters && meters.length && o.kwh < meters.filter(m => m.date <= o.date).slice(-1)[0]?.kwh) warns.push({ level: 'bad', msg: 'The meter reading is lower than the previous one — was the meter reset? Note it.' });
  L.resources.push(G.cleanRes(o));
  persist('Added to the system log');
  ['#r-water', '#r-kwh', '#r-air', '#r-rh', '#r-notes'].forEach(s => { $(s).value = ''; });
  msg.className = 'msg-line' + (warns.some(w => w.level === 'bad') ? ' bad' : warns.length ? ' warn' : '');
  msg.textContent = warns.map(w => w.msg).join(' · ');
  renderResEntry();
});

/* =====================================================================
   TABLE
   ===================================================================== */
const TCOLS = ['date', 'day', 'plant', 'treatment', ...G.NUM_COLS, 'notes'];
function fillFilters() {
  const keep = id => $(id).value;
  const t = keep('#f-trt'), p = keep('#f-plant'), d = keep('#f-date');
  $('#f-trt').innerHTML = '<option value="">all</option>' + G.treatmentsOf(L).map(x => `<option>${esc(x)}</option>`).join('');
  $('#f-plant').innerHTML = '<option value="">all</option>' + [...new Set(L.rows.map(r => r.plant))].sort(G.natCmp).map(x => `<option>${esc(x)}</option>`).join('');
  $('#f-date').innerHTML = '<option value="">all</option>' + [...new Set(L.rows.map(r => r.date))].sort().map(x => `<option>${esc(x)}</option>`).join('');
  $('#f-trt').value = t; $('#f-plant').value = p; $('#f-date').value = d;
}
let highlightRow = -1;
function renderTable() {
  fillFilters();
  const t = $('#f-trt').value, p = $('#f-plant').value, d = $('#f-date').value, q = $('#f-q').value.trim().toLowerCase(), onlyIss = $('#f-issues').checked;
  const issues = G.validateLog(L);
  const cellIss = new Map(); issues.filter(i => i.kind === 'row' && i.index >= 0).forEach(i => { const k = i.index + '|' + i.field; const prev = cellIss.get(k); if (!prev || i.level === 'bad') cellIss.set(k, i); });
  const rowsIss = new Set(issues.filter(i => i.kind === 'row').map(i => i.index));
  const idx = L.rows.map((r, i) => i).filter(i => { const r = L.rows[i]; return (!t || r.treatment === t) && (!p || r.plant === p) && (!d || r.date === d) && (!q || (r.notes || '').toLowerCase().includes(q)) && (!onlyIss || rowsIss.has(i)); });
  const shown = idx.slice(0, 1500);
  const head = `<thead><tr>${TCOLS.map(c => `<th>${c}${G.VARS[c] ? `<small>${G.VARS[c].unit || '–'}</small>` : ''}</th>`).join('')}<th></th></tr></thead>`;
  const body = shown.map(i => {
    const r = L.rows[i];
    return `<tr${i === highlightRow ? ' class="sel" id="row-sel"' : ''}>${TCOLS.map(c => {
      if (c === 'day') return `<td class="ro">${r.day ?? ''}</td>`;
      const iss = cellIss.get(i + '|' + c);
      const cls = (c === 'notes' ? 'note-cell ' : '') + (iss ? iss.level : '');
      return `<td class="${cls}"><input type="text" data-i="${i}" data-f="${c}" value="${esc(r[c] ?? '')}" ${iss ? `title="${esc(iss.msg)}"` : ''} aria-label="${c} row ${i + 1}"></td>`;
    }).join('')}<td><button type="button" class="del" data-del="${i}" title="Delete row" aria-label="Delete row">✕</button></td></tr>`;
  }).join('');
  $('#t-table').innerHTML = head + `<tbody>${body || `<tr><td class="ro" colspan="${TCOLS.length + 1}">No rows${L.rows.length ? ' match the filter' : ' yet'}.</td></tr>`}</tbody>`;
  $('#t-info').textContent = `${idx.length} of ${L.rows.length} rows${idx.length > shown.length ? ' (first 1500 shown)' : ''}`;
  const sel = $('#row-sel'); if (sel) { sel.scrollIntoView({ block: 'center' }); highlightRow = -1; }
  // system log
  $('#t-res').innerHTML = `<thead><tr>${G.RES_COLS.map(c => `<th>${c}</th>`).join('')}<th></th></tr></thead><tbody>${L.resources.map((r, i) => `<tr>${G.RES_COLS.map(c => `<td class="${c === 'notes' ? 'note-cell' : ''}"><input type="text" data-ri="${i}" data-f="${c}" value="${esc(r[c] ?? '')}" aria-label="${c} system row ${i + 1}"></td>`).join('')}<td><button type="button" class="del" data-rdel="${i}" aria-label="Delete system row">✕</button></td></tr>`).join('') || `<tr><td class="ro" colspan="${G.RES_COLS.length + 1}">No system-log entries yet.</td></tr>`}</tbody>`;
  stale.table = false;
}
['#f-trt', '#f-plant', '#f-date', '#f-issues'].forEach(s => $(s).addEventListener('change', renderTable));
let qT; $('#f-q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(renderTable, 300); });
$('#t-table').addEventListener('change', e => {
  const el = e.target; if (el.dataset.i == null) return;
  const r = L.rows[+el.dataset.i], f = el.dataset.f; let v = el.value.trim();
  if (f === 'date') { v = G.normDate(v); if (!G.validDate(v)) { toast('Use the date format YYYY-MM-DD'); el.value = r.date; return; } r.date = v; G.recomputeDays(L); }
  else if (f === 'plant' || f === 'treatment' || f === 'notes') r[f] = v;
  else { const n = parseNum(v); if (Number.isNaN(n)) { toast('Not a number'); el.value = r[f] ?? ''; return; } if (n === null && G.EXTRA_COLS.includes(f)) delete r[f]; else r[f] = n; }
  persist(); renderTable();
});
$('#t-table').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (!b) return; const r = L.rows[+b.dataset.del]; if (!confirm(`Delete the row ${r.plant} · ${r.date}? (Deleting data should be rare — describe the reason in your lab notebook.)`)) return; L.rows.splice(+b.dataset.del, 1); persist(); renderTable(); });
$('#t-add').addEventListener('click', () => { const p = L.meta.plants[0]; L.rows.push(G.cleanRow({ date: G.isoToday(), plant: p ? p.id : 'P01', treatment: p ? p.treatment : '' })); G.recomputeDays(L); persist(); renderTable(); });
$('#t-res').addEventListener('change', e => {
  const el = e.target; if (el.dataset.ri == null) return;
  const r = L.resources[+el.dataset.ri], f = el.dataset.f; let v = el.value.trim();
  if (f === 'date') { v = G.normDate(v); if (!G.validDate(v)) { toast('Use the date format YYYY-MM-DD'); el.value = r.date; return; } r.date = v; }
  else if (f === 'unit' || f === 'notes') r[f] = v || (f === 'unit' ? 'ALL' : '');
  else { const n = parseNum(v); if (Number.isNaN(n)) { toast('Not a number'); el.value = r[f] ?? ''; return; } r[f] = n; }
  persist(); renderTable();
});
$('#t-res').addEventListener('click', e => { const b = e.target.closest('[data-rdel]'); if (!b) return; if (!confirm('Delete this system-log row?')) return; L.resources.splice(+b.dataset.rdel, 1); persist(); renderTable(); });

/* =====================================================================
   CHARTS
   ===================================================================== */
let charts = [];
function renderCharts() {
  const grid = $('#c-grid');
  charts.forEach(c => c.destroy && c.destroy()); charts = [];
  const vars = Object.keys(G.VARS).filter(f => L.rows.some(r => G.isNum(r[f])));
  const trts = G.treatmentsOf(L);
  const showPlants = $('#c-plants').checked, showSE = $('#c-se').checked, logY = $('#c-log').checked;
  let html = vars.map(f => `<div class="chart-card"><h3>${G.VARS[f].label}</h3><div class="chart-sub">${f === 'fw_g' || G.VARS[f].harvest ? 'Harvest values by treatment' : 'Treatment means over time'} · ${G.VARS[f].unit || 'dimensionless'}</div><div class="chart" id="ch-${f}"></div></div>`).join('');
  const W = G.waterUse(L), E = G.energy(L);
  if (W.intervals.length) html += `<div class="chart-card"><h3>Cumulative water used per plant</h3><div class="chart-sub">Mean over the containers of each treatment · L per plant</div><div class="chart" id="ch-water"></div></div>`;
  if (E.curves.length) html += `<div class="chart-card"><h3>Cumulative electricity</h3><div class="chart-sub">From the energy-meter readings · kWh</div><div class="chart" id="ch-energy"></div></div>`;
  grid.innerHTML = html || '<div class="tool-section"><p class="sub">No data to chart yet — enter measurements or load the example.</p></div>';
  vars.forEach(f => {
    const V = G.VARS[f];
    const growth = V.growth && f !== 'fw_g';
    const P = new Plot('#ch-' + f, { x: { label: 'Days after transplanting', unit: 'd' }, y: { label: V.short, unit: V.unit, log: logY && (growth || f === 'fw_g') }, legend: true, height: 230 });
    charts.push(P);
    const S = G.series(L, f), BT = G.byTreatmentDay(L, f);
    if (showPlants) S.forEach((pts, plant) => {
      const t = G.plantInfo(L, plant).treatment || (L.rows.find(r => r.plant === plant) || {}).treatment;
      const ci = Math.max(0, trts.indexOf(t));
      if (pts.length > 1) P.line('p-' + plant, pts.map(p => p[0]), pts.map(p => p[1]), { color: COLORS[ci % 8], width: 1, opacity: 0.35, noTip: true });
      else P.scatter('p-' + plant, pts.map(p => p[0]), pts.map(p => p[1]), { color: COLORS[ci % 8], r: 2.5, opacity: 0.45, noTip: true });
    });
    BT.forEach((arr, t) => {
      const ci = Math.max(0, trts.indexOf(t)), col = COLORS[ci % 8];
      const xs = arr.map(a => a.day), ys = arr.map(a => a.mean);
      if (showSE && arr.length > 1) { const se = arr.map(a => (Number.isFinite(a.se) ? a.se : 0)); P.band('b-' + t, xs, ys.map((y, i) => Math.max(logY ? 1e-6 : -Infinity, y - se[i])), ys.map((y, i) => y + se[i]), { color: col, alpha: 0.14 }); }
      if (arr.length > 1) P.line('m-' + t, xs, ys, { color: col, width: 2.4, label: t });
      P.scatter('s-' + t, xs, ys, { color: col, r: 4, label: arr.length > 1 ? undefined : t, yErr: arr.length === 1 && showSE ? arr.map(a => (Number.isFinite(a.se) ? a.se : 0)) : undefined, noLegend: arr.length > 1 });
    });
    if (f === 'ec') Object.entries(L.meta.targets || {}).forEach(([t, o]) => { if (G.isNum(o.ec) && trts.includes(t)) P.hline('tg-' + t, +o.ec, { color: COLORS[trts.indexOf(t) % 8], dash: [3, 4], width: 1 }); });
    if (f === 'ph') P.hregion('win', 5.5, 6.5, { color: 'accent', alpha: 0.07, label: 'target 5.5–6.5' });
    if (f === 'do_mgl') P.hline('do6', 6, { color: 'danger', label: '6 mg L⁻¹', dash: [4, 4] });
    if (f === 't_water') P.hregion('tw', 18, 24, { color: 'water', alpha: 0.06, label: '18–24 °C' });
  });
  if (W.intervals.length) {
    const P = new Plot('#ch-water', { x: { label: 'Days after transplanting', unit: 'd' }, y: { label: 'Water used', unit: 'L per plant' }, legend: true, height: 230 }); charts.push(P);
    trts.forEach((t, ci) => {
      const ints = W.intervals.filter(i => i.treatment === t && i.day != null);
      const days = [...new Set(ints.map(i => i.day))].sort((a, b) => a - b);
      if (!days.length) return;
      const ys = days.map(d => { const v = ints.filter(i => i.day === d).map(i => i.cum / i.plants); return v.reduce((s, x) => s + x, 0) / v.length; });
      P.line('w-' + t, [0, ...days], [0, ...ys], { color: COLORS[ci % 8], width: 2.2, label: t });
      P.scatter('ws-' + t, days, ys, { color: COLORS[ci % 8], r: 3.5, noLegend: true });
    });
  }
  if (E.curves.length) {
    const P = new Plot('#ch-energy', { x: { label: 'Days after transplanting', unit: 'd' }, y: { label: 'Electricity', unit: 'kWh' }, legend: true, height: 230 }); charts.push(P);
    E.curves.forEach((c, k) => { const pts = c.pts.filter(p => p.day != null); P.line('e-' + c.unit, pts.map(p => p.day), pts.map(p => p.cum), { color: ['amber', 'magenta', 'water'][k % 3], width: 2.4, label: 'meter ' + c.unit }); P.scatter('es-' + c.unit, pts.map(p => p.day), pts.map(p => p.cum), { color: ['amber', 'magenta', 'water'][k % 3], r: 3.5, noLegend: true }); });
    if (G.isNum(L.meta.lamp_w) && G.isNum(L.meta.photoperiod_h)) { const dmax = Math.max(...E.curves.flatMap(c => c.pts.map(p => p.day ?? 0))); P.line('e-exp', [0, dmax], [0, L.meta.lamp_w / 1000 * L.meta.photoperiod_h * dmax], { color: 'muted', dash: [5, 4], width: 1.5, label: 'lamp W × photoperiod' }); }
  }
  stale.charts = false;
}
['#c-plants', '#c-se', '#c-log'].forEach(s => $(s).addEventListener('change', renderCharts));

/* =====================================================================
   CALCULATIONS
   ===================================================================== */
let calcCharts = [];
function tile(label, value, unit, note, status) { return `<div class="readout ${status || ''}"><div class="ro-label">${label}</div><div class="ro-value">${value}<small>${unit || ''}</small></div>${note ? `<div class="ro-note">${note}</div>` : ''}</div>`; }
function renderCalc() {
  calcCharts.forEach(c => c.destroy && c.destroy()); calcCharts = [];
  const I = G.indicators(L);
  const trts = G.treatmentsOf(L);
  $('#k-tiles').innerHTML = [
    tile('Plants harvested', I.plants || '—', '', I.days != null && I.plants ? `at DAT ${I.days}` : 'no harvest rows yet'),
    tile('Total shoot fresh mass', I.plants ? fmt(I.yieldKg, 3) : '—', 'kg', I.meanFW ? `${fmt(I.meanFW, 1)} g per plant` : ''),
    tile('Dry-matter content', I.dmc != null ? fmt(100 * I.dmc, 2) : '—', '%', 'from the dw_g values'),
    tile('Water used', I.water ? fmt(I.water, 2) : '—', 'L', I.waterPerPlantDay ? `${fmt(I.waterPerPlantDay, 3)} L per plant per day` : 'system log: water_l'),
    tile('Water productivity', I.wp ? fmt(I.wp, 1) : '—', 'g FW L⁻¹', I.pwu ? `PWU = ${fmt(I.pwu, 1)} L kg⁻¹` : ''),
    tile('Electricity', I.kwh ? fmt(I.kwh, 2) : '—', 'kWh', I.kwhExpected ? `expected ${fmt(I.kwhExpected, 1)} kWh` : 'system log: kwh'),
    tile('Specific energy use', I.e ? fmt(I.e, 1) : '—', 'kWh kg⁻¹ FW', I.eue ? `EUE = ${fmt(I.eue, 3)} kg kWh⁻¹` : ''),
    tile('Mean PPFD at canopy', I.ppfd ? fmt(I.ppfd, 0) : '—', 'µmol m⁻² s⁻¹', 'mean of all logged PPFD values'),
    tile('Daily light integral', I.dli ? fmt(I.dli, 1) : '—', 'mol m⁻² d⁻¹', I.photoperiod ? `${I.photoperiod} h photoperiod` : 'set the photoperiod'),
    tile('Light-use efficiency', I.lueDW ? fmt(I.lueDW, 3) : '—', 'g DW mol⁻¹', I.lueFW ? `${fmt(I.lueFW, 1)} g FW mol⁻¹ · area ${I.area} m²` : 'needs DW, PPFD, photoperiod and area')
  ].join('');
  // RGR
  const gv = $('#g-var'); const gvars = ['area_cm2', 'fw_g', 'height_cm', 'leaves'].filter(f => L.rows.filter(r => G.isNum(r[f])).length);
  const cur = gv.value; gv.innerHTML = gvars.map(f => `<option value="${f}">${G.VARS[f].label} (${f})</option>`).join('') || '<option value="area_cm2">Projected leaf area</option>';
  if (gvars.includes(cur)) gv.value = cur;
  const f = gv.value || 'area_cm2';
  const R = G.rgrTreatments(L, f);
  $('#g-table').innerHTML = `<thead><tr><th>Treatment</th><th>Interval<small>DAT</small></th><th>n</th><th>RGR<small>d⁻¹</small></th><th>± SE</th><th>Doubling<small>d</small></th></tr></thead><tbody>${R.map(g => `<tr><td class="trt"><span class="trt-${trts.indexOf(g.treatment) % 6}" style="padding:1px 7px;border-radius:6px">${esc(g.treatment)}</span></td><td class="ro">${g.d1}–${g.d2}</td><td class="ro">${g.n}</td><td class="ro">${fmt(g.rgr, 3)}</td><td class="ro">${fmt(g.se, 3)}</td><td class="ro">${fmt(g.td, 1)}</td></tr>`).join('') || '<tr><td class="ro" colspan="6">Needs at least two measurement dates.</td></tr>'}</tbody>`;
  const PG = new Plot('#g-chart', { x: { label: 'Days after transplanting', unit: 'd' }, y: { label: 'RGR', unit: 'd⁻¹' }, legend: true, height: 230 }); calcCharts.push(PG);
  trts.forEach((t, ci) => { const g = R.filter(x => x.treatment === t); if (!g.length) return; PG.line('r-' + t, g.map(x => x.mid), g.map(x => x.rgr), { color: COLORS[ci % 8], width: 2, label: t }); PG.scatter('rs-' + t, g.map(x => x.mid), g.map(x => x.rgr), { color: COLORS[ci % 8], r: 3.5, yErr: g.map(x => (Number.isFinite(x.se) ? x.se : 0)), noLegend: true }); });
  // harvest
  const H = G.harvestRows(L);
  const hs = trts.map(t => { const h = H.filter(x => x.treatment === t); return { t, n: h.length, fw: G.summarise(h.map(x => x.fw)), dw: G.summarise(h.filter(x => x.dw != null).map(x => x.dw)), dmc: G.summarise(h.filter(x => x.dmc != null).map(x => x.dmc)), rs: G.summarise(h.filter(x => x.root != null).map(x => x.root / x.fw)) }; }).filter(x => x.n);
  $('#h-table').innerHTML = `<thead><tr><th>Treatment</th><th>n</th><th>Shoot FW<small>mean ± SD, g</small></th><th>Shoot DW<small>g</small></th><th>DMC<small>%</small></th><th>Root:shoot<small>FW basis</small></th></tr></thead><tbody>${hs.map(x => `<tr><td class="trt"><span class="trt-${trts.indexOf(x.t) % 6}" style="padding:1px 7px;border-radius:6px">${esc(x.t)}</span></td><td class="ro">${x.n}</td><td class="ro">${fmt(x.fw.mean, 1)} ± ${fmt(x.fw.sd, 1)}</td><td class="ro">${fmt(x.dw.mean, 2)}</td><td class="ro">${fmt(x.dmc.mean, 2)}</td><td class="ro">${fmt(x.rs.mean, 3)}</td></tr>`).join('') || '<tr><td class="ro" colspan="6">No harvest rows (fw_g) yet.</td></tr>'}</tbody>`;
  // calibration
  const cal = G.calibration(L);
  if (cal) {
    const span = cal.range[1] / cal.range[0], logAx = span > 5;
    const PC = new Plot('#cal-chart', { x: { label: 'Projected area', unit: 'cm²', log: logAx, min: logAx ? 'auto' : cal.range[0] * 0.9, max: logAx ? 'auto' : cal.range[1] * 1.05 }, y: { label: 'Shoot FW', unit: 'g', log: logAx }, legend: false, height: 250 }); calcCharts.push(PC);
    PC.scatter('pts', cal.pts.map(p => p[0]), cal.pts.map(p => p[1]), { color: 'accent', r: 4, label: 'plants' });
    const xs = []; for (let i = 0; i <= 40; i++) xs.push(cal.range[0] * Math.pow(cal.range[1] / cal.range[0], i / 40));
    PC.line('fit', xs, xs.map(cal.predict), { color: 'magenta', width: 2, label: 'fit' });
    const narrow = cal.range[1] / cal.range[0] < 3;
    $('#cal-info').innerHTML = `FW = <b>${fmt(cal.a, 4)}</b> · A<sup><b>${fmt(cal.b, 3)}</b></sup> · 95 % CI of b: ${fmt(cal.ciB[0], 2)} to ${fmt(cal.ciB[1], 2)} · R² = ${fmt(cal.r2, 3)} · n = ${cal.n}.${narrow ? ` <span style="color:var(--warn)">The areas span only a factor of ${fmt(cal.range[1] / cal.range[0], 1)}: the exponent is poorly determined (and measurement error in area biases it towards smaller values). Harvest a few spare plants earlier to widen the range.</span>` : ''}`;
  } else { $('#cal-chart').innerHTML = ''; $('#cal-info').textContent = 'Needs at least three rows with both a fresh mass and a projected area (usually the harvest rows).'; }
  // water
  const W = G.waterUse(L);
  const byT = trts.map(t => { const u = W.totals.filter(x => x.treatment === t); const fwT = H.filter(h => h.treatment === t); return { t, units: u.length, perPlant: G.summarise(u.map(x => x.water / x.plants)), ppd: G.summarise(u.filter(x => x.perPlantDay != null).map(x => x.perPlantDay)), fw: G.summarise(fwT.map(h => h.fw)) }; }).filter(x => x.units);
  $('#w-table').innerHTML = `<thead><tr><th>Container</th><th>Treatment</th><th>Plants</th><th>Water<small>L</small></th><th>Days</th><th>L plant⁻¹ d⁻¹</th></tr></thead><tbody>${W.totals.map(x => `<tr><td class="ro">${esc(x.unit)}</td><td class="trt">${esc(x.treatment)}</td><td class="ro">${x.plants}</td><td class="ro">${fmt(x.water, 2)}</td><td class="ro">${x.days ?? '—'}</td><td class="ro">${fmt(x.perPlantDay, 3)}</td></tr>`).join('')}${byT.map(x => `<tr><td class="ro" style="font-weight:700">mean</td><td class="trt"><b>${esc(x.t)}</b></td><td class="ro">${x.units} units</td><td class="ro"><b>${fmt(x.perPlant.mean, 2)}</b> per plant</td><td class="ro"></td><td class="ro"><b>${fmt(x.ppd.mean, 3)}</b>${Number.isFinite(x.fw.mean) ? ` · WP ${fmt(x.fw.mean / x.perPlant.mean, 1)} g L⁻¹` : ''}</td></tr>`).join('') || (W.totals.length ? '' : '<tr><td class="ro" colspan="6">No water entries in the system log yet.</td></tr>')}</tbody>`;
  if (W.intervals.length) {
    const PW = new Plot('#w-chart', { x: { label: 'Days after transplanting', unit: 'd' }, y: { label: 'Water use', unit: 'L plant⁻¹ d⁻¹' }, legend: true, height: 250 }); calcCharts.push(PW);
    trts.forEach((t, ci) => {
      const ints = W.intervals.filter(i => i.treatment === t && i.perPlantDay != null && i.day != null);
      const days = [...new Set(ints.map(i => i.day))].sort((a, b) => a - b); if (!days.length) return;
      const ys = days.map(d => { const v = ints.filter(i => i.day === d).map(i => i.perPlantDay); return v.reduce((s, x) => s + x, 0) / v.length; });
      const mids = days.map(d => { const i = ints.find(x => x.day === d); return d - (i.dd || 0) / 2; });
      PW.line('wl-' + t, mids, ys, { color: COLORS[ci % 8], width: 2.2, label: t }); PW.scatter('wp-' + t, mids, ys, { color: COLORS[ci % 8], r: 3.5, noLegend: true });
    });
  } else $('#w-chart').innerHTML = '';
  // energy
  const E = G.energy(L);
  if (E.curves.length) {
    const PE = new Plot('#en-chart', { x: { label: 'Days after transplanting', unit: 'd' }, y: { label: 'Electricity', unit: 'kWh' }, legend: true, height: 250 }); calcCharts.push(PE);
    E.curves.forEach((c, k) => { const pts = c.pts.filter(p => p.day != null); PE.line('e-' + c.unit, pts.map(p => p.day), pts.map(p => p.cum), { color: ['amber', 'magenta', 'water'][k % 3], width: 2.4, label: 'meter ' + c.unit }); PE.scatter('es-' + c.unit, pts.map(p => p.day), pts.map(p => p.cum), { color: ['amber', 'magenta', 'water'][k % 3], r: 3.5, noLegend: true }); });
    if (G.isNum(L.meta.lamp_w) && G.isNum(L.meta.photoperiod_h)) { const dmax = Math.max(...E.curves.flatMap(c => c.pts.map(p => p.day ?? 0))); PE.line('e-exp', [0, dmax], [0, L.meta.lamp_w / 1000 * L.meta.photoperiod_h * dmax], { color: 'muted', dash: [5, 4], width: 1.5, label: 'lamp W × photoperiod' }); }
    const dev = E.expected ? 100 * (E.total - E.expected) / E.expected : null;
    $('#en-info').innerHTML = `Total <b>${fmt(E.total, 2)} kWh</b> in ${E.days} days = ${fmt(E.perDay, 3)} kWh per day.${E.expected ? ` Expected from ${L.meta.lamp_w} W × ${L.meta.photoperiod_h} h × ${E.days} d: ${fmt(E.expected, 2)} kWh (${dev >= 0 ? '+' : ''}${fmt(dev, 1)} %).` : ' Enter the lamp power and photoperiod in Set-up to check the reading.'}${I.e ? ` Specific energy use: <b>${fmt(I.e, 1)} kWh per kg</b> of shoot fresh mass.` : ''}`;
  } else { $('#en-chart').innerHTML = ''; $('#en-info').textContent = 'No energy-meter readings yet (system log, container ALL, column kWh).'; }
  stale.calc = false;
}
$('#g-var').addEventListener('change', renderCalc);
$('#g-csv').addEventListener('click', () => {
  const f = $('#g-var').value || 'area_cm2';
  const R = G.rgrPlants(L, f);
  if (!R.length) return toast('No RGR values yet');
  download(`rgr_${f}_${stamp()}.csv`, G.toCSV(['plant', 'treatment', 'day_1', 'day_2', f + '_1', f + '_2', 'rgr_per_day'], R.map(r => [r.plant, r.treatment, r.d1, r.d2, r.v1, r.v2, +r.rgr.toFixed(5)])), 'text/csv');
});

/* =====================================================================
   QUALITY
   ===================================================================== */
function completeness() {
  // dates on which at least half of the plants have a growth value: which plants are missing?
  const out = [];
  ['area_cm2', 'ec', 'ph'].forEach(f => {
    const byDate = new Map(); L.rows.forEach(r => { if (G.isNum(r[f])) { if (!byDate.has(r.date)) byDate.set(r.date, new Set()); byDate.get(r.date).add(r.plant); } });
    const n = L.meta.plants.length; if (!n) return;
    byDate.forEach((set, d) => { if (set.size >= n / 2 && set.size < n) { const miss = L.meta.plants.filter(p => !set.has(p.id)).map(p => p.id); out.push({ kind: 'info', level: 'info', field: f, date: d, msg: `${d}: ${G.VARS[f].short} missing for ${miss.join(', ')} — not measured, or not entered? Describe the reason in the notes.` }); } });
  });
  return out;
}
function renderQuality() {
  const issues = G.validateLog(L), info = completeness();
  const bad = issues.filter(i => i.level === 'bad'), warn = issues.filter(i => i.level === 'warn');
  $('#q-tiles').innerHTML = tile('Errors', bad.length, '', 'implausible values, duplicates, invalid dates', bad.length ? 'bad' : 'ok') + tile('Warnings', warn.length, '', 'outside target windows, falling growth values', warn.length ? 'warn' : 'ok') + tile('Missing values', info.length, '', 'on dates when most plants were measured', info.length ? 'warn' : 'ok') + tile('Rows · plants', `${L.rows.length} · ${L.meta.plants.length}`, '', `${new Set(L.rows.map(r => r.date)).size} measurement dates`);
  const all = [...bad, ...warn, ...info];
  $('#q-list').innerHTML = all.length ? all.slice(0, 300).map(i => `<li class="${i.level === 'bad' ? 'bad' : i.level === 'warn' ? '' : 'ok'}"><span><span class="pill ${i.level === 'bad' ? 'bad' : i.level === 'warn' ? 'warn' : ''}">${i.level === 'info' ? 'missing' : i.level === 'bad' ? 'error' : 'warning'}</span> ${esc(i.msg)}</span>${i.kind === 'row' && i.index >= 0 ? `<button type="button" class="btn btn-sm btn-ghost" data-go="${i.index}">Show row</button>` : ''}</li>`).join('') + (all.length > 300 ? `<li>… ${all.length - 300} more</li>` : '') : '<li class="ok"><span><span class="pill ok">all clear</span> No problems found. Keep checking after every session.</span></li>';
  stale.quality = false;
}
$('#q-list').addEventListener('click', e => {
  const b = e.target.closest('[data-go]'); if (!b) return;
  const i = +b.dataset.go, r = L.rows[i]; if (!r) return;
  highlightRow = i; showTab('table');
  $('#f-trt').value = ''; $('#f-date').value = ''; $('#f-q').value = ''; $('#f-issues').checked = false; $('#f-plant').value = r.plant; renderTable();
});

/* =====================================================================
   boot
   ===================================================================== */
function renderAll() { status(); if (tab === 'setup') renderSetup(); else showTab(tab, true); }
status();
showTab((location.hash || '#setup').slice(1), true);
if (!stored) { $('#gl-empty').hidden = false; }
document.addEventListener('ffp:theme', () => { if (tab === 'charts') renderCharts(); if (tab === 'calc') renderCalc(); });
