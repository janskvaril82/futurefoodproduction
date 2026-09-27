/* ==========================================================================
   Aeroponic root chamber — droplet physics, root-film water balance and a
   3D high-pressure aeroponic (HPA) unit driven by the model.

   Model (Derive tab, Eqs. A1–A12)
   · log-normal spray, Hatch–Choate relations (CMD, D10, D30, D32, MMD)
   · orifice equation for nozzle flow; D32 ∝ d_o^0.5 ΔP^-0.4 (pressure-swirl scaling)
   · terminal velocity: Stokes drag with the Schiller–Naumann correction; time to settle
   · d²-law droplet evaporation in the chamber air (lesson Eq. 7.1.5)
   · inertial impaction on roots (Israel & Rosner 1982 fit for cylinders), capture by a
     root curtain of N_r layers, geometric interception of the spray cone
   · spray coverage per pulse (Poisson), film capacity of the covered root surface
   · root-film ODE: deposition − uptake − evaporation (Eq. 7.1.8) − drainage
   · root-tissue desiccation when the film is gone; root water-stress index
   · bladder accumulator (Boyle) + pressure-switch pump; power-failure scenario
   · nutrient delivery by deposition and uptake by mass flow
   ========================================================================== */
import { createStage, studioLights, THREE, M, makeRoom, makeRoots, makeNetPot, lettuceGeometry, leafMaterial, makeTank, makePipe, makeLEDBar, Mist, FlowAlong, RoundedBoxGeometry } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, BarChart } from '/assets/js/plot.js';
import { svp } from '/assets/js/physics.js';
import { colormap, colormapGradient } from '/assets/js/colors.js';

/* ------------------------------------------------------------------ physical constants */
const RHO_W = 998, RHO_A = 1.2, G = 9.81, RG = 8.314, MW = 0.018015, DV = 2.4e-5, CDIS = 0.6, PATM = 1.013;
const muAir = T => 1.458e-6 * Math.pow(T + 273.15, 1.5) / (T + 273.15 + 110.4);          // Sutherland, Pa s
const rhoVs = T => MW * svp(T) * 1000 / (RG * (T + 273.15));                              // saturation vapour density, kg m⁻³
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/* ------------------------------------------------------------------ chamber geometry and root parameters */
const CH_L = 1.30, CH_D = 0.62, H_IN = 0.46, Y0 = 0.80;          // m; chamber floor height above the room floor
const PLANTS = []; [-0.45, -0.15, 0.15, 0.45].forEach(x => [-0.14, 0.14].forEach(z => PLANTS.push({ x, z })));
const NOZ_X = [-0.45, -0.15, 0.15, 0.45];                        // nozzles on the centre line (z = 0)
const X_ROOT = 0.18;          // m, nozzle → root curtain
const Z_IN = 0.06, Z_OUT = 0.22;                                  // m, the two root curtains occupy 0.06 < |z| < 0.22
const A_R = 0.08, H_F = 25e-6;                                    // m² wetted root area per plant; m film thickness (lesson Eq. 7.1.7)
const V_RET = A_R * H_F * 1e6;                                    // mL film a fully covered root system can hold (2.0 mL)
const PHI_C = 0.25;           // uptake is limited once the film falls below 25 % of capacity
const TAU_D = 30;             // s, drainage time constant of water above the retention capacity
const D_C = 0.5e-3;           // m, representative root diameter (collector)
const N_R = 1.5;              // effective number of root layers a droplet must cross
const F_SET = 0.35;           // fraction of settling droplets that land on roots (projected root cover)
const U_REF = 0.6;            // m s⁻¹, air/droplet speed at the roots for the reference nozzle (0.3 mm, 6 bar)
const D32_REF = 30, DO_REF = 0.3, P_REF = 6;                      // µm, mm, bar
const BETA = 2;               // droplet spread factor on a wet root surface (spot diameter / droplet diameter)
const HM = 0.01;              // m s⁻¹, mass-transfer coefficient (lesson Eq. 7.1.8)
const W_TISSUE = 9;           // g water in the fine-root tissue of one plant (10 g FW, 90 % water)
const F_DRAW = 0.5;           // share of the unmet uptake demand drawn from root tissue
const TAU_REC = 600;          // s, rehydration time constant of root tissue after rewetting
const THETA_DEAD = 0.70;      // relative water content of fine roots below which damage is irreversible
const TAU_RH = 300;           // s, relaxation of chamber RH after the mist stops (lid leakage)
const Q_PUMP = 20;            // mL s⁻¹ (1.2 L min⁻¹ diaphragm pump)
const P_BAND = 1.5;           // bar, pressure-switch band above the set pressure

/* ------------------------------------------------------------------ droplet physics */
function vTerm(dUm, T) {        // terminal velocity, m s⁻¹ (Stokes with Schiller–Naumann correction, Re < 800)
  const d = dUm * 1e-6, mu = muAir(T); const v0 = (RHO_W - RHO_A) * G * d * d / (18 * mu); let v = v0;
  for (let i = 0; i < 40; i++) { const Re = RHO_A * v * d / mu; const vn = v0 / (1 + 0.15 * Math.pow(Re, 0.687)); if (Math.abs(vn - v) < 1e-10) { v = vn; break; } v = 0.5 * (v + vn); }
  return v;
}
function tEvap(dUm, T, rh) {    // d²-law evaporation time, s (lesson Eq. 7.1.5)
  const r = Math.min(rh, 0.99999); return RHO_W * RG * (T + 273.15) * (dUm * 1e-6) ** 2 / (8 * DV * MW * svp(T) * 1000 * (1 - r));
}
const nozzleQ = (dmm, pbar) => CDIS * Math.PI * (dmm * 1e-3) ** 2 / 4 * Math.sqrt(2 * Math.max(0, pbar) * 1e5 / RHO_W); // m³ s⁻¹
const d32Of = (dmm, pbar) => D32_REF * Math.sqrt(dmm / DO_REF) * Math.pow(Math.max(0.3, pbar) / P_REF, -0.4);
const uRoots = (dmm, pbar) => U_REF * (dmm / DO_REF) * Math.sqrt(Math.max(0, pbar) / P_REF);
function etaIR(stk) {            // single-cylinder impaction efficiency, potential flow (Israel & Rosner 1982); Stk = ρ d² U /(9 µ d_c)
  if (stk <= 0.125) return 0; const x = stk - 0.125;
  return clamp(1 / (1 + 1.25 / x - 0.014 / (x * x) + 0.508e-4 / (x * x * x)), 0, 1);
}
function bandFrac(a, R) { if (a >= R) return 1; const s = a / R; return 2 / Math.PI * (Math.asin(s) + s * Math.sqrt(1 - s * s)); }
const coneR = cone => X_ROOT * Math.tan(cone / 2 * Math.PI / 180);
const phiGeom = cone => { const R = coneR(cone); return bandFrac(Z_OUT, R) - bandFrac(Z_IN, R); };
function fate(dUm, T, rh, U, phi) {
  const d = dUm * 1e-6, mu = muAir(T);
  const stk = RHO_W * d * d * U / (9 * mu * D_C);
  const etaC = 1 - Math.exp(-N_R * etaIR(stk));
  const te = tEvap(dUm, T, rh), tPass = X_ROOT / Math.max(0.05, U);
  const S1 = tPass >= te ? 0 : Math.pow(1 - tPass / te, 1.5);
  const vt = vTerm(dUm, T), tFall = H_IN / vt;
  const S2 = tFall >= te ? 0 : Math.pow(1 - tFall / te, 1.5);
  const root = phi * (etaC * S1 + (1 - etaC) * S1 * F_SET * S2);
  const evap = phi * ((1 - S1) + (1 - etaC) * S1 * (1 - S2));
  return { stk, etaC, S1, S2, root, evap, drain: Math.max(0, 1 - root - evap), vt, tFall, te };
}
/** Spray model at nozzle pressure pbar (gauge): distribution, fate and coverage statistics. */
function sprayModel(p, pbar) {
  const D32 = d32Of(p.dor, pbar), s = Math.log(p.sg), s2 = s * s;
  const CMD = D32 / Math.exp(2.5 * s2), MMD = CMD * Math.exp(3 * s2), D30 = CMD * Math.exp(1.5 * s2), D10 = CMD * Math.exp(0.5 * s2);
  const U = uRoots(p.dor, pbar), phi = phiGeom(p.cone), rh = p.rh / 100;
  const NB = 110, lo = Math.log(0.5), hi = Math.log(700), dl = (hi - lo) / (NB - 1);
  let wN = 0, wV = 0, root = 0, evap = 0, drain = 0, nDep = 0, spot = 0;
  const bins = [];
  for (let k = 0; k < NB; k++) {
    const ld = lo + k * dl, d = Math.exp(ld);
    const fN = Math.exp(-0.5 * ((ld - Math.log(CMD)) / s) ** 2);
    const fV = fN * d * d * d;
    const f = fate(d, p.T, rh, U, phi);
    bins.push(Object.assign({ d, fN, fV }, f));
    wN += fN; wV += fV; root += fV * f.root; evap += fV * f.evap; drain += fV * f.drain;
    nDep += fN * f.root; spot += fN * f.root * Math.PI * (BETA * d * 1e-6) ** 2 / 4;
  }
  const perVol = 1 / (Math.PI / 6 * (D30 * 1e-6) ** 3);        // droplets per m³ of liquid
  return {
    D32, CMD, MMD, D30, D10, U, phi, bins, pbar,
    etaRoot: root / wV, fEvap: evap / wV, fDrain: drain / wV,
    depPerVol: perVol * nDep / wN,                              // droplets deposited on roots per m³ sprayed
    spotArea: nDep > 0 ? spot / nDep : 0,                        // m², mean wetted spot per deposited droplet
    vt32: vTerm(D32, p.T), te32: tEvap(D32, p.T, rh), qn: nozzleQ(p.dor, pbar) * 1e6  // mL s⁻¹ per nozzle
  };
}
/** Share of each nozzle's deposit that lands on each plant (normalised per nozzle), from the cone footprint. */
function shareMatrix(cone) {
  const sig = Math.max(0.03, coneR(cone) / 2);
  return NOZ_X.map(xj => { const w = PLANTS.map(pl => Math.exp(-((pl.x - xj) ** 2) / (2 * sig * sig))); const s = w.reduce((a, b) => a + b, 0); return w.map(v => v / s); });
}
const clogOf = (p, j) => j === 1 ? p.clog / 100 : 0;
/** Per-plant deposition rate while spraying (mL s⁻¹) and coverage per pulse. */
function plantSupply(p, sp, W) {
  const dep = new Array(PLANTS.length).fill(0), vol = new Array(PLANTS.length).fill(0);
  NOZ_X.forEach((_, j) => { const q = sp.qn * (1 - clogOf(p, j)); PLANTS.forEach((_, i) => { dep[i] += q * sp.etaRoot * W[j][i]; vol[i] += q * W[j][i]; }); });
  const cov = vol.map(v => 1 - Math.exp(-sp.depPerVol * v * 1e-6 * p.ton * sp.spotArea / A_R));
  return { dep, cov };
}
/** Accumulator: liquid volume ↔ pressure (isothermal Boyle, lesson Eq. 7.1.10). */
const preAbs = p => 0.9 * (p.p + PATM);
const vFromPg = (p, pg) => { const pa = pg + PATM, p0 = preAbs(p); return pa <= p0 ? 0 : p.vacc * 1000 * (1 - p0 / pa); };   // mL
const pgFromV = (p, v) => v <= 1e-6 ? 0 : preAbs(p) / (1 - v / (p.vacc * 1000)) - PATM;

/* ------------------------------------------------------------------ film ODE (one step for one plant) */
const evapPot = (rh, T) => HM * A_R * rhoVs(T) * Math.max(0, 1 - rh) * 1000;   // mL s⁻¹ (g s⁻¹) from a wet root system, Eq. 7.1.8
function filmStep(st, i, dt, dep, cap, Epot, Ud) {
  let V = st.V[i];
  V += dep * dt;
  const drain = V > cap ? Math.min(V - cap, (V - cap) / TAU_D * dt) / dt : 0;
  const fU = clamp(V / (PHI_C * cap), 0, 1);
  const Uact = Ud * fU;
  const E = Epot * clamp(V / (0.05 * cap), 0, 1);
  V = Math.max(0, V - (Uact + E + drain) * dt);
  // tissue water: drawn down when the film is gone, refilled after rewetting
  let th = st.th[i];
  const deficit = Ud - Uact, Etis = Epot * (1 - clamp(V / (0.05 * cap), 0, 1)) * th;
  th -= (F_DRAW * deficit + Etis) / W_TISSUE * dt;
  if (!st.dead[i] && V > 0.2 * cap) th += (1 - th) * (1 - Math.exp(-dt / TAU_REC));
  th = clamp(th, 0.2, 1);
  if (th < THETA_DEAD) st.dead[i] = true;
  st.V[i] = V; st.th[i] = th;
  return { Uact, E, drain, stress: 1 - fU };
}

/* ------------------------------------------------------------------ offline analyses (steady cycle, failure) */
function steadyCycle(p, sp, W) {
  const sup = plantSupply(p, sp, W); const cap = sup.cov.map(c => V_RET * Math.max(0.02, c));
  const st = { V: cap.slice(), th: new Array(PLANTS.length).fill(1), dead: new Array(PLANTS.length).fill(false) };
  const per = p.ton + p.toff * 60, dtOn = Math.min(0.5, p.ton / 4), dtOff = 2, Ud = p.uptake / 86400, Ep = evapPot(p.rh / 100, p.T);
  const nCyc = Math.max(4, Math.min(24, Math.ceil(3 * 3600 / per)));
  const acc = PLANTS.map(() => ({ min: 1e9, U: 0, E: 0, D: 0, S: 0, dep: 0 }));
  let tt = 0;
  for (let c = 0; c < nCyc; c++) {
    const last = c === nCyc - 1;
    for (let t = 0; t < per;) {
      const on = t < p.ton, dt = on ? Math.min(dtOn, p.ton - t) : Math.min(dtOff, per - t);
      for (let i = 0; i < PLANTS.length; i++) {
        const r = filmStep(st, i, dt, on ? sup.dep[i] : 0, cap[i], Ep, Ud);
        if (last) { const a = acc[i]; a.min = Math.min(a.min, st.V[i] / cap[i]); a.U += r.Uact * dt; a.E += r.E * dt; a.D += r.drain * dt; a.S += r.stress * dt; if (on) a.dep += sup.dep[i] * dt; }
      }
      if (last) tt += dt;
      t += dt;
    }
  }
  const perDay = 86400 / tt;
  return { sup, cap, plants: acc.map(a => ({ min: Math.min(1, a.min), U: a.U * perDay, E: a.E * perDay, D: a.D * perDay, S: a.S / tt, dep: a.dep * perDay })), dead: st.dead.some(Boolean) };
}
function failureRun(p, sp, W, cyc) {    // pump (and controller) stop at t = 0 after the steady state; chamber RH → RH_fail
  const st = { V: cyc.cap.map((c, i) => c * Math.max(0.3, cyc.plants[i].min)), th: new Array(PLANTS.length).fill(1), dead: new Array(PLANTS.length).fill(false) };
  let rh = p.rh / 100; const Ud = p.uptake / 86400, dt = 2;
  let tEmpty = null, tDead = null;
  for (let t = 0; t < 8 * 3600; t += dt) {
    rh += (p.rhFail / 100 - rh) * (1 - Math.exp(-dt / TAU_RH));
    const Ep = evapPot(rh, p.T);
    for (let i = 0; i < PLANTS.length; i++) filmStep(st, i, dt, 0, cyc.cap[i], Ep, Ud);
    if (tEmpty === null && st.V.some((v, i) => v < 0.02 * cyc.cap[i])) tEmpty = t;
    if (tDead === null && st.dead.some(Boolean)) { tDead = t; break; }
  }
  return { tEmpty, tDead };
}

/* ------------------------------------------------------------------ UI */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'd32', label: 'Sauter mean D₃₂ · count median', unit: 'µm', format: v => v, note: '&nbsp;' })
  .add({ id: 'flow', label: 'Flow per nozzle', unit: 'L h⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'vt', label: 'Settling velocity of a D₃₂ droplet', unit: 'mm s⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'eta', label: 'Spray deposited on roots', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'cov', label: 'Root surface hit per pulse', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'duty', label: 'Duty cycle (actual · minimum)', unit: '', format: v => v, note: '&nbsp;' })
  .add({ id: 'minfilm', label: 'Lowest root film in a cycle', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'rwsi', label: 'Root water-stress index (live)', unit: '', digits: 2, note: '&nbsp;' })
  .add({ id: 'tissue', label: 'Fine-root water content (live, driest plant)', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'nut', label: 'Nitrogen delivered · taken up', unit: 'mg d⁻¹', format: v => v, note: '&nbsp;' })
  .add({ id: 'spray', label: 'Solution sprayed per plant', unit: 'L d⁻¹', digits: 2, note: '&nbsp;' })
  .add({ id: 'surv', label: 'Pump failure: roots damaged after', unit: 'min', digits: 0, note: '&nbsp;' });

ui.section('Pump and nozzles');
ui.slider({ id: 'p', label: 'Pump pressure (cut-in, gauge)', min: 1, max: 10, step: 0.1, value: 6.5, unit: 'bar', help: 'High-pressure aeroponics ≈ 5.5–7 bar; low-pressure sprays < 3 bar. The pump restarts below this pressure and stops 1.5 bar above it.' });
ui.slider({ id: 'dor', label: 'Nozzle orifice diameter', min: 0.1, max: 0.8, step: 0.01, value: 0.3, unit: 'mm', help: 'Four nozzles on a stainless manifold, one under each pair of plants' });
ui.slider({ id: 'cone', label: 'Spray cone angle', min: 30, max: 150, step: 1, value: 90, unit: '°', help: 'Narrow cones squirt into the gap between the two rows of roots; wide cones wet the walls' });
ui.slider({ id: 'sg', label: 'Droplet-size spread σ<sub>g</sub>', min: 1.3, max: 2.6, step: 0.05, value: 1.8, help: 'Geometric standard deviation of the log-normal distribution (1 = all droplets equal)' });
ui.section('Misting cycle');
ui.slider({ id: 'ton', label: 'Spray pulse t<sub>on</sub>', min: 1, max: 60, step: 1, value: 5, unit: 's' });
ui.slider({ id: 'toff', label: 'Pause t<sub>off</sub>', min: 0.5, max: 30, step: 0.5, value: 5, unit: 'min' });
ui.section('Root chamber');
ui.slider({ id: 'rh', label: 'Chamber RH between pulses', min: 80, max: 100, step: 0.5, value: 98, unit: '%', help: 'A closed, dark chamber stays close to saturation' });
ui.slider({ id: 'T', label: 'Root-zone air temperature', min: 12, max: 32, step: 0.5, value: 20, unit: '°C' });
ui.slider({ id: 'uptake', label: 'Water uptake per plant', min: 20, max: 250, step: 5, value: 80, unit: 'mL d⁻¹', help: 'Lettuce ≈ 80 g d⁻¹ (≈ 2 kg m⁻² d⁻¹ at 25 plants m⁻²)' });
ui.slider({ id: 'cn', label: 'Nitrogen in the solution', min: 50, max: 300, step: 5, value: 150, unit: 'mg N L⁻¹' });
ui.section('Failures');
ui.slider({ id: 'clog', label: 'Clogging of nozzle 2', min: 0, max: 100, step: 5, value: 0, unit: '%', help: 'Precipitates or biofilm reduce the flow of the second nozzle from the left' });
ui.slider({ id: 'vacc', label: 'Accumulator volume', min: 0.5, max: 20, step: 0.5, value: 2, unit: 'L' });
ui.slider({ id: 'rhFail', label: 'Chamber RH after the mist stops', min: 50, max: 98, step: 1, value: 85, unit: '%', help: 'Leaky lids and dry room air pull the chamber below saturation' });
ui.toggle({ id: 'ups', label: 'Controller on a UPS (accumulator keeps spraying)', value: false });
const failBtns = ui.buttons([{ label: '⚡ Cut the power', variant: 'primary', onClick: () => setFail(true) }, { label: 'Restore power', onClick: () => setFail(false) }]);
ui.section('Simulation');
const playBtns = ui.buttons([{ label: '❚❚ Pause', variant: 'primary', onClick: () => clock.toggle() }, { label: 'Restart', onClick: () => resetSim() }]);
ui.segmented({ id: 'speed', label: 'Simulated time per real second', options: [{ value: 1, label: '1 s' }, { value: 10, label: '10 s' }, { value: 30, label: '30 s' }, { value: 120, label: '2 min' }], value: 10, persist: false });
ui.section('Display');
ui.segmented({ id: 'view', label: 'Root colours', options: [{ value: 'real', label: 'Realistic' }, { value: 'wet', label: 'Film map' }], value: 'real' });
ui.toggle({ id: 'labels', label: 'Component labels', value: true });
ui.buttons([{ label: 'Root zone', onClick: () => stage.flyTo([0.55, 1.02, 1.05], [0.05, 0.98, 0]) }, { label: 'Hardware', onClick: () => stage.flyTo([0.35, 0.75, 1.75], [-0.25, 0.35, 0]) }, { label: 'Overview', onClick: () => stage.resetView() }]);
ui.presets([
  { label: 'Well-tuned HPA', values: { p: 6.5, dor: 0.3, cone: 90, sg: 1.8, ton: 5, toff: 5, rh: 98, T: 20, clog: 0 } },
  { label: 'Long pauses', values: { p: 6.5, dor: 0.3, cone: 90, sg: 1.8, ton: 5, toff: 20, rh: 97, T: 22, clog: 0 } },
  { label: 'Low-pressure spray', values: { p: 2, dor: 0.8, cone: 110, sg: 2.0, ton: 10, toff: 5, rh: 98, T: 20, clog: 0 } },
  { label: 'Ultra-fine mist', values: { p: 10, dor: 0.1, cone: 90, sg: 1.6, ton: 10, toff: 3, rh: 96, T: 20, clog: 0 } },
  { label: 'Clogged nozzle', values: { p: 6.5, dor: 0.3, cone: 60, sg: 1.8, ton: 5, toff: 8, rh: 97, T: 22, clog: 90 } },
  { label: 'Warm, leaky chamber', values: { p: 6.5, dor: 0.3, cone: 90, sg: 1.8, ton: 5, toff: 10, rh: 90, T: 28, uptake: 140, clog: 0, rhFail: 70 } }
]);
ui.saveButton('aeroponic-chamber', () => ro.values());

/* ------------------------------------------------------------------ 3D scene */
const stage = createStage('#stage', {
  background: '#0a0f0d', envIntensity: 0.45, exposure: 1.0,
  camera: { pos: [1.62, 1.52, 2.15], target: [0.0, 0.86, 0], fov: 39 },
  controls: { minDistance: 0.35, maxDistance: 7, maxPolarAngle: Math.PI * 0.53 },
  bloom: { strength: 0.5, radius: 0.35, threshold: 1.0 }, ao: { radius: 0.12, intensity: 0.85 },
  hint: 'Drag to orbit · scroll to zoom · click a component · space = play/pause'
});
const { scene } = stage;
studioLights(stage, { intensity: 0.62, shadowSize: 1.6, keyPos: [2.2, 4.2, 2.6] });
const room = makeRoom({ w: 7, d: 6, h: 3.2, wallColor: 0x39403c, floor: 'epoxy' });
room.floor.material.color.set(0x9aa19d); scene.add(room);
const hud = hudChips(stage.el);
const info = document.createElement('div'); info.className = 'stage-legend'; info.style.maxWidth = '330px'; info.style.lineHeight = '1.45'; stage.el.appendChild(info);

const steel = M.galvanised(), black = M.plastic(0x1f2327, 0.55), white = M.plastic(0xecece6, 0.45);
const tube = M.plastic(0x121314, 0.4);
const pickables = [];
function tag(obj, key) { obj.traverse(m => { if (m.isMesh) { m.userData.comp = key; pickables.push(m); } }); return obj; }
const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; };
const cyl = (r, h, mat, x, y, z, seg = 24) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; };

/* ---- stand */
const stand = new THREE.Group(); scene.add(stand);
[[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => stand.add(box(0.04, Y0 - 0.02, 0.04, steel, a * (CH_L / 2 + 0.01), (Y0 - 0.02) / 2, b * (CH_D / 2 + 0.01))));
[-1, 1].forEach(b => { stand.add(box(CH_L + 0.06, 0.04, 0.04, steel, 0, Y0 - 0.03, b * (CH_D / 2 + 0.01))); stand.add(box(CH_L + 0.06, 0.03, 0.03, steel, 0, 0.12, b * (CH_D / 2 + 0.01))); });
[-1, 1].forEach(a => stand.add(box(0.04, 0.04, CH_D + 0.06, steel, a * (CH_L / 2 + 0.01), Y0 - 0.03, 0)));
[-1, 1].forEach(a => [-1, 1].forEach(b => { const f = cyl(0.028, 0.012, M.rubber(), a * (CH_L / 2 + 0.01), 0.006, b * (CH_D / 2 + 0.01), 16); stand.add(f); }));

/* ---- chamber body (opaque HDPE) with a transparent inspection window at the front */
const chamber = new THREE.Group(); chamber.position.y = Y0; scene.add(chamber);
const WT = 0.014, HW = H_IN + 0.02;
chamber.add(box(CH_L, WT, CH_D, black, 0, WT / 2, 0));
chamber.add(box(CH_L, HW, WT, black, 0, HW / 2, -CH_D / 2 + WT / 2));
[-1, 1].forEach(a => chamber.add(box(WT, HW, CH_D - 2 * WT, black, a * (CH_L / 2 - WT / 2), HW / 2, 0)));
const win = new THREE.Mesh(new THREE.PlaneGeometry(CH_L - 0.04, HW - 0.03), M.glassCheap(0.08)); win.position.set(0, HW / 2 + 0.005, CH_D / 2 - 0.004); chamber.add(win);
// condensation on the inside of the window (opacity follows the chamber humidity)
const dropsTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512; const c = cv.getContext('2d');
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2600; i++) { const x = r() * 512, y = r() * 512, s = 0.6 + Math.pow(r(), 3) * 7; const g = c.createRadialGradient(x - s * 0.3, y - s * 0.3, 0, x, y, s); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.55, 'rgba(220,235,240,0.45)'); g.addColorStop(1, 'rgba(200,220,230,0)'); c.fillStyle = g; c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill(); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1.2); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const condMat = new THREE.MeshBasicMaterial({ map: dropsTex, transparent: true, opacity: 0.2, depthWrite: false });
const cond = new THREE.Mesh(new THREE.PlaneGeometry(CH_L - 0.04, HW - 0.03), condMat); cond.position.set(0, HW / 2 + 0.005, CH_D / 2 - 0.009); cond.rotation.y = Math.PI; chamber.add(cond);
const frameMat = M.plastic(0x15181a, 0.5);
chamber.add(box(CH_L, 0.02, 0.02, frameMat, 0, 0.01, CH_D / 2 - 0.004)); chamber.add(box(CH_L, 0.02, 0.02, frameMat, 0, HW - 0.004, CH_D / 2 - 0.004));
[-1, 1].forEach(a => chamber.add(box(0.02, HW, 0.02, frameMat, a * (CH_L / 2 - 0.01), HW / 2, CH_D / 2 - 0.004)));
tag(chamber, 'chamber');
// lid with 8 plant holes
const LID_T = 0.025, lidY = HW;
{
  const s = new THREE.Shape(); const lw = CH_L + 0.04, ld = CH_D + 0.04; s.moveTo(-lw / 2, -ld / 2); s.lineTo(lw / 2, -ld / 2); s.lineTo(lw / 2, ld / 2); s.lineTo(-lw / 2, ld / 2); s.lineTo(-lw / 2, -ld / 2);
  PLANTS.forEach(pl => { const h = new THREE.Path(); h.absarc(pl.x, -pl.z, 0.03, 0, Math.PI * 2, true); s.holes.push(h); });
  const g = new THREE.ExtrudeGeometry(s, { depth: LID_T, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 1, curveSegments: 24 }); g.rotateX(-Math.PI / 2);
  const lid = new THREE.Mesh(g, white); lid.position.y = lidY; lid.castShadow = true; lid.receiveShadow = true; chamber.add(lid); tag(lid, 'chamber');
}
// sloping floor insert, drain sump and outlet at the +x end
const sump = cyl(0.03, 0.03, black, CH_L / 2 - 0.09, 0.0, 0.16); chamber.add(sump);
const puddleMat = M.waterCheap(0x23403c, 0.3);
const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.1, 32), puddleMat); puddle.rotation.x = -Math.PI / 2; puddle.scale.set(1.3, 1.6, 1); puddle.position.set(CH_L / 2 - 0.12, WT + 0.002, 0.1); chamber.add(puddle);
// inspection light inside the chamber (real chambers are dark; this lets you see the roots)
const inspect = new THREE.PointLight(0xfff4e6, 0.35, 1.4, 2); inspect.position.set(0, H_IN - 0.06, 0.2); chamber.add(inspect);

/* ---- manifold and nozzles */
const manifold = makePipe([[-CH_L / 2 - 0.12, 0.06, 0], [-CH_L / 2 + 0.02, 0.06, 0], [CH_L / 2 - 0.06, 0.06, 0]], { radius: 0.009, material: M.steel(), tension: 0 });
chamber.add(manifold); tag(manifold, 'nozzle');
const nozzles = NOZ_X.map((x, j) => {
  const g = new THREE.Group(); g.position.set(x, 0.06, 0);
  const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.018, 6), M.brass()); hex.position.y = 0.017; g.add(hex);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.008, 0.014, 20), M.steel()); tip.position.y = 0.032; g.add(tip);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0055, 0.004, 20), M.steel()); cap.position.y = 0.041; g.add(cap);
  g.traverse(m => { if (m.isMesh) m.castShadow = true; });
  chamber.add(g); tag(g, 'nozzle'); return g;
});
const NOZ_TIP_Y = Y0 + 0.06 + 0.044;
const mist = new Mist({ nozzles: NOZ_X.map(x => ({ pos: [x, NOZ_TIP_Y, 0], dir: [0, 1, 0] })), max: 7000, rate: 600, speed: 1.2, cone: 2, size: 0.011, life: 2.2, color: 0xe6f6ff, gravity: 0.2, drag: 3 });
mist.on = false; scene.add(mist.points);
mist.mat.opacity = 0.5;
// fog that fills the chamber after each pulse
const fogMat = new THREE.MeshBasicMaterial({ color: 0xdfeef3, transparent: true, opacity: 0, depthWrite: false });
const fog = new THREE.Mesh(new THREE.BoxGeometry(CH_L - 0.04, H_IN - 0.02, CH_D - 0.05), fogMat); fog.position.set(0, Y0 + H_IN / 2 + 0.01, 0); fog.renderOrder = 2; scene.add(fog);

/* ---- plants, net pots, roots and root-hair curtains */
const lettGeos = [0, 1, 2].map(s => lettuceGeometry({ radius: 0.135, growth: 0.82, leaves: 18, variety: 'butterhead', seed: 21 + s * 5 }));
const baseLeaf = leafMaterial({ gloss: 0.45 });
const hairTex = (() => {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512; const c = cv.getContext('2d');
  let seed = 3; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  c.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    let x = 128 + (r() - 0.5) * 220 * Math.pow(r(), 0.6), y = r() * 30; const len = 250 + r() * 260;
    c.strokeStyle = `rgba(255,255,255,${0.18 + r() * 0.55})`; c.lineWidth = 0.5 + r() * 1.8; c.beginPath(); c.moveTo(x, y);
    let dx = (r() - 0.5) * 0.6;
    for (let s = 0; s < len; s += 10) { dx += (r() - 0.5) * 0.35; dx *= 0.92; x += dx * 10 * 0.3; y += 10; c.lineTo(x, y); if (r() < 0.05) { c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 40, y + 10 + r() * 22); c.moveTo(x, y); } }
    c.stroke();
  }
  // fine hairs (fuzz)
  for (let i = 0; i < 2200; i++) { const x = 128 + (r() - 0.5) * 230 * Math.pow(r(), 0.5), y = r() * 480; c.strokeStyle = `rgba(255,255,255,${0.05 + r() * 0.18})`; c.lineWidth = 0.5; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 7, y + (r() - 0.5) * 7); c.stroke(); }
  c.globalCompositeOperation = 'destination-in';
  const g = c.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.72, 'rgba(0,0,0,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 256, 512);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
})();
const plants = PLANTS.map((pl, i) => {
  const g = new THREE.Group(); g.position.set(pl.x, Y0 + lidY + LID_T, pl.z); scene.add(g);
  const pot = makeNetPot({ radius: 0.026, height: 0.05 }); pot.position.y = 0.002; g.add(pot);
  const plug = new THREE.Mesh(new RoundedBoxGeometry(0.036, 0.04, 0.036, 2, 0.004), M.rockwool()); plug.position.y = -0.018; g.add(plug);
  const leafMat = baseLeaf.clone();
  const lett = new THREE.Mesh(lettGeos[i % 3], leafMat); lett.position.y = 0.012; lett.rotation.y = i * 1.3; lett.castShadow = true; lett.receiveShadow = true; g.add(lett);
  const rootMat = new THREE.MeshPhysicalMaterial({ color: 0xf1ecdc, roughness: 0.5, sheen: 0.5, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.3 });
  const roots = makeRoots({ count: 18, length: 0.30 + (i % 3) * 0.02, spread: 0.028, thickness: 0.0019, laterals: 2, seed: 40 + i * 3 });
  roots.material = rootMat; roots.position.y = -(LID_T + 0.03); g.add(roots);
  const hairMat = new THREE.MeshStandardMaterial({ map: hairTex, color: 0xf6f2e6, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, roughness: 0.7 });
  const cards = [];
  for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.34), hairMat); c.position.y = -(LID_T + 0.03) - 0.17; c.rotation.y = k * Math.PI / 3 + i; c.renderOrder = 1; g.add(c); cards.push(c); }
  tag(roots, 'roots'); tag(lett, 'plant');
  return { g, lett, leafMat, rootMat, hairMat, roots, cards, wilt: 0, tipY: g.position.y + roots.position.y - 0.3 };
});

/* ---- reservoir, filter, pump, accumulator, gauge, solenoid, controller */
const tank = makeTank({ w: 0.56, h: 0.40, d: 0.42, material: 'plastic', color: 0x263038, level: 0.72, waterTint: 0x4f8f7e });
tank.position.set(0.33, 0, 0.02); scene.add(tank); tag(tank, 'tank');
const tankLid = box(0.30, 0.012, 0.44, white, 0.33 + 0.13, 0.406, 0.02); scene.add(tankLid); tag(tankLid, 'tank');
// filter
const filt = new THREE.Group(); filt.position.set(-0.05, 0, 0.26); scene.add(filt);
filt.add(cyl(0.05, 0.05, M.plastic(0x2f6fd6, 0.35), 0, 0.24, 0));
const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.04, 0.17, 28), M.glassCheap(0.25)); bowl.position.y = 0.13; filt.add(bowl);
filt.add(cyl(0.028, 0.15, M.plastic(0xf2f0e8, 0.8), 0, 0.13, 0));
filt.add(box(0.12, 0.02, 0.05, steel, 0, 0.275, 0));
tag(filt, 'filter');
// pump (motor + diaphragm head)
const pump = new THREE.Group(); pump.position.set(-0.36, 0, 0.18); scene.add(pump);
pump.add(box(0.30, 0.018, 0.17, steel, 0, 0.009, 0));
const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.17, 32), M.paintedSteel(0x2c4a6a)); motor.rotation.z = Math.PI / 2; motor.position.set(0.02, 0.085, 0); pump.add(motor);
for (let k = 0; k < 9; k++) { const fin = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.004, 6, 32), M.paintedSteel(0x2c4a6a)); fin.rotation.y = Math.PI / 2; fin.position.set(-0.05 + k * 0.016, 0.085, 0); pump.add(fin); }
const fanCov = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.03, 32), M.plasticBlack()); fanCov.rotation.z = Math.PI / 2; fanCov.position.set(0.12, 0.085, 0); pump.add(fanCov);
const head = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.12, 0.11, 3, 0.012), M.aluminium()); head.position.set(-0.1, 0.075, 0); pump.add(head);
pump.add(cyl(0.012, 0.03, M.brass(), -0.1, 0.15, 0.03)); pump.add(cyl(0.012, 0.03, M.brass(), -0.1, 0.15, -0.03));
const pumpLed = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), M.emissive(0x2cff6a, 0.1)); pumpLed.position.set(0.02, 0.155, 0.03); pump.add(pumpLed);
const junction = box(0.06, 0.04, 0.05, M.plasticGrey(), 0.03, 0.16, 0); pump.add(junction);
tag(pump, 'pump');
// accumulator (bladder type) with pressure gauge and pressure switch
const accG = new THREE.Group(); accG.position.set(-0.52, 0, -0.14); scene.add(accG);
const accMat = M.paintedSteel(0xa32a2c);
accG.add(cyl(0.075, 0.22, accMat, 0, 0.2, 0, 36));
[0.31, 0.09].forEach((y, k) => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.075, 36, 16, 0, Math.PI * 2, k ? Math.PI / 2 : 0, Math.PI / 2), accMat); s.position.y = y; s.castShadow = true; accG.add(s); });
accG.add(cyl(0.012, 0.04, M.brass(), 0, 0.4, 0)); accG.add(cyl(0.02, 0.05, M.steel(), 0, 0.04, 0));
accG.add(box(0.2, 0.02, 0.16, steel, 0, 0.01, 0));
const gaugeG = new THREE.Group(); gaugeG.position.set(0.1, 0.2, 0.06); accG.add(gaugeG);
{
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d');
  c.fillStyle = '#f7f6f0'; c.beginPath(); c.arc(128, 128, 126, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#222'; c.fillStyle = '#222'; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let v = 0; v <= 10; v += 0.5) { const a = (-225 + 270 * v / 10) * Math.PI / 180; const r1 = v % 1 === 0 ? 92 : 100; c.lineWidth = v % 1 === 0 ? 4 : 2; c.beginPath(); c.moveTo(128 + Math.cos(a) * r1, 128 + Math.sin(a) * r1); c.lineTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); c.stroke(); if (v % 2 === 0) { c.font = '600 26px Inter, sans-serif'; c.fillText(String(v), 128 + Math.cos(a) * 70, 128 + Math.sin(a) * 70); } }
  c.strokeStyle = '#c0392b'; c.lineWidth = 8; c.beginPath(); c.arc(128, 128, 106, (-225 + 270 * 0.55) * Math.PI / 180, (-225 + 270 * 0.75) * Math.PI / 180); c.stroke();
  c.font = '600 22px Inter, sans-serif'; c.fillText('bar', 128, 178);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const dial = new THREE.Mesh(new THREE.CircleGeometry(0.036, 40), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 })); gaugeG.add(dial);
  const bez = new THREE.Mesh(new THREE.TorusGeometry(0.037, 0.004, 10, 40), M.steel()); gaugeG.add(bez);
  const glassG = new THREE.Mesh(new THREE.CircleGeometry(0.036, 40), M.glassCheap(0.12)); glassG.position.z = 0.004; gaugeG.add(glassG);
  gaugeG.add(cyl(0.006, 0.06, M.brass(), -0.03, 0, -0.03));
}
const needle = new THREE.Group(); needle.position.z = 0.002; gaugeG.add(needle);
{ const nm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.0025, 0.001), new THREE.MeshStandardMaterial({ color: 0x111111 })); nm.position.x = 0.013; needle.add(nm); const hub = new THREE.Mesh(new THREE.CircleGeometry(0.004, 16), new THREE.MeshStandardMaterial({ color: 0x111111 })); hub.position.z = 0.001; needle.add(hub); }
const pswitch = box(0.05, 0.06, 0.04, M.plasticGrey(), -0.07, 0.36, 0.06); accG.add(pswitch);
tag(accG, 'accumulator');
// solenoid valve at the chamber inlet
const sol = new THREE.Group(); sol.position.set(-CH_L / 2 - 0.12, Y0 + 0.06, 0); scene.add(sol);
sol.add(box(0.05, 0.035, 0.035, M.brass(), 0, 0, 0));
const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.045, 24), M.plasticBlack()); coil.position.y = 0.04; sol.add(coil);
sol.add(box(0.03, 0.03, 0.032, M.plasticGrey(), 0.02, 0.07, 0));
const solLedMat = M.emissive(0xff3a2c, 0.05); const solLed = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 12, 8), solLedMat); solLed.position.set(0.036, 0.075, 0.012); sol.add(solLed);
tag(sol, 'solenoid');
// timer / controller on a post at the −x end
const ctrl = new THREE.Group(); ctrl.position.set(-CH_L / 2 - 0.2, Y0 + 0.28, 0.18); ctrl.rotation.y = 0.55; scene.add(ctrl);
ctrl.add(box(0.2, 0.26, 0.08, M.plastic(0xd9dcd8, 0.45), 0, 0, 0));
const scrCv = document.createElement('canvas'); scrCv.width = 320; scrCv.height = 160; const scrCtx = scrCv.getContext('2d');
const scrTex = new THREE.CanvasTexture(scrCv); scrTex.colorSpace = THREE.SRGBColorSpace;
const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.075), new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false })); screen.position.set(0, 0.05, 0.041); ctrl.add(screen);
const ledG = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), M.emissive(0x2cff6a, 2)); ledG.position.set(-0.05, -0.05, 0.043); ctrl.add(ledG);
const ledA = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), M.emissive(0xffb020, 0.05)); ledA.position.set(-0.02, -0.05, 0.043); ctrl.add(ledA);
const ledR = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), M.emissive(0xff2a2a, 0.05)); ledR.position.set(0.01, -0.05, 0.043); ctrl.add(ledR);
[-0.05, 0.02].forEach(x => { const b = cyl(0.009, 0.01, M.plasticBlack(), x + 0.02, -0.095, 0.04, 16); b.rotation.x = Math.PI / 2; ctrl.add(b); });
const post = box(0.035, Y0 + 0.14, 0.035, steel, -CH_L / 2 - 0.2, (Y0 + 0.14) / 2, 0.18); scene.add(post);
tag(ctrl, 'controller');
// grow light above the plants
const growLight = makeLEDBar({ length: 1.2, width: 0.12, color: 'full', light: 'rect', lightIntensity: 3.2 });
growLight.position.set(0, Y0 + 1.1, 0); scene.add(growLight);
[-0.5, 0.5].forEach(x => { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 1.2, 6), M.steel()); w.position.set(x, Y0 + 1.1 + 0.6, 0); scene.add(w); });

/* ---- tubing and flow particles */
const suction = makePipe([[0.2, 0.08, 0.02], [0.2, 0.44, 0.02], [0.1, 0.46, 0.14], [0.0, 0.3, 0.26], [-0.05, 0.27, 0.26]], { radius: 0.006, material: tube });
const toPump = makePipe([[-0.05, 0.25, 0.23], [-0.2, 0.2, 0.2], [-0.35, 0.16, 0.21], [-0.46, 0.155, 0.21]], { radius: 0.006, material: tube });
const pressureLine = makePipe([[-0.46, 0.155, 0.15], [-0.52, 0.3, 0.02], [-0.52, 0.43, -0.14], [-0.6, 0.6, -0.1], [-0.77, 0.75, -0.02], [-CH_L / 2 - 0.12, Y0 + 0.06, 0]], { radius: 0.006, material: tube });
const drainPipe = makePipe([[CH_L / 2 - 0.09, Y0 - 0.02, 0.16], [CH_L / 2 - 0.09, 0.62, 0.16], [0.52, 0.47, 0.1], [0.5, 0.40, 0.05]], { radius: 0.016, material: M.pvc() });
[suction, toPump, pressureLine, drainPipe].forEach(pp => scene.add(pp));
tag(pressureLine, 'pressure'); tag(drainPipe, 'drain'); tag(suction, 'filter');
const flowP = new FlowAlong(pressureLine.curve, { count: 60, speed: 0.6, size: 0.012, color: 0x7fd4ff, jitter: 0.004 });
const flowS = new FlowAlong(toPump.curve, { count: 30, speed: 0.4, size: 0.011, color: 0x7fd4ff, jitter: 0.004 });
const flowD = new FlowAlong(drainPipe.curve, { count: 40, speed: 0.35, size: 0.016, color: 0x9ee8c8, jitter: 0.008 });
[flowP, flowS, flowD].forEach(f => scene.add(f.points));
// drips from root tips
const DRIP_N = 260, dripPos = new Float32Array(DRIP_N * 3), dripV = new Float32Array(DRIP_N), dripOn = new Uint8Array(DRIP_N);
const dripGeo = new THREE.BufferGeometry(); dripGeo.setAttribute('position', new THREE.BufferAttribute(dripPos, 3));
const drips = new THREE.Points(dripGeo, new THREE.PointsMaterial({ color: 0xcfefff, size: 0.008, transparent: true, opacity: 0.85, depthWrite: false })); drips.frustumCulled = false; scene.add(drips);
for (let k = 0; k < DRIP_N; k++) dripPos[k * 3 + 1] = -99;
let dripAcc = 0;

/* ---- labels */
const LBL = {};
const lab = (key, obj, off, html, small) => { LBL[key] = stage.addLabel(obj, html, { offset: off, className: small ? 'label3d sm' : 'label3d' }); };
lab('pump', pump, [-0.02, 0.22, 0.04], 'HP pump');
lab('acc', accG, [-0.08, 0.46, 0.02], 'Accumulator');
lab('sol', sol, [-0.08, -0.2, 0.05], 'Solenoid valve', true);
lab('ctrl', ctrl, [-0.06, 0.2, 0], 'Timer', true);
lab('noz', chamber, [0.22, 0.02, 0.31], 'Nozzles');
lab('roots', chamber, [0.36, 0.3, 0.31], 'Root curtain');
lab('tank', tank, [0.26, 0.28, 0.22], 'Reservoir', true);
lab('drain', drainPipe, [CH_L / 2 + 0.08, 0.64, 0.22], 'Drain', true);

/* ------------------------------------------------------------------ charts */
const wetPlot = new Plot('#chart-wet', { x: { label: 'Simulated time', unit: 'min' }, y: { label: 'Water', unit: '% of capacity', min: 0, max: 106 }, y2: { label: 'Chamber RH', unit: '%', min: 60, max: 101 } });
const dsdPlot = new Plot('#chart-dsd', { x: { label: 'Droplet diameter', unit: 'µm', min: 1, max: 500, log: true }, y: { label: 'Relative amount · deposition efficiency', unit: '', min: 0, max: 1.05 }, y2: { label: 'Settling velocity', unit: 'mm s⁻¹', min: 0.01, max: 3000, log: true, format: v => v >= 1 ? String(Math.round(v)) : String(v) } });
const waterBar = new BarChart('#chart-water', { horizontal: true, stacked: true, y: { label: 'Water leaving the system per plant', unit: 'mL d⁻¹', min: 0 }, height: 210 });
const waterTable = document.getElementById('water-table');

/* ------------------------------------------------------------------ model state */
let P = ui.values(), SP = null, SPlive = null, W = null, CYC = null, FAILR = null;
const S = {};
function resetSim() {
  P = ui.values();
  Object.assign(S, { t: 0, t0: 0, V: CYC ? CYC.cap.map((c, i) => c * 0.9) : PLANTS.map(() => V_RET * 0.9), th: PLANTS.map(() => 1), dead: PLANTS.map(() => false), rh: P.rh / 100, pg: P.p + 0.8, vliq: 0, pump: false, open: false, fail: false, tFail: null, drain: 0, hist: [], visOpenUntil: 0, pulses: 0, lastOpen: false, stressAvg: PLANTS.map(() => 0), openSeen: false, lastRec: -1e9 });
  S.vliq = vFromPg(P, S.pg);
  clock.reset(0);
}
function setFail(on) {
  if (on && !S.fail) { S.fail = true; S.tFail = S.t; FFP.toast && FFP.toast('Power cut — the pump stops'); }
  if (!on && S.fail) { S.fail = false; S.tFail = null; FFP.toast && FFP.toast('Power restored'); }
}
let spCacheKey = '';
function spAt(pg) {           // spray model at the actual (live) pressure, cached in 0.1-bar steps
  const key = specKey() + '|' + (Math.round(pg * 10) / 10);
  if (key !== spCacheKey) { spCacheKey = key; SPlive = sprayModel(P, Math.max(0.3, Math.round(pg * 10) / 10)); }
  return SPlive;
}
const specKey = () => [P.dor, P.cone, P.sg, P.rh, P.T, P.ton].join('|');

function stepSim(dt) {
  const p = P; S.t += dt;
  const per = p.ton + p.toff * 60, phase = ((S.t - S.t0) % per + per) % per;
  const powered = !S.fail, ctrlOn = powered || p.ups;
  // pump with pressure switch
  if (powered) { if (S.pg < p.p) S.pump = true; else if (S.pg > p.p + P_BAND) S.pump = false; } else S.pump = false;
  const open = ctrlOn && phase < p.ton;
  if (open && !S.lastOpen) { S.pulses++; S.visOpenUntil = performance.now() + Math.max(900, p.ton / Math.max(1, clock.speed) * 1000); }
  S.lastOpen = open; S.open = open;
  const pg = Math.max(0, S.pg);
  const qn = pg > 0.2 ? nozzleQ(p.dor, pg) * 1e6 : 0;                 // mL s⁻¹ per nozzle
  const qOut = open ? NOZ_X.reduce((a, _, j) => a + qn * (1 - clogOf(p, j)), 0) : 0;
  S.vliq = clamp(S.vliq + ((S.pump ? Q_PUMP : 0) - qOut) * dt, 0, p.vacc * 1000 * 0.97);
  S.pg = pgFromV(p, S.vliq);
  // chamber humidity: saturated while the mist runs, relaxing towards the room when it stops for long
  const rhT = S.fail && !(p.ups && S.pg > 0.5) ? p.rhFail / 100 : p.rh / 100;
  S.rh += (rhT - S.rh) * (1 - Math.exp(-dt / TAU_RH));
  // deposition
  let depArr = null;
  if (open && qn > 0) { const sp = spAt(pg); depArr = plantSupply(p, sp, W).dep; }
  const Ud = p.uptake / 86400, Ep = evapPot(S.rh, p.T); let drainTot = 0;
  PLANTS.forEach((_, i) => {
    const r = filmStep(S, i, dt, depArr ? depArr[i] : 0, CYC.cap[i], Ep, Ud);
    drainTot += r.drain; S.stressAvg[i] += (r.stress - S.stressAvg[i]) * (1 - Math.exp(-dt / 180));
  });
  S.drain = drainTot + (open ? qOut * (1 - (spAt(pg).etaRoot)) * 0.6 : 0);   // mL s⁻¹ reaching the drain (roots + walls)
  if (open) S.openSeen = true;
  if (S.t - S.lastRec >= 4) recordSample();
}
const clock = new SimClock({ speed: 10, maxDt: 0.25, onStep: dt => stepSim(dt), onFrame: () => { } });
clock.onState(run => { playBtns[0].innerHTML = run ? '❚❚ Pause' : '▶ Play'; });
stage.onKey('space', () => clock.toggle());

/* ------------------------------------------------------------------ recompute the steady-state analyses */
function recompute() {
  P = ui.values(); clock.speed = +P.speed;
  const pMean = P.p + P_BAND / 2;
  SP = sprayModel(P, pMean); W = shareMatrix(P.cone);
  CYC = steadyCycle(P, SP, W); FAILR = failureRun(P, SP, W, CYC);
  if (!S.V) resetSim();
  // visual mist parameters
  const d = SP.D32, vt = SP.vt32;
  mist.rate = 260 + 180 * SP.qn * 3.6 / 5.5;          // particles s⁻¹ per nozzle (visual)
  mist.cone = 2 * Math.tan(P.cone / 2 * Math.PI / 180) * 0.85;
  mist.mat.size = clamp(0.022 + d * 0.00018, 0.02, 0.055);
  mist.drag = clamp(4.5 - d / 40, 1.2, 4.5);
  mist.gravity = clamp(0.03 + 0.9 * vt, 0.03, 1.2) * mist.drag;
  mist.speed = 0.7 + 0.13 * Math.sqrt(pMean) * (P.dor / 0.3);
  mist.life = clamp(3.0 - d / 60, 0.9, 3.0);
  mist.mat.opacity = clamp(0.28 + 0.003 * d, 0.28, 0.6);
  updateReadouts(); drawDSD(); drawWater();
  LBL.noz.element.innerHTML = `Nozzles ×4<small>${fmt(SP.qn * 3.6, 1)} L h⁻¹ · D₃₂ ${fmt(SP.D32, 0)} µm</small>`;
}
function updateReadouts() {
  const p = P, sp = SP, pl = CYC.plants;
  ro.set('d32', `${fmt(sp.D32, 1)} · ${fmt(sp.CMD, 1)}`, sp.D32 < 8 ? 'warn' : sp.D32 > 80 ? 'warn' : 'ok', sp.D32 < 8 ? 'fog: poor deposition' : sp.D32 > 80 ? 'coarse: patchy wetting' : `HPA range · MMD ${fmt(sp.MMD, 0)} µm`);
  ro.set('flow', sp.qn * 3.6, null, `at ${fmt(p.p + P_BAND / 2, 1)} bar · jet ${fmt(Math.sqrt(2 * (p.p + P_BAND / 2) * 1e5 / RHO_W), 0)} m s⁻¹`);
  ro.set('vt', sp.vt32 * 1000, null, `falls ${fmt(H_IN * 100, 0)} cm in ${fmt(H_IN / sp.vt32, 1)} s · evaporates in ${sp.te32 > 1e5 ? '∞' : fmt(sp.te32, 1) + ' s'}`);
  const eta = sp.etaRoot * 100;
  ro.set('eta', eta, eta > 35 ? 'ok' : eta > 20 ? 'warn' : 'bad', `walls ${fmt(sp.fDrain * 100, 0)} % · evaporated ${fmt(sp.fEvap * 100, 0)} % · cone ${fmt(sp.phi * 100, 0)} % on roots`);
  const cov = Math.min(...CYC.sup.cov) * 100;
  ro.set('cov', cov, cov > 85 ? 'ok' : cov > 60 ? 'warn' : 'bad', 'driest plant, one pulse');
  const per = p.ton + p.toff * 60, duty = 100 * p.ton / per;
  const qPlant = CYC.sup.dep.reduce((a, b) => a + b, 0) / PLANTS.length;
  const dmin = 100 * (p.uptake / 86400) / Math.max(1e-9, Math.min(...CYC.sup.dep));
  ro.set('duty', `${fmt(duty, 2)} % · ${fmt(dmin, 2)} %`, duty >= dmin ? 'ok' : 'bad', duty >= dmin ? 'above the minimum (Eq. 7.1.7)' : 'too little mist for the uptake');
  const mf = Math.min(...pl.map(x => x.min)) * 100;
  ro.set('minfilm', mf, mf > 50 ? 'ok' : mf > PHI_C * 100 ? 'warn' : 'bad', `mean over plants ${fmt(pl.reduce((a, x) => a + x.min, 0) / pl.length * 100, 0)} %`);
  const nDel = pl.reduce((a, x) => a + x.dep, 0) / pl.length * p.cn / 1000, nUp = pl.reduce((a, x) => a + x.U, 0) / pl.length * p.cn / 1000;
  ro.set('nut', `${fmt(nDel, 0)} · ${fmt(nUp, 1)}`, nUp >= 0.95 * p.uptake * p.cn / 1000 ? 'ok' : 'warn', `${fmt(qPlant * p.ton * p.cn / 1000, 2)} mg N per plant per pulse`);
  const sprayDay = SP.qn * NOZ_X.reduce((a, _, j) => a + (1 - clogOf(p, j)), 0) * p.ton * 86400 / per / PLANTS.length / 1000;
  ro.set('spray', sprayDay, null, `${fmt(sprayDay * 1000 / p.uptake, 0)} × the plant's uptake; excess drains`);
  const td = FAILR.tDead;
  ro.set('surv', td != null ? td / 60 : NaN, td == null ? 'ok' : td < 1800 ? 'bad' : 'warn', td == null ? 'no damage within 8 h' : `film gone after ${fmt(FAILR.tEmpty / 60, 0)} min at RH → ${p.rhFail} %`);
}
function drawDSD() {
  const b = SP.bins; const mxN = Math.max(...b.map(x => x.fN)), mxV = Math.max(...b.map(x => x.fV));
  const xs = b.map(x => x.d);
  dsdPlot.region('fog', 1, 10, { color: 'magenta', alpha: 0.06, label: 'fog' });
  dsdPlot.region('lpa', 100, 500, { color: 'water', alpha: 0.05, label: 'coarse' });
  dsdPlot.line('n', xs, b.map(x => x.fN / mxN), { color: 'accent', width: 2.2, fill: 0.12, label: 'number' });
  dsdPlot.line('v', xs, b.map(x => x.fV / mxV), { color: 'water', width: 2.2, fill: 0.1, label: 'volume' });
  dsdPlot.line('eta', xs, b.map(x => x.root), { color: 'magenta', width: 2.4, label: 'deposited on roots' });
  dsdPlot.line('vt', xs, b.map(x => x.vt * 1000), { color: 'amber', width: 1.8, dash: [6, 4], label: 'settling velocity', y2: true });
  dsdPlot.vline('d32', SP.D32, { color: 'ink', dash: [4, 4], label: 'D₃₂' });
}
// comparison systems (per plant) — illustrative designs, see chart caption and Assumptions tab
const NFT = { vol: 3.0, evap: 5, pumped: 1.5 * 1440 / 20, buffer: 0.07 };
const DWC = { vol: 10.0, evap: 3, pumped: 0, buffer: 10 };
const AERO_VOL = 2.0, REPLACE_D = 21;
function drawWater() {
  const pl = CYC.plants, n = pl.length;
  const U = pl.reduce((a, x) => a + x.U, 0) / n, E = pl.reduce((a, x) => a + x.E, 0) / n;
  const per = P.ton + P.toff * 60;
  const pumpedAero = SP.qn * NOZ_X.reduce((a, _, j) => a + (1 - clogOf(P, j)), 0) * P.ton * 86400 / per / n;
  const cats = ['Aeroponics (this chamber)', 'NFT channel', 'Deep-water culture'];
  waterBar.set(cats, [
    { label: 'Taken up by the plant', values: [U, P.uptake, P.uptake], color: 'accent' },
    { label: 'Evaporated and lost', values: [E, NFT.evap, DWC.evap], color: 'amber' },
    { label: 'Discarded at solution change', values: [AERO_VOL * 1000 / REPLACE_D, NFT.vol * 1000 / REPLACE_D, DWC.vol * 1000 / REPLACE_D], color: 'magenta' }
  ]);
  const cap = CYC.cap.reduce((a, b) => a + b, 0) / n;
  const aut = t => t < 120 ? fmt(t, 0) + ' min' : t < 48 * 60 ? fmt(t / 60, 1) + ' h' : fmt(t / 1440, 0) + ' d';
  waterTable.innerHTML = `<table class="mini-table"><thead><tr><th></th><th class="num">Pumped through root zone</th><th class="num">Water held around roots</th><th class="num">Water autonomy if the pump stops</th></tr></thead><tbody>
    <tr><td>Aeroponics</td><td class="num">${fmt(pumpedAero / 1000, 2)} L d⁻¹ at ${fmt(P.p, 1)} bar</td><td class="num">${fmt(cap, 1)} mL</td><td class="num">${aut(cap / (P.uptake / 1440))}</td></tr>
    <tr><td>NFT</td><td class="num">≈ ${fmt(NFT.pumped, 0)} L d⁻¹ at &lt; 0.5 bar</td><td class="num">≈ ${fmt(NFT.buffer * 1000, 0)} mL</td><td class="num">${aut(NFT.buffer * 1000 / (P.uptake / 1440))}</td></tr>
    <tr><td>DWC</td><td class="num">none (air pump)</td><td class="num">≈ ${fmt(DWC.buffer, 0)} L</td><td class="num">${aut(DWC.buffer * 1000 / (P.uptake / 1440))} (O₂ lasts hours)</td></tr></tbody></table>`;
}

/* ------------------------------------------------------------------ live visuals */
const cDry = new THREE.Color(0xc2a276), cDead = new THREE.Color(0x6e5034), cWet = new THREE.Color(0xf3eee0), tmpC = new THREE.Color(), leafWilt = new THREE.Color(0.8, 0.76, 0.55);
let lastHud = 0, lastChart = 0, lastScr = 0;
function drawScreen() {
  const c = scrCtx, w = 320, h = 160; c.fillStyle = '#0c1a14'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#5ce39a'; c.font = '600 20px "JetBrains Mono", monospace'; c.textAlign = 'left';
  const per = P.ton + P.toff * 60, phase = ((S.t - S.t0) % per + per) % per;
  const powerOk = !S.fail, ctrlOn = powerOk || P.ups;
  if (!ctrlOn) { c.fillStyle = '#2a0f0f'; c.fillRect(0, 0, w, h); c.fillStyle = '#ff6b5b'; c.font = '700 30px "JetBrains Mono", monospace'; c.fillText('NO POWER', 60, 70); c.font = '500 18px "JetBrains Mono", monospace'; c.fillText(`since ${fmtMin(S.t - S.tFail)}`, 70, 110); }
  else {
    c.fillText(`ON ${P.ton}s  OFF ${fmtMin(P.toff * 60)}`, 14, 30);
    c.font = '700 34px "JetBrains Mono", monospace';
    if (phase < P.ton) { c.fillStyle = '#ffd27a'; c.fillText('SPRAYING', 14, 82); }
    else { c.fillStyle = '#e6fff0'; c.fillText(fmtMin(per - phase), 14, 82); c.font = '500 16px "JetBrains Mono", monospace'; c.fillStyle = '#5ce39a'; c.fillText('to next pulse', 150, 80); }
    c.font = '500 18px "JetBrains Mono", monospace'; c.fillStyle = S.pg < P.p * 0.8 ? '#ff9f5b' : '#5ce39a';
    c.fillText(`P ${fmt(S.pg, 1)} bar  RH ${fmt(S.rh * 100, 0)}%`, 14, 124);
    if (S.fail) { c.fillStyle = '#ff6b5b'; c.fillText('UPS · PUMP OFF', 14, 150); }
  }
  scrTex.needsUpdate = true;
}
const fmtMin = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let fogLevel = 0;
stage.onFrame((dt, t) => {
  if (!CYC) return;
  const now = performance.now();
  const visOpen = S.open || now < S.visOpenUntil;
  mist.on = visOpen && S.pg > 0.3;
  mist.speed = (0.7 + 0.13 * Math.sqrt(Math.max(0.3, S.pg)) * (P.dor / 0.3));
  mist.update(dt);
  const fine = clamp(1.4 - SP.D32 / 60, 0.25, 1.3);
  fogLevel += ((mist.on ? 1 : 0) - fogLevel) * (1 - Math.exp(-dt / (mist.on ? 0.7 : 3.5)));
  fogMat.opacity = 0.055 * fogLevel * fine;
  condMat.opacity = clamp((S.rh - 0.86) / 0.14, 0, 1) * 0.55;
  // flows
  flowP.points.visible = S.pump || S.open; flowP.speed = S.open ? 0.9 : 0.35; flowP.update(dt);
  flowS.points.visible = S.pump; flowS.update(dt);
  flowD.points.visible = S.drain > 0.02; flowD.speed = 0.15 + Math.min(0.6, S.drain * 0.3); flowD.update(dt);
  tank.update(t);
  puddleMat.opacity = 0.18 + 0.3 * clamp(S.drain / 2, 0, 1);
  // drips from root tips, rate ∝ drainage
  dripAcc += dt * Math.min(220, S.drain * 25);
  for (let k = 0; k < DRIP_N && dripAcc > 1; k++) if (!dripOn[k]) { dripAcc -= 1; const pl = plants[(Math.random() * plants.length) | 0]; dripOn[k] = 1; dripV[k] = 0; dripPos[k * 3] = pl.g.position.x + (Math.random() - 0.5) * 0.14; dripPos[k * 3 + 1] = pl.tipY + Math.random() * 0.12; dripPos[k * 3 + 2] = pl.g.position.z + (Math.random() - 0.5) * 0.12; }
  if (dripAcc > 1) dripAcc = 0;
  for (let k = 0; k < DRIP_N; k++) if (dripOn[k]) { dripV[k] += 9.81 * dt; dripPos[k * 3 + 1] -= dripV[k] * dt * 0.5; if (dripPos[k * 3 + 1] < Y0 + 0.02) { dripOn[k] = 0; dripPos[k * 3 + 1] = -99; } }
  dripGeo.attributes.position.needsUpdate = true;
  // gauge, LEDs, solenoid
  needle.rotation.z = -(-225 + 270 * clamp(S.pg, 0, 10) / 10) * Math.PI / 180;
  pumpLed.material.emissiveIntensity = S.pump ? 3 : 0.05;
  solLedMat.emissiveIntensity = S.open ? 3.5 : 0.05;
  const ctrlOn = !S.fail || P.ups;
  ledG.material.emissiveIntensity = ctrlOn ? (Math.sin(t * 6.28) > 0 ? 2.5 : 0.3) : 0.02;
  ledA.material.emissiveIntensity = S.open ? 3 : 0.05;
  ledR.material.emissiveIntensity = S.fail ? (Math.sin(t * 9) > 0 ? 3 : 0.1) : 0.03;
  growLight.setIntensity(1);
  // roots and plants
  const wetView = P.view === 'wet';
  plants.forEach((pl, i) => {
    const Wf = clamp(S.V[i] / CYC.cap[i], 0, 1), th = S.th[i];
    if (wetView) { const c = colormap('rdylgn', Wf); tmpC.setRGB(c[0] / 255, c[1] / 255, c[2] / 255).convertSRGBToLinear(); }
    else { const dryness = clamp((1 - th) / (1 - THETA_DEAD), 0, 1.4); tmpC.copy(cWet).lerp(cDry, clamp(dryness, 0, 1)); if (dryness > 1) tmpC.lerp(cDead, clamp(dryness - 1, 0, 0.4) * 2.5); if (S.dead[i]) tmpC.lerp(cDead, 0.6); }
    pl.rootMat.color.copy(tmpC); pl.hairMat.color.copy(tmpC);
    pl.rootMat.clearcoat = 0.05 + 0.6 * Wf; pl.rootMat.roughness = 0.75 - 0.35 * Wf; pl.rootMat.sheen = 0.2 + 0.4 * Wf;
    pl.hairMat.opacity = (wetView ? 0.9 : 0.35 + 0.5 * th) * (0.7 + 0.3 * Wf);
    const target = clamp(S.stressAvg[i] * 1.3 + (1 - th) * 1.5, 0, 1);
    pl.wilt += (target - pl.wilt) * (1 - Math.exp(-dt / 1.5));
    pl.lett.scale.set(1 + 0.05 * pl.wilt, 1 - 0.28 * pl.wilt, 1 + 0.05 * pl.wilt);
    pl.leafMat.color.setRGB(1, 1, 1).lerp(leafWilt, pl.wilt);
    pl.cards.forEach(c => { c.scale.x = 1 - 0.25 * (1 - th); });
  });
  // HUD & labels (throttled)
  if (now - lastHud > 200) {
    lastHud = now;
    const per = P.ton + P.toff * 60, phase = ((S.t - S.t0) % per + per) % per;
    hud.set('t', `Simulated <b>${fmtClock(S.t)}</b> · ${clock.running ? `×${P.speed}` : 'paused'}`);
    hud.set('s', S.open ? `Solenoid <b style="color:#ffd27a">open</b> — spraying ${fmt(S.pg, 1)} bar` : ((!S.fail || P.ups) ? `Next pulse in <b>${fmtMin(per - phase)}</b>` : `Controller <b style="color:#ff8a7a">off</b>`));
    const meanW0 = S.V.reduce((a, v, i) => a + Math.min(1, v / CYC.cap[i]), 0) / PLANTS.length, meanW = meanW0 < 1e-4 ? 0 : meanW0;
    hud.set('w', `Root film <b>${fmt(meanW * 100, 0)} %</b> · RH <b>${fmt(S.rh * 100, 1)} %</b>`);
    if (S.fail) hud.set('f', `<b style="color:#ff8a7a">POWER CUT</b> ${fmtMin(S.t - S.tFail)} ago · ${P.ups ? (S.pg > 0.3 ? 'accumulator still spraying' : 'accumulator empty') : 'no spray'}`); else hud.remove('f');
    LBL.pump.element.innerHTML = `HP diaphragm pump<small>${S.pump ? 'running' : 'stopped'} · ${fmt(Q_PUMP * 0.06, 1)} L min⁻¹</small>`;
    LBL.acc.element.innerHTML = `Accumulator ${fmt(P.vacc, 1)} L<small>${fmt(S.pg, 1)} bar · ${fmt(S.vliq / 1000, 2)} L stored</small>`;
    LBL.sol.element.innerHTML = `Solenoid (NC)<small>${S.open ? 'OPEN' : 'closed'}</small>`;
    LBL.ctrl.element.innerHTML = `Timer<small>${P.ton} s on / ${fmt(P.toff, 1)} min off</small>`;
    const dT = S.th.reduce((a, b) => Math.min(a, b), 1);
    LBL.roots.element.innerHTML = `Root curtain<small>film ${fmt(meanW * 100, 0)} % · tissue ${fmt(dT * 100, 0)} %</small>`;
    LBL.tank.element.innerHTML = `Reservoir<small>${fmt(P.cn, 0)} mg N L⁻¹</small>`;
    LBL.drain.element.innerHTML = `Drain return<small>${fmt(S.drain * 3.6, 2)} L h⁻¹</small>`;
    Object.values(LBL).forEach(l => { l.visible = P.labels; });
    const rw = S.stressAvg.reduce((a, b) => a + b, 0) / PLANTS.length;
    ro.set('rwsi', rw, rw < 0.1 ? 'ok' : rw < 0.4 ? 'warn' : 'bad', rw < 0.1 ? 'uptake unrestricted' : 'uptake limited by the film');
    const tmin = Math.min(...S.th) * 100;
    ro.set('tissue', tmin, tmin > 95 ? 'ok' : tmin > THETA_DEAD * 100 ? 'warn' : 'bad', S.dead.some(Boolean) ? `${S.dead.filter(Boolean).length} of 8 root systems damaged` : 'fully hydrated = 100 %');
    if (wetView) legendWet(); else if (!info.dataset.pinned) info.style.display = 'none';
  }
  if (now - lastScr > 250) { lastScr = now; drawScreen(); }
  if (now - lastChart > 300) { lastChart = now; sampleChart(); }
});
function legendWet() { info.style.display = ''; info.dataset.pinned = ''; info.innerHTML = `Root film (fraction of capacity)<div class="cbar" style="background:${colormapGradient('rdylgn')}"></div><div class="cbar-ticks"><span>0</span><span>50 %</span><span>100 %</span></div>`; }
const fmtClock = s => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60); return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; };
/** record one history sample (called from the simulation step every 4 simulated seconds) */
function recordSample() {
  const ws = S.V.map((v, i) => Math.min(1, v / CYC.cap[i]));
  S.hist.push({ t: S.t / 60, mean: 100 * ws.reduce((a, b) => a + b, 0) / ws.length, min: 100 * Math.min(...ws), th: 100 * Math.min(...S.th), rh: 100 * S.rh, open: S.openSeen });
  S.openSeen = false; S.lastRec = S.t;
  const cut = S.t / 60 - 60; while (S.hist.length && S.hist[0].t < cut) S.hist.shift();
}
function sampleChart() {
  if (!CYC) return;
  const H = S.hist; if (H.length < 2) return;
  const xs = H.map(h => h.t);
  wetPlot.line('mean', xs, H.map(h => h.mean), { color: 'water', width: 2.4, fill: 0.1, label: 'root film, mean' });
  wetPlot.line('min', xs, H.map(h => h.min), { color: 'danger', width: 1.6, dash: [5, 4], label: 'root film, driest plant' });
  wetPlot.line('th', xs, H.map(h => h.th), { color: 'magenta', width: 2, label: 'fine-root water content' });
  wetPlot.line('rh', xs, H.map(h => h.rh), { color: 'amber', width: 1.5, label: 'chamber RH (right axis)', y2: true });
  wetPlot.scatter('on', xs, H.map(h => h.open ? 103 : NaN), { color: 'muted', r: 2, shape: 'square', label: 'spraying' });
  wetPlot.hregion('stress', 0, PHI_C * 100, { color: 'danger', alpha: 0.06, label: 'uptake limited' });
  if (S.fail && S.tFail != null) wetPlot.vline('fail', S.tFail / 60, { color: 'danger', label: 'power cut' }); else wetPlot.remove('fail');
  wetPlot.setAxis('x', { min: Math.max(0, xs[xs.length - 1] - 60), max: Math.max(10, xs[xs.length - 1]) });
}

/* ------------------------------------------------------------------ picking: component information */
const INFO = {
  pump: () => `<b>High-pressure diaphragm pump</b><br>Starts when the pressure falls below ${fmt(P.p, 1)} bar and stops at ${fmt(P.p + P_BAND, 1)} bar (pressure switch). It fills the accumulator; it does not run for every pulse.`,
  accumulator: () => `<b>Bladder accumulator (${fmt(P.vacc, 1)} L)</b><br>Nitrogen pre-charged to ${fmt(preAbs(P), 2)} bar(a). Between cut-out and pre-charge it can deliver ${fmt((vFromPg(P, P.p + P_BAND)) / 1000, 2)} L ≈ ${fmt(vFromPg(P, P.p + P_BAND) / (SP.qn * 4 * P.ton), 0)} pulses without the pump (Boyle's law, Eq. A11).`,
  solenoid: () => `<b>Normally-closed solenoid valve</b><br>Opens only while the timer commands a pulse (${P.ton} s every ${fmt(P.toff, 1)} min). If the power fails it closes — unless the controller is on a UPS.`,
  controller: () => `<b>Timer / controller</b><br>Cycle ${P.ton} s on, ${fmt(P.toff, 1)} min off → duty ${fmt(100 * P.ton / (P.ton + P.toff * 60), 2)} %. Green = power, amber = spraying, red = fault.`,
  nozzle: () => `<b>Misting nozzles (4 × ${fmt(P.dor, 2)} mm)</b><br>${fmt(SP.qn * 3.6, 1)} L h⁻¹ each at ${fmt(P.p + P_BAND / 2, 1)} bar; D₃₂ ≈ ${fmt(SP.D32, 0)} µm, CMD ${fmt(SP.CMD, 0)} µm; ${fmt(SP.phi * 100, 0)} % of the cone is aimed at the root curtains.`,
  roots: () => `<b>Root curtain</b><br>Wetted area ≈ ${A_R} m² per plant holds a ${H_F * 1e6} µm film (${fmt(V_RET, 1)} mL). Only the fraction hit by droplets (${fmt(Math.min(...CYC.sup.cov) * 100, 0)}–${fmt(Math.max(...CYC.sup.cov) * 100, 0)} %) can hold a film.`,
  plant: () => `<b>Butterhead lettuce</b><br>Takes up ${P.uptake} mL d⁻¹. When the root film runs dry, uptake falls and the leaves wilt; fine roots start to die below ${THETA_DEAD * 100} % water content.`,
  tank: () => `<b>Nutrient reservoir</b><br>${fmt(P.cn, 0)} mg N L⁻¹. Run-off from the chamber returns here; the solution is replaced about every ${REPLACE_D} days.`,
  filter: () => `<b>Fine filter</b><br>Protects the ${fmt(P.dor, 2)} mm orifices: particles, precipitates and root fragments are the main cause of clogging.`,
  pressure: () => `<b>High-pressure line</b><br>${fmt(S.pg, 1)} bar now. Flow only while the pump refills the accumulator or while the solenoid is open.`,
  drain: () => `<b>Drain return</b><br>${fmt(S.drain * 3.6, 2)} L h⁻¹ now; ${fmt(100 - SP.etaRoot * 100 * 0.5, 0)} % of what is sprayed eventually drains back.`,
  chamber: () => `<b>Root chamber</b><br>Dark, closed and near saturation (RH ${fmt(S.rh * 100, 1)} %). The front is drawn transparent for teaching; real chambers are opaque to stop algae.`
};
stage.onPick({ objects: () => pickables, onClick: hit => { if (!hit) { info.style.display = 'none'; info.dataset.pinned = ''; return; } const k = hit.object.userData.comp; if (!k || !INFO[k]) return; info.style.display = ''; info.dataset.pinned = '1'; info.innerHTML = INFO[k](); } });
info.style.display = 'none';

/* ------------------------------------------------------------------ wiring */
let raf = 0;
ui.onChange((st, id) => {
  if (id === 'speed') { clock.speed = +st.speed; return; }
  cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { recompute(); });
});
recompute(); resetSim(); recompute();
clock.play();
// hook for automated tests and demonstrations: advance the simulation by s seconds
window.__aeroLab = { advance(s) { const n = Math.ceil(s / 0.5); for (let k = 0; k < n; k++) stepSim(0.5); clock.t = S.t; sampleChart(); }, fail: setFail, state: S };
