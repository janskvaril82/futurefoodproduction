/* Practice generators — Module 15: Sustainability, resilience and accessibility
   Lessons: lca-emerging-systems (15.1), resilience (15.2), accessibility-equity (15.3),
            multi-criteria-assessment (15.4).
   Each generator returns a numeric problem { q, answer, tol|abstol, unit, solution }
   or an MCQ built with mcq(). Numbers inside \( … \) are formatted with m() (no
   thousands separators, so KaTeX renders them cleanly). */
import { rand, randInt, pick, f, steps, mcq } from './helpers.js';

/** Plain number for use inside maths (no locale separators). */
function m(v, sig = 3) {
  if (!isFinite(v)) return '\\text{—}';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) {
    const e = Math.floor(Math.log10(a));
    return `${(v / 10 ** e).toPrecision(sig)}\\times10^{${e}}`;
  }
  return String(+v.toPrecision(sig));
}
const sum = a => a.reduce((s, x) => s + x, 0);
/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf). */
function phi(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
/** Principal eigenvector (power iteration) of a positive matrix. */
function eigen(A) {
  const n = A.length; let w = new Array(n).fill(1 / n), lam = n;
  for (let it = 0; it < 500; it++) {
    const v = A.map(r => r.reduce((s, x, j) => s + x * w[j], 0));
    const s = sum(v); lam = sum(v.map((x, i) => x / w[i])) / n; w = v.map(x => x / s);
  }
  const Aw = A.map(r => r.reduce((s, x, j) => s + x * w[j], 0));
  lam = sum(Aw.map((x, i) => x / w[i])) / n;
  return { w, lam, Aw };
}
const RI = [0, 0, 0, 0.58, 0.90, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49];
const SAATY = [1 / 5, 1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 5, 6, 7];
const saatyTex = v => v >= 1 ? m(v) : `1/${Math.round(1 / v)}`;

export default [
  /* ===================================================== 15.1 LCA ====== */
  {
    id: 'lca-gwp-electricity',
    title: 'Carbon footprint of electricity per kilogram of produce',
    lesson: 'lca-emerging-systems',
    difficulty: 1,
    gen(rng) {
      const e = rand(rng, 6, 18, 0.5);
      const grid = pick(rng, [
        { name: 'the Swedish grid', ef: rand(rng, 20, 50, 1) },
        { name: 'the EU-average grid', ef: rand(rng, 190, 240, 5) },
        { name: 'a coal-heavy grid', ef: rand(rng, 600, 750, 10) },
        { name: 'the world-average grid', ef: rand(rng, 420, 460, 5) }]);
      const g = e * grid.ef / 1000;
      return {
        q: `A vertical farm uses ${f(e)} kWh of electricity per kilogram of lettuce sold (lighting, HVAC, pumps). It buys electricity from ${grid.name} with an emission factor of ${grid.ef} g CO₂e kWh⁻¹. What is the electricity-related carbon footprint per kilogram of lettuce?`,
        answer: g, tol: 0.02, unit: 'kg CO₂e kg⁻¹',
        solution: steps(
          `Use Eq. 15.1.2: \\(\\text{GWP}_{\\text{el}} = e_{\\text{el}}\\cdot \\text{EF}_{\\text{grid}}\\).`,
          `Convert the emission factor to kg: \\(${grid.ef}\\ \\text{g kWh}^{-1} = ${m(grid.ef / 1000)}\\ \\text{kg kWh}^{-1}\\).`,
          `\\(\\text{GWP}_{\\text{el}} = ${m(e)}\\ \\text{kWh kg}^{-1}\\times ${m(grid.ef / 1000)}\\ \\text{kg CO}_2\\text{e kWh}^{-1} = ${m(g)}\\ \\text{kg CO}_2\\text{e kg}^{-1}\\).`,
          `Sanity check: imported field lettuce typically carries ≈ 0.4–0.6 kg CO₂e kg⁻¹ in total, so ${g < 0.6 ? 'this farm is competitive on climate' : 'electricity alone already exceeds the imported product'}.`)
      };
    }
  },
  {
    id: 'lca-transport-tkm',
    title: 'Transport emissions from tonne-kilometres',
    lesson: 'lca-emerging-systems',
    difficulty: 1,
    gen(rng) {
      const mode = pick(rng, [
        { name: 'a refrigerated articulated truck (> 33 t)', ef: 0.110 },
        { name: 'a non-refrigerated articulated truck (> 33 t)', ef: 0.095 },
        { name: 'a refrigerated container ship', ef: 0.016 },
        { name: 'long-haul air freight (including non-CO₂ effects)', ef: 0.90 }]);
      const d = mode.ef > 0.5 ? rand(rng, 4000, 9000, 100) : rand(rng, 1500, 4500, 100);
      const g = 0.001 * d * mode.ef;
      return {
        q: `Lettuce is shipped ${f(d)} km by ${mode.name}. The well-to-wheel emission factor is ${mode.ef} kg CO₂e per tonne-kilometre. What are the transport emissions per kilogram of lettuce?`,
        answer: g, tol: 0.02, unit: 'kg CO₂e kg⁻¹',
        solution: steps(
          `Eq. 15.1.4: \\(\\text{GWP}_{\\text{tr}} = m\\,d\\,\\text{EF}_{\\text{tkm}}\\) with the mass in tonnes.`,
          `One kilogram is \\(10^{-3}\\) t, so the transport work is \\(10^{-3}\\times ${m(d, 4)} = ${m(d / 1000)}\\ \\text{t km}\\).`,
          `\\(\\text{GWP}_{\\text{tr}} = ${m(d / 1000)}\\times ${mode.ef} = ${m(g)}\\ \\text{kg CO}_2\\text{e kg}^{-1}\\).`,
          `The factor per t·km differs by a factor of ≈ 60 between ship and aircraft: the transport mode matters far more than the distance.`)
      };
    }
  },
  {
    id: 'lca-breakeven-grid',
    title: 'Break-even grid intensity for a vertical farm',
    lesson: 'lca-emerging-systems',
    difficulty: 2,
    gen(rng) {
      const e = rand(rng, 8, 16, 0.5), g0 = rand(rng, 0.15, 0.45, 0.01), ref = rand(rng, 0.5, 1.2, 0.05);
      const ef = (ref - g0) / e * 1000;
      return {
        q: `A vertical farm uses ${f(e)} kWh kg⁻¹ of electricity; its non-electricity emissions (substrate, nutrients, packaging, infrastructure, local delivery) are ${f(g0)} kg CO₂e kg⁻¹. The competing imported field lettuce has a footprint of ${f(ref)} kg CO₂e kg⁻¹ delivered to the same shop. Below which grid emission factor does the vertical farm have the lower footprint?`,
        answer: ef, tol: 0.02, unit: 'g CO₂e kWh⁻¹',
        solution: steps(
          `Set the two footprints equal (Eq. 15.1.6): \\(e\\,\\text{EF}^{*} + G_0 = G_{\\text{ref}}\\).`,
          `Solve: \\(\\text{EF}^{*} = (G_{\\text{ref}}-G_0)/e = (${m(ref)} - ${m(g0)})/${m(e)} = ${m((ref - g0) / e)}\\ \\text{kg kWh}^{-1}\\).`,
          `In grams: \\(${m(ef)}\\ \\text{g CO}_2\\text{e kWh}^{-1}\\).`,
          `Compare with grids: Sweden ≈ 20–50, EU ≈ 210, coal-heavy ≈ 600–700 g kWh⁻¹. ${ef < 60 ? 'Only very clean grids qualify.' : ef < 200 ? 'Clean grids qualify; the EU average does not.' : 'Even average grids qualify here.'}`)
      };
    }
  },
  {
    id: 'lca-greenhouse-heat',
    title: 'Greenhouse heating: boiler versus heat pump',
    lesson: 'lca-emerging-systems',
    difficulty: 2,
    gen(rng) {
      const q = rand(rng, 4, 12, 0.5), eta = rand(rng, 0.85, 0.95, 0.01), efg = 0.236, cop = rand(rng, 2.5, 4.5, 0.1), grid = rand(rng, 20, 250, 5);
      const gb = q / eta * efg, gh = q / cop * grid / 1000, diff = gb - gh;
      return {
        q: `A Swedish greenhouse needs ${f(q)} kWh of heat per kg of lettuce in winter. Option A: a natural-gas boiler (efficiency ${eta}) with a life-cycle factor of ${efg} kg CO₂e per kWh of gas. Option B: a heat pump with a seasonal COP of ${cop} on a grid of ${grid} g CO₂e kWh⁻¹. By how much does option B reduce the heating footprint (A − B) per kg of lettuce?`,
        answer: diff, tol: 0.03, unit: 'kg CO₂e kg⁻¹',
        solution: steps(
          `Boiler (Eq. 15.1.3a): \\(G_A = \\dfrac{Q}{\\eta}\\,\\text{EF}_{\\text{fuel}} = \\dfrac{${m(q)}}{${eta}}\\times${efg} = ${m(gb)}\\ \\text{kg CO}_2\\text{e kg}^{-1}\\).`,
          `Heat pump (Eq. 15.1.3b): \\(G_B = \\dfrac{Q}{\\text{COP}}\\,\\text{EF}_{\\text{grid}} = \\dfrac{${m(q)}}{${cop}}\\times${m(grid / 1000)} = ${m(gh)}\\ \\text{kg CO}_2\\text{e kg}^{-1}\\).`,
          `Reduction: \\(${m(gb)} - ${m(gh)} = ${m(diff)}\\ \\text{kg CO}_2\\text{e kg}^{-1}\\).`,
          `A heat pump beats the boiler whenever \\(\\text{EF}_{\\text{grid}} < \\text{COP}\\cdot\\text{EF}_{\\text{fuel}}/\\eta\\), here ${m(cop * efg / eta * 1000)} g kWh⁻¹.`)
      };
    }
  },
  {
    id: 'lca-waste-functional-unit',
    title: 'Footprint per kilogram eaten, corrected for waste',
    lesson: 'lca-emerging-systems',
    difficulty: 2,
    gen(rng) {
      const g = rand(rng, 0.4, 1.6, 0.05), w1 = rand(rng, 0.10, 0.35, 0.01), w2 = rand(rng, 0.03, 0.12, 0.01);
      const e1 = g / (1 - w1), e2 = g / (1 - w2);
      return {
        q: `Two lettuce products have the same footprint of ${f(g)} kg CO₂e per kg sold. Product A (short shelf life) has ${Math.round(w1 * 100)} % waste in retail and households; product B (sold living, with roots) has ${Math.round(w2 * 100)} % waste. What is the difference in footprint per kilogram <em>eaten</em> (A − B)? Ignore emissions from waste treatment.`,
        answer: e1 - e2, tol: 0.03, unit: 'kg CO₂e kg⁻¹ eaten',
        solution: steps(
          `Eq. 15.1.5: \\(G_{\\text{eaten}} = G_{\\text{sold}}/(1-w)\\), because \\(1/(1-w)\\) kg must be sold for each kilogram eaten.`,
          `A: \\(${m(g)}/(1-${w1}) = ${m(e1)}\\); B: \\(${m(g)}/(1-${w2}) = ${m(e2)}\\ \\text{kg CO}_2\\text{e kg}^{-1}\\).`,
          `Difference: \\(${m(e1 - e2)}\\ \\text{kg CO}_2\\text{e}\\) per kg eaten — waste can change a comparison as much as the energy source.`)
      };
    }
  },
  {
    id: 'lca-monte-carlo-probability',
    title: 'Probability that one option is better (Monte Carlo logic)',
    lesson: 'lca-emerging-systems',
    difficulty: 3,
    gen(rng) {
      const ma = rand(rng, 0.5, 1.0, 0.05), mb = +(ma + rand(rng, -0.25, 0.25, 0.05)).toFixed(2), sa = rand(rng, 0.10, 0.25, 0.01), sb = rand(rng, 0.10, 0.30, 0.01);
      const md = ma - mb, sd = Math.sqrt(sa * sa + sb * sb), p = phi(-md / sd) * 100;
      return {
        q: `A Monte Carlo LCA gives approximately normal, independent results: vertical farm A = ${ma} ± ${sa} (mean ± SD) and imported lettuce B = ${mb} ± ${sb} kg CO₂e kg⁻¹. What is the probability that A has the <em>lower</em> footprint, P(A &lt; B)?`,
        answer: p, abstol: 2, unit: '%',
        solution: steps(
          `The difference \\(D = A - B\\) is normal with mean \\(${m(md)}\\) and SD \\(\\sqrt{${sa}^2+${sb}^2} = ${m(sd)}\\).`,
          `\\(P(A<B) = P(D<0) = \\Phi\\!\\left(\\dfrac{0-(${m(md)})}{${m(sd)}}\\right) = \\Phi(${m(-md / sd)})\\).`,
          `From the standard normal table \\(\\Phi(${m(-md / sd)}) = ${m(p / 100)}\\), i.e. ≈ ${Math.round(p)} %.`,
          `Note: if the two options share inputs (e.g., the same grid factor) their errors are correlated and this independence shortcut overstates the spread — the reason why paired Monte Carlo runs are used (Eq. 15.1.9).`)
      };
    }
  },
  /* ================================================= 15.2 Resilience ====== */
  {
    id: 'res-shannon-index',
    title: 'Shannon diversity of supply',
    lesson: 'resilience',
    difficulty: 1,
    gen(rng) {
      const n = randInt(rng, 3, 5);
      let raw = Array.from({ length: n }, () => rand(rng, 1, 10, 1)); const s = sum(raw);
      let p = raw.map(x => Math.round(x / s * 100)); p[0] += 100 - sum(p); p = p.map(x => x / 100);
      const H = -sum(p.filter(x => x > 0).map(x => x * Math.log(x)));
      return {
        q: `A country imports its winter lettuce from ${n} suppliers with shares ${p.map(x => Math.round(x * 100) + ' %').join(', ')}. Calculate the Shannon diversity index H (natural logarithm).`,
        answer: H, tol: 0.02, unit: '',
        solution: steps(
          `Eq. 15.2.3: \\(H = -\\sum_i p_i\\ln p_i\\).`,
          p.map(x => `\\(-${x.toFixed(2)}\\ln ${x.toFixed(2)} = ${m(-x * Math.log(x))}\\)`).join('; '),
          `Sum: \\(H = ${m(H)}\\). The maximum for ${n} suppliers is \\(\\ln ${n} = ${m(Math.log(n))}\\), so the evenness is \\(J = ${m(H / Math.log(n))}\\) and the effective number of equally important suppliers is \\(e^{H} = ${m(Math.exp(H))}\\).`)
      };
    }
  },
  {
    id: 'res-hhi-effective',
    title: 'Concentration (HHI) and effective number of suppliers',
    lesson: 'resilience',
    difficulty: 2,
    gen(rng) {
      const n = randInt(rng, 3, 5);
      let raw = Array.from({ length: n }, (_, i) => rand(rng, 1, i === 0 ? 20 : 8, 1)); const s = sum(raw);
      let p = raw.map(x => Math.round(x / s * 100)); p[0] += 100 - sum(p); p = p.map(x => x / 100);
      const hhi = sum(p.map(x => x * x)), neff = 1 / hhi;
      return {
        q: `Supplier shares of a fertiliser import: ${p.map(x => Math.round(x * 100) + ' %').join(', ')}. What is the effective number of suppliers, \\(N_{\\text{eff}} = 1/\\text{HHI}\\), where HHI is the Herfindahl–Hirschman index computed with shares as fractions?`,
        answer: neff, tol: 0.02, unit: 'suppliers',
        solution: steps(
          `Eq. 15.2.4: \\(\\text{HHI} = \\sum p_i^2 = ${p.map(x => x.toFixed(2) + '^2').join('+')} = ${m(hhi)}\\).`,
          `\\(N_{\\text{eff}} = 1/${m(hhi)} = ${m(neff)}\\).`,
          `With ${n} suppliers the maximum would be ${n}; the dominant supplier pulls the effective number down. In percentage points the HHI is \\(${m(hhi * 10000, 4)}\\).`)
      };
    }
  },
  {
    id: 'res-self-sufficiency',
    title: 'Self-sufficiency and import-dependency ratios',
    lesson: 'resilience',
    difficulty: 1,
    gen(rng) {
      const P = rand(rng, 50, 400, 5), M = rand(rng, 20, 300, 5), X = rand(rng, 0, Math.min(150, P * 0.6), 5);
      const use = P + M - X, ssr = P / use * 100, idr = M / use * 100;
      const askSSR = rng() < 0.5;
      return {
        q: `A commodity balance (thousand tonnes per year): domestic production ${P}, imports ${M}, exports ${X}; stock changes are negligible. What is the ${askSSR ? 'self-sufficiency ratio (SSR)' : 'import dependency ratio (IDR)'}?`,
        answer: askSSR ? ssr : idr, tol: 0.02, unit: '%',
        solution: steps(
          `Domestic use (supply) \\(= P + M - X = ${P} + ${M} - ${X} = ${m(use, 4)}\\) kt.`,
          askSSR ? `Eq. 15.2.5: \\(\\text{SSR} = P/(P+M-X) = ${P}/${m(use, 4)} = ${m(ssr)}\\ \\%\\).` : `Eq. 15.2.5: \\(\\text{IDR} = M/(P+M-X) = ${M}/${m(use, 4)} = ${m(idr)}\\ \\%\\).`,
          `Check: \\(\\text{SSR} + \\text{IDR} - X/(P+M-X)\\cdot 100 = ${m(ssr)} + ${m(idr)} - ${m(X / use * 100)} = 100\\ \\%\\). A high SSR can coexist with dependence on imported fertiliser, fuel and feed.`)
      };
    }
  },
  {
    id: 'res-triangle-loss',
    title: 'Resilience triangle: loss and resilience index',
    lesson: 'resilience',
    difficulty: 2,
    gen(rng) {
      const drop = rand(rng, 10, 60, 5), tr = rand(rng, 2, 18, 1), T = 24;
      const loss = 0.5 * drop * tr, idx = 1 - loss / (100 * T);
      const askIdx = rng() < 0.5;
      return {
        q: `After a shock, a regional food supply (functionality Q = 100 % before) drops instantly by ${drop} percentage points and then recovers linearly to 100 % in ${tr} months. ${askIdx ? `What is the resilience index Φ over a 24-month control period (1 = no loss)?` : `What is the resilience loss (area of the triangle) in %·months?`}`,
        answer: askIdx ? idx : loss, tol: askIdx ? 0.005 : 0.02, unit: askIdx ? '' : '%·month',
        solution: steps(
          `Eq. 15.2.2: triangle area \\(L = \\tfrac12\\,\\Delta Q\\,T_r = \\tfrac12\\times${drop}\\times${tr} = ${m(loss)}\\ \\%\\cdot\\text{month}\\).`,
          askIdx ? `Eq. 15.2.1b: \\(\\Phi = 1 - L/(100\\,T) = 1 - ${m(loss)}/(100\\times ${T}) = ${m(idx, 4)}\\).` : `This is the integral \\(\\int (100 - Q)\\,\\mathrm{d}t\\) of Eq. 15.2.1.`,
          `Halving either the depth (robustness, redundancy) or the recovery time (rapidity, resourcefulness) halves the loss.`)
      };
    }
  },
  {
    id: 'res-buffer-duration',
    title: 'How long does an emergency stock last?',
    lesson: 'resilience',
    difficulty: 2,
    gen(rng) {
      const pop = rand(rng, 0.3, 2.0, 0.1), c = rand(rng, 0.20, 0.35, 0.01), phiv = rand(rng, 0, 0.6, 0.05), S = rand(rng, 10, 80, 1);
      const D = pop * 1e6 * c / 1000; // t per day
      const tau = S * 1000 / (D * (1 - phiv));
      return {
        q: `A region of ${f(pop)} million people eats ${c} kg of cereals (grain equivalent) per person per day. After a transport disruption, only ${Math.round(phiv * 100)} % of normal supply arrives. How many days does an emergency stock of ${S} thousand tonnes of grain cover the deficit?`,
        answer: tau, tol: 0.02, unit: 'days',
        solution: steps(
          `Demand: \\(D = ${m(pop)}\\times10^{6}\\times${c}\\ \\text{kg d}^{-1} = ${m(D)}\\ \\text{t d}^{-1}\\).`,
          `Deficit: \\((1-\\varphi)D = (1-${phiv})\\times${m(D)} = ${m(D * (1 - phiv))}\\ \\text{t d}^{-1}\\).`,
          `Eq. 15.2.6: \\(\\tau = S/[(1-\\varphi)D] = ${m(S * 1000, 4)}/${m(D * (1 - phiv))} = ${m(tau)}\\) days (≈ ${m(tau / 30, 2)} months).`)
      };
    }
  },
  {
    id: 'res-portfolio-variance',
    title: 'The portfolio effect of diversified supply',
    lesson: 'resilience',
    difficulty: 3,
    gen(rng) {
      const n = randInt(rng, 2, 6), cv = rand(rng, 0.15, 0.40, 0.01);
      const cvDiv = cv / Math.sqrt(n);
      return {
        q: `A city buys lettuce from one supplier whose annual output varies with a coefficient of variation (CV) of ${Math.round(cv * 100)} %. It switches to ${n} equally sized suppliers with independent year-to-year fluctuations, each with the same CV. What is the CV of the total supply now?`,
        answer: cvDiv * 100, tol: 0.02, unit: '%',
        solution: steps(
          `Each supplier delivers \\(1/${n}\\) of the total with SD \\(\\sigma/${n}\\) (in units of total mean).`,
          `For independent suppliers (Eq. 15.2.8) variances add: \\(\\sigma_{\\text{tot}}^2 = ${n}\\,(\\sigma/${n})^2 = \\sigma^2/${n}\\).`,
          `So \\(\\text{CV}_{\\text{tot}} = \\text{CV}/\\sqrt{${n}} = ${m(cv * 100)}/${m(Math.sqrt(n))} = ${m(cvDiv * 100)}\\ \\%\\).`,
          `If the suppliers are hit by the same drought (correlation ρ → 1) the benefit disappears: diversity must be diversity of <em>risks</em>, not just of names.`)
      };
    }
  },
  /* ======================================= 15.3 Accessibility & equity ===== */
  {
    id: 'eq-capital-recovery-factor',
    title: 'Capital recovery factor',
    lesson: 'accessibility-equity',
    difficulty: 1,
    gen(rng) {
      const r = rand(rng, 0.03, 0.12, 0.005), n = randInt(rng, 5, 25);
      const crf = r * (1 + r) ** n / ((1 + r) ** n - 1);
      return {
        q: `An investment is financed at a real discount rate of ${m(r * 100)} % over a lifetime of ${n} years. What is the capital recovery factor (CRF)?`,
        answer: crf, tol: 0.01, unit: 'yr⁻¹',
        solution: steps(
          `Eq. 15.3.3: \\(\\text{CRF} = \\dfrac{r(1+r)^n}{(1+r)^n - 1}\\).`,
          `\\((1+r)^n = ${m(1 + r, 4)}^{${n}} = ${m((1 + r) ** n, 4)}\\).`,
          `\\(\\text{CRF} = \\dfrac{${m(r, 3)}\\times${m((1 + r) ** n, 4)}}{${m((1 + r) ** n, 4)}-1} = ${m(crf, 4)}\\ \\text{yr}^{-1}\\).`,
          `Check the limits: with \\(r\\to 0\\), CRF → 1/n = ${m(1 / n, 3)}; the CRF is always larger than 1/n because capital has an opportunity cost.`)
      };
    }
  },
  {
    id: 'eq-lcof-vertical-farm',
    title: 'Levelised cost of food of a vertical farm',
    lesson: 'accessibility-equity',
    difficulty: 2,
    gen(rng) {
      const capex = rand(rng, 1500, 4000, 100), n = randInt(rng, 10, 20), r = rand(rng, 0.05, 0.10, 0.01), y = rand(rng, 60, 105, 5);
      const e = rand(rng, 8, 13, 0.5), p = rand(rng, 0.08, 0.20, 0.01), lab = rand(rng, 0.8, 2.0, 0.1), oth = rand(rng, 0.4, 1.2, 0.1);
      const crf = r * (1 + r) ** n / ((1 + r) ** n - 1);
      const lcof = capex * crf / y + e * p + lab + oth;
      return {
        q: `A vertical farm costs ${f(capex, 4)} € per m² of growing area, lasts ${n} years and is financed at ${Math.round(r * 100)} % (real). It yields ${y} kg m⁻² yr⁻¹. Operating costs per kg: electricity ${e} kWh at ${p} € kWh⁻¹, labour ${lab} € and other consumables ${oth} €. What is the levelised cost of food (LCOF)?`,
        answer: lcof, tol: 0.02, unit: '€ kg⁻¹',
        solution: steps(
          `CRF (Eq. 15.3.3) \\(= \\dfrac{${r}(1+${r})^{${n}}}{(1+${r})^{${n}}-1} = ${m(crf, 4)}\\ \\text{yr}^{-1}\\).`,
          `Annualised capital per kg: \\(${m(capex, 4)}\\times${m(crf, 4)}/${y} = ${m(capex * crf / y)}\\) € kg⁻¹.`,
          `Operating: \\(${e}\\times${p} + ${lab} + ${oth} = ${m(e * p + lab + oth)}\\) € kg⁻¹.`,
          `Eq. 15.3.4: \\(\\text{LCOF} = ${m(capex * crf / y)} + ${m(e * p + lab + oth)} = ${m(lcof)}\\) € kg⁻¹.`)
      };
    }
  },
  {
    id: 'eq-npv',
    title: 'Net present value of a food-technology investment',
    lesson: 'accessibility-equity',
    difficulty: 2,
    gen(rng) {
      const I = rand(rng, 50, 300, 10), cf = rand(rng, 10, 60, 1), n = randInt(rng, 5, 15), r = rand(rng, 0.04, 0.12, 0.01);
      const af = (1 - (1 + r) ** -n) / r, npv = -I + cf * af;
      return {
        q: `A greenhouse heat-pump retrofit costs ${I} k€ today and saves ${cf} k€ per year (constant, real) for ${n} years. With a real discount rate of ${Math.round(r * 100)} %, what is the NPV?`,
        answer: npv, abstol: Math.max(0.5, Math.abs(npv) * 0.02), unit: 'k€',
        solution: steps(
          `Eq. 15.3.5: \\(\\text{NPV} = -I + \\sum_{t=1}^{n} \\dfrac{C}{(1+r)^t} = -I + C\\,\\dfrac{1-(1+r)^{-n}}{r}\\).`,
          `Annuity factor: \\(\\dfrac{1-${m(1 + r, 3)}^{-${n}}}{${r}} = ${m(af, 4)}\\) (= 1/CRF).`,
          `\\(\\text{NPV} = -${I} + ${cf}\\times${m(af, 4)} = ${m(npv, 4)}\\) k€. ${npv > 0 ? 'Positive: the investment pays back within its lifetime at this discount rate.' : 'Negative: at this discount rate the investment destroys value.'}`)
      };
    }
  },
  {
    id: 'eq-affordability',
    title: 'Affordability of a healthy diet',
    lesson: 'accessibility-equity',
    difficulty: 1,
    gen(rng) {
      const cost = rand(rng, 3.5, 5.0, 0.05), inc = rand(rng, 3, 20, 0.5), size = randInt(rng, 3, 6);
      const share = cost * size / (inc * size) * 100;
      return {
        q: `The cost of a healthy diet is ${cost.toFixed(2)} PPP dollars per person per day. A household of ${size} people has an income of ${inc.toFixed(2)} PPP dollars per person per day. What share of its income would a healthy diet for all members take?`,
        answer: share, tol: 0.02, unit: '%',
        solution: steps(
          `Eq. 15.3.1: \\(a = \\dfrac{c_{\\text{diet}}\\,N}{y\\,N} = ${m(cost)}/${m(inc)}\\).`,
          `\\(a = ${m(share)}\\ \\%\\).`,
          `${share > 60 ? 'Clearly unaffordable: nothing would be left for housing, energy, health or schooling.' : share > 30 ? 'A heavy burden: poor households typically already spend a large part of their budget on food (Engel’s law).' : 'Affordable at this income, although price shocks would still hurt.'}`)
      };
    }
  },
  {
    id: 'eq-price-rebound',
    title: 'Direct rebound from a cheaper food',
    lesson: 'accessibility-equity',
    difficulty: 2,
    gen(rng) {
      const dp = rand(rng, 10, 40, 5), eps = rand(rng, 0.2, 0.9, 0.05), save = rand(rng, 20, 60, 5);
      const dq = eps * dp; // % increase in consumption
      const net = save - dq * (1 - save / 100);
      return {
        q: `A new production method lowers the footprint per kg of a food by ${save} % and its price by ${dp} %. The own-price elasticity of demand is −${eps}. Using the linear approximation, by what percentage does the <em>total</em> footprint of this food's consumption change? (Negative = reduction.)`,
        answer: -net, abstol: 1, unit: '%',
        solution: steps(
          `Consumption change (Eq. 15.3.8): \\(\\Delta Q/Q = \\varepsilon\\,\\Delta P/P = (-${eps})\\times(-${dp}\\ \\%) = +${m(dq)}\\ \\%\\).`,
          `New total footprint relative to old: \\((1-${save / 100})(1+${m(dq / 100)}) = ${m((1 - save / 100) * (1 + dq / 100), 4)}\\).`,
          `Change: \\(${m(((1 - save / 100) * (1 + dq / 100) - 1) * 100)}\\ \\%\\) instead of the engineering estimate −${save} %. The rebound “eats” ${m((dq * (1 - save / 100)) / save * 100)} % of the saving.`)
      };
    }
  },
  /* ============================================ 15.4 MCDA ================ */
  {
    id: 'mcda-minmax',
    title: 'Min–max normalisation of a cost criterion',
    lesson: 'multi-criteria-assessment',
    difficulty: 1,
    gen(rng) {
      const vals = [rand(rng, 0.3, 0.6, 0.05), rand(rng, 0.8, 2.0, 0.1), rand(rng, 2.5, 6.0, 0.1)];
      const k = randInt(rng, 0, 2), lo = Math.min(...vals), hi = Math.max(...vals);
      const benefit = rng() < 0.3;
      const v = benefit ? (vals[k] - lo) / (hi - lo) : (hi - vals[k]) / (hi - lo);
      const names = ['imported field lettuce', 'greenhouse lettuce', 'vertical-farm lettuce'];
      return {
        q: `Three options score ${vals.map((x, i) => `${names[i]}: ${x}`).join('; ')} on an indicator. Treat it as a <strong>${benefit ? 'benefit' : 'cost'}</strong> criterion (${benefit ? 'more is better' : 'less is better, e.g. kg CO₂e kg⁻¹'}). What is the min–max normalised score (0–1) of ${names[k]}?`,
        answer: v, abstol: 0.01, unit: '',
        solution: steps(
          benefit ? `Eq. 15.4.1a (benefit): \\(v = \\dfrac{x - x_{\\min}}{x_{\\max} - x_{\\min}}\\).` : `Eq. 15.4.1b (cost): \\(v = \\dfrac{x_{\\max} - x}{x_{\\max} - x_{\\min}}\\).`,
          `\\(x_{\\min} = ${lo}\\), \\(x_{\\max} = ${hi}\\), \\(x = ${vals[k]}\\).`,
          `\\(v = ${m(v, 3)}\\). The best option scores 1 and the worst 0 — whatever the absolute difference, which is the main weakness of min–max normalisation.`)
      };
    }
  },
  {
    id: 'mcda-distance-to-target',
    title: 'Distance-to-target normalisation',
    lesson: 'multi-criteria-assessment',
    difficulty: 1,
    gen(rng) {
      const target = rand(rng, 0.3, 0.8, 0.05), x = rand(rng, 0.4, 3.0, 0.05);
      const d = (x - target) / target;
      return {
        q: `A climate target for leafy vegetables is ${target} kg CO₂e kg⁻¹. A product has ${x} kg CO₂e kg⁻¹. What is its relative distance to target, \\(d = (x - x_{\\text{target}})/x_{\\text{target}}\\)?`,
        answer: d, abstol: 0.01, unit: '',
        solution: steps(
          `Eq. 15.4.2: \\(d = (${x} - ${target})/${target} = ${m(d, 3)}\\).`,
          d > 0 ? `Positive: the product exceeds the target by ${m(d * 100)} % of the target value.` : `Negative: the product is already below target (headroom ${m(-d * 100)} %).`)
      };
    }
  },
  {
    id: 'mcda-weighted-sum',
    title: 'Weighted-sum score',
    lesson: 'multi-criteria-assessment',
    difficulty: 2,
    gen(rng) {
      const crit = ['climate', 'land', 'cost', 'resilience'];
      let w = crit.map(() => rand(rng, 1, 10, 1)); const s = sum(w); w = w.map(x => +(x / s).toFixed(2)); w[0] = +(1 - sum(w.slice(1))).toFixed(2);
      const v = crit.map(() => rand(rng, 0, 1, 0.05));
      const V = sum(w.map((x, i) => x * v[i]));
      return {
        q: `Normalised scores (0–1, higher = better) of an option: ${crit.map((c, i) => `${c} ${v[i]}`).join(', ')}. Weights: ${crit.map((c, i) => `${c} ${w[i]}`).join(', ')}. What is the weighted-sum score?`,
        answer: V, abstol: 0.005, unit: '',
        solution: steps(
          `Eq. 15.4.5: \\(V = \\sum_i w_i v_i\\).`,
          `\\(V = ${w.map((x, i) => `${x}\\times${v[i]}`).join('+')} = ${m(V, 3)}\\).`,
          `Weights sum to 1, so V is itself on the 0–1 scale. A score of 0 on one criterion can be fully compensated by others — check whether that is acceptable.`)
      };
    }
  },
  {
    id: 'mcda-ahp-consistency',
    title: 'AHP: weights, λmax and consistency ratio',
    lesson: 'multi-criteria-assessment',
    difficulty: 3,
    gen(rng) {
      const a = pick(rng, [2, 3, 4, 5]), c = pick(rng, [1 / 2, 1, 2, 3]);
      const b = pick(rng, SAATY.filter(x => x >= 1 && Math.abs(x - a * c) <= 4 + a * c / 2));
      const A = [[1, a, b], [1 / a, 1, c], [1 / b, 1 / c, 1]];
      const { w, lam, Aw } = eigen(A);
      const CI = (lam - 3) / 2, CR = CI / RI[3];
      const askCR = rng() < 0.6;
      return {
        q: `Pairwise comparisons of three criteria (climate C, cost K, resilience R) on Saaty's 1–9 scale: C vs K = ${saatyTex(a)}, C vs R = ${saatyTex(b)}, K vs R = ${saatyTex(c)}. ${askCR ? 'What is the consistency ratio CR (use RI = 0.58 for n = 3)?' : 'What is the AHP weight of climate (principal eigenvector, normalised to sum 1)?'}`,
        answer: askCR ? CR : w[0], abstol: askCR ? 0.01 : 0.01, unit: '',
        solution: steps(
          `Matrix: \\(A = \\begin{pmatrix}1 & ${saatyTex(a)} & ${saatyTex(b)}\\\\ ${saatyTex(1 / a)} & 1 & ${saatyTex(c)}\\\\ ${saatyTex(1 / b)} & ${saatyTex(1 / c)} & 1\\end{pmatrix}\\).`,
          `Principal eigenvector (power iteration, Eq. 15.4.3): \\(w = (${w.map(x => m(x, 3)).join(',\\ ')})\\). A quick approximation is the normalised geometric mean of each row.`,
          `\\(Aw = (${Aw.map(x => m(x, 3)).join(',\\ ')})\\), so \\(\\lambda_{\\max} = \\tfrac13\\sum_i (Aw)_i/w_i = ${m(lam, 4)}\\).`,
          `Eq. 15.4.4: \\(\\text{CI} = (\\lambda_{\\max}-3)/2 = ${m(CI, 3)}\\); \\(\\text{CR} = \\text{CI}/0.58 = ${m(CR, 3)}\\). ${CR <= 0.1 ? 'CR ≤ 0.10: acceptably consistent.' : 'CR > 0.10: revise the judgements.'}`)
      };
    }
  },
  {
    id: 'mcda-topsis',
    title: 'TOPSIS closeness coefficient',
    lesson: 'multi-criteria-assessment',
    difficulty: 3,
    gen(rng) {
      // two criteria: climate (cost-type, kg CO2e/kg) and land (cost-type, m2 yr/kg) for three options
      const X = [[rand(rng, 0.3, 0.7, 0.05), rand(rng, 0.03, 0.08, 0.005)], [rand(rng, 1.0, 2.5, 0.1), rand(rng, 0.02, 0.04, 0.005)], [rand(rng, 2.0, 5.0, 0.1), rand(rng, 0.003, 0.01, 0.001)]];
      const wc = rand(rng, 0.4, 0.8, 0.05), w = [wc, +(1 - wc).toFixed(2)];
      const norm = [0, 1].map(j => Math.sqrt(sum(X.map(r => r[j] * r[j]))));
      const V = X.map(r => r.map((x, j) => w[j] * x / norm[j]));
      const best = [0, 1].map(j => Math.min(...V.map(r => r[j]))), worst = [0, 1].map(j => Math.max(...V.map(r => r[j])));
      const k = randInt(rng, 0, 2);
      const dp = Math.hypot(V[k][0] - best[0], V[k][1] - best[1]), dm = Math.hypot(V[k][0] - worst[0], V[k][1] - worst[1]);
      const C = dm / (dp + dm);
      const names = ['imported field', 'heated greenhouse', 'vertical farm'];
      return {
        q: `Three lettuce options: ${names.map((nm, i) => `${nm} — ${X[i][0]} kg CO₂e kg⁻¹, ${X[i][1]} m²·yr kg⁻¹`).join('; ')}. Both criteria are costs (less is better). Weights: climate ${w[0]}, land ${w[1]}. Using TOPSIS with vector normalisation, what is the closeness coefficient \\(C\\) of the ${names[k]} option?`,
        answer: C, abstol: 0.01, unit: '',
        solution: steps(
          `Vector norms: climate \\(\\sqrt{\\sum x^2} = ${m(norm[0], 4)}\\), land \\(${m(norm[1], 4)}\\).`,
          `Weighted normalised values \\(v_{ij} = w_j x_{ij}/\\lVert x_j\\rVert\\): ${V.map((r, i) => `${names[i]} (${m(r[0], 3)}, ${m(r[1], 3)})`).join('; ')}.`,
          `Ideal (minimum, cost criteria): \\(A^{+} = (${m(best[0], 3)}, ${m(best[1], 3)})\\); anti-ideal \\(A^{-} = (${m(worst[0], 3)}, ${m(worst[1], 3)})\\).`,
          `For ${names[k]}: \\(D^{+} = ${m(dp, 3)}\\), \\(D^{-} = ${m(dm, 3)}\\); Eq. 15.4.6: \\(C = D^{-}/(D^{+}+D^{-}) = ${m(C, 3)}\\).`)
      };
    }
  },
  {
    id: 'mcda-rank-reversal-weight',
    title: 'Weight at which two options swap rank',
    lesson: 'multi-criteria-assessment',
    difficulty: 3,
    gen(rng) {
      const a1 = rand(rng, 0.6, 1.0, 0.05), a2 = rand(rng, 0.0, 0.4, 0.05), b1 = rand(rng, 0.0, 0.4, 0.05), b2 = rand(rng, 0.6, 1.0, 0.05);
      const ws = (b2 - a2) / ((a1 - b1) + (b2 - a2));
      return {
        q: `Two options with normalised scores on climate and cost: A = (${a1}, ${a2}), B = (${b1}, ${b2}). With a weighted sum and weights w (climate) and 1 − w (cost), above which climate weight w is A preferred to B?`,
        answer: ws, abstol: 0.01, unit: '',
        solution: steps(
          `\\(V_A = w\\,${a1} + (1-w)\\,${a2}\\), \\(V_B = w\\,${b1} + (1-w)\\,${b2}\\).`,
          `Set \\(V_A = V_B\\): \\(w(${a1}-${b1}) = (1-w)(${b2}-${a2})\\) (Eq. 15.4.8).`,
          `\\(w^{*} = \\dfrac{${m(b2 - a2)}}{${m(a1 - b1)} + ${m(b2 - a2)}} = ${m(ws, 3)}\\). For \\(w > w^{*}\\) option A ranks first.`)
      };
    }
  },
  {
    id: 'mcda-compensation-concept',
    title: 'Compensation and strong sustainability',
    lesson: 'multi-criteria-assessment',
    difficulty: 2,
    gen(rng) {
      return mcq(rng,
        'An option scores 0.95 on cost, 0.9 on resilience and 0.05 on biodiversity (normalised, 0–1, equal weights). Which aggregation rule best prevents the poor biodiversity score from being “bought off” by the other criteria?',
        'A weighted product (geometric) or a veto threshold on biodiversity',
        ['A weighted sum with equal weights', 'Min–max normalisation of all three criteria before a weighted sum', 'Raising the weight of cost to 0.5'],
        '<p>The weighted sum is fully compensatory: \\(V = (0.95+0.9+0.05)/3 = 0.63\\). A weighted product \\(\\prod v_i^{w_i} = (0.95\\times0.9\\times0.05)^{1/3} = 0.35\\) penalises the weak criterion strongly, and a veto (e.g. “biodiversity ≥ 0.3”) excludes the option altogether — the logic of strong sustainability and planetary boundaries.</p>');
    }
  },
  /* ---------------- additional generators (Lessons 15.2–15.4, second author) ---------------- */
  {
    id: 'res-energy-price-breakeven',
    title: 'Energy-price stress test of an indoor farm',
    lesson: 'resilience',
    difficulty: 2,
    gen(rng) {
      const e = rand(rng, 6, 16, 0.5), c0 = rand(rng, 3.5, 7.0, 0.1), price = +(c0 + rand(rng, 0.8, 4.0, 0.1)).toFixed(1), p0 = rand(rng, 0.06, 0.18, 0.01);
      const pstar = (price - c0) / e;
      return {
        q: `A vertical farm sells lettuce for ${price} $ kg⁻¹. Its costs other than electricity (capital, labour, seeds, packaging) are ${c0} $ kg⁻¹ and it uses ${e} kWh of electricity per kg. It currently pays ${p0} $ kWh⁻¹. Above which electricity price does it make a loss on every kilogram?`,
        answer: pstar, tol: 0.02, unit: '$ kWh⁻¹',
        solution: steps(
          `Eq. 15.2.7: \\(p^{*}_{\\text{el}} = (P_{\\text{sale}} - C_0)/e_{\\text{el}}\\).`,
          `\\(p^{*} = (${m(price)} - ${m(c0)})/${m(e)} = ${m(pstar)}\\) $ kWh⁻¹.`,
          `Energy safety factor: \\(p^{*}/p = ${m(pstar)}/${m(p0)} = ${m(pstar / p0)}\\). ${pstar / p0 < 1.5 ? 'A thin margin: a moderate price spike would make the farm unprofitable.' : 'The farm can absorb a sizeable price shock — as long as its selling price holds.'}`)
      };
    }
  },
  {
    id: 'res-correlated-portfolio',
    title: 'Diversification with correlated suppliers',
    lesson: 'resilience',
    difficulty: 3,
    gen(rng) {
      const n = randInt(rng, 3, 10), cv = rand(rng, 0.15, 0.40, 0.01), rho = rand(rng, 0.1, 0.8, 0.05);
      const cvt = cv * Math.sqrt((1 + (n - 1) * rho) / n), neff = n / (1 + (n - 1) * rho);
      const askN = rng() < 0.4;
      return {
        q: `A region buys a staple from ${n} equally sized suppliers. Each supplier's annual output has a coefficient of variation of ${Math.round(cv * 100)} %, and all pairs of suppliers have a correlation of ρ = ${rho}. ${askN ? 'What is the effective number of independent suppliers?' : 'What is the coefficient of variation of the total supply?'}`,
        answer: askN ? neff : cvt * 100, tol: 0.02, unit: askN ? 'suppliers' : '%',
        solution: steps(
          `Eq. 15.2.8 for equal suppliers: \\(\\text{CV}_{\\text{tot}} = \\text{CV}\\sqrt{(1+(n-1)\\rho)/n} = ${m(cv * 100)}\\sqrt{(1+${n - 1}\\times${rho})/${n}} = ${m(cvt * 100)}\\ \\%\\).`,
          `Effective number of independent suppliers: \\(n_{\\text{eff}} = n/[1+(n-1)\\rho] = ${n}/${m(1 + (n - 1) * rho)} = ${m(neff)}\\) (never more than \\(1/\\rho = ${m(1 / rho)}\\)).`,
          `With independent suppliers the CV would be \\(${m(cv * 100)}/\\sqrt{${n}} = ${m(cv / Math.sqrt(n) * 100)}\\ \\%\\): correlation removes much of the benefit of diversification.`)
      };
    }
  },
  {
    id: 'res-exporter-exposure',
    title: 'First-order exposure to exporter shocks',
    lesson: 'resilience',
    difficulty: 2,
    gen(rng) {
      const p1 = rand(rng, 0.2, 0.8, 0.01), d1 = rand(rng, 0, 0.8, 0.05), d2 = rand(rng, 0, 0.8, 0.05), idr = rand(rng, 0.3, 1.0, 0.05);
      const s = p1 * d1 + (1 - p1) * d2, loss = idr * s;
      return {
        q: `A country imports ${Math.round(idr * 100)} % of its domestic wheat supply (IDR). Of its imports, ${Math.round(p1 * 100)} % come from exporter 1 and the rest from exporter 2. A crisis cuts the exports of exporter 1 by ${Math.round(d1 * 100)} % and of exporter 2 by ${Math.round(d2 * 100)} %. Ignoring substitution and stocks, what fraction of the country's domestic wheat supply is lost?`,
        answer: loss * 100, tol: 0.02, unit: '%',
        solution: steps(
          `Eq. 15.2.9: fraction of imports lost \\(s = \\sum p_i\\delta_i = ${m(p1)}\\times${m(d1)} + ${m(1 - p1)}\\times${m(d2)} = ${m(s)}\\).`,
          `Loss of domestic supply \\(= \\text{IDR}\\times s = ${m(idr)}\\times${m(s)} = ${m(loss)}\\), i.e. ${m(loss * 100)} %.`,
          `This is the first-order loss before the absorptive and adaptive responses of Lesson 15.2 (stocks, new suppliers, lower exports).`)
      };
    }
  },
  {
    id: 'eq-unaffordability-lognormal',
    title: 'Share of a population unable to afford a healthy diet',
    lesson: 'accessibility-equity',
    difficulty: 3,
    gen(rng) {
      const med = rand(rng, 3, 20, 0.5), G = rand(rng, 0.25, 0.55, 0.01), c = rand(rng, 3.5, 5.0, 0.05), n = rand(rng, 1, 5, 0.5);
      let lo = -8, hi = 8; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (phi(mid) < (1 + G) / 2) lo = mid; else hi = mid; }
      const sig = Math.SQRT2 * (lo + hi) / 2, r = c + n, z = (Math.log(r) - Math.log(med)) / sig, pua = phi(z) * 100;
      return {
        q: `Incomes in a country are approximately lognormal with a median of ${m(med)} PPP$ per person per day and a Gini coefficient of ${m(G, 2)}. A healthy diet costs ${m(c)} and basic non-food needs ${m(n)} PPP$ per person per day. Estimate the percentage of people who cannot afford the diet.`,
        answer: pua, abstol: 1.5, unit: '%',
        solution: steps(
          `Log-spread from the Gini (Eq. 15.3.2): \\(\\sigma = \\sqrt2\\,\\Phi^{-1}((1+G)/2) = \\sqrt2\\,\\Phi^{-1}(${m((1 + G) / 2, 3)}) = ${m(sig)}\\).`,
          `Threshold \\(r = c + n = ${m(r)}\\); \\(z = (\\ln ${m(r)} - \\ln ${m(med)})/${m(sig)} = ${m(z)}\\).`,
          `\\(\\text{PUA} = \\Phi(${m(z)}) = ${m(pua / 100)}\\), i.e. about ${Math.round(pua)} % of the population.`)
      };
    }
  },
  {
    id: 'eq-learning-curve',
    title: 'Learning curves: how much deployment for how much cost reduction?',
    lesson: 'accessibility-equity',
    difficulty: 2,
    gen(rng) {
      const lr = rand(rng, 0.10, 0.30, 0.01), c0 = rand(rng, 4, 20, 0.5), target = +(c0 * rand(rng, 0.25, 0.7, 0.05)).toFixed(2);
      const nd = Math.log(target / c0) / Math.log(1 - lr);
      const askFactor = rng() < 0.5;
      return {
        q: `A food technology costs ${c0} $ per unit today and has a learning rate of ${Math.round(lr * 100)} % per doubling of cumulative production. ${askFactor ? `By what factor must cumulative production grow for the cost to fall to ${target} $?` : `How many doublings of cumulative production are needed to reach ${target} $?`}`,
        answer: askFactor ? Math.pow(2, nd) : nd, tol: 0.03, unit: askFactor ? '×' : 'doublings',
        solution: steps(
          `Eq. 15.3.6: \\(N_{\\text{d}} = \\ln(C/C_0)/\\ln(1-\\text{LR}) = \\ln(${m(target)}/${m(c0)})/\\ln(${m(1 - lr)}) = ${m(nd)}\\) doublings.`,
          `Growth factor of cumulative production: \\(2^{N_{\\text{d}}} = ${m(Math.pow(2, nd))}\\).`,
          `Learning is empirical: costs set by biology, labour or logistics may not follow the curve (Lesson 15.3).`)
      };
    }
  },
  {
    id: 'eq-gini-grouped',
    title: 'Gini coefficient from grouped data',
    lesson: 'accessibility-equity',
    difficulty: 2,
    gen(rng) {
      // draw until the Lorenz curve is convex (group mean sizes increase: slopes y/x rise from group to group)
      let x1 = 0.5, x2 = 0.7, y1 = 0.1, y2 = 0.25;
      for (let t = 0; t < 200; t++) {
        const a = rand(rng, 0.4, 0.7, 0.05), b = +(a + rand(rng, 0.15, 0.25, 0.05)).toFixed(2), c = rand(rng, 0.05, 0.25, 0.01), d = +(c + rand(rng, 0.1, 0.3, 0.01)).toFixed(2);
        const s1 = c / a, s2 = (d - c) / (b - a), s3 = (1 - d) / (1 - b);
        if (s1 < s2 && s2 < s3) { x1 = a; x2 = b; y1 = c; y2 = d; break; }
      }
      const B = x1 * (0 + y1) + (x2 - x1) * (y1 + y2) + (1 - x2) * (y2 + 1), G = 1 - B;
      return {
        q: `Farm census data: the smallest ${Math.round(x1 * 100)} % of farms hold ${Math.round(y1 * 100)} % of the land, and the smallest ${Math.round(x2 * 100)} % hold ${Math.round(y2 * 100)} %. Assuming equality within each group, estimate the Gini coefficient of land.`,
        answer: G, abstol: 0.01, unit: '',
        solution: steps(
          `Lorenz points: (0, 0), (${x1}, ${y1}), (${x2}, ${y2}), (1, 1).`,
          `Eq. 15.3.7 (trapezoids): \\(G = 1 - [${x1}(0+${y1}) + ${m(x2 - x1)}(${y1}+${y2}) + ${m(1 - x2)}(${y2}+1)] = 1 - ${m(B, 4)} = ${m(G, 3)}\\).`,
          `A lower bound: inequality within the groups would raise it.`)
      };
    }
  },
  {
    id: 'eq-price-burden',
    title: 'Who pays for a food-price rise? The net benefit ratio',
    lesson: 'accessibility-equity',
    difficulty: 1,
    gen(rng) {
      const sc = rand(rng, 0.10, 0.60, 0.01), sp = pick(rng, [0, 0, rand(rng, 0.1, 0.8, 0.01)]), dp = rand(rng, 5, 30, 1);
      const dw = (sp - sc) * dp;
      return {
        q: `Food prices rise by ${dp} %. A household spends ${Math.round(sc * 100)} % of its budget on food and earns ${Math.round(sp * 100)} % of its income from selling food. What is the first-order change in its real income, in % of income (negative = loss)?`,
        answer: dw, abstol: 0.15, unit: '% of income',
        solution: steps(
          `Eq. 15.3.9: \\(\\Delta W/y \\approx (s_p - s_c)\\,\\Delta P/P = (${m(sp)} - ${m(sc)})\\times${dp}\\ \\% = ${m(dw)}\\ \\%\\).`,
          dw < 0 ? 'A net buyer of food loses; poorer households with larger food shares lose more (Engel’s law).' : 'A net seller of food gains from the price rise.')
      };
    }
  },
  {
    id: 'mcda-swing-weights',
    title: 'Swing weights from points',
    lesson: 'multi-criteria-assessment',
    difficulty: 1,
    gen(rng) {
      const names = ['climate', 'cost', 'water', 'land', 'resilience'];
      const pts = [100, ...[1, 2, 3, 4].map(() => rand(rng, 10, 95, 5))];
      const k = randInt(rng, 0, 4), w = pts[k] / sum(pts);
      return {
        q: `In a swing-weighting exercise a stakeholder gives the most valued swing (climate) 100 points and the other swings: ${names.slice(1).map((nm, i) => `${nm} ${pts[i + 1]}`).join(', ')}. What is the normalised weight of ${names[k]}?`,
        answer: w, abstol: 0.005, unit: '',
        solution: steps(
          `Sum of points: \\(${pts.join('+')} = ${sum(pts)}\\).`,
          `\\(w_{\\text{${names[k]}}} = ${pts[k]}/${sum(pts)} = ${m(w, 3)}\\).`,
          `Swing weights refer to the ranges of the option set: widen a range and the question must be asked again.`)
      };
    }
  },
  {
    id: 'mcda-weighted-product',
    title: 'Weighted-product score',
    lesson: 'multi-criteria-assessment',
    difficulty: 2,
    gen(rng) {
      const v = [rand(rng, 0.05, 1, 0.05), rand(rng, 0.05, 1, 0.05), rand(rng, 0.05, 1, 0.05)];
      let w = [rand(rng, 1, 10, 1), rand(rng, 1, 10, 1), rand(rng, 1, 10, 1)]; const s = sum(w); w = w.map(x => +(x / s).toFixed(2)); w[0] = +(1 - w[1] - w[2]).toFixed(2);
      const P = v.reduce((p, x, i) => p * Math.pow(x, w[i]), 1), V = sum(v.map((x, i) => x * w[i]));
      return {
        q: `An option has normalised (ratio-scale) scores ${v.join(', ')} on three criteria with weights ${w.join(', ')}. What is its weighted-product score \\(\\prod v_j^{w_j}\\)?`,
        answer: P, abstol: 0.005, unit: '',
        solution: steps(
          `Eq. 15.4.7: \\(\\ln P = \\sum w_j \\ln v_j = ${v.map((x, i) => `${w[i]}\\ln ${x}`).join(' + ')} = ${m(Math.log(P), 4)}\\).`,
          `\\(P = e^{${m(Math.log(P), 4)}} = ${m(P, 3)}\\), compared with the weighted sum \\(V = ${m(V, 3)}\\).`,
          `The product is never larger than the sum (weighted AM–GM inequality) and falls sharply when one score is small: compensation is limited.`)
      };
    }
  },
  {
    id: 'mcda-rank-acceptability-se',
    title: 'Monte Carlo rank acceptability and its standard error',
    lesson: 'multi-criteria-assessment',
    difficulty: 1,
    gen(rng) {
      const N = pick(rng, [1000, 2000, 5000, 10000]), k = randInt(rng, Math.round(0.1 * N), Math.round(0.9 * N)), b = k / N;
      const se = Math.sqrt(b * (1 - b) / N) * 100;
      return {
        q: `In a stochastic acceptability analysis with ${N.toLocaleString('en-GB')} random weight vectors, an option ranks first ${k.toLocaleString('en-GB')} times. What is the standard error of its first-rank acceptability, in percentage points?`,
        answer: se, tol: 0.03, unit: 'percentage points',
        solution: steps(
          `Eq. 15.4.9: \\(b^1 = ${k}/${N} = ${m(b, 3)}\\).`,
          `Binomial standard error: \\(\\sqrt{b(1-b)/N} = \\sqrt{${m(b, 3)}\\times${m(1 - b, 3)}/${N}} = ${m(se / 100, 3)}\\), i.e. ${m(se, 3)} percentage points.`,
          `Sampling error is usually small compared with the uncertainty caused by the choice of method and of the weight distribution.`)
      };
    }
  }
];
