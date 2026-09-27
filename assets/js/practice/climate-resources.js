/* Practice generators — Module 8 "Climate engineering: energy, water and carbon balances".
   Lessons: energy-balance (8.1), psychrometrics (8.2), co2-enrichment (8.3), resource-use-efficiency (8.4).
   Constants follow the lessons: ρ = 1.2 kg m⁻³, c_p = 1005 J kg⁻¹ K⁻¹, Tetens saturation vapour pressure,
   outside CO₂ 427 ppm, natural gas 31.65 MJ m⁻³ (lower heating value) and 56.1 kg CO₂ GJ⁻¹. */
import { rand, randInt, pick, f, fm, steps, mcq } from './helpers.js';
import { svp, dewPoint, humidityRatio, enthalpy, latentHeat } from '../physics.js';

const RHO = 1.2, CP = 1005, COUT = 427;
const GAS_LHV = 31.65;                       // MJ m⁻³
const GAS_CO2 = 56.1 * GAS_LHV / 1000;       // kg CO₂ per m³ of gas (≈ 1.776)
/** CO₂ mass concentration per ppm at temperature T (°C) and 101.325 kPa, g m⁻³ ppm⁻¹. */
const kco2 = T => 101325 * 44.01 / (8.314462618 * (T + 273.15)) * 1e-6;
/** Number with a proper minus sign for running text. */
const sgn = v => (v < 0 ? '−' : '') + f(Math.abs(v));

export default [
  /* ======================= Lesson 8.1 — energy balance ======================= */
  {
    id: 'cr-u-value', title: 'U-value of a single-layer cover', lesson: 'energy-balance', difficulty: 1,
    gen(rng) {
      const m = pick(rng, [{ n: 'float glass', L: 4, k: 1.0 }, { n: 'polyethylene film', L: 0.2, k: 0.33 }, { n: 'acrylic sheet', L: 3, k: 0.19 }]);
      const hi = rand(rng, 5, 9, 0.5), ho = rand(rng, 12, 30, 1);
      const Rw = m.L / 1000 / m.k, Rt = 1 / hi + Rw + 1 / ho, U = 1 / Rt;
      return {
        q: `A greenhouse cover of ${m.n} is ${f(m.L)} mm thick (thermal conductivity ${f(m.k)} W m⁻¹ K⁻¹). The inside surface coefficient is ${f(hi)} W m⁻² K⁻¹ and the outside coefficient ${f(ho)} W m⁻² K⁻¹ (convection and radiation lumped together). Calculate the U-value of the cover.`,
        answer: U, tol: 0.02, unit: 'W m⁻² K⁻¹',
        solution: steps(
          `The three resistances act in series: \\(1/U = 1/h_i + L/k + 1/h_o\\) (Lesson 8.1).`,
          `\\(1/h_i = ${fm(1 / hi)}\\), \\(L/k = ${fm(m.L / 1000)}/${fm(m.k)} = ${fm(Rw)}\\) and \\(1/h_o = ${fm(1 / ho)}\\) m² K W⁻¹.`,
          `\\(1/U = ${fm(Rt)}\\) m² K W⁻¹, so \\(U = ${fm(U)}\\) W m⁻² K⁻¹.`,
          `Almost all of the resistance sits in the two air films, not in the material — which is why a second layer with a still air gap roughly halves U.`)
      };
    }
  },
  {
    id: 'cr-cover-loss', title: 'Heat loss through the cover', lesson: 'energy-balance', difficulty: 1,
    gen(rng) {
      const c = pick(rng, [{ n: 'single glass', U: 6.0 }, { n: 'double inflated polyethylene', U: 4.0 }, { n: 'double glass', U: 3.2 }]);
      const Af = pick(rng, [1000, 2000, 5000, 10000]), r = rand(rng, 1.2, 1.5, 0.05);
      const Ti = randInt(rng, 16, 22), To = randInt(rng, -15, 5);
      const Ac = Af * r, Q = c.U * Ac * (Ti - To) / 1000;
      return {
        q: `A greenhouse with ${f(Af)} m² of floor has a cover of ${c.n} (U = ${f(c.U)} W m⁻² K⁻¹); the cover area is ${f(r)} times the floor area. Inside it is ${Ti} °C, outside ${sgn(To)} °C. What is the heat loss through the cover?`,
        answer: Q, tol: 0.02, unit: 'kW',
        solution: steps(
          `Cover area: \\(A_c = ${fm(r)}\\times${fm(Af)} = ${fm(Ac, 4)}\\) m².`,
          `\\(Q = U\\,A_c\\,(T_i - T_o) = ${fm(c.U)}\\times${fm(Ac, 4)}\\times${fm(Ti - To)} = ${fm(Q * 1000, 4)}\\) W \\(= ${fm(Q)}\\) kW.`,
          `Per m² of floor this is ${f(Q * 1000 / Af)} W m⁻² — on a winter night nothing but the heating system can supply it.`)
      };
    }
  },
  {
    id: 'cr-vent-loss', title: 'Sensible heat loss by air exchange', lesson: 'energy-balance', difficulty: 2,
    gen(rng) {
      const Af = pick(rng, [2000, 5000, 10000]), h = rand(rng, 4, 7, 0.5), N = rand(rng, 0.5, 2, 0.25);
      const Ti = randInt(rng, 16, 22), To = randInt(rng, -10, 8);
      const V = Af * h, G = N * V / 3600, Q = RHO * CP * G * (Ti - To) / 1000;
      return {
        q: `A greenhouse has ${f(Af)} m² of floor and a mean height of ${f(h)} m. Leakage and ventilation exchange ${f(N)} air volumes per hour. Inside it is ${Ti} °C, outside ${sgn(To)} °C. Calculate the sensible heat lost with the exchanged air (ρ = 1.2 kg m⁻³, c<sub>p</sub> = 1005 J kg⁻¹ K⁻¹).`,
        answer: Q, tol: 0.02, unit: 'kW',
        solution: steps(
          `Air volume \\(V = ${fm(Af)}\\times${fm(h)} = ${fm(V)}\\) m³; volume flow \\(NV/3600 = ${fm(G)}\\) m³ s⁻¹.`,
          `\\(Q = \\rho\\,c_p\\,(NV/3600)\\,(T_i - T_o) = 1.2\\times1005\\times${fm(G)}\\times${fm(Ti - To)} = ${fm(Q * 1000, 4)}\\) W \\(= ${fm(Q)}\\) kW.`,
          `Per m² of floor: ${f(Q * 1000 / Af)} W m⁻², i.e. \\(\\rho c_p N\\bar h/3600 = ${fm(RHO * CP * N * h / 3600)}\\) W m⁻² K⁻¹ added to the cover loss coefficient.`)
      };
    }
  },
  {
    id: 'cr-degree-hours', title: 'Annual heating demand from degree-hours', lesson: 'energy-balance', difficulty: 2,
    gen(rng) {
      const U = pick(rng, [3.2, 4.0, 6.0]), r = rand(rng, 1.2, 1.5, 0.05), N = rand(rng, 0.3, 1, 0.1), h = rand(rng, 4, 6, 0.5);
      const DH = randInt(rng, 8, 14) * 10000;
      const Kc = U * r, Kv = RHO * CP * N * h / 3600, K = Kc + Kv, Q = K * DH / 1000;
      return {
        q: `A greenhouse cover has U = ${f(U)} W m⁻² K⁻¹ and a cover-to-floor area ratio of ${f(r)}; air leakage is ${f(N)} air changes per hour at a mean height of ${f(h)} m. The site has ${f(DH)} degree-hours (K h) per year below the heating set-point. Ignoring solar gains, estimate the annual heating demand per m² of floor (ρc<sub>p</sub> = 1.2 × 1005 J m⁻³ K⁻¹).`,
        answer: Q, tol: 0.02, unit: 'kWh m⁻² yr⁻¹',
        solution: steps(
          `Cover: \\(U\\,A_c/A_f = ${fm(U)}\\times${fm(r)} = ${fm(Kc)}\\) W m⁻² K⁻¹.`,
          `Air exchange: \\(\\rho c_p N\\bar h/3600 = 1206\\times${fm(N)}\\times${fm(h)}/3600 = ${fm(Kv)}\\) W m⁻² K⁻¹.`,
          `\\(K = ${fm(K)}\\) W m⁻² K⁻¹, so \\(Q_{\\text{year}} = K\\cdot\\text{DH}/1000 = ${fm(K)}\\times${fm(DH)}/1000 = ${fm(Q)}\\) kWh m⁻² yr⁻¹.`,
          `This is an upper bound: solar gains during the heating season lower the real demand (Lesson 8.1).`)
      };
    }
  },
  {
    id: 'cr-gas-heating', title: 'Natural gas for a heating demand', lesson: 'energy-balance', difficulty: 2,
    gen(rng) {
      const q = randInt(rng, 25, 70) * 10, eta = pick(rng, [0.9, 0.92, 0.95]), A = pick(rng, [5000, 10000, 20000]);
      const fuel = q * 3.6 / eta, vm2 = fuel / GAS_LHV, co2 = vm2 * GAS_CO2;
      return {
        q: `A greenhouse needs ${f(q)} kWh of heat per m² of floor per year, delivered by a gas boiler with an efficiency of ${f(eta * 100)} % (lower heating value). How many cubic metres of natural gas (31.65 MJ m⁻³) does it burn per m² per year?`,
        answer: vm2, tol: 0.02, unit: 'm³ m⁻² yr⁻¹',
        solution: steps(
          `Heat: \\(${fm(q)}\\ \\text{kWh}\\times3.6 = ${fm(q * 3.6)}\\) MJ m⁻² yr⁻¹; fuel energy \\(${fm(q * 3.6)}/${fm(eta)} = ${fm(fuel)}\\) MJ m⁻² yr⁻¹.`,
          `Gas volume: \\(${fm(fuel)}/31.65 = ${fm(vm2)}\\) m³ m⁻² yr⁻¹ — for ${f(A / 10000)} ha that is ${f(vm2 * A)} m³ per year.`,
          `CO₂ emitted: \\(${fm(vm2)}\\times${fm(GAS_CO2, 3)} = ${fm(co2)}\\) kg CO₂ m⁻² yr⁻¹ (56.1 kg CO₂ GJ⁻¹).`)
      };
    }
  },
  {
    id: 'cr-cop', title: 'Heat-pump COP from the Carnot limit', lesson: 'energy-balance', difficulty: 2,
    gen(rng) {
      const Th = pick(rng, [35, 40, 45, 50, 55]), Tc = randInt(rng, -5, 12), ex = pick(rng, [0.45, 0.5, 0.55]);
      const carnot = (Th + 273.15) / (Th - Tc), cop = ex * carnot;
      return {
        q: `A heat pump delivers heat to a greenhouse heating loop at ${Th} °C while extracting heat from a source at ${sgn(Tc)} °C. Real machines reach about ${f(ex * 100)} % of the Carnot limit. Estimate its heating COP.`,
        answer: cop, tol: 0.02, unit: '',
        solution: steps(
          `Use absolute temperatures: \\(T_h = ${fm(Th + 273.15, 5)}\\) K and \\(T_h - T_c = ${fm(Th - Tc)}\\) K.`,
          `\\(\\text{COP}_{h,\\text{Carnot}} = T_h/(T_h - T_c) = ${fm(carnot)}\\).`,
          `Real COP ≈ \\(${fm(ex)}\\times${fm(carnot)} = ${fm(cop)}\\): each kWh of electricity delivers about ${f(cop, 2)} kWh of heat. A lower supply temperature (larger heating surfaces) raises it.`)
      };
    }
  },
  {
    id: 'cr-led-cooling', title: 'LED heat load and HVAC electricity', lesson: 'energy-balance', difficulty: 2,
    gen(rng) {
      const ppfd = randInt(rng, 15, 35) * 10, eta = pick(rng, [2.5, 2.8, 3.0, 3.2, 3.5]);
      const tiers = randInt(rng, 4, 10), At = pick(rng, [50, 100, 200, 300]), aux = pick(rng, [0.1, 0.15]), cop = pick(rng, [3, 3.5, 4, 4.5, 5]);
      const Pl = ppfd / eta, Ptot = Pl * (1 + aux) * tiers * At / 1000, Phvac = Ptot / cop;
      return {
        q: `A plant-factory room has ${tiers} tiers of ${f(At)} m² each, lit at ${ppfd} µmol m⁻² s⁻¹ by LEDs with a photon efficacy of ${f(eta)} µmol J⁻¹. Pumps and fans add ${f(aux * 100)} % to the lighting power. Practically all of this electricity ends up as heat that the air-conditioner (cooling COP ${f(cop)}) must remove. What is the electrical power drawn by the air-conditioner during the photoperiod?`,
        answer: Phvac, tol: 0.02, unit: 'kW',
        solution: steps(
          `Lamp power per m²: \\(\\text{PPFD}/\\eta = ${fm(ppfd)}/${fm(eta)} = ${fm(Pl)}\\) W m⁻².`,
          `Heat load: \\(${fm(Pl)}\\times${fm(1 + aux)}\\times${tiers}\\times${fm(At)} = ${fm(Ptot * 1000, 4)}\\) W \\(= ${fm(Ptot)}\\) kW.`,
          `Air-conditioner: \\(${fm(Ptot)}/${fm(cop)} = ${fm(Phvac)}\\) kW, another ${f(100 / cop)} % on top of lamps and auxiliaries.`)
      };
    }
  },

  /* ======================= Lesson 8.2 — psychrometrics ======================= */
  {
    id: 'cr-vpd', title: 'Vapour pressure deficit of the air', lesson: 'psychrometrics', difficulty: 1,
    gen(rng) {
      const T = randInt(rng, 16, 32), RH = randInt(rng, 10, 18) * 5;
      const es = svp(T), v = es * (1 - RH / 100);
      return {
        q: `The air in a greenhouse is at ${T} °C and ${RH} % relative humidity. Calculate the vapour pressure deficit of the air.`,
        answer: v, tol: 0.02, unit: 'kPa',
        solution: steps(
          `Saturation vapour pressure (Tetens): \\(e_s = 0.6108\\exp\\!\\big(17.27\\times${T}/(${T} + 237.3)\\big) = ${fm(es, 4)}\\) kPa.`,
          `\\(\\text{VPD} = e_s\\,(1 - \\text{RH}/100) = ${fm(es, 4)}\\times${fm(1 - RH / 100)} = ${fm(v)}\\) kPa.`,
          `The same RH means a larger deficit in warm air, because \\(e_s\\) rises steeply with temperature.`)
      };
    }
  },
  {
    id: 'cr-vpd-leaf', title: 'Leaf-to-air vapour pressure deficit', lesson: 'psychrometrics', difficulty: 2,
    gen(rng) {
      const T = randInt(rng, 18, 28), RH = randInt(rng, 10, 16) * 5, dT = pick(rng, [-2, -1.5, -1, 1, 1.5, 2, 3]);
      const Tl = T + dT, e = svp(T) * RH / 100, v = svp(Tl) - e;
      return {
        q: `Air at ${T} °C and ${RH} % RH surrounds a leaf whose temperature is ${f(Math.abs(dT))} °C ${dT < 0 ? 'below' : 'above'} the air temperature (${dT < 0 ? 'cooled by transpiration' : 'warmed by the radiation of nearby LEDs'}). Calculate the leaf-to-air vapour pressure deficit.`,
        answer: v, abstol: 0.02, unit: 'kPa',
        solution: steps(
          `Vapour pressure of the air: \\(e_a = e_s(${T})\\times${fm(RH / 100)} = ${fm(svp(T), 4)}\\times${fm(RH / 100)} = ${fm(e, 4)}\\) kPa.`,
          `The air inside the leaf is saturated at leaf temperature: \\(e_s(${fm(Tl)}) = ${fm(svp(Tl), 4)}\\) kPa.`,
          `\\(\\text{VPD}_{\\text{leaf}} = ${fm(svp(Tl), 4)} - ${fm(e, 4)} = ${fm(v)}\\) kPa, against \\(${fm(svp(T) - e)}\\) kPa for the air alone.`)
      };
    }
  },
  {
    id: 'cr-dew-point', title: 'Dew point', lesson: 'psychrometrics', difficulty: 2,
    gen(rng) {
      const T = randInt(rng, 12, 28), RH = randInt(rng, 10, 19) * 5;
      const e = svp(T) * RH / 100, a = Math.log(e / 0.6108), Td = dewPoint(T, RH);
      return {
        q: `Greenhouse air is at ${T} °C and ${RH} % RH. Below which surface temperature will water condense?`,
        answer: Td, abstol: 0.3, unit: '°C',
        solution: steps(
          `Vapour pressure: \\(e = e_s(${T})\\times${fm(RH / 100)} = ${fm(e, 4)}\\) kPa.`,
          `Invert Tetens: \\(\\alpha = \\ln(e/0.6108) = ${fm(a, 4)}\\), \\(T_d = 237.3\\,\\alpha/(17.27 - \\alpha) = ${fm(Td)}\\) °C.`,
          `Any surface colder than ${sgn(+Td.toFixed(1))} °C — glass on a clear night, a cold pipe, a leaf cooled by radiation to the sky — gets wet.`)
      };
    }
  },
  {
    id: 'cr-condensation', title: 'Will the cover drip?', lesson: 'psychrometrics', difficulty: 2,
    gen(rng) {
      const T = randInt(rng, 15, 22), RH = randInt(rng, 14, 19) * 5, Td = dewPoint(T, RH);
      // the glass is always colder than the air; it is either clearly below or clearly above the dew point
      const lo = Math.ceil(Td + 1.5), hi = Math.floor(T - 1);
      let wet = rng() < 0.5;
      if (!wet && hi < lo) wet = true;
      const Ts = wet ? Math.round(Td - pick(rng, [2, 3, 4])) : randInt(rng, lo, hi);
      const tdTxt = sgn(+Td.toFixed(1));
      const correct = wet ? `Yes — the glass (${sgn(Ts)} °C) is colder than the dew point of the air (${tdTxt} °C).` : `No — the glass (${sgn(Ts)} °C) is warmer than the dew point of the air (${tdTxt} °C).`;
      const wrong = wet
        ? ['No — condensation requires 100 % relative humidity in the greenhouse air.', 'No — the glass is warmer than the outside air.', 'Only if the relative humidity rises above 95 %.']
        : ['Yes — any relative humidity above 70 % causes condensation on glass.', 'Yes — the glass is colder than the greenhouse air.', 'Only if the relative humidity falls below 70 %.'];
      return mcq(rng,
        `On a winter night the greenhouse air is ${T} °C and ${RH} % RH. The inner surface of the glass is ${sgn(Ts)} °C. Will water condense on the glass?`,
        correct, wrong,
        steps(`\\(e = e_s(${T})\\times${fm(RH / 100)} = ${fm(svp(T) * RH / 100, 4)}\\) kPa.`,
          `Dew point (inverse Tetens): \\(T_d = ${fm(Td)}\\) °C.`,
          `Water condenses on surfaces colder than \\(T_d\\): ${wet ? 'the glass is colder, so it drips.' : 'the glass is warmer, so it stays dry — even though it is colder than the air.'}`));
    }
  },
  {
    id: 'cr-humidity-ratio', title: 'Humidity ratio', lesson: 'psychrometrics', difficulty: 1,
    gen(rng) {
      const T = randInt(rng, 10, 30), RH = randInt(rng, 8, 19) * 5;
      const e = svp(T) * RH / 100, W = humidityRatio(e) * 1000;
      return {
        q: `Calculate the humidity ratio of air at ${T} °C and ${RH} % RH at standard pressure (101.325 kPa).`,
        answer: W, tol: 0.02, unit: 'g kg⁻¹',
        solution: steps(
          `\\(e = e_s(${T})\\times${fm(RH / 100)} = ${fm(svp(T), 4)}\\times${fm(RH / 100)} = ${fm(e, 4)}\\) kPa.`,
          `\\(W = 0.622\\,e/(P - e) = 0.622\\times${fm(e, 4)}/(101.325 - ${fm(e, 4)}) = ${fm(W / 1000, 4)}\\) kg kg⁻¹.`,
          `\\(W = ${fm(W)}\\) g of water vapour per kg of dry air.`)
      };
    }
  },
  {
    id: 'cr-enthalpy', title: 'Specific enthalpy of moist air', lesson: 'psychrometrics', difficulty: 2,
    gen(rng) {
      const T = randInt(rng, 5, 30), RH = randInt(rng, 8, 19) * 5;
      const e = svp(T) * RH / 100, W = humidityRatio(e), hh = enthalpy(T, W), lat = W * (2501 + 1.86 * T);
      return {
        q: `Calculate the specific enthalpy of air at ${T} °C and ${RH} % RH (standard pressure), in kJ per kg of dry air.`,
        answer: hh, tol: 0.02, unit: 'kJ kg⁻¹',
        solution: steps(
          `\\(e = ${fm(e, 4)}\\) kPa and \\(W = 0.622\\,e/(P - e) = ${fm(W, 4)}\\) kg kg⁻¹.`,
          `\\(h = 1.006\\,t + W\\,(2501 + 1.86\\,t) = 1.006\\times${T} + ${fm(W, 4)}\\times(2501 + 1.86\\times${T})\\).`,
          `\\(h = ${fm(1.006 * T)} + ${fm(lat)} = ${fm(hh)}\\) kJ kg⁻¹; ${f(100 * lat / hh, 2)} % of it is latent heat carried by the vapour.`)
      };
    }
  },
  {
    id: 'cr-latent-load', title: 'Latent heat load of transpiration', lesson: 'psychrometrics', difficulty: 2,
    gen(rng) {
      const E = randInt(rng, 10, 40) * 10, T = randInt(rng, 18, 26);
      const lam = latentHeat(T), ms = E / 1000 / 3600, q = lam * ms;
      return {
        q: `A crop transpires ${E} g of water per m² per hour at ${T} °C. How much heat does the evaporation take from the canopy (and add to the air as latent heat), in W per m²?`,
        answer: q, tol: 0.02, unit: 'W m⁻²',
        solution: steps(
          `Latent heat of vaporisation: \\(\\lambda = 2.501\\times10^{6} - 2361\\times${T} = ${fm(lam, 4)}\\) J kg⁻¹.`,
          `Mass flux: \\(${E}\\ \\text{g m}^{-2}\\,\\text{h}^{-1} = ${fm(ms, 3)}\\) kg m⁻² s⁻¹.`,
          `\\(\\lambda E = ${fm(lam, 4)}\\times${fm(ms, 3)} = ${fm(q)}\\) W m⁻² — a load that ventilation or the dehumidifier must remove.`)
      };
    }
  },
  {
    id: 'cr-vent-dehum', title: 'Ventilation needed to remove transpired water', lesson: 'psychrometrics', difficulty: 3,
    gen(rng) {
      const Ti = randInt(rng, 17, 21), RHi = randInt(rng, 16, 18) * 5, To = randInt(rng, -2, 8), RHo = randInt(rng, 16, 19) * 5;
      const E = randInt(rng, 3, 10) * 10;
      const Wi = humidityRatio(svp(Ti) * RHi / 100) * 1000, Wo = humidityRatio(svp(To) * RHo / 100) * 1000;
      const g = E / (RHO * (Wi - Wo)), Qs = RHO * CP * g / 3600 * (Ti - To);
      return {
        q: `On an autumn night a greenhouse crop transpires ${E} g m⁻² h⁻¹. The grower wants to hold ${Ti} °C and ${RHi} % RH inside; outside it is ${sgn(To)} °C and ${RHo} % RH. How much outside air must be exchanged per m² of floor per hour to remove the vapour (ρ = 1.2 kg m⁻³)?`,
        answer: g, tol: 0.03, unit: 'm³ m⁻² h⁻¹',
        solution: steps(
          `Humidity ratios: \\(W_i = ${fm(Wi)}\\) g kg⁻¹ inside and \\(W_o = ${fm(Wo)}\\) g kg⁻¹ outside.`,
          `Each m³ of exchanged air carries away \\(\\rho\\,(W_i - W_o) = 1.2\\times${fm(Wi - Wo)} = ${fm(RHO * (Wi - Wo))}\\) g of water.`,
          `\\(g = E/[\\rho\\,(W_i - W_o)] = ${E}/${fm(RHO * (Wi - Wo))} = ${fm(g)}\\) m³ m⁻² h⁻¹.`,
          `The price: this air must be heated from ${sgn(To)} to ${Ti} °C, \\(\\rho c_p g\\,\\Delta T/3600 = ${fm(Qs)}\\) W m⁻² of sensible heat (Lesson 8.2).`)
      };
    }
  },

  /* ======================= Lesson 8.3 — CO₂ enrichment ======================= */
  {
    id: 'cr-ppm-mg', title: 'CO₂: ppm to mg m⁻³', lesson: 'co2-enrichment', difficulty: 1,
    gen(rng) {
      const x = randInt(rng, 8, 30) * 50, T = pick(rng, [0, 10, 15, 20, 25, 30]);
      const k = kco2(T), rho = x * k * 1000;
      return {
        q: `Convert a CO₂ concentration of ${x} ppm (µmol mol⁻¹) at ${T} °C and 101.325 kPa into a mass concentration.`,
        answer: rho, tol: 0.02, unit: 'mg m⁻³',
        solution: steps(
          `Ideal gas: \\(\\rho = x\\,PM/(RT)\\) with \\(M = 44.01\\) g mol⁻¹ and \\(T = ${fm(T + 273.15, 5)}\\) K.`,
          `\\(PM/(RT) = 101325\\times44.01/(8.314\\times${fm(T + 273.15, 5)}) = ${fm(k * 1e6, 4)}\\) g m⁻³ for pure CO₂, i.e. \\(${fm(k * 1000, 4)}\\) mg m⁻³ per ppm.`,
          `\\(\\rho = ${x}\\times${fm(k * 1000, 4)} = ${fm(rho, 4)}\\) mg m⁻³.`)
      };
    }
  },
  {
    id: 'cr-co2-inventory', title: 'CO₂ needed to fill a greenhouse', lesson: 'co2-enrichment', difficulty: 1,
    gen(rng) {
      const A = pick(rng, [0.5, 1, 2, 4]), h = rand(rng, 4, 7, 0.5), C0 = pick(rng, [380, 400, 427]), C1 = randInt(rng, 12, 20) * 50;
      const k = kco2(20), V = A * 1e4 * h, m = k * V * (C1 - C0) / 1000;
      return {
        q: `How much pure CO₂ is needed to raise the concentration in a ${f(A)} ha greenhouse (mean height ${f(h)} m, 20 °C) from ${C0} to ${C1} ppm, ignoring leakage and crop uptake?`,
        answer: m, tol: 0.02, unit: 'kg',
        solution: steps(
          `At 20 °C one ppm of CO₂ is \\(${fm(k, 4)}\\) g m⁻³.`,
          `Air volume: \\(${fm(A * 1e4)}\\ \\text{m}^2\\times${fm(h)}\\ \\text{m} = ${fm(V)}\\) m³.`,
          `\\(m = ${fm(k, 4)}\\times${fm(V)}\\times${fm(C1 - C0)} = ${fm(m * 1000, 4)}\\) g \\(= ${fm(m)}\\) kg — little compared with what an open vent loses in an hour (Lesson 8.3).`)
      };
    }
  },
  {
    id: 'cr-co2-supply', title: 'CO₂ supply to hold a set-point', lesson: 'co2-enrichment', difficulty: 2,
    gen(rng) {
      const Cs = randInt(rng, 12, 20) * 50, N = pick(rng, [0.2, 0.5, 1, 1.5, 2]), h = rand(rng, 4, 6, 0.5), Aup = randInt(rng, 4, 10) * 5;
      const k = kco2(20), loss = 10 * k * N * h * (Cs - COUT), phi = Aup + loss;
      return {
        q: `A greenhouse (mean height ${f(h)} m, 20 °C) is ventilated at ${f(N)} air changes per hour and its crop takes up ${Aup} kg CO₂ ha⁻¹ h⁻¹. The outside air contains ${COUT} ppm. How much CO₂ must be supplied per hectare per hour to hold ${Cs} ppm inside?`,
        answer: phi, tol: 0.02, unit: 'kg ha⁻¹ h⁻¹',
        solution: steps(
          `Steady state: supply = uptake + ventilation loss, \\(\\Phi = A_{\\text{up}} + k\\,N\\,\\bar h\\,(C_s - C_{\\text{out}})\\).`,
          `Loss: \\(${fm(k, 4)}\\times${fm(N)}\\times${fm(h)}\\times${fm(Cs - COUT)} = ${fm(loss / 10)}\\) g m⁻² h⁻¹ \\(= ${fm(loss)}\\) kg ha⁻¹ h⁻¹ (1 g m⁻² = 10 kg ha⁻¹).`,
          `\\(\\Phi = ${Aup} + ${fm(loss)} = ${fm(phi)}\\) kg ha⁻¹ h⁻¹; only \\(${fm(100 * Aup / phi)}\\) % of it ends up in the crop.`)
      };
    }
  },
  {
    id: 'cr-co2-steady', title: 'Steady-state CO₂ concentration', lesson: 'co2-enrichment', difficulty: 2,
    gen(rng) {
      const k = kco2(20);
      let phi = 100, Aup = 30, N = 1, h = 5, C = 0, tries = 0;
      do {
        phi = randInt(rng, 5, 20) * 10; Aup = randInt(rng, 4, 10) * 5; N = pick(rng, [0.5, 1, 2, 3]); h = rand(rng, 4, 6, 0.5);
        C = COUT + (phi - Aup) / (10 * k * N * h); tries++;
      } while ((C < 380 || C > 1400) && tries < 60);
      if (C < 380 || C > 1400) { phi = 100; Aup = 30; N = 2; h = 5; C = COUT + (phi - Aup) / (10 * k * N * h); }
      return {
        q: `A CO₂ dosing system supplies ${phi} kg ha⁻¹ h⁻¹ to a greenhouse (mean height ${f(h)} m, 20 °C) whose crop takes up ${Aup} kg ha⁻¹ h⁻¹. The vents exchange ${f(N)} air volumes per hour with outside air at ${COUT} ppm. At which concentration will the greenhouse settle?`,
        answer: C, tol: 0.02, unit: 'ppm',
        solution: steps(
          `At steady state \\(\\Phi_{\\text{inj}} - A_{\\text{up}} = 10\\,k\\,N\\,\\bar h\\,(C - C_{\\text{out}})\\) in kg ha⁻¹ h⁻¹, with \\(k = ${fm(k, 4)}\\) g m⁻³ ppm⁻¹.`,
          `\\(10\\,k\\,N\\,\\bar h = 10\\times${fm(k, 4)}\\times${fm(N)}\\times${fm(h)} = ${fm(10 * k * N * h)}\\) kg ha⁻¹ h⁻¹ per ppm.`,
          `\\(C = ${COUT} + (${phi} - ${Aup})/${fm(10 * k * N * h)} = ${fm(C, 4)}\\) ppm.`)
      };
    }
  },
  {
    id: 'cr-co2-cue', title: 'CO₂-use efficiency', lesson: 'co2-enrichment', difficulty: 2,
    gen(rng) {
      const Cs = randInt(rng, 12, 20) * 50, N = pick(rng, [0.1, 0.3, 0.5, 1, 2, 4]), h = rand(rng, 4, 6, 0.5), Aup = randInt(rng, 4, 10) * 5;
      const k = kco2(20), loss = 10 * k * N * h * (Cs - COUT), cue = 100 * Aup / (Aup + loss);
      return {
        q: `A greenhouse crop takes up ${Aup} kg CO₂ ha⁻¹ h⁻¹ while the concentration is held at ${Cs} ppm (outside ${COUT} ppm, mean height ${f(h)} m, 20 °C, ${f(N)} air changes per hour). What percentage of the supplied CO₂ ends up in the crop?`,
        answer: cue, tol: 0.02, unit: '%',
        solution: steps(
          `Ventilation loss: \\(10\\,k\\,N\\,\\bar h\\,(C_s - C_{\\text{out}}) = 10\\times${fm(k, 4)}\\times${fm(N)}\\times${fm(h)}\\times${fm(Cs - COUT)} = ${fm(loss)}\\) kg ha⁻¹ h⁻¹.`,
          `Supply = uptake + loss = \\(${Aup} + ${fm(loss)} = ${fm(Aup + loss)}\\) kg ha⁻¹ h⁻¹.`,
          `\\(\\text{CUE} = ${Aup}/${fm(Aup + loss)} = ${fm(cue)}\\) % — ${N <= 0.3 ? 'high, because the greenhouse is almost closed.' : 'it falls quickly as the vents open, which is why growers lower the set-point when ventilating.'}`)
      };
    }
  },
  {
    id: 'cr-co2-time', title: 'Time to reach the CO₂ set-point', lesson: 'co2-enrichment', difficulty: 3,
    gen(rng) {
      const k = kco2(20);
      let N = 0.5, h = 5, phi = 150, Aup = 30, Cs = 800, Css = 0, tries = 0;
      do {
        N = pick(rng, [0.2, 0.3, 0.5, 0.8, 1]); h = rand(rng, 4, 6, 0.5); phi = randInt(rng, 10, 25) * 10; Aup = randInt(rng, 4, 8) * 5; Cs = randInt(rng, 12, 18) * 50;
        Css = COUT + (phi - Aup) / (10 * k * N * h); tries++;
      } while ((Css < Cs + 60 || Css > 5000) && tries < 60);
      if (Css < Cs + 60 || Css > 5000) { N = 0.5; h = 5; phi = 150; Aup = 30; Cs = 800; Css = COUT + (phi - Aup) / (10 * k * N * h); }
      const tau = 1 / N, t = -tau * Math.log((Css - Cs) / (Css - COUT)) * 60;
      return {
        q: `At sunrise a greenhouse (mean height ${f(h)} m, 20 °C, ${f(N)} air changes per hour) contains ${COUT} ppm CO₂, like the outside air. Dosing starts at ${phi} kg ha⁻¹ h⁻¹ while the crop takes up a constant ${Aup} kg ha⁻¹ h⁻¹. How many minutes does it take to reach the set-point of ${Cs} ppm?`,
        answer: t, tol: 0.03, unit: 'min',
        solution: steps(
          `Mass balance: \\(k\\bar h\\,\\mathrm{d}C/\\mathrm{d}t = \\Phi - A_{\\text{up}} - kN\\bar h\\,(C - C_{\\text{out}})\\) — an exponential approach to \\(C_{ss}\\) with time constant \\(\\tau = 1/N = ${fm(tau)}\\) h.`,
          `Steady state: \\(C_{ss} = ${COUT} + (${phi} - ${Aup})/(10\\times${fm(k, 4)}\\times${fm(N)}\\times${fm(h)}) = ${fm(Css, 4)}\\) ppm.`,
          `\\(t = -\\tau\\ln\\dfrac{C_{ss} - C_s}{C_{ss} - C_0} = -${fm(tau)}\\,\\ln\\dfrac{${fm(Css - Cs, 4)}}{${fm(Css - COUT, 4)}} = ${fm(t / 60)}\\) h \\(= ${fm(t)}\\) min.`)
      };
    }
  },
  {
    id: 'cr-gas-co2', title: 'Natural gas for CO₂ dosing', lesson: 'co2-enrichment', difficulty: 2,
    gen(rng) {
      const dose = randInt(rng, 6, 25) * 10, eta = pick(rng, [0.9, 0.95]);
      const V = dose / GAS_CO2, heat = V * GAS_LHV * eta / 3.6;
      return {
        q: `A grower doses ${dose} kg CO₂ ha⁻¹ h⁻¹ from the cleaned flue gas of a natural-gas boiler (56.1 kg CO₂ per GJ, 31.65 MJ m⁻³). How many cubic metres of gas per hectare per hour must be burned?`,
        answer: V, tol: 0.02, unit: 'm³ ha⁻¹ h⁻¹',
        solution: steps(
          `CO₂ per m³ of gas: \\(56.1\\ \\text{kg GJ}^{-1}\\times0.03165\\ \\text{GJ m}^{-3} = ${fm(GAS_CO2, 4)}\\) kg m⁻³.`,
          `\\(V = ${dose}/${fm(GAS_CO2, 4)} = ${fm(V)}\\) m³ ha⁻¹ h⁻¹.`,
          `The heat comes with it: \\(${fm(V)}\\times31.65\\times${fm(eta)}/3.6 = ${fm(heat)}\\) kW per ha (boiler efficiency ${f(eta * 100)} %) — welcome in winter, a problem in summer unless it is stored in a heat buffer (Lesson 8.3).`)
      };
    }
  },
  {
    id: 'cr-co2-strategy', title: 'CO₂ strategy when the vents open', lesson: 'co2-enrichment', difficulty: 1,
    gen(rng) {
      const N = pick(rng, [2, 4, 6]);
      return mcq(rng,
        `On a sunny spring day the vents of a CO₂-enriched greenhouse open to ${N} air changes per hour. Which dosing strategy makes most sense?`,
        'Lower the set-point towards the outside concentration: the ventilation loss grows with \\(N\\,(C - C_{\\text{out}})\\), while the extra yield per ppm diminishes.',
        ['Raise the set-point, because the crop photosynthesises most on sunny days.',
          'Keep the set-point unchanged; ventilation does not affect CO₂ losses.',
          'Stop dosing and let the crop draw the concentration far below the outside level.'],
        steps('The ventilation loss \\(k N\\bar h\\,(C - C_{\\text{out}})\\) is proportional to both the air exchange and the excess concentration.',
          'The economic optimum set-point therefore falls as \\(N\\) rises (Lesson 8.3); with wide-open vents it approaches the outside level.',
          'Letting the crop deplete the air far below outside levels would cost more yield than the saved CO₂ is worth.'));
    }
  },

  /* ======================= Lesson 8.4 — resource-use efficiency ======================= */
  {
    id: 'cr-water-productivity', title: 'Water productivity and product water use', lesson: 'resource-use-efficiency', difficulty: 1,
    gen(rng) {
      const s = pick(rng, [
        { n: 'An irrigated field', Y: [3, 6, 0.5], p: [60, 250] },
        { n: 'A greenhouse', Y: [30, 80, 1], p: [12, 40] },
        { n: 'A vertical farm', Y: [60, 110, 1], p: [2, 20] }]);
      const Y = rand(rng, s.Y[0], s.Y[1], s.Y[2]), W = Math.max(10, Math.round(Y * rand(rng, s.p[0], s.p[1], 0.5) / 10) * 10);
      const pwu = W / Y, wp = Y / W * 1000, askWP = rng() < 0.5;
      return {
        q: `${s.n} produces ${f(Y)} kg of fresh product per m² per year and uses ${f(W)} L of water per m² per year. What is its ${askWP ? 'water productivity' : 'product water use'}?`,
        answer: askWP ? wp : pwu, tol: 0.02, unit: askWP ? 'g L⁻¹' : 'L kg⁻¹',
        solution: steps(
          `Product water use: \\(\\text{PWU} = W/Y = ${fm(W)}/${fm(Y)} = ${fm(pwu)}\\) L kg⁻¹.`,
          `Water productivity is its inverse: \\(1000/${fm(pwu)} = ${fm(wp)}\\) g L⁻¹ (= kg m⁻³).`,
          'For comparison, lettuce: open field ≈ 65 L kg⁻¹, vertical farms ≈ 7 L kg⁻¹ on average (Pennisi et al., 2025).')
      };
    }
  },
  {
    id: 'cr-kozai-wue', title: 'Water-use efficiency of a closed system', lesson: 'resource-use-efficiency', difficulty: 2,
    gen(rng) {
      const WT = rand(rng, 0.4, 0.9, 0.01), WP = rand(rng, 0.1, 0.2, 0.01), r = randInt(rng, 70, 98) / 100, WD = pick(rng, [0, 0, 0.02, 0.05]);
      const WS = WT + WP + WD, WC = r * WT, wue = (WC + WP) / WS;
      return {
        q: `A plant-factory tier transpires ${f(WT)} L m⁻² d⁻¹, stores ${f(WP)} L m⁻² d⁻¹ in the growing plants and discards ${f(WD)} L m⁻² d⁻¹ of solution. The air-conditioner recovers ${Math.round(r * 100)} % of the transpired water as condensate. Calculate Kozai's water-use efficiency \\((W_C + W_P)/W_S\\).`,
        answer: wue, abstol: 0.01, unit: '',
        solution: steps(
          `Supply: \\(W_S = W_T + W_P + W_D = ${fm(WT)} + ${fm(WP)} + ${fm(WD)} = ${fm(WS)}\\) L m⁻² d⁻¹.`,
          `Condensate: \\(W_C = ${fm(r)}\\times${fm(WT)} = ${fm(WC)}\\) L m⁻² d⁻¹.`,
          `\\(\\text{WUE} = (${fm(WC)} + ${fm(WP)})/${fm(WS)} = ${fm(wue)}\\); the fresh water to buy is \\(W_S - W_C = ${fm(WS - WC)}\\) L m⁻² d⁻¹ (Eq. 8.4.3).`)
      };
    }
  },
  {
    id: 'cr-specific-energy', title: 'Specific energy use', lesson: 'resource-use-efficiency', difficulty: 1,
    gen(rng) {
      const E = randInt(rng, 60, 120) * 10, Y = randInt(rng, 40, 110);
      const e = E / Y, askMJ = rng() < 0.4;
      return {
        q: `A vertical farm uses ${f(E)} kWh of electricity per m² of cultivated area per year and harvests ${Y} kg of lettuce per m² per year. What is its specific energy use in ${askMJ ? 'MJ' : 'kWh'} per kg?`,
        answer: askMJ ? e * 3.6 : e, tol: 0.02, unit: askMJ ? 'MJ kg⁻¹' : 'kWh kg⁻¹',
        solution: steps(
          `\\(e = E/Y = ${fm(E)}/${fm(Y)} = ${fm(e)}\\) kWh kg⁻¹${askMJ ? `, and \\(${fm(e)}\\times3.6 = ${fm(e * 3.6)}\\) MJ kg⁻¹` : ''}.`,
          `Energy-use efficiency: \\(1/e = ${fm(1 / e)}\\) kg kWh⁻¹ (published vertical farms: 0.08–0.13 kg kWh⁻¹; Pennisi et al., 2025).`)
      };
    }
  },
  {
    id: 'cr-dw-fw', title: 'Fresh weight or dry weight?', lesson: 'resource-use-efficiency', difficulty: 2,
    gen(rng) {
      const eDW = pick(rng, [70, 111, 182, 211, 247]), d = pick(rng, [2.6, 3.0, 3.5, 4.0, 4.5, 5.0]);
      const eFW = eDW * d / 100;
      return {
        q: `A model study reports ${eDW} kWh of purchased energy per kg of lettuce <em>dry</em> weight. Express this per kg of fresh lettuce with a dry-matter content of ${f(d)} %.`,
        answer: eFW, tol: 0.02, unit: 'kWh kg⁻¹',
        solution: steps(
          `One kg of fresh lettuce contains \\(${fm(d / 100)}\\) kg of dry matter.`,
          `\\(e_{\\text{FW}} = e_{\\text{DW}}\\times d = ${eDW}\\times${fm(d / 100)} = ${fm(eFW)}\\) kWh per kg fresh weight.`,
          'A lower dry-matter content makes the same system look better per kg of fresh weight — always state the basis (Eq. 8.4.1).')
      };
    }
  },
  {
    id: 'cr-lue', title: 'Light-use efficiency', lesson: 'resource-use-efficiency', difficulty: 2,
    gen(rng) {
      const ppfd = randInt(rng, 15, 40) * 10, hrs = pick(rng, [12, 14, 16, 18, 20]), days = randInt(rng, 20, 40);
      const dli = ppfd * hrs * 3600 / 1e6, DW = Math.max(20, Math.round(rand(rng, 0.35, 1.1, 0.01) * dli * days));
      const mol = dli * days, lue = DW / mol;
      return {
        q: `Lettuce grown for ${days} days at ${ppfd} µmol m⁻² s⁻¹ with a ${hrs}-hour photoperiod accumulated ${DW} g of shoot dry matter per m². What was its light-use efficiency, based on incident light?`,
        answer: lue, tol: 0.02, unit: 'g DW mol⁻¹',
        solution: steps(
          `DLI: \\(${ppfd}\\times${hrs}\\times3600/10^{6} = ${fm(dli)}\\) mol m⁻² d⁻¹.`,
          `Photons over the cycle: \\(${fm(dli)}\\times${days} = ${fm(mol, 4)}\\) mol m⁻².`,
          `\\(\\text{LUE} = ${DW}/${fm(mol, 4)} = ${fm(lue)}\\) g DW mol⁻¹ (vertical-farm average 0.55; Jin et al., 2023).`)
      };
    }
  },
  {
    id: 'cr-energy-chain', title: 'From photons to kWh per kilogram', lesson: 'resource-use-efficiency', difficulty: 3,
    gen(rng) {
      const eta = pick(rng, [2.5, 2.8, 3.0, 3.2, 3.5]), lue = rand(rng, 0.4, 1.1, 0.05), d = pick(rng, [3.5, 4, 4.5, 5]), aux = pick(rng, [0.05, 0.1, 0.15]), cop = pick(rng, [3, 3.5, 4, 5]);
      const lfw = lue / (d / 100), el = 277.78 / (eta * lfw), e = el * (1 + aux) * (1 + 1 / cop);
      return {
        q: `A plant factory uses LEDs with a photon efficacy of ${f(eta)} µmol J⁻¹. Its lettuce has a light-use efficiency of ${f(lue)} g DW mol⁻¹ and ${f(d)} % dry matter. Pumps and fans add ${f(aux * 100)} % to the lighting electricity and the air-conditioning has a cooling COP of ${f(cop)}. Estimate the total electricity per kg of fresh lettuce.`,
        answer: e, tol: 0.02, unit: 'kWh kg⁻¹',
        solution: steps(
          `Fresh-weight LUE: \\(${fm(lue)}/${fm(d / 100)} = ${fm(lfw)}\\) g FW mol⁻¹.`,
          `Lighting: \\(e_{\\text{light}} = 277.8/(\\eta_{\\text{ph}}\\,\\text{LUE}_{\\text{FW}}) = 277.8/(${fm(eta)}\\times${fm(lfw)}) = ${fm(el)}\\) kWh kg⁻¹.`,
          `Total: \\(${fm(el)}\\times${fm(1 + aux)}\\times(1 + 1/${fm(cop)}) = ${fm(e)}\\) kWh kg⁻¹ of fresh lettuce (Eq. 8.4.6).`)
      };
    }
  },
  {
    id: 'cr-land', title: 'Land productivity of a multi-tier farm', lesson: 'resource-use-efficiency', difficulty: 2,
    gen(rng) {
      const yc = randInt(rng, 40, 110), lui = rand(rng, 2, 6, 0.1), withPV = rng() < 0.4, yf = yc * lui;
      if (!withPV) {
        return {
          q: `A vertical farm harvests ${yc} kg of lettuce per m² of cultivated area per year and has a land-use index of ${f(lui)} m² of cultivated area per m² of floor. What is its yield per m² of floor?`,
          answer: yf, tol: 0.02, unit: 'kg m⁻² yr⁻¹',
          solution: steps(
            `\\(Y_{\\text{floor}} = Y_{\\text{cult}}\\times\\text{LUI} = ${yc}\\times${fm(lui)} = ${fm(yf)}\\) kg m⁻² yr⁻¹.`,
            'Irrigated field lettuce yields about 4 kg m⁻² yr⁻¹ (Barbosa et al., 2015) — but the electricity of the farm needs land somewhere too (Eq. 8.4.7).')
        };
      }
      const eA = randInt(rng, 60, 110) * 10, pv = pick(rng, [40, 50, 60, 80, 100]);
      const extra = eA * lui / pv, yl = yf / (1 + extra);
      return {
        q: `A vertical farm harvests ${yc} kg of lettuce per m² of cultivated area per year, has a land-use index of ${f(lui)} and uses ${f(eA)} kWh per m² of cultivated area per year. If all of its electricity came from a solar park producing ${pv} kWh per m² of land per year, what would the yield be per m² of total land (floor plus solar park)?`,
        answer: yl, tol: 0.02, unit: 'kg m⁻² yr⁻¹',
        solution: steps(
          `Per m² of floor: yield \\(${yc}\\times${fm(lui)} = ${fm(yf)}\\) kg and electricity \\(${fm(eA)}\\times${fm(lui)} = ${fm(eA * lui)}\\) kWh per year.`,
          `Solar land per m² of floor: \\(${fm(eA * lui)}/${pv} = ${fm(extra)}\\) m².`,
          `\\(Y_{\\text{land}} = ${fm(yf)}/(1 + ${fm(extra)}) = ${fm(yl)}\\) kg m⁻² yr⁻¹ — compare with ≈ 4 kg m⁻² yr⁻¹ for irrigated field lettuce (Eq. 8.4.7).`)
      };
    }
  },
  {
    id: 'cr-carbon-footprint', title: 'Carbon footprint on different grids', lesson: 'resource-use-efficiency', difficulty: 1,
    gen(rng) {
      const g = pick(rng, [{ n: 'Sweden', ef: 35 }, { n: 'the EU', ef: 210 }, { n: 'the Netherlands', ef: 254 }, { n: 'Poland', ef: 589 }]);
      const e = rand(rng, 6, 16, 0.5), g0 = pick(rng, [0.15, 0.2, 0.25, 0.3]);
      const el = e * g.ef / 1000, G = el + g0;
      return {
        q: `A vertical farm uses ${f(e)} kWh of electricity per kg of lettuce; all other life-cycle emissions add ${f(g0)} kg CO₂e kg⁻¹. Calculate its carbon footprint with the 2025 electricity mix of ${g.n} (${g.ef} g CO₂e kWh⁻¹).`,
        answer: G, tol: 0.02, unit: 'kg CO₂e kg⁻¹',
        solution: steps(
          `Electricity: \\(${fm(e)}\\ \\text{kWh kg}^{-1}\\times${fm(g.ef / 1000)}\\ \\text{kg kWh}^{-1} = ${fm(el)}\\) kg CO₂e kg⁻¹.`,
          `\\(G = ${fm(el)} + ${fm(g0)} = ${fm(G)}\\) kg CO₂e kg⁻¹ (Eq. 8.4.9).`,
          'For comparison, the review average for open-field lettuce is 0.18 kg CO₂e kg⁻¹ (Pennisi et al., 2025).')
      };
    }
  },
  {
    id: 'cr-nue', title: 'Nitrogen recovery with and without drain', lesson: 'resource-use-efficiency', difficulty: 2,
    gen(rng) {
      const Wup = randInt(rng, 30, 60), Y = +(Wup / rand(rng, 8, 12, 0.5)).toFixed(1), c = randInt(rng, 14, 22) * 10;
      const fd = pick(rng, [0.05, 0.1, 0.2, 0.3, 0.4]), u = rand(rng, 0.8, 1, 0.05);
      const nc = +(Wup * c / 1000 * u / Y).toFixed(2);
      const Ws = Wup / (1 - fd), Ns = Ws * c / 1000, Nc = Y * nc, re = 100 * Nc / Ns;
      return {
        q: `A lettuce crop yields ${f(Y)} kg FW m⁻² containing ${f(nc)} g N per kg and takes up ${Wup} L of water per m². The nutrient solution contains ${c} mg N L⁻¹, and ${f(fd * 100)} % of the solution supplied drains to waste. What percentage of the nitrogen supplied ends up in the harvested crop?`,
        answer: re, tol: 0.02, unit: '%',
        solution: steps(
          `Solution supplied: \\(${Wup}/(1 - ${fm(fd)}) = ${fm(Ws)}\\) L m⁻²; nitrogen supplied \\(${fm(Ws)}\\times${fm(c / 1000)} = ${fm(Ns)}\\) g N m⁻².`,
          `Nitrogen in the crop: \\(${fm(Y)}\\times${fm(nc)} = ${fm(Nc)}\\) g N m⁻².`,
          `Recovery \\(= ${fm(Nc)}/${fm(Ns)} = ${fm(re)}\\) %; partial factor productivity \\(= ${fm(Y)}/${fm(Ns / 1000)} = ${fm(Y / (Ns / 1000))}\\) kg per kg N (Eq. 8.4.8). Reusing the drain would raise both.`)
      };
    }
  },
  {
    id: 'cr-functional-unit', title: 'Water footprint per nutrient', lesson: 'resource-use-efficiency', difficulty: 2,
    gen(rng) {
      const c = pick(rng, [
        { n: 'lettuce', wf: 237, kcal: 16, prot: 0.9 }, { n: 'tomatoes', wf: 214, kcal: 18, prot: 0.8 },
        { n: 'potatoes', wf: 287, kcal: 79, prot: 1.7 }, { n: 'dry peas', wf: 1979, kcal: 317, prot: 21.5 },
        { n: 'dry beans', wf: 5053, kcal: 326, prot: 19.9 }]);
      const perKcal = rng() < 0.5, per = perKcal ? c.kcal * 10 : c.prot * 10;
      const v = perKcal ? c.wf / per * 1000 : c.wf / per * 100;
      return {
        q: `The global average water footprint of ${c.n} is ${f(c.wf)} L kg⁻¹ (Mekonnen &amp; Hoekstra, 2011); they contain ${f(c.kcal)} kcal and ${f(c.prot)} g protein per 100 g. What is their water footprint per ${perKcal ? '1000 kcal' : '100 g of protein'}?`,
        answer: v, tol: 0.02, unit: perKcal ? 'L per 1000 kcal' : 'L per 100 g protein',
        solution: steps(
          `Content per kg: \\(${fm(perKcal ? c.kcal : c.prot)}\\times10 = ${fm(per)}\\) ${perKcal ? 'kcal' : 'g protein'} kg⁻¹.`,
          `Per functional unit (Eq. 8.4.1): \\(${fm(c.wf)}/${fm(per)}\\times${perKcal ? 1000 : 100} = ${fm(v)}\\) L.`,
          'Per kilogram lettuce (237 L) beats potatoes (287 L); per 1000 kcal potatoes need about a quarter of the water of lettuce.')
      };
    }
  },
  {
    id: 'cr-uncertainty', title: 'Uncertainty of an indicator', lesson: 'resource-use-efficiency', difficulty: 2,
    gen(rng) {
      const uE = pick(rng, [1, 2, 3, 5]), uY = pick(rng, [0.5, 1, 2]), ud = pick(rng, [3, 5, 8, 10, 15]);
      const dw = rng() < 0.5, u = dw ? Math.hypot(uE, uY, ud) : Math.hypot(uE, uY);
      return {
        q: `A student measures electricity with a relative standard uncertainty of ${f(uE)} %, the harvest fresh weight with ${f(uY)} % and the dry-matter content with ${f(ud)} %. What is the relative standard uncertainty of the energy use per kg of ${dw ? 'dry' : 'fresh'} weight, assuming independent errors?`,
        answer: u, tol: 0.02, unit: '%',
        solution: steps(
          `\\(I = ${dw ? 'E/(Y\\,d)' : 'E/Y'}\\): every input enters with exponent ±1, so every elasticity is ±1 (Eq. 8.4.10).`,
          `\\(u_I/I = \\sqrt{${dw ? `${fm(uE)}^2 + ${fm(uY)}^2 + ${fm(ud)}^2` : `${fm(uE)}^2 + ${fm(uY)}^2`}} = ${fm(u)}\\) %.`,
          dw ? 'The dry-matter content dominates: improve that measurement first (larger samples, drying to constant weight).' : 'The dry-matter content does not enter a fresh-weight indicator at all.')
      };
    }
  },
  {
    id: 'cr-indicator-type', title: 'Productivity, intensity or efficiency ratio?', lesson: 'resource-use-efficiency', difficulty: 1,
    gen(rng) {
      const P = 'a productivity (product per unit of input)', I = 'an intensity (input or burden per unit of product)', E = 'an efficiency ratio (dimensionless, at most 1)';
      const it = pick(rng, [
        { t: 'water recovered or held in the plants ÷ water supplied', k: E },
        { t: 'litres of water per kg of tomatoes', k: I },
        { t: 'kg of lettuce per kWh of electricity', k: P },
        { t: 'kg of CO₂ fixed by the crop ÷ kg of CO₂ supplied', k: E },
        { t: 'kg CO₂e per kg of lettuce', k: I },
        { t: 'grams of dry matter per mole of photons', k: P }]);
      const all = [P, I, E, 'an elasticity (relative change per relative change)'];
      return mcq(rng, `Which kind of indicator is "${it.t}"?`, it.k, all.filter(x => x !== it.k),
        steps('Productivity = product ÷ input; intensity = input (or emission) ÷ product; efficiency ratio = the part of a resource that is fixed or retained ÷ the same resource supplied (Eq. 8.4.1).',
          `"${it.t}" is therefore ${it.k}.`));
    }
  }
];
