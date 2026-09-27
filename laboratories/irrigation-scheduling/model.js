/* Irrigation scheduling — FAO-56 single-coefficient daily soil-water balance (pure ES module, no DOM).
   ET₀: FAO-56 Penman–Monteith with net radiation from sunshine (Ångström) or, for pasted data without radiation, from the
   temperature range (Hargreaves radiation formula); crop coefficients, stage lengths, rooting depths and depletion fractions
   from FAO-56 Tables 11, 12 and 22; yield response from FAO-33 (FAO-56 Table 24). Allen et al. (1998); Doorenbos & Kassam (1979).
   Derive tab: Eqs. I1–I9. */
import { svp, extraterrestrialRadiation, dayLength, et0PenmanMonteith, pressureAtElevation } from '../../assets/js/physics.js';
import { rng, randn, forecastDay } from './weather.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const SIGMA_MJ = 4.903e-9;           // Stefan–Boltzmann constant, MJ K⁻⁴ m⁻² d⁻¹ (FAO-56)

/** FAO-56 daily radiation terms and reference evapotranspiration for one day of weather. */
export function dailyET0(w, lat, z, { as = 0.25, bs = 0.5, kRs = 0.16 } = {}) {
  const Ra = extraterrestrialRadiation(lat, w.doy), N = dayLength(lat, w.doy);
  let Rs, rsFrom;
  if (w.rs != null && isFinite(w.rs)) { Rs = w.rs; rsFrom = 'measured'; }
  else if (w.sun != null && isFinite(w.sun)) { Rs = (as + bs * clamp(w.sun, 0, 1)) * Ra; rsFrom = 'sunshine'; }
  else { Rs = kRs * Math.sqrt(Math.max(0, w.tmax - w.tmin)) * Ra; rsFrom = 'temperature'; }
  const Rso = (0.75 + 2e-5 * z) * Ra;
  const ea = svp(w.tdew), es = (svp(w.tmax) + svp(w.tmin)) / 2;
  const Rns = (1 - 0.23) * Rs;
  const ratio = clamp(Rs / Math.max(1e-6, Rso), 0.25, 1);
  const Rnl = SIGMA_MJ * ((w.tmax + 273.16) ** 4 + (w.tmin + 273.16) ** 4) / 2 * (0.34 - 0.14 * Math.sqrt(Math.max(0, ea))) * (1.35 * ratio - 0.35);
  const Rn = Rns - Rnl, T = (w.tmax + w.tmin) / 2, P = pressureAtElevation(z);
  const et0 = Math.max(0, et0PenmanMonteith({ T, Rn, G: 0, u2: w.u2, es, ea, P }));
  return { Ra, N, Rs, Rso, Rns, Rnl, Rn, es, ea, vpd: es - ea, P, et0, rsFrom, rhmin: clamp(100 * ea / svp(w.tmax), 5, 100) };
}
/** Attach ET₀ and radiation terms to every day. */
export function withET0(weather, lat, z) { return weather.map(w => Object.assign({}, w, dailyET0(w, lat, z))); }

/* ------------------------------------------------------------------ crops, soils, irrigation systems */
export const CROPS = {
  potato: {
    name: 'Potato', kc: [0.5, 1.15, 0.75], h: 0.6, zrMax: 0.5, p: 0.35, ky: 1.1, ym: 40, kySrc: 'FAO-33 (FAO-56 Table 24)',
    calendars: [
      { id: 'cont', label: 'Continental climate, May planting · 25/30/45/30 d', L: [25, 30, 45, 30] },
      { id: 'eu', label: 'Europe, April planting · 30/35/50/30 d', L: [30, 35, 50, 30] },
      { id: 'arid', label: '(Semi-)arid, Jan/Nov planting · 25/30/45/30 d', L: [25, 30, 45, 30] }
    ]
  },
  wheat: {
    name: 'Spring wheat', kc: [0.3, 1.15, 0.25], h: 1.0, zrMax: 1.2, p: 0.55, ky: 1.15, ym: 6, kySrc: 'FAO-33 (FAO-56 Table 24)',
    calendars: [
      { id: 'lat', label: '35–45° latitude, March/April sowing · 20/25/60/30 d', L: [20, 25, 60, 30] },
      { id: 'nov', label: 'Central India, November sowing · 15/25/50/30 d', L: [15, 25, 50, 30] }
    ]
  },
  lettuce: {
    name: 'Lettuce', kc: [0.7, 1.0, 0.95], h: 0.3, zrMax: 0.4, p: 0.30, ky: 1.39, ym: 30, kySrc: 'Kuslu et al. (2008); not in FAO-33',
    calendars: [
      { id: 'apr', label: 'Mediterranean, April planting · 20/30/15/10 d', L: [20, 30, 15, 10] },
      { id: 'nov', label: 'Mediterranean, Nov/Jan planting · 30/40/25/10 d', L: [30, 40, 25, 10] },
      { id: 'feb', label: 'Mediterranean, February planting · 35/50/45/10 d', L: [35, 50, 45, 10] }
    ]
  }
};
/** Soil water characteristics chosen within the ranges of FAO-56 Table 19 (loamy sand and silt loam as in Lesson 11.3). */
export const SOILS = {
  loamySand: { name: 'Loamy sand', fc: 0.15, wp: 0.06 },
  sandyLoam: { name: 'Sandy loam', fc: 0.23, wp: 0.10 },
  loam: { name: 'Loam', fc: 0.25, wp: 0.10 },
  siltLoam: { name: 'Silt loam', fc: 0.32, wp: 0.15 },
  clay: { name: 'Clay', fc: 0.36, wp: 0.22 }
};
/** Application efficiencies: FAO defaults (Brouwer et al. 1989); maximum net depth per event: assumptions. */
export const SYSTEMS = {
  sprinkler: { name: 'Sprinkler (hose reel / boom)', ea: 0.75, max: 30 },
  drip: { name: 'Drip', ea: 0.90, max: 20 },
  surface: { name: 'Furrow / surface', ea: 0.60, max: 60 }
};
export const STRATEGIES = {
  rainfed: 'Rainfed (no irrigation)',
  calendar: 'Calendar: fixed interval and depth',
  sensor: 'Soil-moisture sensor threshold',
  model: 'Water-balance model + weather forecast',
  deficit: 'Deficit irrigation'
};

/* ------------------------------------------------------------------ season */
/** Stage boundaries (cumulative days) and the single crop-coefficient curve (FAO-56 Fig. 25, eq. 66). */
export function kcCurve(crop, L, weather, climAdj = true) {
  const C = CROPS[crop], n = L[0] + L[1] + L[2] + L[3];
  const Lc = [L[0], L[0] + L[1], L[0] + L[1] + L[2], n];
  const avg = (a, b, k) => { let s = 0, m = 0; for (let i = a; i < Math.min(b, weather.length); i++) { s += weather[i][k]; m++; } return m ? s / m : (k === 'u2' ? 2 : 45); };
  const adj = (u2, rh) => (0.04 * (u2 - 2) - 0.004 * (rh - 45)) * Math.pow(C.h / 3, 0.3);
  let kcMid = C.kc[1], kcEnd = C.kc[2], adjMid = 0, adjEnd = 0;
  if (climAdj) { adjMid = adj(avg(Lc[1], Lc[2], 'u2'), avg(Lc[1], Lc[2], 'rhmin')); kcMid += adjMid; if (C.kc[2] >= 0.45) { adjEnd = adj(avg(Lc[2], n, 'u2'), avg(Lc[2], n, 'rhmin')); kcEnd += adjEnd; } }
  const kcIni = C.kc[0];
  const at = i => i < Lc[0] ? kcIni : i < Lc[1] ? kcIni + (i - Lc[0]) / L[1] * (kcMid - kcIni) : i < Lc[2] ? kcMid : kcMid + (i - Lc[2]) / L[3] * (kcEnd - kcMid);
  const stage = i => i < Lc[0] ? 0 : i < Lc[1] ? 1 : i < Lc[2] ? 2 : 3;
  return { at, stage, Lc, n, kcIni, kcMid, kcEnd, adjMid, adjEnd };
}

/**
 * Run the daily root-zone water balance (FAO-56 eq. 85) for one strategy.
 * weather: days with et0 & rhmin; crop key; L stage lengths; soil key; sys key; strat { kind, … }.
 */
export function runSeason({ weather, crop, L, soil, sys, strat, climAdj = true, dr0 = 0, zrMin = 0.15, seed = 1, stopBefore = 10, minGap = 1, ymax }) {
  const C = CROPS[crop], S = SOILS[soil], SY = SYSTEMS[sys];
  const K = kcCurve(crop, L, weather, climAdj), n = Math.min(K.n, weather.length);
  const zrAt = i => i >= K.Lc[1] ? C.zrMax : zrMin + (C.zrMax - zrMin) * i / K.Lc[1];
  const rS = rng(seed * 131 + 7), rF = rng(seed * 977 + 11);
  const A = k => new Float64Array(n);
  const R = { n, dap: A(), kc: A(), zr: A(), taw: A(), raw: A(), p: A(), dr: A(), drStart: A(), ks: A(), et0: A(), etc: A(), eta: A(), rain: A(), pe: A(), irr: A(), gross: A(), dp: A(), theta: A(), sensor: A(), stage: new Uint8Array(n), K };
  const tawAt = i => 1000 * (S.fc - S.wp) * zrAt(i);
  let Dr = clamp(dr0, 0, 0.95) * tawAt(0), lastIrr = -99, events = 0;
  const bias = strat.kind === 'sensor' ? (strat.bias || 0) : 0, sd = strat.kind === 'sensor' ? (strat.noise ?? 0.01) : 0;
  for (let i = 0; i < n; i++) {
    const w = weather[i], kc = K.at(i), zr = zrAt(i), taw = tawAt(i);
    const etc = kc * w.et0;
    const p = clamp(C.p + 0.04 * (5 - etc), 0.1, 0.8), raw = p * taw;
    const thetaTrue = S.fc - Dr / (1000 * zr);
    const sensor = clamp(thetaTrue + bias + sd * randn(rS), 0, 0.6);
    // ---- irrigation decision at the start of the day (depletion at the end of the previous day)
    let I = 0;
    const allowed = i < n - stopBefore && i - lastIrr >= minGap;
    if (allowed) {
      if (strat.kind === 'calendar') { const d0 = strat.start ?? 10; if (i >= d0 && (i - d0) % Math.max(1, strat.interval) === 0) I = strat.depth; }
      else if (strat.kind === 'sensor') { const Dm = Math.max(0, (S.fc - sensor) * 1000 * zr); if (Dm >= strat.trig * raw) I = Math.min(SY.max, Dm); }
      else if (strat.kind === 'deficit') { if (Dr >= raw + strat.delta * (taw - raw)) I = Math.min(SY.max, strat.refill * Dr); }
      else if (strat.kind === 'model') {
        const H = Math.max(1, strat.horizon ?? 3); let Dp = Dr, rainSoon = 0, et0Today = w.et0;
        for (let k = 0; k < H && i + k < n; k++) {
          const fc = k === 0 ? { rain: forecastDay(weather[i], 0, rF).rain, et0: w.et0 } : forecastDay(weather[i + k], k, rF);
          const pe = fc.rain >= 0.2 * fc.et0 ? fc.rain : 0; Dp = Math.max(0, Dp + K.at(i + k) * fc.et0 - pe);
          if (k < 2) rainSoon += pe; if (k === 0) et0Today = fc.et0;
        }
        if (Dp >= strat.trig * raw && rainSoon < 0.8 * Dr) I = clamp(Dr + kc * et0Today - rainSoon, 0, SY.max);
      }
      if (I > 0) { I = Math.min(I, taw); lastIrr = i; events++; }
    }
    // ---- water balance for the day
    const pe = w.rain >= 0.2 * w.et0 ? w.rain : 0;                 // FAO-56: rain < 0.2 ET₀ evaporates
    const ks = Dr > raw ? clamp((taw - Dr) / ((1 - p) * taw), 0, 1) : 1;
    const eta = ks * etc;
    R.drStart[i] = Dr;
    let D = Dr - pe - I + eta, dp = 0;
    if (D < 0) { dp = -D; D = 0; }
    if (D > taw) D = taw;
    Dr = D;
    R.dap[i] = i; R.kc[i] = kc; R.zr[i] = zr; R.taw[i] = taw; R.raw[i] = raw; R.p[i] = p; R.dr[i] = Dr; R.ks[i] = ks;
    R.et0[i] = w.et0; R.etc[i] = etc; R.eta[i] = eta; R.rain[i] = w.rain; R.pe[i] = pe; R.irr[i] = I; R.gross[i] = I / SY.ea; R.dp[i] = dp;
    R.theta[i] = S.fc - Dr / (1000 * zr); R.sensor[i] = sensor; R.stage[i] = K.stage(i);
  }
  const sum = a => a.reduce((s, v) => s + v, 0);
  const ETc = sum(R.etc), ETa = sum(R.eta), ratio = ETc > 0 ? ETa / ETc : 1;
  const yr = clamp(1 - C.ky * (1 - ratio), 0, 1);
  const Ym = ymax ?? C.ym;
  R.season = {
    ET0: sum(R.et0), ETc, ETa, ratio, rain: sum(R.rain), pe: sum(R.pe), irr: sum(R.irr), gross: sum(R.gross), dp: sum(R.dp), events,
    stressDays: Array.from(R.ks).filter(k => k < 0.999).length, yr, yield: yr * Ym, Ym, drEnd: Dr, losses: sum(R.gross) - sum(R.irr)
  };
  return R;
}
/** Run all strategies with the same weather, crop and soil; returns { key: result }. */
export function runAll(base, strategies) {
  const out = {}; Object.entries(strategies).forEach(([k, s]) => { out[k] = runSeason(Object.assign({}, base, { strat: s })); }); return out;
}
