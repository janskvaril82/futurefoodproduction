/* ==========================================================================
   Agrivoltaic field designer — 3D scene, controls, readouts and charts.
   The physics lives in ./model.js (Derive tab, Eqs. A1–A11).
   ========================================================================== */
import { createStage, addSky, fitShadow, THREE, M, makeGround, surfaceMaterial, rng, BufferGeometryUtils, RoundedBoxGeometry } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, BarChart, linspace } from '/assets/js/plot.js';
import { colormap, colormapGradient } from '/assets/js/colors.js';
import { SUN_PPFD_PER_WM2, sunsetHourAngle, deg } from '/assets/js/physics.js';
import { LOCS, CROPS, PV, REF, MONTHS, makeArray, makeGrid, dayRadiation, dayLight, instantMap, seasonCrop, pvAnnual, referencePV, gcrSweep, sunWorld, toLocal, toWorld, skyViewFactor, blocked, poa, faceViewFactors } from './model.js';
import { moduleTexture, lettuceLeafTexture, potatoLeafTexture, grassTuftTexture, maizeTexture, plantCards } from './textures.js';

const FIELD_L = 40;                        // m, row length / field length along the rows
const NV = 64, NU = 32;                    // light-map grid (across × along the rows)
const MODE_LABEL = { overhead: 'overhead tilted rows', vertical: 'vertical bifacial fences', ground: 'ground-mounted PV' };
const hhmm = h => { h = ((h % 24) + 24) % 24; let H = Math.floor(h), m = Math.round((h - H) * 60); if (m === 60) { H = (H + 1) % 24; m = 0; } return `${String(H).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
const dateStr = d => { const dt = new Date(Date.UTC(2026, 0, d)); return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/* ------------------------------------------------------------------ UI */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'gcr', label: 'Ground-coverage ratio', unit: '', digits: 2, note: '&nbsp;' })
  .add({ id: 'par', label: 'Light reduction for the crop (season)', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'dli', label: 'Crop daily light integral today', unit: 'mol m⁻² d⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'unif', label: 'Light uniformity (min / max)', unit: '', digits: 2, note: '&nbsp;' })
  .add({ id: 'yield', label: 'Crop yield per hectare vs open field', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'loss', label: 'Land not cultivated', unit: '%', digits: 1, note: '&nbsp;' })
  .add({ id: 'kwp', label: 'Installed PV capacity', unit: 'kWp ha⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'mwh', label: 'Electricity', unit: 'MWh ha⁻¹ yr⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'spec', label: 'Specific yield', unit: 'kWh kWp⁻¹ yr⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'erel', label: 'Electricity vs ground-mounted PV', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'ler', label: 'Land equivalent ratio', unit: '', digits: 2, note: '&nbsp;' })
  .add({ id: 'now', label: 'PV output now', unit: 'W m⁻² of land', digits: 0, note: '&nbsp;' });

ui.section('Site and day');
ui.select({ id: 'loc', label: 'Location', options: Object.entries(LOCS).map(([value, L]) => ({ value, label: `${L.name} · ${L.lat.toFixed(1)}° N` })), value: 'karrbo', help: 'Monthly cloudiness (clearness index) and temperature from the NASA POWER climatology.' });
ui.slider({ id: 'day', label: 'Day shown in 3D', min: 1, max: 365, step: 1, value: 172, format: v => `${Math.round(v)} · ${dateStr(Math.round(v))}` });
ui.slider({ id: 'time', label: 'Local solar time', min: 0, max: 24, step: 0.05, value: 13, format: v => hhmm(v), help: '12:00 = sun due south. Press play (or space in the scene) to run the day.' });
const playBtns = ui.buttons([{ label: '▶ Play the day', variant: 'primary', onClick: () => clock.toggle() }, { label: 'Sunrise', onClick: () => jump('rise') }, { label: 'Noon', onClick: () => jump('noon') }]);
ui.segmented({ id: 'speed', label: 'Playback speed', options: [{ value: 1800, label: '½ h/s' }, { value: 5400, label: '1½ h/s' }, { value: 14400, label: '4 h/s' }], value: 5400 });
ui.segmented({ id: 'sky', label: 'Sky', options: [{ value: 'clim', label: 'Typical (NASA)' }, { value: 'clear', label: 'Clear' }, { value: 'overcast', label: 'Overcast' }], value: 'clim' });

ui.section('PV array');
ui.segmented({ id: 'mode', label: 'Configuration', options: [{ value: 'overhead', label: 'Overhead tilted' }, { value: 'vertical', label: 'Vertical bifacial' }, { value: 'ground', label: 'Ground-mounted' }], value: 'vertical' });
ui.slider({ id: 'h', label: 'Clearance (lower edge height)', min: 0.2, max: 7, step: 0.1, value: 0.6, unit: 'm', help: 'Overhead systems need ≥ 2.1 m for machinery (DIN SPEC 91434 category I).' });
ui.slider({ id: 'tilt', label: 'Tilt β', min: 0, max: 90, step: 1, value: 90, unit: '°' });
ui.slider({ id: 'az', label: 'Azimuth of the front face', min: 90, max: 270, step: 5, value: 90, unit: '°', format: v => `${Math.round(v)}° ${v < 112.5 ? 'E' : v < 157.5 ? 'SE' : v < 202.5 ? 'S' : v < 247.5 ? 'SW' : 'W'}`, help: '90° = facing east (rows run north–south), 180° = facing south.' });
ui.slider({ id: 'w', label: 'Collector width (slant height)', min: 1, max: 6, step: 0.1, value: 2.3, unit: 'm', help: '≈ 1.13 m per module in landscape orientation.' });
ui.slider({ id: 'pitch', label: 'Row spacing (pitch)', min: 2, max: 25, step: 0.1, value: 10, unit: 'm' });
ui.slider({ id: 'bif', label: 'Bifaciality factor φ', min: 0, max: 0.95, step: 0.05, value: 0.8, help: '0 = monofacial; 0.7–0.9 for bifacial PERC/TOPCon/HJT modules.' });
ui.slider({ id: 'tau', label: 'Light transmission through the modules', min: 0, max: 0.5, step: 0.01, value: 0, format: v => `${Math.round(v * 100)} %`, help: 'Gaps between cells or semi-transparent modules.' });
ui.slider({ id: 'strip', label: 'Uncultivated strip under each row', min: 0, max: 3, step: 0.1, value: 1.0, unit: 'm', help: 'Posts, cables and the area machines cannot reach.' });

ui.section('Crop');
ui.select({ id: 'crop', label: 'Crop', options: Object.entries(CROPS).map(([value, c]) => ({ value, label: `${c.name} — ${c.tol}` })), value: 'ley' });

ui.section('Display');
ui.segmented({ id: 'view', label: 'View', options: [{ value: 'crop', label: 'Crop' }, { value: 'both', label: 'Both' }, { value: 'map', label: 'Light map' }], value: 'both' });
ui.segmented({ id: 'mapm', label: 'Map shows', options: [{ value: 'day', label: 'Day %' }, { value: 'season', label: 'Season %' }, { value: 'yield', label: 'Yield %' }, { value: 'now', label: 'PPFD now' }], value: 'day' });
ui.toggle({ id: 'path', label: 'Show the sun path', value: true });
ui.toggle({ id: 'labels', label: 'Labels in the scene', value: true });
ui.presets([
  { label: 'Kärrbo-like vertical (Västerås)', values: { loc: 'karrbo', mode: 'vertical', h: 0.6, tilt: 90, az: 90, w: 2.3, pitch: 10, bif: 0.8, tau: 0, strip: 1, crop: 'ley', day: 172 } },
  { label: 'Heggelbach-like overhead', values: { loc: 'heggelbach', mode: 'overhead', h: 5, tilt: 20, az: 210, w: 3.4, pitch: 9.5, bif: 0.75, tau: 0, strip: 0.3, crop: 'potato', day: 196 } },
  { label: 'Dense vertical, 5 m', values: { loc: 'karrbo', mode: 'vertical', h: 0.6, tilt: 90, az: 90, w: 2.3, pitch: 5, bif: 0.8, tau: 0, strip: 1, crop: 'cereal', day: 172 } },
  { label: 'Maize under overhead PV', values: { loc: 'lund', mode: 'overhead', h: 5, tilt: 25, az: 180, w: 3.4, pitch: 12, bif: 0.75, tau: 0, strip: 0.3, crop: 'maize', day: 196 } },
  { label: 'Lettuce in the desert', values: { loc: 'tucson', mode: 'overhead', h: 3, tilt: 25, az: 180, w: 3.4, pitch: 7, bif: 0, tau: 0.1, strip: 0.3, crop: 'lettuce', day: 105 } },
  { label: 'Conventional PV park', values: { mode: 'ground', h: 0.8, tilt: 30, az: 180, w: 2.3, pitch: 5.1, bif: 0, tau: 0, strip: 0 } }
]);
ui.saveButton('agrivoltaics-lab', () => ro.values());

/* ------------------------------------------------------------------ 3D stage */
const stage = createStage('#stage', {
  background: null, exposure: 0.5, envIntensity: 0.55,
  camera: { pos: [31, 9.5, 37], target: [0, 1.2, -1], fov: 42, far: 3000 },
  controls: { minDistance: 3, maxDistance: 200, maxPolarAngle: Math.PI * 0.485 },
  bloom: { strength: 0.35, radius: 0.4, threshold: 2.6 }, ao: { radius: 0.45, intensity: 0.7 },
  fog: { color: 0xdbe3e6, near: 140, far: 820 }                     // aerial perspective for the distant landscape
});
const { scene, camera } = stage;
camera.layers.enable(1);
const sky = addSky(stage, { elevation: 40, azimuth: 180, turbidity: 3, sunIntensity: 3.3, shadowSize: 42, updateEnv: false });
sky.sun.shadow.mapSize.set(4096, 4096); fitShadow(sky.sun, 42, [0, 0, 0]); sky.sun.shadow.camera.far = 220; sky.sun.shadow.camera.updateProjectionMatrix();
sky.sun.shadow.bias = -0.00025; sky.sun.shadow.normalBias = 0.04;
const hud = hudChips(stage.el);
const legend = document.createElement('div'); legend.className = 'stage-legend'; stage.el.appendChild(legend);
// guided camera moves: top view of the light map, and the crop's view under the modules
const ICON = {
  top: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></svg>',
  crop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 21V11M12 11c0-4-3-6-7-6 0 4 3 6 7 6zM12 14c0-3 3-5 7-5 0 3-3 5-7 5zM3 21h18"/></svg>'
};
stage.addTool({ icon: ICON.top, title: 'Top view of the light map', onClick: () => { const W = state.A ? state.A.N * state.A.p : 40; stage.flyTo([0.01, 1.25 * Math.max(W, FIELD_L) + 8, 0.02], [0, 0, 0], 1.4); } });
stage.addTool({ icon: ICON.crop, title: "The crop's view between the rows", onClick: () => {
  const A = state.A; if (!A) return; const k = Math.max(0, Math.floor(A.N / 2) - 1); const v = (A.rows[k] + A.rows[Math.min(A.N - 1, k + 1)]) / 2;
  stage.flyTo(toWorld(A, -A.L / 2 + 2.5, 1.35, v - A.p * 0.12), toWorld(A, A.L / 4, Math.max(1.3, A.h * 0.55), v + A.p * 0.08), 1.6);
} });

// landscape
const grassMat = surfaceMaterial('grass', [260, 260]); const sandMat = surfaceMaterial('sand', [160, 160]);
grassMat.color.setRGB(1.25, 1.3, 1.05);
const ground = new THREE.Mesh(new THREE.CircleGeometry(700, 96), grassMat); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = 'ground'; scene.add(ground);
const lake = new THREE.Mesh(new THREE.CircleGeometry(420, 80), M.waterCheap(0x3d6f86, 0.9)); lake.rotation.x = -Math.PI / 2; lake.position.set(-60, 0.03, 520); lake.scale.set(1.6, 0.6, 1); scene.add(lake);
const landscape = new THREE.Group(); scene.add(landscape);
function buildLandscape(veg) {
  landscape.clear();
  ground.material = veg === 'arid' ? sandMat : grassMat; lake.visible = veg === 'nordic';
  const r = rng(veg.length * 31 + 7);
  const conifer = veg === 'nordic', n = veg === 'arid' ? 60 : 300;
  const crownGeo = conifer ? (() => { const a = new THREE.ConeGeometry(1.8, 4.4, 9); a.translate(0, 3.8, 0); const b = new THREE.ConeGeometry(1.3, 3.4, 9); b.translate(0, 5.9, 0); const c = new THREE.ConeGeometry(0.8, 2.4, 9); c.translate(0, 7.6, 0); return BufferGeometryUtils.mergeGeometries([a, b, c]); })()
    : (() => { const g = new THREE.IcosahedronGeometry(2.4, 1); g.scale(1, veg === 'arid' ? 0.5 : 0.85, 1); g.translate(0, veg === 'arid' ? 1.6 : 4.4, 0); return g; })();
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, conifer ? 2.6 : 3.4, 6); trunkGeo.translate(0, conifer ? 1.3 : 1.7, 0);
  const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), n);
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 1 }), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    let a, R; if (i < n * 0.6) { a = r() * Math.PI * 2; R = 85 + Math.pow(r(), 0.7) * 260; } else { a = -2.2 + (r() - 0.5) * 1.3; R = 60 + r() * 55; }
    const s = (conifer ? 1 : 0.9) * (0.7 + r() * 0.8);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28); sc.set(s, s * (0.85 + r() * 0.4), s); m4.compose(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R), q, sc);
    crown.setMatrixAt(i, m4); trunk.setMatrixAt(i, m4);
    if (conifer) c.setHSL(0.33 + r() * 0.05, 0.35, 0.12 + r() * 0.06); else if (veg === 'arid') c.setHSL(0.2 + r() * 0.05, 0.25, 0.3 + r() * 0.08); else c.setHSL(0.27 + r() * 0.06, 0.5, 0.2 + r() * 0.08);
    crown.setColorAt(i, c);
  }
  crown.castShadow = true; landscape.add(crown, trunk);
  // farmstead: Falu-red barn and a white house in Sweden, rendered stone elsewhere
  const wall = veg === 'nordic' ? 0x8e2a20 : veg === 'arid' ? 0xd9c3a0 : 0xe9e4d8, roofC = veg === 'nordic' ? 0x2b2b2e : veg === 'arid' ? 0xb8643a : 0x5a4a44;
  [[-58, -46, 0.35, 16, 8], [-44, -70, 0.35, 11, 7]].forEach(([x, z, rot, L, W], i) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(L, 4.6, W), new THREE.MeshStandardMaterial({ color: i === 1 && veg === 'nordic' ? 0xefeae0 : wall, roughness: 0.85 })); body.position.y = 2.3; body.castShadow = body.receiveShadow = true; g.add(body);
    const sh = new THREE.Shape(); sh.moveTo(-W / 2 - 0.4, 0); sh.lineTo(0, 3.2); sh.lineTo(W / 2 + 0.4, 0); sh.lineTo(-W / 2 - 0.4, 0);
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: L + 0.8, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: roofC, roughness: 0.7 }));
    roof.rotation.y = Math.PI / 2; roof.position.set(-L / 2 - 0.4, 4.6, 0); roof.castShadow = true; g.add(roof);
    if (veg === 'nordic') { const trim = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.6 }); [-1, 1].forEach(sx => [-1, 1].forEach(sz => { const t = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.6, 0.22), trim); t.position.set(sx * L / 2, 2.3, sz * W / 2); g.add(t); })); }
    g.position.set(x, 0, z); g.rotation.y = rot; landscape.add(g);
  });
}

// array group: local frame u (x) along rows, v (z) across rows; rotated by θ = π − azimuth
const field = new THREE.Group(); scene.add(field);
const soilMat = surfaceMaterial('tilled', [10, 10]); soilMat.color.setRGB(1.5, 1.35, 1.2);
const swardMat = surfaceMaterial('grass', [30, 30]); swardMat.color.setRGB(1.3, 1.4, 1.1);
const soil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), soilMat); soil.rotation.x = -Math.PI / 2; soil.position.y = 0.01; soil.receiveShadow = true; soil.name = 'soil'; field.add(soil);
const stripGroup = new THREE.Group(); field.add(stripGroup);
const arrayGroup = new THREE.Group(); field.add(arrayGroup);
const cropGroup = new THREE.Group(); field.add(cropGroup);

// PV module materials (front cells, rear side, aluminium frame)
const frameMat = M.aluminium();
const matCache = {};
function moduleMaterials(bifacial) {
  const k = bifacial ? 'bi' : 'mono'; if (matCache[k]) return matCache[k];
  const front = new THREE.MeshPhysicalMaterial({ map: moduleTexture('front', bifacial), roughness: 0.22, metalness: 0.08, clearcoat: 0.8, clearcoatRoughness: 0.05, envMapIntensity: 0.6 });
  const back = new THREE.MeshPhysicalMaterial({ map: moduleTexture('back', bifacial), roughness: bifacial ? 0.3 : 0.6, metalness: 0.05, clearcoat: bifacial ? 0.5 : 0.1, clearcoatRoughness: 0.1, envMapIntensity: 0.6 });
  return (matCache[k] = [frameMat, frameMat, front, back, frameMat, frameMat]);
}
const steelMat = M.galvanised(), concreteMat = M.concrete([1, 1]), inverterMat = M.paintedSteel(0xd9dcd8), darkMat = M.plasticBlack();

/** Instanced unit boxes between pairs of points (beams, posts, rails). */
function beams(list, material) {
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, list.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), d = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
  list.forEach(([a, b, sx, sy], i) => { A.set(...a); B.set(...b); d.subVectors(B, A); const L = d.length(); q.setFromUnitVectors(z, d.normalize()); s.set(sx, sy ?? sx, L); m4.compose(A.clone().add(B).multiplyScalar(0.5), q, s); im.setMatrixAt(i, m4); });
  im.castShadow = true; im.receiveShadow = true; return im;
}
let rowLabel = null, cropLabel = null;
function buildArray(A, p) {
  arrayGroup.traverse(o => { if (o.isInstancedMesh || (o.isMesh && o.geometry)) { if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose(); } });
  arrayGroup.clear(); rowLabel = null;
  const mats = moduleMaterials(p.bif > 0.05);
  const nW = Math.max(1, Math.round(A.w / 1.134)), mh = A.w / nW, nL = Math.max(1, Math.floor(A.L / 2.3)), ml = A.L / nL;
  const mod = new THREE.InstancedMesh(new THREE.BoxGeometry(ml - 0.025, 0.035, mh - 0.02), mats, A.N * nW * nL);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(A.beta, 0, 0)), one = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3();
  let k = 0;
  for (let r = 0; r < A.N; r++) for (let j = 0; j < nW; j++) for (let i = 0; i < nL; i++) {
    const s = -A.w / 2 + (j + 0.5) * mh;
    P.set(-A.L / 2 + (i + 0.5) * ml, A.yc + s * A.sb, A.rows[r] - s * A.cb);
    m4.compose(P, q, one); mod.setMatrixAt(k++, m4);
  }
  mod.castShadow = true; mod.receiveShadow = true; mod.name = 'pv-modules'; arrayGroup.add(mod);
  // mounting structure
  const n = [0, A.cb, A.sb]; const off = (pt, d) => [pt[0] - n[0] * d, pt[1] - n[1] * d, pt[2] - n[2] * d];
  const posts = [], rails = [], braces = [], pads = [], invs = [];
  for (let r = 0; r < A.N; r++) {
    const v = A.rows[r];
    const lower = [0, A.h, v + A.w / 2 * A.cb], upper = [0, A.h + A.w * A.sb, v - A.w / 2 * A.cb];
    if (p.mode === 'vertical') {
      const np = Math.ceil(A.L / 4.6); for (let i = 0; i <= np; i++) { const u = -A.L / 2 + i * A.L / np; posts.push([[u, -0.4, v - 0.07], [u, A.h + A.w + 0.08, v - 0.07], 0.09, 0.06]); }
      [A.h + 0.1, A.h + A.w / 2, A.h + A.w - 0.1].forEach(y => rails.push([[-A.L / 2, y, v - 0.035], [A.L / 2, y, v - 0.035], 0.05, 0.06]));
    } else if (p.mode === 'overhead') {
      const np = Math.max(1, Math.round(A.L / 6.4));
      for (let i = 0; i <= np; i++) {
        const u = -A.L / 2 + i * A.L / np; const mid = [u, A.yc, v]; const top = off(mid, 0.14);
        posts.push([[u, 0, v], top, 0.16, 0.16]); pads.push([u, v]);
        rails.push([off([u, lower[1], lower[2]], 0.12), off([u, upper[1], upper[2]], 0.12), 0.1, 0.14]);          // rafter
        const kneeY = top[1] - 1.1; [-1, 1].forEach(sd => braces.push([[u, kneeY, v], off([u, A.yc + sd * A.w * 0.3 * A.sb, v - sd * A.w * 0.3 * A.cb], 0.12), 0.07, 0.07]));
      }
      [-0.3, 0.3].forEach(f => { const pt = off([0, A.yc + f * A.w * A.sb, v - f * A.w * A.cb], 0.06); rails.push([[-A.L / 2, pt[1], pt[2]], [A.L / 2, pt[1], pt[2]], 0.06, 0.09]); });
    } else {
      const np = Math.max(1, Math.round(A.L / 3.2));
      for (let i = 0; i <= np; i++) {
        const u = -A.L / 2 + i * A.L / np;
        posts.push([[u, -0.3, lower[2] - 0.15], off([u, lower[1] + 0.12 * A.sb, lower[2] - 0.12 * A.cb], 0.08), 0.08, 0.06]);
        posts.push([[u, -0.3, upper[2] + 0.15], off([u, upper[1] - 0.12 * A.sb, upper[2] + 0.12 * A.cb], 0.08), 0.08, 0.06]);
        rails.push([off(lower, 0.1), off(upper, 0.1), 0.06, 0.08]);
      }
      [-0.3, 0.3].forEach(f => { const pt = off([0, A.yc + f * A.w * A.sb, v - f * A.w * A.cb], 0.06); rails.push([[-A.L / 2, pt[1], pt[2]], [A.L / 2, pt[1], pt[2]], 0.05, 0.07]); });
    }
    invs.push([A.L / 2 + 1.0, v]);
  }
  [beams(posts, steelMat), beams(rails, steelMat), beams(braces, steelMat)].forEach(b => b && arrayGroup.add(b));
  if (pads.length) { const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.36, 0.14, 14), concreteMat, pads.length); pads.forEach(([u, v], i) => pm.setMatrixAt(i, new THREE.Matrix4().makeTranslation(u, 0.06, v))); pm.receiveShadow = true; arrayGroup.add(pm); }
  // string inverters on posts at the row ends
  const inv = new THREE.InstancedMesh(new RoundedBoxGeometry(0.5, 0.62, 0.22, 2, 0.03), inverterMat, invs.length);
  const ipost = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 1.6, 0.07), steelMat, invs.length);
  invs.forEach(([u, v], i) => { inv.setMatrixAt(i, new THREE.Matrix4().makeTranslation(u, 1.25, v)); ipost.setMatrixAt(i, new THREE.Matrix4().makeTranslation(u, 0.8, v - 0.15)); });
  inv.castShadow = ipost.castShadow = true; arrayGroup.add(inv, ipost);
  // label
  const mid = Math.floor(A.N / 2);
  rowLabel = stage.addLabel(arrayGroup, '', { offset: [-A.L / 2 + 3, A.h + A.w * A.sb + 0.9, A.rows[mid]] });
}

/* ------------------------------------------------------------------ crop (instanced cards) */
const cardTex = { lettuce: lettuceLeafTexture(), potato: potatoLeafTexture(), grass: grassTuftTexture('grass'), cereal: grassTuftTexture('cereal'), maize: maizeTexture() };
const cardGeo = {}; const cardMat = {};
const uWind = { value: 0 };
function plantMaterial(kind) {
  if (cardMat[kind]) return cardMat[kind];
  const m = new THREE.MeshStandardMaterial({ map: cardTex[kind], alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = uWind;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
      float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
      float bend = uv.y * uv.y;
      transformed.x += (sin(uTime * 1.7 + ph) * 0.05 + sin(uTime * 3.3 + ph * 1.9) * 0.02) * bend;
      transformed.z += cos(uTime * 1.3 + ph) * 0.03 * bend;
      #endif`);
  };
  return (cardMat[kind] = m);
}
let plants = null;   // { mesh, u, v, base, rot } typed arrays
function buildCrop(A, p, crop) {
  cropGroup.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); cropGroup.clear(); plants = null;
  stripGroup.clear();
  const kind = p.mode === 'ground' ? 'grass' : crop.vis;
  soil.material = kind === 'grass' ? swardMat : soilMat;           // a closed sward under ley grass, bare tilled soil between row crops
  if (!cardGeo[kind]) cardGeo[kind] = plantCards(kind);
  const W = A.N * A.p, L = A.L - 0.6;
  const sp = kind === 'grass' ? [0.27, 0.27] : kind === 'cereal' ? [0.26, 0.26] : kind === 'maize' ? [0.75, 0.25] : [crop.rowSp, crop.plantSp];
  const us = [], vs = [], rot = [], base = [], hue = [];
  const r = rng(17 + kind.length);
  const nRows = Math.floor(W / sp[0]);
  for (let i = 0; i < nRows; i++) {
    const v = -W / 2 + (i + 0.5) * W / nRows;
    let near = false; for (let k = 0; k < A.N; k++) { const half = p.mode === 'ground' ? 0 : Math.max(p.strip / 2, p.mode === 'vertical' ? 0.25 : 0.2); if (Math.abs(v - A.rows[k]) < half) near = true; }
    if (near) continue;
    const nP = Math.floor(L / sp[1]);
    for (let j = 0; j < nP; j++) {
      if (r() < 0.03) continue;
      us.push(-L / 2 + (j + 0.5) * L / nP + (r() - 0.5) * sp[1] * (kind === 'grass' || kind === 'cereal' ? 0.8 : 0.25));
      vs.push(v + (r() - 0.5) * sp[0] * (kind === 'grass' || kind === 'cereal' ? 0.8 : 0.12));
      rot.push(r() * Math.PI * 2); base.push(0.85 + r() * 0.3); hue.push(r());
    }
  }
  const n = us.length; if (!n) return;
  const mesh = new THREE.InstancedMesh(cardGeo[kind], plantMaterial(kind), n);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'crop';
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) { c.setHSL(0.24 + (hue[i] - 0.5) * 0.04, 0.35 + hue[i] * 0.15, 0.72 + (hue[i] - 0.5) * 0.18); mesh.setColorAt(i, c); }
  cropGroup.add(mesh);
  plants = { mesh, u: Float32Array.from(us), v: Float32Array.from(vs), rot: Float32Array.from(rot), base: Float32Array.from(base), n, kind };
  // green strips under the rows (uncultivated)
  if (p.strip > 0.05 && p.mode !== 'ground') {
    const sm = surfaceMaterial('grass', [Math.max(1, p.strip), A.L / 2]);
    for (let k = 0; k < A.N; k++) { const g = new THREE.Mesh(new THREE.PlaneGeometry(A.L, p.strip), sm); g.rotation.x = -Math.PI / 2; g.position.set(0, 0.018, A.rows[k]); g.receiveShadow = true; stripGroup.add(g); }
  }
}
function sizePlants(G, yRel, cropH) {
  if (!plants) return;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), P = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const W = G.vs[G.nv - 1] - G.vs[0], Lg = G.us[G.nu - 1] - G.us[0];
  const kindScale = plants.kind === 'lettuce' ? 1.2 : plants.kind === 'potato' ? cropH / 0.5 : plants.kind === 'grass' ? cropH / 0.45 : plants.kind === 'cereal' ? cropH / 0.9 : cropH / 2.0;
  for (let i = 0; i < plants.n; i++) {
    let y = 1;
    if (yRel) {
      const fi = clamp((plants.v[i] - G.vs[0]) / W * (G.nv - 1), 0, G.nv - 1), fj = clamp((plants.u[i] - G.us[0]) / Lg * (G.nu - 1), 0, G.nu - 1);
      const i0 = Math.floor(fi), j0 = Math.floor(fj), i1 = Math.min(G.nv - 1, i0 + 1), j1 = Math.min(G.nu - 1, j0 + 1), a = fi - i0, b = fj - j0;
      y = (yRel[j0 * G.nv + i0] * (1 - a) + yRel[j0 * G.nv + i1] * a) * (1 - b) + (yRel[j1 * G.nv + i0] * (1 - a) + yRel[j1 * G.nv + i1] * a) * b;
    }
    const f = plants.base[i] * kindScale * Math.sqrt(clamp(y, 0.05, 1.25));
    q.setFromAxisAngle(up, plants.rot[i]); s.set(f, f, f); P.set(plants.u[i], 0.02, plants.v[i]);
    m4.compose(P, q, s); plants.mesh.setMatrixAt(i, m4);
  }
  plants.mesh.instanceMatrix.needsUpdate = true;
  plants.mesh.computeBoundingSphere();
}

/* ------------------------------------------------------------------ light-map overlay (DataTexture) */
const mapData = new Uint8Array(NV * NU * 4);
const mapTex = new THREE.DataTexture(mapData, NV, NU, THREE.RGBAFormat); mapTex.colorSpace = THREE.SRGBColorSpace; mapTex.magFilter = THREE.LinearFilter; mapTex.minFilter = THREE.LinearFilter; mapTex.needsUpdate = true;
const mapMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: mapTex, transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
mapMesh.renderOrder = 2; field.add(mapMesh);
function setMapQuad(W, L) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-L / 2, 0, -W / 2, L / 2, 0, -W / 2, L / 2, 0, W / 2, -L / 2, 0, W / 2], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));   // u_tex ↔ v (across rows), v_tex ↔ u (along rows)
  g.setIndex([0, 2, 1, 0, 3, 2]); mapMesh.geometry.dispose(); mapMesh.geometry = g;
}
function paintMap(values, lo, hi, cm) {
  for (let k = 0; k < values.length; k++) { const c = colormap(cm, (values[k] - lo) / (hi - lo || 1)); mapData[k * 4] = c[0]; mapData[k * 4 + 1] = c[1]; mapData[k * 4 + 2] = c[2]; mapData[k * 4 + 3] = 255; }
  mapTex.needsUpdate = true;
}

/* ------------------------------------------------------------------ probe (quantum sensor on a stake) */
const probe = new THREE.Group(); probe.visible = false; field.add(probe);
{
  const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), M.steel()); stake.position.y = 0.5; stake.name = 'stake'; probe.add(stake);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 20), M.anodised()); body.name = 'head'; probe.add(body);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.026, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 })); dome.name = 'dome'; probe.add(dome);
  probe.traverse(o => { if (o.isMesh) o.castShadow = true; });
}
const probeLabel = stage.addLabel(probe, '', { className: 'label3d lg', offset: [0, 1.4, 0] });
let probePos = null;
function placeProbe(u, v, cropH) {
  probePos = { u, v }; probe.visible = true; probe.position.set(u, 0, v);
  const h = Math.max(0.25, cropH + 0.05); probe.getObjectByName('stake').scale.y = h; probe.getObjectByName('stake').position.y = h / 2;
  probe.getObjectByName('head').position.y = h + 0.025; probe.getObjectByName('dome').position.y = h + 0.05;
  probeLabel.position.set(0, h + 0.45, 0);
}
stage.onPick({
  objects: () => [soil, mapMesh, ...stripGroup.children],
  onClick: hit => {
    if (!hit) return;
    const pl = field.worldToLocal(hit.point.clone());
    const W = state.A.N * state.A.p;
    if (Math.abs(pl.x) > state.A.L / 2 || Math.abs(pl.z) > W / 2) return;
    placeProbe(pl.x, pl.z, state.crop.h); recomputeDay(); drawDayChart(); applyTime(); drawMapChart();
  }
});

/* ------------------------------------------------------------------ sun path arc */
const pathMat = new THREE.LineDashedMaterial({ color: 0xffd27a, dashSize: 2.2, gapSize: 1.4, transparent: true, opacity: 0.85, depthWrite: false });
const sunPath = new THREE.Line(new THREE.BufferGeometry(), pathMat); sunPath.layers.set(1); scene.add(sunPath);
const sunDisk = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffe9a8, toneMapped: false })); sunDisk.layers.set(1); scene.add(sunDisk);
const R_ARC = 75;
function buildSunPath() {
  const pts = []; const dayR = state.dr; for (let i = 0; i < dayR.n; i++) { if (dayR.el[i] > -0.02) { const s = sunWorld(dayR.el[i], dayR.az[i]); pts.push(new THREE.Vector3(s[0] * R_ARC, s[1] * R_ARC, s[2] * R_ARC)); } }
  sunPath.geometry.dispose(); sunPath.geometry = new THREE.BufferGeometry().setFromPoints(pts.length > 1 ? pts : [new THREE.Vector3(), new THREE.Vector3()]); sunPath.computeLineDistances();
}

/* ------------------------------------------------------------------ charts */
const mapPlot = new Plot('#chart-map', { x: { label: 'Across the rows', unit: 'm' }, y: { label: 'Along the rows', unit: 'm' }, legend: false, crosshair: false });
const dayPlot = new Plot('#chart-day', { x: { label: 'Local solar time', unit: 'h', min: 0, max: 24 }, y: { label: 'PPFD at the crop', unit: 'µmol m⁻² s⁻¹', min: 0 }, y2: { label: 'PV output', unit: 'W m⁻² of land', min: 0 } });
const bars = new BarChart('#chart-bars', { y: { label: 'Relative to single use', unit: '', min: 0 } });
const lerPlot = new Plot('#chart-ler', { x: { label: 'Ground-coverage ratio GCR', unit: '', min: 0, max: 0.7 }, y: { label: 'Ratio to single use', unit: '', min: 0 } });
const mapCbar = document.getElementById('map-cbar');
mapPlot.on('click', e => {
  if (!e.inside || !state.A) return; const W = state.A.N * state.A.p;
  if (Math.abs(e.x) > W / 2 || Math.abs(e.y) > state.A.L / 2) return;
  placeProbe(e.y, e.x, state.crop.h); recomputeDay(); drawDayChart(); applyTime(); drawMapChart();
});

/* ------------------------------------------------------------------ model state */
const state = { A: null, G: null, S: null, D: null, dr: null, pv: null, ref: null, vf: null, svfMean: 0.8, sweep: null, crop: CROPS.ley, L: LOCS.karrbo, keys: {}, inst: new Float32Array(NV * NU) };
function params() {
  const p = ui.values();
  const mode = p.mode; const tilt = mode === 'vertical' ? 90 : p.tilt;
  const N = clamp(Math.round(40 / p.pitch), 2, 14);
  return { ...p, tilt, N, L: LOCS[p.loc] || LOCS.karrbo, crop: CROPS[p.crop] || CROPS.ley };
}
function recomputeDay() {
  const p = params();
  state.dr = dayRadiation(p.L, Math.round(p.day), p.sky, 0.25);
  state.D = dayLight(state.A, state.G, state.dr, state.crop, { probe: probePos });
}
let sweepTimer = null;
function recompute() {
  const p = params(); const t0 = performance.now();
  const geoKey = [p.mode, p.h, p.tilt, p.az, p.w, p.pitch, p.tau, p.N, p.strip, p.crop].join('|');
  const locKey = [p.loc, p.sky].join('|');
  state.L = p.L; state.crop = p.crop;
  field.rotation.y = Math.PI - p.az * Math.PI / 180;
  if (geoKey !== state.keys.geo) {
    state.A = makeArray({ mode: p.mode, h: p.h, tilt: p.tilt, az: p.az, w: p.w, pitch: p.pitch, N: p.N, L: FIELD_L, tau: p.tau });
    state.G = makeGrid(state.A, NV, NU, p.crop.h, p.mode === 'ground' ? 0 : p.strip);
    const W = p.N * p.pitch;
    soil.scale.set(FIELD_L + 0.6, W + 0.6, 1); setMapQuad(W, FIELD_L);
    buildArray(state.A, p);
    if ([p.mode, p.N, p.pitch, p.crop, p.strip, p.w].join('|') !== state.keys.crop3d) { buildCrop(state.A, p, p.crop); state.keys.crop3d = [p.mode, p.N, p.pitch, p.crop, p.strip, p.w].join('|'); }
    if (probePos && (Math.abs(probePos.u) > FIELD_L / 2 || Math.abs(probePos.v) > W / 2)) { probePos = null; probe.visible = false; }
    if (probePos) placeProbe(probePos.u, probePos.v, p.crop.h);
    state.keys.geo = geoKey; state.keys.season = ''; state.keys.pv = '';
  }
  if (p.bif > 0.05 !== state.keys.bifMat) { const mesh = arrayGroup.getObjectByName('pv-modules'); if (mesh) mesh.material = moduleMaterials(p.bif > 0.05); state.keys.bifMat = p.bif > 0.05; }
  const seasonKey = geoKey + '|' + locKey;
  if (seasonKey !== state.keys.season) { state.S = seasonCrop(state.A, state.G, p.L, p.crop, p.sky, 0.5); state.keys.season = seasonKey; sizePlants(state.G, p.mode === 'ground' ? null : state.S.yRel, p.crop.h); }
  const pvKey = geoKey + '|' + locKey + '|' + p.bif;
  if (pvKey !== state.keys.pv) {
    state.pv = pvAnnual(state.A, p.L, PV, p.bif, p.sky, { dtH: 0.25 });
    state.vf = state.pv.vf; state.svfMean = state.pv.svfMean;
    if (locKey !== state.keys.ref) { state.ref = referencePV(p.L, PV, p.sky); state.keys.ref = locKey; }
    state.keys.pv = pvKey;
  }
  const dayKey = seasonKey + '|' + Math.round(p.day) + '|' + (probePos ? probePos.u + ',' + probePos.v : '');
  if (dayKey !== state.keys.day) { recomputeDay(); state.keys.day = dayKey; }
  if (locKey + p.day !== state.keys.path) { buildSunPath(); state.keys.path = locKey + p.day; }
  if ((p.L.veg) !== state.keys.veg) { buildLandscape(p.L.veg); state.keys.veg = p.L.veg; }
  const sweepKey = seasonKey + '|' + p.bif;
  if (sweepKey !== state.keys.sweep) { clearTimeout(sweepTimer); sweepTimer = setTimeout(() => runSweep(), 220); state.keys.sweep = sweepKey; }
  state.ms = performance.now() - t0;
}
function runSweep() {
  const p = params();
  const gcrs = [0.06, 0.08, 0.1, 0.12, 0.15, 0.18, 0.21, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7].filter(g => p.mode === 'vertical' || p.w / g >= p.w * 0.98);
  const eRef = state.ref.perLand;
  state.sweep = gcrSweep({ mode: p.mode, h: p.h, tilt: p.tilt, az: p.az, w: p.w, tau: p.tau }, p.L, p.crop, PV, p.bif, p.mode === 'ground' ? 0 : p.strip, p.sky, eRef, gcrs);
  const cur = gcrSweep({ mode: p.mode, h: p.h, tilt: p.tilt, az: p.az, w: p.w, tau: p.tau }, p.L, p.crop, PV, p.bif, p.mode === 'ground' ? 0 : p.strip, p.sky, eRef, [p.w / p.pitch]);
  state.sweepCur = cur;
  drawLerChart();
}

/* ------------------------------------------------------------------ outputs */
function results() {
  const p = params(); const A = state.A, S = state.S, pv = state.pv, ref = state.ref;
  const lost = p.mode === 'ground' ? 1 : Math.min(1, p.strip / p.pitch);
  const cropRel = p.mode === 'ground' ? 0 : S.meanY * (1 - lost);
  const eLand = pv.e * A.gcr;                               // kWh m⁻² of land yr⁻¹
  const eRel = eLand / ref.perLand;
  return { p, lost, cropRel, eLand, eRel, LER: cropRel + eRel, kwp: A.gcr * PV.eta * 1e4, parRed: 1 - S.meanPar };
}
function updateReadouts() {
  const R = results(); const { p } = R; const S = state.S, D = state.D, A = state.A;
  ro.set('gcr', A.gcr, null, `${fmt(A.gcr * 100, 0)} % of the land under modules · ${A.N} rows`);
  ro.set('par', R.parRed * 100, R.parRed < 0.15 ? 'ok' : R.parRed < 0.35 ? 'warn' : 'bad', `${MONTHS[p.crop.months[0]]}–${MONTHS[p.crop.months[p.crop.months.length - 1]]}${p.loc === 'karrbo' && p.mode === 'vertical' ? ' · measured at Kärrbo ≈ 25 %' : ''}`);
  let mean = 0, cnt = 0; for (let k = 0; k < D.dli.length; k++) if (state.G.mask[k]) { mean += D.dli[k]; cnt++; } mean /= Math.max(1, cnt);
  ro.set('dli', mean, null, `open field ${fmt(D.dliOpen, 1)} · ${dateStr(Math.round(p.day))}`);
  ro.set('unif', S.maxPar > 0 ? S.minPar / S.maxPar : 0, S.minPar / S.maxPar > 0.8 ? 'ok' : S.minPar / S.maxPar > 0.6 ? 'warn' : 'bad', `season light ${fmt(S.minPar * 100, 0)}–${fmt(S.maxPar * 100, 0)} % of open`);
  ro.set('yield', R.cropRel * 100, p.mode === 'ground' ? 'bad' : R.cropRel >= 0.66 ? 'ok' : 'bad', p.mode === 'ground' ? 'no crop under a conventional PV park' : `DIN SPEC 91434 needs ≥ 66 % · ${p.crop.tol}`);
  const lim = p.mode === 'overhead' ? 10 : 15;
  ro.set('loss', R.lost * 100, p.mode === 'ground' ? 'bad' : R.lost * 100 <= lim ? 'ok' : 'bad', p.mode === 'ground' ? 'all land used for PV' : `DIN SPEC 91434 limit ${lim} % (category ${p.mode === 'overhead' ? 'I' : 'II'})`);
  ro.set('kwp', R.kwp, null, `η = ${fmt(PV.eta * 100, 1)} % modules`);
  ro.set('mwh', R.eLand * 10, null, `ground-mounted PV ${fmt(state.ref.perLand * 10, 0)} MWh ha⁻¹ yr⁻¹`);
  ro.set('spec', state.pv.spec, null, `reference plant ${fmt(state.ref.spec, 0)} · rear side +${fmt(state.pv.bifGain * 100, 0)} %`);
  ro.set('erel', R.eRel * 100, null, 'same land, same modules, tilt 30°, GCR 0.45');
  ro.set('ler', R.LER, R.LER > 1.2 ? 'ok' : R.LER > 1 ? 'warn' : 'bad', `${fmt(R.cropRel, 2)} crop + ${fmt(R.eRel, 2)} electricity`);
  return R;
}

function drawMapChart() {
  const p = params(); const A = state.A, G = state.G; const W = A.N * A.p;
  const mm = p.mapm; let vals, lo = 0, hi = 100, cm = 'viridis', label = '% of open-field light';
  if (mm === 'season') vals = Array.from(state.S.parRel, v => v * 100);
  else if (mm === 'yield') { vals = Array.from(state.S.yRel, v => v * 100); label = '% of open-field yield'; lo = 0; hi = 100; }
  else if (mm === 'now') { vals = Array.from(state.inst); hi = 2000; cm = 'inferno'; label = 'PPFD now, µmol m⁻² s⁻¹'; }
  else vals = Array.from(state.D.dli, v => state.D.dliOpen > 0 ? 100 * v / state.D.dliOpen : 0);
  const z = []; for (let j = 0; j < G.nu; j++) z.push(vals.slice(j * G.nv, (j + 1) * G.nv));
  mapPlot.heatmap('map', { z, x0: -W / 2, x1: W / 2, y0: -A.L / 2, y1: A.L / 2, colormap: cm, min: lo, max: hi });
  mapPlot.custom('rows', (ctx, pl) => {
    ctx.fillStyle = 'rgba(15,22,30,0.55)'; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
    for (let k = 0; k < A.N; k++) {
      const a = A.rows[k] - A.w / 2 * A.cb, b = A.rows[k] + A.w / 2 * A.cb; const x0 = pl.px(Math.min(a, b)), x1 = pl.px(Math.max(a, b));
      const yT = pl.py(A.L / 2), yB = pl.py(-A.L / 2);
      ctx.fillRect(x0 - (x1 - x0 < 3 ? 1.5 : 0), yT, Math.max(3, x1 - x0), yB - yT); ctx.strokeRect(x0 - (x1 - x0 < 3 ? 1.5 : 0), yT, Math.max(3, x1 - x0), yB - yT);
    }
    // interior region used for crop averages
    ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    const v0 = A.rows[0], v1 = A.rows[A.N - 1]; ctx.strokeRect(pl.px(v0), pl.py(0.3 * A.L), pl.px(v1) - pl.px(v0), pl.py(-0.3 * A.L) - pl.py(0.3 * A.L)); ctx.setLineDash([]);
  });
  if (probePos) mapPlot.point('probe', probePos.v, probePos.u, { color: '#ff5fd2', r: 5, label: 'sensor' }); else mapPlot.remove('probe');
  mapPlot.setAxis('x', { min: -W / 2, max: W / 2 }); mapPlot.setAxis('y', { min: -A.L / 2, max: A.L / 2 });
  if (mapCbar) mapCbar.innerHTML = `<span>${label}</span><div class="cbar" style="background:${colormapGradient(cm)}"></div><div class="cbar-ticks"><span>${lo}</span><span>${(lo + hi) / 2}</span><span>${hi}</span></div>`;
  // 3D overlay uses the same field
  paintMap(vals, lo, hi, cm);
  legend.innerHTML = `${label}<div class="cbar" style="background:${colormapGradient(cm)}"></div><div class="cbar-ticks"><span>${lo}</span><span>${(lo + hi) / 2}</span><span>${hi}</span></div>`;
}
function drawDayChart() {
  const s = state.D.series; const p = params();
  dayPlot.band('band', s.ts, s.lo, s.hi, { color: 'accent', alpha: 0.16, label: 'Range across the crop' });
  dayPlot.line('open', s.ts, s.open, { color: 'amber', width: 2.2, label: 'Open field' });
  dayPlot.line('mean', s.ts, s.mean, { color: 'accent', width: 2.4, label: 'Crop mean under PV' });
  if (probePos) dayPlot.line('probe', s.ts, s.pr, { color: 'magenta', width: 1.8, dash: [5, 4], label: 'Sensor' }); else dayPlot.remove('probe');
  // electricity over the same day (W per m² of land): one hump for tilted rows, two for east–west fences
  const dr = state.dr, pvS = [];
  for (let i = 0; i < dr.n; i++) {
    if (dr.ghi[i] <= 0) { pvS.push(0); continue; }
    const d = toLocal(state.A, ...sunWorld(dr.el[i], dr.az[i]));
    pvS.push(poa(state.A, d, { dni: dr.dni[i], dhi: dr.dhi[i], ta: dr.ta[i] }, state.vf, state.svfMean, PV, p.bif, 1).P * state.A.gcr);
  }
  dayPlot.line('pv', Array.from(dr.t), pvS, { color: 'water', width: 1.8, dash: [2, 3], y2: true, label: 'PV output (right axis)' });
  const ws = deg(sunsetHourAngle(p.L.lat, Math.round(p.day))) / 15;
  if (ws > 0.05 && ws < 11.95) { dayPlot.region('n1', 0, 12 - ws, { color: 'ink', alpha: 0.05 }); dayPlot.region('n2', 12 + ws, 24, { color: 'ink', alpha: 0.05 }); } else { dayPlot.remove('n1'); dayPlot.remove('n2'); }
}
function drawBars(R) {
  const r2 = v => Math.round(v * 100) / 100;
  bars.set(['Crop yield', 'Electricity', 'LER'], [
    { label: 'This design', values: [r2(R.cropRel), r2(R.eRel), r2(R.LER)], color: 'accent' },
    { label: 'Ground-mounted PV', values: [0, 1, 1], color: 'amber' },
    { label: 'Open field', values: [1, 0, 1], color: 'c1' }
  ]);
  bars.refLine(1, 'single use = 1');
}
function drawLerChart() {
  const sw = state.sweep; if (!sw) return; const p = params();
  lerPlot.line('ler', sw.gcr, sw.ler, { color: 'accent', width: 2.6, label: 'LER' });
  lerPlot.line('crop', sw.gcr, sw.crop, { color: 'c0', width: 1.8, dash: [6, 4], label: 'Crop part' });
  lerPlot.line('en', sw.gcr, sw.energy, { color: 'amber', width: 1.8, dash: [2, 3], label: 'Electricity part' });
  lerPlot.hline('one', 1, { color: 'muted', label: 'LER = 1' });
  if (state.sweepCur && state.sweepCur.gcr.length) lerPlot.point('cur', state.sweepCur.gcr[0], state.sweepCur.ler[0], { color: 'magenta', r: 6, label: 'your design', guides: true });
  let best = 0; sw.ler.forEach((v, i) => { if (v > sw.ler[best]) best = i; });
  if (sw.ler.length) lerPlot.point('best', sw.gcr[best], sw.ler[best], { color: 'accent', r: 4, label: `max ${fmt(sw.ler[best], 2)}` });
  // DIN SPEC 91434: the crop must keep at least 66 % of the reference yield
  let gLim = null;
  for (let i = 0; i < sw.gcr.length - 1; i++) if (sw.crop[i] >= 0.66 && sw.crop[i + 1] < 0.66) { gLim = sw.gcr[i] + (0.66 - sw.crop[i]) / (sw.crop[i + 1] - sw.crop[i]) * (sw.gcr[i + 1] - sw.gcr[i]); break; }
  if (p.mode !== 'ground' && sw.crop.length && sw.crop[0] < 0.66) gLim = sw.gcr[0];
  if (p.mode !== 'ground' && gLim != null) lerPlot.region('din', gLim, 0.7, { color: 'danger', alpha: 0.08, label: 'crop < 66 %' }); else lerPlot.remove('din');
  lerPlot.remove('bestv');
}

/* ------------------------------------------------------------------ time of day */
let lastEnvEl = -99, lastEnvT = 0;
function applyTime() {
  const p = params(); if (!state.dr) return;
  const t = p.time; const sun = state.dr.at(t);
  const elD = deg(sun.el), azD = deg(sun.az);
  sky.setSun(elD, azD);
  const beamRel = clamp(sun.dni / 820, 0.04, 1.15), kd = sun.ghi > 0 ? sun.dhi / sun.ghi : 1;
  sky.sun.intensity *= 0.3 + 0.7 * beamRel; sky.hemi.intensity *= 0.95 + 0.7 * kd;
  stage.renderer.toneMappingExposure *= 1.3;
  const u = sky.sky.material.uniforms; u.turbidity.value = p.sky === 'overcast' ? 12 : p.sky === 'clear' ? 2.6 : 3.4 + 4 * clamp(kd - 0.3, 0, 0.6);
  const now = performance.now();
  if (Math.abs(elD - lastEnvEl) > 3 || now - lastEnvT > 5000) { stage.updateEnvironmentFrom(sky.sky); lastEnvEl = elD; lastEnvT = now; }
  // sun marker on the path
  const sw = sunWorld(sun.el, sun.az); sunDisk.position.set(sw[0] * R_ARC, sw[1] * R_ARC, sw[2] * R_ARC); sunDisk.visible = p.path && sun.el > -0.01; sunPath.visible = p.path;
  // instantaneous crop map and PV power
  instantMap(state.A, state.G, sun, state.inst);
  let sm = 0, cnt = 0; for (let k = 0; k < state.inst.length; k++) if (state.G.mask[k]) { sm += state.inst[k]; cnt++; }
  const meanNow = cnt ? sm / cnt : 0, openNow = SUN_PPFD_PER_WM2 * sun.ghi;
  const d = toLocal(state.A, ...sw);
  const P = sun.ghi > 0 ? poa(state.A, d, sun, state.vf, state.svfMean, PV, p.bif, 1) : { P: 0, Gf: 0, Gb: 0 };
  const pLand = P.P * state.A.gcr;
  ro.set('now', pLand, null, `front ${fmt(P.Gf, 0)} · rear ${fmt(P.Gb, 0)} W m⁻² on the modules`);
  if (p.mapm === 'now') drawMapChart();
  hud.set('t', `<b>${dateStr(Math.round(p.day))}</b> · solar time <b>${hhmm(t)}</b> · ${p.L.name.split(',')[0]}`);
  hud.set('s', `Sun el <b>${fmt(elD, 1)}°</b> az <b>${fmt(((azD % 360) + 360) % 360, 0)}°</b>${sun.el > 0 ? ` · diffuse <b>${fmt(kd * 100, 0)}</b> %` : ' · below horizon'}`);
  hud.set('p', `PPFD open <b>${fmt(openNow, 0)}</b> · under PV <b>${fmt(meanNow, 0)}</b> µmol m⁻² s⁻¹`);
  hud.set('e', `PV <b>${fmt(pLand, 0)}</b> W m⁻² of land`);
  dayPlot.vline('now', t, { color: 'ink', dash: [2, 3], label: hhmm(t) });
  if (probePos) {
    const G = state.G; const k = nearestK(probePos.u, probePos.v);
    const svf = skyViewFactor(state.A, probePos.u, G.y, probePos.v);
    const direct = sun.el > 0 ? (blocked(state.A, probePos.u, G.y, probePos.v, d[0], d[1], d[2]) ? state.A.tau : 1) * sun.dni * Math.sin(sun.el) : 0;
    const Inow = SUN_PPFD_PER_WM2 * (direct + sun.dhi * svf);
    probeLabel.element.innerHTML = `Quantum sensor<small>${fmt(Inow, 0)} µmol m⁻² s⁻¹ now · today ${fmt(100 * state.D.dli[k] / Math.max(1e-9, state.D.dliOpen), 0)} % · sky view ${fmt(svf, 2)}</small><small>season yield here ${fmt(100 * state.S.yRel[k], 0)} % of open field</small>`;
  }
}
function nearestK(u, v) { const G = state.G; let i = Math.round((v - G.vs[0]) / (G.vs[1] - G.vs[0])), j = Math.round((u - G.us[0]) / (G.us[1] - G.us[0])); i = clamp(i, 0, G.nv - 1); j = clamp(j, 0, G.nu - 1); return j * G.nv + i; }
function jump(what) {
  const p = params(); const ws = deg(sunsetHourAngle(p.L.lat, Math.round(p.day))) / 15;
  ui.set('time', what === 'noon' ? 12 : ws > 0.05 && ws < 11.95 ? 12 - ws + 0.05 : 0);
}

/* ------------------------------------------------------------------ view & labels */
function applyView() {
  const p = params(); const v = p.view;
  mapMesh.visible = v !== 'crop';
  mapMesh.position.y = v === 'map' ? Math.max(0.05, p.crop.h * 0.6) : 0.035;
  mapMesh.material.opacity = v === 'map' ? 0.95 : 0.9;
  cropGroup.visible = v !== 'map';
  const showL = p.labels; if (rowLabel) rowLabel.visible = showL; if (cropLabel) cropLabel.visible = showL;
  rowLabel && (rowLabel.element.style.display = showL ? '' : 'none');
}
function updateLabels(R) {
  const p = R.p; if (!rowLabel) return;
  rowLabel.element.innerHTML = `${MODE_LABEL[p.mode]}<small>β ${fmt(p.tilt, 0)}° · h ${fmt(p.h, 1)} m · w ${fmt(p.w, 1)} m · pitch ${fmt(p.pitch, 1)} m · GCR ${fmt(state.A.gcr, 2)}</small>`;
}

/* ------------------------------------------------------------------ update loop */
function update() {
  const p = params();
  // keep the geometry consistent with the chosen configuration
  ui.enable('tilt', p.mode !== 'vertical');
  recompute();
  const R = updateReadouts();
  drawMapChart(); drawDayChart(); drawBars(R); updateLabels(R); applyView();
  applyTime();
}
let raf = 0;
ui.onChange((st, id) => {
  if (id === 'mode') {
    const fix = {};
    if (st.mode === 'overhead' && st.h < 2.1) fix.h = 5;
    if (st.mode === 'vertical' && st.h > 1.5) fix.h = 0.6;
    if (st.mode === 'ground' && st.h > 1.5) fix.h = 0.8;
    if (st.mode === 'vertical' && Math.abs(st.az - 180) < 30) fix.az = 90;
    if (st.mode !== 'vertical' && st.tilt > 60) fix.tilt = st.mode === 'ground' ? 30 : 20;
    if (st.mode === 'ground') fix.strip = 0;
    if (Object.keys(fix).length) { Object.entries(fix).forEach(([k, v]) => ui.set(k, v, true)); }
  }
  if (id === 'speed') clock.speed = +st.speed;
  if (id === 'time') { applyTimeSoon(); return; }
  cancelAnimationFrame(raf); raf = requestAnimationFrame(update);
});
let tRaf = 0; function applyTimeSoon() { cancelAnimationFrame(tRaf); tRaf = requestAnimationFrame(applyTime); }

/* ------------------------------------------------------------------ simulation clock: play the day */
const clock = new SimClock({
  speed: 5400,
  onStep: dt => { let t = ui.get('time') + dt / 3600; if (t >= 24) t -= 24; ui.set('time', t, true); },
  onFrame: () => applyTime()
});
clock.onState(run => { playBtns[0].innerHTML = run ? '❚❚ Pause' : '▶ Play the day'; });
stage.onKey('space', () => clock.toggle());
clock.speed = +ui.get('speed');
stage.onFrame((dt, t) => { uWind.value = t; });

update();
setTimeout(() => stage.updateEnvironmentFrom(sky.sky), 400);
window.__agv = { state, params, results };
