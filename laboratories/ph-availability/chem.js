/* pH, speciation and nutrient availability — chemistry core (no DOM).
   All equilibria at 25 °C. Concentrations in mmol L⁻¹ unless stated; pH ≈ −log10[H⁺].
   Sources (see the Assumptions & sources tab):
   · carbonate pK 6.351 / 10.329 at 25 °C (Plummer & Busenberg 1982) and phosphate pK 2.15 / 7.20 / 12.35 — course library physics.js
   · Henry constant of CO₂ 3.3 × 10⁻⁴ mol m⁻³ Pa⁻¹ = 0.0334 mol L⁻¹ atm⁻¹ (Sander 2023)
   · chelate constants: EDTA (Martell & Smith, as tabulated by Skoog et al. 2014; I = 0.1 M),
     DTPA (IUPAC, Anderegg et al. 2005; I = 0.1 M), o,o-EDDHA (Yunta et al. 2012, I = 0 → 0.1 M by Davies),
     Fe(III) hydrolysis (Baes & Mesmer 1976, → 0.1 M), Fe(OH)₃ solubility (Lindsay 1979; Lindsay & Schwab 1982). */
import { carbonateSpecies, phosphateSpecies } from '../../assets/js/physics.js';

export const KW = 1e-14;
export const KH_CO2 = 0.0334;              // mol L⁻¹ atm⁻¹ (25 °C)
export const PW_25 = 3.17;                 // kPa, water-vapour pressure at 25 °C

/** Dissolved CO₂ (mmol L⁻¹) in equilibrium with moist air of a given CO₂ mole fraction (ppm). */
export function co2Eq(ppm = 425, P = 101.325) { return KH_CO2 * ppm * 1e-6 * (P - PW_25) / 101.325 * 1000; }

/** Generalised alkalinity (mmol L⁻¹): carbonate (reference CO₂), phosphate (reference H₂PO₄⁻), water. */
export function alkalinity(pH, CT, PT = 0) {
  const [a0, a1, a2] = carbonateSpecies(pH); const p = phosphateSpecies(pH); const h = Math.pow(10, -pH);
  return CT * (a1 + 2 * a2) + PT * (p[2] + 2 * p[3] - p[0]) + (KW / h - h) * 1000;
}
/** Solve alkalinity(pH) = A for pH by bisection. closed: CT fixed; open: CO₂(aq) fixed (CT follows pH). */
export function phFromAlk(A, { CT = 0, PT = 0, open = false, co2 = co2Eq() } = {}) {
  const f = pH => (open ? alkalinity(pH, co2 / carbonateSpecies(pH)[0], PT) : alkalinity(pH, CT, PT)) - A;
  let lo = 0.5, hi = 13.5;
  if (f(lo) > 0) return lo; if (f(hi) < 0) return hi;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; }
  return (lo + hi) / 2;
}
/** Total inorganic carbon of a water from its alkalinity (mmol L⁻¹) and pH. */
export function ctFromWater(alk, pH, PT = 0) {
  const [, a1, a2] = carbonateSpecies(pH); const p = phosphateSpecies(pH); const h = Math.pow(10, -pH);
  return (alk - PT * (p[2] + 2 * p[3] - p[0]) - (KW / h - h) * 1000) / (a1 + 2 * a2);
}

/* ------------------------------------------------------------------ acids */
export const ACIDS = {
  hno3_38: { label: 'Nitric acid 38 %', w: 38, rho: 1.235, M: 63.01, h: 1, anion: 'NO₃⁻', P: 0 },
  hno3_60: { label: 'Nitric acid 60 %', w: 60, rho: 1.37, M: 63.01, h: 1, anion: 'NO₃⁻', P: 0 },
  h3po4_75: { label: 'Phosphoric acid 75 %', w: 75, rho: 1.574, M: 98.00, h: 1, anion: 'H₂PO₄⁻', P: 1 },
  h3po4_85: { label: 'Phosphoric acid 85 %', w: 85, rho: 1.685, M: 98.00, h: 1, anion: 'H₂PO₄⁻', P: 1 },
  h2so4_37: { label: 'Sulfuric acid 37 %', w: 37, rho: 1.275, M: 98.08, h: 2, anion: 'SO₄²⁻', P: 0 }
};
/** Molar concentration of a commercial acid (mol L⁻¹) from mass fraction (%), density and molar mass. */
export const acidMolarity = a => 10 * a.w * a.rho / a.M;

/**
 * Titration of a water with a strong acid (or H₃PO₄). doses: acid added in mmol of H⁺-equivalents per litre
 * (for H₃PO₄: mmol H₃PO₄ L⁻¹, each lowering alkalinity by 1 with H₂PO₄⁻ as reference).
 */
export function titrationCurve({ alk0, pH0, P0 = 0, acid = 'hno3_38', open = false, co2 = co2Eq(), aMax, n = 161 }) {
  const CT0 = ctFromWater(alk0, pH0, P0); const isP = ACIDS[acid].P > 0;
  const top = aMax ?? Math.max(1, alk0 * 1.35 + 0.4);
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) {
    const a = top * i / (n - 1);
    const PT = P0 + (isP ? a : 0);
    ys.push(phFromAlk(alk0 - a, { CT: CT0, PT, open, co2 })); xs.push(a);
  }
  return { xs, ys, CT0 };
}
/** Acid (mmol H⁺-equivalents L⁻¹) needed to bring a water from (alk0, pH0) to targetPH. */
export function acidDose({ alk0, pH0, P0 = 0, acid = 'hno3_38', target = 5.8, open = false, co2 = co2Eq() }) {
  const CT0 = ctFromWater(alk0, pH0, P0); const isP = ACIDS[acid].P > 0;
  const g = a => (open ? alkalinity(target, co2 / carbonateSpecies(target)[0], P0 + (isP ? a : 0)) : alkalinity(target, CT0, P0 + (isP ? a : 0))) - (alk0 - a);
  // alkalinity remaining at the target must equal alk0 − a; solve for a by bisection
  let lo = 0, hi = alk0 * 3 + 5;
  if (g(lo) >= 0) return 0;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (g(m) < 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
/** pH drift of an acidified, aerated solution as excess CO₂ degasses: returns {ts (h), ph}. kla in h⁻¹ (for CO₂). */
export function degassing({ alk, CT0, PT = 0, co2 = co2Eq(), kla = 1.8, hours = 24, n = 97 }) {
  const ts = [], ph = []; let CT = CT0; const dt = hours / (n - 1) / 20;
  for (let i = 0; i < n; i++) {
    const p = phFromAlk(alk, { CT, PT }); ts.push(i * hours / (n - 1)); ph.push(p);
    for (let k = 0; k < 20; k++) { const pk = phFromAlk(alk, { CT, PT }); const c = CT * carbonateSpecies(pk)[0]; CT -= kla * (c - co2) * dt; }
  }
  return { ts, ph };
}

/* ------------------------------------------------------------------ iron chelates */
// Davies correction from I = 0 to I = 0.1 M already applied where marked (A = 0.509, f(0.1) = 0.2102).
// logBH: cumulative protonation constants of the fully deprotonated ligand L.
export const CHELATES = {
  EDTA: {
    label: 'Fe-EDTA', color: 'c1', logBH: [10.24, 16.40, 19.06, 21.06, 22.56, 22.56],
    FeL: 25.1, FeHL: null, FeOHL: null,              // FeL + H2O ⇌ Fe(OH)L + H⁺ neglected (see Assumptions)
    M: { Ca: { L: 10.65 }, Mg: { L: 8.79 } }
  },
  DTPA: {
    label: 'Fe-DTPA', color: 'c0', logBH: [10.54, 19.10, 23.40, 26.17, 28.17],
    FeL: 27.8, FeHL: 27.8 + 3.56, FeOHL: 27.8 + 4.1 - 13.78,   // IUPAC: ML+H 3.56; ML+OH 4.1; pKw(0.1 M) 13.78
    M: { Ca: { L: 10.7, HL: 10.7 + 6.10 }, Mg: { L: 9.3, HL: 9.3 + 6.9 } }
  },
  EDDHA: {
    label: 'Fe-o,o-EDDHA', color: 'c2', logBH: [11.94, 22.67, 31.33, 37.52],
    FeL: 35.09, FeHL: 36.89, FeOHL: 35.09 - 11.43,
    M: { Ca: { L: 7.29, HL: 16.77, H2L: 25.95 }, Mg: { L: 9.76, HL: 18.18, H2L: 25.36 } }
  }
};
export const FE_SOLIDS = {
  amorphous: { label: 'fresh amorphous Fe(OH)₃', logKs: 4.18 },   // 3.54 at I = 0 (Lindsay 1979) → 0.1 M
  soil: { label: 'aged "soil-Fe"', logKs: 3.34 }                   // 2.70 at I = 0 (Lindsay & Schwab 1982) → 0.1 M
};
const FE_HYD = [-2.62, -6.31, null, -22.03];   // log *β1, *β2, (β3 omitted), *β4 at 0.1 M (Baes & Mesmer 1976, Davies-corrected)

/**
 * Equilibrium distribution of iron supplied as a 1:1 chelate. conc in mol L⁻¹ (FeT = LT), Ca/Mg free in mol L⁻¹.
 * Returns fractions of total Fe: chelated, dissolved inorganic, precipitated as Fe(OH)₃.
 */
export function chelateState(key, pH, { FeT = 20e-6, Ca = 4e-3, Mg = 1.5e-3, solid = 'amorphous' } = {}) {
  const c = CHELATES[key], h = Math.pow(10, -pH);
  let aL = 1; c.logBH.forEach((b, i) => { aL += Math.pow(10, b) * Math.pow(h, i + 1); });
  const metal = (m, conc) => { let s = Math.pow(10, m.L); if (m.HL) s += Math.pow(10, m.HL) * h; if (m.H2L) s += Math.pow(10, m.H2L) * h * h; return s * conc; };
  aL += metal(c.M.Ca, Ca) + metal(c.M.Mg, Mg);
  let gFeL = Math.pow(10, c.FeL); if (c.FeHL) gFeL += Math.pow(10, c.FeHL) * h; if (c.FeOHL) gFeL += Math.pow(10, c.FeOHL) / h;
  const aFe = 1 + Math.pow(10, FE_HYD[0]) / h + Math.pow(10, FE_HYD[1]) / (h * h) + Math.pow(10, FE_HYD[3]) / Math.pow(h, 4);
  const Ks = Math.pow(10, FE_SOLIDS[solid].logKs);
  // (1) no precipitate: FeT = u + x, x = K' u² (FeT = LT) with K' = gFeL/(aFe aL)
  const Kp = gFeL / (aFe * aL);
  const u = 2 * FeT / (1 + Math.sqrt(1 + 4 * Kp * FeT));
  const fe3 = u / aFe;
  const fe3Sat = Ks * h * h * h;
  if (fe3 <= fe3Sat) return { chel: 1 - u / FeT, diss: u / FeT, ppt: 0, fe3, logFe3: Math.log10(fe3) };
  // (2) Fe(OH)₃ present: free Fe³⁺ fixed by the solid
  const R = gFeL * fe3Sat / aL; const x = FeT * R / (1 + R); const inorg = Math.min(FeT - x, fe3Sat * aFe);
  return { chel: x / FeT, diss: inorg / FeT, ppt: Math.max(0, 1 - x / FeT - inorg / FeT), fe3: fe3Sat, logFe3: Math.log10(fe3Sat) };
}
/** pH at which the chelated fraction first falls below `level` on the alkaline side (scanning upwards from pH 4). */
export function stabilityLimit(key, level = 0.5, opts = {}) {
  let prev = chelateState(key, 4, opts).chel;
  for (let p = 4.01; p <= 12; p += 0.01) { const v = chelateState(key, p, opts).chel; if (prev >= level && v < level) return p; prev = v; }
  return null;
}

/* ------------------------------------------------------------------ root-driven pH drift */
/**
 * Charge balance of ion uptake: roots release one OH⁻ (as HCO₃⁻) per excess anion charge taken up and one H⁺ per
 * excess cation charge. Net alkalinity release per mmol N = (1 − fNH4) − fNH4 − eps, where eps is the excess of
 * other cations (K⁺, Ca²⁺, Mg²⁺) over other anions (H₂PO₄⁻, SO₄²⁻) per mmol N absorbed.
 * Returns {ts (d), ph, alk} for a well-mixed tank. uptakeN in mmol N L⁻¹ d⁻¹.
 */
export function rootDrift({ fNH4 = 0.07, uptakeN = 0.3, eps = 0.5, alk0 = 0.5, pH0 = 5.8, PT = 1.0, open = true, co2 = co2Eq(), days = 7, n = 141 }) {
  const dAlk = uptakeN * ((1 - fNH4) - fNH4 - eps); // mmol L⁻¹ d⁻¹
  const CT0 = ctFromWater(alk0, pH0, PT); const ts = [], ph = [], alk = [];
  for (let i = 0; i < n; i++) {
    const t = days * i / (n - 1); const A = alk0 + dAlk * t;
    ts.push(t); alk.push(A); ph.push(phFromAlk(A, open ? { PT, open: true, co2 } : { CT: CT0, PT }));
  }
  return { ts, ph, alk, dAlk };
}
/** NH₄⁺ share of N uptake that gives zero net drift for a given eps. */
export const neutralNH4 = eps => Math.max(0, Math.min(1, (1 - eps) / 2));

/* ------------------------------------------------------------------ qualitative availability chart */
// Schematic relative availability (0–1) in soilless, peat-based media versus pH — redrawn after the classic chart of
// Peterson (1981) and the chemistry in Sonneveld & Voogt (2009). QUALITATIVE: shapes, not measured concentrations.
const sig = (x, x0, s) => 1 / (1 + Math.exp(-(x - x0) / s));
export const AVAIL = [
  { el: 'N', f: p => 0.35 + 0.65 * sig(p, 4.6, 0.25) * (1 - 0.35 * sig(p, 7.6, 0.3)) },
  { el: 'P', f: p => 0.25 + 0.75 * sig(p, 4.7, 0.25) * (1 - 0.7 * sig(p, 6.9, 0.25)) },
  { el: 'K', f: p => 0.45 + 0.55 * sig(p, 4.8, 0.3) },
  { el: 'S', f: p => 0.5 + 0.5 * sig(p, 4.7, 0.3) },
  { el: 'Ca', f: p => 0.2 + 0.8 * sig(p, 5.3, 0.3) },
  { el: 'Mg', f: p => 0.2 + 0.8 * sig(p, 5.3, 0.3) },
  { el: 'Fe', f: p => 0.12 + 0.88 * (1 - sig(p, 6.5, 0.25)) },
  { el: 'Mn', f: p => 0.12 + 0.88 * (1 - sig(p, 6.4, 0.3)) },
  { el: 'B', f: p => 0.25 + 0.75 * sig(p, 4.6, 0.3) * (1 - 0.8 * sig(p, 6.9, 0.3)) },
  { el: 'Cu', f: p => 0.2 + 0.8 * (1 - sig(p, 6.6, 0.3)) },
  { el: 'Zn', f: p => 0.15 + 0.85 * (1 - sig(p, 6.5, 0.3)) },
  { el: 'Mo', f: p => 0.2 + 0.8 * sig(p, 5.4, 0.35) }
];
