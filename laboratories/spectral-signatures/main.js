/* Spectral signatures — interactive reflectance spectra 400–2500 nm with sensor bands, indices, saturation and mixing.
   Physics in ./spectra.js (PROSPECT-D leaf, Kubelka–Munk canopy, measured soils, water and snow models, sensor bands).
   Derive tab: Eqs. S1–S9. */
import { Controls, Readouts, fmt, stageToolbar } from '/assets/js/ui.js';
import { Plot, BarChart, linspace, downloadCSV } from '/assets/js/plot.js';
import { palette, wavelengthCSS, wavelengthToRGB, withAlpha, isDark } from '/assets/js/colors.js';
import * as SP from './spectra.js';

const $ = s => document.querySelector(s);
const SURF = SP.SURFACES;
const SURF_KEYS = Object.keys(SURF);

/* ================================================================ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'NDVI', label: 'NDVI', digits: 3 })
  .add({ id: 'NDRE', label: 'NDRE (red edge)', digits: 3 })
  .add({ id: 'EVI', label: 'EVI', digits: 3 })
  .add({ id: 'SAVI', label: 'SAVI (L = 0.5)', digits: 3 })
  .add({ id: 'GNDVI', label: 'GNDVI', digits: 3 })
  .add({ id: 'NDWI', label: 'NDWI (Gao, NIR–SWIR)', digits: 3 })
  .add({ id: 'rep', label: 'Red-edge inflection point', unit: 'nm', digits: 1 })
  .add({ id: 'mix', label: 'NDVI of the mixed pixel', digits: 3 });

ui.section('Spectra on the chart');
const SHOW_DEF = { healthy: true, stressed: true, senescent: true, soilDry: true, soilWet: true, water: true, snow: true };
SURF_KEYS.forEach(k => ui.toggle({ id: 'show_' + k, label: `<span style="display:inline-block;width:18px;height:3px;border-radius:2px;background:${SURF[k].color};vertical-align:middle;margin-right:8px"></span>${SURF[k].label}`, value: SHOW_DEF[k] }));
ui.select({ id: 'focus', label: 'Spectrum analysed (band values and indices)', options: SURF_KEYS.map(k => ({ value: k, label: SURF[k].label })).concat([{ value: 'mixed', label: 'Mixed pixel (vegetation + soil)' }]), value: 'healthy' });
ui.select({ id: 'sensor', label: 'Sensor bands', options: Object.entries(SP.SENSORS).map(([value, s]) => ({ value, label: s.name })), value: 's2', help: 'Band-averaged reflectances are plotted as bars; indices that need a band the sensor lacks show “—”.' });

ui.section('Healthy crop — leaf (PROSPECT-D)');
ui.slider({ id: 'cab', label: 'Chlorophyll a+b, C<sub>ab</sub>', min: 0, max: 100, step: 1, value: 45, unit: 'µg cm⁻²', help: 'Well-fertilised cereal leaves 40–60; N-deficient 15–30' });
ui.slider({ id: 'car', label: 'Carotenoids, C<sub>car</sub>', min: 0, max: 25, step: 0.5, value: 10, unit: 'µg cm⁻²' });
ui.slider({ id: 'cw', label: 'Equivalent water thickness, C<sub>w</sub>', min: 0.001, max: 0.05, step: 0.001, value: 0.015, unit: 'cm', help: 'Turgid crop leaves 0.01–0.02 cm; drying leaves < 0.008' });
ui.slider({ id: 'cm', label: 'Dry matter per area, C<sub>m</sub>', min: 0.001, max: 0.02, step: 0.0005, value: 0.005, unit: 'g cm⁻²', digits: 4 });
ui.slider({ id: 'N', label: 'Leaf structure parameter, N', min: 1, max: 3, step: 0.05, value: 1.5, help: 'Number of elementary layers: 1–1.5 thin monocot leaves, 2–2.5 thick dicot or senescent leaves' });
ui.slider({ id: 'brown', label: 'Brown pigments', min: 0, max: 1, step: 0.01, value: 0, unit: '(a.u.)' });
ui.slider({ id: 'ant', label: 'Anthocyanins', min: 0, max: 15, step: 0.5, value: 0, unit: 'µg cm⁻²' });
ui.section('Canopy and background');
ui.slider({ id: 'lai', label: 'Leaf area index, LAI', min: 0, max: 8, step: 0.05, value: 3, unit: 'm² m⁻²', help: 'Applies to all three canopies, so their differences come from leaf chemistry only' });
ui.slider({ id: 'soilw', label: 'Soil moisture (dry → wet reference soil)', min: 0, max: 1, step: 0.01, value: 0.3 });
ui.slider({ id: 'soilb', label: 'Soil brightness factor', min: 0.5, max: 1.3, step: 0.01, value: 1 });
ui.slider({ id: 'fveg', label: 'Vegetation fraction in the mixed pixel, f', min: 0, max: 1, step: 0.01, value: 0.5, help: 'Linear mixture of the healthy canopy and the soil background (Eq. S4)' });
ui.section('Water and snow');
ui.slider({ id: 'bbp', label: 'Particle backscattering b<sub>bp</sub>(550)', min: 0.001, max: 1, log: true, value: 0.01, unit: 'm⁻¹', format: v => v < 0.01 ? v.toFixed(4) : v.toFixed(3), help: '0.001–0.01 clear lake; 0.1–1 turbid river after rain' });
ui.slider({ id: 'ag', label: 'Coloured dissolved organic matter a<sub>g</sub>(440)', min: 0, max: 8, step: 0.1, value: 0.5, unit: 'm⁻¹', help: 'Brown humic Swedish forest lakes often 2–8' });
ui.slider({ id: 'grain', label: 'Snow grain radius', min: 30, max: 2000, log: true, value: 150, unit: 'µm', format: v => v.toFixed(0), help: 'Fresh snow 30–100 µm; old, melting snow 500–1500 µm' });
ui.section('Display');
ui.segmented({ id: 'ymax', label: 'Reflectance axis', options: [{ value: 1, label: '0 – 1' }, { value: 0.7, label: '0 – 0.7' }, { value: 0.3, label: '0 – 0.3' }], value: 1 });
ui.toggle({ id: 'annot', label: 'Label spectral features', value: true });
ui.toggle({ id: 'leafrt', label: 'Show leaf reflectance and transmittance', value: false });
ui.toggle({ id: 'showmix', label: 'Show the mixed-pixel spectrum', value: true });
ui.toggle({ id: 'atmo', label: 'Shade atmospheric water-vapour bands', value: true });
ui.presets([
  { label: 'Wheat at canopy closure', values: { cab: 50, car: 11, cw: 0.016, cm: 0.005, N: 1.5, brown: 0, ant: 0, lai: 4, soilw: 0.3, focus: 'healthy' } },
  { label: 'Nitrogen-deficient wheat', values: { cab: 22, car: 7, cw: 0.015, cm: 0.005, N: 1.5, brown: 0, ant: 0, lai: 2, soilw: 0.3, focus: 'healthy' } },
  { label: 'Drought-stressed canopy', values: { cab: 35, car: 9, cw: 0.006, cm: 0.006, N: 1.6, brown: 0.1, ant: 0, lai: 2.2, soilw: 0, focus: 'healthy' } },
  { label: 'Emerging crop on wet soil', values: { cab: 40, car: 9, cw: 0.014, cm: 0.004, N: 1.4, brown: 0, ant: 0, lai: 0.4, soilw: 0.9, fveg: 0.2, focus: 'healthy' } },
  { label: 'Ripening wheat', values: { cab: 6, car: 4, cw: 0.004, cm: 0.007, N: 2, brown: 0.8, ant: 0, lai: 3, soilw: 0.1, focus: 'healthy' } },
  { label: 'Autumn leaves (anthocyanins)', values: { cab: 15, car: 12, cw: 0.012, cm: 0.006, N: 1.8, brown: 0.2, ant: 8, lai: 3, soilw: 0.3, focus: 'healthy' } }
]);
ui.buttons([{ label: 'Download spectra (CSV)', onClick: () => exportCSV() }]);
ui.saveButton('spectral-signatures', () => ro.values());

/* ================================================================ model */
let M = null;   // current model state
function compute(p = ui.values()) {
  const leafH = SP.prospectD({ N: p.N, cab: p.cab, car: p.car, ant: p.ant, brown: p.brown, cw: p.cw, cm: p.cm });
  const leafS = SP.prospectD(SP.LEAF_STRESSED), leafX = SP.prospectD(SP.LEAF_SENESCENT);
  const soil = SP.soilSpectrum(p.soilw, p.soilb);
  const spec = {
    healthy: SP.canopySpectrum(leafH, p.lai, soil),
    stressed: SP.canopySpectrum(leafS, p.lai, soil),
    senescent: SP.canopySpectrum(leafX, p.lai, soil),
    soilDry: SP.soilSpectrum(0, p.soilb),
    soilWet: SP.soilSpectrum(1, p.soilb),
    water: SP.waterSpectrum({ bbp550: p.bbp, ag440: p.ag }),
    snow: SP.snowSpectrum({ grain: p.grain })
  };
  const f = p.fveg;
  spec.mixed = spec.healthy.map((v, i) => f * v + (1 - f) * soil[i]);
  return { p, leafH, soil, spec };
}
const focusSpec = () => M.spec[M.p.focus] || M.spec.healthy;

/* ================================================================ stage (canvas spectral plot) */
const stageEl = $('#stage');
const cv = $('#spec'); const ctx = cv.getContext('2d');
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'spectral-signatures.png'; a.click(); } });
let hover = null;   // wavelength under the pointer
const ATMO = [[1340, 1460], [1790, 1960]];
const bandFill = (c, a) => c < 700 ? wavelengthCSS(Math.max(400, c), a) : c < 1300 ? `rgba(176,58,142,${a})` : `rgba(191,122,24,${a})`;
const bandInk = c => {
  if (c >= 700) return c < 1300 ? (isDark() ? '#e07ac4' : '#a3337f') : (isDark() ? '#f2b94b' : '#a8650c');
  const [r, g, b] = wavelengthToRGB(Math.max(420, Math.min(690, c))); const k = isDark() ? 1 : 0.66;
  const m = v => Math.round(isDark() ? v + (255 - v) * 0.25 : v * k);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
};

let legendRows = 2;
function legendItems(p, dark) {
  const items = SURF_KEYS.filter(k => p['show_' + k] || k === p.focus).map(k => [SURF[k].label, SURF[k].color, k === p.focus, []]);
  if (p.showmix) items.push([`Mixed pixel (f = ${p.fveg.toFixed(2)})`, dark ? '#f07ad0' : '#b23f8c', p.focus === 'mixed', [7, 5]]);
  if (p.leafrt) { items.push(['Leaf R', '#2f9e44', false, [6, 4]]); items.push(['Leaf T', '#2f9e44', false, [2, 3]]); }
  return items;
}
function layoutLegend(items, L, maxX) {
  ctx.font = '600 11.5px Inter, sans-serif';
  let lx = L, row = 0; const pos = [];
  items.forEach(it => { const w = ctx.measureText(it[0]).width + 34; if (lx + w > maxX && lx > L) { lx = L; row++; } pos.push([lx, row]); lx += w; });
  return { pos, rows: row + 1 };
}
function geom() {
  const W = stageEl.clientWidth, H = stageEl.clientHeight;
  const L = 60, R = 22, T = 20 + legendRows * 17 + 42, B = 78;
  return { W, H, L, R, T, B, pw: W - L - R, ph: H - T - B };
}
function draw() {
  if (!M) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const P = palette(), dark = isDark(), p = M.p, ymax = +p.ymax;
  const LEG = layoutLegend(legendItems(p, dark), 60, stageEl.clientWidth - 130); legendRows = LEG.rows;
  const G = geom(); if (G.pw < 50 || G.ph < 50) return;
  if (cv.width !== Math.round(G.W * dpr) || cv.height !== Math.round(G.H * dpr)) { cv.width = Math.round(G.W * dpr); cv.height = Math.round(G.H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const X = nm => G.L + (nm - 400) / 2100 * G.pw, Y = r => G.T + (1 - r / ymax) * G.ph;
  ctx.clearRect(0, 0, G.W, G.H);
  ctx.fillStyle = P.bgElev || '#fff'; ctx.fillRect(0, 0, G.W, G.H);
  // atmospheric bands
  if (p.atmo) ATMO.forEach(([a, b]) => {
    ctx.save(); ctx.beginPath(); ctx.rect(X(a), G.T, X(b) - X(a), G.ph); ctx.clip();
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.045)'; ctx.fillRect(X(a), G.T, X(b) - X(a), G.ph);
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.09)'; ctx.lineWidth = 1;
    for (let x = X(a) - G.ph; x < X(b); x += 7) { ctx.beginPath(); ctx.moveTo(x, G.T + G.ph); ctx.lineTo(x + G.ph, G.T); ctx.stroke(); }
    ctx.restore();
    ctx.save(); ctx.translate((X(a) + X(b)) / 2, G.T + 8); ctx.rotate(-Math.PI / 2); ctx.fillStyle = P.muted; ctx.font = '500 10.5px Inter, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText('atmosphere opaque (H₂O vapour)', 0, 0); ctx.restore();
  });
  // grid
  ctx.strokeStyle = P.line; ctx.lineWidth = 1; ctx.beginPath();
  for (let nm = 400; nm <= 2500; nm += 100) { const x = Math.round(X(nm)) + 0.5; ctx.moveTo(x, G.T); ctx.lineTo(x, G.T + G.ph); }
  const ystep = ymax > 0.5 ? 0.1 : ymax > 0.2 ? 0.05 : 0.025;
  for (let r = 0; r <= ymax + 1e-9; r += ystep) { const y = Math.round(Y(r)) + 0.5; ctx.moveTo(G.L, y); ctx.lineTo(G.L + G.pw, y); }
  ctx.stroke();
  // sensor bands
  const S = SP.SENSORS[p.sensor];
  const fs = focusSpec(); const bv = SP.sensorBands(fs, p.sensor);
  let lastX = -99, lift = 0;
  const bands = S.bands.slice().sort((a, b) => SP.bandCentre(a) - SP.bandCentre(b));
  bands.forEach(b => {
    const c = SP.bandCentre(b), w = SP.bandWidth(b);
    const x0 = X(c - w / 2), x1 = X(c + w / 2);
    if (b.shape === 'gauss') {
      ctx.beginPath(); ctx.moveTo(X(c - 1.5 * w), G.T + G.ph);
      for (let nm = c - 1.5 * w; nm <= c + 1.5 * w; nm += 2) ctx.lineTo(X(nm), G.T + G.ph - 0.9 * G.ph * Math.exp(-4 * Math.LN2 * ((nm - c) / w) ** 2));
      ctx.lineTo(X(c + 1.5 * w), G.T + G.ph); ctx.closePath(); ctx.fillStyle = bandFill(c, dark ? 0.16 : 0.13); ctx.fill();
    } else { ctx.fillStyle = bandFill(c, dark ? 0.17 : 0.13); ctx.fillRect(x0, G.T, Math.max(1.5, x1 - x0), G.ph); }
    const xc = X(c); lift = xc - lastX < 22 ? (lift ? 0 : 12) : 0; lastX = xc;
    ctx.fillStyle = bandInk(c); ctx.font = '600 10.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(b.id, xc, G.T - 4 - lift);
    // band-averaged value of the analysed spectrum
    const v = bv[b.id]; if (v <= ymax) {
      const y = Y(v); ctx.strokeStyle = dark ? '#ffffff' : '#10201a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(Math.min(x0, xc - 3), y); ctx.lineTo(Math.max(x1, xc + 3), y); ctx.stroke();
      ctx.strokeStyle = bandInk(c); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(Math.min(x0, xc - 3), y); ctx.lineTo(Math.max(x1, xc + 3), y); ctx.stroke();
      ctx.fillStyle = bandInk(c); ctx.beginPath(); ctx.arc(xc, y, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = dark ? '#0b1210' : '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
    }
  });
  // curves
  ctx.save(); ctx.beginPath(); ctx.rect(G.L, G.T - 2, G.pw, G.ph + 4); ctx.clip();
  const line = (arr, color, width, dash = []) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.lineJoin = 'round'; ctx.beginPath();
    for (let i = 0; i < SP.NWL; i++) { const x = X(SP.WL[i]), y = Y(Math.min(ymax * 1.02, arr[i])); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
  };
  if (p.leafrt) { line(M.leafH.R, '#2f9e44', 1.4, [6, 4]); line(M.leafH.T, '#2f9e44', 1.4, [2, 3]); }
  SURF_KEYS.forEach(k => { if (p['show_' + k] && k !== p.focus) line(M.spec[k], SURF[k].color, 1.7); });
  if (p.showmix) line(M.spec.mixed, dark ? '#f07ad0' : '#b23f8c', 1.8, [7, 5]);
  const fc = p.focus === 'mixed' ? (dark ? '#f07ad0' : '#b23f8c') : SURF[p.focus].color;
  if (p.focus !== 'mixed' || p.showmix) { ctx.shadowColor = withAlpha(fc.startsWith('#') ? fc : '#888888', 0.45); ctx.shadowBlur = 6; line(M.spec[p.focus], fc, 3); ctx.shadowBlur = 0; }
  ctx.restore();
  // axes & labels
  ctx.strokeStyle = P.lineStrong || P.muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(G.L + 0.5, G.T); ctx.lineTo(G.L + 0.5, G.T + G.ph + 0.5); ctx.lineTo(G.L + G.pw, G.T + G.ph + 0.5); ctx.stroke();
  ctx.fillStyle = P.muted; ctx.font = "500 10.5px 'JetBrains Mono', monospace"; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let r = 0; r <= ymax + 1e-9; r += ystep * (ymax > 0.5 ? 2 : 2)) ctx.fillText(r.toFixed(ymax > 0.5 ? 1 : 2), G.L - 6, Y(r));
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let nm = 400; nm <= 2500; nm += 200) ctx.fillText(nm, X(nm), G.T + G.ph + 5);
  // visible colour bar + regions
  const yb = G.T + G.ph + 22;
  for (let nm = 400; nm < 700; nm += 2) { ctx.fillStyle = wavelengthCSS(nm, 1); ctx.fillRect(X(nm), yb, X(nm + 2) - X(nm) + 0.6, 7); }
  ctx.fillStyle = 'rgba(176,58,142,0.55)'; ctx.fillRect(X(700), yb, X(1300) - X(700), 7);
  ctx.fillStyle = 'rgba(191,122,24,0.55)'; ctx.fillRect(X(1300), yb, X(2500) - X(1300), 7);
  ctx.fillStyle = P.ink2 || P.ink; ctx.font = '600 11px Inter, sans-serif'; ctx.textBaseline = 'top';
  ctx.fillText('visible', X(550), yb + 10); ctx.fillText('near infrared (NIR)', X(1000), yb + 10); ctx.fillText('shortwave infrared (SWIR)', X(1900), yb + 10);
  ctx.font = '600 12px Inter, sans-serif'; ctx.textBaseline = 'bottom'; ctx.fillText('Wavelength (nm)', G.L + G.pw / 2, G.H - 4);
  ctx.save(); ctx.translate(15, G.T + G.ph / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText('Reflectance factor (–)', 0, 0); ctx.restore();
  // feature annotations on a vegetation spectrum
  if (p.annot && ['healthy', 'stressed', 'senescent'].includes(p.focus) && p.lai > 0.3 && ymax >= 0.7) {
    const s = M.spec[p.focus];
    const ann = (nm, text, dy, align = 'center') => {
      const i = SP.wlIndex(nm), x = X(SP.WL[i]), y = Y(s[i]);
      const ty = Math.max(G.T + 12, Math.min(G.T + G.ph - 8, y + dy));
      ctx.strokeStyle = P.muted; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(x, y + (dy < 0 ? -4 : 4)); ctx.lineTo(x, ty + (dy < 0 ? 6 : -10)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = P.ink2 || P.ink; ctx.font = '600 11px Inter, sans-serif'; ctx.textAlign = align; ctx.textBaseline = dy < 0 ? 'bottom' : 'top';
      ctx.fillText(text, x, ty + (dy < 0 ? 4 : -4));
    };
    ann(555, 'green peak', -44); ann(672, 'chlorophyll well', -30, 'left'); ann(720, 'red edge', -70, 'right');
    ann(1000, 'NIR plateau (leaf structure)', -34); ann(1450, 'water', 40); ann(1940, 'water', 40); ann(2100, 'dry matter + water', -40);
  }
  // legend
  ctx.font = '600 11.5px Inter, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  legendItems(p, dark).forEach(([lab, col, foc, dash], k) => {
    const [lx, row] = LEG.pos[k], ly = 16 + row * 17;
    ctx.strokeStyle = col; ctx.lineWidth = foc ? 3.2 : 2; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 20, ly); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = foc ? (P.ink || '#000') : (P.ink2 || P.ink); ctx.fillText(lab, lx + 25, ly);
  });
  ctx.fillStyle = P.muted; ctx.font = "500 10.5px 'JetBrains Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText(`${SP.SENSORS[p.sensor].name} bands · bars = band-averaged reflectance of the ${p.focus === 'mixed' ? 'mixed pixel' : SURF[p.focus].label.toLowerCase()}`, G.L, G.T - 18 - 6);
  // hover read-out
  if (hover != null && hover >= 400 && hover <= 2500) {
    const i = SP.wlIndex(hover), x = X(SP.WL[i]);
    ctx.strokeStyle = withAlpha(P.muted.startsWith('#') ? P.muted : '#888888', 0.8); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, G.T); ctx.lineTo(x, G.T + G.ph); ctx.stroke(); ctx.setLineDash([]);
    const rows = [[`λ = ${SP.WL[i]} nm`, null]];
    const inBand = S.bands.find(b => { const c = SP.bandCentre(b), w = SP.bandWidth(b); return SP.WL[i] >= c - w / 2 && SP.WL[i] <= c + w / 2; });
    if (inBand) rows.push([`${S.short} band ${inBand.id}`, bandInk(SP.bandCentre(inBand))]);
    SURF_KEYS.forEach(k => { if (p['show_' + k] || k === p.focus) rows.push([`${SURF[k].label}: ${M.spec[k][i].toFixed(3)}`, SURF[k].color]); });
    if (p.showmix) rows.push([`Mixed pixel: ${M.spec.mixed[i].toFixed(3)}`, dark ? '#f07ad0' : '#b23f8c']);
    ctx.font = "500 11px 'JetBrains Mono', monospace";
    const bw = Math.max(...rows.map(r => ctx.measureText(r[0]).width)) + 26, bh = rows.length * 16 + 10;
    let bx = x + 12; if (bx + bw > G.L + G.pw) bx = x - 12 - bw; const by = G.T + 8;
    ctx.fillStyle = dark ? 'rgba(12,18,16,0.92)' : 'rgba(255,255,255,0.94)'; ctx.strokeStyle = P.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, 8) : ctx.rect(bx, by, bw, bh); ctx.fill(); ctx.stroke();
    rows.forEach((r, k) => { const yy = by + 13 + k * 16; if (r[1]) { ctx.fillStyle = r[1]; ctx.beginPath(); ctx.arc(bx + 10, yy, 3.6, 0, Math.PI * 2); ctx.fill(); } ctx.fillStyle = P.ink; ctx.textBaseline = 'middle'; ctx.fillText(r[0], bx + (r[1] ? 19 : 8), yy); });
  }
}
cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(), G = geom(); const x = e.clientX - r.left; hover = (x >= G.L && x <= G.L + G.pw) ? 400 + (x - G.L) / G.pw * 2100 : null; requestDraw(); });
cv.addEventListener('pointerleave', () => { hover = null; requestDraw(); });
let rq = 0; const requestDraw = () => { cancelAnimationFrame(rq); rq = requestAnimationFrame(draw); };
new ResizeObserver(requestDraw).observe(stageEl);
document.addEventListener('ffp:theme', requestDraw);

/* ================================================================ charts */
const cLai = new Plot('#chart-lai', { x: { label: 'Leaf area index', unit: 'm² m⁻²', min: 0, max: 8 }, y: { label: 'Index value', unit: '–', min: 0, max: 1 } });
const cMix = new Plot('#chart-mix', { x: { label: 'Vegetation fraction of the pixel, f', unit: '–', min: 0, max: 1 }, y: { label: 'Index value', unit: '–', min: 0, max: 1 }, y2: { label: 'Reflectance', unit: '–', min: 0 } });
const cBand = new BarChart('#chart-bands', { y: { label: 'Band-averaged reflectance', unit: '–', min: 0 }, legend: false });
const cLeaf = new Plot('#chart-leaf', { x: { label: 'Wavelength', unit: 'nm', min: 400, max: 2500 }, y: { label: 'Fraction of incident light', unit: '–', min: 0, max: 1 } });

function updateCharts() {
  const p = M.p, sens = p.sensor;
  // saturation with LAI
  const lais = linspace(0, 8, 41), I = { NDVI: [], NDRE: [], EVI: [], SAVI: [] }, fint = [];
  lais.forEach(L => { const s = SP.canopySpectrum(M.leafH, L, M.soil); const ix = SP.indices(SP.sensorBands(s, sens), sens); Object.keys(I).forEach(k => I[k].push(ix[k])); fint.push(1 - Math.exp(-0.5 * L)); });
  const cols = { NDVI: 'accent', NDRE: 'magenta', EVI: 'amber', SAVI: 'water' };
  Object.keys(I).forEach(k => { if (I[k].some(Number.isFinite)) cLai.line(k, lais, I[k], { color: cols[k], width: k === 'NDVI' ? 2.8 : 2, label: k }); else cLai.remove(k); });
  cLai.line('fint', lais, fint, { color: 'muted', width: 1.6, dash: [5, 4], label: 'Light intercepted, 1 − e^(−0.5 LAI)' });
  cLai.vline('now', p.lai, { color: 'muted', label: `LAI ${fmt(p.lai, 2)}` });
  const cur = SP.indices(SP.sensorBands(M.spec.healthy, sens), sens);
  if (Number.isFinite(cur.NDVI)) cLai.point('pt', p.lai, cur.NDVI, { color: 'accent', r: 5 }); else cLai.remove('pt');
  // linear mixing
  const fs = linspace(0, 1, 41), nd = [], sv = [], lin = [], red = [], nir = [];
  const bVeg = SP.sensorBands(M.spec.healthy, sens), bSoil = SP.sensorBands(M.soil, sens);
  const U = SP.SENSORS[sens].use;
  const ixVeg = SP.indices(bVeg, sens), ixSoil = SP.indices(bSoil, sens);
  fs.forEach(f => {
    const bm = {}; Object.keys(bVeg).forEach(k => { bm[k] = f * bVeg[k] + (1 - f) * bSoil[k]; });
    const ix = SP.indices(bm, sens); nd.push(ix.NDVI); sv.push(ix.SAVI); lin.push(f * ixVeg.NDVI + (1 - f) * ixSoil.NDVI);
    red.push(U.red ? bm[U.red] : NaN); nir.push(U.nir ? bm[U.nir] : NaN);
  });
  if (nd.some(Number.isFinite)) {
    cMix.line('nd', fs, nd, { color: 'accent', width: 2.8, label: 'NDVI of the mixed pixel' });
    cMix.line('lin', fs, lin, { color: 'muted', width: 1.6, dash: [6, 4], label: 'Area-weighted mean of the two NDVIs' });
    cMix.line('sv', fs, sv, { color: 'water', width: 2, label: 'SAVI of the mixed pixel' });
    cMix.line('red', fs, red, { color: '#d6453d', width: 1.6, y2: true, label: 'Red reflectance (right axis)' });
    cMix.line('nir', fs, nir, { color: 'magenta', width: 1.6, y2: true, label: 'NIR reflectance (right axis)' });
    const bm = {}; Object.keys(bVeg).forEach(k => { bm[k] = p.fveg * bVeg[k] + (1 - p.fveg) * bSoil[k]; });
    cMix.point('pt', p.fveg, SP.indices(bm, sens).NDVI, { color: 'accent', r: 5 });
    cMix.remove('nosens');
  } else { ['nd', 'lin', 'sv', 'red', 'nir', 'pt'].forEach(id => cMix.remove(id)); cMix.text('nosens', 0.5, 0.5, 'This sensor has no NIR band — NDVI cannot be computed', { align: 'center', color: 'muted' }); }
  // band bars
  const S = SP.SENSORS[sens], bv = SP.sensorBands(focusSpec(), sens);
  cBand.set(S.bands.map(b => `${b.id} (${Math.round(SP.bandCentre(b))})`), [{ label: 'Reflectance', values: S.bands.map(b => bv[b.id]), colors: S.bands.map(b => bandInk(SP.bandCentre(b))), format: v => v.toFixed(3) }]);
  // leaf optics
  const wl = Array.from(SP.WL), A = wl.map((_, i) => 1 - M.leafH.R[i] - M.leafH.T[i]);
  cLeaf.line('R', wl, Array.from(M.leafH.R), { color: 'accent', width: 2.2, label: 'Reflectance R' });
  cLeaf.line('RT', wl, wl.map((_, i) => M.leafH.R[i] + M.leafH.T[i]), { color: 'water', width: 2, label: 'R + transmittance T' });
  cLeaf.band('A', wl, wl.map((_, i) => M.leafH.R[i] + M.leafH.T[i]), wl.map(() => 1), { color: 'amber', alpha: 0.22, label: 'Absorbed, A = 1 − R − T' });
  cLeaf.text('lab', 1500, 0.93, 'absorbed (A)', { color: 'amber', align: 'center' });
}

/* ================================================================ readouts + update */
const DESC = v => v < 0 ? 'water, snow or cloud' : v < 0.2 ? 'bare soil or rock' : v < 0.5 ? 'sparse or stressed vegetation' : v < 0.8 ? 'moderate to dense canopy' : 'dense, green canopy';
function updateReadouts() {
  const p = M.p, S = SP.SENSORS[p.sensor];
  const ix = SP.indices(SP.sensorBands(focusSpec(), p.sensor), p.sensor);
  const note = k => { const u = ix.used[k]; return u.length === SP.INDEX_INFO[k].needs.length ? `${S.short}: ${u.join(', ')}` : `${S.short} lacks a required band`; };
  ['NDVI', 'NDRE', 'EVI', 'SAVI', 'GNDVI', 'NDWI'].forEach(k => {
    const v = ix[k]; const ok = Number.isFinite(v);
    let st = null; if (k === 'NDVI' && ok) st = v > 0.6 ? 'ok' : v > 0.3 ? 'warn' : 'bad';
    ro.set(k, ok ? v : null, st, k === 'NDVI' && ok ? `${note(k)} · ${DESC(v)}` : note(k));
  });
  const veg = ['healthy', 'stressed', 'senescent', 'mixed'].includes(p.focus) && (p.focus !== 'mixed' || p.fveg > 0.1) && p.lai > 0.2;
  ro.set('rep', veg ? SP.redEdgePosition(focusSpec()) : null, null, veg ? 'max. slope 680–760 nm; shifts to longer λ with more chlorophyll' : 'defined for vegetation only');
  const bm = SP.sensorBands(M.spec.mixed, p.sensor); const mix = SP.indices(bm, p.sensor).NDVI;
  const vV = SP.indices(SP.sensorBands(M.spec.healthy, p.sensor), p.sensor).NDVI, vS = SP.indices(SP.sensorBands(M.soil, p.sensor), p.sensor).NDVI;
  ro.set('mix', Number.isFinite(mix) ? mix : null, null, Number.isFinite(mix) ? `f = ${fmt(p.fveg, 2)}; linear mean of NDVIs would be ${fmt(p.fveg * vV + (1 - p.fveg) * vS, 3)}` : 'needs a NIR band');
}
function exportCSV() {
  const keys = SURF_KEYS.concat(['mixed']);
  downloadCSV('spectral-signatures.csv', ['wavelength_nm', ...keys.map(k => k + '_reflectance'), 'leaf_R', 'leaf_T'], Array.from(SP.WL).map((w, i) => [w, ...keys.map(k => +M.spec[k][i].toFixed(5)), +M.leafH.R[i].toFixed(5), +M.leafH.T[i].toFixed(5)]));
}
let raf = 0;
function update() { M = compute(); draw(); updateCharts(); updateReadouts(); }
ui.onChange(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
update();
window.__spectral = { compute, SP };
