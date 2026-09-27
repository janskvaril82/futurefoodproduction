/* ==========================================================================
   Psychrometric properties of moist air at any barometric pressure P (kPa).
   Saturation over water: Tetens / FAO-56 (identical to physics.js svp) — the
   form used throughout the course; optional saturation over ice below 0 °C
   (Tetens form with Murray's 1967 constants). Humidity ratio, enthalpy,
   specific volume and the thermodynamic wet-bulb temperature follow the
   ASHRAE Handbook — Fundamentals (2021), Chapter 1 (Eqs. P1–P7 of the lab).
   T in °C, W in kg water per kg dry air, pressures in kPa.
   ========================================================================== */
import { svp, pressureAtElevation } from '/assets/js/physics.js';

export const RDA = 0.287042;          // kJ kg⁻¹ K⁻¹, gas constant of dry air (ASHRAE)
export const EPS = 0.62198;           // M_w / M_a as in physics.js
export const pAt = z => pressureAtElevation(z);

export const esWater = T => svp(T);
export const esIce = T => 0.6108 * Math.exp(21.875 * T / (T + 265.5));
export const es = (T, ice) => (ice && T < 0 ? esIce(T) : esWater(T));
export const Wfe = (e, P) => EPS * e / (P - e);
export const eFW = (W, P) => W * P / (EPS + W);
export const Wsat = (T, P, ice) => Wfe(es(T, ice), P);
export const enthalpy = (T, W) => 1.006 * T + W * (2501 + 1.86 * T);
export const volume = (T, W, P) => RDA * (T + 273.15) * (1 + 1.607858 * W) / P;
/** Temperature from enthalpy and humidity ratio (inverse of enthalpy). */
export const Tfromh = (h, W) => (h - 2501 * W) / (1.006 + 1.86 * W);

/** Dew point (or frost point with ice) from vapour pressure e (kPa). */
export function dewPoint(e, ice) {
  const x = Math.log(Math.max(1e-7, e) / 0.6108);
  if (ice && x < 0) return 265.5 * x / (21.875 - x);
  return 237.3 * x / (17.27 - x);
}
/** Humidity ratio on the thermodynamic wet-bulb line of wet-bulb temperature Twb, at dry-bulb T (ASHRAE eqs. 33/35). */
export function wetBulbLineW(Twb, T, P, ice) {
  const Ws = Wsat(Twb, P, ice);
  if (Twb >= 0 || !ice) return ((2501 - 2.326 * Twb) * Ws - 1.006 * (T - Twb)) / (2501 + 1.86 * T - 4.186 * Twb);
  return ((2830 - 0.24 * Twb) * Ws - 1.006 * (T - Twb)) / (2830 + 1.86 * T - 2.1 * Twb);
}
/** Thermodynamic wet-bulb temperature by bisection (monotonic in Twb). */
export function wetBulb(T, W, P, ice) {
  let lo = -80, hi = T;
  for (let i = 0; i < 64; i++) { const m = 0.5 * (lo + hi); if (wetBulbLineW(m, T, P, ice) > W) hi = m; else lo = m; }
  return 0.5 * (lo + hi);
}
/** Temperature on the saturation curve with enthalpy h (adiabatic saturation state), by bisection. */
export function satTempFromH(h, P, ice) {
  let lo = -80, hi = 80;
  for (let i = 0; i < 64; i++) { const m = 0.5 * (lo + hi); if (enthalpy(m, Wsat(m, P, ice)) > h) hi = m; else lo = m; }
  return 0.5 * (lo + hi);
}
/** All properties of the state (T, W) at pressure P. */
export function state(T, W, P, ice) {
  const e = eFW(W, P), esT = es(T, ice), v = volume(T, W, P);
  return {
    T, W, P, e, es: esT, RH: 100 * e / esT, Td: dewPoint(e, ice), Twb: wetBulb(T, W, P, ice),
    h: enthalpy(T, W), v, rho: (1 + W) / v, AH: 1000 * W / v, VPD: esT - e, Ws: Wsat(T, P, ice)
  };
}
export const fromRH = (T, RH, P, ice) => Wfe(es(T, ice) * RH / 100, P);

/* ------------------------------------------------------------------ processes (Eqs. P8–P12) */
/** Dry-air mass flow (kg s⁻¹) of a volume flow V (m³ h⁻¹) measured at state s. */
export const massFlow = (V, s) => V / 3600 / s.v;

/** Sensible heating or cooling to T2; below the dew point the air follows the saturation curve and water condenses. */
export function heatCool(A, T2, V, P, ice) {
  const ma = massFlow(V, A);
  let W2 = A.W, path = [[A.T, A.W]];
  if (T2 < A.Td) {
    W2 = Wsat(T2, P, ice);
    path.push([A.Td, A.W]);
    for (let k = 1; k <= 24; k++) { const t = A.Td + (T2 - A.Td) * k / 24; path.push([t, Wsat(t, P, ice)]); }
  } else path.push([T2, A.W]);
  const B = state(T2, W2, P, ice);
  const cond = ma * (A.W - W2);                                  // kg s⁻¹
  const Q = ma * (B.h - A.h) + cond * 4.186 * T2;                  // kW (condensate leaves at T2)
  const Qs = ma * (1.006 + 1.86 * A.W) * (T2 - A.T);
  return { kind: 'heat', A, B, ma, Q, Qs, Ql: Q - Qs, water: -cond, path };
}
/** Cooling coil with apparatus dew point ADP and bypass factor BF (straight line A → ADP). */
export function coil(A, adp, bf, V, P, ice) {
  const ma = massFlow(V, A);
  const wet = adp < A.Td;
  const Wadp = wet ? Wsat(adp, P, ice) : A.W;
  const T2 = adp + bf * (A.T - adp), W2 = Wadp + bf * (A.W - Wadp);
  const B = state(T2, W2, P, ice);
  const cond = ma * (A.W - W2);
  const Q = ma * (B.h - A.h) + cond * 4.186 * adp;                // negative: heat removed
  const Qs = ma * (1.006 + 1.86 * A.W) * (T2 - A.T);
  return { kind: 'coil', A, B, ma, Q, Qs, Ql: Q - Qs, water: -cond, wet, adp, Wadp, path: [[A.T, A.W], [T2, W2]], ext: [[T2, W2], [adp, Wadp]] };
}
/** Direct evaporative (pad) cooling with saturation effectiveness eta along the thermodynamic wet-bulb line. */
export function evaporative(A, eta, V, P, ice) {
  const ma = massFlow(V, A);
  const T2 = A.T - eta * (A.T - A.Twb);
  const W2 = wetBulbLineW(A.Twb, T2, P, ice);
  const B = state(T2, W2, P, ice);
  const path = []; for (let k = 0; k <= 20; k++) { const t = A.T + (T2 - A.T) * k / 20; path.push([t, wetBulbLineW(A.Twb, t, P, ice)]); }
  const water = ma * (W2 - A.W);                                   // kg s⁻¹ evaporated
  const Q = ma * (B.h - A.h), Qs = ma * (1.006 + 1.86 * A.W) * (T2 - A.T);
  return { kind: 'evap', A, B, ma, Q, Qs, Ql: Q - Qs, water, path };
}
/** Adiabatic mixing of streams A and B; x = dry-air mass fraction of B. Supersaturation → fog. */
export function mix(A, Bs, x, V, P, ice) {
  const Wm = (1 - x) * A.W + x * Bs.W, hm = (1 - x) * A.h + x * Bs.h;
  let Tm = Tfromh(hm, Wm), fog = 0, Wf = Wm;
  if (Wm > Wsat(Tm, P, ice)) { Tm = satTempFromH(hm, P, ice); Wf = Wsat(Tm, P, ice); fog = Wm - Wf; }
  const M = state(Tm, Wf, P, ice);
  const ma = massFlow(V, A) / Math.max(1e-6, 1 - x);               // V is the flow of stream A
  return { kind: 'mix', A, B: M, Bs, ma, x, fog, fogFlow: ma * fog, Wm, hm, Q: 0, Qs: 0, Ql: 0, water: 0, path: [[A.T, A.W], [Bs.T, Bs.W]] };
}
/**
 * Closed growth room with a transpiring crop (Eq. P12): floor area Af (m²), height H (m), transpiration
 * E (L m⁻² h⁻¹), sensible gain qs (W m⁻² floor, e.g. lamps), duration (min). A thermostat removes the
 * sensible heat, so T stays constant, but nothing removes vapour: the state rises vertically on the chart
 * until it saturates. Returns the latent load λE the air-conditioner would have to remove, and the SHR.
 */
export function room(A, Af, H, E, qs, dur, P, ice) {
  const ma = Af * H / A.v;                                          // kg dry air in the room
  const Et = E * Af / 3600;                                         // kg s⁻¹ water vapour added
  const Qs = qs * Af / 1000;                                        // kW sensible gain (removed by the thermostat)
  const lam = 2501 - 2.361 * A.T;                                   // kJ kg⁻¹ latent heat at room temperature (physics.js latentHeat)
  const Ql = Et * lam;                                              // kW latent load
  const Wmax = Wsat(A.T, P, ice), W90 = Wfe(0.9 * es(A.T, ice), P), rate = Et / ma;   // kg kg⁻¹ s⁻¹
  const path = [], times = [];
  for (let k = 0; k <= 120; k++) { const t = dur * 60 * k / 120; path.push([A.T, Math.min(Wmax, A.W + rate * t)]); times.push(t / 60); }
  const t90 = rate > 0 && W90 > A.W ? (W90 - A.W) / rate / 60 : null;
  const tSat = rate > 0 ? (Wmax - A.W) / rate / 60 : null;
  const B = state(A.T, path[path.length - 1][1], P, ice);
  return { kind: 'room', A, B, ma, Q: Qs + Ql, Qs, Ql, water: Et, path, times, t90: t90 != null && t90 <= dur ? t90 : (t90 != null ? t90 : null), tSat, SHR: Qs / Math.max(1e-9, Qs + Ql), rate };
}
