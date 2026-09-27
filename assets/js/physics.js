/* ==========================================================================
   physics.js — shared physical, chemical and agronomic relationships (ES module)
   Every function documents its source equation and units so laboratories and
   lessons stay mutually consistent.
   ========================================================================== */

/* ------------------------------------------------------------ constants (SI, CODATA 2018 exact where defined) */
export const h = 6.62607015e-34;        // Planck constant, J s
export const c = 2.99792458e8;          // speed of light, m s⁻¹
export const NA = 6.02214076e23;        // Avogadro constant, mol⁻¹
export const kB = 1.380649e-23;         // Boltzmann constant, J K⁻¹
export const R = 8.314462618;           // molar gas constant, J mol⁻¹ K⁻¹
export const F = 96485.33212;           // Faraday constant, C mol⁻¹
export const SIGMA = 5.670374419e-8;    // Stefan–Boltzmann constant, W m⁻² K⁻⁴
export const G0 = 9.80665;              // standard gravity, m s⁻²
export const P0 = 101.325;              // standard atmosphere, kPa
export const CP_AIR = 1005;             // specific heat of dry air, J kg⁻¹ K⁻¹
export const CP_WATER = 4186;           // specific heat of liquid water, J kg⁻¹ K⁻¹
export const K0 = 273.15;               // 0 °C in kelvin

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const deg = r => r * 180 / Math.PI;
export const rad = d => d * Math.PI / 180;

/* ------------------------------------------------------------ light */
/** Energy of one photon, J.  E = h c / λ  (λ in nm). */
export const photonEnergy = nm => h * c / (nm * 1e-9);
/** Micromoles of photons per joule of radiant energy at wavelength λ (nm). ≈ 0.008359 · λ. */
export const umolPerJoule = nm => (nm * 1e-9) / (h * c * NA) * 1e6;
/** Daily light integral, mol m⁻² d⁻¹, from constant PPFD (µmol m⁻² s⁻¹) over a photoperiod (h). */
export const dli = (ppfd, hours) => ppfd * hours * 3600 / 1e6;
/** PPFD (µmol m⁻² s⁻¹) required to reach a DLI target over a photoperiod. */
export const ppfdForDli = (dliTarget, hours) => dliTarget * 1e6 / (hours * 3600);
/** Conversion of global shortwave irradiance (W m⁻²) of sunlight to PPFD. ≈ 2.02 µmol J⁻¹ (≈ 45 % PAR fraction × 4.57 µmol J⁻¹). */
export const SUN_PPFD_PER_WM2 = 2.02;
/** McCree (1972) relative quantum efficiency, smoothed average of 22 species (400–700 nm plus tails). */
export function mcCree(nm) {
  const pts = [[360, 0.0], [380, 0.18], [400, 0.44], [420, 0.63], [440, 0.70], [460, 0.66], [480, 0.67], [500, 0.71], [520, 0.73], [540, 0.76], [560, 0.80], [580, 0.87], [600, 0.95], [620, 1.0], [640, 0.98], [660, 0.97], [680, 0.88], [700, 0.50], [720, 0.16], [740, 0.03], [760, 0.0]];
  if (nm <= pts[0][0] || nm >= pts[pts.length - 1][0]) return 0;
  for (let i = 1; i < pts.length; i++) if (nm <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (nm - x0) / (x1 - x0); }
  return 0;
}
/** Gaussian-like LED emission spectrum (relative), peak λp, FWHM (nm). */
export const ledSpectrum = (nm, peak, fwhm) => Math.exp(-4 * Math.LN2 * ((nm - peak) / fwhm) ** 2);
/** Planck spectral radiance (relative) — for daylight / incandescent comparisons. T in K, λ in nm. */
export function planck(nm, T) { const l = nm * 1e-9; return (2 * h * c * c / l ** 5) / (Math.exp(h * c / (l * kB * T)) - 1); }
/** Irradiance under a point source: inverse-square + cosine law. I (W sr⁻¹ or µmol s⁻¹ sr⁻¹), distance d (m), incidence angle θ (rad). */
export const pointIrradiance = (I, d, theta = 0) => I * Math.cos(theta) / (d * d);
/** Canopy light interception fraction (Beer–Lambert / Monsi–Saeki): 1 − exp(−k·LAI). */
export const canopyInterception = (lai, k = 0.7) => 1 - Math.exp(-k * lai);

/* ------------------------------------------------------------ psychrometrics (FAO-56 & ASHRAE forms) */
/** Saturation vapour pressure over water, kPa (Tetens / FAO-56 eq. 11). T in °C. */
export const svp = T => 0.6108 * Math.exp(17.27 * T / (T + 237.3));
/** Slope of the saturation vapour-pressure curve Δ, kPa °C⁻¹ (FAO-56 eq. 13). */
export const svpSlope = T => 4098 * svp(T) / (T + 237.3) ** 2;
/** Actual vapour pressure, kPa, from relative humidity (%). */
export const vapourPressure = (T, rh) => svp(T) * rh / 100;
/** Vapour pressure deficit, kPa. Optionally at leaf temperature Tleaf. */
export const vpd = (T, rh, Tleaf) => svp(Tleaf == null ? T : Tleaf) - vapourPressure(T, rh);
/** Relative humidity (%) from air temperature and vapour pressure (kPa). */
export const rhFromVp = (T, ea) => 100 * ea / svp(T);
/** Dew-point temperature, °C (inverse of Tetens). */
export function dewPoint(T, rh) { const ea = vapourPressure(T, rh); const a = Math.log(ea / 0.6108); return 237.3 * a / (17.27 - a); }
/** Humidity ratio (mixing ratio) W, kg water per kg dry air. ea and P in kPa. */
export const humidityRatio = (ea, P = P0) => 0.62198 * ea / (P - ea);
/** Vapour pressure from humidity ratio. */
export const vpFromW = (W, P = P0) => W * P / (0.62198 + W);
/** Moist-air specific enthalpy, kJ per kg dry air (ASHRAE). */
export const enthalpy = (T, W) => 1.006 * T + W * (2501 + 1.86 * T);
/** Absolute humidity (vapour density), g m⁻³. */
export const absoluteHumidity = (T, rh) => 2165 * vapourPressure(T, rh) / (T + K0);
/** Density of moist air, kg m⁻³. */
export const airDensity = (T, rh = 0, P = P0) => { const e = vapourPressure(T, rh); return ((P - e) * 1000 / (287.058 * (T + K0))) + (e * 1000 / (461.495 * (T + K0))); };
/** Latent heat of vaporisation of water, J kg⁻¹ (linear fit, 0–40 °C). */
export const latentHeat = T => 2.501e6 - 2361 * T;
/** Psychrometric constant γ, kPa °C⁻¹ (FAO-56 eq. 8). */
export const psychroConst = (P = P0) => 0.000665 * P;
/** Atmospheric pressure at elevation z (m), kPa (FAO-56 eq. 7). */
export const pressureAtElevation = z => 101.3 * Math.pow((293 - 0.0065 * z) / 293, 5.26);
/** Wet-bulb temperature, °C — Stull (2011) empirical fit, valid 5–99 % RH, −20…50 °C at sea level. */
export function wetBulb(T, rh) { return T * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) + Math.atan(T + rh) - Math.atan(rh - 1.676331) + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) - 4.686035; }

/* ------------------------------------------------------------ solar geometry (Spencer 1971 / FAO-56) */
export const dayOfYear = date => { const s = new Date(date.getFullYear(), 0, 0); return Math.floor((date - s) / 864e5); };
/** Solar declination, rad (FAO-56 eq. 24). */
export const declination = doy => 0.409 * Math.sin(2 * Math.PI * doy / 365 - 1.39);
/** Inverse relative Earth–Sun distance (FAO-56 eq. 23). */
export const earthSunFactor = doy => 1 + 0.033 * Math.cos(2 * Math.PI * doy / 365);
/** Sunset hour angle, rad (FAO-56 eq. 25), latitude in degrees. */
export function sunsetHourAngle(latDeg, doy) { const x = -Math.tan(rad(latDeg)) * Math.tan(declination(doy)); return Math.acos(clamp(x, -1, 1)); }
/** Day length, hours (FAO-56 eq. 34). */
export const dayLength = (latDeg, doy) => 24 / Math.PI * sunsetHourAngle(latDeg, doy);
/** Solar elevation angle, rad, at local solar time (hours, 12 = solar noon). */
export function solarElevation(latDeg, doy, solarHour) {
  const phi = rad(latDeg), d = declination(doy), w = rad(15 * (solarHour - 12));
  return Math.asin(clamp(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(w), -1, 1));
}
/** Solar azimuth, rad clockwise from north. */
export function solarAzimuth(latDeg, doy, solarHour) {
  const phi = rad(latDeg), d = declination(doy), w = rad(15 * (solarHour - 12));
  const el = solarElevation(latDeg, doy, solarHour);
  let az = Math.acos(clamp((Math.sin(d) - Math.sin(el) * Math.sin(phi)) / (Math.cos(el) * Math.cos(phi) + 1e-12), -1, 1));
  return w > 0 ? 2 * Math.PI - az : az;
}
/** Daily extraterrestrial radiation Ra, MJ m⁻² d⁻¹ (FAO-56 eq. 21). */
export function extraterrestrialRadiation(latDeg, doy) {
  const Gsc = 0.0820, phi = rad(latDeg), dr = earthSunFactor(doy), d = declination(doy), ws = sunsetHourAngle(latDeg, doy);
  return 24 * 60 / Math.PI * Gsc * dr * (ws * Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.sin(ws));
}
/** Clear-sky global radiation Rso, MJ m⁻² d⁻¹ (FAO-56 eq. 37). */
export const clearSkyRadiation = (latDeg, doy, z = 0) => (0.75 + 2e-5 * z) * extraterrestrialRadiation(latDeg, doy);
/** Instantaneous clear-sky global irradiance on a horizontal surface, W m⁻² — Haurwitz (1945) model,
    GHI = 1098·cos z·exp(−0.059/cos z) with the constants used in pvlib (Holmgren et al. 2018; see Reno et al. 2012). */
export function clearSkyIrradiance(elevRad) {
  const cz = Math.sin(elevRad);
  return cz <= 0 ? 0 : 1098 * cz * Math.exp(-0.059 / cz);
}

/* ------------------------------------------------------------ evapotranspiration */
/**
 * FAO-56 Penman–Monteith reference evapotranspiration ET₀, mm d⁻¹ (eq. 6).
 * T mean air temperature °C, Rn net radiation MJ m⁻² d⁻¹, G soil heat flux MJ m⁻² d⁻¹,
 * u2 wind speed at 2 m (m s⁻¹), es / ea saturation / actual vapour pressure kPa, P kPa.
 */
export function et0PenmanMonteith({ T, Rn, G = 0, u2, es, ea, P = P0 }) {
  const D = svpSlope(T), g = psychroConst(P);
  return (0.408 * D * (Rn - G) + g * 900 / (T + 273) * u2 * (es - ea)) / (D + g * (1 + 0.34 * u2));
}
/** Hargreaves ET₀, mm d⁻¹ (FAO-56 eq. 52) — when only temperatures are known. Ra in MJ m⁻² d⁻¹. */
export const et0Hargreaves = (Tmean, Tmax, Tmin, Ra) => 0.0023 * (Tmean + 17.8) * Math.sqrt(Math.max(0, Tmax - Tmin)) * Ra * 0.408;

/* ------------------------------------------------------------ water chemistry */
/** Fraction of total ammonia nitrogen present as un-ionised NH₃ (Emerson et al. 1975). T °C. */
export function nh3Fraction(pH, T) { const pKa = 0.09018 + 2729.92 / (T + K0); return 1 / (Math.pow(10, pKa - pH) + 1); }
/** Dissolved-oxygen saturation in fresh water at 1 atm, mg L⁻¹ (Benson & Krause 1984, APHA 4500-O). T °C, salinity g kg⁻¹, P kPa. */
export function doSaturation(T, salinity = 0, P = P0) {
  const Tk = T + K0;
  let lnC = -139.34411 + 1.575701e5 / Tk - 6.642308e7 / Tk ** 2 + 1.243800e10 / Tk ** 3 - 8.621949e11 / Tk ** 4;
  lnC -= salinity * (1.7674e-2 - 1.0754e1 / Tk + 2.1407e3 / Tk ** 2);
  const Patm = P / 101.325;
  const u = Math.exp(11.8571 - 3840.70 / Tk - 216961 / Tk ** 2); // vapour pressure of water, atm
  const theta = 0.000975 - 1.426e-5 * T + 6.436e-8 * T * T;
  return Math.exp(lnC) * Patm * ((1 - u / Patm) * (1 - theta * Patm)) / ((1 - u) * (1 - theta));
}
/** Nernstian slope, mV per pH unit: 1000·ln(10)·R·T/F (59.16 mV at 25 °C). */
export const nernstSlope = T => 1000 * Math.LN10 * R * (T + K0) / F;
/** Ideal glass-electrode potential, mV, relative to pH 7 isopotential point. */
export const electrodeMV = (pH, T = 25, slopeEff = 1, offset = 0) => offset - slopeEff * nernstSlope(T) * (pH - 7);
/** Temperature-compensated conductivity at 25 °C (linear, α ≈ 0.019 K⁻¹). */
export const ec25 = (ecT, T, alpha = 0.019) => ecT / (1 + alpha * (T - 25));
/** Rule-of-thumb EC (dS m⁻¹) of a nutrient solution from the sum of cations (mmol₍c₎ L⁻¹): EC ≈ Σcations / 10. */
export const ecFromCations = meqCations => meqCations / 10;
/** Fraction of phosphate species at pH (pKa 2.15, 7.20, 12.35 at 25 °C): returns [H3PO4, H2PO4-, HPO4 2-, PO4 3-]. */
export function phosphateSpecies(pH) {
  const Ka = [2.15, 7.20, 12.35].map(p => Math.pow(10, -p)); const Hh = Math.pow(10, -pH);
  const t = [Hh ** 3, Hh ** 2 * Ka[0], Hh * Ka[0] * Ka[1], Ka[0] * Ka[1] * Ka[2]]; const s = t.reduce((a, b) => a + b, 0);
  return t.map(v => v / s);
}
/** Carbonic-acid dissociation constants at temperature T (°C): { pK1, pK2 } (Plummer & Busenberg 1982; 6.351 and 10.329 at 25 °C). */
export function carbonatePK(T = 25) {
  const Tk = T + K0, L = Math.log10(Tk);
  const logK1 = -356.3094 - 0.06091964 * Tk + 21834.37 / Tk + 126.8339 * L - 1684915 / (Tk * Tk);
  const logK2 = -107.8871 - 0.03252849 * Tk + 5151.79 / Tk + 38.92561 * L - 563713.9 / (Tk * Tk);
  return { pK1: -logK1, pK2: -logK2 };
}
/** Fraction of carbonate species at pH and temperature T (°C, default 25): [CO2(aq), HCO3-, CO3 2-]. */
export function carbonateSpecies(pH, T = 25) {
  const { pK1, pK2 } = carbonatePK(T);
  const K1 = Math.pow(10, -pK1), K2 = Math.pow(10, -pK2), Hh = Math.pow(10, -pH);
  const t = [Hh * Hh, Hh * K1, K1 * K2]; const s = t[0] + t[1] + t[2]; return t.map(v => v / s);
}

/* ------------------------------------------------------------ sensors */
/** Thermistor resistance → °C via Steinhart–Hart (default coefficients: 10 kΩ NTC). */
export function steinhartHart(Rohm, A = 1.009249522e-3, B = 2.378405444e-4, Cc = 2.019202697e-7) { const L = Math.log(Rohm); return 1 / (A + B * L + Cc * L ** 3) - K0; }
/** Thermistor β-model resistance at T (°C). */
export const thermistorR = (T, R25 = 10000, beta = 3950) => R25 * Math.exp(beta * (1 / (T + K0) - 1 / 298.15));
/** Beer–Lambert transmittance. */
export const beerLambert = (eps, conc, path) => Math.exp(-eps * conc * path);

/* ------------------------------------------------------------ biology helpers */
/** Non-rectangular hyperbola light response (Thornley). I PPFD, phi quantum yield, Amax gross max, theta curvature, Rd dark respiration. Returns net assimilation. */
export function nonRectHyperbola(I, phi = 0.05, Amax = 25, theta = 0.7, Rd = 1.5) {
  const b = phi * I + Amax; return (b - Math.sqrt(Math.max(0, b * b - 4 * theta * phi * I * Amax))) / (2 * theta) - Rd;
}
/** Q10 temperature scaling. */
export const q10 = (rateRef, Q10, T, Tref = 20) => rateRef * Math.pow(Q10, (T - Tref) / 10);
/** Arrhenius with peaked deactivation (used by Farquhar-type models). Ha, Hd J mol⁻¹, S J mol⁻¹ K⁻¹. */
export function arrheniusPeaked(k25, Ha, T, Hd = 200000, S = 650) {
  const Tk = T + K0, Tr = 298.15;
  const a = Math.exp(Ha * (Tk - Tr) / (Tr * R * Tk));
  const b = (1 + Math.exp((Tr * S - Hd) / (Tr * R))) / (1 + Math.exp((Tk * S - Hd) / (Tk * R)));
  return k25 * a * b;
}
/** Michaelis–Menten uptake rate. */
export const michaelisMenten = (C, Vmax, Km, Cmin = 0) => C <= Cmin ? 0 : Vmax * (C - Cmin) / (Km + C - Cmin);
/** Monod specific growth rate. */
export const monod = (S, muMax, Ks) => muMax * S / (Ks + S);
/** Logistic growth value at time t. */
export const logistic = (t, K, r, t0) => K / (1 + Math.exp(-r * (t - t0)));
/** Gompertz growth value at time t (Zwietering form). */
export const gompertz = (t, A, mu, lag) => A * Math.exp(-Math.exp(mu * Math.E / A * (lag - t) + 1));

/* ------------------------------------------------------------ numerical integration */
/** Classic 4th-order Runge–Kutta step for dy/dt = f(t, y), y an array. */
export function rk4(f, t, y, dt) {
  const k1 = f(t, y);
  const y2 = y.map((v, i) => v + dt / 2 * k1[i]); const k2 = f(t + dt / 2, y2);
  const y3 = y.map((v, i) => v + dt / 2 * k2[i]); const k3 = f(t + dt / 2, y3);
  const y4 = y.map((v, i) => v + dt * k3[i]); const k4 = f(t + dt, y4);
  return y.map((v, i) => v + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}
/** Integrate an ODE system over [t0, t1] with step dt; returns { t: [...], y: [[...], ...] }. */
export function integrate(f, y0, t0, t1, dt, { every = 1 } = {}) {
  const T = [t0], Y = [y0.slice()]; let y = y0.slice(), t = t0, k = 0;
  while (t < t1 - 1e-12) { const s = Math.min(dt, t1 - t); y = rk4(f, t, y, s); t += s; k++; if (k % every === 0 || t >= t1 - 1e-12) { T.push(t); Y.push(y.slice()); } }
  return { t: T, y: Y };
}

/* ------------------------------------------------------------ smooth pseudo-random weather */
/** 1-D value noise in [−1, 1], smooth, seeded. */
export function noise1D(x, seed = 1) {
  const i = Math.floor(x), f = x - i; const u = f * f * (3 - 2 * f);
  const rnd = n => { const s = Math.sin((n + seed * 131.7) * 12.9898) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
  return rnd(i) * (1 - u) + rnd(i + 1) * u;
}
/** Fractal (octave-summed) 1-D noise in ≈[−1, 1]. */
export function fbm1D(x, seed = 1, oct = 4) { let a = 0, amp = 0.5, fr = 1, n = 0; for (let o = 0; o < oct; o++) { a += amp * noise1D(x * fr, seed + o * 17); n += amp; amp *= 0.5; fr *= 2; } return a / n; }
