/* ==========================================================================
   gen.js — mechanistically generated SYNTHETIC greenhouse data set
   (documented in the Derive tab, Eqs. NN1–NN5). Nothing here is measured.

   Marketable head fresh mass after a fixed cycle (g head⁻¹):
     Y = Y_ref · P(DLI, C, D) / P(17, 800, 0.8) · f_T(T) · (1 − L_tb)          × noise
   P  : canopy production as a rectangular hyperbola in the daily light integral
        (Acock-type canopy, the form used by Van Henten 1994), whose light-limited
        slope rises with CO₂ through photorespiration, (C − Γ)/(C + 2Γ), and whose
        light-saturated rate rises with CO₂ by Michaelis–Menten kinetics and falls
        with VPD through stomatal closure (Leuning-type 1/(1 + D/D₀)).
        K_C = 350 µmol mol⁻¹ is chosen so that doubling CO₂ from 330 to 660 at
        DLI 17 raises yield by 33 %, the mean response in Kimball's (1983) review.
   f_T: Yan & Hunt (1999) cardinal-temperature function, T_min/T_opt/T_max = 4/22/34 °C
        (illustrative values for a cool-season leafy crop).
   L_tb: tipburn loss, larger for fast-growing plants at low day-time VPD
        (direction after Collier & Tibbitts 1984; magnitude illustrative).
   ========================================================================== */
import { mulberry32, randn, shuffle } from '/assets/js/stats.js';

export const INPUTS = [
  { key: 'dli', label: 'DLI', long: 'Daily light integral', unit: 'mol m⁻² d⁻¹', min: 6, max: 30, digits: 1 },
  { key: 'T', label: 'T', long: 'Mean air temperature', unit: '°C', min: 12, max: 32, digits: 1 },
  { key: 'co2', label: 'CO₂', long: 'CO₂ concentration (day)', unit: 'µmol mol⁻¹', min: 350, max: 1400, digits: 0 },
  { key: 'vpd', label: 'VPD', long: 'Vapour-pressure deficit (day)', unit: 'kPa', min: 0.2, max: 2.2, digits: 2 }
];
export const PAR = { Yref: 250, Gamma: 50, KC: 350, x17: 1, D0: 1.5, Dref: 0.8, Tmin: 4, Topt: 22, Tmax: 34, Ltb: 0.25, Dtb: 0.25, Lmax: 0.6 };

const ga = C => Math.max(0, (C - PAR.Gamma) / (C + 2 * PAR.Gamma));         // photorespiration on the light-limited slope
const gm = C => Math.max(0, (C - PAR.Gamma) / (C - PAR.Gamma + PAR.KC));    // CO₂ saturation of the light-saturated rate
export const fs = D => (1 + PAR.Dref / PAR.D0) / (1 + D / PAR.D0);           // stomatal factor, 1 at 0.8 kPa
export function fT(T) {
  const { Tmin, Topt, Tmax } = PAR; if (T <= Tmin || T >= Tmax) return 0;
  return ((Tmax - T) / (Tmax - Topt)) * Math.pow((T - Tmin) / (Topt - Tmin), (Topt - Tmin) / (Tmax - Topt));
}
/** Relative canopy production: rectangular hyperbola A·B/(A + B). */
export function P(dli, C, D) {
  const A = PAR.x17 * (dli / 17) * ga(C) / ga(800);
  const B = gm(C) / gm(800) * fs(D);
  return A > 0 && B > 0 ? A * B / (A + B) : 0;
}
const P_REF = P(17, 800, PAR.Dref);
export const potential = (dli, T, C, D) => PAR.Yref * P(dli, C, D) / P_REF * fT(T);
export const tipburn = (Yp, D) => Math.min(PAR.Lmax, PAR.Ltb * (Yp / PAR.Yref) * Math.exp(-(D - 0.2) / PAR.Dtb));
/** Noise-free marketable yield (g head⁻¹) for an input object {dli, T, co2, vpd}. */
export function trueYield(x) { const Yp = potential(x.dli, x.T, x.co2, x.vpd); return Yp * (1 - tipburn(Yp, x.vpd)); }

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/**
 * Generate n greenhouse "cycles". design: 'random' (independent uniform inputs) or
 * 'greenhouse' (inputs correlated through a latent sunniness s: sunny periods are bright,
 * warm and dry and — because the vents are open — lower in CO₂; illustrative).
 * noise: coefficient of variation of the multiplicative log-normal error.
 */
export function generate({ n = 300, noise = 0.08, design = 'random', seed = 1 } = {}) {
  const rng = mulberry32(seed); const rows = [];
  for (let i = 0; i < n; i++) {
    let x;
    if (design === 'greenhouse') {
      const s = rng();
      x = { dli: clamp(6 + 22 * s + 2.0 * randn(rng), 6, 30), T: clamp(16 + 11 * s + 1.5 * randn(rng), 12, 32), co2: clamp(1000 - 550 * s + 110 * randn(rng), 350, 1400), vpd: clamp(0.35 + 1.3 * s + 0.2 * randn(rng), 0.2, 2.2) };
    } else {
      x = {}; INPUTS.forEach(v => { x[v.key] = v.min + (v.max - v.min) * rng(); });
    }
    const yt = trueYield(x);
    const sig = Math.sqrt(Math.log(1 + noise * noise));
    x.ytrue = yt; x.y = yt * Math.exp(sig * randn(rng) - sig * sig / 2);
    rows.push(x);
  }
  return rows;
}
/** Random split into training and validation indices. */
export function split(n, valFrac, seed) { const idx = shuffle([...Array(n).keys()], mulberry32(seed + 1000)); const nv = Math.max(1, Math.round(n * valFrac)); return { val: idx.slice(0, nv), train: idx.slice(nv) }; }
