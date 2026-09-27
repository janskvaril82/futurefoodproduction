/* Plant and soil geometry for the weeding-robot field: sugar-beet and lettuce seedlings,
   four weed species (fat hen, chickweed, scentless mayweed, grass weeds) and a ridged, periodic soil strip.
   Geometries are built from leafGeometry() (lab3d.js) with few segments so that thousands can be instanced. */
import { THREE, leafGeometry, BufferGeometryUtils, rng, fbm2, surfaceTextures } from '/assets/js/lab3d.js';

const merge = geos => { const m = BufferGeometryUtils.mergeGeometries(geos); geos.forEach(g => g.dispose()); return m; };
const place = (g, { yaw = 0, y = 0, x = 0, z = 0, s = 1 } = {}) => { if (s !== 1) g.scale(s, s, s); g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw)); g.translate(x, y, z); return g; };
function stem(len, r0, r1, color, bend = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, len, 5, 1, true); g.translate(0, len / 2, 0);
  if (bend) g.applyMatrix4(new THREE.Matrix4().makeRotationZ(bend));
  const c = new THREE.Color(color); const col = []; for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 2).fill(0.5), 2));
  return g;
}

/** Sugar-beet seedling: two strap-shaped cotyledons and two to four glossy spoon-shaped true leaves on reddish petioles. */
export function beetGeometry(seed = 1, leaves = 4) {
  const r = rng(seed); const geos = [];
  [0, Math.PI].forEach((a, i) => geos.push(place(leafGeometry({ length: 0.03, width: 0.009, segU: 4, segV: 2, pitch: 1.25, curl: 0.25, cup: 0.15, shape: 'narrow', petiole: 0.12, seed: seed * 10 + i, colors: ['#b7c784', '#7f9f45', '#6d8f3a'] }), { yaw: a + (r() - 0.5) * 0.3 })));
  for (let k = 0; k < leaves; k++) {
    const len = (k < 2 ? 0.075 : 0.05) * (0.85 + r() * 0.3);
    const g = leafGeometry({ length: len, width: len * 0.62, segU: 5, segV: 2, pitch: 0.55 + r() * 0.3, curl: 0.45, cup: 0.35, ruffle: 0.002, shape: 'ovate', petiole: 0.42, seed: seed * 10 + 5 + k, colors: ['#c98a8a', '#4f8a2e', '#2f6b1f'] });
    geos.push(place(g, { yaw: Math.PI / 2 + k * Math.PI / 2 * (k < 2 ? 2 : 1) + (k >= 2 ? Math.PI / 4 : 0) + (r() - 0.5) * 0.4, y: 0.004 }));
  }
  geos.push(stem(0.012, 0.0022, 0.0018, '#b0605c'));
  return merge(geos);
}
/** Lettuce transplant (6–8 leaves). */
export function lettuceGeometry(seed = 2) {
  const r = rng(seed); const geos = []; const n = 7;
  for (let k = 0; k < n; k++) {
    const age = 1 - k / n; const len = 0.045 + 0.05 * age * (0.85 + r() * 0.3);
    geos.push(place(leafGeometry({ length: len, width: len * 0.85, segU: 5, segV: 3, pitch: 0.35 + 0.8 * age, curl: 0.35 + 0.35 * age, cup: 0.4, ruffle: 0.003, shape: 'round', seed: seed * 20 + k, colors: ['#e4efb2', '#9fcd55', '#68a334'] }), { yaw: k * 2.39996 + r() * 0.3 }));
  }
  return merge(geos);
}
/** Fat hen (Chenopodium album): grey-green, mealy, rhombic-ovate leaves in opposite pairs above two narrow cotyledons. */
export function fatHenGeometry(seed = 3) {
  const r = rng(seed); const geos = [];
  [0, Math.PI].forEach((a, i) => geos.push(place(leafGeometry({ length: 0.016, width: 0.005, segU: 3, segV: 1, pitch: 1.3, curl: 0.2, shape: 'narrow', seed: seed + i, colors: ['#b9c79a', '#8fa56e', '#7c9460'] }), { yaw: a })));
  for (let k = 0; k < 4; k++) {
    const len = (k < 2 ? 0.032 : 0.022) * (0.9 + r() * 0.25);
    geos.push(place(leafGeometry({ length: len, width: len * 0.8, segU: 4, segV: 2, pitch: 0.7 + r() * 0.3, curl: 0.3, cup: 0.25, ruffle: 0.0015, ruffleFreq: 7, shape: 'oak', petiole: 0.3, seed: seed * 7 + k, colors: ['#dfe6cf', '#9fb183', '#6f8a57'] }), { yaw: Math.PI / 2 + (k % 2) * Math.PI + (k >= 2 ? Math.PI / 2 : 0) + (r() - 0.5) * 0.3, y: k >= 2 ? 0.012 : 0.004 }));
  }
  geos.push(stem(0.016, 0.0016, 0.0012, '#9c7a78'));
  return merge(geos);
}
/** Common chickweed (Stellaria media): bright green small ovate leaves in pairs along low, spreading stems. */
export function chickweedGeometry(seed = 4) {
  const r = rng(seed); const geos = [];
  for (let s = 0; s < 4; s++) {
    const yaw = s * Math.PI / 2 + (r() - 0.5) * 0.6;
    for (let n = 0; n < 3; n++) {
      const d = 0.008 + n * 0.012; const len = 0.014 * (1 - n * 0.15);
      [-1, 1].forEach(side => geos.push(place(leafGeometry({ length: len, width: len * 0.65, segU: 3, segV: 1, pitch: 1.05, curl: 0.2, cup: 0.25, shape: 'ovate', petiole: 0.15, seed: seed * 30 + s * 6 + n * 2 + (side > 0 ? 1 : 0), colors: ['#d7ee9a', '#9ccd52', '#7fb43c'] }), { yaw: yaw + side * 1.2, x: Math.cos(-yaw) * d * 0, y: 0.003 + n * 0.002 })));
    }
  }
  // move each stem pair outward along its direction
  return merge(geos.map((g, i) => { const s = Math.floor(i / 6), n = Math.floor((i % 6) / 2); const yaw = s * Math.PI / 2; g.translate(Math.sin(yaw) * (0.006 + n * 0.012), 0, Math.cos(yaw) * (0.006 + n * 0.012)); return g; }));
}
/** Scentless mayweed (Tripleurospermum inodorum): rosette of finely divided, thread-like leaf segments. */
export function mayweedGeometry(seed = 5) {
  const r = rng(seed); const geos = [];
  for (let k = 0; k < 9; k++) {
    const len = 0.03 + r() * 0.018;
    geos.push(place(leafGeometry({ length: len, width: 0.0035, segU: 4, segV: 1, pitch: 0.55 + r() * 0.5, curl: 0.35, cup: 0, ruffle: 0.0012, ruffleFreq: 16, shape: 'narrow', seed: seed * 9 + k, colors: ['#9fbe6a', '#5f8d36', '#4e7b2c'] }), { yaw: k * 0.698 + r() * 0.3 }));
  }
  return merge(geos);
}
/** Grass weed seedling: a tuft of 4–6 narrow, upright, arching blades. */
export function grassWeedGeometry(seed = 6) {
  const r = rng(seed); const geos = [];
  for (let k = 0; k < 6; k++) {
    const len = 0.05 + r() * 0.04;
    geos.push(place(leafGeometry({ length: len, width: 0.0045, segU: 5, segV: 1, pitch: 0.12 + r() * 0.35, curl: 0.9 + r() * 0.5, cup: 0.3, shape: 'narrow', seed: seed * 11 + k, colors: ['#b8d47e', '#78a844', '#5d8f33'] }), { yaw: k * 1.05 + r() * 0.5 }));
  }
  return merge(geos);
}
export const WEED_GEOMETRY = { fathen: fatHenGeometry, chickweed: chickweedGeometry, mayweed: mayweedGeometry, grass: grassWeedGeometry };

/* ------------------------------------------------------------------ ridged soil strip (periodic along x) */
/**
 * Soil strip along x (length L, periodic with period P so that it can be moved in steps of P),
 * across z from −halfW to +halfW, ridges on the crop rows and compacted wheel tracks.
 */
export function soilStrip({ L = 48, P = 12, halfW = 4, rowSp = 0.5, rows0 = 0.25, tracks = [-1.5, 1.5], segPerRow = 10, segX = 4 } = {}) {
  const nx = Math.round(L * segX), nz = Math.round(2 * halfW / rowSp * segPerRow);
  const geo = new THREE.PlaneGeometry(L, 2 * halfW, nx, nz); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position; const col = []; const c = new THREE.Color();
  const per = (x, z, f) => { const a = 2 * Math.PI * x / P; return fbm2(Math.cos(a) * P * f / 6.283 + 31, z * f + Math.sin(a) * P * f / 6.283, 3); };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const ph = (z - rows0) / rowSp; const d = ph - Math.round(ph);            // distance to the nearest row, in row spacings
    let y = 0.028 * Math.cos(Math.PI * d) ** 2;                            // ridge crest on the row
    let dark = 0, wet = 0;
    tracks.forEach(t => { const u = Math.abs(z - t); if (u < 0.2) { y -= 0.03 * (1 - (u / 0.2) ** 2); dark += 0.35 * (1 - u / 0.2); } });
    y += 0.008 * per(x, z, 2.2) + 0.004 * per(x, z, 9);
    pos.setY(i, y);
    const n = per(x, z, 1.1);
    c.setRGB(1.0 + 0.14 * n - dark * 0.35, 0.94 + 0.12 * n - dark * 0.33, 0.86 + 0.1 * n - dark * 0.3);
    c.multiplyScalar(0.9 + 0.2 * Math.cos(Math.PI * d) ** 2 - wet);            // dry, lighter ridge tops
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const set = surfaceTextures({ key: 'fr-soil', size: 256, scale: 14, octaves: 5, palette: ['#4a3727', '#5e4733', '#72583f', '#86694e', '#9a7e62'], normalStrength: 3.6, speckle: 0.08, roughBase: 0.96 });
  const mk = t => { const u = t.clone(); u.repeat.set(L / 1.6, 2 * halfW / 1.6); u.needsUpdate = true; return u; };
  const mat = new THREE.MeshStandardMaterial({ map: mk(set.color), normalMap: mk(set.normal), roughnessMap: mk(set.rough), roughness: 1, metalness: 0, vertexColors: true, normalScale: new THREE.Vector2(1.2, 1.2) });
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; mesh.name = 'soil';
  /** Height of the soil surface at (x, z) — used to seat plants on the ridges. */
  mesh.heightAt = (x, z) => { const ph = (z - rows0) / rowSp; const d = ph - Math.round(ph); let y = 0.028 * Math.cos(Math.PI * d) ** 2; tracks.forEach(t => { const u = Math.abs(z - t); if (u < 0.2) y -= 0.03 * (1 - (u / 0.2) ** 2); }); return y + 0.008 * per(x, z, 2.2) + 0.004 * per(x, z, 9); };
  return mesh;
}
/** Small soil clods and stones (instanced), scattered on the strip. */
export function clods({ L = 48, halfW = 4, n = 900, seed = 8 } = {}) {
  const r = rng(seed);
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x5a4331, roughness: 1, flatShading: true });
  const im = new THREE.InstancedMesh(geo, mat, n); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const sz = 0.006 + Math.pow(r(), 3) * 0.03; q.setFromEuler(new THREE.Euler(r() * 6, r() * 6, r() * 6)); s.set(sz, sz * (0.5 + r() * 0.4), sz * (0.7 + r() * 0.5));
    m4.compose(new THREE.Vector3((r() - 0.5) * L, 0.005, (r() - 0.5) * 2 * halfW), q, s); im.setMatrixAt(i, m4);
    const stone = r() < 0.18; c.setRGB(stone ? 0.55 + r() * 0.2 : 0.3 + r() * 0.12, stone ? 0.52 + r() * 0.2 : 0.22 + r() * 0.08, stone ? 0.48 + r() * 0.2 : 0.16 + r() * 0.06); im.setColorAt(i, c);
  }
  im.receiveShadow = true; im.castShadow = true;
  return im;
}
