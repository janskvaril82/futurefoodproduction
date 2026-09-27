/* ==========================================================================
   Sensor bench — 3D workbench, five sensors with cut-away internals and
   animated transduction physics. Driven entirely by the model state that
   main.js passes to bench.update(dt, t, st).
   ========================================================================== */
import { createStage, studioLights, THREE, M, makePipe, canvasTexture, RoundedBoxGeometry, surfaceMaterial, fbm2, noise2, rng, FlowAlong } from '/assets/js/lab3d.js';

const Y0 = 0.003;                       // top of the ESD mat (bench surface = 0)
const TAU = Math.PI * 2;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/* ------------------------------------------------------------------ materials */
const MAT = {};
function mats() {
  if (MAT.ready) return MAT;
  Object.assign(MAT, {
    ready: true,
    gold: new THREE.MeshStandardMaterial({ color: 0xe0b457, metalness: 1, roughness: 0.22 }),
    goldCavity: new THREE.MeshStandardMaterial({ color: 0xe6bb5c, metalness: 1, roughness: 0.16, side: THREE.DoubleSide }),
    tin: new THREE.MeshStandardMaterial({ color: 0xd3d6da, metalness: 1, roughness: 0.28 }),
    chip: new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.42, metalness: 0.05 }),
    chipMark: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6 }),
    headerPlastic: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.55 }),
    whitePlastic: new THREE.MeshPhysicalMaterial({ color: 0xf1efe8, roughness: 0.45, clearcoat: 0.2 }),
    ceramic: new THREE.MeshStandardMaterial({ color: 0xece8dc, roughness: 0.7 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.6 }),
    rubberBlack: new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.85 }),
    cable: new THREE.MeshPhysicalMaterial({ color: 0x141517, roughness: 0.35, clearcoat: 0.4, clearcoatRoughness: 0.4 }),
    steel: M.steel(), alu: M.aluminium(), anod: M.anodised(),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xeef6f8, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.03 }),
    water: new THREE.MeshPhysicalMaterial({ color: 0x8fc4d6, roughness: 0.05, transparent: true, opacity: 0.32, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.04, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
    epoxy: new THREE.MeshPhysicalMaterial({ color: 0xc98a2e, roughness: 0.3, transparent: true, opacity: 0.55, depthWrite: false, clearcoat: 0.6 }),
    polymer: new THREE.MeshPhysicalMaterial({ color: 0xe0a347, roughness: 0.35, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }),
    silicon: new THREE.MeshStandardMaterial({ color: 0x5a6070, metalness: 0.55, roughness: 0.3 }),
    diodeSi: new THREE.MeshPhysicalMaterial({ color: 0x1b2a5a, metalness: 0.3, roughness: 0.18, clearcoat: 1, iridescence: 0.6, iridescenceIOR: 1.6 }),
    filterGlass: new THREE.MeshPhysicalMaterial({ color: 0x5fb6a8, roughness: 0.05, transparent: true, opacity: 0.55, depthWrite: false, clearcoat: 1, iridescence: 0.4 }),
    diffuser: new THREE.MeshPhysicalMaterial({ color: 0xf6f5ef, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color(0xffffff), transparent: true, opacity: 1 }),
    hit: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
  });
  return MAT;
}
const wireMats = {};
function wireMat(c) { if (!wireMats[c]) wireMats[c] = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.35 }); return wireMats[c]; }
const pcbMat = (color, map) => new THREE.MeshPhysicalMaterial({ color: map ? 0xffffff : color, map: map || null, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.32 });

/* ------------------------------------------------------------------ geometry helpers */
const mesh = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; return m; };
const box = (w, h, d, mat, r = 0) => mesh(r > 0 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d), mat);
const cyl = (rt, rb, h, mat, seg = 24, open = false, ts = 0, tl = TAU) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, ts, tl), mat);
function at(o, x, y, z, parent) { o.position.set(x, y, z); if (parent) parent.add(o); return o; }
function softDot() { return canvasTexture(64, 64, (ctx, w) => { const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, w); }, { srgb: false, key: 'sb-softdot' }); }
/** Pool of coloured glowing points for particles. */
function pointPool(n, size = 0.0025, blending = THREE.AdditiveBlending) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3).fill(-9), col = new Float32Array(n * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size, map: softDot(), vertexColors: true, transparent: true, depthWrite: false, blending, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 5;
  return { pts, pos, col, n, dirty() { geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; } };
}
/** Jumper wire through points (Dupont housings are added separately). */
function wire(points, color, r = 0.00065) { return makePipe(points, { radius: r, material: wireMat(color), tension: 0.5, radial: 8 }); }
function dupont(parent, x, y, z, rotX = 0, rotZ = 0) { const h = box(0.0026, 0.0142, 0.0026, MAT.headerPlastic, 0.0003); h.rotation.set(rotX, 0, rotZ); return at(h, x, y + 0.0071, z, parent); }

/* ------------------------------------------------------------------ canvas painters */
function textFit(ctx, txt, x, y, font, color, align = 'left') { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(txt, x, y); }
function paintWood(ctx, w, h) {
  const img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    const plank = Math.floor(y / (h / 4)); const py = y - plank * h / 4;
    for (let x = 0; x < w; x++) {
      const n = fbm2(x * 0.0035 + plank * 7.1, y * 0.045 + plank * 3.3, 4);
      const rings = 0.5 + 0.5 * Math.sin(y * 0.11 + n * 10 + plank * 2);
      const fine = 0.5 + 0.5 * noise2(x * 0.06, y * 0.8);
      let t = 0.5 * rings + 0.3 * fine + 0.2 * (0.5 + 0.5 * n);
      if (py < 2 || py > h / 4 - 2) t *= 0.55;
      const k = (y * w + x) * 4;
      d[k] = 128 + 58 * t; d[k + 1] = 88 + 40 * t; d[k + 2] = 52 + 24 * t; d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
function paintMat(ctx, w, h, Wm, Hm) {
  ctx.fillStyle = '#2c4657'; ctx.fillRect(0, 0, w, h);
  const r = rng(5);
  for (let i = 0; i < 9000; i++) { ctx.fillStyle = `rgba(${r() < 0.5 ? 255 : 0},${r() < 0.5 ? 255 : 0},255,${0.015 + r() * 0.03})`; ctx.fillRect(r() * w, r() * h, 1.5, 1.5); }
  const pxm = w / Wm; // px per metre
  ctx.strokeStyle = 'rgba(190,215,230,0.13)'; ctx.lineWidth = 1;
  for (let x = 0.02; x < Wm; x += 0.01) { ctx.beginPath(); ctx.moveTo(x * pxm, 0.03 * pxm); ctx.lineTo(x * pxm, h - 0.03 * pxm); ctx.stroke(); }
  for (let y = 0.03; y < Hm - 0.02; y += 0.01) { ctx.beginPath(); ctx.moveTo(0.02 * pxm, y * pxm); ctx.lineTo(w - 0.02 * pxm, y * pxm); ctx.stroke(); }
  // ruler along the front edge
  ctx.strokeStyle = 'rgba(230,240,245,0.55)'; ctx.fillStyle = 'rgba(230,240,245,0.6)'; ctx.font = `600 ${0.008 * pxm}px Inter, sans-serif`; ctx.textAlign = 'center';
  for (let mm = 0; mm <= (Wm - 0.04) * 1000; mm += 5) { const x = (0.02 + mm / 1000) * pxm; const L = mm % 50 === 0 ? 0.008 : mm % 10 === 0 ? 0.005 : 0.003; ctx.beginPath(); ctx.moveTo(x, h - 0.004 * pxm); ctx.lineTo(x, h - (0.004 + L) * pxm); ctx.stroke(); if (mm % 50 === 0) ctx.fillText(String(mm / 10), x, h - 0.018 * pxm); }
  ctx.textAlign = 'left'; ctx.font = `700 ${0.009 * pxm}px Inter, sans-serif`; ctx.fillStyle = 'rgba(230,240,245,0.35)'; ctx.fillText('ESD SAFE WORK AREA · cm', 0.03 * pxm, 0.018 * pxm);
}
function paintBreadboard(ctx, w, h) {
  // 165.1 × 54.6 mm board, 63 columns
  const s = w / 165.1; ctx.fillStyle = '#ece8dc'; ctx.fillRect(0, 0, w, h);
  const hole = (x, y) => { ctx.fillStyle = '#3b3a37'; ctx.fillRect((x - 0.55) * s, (y - 0.55) * s, 1.1 * s, 1.1 * s); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect((x - 0.55) * s, (y + 0.45) * s, 1.1 * s, 0.18 * s); };
  const x0 = 82.55 - 31 * 2.54;
  const rows = [10.3, 12.84, 15.38, 17.92, 20.46, 34.14, 36.68, 39.22, 41.76, 44.3];
  for (let c = 0; c < 63; c++) rows.forEach(y => hole(x0 + c * 2.54, y));
  // power rails (groups of 5)
  [[2.6, 5.14], [49.46, 52.0]].forEach(([a, b]) => { for (let c = 0; c < 63; c++) { if (c % 6 === 5) continue; hole(x0 + 1.27 + c * 2.54, a); hole(x0 + 1.27 + c * 2.54, b); } });
  ctx.fillStyle = '#d8342c'; ctx.fillRect(4 * s, 0.9 * s, 157 * s, 0.35 * s); ctx.fillRect(4 * s, 53.3 * s, 157 * s, 0.35 * s);
  ctx.fillStyle = '#2d57c4'; ctx.fillRect(4 * s, 6.6 * s, 157 * s, 0.35 * s); ctx.fillRect(4 * s, 47.7 * s, 157 * s, 0.35 * s);
  // centre channel
  const g = ctx.createLinearGradient(0, 25 * s, 0, 29.6 * s); g.addColorStop(0, '#bdb8ab'); g.addColorStop(0.5, '#8e8a80'); g.addColorStop(1, '#bdb8ab');
  ctx.fillStyle = g; ctx.fillRect(0, 25.6 * s, w, 3.2 * s);
  ctx.fillStyle = '#8a857a'; ctx.font = `600 ${1.6 * s}px Inter, sans-serif`; ctx.textAlign = 'center';
  'abcde'.split('').forEach((c, i) => ctx.fillText(c, 2 * s, (rows[i] + 0.6) * s)); 'fghij'.split('').forEach((c, i) => ctx.fillText(c, 2 * s, (rows[5 + i] + 0.6) * s));
  for (let c = 0; c < 63; c += 5) { ctx.fillText(String(c + 1), (x0 + c * 2.54) * s, 8.4 * s); ctx.fillText(String(c + 1), (x0 + c * 2.54) * s, 47.2 * s); }
}
/** 7-segment digits (with faint unlit segments), for the multimeter LCD. */
const SEGS = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '', 'O': 'abcdef', 'L': 'fed', 'E': 'afged', 'r': 'eg' };
function draw7(ctx, str, x, y, H, on, off) {
  const W = H * 0.52, T = H * 0.12; let cx = x;
  const seg = (k, lit) => {
    ctx.fillStyle = lit ? on : off; ctx.beginPath();
    const hz = (x1, x2, yc) => { ctx.moveTo(x1, yc); ctx.lineTo(x1 + T / 2, yc - T / 2); ctx.lineTo(x2 - T / 2, yc - T / 2); ctx.lineTo(x2, yc); ctx.lineTo(x2 - T / 2, yc + T / 2); ctx.lineTo(x1 + T / 2, yc + T / 2); };
    const vt = (xc, y1, y2) => { ctx.moveTo(xc, y1); ctx.lineTo(xc + T / 2, y1 + T / 2); ctx.lineTo(xc + T / 2, y2 - T / 2); ctx.lineTo(xc, y2); ctx.lineTo(xc - T / 2, y2 - T / 2); ctx.lineTo(xc - T / 2, y1 + T / 2); };
    const g = 1.5;
    if (k === 'a') hz(cx + g, cx + W - g, y); if (k === 'g') hz(cx + g, cx + W - g, y + H / 2); if (k === 'd') hz(cx + g, cx + W - g, y + H);
    if (k === 'f') vt(cx, y + g, y + H / 2 - g); if (k === 'b') vt(cx + W, y + g, y + H / 2 - g);
    if (k === 'e') vt(cx, y + H / 2 + g, y + H - g); if (k === 'c') vt(cx + W, y + H / 2 + g, y + H - g);
    ctx.closePath(); ctx.fill();
  };
  ctx.save(); ctx.transform(1, 0, -0.08, 1, y * 0.08 + H * 0.08, 0);
  for (const ch of str) {
    if (ch === '.') { ctx.fillStyle = on; ctx.beginPath(); ctx.arc(cx - W * 0.28, y + H, T * 0.62, 0, TAU); ctx.fill(); continue; }
    const lit = SEGS[ch] ?? '';
    'abcdefg'.split('').forEach(k => seg(k, lit.includes(k)));
    cx += W + H * 0.26;
  }
  ctx.restore();
}

/* ======================================================================
   createBench
   ====================================================================== */
export function createBench(el, { onSelect } = {}) {
  mats();
  const stage = createStage(el, {
    background: '#0b1013', envIntensity: 0.45, exposure: 0.95,
    camera: { pos: [0.0, 0.5, 0.62], target: [0.0, 0.035, -0.035], fov: 38, near: 0.003, far: 30 },
    controls: { minDistance: 0.02, maxDistance: 2.2, maxPolarAngle: Math.PI * 0.47 },
    bloom: { strength: 0.5, radius: 0.3, threshold: 1.7 }, ao: { radius: 0.025, intensity: 0.8 },
    hint: 'Click a sensor to open it · drag to orbit · scroll to zoom'
  });
  const { scene } = stage;
  const L = studioLights(stage, { intensity: 0.8, shadowSize: 0.5, keyPos: [0.5, 1.1, 0.55] });
  L.key.shadow.bias = -0.0002; L.key.shadow.normalBias = 0.004; L.key.shadow.camera.near = 0.2; L.key.shadow.camera.far = 3; L.key.shadow.camera.updateProjectionMatrix();
  const warm = new THREE.PointLight(0xffe2b8, 0.22, 2.5, 2); warm.position.set(-0.45, 0.5, 0.25); scene.add(warm);

  /* ---------------- room, bench, mat ---------------- */
  const bench = box(1.5, 0.04, 0.86, new THREE.MeshStandardMaterial({ map: canvasTexture(1024, 512, paintWood, { key: 'sb-wood2' }), roughness: 0.58 }), 0.004);
  bench.position.set(0, -0.02, -0.08); bench.castShadow = false; scene.add(bench);
  const legM = M.paintedSteel(0x2c3035);
  [[-0.7, -0.45], [0.7, -0.45], [-0.7, 0.3], [0.7, 0.3]].forEach(([x, z]) => at(box(0.05, 0.86, 0.05, legM), x, -0.47, z, scene));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), surfaceMaterial('concrete', [6, 6])); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.9; floor.receiveShadow = true; scene.add(floor);
  const peg = canvasTexture(256, 256, (ctx, w, h) => { ctx.fillStyle = '#2b3136'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#15191c'; for (let y = 16; y < h; y += 32) for (let x = 16; x < w; x += 32) { ctx.beginPath(); ctx.arc(x, y, 4.2, 0, TAU); ctx.fill(); } }, { repeat: [12, 5], key: 'sb-peg' });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.0), new THREE.MeshStandardMaterial({ map: peg, roughness: 0.8 })); wall.position.set(0, 0.46, -0.5); wall.receiveShadow = true; scene.add(wall);
  const matW = 0.7, matD = 0.46;
  const esd = box(matW, 0.003, matD, new THREE.MeshStandardMaterial({ map: canvasTexture(1400, 920, (c, w, h) => paintMat(c, w, h, matW, matD), { key: 'sb-mat' }), roughness: 0.82 }), 0.0012);
  esd.position.set(0, Y0 / 2, 0.02); esd.castShadow = false; scene.add(esd);
  const snap = cyl(0.005, 0.005, 0.003, MAT.steel, 20); at(snap, -matW / 2 + 0.02, Y0 + 0.0015, 0.02 - matD / 2 + 0.02, scene);
  scene.add(makePipe([[-matW / 2 + 0.02, Y0 + 0.003, 0.02 - matD / 2 + 0.02], [-matW / 2 - 0.03, Y0 + 0.004, -0.22], [-matW / 2 - 0.05, 0.004, -0.36]], { radius: 0.0016, material: wireMat(0x2a6d45) }));
  // small props: solder spool and tweezers
  const spool = new THREE.Group(); at(cyl(0.022, 0.022, 0.004, MAT.whitePlastic, 32), 0, 0.002, 0, spool); at(cyl(0.022, 0.022, 0.004, MAT.whitePlastic, 32), 0, 0.022, 0, spool); at(cyl(0.017, 0.017, 0.016, MAT.tin, 32), 0, 0.012, 0, spool); at(cyl(0.006, 0.006, 0.026, MAT.whitePlastic, 16), 0, 0.012, 0, spool);
  at(spool, 0.33, Y0 - 0.0005, -0.28, scene); spool.traverse(m => { if (m.isMesh) m.castShadow = true; });
  const tw = new THREE.Group(); [-1, 1].forEach(s => { const b = box(0.11, 0.0012, 0.0045, MAT.steel, 0.0005); b.rotation.y = s * 0.035; b.position.z = s * 0.0022; tw.add(b); });
  at(tw, 0.3, Y0 + 0.0007, 0.21, scene); tw.rotation.y = 0.6;

  /* ---------------- breadboard ---------------- */
  const BB = { x: -0.045, z: 0.02, w: 0.1651, d: 0.0546, h: 0.0085 };
  const bbTop = Y0 + BB.h;
  const bbTex = canvasTexture(2048, 678, paintBreadboard, { key: 'sb-bb' });
  const bbG = new THREE.Group(); scene.add(bbG); bbG.position.set(BB.x, Y0, BB.z);
  at(box(BB.w, BB.h, BB.d, MAT.whitePlastic, 0.0008), 0, BB.h / 2, 0, bbG);
  const bbTopPlane = new THREE.Mesh(new THREE.PlaneGeometry(BB.w - 0.0006, BB.d - 0.0006), new THREE.MeshStandardMaterial({ map: bbTex, roughness: 0.55 })); bbTopPlane.rotation.x = -Math.PI / 2; bbTopPlane.position.y = BB.h + 0.00005; bbTopPlane.receiveShadow = true; bbG.add(bbTopPlane);
  /** World position of breadboard hole (column 1–63, row 'a'–'j'). */
  const ROWZ = { a: 10.3, b: 12.84, c: 15.38, d: 17.92, e: 20.46, f: 34.14, g: 36.68, h: 39.22, i: 41.76, j: 44.3, '+': 5.14, '-': 2.6, 'B+': 49.46, 'B-': 52.0 };
  const hole = (col, row) => V3(BB.x + (-31 + (col - 1)) * 0.00254, bbTop, BB.z - BB.d / 2 + ROWZ[row] / 1000);

  /* ---------------- ESP32 DevKit ---------------- */
  const esp = buildESP32(); esp.position.set(BB.x - 0.038, bbTop + 0.0026, BB.z); scene.add(esp);
  /* ---------------- OLED ---------------- */
  const oled = buildOLED(); oled.group.position.set(BB.x + 0.047, bbTop + 0.0028, BB.z - 0.004); scene.add(oled.group);
  /* ---------------- divider resistor + capacitor ---------------- */
  const resistor = buildResistor(); resistor.group.position.copy(hole(40, 'c')).add(V3(0.00127, 0, 0.00127)); scene.add(resistor.group);
  const capC = buildMLCC(); capC.position.copy(hole(44, 'h')); scene.add(capC);

  /* ---------------- multimeter ---------------- */
  const dmm = buildDMM(); dmm.group.position.set(0.245, Y0, 0.115); dmm.group.rotation.y = -0.3; scene.add(dmm.group);
  // test leads to the breadboard (red to the ADC node, black to ground rail)
  dmm.group.updateMatrixWorld(true);
  const jackR = dmm.jackRed.getWorldPosition(V3()), jackB = dmm.jackCom.getWorldPosition(V3());
  const tipR = hole(41, 'd').add(V3(0, 0.004, 0)), tipB = hole(46, 'B-').add(V3(0, 0.004, 0));
  scene.add(makePipe([jackR.clone().add(V3(0, 0.012, 0)), jackR.clone().add(V3(-0.02, 0.03, -0.03)), V3(0.12, 0.012, 0.06), V3(0.05, 0.02, 0.03), tipR.clone().add(V3(0.02, 0.012, 0.0)), tipR.clone().add(V3(0.008, 0.004, 0))], { radius: 0.0012, material: wireMat(0xc8231d), tension: 0.4 }));
  scene.add(makePipe([jackB.clone().add(V3(0, 0.012, 0)), jackB.clone().add(V3(-0.03, 0.025, -0.01)), V3(0.12, 0.008, 0.1), V3(0.06, 0.012, 0.075), tipB.clone().add(V3(0.02, 0.012, 0.01)), tipB.clone().add(V3(0.008, 0.004, 0.002))], { radius: 0.0012, material: wireMat(0x1b1b1d), tension: 0.4 }));
  [[tipR, 0xc8231d], [tipB, 0x1b1b1d]].forEach(([p, c]) => { const pr = new THREE.Group(); at(cyl(0.0022, 0.0028, 0.022, wireMat(c), 16), 0, 0.011, 0, pr); at(cyl(0.0005, 0.0005, 0.012, MAT.steel, 8), 0, -0.006, 0, pr); pr.position.copy(p).add(V3(0.009, 0.004, 0)); pr.rotation.z = 1.05; scene.add(pr); });

  /* ---------------- sensors ---------------- */
  const sensors = {};
  sensors.ntc = buildNTC();
  sensors.rh = buildRH();
  sensors.par = buildPAR();
  sensors.co2 = buildNDIR();
  sensors.vwc = buildMoisture();

  /* ---------------- jumper wiring from the breadboard to the modules ---------------- */
  const WC = { red: 0xd4352c, black: 0x1d1e20, yellow: 0xe8c22a, green: 0x2f9e55, blue: 0x2f6fd0, orange: 0xe87a24, white: 0xe9e9e4, purple: 0x7b4bc4 };
  function run(fromHole, toPt, color, lift = 0.02, mids = []) {
    const a = fromHole.clone(); dupont(scene, a.x, a.y, a.z);
    const b = toPt.clone(); dupont(scene, b.x, b.y, b.z);
    const A = a.clone().add(V3(0, 0.0142, 0)), B = b.clone().add(V3(0, 0.0142, 0));
    const pts = [A, A.clone().add(V3(0, 0.008, 0)), ...mids.map(m => m.clone ? m : V3(...m)), B.clone().add(V3(0, 0.01, 0)), B];
    if (!mids.length) { const m = A.clone().lerp(B, 0.5); m.y = Math.max(A.y, B.y) + lift; pts.splice(2, 0, m); }
    scene.add(wire(pts, color));
  }
  // RH module (front-left): VCC, GND, OUT
  sensors.rh.pins.forEach((p, i) => run(hole(8 + i, 'j'), p, [WC.red, WC.black, WC.yellow][i], 0, [V3(BB.x - 0.058 + i * 0.003, Y0 + 0.012, 0.075 + i * 0.002), V3(-0.12 + i * 0.002, Y0 + 0.01, 0.11)]));
  // NDIR (front-right): VCC, GND, TX, RX
  sensors.co2.pins.forEach((p, i) => run(hole(18 + i, 'j'), p, [WC.red, WC.black, WC.green, WC.blue][i], 0, [V3(BB.x - 0.02 + i * 0.003, Y0 + 0.014, 0.075), V3(0.07 + i * 0.002, Y0 + 0.012, 0.125)]));
  // PAR amplifier board (back): VCC, GND, OUT
  sensors.par.pins.forEach((p, i) => run(hole(14 + i, 'a'), p, [WC.red, WC.black, WC.orange][i], 0, [V3(BB.x - 0.03 + i * 0.003, Y0 + 0.016, -0.03), V3(0.0 + i * 0.003, Y0 + 0.012, -0.075)]));
  // moisture probe (back-right): AOUT, VCC, GND straight from the JST plug to the breadboard
  sensors.vwc.pins.forEach((a, i) => {
    const h = hole(50 + i, 'a'); dupont(scene, h.x, h.y, h.z); const H = h.clone().add(V3(0, 0.0142, 0));
    scene.add(wire([a, a.clone().add(V3(0.004, 0.014, 0.004)), V3(a.x + 0.035, a.y - 0.03, a.z + 0.03), V3(0.262 + i * 0.003, Y0 + 0.0035, -0.05 + i * 0.003), V3(0.2, Y0 + 0.003, -0.012 + i * 0.003), V3(0.1, Y0 + 0.003, -0.018 + i * 0.003), V3(BB.x + 0.09 + i * 0.003, Y0 + 0.004, -0.024), H.clone().add(V3(0, 0.01, 0)), H], [WC.yellow, WC.red, WC.black][i]));
  });
  // ESP32 GPIO to the divider node and 3V3 to the resistor, jumper to the thermistor cable
  scene.add(wire([hole(12, 'b').add(V3(0, 0.0142, 0)), V3(BB.x - 0.005, bbTop + 0.018, BB.z - 0.021), hole(41, 'b').add(V3(0, 0.0142, 0))], WC.green)); dupont(scene, ...hole(12, 'b').toArray()); dupont(scene, ...hole(41, 'b').toArray());
  scene.add(wire([hole(6, '+').add(V3(0, 0.0142, 0)), V3(BB.x - 0.03, bbTop + 0.016, BB.z - 0.03), hole(38, '+').add(V3(0, 0.0142, 0))], WC.red)); dupont(scene, ...hole(6, '+').toArray()); dupont(scene, ...hole(38, '+').toArray());

  /* ---------------- labels ---------------- */
  const labels = {};
  Object.entries(sensors).forEach(([k, s]) => {
    labels[k] = stage.addLabel(s.labelAnchor, `${s.title}<small>—</small>`, { className: 'label3d sb-label' });
    labels[k].element.style.pointerEvents = 'auto'; labels[k].element.style.cursor = 'pointer';
    labels[k].element.addEventListener('click', () => onSelect && onSelect(k));
  });
  const partLabels = [];
  Object.values(sensors).forEach(s => (s.parts || []).forEach(([obj, html, off, side = 'r']) => {
    const l = stage.addLabel(obj, html, { className: 'label3d sb-part ' + side, offset: off || [0, 0, 0] });
    l.center.set(side === 'r' ? -0.04 : 1.04, 0.5); l.visible = false; l.userData.sensor = s.key; partLabels.push(l);
  }));

  /* ---------------- picking ---------------- */
  const hits = Object.values(sensors).map(s => s.hit);
  stage.onPick({
    objects: hits,
    onClick: h => { if (h && h.object.userData.sensor) onSelect && onSelect(h.object.userData.sensor); },
    onHover: h => { Object.entries(labels).forEach(([k, l]) => l.element.classList.toggle('hover', !!h && h.object.userData.sensor === k)); }
  });

  /* ---------------- selection, cut-away and camera ---------------- */
  let selected = null, cutaway = true;
  function focus(key, fly = true) {
    selected = key;
    Object.entries(labels).forEach(([k, l]) => { l.element.classList.toggle('active', k === key); });
    if (fly) { if (key) { const f = sensors[key].focus(); stage.flyTo(f.pos, f.target, 1.5); } else stage.resetView(); }
  }

  /* ---------------- per-frame update ---------------- */
  let lcdT = 0;
  function update(dt, t, st) {
    Object.entries(sensors).forEach(([k, s]) => {
      const want = cutaway && selected === k ? 1 : 0;
      s.open = s.open ?? 0; s.open += (want - s.open) * Math.min(1, dt * 3.2); if (Math.abs(want - s.open) < 0.002) s.open = want;
      s.setOpen(ease(s.open));
      s.update(dt, t, st[k] || {}, st, s.open);
      const r = st[k]; if (r && r.label && r.label !== s._lastLabel) { s._lastLabel = r.label; labels[k].element.innerHTML = `${s.title}<small>${r.label}</small>`; }
    });
    if (sensors.ntc.moved) { sensors.ntc.moved = false; if (selected === 'ntc') focus('ntc'); }
    partLabels.forEach(l => { l.visible = sensors[l.userData.sensor].open > 0.8; });
    Object.entries(labels).forEach(([k, l]) => { l.visible = sensors[k].open < 0.5; });
    lcdT += dt;
    if (lcdT > 0.25 && st.dmm) { lcdT = 0; dmm.setValue(st.dmm.v, st.dmm.unit, st.dmm.mode); }
    if (st.oled) oled.set(st.oled);
    esp.userData.led.material.emissiveIntensity = st.blink ? 6 : 0.15;
    resistor.setBands(st.Rf || 10000);
  }
  stage.onKey('space', () => {});
  if (stage.addTool) stage.addTool({ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="18" height="6" rx="1.5"/><path d="M7 13V9m5 4V5m5 8v-3"/></svg>', title: 'Bench overview (close the sensor)', onClick: () => onSelect && focus(null) });
  return { stage, sensors, focus, update, setCutaway(v) { cutaway = v; }, get selected() { return selected; } };

  /* ==================================================================== builders */
  function buildESP32() {
    const g = new THREE.Group();
    const W = 0.0515, D = 0.0285, T = 0.0016;
    const top = canvasTexture(1030, 570, (ctx, w, h) => {
      const s = w / W / 1000; // px per mm
      ctx.fillStyle = '#16181b'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(70,78,86,0.55)'; ctx.lineWidth = 2.2; const r = rng(3);
      for (let i = 0; i < 40; i++) { ctx.beginPath(); let x = r() * w, y = r() * h; ctx.moveTo(x, y); for (let k = 0; k < 3; k++) { if (r() < 0.5) x += (r() - 0.5) * 200; else y += (r() - 0.5) * 140; ctx.lineTo(x, y); } ctx.stroke(); }
      // pads for header pins
      const pads = y => { for (let i = 0; i < 15; i++) { const x = (7.9 + i * 2.54) * s; ctx.fillStyle = '#c9ccd1'; ctx.beginPath(); ctx.arc(x, y * s, 0.85 * s, 0, TAU); ctx.fill(); ctx.fillStyle = '#6f757d'; ctx.beginPath(); ctx.arc(x, y * s, 0.4 * s, 0, TAU); ctx.fill(); } };
      pads(1.6); pads(26.9);
      ctx.fillStyle = '#f2f2ee'; ctx.font = `700 ${1.2 * s}px Inter, sans-serif`; ctx.textAlign = 'center';
      const L1 = ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND', '3V3'];
      const L2 = ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN'];
      L1.forEach((t, i) => ctx.fillText(t, (7.9 + i * 2.54) * s, 4.2 * s)); L2.forEach((t, i) => ctx.fillText(t, (7.9 + i * 2.54) * s, 24.6 * s));
      ctx.font = `800 ${1.5 * s}px Inter, sans-serif`; ctx.fillText('ESP32 DEVKIT V1', 36 * s, 21.0 * s);
      ctx.font = `700 ${1.1 * s}px Inter, sans-serif`; ctx.fillText('EN', 4.5 * s, 8.5 * s); ctx.fillText('BOOT', 4.5 * s, 20.8 * s);
      ctx.strokeStyle = '#f2f2ee'; ctx.lineWidth = 0.18 * s; ctx.strokeRect(11 * s, 5.9 * s, 19 * s, 16.4 * s);
    }, { key: 'sb-esp32' });
    const pcb = box(W, T, D, pcbMat(0x16181b), 0.0006); pcb.position.y = T / 2; g.add(pcb);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.0004, D - 0.0004), pcbMat(0, top)); pl.rotation.x = -Math.PI / 2; pl.position.y = T + 0.00003; g.add(pl);
    // WROOM module: can + antenna PCB
    const mod = new THREE.Group(); mod.position.set(0.012, T, 0); g.add(mod);
    at(box(0.0255, 0.0008, 0.018, pcbMat(0x1b2a24), 0.0002), 0, 0.0004, 0, mod);
    const canTex = canvasTexture(512, 360, (ctx, w, h) => { ctx.fillStyle = '#b9bdc2'; ctx.fillRect(0, 0, w, h); const r = rng(8); for (let i = 0; i < 2600; i++) { ctx.fillStyle = `rgba(255,255,255,${r() * 0.07})`; ctx.fillRect(0, r() * h, w, 1); } ctx.fillStyle = '#4b5058'; ctx.font = '800 44px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('ESP32-WROOM-32', w / 2, 120); ctx.font = '600 28px JetBrains Mono, monospace'; ctx.fillText('2.4 GHz Wi-Fi + BT', w / 2, 180); ctx.fillText('FCC ID  2AC7Z-ESPWROOM32', w / 2, 230); ctx.fillText('R  211-161007', w / 2, 272); }, { key: 'sb-wroom' });
    const can = box(0.0176, 0.0024, 0.0162, new THREE.MeshStandardMaterial({ map: canTex, metalness: 0.85, roughness: 0.36 }), 0.0003); can.position.set(-0.0035, 0.002, 0); mod.add(can);
    const antTex = canvasTexture(256, 360, (ctx, w, h) => { ctx.fillStyle = '#12161a'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#b8894a'; ctx.lineWidth = 9; ctx.beginPath(); let y = 30; ctx.moveTo(30, y); for (let i = 0; i < 6; i++) { ctx.lineTo(w - 30, y); y += 26; ctx.lineTo(w - 30, y); ctx.lineTo(50, y); y += 26; ctx.lineTo(50, y); } ctx.stroke(); }, { key: 'sb-ant' });
    const ant = new THREE.Mesh(new THREE.PlaneGeometry(0.0062, 0.0176), new THREE.MeshStandardMaterial({ map: antTex, roughness: 0.4 })); ant.rotation.x = -Math.PI / 2; ant.position.set(0.0092, 0.00082, 0); mod.add(ant);
    // USB, buttons, regulator, USB-UART, LEDs
    at(box(0.0058, 0.0027, 0.0078, MAT.steel, 0.0004), -W / 2 + 0.0025, T + 0.00135, 0, g);
    [-0.0095, 0.0095].forEach(z => { at(box(0.0035, 0.0014, 0.0026, MAT.tin, 0.0002), -W / 2 + 0.0065, T + 0.0007, z, g); at(cyl(0.0009, 0.0009, 0.0012, MAT.black, 12), -W / 2 + 0.0065, T + 0.0018, z, g); });
    at(box(0.0065, 0.0016, 0.0035, MAT.chip, 0.0002), -0.0105, T + 0.0008, 0.0065, g); at(box(0.003, 0.0004, 0.0035, MAT.tin), -0.0105, T + 0.0002, 0.0092, g);
    at(box(0.0045, 0.0009, 0.0045, MAT.chip, 0.0002), -0.0125, T + 0.00045, -0.004, g);
    const ledR = box(0.0016, 0.0007, 0.0009, M.emissive(0xff2a2a, 3.5)); at(ledR, -0.004, T + 0.00035, -0.0098, g);
    const ledB = box(0.0016, 0.0007, 0.0009, M.emissive(0x2a6bff, 0.15)); at(ledB, -0.0015, T + 0.00035, -0.0098, g); g.userData.led = ledB;
    // header strips and pins
    [-1, 1].forEach(side => {
      const z = side * 0.0127;
      at(box(0.038, 0.0025, 0.0025, MAT.headerPlastic), 0.0003, -0.00125, z, g);
      for (let i = 0; i < 15; i++) {
        const x = -W / 2 + 0.0079 + i * 0.00254;
        at(box(0.00064, 0.0034, 0.00064, MAT.gold), x, T + 0.0006, z, g);
        at(cyl(0.0003, 0.0008, 0.0006, MAT.tin, 10), x, T + 0.0003, z, g);
        at(box(0.00064, 0.004, 0.00064, MAT.gold), x, -0.0045, z, g);
      }
    });
    g.traverse(m => { if (m.isMesh) m.castShadow = true; });
    return g;
  }

  function buildOLED() {
    const g = new THREE.Group();
    at(box(0.0275, 0.0012, 0.0275, pcbMat(0x1f55b8), 0.0005), 0, 0.0006, 0, g);
    for (let i = 0; i < 4; i++) { at(box(0.00064, 0.006, 0.00064, MAT.gold), -0.0038 + i * 0.00254, -0.002, -0.0122, g); at(cyl(0.0003, 0.0008, 0.0006, MAT.tin, 10), -0.0038 + i * 0.00254, 0.0015, -0.0122, g); }
    at(box(0.0102, 0.0025, 0.0025, MAT.headerPlastic), 0, -0.00125, -0.0122, g);
    at(box(0.0267, 0.0016, 0.0194, MAT.black, 0.0002), 0, 0.002, 0.0015, g);
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const ctx = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.0218, 0.0109), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.35, roughness: 0.15 }));
    scr.rotation.x = -Math.PI / 2; scr.position.set(0, 0.00282, 0.0012); g.add(scr);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.0265, 0.0192), MAT.glass); glass.rotation.x = -Math.PI / 2; glass.position.set(0, 0.0029, 0.0015); g.add(glass);
    at(box(0.012, 0.0003, 0.004, new THREE.MeshStandardMaterial({ color: 0xa8641c, roughness: 0.4, transparent: true, opacity: 0.85 })), 0, 0.0013, 0.0125, g);
    let last = '';
    function set(o) {
      const key = JSON.stringify(o); if (key === last) return; last = key;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = '#8fd8ff'; ctx.font = '700 20px JetBrains Mono, monospace'; ctx.textBaseline = 'top'; ctx.fillText(o.title || '', 6, 4);
      ctx.fillRect(6, 30, 244, 2);
      ctx.fillStyle = '#e8f7ff'; ctx.font = '700 44px JetBrains Mono, monospace'; ctx.fillText(o.value || '', 6, 40);
      ctx.fillStyle = '#8fd8ff'; ctx.font = '600 17px JetBrains Mono, monospace'; ctx.fillText(o.sub || '', 6, 100);
      tex.needsUpdate = true;
    }
    g.traverse(m => { if (m.isMesh && m !== scr && m !== glass) m.castShadow = true; });
    return { group: g, set };
  }

  function buildResistor() {
    const g = new THREE.Group();
    const body = mesh(new THREE.CapsuleGeometry(0.00115, 0.0042, 6, 18), new THREE.MeshStandardMaterial({ color: 0xd8c29b, roughness: 0.55 })); body.rotation.z = Math.PI / 2; body.position.y = 0.0042; g.add(body);
    const bands = [0, 1, 2, 3].map(i => { const b = cyl(0.00121, 0.00121, 0.00045, new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.5 }), 20); b.rotation.z = Math.PI / 2; b.position.set(-0.0019 + i * 0.00095 + (i === 3 ? 0.00085 : 0), 0.0042, 0); g.add(b); return b; });
    const leadM = MAT.tin;
    [-1, 1].forEach(s => { const lead = makePipe([[s * 0.003, 0.0042, 0], [s * 0.0048, 0.0042, 0], [s * 0.0064, 0.0028, 0], [s * 0.00635, -0.001, 0]], { radius: 0.0003, material: leadM, radial: 6, tension: 0.3 }); g.add(lead); });
    const COL = [0x111111, 0x7a4a1f, 0xd02020, 0xf07a10, 0xf2d21a, 0x2a9a3a, 0x2050d0, 0x8040c0, 0x888888, 0xf5f5f5];
    let lastR = 0;
    function setBands(R) {
      if (R === lastR) return; lastR = R;
      const e = Math.floor(Math.log10(R)) - 1; const sig = Math.round(R / Math.pow(10, e));
      const d1 = Math.floor(sig / 10) % 10, d2 = sig % 10;
      [d1, d2, clamp(e, 0, 9)].forEach((d, i) => bands[i].material.color.setHex(COL[d]));
      bands[3].material.color.setHex(0xc9a043); bands[3].material.metalness = 0.8; bands[3].material.roughness = 0.3;
    }
    g.position.y = bbTop;
    return { group: g, setBands };
  }
  function buildMLCC() {
    const g = new THREE.Group();
    const b = mesh(new THREE.SphereGeometry(0.0021, 18, 12), new THREE.MeshStandardMaterial({ color: 0xe0a92a, roughness: 0.45 })); b.scale.set(1, 1.1, 0.55); b.position.y = 0.0055; g.add(b);
    [-1, 1].forEach(s => g.add(makePipe([[s * 0.0008, 0.0035, 0], [s * 0.00127, 0.001, 0], [s * 0.00127, -0.001, 0]], { radius: 0.00026, material: MAT.tin, radial: 6 })));
    g.position.y = bbTop; return g;
  }

  function buildDMM() {
    const g = new THREE.Group(); const W = 0.088, H = 0.032, D = 0.17, TH = 0.3;
    const tilt = new THREE.Group(); tilt.rotation.x = TH; tilt.position.y = (D / 2) * Math.sin(TH) + 0.001; g.add(tilt);
    // wire tilt stand under the raised back
    g.add(makePipe([[-W / 2 + 0.006, 0.001, -D / 2 * Math.cos(TH) + 0.03], [-W / 2 + 0.006, 0.02, -D / 2 * Math.cos(TH) + 0.012], [-W / 2 + 0.01, D * Math.sin(TH) - 0.004, -D / 2 * Math.cos(TH) + 0.006]], { radius: 0.0012, material: MAT.steel, radial: 8 }));
    g.add(makePipe([[W / 2 - 0.006, 0.001, -D / 2 * Math.cos(TH) + 0.03], [W / 2 - 0.006, 0.02, -D / 2 * Math.cos(TH) + 0.012], [W / 2 - 0.01, D * Math.sin(TH) - 0.004, -D / 2 * Math.cos(TH) + 0.006]], { radius: 0.0012, material: MAT.steel, radial: 8 }));
    at(box(W, H, D, new THREE.MeshStandardMaterial({ color: 0xf0b92a, roughness: 0.78 }), 0.009), 0, H / 2, 0, tilt);
    at(box(W - 0.012, 0.004, D - 0.014, new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.52 }), 0.004), 0, H + 0.0005, 0, tilt);
    const panel = canvasTexture(512, 1024, (ctx, w, h) => {
      ctx.fillStyle = '#2a2e33'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e8e8e2'; ctx.font = '800 34px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('TRUE RMS MULTIMETER', w / 2, 60);
      const cx = w / 2, cy = 640, R = 170;
      const marks = [['OFF', -150], ['V⎓', -110], ['mV', -75], ['V~', -40], ['Ω', 0], ['⊣⊢', 35], ['Hz', 70], ['µA', 110], ['mA', 150], ['A', 185]];
      ctx.font = '700 30px Inter, sans-serif';
      marks.forEach(([t, a]) => { const r = (a - 90) * Math.PI / 180; ctx.fillStyle = t === 'V⎓' ? '#f0c030' : '#e8e8e2'; ctx.fillText(t, cx + Math.cos(r) * (R + 42), cy + Math.sin(r) * (R + 42) + 10); ctx.strokeStyle = '#8a9096'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx + Math.cos(r) * (R + 6), cy + Math.sin(r) * (R + 6)); ctx.lineTo(cx + Math.cos(r) * (R + 18), cy + Math.sin(r) * (R + 18)); ctx.stroke(); });
      ctx.font = '700 26px Inter, sans-serif'; ctx.fillStyle = '#e8e8e2';
      [['10A', 110], ['COM', 256], ['VΩmA', 402]].forEach(([t, x]) => ctx.fillText(t, x, 985));
      ctx.fillStyle = '#9aa1a8'; ctx.font = '600 22px Inter, sans-serif'; ctx.fillText('CAT III 600V', w / 2, 1010);
      ['HOLD', 'RANGE', 'SELECT', 'REL'].forEach((t, i) => { ctx.fillStyle = '#3c4249'; ctx.fillRect(40 + i * 110, 380, 94, 48); ctx.fillStyle = '#e8e8e2'; ctx.font = '700 22px Inter, sans-serif'; ctx.fillText(t, 87 + i * 110, 412); });
    }, { key: 'sb-dmm-panel' });
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.014, D - 0.016), new THREE.MeshStandardMaterial({ map: panel, roughness: 0.55 })); pl.rotation.x = -Math.PI / 2; pl.position.y = H + 0.0026; tilt.add(pl);
    // LCD
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256; const lctx = cv.getContext('2d');
    const lt = new THREE.CanvasTexture(cv); lt.colorSpace = THREE.SRGBColorSpace; lt.anisotropy = 8;
    const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.058, 0.029), new THREE.MeshStandardMaterial({ map: lt, roughness: 0.28, emissive: 0x6b7560, emissiveMap: lt, emissiveIntensity: 0.25 })); lcd.rotation.x = -Math.PI / 2; lcd.position.set(0, H + 0.0028, -0.052); tilt.add(lcd);
    const bezel = box(0.064, 0.0012, 0.035, MAT.black, 0.002); bezel.position.set(0, H + 0.0022, -0.052); tilt.add(bezel);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.062, 0.033), MAT.glass); win.rotation.x = -Math.PI / 2; win.position.set(0, H + 0.0035, -0.052); tilt.add(win);
    // rotary switch
    const knob = new THREE.Group(); knob.position.set(0, H + 0.0026, 0.043); tilt.add(knob);
    at(cyl(0.021, 0.022, 0.004, new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.45 }), 40), 0, 0.002, 0, knob);
    const bar = box(0.038, 0.007, 0.009, new THREE.MeshStandardMaterial({ color: 0x33383e, roughness: 0.5 }), 0.003); bar.position.y = 0.006; knob.add(bar);
    const ptr = box(0.012, 0.0005, 0.0018, M.emissive(0xf5f5f0, 0.4)); ptr.position.set(-0.012, 0.0096, 0); knob.add(ptr);
    knob.rotation.y = (110 + 90) * Math.PI / 180 - Math.PI / 2; // pointing to V⎓
    // jacks
    const jack = x => { const j = new THREE.Group(); at(cyl(0.0048, 0.0048, 0.002, MAT.black, 24), 0, 0.001, 0, j); at(cyl(0.0022, 0.0022, 0.0022, MAT.chip, 16), 0, 0.0012, 0, j); j.position.set(x, H + 0.0026, 0.077); tilt.add(j); return j; };
    jack(-0.0272); const jackCom = jack(0); const jackRed = jack(0.0272);
    [[jackCom, 0x1b1b1d], [jackRed, 0xc8231d]].forEach(([j, c]) => { at(cyl(0.0036, 0.0036, 0.014, wireMat(c), 18), 0, 0.009, 0, j); });
    function setValue(v, unit = 'V', mode = 'DC') {
      lctx.fillStyle = '#b7c0a6'; lctx.fillRect(0, 0, 512, 256);
      const gr = lctx.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)'); lctx.fillStyle = gr; lctx.fillRect(0, 0, 512, 256);
      let s = !isFinite(v) ? ' OL ' : (Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(3));
      if (s.replace('.', '').replace('-', '').length > 4) s = v.toFixed(Math.max(0, 3 - Math.floor(Math.log10(Math.abs(v)))));
      const str = (v < 0 ? '-' : ' ') + s.replace('-', '');
      draw7(lctx, str, 30, 58, 128, '#1d221c', 'rgba(40,50,35,0.07)');
      lctx.fillStyle = '#1d221c'; lctx.font = '800 40px Inter, sans-serif'; lctx.textAlign = 'right'; lctx.fillText(unit, 490, 186);
      lctx.font = '800 26px Inter, sans-serif'; lctx.textAlign = 'left'; lctx.fillText(mode, 26, 36); lctx.fillText('AUTO', 110, 36); lctx.fillText('TRUE RMS', 330, 36);
      lt.needsUpdate = true;
    }
    setValue(0);
    g.traverse(m => { if (m.isMesh && m !== win) m.castShadow = true; });
    return { group: g, setValue, jackRed, jackCom };
  }

  /* ---------------------------------------------------------------- 1. NTC probe, beaker, stirrer, fan */
  function buildNTC() {
    const S = { key: 'ntc', title: 'NTC probe' };
    const root = new THREE.Group(); scene.add(root);
    // magnetic stirrer + beaker
    const stirPos = V3(-0.235, Y0, -0.12);
    const stirrer = new THREE.Group(); stirrer.position.copy(stirPos); root.add(stirrer);
    at(box(0.12, 0.048, 0.13, M.paintedSteel(0xe9e8e2), 0.008), 0, 0.024, 0, stirrer);
    at(box(0.104, 0.004, 0.104, new THREE.MeshStandardMaterial({ color: 0xdcdcd6, roughness: 0.35, metalness: 0.2 }), 0.004), 0, 0.05, -0.006, stirrer);
    const knobS = cyl(0.009, 0.009, 0.008, M.plastic(0x2a2e33, 0.4), 24); knobS.rotation.x = Math.PI / 2; at(knobS, 0.028, 0.022, 0.067, stirrer);
    const stirLed = box(0.004, 0.002, 0.001, M.emissive(0x3aff7a, 0.1)); at(stirLed, -0.03, 0.03, 0.0652, stirrer);
    const stirLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.012), new THREE.MeshStandardMaterial({ map: canvasTexture(256, 64, (c, w, h) => { c.fillStyle = '#3a4048'; c.fillRect(0, 0, w, h); c.fillStyle = '#eef0f2'; c.font = '700 26px Inter, sans-serif'; c.fillText('MAG STIR', 12, 42); }, { key: 'sb-stirlbl' }), roughness: 0.5 })); at(stirLabel, -0.02, 0.035, 0.0652, stirrer);
    const beaker = new THREE.Group(); beaker.position.copy(stirPos).add(V3(0, 0.052, -0.006)); root.add(beaker);
    const bR = 0.034, bH = 0.095;
    const bGlass = MAT.glass.clone();
    const bgl = mesh(new THREE.CylinderGeometry(bR, bR, bH, 48, 1, true), bGlass, false); bgl.position.y = bH / 2; beaker.add(bgl);
    const bot = mesh(new THREE.CircleGeometry(bR, 48), bGlass, false); bot.rotation.x = -Math.PI / 2; bot.position.y = 0.001; beaker.add(bot);
    const lip = mesh(new THREE.TorusGeometry(bR + 0.0008, 0.0012, 8, 48), bGlass, false); lip.rotation.x = Math.PI / 2; lip.position.y = bH; beaker.add(lip);
    const grad = canvasTexture(256, 512, (c, w, h) => { c.clearRect(0, 0, w, h); c.strokeStyle = 'rgba(255,255,255,0.85)'; c.fillStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 3; c.font = '700 26px Inter, sans-serif'; for (let i = 1; i <= 10; i++) { const y = h - i * h / 11.5; c.beginPath(); c.moveTo(20, y); c.lineTo(i % 2 === 0 ? 90 : 60, y); c.stroke(); if (i % 2 === 0) c.fillText(String(i * 25), 100, y + 9); } c.fillText('mL', 100, 40); }, { srgb: true, key: 'sb-grad' });
    const gm = new THREE.Mesh(new THREE.CylinderGeometry(bR + 0.0003, bR + 0.0003, bH * 0.9, 32, 1, true, -0.5, 0.9), new THREE.MeshBasicMaterial({ map: grad, transparent: true, depthWrite: false })); gm.position.y = bH * 0.45; beaker.add(gm);
    const wH = 0.066;
    const water = mesh(new THREE.CylinderGeometry(bR - 0.0012, bR - 0.0012, wH, 40), MAT.water, false); water.position.y = wH / 2 + 0.0012; beaker.add(water);
    const stirBar = mesh(new THREE.CapsuleGeometry(0.0034, 0.018, 6, 12), M.plasticWhite()); stirBar.rotation.z = Math.PI / 2; stirBar.position.y = 0.0048; beaker.add(stirBar);
    // steam & ice
    const steam = pointPool(60, 0.012, THREE.NormalBlending); steam.pts.material.opacity = 0.35; beaker.add(steam.pts);
    const steamP = Array.from({ length: 60 }, () => ({ x: 0, y: -1, z: 0, v: 0, a: 1 }));
    const ice = new THREE.Group(); beaker.add(ice);
    const iceM = new THREE.MeshPhysicalMaterial({ color: 0xeaf6ff, roughness: 0.15, transparent: true, opacity: 0.55, clearcoat: 1, depthWrite: false });
    for (let i = 0; i < 4; i++) { const c = box(0.013, 0.011, 0.013, iceM, 0.002); c.position.set(Math.cos(i * 1.7) * 0.016, wH - 0.002, Math.sin(i * 1.7) * 0.016); c.rotation.set(i, i * 0.7, 0.3); ice.add(c); }
    // fan (moving-air medium)
    const fan = new THREE.Group(); fan.position.set(-0.275, Y0 + 0.056, 0.085); fan.rotation.y = 1.05; root.add(fan);
    const fr = mesh(new THREE.TorusGeometry(0.037, 0.004, 10, 40), MAT.black); fan.add(fr);
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => at(box(0.012, 0.012, 0.024, MAT.black, 0.002), a * 0.034, b * 0.034, 0, fan));
    const blades = new THREE.Group(); fan.add(blades);
    at(cyl(0.013, 0.013, 0.014, MAT.black, 24), 0, 0, 0, blades).rotation.x = Math.PI / 2;
    for (let i = 0; i < 7; i++) { const b = box(0.024, 0.0016, 0.012, M.plastic(0x2a2d31, 0.5), 0.0006); b.position.set(Math.cos(i / 7 * TAU) * 0.022, Math.sin(i / 7 * TAU) * 0.022, 0); b.rotation.z = i / 7 * TAU; b.rotateX(0.5); blades.add(b); }
    at(box(0.03, 0.018, 0.02, MAT.black, 0.002), 0, -0.046, 0, fan);
    // the probe
    const probe = new THREE.Group(); root.add(probe);
    const sheathL = 0.05, r = 0.003;
    const tip = mesh(new THREE.SphereGeometry(r, 32, 16, 0, TAU, Math.PI / 2, Math.PI / 2), MAT.steel); probe.add(tip);
    const sheathFull = cyl(r, r, sheathL, MAT.steel, 40, true); sheathFull.position.y = sheathL / 2; probe.add(sheathFull);
    const sheathBack = cyl(r, r, sheathL, MAT.steel, 40, true, Math.PI / 2, Math.PI); sheathBack.position.y = sheathL / 2; sheathBack.material = MAT.steel.clone(); sheathBack.material.side = THREE.DoubleSide; probe.add(sheathBack);
    const sheathFront = cyl(r, r, sheathL, MAT.steel.clone(), 40, true, -Math.PI / 2, Math.PI); sheathFront.position.y = sheathL / 2; sheathFront.material.transparent = true; sheathFront.material.side = THREE.DoubleSide; probe.add(sheathFront);
    const tipFront = mesh(new THREE.SphereGeometry(r, 24, 12, -Math.PI / 2, Math.PI, Math.PI / 2, Math.PI / 2), sheathFront.material); probe.add(tipFront);
    const shrink = cyl(0.0034, 0.0032, 0.016, MAT.rubberBlack, 24); shrink.position.y = sheathL + 0.007; probe.add(shrink);
    const inner = new THREE.Group(); probe.add(inner);
    const epoxy = cyl(0.0026, 0.0026, 0.046, MAT.epoxy, 24); epoxy.position.y = 0.024; inner.add(epoxy);
    const beadMat = new THREE.MeshPhysicalMaterial({ color: 0x2a1a12, roughness: 0.25, clearcoat: 1, emissive: 0x000000 });
    const bead = mesh(new THREE.SphereGeometry(0.00105, 20, 14), beadMat); bead.scale.set(1, 1.35, 1); bead.position.y = 0.0028; inner.add(bead);
    const beadGlass = mesh(new THREE.SphereGeometry(0.0014, 20, 14), MAT.glass, false); beadGlass.scale.set(1, 1.3, 1); beadGlass.position.y = 0.0029; inner.add(beadGlass);
    [-1, 1].forEach(s => { const ld = cyl(0.00012, 0.00012, 0.042, M.copper(), 6); ld.position.set(s * 0.0005, 0.025, 0); inner.add(ld); });
    inner.visible = false;
    // cable (rebuilt when the probe moves)
    let cable = null; const cableEnd = hole(42, 'd'); dupont(scene, cableEnd.x, cableEnd.y, cableEnd.z); dupont(scene, ...hole(46, 'B-').toArray());
    const resting = { pos: V3(-0.19, Y0 + 0.0032, 0.085), rot: new THREE.Euler(0, 0.4, Math.PI / 2) };
    const inWater = { pos: beaker.position.clone().add(V3(0.012, 0.012, 0.004)), rot: new THREE.Euler(0.02, 0, -0.1) };
    const qA = new THREE.Quaternion().setFromEuler(resting.rot), qB = new THREE.Quaternion().setFromEuler(inWater.rot);
    let place = 1, placeTarget = 1, lift = 0, cableKey = '';
    function rebuildCable() {
      probe.updateMatrixWorld(true);
      const top = probe.localToWorld(V3(0, sheathL + 0.015, 0)), dir = probe.localToWorld(V3(0, sheathL + 0.04, 0)).sub(top).normalize();
      const key = top.toArray().map(v => v.toFixed(4)).join(',');
      if (key === cableKey) return; cableKey = key;
      if (cable) { root.remove(cable); cable.geometry.dispose(); }
      const e = cableEnd.clone().add(V3(0, 0.0142, 0));
      const p1 = top.clone().addScaledVector(dir, 0.03);
      const mid = V3((p1.x + e.x) / 2 - 0.02, Math.max(Y0 + 0.004, Math.min(p1.y, 0.05)), (p1.z + e.z) / 2 + 0.03);
      cable = makePipe([top, p1, mid, V3(e.x - 0.03, Y0 + 0.004, e.z + 0.03), e.clone().add(V3(0, 0.012, 0)), e], { radius: 0.0016, material: MAT.cable, tension: 0.5, radial: 10 });
      root.add(cable);
    }
    // heat-flow particles around the tip
    const heat = pointPool(80, 0.0028); root.add(heat.pts);
    const heatP = Array.from({ length: 80 }, () => ({ a: Math.random() * TAU, h: Math.random() * 0.03, r: 0.012 * Math.random(), life: Math.random() }));
    // current dots along the divider path: 3V3 rail → R → node → cable → bead → cable → GND
    const cur = pointPool(90, 0.0014); scene.add(cur.pts); const curS = Array.from({ length: 90 }, (_, i) => i / 90);
    let curPath = null, curKey = '';
    function rebuildCurrentPath() {
      const key = cableKey; if (key === curKey) return; curKey = key;
      const pts = [];
      const a = hole(38, '+'), rp = resistor.group.position;
      pts.push(a.clone().add(V3(0, 0.002, 0)), V3(rp.x - 0.0064, bbTop + 0.004, rp.z), V3(rp.x, bbTop + 0.0045, rp.z), V3(rp.x + 0.0064, bbTop + 0.004, rp.z));
      if (cable) { const c = cable.curve; for (let i = 5; i >= 0; i--) pts.push(c.getPoint(i / 5)); }
      probe.updateMatrixWorld(true); pts.push(probe.localToWorld(V3(0.0005, 0.02, 0)), probe.localToWorld(V3(0.0003, 0.0035, 0)), probe.localToWorld(V3(-0.0003, 0.0035, 0)), probe.localToWorld(V3(-0.0005, 0.02, 0)));
      if (cable) { const c = cable.curve; for (let i = 0; i <= 5; i++) pts.push(c.getPoint(i / 5).add(V3(0.001, 0.001, 0.001))); }
      pts.push(hole(46, 'B-').add(V3(0, 0.002, 0)));
      curPath = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    }
    const hit = mesh(new THREE.BoxGeometry(0.16, 0.16, 0.2), MAT.hit, false); hit.position.copy(stirPos).add(V3(0.02, 0.07, 0.07)); hit.userData.sensor = 'ntc'; root.add(hit);
    const labelAnchor = new THREE.Object3D(); labelAnchor.position.copy(stirPos).add(V3(0, 0.175, 0)); root.add(labelAnchor);
    Object.assign(S, {
      root, hit, labelAnchor, probe,
      parts: [[bead, 'Glass-bead NTC thermistor<small>metal-oxide chip · 12.5 kΩ at 20 °C</small>', [0.004, 0, 0], 'r'], [epoxy, 'Epoxy potting<small>heat capacity that sets τ</small>', [-0.004, -0.008, 0], 'l'], [sheathBack, 'Stainless-steel sheath', [0.004, 0.021, 0], 'r']],
      focus() { probe.updateMatrixWorld(true); const c = probe.localToWorld(V3(0, 0.022, 0)); if (placeTarget > 0.5) c.y += 0.015; return { pos: c.clone().add(placeTarget > 0.5 ? V3(-0.085, 0.045, 0.135) : V3(0.01, 0.08, 0.1)), target: c }; },
      setOpen(f) {
        bGlass.opacity = 0.16 - 0.11 * f; gm.material.opacity = 1 - f; gm.visible = f < 0.98; MAT.water.opacity = 0.32 - 0.2 * f;
        inner.visible = f > 0.02;
        sheathFull.visible = f < 0.02; tip.visible = f < 0.02;
        sheathBack.visible = f >= 0.02; sheathFront.visible = f >= 0.02; tipFront.visible = f >= 0.02;
        sheathFront.material.opacity = 1 - 0.92 * f; sheathFront.position.z = 0.0 + f * 0.0; sheathFront.position.x = 0;
        const off = f * 0.006; sheathFront.position.set(0, sheathL / 2, 0); sheathFront.translateZ(off); tipFront.position.set(0, 0, off);
      },
      update(dt, t, r, st, open) {
        const medium = st.medium || 'stirred';
        placeTarget = (medium === 'stirred' || medium === 'water') ? 1 : 0;
        const prev = place; place += clamp(placeTarget - place, -dt * 1.6, dt * 1.6);
        if (prev !== place && place === placeTarget) S.moved = true;   // lets the camera follow the probe
        // step test in water: the probe is held just above the water, then plunged
        const prevLift = lift; lift += clamp((r.plunge === 0 ? 1 : 0) - lift, -dt * 2.5, dt * 2.5);
        const k = ease(place);
        probe.position.lerpVectors(resting.pos, inWater.pos, k); probe.position.y += Math.sin(k * Math.PI) * 0.09 + ease(lift) * 0.062;
        probe.quaternion.slerpQuaternions(qA, qB, k);
        if (prev !== place || prevLift !== lift || !cable) rebuildCable();
        rebuildCurrentPath();
        // water & stirring
        const stirred = medium === 'stirred';
        stirBar.rotation.y += dt * (stirred ? 22 : 0); stirLed.material.emissiveIntensity = stirred ? 3 : 0.1;
        blades.rotation.z += dt * (medium === 'breeze' ? 40 : 0);
        const Tw = r.x ?? 20; ice.visible = Tw < 4; ice.children.forEach((c, i) => { c.position.y = wH - 0.002 + Math.sin(t * 1.3 + i) * 0.0008; });
        // steam wisps above 45 °C
        const sr = clamp((Tw - 45) / 15, 0, 1);
        steamP.forEach((p, i) => {
          if (p.y < 0 || p.y > 0.09) { if (Math.random() < sr * dt * 3) { p.x = (Math.random() - 0.5) * 0.04; p.z = (Math.random() - 0.5) * 0.04; p.y = wH; p.v = 0.01 + Math.random() * 0.012; } else { p.y = -1; } }
          else { p.y += p.v * dt; p.x += Math.sin(t * 2 + i) * dt * 0.004; }
          const a = p.y > 0 ? 0.6 * (1 - (p.y - wH) / 0.09) : 0;
          steam.pos.set([p.x, p.y > 0 ? p.y : -9, p.z], i * 3); steam.col.set([a, a, a], i * 3);
        });
        steam.dirty();
        // bead colour = element temperature (blue cold → red hot)
        const Te = r.y ?? Tw; const u = clamp((Te + 5) / 65, 0, 1);
        beadMat.emissive.setHSL(0.62 - 0.62 * u, 0.9, 0.5); beadMat.emissiveIntensity = open > 0.5 ? 1.2 : 0.0;
        // heat flow: particles move inwards when the medium is warmer than the element
        const dT = Tw - Te; const n = Math.min(80, Math.round(Math.abs(dT) * 8)); probe.updateMatrixWorld(true);
        heatP.forEach((p, i) => {
          p.life += dt * 0.8; if (p.life > 1) { p.life = 0; p.a = Math.random() * TAU; p.h = Math.random() * 0.03; }
          const rr = dT > 0 ? 0.013 * (1 - p.life) + 0.0032 : 0.0032 + 0.013 * p.life;
          const w = probe.localToWorld(V3(Math.cos(p.a) * rr, 0.002 + p.h, Math.sin(p.a) * rr));
          const on = i < n && open > 0.5; const c = dT > 0 ? [1, 0.45, 0.12] : [0.3, 0.6, 1];
          heat.pos.set(on ? [w.x, w.y, w.z] : [0, -9, 0], i * 3); heat.col.set(c.map(v => v * (0.4 + 0.6 * Math.sin(p.life * Math.PI))), i * 3);
        });
        heat.dirty();
        // current dots (speed ∝ current)
        if (curPath) {
          const I = r.I ?? 1.5e-4; const sp = clamp(I / 1.5e-4, 0.05, 6) * 0.06 * dt;
          for (let i = 0; i < 90; i++) { curS[i] = (curS[i] + sp) % 1; const p = curPath.getPointAt(curS[i]); const on = open > 0.5; cur.pos.set(on ? [p.x, p.y, p.z] : [0, -9, 0], i * 3); cur.col.set([1, 0.85, 0.25], i * 3); }
          cur.dirty();
        }
      }
    });
    return S;
  }

  /* ---------------------------------------------------------------- 2. capacitive RH module */
  function buildRH() {
    const S = { key: 'rh', title: 'RH module' };
    const root = new THREE.Group(); root.position.set(-0.115, Y0, 0.155); root.rotation.y = 0.25; scene.add(root);
    const W = 0.024, D = 0.018;
    const tex = canvasTexture(480, 360, (ctx, w, h) => {
      ctx.fillStyle = '#1d4f91'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(120,170,230,0.4)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(60, 300); ctx.lineTo(180, 300); ctx.lineTo(260, 220); ctx.moveTo(300, 250); ctx.lineTo(420, 250); ctx.stroke();
      ctx.fillStyle = '#f0f3f7'; ctx.font = '800 34px Inter, sans-serif'; ctx.fillText('RH-C', 300, 70); ctx.font = '700 22px Inter, sans-serif'; ctx.fillText('HS1101LF', 300, 105);
      ['VCC', 'GND', 'OUT'].forEach((t, i) => ctx.fillText(t, 360, 180 + i * 50));
      ctx.strokeStyle = '#f0f3f7'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(140, 150, 105, 0, TAU); ctx.stroke();
      for (let i = 0; i < 3; i++) { ctx.fillStyle = '#d5d9de'; ctx.beginPath(); ctx.arc(445, 172 + i * 50, 13, 0, TAU); ctx.fill(); }
    }, { key: 'sb-rhpcb' });
    at(box(W, 0.0016, D, pcbMat(0x1d4f91), 0.0005), 0, 0.0008, 0, root);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.0003, D - 0.0003), pcbMat(0, tex)); top.rotation.x = -Math.PI / 2; top.position.y = 0.00162; root.add(top);
    // element: slotted housing with PTFE filter
    const el = new THREE.Group(); el.position.set(-0.005, 0.0016, -0.0015); root.add(el);
    const housing = cyl(0.0048, 0.0052, 0.0042, M.plastic(0xe7e3d6, 0.5), 32); housing.position.y = 0.0021; el.add(housing);
    const filt = cyl(0.0042, 0.0042, 0.0006, new THREE.MeshStandardMaterial({ color: 0xfbfbf7, roughness: 0.95 }), 32); filt.position.y = 0.0045; el.add(filt);
    const chipIn = box(0.0036, 0.0004, 0.0036, MAT.gold); chipIn.position.y = 0.0042; chipIn.visible = false; el.add(chipIn);
    // op-amp + passives + header
    at(box(0.0049, 0.0015, 0.0039, MAT.chip, 0.0002), 0.0055, 0.0024, -0.004, root);
    for (let i = 0; i < 4; i++) [-1, 1].forEach(s => at(box(0.0004, 0.0003, 0.0009, MAT.tin), 0.0036 + i * 0.00127, 0.0018, -0.004 + s * 0.0024, root));
    [[0.004, 0.0035], [0.0065, 0.0035], [0.0015, 0.0065]].forEach(([x, z]) => { at(box(0.0016, 0.0006, 0.0008, M.plastic(0x8a6a4a, 0.5)), x, 0.0019, z, root); });
    const pins = [];
    for (let i = 0; i < 3; i++) { const x = 0.0098, z = -0.0025 + (i - 1) * 0.00254 + 0.0025; at(box(0.00064, 0.0085, 0.00064, MAT.gold), x, 0.0045, z, root); pins.push(root.localToWorld(V3(x, 0.0016, z))); }
    at(box(0.0025, 0.0025, 0.0076, MAT.headerPlastic), 0.0098, 0.00285, 0.0025 - 0.0025 + 0.00, root);
    root.updateMatrixWorld(true); pins.length = 0; for (let i = 0; i < 3; i++) pins.push(root.localToWorld(V3(0.0098, 0.0016 + 0.0055, (i - 1) * 0.00254)));
    // magnified cross-section (micro-view)
    const micro = new THREE.Group(); micro.position.set(0.0, 0.058, -0.004); root.add(micro);
    const MW = 0.072, MD = 0.036;
    const sub = box(MW, 0.006, MD, MAT.silicon, 0.0006); sub.position.y = 0.003; micro.add(sub);
    const bottomE = box(MW * 0.94, 0.0016, MD * 0.9, MAT.gold); bottomE.position.y = 0.0068; micro.add(bottomE);
    const poly = box(MW * 0.94, 0.011, MD * 0.9, MAT.polymer, 0.0004); poly.position.y = 0.0131; micro.add(poly);
    const strips = new THREE.Group(); micro.add(strips);
    for (let i = 0; i < 7; i++) { const s = box(MW * 0.94 / 7 * 0.62, 0.0014, MD * 0.9, MAT.gold); s.position.set(-MW * 0.47 + (i + 0.5) * MW * 0.94 / 7, 0.0193, 0); strips.add(s); }
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(MW, 0.045, MD)), new THREE.LineBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.35 })); frame.position.y = 0.0225; micro.add(frame);
    const beam = mesh(new THREE.CylinderGeometry(0.02, 0.003, 0.046, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }), false); beam.position.set(-0.005, 0.03, -0.002); root.add(beam);
    // field lines between the electrodes
    const fieldM = new THREE.MeshBasicMaterial({ color: 0xffe07a, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
    const field = new THREE.Group(); micro.add(field);
    for (let i = 0; i < 14; i++) { const f = mesh(new THREE.CylinderGeometry(0.00025, 0.00025, 0.0105, 6), fieldM, false); f.position.set(-MW * 0.44 + i * MW * 0.88 / 13, 0.0131, (i % 2 ? 0.006 : -0.006)); field.add(f); }
    // water molecules (instanced, merged O + 2 H with vertex colours)
    const molGeo = (() => {
      const o = new THREE.SphereGeometry(0.0016, 12, 8), h1 = new THREE.SphereGeometry(0.00105, 10, 6), h2 = h1.clone();
      const ang = 104.5 / 2 * Math.PI / 180, d = 0.0019; h1.translate(Math.sin(ang) * d, -Math.cos(ang) * d, 0); h2.translate(-Math.sin(ang) * d, -Math.cos(ang) * d, 0);
      const paint = (g, c) => { const col = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < col.length; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g; };
      return mergeGeos([paint(o, new THREE.Color(0xe0453a)), paint(h1, new THREE.Color(0xf4f4f4)), paint(h2, new THREE.Color(0xf4f4f4))]);
    })();
    const NMOL = 150;
    const mols = new THREE.InstancedMesh(molGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 }), NMOL); mols.frustumCulled = false; micro.add(mols);
    const polyY = [0.0082, 0.0182], airY = [0.0215, 0.044], lim = [MW * 0.45, MD * 0.42];
    const molS = Array.from({ length: NMOL }, (_, i) => ({ reg: i < 30 ? 'poly' : 'air', p: V3((Math.random() - 0.5) * 2 * lim[0], 0, (Math.random() - 0.5) * 2 * lim[1]), v: V3(), rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), on: true, trans: 0 }));
    molS.forEach(m => { m.p.y = m.reg === 'poly' ? lerp(polyY[0], polyY[1], Math.random()) : lerp(airY[0], airY[1], Math.random()); });
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), one = V3(1, 1, 1), zero = V3(0, 0, 0);
    micro.visible = false; beam.visible = false;
    const hit = mesh(new THREE.BoxGeometry(0.045, 0.03, 0.04), MAT.hit, false); hit.position.y = 0.01; hit.userData.sensor = 'rh'; root.add(hit);
    const labelAnchor = new THREE.Object3D(); labelAnchor.position.set(0, 0.03, 0); root.add(labelAnchor);
    Object.assign(S, {
      root, hit, labelAnchor, pins,
      parts: [[poly, 'Polyimide dielectric<small>absorbs H₂O · ε<sub>r</sub> rises with RH</small>', [0.038, 0.002, 0], 'r'], [strips, 'Porous top electrode<small>lets water vapour in</small>', [-0.038, 0.004, 0], 'l'], [bottomE, 'Bottom electrode on silicon', [0.038, -0.006, 0], 'r'], [el, 'Sensing element<small>C ≈ 162–194 pF</small>', [0.007, 0.004, 0], 'r']],
      focus() { root.updateMatrixWorld(true); const c = root.localToWorld(V3(0, 0.05, 0)); return { pos: c.clone().add(V3(0.03, 0.06, 0.16)), target: c }; },
      setOpen(f) { micro.visible = beam.visible = f > 0.02; micro.scale.setScalar(Math.max(0.001, f)); filt.position.y = 0.0045 + f * 0.012; chipIn.visible = f > 0.02; beam.material.opacity = 0.06 * f; },
      update(dt, t, r, st, open) {
        if (open < 0.02) return;
        const RHpoly = clamp(r.RHs ?? 50, 0, 100), RHair = clamp(r.x ?? 50, 0, 100);
        const Tair = st.Tair ?? 22;
        const wantPoly = Math.round(10 + 80 * RHpoly / 100);
        const ea = RHair / 100 * 0.6108 * Math.exp(17.27 * Tair / (Tair + 237.3));
        const wantAir = Math.round(clamp(ea / 4.24, 0, 1) * 55) + 2; // relative to saturation at 30 °C
        if (!S._init) { // start in equilibrium with the current state
          S._init = true;
          molS.forEach((m, i) => { m.trans = 0; m.on = i < wantPoly + wantAir; m.reg = i < wantPoly ? 'poly' : 'air'; m.p.y = m.reg === 'poly' ? lerp(polyY[0], polyY[1], Math.random()) : lerp(airY[0], airY[1], Math.random()); });
        }
        let nPoly = 0; molS.forEach(m => { if (m.on && (m.reg === 'poly' || m.trans > 0)) nPoly++; });
        // exchange: absorb or desorb up to two molecules per frame (the physical time constant lives in r.RHs)
        for (let n = 0; n < 2; n++) {
          if (nPoly < wantPoly) { const m = molS.find(m => m.on && m.reg === 'air' && m.trans === 0); if (m) { m.trans = 1; nPoly++; } }
          else if (nPoly > wantPoly + 1) { const m = molS.find(m => m.on && m.reg === 'poly' && m.trans === 0); if (m) { m.trans = -1; nPoly--; } }
        }
        // number in the air follows the vapour density
        for (let n = 0; n < 2; n++) {
          const airOn = molS.filter(m => m.on && m.reg === 'air' && m.trans === 0).length;
          if (airOn < wantAir) { const m = molS.find(m => !m.on); if (m) { m.on = true; m.trans = 0; m.reg = 'air'; m.p.set((Math.random() - 0.5) * 2 * lim[0], airY[1], (Math.random() - 0.5) * 2 * lim[1]); } }
          else if (airOn > wantAir + 2) { const m = molS.find(m => m.on && m.reg === 'air' && m.trans === 0); if (m) m.on = false; }
        }
        const field01 = 0.5 + 0.5 * Math.sin(t * 6);
        molS.forEach((m, i) => {
          if (!m.on) { m4.compose(zero, qq, zero); mols.setMatrixAt(i, m4); return; }
          const sp = m.reg === 'air' ? 0.02 : 0.004;
          m.v.x += (Math.random() - 0.5) * sp; m.v.y += (Math.random() - 0.5) * sp; m.v.z += (Math.random() - 0.5) * sp; m.v.multiplyScalar(0.9);
          if (m.trans === 1) { m.v.y = -0.012; m.v.x *= 0.3; }
          if (m.trans === -1) { m.v.y = 0.012; m.v.x *= 0.3; }
          m.p.addScaledVector(m.v, dt);
          m.p.x = clamp(m.p.x, -lim[0], lim[0]); m.p.z = clamp(m.p.z, -lim[1], lim[1]);
          if (m.trans === 1 && m.p.y < polyY[1] - 0.001) { m.trans = 0; m.reg = 'poly'; }
          if (m.trans === -1 && m.p.y > airY[0] + 0.001) { m.trans = 0; m.reg = 'air'; }
          if (m.trans === 0) { const Y = m.reg === 'poly' ? polyY : airY; if (m.p.y < Y[0]) { m.p.y = Y[0]; m.v.y = Math.abs(m.v.y); } if (m.p.y > Y[1]) { m.p.y = Y[1]; m.v.y = -Math.abs(m.v.y); } }
          if (m.reg === 'poly' && m.trans === 0) { m.rot.z = Math.sin(t * 6 + i) * 0.5 * field01; m.rot.x = 0.2; } else { m.rot.x += dt * 1.5; m.rot.y += dt * 1.1; }
          qq.setFromEuler(m.rot); m4.compose(m.p, qq, one); mols.setMatrixAt(i, m4);
        });
        mols.instanceMatrix.needsUpdate = true;
        fieldM.opacity = 0.18 + 0.35 * field01 * (0.4 + 0.6 * RHpoly / 100);
      }
    });
    return S;
  }

  /* ---------------------------------------------------------------- 3. quantum (PAR) sensor under an LED panel */
  function buildPAR() {
    const S = { key: 'par', title: 'PAR sensor' };
    const root = new THREE.Group(); root.position.set(0.045, Y0, -0.14); scene.add(root);
    // levelling base with bubble level
    at(box(0.046, 0.005, 0.046, MAT.anod, 0.0015), 0, 0.0025, 0, root);
    [[1, 1], [1, -1], [-1, 0]].forEach(([a, b]) => at(cyl(0.0022, 0.0022, 0.0022, MAT.steel, 12), a * 0.018, 0.006, b * 0.018, root));
    const bub = new THREE.Group(); bub.position.set(0.012, 0.005, 0.0125); root.add(bub);
    at(cyl(0.0042, 0.0042, 0.0022, MAT.alu, 20), 0, 0.0011, 0, bub); at(cyl(0.0034, 0.0034, 0.0006, new THREE.MeshPhysicalMaterial({ color: 0xc6f07a, roughness: 0.1, transparent: true, opacity: 0.8 }), 20), 0, 0.0023, 0, bub);
    at(mesh(new THREE.SphereGeometry(0.0012, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1 })), 0, 0.0024, 0, bub).scale.y = 0.4;
    // sensor head: housing halves, diffuser dome, filter, photodiode
    const head = new THREE.Group(); head.position.y = 0.005; root.add(head);
    const HR = 0.0118, HH = 0.028;
    const housingFull = cyl(HR, HR, HH, MAT.anod, 48); housingFull.position.y = HH / 2; head.add(housingFull);
    const housingBack = cyl(HR, HR, HH, MAT.anod.clone(), 48, true, Math.PI / 2, Math.PI); housingBack.material.side = THREE.DoubleSide; housingBack.position.y = HH / 2; head.add(housingBack);
    const cutFace = mesh(new THREE.PlaneGeometry(HR * 2, HH), new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.6, side: THREE.DoubleSide })); cutFace.position.y = HH / 2; head.add(cutFace);
    const ring = mesh(new THREE.TorusGeometry(HR - 0.0006, 0.0009, 10, 48), MAT.alu); ring.rotation.x = Math.PI / 2; ring.position.y = HH; head.add(ring);
    const optics = new THREE.Group(); head.add(optics);
    const domeG = new THREE.Group(); optics.add(domeG);
    const collar = cyl(0.0095, 0.0095, 0.003, MAT.diffuser, 40); collar.position.y = HH + 0.0015; domeG.add(collar);
    const dome = mesh(new THREE.SphereGeometry(0.0095, 40, 20, 0, TAU, 0, Math.PI / 2), MAT.diffuser); dome.position.y = HH + 0.003; dome.scale.y = 0.78; domeG.add(dome);
    const filter = cyl(0.0082, 0.0082, 0.0016, MAT.filterGlass, 40); filter.position.y = HH - 0.004; optics.add(filter);
    const carrier = box(0.009, 0.0014, 0.009, MAT.ceramic, 0.0004); carrier.position.y = HH - 0.009; optics.add(carrier);
    const pd = box(0.0055, 0.0005, 0.0055, MAT.diodeSi, 0.0002); pd.position.y = HH - 0.0081; optics.add(pd);
    const bond = makePipe([[0.0024, HH - 0.0078, 0.0024], [0.0036, HH - 0.0068, 0.0028], [0.0042, HH - 0.0082, 0.0038]], { radius: 0.00008, material: MAT.gold, radial: 4 }); optics.add(bond);
    const leadPath = new THREE.CatmullRomCurve3([V3(0.0042, HH - 0.0085, 0.0038), V3(0.004, HH - 0.014, 0.003), V3(0.003, 0.006, 0.002), V3(0.002, 0.001, 0.0)]);
    optics.add(new THREE.Mesh(new THREE.TubeGeometry(leadPath, 24, 0.00025, 5), M.copper()));
    // cable from the base to the amplifier board
    const amp = new THREE.Group(); amp.position.set(-0.05, 0, 0.035); root.add(amp);
    at(box(0.026, 0.0016, 0.018, pcbMat(0x1e6b3a), 0.0005), 0, 0.0008, 0, amp);
    at(box(0.0049, 0.0015, 0.0039, MAT.chip, 0.0002), -0.003, 0.0024, 0, amp);
    const rtia = buildResistorSmall(); rtia.position.set(0.004, 0.0016, -0.004); amp.add(rtia);
    const ampLbl = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.005), new THREE.MeshBasicMaterial({ map: canvasTexture(256, 64, (c, w, h) => { c.fillStyle = '#1e6b3a'; c.fillRect(0, 0, w, h); c.fillStyle = '#f0f4f0'; c.font = '800 30px Inter, sans-serif'; c.fillText('TIA  I→V', 16, 42); }, { key: 'sb-tia' }) })); ampLbl.rotation.x = -Math.PI / 2; ampLbl.position.set(0, 0.00165, 0.0055); amp.add(ampLbl);
    const pinsL = []; for (let i = 0; i < 3; i++) { at(box(0.00064, 0.0085, 0.00064, MAT.gold), 0.011, 0.0045, (i - 1) * 0.00254, amp); }
    at(box(0.0025, 0.0025, 0.0076, MAT.headerPlastic), 0.011, 0.00285, 0, amp);
    root.add(makePipe([[0, 0.004, -0.021], [0, 0.003, -0.032], [-0.03, Y0, -0.02], [-0.05, 0.004, 0.02], [-0.05, 0.0035, 0.028]], { radius: 0.0019, material: MAT.cable, tension: 0.5, radial: 10 }));
    root.updateMatrixWorld(true); for (let i = 0; i < 3; i++) pinsL.push(amp.localToWorld(V3(0.011, 0.0016 + 0.0055, (i - 1) * 0.00254)));
    // LED grow panel on a stand
    const panelY = 0.19;
    const stand = new THREE.Group(); root.add(stand);
    at(box(0.07, 0.006, 0.05, MAT.anod, 0.002), -0.08, 0.003, -0.02, stand);
    at(cyl(0.0035, 0.0035, panelY + 0.02, MAT.steel, 16), -0.08, (panelY + 0.02) / 2, -0.02, stand);
    at(box(0.085, 0.006, 0.008, MAT.steel, 0.001), -0.04, panelY + 0.016, -0.02, stand);
    const panel = new THREE.Group(); panel.position.set(0, panelY, 0); root.add(panel);
    at(box(0.07, 0.006, 0.07, MAT.alu, 0.002), 0, 0.006, 0, panel);
    for (let i = 0; i < 9; i++) at(box(0.07, 0.009, 0.0016, M.anodised()), 0, 0.0135, -0.032 + i * 0.008, panel);
    const diodeGeo = new THREE.BoxGeometry(0.0034, 0.0012, 0.0034);
    const dMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 2, roughness: 0.3 });
    dMat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb;\n#endif'); };
    const nd = 36; const diodes = new THREE.InstancedMesh(diodeGeo, dMat, nd); const pat = ['r', 'r', 'b', 'r', 'w', 'r'];
    const dc = { r: new THREE.Color(0xff2436), b: new THREE.Color(0x3b5bff), w: new THREE.Color(0xfff0dc) }; const mm = new THREE.Matrix4();
    for (let i = 0; i < nd; i++) { const a = i % 6, b = Math.floor(i / 6); mm.makeTranslation(-0.026 + a * 0.0104, 0.0026, -0.026 + b * 0.0104); diodes.setMatrixAt(i, mm); diodes.setColorAt(i, dc[pat[(a + b) % 6]]); }
    panel.add(diodes);
    const glow = new THREE.PointLight(0xff9ad8, 0, 0.5, 2); glow.position.set(0, -0.01, 0); panel.add(glow);
    const cone = mesh(new THREE.CylinderGeometry(0.03, 0.02, panelY - 0.04, 40, 1, true), new THREE.MeshBasicMaterial({ color: 0xff8fd0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }), false);
    cone.position.y = (panelY - 0.04) / 2 + 0.035; root.add(cone);
    // photons
    const NP = 320; const ph = pointPool(NP, 0.0034); head.add(ph.pts);
    const phS = Array.from({ length: NP }, () => ({ on: false, p: V3(), v: V3(), nm: 550, stage: 0, flash: 0 }));
    const NE = 90; const el = pointPool(NE, 0.0022); head.add(el.pts); const elS = Array.from({ length: NE }, () => ({ on: false, s: 0 }));
    const nmColor = nm => { const c = new THREE.Color(); if (nm < 400) c.setRGB(0.55, 0.25, 1); else if (nm > 700) c.setRGB(0.6, 0.02, 0.05); else if (nm < 490) c.setRGB(0.2, 0.35, 1); else if (nm < 570) c.setRGB(0.3, 1, 0.45); else if (nm < 610) c.setRGB(1, 0.8, 0.2); else c.setRGB(1, 0.15, 0.12); return c; };
    const spawnNm = () => { const u = Math.random(); if (u < 0.05) return 380 + Math.random() * 15; if (u < 0.13) return 715 + Math.random() * 30; if (u < 0.55) return 650 + Math.random() * 20; if (u < 0.75) return 440 + Math.random() * 20; return 460 + Math.random() * 180; };
    let acc = 0;
    const hit = mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), MAT.hit, false); hit.position.y = 0.02; hit.userData.sensor = 'par'; root.add(hit);
    const hit2 = mesh(new THREE.BoxGeometry(0.08, 0.03, 0.08), MAT.hit, false); hit2.position.y = panelY + 0.01; hit2.userData.sensor = 'par'; root.add(hit2);
    const labelAnchor = new THREE.Object3D(); labelAnchor.position.set(0, 0.058, 0); root.add(labelAnchor);
    optics.visible = true; housingBack.visible = false; cutFace.visible = false;
    Object.assign(S, {
      root, hit, labelAnchor, pins: pinsL,
      parts: [[dome, 'Acrylic diffuser<small>cosine correction</small>', [0.012, 0.004, 0], 'r'], [filter, 'Optical filter<small>flat 400–700 nm photon response</small>', [0.011, 0, 0], 'r'], [pd, 'Si photodiode<small>1 photon → at most 1 electron</small>', [-0.012, 0, 0], 'l'], [amp, 'Transimpedance amplifier<small>V = I · R<sub>f</sub></small>', [0, 0.008, 0], 'r']],
      focus() { root.updateMatrixWorld(true); const c = root.localToWorld(V3(0, 0.04, 0)); return { pos: c.clone().add(V3(-0.02, 0.04, 0.14)), target: c }; },
      setOpen(f) {
        housingFull.visible = f < 0.02; housingBack.visible = cutFace.visible = f >= 0.02;
        cutFace.visible = false;
        domeG.position.y = f * 0.022; filter.position.y = HH - 0.004 + f * 0.012;
        MAT.diffuser.opacity = 1 - 0.45 * f; MAT.diffuser.depthWrite = f < 0.02;
      },
      update(dt, t, r, st, open) {
        const ppfd = r.x ?? 600; const k = clamp(ppfd / 2500, 0, 1);
        dMat.emissiveIntensity = 0.05 + 5.5 * k; glow.intensity = 0.035 * k; cone.material.opacity = 0.05 * k;
        if (open < 0.02) { if (ph.pts.visible) { ph.pts.visible = false; el.pts.visible = false; } return; }
        ph.pts.visible = el.pts.visible = true;
        const domeY = HH + 0.003 + domeG.position.y, filtY = filter.position.y, pdY = pd.position.y;
        acc += dt * 220 * k * open;
        while (acc > 1) { acc -= 1; const p = phS.find(p => !p.on); if (!p) break; p.on = true; p.stage = 0; p.flash = 0; p.nm = spawnNm(); p.p.set((Math.random() - 0.5) * 0.03, domeY + 0.05, (Math.random() - 0.5) * 0.03); p.v.set(-p.p.x * 0.5, -0.06, -p.p.z * 0.5); }
        phS.forEach((p, i) => {
          if (!p.on) { ph.pos.set([0, -9, 0], i * 3); return; }
          if (p.flash > 0) { p.flash -= dt; const c = nmColor(p.nm); ph.col.set([c.r * 3, c.g * 3, c.b * 3], i * 3); ph.pos.set([p.p.x, p.p.y, p.p.z], i * 3); if (p.flash <= 0) p.on = false; return; }
          p.p.addScaledVector(p.v, dt);
          if (p.stage === 0 && p.p.y < domeY + 0.004) { p.stage = 1; const a = Math.random() * TAU, s = Math.random() * 0.6; p.v.set(Math.cos(a) * s * 0.03 - p.p.x * 2, -0.04, Math.sin(a) * s * 0.03 - p.p.z * 2); }
          if (p.stage === 1 && p.p.y < filtY + 0.001) { p.stage = 2; if (p.nm < 400 || p.nm > 700) { p.flash = 0.25; p.v.set(0, 0, 0); } p.p.x = clamp(p.p.x, -0.007, 0.007); p.p.z = clamp(p.p.z, -0.007, 0.007); p.v.x *= 0.3; p.v.z *= 0.3; }
          if (p.stage === 2 && p.p.y < pdY + 0.0004) { p.on = false; const e = elS.find(e => !e.on); if (e) { e.on = true; e.s = 0; } }
          if (Math.abs(p.p.x) > 0.04 || p.p.y < 0) p.on = false;
          const c = nmColor(p.nm); ph.col.set([c.r, c.g, c.b], i * 3); ph.pos.set([p.p.x, p.p.y, p.p.z], i * 3);
        });
        ph.dirty();
        elS.forEach((e, i) => { if (!e.on) { el.pos.set([0, -9, 0], i * 3); return; } e.s += dt * 0.9; if (e.s >= 1) { e.on = false; return; } const q = leadPath.getPointAt(e.s); el.pos.set([q.x, q.y, q.z], i * 3); el.col.set([1, 0.9, 0.3], i * 3); });
        el.dirty();
      }
    });
    return S;
  }
  function buildResistorSmall() { const g = new THREE.Group(); at(box(0.002, 0.0006, 0.001, M.plastic(0x1a1a1a, 0.5)), 0, 0.0003, 0, g); [-1, 1].forEach(s => at(box(0.0004, 0.00062, 0.001, MAT.tin), s * 0.0009, 0.0003, 0, g)); return g; }

  /* ---------------------------------------------------------------- 4. NDIR CO₂ module */
  function buildNDIR() {
    const S = { key: 'co2', title: 'NDIR CO₂' };
    const root = new THREE.Group(); root.position.set(0.085, Y0, 0.16); root.rotation.y = -0.18; scene.add(root);
    const W = 0.04, D = 0.026;
    const tex = canvasTexture(640, 416, (ctx, w, h) => {
      ctx.fillStyle = '#1b5e36'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(140,210,160,0.35)'; ctx.lineWidth = 5; for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.moveTo(620, 40 + i * 50); ctx.lineTo(560, 40 + i * 50); ctx.lineTo(530, 70 + i * 40); ctx.stroke(); }
      ctx.fillStyle = '#eef4ee'; ctx.font = '800 28px Inter, sans-serif'; ctx.fillText('NDIR CO₂ · dual channel', 150, 395);
      ['VIN', 'GND', 'TX', 'RX'].forEach((t, i) => { ctx.font = '700 20px Inter, sans-serif'; ctx.fillText(t, 50, 131 + i * 40); ctx.fillStyle = '#d5d9de'; ctx.beginPath(); ctx.arc(22, 124 + i * 40, 11, 0, TAU); ctx.fill(); ctx.fillStyle = '#eef4ee'; });
    }, { key: 'sb-ndirpcb' });
    at(box(W, 0.0016, D, pcbMat(0x1b5e36), 0.0005), 0, 0.0008, 0, root);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.0003, D - 0.0003), pcbMat(0, tex)); top.rotation.x = -Math.PI / 2; top.position.y = 0.00162; root.add(top);
    // optical cavity
    const cav = new THREE.Group(); cav.position.set(0.0012, 0.0016, -0.001); root.add(cav);
    const CL = 0.03, CH = 0.009, CD = 0.016;
    const lowerM = MAT.goldCavity;
    const floorC = box(CL, 0.0008, CD, lowerM); floorC.position.y = 0.0004; cav.add(floorC);
    [-1, 1].forEach(s => { const wl = box(CL, CH, 0.0008, lowerM); wl.position.set(0, CH / 2, s * (CD / 2 - 0.0004)); cav.add(wl); });
    const lid = new THREE.Group(); lid.position.y = CH; cav.add(lid);
    const lidMat = new THREE.MeshStandardMaterial({ color: 0xe0b457, metalness: 1, roughness: 0.25, transparent: true, opacity: 1 });
    const lidB = box(CL + 0.0016, 0.0012, CD + 0.0016, lidMat, 0.0005); lidB.position.y = 0.0006; lid.add(lidB);
    const memTex = canvasTexture(256, 128, (c, w, h) => { c.fillStyle = '#f3f2ec'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(40,40,40,0.25)'; for (let y = 8; y < h; y += 12) for (let x = 8; x < w; x += 12) { c.beginPath(); c.arc(x, y, 2.2, 0, TAU); c.fill(); } }, { key: 'sb-mem' });
    const membrane = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.008), new THREE.MeshStandardMaterial({ map: memTex, roughness: 0.9, transparent: true })); membrane.rotation.x = -Math.PI / 2; membrane.position.y = 0.00125; lid.add(membrane);
    const endL = box(0.0012, CH, CD, lowerM); endL.position.set(-CL / 2 - 0.0006, CH / 2, 0); cav.add(endL);
    // lamp
    const lampG = new THREE.Group(); lampG.position.set(-CL / 2 + 0.0035, CH / 2, 0); cav.add(lampG);
    const bulb = mesh(new THREE.SphereGeometry(0.0022, 20, 14), MAT.glass, false); bulb.scale.set(1.2, 1, 1); lampG.add(bulb);
    const filMat = new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff6a1a, emissiveIntensity: 1, roughness: 0.5 });
    const filament = mesh(new THREE.TorusGeometry(0.0007, 0.00016, 6, 18, TAU * 1.6), filMat, false); filament.rotation.y = Math.PI / 2; lampG.add(filament);
    // detector (TO can) with two filtered windows
    const det = new THREE.Group(); det.position.set(CL / 2 + 0.0015, CH / 2, 0); cav.add(det);
    const can = cyl(0.0046, 0.0046, 0.0042, MAT.steel, 32); can.rotation.z = Math.PI / 2; det.add(can);
    const winA = box(0.0004, 0.0018, 0.0018, new THREE.MeshPhysicalMaterial({ color: 0x8a1c2a, roughness: 0.1, clearcoat: 1, iridescence: 0.7 })); winA.position.set(-0.0022, 0.0012, 0); det.add(winA);
    const winR = box(0.0004, 0.0018, 0.0018, new THREE.MeshPhysicalMaterial({ color: 0x2c4f8a, roughness: 0.1, clearcoat: 1, iridescence: 0.7 })); winR.position.set(-0.0022, -0.0012, 0); det.add(winR);
    const barA = box(0.0018, 1, 0.0018, M.emissive(0xff5a3a, 2.2)); barA.position.set(0.004, 0, 0.004); det.add(barA);
    const barR = box(0.0018, 1, 0.0018, M.emissive(0x5aa0ff, 2.2)); barR.position.set(0.004, 0, -0.004); det.add(barR);
    // pins
    const HX = -W / 2 + 0.0022;
    const pins = []; for (let i = 0; i < 4; i++) at(box(0.00064, 0.0085, 0.00064, MAT.gold), HX, 0.0045, -0.0038 + i * 0.00254, root);
    at(box(0.0025, 0.0025, 0.0102, MAT.headerPlastic), HX, 0.00285, -0.0038 + 1.5 * 0.00254, root);
    root.updateMatrixWorld(true); for (let i = 0; i < 4; i++) pins.push(root.localToWorld(V3(HX, 0.0016 + 0.0055, -0.0038 + i * 0.00254)));
    // photons along reflection paths (cavity local coords)
    const mkPath = (zs, yEnd) => { const pts = [V3(-CL / 2 + 0.005, CH / 2, 0)]; const n = zs.length; zs.forEach((z, i) => pts.push(V3(-CL / 2 + 0.005 + (i + 1) * (CL - 0.009) / (n + 1), CH / 2 + (i % 2 ? 0.0025 : -0.0025), z))); pts.push(V3(CL / 2 - 0.0005, CH / 2 + yEnd, 0)); return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1); };
    const pathsA = [mkPath([0.0065, -0.0065, 0.0065], 0.0012), mkPath([-0.006, 0.006, -0.006], 0.0012), mkPath([0.004, -0.0065, 0.002], 0.0012)];
    const pathsR = [mkPath([0.0065, -0.006, 0.0065], -0.0012), mkPath([-0.0065, 0.0055, -0.0045], -0.0012)];
    const NP = 200; const ph = pointPool(NP, 0.0026); cav.add(ph.pts);
    const phS = Array.from({ length: NP }, () => ({ on: false, path: null, s: 0, act: true, dead: 0 }));
    // CO₂ molecules: C (dark) + 2 O (red), linear
    const molGeo = (() => { const c = new THREE.SphereGeometry(0.0006, 12, 8), o1 = new THREE.SphereGeometry(0.00068, 12, 8), o2 = o1.clone(); o1.translate(0.00115, 0, 0); o2.translate(-0.00115, 0, 0); const paint = (g, col) => { const a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = col.r; a[i + 1] = col.g; a[i + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }; return mergeGeos([paint(c, new THREE.Color(0x2b2b2e)), paint(o1, new THREE.Color(0xe0453a)), paint(o2, new THREE.Color(0xe0453a))]); })();
    const NM = 60; const molMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0 });
    molMat.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFlash;\nvarying float vFlash;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlash = aFlash;'); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFlash;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vec3(1.0, 0.55, 0.2) * vFlash * 3.0;'); };
    const flashAttr = new THREE.InstancedBufferAttribute(new Float32Array(NM), 1); molGeo.setAttribute('aFlash', flashAttr);
    const mols = new THREE.InstancedMesh(molGeo, molMat, NM); mols.frustumCulled = false; cav.add(mols);
    const molS = Array.from({ length: NM }, () => ({ p: V3((Math.random() - 0.5) * (CL - 0.008), 0.0012 + Math.random() * (CH - 0.0024), (Math.random() - 0.5) * (CD - 0.003)), v: V3(), rot: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3), flash: 0, ph: Math.random() * 6 }));
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = V3(1, 1, 1), zero = V3();
    let acc = 0, inner = [pathsA, pathsR];
    const hit = mesh(new THREE.BoxGeometry(0.05, 0.03, 0.035), MAT.hit, false); hit.position.y = 0.01; hit.userData.sensor = 'co2'; root.add(hit);
    const labelAnchor = new THREE.Object3D(); labelAnchor.position.set(0, 0.03, 0); root.add(labelAnchor);
    ph.pts.visible = false; mols.visible = false;
    Object.assign(S, {
      root, hit, labelAnchor, pins,
      parts: [[lampG, 'Pulsed IR lamp<small>broadband thermal emitter</small>', [-0.004, 0.004, 0], 'l'], [det, 'Dual thermopile<small>4.26 µm active · 3.91 µm reference</small>', [0.007, 0.004, 0], 'r'], [floorC, 'Gold-coated optical cavity<small>folded path L</small>', [-0.006, -0.002, 0.009], 'l'], [membrane, 'Diffusion membrane<small>CO₂ enters by diffusion (τ₆₃ ≈ 20 s)</small>', [0.009, 0.002, 0], 'r']],
      focus() { root.updateMatrixWorld(true); const c = root.localToWorld(V3(0.002, 0.011, 0)); return { pos: c.clone().add(V3(0.004, 0.045, 0.066)), target: c }; },
      setOpen(f) { lid.position.y = CH + f * 0.02; lidMat.opacity = 1 - 0.82 * f; lidMat.depthWrite = f < 0.1; membrane.material.opacity = 1 - 0.8 * f; ph.pts.visible = mols.visible = f > 0.05; },
      update(dt, t, r, st, open) {
        const ppm = r.y ?? 800; const lamp = (st.lamp ?? 100) / 100;
        const pulse = 0.5 + 0.5 * Math.sin(t * TAU * 1.0); const lampOn = pulse > 0.3;
        filMat.emissiveIntensity = (0.4 + 3.2 * pulse) * lamp;
        const va = r.va ?? 1, vr = r.vr ?? 1;
        barA.scale.y = 0.001 + 0.009 * va; barA.position.y = 0.0028 + barA.scale.y / 2; barR.scale.y = 0.001 + 0.009 * vr; barR.position.y = 0.0028 + barR.scale.y / 2;
        if (open < 0.05) return;
        // molecules
        const nOn = Math.min(NM, Math.round(ppm / 90));
        molS.forEach((m, i) => {
          if (i >= nOn) { m4.compose(m.p, qq, zero); mols.setMatrixAt(i, m4); flashAttr.array[i] = 0; return; }
          m.v.x += (Math.random() - 0.5) * 0.004; m.v.y += (Math.random() - 0.5) * 0.004; m.v.z += (Math.random() - 0.5) * 0.004; m.v.multiplyScalar(0.92); m.p.addScaledVector(m.v, dt);
          m.p.x = clamp(m.p.x, -CL / 2 + 0.004, CL / 2 - 0.004); m.p.y = clamp(m.p.y, 0.0012, CH - 0.0012); m.p.z = clamp(m.p.z, -CD / 2 + 0.0015, CD / 2 - 0.0015);
          m.rot.x += dt * 0.8; m.rot.y += dt * 0.6; m.flash = Math.max(0, m.flash - dt * 2.5);
          const vib = 1 + (0.06 + 0.25 * m.flash) * Math.sin(t * 40 + m.ph); sc.set(vib, 1, 1);
          qq.setFromEuler(m.rot); m4.compose(m.p, qq, sc); mols.setMatrixAt(i, m4); flashAttr.array[i] = m.flash;
        });
        mols.instanceMatrix.needsUpdate = true; flashAttr.needsUpdate = true;
        // photons: emitted while the lamp pulse is on; the active channel's photons are absorbed with the true fractional absorbance
        if (lampOn) acc += dt * 70 * lamp;
        while (acc > 1) { acc -= 1; const p = phS.find(p => !p.on); if (!p) break; p.on = true; p.act = Math.random() < 0.6; const set = p.act ? pathsA : pathsR; p.path = set[Math.floor(Math.random() * set.length)]; p.s = 0; p.dead = 0; p.absAt = p.act && Math.random() < (r.FA ?? 0.04) ? 0.25 + Math.random() * 0.6 : 2; }
        phS.forEach((p, i) => {
          if (!p.on) { ph.pos.set([0, -9, 0], i * 3); return; }
          if (p.dead > 0) { p.dead -= dt; if (p.dead <= 0) p.on = false; ph.col.set([1, 0.7, 0.3].map(v => v * p.dead * 5), i * 3); return; }
          p.s += dt * 0.55; if (p.s >= 1) { p.on = false; ph.pos.set([0, -9, 0], i * 3); return; }
          const q = p.path.getPointAt(p.s);
          if (p.s > p.absAt) { p.dead = 0.2; let best = null, bd = 1e9; for (let k = 0; k < nOn; k++) { const d = molS[k].p.distanceToSquared(q); if (d < bd) { bd = d; best = molS[k]; } } if (best) best.flash = 1; }
          ph.pos.set([q.x, q.y, q.z], i * 3); ph.col.set(p.act ? [1, 0.32, 0.12] : [1, 0.5, 0.25], i * 3);
        });
        ph.dirty();
      }
    });
    return S;
  }

  /* ---------------------------------------------------------------- 5. capacitive moisture probe in a pot of substrate */
  function buildMoisture() {
    const S = { key: 'vwc', title: 'Moisture probe' };
    const root = new THREE.Group(); root.position.set(0.215, Y0, -0.115); scene.add(root);
    const potH = 0.085, rTop = 0.046, rBot = 0.036;
    const prof = [V3(0, 0, 0), V3(rBot, 0, 0), V3(rTop, potH - 0.006, 0), V3(rTop + 0.004, potH - 0.004, 0), V3(rTop + 0.004, potH, 0), V3(rTop - 0.0015, potH, 0), V3(rTop - 0.0055, potH - 0.004, 0), V3(rBot - 0.003, 0.004, 0), V3(0, 0.004, 0)].map(v => new THREE.Vector2(v.x, v.y));
    const potM = new THREE.MeshStandardMaterial({ color: 0x1f2124, roughness: 0.62, side: THREE.DoubleSide });
    const potFull = mesh(new THREE.LatheGeometry(prof, 56), potM); root.add(potFull);
    const potHalf = mesh(new THREE.LatheGeometry(prof, 40, Math.PI / 2, Math.PI), potM); potHalf.visible = false; root.add(potHalf);
    // substrate: top surface (full) or half disc + cross-section (open)
    const subTop = mesh(new THREE.CircleGeometry(rTop - 0.004, 48), surfaceMaterial('coir', [1.2, 1.2]), false); subTop.rotation.x = -Math.PI / 2; subTop.position.y = potH - 0.012; subTop.receiveShadow = true; root.add(subTop);
    const subHalfTop = mesh(new THREE.CircleGeometry(rTop - 0.004, 40, 0, Math.PI), subTop.material, false); subHalfTop.rotation.x = -Math.PI / 2; subHalfTop.position.y = potH - 0.012; subHalfTop.visible = false; root.add(subHalfTop);
    const secCv = document.createElement('canvas'); secCv.width = 512; secCv.height = 384; const sctx = secCv.getContext('2d');
    const secTex = new THREE.CanvasTexture(secCv); secTex.colorSpace = THREE.SRGBColorSpace;
    const secShape = new THREE.Shape(); secShape.moveTo(-rBot + 0.004, 0.005); secShape.lineTo(rBot - 0.004, 0.005); secShape.lineTo(rTop - 0.0045, potH - 0.012); secShape.lineTo(-rTop + 0.0045, potH - 0.012); secShape.closePath();
    const secGeo = new THREE.ShapeGeometry(secShape); { const p = secGeo.attributes.position, uv = secGeo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + rTop) / (2 * rTop), p.getY(i) / potH); }
    const section = mesh(secGeo, new THREE.MeshStandardMaterial({ map: secTex, roughness: 0.9, side: THREE.DoubleSide }), false); section.position.z = -0.0011; section.visible = false; root.add(section);
    const dotsR = rng(17); const fibres = Array.from({ length: 170 }, () => ({ x: dotsR() * 512, y: dotsR() * 384, a: dotsR() * 6, l: 20 + dotsR() * 60, w: 2 + dotsR() * 4 }));
    const pores = Array.from({ length: 260 }, () => ({ x: dotsR() * 512, y: dotsR() * 384, r: 4 + Math.pow(dotsR(), 2) * 16 })).sort((a, b) => a.r - b.r);
    let secKey = '';
    function paintSection(theta, sub) {
      const key = (Math.round(theta * 200) / 200).toFixed(3) + sub.label; if (key === secKey) return; secKey = key;
      const wet = clamp(theta / sub.phi, 0, 1);
      const base = new THREE.Color(sub.color).lerp(new THREE.Color(0x120c08), 0.45 * wet);
      sctx.fillStyle = '#' + base.getHexString(); sctx.fillRect(0, 0, 512, 384);
      // air-filled pores (dark) then water fills the smallest pores first (capillarity)
      const nWet = Math.round(pores.length * wet);
      pores.forEach((p, i) => { sctx.beginPath(); sctx.arc(p.x, p.y, p.r, 0, TAU); sctx.fillStyle = i < nWet ? 'rgba(70,150,230,0.85)' : 'rgba(10,8,6,0.55)'; sctx.fill(); if (i < nWet) { sctx.strokeStyle = 'rgba(190,230,255,0.6)'; sctx.lineWidth = 1.5; sctx.stroke(); } });
      const fc = new THREE.Color(sub.color).multiplyScalar(1.5 - 0.5 * wet);
      sctx.strokeStyle = '#' + fc.getHexString(); sctx.lineCap = 'round';
      fibres.forEach(f => { sctx.lineWidth = f.w; sctx.beginPath(); sctx.moveTo(f.x, f.y); sctx.quadraticCurveTo(f.x + Math.cos(f.a + 0.6) * f.l * 0.6, f.y + Math.sin(f.a + 0.6) * f.l * 0.6, f.x + Math.cos(f.a) * f.l, f.y + Math.sin(f.a) * f.l); sctx.stroke(); });
      secTex.needsUpdate = true;
      subTop.material.color.copy(new THREE.Color(1, 1, 1).lerp(new THREE.Color(0.42, 0.36, 0.33), wet));
    }
    // the probe (PCB with pointed tip), inserted vertically
    const PW = 0.023, PL = 0.098, PT = 0.0016;
    const shp = new THREE.Shape(); shp.moveTo(-PW / 2, PL); shp.lineTo(PW / 2, PL); shp.lineTo(PW / 2, 0.012); shp.lineTo(0.003, 0); shp.lineTo(-0.003, 0); shp.lineTo(-PW / 2, 0.012); shp.closePath();
    const pGeo = new THREE.ExtrudeGeometry(shp, { depth: PT, bevelEnabled: false }); pGeo.translate(0, 0, -PT / 2);
    const silk = canvasTexture(256, 1092, (ctx, w, h) => {
      ctx.fillStyle = '#121416'; ctx.fillRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, h * 0.35, 0, h); g.addColorStop(0, '#1d2226'); g.addColorStop(1, '#23292e'); ctx.fillStyle = g; ctx.fillRect(18, h * 0.36, w - 36, h * 0.52);
      ctx.strokeStyle = 'rgba(160,170,180,0.25)'; ctx.lineWidth = 3; ctx.strokeRect(18, h * 0.36, w - 36, h * 0.52);
      ctx.fillStyle = '#e9ecef'; ctx.font = '800 20px Inter, sans-serif'; ctx.save(); ctx.translate(w * 0.5, h * 0.62); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('Capacitive Soil Moisture Sensor v1.2', 0, 8); ctx.restore();
      ctx.strokeStyle = '#e9ecef'; ctx.setLineDash([10, 8]); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(10, h * 0.3); ctx.lineTo(w - 10, h * 0.3); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '700 16px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('insertion limit', w / 2, h * 0.3 - 12);
      ['AOUT', 'VCC', 'GND'].forEach((t, i) => ctx.fillText(t, 60 + i * 70, 40));
    }, { key: 'sb-probe-silk' });
    const probeG = new THREE.Group(); probeG.position.set(0.002, potH - 0.012 - 0.062, 0.0); root.add(probeG);
    const pcbM = [new THREE.MeshPhysicalMaterial({ map: silk, roughness: 0.4, clearcoat: 0.5 }), new THREE.MeshStandardMaterial({ color: 0x0e0f10, roughness: 0.6 })];
    const probeMesh = mesh(pGeo, pcbM); probeG.add(probeMesh);
    { const uv = pGeo.attributes.uv, p = pGeo.attributes.position; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + PW / 2) / PW, p.getY(i) / PL); }
    // electronics at the top
    at(box(0.005, 0.0039, 0.0015, MAT.chip, 0.0002), -0.004, PL - 0.02, PT / 2 + 0.00075, probeG);
    at(box(0.003, 0.0016, 0.001, MAT.chip), 0.006, PL - 0.012, PT / 2 + 0.0005, probeG);
    [[0.002, PL - 0.028], [0.006, PL - 0.026], [-0.007, PL - 0.03]].forEach(([x, y]) => at(box(0.0016, 0.0008, 0.0006, M.plastic(0x8a6a4a, 0.5)), x, y, PT / 2 + 0.0003, probeG));
    const jst = box(0.0086, 0.006, 0.0045, MAT.whitePlastic, 0.0004); at(jst, 0, PL - 0.004, PT / 2 + 0.0023, probeG);
    root.updateMatrixWorld(true);
    const pins = [0, 1, 2].map(i => probeG.localToWorld(V3(-0.002 + i * 0.002, PL - 0.001, PT / 2 + 0.0023)));
    // fringing-field lines (arcs from the electrode through the coating into the medium)
    // fringing-field lines: leave the electrode edge, arc through the substrate, return to the ground plane
    const fieldLines = [];
    for (let side = -1; side <= 1; side += 2) for (const ym of [0.022, 0.042]) for (let k = 0; k < 4; k++) {
      const half = 0.002 + 0.0022 * k, reach = 0.0018 + 0.0024 * k;
      const pts = []; for (let i = 0; i <= 20; i++) { const a = Math.PI * i / 20; pts.push(V3(side * (PW / 2 - 0.0015 + reach * Math.sin(a)), ym - half * Math.cos(a), PT / 2 + 0.0004)); }
      fieldLines.push(new THREE.CatmullRomCurve3(pts));
    }
    const fieldTube = new THREE.MeshBasicMaterial({ color: 0xffcf5a, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
    const tubes = fieldLines.map(c => { const t = new THREE.Mesh(new THREE.TubeGeometry(c, 24, 0.00022, 4), fieldTube); t.visible = false; probeG.add(t); return t; });
    const flows = fieldLines.map(c => { const f = new FlowAlong(c, { count: 7, speed: 0.012, size: 0.0026, color: 0xffd76a, jitter: 0.0001 }); probeG.add(f.points); f.points.visible = false; return f; });
    const hit = mesh(new THREE.BoxGeometry(0.1, 0.16, 0.1), MAT.hit, false); hit.position.y = 0.075; hit.userData.sensor = 'vwc'; root.add(hit);
    const labelAnchor = new THREE.Object3D(); labelAnchor.position.set(0, potH + 0.07, 0); root.add(labelAnchor);
    Object.assign(S, {
      root, hit, labelAnchor, pins,
      parts: [[section, 'Substrate cross-section<small>water (blue) fills the finest pores first</small>', [-0.024, 0.012, 0], 'l'], [probeMesh, 'Electrode under solder mask<small>fringing field reaches ≈ 1 cm into the medium</small>', [0.022, 0.04, 0], 'r'], [jst, 'TLC555 + peak detector<small>C → 1.5–3.0 V</small>', [0.008, 0.004, 0], 'r']],
      focus() { root.updateMatrixWorld(true); const c = root.localToWorld(V3(0, 0.065, 0)); return { pos: c.clone().add(V3(0.01, 0.05, 0.2)), target: c }; },
      setOpen(f) { const o = f > 0.02; potFull.visible = !o; potHalf.visible = o; subTop.visible = !o; subHalfTop.visible = o; section.visible = o; flows.forEach(fl => fl.points.visible = o); tubes.forEach(tb => tb.visible = o); },
      update(dt, t, r, st, open) {
        const sub = { ...(st.sub || { label: 'Coir', phi: 0.94, color: '#5b3a22' }) };
        paintSection(r.x ?? 0.4, sub);
        if (open > 0.02) { const Cn = clamp((r.C ?? 30e-12) / 40e-12, 0.1, 1.2); fieldTube.opacity = 0.08 + 0.3 * Cn; flows.forEach((f, i) => { f.speed = 0.008 + 0.012 * Cn; f.points.material.opacity = 0.3 + 0.6 * Cn; f.update(dt); }); }
      }
    });
    return S;
  }
}

/* merge BufferGeometries with identical attribute sets (position, normal, uv, color) */
function mergeGeos(list) {
  const out = new THREE.BufferGeometry();
  const attrs = ['position', 'normal', 'color'];
  let total = 0; list.forEach(g => total += g.attributes.position.count);
  attrs.forEach(a => { const arr = new Float32Array(total * 3); let o = 0; list.forEach(g => { arr.set(g.attributes[a].array, o); o += g.attributes[a].array.length; }); out.setAttribute(a, new THREE.BufferAttribute(arr, 3)); });
  const idx = []; let base = 0; list.forEach(g => { const ix = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()]; for (const i of ix) idx.push(i + base); base += g.attributes.position.count; });
  out.setIndex(idx); return out;
}
