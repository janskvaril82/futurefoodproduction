/* High-moisture extrusion — process model (pure functions, no DOM).
   Co-rotating twin-screw extruder (D = 26 mm, L/D ≈ 29, 7 barrel sections, geometry of the
   lab-scale machine used by Wittek et al. 2021) + slit cooling die.
   Equations are documented in the Derive tab (E1–E10). Units: SI unless stated. */

export const G = {
  D: 0.026,            // outer screw diameter, m
  a: 0.021,            // centre-line distance, m
  clr: 0.0002,         // radial tip clearance, m
  nSec: 7,
  secLen: 0.108,       // barrel section length, m (7 × 0.108 = 0.756 m ≈ 29 D)
  Wd: 0.030,           // cooling-die channel width, m
  xWater: 0.140,       // water-injection port (section 2), m
  adapter: 0.035       // die adapter + breaker plate length, m (adiabatic)
};
G.R = G.D / 2; G.Rb = G.R + G.clr; G.L = G.nSec * G.secLen; G.h = 2 * G.R - G.a; // flight depth

/* ---------- Erdmenger self-wiping 2-flight profile (Booy 1978 construction) ---------- */
const PSI = Math.PI / 2 - 2 * Math.acos(G.a / (2 * G.R));   // tip (and root) angle
const PHIF = 2 * Math.acos(G.a / (2 * G.R));                // flank angular span
const flank = f => Math.sqrt(G.a * G.a - G.R * G.R * Math.sin(f) ** 2) - G.R * Math.cos(f);
/** Radius of the screw profile at polar angle θ (rad), tip centred at θ = 0, period π. */
export function profileR(theta) {
  let t = ((theta % Math.PI) + Math.PI) % Math.PI;
  if (t <= PSI / 2) return G.R;
  t -= PSI / 2;
  if (t <= PHIF) return flank(PHIF - t);          // tip → root
  t -= PHIF;
  if (t <= PSI) return G.a - G.R;                 // root
  t -= PSI;
  if (t <= PHIF) return flank(t);                 // root → tip
  return G.R;
}
// areas and perimeters (numerical integration)
(function () {
  let As = 0; const n = 4000;
  for (let i = 0; i < n; i++) { const r = profileR((i + 0.5) / n * 2 * Math.PI); As += 0.5 * r * r * (2 * Math.PI / n); }
  const Rb = G.Rb, c = G.a / 2;
  const lens = 2 * Rb * Rb * Math.acos(c / Rb) - c * Math.sqrt(Rb * Rb - c * c);
  G.Ascrew = As;                                   // one screw cross-section, m²
  G.Abore = 2 * Math.PI * Rb * Rb - lens;          // figure-eight bore, m²
  G.Afree = G.Abore - 2 * As;                      // free cross-section, m²
  G.Pw = 2 * Rb * (2 * Math.PI - 2 * Math.acos(c / Rb)); // wetted bore perimeter, m
})();

/* ---------- screw configuration ---------- */
// type: conv (conveying, pitch t), kb45 (forward kneading block, 45° stagger), kb90 (neutral kneading block), pb (pressure build-up, fully filled)
export const SCREW = [
  { type: 'conv', x0: 0.000, x1: 0.160, pitch: 0.039 },
  { type: 'conv', x0: 0.160, x1: 0.246, pitch: 0.026 },
  { type: 'kb45', x0: 0.246, x1: 0.285, pitch: 0.026 },
  { type: 'conv', x0: 0.285, x1: 0.460, pitch: 0.026 },
  { type: 'kb45', x0: 0.460, x1: 0.486, pitch: 0.026 },
  { type: 'kb90', x0: 0.486, x1: 0.512, pitch: 0.026 },
  { type: 'conv', x0: 0.512, x1: 0.704, pitch: 0.026 },
  { type: 'pb', x0: 0.704, x1: 0.756, pitch: 0.026 }
];
const SHEAR = { conv: 1.0, kb45: 2.5, kb90: 3.5, pb: 1.0 };   // effective shear-rate factor S
export function elementAt(x) { for (const e of SCREW) if (x >= e.x0 && x < e.x1) return e; return SCREW[SCREW.length - 1]; }

/* ---------- raw materials ---------- */
// dry-matter composition (protein, carbohydrate incl. fibre, fat, ash); window parameters are semi-quantitative
export const MATERIALS = {
  spc: { label: 'Soy protein concentrate (SPC)', wp: 0.07, comp: { p: 0.70, c: 0.20, f: 0.02, a: 0.08 }, Kf: 1.0, Ton: 125, Tup: 168, Xlo: 0.40, Xhi: 0.72, colour: [0.87, 0.76, 0.56] },
  ppi: { label: 'Pea protein isolate (PPI)', wp: 0.07, comp: { p: 0.84, c: 0.06, f: 0.04, a: 0.06 }, Kf: 0.85, Ton: 131, Tup: 163, Xlo: 0.43, Xhi: 0.68, colour: [0.90, 0.80, 0.58] }
};

/* ---------- thermophysical properties: Choi & Okos (1986) ---------- */
const CO = {
  w: { k: T => 0.57109 + 1.7625e-3 * T - 6.7036e-6 * T * T, r: T => 997.18 + 3.1439e-3 * T - 3.7574e-3 * T * T, c: T => 4.1762 - 9.0864e-5 * T + 5.4731e-6 * T * T },
  p: { k: T => 0.17881 + 1.1958e-3 * T - 2.7178e-6 * T * T, r: T => 1329.9 - 0.5184 * T, c: T => 2.0082 + 1.2089e-3 * T - 1.3129e-6 * T * T },
  c: { k: T => 0.20141 + 1.3874e-3 * T - 4.3312e-6 * T * T, r: T => 1599.1 - 0.31046 * T, c: T => 1.5488 + 1.9625e-3 * T - 5.9399e-6 * T * T },
  f: { k: T => 0.18071 - 2.7604e-4 * T - 1.7749e-7 * T * T, r: T => 925.59 - 0.41757 * T, c: T => 1.9842 + 1.4733e-3 * T - 4.8008e-6 * T * T },
  a: { k: T => 0.32962 + 1.4011e-3 * T - 2.9069e-6 * T * T, r: T => 2423.8 - 0.28063 * T, c: T => 1.0926 + 1.8896e-3 * T - 3.6817e-6 * T * T }
};
/** Properties of a protein–water mixture at moisture X (wet basis) and temperature T (°C). Returns {cp (J kg⁻¹ K⁻¹), rho, k, alpha}. */
export function props(mat, X, T) {
  const m = MATERIALS[mat], d = m.comp; const Tc = Math.min(150, Math.max(0, T)); // correlations fitted −40…150 °C
  const x = { w: X, p: (1 - X) * d.p, c: (1 - X) * d.c, f: (1 - X) * d.f, a: (1 - X) * d.a };
  let cp = 0, inv = 0; for (const i in x) { cp += x[i] * CO[i].c(Tc); inv += x[i] / CO[i].r(Tc); }
  const rho = 1 / inv; let k = 0; for (const i in x) k += (x[i] / CO[i].r(Tc)) / inv * CO[i].k(Tc);
  return { cp: cp * 1000, rho, k, alpha: k / (rho * cp * 1000) };
}

/* ---------- melt rheology (power law + Arrhenius + moisture; form after Harper 1981, Morgan et al. 1989) ---------- */
export const RHEO = { Kref: 5200, n: 0.4, EaR: 4000, beta: 7.0, Xref: 0.5, Tref: 408.15 };
/** Temperature above which the hydrated protein behaves as a melt (below it the dough stiffness is frozen at this value). */
export const Tflow = X => 85 + 80 * Math.max(0, 0.55 - X);
export function consistency(mat, X, T) {
  const Te = Math.max(T, Tflow(X)) + 273.15;
  return RHEO.Kref * MATERIALS[mat].Kf * Math.exp(RHEO.EaR * (1 / Te - 1 / RHEO.Tref)) * Math.exp(-RHEO.beta * (X - RHEO.Xref));
}

/* ---------- barrel temperature profile ---------- */
/** Set-points of the 7 sections from the cooking-zone temperature Tc (°C). Section 1 is water cooled. */
export function barrelSetpoints(Tc) {
  const s4 = Math.min(Tc, 60 + 0.35 * (Tc - 60));
  return [25, Math.min(40, Tc), Math.min(60, Tc), Math.max(Math.min(60, Tc), s4), Math.max(s4, Tc - 10), Math.max(s4, Tc - 5), Tc];
}

export const HEAT = { U: 800, Twater: 20, Tpowder: 20, rhoBulk: 450, Tmax: 120 /* N m, assumed drive torque limit (both shafts) */ };

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Steady-state solution along the barrel.
 * p: { mat, Qs (kg h⁻¹ powder), X (0–1 wet basis), N (rpm), zones: [7 actual barrel temperatures °C], Tcd (°C), Ld (m), Hd (m) }
 */
export function solve(p) {
  const mat = MATERIALS[p.mat];
  const ms = p.Qs / 3600;                                  // powder mass flow, kg s⁻¹
  const X = Math.max(p.X, mat.wp + 1e-3);
  const mw = ms * (X - mat.wp) / (1 - X);                  // (E1) water pump rate, kg s⁻¹
  const mt = ms + mw;
  const Ns = p.N / 60;                                     // rev s⁻¹
  const dx = 0.002, nx = Math.round(G.L / dx);
  const xs = [], T = [], fill = [], Tbx = [], state = [], diss = [];
  let Tm = HEAT.Tpowder, P = 0, Qbarrel = 0, hold = 0, tres = 0, xMelt = null;
  for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * dx; const sec = Math.min(G.nSec - 1, Math.floor(x / G.secLen));
    const Tb = p.zones[sec]; const el = elementAt(x);
    const wet = x >= G.xWater;
    if (wet && i > 0 && xs[i - 1] < G.xWater) {             // mixing with injected water
      const pr0 = props(p.mat, mat.wp, Tm), cpw = 4186;
      Tm = (ms * pr0.cp * Tm + mw * cpw * HEAT.Twater) / (ms * pr0.cp + mw * cpw);
    }
    const Xl = wet ? X : mat.wp; const mdot = wet ? mt : ms;
    const pr = props(p.mat, Xl, Tm);
    const rho = wet ? pr.rho : HEAT.rhoBulk;
    const Qv = mdot / rho;
    const Qmax = 0.5 * G.Afree * el.pitch * Ns;             // (E5) drag capacity of a conveying element
    let f;
    if (el.type === 'conv') f = Math.min(1, Qv / Qmax);
    else if (el.type === 'kb45') f = Math.min(1, 0.35 + 1.5 * Qv / Qmax);
    else f = 1;
    let phi = 0;
    if (wet) {
      const gam = SHEAR[el.type] * Math.PI * G.D * Ns / G.h;  // (E4) effective shear rate
      const K = consistency(p.mat, X, Tm);
      phi = K * Math.pow(gam, RHEO.n + 1);                   // dissipation per unit filled volume, W m⁻³
    }
    const qv = phi * G.Afree * f;                            // W per m of barrel
    const UA = HEAT.U * G.Pw * (0.6 + 0.4 * f);              // W m⁻¹ K⁻¹
    const qw = UA * (Tb - Tm);
    Tm += (qw + qv) * dx / (mdot * pr.cp);                   // (E6) energy balance
    P += qv * dx; Qbarrel += qw * dx;
    hold += G.Afree * f * dx * rho; tres += G.Afree * f * dx / Qv;
    if (wet && xMelt == null && Tm >= Tflow(X)) xMelt = x;
    xs.push(x); T.push(Tm); fill.push(f); Tbx.push(Tb); diss.push(qv); state.push(!wet ? 0 : (Tm >= Tflow(X) ? 2 : 1));
  }
  const prM = props(p.mat, X, Tm);
  const Qv = mt / prM.rho;
  tres += G.Afree * G.adapter / Qv;
  // ---- cooling die (E8): transient conduction in a slab, plug-flow time
  const H = p.Hd, W = G.Wd, Ld = p.Ld;
  const ubar = Qv / (W * H);
  const tdie = Ld / ubar;
  const Tin = Tm, Tw = p.Tcd;
  const prD = props(p.mat, X, 0.5 * (Tin + Tw));
  const alpha = prD.alpha;
  const theta = (yRel, t) => { let s = 0; for (let n = 0; n < 40; n++) { const k = 2 * n + 1; s += 4 * (n % 2 ? -1 : 1) / (k * Math.PI) * Math.cos(k * Math.PI * yRel) * Math.exp(-k * k * Math.PI * Math.PI * alpha * t / (H * H)); } return Math.min(1, s); };
  const thetaMean = t => { let s = 0; for (let n = 0; n < 40; n++) { const k = 2 * n + 1; s += 8 / (k * k * Math.PI * Math.PI) * Math.exp(-k * k * Math.PI * Math.PI * alpha * t / (H * H)); } return Math.min(1, s); };
  const die = { x: [], core: [], mean: [] };
  for (let j = 0; j <= 40; j++) { const xx = Ld * j / 40, t = xx / ubar; die.x.push(xx); die.core.push(Tw + (Tin - Tw) * (j === 0 ? 1 : theta(0, t))); die.mean.push(Tw + (Tin - Tw) * (j === 0 ? 1 : thetaMean(t))); }
  const Tcore = die.core[40], Tmean = die.mean[40];
  // temperature field for the 3-D die (rows = across gap, cols = along die)
  const field = []; for (let r = 0; r < 16; r++) { const yRel = (r + 0.5) / 16 - 0.5; const row = []; for (let c = 0; c < 48; c++) { const t = (c + 0.5) / 48 * tdie; row.push(Tw + (Tin - Tw) * theta(yRel, t)); } field.push(row); }
  const tTotal = tres + tdie;
  const SME = P / mt;                                      // (E2) J kg⁻¹
  const torque = P / (2 * Math.PI * Ns);                   // N m (both shafts)
  const out = classify(p.mat, X, Tin, Tcore, p.Tcd, tTotal, p.N, H);
  return {
    X, ms, mw, mt, Ns, xs, T, fill, Tbx, state, diss, xMelt,
    Tmelt: Tin, P, SME, SMEkWh: SME / 3600, torque, torquePct: 100 * torque / HEAT.Tmax,
    STE: Qbarrel / mt, Qbarrel, hold, tBarrel: tres, tDie: tdie, tTotal, ubar, alpha, die, Tcore, Tmean,
    Qcool: mt * prD.cp * (Tin - Tmean), field, props: prM, ...out
  };
}

/**
 * Semi-quantitative texture outcome from the process window (E9, E10).
 * Tm: melt temperature at die inlet, Tex: core temperature at die exit, Tcd: coolant, t: total residence time (s).
 */
export function classify(mat, X, Tm, Tex, Tcd, t, N = 250, H = 0.006) {
  const m = MATERIALS[mat];
  const Tup = (m.Tup + 30 * Math.max(0, 0.45 - X) / 0.2) - 10 * Math.log2(Math.max(10, t) / 60);  // (E10) thermal-load correction
  const Ton = m.Ton + 40 * Math.max(0, 0.45 - X);
  const sT = smooth(Ton - 8, Ton + 8, Tm) * (1 - smooth(Tup - 6, Tup + 6, Tm));
  const sX = smooth(m.Xlo - 0.04, m.Xlo + 0.04, X) * (1 - smooth(m.Xhi - 0.04, m.Xhi + 0.04, X));
  const exp_ = smooth(96, 104, Tex);
  const cool = 1 - 0.6 * smooth(60, 95, Tcd);
  const sFib = sT * sX * (1 - exp_) * cool;
  const burn = smooth(Tup - 2, Tup + 10, Tm);
  let cls, why = '', reason;
  if (burn > 0.5) { cls = reason = 'burnt'; why = 'melt above the degradation limit for this residence time: browning, cross-linking, off-flavour'; }
  else if (exp_ > 0.5) { cls = reason = 'expanded'; why = 'core leaves the die above 100 °C: superheated water flashes to steam'; }
  else if (sFib > 0.45) { cls = reason = 'fibrous'; why = 'melt fully plasticised and set from the wall inwards below 100 °C in laminar flow'; }
  else {
    cls = 'none';
    // report the most limiting factor
    const lim = [
      [smooth(Ton - 8, Ton + 8, Tm), 'melt too cold: proteins not fully denatured and plasticised', 'cold'],
      [1 - smooth(Tup - 6, Tup + 6, Tm), 'melt too hot: texture degrades before the die', 'hot'],
      [smooth(m.Xlo - 0.04, m.Xlo + 0.04, X), 'too dry: dense, hard, isotropic extrudate', 'dry'],
      [1 - smooth(m.Xhi - 0.04, m.Xhi + 0.04, X), 'too wet: weak, pasty gel without fibres', 'wet'],
      [(1 - exp_) * cool, 'die too warm: the structure does not set before the exit', 'die']
    ].sort((u, v) => u[0] - v[0]);
    why = lim[0][1]; reason = lim[0][2];
  }
  const fineness = Math.pow(N / 250, -0.35) * Math.sqrt(H / 0.006);   // relative fibre thickness (visual)
  const AI = 0.95 + 0.72 * sFib * (0.85 + 0.15 * smooth(150, 700, N)) + (cls === 'expanded' ? 0.08 : 0);
  const brown = Math.min(1, Math.max(0, (Tm - 110) / (Tup + 10 - 110)) ** 1.6 * Math.min(1.6, Math.max(0.6, t / 90)));
  return { cls, why, reason, AI, sFib, sT, sX, burn, exp: exp_, Ton, Tup, fineness, brown };
}

/** Exit core temperature for a hypothetical melt (used by the process-window map). */
export function exitCore(mat, X, Tin, p, mt) {
  const pr = props(mat, X, 0.5 * (Tin + p.Tcd));
  const ubar = (mt / pr.rho) / (G.Wd * p.Hd); const t = p.Ld / ubar;
  let s = 0; for (let n = 0; n < 30; n++) { const k = 2 * n + 1; s += 4 * (n % 2 ? -1 : 1) / (k * Math.PI) * Math.exp(-k * k * Math.PI * Math.PI * pr.alpha * t / (p.Hd * p.Hd)); }
  return p.Tcd + (Tin - p.Tcd) * Math.min(1, s);
}
