/* ==========================================================================
   CO₂ enrichment balance — UI, animated greenhouse / growing-room schematic
   with CO₂ molecules, daily time series, cost–benefit and optimum charts.
   The model is in ./model.js (Eqs. CB1–CB9 in the Derive tab).
   ========================================================================== */
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, Sankey, linspace, downloadCSV } from '/assets/js/plot.js';
import { solarElevation } from '/assets/js/physics.js';
import { evaluate, bestSetpoint, optimalController, drivers, C_OUT, MID_DOY, MONTHS } from './model.js';

/* ------------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'meanC', label: 'Mean CO₂ in daylight', unit: 'µmol mol⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'inj', label: 'CO₂ supplied', unit: 'kg ha⁻¹ d⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'up', label: 'Crop CO₂ uptake', unit: 'kg ha⁻¹ d⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'eff', label: 'Dosed CO₂ turned into extra uptake', unit: '%', digits: 1, note: '&nbsp;' })
  .add({ id: 'lost', label: 'CO₂ lost through vents and leaks', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'yield', label: 'Extra marketable yield', unit: 'kg ha⁻¹ d⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'cost', label: 'CO₂ cost', unit: '€ ha⁻¹ d⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'margin', label: 'Net margin of enrichment', unit: '€ ha⁻¹ d⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'opt', label: 'Best fixed set-point for this day', unit: 'µmol mol⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'costkg', label: 'Cost per extra kg of CO₂ fixed', unit: '€ kg⁻¹', digits: 2, note: '&nbsp;' });

ui.section('Facility and season');
ui.segmented({ id: 'fac', label: 'Facility', options: [{ value: 'greenhouse', label: 'Greenhouse (sunlight)' }, { value: 'room', label: 'Closed room (LEDs)' }], value: 'greenhouse' });
ui.slider({ id: 'lat', label: 'Latitude', min: 0, max: 70, step: 0.1, value: 59.6, unit: '° N', help: 'Västerås 59.6° · Amsterdam 52.4° · Almería 36.8°' });
ui.select({ id: 'month', label: 'Month (mid-month day)', options: MONTHS.map((m, i) => ({ value: String(i), label: m })), value: '3' });
ui.slider({ id: 'clear', label: 'Sky clearness', min: 0.2, max: 1, step: 0.01, value: 0.6, help: 'Fraction of the clear-sky global radiation (1 = cloudless)' });
ui.slider({ id: 'tau', label: 'Greenhouse light transmission', min: 0.5, max: 0.9, step: 0.01, value: 0.7 });
ui.slider({ id: 'lamp', label: 'Supplementary lighting', min: 0, max: 250, step: 5, value: 0, unit: 'µmol m⁻² s⁻¹', help: 'On 05:00–21:00 when outdoor radiation is below 150 W m⁻²' });
ui.slider({ id: 'roomPPFD', label: 'LED PPFD per tier (room)', min: 100, max: 500, step: 5, value: 250, unit: 'µmol m⁻² s⁻¹' });
ui.slider({ id: 'roomPhoto', label: 'Photoperiod (room)', min: 12, max: 24, step: 0.5, value: 16, unit: 'h d⁻¹' });
ui.slider({ id: 'tiers', label: 'Growing tiers (room)', min: 1, max: 10, step: 1, value: 4 });
ui.slider({ id: 'h', label: 'Mean air height (volume per floor area)', min: 2, max: 8, step: 0.1, value: 5.5, unit: 'm' });
ui.slider({ id: 'T', label: 'Air temperature', min: 10, max: 30, step: 0.5, value: 20, unit: '°C' });
ui.section('Crop (van Henten lettuce model)');
ui.slider({ id: 'cover', label: 'Average canopy closure', min: 20, max: 99, step: 1, value: 65, unit: '%', help: 'Cycle-average ground cover of a crop harvested every few weeks; sets the crop dry weight X = −ln(1 − cover)/53 (van Henten, 1994)' });
ui.slider({ id: 'price', label: 'Lettuce price (assumed)', min: 0.3, max: 5, step: 0.05, value: 1.0, unit: '€ kg⁻¹' });
ui.slider({ id: 'dmc', label: 'Dry-matter content', min: 3, max: 8, step: 0.1, value: 5, unit: '%' });
ui.slider({ id: 'hi', label: 'Marketable share of dry matter', min: 0.5, max: 1, step: 0.01, value: 0.9 });
ui.section('Ventilation');
ui.segmented({ id: 'vmode', label: 'Greenhouse vents', options: [{ value: 'sun', label: 'Open with the sun' }, { value: 'const', label: 'Constant' }], value: 'sun' });
ui.slider({ id: 'N', label: 'Air exchange rate (constant / room)', min: 0.01, max: 60, step: 0.01, value: 2, unit: 'h⁻¹', log: true, digits: 2, help: 'Closed greenhouse 0.2–1 · vents open 20–60 · plant factory 0.01–0.02' });
ui.slider({ id: 'Nmin', label: 'Vents closed (leakage)', min: 0.05, max: 5, step: 0.05, value: 0.5, unit: 'h⁻¹' });
ui.slider({ id: 'Nmax', label: 'Vents fully open', min: 1, max: 60, step: 1, value: 20, unit: 'h⁻¹', help: 'Reached at 550 W m⁻² outdoor radiation' });
ui.section('CO₂ dosing');
ui.segmented({ id: 'strat', label: 'Strategy', options: [{ value: 'fixed', label: 'Fixed set-point' }, { value: 'coupled', label: 'Lower when vents open' }, { value: 'optimal', label: 'Economic optimum' }], value: 'fixed' });
ui.slider({ id: 'Cset', label: 'Set-point in daylight', min: 430, max: 1500, step: 10, value: 800, unit: 'µmol mol⁻¹' });
ui.slider({ id: 'Clow', label: 'Set-point with vents open', min: 427, max: 800, step: 5, value: 450, unit: 'µmol mol⁻¹' });
ui.slider({ id: 'Nsw', label: '… when air exchange exceeds', min: 0.5, max: 10, step: 0.1, value: 2, unit: 'h⁻¹' });
ui.slider({ id: 'Cmax', label: 'Upper limit (physiology)', min: 800, max: 2000, step: 50, value: 1200, unit: 'µmol mol⁻¹', help: 'Benefits above ≈ 1200 µmol mol⁻¹ are small and uncertain (Lesson 8.3)' });
ui.slider({ id: 'cap', label: 'Dosing capacity', min: 25, max: 400, step: 5, value: 200, unit: 'kg ha⁻¹ h⁻¹', help: 'Typical 100–300 kg ha⁻¹ h⁻¹ (van Tuyll et al., 2022)' });
ui.slider({ id: 'p', label: 'CO₂ price', min: 0.03, max: 0.8, step: 0.01, value: 0.15, unit: '€ kg⁻¹', help: '≈ 0.15 € kg⁻¹ delivered in the Netherlands (Pennisi et al., 2025)' });
ui.section('Simulation');
const playBtns = ui.buttons([{ label: '❚❚ Pause', variant: 'primary', onClick: () => clock.toggle() }, { label: 'CSV (day)', onClick: () => exportCSV() }]);
ui.segmented({ id: 'speed', label: 'Speed', options: [{ value: 1800, label: '1 h / 2 s' }, { value: 3600, label: '1 h / s' }, { value: 10800, label: '3 h / s' }], value: 3600, persist: false });
ui.presets([
  { label: 'Swedish spring day', values: { fac: 'greenhouse', lat: 59.6, month: '3', clear: 0.6, tau: 0.7, lamp: 0, h: 5.5, T: 20, cover: 65, vmode: 'sun', Nmin: 0.5, Nmax: 20, strat: 'fixed', Cset: 800, cap: 200, p: 0.15, price: 1.0 } },
  { label: 'Summer, vents wide open', values: { fac: 'greenhouse', month: '6', clear: 0.8, vmode: 'sun', Nmin: 0.5, Nmax: 40, strat: 'fixed', Cset: 800 } },
  { label: 'Winter with lamps', values: { fac: 'greenhouse', month: '0', clear: 0.4, lamp: 150, vmode: 'const', N: 0.3, strat: 'fixed', Cset: 1000 } },
  { label: 'Economic controller', values: { fac: 'greenhouse', month: '6', clear: 0.8, vmode: 'sun', Nmax: 40, strat: 'optimal' } },
  { label: 'Plant factory room', values: { fac: 'room', N: 0.02, h: 3.5, tiers: 4, roomPPFD: 250, roomPhoto: 16, strat: 'fixed', Cset: 1000, cap: 200 } },
  { label: 'Cheap CO₂, dear lettuce', values: { p: 0.08, price: 2.5 } },
  { label: 'Expensive CO₂ (€0.40)', values: { p: 0.4, price: 1.0 } }
]);
ui.saveButton('co2-balance', () => ro.values());

function syncEnabled(v) {
  const gh = v.fac === 'greenhouse';
  ['lat', 'month', 'clear', 'tau', 'lamp', 'vmode', 'Nmin', 'Nmax'].forEach(id => ui.enable(id, gh));
  ['roomPPFD', 'roomPhoto', 'tiers'].forEach(id => ui.enable(id, !gh));
  ui.enable('N', !gh || v.vmode === 'const');
  ui.enable('Nmin', gh && v.vmode === 'sun'); ui.enable('Nmax', gh && v.vmode === 'sun');
  ui.enable('Cset', v.strat !== 'optimal'); ui.enable('Clow', v.strat === 'coupled'); ui.enable('Nsw', v.strat === 'coupled');
}
function params() { const v = ui.values(); return Object.assign({}, v, { month: +v.month, Xd: -Math.log(1 - v.cover / 100) / 53 }); }

/* ------------------------------------------------------------------ charts */
const cPlot = new Plot('#chart-conc', { x: { label: 'Time of day', unit: 'h', min: 0, max: 24 }, y: { label: 'CO₂ concentration', unit: 'µmol mol⁻¹', min: 0 }, y2: { label: 'PPFD at the canopy', unit: 'µmol m⁻² s⁻¹', min: 0 } });
const fPlot = new Plot('#chart-flux', { x: { label: 'Time of day', unit: 'h', min: 0, max: 24 }, y: { label: 'CO₂ flux', unit: 'kg ha⁻¹ h⁻¹' }, y2: { label: 'Air exchange rate', unit: 'h⁻¹', min: 0 } });
const ePlot = new Plot('#chart-econ', { x: { label: 'Daylight set-point', unit: 'µmol mol⁻¹' }, y: { label: 'Per day', unit: '€ ha⁻¹ d⁻¹' } });
const oPlot = new Plot('#chart-opt', { x: { label: 'Air exchange rate (constant)', unit: 'h⁻¹', log: true, min: 0.05, max: 60 }, y: { label: 'Best set-point', unit: 'µmol mol⁻¹', min: 400 }, y2: { label: 'Margin', unit: '€ ha⁻¹ d⁻¹' } });
const sk = new Sankey('#chart-budget', { unit: 'kg ha⁻¹', height: 320, digits: 0, gap: 26, flow: true }); // animated dots along the bands

/* ------------------------------------------------------------------ state + update */
let P = null, E = null;
const ha = x => x * 10;                    // g m⁻² → kg ha⁻¹
const eha = x => x * 1e4;                  // € m⁻² → € ha⁻¹
function update() {
  P = params(); syncEnabled(P);
  clock.speed = +P.speed;
  E = evaluate(P);
  const S = E.dose.series, S0 = E.none.series, d = E.dose.tot, n = E.none.tot;
  // readouts
  const minNone = Math.min(...S0.C);
  ro.set('meanC', d.meanC, null, `without dosing ${fmt(n.meanC, 0)} (minimum ${fmt(minNone, 0)})`);
  ro.set('inj', ha(d.inj), null, d.capH > 0.05 ? `capacity-limited for ${fmt(d.capH, 1)} h` : `peak ${fmt(ha(Math.max(...S.inj)), 0)} kg ha⁻¹ h⁻¹`);
  ro.set('up', ha(d.up), null, `+${fmt(100 * E.gain, 1)} % compared with no dosing`);
  const eff = d.inj > 0 ? 100 * E.dUp / d.inj : NaN;
  ro.set('eff', eff, !isFinite(eff) ? null : eff >= 50 ? 'ok' : eff >= 15 ? 'warn' : 'bad', `Kozai CUE (all sources) ${fmt(100 * E.cue, 0)} %`);
  ro.set('lost', 100 * E.lostShare, E.lostShare < 0.3 ? 'ok' : E.lostShare < 0.7 ? 'warn' : 'bad', `mean air exchange in daylight ${fmt(meanN(S), 1)} h⁻¹`);
  ro.set('yield', ha(E.dFW), null, `worth ${fmt(eha(E.benefit), 0)} € ha⁻¹ d⁻¹ (value ${fmt(E.v, 2)} € per kg CO₂)`);
  ro.set('cost', eha(E.cost), null, `at ${fmt(P.p, 2)} € kg⁻¹`);
  ro.set('margin', eha(E.margin), E.margin > 0 ? 'ok' : 'bad', E.margin > 0 ? 'enrichment pays today' : 'enrichment loses money today');
  ro.set('costkg', E.costPerKgExtra, isFinite(E.costPerKgExtra) ? (E.costPerKgExtra < E.v ? 'ok' : 'bad') : null, `worth ${fmt(E.v, 2)} € per kg fixed`);
  // concentration chart
  cPlot.line('ppfd', S.t, S.I, { color: 'amber', y2: true, fill: 0.1, width: 1.2, label: 'PPFD (right axis)' });
  cPlot.line('none', S0.t, S0.C, { color: 'muted', dash: [6, 4], width: 1.8, label: 'No dosing' });
  cPlot.line('dose', S.t, S.C, { color: 'magenta', width: 2.6, label: 'With dosing' });
  cPlot.line('set', S.t, S.set.map(v => v == null ? NaN : v), { color: 'accent', dash: [2, 3], width: 1.6, label: 'Set-point' });
  cPlot.hline('out', C_OUT, { color: 'water', label: 'outdoor air 427' });
  // flux chart
  fPlot.line('N', S.t, S.N, { color: 'amber', y2: true, dash: [5, 4], width: 1.6, label: 'Air exchange (right axis)' });
  fPlot.line('inj', S.t, S.inj.map(ha), { color: 'magenta', width: 2.4, label: 'Supply', step: true });
  fPlot.line('up', S.t, S.up.map(ha), { color: 'accent', width: 2.4, label: 'Crop uptake' });
  fPlot.line('vent', S.t, S.vent.map(ha), { color: 'water', width: 2, label: 'Net loss by ventilation' });
  fPlot.hline('zero', 0, { color: 'muted', dash: [1, 3] });
  // CO₂ budget Sankey (kg ha⁻¹ d⁻¹)
  const inflow = d.ventIn, resp = d.resp, inj = d.inj, up = d.up, vent = d.vent, stored = d.dC;
  const nodes = [
    { id: 'sup', label: 'Dosed CO₂', color: 'magenta', col: 0 }, { id: 'rsp', label: 'Crop respiration', color: 'c7', col: 0 }, { id: 'in', label: 'From outdoor air', color: 'water', col: 0 },
    { id: 'air', label: 'Greenhouse air', color: 'c3', col: 1 },
    { id: 'upk', label: 'Taken up by crop', color: 'accent', col: 2 }, { id: 'out', label: 'Lost through vents', color: 'danger', col: 2 }
  ];
  const links = [['sup', 'air', inj], ['rsp', 'air', resp], ['in', 'air', inflow], ['air', 'upk', up], ['air', 'out', vent]].filter(l => ha(l[2]) > 0.05).map(([s, t, v]) => ({ source: s, target: t, value: ha(v) }));
  const used = new Set(links.flatMap(l => [l.source, l.target]));
  nodes[3].label = P.fac === 'room' ? 'Room air' : 'Greenhouse air';
  nodes[5].label = P.fac === 'room' ? 'Lost by leakage' : 'Lost through vents';
  sk.set({ nodes: nodes.filter(x => used.has(x.id)), links });
  document.getElementById('budget-note').textContent = Math.abs(ha(stored)) > 1 ? `Change in CO₂ stored in the air over the day: ${fmt(ha(stored), 0)} kg ha⁻¹.` : 'The day is periodic: the air stores as much CO₂ at midnight as it did 24 h earlier.';
  scheduleSweeps();
  legend.lastElementChild.lastChild.textContent = P.fac === 'room' ? 'leaking out' : 'leaving through vents';
  stageDirty = true;
}
function meanN(S) { let a = 0, n = 0; S.t.forEach((t, i) => { if (S.I[i] > 20) { a += S.N[i]; n++; } }); return n ? a / n : S.N[0]; }
let sweepT = null, lastSweepKey = '';
function scheduleSweeps() {
  clearTimeout(sweepT);
  sweepT = setTimeout(() => {
    const p = P;
    // cost–benefit against a fixed daylight set-point (grid search gives the best fixed set-point)
    const best = bestSetpoint(p), sw = best.sweep, cs = sw.map(s => s.Cs);
    ePlot.line('ben', cs, sw.map(s => eha(s.benefit)), { color: 'accent', width: 2.4, label: 'Value of extra growth' });
    ePlot.line('cost', cs, sw.map(s => eha(s.cost)), { color: 'danger', width: 2.2, label: 'Cost of CO₂ supplied' });
    ePlot.line('mar', cs, sw.map(s => eha(s.margin)), { color: 'ink', width: 2.8, label: 'Net margin' });
    ePlot.point('best', best.Cs, eha(best.margin), { color: 'magenta', label: `best ${fmt(best.Cs, 0)}` });
    if (p.strat !== 'optimal') ePlot.vline('now', p.Cset, { color: 'amber', label: 'your set-point' }); else ePlot.remove('now');
    ePlot.hline('zero', 0, { color: 'muted', dash: [1, 3] });
    ePlot.setAxis('x', { min: 430, max: Math.max(500, p.Cmax) });
    ro.set('opt', best.Cs, null, `margin ${fmt(eha(best.margin), 0)} € ha⁻¹ d⁻¹ with vents as set`);
    // optimum against a constant air-exchange rate (same day, same crop and prices)
    const key = JSON.stringify([p.fac, p.lat, p.month, p.clear, p.tau, p.lamp, p.roomPPFD, p.roomPhoto, p.tiers, p.h, p.T, p.Xd, p.price, p.dmc, p.hi, p.Cmax, p.cap, p.p]);
    if (key !== lastSweepKey) {
      lastSweepKey = key;
      const Ns = [0.05, 0.1, 0.2, 0.35, 0.6, 1, 1.5, 2.5, 4, 6, 9, 14, 20, 30, 45, 60];
      const opt = Ns.map(N => optimalController(Object.assign({}, p, { vmode: 'const', N })));
      oPlot.line('cs', Ns, opt.map(o => Math.max(C_OUT - 60, o.Cstar)), { color: 'magenta', width: 2.6, label: 'Optimal set-point C* (light-weighted mean)' });
      oPlot.scatter('csp', Ns, opt.map(o => Math.max(C_OUT - 60, o.Cstar)), { color: 'magenta', r: 3 });
      oPlot.line('cm', Ns, opt.map(o => o.meanC), { color: 'ink', width: 1.6, dash: [2, 3], label: 'Concentration achieved' });
      oPlot.line('mg', Ns, opt.map(o => eha(o.margin)), { color: 'accent', width: 2, y2: true, dash: [6, 3], label: 'Margin (right axis)' });
      oPlot.hline('out', C_OUT, { color: 'water', label: 'outdoor air' });
      const noEnr = Ns.filter((N, i) => opt[i].inj * 10 < 5);
      if (noEnr.length) { oPlot.region('noenr', noEnr[0], 60, { color: 'danger', alpha: 0.08 }); oPlot.text('noenrT', Math.sqrt(noEnr[0] * 60), 900, 'no dosing pays', { color: 'danger', align: 'center' }); } else { oPlot.remove('noenr'); oPlot.remove('noenrT'); }
    }
    oPlot.vline('now', Math.max(0.05, meanN(E.dose.series)), { color: 'amber', label: 'your mean N' });
  }, 120);
}
function exportCSV() {
  if (!E) return;
  const S = E.dose.series, S0 = E.none.series;
  downloadCSV('co2-balance-day.csv', ['time_h', 'PPFD_umol_m2_s', 'air_exchange_per_h', 'CO2_dosed_ppm', 'CO2_no_dosing_ppm', 'supply_kg_ha_h', 'uptake_kg_ha_h', 'vent_loss_kg_ha_h'],
    S.t.map((t, i) => [+t.toFixed(3), +S.I[i].toFixed(1), +S.N[i].toFixed(3), +S.C[i].toFixed(1), +S0.C[i].toFixed(1), +ha(S.inj[i]).toFixed(2), +ha(S.up[i]).toFixed(2), +ha(S.vent[i]).toFixed(2)]));
}

/* ------------------------------------------------------------------ stage */
const stageEl = document.getElementById('stage');
const cv = document.createElement('canvas'); stageEl.appendChild(cv);
const ctx = cv.getContext('2d');
const hud = hudChips(stageEl); hud.el.style.flexDirection = 'row'; hud.el.style.flexWrap = 'wrap'; hud.el.style.maxWidth = '74%';
const legend = document.createElement('div'); legend.className = 'stage-legend'; stageEl.appendChild(legend);
legend.innerHTML = [['#e9eef0', 'CO₂ molecule'], ['#f07ad0', 'dosed CO₂'], ['#6fd39a', 'taken up by leaves'], ['#5cc8ef', 'leaving through vents']]
  .map(([c, l]) => `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:10px"><i style="width:8px;height:8px;border-radius:50%;background:${c};display:inline-block"></i>${l}</span>`).join('');
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'co2-balance.png'; a.click(); } });
let W = 0, H = 0, DPR = 1, stageDirty = true, stageVisible = true;
function resize() { DPR = Math.min(2, devicePixelRatio || 1); W = stageEl.clientWidth; H = stageEl.clientHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
new ResizeObserver(resize).observe(stageEl); resize();
new IntersectionObserver(es => { stageVisible = es[0].isIntersecting; }).observe(stageEl);
const X = f => f * W, Y = f => f * H;
const FONT = (s, w = 600) => `${w} ${s}px Inter, system-ui, sans-serif`;
const MONO = (s, w = 500) => `${w} ${s}px 'JetBrains Mono', ui-monospace, monospace`;
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function tag(txt, x, y, color = '#e6eee9', align = 'left', size = 11) {
  ctx.font = FONT(size); const w = ctx.measureText(txt).width; const bx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.fillStyle = 'rgba(8,14,12,0.74)'; rr(bx - 5, y - size, w + 10, size + 8, 5); ctx.fill(); ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillText(txt, bx, y + 2);
}
const rnd = (a, b) => a + Math.random() * (b - a);
const GH = { x0: 0.08, x1: 0.8, gut: 0.44, ridge: 0.31, floor: 0.86, spans: 4 };
const ROOM = { x0: 0.12, x1: 0.78, y0: 0.2, y1: 0.86 };
let mols = [], outs = [], flashes = [], acc = { inj: 0, up: 0, out: 0, in: 0 };
const STARS = Array.from({ length: 40 }, (_, i) => [((i * 0.6180339) % 1), 0.02 + ((i * 0.3819661 * 7) % 1) * 0.2, 0.5 + (i % 3) * 0.35]);

function interior(p) {
  if (p.fac === 'room') return { x0: X(ROOM.x0) + 8, x1: X(ROOM.x1) - 8, y0: Y(ROOM.y0) + 8, y1: Y(ROOM.y1) - 6 };
  return { x0: X(GH.x0) + 4, x1: X(GH.x1) - 4, y0: Y(GH.ridge) + 6, y1: Y(GH.floor) - 6 };
}
function inside(p, x, y) {
  const I = interior(p); if (x < I.x0 || x > I.x1 || y > I.y1) return false;
  if (p.fac === 'room') return y > I.y0;
  const sw = (X(GH.x1) - X(GH.x0)) / (GH.spans * 2); const i = (x - X(GH.x0)) / sw; const f = i - Math.floor(i);
  const roofY = Math.floor(i) % 2 === 0 ? Y(GH.gut) - (Y(GH.gut) - Y(GH.ridge)) * f : Y(GH.ridge) + (Y(GH.gut) - Y(GH.ridge)) * f;
  return y > roofY + 4;
}
function sample(S, t, key) { const n = S.t.length; const x = t / 24 * (n - 1); const i = Math.min(n - 2, Math.floor(x)); const f = x - i; const a = S[key][i], b = S[key][i + 1]; return a == null || b == null ? (a ?? b) : a + (b - a) * f; }

function drawStage(tSim, dtReal) {
  if (!E || !W) return;
  const p = P, S = E.dose.series;
  const t = (tSim / 3600) % 24;
  const C = sample(S, t, 'C'), inj = sample(S, t, 'inj'), up = sample(S, t, 'up'), vent = sample(S, t, 'vent'), I = sample(S, t, 'I'), N = sample(S, t, 'N');
  const dr = drivers(p, t);
  const room = p.fac === 'room';
  const el = room ? 0 : solarElevation(p.lat, MID_DOY[p.month], t);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
  // sky
  const dayMix = room ? 0.15 : Math.max(0, Math.min(1, (el + 0.08) / 0.35)) * (0.55 + 0.45 * p.clear);
  const g = ctx.createLinearGradient(0, 0, 0, Y(GH.floor));
  g.addColorStop(0, `rgb(${Math.round(8 + 45 * dayMix)},${Math.round(14 + 85 * dayMix)},${Math.round(28 + 130 * dayMix)})`);
  g.addColorStop(1, `rgb(${Math.round(14 + 90 * dayMix)},${Math.round(22 + 100 * dayMix)},${Math.round(30 + 105 * dayMix)})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, Y(GH.floor));
  if (dayMix < 0.5) { ctx.fillStyle = `rgba(230,240,255,${0.7 * (1 - dayMix / 0.5)})`; STARS.forEach(([a, b, r]) => { ctx.beginPath(); ctx.arc(X(a), Y(b), r, 0, 7); ctx.fill(); }); }
  if (!room) {
    const az = (t - 12) / 12, sx = X(0.46 + 0.42 * az), sy = Y(0.27 - 0.13 * Math.max(0, Math.sin(Math.max(0, el))));
    if (el > -0.03) { const sg = ctx.createRadialGradient(sx, sy, 2, sx, sy, 32); sg.addColorStop(0, 'rgba(255,236,170,0.95)'); sg.addColorStop(1, 'rgba(255,200,90,0)'); ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, 32, 0, 7); ctx.fill(); ctx.fillStyle = '#ffe9a6'; ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 7); ctx.fill(); }
    // clouds when the sky is not clear
    const nc = Math.round((1 - p.clear) * 7);
    for (let i = 0; i < nc; i++) { const cx = X(((i * 0.37 + tSim / 400000) % 1.2) - 0.1), cy = Y(0.08 + (i % 3) * 0.05); ctx.fillStyle = `rgba(${200 + 40 * dayMix},${205 + 40 * dayMix},${215 + 30 * dayMix},${0.18 + 0.25 * (1 - p.clear)})`; [[0, 0, 26], [22, 4, 20], [-20, 5, 18], [8, -8, 18]].forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(cx + dx, cy + dy, r, 0, 7); ctx.fill(); }); }
  }
  // ground
  ctx.fillStyle = '#1b241f'; ctx.fillRect(0, Y(GH.floor), W, H - Y(GH.floor)); ctx.fillStyle = '#26332c'; ctx.fillRect(0, Y(GH.floor), W, 3);
  /* ---------- building ---------- */
  const vOpen = room ? 0 : Math.min(1, Math.max(0, (N - p.Nmin) / Math.max(0.1, 40 - p.Nmin)) * 1.6 + (N > p.Nmin + 0.05 ? 0.08 : 0));
  const Iin = interior(p);
  if (room) {
    const x0 = X(ROOM.x0), x1 = X(ROOM.x1), y0 = Y(ROOM.y0), y1 = Y(ROOM.y1), wt = 9;
    ctx.fillStyle = '#0f1a16'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.fillStyle = 'rgba(201,207,199,0.2)'; ctx.fillRect(x0 - wt, y0 - wt, x1 - x0 + 2 * wt, wt); ctx.fillRect(x0 - wt, y0, wt, y1 - y0); ctx.fillRect(x1, y0, wt, y1 - y0);
    ctx.strokeStyle = '#7b8c83'; ctx.lineWidth = 1.2; ctx.strokeRect(x0 - wt, y0 - wt, x1 - x0 + 2 * wt, y1 - y0 + wt); ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    // tiers with LEDs
    const nt = p.tiers, pitch = (y1 - y0 - 30) / nt;
    for (let i = 0; i < nt; i++) {
      const yb = y1 - 6 - i * pitch, yl = yb - pitch * 0.82;
      ctx.fillStyle = 'rgba(215,220,214,0.45)'; ctx.fillRect(x0 + 40, yb - 3, x1 - x0 - 80, 3);
      const on = dr.lamps;
      if (on) { const lg = ctx.createLinearGradient(0, yl, 0, yb); lg.addColorStop(0, 'rgba(255,120,220,0.35)'); lg.addColorStop(1, 'rgba(255,120,220,0.03)'); ctx.fillStyle = lg; ctx.fillRect(x0 + 42, yl, x1 - x0 - 84, yb - yl); }
      ctx.fillStyle = on ? '#ffd6f3' : '#3a443f'; ctx.fillRect(x0 + 44, yl - 2, x1 - x0 - 88, 3);
      drawLettuceRow(x0 + 46, x1 - 46, yb - 3, Math.min(11, pitch * 0.3));
    }
    // leak gap
    ctx.fillStyle = '#0b120f'; ctx.fillRect(x0 - wt - 1, y0 + (y1 - y0) * 0.35, wt + 2, 7);
  } else {
    const x0 = X(GH.x0), x1 = X(GH.x1), yg = Y(GH.gut), yr = Y(GH.ridge), yf = Y(GH.floor);
    const n2 = GH.spans * 2, sw = (x1 - x0) / n2;
    // glass
    ctx.fillStyle = 'rgba(160,210,230,0.07)'; ctx.beginPath(); ctx.moveTo(x0, yf); ctx.lineTo(x0, yg);
    for (let i = 0; i < n2; i++) ctx.lineTo(x0 + (i + 1) * sw, i % 2 === 0 ? yr : yg);
    ctx.lineTo(x1, yf); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(200,225,235,0.55)'; ctx.lineWidth = 1.4; ctx.stroke();
    // structure posts
    ctx.strokeStyle = 'rgba(200,215,210,0.35)'; ctx.lineWidth = 1; for (let i = 0; i <= GH.spans; i++) { const x = x0 + i * 2 * sw; ctx.beginPath(); ctx.moveTo(x, yg); ctx.lineTo(x, yf); ctx.stroke(); }
    // vents (one per ridge, hinged at the ridge, opening on the right-hand slope)
    for (let i = 0; i < GH.spans; i++) {
      const rx = x0 + (2 * i + 1) * sw, ry = yr; const len = sw * 0.62; const base = Math.atan2(yg - yr, sw); const ang = base - vOpen * 0.75;
      ctx.strokeStyle = 'rgba(230,240,245,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + Math.cos(ang) * len, ry + Math.sin(ang) * len); ctx.stroke();
    }
    // lamps
    if (dr.lamps) { for (let i = 0; i < 8; i++) { const lx = x0 + (i + 0.5) * (x1 - x0) / 8, ly = yg + 10; const lg = ctx.createRadialGradient(lx, ly, 1, lx, ly, 60); lg.addColorStop(0, 'rgba(255,190,120,0.45)'); lg.addColorStop(1, 'rgba(255,190,120,0)'); ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, ly, 60, 0, 7); ctx.fill(); ctx.fillStyle = '#ffd9a0'; ctx.fillRect(lx - 7, ly - 2, 14, 4); } }
    // crop rows on gutters
    for (let r = 0; r < 2; r++) { const y = yf - 8 - r * 40; ctx.fillStyle = 'rgba(215,220,214,0.35)'; ctx.fillRect(x0 + 10, y, x1 - x0 - 20, 3); drawLettuceRow(x0 + 14, x1 - 14, y, 9); }
    // perforated dosing tubes
    ctx.strokeStyle = 'rgba(240,122,208,0.55)'; ctx.lineWidth = 2; ctx.setLineDash([2, 5]);
    [yf - 3, yf - 43].forEach(y => { ctx.beginPath(); ctx.moveTo(x0 + 10, y); ctx.lineTo(x1 - 10, y); ctx.stroke(); }); ctx.setLineDash([]);
  }
  // CO₂ tank and line
  const tx0 = X(0.86), tx1 = X(0.935), ty0 = Y(0.5), ty1 = Y(GH.floor);
  const tg = ctx.createLinearGradient(tx0, 0, tx1, 0); tg.addColorStop(0, '#56625c'); tg.addColorStop(0.5, '#dfe6e2'); tg.addColorStop(1, '#4a554f');
  rr(tx0, ty0, tx1 - tx0, ty1 - ty0, (tx1 - tx0) / 2); ctx.fillStyle = tg; ctx.fill();
  ctx.fillStyle = '#10201a'; ctx.font = FONT(10, 700); ctx.textAlign = 'center'; ctx.fillText('CO₂', (tx0 + tx1) / 2, ty0 + 22);
  const pipeY = room ? Y(0.8) : Y(GH.floor) - 3;
  ctx.strokeStyle = inj > 0.01 ? 'rgba(240,122,208,0.9)' : 'rgba(150,160,155,0.6)'; ctx.lineWidth = 3; ctx.setLineDash(inj > 0.01 ? [6, 5] : []); ctx.lineDashOffset = -tSim / 300;
  ctx.beginPath(); ctx.moveTo((tx0 + tx1) / 2, ty0 + 30); ctx.lineTo((tx0 + tx1) / 2, pipeY); ctx.lineTo(Iin.x1 - 6, pipeY); ctx.stroke(); ctx.setLineDash([]);
  // NDIR sensor
  const sx = Iin.x0 + 16, sy = room ? Y(0.3) : Y(0.52);
  rr(sx, sy, 86, 38, 6); ctx.fillStyle = '#0a1310'; ctx.fill(); ctx.strokeStyle = '#6f8479'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#9be7b6'; ctx.font = MONO(15, 600); ctx.textAlign = 'center'; ctx.fillText(fmt(C, 0), sx + 43, sy + 21);
  ctx.fillStyle = '#9fb2a8'; ctx.font = MONO(8.5); ctx.fillText('ppm CO₂ (NDIR)', sx + 43, sy + 33);
  /* ---------- molecules ---------- */
  const dt = Math.min(0.05, dtReal);
  const area = (Iin.x1 - Iin.x0) * (Iin.y1 - Iin.y0);
  const target = Math.round(C / 1000 * area / 380);            // number of dots ∝ concentration
  const outTarget = Math.round(C_OUT / 1000 * W * Y(0.3) / 900);
  // sources and sinks animated at rates ∝ model fluxes
  const refFlux = 30;                                            // g m⁻² h⁻¹ ↔ ≈ 30 dots s⁻¹
  acc.inj += inj / refFlux * 30 * dt; acc.up += up / refFlux * 30 * dt;
  acc.out += Math.max(0, vent) / refFlux * 30 * dt; acc.in += Math.max(0, -vent) / refFlux * 30 * dt;
  while (acc.inj >= 1) { acc.inj--; const y = room ? pipeY : (Math.random() < 0.5 ? Y(GH.floor) - 3 : Y(GH.floor) - 43); mols.push({ x: rnd(Iin.x0 + 12, Iin.x1 - 12), y, vx: rnd(-10, 10), vy: rnd(-40, -15), dosed: 1 }); }
  while (acc.up >= 1) { acc.up--; const cands = mols.filter(m => m.y > Iin.y1 - (room ? (Iin.y1 - Iin.y0) : 70)); if (cands.length) { const m = cands[Math.floor(Math.random() * cands.length)]; m.dead = true; flashes.push({ x: m.x, y: m.y, life: 1 }); } }
  while (acc.out >= 1) { acc.out--; if (mols.length) { let best = null; for (let k = 0; k < 6; k++) { const m = mols[Math.floor(Math.random() * mols.length)]; if (!best || m.y < best.y) best = m; } best.dead = true;
      if (room) outs.push({ x: X(ROOM.x0) - 4, y: Y(ROOM.y0) + (Y(ROOM.y1) - Y(ROOM.y0)) * 0.37 + 3, vx: -rnd(20, 40), vy: rnd(-5, 5), life: 1.4 });
      else { const sw = (X(GH.x1) - X(GH.x0)) / (GH.spans * 2), i = Math.floor(Math.random() * GH.spans); const vx0 = X(GH.x0) + (2 * i + 1) * sw + sw * rnd(0.1, 0.5); outs.push({ x: vx0, y: Y(GH.ridge) + rnd(4, 14), vx: rnd(5, 25), vy: -rnd(30, 55), life: 1.4 }); } } }
  // keep the number of molecules equal to the model's concentration
  mols = mols.filter(m => !m.dead);
  while (mols.length < target) { let x, y, k = 0; do { x = rnd(Iin.x0, Iin.x1); y = rnd(Iin.y0, Iin.y1); k++; } while (!inside(p, x, y) && k < 20); mols.push({ x, y, vx: rnd(-20, 20), vy: rnd(-20, 20), dosed: 0 }); }
  while (mols.length > target) mols.splice(Math.floor(Math.random() * mols.length), 1);
  for (const m of mols) {
    m.vx += rnd(-60, 60) * dt; m.vy += rnd(-60, 60) * dt; m.vx *= 0.98; m.vy *= 0.98;
    const nx = m.x + m.vx * dt, ny = m.y + m.vy * dt;
    if (inside(p, nx, ny)) { m.x = nx; m.y = ny; } else { m.vx *= -0.8; m.vy *= -0.8; }
    if (m.dosed > 0) m.dosed -= dt * 0.35;
    ctx.fillStyle = m.dosed > 0 ? `rgba(240,122,208,${0.5 + 0.5 * m.dosed})` : 'rgba(233,238,240,0.62)';
    ctx.beginPath(); ctx.arc(m.x, m.y, m.dosed > 0 ? 2.2 : 1.8, 0, 7); ctx.fill();
  }
  // outdoor molecules (constant density above the roof)
  if (!room) {
    ctx.fillStyle = 'rgba(233,238,240,0.35)';
    for (let i = 0; i < outTarget; i++) { const a = (i * 0.618034 + tSim / 9e5 * (1 + i % 3)) % 1, b = (i * 0.414214) % 1; const x = X(a), y = Y(0.06 + b * 0.2); ctx.beginPath(); ctx.arc(x, y, 1.5, 0, 7); ctx.fill(); }
  }
  outs = outs.filter(o => { o.x += o.vx * dt; o.y += o.vy * dt; o.life -= dt * 0.6; if (o.life > 0) { ctx.fillStyle = `rgba(92,200,239,${Math.min(1, o.life)})`; ctx.beginPath(); ctx.arc(o.x, o.y, 2, 0, 7); ctx.fill(); } return o.life > 0; });
  flashes = flashes.filter(f => { f.life -= dt * 2; if (f.life > 0) { ctx.strokeStyle = `rgba(111,211,154,${f.life})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(f.x, f.y, 2 + 6 * (1 - f.life), 0, 7); ctx.stroke(); } return f.life > 0; });
  /* ---------- labels ---------- */
  const kgh = x => fmt(ha(x), 0) + ' kg ha⁻¹ h⁻¹';
  tag(`dosing ${kgh(inj)}`, (tx0 + tx1) / 2, ty0 - 12, '#f7a8e2', 'center', 10.5);
  tag(`uptake ${kgh(up)}`, Iin.x0 + 110, Iin.y1 - (room ? 30 : 60), '#9ae6b4', 'left', 10.5);
  if (!room) tag(vent >= 0 ? `vents lose ${kgh(vent)}` : `vents bring in ${kgh(-vent)}`, X((GH.x0 + GH.x1) / 2), Y(GH.ridge) - 16, '#8fdcff', 'center', 10.5);
  else tag(`leakage ${kgh(Math.max(0, vent))}`, X(ROOM.x0), Y(ROOM.y0) - 16, '#8fdcff', 'left', 10.5);
  hud.set('t', `${MONTHS[p.month].slice(0, 3)} <b>${String(Math.floor(t)).padStart(2, '0')}:${String(Math.floor((t % 1) * 60)).padStart(2, '0')}</b>`);
  hud.set('c', `CO₂ <b>${fmt(C, 0)}</b> µmol mol⁻¹`);
  hud.set('n', `air exchange <b>${fmt(N, N < 1 ? 2 : 1)}</b> h⁻¹ · PPFD <b>${fmt(I, 0)}</b>`);
  // time cursor on the charts (4 × per second)
  if (tSim - lastCursor > 900 || tSim < lastCursor) { lastCursor = tSim; cPlot.vline('tnow', t, { color: 'ink', dash: [2, 3] }); fPlot.vline('tnow', t, { color: 'ink', dash: [2, 3] }); }
}
let lastCursor = -1e9;
function drawLettuceRow(xa, xb, y, r) {
  const n = Math.max(4, Math.floor((xb - xa) / (r * 2.4)));
  for (let j = 0; j < n; j++) {
    const cx = xa + (j + 0.5) * (xb - xa) / n;
    ctx.fillStyle = '#2f8a55'; ctx.beginPath(); ctx.ellipse(cx, y, r, r * 0.8, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#6fd39a'; ctx.beginPath(); ctx.ellipse(cx - r * 0.15, y - r * 0.12, r * 0.72, r * 0.58, 0, Math.PI, 0); ctx.fill();
  }
}

const clock = new SimClock({ speed: 3600, onFrame: t => { const now = performance.now(); const dtr = Math.min(0.1, (now - (clock._lr || now)) / 1000); clock._lr = now; if (stageVisible) drawStage(t, dtr); } });
clock.onState(run => { playBtns[0].innerHTML = run ? '❚❚ Pause' : '▶ Play'; });
clock.reset(7 * 3600);

let raf = 0;
ui.onChange((st, id) => { if (id === 'speed') { clock.speed = +st.speed; return; } cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
update();
clock.play();
