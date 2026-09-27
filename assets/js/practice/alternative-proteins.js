/* ==========================================================================
   Practice generators — Module 12: Alternative proteins
   Lessons: protein-transition (12.1), plant-based-proteins (12.2),
            fermentation (12.3), cultivated-meat (12.4), insects-algae (12.5)
   Constants follow the lessons so that lessons and practice agree:
     safe protein intake 0.83 g kg⁻¹ d⁻¹; 17 kJ g⁻¹ protein;
     FAO (2013) scoring patterns and the Lesson 12.1 teaching dataset (wheat, pea);
     biomass CH1.8O0.5N0.2: 24.63 g C-mol⁻¹, degree of reduction 4.2; glucose 30.03 g C-mol⁻¹, 4;
     460 kJ per mol O₂ (Thornton's rule); 3.5 ng per animal cell; ν = 0.7 mm² s⁻¹ at 37 °C;
     insect CO₂ production from Oonincx et al. (2010); insect k_p = 4.76 (Janssen et al. 2017);
     iodine UL 600 µg d⁻¹ (EFSA 2006).
   ========================================================================== */
import { rand, randInt, pick, f, fm, steps, mcq } from './helpers.js';

/* ---------- local data ---------- */
const AA = ['Lys', 'Thr', 'SAA'];
const AA_NAME = { Lys: 'lysine', Thr: 'threonine', SAA: 'sulfur amino acids' };
const PAT = {
  child: { name: 'child (6 mo–3 y)', Lys: 57, Thr: 31, SAA: 27 },
  adult: { name: 'older child, adolescent and adult', Lys: 48, Thr: 25, SAA: 23 }
};
const WHEAT = { Lys: 25, Thr: 28, SAA: 38, id: 0.88 };   // teaching dataset, Lesson 12.1
const PEA = { Lys: 72, Thr: 38, SAA: 24, id: 0.85 };
const INSECTS = [
  { name: 'yellow mealworm larvae at 25 °C', r: 61 },
  { name: 'house crickets at 28 °C', r: 68 },
  { name: 'migratory locusts at 32 °C', r: 110 }
];
const CROPS = [
  { name: 'field pea', Y: [2.5, 5], xp: [21, 26] },
  { name: 'faba bean', Y: [3, 6], xp: [26, 32] },
  { name: 'soybean', Y: [2, 4], xp: [36, 42] },
  { name: 'oats', Y: [4, 7], xp: [11, 15] }
];
const insectHeatW = (tonnes, r, rq) => tonnes * 1000 * r / 44.01 / rq * 460e3 / 86400; // W

export default [
  /* ======================= 12.1 the protein transition ======================= */
  {
    id: 'ap-protein-requirement', title: 'Daily protein requirement from body mass', lesson: 'protein-transition', difficulty: 1,
    gen(rng) {
      const m = rand(rng, 45, 110, 1), P = 0.83 * m;
      return {
        q: `Using the safe population intake of 0.83 g protein per kg body mass per day, how much protein does a healthy adult weighing ${m} kg need per day?`,
        answer: P, tol: 0.02, unit: 'g d⁻¹',
        solution: steps(`\\(P_{\\text{req}} = r_{\\text{safe}}\\,m = 0.83\\times${fm(m)} = ${fm(P)}\\) g d⁻¹.`,
          'The safe level lies about two standard deviations above the median requirement (0.66 g kg⁻¹ d⁻¹), so it covers nearly all healthy adults.')
      };
    }
  },
  {
    id: 'ap-protein-energy-share', title: 'Protein as a share of dietary energy', lesson: 'protein-transition', difficulty: 1,
    gen(rng) {
      const P = rand(rng, 50, 130, 1), E = rand(rng, 7, 14, 0.1), s = 100 * 17 * P / (E * 1000);
      return {
        q: `A diet supplies ${P} g of protein and ${f(E)} MJ of energy per day. What percentage of the energy comes from protein? Use 17 kJ per gram of protein.`,
        answer: s, tol: 0.02, unit: 'E%',
        solution: steps(`\\(\\text{E\\%}_{\\text{prot}} = 100\\,e_pP/E_d = 100\\times17\\times${fm(P)}/${fm(E * 1000)}\\)`,
          `\\(= ${fm(s)}\\) % of the dietary energy.`)
      };
    }
  },
  {
    id: 'ap-pdcaas', title: 'Amino-acid score and PDCAAS', lesson: 'protein-transition', difficulty: 2,
    gen(rng) {
      const pat = pick(rng, [PAT.child, PAT.adult]);
      const c = { Lys: rand(rng, 20, 75, 1), Thr: rand(rng, 22, 45, 1), SAA: rand(rng, 16, 45, 1) };
      const td = rand(rng, 0.8, 0.97, 0.01);
      const ratio = k => c[k] / pat[k];
      const lim = AA.reduce((a, k) => ratio(k) < ratio(a) ? k : a, 'Lys');
      const aas = ratio(lim), pd = Math.min(1, aas * td);
      return {
        q: `A protein ingredient contains ${c.Lys} mg lysine, ${c.Thr} mg threonine and ${c.SAA} mg sulfur amino acids per g protein; its true faecal protein digestibility is ${td}. Using the ${pat.name} reference pattern (Lys ${pat.Lys}, Thr ${pat.Thr}, SAA ${pat.SAA} mg g⁻¹; other amino acids not limiting), what is its PDCAAS (as a fraction)?`,
        answer: pd, tol: 0.02, unit: '',
        solution: steps(`Ratios \\(c_i/r_i\\): Lys \\(${fm(ratio('Lys'))}\\), Thr \\(${fm(ratio('Thr'))}\\), SAA \\(${fm(ratio('SAA'))}\\).`,
          `The smallest ratio is the amino-acid score: AAS = ${f(aas)} (${AA_NAME[lim]} is limiting).`,
          `\\(\\text{PDCAAS} = \\min(1,\\ \\text{AAS}\\times\\text{TD}) = \\min(1,\\ ${fm(aas)}\\times${td}) = ${fm(pd)}\\)` + (aas * td > 1 ? ' — truncated at 1.' : '.'))
      };
    }
  },
  {
    id: 'ap-diaas-blend', title: 'DIAAS of a wheat–pea protein blend', lesson: 'protein-transition', difficulty: 3,
    gen(rng) {
      const w = rand(rng, 0.15, 0.85, 0.05), pat = PAT.child;
      const mix = k => (w * PEA.id * PEA[k] + (1 - w) * WHEAT.id * WHEAT[k]) / pat[k];
      const lim = AA.reduce((a, k) => mix(k) < mix(a) ? k : a, 'Lys');
      const D = 100 * mix(lim);
      return {
        q: `Teaching dataset (Lesson 12.1): wheat protein contains lysine 25, threonine 28 and SAA 38 mg g⁻¹ with ileal digestibility 0.88; pea protein contains lysine 72, threonine 38 and SAA 24 mg g⁻¹ with ileal digestibility 0.85. What is the DIAAS (%) of a blend in which ${Math.round(w * 100)} % of the protein comes from pea? Use the 6 mo–3 y pattern (Lys 57, Thr 31, SAA 27 mg g⁻¹).`,
        answer: D, tol: 0.02, unit: '%',
        solution: steps(`Digestible content in the blend: \\(w\\,d_{\\text{pea}}c_{\\text{pea}} + (1-w)\\,d_{\\text{wheat}}c_{\\text{wheat}}\\) with \\(w = ${fm(w)}\\).`,
          ...AA.map(k => `${AA_NAME[k]}: \\(${fm(w)}\\times0.85\\times${PEA[k]} + ${fm(1 - w)}\\times0.88\\times${WHEAT[k]} = ${fm(mix(k) * pat[k])}\\); ÷ ${pat[k]} = ${fm(mix(k))}`),
          `The lowest ratio (${AA_NAME[lim]}) sets the score: DIAAS = ${f(D)} %.`)
      };
    }
  },
  {
    id: 'ap-pce-livestock', title: 'Protein-conversion efficiency of livestock', lesson: 'protein-transition', difficulty: 2,
    gen(rng) {
      const fcr = rand(rng, 1.5, 3.5, 0.1), ye = rand(rng, 0.45, 0.75, 0.01), xe = rand(rng, 0.16, 0.22, 0.01), xf = rand(rng, 0.14, 0.22, 0.01);
      const pce = 100 * ye * xe / (fcr * xf);
      return {
        q: `An animal has a feed-conversion ratio of ${fcr} kg feed per kg live weight. ${Math.round(ye * 100)} % of the live weight is edible, the edible part contains ${Math.round(xe * 100)} % protein and the feed ${Math.round(xf * 100)} % protein. What is the protein-conversion efficiency (%)?`,
        answer: pce, tol: 0.02, unit: '%',
        solution: steps(`\\(\\text{PCE} = \\dfrac{y_e\\,x_e}{\\text{FCR}\\,x_f} = \\dfrac{${ye}\\times${xe}}{${fcr}\\times${xf}}\\)`,
          `\\(= ${fm(ye * xe)}/${fm(fcr * xf)} = ${fm(pce / 100)}\\), i.e. ${f(pce)} % of the feed protein ends up as edible protein.`)
      };
    }
  },
  {
    id: 'ap-footprint-quality', title: 'Footprint per 100 g protein, quality-adjusted', lesson: 'protein-transition', difficulty: 2,
    gen(rng) {
      const F = rand(rng, 1.5, 12, 0.1), xp = rand(rng, 12, 28, 1), D = rand(rng, 45, 115, 1);
      const F100 = F * 0.1 / (xp / 100), Fq = F100 / Math.min(1, D / 100);
      return {
        q: `A food has a carbon footprint of ${f(F)} kg CO₂e per kg and contains ${xp} % protein with a DIAAS of ${D} %. What is its quality-adjusted footprint per 100 g of protein?`,
        answer: Fq, tol: 0.02, unit: 'kg CO₂e',
        solution: steps(`Per 100 g protein: \\(F_{100} = F\\times0.1/x_p = ${fm(F)}\\times0.1/${fm(xp / 100)} = ${fm(F100)}\\) kg CO₂e.`,
          `Quality adjustment: \\(F^{*} = F_{100}/\\min(1,\\ \\text{DIAAS}/100) = ${fm(F100)}/${fm(Math.min(1, D / 100))} = ${fm(Fq)}\\) kg CO₂e` + (D >= 100 ? ' (no penalty: DIAAS ≥ 100 %).' : '.'))
      };
    }
  },
  {
    id: 'ap-phytate-zinc', title: 'Phytate:zinc molar ratio', lesson: 'protein-transition', difficulty: 1,
    gen(rng) {
      const phy = rand(rng, 300, 1500, 10), zn = rand(rng, 1.5, 8, 0.1), R = (phy / 660) / (zn / 65.38);
      return {
        q: `A daily portion of a legume-based food contains ${phy} mg phytate and ${f(zn)} mg zinc. What is the phytate:zinc molar ratio? (M = 660 g mol⁻¹ for phytate, 65.38 g mol⁻¹ for zinc.)`,
        answer: R, tol: 0.02, unit: 'mol mol⁻¹',
        solution: steps(`\\(R = \\dfrac{${phy}/660}{${fm(zn)}/65.38} = \\dfrac{${fm(phy / 660)}}{${fm(zn / 65.38)}} = ${fm(R)}\\)`,
          R > 15 ? 'Above about 15, zinc bioavailability is classed as low.' : R > 5 ? 'Between about 5 and 15, zinc bioavailability is classed as moderate.' : 'Below about 5, zinc bioavailability is classed as high.')
      };
    }
  },

  /* ======================= 12.2 plant-based proteins ======================= */
  {
    id: 'ap-protein-yield-ha', title: 'Protein yield per hectare', lesson: 'plant-based-proteins', difficulty: 1,
    gen(rng) {
      const c = pick(rng, CROPS), Y = rand(rng, c.Y[0], c.Y[1], 0.1), w = rand(rng, 12, 16, 0.5), xp = rand(rng, c.xp[0], c.xp[1], 0.5);
      const Yp = Y * 1000 * (1 - w / 100) * xp / 100;
      return {
        q: `A ${c.name} crop yields ${f(Y)} t of seed per hectare at ${w} % moisture; the dry matter contains ${xp} % protein. What is the protein yield (kg ha⁻¹)?`,
        answer: Yp, tol: 0.02, unit: 'kg ha⁻¹',
        solution: steps(`\\(Y_p = Y(1-w)x_p = ${fm(Y * 1000)}\\times${fm(1 - w / 100)}\\times${fm(xp / 100)}\\)`, `\\(= ${fm(Yp)}\\) kg protein per hectare.`)
      };
    }
  },
  {
    id: 'ap-dry-fractionation', title: 'Protein recovery in dry fractionation', lesson: 'plant-based-proteins', difficulty: 2,
    gen(rng) {
      const xF = rand(rng, 20, 26, 0.5), xP = rand(rng, 45, 62, 1);
      const yMax = Math.floor(0.9 * xF / xP * 100);
      const yP = rand(rng, Math.min(15, yMax - 5), yMax, 1);
      const R = yP * xP / xF;
      return {
        q: `Air classification splits pea flour containing ${xF} % protein into a protein-rich fine fraction with ${xP} % protein, which makes up ${yP} % of the flour mass. What fraction of the protein is recovered in the fine fraction (%)?`,
        answer: R, tol: 0.02, unit: '%',
        solution: steps(`\\(R = \\dfrac{m_Px_P}{m_Fx_F} = y_P\\,\\dfrac{x_P}{x_F} = ${fm(yP / 100)}\\times\\dfrac{${xP}}{${xF}}\\)`,
          `\\(= ${fm(R / 100)}\\) → ${f(R)} % of the protein; the rest stays in the starch-rich coarse fraction.`)
      };
    }
  },
  {
    id: 'ap-wet-isolate', title: 'Isolate output of a wet extraction line', lesson: 'plant-based-proteins', difficulty: 2,
    gen(rng) {
      const mF = rand(rng, 500, 5000, 100), xF = rand(rng, 0.22, 0.26, 0.01);
      const e = { ext: rand(rng, 0.8, 0.92, 0.01), sep: rand(rng, 0.9, 0.97, 0.01), prec: rand(rng, 0.8, 0.9, 0.01), wash: rand(rng, 0.92, 0.98, 0.01) };
      const xi = rand(rng, 0.85, 0.9, 0.01), Rt = e.ext * e.sep * e.prec * e.wash, m = mF * xF * Rt / xi;
      return {
        q: `A wet process treats ${mF} kg of pea flour (${Math.round(xF * 100)} % protein). Step yields for protein: extraction ${e.ext}, separation ${e.sep}, isoelectric precipitation ${e.prec}, washing ${e.wash}. The isolate contains ${Math.round(xi * 100)} % protein. How much isolate is produced (kg)?`,
        answer: m, tol: 0.02, unit: 'kg',
        solution: steps(`Overall protein recovery \\(R_{\\text{tot}} = ${e.ext}\\times${e.sep}\\times${e.prec}\\times${e.wash} = ${fm(Rt)}\\).`,
          `\\(m_{\\text{iso}} = m_Fx_FR_{\\text{tot}}/x_{\\text{iso}} = ${mF}\\times${xF}\\times${fm(Rt)}/${xi} = ${fm(m)}\\) kg.`)
      };
    }
  },
  {
    id: 'ap-sme', title: 'Specific mechanical energy of an extruder', lesson: 'plant-based-proteins', difficulty: 2,
    gen(rng) {
      const Pm = rand(rng, 20, 80, 1), tq = rand(rng, 40, 85, 1), Nmax = pick(rng, [600, 800, 1000]), N = rand(rng, 200, Nmax, 10);
      const md = Math.max(5, Math.round(Pm * tq / 100 * (N / Nmax) * 3600 / rand(rng, 200, 2000, 10) / 5) * 5);
      const sme = Pm * tq / 100 * (N / Nmax) * 3600 / md;
      return {
        q: `A twin-screw extruder with a ${Pm} kW motor (maximum screw speed ${Nmax} rpm) runs at ${N} rpm and ${tq} % torque while processing ${md} kg h⁻¹. What is the specific mechanical energy (kJ kg⁻¹)? Ignore gearbox losses.`,
        answer: sme, tol: 0.02, unit: 'kJ kg⁻¹',
        solution: steps(`Shaft power \\(P = P_{\\max}\\,\\dfrac{\\tau}{\\tau_{\\max}}\\,\\dfrac{N}{N_{\\max}} = ${Pm}\\times${fm(tq / 100)}\\times${fm(N / Nmax)} = ${fm(Pm * tq / 100 * N / Nmax)}\\) kW.`,
          `\\(\\text{SME} = P/\\dot m = ${fm(Pm * tq / 100 * N / Nmax)}\\ \\text{kJ s}^{-1}\\times3600/${md} = ${fm(sme)}\\) kJ kg⁻¹.`)
      };
    }
  },

  /* ======================= 12.3 fermentation ======================= */
  {
    id: 'ap-monod', title: 'Monod growth rate', lesson: 'fermentation', difficulty: 1,
    gen(rng) {
      const mu = rand(rng, 0.2, 0.6, 0.01), Ks = rand(rng, 0.05, 1, 0.01), S = rand(rng, 0.02, 5, 0.01), r = mu * S / (Ks + S);
      return {
        q: `A yeast has \\(\\mu_{\\max} = ${fm(mu)}\\) h⁻¹ and \\(K_S = ${fm(Ks)}\\) g L⁻¹ on glucose. What is its specific growth rate at a glucose concentration of ${f(S)} g L⁻¹?`,
        answer: r, tol: 0.02, unit: 'h⁻¹',
        solution: steps(`\\(\\mu = \\mu_{\\max}\\,\\dfrac{S}{K_S+S} = ${fm(mu)}\\times\\dfrac{${fm(S)}}{${fm(Ks)}+${fm(S)}} = ${fm(r)}\\) h⁻¹`,
          `That is ${f(100 * r / mu)} % of the maximum rate.`)
      };
    }
  },
  {
    id: 'ap-growth-time', title: 'Time to grow a batch culture', lesson: 'fermentation', difficulty: 1,
    gen(rng) {
      const X0 = rand(rng, 0.1, 2, 0.1), X = rand(rng, 10, 50, 1), mu = rand(rng, 0.1, 0.4, 0.01), t = Math.log(X / X0) / mu;
      return {
        q: `A culture grows exponentially at \\(\\mu = ${fm(mu)}\\) h⁻¹ from ${f(X0)} g L⁻¹. How long does it take to reach ${X} g L⁻¹?`,
        answer: t, tol: 0.02, unit: 'h',
        solution: steps(`\\(t = \\dfrac{\\ln(X/X_0)}{\\mu} = \\dfrac{\\ln(${X}/${fm(X0)})}{${fm(mu)}} = \\dfrac{${fm(Math.log(X / X0))}}{${fm(mu)}} = ${fm(t)}\\) h`,
          `Check with the doubling time \\(t_d = \\ln2/\\mu = ${fm(Math.LN2 / mu)}\\) h: ${f(Math.log2(X / X0))} doublings.`)
      };
    }
  },
  {
    id: 'ap-batch-productivity', title: 'Batch biomass and productivity', lesson: 'fermentation', difficulty: 2,
    gen(rng) {
      const Y = rand(rng, 0.4, 0.55, 0.01), S0 = rand(rng, 20, 60, 1), X0 = rand(rng, 0.2, 1, 0.1), mu = rand(rng, 0.2, 0.45, 0.01), tta = rand(rng, 4, 12, 1);
      const Xf = X0 + Y * S0, tb = Math.log(Xf / X0) / mu, Q = (Xf - X0) / (tb + tta);
      return {
        q: `A batch fermentation starts with ${S0} g L⁻¹ glucose and ${f(X0)} g L⁻¹ biomass (\\(Y_{X/S} = ${fm(Y)}\\) g g⁻¹, \\(\\mu = ${fm(mu)}\\) h⁻¹ until the glucose is exhausted). Emptying, cleaning and refilling take ${tta} h. What is the volumetric productivity over the whole cycle?`,
        answer: Q, tol: 0.02, unit: 'g L⁻¹ h⁻¹',
        solution: steps(`Final biomass \\(X_f = X_0 + Y_{X/S}S_0 = ${fm(X0)} + ${fm(Y)}\\times${S0} = ${fm(Xf)}\\) g L⁻¹.`,
          `Growth time \\(t_b = \\ln(X_f/X_0)/\\mu = ${fm(tb)}\\) h.`,
          `\\(Q_X = (X_f - X_0)/(t_b + t_{ta}) = ${fm(Xf - X0)}/${fm(tb + tta)} = ${fm(Q)}\\) g L⁻¹ h⁻¹.`)
      };
    }
  },
  {
    id: 'ap-yield-on-oxygen', title: 'Biomass yield on oxygen from an electron balance', lesson: 'fermentation', difficulty: 3,
    gen(rng) {
      const Yxs = rand(rng, 0.35, 0.55, 0.01);
      const Yc = Yxs * 30.03 / 24.63, Yox = (4 / Yc - 4.2) / 4, Yxo = 24.63 / (Yox * 31.998);
      return {
        q: `Yeast grows aerobically on glucose with \\(Y_{X/S} = ${fm(Yxs)}\\) g g⁻¹. Biomass is CH<sub>1.8</sub>O<sub>0.5</sub>N<sub>0.2</sub> (24.63 g C-mol⁻¹, degree of reduction 4.2); glucose has 30.03 g C-mol⁻¹ and degree of reduction 4. Using an electron balance, what is the biomass yield on oxygen \\(Y_{X/O}\\) in g biomass per g O₂?`,
        answer: Yxo, tol: 0.02, unit: 'g g⁻¹',
        solution: steps(`C-mol yield: \\(Y'_{X/S} = ${fm(Yxs)}\\times30.03/24.63 = ${fm(Yc)}\\) C-mol C-mol⁻¹.`,
          `Oxygen per C-mol biomass: \\(Y_{O/X} = \\tfrac14\\left(\\gamma_S/Y'_{X/S} - \\gamma_X\\right) = \\tfrac14\\left(4/${fm(Yc)} - 4.2\\right) = ${fm(Yox)}\\) mol O₂.`,
          `\\(Y_{X/O} = 24.63/(${fm(Yox)}\\times32.00) = ${fm(Yxo)}\\) g g⁻¹.`)
      };
    }
  },
  {
    id: 'ap-kla-required', title: 'Required kLa for an aerobic fermentation', lesson: 'fermentation', difficulty: 2,
    gen(rng) {
      const X = rand(rng, 5, 30, 1), mu = rand(rng, 0.05, 0.2, 0.01), Yxo = rand(rng, 1, 1.4, 0.05), Cs = rand(rng, 0.2, 0.26, 0.01), fc = rand(rng, 15, 30, 5);
      const OUR = mu * X / Yxo / 32 * 1000, kla = OUR / (Cs * (1 - fc / 100));
      return {
        q: `A culture of ${X} g L⁻¹ biomass grows at \\(\\mu = ${fm(mu)}\\) h⁻¹ with \\(Y_{X/O} = ${fm(Yxo)}\\) g g⁻¹. The O₂ saturation concentration is ${fm(Cs)} mmol L⁻¹ and dissolved O₂ must stay at ${fc} % of saturation. What \\(k_La\\) is needed?`,
        answer: kla, tol: 0.02, unit: 'h⁻¹',
        solution: steps(`\\(\\text{OUR} = \\mu X/Y_{X/O} = ${fm(mu)}\\times${X}/${fm(Yxo)} = ${fm(mu * X / Yxo)}\\) g L⁻¹ h⁻¹ = ${f(OUR)} mmol L⁻¹ h⁻¹.`,
          `Driving force \\(C^{*} - C = ${fm(Cs)}\\times${fm(1 - fc / 100)} = ${fm(Cs * (1 - fc / 100))}\\) mmol L⁻¹.`,
          `\\(k_La = \\text{OUR}/(C^{*}-C) = ${fm(kla)}\\) h⁻¹` + (kla > 500 ? ' — very demanding for a large stirred tank.' : '.'))
      };
    }
  },
  {
    id: 'ap-fermenter-heat', title: 'Metabolic heat of a fermenter', lesson: 'fermentation', difficulty: 1,
    gen(rng) {
      const OUR = rand(rng, 20, 120, 1), V = rand(rng, 10, 200, 5), Q = OUR * V * 460 / 3600;
      return {
        q: `A ${V} m³ fermenter has an oxygen uptake rate of ${OUR} mmol L⁻¹ h⁻¹. Using 460 kJ per mol O₂, what is the metabolic heat (kW)?`,
        answer: Q, tol: 0.02, unit: 'kW',
        solution: steps(`${OUR} mmol L⁻¹ h⁻¹ = ${OUR} mol m⁻³ h⁻¹; × ${V} m³ = ${f(OUR * V)} mol O₂ h⁻¹.`,
          `\\(\\dot Q = 460\\times${fm(OUR * V)}/3600 = ${fm(Q)}\\) kW — to be removed by the cooling system, on top of the stirrer power.`)
      };
    }
  },
  {
    id: 'ap-chemostat', title: 'Chemostat steady state and productivity', lesson: 'fermentation', difficulty: 2,
    gen(rng) {
      const mu = rand(rng, 0.3, 0.6, 0.01), Ks = rand(rng, 0.05, 0.5, 0.01), SR = rand(rng, 10, 30, 1), Y = rand(rng, 0.4, 0.55, 0.01);
      const D = +(mu * rand(rng, 0.3, 0.85, 0.05)).toFixed(3);
      const S = Ks * D / (mu - D), X = Y * (SR - S), P = D * X;
      return {
        q: `A chemostat is fed with ${SR} g L⁻¹ glucose at a dilution rate of ${fm(D)} h⁻¹. The organism has \\(\\mu_{\\max} = ${fm(mu)}\\) h⁻¹, \\(K_S = ${fm(Ks)}\\) g L⁻¹ and \\(Y_{X/S} = ${fm(Y)}\\) g g⁻¹. What is the biomass productivity \\(D\\bar X\\)?`,
        answer: P, tol: 0.02, unit: 'g L⁻¹ h⁻¹',
        solution: steps(`\\(\\bar S = K_SD/(\\mu_{\\max}-D) = ${fm(Ks)}\\times${fm(D)}/(${fm(mu)}-${fm(D)}) = ${fm(S)}\\) g L⁻¹.`,
          `\\(\\bar X = Y_{X/S}(S_R - \\bar S) = ${fm(Y)}\\times(${SR}-${fm(S)}) = ${fm(X)}\\) g L⁻¹.`,
          `\\(D\\bar X = ${fm(D)}\\times${fm(X)} = ${fm(P)}\\) g L⁻¹ h⁻¹.`)
      };
    }
  },
  {
    id: 'ap-plant-volume', title: 'Fermenter volume for a production target', lesson: 'fermentation', difficulty: 3,
    gen(rng) {
      const Pt = rand(rng, 5000, 30000, 500), D = rand(rng, 0.1, 0.2, 0.01), X = rand(rng, 10, 20, 0.5), phi = rand(rng, 0.85, 0.95, 0.01);
      const V = Pt * 1e6 / (D * X * 1000 * 8760 * phi);
      return {
        q: `A mycoprotein plant must produce ${f(Pt)} t of dry biomass per year in continuous culture at \\(D = ${fm(D)}\\) h⁻¹ and \\(\\bar X = ${fm(X)}\\) g L⁻¹, running ${Math.round(phi * 100)} % of the hours in a year. What total working volume is needed (m³)?`,
        answer: V, tol: 0.02, unit: 'm³',
        solution: steps(`Volumetric productivity \\(D\\bar X = ${fm(D)}\\times${fm(X)} = ${fm(D * X)}\\) g L⁻¹ h⁻¹ = ${f(D * X)} kg m⁻³ h⁻¹.`,
          `Annual output per m³: \\(${fm(D * X)}\\times8760\\times${phi} = ${fm(D * X * 8760 * phi)}\\) kg m⁻³ a⁻¹.`,
          `\\(V = ${fm(Pt * 1000)}/${fm(D * X * 8760 * phi)} = ${fm(V)}\\) m³.`)
      };
    }
  },
  {
    id: 'ap-scaleup-pv', title: 'Stirrer speed after scale-up at constant P/V', lesson: 'fermentation', difficulty: 3,
    gen(rng) {
      const Ns = rand(rng, 300, 900, 10), Vs = rand(rng, 5, 20, 1), VL = rand(rng, 1, 50, 1);
      const r = VL * 1000 / Vs, NL = Ns * Math.pow(r, -2 / 9);
      return {
        q: `A ${Vs} L laboratory fermenter is stirred at ${Ns} rpm. It is scaled up with geometric similarity to ${VL} m³ at constant power per volume (turbulent regime). What stirrer speed is needed at large scale (rpm)?`,
        answer: NL, tol: 0.02, unit: 'rpm',
        solution: steps(`\\(P/V \\propto N^3D^2\\) and \\(D \\propto V^{1/3}\\), so \\(N \\propto V^{-2/9}\\).`,
          `Volume ratio \\(${fm(VL * 1000)}/${Vs} = ${fm(r)}\\); \\(N_L = ${Ns}\\times${fm(r)}^{-2/9} = ${fm(NL)}\\) rpm.`,
          `The tip speed rises by \\(${fm(r)}^{1/9} = ${fm(Math.pow(r, 1 / 9))}\\) and the mixing time grows — the classic scale-up conflict.`)
      };
    }
  },

  /* ======================= 12.4 cultivated meat ======================= */
  {
    id: 'ap-cm-doublings', title: 'Population doublings to a production target', lesson: 'cultivated-meat', difficulty: 1,
    gen(rng) {
      const a = rand(rng, 1, 9.9, 0.1), b = randInt(rng, 6, 9), N0 = a * 10 ** b, M = rand(rng, 50, 5000, 50);
      const n = Math.log2(M / (3.5e-12 * N0));
      return {
        q: `How many population doublings are needed to grow ${f(M)} kg of cells (3.5 ng per cell) from a seed of \\(${fm(a)}\\times10^{${b}}\\) cells?`,
        answer: n, tol: 0.02, unit: 'doublings',
        solution: steps(`Target number of cells: \\(${fm(M)}/3.5\\times10^{-12} = ${fm(M / 3.5e-12)}\\).`,
          `\\(n = \\log_2\\!\\left(N_{\\text{target}}/N_0\\right) = \\log_2(${fm(M / 3.5e-12 / N0)}) = ${fm(n)}\\).`)
      };
    }
  },
  {
    id: 'ap-cm-time', title: 'Time for the cell expansion', lesson: 'cultivated-meat', difficulty: 2,
    gen(rng) {
      const N0 = rand(rng, 1, 9, 0.5) * 1e9, M = rand(rng, 200, 2000, 50), td = rand(rng, 18, 40, 1);
      const n = Math.log2(M / (3.5e-12 * N0)), t = n * td / 24;
      return {
        q: `A seed train starts from ${f(N0 / 1e9)} billion cells and must deliver ${f(M)} kg of cells (3.5 ng per cell). The cells double every ${td} h without lag phases. How many days does the expansion take?`,
        answer: t, tol: 0.02, unit: 'd',
        solution: steps(`\\(n = \\log_2\\!\\left(\\dfrac{${fm(M)}}{3.5\\times10^{-12}\\times${fm(N0)}}\\right) = ${fm(n)}\\) doublings.`,
          `\\(t = n\\,t_d = ${fm(n)}\\times${td}\\ \\text{h} = ${fm(n * td)}\\) h = ${f(t)} days (real processes add lag phases and transfers).`)
      };
    }
  },
  {
    id: 'ap-cm-o2-density', title: 'Oxygen-limited cell density', lesson: 'cultivated-meat', difficulty: 2,
    gen(rng) {
      const kla = rand(rng, 4, 20, 0.5), Cs = 0.21, fmin = rand(rng, 20, 40, 5), q = rand(rng, 0.1, 0.4, 0.05);
      const drive = Cs * (1 - fmin / 100), N = kla * drive * 1e-3 / (q * 1e-12) / 1000;
      return {
        q: `A bioreactor for animal cells reaches \\(k_La = ${fm(kla)}\\) h⁻¹. The medium is saturated with air at 0.21 mmol O₂ L⁻¹ and dissolved O₂ must stay above ${fmin} % of saturation. Each cell consumes ${fm(q)} pmol O₂ h⁻¹. What is the maximum cell density (million cells per mL)?`,
        answer: N / 1e6, tol: 0.02, unit: 'million cells mL⁻¹',
        solution: steps(`Maximum OTR: \\(k_La(C^{*}-C_{\\min}) = ${fm(kla)}\\times${fm(drive)} = ${fm(kla * drive)}\\) mmol L⁻¹ h⁻¹.`,
          `\\(N_{V,\\max} = \\dfrac{${fm(kla * drive * 1e-3)}\\ \\text{mol L}^{-1}\\text{h}^{-1}}{${fm(q)}\\times10^{-12}\\ \\text{mol h}^{-1}} = ${fm(N * 1000)}\\) cells L⁻¹ = ${f(N / 1e6)} million cells mL⁻¹.`)
      };
    }
  },
  {
    id: 'ap-cm-kolmogorov', title: 'Kolmogorov eddy size in a cell-culture reactor', lesson: 'cultivated-meat', difficulty: 2,
    gen(rng) {
      const PV = rand(rng, 10, 1000, 10), eps = PV / 1000, lam = Math.pow((0.7e-6) ** 3 / eps, 0.25) * 1e6;
      return {
        q: `A bioreactor dissipates ${PV} W m⁻³ in medium with density 1000 kg m⁻³ and kinematic viscosity 0.7 mm² s⁻¹ (37 °C). What is the Kolmogorov microscale (µm)?`,
        answer: lam, tol: 0.02, unit: 'µm',
        solution: steps(`\\(\\varepsilon = P/(\\rho V) = ${PV}/1000 = ${fm(eps)}\\) W kg⁻¹.`,
          `\\(\\lambda_K = (\\nu^3/\\varepsilon)^{1/4} = \\left((0.7\\times10^{-6})^3/${fm(eps)}\\right)^{1/4} = ${fm(lam * 1e-6)}\\) m = ${f(lam)} µm.`,
          'Compare with the size of single cells (≈ 10–20 µm) and of microcarriers (≈ 100–300 µm): eddies similar to or smaller than the particles can damage the cells.')
      };
    }
  },
  {
    id: 'ap-cm-medium-cost', title: 'Medium cost per kilogram of cells', lesson: 'cultivated-meat', difficulty: 2,
    gen(rng) {
      const vm = rand(rng, 8, 45, 1), pb = rand(rng, 0.2, 2, 0.1), cg = rand(rng, 20, 200, 10), pg = rand(rng, 0.5, 50, 0.5);
      const C = vm * (pb + cg / 1000 * pg);
      return {
        q: `Producing 1 kg of cells consumes ${vm} L of medium. The basal medium costs US$ ${f(pb)} per litre, and the medium also contains ${cg} µg L⁻¹ of a growth factor that costs US$ ${f(pg)} per mg. What is the medium cost per kg of cells?`,
        answer: C, tol: 0.02, unit: 'US$ kg⁻¹',
        solution: steps(`Growth factor per litre: \\(${cg}\\ \\mu\\text{g} = ${fm(cg / 1000)}\\) mg → US$ ${f(cg / 1000 * pg)}.`,
          `Per litre: ${f(pb)} + ${f(cg / 1000 * pg)} = US$ ${f(pb + cg / 1000 * pg)}.`,
          `\\(C_{\\text{med}} = v_m\\sum c_ip_i = ${vm}\\times${fm(pb + cg / 1000 * pg)} = ${fm(C)}\\) US$ per kg.`)
      };
    }
  },
  {
    id: 'ap-cm-diffusion', title: 'Oxygen penetration depth in dense tissue', lesson: 'cultivated-meat', difficulty: 2,
    gen(rng) {
      const Cs = rand(rng, 0.1, 0.2, 0.01), q = rand(rng, 0.1, 0.4, 0.05), rho = rand(rng, 20, 300, 10);
      const Q = q * 1e-12 / 3600 * rho * 1e12, L = Math.sqrt(2 * 2e-9 * Cs / Q) * 1e6;
      return {
        q: `A tissue construct contains ${rho} million cells per mL, each consuming ${fm(q)} pmol O₂ h⁻¹. Oxygen diffuses in from one face at ${fm(Cs)} mol m⁻³ with \\(D = 2\\times10^{-9}\\) m² s⁻¹. How deep does oxygen penetrate (µm)?`,
        answer: L, tol: 0.02, unit: 'µm',
        solution: steps(`Volumetric uptake \\(Q = q\\rho_c = ${fm(q)}\\times10^{-12}/3600\\times${fm(rho * 1e12)} = ${fm(Q)}\\) mol m⁻³ s⁻¹.`,
          `\\(L = \\sqrt{2DC_s/Q} = \\sqrt{2\\times2\\times10^{-9}\\times${fm(Cs)}/${fm(Q)}} = ${fm(L * 1e-6)}\\) m = ${f(L)} µm.`,
          'Thicker constructs need perfusion channels — the problem vascularisation solves in animals.')
      };
    }
  },
  {
    id: 'ap-cm-capital', title: 'Capital cost per kilogram with the capital recovery factor', lesson: 'cultivated-meat', difficulty: 3,
    gen(rng) {
      const I = rand(rng, 100, 1000, 10), M = rand(rng, 2, 30, 0.5), i = rand(rng, 5, 12, 0.5), n = randInt(rng, 10, 25);
      const g = Math.pow(1 + i / 100, n), crf = (i / 100) * g / (g - 1), c = crf * I * 1e6 / (M * 1e6);
      return {
        q: `A cultivated-meat plant costs US$ ${I} million and produces ${f(M)} kt of product per year. With a discount rate of ${i} % and a lifetime of ${n} years, what is the annualised capital cost per kg of product?`,
        answer: c, tol: 0.02, unit: 'US$ kg⁻¹',
        solution: steps(`\\(\\text{CRF} = \\dfrac{i(1+i)^n}{(1+i)^n-1} = \\dfrac{${fm(i / 100)}\\times${fm(g)}}{${fm(g)}-1} = ${fm(crf)}\\) per year.`,
          `Annual capital charge: \\(${fm(crf)}\\times${I}\\) million = US$ ${f(crf * I)} million.`,
          `Per kg: \\(${fm(crf * I * 1e6)}/${fm(M * 1e6)} = ${fm(c)}\\) US$ kg⁻¹.`)
      };
    }
  },
  {
    id: 'ap-cm-footprint', title: 'Carbon footprint of cultivated meat from energy use', lesson: 'cultivated-meat', difficulty: 1,
    gen(rng) {
      const e = rand(rng, 10, 40, 1), ef = pick(rng, [0.02, 0.05, 0.1, 0.25, 0.4, 0.6, 0.8]), up = rand(rng, 1, 5, 0.1), cf = e * ef + up;
      return {
        q: `A process uses ${e} kWh of electricity per kg of cultivated meat, from an electricity supply with an emission factor of ${ef} kg CO₂e kWh⁻¹; upstream inputs (medium ingredients etc.) add ${f(up)} kg CO₂e kg⁻¹. What is the carbon footprint?`,
        answer: cf, tol: 0.02, unit: 'kg CO₂e kg⁻¹',
        solution: steps(`\\(\\text{CF} = e\\,\\text{EF} + \\text{CF}_{\\text{up}} = ${e}\\times${ef} + ${fm(up)} = ${fm(cf)}\\) kg CO₂e kg⁻¹.`,
          `The electricity share is ${f(100 * e * ef / cf)} % — the grid mix decides much of the result.`)
      };
    }
  },

  /* ======================= 12.5 insects, microalgae and seaweed ======================= */
  {
    id: 'ap-ia-kp', title: 'Insect protein with the correct nitrogen factor', lesson: 'insects-algae', difficulty: 1,
    gen(rng) {
      const N = rand(rng, 6, 11, 0.1), P = 4.76 * N;
      return {
        q: `Dried insect larvae contain ${f(N)} % nitrogen (dry matter). What is their protein content (% DM) with the insect-specific factor \\(k_p = 4.76\\)?`,
        answer: P, tol: 0.02, unit: '% DM',
        solution: steps(`\\(P = k_pN = 4.76\\times${fm(N)} = ${fm(P)}\\) % DM.`,
          `With the default 6.25 it would be reported as ${f(6.25 * N)} % — an overestimate of ${f((6.25 / 4.76 - 1) * 100)} %, mainly because chitin contains nitrogen.`)
      };
    }
  },
  {
    id: 'ap-ia-insect-heat', title: 'Metabolic heat of an insect rearing room', lesson: 'insects-algae', difficulty: 2,
    gen(rng) {
      const sp = pick(rng, INSECTS), t = rand(rng, 1, 30, 0.5), rq = rand(rng, 0.8, 1, 0.05);
      const Q = insectHeatW(t, sp.r, rq) / 1000;
      return {
        q: `A room holds ${f(t)} t of live ${sp.name}, which produce ${sp.r} g CO₂ per kg per day (respiratory quotient ${fm(rq)}). Using 460 kJ per mol O₂, what is the metabolic heat (kW)?`,
        answer: Q, tol: 0.02, unit: 'kW',
        solution: steps(`CO₂: \\(${fm(t * 1000)}\\times${sp.r}/44.01 = ${fm(t * 1000 * sp.r / 44.01)}\\) mol d⁻¹; O₂: ÷ ${fm(rq)} = ${f(t * 1000 * sp.r / 44.01 / rq)} mol d⁻¹.`,
          `\\(\\dot Q = ${fm(t * 1000 * sp.r / 44.01 / rq)}\\times460\\ \\text{kJ}/86\\,400\\ \\text{s} = ${fm(Q)}\\) kW (${f(Q * 1000 / (t * 1000))} W per kg of insects).`)
      };
    }
  },
  {
    id: 'ap-ia-ventilation', title: 'Ventilation of an insect farm: heat versus CO₂', lesson: 'insects-algae', difficulty: 3,
    gen(rng) {
      const t = rand(rng, 2, 20, 0.5), dT = rand(rng, 2, 10, 0.5), rq = 0.9;
      const Q = insectHeatW(t, 61, rq), Vh = Q / (1.2 * 1005 * dT) * 3600;
      const Vc = t * 1000 * 61 / 1000 / 86400 / (1.8 * 2500e-6) * 3600;
      return {
        q: `${f(t)} t of mealworm larvae (61 g CO₂ kg⁻¹ d⁻¹, RQ 0.9, 460 kJ per mol O₂) are reared in one room. The air may warm by ${fm(dT)} K on its way through the room (air: 1.2 kg m⁻³, 1005 J kg⁻¹ K⁻¹), and CO₂ may rise by 2,500 ppm (CO₂ density 1.8 kg m⁻³). What air flow (m³ h⁻¹) is needed to satisfy both limits?`,
        answer: Math.max(Vh, Vc), tol: 0.02, unit: 'm³ h⁻¹',
        solution: steps(`Heat: \\(\\dot Q = ${fm(Q / 1000)}\\) kW; \\(\\dot V_{\\text{heat}} = \\dot Q/(\\rho_ac_p\\Delta T) = ${fm(Q)}/(1.2\\times1005\\times${fm(dT)}) = ${fm(Q / (1.2 * 1005 * dT))}\\) m³ s⁻¹ = ${f(Vh)} m³ h⁻¹.`,
          `CO₂: \\(\\dot m = ${fm(t * 1000 * 61 / 1000)}\\) kg d⁻¹; \\(\\dot V_{\\text{CO}_2} = \\dot m/(\\rho_{\\text{CO}_2}\\Delta x) = ${f(Vc)}\\) m³ h⁻¹.`,
          `The larger value governs: ${f(Math.max(Vh, Vc))} m³ h⁻¹ (${Vh > Vc ? 'heat' : 'CO₂'} is limiting).`)
      };
    }
  },
  {
    id: 'ap-ia-pce', title: 'Feed per edible kilogram and corrected PCE of insects', lesson: 'insects-algae', difficulty: 2,
    gen(rng) {
      const fcr = rand(rng, 1.5, 3, 0.1), ye = rand(rng, 0.7, 1, 0.05), xe = rand(rng, 0.15, 0.25, 0.01), xf = rand(rng, 0.14, 0.2, 0.01);
      const pce = 100 * ye * xe * (4.76 / 6.25) / (fcr * xf);
      return {
        q: `Insects convert feed (${Math.round(xf * 100)} % protein) with an FCR of ${fcr} kg kg⁻¹. ${Math.round(ye * 100)} % of the live weight is edible and its protein content is reported as ${Math.round(xe * 100)} % (N × 6.25). What is the protein-conversion efficiency (%) after correcting the insect protein with \\(k_p = 4.76\\)?`,
        answer: pce, tol: 0.02, unit: '%',
        solution: steps(`Feed per kg edible product: \\(\\text{FCR}/y_e = ${fcr}/${ye} = ${fm(fcr / ye)}\\) kg.`,
          `True protein of the edible part: \\(${xe}\\times4.76/6.25 = ${fm(xe * 4.76 / 6.25)}\\).`,
          `\\(\\text{PCE} = \\dfrac{${ye}\\times${fm(xe * 4.76 / 6.25)}}{${fcr}\\times${xf}} = ${fm(pce / 100)}\\) → ${f(pce)} % (uncorrected: ${f(pce * 6.25 / 4.76)} %).`)
      };
    }
  },
  {
    id: 'ap-ia-beer-lambert', title: 'Light at depth in an algae culture', lesson: 'insects-algae', difficulty: 1,
    gen(rng) {
      const I0 = rand(rng, 500, 2000, 50), ka = rand(rng, 0.1, 0.25, 0.01), X = rand(rng, 0.2, 3, 0.1);
      const z = rand(rng, 0.2, Math.min(5, Math.max(0.4, 5 / (ka * X * 10))), 0.1);
      const I = I0 * Math.exp(-ka * X * 1000 * z / 100);
      return {
        q: `Sunlight of ${I0} µmol m⁻² s⁻¹ enters a microalgae culture with ${f(X)} g L⁻¹ biomass and a specific absorption coefficient \\(k_a = ${fm(ka)}\\) m² g⁻¹. What is the PPFD at ${f(z)} cm depth?`,
        answer: I, tol: 0.02, unit: 'µmol m⁻² s⁻¹',
        solution: steps(`\\(k_aX = ${fm(ka)}\\times${fm(X * 1000)}\\ \\text{g m}^{-3} = ${fm(ka * X * 1000)}\\) m⁻¹.`,
          `\\(I = I_0e^{-k_aXz} = ${I0}\\,e^{-${fm(ka * X * 1000)}\\times${fm(z / 100)}} = ${I0}\\times${fm(Math.exp(-ka * X * 10 * z))} = ${fm(I)}\\) µmol m⁻² s⁻¹.`)
      };
    }
  },
  {
    id: 'ap-ia-compensation-depth', title: 'Compensation depth of an algae culture', lesson: 'insects-algae', difficulty: 2,
    gen(rng) {
      const I0 = rand(rng, 300, 2000, 50), Ic = rand(rng, 5, 20, 1), ka = rand(rng, 0.1, 0.25, 0.01), X = rand(rng, 0.2, 5, 0.1);
      const zc = Math.log(I0 / Ic) / (ka * X * 1000) * 100;
      return {
        q: `A culture with ${f(X)} g L⁻¹ biomass (\\(k_a = ${fm(ka)}\\) m² g⁻¹) receives ${I0} µmol m⁻² s⁻¹ at the surface. The compensation irradiance is ${Ic} µmol m⁻² s⁻¹. How deep (cm) is the photic zone?`,
        answer: zc, tol: 0.02, unit: 'cm',
        solution: steps(`\\(z_c = \\dfrac{\\ln(I_0/I_c)}{k_aX} = \\dfrac{\\ln(${I0}/${Ic})}{${fm(ka)}\\times${fm(X * 1000)}} = \\dfrac{${fm(Math.log(I0 / Ic))}}{${fm(ka * X * 1000)}}\\) m`,
          `\\(= ${fm(zc / 100)}\\) m = ${f(zc)} cm. Below this depth the cells respire more than they photosynthesise.`)
      };
    }
  },
  {
    id: 'ap-ia-average-light', title: 'Depth-averaged light in a mixed culture', lesson: 'insects-algae', difficulty: 2,
    gen(rng) {
      const sys = pick(rng, [{ L: 25, X: [0.1, 0.8] }, { L: 20, X: [0.1, 1] }, { L: 10, X: [0.3, 2] }, { L: 5, X: [0.5, 3] }, { L: 3, X: [1, 5] }, { L: 2, X: [1, 6] }]);
      const I0 = rand(rng, 500, 2000, 50), ka = rand(rng, 0.1, 0.25, 0.01), X = rand(rng, sys.X[0], sys.X[1], 0.1), L = sys.L;
      const K = ka * X * 1000 * L / 100, Iav = I0 * (1 - Math.exp(-K)) / K;
      return {
        q: `A well-mixed culture is ${L} cm deep, contains ${f(X)} g L⁻¹ biomass (\\(k_a = ${fm(ka)}\\) m² g⁻¹) and receives ${I0} µmol m⁻² s⁻¹. What is the depth-averaged PPFD?`,
        answer: Iav, tol: 0.02, unit: 'µmol m⁻² s⁻¹',
        solution: steps(`Optical depth \\(k_aXL = ${fm(ka)}\\times${fm(X * 1000)}\\times${fm(L / 100)} = ${fm(K)}\\).`,
          `\\(\\bar I = \\dfrac{I_0}{k_aXL}\\left(1-e^{-k_aXL}\\right) = \\dfrac{${I0}}{${fm(K)}}\\times${fm(1 - Math.exp(-K))} = ${fm(Iav)}\\) µmol m⁻² s⁻¹.`)
      };
    }
  },
  {
    id: 'ap-ia-photon-productivity', title: 'Photon-limited areal productivity of microalgae', lesson: 'insects-algae', difficulty: 2,
    gen(rng) {
      const dli = rand(rng, 10, 40, 0.5), Y = rand(rng, 0.3, 0.6, 0.05), PA = Y * dli, ann = PA * 365 / 100;
      return {
        q: `A dense algae culture absorbs all incident light. The mean daily light integral over the year is ${f(dli)} mol m⁻² d⁻¹ and the effective biomass yield on light is ${fm(Y)} g per mol photons. What is the photon-limited annual productivity (t dry matter per hectare per year)?`,
        answer: ann, tol: 0.02, unit: 't ha⁻¹ a⁻¹',
        solution: steps(`\\(P_A = Y\\,f_{\\text{abs}}\\,\\text{DLI} = ${fm(Y)}\\times1\\times${fm(dli)} = ${fm(PA)}\\) g m⁻² d⁻¹.`,
          `Per year: \\(${fm(PA)}\\times365 = ${fm(PA * 365)}\\) g m⁻² = ${f(ann)} t ha⁻¹ a⁻¹ (1 g m⁻² = 0.01 t ha⁻¹).`)
      };
    }
  },
  {
    id: 'ap-ia-harvest-energy', title: 'Harvesting energy of microalgae', lesson: 'insects-algae', difficulty: 1,
    gen(rng) {
      const eV = rand(rng, 0.3, 2, 0.1), X = rand(rng, 0.2, 5, 0.1), e = eV / X;
      return {
        q: `A centrifuge needs ${f(eV)} kWh per m³ of culture processed. What is the harvesting energy per kg of algae if the culture contains ${f(X)} g L⁻¹?`,
        answer: e, tol: 0.02, unit: 'kWh kg⁻¹',
        solution: steps(`${f(X)} g L⁻¹ = ${f(X)} kg m⁻³.`, `\\(e_h = e_V/X = ${fm(eV)}/${fm(X)} = ${fm(e)}\\) kWh kg⁻¹ (dry biomass holds ≈ 5.4 kWh kg⁻¹).`)
      };
    }
  },
  {
    id: 'ap-ia-iodine', title: 'Iodine intake from seaweed', lesson: 'insects-algae', difficulty: 1,
    gen(rng) {
      const m = rand(rng, 0.5, 10, 0.5), c = rand(rng, 2000, 6000, 50), blanched = rng() < 0.5, r = blanched ? rand(rng, 0.6, 0.94, 0.01) : 0;
      const I = m * c * (1 - r);
      return {
        q: `A portion contains ${f(m)} g of dried kelp with ${f(c)} mg iodine per kg dry weight${blanched ? `, of which blanching has removed ${Math.round(r * 100)} %` : ' (raw)'}. How much iodine does the portion supply (µg)?`,
        answer: I, tol: 0.02, unit: 'µg',
        solution: steps(`${f(c)} mg kg⁻¹ = ${f(c)} µg g⁻¹.`,
          `\\(I_{\\text{in}} = m\\,c_I(1-r) = ${fm(m)}\\times${fm(c)}\\times${fm(1 - r)} = ${fm(I)}\\) µg — ${f(I / 600)} times the adult upper intake level of 600 µg d⁻¹.`)
      };
    }
  },
  {
    id: 'ap-ia-seaweed-carbon', title: 'Nitrogen and carbon removed by a kelp farm', lesson: 'insects-algae', difficulty: 1,
    gen(rng) {
      const Y = rand(rng, 1.5, 8, 0.1), wC = rand(rng, 25, 35, 1), co2 = Y * wC / 100 * 44 / 12;
      return {
        q: `A kelp farm harvests ${f(Y)} t of dry biomass per hectare per year; the biomass contains ${wC} % carbon. How much CO₂ (t ha⁻¹ a⁻¹) did the kelp take up to build this carbon?`,
        answer: co2, tol: 0.02, unit: 't CO₂ ha⁻¹ a⁻¹',
        solution: steps(`\\(R_C = Y_{\\text{DW}}\\,w_C = ${fm(Y)}\\times${fm(wC / 100)} = ${fm(Y * wC / 100)}\\) t C.`,
          `\\(R_{\\text{CO}_2} = \\tfrac{44}{12}R_C = ${fm(co2)}\\) t CO₂ — uptake, not sequestration, if the kelp is eaten.`)
      };
    }
  },
  {
    id: 'ap-ia-sequestration-concept', title: 'Uptake versus sequestration in seaweed farming', lesson: 'insects-algae', difficulty: 1,
    gen(rng) {
      const C = rand(rng, 500, 1500, 50), co2 = C * 44 / 12 / 1000;
      return mcq(rng,
        `A kelp farm sells its harvest as food. The harvested biomass contains ${f(C)} kg of carbon per hectare per year, equivalent to ${f(co2)} t CO₂. Which statement is correct?`,
        'The CO₂ is only taken up temporarily: eaten seaweed returns its carbon to the atmosphere within months, so this is not sequestration.',
        [`The farm sequesters ${f(co2)} t CO₂ ha⁻¹ a⁻¹, because the carbon has been removed from the sea.`,
          `The farm sequesters ${f(C / 1000)} t CO₂ ha⁻¹ a⁻¹, because only the carbon atoms count.`,
          'Seaweed releases more CO₂ than it absorbs, so the farm is a net source of CO₂.'],
        '<p>Sequestration means storage for more than 100 years. Carbon in food enters the fast carbon cycle; the climate benefit of food seaweed lies in replacing higher-footprint foods or feeds (Hurd et al., 2022; Troell et al., 2023).</p>');
    }
  },
  {
    id: 'ap-ia-light-limit-concept', title: 'What limits the areal productivity of dense algae cultures?', lesson: 'insects-algae', difficulty: 2,
    gen(rng) {
      return mcq(rng,
        'A nutrient-replete, light-limited microalgae culture already absorbs practically all incident light. Which change raises its productivity per square metre the most?',
        'Moving the system to a site or season with a higher daily light integral',
        ['Doubling the biomass concentration', 'Making the culture twice as deep', 'Switching from a raceway pond to a photobioreactor with the same footprint and light'],
        '<p>When all photons are absorbed, areal productivity is capped by the photon supply times the yield on light (Eq. 12.5.7). More biomass or depth only adds dark volume and respiration; a photobioreactor raises the concentration and eases harvesting, but not the photon supply.</p>');
    }
  }
];
