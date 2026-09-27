/* ==========================================================================
   Aquaponic nutrient mass balance — 2D laboratory.
   Element balances (N, P, K, Ca, Fe) from feed to fish, dissolved excretion and
   solids; sludge removal or mineralisation; plant uptake estimated from crop
   transpiration × a reference nutrient solution (Goddek et al. 2019, Eqs 8.12–
   8.16); denitrification; water exchange and accumulation (first-order approach
   to steady state); base (KOH / Ca(OH)₂) and iron-chelate supplementation;
   biofilter sizing. See the Derive tab (Eqs. B1–B9).
   ========================================================================== */
import { Controls, Readouts, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, BarChart, Sankey, linspace, downloadCSV } from '/assets/js/plot.js';

/* ------------------------------------------------------------------ reference data */
// Reference solutions, mg L⁻¹ (Cornell lettuce: Brechner & Both 2013 as tabulated in Lesson 5.2; Hoagland 1: Hoagland & Arnon 1950)
const RECIPES = {
  cornell: { label: 'Cornell lettuce (EC 1.2)', N: 8.9 * 14.007, P: 1.0 * 30.974, K: 5.5 * 39.098, Ca: 2.1 * 40.078, Fe: 17e-3 * 55.845 },
  hoagland: { label: 'Hoagland solution 1', N: 15 * 14.007, P: 1 * 30.974, K: 6 * 39.098, Ca: 5 * 40.078, Fe: 1.0 }
};
// Measured lettuce-based aquaponic solution, mg L⁻¹ (Yang & Kim 2020, Table 7): N = NO₃-N + NH₄-N + NO₂-N
const MEASURED = { N: 161.6 + 1.8 + 0.8, P: 27.1, K: 114.1, Ca: 20.4 };
const ELEMENTS = ['N', 'P', 'K', 'Ca', 'Fe'];
const EL = {
  N: { name: 'Nitrogen', unit: 'g N d⁻¹', color: 'accent' },
  P: { name: 'Phosphorus', unit: 'g P d⁻¹', color: 'amber' },
  K: { name: 'Potassium', unit: 'g K d⁻¹', color: 'c4' },
  Ca: { name: 'Calcium', unit: 'g Ca d⁻¹', color: 'water' },
  Fe: { name: 'Iron', unit: 'g Fe d⁻¹', color: 'danger' }
};
const MEDIA = { tuff: { label: 'Volcanic tuff (300 m² m⁻³)', ssa: 300 }, leca: { label: 'Expanded clay (275)', ssa: 275 }, k1: { label: 'Moving-bed K1 (500)', ssa: 500 }, balls: { label: 'Plastic bio-balls (600)', ssa: 600 } };

/* ------------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'frr', label: 'Feed-rate ratio', unit: 'g m⁻² d⁻¹', digits: 0 })
  .add({ id: 'areas', label: 'Area balancing N · P · K', unit: 'm²', format: v => v })
  .add({ id: 'no3', label: 'Nitrate-N on the chosen day', unit: 'mg L⁻¹', digits: 0 })
  .add({ id: 'pss', label: 'Phosphate-P on the chosen day', unit: 'mg L⁻¹', digits: 1 })
  .add({ id: 'nue', label: 'N recovered in fish + plants', unit: '%', digits: 0 })
  .add({ id: 'pue', label: 'P recovered in fish + plants', unit: '%', digits: 0 })
  .add({ id: 'kdef', label: 'Potassium supply ÷ crop demand', unit: '%', digits: 0 })
  .add({ id: 'cadef', label: 'Calcium supply ÷ crop demand', unit: '%', digits: 0 })
  .add({ id: 'fe', label: 'Iron chelate to add', unit: '', format: v => v })
  .add({ id: 'base', label: 'Base for nitrification', unit: '', format: v => v })
  .add({ id: 'tan', label: 'TAN production (0.092 rule)', unit: 'g N d⁻¹', digits: 0 })
  .add({ id: 'bf', label: 'Biofilter media volume', unit: '', format: v => v });

ui.section('Feed');
ui.slider({ id: 'F', label: 'Feed input', min: 0.1, max: 20, step: 0.05, value: 1.0, unit: 'kg d⁻¹', help: 'e.g. 60 kg of fish fed 1.6 % of body mass per day ≈ 1 kg d⁻¹.' });
ui.slider({ id: 'PC', label: 'Crude protein', min: 25, max: 50, step: 1, value: 32, unit: '%', help: 'N = protein ÷ 6.25 (tilapia 28–32 %, trout 42 %).' });
ui.slider({ id: 'cP', label: 'Phosphorus in feed', min: 0.5, max: 2.0, step: 0.05, value: 1.1, unit: '%', help: 'Commercial feeds ≈ 1–1.5 % P.' });
ui.slider({ id: 'cK', label: 'Potassium in feed', min: 0.3, max: 2.0, step: 0.05, value: 1.0, unit: '%' });
ui.slider({ id: 'cCa', label: 'Calcium in feed', min: 0.5, max: 4.0, step: 0.05, value: 2.5, unit: '%' });
ui.slider({ id: 'cFe', label: 'Iron in feed', min: 20, max: 400, step: 5, value: 40, unit: 'mg kg⁻¹' });
ui.section('Partitioning in the fish');
ui.slider({ id: 'rN', label: 'N retained in fish', min: 15, max: 50, step: 1, value: 30, unit: '% of feed N', help: '20–50 % (Schneider et al. 2005); ≈ 30 % (Rafiee & Saad 2005).' });
ui.slider({ id: 'dN', label: 'N excreted dissolved (TAN + urea)', min: 25, max: 70, step: 1, value: 50, unit: '%', help: 'The remainder goes to faeces and uneaten feed.' });
ui.slider({ id: 'rP', label: 'P retained in fish', min: 10, max: 45, step: 1, value: 25, unit: '% of feed P', help: 'Up to 15 % (Rafiee & Saad 2005) to ≈ 30 % by difference from Neto & Ostrensky (2013).' });
ui.slider({ id: 'dP', label: 'P excreted dissolved', min: 5, max: 40, step: 1, value: 17, unit: '%', help: '17 % for Nile tilapia (Neto & Ostrensky 2013); the rest (30–65 %) is in solids.' });
ui.slider({ id: 'dCa', label: 'Ca dissolved (rest in solids)', min: 5, max: 70, step: 1, value: 57, unit: '% of feed Ca', help: '57 % = 100 − 27 % retained − 16 % in sludge (Rafiee & Saad 2005): an upper bound, as Ca also precipitates with phosphate and carbonate.' });
ui.section('System');
ui.slider({ id: 'A', label: 'Plant growing area', min: 1, max: 60, step: 0.5, value: 14, unit: 'm²' });
ui.slider({ id: 'ET', label: 'Crop transpiration (ETc)', min: 0.5, max: 5, step: 0.1, value: 1.3, unit: 'L m⁻² d⁻¹', help: 'Lettuce ≈ 1.3 mm d⁻¹ as an annual average (Goddek et al. 2019, Example 8.2); higher in summer.' });
ui.select({ id: 'recipe', label: 'Reference nutrient solution', options: Object.entries(RECIPES).map(([k, r]) => ({ value: k, label: r.label })), value: 'cornell' });
ui.slider({ id: 'V', label: 'System water volume', min: 1, max: 60, step: 0.5, value: 6, unit: 'm³' });
ui.slider({ id: 'x', label: 'Water exchange', min: 0, max: 10, step: 0.1, value: 1.5, unit: '% d⁻¹' });
ui.slider({ id: 'den', label: 'Denitrification (N lost as gas)', min: 0, max: 60, step: 1, value: 25, unit: '% of dissolved N', help: '25–60 % reported (Hu et al. 2015; Zou et al. 2016).' });
ui.slider({ id: 'eta', label: 'Sludge mineralisation returned', min: 0, max: 95, step: 1, value: 0, unit: '%', help: '0 = sludge discarded (classic coupled system); 85–90 % with mineralisation reactors (Goddek et al. 2019).' });
ui.slider({ id: 'koh', label: 'Base split: KOH share', min: 0, max: 100, step: 5, value: 60, unit: '% (rest Ca(OH)₂)' });
ui.slider({ id: 'days', label: 'Days since start (accumulation)', min: 0, max: 365, step: 1, value: 120, unit: 'd' });
ui.section('Biofilter');
ui.slider({ id: 'rA', label: 'Areal TAN removal rate', min: 0.2, max: 1.5, step: 0.05, value: 0.5, unit: 'g N m⁻² d⁻¹' });
ui.select({ id: 'media', label: 'Filter media', options: Object.entries(MEDIA).map(([k, m]) => ({ value: k, label: m.label })), value: 'k1' });
ui.slider({ id: 'sf', label: 'Safety factor', min: 1, max: 2.5, step: 0.1, value: 1.5 });
ui.segmented({ id: 'el', label: 'Element shown in the Sankey', options: ELEMENTS.slice(0, 4).map(e => ({ value: e, label: e })), value: 'N' });
ui.presets([
  { label: 'UVI-type coupled', title: 'Feed-rate ratio ≈ 70 g m⁻² d⁻¹, sludge discarded', values: { F: 1.0, PC: 32, A: 14, x: 1.5, den: 25, eta: 0, koh: 60, ET: 1.3 } },
  { label: 'FAO small unit', title: 'Leafy greens at 45 g m⁻² d⁻¹', values: { F: 0.45, PC: 32, A: 10, V: 1.5, x: 1, den: 20, eta: 0, koh: 50, ET: 1.3 } },
  { label: 'With sludge mineralisation', title: 'Sludge nutrients returned to the plants (decoupled-style)', values: { F: 1.0, PC: 32, A: 14, x: 1.5, den: 25, eta: 85, koh: 60, ET: 1.3 } },
  { label: 'Zero exchange', title: 'No water replaced: what accumulates?', values: { F: 1.0, PC: 32, A: 14, x: 0, den: 25, eta: 0, koh: 60, ET: 1.3, days: 365 } },
  { label: 'Trout feed', title: 'High-protein feed, cool water', values: { F: 1.0, PC: 45, cP: 1.0, A: 14, x: 1.5, den: 25, eta: 0, koh: 60, ET: 1.0 } }
]);
ui.saveButton('nutrient-mass-balance', () => ro.values());
ui.button({ label: 'Download the balance (CSV)', onClick: () => downloadBalance() });

/* ------------------------------------------------------------------ the model */
function balance(p, etaOverride) {
  const eta = (etaOverride ?? p.eta) / 100, F = p.F * 1000; // g feed d⁻¹
  const R = RECIPES[p.recipe];
  const Q = p.x / 100 * p.V;                      // m³ d⁻¹
  const W = p.ET * p.A / 1000;                     // m³ d⁻¹ transpired
  const feed = { N: F * p.PC / 100 / 6.25, P: F * p.cP / 100, K: F * p.cK / 100, Ca: F * p.cCa / 100, Fe: F * p.cFe * 1e-6 };
  // partition fractions: retained r, dissolved d, solids s (Rafiee & Saad 2005 for K, Ca, Fe; see Sources)
  const part = {
    N: { r: p.rN / 100, d: p.dN / 100 }, P: { r: p.rP / 100, d: p.dP / 100 },
    K: { r: 0.07, d: 0.87 }, Ca: { r: 0.27, d: p.dCa / 100 }, Fe: { r: 0.0, d: 0.76 * 0.10 }
  };
  Object.values(part).forEach(q => { q.d = Math.min(q.d, 1 - q.r); q.s = Math.max(0, 1 - q.r - q.d); });
  // nitrification and base (Eq. B8): all dissolved + mineralised N is nitrified (7.07 g CaCO₃ g⁻¹ N);
  // denitrification and nitrate uptake by plants each return 3.57 g CaCO₃ g⁻¹ N
  const nitN = feed.N * (part.N.d + part.N.s * eta);
  const denN = nitN * p.den / 100, plantN = Math.min(W * R.N, nitN - denN);
  const eqBase = Math.max(0, 7.07 * nitN - 3.57 * (denN + plantN)) / 50.04; // eq d⁻¹
  const supp = { N: 0, P: 0, K: eqBase * p.koh / 100 * 39.098, Ca: eqBase * (1 - p.koh / 100) * 20.04, Fe: 0 };
  const out = {};
  ELEMENTS.forEach(e => {
    const q = part[e], M = feed[e];
    const fish = M * q.r, dis = M * q.d, sol = M * q.s, minr = sol * eta, sludge = sol - minr;
    let pool = dis + minr + supp[e];
    const lossDen = e === 'N' ? pool * p.den / 100 : 0;
    const avail = pool - lossDen;
    const demand = W * R[e];                       // g d⁻¹ (Eq. B5)
    const plants = Math.min(demand, avail);
    const surplus = avail - plants;
    // accumulation in the water: V dC/dt = surplus − Q C  →  C(t) = surplus/Q (1 − e^(−Qt/V))
    const t = p.days;
    const Css = Q > 0 ? surplus / Q : Infinity;
    const Ct = Q > 0 ? Css * (1 - Math.exp(-Q * t / p.V)) : surplus * t / p.V;
    const exch = Q * Ct;
    const accum = Math.max(0, surplus - exch);
    out[e] = { M, fish, dis, sol, minr, sludge, supp: supp[e], lossDen, avail, demand, plants, surplus, Css, Ct, exch, accum, supply: avail, ratio: avail / Math.max(1e-12, demand) };
  });
  // Fe chelate to cover the deficit and hold 2 mg L⁻¹ against exchange (FAO: ≈ 2 mg Fe L⁻¹)
  const feDef = Math.max(0, out.Fe.demand - out.Fe.avail) + Q * 2;
  return { out, feed, part, Q, W, nitN, eqBase, feDef, R };
}
function areaFor(p, e) { // area whose crop takes up exactly the feed-derived supply of element e (Eq. B6; Goddek et al. 2019 Eq. 8.16)
  const b = balance(Object.assign({}, p, { A: 1 })); const o = b.out[e];
  const supply = (o.dis + o.minr) * (e === 'N' ? 1 - p.den / 100 : 1);
  return supply / (p.ET * b.R[e] / 1000);
}

/* ------------------------------------------------------------------ stage: the Sankey */
const stageEl = document.getElementById('stage');
const sankeyHost = document.createElement('div'); const TOP = 70; sankeyHost.style.cssText = `position:absolute;inset:${TOP}px 8px 8px 8px;`;
stageEl.appendChild(sankeyHost);
const hud = hudChips(stageEl);
let sankey = null;
function ensureSankey() { const h = Math.max(260, stageEl.clientHeight - TOP - 12); if (!sankey || sankey.opts.height !== h) { sankeyHost.innerHTML = ''; sankey = new Sankey(sankeyHost, { unit: 'g d⁻¹', height: h, digits: 1 }); } }
new ResizeObserver(() => { if (sankey && Math.abs(sankey.opts.height - Math.max(260, stageEl.clientHeight - TOP - 12)) > 8) { sankey = null; update(); } }).observe(stageEl);

/* ------------------------------------------------------------------ charts */
const chRatio = new BarChart('#chart-ratio', { y: { label: 'Ratio to N, % of recipe', unit: '%', min: 0 } });
const chSupply = new BarChart('#chart-supply', { y: { label: 'Plant-available', unit: '% of feed', min: 0, max: 100 } });
const chTime = new Plot('#chart-time', { x: { label: 'Days since start', unit: 'd', min: 0, max: 365 }, y: { label: 'Concentration', unit: 'mg L⁻¹', log: true, min: 0.1, max: 2000, format: v => v < 1 ? String(+v.toPrecision(2)) : Math.round(v).toLocaleString('en-GB') } });
const chArea = new BarChart('#chart-area', { y: { label: 'Plant area', unit: 'm²', min: 0 }, horizontal: true });

/* ------------------------------------------------------------------ update */
function update() {
  const p = ui.values(); const b = balance(p); const o = b.out; const R = b.R;
  const e = p.el; const E = o[e];
  // Sankey for the chosen element (Eq. B1–B4)
  ensureSankey();
  const nodes = [
    { id: 'feed', label: `Feed ${e}`, color: 'amber', col: 0 },
    { id: 'fish', label: 'Fish growth', color: 'water', col: 1 },
    { id: 'dis', label: e === 'N' ? 'Dissolved (TAN, urea)' : 'Dissolved excretion', color: 'magenta', col: 1 },
    { id: 'sol', label: 'Faeces + uneaten feed', color: 'c7', col: 1 },
    { id: 'pool', label: 'Plant-available pool', color: 'c2', col: 2 },
    { id: 'sludge', label: 'Sludge removed', color: 'muted', col: 3 },
    { id: 'plants', label: 'Plant uptake', color: 'accent', col: 3 },
    { id: 'exch', label: 'Water exchange', color: 'c1', col: 3 },
    { id: 'acc', label: 'Accumulating', color: 'c5', col: 3 }
  ];
  const links = [
    { source: 'feed', target: 'fish', value: E.fish }, { source: 'feed', target: 'dis', value: E.dis }, { source: 'feed', target: 'sol', value: E.sol },
    { source: 'sol', target: 'sludge', value: E.sludge }, { source: 'sol', target: 'pool', value: E.minr }, { source: 'dis', target: 'pool', value: E.dis },
    { source: 'pool', target: 'plants', value: E.plants }, { source: 'pool', target: 'exch', value: E.exch }, { source: 'pool', target: 'acc', value: E.accum }
  ];
  if (E.supp > 0) { nodes.push({ id: 'supp', label: e === 'K' ? 'KOH (pH control)' : 'Ca(OH)₂ (pH control)', color: 'c3', col: 1 }); links.push({ source: 'supp', target: 'pool', value: E.supp }); }
  if (E.lossDen > 0) { nodes.push({ id: 'den', label: 'N₂ + N₂O gas', color: 'danger', col: 3 }); links.push({ source: 'pool', target: 'den', value: E.lossDen }); }
  sankey.opts.unit = EL[e].unit.split(' ')[0] + ' ' + e + ' d⁻¹';
  sankey.set({ nodes, links });
  const recov = 100 * (E.fish + E.plants) / E.M;
  hud.set('h', `<b>${EL[e].name}</b> · feed ${fmt(E.M, 1)} g d⁻¹ · fish ${fmt(100 * E.fish / E.M, 0)} % · plants ${fmt(100 * E.plants / E.M, 0)} %`);
  hud.set('c', `crop demand ${fmt(E.demand, 1)} g d⁻¹ · supply ${fmt(100 * E.ratio, 0)} % of it · recovered ${fmt(recov, 0)} %`);
  // readouts
  const frr = p.F * 1000 / p.A;
  ro.set('frr', frr, frr >= 40 && frr <= 100 ? 'ok' : 'warn', 'UVI raft 60–100 · FAO leafy 40–50');
  const aN = areaFor(p, 'N'), aP = areaFor(p, 'P'), aK = areaFor(p, 'K');
  ro.set('areas', `${fmt(aN, 0)} · ${fmt(aP, 0)} · ${fmt(aK, 0)}`, null, `feed-derived supply · you have ${fmt(p.A, 1)} m²`);
  const no3 = o.N.Ct;
  ro.set('no3', no3, no3 > 300 ? 'bad' : no3 > 150 || no3 < 5 ? 'warn' : 'ok', p.x > 0 ? `95 % of steady state ${fmt(o.N.Css, 0)} after ${fmt(3 * p.V / b.Q, 0)} d · fish tolerate 150–300` : 'rises without limit (no exchange)');
  ro.set('pss', o.P.Ct, o.P.Ct < 5 ? 'warn' : 'ok', `recipe ${fmt(R.P, 0)} mg L⁻¹`);
  ro.set('nue', 100 * (o.N.fish + o.N.plants) / o.N.M, null, `plants ${fmt(100 * o.N.plants / o.N.M, 0)} % · measured systems 34–51 %`);
  ro.set('pue', 100 * (o.P.fish + o.P.plants) / o.P.M, null, `sludge ${fmt(100 * o.P.sludge / o.P.M, 0)} %`);
  const st = r => r >= 1 && r <= 3 ? 'ok' : r > 3 || r > 0.6 ? 'warn' : 'bad';
  ro.set('kdef', 100 * o.K.ratio, st(o.K.ratio), `feed ${fmt(o.K.dis + o.K.minr, 1)} + KOH ${fmt(o.K.supp, 1)} g d⁻¹ vs ${fmt(o.K.demand, 1)}`);
  ro.set('cadef', 100 * o.Ca.ratio, st(o.Ca.ratio), `feed ${fmt(o.Ca.dis + o.Ca.minr, 1)} + Ca(OH)₂ ${fmt(o.Ca.supp, 1)} g d⁻¹ vs ${fmt(o.Ca.demand, 1)}`);
  ro.set('fe', `${fmt(b.feDef / 0.11, 2)} g d⁻¹`, null, `Fe-DTPA (11 % Fe) to cover ${fmt(b.feDef * 1000, 0)} mg Fe d⁻¹`);
  ro.set('base', `${fmt(b.eqBase * p.koh / 100 * 56.11, 0)} g KOH + ${fmt(b.eqBase * (1 - p.koh / 100) * 37.05, 0)} g Ca(OH)₂`, null, `${fmt(b.eqBase, 2)} eq d⁻¹ for ${fmt(b.nitN, 0)} g N nitrified`);
  const ptan = 0.092 * p.F * 1000 * p.PC / 100;
  ro.set('tan', ptan, null, `partition gives ${fmt(o.N.dis + o.N.minr, 0)} g N d⁻¹ dissolved`);
  const abf = ptan / p.rA, vol = abf / MEDIA[p.media].ssa * p.sf;
  ro.set('bf', `${fmt(vol * 1000, 0)} L`, null, `${fmt(abf, 0)} m² of biofilm × safety ${fmt(p.sf, 1)}`);
  // chart 1: nutrient ratios relative to N, as % of the reference recipe
  const els = ['P', 'K', 'Ca', 'Fe'];
  const supN = o.N.avail;
  const model = els.map(k => 100 * (o[k].avail / supN) / (R[k] / R.N));
  const feedOnly = els.map(k => 100 * ((o[k].dis + o[k].minr) / supN) / (R[k] / R.N));
  const meas = els.map(k => MEASURED[k] ? 100 * (MEASURED[k] / MEASURED.N) / (R[k] / R.N) : NaN);
  chRatio.set(els.map(k => k + ' : N'), [
    { label: 'From feed only', values: feedOnly, color: 'c7', format: v => fmt(v, 0) },
    { label: 'Feed + base supplements', values: model, color: 'accent', format: v => fmt(v, 0) },
    { label: 'Measured, lettuce aquaponics (Yang & Kim 2020)', values: meas, color: 'water', format: v => fmt(v, 0) }
  ]);
  chRatio.refLine(100, 'recipe = 100 %');
  // chart 2: coupled (sludge discarded) vs with sludge mineralisation
  const b0 = balance(p, 0), b85 = balance(p, 85);
  const share = (bb, k) => 100 * (bb.out[k].dis + bb.out[k].minr) * (k === 'N' ? 1 - p.den / 100 : 1) / bb.out[k].M;
  chSupply.set(ELEMENTS, [
    { label: 'Sludge discarded (coupled)', values: ELEMENTS.map(k => share(b0, k)), color: 'c7', format: v => fmt(v, 0) },
    { label: 'Sludge mineralised 85 % and returned', values: ELEMENTS.map(k => share(b85, k)), color: 'accent', format: v => fmt(v, 0) }
  ]);
  // chart 3: concentrations over time
  const ts = linspace(0, 365, 121);
  ['N', 'P', 'K', 'Ca'].forEach((k, i) => {
    const s = o[k].surplus, Q = b.Q;
    const C = ts.map(t => Math.max(0.1, Q > 0 ? s / Q * (1 - Math.exp(-Q * t / p.V)) : s * t / p.V));
    chTime.line(k, ts, C, { color: EL[k].color, label: `${k} (recipe ${fmt(R[k], 0)})`, width: 2.2 });
  });
  chTime.vline('now', p.days, { color: 'magenta', label: `day ${p.days}` });
  // chart 4: plant area by different design rules
  chArea.set(['FRR 100 (UVI high)', 'FRR 60 (UVI low)', 'FRR 45 (FAO leafy)', 'Balance N', 'Balance P', 'Balance K', 'Your design'], [{ label: 'Area', format: v => fmt(v, v < 10 ? 1 : 0), values: [p.F * 10, p.F * 1000 / 60, p.F * 1000 / 45, aN, aP, aK, p.A], colors: ['c1', 'c1', 'c1', 'accent', 'amber', 'c4', 'magenta'] }]);
}
function downloadBalance() {
  const p = ui.values(); const b = balance(p);
  const rows = ELEMENTS.map(e => { const o = b.out[e]; return [e, o.M.toFixed(3), o.fish.toFixed(3), o.dis.toFixed(3), o.sol.toFixed(3), o.sludge.toFixed(3), o.minr.toFixed(3), o.supp.toFixed(3), o.lossDen.toFixed(3), o.plants.toFixed(3), o.demand.toFixed(3), o.exch.toFixed(3), o.accum.toFixed(3), isFinite(o.Css) ? o.Css.toFixed(2) : 'inf']; });
  downloadCSV('aquaponic-nutrient-balance.csv', ['element', 'feed_g_d', 'fish_g_d', 'dissolved_g_d', 'solids_g_d', 'sludge_g_d', 'mineralised_g_d', 'supplement_g_d', 'denitrified_g_d', 'plant_uptake_g_d', 'plant_demand_g_d', 'exchange_g_d', 'accumulating_g_d', 'steady_conc_mg_L'], rows);
}
let raf = 0;
ui.onChange(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
update();
window.__nmb = { ui, balance, update };
