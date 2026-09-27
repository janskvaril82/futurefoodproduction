/* ==========================================================================
   Bioregenerative life-support loop — crop and mass-balance model (pure JS).

   Crop productivities are anchored to the nominal values tabulated in NASA's
   Life Support Baseline Values and Assumptions Document (BVAD, Anderson et al.
   2018, Tables 4-96 to 4-98). Responses to light, photoperiod, CO₂ and humidity
   are scaled with the Modified Energy Cascade (MEC) crop model of Cavazzoni
   (2001/2004) as documented in BVAD §4.14.1.5–4.14.1.7 (Tables 4-103 to 4-128):
       X = X_nominal · MEC(PPF, H, CO₂, RH) / MEC(nominal conditions)
   Food composition: USDA FoodData Central (SR Legacy), converted to a dry-matter basis.
   Crew interface values: BVAD Table 3-33; hygiene water: BVAD Table 4-21.
   ========================================================================== */

/* ------------------------------------------------------------------ crew (per crew member and day, BVAD Table 3-33) */
export const CREW = {
  o2: 0.816,            // kg O₂ consumed
  co2: 1.04,            // kg CO₂ produced
  foodMJ: 12.59,        // MJ food energy consumed
  foodMass: 1.51,       // kg food as eaten (packaged diet, incl. ≈ 0.7 kg water)
  potable: 2.5,         // kg potable water (drinking + food rehydration)
  bodyMass: 82,         // kg reference crew member
  proteinPerKg: 0.8,    // g protein per kg body mass (RDA, Institute of Medicine 2005)
  urine: 1.62, fecalWater: 0.09, humidity: 1.9,           // kg water out
  solids: 0.03 + 0.06 + 0.02                              // kg dry faecal + urine + perspiration solids
};
/** Hygiene water (BVAD Table 4-21): ISS (no hygiene water, 0.30 kg urinal flush) or early planetary base. */
export const HYGIENE = {
  iss: { label: 'ISS-like (no shower or hand wash)', hyg: 0, flush: 0.30 },
  base: { label: 'Planetary base (BVAD)', hyg: 0.37 + 4.08 + 2.72, flush: 0.50 }
};

/* ------------------------------------------------------------------ crops */
// nominal: BVAD Table 4-96 (DLI, photoperiod), Table 4-117 (MEC nominal photoperiod H0 and light-period temperature),
//          Table 4-97 (edible dry and fresh productivity), Table 4-98 (total dry biomass, O₂, CO₂, transpiration)
// usda: per 100 g fresh edible portion — water (g), energy (kcal), protein (g)
// MEC: Tables 4-103 (n), 4-105 (CQYmin, CUEmax, CUEmin), 4-117 (H0, T), 4-118 (XFRT, tE, tQ, tM), 4-119 (BCF, OPF),
//      4-108…4-115 (CQYmax coefficients), 4-121…4-128 (tA coefficients). Matrix rows: 1/CO₂, 1, CO₂, CO₂², CO₂³;
//      columns: 1/PPF, 1, PPF, PPF², PPF³.
export const CROPS = {
  wheat: {
    label: 'Wheat', color: '#e0b64a', part: 'grain',
    nom: { dli: 115, H: 20, T: 23, eDW: 20.0, eFW: 22.73, tDW: 50.0, o2: 56.0, co2: 77.0, h2o: 11.79 },
    usda: { water: 12.8, kcal: 329, prot: 15.4, name: 'Wheat, hard red spring (FDC 168889)' },
    mec: { n: 1.0, cqyMin: 0.01, cueMax: 0.64, cueMin: null, H0: 20, T: 23, BCF: 0.44, OPF: 1.07, XFRT: 1.00, tE: 34, tQ: 33, tM: 62, canopy: 'erecto', ppf: [200, 2000],
      cqy: [[0, 0, 0, 0, 0], [0, 4.4793e-2, -5.1946e-6, 0, 0], [0, 5.1583e-5, 0, -4.9303e-12, 0], [0, -2.0724e-8, 0, 2.2255e-15, 0], [0, 0, 0, 0, 0]],
      tA: [[9.5488e4, 0, 0.3419, -1.9076e-4, 0], [1.0686e3, 15.977, 1.9733e-4, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]] }
  },
  potato: {
    label: 'White potato', color: '#c9a36a', part: 'tubers',
    nom: { dli: 28, H: 12, T: 20, eDW: 21.06, eFW: 105.30, tDW: 30.08, o2: 32.23, co2: 45.23, h2o: 4.00 },
    usda: { water: 79.2, kcal: 77, prot: 2.05, name: 'Potatoes, flesh and skin, raw (FDC 170026)' },
    mec: { n: 2.0, cqyMin: 0.02, cueMax: 0.625, cueMin: null, H0: 12, T: 20, BCF: 0.41, OPF: 1.02, XFRT: 1.00, tE: 45, tQ: 75, tM: 138, canopy: 'plano', ppf: [200, 1000],
      cqy: [[0, 0, 0, 0, 0], [0, 4.6929e-2, 0, 0, -1.9602e-11], [0, 5.0910e-5, 0, -1.5272e-11, 0], [0, -2.1878e-8, 0, 0, 0], [0, 0, 4.3976e-15, 0, 0]],
      tA: [[6.5773e5, 0, 0, 0, 0], [8.5626e3, 0, 0.042749, -1.7905e-5, 0], [0, 0, 8.8437e-7, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]] }
  },
  soybean: {
    label: 'Soybean', color: '#9bbf5a', part: 'seeds',
    nom: { dli: 28, H: 12, T: 26, eDW: 4.54, eFW: 5.04, tDW: 11.34, o2: 13.91, co2: 19.13, h2o: 4.70 },
    usda: { water: 8.54, kcal: 446, prot: 36.49, name: 'Soybeans, mature seeds, raw (FDC 174270)' },
    mec: { n: 1.5, cqyMin: 0.02, cueMax: 0.65, cueMin: 0.30, H0: 12, T: 26, BCF: 0.46, OPF: 1.16, XFRT: 0.95, tE: 46, tQ: 48, tM: 86, canopy: 'plano', ppf: [200, 1000],
      cqy: [[0, 0, 0, 0, 0], [0, 4.1513e-2, 0, -2.1582e-8, 0], [0, 5.1157e-5, 4.0864e-8, -1.0468e-10, 4.8541e-14], [0, -2.0992e-8, 0, 0, 0], [0, 0, 0, 0, 3.9259e-21]],
      tA: [[6.7978e6, -4.326e4, 112.63, -0.13637, 6.6918e-5], [-4.3658e3, 33.959, 0, 0, -2.1367e-8], [1.5573, 0, 0, 0, 1.5467e-11], [0, 0, -4.911e-9, 0, 0], [0, 0, 0, 0, 0]] }
  },
  lettuce: {
    label: 'Lettuce', color: '#6fd39a', part: 'leaves',
    nom: { dli: 17, H: 16, T: 23, eDW: 6.57, eFW: 131.35, tDW: 7.30, o2: 7.78, co2: 10.70, h2o: 2.10 },
    usda: { water: 95.0, kcal: 15, prot: 1.36, name: 'Lettuce, green leaf, raw (FDC 169249)' },
    mec: { n: 2.5, cqyMin: null, cueMax: 0.625, cueMin: null, H0: 16, T: 23, BCF: 0.40, OPF: 1.08, XFRT: 0.95, tE: 1, tQ: null, tM: 30, canopy: 'plano', ppf: [200, 500],
      cqy: [[0, 0, 0, 0, 0], [0, 4.4763e-2, -1.1701e-5, 0, 0], [0, 5.163e-5, 0, -1.9731e-11, 0], [0, -2.075e-8, 0, 8.9265e-15, 0], [0, 0, 0, 0, 0]],
      tA: [[0, 0, 1.8760, 0, 0], [1.0289e4, 1.7571, 0, 0, 0], [-3.7018, 0, 0, 0, 0], [0, 2.3127e-6, 0, 0, 0], [3.6648e-7, 0, 0, 0, 0]] }
  },
  sweetpotato: {
    label: 'Sweet potato', color: '#e58a55', part: 'storage roots',
    nom: { dli: 28, H: 18, T: 28, eDW: 24.7, eFW: 51.72, tDW: 37.50, o2: 41.12, co2: 56.54, h2o: 2.88 },
    usda: { water: 77.3, kcal: 86, prot: 1.57, name: 'Sweet potato, raw, unprepared (FDC 168482)' },
    mec: { n: 1.5, cqyMin: null, cueMax: 0.625, cueMin: null, H0: 18, T: 28, BCF: 0.44, OPF: 1.02, XFRT: 1.00, tE: 33, tQ: null, tM: 120, canopy: 'plano', ppf: [200, 1000],
      cqy: [[0, 0, 0, 0, 0], [0, 3.9317e-2, -1.3836e-5, 0, 0], [0, 5.6741e-5, -6.3397e-9, -1.3464e-11, 0], [0, -2.1797e-8, 0, 7.7362e-15, 0], [0, 0, 0, 0, 0]],
      tA: [[1.2070e6, 0, 0, 0, 4.0109e-7], [4.9484e3, 4.2978, 0, 0, 0], [0, 0, 0, 0, 2.0193e-12], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]] }
  },
  tomato: {
    label: 'Tomato', color: '#ef6b61', part: 'fruit',
    nom: { dli: 27, H: 12, T: 26, eDW: 10.43, eFW: 173.76, tDW: 23.17, o2: 26.36, co2: 36.24, h2o: 2.77 },
    usda: { water: 94.5, kcal: 18, prot: 0.88, name: 'Tomatoes, red, ripe, raw (FDC 170457)' },
    mec: { n: 2.5, cqyMin: 0.01, cueMax: 0.65, cueMin: null, H0: 12, T: 26, BCF: 0.42, OPF: 1.09, XFRT: 0.70, tE: 41, tQ: 56, tM: 80, canopy: 'plano', ppf: [200, 1000],
      cqy: [[0, 0, 0, 0, 0], [0, 4.0061e-2, 0, -7.1241e-9, 0], [0, 5.688e-5, -1.182e-8, 0, 0], [0, -2.2598e-8, 5.0264e-12, 0, 0], [0, 0, 0, 0, 0]],
      tA: [[6.2774e5, 0, 0.44686, 0, 0], [3.1724e3, 24.281, 5.6276e-3, -3.0690e-6, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]] }
  }
};
export const CROP_KEYS = Object.keys(CROPS);
export const CO2_NOM = 1200, RH_NOM = 0.75;       // assumed conditions behind the nominal BVAD values
export const KJ_PER_G_DW = 17.5;                  // heat of combustion of plant dry matter (as in Lesson 8.1)
export const UMOL_PER_J_PAR = 4.9;                // µmol of PAR photons per joule of radiant PAR (LED spectra, Lesson 8.1)
export const CANOPY_ABS = 0.9;                    // fraction of incident PAR absorbed by a closed canopy
export const AUX_FRAC = 0.10;                     // fans, pumps and controls as a fraction of lighting power

// dry-matter composition of the edible parts (USDA values ÷ dry matter)
for (const k of CROP_KEYS) { const u = CROPS[k].usda, dm = 100 - u.water; CROPS[k].kcalPerGDM = u.kcal / dm; CROPS[k].protPerGDM = u.prot / dm; }

/* ------------------------------------------------------------------ MEC crop model */
function poly(M, P, C) {
  const rows = [1 / C, 1, C, C * C, C * C * C], cols = [1 / P, 1, P, P * P, P * P * P];
  let s = 0; for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (M[r][c]) s += M[r][c] * rows[r] * cols[c]; return s;
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
/** One MEC crop cycle. PPF µmol m⁻² s⁻¹, H h d⁻¹, CO₂ µmol mol⁻¹, RH fraction. Returns integrals per m² over the cycle. */
export function mecCycle(key, PPF, H, CO2, RH) {
  const m = CROPS[key].mec;
  const Pc = clamp(PPF, m.ppf[0], m.ppf[1]), Cc = clamp(CO2, 330, 1300);      // validity range of the polynomials
  const PPFE = clamp(PPF * H / m.H0, m.ppf[0], m.ppf[1]);
  const tA = clamp(poly(m.tA, PPFE, Cc), 1, m.tM);
  const cqyMax = Math.max(0.005, poly(m.cqy, Pc, Cc));
  const T = m.T, vps = 0.611 * Math.exp(17.4 * T / (T + 239)), VPD = vps * (1 - RH);
  let TCB = 0, TEB = 0, O2 = 0, DCGs = 0, DTR = 0;
  const dt = 0.25;
  for (let t = 0; t < m.tM; t += dt) {
    const tm = t + dt / 2;
    const A = tm < tA ? 0.93 * Math.pow(tm / tA, m.n) : 0.93;
    let cqy = cqyMax; if (m.tQ != null && m.cqyMin != null && tm > m.tQ) cqy = cqyMax - (cqyMax - m.cqyMin) * (tm - m.tQ) / (m.tM - m.tQ);
    let cue = m.cueMax; if (m.cueMin != null && m.tQ != null && tm > m.tQ) cue = m.cueMax - (m.cueMax - m.cueMin) * (tm - m.tQ) / (m.tM - m.tQ);
    const DCG = 0.0036 * H * cue * A * cqy * PPF;          // mol C m⁻² d⁻¹ (Eq. 4-18)
    const CGR = 12.011 * DCG / m.BCF;                      // g m⁻² d⁻¹ (Eq. 4-20)
    TCB += CGR * dt; if (tm >= m.tE) TEB += m.XFRT * CGR * dt;
    O2 += m.OPF * DCG * 32.00 * dt; DCGs += DCG * dt;
    const Pg = A * cqy * PPF, Pn = ((24 - H) / 24 + H * cue / 24) * Pg;       // µmol C m⁻² s⁻¹ (Eqs. 4-25, 4-26)
    let gS, gA;
    if (m.canopy === 'erecto') { gS = 0.1389 + 15.32 * RH * Pn / Cc; gA = 5.5; } else { gS = Math.max(0, (1.717 * T - 19.96 - 10.54 * VPD) * Pn / Cc); gA = 2.5; }
    const gC = gS > 0 ? gA * gS / (gA + gS) : 0;
    DTR += 3600 * H * (18.015 / 998.23) * gC * (VPD / 101.325) * dt;            // L m⁻² (Eq. 4-30)
  }
  return { tA, cqyMax, TCB, TEB, O2, CO2: DCGs * 44.01, DTR };
}
const nominalPPF = key => CROPS[key].nom.dli * 1e6 / (CROPS[key].mec.H0 * 3600);
const NOM_CACHE = {};
function nominalMEC(key) { return NOM_CACHE[key] || (NOM_CACHE[key] = mecCycle(key, nominalPPF(key), CROPS[key].mec.H0, CO2_NOM, RH_NOM)); }
/** Crop performance per m² per day under the given light and atmosphere, anchored to the BVAD nominal values. */
export function cropPerM2(key, { PPF, H, CO2, RH }) {
  const c = CROPS[key], n = nominalMEC(key), r = mecCycle(key, PPF, H, CO2, RH);
  const rT = r.TCB / n.TCB, rE = r.TEB / n.TEB, rW = n.DTR > 0 ? r.DTR / n.DTR : rT;
  const eDW = c.nom.eDW * rE, tDW = Math.max(eDW, c.nom.tDW * rT);
  const eFW = eDW / (c.nom.eDW / c.nom.eFW);                      // same water content as the BVAD edible fresh basis
  const dli = PPF * H * 3600 / 1e6;
  return {
    PPF, H, dli, eDW, eFW, tDW, iDW: tDW - eDW, o2: c.nom.o2 * rT, co2: c.nom.co2 * rT, h2o: c.nom.h2o * rW,  // g (o2, co2, DW, FW) and kg (h2o) m⁻² d⁻¹
    kcal: eDW * c.kcalPerGDM, prot: eDW * c.protPerGDM, tA: r.tA, cqyMax: r.cqyMax,
    valid: PPF >= c.mec.ppf[0] && PPF <= c.mec.ppf[1] && CO2 >= 330 && CO2 <= 1300
  };
}
export function lightFor(key, p) {
  if (p.lightMode === 'uniform') return { PPF: p.ppfd, H: p.photo };
  return { PPF: nominalPPF(key), H: CROPS[key].mec.H0 };
}

/* ------------------------------------------------------------------ the loop (all flows in kg d⁻¹ unless noted) */
/**
 * p: { crew, hyg:'iss'|'base', areas:{key:m²}, lightMode:'nominal'|'uniform', ppfd, photo, eff (µmol J⁻¹), cap (0–1),
 *      co2 (µmol mol⁻¹), rh (%), fox (0–1 fraction of inedible biomass oxidised), wrs (0–1 water-recovery efficiency), days }
 */
export function computeLoop(p) {
  const N = p.crew, H = HYGIENE[p.hyg] || HYGIENE.base;
  const crops = {}; let area = 0;
  const S = { eDW: 0, eFW: 0, tDW: 0, iDW: 0, o2: 0, co2: 0, h2o: 0, kcal: 0, prot: 0, o2ox: 0, co2ox: 0, photons: 0, bioWater: 0 };
  for (const k of CROP_KEYS) {
    const A = Math.max(0, p.areas[k] || 0); area += A;
    const L = lightFor(k, p); const r = cropPerM2(k, { PPF: L.PPF, H: L.H, CO2: p.co2, RH: p.rh / 100 });
    const edFracC = r.tDW > 0 ? r.eDW / r.tDW : 1;
    const x = {
      area: A, per: r, eDW: A * r.eDW / 1000, eFW: A * r.eFW / 1000, tDW: A * r.tDW / 1000, iDW: A * r.iDW / 1000,
      o2: A * r.o2 / 1000, co2: A * r.co2 / 1000, h2o: A * r.h2o, kcal: A * r.kcal, prot: A * r.prot,
      o2ox: p.fox * A * r.o2 / 1000 * (1 - edFracC), co2ox: p.fox * A * r.co2 / 1000 * (1 - edFracC),
      photons: A * r.dli,                                             // mol d⁻¹ at the canopy
      power: A * r.dli * 1e6 / 86400 / (p.eff * p.cap) / 1000          // kW average electrical power for light
    };
    x.bioWater = (x.eFW - x.eDW) + x.iDW * 9;                          // water leaving the chamber in harvested biomass (inedible ≈ 90 % water)
    crops[k] = x;
    for (const f of ['eDW', 'eFW', 'tDW', 'iDW', 'o2', 'co2', 'h2o', 'kcal', 'prot', 'o2ox', 'co2ox', 'photons', 'bioWater']) S[f] += x[f];
  }
  const foodMJ = S.kcal * 4.184e-3;                                   // MJ d⁻¹
  const demand = { o2: N * CREW.o2, co2: N * CREW.co2, foodMJ: N * CREW.foodMJ, prot: N * CREW.bodyMass * CREW.proteinPerKg, water: N * (CREW.potable + H.hyg) };
  // gases
  const o2net = S.o2 - S.o2ox;
  const o2Res = Math.max(0, demand.o2 + S.o2ox - S.o2), o2Surplus = Math.max(0, S.o2 - S.o2ox - demand.o2);
  const co2Prod = demand.co2 + S.co2ox;
  const co2Scrub = Math.max(0, co2Prod - S.co2), co2Short = Math.max(0, S.co2 - co2Prod);
  // food
  const foodResMJ = Math.max(0, demand.foodMJ - foodMJ), foodResMass = foodResMJ * CREW.foodMass / CREW.foodMJ;
  const protRes = Math.max(0, demand.prot - S.prot);
  // water loop
  const foodWater = CROP_KEYS.reduce((a, k) => a + (crops[k].eFW - crops[k].eDW), 0);   // water eaten with fresh produce
  const inedWater = S.iDW * 9;                                         // water in harvested inedible biomass
  const wasteWaterRec = p.fox * inedWater;                             // recovered as condensate when the biomass is dried/oxidised
  const wCrew = N * (CREW.urine + H.flush + H.hyg + CREW.humidity + CREW.fecalWater) + foodWater;
  const irrigation = S.h2o + S.bioWater;                               // plant uptake = transpiration + water in harvested biomass
  const toPlants = Math.min(0.95 * wCrew, irrigation);                // biologically treated wastewater used as nutrient solution (95 % recovered)
  const wRest = Math.max(0, wCrew - toPlants / 0.95), bioLoss = toPlants / 0.95 - toPlants;
  const wrsOut = p.wrs * wRest, brine = wRest - wrsOut;
  const makeUp = irrigation - toPlants;                                // clean water topped up to the plants
  const cleanIn = S.h2o + wrsOut + wasteWaterRec, cleanOut = demand.water + makeUp;
  const waterRes = Math.max(0, cleanOut - cleanIn), waterSurplus = Math.max(0, cleanIn - cleanOut);
  // energy
  const pLight = CROP_KEYS.reduce((a, k) => a + crops[k].power, 0), pAux = AUX_FRAC * pLight;
  const parKW = Math.min(pLight, pLight * p.eff / UMOL_PER_J_PAR);
  const absorbedKW = parKW * p.cap * CANOPY_ABS, chemKW = S.tDW * 1000 * KJ_PER_G_DW / 86400, foodKW = foodMJ * 1000 / 86400;
  // closures
  const closure = {
    o2: demand.o2 > 0 ? o2net / demand.o2 : 0,
    co2: co2Prod > 0 ? Math.min(S.co2, co2Prod) / co2Prod : 0,
    food: demand.foodMJ > 0 ? foodMJ / demand.foodMJ : 0,
    prot: demand.prot > 0 ? S.prot / demand.prot : 0,
    water: demand.water > 0 ? S.h2o / demand.water : 0
  };
  // resupply per day with the plants and in an open loop (no plants, same water recovery)
  const resupply = o2Res + foodResMass + waterRes;
  const openWater = Math.max(0, demand.water - p.wrs * N * (CREW.urine + H.flush + H.hyg + CREW.humidity + CREW.fecalWater));
  const openLoop = demand.o2 + N * CREW.foodMass + openWater;
  return {
    N, area, crops, S, foodMJ, demand, closure,
    gas: { o2net, o2Res, o2Surplus, co2Prod, co2Scrub, co2Short },
    food: { foodResMJ, foodResMass, protRes },
    water: { wCrew, foodWater, inedWater, wasteWaterRec, irrigation, toPlants, wRest, bioLoss, wrsOut, brine, makeUp, cleanIn, cleanOut, waterRes, waterSurplus },
    energy: { pLight, pAux, parKW, absorbedKW, chemKW, foodKW, kwhPerMJ: foodMJ > 0 ? (pLight + pAux) * 24 / foodMJ : Infinity },
    resupply, openLoop
  };
}
