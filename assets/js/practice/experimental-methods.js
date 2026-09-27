/* ==========================================================================
   Practice generators — Module 3: Experimental design, statistics and reporting
   Lessons: experimental-design (3.1), descriptive-statistics (3.2),
            inferential-statistics (3.3), scientific-reporting (3.4)
   Every generator returns a fresh, randomised, auto-marked problem.
   Statistics come from /assets/js/stats.js so that lessons, labs and practice
   agree to the last digit.
   ========================================================================== */
import { rand, randInt, pick, f, steps, mcq } from './helpers.js';
import { mean, sd, variance, quantile, normInv, normCdf, tInv, tCdf, fCdf, qtukey, linreg, anova1, powerTwoSample } from '../stats.js';

/* ---------- local helpers ---------- */
const fp = p => p < 0.0001 ? p.toExponential(2) : (+p.toPrecision(3)).toString();
const gauss = rng => { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const sample = (rng, n, mu, s, step = 0.1) => Array.from({ length: n }, () => +(Math.round((mu + s * gauss(rng)) / step) * step).toFixed(6));
const list = a => a.map(v => f(v, 5)).join(', ');
const QT = new Map(); // cache of studentised-range quantiles (numerical integration is slow)
const qt = (k, df) => { const key = k + '_' + df; if (!QT.has(key)) QT.set(key, qtukey(0.95, k, df)); return QT.get(key); };
const decFor = u => { const e = Math.floor(Math.log10(u)); const lead = Math.floor(u / Math.pow(10, e) + 1e-9); return Math.max(0, 1 - e + (lead === 1 ? 1 : 0)); };
const SYSTEMS = ['Kratky jars', 'deep-water-culture tanks', 'NFT channels'];

export default [
  /* ======================= 3.1 experimental design ======================= */
  {
    id: 'em-cohens-d-cv', title: "Cohen's d from a percentage effect and the CV", lesson: 'experimental-design', difficulty: 1,
    gen(rng) {
      const dp = rand(rng, 6, 30, 1), cv = rand(rng, 6, 20, 1), d = dp / cv;
      return {
        q: `A group wants to detect a ${dp} % increase in lettuce fresh mass. Last year's data gave a coefficient of variation of ${cv} % between ${pick(rng, SYSTEMS)}. What is the standardised effect size (Cohen's d)?`,
        answer: d, tol: 0.02, unit: '',
        solution: steps(`Eq. 3.1.7: \\(d \\approx \\Delta_{\\%}/\\text{CV}_{\\%}\\).`, `\\(d = ${dp}/${cv} = ${f(d, 3)}\\).`, d >= 1 ? 'A large effect in Cohen\'s terms — common in well-controlled plant experiments.' : 'A moderate effect: it will need many experimental units to detect.')
      };
    }
  },
  {
    id: 'em-sample-size', title: 'Units per group for a target power (normal approximation)', lesson: 'experimental-design', difficulty: 2,
    gen(rng) {
      const d = rand(rng, 0.6, 2.0, 0.05), alpha = pick(rng, [0.05, 0.05, 0.01]), pw = pick(rng, [0.8, 0.9]);
      const za = normInv(1 - alpha / 2), zb = normInv(pw), n = 2 * (za + zb) ** 2 / (d * d);
      return {
        q: `How many experimental units per treatment are needed to detect \\(d = ${d}\\) with a two-sided test at \\(\\alpha = ${alpha}\\) and a power of ${pw}? Use the normal approximation (Eq. 3.1.8) and give the unrounded value.`,
        answer: n, tol: 0.02, unit: 'units per group',
        solution: steps(`\\(z_{1-\\alpha/2} = ${f(za, 4)}\\), \\(z_{1-\\beta} = ${f(zb, 4)}\\).`, `\\(n = 2(z_{1-\\alpha/2}+z_{1-\\beta})^2/d^2 = 2\\times${f(za + zb, 4)}^2/${d}^2 = ${f(n, 4)}\\).`, `Round up to ${Math.ceil(n)}; the exact t-based calculation needs about one more unit, plus a margin of 10–20 % for plant losses.`)
      };
    }
  },
  {
    id: 'em-power-normal', title: 'Power of a planned two-group experiment', lesson: 'experimental-design', difficulty: 3,
    gen(rng) {
      const d = rand(rng, 0.8, 2.2, 0.1), n = randInt(rng, 4, 12), pw = normCdf(d * Math.sqrt(n / 2) - 1.959964);
      return {
        q: `A group plans ${n} Kratky jars per treatment and expects an effect of \\(d = ${d}\\). Estimate the power of a two-sided two-sample test at \\(\\alpha = 0.05\\) with the normal approximation \\(1-\\beta \\approx \\Phi\\left(d\\sqrt{n/2} - z_{0.975}\\right)\\).`,
        answer: pw, abstol: 0.02, unit: '',
        solution: steps(`Non-centrality: \\(\\delta = d\\sqrt{n/2} = ${d}\\times\\sqrt{${n}/2} = ${f(d * Math.sqrt(n / 2), 4)}\\).`, `\\(1-\\beta \\approx \\Phi(${f(d * Math.sqrt(n / 2), 4)} - 1.960) = \\Phi(${f(d * Math.sqrt(n / 2) - 1.96, 3)}) = ${f(pw, 3)}\\).`, `The t-based power is slightly lower (≈ ${f(powerTwoSample(d, n, 0.05), 3)} with <code>powerTwoSample</code>), because σ must be estimated. ${pw < 0.8 ? 'Below 0.80: consider more jars.' : 'At least 0.80: adequate.'}`)
      };
    }
  },
  {
    id: 'em-nested-se', title: 'Standard error with plants nested in tanks', lesson: 'experimental-design', difficulty: 2,
    gen(rng) {
      const su = rand(rng, 4, 15, 1), se = rand(rng, 8, 25, 1), n = randInt(rng, 2, 8), m = randInt(rng, 2, 12);
      const SE = Math.sqrt(su * su / n + se * se / (n * m));
      return {
        q: `Each nutrient solution is tested in ${n} DWC tanks with ${m} lettuces per tank. The between-tank SD is ${su} g and the within-tank (plant-to-plant) SD is ${se} g. What is the standard error of a treatment mean (Eq. 3.1.3)?`,
        answer: SE, tol: 0.02, unit: 'g',
        solution: steps(`\\(\\operatorname{SE} = \\sqrt{\\sigma_u^2/n + \\sigma_e^2/(nm)}\\).`, `\\(= \\sqrt{${su}^2/${n} + ${se}^2/(${n}\\times${m})} = \\sqrt{${f(su * su / n, 4)} + ${f(se * se / (n * m), 4)}} = ${f(SE, 4)}\\) g.`, `More plants per tank only shrink the second term; the first shrinks only with more tanks.`)
      };
    }
  },
  {
    id: 'em-relative-efficiency', title: 'Relative efficiency of blocking', lesson: 'experimental-design', difficulty: 2,
    gen(rng) {
      const t = randInt(rng, 3, 4), b = randInt(rng, 4, 8), mse = rand(rng, 20, 60, 1), msb = Math.round(mse * rand(rng, 1.2, 6, 0.1));
      const re = ((b - 1) * msb + b * (t - 1) * mse) / ((b * t - 1) * mse);
      return {
        q: `A randomised complete block experiment with ${t} spectra and ${b} shelves (blocks) gave \\(\\text{MS}_{\\text{blocks}} = ${msb}\\) g² and \\(\\text{MS}_E = ${mse}\\) g². Calculate the relative efficiency of blocking (Eq. 3.1.6).`,
        answer: re, tol: 0.02, unit: '',
        solution: steps(`\\(\\text{RE} = \\dfrac{(b-1)\\text{MS}_{\\text{blocks}} + b(t-1)\\text{MS}_E}{(bt-1)\\text{MS}_E}\\).`, `\\(= \\dfrac{${b - 1}\\times${msb} + ${b}\\times${t - 1}\\times${mse}}{${b * t - 1}\\times${mse}} = \\dfrac{${(b - 1) * msb + b * (t - 1) * mse}}{${(b * t - 1) * mse}} = ${f(re, 3)}\\).`, `A completely randomised design would need about ${f(re, 2)} times as many units for the same precision.`)
      };
    }
  },
  {
    id: 'em-randomisations', title: 'How many randomised layouts are possible?', lesson: 'experimental-design', difficulty: 1,
    gen(rng) {
      const t = randInt(rng, 2, 3), n = randInt(rng, 2, t === 3 ? 5 : 6), N = t * n;
      let lr = 0; for (let i = 2; i <= N; i++) lr += Math.log(i); let ln = 0; for (let i = 2; i <= n; i++) ln += Math.log(i);
      const R = Math.round(Math.exp(lr - t * ln));
      return {
        q: `${t} nutrient recipes are each given to ${n} Kratky jars placed in ${N} numbered positions on one bench. How many distinct completely randomised layouts are there (Eq. 3.1.4)?`,
        answer: R, tol: 0.001, unit: 'layouts',
        solution: steps(`\\(R = N!/(n!)^t\\) with \\(N = ${N}\\), \\(n = ${n}\\), \\(t = ${t}\\).`, `\\(R = ${N}!/(${n}!)^{${t}} = ${R.toLocaleString('en-GB')}\\).`, 'A tidy layout is just one of them — and the one most likely to be confounded with a gradient.')
      };
    }
  },
  {
    id: 'em-experimental-unit', title: 'Identify the experimental unit', lesson: 'experimental-design', difficulty: 1,
    gen(rng) {
      const k = randInt(rng, 3, 8), m = randInt(rng, 6, 12);
      const S = pick(rng, [
        { q: `Two deep-water-culture tanks are used, one per nutrient solution, each holding ${m} lettuces.`, c: '1 tank per treatment — no valid test of the solutions is possible', w: [`${m} plants per treatment`, `${2 * m} plants in total`, `${m / 2} plants per treatment (the other half are controls)`], e: 'The solution was applied to the tank: the tank is the experimental unit and the plants are subsamples (pseudo-replication; Hurlbert, 1984).' },
        { q: `${k} one-litre Kratky jars per EC level, one plant per jar, jars randomised along one bench.`, c: `${k} jars per treatment`, w: [`1 bench per treatment`, `${2 * k} jars per treatment`, `${k * 4} leaves per treatment`], e: 'Each jar received its EC level independently: jar = experimental unit = observational unit.' },
        { q: `Three LED spectra with one grow tent per spectrum and ${m} plants per tent, grown once.`, c: '1 tent per spectrum — replicate tents or runs are needed', w: [`${m} plants per spectrum`, `${3 * m} plants`, `3 tents per spectrum`], e: 'A spectrum is applied to a whole tent; without several tents (or runs) per spectrum, tent and spectrum effects are confounded.' },
        { q: `${k} NFT channels per nutrient solution, each with its own reservoir, ${m} plants per channel.`, c: `${k} channels per treatment`, w: [`${k * m} plants per treatment`, `1 reservoir per treatment`, `${m} plants per treatment`], e: 'The channel with its reservoir receives the treatment independently: average the plants within each channel.' }
      ]);
      return mcq(rng, `${S.q} What is the correct number of experimental units per treatment?`, S.c, S.w, `<p>${S.e}</p>`);
    }
  },
  {
    id: 'em-pseudoreplication-df', title: 'Degrees of freedom when plants are nested in tanks', lesson: 'experimental-design', difficulty: 2,
    gen(rng) {
      const k = randInt(rng, 3, 6), m = randInt(rng, 3, 8);
      return {
        q: `Two nutrient solutions are compared in ${k} DWC tanks each, with ${m} plants per tank. The group averages the plants in each tank and runs a pooled two-sample t-test on the tank means. How many degrees of freedom does the test have?`,
        answer: 2 * k - 2, abstol: 0.5, unit: 'df',
        solution: steps(`The tank is the experimental unit: \\(n = ${k}\\) per solution.`, `\\(\\nu = n_1 + n_2 - 2 = ${k} + ${k} - 2 = ${2 * k - 2}\\).`, `Treating all ${2 * k * m} plants as independent would give ${2 * k * m - 2} df — pseudo-replication, with standard errors that are too small.`)
      };
    }
  },
  /* ======================= 3.2 descriptive statistics ======================= */
  {
    id: 'em-mean-sd-se', title: 'Mean, SD and SE of a small sample', lesson: 'descriptive-statistics', difficulty: 1,
    gen(rng) {
      const n = randInt(rng, 5, 8), x = sample(rng, n, rand(rng, 120, 170, 1), rand(rng, 6, 14, 0.5));
      const which = pick(rng, ['mean', 'sd', 'se']), m = mean(x), s = sd(x), se = s / Math.sqrt(n);
      const ans = which === 'mean' ? m : which === 'sd' ? s : se;
      return {
        q: `Shoot fresh masses (g) of ${n} lettuces from one treatment: <b>${list(x)}</b>. Calculate the ${which === 'mean' ? 'mean' : which === 'sd' ? 'sample standard deviation (divide by n − 1)' : 'standard error of the mean'}.`,
        answer: ans, tol: 0.01, unit: 'g',
        solution: steps(`\\(\\bar x = ${f(x.reduce((a, b) => a + b, 0), 6)}/${n} = ${f(m, 5)}\\) g.`, `\\(s = \\sqrt{\\sum(x_i-\\bar x)^2/(n-1)} = \\sqrt{${f(variance(x) * (n - 1), 5)}/${n - 1}} = ${f(s, 4)}\\) g.`, `\\(\\text{SE} = s/\\sqrt n = ${f(s, 4)}/\\sqrt{${n}} = ${f(se, 4)}\\) g.`)
      };
    }
  },
  {
    id: 'em-cv', title: 'Coefficient of variation', lesson: 'descriptive-statistics', difficulty: 1,
    gen(rng) {
      const m = rand(rng, 90, 210, 0.1), s = rand(rng, 5, 25, 0.1), cv = 100 * s / m;
      return {
        q: `Lettuce fresh mass in one treatment was ${m} ± ${s} g (mean ± SD). What is the coefficient of variation?`,
        answer: cv, tol: 0.02, unit: '%',
        solution: steps(`Eq. 3.2.3: \\(\\text{CV} = s/\\bar x\\times100\\,\\%\\).`, `\\(= ${s}/${m}\\times100 = ${f(cv, 3)}\\,\\%\\).`, 'Meaningful only for ratio-scale data such as mass — never for °C or pH.')
      };
    }
  },
  {
    id: 'em-sd-from-se', title: 'Recover the SD from a reported SE', lesson: 'descriptive-statistics', difficulty: 1,
    gen(rng) {
      const m = rand(rng, 120, 220, 1), se = rand(rng, 1.5, 8, 0.1), n = randInt(rng, 4, 16), s = se * Math.sqrt(n);
      return {
        q: `A paper reports lettuce fresh mass as ${m} ± ${se} g (mean ± SE, n = ${n}). What is the standard deviation?`,
        answer: s, tol: 0.02, unit: 'g',
        solution: steps(`Eq. 3.2.4: \\(s = \\text{SE}\\sqrt n\\).`, `\\(s = ${se}\\times\\sqrt{${n}} = ${f(s, 4)}\\) g.`, `The spread of the plants is ${f(Math.sqrt(n), 3)} times the printed number — use this SD, not the SE, in power calculations.`)
      };
    }
  },
  {
    id: 'em-tukey-fences', title: "Quartiles and Tukey's fences", lesson: 'descriptive-statistics', difficulty: 2,
    gen(rng) {
      const n = pick(rng, [9, 13]), x = sample(rng, n, 150, 9, 0.1).sort((a, b) => a - b);
      if (rng() < 0.6) x[0] = +(x[0] - rand(rng, 20, 45, 0.1)).toFixed(1);
      const s = [...x].sort((a, b) => a - b), q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), lo = q1 - 1.5 * (q3 - q1);
      const flagged = s.filter(v => v < lo);
      return {
        q: `Sorted fresh masses (g) of ${n} plants: <b>${list(s)}</b>. Using type-7 quartiles (as in Excel's QUARTILE.INC and stats.js), where is the lower Tukey fence?`,
        answer: lo, tol: 0.005, unit: 'g',
        solution: steps(`Positions: \\(h = (n-1)p + 1\\) gives ${f((n - 1) * 0.25 + 1, 3)} for Q1 and ${f((n - 1) * 0.75 + 1, 3)} for Q3 — for n = ${n} both are whole numbers, so Q1 = ${f(q1, 5)} g and Q3 = ${f(q3, 5)} g.`, `IQR = ${f(q3 - q1, 4)} g; lower fence = Q1 − 1.5 × IQR = ${f(lo, 5)} g.`, flagged.length ? `Flagged: ${flagged.map(v => f(v, 4) + ' g').join(', ')} — investigate (Lesson 3.2, Figure 6), do not delete blindly.` : 'No plant lies below the fence.')
      };
    }
  },
  /* ======================= 3.3 inferential statistics ======================= */
  {
    id: 'em-ci-mean', title: 't-based 95 % confidence interval', lesson: 'inferential-statistics', difficulty: 2,
    gen(rng) {
      const n = randInt(rng, 4, 10), m = rand(rng, 120, 180, 0.1), s = rand(rng, 5, 15, 0.1), tc = tInv(0.975, n - 1), h = tc * s / Math.sqrt(n);
      return {
        q: `Six weeks after transplanting, ${n} compartments of one spectrum gave a mean fresh mass of ${m} g with SD ${s} g. What is the <b>upper</b> limit of the 95 % confidence interval for the population mean? (\\(t_{0.975,${n - 1}} = ${tc.toFixed(3)}\\))`,
        answer: m + h, tol: 0.003, unit: 'g',
        solution: steps(`Eq. 3.3.3: \\(\\bar x \\pm t_{0.975,n-1}\\,s/\\sqrt n\\).`, `\\(\\text{SE} = ${s}/\\sqrt{${n}} = ${f(s / Math.sqrt(n), 4)}\\) g; half-width \\(= ${tc.toFixed(3)}\\times${f(s / Math.sqrt(n), 4)} = ${f(h, 4)}\\) g.`, `95 % CI: ${f(m - h, 5)}–${f(m + h, 5)} g.`)
      };
    }
  },
  {
    id: 'em-one-sample-t', title: 'One-sample t-test: is the PPFD on target?', lesson: 'inferential-statistics', difficulty: 2,
    gen(rng) {
      const n = randInt(rng, 6, 10), target = pick(rng, [200, 250, 300]), x = sample(rng, n, target + rand(rng, -10, 10, 1), rand(rng, 4, 10, 0.5), 1);
      const m = mean(x), s = sd(x), t = (m - target) / (s / Math.sqrt(n)), p = 2 * (1 - tCdf(Math.abs(t), n - 1));
      return {
        q: `PPFD readings (µmol m⁻² s⁻¹) on a grid in one compartment: <b>${x.join(', ')}</b>. The protocol requires ${target} µmol m⁻² s⁻¹. Compute the one-sample t statistic (Eq. 3.3.6).`,
        answer: t, tol: 0.02, unit: '',
        solution: steps(`\\(\\bar x = ${f(m, 5)}\\), \\(s = ${f(s, 4)}\\), \\(\\text{SE} = ${f(s / Math.sqrt(n), 4)}\\).`, `\\(t = (${f(m, 5)} - ${target})/${f(s / Math.sqrt(n), 4)} = ${f(t, 4)}\\) with ${n - 1} df.`, `Two-sided \\(p = ${fp(p)}\\) — ${p < 0.05 ? 'the compartment is off target; also judge whether the difference matters in practice.' : 'no evidence that the compartment is off target.'}`)
      };
    }
  },
  {
    id: 'em-welch-df', title: 'Welch–Satterthwaite degrees of freedom', lesson: 'inferential-statistics', difficulty: 2,
    gen(rng) {
      const s1 = rand(rng, 4, 20, 0.1), s2 = rand(rng, 4, 20, 0.1), n1 = randInt(rng, 4, 12), n2 = randInt(rng, 4, 12);
      const v1 = s1 * s1 / n1, v2 = s2 * s2 / n2, df = (v1 + v2) ** 2 / (v1 * v1 / (n1 - 1) + v2 * v2 / (n2 - 1));
      return {
        q: `Group 1: SD ${s1} g, n = ${n1}; group 2: SD ${s2} g, n = ${n2}. Calculate the Welch–Satterthwaite degrees of freedom (Eq. 3.3.7).`,
        answer: df, tol: 0.02, unit: 'df',
        solution: steps(`\\(v_1 = s_1^2/n_1 = ${f(v1, 4)}\\), \\(v_2 = s_2^2/n_2 = ${f(v2, 4)}\\).`, `\\(\\nu_W = (v_1+v_2)^2/[v_1^2/(n_1-1) + v_2^2/(n_2-1)] = ${f((v1 + v2) ** 2, 5)}/${f(v1 * v1 / (n1 - 1) + v2 * v2 / (n2 - 1), 5)} = ${f(df, 4)}\\).`, `Check: between \\(\\min(n_1,n_2)-1 = ${Math.min(n1, n2) - 1}\\) and \\(n_1+n_2-2 = ${n1 + n2 - 2}\\).`)
      };
    }
  },
  {
    id: 'em-welch-t', title: "Welch's t statistic from summary statistics", lesson: 'inferential-statistics', difficulty: 2,
    gen(rng) {
      const n = randInt(rng, 5, 10), m1 = rand(rng, 140, 180, 0.1), m2 = +(m1 - rand(rng, 5, 25, 0.1)).toFixed(1), s1 = rand(rng, 6, 14, 0.1), s2 = rand(rng, 6, 14, 0.1);
      const se = Math.sqrt(s1 * s1 / n + s2 * s2 / n), t = (m1 - m2) / se;
      return {
        q: `W+FR: ${m1} ± ${s1} g; W: ${m2} ± ${s2} g (mean ± SD, n = ${n} compartments each). Calculate Welch's t statistic for W+FR − W.`,
        answer: t, tol: 0.02, unit: '',
        solution: steps(`\\(\\text{SE}_{\\text{diff}} = \\sqrt{${s1}^2/${n} + ${s2}^2/${n}} = ${f(se, 4)}\\) g.`, `\\(t = (${m1} - ${m2})/${f(se, 4)} = ${f(t, 4)}\\).`, `Relative effect: ${f(100 * (m1 / m2 - 1), 3)} %.`)
      };
    }
  },
  {
    id: 'em-paired-t', title: 'Paired t-test on block differences', lesson: 'inferential-statistics', difficulty: 2,
    gen(rng) {
      const n = randInt(rng, 5, 8), d = sample(rng, n, rand(rng, 5, 20, 0.5), rand(rng, 3, 8, 0.5), 0.1);
      const m = mean(d), s = sd(d), t = m / (s / Math.sqrt(n));
      return {
        q: `In ${n} blocks (shelves), the difference in fresh mass W+FR − W was (g): <b>${list(d)}</b>. Calculate the paired t statistic (Eq. 3.3.8).`,
        answer: t, tol: 0.02, unit: '',
        solution: steps(`\\(\\bar d = ${f(m, 5)}\\) g, \\(s_d = ${f(s, 4)}\\) g.`, `\\(t = \\bar d/(s_d/\\sqrt n) = ${f(m, 5)}/(${f(s, 4)}/\\sqrt{${n}}) = ${f(t, 4)}\\) with ${n - 1} df.`, `\\(p = ${fp(2 * (1 - tCdf(Math.abs(t), n - 1)))}\\). Pairing removes the shelf effect from the error.`)
      };
    }
  },
  {
    id: 'em-anova-f', title: 'F ratio from sums of squares', lesson: 'inferential-statistics', difficulty: 2,
    gen(rng) {
      const k = randInt(rng, 3, 5), n = randInt(rng, 4, 8), N = k * n, ssb = rand(rng, 200, 2500, 10), ssw = rand(rng, 300, 2000, 10);
      const F = (ssb / (k - 1)) / (ssw / (N - k)), p = 1 - fCdf(F, k - 1, N - k);
      return {
        q: `A one-way ANOVA of ${k} substrates with ${n} jars each gave SS<sub>between</sub> = ${ssb} g² and SS<sub>within</sub> = ${ssw} g². Calculate F.`,
        answer: F, tol: 0.02, unit: '',
        solution: steps(`\\(\\text{MS}_B = ${ssb}/${k - 1} = ${f(ssb / (k - 1), 5)}\\) g²; \\(\\text{MS}_W = ${ssw}/${N - k} = ${f(ssw / (N - k), 5)}\\) g².`, `\\(F = ${f(ssb / (k - 1), 5)}/${f(ssw / (N - k), 5)} = ${f(F, 4)}\\) with (${k - 1}, ${N - k}) df.`, `\\(p = ${fp(p)}\\); \\(\\eta^2 = ${f(ssb / (ssb + ssw), 3)}\\).`)
      };
    }
  },
  {
    id: 'em-anova-raw', title: 'One-way ANOVA from raw data', lesson: 'inferential-statistics', difficulty: 3,
    gen(rng) {
      const mus = [rand(rng, 130, 150, 1), rand(rng, 135, 160, 1), rand(rng, 140, 170, 1)];
      const G = mus.map(mu => sample(rng, 4, mu, 7, 1));
      const A = anova1(G);
      if (!(A.ssw > 1)) return this.gen(rng);
      const rows = [0, 1, 2, 3].map(i => `<tr><td>${i + 1}</td>${G.map(g => `<td class="num">${g[i]}</td>`).join('')}</tr>`).join('');
      return {
        q: `Fresh mass (g) of lettuce in four Kratky jars per EC level. Compute the one-way ANOVA F statistic.<table><thead><tr><th>Jar</th><th>EC 1.0</th><th>EC 1.6</th><th>EC 2.2</th></tr></thead><tbody>${rows}</tbody></table>`,
        answer: A.F, tol: 0.02, unit: '',
        solution: steps(`Group means ${A.means.map(v => f(v, 5)).join(', ')} g; grand mean ${f(A.grandMean, 5)} g.`, `\\(\\text{SS}_B = 4\\sum(\\bar y_i-\\bar y)^2 = ${f(A.ssb, 5)}\\) g²; \\(\\text{SS}_W = \\sum\\sum(y_{ij}-\\bar y_i)^2 = ${f(A.ssw, 5)}\\) g².`, `\\(F = (${f(A.ssb, 5)}/2)/(${f(A.ssw, 5)}/9) = ${f(A.F, 4)}\\), \\(p = ${fp(A.p)}\\).`)
      };
    }
  },
  {
    id: 'em-tukey-hsd', title: "Tukey's honestly significant difference", lesson: 'inferential-statistics', difficulty: 2,
    gen(rng) {
      const k = randInt(rng, 3, 5), df = pick(rng, [10, 12, 15, 20, 24]), mse = rand(rng, 20, 90, 0.5), n = randInt(rng, 4, 8), q = qt(k, df), hsd = q * Math.sqrt(mse / n);
      return {
        q: `After an ANOVA of ${k} spectra with ${n} compartments each, \\(\\text{MS}_E = ${mse}\\) g² on ${df} df. With \\(q_{0.95;${k},${df}} = ${q.toFixed(3)}\\), what is Tukey's HSD?`,
        answer: hsd, tol: 0.01, unit: 'g',
        solution: steps(`Eq. 3.3.11: \\(\\text{HSD} = q\\sqrt{\\text{MS}_E/n}\\).`, `\\(= ${q.toFixed(3)}\\times\\sqrt{${mse}/${n}} = ${q.toFixed(3)}\\times${f(Math.sqrt(mse / n), 4)} = ${f(hsd, 4)}\\) g.`, 'Any two means further apart than the HSD differ at a family-wise α = 0.05.')
      };
    }
  },
  {
    id: 'em-regression-slope', title: 'Least-squares slope and intercept', lesson: 'inferential-statistics', difficulty: 2,
    gen(rng) {
      const x = [0.8, 1.2, 1.6, 2.0, 2.4], b = rand(rng, 8, 25, 0.5), a = rand(rng, 95, 125, 1), y = x.map(v => +(a + b * v + 5 * gauss(rng)).toFixed(1));
      const L = linreg(x, y), which = pick(rng, ['slope', 'intercept']);
      const mx = mean(x), my = mean(y), sxx = x.reduce((s, v) => s + (v - mx) ** 2, 0), sxy = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0);
      return {
        q: `Mean fresh mass (g) per EC level: <b>${x.map((v, i) => `EC ${v}: ${y[i]}`).join('; ')}</b> (EC in mS cm⁻¹). Find the least-squares ${which === 'slope' ? 'slope (g per mS cm⁻¹)' : 'intercept (g)'}.`,
        answer: which === 'slope' ? L.slope : L.intercept, tol: 0.02, unit: which === 'slope' ? 'g per mS cm⁻¹' : 'g',
        solution: steps(`\\(\\bar x = ${f(mx, 3)}\\), \\(\\bar y = ${f(my, 5)}\\), \\(S_{xx} = ${f(sxx, 4)}\\), \\(S_{xy} = ${f(sxy, 5)}\\).`, `\\(b_1 = S_{xy}/S_{xx} = ${f(L.slope, 5)}\\); \\(b_0 = \\bar y - b_1\\bar x = ${f(L.intercept, 5)}\\).`, `\\(R^2 = ${f(L.r2, 3)}\\).`)
      };
    }
  },
  {
    id: 'em-r-squared', title: 'Coefficient of determination', lesson: 'inferential-statistics', difficulty: 1,
    gen(rng) {
      const sst = rand(rng, 800, 3000, 1), sse = Math.round(sst * rand(rng, 0.1, 0.7, 0.01)), r2 = 1 - sse / sst;
      return {
        q: `A regression of fresh mass on EC gave SST = ${sst} g² and SSE = ${sse} g². What is \\(R^2\\)?`,
        answer: r2, abstol: 0.005, unit: '',
        solution: steps(`Eq. 3.3.15: \\(R^2 = 1-\\text{SSE}/\\text{SST}\\).`, `\\(= 1 - ${sse}/${sst} = ${f(r2, 3)}\\); \\(|r| = \\sqrt{R^2} = ${f(Math.sqrt(r2), 3)}\\).`)
      };
    }
  },
  {
    id: 'em-slope-t', title: 'Testing a regression slope', lesson: 'inferential-statistics', difficulty: 3,
    gen(rng) {
      const b = rand(rng, 4, 25, 0.01), s = rand(rng, 3, 12, 0.01), sxx = rand(rng, 1, 10, 0.1), n = randInt(rng, 8, 20);
      const se = s / Math.sqrt(sxx), t = b / se, p = 2 * (1 - tCdf(Math.abs(t), n - 2));
      return {
        q: `A regression on ${n} jars gave \\(b_1 = ${b}\\) g per mS cm⁻¹, residual SD \\(s = ${s}\\) g and \\(S_{xx} = ${sxx}\\) (mS cm⁻¹)². Calculate the t statistic for \\(H_0: \\beta_1 = 0\\) (Eq. 3.3.16).`,
        answer: t, tol: 0.02, unit: '',
        solution: steps(`\\(\\operatorname{SE}(b_1) = s/\\sqrt{S_{xx}} = ${s}/\\sqrt{${sxx}} = ${f(se, 4)}\\).`, `\\(t = ${b}/${f(se, 4)} = ${f(t, 4)}\\) with \\(n-2 = ${n - 2}\\) df.`, `\\(p = ${fp(p)}\\); 95 % CI \\(${b}\\pm${f(tInv(0.975, n - 2), 4)}\\times${f(se, 4)}\\).`)
      };
    }
  },
  {
    id: 'em-rgr-two-harvests', title: 'Relative growth rate from two harvests', lesson: 'inferential-statistics', difficulty: 1,
    gen(rng) {
      const t1 = pick(rng, [7, 10, 14]), t2 = t1 + pick(rng, [7, 10, 14]), w1 = rand(rng, 1.5, 12, 0.1), r = rand(rng, 0.08, 0.22, 0.005), w2 = +(w1 * Math.exp(r * (t2 - t1))).toFixed(1);
      const rgr = (Math.log(w2) - Math.log(w1)) / (t2 - t1);
      return {
        q: `A lettuce weighed ${w1} g (fresh mass) ${t1} days after transplanting and ${w2} g at day ${t2}. What was its mean relative growth rate?`,
        answer: rgr, tol: 0.02, unit: 'g g⁻¹ d⁻¹',
        solution: steps(`\\(\\text{RGR} = (\\ln W_2 - \\ln W_1)/(t_2 - t_1)\\).`, `\\(= (\\ln ${w2} - \\ln ${w1})/${t2 - t1} = (${f(Math.log(w2), 4)} - ${f(Math.log(w1), 4)})/${t2 - t1} = ${f(rgr, 4)}\\) d⁻¹.`, `Doubling time \\(\\ln 2/\\text{RGR} = ${f(Math.LN2 / rgr, 3)}\\) days. One RGR per plant is a clean response for a t-test or ANOVA (no pseudo-replication).`)
      };
    }
  },
  {
    id: 'em-rgr-regression', title: 'RGR as the slope of ln(leaf area) on time', lesson: 'inferential-statistics', difficulty: 3,
    gen(rng) {
      const t = [7, 14, 21, 28], a0 = rand(rng, 8, 20, 0.5), r = rand(rng, 0.08, 0.16, 0.005), A = t.map(d => Math.round(a0 * Math.exp(r * d + 0.05 * gauss(rng))));
      const L = linreg(t, A.map(Math.log));
      return {
        q: `Projected leaf area of one plant from weekly photos: day 7: ${A[0]} cm², day 14: ${A[1]} cm², day 21: ${A[2]} cm², day 28: ${A[3]} cm². Regress \\(\\ln A\\) on time and report the slope (the relative growth rate).`,
        answer: L.slope, tol: 0.02, unit: 'd⁻¹',
        solution: steps(`\\(\\ln A\\) = ${A.map(v => f(Math.log(v), 4)).join(', ')}; \\(\\bar t = 17.5\\), \\(S_{tt} = 245\\).`, `\\(b_1 = S_{t,\\ln A}/S_{tt} = ${f(L.slope * 245, 4)}/245 = ${f(L.slope, 4)}\\) d⁻¹ (\\(R^2 = ${f(L.r2, 3)}\\)).`, 'Exponential growth is linear on the log scale (Lesson 2.4); a clear curve in the residuals would signal a slowing RGR.')
      };
    }
  },
  {
    id: 'em-fwer', title: 'Family-wise error rate', lesson: 'inferential-statistics', difficulty: 1,
    gen(rng) {
      const m = randInt(rng, 2, 20), a = pick(rng, [0.05, 0.05, 0.01]), fw = 1 - (1 - a) ** m;
      return {
        q: `A group tests ${m} independent secondary responses, each at α = ${a}. If no treatment effects exist, what is the probability of at least one significant result?`,
        answer: fw, tol: 0.02, unit: '',
        solution: steps(`Eq. 3.3.19: \\(\\text{FWER} = 1-(1-\\alpha)^m\\).`, `\\(= 1-(1-${a})^{${m}} = ${f(fw, 4)}\\).`, `Bonferroni would test each at \\(${a}/${m} = ${f(a / m, 3)}\\); Holm is uniformly more powerful.`)
      };
    }
  },
  {
    id: 'em-pvalue-meaning', title: 'What a p-value means', lesson: 'inferential-statistics', difficulty: 1,
    gen(rng) {
      const p = pick(rng, [0.012, 0.021, 0.034, 0.041, 0.008]), resp = pick(rng, ['fresh mass', 'leaf area', 'nitrate content', 'dry mass']);
      return mcq(rng, `A Welch t-test comparing ${resp} under two spectra gives p = ${p}. Which statement is correct?`,
        `If the population means were equal and the model assumptions held, a difference at least this large would occur in about ${(p * 100).toFixed(1)} % of experiments.`,
        [`There is a ${(p * 100).toFixed(1)} % probability that the null hypothesis is true.`, `There is a ${(100 - p * 100).toFixed(1)} % probability that the effect is real.`, 'The effect is large and practically important.'],
        '<p>A p-value is computed assuming H₀ (and the whole model) is true. It is not the probability of H₀ (see the false positive risk, Eq. 3.3.5) and says nothing about the size of the effect (ASA principles 2 and 5; Wasserstein &amp; Lazar, 2016).</p>');
    }
  },
  {
    id: 'em-false-positive-risk', title: 'False positive risk of a significant result', lesson: 'inferential-statistics', difficulty: 2,
    gen(rng) {
      const pi = rand(rng, 0.05, 0.5, 0.05), pw = rand(rng, 0.3, 0.9, 0.1), a = 0.05, fpr = a * (1 - pi) / (a * (1 - pi) + pw * pi);
      return {
        q: `Suppose ${Math.round(pi * 100)} % of the hypotheses a lab tests are true and its experiments have a power of ${pw}. With α = 0.05, what fraction of its significant results are false positives (Eq. 3.3.5)?`,
        answer: fpr, tol: 0.02, unit: '',
        solution: steps(`Out of 1 000 tests: true effects ${Math.round(1000 * pi)}, of which ${f(1000 * pi * pw, 4)} significant; nulls ${Math.round(1000 * (1 - pi))}, of which ${f(1000 * (1 - pi) * a, 4)} significant.`, `\\(\\text{FPR} = ${f(1000 * (1 - pi) * a, 4)}/(${f(1000 * (1 - pi) * a, 4)} + ${f(1000 * pi * pw, 4)}) = ${f(fpr, 3)}\\).`)
      };
    }
  },
  /* ======================= 3.4 scientific reporting ======================= */
  {
    id: 'em-statcheck', title: 'Recompute a reported p-value', lesson: 'scientific-reporting', difficulty: 2,
    gen(rng) {
      const t = rand(rng, 1.6, 3.4, 0.01), df = randInt(rng, 5, 24), p = 2 * (1 - tCdf(t, df)), rep = pick(rng, [0.01, 0.03, 0.04, 0.02]);
      return {
        q: `A classmate reports “t(${df}) = ${t.toFixed(2)}, p = ${String(rep).replace(/^0/, '')}” for a two-sided test. Recompute the two-sided p-value from t and df (Eq. 3.4.3).`,
        answer: p, abstol: 0.003, unit: '',
        solution: steps(`\\(p = 2[1-F_{t,${df}}(${t.toFixed(2)})] = ${f(p, 3)}\\).`, Math.abs(p - rep) <= 0.005 ? 'The reported value is consistent (within rounding).' : `The reported p = ${rep} is <b>inconsistent</b>${(p <= 0.05) !== (rep <= 0.05) ? ' — and it is a decision error, because the conclusion at α = .05 changes' : ''}.`)
      };
    }
  },
  {
    id: 'em-d-from-t', title: "Cohen's d from a reported t statistic", lesson: 'scientific-reporting', difficulty: 2,
    gen(rng) {
      const n1 = randInt(rng, 5, 15), n2 = randInt(rng, 5, 15), t = rand(rng, 1.5, 4.5, 0.01), d = t * Math.sqrt(1 / n1 + 1 / n2);
      return {
        q: `A paper reports a pooled two-sample test, t(${n1 + n2 - 2}) = ${t.toFixed(2)}, with ${n1} and ${n2} plants per group. What is Cohen's d (Eq. 3.4.4)?`,
        answer: d, tol: 0.02, unit: '',
        solution: steps(`\\(d = t\\sqrt{1/n_1+1/n_2} = ${t.toFixed(2)}\\times\\sqrt{1/${n1}+1/${n2}} = ${f(d, 3)}\\).`, 'Now the effect can be compared with your own experiment on a common scale.')
      };
    }
  },
  {
    id: 'em-grim', title: 'GRIM: is this mean possible?', lesson: 'scientific-reporting', difficulty: 2,
    gen(rng) {
      const n = randInt(rng, 8, 20), T = randInt(rng, 4 * n, 8 * n), good = Math.round(T / n * 100) / 100;
      const dist = m => Math.min(...[Math.floor(m * n), Math.ceil(m * n)].map(k => Math.abs(k / n - m)));
      const wrong = []; let tries = 0;
      while (wrong.length < 3 && tries++ < 200) { const m = +(good + pick(rng, [-1, 1]) * randInt(rng, 1, 9) / 100).toFixed(2); if (m > 1 && m < 9 && dist(m) > 0.005 + 1e-9 && !wrong.includes(m) && m !== good) wrong.push(m); }
      if (wrong.length < 3) return this.gen(rng);
      return mcq(rng, `${n} panellists rated a seaweed crisp on the 9-point hedonic scale (integer scores). Which reported mean (two decimals) is possible?`, good.toFixed(2), wrong.map(v => v.toFixed(2)),
        `<p>Means of ${n} integers move in steps of 1/${n} = ${f(1 / n, 3)}. ${good.toFixed(2)} = ${T}/${n} (rounded) is attainable; for the others, mean × n is not close to an integer (Eq. 3.4.5).</p>`);
    }
  },
  {
    id: 'em-relative-effect-ci', title: 'Relative effect with a confidence interval', lesson: 'scientific-reporting', difficulty: 3,
    gen(rng) {
      const n = randInt(rng, 5, 10), mC = rand(rng, 120, 170, 0.1), mT = +(mC * rand(rng, 1.05, 1.3, 0.01)).toFixed(1), seC = rand(rng, 2.5, 6, 0.1), seT = rand(rng, 2.5, 6, 0.1);
      const a = (seT / mT) ** 2, b = (seC / mC) ** 2, se = Math.sqrt(a + b), df = (a + b) ** 2 / (a * a / (n - 1) + b * b / (n - 1)), tc = +tInv(0.975, df).toFixed(3);
      const lo = 100 * (Math.exp(Math.log(mT / mC) - tc * se) - 1);
      return {
        q: `Treatment: ${mT} g (SE ${seT} g); control: ${mC} g (SE ${seC} g); n = ${n} per group. Using the log-ratio method (Eq. 3.4.6) with \\(t^* = ${tc}\\), what is the <b>lower</b> 95 % limit of the relative effect?`,
        answer: lo, abstol: 0.3, unit: '%',
        solution: steps(`Relative effect \\(100(${mT}/${mC} - 1) = ${f(100 * (mT / mC - 1), 4)}\\,\\%\\).`, `\\(\\operatorname{SE}(\\ln) = \\sqrt{(${seT}/${mT})^2 + (${seC}/${mC})^2} = ${f(se, 4)}\\).`, `Lower limit \\(= 100[\\exp(\\ln(${mT}/${mC}) - ${tc}\\times${f(se, 4)}) - 1] = ${f(lo, 3)}\\,\\%\\).`)
      };
    }
  },
  {
    id: 'em-apa-format', title: 'APA formatting of a test result', lesson: 'scientific-reporting', difficulty: 1,
    gen(rng) {
      const df = randInt(rng, 8, 30), t = rand(rng, 2.1, 3.6, 0.01), p = 2 * (1 - tCdf(t, df)), d = rand(rng, 0.9, 1.6, 0.01);
      const ps = p < 0.001 ? '< .001' : '= ' + p.toFixed(3).replace(/^0/, '');
      return mcq(rng, 'Which result is formatted correctly in APA style?', `<i>t</i>(${df}) = ${t.toFixed(2)}, <i>p</i> ${ps}, <i>d</i> = ${d.toFixed(2)}`,
        [`<i>t</i> = ${t.toFixed(2)}, <i>p</i> ${p < 0.001 ? '< 0.001' : '= ' + p.toFixed(3)}`, `<i>t</i>(${df}) = ${t.toFixed(2)}, <i>p</i> = .000, <i>d</i> = ${d.toFixed(2)}`, `T(${df})=${t.toFixed(2)}, P&lt;0.05`],
        '<p>APA: italic symbol, df in parentheses, the exact p without a leading zero (or p &lt; .001), and an effect size. p is never exactly .000 (Lesson 3.4, Table 4).</p>');
    }
  },
  {
    id: 'em-reporting-precision', title: 'How many decimals to report', lesson: 'scientific-reporting', difficulty: 1,
    gen(rng) {
      const u = +pick(rng, [rand(rng, 0.021, 0.098, 0.001), rand(rng, 0.2, 0.99, 0.01), rand(rng, 1.1, 1.9, 0.1), rand(rng, 2.1, 9.8, 0.1), rand(rng, 12, 19, 0.1), rand(rng, 21, 95, 0.1)]).toFixed(3);
      const k = decFor(u), m = +(rand(rng, 5, 200, 0.0001)).toFixed(4);
      return {
        q: `A mean of ${m} has an SD of ${u}. To how many decimal places should both be reported (two significant figures of the uncertainty, three if it starts with 1; Eq. 3.4.2)?`,
        answer: k, abstol: 0.5, unit: 'decimal places',
        solution: steps(`\\(\\lfloor\\log_{10}${u}\\rfloor = ${Math.floor(Math.log10(u))}\\)${String(u).replace(/^[0.]+/, '')[0] === '1' ? ', and the first significant digit is 1 (add one)' : ''}.`, `\\(k = ${k}\\): report ${m.toFixed(k)} ± ${u.toFixed(k)}.`)
      };
    }
  }
];
