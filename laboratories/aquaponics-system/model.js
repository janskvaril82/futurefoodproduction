/* ==========================================================================
   Aquaponics system simulator — the dynamic model (no DOM, no three.js).
   A coupled, well-mixed recirculating system: Nile tilapia → solids / TAN →
   two-step nitrifying biofilm (AOB, NOB) → nitrate → staggered lettuce crop,
   with oxygen, carbonate chemistry (alkalinity, total inorganic carbon, pH),
   base dosing, denitrification and water exchange.
   Units: time in days (d); concentrations in g m⁻³ (= mg L⁻¹) for N species and
   O₂; alkalinity in eq m⁻³ (= meq L⁻¹); total inorganic carbon in mol m⁻³
   (= mmol L⁻¹); masses in g; volumes in m³. Equation numbers refer to the
   Derive tab of index.html (Eq. A1 …).
   Imported with a relative path so that the same file also runs under Node
   for calibration tests (the browser resolves it to /assets/js/physics.js).
   ========================================================================== */
import { nh3Fraction, doSaturation, rk4 } from '../../assets/js/physics.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/* ------------------------------------------------------------------ parameters
   Sources are given in the Derive and "Assumptions & sources" tabs.            */
export const PAR = {
  // ---- fish: Nile tilapia (Oreochromis niloticus) --------------------------------
  aI: 0.224, bI: 0.635,        // Eq. A1 satiation intake Imax = aI·W^bI (g d⁻¹) — fitted to Tran-Duy et al. (2008), Table 2
  Tmin: 17, Topt: 31, Tmax: 40, pT: 3.3, // Eq. A2 thermal factor: feeding stops < 17 °C, optimum 29–31 °C (Popma & Masser 1999); Tmax (Yi 1998); pT calibrated
  DOmin: 0.3, DO1: 1.5, s1: 0.6, DOcrit: 5.0, // Eq. A2 DO factor through (0.3, 0), (1.5, 0.6), (5.0, 1): Yi (1998); Tsadik & Kutty (1987); Tran-Duy et al. (2008)
  UIAc: 0.06, UIAm: 1.4,       // Eq. A2 un-ionised ammonia factor, mg NH₃ L⁻¹ (Yi 1998)
  eg: 0.79, cM: 0.005, TrefM: 32.7, Q10: 2, // Eq. A3 growth–ration line fitted to Tran-Duy et al. (2008); Q10 assumed
  nFish: 0.0256,               // g N (g fish)⁻¹ = 16 % crude protein / 6.25 (Tran-Duy et al. 2008, Table 4)
  fAbs: 0.80,                  // fraction of ingested N absorbed (Timmons & Ebeling 2013 design value)
  adcDM: 0.70, dmFeed: 0.945,  // dry-matter digestibility (assumed); feed dry matter (Tran-Duy et al. 2008)
  DE: 11.8, fME: 0.95, Efish: 7.1, Qox: 13.6, RQ: 0.9, // Eq. A5 energy balance (Popma & Masser 1999; Elliott & Davison 1975)
  tauGut: 0.2,                 // gut passage time constant, d (≈ 5 h; excretion peaks hours after a meal)
  feedOn: 7 / 24, feedOff: 19 / 24, // feeding window 07:00–19:00
  // ---- solids --------------------------------------------------------------------
  kMin: 0.4, thMin: 1.07, o2Sol: 1.0, // Eq. A6 first-order mineralisation of suspended organic solids (assumed)
  // ---- nitrifying biofilm (Lesson 6.1 values) ---------------------------------------
  muA: 0.9, muN: 0.8, th: 1.07, KA: 0.5, KN: 0.5, KOA: 0.5, KON: 1.0, YA: 0.15, YN: 0.05, b: 0.05,
  rAmax: 1.2, rNmax: 1.5,      // maximum areal rates at 20 °C, g N m⁻² d⁻¹ (model assumption)
  SSA: 500, pH50: 6.0,         // K1-type moving-bed carriers (Rusten et al. 2006); pH at half activity (assumed)
  // ---- lettuce (staggered raft production) ---------------------------------------------
  rP: 0.18, W0p: 3, Wmaxp: 250, crop: 28, NC: 6, dens: 25, // logistic growth; 150 g heads in ≈ 4 weeks
  nPlant: 0.00163,             // g N (g FW)⁻¹ = 3.8 % DM × 4.3 % N (Yang & Kim 2020)
  KNp: 1.0,                    // apparent half-saturation of crop N uptake, g N m⁻³ (assumed)
  // ---- water, gas exchange and chemistry --------------------------------------------
  kden: 0.012, thDen: 1.07,    // first-order denitrification in anoxic niches (calibrated to 25–60 % N loss)
  alkIn: 2.0, no3In: 0.5,      // make-up water: 2 meq L⁻¹ (100 mg L⁻¹ as CaCO₃), 0.5 mg NO₃-N L⁻¹
  co2ppm: 425, kLa0: 0.1, thKLa: 1.024, rCO2: 0.9, // atmospheric CO₂ 2026; passive re-aeration; ASCE θ; kLa(CO₂)/kLa(O₂)
  baseMax: 20,                 // dosing pump capacity, eq d⁻¹
  // ---- system geometry -------------------------------------------------------------------
  Vft: 1.8, Vsep: 0.25, Vbf: 0.5, Vsump: 0.4, bedDepth: 0.30, wallArea: 12
};

export const BASES = {
  off: { label: 'Off', eqMass: 0, cat: null, catMass: 0, carbon: 0 },
  KOH: { label: 'KOH', eqMass: 56.11, cat: 'K', catMass: 39.10, carbon: 0 },
  CaOH2: { label: 'Ca(OH)₂', eqMass: 37.05, cat: 'Ca', catMass: 20.04, carbon: 0 },
  NaHCO3: { label: 'NaHCO₃', eqMass: 84.01, cat: 'Na', catMass: 22.99, carbon: 1 }
};

/* ------------------------------------------------------------------ carbonate chemistry
   Plummer & Busenberg (1982) for K1, K2, KH; Stumm & Morgan (1996) for Kw.   */
export function carbConst(T) {
  const Tk = T + 273.15, lg = Math.log10(Tk);
  const K1 = Math.pow(10, -356.3094 - 0.06091964 * Tk + 21834.37 / Tk + 126.8339 * lg - 1684915 / (Tk * Tk));
  const K2 = Math.pow(10, -107.8871 - 0.03252849 * Tk + 5151.79 / Tk + 38.92561 * lg - 563713.9 / (Tk * Tk));
  const KH = Math.pow(10, 108.3865 + 0.01985076 * Tk - 6919.53 / Tk - 40.45154 * lg + 669365 / (Tk * Tk));
  const Kw = Math.pow(10, -(4470.99 / Tk - 6.0875 + 0.01706 * Tk));
  return { K1, K2, KH, Kw };
}
/** pH from alkalinity (meq L⁻¹) and total inorganic carbon (mmol L⁻¹): charge balance, Newton on pH. */
export function solvePH(alk, ct, K, guess = 7) {
  const f = pH => {
    const H = Math.pow(10, -pH), D = H * H + K.K1 * H + K.K1 * K.K2;
    const a1 = K.K1 * H / D, a2 = K.K1 * K.K2 / D;
    return ct * (a1 + 2 * a2) + 1000 * (K.Kw / H - H) - alk;
  };
  let pH = clamp(guess, 3, 12);
  for (let i = 0; i < 30; i++) {
    const y = f(pH), d = (f(pH + 1e-4) - y) / 1e-4;
    if (!isFinite(d) || Math.abs(d) < 1e-12) break;
    const nx = clamp(pH - y / d, pH - 1, pH + 1);
    if (Math.abs(nx - pH) < 1e-7) { pH = nx; break; }
    pH = nx;
  }
  if (!isFinite(pH) || Math.abs(f(pH)) > 1e-5 * Math.max(1, alk)) { // robust fallback: bisection
    let lo = 2, hi = 13;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; }
    pH = (lo + hi) / 2;
  }
  return pH;
}
export function speciate(alk, ct, T, guess) {
  const K = carbConst(T), pH = solvePH(alk, ct, K, guess);
  const H = Math.pow(10, -pH), D = H * H + K.K1 * H + K.K1 * K.K2;
  return { pH, co2: ct * H * H / D, hco3: ct * K.K1 * H / D, co3: ct * K.K1 * K.K2 / D, K };
}
/** Total inorganic carbon (mmol L⁻¹) of water with alkalinity alk in equilibrium with air. */
export function ctEquilibrium(alk, T, ppm = 425) {
  const K = carbConst(T); const co2 = K.KH * ppm * 1e-6 * 1000; // mmol L⁻¹
  let lo = 0, hi = 50; // find CT such that CO2 speciated = co2
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; const s = speciate(alk, m, T); if (s.co2 > co2) hi = m; else lo = m; }
  return (lo + hi) / 2;
}

/* ------------------------------------------------------------------ fish response functions (Eq. A2) */
export function tauT(T, p = PAR) {
  if (T <= p.Tmin || T >= p.Tmax) return 0.01;
  const x = T < p.Topt ? (p.Topt - T) / (p.Topt - p.Tmin) : (T - p.Topt) / (p.Tmax - p.Topt);
  return Math.exp(-4.6 * Math.pow(x, p.pT));
}
export function sigmaDO(DO, p = PAR) {
  if (DO <= p.DOmin) return 0;
  if (DO < p.DO1) return p.s1 * (DO - p.DOmin) / (p.DO1 - p.DOmin);
  if (DO < p.DOcrit) return p.s1 + (1 - p.s1) * (DO - p.DO1) / (p.DOcrit - p.DO1);
  return 1;
}
export function upsilonUIA(uia, p = PAR) { // uia in mg NH3 L⁻¹
  if (uia <= p.UIAc) return 1;
  if (uia >= p.UIAm) return 0;
  return (p.UIAm - uia) / (p.UIAm - p.UIAc);
}
/** Illustrative mortality hazards (d⁻¹) anchored to tolerance data (Popma & Masser 1999; Atwood et al. 2001). */
export function hazards(DO, uia, no2) {
  const hDO = 3 * clamp((0.3 - DO) / 0.3, 0, 1);
  const hUIA = 0.3 * Math.pow(Math.max(0, uia) / 2, 3); // ≈0 at 0.2, losses over weeks at 1, days at ≥ 2 mg NH₃ L⁻¹
  const hNO2 = Math.LN2 / 4 * Math.pow(Math.max(0, no2) / 8, 4);
  return { hDO, hUIA, hNO2, total: hDO + hUIA + hNO2 };
}

/* ------------------------------------------------------------------ state layout */
const IX = { W: 0, NF: 1, GUT: 2, TAN: 3, NO2: 4, NO3: 5, XA: 6, XN: 7, S: 8, SN: 9, DO: 10, ALK: 11, CT: 12, P0: 13 };
const NCOH = PAR.NC;
const CUM0 = IX.P0 + NCOH; // cumulative trackers follow the plant cohorts
const C = {
  feed: 0, feedN: 1, eatenN: 2, fishN: 3, plantN: 4, sludgeN: 5, denN: 6, exN: 7, base: 8, fishHarv: 9,
  o2air: 10, uneaten: 11, nitr: 12, deaths: 13, sludgeDM: 14, o2fish: 15, o2nit: 16, o2het: 17, excrN: 18, minN: 19, exWater: 20, solidsN: 21
};
const NCUM = 22;
export const NSTATE = CUM0 + NCUM;

/* ------------------------------------------------------------------ the model */
export class AquaponicsModel {
  constructor(ctrl = {}) {
    this.p = Object.assign({}, PAR);
    this.ctrl = Object.assign({ SD: 25, FR: 1.6, PC: 32, T: 26, Vmed: 0.2, eta: 50, Ap: 10.08, kLa: 3, xex: 1.5, base: 'KOH', pHset: 7.2, stagger: true, Wmean: 250 }, ctrl);
    this.t = 0; this.lastPH = 7; this.harvestLettuce = 0; this.lettuceHarvestEvents = [];
    this.plantT = new Float64Array(NCOH); // planting time of each cohort
    this.y = new Float64Array(NSTATE);
    this.reset('mature');
  }
  /* ---------- derived geometry */
  geom(c = this.ctrl) {
    const p = this.p;
    const Vbeds = c.Ap * p.bedDepth;
    const V = p.Vft + p.Vsep + p.Vbf + p.Vsump + Vbeds;
    const Abf = c.Vmed * p.SSA + c.Ap * 1.0 + p.wallArea; // media + raft undersides + walls/pipes, m²
    const XmaxA = p.rAmax * Abf * p.YA / p.muA, XmaxN = p.rNmax * Abf * p.YN / p.muN;
    return { V, Vbeds, Abf, AbfMedia: c.Vmed * p.SSA, XmaxA, XmaxN, nPerCohort: p.dens * c.Ap / NCOH };
  }
  /* ---------- initial states */
  reset(kind = 'mature', { spinup = 90 } = {}) {
    const p = this.p, c = this.ctrl, y = this.y, g = this.geom();
    y.fill(0); this.t = 0; this.harvestLettuce = 0; this.lettuceHarvestEvents = [];
    y[IX.W] = c.Wmean; y[IX.NF] = c.SD * p.Vft * 1000 / c.Wmean;
    const alk0 = p.alkIn, ct0 = ctEquilibrium(alk0, c.T, p.co2ppm);
    y[IX.DO] = doSaturation(c.T); y[IX.ALK] = alk0; y[IX.CT] = ct0; y[IX.NO3] = p.no3In;
    const dt = p.crop / NCOH;
    if (kind === 'new') {
      y[IX.XA] = 2e-5 * g.XmaxA; y[IX.XN] = 2e-5 * g.XmaxN; // a trace of nitrifiers from water and fish
      for (let k = 0; k < NCOH; k++) { this.plantT[k] = k * dt; y[IX.P0 + k] = k === 0 ? p.W0p : 0; }
      this.lastPH = speciate(alk0, ct0, c.T).pH;
      this.mode = 'new';
      return this;
    }
    // mature: start from a plausible state and let the model settle
    y[IX.XA] = 0.3 * g.XmaxA; y[IX.XN] = 0.3 * g.XmaxN; y[IX.TAN] = 0.4; y[IX.NO2] = 0.3; y[IX.NO3] = 40; y[IX.S] = 30 * g.V; y[IX.SN] = 0.036 * y[IX.S];
    y[IX.ALK] = 1.2; y[IX.CT] = 1.45;
    for (let k = 0; k < NCOH; k++) { const age = (k + 0.5) * dt; this.plantT[k] = -age; y[IX.P0 + k] = this.logistic(age); }
    this.lastPH = speciate(y[IX.ALK], y[IX.CT], c.T).pH;
    this.mode = 'mature';
    if (spinup > 0) { this.advance(spinup, { maxDt: 1 / 180 }); }
    // clear cumulative counters so budgets start now
    for (let i = 0; i < NCUM; i++) y[CUM0 + i] = 0;
    this.harvestLettuce = 0; this.lettuceHarvestEvents = [];
    const shift = this.t; this.t = 0; for (let k = 0; k < NCOH; k++) this.plantT[k] -= shift;
    return this;
  }
  logistic(age) { const p = this.p; const A = (p.Wmaxp - p.W0p) / p.W0p; return p.Wmaxp / (1 + A * Math.exp(-p.rP * age)); }
  /* ---------- control changes that act on the state */
  setControls(nc) {
    const old = Object.assign({}, this.ctrl), p = this.p, y = this.y;
    const gOld = this.geom(old);
    Object.assign(this.ctrl, nc);
    const c = this.ctrl, g = this.geom(c);
    if (nc.SD != null && nc.SD !== old.SD) { // restock / remove fish to reach the new density
      y[IX.NF] = c.SD * p.Vft * 1000 / Math.max(1, y[IX.W]);
    }
    if (g.V !== gOld.V) { // raft beds changed: new water enters at make-up quality (or water leaves)
      const f = gOld.V / g.V, inF = 1 - f;
      if (g.V > gOld.V) {
        const ctIn = ctEquilibrium(p.alkIn, c.T, p.co2ppm);
        y[IX.TAN] *= f; y[IX.NO2] *= f; y[IX.NO3] = y[IX.NO3] * f + p.no3In * inF; y[IX.S] *= 1; y[IX.DO] = y[IX.DO] * f + doSaturation(c.T) * inF;
        y[IX.ALK] = y[IX.ALK] * f + p.alkIn * inF; y[IX.CT] = y[IX.CT] * f + ctIn * inF;
      }
    }
    if (g.Abf < gOld.Abf) { const r = g.Abf / gOld.Abf; y[IX.XA] *= r; y[IX.XN] *= r; }
    return this;
  }
  /* ---------- the right-hand side: returns derivative and (optionally) the flux table */
  fluxes(t, y, out) {
    const p = this.p, c = this.ctrl, g = this.geom(c);
    const V = g.V, T = c.T;
    const W = Math.max(1, y[IX.W]), NF = Math.max(0, y[IX.NF]);
    const TAN = Math.max(0, y[IX.TAN]), NO2 = Math.max(0, y[IX.NO2]), NO3 = Math.max(0, y[IX.NO3]);
    const DO = Math.max(0, y[IX.DO]), XA = Math.max(0, y[IX.XA]), XN = Math.max(0, y[IX.XN]);
    const S = Math.max(0, y[IX.S]), SN = Math.max(0, y[IX.SN]), GUT = Math.max(0, y[IX.GUT]);
    const sp = speciate(y[IX.ALK], Math.max(1e-6, y[IX.CT]), T, this.lastPH);
    const pH = sp.pH;
    const fNH3 = nh3Fraction(pH, T), NH3N = TAN * fNH3, UIA = NH3N * 17.031 / 14.007;
    const DOsat = doSaturation(T);
    // ---- fish: feeding window, satiation, gut (Eqs. A1–A3)
    const tod = t - Math.floor(t);
    const win = p.feedOff - p.feedOn;
    const feeding = tod >= p.feedOn && tod < p.feedOff ? 1 / win : 0; // offered feed is spread over the window
    const tau = tauT(T, p), sig = sigmaDO(DO, p), ups = upsilonUIA(UIA, p);
    const Imax = p.aI * Math.pow(W, p.bI) * tau * sig * ups;            // g fish⁻¹ d⁻¹ (daily capacity)
    const offered = c.FR / 100 * W * NF;                                   // g d⁻¹ (daily ration)
    const offerRate = offered * feeding, capRate = Imax * NF * feeding;   // instantaneous rates
    const eatRate = Math.min(offerRate, capRate), uneatRate = offerRate - eatRate;
    const gutOut = GUT / p.tauGut;                                        // feed processed, g d⁻¹ (whole stock)
    const Mfish = p.cM * Math.pow(W, 0.8) * Math.pow(p.Q10, (T - p.TrefM) / 10); // maintenance ration, g fish⁻¹ d⁻¹
    const proc = gutOut / Math.max(1e-9, NF);                             // processed feed per fish
    const ME = p.DE * p.fME;
    const Gfish = proc >= Mfish ? p.eg * (proc - Mfish) : -(Mfish - proc) * ME / p.Efish; // g fish⁻¹ d⁻¹ (Eq. A3)
    const Gtot = Gfish * NF;
    const o2Fish = NF * (proc * ME - Gfish * p.Efish) / p.Qox;             // Eq. A5
    const co2Fish = p.RQ * (44.01 / 32) * o2Fish;                          // g CO₂ d⁻¹
    const PCf = c.PC / 100, nFeed = PCf / 6.25;                           // g N (g feed)⁻¹
    const nAbs = p.fAbs * gutOut * nFeed;                                  // absorbed N, g d⁻¹
    const nRet = Gtot > 0 ? Gtot * p.nFish : 0;                            // N retained in growth
    const nCat = Gtot < 0 ? -Gtot * p.nFish : 0;                           // N released by catabolism of tissue
    const excrN = Math.max(0, nAbs - nRet) + nCat;                         // TAN excretion (urea lumped), Eq. A4
    const faecN = (1 - p.fAbs) * gutOut * nFeed;
    const faecDM = (1 - p.adcDM) * gutOut * p.dmFeed;
    const unN = uneatRate * nFeed, unDM = uneatRate * p.dmFeed;
    // ---- solids: capture in the swirl separator vs. suspension (Eq. A6)
    const eta = c.eta / 100;
    const capDM = eta * (faecDM + unDM), capN = eta * (faecN + unN);
    const kmin = p.kMin * Math.pow(p.thMin, T - 20);
    const minDM = kmin * S, minN = kmin * SN;
    const o2Het = p.o2Sol * minDM, co2Het = (44.01 / 32) * o2Het;
    // ---- nitrifiers (Eq. A7)
    const thT = Math.pow(p.th, T - 20);
    const fpH = 1 / (1 + Math.pow(10, p.pH50 - pH));
    const qA = p.muA / p.YA * thT * TAN / (p.KA + TAN) * DO / (p.KOA + DO) * fpH; // g N (g X)⁻¹ d⁻¹
    const qN = p.muN / p.YN * thT * NO2 / (p.KN + NO2) * DO / (p.KON + DO) * fpH;
    const rA = qA * XA, rN = qN * XN;                                      // g N d⁻¹
    const lossA = (p.b + (p.muA - p.b) * XA / Math.max(1e-9, g.XmaxA)) * thT; // decay + detachment
    const lossN = (p.b + (p.muN - p.b) * XN / Math.max(1e-9, g.XmaxN)) * thT;
    // ---- lettuce (Eq. A9)
    const Nav = TAN + NO3;
    const fN = Nav / (p.KNp + Nav);
    const fDOp = clamp((DO - 2.5) / 1.5, 0, 1);
    const fTp = T > 25 ? Math.max(0.2, 1 - 0.05 * (T - 25)) : T < 15 ? Math.max(0.2, 1 - 0.06 * (15 - T)) : 1;
    const dWp = new Float64Array(NCOH); let growFW = 0, standFW = 0;
    for (let k = 0; k < NCOH; k++) {
      const Wk = Math.max(0, y[IX.P0 + k]);
      const d = Wk > 0 ? p.rP * Wk * (1 - Wk / p.Wmaxp) * fN * fDOp * fTp : 0;
      dWp[k] = d; growFW += d * g.nPerCohort; standFW += Wk * g.nPerCohort;
    }
    const upN = growFW * p.nPlant;
    const upNH4 = Nav > 0 ? upN * TAN / Nav : 0, upNO3 = upN - upNH4;
    // ---- denitrification and water exchange
    const rDen = p.kden * Math.pow(p.thDen, T - 20) * NO3 * V;
    const Q = c.xex / 100 * V;                                             // m³ d⁻¹
    // ---- gas exchange (Eq. A10)
    const kla = (c.kLa + p.kLa0) * 24 * Math.pow(p.thKLa, T - 20);        // d⁻¹
    const o2air = kla * V * (DOsat - DO);
    const co2eq = sp.K.KH * p.co2ppm * 1e-6 * 1000;                       // mmol L⁻¹
    const strip = p.rCO2 * kla * V * (sp.co2 - co2eq);                     // mol d⁻¹ (mmol L⁻¹ × m³ = mol)
    // ---- base dosing: proportional controller on pH (Eq. A11)
    const B = BASES[c.base] || BASES.off;
    const dose = c.base === 'off' ? 0 : p.baseMax * clamp((c.pHset - pH) / 0.1, 0, 1); // eq d⁻¹
    // ---- alkalinity & inorganic carbon (Eq. A11)
    const alkN = -2 * rA / 14.007 * 0.99   // nitrification: 1.98 eq per mol N (7.07 g CaCO₃ g⁻¹ N)
      + upNO3 / 14.007 - upNH4 / 14.007     // root OH⁻/H⁺ release balancing anion/cation uptake
      + rDen / 14.007;                      // denitrification returns 1 eq per mol N
    const ctKey = T + '|' + p.alkIn;
    if (this._ctKey !== ctKey) { this._ctKey = ctKey; this._ctIn = ctEquilibrium(p.alkIn, T, p.co2ppm); }
    const ctIn = this._ctIn;
    const dALK = (alkN + dose + Q * (p.alkIn - y[IX.ALK])) / V;
    const dCT = ((co2Fish + co2Het) / 44.01 - strip + dose * B.carbon + Q * (ctIn - y[IX.CT])) / V;
    // ---- mortality (illustrative hazards)
    const hz = hazards(DO, UIA, NO2);
    // ---- derivatives
    const dy = out || new Float64Array(NSTATE);
    dy.fill(0);
    dy[IX.W] = c.stagger ? Math.min(0, Gfish) : Gfish; // staggered harvest removes all positive growth
    dy[IX.NF] = -hz.total * NF;
    dy[IX.GUT] = eatRate - gutOut;
    dy[IX.TAN] = (excrN + minN - rA - upNH4 - Q * TAN) / V;
    dy[IX.NO2] = (rA - rN - Q * NO2) / V;
    dy[IX.NO3] = (rN - upNO3 - rDen + Q * (p.no3In - NO3)) / V;
    dy[IX.XA] = p.YA * rA - lossA * XA;
    dy[IX.XN] = p.YN * rN - lossN * XN;
    dy[IX.S] = (1 - eta) * (faecDM + unDM) - minDM - Q * S / V;
    dy[IX.SN] = (1 - eta) * (faecN + unN) - minN - Q * SN / V;
    dy[IX.DO] = (o2air - o2Fish - 3.43 * rA - 1.14 * rN - o2Het + Q * (DOsat - DO)) / V;
    dy[IX.ALK] = dALK; dy[IX.CT] = dCT;
    for (let k = 0; k < NCOH; k++) dy[IX.P0 + k] = dWp[k];
    const cum = CUM0;
    dy[cum + C.feed] = offerRate; dy[cum + C.feedN] = offerRate * nFeed; dy[cum + C.eatenN] = eatRate * nFeed;
    dy[cum + C.fishN] = nRet - nCat; dy[cum + C.plantN] = upN; dy[cum + C.sludgeN] = capN; dy[cum + C.denN] = rDen;
    dy[cum + C.exN] = Q * (TAN + NO2 + NO3 - p.no3In); dy[cum + C.base] = dose; dy[cum + C.fishHarv] = c.stagger ? Math.max(0, Gtot) : 0;
    dy[cum + C.o2air] = o2air; dy[cum + C.uneaten] = uneatRate; dy[cum + C.nitr] = rN; dy[cum + C.deaths] = hz.total * NF;
    dy[cum + C.sludgeDM] = capDM; dy[cum + C.o2fish] = o2Fish; dy[cum + C.o2nit] = 3.43 * rA + 1.14 * rN; dy[cum + C.o2het] = o2Het;
    dy[cum + C.excrN] = excrN; dy[cum + C.minN] = minN; dy[cum + C.exWater] = Q; dy[cum + C.solidsN] = faecN + unN;
    if (out === undefined) return dy;
    // detailed flux table for the user interface
    this.F = {
      pH, fNH3, NH3N, UIA, DOsat, co2: sp.co2 * 44.01, hco3: sp.hco3, tau, sig, ups, Imax, offered, eatRate, uneatRate, gutOut,
      Gfish, Gtot, Mfish, o2Fish, co2Fish, excrN, faecN, faecDM, unN, unDM, capDM, capN, minDM, minN, o2Het,
      qA, qN, rA, rN, fpH, upN, upNH4, upNO3, standFW, growFW, fN, fDOp, fTp, rDen, Q, kla, o2air, strip, dose, alkN,
      hz, V, g, feeding, TAN, NO2, NO3, DO, W, NF, XA, XN, S, SN
    };
    return dy;
  }
  /* ---------- time stepping with RK4 sub-steps and discrete events */
  advance(dtTotal, { maxDt = 1 / 360, record = true, onSample } = {}) {
    const p = this.p;
    let rem = dtTotal;
    const f = (t, yy) => this.fluxes(t, Float64Array.from(yy));
    while (rem > 1e-9) {
      const d = Math.min(rem, maxDt);
      const yNew = rk4(f, this.t, Array.from(this.y), d);
      for (let i = 0; i < NSTATE; i++) this.y[i] = yNew[i];
      this.t += d; rem -= d;
      // keep non-negative states physical
      for (const i of [IX.GUT, IX.TAN, IX.NO2, IX.NO3, IX.XA, IX.XN, IX.S, IX.SN, IX.DO]) if (this.y[i] < 0) this.y[i] = 0;
      if (this.y[IX.CT] < 1e-6) this.y[IX.CT] = 1e-6; // alkalinity may become negative (mineral acidity)
      this.lastPH = speciate(this.y[IX.ALK], this.y[IX.CT], this.ctrl.T, this.lastPH).pH;
      this.events();
      if (onSample) onSample(this);
    }
    return this;
  }
  events() {
    const p = this.p, y = this.y, g = this.geom();
    for (let k = 0; k < NCOH; k++) {
      const age = this.t - this.plantT[k];
      if (y[IX.P0 + k] <= 0 && age >= 0) { y[IX.P0 + k] = p.W0p; }               // first planting (start-up)
      else if (age >= p.crop) {                                                  // harvest and replant
        const fw = y[IX.P0 + k] * g.nPerCohort;
        this.harvestLettuce += fw; this.lettuceHarvestEvents.push({ t: this.t, fw, W: y[IX.P0 + k] });
        if (this.lettuceHarvestEvents.length > 400) this.lettuceHarvestEvents.shift();
        y[IX.P0 + k] = p.W0p; this.plantT[k] += p.crop;
      }
    }
  }
  /** Convenience accessors for the user interface. */
  get state() {
    const y = this.y; const cum = {}; Object.entries(C).forEach(([k, i]) => cum[k] = y[CUM0 + i]);
    const cohorts = []; for (let k = 0; k < NCOH; k++) cohorts.push({ W: y[IX.P0 + k], age: this.t - this.plantT[k] });
    return { t: this.t, W: y[IX.W], NF: y[IX.NF], GUT: y[IX.GUT], TAN: y[IX.TAN], NO2: y[IX.NO2], NO3: y[IX.NO3], XA: y[IX.XA], XN: y[IX.XN], S: y[IX.S], SN: y[IX.SN], DO: y[IX.DO], ALK: y[IX.ALK], CT: y[IX.CT], cohorts, cum, lettuce: this.harvestLettuce };
  }
  diagnostics() { const tmp = new Float64Array(NSTATE); this.fluxes(this.t, this.y, tmp); return this.F; }
}
export { IX, C as CUMIDX, CUM0, NCOH };
