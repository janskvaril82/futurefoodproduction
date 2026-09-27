/* Nutrient-solution mixer — chemistry core (no DOM).
   Units: ions in mmol L⁻¹ (micronutrients in µmol L⁻¹), masses in g, volumes in L.
   Sources: fertiliser compositions and nutrient contents after Sonneveld & Voogt (2009) and van der Lugt (2016);
   standard recipes after van der Lugt (2016) and Brechner & Both (2013); conductivity after APHA Standard Methods 2510;
   solubility products after Lindsay (1979); solubilities after Haynes (2014). */
import { carbonateSpecies, phosphateSpecies } from '../../assets/js/physics.js';

/* ---------------------------------------------------------------- ions */
export const IONS = {
  NH4: { label: 'NH₄⁺', z: 1, M: 18.04, elem: 'N', Me: 14.007 },
  K: { label: 'K⁺', z: 1, M: 39.098, elem: 'K', Me: 39.098 },
  Ca: { label: 'Ca²⁺', z: 2, M: 40.078, elem: 'Ca', Me: 40.078 },
  Mg: { label: 'Mg²⁺', z: 2, M: 24.305, elem: 'Mg', Me: 24.305 },
  Na: { label: 'Na⁺', z: 1, M: 22.990, elem: 'Na', Me: 22.990 },
  NO3: { label: 'NO₃⁻', z: -1, M: 62.004, elem: 'N', Me: 14.007 },
  H2PO4: { label: 'H₂PO₄⁻', z: -1, M: 96.99, elem: 'P', Me: 30.974 },
  SO4: { label: 'SO₄²⁻', z: -2, M: 96.06, elem: 'S', Me: 32.06 },
  Cl: { label: 'Cl⁻', z: -1, M: 35.45, elem: 'Cl', Me: 35.45 },
  HCO3: { label: 'HCO₃⁻', z: -1, M: 61.017, elem: 'HCO₃', Me: 61.017 }
};
export const CATIONS = ['NH4', 'K', 'Ca', 'Mg', 'Na'];
export const ANIONS = ['NO3', 'H2PO4', 'SO4', 'Cl', 'HCO3'];
export const MICRO = { Fe: 55.845, Mn: 54.938, Zn: 65.38, B: 10.81, Cu: 63.546, Mo: 95.95 };

/* ---------------------------------------------------------------- fertilisers
   per: ions supplied per "unit" of the fertiliser (mmol ion per mmol unit); Munit: g per mol of unit.
   Commercial calcium nitrate 5Ca(NO₃)₂·NH₄NO₃·10H₂O (1080.6 g mol⁻¹) is handled per mol Ca (1/5 formula = 216.1 g).
   sol: approximate solubility, g of product per L of water at 20 °C (null = not limiting in practice). */
export const FERTS = {
  CN: { name: 'Calcium nitrate (commercial)', formula: '5Ca(NO₃)₂·NH₄NO₃·10H₂O', Munit: 1080.6 / 5, per: { Ca: 1, NO3: 2.2, NH4: 0.2 }, tank: 'A', sol: 1290, ca: true, note: 'per mol Ca: 216.1 g' },
  KNO3: { name: 'Potassium nitrate', formula: 'KNO₃', Munit: 101.10, per: { K: 1, NO3: 1 }, tank: 'AB', sol: 316 },
  NH4NO3: { name: 'Ammonium nitrate', formula: 'NH₄NO₃', Munit: 80.04, per: { NH4: 1, NO3: 1 }, tank: 'A', sol: 1920 },
  MgNO3: { name: 'Magnesium nitrate', formula: 'Mg(NO₃)₂·6H₂O', Munit: 256.41, per: { Mg: 1, NO3: 2 }, tank: 'A', sol: null },
  MKP: { name: 'Monopotassium phosphate', formula: 'KH₂PO₄', Munit: 136.09, per: { K: 1, H2PO4: 1 }, tank: 'B', sol: 226, p: true },
  MAP: { name: 'Monoammonium phosphate', formula: 'NH₄H₂PO₄', Munit: 115.03, per: { NH4: 1, H2PO4: 1 }, tank: 'B', sol: null, p: true, optional: true },
  MgSO4: { name: 'Magnesium sulfate (Epsom salt)', formula: 'MgSO₄·7H₂O', Munit: 246.47, per: { Mg: 1, SO4: 1 }, tank: 'B', sol: 1130, s: true },
  K2SO4: { name: 'Potassium sulfate', formula: 'K₂SO₄', Munit: 174.26, per: { K: 2, SO4: 1 }, tank: 'B', sol: 111, s: true },
  CaCl2: { name: 'Calcium chloride (anhydrous)', formula: 'CaCl₂', Munit: 110.98, per: { Ca: 1, Cl: 2 }, tank: 'A', sol: null, ca: true, optional: true },
  HNO3: { name: 'Nitric acid', formula: 'HNO₃', Munit: 63.01, per: { H: 1, NO3: 1 }, tank: 'B', acid: true, liquid: true },
  H3PO4: { name: 'Phosphoric acid', formula: 'H₃PO₄', Munit: 98.00, per: { H: 1, H2PO4: 1 }, tank: 'B', acid: true, liquid: true, p: true }
};
export const ACID_GRADES = {
  HNO3: { 38: { rho: 1.235 }, 60: { rho: 1.37 } },
  H3PO4: { 59: { rho: 1.42 }, 75: { rho: 1.574 }, 85: { rho: 1.685 } }
};
export const acidMolarity = (key, w) => 10 * w * ACID_GRADES[key][w].rho / FERTS[key].Munit;

/* micronutrient sources: fraction of element in product (van der Lugt 2016, Table 5) */
export const MICRO_SRC = {
  Fe: { EDTA: { name: 'Fe-EDTA 13 %', w: 0.13 }, DTPA: { name: 'Fe-DTPA 11 %', w: 0.11 }, DTPA6: { name: 'Fe-DTPA 6 %', w: 0.06 }, EDDHA: { name: 'Fe-EDDHA 6 %', w: 0.06 } },
  Mn: { SO4: { name: 'Manganese sulfate MnSO₄·H₂O', w: 0.325, M: 169.02, SO4: 1 }, EDTA: { name: 'Mn-EDTA 12.8 %', w: 0.128 } },
  Zn: { SO4: { name: 'Zinc sulfate ZnSO₄·7H₂O', w: 0.227, M: 287.56, SO4: 1 }, EDTA: { name: 'Zn-EDTA 14.8 %', w: 0.148 } },
  Cu: { SO4: { name: 'Copper sulfate CuSO₄·5H₂O', w: 0.2545, M: 249.69, SO4: 1 }, EDTA: { name: 'Cu-EDTA 14.8 %', w: 0.148 } },
  B: { BA: { name: 'Boric acid H₃BO₃', w: 0.175, M: 61.83 } },
  Mo: { NaMo: { name: 'Sodium molybdate Na₂MoO₄·2H₂O', w: 0.396, M: 241.95, Na: 2 } }
};

/* ---------------------------------------------------------------- recipes (target working solutions) */
export const RECIPES = {
  lettuceCornell: {
    label: 'Lettuce · Cornell DWC (EC ≈ 1.2)', src: 'Brechner & Both (2013), as in Lesson 5.2',
    ions: { NH4: 0.2, K: 5.5, Ca: 2.1, Mg: 1.0, NO3: 8.7, H2PO4: 1.0, SO4: 1.1, Cl: 0 },
    micro: { Fe: 17, Mn: 2.5, Zn: 2.0, B: 15, Cu: 0.4, Mo: 0.3 }, ec: 1.2, ph: 5.8
  },
  lettuceNL: {
    label: 'Lettuce · Dutch standard, water culture (EC 2.2)', src: 'van der Lugt (2016), after De Kreij et al. (1999)',
    ions: { NH4: 1.0, K: 9.5, Ca: 4.5, Mg: 1.0, NO3: 16, H2PO4: 1.5, SO4: 2.0, Cl: 0 },
    micro: { Fe: 40, Mn: 7, Zn: 7, B: 40, Cu: 1, Mo: 1 }, ec: 2.2, ph: 5.5
  },
  basilNL: {
    label: 'Basil & herbs · Dutch standard, water culture (EC 2.4)', src: 'van der Lugt (2016), after De Kreij et al. (1999)',
    ions: { NH4: 1.25, K: 6.75, Ca: 4.5, Mg: 3.0, NO3: 16.75, H2PO4: 1.25, SO4: 2.5, Cl: 0 },
    micro: { Fe: 25, Mn: 10, Zn: 5, B: 35, Cu: 1, Mo: 0.5 }, ec: 2.4, ph: 5.5
  },
  tomatoNL: {
    label: 'Tomato · Dutch standard, rock wool (EC 2.6)', src: 'van der Lugt (2016), after De Kreij et al. (1999)',
    ions: { NH4: 1.2, K: 9.5, Ca: 5.4, Mg: 2.4, NO3: 15.0, H2PO4: 1.5, SO4: 4.4, Cl: 1.0 },
    micro: { Fe: 15, Mn: 10, Zn: 5, B: 30, Cu: 0.75, Mo: 0.5 }, ec: 2.6, ph: 5.5
  }
};

/* ---------------------------------------------------------------- source waters (mg L⁻¹) — typical examples */
export const WATERS = {
  ro: { label: 'Rain / reverse-osmosis water', Ca: 0, Mg: 0, Na: 0, K: 0, Cl: 0, SO4: 0, HCO3: 0, pH: 6.0 },
  soft: { label: 'Soft Swedish surface water (Lake Mälaren, Norrvatten 2025 mean)', Ca: 34, Mg: 4.9, Na: 13, K: 2.9, Cl: 16, SO4: 50, HCO3: 70, pH: 8.2 },
  hard: { label: 'Hard Swedish groundwater (esker, Uppsala Vatten, Vänge 2022)', Ca: 110, Mg: 15, Na: 46, K: 0, Cl: 51, SO4: 53, HCO3: 349, pH: 7.3 },
  softened: { label: 'Ion-exchange softened tap water (Vänge, at the tap 2022)', Ca: 3.1, Mg: 0.5, Na: 190, K: 0, Cl: 51, SO4: 53, HCO3: 362, pH: 7.4 }
};
export function waterMmol(w) {
  return { Ca: w.Ca / IONS.Ca.M, Mg: w.Mg / IONS.Mg.M, Na: w.Na / IONS.Na.M, K: (w.K || 0) / IONS.K.M, Cl: w.Cl / IONS.Cl.M, SO4: w.SO4 / IONS.SO4.M, HCO3: w.HCO3 / IONS.HCO3.M, NH4: 0, NO3: 0, H2PO4: 0 };
}

/* ---------------------------------------------------------------- carbonate / acid requirement */
const KW = 1e-14;
export const co2Air = (ppm = 425) => 0.0334 * ppm * 1e-6 * 0.969 * 1000; // mmol L⁻¹ (Sander 2023; moist air)
function alkAt(pH, CT, PT) {
  const [, a1, a2] = carbonateSpecies(pH), p = phosphateSpecies(pH), h = Math.pow(10, -pH);
  return CT * (a1 + 2 * a2) + PT * (p[2] + 2 * p[3] - p[0]) + (KW / h - h) * 1000;
}
/** Strong-acid equivalents (mmol H⁺ L⁻¹) needed to bring water alkalinity to the target pH (P from salts included). */
export function acidNeed({ hco3, pH0, target = 5.8, PT = 1, open = false, ppm = 425 }) {
  if (hco3 <= 0) return 0;
  const [, a1, a2] = carbonateSpecies(pH0), h0 = Math.pow(10, -pH0);
  const CT = (hco3 - (KW / h0 - h0) * 1000) / (a1 + 2 * a2);
  const CTt = open ? co2Air(ppm) / carbonateSpecies(target)[0] : CT;
  return Math.max(0, hco3 - alkAt(target, CTt, PT));
}
/** pH of a solution with given residual alkalinity (closed after mixing) */
export function phOf(alk, CT, PT) {
  let lo = 2, hi = 12; for (let i = 0; i < 70; i++) { const m = (lo + hi) / 2; if (alkAt(m, CT, PT) > alk) hi = m; else lo = m; } return (lo + hi) / 2;
}
export function phOpen(alk, PT, ppm = 425) {
  const co2 = co2Air(ppm); let lo = 2, hi = 12;
  for (let i = 0; i < 70; i++) { const m = (lo + hi) / 2; if (alkAt(m, co2 / carbonateSpecies(m)[0], PT) > alk) hi = m; else lo = m; } return (lo + hi) / 2;
}

/* ---------------------------------------------------------------- NNLS (Lawson & Hanson 1974) */
export function nnls(A, b, maxIter = 300) {
  const m = A.length, n = A[0].length;
  const x = new Array(n).fill(0), P = new Array(n).fill(false);
  const At = j => A.map(r => r[j]);
  const grad = () => { const r = b.map((bi, i) => bi - A[i].reduce((s, a, j) => s + a * x[j], 0)); return Array.from({ length: n }, (_, j) => A.reduce((s, row, i) => s + row[j] * r[i], 0)); };
  const lsq = idx => { // least squares on columns idx via normal equations (small systems)
    const k = idx.length; const M = Array.from({ length: k }, () => new Array(k).fill(0)), v = new Array(k).fill(0);
    for (let a = 0; a < k; a++) { const ca = At(idx[a]); v[a] = ca.reduce((s, c, i) => s + c * b[i], 0); for (let c2 = 0; c2 < k; c2++) { const cb = At(idx[c2]); M[a][c2] = ca.reduce((s, c, i) => s + c * cb[i], 0); } M[a][a] += 1e-12; }
    for (let i = 0; i < k; i++) { let p = i; for (let r = i + 1; r < k; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; [M[i], M[p]] = [M[p], M[i]]; [v[i], v[p]] = [v[p], v[i]]; const d = M[i][i] || 1e-15; for (let r = 0; r < k; r++) { if (r === i) continue; const f = M[r][i] / d; for (let c = i; c < k; c++) M[r][c] -= f * M[i][c]; v[r] -= f * v[i]; } }
    return v.map((vi, i) => vi / (M[i][i] || 1e-15));
  };
  let it = 0;
  while (it++ < maxIter) {
    const w = grad(); let jmax = -1, wmax = 1e-10;
    for (let j = 0; j < n; j++) if (!P[j] && w[j] > wmax) { wmax = w[j]; jmax = j; }
    if (jmax < 0) break;
    P[jmax] = true;
    for (let inner = 0; inner < 100; inner++) {
      const idx = []; for (let j = 0; j < n; j++) if (P[j]) idx.push(j);
      const z = lsq(idx);
      if (z.every(v => v > 1e-12)) { idx.forEach((j, k) => x[j] = z[k]); break; }
      let alpha = Infinity; idx.forEach((j, k) => { if (z[k] <= 1e-12) { const a = x[j] / (x[j] - z[k]); if (a < alpha) alpha = a; } });
      idx.forEach((j, k) => { x[j] += alpha * (z[k] - x[j]); if (x[j] <= 1e-12) { x[j] = 0; P[j] = false; } });
    }
  }
  return x;
}

/* ---------------------------------------------------------------- solve a recipe */
export const ROWS = ['NH4', 'K', 'Ca', 'Mg', 'NO3', 'H2PO4', 'SO4', 'Cl', 'H'];
const PENALTY = { HNO3: 1, MKP: 1, MgNO3: 1, K2SO4: 1, MAP: 2, CaCl2: 2 };
export const IMPORTANCE = { NH4: 0.35, K: 1, Ca: 1, Mg: 1, NO3: 0.8, H2PO4: 1, SO4: 0.8, Cl: 0.3, H: 3 };
/**
 * opts: target {ions, micro}, water (mg L⁻¹ incl. pH), enabled {fertKey: bool}, micro sources, acid grades,
 * targetPH, open (aerated system) — returns amounts (mmol L⁻¹ of units) and the resulting solution.
 */
export function solveRecipe({ target, water, enabled, fe = 'DTPA', microChelated = false, targetPH = 5.8, basis = 'closed', residual = 0.5, ppm = 425 }) {
  const w = waterMmol(water);
  const need = {};
  ROWS.forEach(r => { need[r] = r === 'H' ? 0 : Math.max(0, (target.ions[r] || 0) - (w[r] || 0)); });
  // acid requirement from bicarbonate (P from salts counted as buffer)
  need.H = basis === 'residual' ? Math.max(0, w.HCO3 - residual)
    : acidNeed({ hco3: w.HCO3, pH0: water.pH ?? 7.5, target: targetPH, PT: target.ions.H2PO4, open: basis === 'open', ppm });
  const keys = Object.keys(FERTS).filter(k => enabled[k]);
  const A = ROWS.map(r => keys.map(k => FERTS[k].per[r] || 0));
  // weighted least squares: errors relative to the target above 1 mmol L⁻¹, absolute below; importance weights
  const scale = ROWS.map(r => (IMPORTANCE[r] ?? 1) / Math.max(r === 'H' ? 0.25 : 1, need[r] || 0));
  const As = A.map((row, i) => row.map(v => v * scale[i]));
  const bs = ROWS.map((r, i) => need[r] * scale[i]);
  // Tiny ridge penalty on "secondary" salts removes the chemical degeneracies of the problem
  // (MgSO₄ + 2 KNO₃ ≡ Mg(NO₃)₂ + K₂SO₄; HNO₃ + KH₂PO₄ ≡ H₃PO₄ + KNO₃; NH₄NO₃ + KH₂PO₄ ≡ NH₄H₂PO₄ + KNO₃)
  // and selects the conventional allocation used by fertiliser advisers (van der Lugt 2016, Ch. 8).
  keys.forEach((k, j) => { const lam = PENALTY[k] || 0; if (lam > 0) { const row = keys.map((_, jj) => jj === j ? Math.sqrt(lam * 1e-3) : 0); As.push(row); bs.push(0); } });
  const xk = keys.length ? nnls(As, bs) : [];
  const amounts = {}; keys.forEach((k, i) => { amounts[k] = xk[i] > 1e-6 ? xk[i] : 0; });
  // resulting solution (mmol L⁻¹)
  const sol = {}; Object.keys(IONS).forEach(i => { sol[i] = w[i] || 0; });
  let H = 0;
  keys.forEach(k => { const f = FERTS[k]; Object.entries(f.per).forEach(([ion, v]) => { if (ion === 'H') H += v * amounts[k]; else sol[ion] += v * amounts[k]; }); });
  // micronutrients (µmol L⁻¹) and their counter-ions
  const microAmt = {};
  Object.entries(target.micro).forEach(([el, umol]) => {
    const srcKey = el === 'Fe' ? fe : (el === 'B' ? 'BA' : el === 'Mo' ? 'NaMo' : (microChelated ? 'EDTA' : 'SO4'));
    const src = MICRO_SRC[el][srcKey];
    microAmt[el] = { umol, src: srcKey, name: src.name, w: src.w, gPer1000: umol * MICRO[el] / src.w / 1000 };
    if (src.SO4) sol.SO4 += umol / 1000 * src.SO4;
    if (src.Na) sol.Na += umol / 1000 * src.Na;
  });
  // bicarbonate neutralised by acid
  sol.HCO3 = Math.max(0, w.HCO3 - H);
  const excessH = Math.max(0, H - w.HCO3);
  return { amounts, sol, H, need, water: w, micro: microAmt, excessH, keys };
}

/* ---------------------------------------------------------------- balances, EC, pH, precipitation */
export function balance(sol) {
  const cat = CATIONS.reduce((s, i) => s + IONS[i].z * sol[i], 0);
  const an = ANIONS.reduce((s, i) => s + Math.abs(IONS[i].z) * sol[i], 0);
  return { cat, an, ibe: (cat - an) / (cat + an || 1) * 100 };
}
export function ionicStrength(sol) { return 0.5 * Object.keys(IONS).reduce((s, i) => s + sol[i] * IONS[i].z * IONS[i].z, 0) / 1000; }
export const davies = (z, I) => Math.pow(10, -0.509 * z * z * (Math.sqrt(I) / (1 + Math.sqrt(I)) - 0.3 * I));
// equivalent conductances λ° at 25 °C, S cm² equiv⁻¹: APHA 2510 Table III (Ca, Mg, Na, K, HCO3, Cl, SO4, NO3);
// NH4⁺ and H2PO4⁻ from Haynes (2014).
export const LAMBDA = { NH4: 73.5, K: 73.5, Ca: 59.5, Mg: 53.1, Na: 50.1, NO3: 71.4, H2PO4: 36.0, SO4: 80.0, Cl: 76.4, HCO3: 44.5 };
/** EC (dS m⁻¹ = mS cm⁻¹) by two methods: Σcations/10 and APHA 2510 κ = κ°·y² (Davies). */
export function ecEstimates(sol) {
  const b = balance(sol);
  const k0 = Object.keys(LAMBDA).reduce((s, i) => s + Math.abs(IONS[i].z) * LAMBDA[i] * sol[i], 0); // µS cm⁻¹
  const I = ionicStrength(sol); const y = davies(1, I);
  return { rule: b.cat / 10, kohl: k0 / 1000, apha: k0 * y * y / 1000, I, y };
}
/** Saturation indices (log10 IAP/Ksp) in the working solution: gypsum, brushite (CaHPO4·2H2O), calcite. */
export const KSP = { gypsum: -4.60, brushite: -6.60, calcite: -8.48 };
export function saturation(sol, pH) {
  const I = ionicStrength(sol); const g2 = davies(2, I);
  const ca = sol.Ca / 1000 * g2, so4 = sol.SO4 / 1000 * g2;
  const pT = sol.H2PO4 / 1000; const hpo4 = pT * phosphateSpecies(pH)[2] * g2;
  const [a0, a1, a2] = carbonateSpecies(pH); const ct = sol.HCO3 / 1000 / Math.max(1e-9, a1 + 2 * a2); const co3 = ct * a2 * g2;
  return { gypsum: Math.log10(ca * so4 + 1e-30) - KSP.gypsum, brushite: Math.log10(ca * hpo4 + 1e-30) - KSP.brushite, calcite: Math.log10(ca * co3 + 1e-30) - KSP.calcite, I };
}
/** Element concentrations (mg L⁻¹) of a solution: N as NO₃-N + NH₄-N, P, K, Ca, Mg, S, Na, Cl. */
export function elementsMgL(sol) {
  return { N: (sol.NO3 + sol.NH4) * 14.007, P: sol.H2PO4 * 30.974, K: sol.K * 39.098, Ca: sol.Ca * 40.078, Mg: sol.Mg * 24.305, S: sol.SO4 * 32.06, Na: sol.Na * 22.990, Cl: sol.Cl * 35.45 };
}
/** Solubility (g L⁻¹ of water) at a storage temperature (°C). Temperature dependence is included only for KNO₃
 *  (133 g L⁻¹ at 0 °C, 316 at 20 °C, 383 at 25 °C; Haynes 2014), the salt most prone to crystallising in cold stores. */
export function solubilityAt(key, T) {
  const f = FERTS[key]; if (!f || !f.sol) return null;
  if (key !== 'KNO3') return f.sol;
  if (T <= 20) return 133 + (316 - 133) * Math.max(0, T) / 20;
  return 316 + (383 - 316) * Math.min(1, (T - 20) / 5);
}
/**
 * Split fertilisers between tank A and tank B. Calcium salts and iron chelates → A; phosphates, sulfates,
 * micronutrient salts and acids → B; KNO₃ split to balance dissolved mass (van der Lugt 2016, Ch. 9).
 * overrides: {key: 'A'|'B'} moves a salt (to explore incompatibilities).
 */
export function allocate(amounts, overrides = {}) {
  const tanks = { A: {}, B: {} };
  let massA = 0, massB = 0;
  Object.entries(amounts).forEach(([k, a]) => {
    if (a <= 1e-4 || k === 'KNO3') return; const f = FERTS[k];
    const t = overrides[k] || (f.tank === 'AB' ? 'A' : f.tank);
    tanks[t][k] = a; if (!f.liquid) { if (t === 'A') massA += a * f.Munit; else massB += a * f.Munit; }
  });
  if (amounts.KNO3 > 1e-4) {
    if (overrides.KNO3) tanks[overrides.KNO3].KNO3 = amounts.KNO3;
    else { const m = amounts.KNO3 * FERTS.KNO3.Munit; const toA = Math.max(0, Math.min(m, (m + massB - massA) / 2)); if (toA > 1e-6) tanks.A.KNO3 = toA / FERTS.KNO3.Munit; if (m - toA > 1e-6) tanks.B.KNO3 = (m - toA) / FERTS.KNO3.Munit; }
  }
  return tanks;
}
/** Composition of a concentrated stock tank (mol L⁻¹ of Ca²⁺, SO₄²⁻, H₂PO₄⁻) and its ideal gypsum ion product. */
export function stockCheck(amountsInTank, F) {
  let ca = 0, so4 = 0, p = 0;
  Object.entries(amountsInTank).forEach(([k, a]) => { const f = FERTS[k]; if (!f) return; ca += (f.per.Ca || 0) * a; so4 += (f.per.SO4 || 0) * a; p += (f.per.H2PO4 || 0) * a; });
  return { ca: ca * F / 1000, so4: so4 * F / 1000, p: p * F / 1000, logIPgyp: Math.log10((ca * F / 1000) * (so4 * F / 1000) + 1e-30) };
}
