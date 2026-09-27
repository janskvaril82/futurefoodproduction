/* ==========================================================================
   Practice generators — Module 2: Plant physiology for controlled environments
   Lessons: photosynthesis (2.1), water-relations (2.2), mineral-nutrition (2.3),
            growth-analysis (2.4)
   Every generator returns a fresh, randomised, auto-marked problem.
   Shared relationships come from /assets/js/physics.js (non-rectangular hyperbola,
   saturation vapour pressure, R, F) so that lessons, labs and practice agree.
   Constants used below and where they come from:
     477 kJ per mol CH2O stored (Lesson 2.1, Eq. 2.1.4; Zhu et al. 2010)
     Γ* temperature function of Bernacchi et al. (2001) (Lesson 2.1, Eq. 2.1.10)
     van 't Hoff Ψs = −cRT (Lesson 2.2, Eq. 2.2.2); E = g·VPD/P (Eq. 2.2.6)
     Nernst, charge balance, uptake concentration, Mitscherlich (Lesson 2.3)
     RGR, NAR (Williams 1946), Beer–Lambert, Monteith, expolinear (Lesson 2.4)
   ========================================================================== */
import { rand, randInt, pick, f, steps, mcq } from './helpers.js';
import { nonRectHyperbola, svp, R, F } from '../physics.js';

/* ---------- local helpers ---------- */
// number formatting for use INSIDE KaTeX (no thousands separators, scientific notation as \times10^{n})
const m = (v, s = 3) => {
  if (!isFinite(v)) return '\\text{—}';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) { const e = Math.floor(Math.log10(a)); return `${(v / 10 ** e).toPrecision(s)}\\times10^{${e}}`; }
  return String(+v.toPrecision(s));
};
const K0 = 273.15;
const gStar = T => Math.exp(19.02 - 37.83 / (0.008314 * (T + K0)));   // µmol mol⁻¹, Bernacchi et al. (2001)
const IONS = [
  { lab: 'K⁺', tex: '\\text{K}^+', z: 1, cin: 100, out: [0.05, 10] },
  { lab: 'Na⁺', tex: '\\text{Na}^+', z: 1, cin: 10, out: [0.5, 20] },
  { lab: 'Ca²⁺', tex: '\\text{Ca}^{2+}', z: 2, cin: 0.0002, out: [0.5, 5] },
  { lab: 'NO₃⁻', tex: '\\text{NO}_3^-', z: -1, cin: 4, out: [0.5, 15] },
  { lab: 'Cl⁻', tex: '\\text{Cl}^-', z: -1, cin: 10, out: [0.2, 5] }
];
const ELEMENTS = [
  { el: 'N', M: 14.007, x: [3.5, 5.0] }, { el: 'K', M: 39.098, x: [3.0, 7.0] }, { el: 'Ca', M: 40.078, x: [0.5, 1.5] },
  { el: 'Mg', M: 24.305, x: [0.2, 0.5] }, { el: 'P', M: 30.974, x: [0.4, 0.8] }
];
const nernst = (co, ci, z, T) => 1000 * R * (T + K0) / (z * F) * Math.log(co / ci);   // mV

export default [
  /* ======================= 2.1 photosynthesis ======================= */
  {
    id: 'ps-energy-efficiency', title: 'Quantum requirement and energy-conversion efficiency', lesson: 'photosynthesis', difficulty: 1,
    gen(rng) {
      const nq = rand(rng, 8, 20, 0.1);
      const src = pick(rng, [{ name: 'sunlight (PAR)', k: 4.57 }, { name: 'a red LED at 660 nm', k: +(0.008359 * 660).toFixed(2) }, { name: 'a blue LED at 450 nm', k: +(0.008359 * 450).toFixed(2) }]);
      const eta = 100 * (1 / nq) * 477000 * src.k * 1e-6;
      return {
        q: `A leaf needs ${nq} absorbed photons per CO₂ fixed. The light is ${src.name}, which contains ${src.k} µmol of photons per joule. What percentage of the absorbed light energy can at most be stored as carbohydrate (477 kJ per mol CH₂O)?`,
        answer: eta, tol: 0.02, unit: '%',
        solution: steps(
          `Quantum yield: \\(\\Phi = 1/n_q = 1/${nq} = ${m(1 / nq, 4)}\\) mol CO₂ per mol photons.`,
          `Energy efficiency (Eq. 2.1.4): \\(\\eta = \\Phi\\,\\Delta G_{\\text{CH}_2\\text{O}}\\,\\kappa = ${m(1 / nq, 4)}\\times477\\,000\\ \\text{J mol}^{-1}\\times${src.k}\\times10^{-6}\\ \\text{mol J}^{-1} = ${m(eta / 100, 3)}\\).`,
          `That is ${f(eta)} % of the absorbed light energy. Red photons carry less energy each, so the same quantum yield stores a larger fraction of red-light energy than of blue-light energy.`)
      };
    }
  },
  {
    id: 'ps-co2-to-sugar', title: 'From CO₂ uptake rate to grams of carbohydrate', lesson: 'photosynthesis', difficulty: 1,
    gen(rng) {
      const A = rand(rng, 5, 30, 0.5), h = rand(rng, 12, 20, 1);
      const g = A * h * 3600 * 1e-6 * 30;
      return {
        q: `A lettuce canopy has a net CO₂ uptake of ${A} µmol m⁻² s⁻¹ during a ${h} h photoperiod. How many grams of carbohydrate (CH₂O, 30 g mol⁻¹) does it fix per m² per day?`,
        answer: g, tol: 0.02, unit: 'g CH₂O m⁻² d⁻¹',
        solution: steps(
          `Moles of CO₂ per day: \\(${A}\\times10^{-6}\\ \\text{mol m}^{-2}\\text{s}^{-1}\\times${h}\\times3600\\ \\text{s} = ${m(A * h * 3600e-6, 4)}\\) mol m⁻² d⁻¹.`,
          `Each mole of CO₂ becomes one CH₂O unit of 30 g: \\(${m(A * h * 3600e-6, 4)}\\times30 = ${m(g)}\\) g m⁻² d⁻¹ (Eq. 2.1.1).`)
      };
    }
  },
  {
    id: 'ps-nrh-assimilation', title: 'Net assimilation from a light-response curve', lesson: 'photosynthesis', difficulty: 2,
    gen(rng) {
      const I = rand(rng, 100, 1200, 50), phi = rand(rng, 0.04, 0.06, 0.005), Pmax = rand(rng, 12, 35, 1), th = rand(rng, 0.6, 0.9, 0.05), Rd = rand(rng, 0.5, 2, 0.1);
      const b = phi * I + Pmax, disc = b * b - 4 * th * phi * I * Pmax, P = (b - Math.sqrt(disc)) / (2 * th);
      const A = nonRectHyperbola(I, phi, Pmax, th, Rd);
      return {
        q: `A leaf follows the non-rectangular hyperbola with quantum yield φ = ${phi}, P<sub>max</sub> = ${Pmax} µmol m⁻² s⁻¹, curvature θ = ${th} and day respiration R<sub>d</sub> = ${Rd} µmol m⁻² s⁻¹. What is its net CO₂ assimilation at a PPFD of ${I} µmol m⁻² s⁻¹?`,
        answer: A, tol: 0.02, unit: 'µmol m⁻² s⁻¹',
        solution: steps(
          `\\(b = \\phi I + P_{\\max} = ${m(phi * I, 4)} + ${Pmax} = ${m(b, 4)}\\).`,
          `\\(b^2 - 4\\theta\\phi IP_{\\max} = ${m(b * b, 5)} - ${m(4 * th * phi * I * Pmax, 5)} = ${m(disc, 4)}\\); square root \\(= ${m(Math.sqrt(disc), 4)}\\).`,
          `Gross photosynthesis \\(P = (b-\\sqrt{\\cdot})/(2\\theta) = ${m(P, 4)}\\); net \\(A = P - R_d = ${m(A, 4)}\\) µmol m⁻² s⁻¹ (Eq. 2.1.6).`)
      };
    }
  },
  {
    id: 'ps-light-compensation', title: 'Light compensation point of a leaf', lesson: 'photosynthesis', difficulty: 2,
    gen(rng) {
      const phi = rand(rng, 0.04, 0.065, 0.005), Pmax = rand(rng, 12, 35, 1), th = rand(rng, 0.6, 0.9, 0.05), Rd = rand(rng, 0.5, 2.5, 0.1);
      const Ic = Rd * (Pmax - th * Rd) / (phi * (Pmax - Rd));
      return {
        q: `A leaf has φ = ${phi}, P<sub>max</sub> = ${Pmax} µmol m⁻² s⁻¹, θ = ${th} and R<sub>d</sub> = ${Rd} µmol m⁻² s⁻¹. At what PPFD does its net CO₂ exchange become zero (the light compensation point)?`,
        answer: Ic, tol: 0.02, unit: 'µmol m⁻² s⁻¹',
        solution: steps(
          `At compensation gross photosynthesis equals respiration, \\(P = R_d\\). Substituting into the hyperbola gives \\(I_c = \\dfrac{R_d(P_{\\max}-\\theta R_d)}{\\phi(P_{\\max}-R_d)}\\) (Eq. 2.1.7).`,
          `\\(I_c = \\dfrac{${Rd}\\times(${Pmax} - ${m(th * Rd, 4)})}{${phi}\\times(${Pmax} - ${Rd})} = \\dfrac{${m(Rd * (Pmax - th * Rd), 4)}}{${m(phi * (Pmax - Rd), 4)}} = ${m(Ic)}\\) µmol m⁻² s⁻¹.`)
      };
    }
  },
  {
    id: 'ps-vo-vc', title: 'Oxygenation-to-carboxylation ratio from Γ*', lesson: 'photosynthesis', difficulty: 1,
    gen(rng) {
      const C = rand(rng, 150, 900, 10);
      const phi = 2 * 42.75 / C;
      return {
        q: `At 25 °C the CO₂ photocompensation point is Γ* = 42.75 µmol mol⁻¹. What is the ratio of Rubisco oxygenation to carboxylation, v<sub>o</sub>/v<sub>c</sub>, when the CO₂ concentration at Rubisco is ${C} µmol mol⁻¹?`,
        answer: phi, tol: 0.02, unit: '',
        solution: steps(
          `\\(\\phi = v_o/v_c = 2\\Gamma^*/C = 2\\times42.75/${C} = ${m(phi)}\\) (Eq. 2.1.5).`,
          `Two oxygenations release one CO₂, so the fraction of the carbon fixed that is lost again is \\(\\Gamma^*/C = ${m(42.75 / C)}\\) — ${f(100 * 42.75 / C)} %.`)
      };
    }
  },
  {
    id: 'ps-photorespiration-temperature', title: 'Photorespiratory loss at a given leaf temperature', lesson: 'photosynthesis', difficulty: 2,
    gen(rng) {
      const T = rand(rng, 15, 38, 1), C = rand(rng, 200, 1000, 10);
      const g = gStar(T), loss = 100 * g / C;
      return {
        q: `Using the temperature function of Bernacchi et al. (2001), \\(\\Gamma^* = \\exp(19.02 - 37.83/(R\\,T_K))\\) with R = 0.008314 kJ mol⁻¹ K⁻¹, what percentage of the carboxylated carbon is lost again to photorespiration at a leaf temperature of ${T} °C and a CO₂ concentration at Rubisco of ${C} µmol mol⁻¹?`,
        answer: loss, tol: 0.02, unit: '%',
        solution: steps(
          `\\(T_K = ${T} + 273.15 = ${m(T + K0, 5)}\\) K; \\(37.83/(0.008314\\times${m(T + K0, 5)}) = ${m(37.83 / (0.008314 * (T + K0)), 5)}\\).`,
          `\\(\\Gamma^* = \\exp(19.02 - ${m(37.83 / (0.008314 * (T + K0)), 5)}) = ${m(g, 4)}\\) µmol mol⁻¹ (Eq. 2.1.10).`,
          `Loss \\(= \\Gamma^*/C = ${m(g, 4)}/${C} = ${m(g / C)}\\), i.e. ${f(loss)} %. Warmer leaves or lower CO₂ raise the loss — one reason for CO₂ enrichment.`)
      };
    }
  },

  /* ======================= 2.2 water relations ======================= */
  {
    id: 'wr-vant-hoff', title: 'Osmotic potential with the van \'t Hoff relation', lesson: 'water-relations', difficulty: 1,
    gen(rng) {
      const kind = pick(rng, ['sap', 'NaCl']);
      const T = rand(rng, 10, 30, 1);
      if (kind === 'sap') {
        const c = randInt(rng, 150, 600), psi = -c * 8.314 * (T + K0) / 1e6;
        return {
          q: `Cell sap has an osmolality of ${c} mmol L⁻¹. What is its osmotic potential at ${T} °C? (Enter a negative number.)`,
          answer: psi, tol: 0.02, unit: 'MPa',
          solution: steps(`\\(\\Psi_s = -c_sRT = -${c}\\ \\text{mol m}^{-3}\\times8.314\\times${m(T + K0, 5)} = ${m(psi * 1e6, 4)}\\) Pa \\(= ${m(psi)}\\) MPa (Eq. 2.2.2; 1 mmol L⁻¹ = 1 mol m⁻³).`)
        };
      }
      const c = randInt(rng, 10, 100), psi = -2 * c * 8.314 * (T + K0) / 1e6;
      return {
        q: `A grower accidentally adds ${c} mmol L⁻¹ of NaCl to a nutrient solution. By how much does this lower the osmotic potential of the solution at ${T} °C? (Enter the change as a negative number.)`,
        answer: psi, tol: 0.02, unit: 'MPa',
        solution: steps(
          `NaCl dissociates into Na⁺ and Cl⁻: \\(c_s = 2\\times${c} = ${2 * c}\\) mmol L⁻¹ of particles.`,
          `\\(\\Delta\\Psi_s = -${2 * c}\\times8.314\\times${m(T + K0, 5)}\\ \\text{Pa} = ${m(psi)}\\) MPa — the roots must lower their own water potential by this much to keep taking up water.`)
      };
    }
  },
  {
    id: 'wr-vpd', title: 'Vapour pressure deficit of air', lesson: 'water-relations', difficulty: 1,
    gen(rng) {
      const T = rand(rng, 16, 32, 0.5), RH = randInt(rng, 40, 90);
      const es = svp(T), D = es * (1 - RH / 100);
      return {
        q: `Air in a greenhouse is at ${T} °C and ${RH} % relative humidity. What is its vapour pressure deficit? Use \\(e_s = 0.6108\\exp\\bigl(17.27T/(T+237.3)\\bigr)\\) kPa.`,
        answer: D, tol: 0.02, unit: 'kPa',
        solution: steps(
          `\\(e_s(${T}) = 0.6108\\exp(17.27\\times${T}/${m(T + 237.3, 5)}) = ${m(es, 4)}\\) kPa (Eq. 2.2.5).`,
          `\\(\\text{VPD} = e_s(1 - \\text{RH}/100) = ${m(es, 4)}\\times${m(1 - RH / 100, 3)} = ${m(D)}\\) kPa.`)
      };
    }
  },
  {
    id: 'wr-transpiration', title: 'Leaf transpiration from conductance and leaf-to-air VPD', lesson: 'water-relations', difficulty: 2,
    gen(rng) {
      let Ta, Tl, RH, D;
      do { Ta = rand(rng, 18, 28, 0.5); Tl = Ta + rand(rng, -2, 2, 0.5); RH = randInt(rng, 50, 85); D = svp(Tl) - RH / 100 * svp(Ta); } while (D < 0.2);
      const g = rand(rng, 0.1, 0.5, 0.01), P = 101.3, E = 1000 * g * D / P;
      return {
        q: `A lettuce leaf at ${Tl} °C has a total conductance to water vapour of ${g} mol m⁻² s⁻¹. The air is at ${Ta} °C and ${RH} % RH; air pressure 101.3 kPa. Calculate the transpiration rate.`,
        answer: E, tol: 0.02, unit: 'mmol m⁻² s⁻¹',
        solution: steps(
          `Leaf-to-air VPD: \\(e_s(T_{\\text{leaf}}) - e_a = ${m(svp(Tl), 4)} - ${m(RH / 100 * svp(Ta), 4)} = ${m(D, 4)}\\) kPa, with \\(e_a = \\text{RH}\\cdot e_s(T_{\\text{air}})\\).`,
          `\\(E = g\\,\\text{VPD}/P = ${g}\\times${m(D, 4)}/101.3 = ${m(E / 1000, 4)}\\) mol m⁻² s⁻¹ \\(= ${m(E)}\\) mmol m⁻² s⁻¹ (Eq. 2.2.6).`)
      };
    }
  },
  {
    id: 'wr-turgor', title: 'Equilibrium turgor of root cells in a nutrient solution', lesson: 'water-relations', difficulty: 2,
    gen(rng) {
      const cs = randInt(rng, 250, 500), cn = randInt(rng, 15, 40), T = rand(rng, 15, 25, 1);
      const RT = 8.314 * (T + K0), psiSol = -cn * RT / 1e6, psiCell = -cs * RT / 1e6, turgor = psiSol - psiCell;
      return {
        q: `Root cortex cells have an osmolality of ${cs} mmol L⁻¹; the nutrient solution has ${cn} mmol L⁻¹ of dissolved particles. At ${T} °C, what turgor pressure do the cells have when they are in equilibrium with the solution?`,
        answer: turgor, tol: 0.02, unit: 'MPa',
        solution: steps(
          `\\(RT = 8.314\\times${m(T + K0, 5)} = ${m(RT, 4)}\\) J mol⁻¹.`,
          `Solution: \\(\\Psi = \\Psi_s = -${cn}\\times${m(RT, 4)} = ${m(psiSol)}\\) MPa. Cells: \\(\\Psi_s = -${cs}\\times${m(RT, 4)} = ${m(psiCell)}\\) MPa.`,
          `At equilibrium \\(\\Psi_{\\text{cell}} = \\Psi_{\\text{solution}}\\), so \\(\\Psi_p = \\Psi - \\Psi_s = ${m(psiSol)} - (${m(psiCell)}) = ${m(turgor)}\\) MPa (Eq. 2.2.1).`)
      };
    }
  },
  {
    id: 'wr-daily-transpiration', title: 'Daily water use of a vertical-farm tier', lesson: 'water-relations', difficulty: 3,
    gen(rng) {
      const E = rand(rng, 0.8, 3, 0.1), LAI = rand(rng, 1.5, 4, 0.1), h = rand(rng, 12, 20, 1);
      const L = E * 1e-3 * 18.015 * 3600 * h * LAI / 1000, kwh = L * 2.45 / 3.6;
      return {
        q: `Lettuce leaves on a vertical-farm tier transpire on average ${E} mmol m⁻² (leaf) s⁻¹ during a ${h} h photoperiod; the canopy has a leaf area index of ${LAI}. Assuming all leaf area transpires at this rate and none at night, how many litres of water does one m² of tier release per day? (Water: 18.015 g mol⁻¹.)`,
        answer: L, tol: 0.02, unit: 'L m⁻² d⁻¹',
        solution: steps(
          `Per m² of ground: \\(E\\cdot\\text{LAI} = ${E}\\times${LAI} = ${m(E * LAI, 4)}\\) mmol s⁻¹.`,
          `Per day: \\(${m(E * LAI, 4)}\\times10^{-3}\\ \\text{mol s}^{-1}\\times18.015\\ \\text{g mol}^{-1}\\times${h}\\times3600\\ \\text{s} = ${m(L * 1000, 4)}\\) g \\(\\approx ${m(L)}\\) L m⁻² d⁻¹.`,
          `Bonus: at 2.45 MJ kg⁻¹ this water carries ${f(kwh)} kWh m⁻² d⁻¹ of latent heat that the air-conditioning must remove (Lesson 8.1).`)
      };
    }
  },

  /* ======================= 2.3 mineral nutrition ======================= */
  {
    id: 'mn-michaelis-menten', title: 'Nutrient uptake rate from Michaelis–Menten kinetics', lesson: 'mineral-nutrition', difficulty: 1,
    gen(rng) {
      const Jmax = rand(rng, 4, 15, 0.5), Km = randInt(rng, 10, 100), Cmin = rand(rng, 0, 5, 0.5);
      const C = randInt(rng, Math.ceil(Cmin) + 3, 300);
      const J = Jmax * (C - Cmin) / (Km + C - Cmin);
      return {
        q: `A root's nitrate uptake system has J<sub>max</sub> = ${Jmax} pmol cm⁻² s⁻¹, K<sub>m</sub> = ${Km} µM and C<sub>min</sub> = ${Cmin} µM. What is the net uptake rate at a nitrate concentration of ${C} µM at the root surface?`,
        answer: J, tol: 0.02, unit: 'pmol cm⁻² s⁻¹',
        solution: steps(
          `Excess over the threshold: \\(C - C_{\\min} = ${C} - ${Cmin} = ${m(C - Cmin, 4)}\\) µM.`,
          `\\(J = \\dfrac{J_{\\max}(C-C_{\\min})}{K_m + C - C_{\\min}} = \\dfrac{${Jmax}\\times${m(C - Cmin, 4)}}{${Km} + ${m(C - Cmin, 4)}} = ${m(J)}\\) pmol cm⁻² s⁻¹ (Eq. 2.3.4) — ${f(100 * J / Jmax)} % of J<sub>max</sub>.`)
      };
    }
  },
  {
    id: 'mn-lineweaver-burk', title: 'Km and Jmax from a Lineweaver–Burk line', lesson: 'mineral-nutrition', difficulty: 2,
    gen(rng) {
      const Jmax = rand(rng, 5, 15, 0.5), Km = randInt(rng, 10, 80);
      const a = +(1 / Jmax).toPrecision(4), b = +(Km / Jmax).toPrecision(4);
      const KmE = b / a;
      return {
        q: `A regression of 1/J on 1/C (J in pmol cm⁻² s⁻¹, C in µM) gives an intercept of ${a} cm² s pmol⁻¹ and a slope of ${b} µM cm² s pmol⁻¹. What Michaelis constant K<sub>m</sub> does this imply?`,
        answer: KmE, tol: 0.02, unit: 'µM',
        solution: steps(
          `Lineweaver–Burk: \\(1/J = (K_m/J_{\\max})(1/C) + 1/J_{\\max}\\) (Eq. 2.3.5).`,
          `\\(J_{\\max} = 1/\\text{intercept} = 1/${a} = ${m(1 / a)}\\) pmol cm⁻² s⁻¹; \\(K_m = \\text{slope}/\\text{intercept} = ${b}/${a} = ${m(KmE)}\\) µM.`,
          `Remember that this transformation magnifies the errors of low-concentration points — prefer a non-linear fit for real data.`)
      };
    }
  },
  {
    id: 'mn-nernst', title: 'Nernst potential of an ion across a root cell membrane', lesson: 'mineral-nutrition', difficulty: 2,
    gen(rng) {
      const ion = pick(rng, IONS), T = rand(rng, 10, 30, 1);
      const co = +(ion.out[0] * Math.pow(ion.out[1] / ion.out[0], rng())).toPrecision(2);
      const E = nernst(co, ion.cin, ion.z, T), slope = 1000 * Math.LN10 * R * (T + K0) / F;
      return {
        q: `The cytosol of a root cell contains ${ion.cin < 0.01 ? '200 nM (0.0002 mM)' : ion.cin + ' mM'} ${ion.lab}; the solution outside contains ${co} mM. What is the Nernst potential of ${ion.lab} at ${T} °C?`,
        answer: E, abstol: Math.max(0.6, 0.02 * Math.abs(E)), unit: 'mV',
        solution: steps(
          `Nernst slope at ${T} °C: \\(2.303RT/F = ${m(slope, 4)}\\) mV per decade; divide by \\(z = ${ion.z}\\).`,
          `\\(E_N = \\dfrac{${m(slope, 4)}}{${ion.z}}\\log_{10}\\dfrac{${co}}{${m(ion.cin)}} = \\dfrac{${m(slope, 4)}}{${ion.z}}\\times${m(Math.log10(co / ion.cin), 4)} = ${m(E)}\\) mV (Eq. 2.3.2).`)
      };
    }
  },
  {
    id: 'mn-passive-or-active', title: 'Passive or active uptake? The electrochemical driving force', lesson: 'mineral-nutrition', difficulty: 2,
    gen(rng) {
      const ion = pick(rng, IONS), T = 20, Em = randInt(rng, -200, -80);
      const co = +(ion.out[0] * Math.pow(ion.out[1] / ion.out[0], rng())).toPrecision(2);
      const E = nernst(co, ion.cin, ion.z, T), drive = ion.z * (Em - E);
      const passive = 'Passive influx is possible: the electrochemical gradient drives the ion into the cell (channels suffice).';
      const active = 'Uptake needs energy: the ion must be moved in against its electrochemical gradient (e.g., by H⁺-coupled symport).';
      const wrong3 = 'The concentration gradient alone decides: uptake is passive whenever there is more of the ion outside than inside.';
      const wrong4 = 'The ion is exactly in equilibrium, so there is no net movement.';
      return mcq(rng, `A root cell has a membrane potential of ${Em} mV at ${T} °C. The solution contains ${co} mM ${ion.lab}; the cytosol ${ion.cin < 0.01 ? '200 nM' : ion.cin + ' mM'}. Which statement is correct?`,
        drive < 0 ? passive : active, [drive < 0 ? active : passive, wrong3, wrong4],
        steps(
          `Nernst potential: \\(E_N = (58.2/${ion.z})\\log_{10}(${co}/${m(ion.cin)}) = ${m(E)}\\) mV.`,
          `Driving force: \\(z(E_m - E_N) = ${ion.z}\\times(${Em} - (${m(E)})) = ${m(drive)}\\) mV.`,
          drive < 0 ? 'Negative → the ion flows in passively (Eq. 2.3.2).' : 'Positive → passive flow would be <em>outwards</em>; uptake needs energy (Eq. 2.3.2). Note that the concentration gradient alone does not decide — the negative cell interior matters as much.'));
    }
  },
  {
    id: 'mn-charge-balance', title: 'Net proton release from the charge balance of uptake', lesson: 'mineral-nutrition', difficulty: 2,
    gen(rng) {
      const u = { NO3: rand(rng, 5, 20, 0.5), NH4: rand(rng, 0, 3, 0.1), K: rand(rng, 2, 8, 0.1), Ca: rand(rng, 0.5, 3, 0.1), Mg: rand(rng, 0.3, 1.5, 0.1), P: rand(rng, 0.3, 1.5, 0.1), S: rand(rng, 0.2, 1.2, 0.1) };
      const cat = u.NH4 + u.K + 2 * u.Ca + 2 * u.Mg, an = u.NO3 + u.P + 2 * u.S, H = cat - an;
      return {
        q: `In one day a tank of plants takes up (mmol): NO₃⁻ ${u.NO3}, NH₄⁺ ${u.NH4}, K⁺ ${u.K}, Ca²⁺ ${u.Ca}, Mg²⁺ ${u.Mg}, H₂PO₄⁻ ${u.P} and SO₄²⁻ ${u.S}. What is the net H⁺ release to the solution? (Enter a negative number if the roots release base, OH⁻/HCO₃⁻.)`,
        answer: H, abstol: 0.06, unit: 'mmol d⁻¹',
        solution: steps(
          `Cation charge: \\(${u.NH4} + ${u.K} + 2\\times${u.Ca} + 2\\times${u.Mg} = ${m(cat, 4)}\\) mmol.`,
          `Anion charge: \\(${u.NO3} + ${u.P} + 2\\times${u.S} = ${m(an, 4)}\\) mmol.`,
          `\\(H_{\\text{net}} = ${m(cat, 4)} - ${m(an, 4)} = ${m(H, 3)}\\) mmol d⁻¹ (Eq. 2.3.6). ${H < 0 ? 'The roots release base, so the pH rises and acid must be dosed.' : 'The roots release protons, so the pH falls.'}`)
      };
    }
  },
  {
    id: 'mn-uptake-concentration', title: 'Uptake concentration of a nutrient', lesson: 'mineral-nutrition', difficulty: 2,
    gen(rng) {
      const e = pick(rng, ELEMENTS), x = rand(rng, e.x[0], e.x[1], 0.01), TR = randInt(rng, 200, 500);
      const Cu = 10000 * x / (e.M * TR);
      return {
        q: `A lettuce crop contains ${x} % ${e.el} in its dry matter and transpires ${TR} L of water per kg of dry matter produced. At what concentration does it remove ${e.el} from the nutrient solution (its uptake concentration)? (M = ${e.M} g mol⁻¹.)`,
        answer: Cu, tol: 0.02, unit: 'mmol L⁻¹',
        solution: steps(
          `Per kg of dry matter: \\(${x}\\ \\%\\times1000\\ \\text{g} = ${m(10 * x, 4)}\\) g of ${e.el} \\(= ${m(10 * x / e.M, 4)}\\) mol.`,
          `\\(C_u = ${m(10 * x / e.M, 4)}\\ \\text{mol}/${TR}\\ \\text{L} = ${m(Cu / 1000, 4)}\\) mol L⁻¹ \\(= ${m(Cu)}\\) mmol L⁻¹ (Eq. 2.3.10).`,
          `If the replenishment solution contains more ${e.el} than this, ${e.el} accumulates in a recirculating system.`)
      };
    }
  },
  {
    id: 'mn-mitscherlich-optimum', title: 'Economic optimum fertiliser rate (Mitscherlich)', lesson: 'mineral-nutrition', difficulty: 3,
    gen(rng) {
      let A, c, b, r, x;
      do { A = rand(rng, 6000, 10000, 100); c = rand(rng, 0.012, 0.03, 0.001); b = randInt(rng, 20, 80); r = rand(rng, 3, 10, 0.5); x = Math.log(A * c / r) / c - b; } while (x < 20);
      const Y = A * (1 - Math.exp(-c * (x + b)));
      return {
        q: `A wheat trial is described by Y = A[1 − e<sup>−c(x+b)</sup>] with A = ${A} kg ha⁻¹, c = ${c} ha kg⁻¹ and b = ${b} kg N ha⁻¹. One kilogram of fertiliser N costs as much as ${r} kg of grain. What is the economic optimum N rate?`,
        answer: x, tol: 0.02, unit: 'kg N ha⁻¹',
        solution: steps(
          `Optimum where the marginal yield equals the price ratio: \\(\\mathrm dY/\\mathrm dx = Ace^{-c(x+b)} = p_x/p_Y = ${r}\\).`,
          `\\(x^* = \\dfrac{1}{c}\\ln\\dfrac{Ac}{p_x/p_Y} - b = \\dfrac{1}{${c}}\\ln\\dfrac{${A}\\times${c}}{${r}} - ${b} = ${m(1 / c, 4)}\\times${m(Math.log(A * c / r), 4)} - ${b} = ${m(x)}\\) kg N ha⁻¹ (Eq. 2.3.7).`,
          `Yield there: \\(${m(Y, 4)}\\) kg ha⁻¹, i.e. ${f(100 * Y / A)} % of the maximum.`)
      };
    }
  },
  {
    id: 'mn-symport-energetics', title: 'Energetics of 2 H⁺/NO₃⁻ symport', lesson: 'mineral-nutrition', difficulty: 3,
    gen(rng) {
      const Em = randInt(rng, -200, -100), pHo = rand(rng, 5.0, 6.2, 0.1), pHi = rand(rng, 7.1, 7.5, 0.1), co = pick(rng, [10, 20, 50, 100, 200, 500]), ci = rand(rng, 2, 8, 0.5);
      const RT = 8.314 * 293.15, Fk = 96485;
      const dN = RT * Math.log(ci * 1000 / co) - Fk * Em / 1000, dH = -2.302585 * RT * (pHi - pHo) + Fk * Em / 1000, dG = (dN + 2 * dH) / 1000;
      return {
        q: `At 20 °C a root cell has E<sub>m</sub> = ${Em} mV, cytosolic pH ${pHi} and apoplastic pH ${pHo}. It takes up nitrate from ${co} µM outside into a cytosol containing ${ci} mM, using a symporter that carries 2 H⁺ per NO₃⁻. What is the free-energy change of the transport per mole of nitrate? (Negative = downhill.)`,
        answer: dG, abstol: 0.3, unit: 'kJ mol⁻¹',
        solution: steps(
          `Nitrate (z = −1): \\(\\Delta\\tilde\\mu = RT\\ln(c_{\\text{in}}/c_{\\text{out}}) - FE_m = ${m(RT / 1000, 4)}\\ln(${m(ci * 1000 / co, 4)}) + ${m(-Fk * Em / 1e6, 4)} = ${m(dN / 1000, 4)}\\) kJ mol⁻¹.`,
          `Each proton: \\(\\Delta\\tilde\\mu_{\\text{H}^+} = -2.303RT(\\text{pH}_{\\text{in}}-\\text{pH}_{\\text{out}}) + FE_m = ${m(dH / 1000, 4)}\\) kJ mol⁻¹ (Eq. 2.3.3).`,
          `Total: \\(\\Delta G = ${m(dN / 1000, 4)} + 2\\times(${m(dH / 1000, 4)}) = ${m(dG)}\\) kJ mol⁻¹ ${dG < 0 ? '— downhill, so the symporter can work.' : '— uphill: even two protons are not enough under these conditions.'}`)
      };
    }
  },

  /* ======================= 2.4 growth analysis ======================= */
  {
    id: 'ga-rgr', title: 'Relative growth rate between two harvests', lesson: 'growth-analysis', difficulty: 1,
    gen(rng) {
      const W1 = rand(rng, 0.1, 2, 0.01), W2 = +(W1 * rand(rng, 1.5, 6, 0.1)).toFixed(2), dt = randInt(rng, 4, 14);
      const r = Math.log(W2 / W1) / dt;
      return {
        q: `Destructive harvests give geometric-mean plant dry masses (the exponential of the mean of ln W) of ${W1} g on day 0 and ${W2} g on day ${dt}. What is the mean relative growth rate?`,
        answer: r, tol: 0.02, unit: 'd⁻¹',
        solution: steps(
          `\\(\\text{RGR} = \\dfrac{\\ln W_2 - \\ln W_1}{t_2-t_1} = \\dfrac{\\ln(${W2}/${W1})}{${dt}} = \\dfrac{${m(Math.log(W2 / W1), 4)}}{${dt}} = ${m(r)}\\) d⁻¹ (Eq. 2.4.1).`,
          `Doubling time: \\(\\ln 2/\\text{RGR} = ${m(Math.LN2 / r)}\\) d.`)
      };
    }
  },
  {
    id: 'ga-doubling-time', title: 'Doubling time and relative growth rate', lesson: 'growth-analysis', difficulty: 1,
    gen(rng) {
      if (rng() < 0.5) {
        const r = rand(rng, 0.08, 0.35, 0.005), td = Math.LN2 / r;
        return { q: `A lettuce crop grows at a constant RGR of ${r} d⁻¹. How long does it take to double its mass?`, answer: td, tol: 0.02, unit: 'd', solution: steps(`\\(t_d = \\ln 2/\\text{RGR} = 0.6931/${r} = ${m(td)}\\) d (Eq. 2.4.1).`) };
      }
      const td = rand(rng, 2, 9, 0.1), r = Math.LN2 / td;
      return { q: `Seedlings double their dry mass every ${td} days. What is their relative growth rate?`, answer: r, tol: 0.02, unit: 'd⁻¹', solution: steps(`\\(\\text{RGR} = \\ln 2/t_d = 0.6931/${td} = ${m(r)}\\) d⁻¹ (Eq. 2.4.1).`) };
    }
  },
  {
    id: 'ga-rgr-components', title: 'RGR from NAR, SLA and LMR', lesson: 'growth-analysis', difficulty: 2,
    gen(rng) {
      const NAR = rand(rng, 3, 12, 0.1), SLA = randInt(rng, 200, 550), LMR = rand(rng, 0.6, 0.9, 0.01);
      const LAR = SLA * 1e-4 * LMR, r = NAR * LAR;
      return {
        q: `A plant has a net assimilation rate of ${NAR} g m⁻² d⁻¹, a specific leaf area of ${SLA} cm² g⁻¹ and a leaf mass ratio of ${LMR}. What is its relative growth rate?`,
        answer: r, tol: 0.02, unit: 'd⁻¹',
        solution: steps(
          `Convert SLA: \\(${SLA}\\ \\text{cm}^2\\,\\text{g}^{-1} = ${m(SLA * 1e-4, 4)}\\ \\text{m}^2\\,\\text{g}^{-1}\\).`,
          `\\(\\text{LAR} = \\text{SLA}\\times\\text{LMR} = ${m(SLA * 1e-4, 4)}\\times${LMR} = ${m(LAR, 4)}\\) m² g⁻¹.`,
          `\\(\\text{RGR} = \\text{NAR}\\times\\text{LAR} = ${NAR}\\times${m(LAR, 4)} = ${m(r)}\\) d⁻¹ (Eq. 2.4.2).`)
      };
    }
  },
  {
    id: 'ga-williams-nar', title: 'Mean net assimilation rate between harvests', lesson: 'growth-analysis', difficulty: 2,
    gen(rng) {
      const W1 = rand(rng, 0.5, 2, 0.01), W2 = +(W1 * rand(rng, 1.8, 3, 0.05)).toFixed(2), A1 = Math.round(W1 * rand(rng, 250, 400, 5)), A2 = Math.round(W2 * rand(rng, 250, 400, 5)), dt = randInt(rng, 5, 10);
      const NAR = (W2 - W1) / dt * Math.log(A2 / A1) / ((A2 - A1) * 1e-4);
      return {
        q: `Between two harvests ${dt} days apart, mean plant dry mass rose from ${W1} to ${W2} g and mean leaf area from ${A1} to ${A2} cm². Estimate the mean net assimilation rate.`,
        answer: NAR, tol: 0.02, unit: 'g m⁻² d⁻¹',
        solution: steps(
          `Absolute growth: \\((W_2-W_1)/\\Delta t = ${m(W2 - W1, 4)}/${dt} = ${m((W2 - W1) / dt, 4)}\\) g d⁻¹.`,
          `Logarithmic mean leaf area: \\((A_2-A_1)/\\ln(A_2/A_1) = ${m((A2 - A1) * 1e-4, 4)}/${m(Math.log(A2 / A1), 4)} = ${m((A2 - A1) * 1e-4 / Math.log(A2 / A1), 4)}\\) m².`,
          `\\(\\overline{\\text{NAR}} = ${m((W2 - W1) / dt, 4)}/${m((A2 - A1) * 1e-4 / Math.log(A2 / A1), 4)} = ${m(NAR)}\\) g m⁻² d⁻¹ (Eq. 2.4.3).`)
      };
    }
  },
  {
    id: 'ga-interception', title: 'Light intercepted by a canopy (Beer–Lambert)', lesson: 'growth-analysis', difficulty: 1,
    gen(rng) {
      const LAI = rand(rng, 0.5, 5, 0.1), k = rand(rng, 0.4, 0.9, 0.05);
      const fi = 100 * (1 - Math.exp(-k * LAI));
      return {
        q: `What percentage of the incident light does a canopy with a leaf area index of ${LAI} and an extinction coefficient of ${k} intercept?`,
        answer: fi, tol: 0.02, unit: '%',
        solution: steps(`\\(f_{\\text{int}} = 1 - e^{-k\\,\\text{LAI}} = 1 - e^{-${m(k * LAI, 4)}} = 1 - ${m(Math.exp(-k * LAI), 4)} = ${m(fi / 100, 4)}\\), i.e. ${f(fi)} % (Eq. 2.4.4).`)
      };
    }
  },
  {
    id: 'ga-lai-target', title: 'Leaf area per plant needed for a target interception', lesson: 'growth-analysis', difficulty: 2,
    gen(rng) {
      const fT = pick(rng, [0.8, 0.9, 0.95]), k = rand(rng, 0.5, 0.9, 0.05), rho = randInt(rng, 15, 60);
      const LAI = -Math.log(1 - fT) / k, Ap = LAI / rho * 1e4;
      return {
        q: `Lettuce is grown at ${rho} plants m⁻² with an extinction coefficient of ${k}. How much leaf area must each plant have for the canopy to intercept ${Math.round(fT * 100)} % of the light?`,
        answer: Ap, tol: 0.02, unit: 'cm² per plant',
        solution: steps(
          `Required LAI: \\(-\\ln(1-${fT})/${k} = ${m(-Math.log(1 - fT), 4)}/${k} = ${m(LAI, 4)}\\) (Eq. 2.4.4).`,
          `Per plant: \\(${m(LAI, 4)}\\ \\text{m}^2\\,\\text{m}^{-2}/${rho}\\ \\text{plants m}^{-2} = ${m(LAI / rho, 4)}\\) m² \\(= ${m(Ap)}\\) cm².`)
      };
    }
  },
  {
    id: 'ga-monteith-yield', title: 'Fresh yield from Monteith\'s equation', lesson: 'growth-analysis', difficulty: 2,
    gen(rng) {
      const eps = rand(rng, 0.5, 1.2, 0.05), fm = rand(rng, 0.4, 0.85, 0.05), S = rand(rng, 10, 25, 0.5), days = randInt(rng, 20, 35), HI = 0.85, dmc = rand(rng, 0.04, 0.06, 0.005);
      const W = eps * fm * S * days, Y = W * HI / dmc / 1000;
      return {
        q: `A lettuce crop receives a DLI of ${S} mol m⁻² d⁻¹ for ${days} days, intercepts on average ${Math.round(fm * 100)} % of it and converts intercepted photons at ${eps} g dry matter per mol. The harvest index is ${HI} and the heads contain ${(dmc * 100).toFixed(1)} % dry matter. What is the fresh yield?`,
        answer: Y, tol: 0.02, unit: 'kg m⁻²',
        solution: steps(
          `Dry matter (Eq. 2.4.5): \\(W = \\varepsilon\\,\\bar f\\,S\\,t = ${eps}\\times${fm}\\times${S}\\times${days} = ${m(W, 4)}\\) g m⁻².`,
          `Harvested: \\(${HI}\\times${m(W, 4)} = ${m(HI * W, 4)}\\) g m⁻²; fresh: \\(${m(HI * W, 4)}/${dmc} = ${m(HI * W / dmc, 4)}\\) g m⁻² \\(= ${m(Y)}\\) kg m⁻².`)
      };
    }
  },
  {
    id: 'ga-kwh-per-kg', title: 'Lighting electricity per kilogram of lettuce', lesson: 'growth-analysis', difficulty: 3,
    gen(rng) {
      const lue = rand(rng, 0.3, 1.5, 0.05), ppe = rand(rng, 2, 3.8, 0.1), dmc = rand(rng, 0.04, 0.06, 0.005);
      const kwh = 1000 * dmc / (3.6 * lue * ppe);
      return {
        q: `A vertical farm produces ${lue} g of shoot dry matter per mol of incident photons, using LEDs with a photon efficacy of ${ppe} µmol J⁻¹. The lettuce contains ${(dmc * 100).toFixed(1)} % dry matter. How much lighting electricity is needed per kg of fresh lettuce?`,
        answer: kwh, tol: 0.02, unit: 'kWh kg⁻¹',
        solution: steps(
          `Photons per kWh: \\(3.6\\times10^6\\ \\text{J}\\times${ppe}\\ \\mu\\text{mol J}^{-1} = ${m(3.6 * ppe, 4)}\\) mol.`,
          `Dry matter per kWh: \\(${m(3.6 * ppe, 4)}\\times${lue} = ${m(3.6 * ppe * lue, 4)}\\) g; fresh: \\(${m(3.6 * ppe * lue, 4)}/${dmc} = ${m(3.6 * ppe * lue / dmc, 4)}\\) g.`,
          `\\(1000/${m(3.6 * ppe * lue / dmc, 4)} = ${m(kwh)}\\) kWh kg⁻¹ (Eq. 2.4.6) — lighting only; cooling and dehumidification come on top.`)
      };
    }
  },
  {
    id: 'ga-expolinear', title: 'Crop mass from the expolinear growth equation', lesson: 'growth-analysis', difficulty: 3,
    gen(rng) {
      const S = rand(rng, 10, 22, 0.5), eps = rand(rng, 0.6, 1.1, 0.05), k = rand(rng, 0.6, 0.9, 0.05), SLA = randInt(rng, 300, 450), LMR = 0.85, rho = randInt(rng, 20, 40), w0 = rand(rng, 0.04, 0.1, 0.01), t = randInt(rng, 10, 25);
      const a = k * SLA * 1e-4 * LMR, W0 = rho * w0, cm = eps * S, rm = a * cm;
      const W = Math.log(1 + (Math.exp(a * W0) - 1) * Math.exp(rm * t)) / a;
      return {
        q: `Lettuce seedlings of ${w0} g dry mass are planted at ${rho} plants m⁻² (SLA ${SLA} cm² g⁻¹, leaf mass ratio ${LMR}, k = ${k}). The DLI is ${S} mol m⁻² d⁻¹ and intercepted photons are converted at ${eps} g mol⁻¹. Using the expolinear equation, what crop dry mass per m² is expected ${t} days after planting?`,
        answer: W, tol: 0.02, unit: 'g m⁻²',
        solution: steps(
          `\\(a = k\\,s\\,p_1 = ${k}\\times${m(SLA * 1e-4, 4)}\\times${LMR} = ${m(a, 4)}\\) m² g⁻¹; \\(W_0 = ${rho}\\times${w0} = ${m(W0, 4)}\\) g m⁻².`,
          `\\(c_m = \\varepsilon S = ${m(cm, 4)}\\) g m⁻² d⁻¹; \\(r_m = a\\,c_m = ${m(rm, 4)}\\) d⁻¹.`,
          `\\(W = \\dfrac{1}{a}\\ln\\!\\bigl[1 + (e^{aW_0}-1)e^{r_mt}\\bigr] = \\dfrac{1}{${m(a, 4)}}\\ln\\!\\bigl[1 + ${m(Math.exp(a * W0) - 1, 4)}\\times${m(Math.exp(rm * t), 4)}\\bigr] = ${m(W)}\\) g m⁻² (Eq. 2.4.8).`,
          `Lost time: \\(t_b = -\\ln(e^{aW_0}-1)/r_m = ${m(-Math.log(Math.exp(a * W0) - 1) / rm)}\\) d.`)
      };
    }
  }
];
