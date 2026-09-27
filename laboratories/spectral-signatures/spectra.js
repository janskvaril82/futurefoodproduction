/* Spectral signatures — physics module (pure ES module, no DOM).
   Leaf:    PROSPECT-D (Jacquemoud & Baret 1990; Féret et al. 2017) — plate model of a leaf with N elementary layers.
   Canopy:  two-stream Kubelka–Munk canopy of horizontal leaves over a soil background (Allen & Richardson 1968).
   Soil:    measured dry and wet reference soils of the PROSAIL distribution, mixed linearly with moisture.
   Water:   semi-analytical approximation for optically deep water built on the absorption spectrum of pure water.
   Snow:    asymptotic radiative-transfer albedo of clean snow (Kokhanovsky 2013) with ice constants of Warren & Brandt (2008).
   Sensors: band centres and widths from ESA (Sentinel-2A MSI), USGS (Landsat 8/9 OLI), MicaSense (RedEdge-MX), DJI (Mavic 3M).
   Used by /laboratories/spectral-signatures/ and /laboratories/drone-ndvi/. See the Derive tab for every equation. */
import { WL, NWL, WL0, WL_STEP, NR, KAB, KCAR, KANT, KBROWN, KW, KM, SOIL_DRY, SOIL_WET, ICE_CHI } from './optics-data.js';
export { WL, NWL, WL0, WL_STEP };

/* ------------------------------------------------------------------ special functions */
/** Exponential integral E1(x), x > 0 (series for x ≤ 1, Lentz continued fraction otherwise; Numerical Recipes §6.3). */
export function E1(x) {
  if (x <= 0) return Infinity;
  if (x <= 1) {
    let sum = 0, term = 1;
    for (let k = 1; k < 80; k++) { term *= -x / k; const d = term / k; sum += d; if (Math.abs(d) < 1e-17) break; }
    return -0.5772156649015329 - Math.log(x) - sum;
  }
  let b = x + 1, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 300; i++) {
    const an = -i * i; b += 2; d = 1 / (an * d + b); c = b + an / c; const del = c * d; h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h * Math.exp(-x);
}
/** Mean transmissivity of a dielectric plane surface for isotropic light within a cone of half-angle alpha (deg)
 *  (Stern 1964; Allen 1973) — used by PROSPECT for the leaf surface. */
export function tav(alphaDeg, nr) {
  const n2 = nr * nr, np = n2 + 1, nm = n2 - 1, a = (nr + 1) * (nr + 1) / 2, k = -(n2 - 1) * (n2 - 1) / 4;
  const sa = Math.sin(alphaDeg * Math.PI / 180);
  const b1 = alphaDeg !== 90 ? Math.sqrt((sa * sa - np / 2) * (sa * sa - np / 2) + k) : 0;
  const b2 = sa * sa - np / 2, b = b1 - b2, b3 = b * b * b, a3 = a * a * a;
  const ts = (k * k / (6 * b3) + k / b - b / 2) - (k * k / (6 * a3) + k / a - a / 2);
  const tp1 = -2 * n2 * (b - a) / (np * np);
  const tp2 = -2 * n2 * np * Math.log(b / a) / (nm * nm);
  const tp3 = n2 * (1 / b - 1 / a) / 2;
  const tp4 = 16 * n2 * n2 * (n2 * n2 + 1) * Math.log((2 * np * b - nm * nm) / (2 * np * a - nm * nm)) / (np * np * np * nm * nm);
  const tp5 = 16 * n2 * n2 * n2 * (1 / (2 * np * b - nm * nm) - 1 / (2 * np * a - nm * nm)) / (np * np * np);
  return (ts + tp1 + tp2 + tp3 + tp4 + tp5) / (2 * sa * sa);
}
const TAV40 = Float64Array.from(NR, n => tav(40, n));
const TAV90 = Float64Array.from(NR, n => tav(90, n));

/* ------------------------------------------------------------------ PROSPECT-D */
export const LEAF_DEFAULT = { N: 1.5, cab: 45, car: 10, ant: 0, brown: 0, cw: 0.015, cm: 0.005 };
/**
 * PROSPECT-D leaf reflectance and transmittance (Féret et al. 2017).
 * N structure (–), cab chlorophyll a+b (µg cm⁻²), car carotenoids (µg cm⁻²), ant anthocyanins (µg cm⁻²),
 * brown brown pigments (arbitrary), cw equivalent water thickness (cm), cm dry matter per area (g cm⁻²).
 * idx (optional): array of wavelength indices to evaluate (default: all 421).
 * Returns { R, T } (Float64Array, same length as idx or NWL).
 */
export function prospectD(p = LEAF_DEFAULT, idx = null) {
  const { N, cab, car, ant = 0, brown = 0, cw, cm } = Object.assign({}, LEAF_DEFAULT, p);
  const n = idx ? idx.length : NWL;
  const R = new Float64Array(n), T = new Float64Array(n);
  for (let q = 0; q < n; q++) {
    const i = idx ? idx[q] : q;
    const kall = (cab * KAB[i] + car * KCAR[i] + ant * KANT[i] + brown * KBROWN[i] + cw * KW[i] + cm * KM[i]) / N;
    const tau = kall > 0 ? (1 - kall) * Math.exp(-kall) + kall * kall * E1(kall) : 1;
    // one compact layer (Allen et al. 1969)
    const talf = TAV40[i], ralf = 1 - talf, t12 = TAV90[i], r12 = 1 - t12, t21 = t12 / (NR[i] * NR[i]), r21 = 1 - t21;
    const den = 1 - r21 * r21 * tau * tau;
    const Ta = talf * tau * t21 / den, Ra = ralf + r21 * tau * Ta;
    const t = t12 * tau * t21 / den, r = r12 + r21 * tau * t;
    // N−1 further layers (Stokes 1862)
    let Rsub, Tsub;
    if (r + t >= 1 - 1e-12) { Tsub = t / (t + (1 - t) * (N - 1)); Rsub = 1 - Tsub; }
    else {
      const D = Math.sqrt(Math.max(0, (1 + r + t) * (1 + r - t) * (1 - r + t) * (1 - r - t)));
      const a = (1 + r * r - t * t + D) / (2 * r), b = (1 - r * r + t * t + D) / (2 * t);
      const bNm1 = Math.pow(b, N - 1), bN2 = bNm1 * bNm1, a2 = a * a, dd = a2 * bN2 - 1;
      Rsub = a * (bN2 - 1) / dd; Tsub = bNm1 * (a2 - 1) / dd;
    }
    const dn = 1 - Rsub * r;
    T[q] = Ta * Tsub / dn; R[q] = Ra + Ta * Rsub * t / dn;
  }
  return { R, T };
}

/* ------------------------------------------------------------------ canopy (Kubelka–Munk two-stream) */
/** Reflectance of a horizontal-leaf canopy (LAI L) over a background of reflectance Rs, from leaf r and t (scalars). */
export function kmCanopy(r, t, L, Rs) {
  if (L <= 1e-6) return Rs;
  if (r < 1e-9) return Rs * Math.exp(-2 * (1 - t) * L);
  const a = (1 - t) / r;
  const b = Math.sqrt(Math.max(1e-12, a * a - 1));
  const x = b * r * L;
  const ct = x > 18 ? 1 : 1 / Math.tanh(x);
  return (1 - Rs * (a - b * ct)) / (a - Rs + b * ct);
}
/** Canopy reflectance of a dense canopy of infinite depth (R∞). */
export const kmInfinite = (r, t) => { if (r < 1e-9) return 0; const a = (1 - t) / r; return a - Math.sqrt(Math.max(0, a * a - 1)); };
/** Full canopy spectrum. leaf: {R,T} arrays (NWL); soil: array (NWL). */
export function canopySpectrum(leaf, lai, soil) {
  const out = new Float64Array(NWL);
  for (let i = 0; i < NWL; i++) out[i] = kmCanopy(leaf.R[i], leaf.T[i], lai, soil[i]);
  return out;
}
/** Soil reflectance for a moisture state w (0 = dry reference soil, 1 = wet reference soil); brightness scales it. */
export function soilSpectrum(w = 0, brightness = 1) {
  const out = new Float64Array(NWL);
  for (let i = 0; i < NWL; i++) out[i] = brightness * ((1 - w) * SOIL_DRY[i] + w * SOIL_WET[i]);
  return out;
}
export const soilAt = (i, w = 0, brightness = 1) => brightness * ((1 - w) * SOIL_DRY[i] + w * SOIL_WET[i]);

/* ------------------------------------------------------------------ water and snow */
/**
 * Optically deep water: ρ = ρ_surface + t_s · f · b_b/(a + b_b)   (f = 0.33, t_s ≈ 0.5, ρ_surface = 0.02).
 * a = a_w (pure water, PROSPECT water coefficient × 100 → m⁻¹) + a_g(440)·exp(−0.014(λ−440)) (CDOM, Bricaud et al. 1981);
 * b_b = b_bw (pure water, ≈ half of the molecular scattering 0.0029 m⁻¹ at 500 nm, ∝ λ^−4.32) + b_bp(550)·(550/λ) (particles).
 */
export function waterSpectrum({ bbp550 = 0.01, ag440 = 0.3 } = {}) {
  const out = new Float64Array(NWL);
  for (let i = 0; i < NWL; i++) {
    const l = WL[i];
    const a = KW[i] * 100 + ag440 * Math.exp(-0.014 * (l - 440));
    const bb = 0.5 * 0.0029 * Math.pow(l / 500, -4.32) + bbp550 * 550 / l;
    out[i] = 0.02 + 0.5 * 0.33 * bb / (a + bb);
  }
  return out;
}
/** Clean snow plane albedo (Kokhanovsky 2013): A = exp(−√(γ a_opt)), γ = 4πχ/λ, a_opt = P² a_ef (P = 6.3), r = A^K(µ0). */
export function snowSpectrum({ grain = 150, sza = 45 } = {}) {
  const out = new Float64Array(NWL);
  const aopt = 6.3 * 6.3 * grain * 1e-6;              // m
  const K = 3 / 7 * (1 + 2 * Math.cos(sza * Math.PI / 180));
  for (let i = 0; i < NWL; i++) {
    const gamma = 4 * Math.PI * ICE_CHI[i] / (WL[i] * 1e-9); // m⁻¹
    out[i] = Math.pow(Math.exp(-Math.sqrt(gamma * aopt)), K);
  }
  return out;
}

/* ------------------------------------------------------------------ sensors */
/* role keys: coastal, blue, green, red, re, re2, re3, nir, nirN (narrow NIR), wv, cirrus, swir1, swir2, pan */
export const SENSORS = {
  s2: {
    name: 'Sentinel-2A MSI', short: 'Sentinel-2', platform: 'satellite', note: 'ESA SentiWiki, S2A equivalent wavelengths and bandwidths',
    bands: [
      { id: 'B1', c: 442.7, w: 21, res: 60, role: 'coastal' }, { id: 'B2', c: 492.7, w: 65, res: 10, role: 'blue' },
      { id: 'B3', c: 559.9, w: 35, res: 10, role: 'green' }, { id: 'B4', c: 664.6, w: 31, res: 10, role: 'red' },
      { id: 'B5', c: 704.1, w: 15, res: 20, role: 're' }, { id: 'B6', c: 740.5, w: 13, res: 20, role: 're2' },
      { id: 'B7', c: 782.8, w: 19, res: 20, role: 're3' }, { id: 'B8', c: 832.8, w: 118, res: 10, role: 'nir' },
      { id: 'B8A', c: 864.7, w: 20, res: 20, role: 'nirN' }, { id: 'B9', c: 945.1, w: 20, res: 60, role: 'wv' },
      { id: 'B10', c: 1373.5, w: 29, res: 60, role: 'cirrus' }, { id: 'B11', c: 1613.7, w: 89, res: 20, role: 'swir1' },
      { id: 'B12', c: 2202.4, w: 180, res: 20, role: 'swir2' }
    ],
    use: { blue: 'B2', green: 'B3', red: 'B4', re: 'B5', nir: 'B8', nirRE: 'B8A', nirSW: 'B8A', swir: 'B11' }
  },
  oli: {
    name: 'Landsat 8/9 OLI', short: 'Landsat OLI', platform: 'satellite', note: 'USGS band designations (band edges)',
    bands: [
      { id: 'B1', lo: 430, hi: 450, res: 30, role: 'coastal' }, { id: 'B2', lo: 450, hi: 510, res: 30, role: 'blue' },
      { id: 'B3', lo: 530, hi: 590, res: 30, role: 'green' }, { id: 'B4', lo: 640, hi: 670, res: 30, role: 'red' },
      { id: 'B5', lo: 850, hi: 880, res: 30, role: 'nir' }, { id: 'B9', lo: 1360, hi: 1380, res: 30, role: 'cirrus' },
      { id: 'B6', lo: 1570, hi: 1650, res: 30, role: 'swir1' }, { id: 'B7', lo: 2110, hi: 2290, res: 30, role: 'swir2' }
    ],
    use: { blue: 'B2', green: 'B3', red: 'B4', re: null, nir: 'B5', nirRE: null, nirSW: 'B5', swir: 'B6' }
  },
  micasense: {
    name: 'MicaSense RedEdge-MX (drone)', short: 'RedEdge-MX', platform: 'drone', note: 'MicaSense: centre wavelength and FWHM',
    bands: [
      { id: 'Blue', c: 475, w: 32, role: 'blue' }, { id: 'Green', c: 560, w: 27, role: 'green' }, { id: 'Red', c: 668, w: 14, role: 'red' },
      { id: 'RE', c: 717, w: 12, role: 're' }, { id: 'NIR', c: 842, w: 57, role: 'nir' }
    ],
    use: { blue: 'Blue', green: 'Green', red: 'Red', re: 'RE', nir: 'NIR', nirRE: 'NIR', nirSW: null, swir: null },
    camera: { pitch: 3.75e-6, focal: 5.4e-3, nx: 1280, ny: 960, minInterval: 1 }
  },
  mavic: {
    name: 'DJI Mavic 3M multispectral (drone)', short: 'Mavic 3M', platform: 'drone', note: 'DJI specifications: centre ± half-width',
    bands: [
      { id: 'G', c: 560, w: 32, role: 'green' }, { id: 'R', c: 650, w: 32, role: 'red' },
      { id: 'RE', c: 730, w: 32, role: 're' }, { id: 'NIR', c: 860, w: 52, role: 'nir' }
    ],
    use: { blue: null, green: 'G', red: 'R', re: 'RE', nir: 'NIR', nirRE: 'NIR', nirSW: null, swir: null },
    camera: { pitch: 1 / 2170, focal: 1, nx: 2592, ny: 1944, minInterval: 2 }  // GSD = H/21.7 cm (DJI) → p/f = 1/2170
  },
  rgb: {
    name: 'Consumer RGB camera (Bayer filter)', short: 'RGB camera', platform: 'drone', note: 'illustrative Gaussian responses of a Bayer filter behind an IR-cut filter',
    bands: [
      { id: 'B', c: 460, w: 80, shape: 'gauss', role: 'blue' }, { id: 'G', c: 540, w: 80, shape: 'gauss', role: 'green' },
      { id: 'R', c: 605, w: 60, shape: 'gauss', role: 'red' }
    ],
    use: { blue: 'B', green: 'G', red: 'R', re: null, nir: null, nirRE: null, nirSW: null, swir: null }
  }
};
/** Spectral response weights of a band on the 5 nm grid: [{i, w}]. Top-hat of width w (or edges lo–hi); Gaussian for shape 'gauss'. */
export function bandWeights(b) {
  const lo = b.lo ?? b.c - b.w / 2, hi = b.hi ?? b.c + b.w / 2, c = b.c ?? (lo + hi) / 2, fw = b.w ?? (hi - lo);
  const out = []; let s = 0;
  for (let i = 0; i < NWL; i++) {
    const l = WL[i]; let w = 0;
    if (b.shape === 'gauss') w = Math.exp(-4 * Math.LN2 * ((l - c) / fw) ** 2);
    else {
      // fraction of the 5 nm sample interval [l−2.5, l+2.5] inside the band
      const a = Math.max(lo, l - WL_STEP / 2), z = Math.min(hi, l + WL_STEP / 2); w = Math.max(0, z - a) / WL_STEP;
    }
    if (w > 1e-4) { out.push({ i, w }); s += w; }
  }
  if (!out.length) { const i = Math.max(0, Math.min(NWL - 1, Math.round((c - WL0) / WL_STEP))); out.push({ i, w: 1 }); s = 1; }
  out.forEach(o => { o.w /= s; });
  return out;
}
const bwCache = new Map();
export function bandCentre(b) { return b.c ?? (b.lo + b.hi) / 2; }
export function bandWidth(b) { return b.w ?? (b.hi - b.lo); }
/** Band-averaged reflectance of a spectrum (uniform-energy weighting). */
export function bandAverage(spec, b) {
  const key = b.id + '|' + (b.c ?? b.lo) + '|' + (b.w ?? b.hi) + '|' + (b.shape || '');
  let W = bwCache.get(key); if (!W) { W = bandWeights(b); bwCache.set(key, W); }
  let s = 0; for (const { i, w } of W) s += w * spec[i]; return s;
}
/** Band-averaged reflectances for every band of a sensor → { id: value }. */
export function sensorBands(spec, sensorKey) {
  const S = SENSORS[sensorKey], out = {};
  S.bands.forEach(b => { out[b.id] = bandAverage(spec, b); });
  return out;
}

/* ------------------------------------------------------------------ vegetation indices */
const nd = (a, b) => (a + b) === 0 ? NaN : (a - b) / (a + b);
export const INDEX_INFO = {
  NDVI: { label: 'NDVI', needs: ['nir', 'red'], eq: '(NIR − red)/(NIR + red)' },
  NDRE: { label: 'NDRE', needs: ['nirRE', 're'], eq: '(NIR − RE)/(NIR + RE)' },
  EVI: { label: 'EVI', needs: ['nir', 'red', 'blue'], eq: '2.5(NIR − red)/(NIR + 6 red − 7.5 blue + 1)' },
  SAVI: { label: 'SAVI', needs: ['nir', 'red'], eq: '1.5(NIR − red)/(NIR + red + 0.5)' },
  GNDVI: { label: 'GNDVI', needs: ['nir', 'green'], eq: '(NIR − green)/(NIR + green)' },
  NDWI: { label: 'NDWI (Gao)', needs: ['nirSW', 'swir'], eq: '(NIR − SWIR)/(NIR + SWIR)' }
};
/** Compute all indices from band values; missing bands → NaN. Returns {NDVI,…, bandsUsed:{index:[ids]}}. */
export function indices(bandVals, sensorKey, L = 0.5) {
  const U = SENSORS[sensorKey].use, v = k => (U[k] && bandVals[U[k]] != null) ? bandVals[U[k]] : NaN;
  const nir = v('nir'), red = v('red'), blue = v('blue'), green = v('green'), re = v('re'), nirRE = v('nirRE'), nirSW = v('nirSW'), swir = v('swir');
  return {
    NDVI: nd(nir, red), NDRE: nd(nirRE, re), GNDVI: nd(nir, green), NDWI: nd(nirSW, swir),
    SAVI: (1 + L) * (nir - red) / (nir + red + L),
    EVI: 2.5 * (nir - red) / (nir + 6 * red - 7.5 * blue + 1),
    used: Object.fromEntries(Object.entries(INDEX_INFO).map(([k, inf]) => [k, inf.needs.map(n => U[n]).filter(Boolean)]))
  };
}
/** Red-edge inflection wavelength (nm): maximum first derivative of a spectrum between 680 and 760 nm (parabolic refinement). */
export function redEdgePosition(spec) {
  let best = -Infinity, bi = -1;
  for (let i = 1; i < NWL - 1; i++) { const l = WL[i]; if (l < 680 || l > 760) continue; const d = (spec[i + 1] - spec[i - 1]) / (2 * WL_STEP); if (d > best) { best = d; bi = i; } }
  if (bi < 2) return NaN;
  const d = k => (spec[k + 1] - spec[k - 1]) / (2 * WL_STEP);
  const y0 = d(bi - 1), y1 = d(bi), y2 = d(bi + 1), den = y0 - 2 * y1 + y2;
  return WL[bi] + (den !== 0 ? 0.5 * (y0 - y2) / den : 0) * WL_STEP;
}
/** Index of the grid wavelength nearest to λ. */
export const wlIndex = nm => Math.max(0, Math.min(NWL - 1, Math.round((nm - WL0) / WL_STEP)));

/* ------------------------------------------------------------------ reference surfaces */
export const SURFACES = {
  healthy: { label: 'Healthy crop canopy', color: '#2f9e44' },
  stressed: { label: 'N- and water-stressed canopy', color: '#b8a01c' },
  senescent: { label: 'Senescent (ripe) canopy', color: '#b0652c' },
  soilDry: { label: 'Dry soil', color: '#9c6b3f' },
  soilWet: { label: 'Wet soil', color: '#5b3a22' },
  water: { label: 'Water', color: '#2a7ab8' },
  snow: { label: 'Snow', color: '#7f93b8' }
};
/** Fixed leaf traits of the stressed and senescent reference canopies (documented in the Explain tab). */
export const LEAF_STRESSED = { N: 1.6, cab: 18, car: 7, ant: 0, brown: 0.05, cw: 0.009, cm: 0.005 };
export const LEAF_SENESCENT = { N: 2.0, cab: 4, car: 3, ant: 0, brown: 0.9, cw: 0.003, cm: 0.007 };
