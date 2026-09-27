/* Sensory booth — an ISO 8589-style booth row in 3D, driven by
   (1) a serving-order design engine (Williams 1949 squares; the six balanced triangle
       arrangements of ISO 4120:2021; AB/BA for paired preference) with random three-digit codes,
   (2) a spectral colour model: illuminant SPD × product reflectance × CIE 1931 colour-matching
       functions → XYZ → CIELAB → ΔE*ab, which shows when coloured booth light masks a colour cue,
   (3) a session-logistics model (booths, samples, tasting and rinsing times).
   See the Derive tab, Eqs. B1–B6. Designs are exported to localStorage 'ffp-sensory-v1'. */
import { createStage, THREE, M, makeRoom, canvasTexture, RoundedBoxGeometry, ensureRectAreaLights, BufferGeometryUtils } from '/assets/js/lab3d.js';
import { Controls, Readouts, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, BarChart, downloadCSV } from '/assets/js/plot.js';
import { binomCritical } from '/assets/js/stats.js';
import { planck } from '/assets/js/physics.js';
import { buildDesign, balanceStats, oddIndex, loadStudy, saveStudy, prefCritical, panelId, qtukeyFast, STORE_KEY, LETTERS, GOOD_CODES } from './sensory-core.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = m => { if (window.FFP && FFP.toast) FFP.toast(m); };

/* =================================================================== colour model (Eqs. B4–B5) */
const LAMBDA = []; for (let l = 380; l <= 780; l += 5) LAMBDA.push(l);
// CIE 1931 2° colour-matching functions, multi-lobe Gaussian fit of Wyman, Sloan & Shirley (2013)
const gl = (x, mu, s1, s2) => { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };
const CMF = LAMBDA.map(l => [
  1.056 * gl(l, 599.8, 37.9, 31.0) + 0.362 * gl(l, 442.0, 16.0, 26.7) - 0.065 * gl(l, 501.1, 20.4, 26.2),
  0.821 * gl(l, 568.8, 46.9, 40.5) + 0.286 * gl(l, 530.9, 16.3, 31.1),
  1.217 * gl(l, 437.0, 11.8, 36.0) + 0.681 * gl(l, 459.0, 26.0, 13.8)]);
const LIGHTS = {
  white: { label: 'White 6500 K', short: 'White 6500 K', spd: LAMBDA.map(l => planck(l, 6500)), hex: 0xf2f4ff },
  red: { label: 'Red LED 630 nm', short: 'Red 630 nm', spd: LAMBDA.map(l => Math.exp(-0.5 * ((l - 630) / 8.5) ** 2)), hex: 0xff2211 },
  green: { label: 'Green LED 525 nm', short: 'Green 525 nm', spd: LAMBDA.map(l => Math.exp(-0.5 * ((l - 525) / 14.9) ** 2)), hex: 0x22ff55 }
};
/** Illustrative diffuse reflectance of a bread crumb; b = browning 0 (wheat) … 1 (dark cricket/wholemeal crumb). */
function reflectance(b) {
  const Rb = 0.25 - 0.19 * b, Rt = 0.80 - 0.28 * b, l0 = 500 + 90 * b, w = 40 + 8 * b;
  return LAMBDA.map(l => Rb + (Rt - Rb) / (1 + Math.exp(-(l - l0) / w)));
}
function toXYZ(spd, R) { // Eq. B4, normalised so that a perfect white under the same light has Y = 100
  let X = 0, Y = 0, Z = 0, Yw = 0;
  for (let i = 0; i < LAMBDA.length; i++) { const s = spd[i], r = R ? R[i] : 1; X += s * r * CMF[i][0]; Y += s * r * CMF[i][1]; Z += s * r * CMF[i][2]; Yw += s * CMF[i][1]; }
  return [100 * X / Yw, 100 * Y / Yw, 100 * Z / Yw];
}
function toLab(P, W) { // Eq. B5 (CIE 15:2004)
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const fx = f(P[0] / W[0]), fy = f(P[1] / W[1]), fz = f(P[2] / W[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const xyzToLin = P => { const [X, Y, Z] = P.map(v => v / 100); return [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.2040 * Y + 1.0570 * Z]; };
const gam = v => { v = Math.max(0, Math.min(1, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };
const WHITE_LIN = xyzToLin(toXYZ(LIGHTS.white.spd, null));
/** Linear-sRGB albedo of a reflectance spectrum (object colour under the 6500 K light, white-balanced). */
function albedo(R) { const lin = xyzToLin(toXYZ(LIGHTS.white.spd, R)); return lin.map((v, i) => Math.max(0, v / WHITE_LIN[i])); }
/** CSS colour of a surface as it appears under a light (not colour-adapted: red light looks red). */
function appearanceCSS(R, light) {
  const spd = LIGHTS[light].spd, w = xyzToLin(toXYZ(spd, null)), m = Math.max(...w);
  const lin = xyzToLin(toXYZ(spd, R)).map(v => v / m);
  return `rgb(${lin.map(v => Math.round(255 * gam(v))).join(',')})`;
}
function colourModel(p, nProd) {
  const browning = Array.from({ length: nProd }, (_, j) => nProd > 1 ? p.brown * j / (nProd - 1) : 0);
  const refl = browning.map(reflectance);
  const res = {};
  Object.keys(LIGHTS).forEach(k => {
    const spd = LIGHTS[k].spd, W = toXYZ(spd, null);
    const labs = refl.map(R => toLab(toXYZ(spd, R), W));
    res[k] = { labs, dE: labs.map(L => dE(L, labs[0])) };
  });
  return { browning, refl, res, albedo: refl.map(albedo) };
}

/* =================================================================== state & controls */
const DEFAULT_NAMES = ['Wheat bread 0 %', 'Cricket bread 5 %', 'Cricket bread 10 %', 'Cricket bread 15 %', 'Cricket bread 20 %', 'Cricket bread 25 %'];
let names = DEFAULT_NAMES.slice();
let design = null, designKey = '', external = null, k = 1;
let study = loadStudy();

const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ui.section('Panellist');
const nav = ui.html(`<div class="pnav"><button type="button" class="btn btn-sm" id="k-prev" aria-label="Previous panellist">◀</button><div class="pnav-id"><b id="k-id">P01</b><small id="k-sub">booth 1 · round 1</small></div><button type="button" class="btn btn-sm" id="k-next" aria-label="Next panellist">▶</button></div>`);
ui.section('Test design');
ui.segmented({ id: 'test', label: 'Method', options: [{ value: 'triangle', label: 'Triangle' }, { value: 'hedonic', label: '9-pt hedonic' }, { value: 'preference', label: 'Preference' }], value: 'triangle' });
ui.slider({ id: 't', label: 'Products (hedonic test)', min: 2, max: 6, step: 1, value: 3, help: 'Williams design: t sequences for even t, 2t for odd t.' });
ui.slider({ id: 'n', label: 'Panellists', min: 6, max: 72, step: 1, value: 24, help: 'ISO 4120: 24–30 for a difference test; about 60 for similarity.' });
ui.toggle({ id: 'uniq', label: 'Fresh codes for every panellist', value: true, help: 'ISO 4120:2021, 5.5: random three-digit codes, preferably different for every assessor.' });
ui.number({ id: 'seed', label: 'Randomisation seed', min: 1, max: 99999, step: 1, value: 2026, help: 'The same seed reproduces the same plan — write it in your protocol.' });
ui.html(`<div class="ctl"><div class="ctl-lab"><span>Product names</span></div><div class="pnames" id="pnames">${DEFAULT_NAMES.map((d, i) => `<label class="pn" data-i="${i}"><b>${LETTERS[i]}</b><input type="text" data-i="${i}" value="${esc(d)}" aria-label="Name of product ${LETTERS[i]}"></label>`).join('')}</div></div>`);
ui.buttons([{ label: 'New randomisation', onClick: () => ui.set('seed', 1 + Math.floor(Math.random() * 99998)) }]);
ui.section('Booth and light');
ui.segmented({ id: 'light', label: 'Booth lighting', options: [{ value: 'white', label: 'White' }, { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' }], value: 'white', help: 'Coloured light masks hue differences in discrimination tests.' });
ui.slider({ id: 'brown', label: 'Colour difference of the test products', min: 0, max: 1, step: 0.01, value: 0.3, help: 'Browning of the crumb, 0 = like the control, 1 = dark brown (illustrative spectra). Drives the cups, the spectra and ΔE*ab.' });
ui.slider({ id: 'booths', label: 'Booths in the row', min: 1, max: 5, step: 1, value: 4 });
ui.slider({ id: 'W', label: 'Booth working width', min: 0.6, max: 1.2, step: 0.05, value: 0.9, unit: 'm', help: 'ISO 8589: at least 0.9 m.' });
ui.slider({ id: 'D', label: 'Counter depth', min: 0.45, max: 0.8, step: 0.05, value: 0.6, unit: 'm', help: 'ISO 8589: at least 0.6 m.' });
ui.toggle({ id: 'dims', label: 'Show ISO 8589 dimensions', value: false });
ui.section('Session timing');
ui.slider({ id: 'tS', label: 'Time per sample (taste + answer)', min: 0.5, max: 5, step: 0.25, value: 1.5, unit: 'min' });
ui.slider({ id: 'tR', label: 'Palate-cleansing pause', min: 0, max: 3, step: 0.25, value: 1, unit: 'min', help: 'Water and an unsalted cracker between samples.' });
ui.presets([
  { label: 'Triangle · 24 · red light', values: { test: 'triangle', n: 24, light: 'red', brown: 0.12, booths: 4, W: 0.9, D: 0.6 } },
  { label: 'Hedonic · 3 breads · 24', values: { test: 'hedonic', t: 3, n: 24, light: 'white', brown: 0.5, booths: 4, W: 0.9, D: 0.6 } },
  { label: 'Hedonic · 4 breads · 32', values: { test: 'hedonic', t: 4, n: 32, light: 'white', brown: 0.75, booths: 4, W: 0.9, D: 0.6 } },
  { label: 'Preference · 30', values: { test: 'preference', n: 30, light: 'white', brown: 0.3, booths: 3, W: 0.9, D: 0.6 } },
  { label: 'Cramped classroom', values: { test: 'triangle', n: 20, light: 'white', booths: 5, W: 0.65, D: 0.5 } }
]);
ui.section('Outputs');
ui.buttons([{ label: 'Print ballots', onClick: () => doPrint('ballots') }, { label: 'Print serving sheet', onClick: () => doPrint('sheet') }]);
ui.buttons([{ label: 'Download CSV', onClick: downloadPlan }, { label: 'Save to project', variant: 'primary', onClick: exportStudy, title: `Store the design in this browser (${STORE_KEY}) for the triangle, hedonic and sensory-designer tools` }]);
ui.buttons([{ label: 'Load saved design', onClick: loadSaved, title: 'Open the design stored in this browser' }]);
ui.saveButton('sensory-booth', () => ro.values());

ro.add({ id: 'design', label: 'Serving-order design', format: v => v })
  .add({ id: 'seq', label: 'Use of each sequence', format: v => v })
  .add({ id: 'pos', label: 'Position balance (max − min)', digits: 0 })
  .add({ id: 'carry', label: 'Carry-over balance (max − min)', format: v => v })
  .add({ id: 'crit', label: 'Decision rule', format: v => v })
  .add({ id: 'de', label: 'Colour cue ΔE*ab (this light)', digits: 1 })
  .add({ id: 'width', label: 'Booth width / depth', format: v => v })
  .add({ id: 'session', label: 'Session length', format: v => v })
  .add({ id: 'resp', label: 'Responses recorded', format: v => v });

/* product-name inputs */
$('pnames').addEventListener('input', e => { const i = +e.target.dataset.i; if (!isNaN(i)) { names[i] = e.target.value; refreshNames(); } });
function refreshNames() {
  if (!design) return;
  design.samples.forEach((s, i) => s.label = (names[i] || '').trim() || `Product ${s.code}`);
  renderSheet(); renderBallot(); updateCharts(); drawAllTablets(); updateHud();
}
function nProducts(p) { return p.test === 'hedonic' ? p.t : 2; }

/* =================================================================== 3D scene */
const stage = createStage('#stage', {
  background: '#0c0f0e', envIntensity: 0.3, exposure: 1.05,
  camera: { pos: [-0.12, 1.88, 2.85], target: [-0.95, 0.9, 0.3], fov: 42 },
  controls: { minDistance: 0.3, maxDistance: 4.4, maxPolarAngle: Math.PI * 0.6 },
  bloom: { strength: 0.32, radius: 0.4, threshold: 1.0 }, ao: { radius: 0.1, intensity: 0.9 },
  hint: 'Drag to orbit · click a cup, tablet or hatch · space = next panellist'
});
ensureRectAreaLights();
const { scene } = stage;
const hud = hudChips(stage.el);
const CH = 0.76, SOFFIT = 2.05, EXT = 0.32, WALL = 0.1, ROOM_H = 2.7;

/* textures */
const laminateTex = canvasTexture(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#dcdcd8'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 5000; i++) { const v = 200 + Math.random() * 40; ctx.fillStyle = `rgba(${v},${v},${v - 4},0.35)`; ctx.fillRect(Math.random() * w, Math.random() * h, 1.2, 1.2); }
}, { key: 'sb-laminate', repeat: [3, 3] });
const tileTex = canvasTexture(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#f3f2ee'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#c9c7c0'; ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * w / 4, 0); ctx.lineTo(i * w / 4, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * h / 4); ctx.lineTo(w, i * h / 4); ctx.stroke(); }
}, { key: 'sb-tile', repeat: [1, 1] });
const crumbTex = canvasTexture(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#f4f1ea'; ctx.fillRect(0, 0, w, h);
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) { const x = r() * w, y = r() * h, rx = 1 + r() * 4.5, ry = rx * (0.5 + r() * 0.7); ctx.fillStyle = `rgba(95,80,60,${0.18 + r() * 0.3})`; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, r() * 3, 0, Math.PI * 2); ctx.fill(); }
  for (let i = 0; i < 1400; i++) { ctx.fillStyle = `rgba(255,255,250,${0.2 + r() * 0.3})`; ctx.fillRect(r() * w, r() * h, 1.5, 1.5); }
}, { key: 'sb-crumb' });
const crackerTex = canvasTexture(128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#e2c287'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 600; i++) { ctx.fillStyle = `rgba(150,100,40,${Math.random() * 0.25})`; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  ctx.fillStyle = 'rgba(120,80,30,0.7)'; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { ctx.beginPath(); ctx.arc(20 + i * 29, 20 + j * 29, 3, 0, Math.PI * 2); ctx.fill(); }
}, { key: 'sb-cracker' });

const paintTex = canvasTexture(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#e4e4e2'; ctx.fillRect(0, 0, w, h);
  let s = 3; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 9000; i++) { const v = 205 + r() * 50; ctx.fillStyle = `rgba(${v},${v},${v},0.22)`; ctx.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5); }
}, { key: 'sb-paint', repeat: [2, 2] });
/* materials (shared; geometry is rebuilt, materials are reused) */
const MAT = {
  booth: new THREE.MeshStandardMaterial({ color: 0x747674, roughness: 0.92, map: paintTex }),   // matt grey ≈ N5, luminance factor ≈ 15–20 %
  boothWall: new THREE.MeshStandardMaterial({ color: 0x7b7d7b, roughness: 0.93, map: paintTex }),
  prepWall: new THREE.MeshStandardMaterial({ color: 0xf1f0ec, roughness: 0.6, map: tileTex }),
  counter: new THREE.MeshStandardMaterial({ color: 0x8c8e8c, roughness: 0.58, map: laminateTex }),
  edge: new THREE.MeshStandardMaterial({ color: 0x2a2c2d, roughness: 0.5 }),
  soffit: new THREE.MeshStandardMaterial({ color: 0xe9e8e3, roughness: 0.85 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xc3c7cb, metalness: 1, roughness: 0.28 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xe6e9ec, metalness: 1, roughness: 0.12 }),
  alu: M.aluminium(),
  white: new THREE.MeshStandardMaterial({ color: 0xf4f4f1, roughness: 0.55 }),
  grille: new THREE.MeshStandardMaterial({ color: 0xe7e7e2, roughness: 0.5, metalness: 0.2 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x151719, roughness: 0.55 }),
  fabric: new THREE.MeshStandardMaterial({ color: 0x2f3a45, roughness: 0.95 }),
  tray: new THREE.MeshPhysicalMaterial({ color: 0xf6f6f3, roughness: 0.38, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
  cup: new THREE.MeshPhysicalMaterial({ color: 0xfbfbf7, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.2, side: THREE.DoubleSide }),
  paper: new THREE.MeshStandardMaterial({ color: 0xf7f6f1, roughness: 0.95, side: THREE.DoubleSide }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xeef6f8, roughness: 0.04, transparent: true, opacity: 0.22, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.04, side: THREE.DoubleSide }),
  water: M.waterCheap(0xcfe8f0, 0.32),
  cracker: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, map: crackerTex }),
  wood: new THREE.MeshStandardMaterial({ color: 0xb58a58, roughness: 0.7 }),
  hatch: new THREE.MeshStandardMaterial({ color: 0xc9cdd1, metalness: 0.55, roughness: 0.42 }),
  led: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x39ff7a, emissiveIntensity: 0, roughness: 0.3 }),
  ledOff: new THREE.MeshStandardMaterial({ color: 0x1b3322, emissive: 0x000000, roughness: 0.3 })
};
const crumbMats = Array.from({ length: 6 }, () => new THREE.MeshStandardMaterial({ color: 0xf0e2c0, roughness: 0.93, map: crumbTex }));
const panelMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: LIGHTS.white.hex, emissiveIntensity: 1.1, roughness: 0.4 });

const staticGroup = new THREE.Group(), boothGroup = new THREE.Group(), trayGroup = new THREE.Group(), dimGroup = new THREE.Group();
scene.add(staticGroup, boothGroup, trayGroup, dimGroup);
function clearGroup(g) { g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); [...g.children].forEach(c => { c.traverse(o => { if (o.isCSS2DObject) o.removeFromParent(); }); g.remove(c); }); }
const shadow = o => { o.traverse(m => { if (m.isMesh && !m.material.transparent) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };

/* lights */
const hemi = new THREE.HemisphereLight(0xf0f2ff, 0x404240, 0.28); scene.add(hemi);
// a soft spot under the soffit of the active booth gives the contact shadows of cups and glasses
const keyLight = new THREE.SpotLight(0xffffff, 3.0, 3.2, Math.PI / 3.1, 0.95, 2); keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024); keyLight.shadow.bias = -0.0005; keyLight.shadow.normalBias = 0.015; keyLight.shadow.radius = 6; keyLight.shadow.camera.near = 0.2; keyLight.shadow.camera.far = 3;
keyLight.position.set(0, SOFFIT - 0.06, 0.38); keyLight.target.position.set(0, CH, 0.34); scene.add(keyLight, keyLight.target);
const roomLights = [], prepLights = [], boothLights = [];
function rectLight(color, intensity, w, h, x, y, z) { const L = new THREE.RectAreaLight(color, intensity, w, h); L.position.set(x, y, z); L.rotation.x = -Math.PI / 2; scene.add(L); return L; }
roomLights.push(rectLight(0xffffff, 4.2, 1.2, 0.3, -1.1, ROOM_H - 0.01, 2.2), rectLight(0xffffff, 4.2, 1.2, 0.3, 1.1, ROOM_H - 0.01, 2.2));
prepLights.push(rectLight(0xfff6ea, 6, 1.4, 0.35, 0, ROOM_H - 0.01, -1.4));

/* ---------- builders */
function roundedRectShape(w, h, r) { const s = new THREE.Shape(), x = -w / 2, y = -h / 2; s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s; }
function labelTexture(text, { w = 256, h = 104, bg = '#ffffff', fg = '#111', font = '700 64px "JetBrains Mono", monospace', border = '#d4d4cf' } = {}) {
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = border; ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w / 2, h / 2 + 3);
  });
}
function signTexture(lines, { w = 512, h = 160, bg = '#26292b', fg = '#f2f2ee' } = {}) {
  return canvasTexture(w, h, ctx => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => { ctx.font = l.font || '600 40px Inter, sans-serif'; ctx.fillText(l.t, w / 2, h * (i + 0.5) / lines.length + 2); });
  });
}

let geomKey = '', hatches = [], leds = [], tablets = [], booths = [];
function buildStatic(p) {
  clearGroup(staticGroup); clearGroup(boothGroup); hatches = []; leds = []; tablets = []; booths = [];
  const B = p.booths, W = p.W, D = p.D, rowW = B * W, RW = Math.max(5.6, rowW + 2.4);
  const room = makeRoom({ w: RW, d: 6.4, h: ROOM_H, wallColor: 0xdad9d4, floor: 'epoxy' });
  room.position.z = 0.8; room.floor.material.color.set(0xa9adad); room.walls.material.roughness = 0.95;
  staticGroup.add(room);
  // dividing wall with pass-through hatches (testing side matt grey, preparation side tiled)
  const hw = Math.min(0.52, W - 0.22);                       // hatch width adapts to narrow booths
  const hx = i => -rowW / 2 + i * W + 0.1 + hw / 2;
  const holes = []; for (let i = 0; i < B; i++) holes.push({ x0: hx(i) - hw / 2, x1: hx(i) + hw / 2, y0: CH + 0.01, y1: CH + 0.39 });
  const wallShape = () => { const s = new THREE.Shape(); s.moveTo(-RW / 2, 0); s.lineTo(RW / 2, 0); s.lineTo(RW / 2, ROOM_H); s.lineTo(-RW / 2, ROOM_H); s.lineTo(-RW / 2, 0); holes.forEach(h => { const q = new THREE.Path(); q.moveTo(h.x0, h.y0); q.lineTo(h.x0, h.y1); q.lineTo(h.x1, h.y1); q.lineTo(h.x1, h.y0); q.lineTo(h.x0, h.y0); s.holes.push(q); }); return s; };
  const wT = new THREE.Mesh(new THREE.ExtrudeGeometry(wallShape(), { depth: WALL / 2, bevelEnabled: false }), MAT.boothWall); wT.position.z = -WALL / 2; staticGroup.add(wT);
  const tg = new THREE.ExtrudeGeometry(wallShape(), { depth: WALL / 2, bevelEnabled: false });
  const wP = new THREE.Mesh(tg, MAT.prepWall); wP.position.z = -WALL; staticGroup.add(wP);
  MAT.prepWall.map.repeat.set(3.3, 3.3);
  // soffit over the booth row with a fascia carrying booth numbers
  const sof = mesh(new THREE.BoxGeometry(rowW + 0.06, ROOM_H - SOFFIT, D + EXT + 0.02), MAT.soffit, 0, (SOFFIT + ROOM_H) / 2, (D + EXT) / 2 + 0.01); staticGroup.add(sof);
  // pass-through shelf and prep counter on the preparation side
  const shelf = mesh(new THREE.BoxGeometry(rowW + 0.2, 0.03, 0.36), new THREE.MeshStandardMaterial({ color: 0xaeb3b7, metalness: 0.55, roughness: 0.55 }), 0, CH - 0.015, -WALL - 0.18); staticGroup.add(shelf);
  const prep = new THREE.Group(); prep.position.set(0, 0, -2.05); staticGroup.add(prep);
  prep.add(mesh(new THREE.BoxGeometry(Math.min(RW - 0.6, 4.4), 0.86, 0.62), MAT.white, 0, 0.43, 0));
  prep.add(mesh(new THREE.BoxGeometry(Math.min(RW - 0.6, 4.4) + 0.02, 0.04, 0.66), MAT.steel, 0, 0.88, 0));
  const cab = new THREE.Group(); cab.position.set(-1.35, 0.9, -0.02); prep.add(cab); // warming cabinet
  cab.add(mesh(new RoundedBoxGeometry(0.62, 0.5, 0.5, 3, 0.015), MAT.steel, 0, 0.25, 0));
  cab.add(mesh(new THREE.PlaneGeometry(0.48, 0.34), new THREE.MeshStandardMaterial({ color: 0x271a10, emissive: 0xffa040, emissiveIntensity: 0.55, roughness: 0.2 }), -0.03, 0.26, 0.2505));
  cab.add(mesh(new THREE.BoxGeometry(0.03, 0.3, 0.03), MAT.dark, 0.24, 0.26, 0.27));
  const board = mesh(new RoundedBoxGeometry(0.46, 0.025, 0.3, 2, 0.008), MAT.wood, 0.05, 0.915, 0.02); prep.add(board);
  const loafGeo = new RoundedBoxGeometry(0.24, 0.1, 0.11, 4, 0.035);
  prepLoaves = [mesh(loafGeo, crumbMats[0], -0.04, 0.978, 0.0), mesh(loafGeo, crumbMats[1], 0.16, 0.978, 0.05)];
  prepLoaves[1].rotation.y = 0.35; prepLoaves.forEach(l => prep.add(l));
  for (let i = 0; i < 6; i++) prep.add(mesh(new THREE.CylinderGeometry(0.031, 0.024, 0.036 + i * 0.006, 24, 1, true), MAT.cup, 0.55, 0.92 + (0.036 + i * 0.006) / 2, 0.08));
  const sheet = mesh(new THREE.PlaneGeometry(0.21, 0.297), MAT.paper, 0.9, 0.903, 0.05); sheet.rotation.x = -Math.PI / 2; sheet.rotation.z = 0.2; prep.add(sheet);
  sheetMesh = sheet;
  const sinkP = mesh(new THREE.BoxGeometry(0.45, 0.02, 0.36), MAT.dark, 1.5, 0.901, 0.02); prep.add(sinkP);
  prep.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 12), MAT.chrome, 1.5, 1.05, -0.2));
  // assessor entrance on the testing side, with a sign
  const door = new THREE.Group(); door.position.set(RW / 2 - 0.005, 0, 2.7); door.rotation.y = -Math.PI / 2; staticGroup.add(door);
  door.add(mesh(new THREE.BoxGeometry(0.95, 2.1, 0.04), MAT.alu, 0, 1.05, 0));
  door.add(mesh(new THREE.BoxGeometry(0.86, 2.02, 0.05), new THREE.MeshStandardMaterial({ color: 0xcfc9bd, roughness: 0.6 }), 0, 1.02, 0.005));
  door.add(mesh(new THREE.BoxGeometry(0.14, 0.02, 0.03), MAT.chrome, -0.32, 1.02, 0.045));
  const signMat = new THREE.MeshBasicMaterial({ map: signTexture([{ t: 'SENSORY TESTING', font: '700 44px Inter, sans-serif' }, { t: 'quiet please · no phones · no perfume', font: '500 30px Inter, sans-serif' }]) });
  door.add(mesh(new THREE.PlaneGeometry(0.5, 0.156), signMat, 0, 1.62, 0.035));
  // booths
  const x0 = -rowW / 2;
  for (let i = 0; i < B; i++) {
    const g = new THREE.Group(); g.position.x = x0 + (i + 0.5) * W; boothGroup.add(g);
    const b = { g, i, x: g.position.x, hatchX: hx(i) - g.position.x };
    // counter with a real hole for the rinsing sink
    const sinkX = W / 2 - 0.15, sinkZ = 0.16, sinkR = Math.min(0.085, W / 2 - 0.2 > 0.05 ? 0.085 : 0.06);
    const cs = new THREE.Shape(); const cw = W - 0.03;
    cs.moveTo(-cw / 2, 0); cs.lineTo(cw / 2, 0); cs.lineTo(cw / 2, D); cs.lineTo(-cw / 2, D); cs.lineTo(-cw / 2, 0);
    const hole = new THREE.Path(); hole.absarc(sinkX, sinkZ, sinkR, 0, Math.PI * 2, true); cs.holes.push(hole);
    const cg = new THREE.ExtrudeGeometry(cs, { depth: 0.03, bevelEnabled: false, curveSegments: 40 }); cg.rotateX(Math.PI / 2);
    const counter = mesh(cg, MAT.counter, 0, CH, 0); g.add(counter);
    g.add(mesh(new RoundedBoxGeometry(cw, 0.036, 0.016, 2, 0.006), MAT.edge, 0, CH - 0.017, D));
    g.add(mesh(new THREE.BoxGeometry(cw, CH - 0.03, 0.02), MAT.booth, 0, (CH - 0.03) / 2, 0.012));
    // sink bowl, rim, drain and gooseneck tap
    const prof = []; for (let j = 0; j <= 12; j++) { const a = j / 12 * Math.PI / 2; prof.push(new THREE.Vector2(Math.max(0.018, sinkR * Math.cos(a)), -0.085 * Math.sin(a))); }
    prof.reverse();
    const bowl = mesh(new THREE.LatheGeometry(prof, 40), new THREE.MeshStandardMaterial({ color: 0xc3c7cb, metalness: 1, roughness: 0.3, side: THREE.DoubleSide }), sinkX, CH, sinkZ); g.add(bowl);
    const rim = mesh(new THREE.TorusGeometry(sinkR + 0.004, 0.004, 8, 48), MAT.steel, sinkX, CH + 0.001, sinkZ); rim.rotation.x = Math.PI / 2; g.add(rim);
    const drain = mesh(new THREE.CircleGeometry(0.017, 24), MAT.dark, sinkX, CH - 0.084, sinkZ); drain.rotation.x = -Math.PI / 2; g.add(drain);
    const tap = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(sinkX, CH, 0.035), new THREE.Vector3(sinkX, CH + 0.2, 0.035), new THREE.Vector3(sinkX, CH + 0.265, 0.075), new THREE.Vector3(sinkX, CH + 0.235, 0.13), new THREE.Vector3(sinkX, CH + 0.18, sinkZ + 0.005)]), 40, 0.008, 12), MAT.chrome); g.add(tap);
    g.add(mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.025, 20), MAT.chrome, sinkX, CH + 0.012, 0.035));
    const lever = mesh(new THREE.BoxGeometry(0.008, 0.008, 0.07), MAT.chrome, sinkX + 0.022, CH + 0.11, 0.06); lever.rotation.x = -0.4; g.add(lever);
    // hatch frame and sliding door
    const hxL = b.hatchX;
    [[hw + 0.04, 0.025, hxL, CH + 0.4], [hw + 0.04, 0.025, hxL, CH + 0.0]].forEach(([w, h, x, y]) => g.add(mesh(new THREE.BoxGeometry(w, h, 0.018), MAT.alu, x, y, 0.009)));
    [[-(hw / 2 + 0.01)], [hw / 2 + 0.01]].forEach(([dx]) => g.add(mesh(new THREE.BoxGeometry(0.025, 0.4, 0.018), MAT.alu, hxL + dx, CH + 0.2, 0.009)));
    const hdoor = mesh(new THREE.BoxGeometry(hw, 0.38, 0.012), MAT.hatch, hxL, CH + 0.2, -WALL / 2);
    hdoor.add(mesh(new THREE.BoxGeometry(0.12, 0.018, 0.02), MAT.dark, 0, -0.14, -0.016)); // pull handle on the preparation side
    hdoor.userData = { kind: 'hatch', booth: i, closedY: CH + 0.2, open: 0, target: 0 }; g.add(hdoor); hatches.push(hdoor);
    // signal box: "ready" push button with LED
    const sig = new THREE.Group(); sig.position.set(W / 2 - 0.16, CH + 0.45, 0.012); g.add(sig);
    sig.add(mesh(new RoundedBoxGeometry(0.085, 0.12, 0.024, 2, 0.006), MAT.white));
    const btn = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 24), new THREE.MeshStandardMaterial({ color: 0x2c6fd6, roughness: 0.35 }), 0, -0.02, 0.016); btn.rotation.x = Math.PI / 2; sig.add(btn);
    const led = mesh(new THREE.SphereGeometry(0.007, 16, 10), MAT.ledOff, 0, 0.035, 0.014); sig.add(led); leds.push(led);
    const sl = mesh(new THREE.PlaneGeometry(0.075, 0.026), new THREE.MeshBasicMaterial({ map: signTexture([{ t: 'READY', font: '700 60px Inter, sans-serif' }], { w: 256, h: 90, bg: '#f4f4f1', fg: '#333' }) }), 0, 0.012, 0.0125); sig.add(sl);
    // laminated instruction card and a coat hook
    const card = mesh(new THREE.PlaneGeometry(0.15, 0.105), new THREE.MeshStandardMaterial({ roughness: 0.45, map: signTexture([{ t: 'In this booth', font: '700 34px Inter, sans-serif' }, { t: 'no talking · no phones', font: '500 26px Inter, sans-serif' }, { t: 'rinse between samples', font: '500 26px Inter, sans-serif' }, { t: 'press READY when done', font: '500 26px Inter, sans-serif' }], { w: 360, h: 252, bg: '#f7f6f1', fg: '#2b2e30' }) }), W / 2 - 0.16, CH + 0.66, 0.004); g.add(card);
    const hook = new THREE.Group(); hook.position.set(-W / 2 + 0.017, 1.42, D * 0.55); g.add(hook);
    hook.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 16).rotateZ(Math.PI / 2), MAT.chrome, 0.004, 0, 0));
    hook.add(mesh(new THREE.TorusGeometry(0.018, 0.0035, 8, 20, Math.PI).rotateY(Math.PI / 2), MAT.chrome, 0.02, -0.015, 0));
    // ventilation grille above the hatch (merged slats)
    const slats = []; for (let j = 0; j < 8; j++) { const s = new THREE.BoxGeometry(0.34, 0.006, 0.014); s.rotateX(0.5); s.translate(0, -0.05 + j * 0.0143, 0.008); slats.push(s); }
    const fr = [new THREE.BoxGeometry(0.38, 0.012, 0.02).translate(0, 0.066, 0.01), new THREE.BoxGeometry(0.38, 0.012, 0.02).translate(0, -0.066, 0.01), new THREE.BoxGeometry(0.012, 0.14, 0.02).translate(0.184, 0, 0.01), new THREE.BoxGeometry(0.012, 0.14, 0.02).translate(-0.184, 0, 0.01)];
    const grille = mesh(BufferGeometryUtils.mergeGeometries([...slats, ...fr]), MAT.grille, hxL, 1.62, 0); g.add(grille);
    g.add(mesh(new THREE.PlaneGeometry(0.36, 0.12), MAT.dark, hxL, 1.62, 0.001));
    // light panel under the soffit, number sign on the fascia
    const pnl = mesh(new THREE.PlaneGeometry(W - 0.2, 0.34), panelMat, 0, SOFFIT - 0.003, 0.3); pnl.rotation.x = Math.PI / 2; g.add(pnl);
    const num = mesh(new THREE.PlaneGeometry(0.22, 0.13), new THREE.MeshBasicMaterial({ map: signTexture([{ t: `BOOTH ${i + 1}`, font: '700 56px Inter, sans-serif' }], { w: 320, h: 190, bg: '#2a2d2f', fg: '#f4f4f0' }) }), 0, (SOFFIT + ROOM_H) / 2 - 0.06, D + EXT + 0.021); g.add(num);
    const L = new THREE.RectAreaLight(0xffffff, 6, W - 0.2, 0.34); L.position.set(0, SOFFIT - 0.01, 0.3); L.rotation.x = -Math.PI / 2; g.add(L); b.light = L;
    // chair
    const chair = new THREE.Group(); chair.position.set(0.02, 0, D + 0.42); chair.rotation.y = i % 2 ? 0.12 : -0.08; g.add(chair);
    chair.add(mesh(new RoundedBoxGeometry(0.44, 0.06, 0.42, 3, 0.02), MAT.fabric, 0, 0.47, 0));
    chair.add(mesh(new RoundedBoxGeometry(0.42, 0.34, 0.05, 3, 0.02), MAT.fabric, 0, 0.78, 0.2));
    chair.add(mesh(new THREE.BoxGeometry(0.03, 0.28, 0.02), MAT.dark, 0, 0.6, 0.2));
    chair.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 16), MAT.chrome, 0, 0.27, 0));
    for (let j = 0; j < 5; j++) { const a = j / 5 * Math.PI * 2; const leg = mesh(new THREE.BoxGeometry(0.3, 0.025, 0.035), MAT.dark, Math.cos(a) * 0.14, 0.07, Math.sin(a) * 0.14); leg.rotation.y = -a; chair.add(leg); const w = mesh(new THREE.SphereGeometry(0.025, 12, 8), MAT.dark, Math.cos(a) * 0.28, 0.025, Math.sin(a) * 0.28); chair.add(w); }
    // tablet on a stand (ballot)
    const tab = new THREE.Group(); tab.position.set(W / 2 - 0.19, CH, 0.44); tab.rotation.y = -0.18; g.add(tab);
    const stand = mesh(new THREE.BoxGeometry(0.12, 0.012, 0.09), MAT.dark, 0, 0.006, 0); tab.add(stand);
    const body = new THREE.Group(); body.position.set(0, 0.07, -0.01); body.rotation.x = -1.05; tab.add(body);
    body.add(mesh(new RoundedBoxGeometry(0.25, 0.175, 0.01, 3, 0.008), MAT.dark));
    const scv = document.createElement('canvas'); scv.width = 640; scv.height = 436;
    const screenTex = new THREE.CanvasTexture(scv); screenTex.colorSpace = THREE.SRGBColorSpace; screenTex.anisotropy = 4;
    const screen = mesh(new THREE.PlaneGeometry(0.232, 0.158), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }), 0, 0, 0.0052);
    screen.userData = { kind: 'tablet', booth: i }; body.add(screen);
    b.tablet = { screen, tex: screenTex }; tablets.push(b.tablet);
    booths.push(b);
    shadow(g);
  }
  // side partitions (B + 1): matt grey, extending EXT beyond the counter
  for (let i = 0; i <= B; i++) {
    const part = mesh(new RoundedBoxGeometry(0.03, SOFFIT, D + EXT, 2, 0.01), MAT.booth, x0 + i * W, SOFFIT / 2, (D + EXT) / 2);
    boothGroup.add(part);
  }
  shadow(staticGroup); shadow(boothGroup);
  wP.castShadow = false; wT.castShadow = false; sof.castShadow = false;
  room.traverse(o => { o.castShadow = false; });           // the inward-facing room shell must not block the lights
}
let prepLoaves = [], sheetMesh = null;

/* ---------- trays */
const cupGeo = new THREE.CylinderGeometry(0.031, 0.024, 0.036, 32, 1, true);
const cupBase = new THREE.CircleGeometry(0.024, 32); cupBase.rotateX(-Math.PI / 2);
const cupRim = new THREE.TorusGeometry(0.031, 0.0015, 6, 36); cupRim.rotateX(Math.PI / 2);
const cubeGeo = new RoundedBoxGeometry(0.03, 0.028, 0.03, 2, 0.004);
const labelGeo = new THREE.CylinderGeometry(0.0293, 0.0265, 0.014, 14, 1, true, -0.62, 1.24); // sticker follows the conical cup wall
const codeTexCache = new Map();
const codeMat = code => { if (!codeTexCache.has(code)) codeTexCache.set(code, new THREE.MeshStandardMaterial({ map: labelTexture(String(code)), roughness: 0.6 })); return codeTexCache.get(code); };
function makeTray(order, codes, products, W) {
  const g = new THREE.Group();
  const TW = Math.min(0.42, W - 0.36), TD = 0.29;
  const outer = roundedRectShape(TW, TD, 0.03), inner = roundedRectShape(TW - 0.02, TD - 0.02, 0.022);
  const ring = outer.clone(); ring.holes.push(new THREE.Path(inner.getPoints(24).reverse()));
  const rg = new THREE.ExtrudeGeometry(ring, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 12 }); rg.rotateX(-Math.PI / 2);
  g.add(mesh(rg, MAT.tray, 0, 0.002, 0));
  const bg = new THREE.ExtrudeGeometry(outer, { depth: 0.004, bevelEnabled: false, curveSegments: 12 }); bg.rotateX(-Math.PI / 2);
  g.add(mesh(bg, MAT.tray, 0, 0, 0));
  // paper place mat with position numbers
  const L = order.length, spacing = L > 1 ? (TW - 0.1) / (L - 1) : 0, xs = order.map((_, j) => -((L - 1) * spacing) / 2 + j * spacing);
  const cupZ = TD * 0.16; // samples in the front row, water, crackers and expectoration cup behind them
  const matTex = canvasTexture(512, 360, (ctx, w, h) => {
    ctx.fillStyle = '#fbfaf5'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#c9c6bb'; ctx.lineWidth = 3; ctx.strokeRect(8, 8, w - 16, h - 16);
    const cy = h / 2 + cupZ / (TD - 0.02) * h;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    xs.forEach((x, j) => { const cx = w / 2 + x / (TW - 0.02) * w; ctx.strokeStyle = '#b8b5aa'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, 36, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#7d7a70'; ctx.font = '700 24px Inter, sans-serif'; ctx.fillText(String(j + 1), cx, Math.min(h - 50, cy + 52)); });
    ctx.fillStyle = '#8d8a80'; ctx.font = '600 17px Inter, sans-serif'; ctx.fillText('taste from left to right · rinse between samples', w / 2, h - 24);
  });
  const mat = mesh(new THREE.PlaneGeometry(TW - 0.02, TD - 0.02), new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.95 }), 0, 0.0045, 0); mat.rotation.x = -Math.PI / 2; g.add(mat);
  const cups = [];
  order.forEach((prod, j) => {
    const c = new THREE.Group(); c.position.set(xs[j], 0.005, cupZ); g.add(c);
    c.add(mesh(cupGeo, MAT.cup, 0, 0.018, 0), mesh(cupBase, MAT.cup, 0, 0.0005, 0), mesh(cupRim, MAT.cup, 0, 0.036, 0));
    const pi = products.indexOf(prod);
    const cube = mesh(cubeGeo, crumbMats[Math.max(0, pi)], 0, 0.02, 0); cube.rotation.y = 0.3 + j * 0.9; c.add(cube);
    const lab = mesh(labelGeo, codeMat(codes[j]), 0, 0.017, 0); c.add(lab);
    c.userData = { kind: 'cup', pos: j, code: codes[j], prod };
    c.children.forEach(ch => ch.userData = c.userData);
    cups.push(c);
  });
  // water glass, crackers on a napkin, expectoration cup
  const wx = TW / 2 - 0.05, fz = -TD * 0.2;
  const glass = new THREE.Group(); glass.position.set(wx, 0.005, fz - 0.005); g.add(glass);
  glass.add(mesh(new THREE.CylinderGeometry(0.029, 0.025, 0.085, 32, 1, true), MAT.glass, 0, 0.0425, 0));
  glass.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.006, 32), MAT.glass, 0, 0.003, 0));
  glass.add(mesh(new THREE.CylinderGeometry(0.0265, 0.0243, 0.052, 32), MAT.water, 0, 0.032, 0));
  const nap = mesh(new THREE.PlaneGeometry(0.1, 0.075), MAT.paper, -0.03, 0.0052, fz); nap.rotation.x = -Math.PI / 2; nap.rotation.z = 0.08; g.add(nap);
  const crg = new RoundedBoxGeometry(0.046, 0.006, 0.046, 2, 0.003);
  [[-0.052, 0.3], [-0.01, -0.2], [-0.03, 0.9]].forEach(([x, r], j) => { const cr = mesh(crg, MAT.cracker, x, 0.0085 + (j === 2 ? 0.006 : 0), fz + (j === 2 ? -0.004 : 0.004)); cr.rotation.y = r; g.add(cr); });
  const spit = new THREE.Group(); spit.position.set(-TW / 2 + 0.05, 0.005, fz); g.add(spit);
  spit.add(mesh(new THREE.CylinderGeometry(0.036, 0.028, 0.09, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0xe9e5d8, roughness: 0.8, side: THREE.DoubleSide }), 0, 0.045, 0));
  spit.add(mesh(new THREE.CylinderGeometry(0.0362, 0.0362, 0.02, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0x3d6f9e, roughness: 0.7, side: THREE.DoubleSide }), 0, 0.06, 0));
  spit.add(mesh(new THREE.CircleGeometry(0.028, 24).rotateX(-Math.PI / 2), MAT.dark, 0, 0.004, 0));
  g.userData.cups = cups;
  shadow(g);
  return g;
}
let trays = []; // { booth, panellist, group, from, to, t }
function buildTrays(p) {
  clearGroup(trayGroup); trays = [];
  if (!design) return;
  const B = p.booths, round = Math.floor((k - 1) / B);
  const prods = design.samples.map(s => s.code);
  booths.forEach((b, i) => {
    const pan = round * B + i + 1;
    if (pan <= design.panellists) {
      const t = makeTray(design.orders[pan - 1], design.blindCodes[pan - 1], prods, p.W);
      t.position.set(b.x + b.hatchX, CH, 0.33); trayGroup.add(t);
      trays.push({ booth: i, panellist: pan, group: t, cur: 0.33 });
    }
    const nextPan = (round + 1) * B + i + 1; // next round waits behind the hatch
    if (nextPan <= design.panellists) {
      const t2 = makeTray(design.orders[nextPan - 1], design.blindCodes[nextPan - 1], prods, p.W);
      t2.position.set(b.x + b.hatchX, CH, -WALL - 0.18); t2.userData.next = true; trayGroup.add(t2);
    }
  });
}

/* ---------- ballots (tablet screens and HTML) */
function ballotModel(pan) {
  const order = design.orders[pan - 1], codes = design.blindCodes[pan - 1];
  return { order, codes, test: design.test, resp: study && sameDesign() ? study.responses.filter(r => String(r.panellist) === String(pan)) : [] };
}
const HED = ['Dislike extremely', 'Dislike very much', 'Dislike moderately', 'Dislike slightly', 'Neither like nor dislike', 'Like slightly', 'Like moderately', 'Like very much', 'Like extremely'];
function drawTablet(tb, pan) {
  const cv = tb.tex.image, ctx = cv.getContext('2d');
  ctx.textAlign = 'left'; ctx.fillStyle = '#f7f8fa'; ctx.fillRect(0, 0, 640, 436);
  ctx.fillStyle = '#1d6f4a'; ctx.fillRect(0, 0, 640, 58);
  ctx.fillStyle = '#fff'; ctx.font = '700 26px Inter, sans-serif'; ctx.textBaseline = 'middle';
  if (!design || pan > design.panellists) { ctx.fillText('Booth free', 22, 29); tb.tex.image = cv; tb.tex.needsUpdate = true; return; }
  const m = ballotModel(pan);
  ctx.fillText(m.test === 'triangle' ? 'Triangle test' : m.test === 'hedonic' ? 'How much do you like…' : 'Paired preference', 22, 29);
  ctx.textAlign = 'right'; ctx.font = '600 22px "JetBrains Mono", monospace'; ctx.fillText(panelId(pan), 618, 29); ctx.textAlign = 'left';
  ctx.fillStyle = '#333'; ctx.font = '500 20px Inter, sans-serif';
  if (m.test === 'triangle') {
    ctx.fillText('Taste the samples from left to right.', 24, 92);
    ctx.fillText('Two are identical. Which sample is different?', 24, 122);
    const ch = m.resp[0] && m.resp[0].chosen;
    m.codes.forEach((c, j) => { const x = 40 + j * 196; ctx.fillStyle = String(ch) === String(c) ? '#1d6f4a' : '#fff'; ctx.strokeStyle = '#9aa3ad'; ctx.lineWidth = 3; roundRect(ctx, x, 166, 170, 110, 16); ctx.fill(); ctx.stroke(); ctx.fillStyle = String(ch) === String(c) ? '#fff' : '#111'; ctx.font = '700 48px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText(String(c), x + 85, 222); ctx.textAlign = 'left'; });
    ctx.fillStyle = '#666'; ctx.font = '500 18px Inter, sans-serif'; ctx.fillText('You must choose one sample, even if you have to guess.', 24, 330);
    if (m.resp.length) { ctx.fillStyle = '#1d6f4a'; ctx.font = '700 20px Inter, sans-serif'; ctx.fillText('✓ Answer recorded — thank you!', 24, 380); }
  } else if (m.test === 'hedonic') {
    ctx.fillText('Taste each sample in the order shown and rate it.', 24, 88);
    m.codes.forEach((c, j) => {
      const y = 116 + j * Math.min(52, 300 / m.codes.length);
      const r = m.resp.find(q => q.sample === m.order[j]);
      ctx.fillStyle = '#111'; ctx.font = '700 22px "JetBrains Mono", monospace'; ctx.fillText(String(c), 24, y + 16);
      for (let s = 0; s < 9; s++) { const x = 104 + s * 57; ctx.fillStyle = r && r.score === s + 1 ? '#1d6f4a' : '#fff'; ctx.strokeStyle = '#9aa3ad'; ctx.lineWidth = 2; roundRect(ctx, x, y, 50, 32, 8); ctx.fill(); ctx.stroke(); ctx.fillStyle = r && r.score === s + 1 ? '#fff' : '#555'; ctx.font = '600 16px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(s + 1), x + 25, y + 17); ctx.textAlign = 'left'; }
    });
    ctx.fillStyle = '#777'; ctx.font = '500 15px Inter, sans-serif'; ctx.fillText('1 = dislike extremely   5 = neither like nor dislike   9 = like extremely', 24, 418);
  } else {
    ctx.fillText('Taste both samples from left to right.', 24, 92);
    ctx.fillText('Which sample do you prefer?', 24, 122);
    const r = m.resp[0];
    m.codes.forEach((c, j) => { const x = 110 + j * 230; const sel = r && r.sample === m.order[j]; ctx.fillStyle = sel ? '#1d6f4a' : '#fff'; ctx.strokeStyle = '#9aa3ad'; ctx.lineWidth = 3; roundRect(ctx, x, 166, 190, 110, 16); ctx.fill(); ctx.stroke(); ctx.fillStyle = sel ? '#fff' : '#111'; ctx.font = '700 48px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText(String(c), x + 95, 222); ctx.textAlign = 'left'; });
  }
  tb.tex.image = cv; tb.tex.needsUpdate = true;
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function drawAllTablets() { const p = ui.values(); const round = Math.floor((k - 1) / p.booths); booths.forEach((b, i) => drawTablet(b.tablet, round * p.booths + i + 1)); }

function sameDesign() { return !!(study && design && study.design && JSON.stringify(study.design.orders) === JSON.stringify(design.orders) && study.design.test === design.test); }
function renderBallot() {
  const el = $('ballot'); if (!design) { el.innerHTML = ''; return; }
  const m = ballotModel(k), saved = sameDesign();
  const head = `<div class="bl-head"><div><div class="bl-kick">Ballot preview — what panellist <b>${panelId(k)}</b> sees</div><div class="bl-sub">Codes in serving order, left → right. ${saved ? 'Click to record this panellist\'s answer in the project data.' : 'Save the design to the project to record answers here (e.g., on a laptop in the booth).'}</div></div><div class="bl-key" title="Panel leader's key — never shown to assessors">Key: ${m.order.map((c, j) => `<span class="code3">${m.codes[j]}</span>=${c}`).join(' ')}</div></div>`;
  let body = '';
  if (m.test === 'triangle') {
    const ch = m.resp[0] && m.resp[0].chosen;
    body = `<p class="bl-q">Taste the samples from left to right. Two are identical. <b>Which sample is different?</b></p><div class="bl-row">${m.codes.map((c, j) => `<button type="button" class="bl-opt${String(ch) === String(c) ? ' on' : ''}" data-act="tri" data-j="${j}">${c}</button>`).join('')}</div>`;
    if (m.resp.length) body += `<p class="bl-note">Recorded: ${m.resp[0].correct ? 'correct' : 'incorrect'} (odd sample ${m.codes[oddIndex(m.order)]}).</p>`;
  } else if (m.test === 'hedonic') {
    body = `<p class="bl-q">Taste each sample in the order shown and rate how much you like it.</p><div class="bl-hed">${m.codes.map((c, j) => { const r = m.resp.find(q => q.sample === m.order[j]); return `<div class="bl-hrow"><span class="code3">${c}</span>${HED.map((h, s) => `<button type="button" class="bl-s${r && r.score === s + 1 ? ' on' : ''}" data-act="hed" data-j="${j}" data-s="${s + 1}" title="${h}">${s + 1}</button>`).join('')}</div>`; }).join('')}</div><div class="bl-anchors"><span>1 dislike extremely</span><span>5 neither</span><span>9 like extremely</span></div>`;
  } else {
    const r = m.resp[0];
    body = `<p class="bl-q">Taste both samples from left to right. <b>Which sample do you prefer?</b></p><div class="bl-row">${m.codes.map((c, j) => `<button type="button" class="bl-opt${r && r.sample === m.order[j] ? ' on' : ''}" data-act="pref" data-j="${j}">${c}</button>`).join('')}</div>`;
  }
  el.innerHTML = head + body;
}
$('ballot').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b || !design) return;
  if (!sameDesign()) { toast('Save the design to the project first (Outputs → Save to project)'); return; }
  const j = +b.dataset.j, m = ballotModel(k);
  const others = study.responses.filter(r => String(r.panellist) !== String(k));
  let mine = study.responses.filter(r => String(r.panellist) === String(k));
  if (b.dataset.act === 'tri') mine = [{ panellist: k, correct: j === oddIndex(m.order), chosen: m.codes[j] }];
  else if (b.dataset.act === 'pref') mine = [{ panellist: k, sample: m.order[j], score: 1 }];
  else { mine = mine.filter(r => r.sample !== m.order[j]); mine.push({ panellist: k, sample: m.order[j], score: +b.dataset.s }); }
  study.responses = others.concat(mine).sort((a, c) => a.panellist - c.panellist);
  saveStudy(study); renderBallot(); drawAllTablets(); updateReadouts();
  const complete = design.test === 'hedonic' ? mine.length === design.samples.length : true;
  if (complete) toast(`${panelId(k)} recorded`);
});

/* ---------- ISO dimension annotations */
let dimLabels = [];
function buildDims(p) {
  clearGroup(dimGroup); dimLabels = [];
  if (!p.dims || !booths.length) return;
  const b = booths[0], W = p.W, D = p.D;
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffd166, depthTest: false });
  const seg = (a, c) => { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...c)]); const l = new THREE.Line(g, lineMat); l.renderOrder = 20; dimGroup.add(l); };
  const y = CH + 0.012, x0 = b.x - W / 2 + 0.015, x1 = b.x + W / 2 - 0.015;
  seg([x0, y, D + 0.06], [x1, y, D + 0.06]); seg([x0, y, D + 0.03], [x0, y, D + 0.09]); seg([x1, y, D + 0.03], [x1, y, D + 0.09]);
  seg([x0 + 0.05, y, 0.0], [x0 + 0.05, y, D]); seg([x0 + 0.02, y, 0], [x0 + 0.08, y, 0]); seg([x0 + 0.02, y, D], [x0 + 0.08, y, D]);
  seg([b.x - W / 2, 1.2, D], [b.x - W / 2, 1.2, D + EXT]);
  const ok = (v, m) => v >= m - 1e-9 ? 'ok' : 'bad';
  const mk = (pos, html) => { const l = stage.addLabel(pos, html, { className: 'label3d dimlab' }); dimGroup.add(l); dimLabels.push(l); };
  mk([b.x, y + 0.03, D + 0.1], `<span class="${ok(W, 0.9)}">width ${fmt(W, 2)} m</span><small>ISO 8589: ≥ 0.9 m</small>`);
  mk([x0 + 0.06, y + 0.03, D / 2], `<span class="${ok(D, 0.6)}">depth ${fmt(D, 2)} m</span><small>≥ 0.6 m</small>`);
  mk([b.x - W / 2, 1.28, D + EXT / 2], `<span class="ok">divider +${fmt(EXT, 2)} m</span><small>≥ 0.3 m beyond counter</small>`);
}

/* ---------- picking */
let pickLabel = null;
stage.onPick({
  objects: () => [...trayGroup.children, ...hatches, ...tablets.map(t => t.screen)],
  onClick: hit => {
    if (pickLabel) { pickLabel.removeFromParent(); pickLabel = null; }
    if (!hit) return;
    let o = hit.object; const u = o.userData || {};
    if (u.kind === 'hatch') { u.target = u.target > 0.5 ? 0 : 1; return; }
    if (u.kind === 'tablet') { $('ballot').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (u.kind === 'cup') {
      const s = design.samples.find(q => q.code === u.prod);
      pickLabel = stage.addLabel(hit.point.clone().add(new THREE.Vector3(0, 0.06, 0)), `Code ${u.code} · position ${u.pos + 1}<small>${esc(s ? s.code + ' — ' + s.label : u.prod)} · panel-leader key only</small>`, { className: 'label3d lg' });
    }
  }
});

/* =================================================================== charts */
const posChart = new BarChart('#chart-pos', { y: { label: 'Times served', unit: '', min: 0 } });
const carryPlot = new Plot('#chart-carry', { x: { label: 'Sample served next', min: -0.5, max: 2.5, format: () => '' }, y: { label: 'Sample served immediately before', min: -0.5, max: 2.5, format: () => '', nice: false }, legend: false, crosshair: false });
const specPlot = new Plot('#chart-spec', { x: { label: 'Wavelength', unit: 'nm', min: 380, max: 780 }, y: { label: 'Reflectance', unit: '', min: 0, max: 1 }, y2: { label: 'Light output (relative)', unit: '', min: 0, max: 1.05 } });
const deChart = new BarChart('#chart-de', { y: { label: 'ΔE*ab relative to product A', unit: '', min: 0 } });

function updateCharts() {
  if (!design) return;
  const p = ui.values(), P = design.samples.length, st = balanceStats(design), L = design.orders[0].length;
  posChart.set(Array.from({ length: L }, (_, j) => `Position ${j + 1}`), design.samples.map((s, i) => ({ label: `${s.code} · ${s.label}`, values: st.pos[i], color: 'c' + (i + 1) })));
  // colour = deviation from perfect balance (white = balanced, red = more often, blue = less often than average)
  const diag = design.test === 'triangle';
  const z = st.carry.map((r, i) => r.map((v, j) => i === j && !diag ? NaN : v));
  const vals = z.flat().filter(Number.isFinite), avg = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  const dev = Math.max(1, ...vals.map(v => Math.abs(v - avg)));
  carryPlot.setAxis('x', { min: -0.5, max: P - 0.5 }); carryPlot.setAxis('y', { min: -0.5, max: P - 0.5 });
  carryPlot.heatmap('hm', { z: z.map(r => r.map(v => Number.isFinite(v) ? avg - v : NaN)), x0: -0.5, x1: P - 0.5, y0: -0.5, y1: P - 0.5, colormap: 'rdbu', min: -dev * 1.6, max: dev * 1.6, smooth: false });
  carryPlot.custom('txt', (ctx, pl, pal) => {
    ctx.font = '600 12px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < P; i++) for (let j = 0; j < P; j++) { const v = z[i][j]; ctx.fillStyle = Number.isFinite(v) ? '#1d2327' : pal.muted; ctx.fillText(Number.isFinite(v) ? String(v) : '—', pl.px(j), pl.py(i)); }
  });
  carryPlot.custom('axes', (ctx, pl, pal) => {
    const r = pl.plotRect; ctx.font = '600 12px Inter, sans-serif'; ctx.fillStyle = pal.ink2 || pal.ink;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; for (let j = 0; j < P; j++) ctx.fillText(LETTERS[j], pl.px(j), r.top + r.height + 6);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; for (let i = 0; i < P; i++) ctx.fillText(LETTERS[i], r.left - 8, pl.py(i));
  }, { noClip: true });
  // spectra
  const cm = colourModel(p, P);
  const spd = LIGHTS[p.light].spd, smax = Math.max(...spd);
  specPlot.line('spd', LAMBDA, spd.map(v => v / smax), { color: p.light === 'white' ? 'amber' : p.light === 'red' ? 'danger' : 'accent', fill: 0.16, width: 1.5, label: LIGHTS[p.light].label, y2: true });
  for (let i = 0; i < 6; i++) specPlot.remove('r' + i);
  cm.refl.forEach((R, i) => specPlot.line('r' + i, LAMBDA, R, { color: 'c' + (i + 1), width: 2.4, label: `${design.samples[i].code} reflectance` }));
  specPlot.custom('rainbow', (ctx, pl) => { const y = pl.plotRect.top + pl.plotRect.height - 7; for (let l = 380; l < 780; l += 4) { ctx.fillStyle = wlCss(l); ctx.fillRect(pl.px(l), y, pl.px(l + 4) - pl.px(l) + 0.5, 7); } });
  deChart.set(Object.values(LIGHTS).map(L => L.short), design.samples.slice(1).map((s, i) => ({ label: `${s.code} vs A`, values: Object.keys(LIGHTS).map(kk => cm.res[kk].dE[i + 1]), color: 'c' + (i + 2), format: v => fmt(v, 1) })));
  deChart.refLine(2.3, '≈ 1 JND (ΔE ≈ 2.3)', 'magenta');
  $('swatches').innerHTML = design.samples.map((s, i) => `<span class="sw"><i style="background:${appearanceCSS(cm.refl[i], p.light)}"></i>${s.code}</span>`).join('') + `<span class="sw-note">as seen under ${LIGHTS[p.light].label.toLowerCase()}</span>`;
}
function wlCss(nm) { let r = 0, g = 0, b = 0; if (nm < 440) { r = (440 - nm) / 60; b = 1; } else if (nm < 490) { g = (nm - 440) / 50; b = 1; } else if (nm < 510) { g = 1; b = (510 - nm) / 20; } else if (nm < 580) { r = (nm - 510) / 70; g = 1; } else if (nm < 645) { r = 1; g = (645 - nm) / 65; } else r = 1; const f = nm < 420 ? 0.3 + 0.7 * (nm - 380) / 40 : nm > 700 ? 0.3 + 0.7 * (780 - nm) / 80 : 1; return `rgb(${[r, g, b].map(v => Math.round(255 * Math.pow(v * f, 0.8))).join(',')})`; }

/* =================================================================== serving sheet, CSV, printing */
function renderSheet() {
  if (!design) return;
  const p = ui.values(), L = design.orders[0].length;
  const rows = design.orders.map((o, i) => {
    const pan = i + 1, codes = design.blindCodes[i];
    const odd = design.test === 'triangle' ? oddIndex(o) : -1;
    return `<tr class="${pan === k ? 'cur' : ''}" data-pan="${pan}"><td>${panelId(pan)}</td><td class="num">${(i % p.booths) + 1}</td><td class="num">${Math.floor(i / p.booths) + 1}</td><td><span class="seqchip">${o.map(c => `<b class="p${design.samples.findIndex(s => s.code === c)}">${c}</b>`).join('')}</span></td>${codes.map((c, j) => `<td><span class="code3${j === odd ? ' odd' : ''}">${c}</span></td>`).join('')}${design.test === 'triangle' ? `<td><span class="code3">${codes[odd]}</span> (${o[odd]})</td>` : ''}</tr>`;
  }).join('');
  $('sheet').innerHTML = `<table class="sheet-table"><thead><tr><th>Panellist</th><th class="num">Booth</th><th class="num">Round</th><th>Sequence</th>${Array.from({ length: L }, (_, j) => `<th>Position ${j + 1}</th>`).join('')}${design.test === 'triangle' ? '<th>Odd sample (key)</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`;
  $('sheet-legend').innerHTML = design.samples.map((s, i) => `<span class="lg"><b class="p${i}">${s.code}</b> ${esc(s.label)}</span>`).join('') + `<span class="lg muted">seed ${design.seed ?? '—'} · ${design.uniqueCodes === false ? 'shared codes' : 'fresh codes per panellist'}</span>`;
}
$('sheet').addEventListener('click', e => { const tr = e.target.closest('tr[data-pan]'); if (tr) setK(+tr.dataset.pan); });
function downloadPlan() {
  if (!design) return; const L = design.orders[0].length;
  const head = ['panellist', 'booth', 'round', 'sequence', ...Array.from({ length: L }, (_, j) => `code_pos${j + 1}`), ...Array.from({ length: L }, (_, j) => `product_pos${j + 1}`)];
  if (design.test === 'triangle') head.push('odd_code', 'odd_product');
  const B = ui.get('booths');
  downloadCSV(`serving-plan-${design.test}-${design.panellists}.csv`, head, design.orders.map((o, i) => { const r = [panelId(i + 1), (i % B) + 1, Math.floor(i / B) + 1, o.join(''), ...design.blindCodes[i], ...o]; if (design.test === 'triangle') { const j = oddIndex(o); r.push(design.blindCodes[i][j], o[j]); } return r; }));
}
function printRoot() { let r = $('print-root'); if (!r) { r = document.createElement('div'); r.id = 'print-root'; document.body.appendChild(r); } return r; }
function doPrint(kind) {
  if (!design) return;
  const r = printRoot(), date = new Date().toLocaleDateString('en-GB');
  const testName = { triangle: 'Triangle test (ISO 4120)', hedonic: '9-point hedonic test', preference: 'Paired preference test' }[design.test];
  if (kind === 'ballots') {
    r.innerHTML = design.orders.map((o, i) => {
      const codes = design.blindCodes[i];
      let q = '';
      if (design.test === 'triangle') q = `<p>Taste the three samples <b>from left to right</b>. Two samples are identical and one is different. Rinse your mouth with water between samples.</p><p><b>Which sample is different?</b> Tick one box — you must choose, even if you have to guess.</p><table class="pb-codes"><tr>${codes.map(c => `<td><div class="pb-code">${c}</div><div class="pb-box"></div></td>`).join('')}</tr></table><p class="pb-small">Comments (optional):</p><div class="pb-lines"></div>`;
      else if (design.test === 'hedonic') q = `<p>Taste the samples <b>in the order listed</b>. Rinse with water between samples. Tick the box that best describes how much you like each sample overall.</p>${codes.map(c => `<div class="pb-hed"><div class="pb-code sm">${c}</div><table><tr>${HED.map(h => `<td><div class="pb-box sm"></div><div class="pb-lab">${h}</div></td>`).join('')}</tr></table></div>`).join('')}`;
      else q = `<p>Taste both samples <b>from left to right</b>. Rinse with water between samples.</p><p><b>Which sample do you prefer?</b> Tick one box.</p><table class="pb-codes"><tr>${codes.map(c => `<td><div class="pb-code">${c}</div><div class="pb-box"></div></td>`).join('')}</tr></table>`;
      return `<section class="pb"><header><div><div class="pb-kick">Future Food Production · sensory study</div><h2>${testName}</h2></div><div class="pb-id">Panellist<br><b>${panelId(i + 1)}</b></div></header>${q}<footer>Thank you! Please press the READY button or hand this ballot through the hatch. · ${date}</footer></section>`;
    }).join('');
  } else {
    const B = ui.get('booths'), L = design.orders[0].length;
    r.innerHTML = `<section class="pb sheet"><header><div><div class="pb-kick">Serving sheet — panel leader only (keep out of the testing area)</div><h2>${testName}: ${design.panellists} panellists</h2><p>${design.samples.map(s => `<b>${s.code}</b> = ${esc(s.label)}`).join(' · ')} · seed ${design.seed ?? '—'} · ${date}</p></div></header><table class="pb-sheet"><thead><tr><th>Panellist</th><th>Booth</th><th>Round</th><th>Sequence</th>${Array.from({ length: L }, (_, j) => `<th>Pos. ${j + 1}</th>`).join('')}${design.test === 'triangle' ? '<th>Odd (key)</th>' : ''}<th>✓ served</th></tr></thead><tbody>${design.orders.map((o, i) => { const codes = design.blindCodes[i], odd = design.test === 'triangle' ? oddIndex(o) : -1; return `<tr><td>${panelId(i + 1)}</td><td>${(i % B) + 1}</td><td>${Math.floor(i / B) + 1}</td><td>${o.join('')}</td>${codes.map((c, j) => `<td>${c} <small>(${o[j]})</small></td>`).join('')}${odd >= 0 ? `<td>${codes[odd]} (${o[odd]})</td>` : ''}<td></td></tr>`; }).join('')}</tbody></table></section>`;
  }
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 400); }, 60);
}

/* =================================================================== project store */
function exportStudy() {
  if (!design) return;
  const prev = loadStudy();
  if (prev && prev.responses && prev.responses.length && !sameDesign()) {
    try { localStorage.setItem(STORE_KEY + '-previous', JSON.stringify(prev)); } catch (e) { }
    toast('Previous study with responses kept as a backup (ffp-sensory-v1-previous)');
  }
  const keep = sameDesign() ? study.responses : [];
  study = {
    version: 1,
    design: { test: design.test, samples: design.samples.map(s => ({ code: s.code, label: s.label })), panellists: design.panellists, orders: design.orders, blindCodes: design.blindCodes, seed: design.seed, created: new Date().toISOString(), source: 'sensory-booth' },
    responses: keep
  };
  if (saveStudy(study)) toast('Design saved to the project (ffp-sensory-v1)'); else toast('Could not save — is browser storage blocked?');
  renderBallot(); drawAllTablets(); updateReadouts(); updateSavedNote();
}
function loadSaved() {
  const s = loadStudy();
  if (!s || !s.design.orders || !s.design.orders.length) { toast('No saved design in this browser yet'); return; }
  study = s;
  const d = s.design, P = d.samples.length, L = d.orders[0].length;
  const test = ['triangle', 'hedonic', 'preference'].includes(d.test) ? d.test : 'hedonic';
  ui.set('test', test, true); if (test === 'hedonic') ui.set('t', P, true); ui.set('n', d.orders.length, true);
  if (d.seed) ui.set('seed', d.seed, true);
  d.samples.forEach((q, i) => { names[i] = q.label; const inp = document.querySelector(`#pnames input[data-i="${i}"]`); if (inp) inp.value = q.label; });
  const blind = d.blindCodes && d.blindCodes.length === d.orders.length ? d.blindCodes : d.orders.map((o, i) => o.map((_, j) => GOOD_CODES[(i * 37 + j * 211 + 13) % GOOD_CODES.length]));
  external = { test, samples: d.samples.map(q => ({ ...q })), panellists: d.orders.length, orders: d.orders, blindCodes: blind, seed: d.seed, uniqueCodes: true };
  designKey = ''; k = 1; update(); toast(`Loaded saved ${test} design (${d.orders.length} panellists, ${s.responses.length} responses)`);
}
function updateSavedNote() {
  const s = loadStudy();
  $('saved-note').innerHTML = s ? `Stored project study: <b>${esc(s.design.test)}</b>, ${s.design.orders ? s.design.orders.length : s.design.panellists} panellists, ${s.responses.length} responses${sameDesign() ? ' — <span class="ok-t">this design</span>' : ' — <span class="warn-t">a different design</span>'}.` : 'No study stored in this browser yet.';
}

/* =================================================================== update */
function setK(v) { if (!design) return; const nk = Math.max(1, Math.min(design.panellists, v)); const B = ui.get('booths'); const roundChanged = Math.floor((nk - 1) / B) !== Math.floor((k - 1) / B); k = nk; if (roundChanged) serveRound(); else { drawAllTablets(); } renderBallot(); renderSheetCursor(); updateHud(); updateLeds(); updateReadouts(); }
$('k-prev').addEventListener('click', () => setK(k - 1));
$('k-next').addEventListener('click', () => setK(k + 1));
stage.onKey('space', () => setK(k >= (design ? design.panellists : 1) ? 1 : k + 1));
function renderSheetCursor() { document.querySelectorAll('#sheet tr[data-pan]').forEach(tr => tr.classList.toggle('cur', +tr.dataset.pan === k)); }
function updateLeds() { const B = ui.get('booths'); leds.forEach((l, i) => { l.material = i === (k - 1) % B ? MAT.led : MAT.ledOff; }); MAT.led.emissiveIntensity = 2.2; }
let serveAnim = null;
function serveRound() {
  const p = ui.values();
  hatches.forEach(h => h.userData.target = 1);
  serveAnim = { t: 0 };
  buildTrays(p); drawAllTablets(); placeKeyLight();
  trays.forEach(tr => { tr.group.position.z = -WALL - 0.18; });
  trayGroup.children.forEach(t => { if (t.userData.next) t.visible = false; });
}
function placeKeyLight() {
  const b = booths[(k - 1) % Math.max(1, booths.length)]; if (!b) return;
  keyLight.position.set(b.x + b.hatchX * 0.5, SOFFIT - 0.06, 0.4); keyLight.target.position.set(b.x + b.hatchX * 0.5, CH, 0.34);
}
function updateHud() {
  if (!design) return;
  const p = ui.values(), B = p.booths, o = design.orders[k - 1], codes = design.blindCodes[k - 1];
  $('k-id').textContent = panelId(k); $('k-sub').textContent = `booth ${((k - 1) % B) + 1} · round ${Math.floor((k - 1) / B) + 1} of ${Math.ceil(design.panellists / B)}`;
  hud.set('pan', `Panellist <b>${panelId(k)}</b> · booth ${((k - 1) % B) + 1} · tray ${codes.map(c => `<b>${c}</b>`).join(' ')}`);
  const cm = colourModel(p, design.samples.length);
  hud.set('light', `${LIGHTS[p.light].label} · colour cue ΔE*ab <b>${fmt(cm.res[p.light].dE[cm.res[p.light].dE.length - 1], 1)}</b>`);
  hud.set('key', design.test === 'triangle' ? `Key: odd sample <b>${codes[oddIndex(o)]}</b> (${o[oddIndex(o)]}) · sequence ${o.join('')}` : `Sequence <b>${o.join(' → ')}</b>`);
}
const qCrit = (t, df) => qtukeyFast(0.95, t, df);
function updateReadouts() {
  if (!design) return;
  const p = ui.values(), st = balanceStats(design), nSeq = design.test === 'triangle' ? 6 : design.test === 'preference' ? 2 : (design.samples.length % 2 ? 2 : 1) * design.samples.length;
  const uses = Object.values(st.seqCounts), lo = Math.min(...uses), hi = Math.max(...uses), n = design.panellists;
  ro.set('design', design.test === 'triangle' ? '6 arrangements' : design.test === 'preference' ? 'AB / BA' : `Williams, ${nSeq} sequences`, null, design.test === 'hedonic' ? (design.samples.length % 2 ? `t = ${design.samples.length} is odd → 2t sequences` : `t = ${design.samples.length} is even → t sequences`) : 'ISO 4120: used equally often');
  ro.set('seq', lo === hi ? `${lo}× each` : `${lo}–${hi}×`, lo === hi && uses.length === nSeq ? 'ok' : 'warn', lo === hi && uses.length === nSeq ? 'fully balanced' : `n is not a multiple of ${nSeq}`);
  ro.set('pos', st.posRange, st.posRange === 0 ? 'ok' : st.posRange <= 1 ? 'warn' : 'bad', 'products per serving position');
  ro.set('carry', design.test === 'hedonic' ? String(st.carryRange) : '—', design.test === 'hedonic' ? (st.carryRange === 0 ? 'ok' : 'warn') : null, design.test === 'hedonic' ? 'ordered pairs, off-diagonal' : 'not used for this test');
  if (design.test === 'triangle') { const xc = binomCritical(n, 1 / 3, 0.05); ro.set('crit', `≥ ${xc} of ${n} correct`, n >= 18 ? null : 'warn', n >= 18 ? 'α = 0.05, one-sided exact binomial' : 'ISO 4120: n < 18 not recommended'); }
  else if (design.test === 'preference') { const xc = prefCritical(n, 0.05); ro.set('crit', `≥ ${xc} of ${n} prefer one`, null, 'α = 0.05, two-sided exact binomial'); }
  else { const t = design.samples.length, hsd = qCrit(t, (t - 1) * (n - 1)) * Math.sqrt(1.44 / n); ro.set('crit', `HSD ≈ ${fmt(hsd, 2)} points`, null, 'Tukey, assuming error SD 1.2 points'); }
  const cm = colourModel(p, design.samples.length), dv = cm.res[p.light].dE[cm.res[p.light].dE.length - 1];
  ro.set('de', dv, design.test === 'hedonic' ? null : dv < 2.3 ? 'ok' : dv < 5 ? 'warn' : 'bad', design.test === 'hedonic' ? 'consumers normally see the real colour' : dv < 2.3 ? 'masked (below ≈ 1 JND)' : dv < 5 ? 'weak cue — may be noticed' : 'clear colour cue — mask it');
  const okW = p.W >= 0.9 - 1e-9, okD = p.D >= 0.6 - 1e-9;
  ro.set('width', `${fmt(p.W, 2)} × ${fmt(p.D, 2)} m`, okW && okD ? 'ok' : 'bad', okW && okD ? 'meets ISO 8589 minimum' : 'below ISO 8589 (0.9 × 0.6 m)');
  const L = design.orders[0].length, tp = 1.5 + L * p.tS + (L - 1) * p.tR, rounds = Math.ceil(n / p.booths), tot = rounds * tp + (rounds - 1) * 2;
  ro.set('session', `${Math.floor(tot / 60)} h ${String(Math.round(tot % 60)).padStart(2, '0')} min`, tot <= 120 ? 'ok' : tot <= 180 ? 'warn' : 'bad', `${rounds} rounds × ${fmt(tp, 1)} min + changeovers`);
  const nResp = sameDesign() ? new Set(study.responses.map(r => String(r.panellist))).size : 0;
  ro.set('resp', sameDesign() ? `${nResp} of ${n}` : 'not saved', sameDesign() ? (nResp === n ? 'ok' : null) : 'warn', sameDesign() ? 'stored in ffp-sensory-v1' : 'Outputs → Save to project');
}
function applyLight(p) {
  const L = LIGHTS[p.light], c = new THREE.Color(L.hex);
  panelMat.emissive.copy(c); panelMat.emissiveIntensity = p.light === 'white' ? 1.15 : 1.6;
  booths.forEach(b => { b.light.color.copy(c); b.light.intensity = p.light === 'white' ? 7.5 : 10; });
  roomLights.forEach(l => { l.color.copy(c); l.intensity = p.light === 'white' ? 3.0 : 1.8; });
  keyLight.color.copy(c); keyLight.intensity = p.light === 'white' ? 0.55 : 0.45;
  hemi.color.copy(p.light === 'white' ? new THREE.Color(0xf0f2ff) : c); hemi.intensity = p.light === 'white' ? 0.28 : 0.12;
  scene.environmentIntensity = p.light === 'white' ? 0.3 : 0.05;
}
function applyColours(p) {
  if (!design) return;
  const cm = colourModel(p, design.samples.length);
  cm.albedo.forEach((a, i) => crumbMats[i].color.setRGB(a[0], a[1], a[2]));
  if (prepLoaves[1]) prepLoaves[1].material = crumbMats[design.samples.length - 1];
}
function update() {
  const p = ui.values();
  const gk = [p.booths, p.W, p.D].join('|');
  let rebuilt = false;
  if (gk !== geomKey) { buildStatic(p); geomKey = gk; rebuilt = true; }
  const dk = [p.test, p.test === 'hedonic' ? p.t : 2, p.n, p.seed, p.uniq].join('|');
  if (external && dk !== external._key) { if (external._key) external = null; else external._key = dk; }
  if (dk !== designKey || rebuilt) {
    if (dk !== designKey) {
      design = external ? external : buildDesign({ test: p.test, t: p.t, n: p.n, labels: names, seed: p.seed, uniqueCodes: p.uniq });
      if (!external) design.samples.forEach((s, i) => s.label = (names[i] || '').trim() || `Product ${s.code}`);
      k = Math.min(k, design.panellists);
    }
    designKey = dk;
    buildTrays(p); renderSheet(); renderBallot();
  }
  document.querySelectorAll('#pnames .pn').forEach(el => { el.style.display = +el.dataset.i < nProducts(p) ? '' : 'none'; });
  ui.enable('t', p.test === 'hedonic');
  applyLight(p); applyColours(p); buildDims(p); placeKeyLight();
  drawAllTablets(); updateLeds(); updateHud(); updateCharts(); updateReadouts(); updateSavedNote();
}
ui.onChange(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
let raf = 0;
update();

/* =================================================================== animation */
stage.onFrame((dt) => {
  hatches.forEach(h => { const u = h.userData; u.open += (u.target - u.open) * Math.min(1, dt * 4); h.position.y = u.closedY + 0.39 * u.open; });
  if (serveAnim) {
    serveAnim.t += dt;
    const s = Math.min(1, Math.max(0, (serveAnim.t - 0.45) / 0.9)), e = s < 0.5 ? 2 * s * s : 1 - Math.pow(-2 * s + 2, 2) / 2;
    trays.forEach(tr => { tr.group.position.z = (-WALL - 0.18) + (0.33 + WALL + 0.18) * e; });
    if (serveAnim.t > 1.5) hatches.forEach(h => h.userData.target = 0);
    if (serveAnim.t > 2.2) { serveAnim = null; trayGroup.children.forEach(t => { t.visible = true; }); }
  }
});

/* camera views */
const views = {
  overview: () => stage.resetView(),
  assessor: () => { const b = booths[(k - 1) % ui.get('booths')]; if (b) stage.flyTo([b.x + 0.04, 1.2, ui.get('D') + 0.55], [b.x + b.hatchX * 0.4, CH + 0.02, 0.3]); },
  prep: () => { const b = booths[(k - 1) % ui.get('booths')]; stage.flyTo([(b ? b.x : 0) + 0.9, 1.55, -1.75], [(b ? b.x : 0), 0.95, -0.1]); },
  plan: () => { const b = booths[(k - 1) % ui.get('booths')]; if (b) stage.flyTo([b.x + 0.02, 1.95, ui.get('D') + 0.38], [b.x, CH, 0.3]); }
};
document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => views[btn.dataset.view]()));
window.__booth = { get design() { return design; }, setK, views };
