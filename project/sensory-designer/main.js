/* ==========================================================================
   Sensory study designer — course-project tool
   Storage: localStorage 'ffp-sensory-v1'
     { version: 1,
       design: { test: 'triangle'|'hedonic'|'preference', samples: [{ code, label }], panellists, orders: [[…]],
                 codes: [[…]], title, seed, uniqueCodes, instruction, created },
       responses: [{ panellist, correct, chosen }] | [{ panellist, sample, score }] }
   ========================================================================== */
import { Plot } from '/assets/js/plot.js';
import { mulberry32, shuffle, mean, sd, tInv, normCdf, normPdf, randn, binomPmf, binomUpper, binomCdf, binomCritical, anovaRCBD, tukeyRCBD } from '/assets/js/stats.js';

const KEY = 'ffp-sensory-v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = m => (window.FFP && FFP.toast ? FFP.toast(m) : console.log(m));
function download(name, text, type) { if (window.FFP && FFP.download) FFP.download(name, text, type); else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 300); } }
const f = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/^-/, '−') : '—');
const fp = p => (!Number.isFinite(p) ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3));
const LET = i => String.fromCharCode(65 + i);
const TRI = ['ABB', 'AAB', 'ABA', 'BAA', 'BBA', 'BAB'];
const HED = ['Dislike extremely', 'Dislike very much', 'Dislike moderately', 'Dislike slightly', 'Neither like nor dislike', 'Like slightly', 'Like moderately', 'Like very much', 'Like extremely'];
const DEFAULT_INSTR = {
  triangle: 'Taste the three samples from left to right. Two samples are identical and one is different. Circle the code of the sample that is different. If you are not sure, you must still choose one.',
  hedonic: 'Taste the samples one at a time, from left to right. Rinse your mouth with water and eat a piece of cracker between samples. Mark how much you like each sample overall.',
  preference: 'Taste both samples from left to right. Rinse with water between them. Circle the code of the sample you prefer. You must choose one.'
};

/* =====================================================================
   state
   ===================================================================== */
let S = null, lastSaved = null;
try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); if (o && o.design && Array.isArray(o.design.orders)) S = { version: 1, design: o.design, responses: Array.isArray(o.responses) ? o.responses : [] }; } catch (e) { S = null; }
const form = { test: 'triangle', title: '', n: 24, seed: 2026, samples: [{ code: 'A', label: '' }, { code: 'B', label: '' }], unique: true };
if (S) { const d = S.design; Object.assign(form, { test: d.test, title: d.title || '', n: d.panellists, seed: d.seed ?? 2026, samples: d.samples.map(s => ({ code: s.code, label: s.label })), unique: d.uniqueCodes !== false }); }
function save(msg) { try { localStorage.setItem(KEY, JSON.stringify(S)); lastSaved = new Date(); } catch (e) { toast('Could not save — is browser storage blocked?'); } status(); if (msg) toast(msg); }
function status() {
  const el = $('#sd-status');
  const t = lastSaved ? ` · saved ${lastSaved.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '';
  $('span', el).textContent = S ? `${{ triangle: 'Triangle test', hedonic: 'Hedonic rating', preference: 'Paired preference' }[S.design.test]} · ${S.design.panellists} panellists · ${answeredPanellists()} answered${t}` : 'No study designed yet in this browser';
  $('#n-resp').textContent = S ? answeredPanellists() : 0;
  const ban = $('#sd-banner');
  const flags = S ? [S.design.illustrative ? 'is an illustrative example' : '', S.design.simulated ? 'contains simulated responses' : ''].filter(Boolean) : [];
  ban.hidden = !flags.length;
  if (flags.length) ban.innerHTML = `<b>This study ${flags.join(' and ')}.</b> Use it to learn the tool; generate a new design (and enter real answers) for your own study. Never report simulated responses as results.`;
}
function answeredPanellists() { if (!S) return 0; return new Set(S.responses.map(r => r.panellist)).size; }

/* =====================================================================
   design generation
   ===================================================================== */
function codeOK(c) { const d = String(c).split('').map(Number); if (new Set(d).size < 3) return false; const a = d[1] - d[0], b = d[2] - d[1]; return !(a === b && Math.abs(a) === 1); }
function makePool(rng) { const all = []; for (let c = 100; c <= 999; c++) if (codeOK(c)) all.push(String(c)); return shuffle(all, rng); }
/** Williams design for t samples (Williams, 1949): t sequences for even t, 2t for odd t. */
export function williams(t) {
  const a = [0]; let lo = 1, hi = t - 1, k = 1;
  while (a.length < t) { a.push(k % 2 ? lo++ : hi--); k++; }
  const rows = []; for (let i = 0; i < t; i++) rows.push(a.map(x => (x + i) % t));
  if (t % 2 === 1) rows.slice().forEach(r => rows.push(r.slice().reverse()));
  return rows;
}
function generate(fm) {
  const rng = mulberry32(+fm.seed || 1);
  const n = Math.max(2, Math.min(200, Math.round(+fm.n || 2)));
  const t = fm.samples.length;
  let seqs;
  if (fm.test === 'triangle') seqs = TRI.map(s => s.split(''));
  else if (fm.test === 'preference') seqs = [['A', 'B'], ['B', 'A']];
  else seqs = williams(t).map(r => r.map(LET));
  const orders = [];
  while (orders.length < n) { shuffle(seqs, rng).forEach(s => { if (orders.length < n) orders.push(s.slice()); }); }
  let pool = makePool(rng);
  const take = () => { if (!pool.length) pool = makePool(rng); return pool.pop(); };
  const unique = fm.test === 'triangle' ? true : !!fm.unique;
  let codes, samples = fm.samples.map((s, i) => ({ code: LET(i), label: (s.label || '').trim() || `Sample ${LET(i)}` }));
  if (unique) codes = orders.map(o => o.map(() => take()));
  else { const sc = samples.map(() => take()); samples = samples.map((s, i) => ({ ...s, blind: sc[i] })); codes = orders.map(o => o.map(l => sc[l.charCodeAt(0) - 65])); }
  return { test: fm.test, title: (fm.title || '').trim(), samples, panellists: n, orders, codes, seed: +fm.seed || 1, uniqueCodes: unique, instruction: DEFAULT_INSTR[fm.test], created: new Date().toISOString() };
}
function oddIndex(order) { return order.findIndex((l, i) => order.filter(x => x === l).length === 1); }

/* =====================================================================
   tabs
   ===================================================================== */
const TABS = ['design', 'print', 'responses', 'analysis', 'help'];
let tab = 'design';
function showTab(k, noHash) {
  if (!TABS.includes(k)) k = 'design';
  tab = k;
  $$('#sd-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === k));
  TABS.forEach(t => { $('#p-' + t).hidden = t !== k; });
  if (!noHash) history.replaceState(null, '', '#' + k);
  if (k === 'design') renderDesign();
  if (k === 'print') renderPrint();
  if (k === 'responses') renderResponses();
  if (k === 'analysis') renderAnalysis();
}
$('#sd-tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });

/* =====================================================================
   DESIGN tab
   ===================================================================== */
function renderForm() {
  $$('#d-test button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === form.test));
  if (document.activeElement !== $('#d-title')) $('#d-title').value = form.title;
  $('#d-n').value = form.n; $('#d-seed').value = form.seed;
  const two = form.test !== 'hedonic';
  if (two && form.samples.length !== 2) form.samples = [form.samples[0] || { code: 'A', label: '' }, form.samples[1] || { code: 'B', label: '' }];
  $('#d-samples').innerHTML = `<thead><tr><th>Code</th><th>Sample (known only to the panel leader)</th><th></th></tr></thead><tbody>${form.samples.map((s, i) => `<tr><td class="pid code-${LET(i)}">${LET(i)}</td><td><input type="text" class="txt" data-si="${i}" value="${esc(s.label)}" placeholder="${i === 0 ? 'e.g. Wheat bread (reference)' : 'e.g. Bread with 10 % cricket powder'}" aria-label="Sample ${LET(i)}"></td><td>${!two && form.samples.length > 2 ? `<button type="button" class="del" data-sdel="${i}" aria-label="Remove sample">✕</button>` : ''}</td></tr>`).join('')}</tbody>`;
  $('#d-add').hidden = two || form.samples.length >= 6;
  $('#d-unique').disabled = form.test === 'triangle';
  $('#d-unique').checked = form.test === 'triangle' ? true : form.unique;
  const k = form.test === 'triangle' ? 6 : form.test === 'preference' ? 2 : williams(form.samples.length).length;
  $('#d-n-help').textContent = `multiple of ${k} for perfect balance${form.test === 'triangle' ? '; ISO 4120: 24–30, not fewer than 18' : form.test === 'hedonic' ? '; 40+ consumers for firm conclusions' : ''}`;
}
$('#d-test').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; form.test = b.dataset.v; if (form.test === 'hedonic' && form.samples.length < 3) form.samples.push({ code: 'C', label: '' }); renderForm(); });
$('#d-title').addEventListener('input', e => { form.title = e.target.value; });
$('#d-n').addEventListener('change', e => { form.n = Math.max(2, Math.min(200, Math.round(+e.target.value || 2))); renderForm(); });
$('#d-seed').addEventListener('change', e => { form.seed = +e.target.value || 1; });
$('#d-unique').addEventListener('change', e => { form.unique = e.target.checked; });
$('#d-samples').addEventListener('input', e => { const i = e.target.dataset.si; if (i != null) form.samples[+i].label = e.target.value; });
$('#d-samples').addEventListener('click', e => { const b = e.target.closest('[data-sdel]'); if (!b) return; form.samples.splice(+b.dataset.sdel, 1); renderForm(); });
$('#d-add').addEventListener('click', () => { if (form.samples.length < 6) form.samples.push({ code: LET(form.samples.length), label: '' }); renderForm(); });
function doGenerate() {
  if (S && S.responses.length && !confirm('A new design replaces the current one and deletes its responses. Continue? (Download a backup first if you need it.)')) return;
  const d = generate(form);
  S = { version: 1, design: d, responses: [] };
  save('Design generated — check the balance and print the ballots');
  renderDesign();
}
$('#d-gen').addEventListener('click', doGenerate);
$('#d-reseed').addEventListener('click', () => { form.seed = Math.floor(Math.random() * 90000) + 10000; $('#d-seed').value = form.seed; doGenerate(); });

function tile(l, v, u, n, st) { return `<div class="readout ${st || ''}"><div class="ro-label">${l}</div><div class="ro-value">${v}<small>${u || ''}</small></div>${n ? `<div class="ro-note">${n}</div>` : ''}</div>`; }
function countTable(title, rowsL, colsL, get) {
  return `<div class="table-wrap" style="margin:10px 0"><table class="dt" style="font-size:.8rem"><caption style="caption-side:top;text-align:left;padding:4px 8px;color:var(--muted)">${title}</caption><thead><tr><th></th>${colsL.map(c => `<th style="text-align:center">${c}</th>`).join('')}</tr></thead><tbody>${rowsL.map((r, i) => `<tr><td class="pid">${r}</td>${colsL.map((c, j) => { const v = get(i, j); return `<td class="ro" style="text-align:center">${v === null ? '—' : v}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function renderDesign() {
  renderForm();
  if (!S) { $('#d-tiles').innerHTML = ''; $('#d-balance').innerHTML = '<p class="sub">Generate a design to see the balance checks.</p>'; $('#d-plan').innerHTML = '<tbody><tr><td class="ro">No design yet.</td></tr></tbody>'; return; }
  const d = S.design, n = d.panellists, t = d.samples.length;
  const seqKey = o => o.join('');
  const nSeq = d.test === 'triangle' ? 6 : d.test === 'preference' ? 2 : williams(t).length;
  const used = new Set(d.orders.map(seqKey)).size;
  $('#d-tiles').innerHTML = tile('Panellists', n, '', `${Math.floor(n / nSeq)} complete set${Math.floor(n / nSeq) === 1 ? '' : 's'} of ${nSeq} sequences${n % nSeq ? ` + ${n % nSeq}` : ''}`, n % nSeq ? 'warn' : 'ok') + tile('Sequences used', used, `of ${nSeq}`, d.test === 'hedonic' ? 'Williams design' : d.test === 'triangle' ? 'ISO 4120 arrangements' : 'AB / BA') + tile('Codes', d.uniqueCodes ? 'per panellist' : 'per sample', '', `seed ${d.seed}`);
  let html = '';
  if (d.test === 'triangle') {
    const cnt = TRI.map(a => d.orders.filter(o => seqKey(o) === a).length);
    html += countTable('How often each arrangement is served', ['count'], TRI, (i, j) => cnt[j]);
    const oddA = d.orders.filter(o => o[oddIndex(o)] === 'A').length;
    html += `<p class="sub">The odd sample is A in ${oddA} trays and B in ${n - oddA}; it is in position 1, 2 and 3 in ${[0, 1, 2].map(p => d.orders.filter(o => oddIndex(o) === p).length).join(', ')} trays.</p>`;
  } else {
    const L = d.samples.map(s => s.code);
    const pos = L.map(() => Array(t).fill(0)), carry = L.map(() => Array(t).fill(0));
    d.orders.forEach(o => o.forEach((l, j) => { pos[L.indexOf(l)][j]++; if (j) carry[L.indexOf(o[j - 1])][L.indexOf(l)]++; }));
    html += countTable('Position balance: how often each sample is served in each position', L, L.map((_, j) => 'pos ' + (j + 1)), (i, j) => pos[i][j]);
    if (d.test === 'hedonic') html += countTable('Carry-over balance: how often the row sample is served immediately before the column sample', L.map(l => l + ' before'), L, (i, j) => (i === j ? null : carry[i][j]));
  }
  $('#d-balance').innerHTML = html;
  // plan
  const P = d.orders[0].length;
  $('#d-plan').innerHTML = `<thead><tr><th>Panellist</th><th>Order</th>${Array.from({ length: P }, (_, j) => `<th>Position ${j + 1}<small>code · sample</small></th>`).join('')}${d.test === 'triangle' ? '<th>Answer key<small>odd sample</small></th>' : ''}</tr></thead><tbody>${d.orders.map((o, p) => `<tr><td class="pid">${p + 1}</td><td class="ro">${o.join('')}</td>${o.map((l, j) => `<td class="ro"><span class="code">${d.codes[p][j]}</span> · <b class="code-${l}">${l}</b></td>`).join('')}${d.test === 'triangle' ? `<td class="ro"><b>${d.codes[p][oddIndex(o)]}</b> (${o[oddIndex(o)]}, pos ${oddIndex(o) + 1})</td>` : ''}</tr>`).join('')}</tbody>`;
}
$('#d-plan-csv').addEventListener('click', () => {
  if (!S) return toast('Generate a design first');
  const d = S.design, P = d.orders[0].length;
  const head = ['panellist', 'order', ...Array.from({ length: P }, (_, j) => `code_${j + 1}`), ...Array.from({ length: P }, (_, j) => `sample_${j + 1}`), ...(d.test === 'triangle' ? ['odd_code'] : [])];
  const rows = d.orders.map((o, p) => [p + 1, o.join(''), ...d.codes[p], ...o.map(l => `${l}: ${d.samples[l.charCodeAt(0) - 65].label}`), ...(d.test === 'triangle' ? [d.codes[p][oddIndex(o)]] : [])]);
  download(`serving-plan_${d.test}_${d.seed}.csv`, [head.join(','), ...rows.map(r => r.map(v => /[,"]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(','))].join('\n') + '\n', 'text/csv');
});

/* =====================================================================
   PRINT tab: serving sheet, cup labels, ballots
   ===================================================================== */
function ballotHTML(d, p) {
  const o = d.orders[p], c = d.codes[p], instr = esc(d.instruction || DEFAULT_INSTR[d.test]);
  let body = '';
  if (d.test === 'hedonic') body = c.map(code => `<div style="margin-top:8px"><span class="b-code">${code}</span><div class="b-scale">${HED.map((h, i) => `<span><i></i>${i + 1}<br>${h}</span>`).join('')}</div></div>`).join('');
  else body = `<div class="b-row" style="justify-content:space-around;margin:14px 0">${c.map(code => `<span style="display:inline-flex;flex-direction:column;align-items:center;gap:6px"><span class="b-code" style="border:1.5px solid #333;border-radius:50%;padding:12px 10px">${code}</span></span>`).join('')}</div>`;
  return `<div class="ballot"><div class="b-meta"><span>Panellist ${p + 1}</span><span>Date ________</span></div><h4>Tasting session</h4><p style="margin:.3em 0;font-size:.82rem">${instr}</p>${body}<div class="b-note">Codes in serving order, left to right. Please do not talk about the samples until everyone has finished.</div></div>`;
}
function renderPrint() {
  if (!S) { $('#pr-table').innerHTML = '<tbody><tr><td class="ro">Generate a design first.</td></tr></tbody>'; $('#pr-preview').innerHTML = ''; $('#pr-instr').value = ''; return; }
  const d = S.design, P = d.orders[0].length;
  if (document.activeElement !== $('#pr-instr')) $('#pr-instr').value = d.instruction || DEFAULT_INSTR[d.test];
  $('#pr-table').innerHTML = `<thead><tr><th>Tray (panellist)</th>${Array.from({ length: P }, (_, j) => `<th>Cup ${j + 1}</th>`).join('')}</tr></thead><tbody>${d.orders.map((o, p) => `<tr><td class="pid">${p + 1}</td>${o.map((l, j) => `<td class="ro"><span class="code" style="font-weight:700">${d.codes[p][j]}</span> ← <b class="code-${l}">${l}</b> ${esc(d.samples[l.charCodeAt(0) - 65].label)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  $('#pr-preview').innerHTML = d.orders.slice(0, 3).map((_, p) => ballotHTML(d, p)).join('');
  $('#pr-info').textContent = `${d.panellists} ballots; the preview shows the first three.`;
}
$('#pr-instr').addEventListener('change', e => { if (!S) return; S.design.instruction = e.target.value.trim() || DEFAULT_INSTR[S.design.test]; save(); renderPrint(); });
function printDoc(title, inner, css = '') {
  const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to print'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="stylesheet" href="/assets/css/main.css"><link rel="stylesheet" href="/project/project.css"><style>body{background:#fff;color:#111;padding:14px;font-size:12px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 6px;text-align:left}.code-A,.code-B,.code-C,.code-D,.code-E,.code-F{color:#111}${css}</style></head><body>${inner}</body></html>`);
  w.document.close(); setTimeout(() => w.print(), 400);
}
$('#pr-sheet').addEventListener('click', () => { if (!S) return; const d = S.design; printDoc('Serving sheet', `<h2 style="margin:0 0 6px">Serving sheet — ${esc(d.title || d.test)}</h2><p>Test: ${d.test} · panellists: ${d.panellists} · seed ${d.seed} · ${new Date().toLocaleDateString('en-GB')} — keep in the preparation room.</p>` + $('#pr-table').outerHTML); });
$('#pr-labels').addEventListener('click', () => {
  if (!S) return; const d = S.design;
  const labels = d.orders.flatMap((o, p) => o.map((l, j) => `<div style="border:1px dashed #999;padding:10px 4px;text-align:center"><div style="font:700 22px 'JetBrains Mono',monospace;letter-spacing:.08em">${d.codes[p][j]}</div><div style="font-size:9px;color:#666">tray ${p + 1}</div></div>`)).join('');
  printDoc('Cup labels', `<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px">${labels}</div>`);
});
$('#pr-ballots').addEventListener('click', () => { if (!S) return; const d = S.design; printDoc('Ballots', `<div style="display:grid;grid-template-columns:${d.test === 'hedonic' ? '1fr' : '1fr 1fr'};gap:10px">${d.orders.map((_, p) => ballotHTML(d, p)).join('')}</div>`, '.ballot{break-inside:avoid;page-break-inside:avoid;margin-bottom:6px}'); });

/* =====================================================================
   RESPONSES tab
   ===================================================================== */
function resp(p) { return S.responses.filter(r => r.panellist === p); }
function renderResponses() {
  if (!S) { $('#r-table').innerHTML = '<tbody><tr><td class="ro">Generate a design first.</td></tr></tbody>'; $('#r-info').textContent = ''; return; }
  const d = S.design;
  let html = '';
  if (d.test === 'triangle') {
    $('#r-sub').textContent = 'For each panellist, choose the code circled on the ballot. “Correct” is filled in from the answer key.';
    html = `<thead><tr><th>Panellist</th><th>Codes in order</th><th>Circled code</th><th>Correct?</th></tr></thead><tbody>${d.orders.map((o, p) => { const r = resp(p + 1)[0]; const odd = d.codes[p][oddIndex(o)]; return `<tr><td class="pid">${p + 1}</td><td class="ro">${d.codes[p].join(' · ')}</td><td><select data-p="${p + 1}" aria-label="Circled code of panellist ${p + 1}"><option value=""></option>${d.codes[p].map(c => `<option${r && r.chosen === c ? ' selected' : ''}>${c}</option>`).join('')}</select></td><td class="ro" title="answer key: ${odd}">${r ? (r.correct ? '<span class="pill ok">correct</span>' : '<span class="pill">wrong</span>') : ''}</td></tr>`; }).join('')}</tbody>`;
  } else if (d.test === 'hedonic') {
    $('#r-sub').textContent = 'Type each panellist\'s ratings (1 = dislike extremely … 9 = like extremely) under the sample; the small code shows which code that panellist had for the sample.';
    html = `<thead><tr><th>Panellist</th>${d.samples.map(s => `<th><span class="code-${s.code}">${s.code}</span><small>${esc(s.label)}</small></th>`).join('')}</tr></thead><tbody>${d.orders.map((o, p) => `<tr><td class="pid">${p + 1}</td>${d.samples.map(s => { const r = resp(p + 1).find(x => x.sample === s.code); const j = o.indexOf(s.code); return `<td><input type="text" inputmode="numeric" data-p="${p + 1}" data-s="${s.code}" value="${r ? r.score : ''}" title="code ${d.codes[p][j]}, position ${j + 1}" aria-label="Panellist ${p + 1} sample ${s.code}" style="max-width:90px"><div class="pj-small pj-muted" style="padding:0 7px 3px;font-size:.66rem">code ${d.codes[p][j]}</div></td>`; }).join('')}</tr>`).join('')}</tbody>`;
  } else {
    $('#r-sub').textContent = 'For each panellist, choose the code circled on the ballot (the preferred sample).';
    html = `<thead><tr><th>Panellist</th><th>Codes in order</th><th>Preferred code</th><th>Preferred sample</th></tr></thead><tbody>${d.orders.map((o, p) => { const r = resp(p + 1)[0]; return `<tr><td class="pid">${p + 1}</td><td class="ro">${d.codes[p].join(' · ')}</td><td><select data-p="${p + 1}" aria-label="Preferred code of panellist ${p + 1}"><option value=""></option>${d.codes[p].map((c, j) => `<option value="${c}"${r && o[j] === r.sample ? ' selected' : ''}>${c}</option>`).join('')}</select></td><td class="ro">${r ? `<b class="code-${r.sample}">${r.sample}</b> ${esc(d.samples[r.sample.charCodeAt(0) - 65].label)}` : ''}</td></tr>`; }).join('')}</tbody>`;
  }
  $('#r-table').innerHTML = html;
  $('#r-info').textContent = `${answeredPanellists()} of ${d.panellists} panellists have answers.`;
}
$('#r-table').addEventListener('change', e => {
  if (!S) return; const d = S.design, el = e.target, p = +el.dataset.p; if (!p) return;
  const o = d.orders[p - 1], c = d.codes[p - 1];
  if (d.test === 'triangle') {
    S.responses = S.responses.filter(r => r.panellist !== p);
    if (el.value) S.responses.push({ panellist: p, correct: el.value === c[oddIndex(o)], chosen: el.value });
  } else if (d.test === 'preference') {
    S.responses = S.responses.filter(r => r.panellist !== p);
    if (el.value) S.responses.push({ panellist: p, sample: o[c.indexOf(el.value)], score: 1 });
  } else {
    const s = el.dataset.s, v = el.value.trim();
    S.responses = S.responses.filter(r => !(r.panellist === p && r.sample === s));
    if (v !== '') {
      const n = Number(v.replace(',', '.'));
      if (!Number.isInteger(n) || n < 1 || n > 9) { el.parentElement.classList.add('bad'); toast('Enter a whole number from 1 to 9'); return; }
      el.parentElement.classList.remove('bad');
      S.responses.push({ panellist: p, sample: s, score: n });
    } else el.parentElement.classList.remove('bad');
  }
  S.responses.sort((a, b) => a.panellist - b.panellist || String(a.sample || '').localeCompare(String(b.sample || '')));
  save(); if (d.test !== 'hedonic') renderResponses(); else $('#r-info').textContent = `${answeredPanellists()} of ${d.panellists} panellists have answers.`;
});
$('#r-table').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.dataset.s) return;
  e.preventDefault(); const ins = $$('#r-table input'); const i = ins.indexOf(e.target); if (ins[i + 1]) ins[i + 1].focus();
});
function simulate(d, rng) {
  const out = [];
  if (d.test === 'triangle') d.orders.forEach((o, p) => { const disc = rng() < 0.35; const oi = oddIndex(o); const pick = disc ? oi : Math.floor(rng() * 3); out.push({ panellist: p + 1, correct: pick === oi, chosen: d.codes[p][pick] }); });
  else if (d.test === 'preference') d.orders.forEach((o, p) => out.push({ panellist: p + 1, sample: rng() < 0.62 ? 'A' : 'B', score: 1 }));
  else {
    const eff = d.samples.map((_, i) => 0.9 - 0.55 * i);
    d.orders.forEach((o, p) => { const u = 0.9 * randn(rng); d.samples.forEach((s, i) => out.push({ panellist: p + 1, sample: s.code, score: Math.max(1, Math.min(9, Math.round(6.2 + eff[i] + u + 1.1 * randn(rng)))) })); });
  }
  return out;
}
$('#r-sim').addEventListener('click', () => {
  if (!S) return toast('Generate a design first');
  if (S.responses.length && !confirm('Replace the existing responses with simulated ones?')) return;
  S.responses = simulate(S.design, mulberry32((S.design.seed || 1) + 17)); S.design.simulated = true;
  save('Simulated responses added — for practice only'); renderResponses();
});
$('#r-clear').addEventListener('click', () => { if (!S || !S.responses.length) return; if (!confirm('Delete all responses of this study?')) return; S.responses = []; S.design.simulated = false; save('Responses cleared'); renderResponses(); });

/* =====================================================================
   ANALYSIS
   ===================================================================== */
/** Triangle psychometric function (Thurstonian model), Simpson integration. */
function ftri(dp) {
  const N = 400, h = 8 / N, a = Math.sqrt(3), b = dp * Math.sqrt(2 / 3); let s = 0;
  for (let i = 0; i <= N; i++) { const z = i * h; const g = (normCdf(-z * a + b) + normCdf(-z * a - b)) * normPdf(z); s += (i === 0 || i === N ? 1 : i % 2 ? 4 : 2) * g; }
  return 2 * s * h / 3;
}
function dprimeTri(pc) { if (!(pc > 1 / 3)) return 0; if (pc >= 0.999) return Infinity; let lo = 0, hi = 12; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (ftri(m) < pc) lo = m; else hi = m; } return (lo + hi) / 2; }
function wilson(k, n, z = 1.96) { const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; }
let aPlot = null;
function catLabels(P, cats) { P.custom('cats', (ctx, plot, pal) => { const R = plot.plotRect, w = R.width / Math.max(1, cats.length) - 16; ctx.fillStyle = pal.ink2 || pal.ink; ctx.font = '600 11.5px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; cats.forEach((t, i) => { let s = t; while (s.length > 4 && ctx.measureText(s).width > w) s = s.slice(0, -2); if (s !== t) s = s.replace(/\s+$/, '') + '…'; ctx.fillText(s, plot.px(i), R.top + R.height + 6); }); }, { noClip: true }); }
let reportText = '';
function renderAnalysis() {
  if (aPlot) { aPlot.destroy(); aPlot = null; }
  const tiles = $('#a-tiles'), tables = $('#a-tables');
  if (!S) { $('#a-title').textContent = 'Analysis'; $('#a-sub').textContent = 'Generate a design and enter responses first.'; tiles.innerHTML = ''; tables.innerHTML = ''; $('#a-report').textContent = ''; $('#a-chart').innerHTML = ''; return; }
  const d = S.design, lab = c => d.samples[c.charCodeAt(0) - 65].label;
  if (d.test === 'triangle') {
    const R = S.responses.filter(r => typeof r.correct === 'boolean');
    const n = R.length, x = R.filter(r => r.correct).length;
    $('#a-title').textContent = 'Triangle test';
    $('#a-sub').textContent = `${lab('A')} vs ${lab('B')} · H₀: p_c = 1/3 (no perceptible difference), one-sided exact binomial test (Eq. 13.4.2).`;
    if (n < 2) { tiles.innerHTML = ''; tables.innerHTML = '<p class="sub">Enter at least two responses.</p>'; $('#a-report').textContent = ''; $('#a-chart').innerHTML = ''; return; }
    const p = binomUpper(x, n, 1 / 3), xc = binomCritical(n, 1 / 3, 0.05), pc = x / n;
    const pd = Math.max(0, (3 * pc - 1) / 2), sePd = 1.5 * Math.sqrt(pc * (1 - pc) / n);
    const dp = dprimeTri(pc), slope = dp > 0 && Number.isFinite(dp) ? (ftri(dp + 0.01) - ftri(Math.max(0, dp - 0.01))) / (dp >= 0.01 ? 0.02 : dp + 0.01) : NaN, seD = Number.isFinite(slope) && slope > 0 ? Math.sqrt(pc * (1 - pc) / n) / slope : NaN;
    const pw = binomUpper(xc, n, 0.3 + 0.7 / 3);
    tiles.innerHTML = tile('Correct answers', `${x} / ${n}`, '', `critical number ${xc} at α = 0.05`, x >= xc ? 'ok' : '') + tile('p (one-sided)', fp(p), '', p < 0.05 ? 'perceptible difference' : 'no difference shown', p < 0.05 ? 'ok' : 'warn') + tile('Discriminators p_d', f(pd, 2), '', `95 % CI ${f(Math.max(0, pd - 1.96 * sePd), 2)}–${f(Math.min(1, pd + 1.96 * sePd), 2)}`) + tile('Thurstonian d′', Number.isFinite(dp) ? f(dp, 2) : '> 4', '', Number.isFinite(seD) ? `SE ≈ ${f(seD, 2)}` : '') + tile('Power (p_d = 0.3)', f(pw, 2), '', `with ${n} panellists`);
    const byArr = TRI.map(a => { const idx = d.orders.map((o, i) => (o.join('') === a ? i + 1 : 0)).filter(Boolean); const rr = R.filter(r => idx.includes(r.panellist)); return [a, rr.length, rr.filter(r => r.correct).length]; });
    tables.innerHTML = `<div class="table-wrap"><table class="dt" style="font-size:.82rem"><thead><tr><th>Arrangement</th><th>Panellists</th><th>Correct</th></tr></thead><tbody>${byArr.map(r => `<tr><td class="pid">${r[0]}</td><td class="ro">${r[1]}</td><td class="ro">${r[2]}</td></tr>`).join('')}</tbody></table></div><p class="pj-small pj-muted">p_d = (3p_c − 1)/2 with a normal-approximation CI; d′ from the triangle psychometric function (Thurstonian model; Eq. 13.4.4). A non-significant result does not show that the samples are similar (<a href="/lessons/sensory-statistics/#similarity">Lesson 13.4</a>).</p>`;
    $('#a-chart-title').textContent = 'Number correct if everyone were guessing';
    aPlot = new Plot('#a-chart', { x: { label: 'Number of correct answers', min: -0.5, max: n + 0.5 }, y: { label: 'Probability under H₀', min: 0 }, legend: false, height: 290 });
    const ks = Array.from({ length: n + 1 }, (_, k) => k), pm = ks.map(k => binomPmf(k, n, 1 / 3));
    aPlot.custom('bars', (ctx, plot, pal) => { ks.forEach(k => { const x0 = plot.px(k - 0.4), x1 = plot.px(k + 0.4), y0 = plot.py(0), y1 = plot.py(pm[k]); ctx.fillStyle = k === x ? pal.accent : k >= xc ? pal.magenta : pal.muted; ctx.globalAlpha = k === x ? 1 : 0.55; ctx.fillRect(x0, y1, x1 - x0, y0 - y1); }); ctx.globalAlpha = 1; });
    aPlot.line('pmf', ks, pm, { color: 'muted', width: 0.01, noTip: false, label: 'P(X = k)' });
    aPlot.vline('xc', xc - 0.5, { color: 'magenta', label: `critical ${xc}`, dash: [4, 4] });
    $('#a-chart-note').textContent = `Bars: binomial distribution with n = ${n}, p = 1/3. Magenta: significant region (≥ ${xc}); green: your result (${x}).`;
    reportText = `In a triangle test, ${x} of ${n} panellists correctly identified the odd sample (p̂c = ${f(pc, 2)}; one-sided exact binomial test, p = ${fp(p)}). ${p < 0.05 ? 'The samples were perceptibly different: ' : 'A perceptible difference was not demonstrated; '}the estimated proportion of discriminators was ${f(pd, 2)} (95 % CI ${f(Math.max(0, pd - 1.96 * sePd), 2)}–${f(Math.min(1, pd + 1.96 * sePd), 2)}), corresponding to d′ = ${Number.isFinite(dp) ? f(dp, 2) : '> 4'}${Number.isFinite(seD) ? ` (SE ${f(seD, 2)})` : ''}.${p >= 0.05 ? ` With ${n} panellists the test had a power of about ${f(pw, 2)} to detect a proportion of discriminators of 0.3, so a moderate difference cannot be excluded.` : ''}`;
  } else if (d.test === 'preference') {
    const R = S.responses.filter(r => r.sample);
    const n = R.length, kA = R.filter(r => r.sample === 'A').length, kB = n - kA;
    $('#a-title').textContent = 'Paired preference';
    $('#a-sub').textContent = `${lab('A')} vs ${lab('B')} · H₀: p = 1/2, two-sided exact binomial test (Eq. 13.4.7).`;
    if (n < 2) { tiles.innerHTML = ''; tables.innerHTML = '<p class="sub">Enter at least two responses.</p>'; $('#a-report').textContent = ''; $('#a-chart').innerHTML = ''; return; }
    const p = Math.min(1, 2 * Math.min(binomCdf(kA, n, 0.5), binomUpper(kA, n, 0.5))), ci = wilson(kA, n);
    tiles.innerHTML = tile(`Prefer A (${esc(lab('A'))})`, kA, `of ${n}`, `${f(100 * kA / n, 0)} %`) + tile(`Prefer B (${esc(lab('B'))})`, kB, `of ${n}`, `${f(100 * kB / n, 0)} %`) + tile('p (two-sided)', fp(p), '', p < 0.05 ? 'a preference' : 'no preference shown', p < 0.05 ? 'ok' : 'warn') + tile('Share preferring A', f(kA / n, 2), '', `Wilson 95 % CI ${f(ci[0], 2)}–${f(ci[1], 2)}`);
    tables.innerHTML = `<div class="table-wrap"><table class="dt" style="font-size:.82rem"><thead><tr><th>Order served</th><th>Panellists</th><th>Preferred the first sample</th></tr></thead><tbody>${['AB', 'BA'].map(a => { const idx = d.orders.map((o, i) => (o.join('') === a ? i + 1 : 0)).filter(Boolean); const rr = R.filter(r => idx.includes(r.panellist)); return `<tr><td class="pid">${a}</td><td class="ro">${rr.length}</td><td class="ro">${rr.filter(r => r.sample === a[0]).length}</td></tr>`; }).join('')}</tbody></table></div><p class="pj-small pj-muted">A strong tendency to prefer the first (or second) sample served is a position bias; balanced orders spread it evenly over the samples.</p>`;
    $('#a-chart-title').textContent = 'Preferences';
    aPlot = new Plot('#a-chart', { x: { label: 'Sample', min: -0.5, max: 1.5, format: () => '' }, y: { label: 'Panellists', min: 0 }, legend: false, height: 290 });
    aPlot.custom('bars', (ctx, plot, pal) => { [kA, kB].forEach((k, i) => { const x0 = plot.px(i - 0.3), x1 = plot.px(i + 0.3), y0 = plot.py(0), y1 = plot.py(k); ctx.fillStyle = i ? pal.magenta : pal.water; ctx.fillRect(x0, y1, x1 - x0, y0 - y1); }); });
    aPlot.hline('half', n / 2, { color: 'muted', label: 'no preference (n/2)', dash: [4, 4], includeInDomain: true });
    aPlot.scatter('k', [0, 1], [kA, kB], { color: 'ink', r: 0.1 });
    catLabels(aPlot, ['A · ' + lab('A'), 'B · ' + lab('B')]);
    $('#a-chart-note').textContent = '';
    reportText = `In a paired preference test, ${kA} of ${n} panellists (${f(100 * kA / n, 0)} %, 95 % CI ${f(100 * ci[0], 0)}–${f(100 * ci[1], 0)} %) preferred ${lab('A')} over ${lab('B')} (two-sided exact binomial test, p = ${fp(p)}).`;
  } else {
    const L = d.samples.map(s => s.code), labels = d.samples.map(s => `${s.code} · ${s.label}`);
    const byP = new Map(); S.responses.forEach(r => { if (!byP.has(r.panellist)) byP.set(r.panellist, {}); byP.get(r.panellist)[r.sample] = r.score; });
    const complete = [...byP.entries()].filter(([, v]) => L.every(l => Number.isFinite(v[l]))).sort((a, b) => a[0] - b[0]);
    const M = complete.map(([, v]) => L.map(l => v[l]));
    $('#a-title').textContent = 'Hedonic rating (9-point scale)';
    $('#a-sub').textContent = `${L.length} samples · randomised-block ANOVA with panellists as blocks, then Tukey's HSD (Eqs. 13.4.8–13.4.10). ${byP.size - complete.length ? `${byP.size - complete.length} panellist(s) with missing ratings left out.` : ''}`;
    if (M.length < 2) { tiles.innerHTML = ''; tables.innerHTML = '<p class="sub">Enter complete ratings of at least two panellists.</p>'; $('#a-report').textContent = ''; $('#a-chart').innerHTML = ''; return; }
    const A = anovaRCBD(M), TK = tukeyRCBD(M, L), eta = A.treatment.ss / (A.treatment.ss + A.error.ss);
    const n = M.length, tc = tInv(0.975, n - 1);
    const stats = L.map((l, j) => { const v = M.map(r => r[j]); const m = mean(v), s = sd(v); return { l, m, s, h: tc * s / Math.sqrt(n) }; });
    tiles.innerHTML = tile('Panellists', n, '', 'complete ratings') + stats.map(s => tile(`Mean ${s.l}`, f(s.m, 2), '', `SD ${f(s.s, 2)} · 95 % CI ± ${f(s.h, 2)}`)).join('') + tile('F (samples)', f(A.treatment.F, 2), '', `F(${A.treatment.df}, ${A.error.df}), p = ${fp(A.treatment.p)}`, A.treatment.p < 0.05 ? 'ok' : 'warn') + tile('Partial η²', f(eta, 2), '', `panellists: F = ${f(A.block.F, 2)}, p = ${fp(A.block.p)}`);
    const pos = Array.from({ length: L.length }, (_, j) => { const v = []; complete.forEach(([pp, vals]) => { const o = d.orders[pp - 1]; v.push(vals[o[j]]); }); return v.length ? mean(v) : NaN; });
    tables.innerHTML = `<div class="table-wrap"><table class="dt" style="font-size:.82rem"><thead><tr><th>Source</th><th>SS</th><th>df</th><th>MS</th><th>F</th><th>p</th></tr></thead><tbody><tr><td class="pid">Samples</td><td class="ro">${f(A.treatment.ss, 2)}</td><td class="ro">${A.treatment.df}</td><td class="ro">${f(A.treatment.ms, 3)}</td><td class="ro">${f(A.treatment.F, 2)}</td><td class="ro">${fp(A.treatment.p)}</td></tr><tr><td class="pid">Panellists</td><td class="ro">${f(A.block.ss, 2)}</td><td class="ro">${A.block.df}</td><td class="ro">${f(A.block.ms, 3)}</td><td class="ro">${f(A.block.F, 2)}</td><td class="ro">${fp(A.block.p)}</td></tr><tr><td class="pid">Error</td><td class="ro">${f(A.error.ss, 2)}</td><td class="ro">${A.error.df}</td><td class="ro">${f(A.error.ms, 3)}</td><td></td><td></td></tr></tbody></table></div>
      <div class="table-wrap"><table class="dt" style="font-size:.82rem"><caption style="caption-side:top;text-align:left;padding:4px 8px;color:var(--muted)">Tukey HSD after the block ANOVA (q<sub>0.95</sub> = ${f(TK.qCrit, 2)}, HSD = ${f(TK.qCrit * Math.sqrt(A.error.ms / n), 2)} points)</caption><thead><tr><th>Comparison</th><th>Difference</th><th>95 % simultaneous CI</th><th>p</th></tr></thead><tbody>${TK.pairs.map(pr => `<tr><td class="pid">${pr.b} − ${pr.a}</td><td class="ro">${f(pr.diff, 2)}</td><td class="ro">${f(pr.lwr, 2)} to ${f(pr.upr, 2)}</td><td class="ro">${fp(pr.p)}</td></tr>`).join('')}</tbody></table></div>
      <p class="pj-small pj-muted">Mean rating by serving position: ${pos.map((m, j) => `pos ${j + 1}: ${f(m, 2)}`).join(' · ')} — a large difference between positions is a position effect, spread over the samples by the Williams design.</p>`;
    $('#a-chart-title').textContent = 'Ratings by sample';
    aPlot = new Plot('#a-chart', { x: { label: 'Sample', min: -0.5, max: L.length - 0.5, format: () => '' }, y: { label: 'Liking (1–9)', min: 1, max: 9 }, legend: false, height: 290 });
    M.forEach((row, i) => aPlot.line('p' + i, L.map((_, j) => j), row.map((v, j) => v + ((i % 7) - 3) * 0.035), { color: 'muted', width: 1, opacity: 0.3, noTip: true }));
    aPlot.scatter('m', L.map((_, j) => j), stats.map(s => s.m), { color: 'magenta', r: 6, shape: 'diamond', yErr: stats.map(s => s.h), label: 'mean ± 95 % CI' });
    catLabels(aPlot, L.map(l => `${l} · ${lab(l)}`));
    $('#a-chart-note').textContent = 'Grey lines: individual panellists (slightly jittered). Diamonds: means with 95 % confidence intervals.';
    const sig = TK.pairs.filter(pr => pr.p < 0.05);
    reportText = `${n} panellists rated ${L.length} samples on the 9-point hedonic scale in a Williams design balanced for serving order and first-order carry-over. A randomised-block ANOVA with panellists as blocks ${A.treatment.p < 0.05 ? 'showed a difference between the samples' : 'did not show a difference between the samples'} (F(${A.treatment.df}, ${A.error.df}) = ${f(A.treatment.F, 2)}, p = ${fp(A.treatment.p)}, partial η² = ${f(eta, 2)}). Means: ${stats.map(s => `${lab(s.l)} ${f(s.m, 2)}`).join(', ')}. ${sig.length ? 'Tukey\'s HSD: ' + sig.map(pr => `${lab(pr.b)} − ${lab(pr.a)} = ${f(pr.diff, 2)} points (95 % CI ${f(pr.lwr, 2)} to ${f(pr.upr, 2)}, p = ${fp(pr.p)})`).join('; ') + '.' : 'No pair differed significantly in Tukey\'s HSD.'}`;
  }
  $('#a-report').textContent = reportText;
}
$('#a-copy').addEventListener('click', () => { if (!reportText) return; if (navigator.clipboard) navigator.clipboard.writeText(reportText).then(() => toast('Report sentence copied')); });

/* =====================================================================
   toolbar
   ===================================================================== */
function loadExample(kind) {
  if (S && S.responses.length && !S.design.illustrative && !confirm('Replace your current study with a simulated example? Download a backup first if you need it.')) return;
  if (kind === 'triangle') {
    const d = generate({ test: 'triangle', title: 'Wheat bread vs bread with 10 % cricket powder (ILLUSTRATIVE)', n: 24, seed: 4120, samples: [{ label: 'Wheat bread (reference)' }, { label: 'Bread with 10 % cricket powder' }], unique: true });
    const rng = mulberry32(13); const correct = new Set(shuffle(Array.from({ length: 24 }, (_, i) => i + 1), rng).slice(0, 13));
    const responses = d.orders.map((o, p) => { const oi = oddIndex(o); const ok = correct.has(p + 1); const pick = ok ? oi : [0, 1, 2].filter(k => k !== oi)[Math.floor(rng() * 2)]; return { panellist: p + 1, correct: ok, chosen: d.codes[p][pick] }; });
    S = { version: 1, design: Object.assign(d, { illustrative: true, simulated: true }), responses };
  } else {
    const d = generate({ test: 'hedonic', title: 'Breads with 0, 5 and 10 % cricket powder (ILLUSTRATIVE)', n: 24, seed: 1949, samples: [{ label: 'Wheat bread (0 %)' }, { label: 'Bread with 5 % cricket powder' }, { label: 'Bread with 10 % cricket powder' }], unique: false });
    const rng = mulberry32(38); const eff = [0.85, 0.55, -0.25];
    const responses = [];
    d.orders.forEach((o, p) => { const u = 0.9 * randn(rng); d.samples.forEach((s, i) => responses.push({ panellist: p + 1, sample: s.code, score: Math.max(1, Math.min(9, Math.round(6.1 + eff[i] + u + 1.05 * randn(rng)))) })); });
    S = { version: 1, design: Object.assign(d, { illustrative: true, simulated: true }), responses };
  }
  Object.assign(form, { test: S.design.test, title: S.design.title, n: S.design.panellists, seed: S.design.seed, samples: S.design.samples.map(s => ({ code: s.code, label: s.label })), unique: S.design.uniqueCodes });
  save('Example loaded (simulated responses)');
  showTab(tab, true);
}
$('#sd-ex-tri').addEventListener('click', () => loadExample('triangle'));
$('#sd-ex-hed').addEventListener('click', () => loadExample('hedonic'));
$('#sd-new').addEventListener('click', () => {
  if (!confirm('Start a new study? The current design and responses in this browser will be deleted. (Download a backup first if you need it.)')) return;
  S = null; try { localStorage.removeItem(KEY); } catch (e) { }
  Object.assign(form, { test: 'triangle', title: '', n: 24, seed: 2026, samples: [{ code: 'A', label: '' }, { code: 'B', label: '' }], unique: true });
  status(); showTab('design');
});
$('#sd-json').addEventListener('click', () => { if (!S) return toast('Nothing to back up yet'); download(`sensory-study_${S.design.test}_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(S, null, 1), 'application/json'); });
$('#sd-csv').addEventListener('click', () => {
  if (!S || !S.responses.length) return toast('No responses yet');
  const d = S.design, rows = [];
  if (d.test === 'hedonic') S.responses.forEach(r => { const o = d.orders[r.panellist - 1], j = o.indexOf(r.sample); rows.push([r.panellist, j + 1, d.codes[r.panellist - 1][j], r.sample, d.samples[r.sample.charCodeAt(0) - 65].label, r.score]); });
  else if (d.test === 'triangle') S.responses.forEach(r => { const o = d.orders[r.panellist - 1]; rows.push([r.panellist, o.join(''), r.chosen || '', d.codes[r.panellist - 1][oddIndex(o)], r.correct ? 1 : 0]); });
  else S.responses.forEach(r => rows.push([r.panellist, d.orders[r.panellist - 1].join(''), r.sample, d.samples[r.sample.charCodeAt(0) - 65].label]));
  const head = d.test === 'hedonic' ? ['panellist', 'position', 'code', 'sample', 'label', 'score'] : d.test === 'triangle' ? ['panellist', 'arrangement', 'chosen_code', 'odd_code', 'correct'] : ['panellist', 'order', 'preferred_sample', 'label'];
  download(`sensory-responses_${d.test}_${new Date().toISOString().slice(0, 10)}.csv`, [head.join(','), ...rows.map(r => r.map(v => /[,"]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(','))].join('\n') + '\n', 'text/csv');
});
$('#sd-file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    let o = JSON.parse(await file.text());
    if (!o.design && o['ffp-sensory-v1']) o = o['ffp-sensory-v1'];
    if (!o.design || !Array.isArray(o.design.orders)) throw new Error('no design');
    if (S && !confirm('Replace the current study with the imported one?')) return;
    S = { version: 1, design: o.design, responses: Array.isArray(o.responses) ? o.responses : [] };
    if (!S.design.codes) S.design.codes = S.design.orders.map(or => or.map(() => ''));
    Object.assign(form, { test: S.design.test, title: S.design.title || '', n: S.design.panellists, seed: S.design.seed ?? 2026, samples: S.design.samples.map(s => ({ code: s.code, label: s.label })), unique: S.design.uniqueCodes !== false });
    save('Study imported'); showTab(tab, true);
  } catch (err) { toast('This file does not contain a sensory study (ffp-sensory-v1)'); }
});

/* boot */
status();
showTab((location.hash || '#design').slice(1), true);
document.addEventListener('ffp:theme', () => { if (tab === 'analysis') renderAnalysis(); });
