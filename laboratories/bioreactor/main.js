/* Stirred-tank bioreactor — UI, 3D scene and charts.
   The process model lives in ./model.js (Herbert–Pirt kinetics, Luedeking–Piret product formation,
   electron-balance oxygen demand, van 't Riet kLa, heat balance, DO cascade). See Derive tab B1–B13. */
import { createStage, studioLights, fitShadow, ensureRectAreaLights, THREE, M, makeRoom, makePipe, makeProbe, FlowAlong, canvasTexture, surfaceTextures, RoundedBoxGeometry, disposeDeep } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, BarChart, downloadCSV } from '/assets/js/plot.js';
import { Fermenter, geometry, SCALES, PRODUCTS, HOST, ceilings, chemostat, Y_AIR } from './model.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/* ================================================================== controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
let fer = null, curNmax = 20;

ui.section('Simulation');
const [playBtn, resetBtn] = ui.buttons([
  { label: '▶ Run', variant: 'primary', onClick: () => clock.toggle() },
  { label: '⟲ Reset run', onClick: () => restart() }
]);
ui.segmented({ id: 'speed', label: 'Simulation speed', options: [{ value: 0.5, label: '0.5 h/s' }, { value: 2, label: '2 h/s' }, { value: 6, label: '6 h/s' }], value: 2, help: 'Simulated hours per real second. Space bar = run/pause.' });

ui.section('Process');
ui.segmented({ id: 'scale', label: 'Scale (geometrically similar, H = 2T)', options: [{ value: 'lab', label: '2 L' }, { value: 'pilot', label: '1 m³' }, { value: 'prod', label: '100 m³' }], value: 'lab', help: 'Changing scale also loads that scale’s typical aeration, head pressure and heat-transfer coefficient.' });
ui.segmented({ id: 'mode', label: 'Operating mode', options: [{ value: 'batch', label: 'Batch' }, { value: 'fed', label: 'Fed-batch' }, { value: 'cont', label: 'Continuous' }], value: 'fed' });
ui.slider({ id: 'S0', label: 'Glucose in the medium S₀ (feed S_R when continuous)', min: 5, max: 60, step: 1, value: 20, unit: 'g L⁻¹' });
ui.slider({ id: 'muSet', label: 'Fed-batch set growth rate μ_set', min: 0.02, max: 0.2, step: 0.005, value: 0.10, unit: 'h⁻¹', help: 'Exponential feed of 550 g L⁻¹ glucose starts when the batch sugar is used up (Eq. B4).' });
ui.slider({ id: 'D', label: 'Dilution rate D (continuous)', min: 0.01, max: 0.3, step: 0.005, value: 0.10, unit: 'h⁻¹', help: 'Continuous feed starts after the batch phase. Washout when D exceeds D_crit ≈ µ_max.' });
ui.toggle({ id: 'limiter', label: 'Feed protection (throttle feed if DO < 15 % or T rises)', value: true });

ui.section('Host & product · K. phaffii, GAP promoter');
ui.select({ id: 'product', label: 'Secreted product', options: [{ value: 'fab', label: 'Fab fragment — Maurer et al. (2006) strain' }, { value: 'food', label: 'Food protein — hypothetical strain, ×100 q_P' }], value: 'fab' });
ui.slider({ id: 'muMax', label: 'Maximum specific growth rate μ_max', min: 0.05, max: 0.4, step: 0.005, value: HOST.muMax, unit: 'h⁻¹' });
ui.slider({ id: 'Yxs', label: 'True biomass yield Y_X/S', min: 0.3, max: 0.7, step: 0.005, value: HOST.Yxs, unit: 'g g⁻¹' });
ui.slider({ id: 'ms', label: 'Maintenance coefficient m_S', min: 0, max: 0.05, step: 0.0005, value: HOST.ms, unit: 'g g⁻¹ h⁻¹', digits: 4 });

ui.section('Oxygen supply');
ui.segmented({ id: 'doMode', label: 'Dissolved-oxygen control', options: [{ value: 'cascade', label: 'Cascade (auto)' }, { value: 'manual', label: 'Manual speed' }], value: 'cascade', help: 'Cascade: stirrer speed first, then O₂ enrichment (if enabled).' });
ui.slider({ id: 'DOsp', label: 'DO set-point', min: 5, max: 60, step: 1, value: 30, unit: '% air sat.' });
ui.slider({ id: 'Nman', label: 'Manual stirrer speed', min: 10, max: 100, step: 1, value: 40, unit: '', format: v => `${Math.round(v)} % of max (${Math.round(v / 100 * curNmax * 60)} rpm)` });
ui.slider({ id: 'pvMax', label: 'Maximum ungassed power input P/V', min: 0.5, max: 10, step: 0.1, value: 3, unit: 'kW m⁻³', help: 'Sets the top stirrer speed at every scale (constant-P/V scale-up).' });
ui.slider({ id: 'vvm', label: 'Aeration rate', min: 0.1, max: 2, step: 0.05, value: 1.0, unit: 'vvm', help: 'Normal m³ of gas per m³ of broth per minute.' });
ui.toggle({ id: 'enrich', label: 'O₂ enrichment as 2nd cascade stage (to 50 % O₂)', value: true });
ui.slider({ id: 'phead', label: 'Head-space overpressure', min: 0, max: 1.5, step: 0.05, value: 0.1, unit: 'bar(g)' });
ui.segmented({ id: 'broth', label: 'Broth (van ’t Riet correlation)', options: [{ value: 'noncoal', label: 'Salty medium' }, { value: 'coal', label: 'Water-like' }], value: 'noncoal', help: 'Salts suppress bubble coalescence → higher k_La at the same power (Eq. B10).' });

ui.section('Heat removal');
ui.slider({ id: 'Tset', label: 'Temperature set-point', min: 20, max: 35, step: 0.5, value: 25, unit: '°C', help: 'Kinetics are for 25 °C (Maurer et al. 2006); here T changes only O₂ solubility and cooling ΔT.' });
ui.slider({ id: 'Tcw', label: 'Cooling-water inlet temperature', min: 4, max: 24, step: 0.5, value: 15, unit: '°C' });
ui.slider({ id: 'U', label: 'Overall heat-transfer coefficient U', min: 100, max: 1000, step: 10, value: 250, unit: 'W m⁻² K⁻¹' });
ui.slider({ id: 'coil', label: 'Extra cooling surface (coils / external loop)', min: 0, max: 3, step: 0.05, value: 0, unit: 'm² m⁻³' });
ui.toggle({ id: 'antifoam', label: 'Automatic antifoam dosing', value: true });

ui.section('View');
ui.toggle({ id: 'labels', label: 'Component labels', value: true });
ui.toggle({ id: 'cut', label: 'Cut-away (steel vessels)', value: true });
ui.buttons([
  { label: 'Overview', onClick: () => fly('home') }, { label: 'Impellers', onClick: () => fly('imp') },
  { label: 'Head & drive', onClick: () => fly('head') }, { label: 'Probes', onClick: () => fly('probes') }
]);
let applyingPreset = false;
const PRESETS = [
  { label: 'Lab batch (2 L)', title: 'A classic batch: exponential growth until the glucose runs out', values: { scale: 'lab', mode: 'batch', S0: 20, doMode: 'cascade', DOsp: 30, pvMax: 3, vvm: 1, phead: 0.1, enrich: true, U: 250, coil: 0, Tcw: 15, Tset: 25, product: 'fab', muMax: 0.2, Yxs: 0.559, ms: 0.0161 } },
  { label: 'Lab fed-batch to ~100 g L⁻¹', title: 'High-cell-density fed-batch: agitation, then O₂ enrichment keep DO at set-point', values: { scale: 'lab', mode: 'fed', S0: 20, muSet: 0.1, doMode: 'cascade', DOsp: 30, pvMax: 3, vvm: 1, phead: 0.1, enrich: true, U: 250, coil: 0, Tcw: 15, Tset: 25, limiter: true } },
  { label: 'O₂ crash (manual 40 %)', title: 'Fixed stirrer speed: the culture becomes oxygen-limited', values: { scale: 'lab', mode: 'batch', S0: 20, doMode: 'manual', Nman: 40, vvm: 1, enrich: false } },
  { label: 'Chemostat washout', title: 'Continuous culture at D above µ_max', values: { scale: 'lab', mode: 'cont', S0: 20, D: 0.22, doMode: 'cascade' } },
  { label: '100 m³ fed-batch (heat-limited)', title: 'Same recipe at production scale: the jacket cannot remove the heat', values: { scale: 'prod', mode: 'fed', S0: 20, muSet: 0.1, doMode: 'cascade', DOsp: 30, pvMax: 3, vvm: 0.4, phead: 0.5, enrich: true, U: 500, coil: 0, Tcw: 15, Tset: 25, limiter: true } },
  { label: '100 m³ with coils + chilled water', title: 'Add 1.5 m² m⁻³ of coils and 6 °C chilled water', values: { scale: 'prod', mode: 'fed', S0: 20, muSet: 0.1, doMode: 'cascade', pvMax: 3, vvm: 0.4, phead: 0.5, enrich: true, U: 500, coil: 1.5, Tcw: 6, Tset: 25, limiter: true } }
];
ui.presets(PRESETS.map(p => Object.assign({}, p, { onApply: () => { applyingPreset = false; rebuildIfNeeded(); restart(); } })));
document.querySelectorAll('#controls .presets button').forEach(b => b.addEventListener('pointerdown', () => { applyingPreset = true; }, true));
ui.saveButton('bioreactor', () => Object.assign({ time_h: +fer.s.t.toFixed(2) }, ro.values()));
ui.button({ label: 'Download time series (CSV)', onClick: () => downloadHistory() });

ro.add({ id: 'X', label: 'Biomass X', unit: 'g L⁻¹', digits: 1 })
  .add({ id: 'S', label: 'Glucose S', unit: 'g L⁻¹', digits: 2 })
  .add({ id: 'P', label: 'Product titre P', unit: '', format: v => v })
  .add({ id: 'DO', label: 'Dissolved O₂', unit: '% air sat.', digits: 0 })
  .add({ id: 'N', label: 'Stirrer speed', unit: 'rpm', digits: 0 })
  .add({ id: 'kla', label: 'k_La (van ’t Riet)', unit: 'h⁻¹', digits: 0 })
  .add({ id: 'our', label: 'O₂ uptake rate OUR', unit: 'mmol L⁻¹ h⁻¹', digits: 0 })
  .add({ id: 'heat', label: 'Heat load (metabolism + stirrer)', unit: '', format: v => fmtW(v) })
  .add({ id: 'T', label: 'Broth temperature', unit: '°C', digits: 1 })
  .add({ id: 'gas', label: 'Exhaust-gas O₂', unit: '%', digits: 1 })
  .add({ id: 'mu', label: 'Specific growth rate μ', unit: 'h⁻¹', digits: 3 })
  .add({ id: 'sty', label: 'Biomass space–time yield', unit: 'g L⁻¹ h⁻¹', digits: 2 })
  .add({ id: 'tip', label: 'Impeller tip speed', unit: 'm s⁻¹', digits: 2 });

const hud = hudChips(document.getElementById('stage'));

/* ================================================================== model */
const params = () => { const v = ui.values(); return Object.assign({}, v, { X0: 0.2, tEnd: v.mode === 'cont' ? 200 : 150, alphaF: 1 }); };
fer = new Fermenter(params()); fer.setParams(params());
curNmax = fer.sr.Nmax;

/* ================================================================== stage */
const stage = createStage('#stage', {
  background: '#11171a', envIntensity: 0.6, exposure: 1.0,
  camera: { pos: [0.62, 1.32, 0.78], target: [0, 1.07, 0], fov: 38 },
  controls: { minDistance: 0.15, maxDistance: 80, maxPolarAngle: Math.PI * 0.49 },
  bloom: { strength: 0.35, radius: 0.4, threshold: 1.0 }, ao: { radius: 0.06, intensity: 0.85 }
});
const { scene } = stage;
const lights = studioLights(stage, { intensity: 1.0, shadowSize: 1.2, keyPos: [2.5, 5, 3] });
const inspector = document.createElement('div'); inspector.className = 'stage-legend'; inspector.style.cssText = 'max-width:320px;display:none;line-height:1.5'; stage.el.appendChild(inspector);

/* ------------------------------------------------------------------ materials */
const matSteel = M.steel();
const matSteelPol = new THREE.MeshStandardMaterial({ color: 0xc9ced3, metalness: 1, roughness: 0.2 });
const matSteelIn = new THREE.MeshStandardMaterial({ color: 0xb8bec4, metalness: 0.9, roughness: 0.32, side: THREE.BackSide });
const matGlass = new THREE.MeshPhysicalMaterial({ color: 0xf2fbff, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.03 });
const matCoolant = new THREE.MeshPhysicalMaterial({ color: 0x5aa6d6, roughness: 0.05, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 });
const matSilicone = new THREE.MeshPhysicalMaterial({ color: 0xe9e4d8, roughness: 0.3, transparent: true, opacity: 0.55, clearcoat: 0.6 });
const matBlackPl = M.plasticBlack(), matWhitePl = M.plasticWhite(), matGreyPl = M.plasticGrey();
const matBlue = M.paintedSteel(0x3a5f86), matYellow = M.paintedSteel(0xe0b21a), matMotor = M.paintedSteel(0x5a6d7e);
const matClad = new THREE.MeshStandardMaterial({ color: 0xd4d8dc, metalness: 0.85, roughness: 0.38, roughnessMap: surfaceTextures({ key: 'br-clad', size: 128, scale: 2, octaves: 2, palette: ['#ccc', '#ddd'], roughBase: 0.4, roughVar: 0.2, stripes: 10, stripeDepth: 0.3 }).rough });
const brothMat = new THREE.MeshPhysicalMaterial({ color: 0xe9dfb0, roughness: 0.3, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, clearcoat: 0.4 });
const waveN = surfaceTextures({ key: 'br-wave', size: 256, scale: 5, octaves: 4, palette: ['#888', '#999'], normalStrength: 1.6 }).normal.clone(); waveN.wrapS = waveN.wrapT = THREE.RepeatWrapping; waveN.needsUpdate = true;
const surfMat = new THREE.MeshPhysicalMaterial({ color: 0xe9dfb0, roughness: 0.12, transparent: true, opacity: 0.5, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.08, normalMap: waveN, normalScale: new THREE.Vector2(0.6, 0.6) });
const foamSet = surfaceTextures({ key: 'br-foam', size: 256, scale: 40, octaves: 4, palette: ['#e8e0cc', '#f6f1e6', '#fffdf8'], normalStrength: 3.2, roughBase: 0.85, speckle: 0.05 });
const foamMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: foamSet.color, normalMap: foamSet.normal, roughness: 0.9, transparent: true, opacity: 0.96 });
const bubbleMat = new THREE.MeshStandardMaterial({ color: 0xf6fcff, roughness: 0.12, metalness: 0.1, emissive: 0x1b2a33, transparent: true, opacity: 0.85 });
const blurMat = new THREE.MeshBasicMaterial({ color: 0xcfd5da, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });

/* ------------------------------------------------------------------ small builders */
const cyl = (rt, rb, h, mat, seg = 32, open = false, ts = 0, tl = Math.PI * 2) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, ts, tl), mat);
const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
const shadowAll = (o, cast = true) => o.traverse(m => { if (m.isMesh && !m.material.transparent) { m.castShadow = cast; m.receiveShadow = true; } });
function tag(obj, comp) { obj.traverse(m => { m.userData.comp = comp; }); pickables.push(obj); }
/** Elliptical (2:1) head profile as lathe points (r, y) from the axis to the rim, y ≤ 0 (bottom) or ≥ 0 (top). */
function headProfile(R, h, n = 18, top = false) { const pts = []; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(1e-4, R * Math.sin(a)), (top ? 1 : -1) * h * Math.cos(a))); } return top ? pts.reverse() : pts; }
function rushton(D, mat) {
  const g = new THREE.Group();
  g.add(cyl(0.375 * D, 0.375 * D, Math.max(0.0012, 0.02 * D), mat, 40));
  g.add(cyl(0.1 * D, 0.1 * D, 0.22 * D, mat, 24));
  for (let k = 0; k < 6; k++) { const b = box(0.25 * D, 0.2 * D, Math.max(0.001, 0.016 * D), mat); const a = k * Math.PI / 3; b.position.set(Math.cos(a) * 0.375 * D, 0, Math.sin(a) * 0.375 * D); b.rotation.y = -a; g.add(b); }
  const blur = cyl(0.5 * D, 0.5 * D, 0.2 * D, blurMat, 48, true); blur.visible = false; g.add(blur); g.blur = blur;
  shadowAll(g); return g;
}
/** A very simple architectural scale figure (1.75 m). */
function scaleFigure(color = 0x8d949b) {
  const g = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.72, 4, 10), m); legL.position.set(-0.1, 0.43, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.1; g.add(legR);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.42, 4, 12), m); torso.position.y = 1.12; torso.scale.z = 0.62; g.add(torso);
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.56, 4, 8), m); armL.position.set(-0.27, 1.1, 0); armL.rotation.z = 0.08; g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.27; armR.rotation.z = -0.08; g.add(armR);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 16), m); head.position.y = 1.6; g.add(head);
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.plastic(0xf2c230, 0.4)); hat.position.y = 1.63; g.add(hat);
  shadowAll(g); return g;
}
/** Text plate (e.g., vessel nameplate) as a canvas texture. */
function plate(lines, w = 0.3, h = 0.12, bg = '#e8eaec', fg = '#1d2226') {
  const tex = canvasTexture(512, Math.round(512 * h / w), (ctx, W, H) => { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = '#8a9096'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, W - 12, H - 12); ctx.fillStyle = fg; lines.forEach((l, i) => { ctx.font = `${i ? 500 : 700} ${i ? 34 : 44}px Inter, sans-serif`; ctx.fillText(l, 26, 62 + i * 48); }); });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.3 }));
}

/* ------------------------------------------------------------------ bubbles swirling in a stirred tank */
class SwirlBubbles {
  constructor(max) {
    this.max = max; this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), bubbleMat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.p = []; this.acc = 0; this.m4 = new THREE.Matrix4();
  }
  configure(c) { this.c = c; this.p.length = 0; }
  update(dt, rate, omega, level, size) {
    const c = this.c; if (!c) return;
    this.acc += dt * rate;
    while (this.acc > 1 && this.p.length < this.max) { this.acc -= 1; this.p.push({ a: Math.random() * 6.283, r: c.rSp * (0.9 + Math.random() * 0.2), y: c.ySp, s: 0, k: 0.6 + Math.random() * 0.8, w: Math.random() * 6 }); }
    if (this.acc > 1) this.acc = 0;
    const vr = c.vRise, R = c.R, n = this.p.length;
    let j = 0;
    for (let i = 0; i < n; i++) {
      const b = this.p[i];
      if (b.s === 0) { b.y += vr * dt; if (b.y > c.yImp[0] - 0.08 * c.D) b.s = 1; }
      else if (b.s === 1) { b.r += (0.25 + 1.4 * omega * c.D) * dt * b.k; b.a += omega * dt * 0.6; b.y += (Math.random() - 0.45) * vr * dt; if (b.r > 0.86 * R) b.s = 2; }
      else { b.y += vr * dt * (0.75 + 0.5 * b.k); b.a += omega * dt * 0.18 * (0.6 + 0.4 * Math.sin(b.w + b.y)); b.r = Math.min(0.93 * R, Math.max(0.15 * R, b.r + (Math.random() - 0.5) * 0.25 * R * dt)); b.w += dt * 3;
        if (Math.abs(b.y - c.yImp[1]) < 0.05 * c.D && b.r < 0.6 * R && Math.random() < 0.5) b.s = 1; }
      if (b.y >= level) continue;
      this.p[j++] = b;
    }
    this.p.length = j;
    let k = 0;
    for (const b of this.p) { const sz = size * b.k; this.m4.makeScale(sz, sz * 0.86, sz).setPosition(Math.cos(b.a) * b.r, b.y, Math.sin(b.a) * b.r); this.mesh.setMatrixAt(k++, this.m4); }
    this.mesh.count = k; this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ scene state */
const root = new THREE.Group(); scene.add(root);
let pickables = [], parts = null, builtScale = null, builtCut = null;
const labelObjs = [];
function label(obj, html, offset = [0, 0, 0], cls = 'label3d') { const l = stage.addLabel(obj, html, { offset, className: cls }); labelObjs.push(l); l.visible = !!ui.get('labels'); return l; }
// a still point at a moving part (the impellers spin), so its label stays put instead of orbiting with it
function fixedAt(obj) { const a = new THREE.Object3D(); a.position.copy(obj.position); obj.parent.add(a); return a; }

/* ------------------------------------------------------------------ broth (liquid volume with optional cut-away) */
function makeBroth(R, hd, sector) {
  const g = new THREE.Group();
  const ts = sector ? sector[0] : 0, tl = sector ? sector[1] : Math.PI * 2;
  const side = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 1, 64, 1, true, ts, tl), brothMat); side.position.y = 0.5; g.add(side);
  const dish = new THREE.Mesh(new THREE.LatheGeometry(headProfile(R, hd, 16), 64, ts, tl), brothMat); g.add(dish);
  const surf = new THREE.Mesh(new THREE.CircleGeometry(R, 64, ts - Math.PI / 2, tl), surfMat); surf.rotation.x = -Math.PI / 2; g.add(surf);
  const foam = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.995, R * 0.995, 1, 64, 1, false, ts, tl), foamMat); foam.visible = false; g.add(foam);
  const cuts = [];
  if (sector) [ts, ts + tl].forEach(a => { const m = new THREE.Mesh(new THREE.PlaneGeometry(R, 1), brothMat); m.userData.a = a; g.add(m); cuts.push(m); });
  let lastH = -1;
  g.setLevel = (H, foamH) => {
    if (Math.abs(H - lastH) > 1e-4 * R) {
      side.scale.y = Math.max(1e-4, H); side.position.y = H / 2;
      cuts.forEach(m => { m.scale.y = Math.max(1e-4, H); const a = m.userData.a; m.position.set(Math.sin(a) * R / 2, H / 2, Math.cos(a) * R / 2); m.rotation.y = a - Math.PI / 2; });
      surf.position.y = H + 0.0005 * R; lastH = H;
    }
    foam.visible = foamH > 0.002 * R; foam.scale.y = Math.max(1e-4, foamH); foam.position.y = H + foamH / 2;
  };
  g.surf = surf; g.foam = foam;
  return g;
}

/* ------------------------------------------------------------------ the three scale sets */
function clearScene() { labelObjs.forEach(l => { l.parent && l.parent.remove(l); l.element && l.element.remove(); }); labelObjs.length = 0; root.children.slice().forEach(c => { root.remove(c); disposeDeep(c); }); pickables = []; }

function buildLab(g) {
  const P = {}; const R = g.T / 2, hd = 0.1 * g.T; const benchY = 0.9;
  const room = makeRoom({ w: 6, d: 5, h: 2.9, wallColor: 0x39424a, floor: 'epoxy' }); room.floor.material.color.set(0x5d6468); room.position.z = -1.0; root.add(room);
  // lab ceiling light panel (area light) + cool rim light for glass highlights
  ensureRectAreaLights();
  const panel = new THREE.RectAreaLight(0xf4f8ff, 3.2, 1.4, 0.5); panel.position.set(0.1, 2.1, 0.1); panel.lookAt(0.1, 0, 0.1); root.add(panel);
  const panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.5), new THREE.MeshBasicMaterial({ color: 0xf4f8ff })); panelMesh.rotation.x = Math.PI / 2; panelMesh.position.set(0.1, 2.12, 0.1); root.add(panelMesh);
  const rim = new THREE.DirectionalLight(0xcfe4ff, 1.4); rim.position.set(-1.2, 1.9, -2.2); root.add(rim);
  // bench: black phenolic-resin top on a white steel frame with cabinets
  const bench = new THREE.Group(); root.add(bench);
  const top = new THREE.Mesh(new RoundedBoxGeometry(2.0, 0.03, 0.85, 2, 0.006), M.plastic(0x202326, 0.28)); top.position.set(0, benchY - 0.015, -0.15); bench.add(top);
  [[-0.95, -0.52], [0.95, -0.52], [-0.95, 0.22], [0.95, 0.22]].forEach(([x, z]) => { const l = box(0.05, benchY - 0.03, 0.05, M.paintedSteel(0xd9dcdc)); l.position.set(x, (benchY - 0.03) / 2, z); bench.add(l); });
  const cab = box(0.8, 0.62, 0.66, M.paintedSteel(0xe9ecea)); cab.position.set(-0.5, 0.35, -0.2); bench.add(cab);
  for (let k = 0; k < 2; k++) { const h = box(0.16, 0.012, 0.012, matSteel); h.position.set(-0.7 + k * 0.4, 0.6, 0.135); bench.add(h); }
  const back = box(2.0, 0.5, 0.02, M.paintedSteel(0x4a545b)); back.position.set(0, benchY + 0.25, -0.58); bench.add(back);
  for (let k = 0; k < 4; k++) { const sock = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.06, 0.02, 2, 0.006), matWhitePl); sock.position.set(-0.7 + k * 0.45, benchY + 0.2, -0.565); bench.add(sock); }
  shadowAll(bench);
  // vessel stand (stainless tripod ring) — the "skid" of a lab fermenter
  const baseY = benchY + 0.035 + hd;
  const vessel = new THREE.Group(); vessel.position.y = baseY; root.add(vessel); P.vessel = vessel;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.12, 0.004, 10, 48), matSteelPol); ring.rotation.x = Math.PI / 2; ring.position.y = -hd * 0.4; vessel.add(ring);
  for (let k = 0; k < 3; k++) { const a = k * 2.094 + 0.5; const leg = cyl(0.004, 0.004, hd + 0.035, matSteelPol, 10); leg.position.set(Math.cos(a) * R * 1.12, -hd * 0.4 - (hd + 0.035) / 2 + 0.002, Math.sin(a) * R * 1.12); vessel.add(leg); const foot = cyl(0.012, 0.012, 0.006, M.rubber(), 16); foot.position.set(leg.position.x, -hd - 0.032, leg.position.z); vessel.add(foot); }
  // glass vessel with a glass cooling jacket over the lower 80 %
  const Hv = g.Hv;
  const wallO = cyl(R + 0.003, R + 0.003, Hv, matGlass, 64, true); wallO.position.y = Hv / 2; vessel.add(wallO);
  const wallI = cyl(R, R, Hv, matGlass, 64, true); wallI.position.y = Hv / 2; vessel.add(wallI);
  const bottom = new THREE.Mesh(new THREE.LatheGeometry(headProfile(R + 0.003, hd, 16), 64), matGlass); vessel.add(bottom);
  const Hj = 0.8 * Hv, Rj = R + 0.016;
  const jac = cyl(Rj, Rj, Hj, matGlass, 64, true); jac.position.y = Hj / 2 - hd * 0.3; vessel.add(jac);
  const cool = cyl(Rj - 0.004, Rj - 0.004, Hj - 0.01, matCoolant, 64, true); cool.position.y = Hj / 2 - hd * 0.3; vessel.add(cool);
  const jacB = new THREE.Mesh(new THREE.LatheGeometry(headProfile(Rj, hd * 1.2, 16), 64), matGlass); jacB.position.y = -hd * 0.3; vessel.add(jacB);
  [Hj - hd * 0.3, Hv - 0.004].forEach(y => { const r = new THREE.Mesh(new THREE.TorusGeometry(y > Hj ? R + 0.004 : Rj, 0.0028, 8, 64), matGlass); r.rotation.x = Math.PI / 2; r.position.y = y; vessel.add(r); });
  const nzIn = cyl(0.005, 0.005, 0.03, matGlass, 12); nzIn.rotation.x = Math.PI / 2; nzIn.position.set(0, 0.02, -Rj - 0.012); vessel.add(nzIn);
  const nzOut = nzIn.clone(); nzOut.position.y = Hj - hd * 0.5 - 0.03; vessel.add(nzOut);
  tag(jac, 'jacket'); tag(cool, 'jacket');
  // head plate with clamp ring, bolts and knurled knobs
  const hp = new THREE.Group(); hp.position.y = Hv; vessel.add(hp); P.head = hp;
  const hpDisc = cyl(R + 0.022, R + 0.022, 0.012, matSteelPol, 64); hpDisc.position.y = 0.006; hp.add(hpDisc);
  const clampR = new THREE.Mesh(new THREE.TorusGeometry(R + 0.012, 0.005, 10, 64), matSteel); clampR.rotation.x = Math.PI / 2; clampR.position.y = -0.004; hp.add(clampR);
  const m4 = new THREE.Matrix4();
  const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.03, 10), matSteelPol, 8);
  const knobs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.007, 0.007, 0.008, 12), matBlackPl, 8);
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + 0.2; m4.makeTranslation(Math.cos(a) * (R + 0.017), 0.004, Math.sin(a) * (R + 0.017)); bolts.setMatrixAt(k, m4); m4.makeTranslation(Math.cos(a) * (R + 0.017), 0.022, Math.sin(a) * (R + 0.017)); knobs.setMatrixAt(k, m4); }
  hp.add(bolts, knobs);
  // small ports: septum, sample, gas-in
  [[1.2, 0.006], [2.6, 0.005], [4.0, 0.006], [5.3, 0.005]].forEach(([a, r]) => { const p = cyl(r, r, 0.022, matSteelPol, 16); p.position.set(Math.cos(a) * R * 0.78, 0.022, Math.sin(a) * R * 0.78); hp.add(p); });
  shadowAll(hp); tag(hp, 'head');
  // motor + coupling
  const motor = new THREE.Group(); motor.position.y = Hv + 0.012; vessel.add(motor);
  const coup = cyl(0.012, 0.012, 0.03, matSteelPol, 20); coup.position.y = 0.015; motor.add(coup);
  const mb = cyl(0.03, 0.03, 0.1, M.plastic(0x2a2e33, 0.35), 32); mb.position.y = 0.08; motor.add(mb);
  const mcap = cyl(0.031, 0.031, 0.012, M.anodised(), 32); mcap.position.y = 0.136; motor.add(mcap);
  const stripe = cyl(0.0305, 0.0305, 0.006, M.plastic(0x2d7a4f, 0.3), 32); stripe.position.y = 0.05; motor.add(stripe);
  motor.add(makePipe([[0, 0.14, 0.02], [0.02, 0.2, 0.06], [0.2, 0.2, -0.05], [0.36, 0.05, -0.2]], { radius: 0.003, material: matBlackPl, tension: 0.4 }));
  shadowAll(motor); tag(motor, 'motor'); P.motor = motor;
  // probes through the head plate (DO, pH, Pt100) and a sampling tube
  const probes = new THREE.Group(); vessel.add(probes); P.probes = probes;
  const probeLen = Hv * 0.72;
  [['DO', 0x2f6fd6, 'steel', 2.1], ['pH', 0x2c9a5a, 'glass', 3.2], ['T', 0xd8452f, 'steel', 4.6]].forEach(([k, c, tip, a]) => {
    const p = makeProbe({ length: probeLen, radius: 0.0055, cap: c, tip }); p.position.set(Math.cos(a) * R * 0.6, Hv - probeLen * 0.88, Math.sin(a) * R * 0.6); probes.add(p); tag(p, 'probe-' + k); P['probe' + k] = p;
  });
  const samp = cyl(0.0025, 0.0025, Hv * 0.9, matSteelPol, 10); samp.position.set(Math.cos(5.6) * R * 0.55, Hv * 0.56, Math.sin(5.6) * R * 0.55); vessel.add(samp);
  // exhaust condenser: glass column with a cooling coil and a vent filter
  const cond = new THREE.Group(); cond.position.set(Math.cos(0.7) * R * 0.55, Hv + 0.012, Math.sin(0.7) * R * 0.55); vessel.add(cond);
  const cg = cyl(0.012, 0.012, 0.16, matGlass, 24, true); cg.position.y = 0.08; cond.add(cg);
  const coilPts = []; for (let i = 0; i <= 120; i++) { const t = i / 120; coilPts.push([Math.cos(t * 44) * 0.0075, 0.015 + t * 0.13, Math.sin(t * 44) * 0.0075]); }
  cond.add(makePipe(coilPts, { radius: 0.0012, material: matGlass, tension: 0.5, segments: 360, radial: 6 }));
  const ctop = cyl(0.014, 0.014, 0.02, matSteelPol, 20); ctop.position.y = 0.17; cond.add(ctop);
  const filt = cyl(0.016, 0.016, 0.05, matWhitePl, 24); filt.position.set(0, 0.215, 0); cond.add(filt);
  shadowAll(cond); tag(cond, 'condenser'); P.cond = cond;
  // internals & broth
  P.internals = buildInternals(g, vessel, hd, M.steel(), null);
  P.broth = makeBroth(R - 0.0008, hd * 0.98, null); vessel.add(P.broth); tag(P.broth, 'broth');
  // control tower (right, behind): touch screen, three peristaltic pumps, chiller inside
  const tower = new THREE.Group(); tower.position.set(0.42, benchY, -0.28); tower.rotation.y = -0.45; root.add(tower); P.tower = tower;
  const tb = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.46, 0.3, 3, 0.02), matWhitePl); tb.position.y = 0.23; tower.add(tb);
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.16, 0.01, 2, 0.006), matBlackPl); bezel.position.set(0, 0.35, 0.152); tower.add(bezel);
  const scrCanvas = document.createElement('canvas'); scrCanvas.width = 512; scrCanvas.height = 320; const scrTex = new THREE.CanvasTexture(scrCanvas); scrTex.colorSpace = THREE.SRGBColorSpace;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.1375), new THREE.MeshStandardMaterial({ map: scrTex, emissive: 0xffffff, emissiveMap: scrTex, emissiveIntensity: 0.85, roughness: 0.25 })); scr.position.set(0, 0.35, 0.1576); tower.add(scr);
  P.screen = { canvas: scrCanvas, tex: scrTex };
  P.pumps = [];
  ['feed', 'base', 'antifoam'].forEach((k, i) => {
    const ph = new THREE.Group(); ph.position.set(-0.09 + i * 0.09, 0.15, 0.152); tower.add(ph);
    const housing = cyl(0.032, 0.032, 0.026, matGreyPl, 32); housing.rotation.x = Math.PI / 2; ph.add(housing);
    const rotor = new THREE.Group(); rotor.position.z = 0.015; ph.add(rotor);
    const hub = cyl(0.011, 0.011, 0.012, matSteelPol, 20); hub.rotation.x = Math.PI / 2; rotor.add(hub);
    for (let r = 0; r < 3; r++) { const a = r * 2.094; const roll = cyl(0.0065, 0.0065, 0.012, matWhitePl, 16); roll.rotation.x = Math.PI / 2; roll.position.set(Math.cos(a) * 0.02, Math.sin(a) * 0.02, 0); rotor.add(roll); const arm = box(0.022, 0.004, 0.006, matSteelPol); arm.position.set(Math.cos(a) * 0.01, Math.sin(a) * 0.01, 0); arm.rotation.z = a; rotor.add(arm); }
    const lid = cyl(0.033, 0.033, 0.004, new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false }), 32); lid.rotation.x = Math.PI / 2; lid.position.z = 0.024; ph.add(lid);
    const lbl = plate([k === 'feed' ? 'FEED' : k === 'base' ? 'BASE' : 'AF'], 0.05, 0.016, '#e8eaec', '#26303a'); lbl.position.set(0, -0.045, 0.002); ph.add(lbl);
    shadowAll(ph); tag(ph, 'pump-' + k); P.pumps.push(rotor); P['pump' + k] = ph;
  });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.005, 12, 8), M.emissive(0x33ff88, 3)); led.position.set(0.12, 0.44, 0.152); tower.add(led);
  shadowAll(tower); tag(tb, 'tower');
  // bottles (feed, base, antifoam) on the left
  const bottle = (x, z, cap, liq, h = 0.2, r = 0.05) => {
    const b = new THREE.Group(); b.position.set(x, benchY, z); root.add(b);
    const glass = cyl(r, r, h, matGlass, 32, true); glass.position.y = h / 2; b.add(glass);
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), matGlass); shoulder.scale.y = 0.45; shoulder.position.y = h; b.add(shoulder);
    const neck = cyl(0.022, 0.022, 0.02, matGlass, 20, true); neck.position.y = h + r * 0.45 + 0.008; b.add(neck);
    const c = cyl(0.026, 0.026, 0.026, M.plastic(cap, 0.4), 24); c.position.y = h + r * 0.45 + 0.03; b.add(c);
    const l = cyl(r * 0.96, r * 0.96, 1, new THREE.MeshPhysicalMaterial({ color: liq, transparent: true, opacity: 0.6, roughness: 0.1, depthWrite: false }), 32); l.position.y = 0.5; b.add(l);
    b.setLevel = f => { l.scale.y = Math.max(0.001, f * h * 0.95); l.position.y = l.scale.y / 2 + 0.003; };
    b.setLevel(0.8); shadowAll(b); return b;
  };
  P.feedBottle = bottle(-0.3, -0.12, 0x2d6fd0, 0xf1e19a, 0.2, 0.052); tag(P.feedBottle, 'feed');
  P.baseBottle = bottle(-0.42, -0.3, 0x2d6fd0, 0xeef4ff, 0.14, 0.036);
  P.afBottle = bottle(-0.27, -0.33, 0x2d6fd0, 0xf6f2f0, 0.12, 0.03);
  // silicone tubing: bottles → pump heads → head plate
  const hpy = baseY + Hv + 0.022;
  const pumpW = i => { const v = new THREE.Vector3(-0.09 + i * 0.09, 0.15, 0.2); v.applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.45); return [v.x + 0.42, v.y + benchY, v.z - 0.28]; };
  const tubes = [
    [[-0.3, benchY + 0.25, -0.12], [-0.18, benchY + 0.42, -0.25], [0.2, benchY + 0.3, -0.2], pumpW(0)],
    [pumpW(0), [0.24, benchY + 0.36, 0.0], [0.08, hpy + 0.08, 0.02], [Math.cos(1.2) * R * 0.78, hpy, Math.sin(1.2) * R * 0.78]],
    [[-0.42, benchY + 0.18, -0.3], [-0.1, benchY + 0.5, -0.32], pumpW(1)],
    [[-0.27, benchY + 0.16, -0.33], [0.05, benchY + 0.46, -0.36], pumpW(2)]
  ];
  tubes.forEach(pts => root.add(makePipe(pts, { radius: 0.0024, material: matSilicone, tension: 0.4 })));
  // coolant hoses from the jacket (back) to the chiller in the tower, with flow particles
  const jIn = new THREE.Vector3(0, baseY + 0.02, -Rj - 0.028), jOut = new THREE.Vector3(0, baseY + Hj - hd * 0.5 - 0.03, -Rj - 0.028);
  const hose1 = makePipe([jIn.toArray(), [0.05, benchY + 0.02, -0.14], [0.2, benchY + 0.03, -0.3], [0.32, benchY + 0.06, -0.36]], { radius: 0.0045, material: matSilicone, tension: 0.4 });
  const hose2 = makePipe([jOut.toArray(), [0.08, baseY + Hj * 0.9, -0.15], [0.22, benchY + 0.34, -0.33], [0.33, benchY + 0.3, -0.39]], { radius: 0.0045, material: matSilicone, tension: 0.4 });
  root.add(hose1, hose2);
  P.flows = [new FlowAlong(hose1.curve, { count: 30, speed: 0.1, size: 0.008, color: 0x6fc3ff }), new FlowAlong(hose2.curve, { count: 30, speed: 0.1, size: 0.008, color: 0x9fd8ff })];
  P.flows.forEach(f => root.add(f.points));
  // off-gas analyser (far left) + exhaust line
  const ana = new THREE.Group(); ana.position.set(-0.56, benchY, -0.36); ana.rotation.y = 0.35; root.add(ana);
  const ab = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.11, 0.2, 2, 0.01), M.plastic(0x3a4046, 0.45)); ab.position.y = 0.055; ana.add(ab);
  const anaCanvas = document.createElement('canvas'); anaCanvas.width = 256; anaCanvas.height = 96; const anaTex = new THREE.CanvasTexture(anaCanvas); anaTex.colorSpace = THREE.SRGBColorSpace;
  const ad = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.056), new THREE.MeshStandardMaterial({ map: anaTex, emissive: 0xffffff, emissiveMap: anaTex, emissiveIntensity: 0.9 })); ad.position.set(0, 0.062, 0.101); ana.add(ad);
  P.ana = { canvas: anaCanvas, tex: anaTex, group: ana }; shadowAll(ana); tag(ana, 'offgas');
  const exh = makePipe([[Math.cos(0.7) * R * 0.55, baseY + Hv + 0.26, Math.sin(0.7) * R * 0.55], [0.0, baseY + Hv + 0.3, -0.2], [-0.4, benchY + 0.3, -0.36], [-0.6, benchY + 0.1, -0.42]], { radius: 0.0026, material: matSilicone, tension: 0.4 });
  root.add(exh); P.gasFlow = new FlowAlong(exh.curve, { count: 24, speed: 0.12, size: 0.006, color: 0xe8f4ff }); root.add(P.gasFlow.points);
  // labels (a few; click components for the rest)
  label(P.motor, 'Motor<small>—</small>', [0.1, 0.05, 0.03]); P.lblMotor = labelObjs[labelObjs.length - 1];
  label(P.probeDO, 'DO probe<small>—</small>', [-0.1, probeLen * 0.97, 0.03]); P.lblDO = labelObjs[labelObjs.length - 1];
  label(fixedAt(P.internals.imp[1]), 'Rushton turbines<small>—</small>', [0.17, 0.0, 0.05]); P.lblImp = labelObjs[labelObjs.length - 1];
  label(P.internals.sparger, 'Ring sparger<small>—</small>', [-0.15, -0.035, 0.08]); P.lblSp = labelObjs[labelObjs.length - 1];
  label(jac, 'Cooling jacket<small>—</small>', [0.16, -Hj * 0.36, 0.08]); P.lblJac = labelObjs[labelObjs.length - 1];
  label(P.pumpfeed, 'Feed pump<small>—</small>', [0, 0.075, 0.02]); P.lblFeed = labelObjs[labelObjs.length - 1];
  label(ana, 'Off-gas analyser<small>—</small>', [0, 0.17, 0]); P.lblGas = labelObjs[labelObjs.length - 1];
  lights.key.shadow.camera.far = 20; lights.key.intensity = 1.7; lights.hemi.intensity = 0.22; lights.fill.intensity = 0.25; scene.environmentIntensity = 0.32; stage.renderer.toneMappingExposure = 0.92;
  lights.key.position.set(1.4, 3.2, 1.9); fitShadow(lights.key, 1.0, [0, 1, -0.15]);
  P.views = { home: [[0.4, 1.27, 0.64], [0.0, 1.09, -0.06]], imp: [[0.13, baseY + g.zImp[0] + 0.04, 0.2], [0, baseY + g.zImp[0] - 0.005, 0]], head: [[0.2, baseY + Hv + 0.24, 0.3], [0, baseY + Hv + 0.05, 0]], probes: [[-0.18, baseY + Hv * 0.72, 0.25], [0, baseY + Hv * 0.55, 0]] };
  P.baseY = baseY; P.hd = hd; P.R = R; P.bubbleSize = 0.0016; P.vRise = 0.14; P.extraLights = [panel, rim];
  return P;
}

function buildInternals(g, parent, hd, mat, sector) {
  const R = g.T / 2, D = g.D; const o = { imp: [] };
  const drop = (2 / 3) * hd;                                     // align liquid depths with the flat-bottom model
  // shaft
  const shaft = cyl(Math.max(0.0035, 0.045 * D), Math.max(0.0035, 0.045 * D), g.Hv - 0.25 * g.T + 0.02, mat, 16); shaft.position.y = (g.Hv + 0.25 * g.T) / 2 - drop * 0.5; parent.add(shaft); o.shaft = shaft;
  g.zImp.forEach(z => { const r = rushton(D, mat); r.position.y = z - drop; parent.add(r); o.imp.push(r); tag(r, 'impeller'); });
  // baffles (4 × T/10)
  const bw = g.T / 10, bt = Math.max(0.0012, 0.01 * g.T), gap = g.T / 50;
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4; const b = box(bt, g.HL * 1.08, bw, mat);
    const rr = R - gap - bw / 2; b.position.set(Math.sin(a) * rr, g.HL * 0.54 - drop * 0.3, Math.cos(a) * rr); b.rotation.y = a; parent.add(b); tag(b, 'baffle');
  }
  // ring sparger with feed pipe up the wall
  const sp = new THREE.Mesh(new THREE.TorusGeometry(0.4 * D, Math.max(0.0015, 0.028 * D), 10, 48), mat); sp.rotation.x = Math.PI / 2; sp.position.y = 0.25 * g.T - drop; parent.add(sp); o.sparger = sp; tag(sp, 'sparger');
  const aA = Math.PI * 1.25, rP = R - gap - bw - 0.02 * g.T;
  parent.add(makePipe([[Math.sin(aA) * 0.4 * D, 0.25 * g.T - drop, Math.cos(aA) * 0.4 * D], [Math.sin(aA) * rP * 0.8, 0.25 * g.T - drop, Math.cos(aA) * rP * 0.8], [Math.sin(aA) * rP, 0.3 * g.T - drop, Math.cos(aA) * rP], [Math.sin(aA) * rP, g.Hv + 0.01, Math.cos(aA) * rP]], { radius: Math.max(0.0015, 0.025 * D), material: mat, tension: 0.1 }));
  shadowAll(parent);
  return o;
}

function buildSteel(g, cut) {
  const P = {}; const R = g.T / 2, hd = g.T / 4; const big = g.key === 'prod';
  const s = g.T;                                                    // characteristic size
  const room = makeRoom({ w: big ? 46 : 16, d: big ? 46 : 14, h: big ? 20 : 7, wallColor: 0x8f989d, floor: 'epoxy' }); room.floor.material.color.set(0x80878b); room.floor.material.roughness = 2.2; room.position.z = big ? 0 : -1.2; root.add(room);
  const baseY = (big ? 1.6 : 0.55) + hd;                            // bottom tangent line height
  const vessel = new THREE.Group(); vessel.position.y = baseY; root.add(vessel); P.vessel = vessel;
  const camAz = Math.PI / 4;                                        // camera azimuth (from +z towards +x)
  const open = cut ? 2.1 : 0; const ts = camAz + open / 2, tl = Math.PI * 2 - open;
  const sector = cut ? [ts, tl] : null;
  const Hs = g.Hv;                                                  // straight shell height
  // shell (inner steel), jacket gap with coolant, outer jacket shell, cladding
  const rJ = R + 0.02 * s, rC = R + 0.055 * s;
  const shellO = cyl(R + 0.004 * s, R + 0.004 * s, Hs, matSteelPol, 96, true, ts, tl); shellO.position.y = Hs / 2; vessel.add(shellO);
  const shellI = cyl(R, R, Hs, matSteelIn, 96, true, ts, tl); shellI.position.y = Hs / 2; vessel.add(shellI);
  const Hjac = g.HL * 1.02;
  const coolant = cyl(rJ - 0.004 * s, rJ - 0.004 * s, Hjac, new THREE.MeshStandardMaterial({ color: 0x3f86c4, roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide }), 96, true, ts, tl); coolant.position.y = Hjac / 2; vessel.add(coolant); P.coolant = coolant;
  const cladMat = big ? matClad : matSteelPol;
  const clad = cyl(rC, rC, Hs * 0.985, cladMat, 96, true, ts, tl); clad.position.y = Hs * 0.985 / 2; vessel.add(clad);
  const cladIn = cyl(rC - 0.003 * s, rC - 0.003 * s, Hs * 0.985, new THREE.MeshStandardMaterial({ color: 0xe8e3d0, roughness: 0.95, side: THREE.BackSide }), 96, true, ts, tl); cladIn.position.y = Hs * 0.985 / 2; vessel.add(cladIn);
  // bottom & top heads
  const botO = new THREE.Mesh(new THREE.LatheGeometry(headProfile(rC, hd + (rC - R), 20), 96, ts, tl), cladMat); vessel.add(botO);
  const botI = new THREE.Mesh(new THREE.LatheGeometry(headProfile(R, hd, 20), 96, ts, tl), matSteelIn); vessel.add(botI);
  const topO = new THREE.Mesh(new THREE.LatheGeometry(headProfile(R + 0.004 * s, hd, 20, true), 96, ts, tl), matSteelPol); topO.position.y = Hs; vessel.add(topO);
  const topI = new THREE.Mesh(new THREE.LatheGeometry(headProfile(R, hd * 0.98, 20, true), 96, ts, tl), matSteelIn); topI.position.y = Hs; vessel.add(topI);
  // cut faces: wall sandwich (steel | coolant | jacket | insulation)
  if (cut) [ts, ts + tl].forEach(a => {
    const add = (r0, r1, h, y0, mat) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(r1 - r0, h), mat); m.position.set(Math.sin(a) * (r0 + r1) / 2, y0 + h / 2, Math.cos(a) * (r0 + r1) / 2); m.rotation.y = a - Math.PI / 2; m.material.side = THREE.DoubleSide; vessel.add(m); };
    add(R, R + 0.004 * s, Hs, 0, matSteelPol); add(R + 0.004 * s, rJ, Hjac, 0, new THREE.MeshStandardMaterial({ color: 0x3f86c4, roughness: 0.3, side: THREE.DoubleSide })); add(rJ, rJ + 0.003 * s, Hjac, 0, matSteelPol); add(rJ + 0.003 * s, rC, Hs * 0.985, 0, new THREE.MeshStandardMaterial({ color: 0xe8e3d0, roughness: 0.95, side: THREE.DoubleSide }));
  });
  // cladding bands and weld seams
  const arcRot = Math.PI / 2 - tl - ts;                            // maps the torus arc onto azimuths [ts, ts + tl]
  if (big) for (let k = 1; k < 8; k++) { const b = new THREE.Mesh(new THREE.TorusGeometry(rC + 0.002 * s, 0.0025 * s, 6, 96, tl), matSteel); b.rotation.set(Math.PI / 2, 0, arcRot); b.position.y = Hs * k / 8; vessel.add(b); }
  const seam = new THREE.Mesh(new THREE.TorusGeometry(R + 0.0045 * s, 0.0018 * s, 6, 96, tl), matSteel); seam.rotation.set(Math.PI / 2, 0, arcRot); seam.position.y = Hs; vessel.add(seam);
  shadowAll(vessel); tag(shellO, 'vessel'); tag(clad, 'vessel'); tag(coolant, 'jacket');
  // support: legs (pilot) or skirt (production)
  if (!big) {
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; const leg = cyl(0.035 * s, 0.035 * s, baseY + 0.1 * s, matSteelPol, 16); leg.position.set(Math.sin(a) * rC * 0.98, (baseY + 0.1 * s) / 2 - baseY, Math.cos(a) * rC * 0.98); vessel.add(leg); const pad = box(0.12 * s, 0.015 * s, 0.12 * s, matSteelPol); pad.position.set(leg.position.x, -baseY + 0.0075 * s, leg.position.z); vessel.add(pad); }
  } else {
    const skirt = cyl(rC * 0.92, rC * 0.95, baseY - hd * 0.55, M.paintedSteel(0xcfd2d0), 64, true); skirt.position.y = -(baseY - hd * 0.55) / 2 - hd * 0.55; vessel.add(skirt);
    const door = box(0.9, 1.9, 0.05, M.paintedSteel(0x6b7378)); door.position.set(Math.sin(camAz + 0.9) * rC * 0.95, -baseY + 0.95, Math.cos(camAz + 0.9) * rC * 0.95); door.rotation.y = camAz + 0.9; vessel.add(door);
  }
  // bottom harvest valve + pipe
  const bv = cyl(0.03 * s, 0.03 * s, 0.1 * s, matSteelPol, 16); bv.position.y = -hd - 0.06 * s; vessel.add(bv);
  // drive: lantern + gearbox + motor on the top head
  const drive = new THREE.Group(); drive.position.y = Hs + hd; vessel.add(drive); P.motor = drive;
  const lantern = cyl(0.09 * s, 0.11 * s, 0.14 * s, matSteelPol, 24); lantern.position.y = 0.07 * s; drive.add(lantern);
  const gb = new THREE.Mesh(new RoundedBoxGeometry(0.26 * s, 0.2 * s, 0.22 * s, 3, 0.02 * s), matMotor); gb.position.y = 0.24 * s; drive.add(gb);
  const mot = cyl(0.085 * s, 0.085 * s, 0.3 * s, matMotor, 32); mot.position.set(0, 0.49 * s, 0); drive.add(mot);
  for (let k = 0; k < 10; k++) { const fin = box(0.19 * s, 0.26 * s, 0.006 * s, matMotor); fin.position.y = 0.49 * s; fin.rotation.y = k * Math.PI / 10; drive.add(fin); }
  const fan = cyl(0.09 * s, 0.09 * s, 0.05 * s, M.paintedSteel(0x2c3338), 24); fan.position.y = 0.665 * s; drive.add(fan);
  const tbx = box(0.07 * s, 0.06 * s, 0.07 * s, matMotor); tbx.position.set(0.1 * s, 0.52 * s, 0); drive.add(tbx);
  shadowAll(drive); tag(drive, 'motor');
  // nozzles on the top head: manway, sight glass, exhaust, feed, air
  const top = new THREE.Group(); top.position.y = Hs; vessel.add(top); P.head = top;
  const nozzle = (a, rr, rad, h, mat = matSteelPol) => { const y = hd * Math.sqrt(Math.max(0, 1 - (rr / R) ** 2)); const n = new THREE.Group(); n.position.set(Math.sin(a) * rr, y, Math.cos(a) * rr); const c = cyl(rad, rad, h, mat, 24); c.position.y = h / 2; n.add(c); const f = cyl(rad * 1.45, rad * 1.45, 0.012 * s, mat, 24); f.position.y = h; n.add(f); top.add(n); return n; };
  const manway = nozzle(camAz + Math.PI + 0.5, R * 0.5, 0.12 * s, 0.1 * s); const mwLid = cyl(0.18 * s, 0.18 * s, 0.02 * s, matSteelPol, 32); mwLid.position.y = 0.11 * s; manway.add(mwLid);
  const hw = new THREE.Mesh(new THREE.TorusGeometry(0.07 * s, 0.006 * s, 8, 32), matSteel); hw.rotation.x = Math.PI / 2; hw.position.y = 0.14 * s; manway.add(hw);
  const exhN = nozzle(camAz - 1.2, R * 0.55, 0.045 * s, 0.14 * s); P.cond = exhN;
  nozzle(camAz + 1.4, R * 0.62, 0.025 * s, 0.1 * s); nozzle(camAz + 2.3, R * 0.6, 0.03 * s, 0.12 * s); nozzle(camAz - 2.4, R * 0.7, 0.03 * s, 0.1 * s);
  shadowAll(top); tag(top, 'head');
  // exhaust condenser (shell & tube) beside the drive
  const cond = new THREE.Group(); cond.position.set(exhN.position.x, Hs + hd + 0.35 * s, exhN.position.z); vessel.add(cond);
  const cs = cyl(0.06 * s, 0.06 * s, 0.4 * s, matSteelPol, 24); cs.rotation.z = Math.PI / 2; cond.add(cs);
  vessel.add(makePipe([[exhN.position.x, exhN.position.y + Hs + 0.14 * s, exhN.position.z], [exhN.position.x, Hs + hd + 0.35 * s, exhN.position.z]], { radius: 0.035 * s, material: matSteelPol, tension: 0 }));
  shadowAll(cond); tag(cond, 'condenser');
  // side-entry probes (just outside the open sector, tips reach into the broth)
  const probes = new THREE.Group(); vessel.add(probes); P.probes = probes;
  [['DO', 0x2f6fd6, 'steel', ts + 0.12, 0.22], ['pH', 0x2c9a5a, 'glass', ts + 0.3, 0.3], ['T', 0xd8452f, 'steel', ts + tl - 0.14, 0.26]].forEach(([k, c, tip, a, fy]) => {
    const L = 0.36 * s;
    const pr = makeProbe({ length: L, radius: 0.012 * s, cap: c, tip });
    const holder = new THREE.Group(); holder.position.set(Math.sin(a) * R, fy * g.HL, Math.cos(a) * R);
    holder.rotation.y = a; holder.add(pr);
    pr.rotation.x = Math.PI / 2 - 0.26; pr.position.set(0, -0.04 * s, -0.15 * s);          // tip inside, body rising outwards at 15°
    const port = cyl(0.03 * s, 0.03 * s, 0.11 * s, matSteelPol, 20); port.rotation.x = Math.PI / 2 - 0.26; port.position.set(0, 0.012 * s, 0.05 * s); holder.add(port);
    probes.add(holder); tag(holder, 'probe-' + k); P['probe' + k] = holder;
  });
  // internals & broth
  P.internals = buildInternals(g, vessel, hd, M.steel(), sector);
  P.broth = makeBroth(R * 0.999, hd * 0.995, sector); vessel.add(P.broth); tag(P.broth, 'broth');
  // platform with railing at the top-head level + ladder (production scale only) and a sister vessel in the background
  const platY = baseY + Hs + 0.02; const plat = new THREE.Group(); if (big) root.add(plat);
  // (platform geometry is built for both sizes but only shown at 100 m³)
  const grate = canvasTexture(256, 256, (ctx, w) => { ctx.fillStyle = '#6d7275'; ctx.fillRect(0, 0, w, w); ctx.fillStyle = '#2b2f31'; for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) ctx.fillRect(i * 16 + 3, j * 16 + 2, 10, 12); }, { repeat: [6, 3], key: 'br-grate' });
  const deckW = big ? 6 : 1.6, deckD = big ? 3 : 1.0;
  const deck = box(deckW, 0.05, deckD, new THREE.MeshStandardMaterial({ map: grate, metalness: 0.6, roughness: 0.5 })); deck.position.set(-rC - deckW / 2 + 0.05, platY, -0.2); plat.add(deck);
  const rail = (a, b) => { const p = makePipe([a, b], { radius: 0.022, material: matYellow, tension: 0 }); plat.add(p); };
  const x0 = -rC - deckW + 0.05, x1 = -rC + 0.05, z0 = -0.2 - deckD / 2, z1 = -0.2 + deckD / 2;
  [1.1, 0.55].forEach(h => { rail([x0, platY + h, z1], [x1, platY + h, z1]); rail([x0, platY + h, z0], [x0, platY + h, z1]); rail([x0, platY + h, z0], [x1, platY + h, z0]); });
  for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / (big ? 6 : 2)) { rail([x, platY, z1], [x, platY + 1.1, z1]); rail([x, platY, z0], [x, platY + 1.1, z0]); }
  for (let k = 0; k < 2; k++) { const col = box(0.1, platY, 0.1, M.paintedSteel(0x7d8488)); col.position.set(k ? x0 + 0.05 : x1 - 0.15, platY / 2, z0 + 0.05); plat.add(col); const col2 = col.clone(); col2.position.z = z1 - 0.05; plat.add(col2); }
  // ladder
  const lx = x0 + 0.5, lz = z1 + 0.25;
  [-0.22, 0.22].forEach(dx => { const st = box(0.05, platY + 1, 0.05, matYellow); st.position.set(lx + dx, (platY + 1) / 2, lz); plat.add(st); });
  for (let y = 0.3; y < platY; y += 0.3) { const rung = cyl(0.014, 0.014, 0.44, matYellow, 8); rung.rotation.z = Math.PI / 2; rung.position.set(lx, y, lz); plat.add(rung); }
  shadowAll(plat);
  // scale figures
  const fig1 = scaleFigure(); fig1.position.set(rC + (big ? 1.6 : 0.9), 0, big ? -1.2 : -0.7); fig1.rotation.y = -0.9; root.add(fig1);
  if (big) { const fig2 = scaleFigure(0x7f8a93); fig2.position.set(x0 + deckW * 0.45, platY + 0.03, -0.25); fig2.rotation.y = 1.2; root.add(fig2);
    const sis = new THREE.Group(); sis.position.set(-13, 0, -12); root.add(sis); const sb = cyl(rC, rC, Hs, matClad, 64); sb.position.y = baseY + Hs / 2; sis.add(sb); const st = new THREE.Mesh(new THREE.LatheGeometry(headProfile(rC, hd, 16, true), 64), matSteelPol); st.position.y = baseY + Hs; sis.add(st); const sbt = new THREE.Mesh(new THREE.LatheGeometry(headProfile(rC, hd, 16), 64), matClad); sbt.position.y = baseY; sis.add(sbt); const sk = cyl(rC * 0.92, rC * 0.95, baseY - hd * 0.55, M.paintedSteel(0xcfd2d0), 48, true); sk.position.y = (baseY - hd * 0.55) / 2; sis.add(sk); const sd = drive.clone(); sd.position.set(0, baseY + Hs + hd, 0); sis.add(sd); shadowAll(sis); }
  // cooling-water supply/return pipes (blue) with flow particles
  const pipeR = big ? 0.09 : 0.03;
  const cwIn = makePipe([[rC + 0.02, baseY + 0.1 * s, -0.25 * s], [rC + 0.5, baseY + 0.1 * s, -0.4 * s], [rC + 0.5, 0.2, -0.4 * s], [rC + 3, 0.2, -1.2]], { radius: pipeR, material: matBlue, tension: 0 });
  const cwOut = makePipe([[rC + 0.02, baseY + Hjac * 0.95, -0.35 * s], [rC + 0.8, baseY + Hjac * 0.95, -0.5 * s], [rC + 0.8, 0.45, -0.5 * s], [rC + 3, 0.45, -1.4]], { radius: pipeR, material: matBlue, tension: 0 });
  root.add(cwIn, cwOut); shadowAll(cwIn); shadowAll(cwOut);
  P.flows = [new FlowAlong(cwIn.curve, { count: 40, speed: 0.5, size: pipeR * 1.6, color: 0x6fc3ff }), new FlowAlong(cwOut.curve, { count: 40, speed: 0.5, size: pipeR * 1.6, color: 0x9fd8ff })];
  P.flows.forEach(f => { f.points.material.opacity = 0.7; root.add(f.points); });
  // feed tank + pump on the floor
  const ft = new THREE.Group(); ft.position.set(-rC - 1.2 * (big ? 2 : 1), 0, 1.0 * (big ? 2.5 : 1)); root.add(ft);
  const ftS = big ? 2.2 : 0.8;
  const ftb = cyl(0.3 * ftS, 0.3 * ftS, 0.9 * ftS, matSteelPol, 32); ftb.position.y = 0.45 * ftS + 0.2 * ftS; ft.add(ftb);
  const ftt = new THREE.Mesh(new THREE.LatheGeometry(headProfile(0.3 * ftS, 0.08 * ftS, 10, true), 32), matSteelPol); ftt.position.y = 1.1 * ftS; ft.add(ftt);
  for (let k = 0; k < 3; k++) { const a = k * 2.094; const lg = cyl(0.02 * ftS, 0.02 * ftS, 0.25 * ftS, matSteelPol, 8); lg.position.set(Math.cos(a) * 0.25 * ftS, 0.125 * ftS, Math.sin(a) * 0.25 * ftS); ft.add(lg); }
  const pumpG = new THREE.Group(); pumpG.position.set(0.55 * ftS, 0, 0.1); ft.add(pumpG);
  const pbase = box(0.35 * ftS, 0.05 * ftS, 0.2 * ftS, matSteel); pbase.position.y = 0.025 * ftS; pumpG.add(pbase);
  const phd = cyl(0.08 * ftS, 0.08 * ftS, 0.06 * ftS, M.plastic(0x2f5f8f, 0.4), 24); phd.rotation.x = Math.PI / 2; phd.position.set(0.08 * ftS, 0.14 * ftS, 0); pumpG.add(phd);
  const rotor = new THREE.Group(); rotor.position.set(0.08 * ftS, 0.14 * ftS, 0.035 * ftS); pumpG.add(rotor);
  for (let r = 0; r < 3; r++) { const a = r * 2.094; const roll = cyl(0.015 * ftS, 0.015 * ftS, 0.02 * ftS, matWhitePl, 12); roll.rotation.x = Math.PI / 2; roll.position.set(Math.cos(a) * 0.045 * ftS, Math.sin(a) * 0.045 * ftS, 0); rotor.add(roll); }
  const pm = cyl(0.05 * ftS, 0.05 * ftS, 0.16 * ftS, matMotor, 20); pm.rotation.z = Math.PI / 2; pm.position.set(-0.07 * ftS, 0.14 * ftS, 0); pumpG.add(pm);
  shadowAll(ft); tag(ft, 'feed'); P.pumps = [rotor]; P.pumpfeed = pumpG; P.feedTank = ft;
  const feedLine = makePipe([[ft.position.x + 0.55 * ftS, 0.14 * ftS, ft.position.z + 0.1], [ft.position.x + 0.9 * ftS, 0.3, ft.position.z], [-rC * 0.6, platY - 0.3, 0.2], [Math.sin(camAz + 1.4) * R * 0.62, baseY + Hs + hd * 0.9, Math.cos(camAz + 1.4) * R * 0.62]], { radius: big ? 0.035 : 0.012, material: matSteelPol, tension: 0.2 });
  root.add(feedLine); shadowAll(feedLine);
  // nameplate
  const np = plate([big ? 'FFP-F100 · 100 m³ working volume' : 'FFP-F1 · 1 m³ working volume', `T = ${fmt(g.T, 2)} m · H = ${fmt(g.HL, 2)} m · 2 × Rushton`, 'PS −1/+3 bar(g) · Jacket 6 bar(g)'], big ? 1.2 : 0.36, big ? 0.34 : 0.11);
  const npa = camAz - 0.95 - open / 2; np.position.set(Math.sin(npa) * (rC + 0.006 * s), 0.5 * g.HL, Math.cos(npa) * (rC + 0.006 * s)); np.rotation.y = npa; vessel.add(np);
  // labels
  label(P.motor, 'Drive<small>—</small>', [0.55 * s * Math.sin(camAz + 1.57), 0.45 * s, 0.55 * s * Math.cos(camAz + 1.57)]); P.lblMotor = labelObjs[labelObjs.length - 1];
  label(fixedAt(P.internals.imp[0]), 'Rushton turbines<small>—</small>', [1.25 * R * Math.sin(camAz + 1.65), 0.12 * s, 1.25 * R * Math.cos(camAz + 1.65)]); P.lblImp = labelObjs[labelObjs.length - 1];
  label(P.internals.sparger, 'Ring sparger<small>—</small>', [1.15 * R * Math.sin(camAz + 0.95), -0.16 * s, 1.15 * R * Math.cos(camAz + 0.95)]); P.lblSp = labelObjs[labelObjs.length - 1];
  label(P.probeDO, 'DO probe<small>—</small>', [0, 0.16 * s, 0.35 * s]); P.lblDO = labelObjs[labelObjs.length - 1];
  label(coolant, 'Cooling jacket<small>—</small>', [Math.sin(camAz - 1.95) * rC * 1.5, g.HL * 0.05, Math.cos(camAz - 1.95) * rC * 1.5]); P.lblJac = labelObjs[labelObjs.length - 1];
  label(pumpG, 'Feed pump<small>—</small>', [0, 0.35 * ftS, 0]); P.lblFeed = labelObjs[labelObjs.length - 1];
  label(cond, 'Exhaust → off-gas analyser<small>—</small>', [-0.35 * s, 0.1 * s, 0]); P.lblGas = labelObjs[labelObjs.length - 1];
  label(fig1, 'Person, 1.75 m', [0.4, 2.1, 0], 'label3d');
  const key = lights.key; key.shadow.camera.far = big ? 160 : 40; key.intensity = 2.2; lights.hemi.intensity = 0.5; lights.fill.intensity = 0.5;
  scene.environmentIntensity = 0.5; stage.renderer.toneMappingExposure = 0.95;
  key.position.set(s * 4, s * 7 + 4, s * 5); fitShadow(key, big ? 16 : 3.5, [0, baseY + Hs / 2, 0]);
  P.views = big
    ? { home: [[17.8, 15.2, 17.8], [-0.4, 8.5, 0]], imp: [[3.6, baseY + g.zImp[0] + 1.6, 4.8], [0, baseY + g.zImp[0], 0]], head: [[6.5, baseY + Hs + hd + 5, 7.5], [0, baseY + Hs + hd, 0]], probes: [[4.5, baseY + 1.8, 5.5], [0, baseY + 1.5, 0]] }
    : { home: [[4.3, 3.1, 4.5], [0.1, 1.75, 0]], imp: [[0.9, baseY + g.zImp[0] + 0.35, 1.15], [0, baseY + g.zImp[0], 0]], head: [[1.6, baseY + Hs + hd + 1.2, 1.9], [0, baseY + Hs + hd, 0]], probes: [[1.1, baseY + 0.55, 1.5], [0, baseY + 0.45, 0]] };
  P.baseY = baseY; P.hd = hd; P.R = R; P.bubbleSize = big ? 0.045 : 0.012; P.vRise = big ? 0.9 : 0.35; P.sector = sector;
  return P;
}

function rebuildIfNeeded() {
  const sc = ui.get('scale'), cut = !!ui.get('cut');
  const key = sc + (sc === 'lab' ? '' : cut ? '-cut' : '-full');
  if (key === builtScale) return;
  clearScene();
  const g = geometry(sc);
  parts = sc === 'lab' ? buildLab(g) : buildSteel(g, cut);
  parts.g = g;
  // bubbles
  parts.bub = new SwirlBubbles(sc === 'lab' ? 520 : 900);
  const drop = (2 / 3) * parts.hd;
  parts.bub.configure({ R: g.T / 2 * 0.97, rSp: 0.4 * g.D, ySp: 0.25 * g.T - drop, yImp: g.zImp.map(z => z - drop), D: g.D, vRise: parts.vRise });
  parts.vessel.add(parts.bub.mesh);
  const v = parts.views.home; stage.setHome(v[0], v[1]);
  if (builtScale === null || builtScale.split('-')[0] !== sc) { stage.camera.position.set(...v[0]); stage.controls.target.set(...v[1]); stage.controls.update(); }
  if (stage.aoPass) stage.aoPass.updateGtaoMaterial({ radius: sc === 'lab' ? 0.05 : sc === 'pilot' ? 0.3 : 1.2 });
  stage.controls.minDistance = sc === 'lab' ? 0.12 : sc === 'pilot' ? 0.6 : 2.5;
  builtScale = key;
  updateScene(0, true);
}
function fly(k) { const v = parts.views[k] || parts.views.home; stage.flyTo(v[0], v[1], 1.3); }

/* ------------------------------------------------------------------ picking / inspector */
const INFO = {
  broth: ['Broth', 'Yeast cells, dissolved glucose and the secreted protein. Colour and turbidity follow the biomass concentration.'],
  impeller: ['Rushton turbines', 'Two six-blade disc turbines (D = T/3, power number ≈ 5) break the sparged air into fine bubbles and pump them outwards.'],
  baffle: ['Baffles', 'Four wall baffles (T/10) stop the liquid from swirling as a solid body and turn rotation into turbulent mixing.'],
  sparger: ['Ring sparger', 'Air (or O₂-enriched air) leaves through small holes under the lower impeller.'],
  jacket: ['Cooling jacket', 'Cooling water removes the metabolic heat and the stirrer power. Capacity = U·A·(T − T_cw).'],
  head: ['Head plate / top head', 'Ports for probes, feed, base, antifoam, sampling and the exhaust line.'],
  motor: ['Drive', 'Top-mounted motor (and gearbox at large scale). The shaft power ends up as heat in the broth.'],
  condenser: ['Exhaust condenser & off-gas', 'Condenses water vapour from the exhaust; the off-gas analyser measures O₂ and CO₂ to calculate OUR, CER and RQ.'],
  offgas: ['Off-gas analyser', 'Paramagnetic O₂ and infrared CO₂ sensors. OUR = gas flow × (O₂ in − O₂ out).'],
  'probe-DO': ['Dissolved-oxygen probe', 'Polarographic/optical sensor reading % of air saturation. It drives the cascade controller.'],
  'probe-pH': ['pH probe', 'Glass electrode. pH is held at 5.0 by dosing ammonia, which is also the nitrogen source.'],
  'probe-T': ['Pt100 temperature sensor', 'Feeds the temperature controller that throttles the cooling water.'],
  'pump-feed': ['Feed pump', 'Peristaltic pump delivering 550 g L⁻¹ glucose (fed-batch) or fresh medium (continuous).'],
  'pump-base': ['Base pump', 'Ammonia solution for pH control; its activity follows growth.'],
  'pump-antifoam': ['Antifoam pump', 'Doses antifoam whenever the foam reaches the foam probe.'],
  feed: ['Feed reservoir', 'Glucose feed (fed-batch) or medium (continuous).'],
  tower: ['Control tower', 'Houses the controllers, pumps and the chiller for the jacket.'],
  vessel: ['Vessel', 'Stainless steel shell with a cooling jacket and insulation, rated for steam sterilisation.']
};
let inspected = null;
stage.onPick({
  objects: () => pickables,
  onClick: hit => {
    if (!hit) { inspected = null; inspector.style.display = 'none'; return; }
    let o = hit.object; while (o && !o.userData.comp) o = o.parent; if (!o) return;
    inspected = o.userData.comp; inspector.style.display = ''; updateInspector();
  }
});
function updateInspector() {
  if (!inspected) return; const d = fer.diag, s = fer.s; const i = INFO[inspected] || [inspected, ''];
  let live = '';
  if (inspected === 'broth') live = `X ${fmt(s.X, 1)} g L⁻¹ · S ${fmt(s.S, 2)} g L⁻¹ · V ${fmtV(s.V)}`;
  else if (inspected === 'impeller' || inspected === 'motor') live = `${fmt(s.N * 60, 0)} rpm · P_g ${fmtW(d.tr.Pg)} · tip ${fmt(d.tr.tip, 2)} m s⁻¹ · Re ${fmt(d.tr.Re, 0)}`;
  else if (inspected === 'sparger') live = `${fmt(ui.get('vvm'), 2)} vvm · v_s ${fmt(d.tr.vs * 1000, 1)} mm s⁻¹ · O₂ in ${fmt(s.yIn * 100, 1)} %`;
  else if (inspected === 'jacket' || inspected === 'vessel') live = `Heat ${fmtW(d.Qtot)} · capacity ${fmtW(d.Qmax)} · A ${fmt(d.A, d.A < 1 ? 3 : 1)} m²`;
  else if (inspected.startsWith('probe')) live = `DO ${fmt(d.DO, 0)} % · T ${fmt(s.Tb, 2)} °C · pH 5.00`;
  else if (inspected === 'condenser' || inspected === 'offgas') live = `O₂ out ${fmt(s.yOut * 100, 2)} % · CO₂ ${fmt(d.yCO2 * 100, 2)} % · RQ ${fmt(d.RQ, 2)}`;
  else if (inspected.startsWith('pump') || inspected === 'feed') live = `Feed ${fmtF(s.F)}`;
  inspector.innerHTML = `<b>${i[0]}</b><br>${i[1]}${live ? `<br><span style="color:#9be7b6">${live}</span>` : ''}<br><span style="opacity:.6">click empty space to close</span>`;
}
const fmtW = w => w >= 1e6 ? fmt(w / 1e6, 2) + ' MW' : w >= 1000 ? fmt(w / 1000, 1) + ' kW' : fmt(w, 1) + ' W';
const fmtV = v => v >= 1 ? fmt(v, 1) + ' m³' : fmt(v * 1000, 2) + ' L';
const fmtF = F => F <= 0 ? 'off' : F >= 1 ? fmt(F, 2) + ' m³ h⁻¹' : F >= 1e-3 ? fmt(F * 1000, 1) + ' L h⁻¹' : fmt(F * 1e6, 0) + ' mL h⁻¹';

/* ------------------------------------------------------------------ scene update driven by the model */
const cMed = new THREE.Color(0xeae1b3), cCell = new THREE.Color(0xd9c49b), cDense = new THREE.Color(0xc6a87c);
const tmpC = new THREE.Color();
let visAngle = 0, lastScreen = 0;
function updateScene(dt, force) {
  if (!parts) return;
  const s = fer.s, d = fer.diag, g = parts.g;
  // broth level, colour and turbidity
  const H = s.V / g.A - (2 / 3) * parts.hd;
  const foamH = s.foam * 0.22 * g.T;
  parts.broth.setLevel(H, foamH);
  tmpC.copy(cMed).lerp(cCell, clamp(s.X / 25, 0, 1)).lerp(cDense, clamp((s.X - 25) / 90, 0, 1));
  brothMat.color.copy(tmpC); surfMat.color.copy(tmpC);
  brothMat.opacity = 0.2 + 0.78 * (1 - Math.exp(-s.X / 7)); surfMat.opacity = Math.min(0.97, brothMat.opacity + 0.18);
  foamMat.color.setRGB(1, 0.985 - 0.05 * clamp(s.X / 80, 0, 1), 0.95 - 0.12 * clamp(s.X / 80, 0, 1));
  // impellers
  const rps = s.N; const visRps = Math.min(rps, 2.2);
  visAngle += visRps * 2 * Math.PI * dt;
  parts.internals.imp.forEach(r => { r.rotation.y = -visAngle; r.blur.visible = rps > 2.2; blurMat.opacity = clamp(0.06 + 0.02 * rps, 0.06, 0.3); });
  parts.internals.shaft.rotation.y = -visAngle;
  // bubbles: number ∝ gas flow, size ↑ with gas flow and ↓ with power input
  const vvm = ui.get('vvm'); const pv = Math.max(50, d.tr.PgV);
  const size = parts.bubbleSize * Math.pow(vvm, 0.25) * Math.pow(pv / 1000, -0.15);
  parts.bub.update(Math.min(dt, 0.05), (g.key === 'lab' ? 220 : 380) * vvm, visRps * 2 * Math.PI, H, size);
  surfMat.normalMap.offset.x += dt * (0.05 + 0.08 * visRps); surfMat.normalMap.offset.y += dt * 0.03 * visRps;
  surfMat.normalScale.setScalar(0.3 + 0.4 * clamp(visRps / 2, 0, 1));
  // pumps & flows
  const fedFrac = s.F > 0 ? clamp(s.F / (0.05 * g.Vmax), 0.15, 1) : 0;
  if (parts.pumps[0]) parts.pumps[0].rotation.z -= dt * 12 * fedFrac;
  if (parts.pumps[1]) parts.pumps[1].rotation.z -= dt * 6 * clamp(Math.max(0, d.r.mu) * s.X / 5, 0, 1);
  if (parts.pumps[2]) parts.pumps[2].rotation.z -= dt * (fer.s.foam > 0.3 && ui.get('antifoam') ? 10 : 0);
  const coolFrac = d.Qmax > 0 ? clamp(d.Qtot / d.Qmax, 0, 1.2) : 0;
  parts.flows.forEach(f => { f.speed = (g.key === 'lab' ? 0.02 : 0.1) + (g.key === 'lab' ? 0.12 : 0.9) * coolFrac; f.update(dt); });
  if (parts.gasFlow) { parts.gasFlow.speed = 0.05 + 0.1 * vvm; parts.gasFlow.update(dt); }
  if (parts.coolant) parts.coolant.material.color.setHSL(0.58 - 0.1 * clamp(coolFrac - 0.6, 0, 0.6) / 0.6, 0.55, 0.45);
  if (parts.feedBottle) parts.feedBottle.setLevel(clamp(0.85 - s.feedUsed / (0.0011), 0.04, 0.85));
  // labels (throttled)
  if (force || performance.now() - lastScreen > 250) {
    lastScreen = performance.now();
    const set = (l, html) => { if (l) l.element.innerHTML = html; };
    set(parts.lblDO, `DO probe<small>${fmt(d.DO, 0)} % air sat.</small>`);
    set(parts.lblT, `Pt100<small>${fmt(s.Tb, 1)} °C (set ${fmt(ui.get('Tset'), 1)})</small>`);
    set(parts.lblMotor, `${g.key === 'lab' ? 'Motor' : 'Drive'}<small>${fmt(s.N * 60, 0)} rpm · ${fmtW(d.tr.Pg)} gassed</small>`);
    set(parts.lblImp, `Rushton turbines<small>P_g/V ${fmt(d.tr.PgV / 1000, 2)} kW m⁻³ · k_La ${fmt(d.tr.kla, 0)} h⁻¹</small>`);
    set(parts.lblSp, `Ring sparger<small>${fmt(vvm, 2)} vvm · ${fmt(s.yIn * 100, 0)} % O₂</small>`);
    set(parts.lblJac, `Cooling jacket<small>${fmtW(Math.min(d.Qtot, d.Qmax))} of ${fmtW(d.Qmax)} capacity</small>`);
    set(parts.lblFeed, `Feed pump<small>${fmtF(s.F)}</small>`);
    set(parts.lblGas, `${g.key === 'lab' ? 'Off-gas analyser' : 'Exhaust → off-gas analyser'}<small>O₂ ${fmt(s.yOut * 100, 1)} % · CO₂ ${fmt(d.yCO2 * 100, 2)} %</small>`);
    if (parts.screen) drawScreen();
    if (parts.ana) drawAnalyser();
    updateInspector();
  }
}
function drawScreen() {
  const { canvas, tex } = parts.screen; const ctx = canvas.getContext('2d'); const W = canvas.width, H = canvas.height; const s = fer.s, d = fer.diag;
  ctx.fillStyle = '#0d1a22'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#7fd6ff'; ctx.font = '600 22px Inter, sans-serif'; ctx.fillText('FFP bioreactor · run ' + fmt(s.t, 1) + ' h', 16, 30);
  const items = [['DO', fmt(d.DO, 0) + ' %', '#6fd39a'], ['T', fmt(s.Tb, 1) + ' °C', '#f2b94b'], ['pH', '5.00', '#a792f0'], ['Stirrer', fmt(s.N * 60, 0) + ' rpm', '#5cc8ef']];
  items.forEach((it, i) => { const x = 16 + (i % 2) * 250, y = 62 + Math.floor(i / 2) * 58; ctx.fillStyle = '#8ea3ad'; ctx.font = '500 18px Inter, sans-serif'; ctx.fillText(it[0], x, y); ctx.fillStyle = it[2]; ctx.font = '700 30px JetBrains Mono, monospace'; ctx.fillText(it[1], x, y + 30); });
  // DO trend of the last 24 h
  const x0 = 16, y0 = 190, w = W - 32, h = 110; ctx.strokeStyle = '#2a3b45'; ctx.strokeRect(x0, y0, w, h);
  const T = hist.t, n = T.length; if (n > 1) { const t1 = T[n - 1], t0 = Math.max(0, t1 - 24); ctx.beginPath(); let first = true; for (let i = 0; i < n; i++) { if (T[i] < t0) continue; const X = x0 + (T[i] - t0) / Math.max(1e-6, t1 - t0) * w, Y = y0 + h - clamp(hist.DO[i] / 110, 0, 1) * h; if (first) { ctx.moveTo(X, Y); first = false; } else ctx.lineTo(X, Y); } ctx.strokeStyle = '#6fd39a'; ctx.lineWidth = 3; ctx.stroke(); }
  ctx.fillStyle = '#8ea3ad'; ctx.font = '500 15px Inter, sans-serif'; ctx.fillText('DO, last 24 h', x0 + 6, y0 + 18);
  tex.needsUpdate = true;
}
function drawAnalyser() {
  const { canvas, tex } = parts.ana; const ctx = canvas.getContext('2d'); const s = fer.s, d = fer.diag;
  ctx.fillStyle = '#10181c'; ctx.fillRect(0, 0, 256, 96); ctx.fillStyle = '#9be7b6'; ctx.font = '700 26px JetBrains Mono, monospace';
  ctx.fillText('O2 ' + fmt(s.yOut * 100, 2) + '%', 12, 38); ctx.fillStyle = '#f2b94b'; ctx.fillText('CO2 ' + fmt(d.yCO2 * 100, 2) + '%', 12, 78); tex.needsUpdate = true;
}

/* ================================================================== charts */
const chTime = new Plot('#chart-time', { x: { label: 'Time', unit: 'h', min: 0 }, y: { label: 'Concentration', unit: 'g L⁻¹', min: 0 }, y2: { label: 'Product P', unit: 'mg L⁻¹', min: 0 } });
const chO2 = new Plot('#chart-o2', { x: { label: 'Time', unit: 'h', min: 0 }, y: { label: 'O₂ rate', unit: 'mmol L⁻¹ h⁻¹', min: 0 }, y2: { label: 'Dissolved O₂', unit: '% air sat.', min: 0, max: 110 } });
const chHeat = new Plot('#chart-heat', { x: { label: 'Time', unit: 'h', min: 0 }, y: { label: 'Heat flow per volume', unit: 'kW m⁻³', min: 0 }, y2: { label: 'Broth temperature', unit: '°C' } });
const chProd = new Plot('#chart-prod', { x: { label: 'Time', unit: 'h', min: 0 }, y: { label: 'Biomass space–time yield', unit: 'g L⁻¹ h⁻¹', min: 0 }, y2: { label: 'Product space–time yield', unit: 'mg L⁻¹ h⁻¹', min: 0 } });
const chScale = new BarChart('#chart-scale', { y: { label: 'Supported OUR', unit: 'mmol L⁻¹ h⁻¹', min: 0 }, height: 280 });

let hist;
const HKEYS = ['t', 'X', 'S', 'P', 'DO', 'N', 'kla', 'OUR', 'OTR', 'OTRmax', 'Qmet', 'Qag', 'Qmax', 'T', 'V', 'F', 'mu', 'prodX', 'prodP', 'yOut', 'RQ'];
function newHist() { hist = {}; HKEYS.forEach(k => hist[k] = []); }
newHist();
let nextSample = 0;
function sample() {
  const s = fer.s, d = fer.diag, V = s.V;
  const row = { t: s.t, X: s.X, S: s.S, P: s.P, DO: d.DO, N: s.N * 60, kla: d.tr.kla, OUR: d.OUR, OTR: d.OTR, OTRmax: d.OTRmax, Qmet: d.Qmet / V / 1000, Qag: d.Qag / V / 1000, Qmax: d.Qmax / V / 1000, T: s.Tb, V, F: s.F, mu: d.r.mu, prodX: s.t > 0.3 ? d.prodX : 0, prodP: s.t > 0.3 ? d.prodP : 0, yOut: s.yOut, RQ: d.RQ };
  HKEYS.forEach(k => hist[k].push(row[k]));
}
function updateCharts() {
  const t = hist.t; const food = ui.get('product') === 'food';
  const pf = food ? 1 : 1000;
  chTime.setAxis('y2', { label: 'Product P', unit: food ? 'g L⁻¹' : 'mg L⁻¹' });
  chTime.line('X', t, hist.X, { color: 'accent', width: 2.6, label: 'Biomass X' });
  chTime.line('S', t, hist.S, { color: 'amber', width: 2, label: 'Glucose S' });
  chTime.line('P', t, hist.P.map(v => v * pf), { color: 'magenta', width: 2.2, label: 'Product P', y2: true });
  chO2.line('OUR', t, hist.OUR, { color: 'magenta', width: 2.4, label: 'OUR (demand)' });
  chO2.line('OTR', t, hist.OTR, { color: 'accent', width: 1.6, dash: [4, 3], label: 'OTR (transfer)' });
  chO2.line('OTRmax', t, hist.OTRmax, { color: 'ink', width: 1.4, dash: [6, 4], label: 'Max OTR at top speed' });
  chO2.line('DO', t, hist.DO, { color: 'water', width: 1.8, label: 'DO (%)', y2: true });
  chO2.hline('dosp', ui.get('DOsp'), { color: 'water', dash: [2, 4], label: '', y2: true });
  chHeat.line('Qmet', t, hist.Qmet, { color: 'danger', width: 2.2, label: 'Metabolic heat' });
  chHeat.line('Qag', t, hist.Qag, { color: 'amber', width: 1.8, label: 'Stirrer power' });
  chHeat.line('Qtot', t, hist.Qmet.map((v, i) => v + hist.Qag[i]), { color: 'magenta', width: 2.6, label: 'Total heat load' });
  chHeat.line('Qmax', t, hist.Qmax, { color: 'water', width: 1.8, dash: [6, 4], label: 'Cooling capacity' });
  chHeat.line('T', t, hist.T, { color: 'ink', width: 1.4, dash: [2, 3], label: 'T (°C)', y2: true });
  chProd.line('px', t, hist.prodX, { color: 'accent', width: 2.4, label: 'Biomass' });
  chProd.line('pp', t, hist.prodP.map(v => v * 1000), { color: 'magenta', width: 2.2, label: food ? 'Product (mg L⁻¹ h⁻¹)' : 'Product', y2: true });
  const tMax = Math.max(10, Math.ceil((t[t.length - 1] || 0) / 10) * 10);
  [chTime, chO2, chHeat, chProd].forEach(c => c.setAxis('x', { min: 0, max: tMax }));
}
function updateScaleChart() {
  const p = fer.p; const keys = ['lab', 'pilot', 'prod'];
  const c = keys.map(k => ceilings(p, k));
  chScale.set(keys.map(k => SCALES[k].short), [
    { label: 'O₂ transfer ceiling (top speed, DO 10 %)', values: c.map(x => x.OTRmax), color: 'water' },
    { label: 'Heat-removal ceiling (jacket + coils)', values: c.map(x => x.OURheat), color: 'danger' }
  ]);
  const tb = document.querySelector('#scale-table tbody');
  if (tb) tb.innerHTML = [
    ['Tank diameter T', c.map(x => fmt(x.g.T, 2) + ' m')], ['Impeller diameter D', c.map(x => fmt(x.g.D, 3) + ' m')],
    ['Top stirrer speed', c.map(x => fmt(x.rpm, 0) + ' rpm')], ['Tip speed at top speed', c.map(x => fmt(x.tr.tip, 2) + ' m s⁻¹')],
    ['Superficial gas velocity', c.map(x => fmt(x.tr.vs * 1000, 1) + ' mm s⁻¹')], ['k_La at top speed', c.map(x => fmt(x.tr.kla, 0) + ' h⁻¹')],
    ['Mixing time (relative, ∝ 1/N)', c.map(x => fmt(c[0].rpm / x.rpm, 1) + ' ×')], ['Jacket + coil area per volume', c.map(x => fmt(x.AV, 2) + ' m² m⁻³')],
    ['O₂ ceiling', c.map(x => fmt(x.OTRmax, 0) + ' mmol L⁻¹ h⁻¹')], ['Heat ceiling', c.map(x => fmt(x.OURheat, 0) + ' mmol L⁻¹ h⁻¹')]
  ].map(r => `<tr><td>${r[0]}</td>${r[1].map(v => `<td class="num">${v}</td>`).join('')}</tr>`).join('');
}

/* ================================================================== readouts & HUD */
function updateReadouts() {
  const s = fer.s, d = fer.diag, p = fer.p, g = fer.g;
  ro.set('X', s.X);
  ro.set('S', s.S, p.mode === 'fed' && s.feeding && s.S > 2 ? 'bad' : null, p.mode === 'fed' && s.feeding && s.S > 2 ? 'sugar accumulating — overfeeding' : null);
  const food = p.product === 'food';
  ro.set('P', food ? `${fmt(s.P, 2)}<small>g L⁻¹</small>` : `${fmt(s.P * 1000, 1)}<small>mg L⁻¹</small>`);
  ro.set('DO', d.DO, d.DO < 5 ? 'bad' : d.DO < 15 ? 'warn' : 'ok', d.DO < 5 ? 'oxygen-limited growth' : `set-point ${fmt(p.DOsp, 0)} %`);
  const atMax = p.doMode === 'cascade' && s.N >= fer.sr.Nmax * 0.995;
  ro.set('N', s.N * 60, atMax ? 'warn' : null, `P_g/V ${fmt(d.tr.PgV / 1000, 2)} kW m⁻³ · ` + (atMax ? (p.enrich && p.doMode === 'cascade' ? `top speed, O₂ in ${fmt(s.yIn * 100, 0)} %` : 'top speed') : `max ${fmt(fer.sr.Nmax * 60, 0)}`));
  ro.set('kla', d.tr.kla, null, `v_s ${fmt(d.tr.vs * 1000, 1)} mm s⁻¹ · C* ${fmt(d.Cs, 3)} mmol L⁻¹`);
  const oLim = d.OUR > 0.9 * d.OTRmax;
  ro.set('our', d.OUR, oLim ? 'bad' : d.OUR > 0.7 * d.OTRmax ? 'warn' : 'ok', oLim ? `at the transfer ceiling (${fmt(d.OTRmax, 0)})` : `ceiling ${fmt(d.OTRmax, 0)} mmol L⁻¹ h⁻¹`);
  const hLim = d.Qtot > d.Qmax * 0.999 && s.Tb > p.Tset + 0.2;
  ro.set('heat', d.Qtot, hLim ? 'bad' : d.Qtot > 0.8 * d.Qmax ? 'warn' : 'ok', (hLim ? 'cooling saturated — T rising · ' : '') + `capacity ${fmtW(d.Qmax)} · ${fmt(d.Qtot / s.V / 1000, 2)} kW m⁻³`);
  ro.set('T', s.Tb, s.Tb > p.Tset + 2 ? 'bad' : s.Tb > p.Tset + 0.5 ? 'warn' : 'ok', s.Tb > p.Tset + 2 ? 'overheating — culture at risk' : `set ${fmt(p.Tset, 1)} °C`);
  ro.set('gas', s.yOut * 100, null, `in ${fmt(s.yIn * 100, 1)} % · CO₂ ${fmt(d.yCO2 * 100, 2)} % · RQ ${isFinite(d.RQ) ? fmt(d.RQ, 2) : '—'}`);
  ro.set('mu', d.r.mu, null, p.mode === 'cont' ? `D = ${fmt(p.D, 3)} h⁻¹ · washout above ${fmt(d.Dcrit, 3)}` : p.mode === 'fed' && s.feeding ? `μ_set ${fmt(p.muSet, 3)} · feed ×${fmt(s.lim, 2)}` : '');
  ro.set('sty', d.prodX, null, `product ${fmt(d.prodP * 1000, food ? 1 : 3)} mg L⁻¹ h⁻¹ (run so far)`);
  const labN = ceilings(p, 'lab').rpm;
  ro.set('tip', d.tr.tip, d.tr.tip > 7 ? 'warn' : null, `mixing time ×${fmt(labN / (fer.sr.Nmax * 60), 1)} vs 2 L (at top speed)`);
  hud.set('t', `t = <b>${fmt(s.t, 1)} h</b> · ${s.phase}`);
  hud.set('sc', `${SCALES[g.key].label} · V = <b>${fmtV(s.V)}</b>`);
  const warn = [];
  if (d.DO < 5) warn.push('O₂-limited'); if (hLim) warn.push('cooling limit'); if (p.mode === 'cont' && p.D > d.Dcrit) warn.push('washout');
  if (warn.length) hud.set('w', `<b style="color:#ff9b7a">⚠ ${warn.join(' · ')}</b>`); else hud.remove('w');
}

/* ================================================================== time stepping */
const DT = 5 / 3600;          // 5 s integration step (h)
function advance(dtH) {
  let rem = dtH;
  while (rem > 1e-12 && !fer.s.done) {
    const h = Math.min(DT, rem); fer.step(h); rem -= h;
    if (fer.s.t >= nextSample) { sample(); nextSample = fer.s.t + 0.1; }
  }
  if (fer.s.done && clock.running) { clock.pause(); sample(); updateCharts(); window.FFP && FFP.toast && FFP.toast('Run finished at ' + fmt(fer.s.t, 1) + ' h — reset to start again'); }
}
const clock = new SimClock({ speed: 2 / 3600 * 3600, maxDt: 0.25, onStep: (dt) => advance(dt) });
clock.speed = +ui.get('speed');
const playTool = stage.addTool ? stage.addTool({ icon: '▶', title: 'Run / pause the simulation (space bar)', onClick: () => clock.toggle() }) : null;
clock.onState(r => { playBtn.innerHTML = r ? '❚❚ Pause' : (fer.s.done ? '▶ Run (finished)' : '▶ Run'); if (playTool) playTool.innerHTML = r ? '❚❚' : '▶'; });
stage.onKey('space', () => clock.toggle());

function restart() {
  clock.pause(); fer.setParams(params()); fer.reset(); curNmax = fer.sr.Nmax; ui.set('Nman', ui.get('Nman'), true);
  newHist(); sample(); nextSample = 0.1; updateCharts(); updateReadouts(); updateScaleChart(); updateScene(0, true);
  playBtn.innerHTML = '▶ Run';
}
function syncEnabled() {
  const m = ui.get('mode'); ui.enable('muSet', m === 'fed'); ui.enable('limiter', m === 'fed'); ui.enable('D', m === 'cont');
  const man = ui.get('doMode') === 'manual'; ui.enable('Nman', man); ui.enable('DOsp', !man); ui.enable('enrich', !man);
}
ui.onChange((st, id) => {
  if (id === 'speed') { clock.speed = +st.speed; return; }
  if (id === 'labels') { labelObjs.forEach(l => l.visible = st.labels); return; }
  syncEnabled();
  if (applyingPreset) return;
  if (id === 'scale') { const s = SCALES[st.scale]; ui.setMany({ vvm: s.vvm, phead: s.phead, U: s.U }); rebuildIfNeeded(); restart(); return; }
  if (id === 'cut') { rebuildIfNeeded(); return; }
  if (id === 'mode' || id === 'S0' && fer.s.t < 0.01) { restart(); return; }
  fer.setParams(params()); curNmax = fer.sr.Nmax;
  if (id === 'pvMax') ui.set('Nman', ui.get('Nman'), true);
  updateReadouts(); updateScaleChart();
});

function downloadHistory() {
  const keys = HKEYS; const rows = hist.t.map((_, i) => keys.map(k => +(+hist[k][i]).toPrecision(5)));
  downloadCSV('bioreactor-run.csv', ['time_h', 'X_gL', 'S_gL', 'P_gL', 'DO_pct', 'N_rpm', 'kLa_h', 'OUR_mmolLh', 'OTR_mmolLh', 'OTRmax_mmolLh', 'Qmet_kWm3', 'Qstirrer_kWm3', 'Qcoolmax_kWm3', 'T_C', 'V_m3', 'F_m3h', 'mu_h', 'STY_X_gLh', 'STY_P_gLh', 'yO2_out', 'RQ'], rows);
}

/* ================================================================== go */
syncEnabled();
rebuildIfNeeded();
restart();
let lastChart = 0;
stage.onFrame((dt) => {
  updateScene(dt, false);
  if (clock.running && performance.now() - lastChart > 220) { lastChart = performance.now(); updateCharts(); updateReadouts(); }
});
// hook for automated tests: advance the simulation by h hours without the clock
window.__bioreactor = { fer, chemostat, run: h => { advance(h); updateCharts(); updateReadouts(); updateScene(0.016, true); } };
