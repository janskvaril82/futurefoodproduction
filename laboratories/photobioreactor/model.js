/* Microalgae photobioreactor — light-limited growth model (pure ES module, no DOM).
   Light: Beer–Lambert attenuation I = I0·exp(−ka·X·z) in the reactor's own geometry (slab, two-sided panel, tube).
   Growth: Bernard & Rémond (2012) light response with photoinhibition × CTMI temperature factor (Rosso et al. 1993),
   minus a constant respiration (maintenance) rate. Equations P1–P11 in the Derive tab of index.html. */
import { solarElevation, clearSkyIrradiance, doSaturation, dayLength, SUN_PPFD_PER_WM2, clamp } from '/assets/js/physics.js';

/* ------------------------------------------------------------------ strains */
export const STRAINS = {
  // α = low-light yield on photons × ka × 0.0864 (1 µmol m⁻² s⁻¹ for a day = 0.0864 mol m⁻² d⁻¹)
  chlorella: {
    label: 'Chlorella vulgaris', short: 'Chlorella', muMax: 2.0, alpha: 0.013, Iopt: 600, ka: 0.15, r: 0.1, Tmin: 5, Topt: 25, Tmax: 38,
    protein: 0.55, proteinRange: '51–58 %', colors: ['#8fd14f', '#2f8a22', '#12451a'], medium: 'fresh water'
  },
  arthrospira: {   // local kinetics of Farges et al. (2009): α = ρM·φ·Ea, saturation near ρM·φ·Ea·K, no photoinhibition
    label: 'Arthrospira platensis (spirulina)', short: 'Spirulina', muMax: 2.6, alpha: 0.0288, Iopt: 2000, ka: 0.225, r: 0.1, Tmin: 15, Topt: 35, Tmax: 42,
    protein: 0.60, proteinRange: '46–63 %', colors: ['#56c29c', '#0f6e58', '#06342d'], medium: 'alkaline bicarbonate'
  },
  nanno: {
    label: 'Nannochloropsis sp.', short: 'Nannochloropsis', muMax: 1.56, alpha: 0.0124, Iopt: 500, ka: 0.18, r: 0.1, Tmin: 2.3, Topt: 27.9, Tmax: 32.6,
    protein: 0.40, proteinRange: '≈ 30–45 %', colors: ['#bdd456', '#6f8c1e', '#3b4c12'], medium: 'sea water'
  }
};
export const PAR_UMOL_PER_J = 4.57;       // µmol photons per J of PAR (sunlight, McCree)
export const E_BIOMASS = 20;              // kJ per g dry biomass (≈ electron-balance estimate 19.6 kJ g⁻¹)
export const Y_O2 = 1.886;                // g O2 released per g biomass (CH1.8O0.5N0.2 from CO2 + nitrate)
export const Y_CO2 = 44.01 / 24.6;        // g CO2 fixed per g biomass
export const RHO = 1000, G0 = 9.80665, NU = 1.0e-6;

/* ------------------------------------------------------------------ photosynthesis–irradiance and temperature */
/** Bernard & Rémond (2012) light response with photoinhibition; µ in d⁻¹, I in µmol m⁻² s⁻¹. */
export function muLight(I, s) { if (I <= 0) return 0; const a = s.muMax / s.alpha; const q = I / s.Iopt - 1; return s.muMax * I / (I + a * q * q); }
/** Cardinal temperature model with inflexion (Rosso et al. 1993); 1 at T_opt, 0 outside (T_min, T_max). */
export function ctmi(T, s) {
  if (T <= s.Tmin || T >= s.Tmax) return 0;
  const n = (T - s.Tmax) * (T - s.Tmin) ** 2;
  const d = (s.Topt - s.Tmin) * ((s.Topt - s.Tmin) * (T - s.Topt) - (s.Topt - s.Tmax) * (s.Topt + s.Tmin - 2 * T));
  return clamp(n / d, 0, 1);
}

/* ------------------------------------------------------------------ depth integration helpers */
const NS = 48;   // Simpson intervals on a log-mapped optical-depth grid (dense near the lit surface)
function mapped(Tmax) { const b = Math.log(1 + Tmax); const e = Math.expm1(b); return { b, e, tau: t => Tmax * Math.expm1(b * t) / e, dtau: t => Tmax * b * Math.exp(b * t) / e }; }
/** (1/Tmax)∫₀^Tmax f(τ) dτ */
export function meanOverTau(f, Tmax) {
  if (Tmax < 1e-6) return f(0);
  const m = mapped(Tmax); let s = 0;
  for (let i = 0; i <= NS; i++) { const t = i / NS; const w = i === 0 || i === NS ? 1 : i % 2 ? 4 : 2; s += w * f(m.tau(t)) * m.dtau(t); }
  return s / (3 * NS) / Tmax;
}
/** Cumulative F(τ) = ∫₀^τ f dτ' on a mapped grid, returned as an interpolating function. */
function cumulative(f, Tmax, n = 96) {
  const m = mapped(Math.max(Tmax, 1e-6)); const tau = new Float64Array(n + 1), F = new Float64Array(n + 1);
  let prevT = 0, prevF = f(0); tau[0] = 0; F[0] = 0;
  for (let i = 1; i <= n; i++) { const t = m.tau(i / n); const ft = f(t); F[i] = F[i - 1] + 0.5 * (ft + prevF) * (t - prevT); tau[i] = t; prevT = t; prevF = ft; }
  return x => { if (x <= 0) return 0; if (x >= tau[n]) return F[n]; let lo = 0, hi = n; while (hi - lo > 1) { const k = (lo + hi) >> 1; if (tau[k] <= x) lo = k; else hi = k; } const u = (x - tau[lo]) / (tau[hi] - tau[lo]); return F[lo] + u * (F[hi] - F[lo]); };
}
const GL16 = (() => { // Gauss–Legendre nodes/weights on [-1, 1]
  const x = [0.0950125098, 0.2816035508, 0.4580167777, 0.6178762444, 0.7554044084, 0.8656312024, 0.9445750231, 0.9894009350];
  const w = [0.1894506105, 0.1826034150, 0.1691565194, 0.1495959888, 0.1246289713, 0.0951585117, 0.0622535239, 0.0271524594];
  const X = [], W = []; x.forEach((v, i) => { X.push(-v, v); W.push(w[i], w[i]); }); return { X, W };
})();

/* ------------------------------------------------------------------ geometry of each cultivation system */
export const SYSTEMS = {
  raceway: { label: 'Open raceway pond' },
  panel: { label: 'Flat-panel airlift' },
  tubular: { label: 'Tubular photobioreactor' }
};
/** Light geometry + volumes for the current settings. X in g L⁻¹ (= kg m⁻³). */
export function geometry(p) {
  if (p.system === 'raceway') return { kind: 'slab', L: p.depth, VA: p.depth, intercept: 1, Ifac: 1 };
  if (p.system === 'panel') { const f = Math.min(0.5, p.spacing / (2 * p.Hp)); return { kind: 'panel', L: p.thick, VA: p.thick * p.Hp / p.spacing, intercept: Math.min(1, 2 * p.Hp * f / p.spacing), Ifac: f }; }
  const tau = p.greenhouse ? p.tauGH : 1; const s = Math.max(p.tubeD * 1.05, p.tubeS);
  return { kind: 'tube', L: p.tubeD, R: p.tubeD / 2, VA: Math.PI * p.tubeD ** 2 / 4 / s, intercept: tau * p.tubeD / s, Ifac: tau };
}
/** Depth-averaged gross specific growth rate (d⁻¹, before temperature and respiration) for surface irradiance I0 (ground PPFD × Ifac). */
export function muAvg(I0, X, p, s, g = geometry(p)) {
  if (I0 <= 0) return 0;
  const k = s.ka * X * 1000;                                                  // m⁻¹ (ka m² g⁻¹ × X g m⁻³)
  if (g.kind === 'slab') return meanOverTau(t => muLight(I0 * Math.exp(-t), s), k * g.L);
  if (g.kind === 'panel') { const tw = k * g.L; return meanOverTau(t => muLight(I0 * (Math.exp(-t) + Math.exp(-(tw - t))), s), tw / 2); }
  // tube, vertical light from above: µ̄ = (1/πρ)∫ F(2ρ cosθ) cosθ dθ with ρ = k R
  const rho = k * g.R; if (rho < 1e-6) return muLight(I0, s);
  const F = cumulative(t => muLight(I0 * Math.exp(-t), s), 2 * rho);
  let sum = 0; for (let i = 0; i < 16; i++) { const th = GL16.X[i] * Math.PI / 2; sum += GL16.W[i] * F(2 * rho * Math.cos(th)) * Math.cos(th); }
  return sum * (Math.PI / 2) / (Math.PI * rho);
}
/** Irradiance profile across the light path (for charts and the cut-away textures). Returns [{z (m), I}] */
export function profile(I0, X, p, s, n = 80, g = geometry(p)) {
  const k = s.ka * X * 1000, out = [];
  for (let i = 0; i <= n; i++) {
    const z = g.L * i / n;
    const I = g.kind === 'panel' ? I0 * (Math.exp(-k * z) + Math.exp(-k * (g.L - z))) : I0 * Math.exp(-k * z);
    out.push({ z, I });
  }
  return out;
}

/* ------------------------------------------------------------------ light supply */
/** Ground-level PPFD (µmol m⁻² s⁻¹) at time t (days) for sun or constant light. */
export function ppfdAt(t, p) {
  if (p.light === 'const') return p.I0const;
  const hour = ((t % 1) + 1) % 1 * 24;
  const doy = Math.round(p.doy + Math.floor(t)) % 365 || 365;
  const el = solarElevation(p.lat, doy, hour);
  return clearSkyIrradiance(el) * SUN_PPFD_PER_WM2;
}
/** Daily PAR photon supply on the ground, mol m⁻² d⁻¹ (numerical integral). */
export function dailyPhotons(p, day = 0) { let s = 0; const n = 96; for (let i = 0; i < n; i++) s += ppfdAt(day + (i + 0.5) / n, p); return s / n * 86400 / 1e6; }

/* ------------------------------------------------------------------ mixing / pumping energy */
export function mixingPower(p) {
  if (p.system === 'raceway') {
    const w = 2.4, d = p.depth, u = p.u, n = 0.015;                              // Manning n for a lined channel
    const Rh = w * d / (w + 2 * d);
    const perA = RHO * G0 * d * n * n * u ** 3 / Math.pow(Rh, 4 / 3);          // hydraulic W m⁻² (friction in the straights)
    const PA = perA * 2 / 0.2;                                                  // ×2 bends & paddlewheel losses, 20 % wheel + drive efficiency
    return { PA, PV: PA / d, hyd: perA * 2 };
  }
  if (p.system === 'panel') {
    const UG = p.vvm * p.Hp / 60;                                              // superficial gas velocity, m s⁻¹
    const PVh = RHO * G0 * UG;                                                  // gas-expansion power per volume
    const PV = PVh / 0.5;                                                       // 50 % blower efficiency
    return { PV, PA: PV * p.thick * p.Hp / p.spacing, hyd: PVh, UG };
  }
  const D = p.tubeD, u = p.u, Re = u * D / NU, f = 0.316 * Math.pow(Re, -0.25); // Blasius, smooth tube
  const PVh = f * RHO * u ** 3 / (2 * D);                                       // W m⁻³ of tube volume
  const PV = PVh * 1.5 / 0.6;                                                    // ×1.5 bends/fittings, 60 % pump efficiency
  return { PV, PA: PV * Math.PI * D * D / 4 / Math.max(D * 1.05, p.tubeS), hyd: PVh, Re, f };
}

/* ------------------------------------------------------------------ simulator */
export class Culture {
  constructor(p) { this.p = Object.assign({}, p); this.reset(); }
  setParams(p) { this.p = Object.assign({}, this.p, p); this.s0 = null; }
  strain() { const b = STRAINS[this.p.strain]; return Object.assign({}, b, { Iopt: this.p.Iopt ?? b.Iopt, ka: this.p.ka ?? b.ka, r: this.p.resp ?? b.r }); }
  reset() { this.t = 0; this.X = this.p.X0; this.cum = { prod: 0, photons: 0, harvest: 0, energy: 0 }; this.log = []; this.lastDay = null; this.diag = this.rates(); }
  rates(X = this.X, t = this.t) {
    const p = this.p, s = this.strain(), g = geometry(p);
    const Ig = ppfdAt(t, p), I0 = Ig * g.Ifac;
    const phi = ctmi(p.T, s);
    const gross = muAvg(I0, X, p, s, g) * phi;
    const net = gross - s.r;
    return { Ig, I0, phi, gross, net, g, s };
  }
  step(dt) {
    const p = this.p, D = p.mode === 'cont' ? p.D : 0;
    const f = (t, X) => { const r = this.rates(Math.max(1e-6, X), t); return (r.net - D) * X; };
    const t = this.t, X = this.X;
    const k1 = f(t, X), k2 = f(t + dt / 2, X + dt / 2 * k1), k3 = f(t + dt / 2, X + dt / 2 * k2), k4 = f(t + dt, X + dt * k3);
    const Xn = Math.max(1e-5, X + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4));
    const r = this.rates(0.5 * (X + Xn), t + dt / 2);
    const g = r.g, mix = mixingPower(p);
    this.cum.prod += r.net * 0.5 * (X + Xn) * 1000 * g.VA * dt;              // g m⁻² of ground (net growth)
    this.cum.harvest += D * 0.5 * (X + Xn) * 1000 * g.VA * dt;                // g m⁻² harvested
    this.cum.photons += r.Ig * 86400e-6 * dt;                                    // mol m⁻² of ground
    this.cum.energy += mix.PA * 24 * dt / 1000;                                  // kWh m⁻²
    this.X = Xn; this.t = t + dt;
    this.log.push({ t: this.t, prod: this.cum.prod, photons: this.cum.photons, energy: this.cum.energy });
    while (this.log.length > 2 && this.log[1].t < this.t - 1) this.log.shift();
    this.diag = this.rates();
  }
  /** Productivity etc. over the last 24 h (or since start if shorter). */
  lastDayStats() {
    const L = this.log; if (L.length < 2) return null;
    const a = L[0], b = L[L.length - 1], span = b.t - a.t; if (span < 0.02) return null;
    const g = geometry(this.p);
    const PA = (b.prod - a.prod) / span;                         // g m⁻² d⁻¹
    const photons = (b.photons - a.photons) / span;              // mol m⁻² d⁻¹
    const yieldPh = photons > 0 ? PA / photons : 0;              // g mol⁻¹
    const PE = photons > 0 ? PA * E_BIOMASS / (photons / PAR_UMOL_PER_J * 1e3) * 100 : 0;   // % of PAR energy
    return { span, PA, PV: PA / (1000 * g.VA), photons, yieldPh, PE, energy: (b.energy - a.energy) / span };
  }
}

/* ------------------------------------------------------------------ steady-state analysis */
/** Constant incident light: productivity as a function of biomass (parametric in X). Returns rows {X, D, PV, PA}. */
export function steadyConst(p, I0ground, nX = 90) {
  const s = Object.assign({}, STRAINS[p.strain], { Iopt: p.Iopt, ka: p.ka, r: p.resp }), g = geometry(p), phi = ctmi(p.T, s);
  const rows = [];
  for (let i = 0; i <= nX; i++) {
    const X = Math.pow(10, -3 + 4.3 * i / nX);                             // 0.001 … 20 g L⁻¹
    const D = muAvg(I0ground * g.Ifac, X, p, s, g) * phi - s.r;
    rows.push({ X, D, PV: D * X, PA: D * X * 1000 * g.VA });
  }
  return rows;
}
/** Diurnal (sun) light: cyclic steady state for a list of dilution rates via day-by-day simulation. */
export function steadySun(p, Ds, days = 18) {
  const out = [];
  for (const D of Ds) {
    const c = new Culture(Object.assign({}, p, { mode: 'cont', D, X0: 0.3 }));
    const dt = 1 / 48; let X = c.X, prod = 0, ph = 0, Xsum = 0, n = 0;
    const s = c.strain(), g = geometry(c.p), phi = ctmi(p.T, s);
    const grossAt = (t, x) => muAvg(ppfdAt(t, c.p) * g.Ifac, x, c.p, s, g) * phi;
    for (let k = 0; k < days * 48; k++) {
      const t = k * dt;
      const f = (tt, x) => (grossAt(tt, x) - s.r - D) * x;
      const k1 = f(t, X), k2 = f(t + dt / 2, X + dt / 2 * k1), k3 = f(t + dt / 2, X + dt / 2 * k2), k4 = f(t + dt, X + dt * k3);
      const Xn = Math.max(1e-6, X + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4));
      if (k >= (days - 3) * 48) { prod += D * 0.5 * (X + Xn) * dt; ph += ppfdAt(t + dt / 2, c.p) * 86400e-6 * dt; Xsum += 0.5 * (X + Xn); n++; }
      X = Xn;
    }
    const PV = prod / 3, PA = PV * 1000 * g.VA, photons = ph / 3;
    out.push({ D, X: Xsum / Math.max(1, n), PV, PA, photons, PE: photons > 0 ? PA * E_BIOMASS / (photons / PAR_UMOL_PER_J * 1e3) * 100 : 0 });
  }
  return out;
}
export { doSaturation, dayLength };
