/* Deep-water culture — dissolved-oxygen and heat model (no DOM).
   State: C (dissolved O₂, mg L⁻¹), T (solution temperature, °C), D (root hypoxia-injury index, 0–1).
   Equations (Derive tab): Benson & Krause C*(T,P); k_La from the Heijnen & Van 't Riet (1984) bubble-column
   power law k_La = 0.32 u_G^0.7 (s⁻¹, u_G in m s⁻¹) with θ = 1.024 (ASCE 2007); root O₂ uptake with Q₁₀ = 2
   (Atkin & Tjoelker 2003) and Michaelis–Menten O₂ limitation; lumped heat balance of the tank. */
import { doSaturation, q10, pressureAtElevation, CP_WATER, smoothstep, clamp } from '../../assets/js/physics.js';

export const P = {
  theta: 1.024,        // k_La temperature factor (ASCE 2007)
  klaSurf: 0.03,       // h⁻¹, re-aeration through the raft gaps, pump off (assumed, as in Lesson 5.3)
  KO: 0.3,             // mg L⁻¹, half-saturation of root respiration with respect to bulk DO (assumed, as in Lesson 5.3)
  Q10: 2,              // respiration Q₁₀ (Atkin & Tjoelker 2003)
  cCrit: 4,            // mg L⁻¹, practical hypoxia threshold (Lesson 5.3, Table 2)
  tauInjury: 6,        // h, time scale of hypoxic root injury at DO → 0 (illustrative)
  tauRecover: 72,      // h, time scale of recovery by new white roots (illustrative)
  dpStone: 3000,       // Pa, pressure drop across a fine air stone (assumed)
  uRaft: 1.2,          // W m⁻² K⁻¹, 25 mm EPS raft incl. surface films (estimate)
  rootMax: 1.3,        // g DM per plant at harvest (Lesson 5.3: ≈ 1–1.5 g)
  rootMid: 21, rootRate: 0.18   // logistic growth of root dry mass with days after transplanting (assumed curve)
};

/** Tank geometry from solution volume (L) and depth (m): footprint with 2 : 1 aspect ratio. */
export function geometry(V, H) {
  const A = V / 1000 / H; const w = Math.sqrt(2 * A), d = w / 2;
  const nx = Math.max(1, Math.round(w / 0.2)), nz = Math.max(1, Math.round(d / 0.2));
  return { A, w, d, H, nx, nz, n: nx * nz };
}
export const rootMass = age => P.rootMax / (1 + Math.exp(-P.rootRate * (age - P.rootMid)));

/** Superficial gas velocity (m s⁻¹) and k_La at 20 °C (h⁻¹) from air flow (L min⁻¹) and footprint (m²). */
export function kla20(qAir, A) {
  const uG = qAir / 60000 / A;
  return { uG, kla: uG > 0 ? 0.32 * Math.pow(uG, 0.7) * 3600 : 0 };
}
/** Air-pump electrical power (W): isothermal-compression work against depth + stone, divided by efficiency. */
export function pumpPower(qAir, H, eff) { const dp = 1000 * 9.81 * H + (qAir > 0 ? P.dpStone : 0); return qAir / 60000 * dp / eff; }

/** Daily air-temperature and lighting schedule: lights on from 06:00 for `photo` hours. */
export function schedule(tHours, s) {
  const hod = ((tHours % 24) + 24) % 24; const on0 = 6, on1 = 6 + s.photo;
  const ramp = x => smoothstep(0, 1, x);
  const lit = s.photo >= 24 ? 1 : hod >= on0 && hod < on1 ? 1 : 0;
  // smoothed day/night air temperature (1 h transitions after switching)
  const tOn = hod - on0, tOff = hod - on1;
  let f;
  if (s.photo >= 24) f = 1; else if (hod >= on0 && hod < on1) f = ramp(tOn); else { const since = tOff >= 0 ? tOff : hod + 24 - on1; f = 1 - ramp(since); }
  return { lit, Tair: s.Tnight + (s.Tday - s.Tnight) * clamp(f, 0, 1), hod };
}

/** Everything that depends on parameters but not on the state (per call; cheap). */
export function derived(s) {
  const g = geometry(s.V, s.H);
  const { uG, kla } = kla20(s.qAir, g.A);
  const m = rootMass(s.age);
  const our20 = g.n * s.qO2 * m / s.V;                       // mg L⁻¹ h⁻¹ at 20 °C, DO not limiting
  const Pbar = pressureAtElevation(s.elev || 0);
  const sideA = 2 * (g.w + g.d) * (g.H + 0.06) + g.w * g.d; // walls + bottom (m²)
  const UA = s.U * sideA + P.uRaft * g.w * g.d;             // W K⁻¹
  return { g, uG, kla20: kla, m, our20, Pbar, UA, qSpec: s.qAir * 60 / s.V, pumpW: s.qAir > 0 ? pumpPower(s.qAir, s.H, s.eff) : 0 };
}
export const cStar = (T, d) => doSaturation(T, 0, d.Pbar);
export const klaAt = (T, d, pumpOn) => (pumpOn ? d.kla20 * Math.pow(P.theta, T - 20) : 0) + P.klaSurf;
export const ourAt = (T, d, C = 99) => q10(d.our20, P.Q10, T, 20) * C / (P.KO + C);

/** Steady-state DO (mg L⁻¹) for given T and aeration (Michaelis–Menten uptake → quadratic). */
export function steadyDO(T, d, pumpOn = true) {
  const k = klaAt(T, d, pumpOn), Cs = cStar(T, d), R = q10(d.our20, P.Q10, T, 20), K = P.KO;
  // k(Cs − C)(K + C) = R C  →  k C² + (R + kK − kCs) C − kCsK = 0
  const a = k, b = R + k * K - k * Cs, c = -k * Cs * K;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}
/** Hours from state C until DO reaches cCrit with the pump off at temperature T (null if never within 72 h). */
export function hoursToCritical(C, T, d) {
  if (C <= P.cCrit) return 0;
  let c = C, t = 0; const dt = 1 / 60;
  const Cs = cStar(T, d), k = P.klaSurf, R = q10(d.our20, P.Q10, T, 20);
  while (t < 72) { c += dt * (k * (Cs - c) - R * c / (P.KO + c)); t += dt; if (c <= P.cCrit) return t; }
  return null;
}
/** Pythium risk index (0–100), qualitative: warm water (> ≈ 24 °C), low DO and injured roots raise it. */
export function pythiumIndex(T, C, D) {
  const rT = smoothstep(22, 28, T), rO = smoothstep(6, 2, C);
  return 100 * (1 - (1 - 0.75 * rT) * (1 - 0.55 * rO) * (1 - 0.5 * D));
}

/** Advance the state by dt seconds. s = settings, d = derived, st = {C, T, D, t (h), eAir (Wh), eChill (Wh)}. */
export function step(st, s, d, dtSec) {
  const dt = dtSec / 3600; // h
  const sch = schedule(st.t, s);
  const cut = s.cut && st.t >= s.cutStart && st.t < s.cutStart + s.cutDur;
  const pumpOn = s.qAir > 0 && !cut;
  // heat balance (W): lamps + UA(Tair − T) − chiller
  let Qc = 0;
  if (s.chill && !cut && st.T > s.Tset) Qc = Math.min(s.chillCap, 60 * (st.T - s.Tset));
  const Pin = sch.lit * s.lampHeat + d.UA * (sch.Tair - st.T) - Qc;
  st.T += Pin * dtSec / (s.V * CP_WATER);
  // oxygen balance (mg L⁻¹ h⁻¹)
  const k = klaAt(st.T, d, pumpOn), Cs = cStar(st.T, d);
  const R = ourAt(st.T, d, Math.max(0, st.C));
  st.C = Math.max(0, st.C + dt * (k * (Cs - st.C) - R));
  // root injury (illustrative index)
  const deficit = Math.max(0, (P.cCrit - st.C) / P.cCrit);
  st.D += dt * (deficit * (1 - st.D) / P.tauInjury - (deficit === 0 ? st.D / P.tauRecover : 0));
  st.D = clamp(st.D, 0, 1);
  // electricity (Wh)
  st.eAir += (pumpOn ? d.pumpW : 0) * dt;
  st.eChill += (Qc / s.cop) * dt;
  st.t += dt; st.pumpOn = pumpOn; st.lit = sch.lit; st.Tair = sch.Tair; st.Qc = Qc; st.R = R; st.k = k; st.Cs = Cs; st.cut = cut;
  return st;
}
/** Initial state: spin up two days without injury or power cuts so that the first displayed day is periodic. */
export function initState(s, t0 = 6) {
  const d = derived(s); const quiet = Object.assign({}, s, { cut: false });
  const st = { C: 8, T: (s.Tday + s.Tnight) / 2, D: 0, t: t0 - 48, eAir: 0, eChill: 0 };
  for (let i = 0; i < 48 * 30; i++) step(st, quiet, d, 120);
  st.D = 0; st.eAir = 0; st.eChill = 0; st.t = t0;
  return st;
}
