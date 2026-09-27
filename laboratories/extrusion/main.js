/* High-moisture extrusion laboratory — UI, dynamics, charts and product lab.
   Model: ./model.js (Derive tab, Eqs. E1–E10). Scene: ./scene.js. */
import { createStage, THREE, studioLights } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, linspace } from '/assets/js/plot.js';
import { palette, colormapGradient, withAlpha } from '/assets/js/colors.js';
import { solve, classify, exitCore, barrelSetpoints, MATERIALS, G, SCREW } from './model.js';
import { buildScene, Y0, X_DIE0 } from './scene.js';

const CLS = {
  fibrous: { label: 'Fibrous, anisotropic', short: 'fibrous', status: 'ok' },
  expanded: { label: 'Expanded, porous', short: 'expanded', status: 'warn' },
  none: { label: 'No texture', short: 'no texture', status: 'warn' },
  burnt: { label: 'Burnt / degraded', short: 'burnt', status: 'bad' }
};

/* ------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'X', label: 'Moisture of the melt (wet basis)', unit: '%', digits: 1 })
  .add({ id: 'mt', label: 'Total throughput', unit: 'kg h⁻¹', digits: 1 })
  .add({ id: 'sme', label: 'Specific mechanical energy', unit: 'kWh t⁻¹', digits: 0 })
  .add({ id: 'tq', label: 'Torque (of drive limit)', unit: '%', digits: 0 })
  .add({ id: 'Tm', label: 'Melt temperature at die', unit: '°C', digits: 1 })
  .add({ id: 'tres', label: 'Mean residence time', unit: 's', digits: 0 })
  .add({ id: 'Tex', label: 'Core temperature at die exit', unit: '°C', digits: 1 })
  .add({ id: 'AI', label: 'Anisotropy index F<sub>T</sub>/F<sub>L</sub>', unit: '', digits: 2 })
  .add({ id: 'prod', label: 'Predicted product', unit: '', format: v => v })
  .add({ id: 'ste', label: 'Specific thermal energy (barrel)', unit: 'kWh t⁻¹', digits: 0 })
  .add({ id: 'qcool', label: 'Heat removed in cooling die', unit: 'W', digits: 0 });

ui.section('Raw material');
ui.select({ id: 'mat', label: 'Protein ingredient', options: Object.entries(MATERIALS).map(([value, m]) => ({ value, label: m.label })), value: 'spc', help: 'Powder moisture ≈ 7 % (wet basis). Pea window is narrower (illustrative, see Sources).' });
ui.slider({ id: 'Qs', label: 'Powder feed rate', min: 2, max: 20, step: 0.5, value: 5, unit: 'kg h⁻¹', help: 'Gravimetric (loss-in-weight) feeder' });
ui.section('Process');
ui.slider({ id: 'X', label: 'Target moisture (wet basis)', min: 20, max: 80, step: 1, value: 50, unit: '%', help: 'The water pump rate follows from the mass balance (Eq. E1)' });
ui.slider({ id: 'N', label: 'Screw speed', min: 100, max: 1200, step: 10, value: 250, unit: 'rpm' });
ui.slider({ id: 'Tc', label: 'Cooking-zone temperature (zones 5–7)', min: 80, max: 200, step: 1, value: 140, unit: '°C', help: 'Zone 1 cooled (25 °C); zones 2–4 ramp 40 → 60 → …' });
ui.section('Cooling die');
ui.slider({ id: 'Tcd', label: 'Coolant temperature', min: 10, max: 110, step: 1, value: 50, unit: '°C' });
ui.slider({ id: 'Ld', label: 'Die length', min: 0.05, max: 1.5, step: 0.01, value: 0.38, unit: 'm' });
ui.slider({ id: 'Hd', label: 'Die gap (channel height)', min: 3, max: 15, step: 0.5, value: 6, unit: 'mm', help: 'Channel width fixed at 30 mm' });
ui.section('Simulation & view');
const [playBtn, settleBtn] = ui.buttons([{ label: '❚❚ Pause', variant: 'primary', onClick: () => clock.toggle() }, { label: 'Skip warm-up', title: 'Set barrel zones instantly to their set-points', onClick: () => settle() }]);
ui.segmented({ id: 'speed', label: 'Simulation speed', options: [{ value: 1, label: '1×' }, { value: 5, label: '5×' }, { value: 20, label: '20×' }], value: 5 });
ui.segmented({ id: 'view', label: 'Barrel view', options: [{ value: 'solid', label: 'Solid' }, { value: 'cut', label: 'Cut-away' }, { value: 'xray', label: 'X-ray' }], value: 'solid' });
ui.segmented({ id: 'colour', label: 'Material colours', options: [{ value: 'look', label: 'Appearance' }, { value: 'temp', label: 'Temperature' }], value: 'look' });
ui.toggle({ id: 'labels', label: 'Show labels', value: true });
ui.buttons([{ label: 'Overview', onClick: () => tour('home') }, { label: 'Feed & water', onClick: () => tour('feed') }, { label: 'Kneading', onClick: () => tour('knead') }, { label: 'Die & cutter', onClick: () => tour('die') }]);
ui.presets([
  { label: 'Soy HME, lab scale', title: 'Close to the conditions of Wittek et al. (2021): 50 % moisture, 250 rpm, 10 kg h⁻¹, 380 × 30 × 6 mm die at 50 °C', values: { mat: 'spc', Qs: 5, X: 50, N: 250, Tc: 140, Tcd: 50, Ld: 0.38, Hd: 6 } },
  { label: 'Chicken-like pea', values: { mat: 'ppi', Qs: 5, X: 56, N: 400, Tc: 150, Tcd: 30, Ld: 0.6, Hd: 6 } },
  { label: 'TVP (low moisture)', title: 'Low-moisture extrusion through a short, hot die: expanded texturised vegetable protein', values: { mat: 'spc', Qs: 8, X: 28, N: 450, Tc: 160, Tcd: 110, Ld: 0.05, Hd: 4 } },
  { label: 'Too cold', values: { mat: 'spc', Qs: 5, X: 55, N: 250, Tc: 105, Tcd: 50, Ld: 0.38, Hd: 6 } },
  { label: 'Throughput too high', values: { mat: 'spc', Qs: 12, X: 50, N: 300, Tc: 140, Tcd: 50, Ld: 0.38, Hd: 6 } },
  { label: 'Burnt', values: { mat: 'spc', Qs: 3, X: 32, N: 600, Tc: 190, Tcd: 50, Ld: 0.38, Hd: 6 } }
]);
ui.saveButton('extrusion', () => ro.values());

/* ------------------------------------------------------------ stage */
const stage = createStage('#stage', {
  background: '#0c1113', envIntensity: 0.5, exposure: 0.95,
  camera: { pos: [1.05, 2.0, 2.85], target: [0.58, 1.02, 0], fov: 38 },
  controls: { minDistance: 0.12, maxDistance: 7 },
  bloom: { strength: 0.35, radius: 0.4, threshold: 1.0 }, ao: { radius: 0.12, intensity: 0.7 }
});
const lights = studioLights(stage, { intensity: 0.85, shadowSize: 2.6, keyPos: [2.5, 5, 3] });
lights.key.target.position.set(0.5, 1, 0);
const api = buildScene(stage);
const hud = hudChips(stage.el);
const legend = document.createElement('div'); legend.className = 'stage-legend'; stage.el.appendChild(legend);
legend.innerHTML = `Barrel &amp; melt temperature (°C)<div class="cbar" style="background:${colormapGradient('inferno')}"></div><div class="cbar-ticks"><span>20</span><span>110</span><span>200</span></div>`;

/* labels */
const labels = {};
const mkLabel = (key, pos, html, cls = 'label3d') => { labels[key] = stage.addLabel(pos, html, { className: cls }); return labels[key]; };
mkLabel('feeder', api.anchors.feeder, 'Gravimetric feeder');
mkLabel('water', api.anchors.water.clone().add(new THREE.Vector3(-0.05, 0.22, 0.02)), 'Water injection');
mkLabel('kb1', api.anchors.kb1.clone().add(new THREE.Vector3(0, 0.1, -0.05)), 'Kneading block 1');
mkLabel('kb2', api.anchors.kb2.clone().add(new THREE.Vector3(0, 0.1, -0.05)), 'Kneading block 2');
const inspector = stage.addLabel([0, -10, 0], '', { className: 'label3d lg' }); inspector.visible = false;

/* ------------------------------------------------------------ dynamics */
let zonesAct = barrelSetpoints(140).slice();
let res = null, lastKey = '', tSim = 0, lastSolveZones = zonesAct.slice();
const history = [];   // product formed at the die inlet: {t, kind, brown, AI}
const P = () => ui.values();
function params() {
  const p = P();
  return { mat: p.mat, Qs: p.Qs, X: p.X / 100, N: p.N, zones: zonesAct.slice(), Tcd: p.Tcd, Ld: p.Ld, Hd: p.Hd / 1000 };
}
function settle() { zonesAct = barrelSetpoints(P().Tc).slice(); recompute(true); }
let dieKey = '';
function recompute(force) {
  const p = params();
  const k = JSON.stringify(p);
  if (!force && k === lastKey) return;
  lastKey = k; lastSolveZones = zonesAct.slice();
  res = solve(p);
  const dk = p.Ld + '|' + p.Hd; if (dk !== dieKey) { api.buildDie(p.Ld, p.Hd); dieKey = dk; }
  history.push({ t: tSim, kind: res.cls, brown: res.brown, AI: res.AI });
  while (history.length > 2 && history[1].t < tSim - 900) history.shift();
  updateReadouts(); updateScene(); scheduleCharts();
}
function exitingProduct() {
  const tt = tSim - (res ? res.tTotal : 0);
  let h = history[0]; for (const e of history) { if (e.t <= tt) h = e; else break; }
  return h || { kind: 'fibrous', brown: 0.2, AI: 1 };
}
function updateReadouts() {
  const p = P(), r = res, m = MATERIALS[p.mat];
  ro.set('X', r.X * 100, r.X >= m.Xlo && r.X <= m.Xhi ? 'ok' : 'warn', `water pump ${fmt(r.mw * 3600, 2)} kg h⁻¹ (Eq. E1)`);
  ro.set('mt', r.mt * 3600, null, `powder ${fmt(p.Qs, 1)} + water ${fmt(r.mw * 3600, 1)}`);
  const smekJ = r.SME / 1000;
  ro.set('sme', r.SMEkWh, smekJ >= 60 && smekJ <= 400 ? 'ok' : 'warn', `${fmt(smekJ, 0)} kJ kg⁻¹ · HME typically 85–350 kJ kg⁻¹`);
  ro.set('tq', r.torquePct, r.torquePct < 70 ? 'ok' : r.torquePct < 90 ? 'warn' : 'bad', `${fmt(r.torque, 1)} N m on both shafts`);
  const dTv = r.Tmelt - barrelSetpoints(p.Tc)[6];
  ro.set('Tm', r.Tmelt, r.Tmelt >= r.Ton && r.Tmelt <= r.Tup ? 'ok' : 'warn', `${dTv >= 0 ? '+' : ''}${fmt(dTv, 1)} K vs zone 7 set-point · window ${fmt(r.Ton, 0)}–${fmt(r.Tup, 0)} °C`);
  ro.set('tres', r.tTotal, null, `barrel ${fmt(r.tBarrel, 0)} s + die ${fmt(r.tDie, 0)} s`);
  ro.set('Tex', r.Tcore, r.Tcore < 95 ? 'ok' : r.Tcore < 100 ? 'warn' : 'bad', r.Tcore >= 100 ? 'water flashes to steam at the exit' : `mean ${fmt(r.Tmean, 1)} °C · coolant ${fmt(p.Tcd, 0)} °C`);
  ro.set('AI', r.AI, r.AI >= 1.3 ? 'ok' : r.AI >= 1.1 ? 'warn' : 'bad', r.AI >= 1.3 ? 'clearly anisotropic' : r.AI >= 1.1 ? 'weakly anisotropic' : 'isotropic');
  ro.set('prod', CLS[r.cls].label, CLS[r.cls].status, r.why);
  ro.set('ste', r.STE / 3600, null, `${fmt(r.STE / 1000, 0)} kJ kg⁻¹ net from barrel heaters`);
  ro.set('qcool', r.Qcool, null, `${fmt(r.Qcool / r.mt / 1000, 0)} kJ per kg of product`);
}
function updateScene() {
  const p = P();
  api.setZones(zonesAct);
  api.setFill(res, p.colour);
  api.setDieField(res, 20, 200);
  const l = p.labels;
  const open = p.view !== 'solid';
  labelVis();
  labels.feeder.element.innerHTML = `Gravimetric feeder<small>${fmt(p.Qs, 1)} kg h⁻¹ powder</small>`;
  labels.water.element.innerHTML = `Water injection<small>${fmt(res.mw * 3600, 2)} kg h⁻¹ → ${fmt(res.X * 100, 0)} % moisture</small>`;
  labels.kb1.element.innerHTML = `Kneading block (45°)<small>fully filled · high shear</small>`;
  labels.kb2.element.innerHTML = `Kneading blocks (45° + 90°)<small>melting zone</small>`;
  const sp = barrelSetpoints(p.Tc);
  if (labels.die) labels.die.element.innerHTML = dieLabelHTML(); else { labels.die = stage.addLabel(api.anchors.slice, dieLabelHTML()); }
  labels.die.position.copy(api.anchors.slice);
  if (labels.cut) labels.cut.position.copy(api.anchors.exit.clone().add(new THREE.Vector3(0.5, 0.3, 0.05))); else labels.cut = stage.addLabel(api.anchors.exit.clone().add(new THREE.Vector3(0.5, 0.3, 0.05)), '');
  const ex = exitingProduct();
  labels.cut.element.innerHTML = `Product leaving the die<small>${CLS[ex.kind].label} · AI ${fmt(ex.AI, 2)}</small>`;
  labelVis();
  hud.set('t', `Time <b>${fmtClock(tSim)}</b> · screws shown at 1/10 speed`);
  hud.set('m', `Melt <b>${fmt(res.Tmelt, 0)} °C</b> → die exit core <b>${fmt(res.Tcore, 0)} °C</b>`);
  hud.set('p', `Now forming: <b>${CLS[res.cls].short}</b> · leaving die: <b>${CLS[ex.kind].short}</b>`);
}
/** Show labels only when useful: kneading labels in open views and close up, others within a few metres. */
function labelVis() {
  const p = P(), cam = stage.camera.position, open = p.view !== 'solid', lp = new THREE.Vector3();
  const maxD = { kb1: 1.6, kb2: 1.6, feeder: 3.6, water: 3.6, die: 3.2, cut: 3.6 };
  Object.entries(labels).forEach(([k, lb]) => { lb.getWorldPosition(lp); lb.visible = !!p.labels && (open || !k.startsWith('kb')) && cam.distanceTo(lp) < (maxD[k] || 5); });
}
const dieLabelHTML = () => `Cooling die ${fmt(P().Ld, 2)} m · coolant ${fmt(P().Tcd, 0)} °C<small>${(P().view === 'solid') ? 'Cut-away view shows the gap temperature' : 'temperature across the ' + fmt(P().Hd, 1) + ' mm gap (stretched vertically)'}</small>`;
const fmtClock = s => { const m = Math.floor(s / 60), ss = Math.floor(s % 60); return `${m}:${String(ss).padStart(2, '0')}`; };

/* sim clock: barrel zones approach their set-points with a first-order lag */
const TAU = 60;
const clock = new SimClock({
  speed: +P().speed, maxDt: 0.5,
  onStep: dt => {
    tSim += dt;
    const sp = barrelSetpoints(P().Tc);
    for (let i = 0; i < 7; i++) zonesAct[i] += (sp[i] - zonesAct[i]) * (1 - Math.exp(-dt / TAU));
  }
});
clock.onState(r => { playBtn.innerHTML = r ? '❚❚ Pause' : '▶ Run'; });
stage.onKey('space', () => clock.toggle());
let acc = 0, hmiAcc = 0;
stage.onFrame((dt, t) => {
  if (!res) return;
  const p = P();
  const run = clock.running, simDt = run ? dt * clock.speed : 0;
  acc += dt; hmiAcc += dt;
  if (acc > 0.25) { acc = 0; labelVis(); const drift = Math.max(...zonesAct.map((z, i) => Math.abs(z - lastSolveZones[i]))); if (drift > 0.25) recompute(true); else { const ex = exitingProduct(); labels.cut && (labels.cut.element.innerHTML = `Product leaving the die<small>${CLS[ex.kind].label} · AI ${fmt(ex.AI, 2)}</small>`); hud.set('t', `Time <b>${fmtClock(tSim)}</b> · screws shown at 1/10 speed`); hud.set('p', `Now forming: <b>${CLS[res.cls].short}</b> · leaving die: <b>${CLS[ex.kind].short}</b>`); } }
  if (hmiAcc > 0.5) { hmiAcc = 0; api.setHMI({ run, N: p.N, tq: res.torquePct, sme: res.SMEkWh, Tm: res.Tmelt, qs: p.Qs, qw: res.mw * 3600, Tex: res.Tcore, zones: barrelSetpoints(p.Tc).map((s, i) => ({ set: s, act: zonesAct[i] })), cls: res.cls, label: CLS[res.cls].label }); }
  const ex = exitingProduct();
  const fillAvg = res.fill.reduce((a, b) => a + b, 0) / res.fill.length;
  api.animate(dt, { omegaVis: run ? 2 * Math.PI * p.N / 60 * 0.1 : 0, flowVis: run ? (res.mt / res.props.rho) / (G.Afree * Math.max(0.1, fillAvg)) / 0.035 * Math.min(clock.speed, 5) * 0.2 : 0, waterVis: run ? 0.02 + res.mw * 3600 * 0.025 : 0, powderVis: run ? 0.5 + p.Qs / 8 : 0, beltVis: run ? res.ubar * 1.6 * clock.speed : 0 });
  api.updateProduct(simDt, { ubar: res.ubar, kind: ex.kind, brown: ex.brown });
});

/* picking → inspector label */
stage.onPick({
  objects: () => api.pickRoots(),
  onClick: hit => {
    if (!hit) { inspector.visible = false; return; }
    let o = hit.object; while (o && !o.userData.info) o = o.parent;
    const info = o && o.userData.info; if (!info) { inspector.visible = false; return; }
    inspector.position.copy(hit.point).add(new THREE.Vector3(0, 0.05, 0)); inspector.visible = true;
    inspector.element.innerHTML = infoHTML(info, hit.point);
  }
});
function infoHTML(info, pt) {
  const p = P(), r = res; const sp = barrelSetpoints(p.Tc);
  if (info.kind === 'zone' || info.kind === 'screw' || info.kind === 'material') {
    const x = Math.min(G.L - 1e-4, Math.max(0, pt.x)); const i = Math.min(r.xs.length - 1, Math.floor(x / 0.002)); const z = Math.min(6, Math.floor(x / G.secLen));
    const el = SCREW.find(e => x >= e.x0 && x < e.x1) || SCREW[0];
    const nm = { conv: `conveying element, pitch ${fmt(el.pitch * 1000, 0)} mm`, kb45: 'forward kneading block (45°)', kb90: 'neutral kneading block (90°)', pb: 'pressure build-up zone' }[el.type];
    return `Barrel zone ${z + 1} · x = ${fmt(x, 3)} m<small>set ${fmt(sp[z], 0)} °C · actual ${fmt(zonesAct[z], 1)} °C · material ${fmt(r.T[i], 1)} °C<br>${nm} · fill ${fmt(r.fill[i] * 100, 0)} % · ${['powder', 'dough', 'melt'][r.state[i]]}</small>`;
  }
  if (info.kind === 'feeder') return `Loss-in-weight feeder<small>${fmt(p.Qs, 1)} kg h⁻¹ ${MATERIALS[p.mat].label}, ${fmt(MATERIALS[p.mat].wp * 100, 0)} % moisture</small>`;
  if (info.kind === 'water') return `Water dosing pump<small>${fmt(r.mw * 3600, 2)} kg h⁻¹ at 20 °C → melt moisture ${fmt(r.X * 100, 1)} %</small>`;
  if (info.kind === 'hmi') return `Operator panel<small>SME ${fmt(r.SMEkWh, 0)} kWh t⁻¹ · torque ${fmt(r.torquePct, 0)} %</small>`;
  if (info.kind === 'die') return `Cooling die ${fmt(p.Ld, 2)} × 0.030 × ${fmt(p.Hd / 1000, 4)} m<small>melt in ${fmt(r.Tmelt, 0)} °C → core out ${fmt(r.Tcore, 0)} °C · ū = ${fmt(r.ubar * 100, 2)} cm s⁻¹ · ${fmt(r.tDie, 0)} s in die</small>`;
  if (info.kind === 'cutter') return `Conveyor & guillotine cutter<small>pieces of 80 mm · strand speed ${fmt(r.ubar * 100, 2)} cm s⁻¹</small>`;
  if (info.kind === 'product') { const ex = exitingProduct(); return `Product<small>${CLS[ex.kind].label} · AI ${fmt(ex.AI, 2)} — see the product lab below the charts</small>`; }
  return '';
}
const VIEWS = {
  home: [[1.05, 2.0, 2.85], [0.58, 1.02, 0]],
  feed: [[0.55, 1.75, 0.95], [0.08, 1.2, -0.1]],
  knead: [[0.42, 1.36, 0.36], [0.4, 1.04, 0]],
  die: () => { const xe = X_DIE0 + P().Ld; return [[xe + 0.25, 1.45, 0.75], [xe - 0.1, 1.02, 0]]; }
};
function tour(k) { const v = typeof VIEWS[k] === 'function' ? VIEWS[k]() : VIEWS[k]; if (k === 'knead' && P().view === 'solid') ui.set('view', 'cut'); stage.flyTo(v[0], v[1], 1.4); }

/* ------------------------------------------------------------ charts */
const mapPlot = new Plot('#chart-map', { x: { label: 'Moisture of the melt', unit: '% wet basis', min: 20, max: 80 }, y: { label: 'Melt temperature at the die', unit: '°C', min: 80, max: 200 }, legend: false, crosshair: false });
const tPlot = new Plot('#chart-temp', { x: { label: 'Position along the machine', unit: 'm', min: 0 }, y: { label: 'Temperature', unit: '°C', min: 0 } });
const smePlot = new Plot('#chart-sme', { x: { label: 'Screw speed', unit: 'rpm', min: 100, max: 1200 }, y: { label: 'SME', unit: 'kWh t⁻¹', min: 0 } });
const NG = 101;
const mapCanvas = document.createElement('canvas'); mapCanvas.width = NG; mapCanvas.height = NG;
let mapKey = '', mapLabels = [];
const REGION = { fibrous: ['fibrous, anisotropic', 'accent', 12.5], expanded: ['expanded (core > 100 °C)', 'amber', 11.5], burnt: ['burnt / degraded', 'danger', 11.5], cold: ['no texture: under-cooked', 'muted', 11], hot: ['no texture: over-heated', 'muted', 11], dry: ['no texture: too dry', 'muted', 11], wet: ['no texture: too wet', 'muted', 11], die: ['no texture: die too warm', 'muted', 11] };
function buildMap() {
  const p = params(); const P_ = palette();
  const key = [p.mat, p.Qs, p.Tcd, p.Ld, p.Hd, p.N, Math.round(res.tTotal / 3), P_.accent].join('|');
  if (key === mapKey) return false; mapKey = key;
  const ctx = mapCanvas.getContext('2d'); const img = ctx.createImageData(NG, NG);
  const m = MATERIALS[p.mat];
  const hex = h => { const c = h.trim(); if (c.startsWith('#')) { const n = parseInt(c.length === 4 ? c.slice(1).split('').map(x => x + x).join('') : c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; } const mm = c.match(/\d+/g) || [128, 128, 128]; return mm.slice(0, 3).map(Number); };
  const cols = { fibrous: hex(P_.accent), expanded: hex(P_.amber), burnt: hex(P_.danger), none: hex(P_.muted) };
  const acc = {};
  for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
    const X = 0.20 + 0.60 * i / (NG - 1), Tm = 200 - 120 * j / (NG - 1);
    const mt = (p.Qs / 3600) * (1 - m.wp) / (1 - X);
    const Tex = exitCore(p.mat, X, Tm, p, mt);
    const c = classify(p.mat, X, Tm, Tex, p.Tcd, res.tTotal, p.N, p.Hd);
    const col = cols[c.cls]; const k = (j * NG + i) * 4;
    img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = c.cls === 'none' ? 55 + (c.reason === 'dry' || c.reason === 'hot' ? 25 : 0) : 115;
    const a = acc[c.reason] || (acc[c.reason] = { n: 0, x: 0, y: 0 }); a.n++; a.x += X * 100; a.y += Tm;
  }
  ctx.putImageData(img, 0, 0);
  mapLabels = Object.entries(acc).filter(([, a]) => a.n > NG * NG * 0.025).map(([k, a]) => ({ k, x: a.x / a.n, y: a.y / a.n }));
  return true;
}
function drawMap() {
  if (buildMap()) { Object.keys(REGION).forEach(k => mapPlot.remove('lab-' + k)); mapLabels.forEach(l => { const d = REGION[l.k]; mapPlot.text('lab-' + l.k, Math.min(74, Math.max(26, l.x)), Math.min(195, Math.max(85, l.y)), d[0], { color: d[1], align: 'center', size: d[2], weight: 700 }); }); }
  mapLabels.forEach(l => { const it = mapPlot.items.get('lab-' + l.k); if (!it) return; const near = Math.abs(it.x - res.X * 100) < 13 && Math.abs(it.y - res.Tmelt) < 9; it.dy = near ? (it.y >= res.Tmelt ? -16 : 16) : 0; });
  const p = P(), r = res, P_ = palette();
  mapPlot.custom('bg', (ctx, plot) => { const R = plot.plotRect; ctx.imageSmoothingEnabled = true; ctx.drawImage(mapCanvas, R.left, R.top, R.width, R.height); }, { z: -1 });
  mapPlot.custom('arrow', (ctx, plot) => {
    const x = plot.px(r.X * 100), y0 = plot.py(barrelSetpoints(p.Tc)[6]), y1 = plot.py(r.Tmelt);
    ctx.strokeStyle = P_.ink; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = P_.bgElev; ctx.strokeStyle = P_.ink; ctx.beginPath(); ctx.arc(x, y0, 4, 0, 7); ctx.fill(); ctx.stroke();
  }, { noClip: false });
  mapPlot.point('op', r.X * 100, r.Tmelt, { color: 'magenta', r: 6, label: 'you are here' });
}
function drawTemp() {
  const r = res, p = P(); const sp = barrelSetpoints(p.Tc);
  const bx = [], bs = [], ba = [];
  for (let i = 0; i < 7; i++) { bx.push(i * G.secLen, (i + 1) * G.secLen); bs.push(sp[i], sp[i]); ba.push(zonesAct[i], zonesAct[i]); }
  tPlot.line('set', bx, bs, { color: 'muted', width: 1.6, dash: [5, 4], label: 'Barrel set-point' });
  tPlot.line('act', bx, ba, { color: 'amber', width: 2, label: 'Barrel actual' });
  const step = 3; const xs = r.xs.filter((_, i) => i % step === 0), ts = r.T.filter((_, i) => i % step === 0);
  const dx0 = X_DIE0; const dieX = r.die.x.map(x => dx0 + x);
  tPlot.line('melt', [...xs, G.L, dx0], [...ts, r.Tmelt, r.Tmelt], { color: 'danger', width: 2.6, label: 'Material (mean)' });
  tPlot.line('core', dieX, r.die.core, { color: 'magenta', width: 2.4, label: 'Die: core' });
  tPlot.line('dmean', dieX, r.die.mean, { color: 'magenta', width: 1.6, dash: [6, 4], label: 'Die: mean' });
  tPlot.line('wall', [dx0, dx0 + p.Ld], [p.Tcd, p.Tcd], { color: 'water', width: 2, label: 'Coolant / die wall' });
  tPlot.hline('boil', 100, { color: 'ink', dash: [4, 4], label: '100 °C' });
  tPlot.vline('die', dx0, { color: 'muted', label: 'die' });
  SCREW.filter(e => e.type === 'kb45' || e.type === 'kb90').forEach((e, k) => tPlot.region('kb' + k, e.x0, e.x1, { color: 'magenta', alpha: 0.12 }));
  tPlot.region('water', G.xWater - 0.004, G.xWater + 0.004, { color: 'water', alpha: 0.35, label: 'H₂O' });
  tPlot.setAxis('x', { min: 0, max: dx0 + p.Ld });
  tPlot.setAxis('y', { min: 0, max: Math.max(200, Math.ceil(Math.max(...r.T, ...sp) / 20) * 20) });
}
let smeTimer = null;
function drawSME() {
  clearTimeout(smeTimer);
  smeTimer = setTimeout(() => {
    const p = params(); const Ns = linspace(100, 1200, 23);
    [[0.4, 'c3'], [0.5, 'accent'], [0.6, 'water'], [0.7, 'c4']].forEach(([X, c]) => {
      const ys = Ns.map(N => solve(Object.assign({}, p, { N, X, zones: barrelSetpoints(P().Tc) })).SMEkWh);
      smePlot.line('x' + X, Ns, ys, { color: c, width: 2.2, label: `${X * 100} % moisture` });
    });
    smePlot.point('now', p.N, res.SMEkWh, { color: 'magenta', r: 6, guides: true });
    smePlot.hregion('lit', 85 / 3.6, 350 / 3.6, { color: 'amber', alpha: 0.1, label: 'SPC range, Pietsch et al. (2019)' });
  }, 220);
}
let chartsQueued = false;
function scheduleCharts() { if (chartsQueued) return; chartsQueued = true; requestAnimationFrame(() => { chartsQueued = false; drawMap(); drawTemp(); drawSME(); drawProduct(); }); }
document.addEventListener('ffp:theme', () => { mapKey = ''; scheduleCharts(); });

/* ------------------------------------------------------------ product lab (cross-sections + tearing test) */
const pc = document.getElementById('product-canvas');
let tearP = 0, tearAnim = null;
document.getElementById('btn-tear').addEventListener('click', () => {
  if (tearAnim) cancelAnimationFrame(tearAnim);
  if (tearP > 0.99) { tearP = 0; drawProduct(); return; }
  const t0 = performance.now();
  const step = now => { tearP = Math.min(1, (now - t0) / 1600); drawProduct(); if (tearP < 1) tearAnim = requestAnimationFrame(step); };
  tearAnim = requestAnimationFrame(step);
});
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function foodColour(kind, brown, l = 1) {
  const base = kind === 'burnt' ? [74, 42, 20] : kind === 'expanded' ? [236, 214, 173] : kind === 'none' ? [216, 184, 140] : [226, 199, 160];
  const dark = [150, 100, 60]; const b = kind === 'burnt' ? 0 : Math.min(1, brown);
  return `rgb(${Math.round((base[0] + (dark[0] - base[0]) * b * 0.6) * l)},${Math.round((base[1] + (dark[1] - base[1]) * b * 0.6) * l)},${Math.round((base[2] + (dark[2] - base[2]) * b * 0.6) * l)})`;
}
function drawProduct() {
  if (!res || !pc) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1); const W = pc.clientWidth, H = pc.clientHeight; if (!W) return;
  if (pc.width !== Math.round(W * dpr) || pc.height !== Math.round(H * dpr)) { pc.width = Math.round(W * dpr); pc.height = Math.round(H * dpr); }
  const ctx = pc.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const P_ = palette(); const r = res; const kind = r.cls, AI = r.AI, fine = r.fineness, brown = r.brown;
  const rand = prng(7 + Math.round(AI * 100) + kind.length);
  const title = (t, x, y) => { ctx.fillStyle = P_.ink2 || P_.ink; ctx.font = '600 12px Inter, sans-serif'; ctx.fillText(t, x, y); };
  const cap = (t, x, y) => { ctx.fillStyle = P_.muted; ctx.font = '500 11px Inter, sans-serif'; ctx.fillText(t, x, y); };
  const pad = 4, gapC = 16;
  const wA = Math.round((W - gapC) * 0.4), wB = W - gapC - wA;
  const align = Math.max(0, Math.min(1, (AI - 0.95) / 0.7));
  // panel 1: transverse cut (30 mm wide, gap H, to scale)
  const x1 = pad, y1 = 26, w1 = wA - pad, h1 = Math.max(18, w1 * (P().Hd / 30)) * (kind === 'expanded' ? 1.5 : 1);
  title('Transverse cut (to scale)', x1, 14);
  ctx.fillStyle = foodColour(kind, brown); roundRect(ctx, x1, y1, w1, h1, 4); ctx.fill();
  ctx.save(); roundRect(ctx, x1, y1, w1, h1, 4); ctx.clip();
  if (kind === 'fibrous') {
    const nl = Math.max(3, Math.round(9 / fine)); for (let k = 1; k < nl; k++) { ctx.strokeStyle = `rgba(120,80,45,${0.2 + 0.3 * align})`; ctx.lineWidth = 1; ctx.beginPath(); const yy = y1 + h1 * k / nl; ctx.moveTo(x1, yy); for (let xx = 0; xx <= w1; xx += 8) ctx.lineTo(x1 + xx, yy + (rand() - 0.5) * 1.4); ctx.stroke(); }
    for (let k = 0; k < 200; k++) { ctx.fillStyle = `rgba(140,95,55,${0.25 + rand() * 0.3})`; ctx.beginPath(); ctx.ellipse(x1 + rand() * w1, y1 + rand() * h1, 1.1 * fine + rand() * 1.4, 0.5 + rand() * 0.5, 0, 0, 7); ctx.fill(); }
  } else if (kind === 'expanded') {
    for (let k = 0; k < 80; k++) { const rr = 1.5 + rand() * 5; ctx.fillStyle = 'rgba(120,85,45,0.55)'; ctx.beginPath(); ctx.ellipse(x1 + rand() * w1, y1 + rand() * h1, rr, rr * 0.8, 0, 0, 7); ctx.fill(); ctx.strokeStyle = 'rgba(255,240,215,0.5)'; ctx.stroke(); }
  } else if (kind === 'burnt') {
    ctx.strokeStyle = 'rgba(15,8,3,0.8)'; for (let k = 0; k < 12; k++) { ctx.beginPath(); let x = x1 + rand() * w1, y = y1 + rand() * h1; ctx.moveTo(x, y); for (let s = 0; s < 4; s++) { x += (rand() - 0.5) * 30; y += (rand() - 0.5) * 12; ctx.lineTo(x, y); } ctx.stroke(); }
  } else {
    for (let k = 0; k < 120; k++) { ctx.fillStyle = `rgba(150,110,70,${0.1 + rand() * 0.12})`; ctx.fillRect(x1 + rand() * w1, y1 + rand() * h1, 2, 2); }
  }
  ctx.restore();
  cap(kind === 'fibrous' ? 'layers parallel to the die walls' : kind === 'expanded' ? 'steam bubbles: porous, puffed' : kind === 'burnt' ? 'dark, brittle, cracked' : 'homogeneous, no layers', x1, y1 + h1 + 15);
  // panel 2: longitudinal cut
  const x2 = wA + gapC, y2 = 26, w2 = wB - pad, h2 = 64;
  title('Longitudinal cut (flow →)', x2, 14);
  ctx.fillStyle = foodColour(kind, brown); roundRect(ctx, x2, y2, w2, h2, 4); ctx.fill();
  ctx.save(); roundRect(ctx, x2, y2, w2, h2, 4); ctx.clip();
  if (kind === 'fibrous' || kind === 'none') {
    const n = kind === 'fibrous' ? Math.round(70 / fine) : 80;
    for (let k = 0; k < n; k++) {
      const yy = y2 + rand() * h2, len = (kind === 'fibrous' ? 30 + 110 * align : 6 + rand() * 10), x0 = x2 - 30 + rand() * (w2 + 30), ang = (1 - align) * (rand() - 0.5) * 2.2 + (kind === 'none' ? (rand() - 0.5) * 3 : 0);
      ctx.strokeStyle = `rgba(${130 + rand() * 40},${88 + rand() * 30},${50 + rand() * 20},${kind === 'fibrous' ? 0.45 : 0.25})`; ctx.lineWidth = kind === 'fibrous' ? 0.8 + fine * 0.9 : 1;
      ctx.beginPath(); ctx.moveTo(x0, yy); ctx.bezierCurveTo(x0 + len / 3 * Math.cos(ang), yy + len / 3 * Math.sin(ang) + (rand() - 0.5) * 2, x0 + 2 * len / 3 * Math.cos(ang), yy + 2 * len / 3 * Math.sin(ang) + (rand() - 0.5) * 2, x0 + len * Math.cos(ang), yy + len * Math.sin(ang)); ctx.stroke();
    }
  } else if (kind === 'expanded') {
    for (let k = 0; k < 70; k++) { const rr = 2 + rand() * 5; ctx.fillStyle = 'rgba(120,85,45,0.55)'; ctx.beginPath(); ctx.ellipse(x2 + rand() * w2, y2 + rand() * h2, rr * 1.8, rr, 0, 0, 7); ctx.fill(); }
  } else { ctx.strokeStyle = 'rgba(15,8,3,0.8)'; for (let k = 0; k < 10; k++) { ctx.beginPath(); ctx.moveTo(x2 + rand() * w2, y2); ctx.lineTo(x2 + rand() * w2, y2 + h2); ctx.stroke(); } }
  ctx.restore();
  cap(`fibre alignment ${fmt(align * 100, 0)} % · relative fibre thickness ×${fmt(fine, 2)}`, x2, y2 + h2 + 15);
  // panel 3: tearing test (full width)
  const y3 = 136, x3 = pad, w3 = W - 2 * pad, h3 = Math.max(50, H - y3 - 40);
  title('Tearing test: sample pulled apart across the flow direction', x3, y3 - 10);
  const gap = tearP * 34, mid = x3 + w3 / 2;
  ctx.fillStyle = P_.muted; ctx.fillRect(x3, y3 + h3 / 2 - 20, 10, 40); ctx.fillRect(x3 + w3 - 10, y3 + h3 / 2 - 20, 10, 40);
  const e1 = []; const nE = 16; for (let k = 0; k <= nE; k++) { const yy = y3 + h3 * k / nE; const j = kind === 'fibrous' ? (rand() - 0.5) * 18 * align + (k % 2 ? 7 : -7) * align : kind === 'expanded' ? (rand() - 0.5) * 12 : kind === 'burnt' ? (rand() - 0.5) * 3 : (rand() - 0.5) * 5; e1.push([j, yy]); }
  ctx.fillStyle = foodColour(kind, brown);
  const halves = new Path2D();
  halves.moveTo(x3 + 10, y3); e1.forEach(([j, yy]) => halves.lineTo(mid - gap / 2 + j, yy)); halves.lineTo(x3 + 10, y3 + h3); halves.closePath();
  halves.moveTo(x3 + w3 - 10, y3); e1.forEach(([j, yy]) => halves.lineTo(mid + gap / 2 + j, yy)); halves.lineTo(x3 + w3 - 10, y3 + h3); halves.closePath();
  ctx.fill(halves);
  if (kind !== 'fibrous') {
    ctx.save(); ctx.clip(halves);
    if (kind === 'expanded') for (let k = 0; k < 160; k++) { const rr = 1.5 + rand() * 5; ctx.fillStyle = 'rgba(120,85,45,0.5)'; ctx.beginPath(); ctx.ellipse(x3 + rand() * w3, y3 + rand() * h3, rr * 1.5, rr, 0, 0, 7); ctx.fill(); }
    else if (kind === 'burnt') { ctx.strokeStyle = 'rgba(15,8,3,0.8)'; for (let k = 0; k < 16; k++) { ctx.beginPath(); let x = x3 + rand() * w3, y = y3 + rand() * h3; ctx.moveTo(x, y); for (let s = 0; s < 4; s++) { x += (rand() - 0.5) * 40; y += (rand() - 0.5) * 16; ctx.lineTo(x, y); } ctx.stroke(); } }
    else for (let k = 0; k < 260; k++) { ctx.fillStyle = `rgba(150,110,70,${0.1 + rand() * 0.12})`; ctx.fillRect(x3 + rand() * w3, y3 + rand() * h3, 2, 2); }
    ctx.restore();
  }
  if (kind === 'fibrous') { ctx.strokeStyle = 'rgba(130,88,50,0.35)'; ctx.lineWidth = 1; for (let k = 0; k < 18; k++) { const yy = y3 + 3 + rand() * (h3 - 6); ctx.beginPath(); ctx.moveTo(x3 + 12, yy); ctx.lineTo(mid - gap / 2 - 8, yy + (rand() - 0.5) * 2); ctx.moveTo(mid + gap / 2 + 8, yy); ctx.lineTo(x3 + w3 - 12, yy + (rand() - 0.5) * 2); ctx.stroke(); } }
  if (kind === 'fibrous' && tearP > 0) {
    const nb = Math.round(10 + 22 * align); for (let k = 0; k < nb; k++) { const yy = y3 + 4 + rand() * (h3 - 8), br = rand() < tearP * 0.8; ctx.strokeStyle = 'rgba(150,105,65,0.85)'; ctx.lineWidth = 0.8 + fine; ctx.beginPath(); ctx.moveTo(mid - gap / 2, yy); if (br) { ctx.lineTo(mid - gap / 2 + gap * 0.35, yy + (rand() - 0.5) * 3); ctx.moveTo(mid + gap / 2, yy); ctx.lineTo(mid + gap / 2 - gap * 0.35, yy + (rand() - 0.5) * 3); } else ctx.lineTo(mid + gap / 2, yy + (rand() - 0.5) * 2); ctx.stroke(); }
  }
  if ((kind === 'expanded' || kind === 'burnt') && tearP > 0.2) { for (let k = 0; k < 14; k++) { ctx.fillStyle = foodColour(kind, brown, 0.85); ctx.beginPath(); ctx.arc(mid + (rand() - 0.5) * gap, y3 + h3 + 4 + rand() * 10 * tearP, 1.5 + rand() * 2, 0, 7); ctx.fill(); } }
  const desc = { fibrous: 'tears into fibre bundles that bridge the crack, like cooked chicken breast', none: 'breaks cleanly, like a gel or a dough', expanded: 'crumbles: a porous, spongy matrix', burnt: 'brittle fracture with dark crumbs' }[kind];
  cap(tearP > 0 ? desc : 'press “Tear the sample” to pull the clamps apart', x3, y3 + h3 + 16);
  const ai = AI >= 1.02 ? `cutting across the fibres needs ${fmt((AI - 1) * 100, 0)} % more force than cutting along them` : 'no preferred direction';
  document.getElementById('product-summary').innerHTML = `<b>${CLS[kind].label}</b> — ${r.why}. Anisotropy index F<sub>T</sub>/F<sub>L</sub> = <b>${fmt(AI, 2)}</b> (model: ${ai}).`;
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
new ResizeObserver(() => drawProduct()).observe(pc);

/* ------------------------------------------------------------ wiring */
ui.onChange((s, id) => {
  if (id === 'speed') { clock.speed = +s.speed; return; }
  if (id === 'view') { api.setView(s.view); updateScene(); return; }
  if (id === 'colour' || id === 'labels') { updateScene(); return; }
  if (id === 'Tc' || id === 'mat') { /* zones follow with a lag */ }
  recompute();
});
api.setView(P().view);
settle();
clock.play();
