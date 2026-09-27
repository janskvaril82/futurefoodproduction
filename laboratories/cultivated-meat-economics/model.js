/* Cultivated-meat techno-economic model (structure after Humbird 2021; see Derive tab, Eqs. T1–T10).
   All money in US$ (price years of the source studies, 2018–2020, not inflation-adjusted).        */

export const RHO_CELL = 1.03;      // g mL⁻¹, wet cell density (3000 pg ↔ 17.7 µm sphere, Humbird 2021)
export const PHI_MAX = 0.25;       // maximum cell volume fraction before viscosity rises sharply (Humbird 2021)
export const WORKING = 0.8;        // working volume / vessel volume (Humbird 2021)

/** Installed cost (M$) of one production-bioreactor system of vessel volume V (m³). */
export function reactorCost(V, p) {
  if (p.capex === 'power') return 1.414 * Math.pow(V / 20, p.nexp);            // anchored at Humbird's 20 m³ system
  return V >= 0.33 ? 0.800 + 0.0307 * V : 2.285 * V + 0.0495;                  // Humbird (2021) Eq. 9 (k$ → M$)
}
export function crf(iPct, n) { const i = iPct / 100; return i > 0 ? i * Math.pow(1 + i, n) / (Math.pow(1 + i, n) - 1) : 1 / n; }

export function model(p) {
  const mu = Math.LN2 / p.td;                                   // h⁻¹
  const X = p.dens * p.mcell * 1e-3;                            // kg m⁻³ (= g L⁻¹) of wet cells
  const phi = p.dens * 1e6 * (p.mcell / RHO_CELL) * 1e-12;      // cell volume fraction
  const Vv = p.vol / WORKING;                                   // vessel volume, m³
  const ok = (1 - p.fail / 100) * (p.yield / 100);             // fraction of grown cells that becomes product
  let QR, vm0, tc = null, tg = null;
  if (p.mode === 'fb') {
    tg = p.np * p.td;                                           // growth time in the production vessel, h
    tc = tg + 24 * p.tmat + p.tturn;                           // cycle time, h
    QR = p.vol * X * 8760 * (p.avail / 100) / tc * ok;         // kg per reactor per year
    vm0 = 1000 / X * (1 + p.fx / 100);                         // L of medium per kg grown
  } else {
    QR = mu * X * p.vol * 8760 * (p.avail / 100) * ok;
    vm0 = 1000 * p.D / (24 * mu * X) * (1 + p.fx / 100);
  }
  const vm = vm0 / ok;                                          // L per kg of product
  const Q = p.cap * 1e6;                                        // kg of product per year
  const nR = Q / QR;
  const CR = reactorCost(Vv, p) * p.kcap;
  const Cperf = p.mode === 'pf' ? 0.93 * Math.pow(p.vol / 1.6, 0.6) * p.kcap : 0;   // dual-ATF skid (Humbird: $89 M / 96)
  const capReactors = nR * CR, capSeed = nR * CR * p.fseed / 100, capPerf = nR * Cperf;
  const capBOP = p.kbop * (33.1 * Math.pow(p.cap, 0.6) + 0.765 * nR) * p.kcap;
  const TDC = capReactors + capSeed + capPerf + capBOP;
  const TCI = TDC * p.find;
  const CRF = crf(p.irate, p.life);
  const eff = p.elec / ok;                                      // kWh per kg of product
  const parts = {
    capital: CRF * TCI * 1e6 / Q,
    fixed: p.ffix / 100 * TCI * 1e6 / Q,
    labour: p.fte * p.wage * 1000 / Q,
    basal: vm * p.cmed * (1 - p.gf / 100),
    gf: vm * p.cmed * p.gf / 100,
    energy: eff * p.pel,
    cons: p.cons
  };
  const total = parts.capital + parts.fixed + parts.labour + parts.basal + parts.gf + parts.energy + parts.cons;
  const CF = eff * p.ef + vm * p.cfmed;
  const Vtot = nR * p.vol;
  return { mu, X, phi, Vv, QR, vm, tc, tg, nR, CR, Cperf, cap: { reactors: capReactors, seed: capSeed, perf: capPerf, bop: capBOP }, TDC, TCI, CRF, parts, total, CF, eff, Vtot, prod: Q / (Vtot * 365), ok };
}

/* ------------------------------------------------------------------ presets */
const BASE = { fail: 0, yield: 100, capex: 'humbird', nexp: 0.6, kcap: 1, kbop: 1, find: 1.84, irate: 7.5, life: 10, ffix: 9, wage: 100, pel: 0.08, ef: 0.46, cfmed: 0.30, tmat: 0, D: 1.0, np: 2, tturn: 8, fx: 20 };
export const PRESETS = [
  { id: 'early', label: 'Early commercial (2024–2026)', pub: 150, pubRef: 'CE Delft (2021) scenario 3',
    note: 'First commercial plants buying media at list prices: CE Delft’s “current prices” scenario 3 — the lowest list prices found in December 2020 (the latest systematic public price survey) and low medium use (8 L kg⁻¹, 99 % of the medium cost recombinant proteins and growth factors), 10 kt a⁻¹, commercial 4-year payback.',
    values: Object.assign({}, BASE, { mode: 'fb', td: 30, dens: 50, mcell: 3080, np: 2, tmat: 10, tturn: 24, fx: 23.2, avail: 95, cap: 10, vol: 10, fseed: 39, kbop: 0.1, find: 1.0, irate: 0, life: 4, ffix: 1.7, fte: 200, cmed: 16.6, gf: 99.3, elec: 21.7, pel: 0.095, cons: 0.9 }) },
  { id: 'humbird', label: 'Humbird fed-batch (2021)', pub: 37, pubRef: 'Humbird (2021) Table 2',
    note: '24 × 20 m³ fed-batch reactors, metabolically enhanced cells (110 g L⁻¹), amino acids at scale prices, pharma-style clean rooms, 7.5 % over 10 years.',
    values: Object.assign({}, BASE, { mode: 'fb', td: 24, dens: 36.7, mcell: 3000, np: 1.8, tturn: 8, fx: 20, avail: 95, cap: 6.8, vol: 16, fseed: 68, fte: 95, cmed: 2.02, gf: 13.6, elec: 12, cons: 1 }) },
  { id: 'best', label: 'Humbird best case (hydrolysate)', pub: 22, pubRef: 'Humbird (2021), §3.1',
    note: 'As the fed-batch case but amino acids from a $2 kg⁻¹ plant-protein hydrolysate: macronutrients ≈ $15 kg⁻¹ cheaper.',
    values: Object.assign({}, BASE, { mode: 'fb', td: 24, dens: 36.7, mcell: 3000, np: 1.8, tturn: 8, fx: 20, avail: 95, cap: 6.8, vol: 16, fseed: 68, fte: 95, cmed: 0.64, gf: 43, elec: 12, cons: 1 }) },
  { id: 'perf', label: 'Humbird perfusion (2021)', pub: 51, pubRef: 'Humbird (2021) Table 2',
    note: '96 × 2 m³ perfusion reactors at 195 g L⁻¹ with dual ATF filters (1 reactor volume per day); expensive filters and capital.',
    values: Object.assign({}, BASE, { mode: 'pf', td: 24, dens: 65, mcell: 3000, D: 1.0, fx: 40, avail: 91, cap: 6.9, vol: 1.6, fseed: 11, fte: 132, cmed: 2.02, gf: 14.3, elec: 12, cons: 5 }) },
  { id: 'cedelft', label: 'CE Delft optimistic (scenario 8)', pub: 6.43, pubRef: 'CE Delft (2021) scenario 8',
    note: 'Growth factors 1,000× cheaper, recombinant proteins 5× less used and 100× cheaper, food-grade plant without clean rooms, 30-year payback, runs 25 % shorter, larger cells (5,000 µm³).',
    values: Object.assign({}, BASE, { mode: 'fb', td: 30, dens: 50, mcell: 4400, np: 2, tmat: 7.5, tturn: 24, fx: 63, avail: 95, cap: 10, vol: 10, fseed: 75, kbop: 0.1, find: 1.0, irate: 0, life: 30, ffix: 1.7, fte: 130, cmed: 0.135, gf: 21, elec: 18, pel: 0.095, cons: 0.9 }) }
];

/* ------------------------------------------------------------------ benchmarks (US$ per kg) */
export const BENCH = {
  chicken: { label: 'Whole chicken, US retail (Aug 2026)', v: 2.012 / 0.45359237, ref: 'BLS series APU0000706111' },
  beef: { label: 'Ground beef, US retail (Aug 2026)', v: 6.923 / 0.45359237, ref: 'BLS series APU0000703112' },
  conv: { label: 'Conventional meat production cost (≈ $2 kg⁻¹)', v: 2, ref: 'benchmark used by CE Delft (2021)' },
  humbird: { label: 'Humbird’s affordability threshold ($25 kg⁻¹)', v: 25, ref: 'Humbird (2021)' }
};

/* ------------------------------------------------------------------ one-at-a-time sensitivity (tornado) */
export const TORNADO = [
  { key: 'cmed', label: 'Medium price', lo: v => v / 2, hi: v => v * 2, txt: '÷2 / ×2' },
  { key: 'gfp', label: 'Growth-factor & protein price', lo: 0.1, hi: 2, txt: '÷10 / ×2', special: true },
  { key: 'dens', label: 'Harvest cell density', lo: v => v * 1.5, hi: v => v * 0.5, txt: '×1.5 / ÷2' },
  { key: 'td', label: 'Doubling time', lo: v => v * 0.75, hi: v => v * 1.5, txt: '−25 % / +50 %' },
  { key: 'kcap', label: 'Capital cost estimate', lo: v => v * 0.8, hi: v => v * 1.4, txt: '−20 % / +40 %' },
  { key: 'irate', label: 'Interest rate', lo: v => Math.max(0, v - 4), hi: v => v + 4, txt: '−4 pts / +4 pts' },
  { key: 'life', label: 'Plant life / payback', lo: v => v * 2, hi: v => Math.max(2, v / 2), txt: '×2 / ÷2' },
  { key: 'cap', label: 'Plant capacity', lo: v => v * 2, hi: v => v / 2, txt: '×2 / ÷2' },
  { key: 'vol', label: 'Reactor working volume', lo: v => v * 2, hi: v => v / 2, txt: '×2 / ÷2' },
  { key: 'fte', label: 'Staff', lo: v => v * 0.5, hi: v => v * 1.5, txt: '−50 % / +50 %' },
  { key: 'elec', label: 'Electricity use', lo: v => v * 0.5, hi: v => v * 1.5, txt: '−50 % / +50 %' },
  { key: 'pel', label: 'Electricity price', lo: v => v * 0.5, hi: v => v * 2, txt: '÷2 / ×2' },
  { key: 'fail', label: 'Failed batches', lo: v => 0, hi: v => v + 10, txt: '0 / +10 points' }
];
export function withChange(p, item, which) {
  const q = Object.assign({}, p);
  if (item.special) {             // scale only the growth-factor/recombinant-protein part of the medium price
    const f = which === 'lo' ? item.lo : item.hi, s = p.gf / 100;
    const c = p.cmed * ((1 - s) + s * f);
    q.cmed = c; q.gf = c > 0 ? 100 * p.cmed * s * f / c : 0;
  } else q[item.key] = (which === 'lo' ? item.lo : item.hi)(p[item.key]);
  return q;
}

/* ------------------------------------------------------------------ Monte Carlo */
function tri(u, a, m, b) { const F = (m - a) / (b - a); return u < F ? a + Math.sqrt(u * (b - a) * (m - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - m)); }
export const MC_SPEC = [
  { key: 'cmed', txt: 'medium price: log-normal, median = setting, σ(ln) = 0.5' },
  { key: 'dens', txt: 'cell density: triangular 0.6× – 1× – 1.25×' },
  { key: 'td', txt: 'doubling time: triangular 0.85× – 1× – 1.5×' },
  { key: 'kcap', txt: 'capital estimate: triangular 0.8× – 1× – 1.4× (FEL-1 accuracy)' },
  { key: 'irate', txt: 'interest rate: triangular −3 / 0 / +3 points (≥ 0)' },
  { key: 'elec', txt: 'electricity use: triangular 0.5× – 1× – 1.2×' },
  { key: 'pel', txt: 'electricity price: uniform 0.7× – 1.4×' },
  { key: 'fte', txt: 'staff: uniform 0.8× – 1.25×' },
  { key: 'fail', txt: 'failed batches: triangular 0 / setting / setting + 8 points' }
];
export function monteCarlo(p, N, rng, randn) {
  const out = new Float64Array(N), co2 = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const q = Object.assign({}, p);
    q.cmed = p.cmed * Math.exp(0.5 * randn(rng));
    q.dens = p.dens * tri(rng(), 0.6, 1, 1.25);
    q.td = p.td * tri(rng(), 0.85, 1, 1.5);
    q.kcap = p.kcap * tri(rng(), 0.8, 1, 1.4);
    q.irate = Math.max(0, p.irate + tri(rng(), -3, 0, 3));
    q.elec = p.elec * tri(rng(), 0.5, 1, 1.2);
    q.pel = p.pel * (0.7 + 0.7 * rng());
    q.fte = p.fte * (0.8 + 0.45 * rng());
    q.fail = Math.min(60, tri(rng(), 0, p.fail + 1e-9, p.fail + 8));
    const r = model(q); out[k] = r.total; co2[k] = r.CF;
  }
  return { cost: out, co2 };
}

/** Medium price that makes the total cost equal `target` (cost is linear in c_med). */
export function medPriceFor(p, target) {
  const r0 = model(Object.assign({}, p, { cmed: 0 }));
  const slope = r0.vm;                  // $ kg⁻¹ per $ L⁻¹
  return { floor: r0.total, cmed: (target - r0.total) / slope };
}
/** Smallest harvest density (10⁶ cells mL⁻¹) that reaches the target, by bisection (cost falls with density). */
export function densityFor(p, target, dmax = 300) {
  const f = d => model(Object.assign({}, p, { dens: d })).total - target;
  if (f(dmax) > 0) return null;
  if (f(0.5) <= 0) return 0.5;
  let a = 0.5, b = dmax;
  for (let k = 0; k < 60; k++) { const m = Math.sqrt(a * b); if (f(m) > 0) a = m; else b = m; }
  return b;
}
