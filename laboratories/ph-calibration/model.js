/* ==========================================================================
   pH electrode calibration — electrode, solutions and meter (no DOM)
   Equations PH1–PH6 are documented in the Derive tab.
   ========================================================================== */
import { nernstSlope } from '/assets/js/physics.js';
import { linreg } from '/assets/js/stats.js';

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------------------------------------------------------------- buffers (PH3)
   METTLER TOLEDO buffer group B1 "USA" (ref. 25 °C): FiveEasy F20/FP20 operating instructions,
   Appendix (Mettler-Toledo, 2015). Tabulated 5–40 °C; the meter rejects buffer temperatures outside. */
export const BUFFER_T = [5, 10, 15, 20, 25, 30, 35, 40];
export const BUFFER_TABLE = {
  '4.01': [4.00, 4.00, 4.00, 4.00, 4.01, 4.01, 4.02, 4.03],
  '7.00': [7.09, 7.06, 7.04, 7.02, 7.00, 6.99, 6.98, 6.97],
  '10.01': [10.25, 10.18, 10.12, 10.06, 10.01, 9.97, 9.93, 9.89]
};
export const BUFFER_KEYS = ['4.01', '7.00', '10.01'];
/** pH of a technical buffer at temperature T (°C), linear interpolation in the manufacturer's table. */
export function bufferPH(key, T) {
  const tab = BUFFER_TABLE[key], t = clamp(T, 5, 40);
  let i = Math.min(BUFFER_T.length - 2, Math.floor((t - 5) / 5));
  const f = (t - BUFFER_T[i]) / 5;
  return tab[i] + (tab[i + 1] - tab[i]) * f;
}

/* ---------------------------------------------------------------- electrode (PH1, PH2) */
/** Illustrative electrode conditions spanning the manufacturer's diagnostic categories (not measured data). */
export const ELECTRODES = {
  new: { label: 'New', eff: 99.3, off: 3.5, tau: 4, drift: 0.2, noise: 0.03 },
  year: { label: 'One year of use', eff: 96.2, off: 11, tau: 10, drift: 0.6, noise: 0.05 },
  aged: { label: 'Aged', eff: 91.5, off: 24, tau: 28, drift: 1.5, noise: 0.08 },
  failing: { label: 'Failing', eff: 82, off: 41, tau: 75, drift: 4, noise: 0.25 }
};
/** Equilibrium potential (mV) of the combination electrode: isopotential point pH 7 (PH1). */
export const electrodeEq = (pH, T, eff, off) => off - eff / 100 * nernstSlope(T) * (pH - 7);
/** Thermal time constant of the electrode body and its built-in temperature sensor (assumed). */
export const TAU_T = 12;

/* ---------------------------------------------------------------- solutions */
export const SOLUTIONS = {
  store: { label: 'Storage (3 mol L⁻¹ KCl)', short: 'KCl', kind: 'store', pH: 7.0, color: '#dfe7ea', row: 0 },
  rinse: { label: 'Deionised water (rinse)', short: 'DI water', kind: 'rinse', pH: 5.7, slow: 4, noisy: 4, color: '#eef6fa', row: 0 },
  b4: { label: 'Buffer pH 4.01', short: 'pH 4.01', kind: 'buffer', key: '4.01', color: '#e0474c', row: 0 },
  b7: { label: 'Buffer pH 7.00', short: 'pH 7.00', kind: 'buffer', key: '7.00', color: '#3fa85a', row: 0 },
  b10: { label: 'Buffer pH 10.01', short: 'pH 10.01', kind: 'buffer', key: '10.01', color: '#3a6fd8', row: 0 },
  nft: { label: 'NFT lettuce solution', short: 'NFT', kind: 'sample', pH: 5.85, T: 21, color: '#b9ddb0', row: 1 },
  dwc: { label: 'Cold DWC tank (winter)', short: 'DWC', kind: 'sample', pH: 6.10, T: 11, color: '#cfe8cf', row: 1 },
  aqua: { label: 'Aquaponic sump', short: 'Aquaponic', kind: 'sample', pH: 7.25, T: 27, color: '#c8d98e', row: 1 },
  acid: { label: 'Acidified irrigation water', short: 'Acidified', kind: 'sample', pH: 4.40, T: 15, color: '#ece3b6', row: 1 },
  rain: { label: 'Rainwater (low ionic strength)', short: 'Rainwater', kind: 'sample', pH: 6.40, T: 9, slow: 4, noisy: 3, color: '#dcebf7', row: 1 },
  custom: { label: 'Your own sample', short: 'Custom', kind: 'sample', custom: true, color: '#e8d2ef', row: 1 }
};
/** True pH and temperature of a solution given the lab state. */
export function solutionState(id, s) {
  const S = SOLUTIONS[id];
  if (S.kind === 'buffer') return { pH: bufferPH(S.key, s.Tbuf), T: s.Tbuf };
  if (S.custom) return { pH: s.cpH, T: s.cT };
  if (S.kind === 'sample') return { pH: S.pH, T: S.T };
  return { pH: S.pH, T: s.Tbuf };
}

/* ---------------------------------------------------------------- stability criteria (SevenCompact S220 manual) */
export const STABILITY = {
  strict: { label: 'Strict', rules: [[0.03, 8], [0.1, 30]] },   // ≤0.03 mV in 8 s  OR ≤0.1 mV in 30 s (both windows must be available)
  medium: { label: 'Medium', rules: [[0.1, 6]] },
  fast: { label: 'Fast', rules: [[0.6, 4]] }
};

/* ---------------------------------------------------------------- calibration (PH4) */
/** Fit E = a + S·pH through calibration points [{pH, E, T}]; returns slope, efficiency (%) and offset (mV at pH 7). */
export function calibrate(points) {
  if (points.length < 2) return null;
  const x = points.map(p => p.pH), y = points.map(p => p.E);
  const Tcal = points.reduce((a, p) => a + p.T, 0) / points.length;
  let S, a, resid, se = null;
  if (points.length === 2) { S = (y[1] - y[0]) / (x[1] - x[0]); a = y[0] - S * x[0]; resid = [0, 0]; }
  else { const r = linreg(x, y); S = r.slope; a = r.intercept; resid = r.residuals; se = r.s; }
  const eff = -S / nernstSlope(Tcal) * 100;
  const off = a + 7 * S;
  return { S, a, eff, off, Tcal, resid, se, n: points.length, diag: diagnose(eff, off) };
}
/** Electrode condition categories (Mettler-Toledo, 2015, FiveEasy F20/FP20). */
export function diagnose(eff, off) {
  const ao = Math.abs(off);
  if (eff < 85 || eff > 110) return { level: 'bad', short: 'rejected', text: 'Calibration rejected — slope out of range (< 85 % or > 110 %)' };
  if (ao >= 35) return { level: 'bad', short: 'faulty', text: 'Electrode faulty — offset beyond ±35 mV' };
  if (eff < 90) return { level: 'bad', short: 'faulty', text: 'Electrode faulty (slope 85–89 %)' };
  if (eff < 95 || ao > 20) return { level: 'warn', short: 'clean it', text: 'Electrode needs cleaning (slope 90–94 % or offset 20–35 mV)' };
  if (eff > 105) return { level: 'warn', short: 'check', text: 'Slope above 105 % — check buffers and temperature' };
  return { level: 'ok', short: 'good', text: 'Electrode in good condition (slope 95–105 %, offset within ±20 mV)' };
}
/** pH from potential with a calibration (PH5). With ATC the slope is re-evaluated at the sample temperature. */
export function phFromE(E, cal, Tprobe, atc) {
  const eff = cal ? cal.eff : 100, off = cal ? cal.off : 0;
  const T = atc ? Tprobe : (cal ? cal.Tcal : 25);
  return 7 - (E - off) / (eff / 100 * nernstSlope(T));
}
