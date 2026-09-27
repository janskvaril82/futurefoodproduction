/* Novel food navigator — Regulation (EU) 2015/2283 as an executable decision tree.
   Decision rules N1–N6 (Derive tab); indicative timelines from the stochastic procedure model shared with
   /laboratories/authorisation-timeline/ (model.js). Case outcomes verified against EUR-Lex, the Union list and the
   Commission's list of consultation outcomes (as of September 2026). */
import { Controls, Readouts, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, BarChart } from '/assets/js/plot.js';
import { runMany, quantiles, MONTH } from '/laboratories/authorisation-timeline/model.js';

const $ = s => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ELI = {
  reg: 'https://eur-lex.europa.eu/eli/reg/2015/2283/oj', ir2469: 'https://eur-lex.europa.eu/eli/reg_impl/2017/2469/oj', ir2468: 'https://eur-lex.europa.eu/eli/reg_impl/2017/2468/oj',
  ir2470: 'https://eur-lex.europa.eu/eli/reg_impl/2017/2470/oj', ir456: 'https://eur-lex.europa.eu/eli/reg_impl/2018/456/oj', gmo: 'https://eur-lex.europa.eu/eli/reg/2003/1829/oj',
  fic: 'https://eur-lex.europa.eu/eli/reg/2011/1169/oj', gfl: 'https://eur-lex.europa.eu/eli/reg/2002/178/oj', add: 'https://eur-lex.europa.eu/eli/reg/2008/1333/oj',
  enz: 'https://eur-lex.europa.eu/eli/reg/2008/1332/oj', flav: 'https://eur-lex.europa.eu/eli/reg/2008/1334/oj', solv: 'https://eur-lex.europa.eu/eli/dir/2009/32/oj',
  common: 'https://eur-lex.europa.eu/eli/reg/2008/1331/oj', transp: 'https://eur-lex.europa.eu/eli/reg/2019/1381/oj',
  efsa: 'https://doi.org/10.2903/j.efsa.2024.8961', efsaTF: 'https://doi.org/10.2903/j.efsa.2024.8966',
  consult: 'https://food.ec.europa.eu/food-safety/novel-food/consultation-process-novel-food-status_en',
  union: 'https://food.ec.europa.eu/food-safety/novel-food/authorisations/union-list-novel-foods_en',
  summaries: 'https://food.ec.europa.eu/food-safety/novel-food/authorisations/summary-applications-and-notifications_en',
  cmo: 'https://eur-lex.europa.eu/eli/reg/2026/1739/oj'
};
const celex = c => `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${c}`;
const A = (href, txt) => `<a href="${href}" target="_blank" rel="noopener">${txt}</a>`;

const CATS = {
  i: '(i) new or intentionally modified molecular structure', ii: '(ii) micro-organisms, fungi or algae', iii: '(iii) material of mineral origin',
  iv: '(iv) plants or their parts', v: '(v) animals or their parts (incl. insects)', vi: '(vi) cell or tissue culture', vii: '(vii) new production process with significant change',
  viii: '(viii) engineered nanomaterials', ix: '(ix) vitamins, minerals from a new process or nano', x: '(x) used only in food supplements before 1997'
};
const TF_EXCLUDED = ['i', 'iii', 'vii', 'viii', 'ix', 'x'];
const OTHER_REGIME = {
  gmo: ['GM food: Regulation (EC) No 1829/2003', ELI.gmo, 'EFSA GMO Panel assessment, authorisation for ten years (renewable), GM labelling and traceability (Reg. 1830/2003).'],
  enzyme: ['Food enzyme: Regulation (EC) No 1332/2008', ELI.enz, 'Common authorisation procedure of Regulation (EC) No 1331/2008; Union list of food enzymes.'],
  additive: ['Food additive: Regulation (EC) No 1333/2008', ELI.add, 'Common authorisation procedure of Regulation (EC) No 1331/2008; Union list of additives with E-numbers.'],
  flavouring: ['Flavouring: Regulation (EC) No 1334/2008', ELI.flav, 'Common authorisation procedure of Regulation (EC) No 1331/2008; Union list of flavouring substances.'],
  solvent: ['Extraction solvent: Directive 2009/32/EC', ELI.solv, 'Only solvents listed in the Annex of the Directive may be used, within the conditions stated there.']
};

/* ============================================================ case library (verified outcomes, as of Sept 2026) */
const CASES = [
  { id: 'lettuce', title: 'Butterhead lettuce from a vertical farm', tag: 'Plant · CEA', teaser: 'Grown hydroponically under LEDs in a stacked indoor farm; nothing is added and the composition is within the normal range for lettuce.', ans: 'notnovel',
    s: { gm: 'no', use: 'food', hist: 'yes', proc: false, sig: false, cat: 'iv', listed: 'no', pp: true, h25: false },
    v: `Lettuce was eaten to a significant degree in the EU before 15 May 1997, and soilless cultivation under LEDs is not a production process that causes significant changes in composition or structure (Art. 3(2)(a)(vii)). <b>Not novel</b>: general food law, contaminant limits (e.g., nitrate) and labelling apply. A real precedent: the Commission's list of consultation outcomes records <em>tubers of Cyperus esculentus (hydroponic culture)</em> — tiger nuts grown hydroponically — as not novel (published 3 November 2020).`,
    src: [[ELI.consult, 'Commission: consultation outcomes']] },
  { id: 'uvmilk', title: 'UV-treated skimmed milk', tag: 'Animal · new process', teaser: 'Skimmed milk briefly exposed to UV light, which raises its vitamin D₃ content to less than 0.375 µg per 100 g.', ans: 'notnovel',
    s: { gm: 'no', use: 'food', hist: 'yes', proc: true, sig: false, cat: 'vii', listed: 'no' },
    v: `The process is new, but a Member State consultation concluded that this milk is <b>not novel</b> (Commission list of consultation outcomes, 13 June 2024): the change in composition is not "significant" in the sense of category (vii). Compare UV-treated mushrooms (up to 10 µg vitamin D₂ per 100 g, novel) and UV-treated wine: up to 3 kJ L⁻¹ not novel, up to 6 kJ L⁻¹ novel under category (vii). The threshold is judged case by case.`,
    src: [[ELI.consult, 'Commission: consultation outcomes']] },
  { id: 'uvmush', title: 'UV-treated button mushrooms', tag: 'Fungi · new process', teaser: '<em>Agaricus bisporus</em> exposed to UV-B light after harvest so that 100 g contain up to 10 µg vitamin D₂.', ans: 'listed',
    s: { gm: 'no', use: 'food', hist: 'yes', proc: true, sig: true, cat: 'vii', listed: 'yes' },
    v: `Mushrooms have a long history of consumption, but UV treatment is a new process that significantly raises vitamin D₂: <b>novel, category (vii)</b>. A Swedish company's request of 10 June 2016 led to Commission Implementing Decision (EU) 2017/2355 of 14 December 2017. The Union list entry allows at most 10 µg vitamin D₂ per 100 g fresh weight under the name "UV-treated mushrooms (<em>Agaricus bisporus</em>)". Because authorisations are generic, anyone may market it within the specification.`,
    src: [['https://eur-lex.europa.eu/eli/dec_impl/2017/2355/oj', 'Implementing Decision (EU) 2017/2355']] },
  { id: 'uvyeast', title: "UV-treated baker's yeast", tag: 'Micro-organism · new process', teaser: "Baker's yeast (<em>Saccharomyces cerevisiae</em>) treated with UV light so that it contains vitamin D₂.", ans: 'listed',
    s: { gm: 'no', use: 'food', hist: 'yes', proc: true, sig: true, cat: 'vii', listed: 'yes' },
    v: `Baker's yeast was eaten before 1997, but the UV treatment is a new process that significantly raises vitamin D₂: <b>novel, category (vii)</b>. It was authorised under the old Regulation (EC) No 258/97 by Commission Implementing Decision 2014/396/EU of 24 June 2014 (applicant Lallemand SAS) and carried over into the Union list in 2018.`,
    src: [[celex('32014D0396'), 'Implementing Decision 2014/396/EU']] },
  { id: 'chia', title: 'Chia seeds', tag: 'Plant', teaser: 'Seeds of <em>Salvia hispanica</em>, for bread, breakfast cereals and as pre-packed seeds.', ans: 'listed',
    s: { gm: 'no', use: 'food', hist: 'no', proc: false, sig: false, cat: 'iv', listed: 'yes', pp: true, h25: true },
    v: `Not consumed to a significant degree in the EU before 1997: <b>novel, category (iv)</b>. The first request (United Kingdom, 30 June 2003) ended with Commission Decision 2009/827/EC of 13 October 2009, allowing up to 5 % in bread — more than six years later. Many extensions followed; pre-packed seeds must be labelled with a maximum daily intake of 15 g, and partially defatted chia seed powders were added in 2023 (IR (EU) 2023/2214). Today: market within the Union-list conditions.`,
    src: [['https://eur-lex.europa.eu/eli/dec/2009/827/oj', 'Decision 2009/827/EC'], [ELI.union, 'Union list']] },
  { id: 'mealworm', title: 'Dried yellow mealworm', tag: 'Insect', teaser: 'Whole dried <em>Tenebrio molitor</em> larvae, sold as a snack and as an ingredient in protein products, biscuits and pasta.', ans: 'listed',
    s: { gm: 'no', use: 'food', hist: 'no', proc: false, sig: false, cat: 'v', listed: 'yes', pp: true, h25: false },
    v: `Insects are <b>category (v)</b>. SAS EAP Group applied on 13 February 2018; Implementing Regulation (EU) 2021/882 of 1 June 2021 authorised the food (in the Union list from 22 June 2021) with five-year data protection, which <b>ended on 22 June 2026</b>: since then any operator may market dried <em>T. molitor</em> larva within the specification. Labels must use the designation "Dried Tenebrio molitor larva (yellow mealworm)" and warn consumers allergic to crustaceans and dust mites.`,
    src: [[celex('32021R0882'), 'Implementing Regulation (EU) 2021/882']] },
  { id: 'cricket', title: 'Partially defatted house-cricket powder', tag: 'Insect', teaser: 'Powder of whole <em>Acheta domesticus</em> with part of the fat removed, for multigrain bread, crackers, cereal bars and pasta.', ans: 'listed',
    s: { gm: 'no', use: 'food', hist: 'no', proc: false, sig: false, cat: 'v', listed: 'dp', pp: true, h25: false },
    v: `On the Union list since Implementing Regulation (EU) 2023/5 (<b>category (v)</b>, authorised 24 January 2023) — but with <b>data protection</b>: until 24 January 2028 only Cricket One Co. Ltd may place it on the market, unless a competitor obtains its own authorisation without referring to the protected data or with Cricket One's agreement (Art. 27). Labels: "Acheta domesticus (house cricket) partially defatted powder" and a statement on allergies to crustaceans, molluscs and dust mites.`,
    src: [[celex('32023R0005'), 'Implementing Regulation (EU) 2023/5']] },
  { id: 'cbd', title: 'CBD isolate in food supplements', tag: 'Plant extract', teaser: 'Cannabidiol of more than 98 % purity extracted from hemp, sold in capsules.', ans: 'art10',
    s: { gm: 'no', use: 'food', hist: 'no', proc: false, sig: false, cat: 'iv', listed: 'no', pp: false, h25: false },
    v: `The Commission's list of consultation outcomes classifies CBD isolate (purity &gt; 98 %) and CBD extracts as <b>novel, category (iv)</b> (e.g., outcomes of 9 December 2019 and 31 January 2024). Applications were submitted, but in June 2022 EFSA concluded that safety could not be established because of data gaps, and the assessments were put on hold; in February 2026 EFSA set a provisional safe intake of 0.0275 mg per kg body weight per day for CBD of ≥ 98 % purity in supplements. As of September 2026 no CBD novel food is on the Union list: an <b>Article 10 application</b> is the only route.`,
    src: [[ELI.consult, 'Commission: consultation outcomes'], ['https://doi.org/10.2903/j.efsa.2022.7322', 'EFSA (2022)'], ['https://doi.org/10.2903/j.efsa.2026.9862', 'EFSA (2026)']] },
  { id: 'duck', title: 'Cultivated duck cells', tag: 'Cell culture', teaser: 'Cells from a duck cell line grown in bioreactors, used in a foie-gras-style product.', ans: 'art10',
    s: { gm: 'no', use: 'food', hist: 'no', proc: false, sig: false, cat: 'vi', listed: 'no', pp: false, h25: false },
    v: `Food from cell culture derived from animals is <b>category (vi)</b>. Suprême SAS (Gourmey) submitted the first EU application for a cultivated-meat product in July 2024; it was still pending in September 2026 — no cultivated meat is on the Union list. Even after authorisation, Regulation (EU) 2026/1739 reserves meat terms such as "duck" for products containing meat and excludes food from cell or tissue culture, and Italy prohibits cultivated meat (Law No 172/2023). Singapore approved the same company's cultured duck cells on 10 April 2026.`,
    src: [[ELI.summaries, 'Commission: application summaries'], [ELI.cmo, 'Regulation (EU) 2026/1739']] },
  { id: 'rblg', title: 'Precision-fermented β-lactoglobulin', tag: 'Precision fermentation', teaser: 'The whey protein β-lactoglobulin produced by fermentation with a genetically modified yeast (<em>Komagataella phaffii</em>); the yeast is removed from the final ingredient.', ans: 'art10',
    s: { gm: 'with', use: 'food', hist: 'no', proc: false, sig: false, cat: 'ii', listed: 'no', pp: false, h25: false },
    v: `Produced <em>with</em>, not <em>from</em>, a GMO: if no GM material remains, Regulation (EC) No 1829/2003 does not apply — but the protein is <b>novel</b>, a food produced from a micro-organism (category (ii)). An application (2023-19996) appears among the Commission's 2023 application summaries; the food was not on the Union list in September 2026. The same protein isolated from cow's-milk whey needed its own authorisation: bovine milk β-lactoglobulin, Implementing Regulation (EU) 2022/2534 (Arla Foods Ingredients, with five-year data protection).`,
    src: [[ELI.summaries, 'Commission: application summaries'], [celex('32022R2534'), 'Implementing Regulation (EU) 2022/2534']] },
  { id: 'rapeseed', title: 'Rapeseed protein', tag: 'Plant protein', teaser: 'An aqueous, protein-rich extract from rapeseed, used as a vegetable-protein ingredient.', ans: 'listed',
    s: { gm: 'no', use: 'food', hist: 'no', proc: false, sig: false, cat: 'iv', listed: 'yes', pp: false, h25: false },
    v: `<b>Novel, category (iv)</b>. Authorised under Regulation 258/97: Helm AG applied to the Irish authorities on 25 June 2012; objections led to an EFSA opinion (10 October 2013) and to Commission Implementing Decision 2014/424/EU of 1 July 2014. Labels must state that the product may cause allergic reactions in consumers allergic to mustard. (Partially) defatted rapeseed powders have separate entries (2025–2026).`,
    src: [[celex('32014D0424'), 'Implementing Decision 2014/424/EU']] },
  { id: 'schizo', title: 'DHA-rich oil from Schizochytrium', tag: 'Microalga', teaser: 'Oil rich in docosahexaenoic acid (DHA) extracted from the marine microalga <em>Schizochytrium</em> sp., used as an omega-3 ingredient.', ans: 'listed',
    s: { gm: 'no', use: 'food', hist: 'no', proc: false, sig: false, cat: 'ii', listed: 'yes', pp: false, h25: false },
    v: `Food from algae: <b>category (ii)</b>. The first DHA-rich <em>Schizochytrium</em> oil was authorised by Commission Decision 2003/427/EC of 5 June 2003; oils from other strains have their own Union-list entries and specifications (e.g., IR (EU) 2024/2049, 2024/2101 and 2025/1515). An oil from a new strain with a different specification needs an application to update the Union list (Art. 10).`,
    src: [[celex('32003D0427'), 'Decision 2003/427/EC'], [ELI.union, 'Union list']] },
  { id: 'baobab', title: 'Baobab dried fruit pulp', tag: 'Plant · traditional', teaser: 'Milled pulp of the fruit of <em>Adansonia digitata</em>, eaten for generations in sub-Saharan Africa, for smoothies and cereal bars.', ans: 'listed',
    s: { gm: 'no', use: 'food', hist: 'no', proc: false, sig: false, cat: 'iv', listed: 'yes', pp: true, h25: true },
    v: `Many expect the traditional-food route — but it only exists since 2018. PhytoTrade Africa asked the UK authorities on 9 August 2006; the UK's initial assessment (12 July 2007) found the pulp safe, other Member States raised objections that did not concern safety, and Commission Decision 2008/575/EC of 27 June 2008 authorised it under Regulation 258/97. It is <b>on the Union list</b>: market it within the specification — no new procedure.`,
    src: [[celex('32008D0575'), 'Decision 2008/575/EC']] },
  { id: 'wolffia', title: 'Fresh water-lentil plants (Wolffia)', tag: 'Plant · CEA · traditional', teaser: 'Fresh plants of <em>Wolffia arrhiza</em> and <em>W. globosa</em> grown in a vertical farm and eaten as a vegetable; eaten for generations outside Europe.', ans: 'tf',
    s: { gm: 'no', use: 'food', hist: 'no', proc: false, sig: false, cat: 'iv', listed: 'no', pp: true, h25: true, choice: 'notify' },
    v: `<b>Traditional food from a third country.</b> GreenOnyx Ltd notified on 7 September 2020; the Commission forwarded the valid notification on 20 January 2021; EFSA's technical report (30 June 2021) found no safety concerns for plants "cultivated under the conditions of vertical farming as described in the notification"; Implementing Regulation (EU) 2021/2191 of 10 December 2021 authorised them — with maximum levels for heavy metals, trace elements from fertilisers (copper, molybdenum, zinc, boron, manganese) and microcystins. Contrast: <em>Lemna minor</em> and <em>L. gibba</em> plants went through a full Article 10 application (IR (EU) 2025/153).`,
    src: [[celex('32021R2191'), 'Implementing Regulation (EU) 2021/2191'], [celex('32025R0153'), 'Implementing Regulation (EU) 2025/153']] },
  { id: 'coffee', title: 'Infusion from coffee leaves', tag: 'Plant · traditional', teaser: 'A tea-like infusion made from the dried leaves of <em>Coffea arabica</em> and/or <em>C. canephora</em>.', ans: 'tf',
    s: { gm: 'no', use: 'food', hist: 'no', proc: false, sig: false, cat: 'iv', listed: 'no', pp: true, h25: true, choice: 'notify' },
    v: `<b>Traditional food from a third country.</b> AM Breweries notified on 27 November 2018; the Commission forwarded the valid notification on 11 September 2019; no Member State or EFSA raised a reasoned safety objection within four months; Implementing Regulation (EU) 2020/917 of 1 July 2020 authorised it — 19 months in total, half of them spent on the validity check. No committee vote and no data protection.`,
    src: [[celex('32020R0917'), 'Implementing Regulation (EU) 2020/917']] },
  { id: 'haskap', title: 'Haskap berries', tag: 'Plant · traditional', teaser: 'Fresh or frozen berries of <em>Lonicera caerulea</em> (subspecies <em>edulis</em>), with a long history of consumption in Japan.', ans: 'tf',
    s: { gm: 'no', use: 'food', hist: 'no', proc: false, sig: false, cat: 'iv', listed: 'no', pp: true, h25: true, choice: 'notify' },
    v: `<b>Traditional food from a third country.</b> Soloberry Ltd notified on 26 January 2018; the Commission forwarded the notification on 28 February 2018; no objections were raised; Implementing Regulation (EU) 2018/1991 of 13 December 2018 authorised the berries — under eleven months, one of the first traditional foods of the new regulation. The documented data showed a history of safe food use in Japan.`,
    src: [[celex('32018R1991'), 'Implementing Regulation (EU) 2018/1991']] },
  { id: 'myco', title: 'Mycoprotein (Fusarium venenatum A 3/5)', tag: 'Fungus', teaser: 'Fungal biomass from <em>Fusarium venenatum</em> strain A 3/5 — the strain used in long-established meat-free products.', ans: 'notnovel',
    s: { gm: 'no', use: 'food', hist: 'yes', proc: false, sig: false, cat: 'ii', listed: 'no' },
    v: `A consultation concluded that this mycoprotein is <b>not novel</b> (Commission list of consultation outcomes, 6 August 2024) — i.e., significant consumption in the Union before 15 May 1997 was shown. Strain matters: mycoprotein obtained from the mycelium of <em>F. venenatum</em> strain NRRL 26228 was found <b>novel</b>, category (ii) (outcome of 19 December 2024).`,
    src: [[ELI.consult, 'Commission: consultation outcomes']] },
  { id: 'stevia', title: 'Steviol glycosides as a sweetener', tag: 'Plant extract · additive', teaser: 'Purified sweet compounds extracted from the leaves of <em>Stevia rebaudiana</em>, used to sweeten soft drinks.', ans: 'other',
    s: { gm: 'no', use: 'additive', hist: 'no', proc: false, sig: false, cat: 'iv', listed: 'no' },
    v: `Used as a sweetener, steviol glycosides are a <b>food additive</b> (E 960), authorised under Regulation (EC) No 1333/2008 by Commission Regulation (EU) No 1131/2011 of 11 November 2011 — outside the novel food regulation (Art. 2(2)(b)(ii)). The plant itself has a novel-food history: in 2000 the Commission refused <em>Stevia rebaudiana</em> plants and dried leaves as a novel food (Decision 2000/196/EC), while in 2023 a consultation found a non-concentrated aqueous infusion of the leaves not novel (3 July 2023).`,
    src: [[celex('32011R1131'), 'Regulation (EU) No 1131/2011'], [celex('32000D0196'), 'Decision 2000/196/EC']] },
  { id: 'apple', title: 'Apple fruit cell culture biomass', tag: 'Plant cell culture', teaser: "Cells of the Swiss apple variety 'Uttwiler Spätlauber' grown in cell culture and homogenised, for food supplements.", ans: 'listed',
    s: { gm: 'no', use: 'food', hist: 'no', proc: false, sig: false, cat: 'vi', listed: 'yes', pp: false, h25: false },
    v: `Plant cell culture is <b>category (vi)</b> — the same category as cultivated meat. Mibelle Group Biochemistry applied on 14 April 2020; EFSA adopted its opinion on 24 May 2023; Implementing Regulation (EU) 2023/2847 of 20 December 2023 authorised it for food supplements, with the designation "apple fruit cell culture biomass" and a statement that the supplements should only be consumed by persons above 18 years of age.`,
    src: [[celex('32023R2847'), 'Implementing Regulation (EU) 2023/2847']] }
];
const ROUTE_LABEL = { other: 'Other regime (out of scope)', notnovel: 'Not a novel food', listed: 'Novel — on the Union list', art10: 'Novel — Art. 10 application', tf: 'Novel — traditional-food notification' };

/* ============================================================ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'status', label: 'Is it a novel food?', format: v => v })
  .add({ id: 'route', label: 'Route to market', format: v => v })
  .add({ id: 'efsa', label: 'EFSA assessment', format: v => v })
  .add({ id: 'time', label: 'Indicative time to market', format: v => v })
  .add({ id: 'dp', label: 'Data protection', format: v => v })
  .add({ id: 'label', label: 'Labelling', format: v => v });

ui.section('Product');
ui.select({ id: 'case', label: 'Load a real case', options: [{ value: 'custom', label: '— my own product —' }, ...CASES.map(c => ({ value: c.id, label: c.title }))], value: 'duck', help: 'Or answer the questions below for your own product idea.' });
ui.section('1 · Scope — Art. 2(2)');
ui.segmented({ id: 'gm', label: 'Genetic modification', options: [{ value: 'no', label: 'None' }, { value: 'with', label: 'Made with a GMM' }, { value: 'from', label: 'Contains / from GMO' }], value: 'no', help: '"Made with": a GM micro-organism is used in production but no GM material remains in the food.' });
ui.select({ id: 'use', label: 'Intended use', options: [{ value: 'food', label: 'As a food or food ingredient' }, { value: 'additive', label: 'Solely as a food additive' }, { value: 'enzyme', label: 'Solely as a food enzyme' }, { value: 'flavouring', label: 'Solely as a flavouring' }, { value: 'solvent', label: 'Solely as an extraction solvent' }], value: 'food' });
ui.section('2 · History — before 15 May 1997');
ui.segmented({ id: 'hist', label: 'Consumed significantly in the EU?', options: [{ value: 'yes', label: 'Yes' }, { value: 'supp', label: 'Supplements only' }, { value: 'no', label: 'No' }, { value: 'unsure', label: 'Unsure' }], value: 'no', help: 'Any Member State counts, irrespective of when it joined the EU. Evidence: sales, recipes, trade data.' });
ui.toggle({ id: 'proc', label: 'Produced by a new process (post-1997)', value: false });
ui.toggle({ id: 'sig', label: '… that significantly changes composition or structure', value: false, help: 'Affecting nutritional value, metabolism or undesirable substances — category (vii).' });
ui.toggle({ id: 'other', label: 'Now intended for foods other than supplements', value: true, help: 'Only relevant for foods used exclusively in food supplements before 1997 — category (x).' });
ui.section('3 · Category — Art. 3(2)(a)');
ui.select({ id: 'cat', label: 'Main category', options: [...Object.entries(CATS).map(([value, label]) => ({ value, label })), { value: 'none', label: 'None of the ten categories' }], value: 'vi' });
ui.section('4 · Union list — IR (EU) 2017/2470');
ui.segmented({ id: 'listed', label: 'Already authorised?', options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }, { value: 'dp', label: 'Yes, protected' }, { value: 'diff', label: 'Other spec/use' }], value: 'no', help: '"Protected": the entry names another applicant (data protection, Art. 27). "Other spec/use": listed, but not for your specification or intended use.' });
ui.section('5 · Route and strategy');
ui.toggle({ id: 'pp', label: 'Derived from primary production', value: false, help: 'Plants, animals, fungi, algae grown or harvested — not an extract or a synthesised substance (Art. 3(2)(c)).' });
ui.toggle({ id: 'h25', label: '≥ 25 years of documented use in the customary diet of a third country', value: false });
ui.segmented({ id: 'choice', label: 'If eligible for the traditional-food route', options: [{ value: 'notify', label: 'Notify (Art. 14)' }, { value: 'apply', label: 'Apply (Art. 10)' }], value: 'notify' });
ui.toggle({ id: 'dpreq', label: 'Request data protection (Art. 26)', value: true });
ui.segmented({ id: 'quality', label: 'Dossier quality (for the timeline)', options: [{ value: 'weak', label: 'Weak' }, { value: 'avg', label: 'Average' }, { value: 'good', label: 'Excellent' }], value: 'avg' });
ui.presets([
  { label: 'Vertical-farm lettuce', values: { case: 'lettuce' } },
  { label: 'Cultivated duck cells', values: { case: 'duck' } },
  { label: 'Fresh Wolffia', values: { case: 'wolffia' } },
  { label: 'Cricket powder', values: { case: 'cricket' } },
  { label: 'Status unclear', values: { case: 'custom', gm: 'no', use: 'food', hist: 'unsure', proc: false, sig: false } }
]);
ui.buttons([{ label: 'Copy strategy', variant: 'primary', onClick: () => copyStrategy() }, { label: 'Download .md', onClick: () => downloadStrategy() }]);
ui.saveButton('novel-food-navigator', () => { const d = decide(ui.values()); return { novel: d.statusText, route: d.routeText, category: d.cat || '—' }; });

let loading = false, raf = 0;
function loadCase(id) {
  const c = CASES.find(x => x.id === id); if (!c) return;
  const base = { gm: 'no', use: 'food', hist: 'no', proc: false, sig: false, other: true, cat: 'iv', listed: 'no', pp: false, h25: false, choice: 'notify' };
  loading = true; ui.setMany(Object.assign(base, c.s, { case: id })); loading = false;
  cancelAnimationFrame(raf); raf = requestAnimationFrame(update);
}

/* ============================================================ decision logic (Eqs. N1–N5) */
function decide(s) {
  const P = ['q_scope'], E = [], why = [];
  const out = (o) => Object.assign({ path: P, edges: E, why }, o);
  // N1 — scope
  if (s.gm === 'from' || s.use !== 'food') {
    const k = s.gm === 'from' ? 'gmo' : s.use; E.push('e_scope_other'); P.push('o_other');
    why.push(`Excluded from the scope of Regulation (EU) 2015/2283 by Article 2(2): ${OTHER_REGIME[k][0]}.`);
    return out({ status: 'excluded', route: 'other', regime: k, statusText: 'Outside the Regulation', routeText: OTHER_REGIME[k][0].split(':')[0] + ' regime' });
  }
  E.push('e_scope_hist'); P.push('q_hist');
  why.push('Not excluded by Article 2(2)' + (s.gm === 'with' ? ' — produced <em>with</em> a GM micro-organism, so Regulation (EC) No 1829/2003 does not apply provided no GM material remains in the food.' : '.'));
  // N2 — history and categories
  if (s.hist === 'unsure') { E.push('e_hist_consult'); P.push('o_consult'); why.push('Pre-1997 consumption cannot be shown or excluded: the operator must consult the Member State of first marketing (Art. 4(2); IR (EU) 2018/456).'); return out({ status: 'unknown', route: 'consult', statusText: 'Undetermined', routeText: 'Status consultation (Art. 4)' }); }
  const cats = new Set();
  if (s.hist === 'yes' || s.hist === 'supp') {
    E.push(s.hist === 'yes' ? 'e_hist_change' : 'e_hist_supp'); P.push('q_change');
    const changed = s.hist === 'yes' ? (s.proc && s.sig) : s.other;
    if (!changed) {
      E.push('e_change_nn'); P.push('o_notnovel');
      why.push(s.hist === 'yes' ? 'Consumed to a significant degree in the EU before 15 May 1997' + (s.proc ? ', and the new process does not significantly change composition or structure' : '') + ' — the historical test of Article 3(2)(a) fails.' : 'Used only in food supplements before 1997 and still intended only for supplements: not novel <em>in food supplements</em> (Art. 3(2)(a)(x) a contrario).');
      return out({ status: s.hist === 'yes' ? 'notnovel' : 'notnovel-supp', route: 'none', statusText: s.hist === 'yes' ? 'Not novel' : 'Not novel in supplements', routeText: 'General food law — no authorisation' });
    }
    cats.add(s.hist === 'yes' ? 'vii' : 'x');
    why.push(s.hist === 'yes' ? 'The source was eaten before 1997, but a new production process causes significant changes in composition or structure: novel under category (vii).' : 'Used exclusively in food supplements before 1997 but now intended for other foods: novel under category (x).');
    E.push('e_change_list'); P.push('q_list');
  } else {
    E.push('e_hist_cat'); P.push('q_cat');
    if (s.cat === 'none') { E.push('e_cat_no'); P.push('o_nocat'); why.push('No significant consumption before 1997, but none of the ten categories applies: not novel (rare — check carefully).'); return out({ status: 'notnovel', route: 'none', statusText: 'Not novel', routeText: 'General food law — no authorisation' }); }
    cats.add(s.cat); if (s.proc && s.sig) cats.add('vii');
    why.push(`No significant consumption in the EU before 15 May 1997 and the food falls under category ${[...cats].map(c => '(' + c + ')').join(' and ')}: it is a <b>novel food</b> (Art. 3(2)(a)).`);
    E.push('e_cat_list'); P.push('q_list');
  }
  const cat = [...cats][0];
  // N3 — Union list
  if (s.listed === 'yes') { E.push('e_list_market'); P.push('o_market'); why.push('An identical food is on the Union list: authorisations are generic, so any operator may market it in accordance with the specification, conditions of use and labelling of the entry (Art. 6(2)).'); return out({ status: 'novel', cats, cat, route: 'listed', statusText: `Novel — cat. ${[...cats].map(c => '(' + c + ')').join(', ')}`, routeText: 'Union list — market now' }); }
  if (s.listed === 'dp') { E.push('e_list_dp'); P.push('o_dp'); why.push('The food is listed, but the entry is protected: during the five years of data protection only the named applicant may market it, unless you obtain its agreement or your own authorisation without the protected data (Arts 26–27).'); return out({ status: 'novel', cats, cat, route: 'listed-dp', statusText: `Novel — cat. ${[...cats].map(c => '(' + c + ')').join(', ')}`, routeText: 'Listed, but protected (Art. 27)' }); }
  if (s.listed === 'diff') { E.push('e_list_art10', 'e_art10_auth'); P.push('o_art10', 'o_auth'); why.push('Listed, but not for this specification or use: an application to update the Union list is needed (Art. 10; IR (EU) 2017/2469 Art. 3(4) allows fewer data if the change does not affect the risk assessment).'); return out({ status: 'novel', cats, cat, route: 'art10', mod: true, statusText: `Novel — cat. ${[...cats].map(c => '(' + c + ')').join(', ')}`, routeText: 'Art. 10 application (update)' }); }
  // N4 — traditional food eligibility and route choice
  E.push('e_list_tf'); P.push('q_tf');
  const excluded = [...cats].filter(c => TF_EXCLUDED.includes(c));
  const eligible = s.pp && s.h25 && !excluded.length;
  if (eligible && s.choice === 'notify') {
    E.push('e_tf_notify', 'e_tf_auth'); P.push('o_tf', 'o_auth');
    why.push('Derived from primary production with at least 25 years of safe use in the customary diet of a third country: eligible as a traditional food (Art. 3(2)(b)–(c)); notification under Article 14. No data protection (Art. 26(3)).');
    return out({ status: 'novel', cats, cat, route: 'tf', eligible, statusText: `Novel — cat. ${[...cats].map(c => '(' + c + ')').join(', ')}`, routeText: 'Traditional-food notification (Art. 14)' });
  }
  E.push('e_tf_art10', 'e_art10_auth'); P.push('o_art10', 'o_auth');
  why.push(eligible ? 'Eligible as a traditional food, but the applicant chooses a full application — for example to obtain data protection.' : `Not eligible for the traditional-food route (${!s.pp ? 'not from primary production' : !s.h25 ? 'no documented 25-year history of use in a third country' : 'category ' + excluded.map(c => '(' + c + ')').join(', ') + ' is excluded by Art. 3(2)(c)'}): an Article 10 application is required.`);
  return out({ status: 'novel', cats, cat, route: 'art10', eligible, statusText: `Novel — cat. ${[...cats].map(c => '(' + c + ')').join(', ')}`, routeText: 'Article 10 application' });
}

/* ============================================================ SVG decision tree */
const stageEl = $('#stage');
const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 960 760'); svg.setAttribute('class', 'nfn-svg'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Decision tree of Regulation (EU) 2015/2283; the path of the current product is highlighted');
stageEl.appendChild(svg);
const hud = hudChips(stageEl);
stageToolbar(stageEl, { onReset: () => animatePath(true) });
const mk = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const defs = mk('defs', {}, svg);
[['nfa', 'var(--line-strong)'], ['nfa-on', 'var(--accent)']].forEach(([id, c]) => { const m = mk('marker', { id, viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 8, markerHeight: 8, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' }, defs); mk('path', { d: 'M0 0 L10 5 L0 10 z', fill: c }, m); });

/* layout: 960 × 745 user units; columns L (x 118), spine S (x 410), R (x 700), F (x 890) */
const NODES = {
  q_scope: { x: 410, y: 48, w: 280, h: 80, q: 1, key: 'SCOPE · ART. 2(2)', lines: ['Genetically modified food, or', 'used solely as enzyme, additive,', 'flavouring or extraction solvent?'] },
  o_other: { x: 770, y: 48, w: 300, h: 62, tone: 'other', key: 'OUTSIDE THE REGULATION', lines: ['Another EU authorisation', 'regime applies'] },
  q_hist: { x: 410, y: 172, w: 280, h: 62, q: 1, key: 'HISTORY · ART. 3(2)(a)', lines: ['Eaten to a significant degree', 'in the EU before 15 May 1997?'] },
  o_consult: { x: 118, y: 172, w: 220, h: 80, tone: 'consult', key: 'ART. 4 · IR 2018/456', lines: ['Status consultation', 'with a Member State', '4 (+4) months'] },
  q_change: { x: 700, y: 172, w: 220, h: 80, q: 1, key: 'CHANGED SINCE 1997?', lines: ['New process, significant', 'change (vii) — or used', 'beyond supplements (x)?'] },
  o_notnovel: { x: 890, y: 172, w: 120, h: 62, tone: 'free', key: 'NOT NOVEL', lines: ['General', 'food law'] },
  q_cat: { x: 410, y: 280, w: 280, h: 62, q: 1, key: 'CATEGORY · ART. 3(2)(a)', lines: ['Falls into at least one of', 'the ten categories (i)–(x)?'] },
  o_nocat: { x: 118, y: 280, w: 220, h: 62, tone: 'free', key: 'NOT NOVEL', lines: ['No category applies:', 'general food law'] },
  q_list: { x: 410, y: 385, w: 280, h: 62, q: 1, key: 'UNION LIST · IR 2017/2470', lines: ['Already authorised for this', 'specification and use?'] },
  o_market: { x: 118, y: 372, w: 220, h: 62, tone: 'free', key: 'GENERIC AUTHORISATION', lines: ['Market under the entry', 'and its conditions'] },
  o_dp: { x: 118, y: 478, w: 220, h: 62, tone: 'consult', key: 'DATA PROTECTION · ART. 27', lines: ['Only the named applicant', 'for ≤ 5 years'] },
  q_tf: { x: 410, y: 495, w: 280, h: 80, q: 1, key: 'TRADITIONAL FOOD · ART. 3(2)(c)', lines: ['Primary production, ≥ 25 years', 'of safe use in a third country,', 'not (i), (iii), (vii)–(x)?'] },
  o_tf: { x: 118, y: 612, w: 220, h: 62, tone: 'tf', key: 'NOTIFICATION · ARTS 14–15', lines: ['4-month window for safety', 'objections (→ Art. 16)'] },
  o_art10: { x: 410, y: 612, w: 280, h: 62, tone: 'art10', key: 'APPLICATION · ARTS 10–12', lines: ['EFSA 9 months + clock stops,', 'draft ≤ 7 months, PAFF vote'] },
  o_reject: { x: 700, y: 612, w: 220, h: 62, tone: 'other', key: 'NOT AUTHORISED', lines: ['Negative opinion,', 'withdrawn or no QMV'] },
  o_auth: { x: 410, y: 704, w: 320, h: 62, tone: 'auth', key: 'AUTHORISED · UNION LIST UPDATED', lines: ['Specification, conditions of use,', 'labelling, data protection'] }
};
const EDGES = [
  { id: 'e_scope_other', from: 'q_scope', to: 'o_other', pts: [[550, 48], [620, 48]], lab: 'yes', lp: [585, 40], anchor: 'middle' },
  { id: 'e_scope_hist', from: 'q_scope', to: 'q_hist', pts: [[410, 88], [410, 141]], lab: 'no', lp: [418, 124] },
  { id: 'e_hist_consult', from: 'q_hist', to: 'o_consult', pts: [[270, 172], [228, 172]], lab: 'unsure', lp: [249, 164], anchor: 'middle' },
  { id: 'e_hist_change', from: 'q_hist', to: 'q_change', pts: [[550, 160], [590, 160]], lab: 'yes', lp: [570, 152], anchor: 'middle' },
  { id: 'e_hist_supp', from: 'q_hist', to: 'q_change', pts: [[550, 190], [590, 190]], lab: 'supplements', lp: [556, 226] },
  { id: 'e_change_nn', from: 'q_change', to: 'o_notnovel', pts: [[810, 172], [830, 172]], lab: 'no', lp: [820, 163], anchor: 'middle' },
  { id: 'e_change_list', from: 'q_change', to: 'q_list', pts: [[660, 212], [660, 336], [500, 336], [500, 354]], lab: 'yes → novel (vii)/(x)', lp: [668, 282] },
  { id: 'e_hist_cat', from: 'q_hist', to: 'q_cat', pts: [[410, 203], [410, 249]], lab: 'no', lp: [418, 232] },
  { id: 'e_cat_no', from: 'q_cat', to: 'o_nocat', pts: [[270, 280], [228, 280]], lab: 'no', lp: [249, 272], anchor: 'middle' },
  { id: 'e_cat_list', from: 'q_cat', to: 'q_list', pts: [[410, 311], [410, 354]], lab: 'yes', lp: [418, 330] },
  { id: 'e_list_market', from: 'q_list', to: 'o_market', pts: [[270, 372], [228, 372]], lab: 'yes', lp: [249, 364], anchor: 'middle' },
  { id: 'e_list_dp', from: 'q_list', to: 'o_dp', pts: [[270, 400], [249, 400], [249, 478], [228, 478]], lab: 'protected', lp: [242, 437], anchor: 'end' },
  { id: 'e_list_art10', from: 'q_list', to: 'o_art10', pts: [[550, 400], [575, 400], [575, 563], [500, 563], [500, 581]], lab: 'other spec / use', lp: [583, 482] },
  { id: 'e_list_tf', from: 'q_list', to: 'q_tf', pts: [[410, 416], [410, 455]], lab: 'no', lp: [418, 440] },
  { id: 'e_tf_notify', from: 'q_tf', to: 'o_tf', pts: [[330, 535], [330, 558], [118, 558], [118, 581]], lab: 'yes · notify', lp: [134, 552] },
  { id: 'e_tf_art10', from: 'q_tf', to: 'o_art10', pts: [[440, 535], [440, 581]], lab: 'no / apply', lp: [448, 560] },
  { id: 'e_tf_auth', from: 'o_tf', to: 'o_auth', pts: [[118, 643], [118, 704], [250, 704]], lab: 'no objection', lp: [126, 690] },
  { id: 'e_art10_auth', from: 'o_art10', to: 'o_auth', pts: [[410, 643], [410, 673]], lab: 'positive opinion + QMV', lp: [418, 662] },
  { id: 'e_art10_rej', from: 'o_art10', to: 'o_reject', pts: [[550, 612], [590, 612]], lab: 'or', lp: [570, 604], anchor: 'middle', alt: 1 },
  { id: 'e_consult_back', from: 'o_consult', to: 'q_hist', pts: [[118, 132], [118, 112], [320, 112], [320, 141]], lab: 'status published → decide again', lp: [126, 105], alt: 1, dashed: 1 }
];
function roundedPath(pts, r = 9) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (i < pts.length - 1) {
      const [px, py] = pts[i - 1], [nx, ny] = pts[i + 1];
      const l1 = Math.hypot(x - px, y - py), l2 = Math.hypot(nx - x, ny - y), rr = Math.min(r, l1 / 2, l2 / 2);
      const ax = x - (x - px) / l1 * rr, ay = y - (y - py) / l1 * rr, bx = x + (nx - x) / l2 * rr, by = y + (ny - y) / l2 * rr;
      d += ` L${ax} ${ay} Q${x} ${y} ${bx} ${by}`;
    } else d += ` L${x} ${y}`;
  }
  return d;
}
const gRoot = mk('g', { transform: 'translate(0 16)' }, svg);
const gEdges = mk('g', {}, gRoot), gHi = mk('g', {}, gRoot), gFlow = mk('g', {}, gRoot), gNodes = mk('g', {}, gRoot), gTok = mk('g', {}, gRoot);
EDGES.forEach(e => {
  const d = roundedPath(e.pts);
  e.el = mk('path', { d, class: 'nf-edge' + (e.dashed ? ' dashed' : '') + (e.alt ? ' alt' : ''), 'marker-end': 'url(#nfa)' }, gEdges);
  e.hi = mk('path', { d, class: 'nf-hi' }, gHi);
  e.flow = mk('path', { d, class: 'nf-flow' }, gFlow);
  e.len = e.hi.getTotalLength ? e.hi.getTotalLength() : e.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - e.pts[i][0], p[1] - e.pts[i][1]), 0);
  e.hi.style.strokeDasharray = `${e.len} ${e.len}`; e.hi.style.strokeDashoffset = e.len;
  const t = mk('text', { x: e.lp[0], y: e.lp[1], class: 'nf-elab', 'text-anchor': e.anchor || 'start' }, gEdges); t.textContent = e.lab; e.t = t;
});
Object.entries(NODES).forEach(([id, n]) => {
  n.id = id;
  const g = mk('g', { class: 'nf-node ' + (n.q ? 'q' : 'out tone-' + n.tone), tabindex: 0, role: 'button', 'aria-label': n.key + ': ' + n.lines.join(' ') }, gNodes);
  const top = n.y - n.h / 2;
  mk('rect', { x: n.x - n.w / 2, y: top, width: n.w, height: n.h, rx: n.q ? 9 : 16 }, g);
  const k = mk('text', { x: n.x - n.w / 2 + 10, y: top + 16, class: 'nf-key' }, g); k.textContent = n.key;
  n.lines.forEach((l, i) => { const t = mk('text', { x: n.x, y: top + 36 + i * 16, 'text-anchor': 'middle', class: 'nf-txt' }, g); t.textContent = l; });
  if (n.q) { n.badge = mk('g', { class: 'nf-badge' }, g); n.badgeR = mk('rect', { x: 0, y: top - 15, width: 10, height: 19, rx: 9.5 }, n.badge); n.badgeT = mk('text', { x: 0, y: top - 1.5, 'text-anchor': 'middle' }, n.badge); }
  n.g = g;
  const act = () => { Object.values(NODES).forEach(m => m.g.classList.toggle('sel', m === n)); showInfo(id); };
  g.addEventListener('click', act); g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); act(); } });
});
const token = mk('circle', { r: 7, class: 'nf-token', cx: -20, cy: -20 }, gTok);
const tokenRing = mk('circle', { r: 13, class: 'nf-token-ring', cx: -20, cy: -20 }, gTok);

/* legal notes for each node */
const INFO = {
  q_scope: ['Scope — Article 2(2)', `The Regulation does not apply to (a) genetically modified foods falling within the scope of Regulation (EC) No 1829/2003, and (b) foods when and in so far as they are used as food enzymes (Reg. 1332/2008), food additives (Reg. 1333/2008), food flavourings (Reg. 1334/2008) or extraction solvents (Directive 2009/32/EC). Each of these has its own pre-market authorisation. A food produced <em>with</em> a GM micro-organism but containing no GM material is not GM food in this sense.`, [[ELI.reg, 'Regulation (EU) 2015/2283'], [ELI.gmo, 'Regulation (EC) No 1829/2003']]],
  o_other: ['Another EU regime', `GM food and feed: EFSA GMO Panel, Commission authorisation for ten years, labelling "genetically modified …" above the 0.9 % adventitious threshold. Additives, enzymes and flavourings: the common authorisation procedure of Regulation (EC) No 1331/2008 and Union lists. Extraction solvents: Directive 2009/32/EC.`, [[ELI.common, 'Regulation (EC) No 1331/2008'], [ELI.add, 'Regulation (EC) No 1333/2008']]],
  q_hist: ['Historical test — Article 3(2)(a)', `Novel food means "any food that was not used for human consumption to a significant degree within the Union before 15 May 1997, irrespective of the dates of accession of Member States to the Union" and that falls under at least one of ten categories. 15 May 1997 is the date of entry into force of the first novel food regulation, (EC) No 258/97. Evidence: sales to consumers, recipes, trade statistics, surveys. Use only as a medicine does not count; use only in food supplements counts only for supplements.`, [[ELI.reg, 'Regulation (EU) 2015/2283']]],
  o_consult: ['Status consultation — Article 4 and IR (EU) 2018/456', `The operator must verify the status of its food (Art. 4(1)); when unsure, it consults the Member State where it first intends to market it (Art. 4(2)). The request consists of a cover letter, a technical dossier, supporting documentation and an explanatory note (IR 2018/456, Art. 4). The Member State concludes within 4 months of validity, extendable by at most 4 months in duly justified cases; a request for more information does not stop the clock (Art. 6). Outcomes — novel, not novel, not novel only in food supplements — are published by the Commission (Art. 7).`, [[ELI.ir456, 'IR (EU) 2018/456'], [ELI.consult, 'Published consultation outcomes']]],
  q_change: ['New process or new use — categories (vii) and (x)', `(vii): food resulting from a production process not used for food production within the Union before 15 May 1997, where that process gives rise to significant changes in the composition or structure of a food, affecting its nutritional value, metabolism or level of undesirable substances. (x): food used exclusively in food supplements before 15 May 1997, where it is intended to be used in foods other than food supplements. Whether a change is "significant" is decided case by case — UV-treated skimmed milk with &lt; 0.375 µg vitamin D₃ per 100 g was found not novel (2024), UV-treated mushrooms are novel.`, [[ELI.reg, 'Regulation (EU) 2015/2283, Art. 3(2)(a)'], [ELI.consult, 'Consultation outcomes']]],
  o_notnovel: ['Not a novel food', `No pre-market authorisation under Regulation 2015/2283. The operator remains responsible for safety (Art. 14 of Regulation (EC) No 178/2002), and hygiene, contaminant and labelling rules apply (Regulation (EU) No 1169/2011). A food used before 1997 only in supplements stays "not novel only in food supplements".`, [[ELI.gfl, 'Regulation (EC) No 178/2002'], [ELI.fic, 'Regulation (EU) No 1169/2011']]],
  q_cat: ['Categorical test — Article 3(2)(a)(i)–(x)', `Ten categories: (i) new or intentionally modified molecular structure; (ii) micro-organisms, fungi or algae; (iii) material of mineral origin; (iv) plants or their parts (unless a history of safe food use in the Union and conventional propagation); (v) animals or their parts (unless traditional breeding and a history of safe use in the Union) — including whole insects (recital 8); (vi) cell or tissue culture from animals, plants, micro-organisms, fungi or algae; (vii) new process with significant change; (viii) engineered nanomaterials; (ix) vitamins, minerals and other substances from a new process or containing nanomaterials; (x) former supplement-only foods.`, [[ELI.reg, 'Regulation (EU) 2015/2283, Art. 3(2)(a)']]],
  o_nocat: ['Not novel — no category', `If a food without significant consumption before 1997 falls into none of the ten categories, it is not a novel food. In practice this is rare: almost every food is derived from plants, animals, micro-organisms, cells or minerals. Recital 17: food produced exclusively from ingredients outside the scope — by changing ingredients or their quantities — is not novel.`, [[ELI.reg, 'Regulation (EU) 2015/2283']]],
  q_list: ['Union list — Articles 6 and 9; IR (EU) 2017/2470', `Only novel foods authorised and included in the Union list may be placed on the market, in accordance with the conditions of use and labelling requirements specified there (Art. 6). An entry contains the specification, conditions of use, additional specific labelling requirements, post-market monitoring where needed, and — with data protection — the applicant's name and the end date of protection (Arts 9 and 27). A different production process, source or use level may fall outside the entry.`, [[ELI.ir2470, 'IR (EU) 2017/2470'], [ELI.union, 'Union list and amendments']]],
  o_market: ['Generic authorisation', `Authorisations under Regulation 2015/2283 are generic: any food business operator may market a listed novel food that meets the specification, within the conditions of use and with the labelling of the entry. No new application is needed.`, [[ELI.union, 'Union list']]],
  o_dp: ['Data protection — Articles 26 and 27', `On request, newly developed proprietary data may not be used for the benefit of a subsequent application for five years from the date of authorisation (Art. 26(1)). During that period the food is authorised "only by" the initial applicant, unless a subsequent applicant obtains its own authorisation without reference to the protected data or with the initial applicant's agreement (Art. 27(1)). Example: partially defatted house-cricket powder, protected until 24 January 2028.`, [[ELI.reg, 'Regulation (EU) 2015/2283, Arts 26–27'], [celex('32023R0005'), 'IR (EU) 2023/5']]],
  q_tf: ['Traditional food from a third country — Article 3(2)(b)–(c)', `A traditional food is a novel food "other than novel foods as referred to in points (i), (iii), (vii), (viii), (ix) and (x)" of Art. 3(2)(a), derived from primary production, with a history of safe food use in a third country: safety confirmed with compositional data and from experience of continued use for at least 25 years in the customary diet of a significant number of people in at least one third country. The applicant may notify (Art. 14) — or file a normal application.`, [[ELI.reg, 'Regulation (EU) 2015/2283, Art. 3(2)'], [ELI.efsaTF, 'EFSA (2024) guidance on traditional foods']]],
  o_tf: ['Notification — Articles 14–15', `The Commission forwards a valid notification to the Member States and EFSA within one month of verifying its validity (Art. 15(1)). Within four months a Member State or EFSA may submit duly reasoned safety objections (15(2)). Without objections, the Commission authorises the food and updates the Union list without delay; the entry states that it is a traditional food from a third country (15(4)) — no committee vote. With objections, the applicant may submit an application (Art. 16): EFSA six months (Art. 17), Commission draft within three months (Art. 18). No data protection (Art. 26(3)).`, [[ELI.reg, 'Regulation (EU) 2015/2283, Arts 14–18'], [ELI.ir2468, 'IR (EU) 2017/2468']]],
  o_art10: ['Application — Articles 10–12', `The Commission verifies validity (IR 2017/2469, Art. 6; EFSA's view within 30 working days if consulted) and forwards the application to EFSA within one month. EFSA adopts its opinion within nine months, extended by every request for additional data (Art. 11(4)). Within seven months of the opinion's publication the Commission submits a draft implementing act to the PAFF Committee (Art. 12), which votes by qualified majority. Studies must be notified to EFSA before they start (Transparency Regulation).`, [[ELI.reg, 'Regulation (EU) 2015/2283, Arts 10–12'], [ELI.ir2469, 'IR (EU) 2017/2469'], ['/laboratories/authorisation-timeline/', 'Simulate the timeline']]],
  o_reject: ['When an application fails', `An application can be declared invalid (e.g., studies not notified), withdrawn by the applicant at any time (Art. 10(7)), receive a negative opinion, or be terminated by the Commission where it considers an update not justified (Art. 10(6)); in the committee, a draft may fail to obtain a qualified majority. In 2018–2024, 12 of 91 published EFSA opinions were negative (Le Bloch et al., 2025).`, [[ELI.reg, 'Regulation (EU) 2015/2283, Art. 10']]],
  o_auth: ['Authorisation and labelling', `The implementing regulation amends the Union list (IR 2017/2470) and enters into force, usually on the twentieth day after publication. Labelling: the general rules of Regulation (EU) No 1169/2011 plus the designation and any additional specific labelling requirements of the entry (e.g., allergy statements for insects and rapeseed protein, age restrictions for supplements). With data protection, the entry names the applicant and the end date (Art. 27).`, [[ELI.fic, 'Regulation (EU) No 1169/2011'], [ELI.ir2470, 'IR (EU) 2017/2470']]]
};
function showInfo(id) {
  const [t, html, links] = INFO[id];
  $('#nfn-note').innerHTML = `<div class="nfn-note-k">Legal note</div><h4>${t}</h4><p>${html}</p><p class="nfn-links">${links.map(([h, l]) => A(h, l)).join(' · ')}</p>`;
}

/* path animation: the token travels along the active edges; nodes light up as it arrives */
let animId = 0, current = null;
function animatePath(force) {
  const d = current; if (!d) return;
  const myId = ++animId;
  svg.classList.add('has-path');
  const act = d.edges.map(id => EDGES.find(e => e.id === id));
  Object.values(NODES).forEach(n => n.g.classList.remove('on'));
  EDGES.forEach(e => { e.el.classList.remove('on'); e.t.classList.remove('on'); e.flow.classList.remove('on'); e.hi.style.strokeDashoffset = e.len; e.hi.removeAttribute('marker-end'); });
  NODES[d.path[0]].g.classList.add('on');
  const total = act.reduce((s, e) => s + e.len, 0);
  const speed = 520; // px s⁻¹
  const dur = reduceMotion ? 0 : Math.max(0.7, total / speed) * 1000;
  const t0 = performance.now();
  const done = e => { e.hi.style.strokeDashoffset = 0; e.hi.setAttribute('marker-end', 'url(#nfa-on)'); e.t.classList.add('on'); };
  const finish = () => { act.forEach(e => { done(e); e.el.classList.add('on'); e.flow.classList.add('on'); }); d.path.forEach(id => NODES[id].g.classList.add('on')); const last = act[act.length - 1]; const p = last ? last.pts[last.pts.length - 1] : [NODES[d.path[0]].x, NODES[d.path[0]].y]; placeToken(p[0], p[1], 1); };
  if (!dur) { finish(); return; }
  const step = now => {
    if (myId !== animId) return;
    const dist = Math.min(total, (now - t0) / dur * total);
    let acc = 0;
    for (let i = 0; i < act.length; i++) {
      const e = act[i];
      if (dist >= acc + e.len) { done(e); NODES[e.to].g.classList.add('on'); acc += e.len; continue; }
      const f = Math.max(0, dist - acc); e.hi.style.strokeDashoffset = e.len - f;
      if (f > 0 && e.hi.getPointAtLength) { const pt = e.hi.getPointAtLength(f); placeToken(pt.x, pt.y, 0); }
      break;
    }
    if (dist < total) requestAnimationFrame(step); else finish();
  };
  requestAnimationFrame(step);
}
function placeToken(x, y, done) { token.setAttribute('cx', x); token.setAttribute('cy', y); tokenRing.setAttribute('cx', x); tokenRing.setAttribute('cy', y); tokenRing.classList.toggle('done', !!done); }
function setBadges(s, d) {
  const B = {
    q_scope: d.route === 'other' ? (s.gm === 'from' ? 'yes · GMO' : 'yes · ' + s.use) : 'no',
    q_hist: { yes: 'yes', supp: 'supplements', no: 'no', unsure: 'unsure' }[s.hist],
    q_change: d.path.includes('o_notnovel') ? 'no' : (s.hist === 'yes' ? 'yes · (vii)' : 'yes · (x)'),
    q_cat: d.path.includes('o_nocat') ? 'none' : d.cats ? [...d.cats].map(c => '(' + c + ')').join(' ') : '',
    q_list: { no: 'not listed', yes: 'listed', dp: 'protected', diff: 'other spec' }[s.listed],
    q_tf: d.route === 'tf' ? 'eligible · notify' : d.eligible ? 'eligible · apply' : 'not eligible'
  };
  Object.entries(NODES).forEach(([id, n]) => {
    if (!n.q) return; const on = d.path.includes(id) && d.path.indexOf(id) < d.path.length - 1; n.badge.style.display = on ? '' : 'none'; if (!on) return;
    n.badgeT.textContent = B[id]; const w = Math.max(36, B[id].length * 7 + 16); const x = n.x + n.w / 2 - w - 8; n.badgeR.setAttribute('x', x); n.badgeR.setAttribute('width', w); n.badgeT.setAttribute('x', x + w / 2);
  });
}

/* ============================================================ outputs: readouts, strategy card, charts */
const QUALITY = { weak: { stops: 5, resp: 200, pInvalid: 0.25, pNeg: 0.25, pWithdraw: 0.05 }, avg: {}, good: { stops: 1, resp: 45, pInvalid: 0.02, pNeg: 0.05, pWithdraw: 0.01 } };
const tlCache = {};
function timeline(route, q) {
  const key = route + '|' + q; if (tlCache[key]) return tlCache[key];
  const r = runMany(Object.assign({ route }, QUALITY[q]), 1000, 77);
  const all = r.map(x => x.outcome === 'authorised' ? x.total / MONTH : Infinity).sort((a, b) => a - b);
  const ok = all.filter(Number.isFinite);
  return (tlCache[key] = { all, q: quantiles(ok, [0.1, 0.5, 0.9]), p: ok.length / all.length });
}
function dossier(d, s) {
  if (d.route === 'other') { const o = OTHER_REGIME[d.regime]; return [`Apply under ${A(o[1], o[0])}: ${o[2]}`]; }
  if (d.route === 'none') return ['No authorisation dossier. Keep evidence of pre-1997 consumption (or of the absence of significant compositional change) in case a control authority asks.', `Comply with general food law: safety (${A(ELI.gfl, 'Reg. (EC) No 178/2002')}, Art. 14), registration and hygiene of the establishment, contaminant limits, and ${A(ELI.fic, 'food information to consumers')}.`];
  if (d.route === 'consult') return [`Consultation request to the Member State of first marketing (${A(ELI.ir456, 'IR (EU) 2018/456')}, Art. 4): cover letter, technical dossier, supporting documentation, explanatory note.`, 'Evidence of significant consumption in any Member State before 15 May 1997: invoices, catalogues, recipes, trade and customs data, surveys, affidavits.', 'Check the Commission\'s published consultation outcomes and the EU Novel Food Catalogue first — the question may already be answered.'];
  if (d.route === 'listed') return ['No new dossier: verify that your food meets the <b>specification</b> of the Union-list entry (composition, purity, microbiology, contaminants) and stays within the authorised <b>conditions of use</b>.', 'Keep batch analyses showing compliance; apply the designation and labelling of the entry.'];
  if (d.route === 'listed-dp') return ['Option 1: wait until the end date of data protection printed in the Union-list entry.', 'Option 2: agreement with the protected applicant (Art. 27(1)).', 'Option 3: your own full Article 10 application with your own studies, without reference to the protected data (see the dossier list for an application).'];
  if (d.route === 'tf') return [`Notification (${A(ELI.reg, 'Art. 14')}; ${A(ELI.ir2468, 'IR (EU) 2017/2468')}; ${A(ELI.efsaTF, 'EFSA 2024 traditional-food guidance')}): name and description, detailed composition, country or countries of origin, <b>documented data on the history of safe food use</b> in a third country (at least 25 years of continued use in the customary diet of a significant number of people), proposed conditions of use and specific labelling requirements.`, 'Specification with limits for contaminants typical of the source and cultivation system (compare the heavy-metal, trace-element and microcystin limits set for Wolffia grown in vertical farms).', 'If an objection is raised: an Article 16 application answering the objections with documented data.'];
  const cats = d.cats ? [...d.cats] : [];
  const id = { i: 'chemical identity, structure, purity and impurities', ii: 'taxonomic identity of the production organism, whole-genome sequence, characterisation of any genetic modification, absence of viable cells of the production strain', iii: 'mineral identity and source', iv: 'botanical identity (species, part used), cultivation and harvesting conditions', v: 'species and life stage, rearing conditions and feed or substrate', vi: 'cell or cell line identity; genetic and phenotypic stability; for primary cells the source animal and biopsy; culture media components and their residues', vii: 'the pre-1997 food, the new process and the changes it causes', viii: 'characterisation of the engineered nanomaterial (particle size distribution, form)', ix: 'the nutrient source and its new production process', x: 'the supplement-only history and the new food uses' };
  const L = [
    `<b>Structure</b> (${A(ELI.ir2469, 'IR (EU) 2017/2469')}, Art. 3): cover letter, technical dossier (administrative data, Art. 4; scientific data, Art. 5), summary of the dossier. ${s.dpreq ? 'Claim data protection with evidence of your exclusive right of reference (Art. 4(g)).' : ''}`,
    `<b>Transparency Regulation</b> (${A(ELI.transp, 'Reg. (EU) 2019/1381')}): notify every study to EFSA before it starts — un-notified studies make the application invalid; ask EFSA for pre-submission advice.`,
    `<b>EFSA data requirements</b> (${A(ELI.efsa, 'EFSA NDA Panel 2024 guidance')}, applicable since 1 February 2025):<ol class="nfn-efsa"><li>Identity — ${cats.map(c => id[c]).filter(Boolean).join('; ') || 'identity of the novel food'}</li><li>Production process</li><li>Compositional data on several batches; stability</li><li>Specifications</li><li>History of use of the food and/or its source</li><li>Proposed uses, use levels and anticipated intake</li><li>ADME (tiered)</li><li>Toxicology: genotoxicity; a subchronic oral toxicity study of at least 90 days (OECD TG 408); further tiers if triggered</li><li>Nutritional information</li><li>Allergenicity</li></ol>`
  ];
  if (d.mod) L.unshift('This is an update of an existing entry: data already assessed need not be repeated if you justify that the change does not affect the risk assessment (IR 2017/2469, Art. 3(4)).');
  return L;
}
function labelling(d, s) {
  if (d.route === 'other') return d.regime === 'gmo' ? ['GM labelling: "genetically modified [name]" or "produced from genetically modified [name]" (Reg. 1829/2003, Arts 12–13); traceability under Reg. 1830/2003.'] : ['Labelling under the specific regime (e.g., additive name or E-number in the list of ingredients) and Regulation (EU) No 1169/2011.'];
  const L = [`Mandatory particulars of ${A(ELI.fic, 'Regulation (EU) No 1169/2011')} (name of the food, ingredients, allergens, nutrition declaration …).`];
  if (d.status === 'notnovel-supp') L.push('Food supplement rules (Directive 2002/46/EC) — the food is not novel only as a supplement.');
  if (d.status !== 'novel') return L;
  L.push('The designation specified in the Union-list entry, plus any additional specific labelling requirement (Art. 9(3)).');
  if (d.cats.has('v')) L.push('Insects: a statement that the ingredient may cause allergic reactions in consumers allergic to crustaceans (and molluscs) and to dust mites, close to the list of ingredients.');
  if (d.cats.has('vi') && s.cat === 'vi') L.push(`Cell culture of animal origin: meat terms reserved by ${A(ELI.cmo, 'Regulation (EU) 2026/1739')} (e.g., "chicken", "duck", "steak") may not designate food from cell or tissue culture.`);
  if (d.cats.has('vii')) L.push('A new process may have to be named in the designation (e.g., "UV-treated mushrooms").');
  if (d.route === 'tf') L.push('The Union-list entry states that the food is a traditional food from a third country.');
  if (s.gm === 'with') L.push('Produced with (not from) a GM micro-organism and free of GM material: no GM label.');
  return L;
}
let lastD = null;
function update() {
  const s = ui.values();
  const d = decide(s); lastD = d; current = d;
  // controls that do not apply are dimmed
  ui.enable('sig', !!s.proc); ui.enable('other', s.hist === 'supp');
  ui.enable('cat', s.hist === 'no'); ui.enable('choice', !!(s.pp && s.h25));
  setBadges(s, d); animatePath();
  hud.set('status', `Novel food: <b>${d.statusText}</b>`);
  hud.set('route', `Route: <b>${d.routeText}</b>`);
  // readouts
  const st = d.status === 'novel' ? 'warn' : d.status === 'excluded' || d.status === 'unknown' ? 'bad' : 'ok';
  const catTxt = d.cats ? [...d.cats].map(c => '(' + c + ')').join(' ') : '';
  ro.set('status', d.status === 'novel' ? `Yes ${catTxt}` : d.status === 'excluded' ? 'Out of scope' : d.status === 'unknown' ? 'Undetermined' : d.status === 'notnovel-supp' ? 'No (suppl.)' : 'No', st, d.cats ? [...d.cats].map(c => CATS[c]).join('; ') : d.status === 'excluded' ? 'Article 2(2)' : d.status === 'unknown' ? 'history cannot be shown' : 'Art. 3(2)(a) not met');
  ro.set('route', { art10: 'Art. 10', tf: 'Notification', consult: 'Consultation', listed: 'Market now', 'listed-dp': 'Protected', none: 'No approval', other: 'Other regime' }[d.route], d.route === 'art10' ? 'bad' : d.route === 'tf' || d.route === 'consult' || d.route === 'listed-dp' ? 'warn' : 'ok', d.routeText);
  ro.set('efsa', d.route === 'art10' ? 'Full' : d.route === 'tf' ? 'If objection' : d.route === 'other' ? 'Other panel' : 'None', d.route === 'art10' ? 'warn' : 'ok', d.route === 'art10' ? 'risk assessment: 9 months net + clock stops' : d.route === 'tf' ? 'technical report; opinion only after objections' : 'no novel-food assessment');
  const q = s.quality;
  let tl = null;
  if (d.route === 'art10' || d.route === 'tf') { tl = timeline(d.route, q); ro.set('time', `${fmt(tl.q[1], 0)} mo`, tl.q[1] > 36 ? 'bad' : tl.q[1] > 18 ? 'warn' : 'ok', `median; P10–P90 ${fmt(tl.q[0], 0)}–${fmt(tl.q[2], 0)} months · success ${fmt(100 * tl.p, 0)} %`); }
  else if (d.route === 'consult') ro.set('time', '≤ 4 + 4 mo', 'warn', 'then the route depends on the outcome');
  else if (d.route === 'listed-dp') ro.set('time', '≤ 5 years', 'warn', 'until protection ends — or your own dossier');
  else if (d.route === 'other') ro.set('time', 'other', 'bad', 'separate procedure, not modelled here');
  else ro.set('time', 'now', 'ok', 'no pre-market authorisation');
  ro.set('dp', d.route === 'art10' ? (s.dpreq ? '5 years' : 'Not requested') : d.route === 'tf' ? 'None' : d.route === 'listed-dp' ? "Competitor's" : '—', d.route === 'art10' && s.dpreq ? 'ok' : d.route === 'listed-dp' ? 'warn' : null, d.route === 'art10' ? 'Art. 26: proprietary data, exclusive right of reference' : d.route === 'tf' ? 'Art. 26(3) excludes traditional foods' : d.route === 'listed-dp' ? 'end date in the Union-list entry (Art. 27)' : 'not applicable');
  ro.set('label', d.status === 'novel' ? 'FIC + entry' : d.route === 'other' ? 'Own regime' : 'FIC', null, d.status === 'novel' && d.cats.has('v') ? 'designation + allergy statement' : d.status === 'novel' && d.cats.has('vi') && s.cat === 'vi' ? 'designation; meat terms not allowed' : d.status === 'novel' ? 'designation in the Union list' : 'Regulation (EU) No 1169/2011');
  renderStrategy(d, s, tl);
  drawCharts(d, s, tl);
  if (!document.querySelector('.nf-node.sel')) showInfo(d.path[d.path.length - 1]);
}
function renderStrategy(d, s, tl) {
  const c = CASES.find(x => x.id === s.case);
  const name = c ? c.title : 'My product';
  const tlText = tl ? `Median ${fmt(tl.q[1], 0)} months from submission (80 % of authorisations within ${fmt(tl.q[0], 0)}–${fmt(tl.q[2], 0)} months); probability of success about ${fmt(100 * tl.p, 0)} % with a${s.quality === 'avg' ? 'n average' : s.quality === 'good' ? 'n excellent' : ' weak'} dossier (model calibrated on 2018–2024 procedures).` : d.route === 'consult' ? 'The Member State decides within 4 months of validity, extendable by at most 4 months (IR 2018/456, Art. 6).' : d.route === 'listed-dp' ? 'Earliest free entry: the end date of data protection in the Union-list entry (five years after authorisation).' : d.route === 'other' ? 'Depends on the regime (not modelled here).' : 'No authorisation procedure — market as soon as general food law is met.';
  const legal = d.route === 'art10' ? 'Legal clocks: forwarding ≤ 1 month after validity, EFSA 9 months net (+ clock stops), Commission draft ≤ 7 months after publication of the opinion, PAFF vote, entry into force on the 20th day.' : d.route === 'tf' ? 'Legal clocks: forwarding ≤ 1 month after validity, 4-month objection window, authorisation "without delay" (Art. 15).' : '';
  const html = `<div class="nfn-strat-head"><div><div class="nfn-note-k">Regulatory strategy</div><h3>${name}</h3></div><span class="nfn-pill route-${d.route}">${d.routeText}</span></div>
    <div class="nfn-strat-grid">
      <section><h4>1 · Classification</h4><ol>${d.why.map(w => `<li>${w}</li>`).join('')}</ol></section>
      <section><h4>2 · Dossier</h4><ul>${dossier(d, s).map(x => `<li>${x}</li>`).join('')}</ul></section>
      <section><h4>3 · Indicative timeline</h4><p>${tlText}</p>${legal ? `<p class="nfn-muted">${legal}</p>` : ''}${d.route === 'art10' || d.route === 'tf' ? '<p><a href="/laboratories/authorisation-timeline/">Simulate this in the Authorisation timeline simulator →</a></p>' : ''}</section>
      <section><h4>4 · Labelling</h4><ul>${labelling(d, s).map(x => `<li>${x}</li>`).join('')}</ul></section>
      <section><h4>5 · Data protection and competitors</h4><p>${d.route === 'art10' ? (s.dpreq ? 'Request data protection for proprietary studies: if granted, competitors cannot rely on your data for five years and the Union-list entry names you (Arts 26–27). A rival with its own full dossier can still enter.' : 'Without data protection, the authorisation is generic from day one: competitors may copy the specification immediately.') : d.route === 'tf' ? 'Traditional foods cannot receive data protection (Art. 26(3)): once authorised, anyone meeting the specification may market the food.' : d.route === 'listed-dp' ? 'A competitor\'s data are protected: check the end date in the entry.' : d.route === 'listed' ? 'The entry is generic — your competitors can use it too; differentiate on quality, price and brand.' : 'Not applicable.'}</p></section>
      <section><h4>6 · Check before you start</h4><ul><li>${A(ELI.union, 'Union list of novel foods')} and its amendments</li><li>${A(ELI.consult, 'Published consultation outcomes')}</li><li>${A(ELI.summaries, 'Summaries of pending applications and notifications')}</li><li>${A(ELI.reg, 'Regulation (EU) 2015/2283')} · ${A(ELI.efsa, 'EFSA 2024 guidance')}</li></ul></section>
    </div>`;
  $('#nfn-strategy').innerHTML = html;
}
function strategyMarkdown() {
  const el = $('#nfn-strategy'); const lines = [];
  el.querySelectorAll('h3, h4, li, p, .nfn-pill').forEach(n => {
    let t; if (n.tagName === 'LI') { const c = n.cloneNode(true); c.querySelectorAll('ol, ul').forEach(x => x.remove()); t = c.textContent; } else t = n.textContent;
    t = t.replace(/\s+/g, ' ').trim(); if (!t) return;
    const nested = n.tagName === 'LI' && n.parentElement.closest('li');
    if (n.tagName === 'H3') lines.push('# Regulatory strategy — ' + t); else if (n.tagName === 'H4') lines.push('\n## ' + t); else if (n.tagName === 'LI') lines.push((nested ? '    - ' : '- ') + t); else if (n.classList.contains('nfn-pill')) lines.push('**Route:** ' + t); else lines.push(t);
  });
  lines.push('\n_Generated with the Novel food navigator (Future Food Production), ' + new Date().toLocaleDateString('en-GB') + '. Based on Regulation (EU) 2015/2283 as of 2026; not legal advice._');
  return lines.join('\n');
}
function copyStrategy() { const md = strategyMarkdown(); (navigator.clipboard ? navigator.clipboard.writeText(md) : Promise.reject()).then(() => window.FFP && FFP.toast && FFP.toast('Strategy copied as Markdown'), () => downloadStrategy()); }
function downloadStrategy() { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([strategyMarkdown()], { type: 'text/markdown' })); a.download = 'regulatory-strategy.md'; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 300); }

/* charts */
const cdf = new Plot('#chart-cdf', { x: { label: 'Months after submission', min: 0, max: 72 }, y: { label: 'Probability of being authorised', unit: '%', min: 0, max: 100 }, legend: true });
const legalBars = new BarChart('#chart-legal', { horizontal: true, stacked: true, y: { label: 'Months', min: 0 }, height: 230 });
const libChart = new BarChart('#chart-lib', { y: { label: 'Number of cases', min: 0 }, height: 250 });
/* verified procedure dates (recitals of the acts; Lesson 14.1 for chia and UV mushrooms) */
const DUR = [
  ['Stevia leaves (refused)', '1997-11-05', '2000-02-22', 'old'], ['Chia seeds', '2003-06-30', '2009-10-13', 'old'], ['Baobab fruit pulp', '2006-08-09', '2008-06-27', 'old'],
  ['Rapeseed protein', '2012-06-25', '2014-07-01', 'old'], ['UV-treated mushrooms', '2016-06-10', '2017-12-14', 'old'], ['Haskap berries', '2018-01-26', '2018-12-13', 'tf'],
  ['Coffee-leaf infusion', '2018-11-27', '2020-07-01', 'tf'], ['Fresh Wolffia', '2020-09-07', '2021-12-10', 'tf'], ['Dried mealworm', '2018-02-13', '2021-06-01', 'art10'],
  ['Bovine β-lactoglobulin', '2020-07-22', '2022-12-21', 'art10'], ['Defatted cricket powder', '2019-07-24', '2023-01-03', 'art10'], ['Apple cell culture', '2020-04-14', '2023-12-20', 'art10'], ['Lemna plants', '2020-05-20', '2025-01-29', 'art10']
];
const durChart = new BarChart('#chart-dur', { horizontal: true, y: { label: 'Months', min: 0 }, height: 330, legend: false });
durChart.set(DUR.map(d => d[0]), [{ label: 'Months', values: DUR.map(d => (Date.parse(d[2]) - Date.parse(d[1])) / 864e5 / MONTH), colors: DUR.map(d => d[3] === 'old' ? 'muted' : d[3] === 'tf' ? 'magenta' : 'water'), format: v => fmt(v, 0) }]);
function curve(all) { const xs = [], ys = []; for (let m = 0; m <= 72; m += 1) { xs.push(m); let k = 0; while (k < all.length && all[k] <= m) k++; ys.push(100 * k / all.length); } return [xs, ys]; }
function drawCharts(d, s, tl) {
  cdf.clear();
  const q = s.quality;
  const art = d.route === 'art10' ? tl : timeline('art10', q), tf = d.route === 'tf' ? tl : timeline('tf', q);
  const [xa, ya] = curve(art.all), [xt, yt] = curve(tf.all);
  const eligible = d.route === 'tf' || d.eligible;
  if (d.route === 'art10' || d.route === 'tf') {
    cdf.line('art', xa, ya, { color: 'water', width: d.route === 'art10' ? 3 : 1.6, dash: d.route === 'art10' ? null : [5, 4], label: 'Article 10 application' + (d.route === 'art10' ? ' (your route)' : '') });
    if (eligible) cdf.line('tf', xt, yt, { color: 'magenta', width: d.route === 'tf' ? 3 : 1.6, dash: d.route === 'tf' ? null : [5, 4], label: 'Traditional-food notification' + (d.route === 'tf' ? ' (your route)' : '') });
    cdf.vline('legal', d.route === 'tf' ? 5 : 19, { color: 'muted', label: 'legal minimum', dash: [3, 4] });
  } else if (d.route === 'consult') {
    cdf.region('c1', 0, 4, { color: 'amber', alpha: 0.22, label: 'consultation' }); cdf.region('c2', 4, 8, { color: 'amber', alpha: 0.1, label: '+ extension' });
    cdf.line('art', xa.map(x => x + 4), ya, { color: 'water', width: 1.8, dash: [5, 4], label: 'if novel → Art. 10 (after 4 months)' });
  } else {
    cdf.line('now', [0, 0.01, 72], [0, 100, 100], { color: 'accent', width: 3, label: d.route === 'listed-dp' ? 'listed — but protected (see strategy)' : d.route === 'other' ? 'another regime (not modelled)' : 'no novel-food authorisation needed' });
  }
  // legal clock vs typical
  if (d.route === 'tf') legalBars.set(['Legal (no objection)', 'Typical (7 real cases)'], [{ label: 'Validity + forwarding', color: 'accent', values: [1, 3.4] }, { label: 'Objection window', color: 'magenta', values: [4, 4] }, { label: 'Commission adopts', color: 'water', values: [0, 5.1] }, { label: 'Entry into force', color: 'c4', values: [0.7, 0.7] }]);
  else legalBars.set(['Legal timetable', 'Typical (means)'], [{ label: 'Validity checks', color: 'accent', values: [1, 9.8] }, { label: 'EFSA running clock', color: 'water', values: [9, 9.1] }, { label: 'Clock stops', color: 'amber', values: [0, 11.6] }, { label: 'Publication', color: 'muted', values: [1.6, 1.6] }, { label: 'Commission + PAFF', color: 'magenta', values: [7, 9.5] }, { label: 'Entry into force', color: 'c4', values: [0.7, 0.7] }]);
  $('#legal-title').textContent = d.route === 'tf' ? 'Traditional-food notification: legal clock vs reality' : 'Article 10 application: legal clock vs reality';
}

/* ============================================================ case library */
const store = { get() { try { return JSON.parse(localStorage.getItem('ffp-nfn-answers') || '{}'); } catch (e) { return {}; } }, set(v) { try { localStorage.setItem('ffp-nfn-answers', JSON.stringify(v)); } catch (e) { } } };
let answers = store.get();
function renderLibrary() {
  const grid = $('#nfn-grid');
  grid.innerHTML = CASES.map((c, i) => {
    const a = answers[c.id]; const rev = a && a.revealed;
    return `<article class="nfn-card ${rev ? (a.pick === c.ans ? 'right' : 'wrong') : ''}" data-id="${c.id}">
      <div class="nfn-card-top"><span class="nfn-num">${String(i + 1).padStart(2, '0')}</span><span class="nfn-tag">${c.tag}</span></div>
      <h3>${c.title}</h3><p class="nfn-teaser">${c.teaser}</p>
      <div class="nfn-choices" role="group" aria-label="Your classification">${Object.entries(ROUTE_LABEL).map(([k, l]) => `<button type="button" class="nfn-ch${a && a.pick === k ? ' picked' : ''}${rev && k === c.ans ? ' correct' : ''}" data-k="${k}" ${rev ? 'disabled' : ''}>${l}</button>`).join('')}</div>
      <div class="nfn-actions"><button type="button" class="btn btn-sm btn-primary" data-act="reveal" ${!a || rev ? 'disabled' : ''}>Reveal</button><button type="button" class="btn btn-sm" data-act="path">Show path</button></div>
      <div class="nfn-verdict" ${rev ? '' : 'hidden'}>${rev ? verdictHTML(c, a) : ''}</div>
    </article>`;
  }).join('');
  const done = CASES.filter(c => answers[c.id] && answers[c.id].revealed), right = done.filter(c => answers[c.id].pick === c.ans).length;
  $('#nfn-score').innerHTML = `<b>${right}</b> of ${done.length} correct · ${CASES.length - done.length} to go <button type="button" class="btn btn-sm btn-ghost" id="nfn-reset">Reset</button>`;
  $('#nfn-reset').onclick = () => { answers = {}; store.set(answers); renderLibrary(); };
  // library chart: correct route of each case, and your correct answers
  const keys = Object.keys(ROUTE_LABEL);
  libChart.set(['Other regime', 'Not novel', 'On Union list', 'Art. 10', 'Traditional food'], [
    { label: 'Cases', color: 'water', values: keys.map(k => CASES.filter(c => c.ans === k).length) },
    { label: 'You classified correctly', color: 'accent', values: keys.map(k => CASES.filter(c => c.ans === k && answers[c.id] && answers[c.id].revealed && answers[c.id].pick === c.ans).length) }
  ]);
}
function verdictHTML(c, a) {
  const ok = a.pick === c.ans;
  return `<div class="nfn-v-head ${ok ? 'ok' : 'no'}">${ok ? '✓ Correct' : '✗ Not quite'} — ${ROUTE_LABEL[c.ans]}</div><p>${c.v}</p><p class="nfn-links">${c.src.map(([h, l]) => A(h, l)).join(' · ')}</p>`;
}
$('#nfn-grid').addEventListener('click', e => {
  const card = e.target.closest('.nfn-card'); if (!card) return; const id = card.dataset.id; const c = CASES.find(x => x.id === id);
  const ch = e.target.closest('.nfn-ch');
  if (ch && !ch.disabled) { answers[id] = { pick: ch.dataset.k, revealed: false }; store.set(answers); card.querySelectorAll('.nfn-ch').forEach(b => b.classList.toggle('picked', b === ch)); card.querySelector('[data-act=reveal]').disabled = false; return; }
  const act = e.target.closest('[data-act]'); if (!act) return;
  if (act.dataset.act === 'reveal' && answers[id]) { answers[id].revealed = true; store.set(answers); renderLibrary(); const nc = document.querySelector(`.nfn-card[data-id="${id}"]`); nc && nc.classList.add('flash'); }
  if (act.dataset.act === 'path') { loadCase(id); stageEl.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }); }
});

/* ============================================================ wiring */
ui.onChange((st, id) => {
  if (loading) return;
  if (id === 'case') { if (st.case !== 'custom') { loadCase(st.case); return; } }
  else if (id && !['quality', 'dpreq', 'choice'].includes(id) && st.case !== 'custom') { const c = CASES.find(x => x.id === st.case); if (c && Object.keys(c.s).includes(id) && c.s[id] !== st[id]) ui.set('case', 'custom', true); }
  cancelAnimationFrame(raf); raf = requestAnimationFrame(update);
});
if (ui.get('case') && ui.get('case') !== 'custom' && !location.search) loadCase(ui.get('case')); else update();
renderLibrary();
