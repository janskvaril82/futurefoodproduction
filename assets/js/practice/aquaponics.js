/* ==========================================================================
   Practice generators — Module 6: Aquaponics — coupled fish–plant ecosystems
   Lessons: aquaponic-ecosystem (6.1), aquaponic-design (6.2),
            fish-water-quality (6.3)
   Every generator returns a fresh, randomised, auto-marked problem.
   The ammonia equilibrium uses nh3Fraction() from /assets/js/physics.js
   (Emerson et al. 1975) so that lessons, labs and practice agree.
   Stoichiometric constants (nitrification, per g of N nitrified):
     4.57 g O2 (energy reaction), 7.07 g alkalinity as CaCO3 (US EPA 1975,
     including cell synthesis; 7.14 for the energy reaction alone).
   ========================================================================== */
import { rand, randInt, pick, f, steps, mcq } from './helpers.js';
import { nh3Fraction, doSaturation } from '../physics.js';

/* ---------- local helpers ---------- */
const pKa = T => 0.09018 + 2729.92 / (T + 273.15);           // Emerson et al. (1975)
const EQ = { NaHCO3: 84.01, KOH: 56.11, 'Ca(OH)₂': 37.05 };  // g per equivalent of alkalinity
const MEDIA = [
  { name: 'volcanic tuff gravel', ssa: 300 },
  { name: 'expanded clay (LECA)', ssa: 275 },
  { name: 'plastic bio-balls', ssa: 600 },
  { name: 'moving-bed carriers (K1-type)', ssa: 500 }
];
const SPECIES = [
  { name: 'Nile tilapia', pc: [28, 35], rate: [1, 3] },
  { name: 'rainbow trout', pc: [40, 45], rate: [1, 2] },
  { name: 'common carp', pc: [30, 38], rate: [1, 3] },
  { name: 'European perch', pc: [40, 48], rate: [1, 2] },
  { name: 'African catfish', pc: [35, 42], rate: [1, 2.5] }
];

export default [
  /* ======================= 6.1 the aquaponic ecosystem ======================= */
  {
    id: 'aq-n-in-feed', title: 'Nitrogen in fish feed from its protein content', lesson: 'aquaponic-ecosystem', difficulty: 1,
    gen(rng) {
      const F = rand(rng, 2, 30, 0.5), PC = rand(rng, 28, 48, 1);
      const N = F * 1000 * PC / 100 * 0.16;
      return {
        q: `An aquaponic farm feeds ${F} kg of pellets per day. The feed contains ${PC} % crude protein. How much nitrogen enters the system with the feed each day? (Protein contains on average 16 % nitrogen.)`,
        answer: N, tol: 0.02, unit: 'g N d⁻¹',
        solution: steps(
          `Crude protein is estimated as \\(6.25\\times\\) nitrogen, so nitrogen is \\(1/6.25 = 0.16\\) of protein.`,
          `\\(N_{\\text{feed}} = F\\cdot PC\\cdot 0.16 = ${F}\\,\\text{kg d}^{-1}\\times ${PC / 100}\\times 0.16 = ${f(N / 1000, 4)}\\) kg N d⁻¹`,
          `\\(= ${f(N)}\\) g N d⁻¹ (≈ ${f(N / (F * 1000) * 100, 3)} % of the feed mass is nitrogen).`)
      };
    }
  },
  {
    id: 'aq-tan-production', title: 'Daily TAN production (Timmons–Ebeling factor)', lesson: 'aquaponic-ecosystem', difficulty: 1,
    gen(rng) {
      const F = rand(rng, 1, 25, 0.5), PC = rand(rng, 28, 45, 1);
      const P = F * 1000 * PC / 100 * 0.092;
      return {
        q: `Estimate the total ammonia nitrogen (TAN) produced by fish that receive ${F} kg d⁻¹ of a ${PC} % protein feed. Use \\(P_{\\text{TAN}} = F\\cdot PC\\cdot 0.092\\).`,
        answer: P, tol: 0.02, unit: 'g TAN d⁻¹',
        solution: steps(
          `The factor 0.092 = 0.16 (N in protein) × 0.80 (N absorbed) × 0.80 (absorbed N excreted) × 0.90 (excreted N as TAN).`,
          `\\(P_{\\text{TAN}} = ${F}\\,\\text{kg d}^{-1}\\times ${PC / 100}\\times 0.092 = ${f(P / 1000, 4)}\\) kg d⁻¹ = ${f(P)} g TAN d⁻¹.`,
          `Check: this is ${f(P / (F * 1000) * 100, 3)} % of the feed mass — consistent with the rule of thumb that about 3 % of a 32 % protein feed becomes ammonia-N.`)
      };
    }
  },
  {
    id: 'aq-tan-biomass-failure', title: 'Biofilter failure: how fast does TAN rise?', lesson: 'aquaponic-ecosystem', difficulty: 2,
    gen(rng) {
      const sp = pick(rng, SPECIES);
      const B = rand(rng, 200, 1500, 50), r = rand(rng, sp.rate[0], sp.rate[1], 0.1), PC = rand(rng, sp.pc[0], sp.pc[1], 1), V = rand(rng, 8, 60, 1);
      const F = B * r / 100, P = F * 1000 * PC / 100 * 0.092, dC = P / V;
      return {
        q: `A tank holds ${B} kg of ${sp.name}, fed ${r} % of body weight per day with a ${PC} % protein feed. The total system water volume is ${V} m³. If the biofilter stopped working completely and no water were exchanged, by how much would the TAN concentration rise in 24 h?`,
        answer: dC, tol: 0.03, unit: 'mg TAN L⁻¹',
        solution: steps(
          `Daily feed: \\(F = ${B}\\times ${r / 100} = ${f(F)}\\) kg d⁻¹.`,
          `TAN produced: \\(P_{\\text{TAN}} = ${f(F)}\\times ${PC / 100}\\times 0.092 = ${f(P / 1000, 4)}\\) kg = ${f(P)} g per day.`,
          `Concentration rise: \\(\\Delta C = P_{\\text{TAN}}/V = ${f(P)}\\,\\text{g} / ${V}\\,\\text{m}^3 = ${f(dC)}\\) g m⁻³ = ${f(dC)} mg L⁻¹.`,
          `Compare with FAO guidance (TAN &lt; 1–2 mg L⁻¹ for most species; &lt; 0.5 for trout): a failure becomes dangerous within about ${f(Math.max(0.1, 1 / dC * 24), 2)} h for a 1 mg L⁻¹ limit.`)
      };
    }
  },
  {
    id: 'aq-nitrification-o2', title: 'Oxygen demand of nitrification', lesson: 'aquaponic-ecosystem', difficulty: 1,
    gen(rng) {
      const P = rand(rng, 50, 900, 10);
      const O = 4.57 * P / 1000;
      return {
        q: `A biofilter nitrifies ${P} g of TAN per day completely to nitrate. How much dissolved oxygen do the nitrifiers consume per day? (Use the energy-reaction stoichiometry.)`,
        answer: O, tol: 0.02, unit: 'kg O₂ d⁻¹',
        solution: steps(
          `Overall reaction: \\(\\text{NH}_4^+ + 2\\,\\text{O}_2 \\rightarrow \\text{NO}_3^- + 2\\,\\text{H}^+ + \\text{H}_2\\text{O}\\).`,
          `2 mol O₂ (64 g) per mol N (14 g): \\(64/14 = 4.57\\) g O₂ per g N (3.43 g in step 1 + 1.14 g in step 2).`,
          `\\(4.57\\times ${P} = ${f(4.57 * P)}\\) g O₂ d⁻¹ = ${f(O)} kg O₂ d⁻¹.`)
      };
    }
  },
  {
    id: 'aq-alkalinity-base', title: 'Alkalinity consumed by nitrification and base to replace it', lesson: 'aquaponic-ecosystem', difficulty: 2,
    gen(rng) {
      const P = rand(rng, 50, 600, 10);
      const base = pick(rng, Object.keys(EQ));
      const alk = 7.07 * P, eq = alk / 50.04, m = eq * EQ[base];
      return {
        q: `Nitrification converts ${P} g of TAN per day to nitrate. Alkalinity is consumed at 7.07 g CaCO₃ per g N. What mass of <b>${base}</b> must be dosed per day to replace the alkalinity? (1 equivalent of alkalinity = 50.04 g CaCO₃; ${base} supplies 1 equivalent per ${EQ[base]} g.)`,
        answer: m, tol: 0.02, unit: 'g d⁻¹',
        solution: steps(
          `Alkalinity consumed: \\(7.07\\times ${P} = ${f(alk)}\\) g CaCO₃ d⁻¹.`,
          `Equivalents: \\(${f(alk)}/50.04 = ${f(eq)}\\) eq d⁻¹ (two H⁺ released per N nitrified, less the share taken up into biomass).`,
          `Mass of ${base}: \\(${f(eq)}\\times ${EQ[base]} = ${f(m)}\\) g d⁻¹.`,
          base === 'KOH' ? 'Bonus: KOH also supplies potassium, which fish feed provides in too small amounts for plants.' : base === 'Ca(OH)₂' ? 'Bonus: Ca(OH)₂ also supplies calcium, often deficient in aquaponic lettuce (tip-burn).' : 'Caution: NaHCO₃ adds sodium, which plants tolerate poorly (keep Na⁺ below ~50 mg L⁻¹).')
      };
    }
  },
  {
    id: 'aq-alk-depletion', title: 'How long until the alkalinity buffer is gone?', lesson: 'aquaponic-ecosystem', difficulty: 2,
    gen(rng) {
      const V = rand(rng, 10, 120, 1), A0 = rand(rng, 100, 250, 10), P = rand(rng, 40, 400, 10);
      const t = (A0 - 50) * V / (7.07 * P);
      return {
        q: `An aquaponic system holds ${V} m³ of water with an initial alkalinity of ${A0} mg L⁻¹ as CaCO₃. Nitrification oxidises ${P} g TAN per day and no base is added. Ignoring plant uptake effects and water exchange, after how many days does the alkalinity fall to 50 mg L⁻¹?`,
        answer: t, tol: 0.03, unit: 'days',
        solution: steps(
          `Alkalinity that may be used: \\((${A0} - 50)\\,\\text{g m}^{-3}\\times ${V}\\,\\text{m}^3 = ${f((A0 - 50) * V)}\\) g CaCO₃.`,
          `Daily consumption: \\(7.07\\times ${P} = ${f(7.07 * P)}\\) g CaCO₃ d⁻¹.`,
          `Time: \\(${f((A0 - 50) * V)}/${f(7.07 * P)} = ${f(t)}\\) days. After that the pH falls quickly because the buffer is exhausted.`)
      };
    }
  },
  {
    id: 'aq-biofilter-area', title: 'Biofilter area and media volume', lesson: 'aquaponic-ecosystem', difficulty: 2,
    gen(rng) {
      const F = rand(rng, 2, 20, 0.5), PC = rand(rng, 30, 45, 1), ATR = rand(rng, 0.2, 1.0, 0.05), M = pick(rng, MEDIA);
      const P = F * 1000 * PC / 100 * 0.092, A = P / ATR, Vm = A / M.ssa;
      return {
        q: `Fish receive ${F} kg d⁻¹ of ${PC} % protein feed. The biofilter uses ${M.name} with a specific surface area of ${M.ssa} m² m⁻³ and a design areal TAN removal rate of ${ATR} g m⁻² d⁻¹. What volume of media is needed?`,
        answer: Vm, tol: 0.03, unit: 'm³',
        solution: steps(
          `TAN production: \\(P_{\\text{TAN}} = ${F}\\times ${PC / 100}\\times 0.092 = ${f(P / 1000, 4)}\\) kg d⁻¹ = ${f(P)} g d⁻¹.`,
          `Biofilm area: \\(A = P_{\\text{TAN}}/r_A = ${f(P)}/${ATR} = ${f(A)}\\) m².`,
          `Media volume: \\(V = A/\\text{SSA} = ${f(A)}/${M.ssa} = ${f(Vm)}\\) m³.`)
      };
    }
  },
  {
    id: 'aq-steady-nitrate', title: 'Steady-state nitrate with plants, denitrification and water exchange', lesson: 'aquaponic-ecosystem', difficulty: 3,
    gen(rng) {
      const Nin = rand(rng, 100, 600, 10), U = rand(rng, 0.3, 0.6, 0.05), d = rand(rng, 0.1, 0.35, 0.05), V = rand(rng, 20, 120, 5), x = rand(rng, 1, 5, 0.5);
      const Q = V * x / 100, net = Nin * (1 - U - d), C = net / Q;
      return {
        q: `In a coupled aquaponic system ${Nin} g of nitrogen per day is nitrified to nitrate. Plants take up ${U * 100} % of it and ${d * 100} % is lost by denitrification. The system volume is ${V} m³ and ${x} % of the volume is exchanged with nitrate-free water each day. What is the steady-state nitrate-N concentration?`,
        answer: C, tol: 0.03, unit: 'mg NO₃⁻-N L⁻¹',
        solution: steps(
          `At steady state, input = outputs: \\(N_{\\text{in}} = U N_{\\text{in}} + d N_{\\text{in}} + Q\\,C\\).`,
          `Nitrate left for flushing: \\(${Nin}\\times(1-${U}-${d}) = ${f(net)}\\) g d⁻¹.`,
          `Exchange flow: \\(Q = ${x / 100}\\times ${V} = ${f(Q)}\\) m³ d⁻¹.`,
          `\\(C = ${f(net)}/${f(Q)} = ${f(C)}\\) g m⁻³ = ${f(C)} mg L⁻¹ NO₃⁻-N.`)
      };
    }
  },
  {
    id: 'aq-mcq-nitrifiers', title: 'Who does what in nitrification?', lesson: 'aquaponic-ecosystem', difficulty: 1,
    gen(rng) {
      const items = [
        ['Which organisms can oxidise ammonia all the way to nitrate on their own?', 'Comammox <i>Nitrospira</i>', ['<i>Nitrosomonas</i>', '<i>Nitrobacter</i>', 'Denitrifying <i>Pseudomonas</i>'], 'Daims et al. (2015) and van Kessel et al. (2015) discovered complete ammonia oxidisers (comammox) within the genus <i>Nitrospira</i>.'],
        ['Which step of nitrification releases the acidity (H⁺) that consumes alkalinity?', 'Ammonia oxidation to nitrite', ['Nitrite oxidation to nitrate', 'Plant uptake of nitrate', 'Denitrification'], '\\(\\text{NH}_4^+ + 1.5\\,\\text{O}_2 \\rightarrow \\text{NO}_2^- + 2\\,\\text{H}^+ + \\text{H}_2\\text{O}\\): all the H⁺ comes from step 1; step 2 releases none.'],
        ['What is the oxidation state of N in nitrite (NO₂⁻)?', '+3', ['−3', '+5', '0'], 'O is −2, so N + 2(−2) = −1 gives N = +3. Ammonium is −3, nitrate +5.'],
        ['Why does a new aquaponic system show a nitrite peak some days after the ammonia peak?', 'Nitrite oxidisers can only grow once nitrite is being produced by the ammonia oxidisers', ['Plants release nitrite during establishment', 'Nitrite is produced directly by the fish gills', 'Nitrite is formed by denitrification in the sump'], 'The two populations grow in sequence: NOB start from a small inoculum and need their substrate, nitrite, to accumulate first (SRAC 4502).']
      ];
      const [q, c, w, s] = pick(rng, items);
      return mcq(rng, q, c, w, `<p>${s}</p>`);
    }
  },

  /* ======================= 6.2 aquaponic design ======================= */
  {
    id: 'aq-frr-area', title: 'Plant growing area from the feed-rate ratio', lesson: 'aquaponic-design', difficulty: 1,
    gen(rng) {
      const F = rand(rng, 1, 30, 0.5), FRR = rand(rng, 40, 100, 5);
      const A = F * 1000 / FRR;
      return {
        q: `A raft aquaponic system receives ${F} kg of fish feed per day. The designer chooses a feed-rate ratio of ${FRR} g of feed per m² of plant growing area per day. What raft area is required?`,
        answer: A, tol: 0.02, unit: 'm²',
        solution: steps(
          `\\(A_{\\text{plant}} = F/\\text{FRR}\\).`,
          `\\(A = ${F * 1000}\\,\\text{g d}^{-1} / ${FRR}\\,\\text{g m}^{-2}\\,\\text{d}^{-1} = ${f(A)}\\) m².`,
          `Rakocy et al. (2006) recommend 60–100 g m⁻² d⁻¹ for raft culture (low end for small lettuce, high end for large leafy crops).`)
      };
    }
  },
  {
    id: 'aq-frr-fish', title: 'How many fish can a given plant area support?', lesson: 'aquaponic-design', difficulty: 2,
    gen(rng) {
      const A = rand(rng, 20, 400, 5), FRR = rand(rng, 50, 100, 5), r = rand(rng, 1, 3, 0.25);
      const F = A * FRR / 1000, B = F / (r / 100);
      return {
        q: `A greenhouse has ${A} m² of raft beds for lettuce. With a feed-rate ratio of ${FRR} g m⁻² d⁻¹ and fish fed ${r} % of body weight per day, what standing fish biomass does this plant area support?`,
        answer: B, tol: 0.02, unit: 'kg fish',
        solution: steps(
          `Daily feed allowed: \\(F = A\\cdot\\text{FRR} = ${A}\\times ${FRR} = ${f(F * 1000)}\\) g d⁻¹ = ${f(F)} kg d⁻¹.`,
          `Biomass: \\(B = F/r = ${f(F)}/${r / 100} = ${f(B)}\\) kg.`,
          `Note how the feeding rate matters: small fish eat a larger fraction of their weight, so fewer kilograms of small fish balance the same plant area.`)
      };
    }
  },
  {
    id: 'aq-stocking-volume', title: 'Tank volume from stocking density', lesson: 'aquaponic-design', difficulty: 2,
    gen(rng) {
      const B = rand(rng, 200, 3000, 50), SD = rand(rng, 20, 70, 5), n = randInt(rng, 2, 6);
      const V = B / SD, Vt = V / n;
      return {
        q: `A farm plans a maximum standing biomass of ${B} kg of tilapia at a final stocking density of ${SD} kg m⁻³, spread evenly over ${n} rearing tanks (staggered production). What water volume must each tank hold?`,
        answer: Vt, tol: 0.02, unit: 'm³',
        solution: steps(
          `Total rearing volume: \\(V = B/\\text{SD} = ${B}/${SD} = ${f(V)}\\) m³.`,
          `Per tank: \\(${f(V)}/${n} = ${f(Vt)}\\) m³.`,
          `For comparison, the UVI system harvested Nile tilapia at about 61.5 kg m⁻³ from 7.8 m³ tanks (Rakocy et al., 2006). Welfare, oxygen supply and water quality set the real limit.`)
      };
    }
  },
  {
    id: 'aq-annual-production', title: 'Annual fish production from feed and FCR', lesson: 'aquaponic-design', difficulty: 1,
    gen(rng) {
      const F = rand(rng, 2, 30, 0.5), FCR = rand(rng, 1.0, 1.9, 0.1);
      const P = F * 365 / FCR / 1000;
      return {
        q: `A system is fed an average of ${F} kg d⁻¹ all year. The feed conversion ratio (kg feed per kg fish gain) is ${FCR}. Estimate the annual fish production.`,
        answer: P, tol: 0.02, unit: 't yr⁻¹',
        solution: steps(
          `Annual feed: \\(${F}\\times 365 = ${f(F * 365)}\\) kg.`,
          `Fish gain: \\(${f(F * 365)}/${FCR} = ${f(F * 365 / FCR)}\\) kg = ${f(P)} t yr⁻¹.`)
      };
    }
  },
  {
    id: 'aq-p-balance', title: 'Phosphorus mass balance', lesson: 'aquaponic-design', difficulty: 2,
    gen(rng) {
      const F = rand(rng, 2, 25, 0.5), p = rand(rng, 0.8, 1.5, 0.1), r = rand(rng, 0.2, 0.4, 0.05), s = rand(rng, 0.3, 0.55, 0.05);
      const Pf = F * 1000 * p / 100, Pd = Pf * (1 - r - s);
      return {
        q: `Fish receive ${F} kg d⁻¹ of feed containing ${p} % phosphorus. The fish retain ${r * 100} % of feed P and ${s * 100} % leaves the system in the removed solids (sludge). How much dissolved P remains available to the plants each day?`,
        answer: Pd, tol: 0.02, unit: 'g P d⁻¹',
        solution: steps(
          `P in feed: \\(${F * 1000}\\times ${p / 100} = ${f(Pf)}\\) g d⁻¹.`,
          `Retained in fish: ${f(Pf * r)} g; lost with sludge: ${f(Pf * s)} g.`,
          `Dissolved P: \\(${f(Pf)}\\times(1-${r}-${s}) = ${f(Pd)}\\) g d⁻¹. Mineralising the sludge could return much of the ${f(Pf * s)} g d⁻¹.`)
      };
    }
  },
  {
    id: 'aq-mineralisation', title: 'Sludge mineralisation loop (decoupled design)', lesson: 'aquaponic-design', difficulty: 3,
    gen(rng) {
      const F = rand(rng, 5, 50, 1), k = rand(rng, 0.2, 0.35, 0.05), pi = rand(rng, 0.01, 0.03, 0.005), pP = rand(rng, 0.8, 1.5, 0.1), fs = rand(rng, 0.4, 0.65, 0.05), eta = rand(rng, 0.6, 0.9, 0.05);
      const Q = F * k / pi, M = F * 1000 * pP / 100 * fs * eta, C = M * 1000 / Q;
      return {
        q: `A RAS feeds ${F} kg d⁻¹. ${k * 100} % of the feed mass ends up as sludge, which a radial-flow settler concentrates to ${pi * 100} % dry matter. The feed contains ${pP} % P, of which ${fs * 100} % ends up in the sludge; the reactors mineralise ${eta * 100} % of it. What P concentration leaves the mineralisation loop (assume 1 kg of sludge water ≈ 1 L)?`,
        answer: C, tol: 0.03, unit: 'mg P L⁻¹',
        solution: steps(
          `Sludge-water flow: \\(Q_{\\text{MIN}} = F\\,k_{\\text{sludge}}/\\pi_{\\text{sludge}} = ${F}\\times ${k}/${pi} = ${f(Q)}\\) kg d⁻¹ ≈ ${f(Q)} L d⁻¹.`,
          `P mineralised: \\(${F * 1000}\\times ${pP / 100}\\times ${fs}\\times ${eta} = ${f(M)}\\) g d⁻¹.`,
          `Concentration: \\(${f(M)}\\times 1000/${f(Q)} = ${f(C)}\\) mg L⁻¹ (Goddek et al., 2019, Eqs 8.1–8.3). This is several times a typical hydroponic P level, so the stream is a concentrated fertiliser.`)
      };
    }
  },
  {
    id: 'aq-mcq-design', title: 'Coupled or decoupled?', lesson: 'aquaponic-design', difficulty: 1,
    gen(rng) {
      const items = [
        ['In a decoupled (two-loop) aquaponic system, what mainly sets how much water flows from the fish loop to the plant loop?', 'The evapotranspiration of the crop', ['The pump capacity of the fish loop', 'The feed-rate ratio', 'The biofilter area'], 'Water is sent one way to the hydroponic loop only as fast as the crop evapotranspires it; the RAS is topped up with fresh water.'],
        ['Why is pH near 7 a compromise in coupled aquaponics?', 'Nitrifiers prefer pH above 7 while plant micronutrient availability is best near pH 5.5–6.5', ['Fish cannot survive above pH 7', 'Nitrate becomes toxic above pH 7', 'Plants take up only ammonium below pH 7'], 'Rakocy et al. (2006): nitrification is most efficient in the high 7s–8s; Fe, Mn, Cu, Zn and B become less available above pH 7.'],
        ['Which nutrient is most commonly supplemented together with pH control in coupled aquaponics?', 'Potassium, added as KOH', ['Nitrogen, added as urea', 'Sodium, added as NaHCO₃', 'Phosphorus, added as phosphoric acid'], 'Fish feed contains little K; KOH neutralises nitrification acidity and supplies K at the same time.'],
        ['According to the EU organic regulation (EU) 2018/848, can lettuce from a raft aquaponic system be certified organic?', 'No — hydroponic production is prohibited in EU organic farming', ['Yes, if the fish feed is organic', 'Yes, because the nutrients come from fish', 'Only if the fish are herbivorous'], 'Annex II, Part I, point 1.2 prohibits hydroponic production; organic crops must be grown in living soil.']
      ];
      const [q, c, w, s] = pick(rng, items);
      return mcq(rng, q, c, w, `<p>${s}</p>`);
    }
  },

  /* ======================= 6.3 water quality and welfare ======================= */
  {
    id: 'aq-pka-temperature', title: 'Ammonium pKa at a given temperature', lesson: 'fish-water-quality', difficulty: 1,
    gen(rng) {
      const T = rand(rng, 5, 32, 1);
      const p = pKa(T);
      return {
        q: `Calculate the p\\(K_a\\) of the ammonium ion at ${T} °C using Emerson et al. (1975): \\(\\text{p}K_a = 0.09018 + 2729.92/T\\) with \\(T\\) in kelvin.`,
        answer: p, abstol: 0.005, unit: '',
        solution: steps(
          `\\(T = ${T} + 273.15 = ${f(T + 273.15, 5)}\\) K.`,
          `\\(\\text{p}K_a = 0.09018 + 2729.92/${f(T + 273.15, 5)} = ${p.toFixed(3)}\\).`,
          `Warmer water → lower pKa → a larger share of TAN is toxic NH₃ at the same pH.`)
      };
    }
  },
  {
    id: 'aq-nh3-fraction', title: 'Un-ionised ammonia from TAN, pH and temperature', lesson: 'fish-water-quality', difficulty: 2,
    gen(rng) {
      const pH = rand(rng, 6.5, 8.6, 0.1), T = rand(rng, 10, 30, 1), TAN = rand(rng, 0.3, 4, 0.1);
      const fr = nh3Fraction(pH, T), N = TAN * fr;
      return {
        q: `The water in a fish tank has TAN = ${TAN} mg L⁻¹, pH ${pH.toFixed(1)} and ${T} °C. What is the un-ionised ammonia concentration, expressed as mg NH₃-N L⁻¹?`,
        answer: N, tol: 0.03, unit: 'mg NH₃-N L⁻¹',
        solution: steps(
          `\\(\\text{p}K_a = 0.09018 + 2729.92/(${T}+273.15) = ${pKa(T).toFixed(3)}\\).`,
          `Fraction un-ionised: \\(f = 1/(1+10^{\\text{p}K_a-\\text{pH}}) = 1/(1+10^{${(pKa(T) - pH).toFixed(3)}})\\) = ${f(fr, 3)}.`,
          `\\(\\text{NH}_3\\text{-N} = \\text{TAN}\\times f\\) = ${TAN} × ${f(fr, 3)} = ${f(N, 3)} mg L⁻¹ (× 17/14 = ${f(N * 17.03 / 14.007, 3)} mg NH₃ L⁻¹).`,
          `Warm-water fish show reduced growth and gill damage from about 0.02–0.07 mg NH₃-N L⁻¹ (Masser et al., 1999): this water is ${N > 0.05 ? 'harmful' : N > 0.02 ? 'borderline' : 'within the safe range'}.`)
      };
    }
  },
  {
    id: 'aq-max-tan', title: 'Maximum allowable TAN for a species limit', lesson: 'fish-water-quality', difficulty: 3,
    gen(rng) {
      const pH = rand(rng, 6.8, 8.4, 0.1), T = rand(rng, 12, 30, 1), lim = pick(rng, [0.02, 0.025, 0.05]);
      const fr = nh3Fraction(pH, T), M = lim / fr;
      return {
        q: `A manager wants un-ionised ammonia to stay below ${lim} mg NH₃-N L⁻¹. At pH ${pH.toFixed(1)} and ${T} °C, what is the highest TAN concentration that satisfies this limit?`,
        answer: M, tol: 0.03, unit: 'mg TAN L⁻¹',
        solution: steps(
          `\\(\\text{p}K_a(${T}\\,{}^{\\circ}\\text{C}) = ${pKa(T).toFixed(3)}\\), so \\(f = 1/(1+10^{${(pKa(T) - pH).toFixed(3)}}) = ${f(fr, 3)}\\).`,
          `\\(\\text{TAN}_{\\max} = \\text{NH}_3\\text{-N}_{\\lim}/f = ${lim}/${f(fr, 3)} = ${f(M, 3)}\\) mg L⁻¹.`,
          `Lowering pH by one unit raises the allowable TAN almost tenfold — one reason coupled aquaponics runs near pH 7.`)
      };
    }
  },
  {
    id: 'aq-chloride-salt', title: 'Salt needed to protect fish against nitrite', lesson: 'fish-water-quality', difficulty: 2,
    gen(rng) {
      const V = rand(rng, 2, 60, 1), NO2 = rand(rng, 1, 5, 0.1), R = pick(rng, [6, 10]);
      const Cl = rand(rng, 2, Math.max(3, Math.floor(R * NO2 * 0.7)), 1);
      const need = R * NO2 - Cl, salt = need * V * 58.44 / 35.45;
      return {
        q: `A ${V} m³ system has ${NO2} mg L⁻¹ nitrite-N and ${Cl} mg L⁻¹ chloride. To protect the fish you want a chloride : nitrite-N ratio of at least ${R} : 1. How much sodium chloride (NaCl) must be added?`,
        answer: salt, tol: 0.03, unit: 'g NaCl',
        solution: steps(
          `Chloride target: \\(${R}\\times ${NO2} = ${f(R * NO2)}\\) mg L⁻¹; increase needed: \\(${f(R * NO2)} - ${Cl} = ${f(need)}\\) mg L⁻¹.`,
          `Chloride mass: \\(${f(need)}\\,\\text{g m}^{-3}\\times ${V}\\,\\text{m}^3 = ${f(need * V)}\\) g Cl⁻.`,
          `NaCl is 35.45/58.44 = 60.7 % chloride: \\(${f(need * V)}\\times 58.44/35.45 = ${f(salt)}\\) g NaCl.`,
          `Check the plants: this adds ${f(need * 22.99 / 35.45)} mg L⁻¹ Na⁺; keep Na⁺ below about 50 mg L⁻¹ for lettuce (Rakocy et al., 2006).`)
      };
    }
  },
  {
    id: 'aq-do-flow', title: 'Water flow needed to supply oxygen', lesson: 'fish-water-quality', difficulty: 2,
    gen(rng) {
      const F = rand(rng, 2, 25, 0.5), a = rand(rng, 0.3, 0.75, 0.05), Cin = rand(rng, 7, 9, 0.5), Cout = rand(rng, 4, 6, 0.5);
      const O = F * a * 1000, Q = O / (Cin - Cout) / 24;
      return {
        q: `Fish and bacteria consume ${a} kg O₂ per kg of feed. The fish tank receives ${F} kg feed d⁻¹ and has no in-tank aeration. Water enters at ${Cin} mg L⁻¹ DO and must leave at no less than ${Cout} mg L⁻¹. What flow rate is required?`,
        answer: Q, tol: 0.03, unit: 'm³ h⁻¹',
        solution: steps(
          `Oxygen demand: \\(${F}\\times ${a} = ${f(F * a)}\\) kg O₂ d⁻¹ = ${f(O)} g d⁻¹.`,
          `Each m³ of water can deliver \\(${Cin}-${Cout} = ${f(Cin - Cout)}\\) g O₂.`,
          `\\(Q = ${f(O)}/${f(Cin - Cout)} = ${f(O / (Cin - Cout))}\\) m³ d⁻¹ = ${f(Q)} m³ h⁻¹.`,
          `This is why intensive tanks are aerated or oxygenated in place — otherwise pumping costs explode.`)
      };
    }
  },
  {
    id: 'aq-co2-alkalinity', title: 'Dissolved CO₂ from pH and alkalinity', lesson: 'fish-water-quality', difficulty: 3,
    gen(rng) {
      const pH = rand(rng, 6.4, 7.8, 0.1), A = rand(rng, 20, 200, 10);
      const C = 44.01 / 50.04 * A * Math.pow(10, 6.35 - pH);
      return {
        q: `A tank has pH ${pH.toFixed(1)} and a total alkalinity of ${A} mg L⁻¹ as CaCO₃ (assume all alkalinity is bicarbonate and p\\(K_1\\) = 6.35). Estimate the free CO₂ concentration.`,
        answer: C, tol: 0.03, unit: 'mg CO₂ L⁻¹',
        solution: steps(
          `Bicarbonate: \\([\\text{HCO}_3^-] = ${A}/50\\,040\\) = ${f(A / 50040, 3)} mol L⁻¹.`,
          `\\([\\text{CO}_2] = [\\text{HCO}_3^-]\\,10^{\\text{p}K_1-\\text{pH}}\\) = ${f(A / 50040, 3)} × 10<sup>${(6.35 - pH).toFixed(2)}</sup> mol L⁻¹.`,
          `In mg L⁻¹: \\(\\text{CO}_2 = 0.88\\,\\text{Alk}\\,10^{\\text{p}K_1-\\text{pH}} = ${f(C)}\\) mg L⁻¹.`,
          `${C > 20 ? 'Above the ~20 mg L⁻¹ stress level for fish — degas (aerate, cascade) or raise pH.' : 'Below the ~20 mg L⁻¹ stress level usually quoted for fish.'}`)
      };
    }
  },

  /* ======================= 6.2 additions: hydraulics, solids, decoupling, energy, supplements ======================= */
  {
    id: 'aq-flow-for-tan', title: 'Recirculation flow needed to hold a TAN target', lesson: 'aquaponic-design', difficulty: 2,
    gen(rng) {
      const F = rand(rng, 3, 30, 0.5), PC = rand(rng, 28, 45, 1), C = pick(rng, [0.5, 1, 1.5, 2]), eta = rand(rng, 0.3, 0.7, 0.05), V = rand(rng, 5, 60, 1);
      const P = 0.092 * F * PC / 100 * 1000, Qd = P / (eta * C), Qh = Qd / 24;
      return {
        q: `Fish receive ${F} kg d⁻¹ of a ${PC} % protein feed. The rearing tanks (${V} m³ in total) must stay at or below ${C} mg TAN L⁻¹, and the biofilter plus plants remove ${f(eta * 100, 2)} % of the TAN on each pass. What recirculation flow is needed?`,
        answer: Qh, tol: 0.03, unit: 'm³ h⁻¹',
        solution: steps(
          `TAN production: \\(P = 0.092\\,F\\,PC = 0.092\\times ${F}\\times ${PC / 100}\\) = ${f(P / 1000, 3)} kg d⁻¹ = ${f(P)} g d⁻¹.`,
          `Steady state in a recirculating tank: \\(C_T = P/(\\eta Q)\\), so \\(Q = P/(\\eta C_T)\\) = ${f(P)}/(${eta} × ${C}) = ${f(Qd)} m³ d⁻¹.`,
          `Q = ${f(Qd)}/24 = ${f(Qh)} m³ h⁻¹. Retention time in the rearing tanks: V/Q = ${f(V / Qh * 60)} min.`)
      };
    }
  },
  {
    id: 'aq-stokes-dc', title: 'Smallest particle captured by a settler (Stokes and Hazen)', lesson: 'aquaponic-design', difficulty: 2,
    gen(rng) {
      const D = rand(rng, 1.2, 4, 0.1), Q = rand(rng, 4, 30, 0.5), dr = pick(rng, [25, 50, 100, 150]), T = rand(rng, 10, 30, 1);
      const A = Math.PI * D * D / 4, ofr = Q / A, mu = 2.414e-5 * Math.pow(10, 247.8 / (T + 273.15 - 140));
      const dc = 1e6 * Math.sqrt(18 * mu * (ofr / 3600) / (9.81 * dr));
      return {
        q: `A circular settling tank of ${D} m diameter receives ${Q} m³ h⁻¹ of fish-tank water at ${T} °C (viscosity ${f(mu * 1000, 3)} × 10⁻³ Pa s). Faecal particles are ${dr} kg m⁻³ denser than water. Treating the tank as an ideal settler, what is the smallest particle diameter that is captured completely?`,
        answer: dc, tol: 0.03, unit: 'µm',
        solution: steps(
          `Surface area A = πD²/4 = ${f(A)} m²; overflow rate Q/A = ${f(ofr)} m h⁻¹ = ${f(ofr / 3.6)} × 10⁻³ m s⁻¹.`,
          `Ideal settler (Hazen): a particle is captured if \\(v_s \\ge Q/A_s\\); Stokes' law: \\(v_s = g\\,\\Delta\\rho\\,d^2/(18\\mu)\\).`,
          `Solve for the diameter: \\(d_c = \\sqrt{18\\mu\\,(Q/A_s)/(g\\,\\Delta\\rho)}\\) with μ = ${f(mu * 1000, 3)} × 10⁻³ Pa s and Δρ = ${dr} kg m⁻³: d<sub>c</sub> = ${f(dc)} µm.`,
          `Larger or denser particles settle faster and are captured; finer solids need screens or filters.`)
      };
    }
  },
  {
    id: 'aq-decoupled-ras-n', title: 'Nitrate in the fish loop of a decoupled system', lesson: 'aquaponic-design', difficulty: 3,
    gen(rng) {
      const F = rand(rng, 5, 60, 1), PC = rand(rng, 30, 45, 1), eta = rand(rng, 0.3, 0.4, 0.01), A = rand(rng, 200, 2000, 50), ET = rand(rng, 1, 3, 0.1);
      const N = F * 1000 * PC / 100 * 0.16 * eta, Q = A * ET, C = 1000 * N / Q;
      return {
        q: `In a decoupled aquaponic system the fish receive ${F} kg d⁻¹ of a ${PC} % protein feed and release ${f(eta * 100, 2)} % of the feed nitrogen in dissolved form. Water flows one way from the fish loop to ${A} m² of plants that transpire ${ET} L m⁻² d⁻¹. If no nitrogen leaves the fish loop in any other way, at what nitrate-N concentration does the fish loop settle?`,
        answer: C, tol: 0.03, unit: 'mg N L⁻¹',
        solution: steps(
          `Dissolved N released: ${F * 1000} g feed × ${PC / 100} × 0.16 × ${eta} = ${f(N)} g N d⁻¹.`,
          `The one-way flow equals crop evapotranspiration: \\(Q = A_p\\,ET_c\\) = ${A} × ${ET} = ${f(Q)} L d⁻¹.`,
          `Steady state: \\(C^* = 1000\\,N/Q\\) = 1000 × ${f(N)}/${f(Q)} = ${f(C)} mg L⁻¹.`,
          C > 250 ? `Above the ≈ 250 mg L⁻¹ tolerated by Nile tilapia: more plant area (${f(1000 * N / (250 * ET))} m² for 250 mg L⁻¹), bleed-off to denitrification or less feed is needed.` : `Below the ≈ 250 mg L⁻¹ usually quoted for Nile tilapia.`)
      };
    }
  },
  {
    id: 'aq-nutrient-frr', title: 'Feed-rate ratio balanced on one nutrient', lesson: 'aquaponic-design', difficulty: 2,
    gen(rng) {
      const isN = rng() < 0.5, ET = rand(rng, 1, 3, 0.1), PC = rand(rng, 28, 45, 1);
      const rho = isN ? 125 : 31, w = isN ? PC / 100 * 0.16 : 0.012, eta = isN ? 0.33 : 0.17;
      const R = ET * rho / (1000 * w * eta);
      return {
        q: `Lettuce transpires ${ET} L m⁻² d⁻¹ and takes up ${isN ? 'nitrogen' : 'phosphorus'} at the concentration of a commercial lettuce solution (${rho} mg ${isN ? 'N' : 'P'} L⁻¹). The fish feed contains ${isN ? `${PC} % crude protein (16 % N in protein)` : '1.2 % P'}, and the fish release ${eta * 100} % of the fed ${isN ? 'N' : 'P'} in dissolved form. Which feed-rate ratio would supply exactly the ${isN ? 'nitrogen' : 'phosphorus'} the crop takes up?`,
        answer: R, tol: 0.03, unit: 'g feed m⁻² d⁻¹',
        solution: steps(
          `Crop uptake: \\(u = ET_c\\,\\rho/1000\\) = ${ET} × ${rho}/1000 = ${f(ET * rho / 1000, 3)} g m⁻² d⁻¹.`,
          `Dissolved supply per gram of feed: \\(w\\,\\eta\\) = ${f(w, 3)} × ${eta} = ${f(w * eta, 3)} g g⁻¹.`,
          `\\(R_F = u/(w\\,\\eta)\\) = ${f(R)} g m⁻² d⁻¹ — far below the empirical 60–100 g m⁻² d⁻¹ of raft systems${isN ? ', which therefore run with a nitrogen surplus that is denitrified or exchanged' : ''}.`)
      };
    }
  },
  {
    id: 'aq-pump-energy', title: 'Daily electricity use of a circulation pump', lesson: 'aquaponic-design', difficulty: 1,
    gen(rng) {
      const Q = rand(rng, 5, 80, 1), H = rand(rng, 0.8, 4, 0.1), eta = rand(rng, 0.35, 0.7, 0.05);
      const P = 1000 * 9.81 * (Q / 3600) * H / eta, E = P * 24 / 1000;
      return {
        q: `A pump circulates ${Q} m³ h⁻¹ against a total head of ${H} m with a wire-to-water efficiency of ${f(eta * 100, 2)} %. How much electricity does it use per day?`,
        answer: E, tol: 0.03, unit: 'kWh d⁻¹',
        solution: steps(
          `\\(P_{\\text{el}} = \\rho g Q H/\\eta_p\\) = 1000 × 9.81 × (${Q}/3600) × ${H}/${eta} = ${f(P)} W.`,
          `Energy per day: ${f(P)} W × 24 h = ${f(E)} kWh d⁻¹.`)
      };
    }
  },
  {
    id: 'aq-koh-potassium', title: 'Potassium supplied by KOH used as the pH buffer', lesson: 'aquaponic-design', difficulty: 1,
    gen(rng) {
      const m = rand(rng, 200, 1200, 50), n = randInt(rng, 2, 5), K = m * n / 7 * 39.098 / 56.106;
      return {
        q: `An aquaponic farm doses ${m} g of potassium hydroxide (KOH) ${n} times a week to keep the pH near 7. On average, how much potassium does this add per day?`,
        answer: K, tol: 0.02, unit: 'g K d⁻¹',
        solution: steps(
          `KOH per day: ${m} × ${n}/7 = ${f(m * n / 7)} g d⁻¹.`,
          `K is 39.10/56.11 = 69.7 % of KOH by mass: ${f(m * n / 7)} × 0.697 = ${f(K)} g K d⁻¹.`,
          `Compare with the crop's uptake (e.g. 1.5 L m⁻² d⁻¹ × 215 mg K L⁻¹ ≈ 0.32 g m⁻² d⁻¹ for lettuce); alternating KOH with Ca(OH)₂ avoids a K surplus.`)
      };
    }
  },

  /* ======================= 6.3 additions: oxygen, carbonate system, nitrite, units, welfare ======================= */
  {
    id: 'aq-aeration-failure', title: 'Minutes to a critical oxygen level after aeration fails', lesson: 'fish-water-quality', difficulty: 1,
    gen(rng) {
      const T = rand(rng, 12, 30, 1), sat = rand(rng, 0.7, 1.0, 0.05), D = rand(rng, 10, 90, 5), r = rand(rng, 0.2, 0.7, 0.05), Cc = pick(rng, [3, 4]);
      const Cs = doSaturation(T), C0 = Cs * sat, t = 60 * (C0 - Cc) / (D * r);
      return {
        q: `A fish tank at ${T} °C is held at ${f(sat * 100, 2)} % oxygen saturation (saturation = ${f(Cs, 3)} mg L⁻¹). It holds ${D} kg m⁻³ of fish that consume ${r} g O₂ kg⁻¹ h⁻¹. The power fails. How many minutes until the oxygen falls to ${Cc} mg L⁻¹?`,
        answer: t, tol: 0.03, unit: 'min',
        solution: steps(
          `Starting oxygen: ${f(sat, 2)} × ${f(Cs, 3)} = ${f(C0, 3)} mg L⁻¹.`,
          `Consumption per litre: \\(D\\,r\\) = ${D} × ${r} = ${f(D * r)} mg L⁻¹ h⁻¹ (1 g m⁻³ = 1 mg L⁻¹).`,
          `\\(t = (C_0 - C_{\\text{crit}})/(D\\,r)\\) = (${f(C0, 3)} − ${Cc})/${f(D * r)} h = ${f(t)} min — hence automatic backup aeration or oxygen.`)
      };
    }
  },
  {
    id: 'aq-ph-after-alk-loss', title: 'pH after nitrification consumes alkalinity', lesson: 'fish-water-quality', difficulty: 3,
    gen(rng) {
      const pH0 = rand(rng, 6.8, 7.6, 0.1), A0 = rand(rng, 60, 200, 10), A1 = rand(rng, 15, Math.max(20, Math.floor(A0 * 0.6)), 5);
      const CO2 = 0.8795 * A0 * Math.pow(10, 6.35 - pH0), pH1 = 6.35 + Math.log10(0.8795 * A1 / CO2);
      return {
        q: `A tank has pH ${pH0.toFixed(1)} and an alkalinity of ${A0} mg L⁻¹ as CaCO₃. Without base additions, nitrification lowers the alkalinity to ${A1} mg L⁻¹ while the free CO₂ stays constant. Taking p\\(K_1\\) = 6.35, what is the new pH?`,
        answer: pH1, abstol: 0.03, unit: '',
        solution: steps(
          `Free CO₂ (Henderson–Hasselbalch): \\(C = 0.88\\,\\text{Alk}\\,10^{\\text{p}K_1-\\text{pH}}\\) = 0.88 × ${A0} × 10<sup>${(6.35 - pH0).toFixed(2)}</sup> = ${f(CO2, 3)} mg L⁻¹.`,
          `New pH: \\(\\text{pH} = \\text{p}K_1 + \\log_{10}(0.88\\,\\text{Alk}/C)\\) = 6.35 + log₁₀(0.88 × ${A1}/${f(CO2, 3)}) = ${pH1.toFixed(2)}.`,
          `Shortcut at constant CO₂: ΔpH = log₁₀(${A1}/${A0}) = ${Math.log10(A1 / A0).toFixed(2)}. Lost alkalinity is cured with base (KOH, Ca(OH)₂), not with aeration.`)
      };
    }
  },
  {
    id: 'aq-salt-sodium', title: 'Sodium added when chloride protects against nitrite', lesson: 'fish-water-quality', difficulty: 2,
    gen(rng) {
      const R = pick(rng, [6, 8, 10]), N = rand(rng, 0.8, 5, 0.1), Cl = rand(rng, 2, Math.max(3, Math.floor(R * N * 0.6)), 1), Na0 = rand(rng, 5, 35, 1);
      const d = R * N - Cl, Na = Na0 + d * 22.990 / 35.453;
      return {
        q: `The water of a coupled aquaponic system contains ${N} mg L⁻¹ nitrite-N, ${Cl} mg L⁻¹ chloride and ${Na0} mg L⁻¹ sodium. Enough NaCl is added to reach a chloride to nitrite-N ratio of ${R}:1. What is the sodium concentration afterwards?`,
        answer: Na, tol: 0.03, unit: 'mg Na L⁻¹',
        solution: steps(
          `Chloride to add: ${R} × ${N} − ${Cl} = ${f(d)} mg L⁻¹.`,
          `NaCl brings 22.99/35.45 = 0.649 mg Na per mg Cl: +${f(d * 0.6485)} mg Na L⁻¹.`,
          `Sodium after dosing: ${Na0} + ${f(d * 0.6485)} = ${f(Na)} mg L⁻¹ — ${Na > 50 ? 'above the ≈ 50 mg L⁻¹ that hydroponic crops tolerate; CaCl₂ would protect the fish without sodium' : 'below the ≈ 50 mg L⁻¹ limit for hydroponic crops'}.`)
      };
    }
  },
  {
    id: 'aq-units-n-forms', title: 'Converting between NH₃-N and NH₃, or NO₂⁻-N and NO₂⁻', lesson: 'fish-water-quality', difficulty: 1,
    gen(rng) {
      const nh3 = rng() < 0.5, v = nh3 ? rand(rng, 0.01, 0.2, 0.005) : rand(rng, 0.2, 5, 0.1);
      const fac = nh3 ? 17.031 / 14.007 : 46.005 / 14.007, ans = v * fac;
      return {
        q: nh3 ? `A calculation gives ${v} mg L⁻¹ un-ionised ammonia as NH₃-N. A guideline you want to compare with is expressed as the NH₃ molecule. What is the concentration as NH₃?` : `A laboratory reports ${v} mg L⁻¹ nitrite-N (NO₂⁻-N). Your test kit reports nitrite as the NO₂⁻ ion. What reading would the kit show?`,
        answer: ans, tol: 0.02, unit: nh3 ? 'mg NH₃ L⁻¹' : 'mg NO₂⁻ L⁻¹',
        solution: steps(
          nh3 ? 'Multiply by the ratio of molar masses NH₃/N = 17.03/14.01 = 1.216.' : 'Multiply by the ratio of molar masses NO₂⁻/N = 46.01/14.01 = 3.284.',
          `${v} × ${f(fac, 4)} = ${f(ans, 3)} ${nh3 ? 'mg NH₃ L⁻¹' : 'mg NO₂⁻ L⁻¹'}. Always check which form a guideline or kit uses.`)
      };
    }
  },
  {
    id: 'aq-mcq-welfare-safety', title: 'Fish welfare, EU law and food safety', lesson: 'fish-water-quality', difficulty: 1,
    gen(rng) {
      const items = [
        ['Under Regulation (EC) No 1099/2009, what applies to farmed fish at the time of killing?', 'Only the key principle that they must be spared avoidable pain, distress or suffering', ['The full stunning rules that apply to cattle and pigs', 'No EU rules at all', 'A ban on slaughter without electrical stunning'], 'Article 1(1): for fish only Article 3(1) applies; member states may adopt stricter rules — Sweden requires stunning of animals killed by bleeding (Djurskyddslag 2018:1192).'],
        ['Which of the following is one of the domains of the Five Domains welfare model?', 'Behavioural interactions', ['Feed conversion ratio', 'Profitability', 'Stocking density'], 'The domains are nutrition, physical environment, health, behavioural interactions and mental state (Mellor et al., 2020).'],
        ['Why are antibiotics avoided in coupled aquaponic systems?', 'They can harm the nitrifying biofilm and may be taken up by the plants', ['They are ineffective against fish bacteria', 'They raise the pH above 9', 'They precipitate iron chelates'], 'Goddek et al. (2015); Yavuzcan Yildiz et al. (2017): drugs harm beneficial microbes and can be absorbed by plants; sick fish are treated in a separate tank.'],
        ['What did Wang, Deering and Kim (2020) find for Shiga-toxin-producing E. coli in greenhouse aquaponics?', 'It occurred in fish faeces, water and on root surfaces, but not inside roots, leaves or fruit', ['It was absent from all samples', 'It was found inside lettuce leaves', 'It occurred only in hydroponic, not in aquaponic, systems'], 'The main production risk is splashing contaminated water onto edible parts; pathogen-free fish and hygiene reduce it.'],
        ['What did Ellis et al. (2002) conclude about stocking density and trout welfare?', 'Prescribing water quality, health, condition and behavioural indicators is more practical than capping density', ['Densities above 20 kg m⁻³ always cause chronic crowding stress', 'Density has no effect on growth or fin condition', 'Low densities are always better for welfare'], 'Higher density reduced growth and condition and increased fin erosion, largely through water quality; low densities can also increase aggression.']
      ];
      const [q, c, w, s] = pick(rng, items);
      return mcq(rng, q, c, w, `<p>${s}</p>`);
    }
  }
];
