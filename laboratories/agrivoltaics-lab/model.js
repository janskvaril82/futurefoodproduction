/* ==========================================================================
   Agrivoltaic field designer — physical model (pure JS, no DOM).
   Every equation is documented in the Derive tab (Eqs. A1–A11).

   · solar geometry (physics.js: FAO-56 / Spencer), local solar time
   · irradiance: clear-sky shape (Haurwitz 1945) scaled to the NASA POWER monthly
     clearness index; beam/diffuse split with Erbs et al. (1982)                (A1–A2)
   · canopy light: hourly ray casting of the direct beam against the panel
     rectangles + isotropic diffuse × sky-view factor (numerical quadrature)     (A3–A5)
   · crop: non-rectangular-hyperbola canopy light response integrated over the
     season, harvest-sensitivity exponent γ; calibrated to published shade
     responses (Laub et al. 2022; Fraunhofer ISE Heggelbach 2017)                (A8)
   · PV: plane-of-array irradiance on both faces (beam with row-to-row shading and
     ASHRAE incidence-angle modifier, isotropic sky, ground reflection), NOCT cell
     temperature, bifaciality, system losses (PVWatts default 14 %)              (A6–A7)
   · land equivalent ratio LER = Y_AV/Y_ref + E_AV/E_ref (Dupraz et al. 2011)     (A9)
   ========================================================================== */
import { solarElevation, solarAzimuth, extraterrestrialRadiation, earthSunFactor, SUN_PPFD_PER_WM2 } from '../../assets/js/physics.js';

export const GSC = 1367;                      // W m⁻², solar constant (FAO-56 0.0820 MJ m⁻² min⁻¹)
export const MID = [15, 45, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
export const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const D2R = Math.PI / 180;

/* ------------------------------------------------------------------ sites
   NASA POWER Climatology API v2.10 (retrieved September 2026), monthly means Jan–Dec:
   kt = ALLSKY_KT (all-sky clearness index), t2m = T2M (°C), tr = T2M_RANGE (mean daily range, K). */
export const LOCS = {
  karrbo: { name: 'Kärrbo prästgård, Västerås (SE)', lat: 59.55, lon: 16.76, veg: 'nordic',
    kt: [0.28, 0.36, 0.47, 0.50, 0.50, 0.51, 0.49, 0.48, 0.45, 0.38, 0.29, 0.27],
    t2m: [-4.34, -3.51, -0.02, 5.62, 11.09, 15.56, 18.45, 17.20, 12.61, 6.35, 1.73, -2.38],
    tr: [4.70, 5.46, 6.73, 8.66, 9.02, 8.73, 8.68, 8.48, 7.77, 5.47, 3.48, 4.03] },
  lund: { name: 'Lund, Skåne (SE)', lat: 55.70, lon: 13.19, veg: 'nordic',
    kt: [0.28, 0.34, 0.45, 0.51, 0.52, 0.51, 0.50, 0.49, 0.47, 0.39, 0.29, 0.25],
    t2m: [1.18, 0.87, 2.55, 6.35, 11.15, 15.16, 17.98, 17.96, 14.65, 10.20, 6.30, 3.00],
    tr: [2.82, 3.14, 4.34, 5.73, 6.10, 5.72, 5.73, 5.33, 4.93, 3.74, 2.81, 2.72] },
  kiruna: { name: 'Kiruna (SE)', lat: 67.86, lon: 20.23, veg: 'nordic',
    kt: [0.34, 0.43, 0.53, 0.55, 0.48, 0.44, 0.44, 0.43, 0.40, 0.34, 0.30, 0.29],
    t2m: [-13.30, -12.67, -9.31, -3.68, 2.93, 8.80, 12.65, 10.41, 5.02, -2.55, -8.44, -10.94],
    tr: [5.49, 6.29, 7.99, 6.76, 6.63, 7.16, 7.41, 7.13, 5.97, 4.53, 4.87, 5.25] },
  heggelbach: { name: 'Heggelbach, Lake Constance (DE)', lat: 47.87, lon: 9.10, veg: 'temperate',
    kt: [0.39, 0.44, 0.48, 0.49, 0.48, 0.50, 0.52, 0.51, 0.49, 0.45, 0.38, 0.37],
    t2m: [-1.44, -0.45, 3.76, 8.56, 12.78, 16.75, 18.31, 17.81, 13.55, 9.13, 3.65, -0.49],
    tr: [6.03, 7.31, 8.91, 10.05, 9.54, 9.30, 9.20, 9.07, 9.21, 8.43, 6.57, 5.68] },
  montpellier: { name: 'Montpellier (FR)', lat: 43.62, lon: 3.87, veg: 'temperate',
    kt: [0.46, 0.51, 0.52, 0.53, 0.55, 0.60, 0.62, 0.60, 0.57, 0.48, 0.47, 0.46],
    t2m: [7.10, 7.41, 10.29, 13.40, 17.02, 21.78, 24.48, 24.09, 20.21, 16.30, 11.40, 7.94],
    tr: [6.64, 7.62, 8.27, 8.58, 9.12, 9.87, 10.34, 10.16, 9.40, 7.78, 6.79, 6.36] },
  tucson: { name: 'Tucson, Arizona (US)', lat: 32.23, lon: -110.95, veg: 'arid',
    kt: [0.64, 0.65, 0.69, 0.73, 0.74, 0.73, 0.62, 0.63, 0.65, 0.69, 0.67, 0.64],
    t2m: [10.00, 11.22, 14.91, 18.54, 23.43, 29.28, 29.40, 28.65, 26.37, 20.93, 15.02, 9.72],
    tr: [13.91, 14.30, 15.73, 16.82, 17.40, 17.14, 12.62, 12.63, 13.77, 14.76, 14.31, 13.56] }
};

/* ------------------------------------------------------------------ crops
   Ik = saturation onset of the canopy light response (µmol m⁻² s⁻¹), γ = harvest-sensitivity exponent.
   Calibrated (scratch script, 50° N, Kt 0.5, May–Aug, uniform shade) so that uniform shading reproduces:
   lettuce  : 86 % yield at 40 % shade (leafy vegetables, Laub et al. 2022)
   ley      : 93 % yield at 40 % shade (forages, Laub et al. 2022)
   potato   : 82 % yield at ≈30 % less radiation (Heggelbach 2017, Fraunhofer ISE 2017)
   cereal   : 81 % yield at ≈30 % less radiation (winter wheat, Heggelbach 2017)
   maize    : 45 % yield at 40 % shade (Laub et al. 2022) with a near-linear C4 response and γ = 1.75 */
export const CROPS = {
  lettuce: { name: 'Lettuce (leafy vegetable)', Ik: 330, gamma: 1, months: [4, 5, 6, 7], h: 0.22, vis: 'lettuce', rowSp: 0.4, plantSp: 0.32, tol: 'shade-tolerant', anchor: 'leafy vegetables: 86 % of the unshaded yield at 40 % shade (Laub et al., 2022)' },
  potato: { name: 'Potato (tuber crop)', Ik: 820, gamma: 1, months: [5, 6, 7, 8], h: 0.55, vis: 'potato', rowSp: 0.75, plantSp: 0.36, tol: 'intermediate', anchor: 'potato −18 % with ≈30 % less radiation, Heggelbach 2017 (Fraunhofer ISE, 2017)' },
  ley: { name: 'Ley grass (forage, as at Kärrbo)', Ik: 140, gamma: 1, months: [4, 5, 6, 7, 8], h: 0.4, vis: 'grass', rowSp: 0.15, plantSp: 0.15, tol: 'shade-tolerant', anchor: 'forages: 93 % at 40 % shade (Laub et al., 2022)' },
  cereal: { name: 'Spring cereal (barley/oats, C₃)', Ik: 900, gamma: 1, months: [4, 5, 6], h: 0.8, vis: 'cereal', rowSp: 0.125, plantSp: 0.125, tol: 'intermediate', anchor: 'winter wheat −19 % with ≈30 % less radiation, Heggelbach 2017' },
  maize: { name: 'Maize (C₄, shade-sensitive)', Ik: 2500, gamma: 1.75, months: [5, 6, 7, 8], h: 1.9, vis: 'maize', rowSp: 0.75, plantSp: 0.2, tol: 'shade-sensitive', anchor: 'maize: 45 % of the unshaded yield at 40 % shade (Laub et al., 2022)' }
};
export const THETA_NRH = 0.7;                 // curvature of the non-rectangular hyperbola (Thornley)

/* ------------------------------------------------------------------ PV technology (defaults) */
export const PV = { eta: 0.215, gammaT: -0.0035, noct: 45, loss: 0.14, albedo: 0.2, b0: 0.05 };
/** Reference: conventional ground-mounted PV plant on the same land (monofacial, equator-facing, tilt 30°, GCR 0.45). */
export const REF = { tilt: 30, gcr: 0.45, w: 2.3, h: 0.8 };

/* ------------------------------------------------------------------ helpers */
export function monthlyInterp(arr, d) {
  let k = MID.findIndex(m => m > d); if (k === -1) k = 12;
  const i0 = (k + 11) % 12, i1 = k % 12; let d0 = MID[i0], d1 = MID[i1];
  if (k === 0) d0 -= 365; if (k === 12) d1 += 365;
  const t = (d - d0) / (d1 - d0); return arr[i0] * (1 - t) + arr[i1] * t;
}
/** Clear-sky global horizontal irradiance, W m⁻² (Haurwitz 1945). el in rad. */
export const haurwitz = el => el <= 0 ? 0 : 1098 * Math.sin(el) * Math.exp(-0.059 / Math.sin(el));
/** Diffuse fraction of global irradiance from the clearness index (Erbs, Klein & Duffie 1982). */
export function erbs(kt) { if (kt <= 0.22) return 1 - 0.09 * kt; if (kt <= 0.8) return 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4; return 0.165; }
/** Canopy gross photosynthesis (relative units) — non-rectangular hyperbola with α = 1, Pmax = Ik. */
export function nrh(I, Ik, th = THETA_NRH) { const b = I + Ik; return (b - Math.sqrt(Math.max(0, b * b - 4 * th * I * Ik))) / (2 * th); }
/** ASHRAE incidence-angle modifier. c = cos(angle of incidence). */
export const iam = (c, b0 = PV.b0) => c <= 0.06 ? 0 : Math.max(0, 1 - b0 * (1 / c - 1));

/* ------------------------------------------------------------------ radiation over a day (A1–A2) */
/**
 * dayRadiation(L, doy, sky, dtH) → { t[], el[], az[], ghi[], dni[], dhi[], ta[], kt, H, H0, at(t) }
 * sky: 'clim' (NASA POWER monthly Kt) | 'clear' (Haurwitz clear sky) | 'overcast' (Kt = 0.2)
 */
export function dayRadiation(L, doy, sky = 'clim', dtH = 0.25) {
  const n = Math.round(24 / dtH);
  const t = new Float64Array(n), el = new Float64Array(n), az = new Float64Array(n), gcs = new Float64Array(n);
  let Ics = 0;
  for (let i = 0; i < n; i++) {
    t[i] = (i + 0.5) * dtH; el[i] = solarElevation(L.lat, doy, t[i]); az[i] = solarAzimuth(L.lat, doy, t[i]);
    gcs[i] = haurwitz(el[i]); Ics += gcs[i] * dtH * 3600;
  }
  const H0 = extraterrestrialRadiation(L.lat, doy) * 1e6;                // J m⁻² d⁻¹
  const ktClear = H0 > 0 ? Ics / H0 : 0;
  const kt = sky === 'clear' ? ktClear : sky === 'overcast' ? Math.min(0.2, ktClear) : Math.min(monthlyInterp(L.kt, doy), ktClear);
  const scale = Ics > 0 ? kt * H0 / Ics : 0;
  const E0 = earthSunFactor(doy);
  const m = Math.min(11, Math.floor((doy - 1) / 30.5));
  const tMean = monthlyInterp(L.t2m, doy), tRange = monthlyInterp(L.tr, doy);
  const comp = (e, g) => {
    const s = Math.sin(e); if (s <= 0 || g <= 0) return [0, 0, 0];
    const g0h = GSC * E0 * s; const k = Math.min(1, g / g0h); const kd = erbs(k);
    const dhi = kd * g; const dni = s > 0.02 ? Math.min(1100, (g - dhi) / s) : 0;
    return [g, dni, g - dni * s > 0 ? g - dni * s : dhi];
  };
  const ghi = new Float64Array(n), dni = new Float64Array(n), dhi = new Float64Array(n), ta = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [g, bn, df] = comp(el[i], gcs[i] * scale); ghi[i] = g; dni[i] = bn; dhi[i] = df;
    ta[i] = tMean + tRange / 2 * Math.cos(2 * Math.PI * (t[i] - 15) / 24);
  }
  const at = h => {
    const e = solarElevation(L.lat, doy, h), a = solarAzimuth(L.lat, doy, h);
    const [g, bn, df] = comp(e, haurwitz(e) * scale);
    return { el: e, az: a, ghi: g, dni: bn, dhi: df, ta: tMean + tRange / 2 * Math.cos(2 * Math.PI * (h - 15) / 24) };
  };
  return { n, dtH, t, el, az, ghi, dni, dhi, ta, kt, ktClear, H: kt * H0, H0, month: m, at };
}
/** Unit vector towards the sun in world axes (x east, y up, z south). */
export function sunWorld(el, az) { const ce = Math.cos(el); return [ce * Math.sin(az), Math.sin(el), -ce * Math.cos(az)]; }

/* ------------------------------------------------------------------ array geometry */
/**
 * makeArray({ mode, h, tilt, az, w, pitch, N, L, tau }) → A
 * Local frame: u (x) along the rows, y up, v (z) across the rows; the FRONT face of every row
 * faces +v and is tilted by β from the horizontal. The group is rotated by θ = π − azimuth.
 */
export function makeArray({ mode = 'overhead', h = 5, tilt = 20, az = 180, w = 3.4, pitch = 9.5, N = 5, L = 40, tau = 0 } = {}) {
  const beta = (mode === 'vertical' ? 90 : tilt) * D2R;
  const cb = Math.cos(beta), sb = Math.sin(beta);
  const rows = new Float64Array(N); for (let k = 0; k < N; k++) rows[k] = -N * pitch / 2 + (k + 0.5) * pitch;
  return { mode, beta, cb, sb, h, w, p: pitch, N, L, tau, rows, yc: h + w / 2 * sb, theta: Math.PI - az * D2R, azDeg: az, gcr: w / pitch, v0: rows[0] };
}
export function toLocal(A, x, y, z) { const c = Math.cos(A.theta), s = Math.sin(A.theta); return [x * c - z * s, y, x * s + z * c]; }
export function toWorld(A, x, y, z) { const c = Math.cos(A.theta), s = Math.sin(A.theta); return [x * c + z * s, y, -x * s + z * c]; }

/** Does the ray P + t·d (t > 0, d pointing to the sky, dy > 0) hit a panel row?  (A3) */
export function blocked(A, px, py, pz, dx, dy, dz) {
  if (dy <= 1e-6) return false;
  const cb = A.cb, sb = A.sb, hw = A.w / 2, hl = A.L / 2;
  const denom = cb * dy + sb * dz;
  if (Math.abs(denom) < 1e-12) return false;
  // rows that the ray can reach while crossing the panel height band [h, h + w sinβ]
  const y0 = A.h - 1e-6, y1 = A.h + A.w * sb + 1e-6;
  const ta = Math.max(0, (y0 - py) / dy), tb = (y1 - py) / dy; if (tb <= 0) return false;
  const za = pz + ta * dz, zb = pz + tb * dz; const reach = hw * cb + 1e-6;
  const zmin = Math.min(za, zb) - reach, zmax = Math.max(za, zb) + reach;
  let k0 = Math.ceil((zmin - A.v0) / A.p), k1 = Math.floor((zmax - A.v0) / A.p);
  if (k0 < 0) k0 = 0; if (k1 > A.N - 1) k1 = A.N - 1;
  for (let k = k0; k <= k1; k++) {
    const vk = A.rows[k];
    const t = (cb * (A.yc - py) + sb * (vk - pz)) / denom; if (t <= 0) continue;
    const qx = px + t * dx; if (qx < -hl || qx > hl) continue;
    const dw = (py + t * dy - A.yc) * sb - (pz + t * dz - vk) * cb;
    if (dw >= -hw && dw <= hw) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ hemisphere quadrature (A4) */
function hemiDirs(nTheta = 8, nPhi = 24) {
  // cosine-weighted stratified directions around +y: equal weights, sin²θ uniform in each ring
  const out = [];
  for (let i = 0; i < nTheta; i++) {
    const th = Math.asin(Math.sqrt((i + 0.5) / nTheta));
    for (let j = 0; j < nPhi; j++) { const ph = 2 * Math.PI * (j + 0.5 * (i % 2 ? 1 : 0.5)) / nPhi; out.push([Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]); }
  }
  return out;
}
const HEMI = hemiDirs(8, 24);
/** Sky view factor (cosine-weighted visible sky fraction, blocked sky counted with transmission τ) at a point. */
export function skyViewFactor(A, px, py, pz, dirs = HEMI) {
  let s = 0; for (const d of dirs) s += blocked(A, px, py, pz, d[0], d[1], d[2]) ? A.tau : 1; return s / dirs.length;
}
/** View factors of a module face (midpoint of a central row) to sky, ground and other rows. n = outward normal (local). */
export function faceViewFactors(A, n, k = Math.floor(A.N / 2)) {
  // orthonormal basis (t1, t2, n)
  const t1 = [1, 0, 0]; const t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
  const P = [0, A.yc, A.rows[k]]; const eps = 0.02;
  let sky = 0, gnd = 0, row = 0; const nT = 8, nP = 24;
  for (let i = 0; i < nT; i++) {
    const th = Math.asin(Math.sqrt((i + 0.5) / nT));
    for (let j = 0; j < nP; j++) {
      const ph = 2 * Math.PI * (j + 0.5) / nP; const a = Math.sin(th) * Math.cos(ph), b = Math.sin(th) * Math.sin(ph), c = Math.cos(th);
      const d = [a * t1[0] + b * t2[0] + c * n[0], a * t1[1] + b * t2[1] + c * n[1], a * t1[2] + b * t2[2] + c * n[2]];
      const px = P[0] + n[0] * eps, py = P[1] + n[1] * eps, pz = P[2] + n[2] * eps;
      if (d[1] > 0) { if (blockedAny(A, px, py, pz, d, k)) row++; else sky++; }
      else { if (blockedAny(A, px, py, pz, d, k)) row++; else gnd++; }
    }
  }
  const N = nT * nP; return { sky: sky / N, gnd: gnd / N, row: row / N };
}
// generic ray/rectangle test in any direction, skipping row `skip`
function blockedAny(A, px, py, pz, d, skip) {
  const cb = A.cb, sb = A.sb, hw = A.w / 2, hl = A.L / 2; const denom = cb * d[1] + sb * d[2];
  if (Math.abs(denom) < 1e-12) return false;
  for (let k = 0; k < A.N; k++) {
    if (k === skip) continue; const vk = A.rows[k];
    const t = (cb * (A.yc - py) + sb * (vk - pz)) / denom; if (t <= 0) continue;
    const qx = px + t * d[0]; if (qx < -hl || qx > hl) continue;
    const dw = (py + t * d[1] - A.yc) * sb - (pz + t * d[2] - vk) * cb;
    if (dw >= -hw && dw <= hw) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ ground grid */
/**
 * makeGrid(A, nv, nu, y, strip) → { nv, nu, us, vs, y, mask (interior & cultivated), svf }
 * The grid covers the whole field (v across rows, u along rows); `mask` marks the points used for
 * crop averages: between the outermost rows, away from the row ends, outside the uncultivated strips.
 */
export function makeGrid(A, nv, nu, y, strip = 0, { svfNu = 12, uFrac = 0.6 } = {}) {
  const W = A.N * A.p, L = A.L;
  const vs = new Float64Array(nv), us = new Float64Array(nu);
  for (let i = 0; i < nv; i++) vs[i] = -W / 2 + (i + 0.5) * W / nv;
  for (let j = 0; j < nu; j++) us[j] = -L / 2 + (j + 0.5) * L / nu;
  const mask = new Uint8Array(nv * nu), strip2 = new Uint8Array(nv);
  const vmin = A.N > 1 ? A.rows[0] : -W / 2, vmax = A.N > 1 ? A.rows[A.N - 1] : W / 2;
  for (let i = 0; i < nv; i++) {
    let near = false; for (let k = 0; k < A.N; k++) if (Math.abs(vs[i] - A.rows[k]) < strip / 2) near = true;
    strip2[i] = near ? 1 : 0;
    for (let j = 0; j < nu; j++) mask[j * nv + i] = (!near && vs[i] >= vmin && vs[i] <= vmax && Math.abs(us[j]) <= uFrac * L / 2) ? 1 : 0;
  }
  // sky-view factor on a coarser grid along u, linearly interpolated
  const su = new Float64Array(svfNu); for (let j = 0; j < svfNu; j++) su[j] = -L / 2 + (j + 0.5) * L / svfNu;
  const coarse = new Float64Array(nv * svfNu);
  for (let j = 0; j < svfNu; j++) for (let i = 0; i < nv; i++) coarse[j * nv + i] = skyViewFactor(A, su[j], y, vs[i]);
  const svf = new Float32Array(nv * nu);
  for (let j = 0; j < nu; j++) {
    const f = (us[j] + L / 2) / (L / svfNu) - 0.5; const j0 = Math.max(0, Math.min(svfNu - 1, Math.floor(f))), j1 = Math.min(svfNu - 1, j0 + 1); const a = Math.max(0, Math.min(1, f - j0));
    for (let i = 0; i < nv; i++) svf[j * nv + i] = coarse[j0 * nv + i] * (1 - a) + coarse[j1 * nv + i] * a;
  }
  return { nv, nu, us, vs, y, mask, strip: strip2, svf };
}

/* ------------------------------------------------------------------ light over a day on the grid (A5) */
/**
 * dayLight(A, G, dr, crop, { probe }) → per-point daily PAR (mol m⁻² d⁻¹), photosynthesis sums, time series.
 */
export function dayLight(A, G, dr, crop, { probe = null, series = true } = {}) {
  const n = G.nv * G.nu; const dli = new Float32Array(n), psum = new Float32Array(n);
  let dliOpen = 0, pOpen = 0; const dt = dr.dtH * 3600;
  const ts = [], open = [], mean = [], lo = [], hi = [], pr = [];
  const Ik = crop ? crop.Ik : 800;
  for (let s = 0; s < dr.n; s++) {
    const el = dr.el[s]; if (el <= 0 || dr.ghi[s] <= 0) { if (series) { ts.push(dr.t[s]); open.push(0); mean.push(0); lo.push(0); hi.push(0); pr.push(0); } continue; }
    const [wx, wy, wz] = sunWorld(el, dr.az[s]); const [dx, dy, dz] = toLocal(A, wx, wy, wz);
    const beamH = dr.dni[s] * Math.sin(el), dhi = dr.dhi[s];
    const Iopen = SUN_PPFD_PER_WM2 * dr.ghi[s];
    dliOpen += Iopen * dt; pOpen += nrh(Iopen, Ik) * dt;
    let sm = 0, cnt = 0, mn = Infinity, mx = -Infinity;
    for (let j = 0; j < G.nu; j++) {
      const u = G.us[j];
      for (let i = 0; i < G.nv; i++) {
        const k = j * G.nv + i;
        const direct = blocked(A, u, G.y, G.vs[i], dx, dy, dz) ? A.tau * beamH : beamH;
        const I = SUN_PPFD_PER_WM2 * (direct + dhi * G.svf[k]);
        dli[k] += I * dt; psum[k] += nrh(I, Ik) * dt;
        if (G.mask[k]) { sm += I; cnt++; if (I < mn) mn = I; if (I > mx) mx = I; }
      }
    }
    if (series) {
      ts.push(dr.t[s]); open.push(Iopen); mean.push(cnt ? sm / cnt : 0); lo.push(cnt ? mn : 0); hi.push(cnt ? mx : 0);
      if (probe) { const svf = skyViewFactor(A, probe.u, G.y, probe.v); pr.push(SUN_PPFD_PER_WM2 * ((blocked(A, probe.u, G.y, probe.v, dx, dy, dz) ? A.tau : 1) * beamH + dhi * svf)); } else pr.push(NaN);
    }
  }
  for (let k = 0; k < n; k++) dli[k] /= 1e6;
  return { dli, psum, dliOpen: dliOpen / 1e6, pOpen, series: { ts, open, mean, lo, hi, pr } };
}
/** Instantaneous PPFD on the grid for one sun position. Returns Float32Array. */
export function instantMap(A, G, sun, out) {
  const n = G.nv * G.nu; out = out || new Float32Array(n);
  if (sun.el <= 0 || sun.ghi <= 0) { out.fill(0); return out; }
  const [wx, wy, wz] = sunWorld(sun.el, sun.az); const [dx, dy, dz] = toLocal(A, wx, wy, wz);
  const beamH = sun.dni * Math.sin(sun.el);
  for (let j = 0; j < G.nu; j++) for (let i = 0; i < G.nv; i++) {
    const k = j * G.nv + i;
    out[k] = SUN_PPFD_PER_WM2 * ((blocked(A, G.us[j], G.y, G.vs[i], dx, dy, dz) ? A.tau : 1) * beamH + sun.dhi * G.svf[k]);
  }
  return out;
}

/* ------------------------------------------------------------------ growing season: light and yield (A8) */
export function seasonCrop(A, G, L, crop, sky = 'clim', dtH = 0.5) {
  const n = G.nv * G.nu; const par = new Float64Array(n), ps = new Float64Array(n);
  let parOpen = 0, pOpen = 0;
  for (const m of crop.months) {
    const dr = dayRadiation(L, MID[m], sky, dtH);
    const r = dayLight(A, G, dr, crop, { series: false });
    const wgt = MDAYS[m];
    for (let k = 0; k < n; k++) { par[k] += r.dli[k] * wgt; ps[k] += r.psum[k] * wgt; }
    parOpen += r.dliOpen * wgt; pOpen += r.pOpen * wgt;
  }
  const parRel = new Float32Array(n), yRel = new Float32Array(n);
  let sPar = 0, sY = 0, cnt = 0, mn = Infinity, mx = -Infinity;
  for (let k = 0; k < n; k++) {
    parRel[k] = parOpen > 0 ? par[k] / parOpen : 0;
    yRel[k] = pOpen > 0 ? Math.pow(ps[k] / pOpen, crop.gamma) : 0;
    if (G.mask[k]) { sPar += parRel[k]; sY += yRel[k]; cnt++; if (parRel[k] < mn) mn = parRel[k]; if (parRel[k] > mx) mx = parRel[k]; }
  }
  const days = crop.months.reduce((a, m) => a + MDAYS[m], 0);
  return { parRel, yRel, meanPar: cnt ? sPar / cnt : 1, meanY: cnt ? sY / cnt : 1, minPar: mn, maxPar: mx, parOpenMean: parOpen / days };
}
/** Relative yield under a uniform relative shade s for a crop (used for calibration tables and charts). */
export function uniformShadeYield(L, crop, s, sky = 'clim') {
  let a = 0, b = 0;
  for (const m of crop.months) { const dr = dayRadiation(L, MID[m], sky, 0.5); for (let i = 0; i < dr.n; i++) { const I = SUN_PPFD_PER_WM2 * dr.ghi[i]; a += nrh((1 - s) * I, crop.Ik) * MDAYS[m]; b += nrh(I, crop.Ik) * MDAYS[m]; } }
  return b > 0 ? Math.pow(a / b, crop.gamma) : 1;
}
/** Laub et al. (2022) meta-regression form: Y = 10^(b·RSR + c·RSR²), RSR in %. Coefficients reconstructed from the published point estimates. */
export const LAUB = { c: -7.2e-5, b: { berries: 0.00427, forages: 0.00207, leafy: 0.00124, cereals: -0.00242, maize: -0.00579, legumes: -0.00465 } };
export const laubYield = (group, rsrPct) => Math.pow(10, LAUB.b[group] * rsrPct + LAUB.c * rsrPct * rsrPct);

/* ------------------------------------------------------------------ PV (A6–A7) */
/** Mean ground (canopy-level) irradiance in the row gap for infinitely long rows: beam minus shadow fraction + diffuse × mean SVF. */
function groundIrr(A, d, dni, dhi, svfMean) {
  if (d[1] <= 0) return dhi * svfMean;
  const cAOI = Math.abs(A.cb * d[1] + A.sb * d[2]);
  const shadow = Math.min(1, A.gcr * cAOI / d[1]);
  return dni * d[1] * (1 - (1 - A.tau) * shadow) + dhi * svfMean;
}
/**
 * Plane-of-array irradiance on front and back faces and module power per m² of module for one time step.
 * vf = { f: {sky, gnd}, b: {sky, gnd} } face view factors; edge = fraction of rows that have a shading neighbour.
 */
export function poa(A, d, sun, vf, svfMean, pv, bif, edge = 1) {
  const cf = A.cb * d[1] + A.sb * d[2];           // cos AOI of the front face (n_f = (0, cosβ, sinβ))
  const cbk = -cf;                                  // back face
  const shadeF = cf > 0 && d[1] > 0 ? Math.min(1, Math.max(0, 1 - (A.p / A.w) * d[1] / cf)) * edge : 0;
  const shadeB = cbk > 0 && d[1] > 0 ? Math.min(1, Math.max(0, 1 - (A.p / A.w) * d[1] / cbk)) * edge : 0;
  const Eg = groundIrr(A, d, sun.dni, sun.dhi, svfMean);
  const beam = d[1] > 0 ? sun.dni : 0;
  const Gf = beam * Math.max(0, cf) * iam(cf, pv.b0) * (1 - shadeF) + sun.dhi * vf.f.sky + pv.albedo * Eg * vf.f.gnd;
  const Gb = beam * Math.max(0, cbk) * iam(cbk, pv.b0) * (1 - shadeB) + sun.dhi * vf.b.sky + pv.albedo * Eg * vf.b.gnd;
  const Geff = Gf + bif * Gb;
  const Tc = sun.ta + (pv.noct - 20) / 800 * Geff;
  const P = pv.eta * Geff * (1 + pv.gammaT * (Tc - 25)) * (1 - pv.loss);     // W per m² of module
  return { Gf, Gb, Geff, Tc, P, Eg, shadeF, shadeB };
}
/** Annual PV output per m² of module (kWh m⁻² yr⁻¹) from 12 representative days. */
export function pvAnnual(A, L, pv, bif, sky = 'clim', { svfMean = null, edge = 1, dtH = 0.25 } = {}) {
  const vf = { f: faceViewFactors(A, [0, A.cb, A.sb]), b: faceViewFactors(A, [0, -A.cb, -A.sb]) };
  if (svfMean == null) { let s = 0, c = 0; const k = Math.floor(A.N / 2); const v0 = A.rows[k], v1 = k + 1 < A.N ? A.rows[k + 1] : v0 + A.p; for (let i = 0; i < 12; i++) { s += skyViewFactor(A, 0, 0.3, v0 + (i + 0.5) / 12 * (v1 - v0)); c++; } svfMean = s / c; }
  let E = 0, Ef = 0, Eb = 0, H = 0; const monthly = [];
  for (let m = 0; m < 12; m++) {
    const dr = dayRadiation(L, MID[m], sky, dtH); let e = 0, ef = 0, eb = 0;
    for (let i = 0; i < dr.n; i++) {
      if (dr.ghi[i] <= 0) continue;
      const [wx, wy, wz] = sunWorld(dr.el[i], dr.az[i]); const d = toLocal(A, wx, wy, wz);
      const r = poa(A, d, { dni: dr.dni[i], dhi: dr.dhi[i], ta: dr.ta[i] }, vf, svfMean, pv, bif, edge);
      e += r.P * dtH; ef += r.Gf * dtH; eb += r.Gb * dtH;
    }
    monthly.push(e * MDAYS[m] / 1000); E += e * MDAYS[m]; Ef += ef * MDAYS[m]; Eb += eb * MDAYS[m]; H += dr.H / 3.6e6 * MDAYS[m];
  }
  return { e: E / 1000, spec: E / 1000 / pv.eta, front: Ef / 1000, back: Eb / 1000, ghi: H, monthly, vf, svfMean, bifGain: Ef > 0 ? bif * Eb / Ef : 0 };
}
/** Reference ground-mounted PV plant (monofacial, equator-facing, tilt 30°, GCR 0.45): kWh per m² of LAND per year. */
export function referencePV(L, pv, sky = 'clim') {
  const A = makeArray({ mode: 'ground', h: REF.h, tilt: REF.tilt, az: L.lat >= 0 ? 180 : 0, w: REF.w, pitch: REF.w / REF.gcr, N: 15, L: 300 });
  const r = pvAnnual(A, L, pv, 0, sky, { edge: 1 });
  return { perLand: r.e * REF.gcr, spec: r.spec, e: r.e };
}

/* ------------------------------------------------------------------ land equivalent ratio (A9) and GCR sweep */
export function ler(cropRel, energyRel) { return cropRel + energyRel; }
/**
 * Sweep of the ground-coverage ratio for the current design (extended array: 9 rows, 300 m long,
 * crop sampled across the central row gap; PV of a large array). Returns arrays for the chart.
 */
export function gcrSweep(base, L, crop, pv, bif, strip, sky, eRefLand, gcrs) {
  const out = { gcr: [], crop: [], energy: [], ler: [] };
  for (const g of gcrs) {
    const pitch = base.w / g; if (pitch < base.w * 0.98 && base.mode !== 'vertical') continue;
    const A = makeArray({ mode: base.mode, h: base.h, tilt: base.tilt, az: base.az, w: base.w, pitch, N: 9, L: 300, tau: base.tau });
    const r = cropGap(A, L, crop, strip, sky);
    const pvr = pvAnnual(A, L, pv, bif, sky, { dtH: 0.5 });
    const eRel = base.mode === 'none' ? 0 : pvr.e * g / eRefLand;
    const cRel = base.mode === 'ground' ? 0 : r * Math.max(0, 1 - strip / pitch);
    out.gcr.push(g); out.crop.push(cRel); out.energy.push(eRel); out.ler.push(cRel + eRel);
  }
  return out;
}
/** Mean relative yield across the central row gap of an extended array (cultivated part only). */
export function cropGap(A, L, crop, strip, sky = 'clim', nv = 24) {
  const k = Math.floor(A.N / 2) - 1; const v0 = A.rows[k], v1 = A.rows[k + 1];
  const G = { nv, nu: 1, us: new Float64Array([0]), vs: new Float64Array(nv), y: crop.h, mask: new Uint8Array(nv), svf: new Float32Array(nv) };
  for (let i = 0; i < nv; i++) {
    const v = v0 + (i + 0.5) / nv * (v1 - v0); G.vs[i] = v;
    const near = Math.abs(v - v0) < strip / 2 || Math.abs(v - v1) < strip / 2; G.mask[i] = near ? 0 : 1;
    G.svf[i] = skyViewFactor(A, 0, crop.h, v);
  }
  const s = seasonCrop(A, G, L, crop, sky, 0.5);
  return s.meanY;
}
