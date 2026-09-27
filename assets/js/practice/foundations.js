/* ==========================================================================
   Practice generators — Module 1: Food systems within planetary boundaries
   Lessons: food-system-challenge (1.1), planetary-boundaries (1.2),
            life-cycle-thinking (1.3), technology-landscape (1.4)
   Every generator returns a fresh, randomised, auto-marked problem.
   Equations and constants follow the lessons: IPCC AR6 GWP100 values
   (CO₂ 1, biogenic CH₄ 27.0, fossil CH₄ 29.8, N₂O 273), Poore & Nemecek
   (2018) mean footprints, Richardson et al. (2023) boundary values,
   te Wierik et al. (2025) food-system boundaries, EU TRL definitions.
   ========================================================================== */
import { rand, randInt, pick, f, steps, mcq } from './helpers.js';

/* ---------- local helpers ---------- */
/** Number formatted for use inside \( … \): no thousands commas, scientific form for very large/small values. */
function fm(v, sig = 3) {
  if (!isFinite(v)) return '\\text{—}';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) { const e = Math.floor(Math.log10(a)); return `${(v / 10 ** e).toPrecision(sig)}\\times10^{${e}}`; }
  return String(+v.toPrecision(sig));
}
/** Standard normal CDF (Abramowitz & Stegun 7.1.26 erf approximation, |error| < 1.5e-7). */
function normCdf(z) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}
const GWP = { ch4b: 27.0, ch4f: 29.8, n2o: 273 };
/* Poore & Nemecek (2018) means via Our World in Data (as in Lesson 1.3): kg CO₂e per kg; protein g kg⁻¹ and energy kcal kg⁻¹ derived from their per-100 g protein and per-1000 kcal values */
const FOODS = [
  { n: 'beef (beef herd)', ghg: 99.48, prot: 199, kcal: 2730 },
  { n: 'lamb and mutton', ghg: 39.72, prot: 200, kcal: 3170 },
  { n: 'cheese', ghg: 23.88, prot: 221, kcal: 3870 },
  { n: 'pig meat', ghg: 12.31, prot: 162, kcal: 2390 },
  { n: 'poultry meat', ghg: 9.87, prot: 173, kcal: 1850 },
  { n: 'eggs', ghg: 4.67, prot: 111, kcal: 1440 },
  { n: 'milk', ghg: 3.15, prot: 33, kcal: 600 },
  { n: 'tofu', ghg: 3.16, prot: 160, kcal: 2710 },
  { n: 'peas', ghg: 0.98, prot: 222, kcal: 3460 },
  { n: 'groundnuts', ghg: 3.23, prot: 262, kcal: 5800 },
  { n: 'wheat & rye (bread)', ghg: 1.57, prot: 122, kcal: 2675 }
];

export default [
  /* ======================= 1.1 Feeding ten billion ======================= */
  {
    id: 'fd-exp-projection', title: 'Exponential population projection', lesson: 'food-system-challenge', difficulty: 1,
    gen(rng) {
      const N0 = rand(rng, 7.8, 8.4, 0.1), g = rand(rng, 0.4, 1.6, 0.05), t = randInt(rng, 10, 40);
      const N = N0 * Math.exp(g / 100 * t);
      return {
        q: `The world population is ${N0} billion today and grows at a constant continuous rate of r = ${g} % per year. What would it be after ${t} years according to the exponential model?`,
        answer: N, tol: 0.01, unit: 'billion',
        solution: steps(
          `Exponential growth (Eq. 1.1.1): \\(N(t) = N_0\\,e^{rt}\\) with \\(r = ${g / 100}\\) yr⁻¹.`,
          `Exponent: \\(rt = ${g / 100}\\times${t} = ${fm(g / 100 * t, 4)}\\), so \\(e^{rt} = ${fm(Math.exp(g / 100 * t), 4)}\\).`,
          `\\(N = ${N0}\\times${fm(Math.exp(g / 100 * t), 4)} = ${fm(N, 4)}\\) billion.`,
          `The UN projects a peak instead (about 10.3 billion in the 2080s), because fertility and hence \\(r\\) keep falling — exponential projections over decades overshoot.`)
      };
    }
  },
  {
    id: 'fd-doubling-time', title: 'Doubling time and the rule of 70', lesson: 'food-system-challenge', difficulty: 1,
    gen(rng) {
      const g = rand(rng, 0.3, 3.0, 0.1);
      const td = Math.log(2) / (g / 100);
      return {
        q: `A population grows at a constant continuous rate of ${g} % per year. What is its doubling time?`,
        answer: td, tol: 0.02, unit: 'years',
        solution: steps(
          `Doubling time (Eq. 1.1.2): \\(t_d = \\ln 2/r\\).`,
          `\\(t_d = 0.6931/${fm(g / 100, 3)} = ${fm(td, 4)}\\) years.`,
          `Rule of 70 check: \\(70/${g} = ${fm(70 / g, 3)}\\) years ✓.`)
      };
    }
  },
  {
    id: 'fd-growth-rate', title: 'Growth rate from two census counts', lesson: 'food-system-challenge', difficulty: 2,
    gen(rng) {
      const N0 = rand(rng, 5, 120, 0.1), rTrue = rand(rng, 0.2, 3.0, 0.1) / 100, dt = randInt(rng, 5, 30);
      const N1 = +(N0 * Math.exp(rTrue * dt)).toFixed(1);
      const r = Math.log(N1 / N0) / dt * 100;
      return {
        q: `A country's population grew from ${N0} million to ${N1} million in ${dt} years. Assuming exponential growth, what was the average continuous growth rate?`,
        answer: r, tol: 0.02, unit: '% per year',
        solution: steps(
          `Rearrange Eq. 1.1.1: \\(r = \\ln(N_1/N_0)/\\Delta t\\).`,
          `\\(N_1/N_0 = ${N1}/${N0} = ${fm(N1 / N0, 5)}\\); \\(\\ln(${fm(N1 / N0, 5)}) = ${fm(Math.log(N1 / N0), 4)}\\).`,
          `\\(r = ${fm(Math.log(N1 / N0), 4)}/${dt} = ${fm(r / 100, 4)}\\) yr⁻¹ = ${fm(r, 3)} % per year.`,
          `Doubling time at this rate: \\(69.3/${fm(r, 3)} = ${fm(69.3 / r, 3)}\\) years.`)
      };
    }
  },
  {
    id: 'fd-logistic', title: 'Logistic population projection', lesson: 'food-system-challenge', difficulty: 2,
    gen(rng) {
      const K = rand(rng, 9.6, 12, 0.1), rm = rand(rng, 2.5, 6, 0.1), N0 = 8.2, t = randInt(rng, 10, 60);
      const N = K / (1 + ((K - N0) / N0) * Math.exp(-rm / 100 * t));
      return {
        q: `Model world population with a logistic curve: \\(N_0 = 8.2\\) billion (2024), carrying capacity \\(K = ${K}\\) billion and intrinsic rate \\(r_{\\max} = ${rm}\\) % per year. What population does the model give ${t} years later?`,
        answer: N, tol: 0.01, unit: 'billion',
        solution: steps(
          `Logistic solution (Eq. 1.1.3): \\(N(t) = K/\\left[1 + \\frac{K-N_0}{N_0}e^{-r_{\\max}t}\\right]\\).`,
          `\\((K-N_0)/N_0 = (${K}-8.2)/8.2 = ${fm((K - N0) / N0, 4)}\\); \\(e^{-r_{\\max}t} = e^{-${fm(rm / 100 * t, 4)}} = ${fm(Math.exp(-rm / 100 * t), 4)}\\).`,
          `\\(N = ${K}/(1 + ${fm((K - N0) / N0, 4)}\\times${fm(Math.exp(-rm / 100 * t), 4)}) = ${fm(N, 4)}\\) billion.`,
          `Check: the result must lie between \\(N_0\\) and \\(K\\) ✓.`)
      };
    }
  },
  {
    id: 'fd-crop-calories', title: 'Crop calories needed to feed a population', lesson: 'food-system-challenge', difficulty: 2,
    gen(rng) {
      const P = rand(rng, 8, 10.2, 0.1), E = rand(rng, 2200, 2600, 50), eta = rand(rng, 0.35, 0.55, 0.01);
      const eaten = P * 1e9 * E * 365, crop = eaten / eta;
      return {
        q: `In 2050, ${P} billion people each eat on average ${E} kcal per day. Only ${Math.round(eta * 100)} % of harvested crop calories are eaten (the rest goes to feed conversion, biofuels, losses and waste). How many crop calories must be harvested per year? Give the answer in units of 10¹⁵ kcal.`,
        answer: crop / 1e15, tol: 0.02, unit: '× 10¹⁵ kcal yr⁻¹',
        solution: steps(
          `Calories eaten per year: \\(${P}\\times10^{9}\\times${E}\\times365 = ${fm(eaten, 4)}\\) kcal.`,
          `Divide by the chain efficiency (Eq. 1.1.8): \\(${fm(eaten, 4)}/${eta} = ${fm(crop, 4)}\\) kcal yr⁻¹.`,
          `= ${fm(crop / 1e15, 4)} × 10¹⁵ kcal per year. Raising the chain efficiency (less waste, less feed) is as powerful as raising yields.`)
      };
    }
  },
  {
    id: 'fd-chain-efficiency', title: 'Calorie delivery efficiency of the food chain', lesson: 'food-system-challenge', difficulty: 2,
    gen(rng) {
      const sf = rand(rng, 0.45, 0.7, 0.01), sfe = rand(rng, 0.15, Math.min(0.4, 0.95 - sf), 0.01), ef = rand(rng, 0.08, 0.2, 0.01), L = rand(rng, 8, 18, 0.5), W = rand(rng, 10, 30, 1);
      const a = sf + sfe * ef, eta = a * (1 - L / 100) * (1 - W / 100);
      return {
        q: `Of the crop calories harvested in a region, ${Math.round(sf * 100)} % are used directly as food and ${Math.round(sfe * 100)} % as feed; animals return ${Math.round(ef * 100)} % of feed calories as food. ${L} % of food is lost before retail and ${W} % of what reaches consumers is wasted. What percentage of harvested crop calories is eaten?`,
        answer: 100 * eta, tol: 0.02, unit: '%',
        solution: steps(
          `Eq. 1.1.8: \\(\\eta = (s_{\\text{food}} + s_{\\text{feed}}\\,\\eta_{\\text{feed}})(1-L)(1-W)\\).`,
          `Food calories produced: \\(${sf} + ${sfe}\\times${ef} = ${fm(a, 4)}\\).`,
          `After loss and waste: \\(${fm(a, 4)}\\times${fm(1 - L / 100, 4)}\\times${fm(1 - W / 100, 3)} = ${fm(eta, 4)}\\), i.e. ${fm(100 * eta, 3)} %.`)
      };
    }
  },
  {
    id: 'fd-yield-gap', title: 'Exploitable yield gap', lesson: 'food-system-challenge', difficulty: 1,
    gen(rng) {
      const Yw = rand(rng, 5, 12, 0.1), fr = pick(rng, [0.75, 0.8, 0.85]);
      const Ya = +(Yw * rand(rng, 0.45, fr - 0.05, 0.01)).toFixed(1);
      const gap = fr * Yw - Ya;
      return {
        q: `A rain-fed wheat region has a simulated water-limited yield \\(Y_w = ${Yw}\\) t ha⁻¹ and an actual average yield \\(Y_a = ${Ya}\\) t ha⁻¹. Farmers can realistically reach ${Math.round(fr * 100)} % of \\(Y_w\\). What is the exploitable yield gap?`,
        answer: gap, abstol: 0.03, unit: 't ha⁻¹',
        solution: steps(
          `Full yield gap: \\(Y_w - Y_a = ${Yw} - ${Ya} = ${fm(Yw - Ya, 3)}\\) t ha⁻¹.`,
          `Attainable level: \\(${fr}\\times${Yw} = ${fm(fr * Yw, 4)}\\) t ha⁻¹.`,
          `Exploitable gap: \\(${fm(fr * Yw, 4)} - ${Ya} = ${fm(gap, 3)}\\) t ha⁻¹ — a relative production increase of \\(${fm(fr * Yw, 4)}/${Ya} - 1 = ${fm(100 * (fr * Yw / Ya - 1), 3)}\\) %.`)
      };
    }
  },
  {
    id: 'fd-yield-production', title: 'Extra production and land spared by closing a yield gap', lesson: 'food-system-challenge', difficulty: 2,
    gen(rng) {
      const A = randInt(rng, 50, 400), Yw = rand(rng, 6, 11, 0.1), fr = pick(rng, [0.8, 0.85]);
      const Ya = +(Yw * rand(rng, 0.5, fr - 0.08, 0.01)).toFixed(1);
      const dQ = A * 1000 * (fr * Yw - Ya), land = dQ / Ya;
      return {
        q: `A region farms ${A} 000 ha of maize with \\(Y_w = ${Yw}\\) t ha⁻¹ and \\(Y_a = ${Ya}\\) t ha⁻¹. If farmers reached ${Math.round(fr * 100)} % of \\(Y_w\\), how much extra maize would be produced per year (in kt)? (Bonus: how much land would that save if the extra maize had been grown elsewhere at \\(Y_a\\)?)`,
        answer: dQ / 1000, tol: 0.02, unit: 'kt yr⁻¹',
        solution: steps(
          `Eq. 1.1.7: \\(\\Delta Q = A\\,(f\\,Y_w - Y_a)\\).`,
          `\\(f\\,Y_w - Y_a = ${fr}\\times${Yw} - ${Ya} = ${fm(fr * Yw - Ya, 3)}\\) t ha⁻¹.`,
          `\\(\\Delta Q = ${fm(A * 1000, 3)}\\ \\text{ha}\\times${fm(fr * Yw - Ya, 3)} = ${fm(dQ, 4)}\\) t = ${fm(dQ / 1000, 4)} kt per year.`,
          `Bonus: \\(${fm(dQ, 4)}/${Ya} = ${fm(land, 3)}\\) ha of land at the current yield — but only if rebound does not expand production (Eq. 1.1.9).`)
      };
    }
  },
  {
    id: 'fd-ipat-target', title: 'IPAT: required change in impact intensity', lesson: 'food-system-challenge', difficulty: 2,
    gen(rng) {
      const P0 = 8.2, P1 = rand(rng, 9.2, 10.2, 0.1), a = rand(rng, -5, 25, 1), tgt = rand(rng, 0.3, 1.0, 0.05);
      const T = tgt / ((P1 / P0) * (1 + a / 100));
      return {
        q: `Food-system greenhouse-gas emissions should fall to ${Math.round(tgt * 100)} % of today's level by 2050. Population grows from 8.2 to ${P1} billion and food supplied per person changes by ${a > 0 ? '+' : ''}${a} %. By what percentage must emissions per unit of food change? (Give a signed number, e.g. −40 for a 40 % reduction.)`,
        answer: 100 * (T - 1), abstol: 0.6, unit: '%',
        solution: steps(
          `IPAT in ratio form (Eq. 1.1.5): \\(T_1/T_0 = (I_1/I_0)/[(P_1/P_0)(A_1/A_0)]\\).`,
          `\\(P_1/P_0 = ${P1}/8.2 = ${fm(P1 / P0, 4)}\\); \\(A_1/A_0 = ${fm(1 + a / 100, 3)}\\).`,
          `\\(T_1/T_0 = ${tgt}/(${fm(P1 / P0, 4)}\\times${fm(1 + a / 100, 3)}) = ${fm(T, 4)}\\): a change of ${fm(100 * (T - 1), 3)} %.`,
          `Because the identity is a product, changes in population and consumption must be offset multiplicatively by the technology term.`)
      };
    }
  },
  {
    id: 'fd-pou', title: 'Prevalence of undernourishment (lognormal model)', lesson: 'food-system-challenge', difficulty: 3,
    gen(rng) {
      const dec = rand(rng, 1900, 3200, 50), cv = rand(rng, 0.18, 0.4, 0.01), mder = rand(rng, 1650, 1950, 10);
      const s2 = Math.log(1 + cv * cv), s = Math.sqrt(s2), mu = Math.log(dec) - s2 / 2, z = (Math.log(mder) - mu) / s, pou = 100 * normCdf(z);
      return {
        q: `A country has a mean dietary energy consumption of ${dec} kcal person⁻¹ d⁻¹, a coefficient of variation of intake of ${cv} and a minimum dietary energy requirement of ${mder} kcal person⁻¹ d⁻¹. Estimate the prevalence of undernourishment with the lognormal model.`,
        answer: pou, abstol: Math.max(0.3, 0.03 * pou), unit: '%',
        solution: steps(
          `Eq. 1.1.6: \\(\\sigma^2 = \\ln(1+\\text{CV}^2) = \\ln(1+${cv}^2) = ${fm(s2, 4)}\\), so \\(\\sigma = ${fm(s, 4)}\\).`,
          `\\(\\mu = \\ln\\text{DEC} - \\sigma^2/2 = ${fm(Math.log(dec), 5)} - ${fm(s2 / 2, 4)} = ${fm(mu, 5)}\\).`,
          `\\(z = (\\ln\\text{MDER} - \\mu)/\\sigma = (${fm(Math.log(mder), 5)} - ${fm(mu, 5)})/${fm(s, 4)} = ${fm(z, 4)}\\).`,
          `PoU \\(= \\Phi(${fm(z, 4)}) = ${fm(pou / 100, 3)}\\), i.e. ${fm(pou, 3)} % — even though mean supply is ${fm(dec / mder, 3)} × the requirement.`)
      };
    }
  },
  {
    id: 'fd-rebound', title: 'Rebound: when higher yields do not spare land', lesson: 'food-system-challenge', difficulty: 2,
    gen(rng) {
      const y = rand(rng, 10, 50, 1), q = rand(rng, 0, Math.round(y * 0.9), 1);
      const pot = 1 - 1 / (1 + y / 100), act = 1 - (1 + q / 100) / (1 + y / 100), R = 100 * (1 - act / pot);
      return {
        q: `A new cultivar raises yields in a region by ${y} %. Because the crop becomes cheaper, production rises by ${q} %. What is the rebound fraction R (Eq. 1.1.9)?`,
        answer: R, abstol: 0.6, unit: '%',
        solution: steps(
          `Potential land saving at constant production: \\(1 - 1/${fm(1 + y / 100, 3)} = ${fm(pot, 4)}\\) of the area.`,
          `Actual saving: \\(1 - ${fm(1 + q / 100, 3)}/${fm(1 + y / 100, 3)} = ${fm(act, 4)}\\) of the area.`,
          `\\(R = 1 - ${fm(act, 4)}/${fm(pot, 4)} = ${fm(R / 100, 4)}\\), i.e. ${fm(R, 3)} % of the potential land saving is cancelled by extra production.`)
      };
    }
  },

  /* ======================= 1.2 Planetary boundaries ======================= */
  {
    id: 'pb-transgression', title: 'Normalised transgression ratio', lesson: 'planetary-boundaries', difficulty: 1,
    gen(rng) {
      const C = pick(rng, [
        { cv: 'atmospheric CO₂ concentration', u: 'ppm', h: 280, b: 350, x: rand(rng, 380, 440, 1) },
        { cv: 'industrial and intentional biological nitrogen fixation', u: 'Tg N yr⁻¹', h: 0, b: 62, x: rand(rng, 120, 220, 5) },
        { cv: 'global forest area (per cent of original)', u: '%', h: 100, b: 75, x: rand(rng, 55, 72, 1) },
        { cv: 'phosphorus applied to erodible soils (regional)', u: 'Tg P yr⁻¹', h: 0, b: 6.2, x: rand(rng, 9, 20, 0.5) },
        { cv: 'total anthropogenic radiative forcing', u: 'W m⁻²', h: 0, b: 1.0, x: rand(rng, 2.0, 3.2, 0.05) },
        { cv: 'land area with blue-water (streamflow) deviations', u: '%', h: 9.4, b: 10.2, x: rand(rng, 13, 20, 0.2) }
      ]);
      const T = (C.x - C.h) / (C.b - C.h);
      return {
        q: `The control variable "${C.cv}" has a Holocene value of ${C.h} ${C.u}, a boundary of ${C.b} ${C.u} and a current value of ${C.x} ${C.u}. What is the transgression ratio \\(T\\)?`,
        answer: T, tol: 0.02, unit: '',
        solution: steps(
          `Eq. 1.2.1: \\(T = (x - x_H)/(x_B - x_H)\\).`,
          `\\(T = (${C.x} - ${C.h})/(${C.b} - ${C.h}) = ${fm(C.x - C.h, 4)}/${fm(C.b - C.h, 4)} = ${fm(T, 3)}\\).`,
          `${T > 1 ? `\\(T > 1\\): the boundary is transgressed — the control variable has moved ${fm(T, 3)} safe-space widths from the Holocene value.` : `\\(T \\le 1\\): within the safe operating space.`}${C.b < C.h ? ' (For a "lower is worse" variable both differences are negative and the ratio is positive.)' : ''}`)
      };
    }
  },
  {
    id: 'pb-budget', title: 'Per-capita share of a food-system boundary', lesson: 'planetary-boundaries', difficulty: 1,
    gen(rng) {
      const P = rand(rng, 8.5, 10.5, 0.1);
      const B = pick(rng, [
        { n: 'greenhouse gases (CH₄ + N₂O)', v: 5e12, u: 'kg CO₂e person⁻¹ yr⁻¹', desc: '5 Gt CO₂e yr⁻¹', k: 1 },
        { n: 'agricultural land', v: 48e6 * 1e6, u: 'm² person⁻¹', desc: '48 million km²', k: 1 },
        { n: 'nitrogen surplus', v: 57e9, u: 'kg N person⁻¹ yr⁻¹', desc: '57 Tg N yr⁻¹', k: 1 },
        { n: 'phosphorus loss to surface water', v: 4.6e9, u: 'kg P person⁻¹ yr⁻¹', desc: '4.6 Tg P yr⁻¹', k: 1 },
        { n: 'blue-water consumption', v: 2000e9, u: 'm³ person⁻¹ yr⁻¹', desc: '2,000 km³ yr⁻¹', k: 1 }
      ]);
      const b = B.v / (P * 1e9);
      return {
        q: `The food-system boundary for ${B.n} is ${B.desc} (te Wierik et al., 2025). What is each person's equal share if the world population is ${P} billion?`,
        answer: b, tol: 0.02, unit: B.u,
        solution: steps(
          `Eq. 1.2.3 with \\(s_{\\text{food}} = 1\\): \\(b = B/P\\).`,
          `Convert the boundary to base units: \\(B = ${fm(B.v, 3)}\\) (kg, m² or m³ per year).`,
          `\\(b = ${fm(B.v, 3)}/(${P}\\times10^{9}) = ${fm(b, 3)}\\) ${B.u}.`)
      };
    }
  },
  {
    id: 'pb-overshoot', title: 'Diet climate footprint and overshoot ratio', lesson: 'planetary-boundaries', difficulty: 2,
    gen(rng) {
      const beef = rand(rng, 0, 0.08, 0.005), milk = rand(rng, 0, 0.6, 0.05), other = rand(rng, 1.0, 2.5, 0.1), b = rand(rng, 0.5, 1.0, 0.05);
      const daily = beef * 99.5 + milk * 3.2 + other, F = 365 * daily / 1000, O = F / b;
      return {
        q: `A person eats ${fm(beef * 1000, 3)} g of beef-herd beef (99.5 kg CO₂e kg⁻¹) and ${fm(milk * 1000, 3)} g of milk (3.2 kg CO₂e kg⁻¹) per day; all other foods add ${other} kg CO₂e per day. The per-capita climate budget is ${b} t CO₂e yr⁻¹. What is the overshoot ratio O?`,
        answer: O, tol: 0.02, unit: '',
        solution: steps(
          `Daily footprint (Eq. 1.2.4): \\(${beef}\\times99.5 + ${milk}\\times3.2 + ${other} = ${fm(daily, 4)}\\) kg CO₂e d⁻¹.`,
          `Annual: \\(365\\times${fm(daily, 4)} = ${fm(365 * daily, 4)}\\) kg = ${fm(F, 4)} t CO₂e yr⁻¹.`,
          `\\(O = ${fm(F, 4)}/${b} = ${fm(O, 3)}\\). Check first that the footprint and the budget cover the same gases and life-cycle stages!`)
      };
    }
  },
  {
    id: 'pb-nue', title: 'Nitrogen balance of a cereal field', lesson: 'planetary-boundaries', difficulty: 2,
    gen(rng) {
      const fert = rand(rng, 90, 220, 5), dep = rand(rng, 3, 12, 1), Y = rand(rng, 5, 10, 0.1), mc = pick(rng, [0.14, 0.15]), nc = rand(rng, 1.7, 2.3, 0.1);
      const dm = Y * 1000 * (1 - mc), nout = dm * nc / 100, nin = fert + dep, surplus = nin - nout;
      return {
        q: `A wheat field receives ${fert} kg N ha⁻¹ of fertiliser and ${dep} kg N ha⁻¹ of atmospheric deposition. It yields ${Y} t ha⁻¹ of grain at ${Math.round(mc * 100)} % moisture with ${nc} % N in the dry matter; the straw stays on the field. What is the nitrogen surplus?`,
        answer: surplus, abstol: 1, unit: 'kg N ha⁻¹',
        solution: steps(
          `Dry matter harvested: \\(${Y}\\times1000\\times(1-${mc}) = ${fm(dm, 4)}\\) kg ha⁻¹.`,
          `N removed: \\(${fm(dm, 4)}\\times${nc / 100} = ${fm(nout, 4)}\\) kg N ha⁻¹.`,
          `Inputs \\(${fert} + ${dep} = ${nin}\\) kg N ha⁻¹; NUE \\(= ${fm(nout, 4)}/${nin} = ${fm(nout / nin, 3)}\\).`,
          `Surplus (Eq. 1.2.2): \\(${nin} - ${fm(nout, 4)} = ${fm(surplus, 3)}\\) kg N ha⁻¹ ${surplus > 38 ? '— above the ≈ 38 kg N ha⁻¹ average allowed by the 57 Tg N food-system boundary.' : '— within the ≈ 38 kg N ha⁻¹ average of the food-system boundary.'}`)
      };
    }
  },
  {
    id: 'pb-levers', title: 'Combining mitigation levers', lesson: 'planetary-boundaries', difficulty: 2,
    gen(rng) {
      const i0 = rand(rng, 0.9, 2.0, 0.05), G = rand(rng, 1.3, 1.9, 0.05), rd = rand(rng, 10, 40, 1), rt = rand(rng, 10, 35, 1), rw = rand(rng, 5, 15, 1);
      const I = i0 * G * (1 - rd / 100) * (1 - rt / 100) * (1 - rw / 100);
      return {
        q: `A food-system pressure is ${i0} times its boundary today and would grow by a factor of ${G} by 2050 under business as usual. Diet change reduces it by ${rd} %, technology by ${rt} % and less food loss and waste by ${rw} %. What is the 2050 pressure relative to the boundary?`,
        answer: I, tol: 0.02, unit: '× boundary',
        solution: steps(
          `Eq. 1.2.5: \\(I_{2050}/B = (I_0/B)\\,G\\,\\prod(1-r_k)\\).`,
          `\\(${i0}\\times${G} = ${fm(i0 * G, 4)}\\) under business as usual.`,
          `\\(${fm(i0 * G, 4)}\\times${fm(1 - rd / 100, 3)}\\times${fm(1 - rt / 100, 3)}\\times${fm(1 - rw / 100, 3)} = ${fm(I, 3)}\\) — ${I <= 1 ? 'inside the boundary.' : 'still beyond the boundary.'}`,
          `Note that the reductions multiply: together they remove \\(1 - ${fm(I / (i0 * G), 3)} = ${fm(100 * (1 - I / (i0 * G)), 3)}\\) %, less than the sum ${rd + rt + rw} %.`)
      };
    }
  },

  /* ======================= 1.3 Life-cycle thinking ======================= */
  {
    id: 'lca-co2e', title: 'CO₂-equivalents with AR6 GWP100', lesson: 'life-cycle-thinking', difficulty: 1,
    gen(rng) {
      const co2 = rand(rng, 0, 500, 10), ch4b = rand(rng, 0, 20, 0.5), ch4f = rand(rng, 0, 5, 0.1), n2o = rand(rng, 0, 3, 0.05);
      const e = co2 + GWP.ch4b * ch4b + GWP.ch4f * ch4f + GWP.n2o * n2o;
      return {
        q: `A farm process emits ${co2} kg of fossil CO₂, ${ch4b} kg of biogenic CH₄, ${ch4f} kg of fossil CH₄ and ${n2o} kg of N₂O. What is the total in kg CO₂e with IPCC AR6 GWP100 values?`,
        answer: e, tol: 0.01, unit: 'kg CO₂e',
        solution: steps(
          `Eq. 1.3.3: CO₂e \\(= m_{\\text{CO}_2} + 27.0\\,m_{\\text{CH}_4,\\text{bio}} + 29.8\\,m_{\\text{CH}_4,\\text{fossil}} + 273\\,m_{\\text{N}_2\\text{O}}\\).`,
          `\\(${co2} + 27.0\\times${ch4b} + 29.8\\times${ch4f} + 273\\times${n2o} = ${co2} + ${fm(27 * ch4b, 4)} + ${fm(29.8 * ch4f, 4)} + ${fm(273 * n2o, 4)}\\)`,
          `\\(= ${fm(e, 4)}\\) kg CO₂e.`)
      };
    }
  },
  {
    id: 'lca-n2o', title: 'Direct N₂O from fertiliser (IPCC Tier 1)', lesson: 'life-cycle-thinking', difficulty: 2,
    gen(rng) {
      const FN = rand(rng, 60, 220, 5), ef = pick(rng, [0.005, 0.008, 0.01, 0.016]), Y = rand(rng, 4, 10, 0.5);
      const n2o = FN * ef * 44 / 28, co2e = n2o * 273, perKg = co2e / (Y * 1000);
      return {
        q: `A field receives ${FN} kg N ha⁻¹ and the direct emission factor is EF₁ = ${ef} kg N₂O-N per kg N. The crop yields ${Y} t ha⁻¹. What is the direct N₂O emission expressed in kg CO₂e per kg of harvested crop?`,
        answer: perKg, tol: 0.02, unit: 'kg CO₂e kg⁻¹',
        solution: steps(
          `Eq. 1.3.4: \\(m_{\\text{N}_2\\text{O}} = F_N\\,\\text{EF}_1\\,\\tfrac{44}{28} = ${FN}\\times${ef}\\times1.571 = ${fm(n2o, 4)}\\) kg N₂O ha⁻¹.`,
          `CO₂e: \\(${fm(n2o, 4)}\\times273 = ${fm(co2e, 4)}\\) kg CO₂e ha⁻¹.`,
          `Per kg of crop: \\(${fm(co2e, 4)}/${fm(Y * 1000, 4)} = ${fm(perKg, 3)}\\) kg CO₂e kg⁻¹.`)
      };
    }
  },
  {
    id: 'lca-inventory', title: 'Cradle-to-farm-gate GHG footprint: Σ activity × EF', lesson: 'life-cycle-thinking', difficulty: 3,
    gen(rng) {
      const N = rand(rng, 80, 200, 5), efp = rand(rng, 2, 7, 0.5), diesel = rand(rng, 50, 120, 5), kwh = rand(rng, 0, 400, 20), efe = pick(rng, [0.04, 0.1, 0.25, 0.45]), Y = rand(rng, 5, 9, 0.5);
      const field = N * 0.01 * 44 / 28 * 273, prod = N * efp, fuel = diesel * 2.68, el = kwh * efe, tot = field + prod + fuel + el;
      return {
        q: `A cereal field receives ${N} kg N ha⁻¹ of mineral fertiliser (production ${efp} kg CO₂e per kg N; direct N₂O with EF₁ = 0.01), uses ${diesel} L ha⁻¹ of diesel (2.68 kg CO₂ L⁻¹) and ${kwh} kWh ha⁻¹ of electricity for drying (${efe} kg CO₂e kWh⁻¹). The yield is ${Y} t ha⁻¹. What is the footprint per kg of grain?`,
        answer: tot / (Y * 1000), tol: 0.02, unit: 'kg CO₂e kg⁻¹',
        solution: steps(
          `Field N₂O (Eq. 1.3.4): \\(${N}\\times0.01\\times\\tfrac{44}{28}\\times273 = ${fm(field, 4)}\\) kg CO₂e ha⁻¹.`,
          `Fertiliser production: \\(${N}\\times${efp} = ${fm(prod, 4)}\\); diesel: \\(${diesel}\\times2.68 = ${fm(fuel, 4)}\\); electricity: \\(${kwh}\\times${efe} = ${fm(el, 4)}\\) kg CO₂e ha⁻¹.`,
          `Total (Eq. 1.3.2): \\(${fm(tot, 4)}\\) kg CO₂e ha⁻¹; per kg: \\(${fm(tot, 4)}/${fm(Y * 1000, 4)} = ${fm(tot / (Y * 1000), 3)}\\) kg CO₂e kg⁻¹.`,
          `Nitrogen (field N₂O + manufacture) contributes ${fm(100 * (field + prod) / tot, 3)} % — the usual hot spot of crop footprints.`)
      };
    }
  },
  {
    id: 'lca-allocation', title: 'Mass versus economic allocation on a dairy farm', lesson: 'life-cycle-thinking', difficulty: 2,
    gen(rng) {
      const E = rand(rng, 600, 2000, 50), mMilk = rand(rng, 500, 2000, 50), pMilk = rand(rng, 0.35, 0.6, 0.01), mMeat = rand(rng, 20, 80, 5), pMeat = rand(rng, 1.5, 3.0, 0.1);
      const econ = mMilk * pMilk / (mMilk * pMilk + mMeat * pMeat), mass = mMilk / (mMilk + mMeat);
      const fpE = E * econ / mMilk;
      return {
        q: `A dairy farm emits ${E} t CO₂e per year and sells ${mMilk} t of milk (${pMilk} € kg⁻¹) and ${mMeat} t live weight of culled cows and calves (${pMeat} € kg⁻¹). What is the footprint of the milk with <b>economic</b> allocation?`,
        answer: fpE, tol: 0.02, unit: 'kg CO₂e kg⁻¹ milk',
        solution: steps(
          `Values: milk \\(${mMilk}\\times${pMilk} = ${fm(mMilk * pMilk, 4)}\\) k€; meat \\(${mMeat}\\times${pMeat} = ${fm(mMeat * pMeat, 4)}\\) k€.`,
          `Allocation factor (Eq. 1.3.6): \\(\\text{AF}_{\\text{milk}} = ${fm(mMilk * pMilk, 4)}/${fm(mMilk * pMilk + mMeat * pMeat, 4)} = ${fm(econ, 4)}\\).`,
          `Footprint: \\(${fm(econ, 4)}\\times${E}\\ \\text{t}/${mMilk}\\ \\text{t} = ${fm(fpE, 3)}\\) kg CO₂e per kg milk.`,
          `With mass allocation it would be \\(${fm(mass, 4)}\\times${E}/${mMilk} = ${fm(E * mass / mMilk, 3)}\\) — always report the method.`)
      };
    }
  },
  {
    id: 'lca-per-protein', title: 'Per kilogram to per 100 g protein', lesson: 'life-cycle-thinking', difficulty: 1,
    gen(rng) {
      const F = pick(rng, FOODS);
      const I = F.ghg * 100 / F.prot;
      return {
        q: `The mean greenhouse-gas footprint of ${F.n} is ${F.ghg} kg CO₂e per kg (Poore &amp; Nemecek, 2018) and it contains about ${F.prot} g protein per kg. What is its footprint per 100 g of protein?`,
        answer: I, tol: 0.02, unit: 'kg CO₂e (100 g protein)⁻¹',
        solution: steps(
          `Eq. 1.3.1: \\(I_{100\\,\\text{g}} = I_{\\text{kg}}\\times100/c_{\\text{prot}}\\).`,
          `The mass of food that supplies 100 g protein is \\(100/${F.prot} = ${fm(100 / F.prot, 4)}\\) kg.`,
          `\\(I = ${F.ghg}\\times${fm(100 / F.prot, 4)} = ${fm(I, 3)}\\) kg CO₂e per 100 g protein.`)
      };
    }
  },
  {
    id: 'lca-unit-ranking', title: 'Does the functional unit change the ranking?', lesson: 'life-cycle-thinking', difficulty: 2,
    gen(rng) {
      let A = pick(rng, FOODS), B = pick(rng, FOODS); while (B === A) B = pick(rng, FOODS);
      const rKg = A.ghg / B.ghg, rProt = (A.ghg / A.prot) / (B.ghg / B.prot);
      return {
        q: `Poore &amp; Nemecek (2018) means: ${A.n} ${A.ghg} kg CO₂e kg⁻¹ (${A.prot} g protein kg⁻¹); ${B.n} ${B.ghg} kg CO₂e kg⁻¹ (${B.prot} g protein kg⁻¹). Per kg, ${A.n} emits ${fm(rKg, 3)} times as much as ${B.n}. How many times as much does it emit <b>per gram of protein</b>?`,
        answer: rProt, tol: 0.02, unit: '×',
        solution: steps(
          `Per 100 g protein: ${A.n} \\(${A.ghg}\\times100/${A.prot} = ${fm(A.ghg * 100 / A.prot, 4)}\\); ${B.n} \\(${B.ghg}\\times100/${B.prot} = ${fm(B.ghg * 100 / B.prot, 4)}\\) kg CO₂e.`,
          `Ratio: \\(${fm(A.ghg * 100 / A.prot, 4)}/${fm(B.ghg * 100 / B.prot, 4)} = ${fm(rProt, 3)}\\).`,
          `Equivalently, the per-kg ratio times the inverse protein ratio: \\(${fm(rKg, 3)}\\times${B.prot}/${A.prot} = ${fm(rProt, 3)}\\). Foods that are mostly water (milk) look better per kg than per protein.`)
      };
    }
  },
  {
    id: 'lca-land-occupation', title: 'Land occupation from yield', lesson: 'life-cycle-thinking', difficulty: 1,
    gen(rng) {
      const crop = pick(rng, [['wheat', 3, 10], ['potatoes', 20, 50], ['field lettuce', 20, 45], ['soybeans', 1.5, 4], ['barley', 3, 8]]);
      const Y = rand(rng, crop[1], crop[2], 0.5), t = pick(rng, [0.5, 1]);
      const LO = 10000 * t / (Y * 1000);
      return {
        q: `A crop of ${crop[0]} yields ${Y} t ha⁻¹ and occupies the land for ${t === 1 ? 'one year' : 'half a year (another crop is grown in the same year)'}. What is its land occupation per kg?`,
        answer: LO, tol: 0.02, unit: 'm²·yr kg⁻¹',
        solution: steps(
          `Eq. 1.3.7: \\(\\text{LO} = 10\\,000\\ \\text{m}^2\\,\\text{ha}^{-1}\\times t_{\\text{occ}}/Y\\).`,
          `\\(\\text{LO} = 10\\,000\\times${t}/${fm(Y * 1000, 4)} = ${fm(LO, 3)}\\) m²·yr kg⁻¹.`)
      };
    }
  },
  {
    id: 'lca-gwp-star', title: 'GWP* warming-equivalent emissions', lesson: 'life-cycle-thinking', difficulty: 3,
    gen(rng) {
      const e0 = rand(rng, 50, 150, 1), ch = rand(rng, -25, 25, 1), e1 = Math.round(e0 * (1 + ch / 100));
      const star = 27.0 * (4.0 * e1 - 3.75 * e0);
      return {
        q: `A herd emitted ${e0} t CH₄ yr⁻¹ twenty years ago and emits ${e1} t CH₄ yr⁻¹ now. With GWP100 = 27.0, what are its current GWP* warming-equivalent emissions? (Give a signed number.)`,
        answer: star, abstol: Math.max(2, Math.abs(star) * 0.01), unit: 't CO₂-we yr⁻¹',
        solution: steps(
          `Eq. 1.3.5: \\(E^* = \\text{GWP}_{100}\\,[4.0\\,E(t) - 3.75\\,E(t-20)]\\).`,
          `\\(4.0\\times${e1} - 3.75\\times${e0} = ${fm(4 * e1, 4)} - ${fm(3.75 * e0, 4)} = ${fm(4 * e1 - 3.75 * e0, 4)}\\).`,
          `\\(E^* = 27.0\\times${fm(4 * e1 - 3.75 * e0, 4)} = ${fm(star, 4)}\\) t CO₂-we yr⁻¹ (GWP100 would give \\(27.0\\times${e1} = ${fm(27 * e1, 4)}\\) t CO₂e).`,
          `${star < 0 ? 'A negative value means the falling emissions are reducing warming relative to today.' : 'A positive value means the herd is still adding warming.'}`)
      };
    }
  },
  {
    id: 'lca-aware', title: 'Water-scarcity footprint (AWARE)', lesson: 'life-cycle-thinking', difficulty: 1,
    gen(rng) {
      const V = rand(rng, 10, 80, 1), CF = pick(rng, [0.3, 0.8, 1.5, 5, 12, 25, 40, 70]);
      const w = V / 1000 * CF;
      return {
        q: `Tomatoes consume ${V} L of irrigation water per kg in a watershed with an AWARE characterisation factor of ${CF}. What is the water-scarcity footprint per kg?`,
        answer: w, tol: 0.02, unit: 'm³ world-eq kg⁻¹',
        solution: steps(
          `Eq. 1.3.9: \\(\\text{WSF} = V_{\\text{cons}}\\times\\text{CF}\\).`,
          `\\(V = ${V}\\ \\text{L} = ${fm(V / 1000, 3)}\\) m³; \\(\\text{WSF} = ${fm(V / 1000, 3)}\\times${CF} = ${fm(w, 3)}\\) m³ world-eq kg⁻¹.`,
          `${CF > 1 ? 'The factor above 1 means water is scarcer than the world average there.' : 'A factor below 1 means water is less scarce than the world average.'}`)
      };
    }
  },

  /* ======================= 1.4 Technology landscape ======================= */
  {
    id: 'tl-trl-mcq', title: 'Assign a technology readiness level', lesson: 'technology-landscape', difficulty: 1,
    gen(rng) {
      const items = [
        ['A research group discovers that the root mucilage of a maize landrace hosts nitrogen-fixing bacteria.', 'TRL 1 — basic principles observed', ['TRL 3 — experimental proof of concept', 'TRL 5 — validated in relevant environment', 'TRL 7 — prototype in operational environment']],
        ['Animal cells are grown on a defined, animal-free medium in 2-litre bench-top bioreactors.', 'TRL 4 — technology validated in lab', ['TRL 2 — technology concept formulated', 'TRL 6 — demonstrated in relevant environment', 'TRL 8 — system complete and qualified']],
        ['New wheat lines with a biological nitrification trait are tested in replicated trials at several research stations.', 'TRL 5 — technology validated in relevant environment', ['TRL 3 — experimental proof of concept', 'TRL 7 — prototype in operational environment', 'TRL 9 — proven in operational environment']],
        ['A pilot plant runs a continuous gas fermentation for months under industrial conditions.', 'TRL 6 — technology demonstrated in relevant environment', ['TRL 4 — technology validated in lab', 'TRL 8 — system complete and qualified', 'TRL 2 — technology concept formulated']],
        ['A weeding-robot prototype works on commercial vegetable farms during a whole season under farmers\' conditions.', 'TRL 7 — system prototype demonstration in operational environment', ['TRL 5 — validated in relevant environment', 'TRL 9 — proven in operational environment', 'TRL 3 — experimental proof of concept']],
        ['The first commercial factory for an authorised microbial protein starts selling to food manufacturers.', 'TRL 8 — system complete and qualified', ['TRL 6 — demonstrated in relevant environment', 'TRL 4 — validated in lab', 'TRL 2 — technology concept formulated']],
        ['LED top-lighting has been used for years in thousands of commercial greenhouses.', 'TRL 9 — actual system proven in operational environment', ['TRL 7 — prototype in operational environment', 'TRL 5 — validated in relevant environment', 'TRL 8 — system complete and qualified']],
        ['A research proposal describes how cereals could be engineered to host a legume-like nitrogen-fixing symbiosis.', 'TRL 2 — technology concept formulated', ['TRL 4 — technology validated in lab', 'TRL 1 — basic principles observed', 'TRL 6 — demonstrated in relevant environment']]
      ];
      const [q, c, w] = pick(rng, items);
      return mcq(rng, `Which EU technology readiness level best describes this situation? ${q}`, c, w,
        `<p>EU definitions: TRL 1 principles observed · 2 concept formulated · 3 experimental proof of concept · 4 validated in lab · 5 validated in relevant environment · 6 demonstrated in relevant environment · 7 prototype in operational environment · 8 system complete and qualified · 9 proven in operational environment. Remember that a TRL says nothing about cost, sustainability or acceptance (Lesson 1.4).</p>`);
    }
  },
  {
    id: 'tl-takeover', title: 'Logistic takeover time', lesson: 'technology-landscape', difficulty: 1,
    gen(rng) {
      const r = rand(rng, 0.1, 1.2, 0.01);
      const dt = Math.log(81) / r;
      return {
        q: `A technology diffuses logistically with intrinsic rate r = ${r} yr⁻¹. How many years does it take to rise from 10 % to 90 % of its ceiling?`,
        answer: dt, tol: 0.02, unit: 'years',
        solution: steps(
          `Eq. 1.4.1: the logit \\(\\ln[s/(K-s)]\\) rises linearly with slope \\(r\\); from 10 % to 90 % it changes by \\(2\\ln 9 = \\ln 81 = 4.394\\).`,
          `\\(\\Delta t = 4.394/${r} = ${fm(dt, 3)}\\) years.`)
      };
    }
  },
  {
    id: 'tl-bass-peak', title: 'Bass model: when does adoption peak?', lesson: 'technology-landscape', difficulty: 2,
    gen(rng) {
      const p = rand(rng, 0.003, 0.05, 0.001), q = rand(rng, 0.15, 0.7, 0.01);
      const t = Math.log(q / p) / (p + q), F = 0.5 - p / (2 * q);
      return {
        q: `A new food technology diffuses according to the Bass model with p = ${p} yr⁻¹ and q = ${q} yr⁻¹. How many years after launch does the number of new adopters per year peak?`,
        answer: t, tol: 0.02, unit: 'years',
        solution: steps(
          `Eq. 1.4.2: \\(t^* = \\ln(q/p)/(p+q)\\).`,
          `\\(q/p = ${q}/${p} = ${fm(q / p, 4)}\\); \\(\\ln(${fm(q / p, 4)}) = ${fm(Math.log(q / p), 4)}\\).`,
          `\\(t^* = ${fm(Math.log(q / p), 4)}/${fm(p + q, 3)} = ${fm(t, 3)}\\) years; by then \\(F^* = 0.5 - p/(2q) = ${fm(F, 3)}\\) of the market potential has adopted.`)
      };
    }
  },
  {
    id: 'tl-experience', title: 'Experience curve: cost after scale-up', lesson: 'technology-landscape', difficulty: 2,
    gen(rng) {
      const C0 = rand(rng, 10, 80, 1), LR = rand(rng, 8, 30, 1), n = randInt(rng, 2, 8);
      const C = C0 * Math.pow(1 - LR / 100, n);
      return {
        q: `A novel protein costs €${C0} kg⁻¹ today. With a learning rate of ${LR} %, what will it cost after cumulative production has doubled ${n} times (Wright's law, no cost floor)?`,
        answer: C, tol: 0.02, unit: '€ kg⁻¹',
        solution: steps(
          `Eq. 1.4.3: each doubling multiplies unit cost by \\(1 - \\text{LR} = ${fm(1 - LR / 100, 3)}\\).`,
          `\\(C = ${C0}\\times${fm(1 - LR / 100, 3)}^{${n}} = ${C0}\\times${fm(Math.pow(1 - LR / 100, n), 4)} = ${fm(C, 3)}\\) € kg⁻¹.`,
          `Cumulative production has grown \\(2^{${n}} = ${2 ** n}\\)-fold. Real costs flatten towards a floor set by feedstock, energy and physics.`)
      };
    }
  },
  {
    id: 'tl-wedge', title: 'The substitution wedge', lesson: 'technology-landscape', difficulty: 2,
    gen(rng) {
      const a = rand(rng, 0.2, 0.6, 0.01), s = rand(rng, 5, 40, 1), rho = rand(rng, 0.05, 0.6, 0.05), R = rand(rng, 0, 40, 5);
      const d = 100 * a * (s / 100) * (1 - rho) * (1 - R / 100);
      return {
        q: `A product category causes ${Math.round(a * 100)} % of a food-system pressure. A new technology replaces ${s} % of that category with a relative intensity ρ = ${rho} per functional unit, and rebound cancels ${R} % of the saving. By how many per cent does the total pressure fall? (Give a positive number.)`,
        answer: d, tol: 0.02, unit: '%',
        solution: steps(
          `Eq. 1.4.5: \\(\\Delta I/I_0 = -\\alpha\\,s\\,(1-\\rho)(1-R)\\).`,
          `\\(${a}\\times${s / 100}\\times${fm(1 - rho, 3)}\\times${fm(1 - R / 100, 3)} = ${fm(d / 100, 4)}\\): a reduction of ${fm(d, 3)} %.`,
          `Each factor matters: halving adoption or doubling the rebound halves the wedge.`)
      };
    }
  },
  {
    id: 'tl-logistic-two-points', title: 'Diffusion forecast from two observations', lesson: 'technology-landscape', difficulty: 3,
    gen(rng) {
      const K = pick(rng, [100, 60, 40, 30]), s1 = rand(rng, 1, Math.min(8, K * 0.2), 0.5), gap = randInt(rng, 3, 8);
      const s2 = +Math.min(K * 0.6, s1 * rand(rng, 2, 5, 0.1)).toFixed(1);
      const l1 = Math.log(s1 / (K - s1)), l2 = Math.log(s2 / (K - s2)), r = (l2 - l1) / gap, t50 = gap + (0 - l2) / r;
      return {
        q: `A technology held ${s1} % of its market in 2020 and ${s2} % in ${2020 + gap}. Assume logistic diffusion towards a ceiling of K = ${K} %. In which year does it reach half of its ceiling (${K / 2} %)? (Give the year with one decimal.)`,
        answer: 2020 + t50, abstol: 0.15, unit: '',
        solution: steps(
          `Logit relative to the ceiling (Eq. 1.4.1): \\(\\ln[s/(K-s)]\\).`,
          `2020: \\(\\ln(${s1}/${fm(K - s1, 4)}) = ${fm(l1, 4)}\\); ${2020 + gap}: \\(\\ln(${s2}/${fm(K - s2, 4)}) = ${fm(l2, 4)}\\).`,
          `Slope \\(r = (${fm(l2, 4)} - (${fm(l1, 4)}))/${gap} = ${fm(r, 4)}\\) yr⁻¹.`,
          `Half the ceiling is where the logit is 0: \\(${fm(-l2, 4)}/${fm(r, 4)} = ${fm(t50 - gap, 3)}\\) years after ${2020 + gap}, i.e. ≈ ${fm(2020 + t50, 5)}.`,
          `Try another ceiling: the same data give a different answer — early data cannot reveal \\(K\\).`)
      };
    }
  },
  {
    id: 'tl-land-electricity', title: 'Land hidden in electricity', lesson: 'technology-landscape', difficulty: 2,
    gen(rng) {
      const e = rand(rng, 5, 25, 0.5), y = rand(rng, 50, 200, 5), Yb = rand(rng, 100, 400, 10), Yf = rand(rng, 4, 10, 0.5);
      const LO = e / y + 1 / Yb, LOf = 1 / Yf;
      return {
        q: `A vertical farm needs ${e} kWh of electricity per kg of lettuce, supplied by a solar park that yields ${y} kWh per m² of land per year. The building produces ${Yb} kg per m² of footprint per year. What is the total land occupation per kg? (Field lettuce yields ${Yf} kg m⁻² yr⁻¹ for comparison.)`,
        answer: LO, tol: 0.02, unit: 'm²·yr kg⁻¹',
        solution: steps(
          `Eq. 1.4.6: \\(\\text{LO} = e/y_{\\text{el}} + 1/Y_b\\).`,
          `PV land: \\(${e}/${y} = ${fm(e / y, 4)}\\); building: \\(1/${Yb} = ${fm(1 / Yb, 3)}\\) m²·yr kg⁻¹.`,
          `Total \\(= ${fm(LO, 3)}\\) m²·yr kg⁻¹, compared with \\(1/${Yf} = ${fm(LOf, 3)}\\) for the field — the vertical farm ${LO < LOf ? `saves ${fm(100 * (1 - LO / LOf), 3)} % of the land` : `needs ${fm(100 * (LO / LOf - 1), 3)} % more land`} once its electricity is included.`)
      };
    }
  },
  {
    id: 'tl-concepts', title: 'Hype, rebound and responsible innovation', lesson: 'technology-landscape', difficulty: 1,
    gen(rng) {
      const items = [
        ['What did Dedehayir and Steinert (2016) conclude about Gartner\'s hype cycle?', 'It lacks a robust empirical foundation: few technologies completed the predicted path', ['Almost every technology follows it within a decade', 'The trough of disillusionment reliably predicts failure', 'It applies only to food technologies'], 'The hype cycle is a heuristic narrative; van Lente et al. (2013) also found that hype patterns differ between fields.'],
        ['Which of these is an example of burden shifting?', 'A solar-powered vertical farm needs more PV land than the field land it replaces', ['A precision sprayer uses less herbicide at the same yield', 'A breeder shortens the breeding cycle with gene editing', 'A fermenter is scaled from 10 L to 100 L'], 'Burden shifting moves a pressure to another boundary, stage or place — here from farmland to the energy system (Eq. 1.4.6).'],
        ['Which is NOT one of the four dimensions of responsible innovation of Stilgoe, Owen and Macnaghten (2013)?', 'Profitability', ['Anticipation', 'Inclusion', 'Responsiveness'], 'The four dimensions are anticipation, reflexivity, inclusion and responsiveness.'],
        ['What is the Collingridge dilemma?', 'Early on a technology is easy to change but its effects are unknown; later its effects are known but it is entrenched', ['New technologies always cause more harm than good', 'Regulation always slows innovation', 'Markets correct harmful technologies automatically'], 'Collingridge (1980): knowledge and influence peak at different times — hence anticipatory, adaptive governance.'],
        ['Cheaper alternative protein is eaten in addition to, rather than instead of, meat. This is an example of…', 'a rebound effect', ['burden shifting', 'lock-in', 'the valley of death'], 'Rebound: induced consumption cancels part of the expected saving (the R in Eq. 1.4.5).'],
        ['In the efficiency–substitution–redesign framework, replacing synthetic insecticides with predatory mites is…', 'substitution', ['efficiency', 'redesign', 'rebound'], 'Substitution swaps an input for a more benign one; efficiency would apply the same insecticide more precisely.']
      ];
      const [q, c, w, s] = pick(rng, items);
      return mcq(rng, q, c, w, `<p>${s}</p>`);
    }
  }
];
