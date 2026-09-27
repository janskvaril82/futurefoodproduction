/* ==========================================================================
   Autonomous weeding robot — simulation, 3D scene, camera view and charts.
   Model equations: ./model.js (Derive tab, Eqs. R1–R10).
   The 3D field is a stochastic realisation of the same model: every plant gets a
   classifier score, the robot decides, sprays and the outcome is counted.
   ========================================================================== */
import { createStage, addSky, THREE, M, leafMaterial, Mist, rng, fbm2, canvasTexture, surfaceMaterial } from '/assets/js/lab3d.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, linspace } from '/assets/js/plot.js';
import { normPdf, mulberry32, randn } from '/assets/js/stats.js';
import { withAlpha } from '/assets/js/colors.js';
import { CROPS, WEEDS, K, expected, roc, tradeoff, speedSweep, pWeed, CLAIMS } from './model.js';
import { buildRobot, ROBOT } from './robot.js';
import { beetGeometry, lettuceGeometry, WEED_GEOMETRY, soilStrip, clods } from './plants.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MID = [15, 45, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
const dateStr = d => { const dt = new Date(Date.UTC(2026, 0, Math.round(d))); return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`; };
// NASA POWER Climatology API v2.10 monthly all-sky clearness index (retrieved September 2026)
const SITES = { lund: { name: 'Lund, Skåne', lat: 55.7, kt: [0.28, 0.34, 0.45, 0.51, 0.52, 0.51, 0.50, 0.49, 0.47, 0.39, 0.29, 0.25] }, vasteras: { name: 'Västerås', lat: 59.6, kt: [0.28, 0.36, 0.47, 0.50, 0.50, 0.51, 0.49, 0.48, 0.45, 0.38, 0.29, 0.27] } };
function ktFor(site, d) { let k = MID.findIndex(m => m > d); if (k === -1) k = 12; const i0 = (k + 11) % 12, i1 = k % 12; let d0 = MID[i0], d1 = MID[i1]; if (k === 0) d0 -= 365; if (k === 12) d1 += 365; const t = (d - d0) / (d1 - d0); return site.kt[i0] * (1 - t) + site.kt[i1] * t; }
const HALF_W = 1.5;                 // m, half the working width (three cameras × 1 m)
const BAND = 2.5;                   // m, half-width of the simulated plant band
const BEHIND = 7.5, AHEAD = 11.5;   // m, plant window around the robot

/* ------------------------------------------------------------------ UI */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'dprime', label: 'Separability at this speed (mean d′)', unit: '', digits: 2, note: '&nbsp;' })
  .add({ id: 'recall', label: 'Weeds detected (recall)', unit: '%', digits: 1, note: '&nbsp;' })
  .add({ id: 'fpr', label: 'Crop plants called weeds (FPR)', unit: '%', digits: 1, note: '&nbsp;' })
  .add({ id: 'prec', label: 'Precision of the "weed" calls', unit: '%', digits: 1, note: '&nbsp;' })
  .add({ id: 'vol', label: 'Herbicide spray applied', unit: 'L ha⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'save', label: 'Herbicide saved vs broadcast', unit: '%', digits: 1, note: '&nbsp;' })
  .add({ id: 'wce', label: 'Weed-control efficacy', unit: '%', digits: 1, note: '&nbsp;' })
  .add({ id: 'esc', label: 'Weed escapes', unit: 'weeds m⁻²', digits: 2, note: '&nbsp;' })
  .add({ id: 'crop', label: 'Crop plants hit by spray', unit: '%', digits: 1, note: '&nbsp;' })
  .add({ id: 'rate', label: 'Work rate', unit: 'ha h⁻¹', digits: 2, note: '&nbsp;' })
  .add({ id: 'day', label: 'Area per day on solar power', unit: 'ha d⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'eha', label: 'Energy per hectare', unit: 'kWh ha⁻¹', digits: 2, note: '&nbsp;' });

ui.section('Field');
ui.segmented({ id: 'crop', label: 'Crop', options: [{ value: 'beet', label: 'Sugar beet' }, { value: 'lettuce', label: 'Lettuce' }], value: 'beet' });
ui.slider({ id: 'lambda', label: 'Weed density λ', min: 1, max: 60, step: 0.5, value: 12, unit: 'weeds m⁻²', log: true, format: v => fmt(v, v < 10 ? 1 : 0) });
ui.slider({ id: 'sigma', label: 'Patchiness σ', min: 0, max: 2, step: 0.05, value: 1, help: '0 = weeds scattered at random; 2 = dense patches with weed-free gaps between them.' });
ui.section('Camera and classifier');
ui.slider({ id: 'd0', label: "Separability d′ (standing still)", min: 0.5, max: 5, step: 0.05, value: 3, help: 'Distance between the weed and crop score distributions in standard deviations (species multipliers apply: fat hen 0.7 × … grass weeds 1.35 ×).' });
ui.slider({ id: 'tau', label: 'Decision threshold τ', min: -2, max: 6, step: 0.05, value: 1.5, help: 'A plant whose score is above τ is called a weed and sprayed.' });
ui.slider({ id: 'texp', label: 'Exposure time', min: 0.1, max: 5, step: 0.05, value: 1, unit: 'ms', help: 'Short exposures need the LED ring flash; long ones smear the image.' });
ui.slider({ id: 'tinf', label: 'Processing time per frame', min: 10, max: 600, step: 5, value: 60, unit: 'ms', help: 'Neural-network inference on the robot computer; limits the frame rate.' });
ui.section('Robot and sprayer');
ui.slider({ id: 'v', label: 'Driving speed', min: 0.1, max: 3, step: 0.01, value: 0.5, format: v => `${v.toFixed(2)} m s⁻¹ · ${(v * 3.6).toFixed(1)} km h⁻¹` });
ui.slider({ id: 'cellcm', label: 'Spray-cell size', min: 4, max: 50, step: 1, value: 6, unit: 'cm', help: 'Nozzle spacing = pulse length. 4–6 cm: dedicated spot sprayers; 25–50 cm: single-nozzle control on a boom.' });
ui.slider({ id: 'jitter', label: 'Timing uncertainty σₜ', min: 0, max: 20, step: 0.5, value: 2, unit: 'ms' });
ui.slider({ id: 'Vbc', label: 'Broadcast spray volume', min: 50, max: 300, step: 5, value: 150, unit: 'L ha⁻¹' });
ui.slider({ id: 'eh', label: 'Kill rate of a hit weed', min: 70, max: 100, step: 1, value: 95, unit: '%' });
ui.toggle({ id: 'nonsel', label: 'Non-selective product (hit crop plants die)', value: false });
ui.section('Solar energy');
ui.select({ id: 'loc', label: 'Location', options: Object.entries(SITES).map(([value, s]) => ({ value, label: `${s.name} (${s.lat}° N)` })), value: 'lund' });
ui.slider({ id: 'doy', label: 'Date', min: 91, max: 273, step: 1, value: 140, format: v => dateStr(v) });
ui.slider({ id: 'mass', label: 'Robot mass', min: 300, max: 2000, step: 10, value: 1000, unit: 'kg' });
ui.slider({ id: 'crr', label: 'Rolling-resistance coefficient', min: 0.03, max: 0.25, step: 0.005, value: 0.08, help: 'Motion resistance of the wheels on soft, tilled soil (assumed).' });
ui.slider({ id: 'p0', label: 'Computers, cameras and flash', min: 50, max: 800, step: 10, value: 250, unit: 'W' });
ui.slider({ id: 'apv', label: 'Solar panel area on the roof', min: 2, max: 12, step: 0.1, value: 7.8, unit: 'm²' });
ui.section('Simulation and display');
const playBtns = ui.buttons([{ label: '❚❚ Pause', variant: 'primary', onClick: () => clock.toggle() }, { label: 'New field', onClick: () => resetField(true) }]);
ui.segmented({ id: 'simspeed', label: 'Simulation speed', options: [{ value: 1, label: '1×' }, { value: 3, label: '3×' }, { value: 8, label: '8×' }], value: 1 });
ui.toggle({ id: 'follow', label: 'Camera follows the robot', value: true });
ui.toggle({ id: 'fov', label: 'Field of view and detection boxes', value: true });
ui.toggle({ id: 'marks', label: 'Mark missed weeds and hit crop plants', value: true });
ui.toggle({ id: 'inset', label: 'Robot camera view', value: true });
ui.presets([
  { label: 'Camera robot in sugar beet', values: { crop: 'beet', lambda: 12, sigma: 1, d0: 3, tau: 1.5, texp: 1, tinf: 60, v: 0.5, cellcm: 6, jitter: 2, eh: 95, nonsel: false, mass: 1000, crr: 0.08, p0: 250, apv: 7.8 } },
  { label: 'Slow, solar, wide (FarmDroid-like pace)', values: { v: 0.26, p0: 150, mass: 1250, apv: 7.8, cellcm: 6 } },
  { label: 'Tractor-speed camera sprayer', values: { v: 2.0, texp: 2, jitter: 4, tinf: 80, cellcm: 6, p0: 400 } },
  { label: 'Protect the crop (high τ)', values: { tau: 3.2, nonsel: true } },
  { label: 'Kill every weed (low τ)', values: { tau: 0.2 } },
  { label: 'Boom sections, 50 cm', values: { cellcm: 50, tau: 1.5, v: 2.0 } },
  { label: 'Clean field, rare weeds', values: { lambda: 2, sigma: 1.5 } }
]);
ui.saveButton('field-robot', () => ro.values());

/* ------------------------------------------------------------------ stage */
const stage = createStage('#stage', {
  background: null, exposure: 0.5, envIntensity: 0.6,
  camera: { pos: [4.6, 2.1, 3.9], target: [0.55, 0.45, -0.2], fov: 42, near: 0.02, far: 3000 },   // = HOME (relative to the robot)
  controls: { minDistance: 0.35, maxDistance: 45, maxPolarAngle: Math.PI * 0.485 },
  bloom: { strength: 0.5, radius: 0.35, threshold: 1.1 }, ao: { radius: 0.12, intensity: 0.8 },
  fog: { color: 0xdbe3e6, near: 70, far: 560 }                      // aerial perspective for the distant landscape
});
const { scene, camera, renderer } = stage;
camera.layers.enable(1);
const SUN_EL = 42, SUN_AZ = 138;   // a May morning: sun in the south-east, the robot drives east
const sky = addSky(stage, { elevation: SUN_EL, azimuth: SUN_AZ, turbidity: 3.2, sunIntensity: 3.3, shadowSize: 6, updateEnv: true });
sky.sun.shadow.mapSize.set(4096, 4096); sky.sun.shadow.camera.far = 90; sky.sun.shadow.camera.updateProjectionMatrix();
sky.sun.shadow.bias = -0.0002; sky.sun.shadow.normalBias = 0.012;
const sunDir = sky.direction.clone();
const hud = hudChips(stage.el);

// landscape: grass headland, field beyond the simulated band (texture), shelterbelt, farm
const world = new THREE.Group(); scene.add(world);
const grass = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), surfaceMaterial('grass', [400, 400])); grass.material.color.setRGB(1.2, 1.25, 1.0);
grass.rotation.x = -Math.PI / 2; grass.position.y = -0.02; grass.receiveShadow = true; world.add(grass);
function fieldTexture(rowSp, plantSp) {
  return canvasTexture(512, 512, (ctx, W, H) => {
    const r = rng(77); ctx.fillStyle = '#5b4330'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) { ctx.fillStyle = `rgba(${60 + r() * 60},${42 + r() * 40},${28 + r() * 26},${0.25 + r() * 0.35})`; const s = 1 + r() * 4; ctx.fillRect(r() * W, r() * H, s, s); }
    const tile = 2.0, px = W / tile; const nr = Math.round(tile / rowSp), np = Math.round(tile / plantSp);
    for (let k = 0; k < nr; k++) {
      const y = (k + 0.5) * H / nr;
      const g = ctx.createLinearGradient(0, y - 18, 0, y + 18); g.addColorStop(0, 'rgba(120,95,70,0)'); g.addColorStop(0.5, 'rgba(140,112,84,0.55)'); g.addColorStop(1, 'rgba(120,95,70,0)'); ctx.fillStyle = g; ctx.fillRect(0, y - 18, W, 36);
      for (let n = 0; n < np; n++) { const x = (n + 0.5) * W / np + (r() - 0.5) * 6; ctx.fillStyle = `hsl(${88 + r() * 16},${45 + r() * 15}%,${28 + r() * 10}%)`; for (let l = 0; l < 4; l++) { ctx.beginPath(); ctx.ellipse(x + Math.cos(l * 1.57 + 0.4) * 5, y + Math.sin(l * 1.57 + 0.4) * 5, 6, 3, l * 1.57 + 0.4, 0, Math.PI * 2); ctx.fill(); } }
    }
    for (let i = 0; i < 60; i++) { ctx.fillStyle = `hsl(${80 + r() * 25},45%,${30 + r() * 12}%)`; ctx.beginPath(); ctx.arc(r() * W, r() * H, 1.5 + r() * 3, 0, Math.PI * 2); ctx.fill(); }
  }, { key: 'fr-field-' + rowSp, repeat: [1, 1] });
}
const outerMat = new THREE.MeshStandardMaterial({ roughness: 0.97, metalness: 0 });
const outer = new THREE.Mesh(new THREE.PlaneGeometry(360, 90), outerMat); outer.rotation.x = -Math.PI / 2; outer.position.y = -0.006; outer.receiveShadow = true; world.add(outer);
const trees = new THREE.Group(); world.add(trees);
(function buildTrees() {
  const r = rng(5); const n = 150;
  const crownGeo = new THREE.IcosahedronGeometry(2.6, 1); crownGeo.scale(1, 0.9, 1); crownGeo.translate(0, 5.2, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 3.6, 6); trunkGeo.translate(0, 1.8, 0);
  const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), n);
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 1 }), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1; const x = -300 + (i >> 1) * 8 + r() * 4, z = side * (48 + r() * 8);
    const s = 0.7 + r() * 0.6; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28); sc.set(s, s * (0.8 + r() * 0.5), s); m4.compose(new THREE.Vector3(x, 0, z), q, sc);
    crown.setMatrixAt(i, m4); trunk.setMatrixAt(i, m4); c.setHSL(0.25 + r() * 0.08, 0.45, 0.2 + r() * 0.1); crown.setColorAt(i, c);
  }
  crown.castShadow = true; trees.add(crown, trunk);
  // a Falu-red barn by the field
  const barn = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(18, 5, 9), new THREE.MeshStandardMaterial({ color: 0x8e2a20, roughness: 0.85 })); body.position.y = 2.5; barn.add(body);
  const sh = new THREE.Shape(); sh.moveTo(-5, 0); sh.lineTo(0, 3.4); sh.lineTo(5, 0); sh.lineTo(-5, 0);
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 19, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.7 })); roof.rotation.y = Math.PI / 2; roof.position.set(-9.5, 5, 0); barn.add(roof);
  barn.position.set(40, 0, -70); barn.rotation.y = 0.2; barn.userData.anchor = 40; trees.add(barn);
})();

/* ------------------------------------------------------------------ robot */
const robot = buildRobot(); scene.add(robot);
// guided camera moves relative to the moving robot (the drive pauses while the camera flies)
const HOME = { pos: [4.6, 2.1, 3.9], target: [0.55, 0.45, -0.2] };
function flyRel(pos, tgt) { const x = S.s, was = clock.running; clock.pause(); return stage.flyTo([x + pos[0], pos[1], pos[2]], [x + tgt[0], tgt[1], tgt[2]], 1.2).then(() => { if (was) clock.play(); }); }
stage.resetView = () => flyRel(HOME.pos, HOME.target);
const ICON = {
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/></svg>',
  field: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 20h18M4 16l5-3 5 2 6-4M4 11l5-3 5 2 6-4"/></svg>'
};
stage.addTool({ icon: ICON.eye, title: 'Fly to the cameras', onClick: () => flyRel([2.9, 0.85, 1.9], [1.15, 0.3, 0.1]) });
stage.addTool({ icon: ICON.drop, title: 'Fly to the spray nozzles', onClick: () => flyRel([-0.95, 0.55, 1.5], [0.35, 0.12, 0.2]) });
stage.addTool({ icon: ICON.field, title: 'Overview of the treated field', onClick: () => flyRel([-6.5, 4.6, 5.8], [-1.0, 0.3, 0]) });
const insetCanvas = document.createElement('canvas'); const IW = 288, IH = 202; insetCanvas.width = IW; insetCanvas.height = IH; insetCanvas.className = 'robot-cam';
stage.el.appendChild(insetCanvas);
const inspectLabel = stage.addLabel(new THREE.Vector3(), '', { className: 'label3d lg' }); inspectLabel.visible = false;

/* ------------------------------------------------------------------ plants: instanced meshes per species */
const leafMat = leafMaterial({ gloss: 0.55 });
const CAP = { crop: 2600, fathen: 3600, chickweed: 2600, mayweed: 1600, grass: 2600 };
const meshes = {}; const owner = {};
function makeInst(key, geo) {
  if (meshes[key]) { scene.remove(meshes[key]); meshes[key].geometry.dispose(); meshes[key].dispose(); }
  const im = new THREE.InstancedMesh(geo, leafMat, CAP[key]); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.name = key;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < CAP[key]; i++) im.setMatrixAt(i, zero);
  im.setColorAt(0, new THREE.Color(1, 1, 1)); for (let i = 0; i < CAP[key]; i++) im.setColorAt(i, new THREE.Color(1, 1, 1));
  im.userData.free = Array.from({ length: CAP[key] }, (_, i) => CAP[key] - 1 - i);
  meshes[key] = im; owner[key] = new Array(CAP[key]).fill(null); scene.add(im); return im;
}
WEEDS.forEach(w => makeInst(w.id, WEED_GEOMETRY[w.id](11)));

/* ------------------------------------------------------------------ soil, decals, markers, boxes, mist */
let soil = null, soilP = 12, clodMesh = null;
function buildSoil(crop) {
  if (soil) { scene.remove(soil); soil.geometry.dispose(); }
  if (clodMesh) { scene.remove(clodMesh); clodMesh.dispose(); }
  const c = CROPS[crop]; const rows0 = c.rowSp / 2;
  soil = soilStrip({ L: 48, P: soilP, halfW: BAND + 0.75, rowSp: c.rowSp, rows0, tracks: [-ROBOT.wheelZ, ROBOT.wheelZ], segPerRow: 8, segX: 3 }); scene.add(soil);
  clodMesh = clods({ L: 48, halfW: BAND + 0.7, n: 1100 }); scene.add(clodMesh);
  const t = fieldTexture(c.rowSp, c.plantSp); t.repeat.set(360 / 2, 90 / 2); t.needsUpdate = true; outerMat.map = t; outerMat.needsUpdate = true;
}
const decalMat = new THREE.MeshStandardMaterial({ color: 0x120c07, roughness: 0.55, metalness: 0, envMapIntensity: 0.3, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
const DECALS = 1400; const decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), decalMat, DECALS); decals.receiveShadow = true; decals.frustumCulled = false; scene.add(decals); let decalI = 0;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < DECALS; i++) decals.setMatrixAt(i, ZERO);
const ringGeo = new THREE.RingGeometry(0.03, 0.04, 28).rotateX(-Math.PI / 2);
const MARKS = 600; const marks = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false }), MARKS); marks.frustumCulled = false; marks.layers.set(1); scene.add(marks); let markI = 0;
for (let i = 0; i < MARKS; i++) { marks.setMatrixAt(i, ZERO); marks.setColorAt(i, new THREE.Color(1, 1, 1)); }
const MAXB = 160; const boxPos = new Float32Array(MAXB * 24 * 3), boxCol = new Float32Array(MAXB * 24 * 3);
const boxGeo = new THREE.BufferGeometry(); boxGeo.setAttribute('position', new THREE.BufferAttribute(boxPos, 3)); boxGeo.setAttribute('color', new THREE.BufferAttribute(boxCol, 3));
const boxes = new THREE.LineSegments(boxGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, toneMapped: false })); boxes.frustumCulled = false; boxes.layers.set(1); scene.add(boxes);
const mists = Array.from({ length: 14 }, () => { const m = new Mist({ nozzles: [{ pos: [0, 0, 0], dir: [0, -1, 0] }], max: 260, rate: 2600, speed: 2.2, cone: 0.32, size: 0.012, life: 0.2, color: 0xe8f6ff, gravity: 4, drag: 3 }); m.on = false; m.points.material.opacity = 0.7; scene.add(m.points); return { m, until: -1, z: 0 }; });

/* ------------------------------------------------------------------ simulation state */
const S = { s: 0, genX: 0, plants: [], head: 0, detI: 0, evalI: 0, pulses: [], colEnd: [], treated: 0, dist: 0, cnt: null, rng: mulberry32(1), seed: 1, t: 0, lastE: null };
let Zmu = 0, Zsd = 1;
(function calibrateNoise() { let s = 0, s2 = 0, n = 0; for (let i = 0; i < 4000; i++) { const v = fbm2((i % 63) * 0.731 + 11, Math.floor(i / 63) * 0.917 - 7, 4); s += v; s2 += v * v; n++; } Zmu = s / n; Zsd = Math.sqrt(Math.max(1e-9, s2 / n - Zmu * Zmu)); })();
const zField = (x, z) => (fbm2(x / 3.2 + S.seed * 17.3, z / 3.2 - S.seed * 5.1, 4) - Zmu) / Zsd;
function poisson(mu, r) { if (mu <= 0) return 0; if (mu > 30) return Math.max(0, Math.round(mu + Math.sqrt(mu) * randn(r))); const L = Math.exp(-mu); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; }
function P() { const p = ui.values(); const crop = CROPS[p.crop]; return { ...p, cell: p.cellcm / 100, eh: p.eh / 100, lat: SITES[p.loc].lat, kt: ktFor(SITES[p.loc], p.doy), rows: Math.round(2 * HALF_W / crop.rowSp) }; }

function addPlant(o) {
  const key = o.kind === 0 ? 'crop' : WEEDS[o.kind - 1].id; const im = meshes[key];
  o.key = key; o.inst = im.userData.free.length ? im.userData.free.pop() : -1;
  o.y = soil ? soil.heightAt(o.x - soilOffset(), o.z) : 0;
  if (o.inst >= 0) { owner[key][o.inst] = o; setInst(o); }
  S.plants.push(o);
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
function setInst(o) {
  const im = meshes[o.key]; _q.setFromAxisAngle(UP, o.rot); const f = o.scale * (o.dead ? Math.max(0.55, 1 - (S.t - o.deadT) * 0.25) : 1);
  _s.set(f, f * (o.dead ? 0.7 : 1), f); _p.set(o.x, o.y, o.z); _m4.compose(_p, _q, _s); im.setMatrixAt(o.inst, _m4); im.instanceMatrix.needsUpdate = true;
  if (o.dead) _c.setRGB(0.95, 0.72, 0.42); else if (o.wet) _c.setRGB(0.72, 0.8, 0.86); else _c.setRGB(o.tint, o.tint, o.tint * 0.96);
  im.setColorAt(o.inst, _c); im.instanceColor.needsUpdate = true;
}
function freePlant(o) { if (o.inst >= 0) { const im = meshes[o.key]; im.setMatrixAt(o.inst, ZERO); im.instanceMatrix.needsUpdate = true; owner[o.key][o.inst] = null; im.userData.free.push(o.inst); o.inst = -1; } }
function generateTo(xEnd, p) {
  const crop = CROPS[p.crop]; const r = S.rng; const nRows = 2 * Math.floor(BAND / crop.rowSp);   // even: rows at ±rowSp/2, ±3rowSp/2 … like the soil ridges
  while (S.genX < xEnd) {
    const x0 = S.genX, x1 = x0 + 0.5, list = [];
    for (let k = 0; k < nRows; k++) {
      const z = (k - (nRows - 1) / 2) * crop.rowSp;
      for (let n = Math.ceil(x0 / crop.plantSp); n * crop.plantSp < x1; n++) {
        if (r() > crop.emerge) continue;
        list.push({ kind: 0, x: n * crop.plantSp + randn(r) * 0.012, z: z + randn(r) * 0.008, zeta: randn(r), uImg: r(), uKill: r(), rot: r() * 6.283, scale: 0.85 + r() * 0.3, tint: 0.9 + r() * 0.1 });
      }
    }
    const cs = 0.25, sig = p.sigma;
    for (let cx = x0; cx < x1 - 1e-9; cx += cs) for (let cz = -BAND; cz < BAND - 1e-9; cz += cs) {
      const lz = p.lambda * Math.exp(sig * zField(cx + cs / 2, cz + cs / 2) - sig * sig / 2);
      const n = poisson(lz * cs * cs, r);
      for (let i = 0; i < n; i++) {
        let u = r(), sp = 0; while (sp < WEEDS.length - 1 && u > WEEDS[sp].share) { u -= WEEDS[sp].share; sp++; }
        list.push({ kind: sp + 1, x: cx + r() * cs, z: cz + r() * cs, zeta: randn(r), uImg: r(), uKill: r(), rot: r() * 6.283, scale: 0.6 + r() * 0.8, tint: 0.88 + r() * 0.12 });
      }
    }
    list.sort((a, b) => a.x - b.x); list.forEach(o => addPlant(o));
    S.genX = x1;
  }
}
function soilOffset() { return Math.floor(S.s / soilP) * soilP; }
function resetCounts() { S.cnt = { tp: 0, fp: 0, fn: 0, tn: 0, killed: 0, escaped: 0, cropHit: 0, cropN: 0, weedN: 0, area: 0 }; S.treated = 0; S.dist = 0; S.epoch = (S.epoch || 0) + 1; }
function clearPlants() { S.plants.forEach(freePlant); S.plants = []; S.head = 0; S.detI = 0; S.evalI = 0; S.pulses = []; S.colEnd = []; }
function resetField(newSeed) {
  const p = P();
  clearPlants();
  if (newSeed) S.seed = Math.floor(Math.random() * 1e6) + 1;
  S.rng = mulberry32(S.seed * 7919 + 13);
  for (let i = 0; i < DECALS; i++) decals.setMatrixAt(i, ZERO); decals.instanceMatrix.needsUpdate = true;
  for (let i = 0; i < MARKS; i++) marks.setMatrixAt(i, ZERO); marks.instanceMatrix.needsUpdate = true;
  S.s = -8; S.genX = S.s - BEHIND; S.t = 0; resetCounts();
  generateTo(S.s + AHEAD, p);
  // drive 8 m silently so that the field behind the robot already shows the result of spraying
  const e = expected(p); for (let k = 0; k < 400 && S.s < 0; k++) step(0.04, p, e, true);
  resetCounts();
  placeRobot(0);
}

/* ------------------------------------------------------------------ one simulation step */
function colOf(z, cell) { return Math.floor((z + HALF_W) / cell); }
function step(dt, p, e, silent = false) {
  const v = p.v, s0 = S.s; S.s += v * dt; S.t += dt; S.dist += v * dt;
  generateTo(S.s + AHEAD, p);
  const xC = S.s + ROBOT.camX, xN = S.s + ROBOT.nozzleX, cell = p.cell;
  // 1. decisions when plants cross the camera centre line
  while (S.detI < S.plants.length && S.plants[S.detI].x <= xC) {
    const o = S.plants[S.detI++]; if (o.x < s0 + ROBOT.camX - v * dt - 0.5) { o.decided = true; o.out = true; continue; }   // already behind the camera when the field was created
    if (Math.abs(o.z) > HALF_W) { o.decided = true; o.out = true; continue; }
    o.decided = true; o.epoch = S.epoch; o.imaged = o.uImg < e.cov;
    o.score = o.kind === 0 ? o.zeta : e.dEff[o.kind - 1] + o.zeta;
    o.cls = o.imaged && o.score > p.tau;
    if (o.kind === 0) { S.cnt.cropN++; if (o.cls) S.cnt.fp++; else S.cnt.tn++; } else { S.cnt.weedN++; if (o.cls) S.cnt.tp++; else S.cnt.fn++; }
    if (o.cls && e.inTime) {
      const eps = randn(S.rng) * v * p.jitter / 1000; const xc = o.x + eps;
      const col = colOf(o.z, cell); const z0 = -HALF_W + col * cell;
      const pu = { x0: xc - cell / 2, x1: xc + cell / 2, z0, z1: z0 + cell, col, started: false, done: false };
      S.pulses.push(pu);
      const end = S.colEnd[col] ?? -1e9; const add = Math.max(0, pu.x1 - Math.max(pu.x0, end)); S.colEnd[col] = Math.max(end, pu.x1); S.treated += add * cell;
    }
  }
  // 2. pulses reaching the nozzle line: spray (decal + mist)
  for (const pu of S.pulses) {
    if (!pu.started && xN >= pu.x0) {
      pu.started = true;
      const xm = (pu.x0 + pu.x1) / 2, zm = (pu.z0 + pu.z1) / 2;
      const k = decalI++ % DECALS; _m4.makeScale(pu.x1 - pu.x0 + 0.012, 1, pu.z1 - pu.z0 + 0.012); _m4.setPosition(xm, (soil ? soil.heightAt(xm, zm) : 0.02) + 0.008, zm); decals.setMatrixAt(k, _m4); decals.instanceMatrix.needsUpdate = true;
      if (!silent) { const mi = mists.find(q => q.until < S.t) || mists[0]; mi.until = S.t + Math.max(0.08, (pu.x1 - pu.x0) / Math.max(0.05, v)); mi.z = (pu.z0 + pu.z1) / 2; mi.m.on = true; }
    }
  }
  // 3. outcomes once plants have passed under the boom
  while (S.evalI < S.plants.length && S.plants[S.evalI].x <= xN - 0.08) {
    const o = S.plants[S.evalI++]; if (!o.decided || o.out) continue;
    const r = o.kind === 0 ? 0 : WEEDS[o.kind - 1].r / 2;
    const col = colOf(o.z, cell);
    let covered = false;
    for (let i = S.pulses.length - 1; i >= 0; i--) { const pu = S.pulses[i]; if (pu.col === col && pu.x0 <= o.x - r && pu.x1 >= o.x + r) { covered = true; break; } if (pu.x1 < o.x - 1) break; }
    o.wet = covered; const cnt = o.epoch === S.epoch;     // count only plants decided since the last reset
    if (o.kind === 0) { if (covered) { if (cnt) S.cnt.cropHit++; if (p.nonsel && o.uKill < p.eh) { o.dead = true; o.deadT = S.t; } mark(o, 0xff3b3b); } }
    else if (covered && o.uKill < p.eh) { if (cnt) S.cnt.killed++; o.dead = true; o.deadT = S.t; }
    else { if (cnt) S.cnt.escaped++; mark(o, 0xffa51f); }
    if (o.inst >= 0) setInst(o);
  }
  // 4. forget old pulses and plants far behind
  while (S.pulses.length && S.pulses[0].x1 < xN - 1.5) S.pulses.shift();
  while (S.head < S.plants.length && S.plants[S.head].x < S.s - BEHIND) { freePlant(S.plants[S.head]); S.head++; }
  if (S.head > 4000) { S.plants.splice(0, S.head); S.detI -= S.head; S.evalI -= S.head; S.head = 0; }
  S.cnt.area += v * dt * 2 * HALF_W;
}
function mark(o, color) { const k = markI++ % MARKS; _m4.makeScale(o.kind === 0 ? 1.4 : 1, 1, o.kind === 0 ? 1.4 : 1); _m4.setPosition(o.x, o.y + 0.012, o.z); marks.setMatrixAt(k, _m4); marks.setColorAt(k, _c.setHex(color)); marks.instanceMatrix.needsUpdate = true; marks.instanceColor.needsUpdate = true; }

/* ------------------------------------------------------------------ robot motion and camera follow */
let lastRobotX = 0;
function placeRobot() {
  const x = S.s; const dx = x - lastRobotX; lastRobotX = x;
  robot.position.x = x;
  robot.wheels.forEach(w => { w.rotation.z -= dx / ROBOT.wheelR; });
  if (ui.get('follow') && Math.abs(dx) < 5) { camera.position.x += dx; stage.controls.target.x += dx; }
  const off = soilOffset(); if (soil) { soil.position.x = off; clodMesh.position.x = off; }
  const g = Math.floor(x / 2) * 2; grass.position.x = g; outer.position.x = g; trees.position.x = Math.floor(x / 400) * 400;
  sky.sun.target.position.set(x + 0.5, 0, 0); sky.sun.position.copy(sunDir).multiplyScalar(40).add(sky.sun.target.position); sky.sun.target.updateMatrixWorld();
  sky.sky.position.copy(camera.position);
}

/* ------------------------------------------------------------------ detection boxes and the robot camera view */
const _v = new THREE.Vector3();
function updateBoxes(p, e) {
  let n = 0; const show = p.fov;
  if (show) {
    const x0 = S.s + ROBOT.camX - ROBOT.footX / 2, x1 = S.s + ROBOT.camX + ROBOT.footX / 2;
    for (let i = S.evalI; i < S.plants.length && n < MAXB; i++) {
      const o = S.plants[i]; if (o.x < x0) continue; if (o.x > x1) break; if (Math.abs(o.z) > HALF_W) continue;
      const rr = (o.kind === 0 ? CROPS[p.crop].r * 1.6 : WEEDS[o.kind - 1].r * 1.5) * o.scale, h = o.kind === 0 ? 0.06 : 0.04;
      const col = !o.decided ? [0.9, 0.95, 1] : !o.imaged ? [0.6, 0.6, 0.6] : o.cls ? [1, 0.25, 0.8] : [0.25, 1, 0.45];
      const y0 = o.y + 0.005, y1 = o.y + h, a = [o.x - rr, o.x + rr], b = [o.z - rr, o.z + rr];
      const c = [[a[0], y0, b[0]], [a[1], y0, b[0]], [a[1], y0, b[1]], [a[0], y0, b[1]], [a[0], y1, b[0]], [a[1], y1, b[0]], [a[1], y1, b[1]], [a[0], y1, b[1]]];
      const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      E.forEach(([i0, i1], k) => { const off = (n * 24 + k * 2) * 3; boxPos.set(c[i0], off); boxPos.set(c[i1], off + 3); boxCol.set(col, off); boxCol.set(col, off + 3); });
      n++;
    }
  }
  boxGeo.setDrawRange(0, n * 24); boxGeo.attributes.position.needsUpdate = true; boxGeo.attributes.color.needsUpdate = true;
  robot.frustums.visible = show; boxes.visible = show;
}
// inset: render the middle camera's view with its own composer (tone-mapped), read back, add blur and boxes
const insetCam = new THREE.PerspectiveCamera(2 * Math.atan(ROBOT.footX / 2 / (ROBOT.camY - 0.05)) * 180 / Math.PI, ROBOT.footZ / ROBOT.footX, 0.05, 6);
insetCam.up.set(1, 0, 0);
const insetRT = new THREE.WebGLRenderTarget(IW, IH);
const insetComposer = new EffectComposer(renderer, insetRT); insetComposer.renderToScreen = false; insetComposer.setPixelRatio(1); insetComposer.setSize(IW, IH);
insetComposer.addPass(new RenderPass(scene, insetCam)); insetComposer.addPass(new OutputPass());
const insetBuf = new Uint8Array(IW * IH * 4); const insetImg = new ImageData(IW, IH); const tmpCanvas = document.createElement('canvas'); tmpCanvas.width = IW; tmpCanvas.height = IH;
const ictx = insetCanvas.getContext('2d'); let lastInset = -1;
function renderInset(p, e) {
  if (!p.inset) { insetCanvas.style.display = 'none'; return; } insetCanvas.style.display = '';
  const now = performance.now(); if (now - lastInset < 110) return; lastInset = now;
  insetCam.position.set(S.s + ROBOT.camX, ROBOT.camY - 0.05, 0); insetCam.lookAt(S.s + ROBOT.camX, 0, 0); insetCam.updateMatrixWorld();
  const vis = [robot.frustums.visible, boxes.visible, marks.visible]; robot.frustums.visible = false; boxes.visible = false; marks.visible = false;
  const prevRT = renderer.getRenderTarget(), au = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
  insetComposer.render(); renderer.setRenderTarget(prevRT); renderer.shadowMap.autoUpdate = au;
  [robot.frustums.visible, boxes.visible, marks.visible] = vis;
  renderer.readRenderTargetPixels(insetComposer.readBuffer, 0, 0, IW, IH, insetBuf);
  for (let y = 0; y < IH; y++) insetImg.data.set(insetBuf.subarray((IH - 1 - y) * IW * 4, (IH - y) * IW * 4), y * IW * 4);
  const tctx = tmpCanvas.getContext('2d'); tctx.putImageData(insetImg, 0, 0);
  // motion blur along the direction of travel (image vertical), shown at half the camera's pixel scale
  const bpx = Math.min(30, e.blur.px * 0.5); const N = bpx > 0.6 ? Math.min(12, Math.ceil(bpx)) : 1;
  ictx.clearRect(0, 0, IW, IH);
  for (let k = 0; k < N; k++) { ictx.globalAlpha = 1 / (k + 1); ictx.drawImage(tmpCanvas, 0, N > 1 ? (k / (N - 1) - 0.5) * bpx : 0); }
  ictx.globalAlpha = 1;
  // detections
  ictx.lineWidth = 1.5; ictx.font = '600 9px JetBrains Mono, monospace';
  const prior = Math.min(0.95, Math.max(0.05, p.lambda / (p.lambda + e.rho)));
  for (let i = S.evalI; i < S.plants.length; i++) {
    const o = S.plants[i]; if (o.x < S.s + ROBOT.camX - ROBOT.footX / 2) continue; if (o.x > S.s + ROBOT.camX + ROBOT.footX / 2) break; if (Math.abs(o.z) > 0.5) continue;
    _v.set(o.x, o.y + 0.02, o.z).project(insetCam); const X = (_v.x * 0.5 + 0.5) * IW, Y = (-_v.y * 0.5 + 0.5) * IH;
    const rr = (o.kind === 0 ? 0.05 : WEEDS[o.kind - 1].r * 1.6) * o.scale / (ROBOT.footZ) * IW;
    const score = o.kind === 0 ? o.zeta : e.dEff[o.kind - 1] + o.zeta; const cls = o.decided ? o.cls : score > p.tau;
    const pw = pWeed(score, p.d0, e.blur.f, prior);
    ictx.strokeStyle = !o.decided ? 'rgba(235,245,255,0.9)' : cls ? '#ff4fd8' : '#44ff7a';
    ictx.strokeRect(X - rr, Y - rr, 2 * rr, 2 * rr);
    // label only the plants in the decision zone around the centre line, so the view stays readable
    if (Math.abs(o.x - (S.s + ROBOT.camX)) < 0.06) {
      const txt = `${cls ? 'weed' : 'crop'} ${(cls ? pw : 1 - pw).toFixed(2)}`, tw = ictx.measureText(txt).width;
      ictx.fillStyle = 'rgba(6,10,14,0.7)'; ictx.fillRect(X - rr - 1, Y - rr - 13, tw + 4, 12);
      ictx.fillStyle = ictx.strokeStyle; ictx.fillText(txt, X - rr + 1, Y - rr - 4);
    }
  }
  ictx.fillStyle = 'rgba(8,12,16,0.62)'; ictx.fillRect(0, IH - 18, IW, 18);
  ictx.fillStyle = '#d6f5ff'; ictx.font = '500 10px JetBrains Mono, monospace';
  ictx.fillText(`CAM 2 · ${fmt(Math.min(1000 / p.tinf, 60), 0)} fps · exp ${fmt(p.texp, 1)} ms · blur ${fmt(e.blur.px, 1)} px`, 6, IH - 5);
}

/* ------------------------------------------------------------------ charts */
const rocPlot = new Plot('#chart-roc', { x: { label: 'False-positive rate (crop called weed)', unit: '%', min: 0, max: 100 }, y: { label: 'True-positive rate (weeds found)', unit: '%', min: 0, max: 100 } });
const scorePlot = new Plot('#chart-scores', { x: { label: 'Classifier score', unit: '', min: -4, max: 8 }, y: { label: 'Plants m⁻² per unit score', unit: '', min: 0 }, height: 200 });
const tradePlot = new Plot('#chart-trade', { x: { label: 'Weed-control efficacy', unit: '%', min: 0, max: 100 }, y: { label: 'Herbicide saved vs broadcast', unit: '%', min: 0, max: 100 } });
const speedPlot = new Plot('#chart-speed', { x: { label: 'Driving speed', unit: 'm s⁻¹', min: 0, max: 4 }, y: { label: 'Weed-control efficacy', unit: '%', min: 0, max: 100 }, y2: { label: 'Area per day (solar)', unit: 'ha d⁻¹', min: 0 } });
const cmEl = document.getElementById('cm');
function drawCharts(p, e) {
  // ROC
  const R = roc(p.d0, e.blur.f), R0 = roc(p.d0, 1);
  rocPlot.line('chance', [0, 100], [0, 100], { color: 'muted', dash: [4, 4], width: 1.2, label: 'Chance' });
  rocPlot.line('still', R0.fpr.map(v => 100 * v), R0.tpr.map(v => 100 * v), { color: 'water', width: 1.6, dash: [6, 4], label: `Standing still (AUC ${fmt(R0.auc, 3)})` });
  rocPlot.line('now', R.fpr.map(v => 100 * v), R.tpr.map(v => 100 * v), { color: 'accent', width: 2.6, label: `At ${fmt(p.v, 2)} m s⁻¹ (AUC ${fmt(R.auc, 3)})` });
  rocPlot.point('op', 100 * e.fpr / Math.max(1e-9, e.cov), 100 * e.tpr / Math.max(1e-9, e.cov), { color: 'magenta', r: 6, label: `τ = ${fmt(p.tau, 2)}`, guides: true });
  // score densities weighted by abundance
  const xs = linspace(-4, 8, 241), rho = e.rho;
  const crop = xs.map(x => rho * normPdf(x)), weed = xs.map(x => WEEDS.reduce((a, w, k) => a + p.lambda * w.share * normPdf(x - e.dEff[k]), 0));
  scorePlot.line('crop', xs, crop, { color: 'c0', width: 2, fill: 0.18, label: `Crop (${fmt(rho, 1)} m⁻²)` });
  scorePlot.line('weed', xs, weed, { color: 'magenta', width: 2, fill: 0.18, label: `Weeds (${fmt(p.lambda, 1)} m⁻²)` });
  const fpX = xs.filter(x => x >= p.tau), fnX = xs.filter(x => x <= p.tau);
  scorePlot.band('fp', fpX, fpX.map(() => 0), fpX.map(x => rho * normPdf(x)), { color: 'danger', alpha: 0.35, label: 'False positives' });
  scorePlot.band('fn', fnX, fnX.map(() => 0), fnX.map(x => WEEDS.reduce((a, w, k) => a + p.lambda * w.share * normPdf(x - e.dEff[k]), 0)), { color: 'amber', alpha: 0.35, label: 'Missed weeds' });
  scorePlot.vline('tau', p.tau, { color: 'ink', label: 'τ', dash: [4, 3] });
  // trade-off
  const cmpCm = p.cellcm >= 30 ? 6 : 50;                           // comparison curve: the other end of the resolution range
  const T = tradeoff(p), T50 = tradeoff({ ...p, cell: cmpCm / 100 });
  tradePlot.custom('lit', (ctx, pl, P) => {
    // manufacturers state savings only (no efficacy): a band and two lines, labelled on the left
    const AM = a => withAlpha(P.amber || '#b86e0b', a), WA = a => withAlpha(P.water || '#1c78a3', a), X0 = pl.px(0), X1 = pl.px(100);
    ctx.fillStyle = AM(0.07); ctx.fillRect(X0, pl.py(95), X1 - X0, pl.py(50) - pl.py(95));
    [[59, [6, 4]], [94, [2, 3]]].forEach(([y, d]) => { ctx.strokeStyle = AM(0.9); ctx.setLineDash(d); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(X0, pl.py(y)); ctx.lineTo(X1, pl.py(y)); ctx.stroke(); });
    ctx.setLineDash([]); ctx.font = '600 10px Inter, sans-serif'; ctx.fillStyle = AM(1); ctx.textAlign = 'left';
    ctx.fillText('FarmDroid: "up to 94 %"', pl.px(1.5), pl.py(94) + 12);
    ctx.fillText('See & Spray 2024: 59 % average', pl.px(1.5), pl.py(59) - 4);
    ctx.fillText('Ecorobotix: "50 % to over 95 %"', pl.px(1.5), pl.py(50) + 12);
    CLAIMS.forEach(c => {
      if (c.kind === 'maker') return;
      if (c.wce) {
        const x0 = pl.px(c.wce[0]), x1 = pl.px(c.wce[1]), y0 = pl.py(c.save[0]), y1 = pl.py(c.save[1]);
        ctx.fillStyle = WA(0.14); ctx.strokeStyle = WA(0.85); ctx.lineWidth = 1.4;
        if (x1 - x0 > 2) { ctx.fillRect(x0, y1, x1 - x0, y0 - y1); ctx.strokeRect(x0, y1, x1 - x0, y0 - y1); ctx.beginPath(); ctx.moveTo(x0, pl.py(c.saveMean)); ctx.lineTo(x1, pl.py(c.saveMean)); ctx.stroke(); }
        else { ctx.fillStyle = WA(0.95); ctx.beginPath(); ctx.moveTo(x0, y0 - 6); ctx.lineTo(x0 + 6, y0); ctx.lineTo(x0, y0 + 6); ctx.lineTo(x0 - 6, y0); ctx.closePath(); ctx.fill(); }
      }
    });
    ctx.font = '600 10px Inter, sans-serif'; ctx.fillStyle = WA(1); ctx.textAlign = 'left';
    ctx.fillText('Gerhards et al. 2026', pl.px(72) + 4, pl.py(73) + 12); ctx.fillText('10 maize trials', pl.px(72) + 4, pl.py(73) + 24);
    ctx.textAlign = 'right'; ctx.fillText('Allmendinger et al. 2024', pl.px(86) - 9, pl.py(47) + 4);
  });
  tradePlot.line('t50', T50.wce, T50.save, { color: 'muted', width: 1.6, dash: [5, 4], label: `${cmpCm} cm cells (for comparison)` });
  tradePlot.line('t', T.wce, T.save, { color: 'accent', width: 2.6, label: `${fmt(p.cellcm, 0)} cm cells (τ varied)` });
  tradePlot.point('bc', 100 * p.eh, 0, { color: 'ink', r: 4, label: 'broadcast' });
  tradePlot.point('now', 100 * e.wce, 100 * e.saving, { color: 'magenta', r: 6, label: 'your robot', guides: true });
  // speed
  const Sw = speedSweep(p);
  const bad = Sw.v.filter((v, i) => Sw.cov[i] < 0.999 || !expected({ ...p, v }).inTime);
  if (bad.length) speedPlot.region('bad', Math.max(0.05, bad[0]), 4, { color: 'danger', alpha: 0.08, label: 'frames missed' }); else speedPlot.remove('bad');
  speedPlot.line('wce', Sw.v, Sw.wce, { color: 'accent', width: 2.4, label: 'Weed-control efficacy' });
  speedPlot.line('day', Sw.v, Sw.day, { color: 'amber', width: 2.2, y2: true, label: 'Area per day (solar)' });
  speedPlot.vline('v', p.v, { color: 'magenta', label: `${fmt(p.v, 2)} m s⁻¹` });
}
function drawConfusion(e) {
  if (!cmEl) return; const c = S.cnt;
  const tot = c.tp + c.fp + c.fn + c.tn; const prec = c.tp / Math.max(1, c.tp + c.fp), rec = c.tp / Math.max(1, c.tp + c.fn), f1 = 2 * prec * rec / Math.max(1e-9, prec + rec);
  const cellH = (n, lab, kind, exp) => { const a = Math.min(0.85, 0.12 + 0.75 * n / Math.max(1, tot) * 2); const col = kind === 'good' ? `rgba(29,122,74,${a})` : `rgba(194,58,58,${a})`; return `<td style="background:${col};color:${a < 0.45 ? 'var(--ink)' : '#fff'}"><b>${n}</b><span>${lab}</span><small>model ${exp}</small></td>`; };
  cmEl.innerHTML = `<table class="cm"><thead><tr><th></th><th>called weed</th><th>called crop</th></tr></thead><tbody>
    <tr><th>weed</th>${cellH(c.tp, 'TP · sprayed', 'good', fmt(100 * e.tpr, 1) + ' %')}${cellH(c.fn, 'FN · missed', 'bad', fmt(100 * (1 - e.tpr), 1) + ' %')}</tr>
    <tr><th>crop</th>${cellH(c.fp, 'FP · crop sprayed', 'bad', fmt(100 * e.fpr, 1) + ' %')}${cellH(c.tn, 'TN · left alone', 'good', fmt(100 * (1 - e.fpr), 1) + ' %')}</tr></tbody></table>
    <div class="cm-note">${tot} plants inspected in ${fmt(c.area, 0)} m² · precision ${fmt(100 * prec, 1)} % · recall ${fmt(100 * rec, 1)} % · F1 ${fmt(f1, 3)}</div>`;
}

/* ------------------------------------------------------------------ readouts */
function updateReadouts(p, e) {
  const dm = WEEDS.reduce((a, w, k) => a + w.share * e.dEff[k], 0);
  ro.set('dprime', dm, e.blur.f > 0.9 ? 'ok' : e.blur.f > 0.7 ? 'warn' : 'bad', `blur ${fmt(e.blur.b * 1000, 2)} mm = ${fmt(e.blur.px, 1)} px · fat hen ${fmt(e.dEff[0], 2)}, grass ${fmt(e.dEff[3], 2)}`);
  ro.set('recall', 100 * e.tpr, e.tpr > 0.9 ? 'ok' : e.tpr > 0.75 ? 'warn' : 'bad', e.cov < 0.999 ? `only ${fmt(100 * e.cov, 0)} % of the ground imaged` : !e.inTime ? 'decision too late for the nozzles!' : 'at the camera');
  ro.set('fpr', 100 * e.fpr, e.fpr < 0.02 ? 'ok' : e.fpr < 0.06 ? 'warn' : 'bad', `${fmt(e.rho * e.fpr, 2)} crop plants m⁻² sprayed by mistake`);
  ro.set('prec', 100 * e.precision, e.precision > 0.9 ? 'ok' : e.precision > 0.7 ? 'warn' : 'bad', 'share of sprayed plants that are weeds');
  ro.set('vol', e.V, null, `broadcast ${fmt(p.Vbc, 0)} L ha⁻¹ · simulated ${fmt(S.cnt.area > 1 ? p.Vbc * S.treated / S.cnt.area : NaN, 1)}`);
  ro.set('save', 100 * e.saving, e.saving > 0.8 ? 'ok' : e.saving > 0.5 ? 'warn' : 'bad', `treated area ${fmt(100 * e.fT, 1)} % of the field`);
  ro.set('wce', 100 * e.wce, e.wce > 0.9 ? 'ok' : e.wce > 0.8 ? 'warn' : 'bad', `broadcast ${fmt(p.eh * 100, 0)} % · hit accuracy ${fmt(100 * e.pHitMean, 1)} %`);
  ro.set('esc', e.escapes, e.escapes < 1 ? 'ok' : e.escapes < 3 ? 'warn' : 'bad', `of ${fmt(p.lambda, 1)} weeds m⁻²`);
  ro.set('crop', 100 * e.cropHit, e.cropHit < 0.02 ? 'ok' : e.cropHit < 0.06 ? 'warn' : 'bad', p.nonsel ? `≈ ${fmt(100 * e.cropKill, 1)} % of the crop killed (non-selective)` : 'selective product: little damage');
  ro.set('rate', e.W, null, `${fmt(e.wWork, 1)} m working width · ${fmt(K.fieldEff * 100, 0)} % field efficiency`);
  ro.set('day', e.areaDay, e.hE >= 12 ? 'ok' : e.hE >= 6 ? 'warn' : 'bad', `${fmt(e.ePV, 1)} kWh d⁻¹ from the roof → ${fmt(Math.min(24, e.hE), 1)} h at ${fmt(e.P / 1000, 2)} kW`);
  ro.set('eha', e.ePerHa, null, `drive ${fmt(e.pDrive, 0)} W · electronics ${fmt(p.p0, 0)} W · pump ${K.pPump} W`);
}

/* ------------------------------------------------------------------ interaction: inspect a plant */
stage.onPick({
  objects: () => { const l = Object.values(meshes); l.forEach(m => m.computeBoundingSphere()); return l; },
  onClick: hit => {
    if (!hit || hit.instanceId == null) { inspectLabel.visible = false; return; }
    const o = owner[hit.object.name] && owner[hit.object.name][hit.instanceId]; if (!o) { inspectLabel.visible = false; return; }
    const p = P(); const e = S.lastE || expected(p);
    const name = o.kind === 0 ? CROPS[p.crop].name.split(' (')[0] : `${WEEDS[o.kind - 1].name} (<i>${WEEDS[o.kind - 1].latin.split(',')[0]}</i>)`;
    const score = o.kind === 0 ? o.zeta : e.dEff[o.kind - 1] + o.zeta;
    const state = !o.decided ? 'not yet inspected' : o.out ? 'outside the working width' : !o.imaged ? 'missed by the camera (no frame)' : `${o.cls ? 'called <b>weed</b>' : 'called <b>crop</b>'} · score ${fmt(score, 2)} vs τ ${fmt(p.tau, 2)}`;
    const res = o.kind === 0 ? (o.wet ? (o.dead ? 'hit and killed' : 'hit by spray') : '') : o.dead ? 'sprayed — will die' : o.decided && !o.out && S.plants.indexOf(o) < S.evalI ? 'survived (escape)' : '';
    inspectLabel.position.set(o.x, o.y + 0.12, o.z); inspectLabel.element.innerHTML = `${name}<small>${state}${res ? ' · ' + res : ''}</small>`; inspectLabel.visible = true;
  }
});

/* ------------------------------------------------------------------ main update */
let curKey = '';
function update(full = true) {
  const p = P(); const e = expected(p); S.lastE = e;
  const key = p.crop;
  if (key !== curKey) {
    curKey = key; clearPlants(); makeInst('crop', p.crop === 'beet' ? beetGeometry(3) : lettuceGeometry(4));
    buildSoil(p.crop); resetField(false);
  }
  const nozKey = p.cell;
  if (nozKey !== update.nk) { robot.setNozzles(p.cell, HALF_W); update.nk = nozKey; }
  marks.visible = p.marks;
  if (full) { updateReadouts(p, e); drawCharts(p, e); drawConfusion(e); }
  clock.speed = +p.simspeed;
}
const clock = new SimClock({
  speed: 1, maxDt: 0.04,
  onStep: dt => { const p = P(); step(dt, p, S.lastE || expected(p)); },
  onFrame: () => {}
});
clock.onState(run => { playBtns[0].innerHTML = run ? '❚❚ Pause' : '▶ Drive'; });
stage.onKey('space', () => clock.toggle());
let lastUI = 0;
stage.onFrame((dt, t) => {
  const p = P(); const e = S.lastE || expected(p);
  placeRobot();
  updateBoxes(p, e);
  // mist bursts follow the moving nozzle line
  mists.forEach(q => { if (q.until >= S.t) { q.m.nozzles[0].pos.set(S.s + ROBOT.nozzleX - 0.02, robot.nozzleTipY ?? 0.3, q.z); q.m.on = true; } else q.m.on = false; q.m.update(Math.min(dt, 0.05)); });
  // beacon flashes, camera rings flash with the frame rate
  robot.beacon.material.emissiveIntensity = clock.running ? (Math.sin(t * 7) > 0.2 ? 5 : 0.4) : 0.4;
  robot.cameras.forEach(c => { c.ring.material.emissiveIntensity = clock.running ? 1.2 + 2.5 * (Math.sin(t * 2 * Math.PI * Math.min(12, 1000 / p.tinf)) > 0.7 ? 1 : 0) : 1.2; });
  // wilting of sprayed weeds (accelerated for visibility)
  if (clock.running && t - lastUI > 0.25) {
    lastUI = t;
    for (let i = S.head; i < S.evalI; i++) { const o = S.plants[i]; if (o.dead && o.inst >= 0 && S.t - o.deadT < 3.5) setInst(o); }
    drawConfusion(e); updateReadouts(p, e);
    hud.set('t', `Distance <b>${fmt(S.dist, 1)}</b> m · <b>${fmt(p.v * 3.6, 1)}</b> km h⁻¹ · sim ×${p.simspeed}`);
  }
  hud.set('c', `Inspected <b>${S.cnt.tp + S.cnt.fp + S.cnt.fn + S.cnt.tn}</b> · TP <b>${S.cnt.tp}</b> FN <b>${S.cnt.fn}</b> FP <b>${S.cnt.fp}</b> TN <b>${S.cnt.tn}</b>`);
  hud.set('h', `Sprayed <b>${fmt(S.cnt.area > 0.5 ? 100 * S.treated / S.cnt.area : 0, 1)}</b> % of ${fmt(S.cnt.area, 0)} m² · weeds killed <b>${S.cnt.killed}</b> · escaped <b>${S.cnt.escaped}</b>`);
  renderInset(p, e);
});

let raf = 0;
ui.onChange((st, id) => {
  if (id === 'simspeed') { clock.speed = +st.simspeed; return; }
  if (['follow', 'fov', 'marks', 'inset'].includes(id)) { marks.visible = st.marks; return; }
  cancelAnimationFrame(raf); raf = requestAnimationFrame(() => update(true));
});
update(true);
hud.set('t', `Distance <b>0</b> m`);
clock.play();
window.__fr = { S, P, expected };
