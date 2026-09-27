/* ==========================================================================
   Greenhouse climate simulator — 3D scene (three.js r170 via /assets/js/lab3d.js)
   A 20 m × 20 m section of a Venlo glasshouse (5 spans of 4 m, gutter 5.1 m)
   with a high-wire tomato crop on hanging gutters, pipe-rail heating, an
   energy screen per trellis bay, roof vents, LED top-lights, condensation on
   the glass, a liquid-CO₂ tank with vaporiser and lay-flat dosing tubes, a
   boiler house with chimney plume and heat buffer, and a weather mast.
   Everything visible is driven by the model state passed to update().
   ========================================================================== */
import { THREE, M, makeGreenhouse, makeGround, surfaceMaterial, canvasTexture, rng, BufferGeometryUtils, RoundedBoxGeometry, makeLEDBar, fbm2, ensureRectAreaLights } from '/assets/js/lab3d.js';
import { colormap } from '/assets/js/colors.js';

export const GH = { spans: 5, spanWidth: 4, length: 20, gutter: 5.1, roofAngle: 22, bays: 5 };
const W = GH.spans * GH.spanWidth, L = GH.length, H = GH.gutter;
const RIDGE = Math.tan(THREE.MathUtils.degToRad(GH.roofAngle)) * GH.spanWidth / 2;
const X0 = -W / 2, Z0 = -L / 2;
const GUTTER_Y = 0.92;                 // top of the hanging crop gutters
const ROW_Z0 = -9.0, ROW_Z1 = 7.1;     // crop rows (main concrete path at the +z gable)
const GUTTERS = Array.from({ length: 12 }, (_, k) => -8.8 + 1.6 * k);
const PATHS = Array.from({ length: 13 }, (_, k) => -9.6 + 1.6 * k);

/* ------------------------------------------------------------------ procedural textures */
function tomatoLeafCanvas(ctx, w, h) {
  const r = rng(71);
  ctx.clearRect(0, 0, w, h);
  const leaflet = (x, y, ang, len, wid, shade) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    const n = 48, pts = [];
    const ph = r() * 6;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      let hw = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.78)), 0.85) * wid / 2;
      hw *= 1 + 0.10 * Math.sin(2 * Math.PI * 6 * t + ph) * t + 0.05 * Math.sin(2 * Math.PI * 15 * t + ph * 2);
      hw *= t < 0.06 ? t / 0.06 : 1;
      pts.push([t * len, hw]);
    }
    ctx.beginPath(); ctx.moveTo(0, 0);
    pts.forEach(([a, b]) => ctx.lineTo(a, -b));
    for (let i = pts.length - 1; i >= 0; i--) { const [a, b] = pts[i]; ctx.lineTo(a, b * (0.92 + 0.08 * Math.sin(i * 1.7 + ph))); }
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -wid / 2, 0, wid / 2);
    const c0 = `hsl(${104 + shade * 6},${42 + shade * 4}%,${27 + shade * 5}%)`, c1 = `hsl(${100 + shade * 4},${46}%,${34 + shade * 4}%)`;
    g.addColorStop(0, c0); g.addColorStop(0.5, c1); g.addColorStop(1, c0);
    ctx.fillStyle = g; ctx.fill();
    // mottling
    ctx.save(); ctx.clip();
    for (let k = 0; k < 90; k++) { ctx.fillStyle = `rgba(${20 + r() * 40},${60 + r() * 50},${20 + r() * 30},${0.08 + r() * 0.1})`; ctx.beginPath(); ctx.arc(r() * len, (r() - 0.5) * wid, 2 + r() * 6, 0, 6.3); ctx.fill(); }
    // veins
    ctx.strokeStyle = 'rgba(190,220,150,0.55)'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len * 0.95, 0); ctx.stroke();
    ctx.strokeStyle = 'rgba(180,215,140,0.35)'; ctx.lineWidth = 1.1;
    for (let k = 1; k < 8; k++) { const a = len * k / 8.5; [-1, 1].forEach(s => { ctx.beginPath(); ctx.moveTo(a, 0); ctx.quadraticCurveTo(a + len * 0.06, s * wid * 0.18, a + len * 0.12, s * wid * 0.36); ctx.stroke(); }); }
    ctx.restore();
    ctx.restore();
  };
  // rachis
  const cx = w / 2;
  ctx.strokeStyle = '#5f7f33'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, h - 4); ctx.quadraticCurveTo(cx + 10, h * 0.5, cx, 26); ctx.stroke();
  // terminal leaflet
  leaflet(cx, 150, -Math.PI / 2 - 0.05, 132, 74, 1);
  // three pairs of primary leaflets + interstitial small ones
  const pairs = [[190, 118, 60, 0.9], [300, 128, 64, 0.5], [405, 112, 56, 0]];
  pairs.forEach(([y, len, wid, sh], i) => {
    leaflet(cx + 3, y, -Math.PI / 2 - 0.95 - i * 0.08, len, wid, sh);
    leaflet(cx - 3, y + 6, -Math.PI / 2 + 0.95 + i * 0.08, len * 0.96, wid, sh);
    if (i < 2) { leaflet(cx + 2, y + 55, -Math.PI / 2 - 1.3, 42, 22, 0.3); leaflet(cx - 2, y + 58, -Math.PI / 2 + 1.3, 40, 21, 0.3); }
  });
}
function dropletCanvas(ctx, w, h) {
  const r = rng(5);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(235,242,246,0.30)'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    const x = r() * w, y = r() * h, rad = 1.2 + Math.pow(r(), 3) * 7;
    const g = ctx.createRadialGradient(x - rad * 0.3, y - rad * 0.3, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.35, 'rgba(225,235,240,0.45)'); g.addColorStop(0.85, 'rgba(200,215,225,0.7)'); g.addColorStop(1, 'rgba(200,215,225,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.3); ctx.fill();
  }
  // a few rivulets
  ctx.strokeStyle = 'rgba(230,240,245,0.55)';
  for (let i = 0; i < 26; i++) { const x = r() * w; ctx.lineWidth = 1 + r() * 2; ctx.beginPath(); ctx.moveTo(x, r() * h * 0.4); ctx.bezierCurveTo(x + (r() - 0.5) * 12, h * 0.5, x + (r() - 0.5) * 12, h * 0.7, x + (r() - 0.5) * 8, h * (0.7 + r() * 0.3)); ctx.stroke(); }
}
function screenCanvas(ctx, w, h) {
  // energy screen: knitted polyester strips with slightly reflective bands
  ctx.fillStyle = '#e9e7df'; ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 8) { ctx.fillStyle = (x / 8) % 2 ? 'rgba(255,255,255,0.55)' : 'rgba(200,200,190,0.35)'; ctx.fillRect(x, 0, 5, h); }
  ctx.strokeStyle = 'rgba(150,150,140,0.35)'; ctx.lineWidth = 1;
  for (let y = 0; y < h; y += 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
}
function snowMaterial(rep) {
  const set = { key: 'snow-surf' };
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h); const r = rng(9);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = fbm2(x / 40, y / 40, 4) * 0.5 + 0.5; const k = (y * w + x) * 4; const v = 228 + n * 22 - (r() < 0.02 ? 25 : 0);
      img.data[k] = v - 6; img.data[k + 1] = v - 2; img.data[k + 2] = 255; img.data[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat: rep, key: set.key });
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0, color: 0xffffff });
}
function corrugatedTex(color) {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) { const g = ctx.createLinearGradient(x, 0, x + 8, 0); g.addColorStop(0, 'rgba(0,0,0,0.18)'); g.addColorStop(0.5, 'rgba(255,255,255,0.14)'); g.addColorStop(1, 'rgba(0,0,0,0.18)'); ctx.fillStyle = g; ctx.fillRect(x, 0, 8, h); }
  }, { repeat: [4, 1] });
}
function softDot() {
  return canvasTexture(64, 64, (ctx, w) => { const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, w); }, { srgb: false, key: 'gc-softdot' });
}

/* ------------------------------------------------------------------ helpers */
function box(w, h, d, mat, x, y, z, parent) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; if (parent) parent.add(m); return m; }
function instanced(geo, mat, mats, parent, { cast = true, receive = true } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
  mats.forEach((m4, i) => im.setMatrixAt(i, m4)); im.count = mats.length; im.castShadow = cast; im.receiveShadow = receive; if (parent) parent.add(im); return im;
}
const m4 = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
/** Thin bar between two points as a matrix for a unit box scaled (t, t, length). */
function barMatrix(a, b, t) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b); const len = A.distanceTo(B);
  const o = new THREE.Object3D(); o.position.copy(A).add(B).multiplyScalar(0.5); o.lookAt(B); o.scale.set(t, t, len); o.updateMatrix(); return o.matrix.clone();
}

/* ------------------------------------------------------------------ plume / puff particles */
class Puffs {
  constructor({ max = 400, size = 1.2, color = 0xffffff, opacity = 0.5, life = 6 } = {}) {
    this.max = max; this.life = life; this.p = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.mat = new THREE.PointsMaterial({ size, map: softDot(), transparent: true, depthWrite: false, vertexColors: true, opacity, sizeAttenuation: true, color });
    this.points = new THREE.Points(geo, this.mat); this.points.frustumCulled = false; this.acc = 0;
  }
  emit(n, fn) { this.acc += n; while (this.acc >= 1) { this.acc -= 1; if (this.p.length < this.max) this.p.push(fn()); } }
  update(dt, drift) {
    let k = 0;
    for (let i = this.p.length - 1; i >= 0; i--) { const q = this.p[i]; q.age += dt; if (q.age > q.life) { this.p.splice(i, 1); continue; } q.x += (q.vx + drift[0]) * dt; q.y += q.vy * dt; q.z += (q.vz + drift[2]) * dt; q.vy *= 1 - 0.25 * dt; }
    for (const q of this.p) { const f = q.age / q.life; const a = q.a * Math.sin(Math.PI * Math.min(1, f * 1.15)) ; this.pos.set([q.x, q.y, q.z], k * 3); this.col.set([1, 1, 1, Math.max(0, a)], k * 4); k++; }
    for (let j = k; j < this.max; j++) this.col[j * 4 + 3] = 0;
    this.points.geometry.setDrawRange(0, k);
    this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.color.needsUpdate = true;
  }
}

/* ================================================================== build */
export function buildScene(stage) {
  const { scene } = stage;
  const api = { pick: [], info: new Map() };
  const register = (obj, key) => { obj.traverse(o => { if (o.isMesh || o.isInstancedMesh) { o.userData.pickKey = key; api.pick.push(o); } }); };

  /* ---------- ground & landscape */
  const groundMats = { grass: surfaceMaterial('grass', [220, 220]), snow: snowMaterial([90, 90]), dry: surfaceMaterial('sand', [180, 180]) };
  groundMats.dry.color = new THREE.Color(0xd8c7a0);
  const ground = makeGround({ size: 900, type: 'grass', repeat: [220, 220] }); scene.add(ground);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(W + 7, L + 7), surfaceMaterial('concrete', [7, 7])); apron.rotation.x = -Math.PI / 2; apron.position.set(0, 0.01, 0); apron.receiveShadow = true; scene.add(apron);
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(22, 24), surfaceMaterial('gravel', [7, 8])); yard.material.color.set(0xd8d3c6); yard.rotation.x = -Math.PI / 2; yard.position.set(22, 0.008, -9); yard.receiveShadow = true; scene.add(yard);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(5, 300), surfaceMaterial('concrete', [2, 110])); road.rotation.x = -Math.PI / 2; road.position.set(-32, 0.015, 0); road.receiveShadow = true; scene.add(road);
  const landscape = new THREE.Group(); scene.add(landscape);

  /* ---------- greenhouse shell (lab3d) */
  const gh = makeGreenhouse({ spans: GH.spans, spanWidth: GH.spanWidth, length: L, gutterHeight: H, roofAngle: GH.roofAngle, bays: GH.bays, heatingPipes: false, glassOpacity: 0.09 });
  scene.add(gh);
  const glassMats = new Set();
  gh.traverse(o => { if (o.isMesh && o.material.transparent && o.material.opacity < 0.5) glassMats.add(o.material); });
  // fewer stacked reflections: many panes overlap in any view of a glasshouse
  glassMats.forEach(m => { m.envMapIntensity = 0.55; m.clearcoat = 0.3; m.opacity = 0.07; m.color.set(0xeef6f6); });
  const alu = M.aluminium();
  // extra glazing bars (1 m pitch) on the roof slopes, mullions on walls and gables
  const slopeLen = Math.hypot(GH.spanWidth / 2, RIDGE);
  const bars = [];
  for (let s = 0; s < GH.spans; s++) {
    const xl = X0 + s * GH.spanWidth, xm = xl + GH.spanWidth / 2, xr = xl + GH.spanWidth;
    for (let z = Z0 + 1; z < -Z0 - 0.5; z += 1) { if (Math.abs(((z - Z0) / 2) % 1) < 1e-6) continue; bars.push(barMatrix([xl, H + 0.02, z], [xm, H + RIDGE + 0.02, z], 0.022)); bars.push(barMatrix([xm, H + RIDGE + 0.02, z], [xr, H + 0.02, z], 0.022)); }
  }
  for (let z = Z0 + 1; z < -Z0; z += 1) [X0, -X0].forEach(x => bars.push(barMatrix([x, 0.5, z], [x, H, z], 0.035)));
  for (let x = X0 + 1; x < -X0; x += 1) [Z0, -Z0].forEach(z => { const top = H + (RIDGE - Math.abs(((x - X0) % GH.spanWidth) - GH.spanWidth / 2) * RIDGE / (GH.spanWidth / 2)); bars.push(barMatrix([x, 0.5, z], [x, top, z], 0.035)); });
  [X0, -X0].forEach(x => bars.push(barMatrix([x, 2.6, Z0], [x, 2.6, -Z0], 0.05)));
  [Z0, -Z0].forEach(z => bars.push(barMatrix([X0, 2.6, z], [-X0, 2.6, z], 0.05)));
  instanced(new THREE.BoxGeometry(1, 1, 1), alu, bars, gh);
  // concrete kerb wall
  const kerbMat = surfaceMaterial('concrete', [8, 1]);
  [[W + 0.3, 0.5, 0.2, 0, 0.25, Z0], [W + 0.3, 0.5, 0.2, 0, 0.25, -Z0], [0.2, 0.5, L, X0, 0.25, 0], [0.2, 0.5, L, -X0, 0.25, 0]].forEach(a => box(a[0], a[1], a[2], kerbMat, a[3], a[4], a[5], gh));
  // lattice trusses (trellis girders) at every bay line
  const truss = [];
  for (let b = 0; b <= GH.bays; b++) {
    const z = Z0 + b * L / GH.bays; if (b === 0 || b === GH.bays) continue;
    truss.push(barMatrix([X0, H - 0.55, z], [-X0, H - 0.55, z], 0.04));
    for (let x = X0; x < -X0 - 0.01; x += 0.5) truss.push(barMatrix([x, H - 0.55, z], [x + 0.5, H - 0.03, z], 0.022), barMatrix([x + 0.5, H - 0.03, z], [x + 1, H - 0.55, z], 0.022));
  }
  instanced(new THREE.BoxGeometry(1, 1, 1), M.galvanised(), truss, gh);
  // sliding door on the +z gable
  const door = new THREE.Group(); door.position.set(0, 0, -Z0 + 0.02);
  box(2.4, 3.2, 0.06, M.glassCheap(0.25), 0, 1.6, 0, door); box(2.5, 0.08, 0.1, alu, 0, 3.24, 0, door); box(0.08, 3.2, 0.1, alu, -1.22, 1.6, 0, door); box(0.08, 3.2, 0.1, alu, 1.22, 1.6, 0, door);
  gh.add(door);
  register(gh, 'cover');
  gh.vents.forEach(v => v.traverse(o => { if (o.isMesh) o.userData.pickKey = 'vents'; }));

  /* ---------- condensation film on the inside of the glass */
  const dropTex = canvasTexture(512, 512, dropletCanvas, { repeat: [2, 12], srgb: true, key: 'gc-drops' });
  const condMat = new THREE.MeshStandardMaterial({ map: dropTex, emissiveMap: dropTex, emissive: 0x9fb4c4, emissiveIntensity: 0.25, transparent: true, opacity: 0, depthWrite: false, roughness: 0.25, metalness: 0, side: THREE.DoubleSide, color: 0xffffff });
  const cond = new THREE.Group(); gh.add(cond);
  for (let s = 0; s < GH.spans; s++) {
    const xm = X0 + s * GH.spanWidth + GH.spanWidth / 2;
    [-1, 1].forEach(side => {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(slopeLen, L), condMat);
      pane.position.set(xm + side * GH.spanWidth / 4, H + RIDGE / 2 - 0.035, 0);
      pane.rotation.set(-Math.PI / 2, 0, 0); pane.rotateY(side * THREE.MathUtils.degToRad(GH.roofAngle)); cond.add(pane);
    });
  }
  const wallCondMat = condMat.clone(); wallCondMat.map = dropTex.clone(); wallCondMat.map.repeat.set(8, 2); wallCondMat.map.needsUpdate = true;
  [[L, H - 0.5, X0 + 0.03, Math.PI / 2], [L, H - 0.5, -X0 - 0.03, Math.PI / 2]].forEach(([w, h, x, ry]) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallCondMat); p.position.set(x, 0.5 + h / 2, 0); p.rotation.y = ry; cond.add(p); });
  [Z0 + 0.03, -Z0 - 0.03].forEach(z => { const p = new THREE.Mesh(new THREE.PlaneGeometry(W, H - 0.5), wallCondMat); p.position.set(0, 0.5 + (H - 0.5) / 2, z); cond.add(p); });

  /* ---------- floor: white foil + concrete main path */
  const foil = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, ROW_Z1 - Z0 + 0.3), new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.62, metalness: 0 }));
  foil.rotation.x = -Math.PI / 2; foil.position.set(0, 0.02, (Z0 + ROW_Z1 + 0.3) / 2); foil.receiveShadow = true; gh.add(foil);
  const mainPath = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, -Z0 - ROW_Z1 - 0.2), surfaceMaterial('concrete', [8, 1.2])); mainPath.rotation.x = -Math.PI / 2; mainPath.position.set(0, 0.022, (ROW_Z1 + 0.3 - Z0) / 2); mainPath.receiveShadow = true; gh.add(mainPath);

  /* ---------- heating: pipe rail (2 × 51 mm per path) + one 51 mm pipe under each gutter */
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: 0.38, metalness: 0.25, emissive: 0x000000, emissiveIntensity: 1 });
  const pipeLen = ROW_Z1 - ROW_Z0 + 0.6, pipeZ = (ROW_Z1 + ROW_Z0) / 2;
  const pm = [];
  PATHS.forEach(x => [-0.275, 0.275].forEach(dx => pm.push(m4(x + dx, 0.13, pipeZ, Math.PI / 2, 0, 0))));
  GUTTERS.forEach(x => pm.push(m4(x, 0.55, pipeZ, Math.PI / 2, 0, 0)));
  const pipes = instanced(new THREE.CylinderGeometry(0.0255, 0.0255, pipeLen, 14, 1, true), pipeMat, pm, gh);
  const bends = []; PATHS.forEach(x => bends.push(m4(x, 0.13, pipeZ - pipeLen / 2, -Math.PI / 2, 0, 0)));
  instanced(new THREE.TorusGeometry(0.275, 0.0255, 10, 18, Math.PI), pipeMat, bends, gh);
  const header = []; header.push(barMatrix([X0 + 0.3, 0.13, pipeZ + pipeLen / 2 + 0.25], [-X0 - 0.3, 0.13, pipeZ + pipeLen / 2 + 0.25], 0.08), barMatrix([X0 + 0.3, 0.3, pipeZ + pipeLen / 2 + 0.35], [-X0 - 0.3, 0.3, pipeZ + pipeLen / 2 + 0.35], 0.08));
  PATHS.forEach(x => [-0.275, 0.275].forEach((dx, i) => header.push(barMatrix([x + dx, 0.13, pipeZ + pipeLen / 2], [x + dx, i ? 0.3 : 0.13, pipeZ + pipeLen / 2 + (i ? 0.35 : 0.25)], 0.05))));
  instanced(new THREE.BoxGeometry(1, 1, 1), pipeMat, header, gh);
  const supports = []; PATHS.forEach(x => { for (let z = ROW_Z0; z <= ROW_Z1; z += 2.5) supports.push(m4(x, 0.05, z, 0, 0, 0, 0.7, 0.1, 0.08)); });
  instanced(new THREE.BoxGeometry(1, 1, 1), M.galvanised(), supports, gh);
  register(pipes, 'pipes');

  /* ---------- crop gutters, slabs, drip lines, CO₂ lay-flat tubes */
  const galv = M.galvanised();
  const rowLen = ROW_Z1 - ROW_Z0 + 0.4, rowZ = (ROW_Z1 + ROW_Z0) / 2;
  instanced(new THREE.BoxGeometry(0.34, 0.07, rowLen), galv, GUTTERS.map(x => m4(x, GUTTER_Y - 0.08, rowZ)), gh);
  instanced(new RoundedBoxGeometry(0.22, 0.085, rowLen - 0.1, 2, 0.02), M.plasticWhite(), GUTTERS.map(x => m4(x, GUTTER_Y - 0.01, rowZ)), gh);
  const hang = []; GUTTERS.forEach(x => { for (let z = ROW_Z0 + 0.5; z < ROW_Z1; z += 4) hang.push(barMatrix([x, GUTTER_Y - 0.1, z], [x, H - 0.55, z], 0.006)); });
  instanced(new THREE.BoxGeometry(1, 1, 1), M.steel(), hang, gh, { cast: false });
  const co2Mat = new THREE.MeshPhysicalMaterial({ color: 0xf6f8f8, roughness: 0.35, transparent: true, opacity: 0.55, clearcoat: 0.6, emissive: 0x7fd8ff, emissiveIntensity: 0 });
  const co2Tubes = instanced(new THREE.CylinderGeometry(0.03, 0.03, rowLen, 10, 1, true), co2Mat, GUTTERS.map(x => m4(x + 0.12, GUTTER_Y - 0.2, rowZ, Math.PI / 2, 0, 0)), gh, { cast: false });
  register(co2Tubes, 'co2');

  /* ---------- tomato crop (instanced plants with alpha-tested compound-leaf cards) */
  const leafTex = canvasTexture(512, 512, tomatoLeafCanvas, { srgb: true, key: 'gc-tomato-leaf' });
  leafTex.anisotropy = 4;
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.62, metalness: 0, color: 0xffffff });
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x587530, roughness: 0.75 });
  const fruitMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const cropGroup = new THREE.Group(); gh.add(cropGroup);
  const plantSpots = [];
  const pr = rng(33);
  GUTTERS.forEach(x => [-1, 1].forEach(side => { for (let z = ROW_Z0 + 0.1; z <= ROW_Z1 - 0.1; z += 0.6) plantSpots.push({ x: x + side * 0.12, z: z + (side > 0 ? 0.3 : 0) + (pr() - 0.5) * 0.08, side, rot: pr() * Math.PI * 2, sc: 0.9 + pr() * 0.2, v: Math.floor(pr() * 2) }); }));
  function plantGeometry(lai, seed) {
    const r = rng(seed); const geos = [];
    const stageF = THREE.MathUtils.clamp(lai / 3, 0.25, 1.3);
    const top = GUTTER_Y + 0.4 + 2.7 * Math.min(1, stageF);            // head height
    const leafy0 = top - Math.min(2.2, 0.5 + 1.8 * stageF);             // de-leafed below this
    const nLeaves = Math.max(5, Math.round(6 * lai));
    for (let i = 0; i < nLeaves; i++) {
      const f = i / Math.max(1, nLeaves - 1);
      const y = leafy0 + (top - leafy0) * f;
      const len = (0.34 + 0.24 * Math.min(1, stageF)) * (1 - 0.35 * f) * (0.9 + r() * 0.2), wid = len * 0.9;
      const g = new THREE.PlaneGeometry(wid, len, 2, 2); g.translate(0, len / 2, 0);
      const p = g.attributes.position;
      const droop = 0.18 + 0.2 * r(), fold = 0.12;
      for (let k = 0; k < p.count; k++) { const yy = p.getY(k) / len, xx = p.getX(k); p.setZ(k, droop * yy * yy * len + fold * Math.abs(xx)); }
      g.computeVertexNormals();
      const alpha = THREE.MathUtils.degToRad(35 + 25 * f + (r() - 0.5) * 12);
      g.rotateX(Math.PI / 2 - alpha);
      g.rotateY(i * 2.39996 + r() * 0.4);
      g.translate(0, y, 0);
      geos.push(g);
    }
    const leaves = BufferGeometryUtils.mergeGeometries(geos); geos.forEach(g => g.dispose());
    const stem = new THREE.CylinderGeometry(0.008, 0.012, top - GUTTER_Y, 6, 1, true); stem.translate(0, (top + GUTTER_Y) / 2, 0);
    return { leaves, stem, top, leafy0 };
  }
  let cropKey = '', cropMeshes = [];
  const strings = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xdedbd0, transparent: true, opacity: 0.55 }));
  const wires = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x9aa0a4 }));
  gh.add(strings, wires);
  function buildCrop(lai) {
    const key = (Math.round(lai * 4) / 4).toFixed(2); if (key === cropKey) return; cropKey = key;
    cropMeshes.forEach(m => { cropGroup.remove(m); m.geometry.dispose(); }); cropMeshes = [];
    const variants = [plantGeometry(lai, 11), plantGeometry(lai, 23)];
    const q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    variants.forEach((vg, vi) => {
      const spots = plantSpots.filter(s => s.v === vi);
      const lm = [], sm = [];
      spots.forEach(s => { e.set(0, s.rot, s.side * 0.06); q.setFromEuler(e); sc.set(s.sc, 1, s.sc); pos.set(s.x, 0, s.z); const mm = new THREE.Matrix4().compose(pos, q, sc); lm.push(mm); sm.push(mm); });
      cropMeshes.push(instanced(vg.leaves, leafMat, lm, cropGroup), instanced(vg.stem, stemMat, sm, cropGroup, { cast: false }));
    });
    // fruit trusses (only on a crop with LAI ≥ 1.5)
    const fr = rng(5); const fm = [], fc = []; const col = new THREE.Color();
    const cols = [0xc8230f, 0xd4401a, 0xe0781f, 0x9fae38];
    if (lai >= 1.5) plantSpots.forEach(s => {
      const top = variants[s.v].top;
      [0, 1].forEach(t => {
        const y = GUTTER_Y + 0.62 + t * 0.4 + (top - GUTTER_Y - 2.8) * 0.2;
        const a = s.rot + t * 2.2;
        for (let k = 0; k < 4; k++) {
          const rr = 0.027 + fr() * 0.008; const ang = a + (k - 1.5) * 0.35;
          fm.push(m4(s.x + Math.cos(ang) * (0.07 + k * 0.012), y - 0.02 * k - fr() * 0.02, s.z + Math.sin(ang) * (0.07 + k * 0.012), 0, 0, 0, rr, rr * 0.92, rr));
          col.setHex(cols[Math.min(3, t + (fr() < 0.3 ? 1 : 0))]); fc.push(col.clone());
        }
      });
    });
    if (fm.length) {
      const fg = BufferGeometryUtils.mergeVertices(new THREE.IcosahedronGeometry(1, 0)); fg.computeVertexNormals();
      const fruit = instanced(fg, fruitMat, fm, cropGroup, { cast: false }); fc.forEach((c, i) => fruit.setColorAt(i, c)); fruit.instanceColor.needsUpdate = true; cropMeshes.push(fruit);
    }
    // strings to the crop wire, and the wires
    const sp = [], wp = []; const wireY = H - 0.62;
    plantSpots.forEach(s => { const top = variants[s.v].top; sp.push(s.x, top, s.z, s.x + s.side * 0.15, wireY, s.z); });
    GUTTERS.forEach(x => [-1, 1].forEach(sd => wp.push(x + sd * 0.27, wireY, ROW_Z0 - 0.3, x + sd * 0.27, wireY, ROW_Z1 + 0.3)));
    strings.geometry.dispose(); strings.geometry = new THREE.BufferGeometry(); strings.geometry.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    wires.geometry.dispose(); wires.geometry = new THREE.BufferGeometry(); wires.geometry.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    cropMeshes.forEach(m => { m.userData.pickKey = 'crop'; if (!api.pick.includes(m)) api.pick.push(m); });
  }
  api.buildCrop = buildCrop;

  /* ---------- energy screen: one fabric panel per trellis bay, closing along +z */
  const scrTex = canvasTexture(256, 256, screenCanvas, { repeat: [40, 2], key: 'gc-screen' });
  const scrMat = new THREE.MeshStandardMaterial({ map: scrTex, color: 0xffffff, roughness: 0.75, metalness: 0.12, transparent: true, opacity: 0.86, side: THREE.DoubleSide, depthWrite: true });
  const screens = [], bundles = [];
  const bayLen = L / GH.bays;
  for (let b = 0; b < GH.bays; b++) {
    const zStart = Z0 + b * bayLen + 0.05;
    const pan = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.12, 1), scrMat); pan.rotation.x = -Math.PI / 2; pan.position.set(0, H - 0.12, zStart); pan.receiveShadow = true; pan.castShadow = true;
    pan.userData = { zStart, len: bayLen - 0.1, pickKey: 'screen' }; gh.add(pan); screens.push(pan); api.pick.push(pan);
    const bun = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, W - 0.12, 10), new THREE.MeshStandardMaterial({ color: 0xe6e4dc, roughness: 0.8 })); bun.rotation.z = Math.PI / 2; bun.position.set(0, H - 0.14, zStart); gh.add(bun); bundles.push(bun);
  }
  function setScreen(s) {
    screens.forEach((p, i) => { const l = Math.max(0.001, s) * p.userData.len; p.scale.y = l; p.position.z = p.userData.zStart + l / 2; p.visible = s > 0.01; bundles[i].position.z = p.userData.zStart + l; bundles[i].scale.set(1 + 1.2 * (1 - s), 1, 1 + 1.2 * (1 - s)); });
  }
  setScreen(0);

  /* ---------- LED top-lights (hidden unless used) */
  const lampGroup = new THREE.Group(); lampGroup.visible = false; gh.add(lampGroup);
  const lampBars = [];
  PATHS.slice(1, -1).forEach(x => { for (let z = ROW_Z0 + 1.6; z < ROW_Z1; z += 3.2) { const bar = makeLEDBar({ length: 1.1, width: 0.1, color: 'full', light: false }); bar.rotation.y = Math.PI / 2; bar.position.set(x, H - 0.72, z); lampGroup.add(bar); lampBars.push(bar); } });
  ensureRectAreaLights();
  const lampLight = new THREE.RectAreaLight(0xffc6e8, 0, W - 2, ROW_Z1 - ROW_Z0); lampLight.position.set(0, H - 0.8, rowZ); lampLight.rotation.x = -Math.PI / 2; lampGroup.add(lampLight);
  const lampPoint = new THREE.PointLight(0xffc8e6, 0, 36, 2); lampPoint.position.set(0, H + 1.5, rowZ); lampGroup.add(lampPoint);
  lampGroup.traverse(o => { if (o.isMesh) o.userData.pickKey = 'lamps'; });

  /* ---------- climate measuring box (aspirated) in the crop */
  const cbox = new THREE.Group(); cbox.position.set(PATHS[6], 2.7, 3.4);
  box(0.36, 0.22, 0.24, M.plasticWhite(), 0, 0, 0, cbox); box(0.1, 0.1, 0.02, M.plasticBlack(), 0.12, 0, 0.125, cbox);
  const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), M.plasticGrey()); fan.rotation.x = Math.PI / 2; fan.position.set(-0.08, 0, 0.13); cbox.add(fan);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, H - 0.6 - 2.8, 6), M.steel()); chain.position.y = (H - 0.6 - 2.8) / 2 + 0.11; cbox.add(chain);
  gh.add(cbox); register(cbox, 'sensor');

  /* ---------- utilities: boiler house, chimney, heat buffer, CO₂ tank, weather mast */
  const util = new THREE.Group(); scene.add(util);
  const bh = new THREE.Group(); bh.position.set(20, 0, -4); util.add(bh);
  const wallMat = new THREE.MeshStandardMaterial({ map: corrugatedTex('#7e8a8c'), roughness: 0.6, metalness: 0.4 });
  box(7, 4.2, 5, wallMat, 0, 2.1, 0, bh); box(7.3, 0.25, 5.3, M.paintedSteel(0x3b4244), 0, 4.3, 0, bh); box(1.4, 2.6, 0.08, M.paintedSteel(0x2f5d7c), 1.5, 1.3, 2.52, bh);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 13, 20), M.steel()); chimney.position.set(1.8, 6.5, -1.4); chimney.castShadow = true; bh.add(chimney);
  const buffer = new THREE.Group(); buffer.position.set(28, 0, -12); util.add(buffer);
  const bufMat = new THREE.MeshStandardMaterial({ map: corrugatedTex('#aeb5b9'), roughness: 0.5, metalness: 0.6, envMapIntensity: 0.6 }); bufMat.map.repeat.set(24, 1);
  const bufTank = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 11, 48), bufMat); bufTank.position.y = 5.5; bufTank.castShadow = true; bufTank.receiveShadow = true; buffer.add(bufTank);
  const bufTop = new THREE.Mesh(new THREE.CylinderGeometry(3.25, 3.25, 0.2, 48), M.paintedSteel(0x8c9396)); bufTop.position.y = 11.1; buffer.add(bufTop);
  for (let k = 0; k < 18; k++) { const rung = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.03), M.galvanised()); rung.position.set(0, 0.6 + k * 0.58, 3.28); buffer.add(rung); }
  [-0.25, 0.25].forEach(dx => { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 10.6, 0.04), M.galvanised()); rail.position.set(dx, 5.5, 3.3); buffer.add(rail); });
  const hpipe = []; hpipe.push(barMatrix([16.5, 0.6, -3.6], [-X0 + 0.3, 0.6, -3.6], 0.16), barMatrix([16.5, 0.9, -4.2], [-X0 + 0.3, 0.9, -4.2], 0.16), barMatrix([23.5, 0.6, -5], [26, 0.6, -10], 0.16), barMatrix([23.5, 0.9, -5.6], [25.6, 0.9, -10.4], 0.16));
  instanced(new THREE.BoxGeometry(1, 1, 1), M.paintedSteel(0x5f6b6e), hpipe, util);
  register(bh, 'boiler'); register(buffer, 'buffer');
  // liquid CO₂ tank with ambient vaporiser
  const co2 = new THREE.Group(); co2.position.set(12.5, 0, -16.5); util.add(co2);
  const tankMat = M.paintedSteel(0xf2f2ee);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 6.2, 36), tankMat); tank.position.y = 4.2; tank.castShadow = true; co2.add(tank);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.1, 36, 12, 0, Math.PI * 2, 0, Math.PI / 2), tankMat); dome.position.y = 7.3; co2.add(dome);
  const dome2 = dome.clone(); dome2.rotation.x = Math.PI; dome2.position.y = 1.1; co2.add(dome2);
  [[0.8, 0.8], [-0.8, 0.8], [0.8, -0.8], [-0.8, -0.8]].forEach(([x, z]) => box(0.12, 1.2, 0.12, M.galvanised(), x, 0.6, z, co2));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, 0.5, 36), M.paintedSteel(0x2e7d4f)); band.position.y = 5.8; co2.add(band);
  const vap = new THREE.Group(); vap.position.set(2.6, 0, 0); co2.add(vap);
  const vapMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd0, metalness: 0.9, roughness: 0.35 });
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.6, 0.5), vapMat); fin.position.set(i * 0.3 - 0.45, 2.0, j * 0.6 - 0.3); fin.castShadow = true; vap.add(fin); }
  const co2line = []; co2line.push(barMatrix([13.6, 0.35, -15.2], [-X0 + 0.3, 0.35, -8.4], 0.07));
  instanced(new THREE.BoxGeometry(1, 1, 1), M.steel(), co2line, util);
  register(co2, 'co2');
  // weather mast with cup anemometer
  const mast = new THREE.Group(); mast.position.set(-14, 0, 12.5); util.add(mast);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 7.5, 12), M.galvanised()); pole.position.y = 3.75; pole.castShadow = true; mast.add(pole);
  const anem = new THREE.Group(); anem.position.y = 7.65; mast.add(anem);
  for (let k = 0; k < 3; k++) { const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.36, 6), M.steel()); arm.rotation.z = Math.PI / 2; arm.position.x = 0.18; const g = new THREE.Group(); g.rotation.y = k * Math.PI * 2 / 3; g.add(arm); const cup = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8, 0, Math.PI), M.plasticBlack()); cup.position.set(0.36, 0, 0); cup.rotation.y = Math.PI / 2; g.add(cup); anem.add(g); }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 10), M.plasticBlack()); anem.add(hub);
  const shield = new THREE.Group(); shield.position.y = 2.2; mast.add(shield);
  for (let k = 0; k < 7; k++) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.11 - k * 0.004, 0.12 - k * 0.004, 0.02, 20), M.plasticWhite()); d.position.set(0.18, k * 0.035, 0); shield.add(d); }
  const pyr = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.glass()); pyr.position.set(0, 7.52, 0.25); mast.add(pyr);
  register(mast, 'weather');

  /* ---------- landscape by site */
  function buildLandscape(site, month) {
    while (landscape.children.length) { const c = landscape.children.pop(); c.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    const nordic = site === 'vasteras';
    const snow = nordic && month === 'jan';
    ground.material = snow ? groundMats.snow : nordic ? groundMats.grass : groundMats.dry;
    if (nordic && !snow) ground.material.color.set(month === 'apr' ? 0xe2ddb4 : 0xffffff);
    const r = rng(nordic ? 17 : 29);
    const n = nordic ? 300 : 90;
    const crownGeo = nordic ? (() => { const a = new THREE.ConeGeometry(1.7, 4.2, 9); a.translate(0, 3.6, 0); const b = new THREE.ConeGeometry(1.25, 3.2, 9); b.translate(0, 5.6, 0); const c = new THREE.ConeGeometry(0.8, 2.4, 9); c.translate(0, 7.3, 0); return BufferGeometryUtils.mergeGeometries([a, b, c]); })()
      : (() => { const g = new THREE.IcosahedronGeometry(1.7, 1); g.scale(1.2, 0.7, 1.2); g.translate(0, 2.4, 0); return g; })();
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, nordic ? 2.4 : 2.2, 6); trunkGeo.translate(0, nordic ? 1.2 : 1.1, 0);
    const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, envMapIntensity: 0.3 }), n);
    const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 1 }), n);
    const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      let a, R;
      if (i < n * 0.65) { a = r() * Math.PI * 2; R = 65 + Math.pow(r(), 0.7) * 190; } else { a = -2.2 + (r() - 0.5) * 1.4; R = 45 + r() * 50; }
      const x = Math.cos(a) * R, z = Math.sin(a) * R; const s = 0.7 + r() * 0.8;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28); sc.set(s, s * (0.85 + r() * 0.4), s); mm.compose(new THREE.Vector3(x, 0, z), q, sc);
      crown.setMatrixAt(i, mm); trunk.setMatrixAt(i, mm);
      if (nordic) c.setHSL(0.34 + r() * 0.05, 0.42, (snow ? 0.12 : 0.085) + r() * 0.05); else c.setHSL(0.2 + r() * 0.05, 0.3, 0.24 + r() * 0.08);
      crown.setColorAt(i, c);
    }
    crown.castShadow = true; landscape.add(crown, trunk);
    if (nordic) {
      // Falu-red farmhouse and barn
      [[-44, -30, 0.3, 11, 6], [-30, -48, -0.4, 16, 8]].forEach(([x, z, rot, len, dep]) => {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(len, 4.2, dep), new THREE.MeshStandardMaterial({ color: 0x8e2a20, roughness: 0.85 })); body.position.y = 2.1; body.castShadow = true; body.receiveShadow = true; g.add(body);
        const rs = new THREE.Shape(); rs.moveTo(-dep / 2 - 0.4, 0); rs.lineTo(0, 2.6); rs.lineTo(dep / 2 + 0.4, 0); rs.lineTo(-dep / 2 - 0.4, 0);
        const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(rs, { depth: len + 0.6, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: snow ? 0xf4f6f8 : 0x2b2b2e, roughness: 0.7 })); roof.rotation.y = Math.PI / 2; roof.position.set(-len / 2 - 0.3, 4.2, 0); roof.castShadow = true; g.add(roof);
        [[-len / 2, dep / 2], [len / 2, dep / 2], [-len / 2, -dep / 2], [len / 2, -dep / 2]].forEach(([cx, cz]) => { const t = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.25, 0.22), new THREE.MeshStandardMaterial({ color: 0xf2efe8 })); t.position.set(cx, 2.1, cz); g.add(t); });
        for (let k = -1; k <= 1; k++) { const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 0.08), new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.2, metalness: 0.3 })); win.position.set(k * len / 4, 2.3, dep / 2 + 0.02); g.add(win); }
        g.position.set(x, 0, z); g.rotation.y = rot; landscape.add(g);
      });
    } else {
      // Almería: neighbouring flat-roofed plastic ("parral") greenhouses — the "sea of plastic"
      const pm = new THREE.MeshStandardMaterial({ color: 0xf1f1ea, roughness: 0.45, metalness: 0, transparent: true, opacity: 0.93 });
      const rr = rng(4);
      for (let i = 0; i < 26; i++) {
        const a = rr() * Math.PI * 2, R = 45 + rr() * 150; const w = 25 + rr() * 45, d = 20 + rr() * 40, hh = 3.2 + rr() * 1.2;
        const gg = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), pm); gg.position.set(Math.cos(a) * R, hh / 2, Math.sin(a) * R); gg.rotation.y = rr() * 0.3; gg.receiveShadow = true; landscape.add(gg);
      }
    }
  }
  api.buildLandscape = buildLandscape;

  /* ---------- plume and CO₂ puffs */
  const plume = new Puffs({ max: 360, size: 2.2, opacity: 0.55, life: 9 }); scene.add(plume.points);
  const chimneyTop = new THREE.Vector3(21.8, 13.1, -5.4);
  const puffs = new Puffs({ max: 500, size: 0.22, opacity: 0.35, life: 3 }); gh.add(puffs.points);

  /* ---------- labels */
  const labels = {
    vents: stage.addLabel([X0 + GH.spanWidth * 3.5, H + RIDGE + 0.9, Z0 + 2], ''),
    screen: stage.addLabel([X0 + 2.5, H - 0.4, 5], ''),
    pipes: stage.addLabel([PATHS[3], 0.55, ROW_Z1 + 0.8], ''),
    sensor: stage.addLabel(cbox, '', { offset: [0, 0.45, 0], className: 'label3d' }),
    co2: stage.addLabel(co2, '', { offset: [0, 8.4, 0] }),
    boiler: stage.addLabel(bh, '', { offset: [0, 5.2, 0] }),
    weather: stage.addLabel(mast, '', { offset: [0, 8.3, 0] }),
    crop: stage.addLabel([GUTTERS[8], 3.2, -3], '')
  };
  Object.values(labels).forEach(l => { l.visible = false; });
  api.labels = labels;

  /* ---------- per-frame state application */
  const cTmp = new THREE.Color();
  let state = null, anemAngle = 0, fanAngle = 0;
  const INSIDE = new Set(['vents', 'screen', 'pipes', 'sensor', 'crop']), OUTSIDE = new Set(['vents', 'co2', 'boiler', 'weather']);
  /** Show the labels that make sense from where the camera is (inside the glasshouse or outside). */
  // (CSS2DRenderer sets element.style.display itself on every frame, so toggle the objects' visibility instead)
  api.setLabelsVisible = (on, inside) => Object.entries(labels).forEach(([k, l]) => { l.visible = !!(on && (inside ? INSIDE.has(k) : OUTSIDE.has(k))); });
  api.cameraInside = cam => Math.abs(cam.position.x) < W / 2 && Math.abs(cam.position.z) < L / 2 && cam.position.y < H + RIDGE;
  api.update = s => { state = s; };
  api.setLamps = on => { lampGroup.visible = on; };
  api.frame = (dt, t) => {
    if (!state) return;
    const s = state;
    gh.setVents(s.u);
    setScreen(s.s);
    // pipes: false colour by surface temperature (thermal-camera style)
    const tp = THREE.MathUtils.clamp((s.Tp - 20) / 70, 0, 1);
    if (s.thermal) { const c = colormap('inferno', 0.12 + 0.88 * tp); cTmp.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace); pipeMat.emissive.copy(cTmp); pipeMat.emissiveIntensity = 0.15 + 3.4 * tp * tp; }
    else { pipeMat.emissive.setHex(0xff7a30); pipeMat.emissiveIntensity = 1.2 * tp * tp; }
    // condensation film (glass and, when the screen is closed, less visible)
    const cRate = Math.max(0, s.Mglass) * 3.6e6;                 // g m⁻² h⁻¹
    const target = THREE.MathUtils.clamp(cRate / 60, 0, 1) * 0.95;
    condMat.opacity += (target - condMat.opacity) * Math.min(1, dt * 3);
    wallCondMat.opacity = condMat.opacity * 0.9;
    cond.visible = condMat.opacity > 0.01;
    glassMats.forEach(m => { m.opacity = 0.07 + 0.12 * condMat.opacity; });
    // lamps
    const lampF = s.PL > 0 ? 1 : 0;
    if (lampGroup.visible) { lampBars.forEach(b => b.setIntensity(lampF ? 1 : 0)); lampLight.intensity = lampF * 0.9; lampPoint.intensity = lampF * 60; }
    // CO₂ dosing: tubes glow faintly, puffs rise into the crop, vaporiser frosts
    const doseF = THREE.MathUtils.clamp(s.dose / 5.14, 0, 1);
    co2Mat.emissiveIntensity = 0.35 * doseF;
    vapMat.color.setRGB(0.79 + 0.2 * doseF, 0.8 + 0.2 * doseF, 0.82 + 0.18 * doseF); vapMat.roughness = 0.35 + 0.5 * doseF; vapMat.metalness = 0.9 - 0.6 * doseF;
    puffs.emit(dt * 160 * doseF, () => { const gx = GUTTERS[Math.floor(Math.random() * GUTTERS.length)]; return { x: gx + 0.12, y: GUTTER_Y - 0.18, z: ROW_Z0 + Math.random() * (ROW_Z1 - ROW_Z0), vx: (Math.random() - 0.5) * 0.3, vy: 0.35 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.3, age: 0, life: 2 + Math.random() * 1.5, a: 0.6 }; });
    puffs.update(dt, [0, 0, 0]);
    // chimney plume ∝ heat demand, drifting downwind
    const heatF = THREE.MathUtils.clamp(s.Qheat / 200, 0, 1.3);
    plume.mat.opacity = 0.35 + 0.35 * THREE.MathUtils.clamp((6 - s.To) / 20, 0, 1);
    plume.emit(dt * 30 * heatF, () => ({ x: chimneyTop.x + (Math.random() - 0.5) * 0.3, y: chimneyTop.y, z: chimneyTop.z + (Math.random() - 0.5) * 0.3, vx: 0, vy: 1.2 + Math.random() * 0.6, vz: 0, age: 0, life: 6 + Math.random() * 4, a: 0.8 }));
    plume.update(dt, [0.6 * s.wind, 0, 0.25 * s.wind]);
    // anemometer and fan
    anemAngle += dt * s.wind * 2.2; anem.rotation.y = anemAngle;
    fanAngle += dt * 30; fan.rotation.y = fanAngle;
  };
  api.gh = gh; api.co2 = co2; api.cbox = cbox; api.mast = mast;
  api.GH = GH; api.X0 = X0; api.Z0 = Z0; api.H = H; api.RIDGE = RIDGE; api.PATHS = PATHS; api.GUTTERS = GUTTERS; api.ROW_Z0 = ROW_Z0; api.ROW_Z1 = ROW_Z1;
  return api;
}
