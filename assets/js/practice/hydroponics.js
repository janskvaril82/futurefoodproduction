/* ==========================================================================
   Practice generators — Module 5: Hydroponics: soilless cultivation systems
   Lessons: soilless-systems (5.1), nutrient-solution-chemistry (5.2),
            root-zone (5.3), hydraulic-design (5.4)
   Every generator returns a fresh, randomised, auto-marked problem.
   Shared physics from /assets/js/physics.js so that lessons, labs and practice
   agree: doSaturation() (Benson & Krause 1984), q10(), ec25() (alpha = 0.019).
   Constants: water rho = 998 kg m-3, g = 9.81 m s-2, mu(20 C) = 1.00e-3 Pa s,
   O2 in air at 20 C = 279 mg per litre of air, 1 mmol O2 = 32.00 mg.
   ========================================================================== */
import { rand, randInt, pick, f, steps, mcq } from './helpers.js';
import { doSaturation, q10, ec25 } from '../physics.js';

/* ---------- local data ---------- */
const IONS = [
  { name: 'calcium (Ca²⁺, reported as Ca)', M: 40.078, z: 2, lo: 40, hi: 220 },
  { name: 'magnesium (Mg²⁺, reported as Mg)', M: 24.305, z: 2, lo: 10, hi: 70 },
  { name: 'potassium (K⁺, reported as K)', M: 39.098, z: 1, lo: 100, hi: 350 },
  { name: 'nitrate nitrogen (reported as NO₃-N)', M: 14.007, z: 1, lo: 80, hi: 230 },
  { name: 'sulfate (reported as the SO₄²⁻ ion)', M: 96.06, z: 2, lo: 30, hi: 250 },
  { name: 'sodium (Na⁺)', M: 22.99, z: 1, lo: 5, hi: 80 },
  { name: 'chloride (Cl⁻)', M: 35.45, z: 1, lo: 5, hi: 90 },
  { name: 'phosphate phosphorus (H₂PO₄⁻, reported as P)', M: 30.974, z: 1, lo: 15, hi: 60 }
];
const SALTS = [
  { name: 'potassium nitrate, KNO₃', M: 101.10, ion: 'K⁺', nu: 1, partner: 'an equal amount of NO₃⁻' },
  { name: 'potassium sulfate, K₂SO₄', M: 174.26, ion: 'K⁺', nu: 2, partner: 'half as much SO₄²⁻' },
  { name: 'magnesium sulfate heptahydrate (Epsom salt), MgSO₄·7H₂O', M: 246.47, ion: 'Mg²⁺', nu: 1, partner: 'an equal amount of SO₄²⁻' },
  { name: 'monopotassium phosphate, KH₂PO₄', M: 136.09, ion: 'H₂PO₄⁻', nu: 1, partner: 'an equal amount of K⁺' },
  { name: 'commercial calcium nitrate, 5Ca(NO₃)₂·NH₄NO₃·10H₂O', M: 1080.6, ion: 'Ca²⁺', nu: 5, partner: '2.2 NO₃⁻ and 0.2 NH₄⁺ per Ca²⁺' },
  { name: 'calcium nitrate tetrahydrate, Ca(NO₃)₂·4H₂O', M: 236.15, ion: 'Ca²⁺', nu: 1, partner: 'twice as much NO₃⁻' }
];
/* Henry's constant of O2 (mmol L-1 atm-1) and water vapour pressure (atm), consistent with doSaturation(). */
const HENRY = { 15: { kh: 1.530, pw: 0.01683 }, 20: { kh: 1.389, pw: 0.02307 }, 25: { kh: 1.273, pw: 0.03126 }, 30: { kh: 1.177, pw: 0.04188 } };
const sj = (Re, eD) => 0.25 / Math.pow(Math.log10(eD / 3.7 + 5.74 / Math.pow(Re, 0.9)), 2);

export default [
  /* ======================= 5.1 soilless systems ======================= */
  {
    id: 'hy-kratky-days', title: 'How long does a Kratky tank last?', lesson: 'soilless-systems', difficulty: 1,
    gen(rng) {
      const n = randInt(rng, 2, 12), V0 = Math.round(n * rand(rng, 4, 8, 0.5)), u = rand(rng, 0.08, 0.2, 0.01), frac = pick(rng, [0.5, 0.6, 0.7, 0.75]);
      const d = frac * V0 / (n * u);
      return {
        q: `A Kratky tank is filled with ${V0} L of nutrient solution for ${n} lettuces. Each plant takes up on average ${u} L of water per day. After how many days has ${Math.round(frac * 100)} % of the solution been used (the point at which you planned to harvest)?`,
        answer: d, tol: 0.02, unit: 'days',
        solution: steps(
          `Daily use of the whole crop: \\(n\\,u = ${n}\\times${u} = ${f(n * u)}\\) L d⁻¹.`,
          `Volume that may be used: \\(${frac}\\times${V0} = ${f(frac * V0)}\\) L.`,
          `Time: \\(${f(frac * V0)}/${f(n * u)} = ${f(d)}\\) days. Nothing is added in a Kratky tank, so the crop must finish within this time (Eq. 5.1.2); water use per plant rises as the plants grow, so real tanks empty faster near harvest.`)
      };
    }
  },
  {
    id: 'hy-drain-supply', title: 'Supply needed for a chosen drain fraction', lesson: 'soilless-systems', difficulty: 1,
    gen(rng) {
      const vet = rand(rng, 1.0, 5.0, 0.1), df = pick(rng, [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4]);
      const vs = vet / (1 - df);
      return {
        q: `A tomato crop on stone-wool slabs uses ${vet} L m⁻² d⁻¹ of water. The grower wants a drain fraction of ${Math.round(df * 100)} %. How much solution must be supplied per square metre per day?`,
        answer: vs, tol: 0.02, unit: 'L m⁻² d⁻¹',
        solution: steps(
          `Water balance: supply = crop use + drain, and drain = DF × supply, so \\(V_s = V_{ET}/(1-\\text{DF})\\) (Eq. 5.1.6).`,
          `\\(V_s = ${vet}/(1-${df}) = ${f(vs)}\\) L m⁻² d⁻¹, of which \\(${f(vs - vet)}\\) L m⁻² d⁻¹ drains.`)
      };
    }
  },
  {
    id: 'hy-air-porosity', title: 'Air-filled porosity from a container test', lesson: 'soilless-systems', difficulty: 1,
    gen(rng) {
      const vb = rand(rng, 0.5, 2.0, 0.1), va = +(vb * rand(rng, 0.75, 0.95, 0.01)).toFixed(2), vd = +(vb * rand(rng, 0.08, 0.35, 0.01)).toFixed(2);
      const askAir = rng() < 0.5;
      const ans = askAir ? 100 * vd / vb : 100 * (va - vd) / vb;
      return {
        q: `A ${vb} L pot of dry growing medium is saturated with ${va} L of water and then drains ${vd} L by gravity. What is the ${askAir ? '<b>air-filled porosity</b>' : '<b>water-holding capacity</b> (container capacity)'} as a percentage of the bulk volume?`,
        answer: ans, tol: 0.02, unit: '%',
        solution: steps(
          `Total porosity ≈ water needed to saturate / bulk volume = ${f(va)}/${f(vb)} = ${f(100 * va / vb)} %.`,
          `Air-filled porosity \\(\\varepsilon_a = V_{\\text{drained}}/V_{\\text{bulk}} = ${f(vd)}/${f(vb)} = ${f(100 * vd / vb)}\\) %.`,
          `Water-holding capacity \\(\\theta_{cc} = (V_{\\text{added}}-V_{\\text{drained}})/V_{\\text{bulk}} = ${f(va - vd)}/${f(vb)} = ${f(100 * (va - vd) / vb)}\\) % (Eq. 5.1.4). Targets for pot plants: 20–30 % air.`)
      };
    }
  },
  {
    id: 'hy-water-use', title: 'Water use per kilogram of a Kratky crop', lesson: 'soilless-systems', difficulty: 2,
    gen(rng) {
      const n = randInt(rng, 4, 16), wp = rand(rng, 2.5, 6, 0.1), vr = rand(rng, 0, 25, 1), m = rand(rng, 120, 320, 10);
      const wu = (n * wp + vr) / (n * m / 1000);
      return {
        q: `A group grows ${n} lettuces in a Kratky tank. Each plant takes up ${wp} L of water before harvest; at harvest ${vr} L of solution are left and poured away. The heads weigh ${m} g on average. What is the water use per kilogram of lettuce (including the discarded solution)?`,
        answer: wu, tol: 0.02, unit: 'L kg⁻¹',
        solution: steps(
          `Water input = taken up + discarded = \\(${n}\\times${wp} + ${vr} = ${f(n * wp + vr)}\\) L.`,
          `Yield = \\(${n}\\times${m / 1000} = ${f(n * m / 1000)}\\) kg.`,
          `WU = \\(${f(n * wp + vr)}/${f(n * m / 1000)} = ${f(wu)}\\) L kg⁻¹ (Eq. 5.1.7). Kratky (2009) reports values below 20 L kg⁻¹ as common.`)
      };
    }
  },

  /* ======================= 5.2 nutrient-solution chemistry ======================= */
  {
    id: 'hy-units', title: 'mg L⁻¹ → mmol L⁻¹ → meq L⁻¹', lesson: 'nutrient-solution-chemistry', difficulty: 1,
    gen(rng) {
      const ion = pick(rng, IONS), c = rand(rng, ion.lo, ion.hi, 1), mmol = c / ion.M, meq = mmol * ion.z;
      const askMeq = rng() < 0.5;
      return {
        q: `A water or solution analysis reports ${ion.name} as ${c} mg L⁻¹. Convert it to <b>${askMeq ? 'meq L⁻¹' : 'mmol L⁻¹'}</b> (M = ${ion.M} g mol⁻¹, charge ${ion.z}).`,
        answer: askMeq ? meq : mmol, tol: 0.02, unit: askMeq ? 'meq L⁻¹' : 'mmol L⁻¹',
        solution: steps(
          `\\(c_{\\text{mmol}} = c_{\\text{mg}}/M = ${c}/${ion.M} = ${f(mmol, 4)}\\) mmol L⁻¹ (Eq. 5.2.1).`,
          `\\(c_{\\text{meq}} = |z|\\,c_{\\text{mmol}} = ${ion.z}\\times${f(mmol, 4)} = ${f(meq, 4)}\\) meq L⁻¹.`,
          `Always divide by the molar mass of the species the report uses (e.g. 14.007 for NO₃-N, 62.00 for the nitrate ion).`)
      };
    }
  },
  {
    id: 'hy-salt-mass', title: 'Grams of fertiliser salt for a target concentration', lesson: 'nutrient-solution-chemistry', difficulty: 1,
    gen(rng) {
      const s = pick(rng, SALTS), c = rand(rng, 0.5, 5, 0.1), V = pick(rng, [20, 50, 100, 200, 500, 1000]);
      const m = c * V * s.M / s.nu / 1000;
      return {
        q: `How many grams of ${s.name} (M = ${s.M} g mol⁻¹) must be dissolved to give ${c} mmol L⁻¹ of ${s.ion} in ${V} L of nutrient solution?`,
        answer: m, tol: 0.02, unit: 'g',
        solution: steps(
          `Amount of ${s.ion} needed: \\(${c}\\times${V} = ${f(c * V)}\\) mmol.`,
          `Each formula unit supplies ${s.nu} ${s.ion}: \\(${f(c * V)}/${s.nu} = ${f(c * V / s.nu)}\\) mmol of salt.`,
          `Mass: \\(${f(c * V / s.nu)}\\ \\text{mmol}\\times${s.M}\\ \\text{mg mmol}^{-1} = ${f(m * 1000)}\\) mg = ${f(m)} g (Eq. 5.2.2). It also brings ${s.partner}.`)
      };
    }
  },
  {
    id: 'hy-stock', title: 'Grams per stock tank at a concentration factor', lesson: 'nutrient-solution-chemistry', difficulty: 2,
    gen(rng) {
      const s = pick(rng, SALTS), c = rand(rng, 0.5, 5, 0.1), F = pick(rng, [50, 100, 200]), Vs = pick(rng, [5, 10, 20, 50]);
      const m = c * F * Vs * s.M / s.nu / 1000;
      return {
        q: `You prepare ${Vs} L of a ${F}× stock solution that, after dilution 1 : ${F}, must give ${c} mmol L⁻¹ of ${s.ion} in the working solution. How many grams of ${s.name} (M = ${s.M} g mol⁻¹) go into the stock tank?`,
        answer: m, tol: 0.02, unit: 'g',
        solution: steps(
          `Stock concentration: \\(${F}\\times${c} = ${f(F * c)}\\) mmol L⁻¹ of ${s.ion}.`,
          `Amount in the tank: \\(${f(F * c)}\\times${Vs} = ${f(F * c * Vs)}\\) mmol ${s.ion} → \\(${f(F * c * Vs / s.nu)}\\) mmol of salt (${s.nu} ${s.ion} per formula unit).`,
          `Mass: \\(${f(F * c * Vs / s.nu)}\\times${s.M}/1000 = ${f(m)}\\) g. Check solubility — and never put calcium in the same stock as sulfate or phosphate.`)
      };
    }
  },
  {
    id: 'hy-ion-balance', title: 'Ion-balance error of an analysis', lesson: 'nutrient-solution-chemistry', difficulty: 2,
    gen(rng) {
      const K = rand(rng, 3, 8, 0.1), Ca = rand(rng, 1.5, 5, 0.1), Mg = rand(rng, 0.5, 2, 0.1), NH4 = rand(rng, 0, 1, 0.1);
      const H2PO4 = rand(rng, 0.5, 1.5, 0.1), SO4 = rand(rng, 0.8, 3, 0.1);
      const cat = K + 2 * Ca + 2 * Mg + NH4;
      const NO3 = +(cat - H2PO4 - 2 * SO4 + rand(rng, -1.2, 1.2, 0.1)).toFixed(1);
      const an = NO3 + H2PO4 + 2 * SO4, ibe = 100 * (cat - an) / (cat + an);
      return {
        q: `A laboratory reports (mmol L⁻¹): K⁺ ${K}, Ca²⁺ ${Ca}, Mg²⁺ ${Mg}, NH₄⁺ ${NH4}, NO₃⁻ ${NO3}, H₂PO₄⁻ ${H2PO4}, SO₄²⁻ ${SO4}. Calculate the ion-balance error in per cent.`,
        answer: ibe, abstol: 0.3, unit: '%',
        solution: steps(
          `Σ cations = \\(${K} + 2\\times${Ca} + 2\\times${Mg} + ${NH4} = ${f(cat, 4)}\\) meq L⁻¹.`,
          `Σ anions = \\(${NO3} + ${H2PO4} + 2\\times${SO4} = ${f(an, 4)}\\) meq L⁻¹.`,
          `IBE = \\(100\\,(\\Sigma_+-\\Sigma_-)/(\\Sigma_++\\Sigma_-) = ${f(ibe, 3)}\\) % (Eq. 5.2.3). ${Math.abs(ibe) <= 5 ? 'Within ±5 %: acceptable.' : 'Outside ±5 %: suspect an analytical or reporting error.'}`)
      };
    }
  },
  {
    id: 'hy-ec-cations', title: 'EC estimate from the sum of cations', lesson: 'nutrient-solution-chemistry', difficulty: 1,
    gen(rng) {
      const K = rand(rng, 3, 9, 0.5), Ca = rand(rng, 1.5, 5, 0.5), Mg = rand(rng, 0.5, 2, 0.25), NH4 = rand(rng, 0, 1, 0.25);
      const sum = K + 2 * Ca + 2 * Mg + NH4;
      return {
        q: `A nutrient solution contains K⁺ ${K}, Ca²⁺ ${Ca}, Mg²⁺ ${Mg} and NH₄⁺ ${NH4} mmol L⁻¹. Estimate its EC with the rule EC ≈ Σcations/10.`,
        answer: sum / 10, tol: 0.02, unit: 'dS m⁻¹',
        solution: steps(
          `Σ cations in meq L⁻¹: \\(${K} + 2\\times${Ca} + 2\\times${Mg} + ${NH4} = ${f(sum, 4)}\\).`,
          `EC ≈ \\(${f(sum, 4)}/10 = ${f(sum / 10, 3)}\\) dS m⁻¹ (Eq. 5.2.4; typically within ±10 % of the measured value).`)
      };
    }
  },
  {
    id: 'hy-ec25', title: 'Temperature compensation of EC', lesson: 'nutrient-solution-chemistry', difficulty: 1,
    gen(rng) {
      const ecT = rand(rng, 0.8, 3.0, 0.01), T = rand(rng, 10, 30, 0.5);
      const e25 = ec25(ecT, T, 0.019);
      return {
        q: `An EC meter without temperature compensation reads ${ecT} dS m⁻¹ in a solution at ${T} °C. What is the EC referred to 25 °C (α = 0.019 K⁻¹)?`,
        answer: e25, tol: 0.015, unit: 'dS m⁻¹',
        solution: steps(
          `\\(\\text{EC}_{25} = \\text{EC}_T/(1+\\alpha(T-25))\\) (Eq. 5.2.5).`,
          `\\(= ${ecT}/(1 + 0.019\\times(${T}-25)) = ${ecT}/${f(1 + 0.019 * (T - 25), 4)} = ${f(e25, 4)}\\) dS m⁻¹.`,
          T < 25 ? 'Cold solutions read low — without compensation a grower would over-dose fertiliser.' : 'Warm solutions read high.')
      };
    }
  },
  {
    id: 'hy-acid-dose', title: 'Nitric acid to neutralise bicarbonate', lesson: 'nutrient-solution-chemistry', difficulty: 2,
    gen(rng) {
      const h0 = rand(rng, 1.0, 5.0, 0.1), res = 0.5, V = pick(rng, [100, 200, 500, 1000, 2000]);
      const acid = pick(rng, [{ w: 38, rho: 1.235 }, { w: 60, rho: 1.367 }]);
      const C = 10 * acid.w * acid.rho / 63.01, mL = (h0 - res) * V / C;
      return {
        q: `Your water contains ${h0} mmol L⁻¹ HCO₃⁻. You want to keep 0.5 mmol L⁻¹ as a buffer. How many millilitres of ${acid.w} % nitric acid (density ${acid.rho} g mL⁻¹, M = 63.01 g mol⁻¹) do you need for ${V} L of water?`,
        answer: mL, tol: 0.02, unit: 'mL',
        solution: steps(
          `H⁺ needed: \\((${h0}-0.5)\\ \\text{mmol L}^{-1}\\times${V}\\ \\text{L} = ${f((h0 - res) * V)}\\) mmol (Eq. 5.2.7).`,
          `Acid concentration: \\(C = 10\\,w\\,\\rho/M = 10\\times${acid.w}\\times${acid.rho}/63.01 = ${f(C, 3)}\\) mol L⁻¹.`,
          `Volume: \\(${f((h0 - res) * V)}\\ \\text{mmol}/${f(C, 3)}\\ \\text{mol L}^{-1} = ${f(mL)}\\) mL. It adds \\(${f((h0 - res) * 14.007)}\\) mg L⁻¹ of nitrate-N — count it in the recipe. Wear goggles and gloves; add acid to water.`)
      };
    }
  },
  {
    id: 'hy-kratky-ec', title: 'EC drift in a non-circulating tank', lesson: 'nutrient-solution-chemistry', difficulty: 2,
    gen(rng) {
      const c0 = rand(rng, 1.2, 2.0, 0.05), fr = rand(rng, 0.4, 0.8, 0.05), cu = rand(rng, 0.6, 1.6, 0.05);
      const c = (c0 - cu * fr) / (1 - fr);
      return {
        q: `A Kratky tank starts at EC ${c0} dS m⁻¹. By harvest ${Math.round(fr * 100)} % of the solution has been used. The crop's uptake EC-equivalent (nutrients taken up per litre of water taken up) was ${cu} dS m⁻¹. What is the EC at harvest?`,
        answer: c, tol: 0.02, unit: 'dS m⁻¹',
        solution: steps(
          `\\(c = (c_0 - c_u f)/(1-f)\\) (Eq. 5.2.10).`,
          `\\(= (${c0} - ${cu}\\times${fr})/(1-${fr}) = ${f(c0 - cu * fr, 4)}/${f(1 - fr, 3)} = ${f(c, 4)}\\) dS m⁻¹.`,
          c > c0 ? 'EC rose: the plants took up relatively more water than nutrients.' : 'EC fell: the plants stripped nutrients faster than water.')
      };
    }
  },
  {
    id: 'hy-bleed', title: 'Bleed fraction to control sodium in a closed loop', lesson: 'nutrient-solution-chemistry', difficulty: 2,
    gen(rng) {
      let cw, cmax; do { cw = rand(rng, 0.2, 2.0, 0.05); cmax = rand(rng, 3, 8, 0.5); } while (cw / cmax > 0.35);
      const E = rand(rng, 20, 300, 5);
      const b = cw / cmax, Qb = b * E / (1 - b);
      const askQ = rng() < 0.5;
      return {
        q: `A closed system is topped up with water containing ${cw} mmol L⁻¹ Na⁺, which the crop does not take up. Na⁺ must stay at or below ${cmax} mmol L⁻¹. The crop transpires ${E} L d⁻¹. ${askQ ? 'How many litres per day must be bled (discharged) at the minimum bleed fraction?' : 'What is the minimum bleed fraction (as % of the top-up inflow)?'}`,
        answer: askQ ? Qb : 100 * b, tol: 0.02, unit: askQ ? 'L d⁻¹' : '%',
        solution: steps(
          `Steady state: \\(c_{ss} = c_w/b\\le c_{\\max}\\) (Eq. 5.2.9), so \\(b\\ge ${cw}/${cmax} = ${f(b, 4)}\\) = ${f(100 * b, 3)} %.`,
          `Bleed flow: \\(Q_b = bE/(1-b) = ${f(b, 4)}\\times${E}/${f(1 - b, 4)} = ${f(Qb)}\\) L d⁻¹ — with its nutrients. Rain or RO water shrinks the bleed.`)
      };
    }
  },

  /* ======================= 5.3 the root zone ======================= */
  {
    id: 'hy-do-percent', title: 'Dissolved-oxygen saturation and % saturation', lesson: 'root-zone', difficulty: 1,
    gen(rng) {
      const T = rand(rng, 12, 30, 1), Cs = doSaturation(T), reading = +(Cs * rand(rng, 0.35, 0.98, 0.01)).toFixed(2);
      return {
        q: `At ${T} °C and sea-level pressure, fresh water in equilibrium with air holds C* = ${f(Cs, 4)} mg L⁻¹ of oxygen (Benson–Krause, Eq. 5.3.4). Your DO meter reads ${reading} mg L⁻¹ in a DWC tank at that temperature. What is the percent saturation?`,
        answer: 100 * reading / Cs, tol: 0.02, unit: '%',
        solution: steps(
          `% saturation = \\(100\\,C/C^{*} = 100\\times${reading}/${f(Cs, 4)} = ${f(100 * reading / Cs)}\\) %.`,
          `${reading >= 6 ? 'Above 6 mg L⁻¹: good.' : reading >= 4 ? 'Between 4 and 6 mg L⁻¹: adequate in well-mixed solution, little margin.' : 'Below 4 mg L⁻¹: risky — improve aeration and check temperature (Table 2 of Lesson 5.3).'}`)
      };
    }
  },
  {
    id: 'hy-henry', title: "Henry's law: air, enriched gas and altitude", lesson: 'root-zone', difficulty: 2,
    gen(rng) {
      const T = pick(rng, [15, 20, 25, 30]), h = HENRY[T];
      const gas = pick(rng, [{ label: 'air', x: 0.2095 }, { label: 'pure oxygen', x: 1 }, { label: 'a gas mixture with 40 % oxygen', x: 0.40 }]);
      const site = pick(rng, [{ label: 'at sea level (P = 1.000 atm)', P: 1.0 }, { label: 'at 1000 m altitude (P = 0.887 atm)', P: 0.887 }]);
      const C = h.kh * gas.x * (site.P - h.pw) * 32.00;
      return {
        q: `Using Henry's law, calculate the equilibrium dissolved-oxygen concentration of water at ${T} °C in contact with ${gas.label} ${site.label}. Use \\(k_H\\) = ${h.kh} mmol L⁻¹ atm⁻¹ and a water vapour pressure of ${h.pw} atm.`,
        answer: C, tol: 0.02, unit: 'mg L⁻¹',
        solution: steps(
          `\\(p_{\\mathrm{O_2}} = x_{\\mathrm{O_2}}(P - p_w) = ${gas.x}\\times(${site.P} - ${h.pw}) = ${f(gas.x * (site.P - h.pw), 4)}\\) atm.`,
          `\\(C^{*} = k_H\\,p_{\\mathrm{O_2}} = ${h.kh}\\times${f(gas.x * (site.P - h.pw), 4)} = ${f(C / 32, 4)}\\) mmol L⁻¹ (Eq. 5.3.3).`,
          `× 32.00 mg mmol⁻¹ = ${f(C)} mg L⁻¹.`)
      };
    }
  },
  {
    id: 'hy-q10', title: 'Root respiration at another temperature (Q₁₀)', lesson: 'root-zone', difficulty: 1,
    gen(rng) {
      const r20 = rand(rng, 1, 8, 0.1), T = rand(rng, 12, 30, 1), Q = pick(rng, [1.8, 2.0, 2.0, 2.2, 2.5]);
      const r = q10(r20, Q, T, 20);
      return {
        q: `A lettuce's roots consume ${r20} mg O₂ h⁻¹ at 20 °C. With \\(Q_{10}\\) = ${Q}, what is their oxygen consumption at ${T} °C?`,
        answer: r, tol: 0.02, unit: 'mg O₂ h⁻¹',
        solution: steps(
          `\\(\\text{OUR}(T) = \\text{OUR}_{20}\\,Q_{10}^{(T-20)/10}\\) (Eq. 5.3.2).`,
          `\\(= ${r20}\\times${Q}^{${f((T - 20) / 10, 3)}} = ${r20}\\times${f(Math.pow(Q, (T - 20) / 10), 4)} = ${f(r)}\\) mg O₂ h⁻¹.`)
      };
    }
  },
  {
    id: 'hy-hypoxia-time', title: 'Time to hypoxia after an air-pump failure', lesson: 'root-zone', difficulty: 2,
    gen(rng) {
      const V = rand(rng, 20, 150, 5), n = randInt(rng, 3, 12), r20 = rand(rng, 2, 8, 0.5), T = rand(rng, 16, 28, 1), cc = pick(rng, [3, 3.5, 4]);
      const Cs = doSaturation(T), R = n * q10(r20, 2, T, 20), tau = V * (Cs - cc) / R;
      return {
        q: `A ${V} L DWC tank holds ${n} lettuces whose roots consume ${r20} mg O₂ h⁻¹ each at 20 °C (\\(Q_{10}\\) = 2). The solution is at ${T} °C and saturated (C* = ${f(Cs, 4)} mg L⁻¹) when the air pump fails. Ignoring surface re-aeration, how many hours until DO reaches ${cc} mg L⁻¹?`,
        answer: tau, tol: 0.03, unit: 'h',
        solution: steps(
          `Uptake at ${T} °C: \\(${n}\\times${r20}\\times2^{${f((T - 20) / 10, 3)}} = ${f(R)}\\) mg h⁻¹.`,
          `Oxygen that may be used: \\(V(C^{*}-C_{\\text{crit}}) = ${V}\\times(${f(Cs, 4)}-${cc}) = ${f(V * (Cs - cc))}\\) mg.`,
          `\\(\\tau = ${f(V * (Cs - cc))}/${f(R)} = ${f(tau)}\\) h (Eq. 5.3.5 with \\(k_La\\approx0\\)).`)
      };
    }
  },
  {
    id: 'hy-kla-required', title: 'Aeration needed to hold a DO target', lesson: 'root-zone', difficulty: 2,
    gen(rng) {
      const n = randInt(rng, 4, 16), r20 = rand(rng, 2, 8, 0.5), T = rand(rng, 18, 28, 1), V = rand(rng, 30, 200, 10), ct = pick(rng, [5, 5.5, 6, 6.5]);
      const Cs = doSaturation(T), our = n * q10(r20, 2, T, 20) / V, kla = our / (Cs - ct);
      return {
        q: `${n} plants share ${V} L of solution at ${T} °C (C* = ${f(Cs, 4)} mg L⁻¹). Each plant's roots consume ${r20} mg O₂ h⁻¹ at 20 °C (\\(Q_{10}\\) = 2). What aeration \\(k_La\\) keeps DO at ${ct} mg L⁻¹ at steady state?`,
        answer: kla, tol: 0.03, unit: 'h⁻¹',
        solution: steps(
          `Tank uptake: \\(\\text{OUR} = ${n}\\times${r20}\\times2^{${f((T - 20) / 10, 3)}}/${V} = ${f(our, 4)}\\) mg L⁻¹ h⁻¹.`,
          `Steady state of Eq. 5.3.5: \\(k_La(C^{*}-C) = \\text{OUR}\\).`,
          `\\(k_La = ${f(our, 4)}/(${f(Cs, 4)}-${ct}) = ${f(kla)}\\) h⁻¹ — small compared with the 1–10 h⁻¹ of an aquarium air stone.`)
      };
    }
  },
  {
    id: 'hy-aeration', title: 'Steady-state DO from air flow and transfer efficiency', lesson: 'root-zone', difficulty: 3,
    gen(rng) {
      let Qa, E, V, T, our, Cs, OTR, kla, Css;
      do { Qa = rand(rng, 0.5, 4, 0.1); E = rand(rng, 1, 4, 0.5); V = rand(rng, 20, 120, 5); T = rand(rng, 18, 28, 1); our = rand(rng, 0.3, 2.0, 0.05); Cs = doSaturation(T); OTR = E / 100 * 279 * Qa * 60; kla = OTR / (V * Cs); Css = Cs - our / kla; } while (Css < 2);
      return {
        q: `An air pump delivers ${Qa} L min⁻¹ of air to an air stone in a ${V} L DWC tank at ${T} °C (C* = ${f(Cs, 4)} mg L⁻¹); about ${E} % of the oxygen dissolves. Air contains 279 mg O₂ per litre. The roots consume ${our} mg L⁻¹ h⁻¹. Estimate \\(k_La\\) and the steady-state DO.`,
        answer: Math.max(0, Css), tol: 0.02, unit: 'mg L⁻¹',
        solution: steps(
          `\\(\\text{OTR}_{\\max} = E\\,\\rho_{\\mathrm{O_2}}\\,Q_{\\text{air}} = ${E / 100}\\times279\\times${Qa}\\times60 = ${f(OTR)}\\) mg h⁻¹ (Eq. 5.3.6).`,
          `\\(k_La = \\text{OTR}_{\\max}/(VC^{*}) = ${f(OTR)}/(${V}\\times${f(Cs, 4)}) = ${f(kla, 4)}\\) h⁻¹.`,
          `\\(C_{ss} = C^{*} - \\text{OUR}/k_La = ${f(Cs, 4)} - ${our}/${f(kla, 4)} = ${f(Css)}\\) mg L⁻¹ (Eq. 5.3.5).`)
      };
    }
  },
  {
    id: 'hy-uv-dose', title: 'UV dose and log inactivation', lesson: 'root-zone', difficulty: 3,
    gen(rng) {
      const org = pick(rng, [{ name: '<i>Fusarium oxysporum</i> conidia', D10: 28 }, { name: 'tomato mosaic virus', D10: 50 }]);
      let P, Q, uvt, d, A, le, D;
      do { P = rand(rng, 6, 30, 1); Q = rand(rng, 4, 40, 1); uvt = rand(rng, 50, 92, 1); d = rand(rng, 1, 3, 0.5); A = -Math.log10(uvt / 100); le = (1 - Math.pow(10, -A * d)) / (A * Math.LN10); D = P * 1000 * le / (Q * 1000 / 60); } while (D / org.D10 > 6 || D / org.D10 < 0.5);
      return {
        q: `A UV-C lamp emits ${P} W at 254 nm into an annular water layer ${d} cm thick. The drain water has a UV transmittance of ${uvt} % per cm and flows at ${Q} L min⁻¹. Using the average-dose equation (Eq. 5.3.9), what log₁₀ reduction of ${org.name} (\\(D_{10}\\) ≈ ${org.D10} mJ cm⁻²) do you expect?`,
        answer: D / org.D10, abstol: 0.05, unit: 'log₁₀',
        solution: steps(
          `\\(A = -\\log_{10}(${uvt / 100}) = ${f(A, 4)}\\) cm⁻¹; \\(\\ell_{\\text{eff}} = (1-10^{-Ad})/(A\\ln10) = ${f(le, 4)}\\) cm.`,
          `\\(Q = ${Q}\\ \\text{L min}^{-1} = ${f(Q * 1000 / 60, 4)}\\) cm³ s⁻¹; \\(\\bar{D} = P\\,\\ell_{\\text{eff}}/Q = ${P * 1000}\\times${f(le, 4)}/${f(Q * 1000 / 60, 4)} = ${f(D)}\\) mJ cm⁻².`,
          `Log reduction = \\(\\bar{D}/D_{10} = ${f(D)}/${org.D10} = ${f(D / org.D10)}\\). This is an average for ideal mixing and a new lamp — design with a margin.`)
      };
    }
  },

  /* ======================= 5.4 hydraulic design ======================= */
  {
    id: 'hy-channel-flow', title: 'Minimum NFT channel flow from an oxygen balance', lesson: 'hydraulic-design', difficulty: 2,
    gen(rng) {
      const N = randInt(rng, 8, 60), r = rand(rng, 2, 10, 0.5), cin = rand(rng, 7, 8.8, 0.1), cmin = pick(rng, [3, 3.5, 4, 4.5]);
      const Q = N * r / (cin - cmin) / 60;
      return {
        q: `An NFT channel feeds ${N} plants whose roots consume ${r} mg O₂ h⁻¹ each. Solution enters at ${cin} mg L⁻¹ and must leave the last plant at no less than ${cmin} mg L⁻¹. Ignoring re-aeration, what is the minimum channel flow in L min⁻¹?`,
        answer: Q, tol: 0.02, unit: 'L min⁻¹',
        solution: steps(
          `Mass balance: \\(Q_{\\min} = N_pr/(C_{\\text{in}}-C_{\\min})\\) (Eq. 5.4.1).`,
          `\\(= ${N}\\times${r}/(${cin}-${cmin}) = ${f(N * r / (cin - cmin))}\\) L h⁻¹ = ${f(Q)} L min⁻¹.`,
          `Practical NFT flows (≈ 1–2 L min⁻¹ per channel) are chosen larger, for wetting and safety.`)
      };
    }
  },
  {
    id: 'hy-film', title: 'NFT film thickness (Nusselt)', lesson: 'hydraulic-design', difficulty: 2,
    gen(rng) {
      const Q = rand(rng, 0.5, 2.5, 0.1), W = rand(rng, 6, 15, 1), n = pick(rng, [30, 40, 50, 75, 100]);
      const q = Q / 60000 / (W / 100), h = Math.cbrt(3 * 1.0e-3 * q / (998 * 9.81 * (1 / n)));
      return {
        q: `An NFT channel has a flat floor ${W} cm wide and a slope of 1:${n}. It carries ${Q} L min⁻¹ of solution (μ = 1.00 × 10⁻³ Pa s, ρ = 998 kg m⁻³). What is the laminar film thickness in mm?`,
        answer: h * 1000, tol: 0.02, unit: 'mm',
        solution: steps(
          `\\(q = Q/W = ${f(Q / 60000, 4)}/${W / 100} = ${f(q, 4)}\\) m² s⁻¹; \\(\\sin\\theta\\approx1/${n} = ${f(1 / n, 4)}\\).`,
          `\\(h = (3\\mu q/(\\rho g\\sin\\theta))^{1/3} = (3\\times10^{-3}\\times${f(q, 4)}/(998\\times9.81\\times${f(1 / n, 4)}))^{1/3}\\) (Eq. 5.4.2).`,
          `\\(h = ${f(h, 4)}\\) m = ${f(h * 1000)} mm; mean velocity \\(q/h = ${f(q / h)}\\) m s⁻¹.`)
      };
    }
  },
  {
    id: 'hy-residence', title: 'Residence time in an NFT channel', lesson: 'hydraulic-design', difficulty: 1,
    gen(rng) {
      const L = rand(rng, 1.5, 12, 0.5), W = rand(rng, 6, 15, 1), h = rand(rng, 1.0, 2.5, 0.1), Q = rand(rng, 0.5, 2.5, 0.1);
      const t = L * (W / 100) * (h / 1000) / (Q / 60000);
      return {
        q: `A ${L} m NFT channel, ${W} cm wide, carries a film ${h} mm deep at ${Q} L min⁻¹. How long (in seconds) does the solution take to pass through the channel?`,
        answer: t, tol: 0.02, unit: 's',
        solution: steps(
          `Film volume: \\(LWh = ${L}\\times${W / 100}\\times${h / 1000} = ${f(L * W / 100 * h / 1000, 4)}\\) m³.`,
          `Flow: \\(Q = ${f(Q / 60000, 4)}\\) m³ s⁻¹.`,
          `\\(t_{\\text{res}} = LWh/Q = ${f(t)}\\) s (Eq. 5.4.3).`)
      };
    }
  },
  {
    id: 'hy-pump-power', title: 'Electrical power of a pump', lesson: 'hydraulic-design', difficulty: 1,
    gen(rng) {
      const Q = rand(rng, 100, 2000, 50), H = rand(rng, 0.5, 3, 0.1), eta = rand(rng, 5, 40, 1);
      const P = 998 * 9.81 * (Q / 3.6e6) * H / (eta / 100);
      return {
        q: `A pump delivers ${Q} L h⁻¹ against a total head of ${H} m with a wire-to-water efficiency of ${eta} %. What electrical power does it draw?`,
        answer: P, tol: 0.02, unit: 'W',
        solution: steps(
          `\\(Q = ${Q}/3.6\\times10^6 = ${f(Q / 3.6e6, 4)}\\) m³ s⁻¹.`,
          `\\(P_h = \\rho gQH = 998\\times9.81\\times${f(Q / 3.6e6, 4)}\\times${H} = ${f(P * eta / 100)}\\) W.`,
          `\\(P_{\\text{el}} = P_h/\\eta = ${f(P * eta / 100)}/${eta / 100} = ${f(P)}\\) W (Eq. 5.4.7); per day \\(${f(P * 24 / 1000, 3)}\\) kWh.`)
      };
    }
  },
  {
    id: 'hy-darcy', title: 'Pipe friction with Darcy–Weisbach and Swamee–Jain', lesson: 'hydraulic-design', difficulty: 3,
    gen(rng) {
      let Q, D, v, Re;
      do { Q = rand(rng, 2, 30, 0.5); D = rand(rng, 10, 32, 1); v = (Q / 60000) / (Math.PI * (D / 1000) ** 2 / 4); Re = v * (D / 1000) / 1.0e-6; } while (Re < 5000 || v > 2.5);
      const L = rand(rng, 2, 40, 1), eps = 0.0015, fr = sj(Re, eps / D), hf = fr * L / (D / 1000) * v * v / (2 * 9.81);
      return {
        q: `Water at 20 °C (ν = 1.0 × 10⁻⁶ m² s⁻¹) flows at ${Q} L min⁻¹ through ${L} m of plastic tube with an inner diameter of ${D} mm (roughness ε = 0.0015 mm). Calculate the friction head loss with Darcy–Weisbach and the Swamee–Jain friction factor.`,
        answer: hf, tol: 0.03, unit: 'm',
        solution: steps(
          `\\(v = Q/A = ${f(Q / 60000, 4)}/${f(Math.PI * (D / 1000) ** 2 / 4, 4)} = ${f(v)}\\) m s⁻¹; \\(Re = vD/\\nu = ${f(Re, 4)}\\) (turbulent).`,
          `\\(f = 0.25/[\\log_{10}(\\varepsilon/(3.7D) + 5.74/Re^{0.9})]^2 = ${f(fr, 4)}\\) (Eq. 5.4.5).`,
          `\\(h_f = f(L/D)v^2/2g = ${f(fr, 4)}\\times(${L}/${D / 1000})\\times${f(v * v / 19.62, 4)} = ${f(hf)}\\) m.`)
      };
    }
  },
  {
    id: 'hy-hazen', title: 'Friction in a main with Hazen–Williams', lesson: 'hydraulic-design', difficulty: 2,
    gen(rng) {
      let Q, D; do { Q = rand(rng, 0.5, 6, 0.1); D = pick(rng, [32, 40, 50, 63, 75, 90, 110]); } while ((Q / 1000) / (Math.PI * (D / 1000) ** 2 / 4) > 2.5 || (Q / 1000) / (Math.PI * (D / 1000) ** 2 / 4) < 0.4);
      const L = rand(rng, 20, 300, 10), C = pick(rng, [130, 140, 150]);
      const hf = 10.67 * L * Math.pow(Q / 1000, 1.852) / (Math.pow(C, 1.852) * Math.pow(D / 1000, 4.87));
      return {
        q: `A greenhouse supply main of ${L} m, inner diameter ${D} mm and Hazen–Williams coefficient C = ${C}, carries ${Q} L s⁻¹. Estimate the friction head loss.`,
        answer: hf, tol: 0.02, unit: 'm',
        solution: steps(
          `SI units: \\(Q = ${f(Q / 1000, 4)}\\) m³ s⁻¹, \\(D = ${D / 1000}\\) m.`,
          `\\(h_f = 10.67\\,L\\,Q^{1.852}/(C^{1.852}D^{4.87})\\) (Eq. 5.4.6).`,
          `\\(= 10.67\\times${L}\\times${f(Math.pow(Q / 1000, 1.852), 4)}/(${f(Math.pow(C, 1.852), 4)}\\times${f(Math.pow(D / 1000, 4.87), 4)}) = ${f(hf)}\\) m.`)
      };
    }
  },
  {
    id: 'hy-total-head', title: 'Total dynamic head with fittings', lesson: 'hydraulic-design', difficulty: 2,
    gen(rng) {
      const dz = rand(rng, 0.3, 2, 0.05), D = pick(rng, [10, 13, 16, 20]), Q = rand(rng, 2, 15, 0.5), hf = rand(rng, 0.03, 0.5, 0.01);
      const nb = randInt(rng, 1, 6), K = 0.5 + nb * 0.9 + 2.0 + 1.0;
      const v = (Q / 60000) / (Math.PI * (D / 1000) ** 2 / 4), hm = K * v * v / 19.62, H = dz + hf + hm;
      return {
        q: `A pump lifts ${Q} L min⁻¹ through ${D} mm tube from a reservoir to an open channel ${dz} m above the water level. The straight-pipe friction loss is ${hf} m. Fittings: a sharp entrance (K = 0.5), ${nb} threaded 90° bends (K = 0.9 each), a tee in branch flow (K = 2.0) and the exit (K = 1.0). What total dynamic head must the pump supply?`,
        answer: H, tol: 0.02, unit: 'm',
        solution: steps(
          `\\(v = ${f(Q / 60000, 4)}/${f(Math.PI * (D / 1000) ** 2 / 4, 4)} = ${f(v)}\\) m s⁻¹; \\(v^2/2g = ${f(v * v / 19.62, 4)}\\) m.`,
          `\\(\\sum K = 0.5 + ${nb}\\times0.9 + 2.0 + 1.0 = ${f(K, 4)}\\); \\(h_m = ${f(K, 4)}\\times${f(v * v / 19.62, 4)} = ${f(hm)}\\) m.`,
          `\\(H = \\Delta z + h_f + h_m = ${dz} + ${hf} + ${f(hm)} = ${f(H)}\\) m (Eq. 5.4.4).`)
      };
    }
  },
  {
    id: 'hy-emitter', title: 'Emitter flow change with pressure', lesson: 'hydraulic-design', difficulty: 2,
    gen(rng) {
      const x = pick(rng, [0.1, 0.5, 0.55, 0.7, 1.0]), dH = pick(rng, [-30, -25, -20, -15, -10, 10, 20]);
      const dq = 100 * (Math.pow(1 + dH / 100, x) - 1);
      return {
        q: `A drip emitter has exponent x = ${x} in \\(q = kH^x\\). At the far end of the lateral the pressure is ${Math.abs(dH)} % ${dH < 0 ? 'lower' : 'higher'} than at the inlet. By what percentage does the far emitter's flow differ from the first one's? (Give a negative number for less flow.)`,
        answer: dq, abstol: 0.2, unit: '%',
        solution: steps(
          `\\(q_2/q_1 = (H_2/H_1)^x = ${f(1 + dH / 100, 3)}^{${x}} = ${f(Math.pow(1 + dH / 100, x), 4)}\\) (Eq. 5.4.8).`,
          `Change = ${f(dq, 3)} %. ${x <= 0.1 ? 'A pressure-compensating emitter hardly reacts.' : x >= 1 ? 'Laminar emitters react proportionally.' : 'Orifice-type emitters react with roughly the square root.'}`)
      };
    }
  },
  {
    id: 'hy-uniformity', title: 'Christiansen uniformity from a catch-can test', lesson: 'hydraulic-design', difficulty: 2,
    gen(rng) {
      const n = 8, base = rand(rng, 20, 40, 1);
      const qs = Array.from({ length: n }, () => Math.round(base * (1 + (rng() - 0.5) * 0.3)));
      const mean = qs.reduce((a, b) => a + b, 0) / n, dev = qs.reduce((a, b) => a + Math.abs(b - mean), 0);
      const cu = 100 * (1 - dev / (n * mean));
      return {
        q: `Eight drippers deliver (mL min⁻¹): ${qs.join(', ')}. Calculate Christiansen's uniformity coefficient CU.`,
        answer: cu, abstol: 0.3, unit: '%',
        solution: steps(
          `Mean \\(\\bar{q} = ${f(mean, 4)}\\) mL min⁻¹.`,
          `Sum of absolute deviations = ${f(dev, 4)}.`,
          `CU = \\(100\\,(1 - ${f(dev, 4)}/(8\\times${f(mean, 4)})) = ${f(cu)}\\) % (Eq. 5.4.8); ≥ 90 % is good.`)
      };
    }
  },
  {
    id: 'hy-leaching', title: 'Leaching fraction and supply from a salt balance', lesson: 'hydraulic-design', difficulty: 1,
    gen(rng) {
      const useEC = rng() < 0.5;
      if (useEC) {
        const eci = rand(rng, 0.3, 1.5, 0.05), ecd = rand(rng, 2, 6, 0.1);
        return {
          q: `Irrigation water with EC ${eci} dS m⁻¹ (salts the crop hardly takes up) is applied to a field crop; at steady state the drainage water has EC ${ecd} dS m⁻¹. What is the leaching fraction (as %)?`,
          answer: 100 * eci / ecd, tol: 0.02, unit: '%',
          solution: steps(`Steady-state salt balance: \\(V_ic_i = V_dc_d\\), so LF = \\(V_d/V_i = \\text{EC}_i/\\text{EC}_d\\) (Eq. 5.4.10).`, `LF = ${eci}/${ecd} = ${f(eci / ecd, 3)} = ${f(100 * eci / ecd)} %.`)
        };
      }
      const ci = rand(rng, 0.2, 2.5, 0.1), cd = rand(rng, 4, 10, 0.5), vet = rand(rng, 1.5, 5, 0.1);
      const vi = vet / (1 - ci / cd);
      return {
        q: `Supply water brings ${ci} mmol L⁻¹ Na⁺, which the crop does not take up; the drain may contain at most ${cd} mmol L⁻¹. The crop uses ${vet} L m⁻² d⁻¹. How much solution must be supplied per square metre per day?`,
        answer: vi, tol: 0.02, unit: 'L m⁻² d⁻¹',
        solution: steps(`LF ≥ \\(c_i/c_d = ${ci}/${cd} = ${f(ci / cd, 3)}\\).`, `\\(V_i = V_{ET}/(1-\\text{LF}) = ${vet}/${f(1 - ci / cd, 3)} = ${f(vi)}\\) L m⁻² d⁻¹ (Eq. 5.4.10).`)
      };
    }
  },
  {
    id: 'hy-reservoir', title: 'Reservoir buffer volume between top-ups', lesson: 'hydraulic-design', difficulty: 3,
    gen(rng) {
      const n = randInt(rng, 12, 60), u = rand(rng, 0.1, 0.35, 0.01), dt = pick(rng, [1, 2, 3]), d = pick(rng, [0.1, 0.15, 0.2]), rho = pick(rng, [0, 0.7, 0.8, 0.9]);
      const E = n * u, Vb = E * dt * (1 + d - rho) / d;
      return {
        q: `${n} plants each take up ${u} L of water per day. You top up every ${dt} day${dt > 1 ? 's' : ''} and accept a ${Math.round(d * 100)} % concentration rise between top-ups for a solute whose uptake ratio \\(\\rho_u = c_u/c\\) is ${rho}. What buffer volume must the reservoir hold (Eq. 5.4.9)?`,
        answer: Vb, tol: 0.02, unit: 'L',
        solution: steps(
          `Uptake between top-ups: \\(E\\Delta t = ${f(E)}\\times${dt} = ${f(E * dt)}\\) L.`,
          `\\(V_{\\text{buf}} = E\\Delta t\\,(1+\\delta-\\rho_u)/\\delta = ${f(E * dt)}\\times(1+${d}-${rho})/${d} = ${f(Vb)}\\) L.`,
          `${rho === 0 ? 'For an ion the crop ignores (Na⁺, Cl⁻) the buffer must be large.' : 'Because the crop also removes nutrients, EC rises less than for ignored ions.'}`)
      };
    }
  },
  {
    id: 'hy-mcq-concepts', title: 'Hydroponics concepts', lesson: 'root-zone', difficulty: 1,
    gen(rng) {
      const items = [
        ['Why must a Kratky tank never be topped up during the crop?', 'Raising the level drowns the "oxygen roots" that grow in the humid air gap', ['Fresh water would dilute the nutrients too much', 'The EC meter would stop working', 'Tap water contains chlorine that kills roots'], 'Kratky (2009): the falling level opens a humid air space where roots take up oxygen; submerging them causes hypoxia.'],
        ['A hydroponic lettuce wilts at midday although its roots are in solution. What is the most likely cause?', 'Root hypoxia or root rot reducing root water uptake', ['Too little water in the tank', 'Too much light on the roots', 'The solution EC is too low'], 'Hypoxic roots close their aquaporins (Tournaire-Roux et al., 2003); Pythium destroys root tissue. Check DO, temperature and root colour.'],
        ['Which change lowers the risk of Pythium root rot in hydroponic lettuce?', 'Keeping the solution at about 20–24 °C with good aeration', ['Warming the solution to 30 °C to speed up growth', 'Stopping aeration at night', 'Sharing tools between all tanks'], 'Warm, poorly aerated solution favours P. aphanidermatum and stresses roots (Mattson, 2018).'],
        ['What does the ion balance of a calculated recipe tell you?', 'Whether you made a bookkeeping error, because any mixture of real salts is electrically neutral', ['The EC of the solution', 'Whether gypsum will precipitate', 'The pH of the solution'], 'Every salt is neutral, so a calculated recipe must balance; an imbalance reveals an error.'],
        ['In an NFT channel you double the flow. What happens to the film?', 'It becomes about 26 % deeper and about 59 % faster', ['It becomes twice as deep', 'Its depth is unchanged', 'It becomes turbulent'], 'Eq. 5.4.2: h ∝ Q^(1/3), ū ∝ Q^(2/3).'],
        ['Which quantity decides the flow a centrifugal pump actually delivers?', 'The intersection of the pump curve and the system curve', ['The maximum flow on the box', 'The pump\'s electrical power', 'The reservoir volume'], 'The pump settles at the operating point (Eq. 5.4.7).']
      ];
      const [q, c, w, s] = pick(rng, items);
      return mcq(rng, q, c, w, `<p>${s}</p>`);
    }
  }
];
