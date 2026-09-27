/* ==========================================================================
   growlog-core.js — data model of the course-project grow log (ES module)

   Storage: localStorage 'ffp-growlog-v1' as JSON
     { version: 1,
       meta: { title, crop, system, startDate:'YYYY-MM-DD', treatments:[…],        ← read by other labs
               group?, plants?:[{id, treatment, unit, block}], targets?:{trt:{ec}},  ← optional extras
               photoperiod_h?, area_m2?, lamp_w?, units_l? },
       rows: [{ date, day, plant, treatment, fw_g, leaves, area_cm2, height_cm,
                ec, ph, t_water, do_mgl, ppfd, notes,  dw_g?, root_fw_g? }],     ← course standard (+ optional harvest columns)
       resources?: [{ date, unit, water_l, kwh, air_t, rh, notes }] }              ← optional system log (water, energy, climate)
   The labs model-fitting, statistics-workbench, crop-growth-model and plant-vision
   read meta + rows; the optional keys are ignored by them.
   ========================================================================== */
import { mean, sd, linreg } from '../assets/js/stats.js';

export const KEY = 'ffp-growlog-v1';
export const COLS = ['date', 'day', 'plant', 'treatment', 'fw_g', 'leaves', 'area_cm2', 'height_cm', 'ec', 'ph', 't_water', 'do_mgl', 'ppfd', 'notes'];
export const EXTRA_COLS = ['dw_g', 'root_fw_g'];
export const NUM_COLS = ['fw_g', 'leaves', 'area_cm2', 'height_cm', 'ec', 'ph', 't_water', 'do_mgl', 'ppfd', 'dw_g', 'root_fw_g'];
export const RES_COLS = ['date', 'unit', 'water_l', 'kwh', 'air_t', 'rh', 'notes'];
export const RES_NUM = ['water_l', 'kwh', 'air_t', 'rh'];

export const VARS = {
  area_cm2: { label: 'Projected leaf area', short: 'Area', unit: 'cm²', digits: 0, growth: true },
  fw_g: { label: 'Shoot fresh mass', short: 'FW', unit: 'g', digits: 1, growth: true },
  leaves: { label: 'Leaf number', short: 'Leaves', unit: 'leaves', digits: 0, growth: true },
  height_cm: { label: 'Plant height', short: 'Height', unit: 'cm', digits: 1, growth: true },
  ec: { label: 'Electrical conductivity', short: 'EC', unit: 'mS cm⁻¹', digits: 2 },
  ph: { label: 'pH', short: 'pH', unit: '', digits: 2 },
  t_water: { label: 'Solution temperature', short: 'T water', unit: '°C', digits: 1 },
  do_mgl: { label: 'Dissolved oxygen', short: 'DO', unit: 'mg L⁻¹', digits: 1 },
  ppfd: { label: 'PPFD at canopy height', short: 'PPFD', unit: 'µmol m⁻² s⁻¹', digits: 0 },
  dw_g: { label: 'Shoot dry mass', short: 'DW', unit: 'g', digits: 2, harvest: true },
  root_fw_g: { label: 'Root fresh mass', short: 'Root FW', unit: 'g', digits: 1, harvest: true }
};

/* ------------------------------------------------------------ validation limits
   bad  = physically implausible or harmful (probably an entry error or an emergency)
   warn = outside the recommended operating window (Lessons 5.2, 5.3, 9.3)            */
export const LIMITS = {
  ec: { bad: [0.1, 4.5], warn: [0.8, 2.6], tolTarget: 0.3, unit: 'mS cm⁻¹' },
  ph: { bad: [4.5, 7.8], warn: [5.5, 6.5], unit: '' },
  t_water: { bad: [8, 30], warn: [18, 24], unit: '°C' },
  do_mgl: { bad: [4, 20], warn: [6, 20], unit: 'mg L⁻¹' },
  ppfd: { bad: [0, 2500], warn: [100, 600], unit: 'µmol m⁻² s⁻¹' },
  air_t: { bad: [5, 40], warn: [16, 26], unit: '°C' },
  rh: { bad: [5, 100], warn: [40, 85], unit: '%' }
};

export const isNum = v => v !== null && v !== undefined && v !== '' && Number.isFinite(+v);
export const num = v => (isNum(v) ? +v : null);
const r = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

/* ------------------------------------------------------------ dates */
export function isoToday() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); }
export function validDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T12:00:00Z')); }
/** Days after the start date (day 0 = transplanting). */
export function dayOf(date, start) {
  if (!validDate(date) || !validDate(start)) return null;
  return Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(start + 'T12:00:00Z')) / 864e5);
}
export function addDays(date, n) { return new Date(Date.parse(date + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
/** Accept 2026-02-09, 2026/02/09, 9.2.2026, 09/02/2026 (day first) and Excel serial numbers. */
export function normDate(v) {
  if (v == null) return '';
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s;
}

/* ------------------------------------------------------------ log object */
export function emptyLog() {
  return { version: 1, meta: { title: '', group: '', crop: '', system: '', startDate: '', treatments: [], plants: [], targets: {}, photoperiod_h: 16, area_m2: null, lamp_w: null }, rows: [], resources: [] };
}
export function normalise(log) {
  const L = emptyLog();
  if (!log || typeof log !== 'object') return L;
  Object.assign(L.meta, log.meta || {});
  L.meta.treatments = Array.isArray(L.meta.treatments) ? L.meta.treatments.map(String) : [];
  L.meta.plants = Array.isArray(L.meta.plants) ? L.meta.plants.filter(p => p && p.id != null).map(p => ({ id: String(p.id), treatment: p.treatment != null ? String(p.treatment) : '', unit: p.unit != null && p.unit !== '' ? String(p.unit) : String(p.id), block: p.block != null ? String(p.block) : '' })) : [];
  L.meta.targets = L.meta.targets && typeof L.meta.targets === 'object' ? L.meta.targets : {};
  L.rows = Array.isArray(log.rows) ? log.rows.map(cleanRow) : [];
  L.resources = Array.isArray(log.resources) ? log.resources.map(cleanRes) : [];
  // treatments and plants discovered in the data
  L.rows.forEach(rw => {
    if (rw.treatment && !L.meta.treatments.includes(rw.treatment)) L.meta.treatments.push(rw.treatment);
    if (rw.plant && !L.meta.plants.some(p => p.id === rw.plant)) L.meta.plants.push({ id: rw.plant, treatment: rw.treatment || '', unit: rw.plant, block: '' });
  });
  recomputeDays(L);
  return L;
}
export function cleanRow(o) {
  const rw = { date: normDate(o.date || ''), day: num(o.day), plant: o.plant != null ? String(o.plant).trim() : '', treatment: o.treatment != null ? String(o.treatment).trim() : '' };
  ['fw_g', 'leaves', 'area_cm2', 'height_cm', 'ec', 'ph', 't_water', 'do_mgl', 'ppfd'].forEach(k => { rw[k] = num(o[k]); });
  rw.notes = o.notes != null ? String(o.notes) : '';
  EXTRA_COLS.forEach(k => { if (isNum(o[k])) rw[k] = +o[k]; });
  return rw;
}
export function cleanRes(o) {
  const rs = { date: normDate(o.date || ''), unit: o.unit != null && String(o.unit).trim() !== '' ? String(o.unit).trim() : 'ALL' };
  RES_NUM.forEach(k => { rs[k] = num(o[k]); });
  rs.notes = o.notes != null ? String(o.notes) : '';
  return rs;
}
export function recomputeDays(L) {
  const s = L.meta.startDate;
  if (validDate(s)) L.rows.forEach(rw => { const d = dayOf(rw.date, s); if (d != null) rw.day = d; });
  sortLog(L);
  return L;
}
export function sortLog(L) {
  L.rows.sort((a, b) => (a.date || '').localeCompare(b.date || '') || natCmp(a.plant, b.plant));
  L.resources.sort((a, b) => (a.date || '').localeCompare(b.date || '') || natCmp(a.unit, b.unit));
}
export function natCmp(a, b) { return String(a ?? '').localeCompare(String(b ?? ''), 'en', { numeric: true }); }

export function load() {
  try { const raw = localStorage.getItem(KEY); if (!raw) return null; return normalise(JSON.parse(raw)); } catch (e) { return null; }
}
export function save(L) {
  const out = { version: 1, meta: L.meta, rows: L.rows, resources: L.resources, saved: new Date().toISOString() };
  try { localStorage.setItem(KEY, JSON.stringify(out)); return true; } catch (e) { return false; }
}
export function plantInfo(L, id) { return L.meta.plants.find(p => p.id === id) || { id, treatment: '', unit: id, block: '' }; }
export function treatmentsOf(L) {
  const t = [...L.meta.treatments];
  L.rows.forEach(rw => { if (rw.treatment && !t.includes(rw.treatment)) t.push(rw.treatment); });
  return t;
}

/* ------------------------------------------------------------ CSV */
/** Robust CSV/TSV/semicolon parser with quoted fields, doubled quotes and embedded newlines. */
export function parseCSV(text) {
  text = String(text || '').replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/).find(l => l.trim()) || '';
  const count = ch => (firstLine.match(new RegExp(ch === '\t' ? '\\t' : '\\' + ch, 'g')) || []).length;
  const sep = count('\t') > 0 ? '\t' : (count(';') > count(',') ? ';' : ',');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const nonEmpty = rows.filter(rw => rw.some(c => String(c).trim() !== ''));
  if (!nonEmpty.length) return { headers: [], rows: [], sep };
  const headers = nonEmpty[0].map(h => h.trim());
  const body = nonEmpty.slice(1).map(rw => rw.map(c => c.trim()));
  return { headers, rows: body, sep };
}
export function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCSV(headers, rows) { return [headers.join(','), ...rows.map(rw => rw.map(csvCell).join(','))].join('\n') + '\n'; }
const numIn = (s, sep) => { if (s == null) return null; let t = String(s).trim(); if (t === '' || /^(na|nan|null|-|—)$/i.test(t)) return null; if (sep === ';' || /^-?\d+,\d+$/.test(t)) t = t.replace(',', '.'); return Number.isFinite(+t) ? +t : null; };

/** Rows → CSV text. Standard 14 columns first; unit/block (from meta.plants) and harvest extras appended. */
export function rowsCSV(L) {
  const extras = EXTRA_COLS.filter(k => L.rows.some(rw => isNum(rw[k])));
  const headers = [...COLS, 'unit', 'block', ...extras];
  const out = L.rows.map(rw => { const p = plantInfo(L, rw.plant); return [...COLS.map(k => rw[k] ?? ''), p.unit ?? '', p.block ?? '', ...extras.map(k => rw[k] ?? '')]; });
  return toCSV(headers, out);
}
export function resourcesCSV(L) { return toCSV(RES_COLS, L.resources.map(rs => RES_COLS.map(k => rs[k] ?? ''))); }

const ALIASES = {
  date: ['date', 'datum'], day: ['day', 'dat', 'days', 'day_after_transplanting'], plant: ['plant', 'plant_id', 'id', 'jar', 'plant id'],
  treatment: ['treatment', 'trt', 'group'], fw_g: ['fw_g', 'fw', 'fresh_weight', 'fresh_mass', 'fresh weight (g)'], leaves: ['leaves', 'leaf_number', 'leaf_count'],
  area_cm2: ['area_cm2', 'area', 'pla', 'leaf_area', 'projected_area'], height_cm: ['height_cm', 'height'], ec: ['ec', 'ec_ms_cm', 'ec (ms/cm)'], ph: ['ph'],
  t_water: ['t_water', 'water_t', 'temp_water', 'solution_temperature'], do_mgl: ['do_mgl', 'do', 'dissolved_oxygen'], ppfd: ['ppfd'], notes: ['notes', 'note', 'comment', 'comments'],
  dw_g: ['dw_g', 'dw', 'dry_weight', 'dry_mass'], root_fw_g: ['root_fw_g', 'root_fw', 'root_mass'], unit: ['unit', 'container', 'tank', 'box'], block: ['block', 'shelf', 'position'],
  water_l: ['water_l', 'water', 'topup_l', 'top_up_l'], kwh: ['kwh', 'energy_kwh', 'meter_kwh'], air_t: ['air_t', 't_air', 'air_temperature'], rh: ['rh', 'relative_humidity']
};
function mapHeaders(headers) {
  const m = {};
  headers.forEach((h, j) => { const k = h.toLowerCase().trim(); for (const [std, al] of Object.entries(ALIASES)) if (al.includes(k) && m[std] == null) m[std] = j; });
  return m;
}
/** Import plant rows from CSV text. mode: 'replace' | 'merge'. Returns { log, added, updated, skipped, unknown, kind }. */
export function importCSV(text, L, mode = 'merge') {
  const T = parseCSV(text);
  const m = mapHeaders(T.headers);
  const unknown = T.headers.filter((h, j) => !Object.values(m).includes(j));
  const out = normalise(mode === 'replace' ? { meta: L.meta, rows: [], resources: L.resources } : L);
  const hadTreatments = out.meta.treatments.length > 0;
  // resource log?
  const isRes = m.plant == null && (m.water_l != null || m.kwh != null);
  let added = 0, updated = 0, skipped = 0;
  if (isRes) {
    if (mode === 'replace') out.resources = [];
    T.rows.forEach(c => {
      const o = { date: normDate(c[m.date]), unit: m.unit != null ? c[m.unit] : 'ALL', notes: m.notes != null ? c[m.notes] : '' };
      RES_NUM.forEach(k => { o[k] = m[k] != null ? numIn(c[m[k]], T.sep) : null; });
      if (!validDate(o.date)) { skipped++; return; }
      out.resources.push(cleanRes(o)); added++;
    });
    sortLog(out);
    return { log: out, added, updated, skipped, unknown, kind: 'resources' };
  }
  T.rows.forEach(c => {
    const o = {};
    ['date', 'plant', 'treatment', 'notes'].forEach(k => { o[k] = m[k] != null ? c[m[k]] ?? '' : ''; });
    o.date = normDate(o.date);
    o.day = m.day != null ? numIn(c[m.day], T.sep) : null;
    NUM_COLS.forEach(k => { o[k] = m[k] != null ? numIn(c[m[k]], T.sep) : null; });
    if (!validDate(o.date) || !String(o.plant).trim()) { skipped++; return; }
    const rw = cleanRow(o);
    const unit = m.unit != null ? String(c[m.unit] ?? '').trim() : '', block = m.block != null ? String(c[m.block] ?? '').trim() : '';
    let p = out.meta.plants.find(x => x.id === rw.plant);
    if (!p) { p = { id: rw.plant, treatment: rw.treatment, unit: unit || rw.plant, block }; out.meta.plants.push(p); }
    else { if (unit) p.unit = unit; if (block) p.block = block; if (!p.treatment) p.treatment = rw.treatment; }
    if (rw.treatment && !out.meta.treatments.includes(rw.treatment)) out.meta.treatments.push(rw.treatment);
    const ex = out.rows.find(x => x.plant === rw.plant && x.date === rw.date);
    if (ex) { Object.keys(rw).forEach(k => { if (rw[k] !== null && rw[k] !== '') ex[k] = rw[k]; }); updated++; }
    else { out.rows.push(rw); added++; }
  });
  if (!hadTreatments) out.meta.treatments.sort(natCmp);
  if (!validDate(out.meta.startDate) && out.rows.length) {
    // infer the start date from day numbers if present, else the earliest date
    const withDay = out.rows.find(rw => isNum(rw.day) && validDate(rw.date));
    out.meta.startDate = withDay ? addDays(withDay.date, -withDay.day) : out.rows.map(rw => rw.date).sort()[0];
  }
  recomputeDays(out);
  return { log: out, added, updated, skipped, unknown, kind: 'rows' };
}

/* ------------------------------------------------------------ validation */
/** Check one value; returns null or { level:'warn'|'bad', msg }. */
export function checkValue(field, v, L, rw) {
  if (!isNum(v)) return null;
  v = +v;
  const lim = LIMITS[field];
  if (field === 'ec') {
    if (v > 50) return { level: 'bad', msg: `EC ${v} — looks like µS cm⁻¹; enter mS cm⁻¹ (${(v / 1000).toFixed(2)}?)` };
    if (v < lim.bad[0] || v > lim.bad[1]) return { level: 'bad', msg: `EC ${v} mS cm⁻¹ is implausible for a nutrient solution` };
    const tgt = rw && L && L.meta.targets && L.meta.targets[rw.treatment] && isNum(L.meta.targets[rw.treatment].ec) ? +L.meta.targets[rw.treatment].ec : null;
    if (tgt != null) { if (Math.abs(v - tgt) > lim.tolTarget) return { level: 'warn', msg: `EC ${v} is more than ${lim.tolTarget} from the target ${tgt} mS cm⁻¹ of ${rw.treatment}` }; return null; }
    if (v < lim.warn[0] || v > lim.warn[1]) return { level: 'warn', msg: `EC ${v} mS cm⁻¹ is outside ${lim.warn[0]}–${lim.warn[1]} (typical for leafy crops)` };
    return null;
  }
  if (field === 'ppfd' && v > 2500) return { level: 'bad', msg: `PPFD ${v} is above full sunlight — check the unit (lux?)` };
  if (['fw_g', 'leaves', 'area_cm2', 'height_cm', 'dw_g', 'root_fw_g', 'water_l'].includes(field)) return v < 0 ? { level: 'bad', msg: `${field} cannot be negative` } : null;
  if (!lim) return null;
  if (v < lim.bad[0] || v > lim.bad[1]) return { level: 'bad', msg: `${label(field)} ${v}${lim.unit ? ' ' + lim.unit : ''} outside ${lim.bad[0]}–${lim.bad[1]}: act now or check the entry` };
  if (v < lim.warn[0] || v > lim.warn[1]) return { level: 'warn', msg: `${label(field)} ${v}${lim.unit ? ' ' + lim.unit : ''} outside the target ${lim.warn[0]}–${lim.warn[1]}` };
  return null;
}
const label = f => (VARS[f] ? VARS[f].short : ({ air_t: 'Air T', rh: 'RH' }[f] || f));

/** All issues in the log: [{ kind:'row'|'res'|'log', index, field, level, msg }]. */
export function validateLog(L) {
  const issues = [];
  const seen = new Map();
  L.rows.forEach((rw, i) => {
    if (!validDate(rw.date)) issues.push({ kind: 'row', index: i, field: 'date', level: 'bad', msg: `Row ${i + 1}: invalid date “${rw.date}” (use YYYY-MM-DD)` });
    else if (validDate(L.meta.startDate) && rw.date < L.meta.startDate) issues.push({ kind: 'row', index: i, field: 'date', level: 'warn', msg: `Row ${i + 1}: ${rw.date} is before the start date ${L.meta.startDate}` });
    if (!rw.plant) issues.push({ kind: 'row', index: i, field: 'plant', level: 'bad', msg: `Row ${i + 1}: plant ID missing` });
    if (!rw.treatment) issues.push({ kind: 'row', index: i, field: 'treatment', level: 'warn', msg: `Row ${i + 1}: treatment missing` });
    const k = rw.plant + '|' + rw.date;
    if (seen.has(k)) issues.push({ kind: 'row', index: i, field: 'plant', level: 'bad', msg: `Row ${i + 1}: duplicate of row ${seen.get(k) + 1} (${rw.plant}, ${rw.date})` }); else seen.set(k, i);
    NUM_COLS.forEach(f => { const c = checkValue(f, rw[f], L, rw); if (c) issues.push({ kind: 'row', index: i, field: f, level: c.level, msg: `${rw.plant} · ${rw.date}: ${c.msg}` }); });
    const p = L.meta.plants.find(x => x.id === rw.plant);
    if (p && p.treatment && rw.treatment && p.treatment !== rw.treatment) issues.push({ kind: 'row', index: i, field: 'treatment', level: 'bad', msg: `${rw.plant} · ${rw.date}: treatment “${rw.treatment}” differs from the plant list (“${p.treatment}”)` });
  });
  // growth consistency: a projected area or height that falls by > 25 % between visits
  ['area_cm2', 'height_cm', 'leaves'].forEach(f => {
    series(L, f).forEach((pts, plant) => {
      for (let j = 1; j < pts.length; j++) {
        const [d0, v0] = pts[j - 1], [d1, v1] = pts[j];
        if (v0 > 0 && v1 < 0.75 * v0) issues.push({ kind: 'row', index: L.rows.findIndex(rw => rw.plant === plant && rw.day === d1), field: f, level: 'warn', msg: `${plant}: ${VARS[f].short} fell from ${v0} (day ${d0}) to ${v1} (day ${d1}) — entry error, damage or a different camera set-up?` });
        if (f === 'area_cm2' && v0 > 0 && d1 > d0 && Math.log(v1 / v0) / (d1 - d0) > 0.5) issues.push({ kind: 'row', index: L.rows.findIndex(rw => rw.plant === plant && rw.day === d1), field: f, level: 'warn', msg: `${plant}: area RGR ${(Math.log(v1 / v0) / (d1 - d0)).toFixed(2)} d⁻¹ between day ${d0} and ${d1} is implausibly high` });
      }
    });
  });
  L.resources.forEach((rs, i) => {
    if (!validDate(rs.date)) issues.push({ kind: 'res', index: i, field: 'date', level: 'bad', msg: `System log row ${i + 1}: invalid date` });
    ['water_l', 'air_t', 'rh'].forEach(f => { const c = checkValue(f, rs[f], L, null); if (c) issues.push({ kind: 'res', index: i, field: f, level: c.level, msg: `System log ${rs.unit} · ${rs.date}: ${c.msg}` }); });
  });
  // energy meter must not decrease
  energyReadings(L).forEach((pts, unit) => { for (let j = 1; j < pts.length; j++) if (pts[j].kwh < pts[j - 1].kwh) issues.push({ kind: 'res', index: pts[j].index, field: 'kwh', level: 'bad', msg: `Energy meter ${unit}: reading ${pts[j].kwh} kWh on ${pts[j].date} is lower than the previous one — meter reset? Record the reset in the notes and restart from 0 as a new meter label.` }); });
  if (!validDate(L.meta.startDate)) issues.push({ kind: 'log', level: 'warn', field: 'startDate', msg: 'Set the start date (day 0 = transplanting) in Set-up so that days are computed.' });
  return issues;
}

/* ------------------------------------------------------------ series & summaries */
/** Map plant → [[day, value], …] sorted by day, finite values only. */
export function series(L, f) {
  const m = new Map();
  L.rows.forEach(rw => { if (isNum(rw[f]) && isNum(rw.day)) { if (!m.has(rw.plant)) m.set(rw.plant, []); m.get(rw.plant).push([+rw.day, +rw[f]]); } });
  m.forEach(a => a.sort((p, q) => p[0] - q[0]));
  return m;
}
/** Per treatment and day: n, mean, sd, se, mean of ln (for positive variables). */
export function byTreatmentDay(L, f) {
  const out = new Map();
  treatmentsOf(L).forEach(t => out.set(t, new Map()));
  L.rows.forEach(rw => {
    if (!isNum(rw[f]) || !isNum(rw.day)) return;
    const t = rw.treatment || '(none)';
    if (!out.has(t)) out.set(t, new Map());
    const m = out.get(t); if (!m.has(+rw.day)) m.set(+rw.day, []); m.get(+rw.day).push(+rw[f]);
  });
  const res = new Map();
  out.forEach((m, t) => {
    const arr = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([d, v]) => {
      const n = v.length, mu = mean(v), s = n > 1 ? sd(v) : NaN;
      const pos = v.every(x => x > 0);
      return { day: d, n, mean: mu, sd: s, se: n > 1 ? s / Math.sqrt(n) : NaN, meanLn: pos ? mean(v.map(Math.log)) : NaN, values: v };
    });
    if (arr.length) res.set(t, arr);
  });
  return res;
}

/** RGR between successive measurement days for each plant: [{plant, treatment, d1, d2, v1, v2, rgr}] */
export function rgrPlants(L, f = 'area_cm2') {
  const out = [];
  series(L, f).forEach((pts, plant) => {
    const trt = plantInfo(L, plant).treatment || (L.rows.find(rw => rw.plant === plant) || {}).treatment || '';
    for (let j = 1; j < pts.length; j++) {
      const [d1, v1] = pts[j - 1], [d2, v2] = pts[j];
      if (v1 > 0 && v2 > 0 && d2 > d1) out.push({ plant, treatment: trt, d1, d2, v1, v2, rgr: Math.log(v2 / v1) / (d2 - d1) });
    }
  });
  return out;
}
/** Treatment RGR between successive measurement days from the mean of ln values (Hoffmann & Poorter 2002):
    RGR = (mean ln W2 − mean ln W1)/(t2 − t1). SE from the individual RGRs of the plants measured on both days. */
export function rgrTreatments(L, f = 'area_cm2') {
  const bt = byTreatmentDay(L, f), out = [];
  const S = series(L, f);
  bt.forEach((arr, t) => {
    for (let j = 1; j < arr.length; j++) {
      const a = arr[j - 1], b = arr[j];
      if (!Number.isFinite(a.meanLn) || !Number.isFinite(b.meanLn) || b.day <= a.day) continue;
      const rg = (b.meanLn - a.meanLn) / (b.day - a.day);
      const ind = [];
      S.forEach((pts, plant) => {
        if ((plantInfo(L, plant).treatment || '') !== t && !L.rows.some(rw => rw.plant === plant && rw.treatment === t)) return;
        const p1 = pts.find(p => p[0] === a.day), p2 = pts.find(p => p[0] === b.day);
        if (p1 && p2 && p1[1] > 0 && p2[1] > 0) ind.push(Math.log(p2[1] / p1[1]) / (b.day - a.day));
      });
      const n = ind.length;
      out.push({ treatment: t, d1: a.day, d2: b.day, mid: (a.day + b.day) / 2, n1: a.n, n2: b.n, n, rgr: rg, se: n > 1 ? sd(ind) / Math.sqrt(n) : NaN, td: rg > 0 ? Math.LN2 / rg : NaN });
    }
  });
  return out.sort((p, q) => natCmp(p.treatment, q.treatment) || p.d1 - q.d1);
}
/** Whole-period RGR per plant from the slope of ln(value) against day (least squares). */
export function rgrSlopes(L, f = 'area_cm2', d0 = -Infinity, d1 = Infinity) {
  const out = [];
  series(L, f).forEach((pts, plant) => {
    const P = pts.filter(p => p[0] >= d0 && p[0] <= d1 && p[1] > 0);
    if (P.length >= 2) { const lr = linreg(P.map(p => p[0]), P.map(p => Math.log(p[1]))); out.push({ plant, treatment: plantInfo(L, plant).treatment, rgr: lr.slope, n: P.length }); }
  });
  return out;
}

/* ------------------------------------------------------------ harvest */
/** Last row with a fresh mass for every plant (the harvest), with dry-matter content. */
export function harvestRows(L) {
  const last = new Map();
  L.rows.forEach(rw => { if (isNum(rw.fw_g)) { const p = last.get(rw.plant); if (!p || rw.day >= p.day) last.set(rw.plant, rw); } });
  return [...last.values()].map(rw => {
    const p = plantInfo(L, rw.plant);
    return { plant: rw.plant, treatment: rw.treatment || p.treatment, unit: p.unit, block: p.block, day: rw.day, date: rw.date, fw: +rw.fw_g, dw: isNum(rw.dw_g) ? +rw.dw_g : null, root: isNum(rw.root_fw_g) ? +rw.root_fw_g : null, area: isNum(rw.area_cm2) ? +rw.area_cm2 : null, dmc: isNum(rw.dw_g) ? 100 * rw.dw_g / rw.fw_g : null };
  }).sort((a, b) => natCmp(a.plant, b.plant));
}
export function summarise(values) {
  const v = values.filter(Number.isFinite); const n = v.length;
  return { n, mean: n ? mean(v) : NaN, sd: n > 1 ? sd(v) : NaN, se: n > 1 ? sd(v) / Math.sqrt(n) : NaN, min: n ? Math.min(...v) : NaN, max: n ? Math.max(...v) : NaN };
}

/* ------------------------------------------------------------ allometric calibration FW = a·A^b */
export function calibration(L) {
  const pts = L.rows.filter(rw => isNum(rw.fw_g) && isNum(rw.area_cm2) && rw.fw_g > 0 && rw.area_cm2 > 0).map(rw => [+rw.area_cm2, +rw.fw_g]);
  if (pts.length < 3) return null;
  const lr = linreg(pts.map(p => Math.log(p[0])), pts.map(p => Math.log(p[1])));
  return { n: pts.length, a: Math.exp(lr.intercept), b: lr.slope, r2: lr.r2, seB: lr.seSlope, ciB: lr.ciSlope, pts, predict: A => Math.exp(lr.intercept) * Math.pow(A, lr.slope), range: [Math.min(...pts.map(p => p[0])), Math.max(...pts.map(p => p[0]))] };
}

/* ------------------------------------------------------------ water and energy */
/** Number of plants per unit (container), from the plant list. */
export function plantsPerUnit(L) {
  const m = new Map();
  L.meta.plants.forEach(p => { const u = p.unit || p.id; m.set(u, (m.get(u) || 0) + 1); });
  return m;
}
export function unitTreatment(L, unit) { const p = L.meta.plants.find(x => (x.unit || x.id) === unit); return p ? p.treatment : ''; }
/** Water use per unit: intervals [{unit, treatment, date, day, dd, water, perPlantDay}] and totals. */
export function waterUse(L) {
  const ppu = plantsPerUnit(L), start = L.meta.startDate;
  const byUnit = new Map();
  L.resources.forEach(rs => { if (isNum(rs.water_l) && rs.unit && rs.unit !== 'ALL') { if (!byUnit.has(rs.unit)) byUnit.set(rs.unit, []); byUnit.get(rs.unit).push(rs); } });
  const intervals = [], totals = [];
  byUnit.forEach((arr, unit) => {
    arr.sort((a, b) => a.date.localeCompare(b.date));
    let prev = start && validDate(start) ? start : null, cum = 0;
    const n = ppu.get(unit) || 1;
    arr.forEach(rs => {
      const dd = prev ? dayOf(rs.date, prev) : null;
      cum += +rs.water_l;
      intervals.push({ unit, treatment: unitTreatment(L, unit), date: rs.date, day: dayOf(rs.date, start), dd, water: +rs.water_l, cum, plants: n, perPlantDay: dd > 0 ? rs.water_l / n / dd : null });
      prev = rs.date;
    });
    const days = validDate(start) ? dayOf(arr[arr.length - 1].date, start) : null;
    totals.push({ unit, treatment: unitTreatment(L, unit), plants: n, water: cum, days, perPlantDay: days > 0 ? cum / n / days : null });
  });
  return { intervals, totals: totals.sort((a, b) => natCmp(a.unit, b.unit)) };
}
/** Energy-meter readings per meter label: Map unit → [{date, day, kwh, index}] */
export function energyReadings(L) {
  const m = new Map();
  L.resources.forEach((rs, i) => { if (isNum(rs.kwh)) { const u = rs.unit || 'ALL'; if (!m.has(u)) m.set(u, []); m.get(u).push({ date: rs.date, day: dayOf(rs.date, L.meta.startDate), kwh: +rs.kwh, index: i }); } });
  m.forEach(a => a.sort((p, q) => p.date.localeCompare(q.date)));
  return m;
}
export function energy(L) {
  const meters = energyReadings(L);
  let total = 0, first = null, last = null; const curves = [];
  meters.forEach((pts, unit) => {
    if (pts.length < 2) return;
    total += pts[pts.length - 1].kwh - pts[0].kwh;
    first = first == null || pts[0].date < first ? pts[0].date : first;
    last = last == null || pts[pts.length - 1].date > last ? pts[pts.length - 1].date : last;
    curves.push({ unit, pts: pts.map(p => ({ ...p, cum: p.kwh - pts[0].kwh })) });
  });
  const days = first && last ? dayOf(last, first) : null;
  const expected = isNum(L.meta.lamp_w) && isNum(L.meta.photoperiod_h) && days ? L.meta.lamp_w / 1000 * L.meta.photoperiod_h * days : null;
  return { total, days, perDay: days ? total / days : null, curves, expected };
}

/* ------------------------------------------------------------ resource-use indicators (Lesson 8.4) */
export function indicators(L) {
  const H = harvestRows(L);
  const yieldG = H.reduce((s, h) => s + h.fw, 0);
  const dwAll = H.filter(h => h.dw != null);
  const dmc = dwAll.length ? dwAll.reduce((s, h) => s + h.dw, 0) / dwAll.reduce((s, h) => s + h.fw, 0) : null;
  const dwG = dmc != null ? yieldG * dmc : null;
  const W = waterUse(L);
  const water = W.totals.reduce((s, t) => s + t.water, 0);
  // water only from units whose plants were harvested
  const E = energy(L);
  const ppfdVals = L.rows.filter(rw => isNum(rw.ppfd)).map(rw => +rw.ppfd);
  const ppfd = ppfdVals.length ? mean(ppfdVals) : null;
  const hp = isNum(L.meta.photoperiod_h) ? +L.meta.photoperiod_h : null;
  const dli = ppfd != null && hp != null ? ppfd * hp * 3600 / 1e6 : null;
  const days = H.length ? Math.max(...H.map(h => h.day)) : null;
  const area = isNum(L.meta.area_m2) ? +L.meta.area_m2 : null;
  const photons = dli != null && days && area ? dli * days * area : null;           // mol over the lit area
  return {
    plants: H.length, yieldG, yieldKg: yieldG / 1000, meanFW: H.length ? yieldG / H.length : null,
    dmc, dwG, water, wp: water > 0 ? yieldG / water : null, pwu: yieldG > 0 ? water / (yieldG / 1000) : null,
    waterPerPlantDay: W.totals.length ? mean(W.totals.filter(t => t.perPlantDay != null).map(t => t.perPlantDay)) : null,
    kwh: E.total, kwhDays: E.days, kwhExpected: E.expected, e: yieldG > 0 && E.total > 0 ? E.total / (yieldG / 1000) : null, eue: E.total > 0 ? (yieldG / 1000) / E.total : null,
    ppfd, photoperiod: hp, dli, days, area, photons,
    lueDW: photons && dwG != null ? dwG / photons : null, lueFW: photons ? yieldG / photons : null,
    yieldArea: area ? yieldG / 1000 / area : null
  };
}

export const fmtN = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
export { r as round };
