/* ==========================================================================
   Interactive psychrometric chart — canvas renderer, draggable state points,
   process tools and overlays. Properties from ./psy.js (Derive tab, P1–P13).
   ========================================================================== */
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, BarChart, downloadCSV } from '/assets/js/plot.js';
import { palette, categorical, withAlpha, isDark } from '/assets/js/colors.js';
import { wetBulb as stullWetBulb } from '/assets/js/physics.js';
import * as PS from './psy.js';

const RANGES = { std: { T0: -10, T1: 50, W1: 30 }, warm: { T0: 0, T1: 45, W1: 40 }, cold: { T0: -20, T1: 30, W1: 20 } };
const NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];
const pts = [{ T: 24, RH: 70 }, { T: -2, RH: 90 }].map((p, i) => ({ name: NAMES[i], T: p.T, W: 0, RH: p.RH }));
let active = 0, hover = null, drag = null, P = 101.3, ice = false, R = RANGES.std, proc = null;

/* ------------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
[['T', 'Dry-bulb temperature', '°C', 1], ['RH', 'Relative humidity', '%', 1], ['W', 'Humidity ratio', 'g kg⁻¹', 2], ['Td', 'Dew point', '°C', 1], ['Twb', 'Wet-bulb temperature', '°C', 1],
 ['h', 'Specific enthalpy', 'kJ kg⁻¹', 1], ['VPD', 'Vapour pressure deficit', 'kPa', 2], ['AH', 'Absolute humidity', 'g m⁻³', 2], ['rho', 'Density of moist air', 'kg m⁻³', 3], ['v', 'Specific volume', 'm³ kg⁻¹', 3]]
  .forEach(([id, label, unit, digits]) => ro.add({ id, label, unit, digits, note: '&nbsp;' }));
const pro = new Readouts('#proc-ro');
[['st2', 'Leaving / final air temperature', '°C', 1], ['Q', 'Total heat flow', 'kW', 2], ['Qs', 'Sensible part', 'kW', 2], ['Ql', 'Latent part', 'kW', 2], ['water', 'Water', 'kg h⁻¹', 2], ['SHR', 'Sensible heat ratio', '', 2]]
  .forEach(([id, label, unit, digits]) => pro.add({ id, label, unit, digits, note: '&nbsp;' }));

ui.section('Air and chart');
ui.slider({ id: 'alt', label: 'Altitude', min: 0, max: 4000, step: 50, value: 0, format: v => `${fmt(v, 0)} m · P = ${fmt(PS.pAt(v), 1)} kPa`, help: 'Barometric pressure from the FAO-56 standard atmosphere; every curve is recomputed' });
ui.segmented({ id: 'range', label: 'Chart range', options: [{ value: 'cold', label: '−20…30 °C' }, { value: 'std', label: '−10…50 °C' }, { value: 'warm', label: '0…45 °C' }], value: 'std' });
ui.toggle({ id: 'ice', label: 'Saturation over ice below 0 °C', value: false, help: 'ASHRAE charts use ice below 0 °C; the course formulas use water' });
ui.section('State points');
const ptsBox = ui.html('<div class="seg" id="pc-pts" role="group" aria-label="Active state point" style="margin-bottom:8px"></div>');
ui.slider({ id: 'pT', label: 'Active point: dry bulb', min: -20, max: 50, step: 0.1, value: 24, unit: '°C', persist: false });
ui.slider({ id: 'pRH', label: 'Active point: relative humidity', min: 1, max: 100, step: 0.5, value: 70, unit: '%', persist: false });
ui.buttons([{ label: '+ Add point', onClick: () => addPoint() }, { label: '− Remove point', onClick: () => removePoint() }]);
ui.html('<p class="ctl-help">Drag a point, click the chart to move the active point, double-click to add one. Arrow keys nudge the active point.</p>');
ui.section('Process from the active point');
ui.segmented({ id: 'tool', label: 'Process', options: [{ value: 'none', label: 'None' }, { value: 'heat', label: 'Heat / cool' }, { value: 'coil', label: 'Cooling coil' }, { value: 'evap', label: 'Pad cooling' }, { value: 'mix', label: 'Mixing' }, { value: 'room', label: 'Closed room' }], value: 'coil' });
ui.slider({ id: 'flow', label: 'Air flow (at the active state)', min: 100, max: 100000, value: 10000, log: true, unit: 'm³ h⁻¹', format: v => fmt(v, 0) });
ui.slider({ id: 'T2', label: 'Target dry-bulb temperature', min: -10, max: 50, step: 0.5, value: 32, unit: '°C' });
ui.slider({ id: 'adp', label: 'Coil (apparatus dew point)', min: -5, max: 25, step: 0.5, value: 10, unit: '°C' });
ui.slider({ id: 'bf', label: 'Coil bypass factor', min: 0, max: 0.6, step: 0.01, value: 0.15, help: 'Share of the air that passes the coil untreated' });
ui.slider({ id: 'eta', label: 'Pad saturation effectiveness', min: 10, max: 100, step: 1, value: 80, unit: '%' });
ui.slider({ id: 'xmix', label: 'Share of point B in the mixture', min: 0, max: 100, step: 1, value: 30, unit: '% (dry-air mass)' });
ui.slider({ id: 'area', label: 'Room floor area', min: 1, max: 2000, value: 100, log: true, unit: 'm²', format: v => fmt(v, 0) });
ui.slider({ id: 'hroom', label: 'Room height', min: 2, max: 8, step: 0.1, value: 3, unit: 'm' });
ui.slider({ id: 'Erate', label: 'Crop transpiration', min: 0, max: 0.6, step: 0.01, value: 0.15, unit: 'L m⁻² h⁻¹' });
ui.slider({ id: 'qs', label: 'Sensible heat gain (lamps etc.)', min: 0, max: 400, step: 5, value: 100, unit: 'W m⁻²', help: 'Removed by the thermostat, so the temperature stays constant; used for the load and the SHR' });
ui.slider({ id: 'dur', label: 'Duration without dehumidification', min: 2, max: 60, step: 1, value: 15, unit: 'min' });
const [animBtn] = ui.buttons([{ label: '▶ Animate the room', variant: 'primary', onClick: () => { if (ui.get('tool') !== 'room') ui.set('tool', 'room'); if (!clock.running && anim >= 1) anim = 0; clock.toggle(); } }]);
ui.section('Overlays');
ui.toggle({ id: 'vpdZone', label: 'Plant VPD comfort zone', value: true });
ui.slider({ id: 'vpdLo', label: 'VPD zone, lower limit', min: 0.2, max: 1.6, step: 0.05, value: 0.8, unit: 'kPa' });
ui.slider({ id: 'vpdHi', label: 'VPD zone, upper limit', min: 0.4, max: 2.5, step: 0.05, value: 1.2, unit: 'kPa' });
ui.toggle({ id: 'botry', label: 'Grey-mould (Botrytis) risk: RH > 85 / 90 %', value: true });
ui.toggle({ id: 'hLines', label: 'Enthalpy lines', value: true });
ui.toggle({ id: 'wbLines', label: 'Wet-bulb lines', value: true });
ui.toggle({ id: 'vLines', label: 'Specific-volume lines', value: true });
ui.presets([
  { label: 'Greenhouse winter night', title: '18 °C, 85 % — heated with pipes to 22 °C', values: { alt: 0, range: 'std', ice: false, tool: 'heat', T2: 22, flow: 20000 }, onApply: () => setPoints([[18, 85], [-2, 90]]) },
  { label: 'Plant-factory cooling coil', title: '24 °C, 75 % through a coil at 8 °C', values: { alt: 0, range: 'std', tool: 'coil', adp: 8, bf: 0.12, flow: 10000 }, onApply: () => setPoints([[24, 75], [-2, 90]]) },
  { label: 'Pad-and-fan in Almería', title: '34 °C, 30 % through an 85 % effective wet pad', values: { alt: 0, range: 'std', tool: 'evap', eta: 85, flow: 50000 }, onApply: () => setPoints([[34, 30], [26, 60]]) },
  { label: 'Winter vent: fog?', title: 'Greenhouse air 18 °C / 85 % mixed with outside air −5 °C / 90 %', values: { alt: 0, range: 'std', ice: false, tool: 'mix', xmix: 30, flow: 20000 }, onApply: () => setPoints([[18, 85], [-5, 90]]) },
  { label: 'Sealed growth room', title: '100 m² of lettuce transpiring 0.15 L m⁻² h⁻¹ under 100 W m⁻² of lamp heat, dehumidifier off', values: { alt: 0, range: 'std', tool: 'room', area: 100, hroom: 3, Erate: 0.15, qs: 100, dur: 15 }, onApply: () => setPoints([[22, 60], [-2, 90]]) },
  { label: 'Highland greenhouse (2400 m)', title: 'Same 25 °C / 60 % air at 2400 m altitude', values: { alt: 2400, range: 'std', tool: 'none' }, onApply: () => setPoints([[25, 60], [10, 80]]) }
]);
ui.buttons([{ label: 'Export chart (PNG)', onClick: () => exportPNG() }, { label: 'Points (CSV)', onClick: () => exportCSV() }]);
ui.saveButton('psychrometric-chart', () => Object.assign({ points: pts.map(p => `${p.name}: ${fmt(p.T, 1)} °C / ${fmt(p.RH, 0)} %`).join('; ') }, ro.values(), pro.values()));

/* ------------------------------------------------------------------ stage (2D canvas) */
const stageEl = document.getElementById('stage');
const cv = document.createElement('canvas'); cv.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:crosshair'; cv.setAttribute('aria-label', 'Interactive psychrometric chart'); cv.tabIndex = 0;
stageEl.appendChild(cv);
const tip = document.createElement('div'); tip.className = 'plot-tip'; tip.style.cssText += ';position:absolute;display:none;pointer-events:none;z-index:6'; stageEl.appendChild(tip);
stageToolbar(stageEl, { onShot: () => exportPNG() });
const hud = hudChips(stageEl);

/* ------------------------------------------------------------------ state helpers */
function refreshPoint(p) { p.W = Math.min(p.W, PS.Wsat(p.T, P, ice)); p.s = PS.state(p.T, p.W, P, ice); p.RH = p.s.RH; }
function setPoints(list) { list.forEach(([T, RH], i) => { if (!pts[i]) pts.push({ name: NAMES[i], T, W: 0, RH }); pts[i].T = T; pts[i].W = PS.fromRH(T, RH, P, ice); }); active = 0; syncActive(); update(); }
function addPoint(T, W) {
  if (pts.length >= NAMES.length) { window.FFP && FFP.toast && FFP.toast('Six points at most'); return; }
  const n = { name: NAMES[pts.length], T: T ?? 20, W: W ?? PS.fromRH(20, 50, P, ice) }; pts.push(n); active = pts.length - 1; syncActive(); update();
}
function removePoint() { if (pts.length <= 1) return; pts.splice(active, 1); pts.forEach((p, i) => { p.name = NAMES[i]; }); active = Math.max(0, active - 1); syncActive(); update(); }
function syncActive() { const p = pts[active]; refreshPoint(p); ui.set('pT', +p.T.toFixed(1), true); ui.set('pRH', +Math.min(100, p.RH).toFixed(1), true); drawPtButtons(); }
function drawPtButtons() {
  const box = ptsBox.querySelector('#pc-pts');
  box.innerHTML = pts.map((p, i) => `<button type="button" data-i="${i}" aria-pressed="${i === active}"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${categorical(i)};margin-right:5px"></span>${p.name}</button>`).join('');
  box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { active = +b.dataset.i; syncActive(); update(); }));
}

/* ------------------------------------------------------------------ geometry */
let G = null;
function geom(w, h) {
  const m = { l: 52, r: 66, t: 22, b: 42 };
  const pw = w - m.l - m.r, ph = h - m.t - m.b;
  return { w, h, m, pw, ph, X: T => m.l + (T - R.T0) / (R.T1 - R.T0) * pw, Y: Wg => m.t + (1 - Wg / R.W1) * ph, T: x => R.T0 + (x - m.l) / pw * (R.T1 - R.T0), Wg: y => (1 - (y - m.t) / ph) * R.W1 };
}
const Wg = (T, W) => 1000 * W;

/* ------------------------------------------------------------------ drawing */
function draw(ctx, w, h, forExport) {
  const C = palette(); const g = geom(w, h); G = forExport ? G : g;
  const dark = isDark();
  const inkSoft = withAlpha(C.ink.startsWith('#') ? C.ink : '#333333', 0.55);
  ctx.save(); ctx.fillStyle = C.bgElev || '#fff'; ctx.fillRect(0, 0, w, h);
  const { X, Y, m } = g;
  const Ws = T => 1000 * PS.Wsat(T, P, ice);
  const Ts = []; for (let T = R.T0; T <= R.T1 + 1e-9; T += 0.25) Ts.push(T);
  // plot clip
  ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, g.pw, g.ph); ctx.clip();
  // region above saturation (fog)
  ctx.beginPath(); ctx.moveTo(X(R.T0), Y(R.W1)); Ts.forEach(T => ctx.lineTo(X(T), Y(Math.min(R.W1 * 1.2, Ws(T))))); ctx.lineTo(X(R.T1), Y(R.W1 * 1.2)); ctx.lineTo(X(R.T0), Y(R.W1 * 1.2)); ctx.closePath();
  ctx.fillStyle = C.bgSunk || '#eee'; ctx.fill();
  // grid
  ctx.lineWidth = 1; ctx.strokeStyle = withAlpha(C.line.startsWith('#') ? C.line : '#cccccc', dark ? 0.7 : 0.9);
  ctx.beginPath();
  for (let T = Math.ceil(R.T0); T <= R.T1; T += 1) { if (T % 5 && (R.T1 - R.T0) > 40) continue; const x = Math.round(X(T)) + 0.5; ctx.moveTo(x, Y(0)); ctx.lineTo(x, Y(Math.min(R.W1, Ws(T)))); }
  for (let W = 1; W <= R.W1; W += 1) { const y = Math.round(Y(W)) + 0.5; let Tsat = R.T0; for (const T of Ts) { if (Ws(T) >= W) { Tsat = T; break; } } ctx.moveTo(X(Tsat), y); ctx.lineTo(X(R.T1), y); }
  ctx.stroke();
  // overlays: Botrytis and VPD zones
  const band = (fLo, fHi, color, alpha) => { ctx.beginPath(); Ts.forEach((T, i) => { const y = Y(Math.min(R.W1 * 1.2, fHi(T))); i ? ctx.lineTo(X(T), y) : ctx.moveTo(X(T), y); }); for (let i = Ts.length - 1; i >= 0; i--) ctx.lineTo(X(Ts[i]), Y(Math.max(0, Math.min(R.W1 * 1.2, fLo(Ts[i]))))); ctx.closePath(); ctx.fillStyle = withAlpha(color, alpha); ctx.fill(); };
  const v = ui.values();
  if (v.botry) {
    band(T => 1000 * PS.fromRH(T, 85, P, ice), T => 1000 * PS.fromRH(T, 90, P, ice), C.amber, 0.16);
    band(T => 1000 * PS.fromRH(T, 90, P, ice), Ws, C.danger, 0.16);
  }
  if (v.vpdZone) {
    const lo = Math.min(v.vpdLo, v.vpdHi), hi = Math.max(v.vpdLo, v.vpdHi);
    const Wv = (T, d) => { const e = PS.es(T, ice) - d; return e > 0 ? 1000 * PS.Wfe(e, P) : 0; };
    band(T => Wv(T, hi), T => Wv(T, lo), C.accent, 0.2);
  }
  // specific-volume lines
  ctx.font = "500 10px 'JetBrains Mono', monospace";
  if (v.vLines) {
    ctx.strokeStyle = withAlpha(C.magenta, 0.45); ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    for (let vv = 0.72; vv <= 1.3; vv += 0.02) {
      const pp = []; for (const T of Ts) { const W = (vv * P / (PS.RDA * (T + 273.15)) - 1) / 1.607858; if (W >= 0 && W <= PS.Wsat(T, P, ice)) pp.push([T, 1000 * W]); }
      if (pp.length < 2) continue;
      ctx.beginPath(); pp.forEach(([T, W], i) => i ? ctx.lineTo(X(T), Y(W)) : ctx.moveTo(X(T), Y(W))); ctx.stroke();
      if (Math.round(vv * 100) % 4 === 0) { ctx.setLineDash([]); ctx.fillStyle = withAlpha(C.magenta, 0.9); ctx.textAlign = 'center'; ctx.fillText(vv.toFixed(2), X(pp[0][0]), Y(0) - 4); ctx.setLineDash([2, 3]); }
    }
    ctx.setLineDash([]);
  }
  // wet-bulb lines
  if (v.wbLines) {
    ctx.strokeStyle = withAlpha(C.water, 0.55); ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
    for (let tw = Math.ceil(R.T0 / 5) * 5; tw <= R.T1; tw += 5) {
      ctx.beginPath(); let started = false;
      for (let T = tw; T <= R.T1; T += 0.5) { const W = 1000 * PS.wetBulbLineW(tw, T, P, ice); if (W < 0) break; const x = X(T), y = Y(W); started ? ctx.lineTo(x, y) : ctx.moveTo(x, y); started = true; }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // enthalpy lines
  const hSat = [];
  if (v.hLines) {
    ctx.strokeStyle = withAlpha(C.amber, 0.75);
    const hMin = Math.ceil(PS.enthalpy(R.T0, 0) / 5) * 5, hMax = PS.enthalpy(R.T1, PS.Wsat(R.T1, P, ice) * 0 + R.W1 / 1000) ;
    for (let hh = hMin; hh <= hMax; hh += 5) {
      const Tsat = PS.satTempFromH(hh, P, ice), T0 = hh / 1.006;
      ctx.lineWidth = hh % 10 === 0 ? 1.1 : 0.6;
      ctx.beginPath(); let started = false;
      for (let k = 0; k <= 40; k++) { const T = Tsat + (T0 - Tsat) * k / 40; const W = 1000 * (hh - 1.006 * T) / (2501 + 1.86 * T); const x = X(T), y = Y(W); started ? ctx.lineTo(x, y) : ctx.moveTo(x, y); started = true; }
      ctx.stroke();
      if (hh % 10 === 0) hSat.push([hh, Tsat]);
    }
  }
  // RH curves
  for (let rh = 10; rh <= 100; rh += 10) {
    ctx.strokeStyle = rh === 100 ? C.water : withAlpha(C.ink.startsWith('#') ? C.ink : '#444444', dark ? 0.45 : 0.35);
    ctx.lineWidth = rh === 100 ? 2.6 : rh % 50 === 0 ? 1.2 : 0.8;
    ctx.beginPath(); Ts.forEach((T, i) => { const W = 1000 * PS.fromRH(T, rh, P, ice); i ? ctx.lineTo(X(T), Y(W)) : ctx.moveTo(X(T), Y(W)); }); ctx.stroke();
  }
  ctx.restore(); // end clip
  // RH labels
  ctx.font = "600 10.5px Inter, sans-serif"; ctx.fillStyle = inkSoft; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let rh = 10; rh <= 90; rh += 10) {
    let TL = R.T1 - (R.T1 - R.T0) * 0.07; let W = 1000 * PS.fromRH(TL, rh, P, ice);
    if (W > R.W1 * 0.93) { let lo = R.T0, hi = R.T1; for (let i = 0; i < 40; i++) { const mm = 0.5 * (lo + hi); if (1000 * PS.fromRH(mm, rh, P, ice) > R.W1 * 0.9) hi = mm; else lo = mm; } TL = lo; W = 1000 * PS.fromRH(TL, rh, P, ice); }
    const W2 = 1000 * PS.fromRH(TL + 0.5, rh, P, ice); const ang = Math.atan2(Y(W2) - Y(W), X(TL + 0.5) - X(TL));
    ctx.save(); ctx.translate(X(TL), Y(W) - 1); ctx.rotate(ang); ctx.fillStyle = C.bgElev; ctx.fillRect(-13, -7, 26, 13); ctx.fillStyle = inkSoft; ctx.fillText(rh + '%', 0, 0); ctx.restore();
  }
  // saturation-temperature scale and enthalpy labels on the saturation curve
  ctx.fillStyle = C.water; ctx.font = "600 10px 'JetBrains Mono', monospace"; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  for (let T = Math.ceil(R.T0 / 5) * 5; T <= R.T1; T += 5) { const W = Ws(T); if (W > R.W1) break; ctx.beginPath(); ctx.arc(X(T), Y(W), 2.2, 0, 7); ctx.fill(); ctx.fillText(String(T), X(T) - 4, Y(W) - 2); }
  if (v.hLines) { ctx.fillStyle = C.amber; ctx.strokeStyle = withAlpha(C.amber, 0.7); ctx.lineWidth = 0.8; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; hSat.forEach(([hh, Tsat]) => { const W = Ws(Tsat); if (W > R.W1 * 0.97 || Tsat < R.T0) return; const Te = Tsat - 2.6, We = 1000 * (hh - 1.006 * Te) / (2501 + 1.86 * Te); ctx.beginPath(); ctx.moveTo(X(Tsat), Y(W)); ctx.lineTo(X(Te), Y(We)); ctx.stroke(); ctx.fillText(String(hh), X(Te) - 2, Y(We) - 3); }); }
  // axes
  ctx.strokeStyle = C.lineStrong || C.muted; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(m.l, Y(0) + 0.5); ctx.lineTo(X(R.T1), Y(0) + 0.5); ctx.lineTo(X(R.T1) + 0.5, Y(R.W1)); ctx.stroke();
  ctx.fillStyle = C.muted; ctx.font = "500 10.5px 'JetBrains Mono', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let T = Math.ceil(R.T0 / 5) * 5; T <= R.T1; T += 5) ctx.fillText(String(T), X(T), Y(0) + 6);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (let W = 0; W <= R.W1; W += (R.W1 > 30 ? 5 : 2)) ctx.fillText(String(W), X(R.T1) + 6, Y(W));
  ctx.fillStyle = C.ink2 || C.ink; ctx.font = "600 12px Inter, sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('Dry-bulb temperature (°C)', m.l + g.pw / 2, h - 4);
  ctx.save(); ctx.translate(w - 12, m.t + g.ph / 2); ctx.rotate(Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText('Humidity ratio W (g per kg dry air)', 0, 0); ctx.restore();
  // legend chips (top-left inside plot)
  ctx.font = "600 10.5px Inter, sans-serif"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const leg = [[C.water, 'saturation (100 %) · dew-point scale'], [inkSoft, 'relative humidity'], ...(v.hLines ? [[C.amber, 'enthalpy kJ kg⁻¹']] : []), ...(v.wbLines ? [[C.water, 'wet bulb (dashed)']] : []), ...(v.vLines ? [[C.magenta, 'specific volume m³ kg⁻¹ (dotted)']] : []), ...(v.vpdZone ? [[C.accent, `VPD ${fmt(Math.min(v.vpdLo, v.vpdHi), 2)}–${fmt(Math.max(v.vpdLo, v.vpdHi), 2)} kPa`]] : []), ...(v.botry ? [[C.danger, 'Botrytis risk RH > 85 / 90 %']] : [])];
  let ly = m.t + 72;
  leg.forEach(([col, txt]) => { ctx.fillStyle = col; ctx.fillRect(m.l + 10, ly - 1.5, 14, 3); ctx.fillStyle = C.ink2 || C.ink; ctx.fillText(txt, m.l + 30, ly); ly += 15; });
  ctx.fillStyle = C.muted; ctx.font = "500 10.5px 'JetBrains Mono', monospace";
  ctx.fillText(`P = ${fmt(P, 2)} kPa${v.alt > 0 ? ` (${fmt(v.alt, 0)} m)` : ''}${ice ? ' · ice below 0 °C' : ''}`, m.l + 10, ly + 4);
  // process path
  if (proc) drawProcess(ctx, g, C);
  // guides for the active point
  const a = pts[active].s;
  if (a) {
    ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, g.pw, g.ph); ctx.clip();
    ctx.setLineDash([3, 3]); ctx.lineWidth = 1.2;
    ctx.strokeStyle = C.water; ctx.beginPath(); ctx.moveTo(X(a.T), Y(1000 * a.W)); ctx.lineTo(X(a.Td), Y(1000 * a.W)); ctx.stroke();
    ctx.strokeStyle = C.danger; ctx.beginPath(); for (let k = 0; k <= 20; k++) { const T = a.T + (a.Twb - a.T) * k / 20; const W = 1000 * PS.wetBulbLineW(a.Twb, T, P, ice); k ? ctx.lineTo(X(T), Y(W)) : ctx.moveTo(X(T), Y(W)); } ctx.stroke();
    ctx.strokeStyle = C.muted; ctx.beginPath(); ctx.moveTo(X(a.T), Y(1000 * a.W)); ctx.lineTo(X(a.T), Y(0)); ctx.moveTo(X(a.T), Y(1000 * a.W)); ctx.lineTo(X(R.T1), Y(1000 * a.W)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "600 10px 'JetBrains Mono', monospace"; ctx.textBaseline = 'bottom';
    ctx.fillStyle = C.water; ctx.textAlign = 'right'; ctx.fillText(`Td ${fmt(a.Td, 1)}`, X(a.Td) - 4, Y(1000 * a.W) - 3);
    ctx.fillStyle = C.danger; ctx.textAlign = 'right'; ctx.fillText(`Twb ${fmt(a.Twb, 1)}`, X(a.Twb) - 4, Y(1000 * PS.Wsat(a.Twb, P, ice)) - 12);
    ctx.restore();
  }
  // points
  pts.forEach((p, i) => {
    if (!p.s) return; const x = X(p.T), y = Y(1000 * p.W);
    ctx.fillStyle = C.bgElev; ctx.beginPath(); ctx.arc(x, y, i === active ? 10 : 8.5, 0, 7); ctx.fill();
    ctx.fillStyle = categorical(i); ctx.beginPath(); ctx.arc(x, y, i === active ? 7.5 : 6.5, 0, 7); ctx.fill();
    if (i === active) { ctx.strokeStyle = categorical(i); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 13, 0, 7); ctx.stroke(); }
    ctx.fillStyle = C.ink; ctx.font = "700 12.5px Inter, sans-serif"; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(p.name, x + 11, y - 7);
  });
  ctx.restore();
}
function arrow(ctx, x0, y0, x1, y1, col, wdt) {
  const a = Math.atan2(y1 - y0, x1 - x0), L = 11;
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - L * Math.cos(a - 0.4), y1 - L * Math.sin(a - 0.4)); ctx.lineTo(x1 - L * Math.cos(a + 0.4), y1 - L * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill();
}
function drawProcess(ctx, g, C) {
  const { X, Y } = g; const pr = proc; const col = C.magenta;
  ctx.save(); ctx.beginPath(); ctx.rect(g.m.l, g.m.t, g.pw, g.ph); ctx.clip();
  const path = pr.path.map(([T, W]) => [X(T), Y(1000 * W)]);
  if (pr.kind === 'coil' && pr.ext) { ctx.setLineDash([4, 4]); ctx.strokeStyle = withAlpha(col, 0.6); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(pr.ext[0][0]), Y(1000 * pr.ext[0][1])); ctx.lineTo(X(pr.ext[1][0]), Y(1000 * pr.ext[1][1])); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(pr.adp), Y(1000 * pr.Wadp), 5, 0, 7); ctx.fill(); ctx.font = "600 10.5px Inter, sans-serif"; ctx.textAlign = 'right'; ctx.fillText('coil (ADP)', X(pr.adp) - 8, Y(1000 * pr.Wadp) - 8); }
  if (pr.kind === 'mix') {
    ctx.strokeStyle = withAlpha(col, 0.7); ctx.lineWidth = 2; ctx.setLineDash([7, 4]); ctx.beginPath(); ctx.moveTo(path[0][0], path[0][1]); ctx.lineTo(path[1][0], path[1][1]); ctx.stroke(); ctx.setLineDash([]);
    const Mx = X(pr.A.T + 0) ; // mixture on the straight line (before any fog correction)
    const mxT = PS.Tfromh(pr.hm, pr.Wm), mx = X(mxT), my = Y(1000 * pr.Wm);
    ctx.fillStyle = pr.fog > 0 ? C.danger : col; ctx.beginPath(); ctx.arc(mx, my, 6, 0, 7); ctx.fill();
    ctx.font = "700 11px Inter, sans-serif"; ctx.textAlign = 'left'; ctx.fillStyle = pr.fog > 0 ? C.danger : col; ctx.fillText(pr.fog > 0 ? `mixture: FOG ${fmt(1000 * pr.fog, 2)} g kg⁻¹` : 'mixture', mx + 9, my - 8);
    if (pr.fog > 0) { ctx.strokeStyle = C.danger; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(X(pr.B.T), Y(1000 * pr.B.W)); ctx.stroke(); ctx.setLineDash([]); }
    void Mx;
  } else {
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.beginPath(); path.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    const n = path.length; if (n > 1) arrow(ctx, path[n - 2][0], path[n - 2][1], path[n - 1][0], path[n - 1][1], col);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(path[n - 1][0], path[n - 1][1], 5.5, 0, 7); ctx.fill();
    ctx.font = "700 11px Inter, sans-serif"; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(pr.kind === 'room' ? `after ${fmt(ui.get('dur'), 0)} min` : 'leaving air', path[n - 1][0] + 9, path[n - 1][1] - 6);
    if (pr.kind === 'room') {
      ctx.fillStyle = col; ctx.font = "600 9.5px 'JetBrains Mono', monospace";
      const dur = ui.get('dur'), step = dur <= 12 ? 1 : dur <= 30 ? 2 : 5;
      const tEnd = pr.tSat != null ? Math.min(dur, pr.tSat) : dur;
      for (let tk = step; tk < tEnd - 0.35 * step; tk += step) { const i = Math.round(tk / dur * (path.length - 1)); const [x, y] = path[i]; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill(); ctx.fillText(`${fmt(tk, 0)} min`, x + 6, y + 4); }
      if (pr.tSat != null && pr.tSat < dur) { const [x, y] = path[path.length - 1]; ctx.fillStyle = C.danger; ctx.fillText(`saturated after ${fmt(pr.tSat, 1)} min`, x + 8, y + 16); }
      const f = Math.min(1, anim), k = Math.min(path.length - 1, Math.round(f * (path.length - 1)));
      if (clock.running || (anim > 0 && anim < 1)) { ctx.fillStyle = C.danger; ctx.beginPath(); ctx.arc(path[k][0], path[k][1], 7, 0, 7); ctx.fill(); }
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ render loop and resizing */
let queued = false;
function redraw() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; const r = stageEl.getBoundingClientRect(); const d = Math.min(window.devicePixelRatio || 1, 2.5); const w = Math.max(200, r.width), h = Math.max(200, r.height); if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); } const ctx = cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0); draw(ctx, w, h, false); }); }
new ResizeObserver(redraw).observe(stageEl);
document.addEventListener('ffp:theme', () => { redraw(); update(); });

/* ------------------------------------------------------------------ interaction */
function evPos(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function clampPoint(p, T, Wg_) { p.T = Math.max(R.T0, Math.min(R.T1, T)); p.W = Math.max(0, Math.min(PS.Wsat(p.T, P, ice), Wg_ / 1000)); }
function nearest(x, y) { let best = -1, bd = 196; pts.forEach((p, i) => { const dx = G.X(p.T) - x, dy = G.Y(1000 * p.W) - y; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }); return best; }
cv.addEventListener('pointerdown', e => {
  if (!G) return; const [x, y] = evPos(e); const i = nearest(x, y);
  if (i >= 0) { active = i; drag = i; } else if (x > G.m.l && x < G.m.l + G.pw && y > G.m.t && y < G.m.t + G.ph) { clampPoint(pts[active], G.T(x), G.Wg(y)); drag = active; }
  cv.setPointerCapture(e.pointerId); syncActive(); update();
});
cv.addEventListener('pointermove', e => {
  if (!G) return; const [x, y] = evPos(e);
  if (drag != null) { clampPoint(pts[drag], G.T(x), G.Wg(y)); syncActive(); update(); return; }
  const inside = x > G.m.l && x < G.m.l + G.pw && y > G.m.t && y < G.m.t + G.ph;
  cv.style.cursor = nearest(x, y) >= 0 ? 'grab' : 'crosshair';
  if (!inside) { tip.style.display = 'none'; return; }
  const T = G.T(x), W = Math.max(0, G.Wg(y) / 1000); const Wsat = PS.Wsat(T, P, ice);
  if (W > Wsat) { tip.innerHTML = `<b>${fmt(T, 1)} °C</b> · above saturation: fog`; }
  else { const s = PS.state(T, W, P, ice); tip.innerHTML = `<b>${fmt(T, 1)} °C</b> · ${fmt(s.RH, 0)} % RH<br>W ${fmt(1000 * W, 2)} g kg⁻¹ · h ${fmt(s.h, 1)} kJ kg⁻¹<br>T<sub>d</sub> ${fmt(s.Td, 1)} · T<sub>wb</sub> ${fmt(s.Twb, 1)} °C · VPD ${fmt(s.VPD, 2)} kPa`; }
  tip.style.display = 'block'; const r = stageEl.getBoundingClientRect(); tip.style.left = Math.min(r.width - 230, x + 14) + 'px'; tip.style.top = Math.max(4, y - 60) + 'px';
});
cv.addEventListener('pointerup', () => { drag = null; });
cv.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
cv.addEventListener('dblclick', e => { const [x, y] = evPos(e); if (nearest(x, y) >= 0) return; addPoint(G.T(x), Math.min(PS.Wsat(G.T(x), P, ice), G.Wg(y) / 1000)); });
cv.addEventListener('keydown', e => {
  const p = pts[active]; let used = true;
  if (e.key === 'ArrowLeft') p.T -= 0.5; else if (e.key === 'ArrowRight') p.T += 0.5; else if (e.key === 'ArrowUp') p.W += 0.0002; else if (e.key === 'ArrowDown') p.W -= 0.0002; else used = false;
  if (used) { e.preventDefault(); clampPoint(p, p.T, 1000 * p.W); syncActive(); update(); }
});

/* ------------------------------------------------------------------ charts */
const cSweep = new Plot('#chart-sweep', { x: { label: 'x', unit: '' }, y: { label: 'y', unit: '' }, y2: { label: 'y2', unit: '' }, height: 290 });
const cVpd = new Plot('#chart-vpd', { x: { label: 'Temperature', unit: '°C' }, y: { label: 'Vapour pressure', unit: 'kPa', min: 0 }, height: 290 });
const cBar = new BarChart('#chart-bar', { y: { label: 'Change per kg of dry air', unit: 'kJ kg⁻¹' }, height: 290, legend: false });

function drawSweep() {
  const tool = ui.get('tool'); const a = pts[active].s; const V = ui.get('flow');
  cSweep.clear();
  const xs = [], y1 = [], y2 = [];
  let cur = null;
  if (tool === 'coil') {
    for (let t = -5; t <= 25; t += 0.5) { const r = PS.coil(a, t, ui.get('bf'), V, P, ice); xs.push(t); y1.push(-r.water * 3600); y2.push(-r.Q); }
    cSweep.setAxis('x', { label: 'Coil temperature (ADP)', unit: '°C', min: -5, max: 25 }); cSweep.setAxis('y', { label: 'Condensate', unit: 'kg h⁻¹', min: 0 }); cSweep.setAxis('y2', { label: 'Cooling load', unit: 'kW', min: 0 });
    cSweep.line('a', xs, y1, { color: 'water', width: 2.4, label: 'Condensate' }); cSweep.line('b', xs, y2, { color: 'amber', width: 2, y2: true, label: 'Total cooling load' });
    cur = [ui.get('adp'), -proc.water * 3600];
    cSweep.vline('dp', a.Td, { color: 'muted', label: `dew point ${fmt(a.Td, 1)} °C` });
  } else if (tool === 'heat') {
    for (let t = -10; t <= 50; t += 0.5) { const r = PS.heatCool(a, t, V, P, ice); xs.push(t); y1.push(r.Q); y2.push(Math.min(100, r.B.RH)); }
    cSweep.setAxis('x', { label: 'Target temperature', unit: '°C', min: -10, max: 50 }); cSweep.setAxis('y', { label: 'Heat flow (+ heating, − cooling)', unit: 'kW', min: 'auto' }); cSweep.setAxis('y2', { label: 'Leaving RH', unit: '%', min: 0, max: 100 });
    cSweep.line('a', xs, y1, { color: 'amber', width: 2.4, label: 'Heat flow' }); cSweep.line('b', xs, y2, { color: 'water', width: 2, y2: true, label: 'Leaving RH' });
    cur = [ui.get('T2'), proc.Q];
  } else if (tool === 'evap') {
    for (let e = 0; e <= 100; e += 2) { const r = PS.evaporative(a, e / 100, V, P, ice); xs.push(e); y1.push(r.B.T); y2.push(r.water * 3600); }
    cSweep.setAxis('x', { label: 'Pad effectiveness', unit: '%', min: 0, max: 100 }); cSweep.setAxis('y', { label: 'Leaving temperature', unit: '°C', min: 'auto' }); cSweep.setAxis('y2', { label: 'Water evaporated', unit: 'L h⁻¹', min: 0 });
    cSweep.line('a', xs, y1, { color: 'accent', width: 2.4, label: 'Leaving dry bulb' }); cSweep.line('b', xs, y2, { color: 'water', width: 2, y2: true, label: 'Water use' });
    cSweep.hline('wb', a.Twb, { color: 'danger', label: `wet bulb ${fmt(a.Twb, 1)} °C` });
    cur = [ui.get('eta'), proc.B.T];
  } else if (tool === 'mix') {
    const B = otherPoint().s || a;
    for (let x = 0; x <= 100; x += 2) { const r = PS.mix(a, B, x / 100, V, P, ice); xs.push(x); y1.push(r.B.T); y2.push(1000 * r.fog); }
    cSweep.setAxis('x', { label: 'Share of point B', unit: '%', min: 0, max: 100 }); cSweep.setAxis('y', { label: 'Mixture temperature', unit: '°C', min: 'auto' }); cSweep.setAxis('y2', { label: 'Fog (liquid water)', unit: 'g kg⁻¹', min: 0 });
    cSweep.line('a', xs, y1, { color: 'accent', width: 2.4, label: 'Mixture temperature' }); cSweep.line('b', xs, y2, { color: 'danger', width: 2, y2: true, label: 'Fog formed' });
    cur = [ui.get('xmix'), proc.B.T];
  } else if (tool === 'room') {
    const pth = proc.path, tt = proc.times;
    const rh = pth.map(([T, W]) => Math.min(100, 100 * PS.eFW(W, P) / PS.es(T, ice)));
    cSweep.setAxis('x', { label: 'Time without dehumidification', unit: 'min', min: 0, max: ui.get('dur') }); cSweep.setAxis('y', { label: 'Relative humidity', unit: '%', min: 0, max: 100 }); cSweep.setAxis('y2', { label: 'Humidity ratio', unit: 'g kg⁻¹', min: 'auto' });
    cSweep.line('a', tt, rh, { color: 'water', width: 2.4, label: 'Relative humidity' }); cSweep.line('b', tt, pth.map(p => 1000 * p[1]), { color: 'amber', width: 2, y2: true, label: 'Humidity ratio' });
    cSweep.hregion('rh90', 90, 100, { color: 'danger', alpha: 0.1, label: 'RH > 90 %' });
    if (proc.t90 != null) cSweep.vline('t90', proc.t90, { color: 'danger', label: `90 % after ${fmt(proc.t90, 1)} min` });
    cur = null;
  } else {
    // no process: RH of the active air if only its temperature changes (sensible heating/cooling)
    for (let t = R.T0; t <= R.T1; t += 0.5) { if (t < a.Td) continue; xs.push(t); y1.push(100 * a.e / PS.es(t, ice)); y2.push(PS.es(t, ice) - a.e); }
    cSweep.setAxis('x', { label: 'Air temperature at the same moisture content', unit: '°C', min: R.T0, max: R.T1 }); cSweep.setAxis('y', { label: 'Relative humidity', unit: '%', min: 0, max: 100 }); cSweep.setAxis('y2', { label: 'VPD', unit: 'kPa', min: 0 });
    cSweep.line('a', xs, y1, { color: 'water', width: 2.4, label: 'RH if heated or cooled' }); cSweep.line('b', xs, y2, { color: 'magenta', width: 2, y2: true, label: 'VPD' });
    cur = [a.T, a.RH];
  }
  if (cur) cSweep.point('cur', cur[0], cur[1], { color: 'magenta', r: 5 });
  document.getElementById('sweep-title').textContent = { none: 'Heating or cooling the active air: RH and VPD', heat: 'Heating / cooling: heat flow and leaving RH', coil: 'Cooling coil: condensate and load versus coil temperature', evap: 'Pad cooling: leaving temperature and water use', mix: 'Mixing: temperature and fog versus share of B', room: 'Closed room: humidity and temperature over time' }[tool];
}
function drawVpd() {
  const Ts = []; for (let t = R.T0; t <= R.T1; t += 0.25) Ts.push(t);
  cVpd.setAxis('x', { min: R.T0, max: R.T1 });
  cVpd.line('es', Ts, Ts.map(t => PS.es(t, ice)), { color: 'water', width: 2.4, label: 'Saturation e_s(T)' });
  const v = ui.values();
  cVpd.line('lo', Ts, Ts.map(t => Math.max(0, PS.es(t, ice) - Math.min(v.vpdLo, v.vpdHi))), { color: 'accent', width: 1.2, dash: [4, 4], label: 'VPD zone limits' });
  cVpd.line('hi', Ts, Ts.map(t => Math.max(0, PS.es(t, ice) - Math.max(v.vpdLo, v.vpdHi))), { color: 'accent', width: 1.2, dash: [4, 4], noLegend: true });
  pts.forEach((p, i) => { if (!p.s) return; cVpd.custom('v' + i, (ctx, pl) => { const x = pl.px(p.T), y0 = pl.py(p.s.e), y1 = pl.py(p.s.es); ctx.strokeStyle = categorical(i); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.fillStyle = categorical(i); ctx.beginPath(); ctx.arc(x, y0, 5, 0, 7); ctx.fill(); ctx.font = '600 11px Inter, sans-serif'; ctx.fillText(`${p.name}: VPD ${fmt(p.s.VPD, 2)}`, x + 6, (y0 + y1) / 2); }); });
  for (let i = pts.length; i < NAMES.length; i++) cVpd.remove('v' + i);
}
function drawBar() {
  if (!proc || proc.kind === 'mix') {
    const a = pts[active].s; const sens = 1.006 * a.T + a.W * 1.86 * a.T, lat = a.W * 2501;
    cBar.set(['Sensible (dry air + vapour)', 'Latent (2501 W)', 'Total enthalpy h'], [{ label: 'kJ kg⁻¹', values: [sens, lat, a.h], colors: ['#e2672a', '#3fa6c9', '#8a8f8c'], format: v => fmt(v, 1) }]);
    document.getElementById('bar-title').textContent = `Where the energy of point ${pts[active].name} sits (kJ per kg of dry air)`;
    return;
  }
  const A = proc.A, B = proc.B;
  const dS = (1.006 + 1.86 * A.W) * (B.T - A.T), dL = (B.W - A.W) * (2501 + 1.86 * B.T), dH = B.h - A.h;
  cBar.set(['Sensible Δ', 'Latent Δ', 'Enthalpy Δh'], [{ label: 'kJ kg⁻¹', values: [dS, dL, dH], colors: ['#e2672a', '#3fa6c9', '#8a8f8c'], format: v => fmt(v, 2) }]);
  document.getElementById('bar-title').textContent = 'Change of the air per kg of dry air (kJ kg⁻¹)';
}

/* ------------------------------------------------------------------ update */
let anim = 1;
/** The partner stream for mixing: point B, or point A when B is active (the active point itself if it is alone). */
const otherPoint = () => pts.length > 1 ? pts[active === 1 ? 0 : 1] : pts[active];
function computeProcess() {
  const v = ui.values(); const a = pts[active].s; const V = v.flow;
  switch (v.tool) {
    case 'heat': return PS.heatCool(a, v.T2, V, P, ice);
    case 'coil': return PS.coil(a, v.adp, v.bf, V, P, ice);
    case 'evap': return PS.evaporative(a, v.eta / 100, V, P, ice);
    case 'mix': return PS.mix(a, otherPoint().s, v.xmix / 100, V, P, ice);
    case 'room': return PS.room(a, v.area, v.hroom, v.Erate, v.qs, v.dur, P, ice);
    default: return null;
  }
}
function update() {
  const v = ui.values();
  P = PS.pAt(v.alt); ice = v.ice; R = RANGES[v.range];
  pts.forEach(refreshPoint);
  const tool = v.tool;
  ['flow'].forEach(id => ui.show(id, tool !== 'none' && tool !== 'room'));
  ui.show('T2', tool === 'heat'); ui.show('adp', tool === 'coil'); ui.show('bf', tool === 'coil'); ui.show('eta', tool === 'evap'); ui.show('xmix', tool === 'mix');
  ['area', 'hroom', 'Erate', 'qs', 'dur'].forEach(id => ui.show(id, tool === 'room'));
  ui.show('vpdLo', v.vpdZone); ui.show('vpdHi', v.vpdZone);
  proc = computeProcess();
  // readouts: active point
  const a = pts[active].s, n = pts[active].name;
  ro.set('T', a.T, null, `point ${n} · e = ${fmt(a.e, 3)} kPa`);
  ro.set('RH', Math.min(100, a.RH), a.RH > 90 ? 'bad' : a.RH > 85 ? 'warn' : null, a.RH > 90 ? 'Botrytis risk' : a.RH > 85 ? 'humid' : `e<sub>s</sub> = ${fmt(a.es, 3)} kPa`);
  ro.set('W', 1000 * a.W, null, `specific humidity ${fmt(1000 * a.W / (1 + a.W), 2)} g kg⁻¹`);
  ro.set('Td', a.Td, null, ice && a.Td < 0 ? 'frost point (over ice)' : 'condensation on colder surfaces');
  ro.set('Twb', a.Twb, null, `thermodynamic · Stull (sea level): ${fmt(stullWetBulb(a.T, Math.min(99, Math.max(5, a.RH))), 1)} °C`);
  ro.set('h', a.h, null, `sensible ${fmt(1.006 * a.T, 1)} + vapour ${fmt(a.W * (2501 + 1.86 * a.T), 1)}`);
  const lo = Math.min(v.vpdLo, v.vpdHi), hi = Math.max(v.vpdLo, v.vpdHi);
  ro.set('VPD', a.VPD, a.VPD >= lo && a.VPD <= hi ? 'ok' : a.VPD < 0.3 || a.VPD > 2 ? 'bad' : 'warn', a.VPD >= lo && a.VPD <= hi ? 'inside the comfort zone' : a.VPD < lo ? 'too humid for the zone' : 'too dry for the zone');
  ro.set('AH', a.AH, null, 'vapour density ρ<sub>v</sub>');
  ro.set('rho', a.rho, null, `P = ${fmt(P, 2)} kPa`);
  ro.set('v', a.v, null, 'per kg of dry air');
  // process readouts
  if (!proc) { ['st2', 'Q', 'Qs', 'Ql', 'water', 'SHR'].forEach(id => pro.set(id, NaN, null, id === 'st2' ? 'choose a process in the panel' : '&nbsp;')); }
  else {
    const B = proc.B;
    pro.set('st2', B.T, null, `${fmt(Math.min(100, B.RH), 0)} % RH · W ${fmt(1000 * B.W, 2)} g kg⁻¹ · h ${fmt(B.h, 1)} kJ kg⁻¹`);
    if (proc.kind === 'mix') {
      pro.set('Q', 0, null, 'adiabatic: no heat added'); pro.set('Qs', NaN, null, '&nbsp;'); pro.set('Ql', NaN, null, '&nbsp;');
      pro.set('water', proc.fogFlow * 3600, proc.fog > 0 ? 'bad' : 'ok', proc.fog > 0 ? `FOG: ${fmt(1000 * proc.fog, 2)} g per kg dry air condenses` : 'no fog: mixture stays below saturation');
      pro.set('SHR', NaN, null, '&nbsp;');
    } else {
      pro.set('Q', proc.Q, null, proc.kind === 'room' ? 'total load on the room (sensible + latent)' : proc.Q >= 0 ? 'heat added to the air' : 'heat removed from the air');
      pro.set('Qs', proc.Qs, null, proc.kind === 'room' ? `${fmt(ui.get('qs'), 0)} W m⁻² × ${fmt(ui.get('area'), 0)} m²` : `ṁ<sub>a</sub> = ${fmt(proc.ma, 3)} kg s⁻¹`);
      pro.set('Ql', proc.Ql, null, proc.kind === 'room' ? 'λE of the transpiring crop' : 'latent heat of the water added or removed');
      const wl = proc.water * 3600;
      pro.set('water', Math.abs(wl), proc.kind === 'coil' && wl < 0 ? 'ok' : null, proc.kind === 'coil' || (proc.kind === 'heat' && wl < 0) ? 'condensate recovered' : proc.kind === 'evap' ? 'evaporated from the pad' : proc.kind === 'room' ? `transpired · RH 90 % ${proc.t90 != null ? `after ${fmt(proc.t90, 1)} min` : 'not reached'}` : 'no water change');
      const shr = proc.kind === 'room' ? proc.SHR : Math.abs(proc.Q) > 1e-6 ? proc.Qs / proc.Q : NaN;
      pro.set('SHR', shr, null, 'sensible ÷ total');
    }
  }
  hud.set('p', `Point <b>${n}</b>: <b>${fmt(a.T, 1)} °C</b> · <b>${fmt(Math.min(100, a.RH), 0)} %</b> · T<sub>d</sub> <b>${fmt(a.Td, 1)}</b> · h <b>${fmt(a.h, 1)}</b>`);
  hud.set('P', `P <b>${fmt(P, 2)} kPa</b>${v.alt ? ` · ${fmt(v.alt, 0)} m` : ''}`);
  drawSweep(); drawVpd(); drawBar(); redraw();
}

/* ------------------------------------------------------------------ animation of the closed room */
const clock = new SimClock({ speed: 1, onStep: dt => { anim = Math.min(1, anim + dt / 8); if (anim >= 1) clock.pause(); }, onFrame: () => redraw() });
clock.onState(r => { animBtn.innerHTML = r ? '❚❚ Pause' : '▶ Animate the room'; });

/* ------------------------------------------------------------------ export */
function exportPNG() {
  const r = stageEl.getBoundingClientRect(); const s = 2; const w = Math.round(r.width), h = Math.round(r.height);
  const c = document.createElement('canvas'); c.width = w * s; c.height = h * s; const ctx = c.getContext('2d'); ctx.setTransform(s, 0, 0, s, 0, 0);
  draw(ctx, w, h, true);
  const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = 'psychrometric-chart.png'; a.click();
}
function exportCSV() {
  const rows = pts.map(p => { const s = p.s; return [p.name, +s.T.toFixed(2), +s.RH.toFixed(2), +(1000 * s.W).toFixed(3), +s.Td.toFixed(2), +s.Twb.toFixed(2), +s.h.toFixed(2), +s.VPD.toFixed(3), +s.AH.toFixed(2), +s.rho.toFixed(4), +s.v.toFixed(4), +P.toFixed(3)]; });
  downloadCSV('psychrometric-points.csv', ['point', 'T_C', 'RH_pct', 'W_g_per_kg', 'dew_point_C', 'wet_bulb_C', 'h_kJ_per_kg', 'VPD_kPa', 'abs_humidity_g_m3', 'density_kg_m3', 'spec_volume_m3_kg', 'P_kPa'], rows);
}

/* ------------------------------------------------------------------ events and start */
ui.onChange((st, id) => {
  if (id === 'pT' || id === 'pRH') { const p = pts[active]; p.T = st.pT; p.W = Math.min(PS.Wsat(p.T, P, ice), PS.fromRH(p.T, st.pRH, P, ice)); update(); return; }
  if (id === 'alt' || id === 'ice') { const keep = pts.map(p => [p.T, Math.min(100, p.RH)]); P = PS.pAt(st.alt); ice = st.ice; keep.forEach(([T, RH], i) => { pts[i].W = PS.fromRH(T, RH, P, ice); }); }
  if (id === 'tool') anim = 1;
  update(); if (id === 'alt' || id === 'ice') syncActive();
});
pts.forEach(p => { p.W = PS.fromRH(p.T, p.RH, P, ice); });
syncActive();
update();
