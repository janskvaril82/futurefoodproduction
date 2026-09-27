/* Authorisation timeline simulator — Monte Carlo model of the EU novel-food procedures (Regulation (EU) 2015/2283).
   The stochastic model lives in ./model.js (shared with the Novel food navigator); see the Derive tab, Eqs. T1–T8. */
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, BarChart, downloadCSV } from '/assets/js/plot.js';
import { palette, withAlpha } from '/assets/js/colors.js';
import { mulberry32 } from '/assets/js/stats.js';
import { simulate, runMany, quantiles, VALIDATION_ART10, VALIDATION_TF, days, MONTH, EFSA_CLOCK, EFSA_CLOCK_TF, OBJ_WINDOW, IN_FORCE, LE_BLOCH } from './model.js';

const $ = s => document.querySelector(s);
const YEAR = 365.25;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'p50', label: 'Median time to authorisation', unit: 'years', digits: 2 })
  .add({ id: 'pi', label: '80 % of authorisations take', unit: 'years', format: v => v })
  .add({ id: 'pauth', label: 'Probability of authorisation', unit: '%', digits: 0 })
  .add({ id: 'p3', label: 'On the market within 3 years', unit: '%', digits: 0 })
  .add({ id: 'date', label: 'Median authorisation date', unit: '', format: v => v })
  .add({ id: 'efsa', label: 'EFSA net clock exceeded', unit: '% of opinions', digits: 0 })
  .add({ id: 'stops', label: 'Clock stops per dossier', unit: '', digits: 1 })
  .add({ id: 'run', label: 'This application', unit: '', format: v => v });

ui.section('Route');
ui.segmented({ id: 'route', label: 'Procedure', options: [{ value: 'art10', label: 'Application (Art. 10)' }, { value: 'tf', label: 'Traditional food (Art. 14)' }], value: 'art10', help: 'Traditional-food notification: only for foods from primary production with ≥ 25 years of safe use in a third country.' });
ui.section('Dossier quality (applicant)');
ui.slider({ id: 'stops', label: 'Mean number of clock stops', min: 0, max: 8, step: 0.1, value: 2.7, help: 'EFSA requests for additional data. 2018–2024 mean 2.7 ± 1.9 (Le Bloch et al., 2025).' });
ui.slider({ id: 'resp', label: 'Mean response time per stop', min: 10, max: 400, step: 5, value: 130, unit: 'd', help: 'Time the applicant needs to answer; 2018–2024 mean ≈ 130 d.' });
ui.slider({ id: 'pInvalid', label: 'Studies not notified (invalid)', min: 0, max: 40, step: 0.5, value: 10.3, unit: '%', help: '30 of 292 applications were invalid under the Transparency Regulation.' });
ui.slider({ id: 'pWithdraw', label: 'Withdrawal risk per clock stop', min: 0, max: 20, step: 0.5, value: 2, unit: '%', help: 'Assumption: applicants may withdraw (Art. 10(7)) instead of answering.' });
ui.section('Authorities');
ui.slider({ id: 'workload', label: 'EFSA workload factor', min: 0.5, max: 2, step: 0.05, value: 1, unit: '×', help: 'Scales the suitability check, the running clock and the risk of overrunning nine months.' });
ui.slider({ id: 'comm', label: 'Commission duration factor', min: 0.5, max: 2, step: 0.05, value: 1, unit: '×', help: 'Scales the validity check and the risk-management phase (1 = calibrated on 11 real procedures).' });
ui.slider({ id: 'pNeg', label: 'Negative EFSA opinions', min: 0, max: 50, step: 0.5, value: 13.2, unit: '%', help: '12 of 91 published opinions 2018–2024 were negative.' });
ui.slider({ id: 'pTerm', label: 'No qualified majority / terminated', min: 0, max: 20, step: 0.5, value: 2, unit: '%', help: 'Assumption (Art. 10(6), examination procedure).' });
ui.section('Traditional food');
ui.slider({ id: 'pObj', label: 'Probability of a safety objection', min: 0, max: 100, step: 1, value: 25, unit: '%', help: 'Assumption: no published statistic. Objection → Art. 16 application.' });
ui.slider({ id: 'prep', label: 'Preparing the Art. 16 application', min: 30, max: 720, step: 10, value: 180, unit: 'd' });
ui.section('Simulation');
ui.select({ id: 'start', label: 'Submission date', options: ['2026-10-01', '2027-01-01', '2027-04-01', '2027-07-01', '2027-10-01', '2028-01-01'].map(v => ({ value: v, label: new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) })), value: '2026-10-01' });
ui.slider({ id: 'N', label: 'Monte Carlo runs', min: 200, max: 5000, step: 100, value: 1000 });
ui.slider({ id: 'speed', label: 'Animation speed', min: 20, max: 1000, step: 10, value: 160, unit: 'd s⁻¹', persist: false });
const [btnPlay] = ui.buttons([
  { label: 'Pause', variant: 'primary', onClick: () => togglePlay() },
  { label: 'New application', onClick: () => newRun() },
  { label: 'Re-run Monte Carlo', onClick: () => { mcSeed++; recompute(); } }
]);
ui.presets([
  { label: 'EU average 2018–24', values: { route: 'art10', stops: 2.7, resp: 130, pInvalid: 10.3, pWithdraw: 2, workload: 1, comm: 1, pNeg: 13.2, pTerm: 2 } },
  { label: 'Excellent dossier', values: { route: 'art10', stops: 1, resp: 45, pInvalid: 2, pWithdraw: 1, workload: 1, comm: 1, pNeg: 5, pTerm: 2 } },
  { label: 'Weak dossier', values: { route: 'art10', stops: 5, resp: 200, pInvalid: 25, pWithdraw: 5, workload: 1, comm: 1, pNeg: 25, pTerm: 2 } },
  { label: 'Overloaded system', values: { route: 'art10', stops: 2.7, resp: 130, pInvalid: 10.3, pWithdraw: 2, workload: 1.6, comm: 1.3, pNeg: 13.2, pTerm: 2 } },
  { label: 'Traditional food', values: { route: 'tf', pObj: 15, prep: 180, stops: 2.7, resp: 130, workload: 1, comm: 1, pNeg: 13.2 } },
  { label: 'Contested traditional food', values: { route: 'tf', pObj: 70, prep: 240, stops: 2.7, resp: 130, workload: 1, comm: 1, pNeg: 13.2 } }
]);
ui.button({ label: 'Download the Monte Carlo runs (CSV)', onClick: () => exportCSV() });
ui.saveButton('authorisation-timeline', () => ro.values());

const params = () => { const v = ui.values(); return { route: v.route, stops: v.stops, resp: v.resp, pInvalid: v.pInvalid / 100, pWithdraw: v.pWithdraw / 100, workload: v.workload, comm: v.comm, pNeg: v.pNeg / 100, pTerm: v.pTerm / 100, pObj: v.pObj / 100, prep: v.prep }; };

/* ------------------------------------------------------------ stage: animated Gantt chart */
const stageEl = $('#stage');
const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Animated Gantt chart of one simulated authorisation procedure'); stageEl.appendChild(cv);
const hud = hudChips(stageEl);
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l11-7z"/></svg>';
const ICON_DICE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/><circle cx="15" cy="15" r="1.3" fill="currentColor"/><circle cx="15" cy="9" r="1.3" fill="currentColor"/><circle cx="9" cy="15" r="1.3" fill="currentColor"/></svg>';
stageToolbar(stageEl, {
  extra: [{ icon: ICON_PLAY, title: 'Play / pause', onClick: () => togglePlay() }, { icon: ICON_DICE, title: 'New application', onClick: () => newRun() }],
  onReset: () => { cursor = 0; clock.play(); },
  onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'authorisation-timeline.png'; a.click(); }
});
// fixed stage palette (the stage background is dark in both themes)
const SC = { bg: '#0d1512', band: 'rgba(255,255,255,0.028)', grid: 'rgba(255,255,255,0.07)', gridStrong: 'rgba(255,255,255,0.16)', text: '#e6eee9', muted: '#8fa39a', com: '#6fd39a', efsa: '#5cc8ef', stop: '#f2b94b', ms: '#f07ad0', pub: '#aab9b1', app: '#ffa46b', danger: '#ff7a6e', auth: '#6fd39a' };
const KIND = { com: ['Commission', SC.com], efsa: ['EFSA', SC.efsa], stop: ['Clock stop', SC.stop], ms: ['Member States', SC.ms], pub: ['Publication · OJ', SC.pub], app: ['Applicant', SC.app] };

let runSeed = 1, mcSeed = 1, run = null, cursor = 0, playing = true;
const clock = new SimClock({ speed: 160, onStep: dt => { if (run) cursor = Math.min(run.total, cursor + dt); }, onFrame: () => { drawGantt(); if (run && cursor >= run.total) { clock.pause(); } } });
clock.onState(r => { playing = r; btnPlay.textContent = r ? 'Pause' : (run && cursor >= run.total ? 'Replay' : 'Play'); });
function togglePlay() { if (!run) return; if (cursor >= run.total) cursor = 0; clock.toggle(); if (!clock.running) drawGantt(); }
function newRun() { runSeed++; makeRun(true); }
function makeRun(restart) {
  const wasDone = !run || cursor >= run.total - 1e-6;
  run = simulate(params(), mulberry32(1000 + runSeed * 7919));
  if (reduceMotion) cursor = run.total;
  else if (restart) cursor = 0;
  else if (wasDone && !clock.running) cursor = run.total;
  else cursor = Math.min(cursor, run.total);
  if (restart && !reduceMotion) clock.play(); else drawGantt();
  const o = OUT[run.outcome];
  ro.set('run', `${fmt(run.total / YEAR, 2)} a`, o[2], `${o[0]} · ${run.n} clock stop${run.n === 1 ? '' : 's'} · seed ${runSeed}`);
}
const OUT = { authorised: ['Authorised', SC.auth, 'ok'], negative: ['Negative opinion', SC.danger, 'bad'], invalid: ['Not valid (studies not notified)', SC.danger, 'bad'], withdrawn: ['Withdrawn by applicant', SC.stop, 'warn'], terminated: ['No qualified majority / terminated', SC.danger, 'bad'] };

function rowsFor(r) {
  if (r.route === 'art10') return [
    { keys: ['A'], actor: 'Commission', what: 'validity check', kind: 'com' },
    { keys: ['B'], actor: 'EFSA', what: 'suitability check', kind: 'efsa' },
    { keys: ['C', 'S'], actor: 'EFSA NDA Panel', what: 'risk assessment · 9-month clock', kind: 'efsa', clock: EFSA_CLOCK },
    { keys: ['D'], actor: 'EFSA', what: 'publication of the opinion', kind: 'pub' },
    { keys: ['E1'], actor: 'Commission', what: 'draft implementing act', kind: 'com', limit: true },
    { keys: ['E2'], actor: 'Member States', what: 'PAFF vote · adoption', kind: 'ms' },
    { keys: ['F'], actor: 'Official Journal', what: 'entry into force', kind: 'pub' }];
  const rows = [{ keys: ['V'], actor: 'Commission', what: 'validity check · forwarding', kind: 'com' }, { keys: ['O'], actor: 'Member States + EFSA', what: '4-month objection window', kind: 'ms' }];
  if (!r.objection) rows.push({ keys: ['L'], actor: 'Commission', what: 'authorises (Art. 15(4))', kind: 'com' });
  else rows.push({ keys: ['P'], actor: 'Applicant', what: 'prepares Art. 16 application', kind: 'app' }, { keys: ['A'], actor: 'Commission', what: 'validity check', kind: 'com' }, { keys: ['C', 'S'], actor: 'EFSA NDA Panel', what: 'assessment · 6-month clock', kind: 'efsa', clock: EFSA_CLOCK_TF }, { keys: ['D'], actor: 'EFSA', what: 'publication of the opinion', kind: 'pub' }, { keys: ['E1'], actor: 'Commission', what: 'draft (≤ 3 months, Art. 18)', kind: 'com' }, { keys: ['E2'], actor: 'Member States', what: 'PAFF vote · adoption', kind: 'ms' });
  rows.push({ keys: ['F'], actor: 'Official Journal', what: 'entry into force', kind: 'pub' });
  return rows;
}
const startDate = () => new Date(ui.get('start') + 'T00:00:00Z');
const dateAt = d => { const x = startDate(); x.setUTCDate(x.getUTCDate() + Math.round(d)); return x; };
const fmtDate = (d, opt = { day: 'numeric', month: 'short', year: 'numeric' }) => d.toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, opt));
function rr(ctx, x, y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
let hatch = null;
function hatchPattern(ctx) {
  if (hatch) return hatch;
  const p = document.createElement('canvas'); p.width = p.height = 8; const c = p.getContext('2d');
  c.fillStyle = SC.stop; c.fillRect(0, 0, 8, 8); c.strokeStyle = 'rgba(40,24,0,0.35)'; c.lineWidth = 2; c.beginPath(); c.moveTo(-2, 10); c.lineTo(10, -2); c.moveTo(6, 10); c.lineTo(10, 6); c.moveTo(-2, 2); c.lineTo(2, -2); c.stroke();
  hatch = ctx.createPattern(p, 'repeat'); return hatch;
}
function drawGantt() {
  if (!run) return;
  const W = stageEl.clientWidth, H = stageEl.clientHeight; if (!W || !H) return;
  const d = Math.min(devicePixelRatio || 1, 2.5);
  if (cv.width !== Math.round(W * d) || cv.height !== Math.round(H * d)) { cv.width = Math.round(W * d); cv.height = Math.round(H * d); }
  const ctx = cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.fillStyle = SC.bg; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.7, H * 0.2, 10, W * 0.7, H * 0.2, W * 0.8); glow.addColorStop(0, 'rgba(92,200,239,0.07)'); glow.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  const rows = rowsFor(run);
  const narrow = W < 640;
  const LW = narrow ? 118 : Math.min(214, W * 0.25), R = 22, T = narrow ? 100 : 146, B = 46;
  const PW = W - LW - R, PH = H - T - B;
  const Tmax = Math.max(24 * MONTH, Math.ceil((run.total + 40) / (6 * MONTH)) * 6 * MONTH);
  const X = t => LW + (t / Tmax) * PW;
  const rowH = PH / rows.length, bh = Math.min(26, rowH * 0.58);
  // row bands + labels
  rows.forEach((r, i) => {
    const y = T + i * rowH;
    if (i % 2 === 0) { ctx.fillStyle = SC.band; ctx.fillRect(0, y, W, rowH); }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillStyle = KIND[r.kind][1]; ctx.font = `650 ${narrow ? 10.5 : 12}px Inter, sans-serif`; ctx.fillText(r.actor, LW - 12, y + rowH / 2 - (narrow ? 6 : 7));
    ctx.fillStyle = SC.muted; ctx.font = `500 ${narrow ? 9.5 : 11}px Inter, sans-serif`;
    let what = r.what;
    if (ctx.measureText(what).width > LW - 18) { while (what.length > 4 && ctx.measureText(what + '…').width > LW - 18) what = what.slice(0, -1); what = what.trimEnd() + '…'; }
    ctx.fillText(what, LW - 12, y + rowH / 2 + (narrow ? 6 : 8));
  });
  // time grid: months and calendar years
  ctx.lineWidth = 1;
  for (let m = 0; m * MONTH <= Tmax + 1; m += 3) {
    const x = Math.round(X(m * MONTH)) + 0.5; ctx.strokeStyle = m % 12 === 0 ? SC.gridStrong : SC.grid; ctx.beginPath(); ctx.moveTo(x, T - 6); ctx.lineTo(x, T + PH); ctx.stroke();
    if (m % 6 === 0) { ctx.fillStyle = SC.muted; ctx.font = "500 10.5px 'JetBrains Mono', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(String(m), x, T + PH + 6); }
  }
  ctx.fillStyle = SC.text; ctx.font = '600 11.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(`Months after submission (${fmtDate(startDate(), { day: 'numeric', month: 'long', year: 'numeric' })})`, LW + PW / 2, H - 6);
  // calendar year boundaries
  const s0 = startDate(); for (let y = s0.getUTCFullYear() + 1; ; y++) { const t = (Date.UTC(y, 0, 1) - s0.getTime()) / 864e5; if (t > Tmax) break; const x = X(t); ctx.strokeStyle = 'rgba(111,211,154,0.25)'; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(x, T - 16); ctx.lineTo(x, T + PH); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = 'rgba(111,211,154,0.8)'; ctx.font = "600 10px 'JetBrains Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(String(y), x + 3, T - 4); }
  // bars
  const rowOf = k => rows.findIndex(r => r.keys.includes(k));
  let efsaNet = 0, stopSum = 0, curPhase = null;
  for (const p of run.phases) {
    const i = rowOf(p.key); if (i < 0 || p.t0 > cursor) continue;
    const t1 = Math.min(p.t1, cursor), y = T + i * rowH + (rowH - bh) / 2;
    const x0 = X(p.t0), x1 = Math.max(x0 + 1.5, X(t1));
    if (p.kind === 'stop') { ctx.fillStyle = hatchPattern(ctx); stopSum += t1 - p.t0; }
    else { const g = ctx.createLinearGradient(0, y, 0, y + bh); const c = KIND[p.kind][1]; g.addColorStop(0, c); g.addColorStop(1, withAlpha(c, 0.72)); ctx.fillStyle = g; if (p.key === 'C') efsaNet += t1 - p.t0; }
    rr(ctx, x0, y, x1 - x0, bh, 5); ctx.fill();
    if (p.t1 > cursor) { curPhase = p; ctx.save(); ctx.shadowColor = KIND[p.kind][1]; ctx.shadowBlur = 14; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x1, y + bh / 2, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    const wpx = x1 - x0, dur = t1 - p.t0;
    if (p.t1 <= cursor && wpx > (p.kind === 'stop' ? 34 : 40)) { ctx.fillStyle = p.kind === 'stop' ? '#2a1a00' : '#06140d'; ctx.font = "650 10.5px 'JetBrains Mono', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.kind === 'stop' ? `${Math.round(dur)} d` : dur >= 60 ? `${fmt(dur / MONTH, 1)} mo` : `${Math.round(dur)} d`, (x0 + x1) / 2, y + bh / 2 + 0.5); }
  }
  // legal deadlines: EFSA net clock (moves right with every clock stop) and Commission 7-month limit
  const ci = rows.findIndex(r => r.clock);
  const cStart = run.phases.find(p => p.key === 'C');
  if (ci >= 0 && cStart && cursor >= cStart.t0) {
    const cl = rows[ci].clock, cEnd = Math.max(...run.phases.filter(p => p.key === 'C' || p.key === 'S').map(p => p.t1));
    const dl = cStart.t0 + cl + stopSum, over = efsaNet > cl + 0.5, y = T + ci * rowH;
    const x = X(dl); ctx.strokeStyle = over ? SC.danger : 'rgba(230,238,233,0.55)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(x, y + rowH - 4); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = over ? SC.danger : 'rgba(230,238,233,0.75)'; ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const lab = cursor >= cEnd ? (over ? `net clock overrun ${Math.round(efsaNet - cl)} d` : 'opinion within the net clock') : 'legal deadline (moves with each stop)';
    ctx.fillText(lab, Math.min(x + 4, W - 150), y + 2);
  }
  const pubP = run.phases.find(p => p.key === 'D'), e1 = rows.findIndex(r => r.limit);
  if (e1 >= 0 && pubP && cursor >= pubP.t1) { const x = X(pubP.t1 + 7 * MONTH), y = T + e1 * rowH; ctx.strokeStyle = 'rgba(230,238,233,0.55)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(x, y + rowH - 4); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = 'rgba(230,238,233,0.75)'; ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('Art. 12: draft ≤ 7 months', Math.min(x + 4, W - 130), y + 2); }
  // milestones lane
  const reached = run.events.filter(e => e.t <= cursor);
  const my = T - 26;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.moveTo(LW, my); ctx.lineTo(LW + PW, my); ctx.stroke();
  reached.forEach(e => { const x = X(e.t), c = e.kind === 'end' ? SC.danger : e.kind === 'auth' ? SC.auth : e.kind === 'stop' ? SC.stop : e.kind === 'ms' ? SC.ms : e.kind === 'efsa' || e.kind === 'pub' ? SC.efsa : SC.com; ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, my - 5); ctx.lineTo(x + 5, my); ctx.lineTo(x, my + 5); ctx.lineTo(x - 5, my); ctx.closePath(); ctx.fill(); });
  const last = reached[reached.length - 1];
  if (last) { const x = X(last.t); ctx.font = '600 11px Inter, sans-serif'; const tw = ctx.measureText(last.label).width; const bx = Math.max(LW, Math.min(x - tw / 2 - 8, W - R - tw - 16)); ctx.fillStyle = 'rgba(10,16,14,0.85)'; rr(ctx, bx, my - 27, tw + 16, 18, 6); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.stroke(); ctx.fillStyle = SC.text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(last.label, bx + 8, my - 18); }
  // cursor
  const xc = X(cursor); ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(xc, my + 8); ctx.lineTo(xc, T + PH); ctx.stroke(); ctx.lineWidth = 1;
  const dl = fmtDate(dateAt(cursor)); ctx.font = "600 10.5px 'JetBrains Mono', monospace"; const tw = ctx.measureText(dl).width; ctx.fillStyle = '#e6eee9'; rr(ctx, Math.min(xc - tw / 2 - 6, W - tw - 14), T + PH - 1, tw + 12, 17, 5); ctx.fill(); ctx.fillStyle = '#0d1512'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(dl, Math.min(xc - tw / 2, W - tw - 8), T + PH + 7.5);
  // legend (bottom-left, under the row labels)
  const kinds = narrow ? [] : [...new Set(rows.map(r => r.kind).concat(run.phases.some(p => p.kind === 'stop') ? ['stop'] : []))];
  ctx.font = '600 9.5px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  kinds.forEach((k, i) => { const col = i % 2, rw = Math.floor(i / 2), lx = 8 + col * (LW - 8) / 2, ly = T + PH + 10 + rw * 12; if (k === 'stop') ctx.fillStyle = hatchPattern(ctx); else ctx.fillStyle = KIND[k][1]; ctx.fillRect(lx, ly - 4, 9, 8); ctx.fillStyle = SC.muted; ctx.fillText(KIND[k][0], lx + 13, ly); });
  // outcome stamp (upper right: no bars there at the end of a procedure)
  if (cursor >= run.total) {
    const o = OUT[run.outcome]; const txt = o[0].toUpperCase(), sub = `${fmt(run.total / YEAR, 2)} years · ${fmtDate(dateAt(run.total), { month: 'long', year: 'numeric' })}`;
    ctx.save(); ctx.translate(LW + PW * (narrow ? 0.66 : 0.76), T + Math.min(rowH * 1.05, PH * 0.2)); ctx.rotate(-0.06);
    ctx.font = `800 ${narrow ? 15 : 20}px Inter, sans-serif`; const w1 = ctx.measureText(txt).width; ctx.font = `600 ${narrow ? 11 : 12.5}px Inter, sans-serif`; const w2 = ctx.measureText(sub).width; const bw = Math.max(w1, w2) + 28;
    ctx.fillStyle = 'rgba(10,16,14,0.78)'; rr(ctx, -bw / 2, -30, bw, 60, 10); ctx.fill(); ctx.strokeStyle = o[1]; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = o[1]; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `800 ${narrow ? 15 : 20}px Inter, sans-serif`; ctx.fillText(txt, 0, -8); ctx.fillStyle = SC.text; ctx.font = `600 ${narrow ? 11 : 12.5}px Inter, sans-serif`; ctx.fillText(sub, 0, 14); ctx.restore();
  }
  // HUD
  const cl = run.route === 'art10' ? EFSA_CLOCK : EFSA_CLOCK_TF;
  hud.set('date', `Day <b>${Math.round(cursor)}</b> · ${fmtDate(dateAt(cursor))}`);
  hud.set('phase', curPhase ? `Now: <b>${curPhase.label}</b>` : cursor >= run.total ? `Outcome: <b>${OUT[run.outcome][0]}</b>` : 'Waiting');
  if (run.route === 'art10' || run.objection) hud.set('efsa', `EFSA net clock <b>${Math.round(efsaNet)}</b> / ${Math.round(cl)} d <span class="gbar"><i style="width:${Math.min(100, 100 * efsaNet / cl)}%;background:${efsaNet > cl ? SC.danger : SC.efsa}"></i></span>`); else hud.remove('efsa');
  if (run.route === 'art10' || run.objection) hud.set('stops', `Clock stops <b>${run.phases.filter(p => p.kind === 'stop' && p.t0 <= cursor).length}</b> · ${Math.round(stopSum)} d`); else hud.remove('stops');
}
new ResizeObserver(() => drawGantt()).observe(stageEl);

/* ------------------------------------------------------------ Monte Carlo + charts */
const hist = new Plot('#chart-hist', { x: { label: 'Time from submission to authorisation', unit: 'years', min: 0, max: 8 }, y: { label: 'Share of all applications', unit: '% per quarter', min: 0 }, y2: { label: 'On the market by then', unit: '% of applications', min: 0, max: 100 }, legend: true });
const phaseChart = new BarChart('#chart-phases', { horizontal: true, stacked: true, y: { label: 'Months', min: 0 }, height: 250 });
const sens = new BarChart('#chart-sens', { horizontal: true, y: { label: 'Months saved on the median time to authorisation', min: 0 }, height: 250, legend: false });
let MC = [];
function recompute() {
  const P = params(), N = Math.round(ui.get('N'));
  MC = runMany(P, N, 100 + mcSeed);
  const auth = MC.filter(r => r.outcome === 'authorised'), T = auth.map(r => r.total).sort((a, b) => a - b);
  const [p10, p25, p50, p75, p90] = quantiles(T, [0.1, 0.25, 0.5, 0.75, 0.9]);
  const pAuth = auth.length / MC.length, p3 = MC.filter(r => r.outcome === 'authorised' && r.total <= 3 * YEAR).length / MC.length;
  ro.set('p50', p50 / YEAR, p50 / YEAR < 2.5 ? 'ok' : p50 / YEAR < 3.5 ? 'warn' : 'bad', `mean ${fmt(T.reduce((s, v) => s + v, 0) / T.length / YEAR, 2)} a (right-skewed)`);
  ro.set('pi', `${fmt(p10 / YEAR, 1)} – ${fmt(p90 / YEAR, 1)}`, null, 'P10 – P90 of authorised runs');
  ro.set('pauth', 100 * pAuth, pAuth >= 0.75 ? 'ok' : pAuth >= 0.5 ? 'warn' : 'bad', `n = ${MC.length} simulated dossiers`);
  ro.set('p3', 100 * p3, p3 >= 0.5 ? 'ok' : p3 >= 0.25 ? 'warn' : 'bad', 'share of all applications');
  ro.set('date', fmtDate(dateAt(p50), { month: 'long', year: 'numeric' }), null, `if submitted ${fmtDate(startDate())}`);
  const withC = MC.filter(r => r.active > 0);
  const over = withC.filter(r => r.overrun > 0).length / Math.max(1, withC.length);
  ro.set('efsa', 100 * over, over > 0.35 ? 'bad' : over > 0.2 ? 'warn' : 'ok', 'measured 2018–2024: 26 %');
  const nMean = withC.reduce((s, r) => s + r.n, 0) / Math.max(1, withC.length), share = withC.reduce((s, r) => s + r.stopDays / (r.stopDays + r.active), 0) / Math.max(1, withC.length);
  ro.set('stops', nMean, null, `${fmt(100 * share, 0)} % of EFSA time is waiting for the applicant`);
  drawHist(T, [p10, p50, p90], P.route);
  drawPhases(auth, P.route);
  intl.update();
  scheduleSens();
}
function drawHist(T, pc, route) {
  const bw = 0.25, nb = 36, counts = new Array(nb).fill(0);
  T.forEach(t => { const k = Math.floor(t / YEAR / bw); if (k >= 0 && k < nb) counts[k]++; });
  const share = counts.map(c => 100 * c / MC.length), ymax = Math.max(2, ...share) * 1.18;
  const xmax = Math.min(9, Math.max(4, Math.ceil(pc[2] / YEAR * 1.35)));
  hist.setAxis('x', { min: 0, max: xmax });
  hist.custom('bars', (ctx, plot, P) => {
    share.forEach((v, i) => { if (!v) return; const x0 = plot.px(i * bw), x1 = plot.px((i + 1) * bw), y = plot.py(v), y0 = plot.py(0); const mid = (i + 0.5) * bw * YEAR; const inside = mid >= pc[0] && mid <= pc[2]; ctx.fillStyle = withAlpha(P.water.startsWith('#') ? P.water : '#1c78a3', inside ? 0.55 : 0.28); ctx.fillRect(x0 + 1, y, Math.max(1, x1 - x0 - 2), y0 - y); });
  });
  hist.line('dom', [0, xmax], [0, ymax], { opacity: 0, noTip: true });
  const xs = [], ys = []; const all = MC.map(r => r.outcome === 'authorised' ? r.total / YEAR : Infinity).sort((a, b) => a - b);
  for (let x = 0; x <= xmax + 1e-9; x += 0.05) { xs.push(x); let lo = 0, hi = all.length; while (lo < hi) { const m = (lo + hi) >> 1; if (all[m] <= x) lo = m + 1; else hi = m; } ys.push(100 * lo / all.length); }
  hist.line('ecdf', xs, ys, { color: 'magenta', width: 2.4, y2: true, label: 'On the market by then (all applications)' });
  const V = route === 'tf' ? VALIDATION_TF.map(v => ({ n: v.name, t: (days(v.notif, v.ir) + IN_FORCE) / YEAR })) : VALIDATION_ART10.map(v => ({ n: v.name, t: (days(v.sub, v.ir) + IN_FORCE) / YEAR }));
  hist.scatter('real', V.map(v => v.t), V.map((v, i) => ymax * (0.86 - 0.05 * (i % 3))), { color: 'amber', shape: 'diamond', r: 5, label: route === 'tf' ? `Real traditional-food notifications (${V.length})` : `Real authorisations 2021–2025 (${V.length})` });
  hist.vline('p10', pc[0] / YEAR, { color: 'muted', label: 'P10' }); hist.vline('p50', pc[1] / YEAR, { color: 'accent', label: 'median', dash: [2, 0] }); hist.vline('p90', pc[2] / YEAR, { color: 'muted', label: 'P90' });
  $('#hist-sub-extra').textContent = route === 'tf' ? 'Diamonds: seven real notifications 2018–2021 (dates from the recitals of the implementing regulations).' : 'Diamonds: eleven real Article 10 procedures 2018–2025 (dates from the recitals of the implementing regulations).';
}
function drawPhases(auth, route) {
  const mean = f => auth.length ? auth.reduce((s, r) => s + f(r), 0) / auth.length / MONTH : 0;
  const ph = (r, keys) => r.phases.filter(p => keys.includes(p.key)).reduce((s, p) => s + p.t1 - p.t0, 0);
  let cats, series;
  if (route === 'art10') {
    cats = ['Model (mean)', 'Legal timetable'];
    const pal = palette(), light = c => withAlpha(c.startsWith('#') ? c : '#1c78a3', 0.5);
    const S = [['Commission validity', 'accent', ['A'], 0], ['EFSA suitability / forwarding', light(pal.water), ['B'], 1], ['EFSA running clock', 'water', ['C'], 9], ['Clock stops (applicant)', 'amber', ['S'], 0], ['Publication', 'muted', ['D'], LE_BLOCH.D.mean / MONTH], ['Commission + PAFF', 'magenta', ['E1', 'E2'], 7], ['Entry into force', 'c4', ['F'], IN_FORCE / MONTH]];
    series = S.map(([label, color, keys, legal]) => ({ label, color, values: [mean(r => ph(r, keys)), legal] }));
  } else {
    cats = ['Model (mean)', 'Legal, no objection'];
    const S = [['Validity + forwarding', 'accent', ['V'], 1], ['Objection window', 'magenta', ['O'], 4], ['Authorisation (no objection)', 'c1', ['L'], 0], ['Art. 16 application route', 'amber', ['P', 'A', 'C', 'S', 'D', 'E1', 'E2'], 0], ['Entry into force', 'c4', ['F'], IN_FORCE / MONTH]];
    series = S.map(([label, color, keys, legal]) => ({ label, color, values: [mean(r => ph(r, keys)), legal] }));
  }
  phaseChart.set(cats, series);
}
let sensT = null;
function scheduleSens() { clearTimeout(sensT); sensT = setTimeout(computeSens, 220); }
function computeSens() {
  const P = params(), N = 700, seed = 500 + mcSeed;
  const med = Q => { const a = runMany(Q, N, seed).filter(r => r.outcome === 'authorised').map(r => r.total).sort((x, y) => x - y); return quantiles(a, [0.5])[0]; };
  const base = med(P);
  const L = P.route === 'art10'
    ? [['No clock stops at all', { stops: 0 }], ['Halve the number of clock stops', { stops: P.stops / 2 }], ['Answer EFSA twice as fast', { resp: P.resp / 2 }], ['EFSA workload −30 %', { workload: P.workload * 0.7 }], ['Commission 30 % faster', { comm: P.comm * 0.7 }]]
    : [['No objection risk', { pObj: 0 }], ['Halve the objection risk', { pObj: P.pObj / 2 }], ['Prepare Art. 16 file twice as fast', { prep: P.prep / 2 }], ['Commission 30 % faster', { comm: P.comm * 0.7 }], ['Halve the number of clock stops', { stops: P.stops / 2 }]];
  const vals = L.map(([, d]) => Math.max(0, (base - med(Object.assign({}, P, d))) / MONTH));
  sens.set(L.map(l => l[0]), [{ label: 'Months saved', values: vals, colors: vals.map((v, i) => i === vals.indexOf(Math.max(...vals)) ? 'accent' : 'water'), format: v => fmt(v, 1) }]);
}

/* ------------------------------------------------------------ international comparison (custom chart) */
class RangeChart {
  constructor(el) { this.el = el; el.innerHTML = ''; this.cv = document.createElement('canvas'); this.cv.style.width = '100%'; this.cv.style.height = '100%'; this.cv.style.display = 'block'; el.appendChild(this.cv); new ResizeObserver(() => this.draw()).observe(el); document.addEventListener('ffp:theme', () => this.draw()); this.rows = []; }
  set(rows) { this.rows = rows; this.draw(); }
  update() { this.set(intlRows()); }
  draw() {
    const W = this.el.clientWidth, H = this.el.clientHeight; if (!W || !H) return;
    const d = Math.min(devicePixelRatio || 1, 2.5); this.cv.width = Math.round(W * d); this.cv.height = Math.round(H * d);
    const ctx = this.cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, W, H);
    const P = palette(); const n = this.rows.length; if (!n) return;
    ctx.font = '550 11.5px Inter, sans-serif';
    const LWc = Math.min(W * 0.52, Math.max(...this.rows.map(r => ctx.measureText(r.label).width)) + 14), Rr = 14, Tt = 6, Bb = 40;
    const hi = Math.max(60, ...this.rows.map(r => r.kind === 'box' ? r.q[4] : r.kind === 'dots' ? Math.max(...r.pts) : r.v + (r.kind === 'pending' ? 8 : 0)));
    const PW = W - LWc - Rr, rowH = (H - Tt - Bb) / n, xMax = Math.ceil(hi / 12) * 12, step = xMax > 72 ? 12 : 6;
    const X = m => LWc + Math.min(1, m / xMax) * PW;
    ctx.strokeStyle = P.line; ctx.lineWidth = 1;
    for (let m = 0; m <= xMax; m += step) { const x = Math.round(X(m)) + 0.5; ctx.beginPath(); ctx.moveTo(x, Tt); ctx.lineTo(x, H - Bb); ctx.stroke(); ctx.fillStyle = P.muted; ctx.font = "500 10.5px 'JetBrains Mono', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; if (m % 12 === 0 || PW > 380) ctx.fillText(String(m), x, H - Bb + 6); }
    ctx.fillStyle = P.ink2; ctx.font = '550 12px Inter, sans-serif'; ctx.textBaseline = 'bottom'; ctx.fillText('Months from application (or filing) to authorisation', LWc + PW / 2, H - 4);
    // value label: right of the mark if there is room, otherwise left of its start
    const note = (txt, xEnd, xStart, yc) => { ctx.fillStyle = P.muted; ctx.font = "500 10px 'JetBrains Mono', monospace"; const tw = ctx.measureText(txt).width; if (xEnd + 6 + tw < W - 2) { ctx.textAlign = 'left'; ctx.fillText(txt, xEnd + 6, yc); } else { ctx.textAlign = 'right'; ctx.fillText(txt, Math.max(LWc + tw, xStart - 6), yc); } };
    this.rows.forEach((r, i) => {
      const yc = Tt + (i + 0.5) * rowH, bh = Math.min(14, rowH * 0.5);
      ctx.fillStyle = P.ink2; ctx.font = '550 11.5px Inter, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(r.label, LWc - 10, yc);
      const col = r.color === 'model' ? P.water : r.color === 'real' ? P.amber : r.color === 'legal' ? P.muted : P.accent;
      if (r.kind === 'box') {
        ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(r.q[0]), yc); ctx.lineTo(X(r.q[4]), yc); ctx.moveTo(X(r.q[0]), yc - bh / 3); ctx.lineTo(X(r.q[0]), yc + bh / 3); ctx.moveTo(X(r.q[4]), yc - bh / 3); ctx.lineTo(X(r.q[4]), yc + bh / 3); ctx.stroke();
        ctx.fillStyle = withAlpha(col.startsWith('#') ? col : '#1c78a3', 0.35); ctx.fillRect(X(r.q[1]), yc - bh / 2, X(r.q[3]) - X(r.q[1]), bh); ctx.strokeRect(X(r.q[1]), yc - bh / 2, X(r.q[3]) - X(r.q[1]), bh);
        ctx.fillStyle = col; ctx.fillRect(X(r.q[2]) - 1.5, yc - bh / 2 - 2, 3, bh + 4);
        note(`median ${fmt(r.q[2], 0)} (${fmt(r.q[0], 0)}–${fmt(r.q[4], 0)})`, X(r.q[4]), X(r.q[0]), yc);
      } else if (r.kind === 'dots') {
        r.pts.forEach(v => { ctx.fillStyle = withAlpha(col.startsWith('#') ? col : '#b86e0b', 0.85); ctx.beginPath(); ctx.moveTo(X(v), yc - 5); ctx.lineTo(X(v) + 4.5, yc); ctx.lineTo(X(v), yc + 5); ctx.lineTo(X(v) - 4.5, yc); ctx.closePath(); ctx.fill(); });
        note(`${fmt(Math.min(...r.pts), 0)}–${fmt(Math.max(...r.pts), 0)}`, X(Math.max(...r.pts)) + 4, X(Math.min(...r.pts)) - 4, yc);
      } else if (r.kind === 'pending') {
        ctx.fillStyle = withAlpha(col.startsWith('#') ? col : '#b86e0b', 0.3); ctx.fillRect(X(0), yc - bh / 2, X(r.v) - X(0), bh); ctx.strokeStyle = col; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(X(r.v), yc); ctx.lineTo(X(r.v + 8), yc); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); const xa = X(r.v + 8); ctx.moveTo(xa, yc - 4); ctx.lineTo(xa + 6, yc); ctx.lineTo(xa, yc + 4); ctx.fillStyle = col; ctx.fill();
        note(`≥ ${r.v} (pending)`, xa + 6, X(0), yc);
      } else {
        const w = X(r.v) - X(0); if (r.kind === 'legal') { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.strokeRect(X(0), yc - bh / 2, Math.max(2, w), bh); ctx.setLineDash([]); } else { ctx.fillStyle = col; ctx.fillRect(X(0), yc - bh / 2, Math.max(2, w), bh); }
        note(r.v === 0 ? '0 (no pre-market review)' : `${fmt(r.v, r.v < 10 ? 1 : 0)}${r.kind === 'legal' ? ' (legal maximum)' : ''}`, X(r.v), X(0), yc);
      }
    });
  }
}
const intl = new RangeChart($('#chart-intl'));
function intlRows() {
  const P = params();
  const mc = (route, extra = {}) => { const a = runMany(Object.assign({}, P, { route }, extra), 600, 900 + mcSeed).filter(r => r.outcome === 'authorised').map(r => r.total / MONTH).sort((x, y) => x - y); return quantiles(a, [0.1, 0.25, 0.5, 0.75, 0.9]); };
  return [
    { label: 'EU · Art. 10 application (model)', kind: 'box', color: 'model', q: mc('art10') },
    { label: 'EU · 11 real Art. 10 authorisations', kind: 'dots', color: 'real', pts: VALIDATION_ART10.map(v => (days(v.sub, v.ir) + IN_FORCE) / MONTH) },
    { label: 'EU · traditional food (model)', kind: 'box', color: 'model', q: mc('tf') },
    { label: 'EU · cultivated duck cells (pending)', kind: 'pending', color: 'real', v: 26 },
    { label: 'UK · sandbox target (routine file)', kind: 'bar', color: 'other', v: 30 },
    { label: 'Australia–NZ · cultured quail', kind: 'bar', color: 'other', v: 28 },
    { label: 'Singapore · cultivated beef', kind: 'bar', color: 'other', v: 46 },
    { label: 'USA · GRAS notice (2016 rule)', kind: 'legal', color: 'legal', v: 270 / MONTH },
    { label: 'USA · GRAS notice (2026 proposal)', kind: 'legal', color: 'legal', v: 405 / MONTH },
    { label: 'USA · self-affirmed GRAS', kind: 'bar', color: 'other', v: 0 }
  ];
}

/* ------------------------------------------------------------ validation table (Explain tab) */
function fillValidation() {
  const tb = $('#val-art10 tbody'); if (tb) tb.innerHTML = VALIDATION_ART10.map(v => { const A = days(v.sub, v.mandate), BC = days(v.mandate, v.opinion), E = days(v.opinion, v.ir), W = days(v.sub, v.ir); return `<tr><td>${v.name}</td><td><a href="https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${v.celex}" target="_blank" rel="noopener">${v.act}</a></td><td class="num">${fmtDate(new Date(v.sub))}</td><td class="num">${A}</td><td class="num">${BC}</td><td class="num">${E}</td><td class="num">${W}</td><td class="num">${fmt(W / YEAR, 2)}</td></tr>`; }).join('');
  const tt = $('#val-tf tbody'); if (tt) tt.innerHTML = VALIDATION_TF.map(v => { const V = days(v.notif, v.fwd), L = days(v.fwd, v.ir), W = days(v.notif, v.ir); return `<tr><td>${v.name}</td><td><a href="https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${v.celex}" target="_blank" rel="noopener">${v.act}</a></td><td class="num">${fmtDate(new Date(v.notif))}</td><td class="num">${V}</td><td class="num">${L}</td><td class="num">${W}</td><td class="num">${fmt(W / MONTH, 1)}</td></tr>`; }).join('');
}
fillValidation();

function exportCSV() {
  const rows = MC.map((r, i) => [i + 1, r.route, r.outcome, Math.round(r.total), r.n, Math.round(r.stopDays), Math.round(r.active), Math.round(r.overrun), fmtDate(dateAt(r.total))]);
  downloadCSV('authorisation-timeline-runs.csv', ['run', 'route', 'outcome', 'total_days', 'clock_stops', 'clock_stop_days', 'efsa_active_days', 'efsa_overrun_days', 'end_date'], rows);
}

/* ------------------------------------------------------------ wiring */
let rt = 0;
ui.onChange((s, id) => {
  if (id === 'speed') { clock.speed = s.speed; return; }
  cancelAnimationFrame(rt); rt = requestAnimationFrame(() => { if (id !== 'N' && id !== 'start') makeRun(false); else drawGantt(); recompute(); });
});
clock.speed = ui.get('speed');
makeRun(true);
recompute();
if (reduceMotion) clock.pause();
