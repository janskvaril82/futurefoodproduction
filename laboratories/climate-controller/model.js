/* Climate controller tuning — chamber model, controllers and tuning experiments (no DOM, no three.js).
   Chamber: two-node thermal RC network (air + fast internal mass | slow mass: panel skins, floor, nutrient
   solution) with first-order heater/evaporator dynamics, a transport dead time, a first-order sensor,
   a humidity balance with an ultrasonic humidifier (adiabatic evaporation) and buoyancy-driven air exchange
   through the open door (Brown & Solvason, 1962). Controllers: two-stage thermostat with hysteresis,
   P, PI, PID (derivative on measurement, first-order derivative filter, back-calculation anti-windup;
   Åström & Hägglund, 2006) and a brute-force model predictive controller with move blocking,
   a disturbance observer (steady-state Kalman filter) and scheduled-disturbance feed-forward. */

export const P0 = Object.freeze({
  L: 3.0, B: 2.4, H: 2.5,          // interior length, width, height (m)
  rho: 1.2, cp: 1005,              // air density (kg m⁻³), specific heat (J kg⁻¹ K⁻¹)
  Cfast: 30e3,                     // J K⁻¹ fast internal mass lumped with the air (shelves, trays, leaves, housings)
  Cm: 1.0e6,                       // J K⁻¹ slow mass (inner panel skins, floor slab surface, nutrient solution)
  Ham: 250,                        // W K⁻¹ convective conductance air ↔ slow mass
  Henv: 12,                        // W K⁻¹ conduction through the insulated envelope (slow mass ↔ corridor)
  ach: 0.5,                        // h⁻¹ infiltration / fresh-air exchange
  Ph: 2000, tauH: 20,              // heater: electric power (W), element time constant (s)
  Qc: 2500, SHR: 0.8, tauC: 45, COP: 3.0, // evaporator: total capacity (W), sensible heat ratio, time constant (s), COP
  Pfan: 120,                       // W evaporator fans (always on) — heat released in the chamber
  Pled: 650, fConv: 0.6,           // W LED electrical power; convective fraction of the sensible LED heat
  Etr: 0.30, EtrDark: 0.03,        // kg h⁻¹ canopy transpiration, lights on / off
  Hum: 0.4,                        // kg h⁻¹ humidifier output
  theta: 20, tauS: 20, sigma: 0.03,// transport dead time (s), sensor time constant (s), sensor noise SD (°C)
  doorW: 0.9, doorH: 2.0, Cd: 0.6, // door opening (m) and discharge coefficient
  lambda: 2.45e6, Patm: 101.325    // latent heat (J kg⁻¹), air pressure (kPa)
});
export const derived = P => {
  const V = P.L * P.B * P.H;
  return { V, mAir: P.rho * V, Ca: P.rho * P.cp * V + P.Cfast, Hinf: P.rho * P.cp * V * P.ach / 3600 };
};

/* ------------------------------------------------------------------ psychrometrics (as physics.js) */
export const svp = T => 0.6108 * Math.exp(17.27 * T / (T + 237.3));                 // kPa (Tetens/FAO-56)
export const wFromRH = (T, rh, P = 101.325) => { const e = svp(T) * rh / 100; return 0.62198 * e / (P - e); };
export const rhFromW = (T, W, P = 101.325) => 100 * (W * P / (0.62198 + W)) / svp(T);

/* ------------------------------------------------------------------ scenario (standard test day) */
export const SC = Object.freeze({
  tEnd: 14400, tStep: 600, r0: 16, r1: 22,
  tLightsOn: 3600, tLightsOff: 12000,
  tCorr0: 6000, tCorr1: 6600, Tc0: 20, Tc1: 10,
  tDoor: 9000, doorDur: 120, RHcorr: 40, RHset: 70, RHband: 3
});
/** Scheduled conditions at time t. opt = { lights, corridor, door, extraDoors:[t0…] } */
export function scenario(t, opt = {}) {
  const r = t < SC.tStep ? SC.r0 : SC.r1;
  const lights = opt.lights !== false && t >= SC.tLightsOn && t < SC.tLightsOff;
  let Tc = SC.Tc0;
  if (opt.corridor !== false) Tc = t < SC.tCorr0 ? SC.Tc0 : t > SC.tCorr1 ? SC.Tc1 : SC.Tc0 + (SC.Tc1 - SC.Tc0) * (t - SC.tCorr0) / (SC.tCorr1 - SC.tCorr0);
  let door = opt.door !== false && t >= SC.tDoor && t < SC.tDoor + SC.doorDur;
  if (opt.extraDoors) for (const t0 of opt.extraDoors) if (t >= t0 && t < t0 + 60) door = true;
  return { r, lights, Tc, door };
}

/* ------------------------------------------------------------------ plant */
/** Door air exchange (m³ s⁻¹): two-way buoyancy flow through a vertical opening (Brown & Solvason, 1962). */
export function doorFlow(P, Ta, Tc) {
  const dT = Math.abs(Ta - Tc), Tm = (Ta + Tc) / 2 + 273.15;
  return P.Cd / 3 * P.doorW * P.doorH * Math.sqrt(9.81 * P.doorH * dT / Tm);
}
export function makePlant(P, T0 = SC.r0, opt = {}) {
  const Tc = scenario(0, opt).Tc;
  const d = derived(P);
  // steady state at T0 with lights off: cooling needed to balance fans and corridor gains
  const Hser = 1 / (1 / P.Ham + 1 / P.Henv);
  const load = P.Pfan - (d.Hinf + Hser) * (T0 - Tc);            // W sensible that must be removed (>0 → cooling)
  const Tm = T0 - (T0 - Tc) * Hser / P.Ham;                       // mass node between air and corridor
  const Qc0 = Math.max(0, load / (1 - latentFraction(70))), Qh0 = Math.max(0, -load);
  const W0 = wFromRH(T0, 70, P.Patm);
  return {
    t: 0, Ta: T0, Tm, Qh: Qh0, Qc: Qc0, Ts: T0, W: W0, rh: 70, Vdoor: 0,
    buf: [], hum: false, E: { heat: 0, cool: 0 },
    u0: Qh0 > 0 ? 100 * Qh0 / P.Ph : -100 * Qc0 / P.Qc
  };
}
/** Continuous-time derivatives. inp = { Pcmd, Ccmd (delayed commands, W), lights, Tc, door, hum } */
function deriv(s, inp, P, d) {
  const Tc = inp.Tc;
  const Wc = wFromRH(Tc, SC.RHcorr, P.Patm);
  const Vdoor = inp.door ? doorFlow(P, s.Ta, Tc) : 0;
  const Hdoor = P.rho * P.cp * Vdoor, mEx = P.rho * Vdoor + d.Hinf / P.cp;
  const E = (inp.lights ? P.Etr : P.EtrDark) / 3600;              // kg s⁻¹ transpiration
  const mHum = inp.hum ? P.Hum / 3600 : 0;                         // kg s⁻¹ humidifier
  const rh = rhFromW(s.Ta, s.W, P.Patm);
  const lat = latentFraction(rh);                                   // share of evaporator capacity spent on condensing water
  const mCond = lat * s.Qc / P.lambda;                             // kg s⁻¹ condensate on the evaporator coil
  const Wsat = wFromRH(s.Ta, 99, P.Patm);
  const mDew = s.W > Wsat ? (s.W - Wsat) * d.mAir / 30 : 0;        // kg s⁻¹ dew on the coldest surfaces (cap at saturation)
  const QledSens = inp.lights ? P.Pled - P.lambda * E : 0;         // W sensible (latent part leaves as vapour)
  const Qair = s.Qh - (1 - lat) * s.Qc + P.Pfan + P.fConv * QledSens - P.lambda * mHum + (inp.dExtra || 0);
  const dTa = (Qair - P.Ham * (s.Ta - s.Tm) - (d.Hinf + Hdoor) * (s.Ta - Tc)) / d.Ca;
  const dTm = (P.Ham * (s.Ta - s.Tm) + (1 - P.fConv) * QledSens + P.lambda * mDew - P.Henv * (s.Tm - Tc)) / P.Cm;
  const dQh = (inp.Pcmd - s.Qh) / P.tauH;
  const dQc = (inp.Ccmd - s.Qc) / P.tauC;
  const dTs = (s.Ta - s.Ts) / P.tauS;
  const dW = (E + mHum - mCond - mDew + mEx * (Wc - s.W)) / d.mAir;
  return [dTa, dTm, dQh, dQc, dTs, dW, Vdoor];
}
/** Latent share of the evaporator's total capacity as a function of relative humidity (coil dehumidifies more in humid air). */
export const latentFraction = rh => Math.min(0.5, Math.max(0.05, 0.1 + 0.4 * (rh - 50) / 50));
const KEYS = ['Ta', 'Tm', 'Qh', 'Qc', 'Ts', 'W'];
/**
 * Advance the plant by dt (s) with controller output u (−100…100 %) held constant.
 * The command enters a dead-time buffer (1-s resolution) before reaching the actuators.
 */
export function plantStep(s, u, dt, P, env) {
  const d = derived(P);
  const Pcmd = Math.max(0, u) / 100 * P.Ph, Ccmd = Math.max(0, -u) / 100 * P.Qc;
  // dead time: push the current command, read the command issued theta seconds ago
  s.buf.push([Pcmd, Ccmd]);
  const lag = Math.round(P.theta);
  while (s.buf.length > lag + 1) s.buf.shift();
  const [Pd, Cd] = s.buf[0];
  // humidifier: on/off with hysteresis on relative humidity
  const rh = rhFromW(s.Ta, s.W, P.Patm);
  if (env.humLoop === false) s.hum = false;
  else if (rh < SC.RHset - SC.RHband) s.hum = true; else if (rh > SC.RHset + SC.RHband) s.hum = false;
  const inp = { Pcmd: Pd, Ccmd: Cd, lights: env.lights, Tc: env.Tc, door: env.door, hum: s.hum, dExtra: env.dExtra };
  const x0 = KEYS.map(k => s[k]);
  const f = x => { const o = {}; KEYS.forEach((k, i) => o[k] = x[i]); return deriv(o, inp, P, d); };
  const k1 = f(x0), k2 = f(x0.map((v, i) => v + dt / 2 * k1[i])), k3 = f(x0.map((v, i) => v + dt / 2 * k2[i])), k4 = f(x0.map((v, i) => v + dt * k3[i]));
  KEYS.forEach((k, i) => { s[k] = x0[i] + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]); });
  s.Vdoor = k1[6];
  s.E.heat += Pcmd * dt; s.E.cool += Ccmd / P.COP * dt;           // J electricity (commanded)
  s.Pcmd = Pcmd; s.Ccmd = Ccmd; s.t += dt;
  s.rh = rhFromW(s.Ta, s.W, P.Patm);
  return s;
}

/* ------------------------------------------------------------------ controllers */
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
/** Two-stage thermostat (heat stage and cool stage) with hysteresis h around the set-point. */
export class OnOff {
  constructor({ h = 0.3 } = {}) { this.h = h; this.heat = false; this.cool = false; this.Ts = 2; }
  reset() { this.heat = this.cool = false; }
  step(y, r) {
    const h = this.h;
    if (y < r - h) this.heat = true; else if (y >= r) this.heat = false;
    if (y > r + h) this.cool = true; else if (y <= r) this.cool = false;
    if (this.heat && this.cool) this.cool = false;
    return this.heat ? 100 : this.cool ? -100 : 0;
  }
}
/**
 * Discrete PID, ideal (standard) form: u = u0 + Kc [e + (1/Ti)∫e dt − Td dy_f/dt], derivative on the
 * measurement with a first-order filter Tf = Td/N (backward difference), back-calculation anti-windup
 * with tracking time Tt (= Ti for PI, √(Ti·Td) for PID).
 */
export class PID {
  constructor({ Kc = 20, Ti = 300, Td = 0, N = 10, Ts = 2, aw = true, mode = 'PI', u0 = 0, uInit = 0 } = {}) {
    Object.assign(this, { Kc, Ti, Td, N, Ts, aw, mode, u0 });
    this.reset(uInit);
  }
  reset(uInit = 0) { this.I = this.mode === 'P' ? 0 : uInit - this.u0; this.D = 0; this.yPrev = null; this.terms = { P: 0, I: 0, D: 0 }; }
  step(y, r) {
    const { Kc, Ti, N, Ts } = this; const Td = this.mode === 'PID' ? this.Td : 0;
    if (this.yPrev === null) this.yPrev = y;
    const e = r - y;
    const P = Kc * e;
    if (Td > 0) { const Tf = Td / N; this.D = (Tf / (Tf + Ts)) * this.D - (Kc * Td / (Tf + Ts)) * (y - this.yPrev); } else this.D = 0;
    const I = this.mode === 'P' ? 0 : this.I;
    const v = this.u0 + P + I + this.D;
    const u = clamp(v, -100, 100);
    if (this.mode !== 'P') {
      const Tt = Td > 0 ? Math.sqrt(Ti * Td) : Ti;
      this.I += Kc * Ts / Ti * e + (this.aw ? Ts / Tt * (u - v) : 0);
    }
    this.yPrev = y; this.terms = { P, I, D: this.D };
    return u;
  }
}

/* ------------------------------------------------------------------ small linear algebra */
const zeros = (r, c) => Array.from({ length: r }, () => new Array(c).fill(0));
const matMul = (A, B) => { const r = A.length, c = B[0].length, k = B.length; const C = zeros(r, c); for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) { let s = 0; for (let m = 0; m < k; m++) s += A[i][m] * B[m][j]; C[i][j] = s; } return C; };
const matAdd = (A, B, b = 1) => A.map((row, i) => row.map((v, j) => v + b * B[i][j]));
const eye = n => { const I = zeros(n, n); for (let i = 0; i < n; i++) I[i][i] = 1; return I; };
/** Matrix exponential by scaling and squaring with a 14-term Taylor series (small, well-scaled matrices). */
export function expm(A) {
  const n = A.length; let norm = 0; for (const row of A) norm = Math.max(norm, row.reduce((s, v) => s + Math.abs(v), 0));
  const sPow = Math.max(0, Math.ceil(Math.log2(norm)) + 1); const As = A.map(r => r.map(v => v / Math.pow(2, sPow)));
  let E = eye(n), term = eye(n);
  for (let k = 1; k <= 14; k++) { term = matMul(term, As).map(r => r.map(v => v / k)); E = matAdd(E, term); }
  for (let i = 0; i < sPow; i++) E = matMul(E, E);
  return E;
}

/* ------------------------------------------------------------------ linear model for MPC & analysis */
/**
 * Linear chamber model with states x = [Ta, Tm, Ts, Qh, Qc] and inputs
 * v = [Pcmd, Ccmd, Qair (known heat to air), Qmass (known heat to mass), Tc, d (unknown heat to air)].
 * Returns discrete matrices for sample time dt: x+ = A x + B v.
 */
export function linearModel(P, dt, scale = 1) {
  const d = derived(P); const Ca = d.Ca * scale, Cm = P.Cm * scale;
  const Ac = [
    [-(P.Ham + d.Hinf) / Ca, P.Ham / Ca, 0, 1 / Ca, -P.SHR / Ca],
    [P.Ham / Cm, -(P.Ham + P.Henv) / Cm, 0, 0, 0],
    [1 / P.tauS, 0, -1 / P.tauS, 0, 0],
    [0, 0, 0, -1 / P.tauH, 0],
    [0, 0, 0, 0, -1 / P.tauC]
  ];
  const Bc = [
    [0, 0, 1 / Ca, 0, d.Hinf / Ca, 1 / Ca],
    [0, 0, 0, 1 / Cm, P.Henv / Cm, 0],
    [0, 0, 0, 0, 0, 0],
    [1 / P.tauH, 0, 0, 0, 0, 0],
    [0, 1 / P.tauC, 0, 0, 0, 0]
  ];
  const n = 5, m = 6; const M = zeros(n + m, n + m);
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) M[i][j] = Ac[i][j] * dt; for (let j = 0; j < m; j++) M[i][n + j] = Bc[i][j] * dt; }
  const E = expm(M);
  return { A: E.slice(0, n).map(r => r.slice(0, n)), B: E.slice(0, n).map(r => r.slice(n)), n, m };
}
/** Known sensible heat to air and to the slow mass (W) for a scheduled lights state (humidifier unknown). */
export function knownHeat(P, lights) {
  const QledSens = lights ? P.Pled - P.lambda * P.Etr / 3600 : 0;
  return { air: P.Pfan + P.fConv * QledSens, mass: (1 - P.fConv) * QledSens };
}

/**
 * Model predictive controller (brute force over move-blocked input sequences).
 *  - internal model: linearModel(P̂) on a 2-s grid with the dead time (known), scaled heat capacities (model error)
 *  - observer: steady-state Kalman filter for [Ta, Tm, Ts, d] (d = unmeasured heat load, random walk)
 *  - prediction: superposition of the free response and unit responses of each input block
 *  - cost: Σ (T̂a − r)² Δt/3600 + wE · E_el[kWh] + wD Σ (Δu/100)²
 */
export class MPC {
  constructor(P, { N = 30, wE = 0.2, wD = 0.02, dtC = 20, scale = 1, opt = {} } = {}) {
    Object.assign(this, { P, N, wE, wD, dtC, scale, opt });
    this.Ts = 2; this.sub = Math.round(dtC / this.Ts);
    this.lm = linearModel(P, this.Ts, scale);
    this.delay = Math.round(P.theta / this.Ts);
    this.x = null; this.dhat = 0; this.buf = []; this.uPrev = 0; this.k = 0; this.plan = null;
    this._gain();
  }
  _gain() {
    // augmented 4-state system for the observer: [Ta, Tm, Ts, d]
    const A = this.lm.A, B = this.lm.B;
    const Aa = [[A[0][0], A[0][1], A[0][2], B[0][5]], [A[1][0], A[1][1], A[1][2], B[1][5]], [A[2][0], A[2][1], A[2][2], B[2][5]], [0, 0, 0, 1]];
    const Q = [[1e-5, 0, 0, 0], [0, 1e-7, 0, 0], [0, 0, 1e-8, 0], [0, 0, 0, 16]];
    const R = Math.max(1e-6, this.P.sigma ** 2 + 1e-5);
    let Pm = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1e4]];
    let K = [0, 0, 0, 0];
    for (let it = 0; it < 3000; it++) {
      Pm = matAdd(matMul(matMul(Aa, Pm), Aa.map((_, i) => Aa.map(r => r[i]))), Q);
      const S = Pm[2][2] + R; K = [0, 1, 2, 3].map(i => Pm[i][2] / S);
      Pm = Pm.map((row, i) => row.map((v, j) => v - K[i] * Pm[2][j]));
    }
    this.K = K; this.Aa = Aa;
  }
  reset(plant, uInit = 0) {
    this.x = [plant.Ta, plant.Tm, plant.Ts, plant.Qh, plant.Qc]; this.dhat = 0; this.uPrev = uInit; this.k = 0; this.plan = null;
    const Pc = Math.max(0, uInit) / 100 * this.P.Ph, Cc = Math.max(0, -uInit) / 100 * this.P.Qc;
    this.buf = new Array(this.delay).fill([Pc, Cc]);
    this.u = uInit;
  }
  /** Simulate the internal model: x0, command sequence per fine step (array of [P,C]), from time t. Returns Ta at each fine step. */
  _sim(x0, dhat, cmds, t, buf0, known = true) {
    const { A, B } = this.lm; let x = x0.slice(); const out = new Array(cmds.length); const buf = buf0.slice();
    for (let i = 0; i < cmds.length; i++) {
      buf.push(cmds[i]); const [Pd, Cd] = this.delay > 0 ? buf.shift() : buf.pop();
      const tt = t + i * this.Ts; let qa = 0, qm = 0, Tc = 0;
      if (known) { const sc = scenario(tt, this.opt); const kh = knownHeat(this.P, sc.lights); qa = kh.air; qm = kh.mass; Tc = this.TcMeas; }
      const v = [Pd, Cd, qa, qm, Tc, known ? dhat : 0];
      const xn = [0, 0, 0, 0, 0];
      for (let r = 0; r < 5; r++) { let s = 0; for (let c = 0; c < 5; c++) s += A[r][c] * x[c]; for (let c = 0; c < 6; c++) s += B[r][c] * v[c]; xn[r] = s; }
      x = xn; out[i] = x[0];
    }
    return out;
  }
  /** Kalman measurement update with the new sensor reading y (innovation on the sensor state). */
  _correct(y) {
    const innov = y - this.x[2];
    this.x[0] += this.K[0] * innov; this.x[1] += this.K[1] * innov; this.x[2] += this.K[2] * innov; this.dhat += this.K[3] * innov;
    this.innov = innov;
  }
  /** Time update over one 2-s sample with the command u applied from time t. */
  _predict(t, u) {
    const { A, B } = this.lm; const sc = scenario(t, this.opt); const kh = knownHeat(this.P, sc.lights);
    const Pc = Math.max(0, u) / 100 * this.P.Ph, Cc = Math.max(0, -u) / 100 * this.P.Qc;
    this.buf.push([Pc, Cc]); const [Pd, Cd] = this.delay > 0 ? this.buf.shift() : this.buf.pop();
    const v = [Pd, Cd, kh.air, kh.mass, this.TcMeas, this.dhat];
    const xn = [0, 0, 0, 0, 0];
    for (let r = 0; r < 5; r++) { let s = 0; for (let c = 0; c < 5; c++) s += A[r][c] * this.x[c]; for (let c = 0; c < 6; c++) s += B[r][c] * v[c]; xn[r] = s; }
    this.x = xn;
  }
  /** Called every Ts = 2 s with measurement y, time t, measured corridor temperature. Returns u. */
  step(y, r, t, Tc) {
    this.TcMeas = Tc;
    this._correct(y);
    if (this.k % this.sub === 0) this.u = this._optimise(t);
    this.k++;
    this._predict(t, this.u);
    return this.u;
  }
  _optimise(t) {
    const N = this.N, sub = this.sub, nF = N * sub, dtH = this.dtC / 3600;
    // block structure (in MPC steps): [0,1), [1, b2), [b2, N)
    const b2 = Math.max(2, Math.min(N - 1, 1 + Math.round((N - 1) / 3)));
    const blocks = [[0, 1], [1, b2], [b2, N]];
    const zero = new Array(nF).fill([0, 0]);
    const free = this._sim(this.x, this.dhat, zero, t, this.buf, true);
    const Sh = [], Sc = [];
    for (const [a, b] of blocks) {
      const ch = new Array(nF).fill(null).map((_, i) => { const k = Math.floor(i / sub); return k >= a && k < b ? [this.P.Ph / 100, 0] : [0, 0]; });
      const cc = new Array(nF).fill(null).map((_, i) => { const k = Math.floor(i / sub); return k >= a && k < b ? [0, this.P.Qc / 100] : [0, 0]; });
      const zeroBuf = this.buf.map(() => [0, 0]);
      Sh.push(this._sim([0, 0, 0, 0, 0], 0, ch, t, zeroBuf, false)); Sc.push(this._sim([0, 0, 0, 0, 0], 0, cc, t, zeroBuf, false));
    }
    // sample responses at the end of each MPC step
    const idx = Array.from({ length: N }, (_, k) => (k + 1) * sub - 1);
    const rr = idx.map(i => scenario(t + (i + 1) * this.Ts, this.opt).r);
    const yf = idx.map(i => free[i]);
    const sh = Sh.map(s => idx.map(i => s[i])), sc = Sc.map(s => idx.map(i => s[i]));
    const lv1 = new Set([-100, -80, -60, -45, -30, -20, -12, -6, 0, 6, 12, 20, 30, 45, 60, 80, 100]);
    [-8, -4, -2, -1, 0, 1, 2, 4, 8].forEach(dd => lv1.add(clamp(Math.round(this.uPrev + dd), -100, 100)));
    const L1 = [...lv1], L2 = [-100, -70, -45, -25, -10, 0, 10, 25, 45, 70, 100];
    const pel = u => (u >= 0 ? u / 100 * this.P.Ph : -u / 100 * this.P.Qc / this.P.COP) * this.dtC / 3.6e6; // kWh per step
    const nb = [1, b2 - 1, N - b2];
    // cost of one candidate sequence (early exit once it exceeds the best so far)
    const cost = (u, bound = Infinity) => {
      let J = 0, prev = this.uPrev;
      for (let j = 0; j < 3; j++) { J += this.wD * ((u[j] - prev) / 100) ** 2 + this.wE * pel(u[j]) * nb[j]; prev = u[j]; }
      const ch = u.map(v => Math.max(0, v)), cc = u.map(v => Math.max(0, -v));
      for (let k = 0; k < N; k++) {
        const ek = yf[k] - rr[k] + ch[0] * sh[0][k] + cc[0] * sc[0][k] + ch[1] * sh[1][k] + cc[1] * sc[1][k] + ch[2] * sh[2][k] + cc[2] * sc[2][k];
        J += ek * ek * dtH; if (J >= bound) return J;
      }
      return J;
    };
    // 1) brute force over the move-blocked grid
    let best = Infinity, bestU = [0, 0, 0];
    for (const u1 of L1) for (const u2 of L2) for (const u3 of L2) { const J = cost([u1, u2, u3], best); if (J < best) { best = J; bestU = [u1, u2, u3]; } }
    // 2) local refinement of each block level (pattern search on the integer grid)
    for (const step of [8, 4, 2, 1]) for (let rep = 0; rep < 2; rep++) for (let j = 0; j < 3; j++) for (const sgn of [-1, 1]) {
      const cand = bestU.slice(); cand[j] = clamp(cand[j] + sgn * step, -100, 100);
      const J = cost(cand, best); if (J < best) { best = J; bestU = cand; }
    }
    // store the plan (predicted Ta) for display
    const plan = new Array(N);
    for (let k = 0; k < N; k++) { const [u1, u2, u3] = bestU; plan[k] = yf[k] + [u1, u2, u3].reduce((s, u, j) => s + Math.max(0, u) * sh[j][k] + Math.max(0, -u) * sc[j][k], 0); }
    this.plan = { t0: t, dt: this.dtC, T: plan, r: rr, u: bestU, blocks };
    this.uPrev = bestU[0];
    return bestU[0];
  }
}

/* ------------------------------------------------------------------ simulation driver */
export function makeController(type, prm, P, opt, plant) {
  const uInit = plant ? plant.u0 : 0;
  if (type === 'onoff') return new OnOff({ h: prm.h });
  if (type === 'p') return new PID({ Kc: prm.pKc, mode: 'P', u0: prm.pBias ?? 0 });
  if (type === 'pi') return new PID({ Kc: prm.piKc, Ti: prm.piTi, mode: 'PI', aw: prm.aw, uInit });
  if (type === 'pid') return new PID({ Kc: prm.pidKc, Ti: prm.pidTi, Td: prm.pidTd, N: prm.pidN, mode: 'PID', aw: prm.aw, uInit });
  if (type === 'mpc') { const m = new MPC(P, { N: prm.mpcN, wE: prm.mpcWE, wD: prm.mpcWD, scale: prm.mpcScale, opt }); if (plant) m.reset(plant, uInit); return m; }
  throw new Error('unknown controller ' + type);
}
/** Performance accumulator for the standard scenario. */
export class Metrics {
  constructor() { this.iae = 0; this.ise = 0; this.ov = 0; this.settle = null; this.inBandSince = null; this.switches = 0; this.mode = 'idle'; this.doorMax = 0; this.doorRec = null; this.doorBand = null; this.lightMax = 0; }
  update(t, dt, Ta, r, u) {
    const e = Ta - r; this.iae += Math.abs(e) * dt / 3600; this.ise += e * e * dt / 3600;
    if (t >= SC.tStep && t < SC.tLightsOn) {
      this.ov = Math.max(this.ov, e);
      if (Math.abs(e) <= 0.3) { if (this.inBandSince === null) this.inBandSince = t; } else this.inBandSince = null;
    }
    if (t >= SC.tLightsOn - 1 && this.settle === null) this.settle = this.inBandSince !== null ? this.inBandSince - SC.tStep : Infinity;
    if (t >= SC.tLightsOn && t < SC.tLightsOn + 1800) this.lightMax = Math.max(this.lightMax, Math.abs(e));
    if (t >= SC.tDoor && t < SC.tDoor + 1800) {
      this.doorMax = Math.max(this.doorMax, Math.abs(e));
      if (Math.abs(e) <= 0.3) { if (this.doorBand === null && t > SC.tDoor + SC.doorDur) this.doorBand = t; } else this.doorBand = null;
    }
    if (t >= SC.tDoor + 1800 - 1 && this.doorRec === null) this.doorRec = this.doorBand !== null ? this.doorBand - SC.tDoor : Infinity;
    // actuator starts, with a small hysteresis so that sensor noise around u = 0 is not counted twice
    if (this.mode !== 'heat' && u > 1.5) { this.mode = 'heat'; this.switches++; }
    else if (this.mode !== 'cool' && u < -1.5) { this.mode = 'cool'; this.switches++; }
    else if ((this.mode === 'heat' && u < 0.5) || (this.mode === 'cool' && u > -0.5)) this.mode = 'idle';
  }
}
/** Gaussian RNG. */
export function mulberry(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function gauss(rng) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/**
 * Run a whole scenario with one controller. Returns { hist, metrics, E } — hist sampled every `every` s.
 * opt: scenario toggles; env.humLoop toggles the humidity loop.
 */
export function runScenario(type, prm, P, opt = {}, { seed = 11, every = 10, tEnd = SC.tEnd } = {}) {
  const plant = makePlant(P, SC.r0, opt); const ctrl = makeController(type, prm, P, opt, plant);
  const rng = mulberry(seed); const M = new Metrics(); const hist = [];
  let u = type === 'onoff' ? 0 : plant.u0; let y = plant.Ts;
  for (let t = 0; t < tEnd; t++) {
    const sc = scenario(t, opt);
    if (t % 2 === 0) { y = Math.round((plant.Ts + P.sigma * gauss(rng)) * 100) / 100; u = ctrl.step(y, sc.r, t, sc.Tc); }
    plantStep(plant, u, 1, P, { lights: sc.lights, Tc: sc.Tc, door: sc.door, humLoop: opt.humLoop !== false });
    const r1 = scenario(t + 1, opt).r;
    M.update(t + 1, 1, plant.Ta, r1, u);
    if ((t + 1) % every === 0) hist.push({ t: t + 1, Ta: plant.Ta, Tm: plant.Tm, y, r: r1, u, Tc: sc.Tc, rh: plant.rh, Eh: plant.E.heat / 3.6e6, Ec: plant.E.cool / 3.6e6, hum: plant.hum });
  }
  return { hist, metrics: M, E: { heat: plant.E.heat / 3.6e6, cool: plant.E.cool / 3.6e6 } };
}

/* ------------------------------------------------------------------ tuning experiments */
/** Steady state holding temperature r (lights off, corridor Tc) under ideal control: returns plant + u. */
export function steadyAt(P, r, Tc = SC.Tc0) {
  const opt = { lights: false, door: false, corridor: false };
  const pl = makePlant(P, r, opt); return pl;
}
/**
 * Open-loop step test (reaction curve): from steady state at 22 °C (lights off, corridor 20 °C) with the
 * output held at its steady-state value u_ss, step the output by du at t = 60 s; record 25 min.
 * Returns { t[], y[], u0, du, R (°C s⁻¹ per %), L (s), a = R·L, tInf, yInf, K, fit } — identification by the
 * steepest tangent of the smoothed response (Ziegler & Nichols, 1942).
 */
export function stepTest(P, { du = 40, seed = 5, dur = 1500 } = {}) {
  const pl = steadyAt(P, SC.r1); const u0 = pl.u0; const rng = mulberry(seed);
  const ts = [], ys = [], us = [];
  let y = pl.Ts;
  for (let t = 0; t < dur; t++) {
    const u = t >= 60 ? clamp(u0 + du, -100, 100) : u0;
    if (t % 2 === 0) { y = Math.round((pl.Ts + P.sigma * gauss(rng)) * 100) / 100; ts.push(t); ys.push(y); us.push(u); }
    plantStep(pl, u, 1, P, { lights: false, Tc: SC.Tc0, door: false, humLoop: false });
  }
  // smooth (centred moving average over 20 s) and differentiate
  const w = 5; const ysm = ys.map((_, i) => { let s = 0, n = 0; for (let j = i - w; j <= i + w; j++) if (j >= 0 && j < ys.length) { s += ys[j]; n++; } return s / n; });
  let best = -Infinity, iB = 0;
  for (let i = w + 1; i < ysm.length - w - 1; i++) { const sl = (ysm[i + 1] - ysm[i - 1]) / (ts[i + 1] - ts[i - 1]); if (ts[i] > 60 && sl > best) { best = sl; iB = i; } }
  const y0 = ysm.slice(0, 25).reduce((s, v) => s + v, 0) / 25;
  const R = best / (du);                                  // °C s⁻¹ per %
  const tInt = ts[iB] - (ysm[iB] - y0) / best;            // tangent meets the initial level
  const L = Math.max(1, tInt - 60);
  return { t: ts, y: ys, u: us, u0, du, R, L, a: R * L, tInf: ts[iB], yInf: ysm[iB], slope: best, y0, t0: 60 };
}
/**
 * Relay feedback test (Åström & Hägglund, 1984): around the steady-state output u_ss at 22 °C, switch the
 * output between u_ss ± d when the measurement crosses the set-point (hysteresis eps). After the transient,
 * estimate the ultimate period Pu (mean period) and amplitude a (half peak-to-peak) → Ku = 4d/(π a).
 */
export function relayTest(P, { d = 25, eps = 0.05, seed = 6, dur = 2400 } = {}) {
  const pl = steadyAt(P, SC.r1); const u0 = pl.u0; const rng = mulberry(seed); const r = SC.r1;
  const ts = [], ys = [], us = []; let y = pl.Ts; let high = true; let u = u0 + d;
  const ups = [];
  for (let t = 0; t < dur; t++) {
    if (t % 2 === 0) {
      y = Math.round((pl.Ts + P.sigma * gauss(rng)) * 100) / 100;
      if (high && y > r + eps) { high = false; }
      else if (!high && y < r - eps) { high = true; ups.push(t); }
      u = clamp(u0 + (high ? d : -d), -100, 100);
      ts.push(t); ys.push(y); us.push(u);
    }
    plantStep(pl, u, 1, P, { lights: false, Tc: SC.Tc0, door: false, humLoop: false });
  }
  // use the last 3 full cycles; amplitude from the smoothed signal (10-s moving average) to suppress sensor noise
  const n = ups.length; if (n < 4) return { t: ts, y: ys, u: us, ok: false };
  const c0 = ups[n - 4], c1 = ups[n - 1];
  const Pu = (c1 - c0) / 3;
  const w = 2; const ysm = ys.map((_, i) => { let s = 0, k = 0; for (let j = i - w; j <= i + w; j++) if (j >= 0 && j < ys.length) { s += ys[j]; k++; } return s / k; });
  let mx = -Infinity, mn = Infinity; for (let i = 0; i < ts.length; i++) if (ts[i] >= c0 && ts[i] <= c1) { mx = Math.max(mx, ysm[i]); mn = Math.min(mn, ysm[i]); }
  const a = (mx - mn) / 2;
  const Ku = 4 * d / (Math.PI * Math.sqrt(Math.max(1e-6, a * a - eps * eps)));   // relay with hysteresis (describing function)
  return { t: ts, y: ys, u: us, ok: true, Pu, a, Ku, d, u0, eps, window: [c0, c1], mean: (mx + mn) / 2 };
}
/** Ultimate gain and period of the linearised loop (side 'heat' or 'cool'), from the frequency response. */
export function ultimateLinear(P, side = 'heat') {
  const d = derived(P);
  const tauA = side === 'heat' ? P.tauH : P.tauC;
  const gain = side === 'heat' ? P.Ph / 100 : (1 - latentFraction(70)) * P.Qc / 100;   // W of sensible heat per %
  const G = w => { // complex arithmetic: returns [re, im]
    const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
    const inv = a => { const m = a[0] * a[0] + a[1] * a[1]; return [a[0] / m, -a[1] / m]; };
    const s = [0, w];
    const zm = [P.Ham + P.Henv, P.Cm * w];                       // Cm s + Ham + Henv
    const t2 = mul([P.Ham * P.Ham, 0], inv(zm));
    const den = [P.Ham + d.Hinf - t2[0], d.Ca * w - t2[1]];
    let g = inv(den);                                              // K per W
    g = mul(g, inv([1, tauA * w])); g = mul(g, inv([1, P.tauS * w]));
    g = mul(g, [Math.cos(-w * P.theta), Math.sin(-w * P.theta)]);
    return mul(g, [gain, 0]);                                      // K per %
  };
  const phase = w => { const g = G(w); let ph = Math.atan2(g[1], g[0]); return ph; };
  // unwrap phase by stepping in frequency
  let w = 1e-5, prev = phase(w), acc = prev, wPrev = w;
  for (let i = 0; i < 4000; i++) {
    w *= 1.005; let ph = phase(w); let dph = ph - prev; if (dph > Math.PI) dph -= 2 * Math.PI; if (dph < -Math.PI) dph += 2 * Math.PI; acc += dph; prev = ph;
    if (acc <= -Math.PI) { const g = G(w); const mag = Math.hypot(g[0], g[1]); return { Ku: 1 / mag, Pu: 2 * Math.PI / w, wu: w }; }
    wPrev = w;
  }
  return { Ku: NaN, Pu: NaN };
}
/** Ziegler–Nichols settings. */
export function znStep(R, L) { const a = R * L; return { p: { Kc: 1 / a }, pi: { Kc: 0.9 / a, Ti: L / 0.3 }, pid: { Kc: 1.2 / a, Ti: 2 * L, Td: 0.5 * L } }; }
export function znUltimate(Ku, Pu) { return { p: { Kc: 0.5 * Ku }, pi: { Kc: 0.45 * Ku, Ti: Pu / 1.2 }, pid: { Kc: 0.6 * Ku, Ti: Pu / 2, Td: Pu / 8 } }; }
