/* ==========================================================================
   anatomy.js — 3D helpers for microscopic plant anatomy (ES module)
   Shared by /laboratories/leaf-photosynthesis/ and /laboratories/stomata-transpiration/.
   - fresnelMaterial(): translucent cell walls that thicken optically at grazing angles
   - guardPairGeometry(): kidney-shaped guard-cell pair with an "open" morph target
   - SpriteCloud: GPU point sprites with per-point colour, alpha and size (world units)
   - glyphTexture(): canvas-drawn CO₂ / O₂ / H₂O / sugar / soft-dot sprites
   ========================================================================== */
import { THREE, BufferGeometryUtils } from '/assets/js/lab3d.js';

/** Translucent PBR material whose opacity rises towards silhouettes (cell walls seen edge-on). */
export function fresnelMaterial({ color = 0xd6f0c8, opacity = 0.16, rim = 0.6, rimPow = 2.2, clip = null, sheen = 0.6, clearcoat = 0.6, roughness = 0.35, side = THREE.DoubleSide, maxAlpha = 0.92, emissive = 0x000000 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, transparent: true, opacity, depthWrite: false, side, clearcoat, clearcoatRoughness: 0.3, sheen, sheenColor: new THREE.Color(0xf0ffe0), sheenRoughness: 0.5, emissive });
  if (clip) m.clippingPlanes = clip;
  m.userData.rim = { value: rim };
  m.onBeforeCompile = sh => {
    sh.uniforms.uRim = m.userData.rim;
    sh.fragmentShader = 'uniform float uRim;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
      `#include <opaque_fragment>
      float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), ${rimPow.toFixed(2)});
      gl_FragColor.a = clamp(gl_FragColor.a + fres * uRim, 0.0, ${maxAlpha.toFixed(2)});`);
  };
  m.customProgramCacheKey = () => 'fresnel' + rimPow + maxAlpha;
  return m;
}

/**
 * Guard-cell pair (long axis along z, pore centred at the origin, y up).
 * Two tapered tubes bowing apart; morph target 0 opens the pore to wMax at its middle.
 * Returns BufferGeometry with morphAttributes.position[0] and a helper centre(s, t, k) for placing chloroplasts.
 */
export function guardPairGeometry({ L = 3, rMid = 0.6, rPole = 0.3, wMax = 1, segT = 40, segR = 18, flatten = 0.82 } = {}) {
  const b0 = rMid - rPole;
  const geos = [];
  const radius = t => rPole + (rMid - rPole) * Math.pow(Math.sin(Math.PI * t), 0.55);
  for (const s of [-1, 1]) {
    const pos = [], open = [], idx = [], uv = [];
    for (let i = 0; i <= segT; i++) {
      const t = i / segT, sn = Math.sin(Math.PI * t);
      const cx = s * (rPole + b0 * sn), cz = -L / 2 + L * t;
      const tx = s * b0 * Math.PI * Math.cos(Math.PI * t), tz = L; const tl = Math.hypot(tx, tz);
      const nx = tz / tl, nz = -tx / tl;               // horizontal normal to the centreline
      const r = radius(t);
      for (let j = 0; j <= segR; j++) {
        const ph = j / segR * Math.PI * 2;
        const hx = Math.cos(ph) * r, hy = Math.sin(ph) * r * flatten;
        const x = cx + nx * hx, y = hy, z = cz + nz * hx;
        pos.push(x, y, z);
        open.push(s * (wMax / 2) * sn, 0, 0);          // displacement only (relative morph)
        uv.push(t, j / segR);
      }
    }
    const row = segR + 1;
    for (let i = 0; i < segT; i++) for (let j = 0; j < segR; j++) { const a = i * row + j, c = a + row; if (s > 0) idx.push(a, c, a + 1, a + 1, c, c + 1); else idx.push(a, a + 1, c, a + 1, c + 1, c); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    g.morphAttributes.position = [new THREE.Float32BufferAttribute(open, 3)];
    geos.push(g);
    // pole caps (static)
    [0, 1].forEach(e => {
      const cap = new THREE.SphereGeometry(rPole, 14, 10); cap.scale(1, flatten, 1);
      cap.translate(s * rPole, 0, -L / 2 + L * e);
      cap.deleteAttribute('uv'); cap.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(cap.attributes.position.count * 2), 2));
      cap.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(cap.attributes.position.count * 3), 3)];
      geos.push(cap.toNonIndexed ? cap : cap);
    });
  }
  const merged = BufferGeometryUtils.mergeGeometries(geos.map(g => g.index ? g : g), false);
  merged.morphTargetsRelative = true;
  merged.computeVertexNormals();
  merged.userData = { L, rMid, rPole, wMax, b0 };
  return merged;
}
/** Centreline point of guard cell s (±1) at t∈[0,1] for opening fraction k∈[0,1] (matches guardPairGeometry). */
export function guardCentre(gd, s, t, k, out = new THREE.Vector3()) {
  const sn = Math.sin(Math.PI * t);
  return out.set(s * (gd.rPole + gd.b0 * sn + k * gd.wMax / 2 * sn), 0, -gd.L / 2 + gd.L * t);
}

/* ------------------------------------------------------------ sprite clouds */
const VS = `
attribute vec3 pcol; attribute float palpha; attribute float psize;
varying vec3 vC; varying float vA;
uniform float uScale;
void main() {
  vC = pcol; vA = palpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, psize * uScale / max(0.001, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const FS = `
uniform sampler2D map; varying vec3 vC; varying float vA;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  float a = t.a * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vC * t.rgb, a);
}`;
export class SpriteCloud {
  constructor(max, { map, blending = THREE.NormalBlending, depthTest = true } = {}) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3).fill(1); this.alpha = new Float32Array(max); this.size = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('palpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.uScale = { value: 400 };
    this.mat = new THREE.ShaderMaterial({ uniforms: { map: { value: map }, uScale: this.uScale }, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest, blending });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false;
  }
  /** Call once per frame with the camera and canvas height (CSS px × pixel ratio). */
  setViewport(camera, heightPx) { this.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)); }
  set(i, x, y, z, size, alpha, r = 1, g = 1, b = 1) {
    const k = i * 3; this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.col[k] = r; this.col[k + 1] = g; this.col[k + 2] = b; this.alpha[i] = alpha; this.size[i] = size;
  }
  commit(n) {
    this.n = n; const g = this.points.geometry; g.setDrawRange(0, n);
    ['position', 'pcol', 'palpha', 'psize'].forEach(a => { g.attributes[a].needsUpdate = true; });
  }
}

/* ------------------------------------------------------------ glyph textures */
const glyphCache = {};
function ball(ctx, x, y, r, c0, c1) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, c0); g.addColorStop(0.7, c1); g.addColorStop(1, 'rgba(0,0,0,0.0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
/** 'co2' | 'o2' | 'h2o' | 'sugar' | 'dot' | 'ring' */
export function glyphTexture(type) {
  if (glyphCache[type]) return glyphCache[type];
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S; const ctx = cv.getContext('2d');
  const O = ['#ffd2cc', '#e0302a'], C = ['#9aa3ad', '#2b3036'], H = ['#ffffff', '#c9d3dc'];
  if (type === 'co2') { ball(ctx, 30, 64, 24, ...O); ball(ctx, 98, 64, 24, ...O); ball(ctx, 64, 64, 26, ...C); }
  else if (type === 'o2') { ball(ctx, 44, 64, 28, ...O); ball(ctx, 84, 64, 28, ...O); }
  else if (type === 'h2o') { ball(ctx, 34, 44, 18, ...H); ball(ctx, 94, 44, 18, ...H); ball(ctx, 64, 72, 32, '#bfe9ff', '#1d8fe0'); }
  else if (type === 'sugar') { ctx.strokeStyle = '#ffe7a0'; ctx.lineWidth = 9; ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k + Math.PI / 6; const x = 64 + 36 * Math.cos(a), y = 64 + 36 * Math.sin(a); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.stroke(); ctx.fillStyle = 'rgba(255,215,110,0.55)'; ctx.fill(); }
  else if (type === 'ring') { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(64, 64, 44, 0, Math.PI * 2); ctx.stroke(); }
  else { const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, S, S); }
  // no mipmaps: the glyphs sit on transparent-black backgrounds, so low mip levels of small, distant
  // sprites average to dark squares; plain linear filtering keeps them clean
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
  glyphCache[type] = t; return t;
}
/** Vertical alpha gradient for photon streaks (bright head at v = 0). */
export function streakTexture() {
  if (glyphCache.streak) return glyphCache.streak;
  const cv = document.createElement('canvas'); cv.width = 4; cv.height = 128; const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 128, 0, 0); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.12, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(cv); glyphCache.streak = t; return t;
}
/** Screen-space radial gradient background. */
export function gradientBackground(inner = '#12301f', outer = '#030806') {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512; const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(256, 200, 20, 256, 256, 420); g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** Visible-light colour (linear RGB 0–1) for a wavelength in nm, for photon streaks. */
export function photonColour(nm) {
  let r = 0, g = 0, b = 0;
  if (nm < 440) { r = (440 - nm) / 60; b = 1; } else if (nm < 490) { g = (nm - 440) / 50; b = 1; } else if (nm < 510) { g = 1; b = (510 - nm) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; } else if (nm < 645) { r = 1; g = (645 - nm) / 65; } else r = 1;
  return [r * r, g * g, b * b].map(v => v * 0.9 + 0.02);
}
