/* ==========================================================================
   Vertical farm explorer — a walkable 3D plant factory driven by the annual
   facility balance in ./model.js (Derive tab, Eqs. V1–V10).
   ========================================================================== */
import { createStage, THREE, M, leafGeometry, leafMaterial, makeRack, makeTank, makePipe, surfaceMaterial, canvasTexture, RoundedBoxGeometry, BufferGeometryUtils, rng, ensureRectAreaLights } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { BarChart, Sankey } from '/assets/js/plot.js';
import { balance, layout, comparisons, ROOM, RACK_DEPTH, TIER_PITCH, BASE_H, USD_EUR } from './model.js';

/* ------------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'sue', label: 'Cultivation area · space-use efficiency', unit: '', format: v => v, note: '&nbsp;' })
  .add({ id: 'dli', label: 'Daily light integral', unit: 'mol m⁻² d⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'yield', label: 'Yield per m² of floor', unit: 'kg m⁻² yr⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'prod', label: 'Annual production', unit: 't yr⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'kwh', label: 'Electricity per kg', unit: 'kWh kg⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'wm2', label: 'Lighting power density', unit: 'W m⁻²', digits: 0, note: '&nbsp;' })
  .add({ id: 'cool', label: 'Cooling load, lights on', unit: 'kW', digits: 0, note: '&nbsp;' })
  .add({ id: 'water', label: 'Net water use', unit: 'L kg⁻¹', digits: 2, note: '&nbsp;' })
  .add({ id: 'co2', label: 'CO₂ bought · emitted', unit: 'kg kg⁻¹', format: v => v, note: '&nbsp;' })
  .add({ id: 'cost', label: 'Production cost', unit: '€ kg⁻¹', digits: 2, note: '&nbsp;' })
  .add({ id: 'head', label: 'Head weight at harvest', unit: 'g', digits: 0, note: '&nbsp;' })
  .add({ id: 'field', label: 'Land-use advantage over field lettuce', unit: '×', digits: 0, note: '&nbsp;' });

ui.section('Building');
ui.slider({ id: 'tiers', label: 'Growing tiers per rack', min: 1, max: 14, step: 1, value: 8, help: 'Tier pitch 0.45 m; the building grows taller with the racks' });
ui.slider({ id: 'aisle', label: 'Aisle width', min: 0.6, max: 1.6, step: 0.05, value: 1.0, unit: 'm', help: '≈ 0.6 m is only possible with mobile racks' });
ui.slider({ id: 'support', label: 'Support area (nursery, packing, plant rooms)', min: 10, max: 50, step: 1, value: 30, unit: '% of building' });
ui.section('Light and crop');
ui.slider({ id: 'ppfd', label: 'PPFD at the canopy', min: 100, max: 400, step: 5, value: 250, unit: 'µmol m⁻² s⁻¹' });
ui.slider({ id: 'photo', label: 'Photoperiod', min: 10, max: 22, step: 0.5, value: 16, unit: 'h d⁻¹' });
ui.slider({ id: 'eff', label: 'LED photon efficacy', min: 1.8, max: 4.0, step: 0.05, value: 2.8, unit: 'µmol J⁻¹', help: 'DLC minimum 2.5 (2025) · good 2025 fixtures 2.8–3.5 · projected maximum ≈ 3.4 (white + red), 4.1 (red + blue)' });
ui.slider({ id: 'cap', label: 'Photon capture efficiency', min: 0.6, max: 0.98, step: 0.01, value: 0.85, help: 'Photons reaching the canopy ÷ photons emitted' });
ui.slider({ id: 'lue', label: 'Light-use efficiency', min: 0.2, max: 1.2, step: 0.01, value: 0.55, unit: 'g DW mol⁻¹', format: v => `${fmt(v, 2)} g DW mol⁻¹ (${fmt(v / (ui.get('dm') || 5) * 100, 1)} g FW)`, help: 'Mean of vertical farms 0.55; greenhouses 0.39; field 0.23 (Jin et al. 2023)' });
ui.slider({ id: 'dm', label: 'Dry-matter content of lettuce', min: 3.5, max: 7, step: 0.1, value: 5, unit: '%' });
ui.slider({ id: 'cycle', label: 'Crop cycle (transplant → harvest)', min: 18, max: 45, step: 1, value: 30, unit: 'd' });
ui.slider({ id: 'density', label: 'Planting density', min: 12, max: 40, step: 1, value: 25, unit: 'plants m⁻²' });
ui.slider({ id: 'util', label: 'Production days per year', min: 0.8, max: 1, step: 0.01, value: 0.95, format: v => `${fmt(v * 365, 0)} d (${fmt(v * 100, 0)} %)` });
ui.section('Climate and resources');
ui.slider({ id: 'cop', label: 'Cooling COP of the HVAC', min: 2, max: 8, step: 0.1, value: 4.5, help: 'Kozai (2013): 5–6 annual mean in Tokyo; cold climates allow free cooling' });
ui.slider({ id: 'aux', label: 'Fans, pumps, controls', min: 2, max: 15, step: 0.5, value: 6, unit: '% of lighting' });
ui.slider({ id: 'rec', label: 'Transpired water recovered at the coil', min: 80, max: 99, step: 1, value: 95, unit: '%' });
ui.slider({ id: 'cue', label: 'CO₂ use efficiency', min: 0.5, max: 0.95, step: 0.01, value: 0.88, help: 'Kozai (2013): 0.87–0.89 in a closed plant factory' });
ui.section('Economics');
ui.slider({ id: 'price', label: 'Electricity price', min: 0.03, max: 0.4, step: 0.002, value: 0.084, unit: '€ kWh⁻¹', help: 'Sweden 2025-S1, non-household 2–20 GWh yr⁻¹, excl. VAT: 0.084; EU-27: 0.164 (Eurostat)' });
ui.slider({ id: 'grid', label: 'Grid emission factor', min: 0, max: 800, step: 1, value: 35, unit: 'g CO₂ kWh⁻¹', help: 'Sweden 35, EU-27 average 211 (2024; Ember via Our World in Data)' });
ui.slider({ id: 'capex', label: 'Investment', min: 500, max: 4000, step: 10, value: 1650, unit: '€ m⁻² cultivation', help: 'Japanese PFALs US$ 668–3409 m⁻²; US$ 1808 at 3000 m² (Zhuang et al. 2022)' });
ui.slider({ id: 'life', label: 'Depreciation period', min: 5, max: 25, step: 1, value: 15, unit: 'yr' });
ui.slider({ id: 'rate', label: 'Interest rate', min: 0, max: 12, step: 0.5, value: 5, unit: '%' });
ui.slider({ id: 'labour', label: 'Labour cost', min: 50, max: 700, step: 5, value: 255, unit: '€ m⁻² yr⁻¹', help: 'US$ 279 m⁻² yr⁻¹ in Japanese PFALs (Zhuang et al. 2022)' });
ui.slider({ id: 'cons', label: 'Seeds, nutrients, water', min: 0.2, max: 2, step: 0.01, value: 0.78, unit: '€ kg⁻¹' });
ui.slider({ id: 'pack', label: 'Packaging and logistics', min: 0.2, max: 3, step: 0.01, value: 1.25, unit: '€ kg⁻¹' });
ui.section('Scene');
ui.segmented({ id: 'spec', label: 'LED spectrum (display only)', options: [{ value: 'white', label: 'White' }, { value: 'magenta', label: 'Red + blue' }], value: 'white' });
ui.segmented({ id: 'clockSpeed', label: 'Day clock', options: [{ value: 0, label: 'Stop' }, { value: 1800, label: '½ h/s' }, { value: 7200, label: '2 h/s' }], value: 1800, persist: false });
ui.toggle({ id: 'labels', label: 'Labels', value: false });
const walkBtn = ui.buttons([{ label: '🚶 Walk through the farm', variant: 'primary', onClick: () => walk ? exitWalk() : enterWalk() }])[0];
ui.buttons([{ label: 'Aisle', onClick: () => tour('aisle') }, { label: 'Tier close-up', onClick: () => tour('tier') }, { label: 'Plant room', onClick: () => tour('tech') }, { label: 'Overview', onClick: () => tour('home') }]);
ui.presets([
  { label: 'Swedish grid & price', values: { tiers: 8, aisle: 1.0, ppfd: 250, photo: 16, eff: 2.8, cap: 0.85, lue: 0.55, cop: 4.5, aux: 6, price: 0.084, grid: 35, capex: 1650, labour: 255 } },
  { label: 'Japanese PFAL', values: { tiers: 10, aisle: 0.9, ppfd: 300, photo: 16, eff: 2.6, cap: 0.9, lue: 0.7, cop: 5.5, aux: 6, price: 0.15, capex: 1650, labour: 255 } },
  { label: 'High-cost start-up', values: { tiers: 6, aisle: 1.4, ppfd: 250, photo: 16, eff: 2.5, cap: 0.75, lue: 0.45, cop: 3.5, aux: 8, price: 0.164, grid: 211, capex: 3100, labour: 380 } },
  { label: '2030 efficient', values: { tiers: 12, aisle: 0.8, ppfd: 250, photo: 16, eff: 3.4, cap: 0.92, lue: 0.8, cop: 6, aux: 4, price: 0.084, grid: 35, capex: 1400, labour: 200 } }
]);
ui.saveButton('vertical-farm-explorer', () => ro.values());

/* ------------------------------------------------------------------ 3D stage */
ensureRectAreaLights();
const stage = createStage('#stage', {
  background: '#06090a', envIntensity: 0.2, exposure: 0.95,
  camera: { pos: [-12.8, 4.9, 10.8], target: [-0.5, 1.7, 0], fov: 42, far: 300 },
  controls: { minDistance: 1.2, maxDistance: 45, maxPolarAngle: Math.PI * 0.49 },
  bloom: { strength: 0.6, radius: 0.5, threshold: 1.0 }, ao: { radius: 0.35, intensity: 0.85 },
  fog: { color: '#06090a', density: 0.012 },
  hint: 'Drag to orbit · right-drag to pan · scroll to zoom · “Walk” for first person'
});
const { scene, camera } = stage;
const hud = hudChips(stage.el);
const TECH = 3.4;                         // m, plant room beyond the east end of the grow room
const hemi = new THREE.HemisphereLight(0xcfdcff, 0x1c1f1d, 0.35); scene.add(hemi);
const ledSun = new THREE.DirectionalLight(0xfff0e6, 1.2); ledSun.position.set(2, 20, 1); ledSun.target.position.set(0, 0, 0); scene.add(ledSun, ledSun.target);
const workLight = new THREE.DirectionalLight(0xe8f0ff, 0.25); workLight.position.set(-8, 12, 10); scene.add(workLight);

/* ---- shared materials and geometries */
const MAT = {
  rack: M.paintedSteel(0xd4d7d3), tray: new THREE.MeshStandardMaterial({ color: 0xd8dbd6, roughness: 0.5 }),
  housing: M.aluminium(), led: new THREE.MeshStandardMaterial({ color: 0x151515, emissive: 0xffffff, emissiveIntensity: 3, roughness: 0.3 }),
  line: new THREE.MeshStandardMaterial({ color: 0xd8a51c, roughness: 0.6 }), duct: M.galvanised(), dark: M.plastic(0x2a2d31, 0.5),
  leaf: leafMaterial({ gloss: 0.4 }), pvc: M.pvc(), insul: M.plastic(0x16181a, 0.8)
};
MAT.leaf.emissive = new THREE.Color(0x000000);
// no bump map on the instanced crop: screen-space bump derivatives of thousands of tiny, thin leaf bases
// produce NaN pixels that the bloom pass spreads into a white haze
MAT.leaf.bumpMap = null; MAT.leaf.needsUpdate = true;
const UNIT = new THREE.BoxGeometry(1, 1, 1);
const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s3 = new THREE.Vector3(), v3 = new THREE.Vector3(), eul = new THREE.Euler();
function inst(geo, mat, list) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  list.forEach((t, i) => { eul.set(0, t[3] || 0, 0); q4.setFromEuler(eul); m4.compose(v3.set(t[0], t[1], t[2]), q4, s3.set(t[4] ?? 1, t[5] ?? 1, t[6] ?? 1)); im.setMatrixAt(i, m4); });
  im.count = list.length; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); return im;
}
/** Low-poly butterhead lettuce for instancing (same construction as lettuceGeometry in lab3d, fewer segments). */
function lettuceLow({ radius = 0.12, leaves = 10, growth = 1, segU = 5, segV = 3, seed = 3 } = {}) {
  const r = rng(seed); const n = Math.max(3, Math.round(leaves * (0.35 + 0.65 * growth)));
  const R = radius * (0.25 + 0.75 * Math.pow(growth, 0.7)); const geos = [];
  for (let k = 0; k < n; k++) {
    const age = 1 - k / n, inner = age < 0.33;
    const len = R * (0.5 + 0.8 * age) * (0.9 + r() * 0.2);
    const pitch = inner ? 0.12 + 0.5 * age : 0.35 + 0.95 * Math.pow(age, 1.2) + (r() - 0.5) * 0.18;
    const curl = inner ? -0.55 + 0.4 * age : 0.25 + 0.55 * age;
    const g = leafGeometry({ length: len, width: len * 0.98, pitch, curl, cup: 0.5 * (inner ? 1.6 : 1.25 - age * 0.5), ruffle: 0.004 * len / 0.1, ruffleFreq: 6, shape: 'round', seed: seed * 100 + k, colors: inner ? ['#e3efac', '#e3efac', '#a2cd52'] : ['#e3efac', '#a2cd52', age > 0.55 ? '#62a032' : '#a2cd52'], segU, segV });
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(k * 2.39996 + r() * 0.2).multiply(new THREE.Matrix4().makeTranslation(0, 0.004 * k / n, R * (inner ? 0.02 : 0.05) * age)));
    geos.push(g);
  }
  const merged = BufferGeometryUtils.mergeGeometries(geos, false); geos.forEach(g => g.dispose()); return merged;
}
const STAGES = [0.22, 0.45, 0.7, 0.95];
let plantGeo = null, plantKey = '';
function buildPlantGeos(radius) {
  const key = radius.toFixed(3); if (key === plantKey) return; plantKey = key;
  if (plantGeo) plantGeo.forEach(s => s.forEach(g => g.dispose()));
  // three levels of detail per growth stage: near (close-ups), mid, far
  plantGeo = STAGES.map((g, i) => [lettuceLow({ radius, leaves: 16, growth: g, segU: 12, segV: 8, seed: 7 + i }), lettuceLow({ radius, leaves: 11, growth: g, segU: 6, segV: 4, seed: 7 + i }), lettuceLow({ radius, leaves: 7, growth: g, segU: 3, segV: 2, seed: 7 + i })]);
}

/* ---- room shell */
const room = new THREE.Group(); scene.add(room);
const farm = new THREE.Group(); scene.add(farm);
const panelTex = canvasTexture(512, 512, (c, w, h) => {
  c.fillStyle = '#dfe3e0'; c.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 128) { c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(x, 0, 3, h); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x + 3, 0, 2, h); }
  c.fillStyle = 'rgba(0,0,0,0.05)'; for (let y = 0; y < h; y += 8) c.fillRect(0, y, w, 1);
}, { key: 'vf-panels', repeat: [1, 1] });
function buildRoom(L) {
  room.children.slice().forEach(ch => { room.remove(ch); if (ch.geometry && ch.geometry !== UNIT) ch.geometry.dispose(); });
  const H = L.roomH, LX = ROOM.L + TECH, cx = TECH / 2;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(LX, ROOM.W), surfaceMaterial('epoxy', [LX / 2, ROOM.W / 2]));
  floor.material.color.set(0x7f8a86); floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0, 0); room.add(floor);
  const wallTex = panelTex.clone(); wallTex.repeat.set(LX / 2.4, 1); wallTex.needsUpdate = true;
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.75, side: THREE.BackSide });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(LX, H, ROOM.W), [wallMat, wallMat, new THREE.MeshStandardMaterial({ color: 0x2b2f31, roughness: 0.9, side: THREE.BackSide }), new THREE.MeshStandardMaterial({ visible: false }), wallMat, wallMat]);
  shell.position.set(cx, H / 2, 0); room.add(shell);
  // glazed partition between grow room and plant room
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.W, H), M.glassCheap(0.1)); glass.rotation.y = Math.PI / 2; glass.position.set(ROOM.L / 2, H / 2, 0); room.add(glass);
  [-ROOM.W / 2 + 0.05, -2.5, 2.5, ROOM.W / 2 - 0.05].forEach(z => { const m = new THREE.Mesh(UNIT, M.aluminium()); m.scale.set(0.08, H, 0.08); m.position.set(ROOM.L / 2, H / 2, z); room.add(m); });
  // ceiling light panels
  for (let x = -8; x <= 8; x += 4) for (let z = -4.5; z <= 4.5; z += 4.5) { const p = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), M.emissive(0xe8f2ff, 0.9)); p.rotation.x = Math.PI / 2; p.position.set(x, H - 0.02, z); room.add(p); }
}

/* ---- racks, trays, LED bars and plants (instanced) */
let segments = [], rectLights = [], layoutKey = '', LAY = null;
function buildFarm(p, L) {
  farm.children.slice().forEach(ch => { farm.remove(ch); if (ch.isInstancedMesh) ch.dispose(); else if (ch.geometry) ch.geometry.dispose(); });
  rectLights.forEach(l => scene.remove(l)); rectLights = []; segments = [];
  const posts = [], trays = [], beams = [], housings = [], strips = [], lines = [], ends = [];
  const topY = BASE_H + p.tiers * TIER_PITCH;
  L.rowZ.forEach((z, ri) => L.segX.forEach((x, si) => {
    const x0 = x - ROOM.segLen / 2;
    for (let k = 0; k <= 7; k++) [-1, 1].forEach(sd => posts.push([x0 + k * 1.25, L.rackTop / 2, z + sd * (RACK_DEPTH / 2 - 0.03), 0, 0.055, L.rackTop, 0.055]));
    for (let t = 0; t < p.tiers; t++) {
      const y = BASE_H + t * TIER_PITCH;
      trays.push([x, y - 0.025, z, 0, ROOM.segLen - 0.04, 0.05, RACK_DEPTH - 0.04]);
      [-1, 1].forEach(sd => beams.push([x, y - 0.07, z + sd * (RACK_DEPTH / 2 - 0.03), 0, ROOM.segLen, 0.045, 0.045]));
      const ly = y + TIER_PITCH - 0.085;
      [-0.42, 0, 0.42].forEach(dz => { housings.push([x, ly + 0.016, z + dz, 0, ROOM.segLen - 0.2, 0.024, 0.085]); strips.push([x, ly, z + dz, 0, ROOM.segLen - 0.25, 0.012, 0.065]); });
    }
    [-1, 1].forEach(sd => beams.push([x, topY - 0.02, z + sd * (RACK_DEPTH / 2 - 0.03), 0, ROOM.segLen, 0.05, 0.05]));
    [-1, 1].forEach(sd => lines.push([x, 0.003, z + sd * (RACK_DEPTH / 2 + 0.12), 0, ROOM.segLen + 0.4, 0.002, 0.06]));
    ends.push([x0 - 0.02, topY / 2, z, 0, 0.02, topY - 0.3, RACK_DEPTH - 0.1], [x0 + ROOM.segLen + 0.02, topY / 2, z, 0, 0.02, topY - 0.3, RACK_DEPTH - 0.1]);
    segments.push({ x, z, ri, si, groups: [] });
    // aisle light spill: one soft rect light per rack segment, facing the floor
    // (no area lights here: their specular spikes on glossy leaves overdrive the bloom pass)
  }));
  farm.add(inst(UNIT, MAT.rack, posts), inst(UNIT, MAT.tray, trays), inst(UNIT, MAT.rack, beams), inst(UNIT, MAT.housing, housings), inst(UNIT, MAT.led, strips), inst(UNIT, MAT.line, lines), inst(UNIT, new THREE.MeshStandardMaterial({ color: 0xd9ddd9, roughness: 0.7, transparent: true, opacity: 0.55 }), ends));
  // irrigation risers at segment ends
  L.rowZ.forEach(z => L.segX.forEach(x => { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, topY, 12), MAT.pvc); r.position.set(x + ROOM.segLen / 2 + 0.1, topY / 2, z + 0.45); farm.add(r); }));
  // row signs
  L.rowZ.forEach((z, ri) => L.segX.forEach((x, si) => {
    const txt = `${String.fromCharCode(65 + ri)}${si + 1}`;
    const tex = canvasTexture(128, 64, (c, w, h) => { c.fillStyle = '#1d6b45'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = '700 40px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, w / 2, h / 2 + 2); }, { key: 'vf-sign-' + txt });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.21), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
    s.position.set(x - ROOM.segLen / 2 - 0.05, Math.min(2.2, topY - 0.2), z); s.rotation.y = -Math.PI / 2; farm.add(s);
  }));
  plantsPlace(p, L);
}
/** Place plants: each segment carries four growth stages from its west (young) to its east end (ready). */
const BAND = 2;                 // tiers per instanced plant group
function plantsPlace(p, L) {
  segments.forEach(sg => { sg.groups.forEach(g => { farm.remove(g.mesh); g.mesh.dispose(); }); sg.groups = []; });
  const nx = 28, nz = 4, dx = ROOM.segLen / nx, rr = rng(11);
  segments.forEach(sg => {
    for (let t0 = 0; t0 < p.tiers; t0 += BAND) {
      const buckets = STAGES.map(() => []);
      for (let t = t0; t < Math.min(p.tiers, t0 + BAND); t++) {
        const y = BASE_H + t * TIER_PITCH;
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
          const st = Math.min(3, Math.floor(i / (nx / 4))), jitter = (rr() - 0.5) * 0.03;
          buckets[st].push([sg.x - ROOM.segLen / 2 + (i + 0.5) * dx + jitter, y + 0.002, sg.z + (j - 1.5) * 0.29 + jitter, rr() * 6.28, 0.9 + rr() * 0.2, 0.85 + rr() * 0.3, 0.9 + rr() * 0.2]);
        }
      }
      buckets.forEach((b, st) => {
        if (!b.length) return;
        const im = inst(plantGeo[st][2], MAT.leaf, b); im.userData.stage = st; farm.add(im);
        sg.groups.push({ mesh: im, cx: sg.x - ROOM.segLen / 2 + (st + 0.5) * ROOM.segLen / 4, cy: BASE_H + (t0 + BAND / 2) * TIER_PITCH, cz: sg.z, lod: 2 });
      });
    }
  });
}
function updateLOD() {
  const cp = camera.position;
  segments.forEach(sg => sg.groups.forEach(g => {
    const d = Math.hypot(Math.max(0, Math.abs(cp.x - g.cx) - ROOM.segLen / 8), Math.max(0, Math.abs(cp.y - g.cy) - TIER_PITCH), Math.max(0, Math.abs(cp.z - g.cz) - RACK_DEPTH / 2));
    const lod = d < 2.4 ? 0 : d < 7 ? 1 : 2;
    if (lod !== g.lod) { g.lod = lod; g.mesh.geometry = plantGeo[g.mesh.userData.stage][lod]; }
  }));
}

/* ---- plant room: air handling units, tanks, cabinets */
const tech = new THREE.Group(); scene.add(tech);
const fans = [];
function buildTech(L) {
  tech.children.slice().forEach(ch => tech.remove(ch));
  fans.length = 0;
  const xB = ROOM.L / 2 + TECH / 2 + 0.2;
  [-3.6, 3.6].forEach((z, k) => {
    const ahu = new THREE.Group(); ahu.position.set(xB + 0.35, 0, z); tech.add(ahu);
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.8, 2.4, 2.6, 2, 0.04), M.paintedSteel(0xc9cfcc)); body.position.y = 1.25; ahu.add(body);
    for (let i = 0; i < 3; i++) { const seam = new THREE.Mesh(UNIT, M.paintedSteel(0x9aa19e)); seam.scale.set(0.01, 2.3, 0.02); seam.position.set(-0.905, 1.25, -0.85 + i * 0.85); ahu.add(seam); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.04, 10, 40), M.steel()); ring.rotation.y = Math.PI / 2; ring.position.set(-0.92, 1.45, 0); ahu.add(ring);
    const hub = new THREE.Group(); hub.position.set(-0.93, 1.45, 0); ahu.add(hub);
    for (let b = 0; b < 6; b++) { const bl = new THREE.Mesh(UNIT, M.aluminium()); bl.scale.set(0.02, 0.4, 0.12); bl.position.set(0, 0.2, 0); const piv = new THREE.Group(); piv.rotation.x = b * Math.PI / 3; piv.add(bl); bl.rotation.y = 0.5; hub.add(piv); }
    fans.push(hub);
    const grille = new THREE.Mesh(new THREE.CircleGeometry(0.45, 32), new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true, opacity: 0.35, side: THREE.DoubleSide })); grille.rotation.y = Math.PI / 2; grille.position.set(-0.95, 1.45, 0); ahu.add(grille);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.22), M.emissive(0x2cff9a, 0.6)); panel.rotation.y = -Math.PI / 2; panel.position.set(-0.91, 2.05, 0.8); ahu.add(panel);
    const up = makePipe([[xB + 0.35, 2.45, z], [xB + 0.35, L.roomH - 0.6, z], [xB - 0.4, L.roomH - 0.55, z * 0.5], [ROOM.L / 2, L.roomH - 0.5, z * 0.3]], { radius: 0.32, material: MAT.duct, tension: 0.2 }); tech.add(up);
  });
  // chilled water and condensate
  tech.add(makePipe([[xB + 0.35, 0.3, -2.2], [xB + 0.35, 0.3, 2.2]], { radius: 0.06, material: MAT.insul }));
  const cond = makeTank({ w: 0.8, h: 0.9, d: 0.8, material: 'plastic', color: 0x2c4658, level: 0.6, waterTint: 0x3f8fb0 }); cond.position.set(xB - 0.6, 0, -1.0); tech.add(cond); tech.userData.cond = cond;
  const nut = [0, 1, 2].map(i => { const t = makeTank({ w: 0.6, h: 1.1, d: 0.6, material: 'plastic', color: [0x2f5d3c, 0x5d3c2f, 0x3c3f5d][i], level: 0.75, waterTint: 0x6c9f58 }); t.position.set(xB - 0.9 + i * 0.75, 0, 1.4); tech.add(t); return t; });
  tech.userData.nut = nut;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.0, 1.6), M.paintedSteel(0x6b7178)); cab.position.set(ROOM.L / 2 + TECH - 0.3, 1.0, 5.2); tech.add(cab);
  for (let i = 0; i < 8; i++) { const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), M.emissive(i % 3 ? 0x2cff6a : 0xffb020, 3)); led.position.set(ROOM.L / 2 + TECH - 0.56, 1.5 - (i % 4) * 0.1, 4.8 + Math.floor(i / 4) * 0.3); tech.add(led); }
  // supply ducts over every aisle, with diffusers
  const aisleZs = []; for (let i = 0; i < LAY.rowZ.length - 1; i++) aisleZs.push((LAY.rowZ[i] + LAY.rowZ[i + 1]) / 2);
  aisleZs.push(LAY.rowZ[0] - RACK_DEPTH / 2 - 0.6, LAY.rowZ[LAY.rowZ.length - 1] + RACK_DEPTH / 2 + 0.6);
  aisleZs.forEach(z => {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, ROOM.L - 1.2, 28, 1, true), MAT.duct); d.rotation.z = Math.PI / 2; d.position.set(0, L.roomH - 0.5, z); tech.add(d);
    for (let x = -9; x <= 9; x += 3) { const df = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.12, 20), M.plasticGrey()); df.position.set(x, L.roomH - 0.8, z); tech.add(df); }
  });
  const header = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, ROOM.W - 1, 28, 1, true), MAT.duct); header.rotation.x = Math.PI / 2; header.position.set(ROOM.L / 2 - 0.5, L.roomH - 0.5, 0); tech.add(header);
  // cable trays
  aisleZs.slice(0, -2).forEach(z => { const ct = new THREE.Mesh(UNIT, M.galvanised()); ct.scale.set(ROOM.L - 1.5, 0.04, 0.25); ct.position.set(0, L.roomH - 0.95, z + 0.45); tech.add(ct); });
}

/* ---- dashboard screen on the partition */
const dashCv = document.createElement('canvas'); dashCv.width = 640; dashCv.height = 360;
const dashTex = new THREE.CanvasTexture(dashCv); dashTex.colorSpace = THREE.SRGBColorSpace;
const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ map: dashTex, toneMapped: false })); scene.add(dash);
function drawDash(r) {
  const c = dashCv.getContext('2d'); c.fillStyle = '#07130e'; c.fillRect(0, 0, 640, 360);
  c.fillStyle = '#5ce39a'; c.font = '700 30px Inter, sans-serif'; c.fillText('FARM KPIs · live', 28, 50);
  const kv = [['Electricity', `${fmt(r.kwhKg, 1)} kWh/kg`], ['Yield', `${fmt(r.perFloor, 0)} kg/m² floor/yr`], ['Production', `${fmt(r.prodT, 0)} t/yr`], ['Cost', `${fmt(r.cost.tot, 2)} €/kg`], ['Water', `${fmt(r.lKg, 2)} L/kg`]];
  kv.forEach(([k, v], i) => { c.fillStyle = '#9fd8b8'; c.font = '500 26px Inter, sans-serif'; c.fillText(k, 28, 104 + i * 50); c.fillStyle = '#ffffff'; c.font = '600 30px "JetBrains Mono", monospace'; c.fillText(v, 250, 104 + i * 50); });
  dashTex.needsUpdate = true;
}

/* ---- scissor lift with a worker, and a harvest AGV */
function person(color = 0x3b6fb6) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.7, 4, 12), M.plastic(color, 0.7)); body.position.y = 0.95; g.add(body);
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.55, 4, 10), M.plastic(0x2a2f38, 0.8)); legs.position.y = 0.42; legs.scale.x = 1.35; g.add(legs);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), M.plastic(0xe0b59a, 0.6)); head.position.y = 1.55; g.add(head);
  const net = new THREE.Mesh(new THREE.SphereGeometry(0.118, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.plastic(0xf4f4f4, 0.9)); net.position.y = 1.56; g.add(net);
  g.traverse(m => { if (m.isMesh) m.castShadow = true; });
  return g;
}
const lift = new THREE.Group(); scene.add(lift);
const liftBase = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.32, 0.78, 2, 0.03), M.paintedSteel(0xe07a1f)); liftBase.position.y = 0.26; lift.add(liftBase);
[[-0.55, -0.34], [0.55, -0.34], [-0.55, 0.34], [0.55, 0.34]].forEach(([x, z]) => { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 18), M.rubber()); w.rotation.x = Math.PI / 2; w.position.set(x, 0.1, z); lift.add(w); });
const arms = []; for (let k = 0; k < 3; k++) [-0.3, 0.3].forEach(z => [1, -1].forEach(sgn => { const a = new THREE.Mesh(UNIT, M.paintedSteel(0x2b2e33)); a.userData = { k, z, sgn }; lift.add(a); arms.push(a); }));
const platform = new THREE.Group(); lift.add(platform);
const deck = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.82), M.paintedSteel(0xe07a1f)); platform.add(deck);
[[-0.78, -0.39], [0.78, -0.39], [-0.78, 0.39], [0.78, 0.39]].forEach(([x, z]) => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.0, 8), M.paintedSteel(0xf2c230)); p.position.set(x, 0.5, z); platform.add(p); });
[[0, -0.39, 1.6, 0], [0, 0.39, 1.6, 0], [-0.78, 0, 0.82, 1], [0.78, 0, 0.82, 1]].forEach(([x, z, l, rot]) => { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, l, 8), M.paintedSteel(0xf2c230)); r.rotation.z = rot ? 0 : Math.PI / 2; if (rot) r.rotation.x = Math.PI / 2; r.position.set(x, 1.0, z); platform.add(r); });
const worker = person(); worker.position.set(0.2, 0.03, 0); worker.rotation.y = -Math.PI / 2; platform.add(worker);
const agv = new THREE.Group(); scene.add(agv);
{ const b = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.28, 0.65, 2, 0.04), M.plastic(0x2a3036, 0.4)); b.position.y = 0.18; agv.add(b);
  const strip = new THREE.Mesh(UNIT, M.emissive(0x3ae0ff, 2.2)); strip.scale.set(0.96, 0.02, 0.66); strip.position.y = 0.1; agv.add(strip);
  for (let k = 0; k < 4; k++) { const tr = new THREE.Mesh(UNIT, MAT.tray); tr.scale.set(0.8, 0.04, 0.55); tr.position.y = 0.4 + k * 0.28; agv.add(tr); const gr = new THREE.Mesh(UNIT, M.plastic(0x6cab3c, 0.8)); gr.scale.set(0.76, 0.08, 0.5); gr.position.y = 0.46 + k * 0.28; agv.add(gr); }
  [-1, 1].forEach(sx => [-1, 1].forEach(sz => { const p = new THREE.Mesh(UNIT, MAT.rack); p.scale.set(0.03, 1.2, 0.03); p.position.set(sx * 0.4, 0.9, sz * 0.27); agv.add(p); })); }
const tech2 = person(0x2e8c62); scene.add(tech2);

/* ---- labels */
const LBL = {};
const label = (k, obj, off, html) => { LBL[k] = stage.addLabel(obj, html, { offset: off }); };
const lblAnchor = new THREE.Object3D(); scene.add(lblAnchor);
label('racks', lblAnchor, [0, 0, 0], 'Growing racks');
label('ahu', lblAnchor, [ROOM.L / 2 + TECH / 2 + 0.5, 2.9, -3.6], 'Air handling');
LBL.cond = stage.addLabel(lblAnchor, 'Condensate', { offset: [ROOM.L / 2 + TECH / 2 - 0.4, 1.2, -1.0], className: 'label3d sm' });
LBL.nut = stage.addLabel(lblAnchor, 'Nutrient tanks', { offset: [ROOM.L / 2 + TECH / 2 - 0.2, 1.45, 1.4], className: 'label3d sm' });
LBL.nurs = stage.addLabel(lblAnchor, 'Germination rack', { offset: [-9.6, 2.45, 6.45], className: 'label3d sm' });
label('lift', lift, [0, 2.6, 0], 'Scissor lift');
LBL.agv = stage.addLabel(agv, 'Harvest AGV', { offset: [0, 1.75, 0], className: 'label3d sm' });
label('duct', lblAnchor, [0, 0, 0], 'Supply ducts');

/* ------------------------------------------------------------------ charts */
const sankey = new Sankey('#chart-sankey', { unit: 'kWh kg⁻¹', height: 330, digits: 2 });
const costChart = new BarChart('#chart-cost', { y: { label: 'Cost', unit: '€ kg⁻¹', min: 0 }, height: 250, legend: false });
const sensChart = new BarChart('#chart-sens', { horizontal: true, stacked: true, y: { label: 'Change in cost', unit: '€ kg⁻¹' }, height: 270 });
const compChart = new BarChart('#chart-comp', { horizontal: true, y: { label: '', unit: '', min: 0 }, height: 260, legend: false });
let compMode = 'kwh';
document.querySelectorAll('#comp-mode button').forEach(b => b.addEventListener('click', () => { compMode = b.dataset.v; document.querySelectorAll('#comp-mode button').forEach(x => x.setAttribute('aria-pressed', x === b)); drawComp(); }));

function drawSankey(r) {
  const f = r.fwYr, e = r.e, k = v => v / f;
  const nodes = [
    { id: 'grid', label: 'Electricity', color: '#f2b94b', col: 0 },
    { id: 'light', label: 'LEDs', color: '#f07ad0', col: 1 }, { id: 'hvac', label: 'HVAC', color: '#5cc8ef', col: 1 }, { id: 'aux', label: 'Fans, pumps', color: '#9aa6a0', col: 1 },
    { id: 'par', label: 'PAR light', color: '#6fd39a', col: 2 }, { id: 'ledheat', label: 'LED heat', color: '#ef6b61', col: 2 },
    { id: 'chem', label: 'Lettuce', color: '#9bdc5a', col: 3 }, { id: 'lat', label: 'Transpiration', color: '#4a8cff', col: 3 }, { id: 'sens', label: 'Sensible heat', color: '#ef8f6b', col: 3 },
    { id: 'out', label: 'Heat out', color: '#c96b5c', col: 4 }
  ];
  const links = [
    { source: 'grid', target: 'light', value: k(e.light) }, { source: 'grid', target: 'hvac', value: k(e.hvac) }, { source: 'grid', target: 'aux', value: k(e.aux) },
    { source: 'light', target: 'par', value: k(e.radiant) }, { source: 'light', target: 'ledheat', value: k(e.light - e.radiant) },
    { source: 'par', target: 'chem', value: k(e.chem) }, { source: 'par', target: 'lat', value: k(e.latent) }, { source: 'par', target: 'sens', value: k(Math.max(0, e.radiant - e.chem - e.latent)) },
    { source: 'ledheat', target: 'sens', value: k(e.light - e.radiant) }, { source: 'aux', target: 'sens', value: k(e.aux) },
    { source: 'sens', target: 'out', value: k(e.heat - e.latent) }, { source: 'lat', target: 'out', value: k(e.latent) }, { source: 'hvac', target: 'out', value: k(e.hvac) }
  ];
  sankey.set({ nodes, links: links.filter(l => l.value > 1e-6) });
}
function drawCost(r) {
  const c = r.cost;
  costChart.set(['Light', 'HVAC', 'Fans, pumps', 'Labour', 'Capital', 'Seeds, nutrients', 'Packaging, logistics'], [{ label: '€ per kg', values: [c.light, c.hvac, c.aux, c.lab, c.cap, c.cons, c.pack], colors: ['#f07ad0', '#5cc8ef', '#9aa6a0', '#e0b64a', '#8e7ad6', '#6fd39a', '#c49a6c'], format: v => v.toFixed(2) }]);
  const el = document.getElementById('cost-total'); if (el) el.textContent = `Total ${fmt(c.tot, 2)} € kg⁻¹ — electricity ${fmt(100 * r.elecShare, 0)} % of the cost.`;
}
const SENS = [['lue', 'Light-use efficiency'], ['eff', 'LED efficacy'], ['price', 'Electricity price'], ['capex', 'Investment'], ['labour', 'Labour cost'], ['cop', 'HVAC COP'], ['cap', 'Photon capture'], ['ppfd', 'PPFD'], ['dm', 'Dry-matter content']];
function drawSens(p, r) {
  const rows = SENS.map(([k, lab]) => { const lo = balance(Object.assign({}, p, { [k]: p[k] * 0.8 })).cost.tot - r.cost.tot, hi = balance(Object.assign({}, p, { [k]: p[k] * 1.2 })).cost.tot - r.cost.tot; return { lab, lo, hi, span: Math.abs(hi - lo) }; }).sort((a, b) => b.span - a.span);
  sensChart.set(rows.map(x => x.lab), [{ label: 'parameter −20 %', values: rows.map(x => x.lo), color: 'water' }, { label: 'parameter +20 %', values: rows.map(x => x.hi), color: 'magenta' }]);
}
let lastR = null;
function drawComp() {
  if (!lastR) return; const r = lastR, P = ui.values();
  const cmp = comparisons(P.dm);
  const cats = ['This vertical farm', ...cmp.map(c => c.label)];
  let vals, unit;
  if (compMode === 'kwh') { vals = [r.kwhKg, ...cmp.map(c => c.kwh)]; unit = 'kWh per kg fresh lettuce'; }
  else if (compMode === 'water') { vals = [r.lKg, ...cmp.map(c => c.water)]; unit = 'L water per kg'; }
  else { vals = [r.perBuilding, ...cmp.map(c => c.yield)]; unit = 'kg per m² of land (building floor) per year'; }
  compChart.y.label = unit; compChart.y.unit = '';
  compChart.set(cats, [{ label: unit, values: vals, colors: ['#1d7a4a', '#8e7ad6', '#1c78a3', '#5cc8ef', '#b86e0b', '#6b6f2a'] }]);
}

/* ------------------------------------------------------------------ update */
let P = null, R = null, farmKey = '', plantSizeKey = '';
const LED_COL = { white: 0xfff0e6, magenta: 0xff4fc8 };
function update() {
  P = ui.values(); R = balance(P); lastR = R; LAY = R.L;
  const key = `${P.tiers}|${P.aisle}`;
  const headR = Math.min(0.19, Math.max(0.09, 0.15 * Math.cbrt(R.headG / 150)));
  if (key !== farmKey) { farmKey = key; buildPlantGeos(headR); plantSizeKey = plantKey; buildRoom(LAY); buildFarm(P, LAY); buildTech(LAY); placeActors(); }
  else { buildPlantGeos(headR); if (plantKey !== plantSizeKey) { plantSizeKey = plantKey; plantsPlace(P, LAY); } }
  applyLights(true);
  // readouts
  const r = R;
  ro.set('sue', `${fmt(r.A, 0)} m² · ${fmt(r.L.sue, 2)}`, r.L.sue > 4 ? 'ok' : r.L.sue > 2 ? 'warn' : 'bad', `${r.L.rows} rows × 2 racks × ${P.tiers} tiers on ${fmt(r.L.floor, 0)} m² of floor`);
  ro.set('dli', r.dli, r.dli >= 12 && r.dli <= 17.5 ? 'ok' : 'warn', r.dli > 17.5 ? 'above ≈ 17: tip-burn risk in lettuce' : r.dli < 12 ? 'low for head lettuce' : 'typical for lettuce 12–17');
  ro.set('yield', r.perFloor, null, `${fmt(r.fwYr, 1)} kg m⁻² of cultivation area · ${fmt(r.perBuilding, 0)} per m² of building`);
  ro.set('prod', r.prodT, null, `${fmt(r.headsDay, 0)} heads of ${fmt(r.headG, 0)} g per day`);
  ro.set('kwh', r.kwhKg, r.kwhKg < 8 ? 'ok' : r.kwhKg < 15 ? 'warn' : 'bad', `light ${fmt(r.e.light / r.fwYr, 1)} · HVAC ${fmt(r.e.hvac / r.fwYr, 1)} · fans ${fmt(r.e.aux / r.fwYr, 1)} · ${fmt(r.kwhKg / (P.dm / 100), 0)} kWh kg⁻¹ DW`);
  ro.set('wm2', r.wm2, null, `${fmt(r.pLightInst, 0)} kW of LEDs installed · ${fmt(r.mwh, 0)} MWh yr⁻¹ in total`);
  ro.set('cool', r.coolPeak, null, `latent (transpiration) ${fmt(100 * r.e.latent / r.e.heat, 0)} % of the heat`);
  ro.set('water', r.lKg, 'ok', `${fmt(r.transpKg, 1)} L kg⁻¹ transpired, ${P.rec} % recovered as condensate`);
  ro.set('co2', `${fmt(r.co2Kg, 3)} · ${fmt(r.co2eKg, 2)}`, r.co2eKg < 1 ? 'ok' : r.co2eKg < 3 ? 'warn' : 'bad', 'CO₂ for enrichment · CO₂e from electricity');
  ro.set('cost', r.cost.tot, r.cost.tot < 4 ? 'ok' : r.cost.tot < 8 ? 'warn' : 'bad', `electricity ${fmt(100 * r.elecShare, 0)} % · labour ${fmt(100 * r.cost.lab / r.cost.tot, 0)} % · capital ${fmt(100 * r.cost.cap / r.cost.tot, 0)} %`);
  ro.set('head', r.headG, r.headG > 120 && r.headG < 300 ? 'ok' : 'warn', `${P.density} plants m⁻² for ${P.cycle} days`);
  ro.set('field', r.perBuilding / 3.9, null, 'yield per m² of building vs 3.9 kg m⁻² yr⁻¹ in the field (Barbosa et al. 2015)');
  drawSankey(r); drawCost(r); drawSens(P, r); drawComp(); drawDash(r);
  Object.values(LBL).forEach(l => { l.visible = !!P.labels && !walk; });
  LBL.racks.element.innerHTML = `Growing racks<small>${P.tiers} tiers · ${fmt(r.A, 0)} m² · ${fmt(P.ppfd, 0)} µmol m⁻² s⁻¹</small>`;
  LBL.ahu.element.innerHTML = `Air handling units<small>COP ${fmt(P.cop, 1)} · ${fmt(r.coolPeak, 0)} kW cooling</small>`;
  LBL.cond.element.innerHTML = `Condensate recovery<small>${fmt(r.transpKg * r.prodT * 1000 / 365 * P.rec / 100 / 1000, 1)} m³ d⁻¹</small>`;
  LBL.nut.element.innerHTML = `Nutrient tanks<small>A · B · acid</small>`;
  LBL.lift.element.innerHTML = 'Scissor lift<small>harvesting upper tiers</small>';
  LBL.agv.element.innerHTML = 'Harvest AGV<small>trays to packing</small>';
  LBL.duct.element.innerHTML = `Supply ducts<small>${fmt(r.coolPeak, 0)} kW removed</small>`;
}
/* ---- germination rack (lab3d makeRack) with seedlings, in the north-west corner */
const nursery = makeRack({ levels: 4, width: 2.4, depth: 0.9, levelHeight: 0.5, baseHeight: 0.3, ledColor: 'full' });
nursery.position.set(-9.6, 0, 6.45); scene.add(nursery); nursery.lights.forEach(b => b.setIntensity(0.55));
{ const seedGeo = lettuceLow({ radius: 0.05, leaves: 5, growth: 0.15, segU: 3, segV: 2, seed: 99 }); const pts = []; nursery.shelves.forEach(sh => { for (let i = 0; i < 20; i++) for (let j = 0; j < 7; j++) pts.push([-1.12 + i * 0.118 - 9.6, sh.y + 0.005, -0.36 + j * 0.12 + 6.45, i * 1.7 + j, 1, 1, 1]); }); scene.add(inst(seedGeo, MAT.leaf, pts)); }
function placeActors() {
  const L = LAY; lblAnchor.position.set(0, 0, 0);
  LBL.racks.position.set(L.segX[0], L.rackTop + 0.35, L.rowZ[L.rowZ.length - 1]);
  LBL.duct.position.set(L.segX[1] - 2, L.roomH - 0.2, (L.rowZ[0] + L.rowZ[1]) / 2);
  dash.position.set(ROOM.L / 2 - 0.06, 2.3, (L.rowZ[L.rowZ.length - 1] + L.rowZ[L.rowZ.length - 2]) / 2); dash.rotation.y = -Math.PI / 2;
  tech2.position.set(L.segX[0] - ROOM.segLen / 2 - 0.55, 0, L.rowZ[L.rowZ.length - 1] + RACK_DEPTH / 2 + 0.4); tech2.rotation.y = Math.PI / 2.4;
}

/* ------------------------------------------------------------------ lights and the day clock */
let tod = 12 * 3600, ledLevel = 1;
function lightsOn() { const h = tod / 3600, s = 6, e = 6 + P.photo; return (h >= s && h < e) || (e > 24 && h < e - 24); }
function applyLights(force) {
  const col = new THREE.Color(LED_COL[P.spec]);
  const k = P.ppfd / 250 * ledLevel;
  MAT.led.emissive.copy(col); MAT.led.emissiveIntensity = 0.04 + 3.2 * k;
  ledSun.color.copy(col); ledSun.intensity = 1.0 * k;
  rectLights.forEach(l => { l.color.copy(col); l.intensity = 0.75 * k; });
  hemi.intensity = 0.28 + 0.1 * ledLevel;
}
const clock = new SimClock({ speed: 1800, onStep: dt => { tod = (tod + dt) % 86400; } });
clock.play();
const fmtH = s => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`;

/* ------------------------------------------------------------------ walk mode */
let walk = null; const keys = {};
const saved = {};
function enterWalk() {
  const L = LAY; const z = L.rowZ.length > 1 ? (L.rowZ[0] + L.rowZ[1]) / 2 : L.rowZ[0] + 1.2;
  walk = { pos: new THREE.Vector3(-ROOM.L / 2 + 0.6, 1.65, z), yaw: 0, pitch: -0.05 };
  Object.assign(saved, { minPolarAngle: stage.controls.minPolarAngle, maxPolarAngle: stage.controls.maxPolarAngle, minDistance: stage.controls.minDistance, maxDistance: stage.controls.maxDistance });
  Object.assign(stage.controls, { enabled: false, minPolarAngle: 0, maxPolarAngle: Math.PI, minDistance: 0.01, maxDistance: 1e4 });
  walkBtn.innerHTML = '✕ Leave walk mode'; stage.el.focus();
  hud.set('walk', '<b>Walk</b>: W A S D or arrows · drag to look · Shift = faster');
}
function exitWalk() {
  walk = null; Object.assign(stage.controls, saved, { enabled: true }); walkBtn.innerHTML = '🚶 Walk through the farm'; hud.remove('walk'); tour('home');
}
function collide(x, z) {
  const L = LAY; if (x < -ROOM.L / 2 + 0.3 || x > ROOM.L / 2 + TECH - 0.4 || z < -ROOM.W / 2 + 0.3 || z > ROOM.W / 2 - 0.3) return true;
  for (const rz of L.rowZ) for (const sx of L.segX) if (Math.abs(x - sx) < ROOM.segLen / 2 + 0.3 && Math.abs(z - rz) < RACK_DEPTH / 2 + 0.25) return true;
  if (x > ROOM.L / 2 + 0.6 && Math.abs(Math.abs(z) - 3.6) < 1.6) return true;
  if (Math.abs(x + 9.6) < 1.5 && z > 5.7) return true;
  return false;
}
window.addEventListener('keydown', e => { if (!walk) return; const k = e.key.toLowerCase(); if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'q', 'e'].includes(k)) { keys[k] = true; e.preventDefault(); e.stopPropagation(); } if (k === 'escape') exitWalk(); }, true);
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; }, true);
let drag = null;
stage.renderer.domElement.addEventListener('pointerdown', e => { if (walk) drag = [e.clientX, e.clientY]; });
window.addEventListener('pointerup', () => { drag = null; });
window.addEventListener('pointermove', e => { if (!walk || !drag) return; walk.yaw += (e.clientX - drag[0]) * 0.0045; walk.pitch = Math.max(-1.2, Math.min(1.2, walk.pitch - (e.clientY - drag[1]) * 0.0045)); drag = [e.clientX, e.clientY]; });
function stepWalk(dt) {
  const sp = (keys.shift ? 3.4 : 1.5) * dt;
  let f = 0, s = 0; if (keys.w || keys.arrowup) f += 1; if (keys.s || keys.arrowdown) f -= 1; if (keys.d) s += 1; if (keys.a) s -= 1;
  if (keys.arrowleft || keys.q) walk.yaw -= 1.6 * dt; if (keys.arrowright || keys.e) walk.yaw += 1.6 * dt;
  const cx = Math.cos(walk.yaw), cz = Math.sin(walk.yaw);
  const nx = walk.pos.x + (cx * f - cz * s) * sp, nz = walk.pos.z + (cz * f + cx * s) * sp;
  if (!collide(nx, walk.pos.z)) walk.pos.x = nx; if (!collide(walk.pos.x, nz)) walk.pos.z = nz;
  const dir = new THREE.Vector3(Math.cos(walk.pitch) * cx, Math.sin(walk.pitch), Math.cos(walk.pitch) * cz);
  camera.position.copy(walk.pos); const tgt = walk.pos.clone().add(dir); camera.lookAt(tgt); stage.controls.target.copy(tgt);
}
function tour(which) {
  if (walk && which !== 'home') exitWalk();
  const L = LAY, zA = L.rowZ.length > 1 ? (L.rowZ[0] + L.rowZ[1]) / 2 : 1;
  if (which === 'aisle') stage.flyTo([-ROOM.L / 2 + 0.8, 1.7, zA], [4, 1.9, zA]);
  else if (which === 'tier') stage.flyTo([L.segX[0] - 1.2, BASE_H + 2 * TIER_PITCH + 0.28, L.rowZ[0] + RACK_DEPTH / 2 + 0.9], [L.segX[0] + 0.4, BASE_H + 2 * TIER_PITCH + 0.05, L.rowZ[0]]);
  else if (which === 'tech') stage.flyTo([ROOM.L / 2 - 0.9, 2.3, 6.4], [ROOM.L / 2 + TECH / 2 + 0.3, 1.2, -1.2]);
  else stage.flyTo([-12.8, 4.9, 10.8], [-0.5, 1.7, 0]);
}

/* ------------------------------------------------------------------ animation */
let agvT = 0, liftT = 0, lodT = 0, hudT = 0;
stage.onFrame((dt, t) => {
  if (!LAY) return;
  if (walk) stepWalk(dt);
  // lights follow the day clock
  const target = lightsOn() ? 1 : 0.02; ledLevel += (target - ledLevel) * (1 - Math.exp(-dt / 0.35)); applyLights();
  // AGV along the central cross aisle, lift along the first aisle
  agvT += dt; const zr = ROOM.W / 2 - 1.3; const zz = Math.sin(agvT * 0.12) * zr;
  agv.position.set(0, 0, zz); agv.rotation.y = Math.PI / 2;
  liftT += dt; const zL = LAY.rowZ.length > 1 ? (LAY.rowZ[0] + LAY.rowZ[1]) / 2 : LAY.rowZ[0] + 1.2;
  const xs = LAY.segX[1] + Math.sin(liftT * 0.07) * (ROOM.segLen / 2 - 1.2);
  lift.position.set(xs, 0, zL);
  const hTop = Math.min(LAY.rackTop - 1.9, BASE_H + (ui.get('tiers') - 1) * TIER_PITCH - 1.0);
  const h = 0.55 + Math.max(0, hTop - 0.55) * (0.5 + 0.5 * Math.sin(liftT * 0.25));
  platform.position.y = 0.42 + h;
  const n = 3, hs = h / n, Lb = 1.45, ang = Math.asin(Math.min(0.98, hs / Lb));
  arms.forEach(a => { const { k, z, sgn } = a.userData; a.scale.set(Lb, 0.05, 0.05); a.position.set(0, 0.42 + (k + 0.5) * hs, z); a.rotation.set(0, 0, sgn * ang); });
  fans.forEach((f, i) => { f.rotation.x += dt * (6 + (R ? R.coolPeak / 20 : 4)) * (i ? 1 : -1); });
  if (tech.userData.cond) tech.userData.cond.update(t);
  lodT += dt; if (lodT > 0.3) { lodT = 0; updateLOD(); }
  hudT += dt; if (hudT > 0.25) {
    hudT = 0; const on = lightsOn();
    hud.set('t', `Farm clock <b>${fmtH(tod)}</b> · lights <b style="color:${on ? '#ffd27a' : '#8aa'}">${on ? 'ON' : 'off'}</b> (06:00 + ${fmt(P.photo, 1)} h)`);
    hud.set('k', `<b>${fmt(R.kwhKg, 1)}</b> kWh kg⁻¹ · <b>${fmt(R.perFloor, 0)}</b> kg m⁻² yr⁻¹ · <b>${fmt(R.cost.tot, 2)}</b> € kg⁻¹`);
    Object.values(LBL).forEach(l => { l.visible = !!ui.get('labels') && !walk; });
  }
});

/* ------------------------------------------------------------------ wiring */
let raf = 0;
ui.onChange((st, id) => {
  if (id === 'clockSpeed') { const s = +st.clockSpeed; if (s > 0) { clock.speed = s; clock.play(); } else clock.pause(); return; }
  if (id === 'labels') return;
  cancelAnimationFrame(raf); raf = requestAnimationFrame(update);
});
update();
window.__vf = { get R() { return R; }, get plantGeo() { return plantGeo; }, enterWalk, exitWalk, tour, setTime: h => { tod = h * 3600; }, view(pos, target) { camera.position.set(...pos); stage.controls.target.set(...target); stage.controls.update(); updateLOD(); }, walkTo(x, z, yaw, pitch = 0) { enterWalk(); walk.pos.set(x, 1.65, z); walk.yaw = yaw; walk.pitch = pitch; stepWalk(0); updateLOD(); } };
