/* Stirred-tank bioreactor — process model (pure ES module, no DOM).
   Host: Komagataella phaffii (Pichia pastoris) on glucose, secreting a recombinant protein
   under the constitutive GAP promoter. Kinetic constants from Maurer et al. (2006),
   Microb. Cell Fact. 5:37 (µmax, Y_X/S, m_S, Luedeking–Piret α and β).
   Equations are documented in the Derive tab (B1–B13) of index.html. */
import { doSaturation, clamp, G0, P0, CP_WATER } from '/assets/js/physics.js';

/* ------------------------------------------------------------------ constants */
export const HOST = { muMax: 0.20, Yxs: 0.559, ms: 0.0161, Ks: 0.05, Ko: 0.01, Tref: 25 };
export const PRODUCTS = {
  fab: { label: 'Fab fragment — measured strain', alpha: 0.2051e-3, beta: 0.002e-3 },    // Maurer et al. 2006 (mg → g)
  food: { label: 'Food protein — hypothetical ×100 strain', alpha: 0.2051e-1, beta: 0.002e-1 }
};
export const E = { gS: 4.0, MS: 30.03, gX: 4.2, MX: 24.6 };   // glucose CH2O; biomass CH1.8O0.5N0.2 (NH3 as N source)
export const DH_O2 = 460e3;          // J per mol O2 consumed (Doran 2013, after Cooney et al. 1969)
export const RHO = 1000;             // broth density, kg m⁻³
export const MU_L = 1.0e-3;          // broth viscosity, Pa s (water-like)
export const NP = 5;                 // Rushton turbine power number, baffled, turbulent
export const FG = 0.5;               // gassed / ungassed power ratio (assumed; 30–60 % reduction is typical)
export const Y_AIR = 0.2095;         // O2 mole fraction in air
export const Y_ENR = 0.50;           // maximum O2 fraction with enrichment
export const SF_FED = 550;           // g L⁻¹ glucose in the fed-batch feed (Maurer et al. 2006)
export const VM = 0.022414;          // m³ mol⁻¹ ideal gas at 0 °C, 101.325 kPa

/* ------------------------------------------------------------------ scales (geometrically similar, H/T = 2) */
export const SCALES = {
  lab: { key: 'lab', label: '2 L laboratory', short: '2 L', Vmax: 0.002, vvm: 1.0, phead: 0.1, U: 250 },
  pilot: { key: 'pilot', label: '1 m³ pilot', short: '1 m³', Vmax: 1, vvm: 0.7, phead: 0.3, U: 500 },
  prod: { key: 'prod', label: '100 m³ production', short: '100 m³', Vmax: 100, vvm: 0.4, phead: 0.5, U: 500 }
};
export function geometry(key) {
  const s = SCALES[key] || SCALES.lab;
  const T = Math.cbrt(2 * s.Vmax / Math.PI);          // V = (π/4)T²·2T
  const D = T / 3;
  return Object.assign({}, s, { T, HL: 2 * T, D, A: Math.PI * T * T / 4, zImp: [0.5 * T, 1.5 * T], Hv: 2.6 * T });
}
/** Stirrer-speed range (rps) giving a maximum ungassed P/V (W m⁻³) with both impellers submerged. */
export function speedRange(g, pvMax) {
  const Nmax = Math.cbrt(pvMax * g.Vmax / (2 * NP * RHO * Math.pow(g.D, 5)));
  return { Nmin: 0.25 * Nmax, Nmax };
}

/* ------------------------------------------------------------------ physical property helpers */
/** O2 solubility, mmol L⁻¹, for gas O2 fraction y at total pressure P (kPa) and T (°C). */
export const cStar = (T, Pk, y) => doSaturation(T, 0, Pk) / 31.998 * (y / Y_AIR);
/** Hydrodynamics and gas–liquid transfer for the current state. N in rps, V in m³. */
export function transfer(p, g, N, V, Tb) {
  const H = V / g.A;
  const wUp = clamp((H - g.zImp[1]) / (0.3 * g.D) + 0.5, 0, 1);      // upper impeller submerged?
  const nImp = 1 + wUp;
  const Pu = nImp * NP * RHO * N * N * N * Math.pow(g.D, 5);           // W, ungassed
  const Pg = FG * Pu;
  const Ptop = P0 + p.phead * 100;                                    // kPa absolute
  const Pmean = Ptop + RHO * G0 * H / 2 / 1000;                       // kPa at mid-depth
  const QN = p.vvm * V / 60;                                          // Nm³ s⁻¹
  const Qact = QN * (Tb + 273.15) / 273.15 * P0 / Pmean;              // m³ s⁻¹ at operating conditions
  const vs = Qact / g.A;                                              // superficial gas velocity, m s⁻¹
  const PgV = Pg / V;                                                 // W m⁻³
  const klaS = p.broth === 'coal' ? 0.026 * Math.pow(PgV, 0.4) * Math.sqrt(vs) : 0.002 * Math.pow(PgV, 0.7) * Math.pow(vs, 0.2);
  return {
    H, nImp, Pu, Pg, PgV, Pmean, Ptop, vs, kla: klaS * 3600, nGas: QN * 3600 / VM,
    tip: Math.PI * g.D * N, Re: RHO * N * g.D * g.D / MU_L,
    kPaBottom: Ptop + RHO * G0 * H / 1000
  };
}

/* ------------------------------------------------------------------ kinetics (Herbert–Pirt + Luedeking–Piret + electron balance) */
export function rates(k, S, C) {
  const fS = S > 0 ? S / (k.Ks + S) : 0, fO = C > 0 ? C / (k.Ko + C) : 0;
  const qSmax = k.muMax / k.Yxs + k.ms;
  const qS = qSmax * fS * fO;                              // g glucose g⁻¹ h⁻¹
  const mu = k.Yxs * (qS - k.ms * fO);                     // h⁻¹ (negative = endogenous decay)
  const qP = k.alpha * Math.max(mu, 0) + k.beta * fS * fO; // g product g⁻¹ h⁻¹
  const qO2 = (E.gS * qS / E.MS - E.gX * mu / E.MX) / 4;   // mol O2 g⁻¹ h⁻¹
  const qCO2 = qS / E.MS - mu / E.MX;                      // mol CO2 g⁻¹ h⁻¹ (carbon balance)
  return { fS, fO, qS, mu, qP, qO2, qCO2 };
}

/* ------------------------------------------------------------------ simulator */
export class Fermenter {
  constructor(p) { this.p = Object.assign({}, p); this.reset(); }
  setParams(p) {
    const scaleChanged = p.scale !== this.p.scale;
    this.p = Object.assign({}, this.p, p);
    this.g = geometry(this.p.scale);
    this.sr = speedRange(this.g, this.p.pvMax * 1000);
    if (scaleChanged) this.reset();
  }
  kin() {
    const pr = PRODUCTS[this.p.product] || PRODUCTS.fab;
    return { muMax: this.p.muMax, Yxs: this.p.Yxs, ms: this.p.ms, Ks: HOST.Ks, Ko: HOST.Ko, alpha: pr.alpha * this.p.alphaF, beta: pr.beta * this.p.alphaF };
  }
  reset() {
    const p = this.p; this.g = geometry(p.scale); this.sr = speedRange(this.g, p.pvMax * 1000);
    const V = p.mode === 'fed' ? 0.6 * this.g.Vmax : this.g.Vmax;
    const S0 = p.S0;
    const Pk = P0 + p.phead * 100 + RHO * G0 * (V / this.g.A) / 2 / 1000;
    const C = cStar(p.Tset, Pk, Y_AIR);
    this.s = { t: 0, X: p.X0, S: S0, P: 0, C, V, Tb: p.Tset, I: 0.35, lim: 1, feeding: false, cont: false, tf: 0, Xf: 0, Vf: 0,
      yIn: Y_AIR, yOut: Y_AIR, OTR: 0, N: this.sr.Nmin + 0.3 * (this.sr.Nmax - this.sr.Nmin), F: 0, Fout: 0, harvX: 0, harvP: 0, X0V0: p.X0 * V, feedUsed: 0, done: false,
      afShots: 0, foam: 0, phase: 'batch' };
    this.diag = this.diagnose();
  }
  /** Controller & feed decisions before a step of dt hours. */
  control(dt) {
    const p = this.p, s = this.s, g = this.g;
    const tr = transfer(p, g, s.N, s.V, s.Tb);
    const Cref = cStar(s.Tb, tr.Pmean, Y_AIR);
    const DO = 100 * s.C / Cref;
    if (p.doMode === 'cascade') {
      const e = (p.DOsp - DO) / 100, umax = p.enrich ? 2 : 1;
      s.I = clamp(s.I + 40 * e * dt, 0, umax);
      const u = clamp(1.2 * e + s.I, 0, umax);
      s.N = this.sr.Nmin + (this.sr.Nmax - this.sr.Nmin) * Math.min(1, u);
      s.yIn = Y_AIR + (Y_ENR - Y_AIR) * clamp(u - 1, 0, 1);
    } else { s.N = clamp(p.Nman / 60, 0.05, this.sr.Nmax * 1.5); s.yIn = Y_AIR; s.I = 0.35; }
    // feeding decisions
    let F = 0, Fout = 0;
    if (p.mode === 'fed') {
      if (!s.feeding && !s.fedDone && s.S < 1.0 && s.t > 0.5) { s.feeding = true; s.tf = s.t; s.Xf = s.X; s.Vf = s.V; }
      if (s.feeding && s.V >= g.Vmax - 1e-9) { s.feeding = false; s.fedDone = true; }
      if (s.feeding) {
        const k = this.kin();
        const Fexp = (p.muSet / k.Yxs + k.ms) * s.Xf * s.Vf * Math.exp(p.muSet * (s.t - s.tf)) / SF_FED;     // m³ h⁻¹ (V in m³)
        // DO / temperature protection (first-order filtered limiter)
        let target = 1;
        if (p.limiter) {
          const fDO = clamp((DO - 5) / 10, 0, 1), fT = clamp(1 - (s.Tb - p.Tset - 0.3) / 0.7, 0, 1);
          target = Math.min(fDO, fT);
        }
        s.lim += (target - s.lim) * Math.min(1, dt / 0.05);
        F = Math.min(Fexp * s.lim, (g.Vmax - s.V) / dt);
      }
      s.phase = s.feeding ? 'feeding' : s.fedDone ? 'end of feed' : 'batch phase';
    } else if (p.mode === 'cont') {
      if (!s.cont && s.S < 1.0 && s.t > 0.5) s.cont = true;
      if (s.cont) { F = p.D * s.V; Fout = F; }
      s.phase = s.cont ? 'continuous' : 'batch start-up';
    } else s.phase = 'batch';
    s.F = F; s.Fout = Fout;
    s.tr = tr;
    return tr;
  }
  deriv(y, tr, k) {
    const p = this.p, s = this.s, g = this.g;
    const [X, S, P, C, V, Tb] = y;
    const r = rates(k, Math.max(0, S), Math.max(0, C));
    const Vm = Math.max(1e-6, V);
    const Din = s.F / Vm, Dout = s.Fout / Vm;
    const SF = p.mode === 'fed' ? SF_FED : p.S0;
    const OUR = r.qO2 * X * 1000;                                          // mmol L⁻¹ h⁻¹
    const yMean = 0.5 * (s.yIn + s.yOut);
    const Cs = cStar(Tb, tr.Pmean, yMean);
    const OTR = tr.kla * (Cs - C);
    const Qmet = DH_O2 * OUR * Vm / 3600;                                   // W (OUR mol m⁻³ h⁻¹)
    const Qtot = Qmet + tr.Pg;
    const A = Math.PI * g.T * (V / g.A) + p.coil * V;                      // jacket (wetted wall) + coils
    const Qmax = Math.max(0, p.U * A * (Tb - p.Tcw));
    const need = Qtot + RHO * CP_WATER * Vm * (Tb - p.Tset) / 360;
    const Qcool = Math.min(Qmax, need);
    return [
      r.mu * X - Din * X,
      -r.qS * X + Din * (SF - S),
      r.qP * X - Din * P,
      OTR - OUR - Din * C,
      s.F - s.Fout,
      (Qtot - Qcool) * 3600 / (RHO * CP_WATER * Vm)
    ];
  }
  step(dt) {
    const s = this.s; if (s.done) return;
    const tr = this.control(dt), k = this.kin();
    const y0 = [s.X, s.S, s.P, s.C, s.V, s.Tb];
    const f = y => this.deriv(y, tr, k);
    const k1 = f(y0);
    const y2 = y0.map((v, i) => v + dt / 2 * k1[i]); const k2 = f(y2);
    const y3 = y0.map((v, i) => v + dt / 2 * k2[i]); const k3 = f(y3);
    const y4 = y0.map((v, i) => v + dt * k3[i]); const k4 = f(y4);
    const y = y0.map((v, i) => v + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    s.X = Math.max(1e-6, y[0]); s.S = Math.max(0, y[1]); s.P = Math.max(0, y[2]); s.C = Math.max(0, y[3]); s.V = Math.min(this.g.Vmax, Math.max(1e-6, y[4])); s.Tb = y[5];
    s.harvX += s.Fout * s.X * dt; s.harvP += s.Fout * s.P * dt; s.feedUsed += s.F * dt;
    s.t += dt;
    // gas phase (quasi-steady): outlet O2 fraction from the current transfer rate
    const d = this.diagnose();
    s.OTR = d.OTR;
    s.yOut = clamp(s.yIn - d.OTR * s.V / Math.max(1e-9, d.tr.nGas), 0.001, s.yIn);
    // foam (visual index): rises with gas velocity and protein, antifoam pump knocks it back
    const foamRate = 6 * d.tr.vs * (0.4 + 1.6 * Math.min(1, s.P * 50 + s.X / 60));
    s.foam = clamp(s.foam + (foamRate - 0.6 * s.foam) * dt, 0, 1);
    if (this.p.antifoam && s.foam > 0.35) { s.foam *= 0.25; s.afShots++; }
    this.diag = d;
    // end of run: batch → 3 h after glucose exhaustion; fed-batch → 2 h after the vessel is full; chemostat → tEnd
    if (s.S < 0.02 && s.tEx == null && s.t > 1) s.tEx = s.t;
    if (s.fedDone && s.tFull == null) s.tFull = s.t;
    const p = this.p;
    if ((p.mode === 'batch' && s.tEx != null && s.t > s.tEx + 3) || (p.mode === 'fed' && s.tFull != null && s.t > s.tFull + 2) || s.t >= p.tEnd) s.done = true;
  }
  /** Rates and derived quantities at the current state (for readouts, charts and the 3D scene). */
  diagnose() {
    const p = this.p, s = this.s, g = this.g;
    const tr = s.tr || transfer(p, g, s.N, s.V, s.Tb);
    const k = this.kin(); const r = rates(k, s.S, s.C);
    const OUR = r.qO2 * s.X * 1000, CER = r.qCO2 * s.X * 1000;
    const yMean = 0.5 * (s.yIn + s.yOut);
    const Cs = cStar(s.Tb, tr.Pmean, yMean);
    const Cref = cStar(s.Tb, tr.Pmean, Y_AIR);
    const OTR = tr.kla * (Cs - s.C);
    const trMax = transfer(p, g, p.doMode === 'cascade' ? this.sr.Nmax : s.N, s.V, s.Tb);
    const yMax = p.doMode === 'cascade' && p.enrich ? Y_ENR : Y_AIR;
    const OTRmax = trMax.kla * (cStar(s.Tb, trMax.Pmean, yMax) - 0.1 * Cref);     // at DO = 10 % (critical region)
    const Vm = s.V;
    const Qmet = DH_O2 * OUR * Vm / 3600, Qag = tr.Pg;
    const A = Math.PI * g.T * (s.V / g.A) + p.coil * s.V;
    const Qmax = Math.max(0, p.U * A * (s.Tb - p.Tcw));
    const QmaxSet = Math.max(0, p.U * A * (p.Tset - p.Tcw));
    const OURheat = Math.max(0, (QmaxSet - Qag) / Vm) * 3600 / DH_O2;             // mmol L⁻¹ h⁻¹ the cooling can carry
    const prodX = (s.X * s.V + s.harvX - s.X0V0) / (s.V * Math.max(1e-6, s.t));
    const prodP = (s.P * s.V + s.harvP) / (s.V * Math.max(1e-6, s.t));
    return {
      tr, r, OUR, CER, RQ: OUR > 1e-6 ? CER / OUR : NaN, OTR, OTRmax, OURheat, DO: 100 * s.C / Cref, Cs, Cref,
      Qmet, Qag, Qtot: Qmet + Qag, Qmax, A, prodX, prodP, yOut: s.yOut, yCO2: CER * s.V / Math.max(1e-9, tr.nGas),
      Dcrit: k.Yxs * ((k.muMax / k.Yxs + k.ms) * p.S0 / (k.Ks + p.S0) - k.ms)
    };
  }
}

/* ------------------------------------------------------------------ analytical helpers (charts, Explain tab) */
/** Chemostat steady state (Herbert–Pirt, no O2 limitation). */
export function chemostat(k, D, SR) {
  const qSmax = k.muMax / k.Yxs + k.ms, qS = D / k.Yxs + k.ms;
  if (qS >= qSmax * SR / (k.Ks + SR)) return { S: SR, X: 0, washout: true };
  const S = k.Ks * qS / (qSmax - qS);
  return { S, X: D * (SR - S) / qS, washout: false };
}
/** Oxygen- and heat-limited ceilings for one scale at a given max P/V (kW m⁻³), for the scale comparison figure. */
export function ceilings(p, key) {
  const g = geometry(key), sr = speedRange(g, p.pvMax * 1000);
  const V = g.Vmax, s = SCALES[key];
  const pp = Object.assign({}, p, { vvm: s.vvm, phead: s.phead });
  const tr = transfer(pp, g, sr.Nmax, V, p.Tset);
  const Cref = cStar(p.Tset, tr.Pmean, Y_AIR);
  const OTRmax = tr.kla * (Cref - 0.1 * Cref);
  const A = Math.PI * g.T * g.HL + p.coil * V;
  const Qmax = s.U * A * (p.Tset - p.Tcw);
  const OURheat = Math.max(0, (Qmax - tr.Pg) / V) * 3600 / DH_O2;
  return { g, sr, tr, OTRmax, OURheat, AV: A / V, Qmax, rpm: sr.Nmax * 60 };
}
