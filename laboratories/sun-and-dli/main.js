/* ==========================================================================
   Sun path and daily light integral — solar geometry, climatological
   radiation, greenhouse transmission and supplementary lighting, with a 3D
   greenhouse whose sky, sun, shadows, sun-path diagram and lamps are driven
   by the model (Derive tab, Eqs. D1–D10).

   · solar geometry: declination, hour angle, elevation, azimuth, day length (physics.js; FAO-56 / Spencer 1971)
   · equation of time (Spencer 1971) → clock time incl. EU summer time
   · daily extraterrestrial radiation H0 (FAO-56 eq. 21)
   · monthly clearness index Kt = H/H0: NASA POWER climatology 2001–2020
   · within-day shape: clear-sky air-mass model (Meinel & Meinel, physics.js), scaled so ∫G dt = Kt·H0
   · PPFD = 2.02 µmol J⁻¹ × G (physics.js SUN_PPFD_PER_WM2); inside = τ × outside
   · beam/diffuse split (Erbs et al. 1982) for the 3D lighting
   · supplementary lighting top-up to a DLI target, annual electricity and cost
   ========================================================================== */
import { createStage, addSky, THREE, M, makeGround, makeGreenhouse, makeLEDBar, leafGeometry, leafMaterial, BufferGeometryUtils, RoundedBoxGeometry, surfaceMaterial, canvasTexture, fbm2, rng, fitShadow } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, BarChart, linspace } from '/assets/js/plot.js';
import { declination, earthSunFactor, sunsetHourAngle, dayLength, solarElevation, solarAzimuth, extraterrestrialRadiation, SUN_PPFD_PER_WM2, clamp, deg, rad } from '/assets/js/physics.js';

/** Clear-sky global horizontal irradiance, W m⁻² (Haurwitz 1945, constants as in pvlib-python). elevation in rad.
    Chosen instead of the simple beam + 10 % diffuse air-mass model because that one falls below the all-sky
    climatology at low winter sun (Reno, Hansen & Stein 2012: Haurwitz is the best elevation-only model). */
const clearSkyGHI = el => el <= 0 ? 0 : 1098 * Math.sin(el) * Math.exp(-0.059 / Math.sin(el));

/* ------------------------------------------------------------------ locations and NASA POWER climatology */
// ALLSKY_KT (all-sky insolation clearness index) and ALLSKY_SFC_PAR_TOT (MJ m⁻² d⁻¹), monthly means Jan–Dec,
// NASA POWER Climatology API v2.10, 20-year climatology January 2001 – December 2020 (SYN1deg/POWER), retrieved September 2026.
const LOC = {
  vasteras: { name: 'Västerås, Sweden', lat: 59.61, lon: 16.55, tz: 1, dst: true, veg: 'nordic', kt: [0.28, 0.36, 0.47, 0.50, 0.50, 0.51, 0.49, 0.48, 0.45, 0.38, 0.29, 0.27], par: [0.46, 1.48, 3.75, 6.31, 8.43, 9.6, 8.89, 6.96, 4.44, 2.02, 0.67, 0.28] },
  kiruna: { name: 'Kiruna, Sweden', lat: 67.86, lon: 20.23, tz: 1, dst: true, veg: 'nordic', kt: [0.34, 0.43, 0.53, 0.55, 0.48, 0.44, 0.44, 0.43, 0.40, 0.34, 0.30, 0.29], par: [0.06, 0.82, 3.05, 6.14, 7.81, 8.27, 7.6, 5.48, 3.02, 1.05, 0.16, 0] },
  lund: { name: 'Lund, Sweden', lat: 55.70, lon: 13.19, tz: 1, dst: true, veg: 'nordic', kt: [0.28, 0.34, 0.45, 0.51, 0.52, 0.51, 0.50, 0.49, 0.47, 0.39, 0.29, 0.25], par: [0.74, 1.74, 3.97, 6.78, 8.87, 9.73, 9.08, 7.31, 5.01, 2.5, 0.97, 0.5] },
  amsterdam: { name: 'Amsterdam, Netherlands', lat: 52.37, lon: 4.90, tz: 1, dst: true, veg: 'temperate', kt: [0.32, 0.38, 0.44, 0.50, 0.49, 0.47, 0.48, 0.47, 0.46, 0.40, 0.32, 0.30], par: [1.1, 2.23, 4.29, 6.93, 8.54, 9.05, 8.74, 7.26, 5.18, 2.91, 1.33, 0.83] },
  almeria: { name: 'Almería, Spain', lat: 36.84, lon: -2.46, tz: 1, dst: true, veg: 'arid', kt: [0.57, 0.58, 0.59, 0.60, 0.63, 0.66, 0.65, 0.64, 0.61, 0.58, 0.56, 0.56], par: [4.42, 5.87, 7.76, 9.57, 11.25, 12.37, 11.96, 10.83, 8.67, 6.55, 4.71, 3.96] },
  nairobi: { name: 'Nairobi, Kenya', lat: -1.29, lon: 36.82, tz: 3, dst: false, veg: 'tropical', kt: [0.64, 0.65, 0.63, 0.58, 0.56, 0.52, 0.53, 0.53, 0.59, 0.59, 0.56, 0.61], par: [10.68, 11.16, 10.88, 9.58, 8.71, 7.76, 7.89, 8.42, 9.89, 9.98, 9.48, 10.02] },
  singapore: { name: 'Singapore', lat: 1.35, lon: 103.82, tz: 8, dst: false, veg: 'tropical', kt: [0.46, 0.50, 0.49, 0.49, 0.47, 0.47, 0.46, 0.45, 0.43, 0.44, 0.43, 0.43], par: [7.64, 8.65, 8.67, 8.45, 7.88, 7.53, 7.52, 7.64, 7.51, 7.58, 7.37, 7.1] },
  // any latitude: a site on the 15° E meridian without satellite climatology (cloudiness from the custom Kt slider)
  custom: { name: 'Custom site', lat: 50, lon: 15, tz: 1, dst: false, veg: 'temperate', kt: null, par: null, custom: true }
};
const vegFor = lat => { const a = Math.abs(lat); return a >= 55 ? 'nordic' : a >= 43 ? 'temperate' : a >= 23 ? 'arid' : 'tropical'; };
/** The site for the current settings (the custom site takes its latitude from the slider and a uniform Kt). */
function site(p) {
  const L = LOC[p.loc] || LOC.vasteras;
  if (!L.custom) return L;
  return Object.assign({}, L, { lat: p.lat, veg: vegFor(p.lat), kt: new Array(12).fill(p.kt) });
}
const MID = [15, 45, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];       // mid-month day numbers
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PAR_PHOTONS = 4.57;          // µmol J⁻¹ of PAR energy in sunlight (McCree 1972) — used to convert NASA PAR_TOT
const GH_AREA = 3 * 3.2 * 12;      // m², floor area of the 3D greenhouse (3 spans × 3.2 m × 12 m)

/** Monthly value interpolated linearly (cyclically) between mid-month points → smooth daily series. */
function monthlyInterp(arr, d) {
  let k = MID.findIndex(m => m > d); if (k === -1) k = 12;
  const i0 = (k + 11) % 12, i1 = k % 12; let d0 = MID[i0], d1 = MID[i1];
  if (k === 0) d0 -= 365; if (k === 12) d1 += 365;
  const t = (d - d0) / (d1 - d0); return arr[i0] * (1 - t) + arr[i1] * t;
}
const monthOf = d => { let s = 0; for (let m = 0; m < 12; m++) { s += MDAYS[m]; if (d <= s) return m; } return 11; };
const dateStr = d => { const dt = new Date(Date.UTC(2026, 0, d)); return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`; };
const hhmm = h => { h = ((h % 24) + 24) % 24; let H = Math.floor(h), m = Math.round((h - H) * 60); if (m === 60) { H = (H + 1) % 24; m = 0; } return `${String(H).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };

/* ------------------------------------------------------------------ time: equation of time and clock time (D2) */
function eqTimeMin(d) { const B = 2 * Math.PI * (d - 1) / 365; return 229.18 * (0.000075 + 0.001868 * Math.cos(B) - 0.032077 * Math.sin(B) - 0.014615 * Math.cos(2 * B) - 0.04089 * Math.sin(2 * B)); }
const isDST = (L, d) => L.dst && d >= 88 && d < 298;   // EU summer time 2026: 29 March – 25 October
function clockFromSolar(L, d, ts) { return ts - eqTimeMin(d) / 60 - (L.lon - 15 * L.tz) / 15 + (isDST(L, d) ? 1 : 0); }
function solarFromClock(L, d, tc) { return tc + eqTimeMin(d) / 60 + (L.lon - 15 * L.tz) / 15 - (isDST(L, d) ? 1 : 0); }
const tzName = (L, d) => L.custom ? 'UTC+1' : L.tz === 1 ? (isDST(L, d) ? 'CEST' : 'CET') : `UTC+${L.tz}`;

/* ------------------------------------------------------------------ radiation model */
const GSC = 1367;                  // W m⁻², solar constant consistent with FAO-56 (0.0820 MJ m⁻² min⁻¹)
const NT = 289, DT_H = 24 / (NT - 1);
function erbs(kt) { if (kt <= 0.22) return 1 - 0.09 * kt; if (kt <= 0.8) return 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4; return 0.165; }
function ktFor(p, L, d, H0, ktCs) { if (p.sky === 'clear') return ktCs; if (p.sky === 'custom') return p.kt; return monthlyInterp(L.kt, d); }
/** Radiation over one day (5-min steps): clear-sky shape scaled to the daily total Kt·H0 (D5). */
function dayModel(p, L, d) {
  const ts = linspace(0, 24, NT), el = new Float64Array(NT), az = new Float64Array(NT), gcs = new Float64Array(NT);
  let Icsj = 0;
  for (let i = 0; i < NT; i++) { el[i] = solarElevation(L.lat, d, ts[i]); az[i] = solarAzimuth(L.lat, d, ts[i]); gcs[i] = clearSkyGHI(el[i]); Icsj += gcs[i] * DT_H * 3600 * ((i === 0 || i === NT - 1) ? 0.5 : 1); }
  const H0 = extraterrestrialRadiation(L.lat, d) * 1e6;             // J m⁻² d⁻¹
  const ktCs = H0 > 0 ? Icsj / H0 : 0;
  const kt = ktFor(p, L, d, H0, ktCs);
  const H = kt * H0;                                                 // J m⁻² d⁻¹ (mean sky)
  const scale = Icsj > 0 ? H / Icsj : 0;
  const g = gcs.map(v => v * scale);
  return { ts, el, az, gcs, g, H0, H, kt, ktCs, Hcs: Icsj };
}
function lampPlan(p, dliNat) {
  const need = Math.max(0, p.target - dliNat);
  const hNeed = need * 1e6 / (p.lampPPFD * 3600);
  const h = Math.min(p.maxH, hNeed);
  const dliLamp = p.lampPPFD * h * 3600 / 1e6;
  return { h, hNeed, dliLamp, short: Math.max(0, p.target - dliNat - dliLamp), kwh: p.lampPPFD / p.eff * h / 1000 };
}
/** lamps switch on at both ends of the permitted photoperiod window, centred on solar noon */
function lampsOn(p, h, t) { if (h <= 0) return false; const a = 12 - p.maxH / 2, b = 12 + p.maxH / 2; if (h >= p.maxH - 1e-6) return t >= a && t <= b; return (t >= a && t < a + h / 2) || (t > b - h / 2 && t <= b); }
function yearModel(p, L) {
  const days = [], out = { dliOut: [], dliIn: [], dliTot: [], lampH: [], kwh: [], short: [], dayLen: [], noonEl: [], kt: [] };
  let kwh = 0, hrs = 0, photonsLamp = 0, photonsNat = 0, shortDays = 0, lampDays = 0;
  const monthKwh = new Array(12).fill(0);
  for (let d = 1; d <= 365; d++) {
    const H0 = extraterrestrialRadiation(L.lat, d) * 1e6;
    let kt;
    if (p.sky === 'clear') { let I = 0; for (let t = 0; t <= 24; t += 0.25) I += clearSkyGHI(solarElevation(L.lat, d, t)) * 900; kt = H0 > 0 ? I / H0 : 0; }
    else kt = ktFor(p, L, d, H0, 0);
    const dOut = SUN_PPFD_PER_WM2 * kt * H0 / 1e6;                  // mol m⁻² d⁻¹ (D6)
    const dIn = p.tau * dOut;
    const lp = lampPlan(p, dIn);
    days.push(d); out.kt.push(kt); out.dliOut.push(dOut); out.dliIn.push(dIn); out.dliTot.push(dIn + lp.dliLamp); out.lampH.push(lp.h); out.kwh.push(lp.kwh); out.short.push(lp.short);
    out.dayLen.push(dayLength(L.lat, d)); out.noonEl.push(deg(solarElevation(L.lat, d, 12)));
    kwh += lp.kwh; hrs += lp.h; photonsLamp += lp.dliLamp; photonsNat += dIn; if (lp.short > 0.05) shortDays++; if (lp.h > 0) lampDays++;
    monthKwh[monthOf(d)] += lp.kwh;
  }
  return { days, ...out, kwh, hrs, photonsLamp, photonsNat, shortDays, lampDays, monthKwh };
}

/* ------------------------------------------------------------------ UI */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'sun', label: 'Sun elevation · azimuth', unit: '', format: v => v, note: '&nbsp;' })
  .add({ id: 'daylen', label: 'Day length', unit: 'h', digits: 1, note: '&nbsp;' })
  .add({ id: 'out', label: 'Outside PPFD now', unit: 'µmol m⁻² s⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'in', label: 'Inside PPFD now (sun + lamps)', unit: 'µmol m⁻² s⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'kt', label: 'Clearness index K<sub>t</sub>', unit: '', digits: 2, note: '&nbsp;' })
  .add({ id: 'dli', label: 'Natural DLI inside today', unit: 'mol m⁻² d⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'lamph', label: 'Lamp hours needed today', unit: 'h', digits: 1, note: '&nbsp;' })
  .add({ id: 'kwh', label: 'Lighting electricity per year', unit: 'kWh m⁻² yr⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'cost', label: 'Lighting cost per year', unit: '€ m⁻² yr⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'share', label: 'Share of crop photons from lamps', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'short', label: 'Days below target (lamps at max)', unit: 'd yr⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'pd', label: 'Installed lamp power', unit: 'W m⁻²', digits: 0, note: '&nbsp;' });

ui.section('Location & date');
ui.select({ id: 'loc', label: 'Location', options: Object.entries(LOC).map(([value, L]) => ({ value, label: L.custom ? 'Any latitude (custom site)…' : `${L.name} (${Math.abs(L.lat).toFixed(1)}° ${L.lat >= 0 ? 'N' : 'S'})` })), value: 'vasteras' });
ui.slider({ id: 'lat', label: 'Latitude of the custom site', min: -66, max: 72, step: 0.5, value: 50, format: v => `${Math.abs(v).toFixed(1)}° ${v >= 0 ? 'N' : 'S'}`, help: 'No satellite climatology for a custom site: its cloudiness is the Custom K<sub>t</sub> slider (or choose Clear sky).' });
ui.slider({ id: 'day', label: 'Day of year', min: 1, max: 365, step: 1, value: 172, format: v => `${Math.round(v)} · ${dateStr(Math.round(v))}` });
ui.slider({ id: 'time', label: 'Local solar time', min: 0, max: 24, step: 0.05, value: 12, format: v => hhmm(v), help: 'Solar time: 12:00 = sun due south (north of the equator). Clock time is shown in the scene.' });
const playBtns = ui.buttons([{ label: '▶ Play the day', variant: 'primary', onClick: () => clock.toggle() }, { label: 'Sunrise', onClick: () => jumpTo('rise') }, { label: 'Noon', onClick: () => jumpTo('noon') }]);
ui.segmented({ id: 'speed', label: 'Playback speed', options: [{ value: 1800, label: '½ h/s' }, { value: 5400, label: '1½ h/s' }, { value: 14400, label: '4 h/s' }], value: 5400 });
ui.toggle({ id: 'adv', label: 'Advance the date at midnight', value: false });
ui.section('Sky');
ui.segmented({ id: 'sky', label: 'Cloudiness', options: [{ value: 'clim', label: 'Climatology' }, { value: 'clear', label: 'Clear sky' }, { value: 'custom', label: 'Custom K<sub>t</sub>' }], value: 'clim', help: 'Climatology = NASA POWER monthly clearness index 2001–2020' });
ui.slider({ id: 'kt', label: 'Custom clearness index K<sub>t</sub>', min: 0.08, max: 0.78, step: 0.01, value: 0.35, help: '≈ 0.15 heavy overcast · 0.35 cloudy · 0.5 mixed · 0.7 clear' });
ui.section('Greenhouse & crop');
ui.slider({ id: 'tau', label: 'Greenhouse PAR transmission τ', min: 0.4, max: 0.9, step: 0.01, value: 0.65, help: 'Glazing + frame + gutters + equipment (hemispherical, daily mean)' });
ui.slider({ id: 'target', label: 'Crop DLI target', min: 4, max: 30, step: 0.5, value: 17, unit: 'mol m⁻² d⁻¹', help: 'Lettuce 17 (Both et al. 1997) · microgreens ≈ 6–12 · fruiting tomato ≈ 20–30' });
ui.section('Supplementary lamps');
ui.slider({ id: 'lampPPFD', label: 'Lamp PPFD at canopy', min: 50, max: 400, step: 5, value: 180, unit: 'µmol m⁻² s⁻¹' });
ui.slider({ id: 'eff', label: 'Lamp photon efficacy', min: 1.5, max: 4, step: 0.05, value: 2.8, unit: 'µmol J⁻¹', help: 'HPS ≈ 1.7 · DLC V4.0 minimum 2.5 · good 2025 LED 2.8–3.5' });
ui.slider({ id: 'maxH', label: 'Maximum lamp photoperiod', min: 8, max: 24, step: 0.5, value: 18, unit: 'h d⁻¹' });
ui.slider({ id: 'price', label: 'Electricity price', min: 0.02, max: 0.5, step: 0.01, value: 0.12, unit: '€ kWh⁻¹' });
ui.section('Display');
ui.toggle({ id: 'path', label: 'Show sun-path diagram', value: true });
ui.presets([
  { label: 'Västerås midsummer', values: { loc: 'vasteras', day: 172, time: 12, sky: 'clim' } },
  { label: 'Västerås midwinter', values: { loc: 'vasteras', day: 355, time: 12, sky: 'clim' } },
  { label: 'Kiruna midnight sun', values: { loc: 'kiruna', day: 172, time: 0, sky: 'clear' } },
  { label: 'Almería winter', values: { loc: 'almeria', day: 15, time: 12, sky: 'clim' } },
  { label: 'Singapore equinox', values: { loc: 'singapore', day: 80, time: 12, sky: 'clim' } },
  { label: 'HPS vs LED (Lund, Jan)', values: { loc: 'lund', day: 20, time: 8, eff: 1.7, lampPPFD: 180 } }
]);
ui.saveButton('sun-and-dli', () => ro.values());

/* ------------------------------------------------------------------ 3D scene */
const stage = createStage('#stage', {
  background: null, exposure: 0.5, envIntensity: 0.5,
  camera: { pos: [19, 9.5, 24], target: [0, 2.6, 0], fov: 45, far: 3000 },
  controls: { minDistance: 4, maxDistance: 140, maxPolarAngle: Math.PI * 0.49 },
  bloom: { strength: 0.4, radius: 0.45, threshold: 2.2 }, ao: { radius: 0.3, intensity: 0.6 }
});
const { scene, camera } = stage;
const sky = addSky(stage, { elevation: 40, azimuth: 180, turbidity: 3, sunIntensity: 3.2, shadowSize: 14, updateEnv: false });
fitShadow(sky.sun, 14, [0, 0, 0]); sky.sun.shadow.camera.far = 160; sky.sun.shadow.camera.updateProjectionMatrix();
const hud = hudChips(stage.el);
const legend = document.createElement('div'); legend.className = 'stage-legend'; stage.el.appendChild(legend);

// ground: grass landscape + gravel apron + path
const ground = makeGround({ size: 900, type: 'grass', repeat: [220, 220] }); scene.add(ground);
const apron = new THREE.Mesh(new THREE.PlaneGeometry(15, 18), surfaceMaterial('gravel', [6, 7])); apron.rotation.x = -Math.PI / 2; apron.position.y = 0.012; apron.receiveShadow = true; scene.add(apron);
const path = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 40), surfaceMaterial('concrete', [1, 16])); path.rotation.x = -Math.PI / 2; path.position.set(0, 0.014, 29); path.receiveShadow = true; scene.add(path);

// greenhouse
const gh = makeGreenhouse({ spans: 3, spanWidth: 3.2, length: 12, gutterHeight: 3.6, roofAngle: 22, bays: 4, glassOpacity: 0.11 });
scene.add(gh);
// benches with lettuce (instanced low-poly heads)
function lowLettuce(seed) {
  const r = rng(seed); const geos = []; const n = 9; const R = 0.1;
  for (let k = 0; k < n; k++) {
    const age = 1 - k / n; const len = R * (0.55 + 0.75 * age) * (0.9 + r() * 0.2);
    const g = leafGeometry({ length: len, width: len * 0.95, segU: 6, segV: 4, pitch: 0.3 + 1.0 * age, curl: 0.3 + 0.5 * age, cup: 0.45, ruffle: 0.003, shape: 'round', seed: seed * 50 + k, colors: ['#e3efac', '#9fcb50', '#5f9c30'] });
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(k * 2.39996 + r() * 0.3)); geos.push(g);
  }
  const m = BufferGeometryUtils.mergeGeometries(geos); geos.forEach(g => g.dispose()); return m;
}
const benchMat = M.galvanised(), trayMat = M.plasticWhite();
const lettuceGeos = [lowLettuce(3), lowLettuce(8)]; const lettuceMat = leafMaterial({ gloss: 0.45 });
const heads = [[], []];
for (let s = 0; s < 3; s++) {
  const xc = -4.8 + 1.6 + s * 3.2;
  const top = new THREE.Mesh(new RoundedBoxGeometry(1.75, 0.08, 10.6, 2, 0.02), trayMat); top.position.set(xc, 0.78, 0); top.castShadow = top.receiveShadow = true; scene.add(top);
  for (let k = 0; k < 6; k++) [-1, 1].forEach(sd => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.74, 0.05), benchMat); leg.position.set(xc + sd * 0.8, 0.37, -5 + k * 2); leg.castShadow = true; scene.add(leg); });
  for (let i = 0; i < 5; i++) for (let j = 0; j < 34; j++) heads[(i + j) % 2].push([xc - 0.6 + i * 0.3, -4.95 + j * 0.3, (i * 7 + j * 13) % 11]);
}
heads.forEach((list, k) => {
  const im = new THREE.InstancedMesh(lettuceGeos[k], lettuceMat, list.length); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  list.forEach(([x, z, r], i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * 0.57); const s = 0.9 + (r % 4) * 0.05; sc.set(s, s, s); m4.compose(new THREE.Vector3(x, 0.82, z), q, sc); im.setMatrixAt(i, m4); });
  im.castShadow = true; im.receiveShadow = true; scene.add(im);
});
// supplementary lamps under the gutters: LED bars or HPS luminaires
const lampGroup = new THREE.Group(); scene.add(lampGroup);
makeLEDBar({ length: 0.1, light: 'rect', lightIntensity: 0 });   // initialises the RectAreaLight uniforms (lab3d.js does this on first use)
const lampLights = [];
let lampKind = '';
function buildLamps(kind) {
  lampGroup.clear(); lampLights.length = 0; lampKind = kind;
  const hps = kind === 'hps';
  for (let s = 0; s < 3; s++) for (const dx of [-0.75, 0.75]) for (let k = 0; k < 5; k++) {
    const x = -4.8 + 1.6 + s * 3.2 + dx, z = -4.4 + k * 2.2, y = 3.2;
    if (hps) {
      const g = new THREE.Group();
      const refl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.5), M.aluminium()); g.add(refl);
      const ballast = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.3), M.paintedSteel(0xd8d8d2)); ballast.position.set(0, 0.13, 0); g.add(ballast);
      const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 10), new THREE.MeshStandardMaterial({ color: 0x221100, emissive: 0xffa640, emissiveIntensity: 0 })); bulb.rotation.x = Math.PI / 2; bulb.position.y = -0.05; g.add(bulb);
      g.bulb = bulb; g.position.set(x, y, z); lampGroup.add(g);
    } else {
      const bar = makeLEDBar({ length: 1.1, width: 0.09, color: 'full', light: false });
      bar.rotation.y = Math.PI / 2; bar.position.set(x, y, z); bar.setIntensity(0); lampGroup.add(bar);
    }
  }
  // one broad area light per span for the glow on the crop
  for (let s = 0; s < 3; s++) {
    const L = new THREE.RectAreaLight(hps ? 0xffb35a : 0xff8fd0, 0, 2.2, 10.5); L.position.set(-4.8 + 1.6 + s * 3.2, 3.1, 0); L.rotation.x = -Math.PI / 2; lampGroup.add(L); lampLights.push(L);
  }
}
function setLamps(on, p) {
  const f = on ? Math.min(1.4, p.lampPPFD / 180) : 0;
  lampGroup.children.forEach(o => { if (o.setIntensity) o.setIntensity(on ? 0.9 : 0); if (o.bulb) o.bulb.material.emissiveIntensity = on ? 5 : 0; });
  lampLights.forEach(L => { L.intensity = 6 * f; });
}
// outside sensor on a pole (quantum sensor / pyranometer) with a live label
const pole = new THREE.Group(); pole.position.set(7.2, 0, -6.5); scene.add(pole);
const poleM = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 10), M.galvanised()); poleM.position.y = 1.1; poleM.castShadow = true; pole.add(poleM);
const head = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 20), M.anodised()); head.position.y = 2.22; pole.add(head);
const dome = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, transmission: 0.6, transparent: true })); dome.position.y = 2.25; pole.add(dome);
const outLabel = stage.addLabel(pole, '', { offset: [0, 2.7, 0], className: 'label3d' });
const inLabel = stage.addLabel([0.2, 1.5, 3.2], '', { className: 'label3d lg' });

// vegetation & houses (appearance depends on the climate of the location)
const treeGroup = new THREE.Group(); scene.add(treeGroup);
function buildLandscape(veg) {
  treeGroup.clear();
  const r = rng(veg.length * 17 + 3);
  const n = veg === 'arid' ? 70 : veg === 'tropical' ? 240 : 320;
  const conifer = veg === 'nordic';
  const crownGeo = conifer ? (() => { const a = new THREE.ConeGeometry(1.7, 4.2, 9); a.translate(0, 3.6, 0); const b = new THREE.ConeGeometry(1.25, 3.2, 9); b.translate(0, 5.6, 0); const c = new THREE.ConeGeometry(0.8, 2.4, 9); c.translate(0, 7.3, 0); return BufferGeometryUtils.mergeGeometries([a, b, c]); })()
    : (() => { const g = new THREE.IcosahedronGeometry(2.3, 1); g.scale(1, veg === 'arid' ? 0.55 : 0.85, 1); g.translate(0, veg === 'arid' ? 2.2 : 4.4, 0); return g; })();
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, conifer ? 2.4 : 3.2, 6); trunkGeo.translate(0, conifer ? 1.2 : 1.6, 0);
  const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), n);
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 1 }), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    let a, R;
    if (i < n * 0.7) { a = r() * Math.PI * 2; R = 70 + Math.pow(r(), 0.7) * 200; }
    else { a = (conifer ? -0.9 : 1.2) + (r() - 0.5) * 1.6; R = 40 + r() * 60; }         // a forest edge / grove
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    const s = (conifer ? 1.0 : 0.9) * (0.7 + r() * 0.8);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28); sc.set(s, s * (0.85 + r() * 0.4), s); m4.compose(new THREE.Vector3(x, 0, z), q, sc);
    crown.setMatrixAt(i, m4); trunk.setMatrixAt(i, m4);
    if (conifer) c.setHSL(0.33 + r() * 0.05, 0.35, 0.13 + r() * 0.06); else if (veg === 'arid') c.setHSL(0.18 + r() * 0.05, 0.3, 0.3 + r() * 0.08); else c.setHSL(0.27 + r() * 0.06, 0.5, 0.2 + r() * 0.08);
    crown.setColorAt(i, c);
  }
  crown.castShadow = true; treeGroup.add(crown, trunk);
  // two farmhouses: Falu-red in Sweden, white elsewhere
  const wall = veg === 'nordic' ? 0x8e2a20 : 0xe9e4d8, roofC = veg === 'nordic' ? 0x2b2b2e : veg === 'arid' ? 0xb8643a : 0x5a4a44;
  [[-30, -22, 0.3], [36, -40, -0.5]].forEach(([x, z, rot]) => {
    const hgrp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(9, 4.2, 6), new THREE.MeshStandardMaterial({ color: wall, roughness: 0.85 })); body.position.y = 2.1; body.castShadow = true; body.receiveShadow = true; hgrp.add(body);
    const roofShape = new THREE.Shape(); roofShape.moveTo(-3.4, 0); roofShape.lineTo(0, 2.6); roofShape.lineTo(3.4, 0); roofShape.lineTo(-3.4, 0);
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: 9.6, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: roofC, roughness: 0.7 }));
    roof.rotation.y = Math.PI / 2; roof.position.set(-4.8, 4.2, 0); roof.castShadow = true; hgrp.add(roof);
    if (veg === 'nordic') [[-4.5, 3], [4.5, 3], [-4.5, -3], [4.5, -3]].forEach(([cx, cz]) => { const trim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.25, 0.22), new THREE.MeshStandardMaterial({ color: 0xf2efe8 })); trim.position.set(cx, 2.1, cz); hgrp.add(trim); });
    for (let k = -1; k <= 1; k++) { const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 0.08), new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.2, metalness: 0.3 })); win.position.set(k * 2.6, 2.3, 3.02); hgrp.add(win); }
    hgrp.position.set(x, 0, z); hgrp.rotation.y = rot; treeGroup.add(hgrp);
  });
  ground.material.color.set(veg === 'arid' ? 0xd8c49a : veg === 'tropical' ? 0xb9d8a0 : 0xffffff);
}

// cloud layer (opacity follows the clearness index)
const cloudTex = canvasTexture(512, 512, (ctx, w, h) => {
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h; const tile = (a, b) => fbm2(a * 6, b * 6, 5);
    const n = tile(u, v) * (1 - u) * (1 - v) + tile(u - 1, v) * u * (1 - v) + tile(u, v - 1) * (1 - u) * v + tile(u - 1, v - 1) * u * v;
    const k = (y * w + x) * 4; const a = Math.max(0, Math.min(1, (n - 0.02) / 0.3)) ** 1.5;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.round(255 * a);
  }
  ctx.putImageData(img, 0, 0);
}, { repeat: [3, 3], srgb: true });
const clouds = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0, depthWrite: false, color: 0xffffff, fog: false }));
clouds.rotation.x = Math.PI / 2; clouds.position.y = 260; clouds.renderOrder = -1; scene.add(clouds);

// sun-path diagram (dome centred on the greenhouse)
const R_DOME = 17;
const pathGroup = new THREE.Group(); scene.add(pathGroup);
const dirOf = (elDeg, azDeg) => { const e = rad(elDeg), a = rad(azDeg); return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)); };
function arcPoints(L, d, step = 0.1) {
  const segs = []; let cur = [];
  for (let t = 0; t <= 24.0001; t += step) {
    const e = deg(solarElevation(L.lat, d, t)), a = deg(solarAzimuth(L.lat, d, t));
    if (e >= -0.5) cur.push(dirOf(Math.max(0, e), a).multiplyScalar(R_DOME)); else if (cur.length) { segs.push(cur); cur = []; }
  }
  if (cur.length) segs.push(cur);
  return segs.filter(s => s.length > 1);
}
function tubeFrom(points, radius, mat) { const c = new THREE.CatmullRomCurve3(points); return new THREE.Mesh(new THREE.TubeGeometry(c, Math.max(8, points.length * 2), radius, 8, false), mat); }
const arcMat = new THREE.MeshBasicMaterial({ color: 0xffc04d, toneMapped: false });
const refMats = { jun: new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.55 }), dec: new THREE.MeshBasicMaterial({ color: 0x7ab8ff, transparent: true, opacity: 0.55 }), eq: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 }) };
const sunMarker = new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 16), new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xffc860, emissiveIntensity: 4 })); scene.add(sunMarker);
const sunRay = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineDashedMaterial({ color: 0xffd27a, dashSize: 0.6, gapSize: 0.4 })); scene.add(sunRay);
// horizon ring & compass
const ring = new THREE.Mesh(new THREE.TorusGeometry(R_DOME, 0.05, 6, 160), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; scene.add(ring);
const compass = new THREE.Group(); scene.add(compass);
[['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, a]) => { const v = dirOf(0, a).multiplyScalar(R_DOME + 1.4); v.y = 0.4; stage.addLabel(v, `<b style="font-size:13px">${t}</b>`, { className: 'label3d' }); const tick = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 1.6), new THREE.MeshBasicMaterial({ color: 0xffffff })); tick.position.copy(dirOf(0, a).multiplyScalar(R_DOME)); tick.position.y = 0.05; tick.lookAt(0, 0.05, 0); compass.add(tick); });
let pathKey = '';
function clearLabels(obj) { const labs = []; obj.traverse(o => { if (o.isCSS2DObject) labs.push(o); }); labs.forEach(l => l.removeFromParent()); }
function buildPath(p, L) {
  const key = [p.loc, p.day, L.lat].join('|'); if (key === pathKey) return; pathKey = key;
  clearLabels(pathGroup); pathGroup.clear();
  arcPoints(L, 172, 0.25).forEach(s => pathGroup.add(tubeFrom(s, 0.05, L.lat >= 0 ? refMats.jun : refMats.dec)));
  arcPoints(L, 355, 0.25).forEach(s => pathGroup.add(tubeFrom(s, 0.05, L.lat >= 0 ? refMats.dec : refMats.jun)));
  arcPoints(L, 80, 0.25).forEach(s => pathGroup.add(tubeFrom(s, 0.04, refMats.eq)));
  arcPoints(L, p.day, 0.1).forEach(s => pathGroup.add(tubeFrom(s, 0.13, arcMat)));
  const dotGeo = new THREE.SphereGeometry(0.3, 12, 8);
  for (let h = 0; h < 24; h++) {
    const e = deg(solarElevation(L.lat, p.day, h)); if (e < 0) continue;
    const dot = new THREE.Mesh(dotGeo, arcMat); dot.position.copy(dirOf(e, deg(solarAzimuth(L.lat, p.day, h))).multiplyScalar(R_DOME)); pathGroup.add(dot);
    if (h % (e < 3 ? 3 : 1) === 0 || h === 12) stage.addLabel(dot, `${String(h).padStart(2, '0')}`, { className: 'label3d', offset: [0, 0.9, 0] });
  }
  // labels for the solstice arcs at their noon points
  [[172, L.lat >= 0 ? '21 Jun' : '21 Jun (winter)'], [355, L.lat >= 0 ? '21 Dec' : '21 Dec (summer)']].forEach(([d, t]) => { const e = deg(solarElevation(L.lat, d, 12)); if (e > 1) { const v = dirOf(e, deg(solarAzimuth(L.lat, d, 12.001))).multiplyScalar(R_DOME + 0.8); const o = new THREE.Object3D(); o.position.copy(v); pathGroup.add(o); stage.addLabel(o, `<small style="color:#ffd9a0">${t}</small>`, { className: 'label3d' }); } });
}

/* ------------------------------------------------------------------ charts */
const dayPlot = new Plot('#chart-day', { x: { label: 'Local solar time', unit: 'h', min: 0, max: 24, format: v => hhmm(v) }, y: { label: 'PPFD', unit: 'µmol m⁻² s⁻¹', min: 0 } });
const yearPlot = new Plot('#chart-year', { x: { label: 'Day of year', unit: '', min: 1, max: 365, format: v => dateStr(Math.max(1, Math.round(v))) }, y: { label: 'DLI', unit: 'mol m⁻² d⁻¹', min: 0 } });
const geoPlot = new Plot('#chart-geo', { x: { label: 'Day of year', unit: '', min: 1, max: 365, format: v => dateStr(Math.max(1, Math.round(v))) }, y: { label: 'Day length', unit: 'h', min: 0, max: 24 }, y2: { label: 'Solar-noon elevation', unit: '°', min: -30, max: 90 } });
const monthChart = new BarChart('#chart-month', { y: { label: 'Lighting electricity', unit: 'kWh m⁻²', min: 0 }, legend: false });

/* ------------------------------------------------------------------ update logic */
let DM = null, YM = null, keyDay = '', keyYear = '', lastEnvEl = 999, lastEnvT = 0;
function refreshModels(p, L) {
  const kd = [p.loc, L.lat, p.day, p.sky, p.kt].join('|');
  if (kd !== keyDay) { DM = dayModel(p, L, p.day); keyDay = kd; }
  const ky = [p.loc, L.lat, p.sky, p.kt, p.tau, p.target, p.lampPPFD, p.eff, p.maxH].join('|');
  if (ky !== keyYear) { YM = yearModel(p, L); keyYear = ky; drawYear(p, L); }
}
function drawYear(p, L) {
  const xs = YM.days;
  yearPlot.line('out', xs, YM.dliOut, { color: 'amber', width: 1.6, dash: [5, 4], label: 'Outside (natural)' });
  yearPlot.line('in', xs, YM.dliIn, { color: 'accent', width: 2.4, fill: 0.12, label: 'Inside (natural)' });
  const lampTop = YM.dliIn.map((v, i) => v + (YM.dliTot[i] - v));
  const supLo = YM.dliIn.map(v => Math.min(v, p.target)), supHi = lampTop.map((v, i) => Math.max(supLo[i], Math.min(v, p.target)));
  yearPlot.band('sup', xs, supLo, supHi, { color: 'magenta', alpha: 0.28, label: 'Supplement' });
  yearPlot.band('short', xs, supHi, supHi.map((v, i) => YM.short[i] > 0 ? p.target : v), { color: 'danger', alpha: 0.28, label: 'Shortfall' });
  yearPlot.hline('target', p.target, { color: 'magenta', dash: [6, 4], label: `target ${fmt(p.target, 1)} mol m⁻² d⁻¹` });
  if (p.sky === 'clim' && L.par) yearPlot.scatter('nasa', MID, L.par.map(v => v * PAR_PHOTONS), { color: 'amber', r: 4, shape: 'diamond', label: 'NASA POWER PAR × 4.57 (outside)' }); else yearPlot.remove('nasa');
  geoPlot.line('dl', xs, YM.dayLen, { color: 'water', width: 2.4, label: 'Day length' });
  geoPlot.line('ne', xs, YM.noonEl, { color: 'amber', width: 2.2, y2: true, label: 'Solar-noon elevation' });
  geoPlot.hline('h12', 12, { color: 'muted', dash: [2, 4], label: '' });
  monthChart.set(MONTHS, [{ label: 'kWh m⁻²', values: YM.monthKwh, color: 'magenta', format: v => v >= 10 ? v.toFixed(0) : v.toFixed(1) }]);
}
function drawDay(p, L, t) {
  const ts = DM.ts; const lp = lampPlan(p, p.tau * SUN_PPFD_PER_WM2 * DM.H / 1e6);
  const outCs = Array.from(DM.gcs).map(v => v * SUN_PPFD_PER_WM2), out = Array.from(DM.g).map(v => v * SUN_PPFD_PER_WM2);
  const inn = out.map(v => v * p.tau); const tot = inn.map((v, i) => v + (lampsOn(p, lp.h, ts[i]) ? p.lampPPFD : 0));
  dayPlot.line('cs', ts, outCs, { color: 'amber', width: 1.4, dash: [4, 4], label: 'Outside, clear sky' });
  dayPlot.line('out', ts, out, { color: 'amber', width: 2.2, label: p.sky === 'clear' ? 'Outside' : `Outside, K${'ₜ'} = ${fmt(DM.kt, 2)}` });
  dayPlot.band('lampband', ts, inn, tot, { color: 'magenta', alpha: 0.28, label: '' });
  dayPlot.line('tot', ts, tot, { color: 'magenta', width: 1.6, label: 'Inside + lamps' });
  dayPlot.line('in', ts, inn, { color: 'accent', width: 2.4, fill: 0.14, label: 'Inside (natural)' });
  const rise = 12 - deg(sunsetHourAngle(L.lat, p.day)) / 15;
  if (rise > 0.01 && rise < 11.99) { dayPlot.region('night1', 0, rise, { color: 'ink', alpha: 0.05 }); dayPlot.region('night2', 24 - rise, 24, { color: 'ink', alpha: 0.05 }); } else { dayPlot.remove('night1'); dayPlot.remove('night2'); if (rise >= 11.99) dayPlot.region('night1', 0, 24, { color: 'ink', alpha: 0.05 }); }
  dayPlot.vline('now', t, { color: 'ink', dash: [2, 3], label: hhmm(t) });
  yearPlot.vline('now', p.day, { color: 'ink', dash: [2, 3], label: dateStr(p.day) });
  geoPlot.vline('now', p.day, { color: 'ink', dash: [2, 3], label: '' });
  return lp;
}
function jumpTo(what) {
  const p = ui.values(); const L = site(p); const ws = deg(sunsetHourAngle(L.lat, p.day)) / 15;
  const t = what === 'noon' ? 12 : ws > 0 && ws < 12 ? 12 - ws + 0.02 : 0;
  ui.set('time', t);
}

function applyTime(p, L, t, lp) {
  const el = deg(solarElevation(L.lat, p.day, t)), az = deg(solarAzimuth(L.lat, p.day, t));
  const i = Math.max(0, Math.min(NT - 1, Math.round(t / DT_H)));
  const gNow = DM.g[i], gCs = DM.gcs[i];
  const outNow = SUN_PPFD_PER_WM2 * gNow, lampOn = lampsOn(p, lp.h, t);
  const inNow = p.tau * outNow + (lampOn ? p.lampPPFD : 0);
  // sky, sun and lighting
  sky.setSun(el, az);
  const g0h = GSC * earthSunFactor(p.day) * Math.max(0, Math.sin(rad(el)));
  const ktNow = g0h > 1 ? Math.min(1, gNow / g0h) : DM.kt;
  const kdNow = erbs(ktNow);
  const kdClear = erbs(g0h > 1 ? Math.min(1, gCs / g0h) : 0.7);
  const beamRel = gCs > 1 ? (gNow * (1 - kdNow)) / (gCs * (1 - kdClear)) : 0;
  sky.sun.intensity *= Math.max(0.03, Math.min(1.1, beamRel));
  sky.hemi.intensity *= 0.65 + 0.6 * kdNow;
  const cloudiness = p.sky === 'clear' ? 0 : clamp((0.72 - DM.kt) / 0.55, 0, 1);
  const u = sky.sky.material.uniforms; u.turbidity.value = 2.5 + 8 * cloudiness; u.rayleigh.value = 1.6 + 1.6 * cloudiness;
  clouds.material.opacity = Math.min(0.95, 1.2 * cloudiness) * (el > -6 ? 1 : 0.4);
  clouds.material.color.setScalar(el > 0 ? 0.55 + 0.45 * Math.min(1, el / 25) : 0.25);
  // environment map from the sky, throttled
  const now = performance.now();
  if (Math.abs(el - lastEnvEl) > 2.5 || now - lastEnvT > 4000) { stage.updateEnvironmentFrom(sky.sky); lastEnvEl = el; lastEnvT = now; }
  // sun marker & ray
  const v = dirOf(Math.max(-2, el), az).multiplyScalar(R_DOME);
  sunMarker.position.copy(v); sunMarker.visible = el > -1 && p.path;
  sunRay.geometry.setFromPoints([new THREE.Vector3(0, 0.1, 0), v]); sunRay.computeLineDistances(); sunRay.visible = el > 0 && p.path;
  pathGroup.visible = p.path; ring.visible = p.path; compass.visible = p.path;
  gh.setVents(clamp((gNow - 250) / 450, 0, 1));
  setLamps(lampOn, p);
  // labels & HUD
  const tc = clockFromSolar(L, p.day, t);
  const elR = +(Math.round(el * 10) / 10).toFixed(1), azR = ((Math.round(az) % 360) + 360) % 360;   // tidy display (no 1e-4 artefacts)
  outLabel.element.innerHTML = `Outside<small>${fmt(outNow, 0)} µmol m⁻² s⁻¹</small>`;
  inLabel.element.innerHTML = `Crop inside the glasshouse<small>${fmt(inNow, 0)} µmol m⁻² s⁻¹${lampOn ? ' · lamps on' : ''}</small>`;
  hud.set('t', `<b>${dateStr(p.day)}</b> · solar <b>${hhmm(t)}</b> · clock <b>${hhmm(tc)}</b> ${tzName(L, p.day)}`);
  hud.set('s', `Sun el <b>${fmt(elR, 1)}°</b> az <b>${fmt(azR, 0)}°</b> · ${el > 0 ? `diffuse <b>${fmt(100 * kdNow, 0)}</b> %` : 'below horizon'}`);
  hud.set('p', `PPFD out <b>${fmt(outNow, 0)}</b> · in <b>${fmt(inNow, 0)}</b>${lampOn ? ' <b style="color:#f7a8e0">+ lamps</b>' : ''}`);
  ro.set('sun', `${fmt(elR, 1)}° · ${fmt(azR, 0)}°`, el > 0 ? 'ok' : null, el > 0 ? `solar noon elevation ${fmt(deg(solarElevation(L.lat, p.day, 12)), 1)}°` : 'sun below the horizon');
  ro.items.sun.value = el;
  ro.set('out', outNow, null, `clear-sky ${fmt(SUN_PPFD_PER_WM2 * gCs, 0)} · global ${fmt(gNow, 0)} W m⁻²`);
  ro.set('in', inNow, lampOn ? 'warn' : null, `τ = ${fmt(p.tau, 2)}${lampOn ? ` · lamps ${fmt(p.lampPPFD, 0)}` : ''}`);
  dayPlot.vline('now', t, { color: 'ink', dash: [2, 3], label: hhmm(t) });
}

function update() {
  const p = ui.values(); const L = site(p);
  ui.enable('kt', p.sky === 'custom' || (!!L.custom && p.sky === 'clim')); ui.show('lat', !!L.custom);
  const kind = p.eff < 2.1 ? 'hps' : 'led'; if (kind !== lampKind) buildLamps(kind);
  if (buildLandscape.last !== L.veg) { buildLandscape(L.veg); buildLandscape.last = L.veg; }
  refreshModels(p, L); buildPath(p, L);
  const lp = drawDay(p, L, p.time);
  const dliOut = SUN_PPFD_PER_WM2 * DM.H / 1e6, dliIn = p.tau * dliOut;
  const dl = dayLength(L.lat, p.day); const ws = deg(sunsetHourAngle(L.lat, p.day)) / 15;
  ro.set('daylen', dl, null, dl > 0.01 && dl < 23.99 ? `sunrise ${hhmm(clockFromSolar(L, p.day, 12 - ws))} · sunset ${hhmm(clockFromSolar(L, p.day, 12 + ws))} ${tzName(L, p.day)}` : dl >= 23.99 ? 'midnight sun' : 'polar night');
  ro.set('kt', DM.kt, null, p.sky === 'clim' && !L.custom ? `NASA POWER, ${MONTHS[monthOf(p.day)]} (clear-sky model ${fmt(DM.ktCs, 2)})` : p.sky === 'clear' ? 'clear-sky model' : `custom (clear-sky model ${fmt(DM.ktCs, 2)})`);
  ro.set('dli', dliIn, dliIn >= p.target ? 'ok' : dliIn >= 0.5 * p.target ? 'warn' : 'bad', `outside ${fmt(dliOut, 1)} · target ${fmt(p.target, 1)}`);
  ro.set('lamph', lp.h, lp.hNeed > p.maxH ? 'bad' : lp.h > 0 ? 'warn' : 'ok', lp.hNeed > p.maxH ? `needs ${fmt(lp.hNeed, 1)} h — shortfall ${fmt(lp.short, 1)} mol` : `${fmt(lp.kwh, 2)} kWh m⁻² today`);
  ro.set('kwh', YM.kwh, null, `${fmt(YM.lampDays, 0)} lit days · ${fmt(YM.hrs, 0)} lamp h yr⁻¹`);
  ro.set('cost', YM.kwh * p.price, null, `${fmt(YM.kwh * p.price * GH_AREA, 0)} € yr⁻¹ for this ${fmt(GH_AREA, 0)} m² glasshouse`);
  const share = 100 * YM.photonsLamp / Math.max(1e-9, YM.photonsLamp + YM.photonsNat);
  ro.set('share', share, null, `annual crop light ${fmt(YM.photonsLamp + YM.photonsNat, 0)} mol m⁻² yr⁻¹`);
  ro.set('short', YM.shortDays, YM.shortDays > 0 ? 'bad' : 'ok', YM.shortDays > 0 ? 'raise lamp PPFD or hours' : 'target met every day');
  ro.set('pd', p.lampPPFD / p.eff, null, p.eff < 2.1 ? 'HPS-class efficacy' : 'LED');
  legend.innerHTML = `<b>${L.name}</b> · ${fmt(Math.abs(L.lat), 2)}° ${L.lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(L.lon), 2)}° ${L.lon >= 0 ? 'E' : 'W'}<br>sun path: <span style="color:#ffc04d">today</span> · <span style="color:#ff9a3c">21 Jun</span> · <span style="color:#7ab8ff">21 Dec</span> · <span style="color:#fff">equinox</span>`;
  applyTime(p, L, p.time, lp);
  curLp = lp;
}
let curLp = null;

/* ------------------------------------------------------------------ simulation clock: play the day */
const clock = new SimClock({
  speed: 5400,
  onStep: dt => {
    const p = ui.values(); let t = p.time + dt / 3600;
    if (t >= 24) { t -= 24; if (p.adv) { ui.set('day', p.day % 365 + 1, true); } }
    ui.set('time', t, true);
  },
  onFrame: () => { const p = ui.values(); const L = site(p); if (p.adv) { refreshModels(p, L); buildPath(p, L); const lp = drawDay(p, L, p.time); curLp = lp; update(); } else applyTime(p, L, p.time, curLp || lampPlan(p, 0)); }
});
clock.onState(run => { playBtns[0].innerHTML = run ? '❚❚ Pause' : '▶ Play the day'; });
stage.onKey('space', () => clock.toggle());
let raf = 0;
ui.onChange((st, id) => { if (id === 'speed') clock.speed = +st.speed; cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
clock.speed = +ui.get('speed');
update();
// keep a steady environment after first frame
setTimeout(() => stage.updateEnvironmentFrom(sky.sky), 400);
