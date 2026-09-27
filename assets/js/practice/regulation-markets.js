/* ==========================================================================
   Practice generators — Module 14: Regulation, policy and the path to market
   Lessons: eu-novel-food (14.1), gmo-ngt-labelling (14.2),
            global-regulation (14.3), innovation-pathways (14.4)
   Case-based MCQs on legal status and procedures, and numeric problems on
   clocks, durations, data protection, labels, fines, launch value and
   diffusion models. Legal facts as described in the lessons (status 2026).
   ========================================================================== */
import { rand, randInt, pick, shuffle, f, steps, mcq } from './helpers.js';

/* ---------- local helpers ---------- */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtDate = d => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
const randDate = (rng, y0, y1) => new Date(Date.UTC(randInt(rng, y0, y1), randInt(rng, 0, 11), randInt(rng, 1, 28)));
const bassF = (t, p, q) => (1 - Math.exp(-(p + q) * t)) / (1 + (q / p) * Math.exp(-(p + q) * t));
/** Pick `n` distinct items from `arr` excluding `except`. */
function others(rng, arr, except, n = 3) { return shuffle(rng, arr.filter(x => x !== except)).slice(0, n); }

/* ---------- case banks ---------- */
const NF_OUT = {
  notNovel: 'Not novel — it can be marketed under general food law',
  art10: 'Novel — an Article 10 application with an EFSA assessment is needed',
  listed: 'Novel, but already on the Union list — it may be marketed within the listed specification and conditions',
  gmo: 'Outside the novel food regulation — it falls under the GMO regime (Regulation (EC) No 1829/2003)'
};
const NF_CASES = [
  ['butterhead lettuce grown in a stacked hydroponic vertical farm', 'notNovel', 'Lettuce was eaten in the EU before 15 May 1997, and soilless cultivation does not significantly change its composition (category (vii) does not apply).'],
  ['a burger made from pea protein, rapeseed oil and beetroot juice, all already sold in the EU', 'notNovel', 'A new recipe of ingredients that are already on the market is not a novel food (recital 17).'],
  ['tilapia raised in an aquaponic system', 'notNovel', 'Fish farming in a recirculating system does not make tilapia a novel food.'],
  ['basil grown under red and blue LEDs', 'notNovel', 'A lighting recipe does not create significant compositional changes of the kind covered by category (vii).'],
  ['a protein powder made from bacterial biomass grown on hydrogen and CO₂', 'art10', 'Food consisting of micro-organisms is category (ii); with no history of use, the traditional-food route is closed.'],
  ['cultivated duck cells for a foie-gras-like product', 'art10', 'Food from cell culture is category (vi); the first EU application (July 2024) was still pending in 2026.'],
  ['cultivated beef fat for blended burgers', 'art10', 'Category (vi); Mosa Meat applied in January 2025 and no cultivated meat had been authorised in the EU by 2026.'],
  ['button mushrooms UV-treated so that they contain up to 10 µg vitamin D₂ per 100 g', 'listed', 'UV treatment is a new process (category (vii)), but UV-treated mushrooms have been authorised since 2017 and are on the Union list.'],
  ['dried yellow mealworm larvae (Tenebrio molitor)', 'listed', 'Insects are category (v); dried mealworm larva was authorised by Implementing Regulation (EU) 2021/882 in June 2021.'],
  ['chia seeds used in bread up to 5 %', 'listed', 'Chia (category (iv)) was authorised in 2009 and carried into the Union list.'],
  ['flour from a genetically modified maize event', 'gmo', 'GM food within Regulation (EC) No 1829/2003 is excluded from the scope of the novel food regulation (Article 2(2)).']
];
const PROC_CASES = [
  ['An operator cannot find evidence of whether a dried berry powder was eaten in the EU before 15 May 1997.', 'Submit a status consultation request to the Member State where it will first be marketed (Article 4; Implementing Regulation (EU) 2018/456)', 'The consultation is decided within 4 months of validity, extendable by at most 4 months.'],
  ['A fruit pulp from primary production has been eaten for more than 50 years in the customary diet of many people in West Africa.', 'Notify it as a traditional food from a third country (Article 14)', 'A 25-year history of safe use in a third country opens the notification route with its 4-month objection window.'],
  ['A start-up has developed a completely new microbial protein with no history of consumption anywhere.', 'Submit an Article 10 application to the Commission for an EFSA risk assessment', 'Without any history of use, only the full authorisation procedure is available.'],
  ['A company wants to sell a novel food that is already on the Union list, with the same specification and uses, and whose data protection has expired.', 'No application: market it in line with the Union list entry', 'Authorisations are generic, so anyone may market a listed novel food within its specification and conditions of use.'],
  ['A company has developed a new synthetic sweetener intended to be used solely as a food additive.', 'Apply under the food additives regulation (Regulation (EC) No 1333/2008), not the novel food regulation', 'Foods used solely as additives, enzymes, flavourings or extraction solvents are outside the scope (Article 2(2)).']
];
const PROC_ALL = PROC_CASES.map(c => c[1]);
const CLOCKS = [
  ['the time EFSA has to adopt its opinion on a valid Article 10 application', '9 months, extended by any clock stops', 'Article 11(1) and 11(4) of Regulation (EU) 2015/2283.'],
  ['the time the Commission has to present a draft implementing act after EFSA publishes its opinion on an Article 10 application', '7 months from publication of the opinion', 'Article 12(1).'],
  ['the window in which Member States or EFSA may raise reasoned safety objections to a traditional-food notification', '4 months from forwarding of the valid notification', 'Article 15(2).'],
  ['the time EFSA has for its opinion on a traditional food after objections were raised', '6 months, extended by any clock stops', 'Article 17.'],
  ['the time a Member State has to conclude a novel food status consultation', '4 months from validity, extendable by at most 4 months', 'Implementing Regulation (EU) 2018/456, Article 6.'],
  ['the period of protection of proprietary scientific data after authorisation', '5 years from the date of authorisation', 'Article 26; it cannot be renewed.'],
  ['the time EFSA has to give its view on the completeness of an application when the Commission consults it during the validity check', '30 working days', 'Implementing Regulation (EU) 2017/2469, Article 6.']
];
const CLOCK_ALL = CLOCKS.map(c => c[1]).concat(['3 months from adoption of the opinion', '60 days', '12 months']);
const NGT_OUT = {
  ngt1: 'Category 1 (NGT1): verification, then treated like a conventional plant',
  ngt2: 'Category 2 (NGT2): authorisation with GMO-type labelling and traceability',
  gmo: 'A GMO under Directive 2001/18/EC and Regulation (EC) No 1829/2003',
  conv: 'Exempt: conventional breeding or random mutagenesis with a long safety record'
};
const NGT_CASES = [
  ['a wheat line in which CRISPR–Cas9 deleted part of an asparagine synthetase gene to reduce acrylamide in bread', 'ngt1', 'A deletion is an NGT1-type modification and reduced acrylamide is not an excluded trait.'],
  ['an oilseed rape made tolerant to a herbicide by a single base edit', 'ngt2', 'Herbicide tolerance is an excluded trait, so the plant is NGT2 however small the edit.'],
  ['a potato with late-blight resistance genes from wild potato relatives inserted by cisgenesis within the criteria', 'ngt1', 'Cisgenic insertions from the breeders\' gene pool can qualify for NGT1 when the criteria are met.'],
  ['a maize expressing an insecticidal protein gene from Bacillus thuringiensis', 'gmo', 'Transgenes from outside the breeders\' gene pool keep the plant under the GMO legislation.'],
  ['a barley variety produced by gamma-ray mutagenesis in the 1970s', 'conv', 'Random mutagenesis with a long safety record is exempt (Annex I B of Directive 2001/18/EC; CJEU C-528/16).'],
  ['a tomato with many edits including a long insertion that does not meet the listed modification types', 'ngt2', 'Modifications outside the NGT1 criteria make the plant NGT2.']
];
const REG_CASES = [
  ['cultivated chicken in the United States', 'An FDA pre-market consultation for the cell-culture phase, then a USDA-FSIS grant of inspection and label approval', 'Under the FDA–USDA formal agreement of 7 March 2019, jurisdiction passes to USDA-FSIS at harvest.'],
  ['cultivated coho salmon in the United States', 'The FDA alone, from cell bank to label', 'Seafood other than Siluriformes catfish is overseen solely by the FDA (Wildtype, 28 May 2025).'],
  ['cultivated quail in Singapore', 'Pre-market approval by the Singapore Food Agency under the Food Safety and Security Act 2025', 'Since 28 November 2025 supplying a novel food without pre-market approval is an offence.'],
  ['cultivated quail in Australia and New Zealand', 'An FSANZ application to vary the Food Standards Code, which food ministers may ask to review', 'Application A1269 was approved by the FSANZ Board in March 2025 and gazetted on 18 June 2025.'],
  ['a novel food in Great Britain', 'A risk assessment by the FSA or FSS, followed by a decision of ministers in England, Wales and Scotland', 'Since 1 April 2025 authorisations are published in an official register instead of a statutory instrument.'],
  ['a new fermentation-derived ingredient in the United States in September 2026', 'A GRAS conclusion, notified to the FDA voluntarily (or self-affirmed), or a food additive petition', 'Mandatory GRAS notification was only proposed on 11 August 2026.']
];
const REG_ALL = REG_CASES.map(c => c[1]).concat(['A qualified-majority vote of Member States in the PAFF Committee after an EFSA opinion']);
const SPS_CASES = [
  ['A food-safety measure conforms to a Codex standard. What follows under the SPS Agreement?', 'It is presumed consistent with the Agreement (Article 3.2)', 'Conformity with international standards gives a presumption of consistency.'],
  ['Relevant scientific evidence about a new food is insufficient. Which provision allows a provisional measure?', 'Article 5.7 — provisional measures, with a duty to seek more information and review', 'Precaution is allowed under conditions.'],
  ['A WTO Member bans a food without assessing its risks. Which obligation is most directly at stake?', 'Article 5.1 — measures must be based on a risk assessment', 'EC — Hormones (1998) turned on this obligation.'],
  ['A Member lets approval applications stall for years without decisions. Which obligation is at stake?', 'Article 8 and Annex C — approval procedures without undue delay', 'EC — Biotech Products (2006) found undue delay in the GMO moratorium.'],
  ['A country requires the label "cell-cultivated" on all cultivated meat. Which agreement governs the requirement?', 'The TBT Agreement — a technical regulation that must not be more trade-restrictive than necessary', 'Consumer information is not protection against a food-borne risk, so the SPS Agreement does not apply.']
];
const SPS_ALL = SPS_CASES.map(c => c[1]);
const TRL_DEF = ['Basic principles observed', 'Technology concept formulated', 'Experimental proof of concept', 'Technology validated in the laboratory', 'Technology validated in a relevant environment', 'Technology demonstrated in a relevant environment', 'System prototype demonstrated in an operational environment', 'System complete and qualified', 'Actual system proven in an operational environment'];
const MLP_CASES = [
  ['rules reserving meat names for products containing meat', 'Socio-technical regime'], ['national bans on cultivated meat', 'Socio-technical regime'], ['farm subsidies under the Common Agricultural Policy', 'Socio-technical regime'],
  ['supermarket supply chains for meat and dairy', 'Socio-technical regime'], ['climate change and emission-reduction targets', 'Socio-technical landscape'], ['the 2022 energy-price shock', 'Socio-technical landscape'],
  ['a rise in interest rates across the economy', 'Socio-technical landscape'], ['a start-up developing cultivated fat in a pilot bioreactor', 'Niche'], ['a university living lab testing insect-based snacks', 'Niche'], ['a subsidised pilot plant for precision fermentation', 'Niche']
];
const POLICY_CASES = [
  ['Horizon Europe research grants for alternative-protein science', 'Supply-push'], ['public funding of a shared fermentation pilot plant', 'Supply-push'], ['an R&D tax credit for food-tech firms', 'Supply-push'],
  ['public procurement of plant-rich meals for schools and hospitals', 'Demand-pull'], ['a lower VAT rate on plant-based protein foods', 'Demand-pull'], ['a tax on greenhouse-gas emissions from food production', 'Demand-pull'],
  ['a regulatory sandbox in which a food agency and firms develop guidance together', 'Systemic (institutions, networks, rules)'], ['an innovation community linking universities, start-ups and food companies', 'Systemic (institutions, networks, rules)']
];

export default [
  /* ======================= 14.1 EU novel food ======================= */
  {
    id: 'reg-nf-is-novel', title: 'Is it a novel food?', lesson: 'eu-novel-food', difficulty: 1,
    gen(rng) {
      const [prod, key, why] = pick(rng, NF_CASES);
      const correct = NF_OUT[key];
      return mcq(rng, `A company in Sweden wants to sell <b>${prod}</b>. What is its status under Regulation (EU) 2015/2283?`, correct, Object.values(NF_OUT).filter(o => o !== correct),
        steps('Check the scope: GM food, additives, enzymes, flavourings and extraction solvents have their own regimes (Article 2(2)).', 'Historical test: was the food eaten to a significant degree in the EU before 15 May 1997?', 'Categorical test: does it fall into one of the ten categories of Article 3(2)(a)? If novel, is it already on the Union list?', why));
    }
  },
  {
    id: 'reg-nf-procedure', title: 'Which EU procedure applies?', lesson: 'eu-novel-food', difficulty: 2,
    gen(rng) {
      const [sit, correct, why] = pick(rng, PROC_CASES);
      return mcq(rng, `${sit} What should it do?`, correct, others(rng, PROC_ALL, correct), steps(`Correct route: ${correct}.`, why));
    }
  },
  {
    id: 'reg-nf-clocks', title: 'Legal clocks of the novel food regulation', lesson: 'eu-novel-food', difficulty: 1,
    gen(rng) {
      const [what, correct, basis] = pick(rng, CLOCKS);
      return mcq(rng, `Under Regulation (EU) 2015/2283 and its implementing rules, what is ${what}?`, correct, others(rng, CLOCK_ALL, correct), steps(`${correct} — ${basis}`, 'Remember that EFSA\'s clocks are net times: requests for additional information stop them (Article 11(4)), whereas information sent on the applicant\'s own initiative does not (Article 11(6)).'));
    }
  },
  {
    id: 'reg-nf-active-time', title: 'EFSA active time with clock stops', lesson: 'eu-novel-food', difficulty: 2,
    gen(rng) {
      const n = randInt(rng, 2, 5);
      const stops = Array.from({ length: n }, () => randInt(rng, 30, 200));
      const S = stops.reduce((a, b) => a + b, 0);
      const act = randInt(rng, 220, 330);
      const E = act + S;
      return {
        q: `EFSA received a valid application on day 0 and adopted its opinion on day ${E}. It made ${n} requests for additional information, answered after ${stops.join(', ')} days. How many days of active (running-clock) assessment did EFSA use?`,
        answer: act, abstol: 0.5, unit: 'days',
        solution: steps(`Eq. 14.1.1 rearranged: \\(T_{\\text{act}} = (t_{\\text{opinion}} - t_{\\text{valid}}) - \\sum \\Delta_i\\).`, `\\(\\sum\\Delta_i = ${stops.join(' + ')} = ${S}\\) days.`, `\\(T_{\\text{act}} = ${E} - ${S} = ${act}\\) days \\(= ${f(act / 30.44, 3)}\\) months — ${act / 30.44 <= 9 ? 'within' : 'beyond'} the nine-month budget.`)
      };
    }
  },
  {
    id: 'reg-nf-total-duration', title: 'Expected duration of an Article 10 procedure', lesson: 'eu-novel-food', difficulty: 2,
    gen(rng) {
      const A = rand(rng, 60, 180, 5), B = rand(rng, 90, 250, 5), Tact = rand(rng, 220, 300, 5), n = randInt(rng, 0, 5), r = rand(rng, 60, 200, 5), D = rand(rng, 30, 70, 1), Tc = rand(rng, 4, 7, 0.5);
      const days = A + B + Tact + n * r + D + Tc * 30.44;
      return {
        q: `Estimate the time from submission to authorisation (Eq. 14.1.2): Commission validity check ${A} d, EFSA suitability check ${B} d, EFSA active time ${Tact} d, ${n} clock stop(s) of ${r} d each, publication lag ${D} d, and a Commission phase of ${Tc} months. Give the answer in years.`,
        answer: days / 365.25, tol: 0.02, unit: 'years',
        solution: steps(`Convert the Commission phase: \\(${Tc}\\times30.44 = ${f(Tc * 30.44, 4)}\\) d.`, `\\(W = ${A} + ${B} + ${Tact} + ${n}\\times${r} + ${D} + ${f(Tc * 30.44, 4)} = ${f(days, 4)}\\) d.`, `\\(${f(days, 4)}/365.25 = ${f(days / 365.25, 3)}\\) years. The 2018–2024 average was about 3.3 years (Le Bloch et al., 2025).`)
      };
    }
  },
  {
    id: 'reg-nf-data-protection', title: 'When does data protection expire?', lesson: 'eu-novel-food', difficulty: 1,
    gen(rng) {
      const d = randDate(rng, 2023, 2031);
      return {
        q: `A novel food is authorised with data protection by an implementing regulation that enters into force on ${fmtDate(d)}. In which year does the data protection end?`,
        answer: d.getUTCFullYear() + 5, abstol: 0.1, unit: '(year)',
        solution: steps('Article 26(1): proprietary data are protected for five years from the date of authorisation; protection cannot be renewed (Article 27(2)).', `End: ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear() + 5}.`)
      };
    }
  },
  {
    id: 'reg-nf-traditional', title: 'Expected duration of the traditional-food route', lesson: 'eu-novel-food', difficulty: 3,
    gen(rng) {
      const Tv = rand(rng, 1, 6, 0.5), p = rand(rng, 0.1, 0.7, 0.05), Tapp = rand(rng, 2, 8, 0.5), S = rand(rng, 0, 12, 0.5), Tvote = rand(rng, 1, 4, 0.5);
      const E = Tv + 1 + 4 + p * (Tapp + 6 + S + 3 + Tvote);
      return {
        q: `A traditional food from a third country is notified. The validity check takes ${Tv} months and forwarding the full 1 month. The probability that a reasoned safety objection is raised is ${p}. If so, preparing the Article 16 application takes ${Tapp} months, EFSA uses its 6 months plus ${S} months of clock stops, the Commission its 3 months, and the vote and adoption ${Tvote} months. What is the expected duration (Eq. 14.1.4)?`,
        answer: E, tol: 0.02, unit: 'months',
        solution: steps(`No-objection branch: \\(T_1 = ${Tv} + 1 + 4 = ${f(Tv + 5, 3)}\\) months.`, `Objection adds \\(${Tapp} + 6 + ${S} + 3 + ${Tvote} = ${f(Tapp + 9 + S + Tvote, 4)}\\) months.`, `\\(\\mathbb{E}[T] = ${f(Tv + 5, 3)} + ${p}\\times${f(Tapp + 9 + S + Tvote, 4)} = ${f(E, 4)}\\) months.`)
      };
    }
  },
  /* ======================= 14.2 GMOs, NGTs, organics, labels ======================= */
  {
    id: 'reg-gm-label', title: 'Does this ingredient need a GM label?', lesson: 'gmo-ngt-labelling', difficulty: 1,
    gen(rng) {
      const ing = pick(rng, ['soy flour', 'maize starch', 'textured soy protein', 'soybean oil']);
      const w = pick(rng, [0.2, 0.4, 0.7, 0.9, 1.1, 1.6, 3]);
      const adv = pick(rng, [true, true, false]);
      const need = w > 0.9 || !adv;
      const Y = 'Yes — the ingredient must be labelled "produced from genetically modified …"';
      const N = 'No — no GM label is required for this ingredient';
      return mcq(rng, `PCR shows that ${w} % of the <b>${ing}</b> in a ready meal is authorised GM material. The presence is ${adv ? 'adventitious and technically unavoidable (the supplier runs an identity-preserved chain)' : 'deliberate: the ingredient was bought as GM'}. Must the ingredient carry a GM label?`, need ? Y : N,
        [need ? N : Y, 'Only if GM DNA is detectable in the final food', 'Only if GM material exceeds 0.9 % of the whole product'],
        steps('Articles 12(2) and 24(2) of Regulation (EC) No 1829/2003: no label if the GM share is ≤ 0.9 % <em>of the ingredient considered individually</em> and the presence is adventitious or technically unavoidable.', `Here: share ${w} % ${w > 0.9 ? '> 0.9 %' : '≤ 0.9 %'}; presence ${adv ? 'adventitious' : 'deliberate'} → ${need ? 'label required' : 'no label'}.`, 'Labelling follows the process, not detectability: refined oil from GM soy is labelled even without detectable DNA.'));
    }
  },
  {
    id: 'reg-ngt-category', title: 'NGT1, NGT2, GMO or exempt?', lesson: 'gmo-ngt-labelling', difficulty: 2,
    gen(rng) {
      const [plant, key, why] = pick(rng, NGT_CASES);
      const correct = NGT_OUT[key];
      return mcq(rng, `Under Regulation (EU) 2026/1388 and the GMO legislation, how is <b>${plant}</b> regulated?`, correct, Object.values(NGT_OUT).filter(o => o !== correct), steps(why, 'NGT1 plants carry a seed label and database entry but no consumer GM label, and they may not be used in organic production.'));
    }
  },
  {
    id: 'reg-organic-soilless', title: 'Can it be certified organic in the EU?', lesson: 'gmo-ngt-labelling', difficulty: 1,
    gen(rng) {
      const C = [
        ['lettuce from a deep-water-culture hydroponic farm using an organic-approved nutrient solution', 'No — hydroponic production is prohibited in organic farming (Annex II, Part I, point 1.2 of Regulation (EU) 2018/848)'],
        ['vegetables from an aquaponic system with organic fish', 'No — hydroponic production is prohibited in organic farming (Annex II, Part I, point 1.2 of Regulation (EU) 2018/848)'],
        ['watercress grown with its roots in water', 'Yes — crops that naturally grow in water are exempt from the soil requirement'],
        ['tomatoes in Swedish demarcated beds certified as organic before 28 June 2017', 'Yes, until 31 December 2031 under the Nordic demarcated-bed derogation'],
        ['herbs grown in pots of organic growing medium and sold in the pot to consumers', 'Yes — plants sold in pots are a derogation from soil-related production']
      ];
      const [prod, correct] = pick(rng, C);
      const all = [...new Set(C.map(c => c[1]))].concat(['Yes — any production without synthetic pesticides can be organic']);
      return mcq(rng, `Can <b>${prod}</b> be sold as organic in the EU?`, correct, others(rng, all, correct), steps('EU organic plant production is soil-related (Annex II, Part I, point 1.1).', `Answer: ${correct}.`));
    }
  },
  {
    id: 'reg-label-protein-claim', title: 'Energy from protein and nutrition claims', lesson: 'gmo-ngt-labelling', difficulty: 2,
    gen(rng) {
      const P = rand(rng, 4, 30, 0.5), Fat = rand(rng, 1, 20, 0.5), CHO = rand(rng, 2, 50, 0.5), Fib = rand(rng, 0, 8, 0.5);
      const E = 17 * CHO + 17 * P + 37 * Fat + 8 * Fib, s = 100 * 17 * P / E;
      return {
        q: `Per 100 g a new food contains ${P} g protein, ${Fat} g fat, ${CHO} g carbohydrate and ${Fib} g fibre. What percentage of its energy comes from protein (Eqs. 14.2.3 and 14.2.5)?`,
        answer: s, tol: 0.02, unit: '%',
        solution: steps(`\\(E = 17\\times${CHO} + 17\\times${P} + 37\\times${Fat} + 8\\times${Fib} = ${f(E, 4)}\\) kJ per 100 g.`, `\\(s_{\\text{P}} = 17\\times${P}/${f(E, 4)} = ${f(s, 3)}\\,\\%\\).`, s >= 20 ? '≥ 20 %: "high protein" (and "source of protein") may be claimed.' : s >= 12 ? '≥ 12 % but < 20 %: "source of protein" may be claimed.' : '< 12 %: no protein claim is allowed.')
      };
    }
  },
  {
    id: 'reg-label-quid', title: 'QUID for a product that loses moisture', lesson: 'gmo-ngt-labelling', difficulty: 2,
    gen(rng) {
      const mi = randInt(rng, 5, 20), mtot = randInt(rng, 100, 150), mw = randInt(rng, 15, 45);
      const q = 100 * mi / (mtot - mw);
      return {
        q: `A bakery mixes ${mtot} kg of dough containing ${mi} kg of cricket powder, which is emphasised on the pack. Baking removes ${mw} kg of water. What QUID percentage must be declared (Eq. 14.2.4)?`,
        answer: q, tol: 0.02, unit: '%',
        solution: steps(`Finished product: \\(${mtot} - ${mw} = ${mtot - mw}\\) kg.`, `\\(\\text{QUID} = ${mi}/${mtot - mw}\\times100 = ${f(q, 3)}\\,\\%\\) (finished-product basis because the food lost moisture).`)
      };
    }
  },
  /* ======================= 14.3 Global regulation ======================= */
  {
    id: 'reg-glob-which-regulator', title: 'Who regulates it, and how?', lesson: 'global-regulation', difficulty: 1,
    gen(rng) {
      const [prod, correct, why] = pick(rng, REG_CASES);
      return mcq(rng, `Which route to market applies to <b>${prod}</b> (status 2026)?`, correct, others(rng, REG_ALL, correct), steps(why));
    }
  },
  {
    id: 'reg-glob-gras-clock', title: 'The GRAS review clock', lesson: 'global-regulation', difficulty: 1,
    gen(rng) {
      const pre = pick(rng, [true, false]), n = randInt(rng, 0, 2), rev = 180, ext = 90;
      const T = (pre ? 45 : 0) + rev + n * ext;
      return {
        q: `Under the FDA's August 2026 proposed GRAS rule, a notice ${pre ? 'goes through the full 45-day pre-filing evaluation and' : 'is filed immediately (ignore the pre-filing evaluation) and'} the FDA uses the 180-day review with ${n} extension(s) of 90 days. How many days does the FDA take to respond (Eq. 14.3.1)?`,
        answer: T, abstol: 0.5, unit: 'days',
        solution: steps(`\\(T = ${pre ? 45 : 0} + ${rev} + ${n}\\times${ext} = ${T}\\) days \\(= ${f(T / 30.44, 3)}\\) months.`, 'The 2016 rule allowed one extension (270 days after filing at most); the proposal adds a pre-filing step and a second extension.')
      };
    }
  },
  {
    id: 'reg-glob-months', title: 'Months from application to authorisation', lesson: 'global-regulation', difficulty: 1,
    gen(rng) {
      const d0 = randDate(rng, 2019, 2024), dur = randInt(rng, 300, 1600), d1 = addDays(d0, dur);
      return {
        q: `A company applied to a food regulator on ${fmtDate(d0)} and its product was authorised on ${fmtDate(d1)}. How many months did the procedure take? (Use 30.44 days per month.)`,
        answer: dur / 30.44, abstol: 0.3, unit: 'months',
        solution: steps(`Days elapsed: ${dur}.`, `\\(${dur}/30.44 = ${f(dur / 30.44, 3)}\\) months \\(= ${f(dur / 365.25, 3)}\\) years. Compare: FSANZ A1269 took about 28 months, Aleph Farms in Singapore about 46 months.`)
      };
    }
  },
  {
    id: 'reg-glob-italy-fine', title: 'Maximum fine under Italy\'s Law 172/2023', lesson: 'global-regulation', difficulty: 1,
    gen(rng) {
      const R = pick(rng, [150000, 300000, 450000, 800000, 950000, 1200000, 1400000, 3000000, 25000000]);
      const F = Math.min(150000, Math.max(60000, 0.1 * R));
      return {
        q: `A food business with an annual turnover of €${R.toLocaleString('en-GB')} breaches the Italian ban on cultivated meat. What is the maximum administrative fine under Article 5 (Eq. 14.3.2)?`,
        answer: F, tol: 0.005, unit: 'EUR',
        solution: steps(`10 % of turnover: \\(0.10\\times${R} = ${0.1 * R}\\) EUR.`, `\\(F_{\\max} = \\min(150\\,000,\\ \\max(60\\,000,\\ ${0.1 * R})) = ${F}\\) EUR = ${f(100 * F / R, 3)} % of turnover.`, 'Confiscation, exclusion from public funding for 1–3 years and closure of the plant come on top.')
      };
    }
  },
  {
    id: 'reg-glob-launch-value', title: 'Expected value of filing in a jurisdiction', lesson: 'global-regulation', difficulty: 3,
    gen(rng) {
      const p = rand(rng, 0.4, 0.95, 0.05), pi = rand(rng, 2, 30, 1), r = rand(rng, 0.05, 0.15, 0.01), T = rand(rng, 1, 6, 0.5), L = randInt(rng, 5, 15), C = rand(rng, 1, 8, 0.5);
      const pv = (pi / r) * Math.exp(-r * T) * (1 - Math.exp(-r * L)), V = p * pv - C;
      return {
        q: `A firm expects approval with probability ${p} after ${T} years, then an annual margin of ${pi} M€ for ${L} years. With a discount rate of ${r} per year and a dossier cost of ${C} M€, what is the expected value of filing (Eq. 14.3.3)?`,
        answer: V, abstol: Math.max(0.05, Math.abs(V) * 0.02), unit: 'M€',
        solution: steps(`\\(\\pi/r = ${pi}/${r} = ${f(pi / r, 4)}\\) M€.`, `\\(e^{-rT} = e^{-${f(r * T, 3)}} = ${f(Math.exp(-r * T), 4)}\\); \\(1 - e^{-rL} = ${f(1 - Math.exp(-r * L), 4)}\\).`, `Present value if approved: \\(${f(pv, 4)}\\) M€; \\(\\mathbb{E}[V] = ${p}\\times${f(pv, 4)} - ${C} = ${f(V, 4)}\\) M€.`)
      };
    }
  },
  {
    id: 'reg-glob-divergence', title: 'The cost of divergent requirements', lesson: 'global-regulation', difficulty: 2,
    gen(rng) {
      const C1 = rand(rng, 1, 8, 0.5), N = randInt(rng, 2, 7), s = rand(rng, 0.2, 0.9, 0.05);
      const CN = C1 * (1 + (N - 1) * (1 - s));
      return {
        q: `A first complete novel-food dossier costs ${C1} M€. The company wants authorisation in ${N} jurisdictions, and ${Math.round(100 * s)} % of a dossier can be reused elsewhere. What is the total dossier cost (Eq. 14.3.4)?`,
        answer: CN, tol: 0.01, unit: 'M€',
        solution: steps(`\\(C_N = C_1[1 + (N-1)(1-s)] = ${C1}\\times[1 + ${N - 1}\\times${f(1 - s, 3)}] = ${f(CN, 4)}\\) M€.`, `Full mutual recognition (s = 1) would cost ${C1} M€; no reuse (s = 0) ${f(N * C1, 4)} M€.`)
      };
    }
  },
  {
    id: 'reg-glob-sps', title: 'SPS and TBT in a nutshell', lesson: 'global-regulation', difficulty: 2,
    gen(rng) {
      const [q, correct, why] = pick(rng, SPS_CASES);
      return mcq(rng, q, correct, others(rng, SPS_ALL, correct), steps(why));
    }
  },
  /* ======================= 14.4 Innovation pathways ======================= */
  {
    id: 'reg-inn-trl-definition', title: 'Which TRL is this?', lesson: 'innovation-pathways', difficulty: 1,
    gen(rng) {
      const k = randInt(rng, 1, 9);
      const opts = shuffle(rng, [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(x => x !== k)).slice(0, 3);
      return mcq(rng, `Which technology readiness level corresponds to the EU definition "<b>${TRL_DEF[k - 1]}</b>"?`, `TRL ${k}`, opts.map(x => `TRL ${x}`), steps(`TRL ${k}: ${TRL_DEF[k - 1]}.`, 'Validation (TRL 4–5) comes before demonstration (TRL 6–7); TRL 8 is a complete and qualified system, TRL 9 proven operation.'));
    }
  },
  {
    id: 'reg-inn-gated-trl', title: 'Gated TRL from evidence', lesson: 'innovation-pathways', difficulty: 1,
    gen(rng) {
      const gap = randInt(rng, 3, 8);
      const ev = []; for (let l = 1; l <= 9; l++) if (l !== gap && (l < gap || rng() < 0.6)) ev.push(l);
      if (!ev.some(l => l > gap)) ev.push(gap + 1);
      ev.sort((a, b) => a - b);
      return {
        q: `A food-tech company has documented evidence for TRL ${ev.join(', ')}. What is its gated TRL (Eq. 14.4.1)?`,
        answer: gap - 1, abstol: 0.1, unit: '',
        solution: steps(`Evidence is continuous from TRL 1 to TRL ${gap - 1}; TRL ${gap} is missing.`, `Gated TRL = ${gap - 1}: later evidence (TRL ${ev.filter(l => l > gap).join(', ')}) does not count until the gap is closed.`)
      };
    }
  },
  {
    id: 'reg-inn-pipeline', title: 'Capital per successful product', lesson: 'innovation-pathways', difficulty: 3,
    gen(rng) {
      const C = [rand(rng, 1, 4, 0.5), rand(rng, 5, 20, 1), rand(rng, 20, 60, 5), rand(rng, 50, 200, 10)];
      const p = [rand(rng, 0.3, 0.8, 0.05), rand(rng, 0.3, 0.8, 0.05), rand(rng, 0.4, 0.9, 0.05), rand(rng, 0.5, 0.9, 0.05)];
      let P = 1, EC = 0; const terms = [];
      C.forEach((c, i) => { EC += c * P; terms.push(`${f(P, 3)}\\times${c}`); P *= p[i]; });
      return {
        q: `A four-stage pipeline has stage costs ${C.join(', ')} M€ and stage success probabilities ${p.join(', ')}. What is the expected capital per successful product (Eq. 14.4.2)?`,
        answer: EC / P, tol: 0.02, unit: 'M€',
        solution: steps(`\\(P_{\\text{s}} = ${p.join('\\times')} = ${f(P, 4)}\\).`, `\\(\\mathbb{E}[C] = ${terms.join(' + ')} = ${f(EC, 4)}\\) M€ (each cost weighted by the probability of reaching its stage).`, `\\(C_{\\text{per success}} = ${f(EC, 4)}/${f(P, 4)} = ${f(EC / P, 4)}\\) M€.`)
      };
    }
  },
  {
    id: 'reg-inn-rogers', title: 'Rogers\' adopter categories in calendar time', lesson: 'innovation-pathways', difficulty: 1,
    gen(rng) {
      const mu = randInt(rng, 2030, 2050), sd = randInt(rng, 2, 8);
      const Q = pick(rng, [['the early adopters begin to adopt', mu - 2 * sd, 'μ − 2σ'], ['the early majority begins to adopt (Moore\'s chasm)', mu - sd, 'μ − σ'], ['the late majority begins to adopt', mu, 'μ'], ['the laggards begin to adopt', mu + sd, 'μ + σ']]);
      return {
        q: `Adoption times of a new food are normally distributed with mean ${mu} and standard deviation ${sd} years. In which year do ${Q[0]}?`,
        answer: Q[1], abstol: 0.1, unit: '(year)',
        solution: steps(`Rogers' category boundaries: μ − 2σ, μ − σ, μ, μ + σ.`, `${Q[2]} = ${Q[1]}.`, 'Shares: innovators 2.5 %, early adopters 13.5 %, early majority 34 %, late majority 34 %, laggards 16 %.')
      };
    }
  },
  {
    id: 'reg-inn-bass-F', title: 'Bass model: adoption after t years', lesson: 'innovation-pathways', difficulty: 2,
    gen(rng) {
      const p = pick(rng, [0.005, 0.01, 0.02, 0.03, 0.05]), q = rand(rng, 0.2, 0.6, 0.05), t = randInt(rng, 2, 15);
      const Fv = bassF(t, p, q), x = Math.exp(-(p + q) * t);
      return {
        q: `A new food diffuses according to the Bass model with p = ${p} a⁻¹ and q = ${q} a⁻¹. What percentage of the market potential has adopted ${t} years after launch?`,
        answer: 100 * Fv, tol: 0.02, unit: '%',
        solution: steps(`\\(p + q = ${f(p + q, 3)}\\), \\(q/p = ${f(q / p, 4)}\\), \\(e^{-(p+q)t} = e^{-${f((p + q) * t, 4)}} = ${f(x, 4)}\\).`, `\\(F(${t}) = \\dfrac{1 - ${f(x, 4)}}{1 + ${f(q / p, 4)}\\times${f(x, 4)}} = ${f(Fv, 4)}\\) → ${f(100 * Fv, 3)} %.`)
      };
    }
  },
  {
    id: 'reg-inn-bass-peak', title: 'Bass model: when is the peak?', lesson: 'innovation-pathways', difficulty: 2,
    gen(rng) {
      const p = pick(rng, [0.005, 0.01, 0.02, 0.03, 0.04]), q = rand(rng, 0.15, 0.7, 0.05);
      const ts = Math.log(q / p) / (p + q);
      return {
        q: `For a Bass model with p = ${p} a⁻¹ and q = ${q} a⁻¹, how many years after launch does the adoption rate peak?`,
        answer: ts, tol: 0.02, unit: 'years',
        solution: steps(`\\(t^* = \\ln(q/p)/(p+q) = \\ln(${f(q / p, 4)})/${f(p + q, 3)} = ${f(Math.log(q / p), 4)}/${f(p + q, 3)} = ${f(ts, 4)}\\) years.`, `At the peak \\(F = 1/2 - p/(2q) = ${f(0.5 - p / (2 * q), 3)}\\) of the market has adopted.`)
      };
    }
  },
  {
    id: 'reg-inn-bass-share', title: 'Bass model: time to a market share', lesson: 'innovation-pathways', difficulty: 3,
    gen(rng) {
      const p = pick(rng, [0.01, 0.02, 0.03]), q = rand(rng, 0.2, 0.6, 0.05), s = pick(rng, [0.16, 0.25, 0.5, 0.75, 0.9]);
      const t = Math.log((1 + (q / p) * s) / (1 - s)) / (p + q);
      return {
        q: `With p = ${p} a⁻¹ and q = ${q} a⁻¹, how many years after launch does adoption reach ${Math.round(100 * s)} % of the market potential (Eq. 14.4.6)?`,
        answer: t, tol: 0.02, unit: 'years',
        solution: steps(`\\(t_s = \\dfrac{1}{p+q}\\ln\\dfrac{1 + (q/p)s}{1-s} = \\dfrac{1}{${f(p + q, 3)}}\\ln\\dfrac{1 + ${f(q / p, 4)}\\times${s}}{${f(1 - s, 3)}}\\).`, `\\(= ${f(Math.log((1 + (q / p) * s) / (1 - s)), 4)}/${f(p + q, 3)} = ${f(t, 4)}\\) years.`)
      };
    }
  },
  {
    id: 'reg-inn-fisher-pry', title: 'Fisher–Pry takeover time', lesson: 'innovation-pathways', difficulty: 2,
    gen(rng) {
      const mode = pick(rng, ['time', 'rate']);
      if (mode === 'time') {
        const b = rand(rng, 0.05, 0.5, 0.01);
        return { q: `A new product substitutes an old one according to Fisher–Pry with b = ${b} a⁻¹. How long does it take to go from 10 % to 90 % market share?`, answer: Math.log(81) / b, tol: 0.02, unit: 'years', solution: steps(`\\(\\Delta t_{10\\to90} = \\ln 81/b = 4.394/${b} = ${f(Math.log(81) / b, 4)}\\) years.`) };
      }
      const dt = randInt(rng, 8, 40);
      return { q: `Market data show that a plant-based product went from 10 % to 90 % share of its category in ${dt} years. Assuming Fisher–Pry substitution, what is the rate constant b?`, answer: Math.log(81) / dt, tol: 0.02, unit: 'a⁻¹', solution: steps(`\\(b = \\ln 81/\\Delta t = 4.394/${dt} = ${f(Math.log(81) / dt, 4)}\\) a⁻¹.`) };
    }
  },
  {
    id: 'reg-inn-wright', title: 'Experience curves (Wright\'s law)', lesson: 'innovation-pathways', difficulty: 2,
    gen(rng) {
      const LR = rand(rng, 0.1, 0.3, 0.01);
      if (rng() < 0.5) {
        const C0 = randInt(rng, 20, 120), n = randInt(rng, 2, 6), C = C0 * Math.pow(1 - LR, n);
        return { q: `A new protein costs €${C0} kg⁻¹. With a learning rate of ${Math.round(100 * LR)} %, what does it cost after cumulative production has grown ${2 ** n}-fold?`, answer: C, tol: 0.02, unit: '€ kg⁻¹', solution: steps(`${2 ** n}-fold growth is ${n} doublings.`, `\\(C = ${C0}\\times(1 - ${LR})^{${n}} = ${f(C, 4)}\\) € kg⁻¹.`) };
      }
      const ratio = pick(rng, [2, 3, 4, 5, 8]), n = Math.log(1 / ratio) / Math.log(1 - LR);
      return { q: `A new food costs ${ratio} times as much as the product it replaces. With a learning rate of ${Math.round(100 * LR)} %, how many doublings of cumulative production are needed to reach cost parity?`, answer: n, tol: 0.02, unit: 'doublings', solution: steps(`\\(n = \\ln(1/${ratio})/\\ln(1 - ${LR}) = ${f(Math.log(1 / ratio), 4)}/${f(Math.log(1 - LR), 4)} = ${f(n, 4)}\\).`, `Cumulative production must grow by \\(2^{n} \\approx ${f(2 ** n, 3)}\\) times.`) };
    }
  },
  {
    id: 'reg-inn-mlp', title: 'Niche, regime or landscape?', lesson: 'innovation-pathways', difficulty: 1,
    gen(rng) {
      const [el, correct] = pick(rng, MLP_CASES);
      return mcq(rng, `In the multi-level perspective, to which level does <b>${el}</b> belong?`, correct, ['Socio-technical regime', 'Socio-technical landscape', 'Niche', 'None of these levels'].filter(o => o !== correct),
        steps('Niches: protected spaces for radical innovation. Regime: the aligned technologies, industries, markets, practices, rules and meanings. Landscape: trends and shocks outside the regime actors\' direct influence.', `Answer: ${correct}.`));
    }
  },
  {
    id: 'reg-inn-policy-type', title: 'Supply-push, demand-pull or systemic?', lesson: 'innovation-pathways', difficulty: 2,
    gen(rng) {
      const [inst, correct] = pick(rng, POLICY_CASES);
      return mcq(rng, `How would you classify <b>${inst}</b> as a policy instrument?`, correct, ['Supply-push', 'Demand-pull', 'Systemic (institutions, networks, rules)', 'Not an innovation policy instrument'].filter(o => o !== correct),
        steps('Supply-push lowers the cost of producing innovations; demand-pull creates or enlarges markets; systemic instruments build the networks, rules and capabilities that connect both.', `Answer: ${correct}.`));
    }
  }
];
