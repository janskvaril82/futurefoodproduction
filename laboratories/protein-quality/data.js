/* Protein-quality database for the laboratory "Protein quality calculator".
   Every number below is transcribed from the cited primary source (see the Assumptions & sources tab).
   Amino-acid order in the raw arrays (11 values):  His, Ile, Leu, Lys, Met, Cys, Phe, Tyr, Thr, Trp, Val
   unit:  'asfed' → g amino acid per 100 g ingredient as fed, with cp = crude protein (N × 6.25) in g per 100 g as fed
          'pctcp' → g amino acid per 100 g crude protein (INRA–CIRAD–AFZ tables), cp = g protein per 100 g as fed
          'gkgdm' → g amino acid per kg dry matter, with cpdm = g crude protein per kg dry matter
   sid:   standardised ileal digestibility (%) of each amino acid measured in growing pigs (≈ true ileal digestibility,
          the FAO (2013) preferred animal model), unless stated otherwise in `method`.
   tdf:   faecal (total-tract) crude-protein digestibility used for PDCAAS, with its own source note.            */

export const AA11 = ['His', 'Ile', 'Leu', 'Lys', 'Met', 'Cys', 'Phe', 'Tyr', 'Thr', 'Trp', 'Val'];
export const IAA = ['His', 'Ile', 'Leu', 'Lys', 'SAA', 'AAA', 'Thr', 'Trp', 'Val'];
export const IAA_LONG = ['Histidine', 'Isoleucine', 'Leucine', 'Lysine', 'Sulfur AA (Met + Cys)', 'Aromatic AA (Phe + Tyr)', 'Threonine', 'Tryptophan', 'Valine'];

/* FAO (2013) Table 5: recommended amino-acid scoring patterns, mg per g protein.
   PDCAAS (FAO/WHO 1991) historically used the FAO/WHO/UNU (1985) pre-school child pattern; here PDCAAS is
   computed with the same pattern as DIAAS so that the two methods can be compared like for like (as Mathai et al. 2017 did). */
export const PATTERNS = {
  infant: { label: 'Infant (0–6 months)', short: 'infant 0–6 mo', r: [21, 55, 96, 69, 33, 94, 44, 17, 55] },
  child: { label: 'Young child (6 months–3 years)', short: 'child 6 mo–3 y', r: [20, 32, 66, 57, 27, 52, 31, 8.5, 43] },
  older: { label: 'Older child, adolescent, adult', short: 'older child/adult', r: [16, 30, 61, 48, 23, 41, 25, 6.6, 40] }
};

export const GROUPS = {
  legume: 'Legume', cereal: 'Cereal', tuber: 'Tuber & oilseed', microbial: 'Fungal & algal', insect: 'Insect', animal: 'Animal'
};

export const SOURCES = [
  { id: 'pea', label: 'Pea protein concentrate', group: 'legume', plant: true,
    form: 'commercial pea protein concentrate', cp: 54.46, unit: 'asfed',
    aa: [1.43, 2.31, 4.04, 4.11, 0.49, 0.63, 2.70, 1.79, 1.95, 0.48, 2.61],
    sid: [95, 91, 92, 96, 90, 75, 92, 93, 88, 87, 89],
    tdf: 0.94, tdfNote: 'standardised total-tract CP digestibility, pigs (Mathai et al., 2017)',
    method: 'Growing pigs, SID of each AA', ref: 'Mathai et al. (2017)', check: 'published DIAAS 62 (child) / 73 (older)' },
  { id: 'faba', label: 'Faba bean (whole seed)', group: 'legume', plant: true,
    form: 'faba bean, white-flowered (low-tannin) seed', cp: 26.7, unit: 'pctcp',
    aa: [2.5, 4.1, 7.6, 6.4, 0.7, 1.3, 4.2, 3.2, 3.6, 0.8, 4.5],
    sid: [89, 84, 87, 89, 86, 77, 87, 85, 84, 75, 83],
    tdf: 0.834, tdfNote: 'total-tract N digestibility, growing pigs (INRA–CIRAD–AFZ)',
    method: 'Growing pigs, SID of each AA (feed-table means)', ref: 'INRA–CIRAD–AFZ feed tables (Sauvant et al., 2004)', check: 'Herreman et al. (2020) mean DIAAS 55 (child)' },
  { id: 'soy', label: 'Soy protein isolate', group: 'legume', plant: true,
    form: 'commercial soy protein isolate', cp: 92.66, unit: 'asfed',
    aa: [2.41, 4.38, 7.38, 5.69, 1.18, 1.06, 4.86, 3.31, 3.35, 1.30, 4.42],
    sid: [97, 95, 95, 97, 96, 91, 96, 96, 92, 96, 94],
    tdf: 0.96, tdfNote: 'standardised total-tract CP digestibility, pigs (Mathai et al., 2017)',
    method: 'Growing pigs, SID of each AA', ref: 'Mathai et al. (2017)', check: 'published DIAAS 84 (child) / 98 (older)' },
  { id: 'wheat', label: 'Wheat (whole grain)', group: 'cereal', plant: true,
    form: 'whole-grain wheat', cp: 11.67, unit: 'asfed',
    aa: [0.30, 0.39, 0.78, 0.39, 0.21, 0.25, 0.52, 0.24, 0.34, 0.12, 0.52],
    sid: [85, 86, 86, 77, 88, 86, 87, 90, 80, 74, 83],
    tdf: 0.86, tdfNote: 'standardised total-tract CP digestibility, pigs (Mathai et al., 2017)',
    method: 'Growing pigs, SID of each AA', ref: 'Mathai et al. (2017)', check: 'published DIAAS 45 (child) / 54 (older)' },
  { id: 'rice', label: 'Rice (polished, white)', group: 'cereal', plant: true,
    form: 'polished white rice', cp: 9.0, unit: 'asfed',
    aa: [0.21, 0.35, 0.66, 0.30, 0.21, 0.19, 0.42, 0.23, 0.27, 0.07, 0.49],
    sid: [91.39, 92.30, 93.84, 92.41, 94.66, 94.35, 95.29, 92.19, 90.64, 94.70, 94.34],
    tdf: 0.88, tdfNote: 'true digestibility of milled rice in humans (FAO/WHO/UNU, 1985)',
    method: 'Growing pigs, SID of each AA', ref: 'Cervantes-Pahm et al. (2014)', check: 'published DIAAS 64 (older)' },
  { id: 'oat', label: 'Oats (dehulled)', group: 'cereal', plant: true,
    form: 'dehulled oats', cp: 13.1, unit: 'asfed',
    aa: [0.32, 0.51, 0.98, 0.57, 0.23, 0.40, 0.66, 0.38, 0.43, 0.10, 0.71],
    sid: [88.11, 86.52, 87.24, 84.51, 89.95, 77.44, 88.38, 80.73, 81.30, 81.88, 84.66],
    tdf: 0.86, tdfNote: 'true digestibility of oatmeal in humans (FAO/WHO/UNU, 1985)',
    method: 'Growing pigs, SID of each AA', ref: 'Cervantes-Pahm et al. (2014)', check: 'published DIAAS 77 (older)' },
  { id: 'maize', label: 'Maize (yellow dent)', group: 'cereal', plant: true,
    form: 'yellow dent maize grain', cp: 7.5, unit: 'asfed',
    aa: [0.19, 0.23, 0.71, 0.23, 0.14, 0.14, 0.29, 0.19, 0.23, 0.05, 0.32],
    sid: [82.99, 76.09, 84.33, 74.58, 89.54, 77.25, 83.15, 79.85, 70.45, 69.65, 75.37],
    tdf: 0.85, tdfNote: 'true digestibility of whole maize in humans (FAO/WHO/UNU, 1985)',
    method: 'Growing pigs, SID of each AA', ref: 'Cervantes-Pahm et al. (2014)', check: 'published DIAAS 48 (older)' },
  { id: 'potato', label: 'Potato protein concentrate', group: 'tuber', plant: true,
    form: 'heat-coagulated potato protein concentrate', cp: 77.2, unit: 'pctcp',
    aa: [2.1, 5.6, 10.0, 7.6, 2.2, 1.4, 6.3, 5.3, 5.6, 1.4, 6.6],
    sid: [89, 89, 91, 89, 91, 78, 91, 89, 90, 75, 89],
    tdf: 0.97, tdfNote: 'total-tract N digestibility, growing pigs (INRA–CIRAD–AFZ)',
    method: 'Growing pigs, SID of each AA (feed-table means)', ref: 'INRA–CIRAD–AFZ feed tables (Sauvant et al., 2004)', check: 'Herreman et al. (2020) mean DIAAS 100 (child)' },
  { id: 'rapeseed', label: 'Rapeseed meal (defatted)', group: 'tuber', plant: true,
    form: 'rapeseed meal, oil < 5 % (feed grade)', cp: 33.9, unit: 'pctcp',
    aa: [2.7, 4.0, 6.8, 5.3, 2.0, 2.4, 3.9, 2.8, 4.3, 1.2, 5.1],
    sid: [84, 78, 82, 75, 87, 81, 83, 80, 75, 80, 77],
    tdf: 0.766, tdfNote: 'total-tract N digestibility, growing pigs (INRA–CIRAD–AFZ)',
    method: 'Growing pigs, SID of each AA (feed-table means)', ref: 'INRA–CIRAD–AFZ feed tables (Sauvant et al., 2004)', check: 'Herreman et al. (2020) mean DIAAS 67 (child); food-grade heated isolates reach 94–98 % digestibility (Stein, 2024)' },
  { id: 'myco', label: 'Mycoprotein (F. venenatum)', group: 'microbial', plant: false, nonAnimal: true,
    form: 'ABUNDA® mycoprotein biomass (wet)', cp: 11.0, unit: 'group',
    /* Digestible IAA = in vitro DIAA reference ratios (child pattern) of Ariëns et al. (2026) × FAO child pattern.
       Total contents are back-calculated with their in vitro total protein digestibility (ivTD 0.79), i.e. a uniform
       digestibility is assumed — the published data give digestible amounts only. */
    ratiosChild: [1.03, 1.51, 1.13, 1.16, 0.83, 1.31, 1.50, 1.48, 1.30], dUniform: 0.79,
    tdf: 0.86, tdfNote: 'estimated true protein digestibility in ileostomates (Edwards & Cummings, 2010)',
    method: 'In vitro (INFOGEST) ivDIAAS; composition inferred', ref: 'Ariëns et al. (2026); Edwards & Cummings (2010)', check: 'published ivDIAAS 83 (child) / 97 (older); PDCAAS 0.99–1.00 reported in vivo', inferred: true,
    cpNote: 'protein content of Quorn-type mycoprotein paste, 11 g per 100 g wet weight (Finnigan et al., 2019)' },
  { id: 'spirulina', label: 'Spirulina (dried)', group: 'microbial', plant: false, nonAnimal: true,
    form: 'Arthrospira, dried powder', cp: 57.47, unit: 'asfed',
    aa: [1.085, 3.209, 4.947, 3.025, 1.149, 0.662, 2.777, 2.584, 2.97, 0.929, 3.512],
    sid: Array(11).fill(82.8),
    tdf: 0.86, tdfNote: 'real faecal N digestibility, rats (Tessier et al., 2021)',
    method: 'Composition USDA FoodData Central; mean caecal AA digestibility in rats (82.8 %) applied to all AA', ref: 'USDA (2019) FDC 170495; Tessier et al. (2021)', check: 'Tessier et al.: PDCAAS 0.84, His limiting (chemical score 0.98)' },
  { id: 'mealworm', label: 'Yellow mealworm (dried)', group: 'insect', plant: false, nonAnimal: true,
    form: 'Tenebrio molitor larvae, dried powder', cp: 50.4 * 0.952, cpdm: 504, unit: 'gkgdm',
    aa: [14.1, 26.3, 36.8, 24.5, 6.0, 3.7, 17.5, 35.3, 19.4, 5.5, 33.0],
    sid: [80.6, 79.4, 83.9, 80.9, 85.1, 63.2, 84.2, 96.3, 77.6, 81.0, 81.2],
    tdf: 0.717, tdfNote: 'SID of crude protein used as proxy — faecal digestibility not reported (Malla et al., 2022)',
    method: 'Growing pigs, SID of each AA (N × 6.25)', ref: 'Malla et al. (2022)', check: 'published DIAAS 54 (child) / 64 (older)' },
  { id: 'cricket', label: 'House cricket (dried)', group: 'insect', plant: false, nonAnimal: true,
    form: 'Acheta domesticus, dried powder', cp: 68.1 * 0.960, cpdm: 681, unit: 'gkgdm',
    aa: [14.8, 32.8, 55.1, 36.1, 10.6, 5.4, 20.4, 32.6, 23.0, 6.1, 41.1],
    sid: [82.0, 81.7, 86.2, 90.1, 92.2, 78.7, 89.9, 96.7, 83.3, 85.3, 79.3],
    tdf: 0.751, tdfNote: 'SID of crude protein used as proxy — faecal digestibility not reported (Malla et al., 2022)',
    method: 'Growing pigs, SID of each AA (N × 6.25)', ref: 'Malla et al. (2022)', check: 'published DIAAS 76 (child) / 89 (older)' },
  { id: 'egg', label: 'Egg (boiled)', group: 'animal', plant: false,
    form: 'whole hen egg, boiled', cp: 13.27, unit: 'asfed',
    aa: [0.34, 0.79, 1.19, 1.04, 0.47, 0.36, 0.79, 0.49, 0.64, 0.22, 0.91],
    sid: [85.4, 91.5, 92.4, 87.2, 92.6, 85.0, 92.4, 89.9, 87.0, 89.6, 91.4],
    tdf: 0.97, tdfNote: 'true digestibility of egg in humans (FAO/WHO/UNU, 1985)',
    method: 'Growing pigs, SID of each AA', ref: 'Fanelli et al. (2024)', check: 'published DIAAS 110 (child) / 135 (older)' },
  { id: 'milk', label: 'Milk (skimmed milk powder)', group: 'animal', plant: false,
    form: 'skimmed milk powder', cp: 34.65, unit: 'asfed',
    aa: [1.07, 1.80, 3.47, 2.90, 0.83, 0.26, 1.70, 1.61, 1.50, 0.54, 2.27],
    sid: [94, 89, 94, 95, 96, 73, 94, 95, 82, 91, 90],
    tdf: 0.96, tdfNote: 'standardised total-tract CP digestibility, pigs (Mathai et al., 2017)',
    method: 'Growing pigs, SID of each AA', ref: 'Mathai et al. (2017)', check: 'published DIAAS 105 (child) / 123 (older)' },
  { id: 'whey', label: 'Whey protein isolate', group: 'animal', plant: false,
    form: 'whey protein isolate', cp: 85.23, unit: 'asfed',
    aa: [1.71, 5.95, 9.91, 8.64, 1.94, 2.14, 2.85, 2.60, 6.58, 1.83, 5.29],
    sid: [100, 98, 99, 98, 98, 98, 98, 99, 94, 100, 97],
    tdf: 0.96, tdfNote: 'standardised total-tract CP digestibility, pigs (Mathai et al., 2017)',
    method: 'Growing pigs, SID of each AA', ref: 'Mathai et al. (2017)', check: 'published DIAAS 100 (child) / 125 (older)' },
  { id: 'beef', label: 'Beef (rib-eye roast)', group: 'animal', plant: false,
    form: 'beef rib-eye roast cooked to 64 °C', cp: 26.42, unit: 'asfed',
    aa: [0.93, 1.41, 2.24, 2.47, 0.74, 0.31, 1.15, 1.14, 1.22, 0.33, 1.45],
    sid: [95.9, 96.0, 96.1, 96.2, 96.6, 87.8, 95.3, 96.4, 94.1, 94.8, 94.7],
    tdf: 0.94, tdfNote: 'true digestibility of meat in humans (FAO/WHO/UNU, 1985)',
    method: 'Growing pigs, SID of each AA', ref: 'Bailey et al. (2020)', check: 'published DIAAS 121 (child) / 130 (older)' }
];

/* Derive, for every source: c = total IAA content (mg g⁻¹ protein, 9 groups), dig = digestible IAA content,
   d = effective ileal digestibility per group, x = protein content (g g⁻¹ as used). */
export function prepare(src) {
  let c, dig;
  if (src.unit === 'group') {
    dig = src.ratiosChild.map((q, i) => q * PATTERNS.child.r[i]);
    c = dig.map(v => v / src.dUniform);
  } else {
    const mg = src.aa.map(v => src.unit === 'asfed' ? v / src.cp * 1000 : src.unit === 'pctcp' ? v * 10 : v / src.cpdm * 1000);
    const d = src.sid.map(s => s / 100);
    c = [mg[0], mg[1], mg[2], mg[3], mg[4] + mg[5], mg[6] + mg[7], mg[8], mg[9], mg[10]];
    dig = [mg[0] * d[0], mg[1] * d[1], mg[2] * d[2], mg[3] * d[3], mg[4] * d[4] + mg[5] * d[5], mg[6] * d[6] + mg[7] * d[7], mg[8] * d[8], mg[9] * d[9], mg[10] * d[10]];
  }
  const d = dig.map((v, i) => v / c[i]);
  const dMean = dig.reduce((a, b) => a + b, 0) / c.reduce((a, b) => a + b, 0);
  return Object.assign(src, { c, dig, d, dMean, x: src.cp / 100 });
}
SOURCES.forEach(prepare);
export const BY_ID = Object.fromEntries(SOURCES.map(s => [s.id, s]));
