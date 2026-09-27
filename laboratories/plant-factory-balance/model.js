/* ==========================================================================
   Plant factory energy, water and CO₂ balance — the physical model.
   Pure functions (no DOM) so that the same code runs in the page and in tests.
   Every equation is documented in the Derive tab (Eqs. PF1–PF11).
   ========================================================================== */
import { svp, svpSlope, humidityRatio, dewPoint, airDensity, latentHeat, psychroConst, CP_AIR, K0, P0 } from '/assets/js/physics.js';

/* ------------------------------------------------------------ constants (sources in the Assumptions tab) */
export const MU_PAR = 4.9;      // µmol of PAR photons per joule of PAR radiant energy, typical horticultural LED spectrum (≈ 8.36e-3·λ̄, λ̄ ≈ 586 nm)
export const Q_DW = 17.5e3;     // J per g of dry matter (heat of combustion, same value as Lesson 8.1)
export const F_ROOT = 0.10;     // roots as share of total dry matter (Kozai, 2013: < 10 %)
export const F_C = 0.40;        // carbon fraction of lettuce dry matter (Anderson et al., 2018, BVAD Table 4-119)
export const GAMMA_C = 50, K_C = 237, C_REF = 1000, C_OUT = 427;   // CO₂ response, Lesson 8.3 Eq. 8.3.2 (Kimball-calibrated)
export const ETA_C = 0.40, DT_CD = 15, COP_MAX = 10;              // Carnot-fraction COP model, Lesson 7.2 Eq. 7.2.7
export const T_SUPPLY = 35;     // °C, supply temperature when the heat pump heats
export const NIGHT_GS = 0.10;   // night-time canopy conductance as a fraction of the day value
export const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* Monthly climate normals: mean daily maximum, mean, mean daily minimum (°C) and mean RH (%).
   Where RH is not published in the same table, the FAO-56 rule e_a ≈ e°(T_min) is used. */
export const CLIMATES = {
  vasteras: { lat: 59.6, label: 'Västerås, Sweden (59.6° N)', src: 'SMHI Åkesta 2003–2018',
    tmax: [-0.3, 0.2, 4.5, 11.6, 16.8, 20.1, 23.2, 21.3, 16.7, 10.0, 5.1, 1.8],
    tmean: [-2.8, -2.6, 0.6, 6.5, 11.6, 15.2, 18.4, 17.0, 12.8, 6.9, 2.9, -0.5],
    tmin: [-5.2, -5.3, -3.3, 1.3, 6.3, 10.3, 13.5, 12.6, 8.8, 3.8, 0.6, -2.8], rh: null },
  kiruna: { lat: 67.8, label: 'Kiruna, Sweden (67.8° N)', src: 'SMHI Kiruna Airport 2002–2021',
    tmax: [-7.9, -6.7, -2.4, 3.1, 8.9, 14.8, 18.5, 15.9, 10.2, 2.5, -2.8, -5.1],
    tmean: [-12.4, -11.2, -7.1, -1.3, 4.7, 10.3, 13.8, 11.5, 6.5, -0.7, -6.5, -9.3],
    tmin: [-16.8, -15.7, -11.8, -5.6, 0.5, 5.7, 9.1, 7.0, 2.7, -3.8, -10.1, -13.4], rh: null },
  debilt: { lat: 52.1, label: 'De Bilt, Netherlands (52.1° N)', src: 'KNMI De Bilt 1991–2020',
    tmax: [6.1, 7.0, 10.5, 14.8, 18.3, 20.9, 23.1, 22.9, 19.5, 14.8, 9.9, 6.7],
    tmean: [3.6, 3.9, 6.5, 9.8, 13.4, 16.2, 18.3, 17.9, 14.7, 10.9, 7.0, 4.2],
    tmin: [0.9, 0.7, 2.4, 4.5, 8.0, 10.8, 13.0, 12.5, 10.0, 7.1, 3.9, 1.6],
    rh: [87, 84, 79, 74, 74, 75, 77, 79, 83, 86, 89, 89] },
  abudhabi: { lat: 24.4, label: 'Abu Dhabi, UAE (24.4° N)', src: 'Abu Dhabi Intl Airport 1991–2020 (NCM/NOAA)',
    tmax: [24.5, 26.5, 29.7, 35.0, 39.6, 41.4, 42.5, 43.4, 40.9, 36.6, 31.0, 26.5],
    tmean: [19.1, 20.6, 23.4, 27.7, 31.8, 33.7, 35.5, 35.9, 33.3, 29.7, 25.2, 21.1],
    tmin: [13.8, 15.9, 17.5, 21.1, 24.6, 26.9, 29.7, 30.2, 27.4, 23.7, 19.6, 15.7],
    rh: [68, 66, 61, 53, 50, 54, 55, 54, 60, 62, 65, 69] },
  singapore: { lat: 1.4, label: 'Singapore (1.4° N)', src: 'NEA Changi 1991–2020',
    tmax: [30.6, 31.5, 32.2, 32.4, 32.3, 31.9, 31.4, 31.4, 31.6, 31.8, 31.2, 30.5],
    tmean: [26.8, 27.3, 27.8, 28.2, 28.6, 28.5, 28.2, 28.1, 28.0, 27.9, 27.2, 26.8],
    tmin: [24.3, 24.6, 24.9, 25.3, 25.7, 25.7, 25.4, 25.3, 25.2, 25.0, 24.6, 24.3],
    rh: [83.5, 81.2, 81.7, 82.6, 82.3, 80.9, 80.9, 80.7, 80.7, 81.5, 84.9, 85.5] }
};

/* Grid emission factors, life-cycle, g CO₂e per kWh (Ember via Our World in Data, 2025 values). */
export const GRIDS = {
  se: { label: 'Sweden (35 g)', ef: 35 },
  eu: { label: 'EU-27 average (210 g)', ef: 210 },
  pl: { label: 'Poland, coal-heavy (589 g)', ef: 589 },
  custom: { label: 'Custom', ef: null }
};
/* Emission factor of the supplied CO₂ (Lesson 8.3, Eq. 8.3.9), kg CO₂e per kg supplied. */
export const CO2SRC = {
  byproduct: { label: 'By-product or biogenic (0)', ef: () => 0 },
  fossil: { label: 'Fossil gas burned for CO₂ (1.17)', ef: () => 1.17 },
  dac: { label: 'Direct air capture (2 kWh kg⁻¹)', ef: grid => 2.0 * grid / 1000 }
};

/** CO₂ response of canopy photosynthesis, Lesson 8.3 Eq. 8.3.2. */
export const fCO2 = C => (C - GAMMA_C) / (C - GAMMA_C + K_C);
/** Mass of CO₂ per m³ of air per ppm, g m⁻³ ppm⁻¹ (ideal gas law, Lesson 8.3 Eq. 8.3.1). */
export const kCO2 = (T, P = P0) => 44.01 * P * 1000 / (8.314462618 * (T + K0)) * 1e-6;
/** Carnot-fraction COP of a chiller with coil temperature Tc and outdoor temperature To (Lesson 7.2 Eq. 7.2.7). */
export const copCool = (Tc, To) => Math.min(ETA_C * (Tc + K0) / Math.max(1, (To + DT_CD) - Tc), COP_MAX);
/** Heating COP of an air-source heat pump delivering T_SUPPLY from outdoor air (same Carnot-fraction idea). */
export const copHeat = To => Math.max(1, Math.min(5, ETA_C * (T_SUPPLY + K0) / Math.max(1, T_SUPPLY - (To - 5))));
/** Penman–Monteith latent heat flux, W m⁻² (Lesson 2.2 Eq. 2.2.9). ga, gs in m s⁻¹. */
export function penmanMonteith(Rn, T, rh, ga, gs) {
  const es = svp(T), D = es * (1 - rh / 100), De = svpSlope(T), gam = psychroConst(P0);
  const rho = airDensity(T, rh), cp = CP_AIR;
  return (De * Rn + rho * cp * D * ga) / (De + gam * (1 + ga / Math.max(gs, 1e-6)));
}

/** Geometry of the growing room. */
export function geometry(p) {
  const A_cult = p.floor * p.tiers * p.rack;
  const H = 1.0 + 0.45 * p.tiers;               // room height: 0.45 m tier pitch + 1 m plenum/access
  const L = Math.sqrt(p.floor);
  return { A_cult, H, L, A_walls: 4 * L * H, A_roof: p.floor, V: p.floor * H };
}

/** Lighting: incident PPFD at the canopy and electrical power density (per m² cultivation area). */
export function lighting(p) {
  let ppfd, pd;
  if (p.lmode === 'power') { pd = p.pd; ppfd = pd * p.eff * p.util; }
  else { ppfd = p.ppfd; pd = ppfd / (p.eff * p.util); }
  return { ppfd, pd, dli: ppfd * p.photo * 0.0036 };
}

/** Fraction of clock hour h (0–23) during which the lamps are on. */
export function litFraction(h, start, photo) {
  if (photo >= 24) return 1;
  let f = 0;
  for (const off of [-24, 0, 24]) { const a = start + off, b = a + photo; f += Math.max(0, Math.min(h + 1, b) - Math.max(h, a)); }
  return Math.min(1, f);
}

/**
 * Annual balance. p: parameter object (see main.js). Returns totals (SI and kWh), monthly and
 * hourly (per month) records for the charts and the animated schematic.
 */
export function compute(p, opts = {}) {
  const G = geometry(p), Lg = lighting(p), clim = CLIMATES[p.site];
  const A = G.A_cult;
  const P_led = Lg.pd * A;                              // W
  const PAR_emit = P_led * p.eff / MU_PAR;              // W radiant PAR
  const PAR_inc = PAR_emit * p.util;
  const PAR_abs = PAR_inc * p.absorb;
  const P_aux = p.aux / 100 * P_led * p.photo / 24;     // W, continuous (pumps, fans, controls)
  const lueEff = p.lue * fCO2(p.co2) / fCO2(C_REF);    // g DW (shoot) per mol incident photons
  const molPerLitHour = Lg.ppfd * A * 3600 / 1e6;        // mol of incident photons per lit hour
  const dwShootLitH = lueEff * molPerLitHour;             // g h⁻¹ while lit
  const dwTotLitH = dwShootLitH / (1 - F_ROOT);
  const chemLit = dwTotLitH * Q_DW / 3600;                // W stored while lit
  const Tin = p.tin, rhIn = p.rh;
  const ein = svp(Tin) * rhIn / 100, Win = humidityRatio(ein);
  const lam = latentHeat(Tin);
  const rhoIn = airDensity(Tin, rhIn);
  const Tdew = dewPoint(Tin, rhIn);
  const Tcs = p.coil === 'split' ? Tdew + 1 : Tdew - 5;   // sensible coil temperature
  const Tcl = Tdew - 5;                                   // latent (dehumidifying) coil temperature
  const mAir = rhoIn * p.leak * G.V / 3600;               // kg s⁻¹ of air exchanged with outside
  const kC = kCO2(Tin);
  const leakCO2 = kC * p.leak * G.V * Math.max(0, p.co2 - C_OUT);   // g h⁻¹
  const UAair = p.U * (G.A_walls + G.A_roof), UAfloor = p.U * G.A_roof;
  const Tground = clim.tmean.reduce((a, b) => a + b, 0) / 12;
  // transpiration per m² of cultivation area (W m⁻² latent)
  let lEday, lEnight;
  if (p.tmode === 'fixed') {
    const Jd = p.et * lam / 86400;     // mean latent flux over 24 h, W m⁻²
    const fr = Math.min(0.99, p.photo / 24);
    // 90 % of the daily water is transpired in the light (assumption), 10 % in the dark
    lEday = p.photo >= 24 ? Jd : 0.9 * p.et * lam / (p.photo * 3600);
    lEnight = p.photo >= 24 ? Jd : 0.1 * p.et * lam / ((24 - p.photo) * 3600);
    if (fr <= 0) lEnight = Jd;
  } else {
    const Rn = PAR_abs / A;
    lEday = penmanMonteith(Rn, Tin, rhIn, p.ga / 1000, p.gs / 1000);
    lEnight = penmanMonteith(0, Tin, rhIn, p.ga / 1000, NIGHT_GS * p.gs / 1000);
  }
  const acc = () => ({ Eled: 0, Eaux: 0, Ehvac: 0, Eheat: 0, Qs: 0, Ql: 0, Qheat: 0, Qrec: 0, Qamb: 0, fix: 0, missRefl: 0, parEmit: 0, parAbs: 0, chem: 0, lat: 0, c2l: 0,
    HcPos: 0, HcNeg: 0, envGain: 0, envLoss: 0, latIn: 0, latLeak: 0, humid: 0, trans: 0, condT: 0, condOut: 0, vapLeak: 0, dw: 0, co2fix: 0, co2leak: 0, mol: 0, hours: 0 });
  const tot = acc();
  const months = [];
  let peakCool = 0, peakHeat = 0;
  for (let m = 0; m < 12; m++) {
    const mo = acc(); mo.hourly = [];
    const d = DAYS[m];
    const ea = clim.rh ? clim.rh[m] / 100 * (svp(clim.tmax[m]) + svp(clim.tmin[m])) / 2 : svp(clim.tmin[m]);
    const Wout = humidityRatio(ea);
    for (let h = 0; h < 24; h++) {
      const To = clim.tmean[m] + (clim.tmax[m] - clim.tmin[m]) / 2 * Math.cos(2 * Math.PI * (h + 0.5 - 15) / 24);
      const f = litFraction(h, p.start, p.photo);
      const lE = (f * lEday + (1 - f) * lEnight) * A;          // W
      const ET = lE / lam;                                      // kg s⁻¹
      const chem = f * chemLit;
      const Hc = f * PAR_abs - chem - lE;                        // canopy → air sensible (W), may be < 0
      const Qfix = f * (P_led - PAR_emit);                       // fixture heat
      const Qmiss = f * (PAR_emit - PAR_abs);                    // missed + reflected light
      const Qenv = UAair * (To - Tin) + UAfloor * (Tground - Tin);
      const Qinf = mAir * CP_AIR * (To - Tin);
      const S = Qfix + Qmiss + P_aux + Hc + Qenv + Qinf;
      const Qs = Math.max(0, S), Qh = Math.max(0, -S);
      const Vinf = mAir * (Wout - Win);                          // kg s⁻¹ vapour brought in (>0) or out (<0)
      const Vc = ET + Vinf;
      const cond = Math.max(0, Vc), humid = Math.max(0, -Vc);
      const Ql = lam * cond;
      const cs = p.copMode === 'fixed' ? p.cops : copCool(Tcs, To);
      const cl = p.copMode === 'fixed' ? p.copl : copCool(Tcl, To);
      const Ehvac = Qs / cs + Ql / cl;
      const ch = copHeat(To);
      // heat recovery: the condenser of the cooling/dehumidifying heat pump can reheat the room air
      const Qrec = p.reheat ? Math.min(Qh, Qs + Ql + Ehvac) : 0;
      const Eheat = (Qh - Qrec) / ch;
      peakCool = Math.max(peakCool, Qs + Ql); peakHeat = Math.max(peakHeat, Qh);
      // vapour routing for the Sankey
      let condT, condOut, vapLeak;
      if (Vinf >= 0) { condT = ET; condOut = Vinf; vapLeak = 0; }
      else { vapLeak = Math.min(-Vinf, ET); condT = ET - vapLeak; condOut = 0; }
      const envNet = Qenv + Qinf;
      const rec = {
        h, To, f, lE, ET, chem, Hc, Qs, Ql, Qh, Qrec, cs, cl, ch, Ehvac, Eheat, cond, humid, Vinf,
        Pled: f * P_led, Paux: P_aux, Pheat: Qh, envNet, co2fix: f * dwTotLitH * F_C * 44 / 12, co2leak: leakCO2
      };
      mo.hourly.push(rec);
      const sec = 3600 * d;
      const add = (o) => {
        o.Eled += f * P_led * sec; o.Eaux += P_aux * sec; o.Ehvac += Ehvac * sec; o.Eheat += Eheat * sec;
        o.Qs += Qs * sec; o.Ql += Ql * sec; o.Qheat += (Qh - Qrec) * sec; o.Qrec += Qrec * sec; o.Qamb += (Qh - Qrec - Eheat) * sec;
        o.fix += Qfix * sec; o.missRefl += Qmiss * sec; o.parEmit += f * PAR_emit * sec; o.parAbs += f * PAR_abs * sec;
        o.chem += chem * sec; o.lat += lE * sec; o.c2l += Math.max(0, Math.min(lE, f * PAR_abs - chem)) * sec; o.HcPos += Math.max(0, Hc) * sec; o.HcNeg += Math.max(0, -Hc) * sec;
        o.envGain += Math.max(0, envNet) * sec; o.envLoss += Math.max(0, -envNet) * sec;
        o.latIn += lam * condOut * sec; o.latLeak += lam * vapLeak * sec; o.humid += humid * sec;
        o.trans += ET * sec; o.condT += condT * sec; o.condOut += condOut * sec; o.vapLeak += (vapLeak + humid) * sec;
        o.dw += f * dwShootLitH * d; o.co2fix += f * dwTotLitH * F_C * 44 / 12 * d; o.co2leak += leakCO2 * d;
        o.mol += f * molPerLitHour * d; o.hours += d;
      };
      add(mo); add(tot);
    }
    months.push(mo);
  }
  /* ---------- derived annual quantities ---------- */
  const J2kWh = 1 / 3.6e6;
  const shootDW = tot.dw;                                   // g yr⁻¹
  const fwHarv = shootDW / (p.dmc / 100) / 1000;            // kg fresh shoot harvested
  const fwMkt = fwHarv * p.mkt;                             // kg marketable
  const dwMkt = fwMkt * p.dmc / 100;                        // kg marketable dry weight
  const E = { led: tot.Eled * J2kWh, aux: tot.Eaux * J2kWh, hvac: tot.Ehvac * J2kWh, heat: tot.Eheat * J2kWh };
  E.tot = E.led + E.aux + E.hvac + E.heat;
  const Qcool = (tot.Qs + tot.Ql) * J2kWh;
  // water (kg = L)
  const Wplant = fwHarv * (1 - p.dmc / 100);                // water leaving in harvested shoots
  const uptake = tot.trans + Wplant;
  const bleed = p.bleed / 100 * uptake;
  const irrig = uptake + bleed;
  const cond = tot.condT + tot.condOut;
  const recyc = p.rec / 100 * cond, discard = cond - recyc;
  const fresh = irrig - recyc + tot.humid;
  const wue = (recyc + Wplant) / irrig;
  // CO₂ (g → kg)
  const co2fix = tot.co2fix / 1000, co2leak = tot.co2leak / 1000, co2sup = co2fix + co2leak;
  const ef = p.grid === 'custom' ? p.efCustom : GRIDS[p.grid].ef;          // g kWh⁻¹
  const efCO2 = CO2SRC[p.co2src].ef(ef);                                   // kg CO₂e per kg CO₂
  const footEl = E.tot * ef / 1000 / fwMkt, footCO2 = co2sup * efCO2 / fwMkt;
  return {
    p, G, Lg, A, P_led, PAR_emit, PAR_abs, P_aux, lueEff, lEday, lEnight, Tdew, Tcs, Tcl, lam, tot, months, E, Qcool,
    kWh: { led: E.led, aux: E.aux, hvac: E.hvac, heat: E.heat, parEmit: tot.parEmit * J2kWh, parAbs: tot.parAbs * J2kWh,
      fix: tot.fix * J2kWh, missRefl: tot.missRefl * J2kWh, chem: tot.chem * J2kWh, lat: tot.lat * J2kWh, c2l: tot.c2l * J2kWh,
      HcPos: tot.HcPos * J2kWh, HcNeg: tot.HcNeg * J2kWh, envGain: tot.envGain * J2kWh, envLoss: tot.envLoss * J2kWh,
      Qs: tot.Qs * J2kWh, Ql: tot.Ql * J2kWh, Qheat: tot.Qheat * J2kWh, Qrec: tot.Qrec * J2kWh, Qamb: tot.Qamb * J2kWh, latIn: tot.latIn * J2kWh, latLeak: tot.latLeak * J2kWh },
    fwHarv, fwMkt, dwMkt, shootDW,
    yieldArea: fwMkt / A, yieldFloor: fwMkt / p.floor,
    kWhPerKg: E.tot / fwMkt, kWhPerKgDW: E.tot / dwMkt, kWhPerMol: E.tot / tot.mol,
    lightShare: E.led / E.tot, scop: E.hvac > 0 ? Qcool / E.hvac : NaN,
    latentShare: Qcool > 0 ? tot.Ql / (tot.Qs + tot.Ql) : 0,
    peakCool: peakCool / 1000, peakHeat: peakHeat / 1000,
    water: { trans: tot.trans, condT: tot.condT, condOut: tot.condOut, cond, recyc, discard, vapLeak: tot.vapLeak, humid: tot.humid, Wplant, bleed, irrig, fresh, wue, perKg: fresh / fwMkt, transPerKg: tot.trans / fwMkt },
    co2: { fix: co2fix, leak: co2leak, sup: co2sup, cue: co2fix / co2sup, perKg: co2sup * 1000 / fwMkt, kC },
    foot: { el: footEl, co2: footCO2, tot: footEl + footCO2, ef, efCO2 },
    chemShare: tot.chem / (tot.Eled + tot.Eaux + tot.Ehvac + tot.Eheat),
    photoEff: tot.chem / tot.parAbs,
    etDay: tot.trans / A / 365
  };
}
