/* ==========================================================================
   lab3d.js — 3D laboratory kit for Future Food Production (three.js r170)
   ES module. Pages must declare the import map:
   <script type="importmap">{"imports":{
     "three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
     "three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script>

   import { createStage, THREE, M, makeLettuce, … } from '/assets/js/lab3d.js';
   const stage = createStage(document.getElementById('stage'), { camera:{ pos:[2,1.6,2.4], target:[0,0.6,0] } });
   stage.scene.add(makeLettuce({ radius: 0.13 }));
   stage.onFrame((dt, t) => { … });

   See /docs/AUTHORING.md for the full catalogue.
   ========================================================================== */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { stageToolbar } from './ui.js';
import { colormap } from './colors.js';

export { THREE, OrbitControls, CSS2DObject, BufferGeometryUtils, RoundedBoxGeometry };

/* ======================================================================
   Seeded noise
   ====================================================================== */
export function rng(seed = 1) { let a = seed >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const PERM = new Uint8Array(512);
(function () { const r = rng(1337); const p = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; })();
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
function grad2(h, x, y) { switch (h & 7) { case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y; case 4: return x; case 5: return -x; case 6: return y; default: return -y; } }
/** 2-D Perlin noise in ≈[−1, 1]. */
export function noise2(x, y) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y);
  const u = fade(x), v = fade(y);
  const a = PERM[X] + Y, b = PERM[X + 1] + Y;
  const l1 = grad2(PERM[a], x, y) + u * (grad2(PERM[b], x - 1, y) - grad2(PERM[a], x, y));
  const l2 = grad2(PERM[a + 1], x, y - 1) + u * (grad2(PERM[b + 1], x - 1, y - 1) - grad2(PERM[a + 1], x, y - 1));
  return (l1 + v * (l2 - l1)) * 0.9;
}
/** Fractal Brownian motion of 2-D Perlin noise, ≈[−1, 1]. */
export function fbm2(x, y, oct = 5, lac = 2, gain = 0.5) { let s = 0, a = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { s += a * noise2(x * f + o * 17.3, y * f - o * 9.1); n += a; a *= gain; f *= lac; } return s / n; }

/* ======================================================================
   Procedural textures
   ====================================================================== */
const texCache = new Map();
/** Build a CanvasTexture by painting on a 2-D canvas. */
export function canvasTexture(w, h, paint, { repeat = [1, 1], srgb = true, key, anisotropy = 8 } = {}) {
  if (key && texCache.has(key)) { const t = texCache.get(key).clone(); t.repeat.set(...repeat); t.needsUpdate = true; return t; }
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); paint(ctx, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = anisotropy;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (key) texCache.set(key, t);
  return t;
}
/** Tileable height field → { color, normal, rough } textures. palette: array of hex colours sampled by height. */
export function surfaceTextures({ size = 256, scale = 6, octaves = 5, palette = ['#555', '#999'], normalStrength = 2, roughBase = 0.85, roughVar = 0.1, speckle = 0, stripes = 0, stripeDepth = 0.4, key } = {}) {
  if (key && texCache.has(key + ':set')) return texCache.get(key + ':set');
  const H = new Float32Array(size * size);
  const tile = (x, y) => { // tileable via 4-corner blend
    const u = x / size, v = y / size;
    const n = (a, b) => fbm2(a * scale / size, b * scale / size, octaves);
    return (n(x, y) * (1 - u) * (1 - v) + n(x - size, y) * u * (1 - v) + n(x, y - size) * (1 - u) * v + n(x - size, y - size) * u * v);
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = tile(x, y) * 0.5 + 0.5;
    if (stripes) v = v * (1 - stripeDepth) + stripeDepth * (0.5 + 0.5 * Math.cos(2 * Math.PI * stripes * y / size));
    H[y * size + x] = v;
  }
  const r = rng(7);
  const pal = palette.map(c => new THREE.Color(c));
  const col = new THREE.Color();
  const cCanvas = document.createElement('canvas'); cCanvas.width = cCanvas.height = size;
  const nCanvas = document.createElement('canvas'); nCanvas.width = nCanvas.height = size;
  const rCanvas = document.createElement('canvas'); rCanvas.width = rCanvas.height = size;
  const ci = cCanvas.getContext('2d').createImageData(size, size), ni = nCanvas.getContext('2d').createImageData(size, size), ri = rCanvas.getContext('2d').createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, k = i * 4, hv = H[i];
    const t = Math.min(0.999, Math.max(0, hv)) * (pal.length - 1); const a = Math.floor(t), f = t - a;
    col.copy(pal[a]).lerp(pal[Math.min(pal.length - 1, a + 1)], f);
    let s = 1; if (speckle && r() < speckle) s = 0.6 + r() * 0.7;
    ci.data[k] = Math.min(255, col.r * 255 * s); ci.data[k + 1] = Math.min(255, col.g * 255 * s); ci.data[k + 2] = Math.min(255, col.b * 255 * s); ci.data[k + 3] = 255;
    const hx = H[y * size + ((x + 1) % size)] - H[y * size + ((x - 1 + size) % size)];
    const hy = H[((y + 1) % size) * size + x] - H[((y - 1 + size) % size) * size + x];
    const nx = -hx * normalStrength * 8, ny = -hy * normalStrength * 8, nz = 1, L = Math.hypot(nx, ny, nz);
    ni.data[k] = (nx / L * 0.5 + 0.5) * 255; ni.data[k + 1] = (ny / L * 0.5 + 0.5) * 255; ni.data[k + 2] = (nz / L * 0.5 + 0.5) * 255; ni.data[k + 3] = 255;
    const rv = Math.min(1, Math.max(0, roughBase + (hv - 0.5) * roughVar * 2)) * 255;
    ri.data[k] = ri.data[k + 1] = ri.data[k + 2] = rv; ri.data[k + 3] = 255;
  }
  cCanvas.getContext('2d').putImageData(ci, 0, 0); nCanvas.getContext('2d').putImageData(ni, 0, 0); rCanvas.getContext('2d').putImageData(ri, 0, 0);
  const mk = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const set = { color: mk(cCanvas, true), normal: mk(nCanvas, false), rough: mk(rCanvas, false) };
  if (key) texCache.set(key + ':set', set);
  return set;
}
function texSetMaterial(set, repeat, extra = {}) {
  const s = { color: set.color.clone(), normal: set.normal.clone(), rough: set.rough.clone() };
  Object.values(s).forEach(t => { t.repeat.set(repeat[0], repeat[1]); t.needsUpdate = true; });
  return new THREE.MeshStandardMaterial(Object.assign({ map: s.color, normalMap: s.normal, roughnessMap: s.rough, roughness: 1, metalness: 0 }, extra));
}
const SURFACES = {
  soil: { palette: ['#2b1d14', '#3d2a1c', '#4f3825', '#5e4530', '#6f553c'], scale: 10, normalStrength: 3.5, speckle: 0.05, roughBase: 0.95 },
  tilled: { palette: ['#3b2a1d', '#553d29', '#6b4f36', '#806245'], scale: 12, normalStrength: 4, stripes: 24, stripeDepth: 0.35, roughBase: 0.97 },
  grass: { palette: ['#3d5a22', '#4d7229', '#5e8a32', '#709c3c', '#86ab4c'], scale: 18, normalStrength: 2.5, speckle: 0.08, roughBase: 0.92 },
  concrete: { palette: ['#8c8c88', '#9b9b96', '#a7a6a0', '#b3b2ab'], scale: 8, normalStrength: 0.8, speckle: 0.03, roughBase: 0.85 },
  epoxy: { palette: ['#b9bdbd', '#c3c6c5', '#cdd0ce'], scale: 4, normalStrength: 0.15, roughBase: 0.28, roughVar: 0.06 },
  gravel: { palette: ['#6d6a63', '#8a867d', '#a29d92', '#bdb8ac'], scale: 40, normalStrength: 5, speckle: 0.2, roughBase: 0.95 },
  rockwool: { palette: ['#9f8f5f', '#b3a16c', '#c5b47d', '#d4c58f'], scale: 30, normalStrength: 3, roughBase: 1 },
  coir: { palette: ['#3e2616', '#58371f', '#6e4628', '#855733'], scale: 36, normalStrength: 4, speckle: 0.1, roughBase: 1 },
  foam: { palette: ['#e9ebe6', '#f1f2ee', '#f7f8f5'], scale: 60, normalStrength: 1.2, roughBase: 0.9 },
  sand: { palette: ['#b59b6f', '#c8ae80', '#d8c193', '#e3cfa6'], scale: 24, normalStrength: 1.6, speckle: 0.1, roughBase: 0.95 },
  water: { palette: ['#808080', '#8a8a8a'], scale: 5, normalStrength: 1.2, roughBase: 0.05 }
};
/** A tiling PBR material for common surfaces: 'soil' | 'tilled' | 'grass' | 'concrete' | 'epoxy' | 'gravel' | 'rockwool' | 'coir' | 'foam' | 'sand'. */
export function surfaceMaterial(type = 'concrete', repeat = [4, 4], extra = {}) {
  const def = SURFACES[type] || SURFACES.concrete;
  return texSetMaterial(surfaceTextures(Object.assign({ key: 'surf-' + type }, def)), repeat, extra);
}

/* ======================================================================
   Material library
   ====================================================================== */
const brushed = () => surfaceTextures({ key: 'brushed', size: 256, scale: 2, octaves: 3, palette: ['#cfd2d6', '#dadde1'], normalStrength: 0.2, roughBase: 0.35, roughVar: 0.15 });
export const M = {
  aluminium: () => new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.32, roughnessMap: brushed().rough }),
  anodised: () => new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.7, roughness: 0.38 }),
  steel: () => new THREE.MeshStandardMaterial({ color: 0xa3a8ad, metalness: 0.9, roughness: 0.42, roughnessMap: brushed().rough }),
  galvanised: () => new THREE.MeshStandardMaterial({ color: 0xb4b9bd, metalness: 0.85, roughness: 0.5, roughnessMap: surfaceTextures({ key: 'galv', size: 256, scale: 20, palette: ['#999', '#bbb'], roughBase: 0.5, roughVar: 0.3 }).rough }),
  paintedSteel: (color = 0xe8e8e4) => new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.45 }),
  plasticWhite: () => new THREE.MeshPhysicalMaterial({ color: 0xf1f1ec, roughness: 0.42, clearcoat: 0.25, clearcoatRoughness: 0.4 }),
  plasticBlack: () => new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.55 }),
  plasticGrey: () => new THREE.MeshStandardMaterial({ color: 0x5b6066, roughness: 0.5 }),
  plastic: (color, rough = 0.45) => new THREE.MeshPhysicalMaterial({ color, roughness: rough, clearcoat: 0.2, clearcoatRoughness: 0.5 }),
  pvc: () => new THREE.MeshPhysicalMaterial({ color: 0xf4f4f0, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 }),
  copper: () => new THREE.MeshStandardMaterial({ color: 0xc27a4a, metalness: 1, roughness: 0.3 }),
  brass: () => new THREE.MeshStandardMaterial({ color: 0xc8a25a, metalness: 1, roughness: 0.28 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.04, transmission: 1, thickness: 0.004, ior: 1.52, transparent: true, specularIntensity: 1, envMapIntensity: 1 }),
  /** Cheap glass for many panes (greenhouses): alpha blended with environment reflections. */
  glassCheap: (opacity = 0.14) => new THREE.MeshPhysicalMaterial({ color: 0xe9f3f5, roughness: 0.05, metalness: 0, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.0, clearcoat: 0.6, clearcoatRoughness: 0.08 }),
  acrylic: (tint = 0xffffff) => new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.02, transmission: 0.95, thickness: 0.006, ior: 1.49, transparent: true }),
  water: (tint = 0x7fb6c8) => new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.04, metalness: 0, transmission: 0.92, thickness: 0.4, ior: 1.333, attenuationColor: new THREE.Color(tint), attenuationDistance: 0.6, transparent: true, side: THREE.DoubleSide }),
  waterCheap: (tint = 0x3f8fa6, opacity = 0.55) => new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.06, transparent: true, opacity, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide }),
  foam: () => surfaceMaterial('foam', [2, 2], { color: 0xffffff }),
  rockwool: () => surfaceMaterial('rockwool', [1, 1]),
  coir: () => surfaceMaterial('coir', [1, 1]),
  soil: (rep = [3, 3]) => surfaceMaterial('soil', rep),
  concrete: (rep = [4, 4]) => surfaceMaterial('concrete', rep),
  epoxy: (rep = [4, 4]) => surfaceMaterial('epoxy', rep),
  root: () => new THREE.MeshPhysicalMaterial({ color: 0xefe6cd, roughness: 0.62, sheen: 0.4, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.6 }),
  emissive: (color = 0xff2a6d, intensity = 3) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.4 }),
  fabric: (color = 0xf2f2ee, opacity = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, transparent: opacity < 1, opacity, side: THREE.DoubleSide }),
  label: (color = 0xffffff) => new THREE.MeshBasicMaterial({ color })
};

/* ======================================================================
   Stage
   ====================================================================== */
/**
 * createStage(container, opts) → stage
 * opts: background ('#0d1512' | null), environment ('room' | 'none'), envIntensity, exposure,
 *       camera {pos,target,fov,near,far}, controls {minDistance,maxDistance,maxPolarAngle,autoRotate,enablePan},
 *       shadows (bool), bloom (false | {strength,radius,threshold}), ao (bool | {radius,intensity}),
 *       fog ({color, near, far} | {color, density}), toneMapping ('aces' | 'agx' | 'neutral'),
 *       hint (string), toolbar (bool), labels (bool), quality ('auto' | 'high' | 'medium' | 'low')
 */
export function createStage(container, opts = {}) {
  const o = Object.assign({
    background: '#0d1512', environment: 'room', envIntensity: 0.6, exposure: 1.0,
    camera: {}, controls: {}, shadows: true, bloom: false, ao: true, fog: null, toneMapping: 'aces',
    hint: 'Drag to orbit · right-drag to pan · scroll to zoom', toolbar: true, labels: true, quality: 'auto'
  }, opts);
  const el = typeof container === 'string' ? document.querySelector(container) : container;
  el.classList.add('stage');
  if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
  const loading = document.createElement('div'); loading.className = 'stage-loading'; loading.textContent = 'Preparing 3D scene…'; el.appendChild(loading);

  // WebGL availability
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  } catch (e) {
    loading.innerHTML = 'This laboratory needs WebGL, which is unavailable in this browser.<br>Try a recent Chrome, Edge, Firefox or Safari with hardware acceleration enabled.';
    throw e;
  }
  const maxPR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(maxPR);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = o.toneMapping === 'agx' ? THREE.AgXToneMapping : o.toneMapping === 'neutral' ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = o.exposure;
  renderer.shadowMap.enabled = !!o.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.insertBefore(renderer.domElement, el.firstChild);

  const scene = new THREE.Scene();
  if (o.background) scene.background = new THREE.Color(o.background);
  if (o.fog) scene.fog = o.fog.density ? new THREE.FogExp2(o.fog.color, o.fog.density) : new THREE.Fog(o.fog.color, o.fog.near, o.fog.far);

  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  if (o.environment === 'room') {
    envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = o.envIntensity;
  }

  const cam = Object.assign({ pos: [3, 2, 3], target: [0, 0.5, 0], fov: 42, near: 0.02, far: 400 }, o.camera);
  const camera = new THREE.PerspectiveCamera(cam.fov, 1, cam.near, cam.far);
  camera.position.set(...cam.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...cam.target);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  Object.assign(controls, Object.assign({ minDistance: 0.2, maxDistance: 60, maxPolarAngle: Math.PI * 0.495 }, o.controls));
  // respect "reduce motion": no automatic camera rotation (simulations themselves stay user-controlled)
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) controls.autoRotate = false;
  controls.update();
  const home = { pos: camera.position.clone(), target: controls.target.clone() };

  // label renderer
  let labelRenderer = null;
  if (o.labels) {
    labelRenderer = new CSS2DRenderer();
    Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: 2 });
    el.appendChild(labelRenderer.domElement);
  }

  // post-processing
  const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  let aoPass = null, bloomPass = null;
  if (o.ao) {
    aoPass = new GTAOPass(scene, camera, 2, 2);
    aoPass.output = GTAOPass.OUTPUT.Default;
    const aoo = typeof o.ao === 'object' ? o.ao : {};
    aoPass.blendIntensity = aoo.intensity ?? 0.9;
    aoPass.updateGtaoMaterial({ radius: aoo.radius ?? 0.25, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 12 });
    aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
    // exclude transparent meshes/sprites from the AO depth-normal pre-pass (otherwise translucent
    // overlays such as water, glass or heat-maps darken whatever lies beneath them)
    if (typeof aoPass.overrideVisibility === 'function') {
      const baseOverride = aoPass.overrideVisibility.bind(aoPass);
      aoPass.overrideVisibility = function () {
        baseOverride();
        this.scene.traverse(o => {
          if (!(o.isMesh || o.isSprite) || !o.visible) return;
          const m = o.material; const tr = Array.isArray(m) ? m.some(x => x && x.transparent) : !!(m && m.transparent);
          if (tr) o.visible = false;
        });
      };
    }
    composer.addPass(aoPass);
  }
  if (o.bloom) {
    const b = Object.assign({ strength: 0.55, radius: 0.5, threshold: 1.05 }, typeof o.bloom === 'object' ? o.bloom : {});
    bloomPass = new UnrealBloomPass(new THREE.Vector2(2, 2), b.strength, b.radius, b.threshold);
    composer.addPass(bloomPass);
  }
  composer.addPass(new OutputPass());

  const clock = new THREE.Clock();
  const frameCbs = new Set();
  let visible = true, paused = false, disposed = false, elapsed = 0;
  let quality = o.quality === 'auto' ? 'high' : o.quality;
  const perf = { n: 0, acc: 0 };

  function resize() {
    const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
    composer.setSize(w, h); composer.setPixelRatio(renderer.getPixelRatio());
    if (labelRenderer) labelRenderer.setSize(w, h);
  }
  const ro = new ResizeObserver(resize); ro.observe(el);
  const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) clock.getDelta(); }, { threshold: 0.01 });
  io.observe(el);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) clock.getDelta(); });

  function setQuality(q) {
    quality = q;
    if (q === 'high') { renderer.setPixelRatio(maxPR); if (aoPass) aoPass.enabled = true; if (bloomPass) bloomPass.enabled = true; renderer.shadowMap.enabled = !!o.shadows; }
    if (q === 'medium') { renderer.setPixelRatio(Math.min(maxPR, 1.25)); if (aoPass) aoPass.enabled = false; if (bloomPass) bloomPass.enabled = true; }
    if (q === 'low') { renderer.setPixelRatio(1); if (aoPass) aoPass.enabled = false; if (bloomPass) bloomPass.enabled = false; }
    resize();
  }

  // camera tween
  let tween = null;
  function flyTo(pos, target, duration = 1.4) {
    tween = { t: 0, d: duration, p0: camera.position.clone(), p1: new THREE.Vector3(...(pos.isVector3 ? pos.toArray() : pos)), q0: controls.target.clone(), q1: new THREE.Vector3(...(target.isVector3 ? target.toArray() : target)) };
    return new Promise(res => { tween.done = res; });
  }
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  let first = true;
  function loop() {
    if (disposed) return;
    requestAnimationFrame(loop);
    if (!visible || paused || document.hidden) return;
    const dt = Math.min(0.1, clock.getDelta()); elapsed += dt;
    if (tween) { tween.t += dt; const k = ease(Math.min(1, tween.t / tween.d)); camera.position.lerpVectors(tween.p0, tween.p1, k); controls.target.lerpVectors(tween.q0, tween.q1, k); if (tween.t >= tween.d) { const d = tween.done; tween = null; d && d(); } }
    controls.update();
    frameCbs.forEach(cb => { try { cb(dt, elapsed); } catch (err) { console.error(err); } });
    composer.render(dt);
    if (labelRenderer) labelRenderer.render(scene, camera);
    if (first) { first = false; loading.remove(); }
    if (o.quality === 'auto' && elapsed > 1.5) {
      perf.n++; perf.acc += dt;
      if (perf.n >= 90) {
        const avg = perf.acc / perf.n; perf.n = 0; perf.acc = 0;
        if (avg > 1 / 26 && quality === 'high') setQuality('medium');
        else if (avg > 1 / 20 && quality === 'medium') setQuality('low');
      }
    }
  }

  // keyboard: arrows orbit, +/- zoom, space → onSpace
  const keyHandlers = {};
  el.addEventListener('keydown', e => {
    const off = camera.position.clone().sub(controls.target); const sph = new THREE.Spherical().setFromVector3(off);
    let used = true;
    if (e.key === 'ArrowLeft') sph.theta -= 0.08; else if (e.key === 'ArrowRight') sph.theta += 0.08;
    else if (e.key === 'ArrowUp') sph.phi = Math.max(0.05, sph.phi - 0.06); else if (e.key === 'ArrowDown') sph.phi = Math.min(controls.maxPolarAngle, sph.phi + 0.06);
    else if (e.key === '+' || e.key === '=') sph.radius = Math.max(controls.minDistance, sph.radius * 0.9);
    else if (e.key === '-' || e.key === '_') sph.radius = Math.min(controls.maxDistance, sph.radius * 1.1);
    else if (e.key === ' ' && keyHandlers.space) { keyHandlers.space(); }
    else used = false;
    if (used) { e.preventDefault(); if (e.key !== ' ') camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph)); }
  });

  // raycast picking
  const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  function pickAt(clientX, clientY, objects) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(objects, true)[0] || null;
  }

  const stage = {
    THREE, el, scene, camera, renderer, controls, composer, labelRenderer, pmrem, clock,
    get quality() { return quality; }, setQuality,
    get aoPass() { return aoPass; }, get bloomPass() { return bloomPass; },
    onFrame(cb) { frameCbs.add(cb); return () => frameCbs.delete(cb); },
    offFrame(cb) { frameCbs.delete(cb); },
    setPaused(p) { paused = p; if (!p) clock.getDelta(); },
    render() { composer.render(0); if (labelRenderer) labelRenderer.render(scene, camera); },
    resize, flyTo,
    resetView() { return flyTo(home.pos, home.target, 1); },
    setHome(pos, target) { home.pos.set(...pos); home.target.set(...target); },
    onKey(name, cb) { keyHandlers[name] = cb; },
    /** Attach an HTML label to an Object3D (or a Vector3/array position). Returns the CSS2DObject. */
    addLabel(target, html, { className = 'label3d', offset = [0, 0, 0] } = {}) {
      const div = document.createElement('div'); div.className = className; div.innerHTML = html;
      const lab = new CSS2DObject(div); lab.position.set(...offset);
      if (target && target.isObject3D) target.add(lab);
      else { lab.position.add(new THREE.Vector3(...(target.isVector3 ? target.toArray() : target))); scene.add(lab); }
      return lab;
    },
    /** Raycast on click / hover. onPick({ objects, onClick(hit, e), onHover(hit|null, e) }) */
    onPick({ objects, onClick, onHover }) {
      const cv = renderer.domElement; let down = null;
      cv.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
      cv.addEventListener('pointerup', e => { if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; const hit = pickAt(e.clientX, e.clientY, typeof objects === 'function' ? objects() : objects); onClick && onClick(hit, e); });
      if (onHover) cv.addEventListener('pointermove', e => { const hit = pickAt(e.clientX, e.clientY, typeof objects === 'function' ? objects() : objects); onHover(hit, e); cv.style.cursor = hit ? 'pointer' : ''; });
    },
    pickAt,
    /** Save a PNG screenshot. */
    screenshot(name = 'laboratory.png') {
      composer.render(0);
      const url = renderer.domElement.toDataURL('image/png');
      const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    },
    /** Replace the environment map by a PMREM of the current scene background (e.g., after changing Sky). */
    updateEnvironmentFrom(obj) {
      const tmp = new THREE.Scene(); tmp.add(obj.clone ? obj.clone() : obj);
      if (envRT) envRT.dispose(); envRT = pmrem.fromScene(tmp, 0); scene.environment = envRT.texture;
    },
    dispose() { disposed = true; ro.disconnect(); io.disconnect(); renderer.dispose(); composer.dispose && composer.dispose(); pmrem.dispose(); }
  };

  (window.__stages = window.__stages || []).push(stage);
  if (o.toolbar) stage.toolbar = stageToolbar(el, { onReset: () => stage.resetView(), onShot: () => stage.screenshot((document.body.dataset.slug || 'lab') + '.png'), extra: o.toolbarExtra || [] });
  /** Add a button to the stage toolbar: stage.addTool({ icon: '<svg…>' | 'text', title, onClick }). */
  stage.addTool = ({ icon, title, onClick }) => { if (!stage.toolbar) return null; const b = document.createElement('button'); b.type = 'button'; b.innerHTML = icon; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', onClick); stage.toolbar.insertBefore(b, stage.toolbar.firstChild); return b; };
  if (o.hint) { const h = document.createElement('div'); h.className = 'stage-hint'; h.textContent = o.hint; el.appendChild(h); }
  resize();
  requestAnimationFrame(loop);
  return stage;
}

/* ======================================================================
   Lighting rigs
   ====================================================================== */
/** Soft studio lighting: hemisphere + key directional light with shadows. Returns { hemi, key, fill }. */
export function studioLights(stage, { intensity = 1, shadowSize = 4, keyPos = [3, 6, 2], castShadow = true, hemiSky = 0xdfeeff, hemiGround = 0x2a2f2a } = {}) {
  const hemi = new THREE.HemisphereLight(hemiSky, hemiGround, 0.9 * intensity);
  const key = new THREE.DirectionalLight(0xfff4e5, 2.4 * intensity);
  key.position.set(...keyPos);
  key.castShadow = castShadow;
  key.shadow.mapSize.set(2048, 2048);
  const s = shadowSize; Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.1, far: 40 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
  const fill = new THREE.DirectionalLight(0xcfe3ff, 0.6 * intensity); fill.position.set(-4, 3, -3);
  stage.scene.add(hemi, key, key.target, fill);
  return { hemi, key, fill };
}
/**
 * Physical sky with sun. Returns { sky, sun, hemi, setSun(elevationDeg, azimuthDeg) }.
 * Azimuth: degrees clockwise from north (+Z is south in this convention: north = −Z).
 */
export function addSky(stage, { elevation = 35, azimuth = 180, turbidity = 3.5, rayleigh = 2.2, mieCoefficient = 0.004, mieDirectionalG = 0.8, sunIntensity = 3, shadowSize = 12, updateEnv = true } = {}) {
  const sky = new Sky(); sky.scale.setScalar(4500);
  const u = sky.material.uniforms;
  u.turbidity.value = turbidity; u.rayleigh.value = rayleigh; u.mieCoefficient.value = mieCoefficient; u.mieDirectionalG.value = mieDirectionalG;
  stage.scene.add(sky); stage.scene.background = null;
  // the HDR sky is far brighter than 1.0: keep bloom for emissive objects only
  if (stage.bloomPass) stage.bloomPass.threshold = Math.max(stage.bloomPass.threshold, 2.4);
  const sun = new THREE.DirectionalLight(0xfff1dc, sunIntensity);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -shadowSize, right: shadowSize, top: shadowSize, bottom: -shadowSize, near: 0.5, far: 120 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a3226, 0.7);
  stage.scene.add(sun, sun.target, hemi);
  const dir = new THREE.Vector3();
  let envTimer = null, lastEnv = 0;
  const refreshEnv = () => { envTimer = null; lastEnv = performance.now(); const s2 = new Sky(); s2.scale.setScalar(4500); Object.keys(u).forEach(k => { if (s2.material.uniforms[k]) s2.material.uniforms[k].value = u[k].value.clone ? u[k].value.clone() : u[k].value; }); stage.updateEnvironmentFrom(s2); };
  function setSun(el, az) {
    const phi = THREE.MathUtils.degToRad(90 - el), theta = THREE.MathUtils.degToRad(az);
    // north = −Z, east = +X
    dir.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), -Math.sin(phi) * Math.cos(theta));
    u.sunPosition.value.copy(dir);
    sun.position.copy(dir).multiplyScalar(40).add(sun.target.position);
    const day = THREE.MathUtils.smoothstep(el, -4, 12);
    sun.intensity = sunIntensity * THREE.MathUtils.smoothstep(el, -1, 20) * (0.35 + 0.65 * Math.sin(Math.max(0, THREE.MathUtils.degToRad(el))) ** 0.3);
    sun.color.setHSL(0.09, 0.8, 0.5 + 0.45 * THREE.MathUtils.smoothstep(el, 0, 30));
    hemi.intensity = 0.08 + 0.7 * day;
    stage.renderer.toneMappingExposure = 0.22 + 0.33 * day;
    // environment lighting follows the sky: throttled (≤ every 0.4 s while the sun is animated) plus a trailing update
    if (updateEnv) { clearTimeout(envTimer); if (performance.now() - lastEnv > 400) refreshEnv(); else envTimer = setTimeout(refreshEnv, 150); }
  }
  setSun(elevation, azimuth);
  return { sky, sun, hemi, setSun, direction: dir };
}
/** Fit a directional light's shadow camera to a square of half-size s centred on target. */
export function fitShadow(light, s, target = [0, 0, 0]) {
  Object.assign(light.shadow.camera, { left: -s, right: s, top: s, bottom: -s }); light.shadow.camera.updateProjectionMatrix();
  light.target.position.set(...target);
}

/* ======================================================================
   Ground, rooms, structures
   ====================================================================== */
/** Ground plane with PBR surface. type: 'grass' | 'soil' | 'tilled' | 'concrete' | 'epoxy' | 'gravel' | 'sand'. */
export function makeGround({ size = 20, type = 'concrete', repeat, receiveShadow = true, circle = false } = {}) {
  const rep = repeat || [size / 2, size / 2];
  const geo = circle ? new THREE.CircleGeometry(size / 2, 96) : new THREE.PlaneGeometry(size, size);
  const mesh = new THREE.Mesh(geo, surfaceMaterial(type, rep));
  mesh.rotation.x = -Math.PI / 2; mesh.receiveShadow = receiveShadow; mesh.name = 'ground';
  return mesh;
}
/** Interior room (inward-facing box) with floor material. Returns group with .floor, .walls. */
export function makeRoom({ w = 8, d = 6, h = 3, wallColor = 0xe9e9e4, floor = 'epoxy', ceiling = true } = {}) {
  const g = new THREE.Group();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.9, side: THREE.BackSide }));
  walls.position.y = h / 2; walls.receiveShadow = true;
  if (!ceiling) { walls.geometry.groups = walls.geometry.groups.filter((_, i) => i !== 2); }
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(w, d), surfaceMaterial(floor, [w / 2, d / 2]));
  fl.rotation.x = -Math.PI / 2; fl.position.y = 0.001; fl.receiveShadow = true;
  g.add(walls, fl); g.walls = walls; g.floor = fl;
  return g;
}
/** Steel box-section beam between two points. */
export function makeBeam(a, b, { size = 0.04, material } = {}) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b); const len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, len), material || M.galvanised());
  m.position.copy(A).add(B).multiplyScalar(0.5); m.lookAt(B); m.castShadow = true; m.receiveShadow = true;
  return m;
}
/** Tube (pipe) through points. */
export function makePipe(points, { radius = 0.02, material, segments, closed = false, tension = 0.1, radial = 16 } = {}) {
  const pts = points.map(p => p.isVector3 ? p : new THREE.Vector3(...p));
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', tension);
  const geo = new THREE.TubeGeometry(curve, segments || Math.max(24, pts.length * 16), radius, radial, closed);
  const m = new THREE.Mesh(geo, material || M.pvc()); m.castShadow = true; m.receiveShadow = true; m.curve = curve;
  return m;
}
/**
 * Venlo-type glass greenhouse. Returns group with API:
 *   .setVents(f 0..1), .setScreen(f 0..1), .vents[], .screen, .pipes, .bounds {w, l, h}
 */
export function makeGreenhouse({ spans = 3, spanWidth = 3.2, length = 10, gutterHeight = 3.2, roofAngle = 22, bays = 4, heatingPipes = true, glassOpacity = 0.12 } = {}) {
  const g = new THREE.Group();
  const W = spans * spanWidth, L = length, H = gutterHeight;
  const frame = M.aluminium(); const glass = M.glassCheap(glassOpacity);
  const ridgeH = Math.tan(THREE.MathUtils.degToRad(roofAngle)) * spanWidth / 2;
  const x0 = -W / 2, z0 = -L / 2;
  // posts & gutters
  for (let s = 0; s <= spans; s++) for (let b = 0; b <= bays; b++) {
    const x = x0 + s * spanWidth, z = z0 + b * L / bays;
    g.add(makeBeam([x, 0, z], [x, H, z], { size: 0.07, material: frame }));
  }
  for (let s = 0; s <= spans; s++) { const x = x0 + s * spanWidth; g.add(makeBeam([x, H, z0], [x, H, z0 + L], { size: 0.09, material: frame })); }
  for (let b = 0; b <= bays; b++) { const z = z0 + b * L / bays; g.add(makeBeam([x0, H, z], [x0 + W, H, z], { size: 0.06, material: frame })); }
  // roofs, ridges & vents
  const vents = [];
  for (let s = 0; s < spans; s++) {
    const xl = x0 + s * spanWidth, xm = xl + spanWidth / 2, xr = xl + spanWidth;
    g.add(makeBeam([xm, H + ridgeH, z0], [xm, H + ridgeH, z0 + L], { size: 0.05, material: frame }));
    for (let b = 0; b <= bays * 2; b++) { const z = z0 + b * L / (bays * 2); g.add(makeBeam([xl, H, z], [xm, H + ridgeH, z], { size: 0.03, material: frame })); g.add(makeBeam([xm, H + ridgeH, z], [xr, H, z], { size: 0.03, material: frame })); }
    const slopeLen = Math.hypot(spanWidth / 2, ridgeH);
    [-1, 1].forEach(side => {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(slopeLen, L), glass);
      pane.position.set(xm + side * spanWidth / 4, H + ridgeH / 2, 0);
      pane.rotation.set(-Math.PI / 2, 0, 0); pane.rotateY(side * THREE.MathUtils.degToRad(roofAngle));
      g.add(pane);
    });
    // roof vents: hinged at ridge, one per bay on the right slope
    for (let b = 0; b < bays; b++) {
      const hinge = new THREE.Group(); hinge.position.set(xm, H + ridgeH + 0.02, z0 + (b + 0.5) * L / bays);
      const vl = slopeLen * 0.45, vw = L / bays * 0.7;
      const pan = new THREE.Mesh(new THREE.BoxGeometry(vl, 0.015, vw), M.glassCheap(glassOpacity + 0.06));
      pan.position.x = vl / 2; hinge.add(pan);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(vl, 0.03, 0.03), frame); edge.position.set(vl / 2, 0, vw / 2); hinge.add(edge);
      const edge2 = edge.clone(); edge2.position.z = -vw / 2; hinge.add(edge2);
      hinge.rotation.z = -THREE.MathUtils.degToRad(roofAngle);
      hinge.userData.base = hinge.rotation.z;
      g.add(hinge); vents.push(hinge);
    }
  }
  // walls
  const wallMat = glass;
  const side1 = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat); side1.position.set(x0, H / 2, 0); side1.rotation.y = Math.PI / 2;
  const side2 = side1.clone(); side2.position.x = -x0;
  g.add(side1, side2);
  const gableShape = new THREE.Shape(); gableShape.moveTo(x0, 0);
  gableShape.lineTo(x0, H); for (let s = 0; s < spans; s++) { gableShape.lineTo(x0 + (s + 0.5) * spanWidth, H + ridgeH); gableShape.lineTo(x0 + (s + 1) * spanWidth, H); } gableShape.lineTo(-x0, 0); gableShape.lineTo(x0, 0);
  const gable = new THREE.Mesh(new THREE.ShapeGeometry(gableShape), wallMat); gable.position.z = z0;
  const gable2 = gable.clone(); gable2.position.z = -z0;
  g.add(gable, gable2);
  // energy screen (horizontal fabric at gutter height), deploys along x
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, L - 0.1), M.fabric(0xf1efe6, 0.78));
  screen.rotation.x = -Math.PI / 2; screen.position.y = H - 0.1; screen.scale.x = 0.001; screen.visible = false;
  g.add(screen);
  // heating pipes (pipe-rail pairs)
  let pipes = null;
  if (heatingPipes) {
    pipes = new THREE.Group();
    const pm = M.steel();
    for (let x = x0 + 0.6; x < -x0 - 0.3; x += 0.8) [-0.1, 0.1].forEach(dx => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, L - 0.6, 12), pm); p.rotation.x = Math.PI / 2; p.position.set(x + dx, 0.1, 0); p.castShadow = true; pipes.add(p); });
    g.add(pipes);
  }
  g.traverse(m => { if (m.isMesh && m.material !== glass && !m.material.transparent) { m.castShadow = true; m.receiveShadow = true; } });
  g.vents = vents; g.screen = screen; g.pipes = pipes; g.bounds = { w: W, l: L, h: H + ridgeH, gutter: H };
  g.setVents = f => vents.forEach(v => { v.rotation.z = v.userData.base + THREE.MathUtils.degToRad(35) * f; });
  g.setScreen = f => { screen.visible = f > 0.01; screen.scale.x = Math.max(0.001, f); screen.position.x = x0 + (W - 0.1) * f / 2 + 0.05; };
  return g;
}
/** Multi-level growing rack for vertical farms. Returns group with .shelves[{y, tray}], .lights[]. */
export function makeRack({ levels = 4, width = 2.4, depth = 0.9, levelHeight = 0.55, baseHeight = 0.25, lights = true, ledColor = 'full' } = {}) {
  const g = new THREE.Group(); const steel = M.paintedSteel(0xdedfdb);
  const posts = [[-width / 2, -depth / 2], [width / 2, -depth / 2], [-width / 2, depth / 2], [width / 2, depth / 2]];
  const top = baseHeight + levels * levelHeight + 0.1;
  posts.forEach(([x, z]) => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, top, 0.05), steel); p.position.set(x, top / 2, z); g.add(p); });
  const shelves = [], lightArr = [];
  for (let l = 0; l < levels; l++) {
    const y = baseHeight + l * levelHeight;
    const tray = new THREE.Mesh(new RoundedBoxGeometry(width, 0.07, depth, 2, 0.01), M.plasticWhite());
    tray.position.y = y; g.add(tray);
    [-depth / 2, depth / 2].forEach(z => { const b = new THREE.Mesh(new THREE.BoxGeometry(width + 0.06, 0.04, 0.04), steel); b.position.set(0, y - 0.05, z); g.add(b); });
    shelves.push({ y: y + 0.035, tray });
    if (lights) {
      const ly = y + levelHeight - 0.06;
      for (let k = 0; k < 3; k++) {
        const bar = makeLEDBar({ length: width - 0.1, color: ledColor, light: false });
        bar.position.set(0, ly, (k - 1) * depth / 3.2); g.add(bar); lightArr.push(bar);
      }
    }
  }
  g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  g.shelves = shelves; g.lights = lightArr; g.levelHeight = levelHeight;
  return g;
}

/* ======================================================================
   LED fixtures
   ====================================================================== */
const LED_COLORS = { red: 0xff2a3c, deepred: 0xff1030, blue: 0x3050ff, farred: 0x8a0018, white: 0xfff1e0, warmwhite: 0xffd9a8, green: 0x2cff6a, uv: 0x8a3cff };
/**
 * LED bar fixture. color: 'full' (white + red), 'redblue', 'white', 'magenta' or array of channel names.
 * light: false | 'rect' (RectAreaLight, realistic soft light, no shadows) | 'spot'.
 * Returns group with .setIntensity(0..1), .light (if any), .diodes (InstancedMesh).
 */
let rectInit = false;
/** Call once before creating THREE.RectAreaLight objects yourself (makeLEDBar({light:'rect'}) does it automatically). */
export function ensureRectAreaLights() { if (!rectInit) { RectAreaLightUniformsLib.init(); rectInit = true; } }
export function makeLEDBar({ length = 1.2, width = 0.07, color = 'full', light = false, lightIntensity = 6, rows = 2 } = {}) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(length, 0.028, width, 2, 0.006), M.aluminium());
  body.castShadow = true; g.add(body);
  const fins = new THREE.Mesh(new THREE.BoxGeometry(length * 0.98, 0.012, width * 0.7), M.anodised()); fins.position.y = 0.019; g.add(fins);
  const pattern = Array.isArray(color) ? color : color === 'redblue' ? ['red', 'red', 'red', 'blue'] : color === 'white' ? ['white'] : color === 'magenta' ? ['red', 'red', 'blue'] : ['white', 'white', 'deepred', 'white', 'white', 'farred'];
  const n = Math.floor(length / 0.018) * rows;
  const dgeo = new THREE.BoxGeometry(0.009, 0.003, 0.009);
  const dmat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 3.2, roughness: 0.3, toneMapped: true });
  const diodes = new THREE.InstancedMesh(dgeo, dmat, n);
  const mtx = new THREE.Matrix4(), col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const r = i % rows, k = Math.floor(i / rows);
    mtx.makeTranslation(-length / 2 + 0.012 + k * 0.018, -0.0155, (r - (rows - 1) / 2) * (width * 0.45));
    diodes.setMatrixAt(i, mtx);
    col.setHex(LED_COLORS[pattern[(k + r) % pattern.length]] || 0xffffff); diodes.setColorAt(i, col);
  }
  // emissive colour per instance requires emissive driven by instanceColor: use onBeforeCompile
  dmat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb;\n#endif'); };
  g.add(diodes);
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(length * 0.99, width * 0.9), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.2, depthWrite: false }));
  lens.rotation.x = Math.PI / 2; lens.position.y = -0.0175; g.add(lens);
  let L = null;
  const mix = pattern.map(p => new THREE.Color(LED_COLORS[p] || 0xffffff)).reduce((a, c) => a.add(c), new THREE.Color(0, 0, 0)).multiplyScalar(1 / pattern.length);
  if (light === 'rect') {
    if (!rectInit) { RectAreaLightUniformsLib.init(); rectInit = true; }
    L = new THREE.RectAreaLight(mix, lightIntensity, length, width); L.position.y = -0.02; L.rotation.x = -Math.PI / 2; g.add(L);
  } else if (light === 'spot') {
    L = new THREE.SpotLight(mix, lightIntensity * 3, 4, Math.PI / 2.6, 0.9, 2); L.position.y = -0.03; L.target.position.set(0, -1, 0); L.castShadow = true; L.shadow.mapSize.set(512, 512); g.add(L, L.target);
  }
  g.light = L; g.diodes = diodes; g.baseIntensity = lightIntensity;
  g.setIntensity = f => { dmat.emissiveIntensity = 0.05 + 3.2 * f; if (L) L.intensity = (light === 'spot' ? 3 : 1) * lightIntensity * f; };
  return g;
}

/* ======================================================================
   Plants — procedural and anatomically inspired
   ====================================================================== */
let leafDetailTex = null;
/** Vein/midrib detail texture (white base; veins lighter, fine mottling darker). Multiplies vertex colours. */
export function leafDetailTexture() {
  if (leafDetailTex) return leafDetailTex;
  leafDetailTex = canvasTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#e8ece4'; ctx.fillRect(0, 0, w, h);
    const r = rng(11);
    for (let i = 0; i < 1800; i++) { ctx.fillStyle = `rgba(${150 + r() * 60},${160 + r() * 60},${140 + r() * 50},${0.05 + r() * 0.08})`; const s = 2 + r() * 6; ctx.fillRect(r() * w, r() * h, s, s); }
    // lateral veins
    ctx.strokeStyle = 'rgba(255,255,248,0.75)'; ctx.lineCap = 'round';
    for (let k = 0; k < 11; k++) {
      const y0 = h * (0.08 + k * 0.085);
      [-1, 1].forEach(s => { ctx.lineWidth = 3.2 - k * 0.18; ctx.beginPath(); ctx.moveTo(w / 2, y0); ctx.bezierCurveTo(w / 2 + s * w * 0.18, y0 + h * 0.03, w / 2 + s * w * 0.34, y0 + h * 0.07, w / 2 + s * w * 0.49, y0 + h * 0.13); ctx.stroke(); });
    }
    // tertiary veins
    ctx.strokeStyle = 'rgba(255,255,248,0.28)'; ctx.lineWidth = 1;
    for (let i = 0; i < 140; i++) { const x = r() * w, y = r() * h; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30); ctx.stroke(); }
    // midrib
    const grd = ctx.createLinearGradient(w / 2 - 10, 0, w / 2 + 10, 0);
    grd.addColorStop(0, 'rgba(255,255,250,0)'); grd.addColorStop(0.5, 'rgba(255,255,250,0.95)'); grd.addColorStop(1, 'rgba(255,255,250,0)');
    ctx.fillStyle = grd; ctx.fillRect(w / 2 - 10, 0, 20, h);
  }, { srgb: true, key: 'leafDetail' });
  return leafDetailTex;
}
/**
 * Parametric leaf geometry with midrib bend, cupping and marginal ruffles.
 * u runs base→tip, v runs across the blade. Returns a BufferGeometry with colour attribute.
 */
export function leafGeometry({ length = 0.12, width = 0.09, segU = 18, segV = 12, pitch = 0.9, curl = 0.7, cup = 0.35, ruffle = 0.01, ruffleFreq = 10, petiole = 0.12, shape = 'round', seed = 1, colors = ['#e4efb0', '#9ccc55', '#5e9a2e'], edgeColor = null, edgeWidth = 0.25 } = {}) {
  const r = rng(seed);
  const ph = r() * 10;
  const C = []; let py = 0, pz = 0;
  for (let i = 0; i <= segU; i++) {
    const u = i / segU; const phi = pitch + curl * Math.pow(u, 1.6);
    C.push({ y: py, z: pz, phi });
    const ds = length / segU; py += Math.cos(phi) * ds; pz += Math.sin(phi) * ds;
  }
  const halfW = u => {
    let w;
    if (shape === 'narrow') w = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.9)), 0.9) * 0.55;
    else if (shape === 'oak') w = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.7) * (0.8 + 0.2 * Math.cos(u * 18));
    else if (shape === 'ovate') w = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.85);
    else w = Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.pow(u, 0.65)))) * 1.02; // round (butterhead)
    const pet = u < petiole ? 0.18 + 0.82 * Math.pow(u / petiole, 1.4) : 1;
    return Math.max(0.004, w * pet) * width / 2;
  };
  const cols = colors.map(c => new THREE.Color(c)); const ec = edgeColor ? new THREE.Color(edgeColor) : null;
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const tmp = new THREE.Color();
  for (let i = 0; i <= segU; i++) {
    const u = i / segU, c = C[i], hw = halfW(u);
    const Ny = Math.sin(c.phi), Nz = -Math.cos(c.phi);
    for (let j = 0; j <= segV; j++) {
      const v = j / segV * 2 - 1;
      const x = v * hw;
      const zc = cup * v * v * hw;
      const rf = ruffle * Math.pow(Math.abs(v), 2.5) * Math.sin(ruffleFreq * Math.PI * u + ph + v * 3.1) * (0.6 + 0.4 * Math.sin(u * 37 + ph)) * Math.min(1, u * 3);
      const off = zc + rf;
      pos.push(x, c.y + Ny * off, c.z + Nz * off);
      nor.push(0, Ny, Nz);
      uv.push(v * 0.5 + 0.5, u);
      const t = Math.min(1, u * 1.25) * (cols.length - 1); const a = Math.floor(Math.min(t, cols.length - 1.001));
      tmp.copy(cols[a]).lerp(cols[a + 1], t - a);
      tmp.lerp(cols[0], Math.max(0, 1 - Math.abs(v) * 6) * 0.35 * (1 - u)); // pale midrib
      if (ec) tmp.lerp(ec, THREE.MathUtils.smoothstep(Math.abs(v) * (0.6 + u * 0.6), 1 - edgeWidth, 1.05) * 0.9);
      const jit = 0.94 + r() * 0.08; col.push(tmp.r * jit, tmp.g * jit, tmp.b * jit);
    }
  }
  const row = segV + 1;
  for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) { const a = i * row + j, b = a + row; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  return geo;
}
/** Leaf material. The vein bump map is OFF by default: on tiny (instanced, distant) leaves its screen-space
    derivatives degenerate and produce NaN pixels, which bloom then spreads as white haze. Use { bump: true } only for close-ups. */
export function leafMaterial({ gloss = 0.5, sheen = 0.12, bump = false } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 - gloss * 0.8, map: leafDetailTexture(), sheen, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xd9f0b0), clearcoat: gloss * 0.25, clearcoatRoughness: 0.5 });
  if (bump) { m.bumpMap = leafDetailTexture(); m.bumpScale = 0.8; }
  return m;
}
const LETTUCE = {
  butterhead: { shape: 'round', colors: ['#e3efac', '#a2cd52', '#62a032'], ruffle: 0.004, cup: 0.5, edge: null, heart: 0.35 },
  green: { shape: 'ovate', colors: ['#dcebaa', '#86c043', '#4c912a'], ruffle: 0.009, cup: 0.3, edge: null, heart: 0.2 },
  red: { shape: 'ovate', colors: ['#dfeab2', '#7ea845', '#5b7d33'], ruffle: 0.01, cup: 0.3, edge: '#5a1530', heart: 0.2 },
  oakleaf: { shape: 'oak', colors: ['#dcebaa', '#80bb45', '#4a8a2a'], ruffle: 0.006, cup: 0.25, edge: null, heart: 0.2 },
  romaine: { shape: 'narrow', colors: ['#eaf3c8', '#8ec44e', '#3f7f24'], ruffle: 0.004, cup: 0.55, edge: null, heart: 0.5 }
};
/**
 * Merged lettuce-head geometry (for instancing many plants).
 * growth 0..1 scales leaf number and size (0.05 ≈ seedling, 1 ≈ market size ~250 g).
 * detail 0.3..1 scales the mesh resolution (1 ≈ 9 k triangles per head at full size; 0.5 ≈ a quarter of that)
 * — use 0.4–0.6 when hundreds of heads are instanced.
 */
export function lettuceGeometry({ radius = 0.13, leaves = 22, growth = 1, variety = 'butterhead', seed = 3, detail = 1 } = {}) {
  const V = LETTUCE[variety] || LETTUCE.butterhead; const r = rng(seed);
  const segU = Math.max(6, Math.round(18 * detail)), segV = Math.max(4, Math.round(12 * detail));
  const n = Math.max(3, Math.round(leaves * (0.35 + 0.65 * growth)));
  const R = radius * (0.25 + 0.75 * Math.pow(growth, 0.7));
  const geos = []; const golden = 2.39996;
  for (let k = 0; k < n; k++) {
    const age = 1 - k / n; // outer leaves first (older)
    const inner = age < V.heart; // young heart leaves: upright, curling inward over the centre
    const len = R * (0.5 + 0.8 * age) * (0.9 + r() * 0.2);
    const pitch = inner ? 0.12 + 0.5 * age + (r() - 0.5) * 0.1 : 0.35 + 0.95 * Math.pow(age, 1.2) + (r() - 0.5) * 0.18;
    const curl = inner ? -0.55 + 0.4 * age : 0.25 + 0.55 * age;
    const geo = leafGeometry({ length: len, width: len * (V.shape === 'narrow' ? 0.55 : 0.98), pitch, curl, cup: V.cup * (inner ? 1.6 : 1.25 - age * 0.5), ruffle: V.ruffle * len / 0.1 * (inner ? 0.5 : 1), ruffleFreq: 5 + r() * 3, shape: V.shape, seed: seed * 100 + k, colors: inner ? [V.colors[0], V.colors[0], V.colors[1]] : V.colors.map((c, i) => i === 2 ? (age > 0.55 ? c : V.colors[1]) : c), edgeColor: V.edge, segU, segV });
    const m = new THREE.Matrix4().makeRotationY(k * golden + r() * 0.2);
    m.multiply(new THREE.Matrix4().makeTranslation(0, 0.004 * k / n, R * (inner ? 0.02 : 0.05) * age));
    geo.applyMatrix4(m); geos.push(geo);
  }
  const merged = BufferGeometryUtils.mergeGeometries(geos, false);
  geos.forEach(g => g.dispose());
  return merged;
}
/** Single lettuce mesh. */
export function makeLettuce(opts = {}) {
  const m = new THREE.Mesh(lettuceGeometry(opts), leafMaterial({ gloss: 0.45 }));
  m.castShadow = true; m.receiveShadow = true; m.name = 'lettuce';
  return m;
}
/** Basil-like herb: stem with opposite decussate glossy ovate leaves. */
export function makeHerb({ height = 0.25, nodes = 5, leafSize = 0.055, seed = 5, color = ['#dff0b0', '#6fb33f', '#3f7f24'] } = {}) {
  const g = new THREE.Group(); const r = rng(seed);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x7ea04a, roughness: 0.6 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.005, height, 8), stemMat); stem.position.y = height / 2; g.add(stem);
  const geos = [];
  for (let i = 0; i < nodes; i++) {
    const y = height * (0.2 + 0.8 * i / nodes); const size = leafSize * (1.1 - 0.5 * i / nodes);
    for (let s = 0; s < 2; s++) {
      const geo = leafGeometry({ length: size, width: size * 0.62, pitch: 1.0 + 0.2 * r(), curl: 0.5, cup: 0.25, ruffle: 0.002, shape: 'ovate', petiole: 0.2, seed: seed * 50 + i * 2 + s, colors: color });
      geo.applyMatrix4(new THREE.Matrix4().makeRotationY(s * Math.PI + i * Math.PI / 2 + (r() - 0.5) * 0.2));
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, y, 0)); geos.push(geo);
    }
  }
  const top = leafGeometry({ length: leafSize * 0.5, width: leafSize * 0.35, pitch: 0.2, curl: 0.4, cup: 0.4, shape: 'ovate', seed: seed + 999, colors: color });
  top.applyMatrix4(new THREE.Matrix4().makeTranslation(0, height, 0)); geos.push(top);
  const leaves = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(geos), leafMaterial({ gloss: 0.7 }));
  g.add(leaves);
  g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return g;
}
/** Seedling with two cotyledons and an optional first true leaf pair. */
export function makeSeedling({ size = 0.03, trueLeaves = true, seed = 9 } = {}) {
  const geos = [];
  [0, Math.PI].forEach((a, i) => { const g = leafGeometry({ length: size, width: size * 0.7, pitch: 1.2, curl: 0.2, cup: 0.2, shape: 'ovate', petiole: 0.3, seed: seed + i, colors: ['#e9f3c0', '#a9d468', '#86bf4a'] }); g.applyMatrix4(new THREE.Matrix4().makeRotationY(a)); g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, size * 0.9, 0)); geos.push(g); });
  if (trueLeaves) [Math.PI / 2, -Math.PI / 2].forEach((a, i) => { const g = leafGeometry({ length: size * 0.8, width: size * 0.7, pitch: 0.6, curl: 0.3, cup: 0.4, ruffle: 0.002, seed: seed + 10 + i }); g.applyMatrix4(new THREE.Matrix4().makeRotationY(a)); g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, size * 1.05, 0)); geos.push(g); });
  const hyp = new THREE.CylinderGeometry(0.0012, 0.0016, size * 0.95, 6); hyp.translate(0, size * 0.47, 0);
  const col = new Float32Array(hyp.attributes.position.count * 3).fill(0.75); hyp.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geos.push(hyp);
  const m = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(geos.map(g => g.index ? g : g)), leafMaterial({ gloss: 0.5 }));
  m.castShadow = true; return m;
}
/**
 * Root system as merged tubes hanging downward. style: 'hanging' (hydroponic/aeroponic), 'mat' (NFT, spreading along +z).
 * Returns a Mesh; scale y to animate growth.
 */
export function makeRoots({ count = 26, length = 0.25, spread = 0.05, thickness = 0.0022, style = 'hanging', seed = 4, laterals = 2, color } = {}) {
  const r = rng(seed); const geos = [];
  const addRoot = (start, dir, len, th, depth) => {
    const pts = [start.clone()]; const p = start.clone(); const d = dir.clone();
    const steps = 10;
    for (let s = 0; s < steps; s++) {
      d.x += (r() - 0.5) * 0.35; d.z += (r() - 0.5) * 0.35;
      if (style === 'mat') { d.y = -0.15; d.z += 0.25; } else d.y -= 0.15;
      d.normalize(); p.addScaledVector(d, len / steps); pts.push(p.clone());
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 16, th, 5, false);
    // taper: scale radius along length
    const pa = tube.attributes.position; const center = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) { const seg = Math.floor(i / 6); const t = seg / 16; curve.getPointAt(Math.min(1, t), center); const v = new THREE.Vector3().fromBufferAttribute(pa, i).sub(center).multiplyScalar(1 - 0.75 * t).add(center); pa.setXYZ(i, v.x, v.y, v.z); }
    tube.computeVertexNormals();
    geos.push(tube);
    if (depth < laterals) { const nl = 2 + Math.floor(r() * 3); for (let k = 0; k < nl; k++) { const t = 0.2 + r() * 0.6; const sp = curve.getPointAt(t); const nd = new THREE.Vector3((r() - 0.5) * 2, -0.2, (r() - 0.5) * 2).normalize(); addRoot(sp, nd, len * (0.25 + r() * 0.2), th * 0.55, depth + 1); } }
  };
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * spread;
    const start = new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    const dir = new THREE.Vector3(Math.cos(a) * 0.3, -1, Math.sin(a) * 0.3).normalize();
    addRoot(start, dir, length * (0.6 + r() * 0.5), thickness * (0.7 + r() * 0.6), 1);
  }
  const mat = M.root(); if (color) mat.color.set(color);
  const mesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(geos), mat);
  geos.forEach(g => g.dispose()); mesh.castShadow = true; mesh.name = 'roots';
  return mesh;
}
/** Plastic net pot (lattice cup). */
export function makeNetPot({ radius = 0.026, height = 0.05, color = 0x1c1e20 } = {}) {
  const alpha = canvasTexture(128, 64, (ctx, w, h) => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#000'; for (let i = 0; i < 12; i++) for (let j = 0; j < 3; j++) ctx.fillRect(i * w / 12 + 2, 8 + j * 18, w / 12 - 5, 12); }, { srgb: false, key: 'netpot-alpha' });
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, alphaMap: alpha, alphaTest: 0.5, side: THREE.DoubleSide });
  const g = new THREE.Group();
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.78, height, 32, 1, true), mat); cup.position.y = -height / 2; g.add(cup);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.12, 0.0035, 8, 40), new THREE.MeshStandardMaterial({ color, roughness: 0.5 })); rim.rotation.x = Math.PI / 2; g.add(rim);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.78, 24), mat); bottom.rotation.x = Math.PI / 2; bottom.position.y = -height; g.add(bottom);
  g.traverse(m => { if (m.isMesh) m.castShadow = true; });
  return g;
}
/** Rock-wool cube (plug or block). */
export function makeRockwoolCube({ size = 0.04, height } = {}) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(size, height || size, size, 2, size * 0.06), M.rockwool()); m.castShadow = m.receiveShadow = true; return m;
}
/**
 * Field crop as instanced leaf blades (cereal-like) with wind sway.
 * heightFn(x,z) → metres, colorFn(x,z) → THREE.Color (e.g., vigour map). Returns InstancedMesh with .update(time).
 */
export function makeFieldCrop({ width = 20, depth = 20, rowSpacing = 0.18, plantSpacing = 0.06, bladesPerPlant = 1, height = 0.6, heightFn, colorFn, maxInstances = 60000, bladeWidth = 0.012, seed = 21, origin = [0, 0] } = {}) {
  const r = rng(seed);
  const blade = new THREE.PlaneGeometry(bladeWidth, 1, 1, 6); blade.translate(0, 0.5, 0);
  const bp = blade.attributes.position; for (let i = 0; i < bp.count; i++) { const y = bp.getY(i); bp.setX(i, bp.getX(i) * (1 - y * 0.85)); bp.setZ(i, y * y * 0.18); }
  blade.computeVertexNormals();
  const rows = Math.floor(depth / rowSpacing), per = Math.floor(width / plantSpacing);
  const total = Math.min(maxInstances, rows * per * bladesPerPlant);
  const stride = Math.max(1, (rows * per * bladesPerPlant) / total);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, side: THREE.DoubleSide });
  const uTime = { value: 0 };
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
      float ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.45;
      float sway = sin(uTime * 1.6 + ph) * 0.6 + sin(uTime * 3.1 + ph * 1.7) * 0.25;
      transformed.x += sway * 0.08 * position.y * position.y;
      transformed.z += cos(uTime * 1.3 + ph) * 0.03 * position.y * position.y;
      #endif`);
  };
  const mesh = new THREE.InstancedMesh(blade, mat, total);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
  let k = 0, acc = 0;
  for (let i = 0; i < rows && k < total; i++) for (let j = 0; j < per && k < total; j++) for (let b = 0; b < bladesPerPlant && k < total; b++) {
    acc += 1; if (acc < stride) continue; acc -= stride;
    const x = origin[0] - width / 2 + j * plantSpacing + (r() - 0.5) * plantSpacing * 0.6;
    const z = origin[1] - depth / 2 + i * rowSpacing + (r() - 0.5) * 0.03;
    const hh = (heightFn ? heightFn(x, z) : height) * (0.75 + r() * 0.4);
    p.set(x, 0, z); e.set((r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.5); q.setFromEuler(e); s.set(1 + r() * 0.5, Math.max(0.01, hh), 1);
    m4.compose(p, q, s); mesh.setMatrixAt(k, m4);
    if (colorFn) c.copy(colorFn(x, z)); else c.setHSL(0.23 + r() * 0.04, 0.55, 0.28 + r() * 0.1);
    c.offsetHSL(0, 0, (r() - 0.5) * 0.06); mesh.setColorAt(k, c); k++;
  }
  mesh.count = k; mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.update = t => { uTime.value = t; };
  mesh.recolor = fn => { for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, m4); p.setFromMatrixPosition(m4); c.copy(fn(p.x, p.z)); mesh.setColorAt(i, c); } mesh.instanceColor.needsUpdate = true; };
  return mesh;
}

/* ======================================================================
   Water systems
   ====================================================================== */
let waterNormalTex = null;
function waterNormals() {
  if (waterNormalTex) return waterNormalTex;
  waterNormalTex = surfaceTextures({ key: 'waterN', size: 256, scale: 4, octaves: 4, palette: ['#888', '#999'], normalStrength: 1.4 }).normal;
  return waterNormalTex;
}
/**
 * Open-top tank with water. material: 'plastic' (opaque walls), 'glass' (see-through).
 * Returns group with .water (volume), .surface, .setLevel(f 0..1), .update(t), .inner {w,h,d}.
 */
export function makeTank({ w = 1, h = 0.6, d = 0.6, wall = 0.012, level = 0.8, material = 'plastic', color = 0x2f3336, waterTint = 0x3f8fa6, cheapWater = true, clarity = 0.55 } = {}) {
  const g = new THREE.Group();
  const wm = material === 'glass' ? M.glassCheap(0.18) : material === 'acrylic' ? M.glassCheap(0.1) : M.plastic(color, 0.55);
  const addWall = (sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wm); m.position.set(x, y, z); m.castShadow = material === 'plastic'; m.receiveShadow = true; g.add(m); return m; };
  addWall(w, wall, d, 0, wall / 2, 0);
  addWall(w, h, wall, 0, h / 2, d / 2 - wall / 2); addWall(w, h, wall, 0, h / 2, -d / 2 + wall / 2);
  addWall(wall, h, d - 2 * wall, w / 2 - wall / 2, h / 2, 0); addWall(wall, h, d - 2 * wall, -w / 2 + wall / 2, h / 2, 0);
  if (material !== 'plastic') { const rimM = M.plasticBlack(); [[w, 0.015, 0.02, 0, h, d / 2 - 0.01], [w, 0.015, 0.02, 0, h, -d / 2 + 0.01], [0.02, 0.015, d, w / 2 - 0.01, h, 0], [0.02, 0.015, d, -w / 2 + 0.01, h, 0]].forEach(a => { const m = new THREE.Mesh(new THREE.BoxGeometry(a[0], a[1], a[2]), rimM); m.position.set(a[3], a[4], a[5]); g.add(m); }); }
  const iw = w - 2 * wall - 0.002, id = d - 2 * wall - 0.002, ih = h - wall;
  const wmat = cheapWater ? M.waterCheap(waterTint, clarity) : M.water(waterTint);
  const water = new THREE.Mesh(new THREE.BoxGeometry(iw, 1, id), wmat); g.add(water);
  const nt = waterNormals().clone(); nt.repeat.set(w * 2, d * 2); nt.needsUpdate = true;
  const smat = new THREE.MeshPhysicalMaterial({ color: waterTint, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.35, normalMap: nt, normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false });
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(iw, id), smat); surface.rotation.x = -Math.PI / 2; g.add(surface);
  g.water = water; g.surface = surface; g.inner = { w: iw, h: ih, d: id };
  g.setLevel = f => { const lh = Math.max(0.002, ih * f); water.scale.y = lh; water.position.y = wall + lh / 2; surface.position.y = wall + lh + 0.0005; g.levelY = wall + lh; };
  g.update = t => { nt.offset.set(t * 0.02, t * 0.013); };
  g.setLevel(level);
  return g;
}
/** Floating raft (polystyrene) with a grid of holes; returns group with .holes (local positions). */
export function makeRaft({ w = 1.2, d = 0.6, thickness = 0.03, nx = 6, nz = 3, holeR = 0.026 } = {}) {
  const shape = new THREE.Shape(); shape.moveTo(-w / 2, -d / 2); shape.lineTo(w / 2, -d / 2); shape.lineTo(w / 2, d / 2); shape.lineTo(-w / 2, d / 2); shape.lineTo(-w / 2, -d / 2);
  const holes = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x = -w / 2 + (i + 0.5) * w / nx, z = -d / 2 + (j + 0.5) * d / nz;
    const hp = new THREE.Path(); hp.absarc(x, z, holeR, 0, Math.PI * 2, true); shape.holes.push(hp); holes.push(new THREE.Vector3(x, 0, -z));
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 1, curveSegments: 20 });
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, M.foam()); m.castShadow = true; m.receiveShadow = true;
  const g = new THREE.Group(); g.add(m); g.holes = holes; g.thickness = thickness;
  return g;
}
/** NFT gutter channel along +x with lid holes. Returns group with .holes, .film (water film mesh), .setFilm(depthMetres). */
export function makeNFTChannel({ length = 3, width = 0.1, height = 0.055, holes = 12, holeR = 0.024, color = 0xf2f2ee } = {}) {
  const g = new THREE.Group();
  const prof = new THREE.Shape(); const t = 0.003, W = width / 2;
  prof.moveTo(-W, 0); prof.lineTo(W, 0); prof.lineTo(W, height); prof.lineTo(W - t, height); prof.lineTo(W - t, t); prof.lineTo(-W + t, t); prof.lineTo(-W + t, height); prof.lineTo(-W, height); prof.lineTo(-W, 0);
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(prof, { depth: length, bevelEnabled: false }), M.plastic(color, 0.38));
  body.rotation.y = Math.PI / 2; body.position.x = -length / 2; g.add(body);
  const lid = new THREE.Shape(); lid.moveTo(-length / 2, -W); lid.lineTo(length / 2, -W); lid.lineTo(length / 2, W); lid.lineTo(-length / 2, W); lid.lineTo(-length / 2, -W);
  const hpos = [];
  for (let i = 0; i < holes; i++) { const x = -length / 2 + (i + 0.5) * length / holes; const hp = new THREE.Path(); hp.absarc(x, 0, holeR, 0, Math.PI * 2, true); lid.holes.push(hp); hpos.push(new THREE.Vector3(x, height, 0)); }
  const lidG = new THREE.ExtrudeGeometry(lid, { depth: 0.003, bevelEnabled: false, curveSegments: 20 }); lidG.rotateX(-Math.PI / 2);
  const lidM = new THREE.Mesh(lidG, M.plastic(color, 0.38)); lidM.position.y = height; g.add(lidM);
  const nt = waterNormals().clone(); nt.repeat.set(length * 4, 1); nt.needsUpdate = true;
  const film = new THREE.Mesh(new THREE.BoxGeometry(length - 0.01, 1, width - 2 * t - 0.002), new THREE.MeshPhysicalMaterial({ color: 0x5aa9c4, transparent: true, opacity: 0.7, roughness: 0.03, normalMap: nt, normalScale: new THREE.Vector2(0.4, 0.4), clearcoat: 1 }));
  g.add(film);
  g.setFilm = depth => { film.scale.y = Math.max(0.0005, depth); film.position.y = t + film.scale.y / 2; };
  g.update = time => { nt.offset.x = -time * 0.25; };
  g.setFilm(0.004);
  g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  g.holes = hpos; g.length = length; g.height = height;
  return g;
}

/* ======================================================================
   Particles
   ====================================================================== */
/**
 * Rising bubbles (air-stones, aeration). emitters: array of [x,y,z]; top: surface y (world or parent space).
 * Returns object with .mesh, .update(dt), .rate (bubbles per s per emitter), .setRate(r).
 */
export class Bubbles {
  constructor({ emitters = [[0, 0, 0]], top = 0.5, max = 600, size = 0.004, rate = 40, spread = 0.02, speed = 0.25 } = {}) {
    this.emitters = emitters.map(e => new THREE.Vector3(...e)); this.top = top; this.rate = rate; this.spread = spread; this.speed = speed; this.size = size;
    const geo = new THREE.SphereGeometry(1, 10, 8);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.55, ior: 1.0, thickness: 0.001, envMapIntensity: 2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max); this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.p = []; this.acc = 0; this.m4 = new THREE.Matrix4(); this.max = max;
  }
  setRate(r) { this.rate = r; }
  update(dt) {
    this.acc += dt * this.rate * this.emitters.length;
    while (this.acc > 1 && this.p.length < this.max) {
      this.acc -= 1; const e = this.emitters[Math.floor(Math.random() * this.emitters.length)];
      this.p.push({ x: e.x + (Math.random() - 0.5) * this.spread, y: e.y, z: e.z + (Math.random() - 0.5) * this.spread, r: this.size * (0.5 + Math.random()), ph: Math.random() * 6 });
    }
    if (this.acc > 1) this.acc = 0;
    let n = 0;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const b = this.p[i]; b.y += dt * this.speed * (0.7 + b.r / this.size * 0.4); b.ph += dt * 9; b.x += Math.sin(b.ph) * dt * 0.01;
      if (b.y > this.top) { this.p.splice(i, 1); continue; }
    }
    for (const b of this.p) { const s = b.r * (1 + 0.15 * Math.sin(b.ph)); this.m4.makeScale(s, s * 0.85, s).setPosition(b.x, b.y, b.z); this.mesh.setMatrixAt(n++, this.m4); }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
  }
}
let softDot = null;
function softDotTexture() { if (!softDot) softDot = canvasTexture(64, 64, (ctx, w) => { const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, w); }, { srgb: false, key: 'softdot' }); return softDot; }
/**
 * Mist / spray from nozzles (aeroponics, foggers). nozzles: [{pos:[x,y,z], dir:[x,y,z]}]. dropletSize in metres (visual scale).
 * .on (bool), .update(dt). Particles decelerate by drag and settle with gravity.
 */
export class Mist {
  constructor({ nozzles = [{ pos: [0, 0, 0], dir: [0, 1, 0] }], max = 4000, rate = 900, speed = 1.2, cone = 0.5, size = 0.012, life = 1.4, color = 0xdff3ff, gravity = 0.6, drag = 2.5 } = {}) {
    this.nozzles = nozzles.map(n => ({ pos: new THREE.Vector3(...n.pos), dir: new THREE.Vector3(...n.dir).normalize() }));
    Object.assign(this, { max, rate, speed, cone, life, gravity, drag, on: true });
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.age = new Float32Array(max).fill(1e9);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.alpha = new Float32Array(max); geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.PointsMaterial({ color, size, map: softDotTexture(), transparent: true, depthWrite: false, opacity: 0.55, sizeAttenuation: true, blending: THREE.NormalBlending });
    this.points = new THREE.Points(geo, this.mat); this.points.frustumCulled = false; this.i = 0; this.acc = 0;
  }
  update(dt) {
    if (this.on) this.acc += dt * this.rate * this.nozzles.length;
    const tmp = new THREE.Vector3();
    while (this.acc > 1) {
      this.acc -= 1; const n = this.nozzles[Math.floor(Math.random() * this.nozzles.length)]; const k = this.i++ % this.max;
      tmp.copy(n.dir).add(new THREE.Vector3((Math.random() - 0.5) * this.cone, (Math.random() - 0.5) * this.cone, (Math.random() - 0.5) * this.cone)).normalize().multiplyScalar(this.speed * (0.6 + Math.random() * 0.6));
      this.pos.set([n.pos.x, n.pos.y, n.pos.z], k * 3); this.vel.set([tmp.x, tmp.y, tmp.z], k * 3); this.age[k] = 0;
    }
    const f = Math.exp(-this.drag * dt);
    for (let k = 0; k < this.max; k++) {
      if (this.age[k] > this.life) { this.pos[k * 3 + 1] = -999; continue; }
      this.age[k] += dt; const j = k * 3;
      this.vel[j] *= f; this.vel[j + 1] = this.vel[j + 1] * f - this.gravity * dt; this.vel[j + 2] *= f;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
/** Particles streaming along a curve (flow visualisation). .speed (m/s), .update(dt). */
export class FlowAlong {
  constructor(curve, { count = 80, speed = 0.3, size = 0.012, color = 0x5cc8ef, jitter = 0.01, opacity = 0.9 } = {}) {
    this.curve = curve; this.speed = speed; this.len = curve.getLength(); this.jitter = jitter;
    this.t = Array.from({ length: count }, (_, i) => i / count);
    this.off = Array.from({ length: count }, () => new THREE.Vector3((Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter));
    const geo = new THREE.BufferGeometry(); this.pos = new Float32Array(count * 3); geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, map: softDotTexture(), transparent: true, depthWrite: false, opacity, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false; this._p = new THREE.Vector3();
  }
  update(dt) {
    const dtn = this.speed * dt / this.len;
    for (let i = 0; i < this.t.length; i++) { this.t[i] = (this.t[i] + dtn) % 1; if (this.t[i] < 0) this.t[i] += 1; this.curve.getPointAt(this.t[i], this._p).add(this.off[i]); this.pos.set([this._p.x, this._p.y, this._p.z], i * 3); }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

/* ======================================================================
   Animals
   ====================================================================== */
/** Procedural fish (tilapia-like by default). Returns group with .swim(t, speed) to animate the tail. */
export function makeFish({ length = 0.25, color = 0x8e9aa0, belly = 0xd9dcd2, stripes = true, seed = 1 } = {}) {
  const g = new THREE.Group(); const L = length;
  const prof = []; for (let i = 0; i <= 24; i++) { const t = i / 24; const r = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.9) * 0.19 * L * (1 - 0.55 * t * t); prof.push(new THREE.Vector2(Math.max(0.0005, r), t * L)); }
  const geo = new THREE.LatheGeometry(prof, 28); geo.rotateZ(Math.PI / 2); geo.translate(L * 0.45, 0, 0); geo.scale(1, 1.15, 0.5);
  // vertex colours: dark back, pale belly, stripes
  const pa = geo.attributes.position; const cols = []; const cb = new THREE.Color(color), cw = new THREE.Color(belly), c = new THREE.Color();
  for (let i = 0; i < pa.count; i++) { const y = pa.getY(i), x = pa.getX(i); const t = THREE.MathUtils.smoothstep(y, -0.06 * L, 0.05 * L); c.copy(cw).lerp(cb, t); if (stripes && Math.sin(x / L * 38) > 0.55 && y > -0.02 * L) c.multiplyScalar(0.8); cols.push(c.r, c.g, c.b); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.15, iridescence: 0.5, iridescenceIOR: 1.3, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const body = new THREE.Mesh(geo, mat); g.add(body);
  const finMat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, transparent: true, opacity: 0.75, side: THREE.DoubleSide, transmission: 0.2 });
  const tailS = new THREE.Shape(); tailS.moveTo(0, 0); tailS.quadraticCurveTo(-0.12 * L, 0.1 * L, -0.2 * L, 0.13 * L); tailS.quadraticCurveTo(-0.16 * L, 0, -0.2 * L, -0.13 * L); tailS.quadraticCurveTo(-0.12 * L, -0.1 * L, 0, 0);
  const tail = new THREE.Mesh(new THREE.ShapeGeometry(tailS, 8), finMat); const tailPivot = new THREE.Group(); tailPivot.position.x = -0.53 * L; tailPivot.add(tail); g.add(tailPivot);
  const dS = new THREE.Shape(); dS.moveTo(0.25 * L, 0); dS.quadraticCurveTo(0.05 * L, 0.14 * L, -0.35 * L, 0.02 * L); dS.lineTo(-0.35 * L, 0); dS.lineTo(0.25 * L, 0);
  const dorsal = new THREE.Mesh(new THREE.ShapeGeometry(dS, 8), finMat); dorsal.position.y = 0.2 * L; g.add(dorsal);
  const pec = new THREE.Mesh(new THREE.CircleGeometry(0.05 * L, 10, 0, Math.PI), finMat); pec.position.set(0.18 * L, -0.05 * L, 0.09 * L); pec.rotation.set(0.4, 0.5, 0); g.add(pec);
  const pec2 = pec.clone(); pec2.position.z = -0.09 * L; pec2.rotation.set(-0.4, -0.5, 0); g.add(pec2);
  const eyeM = new THREE.MeshPhysicalMaterial({ color: 0x0a0a0a, roughness: 0.05, clearcoat: 1 });
  [-1, 1].forEach(s => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.022 * L, 12, 10), eyeM); e.position.set(0.36 * L, 0.035 * L, s * 0.075 * L); g.add(e); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.024 * L, 0.006 * L, 6, 16), new THREE.MeshStandardMaterial({ color: 0xc9b26a, metalness: 0.5, roughness: 0.3 })); ring.position.copy(e.position); ring.rotation.y = Math.PI / 2; g.add(ring); });
  g.traverse(m => { if (m.isMesh) m.castShadow = true; });
  const ph = seed * 1.7;
  g.swim = (t, speed = 1) => { tailPivot.rotation.y = Math.sin(t * 9 * speed + ph) * 0.45; body.rotation.y = Math.sin(t * 9 * speed + ph + 1.2) * 0.06; pec.rotation.z = Math.sin(t * 5 + ph) * 0.3; pec2.rotation.z = -pec.rotation.z; };
  return g;
}
/** Simple schooling (boids-lite) inside a box. bounds: THREE.Box3 (in parent space). .update(dt, t). */
export class FishSchool {
  constructor(parent, { count = 12, bounds, length = 0.22, speed = 0.18, color, seed = 3 } = {}) {
    this.bounds = bounds || new THREE.Box3(new THREE.Vector3(-0.4, 0.1, -0.25), new THREE.Vector3(0.4, 0.45, 0.25));
    this.fish = []; this.speed = speed; this.activity = 1; const r = rng(seed);
    const size = new THREE.Vector3(); this.bounds.getSize(size);
    for (let i = 0; i < count; i++) {
      const f = makeFish({ length: length * (0.8 + r() * 0.4), color: color ?? (r() < 0.2 ? 0xb07a5a : 0x8e9aa0), seed: i + 1 });
      f.position.set(this.bounds.min.x + r() * size.x, this.bounds.min.y + r() * size.y, this.bounds.min.z + r() * size.z);
      f.userData.v = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.2, r() - 0.5).normalize().multiplyScalar(speed);
      parent.add(f); this.fish.push(f);
    }
    this._t = new THREE.Vector3(); this._c = new THREE.Vector3();
  }
  update(dt, t) {
    const b = this.bounds, c = this._c.set(0, 0, 0); this.fish.forEach(f => c.add(f.position)); c.multiplyScalar(1 / this.fish.length);
    for (const f of this.fish) {
      const v = f.userData.v; const sp = this.speed * this.activity;
      // cohesion + separation + wander + wall avoidance
      this._t.copy(c).sub(f.position).multiplyScalar(0.25); v.addScaledVector(this._t, dt);
      for (const o of this.fish) { if (o === f) continue; const d = f.position.distanceTo(o.position); if (d < 0.12) v.addScaledVector(this._t.copy(f.position).sub(o.position).normalize(), dt * 0.6); }
      v.x += (Math.random() - 0.5) * dt * 0.4; v.z += (Math.random() - 0.5) * dt * 0.4; v.y += (Math.random() - 0.5) * dt * 0.1;
      const m = 0.08;
      if (f.position.x < b.min.x + m) v.x += dt * 1.5; if (f.position.x > b.max.x - m) v.x -= dt * 1.5;
      if (f.position.y < b.min.y + m / 2) v.y += dt * 0.8; if (f.position.y > b.max.y - m / 2) v.y -= dt * 0.8;
      if (f.position.z < b.min.z + m) v.z += dt * 1.5; if (f.position.z > b.max.z - m) v.z -= dt * 1.5;
      v.y *= 0.96; v.setLength(Math.max(0.02, sp));
      f.position.addScaledVector(v, dt);
      const yaw = Math.atan2(-v.z, v.x); f.rotation.y += ((yaw - f.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 4);
      f.rotation.z = THREE.MathUtils.lerp(f.rotation.z, v.y * 2, dt * 3);
      f.swim(t, 0.6 + this.activity * 0.8);
    }
  }
}

/* ======================================================================
   Machines, instruments, annotations
   ====================================================================== */
/** Quadcopter drone with spinning rotors. .update(dt). */
export function makeDrone({ size = 0.5, color = 0x2a2d31 } = {}) {
  const g = new THREE.Group(); const s = size;
  const body = new THREE.Mesh(new RoundedBoxGeometry(s * 0.34, s * 0.1, s * 0.22, 3, s * 0.03), M.plastic(color, 0.35)); g.add(body);
  const cam = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.045, s * 0.045, s * 0.06, 16), M.plasticBlack()); cam.rotation.x = Math.PI / 2; cam.position.set(s * 0.12, -s * 0.07, 0); g.add(cam);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(s * 0.032, 20), new THREE.MeshPhysicalMaterial({ color: 0x0a1030, roughness: 0.02, metalness: 0.4, clearcoat: 1, iridescence: 1 })); lens.position.set(s * 0.12, -s * 0.07, s * 0.031); g.add(lens);
  const props = [];
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b], i) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(s * 0.42, s * 0.025, s * 0.03), M.plastic(color, 0.4)); arm.position.set(a * s * 0.16, 0, b * s * 0.16); arm.rotation.y = Math.atan2(b, a) * -1 + 0; arm.lookAt(new THREE.Vector3(a * s, 0, b * s)); arm.rotateY(Math.PI / 2); g.add(arm);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.035, s * 0.035, s * 0.05, 16), M.aluminium()); motor.position.set(a * s * 0.3, s * 0.03, b * s * 0.3); g.add(motor);
    const prop = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.17, s * 0.17, s * 0.004, 32), new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true, opacity: 0.25, roughness: 0.4 }));
    prop.position.set(a * s * 0.3, s * 0.06, b * s * 0.3); g.add(prop); props.push(prop);
    const led = new THREE.Mesh(new THREE.SphereGeometry(s * 0.012, 8, 8), M.emissive(i < 2 ? 0x2cff6a : 0xff2a3c, 4)); led.position.set(a * s * 0.3, -s * 0.01, b * s * 0.3); g.add(led);
  });
  const legM = M.plasticGrey(); [-1, 1].forEach(z => { const leg = new THREE.Mesh(new THREE.BoxGeometry(s * 0.3, s * 0.015, s * 0.015), legM); leg.position.set(0, -s * 0.12, z * s * 0.1); g.add(leg); });
  g.traverse(m => { if (m.isMesh) m.castShadow = true; });
  g.update = dt => { props.forEach((p, i) => p.rotation.y += dt * 60 * (i % 2 ? 1 : -1)); };
  return g;
}
/** Thick 3-D arrow (for fluxes). Returns group with .set(from, to, thickness?). */
export function makeArrow({ from = [0, 0, 0], to = [0, 1, 0], color = 0x6fd39a, thickness = 0.02, emissive = 0.4, opacity = 1 } = {}) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: emissive, roughness: 0.4, transparent: opacity < 1, opacity });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16), mat); const head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 20), mat);
  g.add(shaft, head); g.material = mat;
  const up = new THREE.Vector3(0, 1, 0);
  g.set = (a, b, th = thickness) => {
    const A = new THREE.Vector3(...(a.isVector3 ? a.toArray() : a)), B = new THREE.Vector3(...(b.isVector3 ? b.toArray() : b));
    const dir = B.clone().sub(A); const len = dir.length(); if (len < 1e-6) { g.visible = false; return; } g.visible = true; dir.normalize();
    const hl = Math.min(len * 0.35, th * 5);
    shaft.scale.set(th, len - hl, th); shaft.position.copy(A).addScaledVector(dir, (len - hl) / 2);
    head.scale.set(th * 2.4, hl, th * 2.4); head.position.copy(A).addScaledVector(dir, len - hl / 2);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir); shaft.quaternion.copy(q); head.quaternion.copy(q);
  };
  g.set(from, to);
  return g;
}
/** Texture from a 2-D scalar field for mapping onto planes (e.g., PPFD map). values[row][col], row 0 = −z edge. */
export function heatmapTexture(values, { colormap: cm = 'turbo', min, max, smooth = true } = {}) {
  const ny = values.length, nx = values[0].length;
  let lo = min, hi = max; if (lo == null || hi == null) { let a = Infinity, b = -Infinity; values.forEach(r => r.forEach(v => { a = Math.min(a, v); b = Math.max(b, v); })); lo = lo ?? a; hi = hi ?? b; }
  const cv = document.createElement('canvas'); cv.width = nx; cv.height = ny; const ctx = cv.getContext('2d'); const img = ctx.createImageData(nx, ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const c = colormap(cm, (values[j][i] - lo) / (hi - lo || 1)); const k = (j * nx + i) * 4; img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter; t.minFilter = THREE.LinearFilter;
  return t;
}
/** Canvas-rendered text sprite (appears in screenshots, unlike CSS labels). */
export function makeTextSprite(text, { size = 0.12, color = '#ffffff', bg = 'rgba(10,16,14,0.72)', font = '600 48px Inter, sans-serif' } = {}) {
  const cv = document.createElement('canvas'); const ctx = cv.getContext('2d'); ctx.font = font; const w = Math.ceil(ctx.measureText(text).width) + 40; cv.width = w; cv.height = 76;
  ctx.font = font; ctx.fillStyle = bg; const r = 18; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, w, 76, r) : ctx.rect(0, 0, w, 76); ctx.fill();
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, 20, 40);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.set(size * w / 76, size, 1); s.renderOrder = 10;
  return s;
}
/** Simple lab probe/sensor (pH, EC, DO, temperature) with coloured cap. */
export function makeProbe({ length = 0.22, radius = 0.009, cap = 0x2f6fd6, tip = 'glass' } = {}) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 24), M.plastic(0x1b1d20, 0.35)); body.position.y = length / 2; g.add(body);
  const c = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.15, radius * 1.15, length * 0.18, 24), M.plastic(cap, 0.35)); c.position.y = length * 0.95; g.add(c);
  const cable = makePipe([[0, length * 1.03, 0], [0, length * 1.25, 0.02], [0.05, length * 1.4, 0.1]], { radius: 0.003, material: M.plasticBlack() }); g.add(cable);
  if (tip === 'glass') { const bulb = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.8, 20, 16), M.glass()); bulb.position.y = 0; g.add(bulb); }
  else { const t = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.8, radius * 0.8, 0.01, 20), M.steel()); t.position.y = -0.004; g.add(t); }
  g.traverse(m => { if (m.isMesh) m.castShadow = true; });
  return g;
}
/** Place meshes on a grid helper for quick layouts. */
export function grid(nx, nz, dx, dz, fn) { const out = []; for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) out.push(fn((i - (nx - 1) / 2) * dx, (j - (nz - 1) / 2) * dz, i, j)); return out; }
/** Dispose all geometries/materials under an object. */
export function disposeDeep(obj) { obj.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mm => mm.dispose()); }); }
