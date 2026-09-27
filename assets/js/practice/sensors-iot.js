/* ==========================================================================
   Practice generators — Module 9: Sensors, measurement and the Internet of Things
   Lessons: sensor-physics (9.1), electrochemical-sensors (9.2),
            measurement-uncertainty (9.3), iot-architectures (9.4)
   Every generator returns a fresh, randomised, auto-marked problem.
   Physical relations come from /assets/js/physics.js (thermistor β model,
   Steinhart–Hart, Nernst slope, electrode model, DO saturation, FAO-56
   saturation vapour pressure) so that lessons, labs and practice agree.
   Radio data: SX1276 sensitivities and demodulator SNR (Semtech datasheet),
   LoRa time on air (SX1276 formula, LoRaWAN: 13-byte MAC overhead,
   8-symbol preamble, explicit header, CRC on, CR 4/5).
   ========================================================================== */
import { rand, randInt, pick, shuffle, f, steps, mcq } from './helpers.js';
import { thermistorR, steinhartHart, nernstSlope, electrodeMV, doSaturation, svp, svpSlope } from '../physics.js';

/* ---------- local helpers ---------- */
const K0 = 273.15;
/** Plain number for use inside KaTeX (no thousands separators). */
const n = (v, s = 4) => {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) { const e = Math.floor(Math.log10(a)); return `${+(v / 10 ** e).toPrecision(s)}\\times10^{${e}}`; }
  return String(+v.toPrecision(s));
};
/** Number in parentheses when negative (for substitutions such as a − (−5)). */
const p = (v, s = 4) => v < 0 ? `(${n(v, s)})` : n(v, s);
const randn = rng => { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const round = (v, d) => +v.toFixed(d);
const fspl = (dm, fMHz) => 20 * Math.log10(dm / 1000) + 20 * Math.log10(fMHz) + 32.45; // dB, d in m
const LORA = { 7: -123, 8: -126, 9: -129, 10: -132, 11: -133, 12: -136 };   // SX1276, 125 kHz, dBm
const SNRMIN = { 7: -7.5, 8: -10, 9: -12.5, 10: -15, 11: -17.5, 12: -20 };   // dB
function loraToa(SF, app, BWkHz = 125) {
  const PL = app + 13, Ts = 2 ** SF / (BWkHz * 1000), DE = Ts >= 0.016 ? 1 : 0;
  const num = 8 * PL - 4 * SF + 28 + 16, den = 4 * (SF - 2 * DE), blocks = Math.ceil(num / den);
  const nPay = 8 + Math.max(blocks * 5, 0);
  return { PL, Ts, DE, num, den, blocks, nPay, toa: (12.25 + nPay) * Ts };
}
function mqttMatch(filter, topic) {
  const F = filter.split('/'), T = topic.split('/');
  if (topic.startsWith('$') && (F[0] === '+' || F[0] === '#')) return false;
  for (let i = 0; i < F.length; i++) {
    if (F[i] === '#') return true;
    if (i >= T.length) return false;
    if (F[i] !== '+' && F[i] !== T[i]) return false;
  }
  return F.length === T.length;
}

export default [
  /* ======================= 9.1 how sensors work ======================= */
  {
    id: 'si-divider-resistance', title: 'Thermistor resistance from a ratiometric ADC code', lesson: 'sensor-physics', difficulty: 1,
    gen(rng) {
      const Rf = pick(rng, [4700, 10000, 12000, 22000]), N = pick(rng, [10, 12]), T = rand(rng, 5, 35, 0.5);
      const RT = thermistorR(T), full = 2 ** N, code = Math.round(full * RT / (Rf + RT));
      const R = Rf * code / (full - code);
      return {
        q: `An NTC thermistor forms the lower leg of a voltage divider with a fixed ${f(Rf, 4)} Ω resistor on top. The ${N}-bit ADC uses the divider's supply voltage as its reference (a ratiometric measurement) and returns the code ${code}. What is the thermistor resistance?`,
        answer: R, tol: 0.01, unit: 'Ω',
        solution: steps(
          `Ratiometric divider (Eq. 9.1.3): \\(\\text{code} = 2^N R_T/(R_f + R_T)\\), hence \\(R_T = R_f\\,\\text{code}/(2^N - \\text{code})\\).`,
          `\\(R_T = ${Rf}\\times ${code}/(${full} - ${code}) = ${Rf}\\times ${n(code / (full - code), 5)} = ${n(R, 5)}\\ \\Omega\\).`,
          `The supply voltage cancels because the ADC reference and the divider share it: only the resistance ratio matters.`)
      };
    }
  },
  {
    id: 'si-beta-temperature', title: 'Temperature from resistance with the β model', lesson: 'sensor-physics', difficulty: 1,
    gen(rng) {
      const beta = pick(rng, [3380, 3435, 3950, 3977]), R = rand(rng, 3000, 35000, 10);
      const lnr = Math.log(R / 10000), invT = 1 / 298.15 + lnr / beta, T = 1 / invT - K0;
      return {
        q: `A 10 kΩ NTC thermistor (R₂₅ = 10 000 Ω, β = ${beta} K) has a resistance of ${f(R, 5)} Ω. What temperature does the β model give?`,
        answer: T, abstol: 0.05, unit: '°C',
        solution: steps(
          `β model (Eq. 9.1.5): \\(1/T = 1/T_{25} + \\ln(R_T/R_{25})/\\beta\\) with \\(T_{25} = 298.15\\) K.`,
          `\\(\\ln(${R}/10000) = ${n(lnr, 5)}\\); divided by β: \\(${n(lnr / beta, 5)}\\) K⁻¹.`,
          `\\(1/T = ${n(1 / 298.15, 6)} + ${p(lnr / beta, 5)} = ${n(invT, 6)}\\) K⁻¹, so \\(T = ${n(1 / invT, 5)}\\) K = ${n(T, 4)} °C.`,
          R > 10000 ? 'Higher resistance than at 25 °C means colder, as expected for an NTC.' : 'Lower resistance than at 25 °C means warmer, as expected for an NTC.')
      };
    }
  },
  {
    id: 'si-code-to-temperature', title: 'From an ADC code to a temperature', lesson: 'sensor-physics', difficulty: 2,
    gen(rng) {
      const T0 = rand(rng, 2, 38, 0.1), Rf = 10000, N = 12, full = 4096;
      const RT0 = thermistorR(T0, 10000, 3950), code = Math.round(full * RT0 / (Rf + RT0));
      const R = Rf * code / (full - code), lnr = Math.log(R / 10000), invT = 1 / 298.15 + lnr / 3950, T = 1 / invT - K0;
      return {
        q: `A logger reads a 10 kΩ NTC thermistor (β = 3950 K) through a divider with a 10 kΩ fixed resistor and a ratiometric 12-bit ADC. The code is ${code}. What is the temperature?`,
        answer: T, abstol: 0.08, unit: '°C',
        solution: steps(
          `Resistance: \\(R_T = R_f\\,\\text{code}/(2^N - \\text{code}) = 10000\\times ${code}/${full - code} = ${n(R, 5)}\\ \\Omega\\) (Eq. 9.1.3).`,
          `β model: \\(1/T = 1/298.15 + \\ln(${n(R, 5)}/10000)/3950 = ${n(1 / 298.15, 6)} + ${p(lnr / 3950, 5)} = ${n(invT, 6)}\\) K⁻¹.`,
          `\\(T = ${n(1 / invT, 5)}\\) K = ${n(T, 4)} °C.`)
      };
    }
  },
  {
    id: 'si-steinhart-hart', title: 'Temperature with the Steinhart–Hart equation', lesson: 'sensor-physics', difficulty: 2,
    gen(rng) {
      const A = 1.009249522e-3, B = 2.378405444e-4, C = 2.019202697e-7;
      const R = rand(rng, 2000, 40000, 10), L = Math.log(R), inv = A + B * L + C * L ** 3, T = steinhartHart(R);
      return {
        q: `A thermistor is described by the Steinhart–Hart coefficients A = 1.009249522 × 10⁻³, B = 2.378405444 × 10⁻⁴ and C = 2.019202697 × 10⁻⁷ K⁻¹. Its resistance is ${f(R, 5)} Ω. What is its temperature?`,
        answer: T, abstol: 0.02, unit: '°C',
        solution: steps(
          `\\(L = \\ln R = \\ln ${R} = ${n(L, 6)}\\); \\(L^3 = ${n(L ** 3, 6)}\\).`,
          `Eq. 9.1.6: \\(1/T = A + BL + CL^3 = ${n(A, 7)} + ${n(B * L, 6)} + ${n(C * L ** 3, 5)} = ${n(inv, 6)}\\) K⁻¹.`,
          `\\(T = ${n(1 / inv, 6)}\\) K = ${n(T, 5)} °C.`)
      };
    }
  },
  {
    id: 'si-adc-resolution', title: 'Temperature resolution of one ADC step', lesson: 'sensor-physics', difficulty: 2,
    gen(rng) {
      const N = pick(rng, [10, 12, 16]), Vref = pick(rng, [1.1, 2.048, 3.3, 5]), S = rand(rng, 5, 40, 0.5);
      const lsb = Vref / 2 ** N * 1000, res = lsb / S * 1000;
      return {
        q: `At the ADC input a temperature signal changes by ${S} mV per kelvin. The ADC has ${N} bits and a ${Vref} V reference. What temperature change corresponds to one least-significant bit? Give the answer in millikelvin.`,
        answer: res, tol: 0.02, unit: 'mK',
        solution: steps(
          `One LSB (Eq. 9.1.4): \\(V_{\\text{ref}}/2^N = ${Vref}/${2 ** N} = ${n(lsb, 4)}\\) mV.`,
          `Resolution in temperature: \\(\\Delta x_{\\min} = \\text{LSB}/S = ${n(lsb, 4)}/${S} = ${n(lsb / S, 4)}\\) K = ${n(res, 4)} mK.`,
          `Resolution is not accuracy: calibration, non-linearity and noise usually dominate long before one LSB does.`)
      };
    }
  },
  {
    id: 'si-first-order-wait', title: 'How long to wait for a first-order sensor', lesson: 'sensor-physics', difficulty: 1,
    gen(rng) {
      const tau = rand(rng, 5, 60, 1), dx = rand(rng, 2, 10, 0.5), d = pick(rng, [0.05, 0.1, 0.2]);
      const t = tau * Math.log(dx / d);
      return {
        q: `A temperature probe with a first-order time constant of ${tau} s is plunged into water that is ${dx} °C colder than its current reading. How long must you wait until the reading is within ${d} °C of the water temperature?`,
        answer: t, tol: 0.02, unit: 's',
        solution: steps(
          `Step response (Eq. 9.1.2): the remaining error decays as \\(|x_0 - x_1|\\,e^{-t/\\tau}\\).`,
          `Set it equal to δ: \\(t = \\tau\\ln(|x_0 - x_1|/\\delta) = ${tau}\\times\\ln(${dx}/${d}) = ${tau}\\times ${n(Math.log(dx / d), 4)} = ${n(t, 4)}\\) s.`,
          `That is ${n(t / tau, 3)} time constants.`)
      };
    }
  },
  {
    id: 'si-first-order-ramp', title: 'Dynamic error of a slow sensor on a ramp', lesson: 'sensor-physics', difficulty: 1,
    gen(rng) {
      const r = rand(rng, 1, 6, 0.5), tau = rand(rng, 2, 15, 1);
      const e = r / 60 * tau;
      return {
        q: `An air-temperature sensor in its radiation shield has a time constant of ${tau} min. On a sunny morning the greenhouse air warms steadily at ${r} °C per hour. Once the ramp is established, by how much does the reading lag behind the true air temperature?`,
        answer: e, tol: 0.02, unit: '°C',
        solution: steps(
          `For a ramp of rate \\(r\\), a first-order sensor lags by \\(r\\tau\\) (Eq. 9.1.2, ramp input).`,
          `\\(r = ${r}/60 = ${n(r / 60, 4)}\\) °C per min; \\(r\\tau = ${n(r / 60, 4)}\\times ${tau} = ${n(e, 3)}\\) °C, and the reading is delayed by ${tau} min.`)
      };
    }
  },
  {
    id: 'si-ndir-compensation', title: 'Pressure and temperature compensation of an NDIR sensor', lesson: 'sensor-physics', difficulty: 2,
    gen(rng) {
      const x = rand(rng, 400, 1500, 10), P = rand(rng, 940, 1040, 1), T = rand(rng, 10, 35, 0.5);
      const xt = x * (1013.25 / P) * ((T + K0) / 298.15);
      return {
        q: `An NDIR CO₂ sensor was calibrated at 1013.25 hPa and 25 °C and has no pressure input. It reads ${x} ppm while the barometric pressure is ${P} hPa and the gas in its cell is at ${T} °C. What is the true CO₂ mole fraction?`,
        answer: xt, tol: 0.005, unit: 'ppm',
        solution: steps(
          `The absorption depends on molecules per volume, \\(c = xP/(RT)\\), so (Eq. 9.1.8) \\(x_{\\text{true}} = x_{\\text{rep}}\\,(P_{\\text{cal}}/P)\\,(T/T_{\\text{cal}})\\).`,
          `\\(x_{\\text{true}} = ${x}\\times(1013.25/${P})\\times(${n(T + K0, 5)}/298.15) = ${x}\\times ${n(1013.25 / P, 5)}\\times ${n((T + K0) / 298.15, 5)} = ${n(xt, 4)}\\) ppm.`,
          P < 1013.25 ? 'Low pressure means fewer molecules per litre: an uncompensated sensor under-reads.' : 'High pressure means more molecules per litre: an uncompensated sensor over-reads.')
      };
    }
  },
  {
    id: 'si-beer-lambert-ndir', title: 'CO₂ from the transmittance of an NDIR cell', lesson: 'sensor-physics', difficulty: 3,
    gen(rng) {
      const k = rand(rng, 40, 60, 1), Lcm = rand(rng, 2, 8, 0.5), x = rand(rng, 400, 2000, 10), T = rand(rng, 15, 30, 0.5), P = rand(rng, 98, 103, 0.1);
      const R = 8.314462618, L = Lcm / 100;
      const c0 = x * 1e-6 * P * 1000 / (R * (T + K0)), tr = round(Math.exp(-k * c0 * L), 5);
      const c = -Math.log(tr) / (k * L), xa = c * R * (T + K0) / (P * 1000) * 1e6;
      return {
        q: `An NDIR cell with an optical path of ${Lcm} cm and a band-averaged absorption coefficient of ${k} m² mol⁻¹ transmits a fraction I/I₀ = ${tr} of the unabsorbed intensity. The gas is at ${T} °C and ${P} kPa. What is the CO₂ mole fraction?`,
        answer: xa, tol: 0.02, unit: 'ppm',
        solution: steps(
          `Beer–Lambert (Eq. 9.1.8): \\(c = -\\ln(I/I_0)/(kL) = -\\ln(${tr})/(${k}\\times ${L}) = ${n(-Math.log(tr), 4)}/${n(k * L, 4)} = ${n(c, 4)}\\) mol m⁻³.`,
          `Ideal gas: \\(x = cRT/P = ${n(c, 4)}\\times 8.314\\times ${n(T + K0, 5)}/${n(P * 1000, 5)} = ${n(xa * 1e-6, 4)}\\) mol mol⁻¹ = ${n(xa, 4)} ppm.`)
      };
    }
  },
  {
    id: 'si-topp', title: 'Water content from a TDR travel time (Topp equation)', lesson: 'sensor-physics', difficulty: 2,
    gen(rng) {
      const L = pick(rng, [0.1, 0.15, 0.2, 0.3]), eps0 = rand(rng, 4, 30, 0.1);
      const tns = round(2 * L * Math.sqrt(eps0) / 2.99792458e8 * 1e9, 2);
      const eps = (2.99792458e8 * tns * 1e-9 / (2 * L)) ** 2;
      const th = -0.053 + 0.0292 * eps - 5.5e-4 * eps ** 2 + 4.3e-6 * eps ** 3;
      return {
        q: `A TDR probe with ${L * 100}-cm rods is inserted into a mineral soil. The two-way travel time along the rods is ${tns} ns. What volumetric water content does the Topp equation give?`,
        answer: th, abstol: 0.005, unit: 'm³ m⁻³',
        solution: steps(
          `Apparent permittivity (Eq. 9.1.9): \\(\\varepsilon_a = (ct/2L)^2 = (2.998\\times10^{8}\\times ${tns}\\times10^{-9}/${n(2 * L, 3)})^2 = ${n(eps, 4)}\\).`,
          `Topp: \\(\\theta = -0.053 + 0.0292\\,\\varepsilon_a - 5.5\\times10^{-4}\\,\\varepsilon_a^2 + 4.3\\times10^{-6}\\,\\varepsilon_a^3 = ${n(th, 3)}\\) m³ m⁻³.`,
          `The Topp curve is for mineral soils; organic growing media need their own calibration.`)
      };
    }
  },
  {
    id: 'si-quantum-ads1115', title: 'PPFD from a quantum sensor and a 16-bit ADC', lesson: 'sensor-physics', difficulty: 2,
    gen(rng) {
      const code = randInt(rng, 300, 2800), lsb = 0.256 / 32768 * 1e6; // µV
      const mV = code * lsb / 1000, ppfd = mV / 0.01;
      return {
        q: `An analogue quantum sensor with a sensitivity of 0.01 mV per µmol m⁻² s⁻¹ is read by an ADS1115 in differential mode on its ±0.256 V range (16-bit two's complement, so one LSB = 0.256 V/2¹⁵). The ADC returns ${code}. What is the PPFD?`,
        answer: ppfd, tol: 0.01, unit: 'µmol m⁻² s⁻¹',
        solution: steps(
          `One LSB: \\(0.256/32768 = 7.8125\\times10^{-6}\\) V = 7.8125 µV.`,
          `Voltage: \\(${code}\\times 7.8125\\) µV = ${n(mV, 5)} mV.`,
          `PPFD = ${n(mV, 5)} mV ÷ 0.01 mV per µmol m⁻² s⁻¹ = ${n(ppfd, 5)} µmol m⁻² s⁻¹ — a resolution of 0.78 µmol m⁻² s⁻¹ per LSB.`)
      };
    }
  },

  /* ======================= 9.2 electrochemical sensors ======================= */
  {
    id: 'ec-nernst-slope', title: 'Nernst slope of a pH electrode at a given temperature', lesson: 'electrochemical-sensors', difficulty: 1,
    gen(rng) {
      const T = rand(rng, 5, 40, 0.5), s = nernstSlope(T);
      return {
        q: `What is the theoretical Nernst slope of a glass pH electrode at ${T} °C? Give it in mV per pH unit.`,
        answer: s, tol: 0.003, unit: 'mV per pH',
        solution: steps(
          `Eq. 9.2.2: \\(s = \\ln(10)RT/F = 0.19841\\,T\\) mV per pH with \\(T\\) in kelvin.`,
          `\\(s = 0.19841\\times ${n(T + K0, 5)} = ${n(s, 4)}\\) mV per pH (59.16 at 25 °C).`)
      };
    }
  },
  {
    id: 'ec-ph-two-point', title: 'Sample pH after a two-point calibration', lesson: 'electrochemical-sensors', difficulty: 2,
    gen(rng) {
      const eta = rand(rng, 0.92, 1.0, 0.001), off = rand(rng, -20, 20, 0.5), pHs = rand(rng, 5.0, 7.5, 0.01);
      const E7 = round(electrodeMV(7.0, 25, eta, off), 1), E4 = round(electrodeMV(4.01, 25, eta, off), 1), Ex = round(electrodeMV(pHs, 25, eta, off), 1);
      const S = (E4 - E7) / (4.01 - 7.0), pH = 7.0 + (Ex - E7) / S;
      return {
        q: `At 25 °C a pH electrode reads ${E7} mV in pH 7.00 buffer and ${E4} mV in pH 4.01 buffer. In a nutrient solution, also at 25 °C, it reads ${Ex} mV. What is the pH of the solution?`,
        answer: pH, abstol: 0.02, unit: '',
        solution: steps(
          `Slope (Eq. 9.2.3): \\(S = (E_2 - E_1)/(\\text{pH}_2 - \\text{pH}_1) = (${n(E4, 4)} - ${p(E7, 4)})/(4.01 - 7.00) = ${n(S, 4)}\\) mV per pH, i.e. ${n(Math.abs(S) / nernstSlope(25) * 100, 3)} % of 59.16.`,
          `\\(\\text{pH}_x = 7.00 + (E_x - E_7)/S = 7.00 + (${n(Ex, 4)} - ${p(E7, 4)})/${p(S, 4)} = ${n(pH, 3)}\\).`)
      };
    }
  },
  {
    id: 'ec-ph-atc', title: 'pH with automatic temperature compensation', lesson: 'electrochemical-sensors', difficulty: 3,
    gen(rng) {
      const eta = rand(rng, 0.94, 1.0, 0.001), Eiso = rand(rng, -15, 15, 0.5), Tx = rand(rng, 8, 35, 0.5), pHs = rand(rng, 5.2, 7.2, 0.01);
      const Ex = round(electrodeMV(pHs, Tx, eta, Eiso), 1);
      const sT = eta * nernstSlope(Tx), pH = 7 + (Eiso - Ex) / sT;
      return {
        q: `A pH electrode was calibrated at 25 °C: slope efficiency ${n(eta * 100, 4)} %, offset ${Eiso} mV at pH 7. It now reads ${Ex} mV in a tank at ${Tx} °C. What pH does a meter with automatic temperature compensation display?`,
        answer: pH, abstol: 0.02, unit: '',
        solution: steps(
          `Nernst slope at the sample temperature: \\(0.19841\\times ${n(Tx + K0, 5)} = ${n(nernstSlope(Tx), 4)}\\) mV per pH; times η: ${n(sT, 4)} mV per pH.`,
          `Eq. 9.2.4: \\(\\text{pH} = 7 + (E_{\\text{iso}} - E_x)/(\\eta\\,s(T_x)) = 7 + (${n(Eiso, 3)} - ${p(Ex, 4)})/${n(sT, 4)} = ${n(pH, 3)}\\).`,
          `ATC corrects the electrode's slope only; the true temperature dependence of the solution's pH is real chemistry and is not "corrected".`)
      };
    }
  },
  {
    id: 'ec-ec25', title: 'Conductivity referenced to 25 °C', lesson: 'electrochemical-sensors', difficulty: 1,
    gen(rng) {
      const ec = rand(rng, 0.8, 3.2, 0.01), T = rand(rng, 8, 32, 0.5), a = pick(rng, [0.019, 0.02]);
      const e25 = ec / (1 + a * (T - 25));
      return {
        q: `An uncompensated conductivity probe reads ${ec} mS cm⁻¹ in a nutrient solution at ${T} °C. What is EC₂₅ with a temperature coefficient of ${a} K⁻¹?`,
        answer: e25, tol: 0.01, unit: 'mS cm⁻¹',
        solution: steps(
          `Eq. 9.2.6: \\(\\kappa_{25} = \\kappa_T/[1 + \\alpha(T - 25)]\\).`,
          `\\(\\kappa_{25} = ${ec}/[1 + ${a}\\times ${p(T - 25, 3)}] = ${ec}/${n(1 + a * (T - 25), 4)} = ${n(e25, 4)}\\) mS cm⁻¹.`,
          T < 25 ? 'The solution is colder than 25 °C, so the referenced value is higher than the raw one.' : 'The solution is warmer than 25 °C, so the referenced value is lower than the raw one.')
      };
    }
  },
  {
    id: 'ec-cell-constant', title: 'Cell constant and sample conductivity', lesson: 'electrochemical-sensors', difficulty: 2,
    gen(rng) {
      const Rstd = rand(rng, 500, 900, 1), Rs = rand(rng, 300, 1500, 1);
      const K = 1.413e-3 * Rstd, k = K / Rs * 1000;
      return {
        q: `A conductivity cell reads ${Rstd} Ω in the 1413 µS cm⁻¹ KCl standard at 25 °C and ${Rs} Ω in a nutrient solution at 25 °C. What is the conductivity of the nutrient solution?`,
        answer: k, tol: 0.01, unit: 'mS cm⁻¹',
        solution: steps(
          `Cell constant (Eq. 9.2.5): \\(K_{\\text{cell}} = \\kappa_{\\text{std}}R_{\\text{std}} = 1.413\\times10^{-3}\\ \\text{S cm}^{-1}\\times ${Rstd}\\ \\Omega = ${n(K, 4)}\\ \\text{cm}^{-1}\\).`,
          `Sample: \\(\\kappa = K_{\\text{cell}}/R = ${n(K, 4)}/${Rs} = ${n(K / Rs, 4)}\\ \\text{S cm}^{-1}\\) = ${n(k, 4)} mS cm⁻¹.`)
      };
    }
  },
  {
    id: 'ec-stern-volmer', title: 'Dissolved oxygen from an optical sensor (Stern–Volmer)', lesson: 'electrochemical-sensors', difficulty: 2,
    gen(rng) {
      const T = rand(rng, 10, 30, 1), I0 = rand(rng, 900, 1100, 1), Iair = rand(rng, 330, 450, 1);
      const Is = rand(rng, Iair + 20, Math.round(I0 * 0.85), 1), Cs = doSaturation(T);
      const Ksv = (I0 / Iair - 1) / Cs, DO = (I0 / Is - 1) / Ksv;
      return {
        q: `An optical DO sensor gives ${I0} counts in a zero-oxygen solution and ${Iair} counts in air-saturated fresh water at ${T} °C, where the saturation concentration is ${n(Cs, 4)} mg L⁻¹. In a tank at the same temperature it reads ${Is} counts. What is the dissolved-oxygen concentration?`,
        answer: DO, tol: 0.02, unit: 'mg L⁻¹',
        solution: steps(
          `Stern–Volmer (Eq. 9.2.9): \\(K_{SV} = (I_0/I_{\\text{air}} - 1)/C_{\\text{sat}} = (${I0}/${Iair} - 1)/${n(Cs, 4)} = ${n(Ksv, 4)}\\) L mg⁻¹.`,
          `\\([\\text{O}_2] = (I_0/I - 1)/K_{SV} = (${I0}/${Is} - 1)/${n(Ksv, 4)} = ${n(DO, 4)}\\) mg L⁻¹ (${n(100 * DO / Cs, 3)} % saturation).`)
      };
    }
  },

  /* ======================= 9.3 calibration, uncertainty and data quality ======================= */
  {
    id: 'mu-type-a', title: 'Type A standard uncertainty of a mean', lesson: 'measurement-uncertainty', difficulty: 1,
    gen(rng) {
      const N = randInt(rng, 6, 10), m0 = rand(rng, 15, 25, 0.01), sd0 = rand(rng, 0.05, 0.4, 0.01);
      const xs = Array.from({ length: N }, () => round(m0 + sd0 * randn(rng), 2));
      const m = xs.reduce((a, b) => a + b, 0) / N, s = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (N - 1)), u = s / Math.sqrt(N);
      return {
        q: `Repeated readings of a water-temperature probe in a stirred bath (°C): ${xs.map(v => v.toFixed(2)).join(', ')}. What is the standard uncertainty of their mean?`,
        answer: u, tol: 0.02, unit: '°C',
        solution: steps(
          `Mean: \\(\\bar{x} = ${n(m, 5)}\\) °C (n = ${N}).`,
          `Experimental standard deviation: \\(s = \\sqrt{\\sum(x_i - \\bar{x})^2/(n-1)} = ${n(s, 4)}\\) °C.`,
          `Eq. 9.3.1: \\(u(\\bar{x}) = s/\\sqrt{n} = ${n(s, 4)}/\\sqrt{${N}} = ${n(u, 3)}\\) °C, with ${N - 1} degrees of freedom.`)
      };
    }
  },
  {
    id: 'mu-type-b', title: 'Type B standard uncertainty', lesson: 'measurement-uncertainty', difficulty: 1,
    gen(rng) {
      const v = randInt(rng, 0, 2);
      if (v === 0) {
        const a = rand(rng, 0.1, 2, 0.05), q = pick(rng, [['°C', 'temperature sensor'], ['%RH', 'humidity sensor'], ['mV', 'pH meter input']]);
        return { q: `The data sheet of a ${q[1]} states an accuracy of ±${a} ${q[0]} and nothing else. Following the GUM, what standard uncertainty should you use?`, answer: a / Math.sqrt(3), tol: 0.01, unit: q[0],
          solution: steps(`With only limits given, assume a rectangular distribution (Eq. 9.3.2).`, `\\(u = a/\\sqrt{3} = ${a}/1.732 = ${n(a / Math.sqrt(3), 3)}\\) ${q[0]}.`) };
      }
      if (v === 1) {
        const d = pick(rng, [0.0625, 0.1, 0.01, 0.5, 1]);
        return { q: `A display shows temperatures in steps of ${d} °C. What standard uncertainty does this resolution contribute?`, answer: d / Math.sqrt(12), tol: 0.01, unit: '°C',
          solution: steps(`The true value lies anywhere within ±δ/2 of the displayed value: rectangular with half-width δ/2.`, `\\(u = \\delta/\\sqrt{12} = ${d}/3.464 = ${n(d / Math.sqrt(12), 3)}\\) °C (Eq. 9.3.2).`) };
      }
      const U = rand(rng, 0.02, 0.3, 0.01), k = pick(rng, [2, 2, 2.2, 1.96]);
      return { q: `A reference thermometer's calibration certificate states an expanded uncertainty U = ${U} °C with a coverage factor k = ${k}. What is its standard uncertainty?`, answer: U / k, tol: 0.01, unit: '°C',
        solution: steps(`A certificate reports \\(U = k\\,u\\) (Eq. 9.3.4).`, `\\(u = U/k = ${U}/${k} = ${n(U / k, 3)}\\) °C.`) };
    }
  },
  {
    id: 'mu-combined-expanded', title: 'Combined and expanded uncertainty from a budget', lesson: 'measurement-uncertainty', difficulty: 2,
    gen(rng) {
      const s = rand(rng, 0.03, 0.3, 0.01), N = randInt(rng, 5, 12), a = rand(rng, 0.1, 0.5, 0.05), Uc = rand(rng, 0.03, 0.2, 0.01);
      const u1 = s / Math.sqrt(N), u2 = a / Math.sqrt(3), u3 = Uc / 2, uc = Math.sqrt(u1 ** 2 + u2 ** 2 + u3 ** 2);
      return {
        q: `A temperature result has three independent uncertainty contributions: (1) ${N} repeated readings with s = ${s} °C (use the uncertainty of the mean); (2) a sensor specification of ±${a} °C (rectangular); (3) a reference with U = ${Uc} °C (k = 2). What is the expanded uncertainty (k = 2) of the result?`,
        answer: 2 * uc, tol: 0.02, unit: '°C',
        solution: steps(
          `(1) Type A: \\(u_1 = ${s}/\\sqrt{${N}} = ${n(u1, 3)}\\) °C. (2) Type B: \\(u_2 = ${a}/\\sqrt{3} = ${n(u2, 3)}\\) °C. (3) \\(u_3 = ${Uc}/2 = ${n(u3, 3)}\\) °C.`,
          `Combine in quadrature (Eq. 9.3.3): \\(u_c = \\sqrt{${n(u1, 3)}^2 + ${n(u2, 3)}^2 + ${n(u3, 3)}^2} = ${n(uc, 3)}\\) °C.`,
          `Expand (Eq. 9.3.4): \\(U = 2u_c = ${n(2 * uc, 3)}\\) °C. The largest term dominates — improve that one first.`)
      };
    }
  },
  {
    id: 'mu-dli-uncertainty', title: 'Uncertainty of a DLI from a quantum sensor', lesson: 'measurement-uncertainty', difficulty: 2,
    gen(rng) {
      const ppfd = rand(rng, 150, 400, 5), h = rand(rng, 12, 20, 1), aC = pick(rng, [3, 4, 5]), aD = rand(rng, 1, 3, 0.5);
      const dli = ppfd * h * 3600 / 1e6, ur = Math.sqrt((aC / Math.sqrt(3)) ** 2 + (aD / Math.sqrt(3)) ** 2), U = 2 * dli * ur / 100;
      return {
        q: `A DLI is calculated from a constant PPFD of ${ppfd} µmol m⁻² s⁻¹ over a ${h}-h photoperiod, measured with a quantum sensor with a calibration uncertainty of ±${aC} % and a possible drift since calibration of ±${aD} %. Treat both as independent rectangular limits; noise is negligible. What is the expanded uncertainty (k = 2) of the DLI?`,
        answer: U, tol: 0.02, unit: 'mol m⁻² d⁻¹',
        solution: steps(
          `DLI \\(= ${ppfd}\\times ${h}\\times 3600/10^6 = ${n(dli, 4)}\\) mol m⁻² d⁻¹.`,
          `Relative standard uncertainties: \\(${aC}/\\sqrt{3} = ${n(aC / Math.sqrt(3), 3)}\\,\\%\\) and \\(${aD}/\\sqrt{3} = ${n(aD / Math.sqrt(3), 3)}\\,\\%\\); combined \\(${n(ur, 3)}\\,\\%\\).`,
          `Both errors are shared by every reading, so averaging does not reduce them. \\(U = 2\\times ${n(ur / 100, 3)}\\times ${n(dli, 4)} = ${n(U, 3)}\\) mol m⁻² d⁻¹.`)
      };
    }
  },
  {
    id: 'mu-vpd-uncertainty', title: 'Uncertainty of a VPD from temperature and humidity sensors', lesson: 'measurement-uncertainty', difficulty: 3,
    gen(rng) {
      const T = rand(rng, 18, 30, 0.5), RH = rand(rng, 50, 85, 1), aT = pick(rng, [0.1, 0.2, 0.3]), aH = pick(rng, [1.5, 1.8, 2, 3]);
      const es = svp(T), D = svpSlope(T), v = es * (1 - RH / 100), cT = D * (1 - RH / 100), cH = es / 100;
      const uT = aT / Math.sqrt(3), uH = aH / Math.sqrt(3), uc = Math.sqrt((cT * uT) ** 2 + (cH * uH) ** 2);
      return {
        q: `A sensor reads ${T} °C and ${RH} %RH with specified accuracies of ±${aT} °C and ±${aH} %RH (rectangular, independent). Using \\(e_s = 0.6108\\exp[17.27T/(T+237.3)]\\) kPa, what is the expanded uncertainty (k = 2) of the VPD?`,
        answer: 2 * uc, tol: 0.03, unit: 'kPa',
        solution: steps(
          `\\(e_s(${T}) = ${n(es, 4)}\\) kPa; VPD \\(= e_s(1 - h/100) = ${n(v, 4)}\\) kPa.`,
          `Sensitivities: \\(c_T = \\Delta(1 - h/100)\\) with \\(\\Delta = 4098\\,e_s/(T + 237.3)^2 = ${n(D, 4)}\\) kPa K⁻¹, so \\(c_T = ${n(cT, 4)}\\); \\(|c_h| = e_s/100 = ${n(cH, 4)}\\) kPa per %RH.`,
          `\\(u_T = ${aT}/\\sqrt{3} = ${n(uT, 3)}\\) K, \\(u_h = ${aH}/\\sqrt{3} = ${n(uH, 3)}\\) %RH; \\(u_c = \\sqrt{(${n(cT * uT, 3)})^2 + (${n(cH * uH, 3)})^2} = ${n(uc, 3)}\\) kPa.`,
          `\\(U = 2u_c = ${n(2 * uc, 3)}\\) kPa; humidity contributes ${n(100 * (cH * uH) ** 2 / uc ** 2, 3)} % of the variance.`)
      };
    }
  },
  {
    id: 'mu-inverse-x', title: 'Reading a value back through a calibration line', lesson: 'measurement-uncertainty', difficulty: 2,
    gen(rng) {
      const a = rand(rng, -0.6, 0.6, 0.001), b = rand(rng, 0.95, 1.05, 0.0001), y0 = rand(rng, 8, 32, 0.01);
      const x0 = (y0 - a) / b;
      return {
        q: `A calibration against a reference thermometer gave the line ŷ = ${a} + ${b}·x (x = reference temperature, y = probe indication, both in °C). The probe now indicates ${y0} °C. What is the calibrated temperature?`,
        answer: x0, abstol: 0.01, unit: '°C',
        solution: steps(
          `Inverse prediction (Eq. 9.3.6): \\(\\hat{x}_0 = (\\bar{y}_0 - a)/b\\).`,
          `\\(\\hat{x}_0 = (${y0} - ${p(a, 4)})/${b} = ${n(y0 - a, 5)}/${b} = ${n(x0, 5)}\\) °C.`)
      };
    }
  },
  {
    id: 'mu-inverse-u', title: 'Uncertainty of an inverse prediction', lesson: 'measurement-uncertainty', difficulty: 3,
    gen(rng) {
      const nC = pick(rng, [4, 5, 6, 7]), lo = pick(rng, [5, 10]), hi = pick(rng, [30, 35, 40]);
      const xs = Array.from({ length: nC }, (_, i) => lo + (hi - lo) * i / (nC - 1));
      const xm = xs.reduce((s, v) => s + v, 0) / nC, Sxx = xs.reduce((s, v) => s + (v - xm) ** 2, 0);
      const b = rand(rng, 0.97, 1.03, 0.0001), a = rand(rng, -0.5, 0.5, 0.001), s = rand(rng, 0.01, 0.06, 0.001), m = randInt(rng, 1, 6);
      const ym = round(a + b * xm, 3), y0 = rand(rng, lo + 1, hi - 1, 0.01);
      const u = s / Math.abs(b) * Math.sqrt(1 / m + 1 / nC + (y0 - ym) ** 2 / (b * b * Sxx));
      return {
        q: `A calibration with n = ${nC} points (x̄ = ${n(xm, 4)} °C, S<sub>xx</sub> = ${n(Sxx, 5)} °C², mean indication ȳ = ${ym} °C) gave the slope b = ${b} and a residual standard deviation s<sub>y/x</sub> = ${s} °C. An unknown gives a mean indication ȳ₀ = ${y0} °C from m = ${m} readings. What is the expanded uncertainty (k = 2) of the calibrated value, considering only the calibration and the new readings?`,
        answer: 2 * u, tol: 0.03, unit: '°C',
        solution: steps(
          `Eq. 9.3.6: \\(u(\\hat{x}_0) = \\dfrac{s_{y/x}}{|b|}\\sqrt{\\dfrac{1}{m} + \\dfrac{1}{n} + \\dfrac{(\\bar{y}_0 - \\bar{y})^2}{b^2S_{xx}}}\\).`,
          `Terms: \\(1/${m} = ${n(1 / m, 4)}\\); \\(1/${nC} = ${n(1 / nC, 4)}\\); \\((${y0} - ${ym})^2/(${n(b * b, 5)}\\times ${n(Sxx, 5)}) = ${n((y0 - ym) ** 2 / (b * b * Sxx), 3)}\\).`,
          `\\(u = (${s}/${b})\\times\\sqrt{${n(1 / m + 1 / nC + (y0 - ym) ** 2 / (b * b * Sxx), 4)}} = ${n(u, 3)}\\) °C; \\(U = 2u = ${n(2 * u, 3)}\\) °C.`,
          `In a full budget, also add the reference thermometer's uncertainty in quadrature.`)
      };
    }
  },
  {
    id: 'mu-alias', title: 'Apparent period of an under-sampled oscillation', lesson: 'measurement-uncertainty', difficulty: 2,
    gen(rng) {
      let P, dt, fa;
      do { P = rand(rng, 6, 30, 1); dt = rand(rng, 0.55 * P, 0.95 * P, 0.5); fa = Math.abs(1 / P - (1 / dt) * Math.round(dt / P)); } while (fa < 1e-6 || dt <= P / 2 || dt >= P);
      const Pa = 1 / fa;
      return {
        q: `A heater cycles on and off with a period of ${P} min. The logger samples the air temperature every ${dt} min. What period does the (aliased) oscillation in the logged data appear to have?`,
        answer: Pa, tol: 0.02, unit: 'min',
        solution: steps(
          `\\(f = 1/${P}\\) min⁻¹ = ${n(1 / P, 4)} min⁻¹; \\(f_s = 1/${dt}\\) = ${n(1 / dt, 4)} min⁻¹; Nyquist frequency \\(f_s/2 = ${n(0.5 / dt, 4)}\\) min⁻¹ &lt; \\(f\\): under-sampled.`,
          `Eq. 9.3.8: \\(f_a = |f - f_s\\cdot\\text{round}(f/f_s)| = |${n(1 / P, 4)} - ${n(1 / dt, 4)}| = ${n(fa, 4)}\\) min⁻¹.`,
          `Apparent period: \\(1/f_a = ${n(Pa, 4)}\\) min — a slow wave that does not exist.`)
      };
    }
  },
  {
    id: 'mu-ema-alpha', title: 'Smoothing factor of an exponential filter', lesson: 'measurement-uncertainty', difficulty: 2,
    gen(rng) {
      const dt = pick(rng, [10, 30, 60]), tm = rand(rng, 1, 15, 0.5), a = 1 - Math.exp(-dt / (tm * 60));
      return {
        q: `You want exponential smoothing that behaves like a first-order sensor with a time constant of ${tm} min, applied to samples taken every ${dt} s. What smoothing factor α should you use?`,
        answer: a, tol: 0.01, unit: '',
        solution: steps(
          `Exact discretisation of the first-order sensor (Eq. 9.3.9): \\(\\alpha = 1 - e^{-\\Delta t/\\tau}\\).`,
          `\\(\\Delta t/\\tau = ${dt}/${n(tm * 60, 4)} = ${n(dt / (tm * 60), 4)}\\); \\(\\alpha = 1 - e^{-${n(dt / (tm * 60), 4)}} = ${n(a, 4)}\\).`,
          `Noise is reduced to \\(\\sqrt{\\alpha/(2-\\alpha)} = ${n(Math.sqrt(a / (2 - a)), 3)}\\) of its raw value — like a ${n((2 - a) / a, 3)}-point moving average.`)
      };
    }
  },
  {
    id: 'mu-kalman-update', title: 'One update of a one-dimensional Kalman filter', lesson: 'measurement-uncertainty', difficulty: 2,
    gen(rng) {
      const xp = rand(rng, 18, 24, 0.01), sp = rand(rng, 0.1, 0.6, 0.01), sv = rand(rng, 0.1, 0.6, 0.01), z = round(xp + rand(rng, -1, 1, 0.01), 2);
      const Pm = sp * sp, R = sv * sv, K = Pm / (Pm + R), x = xp + K * (z - xp);
      return {
        q: `A Kalman filter predicts a tank temperature of ${xp} °C with a standard uncertainty of ${sp} °C (so P⁻ = ${n(Pm, 4)} °C²). The sensor, whose noise has a standard deviation of ${sv} °C, now reads ${z} °C. What is the updated estimate?`,
        answer: x, abstol: 0.005, unit: '°C',
        solution: steps(
          `Gain (Eq. 9.3.10): \\(K = P^-/(P^- + R) = ${n(Pm, 4)}/(${n(Pm, 4)} + ${n(R, 4)}) = ${n(K, 4)}\\).`,
          `Update: \\(\\hat{x} = \\hat{x}^- + K(z - \\hat{x}^-) = ${xp} + ${n(K, 4)}\\times ${p(z - xp, 3)} = ${n(x, 5)}\\) °C.`,
          `New variance \\(P = (1-K)P^- = ${n((1 - K) * Pm, 4)}\\) °C², i.e. u = ${n(Math.sqrt((1 - K) * Pm), 3)} °C — smaller than both inputs.`)
      };
    }
  },
  {
    id: 'mu-recal-interval', title: 'Longest recalibration interval for a drifting sensor', lesson: 'measurement-uncertainty', difficulty: 3,
    gen(rng) {
      const aC = pick(rng, [3, 4, 5]), r = rand(rng, 0.5, 3, 0.25), u0 = aC / Math.sqrt(3);
      const Umax = Math.ceil(2 * u0) + randInt(rng, 1, 4);
      const t = Math.sqrt(3 * ((Umax / 2) ** 2 - u0 ** 2)) / r;
      return {
        q: `A quantum sensor has a calibration uncertainty of ±${aC} % (rectangular) and drifts by at most ${r} % per year in an unknown direction. Your DLI data must have an expanded uncertainty of at most ${Umax} % (k = 2). What is the longest acceptable interval between calibrations?`,
        answer: t, tol: 0.03, unit: 'years',
        solution: steps(
          `\\(u_0 = ${aC}/\\sqrt{3} = ${n(u0, 4)}\\,\\%\\); the target standard uncertainty is \\(${Umax}/2 = ${n(Umax / 2, 3)}\\,\\%\\).`,
          `Eq. 9.3.7: \\(t_{\\max} = \\sqrt{3[(U_{\\max}/k)^2 - u_0^2]}/r = \\sqrt{3(${n((Umax / 2) ** 2, 4)} - ${n(u0 ** 2, 4)})}/${r} = ${n(t, 3)}\\) years.`)
      };
    }
  },
  {
    id: 'mu-mcq-concepts', title: 'Measurement concepts', lesson: 'measurement-uncertainty', difficulty: 1,
    gen(rng) {
      const items = [
        ['Readings of a humidity sensor cluster tightly around a value 3 %RH above the reference. The sensor is…', 'precise but not true (biased)', ['true but imprecise', 'accurate', 'neither true nor precise'], 'Small scatter is precision; a constant offset is a trueness problem, corrected by calibration, not by averaging.'],
        ['Which error is reduced by averaging many readings from the same sensor?', 'random electrical noise', ['a calibration offset', 'radiative heating of an unshielded sensor', 'drift since the last calibration'], 'Only random errors average out; systematic errors are shared by every reading.'],
        ['A temperature oscillation has a period of 10 min. To avoid aliasing, the sampling interval must be…', 'shorter than 5 min', ['shorter than 10 min', 'shorter than 20 min', 'exactly 10 min'], 'Nyquist: sample at more than twice the highest frequency, i.e. at intervals shorter than half the period (Eq. 9.3.8).'],
        ['Which quality-control test detects a stuck sensor that repeats the same value?', 'the flat-line (persistence) test', ['the gross range test', 'the rate-of-change test', 'the spike (Hampel) test'], 'A constant value passes range, step and spike tests; only a persistence test flags it.'],
        ['A data sheet states ±0.5 °C and nothing else. The GUM-recommended standard uncertainty is…', '0.5/√3 ≈ 0.29 °C', ['0.5 °C', '0.25 °C', '0.5/√12 ≈ 0.14 °C'], 'Limits without further information are treated as a rectangular distribution: u = a/√3 (Eq. 9.3.2).'],
        ['What does an expanded uncertainty with k = 2 mean for a normally distributed result?', 'an interval of about 95 % coverage probability', ['an interval that certainly contains the true value', 'twice the measurement error', 'the standard deviation of single readings'], 'For a normal distribution, ±2u covers 95.45 % of the probability (Eq. 9.3.4).']
      ];
      const [q, c, w, s] = pick(rng, items);
      return mcq(rng, q, c, w, `<p>${s}</p>`);
    }
  },

  /* ======================= 9.4 IoT architectures and networks ======================= */
  {
    id: 'iot-fspl', title: 'Free-space path loss', lesson: 'iot-architectures', difficulty: 1,
    gen(rng) {
      const d = rand(rng, 0.05, 15, 0.05), fq = pick(rng, [433, 868, 915, 2440, 5800]), L = fspl(d * 1000, fq);
      return {
        q: `What is the free-space path loss between two isotropic antennas ${f(d, 3)} km apart at ${fq} MHz?`,
        answer: L, abstol: 0.2, unit: 'dB',
        solution: steps(
          `Eq. 9.4.2: \\(L_{\\text{FS}} = 20\\log_{10}d_{\\text{km}} + 20\\log_{10}f_{\\text{MHz}} + 32.45\\).`,
          `\\(= ${n(20 * Math.log10(d), 4)} + ${n(20 * Math.log10(fq), 4)} + 32.45 = ${n(L, 4)}\\) dB.`)
      };
    }
  },
  {
    id: 'iot-sensitivity', title: 'Receiver sensitivity from noise, bandwidth and SNR', lesson: 'iot-architectures', difficulty: 1,
    gen(rng) {
      const SF = randInt(rng, 7, 12), B = pick(rng, [125, 250, 500]), NF = rand(rng, 4, 8, 0.5), snr = SNRMIN[SF];
      const S = -174 + 10 * Math.log10(B * 1000) + NF + snr;
      return {
        q: `A LoRa receiver uses SF${SF} (minimum demodulator SNR ${snr} dB) in a ${B} kHz channel and has a noise figure of ${NF} dB. What is its thermal-noise-limited sensitivity?`,
        answer: S, abstol: 0.2, unit: 'dBm',
        solution: steps(
          `Eq. 9.4.4: \\(S = -174 + 10\\log_{10}(B/\\text{Hz}) + NF + \\text{SNR}_{\\min}\\).`,
          `\\(10\\log_{10}(${B * 1000}) = ${n(10 * Math.log10(B * 1000), 4)}\\) dB; \\(S = -174 + ${n(10 * Math.log10(B * 1000), 4)} + ${NF} + ${p(snr, 3)} = ${n(S, 4)}\\) dBm.`)
      };
    }
  },
  {
    id: 'iot-link-margin', title: 'Link margin with the log-distance model', lesson: 'iot-architectures', difficulty: 2,
    gen(rng) {
      const SF = pick(rng, [7, 9, 12]), S = LORA[SF], d = rand(rng, 300, 5000, 50), nn = rand(rng, 2.4, 3.6, 0.1), gr = pick(rng, [3, 5, 6]), lc = rand(rng, 0.5, 3, 0.5);
      const L0 = fspl(100, 868), PL = L0 + 10 * nn * Math.log10(d / 100), prx = 14 + 2.15 + gr - lc - PL, M = prx - S;
      return {
        q: `A LoRa node (+14 dBm, 2.15 dBi antenna) is ${f(d, 4)} m from a gateway (${gr} dBi antenna, ${lc} dB cable loss) at 868 MHz. Assume free space up to 100 m and a path-loss exponent n = ${nn} beyond. The gateway's sensitivity at SF${SF} is ${S} dBm. What is the link margin?`,
        answer: M, abstol: 0.3, unit: 'dB',
        solution: steps(
          `Free-space loss at 100 m (Eq. 9.4.2): \\(20\\log_{10}0.1 + 20\\log_{10}868 + 32.45 = ${n(L0, 4)}\\) dB.`,
          `Log-distance (Eq. 9.4.3): \\(L_p = ${n(L0, 4)} + 10\\times ${nn}\\times\\log_{10}(${d}/100) = ${n(PL, 4)}\\) dB.`,
          `Received power (Eq. 9.4.1): \\(14 + 2.15 + ${gr} - ${lc} - ${n(PL, 4)} = ${n(prx, 4)}\\) dBm; margin \\(M = ${n(prx, 4)} - ${p(S, 4)} = ${n(M, 3)}\\) dB.`,
          M > 13 ? 'Comfortably above a typical 10–15 dB fade margin.' : M > 0 ? 'Positive but below a typical fade margin: the link would be unreliable.' : 'Negative: the link does not close.')
      };
    }
  },
  {
    id: 'iot-max-range', title: 'Reliable range from a link budget', lesson: 'iot-architectures', difficulty: 3,
    gen(rng) {
      const SF = pick(rng, [7, 10, 12]), S = LORA[SF], gr = pick(rng, [3, 5, 6]), lc = rand(rng, 0.5, 3, 0.5), nn = rand(rng, 2.6, 3.8, 0.1), sg = pick(rng, [6, 8, 10]);
      const rel = pick(rng, [[90, 1.2816], [95, 1.6449]]), fm = rel[1] * sg;
      const B = 14 + 2.15 + gr - lc - S - fm, L0 = fspl(100, 868), dmax = 100 * 10 ** ((B - L0) / (10 * nn));
      return {
        q: `A LoRa node (+14 dBm, 2.15 dBi) reports to a gateway with a ${gr} dBi antenna and ${lc} dB cable loss at 868 MHz, SF${SF} (sensitivity ${S} dBm). Propagation: free space to 100 m, exponent n = ${nn} beyond, shadowing σ = ${sg} dB. For ${rel[0]} % reliability (z = ${rel[1]}), what is the maximum range?`,
        answer: dmax / 1000, tol: 0.03, unit: 'km',
        solution: steps(
          `Fade margin: \\(z\\sigma = ${rel[1]}\\times ${sg} = ${n(fm, 4)}\\) dB. Allowed path loss: \\(14 + 2.15 + ${gr} - ${lc} - ${p(S, 4)} - ${n(fm, 4)} = ${n(B, 4)}\\) dB.`,
          `Free-space loss at 100 m: ${n(L0, 4)} dB, leaving \\(${n(B - L0, 4)}\\) dB for the log-distance part.`,
          `Eq. 9.4.3: \\(d_{\\max} = 100\\times10^{${n(B - L0, 4)}/(10\\times ${nn})} = ${n(dmax, 4)}\\) m = ${n(dmax / 1000, 3)} km.`)
      };
    }
  },
  {
    id: 'iot-fresnel', title: 'Mid-path radius of the first Fresnel zone', lesson: 'iot-architectures', difficulty: 2,
    gen(rng) {
      const d = rand(rng, 200, 5000, 50), fq = pick(rng, [868, 2440]), lam = 299.792458 / fq, r = 0.5 * Math.sqrt(lam * d);
      return {
        q: `A ${fq === 868 ? 'LoRa' : 'Wi-Fi'} link at ${fq} MHz spans ${f(d, 4)} m. What is the radius of the first Fresnel zone at mid-path?`,
        answer: r, tol: 0.02, unit: 'm',
        solution: steps(
          `Wavelength: \\(\\lambda = c/f = 2.998\\times10^{8}/${fq}\\times10^{6} = ${n(lam, 4)}\\) m.`,
          `Eq. 9.4.5: \\(r_{1,\\text{mid}} = \\tfrac12\\sqrt{\\lambda d} = 0.5\\times\\sqrt{${n(lam, 4)}\\times ${d}} = ${n(r, 3)}\\) m.`,
          `Keep at least 60 % of it (${n(0.6 * r, 3)} m) clear of the ground, crop and buildings.`)
      };
    }
  },
  {
    id: 'iot-lora-toa', title: 'LoRa time on air', lesson: 'iot-architectures', difficulty: 3,
    gen(rng) {
      const SF = randInt(rng, 7, 12), app = randInt(rng, 5, 40), r = loraToa(SF, app);
      return {
        q: `A LoRaWAN uplink carries ${app} bytes of application payload (plus 13 bytes of LoRaWAN overhead) at SF${SF}, 125 kHz, coding rate 4/5, explicit header, CRC on and an 8-symbol preamble. ${r.DE ? 'Low-data-rate optimisation is on (DE = 1).' : 'Low-data-rate optimisation is off (DE = 0).'} What is its time on air?`,
        answer: r.toa * 1000, tol: 0.005, unit: 'ms',
        solution: steps(
          `Symbol time: \\(T_{\\text{sym}} = 2^{${SF}}/125000 = ${n(r.Ts * 1000, 5)}\\) ms; preamble \\((8 + 4.25)T_{\\text{sym}} = ${n(12.25 * r.Ts * 1000, 5)}\\) ms.`,
          `PL = ${r.PL} bytes: \\(\\lceil(8\\times ${r.PL} - 4\\times ${SF} + 28 + 16)/(4\\times(${SF} - ${2 * r.DE}))\\rceil = \\lceil ${r.num}/${r.den}\\rceil = ${r.blocks}\\) blocks.`,
          `\\(n_{\\text{pay}} = 8 + ${r.blocks}\\times 5 = ${r.nPay}\\) symbols (Eq. 9.4.6).`,
          `\\(T_{\\text{air}} = (12.25 + ${r.nPay})\\times ${n(r.Ts * 1000, 5)} = ${n(r.toa * 1000, 5)}\\) ms.`)
      };
    }
  },
  {
    id: 'iot-duty-cycle', title: 'Duty-cycle and fair-use limits for LoRa', lesson: 'iot-architectures', difficulty: 2,
    gen(rng) {
      const toa = rand(rng, 50, 1500, 1), v = randInt(rng, 0, 1);
      if (v === 0) {
        const dc = pick(rng, [1, 1, 0.1]), t = toa / 1000 / (dc / 100);
        return {
          q: `A LoRa uplink lasts ${toa} ms and is sent in a sub-band with a ${dc} % duty-cycle limit. What is the shortest allowed interval between two such uplinks?`,
          answer: t, tol: 0.02, unit: 's',
          solution: steps(`Eq. 9.4.7: \\(T_{\\text{interval,min}} = T_{\\text{air}}/DC_{\\max} = ${n(toa / 1000, 4)}/${n(dc / 100, 3)} = ${n(t, 4)}\\) s.`, `After each transmission the device must stay silent for \\(${n(t - toa / 1000, 4)}\\) s.`)
        };
      }
      const N = 30 / (toa / 1000);
      return {
        q: `On The Things Network each device may use 30 s of uplink airtime per day. How many uplinks of ${toa} ms each may a device send per day?`,
        answer: N, abstol: 1, unit: 'per day',
        solution: steps(`\\(N = 30\\ \\text{s}/${n(toa / 1000, 4)}\\ \\text{s} = ${n(N, 4)}\\)`, `i.e. ${Math.floor(N)} whole messages — one every ${n(1440 / N, 3)} min on average.`)
      };
    }
  },
  {
    id: 'iot-battery-life', title: 'Battery life from a power budget', lesson: 'iot-architectures', difficulty: 2,
    gen(rng) {
      const T = pick(rng, [60, 300, 600, 900, 1800, 3600]), ts = rand(rng, 0.2, 1, 0.1), Is = rand(rng, 5, 50, 1), ttx = rand(rng, 0.05, 2, 0.05), Itx = rand(rng, 20, 200, 5), Isl = pick(rng, [5, 10, 20, 50, 150]), C = pick(rng, [1000, 2000, 2500, 3000]), eta = pick(rng, [0.7, 0.8, 0.85]);
      const q = ts * Is + ttx * Itx + (T - ts - ttx) * Isl / 1000, I = q / T, L = eta * C / I / 24;
      return {
        q: `A node wakes every ${T} s, measures for ${ts} s at ${Is} mA, transmits for ${ttx} s at ${Itx} mA and sleeps the rest of the cycle at ${Isl} µA. It runs from a ${C} mAh battery of which ${eta * 100} % is usable. How many days will it last?`,
        answer: L, tol: 0.02, unit: 'days',
        solution: steps(
          `Charge per cycle: \\(${ts}\\times ${Is} + ${ttx}\\times ${Itx} + ${n(T - ts - ttx, 5)}\\times ${n(Isl / 1000, 3)} = ${n(q, 4)}\\) mA·s.`,
          `Average current (Eq. 9.4.8): \\(\\bar{I} = ${n(q, 4)}/${T} = ${n(I, 4)}\\) mA.`,
          `Life: \\(L = ${eta}\\times ${C}/${n(I, 4)} = ${n(eta * C / I, 4)}\\) h = ${n(L, 4)} days.`)
      };
    }
  },
  {
    id: 'iot-solar-panel', title: 'Solar panel for the darkest month', lesson: 'iot-architectures', difficulty: 3,
    gen(rng) {
      const I = rand(rng, 0.1, 2, 0.01), H = pick(rng, [0.3, 0.4, 0.5, 1.0, 2.5]), PR = rand(rng, 0.5, 0.7, 0.05);
      const E = 3.3 * I * 24 / 0.85, P = E / (H * PR);
      return {
        q: `A sensor node draws ${I} mA on average at 3.3 V through a converter with 85 % efficiency. In the worst month the daily irradiation on the panel plane is ${H} kWh m⁻² d⁻¹ and the performance ratio is ${PR}. What is the minimum panel rating?`,
        answer: P, tol: 0.02, unit: 'mW',
        solution: steps(
          `Daily load: \\(E = 3.3\\times ${I}\\times 24/0.85 = ${n(E, 4)}\\) mWh d⁻¹.`,
          `Eq. 9.4.9: \\(P_{\\text{peak}} \\ge E/(H\\cdot PR) = ${n(E, 4)}/(${H}\\times ${PR}) = ${n(P, 4)}\\) mW.`,
          `Choose a larger panel and a battery for several dark days: December irradiation varies strongly between years.`)
      };
    }
  },
  {
    id: 'iot-data-volume', title: 'MQTT traffic of a sensor network', lesson: 'iot-architectures', difficulty: 1,
    gen(rng) {
      const N = rand(rng, 10, 100, 5), iv = pick(rng, [10, 30, 60, 300]), B = pick(rng, [60, 80, 100, 120]);
      const MB = N * (86400 / iv) * B / 1e6;
      return {
        q: `${N} sensors each publish one MQTT message every ${iv} s; each message puts about ${B} bytes on the network. How many megabytes per day is that (1 MB = 10⁶ bytes)?`,
        answer: MB, tol: 0.02, unit: 'MB per day',
        solution: steps(`Messages per day: \\(${N}\\times 86400/${iv} = ${n(N * 86400 / iv, 6)}\\).`, `Bytes: \\(${n(N * 86400 / iv, 6)}\\times ${B} = ${n(MB * 1e6, 5)}\\) B = ${n(MB, 4)} MB per day.`)
      };
    }
  },
  {
    id: 'iot-mqtt-wildcards', title: 'MQTT topic filters and wildcards', lesson: 'iot-architectures', difficulty: 1,
    gen(rng) {
      const TOPICS = ['mdu/gh1/zone1/air/temperature', 'mdu/gh1/zone1/air/rh', 'mdu/gh1/zone2/air/temperature', 'mdu/gh1/zone2/nutrient/ph', 'mdu/gh1/zone2/nutrient/ec', 'mdu/gh1/nodes/esp32-07/status', 'mdu/gh1/actuators/vent-north/state', 'mdu/gh1/zone1/air', 'mdu/lab/group3/tank/ph', 'mdu/gh1/alarms/frost'];
      const FILTERS = ['mdu/gh1/+/air/temperature', 'mdu/gh1/zone2/#', 'mdu/+/+/+/ph', 'mdu/gh1/+/air/#', 'mdu/gh1/nodes/+/status', 'mdu/gh1/+/nutrient/+'];
      for (const flt of shuffle(rng, FILTERS)) {
        const hit = TOPICS.filter(t => mqttMatch(flt, t)), miss = TOPICS.filter(t => !mqttMatch(flt, t));
        if (hit.length && miss.length >= 3) {
          const c = pick(rng, hit), w = shuffle(rng, miss).slice(0, 3);
          return mcq(rng, `Which of these topics is delivered to a client subscribed to <code>${flt}</code>?`, `<code>${c}</code>`, w.map(t => `<code>${t}</code>`),
            `<p><code>+</code> matches exactly one topic level and <code>#</code> matches the parent level and any number of levels below it. Topics matched by this filter: ${hit.map(t => `<code>${t}</code>`).join(', ')}.</p>`);
        }
      }
      return mcq(rng, 'Which MQTT wildcard matches exactly one topic level?', '<code>+</code>', ['<code>#</code>', '<code>*</code>', '<code>?</code>'], '<p><code>+</code> matches one level; <code>#</code> matches any number of levels and must come last.</p>');
    }
  },
  {
    id: 'iot-mcq-architecture', title: 'IoT design choices', lesson: 'iot-architectures', difficulty: 1,
    gen(rng) {
      const items = [
        ['Where should the decision to switch on frost-protection heating be made?', 'at the edge — in the local controller or gateway', ['in the cloud', 'on the grower’s phone', 'in the time-series database'], 'Safety-critical actions must not depend on the internet connection.'],
        ['Which MQTT feature tells a dashboard that a sensor node has died without disconnecting properly?', 'the Last Will and Testament', ['QoS 2', 'a retained message published by the node', 'the topic wildcard #'], 'The broker publishes the client’s pre-registered Last Will when the connection is lost unexpectedly.'],
        ['Which interface lets many DS18B20 temperature probes share one data wire?', '1-Wire, using each probe’s unique 64-bit ID', ['SPI with one chip select', 'UART', 'a 4–20 mA loop'], '1-Wire devices are addressed by their factory ROM code.'],
        ['Why does a LoRa link reach much farther than Wi-Fi from the same distance?', 'much better receiver sensitivity at a low data rate, and lower path loss at 868 MHz', ['LoRa transmits with much higher power', 'LoRa signals are not attenuated by distance', 'LoRa uses a licensed band'], 'Sensitivity −123 to −136 dBm versus about −98 dBm, plus about 9 dB less free-space loss than at 2.4 GHz.'],
        ['An ESP32 dev board draws 5 mA in "deep sleep". What mainly limits its battery life?', 'the sleep current of the board (regulator, USB chip, LED)', ['the Wi-Fi transmit current', 'the CPU speed', 'the MQTT QoS level'], 'Sleep lasts almost the whole cycle, so milliamperes of sleep current dominate the charge budget (Eq. 9.4.8).'],
        ['Since 11 September 2026, what does the EU Cyber Resilience Act require of manufacturers of products with digital elements?', 'to report actively exploited vulnerabilities and severe incidents', ['nothing yet — it applies only from 2030', 'to publish their source code', 'to use LoRaWAN'], 'The CRA (Regulation (EU) 2024/2847) reporting obligations apply from 11 September 2026; its main requirements from 11 December 2027.']
      ];
      const [q, c, w, s] = pick(rng, items);
      return mcq(rng, q, c, w, `<p>${s}</p>`);
    }
  }
];
