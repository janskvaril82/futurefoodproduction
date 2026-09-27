/* Crop growth model — daily light-use-efficiency model of lettuce with a top-down 2D tray,
   scenario comparison and calibration of RUE against your own data (least squares, stats.fitLM).
   Model: ./model.js (Derive tab, Eqs. G1–G8). Tray renderer: ./tray.js. */
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, downloadCSV } from '/assets/js/plot.js';
import { parseTable, fitLM, mean, sd } from '/assets/js/stats.js';
import * as CM from './model.js';
import { drawTray } from './tray.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ================================================================ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'fw', label: 'Head fresh weight', unit: 'g plant⁻¹', digits: 0 })
  .add({ id: 'dw', label: 'Dry weight (shoot + root)', unit: 'g plant⁻¹', digits: 2 })
  .add({ id: 'lai', label: 'Leaf area index', unit: 'm² m⁻²', digits: 2 })
  .add({ id: 'f', label: 'Light interception f', unit: '%', digits: 0 })
  .add({ id: 'rgr', label: 'Relative growth rate', unit: 'd⁻¹', digits: 3 })
  .add({ id: 'rue', label: 'Radiation-use efficiency', unit: 'g mol⁻¹', digits: 2 })
  .add({ id: 't150', label: 'Days to a 150 g head', unit: 'd', digits: 1 })
  .add({ id: 'yield', label: 'Yield per cycle', unit: 'kg FW m⁻²', digits: 2 })
  .add({ id: 'lue', label: 'Fresh weight per mole of light', unit: 'g mol⁻¹', digits: 1 });

ui.section('Light');
ui.slider({ id: 'dli', label: 'Daily light integral (DLI)', min: 4, max: 40, step: 0.1, value: 17, unit: 'mol m⁻² d⁻¹', help: 'Lettuce: 12–17 is typical; above ≈ 17 tipburn becomes likely without vertical air flow' });
ui.slider({ id: 'hp', label: 'Photoperiod', min: 8, max: 24, step: 0.5, value: 16, unit: 'h d⁻¹', help: 'The same DLI spread over more hours means a lower PPFD, which leaves use more efficiently' });
ui.section('Climate');
ui.slider({ id: 'Td', label: 'Day temperature', min: 8, max: 34, step: 0.5, value: 24, unit: '°C' });
ui.slider({ id: 'Tn', label: 'Night temperature', min: 6, max: 30, step: 0.5, value: 18.5, unit: '°C' });
ui.slider({ id: 'co2', label: 'CO₂ during the photoperiod', min: 300, max: 1500, step: 10, value: 700, unit: 'ppm' });
ui.section('Crop');
ui.slider({ id: 'dens', label: 'Plant density', min: 8, max: 120, step: 1, value: 97, unit: 'plants m⁻²', help: 'Spacing = 1/√density: 97 m⁻² ≈ 10 cm, 38 m⁻² ≈ 16 cm, 25 m⁻² = 20 cm' });
ui.toggle({ id: 'respace', label: 'Re-space the plants during the cycle', value: true });
ui.slider({ id: 'respaceDay', label: 'Re-spacing day', min: 2, max: 40, step: 1, value: 10, unit: 'd' });
ui.slider({ id: 'dens2', label: 'Density after re-spacing', min: 4, max: 80, step: 1, value: 38, unit: 'plants m⁻²' });
ui.slider({ id: 'fw0', label: 'Fresh weight at transplanting', min: 0.2, max: 20, step: 0.1, value: 1, unit: 'g plant⁻¹' });
ui.slider({ id: 'days', label: 'Cycle length after transplanting', min: 8, max: 60, step: 1, value: 24, unit: 'd' });
ui.section('Model parameters');
ui.slider({ id: 'rue', label: 'RUE at the reference conditions', min: 0.2, max: 2, step: 0.01, value: +CM.RUE_REF_VH.toFixed(2), unit: 'g mol⁻¹', help: 'g dry matter per mol intercepted PAR at 250 µmol m⁻² s⁻¹, 400 ppm, 20 °C (Van Henten’s canopy: 0.90). Calibrate it against your data below.' });
ui.slider({ id: 'sla', label: 'Specific leaf area (SLA)', min: 15, max: 110, step: 0.5, value: 62.5, unit: 'm² kg⁻¹' });
ui.slider({ id: 'k', label: 'Extinction coefficient k', min: 0.4, max: 1.0, step: 0.01, value: 0.9 });
ui.slider({ id: 'dmc', label: 'Dry-matter content of the head', min: 2.5, max: 9, step: 0.1, value: 4.4, unit: '%' });
ui.toggle({ id: 'resp', label: 'Maintenance respiration (Q₁₀ = 2)', value: true });
ui.section('Display');
ui.toggle({ id: 'lightview', label: 'Show light reaching the raft (wasted)', value: false, persist: false });
ui.buttons([{ label: 'Store as scenario B', onClick: () => storeB(), variant: 'primary' }, { label: 'Clear B', onClick: () => { B = null; update(); } }]);
ui.presets([
  { label: 'Cornell NFT greenhouse (validated)', values: { dli: 17, hp: 16, Td: 24, Tn: 18.5, co2: 700, dens: 97, respace: true, respaceDay: 10, dens2: 38, fw0: 1, days: 24 } },
  { label: 'Plant factory (LED 250 µmol, 1000 ppm)', values: { dli: 14.4, hp: 16, Td: 22, Tn: 20, co2: 1000, dens: 30, respace: false, fw0: 3, days: 24 } },
  { label: 'Nordic winter greenhouse, top-lit', values: { dli: 10, hp: 18, Td: 17, Tn: 15, co2: 800, dens: 25, respace: false, fw0: 2, days: 35 } },
  { label: 'Low light, no CO₂ enrichment', values: { dli: 8, hp: 16, Td: 20, Tn: 18, co2: 400, dens: 25, respace: false, fw0: 2, days: 35 } },
  { label: 'Heat stress (30/26 °C)', values: { dli: 17, hp: 16, Td: 30, Tn: 26, co2: 700, dens: 97, respace: true, respaceDay: 10, dens2: 38, fw0: 1, days: 24 } },
  { label: 'Baby leaf, very dense', values: { dli: 14, hp: 16, Td: 21, Tn: 19, co2: 800, dens: 120, respace: false, fw0: 0.3, days: 16 } }
]);
ui.saveButton('crop-growth-model', () => ro.values());

const params = (p = ui.values()) => ({ dli: p.dli, hp: p.hp, Td: p.Td, Tn: p.Tn, co2: p.co2, dens: p.dens, respace: !!p.respace, respaceDay: p.respaceDay, dens2: p.dens2, fw0: p.fw0, days: p.days, rue: p.rue, sla: p.sla, k: p.k, dmc: p.dmc / 100, tau: CM.VH.tau, resp: !!p.resp });

/* ================================================================ stage: tray canvas + timeline */
const stageEl = $('#stage');
const canvas = $('#tray');
const hud = hudChips(stageEl);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = 'lettuce-tray.png'; a.click(); } });
const tl = $('#tl-day'), tlLab = $('#tl-label'), tlPlay = $('#tl-play');
let day = null;                           // null → show the end of the cycle
const clock = new SimClock({ speed: 2.5, onFrame: t => { const n = sim.day.length - 1; if (t >= n) { clock.pause(); t = n; } setDay(t, true); } });
clock.onState(r => { tlPlay.textContent = r ? '❚❚' : '▶'; tlPlay.setAttribute('aria-label', r ? 'Pause growth' : 'Play growth'); });
tlPlay.addEventListener('click', () => { const n = sim.day.length - 1; if (!clock.running && (day == null || day >= n - 1e-6)) { clock.reset(0); } else clock.reset(day ?? 0); clock.toggle(); });
tl.addEventListener('input', () => { clock.pause(); setDay(+tl.value); });

/* ================================================================ charts */
const cG = new Plot('#chart-growth', { x: { label: 'Days after transplanting', unit: 'd', min: 0 }, y: { label: 'Fresh weight', unit: 'g plant⁻¹', min: 0 }, y2: { label: 'Dry weight', unit: 'g plant⁻¹', min: 0 } });
const cL = new Plot('#chart-lai', { x: { label: 'Days after transplanting', unit: 'd', min: 0 }, y: { label: 'Leaf area index', unit: 'm² m⁻²', min: 0 }, y2: { label: 'Light interception f', unit: '–', min: 0, max: 1 } });
const cR = new Plot('#chart-rgr', { x: { label: 'Days after transplanting', unit: 'd', min: 0 }, y: { label: 'Relative growth rate', unit: 'd⁻¹', min: 0 } });
const cI = new Plot('#chart-light', { x: { label: 'Days after transplanting', unit: 'd', min: 0 }, y: { label: 'Intercepted PAR', unit: 'mol m⁻² d⁻¹', min: 0 }, y2: { label: 'Cumulative intercepted PAR', unit: 'mol m⁻²', min: 0 } });
const cM = new Plot('#chart-monteith', { x: { label: 'Cumulative intercepted PAR', unit: 'mol m⁻²', min: 0 }, y: { label: 'Crop dry weight', unit: 'g m⁻²', min: 0 } });

/* ================================================================ state */
let sim = null, B = null, DATA = null, FIT = null, lastP = null;
function storeB() { B = { p: params(), sim: CM.simulate(params()) }; window.FFP && FFP.toast && FFP.toast('Stored as scenario B — now change the settings'); update(); }

function update() {
  const p = ui.values(); lastP = p;
  ['respaceDay', 'dens2'].forEach(id => ui.enable(id, !!p.respace));
  sim = CM.simulate(params(p));
  const n = sim.day.length - 1;
  tl.max = n; if (day != null && day > n) day = n;
  drawCharts(p);
  setDay(day ?? n);
}
function setDay(d, fromClock) {
  const n = sim.day.length - 1; d = Math.max(0, Math.min(n, d)); day = d;
  if (!fromClock || Math.abs(+tl.value - d) > 0.05) tl.value = d;
  tlLab.textContent = `Day ${fmt(d, d % 1 ? 1 : 0)} of ${n}`;
  const p = lastP, S = sim.summary, di = Math.round(d);
  const fw = CM.at(sim, 'FW', d), W = CM.at(sim, 'W', d), lai = CM.at(sim, 'LAI', d), f = CM.at(sim, 'f', d), rgr = sim.rgr[Math.min(di, sim.rgr.length - 1)];
  ro.set('fw', fw, fw >= 150 ? 'ok' : fw >= 90 ? 'warn' : null, `day ${fmt(d, 0)} · harvest ${fmt(S.FW, 0)} g`);
  ro.set('dw', W, null, `shoot ${fmt(W * (1 - CM.VH.tau), 2)} g · DMC ${fmt(p.dmc, 1)} %`);
  ro.set('lai', lai, null, `leaf area ${fmt(CM.at(sim, 'LA', d) * 1e4, 0)} cm² per plant · ${fmt(CM.densityAt(params(p), d), 0)} plants m⁻²`);
  ro.set('f', f * 100, f > 0.9 ? 'ok' : f > 0.6 ? 'warn' : 'bad', f < 0.6 ? 'much light falls on the raft' : f < 0.9 ? 'canopy closing' : 'closed canopy');
  ro.set('rgr', rgr, null, `mean over the cycle ${fmt(S.meanRGR, 3)} d⁻¹ (doubling every ${fmt(Math.LN2 / Math.max(1e-6, rgr), 1)} d now)`);
  const m = CM.modifiers(S.I, p.co2, p.Td);
  ro.set('rue', S.rue, null, `PPFD ${fmt(S.I, 0)} µmol m⁻² s⁻¹ · f<sub>I</sub> ${fmt(m.fI, 2)} · f<sub>C</sub> ${fmt(m.fC, 2)} · f<sub>T</sub> ${fmt(m.fT, 2)}`);
  const t150 = CM.daysTo(sim, 150); ro.set('t150', t150 ?? NaN, t150 != null ? 'ok' : 'bad', t150 != null ? `${fmt(t150 + 0, 1)} days after transplanting` : 'not reached in this cycle');
  ro.set('yield', S.yield, null, `${fmt(S.yield * 365 / Math.max(1, p.days), 0)} kg m⁻² yr⁻¹ if cycles follow back to back`);
  ro.set('lue', S.gPerMol, null, 'g head fresh weight per mol PAR reaching the crop area');
  hud.set('d', `Day <b>${fmt(d, 0)}</b> · <b>${fmt(fw, 0)}</b> g FW per plant`);
  hud.set('f', `LAI <b>${fmt(lai, 2)}</b> · f <b>${fmt(f * 100, 0)}</b> %${B ? ` · B: <b>${fmt(CM.at(B.sim, 'FW', Math.min(d, B.sim.day.length - 1)), 0)}</b> g` : ''}`);
  // tray
  const panels = [{ label: B ? 'A (current)' : '', dens: CM.densityAt(params(p), d), cover: CM.at(sim, 'cover', d), fw }];
  if (B) { const dB = Math.min(d, B.sim.day.length - 1); panels.push({ label: 'B (stored)', color: '#f5c46b', dens: CM.densityAt(B.p, dB), cover: CM.at(B.sim, 'cover', dB), fw: CM.at(B.sim, 'FW', dB) }); }
  drawTray(canvas, panels, { light: !!ui.get('lightview') });
  // time markers
  [cG, cL, cR, cI].forEach(c => c.vline('now', d, { color: 'magenta', dash: [3, 3] }));
  cM.point('now', CM.at(sim, 'cumIpar', d), CM.at(sim, 'cropDW', d), { color: 'magenta', r: 5 });
}
function drawCharts(p) {
  const s = sim;
  cG.line('fw', s.day, s.FW, { color: 'accent', width: 2.8, label: 'Fresh weight (A)' });
  cG.line('dw', s.day, s.W, { color: 'c3', width: 1.8, dash: [6, 4], y2: true, label: 'Dry weight (A, right axis)' });
  cL.line('lai', s.day, s.LAI, { color: 'accent', width: 2.6, label: 'LAI (A)' });
  cL.line('f', s.day, s.f, { color: 'amber', width: 2.2, y2: true, label: 'f (A, right axis)' });
  cR.line('rgr', s.day, s.rgr, { color: 'accent', width: 2.6, label: 'RGR (A)', step: true });
  cR.hline('mean', s.summary.meanRGR, { color: 'muted', label: `mean ${fmt(s.summary.meanRGR, 3)} d⁻¹` });
  cI.line('ip', s.day, s.ipar, { color: 'amber', width: 2.2, fill: 0.18, label: 'Intercepted (A)', step: true });
  cI.line('dli', s.day, s.day.map(() => p.dli), { color: 'muted', width: 1.2, dash: [4, 3], label: 'DLI above the crop' });
  cI.line('cum', s.day, s.cumIpar, { color: 'water', width: 2, y2: true, label: 'Cumulative (A, right axis)' });
  cM.line('m', s.cumIpar, s.cropDW, { color: 'accent', width: 2.8, label: 'Crop dry weight (A)' });
  const xm = s.cumIpar[s.cumIpar.length - 1];
  cM.line('slope', [0, xm], [s.cropDW[0], s.cropDW[0] + s.summary.rue * xm], { color: 'muted', width: 1.2, dash: [5, 4], label: `slope = RUE ${fmt(s.summary.rue, 2)} g mol⁻¹` });
  if (B) {
    const b = B.sim;
    cG.line('fwB', b.day, b.FW, { color: 'amber', width: 2.2, dash: [7, 4], label: 'Fresh weight (B)' });
    cL.line('laiB', b.day, b.LAI, { color: 'c5', width: 1.8, dash: [7, 4], label: 'LAI (B)' });
    cR.line('rgrB', b.day, b.rgr, { color: 'amber', width: 1.8, dash: [7, 4], label: 'RGR (B)', step: true });
    cI.line('ipB', b.day, b.ipar, { color: 'c2', width: 1.8, dash: [7, 4], label: 'Intercepted (B)', step: true });
    cM.line('mB', b.cumIpar, b.cropDW, { color: 'amber', width: 2, dash: [7, 4], label: 'Crop dry weight (B)' });
  } else { cG.remove('fwB'); cL.remove('laiB'); cR.remove('rgrB'); cI.remove('ipB'); cM.remove('mB'); }
  const xmax = Math.max(p.days, B ? B.p.days : 0, DATA ? Math.max(...DATA.days) : 0);
  [cG, cL, cR, cI].forEach(c => c.setAxis('x', { min: 0, max: xmax }));
  // observations and fit
  if (DATA) {
    cG.scatter('obs', DATA.days, DATA.means, { color: 'ink', r: 4.5, yErr: DATA.sds, label: `Your data (mean ± SD, n = ${DATA.n})`, shape: 'diamond' });
    if (FIT) { const fs = CM.simulate(Object.assign(params(p), { rue: FIT.rue, fw0: FIT.fw0 ?? p.fw0, days: Math.ceil(xmax) })); cG.line('fit', fs.day, fs.FW, { color: 'magenta', width: 2, dash: [2, 3], label: `Calibrated model (RUE ${fmt(FIT.rue, 2)})` }); }
    else cG.remove('fit');
  } else { cG.remove('obs'); cG.remove('fit'); }
}

/* ================================================================ your data: parse, grow log, calibrate */
const EXAMPLE = `day,fw_g
0,2.9
0,3.3
0,2.9
0,3.4
7,54.7
7,50.9
7,54.0
7,53.4
14,128.7
14,127.3
14,101.1
14,118.2
21,169.4
21,192.5
21,167.6
21,192.6
28,226.4
28,213.2
28,238.8
28,246.4`;
const EXAMPLE_P = { dli: 14.4, hp: 16, Td: 22, Tn: 20, co2: 800, dens: 24, respace: false, fw0: 3, days: 28 };
const ta = $('#cg-data'), note = $('#cg-note'), res = $('#cg-result'), trtSel = $('#cg-trt');
ta.value = EXAMPLE;
let GL = null;
function obsFromRows(rows) {                // rows: [{day, fw}]
  const by = new Map(); rows.forEach(r => { if (!isFinite(r.day) || !isFinite(r.fw) || r.fw <= 0) return; if (!by.has(r.day)) by.set(r.day, []); by.get(r.day).push(r.fw); });
  const days = [...by.keys()].sort((a, b) => a - b);
  return { days, means: days.map(d => mean(by.get(d))), sds: days.map(d => by.get(d).length > 1 ? sd(by.get(d)) : 0), counts: days.map(d => by.get(d).length), xs: rows.filter(r => isFinite(r.day) && isFinite(r.fw) && r.fw > 0).map(r => r.day), ys: rows.filter(r => isFinite(r.day) && isFinite(r.fw) && r.fw > 0).map(r => r.fw), n: rows.filter(r => isFinite(r.day) && isFinite(r.fw) && r.fw > 0).length };
}
function parseText() {
  const T = parseTable(ta.value); if (!T.headers.length) { DATA = null; FIT = null; note.innerHTML = 'Paste two columns: day and fresh weight per plant (g).'; update(); return; }
  const H = T.headers; const low = H.map(h => String(h).toLowerCase());
  let di = low.findIndex(h => /^(day|days|dat|d)$|day/.test(h)); let fi = low.findIndex(h => /fw|fresh|weight|mass|g$/.test(h));
  if (di < 0) di = 0; if (fi < 0 || fi === di) fi = di === 0 ? 1 : 0;
  const rows = T.rows.map(r => ({ day: +r[di], fw: +r[fi] }));
  DATA = obsFromRows(rows); FIT = null;
  note.innerHTML = DATA.n ? `Read <b>${DATA.n}</b> observations on <b>${DATA.days.length}</b> dates from the columns <code>${esc(H[di])}</code> (day) and <code>${esc(H[fi])}</code> (fresh weight, g per plant).` : '<span style="color:var(--danger)">No numeric day / fresh-weight pairs found.</span>';
  res.innerHTML = ''; update();
}
function loadGrowLog() {
  let gl = null; try { gl = JSON.parse(localStorage.getItem('ffp-growlog-v1') || 'null'); } catch (e) { gl = null; }
  if (!gl || !Array.isArray(gl.rows) || !gl.rows.length) { note.innerHTML = `<span style="color:var(--danger)">No grow log was found in this browser.</span> Record your measurements in the <a href="/project/grow-log/">grow log</a> first, or paste your data above.`; return; }
  GL = gl;
  const trts = [...new Set(gl.rows.map(r => r.treatment).filter(v => v != null && v !== ''))];
  trtSel.innerHTML = '<option value="__all">All treatments</option>' + trts.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  trtSel.hidden = trts.length < 2;
  glToText();
}
function glToText() {
  const t = trtSel.value || '__all';
  const rows = GL.rows.filter(r => (t === '__all' || r.treatment === t) && r.fw_g !== '' && r.fw_g != null && isFinite(+r.fw_g) && isFinite(+r.day));
  ta.value = 'day,fw_g\n' + rows.map(r => `${+r.day},${+r.fw_g}`).join('\n');
  parseText();
  const ppfd = GL.rows.map(r => +r.ppfd).filter(v => isFinite(v) && v > 0);
  const meta = GL.meta ? [GL.meta.group, GL.meta.crop, GL.meta.system].filter(Boolean).map(esc).join(' · ') : '';
  note.innerHTML += `<br>Grow log${meta ? ' (' + meta + ')' : ''}: ${rows.length} rows with a fresh weight${t !== '__all' ? ' for treatment ' + esc(t) : ''}.` + (ppfd.length ? ` Your mean logged PPFD is ${fmt(mean(ppfd), 0)} µmol m⁻² s⁻¹ — set the DLI to PPFD × photoperiod × 0.0036 (${fmt(mean(ppfd) * ui.get('hp') * 0.0036, 1)} mol m⁻² d⁻¹ at ${ui.get('hp')} h).` : '') + ' Day 0 of your log must be the transplanting day.';
}
function calibrate() {
  if (!DATA || DATA.n < 2) { parseText(); if (!DATA || DATA.n < 2) return; }
  const both = $('#cg-fitfw0').checked;
  const base = params(); base.days = Math.ceil(Math.max(...DATA.xs, 1));
  const cacheSim = new Map();
  const model = (x, prm) => { const key = prm.map(v => v.toPrecision(7)).join('|'); let s = cacheSim.get(key); if (!s) { s = CM.simulate(Object.assign({}, base, { rue: prm[0], fw0: both ? prm[1] : base.fw0 })); cacheSim.set(key, s); if (cacheSim.size > 200) cacheSim.clear(); } return CM.at(s, 'FW', x); };
  const p0 = both ? [base.rue, base.fw0] : [base.rue];
  const bounds = both ? [[0.05, 4], [0.05, 60]] : [[0.05, 4]];
  const r = fitLM(model, DATA.xs, DATA.ys, p0, { bounds });
  FIT = { rue: r.params[0], fw0: both ? r.params[1] : null, r };
  const ci = 1.96 * r.se[0];
  res.innerHTML = `<table class="cg-fit"><tr><th>Calibrated RUE (reference conditions)</th><td><b>${fmt(r.params[0], 3)}</b> ± ${fmt(r.se[0], 3)} g mol⁻¹ (≈ 95 % CI ${fmt(r.params[0] - ci, 2)}–${fmt(r.params[0] + ci, 2)})</td></tr>` +
    (both ? `<tr><th>Transplant fresh weight</th><td>${fmt(r.params[1], 2)} ± ${fmt(r.se[1], 2)} g</td></tr>` : '') +
    `<tr><th>Fit</th><td>R² = ${fmt(r.r2, 3)} · RMSE = ${fmt(r.rmse, 1)} g · n = ${r.n} observations</td></tr>` +
    `<tr><th>Compared with Van Henten’s canopy</th><td>${fmt(100 * r.params[0] / CM.RUE_REF_VH, 0)} % of 0.90 g mol⁻¹</td></tr></table>` +
    `<div class="ctl-buttons"><button type="button" class="btn btn-sm btn-primary" id="cg-apply">Use the calibrated RUE in the model</button></div>`;
  $('#cg-apply').addEventListener('click', () => { ui.set('rue', +r.params[0].toFixed(2)); if (both) ui.set('fw0', Math.max(0.2, +r.params[1].toFixed(1))); });
  update();
}
$('#cg-parse').addEventListener('click', parseText);
$('#cg-fit').addEventListener('click', calibrate);
$('#cg-growlog').addEventListener('click', loadGrowLog);
trtSel.addEventListener('change', () => { if (GL) glToText(); });
$('#cg-example').addEventListener('click', () => { ta.value = EXAMPLE; ui.setMany(EXAMPLE_P); parseText(); note.innerHTML += '<br>Simulated teaching data: butterhead lettuce in deep-water culture under LEDs (250 µmol m⁻² s⁻¹ for 16 h, 22/20 °C, 800 ppm, 24 plants m⁻²), four plants weighed on each date. The model settings were set to match.'; });
$('#cg-csv').addEventListener('click', () => {
  const s = sim; downloadCSV('crop-growth-model.csv', ['day', 'density_m2', 'fw_g_plant', 'dw_g_plant', 'leaf_area_m2_plant', 'LAI', 'f_interception', 'intercepted_PAR_mol_m2_d', 'cumulative_PAR_mol_m2', 'crop_DW_g_m2', 'RGR_d'],
    s.day.map((d, i) => [d, s.dens[i], +s.FW[i].toFixed(2), +s.W[i].toFixed(4), +s.LA[i].toFixed(5), +s.LAI[i].toFixed(3), +s.f[i].toFixed(4), +s.ipar[i].toFixed(3), +s.cumIpar[i].toFixed(2), +s.cropDW[i].toFixed(2), +s.rgr[i].toFixed(4)]));
});

ui.onChange((s, id) => { if (id === 'lightview') { setDay(day ?? 0); return; } update(); });
new ResizeObserver(() => { if (sim) setDay(day ?? sim.day.length - 1); }).observe(canvas);
note.innerHTML = 'The box holds simulated example data. Press <em>Load example</em> to set matching model conditions, or paste your own two columns (day after transplanting, fresh weight per plant in g).';
update();
window.__cropLab = { ui, CM, get sim() { return sim; }, calibrate, setDay };
