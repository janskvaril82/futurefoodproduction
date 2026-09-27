/* The agricultural Earth — photoreal globe with FAOSTAT data columns and a land-budget explorer.
   Sun position (Derive tab, Eqs. G1–G4): Spencer (1971) declination and equation of time → subsolar point →
   sun direction in Earth-fixed coordinates; day/night terminator where n·s = 0 with a twilight band.
   Columns: height ∝ value (linear), per-person option; land budget from FAO/OWID and Poore & Nemecek (2018). */
import { createStage, THREE } from '/assets/js/lab3d.js';
import { Controls, Readouts, fmt, hudChips, SimClock } from '/assets/js/ui.js';
import { BarChart, Plot } from '/assets/js/plot.js';
import { palette, withAlpha } from '/assets/js/colors.js';
import { dayLength } from '/assets/js/physics.js';
import { COUNTRIES, WORLD } from './data.js';

const TEX = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/textures/planets/';
const D2R = Math.PI / 180;

/* ------------------------------------------------------------ astronomy (Spencer 1971) */
function sunPosition(doy, hourUTC) {
  const B = 2 * Math.PI * (doy - 1) / 365;
  const decl = 0.006918 - 0.399912 * Math.cos(B) + 0.070257 * Math.sin(B) - 0.006758 * Math.cos(2 * B) + 0.000907 * Math.sin(2 * B) - 0.002697 * Math.cos(3 * B) + 0.00148 * Math.sin(3 * B);
  const eot = 229.2 * (0.000075 + 0.001868 * Math.cos(B) - 0.032077 * Math.sin(B) - 0.014615 * Math.cos(2 * B) - 0.04089 * Math.sin(2 * B));   // minutes
  let lon = -15 * (hourUTC - 12 + eot / 60);
  lon = ((lon + 540) % 360) - 180;
  return { lat: decl / D2R, lon, eot, decl };
}
/** Earth-fixed unit vector for latitude/longitude (degrees). Matches THREE.SphereGeometry texture mapping. */
function ll2v(lat, lon, r = 1, out = new THREE.Vector3()) {
  const la = lat * D2R, lo = lon * D2R;
  return out.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function doyToDate(doy) { const d = new Date(Date.UTC(2026, 0, 1) + (doy - 1) * 864e5); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; }
const hhmm = h => { const H = Math.floor(h + 1e-6) % 24, M = Math.round((h - Math.floor(h + 1e-6)) * 60) % 60; return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`; };

/* ------------------------------------------------------------ data layers */
const LAYERS = {
  crop: { name: 'Cropland area', unit: 'Mha', dig: 1, v: r => r.crop, pc: { v: r => r.crop * 1e4 / r.pop, unit: 'm² per person', dig: 0 }, world: WORLD.crop, wpc: WORLD.crop * 1e4 / WORLD.pop, year: r => r.year, src: 'FAOSTAT land use', stops: ['#5a3515', '#a9772e', '#e3b53f', '#fff1a3'] },
  pasture: { name: 'Permanent meadows and pastures', unit: 'Mha', dig: 1, v: r => r.pasture, pc: { v: r => r.pasture * 1e4 / r.pop, unit: 'm² per person', dig: 0 }, world: WORLD.pasture, wpc: WORLD.pasture * 1e4 / WORLD.pop, year: r => r.year, src: 'FAOSTAT land use', stops: ['#1c4424', '#3f8a45', '#8fd06a', '#e8ffbb'] },
  pop: { name: 'Population', unit: 'million', dig: 0, v: r => r.pop, pc: null, world: WORLD.pop, year: r => r.year, src: 'UN World Population Prospects 2024', stops: ['#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'] },
  cereal: { name: 'Cereal production', unit: 'Mt yr⁻¹', dig: 1, v: r => r.cereal, pc: { v: r => r.cereal * 1000 / r.kcalPop, unit: 'kg per person yr⁻¹', dig: 0 }, world: WORLD.cereal, wpc: WORLD.cereal * 1000 / WORLD.kcalPop, year: r => r.cerealYear, src: 'FAOSTAT crops', stops: ['#6e3d0c', '#c98f1c', '#ffd84d', '#fff8d6'] },
  kcal: { name: 'Food energy supply', unit: 'Tcal d⁻¹', dig: 2, v: r => r.kcal * r.kcalPop / 1e6, pc: { v: r => r.kcal, unit: 'kcal per person d⁻¹', dig: 0 }, world: WORLD.kcal * WORLD.kcalPop / 1e6, wpc: WORLD.kcal, year: r => r.kcalYear, src: 'FAOSTAT food balances', stops: ['#0b2f5a', '#1c6fb0', '#43b8f0', '#c2f0ff'] },
  yield: { name: 'Cereal yield', unit: 't ha⁻¹', dig: 2, v: r => r.yield, pc: null, world: WORLD.yield, year: r => r.yieldYear, src: 'FAOSTAT crops', stops: ['#440154', '#31688e', '#35b779', '#fde725'] }
};
function layerVal(key, perCap, r) { const L = LAYERS[key]; return perCap && L.pc ? L.pc.v(r) : L.v(r); }
function stopColour(stops, t, out = new THREE.Color()) {
  t = Math.min(1, Math.max(0, t)); const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x));
  return out.set(stops[i]).lerp(new THREE.Color(stops[i + 1]), x - i);
}

/* ------------------------------------------------------------ UI */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'total', label: 'Total of the 40 countries', unit: '', digits: 1, note: '&nbsp;', format: v => v })
  .add({ id: 'top', label: 'Largest column', unit: '', note: '&nbsp;', format: v => v })
  .add({ id: 'sel', label: 'Selected country', unit: '', note: 'click a column', format: v => v })
  .add({ id: 'world', label: 'World (FAOSTAT / UN)', unit: '', note: '&nbsp;', format: v => v })
  .add({ id: 'sub', label: 'Sun overhead at', unit: '', note: '&nbsp;', format: v => v })
  .add({ id: 'daylen', label: 'Day length in Västerås (59.6° N)', unit: 'h', digits: 1, note: '&nbsp;' });

ui.section('Data layer');
ui.select({ id: 'layer', label: 'Columns show', options: Object.entries(LAYERS).map(([value, L]) => ({ value, label: L.name })), value: 'crop' });
ui.toggle({ id: 'perCap', label: 'Per person', value: false, help: 'Divide by population (not available for population and yield).' });
ui.slider({ id: 'hscale', label: 'Column height', min: 0.3, max: 2.5, step: 0.05, value: 1, unit: '×', help: 'Heights are proportional to the value; the tallest column is half an Earth radius at 1×.' });
ui.section('Sun and time (UTC)');
ui.slider({ id: 'doy', label: 'Date', min: 1, max: 365, step: 1, value: 265, format: v => doyToDate(Math.round(v)), help: 'Day of the year sets the solar declination (the season).' });
ui.slider({ id: 'hour', label: 'Time of day', min: 0, max: 24, step: 0.25, value: 16.5, format: v => hhmm(v) + ' UTC', help: 'Universal time sets where the sun is overhead; Swedish summer time is UTC+2.' });
const clock = new SimClock({ speed: 3600 * 1.5, onStep: dt => { let h = ui.get('hour') + dt / 3600, d = ui.get('doy'); if (h >= 24) { h -= 24; d = d % 365 + 1; ui.set('doy', d, true); } ui.set('hour', h, true); }, onFrame: () => updateSun() });
ui.buttons([
  { label: '▶ Play the day', onClick: () => { clock.toggle(); } },
  { label: 'Now', onClick: () => { const n = new Date(); const s = Date.UTC(n.getUTCFullYear(), 0, 1); ui.setMany({ doy: Math.min(365, Math.floor((n - s) / 864e5) + 1), hour: n.getUTCHours() + n.getUTCMinutes() / 60 }); } }
]);
const playBtn = ctlPlayButton();
function ctlPlayButton() { return [...document.querySelectorAll('#controls button')].find(b => b.textContent.includes('Play')); }
clock.onState(run => { if (playBtn) playBtn.innerHTML = run ? '❚❚ Pause' : '▶ Play the day'; });
ui.section('Display');
ui.toggle({ id: 'clouds', label: 'Clouds', value: true });
ui.toggle({ id: 'lights', label: 'City lights on the night side', value: true });
ui.toggle({ id: 'atmo', label: 'Atmosphere', value: true });
ui.toggle({ id: 'labels', label: 'Labels on the tallest columns', value: true });
ui.toggle({ id: 'spin', label: 'Slowly orbit the globe', value: true });
const VIEWS = {
  europe: { cam: [52, 12, 2.9] }, asia: { cam: [25, 90, 3.0] }, americas: { cam: [10, -80, 3.1] }, arctic: { cam: [72, 20, 3.0] }, africa: { cam: [5, 20, 3.0] }, oceania: { cam: [-25, 140, 3.0] }
};
function flyToLatLon(lat, lon, dist = 3) { const p = ll2v(lat, lon, dist); stage.flyTo(p, [0, 0, 0], 1.6); }
ui.presets([
  { label: 'Equinox dusk over Europe', values: { doy: 265, hour: 17.5, layer: 'crop', perCap: false }, onApply: () => flyToLatLon(...VIEWS.europe.cam) },
  { label: 'Midnight in India', values: { doy: 172, hour: 18.5, layer: 'pop', perCap: false }, onApply: () => flyToLatLon(...VIEWS.asia.cam) },
  { label: 'Noon over the Americas', values: { doy: 355, hour: 17, layer: 'pasture', perCap: false }, onApply: () => flyToLatLon(...VIEWS.americas.cam) },
  { label: 'Midnight sun in Sweden', values: { doy: 172, hour: 22, layer: 'yield', perCap: false }, onApply: () => flyToLatLon(...VIEWS.arctic.cam) },
  { label: 'Pastoral giants', values: { doy: 80, hour: 4, layer: 'pasture', perCap: true }, onApply: () => flyToLatLon(-10, 120, 3.4) }
], 'Views');
ui.saveButton('earth-food-globe', () => ro.values());

/* ------------------------------------------------------------ stage */
const stage = createStage('#stage', {
  background: '#010208', environment: 'none', exposure: 1.0, shadows: false, ao: false,
  camera: { pos: ll2v(16, 4, 3.05).toArray(), target: [0, 0, 0], fov: 38, near: 0.01, far: 300 },
  controls: { minDistance: 1.35, maxDistance: 9, maxPolarAngle: Math.PI, minPolarAngle: 0, enablePan: false, rotateSpeed: 0.55, zoomSpeed: 0.7 },
  bloom: { strength: 0.75, radius: 0.55, threshold: 1.0 },
  hint: 'Drag to turn · scroll to zoom · click a column'
});
const { scene, renderer, camera, controls } = stage;
{ // portrait (phone) stages: back the camera off so that the whole globe fits the narrow field of view
  const a = stage.el.clientWidth / Math.max(1, stage.el.clientHeight);
  if (a > 0 && a < 1.05) { const need = 1.32 / (Math.tan(19 * D2R) * a); if (need > camera.position.length()) { camera.position.setLength(need); stage.setHome(camera.position.toArray(), [0, 0, 0]); } }
}
const hud = hudChips(stage.el);
const legendEl = document.createElement('div'); legendEl.className = 'stage-legend'; stage.el.appendChild(legendEl);
const card = document.createElement('div'); card.className = 'eg-card'; stage.el.appendChild(card);
const maxAniso = renderer.capabilities.getMaxAnisotropy();

/* starfield with a Milky Way band */
(function stars() {
  const N = 7000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  let s = 12345; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const tilt = new THREE.Matrix4().makeRotationX(1.05).multiply(new THREE.Matrix4().makeRotationZ(0.5)), v = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const band = i > N * 0.45;
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2;
    let y = band ? (rnd() + rnd() + rnd() - 1.5) * 0.12 : u; const r = Math.sqrt(Math.max(0, 1 - y * y));
    v.set(r * Math.cos(th), y, r * Math.sin(th)); if (band) v.applyMatrix4(tilt); v.multiplyScalar(160);
    pos.set([v.x, v.y, v.z], i * 3);
    const b = band ? 0.18 + rnd() * 0.35 : Math.pow(rnd(), 3.2) * 1.6 + 0.1; const t = rnd();
    c.setRGB(0.8 + 0.2 * t, 0.82 + 0.1 * t, 1.0 - 0.25 * t).multiplyScalar(b); col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
})();

/* Earth */
const U = {
  dayMap: { value: null }, nightMap: { value: null }, brcMap: { value: null }, sunDir: { value: new THREE.Vector3(1, 0, 0) },
  cloudOffset: { value: 0 }, showNight: { value: 1 }, showClouds: { value: 1 }, atmo: { value: 1 }, ready: { value: 0 }
};
const earthVS = /* glsl */`
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main() { vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const earthFS = /* glsl */`
  uniform sampler2D dayMap, nightMap, brcMap; uniform vec3 sunDir; uniform float cloudOffset, showNight, showClouds, atmo, ready;
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main() {
    vec3 N = normalize(vN), V = normalize(cameraPosition - vP), L = normalize(sunDir);
    vec4 brc = texture2D(brcMap, vUv);
    // bump mapping from the elevation channel (screen-space derivatives, as in three.js perturbNormalArb)
    vec3 sx = normalize(dFdx(vP)), sy = normalize(dFdy(vP));
    float hgt = brc.r * 0.045;
    float dhx = dFdx(hgt), dhy = dFdy(hgt);
    vec3 r1 = cross(sy, N), r2 = cross(N, sx); float det = dot(sx, r1);
    vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
    vec3 Nb = ready > 0.5 ? normalize(abs(det) * N - grad) : N;
    float sunO = dot(N, L);
    float dayMix = smoothstep(-0.20, 0.35, sunO);
    vec3 day = ready > 0.5 ? texture2D(dayMap, vUv).rgb : vec3(0.02, 0.06, 0.14);
    float cloudShadow = showClouds * smoothstep(0.2, 1.0, texture2D(brcMap, vUv + vec2(cloudOffset - 0.0012, 0.0006)).b);
    vec3 sun = vec3(1.0, 0.975, 0.94) * 2.3;
    float lam = max(dot(Nb, L), 0.0) * smoothstep(-0.08, 0.12, sunO);
    vec3 col = day * sun * lam * (1.0 - 0.55 * cloudShadow) + day * 0.006;
    // sun glint on water (roughness channel: oceans are smooth)
    float rough = clamp(brc.g, 0.05, 1.0);
    vec3 H = normalize(L + V); float shin = mix(6.0, 260.0, pow(1.0 - rough, 2.0));
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
    float spec = pow(max(dot(Nb, H), 0.0), shin) * (shin + 8.0) / 25.0 * pow(1.0 - rough, 2.0) * (0.05 + F) * smoothstep(0.0, 0.25, sunO) * (1.0 - cloudShadow);
    col += vec3(1.0, 0.88, 0.74) * spec * 0.55;
    // city lights on the night side
    vec3 night = ready > 0.5 ? texture2D(nightMap, vUv).rgb : vec3(0.0);
    col += night * vec3(1.0, 0.82, 0.6) * (1.0 - dayMix) * 2.6 * showNight * (1.0 - 0.6 * cloudShadow);
    // Rayleigh-coloured haze towards the limb, orange at the terminator
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.2);
    float aDay = smoothstep(-0.25, 0.75, sunO);
    vec3 atmoCol = mix(vec3(0.74, 0.29, 0.04), vec3(0.30, 0.70, 1.0), aDay);
    col = mix(col, atmoCol * 1.1 * smoothstep(-0.3, 0.6, sunO), fres * atmo * 0.85);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const earthMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: earthVS, fragmentShader: earthFS });
const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), earthMat);
scene.add(earth);
/* clouds */
const cloudMat = new THREE.ShaderMaterial({
  uniforms: U, transparent: true, depthWrite: false,
  vertexShader: earthVS,
  fragmentShader: /* glsl */`
    uniform sampler2D brcMap; uniform vec3 sunDir; uniform float cloudOffset, showClouds, ready;
    varying vec2 vUv; varying vec3 vN; varying vec3 vP;
    void main() {
      if (ready < 0.5) discard;
      vec3 N = normalize(vN), L = normalize(sunDir);
      float a = smoothstep(0.18, 1.0, texture2D(brcMap, vUv + vec2(cloudOffset, 0.0)).b);
      float sunO = dot(N, L);
      float lit = smoothstep(-0.12, 0.35, sunO);
      vec3 c = mix(vec3(1.0, 0.55, 0.3), vec3(1.0), smoothstep(0.0, 0.3, sunO)) * (0.03 + 2.1 * max(sunO, 0.0) * lit + 0.25 * lit);
      gl_FragColor = vec4(c, a * showClouds * (0.12 + 0.88 * lit));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
});
const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.007, 160, 80), cloudMat); clouds.renderOrder = 2; scene.add(clouds);
/* atmosphere shell (back faces, fades outward) */
const atmoMat = new THREE.ShaderMaterial({
  uniforms: U, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: earthVS,
  fragmentShader: /* glsl */`
    uniform vec3 sunDir; uniform float atmo;
    varying vec2 vUv; varying vec3 vN; varying vec3 vP;
    void main() {
      vec3 N = normalize(vN), V = normalize(vP - cameraPosition), L = normalize(sunDir);
      float fres = 1.0 - abs(dot(V, N));
      float a = 1.0 - clamp((fres - 0.73) / 0.27, 0.0, 1.0); a = pow(a, 3.0);
      float sunO = dot(N, L);
      a *= smoothstep(-0.28, 0.9, sunO);
      vec3 col = mix(vec3(0.74, 0.29, 0.04), vec3(0.30, 0.70, 1.0), smoothstep(-0.25, 0.75, sunO));
      gl_FragColor = vec4(col * a * 1.4 * atmo, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
});
const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.045, 96, 48), atmoMat); atmosphere.renderOrder = 3; scene.add(atmosphere);
/* sun: directional light for the columns + a glare sprite */
const sunLight = new THREE.DirectionalLight(0xfff3e6, 2.6); scene.add(sunLight, sunLight.target);
scene.add(new THREE.AmbientLight(0x6f86b8, 0.22));
const glareTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); const g = x.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.08, 'rgba(255,245,225,.9)'); g.addColorStop(0.25, 'rgba(255,220,170,.25)'); g.addColorStop(1, 'rgba(255,200,150,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c); })();
const glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glareTex, color: new THREE.Color(3, 2.8, 2.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
glare.scale.setScalar(26); scene.add(glare);

/* textures (three.js example assets on jsDelivr: Solar System Scope maps, CC BY 4.0) */
const loadChip = document.createElement('div'); loadChip.className = 'eg-loading'; loadChip.textContent = 'Loading Earth textures…'; stage.el.appendChild(loadChip);
const manager = new THREE.LoadingManager();
manager.onProgress = (url, n, total) => { loadChip.textContent = `Loading Earth textures… ${n}/${total}`; };
manager.onLoad = () => { U.ready.value = 1; loadChip.remove(); };
manager.onError = url => { loadChip.textContent = 'Could not load the Earth textures (offline?). The data columns still work.'; };
const loader = new THREE.TextureLoader(manager);
const tex = (f, srgb) => { const t = loader.load(TEX + f); t.anisotropy = Math.min(8, maxAniso); t.wrapS = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
U.dayMap.value = tex('earth_day_4096.jpg', true);
U.nightMap.value = tex('earth_night_4096.jpg', true);
U.brcMap.value = tex('earth_bump_roughness_clouds_4096.jpg', false);

/* data columns */
const NC = COUNTRIES.length;
const colGeo = new THREE.CylinderGeometry(1, 1, 1, 18, 1, false); colGeo.translate(0, 0.5, 0);
const colMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.15, color: 0xffffff });
const glowU = { value: 0.55 };
colMat.onBeforeCompile = sh => { sh.uniforms.uGlow = glowU; sh.fragmentShader = 'uniform float uGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance += vColor.rgb * uGlow;\n#endif'); };
const columns = new THREE.InstancedMesh(colGeo, colMat, NC); columns.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
const capGeo = new THREE.CircleGeometry(1, 24); capGeo.rotateX(-Math.PI / 2);
const capMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.95 });
const caps = new THREE.InstancedMesh(capGeo, capMat, NC);
const baseGeo = new THREE.RingGeometry(1.2, 2.6, 32); baseGeo.rotateX(-Math.PI / 2);
const bases = new THREE.InstancedMesh(baseGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }), NC);
scene.add(columns, caps, bases);
const colState = COUNTRIES.map((r, i) => ({ r, i, n: ll2v(r.lat, r.lon), h: 0, ht: 0, col: new THREE.Color(0x888888), colT: new THREE.Color(0x888888), label: null }));
const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), tmpC = new THREE.Color();
colState.forEach(s => { s.q = new THREE.Quaternion().setFromUnitVectors(up, s.n); });
const RCOL = 0.0105;
let selected = null, hovered = null;
function writeInstances() {
  colState.forEach((s, i) => {
    const h = Math.max(0.0005, s.h), sel = s === selected, hov = s === hovered;
    const w = RCOL * (sel ? 1.35 : hov ? 1.2 : 1);
    pv.copy(s.n).multiplyScalar(1.0015); sv.set(w, h, w); m4.compose(pv, s.q, sv); columns.setMatrixAt(i, m4);
    pv.copy(s.n).multiplyScalar(1.0015 + h + 0.0004); sv.set(w * 1.02, 1, w * 1.02); m4.compose(pv, s.q, sv); caps.setMatrixAt(i, m4);
    pv.copy(s.n).multiplyScalar(1.0012); const bw = RCOL * (sel ? 1.6 : 0.85); sv.set(bw, 1, bw); m4.compose(pv, s.q, sv); bases.setMatrixAt(i, m4);
    tmpC.copy(s.col); if (sel) tmpC.lerp(new THREE.Color(1, 1, 1), 0.35);
    columns.setColorAt(i, tmpC);
    caps.setColorAt(i, tmpC.clone().multiplyScalar(sel ? 2.2 : 1.35));
    bases.setColorAt(i, tmpC);
  });
  [columns, caps, bases].forEach(m => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.boundingSphere = null; m.boundingBox = null; });
}
[columns, caps, bases].forEach(m => { m.frustumCulled = false; });
/* labels (CSS2D) with back-side occlusion */
colState.forEach(s => { s.label = stage.addLabel([0, 0, 0], '', { className: 'label3d eg-lab' }); s.label.visible = false; });
const camDir = new THREE.Vector3();
function updateLabels() {
  const p = ui.values(); camDir.copy(camera.position).normalize();
  const order = [...colState].sort((a, b) => b.val - a.val);
  const top = new Set(p.labels ? order.slice(0, 7) : []);
  if (selected) top.add(selected); if (hovered) top.add(hovered);
  colState.forEach(s => {
    const facing = s.n.dot(camDir);
    const show = top.has(s) && facing > 0.18;
    s.label.visible = show; s.label.element.style.display = show ? '' : 'none';
    if (show) { s.label.position.copy(s.n).multiplyScalar(1.0015 + s.h + 0.03); s.label.element.style.opacity = Math.min(1, (facing - 0.18) * 5).toFixed(2); }
  });
}

/* sun + time */
const sunV = new THREE.Vector3();
function updateSun() {
  const p = ui.values(), sp = sunPosition(p.doy, p.hour);
  ll2v(sp.lat, sp.lon, 1, sunV); U.sunDir.value.copy(sunV);
  sunLight.position.copy(sunV).multiplyScalar(10); glare.position.copy(sunV).multiplyScalar(120);
  const ns = sp.lat >= 0 ? 'N' : 'S', ew = sp.lon >= 0 ? 'E' : 'W';
  hud.set('time', `<b>${doyToDate(Math.round(p.doy))}</b> · <b>${hhmm(p.hour)}</b> UTC · sun overhead <b>${fmt(Math.abs(sp.lat), 1)}°${ns} ${fmt(Math.abs(sp.lon), 1)}°${ew}</b>`);
  ro.set('sub', `${fmt(Math.abs(sp.lat), 1)}°${ns} ${fmt(Math.abs(sp.lon), 1)}°${ew}`, null, `declination ${fmt(sp.lat, 2)}° · equation of time ${fmt(sp.eot, 1)} min`);
  const dl = dayLength(59.6, Math.round(p.doy));
  ro.set('daylen', dl, null, dl > 18 ? 'bright Nordic summer' : dl < 7 ? 'dark Nordic winter' : 'FAO-56 day-length formula');
}

/* layer update */
let curMax = 1;
function updateLayer() {
  const p = ui.values(), L = LAYERS[p.layer], perCap = p.perCap && !!L.pc;
  ui.enable('perCap', !!L.pc);
  colState.forEach(s => { s.val = layerVal(p.layer, perCap, s.r); });
  curMax = Math.max(...colState.map(s => s.val));
  colState.forEach(s => { const t = s.val / curMax; s.ht = 0.5 * p.hscale * t; stopColour(L.stops, 0.12 + 0.88 * Math.sqrt(t), s.colT); });
  const unit = perCap ? L.pc.unit : L.unit, dig = perCap ? L.pc.dig : L.dig;
  colState.forEach(s => { s.label.element.innerHTML = `${s.r.name}<small>${fmt(s.val, dig)} ${unit}</small>`; });
  legendEl.innerHTML = `<div>${L.name}${perCap ? ' per person' : ''} (${unit})</div><div class="cbar" style="background:linear-gradient(90deg,${L.stops.join(',')})"></div><div class="cbar-ticks"><span>0</span><span>${fmt(curMax / 2, dig)}</span><span>${fmt(curMax, dig)}</span></div><div style="margin-top:3px;color:#b9c8c0">${L.src}; column height ∝ value</div>`;
  const sorted = [...colState].sort((a, b) => b.val - a.val);
  const total = L.pc && !perCap ? colState.reduce((a, s) => a + s.val, 0) : null;
  const wv = perCap ? L.wpc : L.world;
  if (p.layer === 'yield') ro.set('total', `${fmt(colState.reduce((a, s) => a + s.r.cereal, 0) / colState.reduce((a, s) => a + s.r.cereal / s.r.yield, 0), 2)} t ha⁻¹`, null, 'production-weighted mean of the 40 countries');
  else if (total != null || p.layer === 'pop') { const T = colState.reduce((a, s) => a + s.val, 0); ro.set('total', `${fmt(T, L.dig)} ${L.unit}`, null, `${fmt(100 * T / L.world, 0)} % of the world total`); }
  else ro.set('total', '—', null, 'not additive per person');
  ro.set('top', `${sorted[0].r.name}`, null, `${fmt(sorted[0].val, dig)} ${unit}`);
  ro.set('world', `${fmt(wv, dig)} ${unit}`, null, `${L.name.toLowerCase()}${perCap ? ' per person' : ''} · ${p.layer === 'crop' || p.layer === 'pasture' || p.layer === 'pop' ? WORLD.year : p.layer === 'kcal' ? WORLD.kcalYear : WORLD.cerealYear}`);
  hud.set('layer', `${L.name}${perCap ? ' per person' : ''} · ${L.src}`);
  renderSelected();
  rank.set(sorted.slice(0, 15).map(s => s.r.name), [{ label: L.name, values: sorted.slice(0, 15).map(s => s.val), colors: sorted.slice(0, 15).map(s => '#' + s.colT.getHexString()), format: v => fmt(v, dig) }]);
  rank.y.label = `${L.name}${perCap ? ' per person' : ''}`; rank.y.unit = unit; rank.redraw();
  if (wv && isFinite(wv) && p.layer !== 'pop') rank.refLine(p.layer === 'yield' || perCap ? wv : null, p.layer === 'yield' || perCap ? 'world' : ''); else rank.refLine(null);
}
function renderSelected() {
  if (!selected) { card.style.display = 'none'; ro.set('sel', '—', null, 'click a column on the globe'); return; }
  const p = ui.values(), r = selected.r, L = LAYERS[p.layer], perCap = p.perCap && !!L.pc;
  const sorted = [...colState].sort((a, b) => b.val - a.val), rk = sorted.indexOf(selected) + 1;
  ro.set('sel', r.name, null, `${fmt(selected.val, perCap ? L.pc.dig : L.dig)} ${perCap ? L.pc.unit : L.unit} · rank ${rk} of ${NC}`);
  const row = (lab, v, u, extra = '') => `<tr><td>${lab}</td><td class="num"><b>${v}</b> ${u}${extra}</td></tr>`;
  card.innerHTML = `<button type="button" class="eg-x" aria-label="Close">×</button><div class="eg-name">${r.name}</div><table>
    ${row('Cropland', fmt(r.crop, 1), 'Mha', ` · ${fmt(r.crop * 1e4 / r.pop, 0)} m²/person`)}
    ${row('Pastures', fmt(r.pasture, 1), 'Mha', ` · ${fmt(r.pasture * 1e4 / r.pop, 0)} m²/person`)}
    ${row('Population', fmt(r.pop, 1), 'million')}
    ${row('Cereals', fmt(r.cereal, 1), 'Mt', ` · ${fmt(r.cereal * 1000 / r.kcalPop, 0)} kg/person`)}
    ${row('Cereal yield', fmt(r.yield, 2), 't/ha', ` · world ${fmt(WORLD.yield, 2)}`)}
    ${row('Calorie supply', fmt(r.kcal, 0), 'kcal/person/d')}
    ${row('Pasture share', fmt(100 * r.pasture / (r.crop + r.pasture), 0), '% of farmland')}
  </table><div class="eg-src">FAOSTAT land use ${r.year}, crops ${r.cerealYear}, food balances ${r.kcalYear}; UN WPP 2024</div>`;
  card.style.display = 'block';
  card.querySelector('.eg-x').addEventListener('click', () => { selected = null; writeInstances(); renderSelected(); updateLabels(); });
}

/* picking */
stage.onPick({
  objects: () => [columns],
  onClick: hit => {
    if (!hit || hit.instanceId == null) return;
    selected = colState[hit.instanceId]; writeInstances(); renderSelected(); updateLabels();
    ui.set('spin', false);
    const d = Math.max(2.3, camera.position.length() * 0.85); stage.flyTo(selected.n.clone().multiplyScalar(d).add(new THREE.Vector3(0, 0.25, 0)), [0, 0, 0], 1.4);
  },
  onHover: hit => { const h = hit && hit.instanceId != null ? colState[hit.instanceId] : null; if (h !== hovered) { hovered = h; writeInstances(); updateLabels(); } }
});

/* per-frame animation */
let lastLabel = 0;
stage.onFrame((dt, t) => {
  const p = ui.values();
  controls.autoRotate = p.spin; controls.autoRotateSpeed = 0.35;
  U.cloudOffset.value = (t * 0.0009) % 1;
  U.showClouds.value = p.clouds ? 1 : 0; U.showNight.value = p.lights ? 1 : 0; U.atmo.value = p.atmo ? 1 : 0;
  atmosphere.visible = p.atmo; clouds.visible = p.clouds;
  let moving = false; const k = 1 - Math.exp(-dt * 4);
  colState.forEach(s => { const nh = s.h + (s.ht - s.h) * k; if (Math.abs(nh - s.ht) > 1e-5) moving = true; s.h = nh; s.col.lerp(s.colT, k); });
  if (moving || hovered || selected) writeInstances();
  if (selected) { const pulse = 0.35 + 0.25 * Math.sin(t * 4); bases.material.opacity = pulse; } else bases.material.opacity = 0.35;
  if (t - lastLabel > 0.1) { lastLabel = t; updateLabels(); }
});

/* ------------------------------------------------------------ charts */
const rank = new BarChart('#chart-rank', { horizontal: true, y: { label: '', unit: '', min: 0 }, height: 390, legend: false });
/* bubble chart: land per person */
const bub = new Plot('#chart-bubble', { x: { label: 'Cropland per person', unit: 'm²', log: true, min: 100, max: 30000 }, y: { label: 'Pastures per person', unit: 'm²', log: true, min: 10, max: 1e6 }, legend: false, crosshair: false, height: 360 });
const bubTip = document.createElement('div'); bubTip.className = 'plot-tip'; document.querySelector('#chart-bubble .plot').appendChild(bubTip);
let bubPts = [];
function drawBubbles() {
  const P = palette();
  bub.custom('bubbles', (ctx, plot) => {
    bubPts = [];
    const maxPop = Math.max(...COUNTRIES.map(r => r.pop));
    [...COUNTRIES].sort((a, b) => b.pop - a.pop).forEach(r => {
      const x = r.crop * 1e4 / r.pop, y = Math.max(10, r.pasture * 1e4 / r.pop);
      const X = plot.px(x), Y = plot.py(y), R = 3 + 26 * Math.sqrt(r.pop / maxPop);
      const sel = selected && selected.r === r;
      ctx.fillStyle = withAlpha(r.pasture > r.crop ? '#6fbf73' : '#e2b43f', sel ? 0.85 : 0.5); ctx.strokeStyle = sel ? P.ink : withAlpha(r.pasture > r.crop ? '#3f8f4a' : '#b8862a', 0.9); ctx.lineWidth = sel ? 2.5 : 1;
      ctx.beginPath(); ctx.arc(X, Y, R, 0, 7); ctx.fill(); ctx.stroke();
      bubPts.push({ r, X, Y, R });
    });
    ctx.font = '600 10.5px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const LABELLED = ['China', 'India', 'United States', 'Brazil', 'Nigeria', 'Bangladesh', 'Mongolia', 'Australia', 'Kazakhstan', 'Saudi Arabia', 'Egypt', 'Japan', 'Netherlands', 'Sweden', 'Argentina', 'Canada', 'Indonesia'];
    bubPts.forEach(b => { if (!LABELLED.includes(b.r.name) && !(selected && selected.r === b.r)) return; const ty = b.Y - b.R - 7; ctx.strokeStyle = P.bgElev || '#fff'; ctx.lineWidth = 3; ctx.strokeText(b.r.name, b.X, ty); ctx.fillStyle = P.ink; ctx.fillText(b.r.name, b.X, ty); });
    const wx = WORLD.crop * 1e4 / WORLD.pop, wy = WORLD.pasture * 1e4 / WORLD.pop;
    ctx.strokeStyle = P.magenta; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(plot.px(wx) - 7, plot.py(wy)); ctx.lineTo(plot.px(wx) + 7, plot.py(wy)); ctx.moveTo(plot.px(wx), plot.py(wy) - 7); ctx.lineTo(plot.px(wx), plot.py(wy) + 7); ctx.stroke();
    ctx.fillStyle = P.magenta; ctx.textAlign = 'left'; ctx.fillText('world average', plot.px(wx) + 9, plot.py(wy) + 10);
  });
}
bub.on('pointermove', e => {
  const b = bubPts.find(b => Math.hypot(b.X - e.px, b.Y - e.py) <= Math.max(6, b.R));
  if (!b) { bubTip.style.display = 'none'; return; }
  bubTip.innerHTML = `<b>${b.r.name}</b><br>cropland ${fmt(b.r.crop * 1e4 / b.r.pop, 0)} m²/person<br>pastures ${fmt(b.r.pasture * 1e4 / b.r.pop, 0)} m²/person<br>population ${fmt(b.r.pop, 1)} million`;
  bubTip.style.display = 'block'; bubTip.style.left = Math.min(e.px + 14, bub.box.clientWidth - bubTip.offsetWidth - 4) + 'px'; bubTip.style.top = (e.py - 10) + 'px';
});
bub.on('click', e => {
  const b = bubPts.find(b => Math.hypot(b.X - e.px, b.Y - e.py) <= Math.max(6, b.R)); if (!b) return;
  selected = colState.find(s => s.r === b.r); writeInstances(); renderSelected(); updateLabels(); drawBubbles();
  ui.set('spin', false); stage.flyTo(selected.n.clone().multiplyScalar(2.6).add(new THREE.Vector3(0, 0.25, 0)), [0, 0, 0], 1.4);
});

/* land budget explorer — animated nested areas */
const LB = [
  { key: 'land', title: 'The land surface of the Earth', note: 'Glaciers cover about 10 % of the land and deserts and other barren land about 14 %. The remainder is habitable land (Ritchie &amp; Roser, Our World in Data).', parts: [
    { id: 'hab', label: 'Habitable land', v: 76, col: '#5fae6e', next: 1 }, { id: 'barren', label: 'Deserts and barren land', v: 14, col: '#cdb68a' }, { id: 'glacier', label: 'Glaciers', v: 10, col: '#d9ecf5' }] },
  { key: 'hab', title: 'Habitable land', note: 'Almost half — 44 %, or 48 million km² — of the habitable land is used for agriculture. Forests, shrubland, settlements and freshwater share the rest.', parts: [
    { id: 'agri', label: 'Agriculture · 48 million km²', v: 44, col: '#e2b43f', next: 2 }, { id: 'other', label: 'Forests, shrubland, settlements, freshwater', v: 56, col: '#2f7d4c' }] },
  { key: 'agri', title: `Agricultural land (FAO ${WORLD.year}: ${fmt(WORLD.ag / 1000, 2)} billion ha)`, note: `Two thirds are permanent meadows and pastures (${fmt(WORLD.pasture / 1000, 2)} billion ha), one third is cropland (${fmt(WORLD.crop / 1000, 2)} billion ha). Click a rectangle to show it on the globe; <em>Next</em> splits the same land by what it feeds.`, parts: [
    { id: 'graze', label: 'Permanent meadows and pastures', v: Math.round(100 * WORLD.pasture / WORLD.ag), col: '#8cc05a', layer: 'pasture' }, { id: 'crop', label: 'Cropland', v: Math.round(100 * WORLD.crop / WORLD.ag), col: '#e2b43f', layer: 'crop' }] },
  { key: 'use', title: 'What agricultural land is used for', note: 'Livestock — grazing plus the cropland that grows animal feed — uses about 80 % of agricultural land; crops for people 16 % and non-food crops (biofuels, textiles) 4 %.', parts: [
    { id: 'live', label: 'Livestock: grazing + feed crops', v: 80, col: '#c9503f' }, { id: 'food', label: 'Crops for people', v: 16, col: '#45b86c' }, { id: 'nonfood', label: 'Non-food crops', v: 4, col: '#9aa3ad' }] },
  { key: 'out', title: 'What the land gives us', note: 'Meat, dairy and farmed fish use about 80 % of farmland but provide only 17 % of the world’s calories and 38 % of its protein (Our World in Data; Poore &amp; Nemecek, 2018, give 83 %, 18 % and 37 %).', bars: [
    { label: 'Farmland', a: 80, b: 20 }, { label: 'Calories', a: 17, b: 83 }, { label: 'Protein', a: 38, b: 62 }] }
];
const lbEl = document.getElementById('landbudget');
const lbCv = document.createElement('canvas'); lbEl.appendChild(lbCv); const lbx = lbCv.getContext('2d');
const lbNote = document.getElementById('lb-note'), lbTitle = document.getElementById('lb-title');
let lbLevel = 0, lbAnim = null, lbW = 0, lbH = 0, lbRects = [];
function lbLayout(level, box) {
  const parts = LB[level].parts; if (!parts) return [];
  const tot = parts.reduce((a, p) => a + p.v, 0), out = [];
  const first = parts[0], wf = box.w * first.v / tot;
  out.push({ p: first, x: box.x, y: box.y, w: wf, h: box.h });
  let y = box.y; const rest = parts.slice(1), rt = rest.reduce((a, p) => a + p.v, 0);
  rest.forEach(p => { const h = box.h * p.v / rt; out.push({ p, x: box.x + wf, y, w: box.w - wf, h }); y += h; });
  return out;
}
function lbSize() { const d = Math.min(2, window.devicePixelRatio || 1); lbW = lbEl.clientWidth; lbH = lbEl.clientHeight; if (!lbW || !lbH) return; lbCv.width = lbW * d; lbCv.height = lbH * d; lbCv.style.width = lbW + 'px'; lbCv.style.height = lbH + 'px'; lbx.setTransform(d, 0, 0, d, 0, 0); lbDraw(); }
new ResizeObserver(lbSize).observe(lbEl);
document.addEventListener('ffp:theme', () => lbDraw());
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function drawRect(r, alpha = 1, labels = true) {
  const x = lbx, P = palette();
  x.globalAlpha = alpha; x.fillStyle = r.p.col; x.fillRect(r.x + 1.5, r.y + 1.5, Math.max(0, r.w - 3), Math.max(0, r.h - 3));
  if (r.p.next != null) { x.strokeStyle = '#ffffff'; x.lineWidth = 2; x.setLineDash([6, 4]); x.strokeRect(r.x + 5, r.y + 5, Math.max(0, r.w - 10), Math.max(0, r.h - 10)); x.setLineDash([]); }
  if (labels && r.w > 60 && r.h > 34) {
    const dark = ['#d9ecf5', '#cdb68a', '#e2b43f', '#8cc05a', '#9aa3ad'].includes(r.p.col);
    x.fillStyle = dark ? '#1b1f1c' : '#ffffff'; x.textAlign = 'left'; x.textBaseline = 'top';
    x.font = `700 ${Math.min(30, Math.max(14, r.h * 0.18))}px "JetBrains Mono", monospace`; x.fillText(`${r.p.v} %`, r.x + 12, r.y + 10);
    x.font = `600 ${r.w > 180 ? 13 : 11}px Inter, system-ui, sans-serif`;
    wrapText(x, r.p.label, r.x + 12, r.y + 14 + Math.min(30, Math.max(14, r.h * 0.18)), r.w - 22, 15);
    if (r.p.next != null && r.h > 90) { x.font = '600 11px Inter, system-ui, sans-serif'; x.globalAlpha = alpha * 0.85; x.fillText('click to zoom in ▸', r.x + 12, r.y + r.h - 24); }
    else if (r.p.layer && r.h > 90) { x.font = '600 11px Inter, system-ui, sans-serif'; x.globalAlpha = alpha * 0.85; x.fillText('click to show on the globe', r.x + 12, r.y + r.h - 24); }
  }
  x.globalAlpha = 1;
}
function wrapText(x, text, X, Y, maxW, lh) { const words = text.split(' '); let line = '', y = Y; words.forEach(w => { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > maxW && line) { x.fillText(line, X, y); line = w; y += lh; } else line = t; }); if (line) x.fillText(line, X, y); }
function drawBars(alpha) {
  const x = lbx, P = palette(), bars = LB[4].bars, pad = 16, bw = (lbW - 2 * pad) / bars.length;
  bars.forEach((b, i) => {
    const X = pad + i * bw + 14, W = bw - 28, top = 36, H = lbH - top - 34, g = alpha;
    x.globalAlpha = Math.min(1, alpha * 1.5); x.fillStyle = P.ink; x.font = '650 13px Inter, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'bottom'; x.fillText(b.label, X + W / 2, top - 8);
    const ha = H * b.a / 100 * g, hb = H * b.b / 100 * g;
    x.fillStyle = '#c9503f'; x.fillRect(X, top + H - ha, W, ha);
    x.fillStyle = '#45b86c'; x.fillRect(X, top, W, hb);
    x.fillStyle = '#ffffff'; x.font = '700 16px "JetBrains Mono", monospace'; x.textBaseline = 'middle';
    if (ha > 24) x.fillText(`${b.a} %`, X + W / 2, top + H - ha / 2);
    if (hb > 24) x.fillText(`${b.b} %`, X + W / 2, top + hb / 2);
  });
  x.globalAlpha = alpha; x.font = '500 11.5px Inter, system-ui, sans-serif'; x.textAlign = 'left'; x.textBaseline = 'middle';
  x.fillStyle = '#c9503f'; x.fillRect(pad + 14, lbH - 16, 11, 11); x.fillStyle = P.ink2 || P.ink; x.fillText('meat, dairy and farmed fish (incl. feed crops)', pad + 30, lbH - 10);
  x.fillStyle = '#45b86c'; x.fillRect(pad + 330, lbH - 16, 11, 11); x.fillStyle = P.ink2 || P.ink; x.fillText('plant-based foods for people', pad + 346, lbH - 10);
  x.globalAlpha = 1;
}
function lbDraw() {
  if (!lbW) return;
  const x = lbx; x.clearRect(0, 0, lbW, lbH);
  const box = { x: 8, y: 8, w: lbW - 16, h: lbH - 16 };
  if (lbAnim) {
    const t = ease(Math.min(1, lbAnim.t)), from = lbAnim.from, to = lbAnim.to;
    const src = lbAnim.dir > 0 ? (LB[from].parts ? lbLayout(from, box).find(r => r.p.next === to) : null) : (LB[to].parts ? lbLayout(to, box).find(r => r.p.next === from) : null);
    if (!src) {   // not a parent–child step: cross-fade (e.g., the same land split by type → by use → outputs)
      if (LB[from].bars) drawBars(1 - t); else lbLayout(from, box).forEach(r => drawRect(r, 1 - t, t < 0.5));
      if (LB[to].bars) drawBars(t); else lbLayout(to, box).forEach(r => drawRect(r, t, t >= 0.5));
      lbRects = []; return;
    }
    // zoom: the chosen rectangle grows to the full box; the next level fades in inside it
    const tt = lbAnim.dir > 0 ? t : 1 - t;
    const cur = { x: src.x + (box.x - src.x) * tt, y: src.y + (box.y - src.y) * tt, w: src.w + (box.w - src.w) * tt, h: src.h + (box.h - src.h) * tt };
    const outer = lbAnim.dir > 0 ? from : lbAnim.to, inner = lbAnim.dir > 0 ? lbAnim.to : from;
    lbLayout(outer, box).forEach(r => { if (r !== src) drawRect(r, 1 - tt * 0.9, false); });
    if (LB[inner].parts) lbLayout(inner, cur).forEach(r => drawRect(r, 0.35 + 0.65 * tt, tt > 0.6));
    lbRects = []; return;
  }
  if (LB[lbLevel].bars) { drawBars(1); lbRects = []; return; }
  lbRects = lbLayout(lbLevel, box); lbRects.forEach(r => drawRect(r, 1, true));
}
function lbGo(to) {
  if (to < 0 || to >= LB.length || lbAnim) return;
  const from = lbLevel; lbAnim = { from, to, dir: to > from ? 1 : -1, t: 0 };
  lbTitle.textContent = `${to + 1}/5 · ${LB[to].title}`; lbNote.innerHTML = LB[to].note;
  const t0 = performance.now();
  const stepA = now => { lbAnim.t = (now - t0) / 1100; lbDraw(); if (lbAnim.t < 1) requestAnimationFrame(stepA); else { lbAnim = null; lbLevel = to; lbDraw(); } };
  requestAnimationFrame(stepA);
}
lbCv.addEventListener('click', ev => {
  const r = lbCv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
  const hit = lbRects.find(q => mx >= q.x && mx <= q.x + q.w && my >= q.y && my <= q.y + q.h);
  if (!hit) return;
  if (hit.p.layer) ui.set('layer', hit.p.layer);
  if (hit.p.next != null) lbGo(hit.p.next);
});
lbCv.addEventListener('pointermove', ev => { const r = lbCv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top; const hit = lbRects.find(q => mx >= q.x && mx <= q.x + q.w && my >= q.y && my <= q.y + q.h); lbCv.style.cursor = hit && (hit.p.next != null || hit.p.layer) ? 'pointer' : ''; });
document.getElementById('lb-back').addEventListener('click', () => lbGo(lbLevel - 1));
document.getElementById('lb-next').addEventListener('click', () => lbGo(lbLevel + 1));
let lbAuto = null;
document.getElementById('lb-play').addEventListener('click', e => {
  if (lbAuto) { clearInterval(lbAuto); lbAuto = null; e.target.textContent = '▶ Play'; return; }
  e.target.textContent = '❚❚ Stop'; if (lbLevel === LB.length - 1) lbGo(0);
  lbAuto = setInterval(() => { if (lbLevel >= LB.length - 1) { clearInterval(lbAuto); lbAuto = null; e.target.textContent = '▶ Play'; return; } lbGo(lbLevel + 1); }, 3200);
});
lbTitle.textContent = `1/5 · ${LB[0].title}`; lbNote.innerHTML = LB[0].note;

/* ------------------------------------------------------------ wiring */
let pend = 0;
ui.onChange((st, id) => {
  cancelAnimationFrame(pend);
  pend = requestAnimationFrame(() => { updateSun(); if (!id || ['layer', 'perCap', 'hscale'].includes(id)) updateLayer(); drawBubbles(); updateLabels(); });
});
updateSun(); updateLayer(); drawBubbles(); writeInstances(); updateLabels();
