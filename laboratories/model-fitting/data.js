/* ==========================================================================
   data.js — example data sets for the growth-curve fitting lab.
   Every data set is clearly labelled: either illustrative numbers (copied from
   Lesson 10.1) or SIMULATED with a mechanistic lettuce model plus random
   plant-to-plant variation and measurement noise (seeded, reproducible).

   Simulation model (RK4, 4 steps per day): a light-use-efficiency lettuce model.
     • radiation-use efficiency from Van Henten's (1994) canopy photosynthesis
       (rectangular hyperbola in PAR and CO₂) evaluated at 20 °C, × a cardinal-
       temperature factor (Yan & Hunt 1999; illustrative 4 / 22 / 34 °C),
       × 1.3 (calibration so that heads reach a few hundred grams in five weeks);
     • light interception by the projected leaf area, A = 5.94·FW^0.847 cm²
       (the inverse of the illustrative calibration W = 0.122·A^1.18 of Lesson 10.3),
       f = 1 − exp(−ρA);
     • maintenance respiration of shoot and root with Q10 = 2 (Van Henten 1994).
   ========================================================================== */
import { mulberry32, randn } from '/assets/js/stats.js';

const VH = { ca: 0.68, cb: 0.8, cbnd: 0.004, cstm: 0.007, car: [-1.32e-5, 5.94e-4, -2.64e-3], ceps: 17e-9, cG: 7.32e-5, tau: 0.07, rs: 3.47e-7, rr: 1.16e-7 };
const RUE_CAL = 1.3, A_COEF = 5.94, A_EXP = 0.847;
const PPM = 1.83e-6, UMOL_PER_J = 4.57;
const gcar = T => Math.max(1e-9, VH.car[0] * T * T + VH.car[1] * T + VH.car[2]);
function canopyP(I, C) {           // kg CO₂ m⁻² s⁻¹ at 20 °C
  const Iw = I / UMOL_PER_J, G = VH.cG, Ck = C * PPM; if (Ck <= G) return 0;
  const eps = VH.ceps * (Ck - G) / (Ck + 2 * G);
  const sig = 1 / (1 / VH.cbnd + 1 / VH.cstm + 1 / gcar(20));
  const a = eps * Iw, b = sig * (Ck - G); return a * b / (a + b);
}
const fT = (T, Tn = 4, To = 22, Tx = 34) => (T <= Tn || T >= Tx ? 0 : ((Tx - T) / (Tx - To)) * Math.pow((T - Tn) / (To - Tn), (To - Tn) / (Tx - To)));

/** Daily shoot fresh mass (g per plant) for days 0…days. */
export function cropSeries({ dli = 17, T = 21, co2 = 800, days = 35, fw0 = 3, dens = 20, rueF = 1, hp = 16, dmc = 0.044 } = {}) {
  const I = dli * 1e6 / (hp * 3600);
  const rue = VH.ca * VH.cb * canopyP(I, co2) * 1000 / (I * 1e-6) * fT(T) * RUE_CAL * rueF;   // g DM per mol intercepted PAR
  const rm = (VH.rs * (1 - VH.tau) + VH.rr * VH.tau) * VH.cb * 86400 * Math.pow(2, (T - 25) / 10); // d⁻¹
  const fw = W => W * (1 - VH.tau) / dmc;                                // total DM → shoot fresh mass
  const rate = W => { const A = A_COEF * Math.pow(fw(W), A_EXP) * 1e-4; return rue * dli * (1 - Math.exp(-dens * A)) / dens - rm * W; };
  let W = fw0 * dmc / (1 - VH.tau); const out = [fw(W)]; const h = 0.25;
  for (let d = 0; d < days; d++) {
    for (let s = 0; s < 4; s++) { const k1 = rate(W), k2 = rate(W + h / 2 * k1), k3 = rate(W + h / 2 * k2), k4 = rate(W + h * k3); W = Math.max(1e-6, W + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4)); }
    out.push(fw(W));
  }
  return out;
}
const r1 = v => Math.round(v * 10) / 10;

function plantsTable({ seed, days, plants, trt = null, cvPlant = 0.1, cvMeas = 0.06, dli = 17, fw0 = 3, T = 21, co2 = 800, groupName = 'plant', prefix = 'P' }) {
  const rng = mulberry32(seed); const rows = [];
  for (let p = 1; p <= plants; p++) {
    const vig = Math.exp(cvPlant * randn(rng)), start = fw0 * Math.exp(0.2 * randn(rng));
    const s = cropSeries({ dli, T, co2, fw0: start, rueF: vig, days: Math.max(...days) });
    days.forEach(d => rows.push([d, r1(s[d] * Math.exp(cvMeas * randn(rng) - cvMeas * cvMeas / 2)), trt ?? `${prefix}${p}`]));
  }
  return rows;
}
const csv = (head, rows) => head.join(',') + '\n' + rows.map(r => r.join(',')).join('\n');

const D_TWICE = [0, 3, 7, 10, 14, 17, 21, 24, 28, 31, 35];
const lessonArea = [[0, 18], [3, 27], [6, 44], [8, 61], [10, 86], [13, 138], [15, 180], [17, 228], [20, 305], [22, 352], [24, 392], [27, 440], [29, 462]];

export const EXAMPLES = {
  fw17: {
    label: 'Lettuce FW · 5 plants (simulated)', unit: 'g', variable: 'Shoot fresh mass', target: 250,
    note: 'SIMULATED with the course lettuce model (DLI 17 mol m⁻² d⁻¹, 21 °C, 800 µmol mol⁻¹ CO₂, 20 plants m⁻²), 10 % plant-to-plant variation in vigour and 6 % measurement noise. Five plants weighed twice a week (column “plant”).',
    text: () => csv(['day', 'fw_g', 'plant'], plantsTable({ seed: 17, days: D_TWICE, plants: 5 }))
  },
  area: {
    label: 'Leaf area · 1 plant (Lesson 10.1)', unit: 'cm²', variable: 'Projected leaf area', target: 420,
    note: 'ILLUSTRATIVE numbers for one lettuce plant — the same series as Figure 9 of Lesson 10.1, so you can compare your fits with the lesson.',
    text: () => csv(['day', 'leaf_area_cm2'], lessonArea)
  },
  dli: {
    label: 'DLI 12 vs 17 · 8 plants (simulated)', unit: 'g', variable: 'Shoot fresh mass', target: 200,
    note: 'SIMULATED: the same lettuce model at DLI 12 and DLI 17 mol m⁻² d⁻¹ (other conditions equal), four plants per treatment weighed weekly. Fit each treatment separately (“Fit to”) and compare the parameters.',
    text: () => csv(['day', 'fw_g', 'treatment'], [
      ...plantsTable({ seed: 121, days: [0, 7, 14, 21, 28, 35], plants: 4, trt: 'DLI 12', dli: 12 }),
      ...plantsTable({ seed: 171, days: [0, 7, 14, 21, 28, 35], plants: 4, trt: 'DLI 17', dli: 17 })
    ])
  },
  early: {
    label: 'First two weeks only (simulated)', unit: 'g', variable: 'Shoot fresh mass', target: 250,
    note: 'SIMULATED: the first two weeks of the DLI-17 data set (three plants). Only the exponential phase has been observed — watch what happens to the asymptote K, its standard error and the harvest forecast.',
    text: () => csv(['day', 'fw_g', 'plant'], plantsTable({ seed: 17, days: [0, 3, 7, 10, 14], plants: 3 }))
  },
  hetero: {
    label: '8 plants per date (simulated)', unit: 'g', variable: 'Shoot fresh mass', target: 250,
    note: 'SIMULATED: eight plants weighed every four days with 15 % plant-to-plant variation. The scatter grows with plant size (proportional errors) — compare the additive and the proportional (log-scale) error model.',
    text: () => csv(['day', 'fw_g', 'plant'], plantsTable({ seed: 33, days: [0, 4, 8, 12, 16, 20, 24, 28, 32], plants: 8, cvPlant: 0.15, cvMeas: 0.05 }))
  }
};

/** A simulated grow log in the course format (ffp-growlog-v1) — used when a student has no log yet. */
export function demoGrowLog() {
  const rng = mulberry32(2026); const rows = []; const start = new Date('2026-09-01T00:00:00');
  const trts = [['Control (EC 1.8)', 1.0, 17], ['Low light', 0.97, 12]];
  trts.forEach(([trt, f, dli], ti) => {
    for (let p = 1; p <= 4; p++) {
      const vig = f * Math.exp(0.08 * randn(rng)); const s = cropSeries({ dli, rueF: vig, fw0: 3 * Math.exp(0.15 * randn(rng)), days: 35 });
      for (let d = 0; d <= 35; d += 7) {
        const fw = s[d] * Math.exp(0.05 * randn(rng));
        const area = 5.94 * Math.pow(fw, 0.847) * Math.exp(0.05 * randn(rng));    // inverse of the illustrative calibration W = 0.122·A^1.18 (Lesson 10.3)
        const dt = new Date(start.getTime() + d * 86400000);
        rows.push({ date: dt.toISOString().slice(0, 10), day: d, plant: `${ti ? 'L' : 'C'}${p}`, treatment: trt, fw_g: r1(fw), leaves: Math.round(4 + d * 0.55 + randn(rng)), area_cm2: r1(area), height_cm: r1(4 + 11 * (1 - Math.exp(-d / 14)) + 0.5 * randn(rng)), ec: +(1.8 + 0.1 * randn(rng)).toFixed(2), ph: +(5.9 + 0.15 * randn(rng)).toFixed(2), t_water: r1(20 + randn(rng)), do_mgl: r1(8 + 0.4 * randn(rng)), ppfd: Math.round(dli * 1e6 / (16 * 3600)), notes: '' });
      }
    }
  });
  return { version: 1, meta: { title: 'Demo grow log (simulated)', crop: 'Butterhead lettuce', system: 'Deep-water culture', startDate: '2026-09-01', treatments: trts.map(t => t[0]) }, rows };
}
