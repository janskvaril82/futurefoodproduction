/* Inside a photosynthesising leaf — FvCB/Bernacchi/Medlyn model + microscopic 3D leaf.
   Model: see leafmodel.js and the Derive tab (Eqs. P1–P11).
   Scene units: 1 unit = 10 µm (leaf block); chloroplast interior: 1 unit ≈ 0.3 µm. */
import { createStage, THREE, RoundedBoxGeometry, BufferGeometryUtils, rng } from '/assets/js/lab3d.js';
import { Controls, Readouts, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, BarChart, linspace } from '/assets/js/plot.js';
import { leafGasExchange, leafParams, leafRates, LIMIT_LABEL, LIMIT_SHORT, poreAreaFor, poreConductance, P_ATM } from './leafmodel.js';
import { fresnelMaterial, guardPairGeometry, guardCentre, SpriteCloud, glyphTexture, streakTexture, gradientBackground, photonColour } from './anatomy.js';

/* ================================================================ UI */
const PATH_DEFAULTS = { C3: { vcmax25: 80, jmax25: 135, g1: 5.8 }, C4: { vcmax25: 40, jmax25: 248, g1: 1.6 } };
let applyingPreset = false;
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'A', label: 'Net CO₂ assimilation A', unit: 'µmol m⁻² s⁻¹', digits: 1 })
  .add({ id: 'lim', label: 'Limiting process', unit: '', format: v => `<span style="font-size:.62em;line-height:1.25;display:inline-block">${v}</span>` })
  .add({ id: 'gs', label: 'Stomatal conductance gₛ', unit: 'mol m⁻² s⁻¹', digits: 3 })
  .add({ id: 'ci', label: 'Intercellular CO₂ Cᵢ', unit: 'ppm', digits: 0 })
  .add({ id: 'vc', label: 'Gross carboxylation V<sub>c</sub>', unit: 'µmol m⁻² s⁻¹', digits: 1 })
  .add({ id: 'pr', label: 'Photorespiratory CO₂ loss', unit: 'µmol m⁻² s⁻¹', digits: 2 })
  .add({ id: 'J', label: 'Electron transport J', unit: 'µmol e⁻ m⁻² s⁻¹', digits: 0 })
  .add({ id: 'E', label: 'Transpiration E', unit: 'mmol m⁻² s⁻¹', digits: 2 })
  .add({ id: 'wue', label: 'Water-use efficiency A/E', unit: 'µmol mmol⁻¹', digits: 2 })
  .add({ id: 'ap', label: 'Stomatal pore width', unit: 'µm', digits: 1 });

ui.section('Environment');
ui.slider({ id: 'ppfd', label: 'Light (PPFD)', min: 0, max: 2000, step: 10, value: 800, unit: 'µmol m⁻² s⁻¹', help: 'Full sun ≈ 2000 · greenhouse 300–800 · plant factory 150–400' });
ui.slider({ id: 'ca', label: 'CO₂ in the air, Cₐ', min: 100, max: 2000, step: 5, value: 425, unit: 'ppm', help: 'Outdoor air ≈ 425 ppm (2025–26) · CO₂-enriched greenhouse 800–1000' });
ui.slider({ id: 'T', label: 'Leaf temperature', min: 5, max: 45, step: 0.5, value: 25, unit: '°C' });
ui.slider({ id: 'vpd', label: 'Leaf-to-air VPD', min: 0.3, max: 4, step: 0.05, value: 1.0, unit: 'kPa', help: 'Drier air → larger vapour-pressure deficit → stomata close' });
ui.segmented({ id: 'o2', label: 'Oxygen in the air', options: [{ value: 21, label: '21 % (air)' }, { value: 2, label: '2 % (low O₂)' }], value: 21 });
ui.section('Leaf biochemistry and stomata');
ui.segmented({
  id: 'path', label: 'Photosynthetic pathway', options: [{ value: 'C3', label: 'C3 (lettuce, wheat)' }, { value: 'C4', label: 'C4 (maize)' }], value: 'C3',
  onChange: v => { if (applyingPreset) return; const d = PATH_DEFAULTS[v]; Object.entries(d).forEach(([k, x]) => ui.set(k, x, true)); window.FFP && FFP.toast && FFP.toast(`${v} defaults: Vcmax₂₅ ${d.vcmax25}, Jmax₂₅ ${d.jmax25}, g₁ ${d.g1}`); }
});
ui.slider({ id: 'vcmax25', label: 'Rubisco capacity V<sub>cmax,25</sub>', min: 10, max: 200, step: 1, value: 80, unit: 'µmol m⁻² s⁻¹', help: 'C3 crops ≈ 50–120 · C4 (Rubisco in bundle sheath) ≈ 30–60' });
ui.slider({ id: 'jmax25', label: 'Electron-transport capacity J<sub>max,25</sub>', min: 20, max: 400, step: 1, value: 135, unit: 'µmol m⁻² s⁻¹', help: 'C3: J<sub>max</sub>/V<sub>cmax</sub> ≈ 1.7 at 25 °C' });
ui.slider({ id: 'tpu25', label: 'Triose-phosphate use TPU<sub>25</sub>', min: 3, max: 30, step: 0.5, value: 12, unit: 'µmol m⁻² s⁻¹', help: 'C3 only — the rate at which sugars are exported/made into starch' });
ui.slider({ id: 'g1', label: 'Stomatal slope g₁ (Medlyn)', min: 0.5, max: 10, step: 0.1, value: 5.8, unit: 'kPa^½', help: 'C3 crops ≈ 5.8, C4 ≈ 1.6 (Lin et al. 2015)' });
ui.slider({ id: 'tg', label: 'Growth temperature (acclimation)', min: 10, max: 35, step: 1, value: 25, unit: '°C', help: 'Shifts the high-temperature decline of V<sub>cmax</sub> and J<sub>max</sub> (Kattge & Knorr 2007)' });
ui.section('3D view');
ui.segmented({ id: 'view', label: 'Scale', options: [{ value: 'leaf', label: 'Leaf tissue (µm)' }, { value: 'chloro', label: 'Chloroplast (nm)' }], value: 'leaf', persist: false, onChange: v => goView(v) });
ui.toggle({ id: 'labels', label: 'Tissue labels', value: true, persist: false });
ui.toggle({ id: 'photons', label: 'Photons', value: true, persist: false });
ui.toggle({ id: 'gases', label: 'CO₂, O₂ and H₂O molecules', value: true, persist: false });
ui.buttons([
  { label: 'Overview', onClick: () => tour('overview') },
  { label: 'Palisade', onClick: () => tour('palisade') },
  { label: 'Stoma', onClick: () => tour('stoma') },
  { label: 'Vein', onClick: () => tour('vein') }
]);
ui.button({ label: '✦ Fly into a chloroplast', variant: 'primary', onClick: () => goView(state.view === 'chloro' ? 'leaf' : 'chloro') });
const PRESETS = [
  { label: 'Ambient greenhouse', values: { path: 'C3', ppfd: 600, ca: 425, T: 22, vpd: 1.0, o2: 21, vcmax25: 80, jmax25: 135, tpu25: 12, g1: 5.8 } },
  { label: 'CO₂-enriched plant factory', values: { path: 'C3', ppfd: 300, ca: 1000, T: 22, vpd: 0.8, o2: 21, vcmax25: 80, jmax25: 135, tpu25: 12, g1: 5.8 } },
  { label: 'Hot afternoon', values: { path: 'C3', ppfd: 1700, ca: 425, T: 37, vpd: 3.2, o2: 21, vcmax25: 80, jmax25: 135, tpu25: 12, g1: 5.8 } },
  { label: 'Low O₂ (no photorespiration)', values: { path: 'C3', ppfd: 800, ca: 425, T: 25, vpd: 1.0, o2: 2, vcmax25: 80, jmax25: 135, tpu25: 12, g1: 5.8 } },
  { label: 'Cool, high CO₂ (TPU)', values: { path: 'C3', ppfd: 1500, ca: 1400, T: 12, vpd: 0.8, o2: 21, vcmax25: 80, jmax25: 135, tpu25: 8, g1: 5.8 } },
  { label: 'C4 maize, midday', values: { path: 'C4', ppfd: 1800, ca: 425, T: 32, vpd: 2.2, o2: 21, vcmax25: 40, jmax25: 248, g1: 1.6 } }
];
ui.section('Presets');
const pw = ui.html('<div class="presets"></div>').firstChild;
PRESETS.forEach(p => { const b = document.createElement('button'); b.type = 'button'; b.textContent = p.label; b.addEventListener('click', () => { applyingPreset = true; ui.setMany(p.values); applyingPreset = false; window.FFP && FFP.toast && FFP.toast('Preset: ' + p.label); }); pw.appendChild(b); });
ui.saveButton('leaf-photosynthesis', () => ro.values());

const state = { view: 'leaf', res: null, apertureTarget: 0.4, aperture: 0.4, avoidTarget: 0.5, avoid: 0.5, busy: false };

/* ================================================================ model evaluation */
function params(p, over = {}) {
  return Object.assign({ path: p.path, tg: p.tg, T: p.T, O: p.o2 * 10, ppfd: p.ppfd, vcmax25: p.vcmax25, jmax25: p.jmax25, tpu25: p.tpu25, Ca: p.ca, D: p.vpd, g0: 0.01, g1: p.g1 }, over);
}
/* temperature acclimation (Kattge & Knorr 2007) enters through leafParams via Tg; wrap leafParams */
function gasEx(p, over = {}) {
  const P = params(p, over);
  const r = leafGasExchange(P);
  return r;
}

/* ================================================================ 3D stage */
const stage = createStage('#stage', {
  background: null, envIntensity: 0.32, exposure: 0.95,
  camera: { pos: [40, 30, 55], target: [0, 12.5, 0], fov: 36, near: 0.05, far: 3000 },
  controls: { minDistance: 2, maxDistance: 160, maxPolarAngle: Math.PI * 0.97 },
  bloom: { strength: 0.5, radius: 0.45, threshold: 1.0 }, ao: { radius: 1.1, intensity: 0.7 }, shadows: false,
  hint: 'Drag to orbit · scroll to zoom · click a tissue'
});
const { scene, camera, renderer, controls } = stage;
renderer.localClippingEnabled = true;
scene.background = gradientBackground('#163826', '#020604');
scene.add(new THREE.HemisphereLight(0xe6fff0, 0x0b1a10, 0.45));
const sun = new THREE.DirectionalLight(0xfff1d8, 1.7); sun.position.set(12, 50, 18); scene.add(sun);
const rim = new THREE.DirectionalLight(0x9fd8ff, 1.1); rim.position.set(-40, 12, -35); scene.add(rim);
const under = new THREE.DirectionalLight(0xc8ffd8, 0.5); under.position.set(10, -30, 25); scene.add(under);
const hud = hudChips(stage.el);
const legend = document.createElement('div'); legend.className = 'stage-legend'; stage.el.appendChild(legend);
const info = document.createElement('div'); info.className = 'hud-chip';
Object.assign(info.style, { position: 'absolute', right: '12px', top: '56px', maxWidth: '290px', zIndex: 5, display: 'none', font: '500 .78rem var(--font-sans)', lineHeight: '1.45', pointerEvents: 'none', whiteSpace: 'normal' });
stage.el.appendChild(info);
const fade = document.createElement('div');
Object.assign(fade.style, { position: 'absolute', inset: '0', background: 'radial-gradient(circle at 50% 45%, #2f7a3a 0%, #06170b 70%)', opacity: '0', transition: 'opacity .45s ease', pointerEvents: 'none', zIndex: 3 });
stage.el.appendChild(fade);

/* ---------------------------------------------------------------- geometry of the leaf block */
const W = 44, D = 22, HX = W / 2, HZ = D / 2;
const Y = { le0: 0, le1: 1.5, sp1: 11.4, pa1: 20.4, ue1: 22.4, cu: 22.7 };
const VB = { x: 7, y: 9.3, R: 3.2 };
const CLIP = [new THREE.Plane(new THREE.Vector3(0, 0, -1), HZ), new THREE.Plane(new THREE.Vector3(0, 0, 1), HZ), new THREE.Plane(new THREE.Vector3(-1, 0, 0), HX), new THREE.Plane(new THREE.Vector3(1, 0, 0), HX)];
const R = rng(20260926);
const leafGroup = new THREE.Group(); scene.add(leafGroup);
const pickables = [];
const tag = (mesh, key) => { mesh.userData.tissue = key; pickables.push(mesh); return mesh; };

// stomata (Poisson-disc on the lower surface; the first one is cut by the front face)
const STOMATA = [{ x: 1.5, z: HZ, rot: 0 }];
for (let k = 0; k < 400 && STOMATA.length < 14; k++) {
  const x = -HX + 2 + R() * (W - 4), z = -HZ + 1.5 + R() * (D - 3.5);
  if (STOMATA.every(s => Math.hypot(s.x - x, s.z - z) > 6.2) && Math.hypot(x - VB.x, 0) > 0.5) STOMATA.push({ x, z, rot: (R() - 0.5) * 0.7 });
}
const BLOCK_AREA_M2 = W * D * 1e-10;
const DENSITY = STOMATA.length / BLOCK_AREA_M2;       // m⁻² (hypostomatous leaf)
const GUARD = { L: 3.2, rMid: 0.55, rPole: 0.3, wMax: 1.1 };
const PORE_LEN = GUARD.L / 2 * 1e-5, PORE_DEPTH = 2 * GUARD.rMid * 1e-5;   // m
const GS_MAX = poreConductance(Math.PI * (PORE_LEN / 2) ** 2, DENSITY, PORE_DEPTH);

/* ---- materials */
const M_pal = fresnelMaterial({ color: 0x8fcf78, opacity: 0.07, rim: 0.36, clip: CLIP, sheen: 0.35, clearcoat: 0.4, maxAlpha: 0.75 });
const M_spo = fresnelMaterial({ color: 0x9fd486, opacity: 0.07, rim: 0.34, clip: CLIP, sheen: 0.35, clearcoat: 0.4, maxAlpha: 0.75 });
const M_epi = fresnelMaterial({ color: 0xcfe9d6, opacity: 0.05, rim: 0.26, clip: CLIP, sheen: 0.15, clearcoat: 0.5, maxAlpha: 0.6 });
const M_sheath = fresnelMaterial({ color: 0xc6e0a0, opacity: 0.08, rim: 0.4, clip: CLIP, sheen: 0.3 });
const M_xyl = fresnelMaterial({ color: 0xe9c978, opacity: 0.2, rim: 0.6, clip: CLIP, maxAlpha: 0.9 });
const M_phl = fresnelMaterial({ color: 0xd9e4c4, opacity: 0.1, rim: 0.42, clip: CLIP });
const M_cut = new THREE.MeshPhysicalMaterial({ color: 0xd9c77a, transparent: true, opacity: 0.16, roughness: 0.18, clearcoat: 0.8, clearcoatRoughness: 0.12, depthWrite: false, clippingPlanes: CLIP, side: THREE.DoubleSide, envMapIntensity: 0.4 });
const M_ring = new THREE.MeshStandardMaterial({ color: 0xe6c97c, roughness: 0.45, clippingPlanes: CLIP });
const M_chl = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.4, clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.8, sheenColor: new THREE.Color(0xb4ff90), emissive: 0x0d2c08, clippingPlanes: CLIP });
const M_nuc = new THREE.MeshPhysicalMaterial({ color: 0xbcaede, roughness: 0.45, transparent: true, opacity: 0.85, clearcoat: 0.5, clippingPlanes: CLIP });
const M_guard = new THREE.MeshPhysicalMaterial({ color: 0xbfe6a0, roughness: 0.33, clearcoat: 0.9, clearcoatRoughness: 0.2, transparent: true, opacity: 0.78, sheen: 0.6, sheenColor: new THREE.Color(0xe8ffd0), clippingPlanes: CLIP, side: THREE.DoubleSide, depthWrite: false });

/* ---- palisade mesophyll: columnar capsules */
const pal = [];
for (let j = 0; ; j++) {
  const z0 = HZ - j * 1.92; if (z0 < -HZ - 1.2) break;
  for (let i = -1; i < 40; i++) {
    const x = -HX + (i + (j % 2) * 0.5) * 2.2 + (R() - 0.5) * 0.3; if (x > HX + 1.2) break; if (x < -HX - 1.2) continue;
    const r = 0.9 + (R() - 0.5) * 0.14;
    const overVein = Math.abs(x - VB.x) < VB.R + 0.7;
    const y0 = overVein ? VB.y + VB.R + 0.3 + R() * 0.3 : Y.sp1 + 0.15 + R() * 0.4;
    const y1 = Y.pa1 - 0.08 - R() * 0.35;
    const z = j === 0 ? HZ + (R() - 0.5) * 0.3 : z0 + (R() - 0.5) * 0.25;
    pal.push({ x, z, r, y0, y1, front: z > HZ - 4.2 || x > HX - 3.4 });
  }
}
{
  const g = new THREE.CapsuleGeometry(1, 6, 5, 16);
  const im = new THREE.InstancedMesh(g, M_pal, pal.length); const m4 = new THREE.Matrix4();
  pal.forEach((c, i) => { m4.makeScale(c.r, (c.y1 - c.y0) / 8, c.r).setPosition(c.x, (c.y0 + c.y1) / 2, c.z); im.setMatrixAt(i, m4); });
  im.renderOrder = 3; leafGroup.add(tag(im, 'palisade'));
}

/* ---- spongy mesophyll: lobed cells with air spaces */
const SP_VARIANTS = [];
for (let v = 0; v < 8; v++) {
  const lobes = []; const nl = 3 + Math.floor(R() * 3);
  for (let k = 0; k < nl; k++) { const a = R() * Math.PI * 2, e = (R() - 0.5) * 0.9; lobes.push({ d: new THREE.Vector3(Math.cos(a), e, Math.sin(a)).normalize(), a: 0.45 + R() * 0.45 }); }
  SP_VARIANTS.push({ lobes, ph: R() * 10 });
}
function rfn(v, x, y, z) {
  const V = SP_VARIANTS[v]; let r = 0.74;
  for (const l of V.lobes) { const d = x * l.d.x + y * l.d.y + z * l.d.z; if (d > 0) r += l.a * d ** 5; }
  return r + 0.05 * Math.sin(5 * x + V.ph) * Math.sin(4 * z - V.ph) + 0.03 * Math.sin(7 * y + 2 * V.ph);
}
const SP_SCALE = new THREE.Vector3(1.6, 1.15, 1.6);
const spoGeos = SP_VARIANTS.map((_, v) => {
  let g = new THREE.IcosahedronGeometry(1, 3); g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = BufferGeometryUtils.mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const r = rfn(v, x, y, z); p.setXYZ(i, x * r * SP_SCALE.x, y * r * SP_SCALE.y, z * r * SP_SCALE.z); }
  g.computeVertexNormals(); return g;
});
const spo = [];
for (let k = 0; k < 6000 && spo.length < 150; k++) {
  const x = -HX - 1 + R() * (W + 2), y = 2.9 + R() * 7.2, z = -HZ - 1 + R() * (D + 2);
  if (Math.hypot(x - VB.x, y - VB.y) < VB.R + 1.7) continue;
  if (y < 5.4 && STOMATA.some(s => Math.hypot(s.x - x, s.z - z) < 2.7)) continue;
  if (spo.some(c => (c.x - x) ** 2 + ((c.y - y) * 1.25) ** 2 + (c.z - z) ** 2 < 3.75 ** 2)) continue;
  spo.push({ x, y, z, v: Math.floor(R() * 8), rot: R() * Math.PI * 2, s: 0.85 + R() * 0.3, front: z > HZ - 4.5 || x > HX - 4 });
}
const spoMeshes = SP_VARIANTS.map((_, v) => {
  const list = spo.filter(c => c.v === v); if (!list.length) return null;
  const im = new THREE.InstancedMesh(spoGeos[v], M_spo, list.length); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  list.forEach((c, i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.rot); sc.setScalar(c.s); m4.compose(new THREE.Vector3(c.x, c.y, c.z), q, sc); im.setMatrixAt(i, m4); });
  im.renderOrder = 3; leafGroup.add(tag(im, 'spongy')); return im;
}).filter(Boolean);

/* ---- epidermis + cuticle */
function epidermis(y0, y1, avoidStomata) {
  const cells = [];
  for (let j = 0; ; j++) {
    const z = -HZ - 1 + j * 3.3; if (z > HZ + 2) break;
    for (let i = 0; ; i++) {
      const x = -HX - 2 + (i + (j % 2) * 0.5) * 3.9; if (x > HX + 2.5) break;
      const cx = x + (R() - 0.5) * 0.4, cz = z + (R() - 0.5) * 0.4;
      if (avoidStomata && STOMATA.some(s => Math.abs(s.x - cx) < 2.3 && Math.abs(s.z - cz) < 2.9)) continue;
      cells.push({ x: cx, z: cz, w: 3.7 + (R() - 0.5) * 0.4, d: 3.1 + (R() - 0.5) * 0.3 });
    }
  }
  const im = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.22), M_epi, cells.length); const m4 = new THREE.Matrix4();
  cells.forEach((c, i) => { m4.makeScale(c.w, (y1 - y0) * 0.97, c.d).setPosition(c.x, (y0 + y1) / 2, c.z); im.setMatrixAt(i, m4); });
  im.renderOrder = 4; return im;
}
leafGroup.add(tag(epidermis(Y.pa1, Y.ue1, false), 'upperEpi'));
leafGroup.add(tag(epidermis(Y.le0, Y.le1, true), 'lowerEpi'));
{
  const cut = new THREE.Mesh(new THREE.BoxGeometry(W + 4, Y.cu - Y.ue1, D + 4), M_cut); cut.position.y = (Y.ue1 + Y.cu) / 2; cut.renderOrder = 5; leafGroup.add(tag(cut, 'cuticle'));
}

/* ---- vascular bundle */
const sheath = [];
{
  const n = 12, ringR = VB.R - 0.72;
  const g = new THREE.CylinderGeometry(1, 1, D + 3, 22, 1, false); g.rotateX(Math.PI / 2);
  const im = new THREE.InstancedMesh(g, M_sheath, n); const m4 = new THREE.Matrix4();
  for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2 + 0.13; const r = 0.74 + (k % 3) * 0.04; const c = { x: VB.x + Math.cos(a) * ringR, y: VB.y + Math.sin(a) * ringR, r }; sheath.push(c); m4.makeScale(r, r, 1).setPosition(c.x, c.y, 0); im.setMatrixAt(k, m4); }
  im.renderOrder = 3; leafGroup.add(tag(im, 'sheath'));
  const xyl = [[-0.85, 0.95, 0.58], [0.45, 1.2, 0.48], [1.25, 0.3, 0.36], [-0.15, 0.05, 0.4], [-1.45, 0.05, 0.32]];
  const tube = new THREE.CylinderGeometry(1, 1, D + 3, 26, 1, true); tube.rotateX(Math.PI / 2);
  const xm = new THREE.InstancedMesh(tube, M_xyl, xyl.length);
  const ringG = new THREE.TorusGeometry(1, 0.075, 5, 18);
  const rings = []; xyl.forEach(([dx, dy, r], k) => { m4.makeScale(r, r, 1).setPosition(VB.x + dx, VB.y + dy, 0); xm.setMatrixAt(k, m4); for (let z = -HZ - 0.5; z < HZ + 0.5; z += 0.62) rings.push([VB.x + dx, VB.y + dy, z, r * 0.93]); });
  xm.renderOrder = 3; leafGroup.add(tag(xm, 'xylem'));
  const rm = new THREE.InstancedMesh(ringG, M_ring, rings.length);
  rings.forEach(([x, y, z, r], k) => { m4.makeScale(r, r, r).setPosition(x, y, z); rm.setMatrixAt(k, m4); }); leafGroup.add(tag(rm, 'xylem'));
  const phl = [[-0.8, -1.25, 0.42], [0.45, -1.5, 0.38], [1.3, -0.85, 0.33], [-1.65, -0.55, 0.3], [-0.2, -2.05, 0.22], [1.0, -1.85, 0.2], [-1.2, -1.9, 0.18]];
  const pg = new THREE.CylinderGeometry(1, 1, D + 3, 18, 1, false); pg.rotateX(Math.PI / 2);
  const pm = new THREE.InstancedMesh(pg, M_phl, phl.length);
  phl.forEach(([dx, dy, r], k) => { m4.makeScale(r, r, 1).setPosition(VB.x + dx, VB.y + dy, 0); pm.setMatrixAt(k, m4); });
  pm.renderOrder = 3; leafGroup.add(tag(pm, 'phloem'));
  // sieve plates
  const plateG = new THREE.CircleGeometry(1, 16); const plates = [];
  phl.slice(0, 4).forEach(([dx, dy, r]) => { for (let z = -HZ + 1.3; z < HZ; z += 3.1) plates.push([VB.x + dx, VB.y + dy, z, r * 0.97]); });
  const plm = new THREE.InstancedMesh(plateG, new THREE.MeshStandardMaterial({ color: 0xd9dcc0, roughness: 0.6, transparent: true, opacity: 0.55, side: THREE.DoubleSide, clippingPlanes: CLIP }), plates.length);
  plates.forEach(([x, y, z, r], k) => { m4.makeScale(r, r, 1).setPosition(x, y, z); plm.setMatrixAt(k, m4); }); leafGroup.add(plm);
}

/* ---- stomata: guard-cell pairs with morph target (opening) */
const guardGeo = guardPairGeometry({ L: GUARD.L, rMid: GUARD.rMid, rPole: GUARD.rPole, wMax: GUARD.wMax });
const GD = guardGeo.userData;
const guardMeshes = STOMATA.map(s => {
  const m = new THREE.Mesh(guardGeo, M_guard); m.position.set(s.x, 0.72, s.z); m.rotation.y = s.rot; m.renderOrder = 4;
  m.morphTargetInfluences = [0.4]; leafGroup.add(tag(m, 'guard')); return m;
});
// dark substomatal floor seen through the pore from below
{
  const g = new THREE.CircleGeometry(1, 24); g.rotateX(Math.PI / 2);
  const im = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x06140a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: CLIP }), STOMATA.length);
  const m4 = new THREE.Matrix4(); STOMATA.forEach((s, k) => { m4.makeScale(1.6, 1, 2.2).setPosition(s.x, 3.8, s.z); im.setMatrixAt(k, m4); }); leafGroup.add(im);
}

/* ---- chloroplasts (instanced, animated) */
const CH = { type: [], cell: [], th: [], u: [], w: [], tilt: [], d0: [], sgn: [] };
function addChl(type, cell, n) {
  for (let k = 0; k < n; k++) {
    CH.type.push(type); CH.cell.push(cell); CH.th.push(R() * Math.PI * 2); CH.u.push(R()); CH.w.push((R() - 0.5) * 0.16); CH.tilt.push((R() - 0.5) * 0.5);
    CH.d0.push(new THREE.Vector3(R() - 0.5, (R() - 0.5) * 0.9, R() - 0.5).normalize()); CH.sgn.push(R() < 0.5 ? -1 : 1);
  }
}
pal.forEach((c, i) => addChl(0, i, c.front ? 20 : 5));
spo.forEach((c, i) => addChl(1, i, c.front ? 10 : 3));
STOMATA.forEach((s, i) => addChl(2, i, 12));
const SHEATH_C4 = 26, SHEATH_C3 = 4;
sheath.forEach((c, i) => addChl(3, i, SHEATH_C4));
const NCH = CH.type.length;
const chlGeo = new THREE.SphereGeometry(1, 8, 5);
const chlMesh = new THREE.InstancedMesh(chlGeo, M_chl, NCH);
chlMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
{ const c = new THREE.Color(); for (let i = 0; i < NCH; i++) { c.setHSL(0.285 + (R() - 0.5) * 0.05, 0.72 + R() * 0.2, 0.2 + R() * 0.08); if (CH.type[i] === 2) c.offsetHSL(0.02, 0, 0.04); chlMesh.setColorAt(i, c); } }
chlMesh.frustumCulled = false; leafGroup.add(tag(chlMesh, 'chloroplast'));
const chlPos = new Float32Array(NCH * 3);   // world positions (for particle targets)
const FRONT_CHL = []; for (let i = 0; i < NCH; i++) { const t = CH.type[i]; if ((t === 0 && pal[CH.cell[i]].front) || (t === 1 && spo[CH.cell[i]].front)) FRONT_CHL.push(i); }
const SPONGY_CHL = FRONT_CHL.filter(i => CH.type[i] === 1);
// nuclei
{
  const list = pal.filter(c => c.front);
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), M_nuc, list.length); const m4 = new THREE.Matrix4();
  list.forEach((c, i) => { const a = R() * Math.PI * 2; m4.makeScale(0.42, 0.55, 0.42).setPosition(c.x + Math.cos(a) * (c.r - 0.48), c.y0 + (c.y1 - c.y0) * (0.35 + R() * 0.3), c.z + Math.sin(a) * (c.r - 0.48)); im.setMatrixAt(i, m4); });
  leafGroup.add(tag(im, 'nucleus'));
}

const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3(), _P = new THREE.Vector3(), _UP = new THREE.Vector3(0, 1, 0);
function writeBasis(arr, i, X, Yv, Z, sx, sy, sz, p) {
  const o = i * 16;
  arr[o] = X.x * sx; arr[o + 1] = X.y * sx; arr[o + 2] = X.z * sx; arr[o + 3] = 0;
  arr[o + 4] = Yv.x * sy; arr[o + 5] = Yv.y * sy; arr[o + 6] = Yv.z * sy; arr[o + 7] = 0;
  arr[o + 8] = Z.x * sz; arr[o + 9] = Z.y * sz; arr[o + 10] = Z.z * sz; arr[o + 11] = 0;
  arr[o + 12] = p.x; arr[o + 13] = p.y; arr[o + 14] = p.z; arr[o + 15] = 1;
}
let c4Mode = false;
function updateChloroplasts(t) {
  const arr = chlMesh.instanceMatrix.array; const av = state.avoid;
  for (let i = 0; i < NCH; i++) {
    const type = CH.type[i], ci = CH.cell[i];
    let sx = 0.27, sy = 0.33, sz = 0.11;
    if (type === 0) {
      const c = pal[ci]; const th = CH.th[i] + CH.w[i] * t; const u = CH.u[i];
      const h = (0.5 + 0.5 * u) * (1 - av) + (0.04 + 0.92 * u) * av + 0.015 * Math.sin(t * 0.7 + i);
      const rr = c.r - 0.19; const ct = Math.cos(th), st = Math.sin(th);
      _P.set(c.x + ct * rr, c.y0 + c.r * 0.7 + (c.y1 - c.y0 - 1.4 * c.r) * h, c.z + st * rr);
      _Z.set(ct, 0, st); _X.set(-st, 0, ct); _Y.set(CH.tilt[i] * 0.4 * _X.x, 1, CH.tilt[i] * 0.4 * _X.z).normalize();
    } else if (type === 1) {
      const c = spo[ci]; const d0 = CH.d0[i]; const a = c.rot + CH.w[i] * t * 0.6; const ca = Math.cos(CH.w[i] * t * 0.6), sa = Math.sin(CH.w[i] * t * 0.6);
      const lx = d0.x * ca + d0.z * sa, lz = -d0.x * sa + d0.z * ca, ly = d0.y;
      const r = rfn(c.v, lx, ly, lz) * 0.8 * c.s;
      const px = lx * r * SP_SCALE.x, py = ly * r * SP_SCALE.y, pz = lz * r * SP_SCALE.z;
      const cr = Math.cos(c.rot), sr = Math.sin(c.rot);
      _P.set(c.x + px * cr + pz * sr, c.y + py, c.z - px * sr + pz * cr);
      _Z.set(_P.x - c.x, _P.y - c.y, _P.z - c.z).normalize(); _X.crossVectors(_UP, _Z); if (_X.lengthSq() < 1e-4) _X.set(1, 0, 0); _X.normalize(); _Y.crossVectors(_Z, _X);
      void a;
    } else if (type === 2) {
      const s = STOMATA[ci]; const k = state.aperture; const sgn = CH.sgn[i]; const tt = 0.18 + 0.64 * CH.u[i];
      guardCentre(GD, sgn, tt, k, _P); _P.y += (CH.d0[i].y) * 0.25; _P.x += CH.d0[i].x * 0.12;
      const cr = Math.cos(s.rot), sr = Math.sin(s.rot); const px = _P.x, pz = _P.z;
      _P.set(s.x + px * cr + pz * sr, 0.72 + _P.y, s.z - px * sr + pz * cr);
      _X.set(1, 0, 0); _Y.set(0, 1, 0); _Z.set(0, 0, 1); sx = 0.16; sy = 0.12; sz = 0.2;
    } else {
      const c = sheath[ci]; const idxIn = i % SHEATH_C4;
      if (!c4Mode && idxIn >= SHEATH_C3) { writeBasis(arr, i, _X.set(1, 0, 0), _Y.set(0, 1, 0), _Z.set(0, 0, 1), 0, 0, 0, _P.set(c.x, c.y, 0)); continue; }
      const th = CH.th[i] + CH.w[i] * t * 0.5; const rr = c.r - 0.18;
      _P.set(c.x + Math.cos(th) * rr, c.y + Math.sin(th) * rr, -HZ + D * CH.u[i]);
      _Z.set(Math.cos(th), Math.sin(th), 0); _Y.set(0, 0, 1); _X.crossVectors(_Y, _Z);
      sx = 0.24; sy = 0.34; sz = 0.11;
    }
    writeBasis(arr, i, _X, _Y, _Z, sx, sy, sz, _P);
    chlPos[i * 3] = _P.x; chlPos[i * 3 + 1] = _P.y; chlPos[i * 3 + 2] = _P.z;
  }
  chlMesh.instanceMatrix.needsUpdate = true;
}

/* ---- intercellular air-space sample points (for diffusion paths) */
const AIR = [];
for (let k = 0; k < 30000 && AIR.length < 700; k++) {
  const x = -HX + R() * W, z = -HZ + R() * D, y = 1.8 + R() * 17.8;
  if (Math.hypot(x - VB.x, y - VB.y) < VB.R + 0.3) continue;
  if (y > Y.sp1 + 0.3) { if (pal.some(c => (c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + 0.08) ** 2 && y > c.y0 && y < c.y1)) continue; }
  else if (spo.some(c => (c.x - x) ** 2 + ((c.y - y) * 1.4) ** 2 + (c.z - z) ** 2 < (1.45 * c.s) ** 2)) continue;
  AIR.push(new THREE.Vector3(x, y, z));
}
function nearAir(p, maxY = 99) { let best = AIR[0], bd = Infinity; for (const a of AIR) { if (a.y > maxY) continue; const d = a.distanceToSquared(p); if (d < bd) { bd = d; best = a; } } return best; }

/* ---- scale bar */
{
  const bar = new THREE.Mesh(new THREE.BoxGeometry(10, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  bar.position.set(HX - 5, -2.2, HZ + 0.6); leafGroup.add(bar);
  [-5, 5].forEach(dx => { const t = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), bar.material); t.position.set(HX - 5 + dx, -2.2, HZ + 0.6); leafGroup.add(t); });
  stage.addLabel([HX - 5, -3.2, HZ + 0.6], '100 µm');
}

/* ---- tissue labels */
const LABELS = [
  { at: [2, Y.cu + 0.3, HZ], html: 'Cuticle (wax)' },
  { at: [-9, (Y.pa1 + Y.ue1) / 2, HZ], html: 'Upper epidermis' },
  { at: [-HX + 1, 16.2, HZ], html: 'Palisade mesophyll' },
  { at: [-HX + 1, 7.2, HZ], html: 'Spongy mesophyll' },
  { at: [-14, 4.8, HZ], html: 'Air space' },
  { at: [VB.x, VB.y + VB.R + 0.4, HZ], html: 'Vein: xylem ↑ / phloem ↓' },
  { at: [VB.x + VB.R + 0.2, VB.y - 0.6, HZ], html: 'Bundle sheath' },
  { at: [1.5, -0.6, HZ + 0.3], html: 'Stoma (guard cells)', id: 'stomaLab' },
  { at: [1.5, 3.9, HZ], html: 'Substomatal cavity' },
  { at: [HX - 7, (Y.le0 + Y.le1) / 2, HZ], html: 'Lower epidermis' }
];
const labelObjs = LABELS.map(L => { const o = stage.addLabel(L.at, L.html); if (L.id) o.userData.id = L.id; return o; });
const stomaLabel = labelObjs.find(o => o.userData.id === 'stomaLab');

/* ================================================================ particles in the leaf */
const photonMat = new THREE.MeshBasicMaterial({ map: streakTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
photonMat.color.setRGB(2.4, 2.4, 2.4);
const PH_MAX = 420;
const photonMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 2.6, 0.15).translate(0, 1.3, 0), photonMat, PH_MAX);
photonMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); photonMesh.frustumCulled = false; photonMesh.count = 0;
photonMesh.setColorAt(0, new THREE.Color(1, 1, 1));
leafGroup.add(photonMesh);
const flashes = new SpriteCloud(500, { map: glyphTexture('dot'), blending: THREE.AdditiveBlending });
leafGroup.add(flashes.points);
const photons = []; const flashList = []; let phAcc = 0;
// leaf optics (illustrative): absorptance and attenuation length by colour band
const bandOf = nm => nm < 500 ? 'b' : nm < 580 ? 'g' : 'r';
const OPT = { b: { refl: 0.05, k: 0.55 }, g: { refl: 0.12, k: 0.13 }, r: { refl: 0.06, k: 0.4 } };
function spawnPhoton() {
  const nm = 400 + R() * 300; const col = photonColour(nm);
  photons.push({ x: -HX + 1 + R() * (W - 2), y: 44 + R() * 8, z: -HZ + 1 + R() * (D - 2), vy: -34, col, nm, depth: null, dir: -1 });
}
function updatePhotons(dt, rate) {
  phAcc += dt * rate;
  while (phAcc > 1) { phAcc -= 1; if (photons.length < PH_MAX) spawnPhoton(); }
  const m4 = new THREE.Matrix4(), c = new THREE.Color(); let n = 0;
  for (let i = photons.length - 1; i >= 0; i--) {
    const p = photons[i]; p.y += p.vy * dt;
    if (p.dir < 0 && p.depth == null && p.y <= Y.cu) {
      const o = OPT[bandOf(p.nm)];
      if (R() < o.refl) { p.dir = 1; p.vy = 34; p.y = Y.cu; }
      else { p.depth = -Math.log(1 - R() * 0.999) / o.k; }
    }
    if (p.depth != null && p.y <= Y.cu - p.depth) {
      if (Y.cu - p.depth > -0.2) { flashList.push({ x: p.x, y: p.y, z: p.z, a: 1, col: p.col }); photons.splice(i, 1); continue; }
    }
    if (p.y > 60 || p.y < -14) { photons.splice(i, 1); continue; }
  }
  for (const p of photons) {
    m4.makeScale(1, 1, 1); if (p.dir > 0) m4.makeRotationZ(Math.PI); m4.setPosition(p.x, p.y, p.z);
    photonMesh.setMatrixAt(n, m4); c.setRGB(p.col[0], p.col[1], p.col[2]); photonMesh.setColorAt(n, c); n++;
  }
  photonMesh.count = n; photonMesh.instanceMatrix.needsUpdate = true; if (photonMesh.instanceColor) photonMesh.instanceColor.needsUpdate = true;
  let k = 0;
  for (let i = flashList.length - 1; i >= 0; i--) { const f = flashList[i]; f.a -= dt * 3.2; if (f.a <= 0) { flashList.splice(i, 1); continue; } }
  for (const f of flashList) { if (k >= flashes.max) break; flashes.set(k++, f.x, f.y, f.z, 0.9 + (1 - f.a) * 0.9, f.a, f.col[0] * 3, f.col[1] * 3, f.col[2] * 3); }
  flashes.commit(k);
}

class GasFlow {
  constructor(type, { max = 400, size = 0.6, speed = 7 } = {}) {
    this.cloud = new SpriteCloud(max, { map: glyphTexture(type) }); this.max = max; this.size = size; this.speed = speed;
    this.p = []; this.acc = 0; this.rate = 0; this.maker = null;
  }
  update(dt, t) {
    this.acc += dt * this.rate;
    while (this.acc > 1) { this.acc -= 1; if (this.p.length < this.max && this.maker) { const pts = this.maker(); const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal'); this.p.push({ curve, len: curve.getLength(), s: 0, ph: R() * 50, v: 0.7 + R() * 0.6 }); } }
    let n = 0; const v = _P;
    for (let i = this.p.length - 1; i >= 0; i--) { const q = this.p[i]; q.s += dt * this.speed * q.v / q.len; if (q.s >= 1) this.p.splice(i, 1); }
    for (const q of this.p) {
      q.curve.getPointAt(q.s, v);
      const w = 0.22; v.x += w * Math.sin(t * 2.3 + q.ph); v.y += w * Math.sin(t * 1.9 + q.ph * 1.3); v.z += w * Math.cos(t * 2.1 + q.ph * 0.7);
      const a = Math.min(1, q.s * 10, (1 - q.s) * 10);
      this.cloud.set(n++, v.x, v.y, v.z, this.size, a);
    }
    this.cloud.commit(n);
  }
}
const co2 = new GasFlow('co2', { max: 380, size: 1.05, speed: 8 });
const o2 = new GasFlow('o2', { max: 380, size: 0.9, speed: 8 });
const h2o = new GasFlow('h2o', { max: 460, size: 0.85, speed: 9 });
[co2, o2, h2o].forEach(g => leafGroup.add(g.cloud.points));
const pickStoma = () => STOMATA[R() < 0.35 ? 0 : Math.floor(R() * STOMATA.length)];
const outside = s => new THREE.Vector3(s.x + (R() - 0.5) * 5, -3 - R() * 6, s.z + (R() - 0.5) * 5 + (s === STOMATA[0] ? 1.5 : 0));
const pore = s => new THREE.Vector3(s.x + (R() - 0.5) * 0.15, 0.72, s.z + (R() - 0.5) * 0.5);
const cavity = s => new THREE.Vector3(s.x + (R() - 0.5) * 1.6, 2.8 + R() * 1.6, s.z + (R() - 0.5) * 1.6);
const chlTarget = (list = FRONT_CHL) => { const i = list[Math.floor(R() * list.length)]; return new THREE.Vector3(chlPos[i * 3], chlPos[i * 3 + 1], chlPos[i * 3 + 2]); };
function inwardPath() {
  const s = pickStoma(); const tgt = chlTarget(); const cav = cavity(s);
  const mid = cav.clone().lerp(tgt, 0.5);
  return [outside(s), pore(s), cav, nearAir(mid).clone(), nearAir(tgt).clone(), tgt];
}
co2.maker = inwardPath;
o2.maker = () => inwardPath().reverse();
h2o.maker = () => {
  const s = pickStoma(); const cav = cavity(s);
  const src = nearAir(new THREE.Vector3(s.x + (R() - 0.5) * 7, 4 + R() * 5, s.z + (R() - 0.5) * 7), Y.sp1).clone();
  const out = outside(s); out.y -= 2;
  return [src, cav, pore(s), out];
};

/* ================================================================ chloroplast interior (built lazily) */
const CHL_POS = new THREE.Vector3(0, -400, 0);
const chloro = { group: null, grana: [], discMesh: null, thyMat: null, ribo: null, ring: null, beads: null, flows: null, photons: [], flashes: null, labels: [] };
function buildChloroplast() {
  const g = new THREE.Group(); g.position.copy(CHL_POS); g.visible = false; scene.add(g); chloro.group = g;
  const r2 = rng(77);
  const A = { x: 10, y: 3.4, z: 6 };
  const cutPlane = [new THREE.Plane(new THREE.Vector3(0, 0, -1), CHL_POS.z + 0.8)];
  const outer = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 44), fresnelMaterial({ color: 0xb2e79a, opacity: 0.06, rim: 0.55, clip: cutPlane, maxAlpha: 0.8 }));
  outer.scale.set(A.x + 0.35, A.y + 0.3, A.z + 0.3); outer.renderOrder = 6; g.add(outer); outer.userData.tissue = 'envelope';
  const inner = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 44), fresnelMaterial({ color: 0x9fdc86, opacity: 0.05, rim: 0.45, clip: cutPlane, maxAlpha: 0.7 }));
  inner.scale.set(A.x, A.y, A.z); inner.renderOrder = 6; g.add(inner); inner.userData.tissue = 'envelope';
  const stroma = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.MeshBasicMaterial({ color: 0x5f9a3e, transparent: true, opacity: 0.16, side: THREE.BackSide, depthWrite: false }));
  stroma.scale.set(A.x - 0.1, A.y - 0.1, A.z - 0.1); g.add(stroma);
  // grana
  const grana = [];
  for (let k = 0; k < 4000 && grana.length < 46; k++) {
    const x = (r2() * 2 - 1) * A.x * 0.84, y = (r2() * 2 - 1) * A.y * 0.55, z = (r2() * 2 - 1) * A.z * 0.8;
    if ((x / (A.x * 0.86)) ** 2 + (y / (A.y * 0.62)) ** 2 + (z / (A.z * 0.84)) ** 2 > 1) continue;
    if (grana.some(q => Math.hypot(q.x - x, (q.y - y) * 1.5, q.z - z) < 2.05)) continue;
    const n = 7 + Math.floor(r2() * 10); const tilt = (r2() - 0.5) * 0.35, tz = (r2() - 0.5) * 0.35;
    grana.push({ x, y, z, n, r: 0.62 + r2() * 0.22, tilt, tz });
  }
  chloro.grana = grana;
  const nDisc = grana.reduce((s, q) => s + q.n, 0);
  const thyMat = new THREE.MeshPhysicalMaterial({ color: 0x2f8a37, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25, sheen: 0.7, sheenColor: new THREE.Color(0xaaff99), emissive: 0x1d8a2c, emissiveIntensity: 0.1 });
  chloro.thyMat = thyMat;
  const disc = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 26, 1), thyMat, nDisc); const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  let di = 0;
  grana.forEach(q => {
    e.set(q.tilt, 0, q.tz); q4.setFromEuler(e); const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q4); q.up = up;
    for (let k = 0; k < q.n; k++) { const off = (k - (q.n - 1) / 2) * 0.115; pv.set(q.x, q.y, q.z).addScaledVector(up, off); const rr = q.r * (1 - 0.06 * Math.abs(k - (q.n - 1) / 2) / q.n); sc.set(rr, 0.07, rr); m4.compose(pv, q4, sc); disc.setMatrixAt(di++, m4); }
  });
  disc.userData.tissue = 'granum'; g.add(disc); chloro.discMesh = disc;
  // stroma lamellae linking neighbouring grana
  const links = [];
  grana.forEach((q, i) => { const nb = grana.map((o, j) => [j, Math.hypot(o.x - q.x, o.y - q.y, o.z - q.z)]).filter(([j]) => j > i).sort((a, b) => a[1] - b[1]).slice(0, 2); nb.forEach(([j, d]) => { if (d < 4.2) links.push([q, grana[j], d]); }); });
  const lamMat = new THREE.MeshPhysicalMaterial({ color: 0x4d9d45, roughness: 0.4, transparent: true, opacity: 0.85, side: THREE.DoubleSide, sheen: 0.4 });
  const lam = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lamMat, links.length * 2);
  let li = 0; const dirv = new THREE.Vector3(), mid = new THREE.Vector3();
  links.forEach(([a, b, d]) => { for (let s = 0; s < 2; s++) { const hA = ((r2() - 0.5) * a.n) * 0.1, hB = ((r2() - 0.5) * b.n) * 0.1; const pa = new THREE.Vector3(a.x, a.y + hA, a.z), pb = new THREE.Vector3(b.x, b.y + hB, b.z); dirv.subVectors(pb, pa); mid.addVectors(pa, pb).multiplyScalar(0.5); q4.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dirv.clone().normalize()); q4.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (r2() - 0.5) * 0.8)); sc.set(dirv.length(), 0.045, 0.5); m4.compose(mid, q4, sc); lam.setMatrixAt(li++, m4); } });
  lam.userData.tissue = 'lamella'; g.add(lam);
  // starch grains and plastoglobuli
  const free = (x, y, z, rr) => grana.every(q => Math.hypot(q.x - x, q.y - y, q.z - z) > q.r + rr + 0.4);
  const starchMat = new THREE.MeshPhysicalMaterial({ color: 0xf3ecd8, roughness: 0.55, sheen: 0.5, clearcoat: 0.3 });
  let ns = 0; for (let k = 0; k < 800 && ns < 3; k++) { const x = (r2() * 2 - 1) * 6.5, y = (r2() - 0.5) * 1.6, z = (r2() * 2 - 1) * 3.5; if (!free(x, y, z, 1.2)) continue; const s = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), starchMat); s.scale.set(1.5, 0.9, 1.1); s.position.set(x, y, z); s.rotation.set(r2(), r2(), r2()); s.userData.tissue = 'starch'; g.add(s); ns++; }
  const pgMat = new THREE.MeshPhysicalMaterial({ color: 0xf2c94c, roughness: 0.25, clearcoat: 0.8, emissive: 0x3a2a00 });
  const pgl = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), pgMat, 16); let np = 0;
  for (let k = 0; k < 2000 && np < 16; k++) { const x = (r2() * 2 - 1) * 8, y = (r2() - 0.5) * 3, z = (r2() * 2 - 1) * 4.6; if ((x / 9.3) ** 2 + (y / 3.1) ** 2 + (z / 5.5) ** 2 > 1 || !free(x, y, z, 0.3)) continue; const rr = 0.16 + r2() * 0.14; m4.makeScale(rr, rr, rr).setPosition(x, y, z); pgl.setMatrixAt(np++, m4); }
  pgl.count = np; pgl.userData.tissue = 'plastoglobule'; g.add(pgl);
  // Rubisco / ribosome dots in the stroma
  const ribo = new SpriteCloud(1600, { map: glyphTexture('dot') }); chloro.ribo = ribo; chloro.riboPts = [];
  for (let k = 0; k < 20000 && chloro.riboPts.length < 1600; k++) { const x = (r2() * 2 - 1) * A.x, y = (r2() * 2 - 1) * A.y, z = (r2() * 2 - 1) * A.z; if ((x / A.x) ** 2 + (y / A.y) ** 2 + (z / A.z) ** 2 > 0.92) continue; if (!free(x, y, z, 0.05)) continue; chloro.riboPts.push([x, y, z, r2() * 10]); }
  g.add(ribo.points);
  // Calvin–Benson cycle ring + beads
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.04, 8, 96), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.55 }));
  let rc = new THREE.Vector3(-3.5, 1.1, 2.6); for (let k = 0; k < 60 && !free(rc.x, rc.y, rc.z, 1.2); k++) rc.set((r2() * 2 - 1) * 5, (r2() - 0.5) * 1.5, 1.5 + r2() * 2.5);
  ring.position.copy(rc); ring.rotation.x = -0.35; g.add(ring); chloro.ring = ring;
  chloro.beads = new SpriteCloud(40, { map: glyphTexture('dot'), blending: THREE.AdditiveBlending }); g.add(chloro.beads.points);
  // flows inside: CO₂ in, sugar out, O₂ from thylakoids
  const mk = (type, size, speed, max) => { const c = new SpriteCloud(max, { map: glyphTexture(type) }); g.add(c.points); return { cloud: c, p: [], acc: 0, rate: 0, size, speed, max }; };
  chloro.flows = { co2: mk('co2', 0.7, 3.2, 120), sugar: mk('sugar', 0.75, 2.4, 120), o2: mk('o2', 0.6, 3.5, 160) };
  const phm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 2.4, 0.05).translate(0, 1.2, 0), photonMat, 160); phm.count = 0; phm.frustumCulled = false; phm.instanceMatrix.setUsage(THREE.DynamicDrawUsage); phm.setColorAt(0, new THREE.Color(1, 1, 1)); g.add(phm); chloro.phMesh = phm;
  chloro.flashes = new SpriteCloud(200, { map: glyphTexture('dot'), blending: THREE.AdditiveBlending }); g.add(chloro.flashes.points); chloro.flashList = [];
  chloro.A = A; chloro.rc = rc;
  // scale bar 1 µm ≈ 3.33 units
  const bar = new THREE.Mesh(new THREE.BoxGeometry(3.33, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0xffffff })); bar.position.set(A.x - 2, -A.y - 1.2, 3); g.add(bar);
  const labAt = (v, html) => { const o = stage.addLabel(v.clone().add(CHL_POS), html); o.visible = false; chloro.labels.push(o); return o; };
  labAt(new THREE.Vector3(A.x - 2, -A.y - 1.8, 3), '1 µm');
  labAt(new THREE.Vector3(-A.x + 1.2, A.y + 0.2, -1), 'Envelope (outer + inner membrane)');
  const gi = grana.reduce((b, q) => q.z > b.z ? q : b, grana[0]);
  chloro.granumLabel = labAt(new THREE.Vector3(gi.x, gi.y + 0.9, gi.z), 'Granum: stacked thylakoids (PSII)');
  chloro.ringLabel = labAt(rc.clone().add(new THREE.Vector3(0, 2.3, 0)), 'Stroma: Calvin–Benson cycle (Rubisco)');
  const lk = links[Math.floor(links.length / 2)]; if (lk) labAt(new THREE.Vector3((lk[0].x + lk[1].x) / 2, (lk[0].y + lk[1].y) / 2 - 0.4, (lk[0].z + lk[1].z) / 2), 'Stroma lamella (PSI, ATP synthase)');
  g.children.filter(c => c.userData.tissue === 'starch').slice(0, 1).forEach(s => labAt(s.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 'Starch grain'));
  g.traverse(o => { if (o.userData.tissue) pickables.push(o); });
}
function updateChloroplastInterior(dt, t) {
  const r = state.res; if (!r || !chloro.group) return;
  const q = r.q; const jf = q.Jmax > 0 ? r.q.J / q.Jmax : 0;
  chloro.thyMat.emissiveIntensity = 0.08 + 0.5 * jf + 0.08 * Math.sin(t * 6) * jf;
  // stroma dots jitter
  const rb = chloro.ribo; let n = 0;
  for (const [x, y, z, ph] of chloro.riboPts) { rb.set(n++, x + 0.06 * Math.sin(t * 3 + ph), y + 0.06 * Math.cos(t * 2.6 + ph * 1.7), z + 0.06 * Math.sin(t * 2.2 + ph * 0.6), 0.1, 0.55, 0.75, 0.95, 0.6); }
  rb.commit(n);
  // Calvin cycle beads: angular speed ∝ Vc
  const w = 0.12 * Math.max(0, r.Vc); const ring = chloro.ring; const bd = chloro.beads; const v = new THREE.Vector3();
  for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2 + t * w * 0.08; v.set(Math.cos(a) * 1.9, Math.sin(a) * 1.9, 0).applyEuler(ring.rotation).add(ring.position); const hue = k % 3; bd.set(k, v.x, v.y, v.z, 0.32, 0.95, hue === 0 ? 3 : 2.6, hue === 1 ? 1.2 : 2.4, hue === 2 ? 0.6 : 0.8); }
  bd.commit(24);
  const A = chloro.A, rc = chloro.rc;
  const envPt = () => { const a = R() * Math.PI * 2, b = (R() - 0.5) * 1.2; return new THREE.Vector3(Math.cos(a) * Math.cos(b) * A.x, Math.sin(b) * A.y, Math.sin(a) * Math.cos(b) * A.z); };
  const F = chloro.flows;
  F.co2.rate = Math.max(0, r.Vc) * 0.9; F.sugar.rate = Math.max(0, r.A) * 0.3; F.o2.rate = r.q.J / 4 * 0.45;
  const spawners = {
    co2: () => { const e = envPt(); return [e, e.clone().lerp(rc, 0.5).add(new THREE.Vector3(0, 1, 0)), rc.clone().add(new THREE.Vector3(1.9, 0, 0))]; },
    sugar: () => { const e = envPt(); return [rc.clone().add(new THREE.Vector3(-1.9, 0, 0)), rc.clone().lerp(e, 0.5), e.multiplyScalar(1.15)]; },
    o2: () => { const g = chloro.grana[Math.floor(R() * chloro.grana.length)]; const e = envPt(); return [new THREE.Vector3(g.x, g.y, g.z), new THREE.Vector3(g.x, g.y, g.z).lerp(e, 0.5), e.multiplyScalar(1.2)]; }
  };
  for (const [k, f] of Object.entries(F)) {
    f.acc += dt * f.rate; while (f.acc > 1) { f.acc -= 1; if (f.p.length < f.max) { const c = new THREE.CatmullRomCurve3(spawners[k]()); f.p.push({ c, len: c.getLength(), s: 0, ph: R() * 9 }); } }
    let m = 0; for (let i = f.p.length - 1; i >= 0; i--) { const p = f.p[i]; p.s += dt * f.speed / p.len; if (p.s >= 1) f.p.splice(i, 1); }
    for (const p of f.p) { p.c.getPointAt(p.s, v); v.x += 0.12 * Math.sin(t * 3 + p.ph); v.y += 0.12 * Math.cos(t * 2.7 + p.ph); f.cloud.set(m++, v.x, v.y, v.z, f.size, Math.min(1, p.s * 8, (1 - p.s) * 8)); }
    f.cloud.commit(m);
  }
  // photons onto grana
  const ph = chloro.photons; chloro.phAcc = (chloro.phAcc || 0) + dt * (ui.get('photons') ? r.q.ppfd * 0.035 : 0);
  while (chloro.phAcc > 1) { chloro.phAcc -= 1; if (ph.length < 150) { const g = chloro.grana[Math.floor(R() * chloro.grana.length)]; const nm = 400 + R() * 300; ph.push({ g, x: g.x + (R() - 0.5) * g.r, z: g.z + (R() - 0.5) * g.r, y: A.y + 9, col: photonColour(nm) }); } }
  const m4 = new THREE.Matrix4(), c = new THREE.Color(); let np = 0;
  for (let i = ph.length - 1; i >= 0; i--) { const p = ph[i]; p.y -= dt * 22; if (p.y <= p.g.y + 0.5) { chloro.flashList.push({ x: p.x, y: p.g.y + 0.4, z: p.z, a: 1, col: p.col }); ph.splice(i, 1); } }
  for (const p of ph) { m4.makeTranslation(p.x, p.y, p.z); chloro.phMesh.setMatrixAt(np, m4); c.setRGB(...p.col); chloro.phMesh.setColorAt(np, c); np++; }
  chloro.phMesh.count = np; chloro.phMesh.instanceMatrix.needsUpdate = true; if (chloro.phMesh.instanceColor) chloro.phMesh.instanceColor.needsUpdate = true;
  let nf = 0; for (let i = chloro.flashList.length - 1; i >= 0; i--) { const f = chloro.flashList[i]; f.a -= dt * 2.5; if (f.a <= 0) chloro.flashList.splice(i, 1); }
  for (const f of chloro.flashList) chloro.flashes.set(nf++, f.x, f.y, f.z, 1.1 + (1 - f.a), f.a, f.col[0] * 3, f.col[1] * 3, f.col[2] * 3);
  chloro.flashes.commit(nf);
}

/* ================================================================ views, tours, picking */
const TOURS = {
  overview: [[40, 30, 55], [0, 12.5, 0]],
  palisade: [[6, 21, 24], [-4, 15.5, 8]],
  stoma: null,
  vein: [[14, 12, 25], [VB.x, VB.y, 8]]
};
{ const s = STOMATA.slice(1).sort((a, b) => (b.z + b.x * 0.2) - (a.z + a.x * 0.2))[0] || STOMATA[0]; TOURS.stoma = [[s.x + 2.2, -7.5, s.z + 4.5], [s.x, 0.8, s.z]]; }
function tour(k) { if (state.view !== 'leaf') { goView('leaf').then(() => stage.flyTo(...TOURS[k], 1.6)); return; } stage.flyTo(...TOURS[k], 1.6); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHL_CAM = CHL_POS.clone().add(new THREE.Vector3(8, 9, 25));
async function goView(v, instant = false) {
  if (state.busy) return; if (v === state.view) { ui.set('view', v, true); return; }
  state.busy = true;
  if (v === 'chloro') {
    if (!chloro.group) buildChloroplast();
    const i = FRONT_CHL.find(j => CH.type[j] === 0 && chlPos[j * 3 + 2] > HZ - 1.2) ?? FRONT_CHL[0];
    const p = new THREE.Vector3(chlPos[i * 3], chlPos[i * 3 + 1], chlPos[i * 3 + 2]);
    controls.minDistance = 0.3;
    if (!instant) { await stage.flyTo(p.clone().add(new THREE.Vector3(1.2, 0.6, 3.2)), p, 2.0); fade.style.opacity = '1'; await sleep(480); }
    leafGroup.visible = false; labelObjs.forEach(o => { o.visible = false; }); chloro.group.visible = true;
    camera.position.copy(instant ? CHL_CAM : CHL_POS.clone().add(new THREE.Vector3(3, 5, 70))); controls.target.copy(CHL_POS); controls.update();
    controls.minDistance = 3; controls.maxDistance = 90;
    state.view = 'chloro'; applyLabels();
    fade.style.opacity = '0';
    if (!instant) await stage.flyTo(CHL_CAM, CHL_POS, 1.8);
    stage.setHome(CHL_CAM.toArray(), CHL_POS.toArray());
  } else {
    if (!instant) { fade.style.opacity = '1'; await sleep(480); }
    chloro.group.visible = false; leafGroup.visible = true;
    if (instant) camera.position.set(...TOURS.overview[0]); else camera.position.set(60, 44, 80);
    controls.target.set(...TOURS.overview[1]); controls.update();
    controls.minDistance = 2; controls.maxDistance = 160;
    state.view = 'leaf'; applyLabels();
    fade.style.opacity = '0';
    if (!instant) await stage.flyTo(...TOURS.overview, 1.6);
    stage.setHome(...TOURS.overview);
  }
  ui.set('view', v, true);
  state.busy = false; update();
}
function applyLabels() {
  const on = ui.get('labels');
  labelObjs.forEach(o => { o.visible = on && state.view === 'leaf'; });
  chloro.labels.forEach(o => { o.visible = on && state.view === 'chloro'; });
}
const INFO = {
  cuticle: ['Cuticle', 'A layer of cutin and waxes on the epidermis. It is nearly impermeable, so almost all CO₂ and water vapour must pass through the stomata.'],
  upperEpi: ['Upper (adaxial) epidermis', 'Transparent cells without chloroplasts. They let light through to the mesophyll and protect it.'],
  palisade: ['Palisade mesophyll', 'Column-shaped cells lined with chloroplasts, facing the light. Most light absorption and CO₂ fixation happens here.'],
  chloroplast: ['Chloroplast', 'Typically 5–10 µm long. Thylakoid membranes run the light reactions (electron transport J); the stroma runs the Calvin–Benson cycle with Rubisco. Press “Fly into a chloroplast”.'],
  spongy: ['Spongy mesophyll', 'Irregular, loosely packed cells separated by large air spaces that distribute CO₂ from the stomata and scatter light sideways.'],
  sheath: ['Bundle sheath', 'A ring of cells around the vein. In C4 plants (Kranz anatomy) these cells are packed with chloroplasts and hold Rubisco at a high CO₂ concentration.'],
  xylem: ['Xylem vessels', 'Dead, lignified tubes that bring water — and dissolved calcium — from the roots. Ring and helical wall thickenings stop them collapsing under tension.'],
  phloem: ['Phloem', 'Living sieve tubes (with sieve plates) and companion cells that export sugars (mainly sucrose) from the leaf.'],
  lowerEpi: ['Lower (abaxial) epidermis', 'In many dicot leaves this surface carries most or all of the stomata.'],
  guard: ['Guard cells', 'A kidney-shaped pair that swells (pore opens) or shrinks (pore closes). Unlike other epidermal cells they contain chloroplasts. Pore width here is computed from the model’s gₛ.'],
  nucleus: ['Nucleus', 'Pushed against the wall by the large central vacuole that fills most of the cell.'],
  envelope: ['Chloroplast envelope', 'Two membranes. CO₂ diffuses in; triose phosphates are exported through the phosphate translocator.'],
  granum: ['Granum', 'A stack of thylakoid discs rich in photosystem II and its light-harvesting antenna (LHCII). Water is split here, releasing O₂.'],
  lamella: ['Stroma lamella', 'Unstacked thylakoid membranes joining the grana; rich in photosystem I and ATP synthase.'],
  starch: ['Starch grain', 'Transitory starch made from triose phosphates during the day and broken down at night.'],
  plastoglobule: ['Plastoglobule', 'Lipid droplet attached to the thylakoids (stores and processes lipids and carotenoids).']
};
stage.onPick({
  objects: () => pickables.filter(o => { let p = o; while (p) { if (!p.visible) return false; p = p.parent; } return true; }),
  onClick: hit => {
    if (!hit) { info.style.display = 'none'; return; }
    const k = hit.object.userData.tissue; const d = INFO[k]; if (!d) return;
    info.innerHTML = `<b style="color:#9be7b6">${d[0]}</b><br>${d[1]}`; info.style.display = 'block';
    clearTimeout(info._t); info._t = setTimeout(() => { info.style.display = 'none'; }, 9000);
  }
});

/* ================================================================ charts */
const COL = { rubisco: 'water', rubp: 'amber', tpu: 'magenta', pepc: 'c6', light: 'amber' };
const lightPlot = new Plot('#chart-light', { x: { label: 'PPFD', unit: 'µmol m⁻² s⁻¹', min: 0, max: 2000 }, y: { label: 'Net assimilation A', unit: 'µmol m⁻² s⁻¹' } });
const aciPlot = new Plot('#chart-aci', { x: { label: 'Intercellular CO₂ Cᵢ', unit: 'µmol mol⁻¹', min: 0 }, y: { label: 'Net assimilation A', unit: 'µmol m⁻² s⁻¹' } });
const tempPlot = new Plot('#chart-temp', { x: { label: 'Leaf temperature', unit: '°C', min: 5, max: 45 }, y: { label: 'CO₂ flux', unit: 'µmol m⁻² s⁻¹' } });
const budget = new BarChart('#chart-budget', { y: { label: 'CO₂ flux', unit: 'µmol m⁻² s⁻¹', min: 0 }, horizontal: true, legend: false, height: 230 });

function drawCharts(p, r) {
  const C3 = p.path === 'C3';
  // light response
  const Is = linspace(0, 2000, 51);
  lightPlot.line('now', Is, Is.map(I => gasEx(p, { ppfd: I }).A), { color: 'accent', width: 2.6, label: `Current (${p.o2} % O₂, ${p.ca} ppm)` });
  const otherO = p.o2 === 21 ? 2 : 21;
  lightPlot.line('o2', Is, Is.map(I => gasEx(p, { ppfd: I, O: otherO * 10 }).A), { color: 'magenta', width: 1.8, dash: [6, 4], label: `${otherO} % O₂` });
  const altCa = p.ca < 800 ? 1000 : 425;
  lightPlot.line('ca', Is, Is.map(I => gasEx(p, { ppfd: I, Ca: altCa }).A), { color: 'water', width: 1.8, dash: [2, 3], label: `${altCa} ppm CO₂` });
  lightPlot.hline('zero', 0, { color: 'muted', dash: [2, 3] });
  lightPlot.point('pt', p.ppfd, r.A, { color: 'accent', r: 6, guides: true });
  // A–Ci
  const q = r.q; const ciMax = Math.max(1500, p.ca * 1.4);
  const cis = linspace(0, ciMax, 181); const rr = cis.map(c => leafRates(c, q));
  const keys = C3 ? ['rubisco', 'rubp', 'tpu'] : ['pepc', 'rubisco', 'light'];
  ['wc', 'wj', 'wp'].forEach(id => aciPlot.remove(id));
  if (C3) {
    aciPlot.line('wc', cis, rr.map(x => x.Wc - q.Rd), { color: COL.rubisco, width: 1.2, dash: [4, 4], label: 'Rubisco-limited (Ac)', opacity: 0.8 });
    aciPlot.line('wj', cis, rr.map(x => x.Wj - q.Rd), { color: COL.rubp, width: 1.2, dash: [4, 4], label: 'RuBP-regeneration-limited (Aj)', opacity: 0.8 });
    aciPlot.line('wp', cis, rr.map(x => x.Wp - q.Rd), { color: COL.tpu, width: 1.2, dash: [4, 4], label: 'TPU-limited (Ap)', opacity: 0.8 });
  } else {
    aciPlot.line('wc', cis, rr.map(x => x.Ac1), { color: COL.pepc, width: 1.2, dash: [4, 4], label: 'PEPC-limited', opacity: 0.8 });
    aciPlot.line('wj', cis, rr.map(x => x.Ac2), { color: COL.rubisco, width: 1.2, dash: [4, 4], label: 'Rubisco-limited', opacity: 0.8 });
    aciPlot.line('wp', cis, rr.map(x => Math.min(x.Aj1, x.Aj2)), { color: COL.light, width: 1.2, dash: [4, 4], label: 'Light-limited', opacity: 0.8 });
  }
  ['s_rubisco', 's_rubp', 's_tpu', 's_pepc', 's_light'].forEach(id => aciPlot.remove(id));
  keys.forEach(k => {
    const ys = rr.map((x, i) => (x.lim === k || (i > 0 && rr[i - 1].lim === k) || (i < rr.length - 1 && rr[i + 1].lim === k)) ? x.A : NaN);
    aciPlot.line('s_' + k, cis, ys, { color: COL[k], width: 3.2, noLegend: true, label: LIMIT_SHORT[k] });
  });
  const x0 = Math.max(0, r.Ci - 0.35 * (p.ca - r.Ci));
  aciPlot.line('supply', [x0, p.ca], [r.gtc * (p.ca - x0), 0], { color: 'ink', width: 1.6, dash: [7, 4], label: 'Stomatal supply' });
  aciPlot.vline('ca', p.ca, { color: 'muted', label: 'Cₐ' });
  aciPlot.hline('zero', 0, { color: 'muted', dash: [2, 3] });
  aciPlot.point('op', r.Ci, r.A, { color: 'ink', r: 6, label: 'operating point', guides: true });
  aciPlot.setAxis('x', { min: 0, max: ciMax });
  // temperature response
  const Ts = linspace(5, 45, 41); const tr = Ts.map(T => gasEx(p, { T }));
  tempPlot.line('A', Ts, tr.map(x => x.A), { color: 'accent', width: 2.8, label: 'Net A (coupled)' });
  tempPlot.line('ac', Ts, tr.map(x => x.Wc - x.q.Rd), { color: COL.rubisco, width: 1.3, dash: [4, 4], label: C3 ? 'Rubisco-limited' : 'Enzyme-limited' });
  tempPlot.line('aj', Ts, tr.map(x => x.Wj - x.q.Rd), { color: COL.rubp, width: 1.3, dash: [4, 4], label: C3 ? 'RuBP-regeneration-limited' : 'Light-limited' });
  tempPlot.line('pr', Ts, tr.map(x => x.PR), { color: 'magenta', width: 1.8, label: 'Photorespiration ½Vo' });
  tempPlot.line('rd', Ts, tr.map(x => x.q.Rd), { color: 'muted', width: 1.6, dash: [2, 3], label: 'Day respiration Rd' });
  tempPlot.vline('now', p.T, { color: 'ink', label: `${fmt(p.T, 1)} °C` });
  tempPlot.point('pt', p.T, r.A, { color: 'accent', r: 5 });
  // carbon budget
  budget.set(['Gross carboxylation Vc', 'Photorespiration ½Vo', 'Day respiration Rd', 'Net uptake A'], [{ label: 'Flux', values: [r.Vc, r.PR, r.q.Rd, Math.max(0, r.A)], colors: ['accent', 'magenta', 'muted', 'water'] }]);
}

/* ================================================================ update */
let chartT = null;
const GLYPH_URL = Object.fromEntries(['co2', 'o2', 'h2o', 'sugar'].map(k => [k, glyphTexture(k).image.toDataURL()]));
function update() {
  const p = ui.values();
  c4Mode = p.path === 'C4';
  ui.enable('tpu25', !c4Mode);
  const r = gasEx(p); state.res = r;
  const E = r.E * 1000; const a = poreAreaFor(r.gs, DENSITY, PORE_DEPTH); const w = 4 * a / (Math.PI * PORE_LEN) * 1e6;
  state.apertureTarget = Math.min(1, w / (GUARD.wMax * 10)); state.poreW = w;
  state.avoidTarget = THREE.MathUtils.smoothstep(p.ppfd, 150, 1000);
  // readouts
  ro.set('A', r.A, r.A > 8 ? 'ok' : r.A > 0 ? 'warn' : 'bad', r.A <= 0 ? 'net CO₂ release (respiration exceeds fixation)' : `gross O₂ evolution ≈ J/4 = ${fmt(r.q.J / 4, 1)}`);
  ro.set('lim', LIMIT_LABEL[r.lim] || r.lim, null, c4Mode ? 'C4: PEPC pump, Rubisco or light' : 'min(A<sub>c</sub>, A<sub>j</sub>, A<sub>p</sub>) − R<sub>d</sub>');
  ro.set('gs', r.gs, r.gs > 0.15 ? 'ok' : r.gs > 0.05 ? 'warn' : 'bad', `≈ ${fmt(100 * r.gs / GS_MAX, 0)} % of anatomical maximum`);
  const cr = r.Ci / p.ca;
  ro.set('ci', r.Ci, null, `Cᵢ/Cₐ = ${fmt(cr, 2)}`);
  ro.set('vc', r.Vc, null, c4Mode ? 'Rubisco carboxylation in bundle sheath' : `oxygenation V<sub>o</sub> = ${fmt(r.Vo, 1)}`);
  ro.set('pr', r.PR, r.Vc > 0 && r.PR / r.Vc > 0.25 ? 'warn' : null, r.Vc > 0 ? `${fmt(100 * r.PR / r.Vc, 0)} % of gross carboxylation` : '');
  ro.set('J', r.q.J, null, `${fmt(100 * r.q.J / Math.max(1e-9, r.q.Jmax), 0)} % of J<sub>max</sub>(T) = ${fmt(r.q.Jmax, 0)}`);
  ro.set('E', E, null, `at VPD ${fmt(p.vpd, 2)} kPa, well-stirred leaf`);
  ro.set('wue', E > 0 ? r.A / E : NaN, null, `intrinsic A/gₛ = ${fmt(r.A / r.gs, 0)} µmol mol⁻¹`);
  ro.set('ap', w, null, `${STOMATA.length} stomata in the block ≈ ${fmt(DENSITY / 1e6, 0)} mm⁻²`);
  hud.set('a', `A <b>${fmt(r.A, 1)}</b> µmol m⁻² s⁻¹ · <b>${LIMIT_SHORT[r.lim]}</b>-limited`);
  hud.set('g', `g<sub>s</sub> <b>${fmt(r.gs, 2)}</b> mol m⁻² s⁻¹ · C<sub>i</sub> <b>${fmt(r.Ci, 0)}</b> ppm`);
  hud.set('v', state.view === 'leaf' ? `Leaf block 440 × 220 µm · ${p.path}` : `Chloroplast ≈ 6 µm · J <b>${fmt(r.q.J, 0)}</b> µmol e⁻ m⁻² s⁻¹`);
  // particle rates
  const on = p.gases;
  co2.rate = on ? Math.max(0, r.A) * 1.5 : 0; o2.rate = on ? Math.max(0, r.A) * 1.5 : 0; h2o.rate = on ? E * 12 : 0;
  if (r.A < 0 && on) { o2.rate = 0; co2.rate = 0; state.resp = -r.A * 1.5; } else state.resp = 0;
  applyLabels();
  if (stomaLabel) stomaLabel.element.innerHTML = `Stoma · pore ${fmt(w, 1)} µm`;
  const molPerGlyph = (1 / 1.5) * 1e-6 * BLOCK_AREA_M2 * 6.022e23;
  const G = k => `<img src="${GLYPH_URL[k]}" width="20" height="20" alt="">`;
  const phot = '<span style="display:inline-block;width:18px;height:3px;background:linear-gradient(90deg,#6af,#fe6,#f55);border-radius:2px"></span>';
  legend.innerHTML = `<div style="display:grid;grid-template-columns:auto auto;gap:3px 10px;align-items:center">` + (state.view === 'leaf'
    ? `${phot}<span>photon (rate ∝ PPFD)</span>${G('co2')}<span>CO₂ in · 1 ≈ ${(molPerGlyph / 1e10).toFixed(1)}×10¹⁰ molecules</span>${G('o2')}<span>O₂ out (same scale)</span>${G('h2o')}<span>H₂O out · 1 ≈ 125× more molecules</span>`
    : `${phot}<span>photon absorbed by a granum</span>${G('co2')}<span>CO₂ to Rubisco (∝ V<sub>c</sub> = ${fmt(r.Vc, 1)})</span>${G('sugar')}<span>triose phosphate out (∝ A = ${fmt(r.A, 1)})</span>${G('o2')}<span>O₂ from water splitting (∝ J/4 = ${fmt(r.q.J / 4, 1)})</span>`) + '</div>';
  clearTimeout(chartT); chartT = setTimeout(() => drawCharts(p, r), 60);
}
ui.onChange((s, id) => { if (id === 'view') return; update(); });
update();
updateChloroplasts(0);

/* respiration in the dark: CO₂ leaves, O₂ enters */
const respOut = new GasFlow('co2', { max: 120, size: 0.75, speed: 8 }); leafGroup.add(respOut.cloud.points);
respOut.maker = () => inwardPath().reverse();
const respIn = new GasFlow('o2', { max: 120, size: 0.62, speed: 8 }); leafGroup.add(respIn.cloud.points);
respIn.maker = inwardPath;

stage.onFrame((dt, t) => {
  const p = ui.values();
  state.aperture += (state.apertureTarget - state.aperture) * Math.min(1, dt * 1.6);
  state.avoid += (state.avoidTarget - state.avoid) * Math.min(1, dt * 0.35);
  const h = renderer.domElement.height;
  if (state.view === 'leaf') {
    guardMeshes.forEach((m, i) => { m.morphTargetInfluences[0] = Math.max(0, state.aperture * (0.9 + 0.2 * Math.sin(i * 1.7))); });
    updateChloroplasts(t);
    [flashes, co2.cloud, o2.cloud, h2o.cloud, respOut.cloud, respIn.cloud].forEach(c => c.setViewport(camera, h));
    updatePhotons(dt, p.photons ? p.ppfd * 0.085 : 0);
    co2.update(dt, t); o2.update(dt, t); h2o.update(dt, t);
    respOut.rate = state.resp; respIn.rate = state.resp; respOut.update(dt, t); respIn.update(dt, t);
  } else if (chloro.group) {
    [chloro.ribo, chloro.beads, chloro.flashes, ...Object.values(chloro.flows).map(f => f.cloud)].forEach(c => c.setViewport(camera, h));
    updateChloroplastInterior(dt, t);
  }
});
setTimeout(() => { if (!chloro.group) buildChloroplast(); }, 2500);
if (new URLSearchParams(location.search).get('view') === 'chloro') setTimeout(() => goView('chloro', true), 300);
window.__leafLab = { goView, tour, stage, state, ui };
