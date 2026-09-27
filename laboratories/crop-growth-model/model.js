/* ==========================================================================
   model.js — daily light-use-efficiency (LUE) model of a lettuce crop
   for /laboratories/crop-growth-model/ (ES module).

   Structure (Monteith 1977; Goudriaan & Monteith 1990):
     leaf area per plant  LA = SLA · W_shoot            LAI = ρ · LA
     light interception   f  = 1 − exp(−k · LAI)         (Monsi & Saeki 1953)
     growth               dW/dt = [RUE(I, C, T) · DLI · f − R_m(W, T)] / ρ
     fresh weight         FW = W_shoot / DMC
   Parameters: Van Henten (1994) one-state lettuce model (thesis Table 3.1; validated in
   Van Henten 1994, Agric. Syst. 45: 55–72). RUE and its light, CO₂ and temperature
   modifiers are derived from Van Henten's canopy photosynthesis (after Acock et al. 1978,
   Goudriaan et al. 1985), expressed per mole of intercepted PAR.
   Units: W g dry weight per plant, DLI mol m⁻² d⁻¹, PPFD µmol m⁻² s⁻¹, T °C, CO₂ ppm.
   ========================================================================== */

export const VH = {
  ca: 0.68,              // g CH₂O per g CO₂ (30/44)
  cb: 0.8,               // yield factor: g structural DM per g CH₂O (Sweeney et al. 1981)
  cbnd: 0.004,           // m s⁻¹ boundary-layer conductance for CO₂ (Stanghellini)
  cstm: 0.007,           // m s⁻¹ stomatal conductance for CO₂ (Stanghellini)
  car: [-1.32e-5, 5.94e-4, -2.64e-3],   // carboxylation conductance polynomial in T (m s⁻¹; zero at 5 and 40 °C)
  ceps: 17e-9,           // kg CO₂ J⁻¹ light-use efficiency at high CO₂ (Goudriaan et al. 1985)
  cG: 7.32e-5,           // kg m⁻³ CO₂ compensation point at 20 °C (40 ppm)
  q10G: 2,               // Q10 of the compensation point
  k: 0.9,                // canopy extinction coefficient (planophile; Goudriaan & Monteith 1990)
  sla: 62.5,             // m² per kg shoot dry weight (shoot leaf area ratio, calibrated)
  tau: 0.07,             // root / total dry weight (NFT-grown lettuce)
  rs: 3.47e-7, rr: 1.16e-7, // s⁻¹ maintenance respiration of shoot and root at 25 °C (glucose)
  q10r: 2,               // Q10 of maintenance respiration
  cfw: 22.5              // fresh / dry weight of the head → DMC = 4.4 %
};
export const PPM = 1.83e-6;              // kg CO₂ m⁻³ per µmol mol⁻¹ (≈ 20 °C, 101 kPa)
export const UMOL_PER_J = 4.57;          // µmol PAR photons per J of PAR (sunlight / broad-band white)
export const REF = { I: 250, C: 400, T: 20 };

/** Carboxylation conductance σ_car(T), m s⁻¹ (quadratic fitted by Van Henten to Goudriaan 1987). */
export const sigmaCar = T => Math.max(1e-9, VH.car[0] * T * T + VH.car[1] * T + VH.car[2]);
/** Gross CO₂ assimilation of a closed canopy (effective surface 1 m² m⁻²), kg CO₂ m⁻² s⁻¹. I = PPFD µmol m⁻² s⁻¹. */
export function canopyP(I, C, T) {
  const Iw = Math.max(0, I) / UMOL_PER_J;                             // W m⁻² PAR
  const G = VH.cG * Math.pow(VH.q10G, (T - 20) / 10);
  const Ck = C * PPM;
  if (Ck <= G) return 0;
  const eps = VH.ceps * (Ck - G) / (Ck + 2 * G);                     // photorespiration lowers the light-use efficiency
  const sig = 1 / (1 / VH.cbnd + 1 / VH.cstm + 1 / sigmaCar(T));     // conductances in series
  const a = eps * Iw, b = sig * (Ck - G);
  return a > 0 && b > 0 ? a * b / (a + b) : 0;                       // rectangular hyperbola (Acock et al. 1978)
}
/** Radiation-use efficiency implied by Van Henten's canopy, g DM per mol intercepted PAR (growth respiration included). */
export const rueVH = (I, C, T) => I > 0 ? VH.ca * VH.cb * canopyP(I, C, T) * 1000 / (I * 1e-6) : 0;
export const RUE_REF_VH = rueVH(REF.I, REF.C, REF.T);               // ≈ 0.90 g mol⁻¹

/** Modifiers relative to the reference conditions (250 µmol m⁻² s⁻¹, 400 ppm, 20 °C). */
export function modifiers(I, C, T) {
  const r0 = RUE_REF_VH;
  return {
    fI: rueVH(I, REF.C, REF.T) / r0,
    fC: rueVH(I, C, REF.T) / Math.max(1e-12, rueVH(I, REF.C, REF.T)),
    fT: rueVH(I, C, T) / Math.max(1e-12, rueVH(I, C, REF.T)),
    total: rueVH(I, C, T) / r0
  };
}

/** Plant density on day d (optional re-spacing). */
export const densityAt = (p, d) => (p.respace && d >= p.respaceDay) ? p.dens2 : p.dens;

/**
 * Simulate the crop day by day (RK4, 4 steps per day). p: {
 *   dli, hp, Td, Tn, co2, dens, respace, respaceDay, dens2, fw0, days,
 *   rue (g mol⁻¹ at the reference conditions), sla (m² kg⁻¹), k, dmc (fraction), tau, resp (bool) }
 * Returns daily arrays and summary values.
 */
export function simulate(p) {
  const I = p.dli * 1e6 / (p.hp * 3600);                              // PPFD during the photoperiod
  const rue = p.rue * rueVH(I, p.co2, p.Td) / RUE_REF_VH;             // g DM per mol intercepted PAR
  const cresp = (VH.rs * (1 - p.tau) + VH.rr * p.tau) * VH.cb;        // g DM per g DM per s at 25 °C
  const rm = p.resp ? cresp * (p.hp * 3600 * Math.pow(VH.q10r, (p.Td - 25) / 10) + (24 - p.hp) * 3600 * Math.pow(VH.q10r, (p.Tn - 25) / 10)) : 0; // d⁻¹
  const rate = (W, rho) => {                                           // dW/dt per plant, g d⁻¹
    const LAI = rho * p.sla * (1 - p.tau) * W / 1000;
    const f = 1 - Math.exp(-p.k * LAI);
    return (rue * p.dli * f) / rho - rm * W;
  };
  const W0 = p.fw0 * p.dmc / (1 - p.tau);
  const out = { day: [], W: [], Wshoot: [], FW: [], LA: [], LAI: [], f: [], ipar: [], cumIpar: [], cropDW: [], rgr: [], dens: [], cover: [], gross: [], resp: [] };
  let W = W0, cum = 0; const N = 4;
  for (let d = 0; d <= p.days; d++) {
    const rho = densityAt(p, d);
    const Ws = W * (1 - p.tau), LA = p.sla * Ws / 1000, LAI = rho * LA, f = 1 - Math.exp(-p.k * LAI);
    out.day.push(d); out.W.push(W); out.Wshoot.push(Ws); out.FW.push(Ws / p.dmc); out.LA.push(LA); out.LAI.push(LAI); out.f.push(f);
    out.ipar.push(f * p.dli); out.cumIpar.push(cum); out.cropDW.push(W * rho); out.dens.push(rho); out.cover.push(f / rho);
    out.gross.push(rue * p.dli * f); out.resp.push(rm * W * rho);
    if (d === p.days) break;
    // RK4 over one day
    const h = 1 / N; let w = W;
    for (let s = 0; s < N; s++) {
      const k1 = rate(w, rho), k2 = rate(w + h / 2 * k1, rho), k3 = rate(w + h / 2 * k2, rho), k4 = rate(w + h * k3, rho);
      w = Math.max(1e-6, w + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4));
    }
    out.rgr.push(Math.log(w / W));
    cum += f * p.dli;                                                  // (left Riemann sum of intercepted light)
    W = w;
  }
  out.rgr.push(out.rgr.length ? out.rgr[out.rgr.length - 1] : 0);
  const n = out.day.length - 1;
  out.summary = {
    I, rue, rm, FW: out.FW[n], W: out.W[n], LAI: out.LAI[n], f: out.f[n], meanRGR: n > 0 ? Math.log(out.W[n] / out.W[0]) / n : 0,
    yield: out.FW[n] * densityAt(p, n) / 1000, lightIn: p.dli * n, gPerMol: out.FW[n] * densityAt(p, n) / Math.max(1e-9, p.dli * n)
  };
  return out;
}
/** Interpolate a daily series at a fractional day. */
export function at(sim, key, d) {
  const n = sim.day.length - 1, x = Math.max(0, Math.min(n, d)), i = Math.min(n - 1, Math.floor(x)), f = x - i;
  if (n === 0) return sim[key][0];
  return sim[key][i] * (1 - f) + sim[key][i + 1] * f;
}
/** First day on which the head fresh weight reaches a target (linear interpolation), or null. */
export function daysTo(sim, fwTarget) {
  for (let i = 1; i < sim.FW.length; i++) if (sim.FW[i] >= fwTarget) { const a = sim.FW[i - 1], b = sim.FW[i]; return i - 1 + (fwTarget - a) / Math.max(1e-9, b - a); }
  return null;
}
