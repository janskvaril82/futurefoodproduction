/* ==========================================================================
   Practice generators — Module 7: Aeroponics, vertical farms and closed ecosystems
   Lessons: aeroponics (7.1), vertical-farming (7.2), space-farming (7.3)
   Every generator returns a fresh, randomised, auto-marked problem.
   Constants follow the lessons: air viscosity 1.81e-5 Pa s at 20 °C,
   water density 998 kg m⁻³ (7.1); photon decomposition e = 277.8/(η f PUE)
   (7.2); NASA BVAD crew values O₂ 0.816, CO₂ 1.04 kg CM⁻¹ d⁻¹ (7.3).
   ========================================================================== */
import { rand, randInt, pick, f, steps, mcq } from './helpers.js';

/** LaTeX-safe number for use inside \( … \): scientific notation as m\times10^{e}, thin-space thousands. */
const tex = (v, sig = 3) => {
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) { const e = Math.floor(Math.log10(a)); return `${(v / 10 ** e).toPrecision(sig)}\\times10^{${e}}`; }
  const s = String(+v.toPrecision(sig)); const [i, d] = s.split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, '\\,') + (d ? '.' + d : '');
};

const CROPS = [
  { name: 'wheat', o2: 56.0, co2: 77.0 },
  { name: 'white potato', o2: 32.2, co2: 45.2 },
  { name: 'sweet potato', o2: 41.1, co2: 56.5 },
  { name: 'soybean', o2: 13.9, co2: 19.1 },
  { name: 'rice', o2: 36.6, co2: 50.3 }
];

export default [
  /* ======================= 7.1 aeroponics ======================= */
  {
    id: 'aero-stokes-velocity', title: 'Stokes settling velocity of a mist droplet', lesson: 'aeroponics', difficulty: 1,
    gen(rng) {
      const d = rand(rng, 5, 60, 1), H = rand(rng, 0.2, 1.0, 0.05);
      const v = 998 * 9.81 * (d * 1e-6) ** 2 / (18 * 1.81e-5);
      const Re = 1.2 * v * d * 1e-6 / 1.81e-5;
      return {
        q: `A droplet of nutrient solution with a diameter of ${d} µm falls through still air at 20 °C (ρ<sub>p</sub> = 998 kg m⁻³, μ = 1.81 × 10⁻⁵ Pa s). Using Stokes' law, what is its terminal settling velocity in mm s⁻¹?`,
        answer: v * 1000, tol: 0.03, unit: 'mm s⁻¹',
        solution: steps(
          `Stokes' law (Eq. 7.1.3), neglecting buoyancy: \\(v_t = \\rho_p g d^2/(18\\mu)\\).`,
          `\\(v_t = 998\\times9.81\\times(${d}\\times10^{-6})^2/(18\\times1.81\\times10^{-5}) = ${tex(v, 3)}\\) m s⁻¹ = ${f(v * 1000, 3)} mm s⁻¹.`,
          `Check validity: \\(\\text{Re} = \\rho_a v_t d/\\mu = 1.2\\times${tex(v, 3)}\\times${d}\\times10^{-6}/1.81\\times10^{-5} = ${tex(Re, 2)}\\) ${Re < 1 ? '&lt; 1, so Stokes\' law holds' : '&gt; 1, so Stokes\' law slightly overestimates the speed'}.`,
          `It would take about ${f(H / v, 2)} s to fall ${H} m in still air.`)
      };
    }
  },
  {
    id: 'aero-sauter-mean', title: 'Number mean versus Sauter mean diameter', lesson: 'aeroponics', difficulty: 2,
    gen(rng) {
      const d1 = rand(rng, 4, 12, 1), d2 = rand(rng, 20, 40, 1), d3 = rand(rng, 50, 90, 1);
      const n1 = randInt(rng, 300, 800), n2 = randInt(rng, 100, 300), n3 = randInt(rng, 10, 80);
      const s2 = n1 * d1 ** 2 + n2 * d2 ** 2 + n3 * d3 ** 2, s3 = n1 * d1 ** 3 + n2 * d2 ** 3 + n3 * d3 ** 3;
      const D32 = s3 / s2, D10 = (n1 * d1 + n2 * d2 + n3 * d3) / (n1 + n2 + n3);
      return {
        q: `A misting nozzle produces ${n1} droplets of ${d1} µm, ${n2} droplets of ${d2} µm and ${n3} droplets of ${d3} µm (in a sample). Calculate the Sauter mean diameter D<sub>32</sub>.`,
        answer: D32, tol: 0.02, unit: 'µm',
        solution: steps(
          `\\(D_{32} = \\sum n d^3/\\sum n d^2\\) (Eq. 7.1.1).`,
          `\\(\\sum nd^3 = ${n1}\\cdot${d1}^3 + ${n2}\\cdot${d2}^3 + ${n3}\\cdot${d3}^3 = ${tex(s3, 4)}\\) µm³.`,
          `\\(\\sum nd^2 = ${n1}\\cdot${d1}^2 + ${n2}\\cdot${d2}^2 + ${n3}\\cdot${d3}^2 = ${tex(s2, 4)}\\) µm².`,
          `\\(D_{32} = ${tex(s3, 4)}/${tex(s2, 4)} = ${tex(D32, 3)}\\) µm — far above the number mean \\(D_{10} = ${tex(D10, 3)}\\) µm, because the few large droplets carry most of the liquid.`)
      };
    }
  },
  {
    id: 'aero-misting-cycle', title: 'Maximum pause and minimum duty cycle of a misting timer', lesson: 'aeroponics', difficulty: 2,
    gen(rng) {
      const U = rand(rng, 40, 200, 5), Ar = rand(rng, 0.04, 0.15, 0.01), hf = rand(rng, 15, 40, 1), phi = pick(rng, [0.4, 0.5, 0.6]);
      const q = rand(rng, 0.4, 1.2, 0.05), eta = pick(rng, [0.2, 0.25, 0.3, 0.4]);
      const Vf = Ar * hf * 1e-6 * 1e6;                 // mL
      const Us = U / 86400;                             // mL s⁻¹
      const toff = phi * Vf / Us / 60;                  // min
      const Dmin = Us / (eta * q) * 100;                // %
      const ask = pick(rng, ['pause', 'duty']);
      return {
        q: `An aeroponic lettuce plant takes up ${U} g of water per day. Its roots (wetted area ${Ar} m²) hold a water film ${hf} µm thick, and you allow ${Math.round(phi * 100)} % of the film to be used between pulses. The chamber is saturated (no root-surface evaporation). The nozzle sprays ${q} mL s⁻¹ towards this plant, of which ${Math.round(eta * 100)} % lands on its roots. ${ask === 'pause' ? 'What is the longest allowable pause between spray pulses (minutes)?' : 'What is the minimum duty cycle (per cent of time spraying) that keeps the film from shrinking?'}`,
        answer: ask === 'pause' ? toff : Dmin, tol: 0.03, unit: ask === 'pause' ? 'min' : '%',
        solution: steps(
          `Film volume \\(V_f = A_r h_f = ${Ar}\\times${hf}\\times10^{-6}\\) m³ = ${f(Vf, 3)} mL; uptake \\(U = ${U}/86\\,400 = ${tex(Us, 3)}\\) mL s⁻¹.`,
          `Maximum pause (Eq. 7.1.7): \\(t_{\\text{off,max}} = \\varphi V_f/U = ${phi}\\times${tex(Vf, 3)}/${tex(Us, 3)} = ${tex(toff * 60, 3)}\\) s = ${f(toff, 3)} min.`,
          `Minimum duty cycle: \\(D_{\\min} = U/(\\eta q) = ${tex(Us, 3)}/(${eta}\\times${q}) = ${tex(Dmin / 100, 3)}\\) = ${f(Dmin, 3)} %.`,
          `A practical timer uses a pause well below \\(t_{\\text{off,max}}\\) and a duty cycle well above \\(D_{\\min}\\) as a safety margin.`)
      };
    }
  },
  {
    id: 'aero-evaporation-rh', title: 'How humidity changes the life of a droplet', lesson: 'aeroponics', difficulty: 1,
    gen(rng) {
      const t1 = rand(rng, 0.3, 3, 0.1), rh1 = pick(rng, [85, 90, 92, 95]), rh2 = pick(rng, [97, 98, 99, 99.5]);
      const t2 = t1 * (1 - rh1 / 100) / (1 - rh2 / 100);
      return {
        q: `A mist droplet evaporates completely in ${t1} s when the root chamber is at ${rh1} % relative humidity. Using the d²-law, how long would the same droplet last at ${rh2} % RH (same temperature)?`,
        answer: t2, tol: 0.02, unit: 's',
        solution: steps(
          `The evaporation time (Eq. 7.1.5) is inversely proportional to \\(1-\\text{RH}\\): \\(t_{\\text{evap}}\\propto 1/(1-\\text{RH})\\).`,
          `\\(t_2 = t_1\\,(1-\\text{RH}_1)/(1-\\text{RH}_2) = ${t1}\\times${tex(1 - rh1 / 100, 3)}/${tex(1 - rh2 / 100, 3)} = ${tex(t2, 3)}\\) s.`,
          `A nearly saturated chamber lets fine droplets survive long enough to reach the roots.`)
      };
    }
  },
  {
    id: 'aero-accumulator', title: 'Usable volume of a pressure accumulator', lesson: 'aeroponics', difficulty: 2,
    gen(rng) {
      const V0 = pick(rng, [4, 8, 12, 20, 24]), p0 = rand(rng, 4.5, 6.0, 0.5), pmin = p0 + rand(rng, 0.5, 1.0, 0.5), pmax = pmin + rand(rng, 1.5, 3.0, 0.5);
      const nNoz = randInt(rng, 10, 50), Qn = rand(rng, 4, 12, 0.5), ton = randInt(rng, 3, 10);
      const Vuse = V0 * p0 * (1 / pmin - 1 / pmax);
      const Vpulse = nNoz * Qn / 3600 * ton;
      return {
        q: `An aeroponic module has a ${V0} L accumulator pre-charged to ${p0} bar(a), working between ${pmin} and ${pmax} bar(a). During a power cut it must feed ${nNoz} nozzles of ${Qn} L h⁻¹ each, in pulses of ${ton} s. How many full pulses can it deliver (isothermal gas)? Give the number of pulses as a decimal (e.g. 3.4).`,
        answer: Vuse / Vpulse, tol: 0.03, unit: 'pulses',
        solution: steps(
          `Usable volume (Eq. 7.1.10): \\(V_{\\text{use}} = V_0p_0(1/p_{\\min}-1/p_{\\max}) = ${V0}\\times${p0}\\times(1/${pmin}-1/${pmax}) = ${tex(Vuse, 3)}\\) L.`,
          `Volume per pulse: \\(${nNoz}\\times${Qn}/3600\\times${ton} = ${tex(Vpulse, 3)}\\) L.`,
          `Pulses: \\(${tex(Vuse, 3)}/${tex(Vpulse, 3)} = ${tex(Vuse / Vpulse, 3)}\\) → ${Math.floor(Vuse / Vpulse)} full pulses at full atomisation pressure.`)
      };
    }
  },

  /* ======================= 7.2 vertical farming ======================= */
  {
    id: 'vf-space-use', title: 'Cultivation-area ratio of a vertical farm', lesson: 'vertical-farming', difficulty: 1,
    gen(rng) {
      const A = rand(rng, 500, 5000, 100), fg = rand(rng, 0.45, 0.8, 0.05), fr = rand(rng, 0.4, 0.8, 0.05), N = randInt(rng, 5, 16);
      const car = fg * fr * N;
      return {
        q: `A ${A} m² building is converted into a vertical farm. Grow rooms take ${Math.round(fg * 100)} % of the floor; racks cover ${Math.round(fr * 100)} % of the grow-room floor and carry ${N} tiers. What is the cultivation-area ratio (m² of trays per m² of building floor)?`,
        answer: car, tol: 0.02, unit: 'm² m⁻²',
        solution: steps(
          `Eq. 7.2.1: \\(\\text{CAR} = f_{\\text{grow}}f_{\\text{rack}}N_t = ${fg}\\times${fr}\\times${N} = ${tex(car, 3)}\\).`,
          `Total tray area: \\(${tex(car, 3)}\\times${A} = ${tex(car * A, 3)}\\) m².`,
          `Note that the grow room alone has CAR = \\(${fr}\\times${N} = ${tex(fr * N, 3)}\\): aisles and support rooms dilute the stacking.`)
      };
    }
  },
  {
    id: 'vf-yield-floor', title: 'Annual yield per square metre of floor', lesson: 'vertical-farming', difficulty: 2,
    gen(rng) {
      const car = rand(rng, 2, 6, 0.1), rho = randInt(rng, 20, 45), m = rand(rng, 80, 200, 10), tc = randInt(rng, 14, 30), tt = randInt(rng, 1, 2), loss = pick(rng, [0.03, 0.05, 0.08]);
      const cyc = 365 / (tc + tt), yc = rho * m / 1000 * cyc * (1 - loss), yf = car * yc;
      return {
        q: `A lettuce factory has a cultivation-area ratio of ${car}. In the final growth stage there are ${rho} plants m⁻² of tray, harvested after ${tc} days at ${m} g each; turnaround takes ${tt} d and ${Math.round(loss * 100)} % of plants are lost. What is the annual yield per m² of building floor?`,
        answer: yf, tol: 0.02, unit: 'kg m⁻² yr⁻¹',
        solution: steps(
          `Cycles per year: \\(365/(${tc}+${tt}) = ${tex(cyc, 3)}\\).`,
          `Yield per m² of tray (Eq. 7.2.2): \\(${rho}\\times${m / 1000}\\times${tex(cyc, 3)}\\times${1 - loss} = ${tex(yc, 3)}\\) kg m⁻² yr⁻¹.`,
          `Per m² of floor: \\(${car}\\times${tex(yc, 3)} = ${tex(yf, 3)}\\) kg m⁻² yr⁻¹.`)
      };
    }
  },
  {
    id: 'vf-kwh-per-kg', title: 'Lighting electricity per kilogram: the photon decomposition', lesson: 'vertical-farming', difficulty: 2,
    gen(rng) {
      const eta = rand(rng, 2.0, 3.6, 0.1), fc = rand(rng, 0.65, 0.95, 0.05), lue = rand(rng, 0.35, 1.2, 0.05), dm = rand(rng, 4, 6.5, 0.5);
      const pue = lue / (dm / 100), e = 1000 / (3.6 * eta * fc * pue);
      return {
        q: `LED fixtures emit ${eta} µmol J⁻¹; ${Math.round(fc * 100)} % of the photons reach the crop. The lettuce (${dm} % dry matter) produces ${lue} g of dry weight per mol of incident photons. How much lighting electricity is needed per kilogram of fresh lettuce?`,
        answer: e, tol: 0.02, unit: 'kWh kg⁻¹',
        solution: steps(
          `Fresh-weight photon-use efficiency: \\(\\text{PUE} = \\text{LUE}_{\\text{DW}}/x_{\\text{DM}} = ${lue}/${dm / 100} = ${tex(pue, 3)}\\) g mol⁻¹.`,
          `Eq. 7.2.3: \\(e_{\\text{light}} = 277.8/(\\eta_{\\text{ph}}f_{\\text{cap}}\\text{PUE}) = 277.8/(${eta}\\times${fc}\\times${tex(pue, 3)}) = ${tex(e, 3)}\\) kWh kg⁻¹.`,
          `Where 277.8 comes from: \\(10^{6}\\ \\mu\\text{mol mol}^{-1}\\times10^{3}\\ \\text{g kg}^{-1}/(3.6\\times10^{6}\\ \\text{J kWh}^{-1})\\).`)
      };
    }
  },
  {
    id: 'vf-photon-use-efficiency', title: 'Photon-use efficiency from a growth trial', lesson: 'vertical-farming', difficulty: 2,
    gen(rng) {
      const ppfd = rand(rng, 180, 320, 10), h = pick(rng, [14, 16, 18, 20]), days = randInt(rng, 18, 32), y = rand(rng, 2.5, 6.0, 0.1), dm = rand(rng, 4, 6, 0.5);
      const dli = ppfd * h * 3600 / 1e6, mol = dli * days, pue = y * 1000 / mol, lue = pue * dm / 100;
      return {
        q: `In a vertical-farm trial, lettuce received a canopy PPFD of ${ppfd} µmol m⁻² s⁻¹ for ${h} h per day during ${days} days and yielded ${y} kg of fresh shoots per m² (${dm} % dry matter). What was the light-use efficiency on a dry-weight basis (g DW per mol of incident photons)?`,
        answer: lue, tol: 0.02, unit: 'g mol⁻¹',
        solution: steps(
          `DLI \\(= ${ppfd}\\times${h}\\times3600/10^{6} = ${tex(dli, 3)}\\) mol m⁻² d⁻¹; photons over the cycle: \\(${tex(dli, 3)}\\times${days} = ${tex(mol, 3)}\\) mol m⁻².`,
          `Fresh-weight PUE: \\(${y * 1000}\\ \\text{g}/${tex(mol, 3)}\\ \\text{mol} = ${tex(pue, 3)}\\) g FW mol⁻¹.`,
          `Dry-weight LUE: \\(${tex(pue, 3)}\\times${dm / 100} = ${tex(lue, 3)}\\) g DW mol⁻¹ — compare the vertical-farm average of 0.55 and the best measured 1.63 g mol⁻¹ (Jin et al., 2023).`)
      };
    }
  },
  {
    id: 'vf-hvac-cop', title: 'HVAC electricity from the heat load and the COP', lesson: 'vertical-farming', difficulty: 2,
    gen(rng) {
      const A = rand(rng, 200, 3000, 50), Pl = rand(rng, 80, 180, 5), aux = pick(rng, [0.05, 0.08, 0.10, 0.12, 0.15]), cop = rand(rng, 2.5, 7, 0.5);
      const Q = A * Pl * (1 + aux) / 1000, Ph = Q / cop;
      return {
        q: `A grow room with ${A} m² of trays has lamps drawing ${Pl} W per m² of tray during the photoperiod; pumps and fans add ${Math.round(aux * 100)} %. Neglecting the energy stored in the crop and heat flow through the insulated envelope, what electrical power does the cooling system need if its COP is ${cop}?`,
        answer: Ph, tol: 0.02, unit: 'kW',
        solution: steps(
          `All electricity becomes heat inside the room: \\(Q = ${A}\\times${Pl}\\times(1+${aux}) = ${tex(Q * 1000, 4)}\\) W = ${f(Q, 3)} kW.`,
          `HVAC electricity: \\(P_{\\text{HVAC}} = Q/\\text{COP} = ${tex(Q, 3)}/${cop} = ${tex(Ph, 3)}\\) kW.`,
          `The heat rejected outdoors is \\(Q + P_{\\text{HVAC}} = ${tex(Q + Ph, 3)}\\) kW — heat that a district-heating network could use.`)
      };
    }
  },
  {
    id: 'vf-condensate-latent', title: 'Condensate recovered and latent load of a sealed grow room', lesson: 'vertical-farming', difficulty: 2,
    gen(rng) {
      const A = rand(rng, 200, 2500, 50), et = rand(rng, 1.0, 3.0, 0.1), h = pick(rng, [14, 16, 18, 20]);
      const cond = A * et, Q = cond * 2.45e6 / (h * 3600) / 1000;
      const ask = pick(rng, ['latent', 'water']);
      return {
        q: `Lettuce on ${A} m² of trays transpires ${et} L m⁻² d⁻¹, all during a ${h} h photoperiod, in a sealed plant factory. ${ask === 'latent' ? 'What latent heat load (kW) must the cooling coil remove during the photoperiod? (λ = 2.45 MJ kg⁻¹)' : 'How many litres of condensate does the cooling coil collect per day?'}`,
        answer: ask === 'latent' ? Q : cond, tol: 0.02, unit: ask === 'latent' ? 'kW' : 'L d⁻¹',
        solution: steps(
          `Sealed room (air exchange ≈ 0): condensate ≈ transpiration = \\(${A}\\times${et} = ${tex(cond, 4)}\\) L d⁻¹ (Eq. 7.2.6).`,
          `Latent load: \\(${tex(cond, 4)}\\ \\text{kg}\\times2.45\\times10^{6}\\ \\text{J kg}^{-1}/(${h}\\times3600\\ \\text{s}) = ${tex(Q, 3)}\\) kW.`,
          `The condensate is practically distilled water and is returned to the nutrient tanks.`)
      };
    }
  },
  {
    id: 'vf-co2-cue', title: 'CO₂ supply and CO₂-use efficiency', lesson: 'vertical-farming', difficulty: 3,
    gen(rng) {
      const V = rand(rng, 500, 5000, 50), N = pick(rng, [0.01, 0.02, 0.05, 0.1, 0.2]), cin = rand(rng, 800, 1500, 50), up = rand(rng, 3, 40, 0.5);
      const exc = (cin - 420) * 1e-6 * 101325 / (8.314 * 295.15) * 44.01;    // g m⁻³
      const leak = N * V * exc * 24 / 1000, cue = up / (up + leak);
      return {
        q: `A plant-factory room has ${V} m³ of air kept at ${cin} µmol mol⁻¹ CO₂ (outside 420 µmol mol⁻¹, 22 °C, 101.3 kPa) and an air-exchange rate of ${N} h⁻¹. The crop fixes ${up} kg CO₂ per day. What is the CO₂-use efficiency?`,
        answer: cue, tol: 0.015, unit: '',
        solution: steps(
          `Molar density of air: \\(p/(RT) = 101\\,325/(8.314\\times295.15) = 41.3\\) mol m⁻³; excess CO₂: \\((${cin}-420)\\times10^{-6}\\times41.3\\times44.01 = ${tex(exc, 3)}\\) g m⁻³.`,
          `Leakage (Eq. 7.2.8): \\(${N}\\times${V}\\times${tex(exc, 3)}\\times24 = ${tex(leak * 1000, 4)}\\) g d⁻¹ = ${f(leak, 3)} kg d⁻¹.`,
          `CUE \\(= ${up}/(${up}+${tex(leak, 3)}) = ${tex(cue, 3)}\\). Kozai (2013) reports 0.87–0.89 for airtight PFALs.`)
      };
    }
  },
  {
    id: 'vf-cost-per-kg', title: 'Levelised cost of a kilogram of vertical-farm lettuce', lesson: 'vertical-farming', difficulty: 3,
    gen(rng) {
      const I = rand(rng, 1000, 4000, 100), r = pick(rng, [0.05, 0.06, 0.08, 0.10, 0.12]), n = pick(rng, [10, 12, 15, 20]), Y = rand(rng, 40, 110, 1);
      const e = rand(rng, 6, 20, 0.5), pe = rand(rng, 0.05, 0.30, 0.01), lab = rand(rng, 1.0, 3.5, 0.1), cons = rand(rng, 0.8, 2.0, 0.1);
      const crf = r * (1 + r) ** n / ((1 + r) ** n - 1), cap = I * crf / Y, c = cap + e * pe + lab + cons;
      return {
        q: `A vertical farm cost €${I} per m² of tray and is financed at ${Math.round(r * 100)} % over ${n} years. Trays yield ${Y} kg m⁻² yr⁻¹. Electricity use is ${e} kWh kg⁻¹ at €${pe.toFixed(2)} kWh⁻¹, labour costs €${lab.toFixed(1)} kg⁻¹ and consumables and packaging €${cons.toFixed(1)} kg⁻¹. What is the production cost per kilogram?`,
        answer: c, tol: 0.02, unit: '€ kg⁻¹',
        solution: steps(
          `Capital recovery factor: \\(\\text{CRF} = r(1+r)^n/((1+r)^n-1) = ${tex(crf, 4)}\\).`,
          `Capital per kg: \\(${I}\\times${tex(crf, 4)}/${Y} = ${tex(cap, 3)}\\) € kg⁻¹.`,
          `Electricity: \\(${e}\\times${pe.toFixed(2)} = ${tex(e * pe, 3)}\\) € kg⁻¹.`,
          `Total (Eq. 7.2.9): \\(${tex(cap, 3)} + ${tex(e * pe, 3)} + ${lab.toFixed(1)} + ${cons.toFixed(1)} = ${tex(c, 3)}\\) € kg⁻¹; capital is ${f(100 * cap / c, 2)} % of it.`)
      };
    }
  },
  {
    id: 'vf-dli-cancels', title: 'What changes the kWh per kilogram?', lesson: 'vertical-farming', difficulty: 1,
    gen(rng) {
      const cases = [
        { q: 'A grower doubles the DLI; photon efficacy, photon capture and photon-use efficiency stay the same. The lighting electricity per kg of lettuce…', c: 'stays the same — DLI cancels in Eq. 7.2.3', w: ['doubles', 'halves', 'rises fourfold'] },
        { q: 'A grower replaces fixtures of 2.5 µmol J⁻¹ with fixtures of 3.5 µmol J⁻¹; everything else stays the same. The lighting electricity per kg…', c: 'falls to 2.5/3.5 ≈ 71 % of its former value', w: ['stays the same, because the DLI is unchanged', 'rises by 40 %', 'falls by 40 %'] },
        { q: 'Re-spacing plants so that the canopy closes earlier raises photon capture from 0.7 to 0.9. The lighting electricity per kg…', c: 'falls to 0.7/0.9 ≈ 78 % of its former value', w: ['rises, because more photons hit leaves', 'is unchanged, because the lamps draw the same power', 'falls to 0.7 × 0.9 = 63 %'] },
        { q: 'The cooling COP rises from 3 to 6 while lighting stays the same. The HVAC electricity per kg…', c: 'halves', w: ['doubles', 'is unchanged, because the heat load is unchanged', 'falls by a factor of four'] }
      ];
      const k = pick(rng, cases);
      return mcq(rng, k.q, k.c, k.w, steps(
        `Lighting electricity per kg: \\(e_{\\text{light}} = 277.8/(\\eta_{\\text{ph}}f_{\\text{cap}}\\text{PUE})\\) — only the three efficiencies appear.`,
        `HVAC electricity: heat load ÷ COP (Eq. 7.2.5), so it is inversely proportional to the COP.`,
        `Correct answer: ${k.c}.`));
    }
  },
  {
    id: 'vf-pv-land', title: 'Solar-panel land needed to light a vertical farm', lesson: 'vertical-farming', difficulty: 3,
    gen(rng) {
      const N = randInt(rng, 4, 14), ppfd = rand(rng, 180, 300, 10), h = pick(rng, [14, 16, 18]), eta = rand(rng, 2.5, 3.8, 0.1), H = rand(rng, 3000, 7000, 100), epv = pick(rng, [0.18, 0.20, 0.22]), fl = pick(rng, [0.5, 0.6, 0.75]);
      const E = N * ppfd * h * 3600 * 365.25 / eta / 1e6;       // MJ per m² footprint
      const land = E / (H * epv * fl);
      return {
        q: `A ${N}-layer vertical farm lights every layer at ${ppfd} µmol m⁻² s⁻¹ for ${h} h a day, all year, with ${eta} µmol J⁻¹ LEDs. How many m² of land covered with solar panels (efficiency ${Math.round(epv * 100)} %, land-area efficiency ${fl}, annual insolation ${H} MJ m⁻²) would supply the lighting electricity for each m² of the farm's footprint?`,
        answer: land, tol: 0.02, unit: 'm² m⁻²',
        solution: steps(
          `Lighting electricity per m² of footprint: \\(${N}\\times${ppfd}\\times${h}\\times3600\\times365.25/${eta} = ${tex(E * 1e6, 4)}\\) J = ${f(E, 4)} MJ yr⁻¹.`,
          `PV yield per m² of land: \\(${H}\\times${epv}\\times${fl} = ${tex(H * epv * fl, 3)}\\) MJ yr⁻¹.`,
          `Land (Eq. 7.2.10): \\(${tex(E, 4)}/${tex(H * epv * fl, 3)} = ${tex(land, 3)}\\) m² per m² of footprint — lighting only; HVAC adds 20–30 %.`)
      };
    }
  },

  /* ======================= 7.3 space farming ======================= */
  {
    id: 'sf-crew-consumables', title: 'Oxygen, food and water for a crewed mission', lesson: 'space-farming', difficulty: 1,
    gen(rng) {
      const n = randInt(rng, 2, 6), D = rand(rng, 180, 1100, 10);
      const item = pick(rng, [{ k: 'oxygen', v: 0.816 }, { k: 'food (without packaging)', v: 1.51 }, { k: 'potable water', v: 2.5 }, { k: 'CO₂ to be removed', v: 1.04 }]);
      return {
        q: `Using NASA's nominal values per crew member-day (O₂ 0.816 kg, CO₂ 1.04 kg, food 1.51 kg, potable water 2.5 kg), how much ${item.k} does a crew of ${n} need (or produce) during a ${D}-day mission?`,
        answer: item.v * n * D, tol: 0.01, unit: 'kg',
        solution: steps(
          `Crew member-days: \\(${n}\\times${D} = ${n * D}\\) CM-d.`,
          `\\(${item.v}\\times${n * D} = ${tex(item.v * n * D, 4)}\\) kg.`,
          `With 98 % water recovery (ISS since 2023) the water import would shrink to 2 % of the potable-water demand; food cannot be recycled by chemistry alone.`)
      };
    }
  },
  {
    id: 'sf-respiratory-quotient', title: 'Respiratory quotient from gas exchange', lesson: 'space-farming', difficulty: 1,
    gen(rng) {
      const o2 = rand(rng, 0.6, 1.2, 0.01), rq0 = rand(rng, 0.72, 1.0, 0.01);
      const co2 = +(o2 / 32.00 * rq0 * 44.01).toFixed(2);
      const rq = (co2 / 44.01) / (o2 / 32.00);
      return {
        q: `A crew member uses ${o2.toFixed(2)} kg of O₂ and exhales ${co2.toFixed(2)} kg of CO₂ per day. What is the respiratory quotient?`,
        answer: rq, tol: 0.01, unit: '',
        solution: steps(
          `Moles: \\(\\dot n_{\\text{CO}_2} = ${co2.toFixed(2)}/0.04401 = ${tex(co2 / 0.04401, 3)}\\) mol d⁻¹; \\(\\dot n_{\\text{O}_2} = ${o2.toFixed(2)}/0.0320 = ${tex(o2 / 0.032, 3)}\\) mol d⁻¹.`,
          `RQ \\(= ${tex(co2 / 0.04401, 3)}/${tex(o2 / 0.032, 3)} = ${tex(rq, 3)}\\) (Eq. 7.3.1).`,
          rq < 0.8 ? 'A low RQ indicates a fat-rich diet (fat: RQ ≈ 0.7).' : rq > 0.95 ? 'An RQ near 1 indicates mainly carbohydrate metabolism.' : 'An intermediate RQ indicates a mixed diet (BVAD nominal 0.93).')
      };
    }
  },
  {
    id: 'sf-plant-area-o2', title: 'Crop area to regenerate a crew\'s oxygen', lesson: 'space-farming', difficulty: 2,
    gen(rng) {
      const c = pick(rng, CROPS), n = randInt(rng, 1, 6);
      const A = n * 816 / c.o2;
      return {
        q: `In NASA's controlled-environment trials, ${c.name} produced ${c.o2} g of O₂ per m² per day. How many m² of ${c.name} are needed to supply the oxygen of a crew of ${n} (0.816 kg O₂ per person per day)?`,
        answer: A, tol: 0.02, unit: 'm²',
        solution: steps(
          `Eq. 7.3.3: \\(A_{\\text{O}_2} = N_{\\text{crew}}\\dot m_{\\text{O}_2}/r_{\\text{O}_2} = ${n}\\times816/${c.o2} = ${tex(A, 3)}\\) m².`,
          `Per person: \\(${tex(816 / c.o2, 3)}\\) m². The area to remove the crew's CO₂ is slightly smaller (\\(${n}\\times1040/${c.co2} = ${tex(n * 1040 / c.co2, 3)}\\) m²) because the crew's RQ (0.93) is below the crop's PQ (≈ 1).`)
      };
    }
  },
  {
    id: 'sf-food-lighting-power', title: 'Lighting power to grow one astronaut\'s food', lesson: 'space-farming', difficulty: 3,
    gen(rng) {
      const crop = pick(rng, [{ n: 'sweet potato', ed: 24.7, dli: 28 }, { n: 'white potato', ed: 21.1, dli: 28 }, { n: 'wheat', ed: 20.0, dli: 115 }, { n: 'rice', ed: 9.1, dli: 33 }]);
      const E = rand(rng, 10, 14, 0.1), q = 15.5, eta = rand(rng, 2.0, 3.5, 0.1), fc = pick(rng, [0.8, 0.85, 0.9, 0.95]);
      const dm = E * 1000 / q, A = dm / crop.ed, mol = A * crop.dli, P = mol * 1e6 / (eta * fc) / 86400 / 1000;
      return {
        q: `A crew member needs ${E} MJ of food energy per day, grown as ${crop.n} (edible productivity ${crop.ed} g DW m⁻² d⁻¹ at a daily light integral of ${crop.dli} mol m⁻² d⁻¹; 15.5 kJ per g of edible dry matter). With LEDs of ${eta} µmol J⁻¹ and a photon capture of ${fc}, what is the average lighting power (kW)?`,
        answer: P, tol: 0.03, unit: 'kW',
        solution: steps(
          `Edible dry matter: \\(${E * 1000}/15.5 = ${tex(dm, 3)}\\) g d⁻¹; area: \\(${tex(dm, 3)}/${crop.ed} = ${tex(A, 3)}\\) m².`,
          `Photons: \\(${tex(A, 3)}\\times${crop.dli} = ${tex(mol, 4)}\\) mol d⁻¹.`,
          `Power (Eq. 7.3.4): \\(${tex(mol, 4)}\\times10^{6}/(${eta}\\times${fc})/86\\,400 = ${tex(P * 1000, 4)}\\) W = ${f(P, 3)} kW.`)
      };
    }
  },
  {
    id: 'sf-capillary-length', title: 'Capillary length and capillary rise at different gravities', lesson: 'space-farming', difficulty: 2,
    gen(rng) {
      const env = pick(rng, [{ n: 'Mars', g: 3.71 }, { n: 'the Moon', g: 1.62 }, { n: 'Earth', g: 9.81 }]);
      const ask = pick(rng, ['lc', 'rise']);
      const r = rand(rng, 20, 300, 10);
      const lc = Math.sqrt(0.072 / (1000 * env.g)) * 1000, h = 2 * 0.072 / (1000 * env.g * r * 1e-6);
      return {
        q: ask === 'lc' ? `Calculate the capillary length of water (σ = 0.072 N m⁻¹, ρ = 1000 kg m⁻³) on ${env.n} (g = ${env.g} m s⁻²), in mm.` : `How high (in m) does water rise in a pore of radius ${r} µm of a wettable substrate (contact angle 0) on ${env.n} (g = ${env.g} m s⁻², σ = 0.072 N m⁻¹)?`,
        answer: ask === 'lc' ? lc : h, tol: 0.02, unit: ask === 'lc' ? 'mm' : 'm',
        solution: steps(
          ask === 'lc' ? `\\(\\ell_c = \\sqrt{\\sigma/(\\rho g)} = \\sqrt{0.072/(1000\\times${env.g})} = ${tex(lc / 1000, 3)}\\) m = ${f(lc, 3)} mm (Eq. 7.3.5).` : `Jurin's law: \\(h = 2\\sigma\\cos\\theta/(\\rho g r) = 2\\times0.072/(1000\\times${env.g}\\times${r}\\times10^{-6}) = ${tex(h, 3)}\\) m.`,
          `Both scale inversely with gravity (\\(\\ell_c\\propto g^{-1/2}\\), \\(h\\propto g^{-1}\\)): in orbit (≈ 10⁻⁶ g) surface tension controls all water in a root module.`)
      };
    }
  },
  {
    id: 'sf-habitat-co2', title: 'Time until CO₂ becomes dangerous in a sealed habitat', lesson: 'space-farming', difficulty: 3,
    gen(rng) {
      const n = randInt(rng, 2, 6), V = rand(rng, 60, 600, 10), p0 = pick(rng, [0.05, 0.1, 0.2, 0.3]), plim = pick(rng, [0.7, 1.0]);
      const nair = 101325 * V / (8.314 * 295.15), rate = n * 23.63 / nair * 101.325;     // kPa d⁻¹
      const hrs = (plim - p0) / rate * 24;
      return {
        q: `${n} crew members live in a sealed habitat with ${V} m³ of free air at 101.3 kPa and 22 °C. The plant chamber and the CO₂ scrubbers fail. Each person exhales 23.6 mol CO₂ per day. How many hours until the CO₂ partial pressure rises from ${p0} kPa to ${plim} kPa?`,
        answer: hrs, tol: 0.03, unit: 'h',
        solution: steps(
          `Moles of air: \\(pV/(RT) = 101\\,325\\times${V}/(8.314\\times295.15) = ${tex(nair, 4)}\\) mol.`,
          `CO₂ rise: \\(${n}\\times23.6/${tex(nair, 4)}\\times101.3 = ${tex(rate, 3)}\\) kPa d⁻¹ (Eq. 7.3.6).`,
          `Time: \\((${plim}-${p0})/${tex(rate, 3)} = ${tex(hrs / 24, 3)}\\) d = ${f(hrs, 3)} h. CO₂, not O₂, is the first emergency.`)
      };
    }
  },
  {
    id: 'sf-closure-resupply', title: 'Degree of closure and resupply mass', lesson: 'space-farming', difficulty: 1,
    gen(rng) {
      const chi = pick(rng, [0.8, 0.9, 0.95, 0.98, 0.99, 0.995]), n = randInt(rng, 2, 6), D = rand(rng, 300, 1500, 50);
      const M = (1 - chi) * 4.83 * n * D;
      return {
        q: `A life-support system regenerates ${f(chi * 100, 3)} % of the crew's consumables (O₂, water and food: 4.83 kg per person per day in total). How much must be imported for a crew of ${n} over ${D} days?`,
        answer: M, tol: 0.02, unit: 'kg',
        solution: steps(
          `Eq. 7.3.7: \\(M_{\\text{import}} = (1-\\chi)\\,\\dot m_{\\text{demand}}\\,N_{\\text{crew}}\\,D = ${tex(1 - chi, 3)}\\times4.83\\times${n}\\times${D} = ${tex(M, 4)}\\) kg.`,
          `Without any regeneration it would be \\(4.83\\times${n}\\times${D} = ${tex(4.83 * n * D, 4)}\\) kg: closure divides the resupply by \\(1/(1-\\chi) = ${tex(1 / (1 - chi), 3)}\\).`)
      };
    }
  },
  {
    id: 'sf-biosphere-mcq', title: 'Lessons from closed ecosystems', lesson: 'space-farming', difficulty: 1,
    gen(rng) {
      const cases = [
        { q: 'Why did oxygen fall inside Biosphere 2 between 1991 and 1993?', c: 'Microbes respiring the organic-rich soils consumed O₂, and exposed concrete absorbed much of the CO₂ produced', w: ['The glass roof leaked air to the outside', 'The crew breathed far more than predicted', 'Photosynthesis stops completely in sealed buildings'] },
        { q: 'Which is the first emergency in a sealed habitat whose plants and scrubbers fail?', c: 'Rising CO₂, because the tolerable CO₂ margin (≈ 1 kPa) is tiny compared with the O₂ reserve', w: ['Falling O₂, because O₂ is consumed faster than CO₂ is produced', 'Rising humidity, because transpiration stops', 'Falling pressure, because CO₂ is absorbed by the walls'] },
        { q: 'What does compartment III of ESA\'s MELiSSA loop do?', c: 'Nitrifying bacteria convert ammonium into nitrate for the plants', w: ['Thermophilic bacteria liquefy faeces and straw', 'Cyanobacteria produce oxygen and food', 'The crew consumes food and produces waste'] },
        { q: 'Why is watering plants in orbit difficult?', c: 'Without gravity, surface tension controls where water goes, so substrates neither drain nor aerate by themselves', w: ['Water boils at room temperature in orbit', 'Roots cannot take up water in microgravity', 'Water is too heavy to pump in orbit'] }
      ];
      const k = pick(rng, cases);
      return mcq(rng, k.q, k.c, k.w, steps(`Correct answer: ${k.c}.`, 'See Lesson 7.3, Sections 4–6.'));
    }
  }
];
