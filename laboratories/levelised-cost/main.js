/* ==========================================================================
   Levelised cost of food — UI, animated cost-flow stage, waterfall, tornado,
   cash-flow timeline, Monte Carlo distribution and scenario comparison.
   The model is in ./model.js (Eqs. LC1–LC8 in the Derive tab).
   ========================================================================== */
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, BarChart, downloadCSV } from '/assets/js/plot.js';
import { palette, withAlpha, isDark } from '/assets/js/colors.js';
import { SYSTEMS, SYSTEM_KEYS, CAPEX, PARTS, defaults, evaluate, tornado, monteCarlo, swedishWage, crf } from './model.js';

/* ------------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'lcof', label: 'Levelised cost of food', unit: '€ kg⁻¹', digits: 2, note: '&nbsp;' })
  .add({ id: 'price', label: 'Selling price', unit: '€ kg⁻¹', digits: 2, note: '&nbsp;' })
  .add({ id: 'npv', label: 'Net present value', unit: '€ m⁻²', digits: 0, note: '&nbsp;' })
  .add({ id: 'irr', label: 'Internal rate of return', unit: '%', digits: 1, note: '&nbsp;' })
  .add({ id: 'pay', label: 'Payback time', unit: 'yr', digits: 1, note: '&nbsp;' })
  .add({ id: 'capex', label: 'Initial investment', unit: '€ m⁻²', digits: 0, note: '&nbsp;' })
  .add({ id: 'top', label: 'Largest cost item', unit: '', digits: 0, format: v => v, note: '&nbsp;' })
  .add({ id: 'wage', label: 'Labour cost per hour', unit: '€ h⁻¹', digits: 2, note: '&nbsp;' })
  .add({ id: 'mc', label: 'Monte Carlo LCOF (P10 – P90)', unit: '€ kg⁻¹', digits: 2, format: v => v, note: '&nbsp;' })
  .add({ id: 'sold', label: 'Marketable output', unit: 'kg m⁻² yr⁻¹', digits: 1, note: '&nbsp;' });

const SYS_IDS = ['capS', 'lifeS', 'capG', 'lifeG', 'capL', 'lifeL', 'capC', 'lifeC', 'capA', 'lifeA', 'maint', 'yield', 'ramp1', 'ramp2', 'loss', 'price', 'elec', 'heat', 'labour', 'seeds', 'nutr', 'prot', 'pack', 'water', 'waterPrice', 'other'];
const store = Object.fromEntries(SYSTEM_KEYS.map(k => [k, defaults(k)]));

ui.section('Production system');
ui.segmented({ id: 'sys', label: 'System', options: [{ value: 'vf', label: 'Vertical farm' }, { value: 'gh', label: 'Heated greenhouse' }, { value: 'field', label: 'Open field' }], value: 'vf', help: 'Each system keeps its own settings; the comparison chart shows all three' });
ui.section('Capital per m² of growing area');
const capHelp = { S: 'Building shell, insulation, glazing, sheds', G: 'Racks, gutters, rafts, NFT channels, benches', L: 'LED fixtures (vertical farm) or supplementary lamps', C: 'HVAC and dehumidification, or heating and screens', A: 'Automation, IT, tractors and irrigation equipment' };
CAPEX.forEach(it => {
  ui.slider({ id: 'cap' + it.key, label: it.label, min: 0, max: 1500, step: 0.01, value: store.vf['cap' + it.key], unit: '€ m⁻²', digits: 2, help: capHelp[it.key] });
  ui.slider({ id: 'life' + it.key, label: '… lifetime', min: 3, max: 40, step: 1, value: store.vf['life' + it.key], unit: 'yr' });
});
ui.slider({ id: 'maint', label: 'Maintenance and repairs', min: 0, max: 5, step: 0.1, value: store.vf.maint, unit: '% of capital yr⁻¹' });
ui.section('Production and market');
ui.slider({ id: 'yield', label: 'Yield at full production', min: 1, max: 160, step: 0.01, value: store.vf.yield, unit: 'kg m⁻² yr⁻¹', digits: 2 });
ui.slider({ id: 'ramp1', label: 'Year-1 output (ramp-up)', min: 20, max: 100, step: 1, value: store.vf.ramp1, unit: '% of full' });
ui.slider({ id: 'ramp2', label: 'Year-2 output', min: 20, max: 100, step: 1, value: store.vf.ramp2, unit: '% of full' });
ui.slider({ id: 'loss', label: 'Unsold or wasted harvest', min: 0, max: 40, step: 0.5, value: store.vf.loss, unit: '%' });
ui.slider({ id: 'price', label: 'Selling price', min: 0.3, max: 20, step: 0.01, value: store.vf.price, unit: '€ kg⁻¹' });
ui.section('Operating inputs (per kg at full production)');
ui.slider({ id: 'elec', label: 'Electricity use', min: 0, max: 30, step: 0.1, value: store.vf.elec, unit: 'kWh kg⁻¹' });
ui.slider({ id: 'heat', label: 'Heat use', min: 0, max: 30, step: 0.1, value: store.vf.heat, unit: 'kWh kg⁻¹' });
ui.slider({ id: 'labour', label: 'Labour', min: 0.001, max: 0.4, step: 0.001, value: store.vf.labour, unit: 'h kg⁻¹', log: true, digits: 3, help: '≈ 1.5–2 min per head in manual farms (Kozai, 2013; Kaiser & Ernst, 2016) ≈ 0.17–0.2 h kg⁻¹' });
ui.slider({ id: 'seeds', label: 'Seeds and young plants', min: 0, max: 1.5, step: 0.001, value: store.vf.seeds, unit: '€ kg⁻¹', digits: 3 });
ui.slider({ id: 'nutr', label: 'Nutrients, fertiliser, substrate', min: 0, max: 1, step: 0.001, value: store.vf.nutr, unit: '€ kg⁻¹', digits: 3 });
ui.slider({ id: 'prot', label: 'Crop protection', min: 0, max: 0.3, step: 0.001, value: store.vf.prot, unit: '€ kg⁻¹', digits: 3 });
ui.slider({ id: 'pack', label: 'Packaging, harvest, logistics', min: 0, max: 3, step: 0.001, value: store.vf.pack, unit: '€ kg⁻¹', digits: 3 });
ui.slider({ id: 'water', label: 'Water use', min: 0, max: 150, step: 0.5, value: store.vf.water, unit: 'L kg⁻¹' });
ui.slider({ id: 'waterPrice', label: 'Water price', min: 0, max: 6, step: 0.01, value: store.vf.waterPrice, unit: '€ m⁻³' });
ui.slider({ id: 'other', label: 'Other fixed costs (land, insurance, admin)', min: 0, max: 50, step: 0.005, value: store.vf.other, unit: '€ m⁻² yr⁻¹', digits: 3 });
ui.section('Shared economic context');
ui.slider({ id: 'r', label: 'Real discount rate', min: 0, max: 20, step: 0.25, value: 5, unit: '% yr⁻¹', help: 'Public investor 3–4 % · Zhuang et al. 5 % · venture capital 12 % or more' });
ui.slider({ id: 'n', label: 'Project lifetime', min: 5, max: 30, step: 1, value: 15, unit: 'yr' });
ui.toggle({ id: 'residual', label: 'Count the residual value of assets at the end', value: true });
ui.slider({ id: 'elPrice', label: 'Electricity price', min: 0.02, max: 0.5, step: 0.005, value: 0.10, unit: '€ kWh⁻¹' });
ui.slider({ id: 'heatPrice', label: 'Heat price', min: 0.01, max: 0.2, step: 0.005, value: 0.06, unit: '€ kWh⁻¹' });
ui.segmented({ id: 'wageMode', label: 'Wage', options: [{ value: 'se', label: 'Swedish (SCB 2024)' }, { value: 'custom', label: 'Custom' }], value: 'se' });
ui.slider({ id: 'wage', label: 'Custom labour cost', min: 5, max: 60, step: 0.1, value: 23, unit: '€ h⁻¹' });
ui.slider({ id: 'salary', label: 'Monthly salary', min: 20000, max: 45000, step: 100, value: 30200, unit: 'SEK', format: v => fmt(v, 0), help: 'Mean for trädgårdsodlare (SSYK 6113) in 2024: 30 200 SEK (Statistics Sweden)' });
ui.slider({ id: 'contrib', label: 'Employer social contributions', min: 0, max: 40, step: 0.01, value: 31.42, unit: '%', help: 'Arbetsgivaravgifter 31.42 % (Skatteverket)' });
ui.slider({ id: 'otherLab', label: 'Pension, insurance and other', min: 0, max: 20, step: 0.5, value: 7, unit: '%' });
ui.slider({ id: 'hours', label: 'Hours worked per year', min: 1400, max: 2100, step: 10, value: 1760, unit: 'h', format: v => fmt(v, 0) });
ui.slider({ id: 'fx', label: 'Exchange rate', min: 9, max: 13, step: 0.05, value: 11, unit: 'SEK €⁻¹' });
ui.section('Presets');
const PRESETS = [
  { label: 'Vertical farm — Zhuang et al.', sys: 'vf', sysVals: defaults('vf'), ctx: { wageMode: 'custom', wage: 23.05, elPrice: 0.114, r: 5, n: 15, residual: true } },
  { label: 'Lesson 15.3 check', sys: 'vf', sysVals: Object.assign(defaults('vf'), { capS: 1425, lifeS: 15, capG: 0, capL: 0, capC: 0, capA: 0, maint: 1.5, yield: 115, ramp1: 100, ramp2: 100, loss: 0, elec: 12, heat: 0, labour: 0.1, seeds: 0.4, nutr: 0.3104, prot: 0, pack: 1.297, water: 0, other: 11.4, price: 10.45 }), ctx: { wageMode: 'custom', wage: 23.05, elPrice: 0.114, r: 5, n: 15, residual: false } },
  { label: 'Swedish vertical farm', sys: 'vf', sysVals: defaults('vf'), ctx: { wageMode: 'se', elPrice: 0.10, r: 5, n: 15, residual: true } },
  { label: 'Nordic greenhouse', sys: 'gh', sysVals: defaults('gh'), ctx: { wageMode: 'se', elPrice: 0.10, heatPrice: 0.06, r: 5, n: 15, residual: true } },
  { label: 'California field (UC 2023)', sys: 'field', sysVals: defaults('field'), ctx: { wageMode: 'custom', wage: 23.9, r: 8.5, n: 15, residual: true } },
  { label: 'Energy crisis (€0.30 kWh⁻¹)', ctx: { elPrice: 0.30, heatPrice: 0.12 } },
  { label: 'Venture capital (12 %)', ctx: { r: 12 } },
  { label: 'Automated (half the labour)', sysScale: { labour: 0.5 } }
];
{
  const wrap = document.createElement('div'); wrap.className = 'presets';
  PRESETS.forEach(pr => { const b = document.createElement('button'); b.type = 'button'; b.textContent = pr.label; b.addEventListener('click', () => applyPreset(pr)); wrap.appendChild(b); });
  document.getElementById('controls').appendChild(wrap);
}
ui.buttons([{ label: 'Re-run Monte Carlo', onClick: () => { mcSeed++; runMC(); } }, { label: 'CSV (cash flows)', onClick: () => exportCSV() }]);
ui.saveButton('levelised-cost', () => ro.values());

let curSys = ui.get('sys');
let applying = false;
{ // parameters present in the URL belong to the current system; the others take that system's literature defaults
  const urlP = new URLSearchParams(location.search);
  store[curSys] = Object.fromEntries(SYS_IDS.map(id => [id, urlP.has(id) ? ui.get(id) : store[curSys][id]]));
  applying = true; ui.setMany(store[curSys]); applying = false;
}
function applyPreset(pr) {
  applying = true;
  if (pr.sys) { store[pr.sys] = Object.assign({}, pr.sysVals); curSys = pr.sys; ui.setMany(Object.assign({ sys: pr.sys }, store[pr.sys])); }
  if (pr.sysScale) { const vals = {}; for (const k in pr.sysScale) vals[k] = ui.get(k) * pr.sysScale[k]; ui.setMany(vals); Object.assign(store[curSys], vals); }
  if (pr.ctx) ui.setMany(pr.ctx);
  applying = false;
  window.FFP && FFP.toast && FFP.toast('Preset: ' + pr.label);
  schedule();
}
function context(v) {
  const wage = v.wageMode === 'se' ? swedishWage({ salary: v.salary, contrib: v.contrib, otherLab: v.otherLab, hours: v.hours, fx: v.fx }) : v.wage;
  return { r: v.r, n: v.n, elPrice: v.elPrice, heatPrice: v.heatPrice, wage, residual: v.residual };
}
function syncEnabled(v) { ['salary', 'contrib', 'otherLab', 'hours', 'fx'].forEach(id => ui.show(id, v.wageMode === 'se')); ui.show('wage', v.wageMode === 'custom'); }

/* ------------------------------------------------------------------ charts */
const tor = new BarChart('#chart-tornado', { y: { label: 'Change in LCOF from the base case', unit: '€ kg⁻¹', min: 'auto' }, horizontal: true, stacked: true, height: 330 });
const cash = new Plot('#chart-cash', { x: { label: 'Year', unit: '', min: -0.5 }, y: { label: 'Cash flow per m²', unit: '€ m⁻²' }, height: 300 });
const mcPlot = new Plot('#chart-mc', { x: { label: 'Levelised cost of food', unit: '€ kg⁻¹' }, y: { label: 'Share of draws', unit: '%', min: 0 }, height: 300 });
const cmp = new BarChart('#chart-compare', { y: { label: 'Levelised cost', unit: '€ kg⁻¹', min: 0 }, stacked: true, height: 330 });
const wfHost = document.getElementById('chart-waterfall');
const wfCv = document.createElement('canvas'); wfCv.style.cssText = 'width:100%;height:330px;display:block'; wfHost.appendChild(wfCv);
const wfTip = document.createElement('div'); wfTip.className = 'plot-tip'; wfHost.style.position = 'relative'; wfHost.appendChild(wfTip);
new ResizeObserver(() => drawWaterfall()).observe(wfHost);
document.addEventListener('ffp:theme', () => { drawWaterfall(); });

let V = null, S = null, C = null, E = null, MC = null, mcSeed = 12345, wfBars = [];
function drawWaterfall() {
  if (!E) return;
  const w = wfHost.clientWidth, h = 330, d = Math.min(2, devicePixelRatio || 1);
  if (w < 240) return;
  wfCv.width = Math.round(w * d); wfCv.height = Math.round(h * d);
  const ctx = wfCv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h);
  const P = palette();
  const items = PARTS.filter(p => Math.abs(E.perKg[p.key]) > 0.0005).map(p => ({ key: p.key, label: p.label, v: E.perKg[p.key], color: p.color }));
  const price = S.price, total = E.lcof;
  const SHORT = { capital: 'Capital', maint: 'Maintenance', elec: 'Electricity', heat: 'Heat', labour: 'Labour', seeds: 'Seeds', nutr: 'Nutrients', prot: 'Protection', pack: 'Packaging', water: 'Water', other: 'Other' };
  const cats = [...items.map(i => SHORT[i.key]), 'LCOF', 'Price'];
  const L = 54, R = 12, T = 18, B = 62, W = w - L - R, H = h - T - B;
  const ymax = Math.max(total, price) * 1.12;
  const Yp = v => T + H * (1 - v / ymax);
  const bw = W / cats.length;
  // grid
  ctx.strokeStyle = P.line; ctx.lineWidth = 1; ctx.font = "500 10.5px 'JetBrains Mono', monospace"; ctx.fillStyle = P.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const step = niceStep(ymax / 5);
  for (let v = 0; v <= ymax + 1e-9; v += step) { const y = Math.round(Yp(v)) + 0.5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + W, y); ctx.stroke(); ctx.fillText(fmt(v, step < 0.1 ? 2 : step < 1 ? 1 : 0), L - 6, y); }
  ctx.save(); ctx.translate(14, T + H / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillStyle = P.ink2 || P.ink; ctx.font = '550 12px Inter, sans-serif'; ctx.fillText('Cost per kg (€ kg⁻¹)', 0, 0); ctx.restore();
  wfBars = [];
  let acc = 0; const col = c => isDark() ? withAlpha(c, 0.95) : c;
  items.forEach((it, i) => {
    const x = L + i * bw + bw * 0.14, bwi = bw * 0.72;
    const y0 = Yp(acc), y1 = Yp(acc + it.v);
    ctx.fillStyle = col(it.color); roundRect(ctx, x, Math.min(y0, y1), bwi, Math.max(1.5, Math.abs(y1 - y0)), 3); ctx.fill();
    { ctx.strokeStyle = P.muted; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x + bwi, y1); ctx.lineTo(x + bw, y1); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = P.ink2 || P.ink; ctx.font = "500 10px 'JetBrains Mono', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    if (bwi > 26) ctx.fillText(fmt(it.v, it.v < 0.1 ? 3 : 2), x + bwi / 2, Math.min(y0, y1) - 3);
    wfBars.push({ x, y: Math.min(y0, y1), w: bwi, h: Math.abs(y1 - y0), label: it.label, v: it.v, share: it.v / total });
    acc += it.v;
  });
  // total and price bars
  const drawBar = (i, v, color, label) => { const x = L + i * bw + bw * 0.14, bwi = bw * 0.72; ctx.fillStyle = color; roundRect(ctx, x, Yp(v), bwi, T + H - Yp(v), 3); ctx.fill(); ctx.fillStyle = P.ink; ctx.font = "650 11px 'JetBrains Mono', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(fmt(v, 2), x + bwi / 2, Yp(v) - 3); wfBars.push({ x, y: Yp(v), w: bwi, h: T + H - Yp(v), label, v, share: 1 }); };
  drawBar(items.length, total, P.ink2 || P.ink, 'Levelised cost of food');
  drawBar(items.length + 1, price, price >= total ? P.accent : P.danger, 'Selling price');
  // margin bracket
  const xm = L + (items.length + 1) * bw + bw * 0.9; ctx.strokeStyle = price >= total ? P.accent : P.danger; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xm - 4, Yp(total)); ctx.lineTo(xm, Yp(total)); ctx.lineTo(xm, Yp(price)); ctx.lineTo(xm - 4, Yp(price)); ctx.stroke();
  // axis and labels
  ctx.strokeStyle = P.lineStrong || P.muted; ctx.beginPath(); ctx.moveTo(L, T + H + 0.5); ctx.lineTo(L + W, T + H + 0.5); ctx.stroke();
  ctx.fillStyle = P.ink2 || P.ink; ctx.font = '550 11px Inter, sans-serif';
  cats.forEach((c, i) => { ctx.save(); ctx.translate(L + i * bw + bw / 2, T + H + 8); ctx.rotate(-Math.PI / 7); ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(c, 4, 0); ctx.restore(); });
}
function niceStep(x) { const e = Math.pow(10, Math.floor(Math.log10(x))); const f = x / e; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e; }
function roundRect(ctx, x, y, w, h, r) { if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; } r = Math.max(0, Math.min(r, w / 2, h / 2)); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
wfCv.addEventListener('pointermove', e => {
  const r = wfCv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const b = wfBars.find(b => x >= b.x && x <= b.x + b.w && y >= b.y - 4 && y <= b.y + b.h + 4);
  if (!b) { wfTip.style.display = 'none'; return; }
  wfTip.innerHTML = `<b>${b.label}</b><br>${fmt(b.v, 3)} € kg⁻¹${b.share < 1 ? ` · ${fmt(100 * b.share, 1)} % of LCOF` : ''}`;
  wfTip.style.display = 'block'; wfTip.style.left = Math.min(x + 12, wfHost.clientWidth - 180) + 'px'; wfTip.style.top = (y - 10) + 'px';
});
wfCv.addEventListener('pointerleave', () => { wfTip.style.display = 'none'; });

function cashChart() {
  const F = E.F, yrs = F.T;
  const net = E.net;
  cash.custom('bars', (ctx, plot, P) => {
    const bw = Math.max(2, (plot.px(1) - plot.px(0)) * 0.26);
    yrs.forEach((t, i) => {
      const x = plot.px(t);
      const rev = F.rev[i], cap = F.capex[i], op = F.opex[i], dt = E.d[i];
      // undiscounted (outline) and discounted (filled)
      const bar = (v, col, off) => { if (!v) return; const y0 = plot.py(0), y1 = plot.py(v); ctx.fillStyle = withAlpha(col, 0.22); ctx.fillRect(x + off, Math.min(y0, y1), bw, Math.abs(y1 - y0)); const yd = plot.py(v * dt); ctx.fillStyle = col; ctx.fillRect(x + off + bw * 0.2, Math.min(y0, yd), bw * 0.6, Math.abs(yd - y0)); };
      bar(rev, P.accent, -1.5 * bw); bar(-op, P.amber, -0.5 * bw); if (cap) bar(-cap, P.danger, 0.5 * bw);
    });
  });
  cash.line('cum', yrs, E.cum, { color: 'ink', dash: [5, 4], width: 1.8, label: 'Cumulative cash flow' });
  cash.line('dcum', yrs, E.dcum, { color: 'magenta', width: 2.6, label: 'Cumulative discounted (NPV)' });
  cash.hline('zero', 0, { color: 'muted', dash: [1, 3] });
  if (E.dpayback != null) cash.point('pb', E.dpayback, 0, { color: 'magenta', label: `discounted payback ${fmt(E.dpayback, 1)} yr` }); else cash.remove('pb');
  const vals = [...E.cum, ...E.dcum, ...F.rev, ...F.capex.map((c, i) => -(c + F.opex[i]))];
  cash.setAxis('y', { min: Math.min(0, ...vals) * 1.08, max: Math.max(0, ...vals) * 1.08 });
  cash.setAxis('x', { min: -0.6, max: F.n + 0.6 });
}
function tornadoChart() {
  const T = tornado(V.sys, S, C).slice(0, 10);
  tor.set(T.map(t => `${t.label} (${fmtR(t.lo)}–${fmtR(t.hi)})`), [
    { label: 'Low value of the parameter', values: T.map(t => t.lcofLo - t.base), color: 'water' },
    { label: 'High value of the parameter', values: T.map(t => t.lcofHi - t.base), color: 'amber' }
  ]);
  function fmtR(v) { return Math.abs(v) >= 100 ? fmt(v, 0) : Math.abs(v) >= 10 ? fmt(v, 1) : Math.abs(v) >= 1 ? fmt(v, 2) : fmt(v, 3); }
}
function compareChart() {
  const res = SYSTEM_KEYS.map(k => ({ k, e: evaluate(store[k], C), s: store[k] }));
  cmp.set(res.map(r => `${SYSTEMS[r.k].short} (price ${fmt(r.s.price, 2)})`), PARTS.filter(p => res.some(r => r.e.perKg[p.key] > 0.0005)).map(p => ({ label: p.label, values: res.map(r => r.e.perKg[p.key]), color: p.color })));
  return res;
}
let mcT = null;
function runMC() {
  clearTimeout(mcT);
  mcT = setTimeout(() => {
    MC = monteCarlo(V.sys, S, C, 2000, mcSeed);
    const xs = MC.samples, lo = xs[0], hi = xs[xs.length - 1], nb = 34, bwid = (hi - lo) / nb || 1;
    const counts = new Array(nb).fill(0); xs.forEach(x => counts[Math.min(nb - 1, Math.floor((x - lo) / bwid))]++);
    const cx = [], cy = []; counts.forEach((c, i) => { cx.push(lo + i * bwid); cy.push(100 * c / xs.length); cx.push(lo + (i + 1) * bwid); cy.push(100 * c / xs.length); });
    mcPlot.line('hist', cx, cy, { color: 'water', width: 1.6, fill: 0.25, label: `${xs.length} draws` });
    const ym = Math.max(...cy), pc = S.price >= MC.p50 ? 'accent' : 'danger';
    mcPlot.vline('p10', MC.p10, { color: 'muted' }); mcPlot.vline('p90', MC.p90, { color: 'muted' });
    mcPlot.vline('p50', MC.p50, { color: 'ink' });
    mcPlot.vline('base', E.lcof, { color: 'magenta', dash: [2, 3] });
    mcPlot.vline('price', S.price, { color: pc });
    mcPlot.text('tp10', MC.p10, ym * 1.02, 'P10', { color: 'muted', align: 'right', dx: -4 });
    mcPlot.text('tp90', MC.p90, ym * 1.02, 'P90', { color: 'muted', align: 'left', dx: 4 });
    mcPlot.text('tp50', MC.p50, ym * 0.9, 'median', { color: 'ink', align: 'left', dx: 4 });
    mcPlot.text('tbase', E.lcof, ym * 0.78, 'base case', { color: 'magenta', align: E.lcof < MC.p50 ? 'right' : 'left', dx: E.lcof < MC.p50 ? -4 : 4 });
    mcPlot.text('tprice', S.price, ym * 0.66, 'price', { color: pc, align: S.price < MC.p50 ? 'right' : 'left', dx: S.price < MC.p50 ? -4 : 4 });
    mcPlot.setAxis('y', { min: 0, max: ym * 1.12 });
    mcPlot.setAxis('x', { min: Math.min(lo, S.price, E.lcof) * 0.96, max: Math.max(hi, S.price, E.lcof) * 1.04 });
    ro.set('mc', `${fmt(MC.p10, 2)} – ${fmt(MC.p90, 2)}`, MC.pBelow(S.price) >= 0.8 ? 'ok' : MC.pBelow(S.price) >= 0.4 ? 'warn' : 'bad', `median ${fmt(MC.p50, 2)} · P(LCOF &lt; price) = ${fmt(100 * MC.pBelow(S.price), 0)} %`);
  }, 350);
}
function exportCSV() {
  if (!E) return; const F = E.F;
  downloadCSV(`lcof-${V.sys}.csv`, ['year', 'harvest_kg_m2', 'sold_kg_m2', 'revenue_EUR_m2', 'capex_EUR_m2', 'opex_EUR_m2', ...PARTS.filter(p => p.key !== 'capital').map(p => p.key + '_EUR_m2'), 'discount_factor', 'net_EUR_m2', 'cumulative_discounted_EUR_m2'],
    F.T.map((t, i) => [t, +F.H[i].toFixed(3), +F.Q[i].toFixed(3), +F.rev[i].toFixed(2), +F.capex[i].toFixed(2), +F.opex[i].toFixed(2), ...PARTS.filter(p => p.key !== 'capital').map(p => +F.parts[i][p.key].toFixed(3)), +E.d[i].toFixed(4), +E.net[i].toFixed(2), +E.dcum[i].toFixed(2)]));
}

/* ------------------------------------------------------------------ update */
function update() {
  V = ui.values(); syncEnabled(V);
  if (V.sys !== curSys) { curSys = V.sys; }
  S = Object.assign({}, store[curSys]);
  C = context(V);
  E = evaluate(S, C);
  const sold = S.yield * (1 - S.loss / 100);
  ro.set('lcof', E.lcof, E.lcof <= S.price ? 'ok' : 'bad', `capital ${fmt(100 * E.perKg.capital / E.lcof, 0)} % · labour ${fmt(100 * E.perKg.labour / E.lcof, 0)} % · energy ${fmt(100 * (E.perKg.elec + E.perKg.heat) / E.lcof, 0)} %`);
  ro.set('price', S.price, null, `margin ${fmt(S.price - E.lcof, 2)} € kg⁻¹ (${fmt(100 * (S.price - E.lcof) / S.price, 0)} %)`);
  ro.set('npv', E.npv, E.npv >= 0 ? 'ok' : 'bad', `${fmt(E.npv * 1000 / 1e6, 2)} M€ for 1 000 m² at ${fmt(C.r, 1)} %`);
  ro.set('irr', E.irr == null ? NaN : 100 * E.irr, E.irr == null ? 'bad' : E.irr * 100 >= C.r ? 'ok' : 'bad', E.irr == null ? 'no rate makes the NPV zero' : `compare with the discount rate ${fmt(C.r, 1)} %`);
  ro.set('pay', E.payback == null ? NaN : E.payback, E.payback == null ? 'bad' : E.payback <= C.n / 2 ? 'ok' : 'warn', E.dpayback == null ? 'never repaid when discounted' : `discounted: ${fmt(E.dpayback, 1)} yr`);
  const I0 = CAPEX.reduce((a, it) => a + S['cap' + it.key], 0);
  ro.set('capex', I0, null, `annualised ${fmt(I0 * crf(C.r / 100, C.n), 1)} € m⁻² yr⁻¹ (CRF ${fmt(crf(C.r / 100, C.n), 4)})`);
  const top = PARTS.map(p => [p, E.perKg[p.key]]).sort((a, b) => b[1] - a[1])[0];
  ro.set('top', top[0].label.split(/[,(]/)[0], null, `${fmt(top[1], 2)} € kg⁻¹ = ${fmt(100 * top[1] / E.lcof, 0)} % of LCOF`);
  ro.set('wage', C.wage, null, V.wageMode === 'se' ? `${fmt(V.salary, 0)} SEK month⁻¹ + ${fmt(V.contrib, 2)} % + ${fmt(V.otherLab, 1)} %, ${fmt(V.hours, 0)} h yr⁻¹` : 'custom value');
  ro.set('sold', sold, null, `harvest ${fmt(S.yield, 1)} kg m⁻² yr⁻¹ · ${fmt(S.loss, 1)} % unsold`);
  drawWaterfall(); cashChart(); tornadoChart();
  compareChart();
  runMC();
  document.getElementById('wf-sub').textContent = `${SYSTEMS[curSys].label}: each bar adds its present-value share of the cost of one kilogram (discount rate ${fmt(C.r, 1)} %, ${C.n} years).`;
  stageTarget();
}
let raf = 0;
function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); }
ui.onChange((st, id) => {
  if (applying) return;
  if (id === 'sys') { curSys = st.sys; applying = true; ui.setMany(store[curSys]); applying = false; }
  else if (SYS_IDS.includes(id)) store[curSys][id] = st[id];
  schedule();
});

/* ------------------------------------------------------------------ stage: money flowing into one kilogram */
const stageEl = document.getElementById('stage');
const cv = document.createElement('canvas'); stageEl.appendChild(cv);
const ctx = cv.getContext('2d');
const hud = hudChips(stageEl); hud.el.style.flexDirection = 'row'; hud.el.style.flexWrap = 'wrap'; hud.el.style.maxWidth = '76%';
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'levelised-cost.png'; a.click(); } });
let W = 0, H = 0, DPR = 1, stageVisible = true;
function resize() { DPR = Math.min(2, devicePixelRatio || 1); W = stageEl.clientWidth; H = stageEl.clientHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
new ResizeObserver(resize).observe(stageEl); resize();
new IntersectionObserver(es => { stageVisible = es[0].isIntersecting; }).observe(stageEl);
const X = f => f * W, Y = f => f * H;
const FONT = (s, w = 600) => `${w} ${s}px Inter, system-ui, sans-serif`;
const MONO = (s, w = 500) => `${w} ${s}px 'JetBrains Mono', ui-monospace, monospace`;
function rr(x, y, w, h, r) { roundRect(ctx, x, y, w, h, r); }
const GROUPS = [
  { key: 'capital', label: 'Capital + maintenance', short: 'Capital', parts: ['capital', 'maint'], color: '#a792f0' },
  { key: 'energy', label: 'Energy', short: 'Energy', parts: ['elec', 'heat'], color: '#f2b94b' },
  { key: 'labour', label: 'Labour', short: 'Labour', parts: ['labour'], color: '#5cc8ef' },
  { key: 'inputs', label: 'Seeds, nutrients, water', short: 'Inputs', parts: ['seeds', 'nutr', 'prot', 'water'], color: '#6fd39a' },
  { key: 'pack', label: 'Packaging and logistics', short: 'Packaging', parts: ['pack'], color: '#f07ad0' },
  { key: 'other', label: 'Land, insurance, admin', short: 'Overheads', parts: ['other'], color: '#b9c8c0' }
];
let flows = GROUPS.map(g => ({ ...g, v: 0, w: 0, tw: 0, coins: [] }));
let shown = { lcof: 0, price: 0 }, target = { lcof: 0, price: 0 };
function stageTarget() {
  GROUPS.forEach((g, i) => { flows[i].v = g.parts.reduce((a, k) => a + Math.max(0, E.perKg[k]), 0); });
  target = { lcof: E.lcof, price: S.price };
}
function drawSystem(x0, y0, w, h, sys, t) {
  ctx.save();
  if (sys === 'vf') {
    rr(x0, y0, w, h, 8); ctx.fillStyle = '#16211d'; ctx.fill(); ctx.strokeStyle = '#8a9a92'; ctx.lineWidth = 1.4; ctx.stroke();
    const nT = 5; for (let i = 0; i < nT; i++) { const yb = y0 + h - 8 - i * (h - 16) / nT, yl = yb - (h - 16) / nT * 0.8; const g = ctx.createLinearGradient(0, yl, 0, yb); g.addColorStop(0, 'rgba(255,120,220,0.45)'); g.addColorStop(1, 'rgba(255,120,220,0.04)'); ctx.fillStyle = g; ctx.fillRect(x0 + 8, yl, w - 16, yb - yl); ctx.fillStyle = '#ffd6f3'; ctx.fillRect(x0 + 10, yl - 1, w - 20, 2); ctx.fillStyle = 'rgba(215,220,214,0.5)'; ctx.fillRect(x0 + 8, yb - 2, w - 16, 2); lettuceRow(x0 + 12, x0 + w - 12, yb - 2, 5); }
  } else if (sys === 'gh') {
    const sw = w / 6; ctx.beginPath(); ctx.moveTo(x0, y0 + h); ctx.lineTo(x0, y0 + h * 0.36); for (let i = 0; i < 6; i++) ctx.lineTo(x0 + (i + 1) * sw, i % 2 === 0 ? y0 + h * 0.12 : y0 + h * 0.36); ctx.lineTo(x0 + w, y0 + h); ctx.closePath();
    ctx.fillStyle = 'rgba(160,210,230,0.1)'; ctx.fill(); ctx.strokeStyle = 'rgba(200,225,235,0.7)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,140,90,0.8)'; ctx.lineWidth = 2; [0.9, 0.94].forEach(f => { ctx.beginPath(); ctx.moveTo(x0 + 6, y0 + h * f); ctx.lineTo(x0 + w - 6, y0 + h * f); ctx.stroke(); });
    for (let i = 0; i < 4; i++) { const lx = x0 + (i + 0.5) * w / 4, ly = y0 + h * 0.42; const g = ctx.createRadialGradient(lx, ly, 1, lx, ly, 22); g.addColorStop(0, 'rgba(255,200,120,0.5)'); g.addColorStop(1, 'rgba(255,200,120,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lx, ly, 22, 0, 7); ctx.fill(); }
    lettuceRow(x0 + 8, x0 + w - 8, y0 + h * 0.86, 6); lettuceRow(x0 + 8, x0 + w - 8, y0 + h * 0.7, 6);
  } else {
    const sx = x0 + w * 0.8, sy = y0 + h * 0.18; const g = ctx.createRadialGradient(sx, sy, 2, sx, sy, 26); g.addColorStop(0, 'rgba(255,236,170,0.95)'); g.addColorStop(1, 'rgba(255,200,90,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 26, 0, 7); ctx.fill(); ctx.fillStyle = '#ffe9a6'; ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 7); ctx.fill();
    ctx.fillStyle = '#3b2d22'; ctx.fillRect(x0, y0 + h * 0.62, w, h * 0.38);
    for (let r = 0; r < 4; r++) { const y = y0 + h * (0.66 + r * 0.09); ctx.fillStyle = '#4a3a2c'; ctx.fillRect(x0, y + 3, w, 3); lettuceRow(x0 + 4, x0 + w - 4, y + 3, 4.5 + r * 0.6); }
    // tractor
    const tx = x0 + ((t * 18) % (w + 60)) - 40, ty = y0 + h * 0.6; ctx.fillStyle = '#c2573a'; ctx.fillRect(tx, ty - 12, 26, 10); ctx.fillRect(tx + 16, ty - 22, 10, 10); ctx.fillStyle = '#1b1b1b'; ctx.beginPath(); ctx.arc(tx + 5, ty, 5, 0, 7); ctx.arc(tx + 22, ty, 7, 0, 7); ctx.fill();
  }
  ctx.restore();
}
function lettuceRow(xa, xb, y, r) { const n = Math.max(3, Math.floor((xb - xa) / (r * 2.5))); for (let j = 0; j < n; j++) { const cx = xa + (j + 0.5) * (xb - xa) / n; ctx.fillStyle = '#2f8a55'; ctx.beginPath(); ctx.ellipse(cx, y, r, r * 0.8, 0, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#6fd39a'; ctx.beginPath(); ctx.ellipse(cx - r * 0.15, y - r * 0.12, r * 0.7, r * 0.56, 0, Math.PI, 0); ctx.fill(); } }
function bezPt(p, t) { const u = 1 - t; return [u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6], u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7]]; }
let yearHead = 0;
function drawStage(tReal, dt) {
  if (!E || !W) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0f1a17'); bg.addColorStop(1, '#0a110e'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // smooth transitions
  const k = 1 - Math.exp(-dt * 5);
  shown.lcof += (target.lcof - shown.lcof) * k; shown.price += (target.price - shown.price) * k;
  flows.forEach(f => { f.w += (f.v - f.w) * k; });
  /* ---- system illustration ---- */
  const sx0 = X(0.03), sy0 = Y(0.13), sw = X(0.2), sh = Y(0.46);
  drawSystem(sx0, sy0, sw, sh, curSys, tReal);
  ctx.fillStyle = '#e6eee9'; ctx.font = FONT(12.5, 650); ctx.textAlign = 'center'; ctx.fillText(SYSTEMS[curSys].label, sx0 + sw / 2, sy0 + sh + 18);
  ctx.fillStyle = '#9fb2a8'; ctx.font = MONO(10); ctx.fillText(`${fmt(S.yield * (1 - S.loss / 100), S.yield < 10 ? 2 : 0)} kg m⁻² yr⁻¹ sold`, sx0 + sw / 2, sy0 + sh + 33);
  /* ---- cost ribbons into the crate ---- */
  const total = Math.max(1e-6, flows.reduce((a, f) => a + f.w, 0));
  const crate = { x: X(0.74), y: Y(0.17), w: X(0.2), h: Y(0.38) };
  const srcX = X(0.3), topY = Y(0.1), botY = Y(0.6), gap = 8;
  const act = flows.filter(f => f.w > total * 0.003);
  const avail = botY - topY - gap * (act.length - 1);
  const maxRib = crate.h * 0.9;
  const scale = Math.min(avail, maxRib * 1.6) / total;
  let ys = topY, yin = crate.y + crate.h * 0.05 + (crate.h * 0.9 - Math.min(maxRib, total * scale * 0.62)) / 2;
  const inScale = Math.min(maxRib, total * scale * 0.62) / total;
  act.forEach(f => {
    const hs = Math.max(2, f.w * scale), hi = Math.max(1.5, f.w * inScale);
    const y0 = ys + hs / 2, y1 = yin + hi / 2;
    const p = [srcX + 150, y0, (srcX + 150 + crate.x) / 2, y0, (srcX + 150 + crate.x) / 2, y1, crate.x, y1];
    // ribbon
    ctx.beginPath();
    const N = 40; const top = [], bot = [];
    for (let i = 0; i <= N; i++) { const t = i / N; const [x, y] = bezPt(p, t); const th = hs + (hi - hs) * (t * t * (3 - 2 * t)); top.push([x, y - th / 2]); bot.push([x, y + th / 2]); }
    ctx.moveTo(top[0][0], top[0][1]); top.forEach(q => ctx.lineTo(q[0], q[1])); for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]); ctx.closePath();
    ctx.fillStyle = withAlpha(f.color, 0.28); ctx.fill();
    // source tag
    rr(srcX - 2, ys, 150, hs, Math.min(6, hs / 2)); ctx.fillStyle = withAlpha(f.color, 0.85); ctx.fill();
    ctx.fillStyle = '#0b120f'; ctx.font = FONT(hs >= 30 ? 11.5 : 10.5, 700); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const lbl = hs >= 30 && ctx.measureText(f.label).width < 138 ? f.label : f.short;
    if (hs >= 13) ctx.fillText(lbl, srcX + 6, ys + hs / 2 - (hs >= 30 ? 7 : 0));
    ctx.fillStyle = '#e6eee9'; ctx.font = MONO(10.5, 600); ctx.textAlign = 'right';
    const val = `€${fmt(f.w, f.w < 0.1 ? 3 : 2)}`;
    if (hs >= 30) { ctx.fillStyle = '#0b120f'; ctx.textAlign = 'left'; ctx.fillText(`${val} kg⁻¹ · ${fmt(100 * f.w / total, 0)} %`, srcX + 6, ys + hs / 2 + 8); }
    else { ctx.fillText(hs >= 13 ? val : `${f.short} ${val}`, srcX - 8, ys + hs / 2); }
    // coins travelling along the ribbon
    const want = Math.max(1, Math.round(f.w / total * 26));
    while (f.coins.length < want) f.coins.push({ t: Math.random(), off: (Math.random() - 0.5) * 0.7, v: 0.16 + Math.random() * 0.1 });
    while (f.coins.length > want) f.coins.pop();
    f.coins.forEach(c => { c.t += c.v * dt; if (c.t > 1) c.t -= 1; const [x, y] = bezPt(p, c.t); const th = hs + (hi - hs) * (c.t * c.t * (3 - 2 * c.t)); const cy = y + c.off * th; ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(x, cy, 3.2, 0, 7); ctx.fill(); ctx.strokeStyle = 'rgba(10,16,14,0.6)'; ctx.lineWidth = 0.8; ctx.stroke(); });
    ys += hs + gap; yin += hi;
  });
  /* ---- crate with one kilogram ---- */
  rr(crate.x, crate.y, crate.w, crate.h, 10); const cg = ctx.createLinearGradient(0, crate.y, 0, crate.y + crate.h); cg.addColorStop(0, '#2a3a33'); cg.addColorStop(1, '#1a2622'); ctx.fillStyle = cg; ctx.fill(); ctx.strokeStyle = '#9fb2a8'; ctx.lineWidth = 1.4; ctx.stroke();
  for (let i = 1; i < 4; i++) { ctx.strokeStyle = 'rgba(159,178,168,0.25)'; ctx.beginPath(); ctx.moveTo(crate.x + 6, crate.y + crate.h * i / 4); ctx.lineTo(crate.x + crate.w - 6, crate.y + crate.h * i / 4); ctx.stroke(); }
  lettuceRow(crate.x + 10, crate.x + crate.w - 10, crate.y + 4, Math.min(16, crate.w / 8));
  ctx.textAlign = 'center'; ctx.fillStyle = '#9fb2a8'; ctx.font = MONO(10.5); ctx.fillText('1 kg of lettuce costs', crate.x + crate.w / 2, crate.y + crate.h * 0.36);
  ctx.fillStyle = '#e6eee9'; ctx.font = FONT(Math.min(34, crate.w / 5), 750); ctx.fillText(`€${fmt(shown.lcof, 2)}`, crate.x + crate.w / 2, crate.y + crate.h * 0.58);
  ctx.fillStyle = '#9fb2a8'; ctx.font = MONO(9.5); ctx.fillText('levelised cost of food', crate.x + crate.w / 2, crate.y + crate.h * 0.72);
  // price tag
  const margin = shown.price - shown.lcof, good = margin >= 0;
  ctx.font = FONT(12, 700); const ptxt = `price €${fmt(shown.price, 2)} · ${good ? 'margin' : 'loss'} €${fmt(Math.abs(margin), 2)} kg⁻¹`;
  const tw = Math.min(X(0.34), ctx.measureText(ptxt).width + 24), tx = Math.min(W - tw - 8, crate.x + crate.w / 2 - tw / 2), ty = crate.y + crate.h + 16, th = Y(0.085);
  ctx.strokeStyle = '#9fb2a8'; ctx.beginPath(); ctx.moveTo(crate.x + crate.w / 2, crate.y + crate.h); ctx.lineTo(crate.x + crate.w / 2, ty); ctx.stroke();
  rr(tx, ty, tw, th, 8); ctx.fillStyle = good ? 'rgba(111,211,154,0.18)' : 'rgba(255,122,110,0.18)'; ctx.fill(); ctx.strokeStyle = good ? '#6fd39a' : '#ff7a6e'; ctx.stroke();
  ctx.fillStyle = good ? '#9be7b6' : '#ffb0a8'; ctx.font = FONT(12, 700); ctx.textAlign = 'center'; ctx.fillText(ptxt, tx + tw / 2, ty + th / 2 + 4);
  /* ---- timeline: discounted cash flows ---- */
  const F = E.F, n = F.n;
  const tl = { x0: X(0.06), x1: X(0.96), y0: Y(0.73), y1: Y(0.95) };
  const mid = (tl.y0 + tl.y1) / 2 + 6;
  const mx = Math.max(1e-6, ...F.rev, ...F.T.map((t, i) => F.capex[i] + F.opex[i]));
  const hs = (tl.y1 - tl.y0) / 2 - 4;
  const xAt = t => tl.x0 + (t + 0.5) / (n + 1) * (tl.x1 - tl.x0), bw = Math.max(3, (tl.x1 - tl.x0) / (n + 1) * 0.36);
  ctx.strokeStyle = 'rgba(159,178,168,0.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tl.x0, mid); ctx.lineTo(tl.x1, mid); ctx.stroke();
  yearHead = (yearHead + dt * 1.6) % (n + 2.5);
  const cur = Math.min(n, Math.floor(yearHead));
  F.T.forEach((t, i) => {
    const x = xAt(t), df = E.d[i], on = t <= cur;
    const up = F.rev[i] / mx * hs, down = (F.capex[i] + F.opex[i]) / mx * hs;
    ctx.fillStyle = 'rgba(111,211,154,0.22)'; ctx.fillRect(x - bw, mid - up, bw, up);
    ctx.fillStyle = 'rgba(255,122,110,0.22)'; ctx.fillRect(x, mid, bw, down);
    if (on) { ctx.fillStyle = '#6fd39a'; ctx.fillRect(x - bw * 0.8, mid - up * df, bw * 0.6, up * df); ctx.fillStyle = F.capex[i] > 0 ? '#ff7a6e' : '#f2b94b'; ctx.fillRect(x + bw * 0.2, mid, bw * 0.6, down * df); }
    if (n <= 20 || t % 5 === 0) { ctx.fillStyle = t === cur ? '#e6eee9' : '#6f8479'; ctx.font = MONO(9); ctx.textAlign = 'center'; ctx.fillText(String(t), x, tl.y1 + 12); }
  });
  // cumulative discounted cash flow line
  const cmax = Math.max(1e-6, ...E.dcum.map(Math.abs));
  ctx.strokeStyle = '#f07ad0'; ctx.lineWidth = 2; ctx.beginPath();
  E.dcum.forEach((v, i) => { if (i > cur) return; const x = xAt(i), y = mid - v / cmax * hs * 0.95; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
  const vx = xAt(cur), vy = mid - E.dcum[cur] / cmax * hs * 0.95; ctx.fillStyle = '#f07ad0'; ctx.beginPath(); ctx.arc(vx, vy, 3.5, 0, 7); ctx.fill();
  ctx.fillStyle = '#9fb2a8'; ctx.font = MONO(9.5); ctx.textAlign = 'left'; ctx.fillText('year → ghost bars: money as paid · solid: worth today (× discount factor) · magenta: cumulative NPV', tl.x0, tl.y0 - 8);
  hud.set('sys', `LCOF <b>€${fmt(E.lcof, 2)} kg⁻¹</b>`);
  hud.set('yr', `year <b>${cur}</b> · ×<b>${fmt(E.d[cur], 3)}</b> · NPV so far <b>€${fmt(E.dcum[cur], 0)}</b> m⁻²`);
}
const clock = new SimClock({ speed: 1, onFrame: t => { const now = performance.now(); const dtr = Math.min(0.1, (now - (clock._lr || now)) / 1000); clock._lr = now; if (stageVisible) drawStage(t, dtr); } });

update();
flows.forEach(f => { f.w = f.v; }); shown = { ...target };
clock.play();
