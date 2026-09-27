/* ==========================================================================
   Practice generators — Module 13: Consumer acceptance and sensory science
   Lessons: food-choice (13.1), acceptance-models (13.2),
            sensory-methods (13.3), sensory-statistics (13.4)
   Every generator returns a fresh, randomised, auto-marked problem.
   Statistics come from /assets/js/stats.js so that lessons, labs and
   practice agree to the last digit.
   ========================================================================== */
import { rand, randInt, pick, shuffle, f, steps, mcq } from './helpers.js';
import { binomPmf, binomUpper, binomCdf, binomCritical, normCdf, normPdf, normInv, qtukey, chi2Cdf, fCdf, mean, sd, variance, anovaRCBD } from '../stats.js';

/* ---------- local helpers ---------- */
const fp = (p) => p < 0.0001 ? p.toExponential(2) : (+p.toPrecision(3)).toString(); // p-value display
function simpson(fn, a, b, n = 800) { const h = (b - a) / n; let s = fn(a) + fn(b); for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * fn(a + i * h); return s * h / 3; }
/** Triangle psychometric function (Ennis 1993; Brockhoff & Christensen 2010). */
const pcTriangle = d => 2 * simpson(z => (normCdf(-z * Math.sqrt(3) + d * Math.sqrt(2 / 3)) + normCdf(-z * Math.sqrt(3) - d * Math.sqrt(2 / 3))) * normPdf(z), 0, 9);
const pc3AFC = d => simpson(z => normPdf(z - d) * normCdf(z) ** 2, d - 9, d + 9);
function invert(fn, pc, lo = 0, hi = 8) { for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (fn(m) < pc) lo = m; else hi = m; } return (lo + hi) / 2; }
const FNS_ITEMS = [
  'I am constantly sampling new and different foods.',
  'I don’t trust new foods.',
  'If I don’t know what is in a food, I won’t try it.',
  'I like foods from different countries.',
  'Ethnic food looks too weird to eat.',
  'At dinner parties, I will try a new food.',
  'I am afraid to eat things I have never had before.',
  'I am very particular about the foods I will eat.',
  'I will eat almost anything.',
  'I like to try new ethnic restaurants.'
];
const FNS_REV = [0, 3, 5, 8, 9];
const PRODUCTS = ['bread with 10 % cricket flour', 'a mycoprotein burger', 'a seaweed crisp', 'hydroponic butterhead lettuce', 'a pea-protein sausage', 'a mealworm pasta'];

export default [
  /* ======================= 13.1 food choice ======================= */
  {
    id: 'ca-fns-score', title: 'Scoring the Food Neophobia Scale (reverse items)', lesson: 'food-choice', difficulty: 2,
    gen(rng) {
      const resp = FNS_ITEMS.map(() => randInt(rng, 1, 7));
      const scored = resp.map((v, j) => FNS_REV.includes(j) ? 8 - v : v);
      const total = scored.reduce((a, b) => a + b, 0);
      const rows = FNS_ITEMS.map((t, j) => `<tr><td>${j + 1}</td><td>${t}</td><td class="num">${resp[j]}</td></tr>`).join('');
      return {
        q: `A panellist answered the 10-item Food Neophobia Scale (1 = strongly disagree … 7 = strongly agree). Items 1, 4, 6, 9 and 10 are worded in the neophilic direction and must be reverse-scored. What is the FNS total (range 10–70, higher = more neophobic)?<table><thead><tr><th>#</th><th>Item</th><th>Response</th></tr></thead><tbody>${rows}</tbody></table>`,
        answer: total, abstol: 0.5, unit: 'points',
        solution: steps(
          `Reverse-score items 1, 4, 6, 9, 10 with \\(x' = 8 - x\\): ${FNS_REV.map(j => `item ${j + 1}: ${resp[j]} → ${8 - resp[j]}`).join('; ')}.`,
          `Keep items 2, 3, 5, 7, 8 as answered: ${[1, 2, 4, 6, 7].map(j => resp[j]).join(', ')}.`,
          `Sum all ten scored items: \\(${scored.join('+')} = ${total}\\).`,
          `Interpretation: ${total < 25 ? 'low' : total <= 40 ? 'moderate' : 'high'} neophobia. Swedish adult samples have typically averaged about 25–27 points.`)
      };
    }
  },
  {
    id: 'ca-ftns-score', title: 'Food Technology Neophobia Scale total', lesson: 'food-choice', difficulty: 2,
    gen(rng) {
      const resp = Array.from({ length: 13 }, () => randInt(rng, 1, 7));
      const rev = [9, 10, 11, 12];
      const scored = resp.map((v, j) => rev.includes(j) ? 8 - v : v);
      const total = scored.reduce((a, b) => a + b, 0);
      return {
        q: `A respondent's answers to the 13 items of the Food Technology Neophobia Scale (Cox &amp; Evans, 2008; 7-point scale) are, in order: <b>${resp.join(', ')}</b>. Items 10–13 are positively worded about new food technologies (e.g., “New food technologies give people more control over their food choices”) and are reverse-scored. Compute the FTNS total (range 13–91).`,
        answer: total, abstol: 0.5, unit: 'points',
        solution: steps(
          `Reverse items 10–13: ${rev.map(j => `${resp[j]} → ${8 - resp[j]}`).join(', ')}.`,
          `Sum items 1–9 as answered: ${resp.slice(0, 9).reduce((a, b) => a + b, 0)}.`,
          `Add the reversed items: ${rev.map(j => 8 - resp[j]).reduce((a, b) => a + b, 0)}. Total = ${total} (midpoint of the scale = 52).`)
      };
    }
  },
  {
    id: 'ca-expectancy-value', title: 'Expectancy–value attitude toward a novel food', lesson: 'food-choice', difficulty: 1,
    gen(rng) {
      const prod = pick(rng, PRODUCTS);
      const beliefs = [['is good for the climate', rand(rng, 1, 3, 1), 3], ['tastes pleasant', rand(rng, -2, 2, 1), rand(rng, 2, 3, 1)], ['is natural', rand(rng, -3, 1, 1), rand(rng, 1, 3, 1)], ['is expensive', rand(rng, 0, 3, 1), -rand(rng, 1, 3, 1)]];
      const A = beliefs.reduce((s, b) => s + b[1] * b[2], 0);
      const rows = beliefs.map(b => `<tr><td>“${prod} ${b[0]}”</td><td class="num">${b[1]}</td><td class="num">${b[2]}</td></tr>`).join('');
      return {
        q: `Using Fishbein's expectancy–value model \\(A=\\sum_i b_i e_i\\), compute a consumer's attitude toward ${prod}. Belief strength \\(b_i\\) is scored −3…+3 (how likely the attribute is) and evaluation \\(e_i\\) −3…+3 (how good the attribute is).<table><thead><tr><th>Belief</th><th>b</th><th>e</th></tr></thead><tbody>${rows}</tbody></table>`,
        answer: A, abstol: 0.5, unit: '',
        solution: steps(...beliefs.map(b => `\\(${b[1]}\\times(${b[2]}) = ${b[1] * b[2]}\\)`), `\\(A = ${beliefs.map(b => `(${b[1] * b[2]})`).join('+')} = ${A}\\) (possible range −36 to +36).`)
      };
    }
  },
  {
    id: 'ca-price-elasticity', title: 'Price elasticity and demand for an alternative protein', lesson: 'food-choice', difficulty: 1,
    gen(rng) {
      const e = rand(rng, 0.3, 0.8, 0.05), dp = rand(rng, 5, 30, 5), up = pick(rng, [true, false]);
      const dq = -e * (up ? dp : -dp);
      return {
        q: `The own-price elasticity of demand for a plant-based mince is \\(\\varepsilon = -${e}\\). The retailer ${up ? 'raises' : 'cuts'} the price by ${dp} %. Using the linear approximation \\(\\Delta Q/Q \\approx \\varepsilon\\,\\Delta P/P\\), by how many per cent does the quantity sold change? (Give a signed number.)`,
        answer: dq, abstol: 0.1, unit: '%',
        solution: steps(`\\(\\Delta P/P = ${up ? '+' : '−'}${dp}\\,\\%\\).`, `\\(\\Delta Q/Q = -${e}\\times(${up ? '' : '-'}${dp}) = ${f(dq, 3)}\\,\\%\\).`, `Food elasticities are typically 0.27–0.81 in absolute value (Andreyeva et al., 2010): demand responds, but less than proportionally.`)
      };
    }
  },
  /* ======================= 13.2 acceptance models ======================= */
  {
    id: 'ca-tpb-intention', title: 'Theory of planned behaviour: predicted intention', lesson: 'acceptance-models', difficulty: 1,
    gen(rng) {
      const wA = rand(rng, 0.3, 0.6, 0.05), wS = rand(rng, 0.05, 0.3, 0.05), wP = rand(rng, 0.1, 0.4, 0.05), b0 = rand(rng, 0.2, 1.0, 0.1);
      const A = rand(rng, 2, 6.5, 0.1), SN = rand(rng, 2, 6, 0.1), P = rand(rng, 2, 6.5, 0.1);
      const I = b0 + wA * A + wS * SN + wP * P;
      const prod = pick(rng, PRODUCTS);
      return {
        q: `A regression of intention to eat ${prod} (1–7 scale) on the TPB components gave \\(I = ${b0} + ${wA}\\,A + ${wS}\\,SN + ${wP}\\,PBC\\). A student scores A = ${A}, SN = ${SN} and PBC = ${P}. What intention does the model predict?`,
        answer: I, tol: 0.01, unit: 'scale points (1–7)',
        solution: steps(`\\(${wA}\\times${A} = ${f(wA * A, 4)}\\)`, `\\(${wS}\\times${SN} = ${f(wS * SN, 4)}\\)`, `\\(${wP}\\times${P} = ${f(wP * P, 4)}\\)`, `\\(I = ${b0} + ${f(wA * A, 4)} + ${f(wS * SN, 4)} + ${f(wP * P, 4)} = ${f(I, 3)}\\).`)
      };
    }
  },
  {
    id: 'ca-cronbach-alpha', title: "Cronbach's α from item variances", lesson: 'acceptance-models', difficulty: 2,
    gen(rng) {
      const k = randInt(rng, 4, 8);
      const iv = Array.from({ length: k }, () => rand(rng, 0.9, 2.4, 0.01));
      const sumIv = iv.reduce((a, b) => a + b, 0);
      const rbar = rand(rng, 0.2, 0.55, 0.01);
      // total variance consistent with an average inter-item covariance
      const avgSd = Math.sqrt(sumIv / k); const cov = rbar * avgSd * avgSd;
      const tv = +(sumIv + k * (k - 1) * cov).toFixed(2);
      const alpha = k / (k - 1) * (1 - sumIv / tv);
      return {
        q: `A ${k}-item attitude scale toward ${pick(rng, ['cultivated meat', 'insect-based foods', 'gene-edited vegetables', 'vertical-farm produce'])} was answered by a student panel. The item variances are ${iv.map(v => v.toFixed(2)).join(', ')} and the variance of the summed score is ${tv}. Compute Cronbach's α.`,
        answer: alpha, abstol: 0.01, unit: '',
        solution: steps(`\\(\\sum s_i^2 = ${f(sumIv, 4)}\\)`, `\\(\\alpha = \\dfrac{k}{k-1}\\left(1-\\dfrac{\\sum s_i^2}{s_X^2}\\right) = \\dfrac{${k}}{${k - 1}}\\left(1-\\dfrac{${f(sumIv, 4)}}{${tv}}\\right) = ${f(alpha, 3)}\\)`, alpha >= 0.7 ? 'α ≥ 0.70: acceptable internal consistency for research use.' : 'α < 0.70: the items do not hang together well enough — inspect item–total correlations.')
      };
    }
  },
  {
    id: 'ca-spearman-brown', title: 'Spearman–Brown: how many items for a target reliability?', lesson: 'acceptance-models', difficulty: 3,
    gen(rng) {
      const k = randInt(rng, 3, 6), a0 = rand(rng, 0.5, 0.68, 0.01), target = pick(rng, [0.75, 0.8, 0.85]);
      const m = (target / (1 - target)) * ((1 - a0) / a0);
      const kNew = Math.ceil(k * m - 1e-9);
      return {
        q: `A ${k}-item scale measuring trust in food scientists has α = ${a0}. Assuming new items are parallel to the existing ones, what is the minimum total number of items needed to reach α = ${target}? (Spearman–Brown prophecy formula.)`,
        answer: kNew, abstol: 0.5, unit: 'items',
        solution: steps(`Lengthening factor \\(m = \\dfrac{\\alpha^*(1-\\alpha)}{\\alpha(1-\\alpha^*)} = \\dfrac{${target}(1-${a0})}{${a0}(1-${target})} = ${f(m, 4)}\\).`, `Required items \\(= m\\,k = ${f(m, 4)}\\times${k} = ${f(m * k, 4)}\\), round up to ${kNew}.`)
      };
    }
  },
  {
    id: 'ca-risk-dimensions', title: 'Psychometric paradigm: dread versus unknown', lesson: 'acceptance-models', difficulty: 1,
    gen(rng) {
      const dread = ['uncontrollable', 'catastrophic potential', 'fatal consequences', 'involuntary exposure', 'inequitable distribution of risk', 'high risk to future generations'];
      const unknown = ['not observable', 'effects delayed', 'new risk', 'risks unknown to science', 'unknown to those exposed'];
      const which = pick(rng, ['dread', 'unknown']);
      const correct = pick(rng, which === 'dread' ? dread : unknown);
      const wrong = shuffle(rng, which === 'dread' ? unknown : dread).slice(0, 3);
      return mcq(rng, `In Slovic's (1987) psychometric paradigm, which risk characteristic loads on the <b>${which === 'dread' ? 'dread risk' : 'unknown risk'}</b> factor?`, correct, wrong,
        `<p>Factor 1 (dread) collects lack of control, catastrophic and fatal potential, involuntariness, inequity and threat to future generations. Factor 2 (unknown) collects unobservable, delayed, new and scientifically uncertain risks. Novel food technologies such as cultivated meat typically score high on <em>unknown</em>.</p>`);
    }
  },
  /* ======================= 13.3 sensory methods ======================= */
  {
    id: 'ca-triangle-pmf', title: 'Probability of exactly k correct by guessing (triangle test)', lesson: 'sensory-methods', difficulty: 1,
    gen(rng) {
      const n = randInt(rng, 6, 15), k = randInt(rng, Math.ceil(n / 3), Math.min(n, Math.ceil(n / 3) + 4));
      const p = binomPmf(k, n, 1 / 3);
      const C = Math.round(Math.exp(lnC(n, k)));
      return {
        q: `In a triangle test with ${n} panellists who cannot perceive any difference (each guesses with probability 1/3), what is the probability that <b>exactly</b> ${k} identify the odd sample?`,
        answer: p, tol: 0.02, unit: '',
        solution: steps(`Binomial model: \\(P(X=k) = \\binom{n}{k} p_0^{k} (1-p_0)^{n-k}\\) with \\(p_0 = 1/3\\).`, `\\(\\binom{${n}}{${k}} = ${C}\\).`, `\\(P = ${C}\\times(1/3)^{${k}}\\times(2/3)^{${n - k}} = ${f(p, 4)}\\).`)
      };
    }
  },
  {
    id: 'ca-chance-expectation', title: 'Expected correct answers by chance', lesson: 'sensory-methods', difficulty: 1,
    gen(rng) {
      const tests = [['triangle', 1 / 3], ['duo–trio', 1 / 2], ['2-AFC (paired comparison)', 1 / 2], ['3-AFC', 1 / 3], ['tetrad (unspecified)', 1 / 3]];
      const [name, p0] = pick(rng, tests); const n = randInt(rng, 18, 48);
      const e = n * p0, s = Math.sqrt(n * p0 * (1 - p0));
      return {
        q: `${n} consumers perform a ${name} test on two products that are, in fact, identical. What is the expected number of correct answers?`,
        answer: e, tol: 0.01, unit: 'correct answers',
        solution: steps(`Guessing probability for the ${name}: \\(p_0 = ${p0 === 0.5 ? '1/2' : '1/3'}\\).`, `\\(E[X] = n p_0 = ${n}\\times${p0 === 0.5 ? '1/2' : '1/3'} = ${f(e, 4)}\\).`, `Standard deviation \\(\\sqrt{np_0(1-p_0)} = ${f(s, 3)}\\): results within about ±2 SD of ${f(e, 3)} are unremarkable.`)
      };
    }
  },
  {
    id: 'ca-hedonic-mean-se', title: 'Hedonic ratings: mean and standard error', lesson: 'sensory-methods', difficulty: 1,
    gen(rng) {
      const n = randInt(rng, 8, 12), mu = rand(rng, 4.5, 7.5, 0.1);
      const x = Array.from({ length: n }, () => Math.max(1, Math.min(9, Math.round(mu + (rng() + rng() + rng() - 1.5) * 2.2))));
      const m = mean(x), s = sd(x), se = s / Math.sqrt(n);
      const which = pick(rng, ['mean', 'se']);
      return {
        q: `${n} panellists rated ${pick(rng, PRODUCTS)} on the 9-point hedonic scale: <b>${x.join(', ')}</b>. ${which === 'mean' ? 'What is the mean liking score?' : 'What is the standard error of the mean (use the sample SD with n − 1)?'}`,
        answer: which === 'mean' ? m : se, tol: 0.02, unit: which === 'mean' ? 'points' : 'points',
        solution: steps(`\\(\\bar x = \\sum x_i / n = ${x.reduce((a, b) => a + b, 0)}/${n} = ${f(m, 4)}\\).`, `\\(s = \\sqrt{\\sum (x_i-\\bar x)^2/(n-1)} = ${f(s, 4)}\\).`, `\\(SE = s/\\sqrt n = ${f(s, 4)}/\\sqrt{${n}} = ${f(se, 3)}\\).`)
      };
    }
  },
  {
    id: 'ca-stevens-law', title: "Stevens' power law: perceived intensity ratio", lesson: 'sensory-methods', difficulty: 2,
    gen(rng) {
      const mods = [['sweetness of sucrose', 1.3], ['saltiness of NaCl', 1.4], ['sweetness of saccharin', 0.8], ['odour of heptane', 0.6], ['viscosity (stirring)', 0.42]];
      const [name, nExp] = pick(rng, mods); const r = pick(rng, [1.5, 2, 3, 0.5, 0.7]);
      const out = r ** nExp;
      return {
        q: `Stevens' power law \\(\\psi = k\\,\\varphi^{n}\\) has exponent \\(n = ${nExp}\\) for the ${name}. If the stimulus concentration is multiplied by ${r}, by what factor does the perceived intensity change?`,
        answer: out, tol: 0.01, unit: '×',
        solution: steps(`Ratio form: \\(\\psi_2/\\psi_1 = (\\varphi_2/\\varphi_1)^{n}\\) — the constant \\(k\\) cancels.`, `\\(${r}^{${nExp}} = ${f(out, 4)}\\).`, nExp > 1 ? 'Exponent > 1: the sensation grows faster than the stimulus (expansion).' : 'Exponent < 1: the sensation grows slower than the stimulus (compression).')
      };
    }
  },
  /* ======================= 13.4 sensory statistics ======================= */
  {
    id: 'ca-triangle-pvalue', title: 'Exact p-value of a triangle test', lesson: 'sensory-statistics', difficulty: 2,
    gen(rng) {
      const n = randInt(rng, 18, 40); const x = randInt(rng, Math.round(n / 3) + 1, Math.round(n * 0.62));
      const p = binomUpper(x, n, 1 / 3);
      return {
        q: `In a triangle test comparing ${pick(rng, ['hydroponic and soil-grown lettuce', 'bread with 0 % and 5 % cricket flour', 'two batches of mycoprotein nuggets', 'salted and low-salt seaweed crisps'])}, ${x} of ${n} panellists identified the odd sample. What is the one-sided exact binomial p-value \\(P(X\\ge ${x})\\) under \\(H_0: p_0 = 1/3\\)?`,
        answer: p, tol: 0.03, unit: '',
        solution: steps(`\\(p = \\sum_{i=${x}}^{${n}} \\binom{${n}}{i}(1/3)^i(2/3)^{${n}-i}\\).`, `Summing the upper tail gives \\(p = ${fp(p)}\\).`, p < 0.05 ? 'p < 0.05: reject H₀ — a perceptible difference exists.' : 'p ≥ 0.05: no evidence of a difference (which is not the same as evidence of similarity).')
      };
    }
  },
  {
    id: 'ca-triangle-critical', title: 'Critical number of correct answers', lesson: 'sensory-statistics', difficulty: 2,
    gen(rng) {
      const n = randInt(rng, 12, 48), alpha = pick(rng, [0.05, 0.05, 0.01]);
      const test = pick(rng, [['triangle', 1 / 3], ['duo–trio', 1 / 2]]);
      const k = binomCritical(n, test[1], alpha);
      return {
        q: `What is the minimum number of correct answers needed for significance at α = ${alpha} in a ${test[0]} test with ${n} panellists (one-sided exact binomial test)?`,
        answer: k, abstol: 0.5, unit: 'correct answers',
        solution: steps(`Find the smallest \\(k\\) with \\(P(X\\ge k \\mid n=${n},\\,p_0=${test[1] === 0.5 ? '1/2' : '1/3'}) \\le ${alpha}\\).`, `\\(P(X\\ge ${k - 1}) = ${fp(binomUpper(k - 1, n, test[1]))}\\) &gt; ${alpha}, but \\(P(X\\ge ${k}) = ${fp(binomUpper(k, n, test[1]))}\\) ≤ ${alpha}.`, `Critical number = ${k}.`)
      };
    }
  },
  {
    id: 'ca-pd-guessing', title: 'Proportion of discriminators (guessing model)', lesson: 'sensory-statistics', difficulty: 1,
    gen(rng) {
      const test = pick(rng, [['triangle', 1 / 3], ['triangle', 1 / 3], ['duo–trio', 1 / 2]]);
      const n = randInt(rng, 20, 60); const x = randInt(rng, Math.ceil(n * test[1]) + 1, Math.round(n * 0.8));
      const pc = x / n, pd = (pc - test[1]) / (1 - test[1]);
      return {
        q: `${x} of ${n} panellists answered a ${test[0]} test correctly. Using the guessing model, estimate the proportion of true discriminators \\(p_d\\).`,
        answer: pd, abstol: 0.005, unit: '',
        solution: steps(`\\(P_c = ${x}/${n} = ${f(pc, 4)}\\).`, test[1] < 0.5 ? `\\(p_d = (3P_c-1)/2 = (3\\times${f(pc, 4)}-1)/2 = ${f(pd, 3)}\\).` : `\\(p_d = 2P_c-1 = 2\\times${f(pc, 4)}-1 = ${f(pd, 3)}\\).`, `About ${Math.round(pd * 100)} % of the population would perceive the difference.`)
      };
    }
  },
  {
    id: 'ca-paired-preference', title: 'Two-sided paired preference test', lesson: 'sensory-statistics', difficulty: 2,
    gen(rng) {
      const n = randInt(rng, 20, 50); const x = randInt(rng, Math.ceil(n / 2) + 1, Math.round(n * 0.75));
      const p = Math.min(1, 2 * binomUpper(x, n, 0.5));
      return {
        q: `${n} consumers tasted ${pick(rng, ['a pea-protein and a soy-protein burger', 'two recipes of seaweed pesto', 'bread with 0 % and 10 % cricket flour'])} and ${x} preferred the first product (no “no preference” option). What is the two-sided exact p-value?`,
        answer: p, tol: 0.03, unit: '',
        solution: steps(`Under \\(H_0\\) either product is equally likely: \\(p_0 = 1/2\\). A preference could go either way, so the test is two-sided.`, `\\(P(X\\ge ${x}) = ${fp(binomUpper(x, n, 0.5))}\\).`, `Two-sided \\(p = 2\\times${fp(binomUpper(x, n, 0.5))} = ${fp(p)}\\).`)
      };
    }
  },
  {
    id: 'ca-triangle-power', title: 'Power of a triangle test for a given p_d', lesson: 'sensory-statistics', difficulty: 3,
    gen(rng) {
      const n = pick(rng, [18, 24, 30, 36, 42, 48]); const pd = pick(rng, [0.2, 0.25, 0.3, 0.4, 0.5]);
      const k = binomCritical(n, 1 / 3, 0.05); const pc = 1 / 3 + 2 / 3 * pd; const pw = binomUpper(k, n, pc);
      return {
        q: `A student group plans a triangle test with ${n} panellists at α = 0.05. If ${Math.round(pd * 100)} % of the population are true discriminators, what is the power of the test (probability of a significant result)?`,
        answer: pw, abstol: 0.01, unit: '',
        solution: steps(`Critical number: \\(k = ${k}\\) (smallest \\(k\\) with \\(P(X\\ge k\\mid p_0=1/3)\\le 0.05\\)).`, `Under \\(H_1\\): \\(P_c = 1/3 + (2/3)p_d = ${f(pc, 4)}\\).`, `Power \\(= P(X\\ge ${k}\\mid n=${n}, P_c=${f(pc, 4)}) = ${f(pw, 3)}\\).`, pw < 0.8 ? 'Below the conventional 0.80 — consider a larger panel or accept that only large differences can be detected.' : 'At least 0.80 — adequately powered.')
      };
    }
  },
  {
    id: 'ca-dprime-method', title: 'Same proportion correct, different d′', lesson: 'sensory-statistics', difficulty: 3,
    gen(rng) {
      const pc = pick(rng, [0.5, 0.55, 0.6, 0.65, 0.7]);
      const dTri = invert(pcTriangle, pc), d3 = invert(pc3AFC, pc);
      const pd = 1.5 * pc - 0.5;
      const correct = `d′ ≈ ${dTri.toFixed(2)}`;
      return mcq(rng, `A triangle test gave a proportion correct of \\(P_c = ${pc}\\). Using the Thurstonian model for the triangle method, what is the estimated d′?`, correct,
        [`d′ ≈ ${d3.toFixed(2)}`, `d′ ≈ ${pd.toFixed(2)}`, `d′ ≈ ${(Math.SQRT2 * normInv(pc)).toFixed(2)}`],
        `<p>Invert the triangle psychometric function \\(P_c = f_{\\text{tri}}(d')\\): \\(d' = ${dTri.toFixed(2)}\\). The distractors are the 3-AFC value (${d3.toFixed(2)} — the same \\(P_c\\) is much easier to reach in a directional test), the proportion of discriminators \\(p_d = ${pd.toFixed(2)}\\) (a different scale) and the 2-AFC formula \\(\\sqrt2\\,\\Phi^{-1}(P_c)\\). This is Frijters' “paradox of discriminatory non-discriminators”.</p>`);
    }
  },
  {
    id: 'ca-williams-design', title: 'Williams designs: number of serving sequences', lesson: 'sensory-statistics', difficulty: 1,
    gen(rng) {
      const t = randInt(rng, 3, 8); const seqs = t % 2 === 0 ? t : 2 * t;
      const panel = seqs * randInt(rng, 2, 5);
      return {
        q: `How many distinct serving sequences does a Williams design need to balance first-order carry-over for ${t} samples? (A panel of ${panel} would then use each sequence ${panel / seqs} times.)`,
        answer: seqs, abstol: 0.5, unit: 'sequences',
        solution: steps(t % 2 === 0 ? `${t} is even: a single Williams Latin square of ${t} rows balances position and first-order carry-over.` : `${t} is odd: one square cannot balance carry-over, so a square and its mirror image (reversed rows) are combined: \\(2t = ${2 * t}\\) sequences.`, `Panel sizes should be multiples of ${seqs} so that every sequence is used equally often.`)
      };
    }
  },
  {
    id: 'ca-rcbd-f', title: 'Hedonic ANOVA with panellists as blocks: the F ratio', lesson: 'sensory-statistics', difficulty: 2,
    gen(rng) {
      const t = randInt(rng, 3, 4), b = randInt(rng, 20, 40);
      const sst = rand(rng, 12, 45, 0.1), ssb = rand(rng, 60, 160, 0.1), sse = rand(rng, 0.7, 1.3, 0.01) * (t - 1) * (b - 1);
      const dft = t - 1, dfb = b - 1, dfe = dft * dfb; const F = (sst / dft) / (sse / dfe); const p = 1 - fCdf(F, dft, dfe);
      return {
        q: `${b} panellists each rated ${t} breads on the 9-point hedonic scale. A two-way ANOVA without interaction gave SS<sub>samples</sub> = ${sst}, SS<sub>panellists</sub> = ${ssb} and SS<sub>error</sub> = ${f(sse, 4)}. Compute the F ratio for samples.`,
        answer: F, tol: 0.02, unit: '',
        solution: steps(`\\(df_{\\text{samples}} = t-1 = ${dft}\\), \\(df_{\\text{error}} = (t-1)(b-1) = ${dfe}\\).`, `\\(MS_{\\text{samples}} = ${sst}/${dft} = ${f(sst / dft, 4)}\\); \\(MS_E = ${f(sse, 4)}/${dfe} = ${f(sse / dfe, 4)}\\).`, `\\(F = ${f(sst / dft, 4)}/${f(sse / dfe, 4)} = ${f(F, 4)}\\), \\(p = ${fp(p)}\\). The panellist SS is removed from the error term — that is the point of blocking.`)
      };
    }
  },
  {
    id: 'ca-rcbd-full', title: 'Full randomised-block ANOVA from raw hedonic scores', lesson: 'sensory-statistics', difficulty: 3,
    gen(rng) {
      const b = 5, t = 3; const mu = [rand(rng, 6, 7.5, 0.5), rand(rng, 5, 7, 0.5), rand(rng, 4, 6, 0.5)];
      const m = Array.from({ length: b }, () => { const p = (rng() - 0.5) * 3; return mu.map(v => Math.max(1, Math.min(9, Math.round(v + p + (rng() - 0.5) * 2)))); });
      const A = anovaRCBD(m);
      if (!(A.error.ss > 0.5) || !Number.isFinite(A.treatment.F)) return this.gen(rng);
      const rows = m.map((r, i) => `<tr><td>P${i + 1}</td>${r.map(v => `<td class="num">${v}</td>`).join('')}</tr>`).join('');
      return {
        q: `Five panellists rated three seaweed-crisp recipes (A, B, C). Treat panellists as blocks and compute the F ratio for recipes.<table><thead><tr><th>Panellist</th><th>A</th><th>B</th><th>C</th></tr></thead><tbody>${rows}</tbody></table>`,
        answer: A.treatment.F, tol: 0.03, unit: '',
        solution: steps(`Grand mean \\(\\bar x = ${f(A.grandMean, 4)}\\); recipe means ${A.tMeans.map(v => f(v, 3)).join(', ')}; panellist means ${A.bMeans.map(v => f(v, 3)).join(', ')}.`,
          `\\(SS_T = \\sum (x-\\bar x)^2 = ${f(A.total.ss, 4)}\\); \\(SS_{\\text{recipes}} = b\\sum(\\bar x_j-\\bar x)^2 = ${f(A.treatment.ss, 4)}\\); \\(SS_{\\text{panellists}} = t\\sum(\\bar x_i-\\bar x)^2 = ${f(A.block.ss, 4)}\\).`,
          `\\(SS_E = SS_T - SS_{\\text{recipes}} - SS_{\\text{panellists}} = ${f(A.error.ss, 4)}\\) with \\(df = 2\\times4 = 8\\).`,
          `\\(F = (${f(A.treatment.ss, 4)}/2)/(${f(A.error.ss, 4)}/8) = ${f(A.treatment.F, 4)}\\), \\(p = ${fp(A.treatment.p)}\\).`)
      };
    }
  },
  {
    id: 'ca-tukey-hsd', title: 'Tukey honestly significant difference', lesson: 'sensory-statistics', difficulty: 2,
    gen(rng) {
      const t = randInt(rng, 3, 5), b = pick(rng, [20, 24, 30, 36]); const dfe = (t - 1) * (b - 1);
      const mse = rand(rng, 0.7, 1.6, 0.01); const q = qtukey(0.95, t, dfe); const hsd = q * Math.sqrt(mse / b);
      return {
        q: `After a randomised-block ANOVA of ${t} products rated by ${b} panellists, \\(MS_E = ${mse}\\) with ${dfe} df. The studentised-range critical value is \\(q_{0.05;${t},${dfe}} = ${q.toFixed(3)}\\). What is Tukey's HSD (the smallest difference between two product means that is significant)?`,
        answer: hsd, tol: 0.01, unit: 'hedonic points',
        solution: steps(`\\(\\text{HSD} = q\\sqrt{MS_E/b}\\), where \\(b\\) is the number of ratings per mean.`, `\\(= ${q.toFixed(3)}\\times\\sqrt{${mse}/${b}} = ${q.toFixed(3)}\\times${f(Math.sqrt(mse / b), 4)} = ${f(hsd, 3)}\\).`)
      };
    }
  },
  {
    id: 'ca-cochran-q', title: "Cochran's Q for a CATA attribute", lesson: 'sensory-statistics', difficulty: 3,
    gen(rng) {
      const n = randInt(rng, 12, 20); const p = [rand(rng, 0.05, 0.3, 0.05), rand(rng, 0.3, 0.6, 0.05), rand(rng, 0.4, 0.8, 0.05)];
      const rows = Array.from({ length: n }, () => p.map(v => rng() < v ? 1 : 0));
      const C = [0, 1, 2].map(j => rows.reduce((s, r) => s + r[j], 0)); const R = rows.map(r => r[0] + r[1] + r[2]);
      const N = C.reduce((a, b) => a + b, 0), sR2 = R.reduce((s, v) => s + v * v, 0), sC2 = C.reduce((s, v) => s + v * v, 0);
      const den = 3 * N - sR2;
      if (den === 0) return this.gen(rng);
      const Q = 2 * (3 * sC2 - N * N) / den; const pv = 1 - chi2Cdf(Q, 2);
      const attr = pick(rng, ['“earthy”', '“nutty”', '“bitter”', '“umami”']);
      return {
        q: `${n} panellists ticked the CATA attribute ${attr} for three samples. The column totals (number of ticks per sample) are ${C.join(', ')}, the grand total is \\(N = ${N}\\), and the sum of squared panellist totals is \\(\\sum R_i^2 = ${sR2}\\). Compute Cochran's Q.`,
        answer: Q, tol: 0.02, unit: '',
        solution: steps(`\\(Q = \\dfrac{(k-1)\\left[k\\sum C_j^2 - N^2\\right]}{kN - \\sum R_i^2}\\) with \\(k = 3\\).`, `\\(\\sum C_j^2 = ${sC2}\\); numerator \\(= 2\\,[3\\times${sC2} - ${N}^2] = ${2 * (3 * sC2 - N * N)}\\); denominator \\(= 3\\times${N} - ${sR2} = ${den}\\).`, `\\(Q = ${f(Q, 4)}\\); compare with \\(\\chi^2_2\\): \\(p = ${fp(pv)}\\).`)
      };
    }
  },
  {
    id: 'ca-jar-penalty', title: 'JAR penalty analysis', lesson: 'sensory-statistics', difficulty: 2,
    gen(rng) {
      const n = pick(rng, [40, 50, 60, 80]); const nToo = randInt(rng, Math.round(n * 0.12), Math.round(n * 0.4)); const nJar = randInt(rng, Math.round(n * 0.4), n - nToo - 2);
      const lJar = rand(rng, 6.4, 7.4, 0.1), lToo = rand(rng, 4.6, 6.2, 0.1);
      const pen = lJar - lToo, w = pen * nToo / n;
      const attr = pick(rng, ['too bitter', 'too dark', 'too dry', 'too salty', 'too firm']);
      return {
        q: `In a JAR study with ${n} consumers of a cricket-flour bread, ${nToo} rated it “${attr}” (mean liking ${lToo}) and ${nJar} rated it “just about right” (mean liking ${lJar}). What is the <b>weighted</b> penalty for “${attr}”?`,
        answer: w, abstol: 0.02, unit: 'hedonic points',
        solution: steps(`Mean drop (penalty) \\(= \\bar L_{\\text{JAR}} - \\bar L_{\\text{too}} = ${lJar} - ${lToo} = ${f(pen, 3)}\\).`, `Proportion in the non-JAR group \\(= ${nToo}/${n} = ${f(nToo / n, 3)}\\) (${nToo / n >= 0.2 ? '≥ 20 %: usually considered important' : '< 20 %: often ignored'}).`, `Weighted penalty \\(= ${f(pen, 3)}\\times${f(nToo / n, 3)} = ${f(w, 3)}\\) points of overall liking.`)
      };
    }
  },
  {
    id: 'ca-similarity-upper', title: 'Similarity: upper confidence limit of p_d', lesson: 'sensory-statistics', difficulty: 3,
    gen(rng) {
      const n = pick(rng, [30, 36, 42, 48, 60, 72]); const x = randInt(rng, Math.round(n / 3) - 2, Math.round(n / 3) + 4);
      const pc = x / n, pd = 1.5 * pc - 0.5, se = 1.5 * Math.sqrt(pc * (1 - pc) / n), up = pd + 1.645 * se;
      return {
        q: `${x} of ${n} panellists were correct in a triangle test of a reformulated (lower-cost) seaweed snack. Using the normal approximation used in ISO 4120, compute the one-sided 95 % upper confidence limit for the proportion of discriminators, \\(p_d + z_{0.95}\\,SE(p_d)\\) with \\(z_{0.95} = 1.645\\).`,
        answer: up, abstol: 0.01, unit: '',
        solution: steps(`\\(P_c = ${f(pc, 4)}\\), \\(\\hat p_d = 1.5P_c - 0.5 = ${f(pd, 3)}\\).`, `\\(SE(\\hat p_d) = 1.5\\sqrt{P_c(1-P_c)/n} = ${f(se, 4)}\\).`, `Upper limit \\(= ${f(pd, 3)} + 1.645\\times${f(se, 4)} = ${f(up, 3)}\\).`, `Similarity at the chosen \\(p_{d,\\max}\\) is only supported if this upper limit is below \\(p_{d,\\max}\\) (e.g., 0.20–0.30).`)
      };
    }
  },
  /* ======================= 13.3 additions (sensory-methods) ======================= */
  {
    id: 'ca-sm-dprime-2afc', title: 'd′ from a 2-AFC (directional) test', lesson: 'sensory-methods', difficulty: 2,
    gen(rng) {
      const n = pick(rng, [24, 30, 32, 36, 40]); const x = randInt(rng, Math.ceil(n * 0.58), Math.round(n * 0.9));
      const pc = x / n, z = normInv(pc), d = Math.SQRT2 * z;
      return {
        q: `In a 2-AFC test (“Which sample is more bitter?”) ${x} of ${n} panellists correctly chose the bread with cricket flour. Estimate the Thurstonian d′ (equal-variance model, Eq. 13.3.4).`,
        answer: d, tol: 0.02, unit: 'SD units',
        solution: steps(`\\(P_c = ${x}/${n} = ${f(pc, 4)}\\).`, `\\(\\Phi^{-1}(${f(pc, 4)}) = ${f(z, 4)}\\).`, `\\(d' = \\sqrt2\\,\\Phi^{-1}(P_c) = 1.4142\\times${f(z, 4)} = ${f(d, 3)}\\).`, 'The same d′ would give a much lower proportion correct in a triangle test, because its decision task is harder.')
      };
    }
  },
  {
    id: 'ca-sm-friedman', title: 'Friedman test for preference ranking of three samples', lesson: 'sensory-methods', difficulty: 2,
    gen(rng) {
      const b = pick(rng, [12, 15, 18, 20, 24, 30]); const mu = [rand(rng, 0, 1.2, 0.1), rand(rng, 0, 1.2, 0.1), 0];
      const noise = () => (rng() + rng() + rng() - 1.5) * 1.2;
      const R = [0, 0, 0];
      for (let i = 0; i < b; i++) { const s = mu.map(m => m + noise()); const order = [0, 1, 2].sort((p, q) => s[q] - s[p]); order.forEach((j, r) => { R[j] += r + 1; }); }
      const F = 12 / (b * 3 * 4) * R.reduce((acc, r) => acc + r * r, 0) - 3 * b * 4, p = Math.exp(-F / 2);
      const prod = pick(rng, [['hydroponic butterhead', 'soil-grown butterhead', 'red oak-leaf lettuce'], ['seaweed crisp A', 'seaweed crisp B', 'potato crisp'], ['wheat bread', 'bread with 5 % cricket flour', 'bread with 10 % cricket flour']]);
      return {
        q: `${b} panellists ranked three samples from most (1) to least (3) preferred: ${prod[0]} (A), ${prod[1]} (B) and ${prod[2]} (C). The rank sums are \\(R_A = ${R[0]}\\), \\(R_B = ${R[1]}\\), \\(R_C = ${R[2]}\\). Compute the Friedman statistic \\(F_r\\).`,
        answer: F, abstol: 0.02, unit: '',
        solution: steps(`Check: the rank sums must total \\(b\\,t(t+1)/2 = ${b}\\times6 = ${6 * b}\\) ✓.`, `\\(F_r = \\dfrac{12}{bt(t+1)}\\sum R_j^2 - 3b(t+1) = \\dfrac{12}{${b * 12}}(${R.map(r => r + '^2').join('+')}) - ${12 * b} = ${f(F, 4)}\\).`, `With 2 degrees of freedom \\(p = e^{-F_r/2} = ${fp(p)}\\): ${p < 0.05 ? 'a significant difference in preference.' : 'no significant difference in preference at α = 0.05.'}`)
      };
    }
  },
  {
    id: 'ca-sm-tds-significance', title: 'TDS chance and significance levels', lesson: 'sensory-methods', difficulty: 1,
    gen(rng) {
      const p = randInt(rng, 6, 10), n = pick(rng, [20, 24, 30, 36, 40, 48]), P0 = 1 / p, Ps = P0 + 1.645 * Math.sqrt(P0 * (1 - P0) / n);
      return {
        q: `A temporal-dominance-of-sensations list contains ${p} attributes and ${n} evaluations (panellists × replicates) are recorded. Above which dominance rate is an attribute considered significantly dominant (the significance level of Pineau et al., 2009)?`,
        answer: Ps, tol: 0.01, unit: '',
        solution: steps(`Chance level \\(P_0 = 1/${p} = ${f(P0, 4)}\\).`, `\\(P_s = P_0 + 1.645\\sqrt{P_0(1-P_0)/n} = ${f(P0, 4)} + 1.645\\sqrt{${f(P0, 4)}\\times${f(1 - P0, 4)}/${n}} = ${f(Ps, 3)}\\).`)
      };
    }
  },
  {
    id: 'ca-sm-serving-window', title: 'Serving window of a warm sample (Newton cooling)', lesson: 'sensory-methods', difficulty: 2,
    gen(rng) {
      const T0 = rand(rng, 42, 60, 1), Tr = rand(rng, 20, 22, 0.5), Tl = rand(rng, Math.round(Tr + 8), T0 - 5, 1), tau = rand(rng, 6, 20, 0.5);
      const ratio = (T0 - Tr) / (Tl - Tr), t = tau * Math.log(ratio);
      return {
        q: `Warm bread slices leave the warming cabinet at ${T0} °C in a room at ${Tr} °C, and the crumb must be at least ${Tl} °C when tasted. A pilot gave a cooling time constant τ = ${tau} min. How long can a slice wait before it is tasted (Eq. 13.3.8)?`,
        answer: t, tol: 0.02, unit: 'min',
        solution: steps(`\\(t^* = \\tau\\ln\\dfrac{T_0 - T_r}{T_{\\lim} - T_r}\\).`, `\\(= ${tau}\\times\\ln\\dfrac{${T0} - ${Tr}}{${Tl} - ${Tr}} = ${tau}\\times\\ln ${f(ratio, 4)} = ${f(t, 3)}\\) min.`, 'Serve each tray only when the assessor signals readiness.')
      };
    }
  },
  {
    id: 'ca-sm-method-choice', title: 'Choosing a sensory method for a question', lesson: 'sensory-methods', difficulty: 1,
    gen(rng) {
      const S = [
        ['Could consumers notice that the seaweed supplier has been changed? (Nobody knows which attribute might change.)', 'Triangle or tetrad test', ['9-point hedonic test', 'Paired preference test', 'Temporal dominance of sensations']],
        ['Is the reduced-salt crisp perceived as less salty than the original?', '2-AFC (directional paired comparison) test', ['Triangle test', 'Just-about-right scale', 'Flash profile']],
        ['How much do students like bread with 10 % cricket flour?', '9-point hedonic scale with consumers', ['Quantitative descriptive analysis with a trained panel', 'Triangle test', 'Duo–trio test']],
        ['How does the bitterness of mycoprotein nuggets develop during chewing and after swallowing?', 'Temporal dominance of sensations (or time–intensity)', ['Triangle test', 'Paired preference test', '9-point hedonic scale']],
        ['Which words do consumers use to describe hydroponic and soil-grown lettuce?', 'Check-all-that-apply (CATA) question', ['Triangle test', 'Duo–trio test', 'Paired preference test']],
        ['Is the bread too bitter, not bitter enough or just right for consumers?', 'Just-about-right (JAR) scale', ['Tetrad test', 'Triangle test', 'Flash profile']]
      ];
      const [q, c, w] = pick(rng, S);
      return mcq(rng, `Which method answers this question most directly? <b>${q}</b>`, c, w, `<p>Discrimination tests ask whether a difference exists (unspecified: triangle, tetrad; directional: 2-AFC, 3-AFC); affective tests measure liking or preference; CATA and descriptive methods describe; JAR scales diagnose the direction of a problem; temporal methods follow perception over time (Lesson 13.3).</p>`);
    }
  },
  /* ======================= 13.4 additions (sensory-statistics) ======================= */
  {
    id: 'ca-ss-similarity-exact', title: 'Exact similarity test for a triangle test', lesson: 'sensory-statistics', difficulty: 3,
    gen(rng) {
      const n = pick(rng, [48, 54, 60, 66, 72]), pd0 = pick(rng, [0.2, 0.25, 0.3]), x = randInt(rng, Math.round(n / 3) - 3, Math.round(n / 3) + 5);
      const pc0 = 1 / 3 + 2 / 3 * pd0, p = binomCdf(x, n, pc0);
      return {
        q: `A triangle test for similarity (tolerable proportion of discriminators \\(p_{d0} = ${pd0}\\), β = 0.05) gave ${x} correct answers from ${n} assessors. What is the similarity p-value \\(P(X\\le ${x}\\mid n, p_{c0})\\)?`,
        answer: p, tol: 0.03, unit: '',
        solution: steps(`\\(p_{c0} = \\tfrac13 + ${pd0}\\times\\tfrac23 = ${f(pc0, 4)}\\).`, `\\(p_{\\text{sim}} = \\sum_{i=0}^{${x}}\\binom{${n}}{i}\\,${f(pc0, 4)}^{\\,i}\\,(1-${f(pc0, 4)})^{\\,${n}-i} = ${fp(p)}\\).`, p <= 0.05 ? 'p ≤ β = 0.05: conclude similarity at this tolerable limit.' : 'p > β: similarity is not demonstrated — which is not evidence of a difference either.')
      };
    }
  },
  {
    id: 'ca-ss-hedonic-n', title: 'Panellists needed for a paired liking comparison', lesson: 'sensory-statistics', difficulty: 2,
    gen(rng) {
      const sdd = rand(rng, 1.2, 2.6, 0.1), D = pick(rng, [0.5, 0.75, 1, 1.25, 1.5]), pw = pick(rng, [0.8, 0.9]); const zb = pw === 0.8 ? 0.8416 : 1.2816;
      const n = (1.96 + zb) ** 2 * (sdd / D) ** 2, nUp = Math.ceil(n - 1e-9);
      return {
        q: `Using the normal approximation \\(n = (z_{1-\\alpha/2}+z_{1-\\beta})^2\\sigma_d^2/\\Delta^2\\) with α = 0.05 (two-sided) and power ${pw}, how many panellists are needed to detect a difference of Δ = ${D} points in mean liking between two products rated by the same panellists, if the SD of the within-panellist differences is \\(\\sigma_d = ${sdd}\\) points? (Round up.)`,
        answer: nUp, abstol: 1, unit: 'panellists',
        solution: steps(`\\(z_{0.975} = 1.960\\), \\(z_{${pw}} = ${zb}\\).`, `\\(n = (1.960 + ${zb})^2\\times(${sdd}/${D})^2 = ${f((1.96 + zb) ** 2, 4)}\\times${f((sdd / D) ** 2, 4)} = ${f(n, 4)}\\) → ${nUp}.`, 'Iterating with Student\'s t (Eq. 13.4.13) adds a few more panellists.')
      };
    }
  },
  {
    id: 'ca-ss-mcnemar', title: 'Exact McNemar test for a CATA word', lesson: 'sensory-statistics', difficulty: 2,
    gen(rng) {
      const b = randInt(rng, 0, 4), c = randInt(rng, b + 3, b + 10), m = b + c, p = Math.min(1, 2 * binomCdf(b, m, 0.5));
      const w = pick(rng, ['earthy', 'nutty', 'bitter', 'dry']);
      return {
        q: `In a CATA study, ${b} consumers ticked “${w}” only for the wheat bread and ${c} only for the cricket bread (all others ticked it for both breads or for neither). What is the two-sided exact McNemar p-value?`,
        answer: p, tol: 0.03, unit: '',
        solution: steps(`Only the ${m} discordant consumers carry information; under \\(H_0\\) each is equally likely to fall on either side, so \\(X\\sim\\text{Bin}(${m}, 1/2)\\).`, `\\(p = 2\\,P(X\\le ${b}) = 2\\times${fp(binomCdf(b, m, 0.5))} = ${fp(p)}\\).`)
      };
    }
  },
  {
    id: 'ca-ss-dprime-triangle', title: 'Thurstonian d′ from a triangle result (numeric)', lesson: 'sensory-statistics', difficulty: 3,
    gen(rng) {
      const n = pick(rng, [24, 30, 36, 42, 48, 60]), x = randInt(rng, Math.ceil(n * 0.42), Math.round(n * 0.75)), pc = x / n, d = invert(pcTriangle, pc);
      return {
        q: `In a triangle test, ${x} of ${n} assessors identified the odd sample. Estimate d′ by inverting the triangle psychometric function (Eq. 13.4.4).`,
        answer: d, tol: 0.03, unit: 'SD units',
        solution: steps(`\\(\\hat p_c = ${x}/${n} = ${f(pc, 4)}\\).`, `Solve \\(f_{\\text{tri}}(d') = ${f(pc, 4)}\\) numerically: \\(d' = ${f(d, 3)}\\).`, `Check against Table 3 of Lesson 13.4: \\(f_{\\text{tri}}(1) = 0.418\\), \\(f_{\\text{tri}}(1.5) = 0.507\\), \\(f_{\\text{tri}}(2) = 0.605\\), \\(f_{\\text{tri}}(3) = 0.781\\).`)
      };
    }
  }
];

function lnC(n, k) { let s = 0; for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i); return s; }
