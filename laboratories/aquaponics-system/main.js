/* ==========================================================================
   Aquaponics system simulator — 3D scene, controls, readouts and charts.
   The dynamic model (fish, solids, nitrifying biofilm, lettuce, oxygen,
   carbonate chemistry) lives in ./model.js; see the Derive tab (Eqs. A1–A12).
   The 3D scene is driven by the model: fish number, activity and position
   follow biomass, dissolved oxygen and un-ionised ammonia; the colour of the
   moving-bed carriers follows nitrifier biomass; the sludge cone fills with
   captured solids; lettuce heads grow cohort by cohort; water turbidity follows
   suspended solids; bubbles and flow particles follow aeration and pumping.
   ========================================================================== */
import {
  createStage, addSky, fitShadow, THREE, M, makeGreenhouse, makeGround, FishSchool, Bubbles, FlowAlong,
  makePipe, makeRaft, leafGeometry, leafMaterial, makeLEDBar, makeProbe, BufferGeometryUtils,
  canvasTexture, surfaceMaterial, rng, fbm2
} from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, Sankey, downloadCSV } from '/assets/js/plot.js';
import { AquaponicsModel, BASES, PAR, tauT, sigmaDO, upsilonUIA, carbConst, solvePH } from './model.js';

/* ------------------------------------------------------------------ layout (metres) */
const RAFT = { w: 1.2, d: 0.6, nx: 6, nz: 3, area: 0.72 };
const TANK = { x: -3.0, z: 2.55, L: 2.0, W: 1.0, H: 1.0, base: 0.12, depth: 0.9, wall: 0.035 };
const SEP = { x: -1.2, z: 2.75, r: 0.3, cylH: 0.5, coneH: 0.34, y0: 0.28 };
const BF = { x: 0.12, z: 2.75, r: 0.42, h: 1.02, y0: 0.08 };
const BEDS = { xs: [1.55, 3.05], z0: 2.3, w: 1.2, floor: 0.18, wallH: 0.42, water: 0.53 };
const WATER_Y = { tank: TANK.base + TANK.depth, sep: SEP.y0 + SEP.coneH + SEP.cylH - 0.06, bf: BF.y0 + BF.h - 0.08, bed: BEDS.water };
const FISH_SCALE = 4; // one rendered fish represents this many fish

/* ------------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'fish', label: 'Fish stock', unit: 'kg', digits: 1 })
  .add({ id: 'feed', label: 'Feed offered', unit: '', format: v => v })
  .add({ id: 'tan', label: 'Total ammonia-N (TAN)', unit: 'mg L⁻¹', digits: 2 })
  .add({ id: 'nh3', label: 'Un-ionised NH₃-N', unit: 'mg L⁻¹', digits: 3 })
  .add({ id: 'no2', label: 'Nitrite-N', unit: 'mg L⁻¹', digits: 2 })
  .add({ id: 'no3', label: 'Nitrate-N', unit: 'mg L⁻¹', digits: 0 })
  .add({ id: 'do', label: 'Dissolved oxygen', unit: 'mg L⁻¹', digits: 1 })
  .add({ id: 'ph', label: 'pH · alkalinity', unit: '', format: v => v })
  .add({ id: 'co2', label: 'Free CO₂', unit: 'mg L⁻¹', digits: 1 })
  .add({ id: 'tss', label: 'Suspended solids', unit: 'mg L⁻¹', digits: 0 })
  .add({ id: 'bio', label: 'Biofilter TAN removal', unit: 'g N d⁻¹', digits: 1 })
  .add({ id: 'lettuce', label: 'Lettuce growth', unit: 'kg d⁻¹', digits: 2 })
  .add({ id: 'fcr', label: 'Feed conversion ratio', unit: '', digits: 2 })
  .add({ id: 'nue', label: 'Nitrogen use efficiency', unit: '%', digits: 0 })
  .add({ id: 'base', label: 'Base dosing', unit: '', format: v => v });

ui.section('Simulation');
const [playBtn] = ui.buttons([
  { label: '▶ Run', variant: 'primary', onClick: () => clock.toggle() },
  { label: 'Step 1 day', onClick: () => { clock.pause(); advance(1); refreshAll(true); } },
  { label: 'Restart', onClick: () => restart() }
]);
ui.segmented({ id: 'speed', label: 'Simulation speed', options: [{ value: 0.0417, label: '1 h/s' }, { value: 0.25, label: '6 h/s' }, { value: 1, label: '1 d/s' }, { value: 4, label: '4 d/s' }], value: 1, help: 'Simulated time per real second. Use 1 h/s to watch an oxygen crash or a feeding day.' });
ui.section('Fish & feeding');
ui.slider({ id: 'SD', label: 'Stocking density', min: 5, max: 60, step: 1, value: 25, unit: 'kg m⁻³', help: 'Nile tilapia in the 1.8 m³ glass-fronted tank. FAO advises ≤ 20 kg m⁻³ for small units; intensive RAS run 40–60.' });
ui.slider({ id: 'FR', label: 'Feeding rate', min: 0.3, max: 4.5, step: 0.1, value: 1.6, unit: '% BW d⁻¹', help: '250 g tilapia eat to satiation at ≈ 2.5 % of body weight per day at 26 °C; any surplus is wasted.' });
ui.slider({ id: 'PC', label: 'Crude protein in feed', min: 25, max: 50, step: 1, value: 32, unit: '%', help: 'Tilapia grow-out feeds 28–32 %; trout 42 %. Feed nitrogen = protein ÷ 6.25.' });
ui.slider({ id: 'T', label: 'Water temperature', min: 16, max: 34, step: 0.5, value: 26, unit: '°C', help: 'Tilapia: optimum 29–31 °C, stop feeding below ≈ 17 °C. Lettuce roots prefer ≤ 25 °C.' });
ui.toggle({ id: 'stagger', label: 'Staggered harvest (constant biomass)', value: true, help: 'On: growth is harvested continuously, as on multi-cohort farms. Off: a single batch keeps growing.' });
ui.section('Water treatment');
ui.slider({ id: 'eta', label: 'Solids capture in swirl separator', min: 0, max: 90, step: 5, value: 50, unit: '%', help: 'UVI clarifiers remove ≈ 50 % of particulate solids; microscreen drum filters more.' });
ui.slider({ id: 'Vmed', label: 'Moving-bed media volume', min: 0, max: 0.4, step: 0.01, value: 0.2, unit: 'm³', help: 'K1-type carriers with ≈ 500 m² of protected surface per m³.' });
ui.slider({ id: 'kLa', label: 'Aeration (k<sub>L</sub>a)', min: 0, max: 8, step: 0.1, value: 3, unit: 'h⁻¹', help: 'Oxygen transfer coefficient set by blower air flow and diffusers. 0 = blower failure.' });
ui.slider({ id: 'xex', label: 'Water exchange', min: 0, max: 10, step: 0.1, value: 1.5, unit: '% d⁻¹', help: 'Share of the system volume replaced by fresh water each day.' });
ui.section('Plants & pH');
ui.slider({ id: 'Ap', label: 'Raft (plant) area', min: 2.88, max: 20.16, step: 1.44, value: 10.08, unit: 'm²', digits: 1, help: 'Two raft beds of 1.2 × 0.6 m boards with 18 lettuce each (25 m⁻²).' });
ui.segmented({ id: 'base', label: 'Base addition', options: [{ value: 'off', label: 'Off' }, { value: 'KOH', label: 'KOH' }, { value: 'CaOH2', label: 'Ca(OH)₂' }, { value: 'NaHCO3', label: 'NaHCO₃' }], value: 'KOH', help: 'A dosing pump adds base whenever pH falls below the set-point.' });
ui.slider({ id: 'pHset', label: 'pH set-point', min: 6.2, max: 8.0, step: 0.1, value: 7.2, unit: '' });
ui.section('View');
ui.toggle({ id: 'labels', label: 'Component labels', value: true });
ui.toggle({ id: 'cut', label: 'Cut-away raft bed (roots)', value: false });
ui.buttons([
  { label: 'Overview', onClick: () => fly('home') }, { label: 'Fish', onClick: () => fly('tank') }, { label: 'Filters', onClick: () => fly('filters') }, { label: 'Rafts', onClick: () => fly('beds') }, { label: 'Sump', onClick: () => fly('sump') }
]);
const PRESETS = [
  { label: 'Balanced (mature)', title: 'A mature system at a UVI-type feed-rate ratio', values: { SD: 25, FR: 1.6, PC: 32, T: 26, eta: 50, Vmed: 0.2, kLa: 3, xex: 1.5, Ap: 10.08, base: 'KOH', pHset: 7.2, stagger: true, speed: 1 }, onApply: () => restart('mature') },
  { label: 'Start-up (new system)', title: 'A new biofilter: the ammonia peak comes first, the nitrite peak second', values: { SD: 5, FR: 1.0, PC: 32, T: 26, eta: 50, Vmed: 0.2, kLa: 3, xex: 1.5, Ap: 10.08, base: 'KOH', pHset: 7.2, stagger: true, speed: 1 }, onApply: () => restart('new') },
  { label: 'Overfed', title: 'Ration above satiation: uneaten feed, solids, oxygen demand', values: { SD: 25, FR: 4.0, PC: 32, T: 26, eta: 50, Vmed: 0.2, kLa: 3, xex: 1.5, Ap: 10.08, base: 'KOH', pHset: 7.2, stagger: true, speed: 1 }, onApply: () => restart('mature', { FR: 1.6 }) },
  { label: 'Aeration failure', title: 'The blower stops in a mature system — watch hours, not days', values: { SD: 25, FR: 1.6, PC: 32, T: 26, eta: 50, Vmed: 0.2, kLa: 0, xex: 1.5, Ap: 10.08, base: 'KOH', pHset: 7.2, stagger: true, speed: 0.0417 }, onApply: () => restart('mature', { kLa: 3 }) },
  { label: 'No pH control', title: 'Base dosing switched off: nitrification acidifies the water', values: { SD: 25, FR: 1.6, PC: 32, T: 26, eta: 50, Vmed: 0.2, kLa: 3, xex: 1.5, Ap: 10.08, base: 'off', pHset: 7.2, stagger: true, speed: 1 }, onApply: () => restart('mature', { base: 'KOH' }) }
];
let applyingPreset = false;
PRESETS.forEach(p => { const f = p.onApply; p.onApply = () => { f(); applyingPreset = false; }; });
ui.presets(PRESETS.map(p => Object.assign({}, p, { values: p.values })));
document.querySelectorAll('#controls .presets button').forEach(b => b.addEventListener('pointerdown', () => { applyingPreset = true; }, true));
ui.saveButton('aquaponics-system', () => Object.assign({ day: +model.t.toFixed(2) }, ro.values()));
ui.button({ label: 'Download time series (CSV)', onClick: () => downloadHistory() });

const MODEL_KEYS = ['SD', 'FR', 'PC', 'T', 'eta', 'Vmed', 'kLa', 'xex', 'Ap', 'base', 'pHset', 'stagger'];
const pickCtrl = v => { const o = {}; MODEL_KEYS.forEach(k => o[k] = v[k]); return o; };

/* ------------------------------------------------------------------ model */
const model = new AquaponicsModel(pickCtrl(ui.values()));

/* ------------------------------------------------------------------ stage & environment */
const HOME = { pos: [0.9, 2.9, 7.7], target: [-0.9, 0.6, 0.9] };
const stage = createStage('#stage', {
  background: null, exposure: 0.95, envIntensity: 0.55,
  camera: { pos: HOME.pos, target: HOME.target, fov: 42 },
  controls: { minDistance: 0.6, maxDistance: 14, maxPolarAngle: Math.PI * 0.49 },
  bloom: { strength: 0.3, radius: 0.4, threshold: 1.0 }, ao: { radius: 0.25, intensity: 0.85 }
});
const { scene } = stage;
const sky = addSky(stage, { elevation: 38, azimuth: 215, sunIntensity: 2.6, shadowSize: 10 });
fitShadow(sky.sun, 9.5, [0, 0, -1]);
scene.add(makeGround({ size: 100, type: 'grass' }));
// a wide-span greenhouse (3 × 9.6 m): its posts stand at x = ±4.8 m, clear of the system
const floor = new THREE.Mesh(new THREE.PlaneGeometry(28.8, 24), surfaceMaterial('concrete', [14, 12]));
floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.004, -3.8); floor.receiveShadow = true; scene.add(floor);
const gh = makeGreenhouse({ spans: 3, spanWidth: 9.6, length: 24, gutterHeight: 3.6, roofAngle: 22, bays: 4, heatingPipes: false, glassOpacity: 0.05 });
gh.position.set(0, 0, -3.8); scene.add(gh);
const hud = hudChips(stage.el);
const inspector = document.createElement('div'); inspector.className = 'stage-legend'; inspector.style.maxWidth = '330px'; inspector.style.display = 'none'; inspector.style.lineHeight = '1.5'; stage.el.appendChild(inspector);

/* ------------------------------------------------------------------ materials & helpers */
const matGRP = new THREE.MeshStandardMaterial({ color: 0x22404f, roughness: 0.5, metalness: 0.05 });
const matGRPin = new THREE.MeshStandardMaterial({ color: 0x264a58, roughness: 0.65, side: THREE.BackSide });
const matPipe = new THREE.MeshPhysicalMaterial({ color: 0x8b969e, roughness: 0.35, clearcoat: 0.4, clearcoatRoughness: 0.3 });
const matPipeW = M.pvc();
const matClear = new THREE.MeshPhysicalMaterial({ color: 0xe6eef0, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.38, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide });
const matSteel = M.galvanised();
const matBlack = M.plasticBlack();
const matBlock = surfaceMaterial('concrete', [0.6, 0.6]);
const woodTex = canvasTexture(512, 128, (ctx, w, h) => {
  const r = rng(5); ctx.fillStyle = '#8a6a44'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) { const y = r() * h; ctx.strokeStyle = `rgba(${60 + r() * 40},${40 + r() * 30},${20 + r() * 20},${0.12 + r() * 0.2})`; ctx.lineWidth = 0.6 + r() * 1.8; ctx.beginPath(); ctx.moveTo(0, y); for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 2 + (r() - 0.5) * 1.5); ctx.stroke(); }
  for (let k = 0; k < 5; k++) { ctx.fillStyle = 'rgba(40,25,10,0.35)'; ctx.fillRect(0, (k + 1) * h / 5 - 1, w, 2); }
}, { repeat: [2, 1], key: 'aq-wood' });
const matWood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.85 });
const matLiner = new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.7, side: THREE.BackSide });
const waterNormal = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const img = x.createImageData(128, 128);
  const hgt = (u, v) => fbm2(u / 20, v / 20, 4);
  for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) { const dx = hgt(i + 1, j) - hgt(i - 1, j), dy = hgt(i, j + 1) - hgt(i, j - 1); const nx = -dx * 3, ny = -dy * 3, L = Math.hypot(nx, ny, 1); const k = (j * 128 + i) * 4; img.data[k] = (nx / L * 0.5 + 0.5) * 255; img.data[k + 1] = (ny / L * 0.5 + 0.5) * 255; img.data[k + 2] = (1 / L * 0.5 + 0.5) * 255; img.data[k + 3] = 255; }
  x.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
})();
const animatedNormals = [];
const surfMat = (tint, opacity = 0.55, sx = 0.03, sy = 0.02, rep = 3) => { const n = waterNormal.clone(); n.needsUpdate = true; n.repeat.set(rep, rep); animatedNormals.push({ tex: n, sx, sy }); return new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.04, transparent: true, opacity, normalMap: n, normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false }); };
const pickables = [];
const labelObjs = [];
const tag = (obj, comp) => { obj.traverse(o => { o.userData.comp = comp; }); pickables.push(obj); };
function box(w, h, d, mat, x, y, z, parent) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }
function cyl(rt, rb, h, mat, x, y, z, parent, seg = 32, open = false) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }
function label(obj, html, offset) { const l = stage.addLabel(obj, html, { offset }); labelObjs.push(l); l.visible = ui.get('labels'); return l; }

/* ================================================================== fish tank */
const tankG = new THREE.Group(); tankG.position.set(TANK.x, 0, TANK.z); scene.add(tankG);
let tankWater, tankSurface, tankCaustics, hopperFill;
(function buildTank() {
  const { L, W, H, base, depth, wall: t } = TANK;
  box(L + 0.06, base, W + 0.06, M.paintedSteel(0x2e3339), 0, base / 2, 0, tankG);
  box(L, t, W, matGRP, 0, base + t / 2, 0, tankG);
  box(L, H, t, matGRP, 0, base + H / 2, -W / 2 + t / 2, tankG);
  box(t, H, W, matGRP, -L / 2 + t / 2, base + H / 2, 0, tankG);
  box(t, H, W, matGRP, L / 2 - t / 2, base + H / 2, 0, tankG);
  const inner = new THREE.Mesh(new THREE.BoxGeometry(L - 2 * t, H - t, W - 2 * t), matGRPin);
  inner.position.y = base + t + (H - t) / 2; inner.geometry.groups = inner.geometry.groups.filter((g, i) => i !== 2 && i !== 4); tankG.add(inner);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(L - 2 * t, H - 0.01, 0.014), new THREE.MeshPhysicalMaterial({ color: 0xe9f3f5, roughness: 0.04, transparent: true, opacity: 0.05, envMapIntensity: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.05, depthWrite: false, side: THREE.DoubleSide })); glass.position.set(0, base + H / 2, W / 2 - 0.007); tankG.add(glass);
  [[L, 0.03, 0.04, 0, base + H - 0.015, W / 2 - 0.01], [L, 0.05, 0.04, 0, base + 0.025, W / 2 - 0.01], [0.04, H, 0.045, -L / 2 + 0.02, base + H / 2, W / 2 - 0.01], [0.04, H, 0.045, L / 2 - 0.02, base + H / 2, W / 2 - 0.01]].forEach(a => box(a[0], a[1], a[2], matBlack, a[3], a[4], a[5], tankG));
  // caustics on the tank floor
  const cau = canvasTexture(256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = i / w * 6, v = j / h * 6;
      const n = Math.abs(fbm2(u, v, 3)) + Math.abs(fbm2(u + 3.7, v + 1.3, 3)) * 0.6; const c = Math.pow(Math.max(0, 1 - n * 2.4), 3);
      const k = (j * w + i) * 4; img.data[k] = 150 * c; img.data[k + 1] = 225 * c; img.data[k + 2] = 255 * c; img.data[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat: [2, 1], key: 'aq-caustic' });
  tankCaustics = new THREE.Mesh(new THREE.PlaneGeometry(L - 2 * t - 0.01, W - 2 * t - 0.01), new THREE.MeshBasicMaterial({ map: cau, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  tankCaustics.rotation.x = -Math.PI / 2; tankCaustics.position.y = base + t + 0.003; tankG.add(tankCaustics);
  tankWater = new THREE.Mesh(new THREE.BoxGeometry(L - 2 * t - 0.004, depth - t, W - 2 * t - 0.004), new THREE.MeshStandardMaterial({ color: 0x125761, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.4, envMapIntensity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  tankWater.position.y = base + t + (depth - t) / 2; tankG.add(tankWater);
  tankSurface = new THREE.Mesh(new THREE.PlaneGeometry(L - 2 * t - 0.004, W - 2 * t - 0.004), surfMat(0x3f8fa0, 0.5, 0.03, 0.018)); tankSurface.rotation.x = -Math.PI / 2; tankSurface.position.y = base + depth; tankG.add(tankSurface);
  // centre drain + stand pipe, air stones, inlet spray bar
  cyl(0.045, 0.045, 0.012, matBlack, 0.35, base + t + 0.006, 0, tankG, 24);
  cyl(0.02, 0.02, depth - 0.04, matPipeW, 0.35, base + t + (depth - 0.04) / 2, 0, tankG, 16);
  [-0.55, 0.0].forEach(x => cyl(0.035, 0.035, 0.03, new THREE.MeshStandardMaterial({ color: 0x9aa39c, roughness: 0.95 }), x, base + t + 0.015, -0.1, tankG, 20));
  tankG.add(makePipe([[-L / 2 + 0.2, base + depth + 0.12, -W / 2 + 0.12], [0.2, base + depth + 0.12, -W / 2 + 0.12]], { radius: 0.02, material: matPipe, tension: 0 }));
  // automatic feeder on a bracket
  const feeder = new THREE.Group(); feeder.position.set(-0.45, base + H + 0.02, 0.15); tankG.add(feeder);
  box(0.5, 0.02, 0.06, matSteel, 0, 0.0, 0, feeder);
  cyl(0.11, 0.11, 0.22, new THREE.MeshPhysicalMaterial({ color: 0xdfe6e3, roughness: 0.3, transparent: true, opacity: 0.6 }), 0, 0.2, 0, feeder, 32);
  cyl(0.11, 0.03, 0.1, M.plastic(0xd8ddd9, 0.4), 0, 0.04, 0, feeder, 32);
  cyl(0.115, 0.115, 0.03, M.plastic(0x2f6f5a, 0.4), 0, 0.325, 0, feeder, 32);
  const motor = cyl(0.04, 0.04, 0.07, M.plasticBlack(), 0.13, 0.05, 0, feeder, 16); motor.rotation.z = Math.PI / 2;
  hopperFill = cyl(0.1, 0.1, 0.12, new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 }), 0, 0.15, 0, feeder, 24);
  const probe = makeProbe({ cap: 0x2f6fd6, tip: 'steel' }); probe.position.set(L / 2 - 0.25, base + depth - 0.12, -0.25); tankG.add(probe);
  tag(tankG, 'tank');
})();
const bubblesTank = new Bubbles({ emitters: [[-0.55, TANK.base + 0.06, -0.1], [0.0, TANK.base + 0.06, -0.1]], top: TANK.base + TANK.depth - 0.01, rate: 60, size: 0.005, spread: 0.05, speed: 0.35, max: 700 });
tankG.add(bubblesTank.mesh);
const tankLabel = label(tankG, 'Fish tank', [-0.35, TANK.base + TANK.H + 0.72, 0]);

/* ---------- fish school, feed pellets, dead fish */
let school = null, schoolKey = null, lastDeaths = 0;
const deadFish = [];
const tankBounds = () => new THREE.Box3(new THREE.Vector3(-TANK.L / 2 + 0.14, TANK.base + 0.1, -TANK.W / 2 + 0.12), new THREE.Vector3(TANK.L / 2 - 0.14, TANK.base + TANK.depth - 0.07, TANK.W / 2 - 0.1));
function rebuildSchool(nVis, W) {
  if (school) school.fish.forEach(f => { tankG.remove(f); f.traverse(o => { if (o.geometry) o.geometry.dispose(); }); });
  const len = 0.245 * Math.cbrt(Math.max(20, W) / 250);
  school = new FishSchool(tankG, { count: Math.max(1, nVis), bounds: tankBounds(), length: len, speed: 0.2, color: 0x56625c, seed: 7 });
  school.fish.forEach(f => f.traverse(o => { o.userData.comp = 'tank'; }));
  school.baseBounds = tankBounds();
}
const PELLET_MAX = 260;
const pellets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0045, 8, 6), new THREE.MeshStandardMaterial({ color: 0x5b3b1f, roughness: 0.85 }), PELLET_MAX);
pellets.count = 0; pellets.frustumCulled = false; tankG.add(pellets);
const pelletState = []; let bottomPellets = 0;

/* ================================================================== swirl separator */
const sepG = new THREE.Group(); sepG.position.set(SEP.x, 0, SEP.z); scene.add(sepG);
let sludgeMesh, swirl;
(function buildSeparator() {
  const { r, cylH, coneH, y0 } = SEP;
  const pe = new THREE.MeshPhysicalMaterial({ color: 0xf1f1ea, roughness: 0.42, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, clearcoat: 0.3, clearcoatRoughness: 0.4 });
  cyl(r, r, cylH, pe, 0, y0 + coneH + cylH / 2, 0, sepG, 48, true);
  cyl(r, 0.035, coneH, pe, 0, y0 + coneH / 2, 0, sepG, 48, true);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 10, 48), M.plastic(0xe8e8e2, 0.4)); rim.rotation.x = Math.PI / 2; rim.position.y = y0 + coneH + cylH; sepG.add(rim);
  const wmat = new THREE.MeshPhysicalMaterial({ color: 0x5e8a7c, roughness: 0.2, transparent: true, opacity: 0.3, depthWrite: false });
  cyl(r - 0.006, r - 0.006, WATER_Y.sep - (y0 + coneH), wmat, 0, (WATER_Y.sep + y0 + coneH) / 2, 0, sepG, 40);
  cyl(r - 0.006, 0.03, coneH - 0.004, wmat, 0, y0 + coneH / 2, 0, sepG, 40);
  const s = new THREE.Mesh(new THREE.CircleGeometry(r - 0.006, 40), surfMat(0x5b8f80, 0.55, 0.08, 0.05, 1)); s.rotation.x = -Math.PI / 2; s.position.y = WATER_Y.sep; sepG.add(s);
  sludgeMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.001, 1, 32), new THREE.MeshStandardMaterial({ color: 0x4a3620, roughness: 0.95 })); sepG.add(sludgeMesh);
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; sepG.add(makePipe([[Math.cos(a) * (r + 0.03), 0, Math.sin(a) * (r + 0.03)], [Math.cos(a) * (r + 0.03), y0 + coneH + 0.05, Math.sin(a) * (r + 0.03)]], { radius: 0.014, material: matSteel, tension: 0 })); }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.03, 0.01, 8, 40), matSteel); ring.rotation.x = Math.PI / 2; ring.position.y = y0 + coneH; sepG.add(ring);
  cyl(0.018, 0.018, y0 - 0.02, matPipeW, 0, (y0 - 0.02) / 2 + 0.02, 0, sepG, 12);
  const valve = new THREE.Group(); valve.position.set(0, 0.14, 0); sepG.add(valve);
  valve.add(new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12), M.plastic(0x9aa2a8, 0.4)));
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.012, 0.02), M.plastic(0xd23b2e, 0.45)); handle.position.set(0.04, 0.035, 0); valve.add(handle);
  const n = 360, pos = new Float32Array(n * 3), st = [];
  for (let i = 0; i < n; i++) st.push({ a: Math.random() * 6.28, y: Math.random(), rr: 0.4 + Math.random() * 0.55 });
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x6d5536, size: 0.012, transparent: true, opacity: 0.85, depthWrite: false }));
  pts.frustumCulled = false; sepG.add(pts);
  swirl = { pts, st, pos };
  tag(sepG, 'sep');
})();
const sepLabel = label(sepG, 'Swirl separator', [-0.05, SEP.y0 + SEP.coneH + SEP.cylH + 0.18, 0]);

/* ================================================================== moving-bed biofilter */
const bfG = new THREE.Group(); bfG.position.set(BF.x, 0, BF.z); scene.add(bfG);
let carriers, carrierState, carrierMat;
(function buildBiofilter() {
  const { r, h, y0 } = BF;
  box(0.95, y0, 0.95, M.plastic(0x3d4a52, 0.6), 0, y0 / 2, 0, bfG);
  const pe = new THREE.MeshPhysicalMaterial({ color: 0xdfeef2, roughness: 0.38, transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false, clearcoat: 0.4 });
  cyl(r, r, h, pe, 0, y0 + h / 2, 0, bfG, 56, true);
  cyl(r, r, 0.02, M.plastic(0x2a5a6c, 0.5), 0, y0 + 0.01, 0, bfG, 56);
  [0.25, 0.55, 0.85].forEach(f => { const rib = new THREE.Mesh(new THREE.TorusGeometry(r + 0.004, 0.01, 8, 56), M.plastic(0xcfdde2, 0.4)); rib.rotation.x = Math.PI / 2; rib.position.y = y0 + h * f; bfG.add(rib); });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.015, 10, 56), M.plastic(0x2a5a6c, 0.45)); rim.rotation.x = Math.PI / 2; rim.position.y = y0 + h; bfG.add(rim);
  const wmat = new THREE.MeshPhysicalMaterial({ color: 0x6aa8a8, roughness: 0.15, transparent: true, opacity: 0.2, depthWrite: false });
  cyl(r - 0.006, r - 0.006, WATER_Y.bf - y0 - 0.02, wmat, 0, (WATER_Y.bf + y0 + 0.02) / 2, 0, bfG, 48);
  const s = new THREE.Mesh(new THREE.CircleGeometry(r - 0.006, 48), surfMat(0x7fb7b5, 0.42, 0.12, -0.09, 1)); s.rotation.x = -Math.PI / 2; s.position.y = WATER_Y.bf; bfG.add(s);
  const sieve = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xb5bcc2, metalness: 0.8, roughness: 0.4, side: THREE.DoubleSide })); sieve.rotation.z = Math.PI / 2; sieve.position.set(r - 0.12, WATER_Y.bf - 0.12, 0); bfG.add(sieve);
  // K1-type carriers: ring + inner cross + outer fins (drawn at ≈ 1.8 × real size)
  const parts = [new THREE.CylinderGeometry(0.0055, 0.0055, 0.0072, 12, 1, true), new THREE.BoxGeometry(0.011, 0.0065, 0.0008), new THREE.BoxGeometry(0.0008, 0.0065, 0.011)];
  for (let k = 0; k < 8; k++) { const fin = new THREE.BoxGeometry(0.0012, 0.0066, 0.0014); const a = k * Math.PI / 4; fin.translate(Math.cos(a) * 0.0062, 0, Math.sin(a) * 0.0062); parts.push(fin); }
  const carrierGeo = BufferGeometryUtils.mergeGeometries(parts.map(g => g.toNonIndexed()));
  carrierGeo.scale(1.8, 1.8, 1.8);
  carrierMat = new THREE.MeshStandardMaterial({ color: 0xece8da, roughness: 0.6, side: THREE.DoubleSide });
  const N = 1100;
  carriers = new THREE.InstancedMesh(carrierGeo, carrierMat, N); carriers.frustumCulled = false;
  carrierState = [];
  for (let i = 0; i < N; i++) carrierState.push({ s: Math.random(), a: Math.random() * 6.283, rj: Math.random(), yj: Math.random(), rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6), w: 0.5 + Math.random() });
  bfG.add(carriers);
  tag(bfG, 'bf');
})();
const bubblesBF = new Bubbles({ emitters: [[0, BF.y0 + 0.05, 0], [0.18, BF.y0 + 0.05, 0.1], [-0.18, BF.y0 + 0.05, -0.1], [0.1, BF.y0 + 0.05, -0.2], [-0.12, BF.y0 + 0.05, 0.2]], top: WATER_Y.bf - 0.005, rate: 60, size: 0.006, spread: 0.1, speed: 0.4, max: 900 });
bfG.add(bubblesBF.mesh);
const bfLabel = label(bfG, 'Moving-bed biofilter', [0.1, BF.y0 + BF.h + 0.62, 0]);

/* ================================================================== blower & air lines */
const blowerG = new THREE.Group(); blowerG.position.set(-4.45, 0, 3.55); scene.add(blowerG);
(function buildBlower() {
  box(0.46, 0.06, 0.36, matSteel, 0, 0.03, 0, blowerG);
  const body = cyl(0.17, 0.17, 0.12, M.plastic(0x3d6d8f, 0.35), 0, 0.26, 0, blowerG, 40); body.rotation.x = Math.PI / 2;
  const motor = cyl(0.09, 0.09, 0.22, M.paintedSteel(0x2f3337), 0, 0.26, -0.16, blowerG, 32); motor.rotation.x = Math.PI / 2;
  for (let k = 0; k < 10; k++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.004, 0.2), M.paintedSteel(0x2f3337)); fin.position.set(0, 0.17 + k * 0.02, -0.16); blowerG.add(fin); }
  cyl(0.03, 0.03, 0.12, matPipe, 0.12, 0.42, 0.02, blowerG, 16);
  tag(blowerG, 'tank');
})();
scene.add(makePipe([[-4.33, 0.48, 3.57], [-4.33, 1.42, 3.57], [-3.0, 1.42, 3.57], [0.12, 1.42, 3.57], [0.12, 1.42, 2.95]], { radius: 0.017, material: matPipe, tension: 0 }));
[-3.55, -3.0].forEach(x => scene.add(makePipe([[x, 1.42, 3.57], [x, 1.42, TANK.z - 0.1], [x, TANK.base + 0.07, TANK.z - 0.1]], { radius: 0.004, material: M.plasticBlack(), tension: 0 })));
scene.add(makePipe([[0.12, 1.42, 2.95], [0.12, BF.y0 + 0.05, 2.95]], { radius: 0.006, material: M.plasticBlack(), tension: 0 }));
const blowerLabel = label(blowerG, 'Blower', [0, 0.62, 0]);

/* ================================================================== raft beds, sump, pumps, pipes (rebuilt when the area changes) */
const bedsG = new THREE.Group(); scene.add(bedsG);
let heads = [], lettuceIM = [], rootIM = null, bedCut = null, bedLabel = null, sumpLabel = null, flows = [], bedLen = 0, nRaftsPerBed = 0, sumpG = null, doseLED = null;
function lowLettuce({ radius = 0.12, growth = 1, variety = 'butterhead', seed = 3 }) {
  const V = { butterhead: { shape: 'round', colors: ['#e3efac', '#a2cd52', '#62a032'], ruffle: 0.004, cup: 0.5, edge: null, heart: 0.35 }, red: { shape: 'ovate', colors: ['#dfeab2', '#7ea845', '#5b7d33'], ruffle: 0.012, cup: 0.3, edge: '#5a1530', heart: 0.2 } }[variety];
  const r = rng(seed); const n = Math.max(4, Math.round(13 * (0.35 + 0.65 * growth))); const R = radius * (0.25 + 0.75 * Math.pow(growth, 0.7));
  const geos = []; const golden = 2.39996;
  for (let k = 0; k < n; k++) {
    const age = 1 - k / n, inner = age < V.heart;
    const len = R * (0.5 + 0.8 * age) * (0.9 + r() * 0.2);
    const pitch = inner ? 0.12 + 0.5 * age + (r() - 0.5) * 0.1 : 0.35 + 0.95 * Math.pow(age, 1.2) + (r() - 0.5) * 0.18;
    const curl = inner ? -0.55 + 0.4 * age : 0.25 + 0.55 * age;
    const geo = leafGeometry({ length: len, width: len * 0.98, pitch, curl, cup: V.cup * (inner ? 1.6 : 1.25 - age * 0.5), ruffle: V.ruffle * len / 0.1 * (inner ? 0.5 : 1), ruffleFreq: 5 + r() * 3, shape: V.shape, seed: seed * 100 + k, colors: inner ? [V.colors[0], V.colors[0], V.colors[1]] : V.colors, edgeColor: V.edge, segU: 8, segV: 6 });
    const m = new THREE.Matrix4().makeRotationY(k * golden + r() * 0.2); m.multiply(new THREE.Matrix4().makeTranslation(0, 0.004 * k / n, R * (inner ? 0.02 : 0.05) * age)); geo.applyMatrix4(m); geos.push(geo);
  }
  const merged = BufferGeometryUtils.mergeGeometries(geos, false); geos.forEach(g => g.dispose());
  const bb = new THREE.Box3().setFromBufferAttribute(merged.attributes.position);
  merged.userData.rad = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
  return merged;
}
const MORPHS = [0.22, 0.55, 1.0];
const lettuceGeos = MORPHS.map((g, i) => ['butterhead', 'red'].map((v, j) => lowLettuce({ radius: 0.13, growth: g, variety: v, seed: 11 + i * 5 + j * 17 })));
const lettuceMat = leafMaterial({ gloss: 0.45 });
const sharedGeos = new Set(lettuceGeos.flat());
function simpleRootGeometry(seed = 3) {
  const r = rng(seed); const geos = [];
  for (let k = 0; k < 9; k++) {
    const a = r() * Math.PI * 2, pts = []; let p = new THREE.Vector3(Math.cos(a) * 0.01, 0, Math.sin(a) * 0.01);
    for (let s = 0; s < 6; s++) { pts.push(p.clone()); p = p.clone().add(new THREE.Vector3((r() - 0.5) * 0.03 + Math.cos(a) * 0.006, -0.045, (r() - 0.5) * 0.03 + Math.sin(a) * 0.006)); }
    geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.0016 * (0.7 + r() * 0.6), 4, false).toNonIndexed());
  }
  return BufferGeometryUtils.mergeGeometries(geos);
}
const rootGeo = simpleRootGeometry(7); sharedGeos.add(rootGeo);
const rootMat = M.root(); rootMat.color.set(0xeae1c4);
const PUMP_OUT = () => [-1.23, 0.27, sumpG.position.z];

function buildBedsAndPlumbing(Ap) {
  bedsG.traverse(o => { if (o.geometry && !sharedGeos.has(o.geometry)) o.geometry.dispose(); });
  [bedLabel, sumpLabel].forEach(l => { if (l && l.parent) { l.parent.remove(l); const i = labelObjs.indexOf(l); if (i >= 0) labelObjs.splice(i, 1); } });
  bedsG.clear();
  flows.forEach(f => { scene.remove(f.points); f.points.geometry.dispose(); }); flows = [];
  for (let i = pickables.length - 1; i >= 0; i--) if (pickables[i].userData.rebuild) pickables.splice(i, 1);
  nRaftsPerBed = Math.max(1, Math.round(Ap / (2 * RAFT.area)));
  bedLen = nRaftsPerBed * RAFT.d + 0.12;
  const z0 = BEDS.z0, zEnd = z0 - bedLen;
  heads = [];
  BEDS.xs.forEach((xc, b) => {
    const bed = new THREE.Group(); bed.position.set(xc, 0, z0 - bedLen / 2); bedsG.add(bed);
    const W = BEDS.w + 0.1, Lb = bedLen, y0 = BEDS.floor, Hh = BEDS.wallH, t = 0.045;
    const nb = Math.max(1, Math.floor(Lb / 0.8));
    for (let k = 0; k <= nb; k++) [-1, 1].forEach(s => box(0.2, y0, 0.4, matBlock, s * (W / 2 - 0.12), y0 / 2, -Lb / 2 + 0.2 + k * (Lb - 0.4) / nb, bed));
    box(W, 0.03, Lb, matWood, 0, y0 + 0.015, 0, bed);
    box(t, Hh, Lb, matWood, -W / 2 + t / 2, y0 + Hh / 2, 0, bed);
    const wr = box(t, Hh, Lb, matWood, W / 2 - t / 2, y0 + Hh / 2, 0, bed);
    box(W, Hh, t, matWood, 0, y0 + Hh / 2, Lb / 2 - t / 2, bed); box(W, Hh, t, matWood, 0, y0 + Hh / 2, -Lb / 2 + t / 2, bed);
    const liner = new THREE.Mesh(new THREE.BoxGeometry(W - 2 * t, Hh - 0.02, Lb - 2 * t), matLiner); liner.geometry.groups = liner.geometry.groups.filter((g, i) => i !== 2); liner.position.y = y0 + 0.03 + (Hh - 0.02) / 2; bed.add(liner);
    const wsurf = new THREE.Mesh(new THREE.PlaneGeometry(W - 2 * t - 0.01, Lb - 2 * t - 0.01), surfMat(0x1f3a36, 0.85, 0, -0.03, 4)); wsurf.rotation.x = -Math.PI / 2; wsurf.position.y = BEDS.water; bed.add(wsurf);
    if (b === 1) { // the outer wall of the right-hand bed can become a window (cut-away view)
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.012, Hh - 0.02, Lb - 0.02), M.glassCheap(0.12)); glass.position.set(W / 2 - t / 2, y0 + Hh / 2, 0); bed.add(glass);
      const wv = new THREE.Mesh(new THREE.BoxGeometry(W - 2 * t - 0.01, BEDS.water - y0 - 0.035, Lb - 2 * t - 0.01), new THREE.MeshPhysicalMaterial({ color: 0x2e5a55, roughness: 0.15, transparent: true, opacity: 0.32, depthWrite: false })); wv.position.y = (BEDS.water + y0 + 0.035) / 2; bed.add(wv);
      bedCut = { solid: wr, glass, water: wv };
    }
    for (let j = 0; j < nRaftsPerBed; j++) {
      const raft = makeRaft({ w: RAFT.w, d: RAFT.d - 0.01, nx: RAFT.nx, nz: RAFT.nz, holeR: 0.024 });
      const rz = Lb / 2 - 0.06 - (j + 0.5) * RAFT.d;
      raft.position.set(0, BEDS.water - 0.012, rz); bed.add(raft);
      raft.holes.forEach((hp, k) => { const jit = rng(b * 1000 + j * 37 + k)(); heads.push({ bed: b, raft: j, x: xc + hp.x + (jit - 0.5) * 0.01, z: z0 - bedLen / 2 + rz + hp.z + (jit - 0.5) * 0.01, y: BEDS.water + 0.022, rot: jit * 6.28, sc: 0.9 + jit * 0.2 }); });
    }
    bed.userData.rebuild = true; tag(bed, 'beds');
  });
  lettuceIM = [];
  MORPHS.forEach((m, i) => [0, 1].forEach(j => { const im = new THREE.InstancedMesh(lettuceGeos[i][j], lettuceMat, Math.max(1, heads.length)); im.count = 0; im.castShadow = true; im.receiveShadow = true; im.userData.comp = 'beds'; bedsG.add(im); lettuceIM.push(im); }));
  const potIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.027, 0.02, 0.05, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.6, side: THREE.DoubleSide }), heads.length);
  const m4 = new THREE.Matrix4(); heads.forEach((h, i) => { m4.makeTranslation(h.x, BEDS.water - 0.005, h.z); potIM.setMatrixAt(i, m4); }); bedsG.add(potIM);
  const rootHeads = heads.filter(h => h.bed === 1);
  rootIM = new THREE.InstancedMesh(rootGeo, rootMat, Math.max(1, rootHeads.length)); rootIM.userData.heads = rootHeads; rootIM.frustumCulled = false; rootIM.count = 0; bedsG.add(rootIM);
  // supplementary LED lighting above the rafts (typical of Nordic greenhouses)
  const nLights = Math.max(1, Math.round(bedLen / 1.4));
  for (let k = 0; k < nLights; k++) BEDS.xs.forEach(xc => {
    const zc = z0 - 0.7 - k * (bedLen - 0.5) / Math.max(1, nLights - 1 || 1);
    const bar = makeLEDBar({ length: 1.0, width: 0.08, color: 'full', light: false }); bar.position.set(xc, 2.05, zc); bar.setIntensity(0.55); bedsG.add(bar);
    [-0.4, 0.4].forEach(dx => { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 1.3, 4), M.steel()); w.position.set(xc + dx, 2.7, zc); bedsG.add(w); });
  });
  bedLabel = label(bedsG, 'Raft beds', [(BEDS.xs[0] + BEDS.xs[1]) / 2, 1.3, z0 - bedLen * 0.55]);
  // ---- sump, pump and dosing station at the far end of the beds
  sumpG = new THREE.Group(); sumpG.position.set(-0.35, 0, zEnd - 0.65); sumpG.userData.rebuild = true; bedsG.add(sumpG);
  const sm = M.plastic(0x5a6168, 0.5);
  box(1.0, 0.6, 0.04, sm, 0, 0.3, 0.3, sumpG); box(1.0, 0.6, 0.04, sm, 0, 0.3, -0.3, sumpG); box(0.04, 0.6, 0.6, sm, 0.5, 0.3, 0, sumpG); box(0.04, 0.6, 0.6, sm, -0.5, 0.3, 0, sumpG); box(1.0, 0.04, 0.6, sm, 0, 0.02, 0, sumpG);
  const ss = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.56), surfMat(0x2e6f73, 0.7, 0.05, 0.03, 2)); ss.rotation.x = -Math.PI / 2; ss.position.y = 0.46; sumpG.add(ss);
  const phProbe = makeProbe({ cap: 0xd6452f, tip: 'glass' }); phProbe.position.set(0.3, 0.3, 0.12); sumpG.add(phProbe);
  const pump = new THREE.Group(); pump.position.set(-0.88, 0, 0); sumpG.add(pump);
  box(0.42, 0.05, 0.26, matSteel, -0.04, 0.025, 0, pump);
  const volute = cyl(0.11, 0.11, 0.09, M.plastic(0x2c5f8a, 0.35), 0.12, 0.17, 0, pump, 32); volute.rotation.z = Math.PI / 2;
  const mot = cyl(0.085, 0.085, 0.22, M.paintedSteel(0x3b4046), -0.06, 0.15, 0, pump, 32); mot.rotation.z = Math.PI / 2;
  for (let k = 0; k < 8; k++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.004, 0.18), M.paintedSteel(0x3b4046)); fin.position.set(-0.06, 0.08 + k * 0.02, 0); pump.add(fin); }
  const dose = new THREE.Group(); dose.position.set(0.85, 0, -0.05); sumpG.add(dose);
  cyl(0.19, 0.19, 0.55, M.plastic(0xf1f1ec, 0.5), 0, 0.3, 0, dose, 32);
  cyl(0.07, 0.07, 0.04, M.plastic(0x2f6f5a, 0.4), 0, 0.6, 0, dose, 20);
  box(0.16, 0.12, 0.1, M.plastic(0x2d3134, 0.45), 0.02, 0.72, 0, dose);
  const headP = cyl(0.045, 0.045, 0.02, M.plastic(0xd8452f, 0.35), 0.02, 0.72, 0.06, dose, 20); headP.rotation.x = Math.PI / 2;
  doseLED = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), M.emissive(0x33ff77, 0.1)); doseLED.position.set(-0.04, 0.76, 0.051); dose.add(doseLED);
  sumpG.add(makePipe([[0.87, 0.72, 0.0], [0.6, 0.8, 0.0], [0.3, 0.62, 0.02], [0.22, 0.47, 0.02]], { radius: 0.004, material: M.plasticBlack(), tension: 0.4 }));
  sumpG.add(makePipe([[-0.49, 0.2, 0], [-0.62, 0.17, 0], [-0.7, 0.17, 0]], { radius: 0.03, material: matPipe, tension: 0 }));
  tag(sumpG, 'sump');
  sumpLabel = label(sumpG, 'Sump & pH control', [0, 1.05, 0]);
  // ---- pipes with flow particles
  const route = (pts, color = 0x2f8fd0, speed = 0.34, radius = 0.028) => {
    const p = makePipe(pts, { radius, material: matClear, tension: 0 }); p.castShadow = false; bedsG.add(p);
    const len = p.curve.getLength();
    const f = new FlowAlong(p.curve, { count: Math.max(14, Math.round(len * 30)), speed, size: 0.034, color, opacity: 0.95, jitter: 0.012 }); f.points.material.blending = THREE.NormalBlending; f.points.renderOrder = 2;
    scene.add(f.points); flows.push(f); f.base = speed; return p;
  };
  const tx = TANK.x + TANK.L / 2, sx = SEP.x, bx = BF.x;
  route([[tx - 0.03, WATER_Y.tank - 0.08, TANK.z - 0.15], [tx + 0.2, WATER_Y.tank - 0.08, TANK.z - 0.15], [sx - 0.3, WATER_Y.tank - 0.08, SEP.z - 0.24], [sx - 0.05, WATER_Y.sep - 0.05, SEP.z - SEP.r + 0.03]], 0x8a6a3c);
  route([[sx, WATER_Y.sep + 0.02, SEP.z], [sx, WATER_Y.sep + 0.14, SEP.z], [bx - BF.r - 0.1, WATER_Y.sep + 0.14, BF.z], [bx - BF.r + 0.08, WATER_Y.bf + 0.1, BF.z]], 0x4f9a86);
  const mY = BEDS.water + 0.2;
  route([[bx + BF.r - 0.02, WATER_Y.bf - 0.12, BF.z], [bx + BF.r + 0.25, WATER_Y.bf - 0.12, BF.z], [bx + BF.r + 0.25, mY, BF.z - 0.3], [bx + BF.r + 0.25, mY, BEDS.z0 + 0.05], [BEDS.xs[1], mY, BEDS.z0 + 0.05]], 0x2f8fd0);
  BEDS.xs.forEach(xc => bedsG.add(makePipe([[xc, mY, BEDS.z0 + 0.05], [xc, mY, BEDS.z0 - 0.12], [xc, BEDS.water + 0.05, BEDS.z0 - 0.12]], { radius: 0.02, material: matPipe, tension: 0 })));
  const cy = 0.3, zc = zEnd - 0.2;
  route([[BEDS.xs[1], cy, zEnd + 0.02], [BEDS.xs[1], cy, zc], [BEDS.xs[0], cy, zc]], 0x2f8fd0, 0.28, 0.026);
  route([[BEDS.xs[0], cy, zEnd + 0.02], [BEDS.xs[0], cy, zc], [0.02, cy, zc], [0.02, cy, zEnd - 0.36]], 0x2f8fd0, 0.3, 0.026);
  const rx = -4.35, po = [-1.23, 0.27, zEnd - 0.65];
  route([po, [-1.23, 0.36, zEnd - 0.65], [-1.6, 0.36, zEnd - 0.65], [rx + 0.3, 0.36, zEnd - 0.65], [rx, 0.36, zEnd - 0.35], [rx, 0.36, TANK.z - 0.55], [rx, WATER_Y.tank + 0.12, TANK.z - 0.55], [TANK.x - TANK.L / 2 + 0.2, WATER_Y.tank + 0.12, TANK.z - TANK.W / 2 + 0.12]], 0x2f8fd0, 0.42);
  bedsG.add(makePipe([[sx, 0.14, SEP.z], [sx, 0.06, SEP.z + 0.35], [sx - 0.1, 0.03, SEP.z + 0.7]], { radius: 0.018, material: matPipeW, tension: 0.2 }));
  applyCut();
}

/* ================================================================== picking & camera tours */
function viewFor(k) {
  if (k === 'home') return HOME;
  if (k === 'tank') return { pos: [-2.25, 1.15, 5.7], target: [-3.0, 0.62, 2.55] };
  if (k === 'filters') return { pos: [0.3, 1.95, 5.2], target: [-0.6, 0.55, 2.75] };
  if (k === 'beds') return { pos: [4.2, 2.3, 5.3], target: [1.9, 0.4, BEDS.z0 - bedLen * 0.5] };
  const z = sumpG ? sumpG.position.z : -3; return { pos: [2.6, 1.8, z - 2.6], target: [-0.6, 0.35, z] };
}
function fly(k) { const v = viewFor(k); stage.flyTo(v.pos, v.target, 1.3); }
const COMPVIEW = { tank: 'tank', sep: 'filters', bf: 'filters', beds: 'beds', sump: 'sump' };
let inspected = null;
stage.onPick({
  objects: () => pickables,
  onClick: hit => {
    if (!hit) { inspected = null; inspector.style.display = 'none'; return; }
    let o = hit.object; while (o && !o.userData.comp) o = o.parent;
    const c = o && o.userData.comp; if (!c) return;
    inspected = c; inspector.style.display = ''; updateInspector(); fly(COMPVIEW[c] || 'home');
  }
});
stage.onKey('space', () => clock.toggle());

/* ================================================================== charts */
const chN = new Plot('#chart-n', { x: { label: 'Time', unit: 'd', min: 0 }, y: { label: 'TAN-N, NO₂⁻-N', unit: 'mg L⁻¹', min: 0 }, y2: { label: 'NO₃⁻-N', unit: 'mg L⁻¹', min: 0 } });
const chO = new Plot('#chart-o2', { x: { label: 'Time', unit: 'd', min: 0 }, y: { label: 'Dissolved O₂', unit: 'mg L⁻¹', min: 0 }, y2: { label: 'pH', unit: '', min: 5.5, max: 8.5 } });
const chB = new Plot('#chart-bio', { x: { label: 'Time', unit: 'd', min: 0 }, y: { label: 'Standing biomass', unit: 'kg', min: 0 }, y2: { label: 'Cumulative harvest', unit: 'kg', min: 0 } });
const sankey = new Sankey('#chart-sankey', { unit: 'g N', height: 320, digits: 0 });
chN.hline('tanlim', 2, { color: 'magenta', label: 'TAN < 2 (FAO, tilapia)', dash: [4, 4] });
chN.hline('no2lim', 1, { color: 'amber', label: 'NO₂⁻-N < 1', dash: [2, 4] });
chO.hline('dolim', 4, { color: 'danger', label: 'DO > 4 for tilapia', dash: [4, 4] });

/* ================================================================== history & time stepping */
let H;
function newHistory() { H = { t: [], tan: [], no2: [], no3: [], nh3: [], do: [], ph: [], co2: [], fish: [], stand: [], fishH: [], letH: [], tss: [] }; }
newHistory();
let nextSample = 0;
function sample() {
  const s = model.state, F = model.diagnostics();
  H.t.push(s.t); H.tan.push(s.TAN); H.no2.push(s.NO2); H.no3.push(s.NO3); H.nh3.push(F.NH3N); H.do.push(s.DO); H.ph.push(F.pH); H.co2.push(F.co2);
  H.fish.push(s.W * s.NF / 1000); H.stand.push(F.standFW / 1000); H.fishH.push(s.cum.fishHarv / 1000); H.letH.push(s.lettuce / 1000); H.tss.push(s.S / F.V);
  if (H.t.length > 8000) Object.values(H).forEach(a => a.splice(0, a.length - 8000));
}
function advance(dt) {
  let rem = dt;
  while (rem > 1e-9) {
    const d = Math.min(rem, Math.max(1e-4, nextSample - model.t));
    model.advance(d); rem -= d;
    if (model.t >= nextSample - 1e-9) { sample(); nextSample = model.t + 0.05; }
  }
}
const clock = new SimClock({ speed: 1, onStep: dt => advance(dt), maxDt: 0.25 });
clock.onState(r => { playBtn.innerHTML = r ? '❚❚ Pause' : '▶ Run'; });

function restart(kind = model.mode || 'mature', ctrlOverride = null) {
  clock.pause();
  const c = pickCtrl(ui.values());
  Object.assign(model.ctrl, c, ctrlOverride || {});
  model.reset(kind);
  if (ctrlOverride) model.setControls(c);
  newHistory(); sample(); nextSample = 0.05;
  bottomPellets = 0; pelletState.length = 0; deadFish.forEach(d => tankG.remove(d.f)); deadFish.length = 0; lastDeaths = 0; schoolKey = null;
  refreshAll(true);
  clock.speed = +ui.get('speed');
  setTimeout(() => clock.play(), 300);
}

/* ================================================================== responding to controls */
ui.onChange((st, id) => {
  if (id === 'speed') { clock.speed = +st.speed; return; }
  if (id === 'labels') { labelObjs.forEach(l => l.visible = st.labels); return; }
  if (id === 'cut') { applyCut(); return; }
  if (MODEL_KEYS.includes(id)) {
    if (!applyingPreset) model.setControls(pickCtrl(st));
    if (id === 'Ap' && nRaftsPerBed !== Math.max(1, Math.round(st.Ap / (2 * RAFT.area)))) { buildBedsAndPlumbing(st.Ap); updateLettuce(true); }
    if (!applyingPreset) refreshAll(true);
  }
});
function applyCut() {
  const on = !!ui.get('cut');
  if (bedCut) { bedCut.solid.visible = !on; bedCut.glass.visible = on; bedCut.water.visible = on; }
  if (rootIM) { rootIM.visible = on; }
  lastHeadsKey = '';
}

/* ================================================================== scene updates driven by the model */
let lastHeadsKey = '', tLastUI = 0, sludgeRate = 0;
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const cWaterClear = new THREE.Color(0x125761), cWaterMurky = new THREE.Color(0x5e5a32), cCarrierClean = new THREE.Color(0xece8da), cCarrierBio = new THREE.Color(0x7b5a2c);

function updateSchool(F, s) {
  const target = Math.max(1, Math.min(48, Math.round(s.NF / FISH_SCALE)));
  const lenKey = Math.round(Math.cbrt(Math.max(20, s.W)) * 3);
  if (!school || schoolKey !== lenKey) { rebuildSchool(target, s.W); schoolKey = lenKey; lastDeaths = s.cum.deaths; }
  else {
    const alive = school.fish.length;
    if (target < alive) {
      const died = s.cum.deaths - lastDeaths > 0.5;
      for (let k = 0; k < alive - target && school.fish.length > 1; k++) {
        const f = school.fish.pop();
        if (died) { f.rotation.set(Math.PI, f.rotation.y, 0.3 * (Math.random() - 0.5)); deadFish.push({ f, vy: 0.02 + Math.random() * 0.03 }); }
        else tankG.remove(f);
      }
      lastDeaths = s.cum.deaths;
    } else if (target > alive + 1) rebuildSchool(target, s.W);
  }
  // behaviour: activity follows the appetite factors; hypoxic fish crowd at the surface
  school.activity = Math.max(0.08, Math.min(1.25, 0.2 + 0.9 * Math.min(F.sig, F.ups) * Math.min(1, F.tau / 0.7)));
  const b0 = school.baseBounds, top = b0.max.y;
  const hyp = F.DO < 2.0 ? Math.min(1, (2.0 - F.DO) / 1.5) : 0;
  const feedLift = (F.feeding > 0 && clock.speed <= 0.26 && clock.running) ? 0.35 : 0;
  school.bounds.min.y = b0.min.y + (top - 0.12 - b0.min.y) * Math.max(hyp, feedLift);
}
function updatePellets(dt, F, s) {
  const slow = clock.speed <= 0.26 && clock.running;
  const rate = slow && F.feeding > 0 ? Math.min(40, F.offered / 60) : 0;
  const pUneaten = F.uneatRate / Math.max(1e-9, F.uneatRate + F.eatRate);
  let want = rate * dt; while (want > 0 && pelletState.length < PELLET_MAX - 170) { if (Math.random() < want) pelletState.push({ x: -0.45 + (Math.random() - 0.5) * 0.25, z: 0.15 + (Math.random() - 0.5) * 0.2, y: TANK.base + TANK.H + 0.02, vy: 0, float: 0.4 + Math.random() * 2, eaten: Math.random() > pUneaten }); want -= 1; }
  const surf = TANK.base + TANK.depth, floorY = TANK.base + TANK.wall + 0.004;
  for (let i = pelletState.length - 1; i >= 0; i--) {
    const p = pelletState[i];
    if (p.y > surf) { p.vy -= 9.8 * dt; p.y += p.vy * dt; if (p.y <= surf) { p.y = surf; p.vy = 0; } }
    else if (p.float > 0) { p.float -= dt; if (p.float <= 0 && p.eaten) { pelletState.splice(i, 1); continue; } }
    else { p.y -= 0.06 * dt; if (p.y <= floorY) { pelletState.splice(i, 1); continue; } }
  }
  const uneatFrac = s.cum.feed > 0 ? s.cum.uneaten / s.cum.feed : 0;
  const targetBottom = Math.round(Math.min(160, uneatFrac * 420));
  bottomPellets += Math.sign(targetBottom - bottomPellets);
  let n = 0;
  pelletState.forEach(p => { tmpM.makeTranslation(p.x, p.y, p.z); pellets.setMatrixAt(n++, tmpM); });
  const r = rng(99);
  for (let k = 0; k < bottomPellets && n < PELLET_MAX; k++) { tmpM.makeTranslation((r() - 0.5) * (TANK.L - 0.2), floorY, (r() - 0.5) * (TANK.W - 0.2)); pellets.setMatrixAt(n++, tmpM); }
  pellets.count = n; pellets.instanceMatrix.needsUpdate = true;
}
function updateCarriers(dt, F, s) {
  const g = F.g; const frac = Math.min(1, (s.XA / Math.max(1e-9, g.XmaxA) + s.XN / Math.max(1e-9, g.XmaxN)) / 2 / 0.3);
  carrierMat.color.copy(cCarrierClean).lerp(cCarrierBio, Math.pow(frac, 0.7));
  const nShow = Math.round(carrierState.length * Math.min(1, model.ctrl.Vmed / 0.4));
  carriers.count = nShow;
  const R = BF.r - 0.03, yb = BF.y0 + 0.06, yt = WATER_Y.bf - 0.03;
  const vel = 0.05 + 0.1 * Math.min(1, model.ctrl.kLa / 4);
  for (let i = 0; i < nShow; i++) {
    const c = carrierState[i];
    c.s = (c.s + dt * vel * c.w * 0.35) % 1; c.a += dt * 0.25 * c.w * (0.2 + model.ctrl.kLa / 4);
    const s4 = c.s * 4, seg = Math.floor(s4), u = s4 - seg; const r0 = 0.12 + 0.25 * c.rj, r1 = 0.72 + 0.26 * c.rj;
    let rr, yy;
    if (seg === 0) { rr = r0; yy = u; } else if (seg === 1) { rr = r0 + (r1 - r0) * u; yy = 1; } else if (seg === 2) { rr = r1; yy = 1 - u; } else { rr = r1 - (r1 - r0) * u; yy = 0; }
    // with no aeration the carriers settle to the bottom
    const settle = Math.max(0, 1 - model.ctrl.kLa / 0.8);
    yy = (yb + (yt - yb) * (0.04 + 0.92 * yy) + (c.yj - 0.5) * 0.05) * (1 - settle) + (yb + c.yj * 0.12) * settle;
    c.rot.x += dt * 1.3 * c.w * (1 - settle); c.rot.y += dt * 0.9 * c.w * (1 - settle);
    tmpQ.setFromEuler(c.rot); tmpP.set(Math.cos(c.a) * rr * R, yy, Math.sin(c.a) * rr * R); tmpS.set(1, 1, 1); tmpM.compose(tmpP, tmpQ, tmpS); carriers.setMatrixAt(i, tmpM);
  }
  carriers.instanceMatrix.needsUpdate = true;
}
function updateSwirl(dt) {
  const { st, pos, pts } = swirl; const w = clock.running ? 2.2 : 0.4;
  const yTop = WATER_Y.sep - 0.03, yCone = SEP.y0 + SEP.coneH, yBot = SEP.y0 + 0.04;
  for (let i = 0; i < st.length; i++) {
    const p = st[i]; p.a += dt * w * (1.2 - p.y * 0.5); p.y -= dt * 0.05 * (0.5 + p.rr);
    if (p.y < 0) { p.y = 1; p.a = Math.random() * 6.28; }
    const y = yBot + (yTop - yBot) * p.y; let rmax = SEP.r - 0.02; if (y < yCone) rmax = 0.03 + (SEP.r - 0.03) * (y - SEP.y0) / SEP.coneH;
    const r = rmax * p.rr; pos[i * 3] = Math.cos(p.a) * r; pos[i * 3 + 1] = y; pos[i * 3 + 2] = Math.sin(p.a) * r;
  }
  pts.geometry.attributes.position.needsUpdate = true;
  pts.material.opacity = 0.25 + 0.6 * Math.min(1, sludgeRate / 150);
}
function updateSludge(s, F) {
  // sludge collected since the last daily draining (08:00) fills the cone
  const dayFrac = (s.t - 8 / 24) - Math.floor(s.t - 8 / 24);
  sludgeRate = sludgeRate * 0.9 + F.capDM * 0.1 * (F.feeding > 0 ? 0.5 : 1.5); // smooth the daily pattern
  const vol = sludgeRate * dayFrac / 20000;       // m³ of sludge at ≈ 2 % dry matter
  const hMax = SEP.coneH - 0.02; const Vcone = Math.PI * SEP.r * SEP.r * hMax / 3;
  const h = Math.max(0.004, hMax * Math.cbrt(Math.min(1, vol / Vcone * 6)));
  const rTop = 0.03 + (SEP.r - 0.03) * h / SEP.coneH;
  sludgeMesh.scale.set(rTop, h, rTop); sludgeMesh.position.y = SEP.y0 + 0.004 + h / 2;
}
function updateLettuce(force = false) {
  const s = model.state; const cohorts = s.cohorts.map((c, i) => ({ i, W: c.W, age: c.age }));
  const key = cohorts.map(c => Math.round(c.W * 3)).join(',') + '|' + heads.length + '|' + (rootIM && rootIM.visible);
  if (!force && key === lastHeadsKey) return; lastHeadsKey = key;
  // production line: rafts advance from the far end (transplants) to the inlet end (harvest)
  const order = cohorts.slice().sort((a, b) => b.age - a.age);
  const band = j => order[Math.min(order.length - 1, Math.floor(j * order.length / nRaftsPerBed))];
  const counts = lettuceIM.map(() => 0);
  heads.forEach(h => {
    const W = band(h.raft).W; if (W <= 0.01) return;
    const morph = W < 20 ? 0 : W < 80 ? 1 : 2; const idx = morph * 2 + h.bed; const im = lettuceIM[idx];
    const sc = 0.135 * Math.cbrt(W / 150) * h.sc / im.geometry.userData.rad;
    tmpQ.setFromAxisAngle(UP, h.rot); tmpS.set(sc, sc * (0.85 + 0.15 * Math.min(1, W / 150)), sc); tmpP.set(h.x, h.y, h.z);
    tmpM.compose(tmpP, tmpQ, tmpS); im.setMatrixAt(counts[idx]++, tmpM);
  });
  lettuceIM.forEach((im, k) => { im.count = counts[k]; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); });
  if (rootIM && rootIM.visible) {
    let n = 0;
    rootIM.userData.heads.forEach(h => { const W = band(h.raft).W; if (W <= 0.01) return; const L = 0.35 + 1.4 * Math.min(1, W / 150); tmpQ.setFromAxisAngle(UP, h.rot); tmpS.set(1, L, 1); tmpP.set(h.x, BEDS.water - 0.03, h.z); tmpM.compose(tmpP, tmpQ, tmpS); rootIM.setMatrixAt(n++, tmpM); });
    rootIM.count = n; rootIM.instanceMatrix.needsUpdate = true;
  }
}

/* ---------- per-frame animation */
stage.onFrame((dt, t) => {
  const s = model.state; const F = model.F || model.diagnostics();
  if (school) school.update(dt, t);
  deadFish.forEach(d => { const top = TANK.base + TANK.depth - 0.03; if (d.f.position.y < top) d.f.position.y = Math.min(top, d.f.position.y + d.vy * dt); });
  bubblesTank.setRate(6 + 26 * model.ctrl.kLa); bubblesTank.update(dt);
  bubblesBF.setRate(4 + 22 * model.ctrl.kLa); bubblesBF.update(dt);
  const flowK = clock.running ? 1 : 0.12;
  flows.forEach(f => { f.speed = f.base * flowK; f.update(dt); });
  animatedNormals.forEach(a => { a.tex.offset.x += a.sx * dt; a.tex.offset.y += a.sy * dt; });
  tankCaustics.material.map.offset.x += dt * 0.015; tankCaustics.material.map.offset.y += dt * 0.01;
  updateSwirl(dt);
  updateCarriers(dt, F, s);
  updatePellets(dt, F, s);
  const now = performance.now();
  if (now - tLastUI > 220) { tLastUI = now; refreshAll(false); }
  if (now - tLastLabel > 200) { // hide labels of far-away components when the camera zooms in
    tLastLabel = now; const on = ui.get('labels'); const lim = Math.max(10, 2.3 * stage.camera.position.distanceTo(stage.controls.target));
    labelObjs.forEach(l => { if (!on) { l.visible = false; return; } l.getWorldPosition(_lp); l.visible = _lp.distanceTo(stage.camera.position) < lim; });
  }
});
let tLastLabel = 0; const _lp = new THREE.Vector3();

/* ================================================================== readouts, labels, HUD, charts */
const nf = (v, d) => fmt(v, d);
function statusRange(v, okLo, okHi, warnLo, warnHi) { if (v >= okLo && v <= okHi) return 'ok'; if (v >= warnLo && v <= warnHi) return 'warn'; return 'bad'; }
let lastChart = 0;
function refreshAll(force) {
  const s = model.state; const F = model.diagnostics(); const c = model.ctrl; const g = F.g;
  updateSchool(F, s); updateSludge(s, F); updateLettuce(force);
  const tss = s.S / F.V; const turb = Math.min(1, tss / 150);
  tankWater.material.color.copy(cWaterClear).lerp(cWaterMurky, turb); tankWater.material.opacity = 0.38 + 0.45 * turb;
  tankSurface.material.color.copy(tankWater.material.color);
  tankCaustics.material.opacity = 0.34 * (1 - turb * 0.85);
  if (doseLED) doseLED.material.emissiveIntensity = F.dose > 0.05 ? 3.5 : 0.1;
  hopperFill.visible = c.FR > 0;
  // readouts
  const fishKg = s.W * s.NF / 1000;
  ro.set('fish', fishKg, s.cum.deaths > 0.02 * s.NF + 0.5 ? 'bad' : fishKg / PAR.Vft > 40 ? 'warn' : 'ok', `${nf(s.NF, 0)} fish of ${nf(s.W, 0)} g · ${nf(fishKg / PAR.Vft, 1)} kg m⁻³`);
  const frr = F.offered / c.Ap;
  ro.set('feed', `${nf(F.offered, 0)} g d⁻¹`, frr >= 40 && frr <= 100 ? 'ok' : 'warn', `feed-rate ratio ${nf(frr, 0)} g m⁻² d⁻¹ (UVI 60–100)`);
  ro.set('tan', s.TAN, s.TAN < 1 ? 'ok' : s.TAN < 2 ? 'warn' : 'bad', 'tilapia guideline < 2');
  ro.set('nh3', F.NH3N, F.NH3N < 0.025 ? 'ok' : F.NH3N < 0.066 ? 'warn' : 'bad', `${nf(F.fNH3 * 100, 2)} % of TAN is NH₃`);
  ro.set('no2', s.NO2, s.NO2 < 0.5 ? 'ok' : s.NO2 < 1 ? 'warn' : 'bad', 'keep below 1');
  ro.set('no3', s.NO3, s.NO3 >= 5 && s.NO3 <= 150 ? 'ok' : s.NO3 < 300 ? 'warn' : 'bad', 'aquaponics 5–150 (FAO)');
  ro.set('do', s.DO, s.DO >= 5 ? 'ok' : s.DO >= 4 ? 'warn' : 'bad', `${nf(100 * s.DO / F.DOsat, 0)} % of saturation`);
  ro.set('ph', `${nf(F.pH, 2)} · ${nf(s.ALK * 50.04, 0)}`, statusRange(F.pH, 6.5, 7.6, 6.0, 8.5), 'alkalinity in mg L⁻¹ as CaCO₃');
  ro.set('co2', F.co2, F.co2 < 15 ? 'ok' : F.co2 < 20 ? 'warn' : 'bad', 'keep below 15–20');
  ro.set('tss', tss, tss < 30 ? 'ok' : tss < 60 ? 'warn' : 'bad', 'recommended < 30');
  const load = F.excrN + F.minN;
  ro.set('bio', F.rA, load < 0.5 || F.rA > 0.85 * load ? 'ok' : 'warn', `${nf(g.Abf, 0)} m² biofilm · AOB at ${nf(100 * s.XA / g.XmaxA, 0)} % of capacity`);
  const lettDay = F.growFW / 1000;
  ro.set('lettuce', lettDay, lettDay / c.Ap * 1000 > 80 ? 'ok' : 'warn', `${nf(lettDay / c.Ap * 1000, 0)} g FW m⁻² d⁻¹ · takes up ${nf(F.upN, 1)} g N d⁻¹`);
  const gain = s.cum.fishN / PAR.nFish;
  const fcr = gain > 5 ? s.cum.feed / gain : (F.Gfish > 0 ? (F.offered / Math.max(1, s.NF)) / F.Gfish : NaN);
  ro.set('fcr', fcr, fcr < 1.6 ? 'ok' : fcr < 2.2 ? 'warn' : 'bad', 'kg feed per kg fish gain');
  const nue = s.cum.feedN > 1 ? 100 * (s.cum.fishN + s.cum.plantN) / s.cum.feedN : NaN;
  ro.set('nue', nue, nue >= 45 ? 'ok' : nue >= 30 ? 'warn' : 'bad', 'fish + plant N ÷ feed N');
  const B = BASES[c.base];
  const eqd = model.t > 0.5 ? s.cum.base / model.t : F.dose;
  ro.set('base', c.base === 'off' ? 'off' : `${nf(eqd * B.eqMass, 0)} g d⁻¹`, c.base === 'off' && F.pH < 6.5 ? 'bad' : null, c.base === 'off' ? 'no alkalinity added' : `${B.label} · adds ${nf(eqd * B.catMass, 0)} g ${B.cat} d⁻¹`);
  // labels
  if (ui.get('labels')) {
    tankLabel.element.innerHTML = `Fish tank<small>${nf(fishKg, 0)} kg tilapia · O₂ ${nf(s.DO, 1)} mg L⁻¹</small>`;
    sepLabel.element.innerHTML = `Swirl separator<small>${nf(F.capDM, 0)} g solids d⁻¹</small>`;
    bfLabel.element.innerHTML = `Biofilter<small>${nf(F.rA, 1)} g N d⁻¹ · NO₂-N ${nf(s.NO2, 2)}</small>`;
    if (bedLabel) bedLabel.element.innerHTML = `Raft beds · ${nf(c.Ap, 1)} m²<small>NO₃-N ${nf(s.NO3, 0)} mg L⁻¹ · ${nf(F.growFW / 1000, 2)} kg d⁻¹</small>`;
    if (sumpLabel) sumpLabel.element.innerHTML = `Sump<small>pH ${nf(F.pH, 2)}${c.base === 'off' ? ' · no base' : ''}</small>`;
    blowerLabel.element.innerHTML = `Blower<small>k<sub>L</sub>a ${nf(c.kLa, 1)} h⁻¹</small>`;
  }
  // HUD
  const day = Math.floor(s.t), hh = Math.floor((s.t - day) * 24), mm = Math.floor(((s.t - day) * 24 - hh) * 60);
  hud.set('time', `Day <b>${day}</b> · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}${F.feeding > 0 ? ' · feeding' : ''}`);
  const warns = [];
  if (s.DO < 2) warns.push(`O₂ ${nf(s.DO, 1)} mg L⁻¹: fish gasp at the surface`);
  if (F.NH3N > 0.066) warns.push(`NH₃-N ${nf(F.NH3N, 3)} mg L⁻¹`);
  if (s.NO2 > 1) warns.push(`nitrite-N ${nf(s.NO2, 1)} mg L⁻¹`);
  if (F.pH < 6.3) warns.push(`pH ${nf(F.pH, 2)}: nitrification inhibited`);
  if (s.cum.feed > 0 && s.cum.uneaten / s.cum.feed > 0.05) warns.push('uneaten feed');
  if (s.cum.deaths > 0.5) warns.push(`${nf(s.cum.deaths, 0)} fish died`);
  if (warns.length) hud.set('warn', '⚠ ' + warns.join(' · ')); else hud.remove('warn');
  if (inspected) updateInspector(F, s);
  const now = performance.now();
  if (force || now - lastChart > 500) { lastChart = now; drawCharts(); }
}
function updateInspector(F = model.diagnostics(), s = model.state) {
  const c = model.ctrl, g = F.g; let html = '';
  if (inspected === 'tank') html = `<b>Fish tank (1.8 m³)</b><br>Feed offered ${nf(F.offered, 0)} g d⁻¹ · appetite ${nf(F.Imax * s.NF, 0)} g d⁻¹<br>Fish respire ${nf(F.o2Fish / 1000, 2)} kg O₂ d⁻¹ · CO₂ ${nf(F.co2, 1)} mg L⁻¹<br>Appetite factors: temperature ${nf(F.tau, 2)} · O₂ ${nf(F.sig, 2)} · NH₃ ${nf(F.ups, 2)}`;
  else if (inspected === 'sep') html = `<b>Swirl separator</b><br>Solids made ${nf(F.faecDM + F.unDM, 0)} g DM d⁻¹ (faeces + uneaten feed)<br>Captured ${c.eta} % → ${nf(F.capDM, 0)} g d⁻¹ with ${nf(F.capN, 1)} g N d⁻¹<br>Suspended solids ${nf(s.S / F.V, 0)} mg L⁻¹ release ${nf(F.minN, 1)} g N d⁻¹`;
  else if (inspected === 'bf') html = `<b>Moving-bed biofilter</b><br>Biofilm ${nf(g.Abf, 0)} m² (${nf(g.AbfMedia, 0)} m² on carriers)<br>AOB ${nf(s.XA, 1)} g (${nf(100 * s.XA / g.XmaxA, 0)} %) · NOB ${nf(s.XN, 1)} g (${nf(100 * s.XN / g.XmaxN, 0)} %)<br>NH₄⁺→NO₂⁻ ${nf(F.rA, 1)} · NO₂⁻→NO₃⁻ ${nf(F.rN, 1)} g N d⁻¹<br>O₂ use ${nf((3.43 * F.rA + 1.14 * F.rN) / 1000, 2)} kg d⁻¹ · pH factor ${nf(F.fpH, 2)}`;
  else if (inspected === 'beds') html = `<b>Raft beds (${nf(c.Ap, 1)} m², ${nf(PAR.dens * c.Ap, 0)} lettuce)</b><br>Growth ${nf(F.growFW, 0)} g FW d⁻¹ · N uptake ${nf(F.upN, 1)} g d⁻¹<br>Limitation: N ${nf(F.fN, 2)} · O₂ ${nf(F.fDOp, 2)} · temperature ${nf(F.fTp, 2)}<br>Cohorts (g head⁻¹): ${s.cohorts.map(q => nf(q.W, 0)).join(' · ')}`;
  else if (inspected === 'sump') html = `<b>Sump & dosing</b><br>pH ${nf(F.pH, 2)} · alkalinity ${nf(s.ALK * 50.04, 0)} mg L⁻¹ as CaCO₃<br>Net alkalinity change from N reactions ${nf(F.alkN, 2)} eq d⁻¹<br>Base pump ${nf(F.dose, 2)} eq d⁻¹ · exchange ${nf(F.Q * 1000, 0)} L d⁻¹`;
  inspector.innerHTML = html + '<br><span style="opacity:.65">click empty space to close</span>';
}
function drawCharts() {
  const t = H.t; if (!t.length) return;
  const xmax = Math.max(5, t[t.length - 1]);
  chN.line('tan', t, H.tan, { color: 'magenta', label: 'TAN-N', width: 2.2 });
  chN.line('no2', t, H.no2, { color: 'amber', label: 'NO₂⁻-N', width: 2.2 });
  chN.line('no3', t, H.no3, { color: 'water', label: 'NO₃⁻-N (right)', width: 2, dash: [6, 3], y2: true });
  chN.setAxis('x', { min: 0, max: xmax });
  chO.line('do', t, H.do, { color: 'accent', label: 'Dissolved O₂', width: 2 });
  chO.line('ph', t, H.ph, { color: 'c4', label: 'pH (right)', width: 2, y2: true });
  chO.setAxis('x', { min: 0, max: xmax });
  chB.line('fish', t, H.fish, { color: 'water', label: 'Fish (standing)', width: 2.2 });
  chB.line('stand', t, H.stand, { color: 'accent', label: 'Lettuce (standing)', width: 2.2 });
  chB.line('fishH', t, H.fishH, { color: 'water', label: 'Fish harvested (right)', width: 1.8, dash: [5, 4], y2: true });
  chB.line('letH', t, H.letH, { color: 'accent', label: 'Lettuce harvested (right)', width: 1.8, dash: [5, 4], y2: true });
  chB.setAxis('x', { min: 0, max: xmax });
  drawSankey();
}
function drawSankey() {
  const c = model.state.cum; if (c.feedN < 0.5) { sankey.set({ nodes: [], links: [] }); return; }
  const excr = c.excrN, solids = c.solidsN, fish = Math.max(0, c.fishN);
  const dis = excr + c.minN;
  const acc = Math.max(0, dis - c.plantN - c.denN - c.exN);
  const solidsLeft = Math.max(0, solids - c.sludgeN - c.minN);
  sankey.set({
    nodes: [
      { id: 'feed', label: 'Feed N', color: 'amber', col: 0 },
      { id: 'fish', label: 'Fish growth', color: 'water', col: 1 },
      { id: 'solids', label: 'Faeces + uneaten feed', color: 'c7', col: 1 },
      { id: 'excr', label: 'Excreted ammonia', color: 'magenta', col: 1 },
      { id: 'dis', label: 'Dissolved N (TAN → NO₃⁻)', color: 'c2', col: 2 },
      { id: 'sludge', label: 'Sludge removed', color: 'muted', col: 3 },
      { id: 'plants', label: 'Lettuce', color: 'accent', col: 3 },
      { id: 'den', label: 'N₂ + N₂O', color: 'danger', col: 3 },
      { id: 'ex', label: 'Water exchange', color: 'c1', col: 3 },
      { id: 'acc', label: 'Still in the system', color: 'c5', col: 3 }
    ],
    links: [
      { source: 'feed', target: 'fish', value: fish }, { source: 'feed', target: 'solids', value: solids }, { source: 'feed', target: 'excr', value: excr },
      { source: 'solids', target: 'sludge', value: c.sludgeN }, { source: 'solids', target: 'dis', value: c.minN }, { source: 'solids', target: 'acc', value: solidsLeft },
      { source: 'excr', target: 'dis', value: excr },
      { source: 'dis', target: 'plants', value: c.plantN }, { source: 'dis', target: 'den', value: c.denN }, { source: 'dis', target: 'ex', value: c.exN }, { source: 'dis', target: 'acc', value: acc }
    ]
  });
}
function downloadHistory() {
  const rows = H.t.map((t, i) => [t.toFixed(3), H.tan[i].toFixed(3), H.nh3[i].toFixed(4), H.no2[i].toFixed(3), H.no3[i].toFixed(2), H.do[i].toFixed(2), H.ph[i].toFixed(3), H.co2[i].toFixed(2), H.tss[i].toFixed(1), H.fish[i].toFixed(2), H.stand[i].toFixed(2), H.fishH[i].toFixed(2), H.letH[i].toFixed(2)]);
  downloadCSV('aquaponics-simulation.csv', ['day', 'TAN_mgN_L', 'NH3N_mg_L', 'NO2N_mg_L', 'NO3N_mg_L', 'DO_mg_L', 'pH', 'CO2_mg_L', 'TSS_mg_L', 'fish_kg', 'lettuce_standing_kg', 'fish_harvest_kg', 'lettuce_harvest_kg'], rows);
}

/* ================================================================== explanatory figures (Explain tab) */
const figF = new Plot('#fig-factors', { x: { label: 'Temperature', unit: '°C', min: 14, max: 40 }, y: { label: 'Relative appetite', unit: '', min: 0, max: 1.05 }, legend: false });
let ffVar = 'T';
function drawFactors() {
  const F = model.F || model.diagnostics(); const xs = [], ys = [];
  if (ffVar === 'T') { for (let T = 14; T <= 40; T += 0.1) { xs.push(T); ys.push(tauT(T)); } figF.setAxis('x', { label: 'Temperature', unit: '°C', min: 14, max: 40 }); figF.point('now', model.ctrl.T, F.tau, { color: 'magenta', label: 'now' }); }
  else if (ffVar === 'DO') { for (let d = 0; d <= 9; d += 0.02) { xs.push(d); ys.push(sigmaDO(d)); } figF.setAxis('x', { label: 'Dissolved oxygen', unit: 'mg L⁻¹', min: 0, max: 9 }); figF.point('now', Math.min(9, F.DO), F.sig, { color: 'magenta', label: 'now' }); }
  else { for (let u = 0; u <= 1.6; u += 0.005) { xs.push(u); ys.push(upsilonUIA(u)); } figF.setAxis('x', { label: 'Un-ionised ammonia', unit: 'mg NH₃ L⁻¹', min: 0, max: 1.6 }); figF.point('now', Math.min(1.6, F.UIA), F.ups, { color: 'magenta', label: 'now' }); }
  figF.line('f', xs, ys, { color: 'accent', width: 2.6, fill: 0.1 });
}
document.getElementById('ff-sel').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; ffVar = b.dataset.v; document.querySelectorAll('#ff-sel button').forEach(x => x.setAttribute('aria-pressed', x === b)); drawFactors(); });
const figC = new Plot('#fig-carb', { x: { label: 'Alkalinity', unit: 'mg L⁻¹ as CaCO₃', min: 0, max: 250 }, y: { label: 'pH', unit: '', min: 5.5, max: 9 } });
function drawCarb() {
  const K = carbConst(26), pK1 = -Math.log10(K.K1);
  [1, 2, 5, 10, 20].forEach((co2, i) => { const xs = [], ys = []; for (let a = 2; a <= 250; a += 2) { const hco3 = a / 50.04, c = co2 / 44.01; const ct = hco3 + c; xs.push(a); ys.push(solvePH(hco3, ct, K, pK1 + Math.log10(hco3 / c))); } figC.line('c' + co2, xs, ys, { color: i, label: `CO₂ ${co2} mg L⁻¹`, width: 2 }); });
  const F = model.F || model.diagnostics(); const s = model.state;
  figC.point('now', Math.min(250, Math.max(0, s.ALK * 50.04)), F.pH, { color: 'magenta', label: 'simulated system', r: 6 });
}
drawCarb(); drawFactors();
setInterval(() => { if (document.getElementById('fig-carb').offsetParent) { drawCarb(); drawFactors(); } }, 1500);

/* ================================================================== start */
buildBedsAndPlumbing(ui.get('Ap'));
sample(); nextSample = 0.05;
refreshAll(true);
clock.speed = +ui.get('speed');
setTimeout(() => clock.play(), 900);
window.__aq = { model, clock, get H() { return H; }, stage, ui, advance, refreshAll, restart, fly, setView(pos, target) { stage.camera.position.set(...pos); stage.controls.target.set(...target); stage.controls.update(); } };
