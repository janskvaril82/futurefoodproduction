/* Soilless systems gallery — quantitative models of the six systems (Derive tab, Eqs. S1–S9).
   Shared crop: logistic lettuce growth of the NFT simulator (150 g at 24 d after transplanting),
   transpiration E = e_w · m. Each system limits water or oxygen supply in its own way; a supply
   shortfall slows growth (growth ∝ transpiration, or the O₂ response of Eq. N9). */
import { CROP, film, higbieKL, csT, fO2, logisticStep, growthRate, rootO2 } from '/laboratories/nft-system/model.js';

export const RHO = 998, G = 9.81;
export const SYS = ['nft', 'dwc', 'ebb', 'drip', 'wick', 'kratky'];
export const NAMES = { nft: 'NFT', dwc: 'Deep-water culture', ebb: 'Ebb-and-flow', drip: 'Drip on rock wool', wick: 'Wick', kratky: 'Kratky' };
export const SHORT = { nft: 'NFT', dwc: 'DWC', ebb: 'Ebb & flow', drip: 'Drip', wick: 'Wick', kratky: 'Kratky' };
/* hardware of the gallery stations (fixed; they set volumes and plant numbers) */
export const HW = {
  nft: { plants: 12, gullies: 2, L: 1.2, W: 0.10, tank: 40, vAvail: 0.040, parts: 4 },      // pump, 2 feed tubes, supply line
  dwc: { plants: 6, A: 0.58 * 0.38, vAvailNote: 'oxygen-limited', parts: 3 },               // air pump, 2 air stones
  ebb: { plants: 6, A: 0.86 * 0.56 - 6 * 0.09 * 0.09, potL: 0.58, eawFrac: 0.25, tank: 30, parts: 3 }, // pump, timer, fill fitting
  drip: { plants: 4, stock: 30, vAvail: 0.40, parts: 7 },                                  // pump, timer, filter, 4 emitters
  wick: { plants: 2, A: 0.40 * 0.28, depth: 0.19, trayBottom: 0.215, parts: 0 },
  kratky: { plants: 6, A: 0.55 * 0.35, depth: 0.20, parts: 0 }
};
/** Crop trajectory helper: potential mass after d days. */
export function potentialMass(d) { let m = CROP.m0; for (let i = 0; i < Math.floor(d); i++) m = logisticStep(m, CROP.r, CROP.K, 1); const fr = d - Math.floor(d); return fr > 0 ? logisticStep(m, CROP.r, CROP.K, fr) : m; }

/* ------------------------------------------------------------------ S1–S2  NFT */
export function nftState(p, m, T) {
  const Q = p.nftQ / 60000, s = p.nftSlope / 100, W = HW.nft.W, L = HW.nft.L, np = HW.nft.plants / HW.nft.gullies;
  const f = film(Q, W, s, T);
  const KL = higbieKL(T, f.us, 1.0), Cs = csT(T), Cin = Math.min(Cs, 8.0);
  const R = rootO2(m) * Math.pow(CROP.Q10, (T - 20) / 10);          // mg h⁻¹ per plant
  const rp = (np / L) * R / 3.6e6;                                  // g m⁻¹ s⁻¹
  const lam = Q / (KL * W), Ceq = Cs - rp / (KL * W);
  const Cout = Math.max(0, Ceq + (Cin - Ceq) * Math.exp(-L / lam));
  return { h: f.h, u: f.u, Re: f.Re, tres: L / f.u, Cin, Cout, Cs, KL, R };
}
/* ------------------------------------------------------------------ S3  DWC */
export function dwcState(p, m, T) {
  const n = HW.dwc.plants, V = HW.dwc.A * p.dwcDepth / 100 * 1000;      // L
  const Cs = csT(T), R = rootO2(m) * Math.pow(CROP.Q10, (T - 20) / 10);
  const OUR = n * R / V;                                               // mg L⁻¹ h⁻¹
  const OTR = p.dwcEff / 100 * 279 * p.dwcAir * 60;                     // mg h⁻¹ into O₂-free water (Eq. 5.3.6)
  const kla = OTR / (V * Cs) * Math.pow(1.024, T - 20);                 // h⁻¹
  const Css = Math.max(0, Cs - OUR / Math.max(1e-6, kla));
  const tFail = Math.max(0, (Css - 3) / Math.max(1e-9, OUR));           // h to 3 mg L⁻¹ with the air pump off
  return { V, Cs, R, OUR, kla, Css, tFail, OTR };
}
/* ------------------------------------------------------------------ S4  Ebb-and-flow (fill: pump; drain: orifice, Torricelli) */
export function ebbState(p, E) {
  const A = HW.ebb.A, d = p.ebbDepth / 100, Qp = p.ebbQ / 60000, a = Math.PI * Math.pow(p.ebbDrain / 2000, 2), Cd = 0.61;
  const tFill = A * d / Qp;                                              // s
  const tDrain = (A / (Cd * a)) * Math.sqrt(2 * d / G);                  // s
  const tHold = p.ebbHold * 60;
  const interval = 24 / p.ebbFloods;                                     // h between floods
  const eaw = HW.ebb.potL * HW.ebb.eawFrac;                              // L easily available water per pot
  const need = E * interval / 24;                                        // L used between floods
  const submerged = (tFill + tHold + tDrain) * p.ebbFloods / 3600;       // h per day with the pots in water
  const pumpH = (tFill + tHold) * p.ebbFloods / 3600;                    // h per day the pump runs
  return { A, d, tFill, tDrain, tHold, interval, eaw, need, margin: eaw / Math.max(1e-9, need), submerged, pumpH, vFlood: A * d * 1000 };
}
/** Tray water depth (m) at time τ (s) within a flood cycle. */
export function ebbLevel(st, tau) {
  const { tFill, tHold, tDrain, d } = st;
  if (tau < tFill) return d * tau / tFill;
  if (tau < tFill + tHold) return d;
  const td = tau - tFill - tHold; if (td >= tDrain) return 0;
  const r = 1 - td / tDrain; return d * r * r;                          // √h falls linearly (Torricelli)
}
/* ------------------------------------------------------------------ S5  Drip on slabs */
export function dripState(p, E) {
  const S = p.dripQ * p.dripPulses * p.dripMin / 60;                     // L per plant per day
  const DF = S > E ? 1 - E / S : 0; const deficit = S < E ? 1 - S / E : 0;
  const x = p.dripType === 'pc' ? 0.05 : 0.5, last = Math.pow(1 - p.dripDH / 100, x);  // q_last/q_first (Eq. 5.4.8)
  const drain = Math.max(0, S - E);
  return { S, DF, deficit, drain, nLoss: p.dripOpen ? drain * p.nConc : 0, last, pumpH: p.dripPulses * p.dripMin / 60, x };
}
/* ------------------------------------------------------------------ S6  Wick (Darcy flux with exponential K(ψ), Gardner 1958) */
export function wickCapacity(p, Z) {
  const A = Math.PI * Math.pow(p.wickD / 2000, 2), Ks = p.wickKs, hc = p.wickHc, alpha = 1 / hc, htop = 0.5;
  const L = Z + 0.06;                                                    // wick path above the water: lift + run inside the substrate
  if (Z >= htop) return 0;
  let q;
  if (Z < 1e-4) q = Ks * (1 - Math.exp(-alpha * htop)) / (alpha * L);
  else q = Ks * (Z / L) * (1 - Math.exp(-alpha * (htop - Z))) / (Math.exp(alpha * Z) - 1);
  return p.wickN * A * q * 86400 * 1000;                                 // L d⁻¹
}
/* ------------------------------------------------------------------ crop-cycle simulation of all six systems */
/**
 * Daily integration from transplanting to p.days. Returns per-day states for every system and the metrics at the end.
 * p: all gallery parameters (see main.js DEFAULTS).
 */
export function simulateGallery(p) {
  const days = p.days, T = p.temp, ew = p.ew;
  const out = { day: [], pot: [] }; SYS.forEach(k => out[k] = []);
  const mass = {}; SYS.forEach(k => mass[k] = CROP.m0);
  const water = {}; SYS.forEach(k => water[k] = 0);                     // cumulative transpired water per plant (L)
  let wickV = HW.wick.A * p.wickFill / 100 * 1000;                        // L in the wick reservoir
  let kratV = HW.kratky.A * p.kratFill / 100 * 1000;                      // L in the Kratky tote
  let drainTot = 0, nLossTot = 0;
  const dt = 0.25;
  for (let step = 0; step <= days / dt + 1e-9; step++) {
    const t = step * dt, rec = step % Math.round(1 / dt) === 0 || step === Math.round(days / dt);
    const pm = potentialMass(t);
    // --- states with current masses
    const st = {};
    { const m = mass.nft; const s = nftState(p, m, T); const f = fO2(s.Cout); st.nft = Object.assign(s, { m, E: ew * m / 1000, f, margin: s.Cout / 4 }); }
    { const m = mass.dwc; const s = dwcState(p, m, T); const f = fO2(s.Css); st.dwc = Object.assign(s, { m, E: ew * m / 1000, f, margin: s.Css / 4 }); }
    { const m = mass.ebb; const E = ew * m / 1000; const s = ebbState(p, E); const f = Math.min(1, s.margin); st.ebb = Object.assign(s, { m, E, f }); }
    { const m = mass.drip; const E = ew * m / 1000; const s = dripState(p, E); const f = Math.min(1, s.S / Math.max(1e-9, E)); st.drip = Object.assign(s, { m, E, f, margin: s.S / Math.max(1e-9, E) }); }
    { const m = mass.wick; const E = ew * m / 1000; const lvl = wickV / (HW.wick.A * 1000); const Z = Math.max(0, HW.wick.trayBottom - lvl) + 0.03;
      const cap = wickV > 0.05 ? wickCapacity(p, Z) : 0; const need = HW.wick.plants * E; const f = Math.min(1, cap / Math.max(1e-9, need));
      st.wick = { m, E, cap, need, Z, level: lvl, V: wickV, f, margin: cap / Math.max(1e-9, need) }; }
    { const m = mass.kratky; const E = ew * m / 1000; const lvl = kratV / (HW.kratky.A * 1000);
      // solution still needed until harvest (at least a 3-day look-ahead) at potential growth → margin
      let needRest = 0; { let mm = m; const H = Math.max(days - t, 3); for (let tt = 0; tt < H - 1e-9; tt += 0.5) { needRest += HW.kratky.plants * ew * mm / 1000 * 0.5; mm = logisticStep(mm, CROP.r, CROP.K, 0.5); } }
      const f = kratV > 0.3 ? 1 : 0; st.kratky = { m, E, level: lvl, V: kratV, airGap: HW.kratky.depth - lvl, f, margin: kratV / Math.max(1e-6, needRest), needRest }; }
    if (rec) { out.day.push(t); out.pot.push(pm); SYS.forEach(k => out[k].push(Object.assign({}, st[k]))); }
    if (t >= days - 1e-9) break;
    // --- advance one step
    SYS.forEach(k => {
      const f = Math.max(0, Math.min(1, st[k].f));
      const E = ew * mass[k] / 1000 * f;                                    // actual transpiration (supply-limited)
      water[k] += E * dt;
      mass[k] = logisticStep(mass[k], CROP.r * f, CROP.K, dt);
      if (k === 'wick') wickV = Math.max(0, wickV - HW.wick.plants * E * dt);
      if (k === 'kratky') kratV = Math.max(0, kratV - HW.kratky.plants * E * dt);
      if (k === 'drip') { drainTot += st.drip.drain * dt; nLossTot += st.drip.nLoss * dt; }
    });
  }
  // ---- metrics at harvest
  const last = k => out[k][out[k].length - 1];
  const kg = k => HW[k].plants * last(k).m / 1000;
  const discard = {
    nft: p.discard ? HW.nft.tank : 0, dwc: p.discard ? HW.dwc.A * p.dwcDepth / 100 * 1000 : 0, ebb: p.discard ? HW.ebb.tank : 0,
    drip: p.discard ? HW.drip.stock * 0.3 : 0, wick: p.discard ? wickV : 0, kratky: p.discard ? kratV : 0
  };
  const waterIn = {
    nft: HW.nft.plants * water.nft + discard.nft, dwc: HW.dwc.plants * water.dwc + discard.dwc, ebb: HW.ebb.plants * water.ebb + discard.ebb,
    drip: HW.drip.plants * (water.drip + (p.dripOpen ? drainTot : 0)) + discard.drip, wick: HW.wick.plants * water.wick + discard.wick, kratky: HW.kratky.plants * water.kratky + discard.kratky
  };
  const kwh = {
    nft: p.pumpW * 24 * days / 1000, dwc: p.airW * 24 * days / 1000, ebb: p.pumpW * last('ebb').pumpH * days / 1000,
    drip: p.pumpW * last('drip').pumpH * days / 1000, wick: 0, kratky: 0
  };
  const Eh = k => Math.max(1e-9, last(k).E / 24);                            // L h⁻¹ per plant at harvest
  const hoursPower = {
    nft: HW.nft.vAvail / Eh('nft'), dwc: last('dwc').tFail, ebb: HW.ebb.potL * HW.ebb.eawFrac / Eh('ebb'), drip: HW.drip.vAvail / Eh('drip'),
    wick: last('wick').V / HW.wick.plants / Eh('wick'), kratky: last('kratky').V / HW.kratky.plants / Eh('kratky')
  };
  const metrics = {};
  SYS.forEach(k => {
    metrics[k] = {
      massEnd: last(k).m, kg: kg(k), waterPerKg: waterIn[k] / Math.max(1e-6, kg(k)), waterIn: waterIn[k], discard: discard[k],
      kwh: kwh[k], kwhPerKg: kwh[k] / Math.max(1e-6, kg(k)), costPerKg: kwh[k] * p.price / Math.max(1e-6, kg(k)),
      hoursPower: hoursPower[k], parts: HW[k].parts + (k === 'wick' ? p.wickN : 0), transp: water[k]
    };
  });
  metrics.drip.drainTot = drainTot; metrics.drip.nLoss = nLossTot;
  return { out, metrics, p };
}
