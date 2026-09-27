/* ==========================================================================
   Levelised cost of food — discounted cash-flow model (Eqs. LC1–LC8).
   LCOF = Σ C_t (1+r)^−t / Σ Q_t (1+r)^−t, the definition of Lesson 15.3
   (Eq. 15.3.4). All money in euros per m² of growing area; output in kg m⁻².
   ========================================================================== */

/* Capital items (same five categories for every system). */
export const CAPEX = [
  { key: 'S', label: 'Building and structure' },
  { key: 'G', label: 'Growing system' },
  { key: 'L', label: 'Lighting' },
  { key: 'C', label: 'Climate system' },
  { key: 'A', label: 'Automation, machinery, irrigation' }
];
/* Cost components used in the decomposition (order = waterfall order). */
export const PARTS = [
  { key: 'capital', label: 'Capital', color: '#6a4fc2' },
  { key: 'maint', label: 'Maintenance', color: '#8e7cc3' },
  { key: 'elec', label: 'Electricity', color: '#b86e0b' },
  { key: 'heat', label: 'Heat', color: '#c2573a' },
  { key: 'labour', label: 'Labour', color: '#1c78a3' },
  { key: 'seeds', label: 'Seeds and plants', color: '#2e7d6b' },
  { key: 'nutr', label: 'Nutrients, fertiliser, substrate', color: '#1d7a4a' },
  { key: 'prot', label: 'Crop protection', color: '#6b6f2a' },
  { key: 'pack', label: 'Packaging, harvest, logistics', color: '#b23f8c' },
  { key: 'water', label: 'Water', color: '#4a8cff' },
  { key: 'other', label: 'Other (land, insurance, admin)', color: '#78807b' }
];

/* Currency conversions used for the literature defaults (annual averages). */
export const USD_EUR_2022 = 0.95;   // ECB reference rate 2022: 1 EUR = 1.053 USD
export const USD_EUR_2023 = 0.925;  // ECB reference rate 2023: 1 EUR = 1.081 USD

/**
 * Literature defaults. Each numeric parameter: [default, low, high] (low/high used by the tornado and Monte Carlo).
 * See the Assumptions & sources tab for the derivation of every number.
 */
export const SYSTEMS = {
  vf: {
    label: 'Vertical farm', short: 'Vertical farm',
    capS: [428, 330, 1190], lifeS: 30, capG: [285, 220, 790], lifeG: 15, capL: [356, 275, 990], lifeL: 10,
    capC: [214, 165, 595], lifeC: 15, capA: [142, 110, 395], lifeA: 10,
    maint: [1.5, 1, 3], yield: [115, 60, 130], ramp1: [70, 40, 100], ramp2: [90, 70, 100], loss: [5, 0, 20], price: [10.45, 7, 14],
    elec: [12, 7.7, 20], heat: [0, 0, 0], labour: [0.10, 0.04, 0.2], seeds: [0.40, 0.25, 0.6], nutr: [0.30, 0.2, 0.45], prot: [0, 0, 0.02],
    pack: [1.30, 0.8, 1.8], water: [3, 1, 10], waterPrice: [2.5, 1.5, 4], other: [10, 5, 25]
  },
  gh: {
    label: 'Heated greenhouse', short: 'Greenhouse',
    capS: [150, 75, 300], lifeS: 25, capG: [60, 30, 120], lifeG: 15, capL: [80, 0, 160], lifeL: 10,
    capC: [60, 30, 120], lifeC: 20, capA: [30, 15, 60], lifeA: 10,
    maint: [2, 1, 3], yield: [41, 30, 60], ramp1: [85, 60, 100], ramp2: [100, 90, 100], loss: [5, 0, 15], price: [6, 4, 10],
    elec: [4.4, 2, 8], heat: [8, 3, 20], labour: [0.08, 0.03, 0.2], seeds: [0.30, 0.2, 0.45], nutr: [0.15, 0.1, 0.25], prot: [0.02, 0.01, 0.05],
    pack: [0.90, 0.5, 1.4], water: [20, 12, 30], waterPrice: [2.5, 1.5, 4], other: [5, 2, 12]
  },
  field: {
    label: 'Open field', short: 'Open field',
    capS: [0.02, 0.01, 0.04], lifeS: 25, capG: [0.28, 0.14, 0.56], lifeG: 15, capL: [0, 0, 0], lifeL: 10,
    capC: [0, 0, 0], lifeC: 15, capA: [0.46, 0.23, 0.92], lifeA: 10,
    maint: [1, 0.5, 2], yield: [4.24, 2.83, 5.65], ramp1: [100, 90, 100], ramp2: [100, 100, 100], loss: [0, 0, 20], price: [1.02, 0.58, 1.46],
    elec: [0, 0, 0], heat: [0, 0, 0], labour: [0.0021, 0.0015, 0.004], seeds: [0.017, 0.012, 0.025], nutr: [0.019, 0.013, 0.03], prot: [0.05, 0.03, 0.08],
    pack: [0.537, 0.43, 0.65], water: [78, 50, 110], waterPrice: [0.21, 0.15, 0.4], other: [0.875, 0.6, 1.2]
  }
};
export const SYSTEM_KEYS = ['vf', 'gh', 'field'];
/** Default values of a system as a flat object of numbers. */
export function defaults(sys) { const s = SYSTEMS[sys], o = {}; for (const k in s) if (Array.isArray(s[k])) o[k] = s[k][0]; else if (typeof s[k] === 'number') o[k] = s[k]; return o; }

/** Capital recovery factor (Lesson 15.3, Eq. 15.3.3). */
export const crf = (r, n) => r === 0 ? 1 / n : r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
/** Hourly labour cost from a Swedish monthly salary (SEK), employer contributions and other labour costs. */
export const swedishWage = c => c.salary * 12 * (1 + c.contrib / 100) * (1 + c.otherLab / 100) / c.hours / c.fx;

/**
 * Yearly cash flows for one system (per m² of growing area).
 * s: system parameters (defaults() + user edits); c: shared context { r (%), n (yr), elPrice, heatPrice, wage, residual }.
 */
export function cashflows(s, c) {
  const n = Math.round(c.n), r = c.r / 100;
  const items = CAPEX.map(it => ({ key: it.key, cost: s['cap' + it.key], life: Math.max(1, s['life' + it.key]) }));
  const I0 = items.reduce((a, it) => a + it.cost, 0);
  const T = [], capex = [], opex = [], parts = [], Q = [], H = [], rev = [];
  for (let t = 0; t <= n; t++) {
    const P = Object.fromEntries(PARTS.map(p => [p.key, 0]));
    let cap = 0;
    for (const it of items) {
      if (it.cost <= 0) continue;
      if (t === 0) cap += it.cost;
      else if (t < n && t % it.life === 0) cap += it.cost;             // replacement at the end of each life
      if (t === n && c.residual) {                                    // straight-line salvage value at the end of the project
        const last = Math.floor((n - 1e-9) / it.life) * it.life; const rem = (last + it.life - n) / it.life;
        if (rem > 0) cap -= it.cost * rem;
      }
    }
    P.capital = cap;
    let h = 0, q = 0;
    if (t >= 1) {
      const ramp = t === 1 ? s.ramp1 / 100 : t === 2 ? s.ramp2 / 100 : 1;
      h = s.yield * ramp; q = h * (1 - s.loss / 100);
      const Y = s.yield;                                              // capacity-based inputs
      P.maint = s.maint / 100 * I0;
      P.elec = s.elec * Y * c.elPrice;
      P.heat = s.heat * Y * c.heatPrice;
      P.labour = s.labour * Y * c.wage;
      P.seeds = s.seeds * Y;
      P.nutr = s.nutr * Y;
      P.prot = s.prot * Y;
      P.pack = s.pack * h;                                            // scales with the harvest
      P.water = s.water * Y * s.waterPrice / 1000;
      P.other = s.other;
    }
    const op = PARTS.reduce((a, p) => a + (p.key === 'capital' ? 0 : P[p.key]), 0);
    T.push(t); capex.push(cap); opex.push(op); parts.push(P); Q.push(q); H.push(h); rev.push(q * s.price);
  }
  return { T, capex, opex, parts, Q, H, rev, I0, n, r };
}

/** NPV of a cash-flow stream at rate r (fraction). */
export const npvAt = (cf, r) => cf.reduce((a, x, t) => a + x / Math.pow(1 + r, t), 0);
/** Internal rate of return by bisection; null if the NPV does not change sign on (−0.95, 3). */
export function irr(cf) {
  let a = -0.95, b = 3, fa = npvAt(cf, a), fb = npvAt(cf, b);
  if (!isFinite(fa) || !isFinite(fb) || fa * fb > 0) return null;
  for (let i = 0; i < 100; i++) { const m = (a + b) / 2, fm = npvAt(cf, m); if (fa * fm <= 0) { b = m; fb = fm; } else { a = m; fa = fm; } }
  return (a + b) / 2;
}
/** First (interpolated) year at which a cumulative series becomes non-negative; null if never. */
function payback(cum) { for (let t = 1; t < cum.length; t++) if (cum[t] >= 0 && cum[t - 1] < 0) return t - 1 + (-cum[t - 1]) / (cum[t] - cum[t - 1]); return cum[0] >= 0 ? 0 : null; }

/** Full evaluation: LCOF, decomposition, NPV, IRR, payback. */
export function evaluate(s, c) {
  const F = cashflows(s, c), r = F.r;
  const d = F.T.map(t => Math.pow(1 + r, -t));
  const pvQ = F.Q.reduce((a, q, t) => a + q * d[t], 0);
  const pv = Object.fromEntries(PARTS.map(p => [p.key, F.parts.reduce((a, P, t) => a + P[p.key] * d[t], 0)]));
  const pvC = PARTS.reduce((a, p) => a + pv[p.key], 0);
  const lcof = pvC / pvQ;
  const perKg = Object.fromEntries(PARTS.map(p => [p.key, pv[p.key] / pvQ]));
  const net = F.T.map((t, i) => F.rev[i] - F.capex[i] - F.opex[i]);
  const cum = [], dcum = []; net.reduce((a, x, i) => { cum.push(a + x); return a + x; }, 0); net.reduce((a, x, i) => { dcum.push(a + x * d[i]); return a + x * d[i]; }, 0);
  return { F, d, pvQ, pvC, pv, lcof, perKg, net, cum, dcum, npv: dcum[dcum.length - 1], irr: irr(net), payback: payback(cum), dpayback: payback(dcum),
    annualised: lcof * s.yield * (1 - s.loss / 100) };
}

/** Fast LCOF (same result as evaluate().lcof, without building the cash-flow tables). */
export function lcofFast(s, c) {
  const n = Math.round(c.n), r = c.r / 100, g = 1 / (1 + r), gn = Math.pow(g, n);
  let pvCap = 0, I0 = 0;
  for (const it of CAPEX) {
    const cost = s['cap' + it.key], life = Math.max(1, s['life' + it.key]); if (!(cost > 0)) continue;
    I0 += cost; pvCap += cost;
    for (let t = life; t < n; t += life) pvCap += cost * Math.pow(g, t);
    if (c.residual) { const last = Math.floor((n - 1e-9) / life) * life, rem = (last + life - n) / life; if (rem > 0) pvCap -= cost * rem * gn; }
  }
  const AF = r === 0 ? n : (1 - gn) / r, Y = s.yield;
  const op = s.maint / 100 * I0 + s.elec * Y * c.elPrice + s.heat * Y * c.heatPrice + s.labour * Y * c.wage + (s.seeds + s.nutr + s.prot) * Y + s.water * Y * s.waterPrice / 1000 + s.other;
  let hPV = 0; for (let t = 1; t <= n; t++) hPV += Y * (t === 1 ? s.ramp1 / 100 : t === 2 ? s.ramp2 / 100 : 1) * Math.pow(g, t);
  return (pvCap + op * AF + s.pack * hPV) / (hPV * (1 - s.loss / 100));
}

/* ---------------------------------------------------------------- uncertainty */
/** Parameters varied in the tornado and the Monte Carlo analysis. kind: 'sys' (system parameter), 'ctx' (shared), 'capx' (all capital items × factor). */
export const UNCERTAIN = [
  { id: 'capx', label: 'Capital cost', kind: 'capx' },
  { id: 'yield', label: 'Yield', kind: 'sys' },
  { id: 'r', label: 'Discount rate', kind: 'ctx', range: [3, 10] },
  { id: 'n', label: 'Project lifetime', kind: 'ctx', range: [10, 25] },
  { id: 'elec', label: 'Electricity use', kind: 'sys' },
  { id: 'elPrice', label: 'Electricity price', kind: 'ctx', range: [0.05, 0.25] },
  { id: 'heat', label: 'Heat use', kind: 'sys' },
  { id: 'heatPrice', label: 'Heat price', kind: 'ctx', range: [0.03, 0.1] },
  { id: 'labour', label: 'Labour hours', kind: 'sys' },
  { id: 'wage', label: 'Wage (±25 %)', kind: 'ctxrel', range: [0.75, 1.25] },
  { id: 'pack', label: 'Packaging and logistics', kind: 'sys' },
  { id: 'loss', label: 'Losses', kind: 'sys' },
  { id: 'ramp1', label: 'First-year ramp-up', kind: 'sys' },
  { id: 'seeds', label: 'Seeds and plants', kind: 'sys' },
  { id: 'other', label: 'Other fixed costs', kind: 'sys' }
];
/** Low/high values of an uncertain parameter for a system (widened to include the current value). */
export function rangeOf(u, sys, s, c) {
  if (u.kind === 'capx') { const def = SYSTEMS[sys]; const sum = j => CAPEX.reduce((a, it) => a + def['cap' + it.key][j], 0); const mid = sum(0); return mid > 0 ? [Math.min(1, sum(1) / mid), Math.max(1, sum(2) / mid)] : [1, 1]; }
  if (u.kind === 'ctx') { const v = c[u.id]; return [Math.min(u.range[0], v), Math.max(u.range[1], v)]; }
  if (u.kind === 'ctxrel') return u.range.slice();
  const def = SYSTEMS[sys][u.id]; const v = s[u.id];
  return [Math.min(def[1], v), Math.max(def[2], v)];
}
/** Apply a value of an uncertain parameter; returns new {s, c}. */
export function applyU(u, v, s, c) {
  const s2 = Object.assign({}, s), c2 = Object.assign({}, c);
  if (u.kind === 'capx') CAPEX.forEach(it => { s2['cap' + it.key] = s['cap' + it.key] * v; });
  else if (u.kind === 'ctx') c2[u.id] = v;
  else if (u.kind === 'ctxrel') c2.wage = c.wage * v;
  else s2[u.id] = v;
  return { s: s2, c: c2 };
}
/** One-at-a-time sensitivity (tornado): LCOF at the low and high value of each parameter. */
export function tornado(sys, s, c) {
  const base = evaluate(s, c).lcof;
  return UNCERTAIN.map(u => {
    const [lo, hi] = rangeOf(u, sys, s, c);
    if (!(hi > lo)) return null;
    const a = applyU(u, lo, s, c), b = applyU(u, hi, s, c);
    return { id: u.id, label: u.label, lo, hi, lcofLo: evaluate(a.s, a.c).lcof, lcofHi: evaluate(b.s, b.c).lcof, base };
  }).filter(x => x && Math.abs(x.lcofHi - x.lcofLo) > 1e-6).sort((x, y) => Math.abs(y.lcofHi - y.lcofLo) - Math.abs(x.lcofHi - x.lcofLo));
}
/** Seeded PRNG (mulberry32). */
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
/** Triangular sample with mode m on [a, b]. */
export function tri(u, a, m, b) { if (b <= a) return a; const f = (m - a) / (b - a); return u < f ? a + Math.sqrt(u * (b - a) * (m - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - m)); }
/** Monte Carlo: all uncertain parameters sampled jointly (independent triangular distributions). */
export function monteCarlo(sys, s, c, N = 2000, seed = 12345) {
  const R = rng(seed), out = [];
  // the discount rate and the project lifetime are choices, not uncertainties: they stay fixed
  const ranges = UNCERTAIN.filter(u => u.id !== 'r' && u.id !== 'n').map(u => ({ u, r: rangeOf(u, sys, s, c), mode: u.kind === 'capx' || u.kind === 'ctxrel' ? 1 : u.kind === 'ctx' ? c[u.id] : s[u.id] }));
  for (let i = 0; i < N; i++) {
    let st = { s, c };
    for (const { u, r, mode } of ranges) { if (!(r[1] > r[0])) continue; const v = tri(R(), r[0], Math.min(r[1], Math.max(r[0], mode)), r[1]); st = applyU(u, v, st.s, st.c); }
    out.push(lcofFast(st.s, st.c));
  }
  out.sort((a, b) => a - b);
  const q = p => out[Math.min(out.length - 1, Math.max(0, Math.round(p * (out.length - 1))))];
  return { samples: out, p10: q(0.1), p50: q(0.5), p90: q(0.9), mean: out.reduce((a, b) => a + b, 0) / out.length, pBelow: price => out.filter(x => x < price).length / out.length };
}
