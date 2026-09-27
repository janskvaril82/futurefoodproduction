/* Deep-water culture and dissolved oxygen — 3D scene, UI and charts.
   The physics lives in ./model.js (Derive tab, Eqs. D1–D7). */
import { createStage, studioLights, THREE, M, makeRoom, makeRaft, makeNetPot, makeRoots, lettuceGeometry, leafMaterial, makeLEDBar, makePipe, makeProbe, Bubbles, FlowAlong, canvasTexture, surfaceTextures, surfaceMaterial, RoundedBoxGeometry, rng } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, linspace } from '/assets/js/plot.js';
import { colormap } from '/assets/js/colors.js';
import * as Mdl from './model.js';

const STAND_H = 0.42;           // m, top of the steel stand
const WALL = 0.012;             // m, tank wall thickness
const FREE = 0.085;             // m, freeboard above the solution

/* ================================================================ UI */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'do', label: 'Dissolved oxygen', unit: 'mg L⁻¹', digits: 2 })
  .add({ id: 'cs', label: 'Saturation C* at solution T', unit: 'mg L⁻¹', digits: 2 })
  .add({ id: 'tw', label: 'Solution temperature', unit: '°C', digits: 1 })
  .add({ id: 'kla', label: 'Aeration k<sub>L</sub>a (incl. surface)', unit: 'h⁻¹', digits: 2 })
  .add({ id: 'our', label: 'Root O₂ uptake (OUR)', unit: 'mg L⁻¹ h⁻¹', digits: 2 })
  .add({ id: 'css', label: 'Steady-state DO, pump running', unit: 'mg L⁻¹', digits: 2 })
  .add({ id: 'tcrit', label: 'If the pump fails now: DO < 4 after', unit: '', format: v => v == null ? 'not within 72 h' : fmt(v, 1) + ' h' })
  .add({ id: 'roots', label: 'Healthy root fraction', unit: '%', digits: 0 })
  .add({ id: 'pyth', label: 'Pythium risk index (qualitative)', unit: '/100', digits: 0 })
  .add({ id: 'pump', label: 'Air pump electrical power', unit: 'W', digits: 1 })
  .add({ id: 'energy', label: 'Electricity (pump + chiller)', unit: 'kWh d⁻¹', digits: 2 })
  .add({ id: 'cost', label: 'Running cost per year', unit: '€ yr⁻¹', digits: 0 });

ui.section('Simulation');
const [btnPlay, btnReset] = ui.buttons([
  { label: '▶ Run', variant: 'primary', onClick: () => clock.toggle() },
  { label: '↺ Reset to 06:00', onClick: () => resetSim() }
]);
ui.segmented({ id: 'speed', label: 'Speed (simulated time per second)', options: [{ value: 600, label: '10 min' }, { value: 1800, label: '30 min' }, { value: 3600, label: '1 h' }, { value: 7200, label: '2 h' }], value: 1800, persist: false });
ui.section('Tank and crop');
ui.slider({ id: 'V', label: 'Solution volume', min: 20, max: 200, step: 5, value: 80, unit: 'L', help: 'Footprint follows from volume ÷ depth (2 : 1 tote).' });
ui.slider({ id: 'H', label: 'Solution depth', min: 0.15, max: 0.35, step: 0.01, value: 0.22, unit: 'm' });
ui.slider({ id: 'age', label: 'Crop age (days after transplanting)', min: 0, max: 35, step: 1, value: 28, unit: 'd', help: 'Root dry mass grows from ≈ 0.03 to ≈ 1.2 g per plant.' });
ui.slider({ id: 'qO2', label: 'Specific root respiration at 20 °C', min: 1, max: 8, step: 0.1, value: 5, unit: 'mg O₂ g⁻¹ h⁻¹', help: 'Lesson 5.3 estimate for lettuce: ≈ 2–7.' });
ui.select({ id: 'variety', label: 'Lettuce type (visual only)', options: [{ value: 'butterhead', label: 'Butterhead' }, { value: 'green', label: 'Green leaf' }, { value: 'red', label: 'Red leaf' }, { value: 'oakleaf', label: 'Oak leaf' }], value: 'butterhead' });
ui.section('Aeration');
ui.slider({ id: 'qAir', label: 'Air flow at the stones', min: 0, max: 12, step: 0.1, value: 4, unit: 'L min⁻¹', help: 'Small aquarium pumps: 1–5 L min⁻¹; 0 = no aeration.' });
ui.slider({ id: 'stones', label: 'Number of air stones', min: 1, max: 4, step: 1, value: 2 });
ui.slider({ id: 'eff', label: 'Pump wire-to-air efficiency', min: 0.04, max: 0.3, step: 0.01, value: 0.1, format: v => fmt(v * 100, 0) + ' %', help: 'Assumed ≈ 10 % for small diaphragm pumps — check your rating plate.' });
ui.section('Room climate');
ui.slider({ id: 'Tday', label: 'Air temperature, lights on', min: 10, max: 35, step: 0.5, value: 21, unit: '°C' });
ui.slider({ id: 'Tnight', label: 'Air temperature, lights off', min: 8, max: 32, step: 0.5, value: 18, unit: '°C' });
ui.slider({ id: 'photo', label: 'Photoperiod (lights on at 06:00)', min: 8, max: 24, step: 0.5, value: 16, unit: 'h' });
ui.slider({ id: 'lampHeat', label: 'Lamp heat absorbed by the tank', min: 0, max: 40, step: 1, value: 6, unit: 'W' });
ui.slider({ id: 'U', label: 'Wall heat-loss coefficient U', min: 1, max: 12, step: 0.5, value: 6, unit: 'W m⁻² K⁻¹', help: 'Bare plastic ≈ 5–12; insulated ≈ 1–3.' });
ui.section('Chiller');
ui.toggle({ id: 'chill', label: 'Solution chiller installed', value: false });
ui.slider({ id: 'Tset', label: 'Chiller set point', min: 16, max: 26, step: 0.5, value: 21, unit: '°C' });
ui.slider({ id: 'chillCap', label: 'Cooling capacity', min: 50, max: 400, step: 10, value: 150, unit: 'W' });
ui.slider({ id: 'cop', label: 'Chiller COP', min: 1.5, max: 4, step: 0.1, value: 2.5, help: 'Coefficient of performance: heat removed ÷ electricity (assumed).' });
ui.section('Power cut');
ui.toggle({ id: 'cut', label: 'Schedule a power cut (pump and chiller stop)', value: false });
ui.slider({ id: 'cutStart', label: 'Starts at (hours after midnight, day 1)', min: 6, max: 60, step: 0.5, value: 20, unit: 'h', format: v => `day ${Math.floor(v / 24) + 1} · ${String(Math.floor(v % 24)).padStart(2, '0')}:${v % 1 ? '30' : '00'}` });
ui.slider({ id: 'cutDur', label: 'Duration', min: 0.5, max: 24, step: 0.5, value: 10, unit: 'h' });
ui.section('Economics and display');
ui.slider({ id: 'price', label: 'Electricity price', min: 0.05, max: 0.5, step: 0.01, value: 0.15, unit: '€ kWh⁻¹' });
ui.toggle({ id: 'doMap', label: 'Colour the solution by DO', value: false });
ui.toggle({ id: 'labels', label: 'Show component labels', value: true });
let pendingReset = false;
const reset = () => { pendingReset = true; };
ui.presets([
  { label: 'Well-aerated winter', values: { Tday: 20, Tnight: 16, qAir: 4, stones: 2, age: 28, chill: false, cut: false, lampHeat: 6, V: 80, H: 0.22 }, onApply: reset },
  { label: 'Hot summer, no aeration', values: { Tday: 30, Tnight: 25, qAir: 0, age: 30, chill: false, cut: false, lampHeat: 8, V: 80, H: 0.22 }, onApply: reset },
  { label: 'Power failure overnight', values: { Tday: 25, Tnight: 23, qAir: 4, stones: 2, age: 33, chill: false, cut: true, cutStart: 20, cutDur: 12, V: 80, H: 0.22 }, onApply: reset },
  { label: 'Chilled summer', values: { Tday: 30, Tnight: 25, qAir: 4, stones: 2, age: 30, chill: true, Tset: 21, cut: false, V: 80, H: 0.22 }, onApply: reset },
  { label: 'Seedlings, small pump', values: { Tday: 22, Tnight: 18, qAir: 1, stones: 1, age: 7, chill: false, cut: false, V: 40, H: 0.2 }, onApply: reset }
]);
const zoomRoot = () => { const g = geo(); stage.flyTo([g.w * 0.25, STAND_H + 0.18, g.d / 2 + 0.55], [0, STAND_H + g.H * 0.45, 0], 1.6); };
ui.button({ label: '🔍 Zoom into the root zone', onClick: () => zoomRoot() });
ui.saveButton('deep-water-culture', () => ro.values());

/* ================================================================ state */
let s = ui.values(), d = Mdl.derived(s), st = Mdl.initState(s, 6);
const hist = { t: [], C: [], Cs: [], T: [] };
const geo = () => d.g;

/* ================================================================ stage */
const stage = createStage('#stage', {
  background: '#0b100f', envIntensity: 0.35, exposure: 1.0,
  camera: { pos: [1.2, 1.12, 1.45], target: [0.06, STAND_H + 0.2, 0], fov: 42 },
  controls: { minDistance: 0.35, maxDistance: 6 },
  bloom: { strength: 0.5, radius: 0.4, threshold: 1.0 }, ao: { radius: 0.12, intensity: 0.85 }
});
const { scene } = stage;
const toolZoom = stage.addTool && stage.addTool({ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="M20 20l-5-5"/></svg>', title: 'Zoom into the root zone', onClick: () => zoomRoot() });
const toolRun = stage.addTool && stage.addTool({ icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>', title: 'Run or pause the simulation (space)', onClick: () => clock.toggle() });
const lights = studioLights(stage, { intensity: 0.9, shadowSize: 1.6, keyPos: [2.2, 3.6, 2.4] });
const room = makeRoom({ w: 6, d: 5, h: 2.8, wallColor: 0x3b423f, floor: 'epoxy' });
room.floor.material.color.set(0x9aa19e); room.floor.material.roughnessMap = null; room.floor.material.roughness = 0.62; room.floor.material.needsUpdate = true; scene.add(room);
const hud = hudChips(stage.el);
const legend = document.createElement('div'); legend.className = 'stage-legend'; legend.style.display = 'none'; stage.el.appendChild(legend);

const standGroup = new THREE.Group(), tankGroup = new THREE.Group(), cropGroup = new THREE.Group(), airGroup = new THREE.Group(), chillGroup = new THREE.Group(), fixtureGroup = new THREE.Group();
scene.add(standGroup, tankGroup, cropGroup, airGroup, chillGroup, fixtureGroup);
const tankMat = M.plastic(0x23282a, 0.6);
const lipMat = M.plastic(0x2b3033, 0.5);
const hatch = canvasTexture(64, 64, (c, w, h) => { c.fillStyle = '#8d9699'; c.fillRect(0, 0, w, h); c.strokeStyle = '#5c6467'; c.lineWidth = 5; for (let i = -h; i < w; i += 14) { c.beginPath(); c.moveTo(i, h); c.lineTo(i + h, 0); c.stroke(); } }, { key: 'dwc-hatch' });
const sectionMat = new THREE.MeshStandardMaterial({ map: hatch, roughness: 0.7 });
const rootMat = M.root();
const HEALTHY = new THREE.Color(0xf1ead3), BROWN = new THREE.Color(0x6e4b2c);
const leafMat = leafMaterial({ gloss: 0.45 });
const waterSurfN = surfaceTextures({ key: 'waterN', size: 256, scale: 4, octaves: 4, palette: ['#888', '#999'], normalStrength: 1.4 }).normal.clone();
waterSurfN.needsUpdate = true;
const frontTex = canvasTexture(64, 256, (c, w, h) => {
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(170,225,230,1)'); g.addColorStop(0.08, 'rgba(120,196,206,1)'); g.addColorStop(1, 'rgba(22,82,96,1)');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  const r = rng(5); c.globalAlpha = 0.07; c.strokeStyle = '#ffffff';
  for (let i = 0; i < 60; i++) { c.lineWidth = 1 + r() * 2; c.beginPath(); const x = r() * w; c.moveTo(x, r() * h * 0.2); c.bezierCurveTo(x + 10, h * 0.3, x - 10, h * 0.6, x + (r() - 0.5) * 20, h); c.stroke(); }
}, { key: 'dwc-front' });
const waterFrontMat = new THREE.MeshPhysicalMaterial({ map: frontTex, color: 0x9fd6de, transparent: true, opacity: 0.34, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
const waterSideMat = new THREE.MeshPhysicalMaterial({ color: 0x2f7f92, transparent: true, opacity: 0.16, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide });
const bubbleMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, roughness: 0.08, metalness: 0, clearcoat: 1, emissive: 0xbfe9ff, emissiveIntensity: 0.35, envMapIntensity: 2, depthWrite: false });
const surfMat = new THREE.MeshPhysicalMaterial({ color: 0x5aa8b8, roughness: 0.03, transparent: true, opacity: 0.5, normalMap: waterSurfN, normalScale: new THREE.Vector2(0.4, 0.4), clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false });
let water = null, surf = null, raft = null, levelY = 0, lettuceMeshes = [], rootMeshes = [], bubbles = null, flows = [], stonesMeshes = [], pump = null, pumpLED = null, meter = null, meterTex = null, meterCtx = null, probe = null, chillFan = null, led = null, labelObjs = [];

function buildStand(g) {
  standGroup.clear();
  const steel = M.galvanised();
  const W = g.w + 2 * WALL + 0.5, D = g.d + 2 * WALL + 0.16;
  const top = new THREE.Mesh(new RoundedBoxGeometry(W, 0.03, D, 2, 0.006), M.paintedSteel(0xcfd3d0)); top.position.set(0.14, STAND_H - 0.015, 0); top.receiveShadow = top.castShadow = true; standGroup.add(top);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, STAND_H - 0.03, 0.04), steel); leg.position.set(0.14 + a * (W / 2 - 0.03), (STAND_H - 0.03) / 2, b * (D / 2 - 0.03)); leg.castShadow = true; standGroup.add(leg); });
  const rail = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, 0.03, 0.03), M.paintedSteel(0xb9bebb)); rail.position.set(0.14, 0.12, -D / 2 + 0.03); standGroup.add(rail);
  const rail2 = rail.clone(); rail2.position.z = D / 2 - 0.03; standGroup.add(rail2);
  // wall socket for the pump
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.08, 0.012, 2, 0.006), M.plasticWhite()); plate.position.set(g.w / 2 + 0.34, 0.3, -2.49); standGroup.add(plate);
}

function buildTank(g) {
  tankGroup.clear();
  const iw = g.w, id = g.d, h = g.H + FREE; const ow = iw + 2 * WALL, od = id + 2 * WALL;
  const add = (sx, sy, sz, x, y, z, mat = tankMat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, STAND_H + y, z); m.castShadow = true; m.receiveShadow = true; tankGroup.add(m); return m; };
  add(ow, WALL, od, 0, WALL / 2, 0);                                   // bottom
  add(ow, h, WALL, 0, h / 2, -od / 2 + WALL / 2);                      // back
  add(WALL, h, od, -ow / 2 + WALL / 2, h / 2, 0);                      // left
  add(WALL, h, od, ow / 2 - WALL / 2, h / 2, 0);                       // right
  // lip around the rim (open at the cut-away front)
  add(ow + 0.04, 0.012, 0.03, 0, h, -od / 2 - 0.004, lipMat);
  add(0.03, 0.012, od + 0.02, -ow / 2 - 0.006, h, 0.005, lipMat);
  add(0.03, 0.012, od + 0.02, ow / 2 + 0.006, h, 0.005, lipMat);
  // hatched section faces where the front wall has been cut away
  add(WALL + 0.001, h, 0.003, -ow / 2 + WALL / 2, h / 2, od / 2 + 0.0015, sectionMat);
  add(WALL + 0.001, h, 0.003, ow / 2 - WALL / 2, h / 2, od / 2 + 0.0015, sectionMat);
  add(ow, WALL + 0.001, 0.003, 0, WALL / 2, od / 2 + 0.0015, sectionMat);
  // water volume: front face with depth gradient, other faces faint
  levelY = STAND_H + WALL + g.H;
  const mats = [waterSideMat, waterSideMat, waterSideMat, waterSideMat, waterFrontMat, waterSideMat];
  water = new THREE.Mesh(new THREE.BoxGeometry(iw - 0.002, g.H, id - 0.002), mats); water.position.set(0, STAND_H + WALL + g.H / 2, 0); water.renderOrder = 2; tankGroup.add(water);
  waterSurfN.repeat.set(iw * 3, id * 3);
  surf = new THREE.Mesh(new THREE.PlaneGeometry(iw - 0.002, id - 0.002), surfMat); surf.rotation.x = -Math.PI / 2; surf.position.y = levelY + 0.0005; surf.renderOrder = 3; tankGroup.add(surf);
  // raft
  raft = makeRaft({ w: iw - 0.012, d: id - 0.012, nx: g.nx, nz: g.nz, holeR: 0.027, thickness: 0.03 });
  raft.position.y = levelY - 0.006; tankGroup.add(raft);
  // DO probe clipped to the right wall, hanging into a gap next to the raft
  probe = makeProbe({ length: 0.24, radius: 0.0085, cap: 0xf2b400, tip: 'steel' });
  probe.position.set(ow / 2 - WALL - 0.013, levelY - g.H * 0.55, id / 2 - 0.05); probe.children.forEach(c => c.castShadow = true); tankGroup.add(probe);
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.026), M.plasticBlack()); clip.position.set(ow / 2 - 0.002, STAND_H + h - 0.01, id / 2 - 0.05); tankGroup.add(clip);
  // hand-held DO meter on the stand
  meter = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.13, 0.03, 3, 0.01), M.plastic(0x2d3236, 0.4)); meter.add(body);
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 192; meterCtx = cv.getContext('2d');
  meterTex = new THREE.CanvasTexture(cv); meterTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.058, 0.044), new THREE.MeshBasicMaterial({ map: meterTex, toneMapped: false })); screen.position.set(0, 0.03, 0.0155); meter.add(screen);
  [-1, 0, 1].forEach(i => { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.004, 16), M.plastic(0x566068, 0.5)); b.rotation.x = Math.PI / 2; b.position.set(i * 0.018, -0.03, 0.016); meter.add(b); });
  meter.position.set(ow / 2 + 0.12, STAND_H + 0.065, od / 2 - 0.02); meter.rotation.set(-0.25, -0.5, 0); meter.traverse(m => { if (m.isMesh) m.castShadow = true; }); tankGroup.add(meter);
  const cable = makePipe([[ow / 2 - WALL - 0.013, levelY + 0.1, id / 2 - 0.05], [ow / 2 + 0.03, levelY + 0.12, id / 2 - 0.02], [ow / 2 + 0.09, STAND_H + 0.1, od / 2 + 0.02], [ow / 2 + 0.12, STAND_H + 0.13, od / 2 - 0.02]], { radius: 0.0022, material: M.plasticBlack() });
  tankGroup.add(cable);
}

function buildCrop(g, s) {
  cropGroup.clear(); lettuceMeshes = []; rootMeshes = [];
  const growth = Math.max(0.06, Math.min(1, s.age / 35));
  const holes = raft.holes.map(p => new THREE.Vector3(p.x, levelY - 0.006 + 0.03, p.z));
  const geos = [0, 1, 2].map(k => lettuceGeometry({ radius: 0.13, growth, variety: s.variety, seed: 21 + k * 13, leaves: 20 }));
  const lenMax = g.H - 0.035;
  const rootL = Math.min(lenMax, 0.025 + lenMax * Math.pow(s.age / 32, 0.9));
  const rgeos = [0, 1, 2].map(k => makeRoots({ count: 16, length: rootL, spread: 0.016, thickness: 0.0016, seed: 7 + k * 5, laterals: 2 }).geometry);
  const pots = []; const pebbleGeo = new THREE.SphereGeometry(1, 8, 6); const pebbleMat = new THREE.MeshStandardMaterial({ color: 0xa4563a, roughness: 0.9 });
  const pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, holes.length * 9); let pk = 0; const r = rng(3); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  const buckets = [[], [], []];
  holes.forEach((p, i) => {
    const pot = makeNetPot({ radius: 0.026, height: 0.05, color: 0x17191b }); pot.position.copy(p).add(new THREE.Vector3(0, 0.002, 0)); cropGroup.add(pot); pots.push(pot);
    for (let k = 0; k < 9; k++) { const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 0.02, sz = 0.0045 + r() * 0.003; pos.set(p.x + Math.cos(a) * rr, p.y - 0.004 + r() * 0.004, p.z + Math.sin(a) * rr); sc.set(sz, sz * 0.85, sz); q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, 0)); m4.compose(pos, q, sc); pebbles.setMatrixAt(pk++, m4); }
    buckets[i % 3].push([p, i]);
  });
  pebbles.count = pk; pebbles.castShadow = true; cropGroup.add(pebbles);
  buckets.forEach((b, k) => {
    if (!b.length) return;
    const im = new THREE.InstancedMesh(geos[k], leafMat, b.length);
    const rim = new THREE.InstancedMesh(rgeos[k], rootMat, b.length);
    b.forEach(([p, i], j) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.7); const s0 = 0.92 + (i % 4) * 0.04; sc.set(s0, s0, s0);
      m4.compose(new THREE.Vector3(p.x, p.y + 0.004, p.z), q, sc); im.setMatrixAt(j, m4);
      const sp = 0.85 + 0.35 * Math.min(1, s.age / 30); sc.set(sp, 1, sp);
      m4.compose(new THREE.Vector3(p.x, p.y - 0.045, p.z), q, sc); rim.setMatrixAt(j, m4);
    });
    im.castShadow = true; im.receiveShadow = true; cropGroup.add(im); lettuceMeshes.push(im);
    rim.castShadow = true; cropGroup.add(rim); rootMeshes.push(rim);
  });
}

function buildAir(g, s) {
  airGroup.clear(); flows = []; stonesMeshes = [];
  const ow = g.w + 2 * WALL, od = g.d + 2 * WALL, h = g.H + FREE;
  const stoneMat = surfaceMaterial('concrete', [0.4, 0.4], { color: 0xb9c3c8, roughness: 1 });
  const tubeMat = new THREE.MeshPhysicalMaterial({ color: 0xe7eef0, roughness: 0.25, transparent: true, opacity: 0.6, clearcoat: 0.6 });
  const emit = [];
  const n = s.stones;
  // the pump sits on a small bracket shelf above the water line (plus check valves), as recommended in Lesson 5.3
  const shelfY = STAND_H + h + 0.035, shelfX = ow / 2 + 0.17, shelfZ = -od / 2 + 0.1;
  const steelP = M.galvanised();
  const shelfTop = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.008, 0.17, 2, 0.003), M.paintedSteel(0xd9dcd8)); shelfTop.position.set(shelfX, shelfY - 0.004, shelfZ); shelfTop.castShadow = shelfTop.receiveShadow = true; airGroup.add(shelfTop);
  const postP = new THREE.Mesh(new THREE.BoxGeometry(0.025, shelfY - STAND_H, 0.025), steelP); postP.position.set(shelfX + 0.085, STAND_H + (shelfY - STAND_H) / 2, shelfZ - 0.06); postP.castShadow = true; airGroup.add(postP);
  const brace = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, Math.hypot(0.12, 0.12)), steelP); brace.position.set(shelfX + 0.085, shelfY - 0.07, shelfZ - 0.002); brace.rotation.x = -Math.PI / 4; airGroup.add(brace);
  const footP = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.006, 0.07), steelP); footP.position.set(shelfX + 0.085, STAND_H + 0.003, shelfZ - 0.06); airGroup.add(footP);
  pump = new THREE.Group();
  const pb = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.075, 0.115, 4, 0.02), M.plastic(0xe8e9e4, 0.45)); pb.position.y = 0.045; pump.add(pb);
  const top = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.012, 0.095, 2, 0.005), M.plastic(0x3a4247, 0.5)); top.position.y = 0.084; pump.add(top);
  const plate = canvasTexture(256, 128, (c, w, hh) => { c.fillStyle = '#3a4247'; c.fillRect(0, 0, w, hh); c.fillStyle = '#e8f0ec'; c.font = '700 34px Inter, sans-serif'; c.fillText('AIR PUMP', 18, 52); c.font = '500 22px Inter, sans-serif'; c.fillStyle = '#9fd8b8'; c.fillText('230 V · 50 Hz · IPX4', 18, 90); }, { key: 'dwc-plate' });
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.06), new THREE.MeshStandardMaterial({ map: plate, roughness: 0.5 })); pl.rotation.x = -Math.PI / 2; pl.position.y = 0.0905; pump.add(pl);
  const ventMat = M.plasticBlack(); for (let i = 0; i < 7; i++) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.034, 0.003), ventMat); v.position.set(-0.045 + i * 0.015, 0.045, 0.0585); pump.add(v); }
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.008, 16), M.rubber()); f.position.set(a * 0.065, 0.004, b * 0.04); pump.add(f); });
  pumpLED = new THREE.Mesh(new THREE.SphereGeometry(0.004, 12, 8), M.emissive(0x2cff6a, 3)); pumpLED.position.set(0.07, 0.07, 0.058); pump.add(pumpLED);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.025, 12), M.plasticGrey()); nozzle.rotation.z = Math.PI / 2; nozzle.position.set(-0.095, 0.05, 0.02); pump.add(nozzle);
  pump.position.set(shelfX, shelfY, shelfZ - 0.025); pump.traverse(m => { if (m.isMesh) m.castShadow = true; }); pump.userData.base = pump.position.clone(); airGroup.add(pump);
  // power cord down the back of the stand to a wall socket
  airGroup.add(makePipe([[shelfX + 0.085, shelfY + 0.03, shelfZ - 0.03], [shelfX + 0.13, shelfY - 0.05, shelfZ - 0.12], [shelfX + 0.16, STAND_H + 0.05, -od / 2 - 0.12], [shelfX + 0.18, 0.02, -od / 2 - 0.3], [g.w / 2 + 0.34, 0.02, -2.2], [g.w / 2 + 0.34, 0.3, -2.47]], { radius: 0.0025, material: M.plasticBlack(), tension: 0.3 }));
  // gang valve (manifold) beside the pump
  const manX = shelfX - 0.03, manZ = shelfZ + 0.066;
  const man = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.016, 0.018), M.plastic(0x2d6fb3, 0.4)); man.position.set(manX, shelfY + 0.009, manZ); man.castShadow = true; airGroup.add(man);
  for (let i = 0; i < n; i++) { const kn = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.01, 10), M.plasticWhite()); kn.position.set(manX - 0.025 + i * 0.016, shelfY + 0.022, manZ); airGroup.add(kn); }
  const inlet = [shelfX - 0.107, shelfY + 0.05, shelfZ - 0.005];
  const trunk = makePipe([inlet, [shelfX - 0.125, shelfY + 0.035, shelfZ + 0.03], [manX + 0.045, shelfY + 0.012, manZ]], { radius: 0.0035, material: tubeMat, tension: 0.4 }); airGroup.add(trunk);
  flows.push({ f: new FlowAlong(trunk.curve, { count: 10, speed: 0.1, size: 0.007, color: 0xffffff, jitter: 0.001, opacity: 0.8 }), share: 1 });
  for (let i = 0; i < n; i++) {
    const x = -g.w / 2 + (i + 0.5) * g.w / n, z = -g.d * 0.05;
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.028, 28), stoneMat); st.position.set(x, STAND_H + WALL + 0.014, z); st.castShadow = true; st.receiveShadow = true; airGroup.add(st); stonesMeshes.push(st);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.012, 12), M.plasticGrey()); cap.position.set(x, STAND_H + WALL + 0.034, z); airGroup.add(cap);
    emit.push([x, STAND_H + WALL + 0.03, z]);
    // airline: stone → up the back wall → over the rim → check valve → manifold
    const ox = manX - 0.025 + i * 0.016;
    const pts = [[x, STAND_H + WALL + 0.04, z], [x, STAND_H + WALL + 0.06, -g.d / 2 + 0.03], [x * 0.9, levelY + 0.02, -g.d / 2 + 0.012], [x * 0.9 + 0.01, STAND_H + h + 0.04, -od / 2 - 0.004], [x * 0.4 + ox * 0.6, STAND_H + h + 0.1, -od / 2 + 0.02 + i * 0.01], [ox, shelfY + 0.06, manZ], [ox, shelfY + 0.026, manZ]];
    const tube = makePipe(pts, { radius: 0.0032, material: tubeMat, tension: 0.35 }); airGroup.add(tube);
    const cv = new THREE.Group(); const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.022, 14), M.plastic(0xd9412e, 0.4)); const c2 = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.012, 14), M.plasticWhite()); c2.position.y = 0.016; cv.add(c1, c2);
    const pv = tube.curve.getPointAt(0.72); const tv = tube.curve.getTangentAt(0.72); cv.position.copy(pv); cv.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tv); airGroup.add(cv);
    flows.push({ f: new FlowAlong(tube.curve.clone(), { count: 14, speed: 0.1, size: 0.006, color: 0xffffff, jitter: 0.001, opacity: 0.75 }), reverse: true, share: 1 / n });
  }
  flows.forEach(o => { if (o.reverse) o.f.speed = -0.1; airGroup.add(o.f.points); });
  bubbles = new Bubbles({ emitters: emit, top: levelY - 0.004, rate: 0, size: 0.0034, spread: 0.03, speed: 0.26, max: 700 });
  bubbles.mesh.material.dispose();
  bubbles.mesh.material = bubbleMat;   // bright, cheap bubbles that stay visible inside the tinted water
  bubbles.mesh.renderOrder = 1; airGroup.add(bubbles.mesh);
}

function buildChiller(g, s) {
  chillGroup.clear(); chillFan = null; if (!s.chill) return;
  const x = -(g.w / 2 + WALL) - 0.3, z = 0.05;
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.3, 0.22, 3, 0.02), M.plastic(0xeef0ec, 0.4)); body.position.set(x, 0.15 + 0.012, z); chillGroup.add(body);
  const grille = new THREE.Mesh(new THREE.CircleGeometry(0.075, 40), new THREE.MeshStandardMaterial({ color: 0x1d2124, roughness: 0.7 })); grille.position.set(x, 0.17, z + 0.1105); chillGroup.add(grille);
  chillFan = new THREE.Group(); for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.018, 0.003), M.plastic(0x4a5157, 0.5)); b.position.x = 0.03; const p = new THREE.Group(); p.rotation.z = i * Math.PI * 2 / 5; p.add(b); chillFan.add(p); }
  chillFan.position.set(x, 0.17, z + 0.114); chillGroup.add(chillFan);
  const disp = canvasTexture(128, 48, (c, w, h) => { c.fillStyle = '#0c1a14'; c.fillRect(0, 0, w, h); c.fillStyle = '#6fe39a'; c.font = '600 26px monospace'; c.fillText('SET ' + s.Tset.toFixed(1), 8, 33); }, {});
  const dm = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.03), new THREE.MeshBasicMaterial({ map: disp, toneMapped: false })); dm.position.set(x, 0.275, z + 0.1105); chillGroup.add(dm);
  const feetMat = M.rubber(); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 12), feetMat); f.position.set(x + a * 0.1, 0.006, z + b * 0.08); chillGroup.add(f); });
  const hoseMat = M.plastic(0x1c1f22, 0.6);
  [-0.05, 0.05].forEach((dz, i) => chillGroup.add(makePipe([[x + 0.13, 0.26, z + dz], [x + 0.2, 0.35 + i * 0.02, z + dz], [-(g.w / 2 + WALL) - 0.03, STAND_H + g.H + FREE + 0.06, z + dz * 1.6], [-(g.w / 2) + 0.03, STAND_H + g.H + FREE + 0.02, z + dz * 1.6], [-(g.w / 2) + 0.035, STAND_H + WALL + g.H * 0.35, z + dz * 1.6]], { radius: 0.007, material: hoseMat, tension: 0.4 })));
  chillGroup.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
}

function buildFixture(g) {
  fixtureGroup.clear();
  const y = STAND_H + g.H + FREE + 0.42;
  led = makeLEDBar({ length: Math.max(0.5, g.w * 0.95), width: Math.min(0.24, g.d * 0.6), color: 'full', light: 'rect', lightIntensity: 7 });
  led.position.set(0, y, 0); fixtureGroup.add(led);
  [-1, 1].forEach(sx => { const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 2.8 - y, 6), M.steel()); wire.position.set(sx * g.w * 0.42, y + (2.8 - y) / 2, 0); fixtureGroup.add(wire); });
}

/* labels */
function buildLabels(g) {
  labelObjs.forEach(l => l.parent && l.parent.remove(l)); labelObjs = [];
  const mk = (target, off) => { const l = stage.addLabel(target, '', { offset: off, className: 'label3d' }); labelObjs.push(l); return l; };
  labelObjs.pump = mk(pump, [0, 0.14, 0]);
  labelObjs.probe = mk(meter, [0, 0.12, 0]);
  labelObjs.roots = mk([-g.w * 0.3, STAND_H + WALL + g.H * 0.62, g.d / 2 + 0.02], [0, 0, 0]);
  labelObjs.stone = mk([-g.w / 2 + 0.5 * g.w / ui.get('stones'), STAND_H + 0.012, g.d / 2], [0, -0.035, 0]);
}

/* ================================================================ rebuild logic */
let keyTank = '', keyCrop = '', keyAir = '', keyChill = '';
function rebuild() {
  const g = d.g;
  const kT = [s.V, s.H].join('|');
  if (kT !== keyTank) { buildStand(g); buildTank(g); buildFixture(g); keyTank = kT; keyCrop = ''; keyAir = ''; keyChill = ''; }
  const kC = [kT, s.age, s.variety].join('|');
  if (kC !== keyCrop) { buildCrop(g, s); keyCrop = kC; }
  const kA = [kT, s.stones].join('|');
  if (kA !== keyAir) { buildAir(g, s); keyAir = kA; buildLabels(g); }
  const kH = [kT, s.chill, s.Tset].join('|');
  if (kH !== keyChill) { buildChiller(g, s); keyChill = kH; }
}

/* ================================================================ charts */
const doPlot = new Plot('#chart-do', { x: { label: 'Time since start', unit: 'h', min: 0, max: 48 }, y: { label: 'Dissolved oxygen', unit: 'mg L⁻¹', min: 0, max: 12 }, y2: { label: 'Solution temperature', unit: '°C', min: 10, max: 34 } });
const satPlot = new Plot('#chart-sat', { x: { label: 'Solution temperature', unit: '°C', min: 10, max: 34 }, y: { label: 'Dissolved oxygen', unit: 'mg L⁻¹', min: 0, max: 12 } });
const ourPlot = new Plot('#chart-our', { x: { label: 'Solution temperature', unit: '°C', min: 10, max: 34 }, y: { label: 'O₂ flux', unit: 'mg L⁻¹ h⁻¹', log: true, min: 0.01, max: 100 } });
const TT = linspace(10, 34, 97);

function staticCharts() {
  const Cs = TT.map(T => Mdl.cStar(T, d));
  satPlot.region('pyth', 24, 34, { color: 'amber', alpha: 0.1, label: 'Pythium favoured (> 24 °C)' });
  satPlot.hregion('hyp', 0, Mdl.P.cCrit, { color: 'danger', alpha: 0.07 });
  satPlot.hline('crit', Mdl.P.cCrit, { color: 'danger', dash: [6, 4], label: 'hypoxia threshold' });
  satPlot.line('cs', TT, Cs, { color: 'water', width: 2.6, label: 'C* (Benson & Krause)' });
  satPlot.line('css', TT, TT.map(T => d.kla20 > 0 ? Mdl.steadyDO(T, d, true) : NaN), { color: 'accent', width: 2.4, label: 'steady DO with this pump' });
  satPlot.line('coff', TT, TT.map(T => Mdl.steadyDO(T, d, false)), { color: 'magenta', width: 2, dash: [6, 4], label: 'steady DO, pump off' });
  ourPlot.line('dem', TT, TT.map(T => Mdl.ourAt(T, d)), { color: 'magenta', width: 2.6, label: 'root demand OUR (Q₁₀ = 2)' });
  ourPlot.line('sup', TT, TT.map(T => Mdl.klaAt(T, d, true) * Math.max(0, Mdl.cStar(T, d) - Mdl.P.cCrit)), { color: 'accent', width: 2.4, label: 'max. supply holding DO at 4 mg L⁻¹' });
  let cross = null; for (let i = 1; i < TT.length; i++) { const a = Mdl.klaAt(TT[i - 1], d, true) * (Mdl.cStar(TT[i - 1], d) - 4) - Mdl.ourAt(TT[i - 1], d), b = Mdl.klaAt(TT[i], d, true) * (Mdl.cStar(TT[i], d) - 4) - Mdl.ourAt(TT[i], d); if (a >= 0 && b < 0) { cross = TT[i - 1] + (TT[i] - TT[i - 1]) * a / (a - b); break; } }
  if (cross != null) ourPlot.vline('cross', cross, { color: 'danger', label: `supply < demand above ${fmt(cross, 1)} °C` }); else ourPlot.remove('cross');
}
function liveCharts() {
  const t0 = 6, tNow = st.t - t0; const tMax = Math.max(48, Math.ceil(tNow / 12) * 12);
  doPlot.setAxis('x', { min: Math.max(0, tMax - 72), max: tMax });
  doPlot.hregion('hyp', 0, Mdl.P.cCrit, { color: 'danger', alpha: 0.07, label: 'hypoxia risk' });
  if (s.cut) doPlot.region('cut', s.cutStart - t0, s.cutStart - t0 + s.cutDur, { color: 'amber', alpha: 0.16, label: 'power cut' }); else doPlot.remove('cut');
  doPlot.line('cs', hist.t, hist.Cs, { color: 'water', width: 1.6, dash: [5, 4], label: 'saturation C*' });
  doPlot.line('do', hist.t, hist.C, { color: 'accent', width: 2.6, label: 'DO in the tank' });
  doPlot.line('T', hist.t, hist.T, { color: 'amber', width: 1.8, label: 'solution T (right axis)', y2: true });
  doPlot.vline('now', tNow, { color: 'ink', dash: [2, 3] });
  satPlot.point('now', st.T, st.C, { color: 'ink', r: 5, label: 'now' });
  ourPlot.point('now', st.T, st.R, { color: 'magenta', r: 5 });
  ourPlot.vline('T', st.T, { color: 'ink', dash: [2, 3] });
}

/* ================================================================ sim clock */
let lastUI = 0;
const clock = new SimClock({
  speed: +ui.get('speed'), maxDt: 60,
  onStep: dt => { Mdl.step(st, s, d, dt); record(); },
  onFrame: () => { const now = performance.now(); if (now - lastUI > 250) { lastUI = now; refresh(); } }
});
clock.onState(run => {
  btnPlay.innerHTML = run ? '❚❚ Pause' : '▶ Run';
  if (toolRun) toolRun.innerHTML = run ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
});
let lastRec = -1;
function record() {
  const tr = Math.floor((st.t - 6) * 6); // every 10 simulated minutes
  if (tr !== lastRec) { lastRec = tr; hist.t.push(st.t - 6); hist.C.push(st.C); hist.Cs.push(st.Cs ?? Mdl.cStar(st.T, d)); hist.T.push(st.T); if (hist.t.length > 72 * 6 + 12) { hist.t.shift(); hist.C.shift(); hist.Cs.shift(); hist.T.shift(); } }
}
function resetSim() {
  st = Mdl.initState(s, 6); hist.t.length = hist.C.length = hist.Cs.length = hist.T.length = 0; lastRec = -1;
  Mdl.step(st, s, d, 1); record(); refresh(true);
}

/* ================================================================ readouts, HUD, meter */
function clockStr(t) { const day = Math.floor(t / 24) + 1, h = Math.floor(t % 24), m = Math.floor((t % 1) * 60); return `day ${day} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
function drawMeter() {
  const c = meterCtx, w = 256, h = 192; if (!c) return;
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#16261f'); g.addColorStop(1, '#0c1612'); c.fillStyle = g; c.fillRect(0, 0, w, h);
  const bad = st.C < Mdl.P.cCrit; c.fillStyle = bad ? '#ff8a73' : '#8ef0b4';
  c.font = '600 22px monospace'; c.fillText('DO', 14, 34); c.font = '700 62px monospace'; c.fillText(st.C.toFixed(2), 14, 100);
  c.font = '500 22px monospace'; c.fillStyle = '#b9d4c6'; c.fillText('mg/L', 186, 100); c.fillText(`${(100 * st.C / Mdl.cStar(st.T, d)).toFixed(0)} %sat`, 14, 140); c.fillText(`${st.T.toFixed(1)} °C`, 150, 140);
  c.fillStyle = '#6d8a7c'; c.font = '500 16px monospace'; c.fillText(clockStr(st.t), 14, 176);
  meterTex.needsUpdate = true;
}
function refresh(force) {
  const Cs = Mdl.cStar(st.T, d), sat = st.C / Cs;
  ro.set('do', st.C, st.C >= 6 ? 'ok' : st.C >= Mdl.P.cCrit ? 'warn' : 'bad', `${fmt(sat * 100, 0)} % of saturation`);
  ro.set('cs', Cs);
  ro.set('tw', st.T, st.T <= 24 && st.T >= 18 ? 'ok' : st.T <= 26 && st.T >= 15 ? 'warn' : 'bad', 'target 20–24 °C');
  const k = Mdl.klaAt(st.T, d, st.pumpOn); ro.set('kla', k, null, `u<sub>G</sub> = ${fmt(d.uG * 1000, 3)} mm s⁻¹ · ${fmt(d.qSpec, 2)} L air L⁻¹ h⁻¹`);
  ro.set('our', Mdl.ourAt(st.T, d, st.C), null, `${d.g.n} plants × ${fmt(d.m, 2)} g roots`);
  const css = d.kla20 > 0 ? Mdl.steadyDO(st.T, d, true) : Mdl.steadyDO(st.T, d, false);
  ro.set('css', css, css >= 6 ? 'ok' : css >= Mdl.P.cCrit ? 'warn' : 'bad');
  const tc = Mdl.hoursToCritical(st.C, st.T, d); ro.set('tcrit', tc, tc == null ? 'ok' : tc < 4 ? 'bad' : tc < 10 ? 'warn' : 'ok');
  const healthy = (1 - st.D) * 100; ro.set('roots', healthy, healthy > 90 ? 'ok' : healthy > 60 ? 'warn' : 'bad', st.D > 0.1 ? 'hypoxic injury: roots turning brown' : 'white, turgid roots');
  const pi = Mdl.pythiumIndex(st.T, st.C, st.D); ro.set('pyth', pi, pi < 25 ? 'ok' : pi < 55 ? 'warn' : 'bad', pi < 25 ? 'low' : pi < 55 ? 'moderate' : 'high');
  ro.set('pump', d.pumpW, null, `${fmt(d.pumpW * 8.76, 0)} kWh yr⁻¹ if run all year`);
  const hrs = Math.max(1e-6, st.t - 6); const kwhd = (st.eAir + st.eChill) / 1000 / hrs * 24;
  ro.set('energy', hrs > 0.5 ? kwhd : (d.pumpW * 24) / 1000, null, s.chill ? `chiller ${fmt(st.eChill / 1000 / hrs * 24, 2)} kWh d⁻¹ (average so far)` : 'air pump only');
  ro.set('cost', (hrs > 0.5 ? kwhd : d.pumpW * 24 / 1000) * 365 * s.price);
  hud.set('t', `${clockStr(st.t)} · lights <b>${st.lit ? 'on' : 'off'}</b>${st.cut ? ' · <b style="color:#ff9b87">power cut</b>' : ''}`);
  hud.set('do', `DO <b>${fmt(st.C, 2)}</b> mg L⁻¹ · T <b>${fmt(st.T, 1)}</b> °C · air <b>${fmt(st.Tair, 1)}</b> °C`);
  hud.set('k', `k<sub>L</sub>a <b>${fmt(k, 2)}</b> h⁻¹ · OUR <b>${fmt(st.R, 2)}</b> mg L⁻¹ h⁻¹`);
  drawMeter();
  if (labelObjs.pump) {
    const show = s.labels; labelObjs.forEach(l => l.visible = show);
    labelObjs.pump.element.innerHTML = `Air pump<small>${st.pumpOn ? fmt(s.qAir, 1) + ' L min⁻¹ · ' + fmt(d.pumpW, 1) + ' W' : 'off'}</small>`;
    labelObjs.probe.element.innerHTML = `DO meter<small>${fmt(st.C, 2)} mg L⁻¹ · ${fmt(st.T, 1)} °C</small>`;
    labelObjs.roots.element.innerHTML = `Root zone (cut-away)<small>${fmt(healthy, 0)} % healthy · OUR ${fmt(st.R, 2)} mg L⁻¹ h⁻¹</small>`;
    labelObjs.stone.element.innerHTML = `Air stone${s.stones > 1 ? 's' : ''}<small>k<sub>L</sub>a ${fmt(k, 2)} h⁻¹</small>`;
  }
  liveCharts();
}

/* ================================================================ frame animation */
const cRoot = new THREE.Color(); let accUI = 0, tAnim = 0;
stage.onFrame((dt, t) => {
  tAnim = t;
  const on = st.pumpOn;
  if (bubbles) { bubbles.setRate(on ? 28 * s.qAir / s.stones : 0); bubbles.update(dt); }
  flows.forEach(o => { o.f.points.visible = on; o.f.speed = (o.reverse ? -1 : 1) * (0.04 + 0.05 * s.qAir * o.share); if (on) o.f.update(dt); });
  if (pump) { const b = pump.userData.base; pump.position.set(b.x + (on ? Math.sin(t * 157) * 0.0007 : 0), b.y, b.z + (on ? Math.cos(t * 143) * 0.0005 : 0)); pumpLED.material.emissive.set(on ? 0x2cff6a : 0x331010); pumpLED.material.emissiveIntensity = on ? 3 : 0.3; }
  waterSurfN.offset.set(t * (0.01 + 0.004 * s.qAir), t * (0.007 + 0.003 * s.qAir));
  surfMat.normalScale.set(0.25 + 0.05 * s.qAir, 0.25 + 0.05 * s.qAir);
  if (chillFan) chillFan.rotation.z += dt * (st.Qc > 1 ? 18 : 0);
  // roots: white → brown with hypoxic injury
  cRoot.copy(HEALTHY).lerp(BROWN, Math.min(1, st.D * 1.1)); rootMat.color.copy(cRoot); rootMat.sheen = 0.4 * (1 - st.D);
  // DO colour wash
  if (s.doMap) { const c = colormap('rdylgn', Math.min(1, st.C / 9)); waterSideMat.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255); waterSideMat.opacity = 0.28; waterFrontMat.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255); legend.style.display = ''; }
  else { waterSideMat.color.set(0x2f7f92); waterSideMat.opacity = 0.16; waterFrontMat.color.set(0x9fd6de); legend.style.display = 'none'; }
  // day / night
  const lit = st.lit ? 1 : 0; if (led) led.setIntensity(lit ? 1 : 0.02);
  lights.key.intensity = 2.4 * 0.9 * (0.35 + 0.65 * lit); lights.hemi.intensity = 0.9 * 0.9 * (0.3 + 0.7 * lit); lights.fill.intensity = 0.6 * 0.9 * (0.4 + 0.6 * lit);
  accUI += dt; if (accUI > 0.25 && !clock.running) { accUI = 0; drawMeter(); }
});
legend.innerHTML = `DO colour (mg L⁻¹)<div class="cbar" style="background:linear-gradient(to right,#a50026,#f46d43,#fee08b,#d9ef8b,#66bd63,#006837)"></div><div class="cbar-ticks"><span>0</span><span>4.5</span><span>9</span></div>`;

/* picking: click a component for an explanation */
stage.onPick({
  objects: () => [pump, meter, probe, ...stonesMeshes, ...rootMeshes, ...lettuceMeshes, raft].filter(Boolean),
  onClick: hit => {
    if (!hit || !window.FFP || !FFP.toast) return;
    let o = hit.object; const inGroup = g => { let p = o; while (p) { if (p === g) return true; p = p.parent; } return false; };
    if (inGroup(pump)) FFP.toast(`Air pump: ${fmt(s.qAir, 1)} L min⁻¹ → ${fmt(d.pumpW, 1)} W electrical (${fmt(d.pumpW * 8.76, 0)} kWh per year). Keep it above the water line or fit a check valve.`);
    else if (inGroup(meter) || inGroup(probe)) FFP.toast(`Optical DO probe: ${fmt(st.C, 2)} mg L⁻¹ = ${fmt(100 * st.C / Mdl.cStar(st.T, d), 0)} % of saturation at ${fmt(st.T, 1)} °C.`);
    else if (stonesMeshes.includes(o)) FFP.toast(`Air stone: superficial gas velocity ${fmt(d.uG * 1000, 3)} mm s⁻¹ gives k_La ≈ ${fmt(d.kla20, 2)} h⁻¹ at 20 °C (Heijnen & Van 't Riet 1984).`);
    else if (rootMeshes.includes(o)) FFP.toast(`Roots: ${fmt(d.m, 2)} g dry mass per plant respiring ${fmt(Mdl.ourAt(st.T, d, st.C) * s.V / d.g.n, 1)} mg O₂ h⁻¹ each. Healthy fraction ${fmt((1 - st.D) * 100, 0)} %.`);
    else if (lettuceMeshes.includes(o)) FFP.toast(`${d.g.n} lettuces, ${s.age} days after transplanting, at ${fmt(d.g.n / (d.g.w * d.g.d), 0)} plants m⁻².`);
    else FFP.toast('Floating polystyrene raft: it shades the solution (no algae) and insulates the surface — but it also blocks surface re-aeration.');
  }
});

/* ================================================================ wiring */
function onParams(changed) {
  const old = s; s = ui.values(); s.speed = +s.speed;
  const structural = ['V', 'H', 'age', 'qO2', 'qAir'].some(k => old[k] !== s[k]);
  d = Mdl.derived(s);
  clock.speed = s.speed;
  rebuild(); staticCharts();
  if (pendingReset || (structural && !clock.running && hist.t.length < 3)) { pendingReset = false; resetSim(); }
  refresh(true);
}
let raf = 0; ui.onChange(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => onParams()); });
s.speed = +s.speed; rebuild(); staticCharts(); resetSim();
stage.onKey('space', () => clock.toggle());
