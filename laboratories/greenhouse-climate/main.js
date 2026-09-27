/* ==========================================================================
   Greenhouse climate simulator — controls, charts, playback and sky.
   The dynamic model lives in ./model.js (Derive tab, Eqs. G1–G12); the 3D
   scene in ./scene.js. Every parameter change re-simulates a full day
   (after two spin-up days); the SimClock then plays that day back through
   the 3D scene, the readouts and the chart cursors.
   ========================================================================== */
import { createStage, addSky, THREE, fitShadow, canvasTexture, fbm2 } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, BarChart, downloadCSV } from '/assets/js/plot.js';
import { colormapGradient } from '/assets/js/colors.js';
import { clamp } from '/assets/js/physics.js';
import { simulate, SITES, MONTH_NAMES, PRM, monthClimate, REC_KEYS, dewFromE } from './model.js';
import { buildScene } from './scene.js';

const hhmm = v => { v = ((v % 24) + 24) % 24; let H = Math.floor(v), m = Math.round((v - H) * 60); if (m === 60) { H = (H + 1) % 24; m = 0; } return `${String(H).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
const DATES = { jan: '15 January', apr: '15 April', jul: '15 July' };

/* ------------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'T', label: 'Inside air temperature', unit: '°C', digits: 1, note: '&nbsp;' })
  .add({ id: 'RH', label: 'Relative humidity', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'VPD', label: 'Leaf-to-air VPD', unit: 'kPa', digits: 2, note: '&nbsp;' })
  .add({ id: 'C', label: 'CO₂ concentration', unit: 'ppm', digits: 0, note: '&nbsp;' })
  .add({ id: 'Q', label: 'Heating power', unit: 'W m⁻²', digits: 0, note: '&nbsp;' })
  .add({ id: 'u', label: 'Roof vents open', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'E', label: 'Transpiration', unit: 'L m⁻² h⁻¹', digits: 3, note: '&nbsp;' })
  .add({ id: 'cond', label: 'Condensation on cover & screen', unit: 'g m⁻² h⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'U', label: 'Effective U-value of the cover', unit: 'W m⁻² K⁻¹', digits: 2, note: '&nbsp;' })
  .add({ id: 'P', label: 'Net CO₂ uptake by the crop', unit: 'µmol m⁻² s⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'heat', label: 'Heat used today', unit: 'kWh m⁻² d⁻¹', digits: 2, note: '&nbsp;' })
  .add({ id: 'dosed', label: 'CO₂ dosed today', unit: 'g m⁻² d⁻¹', digits: 1, note: '&nbsp;' });

ui.section('Weather: representative day');
ui.select({ id: 'site', label: 'Location', options: [{ value: 'vasteras', label: 'Västerås, Sweden (59.6° N)' }, { value: 'almeria', label: 'Almería, Spain (36.8° N)' }], value: 'vasteras' });
ui.segmented({ id: 'month', label: 'Month (15th day)', options: [{ value: 'jan', label: 'January' }, { value: 'apr', label: 'April' }, { value: 'jul', label: 'July' }], value: 'apr' });
ui.segmented({ id: 'sky', label: 'Sky', options: [{ value: 'clim', label: 'Climatological mean' }, { value: 'clear', label: 'Clear sky' }], value: 'clim', help: 'Mean: monthly clearness index and long-wave sky radiation (NASA POWER 2001–2020). Clear: FAO-56 clear-sky radiation and a Brutsaert (1975) clear night sky.' });
ui.slider({ id: 'dT', label: 'Outside temperature offset', min: -15, max: 10, step: 0.5, value: 0, unit: 'K', help: 'Shifts the whole day: try −12 K for a Swedish cold snap' });
ui.slider({ id: 'wind', label: 'Wind speed at 10 m', min: 0, max: 12, step: 0.1, value: 2.5, unit: 'm s⁻¹', help: 'Reset to the monthly mean when location or month changes' });

ui.section('Time of day');
const [playBtn] = ui.buttons([{ label: '▶ Play the day', variant: 'primary', onClick: () => clock.toggle() }, { label: 'Night 02:00', onClick: () => ui.set('time', 2) }, { label: 'Noon', onClick: () => ui.set('time', 12) }]);
ui.segmented({ id: 'speed', label: 'Playback speed', options: [{ value: 900, label: '¼ h/s' }, { value: 2700, label: '¾ h/s' }, { value: 7200, label: '2 h/s' }], value: 2700 });
ui.slider({ id: 'time', label: 'Solar time', min: 0, max: 23.95, step: 0.05, value: 11.5, format: v => hhmm(v) });

ui.section('Climate computer');
ui.slider({ id: 'tDay', label: 'Heating set-point, day', min: 12, max: 26, step: 0.5, value: 20, unit: '°C' });
ui.slider({ id: 'tNight', label: 'Heating set-point, night', min: 10, max: 24, step: 0.5, value: 18, unit: '°C' });
ui.slider({ id: 'dTv', label: 'Ventilation line above heating', min: 0.5, max: 6, step: 0.5, value: 2, unit: 'K', help: 'Vents start to open at heating set-point + this value' });
ui.slider({ id: 'pband', label: 'Vent P-band', min: 1, max: 10, step: 0.5, value: 4, unit: 'K', help: 'Vents are fully open this many kelvin above the ventilation line' });
ui.slider({ id: 'rhMax', label: 'Humidity limit', min: 70, max: 95, step: 1, value: 85, unit: '% RH', help: 'Above it: vents open a crack and the screen opens a gap' });
ui.slider({ id: 'minPipe', label: 'Minimum pipe temperature', min: 20, max: 60, step: 1, value: 20, format: v => v <= 20 ? 'off' : `${v} °C`, help: '“Minimum pipe”: warms the crop and drives vapour out, at an energy cost' });
ui.segmented({ id: 'screen', label: 'Energy screen', options: [{ value: 'auto', label: 'Auto' }, { value: 'open', label: 'Never' }, { value: 'closed', label: 'Always' }], value: 'auto', help: 'Auto: closed when outside radiation < 50 W m⁻² and outside < 12 °C' });
ui.slider({ id: 'es', label: 'Screen energy saving', min: 20, max: 75, step: 1, value: 45, unit: '%', help: 'Transparent energy screens ≈ 40–50 %, aluminised ≈ 65–75 %' });
ui.toggle({ id: 'co2On', label: 'CO₂ enrichment (pure CO₂, 185 kg ha⁻¹ h⁻¹)', value: true });
ui.slider({ id: 'co2sp', label: 'CO₂ set-point (daytime)', min: 450, max: 1200, step: 10, value: 800, unit: 'ppm' });
ui.toggle({ id: 'interlock', label: 'Enrich only while vents < 10 % open', value: true, help: 'Otherwise the doser keeps chasing the set-point through open vents' });

ui.section('Crop, cover and lighting');
ui.slider({ id: 'lai', label: 'Crop leaf area index', min: 0.5, max: 4, step: 0.1, value: 3, unit: 'm² m⁻²', help: 'Young tomato crop ≈ 0.5–1 · mature high-wire crop ≈ 3' });
ui.slider({ id: 'shade', label: 'Whitewash / shading', min: 0, max: 60, step: 1, value: 0, unit: '%', help: 'Chalk on the roof, common in Almería in summer' });
ui.slider({ id: 'lamp', label: 'LED top-lighting (electric)', min: 0, max: 150, step: 5, value: 0, unit: 'W m⁻²', help: 'On 04:00–22:00 when outside radiation < 250 W m⁻²; 2.8 µmol J⁻¹' });

ui.section('Display');
ui.toggle({ id: 'labels', label: 'Labels on components', value: true, persist: false });
ui.toggle({ id: 'thermal', label: 'Thermal-camera colours on pipes', value: true, persist: false });
const VIEWS = {
  outside: { pos: [27, 12.5, 22], target: [1, 2.6, -3] },
  inside: { pos: [-0.9, 1.75, 8.9], target: [-0.6, 2.5, -6] },
  roof: { pos: [1.5, 1.7, 9.4], target: [-1, 5.8, 3.5] },
  pipes: { pos: [-1.6, 0.95, 8.3], target: [-1.8, 0.2, 3.2] },
  boiler: { pos: [8.5, 7.5, 13], target: [23, 5.5, -8] },
  co2: { pos: [23, 5, -5], target: [12.5, 4, -16] }
};
ui.buttons([{ label: 'Outside', onClick: () => fly('outside') }, { label: 'Inside the crop', onClick: () => fly('inside') }, { label: 'Roof & screen', onClick: () => fly('roof') }]);
ui.buttons([{ label: 'Heating pipes', onClick: () => fly('pipes') }, { label: 'Boiler & buffer', onClick: () => fly('boiler') }, { label: 'CO₂ tank', onClick: () => fly('co2') }]);

ui.presets([
  { label: 'Swedish winter night — no screen', title: 'Västerås, 15 January, energy screen never closed', values: { site: 'vasteras', month: 'jan', sky: 'clim', dT: 0, screen: 'open', lamp: 0, shade: 0, tDay: 20, tNight: 18, co2On: true, interlock: true, lai: 3 }, onApply: () => { ui.set('time', 2); fly('roof'); } },
  { label: 'Swedish winter night — energy screen', title: 'Same day, screen closes automatically at night', values: { site: 'vasteras', month: 'jan', sky: 'clim', dT: 0, screen: 'auto', lamp: 0, shade: 0, tDay: 20, tNight: 18, co2On: true, interlock: true, lai: 3 }, onApply: () => { ui.set('time', 2); fly('roof'); } },
  { label: 'Sunny spring day', title: 'Västerås, 15 April, clear sky', values: { site: 'vasteras', month: 'apr', sky: 'clear', dT: 0, screen: 'auto', lamp: 0, shade: 0, tDay: 20, tNight: 18, co2On: true, interlock: true, co2sp: 800, lai: 3 }, onApply: () => { ui.set('time', 11); fly('outside'); } },
  { label: 'Summer heat (Almería)', title: 'Almería, 15 July, no whitewash', values: { site: 'almeria', month: 'jul', sky: 'clim', dT: 0, screen: 'auto', lamp: 0, shade: 0, tDay: 22, tNight: 18, co2On: true, interlock: true, lai: 3 }, onApply: () => { ui.set('time', 13); fly('outside'); } },
  { label: 'CO₂ with vents open (wasteful)', title: 'Västerås, 15 July, enrichment to 1000 ppm without the vent interlock', values: { site: 'vasteras', month: 'jul', sky: 'clim', dT: 0, screen: 'auto', lamp: 0, shade: 0, tDay: 21, tNight: 17, co2On: true, interlock: false, co2sp: 1000, lai: 3 }, onApply: () => { ui.set('time', 12.5); fly('co2'); } },
  { label: 'Winter crop under LEDs', title: 'Västerås, 15 January, 70 W m⁻² LED top-lighting', values: { site: 'vasteras', month: 'jan', sky: 'clim', dT: 0, screen: 'auto', lamp: 70, shade: 0, tDay: 20, tNight: 18, co2On: true, interlock: true, co2sp: 800, lai: 3 }, onApply: () => { ui.set('time', 6); fly('outside'); } }
]);
ui.saveButton('greenhouse-climate', () => Object.assign({}, ro.values(), SIM ? { heatDay: +SIM.sum.heat.toFixed(3), transpDay: +SIM.sum.transp.toFixed(3), condDay: +SIM.sum.condens.toFixed(3), co2DosedDay: +SIM.sum.dosed.toFixed(2), co2VentedShare: +SIM.sum.ventFrac.toFixed(3), TminIn: +SIM.sum.Tmin.toFixed(2), TmaxIn: +SIM.sum.Tmax.toFixed(2) } : {}));
ui.button({ label: 'Download the 24-h results (CSV)', onClick: () => downloadDay() });

/* ------------------------------------------------------------------ stage, sky, scene */
const stage = createStage('#stage', {
  background: null, exposure: 0.5, envIntensity: 0.4,
  camera: { pos: VIEWS.outside.pos, target: VIEWS.outside.target, fov: 42, far: 4000 },
  controls: { minDistance: 0.8, maxDistance: 170, maxPolarAngle: Math.PI * 0.93 },
  bloom: { strength: 0.55, radius: 0.5, threshold: 2.4 }, ao: { radius: 0.4, intensity: 0.55 },   // high threshold: the HDR sky must not bloom, only pipes and LEDs
  hint: 'Drag to orbit · scroll to zoom · click a component'
});
const { scene } = stage;
const sky = addSky(stage, { elevation: 30, azimuth: 160, turbidity: 3, sunIntensity: 3.3, shadowSize: 18, updateEnv: false });
fitShadow(sky.sun, 19, [0, 0, 0]); sky.sun.shadow.camera.far = 170; sky.sun.shadow.camera.updateProjectionMatrix(); sky.sun.shadow.mapSize.set(2048, 2048);
const cloudTex = canvasTexture(512, 512, (ctx, w, h) => {
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h; const tile = (a, b) => fbm2(a * 6, b * 6, 5);
    const n = tile(u, v) * (1 - u) * (1 - v) + tile(u - 1, v) * u * (1 - v) + tile(u, v - 1) * (1 - u) * v + tile(u - 1, v - 1) * u * v;
    const k = (y * w + x) * 4; const a = Math.max(0, Math.min(1, (n + 0.32) / 0.64));   // noise value stored in alpha; coverage set by a shader threshold
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.round(255 * a);
  }
  ctx.putImageData(img, 0, 0);
}, { repeat: [3, 3], srgb: true });
const cloudFade = canvasTexture(256, 256, (ctx, w) => { const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, '#fff'); g.addColorStop(0.55, '#bbb'); g.addColorStop(1, '#000'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, w); }, { srgb: false, repeat: [1, 1] });
cloudFade.wrapS = cloudFade.wrapT = THREE.ClampToEdgeWrapping;
const clouds = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), new THREE.MeshBasicMaterial({ map: cloudTex, alphaMap: cloudFade, transparent: true, opacity: 0, depthWrite: false, color: 0xffffff, fog: false }));
clouds.rotation.x = Math.PI / 2; clouds.position.y = 260; clouds.renderOrder = -1; scene.add(clouds);
const cloudThr = { value: 0.8 };
clouds.material.onBeforeCompile = sh => {
  sh.uniforms.uThr = cloudThr;
  sh.fragmentShader = 'uniform float uThr;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.a = smoothstep(uThr, uThr + 0.22, diffuseColor.a);');
};
const fogCol = new THREE.Color(0xc9d6e2);
scene.fog = new THREE.Fog(fogCol.getHex(), 260, 1500);
// stars for clear nights
const starGeo = new THREE.BufferGeometry(); { const r = [], rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7); for (let i = 0; i < 1800; i++) { const u = rnd(), v = rnd() * 0.95; const th = 2 * Math.PI * u, ph = Math.acos(1 - v); r.push(2000 * Math.sin(ph) * Math.cos(th), 2000 * Math.cos(ph) + 40, 2000 * Math.sin(ph) * Math.sin(th)); } starGeo.setAttribute('position', new THREE.Float32BufferAttribute(r, 3)); }
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
scene.add(stars);
const S3 = buildScene(stage);
const hud = hudChips(stage.el);
const legend = document.createElement('div'); legend.className = 'stage-legend'; stage.el.appendChild(legend);
const info = document.createElement('div'); info.className = 'label3d';
Object.assign(info.style, { position: 'absolute', right: '12px', top: '56px', maxWidth: '300px', zIndex: 6, display: 'none', whiteSpace: 'normal', lineHeight: '1.45', pointerEvents: 'none', font: '500 .78rem var(--font-sans)' });
stage.el.appendChild(info);
function fly(name) { const v = VIEWS[name]; if (v) stage.flyTo(v.pos, v.target, 1.6); }

/* ------------------------------------------------------------------ charts */
const X = { label: 'Solar time', unit: 'h', min: 0, max: 24, format: v => hhmm(v) };
const cTemp = new Plot('#chart-temp', { x: X, y: { label: 'Temperature', unit: '°C' }, height: 290 });
const cHum = new Plot('#chart-hum', { x: X, y: { label: 'Relative humidity', unit: '%', min: 20, max: 100 }, y2: { label: 'Leaf-to-air VPD', unit: 'kPa', min: 0, max: 3 }, height: 290 });
const cCO2 = new Plot('#chart-co2', { x: X, y: { label: 'CO₂', unit: 'ppm', min: 0 }, y2: { label: 'CO₂ dosing', unit: 'kg ha⁻¹ h⁻¹', min: 0, max: 200 }, height: 290 });
const cHeat = new Plot('#chart-heat', { x: X, y: { label: 'Heating power', unit: 'W m⁻²', min: 0 }, y2: { label: 'Heat since midnight', unit: 'kWh m⁻²', min: 0 }, height: 290 });
const cAct = new Plot('#chart-act', { x: X, y: { label: 'Opening / closure', unit: '%', min: 0, max: 100 }, y2: { label: 'Pipe temperature', unit: '°C', min: 0, max: 100 }, height: 290 });
const cBal = new BarChart('#chart-bal', { y: { label: 'Energy flux (+ gain, − loss)', unit: 'W m⁻²' }, horizontal: true, height: 300, legend: false });
const PLOTS = [cTemp, cHum, cCO2, cHeat, cAct];

function drawCharts() {
  const R = SIM.rec, t = Array.from(R.t);
  const nightRegions = p => {
    const tsr = SIM.wx.tsr, tss = SIM.wx.tss;
    p.region('n1', 0, tsr, { color: 'ink', alpha: 0.05 }); p.region('n2', tss, 24, { color: 'ink', alpha: 0.05 });
  };
  PLOTS.forEach(nightRegions);
  const A = k => Array.from(R[k]);
  cTemp.line('To', t, A('To'), { color: 'water', width: 2, label: 'Outside' });
  cTemp.line('Tc', t, A('Tc'), { color: 'c4', width: 1.5, label: 'Glass (cover)' });
  cTemp.line('Tdew', t, A('Tdew'), { color: 'c1', width: 1.5, dash: [2, 3], label: 'Dew point inside' });
  cTemp.line('Th', t, A('Th'), { color: 'amber', width: 1.6, dash: [6, 4], label: 'Heating set-point' });
  cTemp.line('Tv', t, A('Tv'), { color: 'magenta', width: 1.4, dash: [6, 4], label: 'Ventilation line' });
  cTemp.line('T', t, A('T'), { color: 'accent', width: 2.8, label: 'Inside air' });
  cHum.hregion('bot', p.rhRisk, 90, { color: 'amber', alpha: 0.1, label: '' });
  cHum.hregion('bot2', 90, 100, { color: 'danger', alpha: 0.1, label: 'Botrytis risk (RH > 90 %)' });
  cHum.hregion('vpdok', 0.5, 1.2, { color: 'accent', alpha: 0.07, y2: true });
  cHum.line('RH', t, A('RH').map(v => Math.min(100, v)), { color: 'water', width: 2.6, label: 'Relative humidity' });
  cHum.line('VPD', t, A('VPDleaf'), { color: 'magenta', width: 2, y2: true, label: 'Leaf-to-air VPD' });
  cCO2.line('dose', t, A('dose').map(v => v * 36), { color: 'magenta', width: 1.4, fill: 0.16, y2: true, label: 'Dosing' });
  cCO2.line('Csp', t, A('Csp').map(v => v > 0 ? v : NaN), { color: 'amber', width: 1.4, dash: [6, 4], label: 'Set-point (when dosing allowed)' });
  cCO2.hline('Co', PRM.Co, { color: 'water', dash: [3, 3], label: `outside ${PRM.Co} ppm` });
  cCO2.line('C', t, A('C'), { color: 'accent', width: 2.6, label: 'Inside CO₂' });
  const cum = []; let acc = 0; for (let i = 0; i < t.length; i++) { if (i) acc += 0.5 * (R.Qheat[i] + R.Qheat[i - 1]) * 300 / 3.6e6; cum.push(acc); }
  cHeat.line('Qmax', t, A('Qmax'), { color: 'muted', width: 1.2, dash: [4, 4], label: 'Capacity (pipes at 90 °C)' });
  cHeat.line('Q', t, A('Qheat'), { color: 'amber', width: 2.4, fill: 0.18, label: 'Heating power' });
  if (SIM.p.lamp > 0) cHeat.line('PL', t, A('PL'), { color: 'magenta', width: 1.6, label: 'LED electricity' }); else cHeat.remove('PL');
  cHeat.line('cum', t, cum, { color: 'ink', width: 1.8, dash: [5, 3], y2: true, label: 'Cumulative heat' });
  cAct.line('u', t, A('u').map(v => 100 * v), { color: 'water', width: 2.2, fill: 0.14, label: 'Roof vents' });
  cAct.line('s', t, A('s').map(v => 100 * v), { color: 'c4', width: 2.2, label: 'Energy screen closed' });
  cAct.line('Tp', t, A('Tp'), { color: 'amber', width: 1.8, y2: true, label: 'Pipe temperature' });
}

/* ------------------------------------------------------------------ simulation */
let SIM = null, p = null;
const MODEL_KEYS = ['site', 'month', 'sky', 'dT', 'wind', 'tDay', 'tNight', 'dTv', 'pband', 'rhMax', 'minPipe', 'screen', 'es', 'co2On', 'co2sp', 'interlock', 'lai', 'shade', 'lamp'];
function params() {
  const v = ui.values();
  return { site: v.site, month: v.month, sky: v.sky, dT: v.dT, wind: v.wind, tDay: v.tDay, tNight: Math.min(v.tNight, v.tDay), dTv: v.dTv, pband: v.pband, rhMax: v.rhMax, rhRisk: 85,
    minPipe: v.minPipe <= 20 ? 0 : v.minPipe, screen: v.screen, es: v.es / 100, co2On: v.co2On, co2sp: v.co2sp, interlock: v.interlock, uCo2: 0.1, lai: v.lai, shade: v.shade / 100, lamp: v.lamp };
}
let lastScene = '';
function recompute() {
  p = params();
  SIM = simulate(p);
  const sk = p.site + '|' + p.month;
  if (sk !== lastScene) { S3.buildLandscape(p.site, p.month); lastScene = sk; }
  S3.buildCrop(p.lai);
  S3.setLamps(p.lamp > 0);
  drawCharts();
  lastEnvEl = 999;
  applyTime(ui.get('time'), true);
}
let recT = 0;
function scheduleRecompute() { clearTimeout(recT); recT = setTimeout(recompute, 60); }

/* ------------------------------------------------------------------ playback */
function sampleAt(tH) {
  const R = SIM.rec; const x = clamp(tH, 0, 24) * 12; const i = Math.min(R.t.length - 2, Math.floor(x)), f = x - i;
  const o = {}; REC_KEYS.forEach(k => { o[k] = R[k][i] + (R[k][i + 1] - R[k][i]) * f; });
  return o;
}
function erbs(kt) { if (kt <= 0.22) return 1 - 0.09 * kt; if (kt <= 0.8) return 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4; return 0.165; }
let lastEnvEl = 999, lastEnvT = 0, lastUi = 0, lastCursor = 0;
function applyTime(tH, force) {
  if (!SIM) return;
  const s = sampleAt(tH), wx = SIM.wx;
  const mi = Math.min(1440, Math.max(0, Math.round(tH * 60)));
  const el = wx.el[mi], az = wx.az[mi];
  // sky & sun
  sky.setSun(el, az);
  const kd = erbs(wx.kt);
  const beam = clamp((1 - kd) / (1 - 0.18), 0.04, 1);
  sky.sun.intensity *= 1.25 * beam;
  sky.hemi.intensity *= 0.45 + 0.55 * kd;
  const cloudy = clamp((kd - 0.45) / 0.5, 0, 1);
  const u = sky.sky.material.uniforms; u.turbidity.value = 2 + 4 * cloudy; u.rayleigh.value = 1.3 + 1.1 * cloudy;
  cloudThr.value = 0.72 - 0.66 * cloudy;                                  // cloud cover grows with the diffuse fraction
  clouds.material.opacity = (0.35 + 0.6 * cloudy) * (el > -6 ? 1 : 0.35);
  clouds.material.color.setScalar(el > 0 ? (0.62 + 0.38 * Math.min(1, el / 25)) * (1 - 0.3 * cloudy) : 0.2);
  const day = THREE.MathUtils.smoothstep(el, -4, 12);
  // moon- and skylight so the night scene stays legible; stars on clear nights
  sky.hemi.intensity = Math.max(sky.hemi.intensity, 0.55 * (1 - day));
  sky.hemi.color.setRGB(0.75 + 0.25 * day, 0.82 + 0.18 * day, 1);
  stars.material.opacity = 0.9 * (1 - day) * (1 - 0.85 * cloudy);
  fogCol.setRGB(0.05 + 0.72 * day, 0.07 + 0.76 * day, 0.09 + 0.8 * day).lerp(new THREE.Color(0.62, 0.64, 0.66), 0.5 * cloudy * day);
  scene.fog.color.copy(fogCol);
  stage.renderer.toneMappingExposure = 0.42 + 0.14 * day + (s.PL > 0 && day < 0.5 ? 0.06 : 0);
  const now = performance.now();
  if (Math.abs(el - lastEnvEl) > 3 || now - lastEnvT > 6000) { stage.updateEnvironmentFrom(sky.sky); lastEnvEl = el; lastEnvT = now; }
  const v = ui.values();
  S3.update({ u: s.u, s: s.s, Tp: s.Tp, PL: s.PL, dose: s.dose, Qheat: s.Qheat, To: s.To, wind: p.wind, Mglass: s.Mglass, thermal: v.thermal });
  // labels, readouts, HUD — throttled during playback
  if (!force && now - lastUi < 110) return;
  lastUi = now;
  updateLabels(s, tH);
  updateReadouts(s, tH);
  if (force || now - lastCursor > 220) { lastCursor = now; PLOTS.forEach(pl => pl.vline('now', tH, { color: 'ink', dash: [2, 3], label: hhmm(tH) })); drawBalance(s, tH); }
}
let camInside = null;
function updateLabels(s, tH) {
  const L = S3.labels, on = ui.get('labels');
  camInside = S3.cameraInside(stage.camera);
  S3.setLabelsVisible(on, camInside);
  if (!on) return;
  const scrTxt = s.s > 0.97 ? 'closed' : s.s > 0.02 ? `${pct(s.s)} % closed (gap)` : 'open';
  L.vents.element.innerHTML = `Roof vents<small>${pct(s.u)} % · ${fmt(s.N, 1)} air changes h⁻¹</small>`;
  L.screen.element.innerHTML = `Energy screen<small>${scrTxt}</small>`;
  L.pipes.element.innerHTML = `Heating pipes<small>${s.Qheat > 1 ? `${fmt(s.Tp, 0)} °C · ${fmt(s.Qheat, 0)} W m⁻²` : 'off'}</small>`;
  L.sensor.element.innerHTML = `Climate box<small>${fmt(s.T, 1)} °C · ${fmt(Math.min(100, s.RH), 0)} % · ${fmt(s.C, 0)} ppm</small>`;
  L.co2.element.innerHTML = `Liquid CO₂ tank<small>${s.dose > 0.01 ? `dosing ${fmt(s.dose * 36, 0)} kg ha⁻¹ h⁻¹` : 'idle'}</small>`;
  L.boiler.element.innerHTML = `Boiler &amp; heat buffer<small>${fmt(s.Qheat * 10, 0)} kW ha⁻¹</small>`;
  L.weather.element.innerHTML = `Weather mast<small>${fmt(s.To, 1)} °C · ${fmt(s.Io, 0)} W m⁻² · ${fmt(p.wind, 1)} m s⁻¹</small>`;
  L.crop.element.innerHTML = `Tomato crop (LAI ${fmt(p.lai, 1)})<small>${fmt(s.E * 3.6e6 / 1000, 2)} L m⁻² h⁻¹ · leaf ${fmt(s.Tcan, 1)} °C</small>`;
}
const pct = v => fmt(Math.abs(v) < 0.005 ? 0 : 100 * v, 0);           // avoids 2e-46 % for numerically-zero actuators
function status(v, okLo, okHi, warnLo, warnHi) { if (v >= okLo && v <= okHi) return 'ok'; if (v >= warnLo && v <= warnHi) return 'warn'; return 'bad'; }
function updateReadouts(s, tH) {
  const S = SIM.sum;
  ro.set('T', s.T, status(s.T, s.Th - 0.7, s.Tv + 4, s.Th - 3, 32), `set-points ${fmt(s.Th, 1)} / ${fmt(s.Tv, 1)} °C · outside ${fmt(s.To, 1)} °C`);
  const RH = Math.min(100, s.RH);
  ro.set('RH', RH, RH <= 85 ? 'ok' : RH <= 90 ? 'warn' : 'bad', `dew point ${fmt(s.Tdew, 1)} °C · ${RH > 90 ? 'Botrytis risk' : RH > 85 ? 'humid' : 'fine'}`);
  ro.set('VPD', s.VPDleaf, status(s.VPDleaf, 0.5, 1.2, 0.3, 1.6), s.VPDleaf < 0.3 ? 'very humid: transpiration stalls' : s.VPDleaf > 1.6 ? 'dry: stomata close' : `leaf ${fmt(s.Tcan, 1)} °C`);
  ro.set('C', s.C, s.C >= 600 ? 'ok' : s.C >= PRM.Co - 30 ? null : 'warn', s.dose > 0.01 ? `dosing ${fmt(s.dose * 36, 0)} kg ha⁻¹ h⁻¹` : s.C < PRM.Co - 20 ? 'below outside: crop is depleting' : 'no dosing');
  ro.set('Q', s.Qheat, s.Qheat > 0.97 * s.Qmax ? 'bad' : null, s.Qheat > 1 ? `pipes ${fmt(s.Tp, 0)} °C · ${fmt(s.Qheat / 100, 2)} MW ha⁻¹` : 'heating off');
  ro.set('u', s.u < 0.005 ? 0 : 100 * s.u, null, `${fmt(s.N, 1)} air changes h⁻¹ · screen ${pct(s.s)} % closed`);
  ro.set('E', s.E * 3600, null, `today ${fmt(S.transp, 2)} L m⁻² d⁻¹`);
  const cr = s.Mcond * 3.6e6;
  ro.set('cond', cr, cr > 5 ? 'warn' : null, `glass ${fmt(s.Tc, 1)} °C vs dew point ${fmt(s.Tdew, 1)} °C`);
  ro.set('U', Math.abs(s.T - s.To) > 3 ? s.Ueff : NaN, null, `wind ${fmt(p.wind, 1)} m s⁻¹ · sky ${fmt(s.Tsky, 0)} °C`);
  ro.set('P', s.Unet, s.Unet > 0 ? 'ok' : null, `today ${fmt(S.uptake, 1)} g CO₂ m⁻² (net)`);
  ro.set('heat', S.heat, null, `${fmt(S.heat * 10, 1)} MWh ha⁻¹ · ≈ ${fmt(S.gas, 2)} m³ gas m⁻²`);
  ro.set('dosed', S.dosed, S.ventFrac > 0.5 ? 'bad' : S.ventFrac > 0.25 ? 'warn' : null, S.dosed > 0.1 ? `${fmt(100 * S.ventFrac, 0)} % lost through vents` : 'no enrichment');
  const Sn = SITES[p.site];
  hud.set('t', `<b>${Sn.name}</b> · ${DATES[p.month]} · solar time <b>${hhmm(tH)}</b>`);
  hud.set('o', `Outside <b>${fmt(s.To, 1)} °C</b> · <b>${fmt(s.Io, 0)}</b> W m⁻² · wind <b>${fmt(p.wind, 1)}</b> m s⁻¹`);
  hud.set('i', `Inside <b>${fmt(s.T, 1)} °C</b> · <b>${fmt(RH, 0)} %</b> RH · <b>${fmt(s.C, 0)}</b> ppm`);
  legend.innerHTML = ui.get('thermal') ? `Pipe surface temperature (false colour)<div class="cbar" style="background:${colormapGradient('inferno')}"></div><div class="cbar-ticks"><span>20 °C</span><span>55</span><span>90 °C</span></div>` : 'Pipes glow with heat output';
}
function drawBalance(s, tH) {
  const cats = ['Sun (absorbed)', 'Heating pipes', 'LED lamps', 'Through the cover', 'Ventilation (sensible)', 'Transpiration (latent)', 'Storage (air, crop, floor)'];
  const vals = [s.Sc + s.Sf + s.Qstr, s.Qheat, s.ScL + s.SfL + s.Lheat, -s.Qcov, -s.Qvs, -s.lamE, -s.storage];
  const colors = ['#e0a526', '#e2672a', '#c85aa6', '#5c8fb5', '#3fa6c9', '#2e9e6b', '#8a8f8c'];
  cBal.set(cats, [{ label: `W m⁻² at ${hhmm(tH)}`, values: vals, colors, format: v => fmt(v, 0) }]);
}

/* ------------------------------------------------------------------ clock and events */
let tNow = ui.get('time');
const clock = new SimClock({ speed: +ui.get('speed'), onStep: dt => { tNow = (tNow + dt / 3600) % 24; }, onFrame: () => { ui.set('time', Math.min(23.95, tNow), true); applyTime(tNow); } });
clock.onState(run => { playBtn.innerHTML = run ? '❚❚ Pause' : '▶ Play the day'; });
stage.onKey('space', () => clock.toggle());
stage.onFrame((dt, t) => {
  if (stage.camera.position.y < 0.35) stage.camera.position.y = 0.35;   // looking up from inside is allowed, going underground is not
  S3.frame(dt, t);
  const ins = S3.cameraInside(stage.camera);
  if (ins !== camInside) { camInside = ins; S3.setLabelsVisible(ui.get('labels'), ins); }
});

ui.onChange((st, id) => {
  if (id === 'time') { tNow = st.time; applyTime(tNow, true); return; }
  if (id === 'speed') { clock.speed = +st.speed; return; }
  if (id === 'labels' || id === 'thermal') { applyTime(tNow, true); return; }
  if (id === 'site' || id === 'month') ui.set('wind', SITES[st.site].months[st.month].wind, true);
  if (MODEL_KEYS.includes(id)) scheduleRecompute();
});

/* ------------------------------------------------------------------ picking: explain components */
const INFO = {
  cover: ['Glass cover', 'Single 4-mm glass, 1.25 m² of cover per m² of floor. It transmits ≈ 72 % of the sun (Eq. G5) and loses heat by convection to the wind and long-wave radiation to the sky (Eq. G2).', s => `glass ${fmt(s.Tc, 1)} °C · U<sub>eff</sub> ${Math.abs(s.T - s.To) > 3 ? fmt(s.Ueff, 2) : '—'} W m⁻² K⁻¹`],
  vents: ['Roof vents', 'Flap windows hinged at the ridge: 10 % of the floor area when fully open. Wind pressure and the stack effect drive the air exchange (Eq. G3).', s => `${pct(s.u)} % open · ${fmt(s.N, 1)} air changes h⁻¹`],
  screen: ['Energy screen', 'Horizontal fabric at gutter height. Closed, it saves the set share of the cover heat loss but traps humid air below it (Eq. G8).', s => `${pct(s.s)} % closed · condensation ${fmt(s.Mcond * 3.6e6, 0)} g m⁻² h⁻¹`],
  pipes: ['Pipe-rail heating', '1.875 m of 51-mm pipe per m² of floor, heated with hot water. Heat leaves by free convection and long-wave radiation (Eq. G4).', s => s.Qheat > 1 ? `${fmt(s.Tp, 1)} °C · ${fmt(s.Qheat, 0)} W m⁻² (${fmt(100 * s.QpRad / Math.max(1, s.Qheat), 0)} % radiation)` : 'off'],
  crop: ['High-wire tomato crop', 'Transpiration follows Penman–Monteith with stomatal resistance responding to light, CO₂ and VPD (Eq. G6); photosynthesis is electron-transport limited (Eq. G9).', s => `${fmt(s.E * 3.6e6 / 1000, 3)} L m⁻² h⁻¹ · net CO₂ uptake ${fmt(s.Unet, 1)} µmol m⁻² s⁻¹`],
  co2: ['CO₂ supply', 'Liquid CO₂ is vaporised and distributed through lay-flat tubes under the gutters, up to 185 kg ha⁻¹ h⁻¹ (Eq. G10).', s => s.dose > 0.01 ? `dosing ${fmt(s.dose * 36, 0)} kg ha⁻¹ h⁻¹ · inside ${fmt(s.C, 0)} ppm` : `idle · inside ${fmt(s.C, 0)} ppm`],
  boiler: ['Boiler house', 'Produces the hot water for the pipes. The white plume is water vapour from the flue gas; it grows with the heat demand.', s => `${fmt(s.Qheat, 0)} W m⁻² = ${fmt(s.Qheat / 100, 2)} MW per hectare`],
  buffer: ['Heat buffer tank', 'Stores hot water so that the boiler can run at a steady rate (or a CHP unit when electricity prices are high).', () => ''],
  weather: ['Weather mast', 'Measures outside temperature, global radiation and wind for the climate computer. The cups spin with the wind speed.', s => `${fmt(s.To, 1)} °C · ${fmt(s.Io, 0)} W m⁻² · ${fmt(p.wind, 1)} m s⁻¹`],
  sensor: ['Aspirated climate box', 'A fan draws crop-level air past shaded dry- and wet-bulb (or capacitive) sensors: the inputs of the climate computer.', s => `${fmt(s.T, 1)} °C · ${fmt(Math.min(100, s.RH), 0)} % RH · ${fmt(s.C, 0)} ppm`],
  lamps: ['LED top-lights', '55 % of the electricity leaves as PAR light, the rest as heat (Katzin, 2021).', s => `${fmt(s.PL, 0)} W m⁻² electric`]
};
stage.onPick({
  objects: () => S3.pick,
  onClick: hit => {
    const key = hit && (hit.object.userData.pickKey || (hit.object.parent && hit.object.parent.userData.pickKey));
    if (!key || !INFO[key]) { info.style.display = 'none'; return; }
    const s = sampleAt(tNow); const [title, text, live] = INFO[key];
    info.innerHTML = `<b style="color:#9be7b6">${title}</b><br>${text}<br><small>${live(s)}</small>`; info.style.display = 'block';
    clearTimeout(info._t); info._t = setTimeout(() => { info.style.display = 'none'; }, 10000);
  }
});

/* ------------------------------------------------------------------ CSV */
function downloadDay() {
  if (!SIM) return;
  const R = SIM.rec; const keys = ['To', 'Io', 'T', 'Tc', 'Tcan', 'Tdew', 'Th', 'Tv', 'RH', 'VPDleaf', 'C', 'Csp', 'u', 's', 'Qheat', 'Tp', 'PL', 'E', 'Mcond', 'N', 'dose', 'Unet', 'Qcov', 'Qvs', 'lamE'];
  const heads = ['solar_time_h', 'T_out_C', 'I_out_W_m2', 'T_in_C', 'T_cover_C', 'T_leaf_C', 'T_dew_C', 'T_heat_sp_C', 'T_vent_sp_C', 'RH_pct', 'VPD_leaf_kPa', 'CO2_ppm', 'CO2_sp_ppm', 'vents_frac', 'screen_frac', 'Q_heat_W_m2', 'T_pipe_C', 'P_lamp_W_m2', 'E_kg_m2_s', 'M_cond_kg_m2_s', 'N_h', 'CO2_dose_mg_m2_s', 'U_net_umol_m2_s', 'Q_cover_W_m2', 'Q_vent_W_m2', 'lamE_W_m2'];
  const rows = Array.from(R.t, (t, i) => [+t.toFixed(3), ...keys.map(k => +(+R[k][i]).toPrecision(5))]);
  downloadCSV(`greenhouse-climate-${p.site}-${p.month}.csv`, heads, rows);
}

/* ------------------------------------------------------------------ go */
recompute();
setTimeout(() => stage.updateEnvironmentFrom(sky.sky), 500);
