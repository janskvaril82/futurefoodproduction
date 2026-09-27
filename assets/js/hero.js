/* hero.js — landing page: the Earth as a food planet — slow, cinematic and interactive.
   Drag to spin it (arrow keys too), hover to read the cropland share, click a country (or search) for food statistics.
   Imagery: NASA Blue Marble Next Generation (July 2004, topography + bathymetry), NASA Black Marble 2016 (city lights),
   NASA Blue Marble clouds — public domain (NASA Earth Observatory). Golden glow: share of land used as cropland around
   2000, Ramankutty et al. (2008), via NASA SEDAC/GIBS (CC BY 4.0). Borders: Natural Earth 1:50m (public domain).
   Statistics: FAO, UN, World Bank and ILO data via Our World in Data (CC BY 4.0) — see /assets/data/food-stats.json.
   Flags: flag-icons by Panayiotis Lipiridis (MIT licence), loaded from jsDelivr; ISO codes in countries.json ("f"). */
import { createStage, THREE, CSS2DObject } from './lab3d.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const TEX = '/assets/img/earth/', DATA = '/assets/data/';
const FLAGS = 'https://cdn.jsdelivr.net/npm/flag-icons@7.5.0/flags/4x3/';
const deg = Math.PI / 180;
const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const BASE_SPIN = Math.PI * 2 / 360;                                          // rad s⁻¹: one turn in 6 minutes
const ROT0 = 4.035;                                                           // earth.rotation.y that faces 20° E
const IDW = 2048, IDH = 1024;                                                 // country-index map
const ZMAX = 4;                                                               // deepest zoom (× the resting view)
const EL_MIN = -1.45, EL_MAX = 1.15;                                          // user tilt of the camera (rad, added to the resting 0.22)
const TILT = 23.44 * deg;                                                     // Earth's axial tilt, shown in the cinematic view

// lat/lon (degrees) → unit vector in the frame of THREE.SphereGeometry's equirectangular UVs
function ll(lat, lon, r = 1) {
  const phi = (lon + 180) / 360 * Math.PI * 2, th = (90 - lat) * deg;
  return new THREE.Vector3(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th)).multiplyScalar(r);
}
// country rings (flat [lon, lat, …] arrays) → line-segment positions on a sphere of radius r (same frame as ll); with
// `seen`, a border shared by two countries is drawn once; the ±180° seam and the South Pole cut of split polygons are skipped
function ringSegments(rings, r, seen, out = []) {
  const push = (lon, lat) => { const phi = (lon + 180) / 360 * Math.PI * 2, th = (90 - lat) * deg, s = Math.sin(th); out.push(-Math.cos(phi) * s * r, Math.cos(th) * r, Math.sin(phi) * s * r); };
  for (const ring of rings) for (let k = 0; k + 3 < ring.length; k += 2) {
    const x1 = ring[k], y1 = ring[k + 1], x2 = ring[k + 2], y2 = ring[k + 3];
    if ((x1 === x2 && y1 === y2) || (Math.abs(x1) > 179.9 && Math.abs(x2) > 179.9) || (y1 < -89.9 && y2 < -89.9) || Math.abs(x1 - x2) > 180) continue;
    if (seen) { const a = x1 + ',' + y1, b = x2 + ',' + y2, key = a < b ? a + ' ' + b : b + ' ' + a; if (seen.has(key)) continue; seen.add(key); }
    push(x1, y1); push(x2, y2);
  }
  return out;
}
function imageData(url) {                                                     // CPU copy of a small texture
  return new Promise((res, rej) => {
    const im = new Image(); im.decoding = 'async';
    im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); res({ w: im.width, h: im.height, d: g.getImageData(0, 0, im.width, im.height).data }); };
    im.onerror = rej; im.src = url;
  });
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------------ shaders */
const EARTH_VS = /* glsl */`
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main() { vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const EARTH_FS = /* glsl */`
  uniform sampler2D dayMap, nightMap, cloudMap, waterMap, cropMap, idMap;
  uniform vec3 sunDir; uniform float cloudShift, reveal, time, cropReveal, idReady, selId, hovId;
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  float idAt(vec2 uv) { vec3 c = texture2D(idMap, uv).rgb; return floor(c.r * 255.0 + 0.5) + floor(c.g * 255.0 + 0.5) * 256.0; }
  void main() {
    vec3 N = normalize(vN), V = normalize(cameraPosition - vP), L = normalize(sunDir);
    float ndl = dot(N, L), diff = max(ndl, 0.0);
    float dayAmt = smoothstep(-0.10, 0.30, ndl);
    vec3 day = texture2D(dayMap, vUv).rgb;
    float water = texture2D(waterMap, vUv).r;
    float cloud = smoothstep(0.12, 0.92, texture2D(cloudMap, vUv + vec2(cloudShift, 0.0)).r) * 0.8;
    float night = texture2D(nightMap, vUv).r;
    float crop = smoothstep(0.03, 0.7, texture2D(cropMap, vUv).r) * cropReveal;
    vec3 sunCol = vec3(1.0, 0.96, 0.9);
    float twi = smoothstep(-0.18, 0.04, ndl) * (1.0 - smoothstep(0.04, 0.32, ndl));
    vec3 col = day * (diff * 1.3 * sunCol + 0.012);
    col *= mix(vec3(1.0), vec3(1.0, 0.66, 0.42), twi * 0.85);
    col *= 1.0 - 0.34 * cloud * dayAmt;                                        // cloud shadows
    // farmland: a warm golden light over the world's cropland (the relief stays visible), shimmering slowly
    float shimmer = 0.8 + 0.2 * sin(vUv.x * 90.0 - time * 0.3) * sin(vUv.y * 55.0 + time * 0.2);
    vec3 gold = vec3(1.0, 0.72, 0.28);
    float cv = crop * (1.0 - 0.7 * cloud);
    col = mix(col, col * 0.62 + gold * (0.05 + 0.42 * diff) * shimmer, cv * 0.55 * dayAmt);
    col += gold * cv * 0.3 * (1.0 - dayAmt) * shimmer;                        // …and a golden glow on the night side
    vec3 H = normalize(L + V); float nh = max(dot(N, H), 0.0);
    col += sunCol * (pow(nh, 420.0) * 1.3 + pow(nh, 40.0) * 0.07) * water * diff * (1.0 - cloud);   // sun glint on the oceans
    float lights = pow(night, 1.25) * (1.0 - dayAmt) * (1.0 - 0.8 * cloud);
    col += vec3(1.0, 0.68, 0.36) * lights * 2.2;                              // city lights
    // countries: the hovered country brightens, the selected one is tinted gold (borders and the outline are line meshes);
    // the masks are interpolated between the four nearest texels of the index map, so their edges stay soft when zoomed in
    if (idReady > 0.5) {
      vec2 res = vec2(${IDW}.0, ${IDH}.0), t = vUv * res - 0.5, f = fract(t), b = (floor(t) + 0.5) / res, px = 1.0 / res;
      vec4 ids = vec4(idAt(b), idAt(b + vec2(px.x, 0.0)), idAt(b + vec2(0.0, px.y)), idAt(b + px));
      vec4 ms = step(abs(ids - selId), vec4(0.5)), mh = step(abs(ids - hovId), vec4(0.5));
      float sel = mix(mix(ms.x, ms.y, f.x), mix(ms.z, ms.w, f.x), f.y);
      float hov = mix(mix(mh.x, mh.y, f.x), mix(mh.z, mh.w, f.x), f.y) * (1.0 - sel);
      col = mix(col, col * 1.18 + vec3(0.16, 0.12, 0.04), sel * 0.45);
      col = mix(col, col * 1.25 + vec3(0.10, 0.10, 0.08), hov * 0.6);
    }
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col = mix(col, vec3(0.28, 0.52, 1.0) * (0.12 + 1.1 * diff), fres * (0.18 + 0.7 * dayAmt));   // limb haze
    gl_FragColor = vec4(col * reveal, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const CLOUD_FS = /* glsl */`
  uniform sampler2D cloudMap; uniform vec3 sunDir; uniform float cloudShift, reveal, clear;
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main() {
    vec3 N = normalize(vN), V = normalize(cameraPosition - vP), L = normalize(sunDir);
    float a = smoothstep(0.14, 0.95, texture2D(cloudMap, vUv + vec2(cloudShift, 0.0)).r) * 0.72 * (1.0 - 0.35 * clear);
    float ndl = dot(N, L);
    float twi = smoothstep(-0.2, 0.05, ndl) * (1.0 - smoothstep(0.05, 0.35, ndl));
    vec3 col = vec3(1.0) * (max(ndl, 0.0) * 1.25 + 0.008);
    col *= mix(vec3(1.0), vec3(1.0, 0.6, 0.4), twi);
    a *= smoothstep(0.0, 0.18, dot(N, V));
    gl_FragColor = vec4(col, a * reveal);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const ATMO_FS = /* glsl */`
  uniform vec3 sunDir; varying vec3 vP;
  void main() {
    vec3 D = normalize(vP - cameraPosition), L = normalize(sunDir);
    vec3 T = cameraPosition + D * dot(-cameraPosition, D);                   // ray's closest approach to the centre
    float b = length(T);
    if (b < 0.999) discard;
    float dens = 0.95 * exp(-(b - 1.0) / 0.011) + 0.3 * exp(-(b - 1.0) / 0.042);
    dens *= 1.0 - smoothstep(1.075, 1.095, b);
    float mu = dot(normalize(T), L);
    float lit = smoothstep(-0.32, 0.28, mu);
    float twi = smoothstep(-0.35, -0.02, mu) * (1.0 - smoothstep(-0.02, 0.3, mu));
    float fwd = pow(max(dot(D, L), 0.0), 10.0);
    vec3 col = vec3(0.30, 0.58, 1.0) * lit * 1.2 + vec3(1.0, 0.45, 0.18) * twi * 0.85 + vec3(1.0, 0.82, 0.62) * fwd * 3.0 * smoothstep(-0.25, 0.1, mu);
    gl_FragColor = vec4(col * dens, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const LINE_VS = /* glsl */`
  uniform vec3 sunDir; varying float vDiff;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vDiff = max(dot(normalize(w.xyz), normalize(sunDir)), 0.0); gl_Position = projectionMatrix * viewMatrix * w; }`;
const LINE_FS = /* glsl */`
  uniform vec3 color; uniform float opacity, reveal, lit; varying float vDiff;
  void main() {
    gl_FragColor = vec4(color * mix(1.0, 0.25 + 0.6 * vDiff, lit), opacity * reveal);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const STAR_VS = /* glsl */`
  attribute float size; attribute float phase; attribute vec3 tint; uniform float time, pr; varying vec3 vC; varying float vA;
  void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * pr;
    vA = 0.8 + 0.2 * sin(time * (0.4 + phase * 1.2) + phase * 37.0); vC = tint; }`;
const STAR_FS = /* glsl */`varying vec3 vC; varying float vA; void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a; gl_FragColor = vec4(vC * vA * a, 1.0); }`;

/* ------------------------------------------------------------------ content */
const PLACES = [ // [lat, lon, name, what]
  [41.8, -92.5, 'US Corn Belt', 'maize & soybeans'],
  [36.6, -120.1, 'Central Valley, California', 'fruit, nuts & vegetables'],
  [-12.8, -55.8, 'Mato Grosso, Brazil', 'soybeans & maize'],
  [-34.4, -61.3, 'Argentine Pampas', 'wheat, soy & beef'],
  [48.8, 33.0, 'Ukraine', 'wheat, maize & sunflower'],
  [51.8, 44.5, 'Volga region, Russia', 'wheat'],
  [36.8, -2.4, 'Almería, Spain', 'greenhouse vegetables'],
  [52.0, 4.3, 'Westland, Netherlands', 'greenhouse horticulture'],
  [30.8, 31.0, 'Nile Delta', 'irrigated farming'],
  [9.1, 7.5, 'Nigeria', 'cassava, yams & maize'],
  [30.6, 75.3, 'Punjab', 'wheat & rice'],
  [35.2, 115.6, 'North China Plain', 'wheat & maize'],
  [10.2, 105.7, 'Mekong Delta', 'rice'],
  [-32.2, 117.6, 'Western Australia', 'wheat & barley']
];
const FACTS = [
  ['Croplands cover about 12 % of the world\'s ice-free land, pastures another 22 %.', 'Ramankutty et al., 2008'],
  ['About half of all habitable land is used for agriculture.', 'FAO data via Our World in Data'],
  ['Agriculture takes roughly 70 % of all freshwater withdrawals.', 'FAO AQUASTAT'],
  ['Food systems cause about one-third of global greenhouse-gas emissions.', 'Crippa et al., 2021'],
  ['Around 13 % of food is lost after harvest and 19 % wasted in shops and homes.', 'FAO 2019 · UNEP 2024'],
  ['The world is expected to have about 9.7 billion people by 2050.', 'UN World Population Prospects 2024'],
  ['Click any country to see how it eats and farms.', 'Food supply, yields, land, fertiliser, jobs']
];

/* number formatting for the statistics card */
function fmtVal(m, v) {
  if (v == null) return '—';
  if (m.key === 'pop') return v >= 1e9 ? (v / 1e9).toFixed(2) + ' billion' : v >= 1e6 ? (v / 1e6).toFixed(v >= 1e8 ? 0 : 1) + ' million' : Math.round(v).toLocaleString('en-GB');
  if (m.key === 'undernour' && v <= 2.5) return '< 2.5';
  return v.toLocaleString('en-GB', { minimumFractionDigits: m.digits, maximumFractionDigits: m.digits });
}
const UNIT_SHORT = { kcal: 'kcal / person / day', protein: 'g / person / day', undernour: '% of people', dietUnaff: '% of people', dietCost: 'PPP $ / person / day', cerealYield: 't / ha', agLand: '% of land area', arablePc: 'ha / person', nFert: 'kg N / ha cropland', meat: 'kg / person / year', veg: 'kg / person / year', agJobs: '% of employment' };

export function initHero(el) {
  const stage = createStage(el, {
    background: '#000000', environment: 'none', exposure: 1.0,
    camera: { pos: [0, 0.8, 6.4], target: [0, 0, 0], fov: 30, near: 0.01, far: 3000 },
    controls: { enableZoom: false, enablePan: false, enableRotate: false, minDistance: 0, maxDistance: 1e6, maxPolarAngle: Math.PI },
    bloom: { strength: 0.7, radius: 0.55, threshold: 1.08 }, ao: false, shadows: false,
    toolbar: false, hint: null, labels: true, quality: 'auto'
  });
  el.classList.remove('stage');
  const { scene, camera, renderer } = stage;
  stage.controls.enabled = false;
  const hero = el.parentElement;
  const small = () => el.clientWidth < 760;

  const L = new THREE.Vector3(0.55, 0.32, 0.77).normalize();                 // Sun ahead-right of the viewer: mostly day side
  const common = { sunDir: { value: L }, cloudShift: { value: 0 }, reveal: { value: 0 }, time: { value: 0 }, cropReveal: { value: 0 } };

  /* Earth (tilted 23.44°, turned north-up while a country is shown or the view is zoomed in), clouds and atmosphere */
  const tilt = new THREE.Group(); tilt.rotation.z = TILT; scene.add(tilt);
  const AX_Y = new THREE.Vector3(0, 1, 0), AX_Z = new THREE.Vector3(0, 0, 1);
  const earth = new THREE.Group(); tilt.add(earth);
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blank.needsUpdate = true;
  const eu = Object.assign({ dayMap: { value: blank }, nightMap: { value: blank }, cloudMap: { value: blank }, waterMap: { value: blank }, cropMap: { value: blank }, idMap: { value: blank }, idReady: { value: 0 }, selId: { value: -1 }, hovId: { value: -1 } }, common);
  earth.add(new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), new THREE.ShaderMaterial({ uniforms: eu, vertexShader: EARTH_VS, fragmentShader: EARTH_FS })));
  const cloudU = { cloudMap: eu.cloudMap, sunDir: common.sunDir, cloudShift: common.cloudShift, reveal: common.reveal, clear: { value: 0 } };
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.007, 192, 96), new THREE.ShaderMaterial({ uniforms: cloudU, vertexShader: EARTH_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false }));
  clouds.renderOrder = 1; earth.add(clouds);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.095, 128, 64), new THREE.ShaderMaterial({ uniforms: { sunDir: common.sunDir }, vertexShader: EARTH_VS, fragmentShader: ATMO_FS, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  atmo.renderOrder = 2; scene.add(atmo);

  const T0 = +(new URLSearchParams(location.search).get('herot') || 0);      // ?herot=90: start 90 s in, everything shown at once (previews)
  let revealStart = null, elapsed = 0;
  const big = Math.max(innerWidth, innerHeight) * Math.min(devicePixelRatio || 1, 2) >= 1600, sz = big ? '4k' : '2k';
  const tl = new THREE.TextureLoader(), aniso = renderer.capabilities.getMaxAnisotropy();
  const load = (name, srgb) => tl.loadAsync(TEX + name).then(t => { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso; t.wrapS = THREE.RepeatWrapping; return t; });
  let hiRes = big ? 'done' : null;                                            // smaller screens fetch the 4k maps on the first zoom-in
  Promise.all([load(`earth-day-${sz}.jpg`, true), load(`earth-night-${sz}.jpg`), load(`earth-clouds-${sz}.jpg`), load('earth-water-2k.jpg'), load(`earth-crops-${sz}.jpg`)])
    .then(([d, n, c, w, cr]) => { eu.waterMap.value = w; if (big || hiRes !== 'done') { eu.dayMap.value = d; eu.nightMap.value = n; eu.cloudMap.value = c; eu.cropMap.value = cr; } revealStart = T0 ? elapsed - 30 : elapsed; })
    .catch(e => console.warn('Earth textures unavailable', e));
  function loadHiRes() {
    if (hiRes) return; hiRes = 'loading';
    Promise.all([load('earth-day-4k.jpg', true), load('earth-night-4k.jpg'), load('earth-clouds-4k.jpg'), load('earth-crops-4k.jpg')]).then(maps => {
      [eu.dayMap, eu.nightMap, eu.cloudMap, eu.cropMap].forEach((u, k) => { if (u.value !== blank) u.value.dispose(); u.value = maps[k]; });
      hiRes = 'done';
    }).catch(() => { hiRes = null; });
  }
  // faint borders: hairlines lit like the ground (opacity rises on high-density screens, where a hairline is thinner)
  const borderMat = new THREE.ShaderMaterial({ uniforms: { sunDir: common.sunDir, reveal: common.reveal, color: { value: new THREE.Color(1.0, 0.96, 0.88) }, opacity: { value: 0.24 }, lit: { value: 1 } }, vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false });
  // the selected country: a 2-px gold outline drawn above the clouds (screen-space "fat" line, stays gold through the ACES curve)
  const outlineMat = new LineMaterial({ color: new THREE.Color(1.0, 0.62, 0.18).multiplyScalar(1.25), linewidth: 2, transparent: true, depthWrite: false });
  let outline = null;
  function setOutline(i) {
    if (outline) { earth.remove(outline); outline.geometry.dispose(); outline = null; }
    if (i < 0 || !countries[i]) return;
    outline = new LineSegments2(new LineSegmentsGeometry().setPositions(ringSegments(countries[i].p.flat(), 1.0008)), outlineMat);
    outline.renderOrder = 1.5; earth.add(outline);
  }
  let cropData = null;
  imageData(TEX + 'earth-crops-2k.jpg').then(c => { cropData = c; }).catch(() => { });

  /* countries: borders (index map for the shader) + polygons for picking; food statistics */
  let countries = [], stats = null;
  Promise.all([fetch(DATA + 'countries.json').then(r => r.json()), fetch(DATA + 'food-stats.json').then(r => r.json())]).then(([cs, st]) => {
    countries = cs; stats = st;
    const c = document.createElement('canvas'); c.width = IDW; c.height = IDH; const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, IDW, IDH);
    cs.forEach((ct, i) => {
      const id = i + 1; g.fillStyle = `rgb(${id & 255},${(id >> 8) & 255},0)`;
      ct.p.forEach(poly => { g.beginPath(); poly.forEach(r => { for (let k = 0; k < r.length; k += 2) { const x = (r[k] + 180) / 360 * IDW, y = (90 - r[k + 1]) / 180 * IDH; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); }); g.fill('evenodd'); });
    });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false;
    eu.idMap.value = t; eu.idReady.value = 1;
    // borders as real lines, crisp at every zoom, just above the ground and below the clouds
    const borders = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(ringSegments(cs.flatMap(ct => ct.p.flat()), 1.0006, new Set()), 3)), borderMat);
    borders.renderOrder = 0.5; earth.add(borders);
    const list = hero.querySelector('#country-list');
    if (list) list.innerHTML = cs.filter(x => x.c && stats.countries[x.c]).map(x => `<option value="${esc(x.n)}"></option>`).join('');
  }).catch(e => console.warn('country data unavailable', e));
  function countryAt(lat, lon) {                                               // bounding box, then even–odd point-in-polygon
    for (let i = 0; i < countries.length; i++) {
      const ct = countries[i], b = ct.b;
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      for (const poly of ct.p) {
        let inside = false;
        for (const r of poly) for (let k = 0, j = r.length - 2; k < r.length; j = k, k += 2) {
          const xi = r[k], yi = r[k + 1], xj = r[j], yj = r[j + 1];
          if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) return i;
      }
    }
    return -1;
  }

  /* breadbasket labels: fade in when a region faces the viewer (at most four at a time) */
  const labels = PLACES.map(([lat, lon, name, what]) => {
    const div = document.createElement('div'); div.className = 'geo-label';
    div.innerHTML = `<span class="gl-dot"></span><span class="gl-text"><b>${name}</b><small>${what}</small></span>`;
    const obj = new CSS2DObject(div); obj.position.copy(ll(lat, lon, 1.01)); earth.add(obj);
    return { obj, div, local: ll(lat, lon), o: 0 };
  });

  /* stars and a faint Milky Way band */
  let starMat;
  {
    const pos = [], size = [], phase = [], tint = [];
    const gal = new THREE.Vector3(0.35, 0.8, 0.48).normalize(), t1 = new THREE.Vector3(1, 0, 0).cross(gal).normalize(), t2 = gal.clone().cross(t1);
    const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    const band = (lat) => { const th = rnd() * Math.PI * 2; return t1.clone().multiplyScalar(Math.cos(th)).add(t2.clone().multiplyScalar(Math.sin(th))).multiplyScalar(Math.cos(lat)).add(gal.clone().multiplyScalar(Math.sin(lat))); };
    for (let i = 0; i < 6500; i++) {
      let v; if (i < 2600) v = band((rnd() + rnd() + rnd() - 1.5) * 0.16); else { const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u); v = new THREE.Vector3(r * Math.cos(th), u, r * Math.sin(th)); }
      v.multiplyScalar(1500); pos.push(v.x, v.y, v.z);
      const m = Math.pow(rnd(), 7); size.push(0.8 + m * 3.2); phase.push(rnd());
      const temp = rnd(), br = 0.22 + 0.7 * Math.pow(rnd(), 2) + m, c = temp < 0.15 ? [0.75, 0.85, 1.25] : temp > 0.88 ? [1.25, 1.0, 0.75] : [1, 1, 1.05];
      tint.push(c[0] * br, c[1] * br, c[2] * br);
    }
    for (let i = 0; i < 2400; i++) { const v = band((rnd() + rnd() - 1) * 0.12).multiplyScalar(1400); pos.push(v.x, v.y, v.z); size.push(26 + rnd() * 40); phase.push(0); const w = 0.01 + rnd() * 0.018, warm = rnd() < 0.5; tint.push(w * (warm ? 1.2 : 0.8), w, w * (warm ? 0.85 : 1.25)); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute('phase', new THREE.Float32BufferAttribute(phase, 1)); g.setAttribute('tint', new THREE.Float32BufferAttribute(tint, 3));
    starMat = new THREE.ShaderMaterial({ uniforms: { time: { value: 0 }, pr: { value: renderer.getPixelRatio() } }, vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    scene.add(new THREE.Points(g, starMat));
  }

  /* captions: one food-system fact at a time */
  const factsEl = hero.querySelector('.hero-facts');
  let factI = -1, factT = -99;
  function nextFact(t) { if (!factsEl) return; factI = (factI + 1) % FACTS.length; factT = t; const [txt, src] = FACTS[factI]; factsEl.classList.remove('show'); setTimeout(() => { factsEl.innerHTML = `<span>${txt}</span><small>${src}</small>`; factsEl.classList.add('show'); }, 700); }

  /* ---------------------------------------------------------------- the statistics card */
  const card = hero.querySelector('#country-card');
  let selected = -1, turn = null;
  function renderCard(i) {
    if (!card) return;
    const ct = countries[i], s = (stats && stats.countries[ct.c]) || {};
    const rows = stats.meta.filter(m => m.key !== 'pop').map(m => {
      const v = s[m.key], r = stats.ranges[m.key];
      const f = v ? THREE.MathUtils.clamp((v[0] - r.p5) / (r.p95 - r.p5), 0, 1) : null, med = THREE.MathUtils.clamp((r.p50 - r.p5) / (r.p95 - r.p5), 0, 1);
      return `<div class="cc-row"><div class="cc-l">${m.label} <small>${UNIT_SHORT[m.key] || m.unit}</small></div>
        <div class="cc-v"><span class="cc-num">${v ? fmtVal(m, v[0]) : '—'}</span><span class="cc-yr">${v ? v[1] : 'no data'}</span></div>
        <div class="cc-bar" title="Position among ${r.n} countries (5th–95th percentile); tick = median">${f != null ? `<i style="left:${(f * 100).toFixed(1)}%"></i>` : ''}<b style="left:${(med * 100).toFixed(1)}%"></b></div></div>`;
    }).join('');
    const pop = s.pop ? `${fmtVal(stats.meta[0], s.pop[0])} people (${s.pop[1]})` : '';
    card.innerHTML = `<button type="button" class="cc-close" aria-label="Close the country card">×</button>
      <div class="cc-kicker">Food system snapshot</div><h3 class="cc-name">${ct.f ? `<img class="cc-flag" src="${FLAGS}${ct.f}.svg" alt="" width="30" height="22" decoding="async">` : ''}<span>${esc(ct.n)}</span></h3>${pop ? `<div class="cc-pop">${pop}</div>` : ''}
      ${Object.keys(s).length > 1 ? `<div class="cc-rows">${rows}</div><p class="cc-note">Bars: where the country sits among all countries (5th–95th percentile); the tick marks the median.</p>`
        : '<p class="cc-note">No national food statistics are published for this area.</p>'}
      <p class="cc-src">Data: FAO, UN, World Bank &amp; ILO via <a href="https://ourworldindata.org/food-supply" target="_blank" rel="noopener">Our World in Data</a> (CC BY 4.0) · latest year available</p>`;
    card.hidden = false; requestAnimationFrame(() => card.classList.add('show'));
    card.querySelector('.cc-close').addEventListener('click', deselect);
    const flag = card.querySelector('.cc-flag');
    if (flag) flag.addEventListener('error', () => flag.remove());                // offline or blocked CDN: name only
  }
  function select(i, { turnTo = true } = {}) {
    if (i < 0 || !countries[i]) return deselect();
    selected = i; eu.selId.value = i + 1; renderCard(i); setOutline(i);
    if (probeEl) probeEl.classList.remove('show');
    if (factsEl) factsEl.classList.remove('show');
    if (turnTo) {                                                              // turn the country to face the viewer, north up (axis tilt → 0)
      const [lon, lat] = countries[i].lab, r0 = earth.rotation.y, f = facing(ll(lat, lon), 0, r0);
      turn = { t: 0, d: 1.8, r0, r1: f.r, e0: spin.userEl, e1: THREE.MathUtils.clamp(f.el - 0.22, EL_MIN, EL_MAX), th0: tilt.rotation.z, th1: 0 };
    }
  }
  // Spin r and camera elevation that bring the earth-frame direction p to the resting camera azimuth A = baseAz (the drift
  // fades out while a country is shown) for an axis tilt th. With β = α + r the world position w = Rz(th)·Ry(r)·p is
  // (ρ sinβ cos th − y sin th,  ρ sinβ sin th + y cos th,  ρ cosβ), and w.x cosA = w.z sinA gives
  // ρ (a sinβ + b cosβ) = y sin th cosA  with a = cos th cosA, b = −sinA. Null only very near a pole of a tilted Earth.
  function facing(p, th, r0) {
    const A = baseAz, al = Math.atan2(p.x, p.z), rho = Math.max(1e-6, Math.hypot(p.x, p.z)), a = Math.cos(th) * Math.cos(A), b = -Math.sin(A);
    const dl = Math.atan2(b, a), k = p.y * Math.sin(th) * Math.cos(A) / (rho * Math.hypot(a, b));
    if (Math.abs(k) > 1) return null;
    let best = null;
    for (const beta of [Math.asin(k) - dl, Math.PI - Math.asin(k) - dl]) {
      const wx = rho * Math.sin(beta) * Math.cos(th) - p.y * Math.sin(th), wy = rho * Math.sin(beta) * Math.sin(th) + p.y * Math.cos(th), wz = rho * Math.cos(beta);
      if (wx * Math.sin(A) + wz * Math.cos(A) <= 0) continue;                   // this root puts the point on the far side
      let r = beta - al; r += Math.round((r0 - r) / (Math.PI * 2)) * Math.PI * 2;
      if (!best || Math.abs(r - r0) < Math.abs(best.r - r0)) best = { r, el: Math.asin(THREE.MathUtils.clamp(wy, -1, 1)) };
    }
    return best;
  }
  function deselect() { selected = -1; eu.selId.value = -1; setOutline(-1); if (card) { card.classList.remove('show'); setTimeout(() => { if (selected < 0) card.hidden = true; }, 350); } spin.idle = 0; }
  const find = hero.querySelector('#country-find');
  if (find) {
    const go = () => { const q = find.value.trim().toLowerCase(); if (!q) return; const i = countries.findIndex(c => c.n.toLowerCase() === q) >= 0 ? countries.findIndex(c => c.n.toLowerCase() === q) : countries.findIndex(c => c.n.toLowerCase().startsWith(q)); if (i >= 0) { select(i); find.blur(); } };
    find.addEventListener('change', go); find.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  /* ---------------------------------------------------------------- interaction: drag to spin, hover to read, click to select */
  const canvas = renderer.domElement;
  canvas.style.touchAction = 'pan-y';                                          // phones: vertical swipes still scroll the page
  el.setAttribute('aria-label', 'The Earth from orbit with the world\'s cropland glowing gold. Drag or use the arrow keys to spin it, the + and − keys to zoom; press Enter to open food statistics for the country facing you, or use the country search.');
  const probeEl = hero.querySelector('.hero-probe');
  const spin = { v: 0, drag: false, x: 0, y: 0, x0: 0, y0: 0, t0: 0, last: 0, userEl: 0, idle: 99 };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), inv = new THREE.Matrix4(), hit = new THREE.Vector3();
  function pickLatLon(cx, cy) {                                                // analytic ray–sphere hit → latitude/longitude
    const r = canvas.getBoundingClientRect(); ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera); const o = ray.ray.origin, d = ray.ray.direction;
    const b = o.dot(d), c = o.dot(o) - 1, disc = b * b - c; if (disc < 0) return null;
    const t = -b - Math.sqrt(disc); if (t < 0) return null;
    hit.copy(o).addScaledVector(d, t).applyMatrix4(inv.copy(earth.matrixWorld).invert());
    const lat = 90 - Math.acos(THREE.MathUtils.clamp(hit.y, -1, 1)) / deg;
    let phi = Math.atan2(hit.z, -hit.x); if (phi < 0) phi += Math.PI * 2;
    return { lat, lon: phi / deg - 180 };
  }
  const cropAt = (lat, lon) => { if (!cropData) return null; const x = Math.min(cropData.w - 1, Math.floor((lon + 180) / 360 * cropData.w)), y = Math.min(cropData.h - 1, Math.floor((90 - lat) / 180 * cropData.h)); return cropData.d[(y * cropData.w + x) * 4] / 255; };
  function hover(e) {
    const p = spin.drag ? null : pickLatLon(e.clientX, e.clientY);
    const i = p ? countryAt(p.lat, p.lon) : -1;
    eu.hovId.value = i >= 0 ? i + 1 : -1;
    canvas.style.cursor = spin.drag ? 'grabbing' : i >= 0 ? 'pointer' : p ? 'grab' : '';
    if (!probeEl) return;
    if (!p || common.reveal.value < 0.5) { probeEl.classList.remove('show'); return; }
    const crop = cropAt(p.lat, p.lon);
    const name = i >= 0 ? countries[i].n : 'Ocean';
    const line = i < 0 ? '' : crop == null ? '' : crop < 0.02 ? 'little or no cropland here' : `cropland ≈ ${Math.round(crop * 100)} % of the land here`;
    probeEl.innerHTML = `<b>${esc(name)}</b>${line ? `<small>${line}</small>` : ''}${i >= 0 && stats && stats.countries[countries[i].c] ? '<em>Click for food statistics</em>' : ''}`;
    const hr = hero.getBoundingClientRect();
    probeEl.style.transform = `translate(${Math.round(e.clientX - hr.left + 16)}px, ${Math.round(e.clientY - hr.top + 14)}px)`;
    probeEl.classList.add('show');
  }
  /* zoom: mouse wheel or trackpad pinch, two-finger pinch, the − / + buttons and the − / + keys */
  const zoom = { v: 1, t: 1 }, zoomBtns = [...hero.querySelectorAll('.hero-zoom [data-zoom]')];
  function setZoom(z) {
    zoom.t = THREE.MathUtils.clamp(z, 1, ZMAX); spin.idle = 0; if (zoom.t > 1.4) loadHiRes();
    zoomBtns.forEach(b => b.setAttribute('aria-disabled', String(+b.dataset.zoom > 0 ? zoom.t >= ZMAX - 1e-3 : zoom.t <= 1 + 1e-3)));
  }
  zoomBtns.forEach(b => b.addEventListener('click', () => setZoom(zoom.t * Math.pow(1.6, +b.dataset.zoom))));
  setZoom(1);
  // the wheel never traps the page: each wheel gesture decides once (globe only while the page is at the top), and a fully
  // zoomed-out globe hands the wheel back to the page; Ctrl + wheel (what trackpad pinches send) always zooms the globe
  let lastScroll = -1e9; const wheel = { t: -1e9, zoom: false };
  addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true });
  canvas.addEventListener('wheel', e => {
    const now = performance.now(), dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    if (now - wheel.t > 250) wheel.zoom = scrollY < 4 && now - lastScroll > 250;
    wheel.t = now;
    if (!dy || !(wheel.zoom || e.ctrlKey)) return;
    if (!e.ctrlKey && (dy < 0 ? scrollY > 4 : zoom.t <= 1 + 1e-4)) return;
    e.preventDefault(); setZoom(zoom.t * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002)));
  }, { passive: false });
  const touches = new Map(); let pinch = null;
  const span = () => { const [a, b] = [...touches.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; };

  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size === 2) { pinch = { d: span(), z: zoom.t }; spin.drag = false; spin.v = 0; try { canvas.setPointerCapture(e.pointerId); } catch (_) { } return; }
    }
    if (!pickLatLon(e.clientX, e.clientY)) return;                            // grab only the planet
    spin.drag = true; spin.x = spin.x0 = e.clientX; spin.y = spin.y0 = e.clientY; spin.last = spin.t0 = performance.now(); spin.v = 0; turn = null;
    canvas.setPointerCapture(e.pointerId); hover(e);
  });
  canvas.addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && touches.size === 2) { setZoom(pinch.z * span() / pinch.d); return; }
    }
    if (spin.drag) {
      const now = performance.now(), dx = e.clientX - spin.x, dy = e.clientY - spin.y, h = canvas.clientHeight || 600;
      const dA = dx / h * 3.2 / zoom.v;                                        // ≈ the planet follows the hand, at any zoom
      earth.rotation.y += dA; spin.userEl = THREE.MathUtils.clamp(spin.userEl + dy / h * 1.6 / zoom.v, EL_MIN, EL_MAX);
      spin.v = dA / Math.max(0.008, (now - spin.last) / 1000); spin.x = e.clientX; spin.y = e.clientY; spin.last = now; spin.idle = 0;
    }
    hover(e);
  });
  const release = e => {
    touches.delete(e.pointerId); if (touches.size < 2) pinch = null;
    if (!spin.drag) return;
    spin.drag = false; spin.idle = 0; try { canvas.releasePointerCapture(e.pointerId); } catch (_) { }
    const moved = Math.hypot(e.clientX - spin.x0, e.clientY - spin.y0), quick = performance.now() - spin.t0 < 600;
    if (e.type === 'pointerup' && moved < 6 && quick) {                         // a click, not a drag
      spin.v = 0; const p = pickLatLon(e.clientX, e.clientY); const i = p ? countryAt(p.lat, p.lon) : -1;
      if (i >= 0 && i !== selected) { select(i, { turnTo: true }); return; } else if (i < 0) deselect();
    }
    hover(e);
  };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { eu.hovId.value = -1; if (!spin.drag && probeEl) probeEl.classList.remove('show'); });
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') { deselect(); return; }
    if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(zoom.t * (e.key === '+' || e.key === '=' ? 1.6 : 1 / 1.6)); return; }
    if (e.key === 'Enter' || e.key === ' ') {                                  // select the country facing the viewer
      e.preventDefault(); e.stopImmediatePropagation();
      const w = camera.position.clone().normalize().applyMatrix4(inv.copy(earth.matrixWorld).invert());
      const lat = 90 - Math.acos(THREE.MathUtils.clamp(w.y, -1, 1)) / deg; let phi = Math.atan2(w.z, -w.x); if (phi < 0) phi += Math.PI * 2;
      const i = countryAt(lat, phi / deg - 180); if (i >= 0) select(i, { turnTo: false }); return;
    }
    const k = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, -0.08], ArrowDown: [0, 0.08] }[e.key]; if (!k) return;
    e.preventDefault(); e.stopImmediatePropagation(); turn = null; earth.rotation.y += k[0]; spin.userEl = THREE.MathUtils.clamp(spin.userEl + k[1], EL_MIN, EL_MAX); spin.idle = 0;
  }, true);

  /* camera: an almost still, drifting shot; the lens is shifted so the Earth sits beside the headline
     (right on wide screens, lower on tall ones); the pointer adds a hint of parallax */
  const par = { x: 0, y: 0, tx: 0, ty: 0 };
  hero.addEventListener('pointermove', e => { const r = el.getBoundingClientRect(); par.tx = ((e.clientX - r.left) / r.width - 0.5) * 2; par.ty = ((e.clientY - r.top) / r.height - 0.5) * 2; });
  const baseAz = Math.atan2(L.x, L.z) - 0.95;                                 // viewer ~55° left of the Sun: day side with a sliver of night
  const tmp = new THREE.Vector3(), camDir = new THREE.Vector3(), sunRight = new THREE.Vector3(), sunUp = new THREE.Vector3();
  const smooth = x => x * x * (3 - 2 * x);
  let drift = 1;
  earth.rotation.y = ROT0 + (still ? 0 : T0 * BASE_SPIN);

  stage.onFrame((dt, t) => {
    elapsed = t;
    const T = still ? 40 : t + T0;
    common.reveal.value = revealStart === null ? 0 : smooth(Math.min(1, (t - revealStart) / 3));
    common.cropReveal.value = revealStart === null ? 0 : smooth(Math.min(1, Math.max(0, (t - revealStart - 2.5) / 4)));   // farmland glows up after the planet
    common.time.value = T;
    zoom.v = Math.exp(THREE.MathUtils.lerp(Math.log(zoom.v), Math.log(zoom.t), Math.min(1, dt * 6)));   // eased in log space
    const zoomed = zoom.t > 1.2, zf = THREE.MathUtils.clamp((1.35 - zoom.v) / 0.35, 0, 1), hold = selected >= 0 || zoomed;
    // spin: slow auto-rotation that hurries across the open Pacific; paused while a country is selected or the view
    // is zoomed in; after a drag the planet coasts, then settles back
    spin.idle += dt;
    if (turn) {
      turn.t += dt; const k = smooth(Math.min(1, turn.t / turn.d));
      earth.rotation.y = THREE.MathUtils.lerp(turn.r0, turn.r1, k); spin.userEl = THREE.MathUtils.lerp(turn.e0, turn.e1, k);
      tilt.rotation.z = THREE.MathUtils.lerp(turn.th0, turn.th1, k);
      if (turn.t >= turn.d) turn = null; spin.v = 0;
    } else if (!spin.drag) {
      // north up while a country is shown or the view is zoomed in, the real axial tilt otherwise; the change plays as a
      // roll about the screen centre: the point under the camera is solved back to the centre every frame
      const thT = hold ? 0 : TILT;
      if (Math.abs(tilt.rotation.z - thT) > 1e-5) {
        const e = 0.22 + spin.userEl;
        const pc = tmp.set(Math.cos(e) * Math.sin(baseAz), Math.sin(e), Math.cos(e) * Math.cos(baseAz)).applyAxisAngle(AX_Z, -tilt.rotation.z).applyAxisAngle(AX_Y, -earth.rotation.y);
        tilt.rotation.z += (thT - tilt.rotation.z) * Math.min(1, dt * 1.6); if (Math.abs(tilt.rotation.z - thT) < 1e-5) tilt.rotation.z = thT;
        const f = facing(pc, tilt.rotation.z, earth.rotation.y);
        if (f) { earth.rotation.y = f.r; spin.userEl = THREE.MathUtils.clamp(f.el - 0.22, EL_MIN, EL_MAX); }
      }
      const faceLon = ((-(earth.rotation.y - ROT0) / deg + 20) % 360 + 540) % 360 - 180;
      const pacific = Math.exp(-Math.pow(((faceLon + 150 + 540) % 360 - 180) / 38, 2));
      const auto = still || selected >= 0 ? 0 : BASE_SPIN * (1 + 1.8 * pacific) * zf;
      spin.v += (auto - spin.v) * Math.min(1, dt * 0.8); earth.rotation.y += spin.v * dt;
      if (spin.idle > 6 && selected < 0 && !zoomed) spin.userEl *= Math.exp(-dt / 6);   // tilt eases back after a while
    }
    drift += ((hold ? 0 : 1) - drift) * Math.min(1, dt * 0.8);                 // the camera holds still while a country is shown or zoomed
    cloudU.clear.value += ((hold ? 1 : 0) - cloudU.clear.value) * Math.min(1, dt * 1.5);   // …and the clouds thin out
    common.cloudShift.value = T * 0.00035;
    starMat.uniforms.time.value = T; starMat.uniforms.pr.value = renderer.getPixelRatio();
    // camera drift (incommensurate periods, so it never quite repeats)
    par.x += (par.tx - par.x) * Math.min(1, dt * 1.2); par.y += (par.ty - par.y) * Math.min(1, dt * 1.2);
    const intro = still || T0 ? 1 : smooth(Math.min(1, t / 12));
    const az = baseAz + drift * (0.2 * Math.sin(T * 2 * Math.PI / 97) + 0.05 * Math.sin(T * 2 * Math.PI / 41 + 1.3) + par.x * 0.03);
    const elv = THREE.MathUtils.clamp(0.22 + drift * (0.08 * Math.sin(T * 2 * Math.PI / 131 + 0.4) - par.y * 0.02) + spin.userEl, EL_MIN + 0.2, EL_MAX + 0.24);
    const d = 1 + (THREE.MathUtils.lerp(5.6, 4.35 + drift * 0.12 * Math.sin(T * 2 * Math.PI / 113 + 2), intro) - 1) / zoom.v;   // zoom shrinks the height above the surface
    camera.position.set(d * Math.cos(elv) * Math.sin(az), d * Math.sin(elv), d * Math.cos(elv) * Math.cos(az));
    camera.up.set(drift * 0.03 * Math.sin(T * 2 * Math.PI / 157), 1, 0).normalize();
    camera.lookAt(0, 0, 0); stage.controls.target.set(0, 0, 0);
    const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1, land = W / H > 1.15;
    camera.setViewOffset(W, H, land ? -0.19 * W : 0, land ? -0.02 * H : -0.2 * H, W, H);
    outlineMat.resolution.set(W, H);                                           // line width in CSS pixels
    borderMat.uniforms.opacity.value = 0.24 * Math.pow(THREE.MathUtils.clamp(renderer.getPixelRatio(), 1, 2), 0.7);
    camDir.copy(camera.position).normalize();
    sunRight.crossVectors(camera.up, camDir).normalize(); sunUp.crossVectors(camDir, sunRight).normalize();
    L.copy(camDir).multiplyScalar(Math.cos(0.95)).addScaledVector(sunRight, Math.sin(0.95)).multiplyScalar(Math.cos(0.3)).addScaledVector(sunUp, Math.sin(0.3)).normalize();
    // labels: fade by how squarely the region faces the viewer; keep the four best; hidden while a country is shown
    earth.updateMatrixWorld();
    const scores = labels.map((lb, i) => { tmp.copy(lb.local).applyMatrix4(earth.matrixWorld).normalize(); return [tmp.dot(camDir), i]; }).sort((a, b) => b[0] - a[0]);
    const show = new Set(scores.filter(([f]) => f > 0.55).slice(0, 4).map(([, i]) => i));
    labels.forEach((lb, i) => {
      const target = !small() && !spin.drag && selected < 0 && common.cropReveal.value > 0.5 && show.has(i) ? 1 : 0;
      lb.o += (target - lb.o) * Math.min(1, dt * (target ? 0.9 : 2.5));
      lb.obj.visible = lb.o > 0.02; lb.div.style.opacity = lb.o.toFixed(3);
    });
    if (factsEl && selected < 0 && common.cropReveal.value > 0.6 && T - factT > 9) nextFact(T);
  });
  return stage;
}
