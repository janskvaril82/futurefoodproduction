/* ==========================================================================
   Plant factory energy and water balance — UI, animated schematic, animated
   Sankey diagrams and charts. The physics lives in ./model.js (Eqs. PF1–PF11).
   ========================================================================== */
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, BarChart, Sankey, linspace, downloadCSV } from '/assets/js/plot.js';
import { palette, withAlpha } from '/assets/js/colors.js';
import { solarElevation } from '/assets/js/physics.js';
import { compute, CLIMATES, GRIDS, CO2SRC, MONTHS, DAYS, F_C, C_OUT } from './model.js';

/* ------------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'yield', label: 'Marketable yield', unit: 't yr⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'kwhkg', label: 'Electricity per kg (fresh weight)', unit: 'kWh kg⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'kwhmol', label: 'Electricity per mol of photons at the canopy', unit: 'kWh mol⁻¹', digits: 3, note: '&nbsp;' })
  .add({ id: 'etot', label: 'Annual electricity', unit: 'MWh yr⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'scop', label: 'Seasonal cooling COP', unit: '', digits: 2, note: '&nbsp;' })
  .add({ id: 'latent', label: 'Latent share of the cooling load', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'water', label: 'Fresh water per kg', unit: 'L kg⁻¹', digits: 2, note: '&nbsp;' })
  .add({ id: 'co2', label: 'CO₂ supplied per kg', unit: 'g kg⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'foot', label: 'Carbon footprint (energy + CO₂)', unit: 'kg CO₂e kg⁻¹', digits: 2, note: '&nbsp;' })
  .add({ id: 'chem', label: 'Electricity stored in the crop', unit: '%', digits: 2, note: '&nbsp;' });

ui.section('Location and building');
ui.select({ id: 'site', label: 'Outdoor climate', options: Object.entries(CLIMATES).map(([value, c]) => ({ value, label: c.label })), value: 'vasteras', help: 'Monthly climate normals (see Assumptions & sources)' });
ui.slider({ id: 'floor', label: 'Growing-room floor area', min: 30, max: 5000, step: 10, value: 500, unit: 'm²' });
ui.slider({ id: 'tiers', label: 'Number of tiers', min: 1, max: 15, step: 1, value: 6, help: 'Room height = 1.0 m + 0.45 m per tier' });
ui.slider({ id: 'rack', label: 'Floor share covered by trays', min: 0.3, max: 0.9, step: 0.01, value: 0.6, help: 'The rest is aisles and equipment' });
ui.slider({ id: 'U', label: 'Envelope U-value', min: 0.1, max: 3, step: 0.01, value: 0.25, unit: 'W m⁻² K⁻¹', log: true, digits: 2, help: 'Insulated sandwich panels 0.1–0.3 · uninsulated container ≈ 2–3' });
ui.slider({ id: 'leak', label: 'Air leakage', min: 0.005, max: 1, step: 0.001, value: 0.02, unit: 'h⁻¹', log: true, digits: 3, help: 'Airtight plant factory 0.01–0.02 h⁻¹ (Kozai, 2013)' });
ui.section('Room climate set-points');
ui.slider({ id: 'tin', label: 'Air temperature', min: 16, max: 28, step: 0.5, value: 22, unit: '°C' });
ui.slider({ id: 'rh', label: 'Relative humidity', min: 50, max: 90, step: 1, value: 70, unit: '%' });
ui.slider({ id: 'co2', label: 'CO₂ set-point', min: 427, max: 2000, step: 10, value: 1000, unit: 'µmol mol⁻¹', help: 'Outdoor air 427 µmol mol⁻¹; yield follows Eq. 8.3.2 of Lesson 8.3' });
ui.section('Lighting');
ui.segmented({ id: 'lmode', label: 'Specify the light by', options: [{ value: 'ppfd', label: 'Target PPFD' }, { value: 'power', label: 'LED power density' }], value: 'ppfd' });
ui.slider({ id: 'ppfd', label: 'PPFD at the canopy', min: 50, max: 600, step: 5, value: 250, unit: 'µmol m⁻² s⁻¹' });
ui.slider({ id: 'pd', label: 'LED power per m² of trays', min: 20, max: 300, step: 1, value: 90, unit: 'W m⁻²' });
ui.slider({ id: 'photo', label: 'Photoperiod', min: 8, max: 24, step: 0.5, value: 16, unit: 'h d⁻¹' });
ui.slider({ id: 'start', label: 'Lamps switch on at', min: 0, max: 23, step: 1, value: 6, unit: '', format: v => String(v).padStart(2, '0') + ':00', help: 'Lighting at night uses cooler outdoor air for the condensers' });
ui.slider({ id: 'eff', label: 'Photon efficacy', min: 1.5, max: 4.0, step: 0.05, value: 3.0, unit: 'µmol J⁻¹', help: 'HPS ≈ 1.7 · 2020 LED ≈ 2.7–3.0 · best 2024 LED ≈ 3.5 (Kusuma et al., 2020)' });
ui.slider({ id: 'util', label: 'Photons reaching the canopy', min: 0.5, max: 1, step: 0.01, value: 0.9, help: 'Utilisation factor: fraction of emitted PAR incident on the trays' });
ui.slider({ id: 'absorb', label: 'Canopy absorptance', min: 0.5, max: 0.95, step: 0.01, value: 0.85, help: 'Fraction of incident PAR absorbed by a closed lettuce canopy' });
ui.slider({ id: 'aux', label: 'Pumps, fans and controls', min: 0, max: 30, step: 1, value: 10, unit: '% of LED energy' });
ui.section('Crop');
ui.slider({ id: 'lue', label: 'Light-use efficiency', min: 0.2, max: 1.0, step: 0.01, value: 0.55, unit: 'g DW mol⁻¹', help: 'Shoot dry weight per mol of incident photons at 1000 µmol mol⁻¹ CO₂; vertical-farm mean 0.55 (Jin et al., 2023)' });
ui.slider({ id: 'dmc', label: 'Dry-matter content', min: 3, max: 8, step: 0.1, value: 5, unit: '%' });
ui.slider({ id: 'mkt', label: 'Marketable share of the harvest', min: 0.5, max: 1, step: 0.01, value: 0.9, help: 'After trimming, grading and losses' });
ui.segmented({ id: 'tmode', label: 'Transpiration', options: [{ value: 'pm', label: 'Penman–Monteith' }, { value: 'fixed', label: 'Prescribed' }], value: 'pm' });
ui.slider({ id: 'gs', label: 'Canopy stomatal conductance (light)', min: 2, max: 40, step: 0.5, value: 15, unit: 'mm s⁻¹', help: 'Bulk surface conductance of the canopy; 10 % of it at night' });
ui.slider({ id: 'ga', label: 'Aerodynamic conductance', min: 5, max: 60, step: 1, value: 20, unit: 'mm s⁻¹', help: 'Rises with the air speed over the canopy' });
ui.slider({ id: 'et', label: 'Prescribed transpiration', min: 0.2, max: 5, step: 0.1, value: 2, unit: 'L m⁻² d⁻¹' });
ui.section('HVAC');
ui.segmented({ id: 'copMode', label: 'Cooling COP', options: [{ value: 'climate', label: 'From outdoor climate' }, { value: 'fixed', label: 'Fixed values' }], value: 'climate', help: 'Carnot-fraction model of Lesson 7.2 (η = 0.40, condenser 15 K above outdoor air, capped at 10)' });
ui.segmented({ id: 'coil', label: 'Coil arrangement', options: [{ value: 'single', label: 'One cold coil' }, { value: 'split', label: 'Split sensible / latent' }], value: 'single', help: 'A dry sensible coil can run just above the dew point, a dehumidifying coil must run below it' });
ui.toggle({ id: 'reheat', label: 'Reuse condenser heat for reheat', value: true, help: 'When dehumidification cools the room below its set-point, the heat pump releases its condenser heat indoors instead of buying heat' });
ui.slider({ id: 'cops', label: 'COP for sensible heat', min: 1.5, max: 10, step: 0.1, value: 4.5 });
ui.slider({ id: 'copl', label: 'COP for latent heat (dehumidification)', min: 1.5, max: 10, step: 0.1, value: 3.5 });
ui.section('Water');
ui.slider({ id: 'rec', label: 'Condensate returned to the tank', min: 0, max: 100, step: 1, value: 97, unit: '%' });
ui.slider({ id: 'bleed', label: 'Nutrient solution discharged', min: 0, max: 30, step: 0.5, value: 3, unit: '% of uptake', help: 'Periodic bleed to control salts and pathogens' });
ui.section('Carbon footprint');
ui.select({ id: 'grid', label: 'Electricity grid', options: Object.entries(GRIDS).map(([value, g]) => ({ value, label: g.label })), value: 'se', help: 'Life-cycle intensity 2025, Ember via Our World in Data' });
ui.slider({ id: 'efCustom', label: 'Custom grid factor', min: 0, max: 1000, step: 5, value: 100, unit: 'g CO₂e kWh⁻¹' });
ui.select({ id: 'co2src', label: 'Source of the dosed CO₂', options: Object.entries(CO2SRC).map(([value, s]) => ({ value, label: s.label })), value: 'byproduct', help: 'Emission factor per kg supplied, Lesson 8.3 Eq. 8.3.9' });
ui.section('Display');
ui.segmented({ id: 'basis', label: 'Sankey diagrams show', options: [{ value: 'total', label: 'Whole facility per year' }, { value: 'perkg', label: 'Per kg of lettuce' }], value: 'total' });
ui.select({ id: 'month', label: 'Month shown in the schematic', options: MONTHS.map((m, i) => ({ value: String(i), label: m })), value: '0' });
ui.toggle({ id: 'yearRun', label: 'Advance one month per simulated day', value: false });
const playBtns = ui.buttons([
  { label: '❚❚ Pause', variant: 'primary', onClick: () => clock.toggle() },
  { label: 'CSV (monthly)', onClick: () => exportCSV() }
]);
ui.segmented({ id: 'speed', label: 'Simulation speed', options: [{ value: 1800, label: '1 h / 2 s' }, { value: 7200, label: '1 h / 0.5 s' }, { value: 28800, label: '1 h / 0.12 s' }], value: 7200, persist: false });
ui.presets([
  { label: 'Swedish plant factory', values: { site: 'vasteras', floor: 500, tiers: 6, rack: 0.6, U: 0.25, leak: 0.02, tin: 22, rh: 70, co2: 1000, lmode: 'ppfd', ppfd: 250, photo: 16, start: 6, eff: 3.0, util: 0.9, absorb: 0.85, aux: 10, lue: 0.55, dmc: 5, mkt: 0.9, tmode: 'pm', gs: 15, ga: 20, copMode: 'climate', coil: 'single', reheat: true, rec: 97, bleed: 3, grid: 'se' } },
  { label: 'Kiruna, 68° N', values: { site: 'kiruna', U: 0.25, leak: 0.02, start: 6 } },
  { label: 'Desert, lights at night', values: { site: 'abudhabi', start: 18, U: 0.25, leak: 0.02 } },
  { label: 'Humid tropics', values: { site: 'singapore', start: 6, U: 0.25, leak: 0.02 } },
  { label: 'Leaky container farm', values: { floor: 30, tiers: 4, rack: 0.5, U: 2.5, leak: 0.3, site: 'vasteras' } },
  { label: 'Best-in-class 2026', values: { eff: 3.5, util: 0.95, absorb: 0.9, lue: 0.7, aux: 6, coil: 'split', rec: 99, bleed: 1 } },
  { label: 'Old HPS-lit room', values: { eff: 1.7, util: 0.8, lue: 0.45, aux: 12, co2: 800 } },
  { label: 'Dry room (55 % RH)', values: { rh: 55, tmode: 'pm' } }
]);
ui.saveButton('plant-factory-balance', () => ro.values());

/* ------------------------------------------------------------------ state */
let R = null;            // latest model result
let P = null;            // latest parameters
function params() { const v = ui.values(); return Object.assign({}, v, { month: +v.month }); }
function syncEnabled(v) {
  ui.enable('ppfd', v.lmode === 'ppfd'); ui.enable('pd', v.lmode === 'power');
  ui.enable('gs', v.tmode === 'pm'); ui.enable('ga', v.tmode === 'pm'); ui.enable('et', v.tmode === 'fixed');
  ui.enable('cops', v.copMode === 'fixed'); ui.enable('copl', v.copMode === 'fixed'); ui.enable('coil', v.copMode === 'climate');
  ui.enable('efCustom', v.grid === 'custom');
}

/* ------------------------------------------------------------------ charts (Sankeys animate their flows: flow: true) */
const skE = new Sankey('#chart-energy', { unit: 'MWh', height: 480, digits: 0, gap: 20, flow: true });
const skW = new Sankey('#chart-water', { unit: 'm³', height: 340, digits: 0, gap: 26, flow: true });
const skC = new Sankey('#chart-co2', { unit: 't', height: 300, digits: 1, gap: 18, flow: true });
const monthly = new BarChart('#chart-monthly', { y: { label: 'Electricity', unit: 'MWh', min: 0 }, stacked: true });
const latPlot = new Plot('#chart-latent', { x: { label: 'Daily transpiration', unit: 'L m⁻² d⁻¹', min: 0, max: 5 }, y: { label: 'Heat removed by the coils', unit: 'MWh yr⁻¹', min: 0 }, y2: { label: 'Latent share', unit: '%', min: 0, max: 100 } });
const grm = new BarChart('#chart-graamans', { y: { label: 'Purchased energy per kg of dry weight', unit: 'kWh kg⁻¹', min: 0 }, horizontal: true, legend: false });

function sankeyEnergy(r, perkg) {
  const k = r.kWh, s = perkg ? 1 / r.fwMkt : 1 / 1000;   // kWh → kWh kg⁻¹  or  MWh
  skE.opts.unit = perkg ? 'kWh kg⁻¹' : 'MWh'; skE.opts.digits = perkg ? 2 : 0;
  // 7 columns: sources · consumers · light/heat · canopy & room air · transpiration · coils & losses · sinks
  const n = [
    { id: 'grid', label: 'Grid electricity', color: 'amber', col: 0 },
    { id: 'amb', label: 'From outdoors', color: '#8a9c92', col: 0 },
    { id: 'recS', label: 'Reheat (recovered)', color: 'danger', col: 0 },
    { id: 'led', label: 'LED fixtures', color: 'magenta', col: 1 },
    { id: 'aux', label: 'Pumps, fans', color: 'c4', col: 1 },
    { id: 'comp', label: 'Compressors', color: 'water', col: 1 },
    { id: 'hp', label: 'Heating', color: 'danger', col: 1 },
    { id: 'par', label: 'PAR light', color: 'magenta', col: 2 },
    { id: 'fixh', label: 'Fixture heat', color: 'c5', col: 2 },
    { id: 'can', label: 'Canopy', color: 'accent', col: 3 },
    { id: 'air', label: 'Room air', color: 'c5', col: 3 },
    { id: 'lat', label: 'Transpiration', color: 'water', col: 4 },
    { id: 'coilL', label: 'Coil, latent', color: 'water', col: 5 },
    { id: 'coilS', label: 'Coil, sensible', color: 'c5', col: 5 },
    { id: 'env', label: 'Envelope loss', color: '#8a9c92', col: 5 },
    { id: 'vleak', label: 'Leaked vapour', color: '#8a9c92', col: 5 },
    { id: 'chem', label: 'Stored in crop', color: 'accent', col: 6 },
    { id: 'rej', label: 'Rejected outdoors', color: 'danger', col: 6 },
    { id: 'recK', label: 'Reused as reheat', color: 'danger', col: 6 }
  ];
  const L = [
    ['grid', 'led', r.E.led], ['grid', 'aux', r.E.aux], ['grid', 'comp', r.E.hvac], ['grid', 'hp', r.E.heat],
    ['amb', 'hp', k.Qamb], ['amb', 'air', k.envGain], ['amb', 'coilL', k.latIn],
    ['led', 'par', k.parEmit], ['led', 'fixh', k.fix],
    ['par', 'can', k.parAbs], ['par', 'air', k.missRefl],
    ['can', 'chem', k.chem], ['can', 'lat', k.c2l], ['can', 'coilS', Math.min(k.HcPos, k.Qs)],
    ['fixh', 'air', k.fix], ['aux', 'air', r.E.aux], ['hp', 'air', k.Qheat],
    ['air', 'lat', k.HcNeg], ['air', 'coilS', Math.max(0, k.Qs - k.HcPos)], ['air', 'env', k.envLoss],
    ['lat', 'coilL', k.Ql - k.latIn], ['lat', 'vleak', k.latLeak]
  ];
  // recovered condenser heat (reheat) is drawn as a matching source/sink pair, like the recycled water
  const rL = Math.min(k.Qrec, k.Ql), rS = Math.min(k.Qrec - rL, k.Qs), rC = Math.max(0, k.Qrec - rL - rS);
  L.push(['coilL', 'rej', k.Ql - rL], ['coilS', 'rej', k.Qs - rS], ['comp', 'rej', r.E.hvac - rC],
    ['coilL', 'recK', rL], ['coilS', 'recK', rS], ['comp', 'recK', rC], ['recS', 'air', k.Qrec]);
  const used = new Set(); const links = [];
  L.forEach(([a, b, v]) => { const val = v * s; if (val > 1e-9 * (perkg ? 1 : 1000) && val > 0) { links.push({ source: a, target: b, value: val }); used.add(a); used.add(b); } });
  skE.set({ nodes: n.filter(x => used.has(x.id)), links });
}
function sankeyWater(r, perkg) {
  const w = r.water, s = perkg ? 1 / r.fwMkt : 1 / 1000;  // kg → L kg⁻¹  or m³
  skW.opts.unit = perkg ? 'L kg⁻¹' : 'm³'; skW.opts.digits = perkg ? 2 : 0;
  // 4 columns: sources · solution · uses · fates. "Condensed on the coil" = back to tank + discarded.
  const n = [
    { id: 'fresh', label: 'Fresh water', color: 'water', col: 0 },
    { id: 'rc', label: 'Recycled condensate', color: 'accent', col: 0 },
    { id: 'sol', label: 'Nutrient solution', color: 'water', col: 1 },
    { id: 'outv', label: 'Vapour from outdoors', color: '#8a9c92', col: 1 },
    { id: 'tr', label: 'Transpired', color: 'water', col: 2 },
    { id: 'pl', label: 'In harvested plants', color: 'accent', col: 3 },
    { id: 'bl', label: 'Discharged', color: 'danger', col: 3 },
    { id: 'vl', label: 'Lost in leaking air', color: '#8a9c92', col: 3 },
    { id: 'back', label: 'Condensed → tank', color: 'accent', col: 3 },
    { id: 'disc', label: 'Condensed → drain', color: 'danger', col: 3 }
  ];
  const fT = w.condT / Math.max(1e-9, w.condT + w.condOut);   // share of the condensate that came from transpiration
  const L = [
    ['fresh', 'sol', w.irrig - w.recyc], ['rc', 'sol', w.recyc], ['fresh', 'vl', w.humid],
    ['sol', 'tr', w.trans], ['sol', 'pl', w.Wplant], ['sol', 'bl', w.bleed],
    ['tr', 'back', w.recyc * fT], ['tr', 'disc', w.discard * fT], ['tr', 'vl', w.vapLeak - w.humid],
    ['outv', 'back', w.recyc * (1 - fT)], ['outv', 'disc', w.discard * (1 - fT)]
  ];
  const used = new Set(); const links = [];
  L.forEach(([a, b, v]) => { const val = v * s; if (val > 0) { links.push({ source: a, target: b, value: val }); used.add(a); used.add(b); } });
  skW.set({ nodes: n.filter(x => used.has(x.id)), links });
}
function sankeyCO2(r, perkg) {
  const c = r.co2, s = perkg ? 1000 / r.fwMkt : 1 / 1000;   // kg → g kg⁻¹  or t
  skC.opts.unit = perkg ? 'g kg⁻¹' : 't'; skC.opts.digits = perkg ? 0 : 1;
  const mktCO2 = r.dwMkt * F_C * 44 / 12;     // kg CO₂ in marketable dry matter
  const nodes = [
    { id: 'sup', label: 'CO₂ supplied', color: 'c3', col: 0 },
    { id: 'fix', label: 'Fixed by the crop', color: 'accent', col: 1 },
    { id: 'lk', label: 'Leaked with air exchange', color: 'danger', col: 2 },
    { id: 'mk', label: 'In marketable lettuce', color: 'accent', col: 2 },
    { id: 'rt', label: 'In roots and trimmings', color: 'c7', col: 2 }
  ];
  skC.set({ nodes, links: [
    { source: 'sup', target: 'fix', value: c.fix * s }, { source: 'sup', target: 'lk', value: c.leak * s },
    { source: 'fix', target: 'mk', value: mktCO2 * s }, { source: 'fix', target: 'rt', value: Math.max(0, c.fix - mktCO2) * s }
  ] });
}
function monthlyChart(r) {
  const tw = x => x / 3.6e9;  // J → MWh
  monthly.set(MONTHS, [
    { label: 'LED lighting', values: r.months.map(m => tw(m.Eled)), color: 'magenta' },
    { label: 'Pumps, fans, controls', values: r.months.map(m => tw(m.Eaux)), color: 'c4' },
    { label: 'Cooling and dehumidification', values: r.months.map(m => tw(m.Ehvac)), color: 'water' },
    { label: 'Heating', values: r.months.map(m => tw(m.Eheat)), color: 'danger' }
  ]);
}
let latT = null;
function latentChart(p) {
  clearTimeout(latT);
  latT = setTimeout(() => {
    const xs = linspace(0.1, 5, 30); const Ls = [], Ss = [], Ts = [], sh = [];
    xs.forEach(e => { const q = compute(Object.assign({}, p, { tmode: 'fixed', et: e })); Ls.push(q.kWh.Ql / 1000); Ss.push(q.kWh.Qs / 1000); Ts.push((q.kWh.Ql + q.kWh.Qs) / 1000); sh.push(100 * q.latentShare); });
    latPlot.line('tot', xs, Ts, { color: 'ink', dash: [5, 4], width: 1.6, label: 'Total coil load' });
    latPlot.line('lat', xs, Ls, { color: 'water', width: 2.4, label: 'Latent (condensation)' });
    latPlot.line('sen', xs, Ss, { color: 'amber', width: 2.4, label: 'Sensible' });
    latPlot.line('sh', xs, sh, { color: 'magenta', width: 2, y2: true, label: 'Latent share (right axis)' });
    latPlot.vline('now', R.etDay, { color: 'accent', label: 'this room' });
  }, 160);
}
function graamansChart(r) {
  grm.set(['This plant factory (model)', 'Plant factory (Graamans et al.)', 'Greenhouse, Netherlands', 'Greenhouse, UAE', 'Greenhouse, Sweden + lamps', 'Greenhouse, Sweden, no lamps'],
    [{ label: 'kWh kg⁻¹ DW', values: [r.kWhPerKgDW, 247, 70, 111, 182, 211], colors: ['magenta', 'amber', 'accent', 'accent', 'accent', 'accent'], format: v => fmt(v, 0) }]);
}

/* ------------------------------------------------------------------ stage: animated schematic */
const stageEl = document.getElementById('stage');
const cv = document.createElement('canvas'); stageEl.appendChild(cv);
const ctx = cv.getContext('2d');
const hud = hudChips(stageEl);
hud.el.style.flexDirection = 'row'; hud.el.style.flexWrap = 'wrap'; hud.el.style.maxWidth = '72%';
const legend = document.createElement('div'); legend.className = 'stage-legend'; stageEl.appendChild(legend);
legend.innerHTML = [['#ffc2ec', 'photons'], ['#5cc8ef', 'water vapour'], ['#4a8cff', 'condensate'], ['#ff9a4d', 'heat'], ['#c9d4cf', 'CO₂']]
  .map(([c, l]) => `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:10px"><i style="width:8px;height:8px;border-radius:50%;background:${c};display:inline-block"></i>${l}</span>`).join('');
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'plant-factory-balance.png'; a.click(); } });
let W = 0, H = 0, DPR = 1;
function resize() { DPR = Math.min(2, devicePixelRatio || 1); W = stageEl.clientWidth; H = stageEl.clientHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
new ResizeObserver(resize).observe(stageEl); resize();
let stageVisible = true; new IntersectionObserver(es => { stageVisible = es[0].isIntersecting; }).observe(stageEl);

const COL = { photon: '#ffc2ec', vap: '#5cc8ef', cond: '#4a8cff', heat: '#ff9a4d', co2: '#c9d4cf', leaf: '#6fd39a', leafD: '#2f8a55', frame: '#3a4a43', line: '#5d7168', ink: '#e6eee9', muted: '#9fb2a8' };
const FONT = (s, w = 600) => `${w} ${s}px Inter, system-ui, sans-serif`;
const MONO = s => `500 ${s}px 'JetBrains Mono', ui-monospace, monospace`;
const X = f => f * W, Y = f => f * H;
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function label(txt, x, y, { size = 11, color = COL.ink, align = 'left', weight = 600, bg = true } = {}) {
  ctx.font = FONT(size, weight); const w = ctx.measureText(txt).width;
  const bx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  if (bg) { ctx.fillStyle = 'rgba(8,14,12,0.72)'; rr(bx - 5, y - size + 1, w + 10, size + 7, 5); ctx.fill(); }
  ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(txt, bx, y + 2);
}
function sub(txt, x, y, color = COL.muted, align = 'left', size = 10) { ctx.font = MONO(size); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(txt, x, y); }

/* particles */
const STARS = Array.from({ length: 46 }, (_, i) => [((i * 0.6180339) % 1), 0.02 + ((i * 0.3819661 * 7) % 1) * 0.15, 0.5 + (i % 3) * 0.35]);
let parts = [];
const spawnAcc = {};
function spawn(kind, rate, dt, fn) { spawnAcc[kind] = (spawnAcc[kind] || 0) + rate * dt; while (spawnAcc[kind] >= 1) { spawnAcc[kind] -= 1; if (parts.length < 900) parts.push(fn()); } }
const rnd = (a, b) => a + Math.random() * (b - a);

/* layout (fractions of W, H) */
const Lb = { x0: 0.105, x1: 0.765, y0: 0.19, y1: 0.885 };   // building
const RK = { x0: 0.215, x1: 0.555, top: 0.265, bot: 0.87 }; // racks
const AHU = { x0: 0.595, x1: 0.735, y0: 0.25, y1: 0.5 };
const TANK = { x0: 0.12, x1: 0.19, y0: 0.73, y1: 0.87 };
const CTK = { x0: 0.61, x1: 0.72, y0: 0.76, y1: 0.87 };
const CND = { x0: 0.8, x1: 0.965, y0: 0.63, y1: 0.885 };
const CO2T = { x0: 0.028, x1: 0.07, y0: 0.56, y1: 0.885 };

function tierY(i, n) { const pitch = (RK.bot - RK.top) / n; const base = RK.bot - i * pitch; return { base, pitch, tray: base - 0.05 * pitch, led: base - 0.9 * pitch }; }

function interpHour(month, hf, p) {
  const hs = R.months[month].hourly; const h0 = Math.floor(hf) % 24, h1 = (h0 + 1) % 24, t = hf - Math.floor(hf);
  const o = Object.assign({}, hs[h0]);                                // hourly means (step), except the smooth outdoor temperature
  o.To = hs[h0].To + (hs[h1].To - hs[h0].To) * t;
  o.on = p.photo >= 24 || ((hf - p.start + 48) % 24) < p.photo;     // lamps on right now?
  return o;
}

let simMonth = 0, lastDay = 0, fanPhase = 0, condFan = 0;
function drawStage(tSim, dtReal) {
  if (!R || !W) return;
  const p = R.p;
  const hf = (tSim / 3600) % 24;
  const day = Math.floor(tSim / 86400);
  if (p.yearRun && day !== lastDay) { simMonth = (simMonth + 1) % 12; lastDay = day; ui.set('month', String(simMonth), true); }
  if (!p.yearRun) { simMonth = p.month; lastDay = day; }
  const m = simMonth, s = interpHour(m, hf, p);
  const clim = CLIMATES[p.site];
  const doy = Math.round([15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349][m]);
  const elev = solarElevation(clim.lat, doy, hf);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
  /* sky */
  const e = Math.max(-0.3, Math.min(1, elev / 0.6));
  const sky = ctx.createLinearGradient(0, 0, 0, Y(0.9));
  const dayMix = Math.max(0, Math.min(1, (elev + 0.1) / 0.35));
  sky.addColorStop(0, `rgb(${Math.round(8 + 40 * dayMix)},${Math.round(14 + 70 * dayMix)},${Math.round(24 + 110 * dayMix)})`);
  sky.addColorStop(1, `rgb(${Math.round(12 + 60 * dayMix)},${Math.round(20 + 80 * dayMix)},${Math.round(26 + 90 * dayMix)})`);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, Y(0.9));
  // stars at night, sun or moon on a track between the HUD and the roof
  if (dayMix < 0.6) { ctx.fillStyle = `rgba(230,240,255,${0.7 * (1 - dayMix / 0.6)})`; STARS.forEach(([a, b, r]) => { ctx.beginPath(); ctx.arc(X(a), Y(b), r, 0, 7); ctx.fill(); }); }
  const az = ((hf - 12) / 12);              // −1 … 1 across the sky
  const sx = X(0.5 + 0.44 * az), sy = Y(0.175 - 0.07 * Math.max(0, Math.sin(Math.max(0, elev))));
  if (elev > -0.03) { const g = ctx.createRadialGradient(sx, sy, 2, sx, sy, 28); g.addColorStop(0, 'rgba(255,236,170,0.95)'); g.addColorStop(1, 'rgba(255,200,90,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 28, 0, 7); ctx.fill(); ctx.fillStyle = '#ffe9a6'; ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 7); ctx.fill(); }
  else { const mx = X(0.9), my = Y(0.14); ctx.fillStyle = 'rgba(220,230,255,0.9)'; ctx.beginPath(); ctx.arc(mx, my, 6.5, 0, 7); ctx.fill(); ctx.fillStyle = `rgb(${Math.round(8 + 40 * dayMix)},${Math.round(14 + 70 * dayMix)},${Math.round(30 + 110 * dayMix)})`; ctx.beginPath(); ctx.arc(mx + 3, my - 2, 5.8, 0, 7); ctx.fill(); }
  // ground
  ctx.fillStyle = '#1a231f'; ctx.fillRect(0, Y(0.885), W, H - Y(0.885));
  ctx.fillStyle = '#243029'; ctx.fillRect(0, Y(0.885), W, 3);
  /* building */
  const bx0 = X(Lb.x0), bx1 = X(Lb.x1), by0 = Y(Lb.y0), by1 = Y(Lb.y1), wt = Math.max(6, W * 0.011);
  const glowIn = s.on ? 1 : 0;
  ctx.fillStyle = glowIn ? '#101b17' : '#0c1411'; ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
  // insulated walls (hatched)
  ctx.fillStyle = '#c9cfc7'; ctx.globalAlpha = 0.18;
  ctx.fillRect(bx0 - wt, by0 - wt, wt, by1 - by0 + wt); ctx.fillRect(bx1, by0 - wt, wt, by1 - by0 + wt); ctx.fillRect(bx0 - wt, by0 - wt, bx1 - bx0 + 2 * wt, wt);
  ctx.globalAlpha = 1; ctx.strokeStyle = '#78897f'; ctx.lineWidth = 1.2; ctx.strokeRect(bx0 - wt, by0 - wt, bx1 - bx0 + 2 * wt, by1 - by0 + wt); ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
  ctx.save(); ctx.beginPath(); ctx.rect(bx0 - wt, by0 - wt, bx1 - bx0 + 2 * wt, wt); ctx.rect(bx0 - wt, by0, wt, by1 - by0); ctx.rect(bx1, by0, wt, by1 - by0); ctx.clip();
  ctx.strokeStyle = 'rgba(200,210,200,0.25)'; ctx.lineWidth = 1; for (let x = bx0 - wt - H; x < bx1 + H; x += 7) { ctx.beginPath(); ctx.moveTo(x, by0 - wt); ctx.lineTo(x + H, by1 + H); ctx.stroke(); }
  ctx.restore();
  // heat flux through the envelope: arrows sized by |Qenv|
  const envKW = s.envNet / 1000;
  /* racks */
  const nT = p.tiers, rx0 = X(RK.x0), rx1 = X(RK.x1);
  ctx.strokeStyle = COL.line; ctx.lineWidth = 2; [rx0, rx1, (rx0 + rx1) / 2].forEach(x => { ctx.beginPath(); ctx.moveTo(x, Y(RK.top) - 4); ctx.lineTo(x, Y(RK.bot) + 2); ctx.stroke(); });
  const ppfdVis = Math.min(1, R.Lg.ppfd / 450);
  for (let i = 0; i < nT; i++) {
    const t = tierY(i, nT); const yT = Y(t.tray), yL = Y(t.led), ph = Y(t.pitch) - Y(0);
    // tray
    ctx.fillStyle = '#d7dcd6'; ctx.globalAlpha = 0.55; ctx.fillRect(rx0, yT, rx1 - rx0, Math.max(2, ph * 0.05)); ctx.globalAlpha = 1;
    // light cone
    if (s.on) {
      const g = ctx.createLinearGradient(0, yL, 0, yT); g.addColorStop(0, `rgba(255,120,220,${0.18 + 0.25 * ppfdVis})`); g.addColorStop(1, 'rgba(255,120,220,0.02)');
      ctx.fillStyle = g; ctx.fillRect(rx0 + 2, yL + 2, rx1 - rx0 - 4, yT - yL - 2);
    }
    // LED bar
    ctx.fillStyle = s.on ? `rgba(255,${Math.round(190 + 40 * ppfdVis)},245,1)` : '#39433e';
    ctx.fillRect(rx0 + 4, yL - 2, rx1 - rx0 - 8, Math.max(2, ph * 0.035));
    if (s.on) { ctx.shadowColor = '#ff7ad9'; ctx.shadowBlur = 10; ctx.fillRect(rx0 + 4, yL - 2, rx1 - rx0 - 8, 2); ctx.shadowBlur = 0; }
    // plants (lettuce heads)
    const nP = Math.max(5, Math.round((rx1 - rx0) / Math.max(12, ph * 0.55)));
    const pr = Math.min((rx1 - rx0) / nP * 0.46, ph * 0.3);
    for (let j = 0; j < nP; j++) {
      const cx = rx0 + (j + 0.5) * (rx1 - rx0) / nP, cy = yT - 1;
      ctx.fillStyle = COL.leafD; ctx.beginPath(); ctx.ellipse(cx, cy, pr, pr * 0.8, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = COL.leaf; ctx.beginPath(); ctx.ellipse(cx - pr * 0.15, cy - pr * 0.12, pr * 0.72, pr * 0.58, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = s.on ? '#c8f5d6' : '#8fd0a8'; ctx.beginPath(); ctx.ellipse(cx - pr * 0.28, cy - pr * 0.3, pr * 0.3, pr * 0.22, 0, Math.PI, 0); ctx.fill();
    }
    // irrigation stub
    ctx.strokeStyle = 'rgba(92,200,239,0.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(0.2), yT + 1); ctx.lineTo(rx0 + 2, yT + 1); ctx.stroke();
  }
  // irrigation riser from the tank
  ctx.strokeStyle = 'rgba(92,200,239,0.7)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(X(0.2), Y(TANK.y0) + 6); ctx.lineTo(X(0.2), Y(tierY(nT - 1, nT).tray)); ctx.stroke();
  /* nutrient tank */
  rr(X(TANK.x0), Y(TANK.y0), X(TANK.x1) - X(TANK.x0), Y(TANK.y1) - Y(TANK.y0), 6); ctx.fillStyle = '#16232a'; ctx.fill(); ctx.strokeStyle = '#5a7280'; ctx.stroke();
  ctx.fillStyle = 'rgba(28,120,163,0.8)'; ctx.fillRect(X(TANK.x0) + 3, Y(TANK.y0) + (Y(TANK.y1) - Y(TANK.y0)) * 0.3, X(TANK.x1) - X(TANK.x0) - 6, (Y(TANK.y1) - Y(TANK.y0)) * 0.7 - 3);
  sub('nutrient', X((TANK.x0 + TANK.x1) / 2), Y(TANK.y0) - 12, COL.muted, 'center', 9.5); sub('tank', X((TANK.x0 + TANK.x1) / 2), Y(TANK.y0) - 2, COL.muted, 'center', 9.5);
  /* air-handling unit */
  const ax0 = X(AHU.x0), ax1 = X(AHU.x1), ay0 = Y(AHU.y0), ay1 = Y(AHU.y1);
  rr(ax0, ay0, ax1 - ax0, ay1 - ay0, 8); ctx.fillStyle = '#18231f'; ctx.fill(); ctx.strokeStyle = '#6f8479'; ctx.lineWidth = 1.4; ctx.stroke();
  // coil fins
  const coilLoad = (s.Qs + s.Ql) / Math.max(1, R.peakCool * 1000);
  for (let i = 0; i < 9; i++) { const x = ax0 + (ax1 - ax0) * (0.14 + i * 0.08); ctx.strokeStyle = `rgba(92,200,239,${0.35 + 0.6 * coilLoad})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, ay0 + (ay1 - ay0) * 0.52); ctx.lineTo(x, ay0 + (ay1 - ay0) * 0.86); ctx.stroke(); }
  sub('cooling coil', (ax0 + ax1) / 2, ay0 + (ay1 - ay0) * 0.98, COL.muted, 'center', 9.5);
  // fan
  fanPhase += dtReal * (4 + 10 * coilLoad);
  const fx = (ax0 + ax1) / 2, fy = ay0 + (ay1 - ay0) * 0.28, fr = Math.min(ax1 - ax0, ay1 - ay0) * 0.17;
  ctx.strokeStyle = '#9fb2a8'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(fx, fy, fr, 0, 7); ctx.stroke();
  for (let k = 0; k < 4; k++) { const a = fanPhase + k * Math.PI / 2; ctx.fillStyle = 'rgba(200,215,208,0.7)'; ctx.beginPath(); ctx.ellipse(fx + Math.cos(a) * fr * 0.5, fy + Math.sin(a) * fr * 0.5, fr * 0.45, fr * 0.16, a, 0, 7); ctx.fill(); }
  // condensate tray, drain and tank
  ctx.fillStyle = '#5a6f66'; ctx.fillRect(ax0 + 6, ay1 + 2, ax1 - ax0 - 12, 3);
  ctx.strokeStyle = 'rgba(74,140,255,0.8)'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo((ax0 + ax1) / 2, ay1 + 5); ctx.lineTo((ax0 + ax1) / 2, Y(CTK.y0)); ctx.stroke();
  rr(X(CTK.x0), Y(CTK.y0), X(CTK.x1) - X(CTK.x0), Y(CTK.y1) - Y(CTK.y0), 6); ctx.fillStyle = '#16232a'; ctx.fill(); ctx.strokeStyle = '#5a7280'; ctx.stroke();
  const condDay = R.months[m].hourly.reduce((a, q) => a + q.cond * 3600, 0) / 1000;  // m³ per day
  ctx.fillStyle = 'rgba(74,140,255,0.75)'; ctx.fillRect(X(CTK.x0) + 3, Y(CTK.y0) + (Y(CTK.y1) - Y(CTK.y0)) * 0.45, X(CTK.x1) - X(CTK.x0) - 6, (Y(CTK.y1) - Y(CTK.y0)) * 0.55 - 3);
  sub('condensate', X((CTK.x0 + CTK.x1) / 2), Y(CTK.y0) - 2, COL.muted, 'center', 9.5);
  // return pipe condensate → nutrient tank along the floor
  ctx.strokeStyle = 'rgba(111,211,154,0.6)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.lineDashOffset = -tSim / 400 * (p.rec / 100);
  ctx.beginPath(); ctx.moveTo(X(CTK.x0), Y(0.862)); ctx.lineTo(X(TANK.x1), Y(0.862)); ctx.stroke(); ctx.setLineDash([]);
  // supply air arrows from the AHU over the racks
  ctx.strokeStyle = 'rgba(160,210,255,0.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 6]); ctx.lineDashOffset = tSim / 300;
  for (let i = 0; i < 3; i++) { const y = Y(RK.top + (RK.bot - RK.top) * (0.15 + 0.3 * i)); ctx.beginPath(); ctx.moveTo(ax0 - 2, Y(AHU.y0 + 0.05)); ctx.bezierCurveTo(X(0.575), y, X(0.56), y, X(0.53), y + 4); ctx.stroke(); }
  ctx.setLineDash([]);
  /* refrigerant lines to the outdoor condenser */
  const cx0 = X(CND.x0), cx1 = X(CND.x1), cy0 = Y(CND.y0), cy1 = Y(CND.y1);
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,154,77,0.8)'; ctx.beginPath(); ctx.moveTo(ax1, ay0 + 14); ctx.lineTo(bx1 + wt + 10, ay0 + 14); ctx.lineTo(bx1 + wt + 10, cy0 + 10); ctx.lineTo(cx0, cy0 + 10); ctx.stroke();
  ctx.strokeStyle = 'rgba(92,200,239,0.8)'; ctx.beginPath(); ctx.moveTo(ax1, ay0 + 26); ctx.lineTo(bx1 + wt + 18, ay0 + 26); ctx.lineTo(bx1 + wt + 18, cy0 + 24); ctx.lineTo(cx0, cy0 + 24); ctx.stroke();
  rr(cx0, cy0, cx1 - cx0, cy1 - cy0, 8); ctx.fillStyle = '#1f2925'; ctx.fill(); ctx.strokeStyle = '#7d8f86'; ctx.lineWidth = 1.2; ctx.stroke();
  condFan += dtReal * (3 + 14 * coilLoad);
  const ccx = (cx0 + cx1) / 2, ccy = (cy0 + cy1) / 2 - 4, cr = Math.min(cx1 - cx0, cy1 - cy0) * 0.3;
  ctx.strokeStyle = '#9fb2a8'; ctx.beginPath(); ctx.arc(ccx, ccy, cr, 0, 7); ctx.stroke();
  for (let k = 0; k < 3; k++) { const a = condFan + k * 2.094; ctx.fillStyle = 'rgba(200,215,208,0.6)'; ctx.beginPath(); ctx.ellipse(ccx + Math.cos(a) * cr * 0.5, ccy + Math.sin(a) * cr * 0.5, cr * 0.46, cr * 0.17, a, 0, 7); ctx.fill(); }
  sub('condenser', ccx, cy1 - 5, COL.muted, 'center', 9.5);
  /* CO₂ tank */
  const tx0 = X(CO2T.x0), tx1 = X(CO2T.x1), ty0 = Y(CO2T.y0), ty1 = Y(CO2T.y1);
  const tg = ctx.createLinearGradient(tx0, 0, tx1, 0); tg.addColorStop(0, '#46514c'); tg.addColorStop(0.5, '#8b9892'); tg.addColorStop(1, '#3a443f');
  rr(tx0, ty0, tx1 - tx0, ty1 - ty0, (tx1 - tx0) / 2); ctx.fillStyle = tg; ctx.fill();
  sub('CO₂', (tx0 + tx1) / 2, ty0 + 18, '#0d1512', 'center', 10);
  ctx.strokeStyle = 'rgba(201,212,207,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo((tx0 + tx1) / 2, ty0); ctx.lineTo((tx0 + tx1) / 2, Y(0.5)); ctx.lineTo(X(0.14), Y(0.5)); ctx.stroke();
  /* ---------------- particles ---------------- */
  const dt = Math.min(0.05, dtReal);
  const lit = s.on;
  // photons
  if (lit) spawn('ph', 70 * ppfdVis * nT / 6 + 10, dt, () => { const i = Math.floor(Math.random() * nT); const t = tierY(i, nT); return { k: 'ph', x: rnd(rx0 + 6, rx1 - 6), y: Y(t.led) + 3, vy: rnd(90, 140), y1: Y(t.tray) - 6, life: 1 }; });
  // vapour from canopy to AHU
  const etRate = s.ET / Math.max(1e-9, R.A * 3.5e-5);  // relative to ≈ 3 L m⁻² d⁻¹ lit rate
  spawn('vap', 26 * Math.min(2, etRate) * Math.min(1.6, nT / 6 + 0.4), dt, () => { const i = Math.floor(Math.random() * nT); const t = tierY(i, nT); return { k: 'vap', x: rnd(rx0 + 8, rx1 - 8), y: Y(t.tray) - 8, vx: rnd(30, 60), vy: rnd(-22, -6), tx: rnd(ax0 + 4, ax1 - 4), ty: rnd(ay0 + (ay1 - ay0) * 0.55, ay1 - 6), life: 1 }; });
  // condensate drops
  const cRate = s.cond / Math.max(1e-9, R.A * 3.5e-5);
  spawn('cd', 8 * Math.min(2, cRate), dt, () => ({ k: 'cd', x: (ax0 + ax1) / 2 + rnd(-2, 2), y: ay1 + 6, vy: rnd(60, 90), y1: Y(CTK.y0) + 6, life: 1 }));
  // heat: into the coil, along the hot line, then released above the condenser
  const heatRate = (s.Qs + s.Ql + s.Ehvac) / Math.max(1, R.peakCool * 1000);
  spawn('ht', 22 * heatRate, dt, () => ({ k: 'ht', seg: 0, x: ax1, y: ay0 + 14, life: 1 }));
  // heating at night (heat pump in heating mode): red glow
  // CO₂ molecules circulating inside (density ∝ set-point)
  const nCO2target = Math.round(18 + 42 * (p.co2 / 2000));
  const nCO2 = parts.filter(q => q.k === 'co2').length;
  if (nCO2 < nCO2target) parts.push({ k: 'co2', x: X(0.14), y: Y(0.5), vx: rnd(10, 40), vy: rnd(-20, 20), life: 1 });
  // leak at the left wall ∝ leakage
  spawn('lk', 3 * Math.min(4, p.leak / 0.02), dt, () => ({ k: 'lk', x: bx0 + 2, y: Y(0.27) + rnd(-4, 4), vx: -rnd(20, 40), vy: rnd(-6, 6), life: 1 }));
  const next = []; let keptCO2 = 0;
  for (const q of parts) {
    if (q.k === 'ph') { q.y += q.vy * dt; if (q.y < q.y1) { ctx.fillStyle = COL.photon; ctx.globalAlpha = 0.85; ctx.fillRect(q.x, q.y, 1.6, 4); next.push(q); } }
    else if (q.k === 'vap') { const dx = q.tx - q.x, dy = q.ty - q.y, d = Math.hypot(dx, dy); q.x += (q.vx * 0.3 + dx / Math.max(1, d) * 55) * dt; q.y += (q.vy * 0.4 + dy / Math.max(1, d) * 40) * dt + Math.sin((q.x + tSim / 50) * 0.08) * 0.3; if (d > 6) { ctx.fillStyle = COL.vap; ctx.globalAlpha = 0.75; ctx.beginPath(); ctx.arc(q.x, q.y, 1.8, 0, 7); ctx.fill(); next.push(q); } }
    else if (q.k === 'cd') { q.y += q.vy * dt; if (q.y < q.y1) { ctx.fillStyle = COL.cond; ctx.globalAlpha = 0.95; ctx.beginPath(); ctx.ellipse(q.x, q.y, 1.8, 2.6, 0, 0, 7); ctx.fill(); next.push(q); } }
    else if (q.k === 'ht') {
      const v = 120 * dt; const px = bx1 + wt + 10, pyD = cy0 + 10;
      if (q.seg === 0) { q.x += v; if (q.x >= px) { q.x = px; q.seg = 1; } }
      else if (q.seg === 1) { q.y += v; if (q.y >= pyD) { q.y = pyD; q.seg = 2; } }
      else if (q.seg === 2) { q.x += v; if (q.x >= ccx) { q.seg = 3; q.vx = rnd(-15, 15); } }
      else { q.y -= 45 * dt; q.x += q.vx * dt + Math.sin(q.y * 0.08) * 0.4; q.life -= dt * 0.45; }
      if (q.life > 0 && q.y > Y(0.02)) { ctx.fillStyle = COL.heat; ctx.globalAlpha = Math.max(0, Math.min(1, q.life)); ctx.beginPath(); ctx.arc(q.x, q.y, 2, 0, 7); ctx.fill(); next.push(q); }
    }
    else if (q.k === 'co2') {
      q.x += q.vx * dt; q.y += q.vy * dt; q.vx += rnd(-30, 30) * dt; q.vy += rnd(-30, 30) * dt; q.vx *= 0.995; q.vy *= 0.995;
      if (q.x < bx0 + 4) { q.x = bx0 + 4; q.vx = Math.abs(q.vx); } if (q.x > ax0 - 4) { q.x = ax0 - 4; q.vx = -Math.abs(q.vx); }
      if (q.y < by0 + 4) { q.y = by0 + 4; q.vy = Math.abs(q.vy); } if (q.y > by1 - 6) { q.y = by1 - 6; q.vy = -Math.abs(q.vy); }
      if (keptCO2 < nCO2target) { keptCO2++; ctx.fillStyle = COL.co2; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.arc(q.x, q.y, 1.6, 0, 7); ctx.fill(); next.push(q); }
    }
    else if (q.k === 'lk') { q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt * 0.8; if (q.life > 0) { ctx.fillStyle = COL.co2; ctx.globalAlpha = q.life; ctx.beginPath(); ctx.arc(q.x, q.y, 1.5, 0, 7); ctx.fill(); next.push(q); } }
  }
  ctx.globalAlpha = 1; parts = next;
  // leak gap marker
  ctx.fillStyle = '#0d1512'; ctx.fillRect(bx0 - wt - 1, Y(0.27) - 3, wt + 2, 6);
  /* heating indicator */
  if (s.Qh > 100) { const gi = Math.min(1, s.Qh / Math.max(1, R.peakHeat * 1000)); const g = ctx.createRadialGradient(X(0.39), Y(0.86), 4, X(0.39), Y(0.86), X(0.2)); g.addColorStop(0, `rgba(255,110,90,${0.25 * gi})`); g.addColorStop(1, 'rgba(255,110,90,0)'); ctx.fillStyle = g; ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0); }
  /* live labels */
  const kw = v => fmt(v / 1000, v >= 1e5 ? 0 : 1) + ' kW';
  label(lit ? `LEDs ${kw(s.Pled)}` : 'LEDs off', rx0, Y(RK.top) - 10, { color: lit ? '#ffc2ec' : COL.muted });
  label(`Coil ${kw(s.Qs + s.Ql)} · latent ${fmt(100 * s.Ql / Math.max(1, s.Qs + s.Ql), 0)} %`, ax0 - 6, ay0 - 10, { color: '#9fdcff', align: 'left', size: 10.5 });
  label(`COP ${fmt(s.cs, 1)} / ${fmt(s.cl, 1)}`, (ax0 + ax1) / 2, ay0 + (ay1 - ay0) * 0.5 - 4, { color: COL.ink, align: 'center', size: 10, bg: false });
  label(`${fmt(condDay, 1)} m³ d⁻¹`, X(CTK.x1) + 6, Y(CTK.y0) + 14, { color: '#8fb6ff', size: 10 });
  label(`rejects ${kw(s.Qs + s.Ql + s.Ehvac)}`, ccx, cy0 - 12, { color: '#ffb47a', align: 'center', size: 10.5 });
  label(`${fmt(p.co2, 0)} ppm`, (tx0 + tx1) / 2, ty0 - 12, { color: COL.co2, align: 'center', size: 10 });
  if (Math.abs(envKW) > 0.05) label(`envelope ${envKW > 0 ? '+' : '−'}${fmt(Math.abs(envKW), 1)} kW`, bx0 + 8, by0 + 16, { size: 10, color: envKW > 0 ? '#ffb47a' : '#9fdcff' });
  if (s.Qh > 100) label(s.Qrec > 0.5 * s.Qh ? `reheat ${kw(s.Qh)} from condenser` : `heating ${kw(s.Qh)}`, X(0.385), Y(0.84), { align: 'center', color: '#ff9a8a', size: 10.5 });
  label(`transpiration ${fmt(s.ET * 3600, 0)} kg h⁻¹`, rx1, Y(RK.top) - 10, { align: 'right', color: '#9fdcff', size: 10 });
  /* HUD */
  hud.set('t', `${MONTHS[m]} <b>${String(Math.floor(hf)).padStart(2, '0')}:${String(Math.floor((hf % 1) * 60)).padStart(2, '0')}</b> · lamps ${lit ? '<b>on</b>' : 'off'}`);
  hud.set('site', `${CLIMATES[p.site].label.split(',')[0]} <b>${fmt(s.To, 1)} °C</b>`);
  hud.set('cool', `cooling <b>${fmt((s.Qs + s.Ql) / 1000, 0)} kW</b> · HVAC <b>${fmt(s.Ehvac / 1000, 1)} kW</b>`);
}

const clock = new SimClock({ speed: 7200, onFrame: t => { const now = performance.now(); const dtr = Math.min(0.1, (now - (clock._lr || now)) / 1000); clock._lr = now; if (stageVisible) drawStage(t, dtr); } });
clock.onState(run => { playBtns[0].innerHTML = run ? '❚❚ Pause' : '▶ Play'; });
clock.reset(8 * 3600);

/* ------------------------------------------------------------------ update */
function exportCSV() {
  if (!R) return;
  const J = x => +(x / 3.6e6).toFixed(1);
  downloadCSV('plant-factory-monthly.csv', ['month', 'LED_kWh', 'aux_kWh', 'HVAC_kWh', 'heating_kWh', 'sensible_coil_kWh', 'latent_coil_kWh', 'transpiration_kg', 'shoot_DW_kg', 'CO2_fixed_kg', 'CO2_leaked_kg'],
    R.months.map((m, i) => [MONTHS[i], J(m.Eled), J(m.Eaux), J(m.Ehvac), J(m.Eheat), J(m.Qs), J(m.Ql), Math.round(m.trans), +(m.dw / 1000).toFixed(1), +(m.co2fix / 1000).toFixed(1), +(m.co2leak / 1000).toFixed(1)]));
}
function update() {
  P = params(); syncEnabled(P);
  clock.speed = +P.speed;
  R = compute(P);
  const r = R;
  // readouts
  ro.set('yield', r.fwMkt / 1000, null, `${fmt(r.yieldArea, 1)} kg m⁻² of trays · ${fmt(r.yieldFloor, 0)} kg m⁻² of floor`);
  ro.set('kwhkg', r.kWhPerKg, r.kWhPerKg <= 12.5 ? 'ok' : r.kWhPerKg <= 20 ? 'warn' : 'bad', `${fmt(r.kWhPerKgDW, 0)} kWh kg⁻¹ DW (Graamans et al.: 247)`);
  ro.set('kwhmol', r.kWhPerMol, null, `lamps alone ${fmt(r.E.led / r.tot.mol, 3)} kWh mol⁻¹`);
  ro.set('etot', r.E.tot / 1000, null, `lighting ${fmt(100 * r.lightShare, 0)} % · HVAC ${fmt(100 * r.E.hvac / r.E.tot, 0)} % · heating ${fmt(100 * r.E.heat / r.E.tot, 1)} %`);
  ro.set('scop', r.scop, r.scop >= 5 ? 'ok' : r.scop >= 3 ? 'warn' : 'bad', `peak cooling ${fmt(r.peakCool, 0)} kW · peak heat need ${fmt(r.peakHeat, 0)} kW`);
  ro.set('latent', 100 * r.latentShare, null, `transpiration ${fmt(r.etDay, 2)} L m⁻² d⁻¹ · ${fmt(r.water.transPerKg, 1)} L kg⁻¹`);
  ro.set('water', r.water.perKg, r.water.perKg <= 3 ? 'ok' : r.water.perKg <= 10 ? 'warn' : 'bad', `WUE (Kozai) ${fmt(r.water.wue, 3)}`);
  ro.set('co2', r.co2.perKg, r.co2.cue >= 0.85 ? 'ok' : r.co2.cue >= 0.6 ? 'warn' : 'bad', `CO₂-use efficiency ${fmt(100 * r.co2.cue, 1)} %`);
  ro.set('foot', r.foot.tot, r.foot.tot <= 0.6 ? 'ok' : r.foot.tot <= 2 ? 'warn' : 'bad', `grid ${fmt(r.foot.ef, 0)} g kWh⁻¹ · CO₂ dosing ${fmt(r.foot.co2, 3)}`);
  ro.set('chem', 100 * r.chemShare, null, `${fmt(100 * r.photoEff, 1)} % of the PAR absorbed by leaves`);
  const perkg = P.basis === 'perkg';
  sankeyEnergy(r, perkg); sankeyWater(r, perkg); sankeyCO2(r, perkg);
  monthlyChart(r); graamansChart(r); latentChart(P);
  document.getElementById('sk-e-sub').textContent = perkg ? 'kWh per kg of marketable lettuce' : `MWh per year for ${fmt(r.A, 0)} m² of trays (${fmt(r.fwMkt / 1000, 1)} t of lettuce)`;
  document.getElementById('sk-w-sub').textContent = perkg ? 'litres per kg of marketable lettuce' : 'm³ of water per year';
  document.getElementById('sk-c-sub').textContent = perkg ? 'g CO₂ per kg of marketable lettuce' : 't CO₂ per year';
}
let raf = 0;
ui.onChange((st, id) => { if (id === 'speed') { clock.speed = +st.speed; return; } if (id === 'month' && !st.yearRun) { simMonth = +st.month; } cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
update();
simMonth = P.month;
clock.play();
