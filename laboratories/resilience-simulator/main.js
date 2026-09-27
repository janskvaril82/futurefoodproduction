/* Food-system resilience simulator — weekly supply model of fresh vegetables for a Swedish city (Eqs. R1–R9).
   Sources: domestic field (seasonal), cold storage, greenhouses and vertical farms (energy- and IT-dependent),
   imports from four origins (trade-dependent) and an emergency buffer stock. Shocks change capacities; production
   responses follow margins (energy prices), crop cycles (regrowth) and the re-sourcing speed of importers.
   Metrics as in Lesson 15.2: resilience loss and index, recovery time, Shannon diversity, HHI, self-sufficiency. */
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, BarChart, downloadCSV } from '/assets/js/plot.js';
import { withAlpha, colormapCSS } from '/assets/js/colors.js';
import { normCdf } from '/assets/js/stats.js';

const $ = s => document.querySelector(s);
const T = 104;              // weeks simulated (two years from week 1 of January)
const D = 100;              // demand, % of normal weekly demand
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthOf = w => MONTHS[Math.min(11, Math.floor((w % 52) / 52 * 12))];

/* ================================================================= shocks */
const STYPE = {
  drought: { label: 'Drought', col: '#f2b94b', unit: 'weeks', driver: 'weather', help: 'cuts field yields for the rest of the growing season' },
  energy: { label: 'Energy-price spike', col: '#ff7a59', unit: 'weeks', driver: 'energy', help: 'electricity and gas price × (1 + 4 × severity)' },
  trade: { label: 'Trade disruption', col: '#5cc8ef', unit: 'weeks', driver: 'trade', help: 'import capacity of the chosen origins falls by the severity' },
  labour: { label: 'Pandemic labour shortage', col: '#a792f0', unit: 'weeks', driver: 'labour', help: 'field harvest, greenhouses, vertical farms and logistics lose staff' },
  cyber: { label: 'Cyber-attack on farm IT', col: '#f07ad0', unit: 'weeks', driver: 'it', help: 'climate control of vertical farms (and partly greenhouses) goes down' },
  outage: { label: 'Storm and power cut', col: '#e6eee9', unit: 'days', driver: 'energy', help: 'a cut of 2 days or more kills the standing crop in farms without backup power' }
};
const TARGETS = { all: 'all origins', south: 'Spain & Italy', north: 'N. Europe', nonEU: 'non-EU' };
const SCEN = {
  storm: { label: 'Perfect storm (3 shocks)', shocks: [{ type: 'drought', start: 22, dur: 14, sev: 0.45, target: 'europe' }, { type: 'energy', start: 34, dur: 26, sev: 0.6 }, { type: 'trade', start: 58, dur: 6, sev: 0.7, target: 'south' }] },
  drought2018: { label: '2018-type drought', shocks: [{ type: 'drought', start: 22, dur: 14, sev: 0.45, target: 'europe' }] },
  energy2022: { label: 'Energy crisis', shocks: [{ type: 'energy', start: 32, dur: 30, sev: 0.6 }] },
  trade: { label: 'Blocked trade route', shocks: [{ type: 'trade', start: 5, dur: 6, sev: 0.8, target: 'south' }] },
  pandemic: { label: 'Pandemic spring', shocks: [{ type: 'labour', start: 11, dur: 16, sev: 0.5 }, { type: 'trade', start: 12, dur: 4, sev: 0.3, target: 'all' }] },
  cyber: { label: 'Cyber-attack', shocks: [{ type: 'cyber', start: 45, dur: 2, sev: 0.9 }] },
  power: { label: 'Storm and power cut', shocks: [{ type: 'outage', start: 48, dur: 3, sev: 0.8 }] },
  none: { label: 'No shocks', shocks: [] }
};
let shocks = JSON.parse(JSON.stringify(SCEN.storm.shocks));

/* ================================================================= origins & strategies */
const ORIG = [
  { id: 'south', label: 'Spain & Italy', col: '#f2b94b' },
  { id: 'north', label: 'Netherlands & Germany', col: '#7ee0a0' },
  { id: 'east', label: 'Poland & Baltics', col: '#c9cf6a' },
  { id: 'nonEU', label: 'Non-EU (Morocco, Kenya …)', col: '#ff8f6b' }
];
const DIV = { conc: [0.70, 0.20, 0.05, 0.05], mod: [0.50, 0.25, 0.10, 0.15], div: [0.30, 0.25, 0.20, 0.25] };
const STRATS = [
  { id: 'base', label: 'Lean baseline', p: { imp: 'conc', buf: 0, cea: 5, vfFrac: 20, backup: 0, ghHeat: 'gas' } },
  { id: 'div', label: '+ diversified imports', p: { imp: 'div' } },
  { id: 'buf', label: '+ 4-week buffer', p: { buf: 4 } },
  { id: 'cea', label: '+ local CEA 25 %', p: { cea: 25 } },
  { id: 'bak', label: '+ backup power & bio heat', p: { backup: 100, ghHeat: 'bio' } },
  { id: 'all', label: 'All combined', p: { imp: 'div', buf: 4, cea: 25, backup: 100, ghHeat: 'bio' } },
  { id: 'you', label: 'Your settings', p: null }
];

/* ================================================================= model */
const hField = w => (w >= 24 && w <= 43) ? Math.pow(Math.sin(Math.PI * (w - 23) / 21), 2) : 0; // harvest profile (R1)
const gSeason = w => 0.6 + 0.4 * (1 - Math.cos(2 * Math.PI * (w - 1) / 52)) / 2;              // greenhouse light season, mean 0.8
const N_REL = 30, N_HARV = 8;                                  // store released weeks 44–21 (30 wk), filled weeks 36–43 (8 wk)
const inStoreHarvest = w => w >= 36 && w <= 43;
function econFrac(m, F) { return 1 - normCdf((m - F) / (0.25 * F)); }                          // R6: share of farms with p* > p
const TAU_DOWN = 1, TAU_UP = 5;                                                                   // weeks: switch-off vs one crop cycle
function shockAt(s, t) { // 0..1 intensity of shock s in week t (trade recovers over 3 weeks after its end)
  const end = s.start + (s.type === 'outage' ? 1 : s.dur);
  if (t >= s.start && t < end) return s.sev;
  if (s.type === 'trade' && t >= end && t < end + 3) return s.sev * (1 - (t - end + 1) / 4);
  return 0;
}
/** Simulate T weeks. P: parameters; sh: shock list; sched: scheduled imports from the no-shock run (or null). */
function simulate(P, sh, sched) {
  const pi = DIV[P.imp];
  const cea = P.cea / 100 * D, v0 = cea * P.vfFrac / 100, g0 = cea - v0;
  const b = P.backup / 100, gas = P.ghHeat === 'gas';
  const R = { field: [], store: [], sin: [], gh: [], vf: [], imp: ORIG.map(() => []), em: [], Q: [], S: [], stock: [], buf: [], ugh: [], uvf: [], price: [], need: [], dom: [] };
  // import capacity from the no-shock peak need (R4)
  const peakNeed = sched ? Math.max(...sched) : D;
  const Mmax = (1 + P.headroom / 100) * peakNeed;
  const harvRate = P.storeShare * N_REL / N_HARV;   // storage-crop harvest per week in weeks 36–43 (R2)
  let stock = 0, B = P.buf * D, B0 = P.buf * D, ugh = 1, uvf = 1, prevExtra = 0;
  const needOut = [];
  // pre-fill the cold store as if the previous autumn had been normal (year 1 starts in steady state)
  stock = harvRate * N_HARV;
  for (let w = 44; w <= 51; w++) stock -= stock / ((52 - w) + 22);
  for (let t = 0; t < T; t++) {
    const w = t % 52, yr = Math.floor(t / 52);
    let pm = 1, fieldLoss = 0, northLoss = 0, labour = 0, cyber = 0, kill = 0; const trade = ORIG.map(() => 0);
    sh.forEach(s => {
      const k = shockAt(s, t);
      if (s.type === 'drought') {
        const sy = Math.floor(s.start / 52), sw = s.start % 52;
        if (yr === sy && sw <= 43 && t >= s.start) fieldLoss = Math.max(fieldLoss, s.sev);           // yield lost for the rest of the season
        if (s.target === 'europe' && t >= s.start && t < s.start + s.dur + 4) northLoss = Math.max(northLoss, 0.5 * s.sev);
      } else if (s.type === 'energy') pm = Math.max(pm, 1 + 4 * k);
      else if (s.type === 'trade') ORIG.forEach((o, j) => { if (s.target === 'all' || s.target === o.id) trade[j] = Math.max(trade[j], k); });
      else if (s.type === 'labour') labour = Math.max(labour, k);
      else if (s.type === 'cyber') cyber = Math.max(cyber, k);
      else if (s.type === 'outage' && t === s.start) kill = Math.max(kill, s.sev * Math.min(1, s.dur / 2));
    });
    // field and seasonal storage (R1, R2)
    const fresh = P.field * hField(w) * (1 - fieldLoss) * (1 - 0.8 * labour);
    const toStore = inStoreHarvest(w) ? harvRate * (1 - fieldLoss) * (1 - 0.8 * labour) : 0;
    stock += toStore;
    let rel = 0;
    if (w >= 44 || w <= 21) { const left = w >= 44 ? (52 - w) + 22 : 22 - w; rel = stock / Math.max(1, left); stock -= rel; }
    // controlled-environment agriculture: margins, IT and crop regrowth (R6, R7)
    const mVF = 1 + (pm - 1) * (1 - 0.3 * b), mGH = gas ? pm : 1 + 0.4 * (pm - 1);
    const tVF = Math.min(econFrac(mVF, P.safety), 1 - cyber), tGH = Math.min(econFrac(mGH, P.safety), 1 - 0.5 * cyber);
    if (kill > 0) { uvf *= 1 - kill * (1 - b); ugh *= 1 - 0.6 * kill * (1 - b); }
    uvf += (tVF - uvf) * (1 - Math.exp(-1 / (tVF < uvf ? TAU_DOWN : TAU_UP)));
    ugh += (tGH - ugh) * (1 - Math.exp(-1 / (tGH < ugh ? TAU_DOWN : TAU_UP)));
    const GH = g0 * gSeason(w) / 0.8 * ugh * (1 - 0.4 * labour);
    const VF = v0 * uvf * (1 - 0.2 * labour);
    const dom = fresh + rel + GH + VF;
    // imports: capacity per origin, contracted (scheduled) volumes and re-sourcing speed (R4, R5)
    const need = Math.max(0, D - dom); needOut.push(need);
    const cap = ORIG.map((o, j) => pi[j] * Mmax * (1 - trade[j]) * (1 - (o.id === 'north' ? northLoss : 0)) * (1 - 0.15 * labour));
    const Cap = cap.reduce((a, c) => a + c, 0);
    const s0 = sched ? sched[t] : need;
    const extraNeed = Math.max(0, need - s0);
    const extra = Math.min(extraNeed, prevExtra + P.ramp); prevExtra = extra;
    const M = Math.min(Cap, need <= s0 ? need : s0 + extra);
    // emergency buffer stock (R3)
    const gap = D - dom - M; let em = 0;
    if (gap > 0.01) { em = Math.min(gap, B, 25); B -= em; }
    else if (B < B0) { const refill = Math.min(5, B0 - B, Math.max(0, Cap - M)); B += refill; }
    const Q = Math.min(100, dom + M + em);
    R.field.push(fresh); R.store.push(rel); R.sin.push(toStore); R.gh.push(GH); R.vf.push(VF); R.em.push(em);
    ORIG.forEach((o, j) => R.imp[j].push(Cap > 0 ? M * cap[j] / Cap : 0));
    R.Q.push(Q); R.S.push(Math.max(0, 100 - Q)); R.stock.push(stock); R.buf.push(B); R.ugh.push(ugh); R.uvf.push(uvf); R.price.push(pm); R.need.push(need); R.dom.push(dom);
  }
  R.needSched = needOut;
  return R;
}
/** Metrics of a run (R8, R9 and Lesson 15.2, Eqs. 15.2.1–15.2.5). */
function metrics(R) {
  let L = 0, Qmin = 100, tMin = 0; R.S.forEach((s, t) => { L += s; if (R.Q[t] < Qmin) { Qmin = R.Q[t]; tMin = t; } });
  // shortfall episodes: consecutive weeks with shortfall > 0.5 % → recovery time
  let ep = 0, longest = 0, run = 0;
  R.S.forEach(s => { if (s > 0.5) { run++; if (run === 1) ep++; longest = Math.max(longest, run); } else run = 0; });
  // totals by source over the horizon → shares, Shannon, HHI, SSR
  const sum = a => a.reduce((x, y) => x + y, 0);
  const parts = [sum(R.field), sum(R.store), sum(R.gh), sum(R.vf), sum(R.em), ...R.imp.map(sum)];
  const tot = sum(parts); const p = parts.map(x => x / tot).filter(x => x > 1e-9);
  const H = -p.reduce((s, x) => s + x * Math.log(x), 0), HHI = p.reduce((s, x) => s + x * x, 0);
  const dom = parts[0] + parts[1] + parts[2] + parts[3];
  return { L, Phi: 1 - L / (100 * T), Qmin, tMin, depth: 100 - Qmin, episodes: ep, Tr: longest, H, D1: Math.exp(H), HHI, Neff: 1 / HHI, SSR: 100 * dom / tot, emUsed: sum(R.em) };
}
function weeklyDiversity(R, t) {
  const parts = [R.field[t], R.store[t], R.gh[t], R.vf[t], R.em[t], ...R.imp.map(a => a[t])];
  const tot = parts.reduce((a, b) => a + b, 0) || 1; let H = 0; parts.forEach(x => { const q = x / tot; if (q > 1e-9) H -= q * Math.log(q); });
  return { D1: Math.exp(H), SSR: 100 * (parts[0] + parts[1] + parts[2] + parts[3]) / tot };
}
function runScenario(P, sh) {
  const base = simulate(P, [], null);          // no-shock run → contracted import schedule
  const R = simulate(P, sh, base.needSched);
  const R0 = simulate(P, [], base.needSched);  // reference without shocks, same schedule
  return { R, R0, m: metrics(R), m0: metrics(R0) };
}

/* ================================================================= UI */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'qmin', label: 'Lowest supply to consumers', unit: '% of demand', digits: 0 })
  .add({ id: 'L', label: 'Resilience loss L', unit: '%·weeks', digits: 0 })
  .add({ id: 'phi', label: 'Resilience index Φ (104 weeks)', unit: '', digits: 3 })
  .add({ id: 'tr', label: 'Longest shortfall episode', unit: 'weeks', digits: 0 })
  .add({ id: 'ssr', label: 'Self-sufficiency ratio', unit: '%', digits: 0 })
  .add({ id: 'd1', label: 'Supply diversity e^H', unit: 'sources', digits: 2 })
  .add({ id: 'hhi', label: 'Concentration HHI', unit: '', digits: 3 })
  .add({ id: 'buf', label: 'Emergency stock released', unit: '%·weeks', digits: 0 });

ui.section('Simulation');
const [btnPlay] = ui.buttons([{ label: 'Pause', variant: 'primary', onClick: () => clock.toggle() }, { label: 'Restart', onClick: () => { clock.reset(0); } }]);
ui.slider({ id: 'speed', label: 'Speed', min: 1, max: 12, step: 0.5, value: 4, unit: 'weeks s⁻¹', persist: false });
ui.section('Shock scenario');
const shockBox = ui.html('<div id="shock-ui"></div>');
ui.section('Strategies');
ui.segmented({ id: 'imp', label: 'Import diversification', options: [{ value: 'conc', label: 'Concentrated' }, { value: 'mod', label: 'Moderate' }, { value: 'div', label: 'Diversified' }], value: 'conc', help: 'Shares of Spain & Italy / N. Europe / Poland & Baltics / non-EU: 70/20/5/5 · 50/25/10/15 · 30/25/20/25 %' });
ui.slider({ id: 'buf', label: 'Emergency buffer stock', min: 0, max: 6, step: 0.5, value: 0, unit: 'weeks of demand', help: 'A rotation stock of storable vegetables, released at up to 25 % of demand per week (R3)' });
ui.slider({ id: 'cea', label: 'Local CEA share of demand', min: 0, max: 40, step: 1, value: 5, unit: '%', help: 'Greenhouses + vertical farms, annual average in normal times' });
ui.slider({ id: 'vfFrac', label: 'of which vertical farms', min: 0, max: 100, step: 5, value: 20, unit: '%' });
ui.slider({ id: 'backup', label: 'CEA with backup power & on-site generation', min: 0, max: 100, step: 5, value: 0, unit: '%', help: 'Protects crops in power cuts; on-site generation covers 30 % of electricity at fixed cost' });
ui.segmented({ id: 'ghHeat', label: 'Greenhouse heating', options: [{ value: 'gas', label: 'Natural gas' }, { value: 'bio', label: 'Biofuel / district heat' }], value: 'gas' });
ui.section('System parameters');
ui.slider({ id: 'field', label: 'Fresh Swedish field vegetables at summer peak', min: 20, max: 80, step: 1, value: 55, unit: '% of demand' });
ui.slider({ id: 'storeShare', label: 'Stored Swedish crops in winter', min: 0, max: 40, step: 1, value: 20, unit: '% of demand', help: 'Roots, cabbage and onions harvested in September–October and sold from cold stores until early June' });
ui.slider({ id: 'headroom', label: 'Spare import capacity', min: 0, max: 40, step: 1, value: 15, unit: '%', help: 'How far importers can exceed their normal peak volume' });
ui.slider({ id: 'ramp', label: 'Re-sourcing speed of importers', min: 2, max: 30, step: 1, value: 10, unit: '% of demand per week', help: 'Adaptive capacity: how fast new suppliers can be contracted' });
ui.slider({ id: 'safety', label: 'CEA energy-price headroom p*/p₀', min: 1.2, max: 5, step: 0.1, value: 2.5, help: 'Mean ratio of break-even to normal energy price (Eq. 15.2.7); farms are heterogeneous (CV 25 %)' });
ui.presets([
  { label: 'Lean baseline', values: { imp: 'conc', buf: 0, cea: 5, vfFrac: 20, backup: 0, ghHeat: 'gas' } },
  { label: 'Diversified trade', values: { imp: 'div', buf: 0, cea: 5, backup: 0 } },
  { label: 'Buffered', values: { imp: 'conc', buf: 4, cea: 5, backup: 0 } },
  { label: 'Local CEA push', values: { imp: 'conc', buf: 0, cea: 30, vfFrac: 50, backup: 0, ghHeat: 'gas' } },
  { label: 'Resilient mix', values: { imp: 'div', buf: 4, cea: 20, vfFrac: 30, backup: 100, ghHeat: 'bio' } }
], 'Strategy presets');
ui.saveButton('resilience-simulator', () => Object.assign({}, ro.values(), { shocks: JSON.stringify(shocks) }));
ui.button({ label: 'Download weekly results (CSV)', onClick: () => {
  if (!cur) return; const R = cur.R;
  downloadCSV('resilience-simulation.csv', ['week', 'month', 'field', 'storage', 'greenhouse', 'vertical_farm', ...ORIG.map(o => 'import_' + o.id), 'emergency_stock', 'supply_Q', 'shortfall', 'energy_price_multiplier'],
    R.Q.map((q, t) => [t + 1, monthOf(t), ...[R.field[t], R.store[t], R.gh[t], R.vf[t], ...R.imp.map(a => a[t]), R.em[t], q, R.S[t], R.price[t]].map(v => +v.toFixed(2))]));
} });

/* ---------- shock editor (custom markup inside the controls) ---------- */
const box = shockBox.querySelector('#shock-ui');
box.innerHTML = `
  <div class="ctl"><div class="ctl-lab"><label for="sc-preset">Scenario</label></div><select id="sc-preset">${Object.entries(SCEN).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}<option value="custom">Custom (edited)</option></select></div>
  <div class="rs-list" id="sc-list" aria-live="polite"></div>
  <details class="rs-add"><summary>Add a shock</summary>
    <div class="ctl"><div class="ctl-lab"><label for="sc-type">Type</label></div><select id="sc-type">${Object.entries(STYPE).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}</select><div class="ctl-help" id="sc-help"></div></div>
    <div class="ctl" id="sc-target-w"><div class="ctl-lab"><label for="sc-target">Affected</label></div><select id="sc-target"></select></div>
    <div class="ctl"><div class="ctl-lab"><label for="sc-start">Start</label><output id="sc-start-o"></output></div><input id="sc-start" type="range" min="0" max="${T - 1}" step="1" value="6"></div>
    <div class="ctl"><div class="ctl-lab"><label for="sc-dur">Duration</label><output id="sc-dur-o"></output></div><input id="sc-dur" type="range" min="1" max="40" step="1" value="8"></div>
    <div class="ctl"><div class="ctl-lab"><label for="sc-sev">Severity</label><output id="sc-sev-o"></output></div><input id="sc-sev" type="range" min="0.05" max="1" step="0.05" value="0.5"></div>
    <div class="ctl-buttons"><button class="btn btn-sm btn-primary" type="button" id="sc-add">Add shock to timeline</button></div>
  </details>`;
const scType = $('#sc-type'), scTarget = $('#sc-target');
function fillRange(el) { el.style.setProperty('--fill', ((+el.value - +el.min) / (+el.max - +el.min) * 100) + '%'); }
function scOutputs() {
  const ty = scType.value;
  $('#sc-help').textContent = STYPE[ty].help;
  const tw = $('#sc-target-w'); tw.style.display = ty === 'trade' || ty === 'drought' ? '' : 'none';
  const opts = ty === 'trade' ? Object.entries(TARGETS) : [['domestic', 'Sweden only'], ['europe', 'Sweden + N. Europe (correlated)']];
  if (tw.style.display === '' && scTarget.dataset.ty !== ty) { scTarget.innerHTML = opts.map(([k, l]) => `<option value="${k}">${l}</option>`).join(''); scTarget.dataset.ty = ty; }
  const st = +$('#sc-start').value; $('#sc-start-o').textContent = `week ${st % 52 + 1}, year ${Math.floor(st / 52) + 1} (${monthOf(st)})`;
  $('#sc-dur').max = ty === 'outage' ? 10 : 40; $('#sc-dur-o').textContent = `${$('#sc-dur').value} ${STYPE[ty].unit}`;
  const sv = +$('#sc-sev').value; $('#sc-sev-o').textContent = ty === 'energy' ? `${fmt(sv * 100, 0)} % (price × ${fmt(1 + 4 * sv, 1)})` : `${fmt(sv * 100, 0)} %`;
  ['sc-start', 'sc-dur', 'sc-sev'].forEach(id => fillRange($('#' + id)));
}
['sc-type', 'sc-start', 'sc-dur', 'sc-sev'].forEach(id => $('#' + id).addEventListener('input', scOutputs));
scOutputs();
$('#sc-add').addEventListener('click', () => {
  const ty = scType.value; const s = { type: ty, start: +$('#sc-start').value, dur: +$('#sc-dur').value, sev: +$('#sc-sev').value };
  if (ty === 'trade' || ty === 'drought') s.target = scTarget.value;
  shocks.push(s); $('#sc-preset').value = 'custom'; shocksChanged();
});
$('#sc-preset').addEventListener('change', e => { if (SCEN[e.target.value]) { shocks = JSON.parse(JSON.stringify(SCEN[e.target.value].shocks)); shocksChanged(); } });
function renderShockList() {
  const L = $('#sc-list');
  if (!shocks.length) { L.innerHTML = '<div class="ctl-help">No shocks — the baseline year repeats. Add one below or pick a scenario.</div>'; return; }
  L.innerHTML = shocks.map((s, i) => `<div class="rs-item" style="--c:${STYPE[s.type].col}"><span class="rs-sw"></span><span class="rs-txt"><b>${STYPE[s.type].label}</b>${s.target ? ' · ' + (TARGETS[s.target] || (s.target === 'europe' ? 'Sweden + N. Europe' : 'Sweden')) : ''}<br>${monthOf(s.start)} yr ${Math.floor(s.start / 52) + 1} · ${s.dur} ${STYPE[s.type].unit} · ${fmt(s.sev * 100, 0)} %</span><button type="button" data-i="${i}" aria-label="Remove ${STYPE[s.type].label}">×</button></div>`).join('');
}
$('#sc-list').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b) return; shocks.splice(+b.dataset.i, 1); $('#sc-preset').value = 'custom'; shocksChanged(); });
function saveShocks() { history.replaceState(null, '', location.pathname + location.search + '#shocks=' + encodeURIComponent(JSON.stringify(shocks))); }
function loadShocks() {
  const m = location.hash.match(/shocks=([^&]+)/); if (!m) return false;
  try { const a = JSON.parse(decodeURIComponent(m[1])); if (Array.isArray(a)) { shocks = a.filter(s => STYPE[s.type]).map(s => ({ type: s.type, start: Math.max(0, Math.min(T - 1, +s.start || 0)), dur: Math.max(1, +s.dur || 1), sev: Math.max(0, Math.min(1, +s.sev || 0)), target: s.target })); return true; } } catch (e) { /* ignore */ }
  return false;
}
if (loadShocks()) $('#sc-preset').value = 'custom';
function shocksChanged() { renderShockList(); saveShocks(); schedule(); }
renderShockList();

/* ================================================================= charts */
const chSupply = new Plot('#ch-supply', { x: { label: 'Week', min: 0, max: T }, y: { label: 'Supply to consumers', unit: '% of demand', min: 0, max: 120 }, height: 300 });
const chShort = new Plot('#ch-short', { x: { label: 'Week', min: 0, max: T }, y: { label: 'Shortfall 100 − Q', unit: '%', min: 0 }, y2: { label: 'Cumulative loss L', unit: '%·weeks', min: 0 }, height: 300 });
const chStrat = new BarChart('#ch-strat', { horizontal: true, y: { label: 'Resilience loss L over two years', unit: '%·weeks', min: 0 }, height: 300, legend: false });
const chDiv = new Plot('#ch-div', { x: { label: 'Week', min: 0, max: T }, y: { label: 'Effective number of sources e^H', unit: '', min: 0 }, y2: { label: 'Self-sufficiency', unit: '%', min: 0, max: 100 }, height: 300 });
const SRC = [['field', 'Swedish field', '#7ee0a0'], ['store', 'Cold storage', '#c9cf6a'], ['gh', 'Greenhouses', '#5cc8ef'], ['vf', 'Vertical farms', '#f07ad0'], ['em', 'Emergency stock', '#e6eee9']];

/* ================================================================= stage: network graph */
const stageEl = $('#stage');
const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Animated network of the regional vegetable supply: drivers, sources, wholesale and the city, with flows scaled to supply and shocks flashing on the affected nodes');
stageEl.appendChild(cv);
const ctx = cv.getContext('2d');
const hud = hudChips(stageEl);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'food-network.png'; a.click(); } });
let W = 0, H = 0, DPR = 1;
function resize() { DPR = Math.min(window.devicePixelRatio || 1, 2); W = stageEl.clientWidth; H = stageEl.clientHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
new ResizeObserver(resize).observe(stageEl); resize();
let visible = true; new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(stageEl);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TL = 78; // timeline band height
const NODES = {
  weather: { x: 0.45, y: 0.09, label: 'Weather', kind: 'driver', icon: '☀' },
  labour: { x: 0.585, y: 0.09, label: 'Labour', kind: 'driver', icon: '⚒' },
  energy: { x: 0.72, y: 0.09, label: 'Energy', kind: 'driver', icon: '⚡' },
  it: { x: 0.855, y: 0.09, label: 'IT & cloud', kind: 'driver', icon: '⌨' },
  south: { x: 0.08, y: 0.33, label: 'Spain & Italy', kind: 'origin' },
  north: { x: 0.08, y: 0.51, label: 'NL & DE', kind: 'origin' },
  east: { x: 0.08, y: 0.69, label: 'PL & Baltics', kind: 'origin' },
  nonEU: { x: 0.08, y: 0.87, label: 'Non-EU', kind: 'origin' },
  port: { x: 0.25, y: 0.62, label: 'Ports & borders', kind: 'hub' },
  field: { x: 0.43, y: 0.33, label: 'Swedish field', kind: 'src' },
  store: { x: 0.43, y: 0.50, label: 'Cold storage', kind: 'src' },
  gh: { x: 0.43, y: 0.67, label: 'Greenhouses', kind: 'src' },
  vf: { x: 0.43, y: 0.84, label: 'Vertical farms', kind: 'src' },
  dc: { x: 0.66, y: 0.58, label: 'Wholesale & DC', kind: 'hub' },
  city: { x: 0.87, y: 0.58, label: 'City households', kind: 'city' }
};
const DEPS = [['weather', 'field'], ['weather', 'north'], ['labour', 'field'], ['labour', 'gh'], ['labour', 'vf'], ['labour', 'dc'], ['energy', 'gh'], ['energy', 'vf'], ['energy', 'store'], ['it', 'vf'], ['it', 'gh']];
const pt = (id, gw, gh) => [NODES[id].x * gw, 16 + NODES[id].y * (gh - 22)];
const flowP = {};            // flow particles per link
let cur = null, tDisp = 0, lastNow = performance.now(), dragging = null;
function lerpArr(a, t) { const i = Math.max(0, Math.min(T - 1, Math.floor(t))), j = Math.min(T - 1, i + 1), f = Math.max(0, Math.min(1, t - i)); return a[i] + (a[j] - a[i]) * f; }
function drivers(t) {
  const d = { weather: 0, labour: 0, energy: 0, it: 0, trade: 0 };
  shocks.forEach(s => { const k = shockAt(s, Math.floor(t)) || (s.type === 'drought' && t >= s.start && t < s.start + s.dur ? s.sev : 0); if (k > 0) d[STYPE[s.type].driver] = Math.max(d[STYPE[s.type].driver], k); });
  return d;
}
function linkPath(a, b, gw, gh) { const [x0, y0] = pt(a, gw, gh), [x1, y1] = pt(b, gw, gh); const mx = (x0 + x1) / 2; return [x0, y0, mx, y0, mx, y1, x1, y1]; }
function bez(P, u) { const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] = P; const v = 1 - u; return [v * v * v * x0 + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u * u * u * x1, v * v * v * y0 + 3 * v * v * u * c1y + 3 * v * u * u * c2y + u * u * u * y1]; }
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastNow) / 1000); lastNow = now;
  if (!visible || document.hidden || !cur || !W) return;
  draw(dt, now / 1000);
}
function draw(dt, time) {
  const R = cur.R; const t = Math.min(T - 1, tDisp);
  const gw = W, gh = H - TL;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const bg = ctx.createRadialGradient(W * 0.55, gh * 0.5, 20, W * 0.5, gh * 0.5, W * 0.8); bg.addColorStop(0, '#12211b'); bg.addColorStop(1, '#070c0a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const v = {
    field: lerpArr(R.field, t), store: lerpArr(R.store, t), sin: lerpArr(R.sin, t), gh: lerpArr(R.gh, t), vf: lerpArr(R.vf, t), em: lerpArr(R.em, t), Q: lerpArr(R.Q, t),
    imp: R.imp.map(a => lerpArr(a, t)), stock: lerpArr(R.stock, t), buf: lerpArr(R.buf, t), ugh: lerpArr(R.ugh, t), uvf: lerpArr(R.uvf, t)
  };
  const impTot = v.imp.reduce((a, b) => a + b, 0);
  const dr = drivers(t);
  const flows = [
    ...ORIG.map((o, j) => [o.id, 'port', v.imp[j], o.col]), ['port', 'dc', impTot, '#9fb2a8'],
    ['field', 'dc', v.field, '#7ee0a0'], ['field', 'store', v.sin, '#c9cf6a'], ['store', 'dc', v.store + v.em, '#c9cf6a'], ['gh', 'dc', v.gh, '#5cc8ef'], ['vf', 'dc', v.vf, '#f07ad0'], ['dc', 'city', v.Q, '#e6eee9']
  ];
  // dependency links (dashed); red and pulsing when the driver is shocked
  ctx.lineWidth = 1;
  DEPS.forEach(([a, b]) => {
    if (b === 'north' && !shocks.some(s => s.type === 'drought' && s.target === 'europe')) return;
    const P = linkPath(a, b, gw, gh); const hit = dr[a] > 0;
    ctx.setLineDash([3, 5]); ctx.strokeStyle = hit ? `rgba(255,107,90,${0.45 + 0.4 * Math.sin(time * 6)})` : 'rgba(185,200,192,.16)'; ctx.lineWidth = hit ? 1.6 : 1;
    ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.bezierCurveTo(P[2], P[3], P[4], P[5], P[6], P[7]); ctx.stroke(); ctx.setLineDash([]);
    if (hit && !reduceMotion) { const u = (time * 0.7) % 1; const [px, py] = bez(P, u); ctx.fillStyle = 'rgba(255,107,90,.9)'; ctx.beginPath(); ctx.arc(px, py, 2.6, 0, 7); ctx.fill(); }
  });
  // flow links, width ∝ flow
  flows.forEach(([a, b, f, col]) => {
    if (f < 0.05) return; const P = linkPath(a, b, gw, gh);
    ctx.strokeStyle = withAlpha(col, 0.28); ctx.lineWidth = Math.max(1, Math.sqrt(f) * 2.4);
    ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.bezierCurveTo(P[2], P[3], P[4], P[5], P[6], P[7]); ctx.stroke();
  });
  // flow particles
  if (!reduceMotion) flows.forEach(([a, b, f, col], k) => {
    if (f < 0.05) return; const key = a + b; const acc = (flowP[key] = flowP[key] || { acc: Math.random(), list: [] });
    acc.acc += dt * f * 0.09; while (acc.acc > 1) { acc.acc -= 1; acc.list.push(0); }
    const P = linkPath(a, b, gw, gh); ctx.fillStyle = col;
    for (let i = acc.list.length - 1; i >= 0; i--) { acc.list[i] += dt * 0.42; if (acc.list[i] >= 1) { acc.list.splice(i, 1); continue; } const [px, py] = bez(P, acc.list[i]); ctx.beginPath(); ctx.arc(px, py, 2.1, 0, 7); ctx.fill(); }
    void k;
  });
  // nodes
  const loss = { field: 1 - v.field / Math.max(1e-6, lerpArr(cur.R0.field, t)), gh: 1 - v.ugh, vf: 1 - v.uvf };
  const tradeHit = {}; shocks.forEach(s => { if (s.type === 'trade') { const k = shockAt(s, Math.floor(t)); if (k > 0) ORIG.forEach(o => { if (s.target === 'all' || s.target === o.id) tradeHit[o.id] = Math.max(tradeHit[o.id] || 0, k); }); } if (s.type === 'drought' && s.target === 'europe' && t >= s.start && t < s.start + s.dur + 4) tradeHit.north = Math.max(tradeHit.north || 0, 0.5 * s.sev); });
  Object.entries(NODES).forEach(([id, n]) => {
    const [x, y] = pt(id, gw, gh);
    let val = 0, col = '#9fb2a8', hit = 0;
    if (n.kind === 'origin') { const j = ORIG.findIndex(o => o.id === id); val = v.imp[j]; col = ORIG[j].col; hit = tradeHit[id] || 0; }
    else if (id === 'port') { val = impTot; col = '#9fb2a8'; hit = Math.max(0, ...Object.values(tradeHit)); }
    else if (id === 'field') { val = v.field; col = '#7ee0a0'; hit = shocks.some(s => (s.type === 'drought' && t >= s.start && Math.floor(t / 52) === Math.floor(s.start / 52) && t % 52 <= 43) || (s.type === 'labour' && shockAt(s, Math.floor(t)) > 0)) ? Math.max(0.3, loss.field) : 0; }
    else if (id === 'store') { val = v.store + v.em; col = '#c9cf6a'; }
    else if (id === 'gh') { val = v.gh; col = '#5cc8ef'; hit = loss.gh > 0.02 ? loss.gh : 0; }
    else if (id === 'vf') { val = v.vf; col = '#f07ad0'; hit = loss.vf > 0.02 ? loss.vf : 0; }
    else if (id === 'dc') { val = v.Q; col = '#e6eee9'; hit = dr.labour > 0 ? dr.labour * 0.5 : 0; }
    if (n.kind === 'driver') {
      const k = dr[id === 'it' ? 'it' : id]; const r = 17;
      if (k > 0) { const pr = (time * 1.2) % 1; ctx.strokeStyle = `rgba(255,107,90,${0.8 * (1 - pr)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 4 + pr * 16, 0, 7); ctx.stroke(); }
      ctx.fillStyle = k > 0 ? `rgba(255,107,90,${0.35 + 0.25 * Math.sin(time * 6)})` : 'rgba(255,255,255,.06)';
      ctx.beginPath(); for (let q = 0; q < 6; q++) { const a = Math.PI / 6 + q * Math.PI / 3; ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); } ctx.closePath(); ctx.fill();
      ctx.strokeStyle = k > 0 ? '#ff6b5a' : 'rgba(185,200,192,.4)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#e6eee9'; ctx.font = '13px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(n.icon, x, y + 5);
      ctx.font = '600 10.5px Inter, sans-serif'; ctx.fillStyle = k > 0 ? '#ffb4a8' : 'rgba(185,200,192,.85)'; ctx.fillText(n.label + (k > 0 ? ` · ${fmt(100 * k, 0)} %` : ''), x, y + r + 14); ctx.textAlign = 'left';
      return;
    }
    if (n.kind === 'city') {
      const r = Math.min(58, gh * 0.13); const q = v.Q / 100;
      ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      ctx.lineWidth = 9; ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.arc(x, y, r - 6, 0, 7); ctx.stroke();
      ctx.strokeStyle = colormapCSS('rdylgn', Math.max(0, Math.min(1, (q - 0.6) / 0.4))); ctx.beginPath(); ctx.arc(x, y, r - 6, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * q); ctx.stroke();
      // city skyline
      ctx.fillStyle = 'rgba(230,238,233,.18)'; [[-26, 14, 10, 22], [-14, 14, 9, 30], [-3, 14, 11, 18], [9, 14, 8, 26], [18, 14, 9, 14]].forEach(([dx, dy, w, h]) => ctx.fillRect(x + dx, y + dy - h, w, h));
      ctx.fillStyle = '#e6eee9'; ctx.textAlign = 'center'; ctx.font = '700 17px JetBrains Mono, monospace'; ctx.fillText(`${fmt(v.Q, 0)} %`, x, y - 2);
      ctx.font = '600 10px Inter, sans-serif'; ctx.fillStyle = 'rgba(185,200,192,.9)'; ctx.fillText('supply to consumers', x, y + 26); ctx.fillText(n.label, x, y + r + 16); ctx.textAlign = 'left';
      return;
    }
    const r = 7 + 3.1 * Math.sqrt(Math.max(0, val));
    if (hit > 0.02) { const pr = (time * 1.4) % 1; ctx.fillStyle = `rgba(255,107,90,${0.18 + 0.4 * Math.min(1, hit)})`; ctx.beginPath(); ctx.arc(x, y, r + 7 + 3 * Math.sin(time * 5), 0, 7); ctx.fill(); ctx.strokeStyle = `rgba(255,107,90,${(1 - pr) * 0.7})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + 6 + pr * 12, 0, 7); ctx.stroke(); }
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 1, x, y, r); g.addColorStop(0, withAlpha(col, 0.95)); g.addColorStop(1, withAlpha(col, 0.35));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.strokeStyle = withAlpha(col, 0.95); ctx.lineWidth = 1.2; ctx.stroke();
    if (id === 'store') { // stock gauge: seasonal store + emergency buffer
      const cap = Math.max(50, cur.P.storeShare * N_REL + cur.P.buf * 100); const f1 = Math.min(1, v.stock / cap), f2 = Math.min(1 - f1, v.buf / cap);
      const gx = x + r + 8, gy = y - 16; ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(gx, gy, 7, 32);
      ctx.fillStyle = '#c9cf6a'; ctx.fillRect(gx, gy + 32 * (1 - f1), 7, 32 * f1); ctx.fillStyle = '#e6eee9'; ctx.fillRect(gx, gy + 32 * (1 - f1 - f2), 7, 32 * f2);
    }
    ctx.textAlign = n.kind === 'origin' ? 'left' : 'center';
    const lx = n.kind === 'origin' ? x - 30 : x, ly = n.kind === 'origin' ? y - r - 8 : y + r + 14;
    ctx.fillStyle = 'rgba(230,238,233,.92)'; ctx.font = '600 10.5px Inter, sans-serif'; ctx.fillText(n.label, n.kind === 'origin' ? Math.max(6, lx) : lx, ly);
    ctx.font = '500 10px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(185,200,192,.9)';
    const sub = id === 'gh' || id === 'vf' ? `${fmt(val, 1)} % · run ${fmt(100 * (id === 'gh' ? v.ugh : v.uvf), 0)} %` : id === 'store' ? `${fmt(val, 1)} % · stock ${fmt(v.stock / 100, 1)}+${fmt(v.buf / 100, 1)} wk` : `${fmt(val, 1)} %`;
    ctx.fillText(sub, n.kind === 'origin' ? Math.max(6, lx) : lx, ly + 12); ctx.textAlign = 'left';
  });
  drawTimeline(t, time);
}
function drawTimeline(t, time) {
  const R = cur.R; const x0 = 44, x1 = W - 16, y0 = H - TL + 8, y1 = H - 10; const X = w => x0 + (x1 - x0) * w / T;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, H - TL, W, TL); ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.moveTo(0, H - TL + 0.5); ctx.lineTo(W, H - TL + 0.5); ctx.stroke();
  // month grid
  ctx.lineWidth = 1; ctx.setLineDash([]);
  ctx.font = '500 9px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(185,200,192,.7)'; ctx.textAlign = 'center';
  for (let m = 0; m < 24; m++) { const w = m * 52 / 12; const xx = X(w); ctx.strokeStyle = m % 12 === 0 ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.moveTo(xx, y0); ctx.lineTo(xx, y1); ctx.stroke(); ctx.fillText(MONTHS[m % 12][0], X(w + 52 / 24), y1 + 1); }
  ctx.textAlign = 'left'; ctx.fillText('Yr 1', 4, y0 + 8); ctx.fillText('Yr 2', 4, y0 + 20);
  // supply sparkline (Q) as a band
  const top = y0 + 2, bot = y1 - 12, Y = q => bot - (bot - top) * Math.max(0, Math.min(1, (q - 40) / 60));
  ctx.beginPath(); ctx.moveTo(X(0), Y(100)); for (let k = 0; k < T; k++) ctx.lineTo(X(k + 0.5), Y(R.Q[k])); ctx.lineTo(X(T), Y(100)); ctx.closePath(); ctx.fillStyle = 'rgba(255,107,90,.45)'; ctx.fill();
  ctx.strokeStyle = 'rgba(126,224,160,.9)'; ctx.lineWidth = 1.3; ctx.beginPath(); for (let k = 0; k < T; k++) { const xx = X(k + 0.5), yy = Y(R.Q[k]); k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); } ctx.stroke();
  // shock bars
  shocks.forEach((s, i) => { const d = s.type === 'outage' ? 1 : s.dur; const bx = X(s.start), bw = Math.max(4, X(s.start + d) - bx); const by = top + (i % 3) * 7; ctx.fillStyle = withAlpha(STYPE[s.type].col, dragging && dragging.i === i ? 0.95 : 0.7); ctx.fillRect(bx, by, bw, 5.5); });
  // cursor
  const cx = X(t + 0.5); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, y0 - 4); ctx.lineTo(cx, y1 - 8); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(cx - 5, y0 - 6); ctx.lineTo(cx + 5, y0 - 6); ctx.lineTo(cx, y0); ctx.fill();
  void time;
}
/* timeline interaction: drag the cursor to scrub, drag a shock bar to move it */
function tlHit(e) {
  const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
  if (y < H - TL) return null; const x0 = 44, x1 = W - 16; const w = (x - x0) / (x1 - x0) * T;
  const top = H - TL + 10; const i = shocks.findIndex((s, k) => { const d = s.type === 'outage' ? 1 : s.dur; const by = top + (k % 3) * 7; return w >= s.start - 0.5 && w <= s.start + d + 0.5 && y >= by - 2 && y <= by + 8; });
  return { w: Math.max(0, Math.min(T - 1, w)), i };
}
function scrubTo(w) { clock.reset(w); tDisp = w; updateCursor(); }
cv.addEventListener('pointerdown', e => { const h = tlHit(e); if (!h) return; cv.setPointerCapture(e.pointerId); if (h.i >= 0) dragging = { i: h.i, off: h.w - shocks[h.i].start }; else { dragging = { scrub: true }; clock.pause(); scrubTo(h.w); } });
cv.addEventListener('pointermove', e => {
  if (!dragging) return;
  const h = tlHit({ clientX: e.clientX, clientY: Math.max(e.clientY, cv.getBoundingClientRect().top + H - TL + 12) }); if (!h) return;
  if (dragging.scrub) scrubTo(h.w);
  else { shocks[dragging.i].start = Math.round(Math.max(0, Math.min(T - 1, h.w - dragging.off))); $('#sc-preset').value = 'custom'; renderShockList(); schedule(); }
});
cv.addEventListener('pointerup', () => { if (dragging && !dragging.scrub) saveShocks(); dragging = null; });
requestAnimationFrame(frame);

/* ================================================================= clock */
const clock = new SimClock({ speed: 4, onStep: () => {}, onFrame: t => { if (t >= T) { clock.reset(0); } tDisp = clock.t; updateCursor(); } });
clock.onState(run => { btnPlay.textContent = run ? 'Pause' : 'Play'; });
let cursorT = -1;
function updateCursor() {
  if (!cur) return; const t = Math.min(T - 1, Math.floor(tDisp)); if (t === cursorT) return; cursorT = t;
  const R = cur.R;
  hud.set('time', `Year <b>${Math.floor(t / 52) + 1}</b> · week <b>${t % 52 + 1}</b> · ${monthOf(t)}`);
  const imp = R.imp.reduce((s, a) => s + a[t], 0), wd = weeklyDiversity(R, t);
  hud.set('q', `Supply <b>${fmt(R.Q[t], 0)} %</b> · imports <b>${fmt(imp, 0)} %</b> · SSR <b>${fmt(wd.SSR, 0)} %</b>`);
  [chSupply, chShort, chDiv].forEach(p => p.vline('now', t + 0.5, { color: 'ink', dash: [3, 3], width: 1 }));
}

/* ================================================================= update */
let raf = 0;
function paramsFrom(v) { return { imp: v.imp, buf: v.buf, cea: v.cea, vfFrac: v.vfFrac, backup: v.backup, ghHeat: v.ghHeat, field: v.field, storeShare: v.storeShare, headroom: v.headroom, ramp: v.ramp, safety: v.safety }; }
function update() {
  const v = ui.values(); clock.speed = v.speed;
  const P = paramsFrom(v);
  const S = runScenario(P, shocks); cur = Object.assign(S, { P });
  const { R, m } = S;
  ro.set('qmin', m.Qmin, m.Qmin >= 97 ? 'ok' : m.Qmin >= 85 ? 'warn' : 'bad', m.depth > 0.5 ? `ΔQ = ${fmt(m.depth, 0)} points, week ${m.tMin % 52 + 1} of year ${Math.floor(m.tMin / 52) + 1}` : 'no shortfall');
  ro.set('L', m.L, m.L < 20 ? 'ok' : m.L < 150 ? 'warn' : 'bad', 'area of the resilience triangle(s)');
  ro.set('phi', m.Phi, m.Phi >= 0.99 ? 'ok' : m.Phi >= 0.97 ? 'warn' : 'bad');
  ro.set('tr', m.Tr, m.Tr <= 2 ? 'ok' : m.Tr <= 8 ? 'warn' : 'bad', m.episodes ? `${m.episodes} episode${m.episodes > 1 ? 's' : ''} with shortfall > 0.5 %` : 'no shortfall');
  ro.set('ssr', m.SSR, null, `without shocks ${fmt(S.m0.SSR, 0)} %`);
  ro.set('d1', m.D1, m.D1 >= 4 ? 'ok' : m.D1 >= 2.5 ? 'warn' : 'bad', `Shannon H = ${fmt(m.H, 2)}`);
  ro.set('hhi', m.HHI, m.HHI < 0.15 ? 'ok' : m.HHI < 0.25 ? 'warn' : 'bad', m.HHI < 0.15 ? 'low concentration' : m.HHI < 0.25 ? 'medium' : 'high concentration');
  ro.set('buf', m.emUsed, null, P.buf ? `of ${fmt(P.buf * 100, 0)} %·weeks held` : 'no emergency stock');
  // supply stacked areas
  const xs = R.Q.map((_, t) => t + 0.5);
  let acc = new Array(T).fill(0);
  const layers = [...SRC.map(([k, lab, col]) => [lab, R[k], col]), ...ORIG.map((o, j) => ['Imports: ' + o.label.split(' (')[0], R.imp[j], o.col])];
  layers.forEach(([lab, arr, col], k) => { const lo = acc.slice(); acc = acc.map((a, t) => a + arr[t]); chSupply.band('b' + k, xs, lo, acc, { color: col, alpha: 0.55, label: lab }); });
  chSupply.line('dem', [0, T], [100, 100], { color: 'ink', width: 1.2, dash: [4, 4], label: 'Demand', noTip: true });
  chSupply.line('q', xs, R.Q, { color: 'ink', width: 1.8, label: 'Supply Q', step: false });
  shocks.forEach((s, i) => chSupply.region('s' + i, s.start, s.start + (s.type === 'outage' ? 1 : s.dur), { color: STYPE[s.type].col, alpha: 0.08 }));
  for (let i = shocks.length; i < 12; i++) chSupply.remove('s' + i);
  // shortfall & cumulative loss
  let cum = 0; const cumL = R.S.map(s => (cum += s));
  chShort.line('S', xs, R.S, { color: 'danger', width: 2, fill: 0.25, label: 'Shortfall', step: true });
  chShort.line('S0', xs, S.R0.S, { color: 'muted', width: 1.2, dash: [3, 3], label: 'No-shock reference' });
  chShort.line('L', xs, cumL, { color: 'amber', width: 2, y2: true, label: 'Cumulative L' });
  shocks.forEach((s, i) => chShort.region('s' + i, s.start, s.start + (s.type === 'outage' ? 1 : s.dur), { color: STYPE[s.type].col, alpha: 0.1 }));
  for (let i = shocks.length; i < 12; i++) chShort.remove('s' + i);
  // diversity and SSR per week
  const wd = xs.map((_, t) => weeklyDiversity(R, t));
  chDiv.line('d1', xs, wd.map(d => d.D1), { color: 'water', width: 2, label: 'Effective sources e^H' });
  chDiv.line('ssr', xs, wd.map(d => d.SSR), { color: 'accent', width: 2, y2: true, label: 'Self-sufficiency (%)' });
  // strategy comparison under the same shocks
  const base = Object.assign({}, P, STRATS[0].p);
  const rows = STRATS.map(st => { const PP = st.p ? Object.assign({}, base, st.p) : P; const r = runScenario(PP, shocks).m; return [st.label, r]; });
  const maxL = Math.max(10, ...rows.map(r => r[1].L)); chStrat.y.max = maxL * 1.3;
  chStrat.set(rows.map(r => r[0]), [{ label: 'Resilience loss', values: rows.map(r => Math.max(r[1].L, maxL * 0.004)), colors: rows.map((r, i) => i === rows.length - 1 ? 'magenta' : i === 0 ? 'danger' : 'water'), format: v => `${fmt(v < maxL * 0.005 ? 0 : v, 0)} %·wk` }]);
  cursorT = -1; updateCursor();
}
ui.onChange((s, id) => { if (id === 'speed') { clock.speed = s.speed; return; } schedule(); });
function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); }
update();
clock.play();
window.__res = { simulate, runScenario, metrics, get cur() { return cur; }, get shocks() { return shocks; }, set shocks(v) { shocks = v; schedule(); }, STRATS, DIV };
