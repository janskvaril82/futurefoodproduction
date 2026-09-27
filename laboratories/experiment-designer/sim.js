/* ==========================================================================
   sim.js — growth-room experiment simulator (pure functions, no DOM)
   Future Food Production · laboratory "Growth-room experiment designer"

   Model (Derive tab, Eqs. X1–X8):
     y_jk = B · τ_i · g(position of tray j) + u_j + e_jk                (X1)
       B   baseline fresh weight of a lettuce head in an average position
       τ_i = 1 + Δ·π_i   true relative effect of treatment i (π_1 = 0 … π_t = 1)
       g   hidden growth-potential field of the room (light × temperature × draught), mean 1
       u_j ~ N(0, σ_tray²)  tray effect (own reservoir, pump, handling …)
       e_jk ~ N(0, σ_plant²) plant-to-plant variation within a tray
   Designs: systematic, completely randomised (CRD), randomised complete block
   (RCBD, block = shelf) and pseudo-replicated (one tray per treatment).
   Analyses: one-way ANOVA on tray means, RCBD ANOVA on tray means, and the
   (invalid) plant-level ANOVA of the pseudo-replicated design — all from stats.js.
   ========================================================================== */
import { mean, anova1, anovaRCBD, tTestWelch, tInv, mulberry32, shuffle } from '../../assets/js/stats.js';
import { gaussian } from './stats-extra.js';

/* ------------------------------------------------------------------ geometry of the room (metres) */
export const RACKS = 2, LEVELS = 4, SLOTS = 4;
export const GEOM = {
  roomW: 6.4, roomD: 5.2, roomH: 2.9,        // x from −3.2 to 3.2, z from −2.6 to 2.6
  rackX: [-1.45, 1.35], rackZ: -2.15,         // two racks side by side along the back wall, fronts facing +z
  rackW: 2.4, rackD: 0.62, levelH: 0.5, baseH: 0.24,
  doorX: -3.2, doorZ: -0.9, doorW: 0.95, doorH: 2.05   // door in the left end wall, near the door end of rack A
};
export const slotX = (rack, k) => GEOM.rackX[rack] - GEOM.rackW / 2 + (k + 0.5) * GEOM.rackW / SLOTS;
export const shelfY = level => GEOM.baseH + level * GEOM.levelH;        // top of the shelf deck ≈ y + 0.035
export const canopyY = level => shelfY(level) + 0.2;
export const rackName = r => (r === 0 ? 'A' : 'B');
/** Shelves in the order a student fills them: rack A top → bottom, then rack B top → bottom. */
export const shelfOrder = b => ({ rack: b >> 2, level: 3 - (b & 3) });
export const shelfName = (rack, level) => `${rackName(rack)}${level + 1}`;   // A4 = top shelf of rack A

/* ------------------------------------------------------------------ hidden spatial gradients (X2–X4) */
export const PPFD0 = 250;            // µmol m⁻² s⁻¹ at the canopy, centre of the best shelf
export const T_BASE = 21.2;          // °C at the bottom-shelf canopy away from the door
export const T_OPT_REF = 22;         // °C, reference for the temperature response
const SHELF_LIGHT = [0.88, 0.93, 0.97, 1.0];   // bottom → top: ageing drivers below, ceiling light on top
const END_LOSS = 0.16;               // relative PPFD loss at the very end of a shelf (u = ±1)
const RACK_B_LIGHT = 0.03;           // rack B has newer LED modules
const STRAT = 1.5;                   // °C per metre of height (thermal stratification)
const DRAUGHT_T = 2.5;               // °C cooling in the core of the draught
const DRAUGHT_STRESS = 0.06;         // extra growth loss in the draught (air speed, leaf cooling)
const LIGHT_EXP = 0.8;               // fresh weight ∝ PPFD^0.8 in this range
const T_SENS = 0.03;                 // +3 % fresh weight per °C around 22 °C

/** Draught intensity 0–1 at position x along the racks and shelf level (cold air enters low from the door). */
export const DRAUGHT_L = 0.9, DRAUGHT_D0 = 0.6;   // decay length and undisturbed core length, m
export function draught(x, level) {
  const d = x - GEOM.doorX - DRAUGHT_D0;                // metres beyond the core of the jet
  return Math.min(1, Math.exp(-Math.max(0, d) / DRAUGHT_L)) * (1 - 0.2 * level);
}
/** Raw fields at a point: relative PPFD, PPFD, air temperature, draught and un-normalised growth factor. */
export function fieldAt(x, level, rack, G) {
  const u = Math.max(-1, Math.min(1, (x - GEOM.rackX[rack]) / (GEOM.rackW / 2)));
  const rel = (1 - G * (1 - SHELF_LIGHT[level])) * (1 - G * END_LOSS * u * u) * (1 + G * (rack === 1 ? RACK_B_LIGHT : 0));
  const D = draught(x, level);
  const T = T_BASE + G * STRAT * (canopyY(level) - canopyY(0)) - G * DRAUGHT_T * D;
  const gRaw = Math.pow(rel, LIGHT_EXP) * (1 + T_SENS * (T - T_OPT_REF)) * (1 - G * DRAUGHT_STRESS * D);
  return { rel, ppfd: PPFD0 * rel, T, D, gRaw };
}
const gCache = new Map();
/** Growth-potential factor of every slot (rack, level, slot), normalised to a room mean of 1. */
export function growthTable(G) {
  const key = G.toFixed(4); if (gCache.has(key)) return gCache.get(key);
  const tab = []; let s = 0;
  for (let r = 0; r < RACKS; r++) for (let l = 0; l < LEVELS; l++) for (let k = 0; k < SLOTS; k++) { const f = fieldAt(slotX(r, k), l, r, G); tab.push(f.gRaw); s += f.gRaw; }
  const m = s / tab.length; const out = { norm: m, g: tab.map(v => v / m) };
  gCache.set(key, out); return out;
}
export const posIndex = (rack, level, slot) => (rack * LEVELS + level) * SLOTS + slot;
export const gAt = (G, rack, level, slot) => growthTable(G).g[posIndex(rack, level, slot)];
/** Normalised growth factor at an arbitrary x (for heat maps). */
export const gField = (x, level, rack, G) => fieldAt(x, level, rack, G).gRaw / growthTable(G).norm;

/* ------------------------------------------------------------------ treatments */
export const FACTORS = {
  spectrum: {
    name: 'LED spectrum', unit: 'spectrum', applied: 'each tray sits in its own light-tight compartment with its own LED module',
    levels: { 2: ['Red–blue', 'White + far-red'], 3: ['Red–blue', 'White', 'White + far-red'], 4: ['Red–blue', 'White', 'White + red', 'White + far-red'] },
    led: { 'Red–blue': 'redblue', 'White': 'white', 'White + red': ['white', 'white', 'deepred', 'white'], 'White + far-red': ['white', 'white', 'farred', 'white', 'deepred'] }
  },
  ec: {
    name: 'Nutrient EC', unit: 'EC', applied: 'each tray is an ebb-and-flow tray with its own reservoir',
    levels: { 2: ['EC 1.0', 'EC 2.0'], 3: ['EC 1.0', 'EC 1.6', 'EC 2.2'], 4: ['EC 0.8', 'EC 1.2', 'EC 1.6', 'EC 2.0'] },
    led: {}
  }
};
export const PROFILE = { 2: [0, 1], 3: [0, 0.5, 1], 4: [0, 0.35, 0.7, 1] };
export const TRT_COLORS = ['#e0457b', '#2f86e0', '#f0a42c', '#8b62d6'];   // theme-independent (also used in 3D)
export const DESIGNS = {
  systematic: { name: 'Systematic', short: 'Systematic', long: 'Systematic (treatments grouped)' },
  crd: { name: 'Completely randomised', short: 'CRD', long: 'Completely randomised design (CRD)' },
  rcbd: { name: 'RCBD (block = shelf)', short: 'RCBD', long: 'Randomised complete block design, block = shelf' },
  pseudo: { name: 'Pseudo-replicated', short: 'Pseudo-rep.', long: 'Pseudo-replicated: one tray per treatment' }
};
export const DESIGN_KEYS = ['systematic', 'crd', 'rcbd', 'pseudo'];

/* ------------------------------------------------------------------ layouts */
/**
 * Assign treatments to tray positions. The same area is used by every design: the first r shelves
 * (rack A top → bottom, then rack B) × the first t slots from the door. Returns { design, t, r, trays[] }
 * with trays { trt, rep, block, rack, level, slot }.
 */
export function makeLayout(design, t, r, rng = Math.random) {
  const pos = [];
  for (let b = 0; b < r; b++) { const s = shelfOrder(b); for (let k = 0; k < t; k++) pos.push({ rack: s.rack, level: s.level, slot: k, block: b }); }
  let trays;
  if (design === 'systematic') trays = pos.map((p, i) => Object.assign({ trt: Math.floor(i / r) }, p));
  else if (design === 'crd') { const lab = shuffle(pos.map((_, i) => Math.floor(i / r)), rng); trays = pos.map((p, i) => Object.assign({ trt: lab[i] }, p)); }
  else if (design === 'rcbd') {
    trays = [];
    for (let b = 0; b < r; b++) { const perm = shuffle([...Array(t).keys()], rng); for (let k = 0; k < t; k++) trays.push(Object.assign({ trt: perm[k] }, pos[b * t + k])); }
  } else { // pseudo: one tray per treatment, at random positions within the same area
    const pick = shuffle(pos, rng).slice(0, t); trays = pick.map((p, i) => Object.assign({ trt: i }, p));
  }
  const cnt = new Array(t).fill(0); trays.forEach(tr => { tr.rep = cnt[tr.trt]++; });
  return { design, t, r, trays };
}

/* ------------------------------------------------------------------ one experiment (X1) */
/** P = { B, delta, G, sdTray, sdPlant, n }. Returns per tray { g, mu, u, plants: Float64Array, mean }. */
export function simulate(layout, P, gauss) {
  const prof = PROFILE[layout.t]; const tab = growthTable(P.G).g;
  return layout.trays.map(tr => {
    const g = tab[posIndex(tr.rack, tr.level, tr.slot)];
    const mu = P.B * (1 + P.delta * prof[tr.trt]) * g;
    const u = P.sdTray * gauss();
    const plants = new Float64Array(P.n); let s = 0;
    for (let j = 0; j < P.n; j++) { const y = Math.max(5, mu + u + P.sdPlant * gauss()); plants[j] = y; s += y; }
    return { g, mu, u, plants, mean: s / P.n };
  });
}

/* ------------------------------------------------------------------ analysis */
/**
 * The analysis that matches each design (the pseudo-replicated design gets the plant-level ANOVA that is
 * usually — wrongly — applied to it). Contrast of interest: treatment t (largest true effect) minus treatment 1.
 * fast = true skips the confidence interval (Monte Carlo).
 */
export function analyse(layout, sim, fast = false) {
  const t = layout.t, T = layout.trays, last = t - 1;
  if (layout.design === 'pseudo') {
    const groups = Array.from({ length: t }, () => []);
    T.forEach((tr, i) => { for (const v of sim[i].plants) groups[tr.trt].push(v); });
    const A = anova1(groups); const est = A.means[last] - A.means[0];
    const out = { kind: 'pseudo', F: A.F, df1: A.df1, df2: A.df2, p: A.p, est, means: A.means, A };
    if (!fast) { const w = tTestWelch(groups[last], groups[0]); out.ci = w.ci95; out.naive = w; }
    return out;
  }
  if (layout.design === 'rcbd') {
    const m = Array.from({ length: layout.r }, () => new Array(t).fill(NaN));
    T.forEach((tr, i) => { m[tr.block][tr.trt] = sim[i].mean; });
    const R = anovaRCBD(m); const est = R.tMeans[last] - R.tMeans[0];
    const out = { kind: 'rcbd', F: R.treatment.F, df1: R.treatment.df, df2: R.error.df, p: R.treatment.p, est, means: R.tMeans, R };
    if (!fast) { const se = Math.sqrt(2 * R.error.ms / layout.r), tc = tInv(0.975, R.error.df); out.ci = [est - tc * se, est + tc * se]; out.se = se; }
    return out;
  }
  const groups = Array.from({ length: t }, () => []);
  T.forEach((tr, i) => groups[tr.trt].push(sim[i].mean));
  const A = anova1(groups); const est = A.means[last] - A.means[0];
  const out = { kind: 'oneway', F: A.F, df1: A.df1, df2: A.df2, p: A.p, est, means: A.means, A };
  if (!fast) { const w = tTestWelch(groups[last], groups[0]); out.ci = w.ci95; out.welch = w; }
  return out;
}
/** Plant-level ANOVA of any layout — what you get if plants are (wrongly) treated as replicates. */
export function plantLevel(layout, sim) {
  const groups = Array.from({ length: layout.t }, () => []);
  layout.trays.forEach((tr, i) => { for (const v of sim[i].plants) groups[tr.trt].push(v); });
  return anova1(groups);
}

/* ------------------------------------------------------------------ expected values (known only to the simulator) */
/** True effect (treatment t − treatment 1, g) averaged over the positions the design occupies. */
export function trueEffect(t, r, P) {
  const L = makeLayout('systematic', t, r); const gm = mean(L.trays.map(tr => gAt(P.G, tr.rack, tr.level, tr.slot)));
  return P.B * P.delta * PROFILE[t][t - 1] * gm;
}
/** Expected estimate of a fixed layout (no noise): shows the bias of a confounded (systematic) layout. */
export function expectedEstimate(layout, P) {
  const prof = PROFILE[layout.t]; const s = new Array(layout.t).fill(0), c = new Array(layout.t).fill(0);
  layout.trays.forEach(tr => { s[tr.trt] += P.B * (1 + P.delta * prof[tr.trt]) * gAt(P.G, tr.rack, tr.level, tr.slot); c[tr.trt]++; });
  return s[layout.t - 1] / c[layout.t - 1] - s[0] / c[0];
}

/* ------------------------------------------------------------------ Monte Carlo */
/**
 * Repeat the whole experiment `runs` times (a new randomisation, new trays and plants every time).
 * `analysisN` overrides the replicate count: for the pseudo-replicated design it is the number of plants per tray.
 * Returns { est: Float64Array, p: Float64Array, rej, rate }.
 */
export function monteCarlo({ design, t, r, P, runs = 1000, seed = 1, alpha = 0.05 }) {
  const rng = mulberry32(seed), gauss = gaussian(rng);
  const est = new Float64Array(runs), pv = new Float64Array(runs); let rej = 0;
  for (let k = 0; k < runs; k++) {
    const L = makeLayout(design, t, r, rng); const S = simulate(L, P, gauss); const A = analyse(L, S, true);
    est[k] = A.est; pv[k] = A.p; if (A.p < alpha) rej++;
  }
  return { est, p: pv, rej, rate: rej / runs };
}
export { mulberry32, gaussian };
