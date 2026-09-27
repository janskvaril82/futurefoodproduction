/* Climate controller tuning — UI, live simulation, charts and 3D coupling.
   Model and controllers: ./model.js (see the Derive tab, Eqs. C1–C10). 3D chamber: ./scene.js. */
import { createStage } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot } from '/assets/js/plot.js';
import { resolveColor } from '/assets/js/colors.js';
import * as CM from './model.js';
import { buildChamber } from './scene.js';

const TYPES = ['onoff', 'p', 'pi', 'pid', 'mpc'];
const LABEL = { onoff: 'On/off', p: 'P', pi: 'PI', pid: 'PID', mpc: 'MPC' };
const COLOR = { onoff: 'c3', p: 'c4', pi: 'c0', pid: 'c1', mpc: 'c2' };
const TEND = CM.SC.tEnd;
const kw = W => fmt(Math.abs(W) < 1 ? 0 : W / 1000, 2);

/* ================================================================ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'ta', label: 'Air temperature (true)', unit: '°C', digits: 2 })
  .add({ id: 'sp', label: 'Set-point', unit: '°C', digits: 1 })
  .add({ id: 'rh', label: 'Relative humidity', unit: '%', digits: 0 })
  .add({ id: 'u', label: 'Controller output', unit: '%', digits: 0 })
  .add({ id: 'pow', label: 'Heating (+) / cooling (−)', unit: 'kW', digits: 2 })
  .add({ id: 'iae', label: 'IAE so far', unit: '°C h', digits: 3, format: v => (isFinite(v) && Math.abs(v) < 0.0005) ? '0.000' : fmt(v, 3) })
  .add({ id: 'ov', label: 'Overshoot after the step', unit: '°C', digits: 2 })
  .add({ id: 'settle', label: 'Settling time (±0.3 °C)', unit: 'min', digits: 1 })
  .add({ id: 'sw', label: 'Actuator starts', unit: '', digits: 0 })
  .add({ id: 'kwh', label: 'Electricity (heater + compressor)', unit: 'kWh', digits: 2 });

ui.section('Controller');
ui.segmented({ id: 'ctrl', label: 'Algorithm', options: TYPES.map(t => ({ value: t, label: LABEL[t] })), value: 'pi', help: 'Output u from −100 % (full cooling) to +100 % (full heating), split range.' });
ui.slider({ id: 'h', label: 'Hysteresis half-width h', min: 0.1, max: 2.5, step: 0.05, value: 0.5, unit: '°C', help: 'Heat on below r − h, cool on above r + h; each stage switches off at r.' });
ui.slider({ id: 'pKc', label: 'Gain K<sub>c</sub>', min: 1, max: 120, step: 1, value: 30, unit: '% °C⁻¹' });
ui.slider({ id: 'pBias', label: 'Manual reset (bias) u₀', min: -50, max: 50, step: 1, value: 0, unit: '%', help: 'A P controller needs the right bias to reach the set-point.' });
ui.slider({ id: 'piKc', label: 'Gain K<sub>c</sub>', min: 1, max: 120, step: 0.5, value: 25, unit: '% °C⁻¹' });
ui.slider({ id: 'piTi', label: 'Integral time T<sub>i</sub>', min: 20, max: 2000, value: 240, unit: 's', log: true, digits: 0 });
ui.slider({ id: 'pidKc', label: 'Gain K<sub>c</sub>', min: 1, max: 120, step: 0.5, value: 35, unit: '% °C⁻¹' });
ui.slider({ id: 'pidTi', label: 'Integral time T<sub>i</sub>', min: 20, max: 2000, value: 180, unit: 's', log: true, digits: 0 });
ui.slider({ id: 'pidTd', label: 'Derivative time T<sub>d</sub>', min: 0, max: 120, step: 1, value: 15, unit: 's' });
ui.slider({ id: 'pidN', label: 'Derivative filter N', min: 2, max: 20, step: 1, value: 5, help: 'Filter time constant T<sub>d</sub>/N; large N passes more sensor noise.' });
ui.toggle({ id: 'aw', label: 'Anti-windup (back-calculation)', value: true });
ui.slider({ id: 'mpcN', label: 'Prediction horizon N', min: 5, max: 45, step: 1, value: 30, format: v => `${v} × 20 s = ${fmt(v / 3, 1)} min` });
ui.slider({ id: 'mpcWE', label: 'Energy weight w<sub>E</sub>', min: 0, max: 3, step: 0.05, value: 0.05, unit: '°C² h kWh⁻¹', help: 'How many °C²·h of tracking error one kWh is worth.' });
ui.slider({ id: 'mpcWD', label: 'Move suppression w<sub>Δ</sub>', min: 0, max: 0.2, step: 0.005, value: 0.02, digits: 3 });
ui.slider({ id: 'mpcScale', label: 'Model error: heat capacities × ', min: 0.5, max: 2, step: 0.05, value: 1, help: 'The MPC’s internal model uses scaled heat capacities (1 = perfect model).' });

ui.section('Chamber & sensor');
ui.slider({ id: 'theta', label: 'Transport dead time θ', min: 0, max: 120, step: 2, value: 20, unit: 's' });
ui.slider({ id: 'tauS', label: 'Sensor time constant τ<sub>s</sub>', min: 2, max: 120, step: 1, value: 20, unit: 's' });
ui.slider({ id: 'sigma', label: 'Sensor noise σ', min: 0, max: 0.2, step: 0.005, value: 0.03, unit: '°C', digits: 3 });
ui.slider({ id: 'Ph', label: 'Heater power', min: 1, max: 4, step: 0.1, value: 2, unit: 'kW' });

ui.section('Test-day disturbances');
ui.toggle({ id: 'dLights', label: 'LED lights on 60–200 min (650 W)', value: true });
ui.toggle({ id: 'dCorr', label: 'Corridor cools 20 → 10 °C at 100 min', value: true });
ui.toggle({ id: 'dDoor', label: 'Door open 150–152 min', value: true });
ui.toggle({ id: 'humLoop', label: 'Humidifier loop (RH 70 ± 3 %)', value: true });

ui.section('Run');
const runBtns = ui.buttons([
  { label: 'Play', variant: 'primary', onClick: () => clock.toggle() },
  { label: 'Reset', onClick: () => restart() },
  { label: 'Open door now', onClick: () => { if (live && !live.done) { live.opt.extraDoors.push(live.t); live.modified = true; } } }
]);
ui.segmented({ id: 'speed', label: 'Speed (simulated seconds per second)', options: [{ value: 30, label: '30×' }, { value: 120, label: '120×' }, { value: 480, label: '480×' }], value: 120, persist: false });
ui.segmented({ id: 'view', label: 'Charts show', options: [{ value: 'live', label: 'Live run' }, { value: 'step', label: 'Step test' }, { value: 'relay', label: 'Relay test' }], value: 'live', persist: false });
ui.toggle({ id: 'labels', label: 'Labels in the 3D view', value: true, persist: false });

ui.section('Ziegler–Nichols tuning');
ui.buttons([
  { label: 'Step test', onClick: () => runStepTest(), title: 'Open-loop reaction curve: step the output by +40 % from steady state' },
  { label: 'Relay test (K<sub>u</sub>)', onClick: () => runRelayTest(), title: 'Relay feedback test to find the ultimate gain and period' }
]);
const tuneBox = ui.html('<div class="tune-box" id="tune-box"><p class="ctl-help">Run a test to identify the process and compute Ziegler–Nichols settings.</p></div>');

ui.section('Compare');
const cmpBtn = ui.button({ label: 'Compare all five controllers', variant: 'primary', onClick: () => compareAll() });
ui.presets([
  { label: 'Out-of-the-box thermostat', values: { ctrl: 'onoff', h: 0.5 } },
  { label: 'Wide dead band', values: { ctrl: 'onoff', h: 1.5 } },
  { label: 'P only', values: { ctrl: 'p', pKc: 30, pBias: 0 } },
  { label: 'Well-tuned PI', values: { ctrl: 'pi', piKc: 25, piTi: 240, aw: true } },
  { label: 'Aggressive ZN PID', values: { ctrl: 'pid', pidKc: 65, pidTi: 120, pidTd: 30, pidN: 10 } },
  { label: 'Predictive (MPC)', values: { ctrl: 'mpc', mpcN: 30, mpcWE: 0.05, mpcWD: 0.02, mpcScale: 1 } },
  { label: 'Slow, lagging sensor', values: { tauS: 90, theta: 40 } }
]);
ui.saveButton('climate-controller', () => Object.assign({ controller: LABEL[ui.get('ctrl')] }, ro.values()));

const SHOW = { onoff: ['h'], p: ['pKc', 'pBias'], pi: ['piKc', 'piTi', 'aw'], pid: ['pidKc', 'pidTi', 'pidTd', 'pidN', 'aw'], mpc: ['mpcN', 'mpcWE', 'mpcWD', 'mpcScale'] };
function showRelevant() { const all = new Set(Object.values(SHOW).flat()); const cur = SHOW[ui.get('ctrl')]; all.forEach(id => ui.show(id, cur.includes(id))); }
showRelevant();

const prmFromUI = () => { const v = ui.values(); return { h: v.h, pKc: v.pKc, pBias: v.pBias, piKc: v.piKc, piTi: v.piTi, pidKc: v.pidKc, pidTi: v.pidTi, pidTd: v.pidTd, pidN: v.pidN, aw: v.aw, mpcN: v.mpcN, mpcWE: v.mpcWE, mpcWD: v.mpcWD, mpcScale: v.mpcScale }; };
const paramsFromUI = () => { const v = ui.values(); return Object.assign({}, CM.P0, { theta: v.theta, tauS: v.tauS, sigma: v.sigma, Ph: v.Ph * 1000 }); };
const scenarioOpt = () => { const v = ui.values(); return { lights: v.dLights, corridor: v.dCorr, door: v.dDoor, humLoop: v.humLoop, extraDoors: [] }; };

/* ================================================================ 3D */
const stage = createStage('#stage', {
  background: '#0b0f0e', envIntensity: 0.3, exposure: 1.0,
  camera: { pos: [1.2, 1.62, 4.3], target: [-0.05, 1.12, -0.25], fov: 44 },
  controls: { minDistance: 0.8, maxDistance: 6.8, minAzimuthAngle: -0.8, maxAzimuthAngle: 0.85, maxPolarAngle: 1.52, minPolarAngle: 0.2 },
  bloom: { strength: 0.45, radius: 0.35, threshold: 1.0 }, ao: { radius: 0.2, intensity: 0.85 }
});
const H = buildChamber(stage);
const hud = hudChips(stage.el);
const info = document.createElement('div'); info.className = 'stage-legend cc-info'; info.style.display = 'none'; stage.el.appendChild(info);
const lab = {
  heater: stage.addLabel(H.heater.group, '', { offset: [0, 0.3, 0.12] }),
  evap: stage.addLabel(H.evap.group, '', { offset: [0.95, 0.05, 0.25] }),
  hum: stage.addLabel(H.hum.group, '', { offset: [0.05, 0.95, 0.1] }),
  sensor: stage.addLabel(H.sensor.group, '', { offset: [0, 1.56, 0] }),
  door: stage.addLabel([CM.P0.L / -2 + 0.02, 2.2, 0.4], ''),
  rack: stage.addLabel([-1.0, 1.72, -0.6], '')
};
const PART_INFO = {
  heater: () => `<b>Electric heater</b> · open-coil, ${fmt(P.Ph / 1000, 1)} kW. Element time constant τ<sub>h</sub> = ${P.tauH} s: the coils glow only near full power (≈ 600 °C).<br>Delivered heat <b>${fmt(live.plant.Qh / 1000, 2)} kW</b> · electricity used ${fmt(live.plant.E.heat / 3.6e6, 2)} kWh.`,
  evap: () => `<b>Evaporator (unit cooler)</b> · ${fmt(P.Qc / 1000, 1)} kW total, COP ${P.COP}, τ<sub>c</sub> = ${P.tauC} s. Part of its capacity condenses water (dehumidifies).<br>Cooling <b>${fmt(live.plant.Qc / 1000, 2)} kW</b> · compressor electricity ${fmt(live.plant.E.cool / 3.6e6, 2)} kWh.`,
  hum: () => `<b>Ultrasonic humidifier</b> · ${P.Hum} kg h⁻¹, on below ${CM.SC.RHset - CM.SC.RHband} % RH, off above ${CM.SC.RHset + CM.SC.RHband} %. Evaporating mist takes ${fmt(P.Hum / 3600 * P.lambda, 0)} W of sensible heat from the air.<br>Now: <b>${live.plant.hum ? 'ON' : 'off'}</b> · RH ${fmt(live.plant.rh, 0)} %.`,
  sensor: () => `<b>Aspirated PT1000 sensor</b> · time constant τ<sub>s</sub> = ${P.tauS} s, noise σ = ${P.sigma} °C, resolution 0.01 °C.<br>Reads <b>${fmt(live.y, 2)} °C</b> while the air is at ${fmt(live.plant.Ta, 2)} °C.`,
  door: () => `<b>Insulated door with window</b> · 0.9 × 2.0 m. When open, warm and cold air swap by buoyancy: ${fmt((live.plant.Vdoor || 0) * 1000, 0)} L s⁻¹ now (Eq. C3).`,
  rack: () => `<b>Growing rack</b> · 3 tiers × 14 lettuces under ${CM.P0.Pled} W of LEDs. About ${fmt(CM.P0.Etr * CM.P0.lambda / 3600, 0)} W of the lamp power leaves as latent heat through transpiration; the rest heats air and surfaces.`
};
let selected = null;
stage.onPick({
  objects: () => H.parts.map(p => p.obj),
  onClick: hit => {
    if (!hit) { selected = null; info.style.display = 'none'; return; }
    let o = hit.object; const part = H.parts.find(p => { let q = o; while (q) { if (q === p.obj) return true; q = q.parent; } return false; });
    if (!part) return; selected = part.id; stage.flyTo(part.cam[0], part.cam[1], 1.3); info.style.display = ''; updateInfo();
  }
});
function updateInfo() { if (selected && live) info.innerHTML = PART_INFO[selected]() + '<br><small style="opacity:.7">Click empty space to close · reset view with ⟲</small>'; }
stage.onKey('space', () => clock.toggle());

/* ================================================================ live simulation */
let P = paramsFromUI();
let live = null;
function newLive() {
  P = paramsFromUI();
  const opt = scenarioOpt(); const type = ui.get('ctrl');
  const plant = CM.makePlant(P, CM.SC.r0, opt);
  const ctrl = CM.makeController(type, prmFromUI(), P, opt, plant);
  live = { plant, ctrl, type, opt, rng: CM.mulberry(11), M: new CM.Metrics(), hist: [], t: 0, u: type === 'onoff' ? 0 : plant.u0, y: plant.Ts, acc: 0, modified: false, done: false, sc: CM.scenario(0, opt) };
  pushHist();
}
function pushHist() {
  const p = live.plant, sc = CM.scenario(live.t, live.opt);
  live.hist.push({ t: live.t / 60, Ta: p.Ta, y: live.y, r: sc.r, Tm: p.Tm, Tc: sc.Tc, u: live.u, rh: p.rh ?? CM.rhFromW(p.Ta, p.W), Eh: p.E.heat / 3.6e6, Ec: p.E.cool / 3.6e6 });
}
function stepOne() {
  const t = live.t; const sc = CM.scenario(t, live.opt);
  if (t % 2 === 0) { live.y = Math.round((live.plant.Ts + P.sigma * CM.gauss(live.rng)) * 100) / 100; live.u = live.ctrl.step(live.y, sc.r, t, sc.Tc); }
  CM.plantStep(live.plant, live.u, 1, P, { lights: sc.lights, Tc: sc.Tc, door: sc.door, humLoop: live.opt.humLoop });
  live.t = t + 1; live.sc = sc;
  live.M.update(live.t, 1, live.plant.Ta, CM.scenario(live.t, live.opt).r, live.u);
  if (live.t % 10 === 0) pushHist();
}
const clock = new SimClock({
  speed: +ui.get('speed'),
  onStep: dt => {
    if (!live || live.done) return;
    live.acc += dt; let n = 0;
    while (live.acc >= 1 && live.t < TEND && n < 6000) { stepOne(); live.acc -= 1; n++; }
    if (live.t >= TEND) finish();
  }
});
clock.onState(run => { runBtns[0].innerHTML = run ? 'Pause' : (live && live.done ? 'Replay' : 'Play'); });
function finish() {
  live.done = true; clock.pause(); drawAll(); updateReadouts();
  if (window.FFP && FFP.toast) FFP.toast(`Test day complete — ${LABEL[live.type]}: IAE ${fmt(live.M.iae, 3)} °C h, ${fmt(live.plant.E.heat / 3.6e6 + live.plant.E.cool / 3.6e6, 2)} kWh`);
}
function restart() { const was = clock.running; clock.pause(); newLive(); drawAll(); updateReadouts(); if (was) clock.play(); }
const origToggle = clock.toggle.bind(clock);
clock.toggle = () => { if (live && live.done) { newLive(); drawAll(); clock.play(); return; } origToggle(); };

/* ================================================================ charts */
const X = { label: 'Time', unit: 'min', min: 0, max: TEND / 60, format: v => fmt(v, 0) };
const pT = new Plot('#chart-temp', { x: X, y: { label: 'Temperature', unit: '°C' }, height: 290 });
const pU = new Plot('#chart-u', { x: X, y: { label: 'Output u', unit: '%', min: -100, max: 100 }, y2: { label: 'Relative humidity', unit: '%', min: 30, max: 100 }, height: 290 });
const pE = new Plot('#chart-energy', { x: X, y: { label: 'Electricity', unit: 'kWh', min: 0 }, height: 290 });
const pC = new Plot('#chart-compare', { x: { label: 'Integral of absolute error (IAE)', unit: '°C h', min: 0 }, y: { label: 'Electricity', unit: 'kWh', min: 0 }, crosshair: false, height: 260 });
const cmpTable = document.getElementById('compare-table');
let compare = null, tuning = { step: null, relay: null };

function eventRegions(plot, opt) {
  ['lights', 'door', 'corr'].forEach(k => plot.remove('ev-' + k));
  for (let i = 0; i < 12; i++) plot.remove('ev-x' + i);
  if (opt.lights) plot.region('ev-lights', CM.SC.tLightsOn / 60, CM.SC.tLightsOff / 60, { color: 'amber', alpha: 0.07, label: 'lights on', z: -2 });
  if (opt.door) plot.region('ev-door', CM.SC.tDoor / 60, (CM.SC.tDoor + CM.SC.doorDur) / 60, { color: 'danger', alpha: 0.22, label: 'door', z: -1 });
  if (opt.corridor) plot.region('ev-corr', CM.SC.tCorr0 / 60, CM.SC.tCorr1 / 60, { color: 'water', alpha: 0.12, z: -2 });
  (opt.extraDoors || []).slice(0, 12).forEach((t0, i) => plot.region('ev-x' + i, t0 / 60, (t0 + 60) / 60, { color: 'danger', alpha: 0.22, z: -1 }));
}
function drawLive() {
  const h = live.hist; const xs = h.map(o => o.t);
  pT.clear(); pU.clear();
  pT.setAxis('x', { min: 0, max: TEND / 60 }); pU.setAxis('x', { min: 0, max: TEND / 60 });
  pT.setAxis('y', { min: 'auto', max: 'auto' }); pU.setAxis('y', { min: -100, max: 100 });
  eventRegions(pT, live.opt); eventRegions(pU, live.opt);
  pT.line('sp', xs, h.map(o => o.r), { color: 'magenta', width: 1.6, label: 'Set-point', step: true });
  pT.line('tm', xs, h.map(o => o.Tm), { color: 'amber', width: 1.4, dash: [6, 4], label: 'Slow mass' });
  pT.line('y', xs, h.map(o => o.y), { color: 'water', width: 1, opacity: 0.8, label: 'Sensor reading' });
  pT.line('ta', xs, h.map(o => o.Ta), { color: 'accent', width: 2.3, label: 'Air (true)' });
  if (live.type === 'mpc' && live.ctrl.plan && !live.done) { const pl = live.ctrl.plan; pT.line('plan', pl.T.map((_, k) => (pl.t0 + (k + 1) * pl.dt) / 60), pl.T, { color: 'magenta', width: 2, dash: [3, 3], label: 'MPC prediction' }); }
  else pT.remove('plan');
  pT.vline('now', live.t / 60, { color: 'muted', dash: [2, 3] });
  pU.hline('zero', 0, { color: 'muted', dash: [1, 0], width: 0.8 });
  pU.line('heat', xs, h.map(o => Math.max(0, o.u)), { color: 'danger', width: 1.4, fill: 0.25, label: 'Heating', step: true });
  pU.line('cool', xs, h.map(o => Math.min(0, o.u)), { color: 'water', width: 1.4, fill: 0.25, label: 'Cooling', step: true });
  pU.line('rh', xs, h.map(o => o.rh), { color: 'muted', width: 1.3, y2: true, label: 'RH (right axis)' });
  pU.vline('now', live.t / 60, { color: 'muted', dash: [2, 3] });
  pE.line('eh', xs, h.map(o => o.Eh), { color: 'danger', width: 1.6, label: 'Heater' });
  pE.line('ec', xs, h.map(o => o.Ec), { color: 'water', width: 1.6, label: 'Compressor' });
  pE.line('et', xs, h.map(o => o.Eh + o.Ec), { color: 'accent', width: 2.4, label: `${LABEL[live.type]} (this run)` });
  TYPES.forEach(ty => { if (compare && compare[ty]) { const c = compare[ty].hist; pE.line('cmp-' + ty, c.map(o => o.t / 60), c.map(o => o.Eh + o.Ec), { color: COLOR[ty], width: 1.1, dash: [4, 3], label: LABEL[ty] }); } else pE.remove('cmp-' + ty); });
  pE.vline('now', live.t / 60, { color: 'muted', dash: [2, 3] });
}
function drawStep() {
  const st = tuning.step; if (!st) return;
  pT.clear(); pU.clear();
  const xs = st.t.map(t => t / 60); const xMax = xs[xs.length - 1];
  pT.setAxis('x', { min: 0, max: xMax }); pU.setAxis('x', { min: 0, max: xMax });
  pT.setAxis('y', { min: 'auto', max: 'auto' });
  pT.line('st-y', xs, st.y, { color: 'water', width: 1.3, label: 'Measured temperature' });
  const yMax = Math.max(...st.y); const tInt = st.t0 + st.L; const tEndTan = Math.min(st.t[st.t.length - 1], tInt + (yMax - st.y0) / st.slope);
  pT.line('tan', [tInt / 60, tEndTan / 60], [st.y0, st.y0 + st.slope * (tEndTan - tInt)], { color: 'magenta', width: 2, label: 'Steepest tangent' });
  pT.hline('y0', st.y0, { color: 'muted', dash: [4, 4] });
  pT.region('Lspan', st.t0 / 60, tInt / 60, { color: 'magenta', alpha: 0.14, label: `L = ${fmt(st.L, 0)} s` });
  pT.vline('step0', st.t0 / 60, { color: 'amber' });
  pT.text('lbl', xs[xs.length - 1] * 0.55, st.y0 + (st.y[st.y.length - 1] - st.y0) * 0.25, `R = ${fmt(st.slope * 60, 3)} °C min⁻¹ for Δu = ${st.du} %`, { color: 'ink', align: 'left' });
  pU.setAxis('y', { min: -100, max: 100 });
  pU.line('st-u', xs, st.u, { color: 'amber', width: 2, step: true, label: 'Output u (manual)' });
}
function drawRelay() {
  const rt = tuning.relay; if (!rt) return;
  pT.clear(); pU.clear();
  const xs = rt.t.map(t => t / 60); const xMax = xs[xs.length - 1];
  pT.setAxis('x', { min: 0, max: xMax }); pU.setAxis('x', { min: 0, max: xMax });
  pT.setAxis('y', { min: 'auto', max: 'auto' });
  pT.hregion('band', CM.SC.r1 - rt.eps, CM.SC.r1 + rt.eps, { color: 'magenta', alpha: 0.12 });
  pT.line('rel-y', xs, rt.y, { color: 'water', width: 1.3, label: 'Measured temperature' });
  if (rt.ok) { pT.region('win', rt.window[0] / 60, rt.window[1] / 60, { color: 'accent', alpha: 0.08, label: '3 cycles used' }); pT.text('lbl2', xs[0] + 1, (rt.mean ?? CM.SC.r1) + rt.a * 1.25, `a = ${fmt(rt.a, 3)} °C · Pu = ${fmt(rt.Pu, 0)} s · Ku = 4d/(π√(a²−ε²)) = ${fmt(rt.Ku, 1)} % °C⁻¹`, { color: 'ink', align: 'left' }); }
  pU.setAxis('y', { min: -100, max: 100 });
  pU.line('rel-u', xs, rt.u, { color: 'amber', width: 2, step: true, label: `Relay output u₀ ± ${rt.d} %` });
}
function drawCompare() {
  pC.clear();
  if (!compare) { pC.text('hint', 0.5, 0.5, 'Press “Compare all five controllers”', { color: 'muted', align: 'center' }); pC.setAxis('x', { min: 0, max: 1 }); pC.setAxis('y', { min: 0, max: 1 }); cmpTable.innerHTML = ''; return; }
  const iMax = Math.max(...TYPES.map(ty => compare[ty].metrics.iae)); pC.setAxis('x', { min: 0, max: iMax * 1.18 }); pC.setAxis('y', { min: 0, max: 'auto' });
  TYPES.forEach(ty => { const r = compare[ty]; pC.scatter('s-' + ty, [r.metrics.iae], [r.E.heat + r.E.cool], { color: COLOR[ty], r: 7, label: LABEL[ty] }); pC.text('t-' + ty, r.metrics.iae, r.E.heat + r.E.cool, LABEL[ty], { color: COLOR[ty], dx: 10, dy: -10 }); });
  const rows = TYPES.map(ty => { const r = compare[ty], m = r.metrics; return { ty, iae: m.iae, ov: m.ov, settle: m.settle, door: m.doorMax, rec: m.doorRec, sw: m.switches, e: r.E.heat + r.E.cool }; });
  const best = k => Math.min(...rows.map(r => isFinite(r[k]) ? r[k] : Infinity));
  const cell = (r, k, d, unit = '') => { const v = r[k]; const txt = isFinite(v) ? fmt(k === 'settle' || k === 'rec' ? v / 60 : v, d) + unit : 'never'; return `<td class="${v === best(k) ? 'best' : ''}">${txt}</td>`; };
  cmpTable.innerHTML = `<table><thead><tr><th></th><th>IAE<br>°C h</th><th>Overshoot<br>°C</th><th>Settling<br>min</th><th>Door dev.<br>°C</th><th>Door rec.<br>min</th><th>Starts<br>–</th><th>Energy<br>kWh</th></tr></thead><tbody>${rows.map(r => `<tr><td><i class="dot" style="background:${resolveColor(COLOR[r.ty])}"></i>${LABEL[r.ty]}</td>${cell(r, 'iae', 3)}${cell(r, 'ov', 2)}${cell(r, 'settle', 1)}${cell(r, 'door', 2)}${cell(r, 'rec', 1)}${cell(r, 'sw', 0)}${cell(r, 'e', 2)}</tr>`).join('')}</tbody></table><p class="cmp-note">Same 4-hour test day, same sensor-noise seed, current tuning of each controller. Green = best in the column. Settling: time after the 16 → 22 °C step until the air stays within ±0.3 °C.</p>`;
}
function drawAll() {
  const v = ui.get('view');
  if (v === 'step' && tuning.step) drawStep(); else if (v === 'relay' && tuning.relay) drawRelay(); else drawLive();
  if (v !== 'live') { /* keep energy live */ drawEnergyOnly(); }
  drawCompare();
}
function drawEnergyOnly() { const h = live.hist; const xs = h.map(o => o.t); pE.line('et', xs, h.map(o => o.Eh + o.Ec), { color: 'accent', width: 2.4, label: `${LABEL[live.type]} (this run)` }); }

/* ================================================================ tuning experiments */
function tuneHTML() {
  const rows = [];
  const zRow = (name, z) => `<tr><td>${name}</td><td>${fmt(z.pi.Kc, 1)} / ${fmt(z.pi.Ti, 0)}</td><td>${fmt(z.pid.Kc, 1)} / ${fmt(z.pid.Ti, 0)} / ${fmt(z.pid.Td, 0)}</td></tr>`;
  if (tuning.step) { const s = tuning.step; rows.push(`<p class="ctl-help">Reaction curve: slope R = ${fmt(s.R * 60 * 100, 2)} °C min⁻¹ per 100 %, apparent dead time L = ${fmt(s.L, 0)} s, a = R·L = ${fmt(s.a, 4)} °C %⁻¹.</p>`); }
  if (tuning.relay) { const r = tuning.relay; rows.push(r.ok ? `<p class="ctl-help">Relay (d = ${r.d} %): a = ${fmt(r.a, 3)} °C, K<sub>u</sub> = ${fmt(r.Ku, 1)} % °C⁻¹, P<sub>u</sub> = ${fmt(r.Pu, 0)} s. Linear model: K<sub>u</sub> = ${fmt(tuning.linH.Ku, 0)} (heating) / ${fmt(tuning.linC.Ku, 0)} (cooling), P<sub>u</sub> = ${fmt(tuning.linH.Pu, 0)} / ${fmt(tuning.linC.Pu, 0)} s.</p>` : '<p class="ctl-help">Relay test did not reach a stable oscillation.</p>'); }
  const tb = [];
  if (tuning.step) tb.push(zRow('Step (ZN 1942)', CM.znStep(tuning.step.R, tuning.step.L)));
  if (tuning.relay && tuning.relay.ok) tb.push(zRow('Relay (ZN ultimate)', CM.znUltimate(tuning.relay.Ku, tuning.relay.Pu)));
  if (tb.length) rows.push(`<table class="tune-t"><thead><tr><th>Rule</th><th>PI K<sub>c</sub>/T<sub>i</sub></th><th>PID K<sub>c</sub>/T<sub>i</sub>/T<sub>d</sub></th></tr></thead><tbody>${tb.join('')}</tbody></table>`);
  return rows.join('');
}
function renderTuning() {
  const box = document.getElementById('tune-box'); box.innerHTML = tuneHTML();
  const wrap = document.createElement('div'); wrap.className = 'ctl-buttons';
  const add = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm'; b.innerHTML = label; b.addEventListener('click', fn); wrap.appendChild(b); };
  if (tuning.step) { const z = CM.znStep(tuning.step.R, tuning.step.L); add('Apply step PI', () => ui.setMany({ ctrl: 'pi', piKc: +z.pi.Kc.toFixed(1), piTi: Math.round(z.pi.Ti) })); add('Apply step PID', () => ui.setMany({ ctrl: 'pid', pidKc: +z.pid.Kc.toFixed(1), pidTi: Math.round(z.pid.Ti), pidTd: Math.round(z.pid.Td) })); }
  if (tuning.relay && tuning.relay.ok) { const z = CM.znUltimate(tuning.relay.Ku, tuning.relay.Pu); add('Apply relay PI', () => ui.setMany({ ctrl: 'pi', piKc: +z.pi.Kc.toFixed(1), piTi: Math.round(z.pi.Ti) })); add('Apply relay PID', () => ui.setMany({ ctrl: 'pid', pidKc: +z.pid.Kc.toFixed(1), pidTi: Math.round(z.pid.Ti), pidTd: Math.round(z.pid.Td) })); }
  if (wrap.children.length) box.appendChild(wrap);
}
function runStepTest() { tuning.step = CM.stepTest(paramsFromUI(), { du: 40 }); renderTuning(); ui.set('view', 'step'); }
function runRelayTest() { const Pp = paramsFromUI(); tuning.relay = CM.relayTest(Pp, { d: 25 }); tuning.linH = CM.ultimateLinear(Pp, 'heat'); tuning.linC = CM.ultimateLinear(Pp, 'cool'); renderTuning(); ui.set('view', 'relay'); }

/* ================================================================ comparison */
async function compareAll() {
  cmpBtn.disabled = true; const res = {}; const prm = prmFromUI(), Pp = paramsFromUI(), opt = scenarioOpt();
  for (const ty of TYPES) { cmpBtn.textContent = `Simulating ${LABEL[ty]}…`; await new Promise(r => setTimeout(r, 20)); res[ty] = CM.runScenario(ty, prm, Pp, opt, { seed: 11, every: 30 }); }
  compare = res; cmpBtn.disabled = false; cmpBtn.textContent = 'Compare all five controllers';
  drawAll();
  document.getElementById('chart-compare').closest('.chart-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ================================================================ readouts, HUD, labels */
function updateReadouts() {
  const p = live.plant, sc = CM.scenario(live.t, live.opt), m = live.M;
  const e = p.Ta - sc.r;
  ro.set('ta', p.Ta, Math.abs(e) < 0.5 ? 'ok' : Math.abs(e) < 1.5 ? 'warn' : 'bad', `error ${e >= 0 ? '+' : ''}${fmt(e, 2)} °C · sensor ${fmt(live.y, 2)} °C`);
  ro.set('sp', sc.r, null, live.t < CM.SC.tStep ? 'night set-point' : 'day set-point');
  ro.set('rh', p.rh ?? CM.rhFromW(p.Ta, p.W), (p.rh > 90 || p.rh < 55) ? 'warn' : 'ok', p.hum ? 'humidifier ON' : 'humidifier off');
  ro.set('u', live.u, Math.abs(live.u) >= 99.5 ? 'warn' : null, Math.abs(live.u) >= 99.5 ? 'saturated' : live.u > 0 ? 'heating' : live.u < 0 ? 'cooling' : 'idle');
  const q = (p.Qh - (1 - CM.latentFraction(p.rh ?? 70)) * p.Qc) / 1000;
  ro.set('pow', Math.abs(q) < 1e-3 ? 0 : q, null, `heater ${kw(p.Qh)} · evaporator ${kw(p.Qc)} kW`);
  ro.set('iae', m.iae, m.iae < 0.6 ? 'ok' : m.iae < 1.2 ? 'warn' : 'bad', live.modified ? 'settings changed mid-run' : `after ${fmt(live.t / 60, 0)} min`);
  ro.set('ov', live.t > CM.SC.tStep ? m.ov : NaN, live.t > CM.SC.tStep ? (m.ov < 0.3 ? 'ok' : m.ov < 1 ? 'warn' : 'bad') : null);
  const st = m.settle !== null ? m.settle / 60 : (live.t > CM.SC.tStep && m.inBandSince !== null ? (m.inBandSince - CM.SC.tStep) / 60 : NaN);
  ro.set('settle', isFinite(st) ? st : NaN, isFinite(st) ? (st < 15 ? 'ok' : 'warn') : (m.settle === Infinity ? 'bad' : null), m.settle === Infinity ? 'never settled before lights-on' : m.settle === null ? 'measured until 60 min' : '');
  ro.set('sw', m.switches, m.switches < 40 ? 'ok' : m.switches < 150 ? 'warn' : 'bad', 'heater + compressor starts');
  ro.set('kwh', p.E.heat / 3.6e6 + p.E.cool / 3.6e6, null, `heater ${fmt(p.E.heat / 3.6e6, 2)} · compressor ${fmt(p.E.cool / 3.6e6, 2)}`);
  const hh = Math.floor(live.t / 3600), mm = Math.floor(live.t % 3600 / 60), ss = live.t % 60;
  hud.set('t', `Test time <b>${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}</b> / 4:00:00 · ${LABEL[live.type]}`);
  hud.set('ev', `${sc.lights ? 'Lights <b>ON</b>' : 'Lights off'} · ${sc.door ? 'Door <b>OPEN</b>' : 'door closed'} · corridor <b>${fmt(sc.Tc, 1)}</b> °C`);
}
function updateLabels() {
  const show = ui.get('labels'); Object.values(lab).forEach(l => { l.visible = show; l.element.style.display = show ? '' : 'none'; });
  if (!show) return;
  const p = live.plant, sc = CM.scenario(live.t, live.opt);
  lab.heater.element.innerHTML = `Heater<small>${kw(p.Qh)} kW · coil ≈ ${fmt(p.Ta + p.Qh / P.Ph * 680, 0)} °C</small>`;
  lab.evap.element.innerHTML = `Evaporator<small>${kw(p.Qc)} kW cooling · fans on</small>`;
  lab.hum.element.innerHTML = `Humidifier<small>${p.hum ? 'ON · ' + CM.P0.Hum + ' kg h⁻¹ mist' : 'off'} · RH ${fmt(p.rh, 0)} %</small>`;
  lab.sensor.element.innerHTML = `Sensor<small>${fmt(live.y, 2)} °C (air ${fmt(p.Ta, 2)})</small>`;
  lab.door.element.innerHTML = sc.door ? `Door open<small>${fmt((p.Vdoor || 0) * 1000, 0)} L s⁻¹ exchange</small>` : ''; lab.door.element.style.display = sc.door ? '' : 'none';
  lab.rack.element.innerHTML = `LED rack<small>${sc.lights ? 'ON · 650 W' : 'off'}</small>`;
}

/* ================================================================ frame loop */
let uiT = 0, dispT = 0;
stage.onFrame((dt) => {
  if (!live) return;
  const p = live.plant, sc = CM.scenario(live.t, live.opt);
  H.update(dt, { heatFrac: p.Qh / P.Ph, coilT: p.Ta + p.Qh / P.Ph * 680, coolFrac: p.Qc / P.Qc, hum: p.hum, door: sc.door, lights: sc.lights });
  dispT += dt; uiT += dt;
  if (dispT > 0.25) { dispT = 0; H.sensor.draw(live.y, p.rh ?? CM.rhFromW(p.Ta, p.W), LABEL[live.type] + ' control'); H.corrDisplay(sc.Tc); updateLabels(); updateInfo(); }
});
let lastDraw = 0;
(function uiLoop(now) {
  requestAnimationFrame(uiLoop);
  if (!live || now - lastDraw < 250) return; lastDraw = now;
  if (clock.running || live._dirty) { live._dirty = false; updateReadouts(); if (ui.get('view') === 'live') drawLive(); else drawEnergyOnly(); }
})(0);

/* ================================================================ reactions to controls */
function applyLive(id) {
  const v = ui.values(); const c = live.ctrl;
  if (['theta', 'tauS', 'sigma', 'Ph'].includes(id)) { P = paramsFromUI(); if (live.type === 'mpc') { const m = CM.makeController('mpc', prmFromUI(), P, live.opt, null); m.reset(live.plant, live.u); live.ctrl = m; } }
  else if (live.type === 'onoff') c.h = v.h;
  else if (live.type === 'p') { c.Kc = v.pKc; c.u0 = v.pBias; }
  else if (live.type === 'pi') { c.Kc = v.piKc; c.Ti = v.piTi; c.aw = v.aw; }
  else if (live.type === 'pid') { c.Kc = v.pidKc; c.Ti = v.pidTi; c.Td = v.pidTd; c.N = v.pidN; c.aw = v.aw; }
  else if (live.type === 'mpc') {
    if (id === 'mpcScale') { const m = CM.makeController('mpc', prmFromUI(), P, live.opt, null); m.reset(live.plant, live.u); live.ctrl = m; }
    else { c.N = v.mpcN; c.wE = v.mpcWE; c.wD = v.mpcWD; }
  }
  if (live.t > 0) live.modified = true; live._dirty = true;
}
ui.onChange((st, id) => {
  if (id === 'speed') { clock.speed = +st.speed; return; }
  if (id === 'view') { drawAll(); return; }
  if (id === 'labels') { updateLabels(); return; }
  if (id === 'ctrl') { showRelevant(); restart(); return; }
  if (['dLights', 'dCorr', 'dDoor', 'humLoop'].includes(id)) { restart(); return; }
  if (!id) { showRelevant(); restart(); return; }       // presets (setMany) fire per key; ctrl handled above
  applyLive(id);
});

/* ================================================================ start */
window.__ccLab = { jump(t) { clock.pause(); while (live.t < Math.min(t, TEND)) stepOne(); if (live.t >= TEND) live.done = true; drawAll(); updateReadouts(); updateLabels(); }, compare: () => compareAll(), step: () => runStepTest(), relay: () => runRelayTest(), get live() { return live; } };
newLive(); drawAll(); updateReadouts(); updateLabels(); H.sensor.draw(live.y, live.plant.rh ?? 70, 'PI control'); H.corrDisplay(20);
setTimeout(() => clock.play(), 600);
