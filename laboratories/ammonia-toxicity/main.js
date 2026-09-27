/* ==========================================================================
   Ammonia equilibrium and toxicity — 2D laboratory.
   Model: NH₄⁺ ⇌ NH₃ + H⁺ with pKa(T) = 0.09018 + 2729.92/T (Emerson et al. 1975;
   physics.nh3Fraction), species thresholds from cited sources, a diurnal
   pH/temperature swing, and nitrite toxicity with chloride protection
   (EIFAC 1984 Cl⁻ : NO₂⁻-N ratios). See the Derive tab (Eqs. T1–T6).
   ========================================================================== */
import { Controls, Readouts, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, linspace, downloadCSV } from '/assets/js/plot.js';
import { nh3Fraction, K0 } from '/assets/js/physics.js';
import { colormap, colormapGradient } from '/assets/js/colors.js';

/* ------------------------------------------------------------------ data (all thresholds as mg NH₃-N L⁻¹; 1 mg NH₃ = 0.8225 mg NH₃-N) */
const N_PER_NH3 = 14.007 / 17.031;
const SPECIES = {
  tilapia: { name: 'Nile tilapia', chronic: 0.08 * N_PER_NH3, chronicTxt: 'appetite begins to fall at 0.08 mg NH₃ L⁻¹ (Popma & Masser, 1999)', acute: 2 * N_PER_NH3, acuteTxt: 'massive mortality within days above 2 mg NH₃ L⁻¹ (Popma & Masser, 1999)', tan: 2, no2: 1, ratio: 8, T: '14–36 (optimum 27–30)' },
  trout: { name: 'Rainbow trout', chronic: 0.025 * N_PER_NH3, chronicTxt: 'EIFAC (1970) limit 0.025 mg NH₃ L⁻¹', acute: 0.16 * N_PER_NH3, acuteTxt: '96-h LC₅₀ from 0.16 mg NH₃ L⁻¹ (Thurston & Russo, 1983)', tan: 0.5, no2: 0.3, ratio: 17, T: '10–18 (optimum 14–16)' },
  carp: { name: 'Common carp', chronic: 0.025 * N_PER_NH3, chronicTxt: 'EU cyprinid-water value 0.025 mg NH₃ L⁻¹ (Directive 2006/44/EC)', acute: null, acuteTxt: 'no acute value adopted here', tan: 1, no2: 1, ratio: 8, T: '4–34 (optimum 25–30)' },
  perch: { name: 'Eurasian perch', chronic: 0.025 * N_PER_NH3, chronicTxt: 'EU cyprinid-water value 0.025 mg NH₃ L⁻¹; perch is named as a cyprinid-water species', acute: null, acuteTxt: 'no acute value adopted here', tan: null, no2: null, ratio: 17, T: 'cool-water species (not in FAO table)' }
};
const SPK = Object.keys(SPECIES);
const pKa = T => 0.09018 + 2729.92 / (T + K0);
const frac = (pH, T) => nh3Fraction(pH, T);

/* ------------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'pka', label: 'pKa of NH₄⁺ at this temperature', unit: '', digits: 3 })
  .add({ id: 'frac', label: 'Share of TAN present as NH₃', unit: '%', digits: 3 })
  .add({ id: 'nh3n', label: 'Un-ionised ammonia', unit: 'mg NH₃-N L⁻¹', digits: 4 })
  .add({ id: 'nh3', label: 'Same, as NH₃', unit: 'mg NH₃ L⁻¹', digits: 4 })
  .add({ id: 'tanmax', label: 'Highest safe TAN (chronic limit)', unit: 'mg N L⁻¹', digits: 2 })
  .add({ id: 'tanacute', label: 'TAN at the acute danger level', unit: 'mg N L⁻¹', digits: 1 })
  .add({ id: 'peak', label: 'Diurnal NH₃-N peak', unit: '', format: v => v })
  .add({ id: 'hours', label: 'Hours per day above the limit', unit: 'h', digits: 1 })
  .add({ id: 'ratio', label: 'Chloride : nitrite-N ratio', unit: '', format: v => v })
  .add({ id: 'salt', label: 'Salt (NaCl) to reach the safe ratio', unit: '', format: v => v });

ui.section('Water');
ui.slider({ id: 'tan', label: 'Total ammonia nitrogen (TAN)', min: 0.05, max: 20, value: 1.5, log: true, unit: 'mg N L⁻¹', help: 'TAN = NH₄⁺-N + NH₃-N, the quantity a test kit or analyser reports.' });
ui.slider({ id: 'pH', label: 'pH', min: 6, max: 9.5, step: 0.01, value: 7.2, help: 'Drag the white point on the map to change pH and temperature together.' });
ui.slider({ id: 'T', label: 'Water temperature', min: 5, max: 35, step: 0.1, value: 26, unit: '°C' });
ui.section('Species & map');
ui.select({ id: 'sp', label: 'Species', options: SPK.map(k => ({ value: k, label: SPECIES[k].name })), value: 'tilapia' });
ui.segmented({ id: 'mode', label: 'Colour the map by', options: [{ value: 'frac', label: 'NH₃ share of TAN' }, { value: 'risk', label: 'NH₃-N ÷ species limit' }], value: 'frac' });
ui.section('Diurnal swing');
ui.toggle({ id: 'day', label: 'Show the 24-hour cycle on the map', value: true });
ui.slider({ id: 'apH', label: 'pH swing (± amplitude)', min: 0, max: 1.2, step: 0.05, value: 0.5, help: 'Photosynthesis removes CO₂ by day, respiration adds it at night.' });
ui.slider({ id: 'aT', label: 'Temperature swing (±)', min: 0, max: 6, step: 0.1, value: 1.5, unit: '°C' });
ui.slider({ id: 'hpk', label: 'Time of the pH peak', min: 12, max: 20, step: 0.5, value: 16, unit: 'h' });
ui.section('Nitrite and chloride');
ui.slider({ id: 'no2', label: 'Nitrite-N', min: 0, max: 10, step: 0.05, value: 1.2, unit: 'mg L⁻¹' });
ui.slider({ id: 'cl', label: 'Chloride', min: 0, max: 300, step: 1, value: 20, unit: 'mg L⁻¹' });
ui.slider({ id: 'vol', label: 'System water volume', min: 0.5, max: 100, step: 0.5, value: 6, unit: 'm³' });
ui.presets([
  { label: 'Tilapia RAS', title: 'Warm recirculating system at pH 7.2', values: { tan: 1.5, pH: 7.2, T: 26, sp: 'tilapia', apH: 0.1, aT: 0.5, hpk: 16, no2: 0.5, cl: 30 } },
  { label: 'Nordic trout RAS', title: 'Cold water, sensitive species', values: { tan: 0.8, pH: 7.4, T: 12, sp: 'trout', apH: 0.1, aT: 0.3, hpk: 16, no2: 0.2, cl: 15 } },
  { label: 'Algae-rich pond', title: 'Afternoon pH peak from photosynthesis', values: { tan: 1.0, pH: 8.0, T: 28, sp: 'tilapia', apH: 0.9, aT: 2.5, hpk: 16, no2: 0.3, cl: 20 } },
  { label: 'New system start-up', title: 'Ammonia peak in fresh, hard tap water', values: { tan: 5, pH: 8.3, T: 24, sp: 'tilapia', apH: 0.05, aT: 0.5, hpk: 16, no2: 4.5, cl: 20 } },
  { label: 'Perch, nitrite spike', title: 'A chloride-sensitive species meets nitrite', values: { tan: 0.6, pH: 7.3, T: 20, sp: 'perch', apH: 0.1, aT: 0.5, hpk: 16, no2: 2.5, cl: 12 } }
]);
ui.saveButton('ammonia-toxicity', () => ro.values());
ui.button({ label: 'Download the map as CSV', onClick: () => downloadMap() });

/* ------------------------------------------------------------------ the heat-map stage */
const stageEl = document.getElementById('stage');
const map = new Plot(stageEl, { x: { label: 'pH', unit: '', min: 6, max: 9.5 }, y: { label: 'Water temperature', unit: '°C', min: 5, max: 35 }, legend: false, crosshair: false, padding: { left: 58, right: 18, top: 14, bottom: 44 } });
const hud = hudChips(stageEl);
const legend = document.createElement('div'); legend.className = 'stage-legend'; legend.style.left = 'auto'; legend.style.right = '26px'; legend.style.bottom = '58px'; stageEl.appendChild(legend);
stageToolbar(stageEl, { onShot: () => { const c = stageEl.querySelector('canvas'); const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = 'ammonia-map.png'; a.click(); } });
const NX = 141, NY = 121, XS = linspace(6, 9.5, NX), YS = linspace(5, 35, NY);
const FR = YS.map(T => XS.map(pH => frac(pH, T)));          // fraction on the grid
const LOGF = FR.map(r => r.map(f => Math.log10(f * 100)));  // log10(%)

/* marching squares → line segments for one contour level */
function contour(G, level) {
  const seg = [];
  for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = G[j][i], b = G[j][i + 1], c = G[j + 1][i + 1], d = G[j + 1][i];
    const idx = (a > level) | ((b > level) << 1) | ((c > level) << 2) | ((d > level) << 3);
    if (idx === 0 || idx === 15) continue;
    const x0 = XS[i], x1 = XS[i + 1], y0 = YS[j], y1 = YS[j + 1];
    const lerp = (p, q, vp, vq) => p + (q - p) * (level - vp) / (vq - vp);
    const e = { b: [lerp(x0, x1, a, b), y0], r: [x1, lerp(y0, y1, b, c)], t: [lerp(x0, x1, d, c), y1], l: [x0, lerp(y0, y1, a, d)] };
    const T = { 1: ['l', 'b'], 2: ['b', 'r'], 3: ['l', 'r'], 4: ['r', 't'], 5: ['l', 't', 'b', 'r'], 6: ['b', 't'], 7: ['l', 't'], 8: ['t', 'l'], 9: ['t', 'b'], 10: ['t', 'r', 'l', 'b'], 11: ['t', 'r'], 12: ['r', 'l'], 13: ['r', 'b'], 14: ['b', 'l'] }[idx];
    for (let k = 0; k < T.length; k += 2) seg.push([...e[T[k]], ...e[T[k + 1]]]);
  }
  return seg;
}
const LEVELS = [0.03, 0.1, 0.3, 1, 3, 10, 30];               // % of TAN as NH₃
const CONT = LEVELS.map(L => ({ L, seg: contour(LOGF, Math.log10(L)) }));
function labelPoint(seg) { // a readable spot for the contour label: the segment nearest the top-left part of its path
  let best = null, bs = -Infinity; seg.forEach(s => { const x = (s[0] + s[2]) / 2, y = (s[1] + s[3]) / 2; const sc = -Math.abs(y - 30) * 0.2 - Math.abs(x - 7.6); if (x > 6.15 && x < 9.3 && y > 7 && y < 33 && sc > bs) { bs = sc; best = [x, y]; } }); return best;
}

let dragging = false;
map.on('pointerdown', e => { if (!e.inside) return; dragging = true; setPoint(e.x, e.y); });
map.on('pointermove', e => { if (dragging && e.inside) setPoint(e.x, e.y); });
map.on('pointerup', () => { dragging = false; });
stageEl.addEventListener('pointerleave', () => { dragging = false; });
function setPoint(pH, T) { ui.setMany({ pH: +Math.min(9.5, Math.max(6, pH)).toFixed(2), T: +Math.min(35, Math.max(5, T)).toFixed(1) }); }

/* ------------------------------------------------------------------ charts */
const chF = new Plot('#chart-frac', { x: { label: 'pH', unit: '', min: 6, max: 9.5 }, y: { label: 'NH₃ share of TAN', unit: '%', log: true, min: 0.01, max: 60 } });
const chS = new Plot('#chart-safe', { x: { label: 'pH', unit: '', min: 6, max: 9.5 }, y: { label: 'Highest safe TAN', unit: 'mg N L⁻¹', log: true, min: 0.01, max: 100 } });
const chD = new Plot('#chart-day', { x: { label: 'Time of day', unit: 'h', min: 0, max: 24 }, y: { label: 'NH₃-N', unit: 'mg L⁻¹', min: 0 }, y2: { label: 'pH', unit: '' } });
const chN = new Plot('#chart-no2', { x: { label: 'Chloride', unit: 'mg L⁻¹', min: 0, max: 300 }, y: { label: 'Nitrite-N', unit: 'mg L⁻¹', min: 0, max: 20 } });

/* ------------------------------------------------------------------ diurnal cycle (Eq. T5) */
function diurnal(p) {
  const hrs = linspace(0, 24, 97), pk = p.hpk, tpk = 15;
  const pHs = hrs.map(h => p.pH + p.apH * Math.cos(2 * Math.PI * (h - pk) / 24));
  const Ts = hrs.map(h => p.T + p.aT * Math.cos(2 * Math.PI * (h - tpk) / 24));
  const n = hrs.map((h, i) => p.tan * frac(pHs[i], Ts[i]));
  return { hrs, pHs, Ts, n };
}

/* ------------------------------------------------------------------ update */
function update() {
  const p = ui.values(); const sp = SPECIES[p.sp];
  const f = frac(p.pH, p.T), nh3n = p.tan * f;
  // readouts
  ro.set('pka', pKa(p.T), null, `pH − pKa = ${fmt(p.pH - pKa(p.T), 2)} · every pH unit ×10`);
  ro.set('frac', f * 100, null, `1 in ${fmt(1 / f, 0)} ammonia-N molecules is NH₃`);
  const st = nh3n < sp.chronic * 0.5 ? 'ok' : nh3n < sp.chronic ? 'warn' : 'bad';
  ro.set('nh3n', nh3n, st, `${sp.name} limit ${fmt(sp.chronic, 3)} mg NH₃-N L⁻¹`);
  ro.set('nh3', nh3n / N_PER_NH3, st, `×17.03/14.01 converts N to NH₃`);
  const tmax = sp.chronic / f;
  ro.set('tanmax', tmax, p.tan <= tmax ? 'ok' : 'bad', `at pH ${fmt(p.pH, 2)} and ${fmt(p.T, 1)} °C for ${sp.name.toLowerCase()}`);
  ro.set('tanacute', sp.acute ? sp.acute / f : NaN, sp.acute ? (p.tan < sp.acute / f ? 'ok' : 'bad') : null, sp.acute ? sp.acuteTxt : 'no acute value adopted for this species');
  const D = diurnal(p); let im = 0; D.n.forEach((v, i) => { if (v > D.n[im]) im = i; });
  const above = D.n.filter(v => v > sp.chronic).length / D.n.length * 24;
  ro.set('peak', `${fmt(D.n[im], 3)} at ${String(Math.floor(D.hrs[im])).padStart(2, '0')}:${String(Math.round((D.hrs[im] % 1) * 60)).padStart(2, '0')}`, D.n[im] < sp.chronic ? 'ok' : 'bad', `pH ${fmt(D.pHs[im], 2)} · ${fmt(D.Ts[im], 1)} °C · minimum ${fmt(Math.min(...D.n), 3)}`);
  ro.set('hours', above, above === 0 ? 'ok' : above < 6 ? 'warn' : 'bad', 'time during which NH₃-N exceeds the chronic limit');
  const ratio = p.no2 > 0 ? p.cl / p.no2 : Infinity;
  ro.set('ratio', p.no2 > 0 ? `${fmt(ratio, 1)} : 1` : 'no nitrite', ratio >= sp.ratio ? 'ok' : ratio >= sp.ratio / 2 ? 'warn' : 'bad', `EIFAC (1984): ≥ ${sp.ratio} : 1 for ${sp.ratio === 17 ? 'salmonids (applied to chloride-sensitive species)' : 'coarse fish'}`);
  const needCl = Math.max(0, sp.ratio * p.no2 - p.cl);
  const saltKg = needCl * p.vol * 58.44 / 35.45 / 1000;
  ro.set('salt', needCl > 0 ? `${fmt(saltKg, 2)} kg` : 'none needed', needCl > 0 ? 'warn' : 'ok', needCl > 0 ? `raises Cl⁻ by ${fmt(needCl, 0)} mg L⁻¹ and Na⁺ by ${fmt(needCl * 22.99 / 35.45, 0)} mg L⁻¹` : 'chloride already protects');
  hud.set('pt', `pH <b>${fmt(p.pH, 2)}</b> · <b>${fmt(p.T, 1)}</b> °C · NH₃ share <b>${fmt(f * 100, 2)} %</b>`);
  hud.set('n', `TAN ${fmt(p.tan, 2)} → NH₃-N <b>${fmt(nh3n, 4)}</b> mg L⁻¹ (${sp.name})`);
  drawMap(p, sp, D);
  // chart 1: fraction vs pH at four temperatures
  const xs = linspace(6, 9.5, 141);
  [5, 15, 25, 35].forEach((T, i) => chF.line('T' + T, xs, xs.map(pH => frac(pH, T) * 100), { color: ['water', 'c1', 'amber', 'danger'][i], label: `${T} °C`, width: 2 }));
  chF.point('op', p.pH, f * 100, { color: 'magenta', label: 'now', r: 5 });
  // chart 2: safe TAN vs pH for all species at the current temperature
  SPK.forEach((k, i) => { const s = SPECIES[k]; chS.line('c' + k, xs, xs.map(pH => s.chronic / frac(pH, p.T)), { color: i, label: s.name + (k === p.sp ? ' (selected)' : ''), width: k === p.sp ? 3 : 1.6 }); if (s.acute) chS.line('a' + k, xs, xs.map(pH => s.acute / frac(pH, p.T)), { color: i, width: 1.2, dash: [5, 4], noTip: false, label: s.name + ' acute' }); else chS.remove('a' + k); });
  chS.point('op', p.pH, p.tan, { color: 'magenta', label: 'measured TAN', r: 5 });
  // chart 3: the diurnal cycle
  chD.line('n', D.hrs, D.n, { color: 'magenta', label: 'NH₃-N', width: 2.4, fill: 0.08 });
  chD.line('ph', D.hrs, D.pHs, { color: 'water', label: 'pH (right)', width: 1.8, y2: true, dash: [6, 3] });
  chD.hline('lim', sp.chronic, { color: 'danger', label: `${sp.name} limit`, dash: [4, 4] });
  chD.setAxis('y', { max: Math.max(sp.chronic * 1.4, Math.max(...D.n) * 1.15) });
  // chart 4: nitrite vs chloride
  const cls = linspace(0, 300, 61);
  chN.line('r17', cls, cls.map(c => c / 17), { color: 'danger', label: 'Cl⁻ : NO₂⁻-N = 17 (salmonids)', width: 2 });
  chN.line('r8', cls, cls.map(c => c / 8), { color: 'amber', label: 'Cl⁻ : NO₂⁻-N = 8 (coarse fish)', width: 2 });
  chN.point('op', p.cl, p.no2, { color: 'magenta', label: 'now', r: 5 });
}
function drawMap(p, sp, D) {
  const risk = p.mode === 'risk';
  let z, cm, lo, hi;
  if (!risk) { z = LOGF; cm = 'viridis'; lo = -2; hi = Math.log10(50); }
  else { z = FR.map(r => r.map(f => Math.log10(Math.max(1e-9, p.tan * f / sp.chronic)))); cm = 'rdylgn'; lo = -2; hi = 2; z = z.map(r => r.map(v => -v)); }
  map.heatmap('hm', { z, x0: 6, x1: 9.5, y0: 5, y1: 35, colormap: cm, min: risk ? -hi : lo, max: risk ? -lo : hi });
  const limLevel = Math.log10(sp.chronic / p.tan * 100); // contour where NH₃-N equals the limit at this TAN
  const limSeg = contour(LOGF, limLevel);
  const acuteSeg = sp.acute ? contour(LOGF, Math.log10(sp.acute / p.tan * 100)) : [];
  map.custom('cont', (ctx, plot) => {
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = '600 11px Inter, sans-serif';
    CONT.forEach(c => { ctx.beginPath(); c.seg.forEach(s => { ctx.moveTo(plot.px(s[0]), plot.py(s[1])); ctx.lineTo(plot.px(s[2]), plot.py(s[3])); }); ctx.stroke(); const lp = labelPoint(c.seg); if (lp) { const tx = plot.px(lp[0]), ty = plot.py(lp[1]); ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.45)'; const w = ctx.measureText(c.L + ' %').width + 8; ctx.fillRect(tx - w / 2, ty - 8, w, 16); ctx.restore(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(c.L + ' %', tx, ty); } });
    // pH = pKa (half of TAN is NH₃)
    ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); YS.forEach((T, i) => { const x = pKa(T); const X = plot.px(Math.min(9.5, x)), Y = plot.py(T); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke(); ctx.setLineDash([]);
    ctx.textAlign = 'right'; ctx.fillText('pH = pKa (50 %)', plot.px(9.47), plot.py(24));
    // species limit at this TAN
    ctx.lineWidth = 3.2; ctx.strokeStyle = '#ffffff'; ctx.setLineDash([9, 5]); ctx.beginPath(); limSeg.forEach(s => { ctx.moveTo(plot.px(s[0]), plot.py(s[1])); ctx.lineTo(plot.px(s[2]), plot.py(s[3])); }); ctx.stroke();
    if (acuteSeg.length) { ctx.lineWidth = 2.2; ctx.strokeStyle = '#ff5a6e'; ctx.setLineDash([3, 4]); ctx.beginPath(); acuteSeg.forEach(s => { ctx.moveTo(plot.px(s[0]), plot.py(s[1])); ctx.lineTo(plot.px(s[2]), plot.py(s[3])); }); ctx.stroke(); }
    ctx.setLineDash([]);
    const lp = limSeg.length ? limSeg.reduce((a, s) => (s[1] + s[3]) / 2 > (a[1] + a[3]) / 2 ? s : a) : null;
    if (lp) { const tx = plot.px(Math.min(9.3, Math.max(6.3, lp[0]))), ty = plot.py(Math.min(34, (lp[1] + lp[3]) / 2)); ctx.font = '700 12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4; ctx.fillText(`${sp.name} limit at TAN ${fmt(p.tan, 2)}`, tx + 6, ty + 12); ctx.shadowBlur = 0; }
    // diurnal loop
    if (p.day) {
      ctx.lineWidth = 2.4; ctx.strokeStyle = '#ffd166'; ctx.beginPath(); D.pHs.forEach((ph, i) => { const X = plot.px(Math.min(9.5, Math.max(6, ph))), Y = plot.py(Math.min(35, Math.max(5, D.Ts[i]))); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke();
      [0, 6, 12, 18].forEach(h => { const i = Math.round(h / 24 * (D.hrs.length - 1)); const X = plot.px(D.pHs[i]), Y = plot.py(D.Ts[i]); ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(X, Y, 3.5, 0, 6.3); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '600 10.5px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(String(h).padStart(2, '0') + ':00', X + 6, Y - 6); });
    }
  });
  map.point('op', p.pH, p.T, { color: '#ffffff', r: 7, label: `${fmt(p.pH, 2)} · ${fmt(p.T, 1)} °C` });
  legend.innerHTML = risk
    ? `NH₃-N ÷ ${sp.name} limit<div class="cbar" style="background:${colormapGradient('rdylgn', 'to left')}"></div><div class="cbar-ticks"><span>0.01×</span><span>1×</span><span>100×</span></div>`
    : `NH₃ share of TAN (%)<div class="cbar" style="background:${colormapGradient('viridis')}"></div><div class="cbar-ticks"><span>0.01</span><span>0.2</span><span>3</span><span>50</span></div>`;
}
function downloadMap() {
  const rows = []; YS.forEach((T, j) => { if (j % 5) return; XS.forEach((pH, i) => { if (i % 5) return; rows.push([pH.toFixed(2), T.toFixed(1), (FR[j][i] * 100).toPrecision(4)]); }); });
  downloadCSV('nh3-fraction-map.csv', ['pH', 'T_C', 'NH3_percent_of_TAN'], rows);
}

let raf = 0;
ui.onChange(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
update();
window.__nh3 = { ui, update, SPECIES };
