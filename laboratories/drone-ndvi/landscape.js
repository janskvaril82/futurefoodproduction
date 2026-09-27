/* Drone NDVI survey — 3D landscape: the wheat field painted from the reflectance model, tramlines, hedgerows,
   spruce forest, deciduous trees, a Falu-red farmstead, farm track, neighbouring fields, the drone with its camera
   footprint, the flight path and the NDVI drape. Uses /assets/js/lab3d.js (three.js r170). */
import { THREE, M, surfaceTextures, surfaceMaterial, canvasTexture, makeDrone, makeFieldCrop, leafGeometry, leafMaterial, BufferGeometryUtils, rng, fbm2, noise2 } from '/assets/js/lab3d.js';
import { FIELD, STRIP, GATE, PAD, tramlines, trackDistance, coverOf, colourOptics } from './field.js';

const { W, D } = FIELD;
const srgb = v => { v = Math.max(0, Math.min(1, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };
const lerp = (a, b, t) => a + (b - a) * t;

/* ================================================================ colours from the reflectance model */
/**
 * Display colours (linear RGB) of the dense crop (by chlorophyll), thistle leaves and soil (by moisture), computed from the
 * band-averaged reflectance model (red 645, green 555, blue 470 nm) and then "white-balanced" like a photograph:
 * sunlit leaves appear brighter than the diffuse canopy reflectance, soils warmer. Only the display is adjusted.
 */
export const LEAF_GAIN = [2.3, 2.05, 1.1], SOIL_GAIN = [1.0, 0.82, 0.62];
export function colourModel() {
  const O = colourOptics();               // [red 645, green 555, blue 470]
  const leafDense = cab => O.map((o, q) => { const c = Math.max(0, Math.min(80, cab)), i = Math.min(79, Math.floor(c)), f = c - i; const r = o.r[i] * (1 - f) + o.r[i + 1] * f, t = o.t[i] * (1 - f) + o.t[i + 1] * f; const a = (1 - t) / r; return LEAF_GAIN[q] * (a - Math.sqrt(Math.max(0, a * a - 1))); });
  const weed = O.map((o, q) => { const a = (1 - o.tw) / o.rw; return 0.8 * LEAF_GAIN[q] * (a - Math.sqrt(Math.max(0, a * a - 1))); });
  const soil = w => O.map((o, q) => SOIL_GAIN[q] * ((1 - w) * o.sd + w * o.sw));
  return { leafDense, weed, soil };
}

/* ================================================================ the field surface */
const TEX_W = 2048, TEX_H = 1366;
/**
 * Paint the field (true-colour albedo as seen obliquely): canopy of crop (+ thistles) over soil, wheel tracks bare.
 * Returns an sRGB canvas TEX_W × TEX_H (row 0 = north edge, z = −D/2).
 */
export function paintField(F, canvas) {
  const cm = colourModel();
  canvas.width = TEX_W; canvas.height = TEX_H;
  const ctx = canvas.getContext('2d'); const img = ctx.createImageData(TEX_W, TEX_H); const d = img.data;
  const NX = F.NX, NZ = F.NZ, N = NX * NZ;
  // per-cell colours (linear) and cover
  const cr = new Float32Array(N), cg = new Float32Array(N), cb = new Float32Array(N), cov = new Float32Array(N), wd = new Float32Array(N);
  const sr = new Float32Array(N), sg = new Float32Array(N), sb = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const L = F.lai[k] + F.laiW[k];
    const leaf = cm.leafDense(F.cab[k]);
    const wf = L > 0 ? F.laiW[k] / L : 0;
    cr[k] = lerp(leaf[0], cm.weed[0], wf); cg[k] = lerp(leaf[1], cm.weed[1], wf); cb[k] = lerp(leaf[2], cm.weed[2], wf);
    cov[k] = 1 - Math.exp(-0.5 * L / 0.6);            // gap fraction at a view zenith of ≈ 53° (cos = 0.6)
    wd[k] = F.weed[k];
    const s = cm.soil(F.soilW[k]); sr[k] = s[0]; sg[k] = s[1]; sb[k] = s[2];
  }
  const T = tramlines();
  const dz = new Float32Array(TEX_H), dx = new Float32Array(TEX_W);
  for (let v = 0; v < TEX_H; v++) { const z = -D / 2 + (v + 0.5) * D / TEX_H; let m = Infinity; for (const zc of T.z) m = Math.min(m, Math.abs(z - zc)); dz[v] = m; }
  for (let u = 0; u < TEX_W; u++) { const x = -W / 2 + (u + 0.5) * W / TEX_W; let m = Infinity; for (const xc of T.x) m = Math.min(m, Math.abs(x - xc)); dx[u] = m; }
  const r = rng(F.seed * 13 + 1);
  const hash = (u, v) => { let h = (u * 374761393 + v * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const gain = 1, HL = FIELD.head;
  for (let v = 0; v < TEX_H; v++) {
    const z = -D / 2 + (v + 0.5) * D / TEX_H, fj = Math.max(0, Math.min(NZ - 1.001, z + D / 2 - 0.5)), j0 = Math.floor(fj), tj = fj - j0;
    const inZ = z >= T.zmin - 0.3 && z <= T.zmax + 0.3;
    // drill passes 3 m wide along x (alternately slightly lighter/darker, as in aerial photos of cereals)
    const passF = (Math.floor((z + D / 2 - HL) / 3) & 1) ? 1.035 : 0.965;
    for (let u = 0; u < TEX_W; u++) {
      const x = -W / 2 + (u + 0.5) * W / TEX_W, fi = Math.max(0, Math.min(NX - 1.001, x + W / 2 - 0.5)), i0 = Math.floor(fi), ti = fi - i0;
      // headland (outer 12 m) is sown round the field: rows parallel to the nearest edge
      const dW = x + W / 2, dE = W / 2 - x, dN = z + D / 2, dS = D / 2 - z, dMin = Math.min(dW, dE, dN, dS);
      const head = dMin < HL, rowAlongZ = head && Math.min(dW, dE) < Math.min(dN, dS);
      const rowPhase = 0.5 + 0.5 * Math.cos(2 * Math.PI * (rowAlongZ ? x + W / 2 : z + D / 2) / 0.125);
      const band = head ? 0.955 : passF;
      const k00 = j0 * NX + i0, k10 = k00 + 1, k01 = k00 + NX, k11 = k01 + 1;
      const bl = a => (a[k00] * (1 - ti) + a[k10] * ti) * (1 - tj) + (a[k01] * (1 - ti) + a[k11] * ti) * tj;
      const inX = x >= T.xmin - 0.3 && x <= T.xmax + 0.3;
      const onTrack = (inX && dz[v] < 0.26) || (inZ && dx[u] < 0.26);
      const n1 = hash(u, v), n2 = hash(u + 7919, v + 104729);
      let c = bl(cov); const w = bl(wd);
      // thistle clumps: dark rosettes where weed density is high
      const thistle = w > 0.05 && n2 < w * 0.55;
      let R, G, B;
      const soilN = 0.88 + 0.24 * n1;
      const s = [bl(sr) * soilN, bl(sg) * soilN, bl(sb) * soilN];
      if (onTrack) { R = s[0] * 0.9; G = s[1] * 0.9; B = s[2] * 0.9; }
      else {
        const leafN = (0.8 + 0.4 * n1) * band;
        let lr = bl(cr) * leafN * gain, lg = bl(cg) * leafN * gain, lb = bl(cb) * leafN * gain;
        if (thistle) { lr = 0.045 + 0.03 * n1; lg = 0.11 + 0.04 * n1; lb = 0.06 + 0.02 * n1; c = Math.max(c, 0.95); }
        const cc = Math.min(1, c * (0.92 + 0.12 * rowPhase));
        const shade = 0.85 + 0.15 * cc;                    // self-shading of the soil between plants
        R = lerp(s[0] * shade, lr, cc); G = lerp(s[1] * shade, lg, cc); B = lerp(s[2] * shade, lb, cc);
      }
      // mild saturation boost in display space
      let sR = srgb(R), sG = srgb(G), sB = srgb(B); const Lm = 0.3 * sR + 0.59 * sG + 0.11 * sB;
      sR = Lm + 1.18 * (sR - Lm); sG = Lm + 1.18 * (sG - Lm); sB = Lm + 1.18 * (sB - Lm);
      const o = (v * TEX_W + u) * 4;
      d[o] = 255 * sR; d[o + 1] = 255 * sG; d[o + 2] = 255 * sB; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function buildField(F) {
  const group = new THREE.Group(); group.name = 'field';
  const cv = document.createElement('canvas'); paintField(F, cv);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const rows = surfaceTextures({ key: 'wheat-rows', size: 256, scale: 28, octaves: 4, palette: ['#777', '#999'], normalStrength: 2.6, stripes: 16, stripeDepth: 0.55, roughBase: 0.85, roughVar: 0.12 });
  const nrm = rows.normal.clone(); nrm.repeat.set(W / 2, D / 2); nrm.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(W, D, 150, 100); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let q = 0; q < pos.count; q++) { const x = pos.getX(q), z = pos.getZ(q); pos.setY(q, canopyHeight(F, x, z)); }
  geo.computeVertexNormals();
  // low specular reflectance and a soft green sheen at grazing angles, like a leafy canopy
  const mat = new THREE.MeshPhysicalMaterial({ map: tex, normalMap: nrm, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.92, metalness: 0, specularIntensity: 0.25, sheen: 0.45, sheenRoughness: 0.55, sheenColor: new THREE.Color(0x86b35a), envMapIntensity: 0.55 });
  addHole(mat);
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; mesh.name = 'crop';
  group.add(mesh);
  // soil skirt around the field edge (the crop surface sits ~0.3 m above ground)
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.3, D + 0.4), surfaceMaterial('tilled', [W / 3, D / 3]));
  skirt.position.y = -0.14; skirt.receiveShadow = true; group.add(skirt);
  group.userData = { mesh, tex, canvas: cv, geo };
  return group;
}
/* A rectangular hole (x0, z0, x1, z1) cut into the field surface and drape where the detailed ground patch stands. */
export const HOLE = { value: new THREE.Vector4(1e6, 1e6, 1e6, 1e6) };
function addHole(mat) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uHole = HOLE;
    sh.vertexShader = 'varying vec2 vHolePos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vHolePos = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = 'uniform vec4 uHole;\nvarying vec2 vHolePos;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (vHolePos.x > uHole.x && vHolePos.x < uHole.z && vHolePos.y > uHole.y && vHolePos.y < uHole.w) discard;');
  };
  mat.customProgramCacheKey = () => 'field-hole-' + mat.type;
}
export function setHole(x0, z0, x1, z1) { HOLE.value.set(x0, z0, x1, z1); }
/** Canopy-top height (m) for the 3D surface, 0 on wheel tracks. */
export function canopyHeight(F, x, z) {
  const i = Math.max(0, Math.min(F.NX - 1, Math.floor(x + W / 2))), j = Math.max(0, Math.min(F.NZ - 1, Math.floor(z + D / 2)));
  const k = j * F.NX + i; return F.h[k] * (1 - 0.7 * F.track[k]) * 0.8;
}
export function repaintField(group, F) {
  const u = group.userData; paintField(F, u.canvas); u.tex.needsUpdate = true;
  const pos = u.geo.attributes.position;
  for (let q = 0; q < pos.count; q++) pos.setY(q, canopyHeight(F, pos.getX(q), pos.getZ(q)));
  pos.needsUpdate = true; u.geo.computeVertexNormals();
}

/* ================================================================ drape (NDVI / zones / N-rate map on the crop) */
export function buildDrape(fieldGroup, mapCanvas) {
  const tex = new THREE.CanvasTexture(mapCanvas); tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  addHole(mat);
  const m = new THREE.Mesh(fieldGroup.userData.geo, mat); m.position.y = 0.06; m.renderOrder = 2; m.name = 'drape';
  fieldGroup.add(m); m.userData.tex = tex;
  return m;
}

/* ================================================================ surroundings */
function fieldMat(palette, key, rep, extra = {}) {
  const s = surfaceTextures(Object.assign({ key, size: 256, scale: 18, octaves: 5, palette, normalStrength: 2.2, speckle: 0.06, roughBase: 0.9 }, extra));
  const m = new THREE.MeshStandardMaterial({ map: s.color.clone(), normalMap: s.normal.clone(), roughnessMap: s.rough.clone(), roughness: 1 });
  [m.map, m.normalMap, m.roughnessMap].forEach(t => { t.repeat.set(rep[0], rep[1]); t.needsUpdate = true; });
  return m;
}
function plane(w, d, mat, x, z, y = 0) { const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.receiveShadow = true; return m; }

function spruceGeometry(seed) {
  const r = rng(seed), parts = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.3, 3, 5); trunk.translate(0, 1.5, 0); paint(trunk, [0.2, 0.14, 0.09]); parts.push(trunk);
  const tiers = 5;
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers, rad = 2.5 * (1 - f * 0.8), h = 4.4 * (1 - f * 0.3);
    const c = new THREE.ConeGeometry(rad, h, 7, 1, true); c.translate(0, 1.8 + f * 14.5 + h / 2, 0);
    const p = c.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), s = 1 + (r() - 0.5) * 0.35; p.setX(i, x * s); p.setZ(i, z * s); if (p.getY(i) < 1.8 + f * 14.5 + h * 0.5) p.setY(i, p.getY(i) - r() * 0.6); }
    c.computeVertexNormals(); paint(c, [0.028 + 0.012 * r(), 0.062 + 0.03 * f + 0.015 * r(), 0.042 + 0.012 * r()], true); parts.push(c);
  }
  return BufferGeometryUtils.mergeGeometries(parts.map(g => g.toNonIndexed()));
}
/** Distant forest edge: a band of tree silhouettes (canvas alpha texture) on a vertical plane. */
function treeline(width, height, seed) {
  const tex = canvasTexture(2048, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h); const r = rng(seed);
    ['#16241a', '#1b2d1d', '#213823'].forEach((col, layer) => {
      ctx.fillStyle = col; let x = -20;
      while (x < w + 20) {
        const ht = h * (0.5 + 0.42 * r()) * (1 - 0.1 * layer), wd = 9 + r() * 13;
        if (r() < 0.82) { ctx.beginPath(); ctx.moveTo(x - wd, h); const steps = 7; for (let s = 0; s <= steps; s++) { const yy = h - ht * s / steps; const ww = wd * (1 - s / steps) * (0.75 + 0.45 * r()); ctx.lineTo(x - ww, yy); } for (let s = steps; s >= 0; s--) { const yy = h - ht * s / steps; const ww = wd * (1 - s / steps) * (0.75 + 0.45 * r()); ctx.lineTo(x + ww, yy); } ctx.closePath(); ctx.fill(); }
        else { ctx.beginPath(); ctx.ellipse(x, h - ht * 0.72, wd * 1.3, ht * 0.32, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(x - 1.5, h - ht * 0.5, 3, ht * 0.5); }
        x += wd * (0.55 + 0.5 * r());
      }
    });
    ctx.fillRect(0, h - 8, w, 8);
  }, { srgb: true, key: 'treeline-' + seed, repeat: [width / 700, 1] });
  tex.wrapT = THREE.ClampToEdgeWrapping;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: 0xb9c7b4 }));
  m.position.y = height / 2 - 0.4; return m;
}
function paint(geo, rgb, shadeByHeight = false) {
  const p = geo.attributes.position, col = new Float32Array(p.count * 3);
  let y0 = Infinity, y1 = -Infinity; for (let i = 0; i < p.count; i++) { y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i)); }
  for (let i = 0; i < p.count; i++) { const f = shadeByHeight ? 0.55 + 0.6 * (p.getY(i) - y0) / (y1 - y0 || 1) : 1; col[i * 3] = rgb[0] * f; col[i * 3 + 1] = rgb[1] * f; col[i * 3 + 2] = rgb[2] * f; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
function blob(radius, detail, seed, rgb, squash = 0.8) {
  const g = new THREE.IcosahedronGeometry(radius, detail); const p = g.attributes.position; const r = rng(seed);
  const o = r() * 100;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)); const n = v.clone().normalize();
    const s = 1 + 0.28 * noise2(n.x * 2.3 + o, n.y * 2.3 + n.z * 1.7 - o) + 0.12 * noise2(n.z * 6 + o, n.x * 6 - n.y * 3);
    v.multiplyScalar(s); v.y *= squash; p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const f = 0.62 + 0.55 * Math.max(0, (p.getY(i) / radius + 1) / 2) + (r() - 0.5) * 0.12; col[i * 3] = rgb[0] * f; col[i * 3 + 1] = rgb[1] * f; col[i * 3 + 2] = rgb[2] * f; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g.index ? g.toNonIndexed() : g;
}
function broadleafGeometry(seed, birch = false) {
  const r = rng(seed), parts = [];
  const trunkH = birch ? 5.5 : 4.2;
  const trunk = new THREE.CylinderGeometry(birch ? 0.16 : 0.32, birch ? 0.24 : 0.5, trunkH, 7); trunk.translate(0, trunkH / 2, 0);
  paint(trunk, birch ? [0.78, 0.76, 0.72] : [0.2, 0.15, 0.1]); parts.push(trunk.toNonIndexed());
  const nb = birch ? 7 : 9, crownY = trunkH + (birch ? 3.2 : 3.4), crownR = birch ? 2.6 : 4.2;
  for (let b = 0; b < nb; b++) {
    const a = r() * Math.PI * 2, rr = crownR * (0.25 + 0.55 * r()), y = crownY + (r() - 0.35) * crownR * 0.9;
    const g = blob(crownR * (0.42 + 0.22 * r()), 2, seed * 17 + b, birch ? [0.24, 0.4, 0.12] : [0.15, 0.27, 0.09], birch ? 0.95 : 0.82);
    g.translate(Math.cos(a) * rr, y, Math.sin(a) * rr); parts.push(g);
  }
  return BufferGeometryUtils.mergeGeometries(parts);
}
function scatterInstanced(geo, mat, list) {
  const im = new THREE.InstancedMesh(geo, mat, list.length); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  list.forEach((t, i) => { e.set(0, t.rot || 0, 0); q.setFromEuler(e); m4.compose(new THREE.Vector3(t.x, t.y || 0, t.z), q, new THREE.Vector3(t.s, t.sy || t.s, t.s)); im.setMatrixAt(i, m4); });
  im.castShadow = true; im.receiveShadow = true; return im;
}

/** Falu-red timber building with white trims and a dark roof. */
function makeBuilding({ w = 24, d = 12, h = 6, roofH = 4, red = 0x7a2a1d, roof = 0x2b2d30, doors = true, windows = 6, house = false }) {
  const g = new THREE.Group();
  const boards = canvasTexture(256, 256, (ctx, W2, H2) => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W2, H2); for (let x = 0; x < W2; x += 16) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x, 0, 2, H2); ctx.fillStyle = 'rgba(0,0,0,0.05)'; ctx.fillRect(x + 8, 0, 1, H2); } for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; ctx.fillRect(Math.random() * W2, Math.random() * H2, 2, 8 + Math.random() * 30); } }, { key: 'falu-boards', repeat: [w / 3, h / 3] });
  const wallMat = new THREE.MeshStandardMaterial({ color: red, map: boards, roughness: 0.92 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat); body.position.y = h / 2; g.add(body);
  // gables
  const sh = new THREE.Shape(); sh.moveTo(-d / 2, 0); sh.lineTo(d / 2, 0); sh.lineTo(0, roofH); sh.lineTo(-d / 2, 0);
  const gab = new THREE.ShapeGeometry(sh);
  [-1, 1].forEach(s => { const m = new THREE.Mesh(gab, wallMat); m.rotation.y = Math.PI / 2 * s; m.position.set(s * w / 2, h, 0); if (s < 0) m.rotation.y = -Math.PI / 2; g.add(m); });
  // roof planes
  const slope = Math.hypot(d / 2, roofH) + 0.5, ang = Math.atan2(roofH, d / 2);
  const corr = surfaceTextures({ key: 'corrugated', size: 128, scale: 3, octaves: 2, palette: ['#666', '#888'], stripes: 24, stripeDepth: 0.8, normalStrength: 3, roughBase: 0.55 });
  const nm = corr.normal.clone(); nm.repeat.set(1, w / 2); nm.needsUpdate = true;
  const roofMat = new THREE.MeshStandardMaterial({ color: roof, roughness: 0.6, metalness: 0.35, normalMap: nm });
  [-1, 1].forEach(s => { const m = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.12, slope), roofMat); m.position.set(0, h + roofH / 2, s * d / 4); m.rotation.x = s * ang; g.add(m); });
  // trims
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => { const t = new THREE.Mesh(new THREE.BoxGeometry(0.22, h, 0.22), white); t.position.set(a * (w / 2 + 0.02), h / 2, b * (d / 2 + 0.02)); g.add(t); });
  [-1, 1].forEach(s => { const t = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.25, 0.08), white); t.position.set(0, h - 0.12, s * (d / 2 + 0.05)); g.add(t); });
  // windows
  const glass = new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.15, metalness: 0.3 });
  const nwin = windows;
  for (let i = 0; i < nwin; i++) {
    const x = -w / 2 + (i + 0.5) * w / nwin; if (doors && Math.abs(x) < 3.2) continue;
    [house ? [h * 0.3, h * 0.75] : [h * 0.62]].flat().forEach(y => {
      const fr = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.5, 0.12), white); fr.position.set(x, y, d / 2 + 0.04); g.add(fr);
      const gl = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 0.14), glass); gl.position.set(x, y, d / 2 + 0.05); g.add(gl);
    });
  }
  if (doors) {
    const fr = new THREE.Mesh(new THREE.BoxGeometry(5.6, h * 0.72, 0.1), white); fr.position.set(0, h * 0.36, d / 2 + 0.04); g.add(fr);
    const door = new THREE.Mesh(new THREE.BoxGeometry(5.1, h * 0.68, 0.14), wallMat); door.position.set(0, h * 0.34, d / 2 + 0.06); g.add(door);
    [1, -1].forEach(s => { const br = new THREE.Mesh(new THREE.BoxGeometry(0.18, Math.hypot(2.5, h * 0.68), 0.16), white); br.position.set(s * 1.28, h * 0.34, d / 2 + 0.1); br.rotation.z = s * Math.atan2(2.5, h * 0.68); g.add(br); const br2 = br.clone(); br2.rotation.z = -br.rotation.z; g.add(br2); });
  }
  if (house) { const ch = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.2, 0.8), new THREE.MeshStandardMaterial({ color: 0x55473f, roughness: 0.9 })); ch.position.set(w * 0.2, h + roofH * 0.8, 0); g.add(ch); }
  g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return g;
}

export function buildSurroundings(scene) {
  const g = new THREE.Group(); g.name = 'surroundings';
  // base ground (grass) — large, fogged at the horizon
  g.add(plane(5000, 5000, fieldMat(['#587c34', '#658a3a', '#729642', '#80a24a'], 'meadow', [900, 900], { scale: 22 }), 0, 0, -0.35));
  // neighbouring fields
  g.add(plane(330, 260, fieldMat(['#8f8f3a', '#a9a443', '#c1b64c', '#cfc35a', '#9fa04a'], 'rapeseed', [70, 55], { scale: 30, speckle: 0.2, normalStrength: 3 }), -10, -245, -0.05));   // oilseed rape, north
  g.add(plane(260, 360, fieldMat(['#4d6f2b', '#5b7f33', '#6a8d3b', '#78993f'], 'ley', [60, 80], { scale: 26, normalStrength: 2 }), 300, 0, -0.08));   // grass ley, east
  g.add(plane(420, 220, fieldMat(['#6d8f3c', '#7b9c45', '#86a64c', '#92ae57'], 'barley', [90, 50], { scale: 14, stripes: 30, stripeDepth: 0.3 }), 40, 235, -0.07));   // spring barley, south
  // farm track along the south edge and a yard by the buildings
  const gravel = fieldMat(['#7a7466', '#8f887a', '#a39c8e', '#b3ad9f'], 'gravel-track', [260, 2], { scale: 40, speckle: 0.25, normalStrength: 4 });
  g.add(plane(1100, 4.2, gravel, 0, 110, -0.02));
  g.add(plane(70, 50, fieldMat(['#7a7466', '#8f887a', '#a39c8e', '#b3ad9f'], 'gravel-yard', [18, 13], { scale: 40, speckle: 0.25 }), -205, 140, -0.03));
  g.add(plane(4.5, 24, gravel, GATE.x, GATE.z + 6, -0.015));                         // field entrance
  // ditch along the north edge
  g.add(plane(W + 60, 2.2, new THREE.MeshStandardMaterial({ color: 0x31401f, roughness: 1 }), 0, -D / 2 - 5, -0.3));
  // drone take-off pad
  const padMat = new THREE.MeshStandardMaterial({ color: 0xe8702a, roughness: 0.6 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.03, 32), padMat); pad.position.set(PAD.x, 0.0, PAD.z); pad.receiveShadow = true; g.add(pad);
  const padH = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })); padH.rotation.x = Math.PI / 2; padH.position.set(PAD.x, 0.03, PAD.z); g.add(padH);

  // spruce forest (west and north-west) and a distant forest rim
  const spruce = spruceGeometry(3); const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const r = rng(99); const spr = [];
  // a dense spruce stand west of the field (jittered grid ≈ 7 m), thinning at its edge
  for (let x = -188; x > -365; x -= 7) for (let z = -300; z < 300; z += 7) {
    const edge = Math.min(1, (-178 - x) / 25); if (r() > 0.35 + 0.65 * edge) continue;
    if ((z > 92 && z < 215 && x > -285) || (z > 100 && z < 120)) continue;       // farmstead, yard and farm track
    spr.push({ x: x + (r() - 0.5) * 5, z: z + (r() - 0.5) * 5, s: 0.85 + r() * 0.5, sy: 0.8 + r() * 0.6, rot: r() * 6.28 });
  }
  // a second stand north of the rapeseed field
  for (let x = -180; x < 420; x += 8) for (let z = -392; z > -470; z -= 8) { if (r() > 0.85) continue; spr.push({ x: x + (r() - 0.5) * 6, z: z + (r() - 0.5) * 6, s: 0.9 + r() * 0.5, sy: 0.8 + r() * 0.6, rot: r() * 6.28 }); }
  g.add(scatterInstanced(spruce, treeMat, spr));
  // distant forest edges closing the horizon
  [[0, -950, 0, 2600], [0, 1150, Math.PI, 2600], [-1150, 0, Math.PI / 2, 2400], [1250, 0, -Math.PI / 2, 2400]].forEach(([x, z, ry, w], q) => { const t = treeline(w, 42, 7 + q); t.position.x = x; t.position.z = z; t.rotation.y = ry; g.add(t); });
  // broadleaf trees along the ditch and in the hedgerow; birches by the farmstead
  const oak = broadleafGeometry(5), birch = broadleafGeometry(9, true);
  const oaks = [], birches = [];
  for (let i = 0; i < 16; i++) oaks.push({ x: -150 + i * 20 + (r() - 0.5) * 8, z: -D / 2 - 9 - r() * 4, s: 0.8 + r() * 0.5, rot: r() * 6.28 });
  for (let i = 0; i < 7; i++) oaks.push({ x: W / 2 + 8 + r() * 3, z: -80 + i * 28 + (r() - 0.5) * 8, s: 0.75 + r() * 0.5, rot: r() * 6.28 });
  for (let i = 0; i < 9; i++) birches.push({ x: -238 + r() * 70, z: 118 + r() * 55, s: 0.85 + r() * 0.35, rot: r() * 6.28 });
  for (let i = 0; i < 6; i++) birches.push({ x: -40 + i * 45 + (r() - 0.5) * 10, z: 116 + r() * 2, s: 0.8 + r() * 0.3, rot: r() * 6.28 });
  g.add(scatterInstanced(oak, treeMat, oaks)); g.add(scatterInstanced(birch, treeMat, birches));
  // hedgerow shrubs along the east edge and along the ditch
  const shrub = BufferGeometryUtils.mergeGeometries([blob(1.6, 1, 4, [0.14, 0.25, 0.08]), (() => { const b = blob(1.2, 1, 8, [0.17, 0.29, 0.1]); b.translate(1.3, -0.2, 0.4); return b; })()]);
  const sh = [];
  for (let i = 0; i < 70; i++) sh.push({ x: W / 2 + 6 + (r() - 0.5) * 2.5, z: -D / 2 + i * D / 70 + (r() - 0.5) * 2, y: 0.6, s: 0.7 + r() * 0.6, rot: r() * 6.28 });
  for (let i = 0; i < 60; i++) sh.push({ x: -W / 2 + i * W / 60 + (r() - 0.5) * 3, z: -D / 2 - 8 + (r() - 0.5) * 2, y: 0.5, s: 0.6 + r() * 0.6, rot: r() * 6.28 });
  g.add(scatterInstanced(shrub, treeMat, sh));
  // farmstead: barn, farmhouse, machine shed
  const barn = makeBuilding({ w: 26, d: 13, h: 6.5, roofH: 4.6 }); barn.position.set(-205, 0, 150); barn.rotation.y = Math.PI; g.add(barn);
  const house = makeBuilding({ w: 13, d: 8, h: 6.2, roofH: 3.4, doors: false, windows: 5, house: true }); house.position.set(-238, 0, 128); house.rotation.y = Math.PI / 2; g.add(house);
  const shed = makeBuilding({ w: 18, d: 10, h: 4.8, roofH: 2.2, red: 0x8a3322, windows: 0 }); shed.position.set(-176, 0, 152); shed.rotation.y = Math.PI; g.add(shed);
  scene.add(g);
  return g;
}

/* ================================================================ drone, footprint, path */
export function buildDroneRig(scene) {
  const rig = new THREE.Group(); rig.name = 'droneRig';
  const drone = makeDrone({ size: 0.9, color: 0x2a2d31 });
  // gimbal-mounted multispectral camera pointing down
  const cam = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.1), M.plasticBlack()); cam.add(body);
  for (let i = 0; i < 5; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.012, 16), new THREE.MeshPhysicalMaterial({ color: 0x0a1030, roughness: 0.05, metalness: 0.5, clearcoat: 1 })); l.position.set(-0.055 + i * 0.027, -0.045, (i % 2) * 0.02 - 0.01); cam.add(l); }
  const dls = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 16), M.plasticWhite()); dls.position.y = 0.11; drone.add(dls);
  cam.position.y = -0.12; drone.add(cam);
  rig.add(drone);
  // footprint rectangle + frustum
  const fpGeo = new THREE.BufferGeometry(); fpGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(5 * 3), 3));
  const footprint = new THREE.Line(fpGeo, new THREE.LineBasicMaterial({ color: 0x7cf3ff, transparent: true, opacity: 0.95 }));
  const frGeo = new THREE.BufferGeometry(); frGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
  const frustum = new THREE.LineSegments(frGeo, new THREE.LineBasicMaterial({ color: 0x7cf3ff, transparent: true, opacity: 0.45 }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x7cf3ff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  fill.rotation.x = -Math.PI / 2; fill.renderOrder = 3;
  scene.add(rig, footprint, frustum, fill);
  const flash = new THREE.PointLight(0xbff8ff, 0, 60, 2); rig.add(flash);
  return {
    rig, drone, footprint, frustum, fill, flash,
    setFootprint(cx, cz, wAcross, lAlong, dirX, y = 0.7) {
      // lines are flown along ±x: along-track = x, across-track = z
      const hx = lAlong / 2, hz = wAcross / 2, p = fpGeo.attributes.position.array;
      const pts = [[cx - hx, cz - hz], [cx + hx, cz - hz], [cx + hx, cz + hz], [cx - hx, cz + hz], [cx - hx, cz - hz]];
      pts.forEach((q, i) => { p[i * 3] = q[0]; p[i * 3 + 1] = y; p[i * 3 + 2] = q[1]; }); fpGeo.attributes.position.needsUpdate = true;
      const d = rig.position, f = frGeo.attributes.position.array;
      pts.slice(0, 4).forEach((q, i) => { f.set([d.x, d.y - 0.2, d.z, q[0], y, q[1]], i * 6); }); frGeo.attributes.position.needsUpdate = true;
      fill.position.set(cx, y + 0.02, cz); fill.scale.set(lAlong, wAcross, 1);
    },
    setVisible(v) { rig.visible = footprint.visible = frustum.visible = fill.visible = v; }
  };
}
export function buildPathLine(plan) {
  const pts = [];
  plan.segs.forEach((s, i) => { if (i === 0) pts.push(new THREE.Vector3(...s.a)); pts.push(new THREE.Vector3(...s.b)); });
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xf07ad0, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.38 }));
  line.computeLineDistances(); line.name = 'path';
  const capGeo = new THREE.SphereGeometry(0.4, 8, 6);
  const caps = new THREE.InstancedMesh(capGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }), Math.max(1, plan.caps.length));
  caps.count = 0; caps.frustumCulled = false;
  const g = new THREE.Group(); g.add(line, caps); g.userData = { caps };
  return g;
}

/* ================================================================ ground-truth patch (close-up) */
function thistleGeometry(seed) {
  const r = rng(seed), parts = [];
  const stem = new THREE.CylinderGeometry(0.006, 0.01, 0.55, 5); stem.translate(0, 0.275, 0);
  const sc = new Float32Array(stem.attributes.position.count * 3).fill(0); for (let i = 0; i < sc.length; i += 3) { sc[i] = 0.25; sc[i + 1] = 0.38; sc[i + 2] = 0.2; }
  stem.setAttribute('color', new THREE.BufferAttribute(sc, 3)); stem.setAttribute('uv', stem.attributes.uv);
  parts.push(stem.toNonIndexed());
  for (let k = 0; k < 9; k++) {
    const y = 0.08 + k * 0.05, len = 0.2 - k * 0.013;
    const lg = leafGeometry({ length: len, width: len * 0.42, shape: 'oak', pitch: 1.05 + r() * 0.2, curl: 0.35, cup: 0.15, ruffle: 0.006, ruffleFreq: 14, petiole: 0.05, seed: seed * 31 + k, colors: ['#8fae6e', '#4f7040', '#355a2e'] });
    lg.applyMatrix4(new THREE.Matrix4().makeRotationY(k * 2.4 + r() * 0.3)); lg.applyMatrix4(new THREE.Matrix4().makeTranslation(0, y, 0));
    parts.push(lg.index ? lg.toNonIndexed() : lg);
  }
  parts.forEach(p => { ['normal', 'uv', 'color'].forEach(a => { if (!p.attributes[a]) { const n = p.attributes.position.count; p.setAttribute(a, new THREE.BufferAttribute(new Float32Array(n * (a === 'uv' ? 2 : 3)).fill(a === 'color' ? 0.4 : 0), a === 'uv' ? 2 : 3)); } }); if (!p.attributes.normal || p.attributes.normal.count === 0) p.computeVertexNormals(); });
  return BufferGeometryUtils.mergeGeometries(parts.map(p => { const q = new THREE.BufferGeometry(); ['position', 'normal', 'uv', 'color'].forEach(a => q.setAttribute(a, p.attributes[a])); return q; }));
}
let thistleGeo = null;
/** Build a detailed patch of plants (≈ 12 m × 8 m) centred on (x, z) from the hidden truth. */
export function buildGroundPatch(F, x, z) {
  const g = new THREE.Group(); g.name = 'groundPatch';
  const cm = colourModel();
  const w = 12, d = 8; const x0 = Math.max(-W / 2 + w / 2, Math.min(W / 2 - w / 2, x)), z0 = Math.max(-D / 2 + d / 2, Math.min(D / 2 - d / 2, z));
  const T = tramlines();
  const cell = (xx, zz) => { const i = Math.max(0, Math.min(F.NX - 1, Math.floor(xx + W / 2))), j = Math.max(0, Math.min(F.NZ - 1, Math.floor(zz + D / 2))); return j * F.NX + i; };
  const onTrack = (xx, zz) => trackDistance(xx, zz, T) < 0.27;
  const crop = makeFieldCrop({
    width: w, depth: d, rowSpacing: 0.125, plantSpacing: 0.05, height: 0.4, maxInstances: 9000, bladeWidth: 0.016, seed: F.seed + 5, origin: [x0, z0],
    heightFn: (xx, zz) => { if (onTrack(xx, zz)) return 0.01; const k = cell(xx, zz); const cover = 1 - Math.exp(-0.5 * F.lai[k]); return Math.random() < 0.35 + 0.65 * cover ? F.h[k] * 1.05 : 0.01; },
    colorFn: (xx, zz) => { const k = cell(xx, zz), c = cm.leafDense(F.cab[k]); return new THREE.Color(Math.min(1, c[0] * 1.15), Math.min(1, c[1] * 1.15), Math.min(1, c[2] * 1.15)); }
  });
  g.add(crop); g.userData.crop = crop;
  // soil under the patch (wet soil darker)
  const k0 = cell(x0, z0); const s = cm.soil(F.soilW[k0]);
  const s0 = cm.soil(0.2); const soilMat = surfaceMaterial('tilled', [w / 1.5, d / 1.5]); soilMat.color = new THREE.Color(Math.min(1.2, s[0] / s0[0]), Math.min(1.2, s[1] / s0[1]), Math.min(1.2, s[2] / s0[2]));
  const soil = new THREE.Mesh(new THREE.PlaneGeometry(w + 1, d + 1).rotateX(-Math.PI / 2), soilMat); soil.position.set(x0, 0.02, z0); soil.receiveShadow = true; g.add(soil);
  // thistles where the weed density is high
  const r = rng(Math.floor(x0 * 13 + z0 * 7));
  const th = [];
  for (let q = 0; q < 900 && th.length < 220; q++) { const xx = x0 + (r() - 0.5) * w, zz = z0 + (r() - 0.5) * d, k = cell(xx, zz); if (r() < F.weed[k] * 0.9 && !onTrack(xx, zz)) th.push({ x: xx, z: zz, s: 0.7 + r() * 0.7, rot: r() * 6.28 }); }
  if (th.length) { thistleGeo = thistleGeo || thistleGeometry(4); g.add(scatterInstanced(thistleGeo, leafMaterial({ gloss: 0.35 }), th)); }
  // standing water in waterlogged hollows
  if (F.wet[k0] > 0.55) {
    for (let q = 0; q < 5; q++) { const xx = x0 + (r() - 0.5) * w * 0.8, zz = z0 + (r() - 0.5) * d * 0.8, k = cell(xx, zz); if (F.wet[k] < 0.6) continue; const p = new THREE.Mesh(new THREE.CircleGeometry(0.6 + r() * 1.2, 24).rotateX(-Math.PI / 2), M.waterCheap(0x4d6b73, 0.8)); p.scale.set(1 + r(), 1, 0.6 + r() * 0.5); p.position.set(xx, 0.035, zz); g.add(p); }
  }
  g.userData.centre = [x0, z0];
  setHole(x0 - w / 2 + 0.05, z0 - d / 2 + 0.05, x0 + w / 2 - 0.05, z0 + d / 2 - 0.05);
  return g;
}
export { TEX_W, TEX_H };
