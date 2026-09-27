/* ==========================================================================
   Greenhouse climate model — lumped, dynamic, per m² of greenhouse floor
   Future Food Production · Laboratory "Greenhouse climate simulator"

   States (integrated with RK4, Δt = 60 s):
     T   air + canopy temperature (°C)                          Eq. G1
     Tf  floor (concrete + top soil) temperature (°C)           Eq. G1
     W   humidity ratio of the greenhouse air (kg kg⁻¹)         Eq. G7
     C   CO₂ concentration (ppm = µmol mol⁻¹)                   Eq. G10
     u   roof-vent opening (0–1), s screen closure (0–1)        Eq. G11 (actuators)
     z   integral of the heating error (K s)                    Eq. G11 (PI heating)
   Quasi-steady (algebraic) nodes:
     Tc   cover temperature: energy balance with sky radiation, wind and
          condensation (Eq. G2); Tcan canopy temperature from the Stanghellini
          (1987) Penman–Monteith form (Eq. G6); Tp pipe temperature (Eq. G4).
   Parameters: Dutch Venlo reference greenhouse of Vanthoor et al. (2011a,
   Tables 8.1–8.2) and tomato crop of Vanthoor et al. (2011b), taken from the
   open-source GreenLight implementation (Katzin et al., 2020), unless noted.
   Geometry (A_cov/A_flr = 1.25, mean height 5.5 m, τ = 0.72, U ≈ 6) follows
   Lesson 8.1 so that the laboratory and the lesson agree.
   ========================================================================== */
import { svp, svpSlope, humidityRatio, vpFromW, latentHeat, psychroConst, solarElevation, solarAzimuth, dayLength, extraterrestrialRadiation, clearSkyIrradiance, SUN_PPFD_PER_WM2, SIGMA, CP_AIR, K0, clamp } from '/assets/js/physics.js';

/* ------------------------------------------------------------------ parameters */
export const PRM = {
  cov: 1.25,            // A_cov / A_flr (Lesson 8.1; Vanthoor NL: 1.8e4/1.4e4 = 1.29)
  hMean: 5.5,           // m, air volume per floor area (Lesson 8.1)
  tau: 0.72,            // whole-greenhouse transmissivity for global radiation (Lesson 8.1, single glass)
  aRoof: 0.10,          // maximum roof-vent area per floor area (Vanthoor: 1400 m² / 14 000 m²)
  cD: 0.75, cW: 0.09,   // discharge and global wind-pressure coefficients (Vanthoor 2011a)
  hVent: 0.68,          // m, vertical dimension of one vent opening
  cLeak: 1e-4,          // m, leakage coefficient: G_leak = cLeak·max(0.25, v)
  cHecIn: 1.86,         // W m⁻² K⁻¹·³³ inside convective coefficient, cover
  cHecOut1: 2.8, cHecOut2: 1.2,   // outside convective coefficient h = 2.8 + 1.2 v
  epsCov: 0.85,         // FIR emissivity of glass
  kFir: 0.94, k1Par: 0.7, kNir: 0.27,          // extinction coefficients of the canopy
  rhoCanPar: 0.07, rhoCanNir: 0.35,           // canopy reflection
  rhoFlrPar: 0.65, rhoFlrNir: 0.5,            // white floor foil reflection
  etaStr: 0.1,          // fraction of outside global radiation absorbed by the construction (→ air)
  capLeaf: 1200,        // J K⁻¹ m⁻² leaf
  capFlr: 2.14e5,       // J K⁻¹ m⁻²: 2 cm concrete (2300·880·0.02) + 10 cm soil (1.73e6·0.1)
  lPipe: 1.875, dPipe: 0.051, epsPipe: 0.88, tPipeMax: 90,   // 51-mm pipe-rail heating
  rB: 275, rSMin: 82,   // s m⁻¹, boundary-layer and minimum stomatal resistance
  cEvap1: 4.3, cEvap2: 0.54, cEvap3D: 6.1e-7, cEvap3N: 1.1e-11, cEvap4D: 4.3e-6, cEvap4N: 5.2e-6,
  cMV: 6.4e-9,          // kg J⁻¹: Lewis-analogy factor, condensation = cMV·h·Δe(Pa)
  cHecScr: 1.7,         // W m⁻² K⁻¹·³³ convective coefficient air–screen
  kThScr: 0.05e-3,      // m³ m⁻² K⁻⁰·⁶⁶ s⁻¹ air flux through a closed screen
  tauScr: 0.6,          // light transmission of the closed thermal screen
  j25Leaf: 210, alphaJ: 0.385, thetaJ: 0.7, eJ: 37000, hJ: 220000, sJ: 710, cGamma: 1.7, etaStom: 0.67,
  sla: 2.66e-5,         // m² leaf per mg CH₂O (specific leaf area)
  cLeafM: 3.47e-7, cStemM: 1.47e-7, cFruitM: 1.16e-7, q10m: 2, cGrowth: 0.28,
  stemRatio: 0.75, fruitRatio: 1.5,   // ASSUMED organ masses relative to leaf mass (mature crop)
  co2Cap: 7.2e4 / 1.4e4,              // mg m⁻² s⁻¹ CO₂ dosing capacity (≈ 185 kg ha⁻¹ h⁻¹)
  lampPar: 0.55, lampNir: 0.02, lampEff: 2.8,   // LED top-lights (Katzin 2021): fractions of input, µmol J⁻¹
  lampOn: 4, lampOff: 22, lampIoff: 250,        // lamp window (solar h) and switch-off radiation (W m⁻²)
  Co: 426,              // ppm, outside CO₂ (NOAA GML global mean 2025 = 425.6 ppm)
  Patm: 101.3,          // kPa
  scrIon: 50, scrTon: 12,   // screen closes when I_o < 50 W m⁻² and T_o < 12 °C
  kpHeat: 30, tiHeat: 900,  // PI heating controller
  actVent: 60, actScr: 180, // actuator time constants (s): vents and screen motors
  gapMax: 0.1               // maximum screen gap for humidity control
};

/* ------------------------------------------------------------------ climatology (representative days) */
// Västerås: monthly mean temperature SMHI 1991–2020 (station 96350, as Lesson 8.1 Table 2);
//   daily range, dew point, clearness index, 10-m wind and downward long-wave radiation:
//   NASA POWER Climatology API v2.10 (2001–2020), 59.61° N 16.55° E.
// Almería: AEMET normals 1981–2010, Almería Aeropuerto (6325O): Tmax, Tmin, RH;
//   clearness index, wind and long-wave radiation: NASA POWER (36.84° N, 2.46° W).
export const SITES = {
  vasteras: {
    name: 'Västerås', country: 'Sweden', lat: 59.61, lon: 16.55,
    months: {
      jan: { doy: 15, Tmean: -2.2, range: 4.89, Tdew: -5.13, kt: 0.28, wind: 2.44, lw: 23.01, t2m: -4.53 },
      apr: { doy: 105, Tmean: 5.9, range: 8.81, Tdew: 2.39, kt: 0.50, wind: 2.49, lw: 25.15, t2m: 5.76 },
      jul: { doy: 196, Tmean: 18.0, range: 8.74, Tdew: 13.15, kt: 0.49, wind: 2.24, lw: 30.87, t2m: 18.41 }
    }
  },
  almeria: {
    name: 'Almería', country: 'Spain', lat: 36.84, lon: -2.46,
    months: {
      jan: { doy: 15, Tmean: 12.6, Tmax: 16.9, Tmin: 8.3, rh: 67, kt: 0.57, wind: 3.78, lw: 26.89, t2m: 8.41 },
      apr: { doy: 105, Tmean: 17.0, Tmax: 21.4, Tmin: 12.5, rh: 62, kt: 0.60, wind: 4.05, lw: 28.05, t2m: 13.86 },
      jul: { doy: 196, Tmean: 26.1, Tmax: 30.5, Tmin: 21.7, rh: 60, kt: 0.65, wind: 3.59, lw: 31.92, t2m: 25.68 }
    }
  }
};
export const MONTH_NAMES = { jan: 'January', apr: 'April', jul: 'July' };

/** Dew point (°C) from vapour pressure (kPa): inverse of the Tetens equation used in physics.js. */
export function dewFromE(e) { const a = Math.log(Math.max(1e-6, e) / 0.6108); return 237.3 * a / (17.27 - a); }
const esPa = T => 1000 * svp(T);

/** Resolve the climatology of a site and month (Tmax, Tmin, dew point, sky-temperature depression). */
export function monthClimate(site, month) {
  const S = SITES[site], M = S.months[month];
  let Tmax, Tmin, Tdew;
  if (M.Tmax != null) { Tmax = M.Tmax; Tmin = M.Tmin; Tdew = dewFromE(svp(M.Tmean) * M.rh / 100); }
  else { Tmax = M.Tmean + M.range / 2; Tmin = M.Tmean - M.range / 2; Tdew = M.Tdew; }
  const Lw = M.lw * 1e6 / 86400;                        // MJ m⁻² d⁻¹ → W m⁻²
  const dSky = (M.t2m + K0) - Math.pow(Lw / SIGMA, 0.25); // K, mean sky-temperature depression
  return Object.assign({}, M, { Tmax, Tmin, Tdew, dSky, Lw, lat: S.lat, name: S.name });
}

/**
 * Representative hourly weather for one day at 1-min resolution (Eq. G12).
 * p: { site, month, dT (K offset), wind (m s⁻¹), sky: 'clim' | 'clear' }
 */
export function buildWeather(p) {
  const S = SITES[p.site], M = monthClimate(p.site, p.month);
  const lat = S.lat, doy = M.doy, N = 1441;
  const Y = dayLength(lat, doy), tsr = 12 - Y / 2, tss = 12 + Y / 2, Z = 24 - Y;
  const a = 1.86, b = 2.2, c = -0.17;                     // Parton & Logan (1981), air at 1.5 m
  const Tmax = M.Tmax + p.dT, Tmin = M.Tmin + p.dT;
  const Tsn = Tmin + (Tmax - Tmin) * Math.sin(Math.PI * (Y - c) / (Y + 2 * a));
  const eb = Math.exp(-b);
  const Tout = h => {
    if (h >= tsr + c && h <= tss) return Tmin + (Tmax - Tmin) * Math.sin(Math.PI * (h - tsr - c) / (Y + 2 * a));
    const n = h > tss ? h - tss : h + 24 - tss;
    return (Tmin - Tsn * eb + (Tsn - Tmin) * Math.exp(-b * n / (Z + c))) / (1 - eb);
  };
  const ea = svp(M.Tdew + p.dT * 0);                       // vapour pressure constant over the day (kPa)
  const T = new Float64Array(N), I = new Float64Array(N), el = new Float64Array(N), az = new Float64Array(N), Tsky = new Float64Array(N);
  let Ics = 0;
  const gcs = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const h = i / 60;
    el[i] = solarElevation(lat, doy, h); az[i] = solarAzimuth(lat, doy, h);
    gcs[i] = clearSkyIrradiance(el[i]);
    Ics += gcs[i] * 60 * (i === 0 || i === N - 1 ? 0.5 : 1);
  }
  const H0 = extraterrestrialRadiation(lat, doy) * 1e6;   // J m⁻² d⁻¹
  const ktCs = 0.75;                                       // FAO-56 clear-sky Rso = 0.75 Ra (eq. 37, sea level)
  const kt = p.sky === 'clear' ? ktCs : M.kt;              // NASA POWER monthly clearness index
  const scale = Ics > 0 ? kt * H0 / Ics : 0;
  let H = 0;
  for (let i = 0; i < N; i++) {
    const h = i / 60;
    T[i] = Tout(h);
    I[i] = gcs[i] * scale;
    H += I[i] * 60 * (i === 0 || i === N - 1 ? 0.5 : 1);
    const TK = T[i] + K0;
    if (p.sky === 'clear') { const eps = 1.24 * Math.pow(10 * Math.min(ea, svp(T[i])) / TK, 1 / 7); Tsky[i] = Math.pow(eps, 0.25) * TK - K0; }
    else Tsky[i] = T[i] - M.dSky;
  }
  // outside vapour pressure cannot exceed saturation at the (offset) temperature
  const eaArr = new Float64Array(N); for (let i = 0; i < N; i++) eaArr[i] = Math.min(ea, 0.98 * svp(T[i]));
  return { N, T, I, el: Array.from(el, v => v * 180 / Math.PI), az: Array.from(az, v => v * 180 / Math.PI), Tsky, ea: eaArr, wind: p.wind, Co: PRM.Co, kt, ktCs, H, H0, Y, tsr, tss, Tmax, Tmin, Tdew: M.Tdew, M, lat, doy };
}
/** Linear interpolation of a 1-min weather series at time t (s). */
function wxAt(arr, t) { const x = ((t % 86400) + 86400) % 86400 / 60; const i = Math.floor(x), f = x - i; return arr[i] + (arr[Math.min(i + 1, arr.length - 1)] - arr[i]) * f; }

/* ------------------------------------------------------------------ component models */
/** Heat output of the heating pipes, W m⁻² floor (Eq. G4): free convection (Bot 1983 via Vanthoor) + long-wave radiation. */
export function pipeHeat(Tp, T, prm = PRM) {
  const dT = Tp - T, A = Math.PI * prm.dPipe * prm.lPipe;
  const conv = 1.99 * A * Math.pow(Math.abs(dT), 0.32) * dT;
  const rad = A * prm.epsPipe * SIGMA * (Math.pow(Tp + K0, 4) - Math.pow(T + K0, 4));
  return { q: conv + rad, conv, rad };
}
/** Pipe temperature that delivers heat Q (W m⁻²) to air at T (Newton iteration). */
export function pipeTempFor(Q, T, prm = PRM, guess) {
  if (Q <= 0.01) return T;
  let Tp = guess && guess > T + 0.5 ? guess : T + 20;
  const A = Math.PI * prm.dPipe * prm.lPipe;
  for (let i = 0; i < 12; i++) {
    const d = Tp - T; const f = pipeHeat(Tp, T, prm).q - Q;
    const df = 1.99 * A * 1.32 * Math.pow(Math.max(1e-6, Math.abs(d)), 0.32) + 4 * A * prm.epsPipe * SIGMA * Math.pow(Tp + K0, 3);
    const step = f / df; Tp -= step; if (Tp < T + 0.01) Tp = T + 0.01;
    if (Math.abs(step) < 1e-4) break;
  }
  return Tp;
}
/** Natural ventilation through roof vents + leakage (Eq. G3; Boulard & Baille 1995; Vanthoor 2011a). m³ m⁻² s⁻¹ */
export function ventilation(u, T, To, v, prm = PRM) {
  const TmK = 0.5 * (T + To) + K0;
  const Gv = prm.cD * u * prm.aRoof / 2 * Math.sqrt(Math.abs(9.81 * prm.hVent * (T - To) / (2 * TmK)) + prm.cW * v * v);
  const Gl = prm.cLeak * Math.max(0.25, v);
  return { Gv, Gl };
}
/** Condensation flux (kg m⁻² s⁻¹) from air (vapour pressure e1, Pa) to a surface with saturation pressure e2, heat-exchange coefficient hec (Vanthoor's smoothed form). */
const cond = (hec, e1, e2, prm) => hec * prm.cMV * (e1 - e2) / (1 + Math.exp(-0.1 * (e1 - e2)));
/** Absorbed fraction of global radiation (50 % PAR + 50 % NIR) by a canopy of leaf area index L, from above. */
export function canopyAbs(L, prm = PRM) {
  return 0.5 * (1 - prm.rhoCanPar) * (1 - Math.exp(-prm.k1Par * L)) + 0.5 * (1 - prm.rhoCanNir) * (1 - Math.exp(-prm.kNir * L));
}
/** Fraction of global radiation reaching the floor below the canopy. */
export function canopyTrans(L, prm = PRM) { return 0.5 * Math.exp(-prm.k1Par * L) + 0.5 * Math.exp(-prm.kNir * L); }

/** Canopy transpiration by the Stanghellini (1987) form of Penman–Monteith (Eq. G6). Rn, Rcan in W m⁻²; e in kPa. */
export function transpiration(T, e, C, Rn, Rcan, L, prm = PRM, P = PRM.Patm) {
  const rhoA = (P - e) * 1000 / (287.058 * (T + K0)) + e * 1000 / (461.495 * (T + K0));
  const D = svp(T) - e, Delta = svpSlope(T), gam = psychroConst(P);
  const gH = 2 * Math.max(0.05, L) * rhoA * CP_AIR / prm.rB;             // W m⁻² K⁻¹ (sensible, both leaf sides)
  const sRs = 1 / (1 + Math.exp(-(Rcan - 5)));                            // smooth day/night switch
  const c3 = prm.cEvap3N * (1 - sRs) + prm.cEvap3D * sRs, c4 = prm.cEvap4N * (1 - sRs) + prm.cEvap4D * sRs;
  const rfR = (Rcan + prm.cEvap1) / (Rcan + prm.cEvap2);
  const rfC = Math.min(1.5, 1 + c3 * (C - 200) ** 2);
  let Dl = D, lamE = 0, Tcan = T, rs = prm.rSMin;
  for (let it = 0; it < 2; it++) {
    const rfV = Math.min(5.8, 1 + c4 * (1000 * Dl) ** 2);
    rs = prm.rSMin * rfR * rfC * rfV;
    lamE = (Delta * Rn + gH * D) / (Delta + gam * (1 + rs / prm.rB));
    Tcan = T + (Rn - lamE) / gH;
    Dl = svp(Tcan) - e;
  }
  return { lamE, Tcan, rs, D, Dl, gH };
}
/** Canopy photosynthesis, electron-transport limited (Farquhar et al. 1980 as in Vanthoor 2011b). PARabs µmol m⁻² s⁻¹, C ppm. */
export function photosynthesis(PARabs, Tcan, C, L, prm = PRM) {
  const Lc = Math.max(0.05, L), J25 = Lc * prm.j25Leaf, TK = Tcan + K0, T25 = 298.15, R = 8.314;
  const jPot = J25 * Math.exp(prm.eJ * (TK - T25) / (R * TK * T25)) * (1 + Math.exp((prm.sJ * T25 - prm.hJ) / (R * T25))) / (1 + Math.exp((prm.sJ * TK - prm.hJ) / (R * TK)));
  const aP = prm.alphaJ * Math.max(0, PARabs);
  const J = (jPot + aP - Math.sqrt(Math.max(0, (jPot + aP) ** 2 - 4 * prm.thetaJ * jPot * aP))) / (2 * prm.thetaJ);
  const Cs = prm.etaStom * Math.max(1, C);
  const r = Math.min(1, 1 / Lc);
  const Gam = r * prm.cGamma * Tcan + 20 * prm.cGamma * (1 - r);
  const Pg = J * (Cs - Gam) / (4 * (Cs + 2 * Gam));
  const Rp = Pg * Gam / Cs;
  return { Pg, Rp, net: Pg - Rp, J, jPot, Gam };
}
/** Crop maintenance respiration, µmol CO₂ m⁻² s⁻¹ (Vanthoor 2011b coefficients; organ masses assumed from LAI). */
export function maintenance(Tcan, L, prm = PRM) {
  const Wl = L / prm.sla;                                   // mg CH₂O m⁻²
  const mg = (prm.cLeafM * Wl + prm.cStemM * prm.stemRatio * Wl + prm.cFruitM * prm.fruitRatio * Wl) * Math.pow(prm.q10m, (Tcan - 25) / 10);
  return mg / 30e-3;                                        // mg CH₂O → µmol CO₂ (30 mg mmol⁻¹)
}

/* ------------------------------------------------------------------ cover energy balance (Eq. G2) */
function coverResidual(Tc, k) {
  const TK = k.T + K0, TfK = k.Tf + K0, TcK = Tc + K0, TsK = k.Tsky + K0;
  const hci = k.prm.cHecIn * Math.pow(Math.abs(k.T - Tc), 0.33);
  const Ka = k.prm.cov * hci;
  const eps = k.prm.epsCov * SIGMA;
  const Qa = k.phi * Ka * (k.T - Tc);
  const Rc = k.phi * k.Fc * eps * (TK ** 4 - TcK ** 4);
  const Rf = k.phi * k.Ff * eps * (TfK ** 4 - TcK ** 4);
  // condensation: on the glass where the screen is open; on / through the screen where it is closed
  const Mg = (1 - k.s) * cond(Ka, k.ePa, esPa(Tc), k.prm);
  const Tsu = k.T - k.fS * (k.T - Tc);
  const Msu = k.s * cond(k.prm.cHecScr * Math.pow(Math.abs(k.T - Tsu), 0.33), k.ePa, esPa(Tsu), k.prm);
  const fScr = k.prm.kThScr * Math.pow(Math.abs(k.T - Tc), 0.66);
  const Wsat = humidityRatio(svp(Tc), k.P);
  const Mp = k.s * k.rhoA * fScr * Math.max(0, k.W - Wsat);
  const M = Math.max(-2e-6, Mg + Msu + Mp);
  const qin = Qa + Rc + Rf + k.QpCov + k.lam * M;
  const hco = k.prm.cHecOut1 + k.prm.cHecOut2 * k.v;
  const qout = k.prm.cov * (hco * (Tc - k.To) + eps * (TcK ** 4 - TsK ** 4));
  return { g: qin - qout, Qa, Rc, Rf, Mg, Msu, Mp, M, qout, Tsu, fScr, hci };
}
function solveCover(k, guess) {
  let Tc = isFinite(guess) ? guess : 0.5 * (k.T + k.To);
  let r;
  for (let it = 0; it < 25; it++) {
    r = coverResidual(Tc, k);
    const d = (coverResidual(Tc + 0.01, k).g - coverResidual(Tc - 0.01, k).g) / 0.02;
    if (!(d < -1e-6)) break;
    let step = r.g / d; step = clamp(step, -8, 8);
    Tc -= step;
    if (Math.abs(step) < 2e-4) break;
  }
  r = coverResidual(Tc, k);
  return Object.assign(r, { Tc });
}

/** Screen conductance factor f_s such that a closed screen saves `es` of the cover heat loss at reference conditions (Eq. G8). */
export function screenFactor(es, prm = PRM) {
  const ref = f => {
    const k = { prm, T: 18, Tf: 18, To: 0, Tsky: -10, v: 4, phi: f, Fc: 1 - Math.exp(-prm.kFir * 3), Ff: Math.exp(-prm.kFir * 3), s: 0, fS: 1, ePa: 0, W: 0, rhoA: 1.2, P: 101.3, lam: 2.45e6, QpCov: 0 };
    return solveCover(k, 3).qout;
  };
  const q0 = ref(1), target = (1 - es) * q0;
  let lo = 0.01, hi = 1;
  for (let i = 0; i < 40; i++) { const m = 0.5 * (lo + hi); if (ref(m) > target) hi = m; else lo = m; }
  return 0.5 * (lo + hi);
}

/* ------------------------------------------------------------------ the dynamic model */
const NS = 7; // T, Tf, W, C, u, s, z
/**
 * Evaluate all fluxes for state y at time t (s). Returns an object with every flux and control signal.
 * p: user parameters; wx: weather; ctx: persistent guesses (cover, pipe temperatures).
 */
export function fluxes(t, y, p, wx, ctx, prm = PRM) {
  const [T, Tf, W0, C, u, s] = y, z = y[6];
  const W = Math.max(1e-5, W0);
  const P = prm.Patm;
  const h = (((t % 86400) + 86400) % 86400) / 3600;
  // weather
  const To = wxAt(wx.T, t), Io = Math.max(0, wxAt(wx.I, t)), Tsky = wxAt(wx.Tsky, t), eo = wxAt(wx.ea, t), v = wx.wind;
  const Wo = humidityRatio(eo, P);
  // inside air properties
  const e = vpFromW(W, P), ePa = 1000 * e, es = svp(T);
  const TK = T + K0;
  const rhoA = (P - e) * 1000 / (287.058 * TK);             // kg dry air m⁻³
  const nAir = P * 1000 / (8.314 * TK);                      // mol m⁻³
  const lam = latentHeat(T);
  const L = p.lai;
  const RH = 100 * e / es;
  // set-points (day/night with 1-h ramps after sunrise and before sunset)
  const ramp = clamp(Math.min(h - wx.tsr, wx.tss - h), 0, 1);
  const Th = p.tNight + (p.tDay - p.tNight) * ramp;
  const Tv = Th + p.dTv;
  // lamps
  const lampOn = p.lamp > 0 && h >= prm.lampOn && h < prm.lampOff && Io < prm.lampIoff;
  const PL = lampOn ? p.lamp : 0;
  // actuator commands
  const uT = clamp((T - Tv) / p.pband, 0, 1);
  const uRH = clamp((RH - p.rhMax) / 10, 0, 1) * 0.3;
  const uCmd = clamp(Math.max(uT, uRH), 0, 1);
  let sCmd = 0;
  if (p.screen === 'closed') sCmd = 1;
  else if (p.screen === 'auto') {
    const want = Io < prm.scrIon && To < prm.scrTon;
    sCmd = want ? 1 - prm.gapMax * clamp((RH - p.rhMax) / 5, 0, 1) : 0;
    if (want && uT > 0.05) sCmd = Math.min(sCmd, 1 - clamp(uT, 0, 1));  // open the screen when cooling is needed
  }
  // screen effects
  const fS = ctx.fS;
  const phi = 1 - s * (1 - fS);
  const tauE = prm.tau * (1 - p.shade) * (1 - s * (1 - prm.tauScr));
  // radiation
  const Iin = tauE * Io;
  const ac = canopyAbs(L, prm), tc = canopyTrans(L, prm);
  const rhoF = 0.5 * (prm.rhoFlrPar + prm.rhoFlrNir);
  const Sc = Iin * (ac + tc * rhoF * ac);                    // absorbed by the canopy (incl. floor-reflected)
  const Sf = Iin * tc * (1 - rhoF);                          // absorbed by the floor
  const Qstr = prm.etaStr * Io * (1 - s * 0.5);              // absorbed by the construction → air
  // lamps: 55 % PAR, 2 % NIR, 43 % convective/long-wave heat into the air
  const LradPar = prm.lampPar * PL, LradNir = prm.lampNir * PL, Lheat = PL - LradPar - LradNir;
  const acPar = (1 - prm.rhoCanPar) * (1 - Math.exp(-prm.k1Par * L));
  const tcPar = Math.exp(-prm.k1Par * L);
  const ScL = LradPar * acPar * (1 + tcPar * prm.rhoFlrPar) + LradNir * ac;
  const SfL = LradPar * tcPar * (1 - prm.rhoFlrPar) + LradNir * tc * (1 - rhoF);
  // heating (PI with limits) and pipe temperature
  const Qmax = pipeHeat(prm.tPipeMax, T, prm).q;
  const Qmin = p.minPipe > T ? pipeHeat(p.minPipe, T, prm).q : 0;
  const err = Th - T;
  const Qpi = prm.kpHeat * (err + z / prm.tiHeat);
  const Qheat = clamp(Qpi, Qmin, Math.max(Qmin, Qmax));
  const Tp = pipeTempFor(Qheat, T, prm, ctx.Tp);
  ctx.Tp = Tp;
  const ph = pipeHeat(Tp, T, prm);
  const Fc = 1 - Math.exp(-prm.kFir * L), Ff = 1 - Fc;
  const radShare = Qheat > 0.01 ? ph.rad / ph.q : 0;
  const QpRad = Qheat * radShare, QpConv = Qheat - QpRad;
  const QpCan = 0.5 * Fc * QpRad, QpFlr = 0.5 * QpRad, QpCov = 0.5 * Ff * QpRad;
  // cover (quasi-steady)
  const k = { prm, T, Tf, To, Tsky, v, phi, Fc, Ff, s, fS, ePa, W, rhoA, P, lam, QpCov };
  const cv = solveCover(k, ctx.Tc); ctx.Tc = cv.Tc;
  // canopy
  const Rn = Sc + ScL + QpCan - cv.Rc;
  const Rcan = Iin + LradPar + LradNir;
  const tr = transpiration(T, e, C, Rn, Rcan, L, prm, P);
  const lamE = tr.lamE, E = lamE / lam;
  const Hcan = Rn - lamE;
  // floor ↔ air (convection + radiation to the canopy)
  const dTf = Tf - T;
  const hfa = (dTf > 0 ? 1.7 * Math.pow(Math.abs(dTf), 0.33) : 1.3 * Math.pow(Math.abs(dTf), 0.25)) + 4 * SIGMA * Math.pow(0.5 * (T + Tf) + K0, 3) * Fc;
  const Hfa = hfa * dTf;
  // ventilation (screen limits the flow reaching the main compartment)
  const vn = ventilation(u, T, To, v, prm);
  const Gmain = (1 - s) * vn.Gv + s * Math.min(vn.Gv, cv.fScr);
  const G = vn.Gl + Gmain;
  const Qvs = rhoA * CP_AIR * G * (T - To);
  const Mvent = rhoA * G * (W - Wo);
  // fog: vapour above saturation condenses in the air
  const Wsat = humidityRatio(es, P);
  const Mfog = Math.max(0, W - Wsat) * rhoA * prm.hMean / 120;
  // CO₂
  const PARabove = Iin * SUN_PPFD_PER_WM2 + prm.lampEff * PL;
  const PARabs = PARabove * acPar * (1 + tcPar * prm.rhoFlrPar);
  const ps = photosynthesis(PARabs, tr.Tcan, C, L, prm);
  const Rm = maintenance(tr.Tcan, L, prm);
  const avail = ps.net - Rm;
  const Rg = avail > 0 ? prm.cGrowth / (1 + prm.cGrowth) * avail : 0;
  const Unet = ps.net - Rm - Rg;                             // net CO₂ uptake by the crop, µmol m⁻² s⁻¹
  const day = Io > 20 || lampOn;
  let Csp = 0;
  if (p.co2On && day) Csp = (!p.interlock || u <= p.uCo2) ? p.co2sp : prm.Co;
  const dose = Csp > 0 ? prm.co2Cap * clamp((Csp - C) / 50, 0, 1) : 0;   // mg m⁻² s⁻¹
  const doseU = dose / 44.01e-3;                                          // µmol m⁻² s⁻¹
  const Cvent = nAir * G * (C - prm.Co);                                  // µmol m⁻² s⁻¹ lost through vents/leaks
  // derivatives
  const Ca = rhoA * CP_AIR * prm.hMean + prm.capLeaf * L;
  const dT = (Qstr + Hcan + QpConv + Lheat + Hfa - cv.Qa - Qvs + lam * Mfog) / Ca;
  const dTfdt = (Sf + SfL + QpFlr - Hfa - cv.Rf) / prm.capFlr;
  const dW = (E - cv.M - Mvent - Mfog) / (rhoA * prm.hMean);
  const dC = (doseU - Unet - Cvent) / (nAir * prm.hMean);
  const du = (uCmd - u) / prm.actVent;
  const ds = (sCmd - s) / prm.actScr;
  let dz = err;
  if ((Qpi > Qmax && err > 0) || (Qpi < Qmin && err < 0)) dz = 0;
  return {
    d: [dT, dTfdt, dW, dC, du, ds, dz],
    h, To, Io, Tsky, eo, Wo, v, T, Tf, W, C, u, s, e, RH, es, VPD: es - e, VPDleaf: svp(tr.Tcan) - e, Tdew: dewFromE(e),
    Tc: cv.Tc, Tsu: cv.Tsu, Tcan: tr.Tcan, Tp, Th, Tv, uCmd, sCmd, Csp,
    Iin, Sc, Sf, Qstr, ScL, SfL, Lheat, PL, lampOn, PARabove, PARabs,
    Qheat, QpConv, QpRad, QpCov, Qmax, Rn, lamE, E, Hcan, Hfa,
    Qa: cv.Qa, Rc: cv.Rc, Rf: cv.Rf, Qcov: cv.Qa + cv.Rc + cv.Rf + QpCov, Qout: cv.qout, Mcond: cv.M, Mglass: cv.Mg, Mscreen: cv.Msu + cv.Mp,
    G, Gv: vn.Gv, Gl: vn.Gl, N: G * 3600 / prm.hMean, Qvs, Qvl: lam * Mvent, Mvent, Mfog,
    Pg: ps.Pg, Pnet: ps.net, Rm, Rg, Unet, dose, doseU, Cvent, rs: tr.rs,
    storage: Ca * dT + prm.capFlr * dTfdt,
    Ueff: Math.abs(T - To) > 0.5 ? cv.qout / (prm.cov * (T - To)) : NaN,
    hco: prm.cHecOut1 + prm.cHecOut2 * v
  };
}

/** One classic RK4 step of size dt (s) for the 7 states. */
function rk4Step(t, y, dt, p, wx, ctx, prm) {
  const f = (tt, yy) => fluxes(tt, yy, p, wx, ctx, prm).d;
  const k1 = f(t, y);
  const y2 = y.map((v, i) => v + dt / 2 * k1[i]); const k2 = f(t + dt / 2, y2);
  const y3 = y.map((v, i) => v + dt / 2 * k2[i]); const k3 = f(t + dt / 2, y3);
  const y4 = y.map((v, i) => v + dt * k3[i]); const k4 = f(t + dt, y4);
  const out = y.map((v, i) => v + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  out[4] = clamp(out[4], 0, 1); out[5] = clamp(out[5], 0, 1);
  return out;
}

/** Keys recorded every 5 min for charts and playback. */
export const REC_KEYS = ['To', 'Io', 'Tsky', 'T', 'Tf', 'Tc', 'Tsu', 'Tcan', 'Tp', 'Tdew', 'Th', 'Tv', 'RH', 'VPD', 'VPDleaf', 'e', 'W', 'C', 'Csp', 'u', 's', 'uCmd', 'sCmd',
  'Iin', 'Sc', 'Sf', 'Qstr', 'ScL', 'SfL', 'Lheat', 'PL', 'Qheat', 'QpRad', 'Qmax', 'Rn', 'lamE', 'E', 'Qcov', 'Qout', 'Mcond', 'Mglass', 'Mscreen', 'G', 'N', 'Qvs', 'Qvl', 'Mvent',
  'Pg', 'Pnet', 'Unet', 'Rm', 'dose', 'doseU', 'Cvent', 'storage', 'Ueff', 'PARabove', 'rs'];

/**
 * Simulate `spin` days to reach a periodic state, then record one day every 5 min.
 * p: { site, month, dT, wind, sky, tDay, tNight, dTv, pband, rhMax, minPipe, screen, es, shade, lai, co2On, co2sp, interlock, uCo2, lamp }
 */
export function simulate(p, prm = PRM, spin = 2) {
  const wx = buildWeather(p);
  const ctx = { Tc: 0, Tp: 40, fS: screenFactor(p.es, prm) };
  const T0 = p.tNight;
  let y = [T0, T0, humidityRatio(0.8 * svp(T0), prm.Patm), prm.Co, 0, 0, 0];
  const dt = 60, stepsDay = 86400 / dt, every = 5;
  let t = 0;
  for (let d = 0; d < spin; d++) for (let i = 0; i < stepsDay; i++) { y = rk4Step(t, y, dt, p, wx, ctx, prm); t += dt; }
  const nRec = stepsDay / every + 1;
  const rec = { t: new Float64Array(nRec) };
  REC_KEYS.forEach(k => { rec[k] = new Float64Array(nRec); });
  const rec0 = t;
  for (let i = 0; i <= stepsDay; i++) {
    if (i % every === 0) {
      const j = i / every; const f = fluxes(t, y, p, wx, ctx, prm);
      rec.t[j] = (t - rec0) / 3600;
      REC_KEYS.forEach(k => { rec[k][j] = typeof f[k] === 'boolean' ? +f[k] : f[k]; });
    }
    if (i < stepsDay) { y = rk4Step(t, y, dt, p, wx, ctx, prm); t += dt; }
  }
  return { rec, wx, sum: summarise(rec, p, prm), fS: ctx.fS, p };
}

/** Daily totals (trapezoidal rule over the 5-min record). */
export function summarise(rec, p, prm = PRM) {
  const n = rec.t.length, dt = 300;
  const I = key => { let s = 0; for (let i = 0; i < n - 1; i++) s += 0.5 * (rec[key][i] + rec[key][i + 1]) * dt; return s; };
  const Ipos = (fn) => { let s = 0; for (let i = 0; i < n - 1; i++) s += 0.5 * (fn(i) + fn(i + 1)) * dt; return s; };
  const heat = I('Qheat') / 3.6e6;                                  // kWh m⁻² d⁻¹
  const lamps = I('PL') / 3.6e6;
  const solarIn = I('Iin') / 1e6;                                   // MJ m⁻² d⁻¹
  const solarOut = I('Io') / 1e6;
  const transp = I('E');                                            // kg m⁻² d⁻¹
  const condens = I('Mcond');
  const ventVap = I('Mvent');
  const dosed = I('dose') / 1000;                                   // g m⁻² d⁻¹
  const uptake = I('Unet') * 44.01e-6;                              // g CO₂ m⁻² d⁻¹ (net)
  const ventWhileDosing = Ipos(i => rec.dose[i] > 1e-6 ? Math.max(0, rec.Cvent[i]) : 0) * 44.01e-6;
  const ventFrac = dosed > 1e-6 ? Math.min(1, ventWhileDosing / dosed) : 0;
  let Tmin = Infinity, Tmax = -Infinity, Tsum = 0, rh85 = 0, rh90 = 0, wet = 0, condH = 0, qMax = 0, uMax = 0, scrH = 0;
  for (let i = 0; i < n - 1; i++) {
    const T = rec.T[i]; Tmin = Math.min(Tmin, T); Tmax = Math.max(Tmax, T); Tsum += T;
    if (rec.RH[i] > 85) rh85 += 1 / 12; if (rec.RH[i] > 90) rh90 += 1 / 12;
    if (rec.Tcan[i] < rec.Tdew[i] + 0.2) wet += 1 / 12;
    if (rec.Mcond[i] > 2e-6) condH += 1 / 12;
    if (rec.s[i] > 0.5) scrH += 1 / 12;
    qMax = Math.max(qMax, rec.Qheat[i]); uMax = Math.max(uMax, rec.u[i]);
  }
  const dliIn = I('PARabove') / 1e6;                                // mol m⁻² d⁻¹
  return { heat, lamps, solarIn, solarOut, transp, condens, ventVap, dosed, uptake, ventFrac, Tmin, Tmax, Tmean: Tsum / (n - 1), rh85, rh90, wet, condH, scrH, qMax, uMax, dliIn,
    gas: heat / (0.95 * 8.79) };
}
