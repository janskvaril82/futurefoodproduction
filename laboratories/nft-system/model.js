/* NFT channel model — Future Food Production, laboratory "NFT channel simulator".
   Quasi-steady along-channel balances (residence time: seconds to minutes) coupled to daily
   lettuce growth (time scale: days). Equations N1–N9 of the Derive tab:
     N1  Nusselt laminar falling film     h = (3 μ q / (ρ g sinθ))^(1/3),  ū = q/h,  Re_f = 4q/ν
     N2  residence time                   t_res = L / ū
     N3  surface re-aeration (Higbie)     K_L = 2 √(D u_s / (π ℓ)),  k_La = K_L / h
     N4  dissolved-O₂ balance             Q dC/dx = K_L W (C*(T) − C) − R_O₂ / s
     N5  root O₂ demand                   R_O₂ = (c_g G_DM + c_m W_DM) Q10^((T−20)/10) · C/(K_O + C)
     N6  NO₃-N and K (Michaelis–Menten)   Q dN/dx = −U_N / s + N e′,  U_N = U_max · N/(K_m + N)
     N7  water                            dQ/dx = −e′ = −E / s,  E = e_w m
     N8  heat                             ρ c_p Q dT/dx = U P (T_air − T) + α G_sun W (1 − 0.8 cover)
     N9  growth (logistic, stress-scaled) dm/dt = r f m (1 − m/K),  f = f_T · min(f_O₂, f_N, f_K)
   Internal units: m, s, m³ s⁻¹, g m⁻³ (= mg L⁻¹), °C, g fresh mass (FW), g dry mass (DW). */
import { doSaturation } from '/assets/js/physics.js';

export const G = 9.81, RHO = 998, CP = 4186;
/** Dynamic viscosity of water, Pa s (Vogel-type fit; 1.002 × 10⁻³ at 20 °C) — same fit as Lesson 5.4. */
export const visc = T => 2.414e-5 * Math.pow(10, 247.8 / (T + 133.15));
/** O₂ diffusivity in water, m² s⁻¹: 2.0 × 10⁻⁹ at 20 °C, scaled with T/μ (Stokes–Einstein). */
export const dO2 = T => 2.0e-9 * ((T + 273.15) / 293.15) * (visc(20) / visc(T));
/* fast lookup tables, 0–50 °C in 0.05 K steps */
const T0 = 0, TN = 1001, TD = 0.05;
const TAB = { mu: new Float64Array(TN), cs: new Float64Array(TN), d: new Float64Array(TN) };
for (let i = 0; i < TN; i++) { const T = T0 + i * TD; TAB.mu[i] = visc(T); TAB.cs[i] = doSaturation(T); TAB.d[i] = dO2(T); }
const look = (arr, T) => { let x = (T - T0) / TD; if (x <= 0) return arr[0]; if (x >= TN - 1) return arr[TN - 1]; const i = x | 0, f = x - i; return arr[i] + (arr[i + 1] - arr[i]) * f; };
export const muT = T => look(TAB.mu, T), csT = T => look(TAB.cs, T), dT = T => look(TAB.d, T);

/** sin θ from a slope given as a fraction (rise/run). */
export const sinSlope = s => s / Math.sqrt(1 + s * s);
/** Laminar falling film (Nusselt 1916; Bird et al. 2002). Q m³ s⁻¹, W m, slope fraction, T °C. */
export function film(Q, W, s, T) {
  const q = Math.max(1e-12, Q) / W, mu = muT(T), sn = sinSlope(Math.max(1e-5, s));
  const h = Math.cbrt(3 * mu * q / (RHO * G * sn));
  const u = q / h;
  return { q, h, u, us: 1.5 * u, Re: 4 * q / (mu / RHO) };
}
/** Penetration-theory liquid-side coefficient (Higbie 1935), m s⁻¹, for a surface renewed every ell metres. */
export const higbieKL = (T, us, ell) => 2 * Math.sqrt(dT(T) * Math.max(1e-6, us) / (Math.PI * Math.max(0.01, ell)));

/* ------------------------------------------------------------------ crop parameters */
export const CROP = {
  m0: 2.0,        // g FW at transplanting (11-day-old seedling; assumed)
  K: 250,         // g FW, logistic asymptote (assumed)
  r: 0.218,       // d⁻¹: 150 g FW at 24 d after transplanting = 35 d after seeding (Brechner & Both 2013)
  dm: 0.047,      // dry-matter fraction: 150 g FW ≈ 7 g DW (Brechner & Both 2013)
  nN: 0.040,      // g N per g DW (adequate 3.5–4.5 % in mature romaine leaves; Hochmuth et al. 2012)
  nK: 0.055,      // g K per g DW (adequate 5.0–6.0 % in mature romaine leaves; Hochmuth et al. 2012)
  cg: 10.5,       // mg O₂ h⁻¹ per (g DW d⁻¹): growth-linked root respiration (Lesson 5.3, Worked example 1)
  cm: 0.10,       // mg O₂ h⁻¹ per g DW: maintenance share ≈ 10 % near harvest (assumed)
  Q10: 2.0,       // temperature coefficient of respiration (Atkin & Tjoelker 2003)
  KO: 0.3,        // mg L⁻¹ apparent half-saturation of root O₂ uptake (assumed)
  KmN: 0.35,      // mg N L⁻¹ = 25 µM: representative high-affinity NO₃⁻ value (the system saturates below 1 mM; Siddiqi et al. 1990)
  KmK: 0.70       // mg K L⁻¹ = 18 µM (mechanism 1 of barley roots; Epstein et al. 1963)
};
const lerpTab = (tab, x) => { if (x <= tab[0][0]) return tab[0][1]; for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) { const [x0, y0] = tab[i - 1], [x1, y1] = tab[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return tab[tab.length - 1][1]; };
/** Root-zone temperature response of lettuce growth (illustrative; optimum 21–24 °C, Thompson et al. 1998; ≤ 25 °C, Brechner & Both 2013). */
export const TEMP_TAB = [[8, 0.35], [12, 0.6], [17, 0.86], [21, 1], [24, 1], [26, 0.93], [28, 0.82], [31, 0.6], [35, 0.3], [40, 0.1]];
export const fTemp = T => lerpTab(TEMP_TAB, T);
/** Dissolved-O₂ response (illustrative; no inhibition above 4 mg L⁻¹, visible stress at 3 mg L⁻¹; Brechner & Both 2013). */
export const O2_TAB = [[0, 0.05], [1, 0.25], [2, 0.5], [3, 0.8], [4, 1]];
export const fO2 = C => lerpTab(O2_TAB, C);
export const fMM = (C, Km) => Math.max(0, C) / (Km + Math.max(0, C));
/** Logistic step with a constant relative rate over dt (exact solution). */
export const logisticStep = (m, rate, K, dt) => K / (1 + (K / m - 1) * Math.exp(-rate * dt));
/** Growth rate, g FW d⁻¹, at stress factor f. */
export const growthRate = (m, f = 1) => CROP.r * f * m * (1 - m / CROP.K);
/** Head radius (m) of a butterhead of fresh mass m (g): ≈ 0.12 m at 150 g, ∝ m^(1/3). */
export const headRadius = m => 0.12 * Math.cbrt(Math.max(0.1, m) / 150);
/** Root O₂ demand at 20 °C before DO limitation, mg h⁻¹ per plant (Eq. N5). */
export const rootO2 = (m, f = 1) => CROP.cg * growthRate(m, f) * CROP.dm + CROP.cm * m * CROP.dm;

/* ------------------------------------------------------------------ one gully, quasi-steady */
/**
 * March along one gully (x = 0 at the inlet) for given plant masses.
 * fTl: temperature factor per plant from the previous pass. The O₂ and nutrient demands are those of a plant
 * growing at the temperature-limited rate; O₂ shortage then limits respiration directly through C/(K_O + C)
 * and nutrient shortage limits uptake through Michaelis–Menten (no circular feedback within a day).
 */
export function channel(p, Qin, masses, fTl, _unused, nSample = 160) {
  const fEnv = fTl, fAll = fTl;
  const s = p.spacing, n = masses.length, W = p.width, slope = p.slope, H = 0.05;
  const Pw = 2 * (W + H), Wtop = W + 0.008;
  const sub = n > 80 ? 3 : 4, dx = s / sub;
  let Q = Qin, C = p.doIn, N = p.nIn, K = p.kIn, T = p.tIn;
  const plant = new Array(n); const prof = { x: [], C: [], N: [], K: [], T: [], Cs: [], h: [] };
  const every = Math.max(1, Math.round(n * sub / nSample)); let step = 0;
  const push = x => { prof.x.push(x); prof.C.push(C); prof.N.push(N); prof.K.push(K); prof.T.push(T); prof.Cs.push(csT(T)); prof.h.push(film(Q, W, slope, T).h); };
  push(0);
  const tot = { o2: 0, n: 0, k: 0, w: 0 };
  for (let i = 0; i < n; i++) {
    const m = masses[i];
    const Gdem = growthRate(m, fEnv ? fEnv[i] : 1) * CROP.dm;    // g DW d⁻¹ allowed by temperature and O₂
    const Gact = growthRate(m, fAll ? fAll[i] : 1) * CROP.dm;    // g DW d⁻¹ actual (lagged)
    const R20 = CROP.cg * Gact + CROP.cm * m * CROP.dm;          // mg O₂ h⁻¹ at 20 °C
    const UmaxN = CROP.nN * Gdem / 86400 / s, UmaxK = CROP.nK * Gdem / 86400 / s;   // g s⁻¹ per m of gully
    const E = p.ew * m / 1000;                                   // L d⁻¹ per plant
    const eLin = E / 1000 / 86400 / s;                           // m³ s⁻¹ per m
    const cover = Math.min(1, 2 * headRadius(m) / s);
    const heatIn = p.alpha * p.sun * (1 - 0.8 * cover) * Wtop;   // W m⁻¹
    let aC = 0, aN = 0, aK = 0, aT = 0, aR = 0;
    const d = (Cc, Nn, Kk, Tt, Qq, out) => {
      const f = film(Qq, W, slope, Tt); const KL = higbieKL(Tt, f.us, p.ell);
      const RO2 = R20 * Math.pow(CROP.Q10, (Tt - 20) / 10) * fMM(Cc, CROP.KO);  // mg h⁻¹
      out[0] = (KL * W * (csT(Tt) - Cc) - RO2 / 3.6e6 / s) / Qq;
      out[1] = (-UmaxN * fMM(Nn, CROP.KmN) + Nn * eLin) / Qq;
      out[2] = (-UmaxK * fMM(Kk, CROP.KmK) + Kk * eLin) / Qq;
      out[3] = (p.U * Pw * (p.tAir - Tt) + heatIn) / (RHO * CP * Qq);
      out[4] = RO2;
    };
    const k1 = [0, 0, 0, 0, 0], k2 = [0, 0, 0, 0, 0];
    for (let k = 0; k < sub; k++) {
      d(C, N, K, T, Q, k1);
      const Qm = Math.max(Qin * 0.02, Q - eLin * dx / 2);
      d(Math.max(0, C + k1[0] * dx / 2), Math.max(0, N + k1[1] * dx / 2), Math.max(0, K + k1[2] * dx / 2), T + k1[3] * dx / 2, Qm, k2);
      C = Math.max(0, C + k2[0] * dx); N = Math.max(0, N + k2[1] * dx); K = Math.max(0, K + k2[2] * dx); T += k2[3] * dx; Q = Math.max(Qin * 0.02, Q - eLin * dx);
      aC += C / sub; aN += N / sub; aK += K / sub; aT += T / sub; aR += k2[4] / sub;
      step++; if (step % every === 0) push((i * sub + k + 1) * dx);
    }
    const fT = fTemp(aT), fo = fO2(aC), fn = fMM(aN, CROP.KmN), fk = fMM(aK, CROP.KmK);
    const fac = { temperature: fT, oxygen: fo, nitrogen: fn, potassium: fk };
    let limiter = 'none', lo = 0.97; for (const k in fac) if (fac[k] < lo) { lo = fac[k]; limiter = k; }
    const uN = UmaxN * fMM(aN, CROP.KmN) * 86400 * s * 1000, uK = UmaxK * fMM(aK, CROP.KmK) * 86400 * s * 1000; // mg d⁻¹
    tot.o2 += aR; tot.n += uN; tot.k += uK; tot.w += E;
    plant[i] = { x: (i + 0.5) * s, C: aC, N: aN, K: aK, T: aT, f: fT * Math.min(fo, fn, fk), fT, fO: fo, fN: fn, fK: fk, limiter, RO2: aR, uN, uK, E };
  }
  if (prof.x[prof.x.length - 1] < n * s - 1e-9) push(n * s);
  return { plant, prof, out: { C, N, K, T, Q }, tot, L: n * s };
}

export const DEFAULTS = {
  slope: 0.025, length: 10, width: 0.10, spacing: 0.20, nGully: 4, Q: 1.5 / 60000, imbalance: 0,
  doIn: 8.0, nIn: 125, kIn: 215, tIn: 22, tAir: 24, sun: 300, ew: 3.0, ell: 1.0,
  U: 8, alpha: 0.3, days: 24
};

/**
 * Simulate the crop cycle, day 0 (transplanting) … p.days, for every gully.
 * Profiles are recomputed at the start of each day (two fixed-point passes for the lagged stress factors);
 * masses are then advanced one day with the exact logistic step.
 */
export function simulate(pIn) {
  const p = Object.assign({}, DEFAULTS, pIn);
  const n = Math.max(1, Math.floor(p.length / p.spacing + 1e-9));
  const ng = p.nGully, days = Math.round(p.days);
  const Qs = Array.from({ length: ng }, (_, j) => p.Q * (1 + p.imbalance * (ng > 1 ? 1 - 2 * j / (ng - 1) : 0)));
  const uniq = p.imbalance > 0 ? ng : 1;                        // identical gullies → compute once
  const mass = Array.from({ length: uniq }, () => new Float64Array(n).fill(CROP.m0));
  const fAll = Array.from({ length: uniq }, () => new Float64Array(n).fill(1));
  const fT = Array.from({ length: uniq }, () => new Float64Array(n).fill(1));
  const snaps = [];
  for (let day = 0; day <= days; day++) {
    const res = [];
    for (let j = 0; j < uniq; j++) {
      let r = null;
      for (let it = 0; it < 2; it++) { r = channel(p, Qs[j], mass[j], fT[j]); for (let i = 0; i < n; i++) { fAll[j][i] = r.plant[i].f; fT[j][i] = r.plant[i].fT; } }
      res.push(r);
    }
    snaps.push({ day, mass: mass.map(a => Float32Array.from(a)), ch: res });
    if (day < days) for (let j = 0; j < uniq; j++) for (let i = 0; i < n; i++) mass[j][i] = logisticStep(mass[j][i], CROP.r * fAll[j][i], CROP.K, 1);
  }
  const ref = []; let m = CROP.m0; for (let dd = 0; dd <= days; dd++) { ref.push(m); m = logisticStep(m, CROP.r, CROP.K, 1); }
  const idx = j => (uniq === 1 ? 0 : j);
  return { p, n, ng, Qs, snaps, ref, idx };
}
