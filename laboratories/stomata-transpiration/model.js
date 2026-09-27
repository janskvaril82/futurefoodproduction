/* ==========================================================================
   model.js — leaf energy balance, stomatal conductance and transpiration
   for /laboratories/stomata-transpiration/ (ES module).

   Energy balance     : Campbell & Norman (1998), ch. 7, 10, 12, 14
   Boundary layer     : C&N (1998) flat-plate conductances, d = 0.72 × leaf width
                        forced  g_Ha = 0.135 √(u/d), g_va = 0.147 √(u/d)
                        free    g_Ha = 0.05 (ΔT/d)^¼,  g_va = 0.055 (ΔT/d)^¼  (added, as in Leuning et al. 1995)
   Sky long-wave      : clear-sky emissivity 1.72 (e_a/T_a)^(1/7) (C&N 1998, eq. 10.10; Brutsaert 1975)
   Photosynthesis     : Farquhar–von Caemmerer–Berry + Bernacchi temperature functions (shared with
                        /laboratories/leaf-photosynthesis/leafmodel.js — the same leaf as in that lab)
   Stomata            : Medlyn et al. (2011) coupled to FvCB; drought (ABA) factor β on g₁
                        (De Kauwe et al. 2015), β = min(1, REW/0.4) (Granier et al. 1999)
   Stomatal dynamics  : first-order relaxation towards the steady-state g_s, time constant τ
   Units: T °C, vapour pressure kPa, conductances mol m⁻² s⁻¹ (per unit one-sided leaf area),
          fluxes W m⁻² or mol m⁻² s⁻¹, CO₂ µmol mol⁻¹, PPFD µmol m⁻² s⁻¹, leaf width m.
   ========================================================================== */
import { svp, svpSlope, latentHeat, SIGMA, K0 } from '/assets/js/physics.js';
import { leafParams, solveCoupled, poreAreaFor, poreConductance, absorbedShortwave } from '/laboratories/leaf-photosynthesis/leafmodel.js';

export const CP = 29.3;          // J mol⁻¹ K⁻¹, molar heat capacity of air (C&N 1998)
export const EPS = 0.97;         // thermal emissivity of a leaf (C&N 1998: 0.94–0.99)
export const MW = 0.018015;      // kg mol⁻¹, molar mass of water
export const P_KPA = 101.325;

/** Default C3 leaf — identical to the default leaf of the photosynthesis laboratory. */
export const LEAF = { path: 'C3', vcmax25: 80, jmax25: 135, tpu25: 12, g0: 0.01, g1: 5.8 };

/** Stomatal anatomy of the 3D epidermis patch (per leaf side). density is set by the 3D generator. */
export const ANAT = { density: 128e6, poreLen: 16e-6, depth: 10e-6, wMax: 9e-6 };

/* ------------------------------------------------------------ boundary layer */
/** One-sided mean boundary-layer conductances (mol m⁻² s⁻¹) for heat and water vapour. u m s⁻¹, w leaf width m. */
export function boundaryLayer(u, w, dT = 0) {
  const d = 0.72 * w;
  const s = Math.sqrt(Math.max(u, 0.005) / d);
  const fr = Math.pow(Math.abs(dT) / d, 0.25);
  const gHf = 0.135 * s, gVf = 0.147 * s, gHn = 0.05 * fr, gVn = 0.055 * fr;
  return { d, gHforced: gHf, gVforced: gVf, gHfree: gHn, gVfree: gVn, gH: gHf + gHn, gV: gVf + gVn, freeShare: gHn / (gHf + gHn) };
}
/** Effective thickness of the diffusion boundary layer, m: δ = D_v c / g_va (c = molar density of air). */
export const blThickness = (gV, T = 20) => 2.42e-5 * (1 + 0.007 * (T - 20)) * (P_KPA * 1000 / (8.314 * (T + K0))) / gV;

/** Total conductance for water vapour of the whole leaf: stomata in series with the boundary layer. */
export function vapourConductance(gs, gV, amphi) {
  const g = Math.max(gs, 1e-6);
  return amphi ? 2 / (2 / g + 1 / gV) : 1 / (1 / g + 1 / gV);
}

/* ------------------------------------------------------------ radiation */
/** Absorbed short- and long-wave radiation per unit leaf area (W m⁻²). env: ppfd, src 'sun'|'led', sur 'room'|'sky', Ta, ea. */
export function radiation(env) {
  const Rsw = absorbedShortwave(Math.max(0, env.ppfd), env.src);
  const TaK = env.Ta + K0;
  const Lground = SIGMA * TaK ** 4;                  // floor / soil at air temperature
  let epsSky = 1, Lsky = Lground;                    // indoor: walls and roof at air temperature
  if (env.sur === 'sky') { epsSky = Math.min(1, 1.72 * Math.pow(Math.max(env.ea, 0.01) / TaK, 1 / 7)); Lsky = epsSky * SIGMA * TaK ** 4; }
  const Rlw = EPS * (Lsky + Lground);
  return { Rsw, Rlw, Rabs: Rsw + Rlw, Lsky, Lground, epsSky };
}

/* ------------------------------------------------------------ water stress (root-sourced ABA) */
/** Drought factor β on the stomatal slope g₁ from relative extractable water REW (0–1): 1 above REW = 0.4, linear to 0. */
export const betaFromREW = rew => Math.max(0, Math.min(1, rew / 0.4));

/* ------------------------------------------------------------ energy-balance terms at a trial leaf temperature */
function terms(T, env, gs, rad) {
  const b = boundaryLayer(env.u, env.w, T - env.Ta);
  const gtv = vapourConductance(gs, b.gV, env.amphi);
  const lam = latentHeat(T) * MW;                    // J mol⁻¹
  const emit = 2 * EPS * SIGMA * (T + K0) ** 4;      // both sides
  const H = 2 * CP * b.gH * (T - env.Ta);            // both sides
  const D = svp(T) - env.ea;                         // leaf-to-air vapour-pressure difference, kPa
  // transpiration through stomata; if the leaf is below the dew point, water condenses on both surfaces (boundary layer only)
  const E = D >= 0 ? gtv * D / env.P : 2 * b.gV * D / env.P;
  const LE = lam * E;
  return { b, gtv, lam, emit, H, D, E, LE, res: rad.Rabs - emit - H - LE };
}
/** Root of a decreasing function on [lo, hi] (Illinois variant of regula falsi). */
function solveDecreasing(f, lo, hi, tol = 0.002) {
  let a = lo, b = hi, fa = f(a), fb = f(b), side = 0;
  if (fa <= 0) return a; if (fb >= 0) return b;
  for (let i = 0; i < 60; i++) {
    const c = (a * fb - b * fa) / (fb - fa), fc = f(c);
    if (Math.abs(fc) < 1e-6 || Math.abs(b - a) < tol) return c;
    if (fc > 0) { a = c; fa = fc; if (side === -1) fb /= 2; side = -1; }
    else { b = c; fb = fc; if (side === 1) fa /= 2; side = 1; }
  }
  return 0.5 * (a + b);
}

/* ------------------------------------------------------------ coupled steady state */
function photo(env, leaf, T, gbTotal, gsFixed) {
  const q = leafParams({ path: leaf.path, T, O: 210, ppfd: Math.max(0, env.ppfd), vcmax25: leaf.vcmax25, jmax25: leaf.jmax25, tpu25: leaf.tpu25, tg: 25 });
  return solveCoupled(q, { Ca: env.co2, D: Math.max(0.05, svp(T) - env.ea), g0: leaf.g0, g1: leaf.g1, beta: env.beta, gbw: gbTotal, gsFixed });
}
/**
 * Steady state of the whole leaf: leaf temperature, stomatal conductance, transpiration and photosynthesis
 * that satisfy the energy balance (S1) and the Medlyn–FvCB model (S7) simultaneously.
 */
export function steadyLeaf(env, leaf = LEAF) {
  const rad = radiation(env);
  let ps = null;
  const f = T => {
    const b = boundaryLayer(env.u, env.w, T - env.Ta);
    ps = photo(env, leaf, T, env.amphi ? 2 * b.gV : b.gV);
    return terms(T, env, ps.gs, rad).res;
  };
  const T = solveDecreasing(f, env.Ta - 25, env.Ta + 30);
  const b = boundaryLayer(env.u, env.w, T - env.Ta);
  ps = photo(env, leaf, T, env.amphi ? 2 * b.gV : b.gV);
  return finish(T, terms(T, env, ps.gs, rad), ps, rad, env, ps.gs);
}
/** Leaf state for a GIVEN stomatal conductance (used for stomatal dynamics and for 'fixed g_s' comparisons). */
export function leafWithGs(env, gs, leaf = LEAF) {
  const rad = radiation(env);
  const T = solveDecreasing(T => terms(T, env, gs, rad).res, env.Ta - 25, env.Ta + 30);
  const t = terms(T, env, gs, rad);
  const ps = photo(env, leaf, T, env.amphi ? 2 * t.b.gV : t.b.gV, Math.max(gs, leaf.g0));
  return finish(T, t, ps, rad, env, gs);
}
function finish(T, t, ps, rad, env, gs) {
  const s = svpSlope(env.Ta), gam = CP * env.P / (latentHeat(env.Ta) * MW);
  const eps = s / gam;
  const gbv = env.amphi ? 2 * t.b.gV : t.b.gV;       // boundary layer in series with the stomata (total)
  const omega = (eps + 1) / (eps + 1 + gbv / Math.max(gs, 1e-6));
  const gSide = env.amphi ? gs / 2 : gs;             // conductance of the (lower) surface shown in 3D
  const poreW = poreWidth(gSide, T);
  const Dair = svp(env.Ta) - env.ea;
  return {
    TL: T, dT: T - env.Ta, Ta: env.Ta, ea: env.ea, gs, gSide, gbV: t.b.gV, gbH: t.b.gH, gtv: t.gtv, freeShare: t.b.freeShare, d: t.b.d,
    E: t.E, Emmol: t.E * 1000, LE: t.LE, H: t.H, emit: t.emit, Rabs: rad.Rabs, Rsw: rad.Rsw, Rlw: rad.Rlw, Rn: rad.Rabs - t.emit,
    epsSky: rad.epsSky, Dleaf: t.D, Dair, A: ps.A, Ci: ps.Ci, lim: ps.lim, omega, bowen: t.H / (Math.abs(t.LE) > 1e-6 ? t.LE : 1e-6),
    lam: t.lam, poreW, dew: t.D < 0, delta: blThickness(t.b.gV, env.Ta)
  };
}

/* ------------------------------------------------------------ anatomy: conductance ↔ aperture */
/** Pore width (m) of an elliptical pore (length ANAT.poreLen) that gives conductance g on one leaf side. */
export function poreWidth(gSide, T = 25) {
  const a = poreAreaFor(Math.max(0, gSide), ANAT.density, ANAT.depth, T);
  return 4 * a / (Math.PI * ANAT.poreLen);
}
/** Anatomical maximum conductance of one side (all pores open to ANAT.wMax). */
export const gSideMax = () => poreConductance(Math.PI / 4 * ANAT.poreLen * ANAT.wMax, ANAT.density, ANAT.depth);

/* ------------------------------------------------------------ Penman–Monteith for a leaf (analytic check) */
/** Linearised solution (C&N 1998, ch. 14): λE = (s·Rni + c_p·g_Hr·D_a)/(s + γ*), γ* = γ·g_Hr/g_v. */
export function penmanMonteithLeaf(env, gs, gH, gV) {
  const rad = radiation(env);
  const b = boundaryLayer(env.u, env.w, 0);
  gH = gH ?? b.gH; gV = gV ?? b.gV;                                    // pass the conductances of the full solution for a fair check
  const TaK = env.Ta + K0;
  const Rni = rad.Rabs - 2 * EPS * SIGMA * TaK ** 4;                   // isothermal net radiation
  const gr = 4 * 2 * EPS * SIGMA * TaK ** 3 / CP;                      // radiative conductance (both sides)
  const gHr = 2 * gH + gr;
  const gv = vapourConductance(gs, gV, env.amphi);
  const s = svpSlope(env.Ta), lam = latentHeat(env.Ta) * MW, gam = CP * env.P / lam;
  const Da = svp(env.Ta) - env.ea;
  const gstar = gam * gHr / gv;
  const LE = (s * Rni + CP * gHr * Da) / (s + gstar);
  // leaf–air temperature difference from the linearised energy balance: c_p g_Hr ΔT = Rni − λE
  return { LE, E: LE / lam, dT: (Rni - LE) / (CP * gHr), Rni, gHr, gv, gstar, s, gam, Da };
}

/* ------------------------------------------------------------ the day course */
/** Environment at clock hour h (0–24) from the slider settings p (the sliders give midday PPFD and daily mean T). */
export function envAt(p, h) {
  const day = p.daylen, on = 12 - day / 2, off = 12 + day / 2;
  let ppfd = 0, light = 0;
  if (p.src === 'led') {
    // photoperiod centred on noon, 10-minute ramps
    const r = 10 / 60; light = Math.max(0, Math.min(1, (h - on) / r, (off - h) / r)); ppfd = p.ppfd * light;
  } else {
    const x = (h - on) / day; light = x > 0 && x < 1 ? Math.pow(Math.sin(Math.PI * x), 1.25) : 0; ppfd = p.ppfd * light;
  }
  let Ta;
  if (p.src === 'led') {
    // the room warms by the swing during the photoperiod (first-order, 45 min) and cools at night
    const k = 0.75;
    const since = h >= on && h < off ? h - on : null;
    const warm = since != null ? 1 - Math.exp(-since / k) : Math.exp(-((h - off + 24) % 24) / k);
    Ta = p.Ta - p.tswing + 2 * p.tswing * warm;
  } else Ta = p.Ta + p.tswing * Math.sin(2 * Math.PI * (h - 9) / 24);   // maximum at 15:00, minimum at 03:00
  return { ...p, ppfd, Ta, h, light };
}
/**
 * Simulate 24 h (00:00 → 24:00) with stomatal dynamics: dg_s/dt = (g_s,ss − g_s)/τ.
 * Returns arrays sampled every dt seconds and daily totals.
 */
export function simulateDay(p, leaf = LEAF, { dt = 180, tau = 600 } = {}) {
  const n = Math.round(86400 / dt);
  const out = { h: [], ppfd: [], Ta: [], rh: [], Dair: [], gs: [], gss: [], E: [], TL: [], dT: [], A: [], poreW: [], LE: [], H: [], Rn: [] };
  // spin up over the last two hours of the previous day so the start is not an arbitrary steady state
  let gs = steadyLeaf(envAt(p, 22), leaf).gs;
  for (let s = 22 * 3600; s < 24 * 3600; s += dt) { const e = envAt(p, s / 3600); const tgt = steadyLeaf(e, leaf).gs; gs = tgt + (gs - tgt) * Math.exp(-dt / tau); }
  let water = 0, carbon = 0, lightInt = 0;
  for (let i = 0; i <= n; i++) {
    const h = i * dt / 3600, env = envAt(p, h);
    const ss = steadyLeaf(env, leaf);
    if (i > 0) gs = ss.gs + (gs - ss.gs) * Math.exp(-dt / tau);
    const st = leafWithGs(env, gs, leaf);
    out.h.push(h); out.ppfd.push(env.ppfd); out.Ta.push(env.Ta); out.rh.push(100 * Math.min(1, env.ea / svp(env.Ta))); out.Dair.push(st.Dair);
    out.gs.push(gs); out.gss.push(ss.gs); out.E.push(st.Emmol); out.TL.push(st.TL); out.dT.push(st.dT); out.A.push(st.A); out.poreW.push(st.poreW); out.LE.push(st.LE); out.H.push(st.H); out.Rn.push(st.Rn);
    if (i < n) { water += Math.max(0, st.E) * dt; carbon += st.A * dt; lightInt += env.ppfd * dt; }
  }
  out.totals = { waterMol: water, waterL: water * MW, carbonMol: carbon * 1e-6, wue: carbon / Math.max(1e-9, water * 1000), dli: lightInt / 1e6 };
  return out;
}
/** Linear interpolation of a day-simulation series at clock hour h. */
export function dayAt(sim, key, h) {
  const n = sim.h.length - 1, x = Math.max(0, Math.min(n, h / 24 * n)); const i = Math.min(n - 1, Math.floor(x)), f = x - i;
  return sim[key][i] * (1 - f) + sim[key][i + 1] * f;
}

/* ------------------------------------------------------------ local (spatial) energy balance for the thermal image */
/**
 * Leaf temperature at a point x metres downstream of the leading edge, for a leaf whose mean
 * stomatal conductance is gs. The local laminar conductance varies as x^(−½) and is scaled so that
 * its area mean equals the whole-leaf value (flat-plate theory, e.g. Monteith & Unsworth 2013).
 */
export function localLeafT(env, gs, xRel, scaleH, rad) {
  const f = T => {
    const b = boundaryLayer(env.u, env.w, T - env.Ta);
    const k = scaleH / Math.sqrt(Math.max(xRel, 0.01));             // local/mean ratio of the forced conductance
    const gH = b.gHforced * k + b.gHfree, gV = b.gVforced * k + b.gVfree;
    const gtv = vapourConductance(gs, gV, env.amphi);
    const D = svp(T) - env.ea;
    const E = D >= 0 ? gtv * D / env.P : 2 * gV * D / env.P;
    return rad.Rabs - 2 * EPS * SIGMA * (T + K0) ** 4 - 2 * CP * gH * (T - env.Ta) - latentHeat(T) * MW * E;
  };
  return solveDecreasing(f, env.Ta - 25, env.Ta + 30, 0.01);
}
