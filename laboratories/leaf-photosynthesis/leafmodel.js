/* ==========================================================================
   leafmodel.js — leaf gas exchange and energy balance (ES module)
   Shared by /laboratories/leaf-photosynthesis/ and /laboratories/stomata-transpiration/.

   C3 photosynthesis : Farquhar, von Caemmerer & Berry (1980); von Caemmerer (2000)
   Temperature       : Bernacchi et al. (2001) — Kc, Ko, Γ*, Rd, Vcmax activation energies
                       Bernacchi et al. (2003) — J activation energy
                       Kattge & Knorr (2007)   — high-temperature deactivation (Hd, ΔS) of Vcmax, Jmax
                       Sharkey et al. (2007)   — TPU temperature response
   C4 photosynthesis : von Caemmerer (2000) simplified model, parameters of von Caemmerer (2021)
   Stomata           : Medlyn et al. (2011); soil-water factor on g1 as in De Kauwe et al. (2015)
   Energy balance    : Campbell & Norman (1998) — boundary-layer conductances, radiation
   Units: fluxes µmol m⁻² s⁻¹ (CO₂), mol m⁻² s⁻¹ (conductances, H₂O), CO₂ µmol mol⁻¹, O₂ mmol mol⁻¹,
          temperature °C, pressure kPa.
   ========================================================================== */
import { svp, latentHeat, SIGMA, K0, arrheniusPeaked, nonRectHyperbola, R as RGAS } from '/assets/js/physics.js';

/* ------------------------------------------------------------ constants */
export const P_ATM = 101.325;          // kPa
export const CP_MOLAR = 29.3;          // J mol⁻¹ K⁻¹, molar heat capacity of air (Campbell & Norman 1998)
export const EMISSIVITY = 0.97;        // thermal emissivity of leaves (C&N: 0.94–0.99)
export const ABS_PAR = 0.85;           // leaf absorptance for PAR (von Caemmerer 2000)
export const F_SPECTRAL = 0.15;        // spectral-quality correction f (von Caemmerer 2000)
export const THETA_J = 0.7;            // curvature of the J–light response
export const ALPHA_E = ABS_PAR * (1 - F_SPECTRAL) / 2;   // 0.361 mol e⁻ per mol incident photons

/** Normalised Arrhenius function, = 1 at 25 °C. Ea in J mol⁻¹. */
export const arrhenius = (Ea, T) => Math.exp(Ea * (T + K0 - 298.15) / (298.15 * RGAS * (T + K0)));

/* ------------------------------------------------------------ C3 kinetic constants (Bernacchi et al. 2001) */
export const KC25 = 404.9;   // µmol mol⁻¹
export const KO25 = 278.4;   // mmol mol⁻¹
export const GSTAR25 = 42.75; // µmol mol⁻¹ at 21 % O₂ (210 mmol mol⁻¹)
export const kcT = T => KC25 * arrhenius(79430, T);
export const koT = T => KO25 * arrhenius(36380, T);
/** Photorespiratory CO₂ compensation point Γ*, proportional to [O₂]. */
export const gammaStarT = (T, O = 210) => GSTAR25 * arrhenius(37830, T) * O / 210;
/** Vcmax: Bernacchi (2001) Ea = 65.33 kJ mol⁻¹ with Kattge & Knorr (2007) deactivation (Hd 200 kJ mol⁻¹, ΔS at Tgrowth). */
export const vcmaxT = (v25, T, Tg = 25) => arrheniusPeaked(v25, 65330, T, 200000, 668.39 - 1.07 * Tg);
/** Jmax: Bernacchi (2003) Ea = 43.5 kJ mol⁻¹ with Kattge & Knorr (2007) deactivation. */
export const jmaxT = (j25, T, Tg = 25) => arrheniusPeaked(j25, 43540, T, 200000, 659.70 - 0.75 * Tg);
/** TPU: Sharkey et al. (2007) Ha 53.1, Hd 201.8 kJ mol⁻¹, S 0.65 kJ mol⁻¹ K⁻¹. */
export const tpuT = (t25, T) => arrheniusPeaked(t25, 53100, T, 201800, 650);
/** Day respiration Rd: Bernacchi (2001) Ea = 46.39 kJ mol⁻¹. */
export const rdT = (r25, T) => r25 * arrhenius(46390, T);

/** Electron transport rate J (µmol e⁻ m⁻² s⁻¹) from incident PPFD via the non-rectangular hyperbola. */
export const electronTransport = (ppfd, Jmax) => Math.max(0, nonRectHyperbola(Math.max(0, ppfd), ALPHA_E, Math.max(1e-6, Jmax), THETA_J, 0));

/* ------------------------------------------------------------ C3 leaf at a given temperature */
/** Pre-compute temperature-dependent C3 parameters. p: {ppfd, T, O (mmol/mol), vcmax25, jmax25, tpu25?, rd25?} */
export function c3Params(p) {
  const T = p.T, O = p.O ?? 210;
  const Vcmax = vcmaxT(p.vcmax25, T, p.tg ?? 25), Jmax = jmaxT(p.jmax25, T, p.tg ?? 25);
  const TPU = tpuT(p.tpu25 ?? 0.167 * p.vcmax25, T);
  const Rd = rdT(p.rd25 ?? 0.015 * p.vcmax25, T);
  const Kc = kcT(T), Ko = koT(T), gs = gammaStarT(T, O);
  const J = electronTransport(p.ppfd, Jmax);
  return { path: 'C3', T, O, Vcmax, Jmax, TPU, Rd, Kc, Ko, Km: Kc * (1 + O / Ko), gstar: gs, J, ppfd: p.ppfd };
}
/** FvCB rates at intercellular CO₂ Ci (µmol mol⁻¹). Returns net A and the three limitations (each net of photorespiration, before Rd). */
export function c3Rates(Ci, q) {
  const c = Math.max(Ci, 1e-3);
  // gross carboxylation rates allowed by each process; the minimum is taken on these (valid also below Γ*)
  const f = 1 - q.gstar / c;
  const Vcc = q.Vcmax * c / (c + q.Km);
  const Vcj = q.J * c / (4 * c + 8 * q.gstar);
  const Wc = Vcc * f, Wj = Vcj * f, Wp = 3 * q.TPU;
  let Vc = Vcc, lim = 'rubisco';
  if (Vcj < Vc) { Vc = Vcj; lim = 'rubp'; }
  if (f > 0 && Wp < Vc * f) { Vc = Wp / f; lim = 'tpu'; }
  const W = Vc * f;
  const Vo = 2 * q.gstar * Vc / c;
  return { A: W - q.Rd, Wc, Wj, Wp, W, lim, Vc, Vo, PR: 0.5 * Vo, gross: Vc };
}

/* ------------------------------------------------------------ C4 leaf (von Caemmerer 2000, simplified; parameters von Caemmerer 2021) */
export const C4 = { Kp25: 82, Vpr: 80, gbs: 0.003, x: 0.4, EaV: 78000, EaVp: 50100, EaKp: 38300, EaRd: 66400, Topt: 43, Omega: 26 };
export function c4Params(p) {
  const T = p.T;
  const Vcmax = p.vcmax25 * arrhenius(C4.EaV, T);
  const Vpmax = (p.vpmax25 ?? 5 * p.vcmax25) * arrhenius(C4.EaVp, T);
  const Kp = C4.Kp25 * arrhenius(C4.EaKp, T);
  const Rd = (p.rd25 ?? 0.01 * p.vcmax25) * arrhenius(C4.EaRd, T);
  // Gaussian Jmax(T) of von Caemmerer (2021), normalised to 1 at 25 °C
  const Jmax = p.jmax25 * Math.exp(-(((T - C4.Topt) / C4.Omega) ** 2) + (((25 - C4.Topt) / C4.Omega) ** 2));
  const J = electronTransport(p.ppfd, Jmax);
  return { path: 'C4', T, Vcmax, Vpmax, Kp, Rd, Rm: 0.5 * Rd, Jmax, J, gstar: 0, ppfd: p.ppfd, O: p.O ?? 210 };
}
export function c4Rates(Ci, q) {
  const c = Math.max(Ci, 0);
  const Vp = Math.min(c * q.Vpmax / (c + q.Kp), C4.Vpr);
  const Ac1 = Vp - q.Rm + C4.gbs * c;           // PEP carboxylation limited
  const Ac2 = q.Vcmax - q.Rd;                    // Rubisco limited
  const Aj1 = C4.x * q.J / 2 - q.Rm + C4.gbs * c; // light-limited, C4 cycle
  const Aj2 = (1 - C4.x) * q.J / 3 - q.Rd;        // light-limited, C3 cycle
  const Ac = Math.min(Ac1, Ac2), Aj = Math.min(Aj1, Aj2);
  let A = Ac, lim = Ac1 < Ac2 ? 'pepc' : 'rubisco';
  if (Aj < A) { A = Aj; lim = 'light'; }
  // report on the same footing as C3 (limitations before Rd) so charts can share code
  return { A, Wc: Ac + q.Rd, Wj: Aj + q.Rd, Wp: Infinity, W: A + q.Rd, lim, Vc: A + q.Rd, Vo: 0, PR: 0, gross: A + q.Rd, Ac1, Ac2, Aj1, Aj2 };
}

export function leafParams(p) { return p.path === 'C4' ? c4Params(p) : c3Params(p); }
export function leafRates(Ci, q) { return q.path === 'C4' ? c4Rates(Ci, q) : c3Rates(Ci, q); }

/* ------------------------------------------------------------ coupled stomatal model (Medlyn et al. 2011) */
/**
 * Solve A(Ci) = supply(Ci) by bisection (the "iterative" solution of the coupled model).
 * s: { Ca (µmol/mol), D (kPa, leaf-to-air VPD), g0 (mol H₂O m⁻² s⁻¹), g1 (kPa^0.5), beta (0–1, soil water on g1),
 *      gbw (boundary-layer conductance to H₂O, mol m⁻² s⁻¹; Infinity = well-stirred cuvette), gsFixed (optional) }
 * Returns { A, gs, Ci, Cs, gtc, ...rates }.
 */
export function solveCoupled(q, s) {
  const Ca = s.Ca, D = Math.max(0.05, s.D), g0 = Math.max(1e-4, s.g0 ?? 0.01), beta = s.beta ?? 1;
  const gb = s.gbw ?? Infinity;
  const slope = 1.6 * (1 + (s.g1 ?? 4) * beta / Math.sqrt(D));
  const evalAt = Ci => {
    const r = leafRates(Ci, q);
    const Cs = gb === Infinity ? Ca : Math.max(1, Ca - 1.37 * r.A / gb);
    let gs = s.gsFixed != null ? s.gsFixed : g0 + slope * r.A / Cs;
    if (gs < g0) gs = g0;
    const gtc = 1 / (1.6 / gs + (gb === Infinity ? 0 : 1.37 / gb));
    return { r, gs, Cs, gtc, f: r.A - gtc * (Ca - Ci) };
  };
  let lo = 0, hi = Ca + 3000, e = null;
  for (let i = 0; i < 48; i++) {
    const mid = 0.5 * (lo + hi); e = evalAt(mid);
    if (e.f > 0) hi = mid; else lo = mid;
    if (hi - lo < 0.02) break;
  }
  const Ci = 0.5 * (lo + hi); e = evalAt(Ci);
  return Object.assign({}, e.r, { Ci, gs: e.gs, Cs: e.Cs, gtc: e.gtc, Ca, D });
}
/** One-call leaf photosynthesis: parameters + coupled solution. */
export function leafGasExchange(p) {
  const q = leafParams(p);
  const s = solveCoupled(q, p);
  return Object.assign(s, { q, E: s.gs * p.D / P_ATM });   // E mol m⁻² s⁻¹ (well-stirred, leaf-to-air VPD)
}

/* ------------------------------------------------------------ boundary layer (Campbell & Norman 1998) */
/**
 * Boundary-layer conductances for ONE side of a flat leaf, mol m⁻² s⁻¹.
 * Forced convection (laminar flat plate): g_Ha = 0.135 √(u/d), g_va = 0.147 √(u/d);
 * free convection: g_Ha = 0.05 (|ΔT|/d)^¼; d = 0.72 × leaf width; F = turbulence enhancement factor.
 */
export function boundaryLayer(u, width, dT = 0, F = 1) {
  const d = 0.72 * width;
  const forcedH = F * 0.135 * Math.sqrt(Math.max(u, 0) / d);
  const forcedV = F * 0.147 * Math.sqrt(Math.max(u, 0) / d);
  const freeH = 0.05 * Math.pow(Math.abs(dT) / d, 0.25);
  return { d, gHa: forcedH + freeH, gva: forcedV + freeH * 1.09, forcedH, freeH };
}
/** Total leaf vapour conductance (stomata in series with boundary layer). gs = total stomatal conductance (both sides). */
export function vapourConductance(gs, gva, amphi) {
  if (amphi) { const side = 1 / (2 / Math.max(gs, 1e-9) + 1 / gva); return 2 * side; }
  return 1 / (1 / Math.max(gs, 1e-9) + 1 / gva);
}
/** Boundary-layer conductance to H₂O seen by the stomatal model (per leaf, combining both sides for amphistomatous leaves). */
export const gbwLeaf = (gva, amphi) => amphi ? 2 * gva : gva;

/* ------------------------------------------------------------ radiation */
/** Absorbed shortwave (W m⁻², per unit leaf area) for a PPFD from the sun or from LEDs. */
export function absorbedShortwave(ppfd, source = 'sun') {
  if (source === 'led') return ABS_PAR * ppfd / 4.6;               // LEDs: essentially all energy in PAR, ≈ 4.6 µmol J⁻¹
  const S = ppfd / 2.02;                                              // global shortwave, W m⁻² (≈ 2.02 µmol J⁻¹ of sunlight)
  return (ABS_PAR * 0.45 + 0.20 * 0.55) * S;                          // PAR ≈ 45 % of solar energy, NIR absorptance ≈ 0.2
}

/* ------------------------------------------------------------ leaf energy balance */
/**
 * Solve Rabs = 2εσT_L⁴ + 2 c_p g_Ha (T_L − T_a) + λ g_v (e_s(T_L) − e_a)/P for leaf temperature by bisection.
 * env: { Ta, ea (kPa), u (m/s), width (m), ppfd, source, Tsur (°C, surroundings, default Ta), F, amphi, P }
 * gsFn(TL) → total stomatal conductance (mol m⁻² s⁻¹) at leaf temperature TL (or a number).
 */
export function leafEnergyBalance(env, gsFn) {
  const P = env.P ?? P_ATM, Ta = env.Ta, ea = env.ea, amphi = !!env.amphi;
  const Tsur = env.Tsur ?? Ta;
  const Rsw = absorbedShortwave(env.ppfd, env.source);
  const Rlw = 2 * EMISSIVITY * SIGMA * (Tsur + K0) ** 4;
  const Rabs = Rsw + Rlw;
  const terms = TL => {
    const bl = boundaryLayer(env.u, env.width, TL - Ta, env.F ?? 1);
    const gs = typeof gsFn === 'function' ? gsFn(TL, bl) : gsFn;
    const gv = vapourConductance(gs, bl.gva, amphi);
    const lam = latentHeat(TL) * 0.018015;          // J mol⁻¹
    const emit = 2 * EMISSIVITY * SIGMA * (TL + K0) ** 4;
    const H = 2 * CP_MOLAR * bl.gHa * (TL - Ta);
    const E = gv * Math.max(0, svp(TL) - ea) / P;    // mol m⁻² s⁻¹ (no dew)
    const LE = lam * E;
    return { bl, gs, gv, lam, emit, H, E, LE, res: Rabs - emit - H - LE };
  };
  let lo = Ta - 25, hi = Ta + 30, t = null;
  for (let i = 0; i < 50; i++) {
    const mid = 0.5 * (lo + hi); t = terms(mid);
    if (t.res > 0) lo = mid; else hi = mid;
    if (hi - lo < 1e-3) break;
  }
  const TL = 0.5 * (lo + hi); t = terms(TL);
  return { TL, dT: TL - Ta, Rsw, Rlw, Rabs, Rn: Rabs - t.emit, ...t, VPDleaf: Math.max(0, svp(TL) - ea) };
}

/**
 * Full coupled leaf: energy balance + stomata + photosynthesis. Stomatal conductance at each trial leaf temperature is
 * obtained from the Medlyn–FvCB coupled solution at that temperature and leaf-to-air VPD.
 * leaf: { path, vcmax25, jmax25, g0, g1, beta, Ca, O }
 */
export function coupledLeaf(env, leaf, { gsFixed } = {}) {
  let last = null;
  const gsFn = (TL, bl) => {
    if (gsFixed != null) return gsFixed;
    const D = Math.max(0.05, svp(TL) - env.ea);
    const q = leafParams({ path: leaf.path, T: TL, O: leaf.O ?? 210, ppfd: env.ppfd, vcmax25: leaf.vcmax25, jmax25: leaf.jmax25 });
    last = solveCoupled(q, { Ca: leaf.Ca, D, g0: leaf.g0, g1: leaf.g1, beta: leaf.beta, gbw: gbwLeaf(bl.gva, env.amphi) });
    return last.gs;
  };
  const eb = leafEnergyBalance(env, gsFn);
  // photosynthesis at the final leaf temperature (recompute with the actual gs)
  const D = Math.max(0.05, svp(eb.TL) - env.ea);
  const q = leafParams({ path: leaf.path, T: eb.TL, O: leaf.O ?? 210, ppfd: env.ppfd, vcmax25: leaf.vcmax25, jmax25: leaf.jmax25 });
  const ps = solveCoupled(q, { Ca: leaf.Ca, D, g0: leaf.g0, g1: leaf.g1, beta: leaf.beta, gbw: gbwLeaf(eb.bl.gva, env.amphi), gsFixed: gsFixed ?? undefined });
  return Object.assign(eb, { ps, A: ps.A, Ci: ps.Ci, D });
}

/* ------------------------------------------------------------ stomatal anatomy (Franks & Farquhar 2001; Franks & Beerling 2009) */
export const DV25 = 2.49e-5;                  // m² s⁻¹, diffusivity of water vapour in air at 25 °C
export const molarVolume = (T = 25, P = P_ATM) => RGAS * (T + K0) / (P * 1000);   // m³ mol⁻¹
/** Conductance (mol m⁻² s⁻¹) of `density` pores m⁻² of area a (m²) and depth l (m), with end correction. */
export function poreConductance(a, density, l, T = 25) {
  return DV25 / molarVolume(T) * density * a / (l + Math.PI / 2 * Math.sqrt(a / Math.PI));
}
/** Invert poreConductance: pore area a (m²) that gives conductance g. */
export function poreAreaFor(g, density, l, T = 25) {
  const K = DV25 / molarVolume(T) * density, c = Math.sqrt(Math.PI) / 2;
  if (g <= 0) return 0;
  const x = (g * c + Math.sqrt(g * g * c * c + 4 * K * g * l)) / (2 * K);
  return x * x;
}

/* ------------------------------------------------------------ helpers */
export const LIMIT_LABEL = { rubisco: 'Rubisco (carboxylation)', rubp: 'RuBP regeneration (electron transport)', tpu: 'Triose-phosphate use (TPU)', pepc: 'PEP carboxylase (CO₂ pump)', light: 'Light (electron transport)' };
export const LIMIT_SHORT = { rubisco: 'Rubisco', rubp: 'RuBP regen.', tpu: 'TPU', pepc: 'PEPC', light: 'Light' };
