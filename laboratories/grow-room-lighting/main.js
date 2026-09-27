/* Grow-room lighting designer — physics model + 3D scene.
   Model: cosine-power point sources (5 per bar), inverse-square & cosine law,
   specular wall images up to second order in each axis (see Derive tab, Eqs. L1–L4). */
import { createStage, THREE, M, makeLEDBar, lettuceGeometry, leafMaterial, makeRoom, heatmapTexture, RoundedBoxGeometry, makeGround } from '/assets/js/lab3d.js';
import { Controls, Readouts, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, BarChart, linspace } from '/assets/js/plot.js';
import { colormapGradient } from '/assets/js/colors.js';

/* ------------------------------------------------------------ constants */
const BENCH_TOP = 0.8;          // m, tray surface
const CANOPY = 0.12;            // m, canopy height above tray
const Y_CANOPY = BENCH_TOP + CANOPY;
const CROPS = {
  lettuce: { label: 'Lettuce (12–17)', dli: [12, 17] },
  basil: { label: 'Basil (15–25)', dli: [15, 25] },
  microgreens: { label: 'Microgreens (9–12)', dli: [9, 12] },
  strawberry: { label: 'Strawberry (15–20)', dli: [15, 20] },
  tomato: { label: 'Tomato, fruiting (20–30)', dli: [20, 30] }
};
const BEAMS = { wide: 1, medium: 2, narrow: 5 };
const WALLS = { none: 0, white: 0.8, film: 0.95 };

/* ------------------------------------------------------------ physics */
function sources(p) {
  const out = [];
  const barLen = 0.9 * p.D / p.nz;
  for (let i = 0; i < p.nx; i++) for (let j = 0; j < p.nz; j++) {
    const x = -p.W / 2 + (i + 0.5) * p.W / p.nx, z = -p.D / 2 + (j + 0.5) * p.D / p.nz;
    for (let k = 0; k < 5; k++) out.push({ x, z: z + (k - 2) / 4 * barLen * 0.9 });
  }
  return out;
}
/** Expand sources with wall images: returns flat Float64Array [x, z, weight, …]. */
function withImages(src, p) {
  const rho = WALLS[p.walls];
  const orders = rho > 0 ? [-2, -1, 0, 1, 2] : [0];
  const img = (c, m, L) => m === 0 ? c : m === 1 ? L - c : m === -1 ? -L - c : m === 2 ? c + 2 * L : c - 2 * L;
  const arr = [];
  for (const s of src) for (const mx of orders) for (const mz of orders) {
    const w = Math.pow(rho, Math.abs(mx) + Math.abs(mz)); if (w < 1e-4) continue;
    arr.push(img(s.x, mx, p.W), img(s.z, mz, p.D), w);
  }
  return new Float64Array(arr);
}
function ppfdAt(x, z, S, I0, h, n) {
  let E = 0; const h2 = h * h;
  for (let k = 0; k < S.length; k += 3) {
    const dx = x - S[k], dz = z - S[k + 1]; const d2 = h2 + dx * dx + dz * dz;
    const c = h / Math.sqrt(d2);
    E += S[k + 2] * Math.pow(c, n + 1) / d2;
  }
  return E * I0;
}
function computeMap(p, NX = 60, NZ = 30, hOverride) {
  const src = sources(p); const S = withImages(src, p);
  const n = BEAMS[p.beam]; const ppfFix = p.power * p.eff; const I0 = (n + 1) * (ppfFix / 5) / (2 * Math.PI);
  const h = hOverride ?? p.h;
  const vals = []; let sum = 0, mn = Infinity, mx = -Infinity, sq = 0;
  for (let j = 0; j < NZ; j++) {
    const row = []; const z = -p.D / 2 + (j + 0.5) * p.D / NZ;
    for (let i = 0; i < NX; i++) {
      const x = -p.W / 2 + (i + 0.5) * p.W / NX;
      const E = ppfdAt(x, z, S, I0, h, n); row.push(E); sum += E; sq += E * E; mn = Math.min(mn, E); mx = Math.max(mx, E);
    }
    vals.push(row);
  }
  const N = NX * NZ, mean = sum / N, sd = Math.sqrt(Math.max(0, sq / N - mean * mean));
  return { vals, mean, min: mn, max: mx, sd, S, I0, n, NX, NZ };
}

/* ------------------------------------------------------------ UI */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'mean', label: 'Mean canopy PPFD', unit: 'µmol m⁻² s⁻¹', digits: 0 })
  .add({ id: 'range', label: 'Min – max PPFD', unit: '', digits: 0, format: v => v })
  .add({ id: 'unif', label: 'Uniformity (min / mean)', unit: '', digits: 2 })
  .add({ id: 'dli', label: 'Daily light integral', unit: 'mol m⁻² d⁻¹', digits: 1 })
  .add({ id: 'cap', label: 'Canopy capture efficiency', unit: '%', digits: 0 })
  .add({ id: 'pd', label: 'Electrical power density', unit: 'W m⁻²', digits: 0 })
  .add({ id: 'kwh', label: 'Electricity per day', unit: 'kWh d⁻¹', digits: 1 })
  .add({ id: 'cost', label: 'Electricity cost per year', unit: '€ yr⁻¹', digits: 0 })
  .add({ id: 'kwhmol', label: 'Electricity per mol at canopy', unit: 'kWh mol⁻¹', digits: 3 });

ui.section('Fixtures');
ui.slider({ id: 'nx', label: 'Fixtures along the bench', min: 1, max: 8, step: 1, value: 4 });
ui.slider({ id: 'nz', label: 'Rows across the bench', min: 1, max: 3, step: 1, value: 1 });
ui.slider({ id: 'power', label: 'Electrical power per fixture', min: 20, max: 400, step: 5, value: 120, unit: 'W' });
ui.slider({ id: 'eff', label: 'Photon efficacy', min: 1.0, max: 3.8, step: 0.05, value: 2.8, unit: 'µmol J⁻¹', help: 'HPS ≈ 1.7 · early LED ≈ 2.3 · 2024 LED ≈ 3.0–3.5' });
ui.segmented({ id: 'beam', label: 'Beam optics', options: [{ value: 'wide', label: 'Wide (n=1)' }, { value: 'medium', label: 'Medium (n=2)' }, { value: 'narrow', label: 'Narrow (n=5)' }], value: 'wide' });
ui.slider({ id: 'h', label: 'Height above canopy', min: 0.1, max: 1.2, step: 0.01, value: 0.45, unit: 'm' });
ui.section('Grow area');
ui.slider({ id: 'W', label: 'Bench length', min: 1.2, max: 3.6, step: 0.1, value: 2.4, unit: 'm' });
ui.slider({ id: 'D', label: 'Bench width', min: 0.6, max: 1.8, step: 0.1, value: 1.2, unit: 'm' });
ui.segmented({ id: 'walls', label: 'Walls', options: [{ value: 'none', label: 'None' }, { value: 'white', label: 'White (ρ 0.8)' }, { value: 'film', label: 'Film (ρ 0.95)' }], value: 'none' });
ui.section('Crop & economics');
ui.select({ id: 'crop', label: 'Crop DLI target', options: Object.entries(CROPS).map(([value, c]) => ({ value, label: c.label + ' mol m⁻² d⁻¹' })), value: 'lettuce' });
ui.slider({ id: 'photo', label: 'Photoperiod', min: 8, max: 24, step: 0.5, value: 16, unit: 'h d⁻¹' });
ui.slider({ id: 'price', label: 'Electricity price', min: 0.03, max: 0.5, step: 0.01, value: 0.15, unit: '€ kWh⁻¹' });
ui.section('Display');
ui.segmented({ id: 'view', label: 'View', options: [{ value: 'crop', label: 'Crop' }, { value: 'both', label: 'Both' }, { value: 'map', label: 'PPFD map' }], value: 'both' });
ui.toggle({ id: 'cones', label: 'Show half-intensity beam cones', value: false });
ui.presets([
  { label: 'Hobby tent', values: { nx: 1, nz: 1, power: 240, eff: 2.5, beam: 'wide', h: 0.45, W: 1.2, D: 1.2, walls: 'film' } },
  { label: 'Research chamber', values: { nx: 6, nz: 2, power: 90, eff: 2.7, beam: 'wide', h: 0.6, W: 2.4, D: 1.2, walls: 'white' } },
  { label: 'Vertical-farm tier', values: { nx: 8, nz: 3, power: 30, eff: 3.2, beam: 'wide', h: 0.22, W: 2.4, D: 1.2, walls: 'none' } },
  { label: 'Old HPS', values: { nx: 2, nz: 1, power: 400, eff: 1.7, beam: 'medium', h: 1.0, W: 2.4, D: 1.2, walls: 'none' } }
]);
ui.saveButton('grow-room-lighting', () => ro.values());

/* ------------------------------------------------------------ 3D scene */
const stage = createStage('#stage', {
  background: '#070b0a', envIntensity: 0.12, exposure: 1.0,
  camera: { pos: [2.6, 2.1, 2.9], target: [0, 0.95, 0], fov: 40 },
  controls: { minDistance: 0.6, maxDistance: 9 },
  bloom: { strength: 0.6, radius: 0.45, threshold: 1.0 }, ao: { radius: 0.18, intensity: 0.8 }
});
const { scene } = stage;
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x1a1f1c, 0.1));
const room = makeRoom({ w: 9, d: 7, h: 3, wallColor: 0x2a2f2c, floor: 'epoxy' });
room.floor.material.color.set(0x8a8f8c);
scene.add(room);
const hud = hudChips(stage.el);
const legend = document.createElement('div'); legend.className = 'stage-legend'; stage.el.appendChild(legend);

const benchGroup = new THREE.Group(); scene.add(benchGroup);
const fixtureGroup = new THREE.Group(); scene.add(fixtureGroup);
const coneGroup = new THREE.Group(); scene.add(coneGroup);
let wallMesh = null, heatPlane = null, lettuceMeshes = [], probe = null, probeLabel = null, probePos = null;
const lettuceGeos = [0, 1, 2].map(s => lettuceGeometry({ radius: 0.12, growth: 0.9, variety: 'butterhead', seed: 11 + s * 7 }));
const lettuceMat = leafMaterial({ gloss: 0.45 });
const steel = M.galvanised();

function buildBench(p) {
  benchGroup.clear();
  const tray = new THREE.Mesh(new RoundedBoxGeometry(p.W + 0.06, 0.06, p.D + 0.06, 2, 0.012), M.plasticWhite());
  tray.position.y = BENCH_TOP - 0.03; tray.receiveShadow = true; tray.castShadow = true; benchGroup.add(tray);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(p.W + 0.1, 0.05, p.D + 0.1), steel); frame.position.y = BENCH_TOP - 0.085; benchGroup.add(frame);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, BENCH_TOP - 0.1, 0.05), steel); leg.position.set(a * (p.W / 2 - 0.03), (BENCH_TOP - 0.1) / 2, b * (p.D / 2 - 0.03)); leg.castShadow = true; benchGroup.add(leg); });
  // lettuce heads at 0.2 m spacing
  const nxp = Math.max(1, Math.floor(p.W / 0.2)), nzp = Math.max(1, Math.floor(p.D / 0.2));
  const buckets = [[], [], []];
  for (let i = 0; i < nxp; i++) for (let j = 0; j < nzp; j++) buckets[(i * 7 + j * 3) % 3].push([-p.W / 2 + (i + 0.5) * p.W / nxp, -p.D / 2 + (j + 0.5) * p.D / nzp, (i * 13 + j * 29) % 17]);
  lettuceMeshes = buckets.map((b, k) => {
    const im = new THREE.InstancedMesh(lettuceGeos[k], lettuceMat, Math.max(1, b.length));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    b.forEach(([x, z, r], i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * 0.37); const sc = 0.9 + (r % 5) * 0.04; s.set(sc, sc, sc); m4.compose(new THREE.Vector3(x, BENCH_TOP + 0.005, z), q, s); im.setMatrixAt(i, m4); });
    im.count = b.length; im.castShadow = true; im.receiveShadow = true; benchGroup.add(im); return im;
  });
  // heat-map plane
  heatPlane = new THREE.Mesh(new THREE.PlaneGeometry(p.W, p.D), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
  heatPlane.rotation.x = -Math.PI / 2; benchGroup.add(heatPlane);
  // walls (cut-away: BackSide shows only the far walls)
  if (wallMesh) { scene.remove(wallMesh); wallMesh = null; }
  if (p.walls !== 'none') {
    const H = 2.4;
    const geo = new THREE.BoxGeometry(p.W, H, p.D); geo.groups = geo.groups.filter((g, i) => i !== 2 && i !== 3);
    const mat = p.walls === 'film' ? new THREE.MeshStandardMaterial({ color: 0xd8dce0, metalness: 1, roughness: 0.22, side: THREE.BackSide }) : new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.9, side: THREE.BackSide });
    wallMesh = new THREE.Mesh(geo, mat); wallMesh.position.y = H / 2; wallMesh.receiveShadow = true; scene.add(wallMesh);
  }
}
function buildFixtures(p) {
  fixtureGroup.clear(); coneGroup.clear();
  const barLen = 0.9 * p.D / p.nz;
  const color = p.eff < 2 ? ['warmwhite'] : p.eff > 3.1 ? ['red', 'red', 'blue', 'red', 'white'] : 'full';
  const n = BEAMS[p.beam]; const half = Math.acos(Math.pow(0.5, 1 / n));
  for (let i = 0; i < p.nx; i++) for (let j = 0; j < p.nz; j++) {
    const x = -p.W / 2 + (i + 0.5) * p.W / p.nx, z = -p.D / 2 + (j + 0.5) * p.D / p.nz;
    const bar = makeLEDBar({ length: barLen, width: Math.min(0.12, 0.05 + p.power / 3000), color, light: 'rect', lightIntensity: 2 + p.power * p.eff / 45 });
    bar.rotation.y = Math.PI / 2; bar.position.set(x, Y_CANOPY + p.h, z); fixtureGroup.add(bar);
    // hangers
    [-1, 1].forEach(s => { const y0 = Y_CANOPY + p.h + 0.02; const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 3 - y0, 6), M.steel()); wire.position.set(x, y0 + (3 - y0) / 2, z + s * barLen * 0.42); fixtureGroup.add(wire); });
    // cone
    const R = p.h * Math.tan(half);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.03, R, p.h, 40, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7ad9, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    cone.position.set(x, Y_CANOPY + p.h / 2, z); cone.scale.z = 1 + barLen / (2 * Math.max(0.05, R)); coneGroup.add(cone);
  }
}

/* ------------------------------------------------------------ probe (virtual quantum sensor) */
function makeQuantumSensor() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 24), M.anodised()); body.position.y = 0.015; g.add(body);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.35, transmission: 0.3 })); dome.position.y = 0.03; g.add(dome);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.25, 8), M.steel()); rod.position.y = -0.11; g.add(rod);
  g.traverse(m => { if (m.isMesh) m.castShadow = true; });
  return g;
}
stage.onPick({
  objects: () => [heatPlane, ...lettuceMeshes, ...benchGroup.children.filter(c => c.isMesh)],
  onClick: hit => {
    if (!hit) return;
    const p = ui.values();
    const x = THREE.MathUtils.clamp(hit.point.x, -p.W / 2, p.W / 2), z = THREE.MathUtils.clamp(hit.point.z, -p.D / 2, p.D / 2);
    probePos = { x, z }; updateProbe();
  }
});
function updateProbe() {
  if (!probePos) return;
  const p = ui.values();
  if (!probe) { probe = makeQuantumSensor(); scene.add(probe); probeLabel = stage.addLabel(probe, '', { offset: [0, 0.09, 0], className: 'label3d lg' }); }
  probePos.x = THREE.MathUtils.clamp(probePos.x, -p.W / 2, p.W / 2); probePos.z = THREE.MathUtils.clamp(probePos.z, -p.D / 2, p.D / 2);
  probe.position.set(probePos.x, Y_CANOPY, probePos.z);
  const n = BEAMS[p.beam]; const I0 = (n + 1) * (p.power * p.eff / 5) / (2 * Math.PI);
  const E = ppfdAt(probePos.x, probePos.z, withImages(sources(p), p), I0, p.h, n);
  probeLabel.element.innerHTML = `Quantum sensor<small>${fmt(E, 0)} µmol m⁻² s⁻¹ · DLI ${fmt(E * p.photo * 0.0036, 1)}</small>`;
}

/* ------------------------------------------------------------ charts */
const profile = new Plot('#chart-profile', { x: { label: 'Position along bench', unit: 'm' }, y: { label: 'PPFD', unit: 'µmol m⁻² s⁻¹', min: 0 } });
const heightPlot = new Plot('#chart-height', { x: { label: 'Height above canopy', unit: 'm', min: 0.1, max: 1.2 }, y: { label: 'Mean PPFD', unit: 'µmol m⁻² s⁻¹', min: 0 }, y2: { label: 'Uniformity', unit: 'min/mean', min: 0, max: 1 } });
const hist = new BarChart('#chart-hist', { y: { label: 'Share of canopy', unit: '%', min: 0 }, legend: false });

/* ------------------------------------------------------------ update loop */
let lastGeom = '', lastFix = '';
function update() {
  const p = ui.values();
  const geomKey = [p.W, p.D, p.walls].join('|');
  if (geomKey !== lastGeom) { buildBench(p); lastGeom = geomKey; lastFix = ''; }
  const fixKey = [p.nx, p.nz, p.h, p.power, p.eff, p.beam, p.W, p.D].join('|');
  if (fixKey !== lastFix) { buildFixtures(p); lastFix = fixKey; }
  const R = computeMap(p);
  const N = p.nx * p.nz, area = p.W * p.D, ppfTot = N * p.power * p.eff;
  const dli = R.mean * p.photo * 0.0036;
  const cap = R.mean * area / ppfTot;
  const kwhDay = N * p.power * p.photo / 1000;
  const crop = CROPS[p.crop];
  const target = crop.dli.map(d => d * 1e6 / (3600 * p.photo));
  // readouts
  ro.set('mean', R.mean, R.mean >= target[0] && R.mean <= target[1] ? 'ok' : 'warn', `target ${fmt(target[0], 0)}–${fmt(target[1], 0)}`);
  ro.set('range', `${fmt(R.min, 0)} – ${fmt(R.max, 0)}`);
  const U = R.min / R.mean; ro.set('unif', U, U >= 0.8 ? 'ok' : U >= 0.6 ? 'warn' : 'bad', U >= 0.8 ? 'excellent' : U >= 0.6 ? 'acceptable' : 'poor — visible growth differences');
  ro.set('dli', dli, dli >= crop.dli[0] && dli <= crop.dli[1] ? 'ok' : dli < crop.dli[0] ? 'warn' : 'bad', `${crop.label.split(' (')[0]} target ${crop.dli[0]}–${crop.dli[1]}`);
  ro.set('cap', cap * 100, cap > 0.8 ? 'ok' : cap > 0.55 ? 'warn' : 'bad');
  ro.set('pd', N * p.power / area);
  ro.set('kwh', kwhDay);
  ro.set('cost', kwhDay * 365 * p.price, null, `${fmt(kwhDay * 365 * p.price / area, 0)} € m⁻² yr⁻¹`);
  ro.set('kwhmol', 0.27778 / (p.eff * cap));
  hud.set('ppfd', `Mean PPFD <b>${fmt(R.mean, 0)}</b> µmol m⁻² s⁻¹`);
  hud.set('dli', `DLI <b>${fmt(dli, 1)}</b> mol m⁻² d⁻¹ · U <b>${fmt(U, 2)}</b>`);
  // heat map
  const lo = 0, hi = Math.max(R.max, target[1] * 1.1);
  if (heatPlane.material.map) heatPlane.material.map.dispose();
  heatPlane.material.map = heatmapTexture(R.vals, { colormap: 'turbo', min: lo, max: hi }); heatPlane.material.needsUpdate = true;
  legend.innerHTML = `PPFD (µmol m⁻² s⁻¹)<div class="cbar" style="background:${colormapGradient('turbo')}"></div><div class="cbar-ticks"><span>0</span><span>${fmt(hi / 2, 0)}</span><span>${fmt(hi, 0)}</span></div>`;
  const view = p.view;
  heatPlane.visible = view !== 'crop';
  heatPlane.position.y = view === 'map' ? Y_CANOPY : BENCH_TOP + 0.004;
  heatPlane.material.opacity = view === 'map' ? 0.95 : 0.85;
  lettuceMeshes.forEach(m => m.visible = view !== 'map');
  coneGroup.visible = p.cones;
  updateProbe();
  // profile chart
  const xs = linspace(-p.W / 2, p.W / 2, 121);
  profile.line('centre', xs, xs.map(x => ppfdAt(x, 0, R.S, R.I0, p.h, R.n)), { color: 'accent', label: 'Centre line', width: 2.4 });
  profile.line('edge', xs, xs.map(x => ppfdAt(x, p.D / 2 - 0.01, R.S, R.I0, p.h, R.n)), { color: 'magenta', label: 'Front edge', width: 2, dash: [6, 4] });
  profile.hregion('target', target[0], target[1], { color: 'amber', alpha: 0.14, label: `DLI target at ${p.photo} h` });
  profile.setAxis('x', { min: -p.W / 2, max: p.W / 2 });
  // histogram
  const bins = 10, all = R.vals.flat(), bmin = R.min, bmax = R.max, bw = (bmax - bmin) / bins || 1;
  const counts = new Array(bins).fill(0); all.forEach(v => counts[Math.min(bins - 1, Math.floor((v - bmin) / bw))]++);
  hist.set(counts.map((_, i) => `${fmt(bmin + i * bw, 0)}–${fmt(bmin + (i + 1) * bw, 0)}`), [{ label: 'Share', values: counts.map(c => 100 * c / all.length), colors: counts.map((_, i) => { const t = (bmin + (i + 0.5) * bw) / hi; return `hsl(${250 - 250 * Math.min(1, t)}, 70%, 50%)`; }) }]);
  scheduleSweep();
}
let sweepT = null;
function scheduleSweep() {
  clearTimeout(sweepT);
  sweepT = setTimeout(() => {
    const p = ui.values(); const hs = linspace(0.1, 1.2, 23); const means = [], unifs = [];
    hs.forEach(h => { const r = computeMap(p, 24, 12, h); means.push(r.mean); unifs.push(r.min / r.mean); });
    heightPlot.line('mean', hs, means, { color: 'accent', label: 'Mean PPFD', width: 2.4 });
    heightPlot.line('unif', hs, unifs, { color: 'water', label: 'Uniformity', width: 2.2, y2: true });
    heightPlot.vline('now', p.h, { color: 'magenta', label: 'current' });
  }, 180);
}
let raf = 0;
ui.onChange(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
update();
stage.onFrame((dt, t) => {
  // gentle flicker-free glow pulse on the probe label is unnecessary; keep scene static for crisp readings
});
