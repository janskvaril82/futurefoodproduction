/* ==========================================================================
   Sensor bench — physical models (no DOM; unit-testable)
   Five sensors, each described as a measurement chain:
     measurand x → sensing element state y (first-order lag, τ) → transducer output q
     → conditioning circuit → ADC input voltage(s) V → ADC codes → firmware → reading x̂
   Every equation is documented in the Derive tab (Eqs. SB1–SB11) with its source.
   ========================================================================== */
import { svp, R as RGAS, K0, steinhartHart } from '/assets/js/physics.js';

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** Standard normal deviate from a uniform RNG (Box–Muller). */
export function gauss(rnd) { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/* ------------------------------------------------------------------ ADC (Eq. SB10) */
/** Peak integral nonlinearity of the ESP32 SAR ADC: ±12 LSB at 12 bit and 3.3 V full scale (Espressif, 2025). */
export const INL_ESP32_V = 12 * 3.3 / 4096;
/** Smooth 'bow' used to represent INL (zero at both ends, maximum at mid-scale). Representative shape, not a measured curve. */
export const inlError = (V, fs) => INL_ESP32_V * Math.sin(Math.PI * clamp(V / fs, 0, 1));
/**
 * Convert one analogue voltage with an N-bit SAR ADC. Averages `avg` conversions, each with its own noise.
 * vrefActual: the true full-scale voltage; vrefAssumed: the value the firmware uses to rebuild a voltage.
 */
export function adcConvert(V, adc, vrefActual, vrefAssumed, rnd) {
  const n = 2 ** adc.bits, lsbA = vrefActual / n;
  let sum = 0;
  for (let k = 0; k < adc.avg; k++) {
    const v = V + (adc.noise > 0 ? adc.noise * gauss(rnd) : 0) + (adc.inl ? inlError(V, vrefActual) : 0);
    sum += clamp(Math.floor(v / lsbA), 0, n - 1);
  }
  const code = sum / adc.avg;
  return { code, vrec: (code + 0.5) * vrefAssumed / n, lsb: vrefAssumed / n, sat: V >= vrefActual * (1 - 0.5 / n) || V < 0 };
}

/* ------------------------------------------------------------------ 1. NTC thermistor probe (SB1–SB3) */
/** Steinhart–Hart coefficients of THIS probe (3-point calibration of Lesson 9.1, Worked example 2). */
export const NTC_SH = { A: 1.092739e-3, B: 2.409652e-4, C: 5.363408e-8 };
/** Data-sheet nominal β model of the same part type. */
export const NTC_NOM = { R25: 10000, beta: 3950 };
/** True resistance of the probe at element temperature T (°C): exact inverse of Steinhart–Hart (Cardano). */
export function ntcR(T) {
  const { A, B, C } = NTC_SH;
  const x = (A - 1 / (T + K0)) / C, y = Math.sqrt(Math.pow(B / (3 * C), 3) + x * x / 4);
  return Math.exp(Math.cbrt(y - x / 2) - Math.cbrt(y + x / 2));
}
export const ntcBetaT = (R, R25 = NTC_NOM.R25, beta = NTC_NOM.beta) => 1 / (1 / 298.15 + Math.log(R / R25) / beta) - K0;
export const ntcShT = R => steinhartHart(R, NTC_SH.A, NTC_SH.B, NTC_SH.C);
/** Probe construction (6 mm stainless sheath, 0.3 mm wall, 30 mm sensing length, epoxy potting). */
export const PROBE = (() => {
  const L = 0.030, ro = 0.003, ri = 0.0027;
  const mcSteel = 7900 * 500 * Math.PI * (ro * ro - ri * ri) * L;       // ρ c V, J K⁻¹
  const mcEpoxy = 1150 * 1100 * Math.PI * ri * ri * L;
  const area = 2 * Math.PI * ro * L + 2 * Math.PI * ro * ro;            // side + hemispherical tip, m²
  return { mc: mcSteel + mcEpoxy, area, mcSteel, mcEpoxy };
})();
/** Convection coefficients h (W m⁻² K⁻¹) inside the typical ranges tabulated by Bergman et al. (2011). */
export const MEDIA = {
  stirred: { label: 'Stirred water', h: 500, water: true },
  water: { label: 'Still water', h: 150, water: true },
  breeze: { label: 'Moving air (≈2 m s⁻¹)', h: 30, water: false },
  air: { label: 'Still air', h: 8, water: false }
};
export const VS_NOMINAL = 3.3, VS_ACTUAL = 3.27; // regulator output assumed 0.9 % low (illustrative)

/* ------------------------------------------------------------------ 2. Capacitive RH element (SB4–SB5) */
/** HS1101LF polynomial response and its reverse polynomial (Measurement Specialties, 2012). */
export const rhPoly = RH => 3.903e-8 * RH ** 3 - 8.294e-6 * RH ** 2 + 2.188e-3 * RH + 0.898;
export const rhRevPoly = X => -3.4656e3 * X ** 3 + 1.0732e4 * X ** 2 - 1.0457e4 * X + 3.2459e3;
export const RH_EL = { C55unit: 181.2, C55nom: 180, TC: -0.01, tau: 3, Vmid: 1.65, Vex: 3.3, Cref: 178 };
/** RH seen by a sensor that is warmer (dT > 0) than the air: same vapour pressure, higher saturation pressure. */
export const rhAtSensor = (RH, Tair, dT) => clamp(RH * svp(Tair) / svp(Tair + dT), 0, 100);

/* ------------------------------------------------------------------ 3. Quantum (PAR) sensor (SB6) */
/** Photocurrent sensitivity of this sensor: 7.5 µA per 1000 µmol m⁻² s⁻¹ (LI-190R range 5–10; LI-COR, n.d.). */
export const PAR_K = 7.5e-9; // A per µmol m⁻² s⁻¹

/* ------------------------------------------------------------------ 4. NDIR CO₂ (SB7) */
/** Illustrative effective band-averaged absorption coefficient and folded optical path. */
export const NDIR = { k: 20, L: 0.06, V0act: 1.2e-3, V0ref: 1.0e-3, tau: 20, Pcal: 101325, Tcal: 25 };
/** Molar concentration of CO₂ (mol m⁻³) from mole fraction (ppm), pressure (hPa) and temperature (°C). */
export const co2Molar = (ppm, hPa, T) => ppm * 1e-6 * hPa * 100 / (RGAS * (T + K0));

/* ------------------------------------------------------------------ 5. Capacitive substrate-moisture probe (SB8–SB9) */
/** Relative permittivity of liquid water, Malmberg & Maryott (1956). */
export const epsWater = T => 87.740 - 0.40008 * T + 9.398e-4 * T * T - 1.410e-6 * T * T * T;
/** Substrate presets: total porosity φ and solid-phase permittivity εs (assumed values). */
export const SUBSTRATES = {
  coir: { label: 'Coir', phi: 0.94, epsS: 4, color: '#5b3a22' },
  stonewool: { label: 'Stone wool', phi: 0.96, epsS: 4, color: '#b59a5b' },
  peat: { label: 'Peat mix', phi: 0.90, epsS: 3, color: '#3b2a1e' },
  loam: { label: 'Loam soil', phi: 0.48, epsS: 5, color: '#5a4632' }
};
/** CRIM (Birchak et al., 1974; Roth et al., 1990): √εa = θ√εw + (1−φ)√εs + (φ−θ)√εair. */
export function crim(theta, sub, T) {
  const th = clamp(theta, 0, sub.phi);
  const s = th * Math.sqrt(epsWater(T)) + (1 - sub.phi) * Math.sqrt(sub.epsS) + (sub.phi - th) * 1;
  return s * s;
}
export const PROBE_C = { C0: 2e-12, Cg: 3.2e-12, Cc: 45e-12, R: 10e3, f: 1.5e6, D: 0.34, Vs: 3.3, VD: 0.28, tau: 1 };
export const probeCap = epsA => { const Cm = PROBE_C.Cg * epsA; return PROBE_C.C0 + PROBE_C.Cc * Cm / (PROBE_C.Cc + Cm); };
/** Steady-state peak voltage of a square wave (duty D, frequency f) driving R–C, minus the diode drop. */
export function peakDetector(C) {
  const { R, f, D, Vs, VD } = PROBE_C; const tau = R * C;
  const q1 = Math.exp(-D / (f * tau)), q0 = Math.exp(-(1 - D) / (f * tau));
  return Vs * (1 - q1) / (1 - q0 * q1) - VD;
}
/** Output voltage of the moisture probe for a given water content, substrate and temperature. */
export const vwcVolt = (theta, sub, T) => peakDetector(probeCap(crim(theta, sub, T)));

/* ==================================================================== sensor definitions
   Each sensor: x (measurand spec), tau(s), chain(y, s) → { q, V: [..], note }, firmware(Vrec[], s) → { q, x },
   typeB(x, s, chainRes) → [{label, u}] (standard uncertainties), bias(x, y, s) → [{label, v}] (known systematic errors
   that the firmware does not correct, evaluated at the operating point, excluding ADC effects).
   ==================================================================== */
export const SENSORS = {
  ntc: {
    key: 'ntc', name: 'NTC thermistor probe', short: 'NTC probe',
    x: { id: 'Tw', label: 'Temperature of the medium', unit: '°C', min: -5, max: 60, step: 0.1, value: 14, digits: 2, fmt: 2 },
    q: { label: 'Thermistor resistance R<sub>T</sub>', unit: 'kΩ', scale: 1e-3, digits: 3 },
    cond: 'Voltage divider',
    tau: s => PROBE.mc / (MEDIA[s.medium].h * PROBE.area),
    /** δ = hA: dissipation constant equals the thermal conductance to the medium (single-node model). */
    delta: s => MEDIA[s.medium].h * PROBE.area,
    chain(y, s) {
      const Vs = VS_ACTUAL; // the real supply; 'ratiometric' only changes which reference the ADC uses
      let Te = y, R = ntcR(Te), V = Vs * R / (s.Rf + R), P = 0;
      const d = this.delta(s);
      for (let i = 0; i < 4; i++) { P = V * V / R; Te = y + P / d; R = ntcR(Te); V = Vs * R / (s.Rf + R); }
      return { q: R, V: [V], Te, P, dTsh: Te - y, I: Vs / (s.Rf + R) };
    },
    adcRef: s => s.ratio ? { actual: VS_ACTUAL, assumed: VS_NOMINAL } : { actual: s.vref, assumed: s.vref },
    firmware(Vr, s) {
      const V = Vr[0];
      const R = s.Rf * V / (VS_NOMINAL - V);
      const T = s.fwNtc === 'sh' ? ntcShT(R) : ntcBetaT(R);
      return { q: R, x: T };
    },
    typeB(x, s) {
      if (s.fwNtc === 'sh') return [{ label: 'Calibration reference (bath + thermometer)', u: 0.03, note: 'assumed 0.03 K standard uncertainty of the 3-point calibration' }];
      // interchangeability of the part: ±1 % R25 and ±1 % β (rectangular)
      const R = ntcR(x), Tk = x + K0, alpha = NTC_NOM.beta / (Tk * Tk);
      const eR25 = 0.01 / alpha, eBeta = Tk * Tk / NTC_NOM.beta * Math.abs(Math.log(R / NTC_NOM.R25)) * 0.01;
      return [{ label: 'Interchangeability ±1 % R₂₅, ±1 % β', u: Math.hypot(eR25, eBeta) / Math.sqrt(3) }];
    },
    bias(x, y, s, ch) {
      const out = [];
      if (s.fwNtc !== 'sh') out.push({ label: 'β model vs real R(T) curve', v: ntcBetaT(ntcR(ch.Te)) - ch.Te });
      out.push({ label: 'Self-heating (P/δ)', v: ch.dTsh });
      if (!s.ratio) { // firmware assumes 3.300 V supply
        const Rw = s.Rf * ch.V[0] / (VS_NOMINAL - ch.V[0]);
        const conv = s.fwNtc === 'sh' ? ntcShT : ntcBetaT;
        out.push({ label: 'Supply ≠ 3.300 V (not ratiometric)', v: conv(Rw) - conv(ch.q) });
      }
      return out;
    }
  },

  rh: {
    key: 'rh', name: 'Capacitive humidity sensor', short: 'RH module',
    x: { id: 'RH', label: 'Relative humidity of the air', unit: '%RH', min: 1, max: 99, step: 0.5, value: 60, digits: 1, fmt: 1 },
    q: { label: 'Sensor capacitance C', unit: 'pF', scale: 1e12, digits: 2 },
    cond: 'Charge amplifier (C→V)',
    tau: () => RH_EL.tau,
    chain(y, s) {
      const RHs = rhAtSensor(y, s.Tair, s.dTs);
      const C = (RH_EL.C55unit * rhPoly(RHs) + RH_EL.TC * (s.Tair + s.dTs - 25)) * 1e-12;
      const V = clamp(RH_EL.Vmid + RH_EL.Vex * (C * 1e12 - RH_EL.Cref) / s.Cf, 0, 3.3);
      return { q: C, V: [V], RHs };
    },
    adcRef: s => ({ actual: s.vref, assumed: s.vref }),
    firmware(Vr, s) {
      const Cest = RH_EL.Cref + (Vr[0] - RH_EL.Vmid) * s.Cf / RH_EL.Vex;
      const C55 = s.fwRh === 'cal' ? RH_EL.C55unit : RH_EL.C55nom;
      return { q: Cest * 1e-12, x: clamp(rhRevPoly(Cest / C55), 0, 100) };
    },
    typeB() {
      return [
        { label: 'Deviation from typical curve ±2 %RH', u: 2 / Math.sqrt(3) },
        { label: 'Hysteresis ±1 %RH', u: 1 / Math.sqrt(3) }
      ];
    },
    bias(x, y, s, ch) {
      const out = [];
      out.push({ label: 'Sensor warmer than the air', v: ch.RHs - y });
      // model error of the reverse polynomial and unit tolerance, evaluated without electronics
      const C = RH_EL.C55unit * rhPoly(ch.RHs);
      const C55 = s.fwRh === 'cal' ? RH_EL.C55unit : RH_EL.C55nom;
      if (s.fwRh !== 'cal') out.push({ label: 'Unit C@55 %RH ≠ 180 pF (not calibrated)', v: rhRevPoly(C / C55) - rhRevPoly(C / RH_EL.C55unit) });
      out.push({ label: 'Reverse-polynomial fit', v: rhRevPoly(C / RH_EL.C55unit) - ch.RHs });
      return out;
    }
  },

  par: {
    key: 'par', name: 'Quantum (PAR) sensor', short: 'PAR sensor',
    x: { id: 'PPFD', label: 'PPFD at the sensor', unit: 'µmol m⁻² s⁻¹', min: 0, max: 2500, step: 5, value: 600, digits: 0, fmt: 0 },
    q: { label: 'Photocurrent I', unit: 'µA', scale: 1e6, digits: 3 },
    cond: 'Transimpedance amplifier',
    tau: () => 1e-6,
    chain(y, s) {
      const I = PAR_K * y;
      return { q: I, V: [clamp(I * s.Rtia, 0, 3.3)] };
    },
    adcRef: s => ({ actual: s.vref, assumed: s.vref }),
    firmware(Vr, s) { const I = Vr[0] / s.Rtia; return { q: I, x: I / PAR_K }; },
    typeB(x, s) {
      const r3 = Math.sqrt(3);
      return [
        { label: 'Calibration ±5 %', u: 0.05 * x / r3 },
        { label: 'Linearity ±1 %', u: 0.01 * x / r3 },
        { label: `Temperature ±0.15 % K⁻¹ (${Math.abs(s.Tair - 25).toFixed(0)} K from 25 °C)`, u: 0.0015 * Math.abs(s.Tair - 25) * x / r3 }
      ];
    },
    bias() { return []; }
  },

  co2: {
    key: 'co2', name: 'NDIR CO₂ module', short: 'NDIR CO₂',
    x: { id: 'CO2', label: 'CO₂ mole fraction', unit: 'ppm', min: 0, max: 5000, step: 5, value: 800, digits: 0, fmt: 0 },
    q: { label: 'Active / reference thermopile', unit: 'mV', scale: 1e3, digits: 4 },
    cond: 'Thermopile pre-amplifier',
    tau: () => NDIR.tau,
    chain(y, s) {
      const c = co2Molar(y, s.P, s.Tair);
      const lamp = s.lamp / 100;
      const va = NDIR.V0act * lamp * Math.exp(-NDIR.k * c * NDIR.L), vr = NDIR.V0ref * lamp;
      return { q: va, qRef: vr, V: [clamp(s.G * va, 0, 3.3), clamp(s.G * vr, 0, 3.3)], FA: 1 - Math.exp(-NDIR.k * c * NDIR.L), c };
    },
    adcRef: s => ({ actual: s.vref, assumed: s.vref }),
    firmware(Vr, s) {
      const r = s.dual ? Vr[0] / Math.max(1e-9, Vr[1]) : Vr[0] / (s.G * NDIR.V0ref);
      const A = -Math.log(Math.max(1e-9, r) / (NDIR.V0act / NDIR.V0ref));
      const c = A / (NDIR.k * NDIR.L);
      const T = s.ptc ? s.Tair : NDIR.Tcal, P = s.ptc ? s.P * 100 : NDIR.Pcal;
      return { q: Vr[0] / s.G, x: c * RGAS * (T + K0) / P * 1e6 };
    },
    typeB(x, s) {
      const r3 = Math.sqrt(3);
      return [
        { label: 'Calibration ±(30 ppm + 3 %)', u: (30 + 0.03 * x) / r3 },
        { label: `Temperature stability ±2.5 ppm K⁻¹`, u: 2.5 * Math.abs(s.Tair - 25) / r3 }
      ];
    },
    bias(x, y, s, ch) {
      const out = [];
      const cTrue = ch.c;
      const xRep = (T, P) => cTrue * RGAS * (T + K0) / P * 1e6;
      if (!s.ptc) out.push({ label: 'Pressure & temperature not compensated', v: xRep(NDIR.Tcal, NDIR.Pcal) - y });
      if (!s.dual && s.lamp < 100) {
        const extraA = -Math.log(s.lamp / 100); const cx = extraA / (NDIR.k * NDIR.L);
        const T = s.ptc ? s.Tair : NDIR.Tcal, P = s.ptc ? s.P * 100 : NDIR.Pcal;
        out.push({ label: 'Lamp ageing (single channel)', v: cx * RGAS * (T + K0) / P * 1e6 });
      }
      return out;
    }
  },

  vwc: {
    key: 'vwc', name: 'Capacitive substrate-moisture probe', short: 'Moisture probe',
    x: { id: 'theta', label: 'Volumetric water content θ', unit: 'm³ m⁻³', min: 0, max: 0.9, step: 0.005, value: 0.45, digits: 3, fmt: 3 },
    q: { label: 'Probe capacitance C', unit: 'pF', scale: 1e12, digits: 2 },
    cond: '555 oscillator + RC + peak detector',
    tau: () => PROBE_C.tau,
    chain(y, s) {
      const sub = SUBSTRATES[s.substrate];
      const th = clamp(y, 0, sub.phi);
      const eps = crim(th, sub, s.Tair), C = probeCap(eps);
      return { q: C, V: [clamp(peakDetector(C), 0, 3.3)], eps };
    },
    adcRef: s => ({ actual: s.vref, assumed: s.vref }),
    firmware(Vr, s) {
      const V = Vr[0], sub = SUBSTRATES[s.substrate];
      if (s.fwVwc === 'linear') {
        const Va = vwcAir(), Vw = vwcWater();
        return { q: NaN, x: clamp((Va - V) / (Va - Vw), 0, 1) };
      }
      return { q: NaN, x: invertVwc(V, sub, 20) };
    },
    typeB(x, s) { return s.fwVwc === 'linear' ? [] : [{ label: 'Substrate calibration (gravimetric)', u: 0.02 }]; },
    bias(x, y, s) {
      const sub = SUBSTRATES[s.substrate], out = [];
      const th = clamp(y, 0, sub.phi);
      const Vt = vwcVolt(th, sub, s.Tair);
      if (s.fwVwc === 'linear') out.push({ label: 'Linear air–water scale (non-linear sensor)', v: clamp((vwcAir() - Vt) / (vwcAir() - vwcWater()), 0, 1) - th });
      else out.push({ label: `Temperature (${s.Tair.toFixed(0)} °C vs 20 °C calibration)`, v: invertVwc(Vt, sub, 20) - th });
      if (y > sub.phi) out.push({ label: 'θ above porosity — clipped', v: sub.phi - y });
      return out;
    }
  }
};
/** Air and water reference voltages of the two-point 'hobby' calibration, at 20 °C. */
export const vwcAir = () => peakDetector(probeCap(1));
export const vwcWater = () => peakDetector(probeCap(epsWater(20)));
/** Invert V(θ) for a substrate calibrated at temperature Tc by bisection (V decreases with θ). */
export function invertVwc(V, sub, Tc) {
  let lo = 0, hi = sub.phi;
  if (V >= vwcVolt(0, sub, Tc)) return 0;
  if (V <= vwcVolt(sub.phi, sub, Tc)) return sub.phi;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (vwcVolt(m, sub, Tc) > V) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/* ==================================================================== generic measurement engine */
/** One complete sample: element state y → channel voltages → ADC → firmware reading. */
export function measure(key, y, s, rnd) {
  const S = SENSORS[key];
  const ch = S.chain(y, s);
  const ref = S.adcRef(s);
  const adc = { bits: s.bits, noise: s.noise * 1e-3, avg: s.avg, inl: s.inl };
  const conv = ch.V.map(v => adcConvert(v, adc, ref.actual, ref.assumed, rnd));
  const fw = S.firmware(conv.map(c => c.vrec), s);
  return { ch, conv, fw, ref };
}
/** Deterministic reading (no noise, single conversion, but with quantisation and INL) — for charts. */
export function readingDet(key, y, s) {
  const s2 = Object.assign({}, s, { noise: 0, avg: 1 });
  return measure(key, y, s2, () => 0.5).fw.x;
}
/** Partial derivatives of the firmware output with respect to each channel voltage (numerical). */
export function firmwareGrad(key, Vs, s) {
  const S = SENSORS[key]; const base = S.firmware(Vs, s).x;
  return Vs.map((v, i) => { const h = Math.max(1e-6, Math.abs(v) * 1e-5); const V2 = Vs.slice(); V2[i] = v + h; return (S.firmware(V2, s).x - base) / h; });
}
/**
 * Error budget at the operating point x (steady state, y = x): biases (signed, measurand units) and
 * standard uncertainties (GUM, measurand units), including ADC quantisation, noise and INL.
 */
export function budget(key, x, s) {
  const S = SENSORS[key];
  const ch = S.chain(x, s), ref = S.adcRef(s);
  const n = 2 ** s.bits, lsb = ref.assumed / n;
  const grad = firmwareGrad(key, ch.V, s);
  const sig = s.noise * 1e-3;
  const dithered = sig >= 0.5 * lsb;
  const items = [];
  S.typeB(x, s, ch).forEach(it => items.push({ label: it.label, u: it.u, kind: 'u', note: it.note }));
  const uq = Math.sqrt(grad.reduce((a, g) => a + (g * lsb / Math.sqrt(12)) ** 2, 0)) / (dithered ? Math.sqrt(s.avg) : 1);
  items.push({ label: `ADC quantisation (${s.bits} bit${dithered && s.avg > 1 ? `, dithered, ×${s.avg}` : ''})`, u: uq, kind: 'u' });
  const un = Math.sqrt(grad.reduce((a, g) => a + (g * sig) ** 2, 0)) / Math.sqrt(s.avg);
  items.push({ label: `Electrical noise (${s.noise.toFixed(2)} mV rms${s.avg > 1 ? ` ÷ √${s.avg}` : ''})`, u: un, kind: 'u' });
  S.bias(x, x, s, ch).forEach(it => items.push({ label: it.label, v: it.v, kind: 'b' }));
  if (s.inl) items.push({ label: 'ADC integral nonlinearity (ESP32-like)', v: grad.reduce((a, g, i) => a + g * inlError(ch.V[i], ref.actual), 0), kind: 'b' });
  const uc = Math.sqrt(items.filter(i => i.kind === 'u').reduce((a, i) => a + i.u * i.u, 0));
  const bsum = items.filter(i => i.kind === 'b').reduce((a, i) => a + i.v, 0);
  const sens = grad.map(g => 1 / g); // dV/dx per channel
  return { items, uc, U: 2 * uc, bsum, lsbX: Math.abs(grad[0] * lsb), sens, ch, sat: ch.V.some(v => v >= ref.actual * (1 - 1 / n)) };
}
