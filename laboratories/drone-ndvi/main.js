/* Drone NDVI survey — flagship 3D laboratory.
   Hidden field model, reflectance physics, survey planning, zoning and prescriptions: ./field.js (Derive tab, Eqs. D1–D9).
   3D landscape: ./landscape.js. Leaf and canopy optics shared with /laboratories/spectral-signatures/. */
import { createStage, addSky, THREE } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, BarChart, linspace, downloadCSV } from '/assets/js/plot.js';
import { colormap, colormapGradient, palette } from '/assets/js/colors.js';
import * as FM from './field.js';
import * as LS from './landscape.js';

const $ = s => document.querySelector(s);
const { NX, NZ, W, D } = FM.FIELD;
const NC = NX * NZ;
const ZONE_COLS = k => Array.from({ length: k }, (_, z) => { const c = colormap('rdylgn', k === 1 ? 0.8 : 0.08 + 0.84 * z / (k - 1)); return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; });

/* ================================================================ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'gsd', label: 'Ground sampling distance', unit: 'cm px⁻¹', digits: 1 })
  .add({ id: 'lines', label: 'Flight lines × spacing', format: v => v })
  .add({ id: 'images', label: 'Images (photo interval)', format: v => v })
  .add({ id: 'time', label: 'Flight time', unit: 'min', digits: 1 })
  .add({ id: 'cover', label: 'Field mapped', unit: '%', digits: 0 })
  .add({ id: 'vi', label: 'Mean index of the map', digits: 3 })
  .add({ id: 'r2', label: 'Variance explained by zones', unit: '%', digits: 0 })
  .add({ id: 'ntot', label: 'Nitrogen: prescription vs uniform', format: v => v })
  .add({ id: 'net', label: 'Net return vs uniform', unit: '€ ha⁻¹', digits: 1 })
  .add({ id: 'surplus', label: 'N surplus (applied − crop need)', unit: 'kg ha⁻¹', digits: 1 })
  .add({ id: 'vpi', label: 'Value of perfect N information', unit: '€ ha⁻¹', digits: 1 });

ui.section('Field (hidden truth)');
ui.select({ id: 'scenario', label: 'Scenario', options: Object.entries(FM.SCENARIOS).map(([value, s]) => ({ value, label: s.label })), value: 'mixed', help: 'The causes of variation are hidden: find them with the map, then check with <em>Hidden causes</em> or by clicking on the crop.' });
ui.select({ id: 'stage', label: 'Crop stage (spring wheat)', options: Object.entries(FM.STAGES).map(([value, s]) => ({ value, label: s.label })), value: 'stem' });
ui.slider({ id: 'seed', label: 'Field layout (random seed)', min: 1, max: 60, step: 1, value: 11 });
ui.section('Sensor and flight plan');
ui.select({ id: 'sensor', label: 'Sensor', options: Object.entries(FM.CAMERAS).map(([value, c]) => ({ value, label: c.name })), value: 'micasense' });
ui.slider({ id: 'H', label: 'Flight height above ground, H', min: 20, max: 120, step: 1, value: 80, unit: 'm', help: 'EU open category: at most 120 m (Regulation (EU) 2019/947)' });
ui.slider({ id: 'fwd', label: 'Forward overlap', min: 50, max: 90, step: 1, value: 75, unit: '%' });
ui.slider({ id: 'side', label: 'Side overlap', min: 40, max: 85, step: 1, value: 75, unit: '%' });
ui.slider({ id: 'v', label: 'Ground speed', min: 3, max: 15, step: 0.5, value: 8, unit: 'm s⁻¹' });
ui.section('Survey');
const flyBtns = ui.buttons([{ label: '▶ Fly survey', variant: 'primary', onClick: () => toggleFly() }, { label: 'Complete now', onClick: () => completeNow() }, { label: 'Reset', onClick: () => resetSurvey(true) }]);
ui.segmented({ id: 'simspeed', label: 'Simulation speed', options: [{ value: 10, label: '10×' }, { value: 30, label: '30×' }, { value: 90, label: '90×' }], value: 30, persist: false });
ui.section('Management zones');
ui.segmented({ id: 'index', label: 'Vegetation index', options: [{ value: 'NDVI', label: 'NDVI' }, { value: 'NDRE', label: 'NDRE' }], value: 'NDVI' });
ui.toggle({ id: 'mask', label: 'Mask wheel tracks (tramlines)', value: true });
ui.select({ id: 'smooth', label: 'Smoothing window', options: [{ value: 0, label: 'none (1 m cells)' }, { value: 2, label: '5 m × 5 m' }, { value: 4, label: '9 m × 9 m' }, { value: 7, label: '15 m × 15 m' }], value: '4' });
ui.slider({ id: 'k', label: 'Number of zones, k', min: 2, max: 5, step: 1, value: 3 });
ui.toggle({ id: 'clean', label: 'Remove speckle (majority filter)', value: true });
ui.section('Nitrogen prescription');
ui.select({ id: 'strategy', label: 'Rule', options: [{ value: 'uniform', label: 'Uniform rate (no VRA)' }, { value: 'linear', label: 'Linear rule, mass-conserving (Eq. D7)' }, { value: 'si', label: 'Sufficiency index vs reference (Eq. D8)' }], value: 'linear' });
ui.slider({ id: 'Nbar', label: 'Planned uniform rate N̄', min: 20, max: 120, step: 5, value: 60, unit: 'kg N ha⁻¹', help: 'Supplementary dose at stem elongation: the uniform comparison and the mean of the linear rule' });
ui.slider({ id: 'beta', label: 'Response factor β', min: -1.5, max: 3, step: 0.1, value: 1, help: 'β > 0 compensating (more N where the index is low); β < 0 reinforcing' });
ui.slider({ id: 'Nopt', label: 'Optimum rate N<sub>opt</sub>', min: 60, max: 180, step: 5, value: 120, unit: 'kg N ha⁻¹' });
ui.slider({ id: 'dSI', label: 'ΔSI = 1 − SI of an unfertilised crop', min: 0.08, max: 0.6, step: 0.01, value: 0.3, help: 'In this model at stem elongation: ≈ 0.30 for NDVI, ≈ 0.45 for NDRE' });
ui.segmented({ id: 'ref', label: 'Reference', options: [{ value: 'strip', label: 'N-rich strip' }, { value: 'p95', label: '95th percentile' }], value: 'strip' });
ui.toggle({ id: 'backoff', label: 'Back-off where the crop is too poor to respond', value: true });
ui.section('Prices');
ui.slider({ id: 'grain', label: 'Grain price', min: 120, max: 350, step: 5, value: 210, unit: '€ t⁻¹' });
ui.slider({ id: 'nprice', label: 'Nitrogen price', min: 0.6, max: 3, step: 0.05, value: 1.2, unit: '€ kg⁻¹ N' });
ui.section('Display');
ui.select({ id: 'layer', label: 'Map layer (3D drape and 2D map)', options: [{ value: 'index', label: 'Vegetation index' }, { value: 'zones', label: 'Management zones' }, { value: 'rate', label: 'N prescription' }, { value: 'rgb', label: 'True colour (RGB)' }, { value: 'truth', label: 'Hidden causes (ground truth)' }], value: 'index' });
ui.slider({ id: 'drape', label: 'Drape opacity', min: 0, max: 1, step: 0.05, value: 0.85 });
ui.toggle({ id: 'path', label: 'Show flight path and photo positions', value: true });
ui.segmented({ id: 'view', label: 'Camera', options: [{ value: 'overview', label: 'Overview' }, { value: 'follow', label: 'Follow drone' }, { value: 'ground', label: 'Ground truth' }], value: 'overview', persist: false });
ui.presets([
  { label: 'Nitrogen patches: NDRE + SI', values: { scenario: 'nitrogen', index: 'NDRE', strategy: 'si', dSI: 0.45, Nopt: 120, ref: 'strip', backoff: true, k: 4 } },
  { label: 'Wet spring: compensate?', values: { scenario: 'wet', index: 'NDVI', strategy: 'linear', beta: 1.5, k: 3 } },
  { label: 'Thistles fool NDVI', values: { scenario: 'weeds', index: 'NDVI', strategy: 'linear', beta: 1, k: 3, layer: 'index' } },
  { label: 'Low and detailed (30 m)', values: { H: 30, fwd: 80, side: 75, v: 5 } },
  { label: 'High and fast (120 m)', values: { H: 120, fwd: 75, side: 70, v: 12 } },
  { label: 'Satellite instead (Sentinel-2)', values: { sensor: 's2' } },
  { label: 'Uniform field: worth it?', values: { scenario: 'uniform', strategy: 'linear', beta: 1, k: 3 } }
]);
ui.saveButton('drone-ndvi', () => ro.values());
const syncVisibility = () => { const s = ui.get('strategy'); ui.show('beta', s === 'linear'); ['Nopt', 'dSI', 'ref', 'backoff'].forEach(id => ui.show(id, s === 'si')); const sat = FM.CAMERAS[ui.get('sensor')].satellite; ['H', 'fwd', 'side', 'v'].forEach(id => ui.enable(id, !sat)); };

/* ================================================================ 3D stage */
const stage = createStage('#stage', {
  background: null, exposure: 1.0, envIntensity: 0.6, ao: false,
  camera: { pos: [-238, 74, 258], target: [0, 14, -30], fov: 42, near: 0.3, far: 7000 },
  controls: { minDistance: 3, maxDistance: 1800, maxPolarAngle: Math.PI * 0.485 },
  bloom: { strength: 0.35, radius: 0.4, threshold: 1.0 }, hint: 'Drag to orbit · click the crop to walk there and check the ground truth'
});
const { scene, camera } = stage;
const sky = addSky(stage, { elevation: 44, azimuth: 138, turbidity: 2.0, rayleigh: 2.2, mieCoefficient: 0.002, mieDirectionalG: 0.82, sunIntensity: 6.4 });
{ // shadows over the whole farm
  const s = sky.sun, dir = sky.direction.clone();
  s.position.copy(dir).multiplyScalar(900); s.target.position.set(0, 0, 0);
  Object.assign(s.shadow.camera, { left: -330, right: 330, top: 330, bottom: -330, near: 10, far: 2200 }); s.shadow.camera.updateProjectionMatrix();
  s.shadow.mapSize.set(4096, 4096); s.shadow.bias = -0.0004; s.shadow.normalBias = 0.6;
}
scene.fog = new THREE.Fog(0xbfd2e2, 1100, 5200);
stage.renderer.toneMappingExposure = 0.36; sky.hemi.intensity = 1.3; scene.environmentIntensity = 0.85;
const hud = hudChips(stage.el);
const legend = document.createElement('div'); legend.className = 'stage-legend'; stage.el.appendChild(legend);

let F = FM.makeField({ scenario: ui.get('scenario'), stage: ui.get('stage'), seed: ui.get('seed') });
const fieldGroup = LS.buildField(F); scene.add(fieldGroup);
LS.buildSurroundings(scene);
const droneRig = LS.buildDroneRig(scene);
const mapCanvas = document.createElement('canvas'); mapCanvas.width = NX; mapCanvas.height = NZ;
const mapCtx = mapCanvas.getContext('2d'); const mapImg = mapCtx.createImageData(NX, NZ);
const drape = LS.buildDrape(fieldGroup, mapCanvas);
let pathGroup = null, groundPatch = null, groundLabel = null;
const stripLabel = stage.addLabel([ (FM.STRIP.x0 + FM.STRIP.x1) / 2, 2.5, (FM.STRIP.z0 + FM.STRIP.z1) / 2 ], 'N-rich reference strip');
const padLabel = stage.addLabel([FM.PAD.x, 2.2, FM.PAD.z], 'Take-off');
const droneLabel = stage.addLabel(droneRig.rig, '', { offset: [0, 2.2, 0] });

/* ================================================================ state */
let plan = null, obs = null, captured = new Uint8Array(NC), nCaptured = 0, capIdx = 0, done = false, A = null, vRange = [0.3, 0.9], rgbCell = null;
const clock = new SimClock({ speed: 30, maxDt: 0.5, onFrame: t => onSimFrame(t) });
clock.onState(r => { flyBtns[0].innerHTML = r ? '❚❚ Pause' : (done ? '↺ Fly again' : '▶ Fly survey'); });

function params() { return ui.values(); }
function computeRGB() {
  const cm = LS.colourModel(); rgbCell = new Uint8ClampedArray(NC * 3);
  const s = v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.min(1, v), 1 / 2.4) - 0.055);
  for (let k = 0; k < NC; k++) {
    const L = F.lai[k] + F.laiW[k], fc = FM.coverOf(L) * (1 - F.track[k]), leaf = cm.leafDense(F.cab[k]), soil = cm.soil(F.soilW[k]);
    for (let c = 0; c < 3; c++) rgbCell[k * 3 + c] = s(fc * leaf[c] + (1 - fc) * soil[c]);
  }
}
function robustRange(arr) {
  const v = []; for (let k = 0; k < NC; k += 3) if (F.track[k] < 0.2 && Number.isFinite(arr[k])) v.push(arr[k]);
  v.sort((a, b) => a - b); const lo = v[Math.floor(0.01 * v.length)], hi = v[Math.floor(0.995 * v.length)];
  return [Math.floor(lo * 50) / 50, Math.ceil(hi * 50) / 50];
}
function currentVI() { const p = params(); return p.index === 'NDRE' && obs.NDRE ? obs.NDRE : obs.NDVI; }

function rebuildField() {
  const p = params();
  F = FM.makeField({ scenario: p.scenario, stage: p.stage, seed: p.seed });
  LS.repaintField(fieldGroup, F);
  computeRGB();
  if (groundPatch) { scene.remove(groundPatch); groundPatch = null; LS.setHole(1e6, 1e6, 1e6, 1e6); if (groundLabel) { groundLabel.element.remove(); groundLabel.removeFromParent(); groundLabel = null; } }
  stripLabel.visible = !!F.S.strip;
  resetSurvey(false);
}
function resetSurvey(autoplay) {
  const p = params();
  clock.pause(); clock.reset(0);
  plan = FM.planSurvey({ sensor: p.sensor, H: p.H, fwd: p.fwd / 100, side: p.side / 100, speed: p.v });
  obs = FM.observe(F, p.sensor, plan.gsd, p.seed + 101);
  vRange = robustRange(currentVI());
  captured.fill(0); nCaptured = 0; capIdx = 0; done = false; A = null;
  if (pathGroup) { scene.remove(pathGroup); pathGroup = null; }
  if (!plan.satellite) { pathGroup = LS.buildPathLine(plan); scene.add(pathGroup); pathGroup.visible = p.path; }
  droneRig.setVisible(!plan.satellite);
  scanLine.visible = false;
  onSimFrame(0);
  paintMap(); updateAnalysis(); updatePlanChart(); updateReadouts();
  if (autoplay) clock.play();
}

/* ------------------------------------------------ Sentinel-2 overpass: a scan line sweeping the field */
const scanLine = new THREE.Mesh(new THREE.PlaneGeometry(W + 40, 1.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9be7ff, transparent: true, opacity: 0.8, toneMapped: false }));
scanLine.position.y = 1.2; scanLine.visible = false; scene.add(scanLine);
const SAT_DURATION = 60;   // simulated seconds for the illustrative sweep

/* ------------------------------------------------ survey animation */
const tmpV = new THREE.Vector3();
function onSimFrame(t) {
  if (!plan) return;
  if (plan.satellite) {
    const f = Math.min(1, t / SAT_DURATION), zc = -D / 2 + f * D;
    scanLine.visible = t > 0 && f < 1; scanLine.position.z = zc;
    const jEnd = Math.floor(f * NZ); let changed = false;
    for (let j = 0; j < jEnd; j++) { const row = j * NX; if (captured[row]) continue; for (let i = 0; i < NX; i++) { captured[row + i] = 1; } nCaptured += NX; changed = true; paintRows(j, j + 1); }
    if (changed) flushMap();
    if (f >= 1 && !done) finishSurvey();
    hud.set('t', `Sentinel-2 overpass · pixel <b>10 m</b> (red edge 20 m)`);
    hud.set('c', `Mapped <b>${fmt(100 * nCaptured / NC, 0)} %</b>`);
    return;
  }
  const P = FM.pathAt(plan, t);
  droneRig.rig.position.set(P.p[0], P.p[1], P.p[2]);
  droneRig.rig.rotation.y = Math.atan2(-P.dir[2], P.dir[0]);
  droneRig.drone.rotation.z = -0.12 * (P.kind === 'line' || P.kind === 'transit' ? 1 : 0.4);
  const flying = P.p[1] > 0.5;
  const onLine = P.kind === 'line';
  droneRig.footprint.visible = droneRig.frustum.visible = droneRig.fill.visible = flying && P.p[1] > plan.H * 0.9;
  if (flying) droneRig.setFootprint(P.p[0], P.p[2], plan.Wf, plan.Lf, P.dir[0], 0.75);
  // captures
  let newCaps = 0;
  while (capIdx < plan.caps.length && plan.caps[capIdx].t <= t) { reveal(plan.caps[capIdx]); capIdx++; newCaps++; }
  if (newCaps) { flushMap(); droneRig.flash.intensity = 60; }
  droneRig.flash.intensity *= 0.85;
  if (pathGroup) { const im = pathGroup.userData.caps; const m4 = new THREE.Matrix4(); for (let i = im.count; i < capIdx; i++) { const c = plan.caps[i]; m4.makeTranslation(c.x, plan.H, c.z); im.setMatrixAt(i, m4); } im.count = capIdx; im.instanceMatrix.needsUpdate = true; }
  if (P.done && !done && capIdx >= plan.caps.length) finishSurvey();
  droneLabel.element.innerHTML = `Drone<small>H ${fmt(plan.H, 0)} m · GSD ${fmt(plan.gsd * 100, 1)} cm</small>`;
  droneLabel.visible = flying;
  const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
  hud.set('t', `Mission <b>${mm}:${String(ss).padStart(2, '0')}</b> of ${fmt(plan.flightTime / 60, 1)} min · ${onLine ? 'imaging' : P.kind}`);
  hud.set('c', `Images <b>${capIdx}</b>/${plan.caps.length} · mapped <b>${fmt(100 * nCaptured / NC, 0)} %</b>`);
}
function reveal(c) {
  const x0 = Math.max(0, Math.floor(c.x - plan.Lf / 2 + W / 2)), x1 = Math.min(NX, Math.ceil(c.x + plan.Lf / 2 + W / 2));
  const z0 = Math.max(0, Math.floor(c.z - plan.Wf / 2 + D / 2)), z1 = Math.min(NZ, Math.ceil(c.z + plan.Wf / 2 + D / 2));
  for (let j = z0; j < z1; j++) { for (let i = x0; i < x1; i++) { const k = j * NX + i; if (!captured[k]) { captured[k] = 1; nCaptured++; } } paintRows(j, j + 1, x0, x1); }
  recentFP.push([c.x, c.z]); if (recentFP.length > 14) recentFP.shift();
}
const recentFP = [];
function finishSurvey() {
  done = true; clock.pause(); scanLine.visible = false; if (pathGroup) pathGroup.visible = false;
  updateAnalysis(); updateReadouts(); paintMap();
  if (ui.get('view') === 'follow') setView('overview');
  window.FFP && FFP.toast && FFP.toast('Survey complete — orthomosaic, zones and prescription updated');
}
function toggleFly() {
  if (done || (plan && !plan.satellite && clock.t >= plan.flightTime)) { resetSurvey(true); return; }
  clock.toggle();
}
function completeNow() {
  if (!plan) return;
  const T = plan.satellite ? SAT_DURATION : plan.flightTime;
  clock.pause(); clock.reset(T); onSimFrame(T);
  if (!plan.satellite) { while (capIdx < plan.caps.length) { reveal(plan.caps[capIdx]); capIdx++; } flushMap(); }
  if (!done) finishSurvey();
}

/* ================================================================ map painting (2D + drape) */
const TRUTH_COL = { n: [238, 170, 40], wet: [50, 120, 220], comp: [140, 100, 70], weed: [200, 60, 170], strip: [40, 200, 90] };
function cellRGBA(k, layer) {
  const p = ui.values();
  if (layer === 'truth') {
    let r = 236, g = 236, b = 226; const mix = (c, f) => { r += (c[0] - r) * f; g += (c[1] - g) * f; b += (c[2] - b) * f; };
    mix(TRUTH_COL.n, Math.min(1, F.ndefP[k] * 1.1)); mix(TRUTH_COL.comp, Math.min(1, F.comp[k])); mix(TRUTH_COL.wet, Math.min(1, F.wet[k] * 1.2)); mix(TRUTH_COL.weed, Math.min(1, F.weed[k] * 1.3));
    if (F.strip[k]) mix(TRUTH_COL.strip, 0.85); if (F.track[k] > 0.2) mix([90, 80, 70], 0.6);
    return [r, g, b, 255];
  }
  if (!captured[k]) return [0, 0, 0, 0];
  if (layer === 'rgb') return [rgbCell[k * 3], rgbCell[k * 3 + 1], rgbCell[k * 3 + 2], 255];
  if ((layer === 'zones' || layer === 'rate') && A) {
    const z = A.labels[k]; if (z >= A.k) return [0, 0, 0, 0];
    if (layer === 'zones') { const c = A.zoneRGB[z]; return [c[0], c[1], c[2], 255]; }
    const c = colormap('viridis', A.rates[z] / Math.max(1, A.rateMax)); return [c[0], c[1], c[2], 255];
  }
  const v = currentVI()[k]; const c = colormap('ndvi', (v - vRange[0]) / (vRange[1] - vRange[0]));
  return [c[0], c[1], c[2], 255];
}
function paintRows(j0, j1, i0 = 0, i1 = NX) {
  const layer = effectiveLayer();
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const k = j * NX + i, c = cellRGBA(k, layer), o = k * 4; mapImg.data[o] = c[0]; mapImg.data[o + 1] = c[1]; mapImg.data[o + 2] = c[2]; mapImg.data[o + 3] = c[3]; }
}
const effectiveLayer = () => { const l = ui.get('layer'); return (l === 'zones' || l === 'rate') && !A ? 'index' : l; };
let mapDirty = false;
function flushMap() { mapDirty = true; }
function paintMap() { paintRows(0, NZ); flushMap(); updateLegend(); }
function commitMap() {
  if (!mapDirty) return; mapDirty = false;
  mapCtx.putImageData(mapImg, 0, 0);
  const t = drape.userData.tex; const lay = effectiveLayer(); t.magFilter = lay === 'zones' || lay === 'rate' || plan?.satellite ? THREE.NearestFilter : THREE.LinearFilter; t.needsUpdate = true;
  draw2D();
}

/* ------------------------------------------------ 2D map card */
const map2d = $('#map2d'), m2ctx = map2d.getContext('2d');
function draw2D() {
  const box = map2d.parentElement; const w = box.clientWidth, h = Math.round(w * NZ / NX);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (map2d.width !== Math.round(w * dpr)) { map2d.width = Math.round(w * dpr); map2d.height = Math.round(h * dpr); map2d.style.height = h + 'px'; }
  m2ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const P = palette();
  m2ctx.fillStyle = P.bgSunk || '#eee'; m2ctx.fillRect(0, 0, w, h);
  // checkerboard for unmapped area
  m2ctx.fillStyle = P.line || '#ddd'; for (let y = 0; y < h; y += 12) for (let x = ((y / 12) % 2) * 12; x < w; x += 24) m2ctx.fillRect(x, y, 12, 12);
  const lay = effectiveLayer();
  m2ctx.imageSmoothingEnabled = !(lay === 'zones' || lay === 'rate' || plan?.satellite);
  m2ctx.drawImage(mapCanvas, 0, 0, w, h);
  const sx = w / W, sz = h / D, X = x => (x + W / 2) * sx, Z = z => (z + D / 2) * sz;
  // recent footprints and drone position while flying
  if (plan && !plan.satellite && !done && capIdx > 0) {
    m2ctx.strokeStyle = 'rgba(255,255,255,0.9)'; m2ctx.lineWidth = 1.2;
    recentFP.forEach(([cx, cz], q) => { m2ctx.globalAlpha = 0.25 + 0.75 * q / recentFP.length; m2ctx.strokeRect(X(cx - plan.Lf / 2), Z(cz - plan.Wf / 2), plan.Lf * sx, plan.Wf * sz); });
    m2ctx.globalAlpha = 1;
    const p = droneRig.rig.position; m2ctx.fillStyle = '#f07ad0'; m2ctx.beginPath(); m2ctx.arc(X(p.x), Z(p.z), 5, 0, Math.PI * 2); m2ctx.fill(); m2ctx.strokeStyle = '#fff'; m2ctx.lineWidth = 1.5; m2ctx.stroke();
  }
  if (groundPatch) { const [gx, gz] = groundPatch.userData.centre; m2ctx.strokeStyle = '#fff'; m2ctx.lineWidth = 2; m2ctx.strokeRect(X(gx - 6), Z(gz - 4), 12 * sx, 8 * sz); }
  // north arrow and scale bar
  const bar = 50 * sx, bw = bar + 58;
  m2ctx.fillStyle = 'rgba(10,16,14,0.65)'; m2ctx.fillRect(w - bw - 8, h - 30, bw, 22);
  m2ctx.fillStyle = '#fff'; m2ctx.fillRect(w - bw, h - 20, bar, 3); m2ctx.font = "500 10.5px 'JetBrains Mono', monospace"; m2ctx.textBaseline = 'middle'; m2ctx.textAlign = 'left'; m2ctx.fillText('50 m', w - bw + bar + 8, h - 19);
  m2ctx.fillStyle = 'rgba(10,16,14,0.65)'; m2ctx.fillRect(8, 8, 22, 26); m2ctx.fillStyle = '#fff'; m2ctx.textAlign = 'center'; m2ctx.fillText('N', 19, 26); m2ctx.beginPath(); m2ctx.moveTo(19, 11); m2ctx.lineTo(24, 19); m2ctx.lineTo(14, 19); m2ctx.fill(); m2ctx.textAlign = 'left';
}
new ResizeObserver(() => draw2D()).observe(map2d.parentElement);
document.addEventListener('ffp:theme', () => draw2D());
map2d.addEventListener('click', e => { const r = map2d.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * W - W / 2, z = (e.clientY - r.top) / r.height * D - D / 2; inspect(x, z, true); });

function updateLegend() {
  const lay = effectiveLayer(), p = ui.values(); let html = '';
  if (lay === 'index') html = `${p.index === 'NDRE' && obs?.NDRE ? 'NDRE' : 'NDVI'} (observed)<div class="cbar" style="background:${colormapGradient('ndvi')}"></div><div class="cbar-ticks"><span>${fmt(vRange[0], 2)}</span><span>${fmt((vRange[0] + vRange[1]) / 2, 2)}</span><span>${fmt(vRange[1], 2)}</span></div>`;
  else if (lay === 'zones' && A) html = `Management zones (low → high index)<div style="display:flex;gap:4px;margin-top:5px">${A.zoneCSS.map((c, z) => `<span style="display:inline-flex;align-items:center;gap:4px"><i style="width:12px;height:12px;border-radius:3px;background:${c};display:inline-block"></i>${z + 1}</span>`).join('')}</div>`;
  else if (lay === 'rate' && A) html = `N prescription (kg N ha⁻¹)<div class="cbar" style="background:${colormapGradient('viridis')}"></div><div class="cbar-ticks"><span>0</span><span>${fmt(A.rateMax / 2, 0)}</span><span>${fmt(A.rateMax, 0)}</span></div>`;
  else if (lay === 'rgb') html = 'True colour (red 645, green 555, blue 470 nm)';
  else if (lay === 'truth') html = `Hidden causes<div style="display:grid;grid-template-columns:auto auto;gap:2px 10px;margin-top:5px">${[['n', 'N deficiency'], ['wet', 'waterlogging'], ['comp', 'compaction'], ['weed', 'thistles'], ['strip', 'N-rich strip']].map(([k, l]) => `<span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgb(${TRUTH_COL[k].join(',')});margin-right:5px"></i>${l}</span>`).join('')}</div>`;
  legend.innerHTML = html;
  $('#map-legend').innerHTML = html;
}

/* ================================================================ analysis: zones, prescription, evaluation */
function updateAnalysis() {
  const p = ui.values();
  if (!done) { A = null; drawAnalysisCharts(); return; }
  const vi = currentVI();
  const masked = p.mask ? vi.map((v, k) => F.track[k] > 0.2 ? NaN : v) : vi;
  const sm = FM.boxSmooth(masked, NX, NZ, +p.smooth);
  const k = p.k; let { labels } = FM.kmeans1D(sm, k);
  if (p.clean) labels = FM.majority(labels, NX, NZ, k, 2);
  const zs = FM.zoneStats(sm, labels, k);
  let Vref;
  if (p.ref === 'strip' && F.S.strip) { let s = 0, n = 0; for (let q = 0; q < NC; q++) if (F.strip[q] && Number.isFinite(sm[q])) { s += sm[q]; n++; } Vref = s / n; }
  else { const v = Array.from(sm).filter(Number.isFinite).sort((a, b) => a - b); Vref = v[Math.floor(0.95 * (v.length - 1))]; }
  const rates = FM.prescribe(zs, { strategy: p.strategy, Nbar: p.Nbar, beta: p.beta, Nopt: p.Nopt, dSI: p.dSI, Vref, backoff: p.backoff });
  const prices = { grain: p.grain, nPrice: p.nprice };
  const uniRate = p.Nbar;
  const evU = FM.evaluate(F, () => uniRate, prices), evV = FM.evaluate(F, q => rates[labels[q]] ?? uniRate, prices), evI = FM.evaluate(F, q => F.Nn[q], prices);
  const zoneCSS = ZONE_COLS(k), zoneRGB = zoneCSS.map(c => c.match(/\d+/g).map(Number));
  A = { k, labels, zs, sm, Vref, rates, evU, evV, evI, zoneCSS, zoneRGB, rateMax: Math.max(10, ...rates, uniRate) * 1.1, uniRate };
  drawAnalysisCharts();
}

/* ================================================================ charts */
const cHist = new BarChart('#chart-hist', { y: { label: 'Share of field', unit: '%', min: 0 }, legend: false });
const cN = new BarChart('#chart-n', { y: { label: 'Nitrogen rate', unit: 'kg N ha⁻¹', min: 0 } });
const cPlan = new Plot('#chart-plan', { x: { label: 'Flight height above ground', unit: 'm', min: 20, max: 120 }, y: { label: 'Flight time', unit: 'min', min: 0 }, y2: { label: 'Ground sampling distance', unit: 'cm', min: 0 } });
function drawAnalysisCharts() {
  // histogram of the observed index (captured cells)
  const vi = obs ? currentVI() : null; const bins = 16, [lo, hi] = vRange, bw = (hi - lo) / bins;
  const counts = new Array(bins).fill(0); let n = 0;
  if (vi) for (let q = 0; q < NC; q++) { if (!captured[q]) continue; const b = Math.floor((vi[q] - lo) / bw); if (b >= 0 && b < bins) { counts[b]++; n++; } }
  const cols = counts.map((_, b) => {
    const v = lo + (b + 0.5) * bw;
    if (A) { let z = 0; for (let q = 0; q < A.k - 1; q++) if (v > (A.zs.zones[q].mean + A.zs.zones[q + 1].mean) / 2) z = q + 1; return A.zoneCSS[z]; }
    const c = colormap('ndvi', (v - lo) / (hi - lo)); return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  });
  cHist.set(counts.map((_, b) => fmt(lo + (b + 0.5) * bw, 2)), [{ label: 'Share', values: counts.map(c => n ? 100 * c / n : 0), colors: cols, format: v => v.toFixed(1) }]);
  // zone table and N chart
  const zt = $('#zone-table');
  if (!A) {
    zt.innerHTML = `<p class="muted" style="margin:30px 0;text-align:center">${capIdx || nCaptured ? 'Mapping in progress…' : 'Fly the survey (or press <em>Complete now</em>)'} — zones are delineated when the whole field has been mapped.</p>`;
    cN.set(['—'], [{ label: 'Uniform', values: [0], color: 'muted' }]);
    return;
  }
  const p = ui.values(), idx = p.index === 'NDRE' && obs.NDRE ? 'NDRE' : 'NDVI';
  zt.innerHTML = `<table class="zone-tab"><thead><tr><th>Zone</th><th class="num">Area</th><th class="num">Mean ${idx} ± SD</th>${p.strategy === 'si' ? '<th class="num">SI</th>' : ''}<th class="num">N rate</th></tr></thead><tbody>${A.zs.zones.map((z, q) => `<tr><td><i style="background:${A.zoneCSS[q]}"></i>${q + 1}${q === 0 ? ' (lowest)' : q === A.k - 1 ? ' (highest)' : ''}</td><td class="num">${fmt(z.areaHa, 2)} ha (${fmt(100 * z.share, 0)} %)</td><td class="num">${fmt(z.mean, 3)} ± ${fmt(z.sd, 3)}</td>${p.strategy === 'si' ? `<td class="num">${fmt(z.mean / A.Vref, 3)}</td>` : ''}<td class="num"><b>${fmt(A.rates[q], 0)}</b> kg ha⁻¹</td></tr>`).join('')}</tbody></table>
    <p class="zone-foot">Variance explained by the zoning: <b>${fmt(100 * A.zs.r2, 0)} %</b> · field mean ${idx} ${fmt(A.zs.mean, 3)} · reference ${idx} ${fmt(A.Vref, 3)} (${p.ref === 'strip' ? 'N-rich strip' : '95th percentile'})</p>`;
  const cats = A.zs.zones.map((_, q) => `Zone ${q + 1}`).concat(['Field mean']);
  const vraMean = A.zs.zones.reduce((s, z, q) => s + z.share * A.rates[q], 0);
  cN.set(cats, [{ label: `Uniform (${fmt(A.uniRate, 0)} kg ha⁻¹)`, values: cats.map(() => A.uniRate), color: 'muted' }, { label: 'Prescription', values: A.rates.concat([vraMean]), colors: A.zoneCSS.concat(['#2f7d4f']), format: v => v.toFixed(0) }]);
  $('#n-sub').innerHTML = `Totals for the ${fmt(FM.AREA_HA, 0)} ha field: uniform <b>${fmt(A.evU.Nkg, 0)} kg N</b>, prescription <b>${fmt(A.evV.Nkg, 0)} kg N</b> (${A.evV.Nkg <= A.evU.Nkg ? 'saving' : 'extra'} ${fmt(Math.abs(A.evU.Nkg - A.evV.Nkg), 0)} kg = ${fmt(Math.abs(A.evU.Nkg - A.evV.Nkg) * ui.get('nprice'), 0)} €). Crop need (hidden) ${fmt(A.evI.Nkg, 0)} kg.`;
}
function updatePlanChart() {
  const p = ui.values(), sat = FM.CAMERAS[p.sensor].satellite;
  if (sat) { ['t', 'g', 'now', 'bat'].forEach(id => cPlan.remove(id)); cPlan.text('sat', 70, 5, 'Satellite: no flight — 10 m pixels, revisit ≈ 5 days, clouds permitting', { align: 'center', color: 'muted' }); return; }
  cPlan.remove('sat');
  const Hs = linspace(20, 120, 41), T = [], G = [];
  Hs.forEach(H => { const q = FM.planSurvey({ sensor: p.sensor, H, fwd: p.fwd / 100, side: p.side / 100, speed: p.v }); T.push(q.flightTime / 60); G.push(q.gsd * 100); });
  cPlan.line('t', Hs, T, { color: 'accent', width: 2.6, label: 'Flight time (incl. turns, climb and landing)' });
  cPlan.line('g', Hs, G, { color: 'water', width: 2.2, y2: true, label: 'GSD (right axis)' });
  cPlan.hline('bat', FM.CAMERAS[p.sensor].endurance, { color: 'danger', label: 'usable battery time (assumed)' });
  cPlan.point('now', p.H, plan.flightTime / 60, { color: 'magenta', r: 5.5, label: `${fmt(plan.flightTime / 60, 1)} min` });
}

/* ================================================================ readouts */
function updateReadouts() {
  const p = ui.values();
  if (plan.satellite) {
    ro.set('gsd', 1000, 'warn', 'Sentinel-2: 10 m (B4, B8), 20 m red edge');
    ro.set('lines', '—', null, 'no flight: the satellite images a 290 km swath');
    ro.set('images', '1 scene', null, 'revisit ≈ 5 days with two satellites');
    ro.set('time', 0, null, 'free and open data (Copernicus)');
  } else {
    ro.set('gsd', plan.gsd * 100, plan.gsd <= 0.1 ? 'ok' : 'warn', `footprint ${fmt(plan.Lf, 0)} m × ${fmt(plan.Wf, 0)} m`);
    ro.set('lines', `${plan.nLines} × ${fmt(plan.spacing, 1)} m`, null, `side overlap ${p.side} %`);
    ro.set('images', `${plan.images} (${fmt(plan.dt, 1)} s)`, plan.limited ? 'warn' : 'ok', plan.limited ? `camera too slow: forward overlap only ${fmt(plan.fwdEff * 100, 0)} %` : `every ${fmt(plan.trigEff, 1)} m along track`);
    ro.set('time', plan.flightTime / 60, plan.batteries > 1 ? 'warn' : 'ok', `${plan.batteries} ${plan.batteries > 1 ? 'batteries' : 'battery'} · ${(plan.pixels / 1e6).toFixed(0)} Mpx per band`);
  }
  ro.set('cover', 100 * nCaptured / NC, nCaptured >= NC ? 'ok' : null);
  if (obs && nCaptured > 0) {
    const vi = currentVI(); let s = 0, s2 = 0, n = 0; for (let q = 0; q < NC; q++) if (captured[q]) { s += vi[q]; s2 += vi[q] * vi[q]; n++; }
    const m = s / n, sd = Math.sqrt(Math.max(0, s2 / n - m * m));
    ro.set('vi', m, null, `${p.index === 'NDRE' && obs.NDRE ? 'NDRE' : 'NDVI'} · CV ${fmt(100 * sd / m, 1)} % (incl. wheel tracks)`);
  } else ro.set('vi', null);
  if (A) {
    const ha = FM.AREA_HA, dN = A.evV.Nkg - A.evU.Nkg, dNet = (A.evV.net - A.evU.net) / ha;
    ro.set('r2', 100 * A.zs.r2, A.zs.r2 > 0.6 ? 'ok' : 'warn', `${A.k} zones`);
    ro.set('ntot', `${fmt(A.evV.Nkg, 0)} vs ${fmt(A.evU.Nkg, 0)} kg`, dN <= 0 ? 'ok' : 'warn', `${dN <= 0 ? '−' : '+'}${fmt(Math.abs(100 * dN / A.evU.Nkg), 1)} % (${fmt(Math.abs(dN) / ha, 1)} kg ha⁻¹)`);
    ro.set('net', dNet, dNet > 0.5 ? 'ok' : dNet < -0.5 ? 'bad' : null, `yield ${A.evV.Yt >= A.evU.Yt ? '+' : '−'}${fmt(Math.abs(A.evV.Yt - A.evU.Yt) / ha * 1000, 0)} kg ha⁻¹; N ${dN <= 0 ? '−' : '+'}${fmt(Math.abs(dN) / ha, 1)} kg ha⁻¹`);
    ro.set('surplus', A.evV.surplus / ha, A.evV.surplus <= A.evU.surplus ? 'ok' : 'bad', `uniform: ${fmt(A.evU.surplus / ha, 1)} kg ha⁻¹ (leaching risk)`);
    ro.set('vpi', (A.evI.net - A.evU.net) / ha, null, 'net gain if every m² got exactly its (hidden) need');
  } else { ['r2', 'ntot', 'net', 'surplus', 'vpi'].forEach(id => ro.set(id, null, null, 'after the survey')); }
}

/* ================================================================ ground truth (click the crop) */
function diagnose(k) {
  const c = [['nitrogen deficiency', F.ndefP[k]], ['waterlogging', F.wet[k]], ['soil compaction', F.comp[k] * 0.9], ['creeping thistle', F.weed[k]]].sort((a, b) => b[1] - a[1]);
  if (F.strip[k]) return 'N-rich reference strip';
  if (F.track[k] > 0.4) return 'wheel track (tramline)';
  return c[0][1] > 0.25 ? c[0][0] + (c[1][1] > 0.25 ? ' + ' + c[1][0] : '') : 'no major problem';
}
function inspect(x, z, fly) {
  if (x < -W / 2 || x > W / 2 || z < -D / 2 || z > D / 2) return;
  if (groundPatch) { scene.remove(groundPatch); groundPatch.traverse(o => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } }); }
  groundPatch = LS.buildGroundPatch(F, x, z); scene.add(groundPatch);
  const [gx, gz] = groundPatch.userData.centre;
  const i = Math.floor(x + W / 2), j = Math.floor(z + D / 2), k = Math.max(0, Math.min(NC - 1, j * NX + i));
  const viObs = captured[k] ? fmt(currentVI()[k], 3) : 'not yet mapped';
  const html = `Ground truth<small>LAI ${fmt(F.lai[k] + F.laiW[k], 2)} · chlorophyll ${fmt(F.cab[k], 0)} µg cm⁻² · height ${fmt(F.h[k] * 100, 0)} cm</small><small>${ui.get('index')} ${viObs} · N need ${fmt(F.Nn[k], 0)} kg ha⁻¹</small><small>cause: ${diagnose(k)}</small>`;
  if (groundLabel) { groundLabel.element.remove(); groundLabel.removeFromParent(); }
  groundLabel = stage.addLabel([x, 1.6, z], html, { className: 'label3d lg' });
  draw2D();
  if (fly) { ui.set('view', 'ground', true); setView('ground'); }
}
stage.onPick({ objects: () => [fieldGroup.userData.mesh], onClick: hit => { if (hit) inspect(hit.point.x, hit.point.z, true); } });

/* ================================================================ camera views */
function setView(v) {
  if (v === 'overview') stage.flyTo([-238, 74, 258], [0, 14, -30], 1.6);
  else if (v === 'ground') {
    if (!groundPatch) inspect(-95, 30, false);
    const [gx, gz] = groundPatch.userData.centre; stage.flyTo([gx - 7, 2.2, gz + 9], [gx, 0.35, gz], 1.8);
  }
}
const camOff = new THREE.Vector3(), camTgt = new THREE.Vector3();
stage.onFrame((dt, t) => {
  droneRig.drone.update(dt);
  if (groundPatch && groundPatch.userData.crop) groundPatch.userData.crop.update(t);
  if (ui.get('view') === 'follow' && plan && !plan.satellite) {
    const P = droneRig.rig.position, d = FM.pathAt(plan, clock.t).dir;
    camTgt.set(P.x + d[0] * 25, 0, P.z + d[2] * 25);
    camOff.set(P.x - d[0] * 55, P.y + 38, P.z - d[2] * 55 + 30);
    camera.position.lerp(camOff, Math.min(1, dt * 2)); stage.controls.target.lerp(camTgt, Math.min(1, dt * 2));
  }
  commitMap();
  if (mapDirty === false && (clock.running)) { throttle2D += dt; if (throttle2D > 0.25) { throttle2D = 0; draw2D(); drawAnalysisThrottled(); } }
});
let throttle2D = 0, histT = 0;
function drawAnalysisThrottled() { histT++; if (histT % 4 === 0) { drawAnalysisCharts(); updateReadouts(); } }

/* ================================================================ wiring */
const FIELD_KEYS = ['scenario', 'stage', 'seed'], SURVEY_KEYS = ['sensor', 'H', 'fwd', 'side', 'v'], ANALYSIS_KEYS = ['index', 'mask', 'smooth', 'k', 'clean', 'strategy', 'Nbar', 'beta', 'Nopt', 'dSI', 'ref', 'backoff', 'grain', 'nprice'];
let pend = { field: false, survey: false, analysis: false, display: false }, raf = 0;
ui.onChange((state, id) => {
  if (FIELD_KEYS.includes(id)) pend.field = true;
  else if (SURVEY_KEYS.includes(id)) pend.survey = true;
  else if (ANALYSIS_KEYS.includes(id)) pend.analysis = true;
  else if (id === 'simspeed') clock.speed = +state.simspeed;
  else if (id === 'view') setView(state.view);
  else pend.display = true;
  if (id === 'index' && obs) { vRange = robustRange(currentVI()); pend.display = true; }
  cancelAnimationFrame(raf); raf = requestAnimationFrame(applyPending);
});
function applyPending() {
  syncVisibility();
  const p = ui.values();
  if (pend.field) rebuildField();
  else if (pend.survey) resetSurvey(false);
  else if (pend.analysis) { updateAnalysis(); updateReadouts(); }
  drape.material.opacity = p.drape; drape.visible = p.drape > 0.01;
  if (pathGroup) pathGroup.visible = p.path && !done;
  paintMap(); drawAnalysisCharts();
  pend = { field: false, survey: false, analysis: false, display: false };
}
clock.speed = +ui.get('simspeed');
syncVisibility();
computeRGB();
resetSurvey(false);
drape.material.opacity = ui.get('drape');
// start flying automatically so the map builds up on first visit
setTimeout(() => { if (!done && clock.t === 0) clock.play(); }, 800);
window.__drone = { get F() { return F; }, get plan() { return plan; }, get A() { return A; }, completeNow, inspect, setView, clock, cam(pos, tgt) { camera.position.set(...pos); stage.controls.target.set(...tgt); stage.controls.update(); } };
