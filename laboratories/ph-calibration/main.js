/* pH electrode calibration — controller: electrode dynamics, meter logic, charts and the session log.
   Model: model.js (Eqs. PH1–PH6 in the Derive tab). Drawing: bench.js. */
import { PhBench } from './bench.js';
import { BUFFER_T, BUFFER_TABLE, BUFFER_KEYS, bufferPH, ELECTRODES, electrodeEq, TAU_T, SOLUTIONS, solutionState, STABILITY, calibrate, phFromE, clamp } from './model.js';
import { nernstSlope } from '/assets/js/physics.js';
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, linspace, downloadCSV } from '/assets/js/plot.js';
import { mulberry32, randn } from '/assets/js/stats.js';

const rnd = mulberry32(7310);
const gauss = () => randn(rnd);
const MODES = { '47': ['4.01', '7.00'], '710': ['7.00', '10.01'], '3': ['4.01', '7.00', '10.01'] };

/* ------------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
ui.section('Electrode condition');
ui.segmented({ id: 'elec', options: Object.entries(ELECTRODES).map(([value, e]) => ({ value, label: e.label.replace(' of use', '') })), value: 'new', help: 'Presets set the five properties below; fine-tune them with the sliders.' });
ui.slider({ id: 'eff', label: 'Slope efficiency η', min: 78, max: 103, step: 0.1, value: ELECTRODES.new.eff, unit: '%' });
ui.slider({ id: 'off', label: 'Offset (asymmetry) at pH 7', min: -50, max: 50, step: 0.5, value: ELECTRODES.new.off, unit: 'mV' });
ui.slider({ id: 'tau', label: 'Response time constant τ', min: 2, max: 120, step: 1, value: ELECTRODES.new.tau, unit: 's' });
ui.slider({ id: 'drift', label: 'Offset drift', min: 0, max: 6, step: 0.1, value: ELECTRODES.new.drift, unit: 'mV h⁻¹' });
ui.slider({ id: 'noise', label: 'Signal noise (rms)', min: 0, max: 0.5, step: 0.01, value: ELECTRODES.new.noise, unit: 'mV' });

ui.section('Temperatures');
ui.slider({ id: 'Tbuf', label: 'Buffers, rinse water and storage', min: 5, max: 40, step: 0.5, value: 20, unit: '°C', help: 'The meter accepts buffers between 5 and 40 °C.' });
ui.slider({ id: 'cpH', label: 'Your own sample: true pH', min: 2, max: 12, step: 0.01, value: 5.5 });
ui.slider({ id: 'cT', label: 'Your own sample: temperature', min: 2, max: 45, step: 0.5, value: 16, unit: '°C' });

ui.section('Meter settings');
ui.segmented({ id: 'mode', label: 'Calibration', options: [{ value: '47', label: '4.01 + 7.00' }, { value: '710', label: '7.00 + 10.01' }, { value: '3', label: '3-point' }], value: '47' });
ui.toggle({ id: 'atc', label: 'Automatic temperature compensation (ATC)', value: true });
ui.toggle({ id: 'bufTable', label: 'Use the buffers’ temperature table', value: true, help: 'Needs ATC; without it the meter assumes the 25 °C buffer values.' });
ui.segmented({ id: 'stab', label: 'Stability criterion', options: Object.entries(STABILITY).map(([value, s]) => ({ value, label: s.label })), value: 'medium' });

ui.section('Session');
ui.segmented({ id: 'speed', label: 'Clock', options: [{ value: 1, label: '1×' }, { value: 4, label: '4×' }, { value: 15, label: '15×' }], value: 4 });
ui.buttons([{ label: 'Wait 1 hour', onClick: () => waitHour(), title: 'The electrode rests in its storage solution for one hour (offset drift accumulates)' }, { label: 'Clear calibration', onClick: () => clearCal() }]);
ui.presets([
  { label: 'New electrode, 20 °C lab', values: { elec: 'new', Tbuf: 20, mode: '47', atc: true, bufTable: true, stab: 'medium' } },
  { label: 'Cold store at 10 °C', values: { elec: 'year', Tbuf: 10, mode: '3', atc: true, bufTable: true, stab: 'medium' } },
  { label: 'Aged electrode', values: { elec: 'aged', Tbuf: 22, mode: '3', atc: true, bufTable: true, stab: 'medium' } },
  { label: 'The 82 % electrode', values: { elec: 'failing', Tbuf: 22, mode: '47', atc: true, bufTable: true, stab: 'fast' } },
  { label: 'Summer lab, no ATC', values: { elec: 'year', Tbuf: 32, mode: '47', atc: false, bufTable: false, stab: 'medium' } }
]);
ui.saveButton('ph-calibration', () => ro.values());

/* ------------------------------------------------------------------ readouts */
const ro = new Readouts('#readouts');
ro.add({ id: 'E', label: 'Electrode potential', unit: 'mV', digits: 1 })
  .add({ id: 'pH', label: 'Displayed pH', unit: '', digits: 2 })
  .add({ id: 'T', label: 'Probe temperature', unit: '°C', digits: 1 })
  .add({ id: 'st', label: 'Stability', unit: '', format: v => v })
  .add({ id: 'slope', label: 'Calibrated slope', unit: '%', digits: 1 })
  .add({ id: 'offset', label: 'Calibrated offset', unit: 'mV', digits: 1 })
  .add({ id: 'diag', label: 'Electrode diagnosis', unit: '', format: v => v })
  .add({ id: 'err', label: 'Last sample: error of the displayed pH', unit: 'pH', format: v => v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(3) });

/* ------------------------------------------------------------------ bench */
const stageEl = document.getElementById('stage');
const bench = new PhBench(stageEl, { onBeaker: id => dip(id), onButton: id => ({ cal: recordCal, read: recordRead, clr: clearCal })[id]() });
const hud = hudChips(stageEl);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = bench.cv.toDataURL('image/png'); a.download = 'ph-calibration.png'; a.click(); } });

/* ------------------------------------------------------------------ simulation state */
const P = () => ui.values();
const sim = {
  t: 0, tWait: 0,                       // simulated seconds (clock + waited hours)
  E: electrodeEq(7.0, 20, ELECTRODES.new.eff, ELECTRODES.new.off), Tel: 20,
  Ed: 0, hist: [], tImm: 0, resp: [], Eeq: 0, stable: false, stableAt: null,
  cal: null, calPts: {}, lastCalRes: null, lastCalT: null, msg: 'Electrode in storage solution. Rinse, then dip it in the first buffer.',
  log: [], checks: [], lastErr: null, rinsed: true
};
sim.Ed = sim.E;
const hours = () => (sim.t + sim.tWait) / 3600;
function dip(id) {
  const from = bench.at;
  const d = bench.moveTo(id); if (!d) return;
  sim.rinsed = from === 'rinse';            // good practice: rinse between every two solutions
  sim.msg = `Moving to ${SOLUTIONS[id].label.toLowerCase()}…`;
}
function currentSolution() { return bench.at; }
function stabilityOK(crit) {
  const now = sim.t, h = sim.hist;
  if (!bench.at) return false;
  return STABILITY[crit].rules.some(([d, w]) => {
    if (now - sim.tImm < w) return false;
    let mn = Infinity, mx = -Infinity;
    for (let i = h.length - 1; i >= 0 && h[i].t >= now - w; i--) { mn = Math.min(mn, h[i].E); mx = Math.max(mx, h[i].E); }
    return mx - mn <= d;
  });
}
let lastAt = bench.at, histAcc = 0;
const clock = new SimClock({
  speed: 4, maxDt: 0.1,
  onStep(dt) {
    const s = P();
    sim.t += dt;
    if (bench.at !== lastAt) { lastAt = bench.at; if (bench.at) { sim.tImm = sim.t; sim.resp = []; sim.stableAt = null; sim.hist = []; } }
    const id = bench.at, S = id ? SOLUTIONS[id] : null;
    const sol = id ? solutionState(id, s) : null;
    const Tsol = sol ? sol.T : s.Tbuf;
    sim.Tel += (Tsol - sim.Tel) * (1 - Math.exp(-dt / TAU_T));
    const off = s.off + s.drift * hours();
    let noise = s.noise;
    if (sol) {
      sim.Eeq = electrodeEq(sol.pH, sim.Tel, s.eff, off);
      const tau = s.tau * (S.slow || 1);
      sim.E += (sim.Eeq - sim.E) * (1 - Math.exp(-dt / tau));
      noise *= (S.noisy || 1);
    } else { sim.E += gauss() * 6 * Math.sqrt(dt); sim.E = clamp(sim.E, -450, 450); noise = 1.5; }
    const Em = sim.E + noise * Math.sqrt(0.1 / dt) * gauss();   // white noise: 'noise' is the rms of 10 Hz readings, independent of the step
    sim.Ed += (Em - sim.Ed) * (1 - Math.exp(-dt / 0.7));     // meter input filter (assumed 0.7 s)
    histAcc += dt;
    if (histAcc >= 0.1) {
      histAcc = 0; sim.hist.push({ t: sim.t, E: sim.Ed }); while (sim.hist.length > 400) sim.hist.shift();
      if (bench.at) { // response record: dense at first, sparser later
        const ti = sim.t - sim.tImm, lastT = sim.resp.length ? sim.resp[sim.resp.length - 1][0] : -1;
        const every = ti < 30 ? 0.1 : ti < 120 ? 0.5 : ti < 900 ? 2 : 10;
        if (ti - lastT >= every - 1e-9) sim.resp.push([ti, sim.Ed]);
        if (sim.resp.length > 3000) sim.resp.splice(1, 1);
      }
    }
    sim.stable = stabilityOK(s.stab);
    if (sim.stable && sim.stableAt == null) sim.stableAt = sim.t - sim.tImm;
  },
  onFrame() {}
});

/* ------------------------------------------------------------------ meter actions */
function pHused(key, s) { return s.atc && s.bufTable ? bufferPH(key, sim.Tel) : bufferPH(key, 25); }
function recordCal() {
  const s = P(), id = currentSolution();
  if (!id || SOLUTIONS[id].kind !== 'buffer') { sim.msg = 'CAL: dip the electrode in a buffer first.'; toast(sim.msg); return; }
  const key = SOLUTIONS[id].key, need = MODES[s.mode];
  if (!need.includes(key)) { sim.msg = `pH ${key} is not part of the ${s.mode === '3' ? '3-point' : need.join(' + ')} calibration.`; toast(sim.msg); return; }
  const pt = { key, pH: pHused(key, s), E: sim.Ed, T: s.atc ? sim.Tel : 25, stable: sim.stable, tImm: sim.t - sim.tImm, rinsed: sim.rinsed };
  sim.calPts[key] = pt;
  addLog({ kind: 'cal', sol: `Buffer ${key}`, T: sim.Tel, truePH: bufferPH(key, solutionState(id, s).T), E: sim.Ed, shown: pt.pH, stable: sim.stable, note: `calibration point${sim.stable ? '' : ' — recorded before stable!'}${sim.rinsed ? '' : ' · not rinsed'}` });
  const have = need.filter(k => sim.calPts[k]);
  if (have.length === need.length) {
    const res = calibrate(need.map(k => sim.calPts[k]));
    res.pts = need.map(k => sim.calPts[k]);
    sim.lastCalRes = res;
    if (res.eff < 85 || res.eff > 110) { sim.msg = `Err 6 — slope ${fmt(res.eff, 1)} % out of range: calibration not accepted.`; }
    else { sim.cal = res; sim.lastCalT = hours(); sim.msg = `Calibration done: slope ${fmt(res.eff, 1)} %, offset ${res.off >= 0 ? '+' : ''}${fmt(res.off, 1)} mV.`; }
    addLog({ kind: 'calres', sol: `${res.n}-point calibration`, T: res.Tcal, E: null, shown: null, note: `${fmt(res.eff, 1)} % · ${res.off >= 0 ? '+' : ''}${fmt(res.off, 1)} mV · ${res.diag.text}` });
    sim.calPts = {};
  } else sim.msg = `Recorded pH ${key} (${fmt(pt.pH, 2)} at ${fmt(sim.Tel, 1)} °C). Next: ${need.filter(k => !sim.calPts[k]).map(k => 'pH ' + k).join(', ')}.`;
  toast(sim.msg); drawCharts(); updateDone();
}
function recordRead() {
  const s = P(), id = currentSolution();
  if (!id || SOLUTIONS[id].kind === 'store' || SOLUTIONS[id].kind === 'rinse') { sim.msg = 'READ: dip the electrode in a sample or a buffer.'; toast(sim.msg); return; }
  const sol = solutionState(id, s);
  const withATC = phFromE(sim.Ed, sim.cal, sim.Tel, true), noATC = phFromE(sim.Ed, sim.cal, sim.Tel, false);
  const shown = s.atc ? withATC : noATC;
  sim.lastErr = shown - sol.pH;
  addLog({ kind: 'read', sol: SOLUTIONS[id].label, T: sim.Tel, truePH: sol.pH, E: sim.Ed, shown, atc: withATC, noatc: noATC, stable: sim.stable, note: (sim.cal ? '' : 'uncalibrated · ') + (sim.stable ? '' : 'not stable · ') + (sim.rinsed ? '' : 'not rinsed') });
  if (SOLUTIONS[id].kind === 'buffer' && sim.cal) sim.checks.push({ pH: sol.pH, dE: sim.Ed - (sim.cal.a + sim.cal.S * pHused(SOLUTIONS[id].key, s)), h: hours() });
  else if (SOLUTIONS[id].kind === 'sample') sim.samples.push({ pH: sol.pH, E: sim.Ed });
  sim.msg = `${SOLUTIONS[id].short}: pH ${fmt(shown, 2)} (true ${fmt(sol.pH, 2)} at ${fmt(sol.T, 1)} °C).`;
  toast(sim.msg); drawCharts(); updateDone();
}
sim.samples = [];
function clearCal() { sim.cal = null; sim.calPts = {}; sim.lastCalRes = null; sim.msg = 'Calibration cleared — the meter now assumes 100 % slope and 0 mV offset.'; toast(sim.msg); drawCharts(); updateDone(); }
function waitHour() { sim.tWait += 3600; sim.msg = 'One hour later (electrode stored in KCl).'; toast(sim.msg); addLog({ kind: 'wait', sol: '— 1 h wait —', note: `offset has drifted by ${fmt(P().drift, 1)} mV` }); }
function toast(m) { if (window.FFP && FFP.toast) FFP.toast(m); }

/* ------------------------------------------------------------------ session log */
const logBody = document.querySelector('#ph-log tbody');
function addLog(r) { r.n = sim.log.length + 1; r.time = hours(); sim.log.push(r); renderLog(); }
function renderLog() {
  const f2 = v => v == null || !isFinite(v) ? '—' : fmt(v, 2), f1 = v => v == null || !isFinite(v) ? '—' : fmt(v, 1);
  logBody.innerHTML = sim.log.slice().reverse().slice(0, 40).map(r => {
    const err = r.kind === 'read' ? r.shown - r.truePH : null;
    const cls = err == null ? '' : Math.abs(err) <= 0.05 ? 'ok' : Math.abs(err) <= 0.15 ? 'warn' : 'bad';
    return `<tr class="${r.kind}"><td class="num">${r.n}</td><td class="num">${fmt(r.time * 60, 1)}</td><td>${r.sol}</td><td class="num">${f1(r.T)}</td><td class="num">${f2(r.truePH)}</td><td class="num">${f1(r.E)}</td><td class="num"><b>${f2(r.shown)}</b></td><td class="num">${f2(r.atc)}</td><td class="num">${f2(r.noatc)}</td><td class="num ${cls}">${err == null ? '—' : (err >= 0 ? '+' : '−') + Math.abs(err).toFixed(2)}</td><td class="note">${r.note || ''}</td></tr>`;
  }).join('') || '<tr><td colspan="11" class="muted">Nothing recorded yet. Dip the electrode in a buffer and press CAL.</td></tr>';
}
document.getElementById('ph-csv').addEventListener('click', () => downloadCSV('ph-calibration-log.csv', ['n', 'minutes', 'solution', 'T_C', 'true_pH', 'E_mV', 'displayed_pH', 'pH_ATC', 'pH_noATC', 'note'], sim.log.map(r => [r.n, (r.time * 60).toFixed(2), r.sol, r.T?.toFixed(2) ?? '', r.truePH?.toFixed(3) ?? '', r.E?.toFixed(2) ?? '', r.shown?.toFixed(3) ?? '', r.atc?.toFixed(3) ?? '', r.noatc?.toFixed(3) ?? '', r.note || ''])));
document.getElementById('ph-clear').addEventListener('click', () => { sim.log = []; sim.samples = []; sim.checks = []; renderLog(); drawCharts(); });
renderLog();

/* ------------------------------------------------------------------ charts */
const mvPlot = new Plot('#chart-mv', { x: { label: 'pH', min: 2, max: 12 }, y: { label: 'Electrode potential', unit: 'mV', min: -330, max: 330 }, legend: true });
const resPlot = new Plot('#chart-res', { x: { label: 'pH', min: 2, max: 12 }, y: { label: 'Residual (measured − line)', unit: 'mV' }, legend: true });
const respPlot = new Plot('#chart-resp', { x: { label: 'Time since immersion', unit: 's', min: 0 }, y: { label: 'Displayed potential', unit: 'mV' }, legend: true });
const bufPlot = new Plot('#chart-buf', { x: { label: 'Buffer temperature', unit: '°C', min: 5, max: 40 }, y: { label: 'pH − label value', unit: 'pH' }, legend: true });
function drawCharts() {
  const s = P(), xs = linspace(0, 14, 57);
  [[5, 'water', [6, 4]], [25, 'muted', [2, 3]], [45, 'amber', [6, 4]]].forEach(([T, c, dash]) => mvPlot.line('n' + T, xs, xs.map(x => -nernstSlope(T) * (x - 7)), { color: c, dash, width: 1.4, label: `Ideal, ${T} °C (${fmt(nernstSlope(T), 2)} mV pH⁻¹)` }));
  mvPlot.line('true', xs, xs.map(x => electrodeEq(x, s.Tbuf, s.eff, s.off + s.drift * hours())), { color: 'ink', width: 1, opacity: 0.35, label: 'This electrode at buffer temperature' });
  const cal = sim.lastCalRes;
  if (cal) {
    const rej = cal.eff < 85 || cal.eff > 110;
    mvPlot.line('fit', xs, xs.map(x => cal.a + cal.S * x), { color: rej ? 'danger' : 'accent', width: 2.4, dash: rej ? [8, 5] : null, label: `${rej ? 'Rejected calibration' : 'Calibration line'} (${fmt(cal.eff, 1)} %, ${cal.off >= 0 ? '+' : ''}${fmt(cal.off, 1)} mV)` });
  } else mvPlot.remove('fit');
  const cpts = (cal ? cal.pts : []).concat(Object.values(sim.calPts));
  mvPlot.scatter('cp', cpts.map(p => p.pH), cpts.map(p => p.E), { color: 'accent', r: 5, label: 'Calibration points', shape: 'square' });
  mvPlot.scatter('sp', sim.samples.map(o => o.pH), sim.samples.map(o => o.E), { color: 'magenta', r: 4.5, label: 'Samples (at true pH)' });
  // residuals
  if (cal && cal.n >= 2) resPlot.scatter('r', cal.pts.map(p => p.pH), cal.resid, { color: 'accent', r: 5.5, shape: 'square', label: `Residuals of the ${cal.n}-point fit` });
  else resPlot.remove('r');
  resPlot.scatter('chk', sim.checks.map(c => c.pH), sim.checks.map(c => c.dE), { color: 'danger', r: 5, shape: 'diamond', label: 'Buffer re-checks (READ in a buffer)' });
  resPlot.hline('z', 0, { color: 'muted', dash: [3, 3] });
  resPlot.hregion('band', -0.59, 0.59, { color: 'accent', alpha: 0.08, label: '±0.01 pH' });
  // buffers vs temperature
  BUFFER_KEYS.forEach((k, i) => bufPlot.line('b' + k, BUFFER_T, BUFFER_TABLE[k].map(v => v - +k), { color: ['danger', 'accent', 'water'][i], width: 2.2, label: `pH ${k}` }));
  BUFFER_KEYS.forEach((k, i) => bufPlot.point('p' + k, s.Tbuf, bufferPH(k, s.Tbuf) - +k, { color: ['danger', 'accent', 'water'][i], r: 4.5 }));
  bufPlot.vline('now', s.Tbuf, { color: 'magenta', label: `${fmt(s.Tbuf, 1)} °C` });
}
function drawResponse() {
  if (!sim.resp.length) return;
  const s = P(), id = bench.at; if (!id) return;
  const S = SOLUTIONS[id], tau = s.tau * (S.slow || 1);
  const t = sim.resp.map(p => p[0]), E = sim.resp.map(p => p[1]);
  respPlot.line('E', t, E, { color: 'accent', width: 2, label: 'Displayed potential' });
  respPlot.hline('eq', sim.Eeq, { color: 'muted', dash: [5, 4], label: 'equilibrium' });
  if (sim.stableAt != null) respPlot.vline('st', sim.stableAt, { color: 'amber', label: `stable after ${fmt(sim.stableAt, 0)} s` }); else respPlot.remove('st');
  respPlot.vline('tau', tau, { color: 'magenta', dash: [2, 3], label: `τ = ${fmt(tau, 0)} s` });
  respPlot.setAxis('x', { min: 0, max: Math.max(20, t[t.length - 1]) });
}

/* ------------------------------------------------------------------ per-frame UI */
let last = performance.now(), chartT = 0;
function frame(now) {
  const dtR = Math.min(0.1, (now - last) / 1000); last = now;
  bench.update(dtR);
  const s = P(), id = bench.at;
  const shownPH = phFromE(sim.Ed, sim.cal, sim.Tel, s.atc);
  const temps = {}; Object.keys(SOLUTIONS).forEach(k => temps[k] = solutionState(k, s).T);
  const calTxt = sim.cal ? `CAL ${sim.cal.n}P ${fmt(sim.cal.eff, 1)}% ${sim.cal.off >= 0 ? '+' : ''}${fmt(sim.cal.off, 1)}mV` : 'NO CAL';
  const main = (shownPH < 0 ? '-' : '') + Math.min(99.99, Math.abs(shownPH)).toFixed(2);
  bench.draw({
    temps, done: doneMap,
    display: { main, unit: 'pH', mv: `${sim.Ed >= 0 ? '+' : ''}${sim.Ed.toFixed(1)} mV`, temp: `${sim.Tel.toFixed(1)} °C ${s.atc ? 'ATC' : 'MTC'}`, mode: `pH · ${STABILITY[s.stab].label.toUpperCase()}`, cal: calTxt, stable: sim.stable, blink: Math.floor(now / 400) % 2 === 0, msg: sim.msg.length > 44 ? sim.msg.slice(0, 43) + '…' : sim.msg }
  });
  chartT += dtR;
  if (chartT > 0.25) {
    chartT = 0; drawResponse();
    ro.set('E', sim.Ed, null, id ? `equilibrium ${fmt(sim.Eeq, 1)} mV` : 'electrode in the air');
    const sol = id ? solutionState(id, s) : null;
    ro.set('pH', shownPH, null, sol && SOLUTIONS[id].kind !== 'store' ? `true pH ${fmt(sol.pH, 2)} at ${fmt(sol.T, 1)} °C` : '');
    ro.set('T', sim.Tel, Math.abs(sim.Tel - (sol ? sol.T : s.Tbuf)) > 0.3 ? 'warn' : null, sol ? `solution ${fmt(sol.T, 1)} °C` : '');
    ro.set('st', !id ? 'in the air' : sim.stable ? 'stable ✓' : 'settling…', !id ? 'bad' : sim.stable ? 'ok' : 'warn', id ? `${fmt(sim.t - sim.tImm, 0)} s since immersion` : '');
    const c = sim.lastCalRes;
    ro.set('slope', c ? c.eff : NaN, c ? (c.eff >= 95 && c.eff <= 105 ? 'ok' : c.eff >= 90 ? 'warn' : 'bad') : null, c ? `${fmt(-c.S, 2)} mV pH⁻¹ at ${fmt(c.Tcal, 1)} °C` : 'not calibrated');
    ro.set('offset', c ? c.off : NaN, c ? (Math.abs(c.off) <= 20 ? 'ok' : Math.abs(c.off) < 35 ? 'warn' : 'bad') : null, c ? 'potential at pH 7' : '');
    ro.set('diag', c ? c.diag.short : '—', c ? c.diag.level : null, c ? c.diag.text : 'record the buffers of the chosen calibration');
    ro.set('err', sim.lastErr, sim.lastErr == null ? null : Math.abs(sim.lastErr) <= 0.05 ? 'ok' : Math.abs(sim.lastErr) <= 0.15 ? 'warn' : 'bad', 'target ±0.05 for nutrient solutions');
    hud.set('t', `session <b>${fmt(hours() * 60, 1)}</b> min · ×${s.speed}`);
    hud.set('c', sim.cal ? `slope <b>${fmt(sim.cal.eff, 1)} %</b> · offset <b>${sim.cal.off >= 0 ? '+' : ''}${fmt(sim.cal.off, 1)} mV</b>` : 'not calibrated');
  }
  requestAnimationFrame(frame);
}
let doneMap = {};
function updateDone() { doneMap = {}; Object.values(sim.calPts).forEach(p => { const id = Object.keys(SOLUTIONS).find(k => SOLUTIONS[k].key === p.key); if (id) doneMap[id] = true; }); }

/* ------------------------------------------------------------------ wiring */
ui.onChange((state, id) => {
  if (id === 'elec') { const e = ELECTRODES[state.elec]; ui.setMany({ eff: e.eff, off: e.off, tau: e.tau, drift: e.drift, noise: e.noise }); }
  if (id === 'speed') clock.speed = +state.speed;
  if (id === 'mode') { sim.calPts = {}; updateDone(); }
  drawCharts();
});
clock.speed = +ui.get('speed');
drawCharts();
clock.play();
requestAnimationFrame(frame);
window.__ph = { sim, ui, bench, dip, recordCal, recordRead, clock };
