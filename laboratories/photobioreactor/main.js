/* Microalgae photobioreactor — UI, 3D scene and charts.
   Model in ./model.js: Beer–Lambert light attenuation in slab / two-sided panel / tube geometry,
   Bernard & Rémond light response with photoinhibition, CTMI temperature factor, respiration, dilution. */
import { createStage, addSky, fitShadow, THREE, M, makeGround, makeGreenhouse, makePipe, makeTank, Bubbles, FlowAlong, canvasTexture, surfaceTextures, surfaceMaterial, RoundedBoxGeometry, disposeDeep } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, downloadCSV, linspace } from '/assets/js/plot.js';
import { colormap, colormapGradient } from '/assets/js/colors.js';
import { solarElevation, solarAzimuth, deg, doSaturation } from '/assets/js/physics.js';
import { STRAINS, Culture, geometry, muAvg, muLight, ctmi, profile, ppfdAt, dailyPhotons, mixingPower, steadyConst, steadySun, Y_O2, Y_CO2, E_BIOMASS, PAR_UMOL_PER_J } from './model.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const SITES = { almeria: { label: 'Almería, Spain (36.8° N)', lat: 36.8 }, vasteras: { label: 'Västerås, Sweden (59.6° N)', lat: 59.6 }, kona: { label: 'Kona, Hawaiʻi (19.6° N)', lat: 19.6 } };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const doyLabel = d => { const dt = new Date(Date.UTC(2026, 0, 1) + (d - 1) * 864e5); return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} (day ${Math.round(d)})`; };

/* ================================================================== controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ui.section('Simulation');
const [playBtn] = ui.buttons([{ label: '▶ Run', variant: 'primary', onClick: () => clock.toggle() }, { label: '⟲ Reset culture', onClick: () => restart() }]);
ui.segmented({ id: 'speed', label: 'Simulation speed', options: [{ value: 0.25, label: '6 h/s' }, { value: 1, label: '1 d/s' }, { value: 3, label: '3 d/s' }], value: 1, help: 'Simulated time per real second. Space bar = run/pause.' });
ui.section('Cultivation system');
ui.segmented({ id: 'system', label: 'Reactor', options: [{ value: 'tubular', label: 'Tubular' }, { value: 'panel', label: 'Flat panel' }, { value: 'raceway', label: 'Raceway' }], value: 'raceway' });
ui.select({ id: 'strain', label: 'Strain', options: Object.entries(STRAINS).map(([value, s]) => ({ value, label: s.label })), value: 'arthrospira' });
ui.slider({ id: 'T', label: 'Culture temperature', min: 5, max: 42, step: 0.5, value: 33, unit: '°C', help: 'Selecting a strain moves this to its optimum.' });
ui.section('Operation');
ui.segmented({ id: 'mode', label: 'Operating mode', options: [{ value: 'batch', label: 'Batch' }, { value: 'cont', label: 'Continuous' }], value: 'batch' });
ui.slider({ id: 'D', label: 'Dilution rate D', min: 0.02, max: 1.5, step: 0.01, value: 0.3, unit: 'd⁻¹', help: 'Fraction of the volume harvested and replaced by fresh medium per day.' });
ui.slider({ id: 'X0', label: 'Starting biomass X₀', min: 0.02, max: 2, step: 0.01, value: 0.1, unit: 'g L⁻¹' });
ui.section('Light');
ui.segmented({ id: 'light', label: 'Light source', options: [{ value: 'sun', label: 'Sun (clear sky)' }, { value: 'const', label: 'Constant' }], value: 'sun' });
ui.select({ id: 'site', label: 'Site', options: Object.entries(SITES).map(([value, s]) => ({ value, label: s.label })), value: 'almeria' });
ui.slider({ id: 'doy', label: 'Start date', min: 1, max: 365, step: 1, value: 172, format: doyLabel });
ui.slider({ id: 'I0const', label: 'Constant PPFD (horizontal)', min: 50, max: 2000, step: 10, value: 500, unit: 'µmol m⁻² s⁻¹' });
ui.toggle({ id: 'greenhouse', label: 'Tubes inside a greenhouse (τ = 0.70)', value: true });
ui.section('Geometry & mixing');
ui.slider({ id: 'depth', label: 'Pond depth', min: 0.05, max: 0.5, step: 0.01, value: 0.2, unit: 'm' });
ui.slider({ id: 'tubeD', label: 'Tube inner diameter', min: 0.02, max: 0.1, step: 0.002, value: 0.05, unit: 'm' });
ui.slider({ id: 'tubeS', label: 'Tube spacing (centre to centre)', min: 0.03, max: 0.3, step: 0.005, value: 0.06, unit: 'm' });
ui.slider({ id: 'loopL', label: 'Tube length between degassers', min: 20, max: 400, step: 5, value: 100, unit: 'm' });
ui.slider({ id: 'thick', label: 'Panel thickness (light path)', min: 0.01, max: 0.1, step: 0.002, value: 0.03, unit: 'm' });
ui.slider({ id: 'spacing', label: 'Distance between panel rows', min: 0.2, max: 2.5, step: 0.05, value: 0.6, unit: 'm', help: 'Panels 1.5 m tall. Close rows dilute the light over more surface.' });
ui.slider({ id: 'u', label: 'Liquid velocity', min: 0.1, max: 1.0, step: 0.01, value: 0.25, unit: 'm s⁻¹' });
ui.slider({ id: 'vvm', label: 'Aeration (flat panel)', min: 0.05, max: 1.5, step: 0.05, value: 0.3, unit: 'vvm' });
ui.section('Physiology (strain defaults)');
ui.slider({ id: 'Iopt', label: 'Optimal irradiance I_opt', min: 100, max: 2500, step: 10, value: STRAINS.arthrospira.Iopt, unit: 'µmol m⁻² s⁻¹', help: 'Above I_opt photoinhibition lowers the local growth rate (Eq. P3).' });
ui.slider({ id: 'ka', label: 'Specific light attenuation k_a', min: 0.05, max: 0.4, step: 0.005, value: STRAINS.arthrospira.ka, unit: 'm² g⁻¹', digits: 3 });
ui.slider({ id: 'resp', label: 'Respiration (maintenance) r', min: 0, max: 0.3, step: 0.005, value: STRAINS.arthrospira.r, unit: 'd⁻¹', digits: 3 });
ui.section('View');
ui.toggle({ id: 'labels', label: 'Component labels', value: true });
ui.toggle({ id: 'cut', label: 'Show the light inside the culture (cross-section board)', value: true });
ui.buttons([{ label: 'Overview', onClick: () => fly('home') }, { label: 'Close-up', onClick: () => fly('close') }, { label: 'Cross-section', onClick: () => fly('section') }]);
let applyingPreset = false;
const PRESETS = [
  { label: 'Spirulina raceway · Almería, June', values: { system: 'raceway', strain: 'arthrospira', T: 33, mode: 'batch', X0: 0.1, light: 'sun', site: 'almeria', doy: 172, depth: 0.2, u: 0.25, Iopt: 2000, ka: 0.225, resp: 0.1 } },
  { label: 'Chlorella tubes in a greenhouse', values: { system: 'tubular', strain: 'chlorella', T: 25, mode: 'cont', D: 0.35, X0: 0.5, light: 'sun', site: 'almeria', doy: 172, tubeD: 0.05, tubeS: 0.06, loopL: 100, u: 0.4, greenhouse: true, Iopt: 600, ka: 0.15, resp: 0.1 } },
  { label: 'Nannochloropsis panels · Västerås, June', values: { system: 'panel', strain: 'nanno', T: 24, mode: 'cont', D: 0.25, X0: 0.5, light: 'sun', site: 'vasteras', doy: 172, thick: 0.03, spacing: 0.6, vvm: 0.3, Iopt: 500, ka: 0.18, resp: 0.1 } },
  { label: 'Too deep: 40 cm pond', values: { system: 'raceway', strain: 'arthrospira', T: 33, mode: 'cont', D: 0.2, X0: 0.3, light: 'sun', site: 'almeria', doy: 172, depth: 0.4, u: 0.25, Iopt: 2000, ka: 0.225, resp: 0.1 } },
  { label: 'Winter in Västerås', values: { system: 'raceway', strain: 'chlorella', T: 15, mode: 'batch', X0: 0.1, light: 'sun', site: 'vasteras', doy: 15, depth: 0.2, u: 0.25, Iopt: 600, ka: 0.15, resp: 0.1 } }
];
ui.presets(PRESETS.map(p => Object.assign({}, p, { onApply: () => { applyingPreset = false; syncEnabled(); rebuildIfNeeded(); restart(); } })));
document.querySelectorAll('#controls .presets button').forEach(b => b.addEventListener('pointerdown', () => { applyingPreset = true; }, true));
ui.saveButton('photobioreactor', () => Object.assign({ day: +cul.t.toFixed(2) }, ro.values()));
ui.button({ label: 'Download time series (CSV)', onClick: () => downloadHistory() });

ro.add({ id: 'X', label: 'Biomass X', unit: 'g L⁻¹', digits: 2 })
  .add({ id: 'I0', label: 'PPFD on the culture now', unit: 'µmol m⁻² s⁻¹', digits: 0 })
  .add({ id: 'back', label: 'Light reaching the far side', unit: '% of surface', format: v => v < 0.01 ? '&lt; 0.01' : fmt(v, v < 1 ? 2 : 1) })
  .add({ id: 'photic', label: 'Culture volume growing (net)', unit: '%', digits: 0 })
  .add({ id: 'mu', label: 'Net specific growth rate now', unit: 'd⁻¹', digits: 3 })
  .add({ id: 'PV', label: 'Volumetric productivity (24 h)', unit: 'g L⁻¹ d⁻¹', digits: 3 })
  .add({ id: 'PA', label: 'Areal productivity (24 h)', unit: 'g m⁻² d⁻¹', digits: 1 })
  .add({ id: 'PE', label: 'Photosynthetic efficiency (PAR)', unit: '%', digits: 2 })
  .add({ id: 'mix', label: 'Mixing / pumping power', unit: 'W m⁻³', digits: 1 })
  .add({ id: 'ekg', label: 'Mixing energy per kg biomass', unit: 'kWh kg⁻¹', digits: 2 })
  .add({ id: 'phi', label: 'Temperature factor φ(T)', unit: '', digits: 2 })
  .add({ id: 'gas', label: 'O₂ released (24 h)', unit: 'g m⁻² d⁻¹', digits: 1 });
const hud = hudChips(document.getElementById('stage'));

/* ================================================================== model */
const params = () => { const v = ui.values(); return Object.assign({}, v, { lat: SITES[v.site].lat, Hp: 1.5, tauGH: 0.7 }); };
const cul = new Culture(params());

/* ================================================================== stage */
const stage = createStage('#stage', {
  background: null, envIntensity: 0.3, exposure: 0.55,
  camera: { pos: [13, 6.5, 13], target: [0, 0, 0], fov: 40 },
  controls: { minDistance: 0.5, maxDistance: 120, maxPolarAngle: Math.PI * 0.485 },
  bloom: { strength: 0.25, radius: 0.4, threshold: 1.0 }, ao: { radius: 0.35, intensity: 0.8 }
});
const { scene } = stage;
const sky = addSky(stage, { elevation: 60, azimuth: 180, sunIntensity: 3.0, shadowSize: 16 });
sky.sun.shadow.camera.far = 160;
const ground = makeGround({ size: 260, type: 'sand', repeat: [70, 70] }); scene.add(ground);
const legend = document.createElement('div'); legend.className = 'stage-legend'; stage.el.appendChild(legend);

/* ------------------------------------------------------------------ materials */
const cultureMat = new THREE.MeshPhysicalMaterial({ color: 0x2f7d3a, roughness: 0.4, clearcoat: 0.1, specularIntensity: 0.4, envMapIntensity: 0.5, transparent: true, opacity: 0.95, emissive: 0x0b2a10, emissiveIntensity: 1 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xf4fbff, roughness: 0.05, transparent: true, opacity: 0.08, depthWrite: false, envMapIntensity: 0.6, clearcoat: 0.5, clearcoatRoughness: 0.05, side: THREE.DoubleSide });
const waveN = surfaceTextures({ key: 'pbr-wave', size: 256, scale: 5, octaves: 4, palette: ['#888', '#999'], normalStrength: 1.4 }).normal.clone(); waveN.wrapS = waveN.wrapT = THREE.RepeatWrapping; waveN.repeat.set(6, 6); waveN.needsUpdate = true;
const pondMat = new THREE.MeshPhysicalMaterial({ color: 0x1f6f63, roughness: 0.2, clearcoat: 0.25, clearcoatRoughness: 0.15, envMapIntensity: 0.6, specularIntensity: 0.35, normalMap: waveN, normalScale: new THREE.Vector2(0.45, 0.45), transparent: true, opacity: 0.94 });
const matSteel = M.galvanised(), matPipe = M.pvc(), matBlack = M.plasticBlack(), matConc = surfaceMaterial('concrete', [6, 1]);
const matPaint = M.paintedSteel(0x3d6f8f);

/* ------------------------------------------------------------------ cross-section textures (light inside the culture) */
const secCanvas = document.createElement('canvas'); secCanvas.width = 256; secCanvas.height = 256;
const secTex = new THREE.CanvasTexture(secCanvas); secTex.colorSpace = THREE.SRGBColorSpace;
const secMat = new THREE.MeshBasicMaterial({ map: secTex, transparent: true, toneMapped: false, side: THREE.DoubleSide });
const boardCanvas = document.createElement('canvas'); boardCanvas.width = 256; boardCanvas.height = 256;
const boardTex = new THREE.CanvasTexture(boardCanvas); boardTex.colorSpace = THREE.SRGBColorSpace;
const boardMat = new THREE.MeshBasicMaterial({ map: boardTex, transparent: true, toneMapped: false, side: THREE.DoubleSide });
function drawSection(kind, I0, X, s, g) {
  const ctx = secCanvas.getContext('2d'); const W = 256, H = 256; const img = ctx.createImageData(W, H);
  const k = s.ka * X * 1000; const Imax = Math.max(1, I0);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const q = (j * W + i) * 4; let I = -1;
    if (kind === 'tube') { const x = (i + 0.5) / W * 2 - 1, y = 1 - (j + 0.5) / H * 2; if (x * x + y * y <= 1) { const top = Math.sqrt(1 - x * x); I = I0 * Math.exp(-k * g.R * (top - y)); } }
    else if (kind === 'panel') { const z = (i + 0.5) / W * g.L; I = I0 * (Math.exp(-k * z) + Math.exp(-k * (g.L - z))); }
    else { const z = (j + 0.5) / H * g.L; I = I0 * Math.exp(-k * z); }
    if (I < 0) { img.data[q + 3] = 0; continue; }
    const c = colormap('inferno', Math.pow(clamp(I / Imax, 0, 1), 0.5));
    img.data[q] = c[0]; img.data[q + 1] = c[1]; img.data[q + 2] = c[2]; img.data[q + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); secTex.needsUpdate = true;
  // board copy with scale ticks, so that the magnified boards can be read
  const b = boardCanvas.getContext('2d'); b.clearRect(0, 0, W, H); b.drawImage(secCanvas, 0, 0);
  b.fillStyle = 'rgba(255,255,255,0.92)'; b.strokeStyle = 'rgba(255,255,255,0.92)'; b.lineWidth = 2; b.font = '600 15px Inter, sans-serif';
  if (kind === 'slab') {
    const Lcm = g.L * 100, step = Lcm <= 12 ? 2 : 5;
    for (let c = 0; c <= Lcm + 1e-6; c += step) { const y = Math.min(H - 2, Math.max(2, c / Lcm * H)); b.beginPath(); b.moveTo(0, y); b.lineTo(18, y); b.stroke(); b.fillText(`${c} cm`, 22, Math.min(H - 4, Math.max(14, y + 5))); }
  } else if (kind === 'panel') {
    const Lmm = g.L * 1000; b.textAlign = 'center';
    [0, 0.5, 1].forEach(f => { const x = Math.min(W - 2, Math.max(2, f * W)); b.beginPath(); b.moveTo(x, H); b.lineTo(x, H - 16); b.stroke(); b.fillText(f === 0.5 ? 'centre' : f ? `${fmt(Lmm, 0)} mm` : '0', Math.min(W - 30, Math.max(18, x)), H - 22); });
    b.textAlign = 'left';
  }
  boardTex.needsUpdate = true;
  legend.innerHTML = `PPFD inside the culture (µmol m⁻² s⁻¹)<div class="cbar" style="background:${colormapGradient('inferno')}"></div><div class="cbar-ticks"><span>0</span><span>${fmt(Imax / 4, 0)}</span><span>${fmt(Imax, 0)}</span></div><div style="opacity:.7;margin-top:2px">square-root colour scale</div>`;
}

/* ------------------------------------------------------------------ helpers */
const root = new THREE.Group(); scene.add(root);
const labelObjs = []; let pickables = [], parts = null, builtKey = null;
function label(obj, html, offset = [0, 0, 0]) { const l = stage.addLabel(obj, html, { offset }); labelObjs.push(l); l.visible = !!ui.get('labels'); return l; }
const cyl = (rt, rb, h, mat, seg = 24, open = false) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), mat);
const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
const shadowAll = o => o.traverse(m => { if (m.isMesh && !m.material.transparent) { m.castShadow = true; m.receiveShadow = true; } });
function tag(o, comp) { o.traverse(m => { m.userData.comp = comp; }); pickables.push(o); }
function clearScene() { labelObjs.forEach(l => { l.parent && l.parent.remove(l); l.element && l.element.remove(); }); labelObjs.length = 0; root.children.slice().forEach(c => { root.remove(c); disposeDeep(c); }); pickables = []; }
/** Info board that displays the cross-section texture (magnified). */
function sectionBoard(w, h, kind) {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new RoundedBoxGeometry(w + 0.16, h + 0.16, 0.05, 2, 0.02), M.plastic(0x23272b, 0.5)); g.add(frame);
  const face = new THREE.Mesh(kind === 'tube' ? new THREE.CircleGeometry(Math.min(w, h) / 2, 64) : new THREE.PlaneGeometry(w, h), boardMat); face.position.z = 0.03; g.add(face);
  if (kind === 'tube') { const rim = new THREE.Mesh(new THREE.TorusGeometry(Math.min(w, h) / 2, 0.018, 12, 64), glassMat); rim.position.z = 0.035; g.add(rim); }
  const leg = cyl(0.03, 0.03, 1.0, matSteel, 12); leg.position.y = -h / 2 - 0.55; g.add(leg);
  const foot = box(0.5, 0.04, 0.3, matSteel); foot.position.y = -h / 2 - 1.05; g.add(foot);
  shadowAll(g); return g;
}

/* ------------------------------------------------------------------ system builders */
function buildRaceway(p) {
  const P = {}; const Ls = 16, wc = 2.4, dv = 0.2, Rout = wc + dv / 2, wallH = 0.5, wallT = 0.15;
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(Ls + 2 * Rout + 3, 2 * Rout + 3), surfaceMaterial('concrete', [8, 3])); pad.rotation.x = -Math.PI / 2; pad.position.y = 0.003; pad.receiveShadow = true; root.add(pad);
  const stadium = (R, L) => { const s = new THREE.Shape(); s.moveTo(-L / 2, -R); s.lineTo(L / 2, -R); s.absarc(L / 2, 0, R, -Math.PI / 2, Math.PI / 2, false); s.lineTo(-L / 2, R); s.absarc(-L / 2, 0, R, Math.PI / 2, Math.PI * 1.5, false); return s; };
  const flat = geo => { geo.rotateX(-Math.PI / 2); return geo; };                       // shape (x, y) → world (x, −y) plane, extrusion → +y
  // walls from pieces: two semicircular ends, far straight wall, near straight wall (with a cut-away window)
  const walls = new THREE.Group(); root.add(walls);
  [1, -1].forEach(side => {
    const sh = new THREE.Shape(); const a0 = side > 0 ? -Math.PI / 2 : Math.PI / 2, a1 = side > 0 ? Math.PI / 2 : Math.PI * 1.5;
    sh.absarc(0, 0, Rout + wallT, a0, a1, false); sh.absarc(0, 0, Rout, a1, a0, true);
    const m = new THREE.Mesh(flat(new THREE.ExtrudeGeometry(sh, { depth: wallH, bevelEnabled: false, curveSegments: 32 })), matConc); m.position.x = side * Ls / 2; walls.add(m);
  });
  const farW = box(Ls, wallH, wallT, matConc); farW.position.set(0, wallH / 2, -(Rout + wallT / 2)); walls.add(farW);
  const cut = !!ui.get('cut'), cx = 1.5, win = 4.0;
  if (cut) {
    const lenL = Ls / 2 + cx - win / 2, lenR = Ls / 2 - cx - win / 2;
    const wl = box(lenL, wallH, wallT, matConc); wl.position.set(-Ls / 2 + lenL / 2, wallH / 2, Rout + wallT / 2); walls.add(wl);
    const wr = box(lenR, wallH, wallT, matConc); wr.position.set(Ls / 2 - lenR / 2, wallH / 2, Rout + wallT / 2); walls.add(wr);
    const glassF = new THREE.Mesh(new THREE.PlaneGeometry(win, wallH), M.glassCheap(0.1)); glassF.position.set(cx, wallH / 2, Rout + 0.004); walls.add(glassF);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(win, p.depth), secMat); face.position.set(cx, p.depth / 2 + 0.012, Rout - 0.003); root.add(face); P.face = face;
    [cx - win / 2, cx + win / 2].forEach(x => { const edge = box(0.02, wallH, wallT + 0.01, matConc); edge.position.set(x, wallH / 2, Rout + wallT / 2); walls.add(edge); });
    P.board = sectionBoard(1.4, 1.0, 'slab'); P.board.position.set(cx - 5.2, 1.65, Rout + 2.4); P.board.rotation.y = 0.35; root.add(P.board);
    label(P.board, 'Light inside the pond<small>surface → bottom (depth stretched)</small>', [0, 0.72, 0]);
  } else { const nearW = box(Ls, wallH, wallT, matConc); nearW.position.set(0, wallH / 2, Rout + wallT / 2); walls.add(nearW); }
  const divS = stadium(dv / 2, Ls - 0.6);
  const div = new THREE.Mesh(flat(new THREE.ExtrudeGeometry(divS, { depth: wallH, bevelEnabled: false, curveSegments: 16 })), matConc); walls.add(div);
  shadowAll(walls);
  const floor = new THREE.Mesh(flat(new THREE.ShapeGeometry(stadium(Rout, Ls))), M.plastic(0x1c1f22, 0.8)); floor.position.y = 0.012; floor.receiveShadow = true; root.add(floor);
  // water surface (divider as a hole)
  const ws = stadium(Rout - 0.004, Ls); ws.holes.push(stadium(dv / 2 + 0.004, Ls - 0.6));
  const surf = new THREE.Mesh(flat(new THREE.ShapeGeometry(ws, 32)), pondMat); surf.position.y = p.depth; surf.receiveShadow = true; root.add(surf); P.surf = surf; tag(surf, 'culture');
  // paddlewheel in the far channel near the +x bend
  const pw = new THREE.Group(); pw.position.set(Ls / 2 - 2.2, p.depth + 0.2, -(dv / 2 + wc / 2)); root.add(pw); P.pw = pw;
  const shaft = cyl(0.05, 0.05, wc + 0.5, matSteel, 16); shaft.rotation.x = Math.PI / 2; pw.add(shaft);
  const wheel = new THREE.Group(); pw.add(wheel); P.wheel = wheel;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    const blade = box(0.02, 0.4, wc - 0.12, M.paintedSteel(0xd8d8d0)); blade.position.set(Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0); blade.rotation.z = a + Math.PI / 2; wheel.add(blade);
    [-(wc / 2 - 0.12), 0, wc / 2 - 0.12].forEach(z => { const arm = box(0.035, 0.6, 0.035, matSteel); arm.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, z); arm.rotation.z = a - Math.PI / 2; wheel.add(arm); });
  }
  [-1, 1].forEach(sgn => { const brg = box(0.3, 0.5, 0.22, matSteel); brg.position.set(0, -0.02, sgn * (wc / 2 + 0.13)); pw.add(brg); });
  const motor = new THREE.Group(); motor.position.set(0, 0.05, wc / 2 + 0.52); pw.add(motor);
  const mb = cyl(0.14, 0.14, 0.45, matPaint, 24); mb.rotation.x = Math.PI / 2; mb.position.z = 0.2; motor.add(mb); const gbx = box(0.35, 0.32, 0.3, matPaint); motor.add(gbx);
  shadowAll(pw); tag(pw, 'paddlewheel');
  // flow tracers on the surface (closed loop around the divider)
  const pts = []; const rC = dv / 2 + wc / 2, yS = p.depth + 0.012;
  for (let i = 0; i < 64; i++) pts.push(new THREE.Vector3(-Ls / 2 + i / 64 * Ls, yS, -rC));
  for (let i = 0; i < 24; i++) { const a = -Math.PI / 2 + i / 24 * Math.PI; pts.push(new THREE.Vector3(Ls / 2 + Math.cos(a) * rC, yS, Math.sin(a) * rC)); }
  for (let i = 0; i < 64; i++) pts.push(new THREE.Vector3(Ls / 2 - i / 64 * Ls, yS, rC));
  for (let i = 0; i < 24; i++) { const a = Math.PI / 2 + i / 24 * Math.PI; pts.push(new THREE.Vector3(-Ls / 2 + Math.cos(a) * rC, yS, Math.sin(a) * rC)); }
  const curve = new THREE.CatmullRomCurve3(pts, true);
  P.flow = new FlowAlong(curve, { count: 420, speed: p.u, size: 0.09, color: 0xe9f5e0, jitter: 1.5, opacity: 0.5 }); P.flow.points.material.blending = THREE.NormalBlending; root.add(P.flow.points);
  // neighbouring ponds for context
  [[-3, -12.5], [18, -12.5]].forEach(([x, z]) => {
    const far = new THREE.Group(); far.position.set(x, 0, z); root.add(far);
    const ring = stadium(Rout + wallT, Ls); ring.holes.push(stadium(Rout, Ls));
    far.add(new THREE.Mesh(flat(new THREE.ExtrudeGeometry(ring, { depth: wallH, bevelEnabled: false, curveSegments: 24 })), matConc));
    const fs = new THREE.Mesh(flat(new THREE.ShapeGeometry(ws, 24)), pondMat); fs.position.y = p.depth; far.add(fs);
    far.add(new THREE.Mesh(flat(new THREE.ExtrudeGeometry(divS, { depth: wallH, bevelEnabled: false, curveSegments: 12 })), matConc));
    shadowAll(far);
  });
  label(pw, 'Paddlewheel<small>—</small>', [0, 0.9, 0]); P.lblMix = labelObjs[labelObjs.length - 1];
  label(surf, 'Culture<small>—</small>', [-4, 0.45, 0]); P.lblCul = labelObjs[labelObjs.length - 1];
  fitShadow(sky.sun, 16, [0, 0, 0]);
  P.views = { home: [[10.5, 5.4, 11.5], [0.8, 0.2, 0.6]], close: [[4.6, 1.5, 6.2], [1.6, 0.15, 2.6]], section: [[-2.4, 1.9, 8.4], [-2.6, 1.2, 4.2]] };
  P.kind = 'slab';
  return P;
}

function buildPanels(p) {
  const P = {}; const W = 1.0, H = p.Hp, t = p.thick, rows = 3, cols = 4, gap = 0.08, frameH = H + 0.25, base = 0.35;
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(8, 3 * p.spacing + 4), surfaceMaterial('concrete', [4, 3])); pad.rotation.x = -Math.PI / 2; pad.position.y = 0.003; pad.receiveShadow = true; root.add(pad);
  const emitters = []; P.cultures = [];
  const rowZ = r => (r - (rows - 1) / 2) * p.spacing;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = (c - (cols - 1) / 2) * (W + gap), z = rowZ(r);
    const g = new THREE.Group(); g.position.set(x, base, z); root.add(g);
    const cutHere = ui.get('cut') && r === rows - 1 && c === cols - 1;
    const cult = box(W, H, t, cultureMat); cult.position.y = H / 2; g.add(cult); P.cultures.push(cult); tag(cult, 'culture');
    const wallA = box(W + 0.01, frameH, 0.006, glassMat); wallA.position.set(0, frameH / 2 - 0.05, t / 2 + 0.004); g.add(wallA);
    const wallB = wallA.clone(); wallB.position.z = -t / 2 - 0.004; g.add(wallB);
    [-1, 1].forEach(sx => { const post = box(0.05, frameH + base, 0.06 + t, matSteel); post.position.set(sx * (W / 2 + 0.03), (frameH + base) / 2 - base, 0); g.add(post); });
    const bottom = box(W + 0.1, 0.05, t + 0.06, matSteel); bottom.position.y = -0.03; g.add(bottom);
    const topRail = box(W + 0.1, 0.03, t + 0.06, matSteel); topRail.position.y = frameH - 0.05; g.add(topRail);
    for (let e = 0; e < 7; e++) emitters.push([x - W / 2 + (e + 0.5) * W / 7, base + 0.03, z]);
    if (cutHere) { const face = new THREE.Mesh(new THREE.PlaneGeometry(t, H), secMat); face.rotation.y = Math.PI / 2; face.position.set(W / 2 + 0.061, H / 2, 0); g.add(face); P.face = face; }
    shadowAll(g);
  }
  // air manifolds + blower
  for (let r = 0; r < rows; r++) { const z = rowZ(r); root.add(makePipe([[-(cols / 2) * (W + gap) - 0.4, 0.2, z + t / 2 + 0.06], [(cols / 2) * (W + gap), 0.2, z + t / 2 + 0.06]], { radius: 0.025, material: matPipe, tension: 0 })); }
  const blower = new THREE.Group(); blower.position.set(-(cols / 2) * (W + gap) - 0.9, 0, 0); root.add(blower);
  const bb = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.5, 0.5, 3, 0.03), matPaint); bb.position.y = 0.25; blower.add(bb);
  const bm = cyl(0.13, 0.13, 0.35, M.paintedSteel(0x55606a), 24); bm.rotation.z = Math.PI / 2; bm.position.set(0.1, 0.62, 0); blower.add(bm);
  shadowAll(blower); tag(blower, 'blower');
  P.bub = new Bubbles({ emitters, top: base + H - 0.02, max: 1600, size: 0.006, rate: 3, spread: Math.min(0.8 * t, 0.03), speed: 0.3 });
  root.add(P.bub.mesh);
  if (ui.get('cut')) { P.board = sectionBoard(0.9, 0.7, 'panel'); P.board.position.set(-3.1, 1.3, rowZ(rows - 1) + 1.5); P.board.rotation.y = 0.65; root.add(P.board); label(P.board, 'Light across the panel<small>face → centre → face (magnified)</small>', [0, 0.66, 0]); }
  label(blower, 'Air blower<small>—</small>', [0, 1.0, 0]); P.lblMix = labelObjs[labelObjs.length - 1];
  label(P.cultures[P.cultures.length - 1], 'Culture<small>—</small>', [0, H * 0.75, 0.3]); P.lblCul = labelObjs[labelObjs.length - 1];
  fitShadow(sky.sun, 7, [0, 0.8, 0]);
  P.views = { home: [[5.4, 2.4, 6.0], [-0.2, 1.0, 0]], close: [[2.8, 1.3, 2.3], [1.6, 1.0, rowZ(rows - 1)]], section: [[-1.0, 1.6, 3.9], [-3.1, 1.3, rowZ(rows - 1) + 1.5]] };
  P.kind = 'panel';
  return P;
}

function buildTubular(p) {
  const P = {}; const D = p.tubeD, s = Math.max(D * 1.05, p.tubeS), nRuns = Math.max(8, Math.min(40, Math.round(2.4 / s))), L = 9, y0 = 0.7;
  if (p.greenhouse) { const gh = makeGreenhouse({ spans: 2, spanWidth: 6.4, length: 14, gutterHeight: 3.2, roofAngle: 22, bays: 4, heatingPipes: false, glassOpacity: 0.07 }); root.add(gh); P.gh = gh; }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12.8, 14), surfaceMaterial('concrete', [6, 7])); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.004; floor.receiveShadow = true; root.add(floor);
  const white = new THREE.Mesh(new THREE.PlaneGeometry(L + 1, 2 * nRuns * s + 1.2), M.plastic(0xe8e8e2, 0.9)); white.rotation.x = -Math.PI / 2; white.position.set(0, 0.008, 0); white.receiveShadow = true; root.add(white);
  P.cultures = []; P.flows = [];
  const tubeGeo = new THREE.CylinderGeometry(D / 2 + 0.002, D / 2 + 0.002, L, 20, 1, true), cultGeo = new THREE.CylinderGeometry(D / 2 - 0.001, D / 2 - 0.001, L, 16, 1, true);
  const bendGlass = new THREE.TorusGeometry(s / 2, D / 2 + 0.002, 12, 16, Math.PI), bendCult = new THREE.TorusGeometry(s / 2, D / 2 - 0.001, 10, 16, Math.PI);
  [-1, 1].forEach((side, li) => {
    const xOff = side * (nRuns * s / 2 + 0.35);
    const loop = new THREE.Group(); loop.position.set(xOff, y0, 0); root.add(loop);
    const glassI = new THREE.InstancedMesh(tubeGeo, glassMat, nRuns), cultI = new THREE.InstancedMesh(cultGeo, cultureMat, nRuns);
    const bG = new THREE.InstancedMesh(bendGlass, glassMat, nRuns), bC = new THREE.InstancedMesh(bendCult, cultureMat, nRuns);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    const pts = [];
    for (let i = 0; i < nRuns; i++) {
      const x = side * ((nRuns - 1) / 2 - i) * s;                              // run 0 on the outer side, next to the degasser
      q.setFromEuler(e.set(Math.PI / 2, 0, 0)); m4.compose(new THREE.Vector3(x, 0, 0), q, one); glassI.setMatrixAt(i, m4); cultI.setMatrixAt(i, m4);
      const endZ = i % 2 === 0 ? L / 2 : -L / 2;
      if (i < nRuns - 1) { q.setFromEuler(e.set(Math.PI / 2, 0, endZ > 0 ? 0 : Math.PI)); m4.compose(new THREE.Vector3(x - side * s / 2, 0, endZ), q, one); bG.setMatrixAt(i, m4); bC.setMatrixAt(i, m4); }
      pts.push(new THREE.Vector3(x, 0, i % 2 === 0 ? -L / 2 : L / 2), new THREE.Vector3(x, 0, endZ));
    }
    bG.count = bC.count = nRuns - 1;
    loop.add(cultI, glassI, bC, bG); P.cultures.push(cultI, bC); tag(cultI, 'culture'); tag(glassI, 'culture');
    // supports every 1.5 m
    for (let zz = -L / 2 + 0.3; zz <= L / 2; zz += 1.5) { const bar = box(nRuns * s + 0.2, 0.03, 0.05, matSteel); bar.position.set(0, -D / 2 - 0.02, zz); loop.add(bar); [-1, 1].forEach(sx => { const lg = box(0.04, y0, 0.04, matSteel); lg.position.set(sx * (nRuns * s / 2 + 0.08), -D / 2 - y0 / 2, zz); loop.add(lg); }); }
    // flow tracers through the whole serpentine
    const curve = new THREE.CatmullRomCurve3(pts.map(v => v.clone().add(loop.position)), false, 'catmullrom', 0.05);
    const fa = new FlowAlong(curve, { count: 900, speed: p.u, size: Math.max(0.012, D * 0.35), color: 0xf2ffe8, jitter: D * 0.5, opacity: 0.6 }); fa.points.material.blending = THREE.NormalBlending; root.add(fa.points); P.flows.push(fa);
    // degasser column + pump at the loop inlet
    const dg = new THREE.Group(); dg.position.set(xOff + side * (nRuns * s / 2 + 0.7), 0, -L / 2 - 0.6); root.add(dg);
    const col = cyl(0.2, 0.2, 2.4, M.glassCheap(0.15), 32, true); col.position.y = 1.2 + 0.25; dg.add(col);
    const colC = cyl(0.19, 0.19, 2.2, cultureMat, 32); colC.position.y = 1.1 + 0.25; dg.add(colC); P.cultures.push(colC);
    const cap = cyl(0.23, 0.23, 0.06, matSteel, 32); cap.position.y = 2.68; dg.add(cap); const bs = cyl(0.24, 0.26, 0.25, matSteel, 32); bs.position.y = 0.125; dg.add(bs);
    const pump = new THREE.Group(); pump.position.set(-side * 0.6, 0, 0.1); dg.add(pump);
    const vol = cyl(0.16, 0.16, 0.12, M.plastic(0x2f5f8f, 0.4), 24); vol.rotation.x = Math.PI / 2; vol.position.y = 0.28; pump.add(vol);
    const mot = cyl(0.11, 0.11, 0.35, matPaint, 24); mot.rotation.x = Math.PI / 2; mot.position.set(0, 0.28, -0.26); pump.add(mot);
    const pb = box(0.4, 0.08, 0.7, matSteel); pb.position.set(0, 0.04, -0.1); pump.add(pb);
    shadowAll(dg); tag(dg, li ? 'degasser' : 'degasser'); tag(pump, 'pump');
    // pump → first run (inlet) and last run (outlet) → top of the degasser
    const xIn = loop.position.x + side * (nRuns - 1) / 2 * s, xOut = loop.position.x - side * (nRuns - 1) / 2 * s;
    const zOut = (nRuns - 1) % 2 === 0 ? L / 2 : -L / 2;
    root.add(makePipe([[dg.position.x - side * 0.6, 0.28, dg.position.z + 0.3], [dg.position.x - side * 0.6, 0.4, -L / 2 - 0.35], [xIn, y0, -L / 2 - 0.3], [xIn, y0, -L / 2 + 0.02]], { radius: Math.max(0.025, D * 0.55), material: matPipe, tension: 0.15 }));
    root.add(makePipe([[xOut, y0, zOut + Math.sign(zOut) * 0.02], [xOut, y0 + 0.15, zOut + Math.sign(zOut) * 0.45], [xOut, 2.9, zOut + Math.sign(zOut) * 0.5], [dg.position.x, 2.9, dg.position.z + 0.1], [dg.position.x, 2.72, dg.position.z]], { radius: Math.max(0.025, D * 0.55), material: matPipe, tension: 0.1 }));
    if (li === 0) {
      const b = new Bubbles({ emitters: [[0, 0.35, 0], [0.06, 0.35, 0.04], [-0.05, 0.35, -0.05]], top: 2.33, max: 260, size: 0.012, rate: 30, spread: 0.2, speed: 0.4 });
      dg.add(b.mesh); P.bub = b;
      label(dg, 'Degasser<small>—</small>', [0, 2.95, 0]); P.lblGas = labelObjs[labelObjs.length - 1];
      label(pump, 'Circulation pump<small>—</small>', [0, 0.65, 0]); P.lblMix = labelObjs[labelObjs.length - 1];
    }
    if (li === 1) { label(loop, 'Solar receiver<small>—</small>', [0, 0.45, L / 2 - 1]); P.lblCul = labelObjs[labelObjs.length - 1]; }
  });
  if (ui.get('cut')) { P.board = sectionBoard(0.9, 0.9, 'tube'); P.board.position.set(4.4, 1.45, L / 2 + 0.2); P.board.rotation.y = -0.6; root.add(P.board); label(P.board, 'Light inside one tube<small>cross-section (magnified)</small>', [0, 0.7, 0]); }
  fitShadow(sky.sun, 10, [0, 0.5, 0]);
  P.views = { home: [[5.2, 2.9, 8.6], [0.2, 0.7, 1.2]], close: [[1.3, 1.15, 5.9], [0.3, 0.72, 3.8]], section: [[5.7, 1.7, 7.3], [4.4, 1.45, 4.7]] };
  P.kind = 'tube';
  return P;
}

function rebuildIfNeeded(force) {
  const p = params();
  const key = [p.system, p.cut, p.system === 'raceway' ? p.depth : '', p.system === 'panel' ? [p.thick, p.spacing].join() : '', p.system === 'tubular' ? [p.tubeD, p.tubeS, p.greenhouse].join() : ''].join('|');
  if (key === builtKey && !force) return;
  const sysChanged = !builtKey || builtKey.split('|')[0] !== p.system;
  clearScene();
  parts = p.system === 'raceway' ? buildRaceway(p) : p.system === 'panel' ? buildPanels(p) : buildTubular(p);
  builtKey = key;
  const v = parts.views.home; stage.setHome(v[0], v[1]);
  if (sysChanged) { stage.camera.position.set(...v[0]); stage.controls.target.set(...v[1]); stage.controls.update(); }
  lastSection = 0; updateScene(0, true);
}
function fly(k) { const v = parts.views[k] || parts.views.home; stage.flyTo(v[0], v[1], 1.3); }

/* ------------------------------------------------------------------ picking */
const inspector = document.createElement('div'); inspector.className = 'stage-legend'; inspector.style.cssText = 'max-width:320px;display:none;left:auto;right:12px;bottom:56px;line-height:1.5'; stage.el.appendChild(inspector);
const INFO = {
  culture: ['Algal culture', 'Colour and opacity follow the optical depth k_a·X·L: a dilute culture is pale and translucent, a dense one dark and opaque.'],
  paddlewheel: ['Paddlewheel', 'Keeps the culture circulating at 0.2–0.3 m s⁻¹ so that cells move between the lit surface and the dark bottom and do not settle.'],
  blower: ['Air blower', 'Bubbles rising in each panel mix the culture (airlift) and strip the O₂ produced by photosynthesis.'],
  degasser: ['Degasser (airlift column)', 'Air bubbles strip O₂ from the culture before it returns to the solar receiver; CO₂ is added here.'],
  pump: ['Circulation pump', 'Drives the culture through the tubes; the pressure drop follows the Darcy–Weisbach equation (Eq. P11).']
};
let inspected = null;
stage.onPick({ objects: () => pickables, onClick: hit => { if (!hit) { inspected = null; inspector.style.display = 'none'; return; } let o = hit.object; while (o && !o.userData.comp) o = o.parent; if (!o) return; inspected = o.userData.comp; inspector.style.display = ''; updateInspector(); } });
function updateInspector() {
  if (!inspected) return; const i = INFO[inspected] || [inspected, '']; const d = cul.diag, p = cul.p, mix = mixingPower(p);
  let live = '';
  if (inspected === 'culture') live = `X ${fmt(cul.X, 2)} g L⁻¹ · optical depth ${fmt(d.s.ka * cul.X * 1000 * d.g.L, 1)} · µ̄ ${fmt(d.net, 3)} d⁻¹`;
  else live = `${fmt(mix.PV, 1)} W m⁻³ · ${fmt(mix.PA, 2)} W m⁻² (electrical)`;
  inspector.innerHTML = `<b>${i[0]}</b><br>${i[1]}<br><span style="color:#9be7b6">${live}</span><br><span style="opacity:.6">click empty space to close</span>`;
}

/* ------------------------------------------------------------------ scene update */
const tmpC = new THREE.Color(), cA = new THREE.Color(), cB = new THREE.Color(), cC = new THREE.Color();
let lastSun = -1, lastSection = 0, lastLbl = 0;
function cultureColour(s, OD) {
  cA.set(s.colors[0]); cB.set(s.colors[1]); cC.set(s.colors[2]);
  const t = clamp(Math.log10(1 + OD) / Math.log10(1 + 25), 0, 1);
  return t < 0.5 ? tmpC.copy(cA).lerp(cB, t * 2) : tmpC.copy(cB).lerp(cC, (t - 0.5) * 2);
}
function updateScene(dt, force) {
  if (!parts) return;
  const p = cul.p, d = cul.diag, s = d.s, g = d.g;
  const OD = s.ka * cul.X * 1000 * g.L;
  const col = cultureColour(s, OD);
  cultureMat.color.copy(col); cultureMat.emissive.copy(col).multiplyScalar(0.08 * clamp(d.Ig / 1500, 0.1, 1));
  cultureMat.opacity = clamp(0.62 + 0.38 * (1 - Math.exp(-OD / 1.5)), 0.62, 1);
  pondMat.color.copy(col); pondMat.opacity = clamp(0.8 + 0.2 * (1 - Math.exp(-OD / 3)), 0.8, 1);
  waveN.offset.x += dt * 0.04 * p.u; waveN.offset.y += dt * 0.01;
  if (parts.wheel) parts.wheel.rotation.z -= dt * p.u / 0.36 * (clock.running ? 1 : 0.5);
  if (parts.flow) { parts.flow.speed = p.u * 1.2; parts.flow.update(dt); }
  if (parts.flows) parts.flows.forEach(f => { f.speed = p.u; f.update(dt); });
  if (parts.bub) { parts.bub.setRate(p.system === 'panel' ? 1 + 6 * p.vvm : 25); parts.bub.update(Math.min(dt, 0.05)); }
  // sun
  const now = performance.now();
  if (force || now - lastSun > 400) {
    lastSun = now;
    let el = 55, az = 180;
    if (p.light === 'sun') { const hour = ((cul.t % 1) + 1) % 1 * 24, doy = Math.round(p.doy + Math.floor(cul.t)) % 365 || 365; el = deg(solarElevation(p.lat, doy, hour)); az = deg(solarAzimuth(p.lat, doy, hour)); }
    sky.setSun(Math.max(-8, el), az);
    if (p.light === 'const') stage.renderer.toneMappingExposure = 0.5;
  }
  if (force || now - lastSection > 600) {
    lastSection = now;
    const I0 = Math.max(d.I0, p.light === 'sun' ? 1 : d.I0);
    drawSection(parts.kind === 'tube' ? 'tube' : parts.kind === 'panel' ? 'panel' : 'slab', I0, cul.X, s, g);
    legend.style.display = ui.get('cut') ? '' : 'none';
  }
  if (force || now - lastLbl > 300) {
    lastLbl = now; const mix = mixingPower(p);
    const set = (l, h) => { if (l) l.element.innerHTML = h; };
    set(parts.lblCul, `${parts.kind === 'tube' ? 'Solar receiver' : 'Culture'}<small>${STRAINS[p.strain].short} · ${fmt(cul.X, 2)} g L⁻¹ · OD ${fmt(OD, 1)}</small>`);
    set(parts.lblMix, `${p.system === 'raceway' ? 'Paddlewheel' : p.system === 'panel' ? 'Air blower' : 'Circulation pump'}<small>${fmt(mix.PV, 1)} W m⁻³ · ${fmt(mix.PA, 2)} W m⁻²</small>`);
    if (p.system === 'tubular') set(parts.lblGas, `Degasser<small>DO at receiver outlet ${fmt(o2Buildup().pct, 0)} % air sat.</small>`);
    updateInspector();
  }
}
/** O₂ accumulation along the tubes (Eq. P12): % of air saturation at the end of the loop. */
function o2Buildup() {
  const p = cul.p, d = cul.diag; const Csat = doSaturation(p.T, p.strain === 'nanno' ? 35 : 0);            // mg L⁻¹ = g m⁻³
  const rO2 = Y_O2 * Math.max(0, d.gross) * cul.X * 1000 / 86400;                                      // g m⁻³ s⁻¹ (gross O₂ evolution)
  const dC = rO2 * p.loopL / p.u; return { dC, pct: 100 * (Csat + dC) / Csat, Csat, tres: p.loopL / p.u };
}

/* ================================================================== charts */
const chProf = new Plot('#chart-profile', { x: { label: 'Distance into the culture', unit: 'mm', min: 0 }, y: { label: 'PPFD', unit: 'µmol m⁻² s⁻¹', min: 0 }, y2: { label: 'Local net growth rate', unit: 'd⁻¹' } });
const chDil = new Plot('#chart-dilution', { x: { label: 'Dilution rate D', unit: 'd⁻¹', min: 0 }, y: { label: 'Volumetric productivity', unit: 'g L⁻¹ d⁻¹', min: 0 }, y2: { label: 'Areal productivity', unit: 'g m⁻² d⁻¹', min: 0 } });
const chTime = new Plot('#chart-time', { x: { label: 'Time', unit: 'd', min: 0 }, y: { label: 'Biomass X', unit: 'g L⁻¹', min: 0 }, y2: { label: 'PPFD on the ground', unit: 'µmol m⁻² s⁻¹', min: 0 } });
const chPE = new Plot('#chart-pe', { x: { label: 'Constant PPFD (horizontal)', unit: 'µmol m⁻² s⁻¹', min: 0, max: 2000 }, y: { label: 'Photosynthetic efficiency', unit: '% of PAR', min: 0 } });

let hist; function newHist() { hist = { t: [], X: [], Ig: [], mu: [], PA: [], PE: [] }; } newHist();
let nextSample = 0;
function sample() { const st = cul.lastDayStats(); hist.t.push(cul.t); hist.X.push(cul.X); hist.Ig.push(cul.diag.Ig); hist.mu.push(cul.diag.net); hist.PA.push(st ? st.PA : NaN); hist.PE.push(st ? st.PE : NaN); }
function updateProfileChart() {
  const p = cul.p, d = cul.diag, s = d.s, g = d.g, phi = ctmi(p.T, s);
  let pr;
  if (g.kind === 'tube') { const k = s.ka * cul.X * 1000; pr = []; for (let i = 0; i <= 80; i++) { const z = g.L * i / 80; pr.push({ z, I: d.I0 * Math.exp(-k * z) }); } }
  else pr = profile(d.I0, cul.X, p, s, 80, g);
  const zs = pr.map(o => o.z * 1000), Is = pr.map(o => o.I), mus = pr.map(o => muLight(o.I, s) * phi - s.r);
  chProf.setAxis('x', { min: 0, max: g.L * 1000, label: g.kind === 'tube' ? 'Depth along the vertical diameter' : g.kind === 'panel' ? 'Position across the panel' : 'Depth below the surface' });
  chProf.line('I', zs, Is, { color: 'amber', width: 2.6, label: 'PPFD I(z)', fill: 0.12 });
  chProf.line('mu', zs, mus, { color: 'accent', width: 2.2, label: 'net µ(z) = µ(I)·φ(T) − r', y2: true });
  chProf.hline('zero', 0, { color: 'muted', dash: [2, 3], y2: true, label: '' });
  const inhib = Is.some(v => v > s.Iopt); if (inhib) chProf.hline('iopt', s.Iopt, { color: 'magenta', dash: [5, 4], label: 'I_opt: photoinhibition above' }); else chProf.remove('iopt');
}
let sweepT = null, sweepRun = 0;
function scheduleSweeps() { clearTimeout(sweepT); sweepT = setTimeout(runSweeps, 250); }
function runSweeps() {
  const p = cul.p, run = ++sweepRun;
  // productivity vs dilution rate
  const s = cul.strain(); const Dmax = Math.max(0.2, s.muMax * ctmi(p.T, s) - s.r) * 1.05;
  let rows;
  if (p.light === 'const') { rows = steadyConst(p, p.I0const).filter(r => r.D > 0).sort((a, b) => a.D - b.D); }
  else { const Ds = linspace(0.02, Math.max(0.1, Dmax), 16); rows = steadySun(p, Ds, 14); }
  if (run !== sweepRun) return;
  const best = rows.reduce((a, b) => (b.PV > a.PV ? b : a), rows[0] || { D: 0, PV: 0, PA: 0 });
  const pmax = Math.max(1e-9, ...rows.map(r => r.PV)); const dEnd = rows.filter(r => r.PV > 0.01 * pmax).reduce((a, r) => Math.max(a, r.D), 0.1);
  chDil.setAxis('x', { min: 0, max: Math.min(Math.max(0.1, Dmax), dEnd * 1.2 + 0.05) });
  chDil.line('pv', rows.map(r => r.D), rows.map(r => r.PV), { color: 'accent', width: 2.6, label: 'Volumetric' });
  chDil.line('pa', rows.map(r => r.D), rows.map(r => r.PA), { color: 'magenta', width: 2.2, dash: [6, 4], label: 'Areal', y2: true });
  if (best) chDil.vline('best', best.D, { color: 'accent', label: `optimum ${fmt(best.D, 2)} d⁻¹ · X̄ ${fmt(best.X, 2)} g L⁻¹` });
  if (p.mode === 'cont') chDil.vline('now', p.D, { color: 'magenta', label: 'current D', dash: [2, 3] }); else chDil.remove('now');
  optimum = best;
  // photosynthetic efficiency vs light, optimal density, for all three systems (constant light)
  const Is = linspace(50, 2000, 24);
  const sysList = [['raceway', 'water', 'Raceway'], ['panel', 'magenta', 'Flat panel'], ['tubular', 'accent', 'Tubular']];
  sysList.forEach(([sys, colr, lab]) => {
    const q = Object.assign({}, p, { system: sys });
    const pe = Is.map(I => { const r = steadyConst(q, I, 50); const b = r.reduce((a, c) => c.PA > a.PA ? c : a, r[0]); return b.PA > 0 ? b.PA * E_BIOMASS / (I * 0.0864 / PAR_UMOL_PER_J * 1e3) * 100 : 0; });
    chPE.line(sys, Is, pe, { color: colr, width: sys === p.system ? 3 : 1.6, dash: sys === p.system ? null : [5, 4], label: lab + (sys === p.system ? ' (current)' : '') });
  });
  updatePEpoint();
}
let optimum = null;
function updatePEpoint() { const st = cul.lastDayStats(); if (st && st.photons > 0 && cul.t >= 1) { const meanI = st.photons / 0.0864; chPE.point('now', meanI, st.PE, { color: 'danger', r: 5, label: 'this run, last 24 h' }); } else chPE.remove('now'); }
function updateTimeChart() {
  chTime.line('X', hist.t, hist.X, { color: 'accent', width: 2.6, label: 'Biomass X' });
  chTime.line('I', hist.t, hist.Ig, { color: 'amber', width: 1.2, label: 'PPFD', y2: true, opacity: 0.7 });
  chTime.setAxis('x', { min: 0, max: Math.max(2, Math.ceil(cul.t)) });
}

/* ================================================================== readouts */
function updateReadouts() {
  const p = cul.p, d = cul.diag, s = d.s, g = d.g, st = cul.lastDayStats(), mix = mixingPower(p);
  const k = s.ka * cul.X * 1000;
  ro.set('X', cul.X, null, p.mode === 'cont' ? `harvest ${fmt(p.D * cul.X, 3)} g L⁻¹ d⁻¹` : 'batch');
  ro.set('I0', d.I0, null, p.light === 'sun' ? `ground ${fmt(d.Ig, 0)} · ${fmtClock(cul.t)}` : 'constant');
  const back = g.kind === 'panel' ? 2 * Math.exp(-k * g.L / 2) / (1 + Math.exp(-k * g.L)) * 100 : 100 * Math.exp(-k * g.L);
  ro.set('back', back, back > 20 ? 'warn' : back < 0.01 ? 'warn' : 'ok', back > 20 ? 'light passes through — dilute culture' : back < 0.01 ? 'deep dark zone' : g.kind === 'panel' ? 'at the centre plane' : '');
  // photic fraction: share of the light path where local net growth > 0
  const pr = profile(d.I0, cul.X, p, s, 100, g); const phi = d.phi; const frac = pr.filter(o => muLight(o.I, s) * phi > s.r).length / pr.length * 100;
  ro.set('photic', d.I0 > 0 ? frac : 0, null, d.I0 > 0 ? `compensation point µ(I)φ = r` : 'night — respiration only');
  ro.set('mu', d.net, d.net < 0 ? 'warn' : 'ok', `gross ${fmt(d.gross, 3)} − respiration ${fmt(s.r, 3)}`);
  if (st) {
    ro.set('PV', st.PV, st.PV > 0 ? null : 'warn', optimum ? `steady-state optimum ${fmt(optimum.PV, 3)}` : '');
    ro.set('PA', st.PA, st.PA > 0 ? 'ok' : 'warn', `protein ≈ ${fmt(st.PA * s.protein, 1)} g m⁻² d⁻¹ (${s.proteinRange})`);
    ro.set('PE', st.PE, null, `yield on light ${fmt(st.yieldPh, 2)} g mol⁻¹ · ${fmt(st.photons, 1)} mol m⁻² d⁻¹`);
    ro.set('ekg', st.PA > 0.01 ? mix.PA * 24 / st.PA : NaN, st.PA > 0.01 && mix.PA * 24 / st.PA > 5.6 ? 'bad' : null, st.PA > 0.01 ? `biomass holds ≈ ${fmt(E_BIOMASS / 3.6, 1)} kWh kg⁻¹` : 'no net growth');
    ro.set('gas', Math.max(0, st.PA) * Y_O2, null, `CO₂ fixed ${fmt(Math.max(0, st.PA) * Y_CO2, 1)} g m⁻² d⁻¹`);
  }
  ro.set('mix', mix.PV, null, `${fmt(mix.PA, 2)} W m⁻² of ground` + (p.system === 'tubular' ? ` · Re ${fmt(mix.Re, 0)}` : p.system === 'panel' ? ` · U_G ${fmt(mix.UG * 1000, 1)} mm s⁻¹` : ''));
  ro.set('phi', d.phi, d.phi < 0.5 ? 'bad' : d.phi < 0.85 ? 'warn' : 'ok', `T_opt ${fmt(s.Topt, 1)} °C (${fmt(s.Tmin, 1)}–${fmt(s.Tmax, 1)})`);
  if (p.system === 'tubular') { const o = o2Buildup(); hud.set('o2', `DO at receiver end <b>${fmt(o.pct, 0)} %</b> air sat.`); } else hud.remove('o2');
  hud.set('t', `Day <b>${fmt(Math.floor(cul.t) + 1, 0)}</b> · ${fmtClock(cul.t)} · ${p.light === 'sun' ? SITES[p.site].label.split(',')[0] : 'constant light'}`);
  hud.set('x', `${STRAINS[p.strain].short} · X = <b>${fmt(cul.X, 2)} g L⁻¹</b> · PPFD <b>${fmt(d.I0, 0)}</b>`);
}
const fmtClock = t => { const h = ((t % 1) + 1) % 1 * 24; return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; };

/* ================================================================== time stepping */
const DT = 0.004;   // d (≈ 6 min)
function advance(dtD) { let rem = dtD; while (rem > 1e-12) { const h = Math.min(DT, rem); cul.step(h); rem -= h; if (cul.t >= nextSample) { sample(); nextSample = cul.t + 0.02; } } }
const clock = new SimClock({ speed: 1, maxDt: 0.05, onStep: dt => advance(dt) });
clock.speed = +ui.get('speed');
const playTool = stage.addTool ? stage.addTool({ icon: '▶', title: 'Run / pause the simulation (space bar)', onClick: () => clock.toggle() }) : null;
clock.onState(r => { playBtn.innerHTML = r ? '❚❚ Pause' : '▶ Run'; if (playTool) playTool.innerHTML = r ? '❚❚' : '▶'; });
stage.onKey('space', () => clock.toggle());
function restart() {
  clock.pause(); cul.setParams(params()); cul.reset(); newHist(); sample(); nextSample = 0.02;
  // start the day at 06:00 so that the first hours show sunrise
  if (cul.p.light === 'sun') { cul.t = 0.375; cul.log = []; cul.diag = cul.rates(); newHist(); sample(); nextSample = cul.t + 0.02; }
  updateTimeChart(); updateProfileChart(); updateReadouts(); updateScene(0, true); scheduleSweeps();
}
function syncEnabled() {
  const sys = ui.get('system'), sun = ui.get('light') === 'sun';
  ui.show('depth', sys === 'raceway'); ui.show('tubeD', sys === 'tubular'); ui.show('tubeS', sys === 'tubular'); ui.show('loopL', sys === 'tubular'); ui.show('greenhouse', sys === 'tubular');
  ui.show('thick', sys === 'panel'); ui.show('spacing', sys === 'panel'); ui.show('vvm', sys === 'panel'); ui.show('u', sys !== 'panel');
  ui.enable('site', sun); ui.enable('doy', sun); ui.enable('I0const', !sun); ui.enable('D', ui.get('mode') === 'cont');
}
ui.onChange((st, id) => {
  if (id === 'speed') { clock.speed = +st.speed; return; }
  if (id === 'labels') { labelObjs.forEach(l => l.visible = st.labels); return; }
  syncEnabled();
  if (applyingPreset) return;
  if (id === 'strain') { const s = STRAINS[st.strain]; ui.setMany({ T: s.Topt, Iopt: s.Iopt, ka: s.ka, resp: s.r }); return; }
  if (['system', 'cut', 'depth', 'thick', 'spacing', 'tubeD', 'tubeS', 'greenhouse'].includes(id)) rebuildIfNeeded();
  if (id === 'system' || id === 'mode' && cul.t < 0.3) { restart(); return; }
  cul.setParams(params()); cul.diag = cul.rates();
  updateProfileChart(); updateReadouts(); updateScene(0, true); scheduleSweeps();
});
function downloadHistory() { downloadCSV('photobioreactor-run.csv', ['time_d', 'X_gL', 'PPFD_ground', 'mu_net_d', 'PA_24h_gm2d', 'PE_24h_pct'], hist.t.map((t, i) => [+t.toFixed(4), +hist.X[i].toPrecision(5), +hist.Ig[i].toFixed(1), +hist.mu[i].toPrecision(4), isFinite(hist.PA[i]) ? +hist.PA[i].toPrecision(4) : '', isFinite(hist.PE[i]) ? +hist.PE[i].toPrecision(4) : ''])); }

/* ================================================================== go */
syncEnabled();
rebuildIfNeeded(true);
restart();
let lastUI = 0;
stage.onFrame(dt => {
  updateScene(dt, false);
  if (clock.running && performance.now() - lastUI > 220) { lastUI = performance.now(); updateTimeChart(); updateProfileChart(); updateReadouts(); updatePEpoint(); }
});
window.__pbr = { cul, run: d => { advance(d); updateTimeChart(); updateProfileChart(); updateReadouts(); updateScene(0.016, true); updatePEpoint(); } };
