/* ==========================================================================
   LED spectrum mixer — spectral radiometry, phytochrome and colorimetry model
   + physically based 2-D "grow tent" renderer.

   Model (see the Derive tab, Eqs. S1–S12):
   · each LED channel: electrical power P, package wall-plug efficiency η_wp,
     fixture efficiency η_fix, normalised emission shape s(λ)            (S1)
   · photons: q(λ) = Φe(λ)·λ/(h c N_A)                                  (S2)
   · PPF/ePAR/YPF band integrals, PPFD = f_cap·PPF/A, DLI               (S3–S5)
   · colour fractions (ANSI/ASABE S640 bands) and R:FR (Smith 1982)     (S6)
   · phytochrome photostationary state (Sager et al. 1988 method) with
     photoconversion cross-sections of Lagarias et al. (1987), as
     compiled by Kusuma & Bugbee (2021)                                  (S7)
   · illuminance via V(λ); CIE 1931 XYZ via the Wyman, Sloan & Shirley
     (2013) multi-lobe fit; sRGB (IEC 61966-2-1); CCT/Duv from the
     Planckian locus in CIE 1960 (u,v)                                   (S8–S10)
   · sunlight: Planck 5778 K × fitted atmospheric attenuation, validated
     against ASTM G173-03 global tilt (Gueymard et al. 2002)             (S11)
   · an explicitly illustrative morphology index (PSS, blue fraction)   (S12)
   ========================================================================== */
import { Controls, Readouts, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, BarChart, downloadCSV } from '/assets/js/plot.js';
import { palette, isDark, withAlpha, wavelengthToRGB } from '/assets/js/colors.js';
import { umolPerJoule, mcCree, planck } from '/assets/js/physics.js';

/* ------------------------------------------------------------------ grid */
const L0 = 300, L1 = 800, NW = L1 - L0 + 1;            // 1-nm grid, 300–800 nm
const WL = Float64Array.from({ length: NW }, (_, i) => L0 + i);
const UPJ = WL.map(umolPerJoule);                       // µmol J⁻¹ at each λ
const idx = nm => Math.round(nm - L0);

/* ------------------------------------------------------------------ published data (5-nm steps, 300–800 nm) */
// Phytochrome photoconversion cross-sections σR (Pr→Pfr) and σFR (Pfr→Pr), m² mol⁻¹.
// Lagarias et al. (1987), oat phytochrome, as tabulated at 1 nm in the supplementary data of Kusuma & Bugbee (2021); sampled here every 5 nm.
const SIG_R = [1228.9, 903.6, 795.2, 688.1, 586.8, 534.5, 523.5, 552.4, 619.9, 719.6, 848.8, 995.0, 1130.1, 1203.2, 1243.4, 1272.6, 1301.2, 1274.5, 1159.3, 972.9, 768.6, 528.3, 427.4, 356.1, 302.2, 267.9, 243.6, 220.0, 195.3, 177.1, 159.2, 143.9, 130.3, 121.2, 113.3, 102.2, 93.9, 90.0, 83.7, 81.4, 82.4, 86.9, 92.2, 100.1, 108.6, 116.1, 133.4, 153.0, 176.9, 213.6, 253.1, 297.0, 342.3, 393.2, 454.4, 528.6, 625.4, 743.2, 889.4, 1060.9, 1251.7, 1433.0, 1581.9, 1673.7, 1740.4, 1831.1, 1980.7, 2212.1, 2509.6, 2871.1, 3281.5, 3761.7, 4209.1, 4573.9, 4679.1, 4350.8, 3601.5, 2592.3, 1641.9, 953.4, 521.5, 280.8, 162.6, 97.5, 68.9, 45.9, 36.3, 33.7, 24.5, 27.3, 21.6, 20.8, 19.3, 17.1, 16.3, 13.6, 10.3, 6.7, 3.4, 4.9, 0.3];
const SIG_FR = [547.9, 461.8, 445.4, 418.4, 373.2, 330.8, 295.7, 273.5, 264.5, 267.6, 279.4, 294.6, 315.1, 339.7, 364.8, 387.5, 415.9, 442.5, 468.2, 488.5, 504.1, 520.8, 515.1, 489.9, 447.9, 396.9, 344.2, 294.9, 252.8, 220.9, 194.5, 173.3, 157.1, 144.1, 134.4, 124.6, 118.0, 113.3, 109.2, 105.5, 103.0, 101.3, 100.5, 99.1, 97.0, 94.7, 95.7, 94.9, 94.6, 96.6, 99.3, 100.5, 102.8, 106.2, 111.9, 117.3, 125.4, 134.6, 145.5, 158.5, 172.6, 188.1, 205.5, 223.6, 244.8, 269.4, 298.2, 332.7, 370.5, 413.4, 459.7, 506.2, 553.4, 595.3, 631.3, 663.1, 693.0, 726.1, 766.8, 816.0, 876.2, 940.8, 1008.0, 1075.5, 1138.8, 1185.8, 1209.1, 1193.8, 1130.6, 1022.6, 880.0, 722.7, 571.0, 439.4, 331.5, 249.7, 188.9, 148.7, 119.5, 100.6, 86.4];
// ASTM G173-03 global tilt (37°) reference spectrum, W m⁻² nm⁻¹, 4.5-nm running mean sampled every 5 nm (Gueymard et al. 2002; data via NREL / pvlib).
const G173 = [0.0013, 0.0156, 0.06, 0.1295, 0.2137, 0.3121, 0.4189, 0.4205, 0.4733, 0.4699, 0.5108, 0.5601, 0.5102, 0.6554, 0.6994, 0.6197, 0.7324, 0.5838, 0.7581, 0.6046, 1.0924, 1.1448, 1.167, 1.2208, 1.2115, 1.2149, 1.0318, 1.2697, 1.299, 1.4184, 1.5497, 1.531, 1.5583, 1.5516, 1.5533, 1.5756, 1.6139, 1.4854, 1.5344, 1.5905, 1.5287, 1.5532, 1.5701, 1.4779, 1.4913, 1.5151, 1.585, 1.5332, 1.5081, 1.5462, 1.5413, 1.5384, 1.4986, 1.505, 1.482, 1.4937, 1.4953, 1.5288, 1.4051, 1.4568, 1.4592, 1.4849, 1.4737, 1.4388, 1.4661, 1.4132, 1.3922, 1.438, 1.4477, 1.4364, 1.3873, 1.3229, 1.3908, 1.4076, 1.4189, 1.4048, 1.397, 1.3013, 1.1856, 1.2749, 1.2844, 1.307, 1.3114, 1.2516, 1.0439, 1.0771, 1.0868, 1.2132, 1.2125, 1.2474, 1.2341, 1.2311, 0.6783, 0.6788, 1.1502, 1.177, 1.1675, 1.1558, 1.1093, 1.0886, 1.0879];
const interp5 = (arr, nm) => { const x = (nm - 300) / 5; if (x <= 0) return arr[0]; if (x >= arr.length - 1) return arr[arr.length - 1]; const i = Math.floor(x), t = x - i; return arr[i] * (1 - t) + arr[i + 1] * t; };
const SR = WL.map(l => interp5(SIG_R, l)), SF = WL.map(l => interp5(SIG_FR, l));

/* ------------------------------------------------------------------ CIE 1931 colour-matching functions (Wyman, Sloan & Shirley 2013, multi-lobe fit) */
const g2 = (x, mu, a, b) => { const t = (x - mu) * (x < mu ? a : b); return Math.exp(-0.5 * t * t); };
const xbar = l => 0.362 * g2(l, 442.0, 0.0624, 0.0374) + 1.056 * g2(l, 599.8, 0.0264, 0.0323) - 0.065 * g2(l, 501.1, 0.0490, 0.0382);
const ybar = l => 0.821 * g2(l, 568.8, 0.0213, 0.0247) + 0.286 * g2(l, 530.9, 0.0613, 0.0322);
const zbar = l => 1.217 * g2(l, 437.0, 0.0845, 0.0278) + 0.681 * g2(l, 459.0, 0.0385, 0.0725);
const vis = l => l >= 360 && l <= 830;
const XB = WL.map(l => vis(l) ? xbar(l) : 0), YB = WL.map(l => vis(l) ? ybar(l) : 0), ZB = WL.map(l => vis(l) ? zbar(l) : 0);
const RQE = WL.map(mcCree);
const KM = 683; // lm W⁻¹, maximum luminous efficacy (555 nm)

function toXYZ(E, refl) { let X = 0, Y = 0, Z = 0; for (let i = 0; i < NW; i++) { const e = refl ? E[i] * refl[i] : E[i]; X += e * XB[i]; Y += e * YB[i]; Z += e * ZB[i]; } return [X, Y, Z]; }
const lin2srgb = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
function xyzToLinRGB([X, Y, Z]) { return [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.2040 * Y + 1.0570 * Z]; }
/** Chromaticity → displayable colour at full brightness (out-of-gamut colours desaturated towards white). */
function chromaColor(X, Y, Z) {
  let [r, g, b] = xyzToLinRGB([X, Y, Z]); const mn = Math.min(r, g, b); if (mn < 0) { r -= mn; g -= mn; b -= mn; }
  const mx = Math.max(r, g, b) || 1; return [r / mx, g / mx, b / mx];
}
const cssRGB = (lin, k = 1, a = 1) => { const c = lin.map(v => Math.round(255 * lin2srgb(Math.max(0, Math.min(1, v * k))))); return a < 1 ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : `rgb(${c[0]},${c[1]},${c[2]})`; };

/* Planckian locus in CIE 1960 (u, v) for CCT and Duv, computed with the same CMFs so the method is self-consistent */
const LOCUS = [];
for (let k = 0; k <= 480; k++) {
  const T = 1000 * Math.pow(30, k / 480); const E = WL.map(l => planck(l, T));
  const [X, Y, Z] = toXYZ(E); const d = X + 15 * Y + 3 * Z; const s = X + Y + Z;
  LOCUS.push({ T, u: 4 * X / d, v: 6 * Y / d, x: X / s, y: Y / s });
}
function cctDuv([X, Y, Z]) {
  const d = X + 15 * Y + 3 * Z; if (!(d > 0)) return null;
  const u = 4 * X / d, v = 6 * Y / d; let bi = 0, bd = Infinity;
  LOCUS.forEach((p, i) => { const dd = Math.hypot(p.u - u, p.v - v); if (dd < bd) { bd = dd; bi = i; } });
  // parabolic refinement of the distance minimum
  let T = LOCUS[bi].T;
  if (bi > 0 && bi < LOCUS.length - 1) {
    const f = i => Math.hypot(LOCUS[i].u - u, LOCUS[i].v - v); const a = f(bi - 1), b = f(bi), c = f(bi + 1); const den = a - 2 * b + c;
    if (den > 0) { const off = 0.5 * (a - c) / den; T = Math.exp(Math.log(LOCUS[bi].T) + off * Math.log(LOCUS[bi + 1].T / LOCUS[bi].T)); }
  }
  const sign = v > LOCUS[bi].v ? 1 : -1;
  return { T, duv: sign * bd, u, v, edge: bi === 0 || bi === LOCUS.length - 1 };
}

/* ------------------------------------------------------------------ emission shapes */
const gauss = (l, p, w) => Math.exp(-4 * Math.LN2 * ((l - p) / w) ** 2);                // FWHM w
const splitG = (l, mu, wl, wr) => { const s = (l < mu ? wl : wr) / 2.3548; return Math.exp(-0.5 * ((l - mu) / s) ** 2); };
// Phosphor-converted whites: blue InGaN pump + broad phosphor bands (shapes tuned so that the computed CCT, Duv and blue-photon fraction match the stated class — see Derive S1).
const WHITE = {
  cool: l => 1.23 * splitG(l, 450, 19, 24) + 0.535 * splitG(l, 544, 93.5, 132) + 0.142 * splitG(l, 608, 55.7, 81.2),
  warm: l => 0.624 * splitG(l, 450, 19, 24) + 0.701 * splitG(l, 560, 88, 120) + 0.75 * splitG(l, 615, 72.8, 102)
};
const CH = [
  { id: 'uv', label: 'UV-A 385 nm', short: 'UV-A', peak: 385, fwhm: 12, wpe: 0.45, dot: '#8b5cf6', note: 'EQE ≈ 50 % (Amano et al. 2020) → η_wp ≈ 0.45' },
  { id: 'blue', label: 'Royal blue 450 nm', short: 'Blue', peak: 450, fwhm: 20, wpe: 0.93, dot: '#2f55ff', note: 'Kusuma et al. 2020, Table 1' },
  { id: 'green', label: 'Green 530 nm', short: 'Green', peak: 530, fwhm: 32, wpe: 0.42, dot: '#20c060', note: '“green gap” — Kusuma et al. 2020' },
  { id: 'red', label: 'Deep red 660 nm', short: 'Red', peak: 660, fwhm: 20, wpe: 0.81, dot: '#e0203a', note: 'Kusuma et al. 2020, Table 1' },
  { id: 'fr', label: 'Far-red 730 nm', short: 'Far-red', peak: 730, fwhm: 28, wpe: 0.77, dot: '#7a0a1c', note: 'Kusuma et al. 2020, Table 1' },
  { id: 'ww', label: 'Warm white 2700 K', short: 'Warm W', white: 'warm', wpe: 0.54, dot: '#ffc47a', note: 'set so the package gives ≈ 2.6 µmol J⁻¹ (Kusuma et al. 2020, Table 1)' },
  { id: 'cw', label: 'Cool white 6500 K', short: 'Cool W', white: 'cool', wpe: 0.65, dot: '#dfe9ff', note: 'set so the package gives ≈ 2.9 µmol J⁻¹ (Kusuma et al. 2020, Table 1)' }
];
CH.forEach(c => {
  const f = c.white ? WHITE[c.white] : l => gauss(l, c.peak, c.fwhm);
  const s = WL.map(f); const tot = s.reduce((a, b) => a + b, 0); c.S = s.map(v => v / tot); // ∫ s dλ = 1 (Δλ = 1 nm)
  // photons per joule of radiant energy for this shape, by band
  c.uPar = 0; c.uEpar = 0; c.uAll = 0; c.uY = 0;
  for (let i = 0; i < NW; i++) { const n = c.S[i] * UPJ[i]; c.uAll += n; if (WL[i] >= 400 && WL[i] <= 700) c.uPar += n; if (WL[i] >= 400 && WL[i] <= 750) c.uEpar += n; c.uY += n * RQE[i]; }
  const [X, Y, Z] = toXYZ(c.S); c.xy = [X / (X + Y + Z), Y / (X + Y + Z)]; c.lumEff = KM * Y; // lm per radiant W
  if (c.id === 'uv') c.xy = [0.1740, 0.0050];  // CIE 1931 tabulated chromaticity at 385 nm (the analytic fit is unreliable below ≈ 420 nm)
  c.glow = chromaColor(X, Y, Z);
});
const LUM_MAX = Math.max(...CH.map(c => c.lumEff));

/* ------------------------------------------------------------------ sunlight model (S11) */
// E(λ) ∝ B(λ, 5778 K)·exp[−m·a·(λ/µm)⁻⁴]·Π(1 − d_j·exp(−((λ−λj)/wj)²)); a, d_j fitted to ASTM G173 global (350–800 nm) with m = 1.5.
const SUN_P = { T: 5778, m: 1.5, a: 0.0079, bands: [[595, 40, 0.060], [687, 3, 0.192], [720, 12, 0.171], [760, 4, 0.556]] };
function sunShape(l) { let T = Math.exp(-SUN_P.m * SUN_P.a * Math.pow(l / 1000, -4)); SUN_P.bands.forEach(([c0, w, d]) => { T *= 1 - d * Math.exp(-(((l - c0) / w) ** 2)); }); return planck(l, SUN_P.T) * T; }
function normalisedToPPFD(E) { let n = 0; for (let i = 0; i < NW; i++) if (WL[i] >= 400 && WL[i] <= 700) n += E[i] * UPJ[i] * ((WL[i] === 400 || WL[i] === 700) ? 0.5 : 1); return E.map(e => e / n); }
const SUN_E1 = normalisedToPPFD(WL.map(sunShape));          // W m⁻² nm⁻¹ per (µmol m⁻² s⁻¹ PPFD)
const G173_E1 = normalisedToPPFD(WL.map(l => interp5(G173, l)));

/* ------------------------------------------------------------------ surface reflectances for the colour-accurate preview (illustrative spectral shapes) */
const REFL = {
  mylar: WL.map(() => 0.9),
  leaf: WL.map(l => Math.max(0.02, 0.05 + 0.08 * Math.exp(-(((l - 552) / 34) ** 2)) - 0.02 * Math.exp(-(((l - 675) / 18) ** 2)) + 0.45 / (1 + Math.exp(-(l - 716) / 11)))),
  leafTop: WL.map(l => Math.max(0.02, 0.04 + 0.075 * Math.exp(-(((l - 552) / 32) ** 2)) - 0.02 * Math.exp(-(((l - 675) / 18) ** 2)) + 0.42 / (1 + Math.exp(-(l - 716) / 11)))),
  stem: WL.map(l => 0.06 + 0.13 * Math.exp(-(((l - 565) / 45) ** 2)) + 0.4 / (1 + Math.exp(-(l - 712) / 12))),
  soil: WL.map(l => 0.05 + 0.14 * Math.max(0, (l - 400) / 400)),
  pot: WL.map(() => 0.05),
  metal: WL.map(() => 0.45),
  strap: WL.map(l => 0.06 + 0.02 * Math.max(0, (l - 400) / 400))
};

/* ------------------------------------------------------------------ the model */
function band(q, a, b) { let s = 0; for (let i = idx(a); i <= idx(b); i++) s += q[i] * ((i === idx(a) || i === idx(b)) ? 0.5 : 1); return s; }
function morphology(pss, blue) {
  // Illustrative index (S12): direction of well-documented responses, NOT a calibrated crop model.
  const b = Math.min(0.4, Math.max(0, blue));
  const fP = 1 + 2.0 * (0.83 - pss);              // shade-avoidance: elongation rises as PSS falls (Morgan & Smith 1976)
  const fB = 1 + 1.5 * (0.15 - b);                // blue photons suppress extension growth (Cope & Bugbee 2013; Snowden et al. 2016)
  const stem = Math.min(1.9, Math.max(0.55, fP * fB));
  const leaf = Math.min(1.6, Math.max(0.6, (1 + 1.2 * (0.83 - pss)) * (1 - 0.6 * (b - 0.15))));
  const hyponasty = Math.min(1, Math.max(0, (0.80 - pss) / 0.25));
  return { stem, leaf, hyponasty };
}
function compute(p) {
  const etaFix = p.etaFix, fcap = p.fcap, A = p.area;
  const q = new Float64Array(NW);                          // µmol m⁻² s⁻¹ nm⁻¹ at the canopy
  const qc = CH.map(() => new Float64Array(NW));
  let Pel = 0, Prad = 0, PPF = 0, EPF = 0, YPF = 0, PFall = 0;
  const ch = CH.map((c, k) => {
    const P = p['p_' + c.id], wpe = p['w_' + c.id];
    const rad = P * wpe * etaFix;                          // W radiant (S1)
    Pel += P; Prad += rad;
    for (let i = 0; i < NW; i++) { const n = rad * c.S[i] * UPJ[i]; qc[k][i] = n * fcap / A; q[i] += qc[k][i]; }
    const ppf = rad * c.uPar, epf = rad * c.uEpar;
    PPF += ppf; EPF += epf; YPF += rad * c.uY; PFall += rad * c.uAll;
    return { id: c.id, P, rad, ppf, epf, effPar: wpe * etaFix * c.uPar, effEpar: wpe * etaFix * c.uEpar };
  });
  const qs = new Float64Array(NW);
  if (p.sun > 0) for (let i = 0; i < NW; i++) { qs[i] = p.sun * SUN_E1[i] * UPJ[i]; q[i] += qs[i]; }
  const E = q.map((v, i) => v / UPJ[i]);                  // W m⁻² nm⁻¹
  const ppfd = band(q, 400, 700), epfd = band(q, 400, 750);
  let ypfd = 0, sr = 0, sf = 0, total = 0; for (let i = 0; i < NW; i++) { ypfd += q[i] * RQE[i]; sr += q[i] * SR[i]; sf += q[i] * SF[i]; total += q[i]; }
  const uv = band(q, 300, 400), B = band(q, 400, 500), G = band(q, 500, 600), R = band(q, 600, 700), FR = band(q, 700, 750), FR8 = band(q, 700, 800);
  const rfr = band(q, 655, 665) / band(q, 725, 735);
  const pss = sr + sf > 0 ? sr / (sr + sf) : NaN;
  const XYZ = toXYZ(E); const lux = KM * XYZ[1];
  const cc = cctDuv(XYZ);
  const sXYZ = XYZ[0] + XYZ[1] + XYZ[2];
  const xy = sXYZ > 0 ? [XYZ[0] / sXYZ, XYZ[1] / sXYZ] : null;
  const blueFrac = ppfd > 0 ? B / ppfd : 0;
  return {
    q, qc, qs, E, ch, Pel, Prad, PPF, EPF, YPF, PFall, ppfd, epfd, ypfd, uv, B, G, R, FR, FR8, total, rfr, pss, XYZ, lux, cc, xy,
    blueFrac, eff: Pel > 0 ? PPF / Pel : NaN, effE: Pel > 0 ? EPF / Pel : NaN, radEff: Pel > 0 ? Prad / Pel : NaN,
    dli: ppfd * p.photo * 3600 / 1e6, edli: epfd * p.photo * 3600 / 1e6, morph: morphology(pss, blueFrac), A, fcap
  };
}

/* ------------------------------------------------------------------ colour naming */
function colourName(R) {
  if (!R.xy || R.lux < 1e-3) return 'invisible (UV/far-red only)';
  const cc = R.cc; const [r, g, b] = chromaColor(...R.XYZ);
  const white = cc && !cc.edge ? (cc.T < 3300 ? 'warm white' : cc.T < 4600 ? 'neutral white' : cc.T < 7500 ? 'cool white' : 'bluish white') : null;
  if (white && Math.abs(cc.duv) < 0.012) return white;
  if (white && Math.abs(cc.duv) < 0.03) return white + (cc.duv < 0 ? ', pink tint' : ', green tint');
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let hdeg = 0;
  if (d > 1e-6) { if (mx === r) hdeg = 60 * (((g - b) / d) % 6); else if (mx === g) hdeg = 60 * ((b - r) / d + 2); else hdeg = 60 * ((r - g) / d + 4); }
  if (hdeg < 0) hdeg += 360; const sat = d / (mx || 1);
  const tint = sat < 0.35 ? 'pale ' : '';
  if (sat < 0.6 && (hdeg < 15 || hdeg > 330)) return 'salmon pink';
  const name = hdeg < 15 ? 'red' : hdeg < 40 ? 'orange' : hdeg < 70 ? 'yellow' : hdeg < 160 ? 'green' : hdeg < 200 ? 'cyan' : hdeg < 250 ? 'blue' : hdeg < 285 ? 'violet' : hdeg < 330 ? 'magenta (“blurple”)' : 'pink';
  return tint + name;
}

/* ------------------------------------------------------------------ UI */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'ppfd', label: 'PPFD at canopy (400–700 nm)', unit: 'µmol m⁻² s⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'epfd', label: 'ePAR photon flux (400–750 nm)', unit: 'µmol m⁻² s⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'ypfd', label: 'Yield photon flux (McCree-weighted)', unit: 'µmol m⁻² s⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'dli', label: 'Daily light integral', unit: 'mol m⁻² d⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'eff', label: 'Photon efficacy (PPF / W)', unit: 'µmol J⁻¹', digits: 2, note: '&nbsp;' })
  .add({ id: 'rad', label: 'Radiant efficiency · heat', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'bgr', label: 'Blue · green · red share of PPFD', unit: '%', format: v => v, note: '&nbsp;' })
  .add({ id: 'frf', label: 'Far-red share of ePAR (700–750)', unit: '%', digits: 1, note: '&nbsp;' })
  .add({ id: 'rfr', label: 'R:FR ratio (660/730 ± 5 nm)', unit: '', digits: 2, note: '&nbsp;' })
  .add({ id: 'pss', label: 'Phytochrome PSS (Pfr / Ptotal)', unit: '', digits: 3, note: '&nbsp;' })
  .add({ id: 'lux', label: 'Illuminance', unit: 'lx', digits: 0, note: '&nbsp;' })
  .add({ id: 'cct', label: 'Perceived colour · CCT', unit: '', format: v => v, note: '&nbsp;' });

const dotLab = (c, txt) => `<span style="display:inline-flex;align-items:center;gap:7px"><i style="width:10px;height:10px;border-radius:50%;background:${c.dot};box-shadow:0 0 0 1px rgba(0,0,0,.25), 0 0 8px ${c.dot}"></i>${txt}</span>`;
ui.section('LED channels — electrical power');
CH.forEach(c => ui.slider({ id: 'p_' + c.id, label: dotLab(c, c.label), min: 0, max: 300, step: 1, value: 0, unit: 'W' }));
ui.section('Daylight (optional)');
ui.slider({ id: 'sun', label: 'Sunlight at the canopy', min: 0, max: 2000, step: 10, value: 0, unit: 'µmol m⁻² s⁻¹', help: 'Modelled clear-sky sunlight (Planck 5778 K × atmosphere). Not a lamp: excluded from efficacy and electricity.' });
ui.section('Fixture & grow area');
ui.slider({ id: 'etaFix', label: 'Fixture efficiency η<sub>fix</sub>', min: 0.5, max: 1, step: 0.01, value: 0.8, help: 'Driver × optics × thermal & current droop. Kusuma et al. (2020): typical 0.67, near-optimal 0.93.' });
ui.slider({ id: 'area', label: 'Grow area A', min: 0.25, max: 4, step: 0.01, value: 1.44, unit: 'm²', help: '1.44 m² = a 1.2 × 1.2 m grow tent' });
ui.slider({ id: 'fcap', label: 'Photon capture f<sub>cap</sub>', min: 0.5, max: 1, step: 0.01, value: 0.9, help: 'Share of emitted photons that reach the canopy (reflective walls ≈ 0.85–0.95)' });
ui.slider({ id: 'photo', label: 'Photoperiod', min: 6, max: 24, step: 0.5, value: 16, unit: 'h d⁻¹' });
ui.section('Package wall-plug efficiency η<sub>wp</sub>');
CH.forEach(c => ui.slider({ id: 'w_' + c.id, label: dotLab(c, c.short), min: 0.1, max: 0.95, step: 0.01, value: c.wpe, help: c.note }));
ui.section('Display');
ui.segmented({ id: 'yunit', label: 'Spectrum units', options: [{ value: 'photon', label: 'Photons' }, { value: 'energy', label: 'Energy' }], value: 'photon' });
ui.toggle({ id: 'showCh', label: 'Show individual channels', value: true });
ui.toggle({ id: 'showRqe', label: 'Show McCree RQE (right axis)', value: true });
ui.toggle({ id: 'showPhy', label: 'Show phytochrome σR, σFR', value: false });
const zero = Object.fromEntries(CH.map(c => ['p_' + c.id, 0]));
const PRESETS = [
  { label: '“Blurple” red + blue', values: { ...zero, p_red: 280, p_blue: 70, sun: 0 } },
  { label: 'Broad white', values: { ...zero, p_ww: 180, p_cw: 170, sun: 0 } },
  { label: 'White + deep red', values: { ...zero, p_ww: 110, p_cw: 90, p_red: 150, sun: 0 } },
  { label: 'White + far-red', values: { ...zero, p_ww: 120, p_cw: 80, p_red: 100, p_fr: 60, sun: 0 } },
  { label: 'Sunlight (5778 K model)', values: { ...zero, sun: 1500 } },
  { label: 'Greenhouse top-up', values: { ...zero, p_red: 120, p_blue: 20, sun: 350 } },
  { label: 'UV-A + blue accent', values: { ...zero, p_ww: 150, p_cw: 60, p_red: 90, p_uv: 25, p_blue: 25, sun: 0 } }
];
ui.presets(PRESETS.map(pr => ({ label: pr.label, values: pr.values })));
ui.buttons([{ label: 'Download spectrum (CSV)', onClick: () => exportCSV() }]);
ui.saveButton('spectrum-mixer', () => ro.values());
// first visit without URL state → start from the "White + deep red" preset
if (!location.search) ui.setMany(PRESETS[2].values);

/* ------------------------------------------------------------------ stage: grow-tent renderer */
const stageEl = document.getElementById('stage');
const tent = document.createElement('canvas'); tent.setAttribute('aria-label', 'Rendered grow tent lit by the current spectrum'); tent.setAttribute('role', 'img');
stageEl.appendChild(tent);
const hud = hudChips(stageEl);
const legend = document.createElement('div'); legend.className = 'stage-legend'; stageEl.appendChild(legend);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.download = 'spectrum-mixer.png'; a.href = tent.toDataURL('image/png'); a.click(); } });

function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function poly(ctx, pts) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); }
const lerp = (a, b, t) => a + (b - a) * t;

function materialColours(R) {
  // Colour of each surface = ∫ E(λ)·ρ(λ)·CMF dλ → XYZ → linear sRGB, with an exposure that follows illuminance (camera with fixed daylight white balance).
  const Ym = toXYZ(R.E, REFL.mylar)[1];
  const expo = 0.16 + 0.78 * (1 - Math.exp(-R.lux / 18000));
  const k = Ym > 1e-9 ? expo / Ym : 0;
  const out = {};
  for (const [name, rf] of Object.entries(REFL)) {
    const [r, g, b] = xyzToLinRGB(toXYZ(R.E, rf).map(v => v * k));
    let c = [Math.max(0, r), Math.max(0, g), Math.max(0, b)]; const mx = Math.max(...c); if (mx > 1) c = c.map(v => v / mx);
    out[name] = c;
  }
  out.light = R.lux > 1e-3 ? chromaColor(...R.XYZ) : [0, 0, 0];
  out.expo = expo; out.visible = R.lux > 1e-3;
  return out;
}

function drawLeaf(ctx, x, y, len, wid, ang, fill, top, vein) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * 0.25, -wid * 0.9, len * 0.75, -wid * 0.8, len, 0);
  ctx.bezierCurveTo(len * 0.75, wid * 0.75, len * 0.25, wid * 0.85, 0, 0);
  const gr = ctx.createLinearGradient(0, -wid, 0, wid); gr.addColorStop(0, top); gr.addColorStop(1, fill);
  ctx.fillStyle = gr; ctx.fill();
  ctx.strokeStyle = vein; ctx.lineWidth = Math.max(0.6, wid * 0.08); ctx.beginPath(); ctx.moveTo(len * 0.04, 0); ctx.quadraticCurveTo(len * 0.5, -wid * 0.08, len * 0.95, 0); ctx.stroke();
  ctx.lineWidth = Math.max(0.4, wid * 0.04);
  for (let k = 1; k < 5; k++) { const t = k / 5.2; ctx.beginPath(); ctx.moveTo(len * t, -wid * 0.04); ctx.lineTo(len * (t + 0.12), -wid * 0.55 * Math.sin(Math.PI * t)); ctx.moveTo(len * t, wid * 0.03); ctx.lineTo(len * (t + 0.12), wid * 0.5 * Math.sin(Math.PI * t)); ctx.stroke(); }
  ctx.restore();
}
function drawPlant(ctx, x, yb, s, M, C, seed) {
  const r = seeded(seed);
  // fabric pot
  const pw = 70 * s, ph = 52 * s;
  const potTop = yb - ph;
  poly(ctx, [[x - pw / 2, potTop], [x + pw / 2, potTop], [x + pw * 0.42, yb], [x - pw * 0.42, yb]]);
  const pg = ctx.createLinearGradient(x - pw / 2, 0, x + pw / 2, 0); pg.addColorStop(0, cssRGB(C.pot, 0.6)); pg.addColorStop(0.5, cssRGB(C.pot, 1.2)); pg.addColorStop(1, cssRGB(C.pot, 0.5));
  ctx.fillStyle = pg; ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x - pw / 2, potTop, pw, 4 * s);
  ctx.beginPath(); ctx.ellipse(x, potTop + 2 * s, pw / 2 - 2 * s, 7 * s, 0, 0, Math.PI * 2); ctx.fillStyle = cssRGB(C.soil, 0.8); ctx.fill();
  // stem
  const hStem = 150 * s * M.stem; const nodes = 5; const bend = (r() - 0.5) * 18 * s;
  const stemPt = t => [x + bend * Math.sin(Math.PI * t * 0.9) * t, potTop - hStem * t];
  ctx.strokeStyle = cssRGB(C.stem, 1.0); ctx.lineCap = 'round';
  ctx.lineWidth = 6 * s * (0.8 + 0.2 / M.stem);
  ctx.beginPath(); for (let k = 0; k <= 20; k++) { const [px, py] = stemPt(k / 20); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke();
  // leaves: opposite pairs, larger lower down; petiole length and leaf angle follow the index
  const leafFill = cssRGB(C.leaf, 0.85), leafTop = cssRGB(C.leafTop, 1.25), vein = cssRGB(C.stem, 1.3, 0.8);
  for (let k = 0; k < nodes; k++) {
    const t = 0.25 + 0.75 * k / (nodes - 1); const [nx, ny] = stemPt(t);
    const size = (1.15 - 0.45 * k / (nodes - 1)) * s * M.leaf;
    const pet = 22 * s * M.stem * (1 - 0.4 * k / nodes);
    [-1, 1].forEach(side => {
      const up = (0.25 + 0.55 * M.hyponasty) + (k % 2 ? 0.08 : 0) + (r() - 0.5) * 0.12;   // radians above horizontal
      const a = side > 0 ? -up : Math.PI + up;
      const ex = nx + Math.cos(a) * pet, ey = ny + Math.sin(a) * pet;
      ctx.strokeStyle = cssRGB(C.stem, 0.95); ctx.lineWidth = 2.4 * s; ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(ex, ey); ctx.stroke();
      drawLeaf(ctx, ex, ey, 62 * size, 27 * size, a + side * 0.12, leafFill, leafTop, vein);
    });
  }
  // apex
  const [ax, ay] = stemPt(1.0);
  drawLeaf(ctx, ax, ay, 26 * s * M.leaf, 11 * s * M.leaf, -Math.PI / 2 - 0.35, leafFill, leafTop, vein);
  drawLeaf(ctx, ax, ay, 24 * s * M.leaf, 10 * s * M.leaf, -Math.PI / 2 + 0.4, leafFill, leafTop, vein);
}

let lastR = null;
function renderTent(R) {
  const w = stageEl.clientWidth, h = stageEl.clientHeight; if (!w || !h) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (tent.width !== Math.round(w * dpr) || tent.height !== Math.round(h * dpr)) { tent.width = Math.round(w * dpr); tent.height = Math.round(h * dpr); }
  tent.style.width = '100%'; tent.style.height = '100%'; tent.style.display = 'block';
  const ctx = tent.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const C = materialColours(R);
  const bx0 = w * 0.25, bx1 = w * 0.75, by0 = h * 0.12, by1 = h * 0.63;
  ctx.fillStyle = '#050606'; ctx.fillRect(0, 0, w, h);
  const my = C.mylar;
  // ceiling (above the fixture: little light)
  poly(ctx, [[0, 0], [w, 0], [bx1, by0], [bx0, by0]]); ctx.fillStyle = cssRGB(my, 0.22); ctx.fill();
  // back wall with a soft hot-spot below the lamp
  poly(ctx, [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]]);
  let gr = ctx.createRadialGradient(w / 2, by0 + (by1 - by0) * 0.55, 10, w / 2, by0 + (by1 - by0) * 0.55, (bx1 - bx0) * 0.75);
  gr.addColorStop(0, cssRGB(my, 0.95)); gr.addColorStop(1, cssRGB(my, 0.5)); ctx.fillStyle = gr; ctx.fill();
  // side walls
  [[[0, 0], [bx0, by0], [bx0, by1], [0, h]], [[w, 0], [bx1, by0], [bx1, by1], [w, h]]].forEach((pts, side) => {
    poly(ctx, pts);
    const g = ctx.createLinearGradient(side ? w : 0, 0, side ? bx1 : bx0, 0); g.addColorStop(0, cssRGB(my, 0.3)); g.addColorStop(1, cssRGB(my, 0.72));
    ctx.fillStyle = g; ctx.fill();
  });
  // floor with light pool
  poly(ctx, [[0, h], [w, h], [bx1, by1], [bx0, by1]]);
  gr = ctx.createRadialGradient(w / 2, h * 0.82, 20, w / 2, h * 0.82, w * 0.55); gr.addColorStop(0, cssRGB(my, 1.0)); gr.addColorStop(1, cssRGB(my, 0.38)); ctx.fillStyle = gr; ctx.fill();
  // mylar crinkles (seeded, perspective-correct streaks)
  const rr = seeded(7);
  ctx.save(); ctx.globalCompositeOperation = 'soft-light';
  for (let i = 0; i < 70; i++) {
    const t = rr(); const side = i % 3; ctx.lineWidth = 1 + rr() * 4; ctx.strokeStyle = rr() > 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    if (side === 0) { const x = lerp(bx0, bx1, t); ctx.moveTo(x, by0); ctx.lineTo(x + (rr() - 0.5) * 8, by1); }
    else if (side === 1) { ctx.moveTo(lerp(0, bx0, t), lerp(0, by0, t)); ctx.lineTo(lerp(0, bx0, t), lerp(h, by1, t)); }
    else { ctx.moveTo(lerp(w, bx1, t), lerp(0, by0, t)); ctx.lineTo(lerp(w, bx1, t), lerp(h, by1, t)); }
    ctx.stroke();
  }
  ctx.restore();
  // frame poles at the corners
  ctx.strokeStyle = 'rgba(20,22,24,0.85)'; ctx.lineWidth = 3;
  [[[0, 0], [bx0, by0]], [[w, 0], [bx1, by0]], [[0, h], [bx0, by1]], [[w, h], [bx1, by1]]].forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); });
  ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);

  // fixture (board in perspective) hanging on straps
  const fy = h * 0.2, fw = w * 0.34, fx0 = w / 2 - fw / 2, fx1 = w / 2 + fw / 2, fth = h * 0.028, fdep = h * 0.05;
  ctx.strokeStyle = cssRGB(C.strap, 1.4); ctx.lineWidth = 2;
  [[fx0 + fw * 0.12, fy - fdep * 0.5], [fx1 - fw * 0.12, fy - fdep * 0.5]].forEach(([sx, sy]) => { ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(lerp(sx, w / 2, 0.3), by0 * 0.4); ctx.stroke(); });
  // top face
  poly(ctx, [[fx0 + fw * 0.05, fy - fdep], [fx1 - fw * 0.05, fy - fdep], [fx1, fy], [fx0, fy]]);
  ctx.fillStyle = cssRGB(C.metal, 0.9); ctx.fill();
  // heat-sink fins
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
  for (let k = 1; k < 22; k++) { const t = k / 22; ctx.beginPath(); ctx.moveTo(lerp(fx0 + fw * 0.05, fx1 - fw * 0.05, t), fy - fdep); ctx.lineTo(lerp(fx0, fx1, t), fy); ctx.stroke(); }
  // front edge
  ctx.fillStyle = '#1b1e22'; ctx.fillRect(fx0, fy, fw, fth);
  // diodes on the underside edge: channels in proportion to electrical power
  const nD = 36, totP = R.Pel;
  const list = [];
  if (totP > 0) {
    const raw = R.ch.map((c, k) => ({ k, n: c.P / totP * nD })); raw.forEach(o => { o.i = Math.floor(o.n); if (R.ch[o.k].P > 0 && o.i === 0) o.i = 1; });
    let left = nD - raw.reduce((a, o) => a + o.i, 0); raw.slice().sort((a, b) => (b.n - Math.floor(b.n)) - (a.n - Math.floor(a.n))).forEach(o => { if (left > 0 && R.ch[o.k].P > 0) { o.i++; left--; } });
    raw.forEach(o => { for (let j = 0; j < o.i; j++) list.push(o.k); });
    const rs = seeded(3); for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rs() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  }
  const glowCtx = ctx; glowCtx.save(); glowCtx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < nD; i++) {
    const x = fx0 + fw * (i + 0.5) / nD, y = fy + fth * 0.62;
    const k = list[i];
    if (k == null) { ctx.fillStyle = '#333'; ctx.fillRect(x - 2, y - 1.5, 4, 3); continue; }
    const c = CH[k]; const vis = Math.max(0.06, Math.sqrt(c.lumEff / LUM_MAX));
    const col = c.glow.map(v => v * vis);
    const g = glowCtx.createRadialGradient(x, y, 0, x, y, 9); g.addColorStop(0, cssRGB(col.map(v => Math.min(1, v * 1.6)), 1)); g.addColorStop(0.35, cssRGB(col, 1, 0.6)); g.addColorStop(1, cssRGB(col, 1, 0));
    glowCtx.fillStyle = g; glowCtx.fillRect(x - 9, y - 9, 18, 18);
    glowCtx.fillStyle = cssRGB(col.map(v => Math.min(1, v * 0.3 + 0.7 * vis)), 1); glowCtx.fillRect(x - 2, y - 1.5, 4, 3);
  }
  // light cone & bloom in the perceived colour, brightness ∝ exposure
  if (C.visible) {
    const cone = ctx.createLinearGradient(0, fy, 0, h * 0.95);
    cone.addColorStop(0, cssRGB(C.light, 1, 0.20 * C.expo)); cone.addColorStop(1, cssRGB(C.light, 1, 0));
    poly(ctx, [[fx0, fy + fth], [fx1, fy + fth], [w * 0.9, h], [w * 0.1, h]]); ctx.fillStyle = cone; ctx.fill();
    const bl = ctx.createRadialGradient(w / 2, fy + fth, 4, w / 2, fy + fth, fw * 0.8);
    bl.addColorStop(0, cssRGB(C.light, 1, 0.55 * C.expo)); bl.addColorStop(1, cssRGB(C.light, 1, 0)); ctx.fillStyle = bl; ctx.fillRect(0, 0, w, h * 0.6);
  }
  glowCtx.restore();
  // sunlight streaming in (if daylight is on): bright patch through a roof window
  if (R.qs && p0().sun > 0) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const sunC = chromaColor(...toXYZ(R.qs.map((v, i) => v / UPJ[i])));
    const sg = ctx.createLinearGradient(w * 0.15, 0, w * 0.5, h); sg.addColorStop(0, cssRGB(sunC, 1, 0.22 * C.expo)); sg.addColorStop(1, cssRGB(sunC, 1, 0));
    poly(ctx, [[w * 0.1, 0], [w * 0.3, 0], [w * 0.62, h], [w * 0.28, h]]); ctx.fillStyle = sg; ctx.fill();
    ctx.restore();
  }
  // plants (back to front)
  const M = R.morph; const sc = Math.min(w / 900, h / 560);
  [[w * 0.3, h * 0.8, 0.8 * sc, 11], [w * 0.7, h * 0.8, 0.8 * sc, 29], [w * 0.5, h * 0.93, 0.98 * sc, 5]].forEach(([x, y, s, sd]) => drawPlant(ctx, x, y, s, M, C, sd));
  // vignette
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  if (!C.visible) {
    ctx.fillStyle = 'rgba(230,238,233,0.85)'; ctx.font = '600 15px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(R.total > 0 ? 'The light is (almost) invisible to the human eye — only UV-A and/or far-red photons' : 'No light — raise the power of an LED channel or add daylight', w / 2, h * 0.45);
  }
}
let _p = null; const p0 = () => _p;

/* ------------------------------------------------------------------ charts */
const specPlot = new Plot('#chart-spectrum', { x: { label: 'Wavelength', unit: 'nm', min: 300, max: 800 }, y: { label: 'Spectral photon flux density', unit: 'µmol m⁻² s⁻¹ nm⁻¹', min: 0 }, y2: { label: 'Relative response', unit: '', min: 0, max: 1.05 } });
const cieEl = document.getElementById('chart-cie');
const ciePlot = new Plot(cieEl, { x: { label: 'CIE x', unit: '', min: -0.02, max: 0.8 }, y: { label: 'CIE y', unit: '', min: 0, max: 0.9 }, legend: false, crosshair: false });
const pssPlot = new Plot('#chart-pss', { x: { label: 'R:FR ratio (660/730 ± 5 nm)', unit: '', min: 0.05, max: 30, log: true }, y: { label: 'PSS (Pfr / Ptotal)', unit: '', min: 0, max: 0.9 } });
const morphPlot = new Plot('#chart-morph', { x: { label: 'Phytochrome PSS', unit: '', min: 0.45, max: 0.9 }, y: { label: 'Blue share of PPFD', unit: '%', min: 0, max: 50 }, legend: false, crosshair: false });
const effChart = new BarChart('#chart-eff', { y: { label: 'Photon efficacy', unit: 'µmol J⁻¹', min: 0 }, legend: true });
const compEl = document.getElementById('chart-comp');

/* CIE diagram background (computed once): spectral locus + filled chromaticity region */
// Spectral locus: the analytic fit is used between 430 and 645 nm, where its chromaticities are accurate; the nearly
// stationary ends of the locus are closed with the tabulated CIE 1931 values at 380 nm (0.1741, 0.0050) and 700 nm (0.7347, 0.2653).
const LOC = [[0.1741, 0.0050, 380]];
for (let l = 430; l <= 645; l += 1) { const X = xbar(l), Y = ybar(l), Z = zbar(l); const s = X + Y + Z; LOC.push([X / s, Y / s, l]); }
LOC.push([0.7347, 0.2653, 700]);
function inside(x, y) { let c = false; for (let i = 0, j = LOC.length - 1; i < LOC.length; j = i++) { const [xi, yi] = LOC[i], [xj, yj] = LOC[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; }
const cieImg = document.createElement('canvas'); cieImg.width = 330; cieImg.height = 370;
(() => {
  const c = cieImg.getContext('2d'); const img = c.createImageData(cieImg.width, cieImg.height);
  for (let j = 0; j < cieImg.height; j++) for (let i = 0; i < cieImg.width; i++) {
    const x = (i + 0.5) / cieImg.width * 0.8 - 0.02 * 0, y = 0.9 - (j + 0.5) / cieImg.height * 0.9; const k = (j * cieImg.width + i) * 4;
    if (y <= 0.001 || !inside(x, y)) continue;
    const col = chromaColor(x / y, 1, (1 - x - y) / y).map(v => Math.round(255 * lin2srgb(v * 0.92)));
    img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
  }
  c.putImageData(img, 0, 0);
})();
const PL = LOCUS.filter(p => p.T >= 1500 && p.T <= 25000);
function keepAspect() {
  const r = ciePlot.plotRect; if (!r || !(r.width > 0) || !(r.height > 0)) return;
  const ax = ciePlot.ax; const ySpan = 0.9; const xSpan = ySpan * r.width / r.height;
  let nx0, nx1, ny0 = 0, ny1 = 0.9;
  if (xSpan >= 0.82) { nx0 = 0.38 - xSpan / 2; nx1 = 0.38 + xSpan / 2; }
  else { nx0 = -0.02; nx1 = 0.8; const ys = 0.82 * r.height / r.width; ny0 = 0.44 - ys / 2; ny1 = 0.44 + ys / 2; }
  if (Math.abs(ax.x.min - nx0) > 1e-3 || Math.abs(ax.x.max - nx1) > 1e-3 || Math.abs(ax.y.min - ny0) > 1e-3 || Math.abs(ax.y.max - ny1) > 1e-3) {
    ciePlot.setAxis('x', { min: nx0, max: nx1 }); ciePlot.setAxis('y', { min: ny0, max: ny1 });
  }
}
new ResizeObserver(() => setTimeout(keepAspect, 30)).observe(cieEl);

/* PSS vs R:FR reference curve: mixtures of the 660-nm and 730-nm channels */
const mixCurve = (() => {
  const red = CH.find(c => c.id === 'red'), fr = CH.find(c => c.id === 'fr'); const pts = [];
  for (let k = 0; k <= 200; k++) {
    const f = Math.pow(10, -3 + 4.5 * k / 200); // FR : R radiant ratio
    const q = WL.map((_, i) => (red.S[i] + f * fr.S[i]) * UPJ[i]);
    const x = band(q, 655, 665) / band(q, 725, 735); let a = 0, b = 0; for (let i = 0; i < NW; i++) { a += q[i] * SR[i]; b += q[i] * SF[i]; }
    if (x >= 0.04 && x <= 40) pts.push([x, a / (a + b)]);
  }
  return pts.sort((u, v) => u[0] - v[0]);
})();
const REF_PTS = (() => {
  const f = E => { const q = E.map((e, i) => e * UPJ[i]); let a = 0, b = 0; for (let i = 0; i < NW; i++) { a += q[i] * SR[i]; b += q[i] * SF[i]; } return [band(q, 655, 665) / band(q, 725, 735), a / (a + b)]; };
  return { sun: f(SUN_E1), g173: f(G173_E1) };
})();

/* morphology map (static field) */
(() => {
  const nx = 60, ny = 50, z = [];
  for (let j = 0; j < ny; j++) { const row = []; const b = (j + 0.5) / ny * 0.5; for (let i = 0; i < nx; i++) { const pss = 0.45 + (i + 0.5) / nx * 0.45; row.push(morphology(pss, b).stem); } z.push(row); }
  morphPlot.heatmap('field', { z, x0: 0.45, x1: 0.9, y0: 0, y1: 50, colormap: 'rdylgn', min: 1.75, max: 0.6, alpha: 0.85 });
  morphPlot.text('t1', 0.885, 46, 'compact', { align: 'right', color: '#0b3d1f', size: 12 });
  morphPlot.text('t2', 0.46, 3.5, 'elongated · shade-avoidance', { align: 'left', color: '#5a0a12', size: 12 });
})();

/* ------------------------------------------------------------------ update */
function update() {
  const p = ui.values(); _p = p;
  const R = compute(p); lastR = R;
  const P = palette();
  // readouts
  ro.set('ppfd', R.ppfd, R.ppfd > 50 ? 'ok' : 'warn', `${fmt(R.PPF, 0)} µmol s⁻¹ LED PPF · ${fmt(R.Pel / R.A, 0)} W m⁻²`);
  ro.set('epfd', R.epfd, null, `ePAR/PAR = ${fmt(R.ppfd > 0 ? R.epfd / R.ppfd : NaN, 2)}`);
  ro.set('ypfd', R.ypfd, null, `YPF/PPF = ${fmt(R.ppfd > 0 ? R.ypfd / R.ppfd : NaN, 2)}`);
  ro.set('dli', R.dli, R.dli >= 12 && R.dli <= 30 ? 'ok' : 'warn', `ePAR-DLI ${fmt(R.edli, 1)} at ${fmt(p.photo, 1)} h d⁻¹`);
  ro.set('eff', R.eff, !isFinite(R.eff) ? null : R.eff >= 2.5 ? 'ok' : R.eff >= 2.0 ? 'warn' : 'bad', isFinite(R.eff) ? `ePAR: ${fmt(R.effE, 2)} µmol J⁻¹ · DLC floor 2.5` : 'no LED power');
  ro.set('rad', R.radEff * 100, null, isFinite(R.radEff) ? `heat ≈ ${fmt((R.Pel - R.Prad) / R.A, 0)} W m⁻² at the fixture` : '—');
  const pb = v => fmt(100 * v / (R.ppfd || 1), 0);
  ro.set('bgr', R.ppfd > 0 ? `${pb(R.B)} · ${pb(R.G)} · ${pb(R.R)}` : '—', null, `UV-A ${fmt(R.uv, 0)} µmol m⁻² s⁻¹`);
  ro.set('frf', R.epfd > 0 ? 100 * R.FR / R.epfd : NaN, null, `FR 700–800: ${fmt(R.FR8, 0)} µmol m⁻² s⁻¹`);
  const rfrTxt = !isFinite(R.rfr) || R.rfr > 100 ? '> 100' : fmt(R.rfr, 2);
  ro.set('rfr', rfrTxt, null, 'sunlight ≈ 1.1');
  ro.items.rfr.value = R.rfr;
  // sunlight ≈ 0.70 (Sager et al. 1988 method); canopy shade 0.2–0.6; lamps without far-red 0.8–0.89
  ro.set('pss', R.pss, !isFinite(R.pss) ? null : R.pss < 0.55 ? 'warn' : 'ok', !isFinite(R.pss) ? '' : R.pss < 0.55 ? 'strong shade signal' : R.pss < 0.66 ? 'mild shade signal' : R.pss <= 0.76 ? 'sun-like' : 'above sunlight: no shade signal');
  ro.set('lux', R.lux, null, R.ppfd > 0 ? `${fmt(R.lux / R.ppfd, 1)} lx per µmol m⁻² s⁻¹` : '');
  const name = colourName(R);
  const sw = `<i style="display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:-2px;margin-right:6px;background:${cssRGB(R.xy ? chromaColor(...R.XYZ) : [0, 0, 0])};box-shadow:0 0 0 1px ${P.line}"></i>`;
  const cctTxt = R.cc && Math.abs(R.cc.duv) < 0.05 && !R.cc.edge ? `${fmt(R.cc.T, 0)} K` : '—';
  ro.set('cct', `${sw}${cctTxt}`, null, `${name}${R.cc && isFinite(R.cc.duv) ? ` · Duv ${R.cc.duv >= 0 ? '+' : ''}${fmt(R.cc.duv, 4)}` : ''}`);
  ro.items.cct.value = R.cc ? R.cc.T : NaN;
  hud.set('a', `PPFD <b>${fmt(R.ppfd, 0)}</b> µmol m⁻² s⁻¹ · DLI <b>${fmt(R.dli, 1)}</b>`);
  hud.set('b', `PSS <b>${fmt(R.pss, 2)}</b> · R:FR <b>${rfrTxt}</b> · blue <b>${fmt(100 * R.blueFrac, 0)}</b> %`);
  hud.set('c', `${sw}Looks <b>${name}</b>${cctTxt !== '—' ? ` · ${cctTxt}` : ''}`);
  legend.innerHTML = `Rendered from the spectrum: E(λ) × surface reflectance × CIE 1931 → sRGB<br>(fixed daylight white balance) · plant form: illustrative index ×${fmt(R.morph.stem, 2)}`;
  renderTent(R);

  // spectrum chart
  const energy = p.yunit === 'energy';
  const Y = energy ? R.E : R.q; const ymax = Math.max(1e-9, ...Y) * 1.08;
  specPlot.setAxis('y', { label: energy ? 'Spectral irradiance' : 'Spectral photon flux density', unit: energy ? 'W m⁻² nm⁻¹' : 'µmol m⁻² s⁻¹ nm⁻¹', min: 0, max: ymax });
  specPlot.region('par', 400, 700, { color: 'accent', alpha: 0.05, label: 'PAR 400–700' });
  specPlot.region('epar', 700, 750, { color: 'magenta', alpha: 0.06, label: 'ePAR' });
  specPlot.custom('fill', (ctx, pl) => {
    for (let i = 0; i < NW - 1; i++) {
      const l = WL[i]; if (!(Y[i] > 0)) continue;
      const vis = l < 380 ? 0.35 : l > 740 ? 0.35 : 0.9;
      const c = wavelengthRGB(l); ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${vis})`;
      const x0 = pl.px(l), x1 = pl.px(l + 1); const y0 = pl.py(Y[i]); ctx.fillRect(x0, y0, x1 - x0 + 0.7, pl.py(0) - y0);
    }
  });
  specPlot.line('total', Array.from(WL), Array.from(Y), { color: 'ink', width: 1.8, label: 'Total at canopy' });
  CH.forEach((c, k) => {
    const on = p.showCh && R.ch[k].P > 0;
    if (on) specPlot.line('ch-' + c.id, Array.from(WL), Array.from(R.qc[k]).map((v, i) => energy ? v / UPJ[i] : v), { color: c.dot === '#dfe9ff' ? '#8aa4d6' : c.dot, width: 1.3, dash: [4, 3], label: c.short, noTip: false });
    else specPlot.remove('ch-' + c.id);
  });
  if (p.sun > 0 && p.showCh) {
    specPlot.line('ch-sun', Array.from(WL), Array.from(R.qs).map((v, i) => energy ? v / UPJ[i] : v), { color: 'amber', width: 1.4, dash: [4, 3], label: 'Sun (model)' });
    specPlot.line('g173', Array.from(WL), Array.from(G173_E1).map((e, i) => p.sun * (energy ? e : e * UPJ[i])), { color: 'muted', width: 1.1, dash: [1.5, 2.5], label: 'ASTM G173 (ref.)' });
  } else { specPlot.remove('ch-sun'); specPlot.remove('g173'); }
  if (p.showRqe) specPlot.line('rqe', Array.from(WL), Array.from(RQE), { color: 'amber', width: 1.6, dash: [7, 4], y2: true, label: 'McCree RQE' }); else specPlot.remove('rqe');
  if (p.showPhy) {
    specPlot.line('sr', Array.from(WL), Array.from(SR).map(v => v / 4680), { color: '#d0303f', width: 1.6, y2: true, label: 'σR (Pr absorbs)' });
    specPlot.line('sf', Array.from(WL), Array.from(SF).map(v => v / 4680), { color: '#6a1030', width: 1.6, dash: [2, 2], y2: true, label: 'σFR (Pfr absorbs)' });
  } else { specPlot.remove('sr'); specPlot.remove('sf'); }

  // CIE diagram
  ciePlot.custom('bg', (ctx, pl) => {
    const x0 = pl.px(-0.0), x1 = pl.px(0.8), y0 = pl.py(0.9), y1 = pl.py(0);
    ctx.globalAlpha = isDark() ? 0.8 : 0.95; ctx.imageSmoothingEnabled = true; ctx.drawImage(cieImg, x0, y0, x1 - x0, y1 - y0); ctx.globalAlpha = 1;
    // spectral locus outline + ticks
    ctx.strokeStyle = palette().ink; ctx.lineWidth = 1.2; ctx.beginPath(); LOC.forEach(([x, y], i) => i ? ctx.lineTo(pl.px(x), pl.py(y)) : ctx.moveTo(pl.px(x), pl.py(y))); ctx.closePath(); ctx.stroke();
    ctx.font = '500 10px Inter, sans-serif'; ctx.fillStyle = palette().ink2;
    [460, 480, 490, 500, 510, 520, 540, 560, 580, 600, 620, 700].forEach(l => { const pt = LOC.find(v => v[2] === l); if (!pt) return; const [x, y] = pt; const cx = 0.33, cy = 0.33; const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy); const X = pl.px(x), Yp = pl.py(y); const ox = dx / d * 14, oy = -dy / d * 14; ctx.beginPath(); ctx.moveTo(X, Yp); ctx.lineTo(X + ox * 0.4, Yp + oy * 0.4); ctx.stroke(); ctx.textAlign = ox < 0 ? 'right' : 'left'; ctx.textBaseline = 'middle'; ctx.fillText(l, X + ox, Yp + oy); });
    // sRGB gamut
    ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(40,40,40,0.55)'; ctx.beginPath(); [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]].forEach(([x, y], i) => i ? ctx.lineTo(pl.px(x), pl.py(y)) : ctx.moveTo(pl.px(x), pl.py(y))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    // Planckian locus with CCT ticks
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1.6; ctx.beginPath(); PL.forEach((q, i) => i ? ctx.lineTo(pl.px(q.x), pl.py(q.y)) : ctx.moveTo(pl.px(q.x), pl.py(q.y))); ctx.stroke();
    ctx.fillStyle = '#222'; ctx.font = '600 9.5px Inter, sans-serif';
    [1500, 2700, 4000, 6500, 15000].forEach(T => { const q = LOCUS.reduce((a, b) => Math.abs(b.T - T) < Math.abs(a.T - T) ? b : a); ctx.beginPath(); ctx.arc(pl.px(q.x), pl.py(q.y), 2.2, 0, 7); ctx.fill(); ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(T >= 10000 ? (T / 1000) + 'k K' : T + ' K', pl.px(q.x) - 3, pl.py(q.y) + 4); });
  });
  ciePlot.custom('mix', (ctx, pl) => {
    const act = CH.filter((c, k) => R.ch[k].P > 0);
    const pts = act.map(c => c.xy); if (p.sun > 0) { const X = toXYZ(SUN_E1); const s = X[0] + X[1] + X[2]; pts.push([X[0] / s, X[1] / s]); }
    if (pts.length >= 2) {
      const hull = convexHull(pts); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.strokeStyle = 'rgba(20,20,20,0.75)'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
      ctx.beginPath(); hull.forEach(([x, y], i) => i ? ctx.lineTo(pl.px(x), pl.py(y)) : ctx.moveTo(pl.px(x), pl.py(y))); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    }
    CH.forEach((c, k) => { const [x, y] = c.xy; const on = R.ch[k].P > 0; ctx.fillStyle = c.dot; ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(pl.px(x), pl.py(y), on ? 4.5 : 3, 0, 7); ctx.fill(); ctx.stroke(); if (on) { ctx.fillStyle = '#111'; ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(c.short, pl.px(x) + 6, pl.py(y) - 3); } });
    if (R.xy) { const X = pl.px(R.xy[0]), Yp = pl.py(R.xy[1]); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X, Yp, 8, 0, 7); ctx.fill(); ctx.fillStyle = cssRGB(chromaColor(...R.XYZ)); ctx.beginPath(); ctx.arc(X, Yp, 5.5, 0, 7); ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(X, Yp, 8, 0, 7); ctx.stroke(); ctx.fillStyle = '#111'; ctx.font = '700 11px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(`mix (${fmt(R.xy[0], 3)}, ${fmt(R.xy[1], 3)})`, X + 10, Yp + 4); }
  });
  setTimeout(keepAspect, 0);

  // PSS vs R:FR
  pssPlot.line('mix', mixCurve.map(v => v[0]), mixCurve.map(v => v[1]), { color: 'magenta', width: 2.2, label: '660 + 730 nm mixtures' });
  pssPlot.point('sun', REF_PTS.sun[0], REF_PTS.sun[1], { color: 'amber', r: 5, label: 'sun model' });
  pssPlot.point('g173', REF_PTS.g173[0], REF_PTS.g173[1], { color: 'water', r: 4, label: '' });
  pssPlot.hline('ref', 0.83, { color: 'muted', dash: [2, 4], label: '' });
  if (isFinite(R.pss)) {
    const xr = Math.min(28, Math.max(0.055, isFinite(R.rfr) ? R.rfr : 28));
    pssPlot.point('cur', xr, R.pss, { color: 'ink', r: 6.5, label: `this mix: PSS ${fmt(R.pss, 3)}${xr >= 28 ? ' (R:FR → ∞)' : ''}`, guides: true });
  } else pssPlot.remove('cur');

  // morphology map point
  morphPlot.point('cur', Math.min(0.9, Math.max(0.45, R.pss || 0.45)), Math.min(50, 100 * R.blueFrac), { color: 'ink', r: 6.5, label: `stem ×${fmt(R.morph.stem, 2)} · leaf ×${fmt(R.morph.leaf, 2)}`, guides: true });

  // channel efficacy bars
  effChart.set(CH.map(c => c.short), [
    { label: 'PPF (400–700 nm) per electrical W', values: R.ch.map(c => c.effPar), colors: CH.map(c => c.dot === '#dfe9ff' ? '#9db3e0' : c.dot), color: 'ink', format: v => v.toFixed(1) },
    { label: 'ePAR (400–750 nm) per W', values: R.ch.map(c => c.effEpar), colors: CH.map(c => withAlpha(c.dot === '#dfe9ff' ? '#9db3e0' : c.dot, 0.42)), color: 'muted', format: v => v.toFixed(1) }
  ]);
  effChart.refLines([{ v: 2.5, label: 'DLC Hort V4.0 floor 2.5', color: 'danger' }, ...(isFinite(R.eff) ? [{ v: R.eff, label: '', color: 'accent' }] : [])]);

  // composition bar
  const tot = R.uv + R.B + R.G + R.R + R.FR8;
  const parts = [['UV-A', '300–400', R.uv, '#8b5cf6'], ['Blue', '400–500', R.B, '#2f6bff'], ['Green', '500–600', R.G, '#23b25a'], ['Red', '600–700', R.R, '#e0283c'], ['Far-red', '700–800', R.FR8, '#6d0d22']];
  compEl.innerHTML = tot > 0 ? `<div><div class="sm-comp-h">Photon composition by waveband (ANSI/ASABE S640)</div><div class="sm-comp">${parts.map(([n, r, v, c]) => v / tot > 0.002 ? `<span style="flex:${v / tot};background:${c}" title="${n} ${r} nm: ${fmt(100 * v / tot, 1)} %">${v / tot > 0.07 ? `${n} ${fmt(100 * v / tot, 0)}%` : ''}</span>` : '').join('')}</div><div class="sm-comp-n">The blue share of PPFD is the quantity most often used in spectral-response studies; far-red is counted in ePAR but not in PPFD.</div></div>
    <table class="sm-comp-t"><thead><tr><th>Band</th><th>nm</th><th class="num">µmol m⁻² s⁻¹</th><th class="num">% of 300–800</th><th class="num">% of PPFD</th></tr></thead><tbody>${parts.map(([n, r, v, c]) => `<tr><td><i style="background:${c}"></i>${n}</td><td>${r}</td><td class="num">${fmt(v, 0)}</td><td class="num">${fmt(100 * v / tot, 1)}</td><td class="num">${n === 'UV-A' || n === 'Far-red' ? '—' : fmt(100 * v / (R.ppfd || 1), 1)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted" style="padding:20px 0">No photons — raise a channel.</p>';
}
function wavelengthRGB(l) { return wavelengthToRGB(Math.min(780, Math.max(380, l))); }  // course-wide wavelength colours (colors.js)
function convexHull(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (P.length < 3) return P;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  const up = []; for (const p of P.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function exportCSV() {
  const R = lastR || compute(ui.values());
  const head = ['wavelength_nm', 'total_umol_m2_s_nm', 'total_W_m2_nm', ...CH.map(c => c.id + '_umol_m2_s_nm'), 'sun_umol_m2_s_nm', 'sigmaR_m2_mol', 'sigmaFR_m2_mol', 'McCree_RQE'];
  const rows = Array.from(WL).map((l, i) => [l, +R.q[i].toPrecision(5), +R.E[i].toPrecision(5), ...CH.map((c, k) => +R.qc[k][i].toPrecision(5)), +R.qs[i].toPrecision(5), +SR[i].toFixed(1), +SF[i].toFixed(1), +RQE[i].toFixed(3)]);
  downloadCSV('spectrum-mixer.csv', head, rows);
}

let raf = 0;
ui.onChange(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
new ResizeObserver(() => { if (lastR) renderTent(lastR); }).observe(stageEl);
document.addEventListener('ffp:theme', () => update());
update();
