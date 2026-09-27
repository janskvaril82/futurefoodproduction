/* Stomata and transpiration — leaf energy balance, coupled stomatal model and two 3D views
   (an epidermis close-up in µm and a whole leaf in an air stream in cm).
   Model: ./model.js (Derive tab, Eqs. S1–S11). 3D: ./epidermis.js, ./wholeleaf.js. */
import { createStage, THREE, fitShadow } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, BarChart, linspace } from '/assets/js/plot.js';
import { colormapGradient } from '/assets/js/colors.js';
import { svp, vapourPressure, dewPoint } from '/assets/js/physics.js';
import { gradientBackground } from '/laboratories/leaf-photosynthesis/anatomy.js';
import * as SM from './model.js';
import { buildEpidermis } from './epidermis.js';
import { buildWholeLeaf } from './wholeleaf.js';

const hhmm = h => { h = ((h % 24) + 24) % 24; const hh = Math.floor(h), mm = Math.floor((h % 1) * 60 + 1e-6); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };

/* ================================================================ UI */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'gs', label: 'Stomatal conductance gₛ', unit: 'mol m⁻² s⁻¹', digits: 3 })
  .add({ id: 'E', label: 'Transpiration E', unit: 'mmol m⁻² s⁻¹', digits: 2 })
  .add({ id: 'TL', label: 'Leaf temperature', unit: '°C', digits: 1 })
  .add({ id: 'vpd', label: 'Leaf-to-air VPD', unit: 'kPa', digits: 2 })
  .add({ id: 'gb', label: 'Boundary-layer conductance g<sub>bv</sub>', unit: 'mol m⁻² s⁻¹', digits: 2 })
  .add({ id: 'A', label: 'Net photosynthesis A', unit: 'µmol m⁻² s⁻¹', digits: 1 })
  .add({ id: 'eb', label: 'Net radiation → H + λE', unit: 'W m⁻²', format: v => v })
  .add({ id: 'omega', label: 'Decoupling coefficient Ω', unit: '', digits: 2 })
  .add({ id: 'pore', label: 'Stomatal pore width', unit: 'µm', digits: 2 });

ui.section('Air around the leaf');
ui.slider({ id: 'Ta', label: 'Air temperature T<sub>a</sub>', min: 5, max: 40, step: 0.5, value: 24, unit: '°C' });
ui.slider({ id: 'rh', label: 'Relative humidity', min: 10, max: 98, step: 1, value: 60, unit: '%', help: 'Sets the vapour pressure e<sub>a</sub> of the air (kept constant through a simulated day)' });
ui.slider({ id: 'u', label: 'Wind (air speed)', min: 0.05, max: 5, log: true, value: 0.3, unit: 'm s⁻¹', format: v => fmt(v, v < 1 ? 2 : 1), help: 'Still greenhouse air ≈ 0.1 · recommended in plant factories ≥ 0.3 · breezy field 2–5' });
ui.slider({ id: 'co2', label: 'CO₂ in the air', min: 200, max: 2000, step: 5, value: 425, unit: 'ppm' });
ui.section('Light and radiation');
ui.segmented({ id: 'src', label: 'Light source', options: [{ value: 'sun', label: 'Sun' }, { value: 'led', label: 'LED' }], value: 'sun', help: 'Sunlight carries ≈ 55 % of its energy as near-infrared; LEDs deliver almost only PAR, so the same PPFD heats the leaf less' });
ui.slider({ id: 'ppfd', label: 'PPFD on the leaf', min: 0, max: 2000, step: 10, value: 900, unit: 'µmol m⁻² s⁻¹', help: 'In a day simulation this is the midday value' });
ui.segmented({ id: 'sur', label: 'Surroundings (long-wave)', options: [{ value: 'room', label: 'Room / greenhouse' }, { value: 'sky', label: 'Open sky' }], value: 'room', help: 'A clear sky is much colder than the air (emissivity ≈ 0.7–0.8): leaves lose heat to it' });
ui.section('Leaf and water');
ui.slider({ id: 'w', label: 'Leaf width', min: 1, max: 30, step: 0.5, value: 10, unit: 'cm', help: 'Characteristic dimension d = 0.72 × width (Campbell &amp; Norman 1998)' });
ui.segmented({ id: 'side', label: 'Stomata on', options: [{ value: 'amphi', label: 'Both sides (lettuce)' }, { value: 'hypo', label: 'Lower side only' }], value: 'amphi' });
ui.slider({ id: 'rew', label: 'Root-zone water (relative extractable water)', min: 0, max: 100, step: 1, value: 100, unit: '%', help: 'Below 40 % the root-sourced ABA signal closes stomata (drought factor β = REW/0.4)' });
ui.slider({ id: 'g1', label: 'Stomatal slope g₁ (Medlyn)', min: 1, max: 10, step: 0.1, value: 5.8, unit: 'kPa^½', help: 'C3 crops ≈ 5.8 (Lin et al. 2015); lower = more conservative water use' });
ui.section('Day course');
ui.slider({ id: 'daylen', label: 'Day length / photoperiod', min: 8, max: 20, step: 0.5, value: 16, unit: 'h' });
ui.slider({ id: 'tswing', label: 'Day–night air-temperature swing', min: 0, max: 8, step: 0.5, value: 4, unit: '± °C' });
ui.slider({ id: 'tau', label: 'Stomatal response time τ', min: 2, max: 30, step: 1, value: 10, unit: 'min', help: 'Stomata need minutes to tens of minutes to follow a change (Lawson &amp; Blatt 2014)' });
ui.segmented({ id: 'speed', label: 'Clock speed', options: [{ value: 600, label: '10 min/s' }, { value: 1800, label: '30 min/s' }, { value: 3600, label: '1 h/s' }], value: 1800, persist: false });
const [playBtn] = ui.buttons([{ label: '▶ Play the day', variant: 'primary', onClick: () => togglePlay() }, { label: 'Steady state', onClick: () => toSteady() }]);
ui.section('3D view');
ui.segmented({ id: 'view', label: 'Scale', options: [{ value: 'epi', label: 'Epidermis (µm)' }, { value: 'leaf', label: 'Whole leaf (cm)' }], value: 'epi', persist: false, onChange: v => setView(v) });
ui.toggle({ id: 'thermal', label: 'Thermal camera (whole leaf)', value: true, persist: false });
ui.toggle({ id: 'bl', label: 'Show the boundary layer', value: true, persist: false });
ui.toggle({ id: 'plumes', label: 'Water-vapour plumes', value: true, persist: false });
ui.toggle({ id: 'molecules', label: 'H₂O and CO₂ molecules', value: true, persist: false });
ui.toggle({ id: 'flow', label: 'Air-flow tracers', value: true, persist: false });
ui.toggle({ id: 'labels', label: 'Labels', value: true, persist: false });
ui.buttons([{ label: 'Overview', onClick: () => camTour('overview') }, { label: 'Close-up', onClick: () => camTour('close') }, { label: 'Side', onClick: () => camTour('side') }]);
const PRESETS = [
  { label: 'Sunny greenhouse, noon', values: { src: 'sun', ppfd: 900, Ta: 24, rh: 60, u: 0.3, co2: 425, sur: 'room', rew: 100, w: 10, side: 'amphi' } },
  { label: 'Plant factory (LED, CO₂)', values: { src: 'led', ppfd: 250, Ta: 22, rh: 70, u: 0.3, co2: 1000, sur: 'room', rew: 100, w: 10, side: 'amphi', tswing: 1 } },
  { label: 'Tipburn risk: humid, still air', values: { src: 'led', ppfd: 350, Ta: 22, rh: 90, u: 0.05, co2: 1000, sur: 'room', rew: 100, w: 10, side: 'amphi', tswing: 1 } },
  { label: 'Hot, dry, windy field', values: { src: 'sun', ppfd: 1800, Ta: 33, rh: 30, u: 2, co2: 425, sur: 'sky', rew: 100, w: 10, side: 'amphi', tswing: 6 } },
  { label: 'Drying root zone', values: { src: 'sun', ppfd: 900, Ta: 26, rh: 50, u: 0.3, co2: 425, sur: 'room', rew: 15, w: 10, side: 'amphi' } },
  { label: 'Clear, calm night', values: { src: 'sun', ppfd: 0, Ta: 10, rh: 85, u: 0.2, co2: 425, sur: 'sky', rew: 100, w: 10, side: 'amphi' } }
];
ui.presets(PRESETS);
ui.saveButton('stomata-transpiration', () => ro.values());

/* ================================================================ model helpers */
const envFrom = (p, over = {}) => Object.assign({ Ta: p.Ta, ea: vapourPressure(p.Ta, p.rh), u: p.u, w: p.w / 100, ppfd: p.ppfd, src: p.src, sur: p.sur, co2: p.co2, amphi: p.side === 'amphi', beta: SM.betaFromREW(p.rew / 100), P: 101.325 }, over);
const leafFrom = p => Object.assign({}, SM.LEAF, { g1: p.g1 });
const dayParams = p => Object.assign(envFrom(p), { daylen: p.daylen, tswing: p.tswing });
const state = { mode: 'steady', res: null, env: null, day: null, dayKey: '', k: 0.15, kTarget: 0.15, hour: 12, view: 'epi', lastThermal: 0, thermalKey: '' };

/* ================================================================ 3D stage */
const stage = createStage('#stage', {
  background: null, envIntensity: 0.35, exposure: 1.0,
  camera: { pos: [60, 150, 205], target: [0, -6, 8], fov: 38, near: 0.5, far: 6000 },
  controls: { minDistance: 18, maxDistance: 700, maxPolarAngle: Math.PI * 0.49 },
  bloom: { strength: 0.35, radius: 0.5, threshold: 1.0 }, ao: { radius: 5, intensity: 0.85 },
  hint: 'Drag to orbit · scroll to zoom · click a guard cell or the leaf'
});
const { scene, camera, controls, renderer } = stage;
const bgEpi = gradientBackground('#17331f', '#030805'), bgLeaf = gradientBackground('#232a27', '#050706');
scene.background = bgEpi;
const hemi = new THREE.HemisphereLight(0xe8fff0, 0x0d1a10, 0.55); scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff3e0, 2.2); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xa9dcff, 0.7); scene.add(rim);
const hud = hudChips(stage.el);
const legend = document.createElement('div'); legend.className = 'stage-legend'; stage.el.appendChild(legend);
const info = document.createElement('div'); info.className = 'hud-chip';
Object.assign(info.style, { position: 'absolute', right: '12px', top: '56px', maxWidth: '300px', zIndex: 5, display: 'none', font: '500 .78rem var(--font-sans)', lineHeight: '1.45', pointerEvents: 'none', whiteSpace: 'normal' });
stage.el.appendChild(info);

const epi = buildEpidermis({ W: 260, D: 180, seed: 11, nStomata: 6 });
SM.ANAT.density = epi.density; SM.ANAT.wMax = epi.GC.wMax * 1e-6;
scene.add(epi.group);
const leafV = buildWholeLeaf(stage); leafV.group.visible = false; scene.add(leafV.group);

// labels in the epidermis view
const st0 = [...epi.stomata].sort((a, b) => (b.z + 0.3 * b.x) - (a.z + 0.3 * a.x))[0];
const epiLabels = {
  guard: stage.addLabel([st0.x, 9, st0.z], 'Guard-cell pair'),
  pave: stage.addLabel([-epi.W / 2 + 34, 6, epi.D / 2 - 30], 'Pavement cell (jigsaw)'),
  cut: stage.addLabel([epi.W / 2 - 40, 6, -epi.D / 2 + 26], 'Cuticle with wax striations'),
  vap: stage.addLabel([st0.x + 16, 46, st0.z], 'Water-vapour plume'),
  bar: stage.addLabel([epi.W / 2 - 32, 4, epi.D / 2 + 15], '50 µm')
};
Object.values(epiLabels).forEach(l => epi.group.add(l));

const VIEWS = {
  epi: { home: [[60, 150, 205], [0, -6, 8]], ctl: [18, 700], shadow: 170, keyPos: [140, 260, 90], rimPos: [-160, 90, -120], ao: 5 },
  leaf: { home: [[14, 18, 28], [-1.5, -3.2, -1]], ctl: [6, 220], shadow: 45, keyPos: [22, 60, 26], rimPos: [-40, 20, -30], ao: 1.2 }
};
const TOURS = {
  epi: { overview: VIEWS.epi.home, close: [[st0.x + 14, 34, st0.z + 38], [st0.x, 1, st0.z]], side: [[st0.x - 10, 22, st0.z + 150], [st0.x + 10, 20, st0.z]] },
  leaf: { overview: VIEWS.leaf.home, close: [[-7, 8, 13], [-3, 0, 0]], side: [[0, 3, 36], [2, 1, 0]] }
};
function applyViewLights(v) {
  const V = VIEWS[v];
  key.position.set(...V.keyPos); key.target.position.set(0, 0, 0); fitShadow(key, V.shadow, [0, 0, 0]);
  key.shadow.camera.near = 1; key.shadow.camera.far = v === 'epi' ? 800 : 200; key.shadow.camera.updateProjectionMatrix();
  rim.position.set(...V.rimPos);
  // GTAO also "sees" the translucent boundary-layer shell and would darken the blade under it: use AO only for the epidermis
  if (stage.aoPass) { stage.aoPass.updateGtaoMaterial({ radius: V.ao }); stage.aoPass.enabled = v === 'epi' && stage.quality === 'high'; }
}
applyViewLights('epi');
let busy = false;
async function setView(v) {
  if (busy || v === state.view) return; busy = true;
  state.view = v; const V = VIEWS[v];
  epi.group.visible = v === 'epi'; leafV.group.visible = v === 'leaf';
  scene.background = v === 'epi' ? bgEpi : bgLeaf;
  controls.minDistance = V.ctl[0]; controls.maxDistance = V.ctl[1];
  applyViewLights(v);
  const far = new THREE.Vector3(...V.home[0]).multiplyScalar(1.8);
  camera.position.copy(far); controls.target.set(...V.home[1]); controls.update();
  stage.setHome(...V.home);
  ui.set('view', v, true);
  refreshScene(true);
  await stage.flyTo(...V.home, 1.2);
  busy = false;
}
function camTour(k) { stage.flyTo(...TOURS[state.view][k], 1.4); }

/* ================================================================ charts */
const evpd = new Plot('#chart-evpd', { x: { label: 'Vapour-pressure deficit of the air', unit: 'kPa', min: 0 }, y: { label: 'Transpiration E', unit: 'mmol m⁻² s⁻¹', min: 0 }, y2: { label: 'Stomatal conductance', unit: 'mol m⁻² s⁻¹', min: 0 } });
const dtw = new Plot('#chart-dtwind', { x: { label: 'Wind speed', unit: 'm s⁻¹', log: true, min: 0.05, max: 5 }, y: { label: 'T_leaf − T_air', unit: '°C' } });
const dayP = new Plot('#chart-day', { x: { label: 'Time of day', unit: 'h', min: 0, max: 24, format: v => hhmm(v) }, y: { label: 'Stomatal conductance gₛ', unit: 'mol m⁻² s⁻¹', min: 0 }, y2: { label: 'Transpiration E', unit: 'mmol m⁻² s⁻¹', min: 0 } });
const ebar = new BarChart('#chart-energy', { y: { label: 'Energy flux (+ gain, − loss)', unit: 'W m⁻²' }, horizontal: true, legend: false, height: 260 });
let psy = null;
const psyEl = document.getElementById('fig-psy');
if (psyEl) psy = new Plot(psyEl, { x: { label: 'Temperature', unit: '°C', min: 0, max: 45 }, y: { label: 'Vapour pressure', unit: 'kPa', min: 0, max: 8 }, height: 330 });

function drawSweepCharts(p) {
  const env = envFrom(p), leaf = leafFrom(p), r = state.res;
  // E versus VPD (RH varied at the current air temperature)
  const es = svp(p.Ta); const Ds = linspace(0.08, 0.95 * es, 40);
  const co = Ds.map(D => SM.steadyLeaf(envFrom(p, { ea: es - D }), leaf));
  const fx = Ds.map(D => SM.leafWithGs(envFrom(p, { ea: es - D }), r.gs, leaf));
  evpd.line('co', Ds, co.map(x => x.Emmol), { color: 'accent', width: 2.8, label: 'Stomata respond (Medlyn + energy balance)' });
  evpd.line('fx', Ds, fx.map(x => x.Emmol), { color: 'water', width: 2, dash: [7, 4], label: `gₛ held at ${fmt(r.gs, 2)} mol m⁻² s⁻¹` });
  evpd.line('gs', Ds, co.map(x => x.gs), { color: 'muted', width: 1.4, dash: [2, 3], y2: true, label: 'gₛ (right axis)' });
  evpd.point('now', r.Dair, r.Emmol, { color: 'accent', r: 6, guides: true, label: 'now' });
  evpd.setAxis('x', { min: 0, max: Math.ceil(es * 10) / 10 });
  // T_leaf − T_air versus wind speed
  const us = []; for (let i = 0; i <= 36; i++) us.push(0.05 * Math.pow(100, i / 36));
  dtw.line('co', us, us.map(u => SM.steadyLeaf(envFrom(p, { u }), leaf).dT), { color: 'accent', width: 2.8, label: 'Current leaf' });
  dtw.line('closed', us, us.map(u => SM.leafWithGs(envFrom(p, { u }), leaf.g0, leaf).dT), { color: 'danger', width: 2, dash: [7, 4], label: 'Stomata closed (gₛ = g₀)' });
  dtw.line('dark', us, us.map(u => SM.steadyLeaf(envFrom(p, { u, ppfd: 0 }), leaf).dT), { color: 'water', width: 1.8, dash: [2, 3], label: 'Same air, no light' });
  dtw.hline('zero', 0, { color: 'muted', dash: [2, 3] });
  dtw.point('now', p.u, r.dT, { color: 'accent', r: 6, guides: true });
}
function drawDayChart(p) {
  const d = state.day; if (!d) return;
  dayP.clear();
  // light period shading
  const on = 12 - p.daylen / 2, off = 12 + p.daylen / 2;
  dayP.region('light', on, off, { color: 'amber', alpha: 0.1, label: p.src === 'led' ? 'lights on' : 'daylight' });
  dayP.line('gss', d.h, d.gss, { color: 'muted', width: 1.3, dash: [4, 3], label: 'steady-state target' });
  dayP.line('gs', d.h, d.gs, { color: 'accent', width: 2.8, label: `gₛ (τ = ${p.tau} min)` });
  dayP.line('E', d.h, d.E, { color: 'water', width: 2, y2: true, label: 'E (right axis)' });
  if (state.mode === 'day') dayP.vline('now', state.hour, { color: 'magenta', label: hhmm(state.hour) });
  const tot = d.totals;
  document.getElementById('day-totals').innerHTML = `Per m² of leaf over 24 h: <b>${fmt(tot.waterL, 2)} L</b> of water transpired · <b>${fmt(tot.carbonMol * 1000, 0)} mmol</b> CO₂ fixed (net) · daily WUE <b>${fmt(tot.wue, 2)}</b> µmol CO₂ per mmol H₂O · DLI ${fmt(tot.dli, 1)} mol m⁻² d⁻¹`;
}
function drawPsy(env, r) {
  if (!psy) return;
  const Ts = linspace(0, 45, 91);
  psy.line('sat', Ts, Ts.map(svp), { color: 'ink', width: 2.2, label: 'Saturation vapour pressure eₛ(T)' });
  [75, 50, 25].forEach(h => psy.line('rh' + h, Ts, Ts.map(T => svp(T) * h / 100), { color: 'muted', width: 1, dash: [3, 4], noLegend: true }));
  psy.text('l75', 38, svp(38) * 0.75, '75 %', { color: 'muted', size: 10.5, dx: 4 }); psy.text('l50', 40, svp(40) * 0.5, '50 %', { color: 'muted', size: 10.5, dx: 4 }); psy.text('l25', 41, svp(41) * 0.25, '25 % RH', { color: 'muted', size: 10.5, dx: 4 });
  const Td = dewPoint(env.Ta, 100 * env.ea / svp(env.Ta));
  psy.custom('arrow', (ctx, pl, P) => {
    const x0 = pl.px(env.Ta), y0 = pl.py(env.ea), x1 = pl.px(r.TL), y1 = pl.py(svp(r.TL));
    ctx.strokeStyle = P.magenta; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1 - 4, y1 + 7); ctx.lineTo(x1, y1); ctx.lineTo(x1 + 4, y1 + 7); ctx.stroke();
    ctx.fillStyle = P.magenta; ctx.font = '600 11px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`leaf-to-air VPD ${r.Dleaf.toFixed(2)} kPa`, x1 + 7, (y0 + y1) / 2);
    ctx.strokeStyle = P.water; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(pl.px(Td), y0); ctx.lineTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke(); ctx.setLineDash([]);
  });
  psy.point('air', env.Ta, env.ea, { color: 'water', r: 6, label: `air ${env.Ta.toFixed(1)} °C` });
  psy.point('leaf', r.TL, svp(r.TL), { color: 'accent', r: 6, label: `leaf ${r.TL.toFixed(1)} °C` });
  psy.point('dew', Td, env.ea, { color: 'muted', r: 4, label: `dew point ${Td.toFixed(1)} °C` });
}

/* ================================================================ state display */
function show(env, r, p) {
  state.res = r; state.env = env;
  const gmax = 2 * SM.gSideMax() / (env.amphi ? 1 : 2);
  ro.set('gs', r.gs, r.gs > 0.15 ? 'ok' : r.gs > 0.05 ? 'warn' : 'bad', `${fmt(100 * r.gs / gmax, 0)} % of the anatomical maximum · drought factor β = ${fmt(env.beta, 2)}`);
  ro.set('E', r.Emmol, r.dew ? 'warn' : null, r.dew ? 'negative: dew is condensing on the leaf' : `= ${fmt(r.E * 18.015 * 3600, 0)} g m⁻² h⁻¹ · λE = ${fmt(r.LE, 0)} W m⁻²`);
  const dT = r.dT; ro.set('TL', r.TL, Math.abs(dT) < 2 ? 'ok' : Math.abs(dT) < 5 ? 'warn' : 'bad', `${dT >= 0 ? '+' : '−'}${fmt(Math.abs(dT), 2)} °C ${dT >= 0 ? 'above' : 'below'} the air`);
  ro.set('vpd', r.Dleaf, r.Dleaf < 0.3 ? 'warn' : r.Dleaf <= 1.5 ? 'ok' : r.Dleaf <= 2.5 ? 'warn' : 'bad', `air VPD ${fmt(r.Dair, 2)} kPa · RH ${fmt(100 * env.ea / svp(env.Ta), 0)} %`);
  ro.set('gb', r.gbV, null, `per side · δ ≈ ${fmt(r.delta * 1000, 1)} mm · free convection ${fmt(100 * r.freeShare, 0)} %`);
  ro.set('A', r.A, r.A > 8 ? 'ok' : r.A > 0 ? 'warn' : 'bad', `WUE A/E = ${r.Emmol > 0.01 ? fmt(r.A / r.Emmol, 2) : '—'} µmol mmol⁻¹ · Cᵢ ${fmt(r.Ci, 0)} ppm`);
  ro.set('eb', `${fmt(r.Rn, 0)} → ${fmt(r.H, 0)} + ${fmt(r.LE, 0)}`, null, `Bowen ratio H/λE = ${Math.abs(r.LE) > 1 ? fmt(r.bowen, 2) : '—'}`);
  ro.set('omega', r.omega, null, r.omega < 0.35 ? 'well coupled: stomata control transpiration' : r.omega > 0.65 ? 'decoupled: radiation controls transpiration' : 'intermediate coupling');
  ro.set('pore', r.poreW * 1e6, null, `${env.amphi ? 'each side carries gₛ/2' : 'all gₛ through the lower side'} · max ${fmt(SM.ANAT.wMax * 1e6, 0)} µm`);
  state.kTarget = Math.min(1, r.poreW / SM.ANAT.wMax);
  hud.set('g', `g<sub>s</sub> <b>${fmt(r.gs, 3)}</b> · E <b>${fmt(r.Emmol, 2)}</b> mmol m⁻² s⁻¹`);
  hud.set('t', `T<sub>leaf</sub> <b>${fmt(r.TL, 1)}</b> °C · air ${fmt(env.Ta, 1)} °C · ${state.mode === 'day' ? 'clock <b>' + hhmm(state.hour) + '</b>' : 'steady state'}`);
  ebar.set(['Absorbed short-wave', 'Net long-wave', 'Sensible heat H', 'Latent heat λE'], [{ label: 'Flux', values: [r.Rsw, r.Rlw - r.emit, -r.H, -r.LE], colors: ['amber', 'magenta', 'danger', 'water'] }]);
  const en = document.getElementById('energy-note');
  if (en) en.innerHTML = `Long-wave radiation flows both ways: the leaf absorbs <b>${fmt(r.Rlw, 0)}</b> W m⁻² from ${env.sur === 'sky' ? 'the sky and the ground' : 'the walls, roof and floor'} and emits <b>${fmt(r.emit, 0)}</b> W m⁻²; the bar shows the difference. Net radiation R<sub>n</sub> = ${fmt(r.Rn, 0)} W m⁻² = H + λE = ${fmt(r.H, 0)} + ${fmt(r.LE, 0)}.`;
  drawPsy(env, r);
}
function refreshScene(force) {
  const p = ui.values(), r = state.res, env = state.env; if (!r) return;
  leafV.setSource(env.src, env.ppfd);
  leafV.setThermal(p.thermal);
  if (p.view === 'leaf' || state.view === 'leaf') {
    const key = [r.gs.toFixed(4), env.Ta.toFixed(2), env.ea.toFixed(3), env.u, env.w, env.ppfd.toFixed(0), env.src, env.sur, env.amphi].join('|');
    const now = performance.now();
    if (force || (key !== state.thermalKey && now - state.lastThermal > 220)) {
      state.thermalKey = key; state.lastThermal = now;
      const th = leafV.thermal(env, r.gs);
      legend.innerHTML = p.thermal ? `Leaf surface temperature (°C)<div class="cbar" style="background:${colormapGradient('inferno')}"></div><div class="cbar-ticks"><span>${th.lo.toFixed(1)}</span><span>${((th.lo + th.hi) / 2).toFixed(1)}</span><span>${th.hi.toFixed(1)}</span></div>` : legendEpi();
    }
  } else legend.innerHTML = legendEpi();
  // light level shown by the key light (visual only)
  const lf = Math.min(1, env.ppfd / 1400);
  key.intensity = 0.5 + 2.2 * Math.sqrt(lf); key.color.setHSL(env.src === 'led' ? 0.93 : 0.1, env.src === 'led' ? 0.35 : 0.5, 0.92);
  hemi.intensity = 0.35 + 0.35 * Math.sqrt(lf);
  applyLabels();
}
const legendEpi = () => `<span style="display:inline-flex;align-items:center;gap:6px"><i style="width:10px;height:10px;border-radius:50%;background:#dff4ff;display:inline-block;box-shadow:0 0 6px #bfe8ff"></i>water vapour (rate ∝ E)</span><br><span style="display:inline-flex;align-items:center;gap:6px"><i style="width:10px;height:10px;border-radius:50%;background:#9aa3ad;display:inline-block"></i>CO₂ entering (rate ∝ A)</span>`;
function applyLabels() { const on = ui.get('labels'); Object.values(epiLabels).forEach(l => { l.visible = on; }); }

/* ================================================================ recompute */
let chartT = null, dayT = null;
function recompute(p = ui.values()) {
  if (state.mode === 'steady') { const env = envFrom(p); show(env, SM.steadyLeaf(env, leafFrom(p)), p); }
  else showDayState(state.hour, true);
  leafV.setWidth(p.w);
  refreshScene(true);
  clearTimeout(chartT); chartT = setTimeout(() => drawSweepCharts(ui.values()), 90);
  const dk = JSON.stringify([p.Ta, p.rh, p.u, p.co2, p.src, p.ppfd, p.sur, p.w, p.side, p.rew, p.g1, p.daylen, p.tswing, p.tau]);
  if (dk !== state.dayKey) { clearTimeout(dayT); dayT = setTimeout(() => { state.dayKey = dk; const q = ui.values(); state.day = SM.simulateDay(dayParams(q), leafFrom(q), { dt: 180, tau: q.tau * 60 }); drawDayChart(q); if (state.mode === 'day') showDayState(state.hour, true); }, 160); }
}
function showDayState(h, force) {
  const p = ui.values(); if (!state.day) return;
  const env = SM.envAt(dayParams(p), h);
  const gs = SM.dayAt(state.day, 'gs', h);
  const r = SM.leafWithGs(env, gs, leafFrom(p));
  show(env, r, p);
  if (force) refreshScene(false);
}

/* ================================================================ clock */
const clock = new SimClock({ speed: 1800, onFrame: t => { state.hour = (t / 3600) % 24; } });
clock.onState(run => { playBtn.innerHTML = run ? '❚❚ Pause the day' : '▶ Play the day'; });
function togglePlay() {
  if (state.mode !== 'day') { state.mode = 'day'; if (clock.t === 0) clock.reset(6 * 3600); }
  clock.speed = +ui.get('speed'); clock.toggle();
}
function toSteady() { clock.pause(); state.mode = 'steady'; recompute(); drawDayChart(ui.values()); }
let lastDayUi = 0;

ui.onChange((s, id) => {
  if (id === 'view') return;
  if (id === 'speed') { clock.speed = +s.speed; return; }
  if (['thermal', 'bl', 'plumes', 'molecules', 'flow', 'labels'].includes(id)) { refreshScene(true); return; }
  recompute(s);
});

/* ================================================================ picking */
const INFO = {
  guard: ['Guard-cell pair', 'Two kidney-shaped cells that swell (pore opens) when they take up K⁺, Cl⁻ and malate and water, and shrink when ABA or darkness makes them lose solutes. Unlike pavement cells they contain chloroplasts. The pore width shown is computed from the model’s gₛ with the pore-diffusion equation (S11).'],
  pavement: ['Pavement cells', 'Interlocking “jigsaw” epidermal cells. Their wavy anticlinal walls make the thin epidermis mechanically strong. They are transparent (the green is the mesophyll below) and covered by a waxy cuticle with fine striations that repel water.'],
  leaf: ['Leaf in the air stream', 'Air slows down close to the surface: a boundary layer through which heat and water vapour must diffuse. It is thinnest at the upwind (leading) edge and thickens downstream, so the leading edge exchanges heat fastest and stays closest to air temperature.'],
  meter: ['Thermocouple meter', 'A fine-wire thermocouple touching the underside of the leaf. It reads the modelled mean leaf temperature.']
};
stage.onPick({
  objects: () => state.view === 'epi' ? epi.pickables : leafV.pickables,
  onClick: hit => {
    if (!hit) { info.style.display = 'none'; return; }
    let k = hit.object.userData.kind || (hit.object === leafV.pickables[1] ? 'meter' : null); if (!INFO[k]) return;
    let extra = '';
    if (k === 'leaf' && hit.uv && state.res) extra = `<br><span style="color:#9be7b6">You clicked ≈ ${fmt(hit.uv.x * 100, 0)} % of the way across the blade from the upwind edge.</span>`;
    if (k === 'guard') extra = `<br><span style="color:#9be7b6">Now: pore ${fmt(state.res.poreW * 1e6, 2)} µm wide · gₛ ${fmt(state.res.gs, 3)} mol m⁻² s⁻¹.</span>`;
    info.innerHTML = `<b style="color:#9be7b6">${INFO[k][0]}</b><br>${INFO[k][1]}${extra}`; info.style.display = 'block';
    clearTimeout(info._t); info._t = setTimeout(() => { info.style.display = 'none'; }, 10000);
  }
});

/* ================================================================ animation */
stage.onFrame((dt, t) => {
  const p = ui.values();
  if (state.mode === 'day' && clock.running) {
    const now = performance.now();
    if (now - lastDayUi > 120) { lastDayUi = now; showDayState(state.hour, false); refreshScene(false); dayP.vline('now', state.hour, { color: 'magenta', label: hhmm(state.hour) }); }
  }
  state.k += (state.kTarget - state.k) * Math.min(1, dt * 2.2);
  const r = state.res; if (!r) return;
  const hPx = renderer.domElement.height;
  if (state.view === 'epi') epi.update(dt, t, { k: state.k, E: r.Emmol, A: r.A, wind: p.u, plumes: p.plumes, molecules: p.molecules }, camera, hPx);
  else leafV.update(dt, t, { u: p.u, E: r.Emmol, deltaMm: r.delta * 1000, showFlow: p.flow, showVapour: p.plumes, showBL: p.bl, amphi: p.side === 'amphi', TL: r.TL, Ta: state.env.Ta, dTfree: r.freeShare * Math.max(0, r.dT) / 3 }, camera, hPx);
});

recompute();
window.__stomataLab = { ui, state, SM, setView, epi, leafV, clock };
