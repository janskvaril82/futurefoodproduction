/* Sensor bench — controller: controls, simulation clock, signal chain, charts, 3D coupling.
   Physics lives in models.js (Eqs. SB1–SB11 in the Derive tab); the 3D bench in scene.js. */
import { createBench } from './scene.js';
import { SENSORS, MEDIA, SUBSTRATES, measure, readingDet, budget, rhAtSensor, NDIR, VS_ACTUAL, crim, probeCap, clamp } from './models.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, linspace, downloadCSV } from '/assets/js/plot.js';
import { mulberry32 } from '/assets/js/stats.js';

const KEYS = ['ntc', 'rh', 'par', 'co2', 'vwc'];
const rnd = mulberry32(20260927);
const fmtOhm = v => v >= 1e6 ? fmt(v / 1e6, 2) + ' M' : v >= 1e3 ? fmt(v / 1e3, v >= 1e4 ? 1 : 2) + ' k' : fmt(v, 0) + ' ';

/* ------------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
ui.section('Sensor on the bench');
ui.segmented({ id: 'sensor', options: [{ value: 'ntc', label: 'NTC' }, { value: 'rh', label: 'RH' }, { value: 'par', label: 'PAR' }, { value: 'co2', label: 'CO₂' }, { value: 'vwc', label: 'θ' }], value: 'ntc' });
ui.toggle({ id: 'cut', label: 'Open it up (cut-away + physics)', value: true });
ui.buttons([{ label: 'Fly to sensor', onClick: () => bench.focus(ui.get('sensor')) }, { label: 'Bench overview', onClick: () => bench.focus(null) }]);

ui.section('Measurand');
KEYS.forEach(k => { const x = SENSORS[k].x; ui.slider({ id: x.id, label: x.label, min: x.min, max: x.max, step: x.step, value: x.value, unit: x.unit, digits: x.digits === 0 ? 0 : x.digits > 2 ? 3 : 1 }); });

ui.section('Environment');
ui.segmented({ id: 'medium', label: 'Probe in…', options: Object.entries(MEDIA).map(([value, m]) => ({ value, label: m.label.replace(' (≈2 m s⁻¹)', '') })), value: 'stirred', help: 'Sets the convection coefficient h, hence τ = mc/(hA) and the self-heating δ = hA.' });
ui.slider({ id: 'Tair', label: 'Air (sensor body) temperature', min: 0, max: 40, step: 0.5, value: 22, unit: '°C' });
ui.slider({ id: 'dTs', label: 'Sensor warmer than the air by', min: 0, max: 5, step: 0.1, value: 0, unit: 'K', help: 'Self-heating of the electronics or sunshine on an unshielded housing.' });
ui.slider({ id: 'P', label: 'Barometric pressure', min: 850, max: 1050, step: 1, value: 1013, unit: 'hPa', help: 'Sea level ≈ 1013 hPa; −1 % per ≈ 85 m of altitude.' });
ui.slider({ id: 'lamp', label: 'IR lamp output (ageing, dirt)', min: 60, max: 100, step: 1, value: 100, unit: '%' });
ui.select({ id: 'substrate', label: 'Substrate in the pot', options: Object.entries(SUBSTRATES).map(([value, s]) => ({ value, label: `${s.label} (φ = ${s.phi})` })), value: 'coir' });

ui.section('Conditioning circuit');
ui.slider({ id: 'Rf', label: 'Divider resistor R<sub>f</sub>', min: 1000, max: 100000, log: true, value: 10000, unit: 'Ω', format: fmtOhm, help: 'Best sensitivity when R<sub>f</sub> ≈ R<sub>T</sub> in the middle of the range.' });
ui.toggle({ id: 'ratio', label: 'Ratiometric (ADC reference = divider supply)', value: true });
ui.slider({ id: 'Cf', label: 'Charge-amplifier feedback C<sub>f</sub>', min: 20, max: 100, step: 1, value: 36, unit: 'pF', help: 'Smaller C<sub>f</sub> = more volts per picofarad (until the output saturates).' });
ui.slider({ id: 'Rtia', label: 'Transimpedance resistor R<sub>f</sub>', min: 10000, max: 1000000, log: true, value: 150000, unit: 'Ω', format: fmtOhm });
ui.slider({ id: 'G', label: 'Thermopile pre-amplifier gain', min: 200, max: 2500, step: 10, value: 1000, unit: '×' });
const vwcNote = ui.html('<p class="ctl-help" style="margin:6px 0 0">The moisture probe carries its own circuit: a TLC555 oscillator (≈1.5 MHz, 34 % duty) drives the probe capacitance through 10 kΩ; a diode peak detector turns the result into 1.5–3 V.</p>');

ui.section('Analogue-to-digital converter');
ui.slider({ id: 'bits', label: 'Resolution N', min: 8, max: 16, step: 1, value: 12, unit: 'bit' });
ui.select({ id: 'vref', label: 'Full-scale reference V<sub>ref</sub>', options: [['1.1', '1.1 V (internal)'], ['2.048', '2.048 V (precision ref.)'], ['2.5', '2.5 V'], ['3.3', '3.3 V (supply)'], ['4.096', '4.096 V (ADS1115 range)']].map(([value, label]) => ({ value, label })), value: '3.3' });
ui.slider({ id: 'noise', label: 'Noise at the ADC input (rms)', min: 0, max: 5, step: 0.05, value: 0.5, unit: 'mV' });
ui.segmented({ id: 'avg', label: 'Samples averaged per reading', options: [1, 4, 16, 64].map(v => ({ value: v, label: '×' + v })), value: 1 });
ui.toggle({ id: 'inl', label: 'ESP32-like nonlinearity (±12 LSB INL)', value: false });

ui.section('Firmware');
ui.segmented({ id: 'fwNtc', label: 'Thermistor equation', options: [{ value: 'beta', label: 'β model (data sheet)' }, { value: 'sh', label: 'Steinhart–Hart (calibrated)' }], value: 'beta' });
ui.segmented({ id: 'fwRh', label: 'Humidity conversion', options: [{ value: 'nom', label: 'Nominal 180 pF' }, { value: 'cal', label: 'One-point calibrated' }], value: 'cal' });
ui.toggle({ id: 'dual', label: 'Divide by the reference channel', value: true });
ui.toggle({ id: 'ptc', label: 'Pressure & temperature compensation', value: true });
ui.segmented({ id: 'fwVwc', label: 'Moisture conversion', options: [{ value: 'linear', label: 'Air–water %' }, { value: 'cal', label: 'Substrate curve' }], value: 'cal' });

ui.section('Dynamics');
ui.button({ label: 'Run a step test', variant: 'primary', onClick: () => stepTest() });
ui.segmented({ id: 'speed', label: 'Clock', options: [{ value: 'real', label: 'Real time' }, { value: 'fast', label: 'Fast-forward (≈8τ in 15 s)' }], value: 'fast' });

ui.presets([
  { label: 'Hobby tank thermometer', values: { sensor: 'ntc', Tw: 18, medium: 'stirred', Rf: 10000, ratio: true, bits: 12, vref: '3.3', noise: 2, avg: 1, inl: true, fwNtc: 'beta' } },
  { label: 'Calibrated logger', values: { sensor: 'ntc', Tw: 5, medium: 'stirred', Rf: 27000, ratio: true, bits: 16, vref: '3.3', noise: 0.1, avg: 16, inl: false, fwNtc: 'sh' } },
  { label: 'Sunlit RH sensor', values: { sensor: 'rh', RH: 80, Tair: 25, dTs: 2, fwRh: 'cal', bits: 12, noise: 0.5, avg: 4, inl: false } },
  { label: 'Greenhouse at 550 m', values: { sensor: 'co2', CO2: 1000, P: 950, Tair: 26, ptc: false, dual: true, lamp: 100, bits: 12, noise: 0.5, avg: 16 } },
  { label: 'Aged single-beam CO₂', values: { sensor: 'co2', CO2: 800, P: 1013, Tair: 22, lamp: 85, dual: false, ptc: true } },
  { label: 'Hobby moisture probe', values: { sensor: 'vwc', theta: 0.55, substrate: 'coir', fwVwc: 'linear', bits: 12, vref: '3.3', noise: 3, avg: 1, inl: true } }
]);
ui.saveButton('sensor-bench', () => ro.values());

const VIS = {
  ntc: ['Tw', 'medium', 'Rf', 'ratio', 'fwNtc'],
  rh: ['RH', 'Tair', 'dTs', 'Cf', 'fwRh'],
  par: ['PPFD', 'Tair', 'Rtia'],
  co2: ['CO2', 'Tair', 'P', 'lamp', 'G', 'dual', 'ptc'],
  vwc: ['theta', 'Tair', 'substrate', 'fwVwc']
};
const ALLVIS = [...new Set(Object.values(VIS).flat())];
function showControls(k) { ALLVIS.forEach(id => ui.show(id, VIS[k].includes(id))); vwcNote.style.display = k === 'vwc' ? '' : 'none'; }

/* ------------------------------------------------------------------ readouts */
const ro = new Readouts('#readouts');
ro.add({ id: 'reading', label: 'Reading (firmware output)', unit: '', digits: 2 })
  .add({ id: 'err', label: 'Error of this reading', unit: '', digits: 3 })
  .add({ id: 'res', label: 'Resolution (1 LSB)', unit: '', digits: 4 })
  .add({ id: 'uc', label: 'Combined standard uncertainty u<sub>c</sub>', unit: '', digits: 3 })
  .add({ id: 'U', label: 'Expanded uncertainty U (k = 2)', unit: '', digits: 3 })
  .add({ id: 'bias', label: 'Uncorrected systematic error', unit: '', digits: 3 })
  .add({ id: 'tau', label: 'Time constant τ', unit: 's', digits: 1 })
  .add({ id: 'lag', label: 'Dynamic error now (y − x)', unit: '', digits: 3 });

/* ------------------------------------------------------------------ 3D bench */
const bench = createBench(document.getElementById('stage'), { onSelect: k => { ui.set('sensor', k); } });
const hud = hudChips(bench.stage.el);

/* ------------------------------------------------------------------ simulation */
const P = () => { const v = ui.values(); return Object.assign({}, v, { vref: parseFloat(v.vref), avg: +v.avg }); };
const sim = {};
KEYS.forEach(k => { const x = ui.get(SENSORS[k].x.id); sim[k] = { x, y: x, last: null, log: [] }; });
let step = null, sampleAcc = 0, blinkT = 0, lastBudget = null;
const cur = () => ui.get('sensor');
function windowFor(k, s) { const tau = SENSORS[k].tau(s); return clamp(8 * tau, 12, 3000); }
function sampleEvery(k, s) { return clamp(windowFor(k, s) / 150, 0.05, 20); }
function baselineFor(k, target, s) {
  if (k === 'ntc') return s.Tair;
  if (k === 'rh') return target > 55 ? 33 : 80;
  if (k === 'par') return 0;
  if (k === 'co2') return target > 700 ? 420 : 2000;
  return 0;
}
function stepTest() {
  const k = cur(), s = P(), S = SENSORS[k];
  const target = ui.get(S.x.id), base = baselineFor(k, target, s);
  const W = windowFor(k, s);
  sim[k].x = base; sim[k].y = base; sim[k].log = [];
  step = { k, t0: clock.t + 0.08 * W, base, target, fired: false };
  if (window.FFP && FFP.toast) FFP.toast(`Step test: ${fmt(base, S.x.fmt)} → ${fmt(target, S.x.fmt)} ${S.x.unit}`);
}
const clock = new SimClock({
  speed: 1, maxDt: 0.05,
  onStep(dt) {
    const s = P();
    KEYS.forEach(k => {
      const S = SENSORS[k], m = sim[k];
      if (!(step && step.k === k)) m.x = ui.get(S.x.id);
      const tau = S.tau(s); m.y += (m.x - m.y) * (1 - Math.exp(-dt / tau));
    });
    if (step && !step.fired && clock.t >= step.t0) { // log the exact instant of the step (before and after)
      const m = sim[step.k]; m.log.push({ t: clock.t, x: m.x, y: m.y, r: NaN });
      m.x = step.target; step.fired = true; step.t0 = clock.t; m.log.push({ t: clock.t, x: m.x, y: m.y, r: NaN });
    }
    sampleAcc += dt;
    const k = cur(), Ts = sampleEvery(k, s);
    if (sampleAcc >= Ts) {
      sampleAcc = 0;
      KEYS.forEach(kk => { sim[kk].last = measure(kk, sim[kk].y, s, rnd); });
      const m = sim[k];
      m.log.push({ t: clock.t, x: m.x, y: m.y, r: m.last.fw.x });
      const W = windowFor(k, s); while (m.log.length && m.log[0].t < clock.t - W) m.log.shift();
      if (step && step.fired && clock.t > step.t0 + 0.92 * W) step = null;
      blinkT = 0.08; dirtySample = true;
    }
  }
});
let dirtySample = true;

/* ------------------------------------------------------------------ signal-chain panel */
const chainEl = document.getElementById('chain');
const STEPS = ['Measurand', 'Sensing element', 'Transducer output', 'Conditioning', 'ADC', 'Firmware → reading'];
chainEl.innerHTML = STEPS.map((t, i) => `<div class="sbc" data-i="${i}"><div class="sbc-k"><span>${i + 1}</span>${t}</div><div class="sbc-v">—</div><div class="sbc-s">—</div></div>`).join('');
const chainCells = [...chainEl.querySelectorAll('.sbc')].map(c => ({ el: c, v: c.querySelector('.sbc-v'), s: c.querySelector('.sbc-s') }));
function setCell(i, v, s, warn) { chainCells[i].v.innerHTML = v; chainCells[i].s.innerHTML = s; chainCells[i].el.classList.toggle('warn', !!warn); }

function renderChain(k, s) {
  const S = SENSORS[k], m = sim[k], L = m.last; if (!L) return;
  const u = S.x.unit, d = S.x.fmt, ch = L.ch, c0 = L.conv[0];
  const tau = S.tau(s);
  const env = { ntc: MEDIA[s.medium].label.toLowerCase(), rh: `air at ${fmt(s.Tair, 1)} °C`, par: 'LED panel above the sensor', co2: `${fmt(s.P, 0)} hPa, ${fmt(s.Tair, 1)} °C`, vwc: SUBSTRATES[s.substrate].label.toLowerCase() + ` at ${fmt(s.Tair, 1)} °C` }[k];
  setCell(0, `${fmt(m.x, d)} <small>${u}</small>`, env);
  const lagTxt = tau < 1e-3 ? 'photodiode: τ < 1 µs' : `τ = ${fmt(tau, tau < 10 ? 1 : 0)} s`;
  const elem = {
    ntc: [`${fmt(ch.Te, 2)} <small>°C</small>`, `bead temperature · ${lagTxt}${ch.dTsh > 0.0005 ? ` · self-heating +${fmt(ch.dTsh * 1000, 1)} mK` : ''}`],
    rh: [`${fmt(ch.RHs, 1)} <small>%RH</small>`, `RH inside the polymer · ${lagTxt}`],
    par: [`${fmt(m.y, 0)} <small>µmol m⁻² s⁻¹</small>`, lagTxt],
    co2: [`${fmt(m.y, 0)} <small>ppm</small>`, `gas in the cavity · diffusion ${lagTxt} · absorbs ${fmt(ch.FA * 100, 2)} %`],
    vwc: [`ε<sub>a</sub> = ${fmt(ch.eps, 1)}`, `bulk permittivity (CRIM) · ${lagTxt}`]
  }[k];
  setCell(1, elem[0], elem[1]);
  const q = {
    ntc: [`R<sub>T</sub> = ${fmtOhm(ch.q)}Ω`, `I = ${fmt(ch.I * 1e6, 1)} µA · P = ${fmt(ch.P * 1e6, 1)} µW`],
    rh: [`C = ${fmt(ch.q * 1e12, 2)} <small>pF</small>`, `polymer ε<sub>r</sub> rises with absorbed water`],
    par: [`I = ${fmt(ch.q * 1e6, 3)} <small>µA</small>`, `7.5 µA per 1000 µmol m⁻² s⁻¹`],
    co2: [`${fmt(ch.q * 1e3, 4)} / ${fmt(ch.qRef * 1e3, 4)} <small>mV</small>`, `active (4.26 µm) / reference (3.91 µm) thermopiles`],
    vwc: [`C = ${fmt(ch.q * 1e12, 1)} <small>pF</small>`, `probe capacitance incl. solder-mask coating`]
  }[k];
  setCell(2, q[0], q[1]);
  const Vtxt = ch.V.length > 1 ? `${fmt(ch.V[0], 4)} / ${fmt(ch.V[1], 4)} <small>V</small>` : `${fmt(ch.V[0], 4)} <small>V</small>`;
  const cond = {
    ntc: `divider, R<sub>f</sub> = ${fmtOhm(s.Rf)}Ω, supply ${fmt(VS_ACTUAL, 2)} V`,
    rh: `charge amplifier, C<sub>f</sub> = ${fmt(s.Cf, 0)} pF`,
    par: `TIA, R<sub>f</sub> = ${fmtOhm(s.Rtia)}Ω`,
    co2: `pre-amplifier gain ${fmt(s.G, 0)}×`,
    vwc: `555 + 10 kΩ + peak detector`
  }[k];
  const sat = L.conv.some(c => c.sat);
  setCell(3, Vtxt, cond, sat);
  const n = 2 ** s.bits, codes = L.conv.map(c => fmt(c.code, s.avg > 1 ? 1 : 0)).join(' / ');
  setCell(4, `${codes} <small>of ${n - 1}</small>`, sat ? `<b>saturated</b> — input above V<sub>ref</sub> = ${fmt(L.ref.actual, 3)} V` : `${s.bits} bit · LSB ${fmt(c0.lsb * 1e3, 3)} mV · V<sub>ref</sub> ${k === 'ntc' && s.ratio ? 'supply (ratiometric)' : fmt(s.vref, 3) + ' V'}${s.avg > 1 ? ` · mean of ${s.avg}` : ''}`, sat);
  const fwName = { ntc: s.fwNtc === 'sh' ? 'Steinhart–Hart' : 'β model', rh: s.fwRh === 'cal' ? 'calibrated C@55 %' : 'nominal 180 pF', par: 'I / k<sub>cal</sub>', co2: `${s.dual ? 'ratio' : 'single'}${s.ptc ? ' + P,T comp.' : ''}`, vwc: s.fwVwc === 'cal' ? 'substrate curve (20 °C)' : 'air–water linear %' }[k];
  const err = L.fw.x - m.x;
  setCell(5, `${fmt(L.fw.x, d)} <small>${u}</small>`, `${fwName} · error ${err >= 0 ? '+' : ''}${fmt(err, d + (d < 3 ? 1 : 0))} ${u}`);
}

/* ------------------------------------------------------------------ charts */
const tfPlot = new Plot('#chart-tf', { x: { label: 'Measurand' }, y: { label: 'Transducer output' }, y2: { label: 'ADC input', unit: 'V', min: 0, max: 4.2 }, legend: true });
const timePlot = new Plot('#chart-time', { x: { label: 'Simulated time', unit: 's' }, y: { label: 'Value' }, legend: true });
const errPlot = new Plot('#chart-err', { x: { label: 'Measurand' }, y: { label: 'Reading − true' }, legend: true });
const budEl = document.getElementById('chart-budget');
function renderBudget(b, unit, d) {
  const items = b.items.filter(i => i.kind === 'u' ? i.u > 1e-9 : Math.abs(i.v) > 1e-9);
  const rows = items.map(i => ({ lab: i.label, v: i.kind === 'u' ? i.u : i.v, kind: i.kind, note: i.note }))
    .concat([{ lab: 'Combined standard uncertainty u<sub>c</sub> (root-sum-square of the u rows)', v: b.uc, kind: 'tot' }, { lab: 'Sum of uncorrected systematic errors', v: b.bsum, kind: 'btot' }]);
  const mx = Math.max(...rows.map(r => Math.abs(r.v)), 1e-12);
  const dg = v => Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : Math.abs(v) >= 1 ? 2 : Math.abs(v) >= 0.01 ? 3 : 4;
  budEl.innerHTML = `<div class="sbb-head"><span>Component</span><span>1σ or bias <span class="u">(${unit})</span></span></div>` + rows.map(r => `
    <div class="sbb-row ${r.kind}" ${r.note ? `title="${r.note}"` : ''}><div class="sbb-lab"><i>${r.kind === 'u' ? 'u' : r.kind === 'b' ? 'bias' : r.kind === 'tot' ? 'Σ' : 'Σ'}</i>${r.lab}</div>
    <div class="sbb-bar"><span style="width:${(100 * Math.abs(r.v) / mx).toFixed(1)}%"></span></div><div class="sbb-val">${r.v < 0 ? '−' : r.kind === 'b' || r.kind === 'btot' ? '+' : ''}${fmt(Math.abs(r.v), dg(r.v))}</div></div>`).join('');
}

function qOf(k, x, s) { const ch = SENSORS[k].chain(x, s); return { q: ch.q * SENSORS[k].q.scale, q2: ch.qRef != null ? ch.qRef * SENSORS[k].q.scale : null, V: ch.V }; }
function drawStatic() {
  const k = cur(), s = P(), S = SENSORS[k], xs0 = S.x;
  const xmax = k === 'vwc' ? SUBSTRATES[s.substrate].phi : xs0.max;
  const xs = linspace(xs0.min, xmax, 161);
  const Q = xs.map(x => qOf(k, x, s));
  tfPlot.clear();
  tfPlot.setAxis('x', { label: xs0.label, unit: xs0.unit, min: xs0.min, max: xmax });
  tfPlot.setAxis('y', { label: S.q.label.replace(/<[^>]+>/g, ''), unit: S.q.unit, min: 'auto', max: 'auto' });
  tfPlot.line('q', xs, Q.map(o => o.q), { color: 'accent', width: 2.4, label: k === 'co2' ? 'Active thermopile (mV)' : 'Transducer output' });
  if (k === 'co2') tfPlot.line('q2', xs, Q.map(o => o.q2), { color: 'accent', width: 1.6, dash: [5, 4], label: 'Reference thermopile' });
  tfPlot.line('v', xs, Q.map(o => o.V[0]), { color: 'magenta', width: 2, y2: true, label: 'ADC input voltage' });
  const ref = S.adcRef(s); tfPlot.hline('vref', ref.actual, { y2: true, color: 'danger', label: `V_ref ${fmt(ref.actual, 2)} V`, dash: [3, 3] });
  const xNow = ui.get(xs0.id), qNow = qOf(k, Math.min(xNow, xmax), s);
  tfPlot.point('pq', Math.min(xNow, xmax), qNow.q, { color: 'accent', r: 5 });
  tfPlot.point('pv', Math.min(xNow, xmax), qNow.V[0], { color: 'magenta', r: 5, y2: true, guides: true });
  // error across the range (noise-free), with the ±U band of a single reading
  const xe = linspace(xs0.min + (xmax - xs0.min) * 0.005, xmax, 401);
  const e = xe.map(x => readingDet(k, x, s) - x);
  const bands = xe.filter((_, i) => i % 8 === 0).map(x => ({ x, b: budget(k, x, s) }));
  errPlot.clear();
  errPlot.setAxis('x', { label: xs0.label, unit: xs0.unit, min: xs0.min, max: xmax });
  errPlot.setAxis('y', { label: 'Reading − true', unit: xs0.unit, min: 'auto', max: 'auto' });
  errPlot.band('u', bands.map(o => o.x), bands.map(o => o.b.bsum - o.b.U), bands.map(o => o.b.bsum + o.b.U), { color: 'water', alpha: 0.16, label: '±U (k = 2) around the systematic error' });
  errPlot.hline('zero', 0, { color: 'muted', dash: [2, 3] });
  errPlot.line('e', xe, e, { color: 'magenta', width: 1.6, label: 'Noise-free reading error (incl. quantisation)' });
  errPlot.vline('now', Math.min(xNow, xmax), { color: 'accent', label: 'now' });
  // budget at the operating point
  const b = budget(k, clamp(xNow, xs0.min, xmax), s); lastBudget = b;
  renderBudget(b, xs0.unit, xs0.fmt);
  document.getElementById('budget-sub').innerHTML = `At ${fmt(clamp(xNow, xs0.min, xmax), xs0.fmt)} ${xs0.unit}. Blue bars are standard uncertainties (1σ) that add in quadrature; amber bars are known systematic errors that the chosen firmware does not correct.`;
}
function drawTime() {
  const k = cur(), m = sim[k], S = SENSORS[k]; if (!m.log.length) return;
  const T = m.log.map(o => o.t);
  timePlot.setAxis('y', { label: S.x.label, unit: S.x.unit });
  timePlot.line('x', T, m.log.map(o => o.x), { color: 'muted', width: 1.6, dash: [6, 4], step: true, label: 'True measurand x(t)' });
  timePlot.line('y', T, m.log.map(o => o.y), { color: 'accent', width: 2.4, label: 'Sensing element y(t)' });
  timePlot.scatter('r', T, m.log.map(o => o.r), { color: 'magenta', r: 2.4, label: 'Logged readings' });
  if (step && step.fired) {
    const tau = S.tau(P());
    timePlot.vline('t0', step.t0, { color: 'amber', label: 'step' });
    if (tau > 1e-3) timePlot.point('t63', step.t0 + tau, step.base + 0.632 * (step.target - step.base), { color: 'amber', r: 4.5, label: 'τ (63.2 %)' });
    else timePlot.remove('t63');
  } else { timePlot.remove('t0'); timePlot.remove('t63'); }
}

/* ------------------------------------------------------------------ readouts */
function updateReadouts() {
  const k = cur(), s = P(), S = SENSORS[k], m = sim[k], L = m.last; if (!L) return;
  const u = S.x.unit, d = S.x.fmt, b = lastBudget || budget(k, m.x, s);
  const err = L.fw.x - m.x, tau = S.tau(s);
  const DIG = { ntc: [2, 3], rh: [1, 2], par: [0, 1], co2: [0, 1], vwc: [3, 4] }[k];
  ['reading', 'err', 'res', 'uc', 'U', 'bias', 'lag'].forEach(id => { ro.items[id].unit = u; ro.items[id].digits = id === 'reading' ? DIG[0] : DIG[1]; });
  ro.items.tau.unit = tau < 1e-3 ? 'µs' : 's';
  ro.set('reading', L.fw.x, L.conv.some(c => c.sat) ? 'bad' : null, `true value ${fmt(m.x, d)} ${u}`);
  const Utot = Math.abs(b.bsum) + b.U;
  ro.set('err', err, Math.abs(err) <= b.U ? 'ok' : Math.abs(err) <= Utot ? 'warn' : 'bad', Math.abs(err) <= b.U ? 'inside ±U' : Math.abs(err) <= Utot ? 'explained by the biases' : 'larger than the budget — check dynamics');
  ro.set('res', b.lsbX, null, `${s.bits}-bit ADC`);
  ro.set('uc', b.uc);
  ro.set('U', b.U, null, '≈ 95 % coverage');
  ro.set('bias', b.bsum, Math.abs(b.bsum) < b.uc ? 'ok' : 'warn', Math.abs(b.bsum) < b.uc ? 'small compared with u<sub>c</sub>' : 'correct it or recalibrate');
  ro.set('tau', tau < 1e-3 ? tau * 1e6 : tau, null, tau < 1e-3 ? 'effectively instantaneous' : `95 % of a step after 3τ = ${fmt(3 * tau, 0)} s`);
  const lag = m.y - m.x; ro.set('lag', lag, Math.abs(lag) < b.uc ? 'ok' : 'warn', Math.abs(lag) < b.uc ? 'settled' : 'still responding');
}

/* ------------------------------------------------------------------ 3D coupling */
function label3d(k) { const L = sim[k].last; if (!L) return '—'; const S = SENSORS[k]; return `${fmt(L.fw.x, S.x.fmt)} ${S.x.unit}`; }
bench.stage.onFrame((dt, t) => {
  const s = P(), k = cur();
  blinkT -= dt;
  const st = {
    medium: s.medium, Tair: s.Tair, lamp: s.lamp, sub: SUBSTRATES[s.substrate], Rf: s.Rf, blink: blinkT > 0,
    ntc: { x: sim.ntc.x, y: sim.ntc.last ? sim.ntc.last.ch.Te : sim.ntc.y, I: sim.ntc.last ? sim.ntc.last.ch.I : 1.5e-4, label: label3d('ntc'), plunge: step && step.k === 'ntc' && !step.fired && MEDIA[s.medium].water ? 0 : undefined },
    rh: { x: sim.rh.x, RHs: rhAtSensor(sim.rh.y, s.Tair, s.dTs), label: label3d('rh') },
    par: { x: sim.par.y, label: label3d('par') },
    co2: (() => { const ch = sim.co2.last ? sim.co2.last.ch : null; return { y: sim.co2.y, FA: ch ? ch.FA : 0.04, va: ch ? ch.V[0] / (s.G * NDIR.V0act) : 1, vr: ch ? ch.V[1] / (s.G * NDIR.V0ref) : 1, label: label3d('co2') }; })(),
    vwc: { x: sim.vwc.y, C: probeCap(crim(sim.vwc.y, SUBSTRATES[s.substrate], s.Tair)), label: label3d('vwc') }
  };
  const L = sim[k].last;
  if (L) {
    st.dmm = { v: L.ch.V[0], unit: 'V', mode: 'DC' };
    const S = SENSORS[k];
    st.oled = { title: { ntc: 'NTC  GPIO34', rh: 'RH   GPIO35', par: 'PAR  GPIO32', co2: 'CO2  UART', vwc: 'SOIL GPIO33' }[k], value: `${fmt(L.fw.x, S.x.fmt)}${S.x.unit.length < 4 ? ' ' + S.x.unit.replace('m³ m⁻³', '') : ''}`, sub: `code ${Math.round(L.conv[0].code)}  ${s.bits}b` };
  }
  bench.update(dt, t, st);
  if (dirtySample) { dirtySample = false; renderChain(k, s); updateReadouts(); throttledTime(); }
  hud.set('t', `t = <b>${fmt(clock.t, clock.t < 100 ? 1 : 0)}</b> s · ×<b>${fmt(clock.speed, clock.speed < 10 ? 1 : 0)}</b>`);
  hud.set('s', `${SENSORS[k].name}${step && step.k === k ? (step.fired ? ' · <b>step test running</b>' : ' · step test armed') : ''}`);
});
let tTime = 0; function throttledTime() { const now = performance.now(); if (now - tTime > 120) { tTime = now; drawTime(); } }

/* ------------------------------------------------------------------ wiring */
function setSpeed() { const s = P(), k = cur(); clock.speed = s.speed === 'real' ? 1 : Math.max(1, windowFor(k, s) / 15); }
let staticTimer = null;
function scheduleStatic() { clearTimeout(staticTimer); staticTimer = setTimeout(drawStatic, 90); }
function select(k, fly = true) {
  showControls(k); bench.focus(k, fly); sim[k].log = []; step = null; setSpeed(); timePlot.clear(); scheduleStatic(); dirtySample = true;
  document.querySelectorAll('[data-sensor-note]').forEach(el => el.hidden = el.dataset.sensorNote !== k);
}
ui.onChange((state, id) => {
  if (id === 'sensor') { select(state.sensor); return; }
  if (id === 'cut') { bench.setCutaway(state.cut); return; }
  setSpeed(); scheduleStatic(); dirtySample = true;
});
bench.setCutaway(ui.get('cut'));
showControls(cur()); setSpeed(); drawStatic();
KEYS.forEach(k => { sim[k].last = measure(k, sim[k].y, P(), rnd); });
bench.focus(null, false);
document.querySelectorAll('[data-sensor-note]').forEach(el => el.hidden = el.dataset.sensorNote !== cur());
clock.play();

/* CSV export of the logged readings of the selected sensor */
document.getElementById('csv-log')?.addEventListener('click', () => {
  const k = cur(), S = SENSORS[k];
  downloadCSV(`sensor-bench-${k}.csv`, ['t_s', `true_${S.x.unit}`, `element_${S.x.unit}`, `reading_${S.x.unit}`], sim[k].log.map(o => [o.t.toFixed(3), o.x.toFixed(5), o.y.toFixed(5), isFinite(o.r) ? o.r.toFixed(5) : '']));
});
window.__sb = { sim, ui, bench, clock, select, stepTest };
