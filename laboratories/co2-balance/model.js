/* ==========================================================================
   CO₂ enrichment balance — dynamic CO₂ mass balance of a greenhouse or closed
   growing room, with canopy uptake from the van Henten (1994) lettuce model and
   the economics of enrichment. Pure functions; equations CB1–CB9 (Derive tab).
   ========================================================================== */
import { solarElevation, clearSkyIrradiance, SUN_PPFD_PER_WM2, K0, P0 } from '/assets/js/physics.js';

/* van Henten (1994), Tables 3.2 and 3.6 (one-state lettuce model used for optimal-control studies). */
export const VH = {
  cEps: 17e-9,        // kg CO₂ per J of PAR: light-use efficiency at high CO₂ (Goudriaan et al., 1985)
  c1: 5.11e-6, c2: 2.30e-4, c3: 6.29e-4,   // canopy CO₂ conductance σ(T) = −c1 T² + c2 T − c3, m s⁻¹
  cGamma: 5.2e-5,     // kg m⁻³, CO₂ compensation point at 20 °C
  q10Gamma: 2,
  cPl: 53,            // m² kg⁻¹, effective canopy surface per unit dry weight (c_pl,d)
  cAB: 0.544,         // kg dry matter per kg CO₂ assimilated (c_α c_β)
  cRespC: 4.87e-7,    // s⁻¹, maintenance respiration in CO₂ units at 25 °C (c_resp,c)
  q10Resp: 2
};
export const UMOL_PER_J_SUN = 4.57;   // µmol of photons per J of sunlight PAR (McCree)
export const EPS_PH = VH.cEps / (UMOL_PER_J_SUN * 1e-6);   // kg CO₂ per mol of incident photons (≈ 3.7e-3)
export const C_OUT = 427;             // µmol mol⁻¹, outdoor air (Mauna Loa 2025 annual mean, as in Lesson 8.3)
export const MID_DOY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** g CO₂ per m³ per ppm (ideal gas, Lesson 8.3 Eq. 8.3.1). */
export const kCO2 = (T, P = P0) => 44.01 * P * 1000 / (8.314462618 * (T + K0)) * 1e-6;
/** Canopy conductance for CO₂, m s⁻¹ (van Henten 1994). */
export const sigma = T => Math.max(0, -VH.c1 * T * T + VH.c2 * T - VH.c3);
/** CO₂ compensation point, ppm. */
export const gammaPPM = T => VH.cGamma * Math.pow(VH.q10Gamma, (T - 20) / 10) / (kCO2(T) * 1e-3);

/**
 * Gross canopy CO₂ uptake, g m⁻² h⁻¹ (van Henten 1994 Eq. 3.13 with Acock's co-limitation).
 * I: PPFD at the canopy (µmol m⁻² s⁻¹); C: ppm; T: °C; Xd: crop dry weight (kg m⁻²); layers: tiers.
 */
export function uptake(I, C, T, Xd, layers = 1) {
  if (I <= 0) return 0;
  const k = kCO2(T) * 1e-3;                              // kg m⁻³ ppm⁻¹
  const PI = EPS_PH * I * 1e-6;                          // kg m⁻² s⁻¹, light-limited rate
  const PC = sigma(T) * Math.max(0, C - gammaPPM(T)) * k; // kg m⁻² s⁻¹, CO₂-limited rate
  const closure = 1 - Math.exp(-VH.cPl * Xd);
  const P = PI + PC > 0 ? PI * PC / (PI + PC) : 0;
  return layers * closure * P * 3.6e6;                   // g m⁻² h⁻¹
}
/** Maintenance respiration of the crop, g CO₂ m⁻² h⁻¹. */
export const respiration = (T, Xd, layers = 1) => layers * VH.cRespC * Xd * Math.pow(VH.q10Resp, (T - 25) / 10) * 3.6e6;

/** Value of one extra kg of CO₂ assimilated, € kg⁻¹ CO₂. */
export const valuePerCO2 = p => VH.cAB * p.price * p.hi / (p.dmc / 100);

/** Light and ventilation drivers at clock hour t (h, 0–24). */
export function drivers(p, t) {
  let G = 0, I = 0, lamps = false;
  if (p.fac === 'room') {
    lamps = p.roomPhoto >= 24 || ((t - 6 + 48) % 24) < p.roomPhoto;
    I = lamps ? p.roomPPFD : 0;
  } else {
    const el = solarElevation(p.lat, MID_DOY[p.month], t);
    G = clearSkyIrradiance(el) * p.clear;                  // W m⁻² outdoors (global)
    I = G * p.tau * SUN_PPFD_PER_WM2;                      // µmol m⁻² s⁻¹ in the greenhouse
    lamps = p.lamp > 0 && t >= 5 && t < 21 && G < 150;     // supplementary lighting when it is dull
    if (lamps) I += p.lamp;
  }
  let N;
  if (p.fac === 'room') N = p.N;
  else if (p.vmode === 'sun') N = p.Nmin + (p.Nmax - p.Nmin) * Math.min(1, Math.max(0, (G - 150) / 400));
  else N = p.N;
  return { G, I, N, lamps };
}

/**
 * Integrate one day (with a warm-up day so the start is periodic). strategy: 'none' | 'fixed' | 'coupled' | 'optimal'.
 * Returns time series (every `every` steps) and daily totals (g m⁻² d⁻¹).
 */
export function simulateDay(p, strategy = p.strat, opts = {}) {
  const dt = opts.dt || 60;                                // s
  const every = opts.every || 5;
  const T = p.T, h = p.h, k = kCO2(T);                     // g m⁻³ ppm⁻¹
  const layers = p.fac === 'room' ? p.tiers : 1;
  const cap = p.cap / 10;                                  // kg ha⁻¹ h⁻¹ → g m⁻² h⁻¹
  const v = valuePerCO2(p) / 1000, pr = p.p / 1000;       // € g⁻¹
  const Rres = respiration(T, p.Xd, layers);               // g m⁻² h⁻¹
  const Gam = gammaPPM(T), kk = k * 1e-3;
  const sig = sigma(T);
  let C = strategy === 'none' ? C_OUT : (p.Cset || C_OUT);
  const out = { t: [], C: [], inj: [], up: [], vent: [], I: [], N: [], set: [] };
  const tot = { inj: 0, up: 0, vent: 0, ventIn: 0, resp: 0, capH: 0, lightH: 0, cLight: 0, dC: 0 };
  const steps = Math.round(86400 / dt);
  for (let pass = 0; pass < 2; pass++) {
    const C0 = C;
    for (let s = 0; s < steps; s++) {
      const t = s * dt / 3600;
      const d = drivers(p, t);
      const g = k * d.N * h;                               // g m⁻² h⁻¹ ppm⁻¹, ventilation conductance
      // set-point for this instant
      let Cs = null;
      const light = d.I > 20;
      if (strategy === 'fixed' && light) Cs = p.Cset;
      else if (strategy === 'coupled' && light) Cs = d.N > p.Nsw ? p.Clow : p.Cset;
      else if (strategy === 'optimal' && light) {
        const PI = EPS_PH * d.I * 1e-6, closure = (1 - Math.exp(-VH.cPl * p.Xd)) * layers;
        const sK = sig * kk;                                // kg m⁻² s⁻¹ ppm⁻¹
        if (sK > 0 && v > pr && g > 0) {
          const K = PI / sK;                                // ppm
          const gs = g / 3.6e6;                             // kg m⁻² s⁻¹ ppm⁻¹
          Cs = Gam + K * (Math.sqrt((v - pr) * closure * sK / (pr * gs)) - 1);
          Cs = Math.min(p.Cmax, Math.max(Gam, Cs));          // below the natural level the controller simply does not dose
        } else Cs = null;
      }
      // injection needed to reach Cs at the end of the step (semi-implicit ventilation)
      const A = uptake(d.I, C, T, p.Xd, layers);          // g m⁻² h⁻¹
      const dth = dt / 3600;
      let inj = 0;
      if (Cs != null) {
        const need = ((Cs * (1 + dth * g / (k * h)) - C - dth * g / (k * h) * C_OUT) * k * h / dth) + A - Rres;
        inj = Math.min(cap, Math.max(0, need));
        if (pass === 1 && need > cap) tot.capH += dth;
      }
      const Cn = (C + dth / (k * h) * (inj - A + Rres) + dth * g / (k * h) * C_OUT) / (1 + dth * g / (k * h));
      const vent = g * ((C + Cn) / 2 - C_OUT);             // g m⁻² h⁻¹ (negative = CO₂ enters)
      if (pass === 1) {
        tot.inj += inj * dth; tot.up += A * dth; tot.resp += Rres * dth;
        if (vent > 0) tot.vent += vent * dth; else tot.ventIn -= vent * dth;
        if (light) { tot.lightH += dth; tot.cLight += C * dth; }
        if (s % every === 0) { out.t.push(t); out.C.push(C); out.inj.push(inj); out.up.push(A); out.vent.push(vent); out.I.push(d.I); out.N.push(d.N); out.set.push(Cs); }
      }
      C = Math.max(0, Cn);
    }
    if (pass === 1) tot.dC = (C - C0) * k * h;            // g m⁻² stored over the day (≈ 0 when periodic)
  }
  out.t.push(24); out.C.push(C); out.inj.push(out.inj[0]); out.up.push(out.up[0]); out.vent.push(out.vent[0]); out.I.push(out.I[0]); out.N.push(out.N[0]); out.set.push(out.set[0]);
  tot.meanC = tot.lightH > 0 ? tot.cLight / tot.lightH : C;
  return { series: out, tot };
}

/** Full evaluation: dosing strategy vs. no dosing, economics. Values per m² per day unless stated. */
export function evaluate(p, opts = {}) {
  const dose = simulateDay(p, p.strat, opts);
  const none = simulateDay(p, 'none', opts);
  return econ(p, dose, none);
}
export function econ(p, dose, none) {
  const v = valuePerCO2(p);                                 // € per kg CO₂ assimilated
  const dUp = dose.tot.up - none.tot.up;                    // g m⁻² d⁻¹ extra CO₂ assimilated
  const dDW = VH.cAB * dUp;                                 // g DW m⁻² d⁻¹
  const dFW = dDW * p.hi / (p.dmc / 100);                   // g marketable FW
  const benefit = v * dUp / 1000;                           // € m⁻² d⁻¹
  const cost = p.p * dose.tot.inj / 1000;                   // € m⁻² d⁻¹
  const cue = dose.tot.inj + dose.tot.resp > 0 ? dose.tot.up / (dose.tot.inj + dose.tot.resp + dose.tot.ventIn) : NaN;
  return { dose, none, v, dUp, dDW, dFW, benefit, cost, margin: benefit - cost, cue,
    lostShare: dose.tot.inj > 0 ? Math.min(1, dose.tot.vent / (dose.tot.inj + dose.tot.resp + dose.tot.ventIn)) : 0,
    costPerKgExtra: dUp > 0 ? cost / (dUp / 1000) : NaN, gain: none.tot.up > 0 ? dUp / none.tot.up : 0 };
}

/** Margin as a function of a fixed set-point (for the cost–benefit chart and the optimum). */
export function sweepSetpoints(p, list, opts = { dt: 300, every: 1e6 }) {
  const none = simulateDay(p, 'none', opts);
  return list.map(Cs => { const q = Object.assign({}, p, { Cset: Cs }); const d = simulateDay(q, 'fixed', opts); const e = econ(q, d, none); return { Cs, benefit: e.benefit, cost: e.cost, margin: e.margin, inj: d.tot.inj, up: d.tot.up, dUp: e.dUp }; });
}
/** Best fixed daylight set-point: grid search (the margin can be bimodal when dosing is capacity-limited). */
export function bestSetpoint(p, opts = { dt: 300, every: 1e6 }, n = 32) {
  const list = []; for (let i = 0; i < n; i++) list.push(C_OUT + (p.Cmax - C_OUT) * i / (n - 1));
  const sw = sweepSetpoints(p, list, opts);
  let best = sw[0]; sw.forEach(s => { if (s.margin > best.margin) best = s; });
  return { Cs: best.Cs, margin: best.margin, sweep: sw };
}
/** Economic (quasi-steady optimal) controller: daylight-mean set-point, achieved concentration and margin. */
export function optimalController(p, opts = { dt: 300, every: 1 }) {
  const q = Object.assign({}, p, { strat: 'optimal' });
  const e = evaluate(q, opts); const S = e.dose.series;
  let a = 0, w = 0; S.t.forEach((t, i) => { if (S.I[i] > 20 && S.set[i] != null) { a += S.set[i] * S.I[i]; w += S.I[i]; } });
  return { Cstar: w > 0 ? a / w : NaN, meanC: e.dose.tot.meanC, margin: e.margin, inj: e.dose.tot.inj };
}
