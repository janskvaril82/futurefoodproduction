/* Root nutrient uptake — multi-scale 3D laboratory (Future Food Production).
   Model (Derive tab, Eqs. U1–U10):
   · Michaelis–Menten influx with a threshold Cmin (Claassen & Barber 1974), Imax scaled by Q10.
   · Soil: transient radial diffusion + mass flow to a cylindrical root sink (Barber–Cushman model;
     Nye & Tinker), De = Dl·θ·f/b with the Millington–Quirk impedance factor, zero-flux boundary at
     the half-distance between roots r1 = 1/√(πLv). Solved by implicit finite volumes on a log grid.
   · Root hairs: hair-cylinder approximation (effective radius where hair depletion zones overlap)
     plus extra membrane area.
   · Hydroponics: well-mixed flowing solution with an unstirred (Nernst) layer around the root.
   3D: plant scale (net pot over solution, or rhizobox with a depletion map), root-hair zone
   (epidermal cells, hairs, ions whose density follows the computed profile) and plasma membrane
   (H⁺-ATPase, NRT2.1, AKT1, PHT1) with transport events at model rates. */
import { createStage, THREE, M, makeLettuce, makeNetPot, makeTank, makeRaft, Bubbles, FlowAlong, canvasTexture, surfaceMaterial, rng, BufferGeometryUtils, RoundedBoxGeometry, fbm2 } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot } from '/assets/js/plot.js';
import { q10 as q10f } from '/assets/js/physics.js';
import { colormap, colormapGradient } from '/assets/js/colors.js';

/* ================================================================ constants */
const DAY = 86400;
const R0 = 2e-4;          // root radius, m (lateral root; Ruiz et al. 2020)
const RH = 5e-6;          // root-hair radius, m
const PHI = 0.5;          // soil porosity
const UM = 1e-3;          // 1 µM in mol m⁻³
const PM = 1e-8;          // 1 pmol cm⁻² s⁻¹ in mol m⁻² s⁻¹
const ION_KEYS = ['no3', 'k', 'p'];
const IONS = {
  no3: { label: 'NO₃⁻', name: 'nitrate', Dl25: 1.90e-9, Imax: 10, Km: 25, Cmin: 2, b: 0.3, soil: 5000, hydro: 15000, hPlus: 2, color: 0x3d9bff, css: '#3d8fe8', prot: 'NRT2.1' },
  k: { label: 'K⁺', name: 'potassium', Dl25: 1.96e-9, Imax: 5, Km: 20, Cmin: 2, b: 10, soil: 200, hydro: 6000, hPlus: 0, color: 0xb07cff, css: '#9a62e8', prot: 'AKT1' },
  p: { label: 'H₂PO₄⁻', name: 'phosphate', Dl25: 0.846e-9, Imax: 3.26, Km: 5.8, Cmin: 0.2, b: 239, soil: 5, hydro: 1000, hPlus: 2, color: 0xffab2e, css: '#e0901a', prot: 'PHT1' }
};

/* ================================================================ model */
const visc = T => 2.414e-5 * Math.pow(10, 247.8 / (T + 133.15));          // water viscosity, Pa s (Vogel fit)
const dlAt = (ion, T) => IONS[ion].Dl25 * ((T + 273.15) / 298.15) * (visc(25) / visc(T)); // Stokes–Einstein
const impedance = th => Math.pow(th, 7 / 3) / (PHI * PHI);                 // Millington & Quirk (1961)
const mmJ = (c, Imax, Km, Cmin) => c <= Cmin ? 0 : Imax * (c - Cmin) / (Km + c - Cmin);

const ionState = {};
ION_KEYS.forEach(k => { const I = IONS[k]; ionState[k] = { conc: I.soil, imax: I.Imax, km: I.Km, cmin: I.Cmin, b: I.b }; });

function kin(ion, p) {
  const s = ionState[ion];
  return { Imax: q10f(s.imax, p.q10, p.T, 20) * PM, Km: s.km * UM, Cmin: s.cmin * UM, Cb: s.conc * UM, b: s.b, Dl: dlAt(ion, p.T) };
}
/** Root-hair cylinder approximation (Eq. U8). */
function hairGeom(p, De, medium) {
  const rootA = 2 * Math.PI * R0;
  if (!p.hairs) return { reff: R0, cap: 1, hairA: 0 };
  const lh = p.lh * 1e-3, Nh = p.nh * 1e3;
  const hairA = Nh * 2 * Math.PI * RH * lh;
  if (medium === 'hydro') return { reff: R0, cap: (rootA + hairA) / rootA, hairA };
  const dh = Math.sqrt(rootA / Nh);                  // mean spacing of hair bases on the root surface
  const xD = 2 * Math.sqrt(De * DAY);                // distance diffused in one day
  const rOv = R0 * 2 * xD / dh;                      // hair depletion zones overlap inside this radius
  const reff = Math.min(R0 + lh, Math.max(R0, rOv));
  return { reff, cap: (rootA + hairA) / (2 * Math.PI * reff), hairA, rOv };
}
const halfDistance = lv => 1 / Math.sqrt(Math.PI * lv * 1e4); // m (Lv in cm cm⁻³)
const NOUT = 90;

/** Barber–Cushman radial model, implicit finite volumes in u = ln r (Eq. U4). */
function simSoil(ion, p) {
  const K = kin(ion, p), th = p.theta, f = impedance(th);
  const De = K.Dl * th * f / K.b;
  const hg = hairGeom(p, De, 'soil');
  const a = hg.reff, Imax = K.Imax * hg.cap;
  const R1 = Math.max(a * 1.6, halfDistance(p.lv));
  const q = R0 * p.v0 * 1e-2 / K.b;                  // (r0·v0)/b, m² s⁻¹
  const N = 96, ua = Math.log(a), h = (Math.log(R1) - ua) / N;
  const V = new Float64Array(N), rc = new Float64Array(N);
  for (let i = 0; i < N; i++) { const r1 = Math.exp(ua + i * h), r2 = Math.exp(ua + (i + 1) * h); V[i] = (r2 * r2 - r1 * r1) / 2; rc[i] = Math.exp(ua + (i + 0.5) * h); }
  const C = new Float64Array(N).fill(K.Cb), Cn = new Float64Array(N);
  const A = new Float64Array(N), B = new Float64Array(N), Cc = new Float64Array(N), D = new Float64Array(N), cp = new Float64Array(N), dp = new Float64Array(N);
  const mm = c => mmJ(c, Imax, K.Km, K.Cmin);
  const dmm = c => c <= K.Cmin ? 0 : Imax * K.Km / ((K.Km + c - K.Cmin) ** 2);
  const Tend = p.days * DAY;
  const out = { t: [], J: [], U: [], Cs: [], prof: [] };
  const Dh = De / h, s = a / K.b;
  let t = 0, dt = 2, Cs = K.Cb, U = 0, k = 1;
  const record = () => { out.t.push(t / DAY); out.J.push(2 * Math.PI * a * mm(Cs) / (2 * Math.PI * R0) / PM); out.U.push(U * 1e6); out.Cs.push(Cs / UM); out.prof.push(Float32Array.from(C, v => v / UM)); };
  record();
  while (t < Tend - 1e-6) {
    dt = Math.min(dt * 1.15, 1800, Tend - t);
    Cn.set(C);
    let CsIt = Cs, P = 0, Q = 0;
    for (let it = 0; it < 3; it++) {
      const J0 = mm(CsIt), J1 = dmm(CsIt);
      const den = Math.max(2 * Dh - q + s * J1, 1e-30);
      const al = 2 * Dh / den, be = -s * (J0 - J1 * CsIt) / den;   // Cs = al·C0 + be (half-cell flux = linearised uptake)
      P = 2 * Dh * (1 - al) + q * al; Q = (q - 2 * Dh) * be;
      for (let i = 0; i < N; i++) {
        const vt = V[i] / dt;
        if (i === 0) { A[i] = 0; B[i] = vt + Dh + P; Cc[i] = -(Dh + q); D[i] = vt * Cn[i] - Q; }
        else if (i === N - 1) { A[i] = -Dh; B[i] = vt + Dh + q; Cc[i] = 0; D[i] = vt * Cn[i]; }
        else { A[i] = -Dh; B[i] = vt + 2 * Dh + q; Cc[i] = -(Dh + q); D[i] = vt * Cn[i]; }
      }
      cp[0] = Cc[0] / B[0]; dp[0] = D[0] / B[0];
      for (let i = 1; i < N; i++) { const m = B[i] - A[i] * cp[i - 1]; cp[i] = Cc[i] / m; dp[i] = (D[i] - A[i] * dp[i - 1]) / m; }
      C[N - 1] = dp[N - 1]; for (let i = N - 2; i >= 0; i--) C[i] = dp[i] - cp[i] * C[i + 1];
      for (let i = 0; i < N; i++) if (C[i] < 0) C[i] = 0;
      CsIt = Math.max(0, al * C[0] + be);
    }
    Cs = CsIt;
    U += 2 * Math.PI * K.b * Math.max(0, P * C[0] + Q) * dt;   // mol per m of root
    t += dt;
    while (k <= NOUT && t >= k * Tend / NOUT - 1e-6) { record(); k++; }
  }
  while (out.t.length < NOUT + 1) record();
  return { ...out, r: Float64Array.from(rc), a, R1, De, hg, K, Imax, medium: 'soil', lnA: ua, h };
}
/** Well-mixed solution with an unstirred layer δ (Eq. U9). */
function simHydro(ion, p) {
  const K = kin(ion, p), hg = hairGeom(p, 0, 'hydro');
  const Imax = K.Imax * hg.cap, dl = p.delta * 1e-6;
  const hm = K.Dl / (R0 * Math.log(1 + dl / R0));
  const Bc = K.Cb - K.Cmin; let x = 0;
  if (Bc > 0) { const bb = Imax + hm * K.Km - hm * Bc; x = (-bb + Math.sqrt(bb * bb + 4 * hm * hm * Bc * K.Km)) / (2 * hm); }
  const Cs = Bc > 0 ? K.Cmin + x : K.Cb, J = Bc > 0 ? Imax * x / (K.Km + x) : 0;
  const R1 = Math.max(R0 * 1.6, halfDistance(p.lv)), N = 96, ua = Math.log(R0), h = (Math.log(R1) - ua) / N;
  const rc = new Float64Array(N); const prof = new Float32Array(N);
  for (let i = 0; i < N; i++) { const r = Math.exp(ua + (i + 0.5) * h); rc[i] = r; prof[i] = (r < R0 + dl ? Cs + (K.Cb - Cs) * Math.log(r / R0) / Math.log(1 + dl / R0) : K.Cb) / UM; }
  const out = { t: [], J: [], U: [], Cs: [], prof: [] };
  for (let k = 0; k <= NOUT; k++) { const t = p.days * k / NOUT; out.t.push(t); out.J.push(J / PM); out.U.push(2 * Math.PI * R0 * J * t * DAY * 1e6); out.Cs.push(Cs / UM); out.prof.push(prof); }
  return { ...out, r: rc, a: R0, R1, De: K.Dl, hg, K, Imax, medium: 'hydro', lnA: ua, h, hm };
}
function runAll(p) {
  const res = {};
  for (const ion of ION_KEYS) res[ion] = { hydro: simHydro(ion, p), soil: (ion === p.ion || p.medium === 'soil') ? simSoil(ion, p) : null };
  return res;
}
/** Interpolate a recorded series at display time td (days). */
function at(sim, key, td) {
  const x = Math.min(NOUT, Math.max(0, td / (sim.t[NOUT] || 1) * NOUT)); const i = Math.min(NOUT - 1, Math.floor(x)), f = x - i;
  return sim[key][i] * (1 - f) + sim[key][i + 1] * f;
}
const profAt = (sim, td) => sim.prof[Math.round(Math.min(NOUT, Math.max(0, td / (sim.t[NOUT] || 1) * NOUT)))];
/** Concentration (µM) at radius r (m) from a profile. */
function concAtR(sim, prof, Cs, r) {
  if (r <= sim.a) return Cs;
  const x = (Math.log(r) - sim.lnA) / sim.h - 0.5;
  if (x <= 0) return prof[0] + (Cs - prof[0]) * Math.min(1, -x * 2);
  if (x >= prof.length - 1) return prof[prof.length - 1];
  const i = Math.floor(x), f = x - i; return prof[i] * (1 - f) + prof[i + 1] * f;
}

/* ================================================================ UI */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'J', label: 'Influx at the root surface', unit: 'pmol cm⁻² s⁻¹', digits: 2 })
  .add({ id: 'cs', label: 'Concentration at the surface C<sub>s</sub>', unit: 'µM', digits: 2 })
  .add({ id: 'supply', label: 'Uptake relative to stirred solution', unit: '%', digits: 0 })
  .add({ id: 'dz', label: 'Depletion zone (C < 0.9 C<sub>b</sub>)', unit: 'mm', digits: 2 })
  .add({ id: 'de', label: 'Diffusion coefficient in the medium', unit: 'm² s⁻¹', format: v => (typeof v === 'number' ? v.toExponential(2) : v) })
  .add({ id: 'perm', label: 'Uptake per metre of root', unit: 'µmol m⁻¹ d⁻¹', digits: 2 })
  .add({ id: 'cum', label: 'Cumulative uptake', unit: 'µmol m⁻¹', digits: 1 })
  .add({ id: 'mf', label: 'Share delivered by mass flow', unit: '%', digits: 1 })
  .add({ id: 'reff', label: 'Effective absorbing radius', unit: 'mm', digits: 2 });

const fmtConc = v => v >= 1000 ? fmt(v / 1000, v >= 10000 ? 1 : 2) + ' mM' : fmt(v, v < 1 ? 2 : v < 10 ? 1 : 0) + ' µM';
ui.section('Explore the scales');
ui.segmented({ id: 'scale', label: 'View', options: [{ value: 'plant', label: 'Plant' }, { value: 'hairs', label: 'Root hairs' }, { value: 'membrane', label: 'Membrane' }], value: 'plant', persist: false });
ui.button({ label: 'Guided flight: plant → root hairs → membrane', variant: 'primary', onClick: () => tour() });
ui.section('Nutrient');
ui.segmented({ id: 'ion', label: 'Ion', options: ION_KEYS.map(k => ({ value: k, label: IONS[k].label })), value: 'no3' });
ui.slider({ id: 'conc', label: 'Bulk concentration C<sub>b</sub>', min: 0.1, max: 30000, log: true, value: 5000, format: fmtConc, help: 'Hoagland solution: 15 mM NO₃⁻, 6 mM K⁺, 1 mM H₂PO₄⁻. A fertilised topsoil holding 75 kg nitrate-N ha⁻¹ in 0–30 cm at θ = 0.3 has ≈ 6 mM NO₃⁻ in its soil solution. Soil-solution phosphate is usually below 10 µM.' });
ui.section('Root environment');
ui.segmented({ id: 'medium', label: 'Medium', options: [{ value: 'soil', label: 'Soil' }, { value: 'hydro', label: 'Hydroponic solution' }], value: 'soil' });
ui.slider({ id: 'theta', label: 'Soil water content θ', min: 0.08, max: 0.45, step: 0.01, value: 0.3, unit: 'm³ m⁻³', help: 'Porosity 0.5; impedance factor f = θ^{7/3}/φ² (Millington & Quirk)'.replace('^{7/3}', '⁷ᐟ³') });
ui.slider({ id: 'b', label: 'Buffer power b (selected ion)', min: 0.1, max: 2000, log: true, value: 0.3, format: v => fmt(v, v < 10 ? 1 : 0), help: 'NO₃⁻ is hardly adsorbed (b ≈ θ) · K⁺ moderately (order 10) · H₂PO₄⁻ strongly (order 100–1000)' });
ui.slider({ id: 'lv', label: 'Root length density L<sub>v</sub>', min: 0.2, max: 20, log: true, value: 1, digits: 1, unit: 'cm cm⁻³', help: 'Sets the half-distance between roots r₁ = 1/√(πL<sub>v</sub>)' });
ui.slider({ id: 'v0', label: 'Water influx at the root surface v₀', min: 1e-8, max: 1e-5, log: true, value: 1e-6, unit: 'cm s⁻¹', format: v => v.toExponential(1), help: 'Transpiration divided by root surface area; carries ions by mass flow' });
ui.slider({ id: 'delta', label: 'Unstirred layer (hydroponics) δ', min: 5, max: 500, log: true, value: 50, digits: 0, unit: 'µm' });
ui.slider({ id: 'T', label: 'Root-zone temperature', min: 5, max: 35, step: 0.5, value: 15, unit: '°C', help: 'Topsoil in a Nordic summer ≈ 12–18 °C · hydroponic solution ≈ 18–22 °C' });
ui.section('Root hairs');
ui.toggle({ id: 'hairs', label: 'Root hairs present', value: true });
ui.slider({ id: 'lh', label: 'Hair length l<sub>h</sub>', min: 0.05, max: 1.5, step: 0.05, value: 0.4, unit: 'mm' });
ui.slider({ id: 'nh', label: 'Hair density N<sub>h</sub>', min: 5, max: 200, step: 5, value: 50, unit: 'hairs per mm root' });
ui.section('Uptake kinetics (selected ion)');
ui.slider({ id: 'imax', label: 'I<sub>max</sub> at 20 °C', min: 0.3, max: 50, log: true, value: 10, format: v => fmt(v, v < 10 ? 2 : 1), unit: 'pmol cm⁻² s⁻¹' });
ui.slider({ id: 'km', label: 'K<sub>m</sub>', min: 1, max: 1000, log: true, value: 25, format: v => fmt(v, v < 10 ? 1 : 0), unit: 'µM' });
ui.slider({ id: 'cmin', label: 'C<sub>min</sub>', min: 0, max: 10, step: 0.05, value: 2, unit: 'µM' });
ui.slider({ id: 'q10', label: 'Q₁₀ of I<sub>max</sub>', min: 1, max: 3.5, step: 0.05, value: 2 });
ui.buttons([{ label: 'Literature values for this ion', onClick: () => { const I = IONS[ui.get('ion')]; applying = true; ui.setMany({ imax: I.Imax, km: I.Km, cmin: I.Cmin, b: I.b }); applying = false; Object.assign(ionState[curIon], { imax: I.Imax, km: I.Km, cmin: I.Cmin, b: I.b }); schedule(); } }]);
ui.section('Time');
ui.slider({ id: 'days', label: 'Simulated period', min: 1, max: 20, step: 1, value: 10, unit: 'd' });
const tSlider = ui.slider({ id: 'tday', label: 'Show day', min: 0, max: 20, step: 0.05, value: 10, unit: 'd', persist: false });
const [playBtn] = ui.buttons([{ label: '▶ Play depletion', variant: 'primary', onClick: () => { if (!clock.running && td >= ui.get('days') - 1e-6) clock.reset(0); clock.toggle(); } }, { label: 'Reset', onClick: () => { clock.pause(); clock.reset(0); setTime(0); } }]);

// presets (custom so that per-ion values are applied atomically)
const PRESETS = [
  { label: 'Hydroponic lettuce (Hoagland)', values: { ion: 'no3', medium: 'hydro', conc: 15000, imax: 10, km: 25, cmin: 2, b: 0.3, T: 20, hairs: true, days: 10 } },
  { label: 'Nitrate in moist soil', values: { ion: 'no3', medium: 'soil', conc: 1000, imax: 10, km: 25, cmin: 2, b: 0.3, theta: 0.3, lv: 2, T: 15, hairs: true, days: 10 } },
  { label: 'Phosphate in soil', values: { ion: 'p', medium: 'soil', conc: 5, imax: 3.26, km: 5.8, cmin: 0.2, b: 239, theta: 0.3, lv: 2, T: 15, hairs: true, lh: 0.4, nh: 50, days: 10 } },
  { label: 'Hairless mutant (phosphate)', values: { ion: 'p', medium: 'soil', conc: 5, imax: 3.26, km: 5.8, cmin: 0.2, b: 239, theta: 0.3, lv: 2, T: 15, hairs: false, days: 10 } },
  { label: 'Potassium in drying soil', values: { ion: 'k', medium: 'soil', conc: 200, imax: 5, km: 20, cmin: 2, b: 10, theta: 0.12, lv: 2, T: 15, hairs: true, days: 10 } },
  { label: 'Cold nutrient solution (8 °C)', values: { ion: 'no3', medium: 'hydro', conc: 15000, imax: 10, km: 25, cmin: 2, b: 0.3, T: 8, hairs: true, days: 10 } }
];
ui.section('Presets');
const presetWrap = ui.html(''); presetWrap.className = 'presets';
let applying = false;
PRESETS.forEach(pr => {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = pr.label;
  b.addEventListener('click', () => {
    applying = true; ui.setMany(pr.values); applying = false;
    curIon = ui.get('ion'); const v = ui.values(); Object.assign(ionState[curIon], { conc: v.conc, imax: v.imax, km: v.km, cmin: v.cmin, b: v.b });
    clock.pause(); td = ui.get('days'); clock.reset(td); schedule(); window.FFP && FFP.toast && FFP.toast('Preset: ' + pr.label);
  });
  presetWrap.appendChild(b);
});
ui.saveButton('nutrient-uptake-root', () => ro.values());

let curIon = ui.get('ion');
Object.assign(ionState[curIon], { conc: ui.get('conc'), imax: ui.get('imax'), km: ui.get('km'), cmin: ui.get('cmin'), b: ui.get('b') });
let td = ui.get('days');
tSlider.input.max = ui.get('days'); ui.set('tday', td, true);

const clock = new SimClock({ speed: 1, onFrame: t => { const d = ui.get('days'); if (t >= d) { clock.pause(); t = d; } setTime(t, true); } });
clock.onState(r => { playBtn.innerHTML = r ? '❚❚ Pause' : '▶ Play depletion'; });

/* ================================================================ charts */
const mmPlot = new Plot('#chart-mm', { x: { label: 'Concentration at the membrane', unit: 'µM', log: true, min: 0.1, max: 30000 }, y: { label: 'Influx per membrane area', unit: 'pmol cm⁻² s⁻¹', min: 0 } });
const profPlot = new Plot('#chart-profile', { x: { label: 'Distance from root surface', unit: 'mm', min: 0 }, y: { label: 'Relative concentration C/Cbulk', unit: '', min: 0, max: 1.05 } });
const cumPlot = new Plot('#chart-cum', { x: { label: 'Time', unit: 'd', min: 0 }, y: { label: 'Cumulative uptake', unit: 'µmol per m root', min: 0 }, y2: { label: 'Influx', unit: 'pmol cm⁻² s⁻¹', min: 0 } });

/* ================================================================ 3D stage */
const stage = createStage('#stage', {
  background: '#0b100e', envIntensity: 0.4, exposure: 1.0,
  camera: { pos: [0.5, 0.5, 0.9], target: [0, 0.2, 0], fov: 36, near: 0.005, far: 600 },
  controls: { minDistance: 0.08, maxDistance: 2.5 },
  bloom: { strength: 0.45, radius: 0.5, threshold: 1.0 }, ao: { radius: 0.05, intensity: 0.75 }
});
const { scene, camera, controls } = stage;
const hud = hudChips(stage.el);
const legend = document.createElement('div'); legend.className = 'stage-legend'; stage.el.appendChild(legend);
const scaleBar = document.createElement('div'); scaleBar.className = 'nu-scalebar'; scaleBar.innerHTML = '<i></i><span></span>'; stage.el.appendChild(scaleBar);
const fader = document.createElement('div'); fader.className = 'nu-fader'; fader.innerHTML = '<div><b></b><span></span></div>'; stage.el.appendChild(fader);

function rig(group, { size, keyPos, hemiI = 0.55, keyI = 2.3, fillI = 0.55, sky = 0xdfeeff, ground = 0x2a2f2a, keyColor = 0xfff4e5 }) {
  const hemi = new THREE.HemisphereLight(sky, ground, hemiI);
  const key = new THREE.DirectionalLight(keyColor, keyI); key.position.set(...keyPos);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -size, right: size, top: size, bottom: -size, near: size * 0.05, far: size * 14 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
  const fill = new THREE.DirectionalLight(0xcfe3ff, fillI); fill.position.set(-keyPos[0], keyPos[1] * 0.6, -keyPos[2]);
  group.add(hemi, key, key.target, fill);
  return { hemi, key, fill };
}
const softDot = canvasTexture(64, 64, (ctx, w) => { const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, w); }, { srgb: false, key: 'nu-dot' });

/* ---------------------------------------------------------------- root-system generator */
function growRootSystem({ style, seed, starts, box }) {
  const R = rng(seed); const geos = []; const polys = []; const tips = []; const curves = [];
  const cBase = new THREE.Color(style === 'soil' ? 0xc9ae86 : 0xe4dac0), cMid = new THREE.Color(style === 'soil' ? 0xe8dcc2 : 0xf5f0e4), cTip = new THREE.Color(0xfffbf2);
  const P = new THREE.Vector3(), c = new THREE.Color();
  function tube(pts, rBase, rTip, radial) {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
    const segs = Math.max(3, Math.round(pts.length * 1.3));
    const geo = new THREE.TubeGeometry(curve, segs, 1, radial, false);
    const pos = geo.attributes.position, nor = geo.attributes.normal; const col = new Float32Array(pos.count * 3);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs; curve.getPointAt(t, P);
      let rr = rTip + (rBase - rTip) * Math.pow(1 - t, 0.7); if (t > 0.96) rr *= Math.sqrt(Math.max(0.08, (1 - t) / 0.04));
      c.copy(cBase).lerp(cMid, Math.min(1, t * 1.8)); if (t > 0.9) c.lerp(cTip, (t - 0.9) / 0.1);
      for (let j = 0; j <= radial; j++) { const k = i * (radial + 1) + j; pos.setXYZ(k, P.x + nor.getX(k) * rr, P.y + nor.getY(k) * rr, P.z + nor.getZ(k) * rr); col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b; }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return { geo, curve };
  }
  const perp = (v, az) => { const a = Math.abs(v.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0); const u = new THREE.Vector3().crossVectors(v, a).normalize(); const w = new THREE.Vector3().crossVectors(v, u); return u.multiplyScalar(Math.cos(az)).addScaledVector(w, Math.sin(az)); };
  function addRoot(start, dir, L, rad, order) {
    const n = Math.max(4, Math.round(L / (order === 0 ? 0.006 : 0.0045)));
    const pts = [start.clone()]; const p = start.clone(), d = dir.clone().normalize();
    const g = (style === 'soil' ? [0.07, 0.022, 0.01] : [0.12, 0.045, 0.02])[order];
    const wob = order === 0 ? 0.15 : 0.24;
    for (let s = 0; s < n; s++) {
      d.x += (R() - 0.5) * wob; d.z += (R() - 0.5) * wob; d.y += (R() - 0.5) * wob * 0.4 - g;
      if (style === 'soil') d.z *= 0.25;
      d.normalize(); p.addScaledVector(d, L / n);
      if (p.x < box.x0) { p.x = box.x0; d.x = Math.abs(d.x); } if (p.x > box.x1) { p.x = box.x1; d.x = -Math.abs(d.x); }
      if (p.z < box.z0) { p.z = box.z0; d.z = Math.abs(d.z); } if (p.z > box.z1) { p.z = box.z1; d.z = -Math.abs(d.z); }
      if (p.y < box.y0) { p.y = box.y0; d.y = 0.05; d.x += (R() - 0.5) * 1.5; }
      if (p.y > box.y1) { p.y = box.y1; d.y = -Math.abs(d.y); }
      pts.push(p.clone());
    }
    const rTip = rad * 0.6;
    const { geo, curve } = tube(pts, rad, rTip, order === 0 ? 7 : order === 1 ? 5 : 4);
    geos.push(geo); polys.push({ pts, rad, order }); tips.push({ pos: pts[pts.length - 1].clone(), dir: d.clone(), order });
    if (order < 2) curves.push({ curve, L, rad: rTip * 1.2, order });
    if (order < 2) {
      const spacing = order === 0 ? 0.01 : 0.011;
      const nl = Math.floor(L * 0.82 / spacing);
      for (let k = 0; k < nl; k++) {
        const t = 0.05 + 0.8 * (k + R() * 0.7) / nl; if (t > 0.86) continue;
        if (order === 1 && R() < 0.45) continue;
        const sp = curve.getPointAt(t), tg = curve.getTangentAt(t);
        const nd = perp(tg, R() * Math.PI * 2).multiplyScalar(0.9).addScaledVector(tg, 0.25 + R() * 0.3).normalize();
        if (style === 'soil') { nd.z *= 0.15; nd.normalize(); }
        const Ll = L * (order === 0 ? 0.36 : 0.32) * Math.pow(1 - t, 0.7) * (0.55 + R() * 0.9);
        if (Ll < 0.007) continue;
        addRoot(sp, nd, Ll, rad * (order === 0 ? 0.5 : 0.55), order + 1);
      }
    }
  }
  starts.forEach(s => addRoot(s.pos, s.dir, s.len, s.rad, 0));
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, sheen: 0.5, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.5, clearcoat: 0.15 });
  const mesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(geos), mat);
  geos.forEach(g => g.dispose()); mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.kind = 'roots';
  return { mesh, polys, tips, curves };
}
/** Root hairs of the macro scene as fine line segments (real length). */
function hairLines(curves, lhMM, nh, seed) {
  const R = rng(seed); const arr = []; const P = new THREE.Vector3(), T = new THREE.Vector3();
  const lh = lhMM * 1e-3;
  for (const { curve, L, rad } of curves) {
    const z0 = 0.003, z1 = Math.min(L * 0.75, 0.022); if (z1 <= z0) continue;
    const count = Math.round((z1 - z0) * 1000 * nh * 0.14);
    for (let i = 0; i < count; i++) {
      const dist = z0 + R() * (z1 - z0), t = Math.max(0, 1 - dist / L);
      curve.getPointAt(t, P); curve.getTangentAt(t, T);
      const a = Math.abs(T.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const u = new THREE.Vector3().crossVectors(T, a).normalize(), w = new THREE.Vector3().crossVectors(T, u); const az = R() * 6.2832;
      const n = u.multiplyScalar(Math.cos(az)).addScaledVector(w, Math.sin(az));
      const len = lh * Math.min(1, (dist - z0) / 0.004) * (0.7 + R() * 0.5);
      const b = P.clone().addScaledVector(n, rad * 0.9);
      const e = b.clone().addScaledVector(n, len).addScaledVector(T, -len * 0.3);
      arr.push(b.x, b.y, b.z, e.x, e.y, e.z);
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false }));
}

/* ---------------------------------------------------------------- PLANT scale (metres) */
const macro = new THREE.Group(); scene.add(macro);
rig(macro, { size: 0.55, keyPos: [1.4, 2.6, 1.2] });
const bench = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.04, 0.8, 2, 0.008), new THREE.MeshStandardMaterial({ color: 0x5d6560, roughness: 0.5, metalness: 0.05 }));
bench.position.y = -0.02; bench.receiveShadow = true; macro.add(bench);
const backWall = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.6), new THREE.MeshStandardMaterial({ color: 0x24302b, roughness: 0.95 })); backWall.position.set(0, 0.6, -0.4); backWall.receiveShadow = true; macro.add(backWall);

// Hydroponic set-up: glass tank, foam lid, net pot, clay pebbles, lettuce, hanging roots
const hydroG = new THREE.Group(); macro.add(hydroG);
const TANK = { w: 0.34, h: 0.28, d: 0.26 };
const tank = makeTank({ w: TANK.w, h: TANK.h, d: TANK.d, material: 'glass', level: 0.9, waterTint: 0x2b7f98, clarity: 0.22 }); hydroG.add(tank);
const lid = makeRaft({ w: TANK.w + 0.012, d: TANK.d + 0.012, thickness: 0.022, nx: 1, nz: 1, holeR: 0.031 }); lid.position.y = TANK.h; hydroG.add(lid);
const LID_TOP = TANK.h + 0.025;
const pot = makeNetPot({ radius: 0.031, height: 0.06 }); pot.position.y = LID_TOP; hydroG.add(pot);
{ // clay pebbles (expanded clay aggregate)
  const R = rng(31); const n = 46; const geo = BufferGeometryUtils.mergeVertices(new THREE.IcosahedronGeometry(1, 3));
  const pa = geo.attributes.position; for (let i = 0; i < pa.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(pa, i); v.multiplyScalar(1 + 0.12 * fbm2(v.x * 2 + 3, v.y * 2 + v.z)); pa.setXYZ(i, v.x, v.y, v.z); } geo.computeVertexNormals();
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xa65a34, roughness: 0.95 }), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(); const col = new THREE.Color();
  for (let i = 0; i < n; i++) { const r = 0.024 * Math.sqrt(R()), a = R() * 6.28, sc = 0.0065 + R() * 0.003; q.setFromEuler(new THREE.Euler(R() * 3, R() * 3, R() * 3)); s.set(sc, sc * 0.9, sc); m4.compose(new THREE.Vector3(Math.cos(a) * r, LID_TOP - 0.048 + R() * 0.052, Math.sin(a) * r), q, s); im.setMatrixAt(i, m4); col.setHSL(0.05 + R() * 0.02, 0.5, 0.33 + R() * 0.1); im.setColorAt(i, col); }
  im.castShadow = im.receiveShadow = true; hydroG.add(im);
}
const lettuceH = makeLettuce({ radius: 0.15, growth: 0.8, variety: 'butterhead', seed: 7 }); lettuceH.position.y = LID_TOP + 0.004; hydroG.add(lettuceH);
const hydroRootStarts = (() => { const R = rng(5); const out = []; for (let i = 0; i < 18; i++) { const a = R() * 6.2832, rr = 0.012 + R() * 0.012; out.push({ pos: new THREE.Vector3(Math.cos(a) * rr, LID_TOP - 0.05 + R() * 0.02, Math.sin(a) * rr), dir: new THREE.Vector3(Math.cos(a) * 0.35, -1, Math.sin(a) * 0.35), len: 0.15 + R() * 0.09, rad: 0.0009 + R() * 0.0003 }); } return out; })();
const hydroRoots = growRootSystem({ style: 'hanging', seed: 11, starts: hydroRootStarts, box: { x0: -0.155, x1: 0.155, y0: 0.02, y1: LID_TOP - 0.02, z0: -0.115, z1: 0.115 } });
hydroG.add(hydroRoots.mesh);
let hydroHair = null;
const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8c8f8e, roughness: 1 });
const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 20), stoneMat); stone.position.set(0.11, 0.022, 0.06); hydroG.add(stone);
const airline = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.11, 0.032, 0.06), new THREE.Vector3(0.14, 0.12, 0.09), new THREE.Vector3(0.15, 0.3, 0.1), new THREE.Vector3(0.2, 0.36, 0.14)]), 30, 0.0025, 8), new THREE.MeshPhysicalMaterial({ color: 0xdfe8e6, roughness: 0.2, transparent: true, opacity: 0.7 })); hydroG.add(airline);
const bubbles = new Bubbles({ emitters: [[0.11, 0.035, 0.06]], top: tank.levelY, rate: 30, size: 0.0025, spread: 0.018, speed: 0.22 }); hydroG.add(bubbles.mesh);
const loop = new THREE.CatmullRomCurve3([[-0.12, 0.05, -0.08], [0.12, 0.05, -0.08], [0.13, 0.18, 0.0], [0.12, 0.05, 0.08], [-0.12, 0.05, 0.08], [-0.13, 0.2, 0]].map(a => new THREE.Vector3(...a)), true);
const flow = new FlowAlong(loop, { count: 90, speed: 0.05, size: 0.006, color: 0x8fdcf5, jitter: 0.03, opacity: 0.5 }); hydroG.add(flow.points);
hydroG.add(stage.addLabel([0.19, 0.16, 0.13], 'Nutrient solution<small>well mixed, flowing</small>'));

// Soil set-up: rhizobox with glass front, roots against the glass, depletion map
const soilG = new THREE.Group(); macro.add(soilG);
const SB = { x0: -0.16, x1: 0.16, y0: 0.012, y1: 0.29, zf: 0.030 };
{
  const frameM = new THREE.MeshStandardMaterial({ color: 0x1d2023, roughness: 0.5, metalness: 0.2 });
  const add = (w, h, d, x, y, z, m = frameM) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; soilG.add(b); return b; };
  add(0.36, 0.012, 0.09, 0, 0.006, 0);             // base
  add(0.012, 0.31, 0.09, -0.174, 0.155, 0); add(0.012, 0.31, 0.09, 0.174, 0.155, 0); // sides
  add(0.36, 0.31, 0.008, 0, 0.155, -0.041);        // back
  add(0.36, 0.012, 0.012, 0, 0.312, 0.039); add(0.36, 0.012, 0.012, 0, 0.006, 0.039); // front frame
  const soil = new THREE.Mesh(new THREE.BoxGeometry(0.336, SB.y1 - SB.y0, 0.07), surfaceMaterial('soil', [4, 4], { color: 0xc08a58 })); soil.position.set(0, (SB.y0 + SB.y1) / 2, -0.005); soil.receiveShadow = true; soilG.add(soil);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.336, 0.3), M.glassCheap(0.05)); glass.position.set(0, 0.156, 0.037); soilG.add(glass);
  // wooden stand to tilt? keep simple: two feet
  add(0.05, 0.02, 0.16, -0.14, 0.01, 0.0); add(0.05, 0.02, 0.16, 0.14, 0.01, 0.0);
}
const lettuceS = makeLettuce({ radius: 0.14, growth: 0.75, variety: 'butterhead', seed: 8 }); lettuceS.position.set(0, SB.y1 + 0.002, 0); soilG.add(lettuceS);
const soilRootStarts = (() => { const R = rng(9); const out = [{ pos: new THREE.Vector3(0, SB.y1 - 0.004, 0.034), dir: new THREE.Vector3(0.05, -1, 0), len: 0.25, rad: 0.0014 }]; for (let i = 0; i < 7; i++) { const s = i % 2 ? 1 : -1; out.push({ pos: new THREE.Vector3(s * 0.004, SB.y1 - 0.006 - i * 0.004, 0.034), dir: new THREE.Vector3(s * (0.6 + R() * 0.8), -0.55 - R() * 0.4, 0), len: 0.12 + R() * 0.1, rad: 0.0008 + R() * 0.0003 }); } return out; })();
const soilRoots = growRootSystem({ style: 'soil', seed: 21, starts: soilRootStarts, box: { x0: SB.x0 + 0.004, x1: SB.x1 - 0.004, y0: SB.y0 + 0.006, y1: SB.y1 - 0.003, z0: 0.0318, z1: 0.0352 } });
soilG.add(soilRoots.mesh);
let soilHair = null;
// depletion map on the soil face behind the roots
const MAP_W = 560, MAP_H = Math.round(560 * (SB.y1 - SB.y0) / 0.32), PX = 0.32 / MAP_W;
const mapCanvas = document.createElement('canvas'); mapCanvas.width = MAP_W; mapCanvas.height = MAP_H;
const mapCtx = mapCanvas.getContext('2d'); const mapImg = mapCtx.createImageData(MAP_W, MAP_H);
const mapTex = new THREE.CanvasTexture(mapCanvas); mapTex.colorSpace = THREE.SRGBColorSpace;
// additive "false-colour imaging" overlay (like a planar optode image): the soil texture stays visible under the colour
const mapPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.32, SB.y1 - SB.y0), new THREE.MeshBasicMaterial({ map: mapTex, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
mapPlane.position.set(0, (SB.y0 + SB.y1) / 2, SB.zf + 0.0003); soilG.add(mapPlane);
const distField = (() => { // exact Euclidean distance transform (Felzenszwalb & Huttenlocher) from the root tubes
  const W = MAP_W, H = MAP_H, INF = 1e20; const g = new Float64Array(W * H).fill(INF);
  for (const { pts, rad } of soilRoots.polys) for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / PX * 2) + 1;
    const rp = Math.max(0.5, rad / PX);
    for (let k = 0; k <= n; k++) { const x = (a.x + (b.x - a.x) * k / n - SB.x0 - 0.0) / PX, y = (SB.y1 - (a.y + (b.y - a.y) * k / n)) / PX; for (let dy = -Math.ceil(rp); dy <= Math.ceil(rp); dy++) for (let dx = -Math.ceil(rp); dx <= Math.ceil(rp); dx++) { if (dx * dx + dy * dy > rp * rp + 0.25) continue; const X = Math.round(x + dx), Y = Math.round(y + dy); if (X >= 0 && X < W && Y >= 0 && Y < H) g[Y * W + X] = 0; } }
  }
  const dt1 = (f, n) => { const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1); let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF; for (let q = 1; q < n; q++) { let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); } k++; v[k] = q; z[k] = s; z[k + 1] = INF; } k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; } return d; };
  const col = new Float64Array(H); for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) col[y] = g[y * W + x]; const d = dt1(col, H); for (let y = 0; y < H; y++) g[y * W + x] = d[y]; }
  const row = new Float64Array(W); for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) row[x] = g[y * W + x]; const d = dt1(row, W); for (let x = 0; x < W; x++) g[y * W + x] = d[x]; }
  const out = new Float32Array(W * H); for (let i = 0; i < W * H; i++) out[i] = Math.sqrt(g[i]) * PX; return out;
})();
// depletion ramp: a sub-range of magma so that fully depleted soil reads as a saturated orange-red, not as a blank cream panel
const DEP_T = t => 0.12 + 0.72 * t;
const MAG = []; for (let i = 0; i <= 255; i++) MAG.push(colormap('magma', DEP_T(i / 255)));
const DEP_GRADIENT = 'linear-gradient(to right, ' + [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => { const c = colormap('magma', DEP_T(i / 8)); return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0}) ${i * 12.5}%`; }).join(', ') + ')';
function paintDepletionMap(sim, prof, Cs) {
  const d = mapImg.data; const Cb = sim.K.Cb / UM; const lut = new Float32Array(400); const dmax = 0.012;
  for (let i = 0; i < 400; i++) lut[i] = concAtR(sim, prof, Cs, R0 + dmax * i / 399) / Cb;
  const far = concAtR(sim, prof, Cs, sim.R1) / Cb;
  for (let i = 0; i < distField.length; i++) {
    const dist = distField[i]; const rel = dist >= dmax ? far : lut[Math.round(dist / dmax * 399)];
    const D = Math.max(0, Math.min(1, 1 - rel)); const k = i * 4;
    if (dist === 0) { d[k + 3] = 0; continue; }
    const c = MAG[Math.round(D * 255)]; d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = D < 0.02 ? 0 : Math.round(255 * 0.78 * Math.pow(D, 1.2));
  }
  mapCtx.putImageData(mapImg, 0, 0); mapTex.needsUpdate = true;
}
soilG.add(stage.addLabel([-0.17, 0.33, 0.04], 'Rhizobox<small>soil behind glass · depletion map</small>'));
macro.add(stage.addLabel([0.0, 0.08, 0.04], 'Click a root to zoom in'));

/* ---------------------------------------------------------------- ROOT-HAIR scale (1 unit = 0.1 mm) */
const hairsG = new THREE.Group(); hairsG.visible = false; scene.add(hairsG);
rig(hairsG, { size: 40, keyPos: [18, 40, 26], hemiI: 0.6, keyI: 2.1 });
const RR = 2;            // root radius in units
const X0 = -34, XT = 15;  // base and tip x of the displayed root segment
function cellLen(x) { return x < 2 ? 1.5 : x < 9 ? 1.5 - 1.25 * (x - 2) / 7 : 0.25; } // µm·10⁻² — cells elongate behind the meristem
function epidermisTextures() {
  const W = 1024, H = 1024, files = 24, cells = 16;
  const col = document.createElement('canvas'); col.width = W; col.height = H; const cx = col.getContext('2d');
  const hgt = document.createElement('canvas'); hgt.width = W; hgt.height = H; const hx = hgt.getContext('2d');
  cx.fillStyle = '#cfe0c8'; cx.fillRect(0, 0, W, H); hx.fillStyle = '#000'; hx.fillRect(0, 0, W, H);
  const R = rng(3); const fw = W / files, ch = H / cells;
  for (let f = 0; f < files; f++) {
    const off = R() * ch;
    for (let c = -1; c <= cells; c++) {
      const x = f * fw, y = c * ch + off, w = fw, h = ch * (0.85 + R() * 0.3);
      [0, H].forEach(sh => {
        const yy = y - sh; if (yy > H || yy + h < 0) return;
        const g = cx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#dce9d3'); g.addColorStop(0.5, '#f4f8ee'); g.addColorStop(1, '#d6e4cd');
        cx.fillStyle = g; cx.beginPath(); cx.roundRect(x + 2.5, yy + 2.5, w - 5, h - 5, 9); cx.fill();
        cx.fillStyle = 'rgba(160,190,150,0.35)'; for (let s = 0; s < 3; s++) { cx.fillRect(x + 6 + R() * (w - 14), yy + 6 + R() * (h - 14), 1.2, 6 + R() * 18); }
        cx.fillStyle = 'rgba(150,160,190,0.55)'; cx.beginPath(); cx.ellipse(x + w * (0.3 + R() * 0.4), yy + h * (0.2 + R() * 0.6), 6, 9, 0, 0, 6.3); cx.fill();
        const hg = hx.createRadialGradient(x + w / 2, yy + h / 2, 2, x + w / 2, yy + h / 2, Math.max(w, h) * 0.62); hg.addColorStop(0, '#fff'); hg.addColorStop(1, '#222');
        hx.fillStyle = hg; hx.beginPath(); hx.roundRect(x + 2.5, yy + 2.5, w - 5, h - 5, 9); hx.fill();
      });
    }
  }
  // normal map from the height map
  const hd = hx.getImageData(0, 0, W, H).data; const nc = document.createElement('canvas'); nc.width = W; nc.height = H; const nx = nc.getContext('2d'); const ni = nx.createImageData(W, H);
  const hv = (x, y) => hd[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = (hv(x + 1, y) - hv(x - 1, y)) * 3, dy = (hv(x, y + 1) - hv(x, y - 1)) * 3; const L = Math.hypot(dx, dy, 1); const k = (y * W + x) * 4; ni.data[k] = (-dx / L * 0.5 + 0.5) * 255; ni.data[k + 1] = (-dy / L * 0.5 + 0.5) * 255; ni.data[k + 2] = (1 / L * 0.5 + 0.5) * 255; ni.data[k + 3] = 255; }
  nx.putImageData(ni, 0, 0);
  const mk = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return { map: mk(col, true), normal: mk(nc, false) };
}
const epiTex = epidermisTextures();
function rootShellGeometry(radius, nx = 240, nth = 72, tipTo = XT) {
  // root along +x from X0 to the tip; paraboloid tip from x = tipTo − 6
  const pos = [], uv = [], idx = [];
  const tip0 = tipTo - 6; let v = 0; const xs = [];
  for (let i = 0; i <= nx; i++) xs.push(X0 + (tipTo - X0) * i / nx);
  const vs = [0]; for (let i = 1; i <= nx; i++) { const dx = xs[i] - xs[i - 1]; v += dx / cellLen((xs[i] + xs[i - 1]) / 2) / 16; vs.push(v); }
  for (let i = 0; i <= nx; i++) {
    const x = xs[i]; const r = x < tip0 ? radius : radius * Math.sqrt(Math.max(0, (tipTo - x) / (tipTo - tip0)));
    for (let j = 0; j <= nth; j++) { const th = j / nth * Math.PI * 2; pos.push(x, Math.max(r, 0.001) * Math.cos(th), Math.max(r, 0.001) * Math.sin(th)); uv.push(j / nth, vs[i]); }
  }
  for (let i = 0; i < nx; i++) for (let j = 0; j < nth; j++) { const a = i * (nth + 1) + j, b = a + nth + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const epidermis = new THREE.Mesh(rootShellGeometry(RR), new THREE.MeshPhysicalMaterial({ map: epiTex.map, normalMap: epiTex.normal, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.34, clearcoat: 0.55, clearcoatRoughness: 0.3, sheen: 0.45, sheenColor: new THREE.Color(0xe8ffe0), transparent: true, opacity: 0.8 }));
epidermis.userData.kind = 'epidermis'; epidermis.castShadow = true; epidermis.receiveShadow = true; hairsG.add(epidermis);
const cortex = new THREE.Mesh(rootShellGeometry(RR * 0.8, 120, 36, XT - 0.6), new THREE.MeshStandardMaterial({ color: 0xc7cfa8, roughness: 0.7 })); hairsG.add(cortex);
const stele = new THREE.Mesh(rootShellGeometry(RR * 0.3, 80, 24, XT - 4), new THREE.MeshStandardMaterial({ color: 0xa9b57a, roughness: 0.6 })); hairsG.add(stele);
const cap = new THREE.Mesh(rootShellGeometry(RR * 1.08, 60, 48, XT + 0.5), new THREE.MeshPhysicalMaterial({ color: 0xf3e7c4, roughness: 0.5, transparent: true, opacity: 0.45, depthWrite: false })); cap.geometry.translate(0, 0, 0);
{ // keep only the cap part (x > XT − 5)
  const pa = cap.geometry.attributes.position; for (let i = 0; i < pa.count; i++) if (pa.getX(i) < XT - 5) pa.setX(i, XT - 5); cap.geometry.computeVertexNormals(); hairsG.add(cap);
}
{ // sloughed border cells around the cap
  const R = rng(17); const n = 26; const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshPhysicalMaterial({ color: 0xf6ecd0, roughness: 0.4, transparent: true, opacity: 0.6 }), n);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) { const x = XT - 3 + R() * 4.5, th = R() * 6.28, rr = RR * Math.sqrt(Math.max(0.05, (XT + 0.5 - x) / 6.5)) + 0.35 + R() * 0.8; m4.compose(new THREE.Vector3(x, rr * Math.cos(th), rr * Math.sin(th)), new THREE.Quaternion().setFromEuler(new THREE.Euler(R(), R(), R())), new THREE.Vector3(0.32, 0.22, 0.2)); im.setMatrixAt(i, m4); }
  hairsG.add(im);
}
let hairMesh = null, particleG = null, particleKey = '';
const hairMat = new THREE.MeshPhysicalMaterial({ color: 0xf4f7ee, roughness: 0.35, transparent: true, opacity: 0.82, sheen: 0.6, sheenColor: new THREE.Color(0xffffff), clearcoat: 0.3 });
function buildHairScene(p) {
  if (hairMesh) { hairsG.remove(hairMesh); hairMesh.geometry.dispose(); hairMesh = null; }
  if (p.hairs) {
    const R = rng(41); const geos = []; const L = p.lh * 10; const n = Math.round((2 - X0) / 10 * p.nh * 0.9);
    for (let i = 0; i < n; i++) {
      const x = X0 + 1 + R() * (2 - X0 - 1); const th = R() * Math.PI * 2;
      const len = L * Math.min(1, (2 - x) / 7) * (0.75 + R() * 0.45); if (len < 0.15) continue;
      const nrm = new THREE.Vector3(0, Math.cos(th), Math.sin(th)); const side = new THREE.Vector3(0, -Math.sin(th), Math.cos(th));
      const base = new THREE.Vector3(x, 0, 0).addScaledVector(nrm, RR * 0.97); const pts = [base.clone()];
      const bend = (R() - 0.5) * 0.5, back = 0.15 + R() * 0.2;
      for (let k = 1; k <= 7; k++) { const s = k / 7; pts.push(base.clone().addScaledVector(nrm, len * s).addScaledVector(side, bend * len * s * s).add(new THREE.Vector3(-back * len * s * s, 0, 0))); }
      const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.075, 6, false); geos.push(tg);
      const tipS = new THREE.SphereGeometry(0.075, 8, 6); tipS.translate(...pts[pts.length - 1].toArray()); geos.push(tipS);
    }
    if (geos.length) { const merged = BufferGeometryUtils.mergeGeometries(geos); geos.forEach(g => g.dispose()); hairMesh = new THREE.Mesh(merged, hairMat); hairMesh.castShadow = true; hairMesh.userData.kind = 'epidermis'; hairsG.add(hairMesh); }
  }
  const key = p.medium;
  if (key !== particleKey) {
    if (particleG) { hairsG.remove(particleG); particleG.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    particleG = new THREE.Group(); particleKey = key; hairsG.add(particleG); grains.length = 0; streaks = null;
    if (p.medium === 'soil') {
      const R = rng(77); const n = 170; const ig = BufferGeometryUtils.mergeVertices(new THREE.IcosahedronGeometry(1, 3));
      const pa = ig.attributes.position; for (let i = 0; i < pa.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(pa, i); v.multiplyScalar(1 + 0.22 * fbm2(v.x * 1.3 + 5, v.y * 1.3 - v.z * 0.7, 3)); pa.setXYZ(i, v.x, v.y, v.z); } ig.computeVertexNormals();
      const sand = new THREE.InstancedMesh(ig, new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.5, sheen: 0.3 }), n);
      const m4 = new THREE.Matrix4(); const col = new THREE.Color(); let k = 0;
      for (let tries = 0; tries < 4000 && k < n; tries++) {
        const big = R() < 0.3; const s = big ? 1.0 + R() * 1.5 : 0.3 + R() * 0.5;
        const x = X0 + R() * (XT + 6 - X0), th = R() * 6.2832, rr = RR + (p.hairs ? 0.3 : 0.2) + s + Math.pow(R(), 0.8) * 20;
        const c = new THREE.Vector3(x, rr * Math.cos(th), rr * Math.sin(th));
        if (c.z > -0.5 && c.z + s > 0 && rr < 17) continue;   // cut-away towards the viewer
        if (grains.some(g => g.c.distanceTo(c) < (g.s + s) * 0.95)) continue;
        grains.push({ c, s });
        m4.compose(c, new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 3, R() * 3, R() * 3)), new THREE.Vector3(s, s * (0.75 + R() * 0.3), s * (0.8 + R() * 0.3)));
        sand.setMatrixAt(k, m4);
        if (big) col.setHSL(0.08 + R() * 0.05, 0.3 + R() * 0.2, 0.42 + R() * 0.16); else col.setHSL(0.06, 0.4, 0.14 + R() * 0.08);
        sand.setColorAt(k, col); k++;
      }
      sand.count = k; sand.castShadow = sand.receiveShadow = true; particleG.add(sand);
    } else {
      const n = 380; const pos = new Float32Array(n * 3); const R = rng(5);
      for (let i = 0; i < n; i++) { const th = R() * 6.28, rr = RR + 1 + R() * 20; pos.set([X0 + R() * (XT + 8 - X0), rr * Math.cos(th), rr * Math.sin(th)], i * 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      streaks = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfefff, size: 0.35, map: softDot, transparent: true, opacity: 0.35, depthWrite: false })); streaks.frustumCulled = false; particleG.add(streaks);
    }
  }
}
const grains = []; let streaks = null;
// ions in pore water / solution (selected ion), density follows the computed radial profile
const NION = 900; const ionPos = new Float32Array(NION * 3); const ionSt = [];
const ionGeo = new THREE.BufferGeometry(); ionGeo.setAttribute('position', new THREE.BufferAttribute(ionPos, 3));
const ionPts = new THREE.Points(ionGeo, new THREE.PointsMaterial({ color: 0x3d9bff, size: 0.42, map: softDot, transparent: true, depthWrite: false, opacity: 0.95 })); ionPts.frustumCulled = false; hairsG.add(ionPts);
let ionCDF = null, ionAbsRate = 0, ionRin = RR;
for (let i = 0; i < NION; i++) ionSt.push({ x: 0, r: 5, th: 0, m: 0, t: 0 });
function sampleR(R) { if (!ionCDF) return RR + R * 20; const u = R; let lo = 0, hi = ionCDF.c.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ionCDF.c[m] < u) lo = m; else hi = m; } return ionCDF.r[lo] + (ionCDF.r[hi] - ionCDF.r[lo]) * Math.random(); }
function spawnIon(s) { s.x = X0 + Math.random() * (XT + 4 - X0); s.th = Math.random() * 6.2832; s.r = sampleR(Math.random()); s.m = 0; s.t = 0; }
// concentration cross-section disc
const discCanvas = document.createElement('canvas'); discCanvas.width = discCanvas.height = 256; const discTex = new THREE.CanvasTexture(discCanvas); discTex.colorSpace = THREE.SRGBColorSpace;
const disc = new THREE.Mesh(new THREE.CircleGeometry(14, 96), new THREE.MeshBasicMaterial({ map: discTex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
disc.rotation.y = Math.PI / 2; disc.position.x = X0 - 0.3; hairsG.add(disc);
const DISC_RMAX = 14;
function paintDisc(sim, prof, Cs) {
  const ctx = discCanvas.getContext('2d'), W = 256; const img = ctx.createImageData(W, W); const Cb = sim.K.Cb / UM;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const rr = Math.hypot(x - W / 2 + 0.5, y - W / 2 + 0.5) / (W / 2) * DISC_RMAX; const k = (y * W + x) * 4;
    if (rr > DISC_RMAX) { img.data[k + 3] = 0; continue; }
    if (rr < RR) { img.data[k] = 205; img.data[k + 1] = 214; img.data[k + 2] = 170; img.data[k + 3] = 255; continue; }
    const rel = concAtR(sim, prof, Cs, rr * 1e-4) / Cb; const c = colormap('viridis', Math.max(0, Math.min(1, rel)));
    img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = rr > DISC_RMAX - 0.6 ? 90 : 205;
  }
  ctx.putImageData(img, 0, 0); discTex.needsUpdate = true;
}
const hairLabels = [
  stage.addLabel(new THREE.Vector3(-18, RR + 0.2, 0.6), 'Epidermal cells'),
  stage.addLabel(new THREE.Vector3(XT + 0.8, 1.6, 0), 'Root cap'),
  stage.addLabel(new THREE.Vector3(X0, 15.5, 0), 'Cross-section: C/C<sub>b</sub>'),
  stage.addLabel(new THREE.Vector3(-8, -RR - 4.5, 3), 'Root hairs')
];
hairLabels.forEach(l => { hairsG.add(l); });

/* ---------------------------------------------------------------- MEMBRANE scale (1 unit = 1 nm) */
const memG = new THREE.Group(); memG.visible = false; scene.add(memG);
rig(memG, { size: 30, keyPos: [14, 34, 20], hemiI: 0.7, keyI: 2.0, sky: 0xdfe8ff, ground: 0x1a1830 });
const PXH = 17, PZH = 10, YH = 2.3;
const PROTEINS = [
  { kind: 'atpase', x: -9, z: -3.5 }, { kind: 'atpase', x: 9.5, z: 4 },
  { kind: 'nrt', x: -2.5, z: 4.5 }, { kind: 'nrt', x: 12, z: -5 },
  { kind: 'akt', x: 3.5, z: -4.5 }, { kind: 'akt', x: -13.5, z: 5 },
  { kind: 'pht', x: -14, z: -5.5 }, { kind: 'pht', x: 3, z: 6.5 }
];
const PROT_INFO = {
  atpase: { name: 'H⁺-ATPase (AHA)', r: 2.6, color: 0x26b3a0, desc: 'P-type proton pump: 1 H⁺ out per ATP hydrolysed' },
  nrt: { name: 'NRT2.1', r: 2.5, color: 0x3a78e6, desc: 'high-affinity 2 H⁺ : 1 NO₃⁻ symporter' },
  akt: { name: 'AKT1', r: 3.3, color: 0x8b5cf6, desc: 'inward-rectifying K⁺ channel, driven by the membrane potential' },
  pht: { name: 'PHT1', r: 2.5, color: 0xe39a2e, desc: 'H⁺/H₂PO₄⁻ symporter (2–4 H⁺ per phosphate)' }
};
function helixBundle(n, ring, height, seed, x0 = 0) {
  const R = rng(seed); const geos = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + R() * 0.2, rr = ring * (i % 3 === 0 ? 0.45 : 1); const g = new THREE.CylinderGeometry(0.46, 0.46, height, 12, 1); g.rotateZ((R() - 0.5) * 0.45); g.rotateX((R() - 0.5) * 0.45); g.translate(x0 + Math.cos(a) * rr, (R() - 0.5) * 0.6, Math.sin(a) * rr); geos.push(g); }
  return BufferGeometryUtils.mergeGeometries(geos);
}
function blob(r, seed) { const g = BufferGeometryUtils.mergeVertices(new THREE.IcosahedronGeometry(r, 4)); const pa = g.attributes.position; const o = seed * 3.1; for (let i = 0; i < pa.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(pa, i); const n = fbm2(v.x * 0.9 + o, v.y * 0.9 + v.z * 0.7 - o, 4); v.multiplyScalar(1 + 0.16 * n); pa.setXYZ(i, v.x, v.y, v.z); } g.computeVertexNormals(); return g; }
const protMat = c => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.35, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) });
const proteins = [];
PROTEINS.forEach((pr, i) => {
  const g = new THREE.Group(); g.position.set(pr.x, 0, pr.z); const info = PROT_INFO[pr.kind]; const mat = protMat(info.color);
  const parts = {};
  if (pr.kind === 'atpase') {
    g.add(new THREE.Mesh(helixBundle(10, 1.7, 5.6, 10 + i), mat));
    const P = new THREE.Mesh(blob(1.9, 1 + i), mat); P.position.set(0, -4.6, 0); const N = new THREE.Mesh(blob(1.55, 2 + i), mat); N.position.set(1.5, -6.6, 0.4); const A = new THREE.Mesh(blob(1.45, 3 + i), mat); A.position.set(-1.8, -5.3, 0.9);
    g.add(P, N, A); parts.N = N;
  } else if (pr.kind === 'nrt' || pr.kind === 'pht') {
    const a = new THREE.Group(), b = new THREE.Group(); a.add(new THREE.Mesh(helixBundle(6, 1.05, 5.4, 20 + i, 0), mat)); b.add(new THREE.Mesh(helixBundle(6, 1.05, 5.4, 30 + i, 0), mat));
    a.position.x = -1.05; b.position.x = 1.05; g.add(a, b); parts.a = a; parts.b = b;
    const loopG = new THREE.Mesh(blob(0.9, 40 + i), mat); loopG.position.set(0, -3.6, 0); g.add(loopG);
  } else {
    for (let s = 0; s < 4; s++) { const sub = new THREE.Mesh(helixBundle(6, 0.9, 5.4, 50 + s + i * 4), mat); const a = s * Math.PI / 2 + Math.PI / 4; sub.position.set(Math.cos(a) * 2.1, 0, Math.sin(a) * 2.1); g.add(sub); const cd = new THREE.Mesh(blob(1.15, 60 + s + i), mat); cd.position.set(Math.cos(a) * 2.2, -4.2, Math.sin(a) * 2.2); g.add(cd); }
    const filter = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.14, 10, 28), new THREE.MeshStandardMaterial({ color: 0xffd36b, metalness: 0.6, roughness: 0.3, emissive: 0x6a4a00, emissiveIntensity: 0.4 })); filter.rotation.x = Math.PI / 2; filter.position.y = 1.2; g.add(filter);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.protein = i; } });
  memG.add(g); proteins.push({ ...pr, g, parts, info, phase: Math.random(), busy: null });
});
// lipid bilayer: heads (instanced), hydrophobic core slab with tails texture
{
  const R = rng(8); const heads = []; const sp = 0.84;
  for (const side of [1, -1]) for (let row = 0; row * sp * 0.866 < PZH * 2; row++) for (let col = 0; col * sp < PXH * 2; col++) {
    const x = -PXH + col * sp + (row % 2) * sp / 2 + (R() - 0.5) * 0.12, z = -PZH + row * sp * 0.866 + (R() - 0.5) * 0.12;
    if (PROTEINS.some(pr => Math.hypot(x - pr.x, z - pr.z) < PROT_INFO[pr.kind].r + 0.35)) continue;
    heads.push([x, side * (YH + (R() - 0.5) * 0.18), z]);
  }
  const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }), heads.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color(); const pal = ['#ece3cc', '#efc98a', '#e6b06a', '#ddd6c2', '#e9a9a0'];
  heads.forEach((h, i) => { m4.makeTranslation(h[0], h[1], h[2]); im.setMatrixAt(i, m4); col.set(pal[Math.floor(R() * (R() < 0.08 ? 5 : 4))]); im.setColorAt(i, col); });
  im.castShadow = im.receiveShadow = true; memG.add(im);
  const tails = canvasTexture(512, 128, (ctx, w, h) => { ctx.fillStyle = '#e8d9a0'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = 'rgba(160,125,50,0.55)'; ctx.lineWidth = 2; for (let x = 3; x < w; x += 6) { [[0, h / 2 - 3], [h, h / 2 + 3]].forEach(([y0, y1]) => { ctx.beginPath(); ctx.moveTo(x, y0); for (let k = 1; k <= 8; k++) { const y = y0 + (y1 - y0) * k / 8; ctx.lineTo(x + Math.sin(k * 1.7 + x) * 2.2, y); } ctx.stroke(); }); } }, { key: 'nu-tails', repeat: [4, 1] });
  const coreMats = [0, 1, 2, 3, 4, 5].map(k => new THREE.MeshStandardMaterial({ color: 0xffffff, map: k === 2 || k === 3 ? null : tails, roughness: 0.8, ...(k === 2 || k === 3 ? { color: 0xd9c98e } : {}) }));
  const core = new THREE.Mesh(new THREE.BoxGeometry(PXH * 2, YH * 2 - 0.5, PZH * 2), coreMats); memG.add(core);
  // cellulose microfibrils of the cell wall (apoplast)
  const fm = new THREE.MeshStandardMaterial({ color: 0xf1efe2, roughness: 0.6, transparent: true, opacity: 0.55 });
  for (let i = 0; i < 9; i++) { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 44, 8), fm); f.rotation.z = Math.PI / 2; f.rotation.y = (i % 2 ? 0.35 : -0.25) + (R() - 0.5) * 0.2; f.position.set(0, 11 + (i % 3) * 0.8, -9 + i * 2.2); memG.add(f); }
}
// ions at the membrane (instanced pools)
const ION_TYPES = {
  h: { r: 0.24, color: 0xff3d6e, emissive: 0.9, label: 'H⁺' }, no3: { r: 0.44, color: IONS.no3.color, emissive: 0.15, label: 'NO₃⁻' },
  k: { r: 0.4, color: IONS.k.color, emissive: 0.15, label: 'K⁺' }, p: { r: 0.48, color: IONS.p.color, emissive: 0.15, label: 'H₂PO₄⁻' },
  atp: { r: 0.55, color: 0xd6f25a, emissive: 0.15, label: 'ATP' }
};
const pools = {};
Object.entries(ION_TYPES).forEach(([k, t]) => {
  const max = k === 'h' ? 90 : 40;
  const mat = new THREE.MeshStandardMaterial({ color: t.color, emissive: t.color, emissiveIntensity: t.emissive, roughness: 0.3 });
  const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(t.r, 2), mat, max); im.count = 0; im.frustumCulled = false; memG.add(im);
  if (k === 'atp') im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
  pools[k] = { im, max, items: [], label: null, t };
});
const APO = { y0: 3.3, y1: 9.5 }, CYT = { y0: -10, y1: -3.3 };
function newIon(type, side) {
  const P = pools[type]; if (P.items.length >= P.max) return null;
  const y = side === 'apo' ? APO.y0 + 0.6 + Math.random() * (APO.y1 - APO.y0 - 0.6) : CYT.y0 + Math.random() * (CYT.y1 - CYT.y0 - 0.6);
  const it = { p: new THREE.Vector3((Math.random() - 0.5) * PXH * 1.9, y, (Math.random() - 0.5) * PZH * 1.9), v: new THREE.Vector3(), side, s: 0, grow: 1, bound: null, life: 0, adp: false };
  P.items.push(it); return it;
}
const MEM_LABELS = [];
Object.entries(pools).forEach(([k, P]) => { const o = new THREE.Object3D(); memG.add(o); P.labelObj = o; P.label = stage.addLabel(o, P.t.label, { className: 'label3d nu-ion', offset: [0, 0.9, 0] }); MEM_LABELS.push(P.label); });
[['Apoplast · cell wall<small>pH ≈ 5.5</small>', [-PXH + 1, 12.8, -PZH]], ['Cytosol<small>pH ≈ 7.3 · inside negative</small>', [-PXH + 1, -9.5, -PZH]], ['Plasma membrane<small>lipid bilayer ≈ 5 nm</small>', [PXH, 2.6, PZH]]].forEach(([h, pos]) => { const l = stage.addLabel(new THREE.Vector3(...pos), h); memG.add(l); });
proteins.forEach(pr => { const l = stage.addLabel(new THREE.Vector3(0, pr.kind === 'atpase' ? -9.3 : 3.6, 0), pr.info.name, { className: 'label3d nu-prot' }); pr.g.add(l); pr.label = l; });
let memRates = { no3: 0, k: 0, p: 0, atp: 0 }, memCounts = { no3: 8, k: 8, p: 8, h: 40 };

/* ---------------------------------------------------------------- scale switching & flight */
const SCALES = {
  plant: { group: macro, bg: '#0b100e', fog: null, home: { pos: [0.5, 0.5, 0.9], target: [0, 0.2, 0] }, ctl: [0.08, 2.5], ao: 0.05, bar: 0.05, barLabel: '5 cm', title: 'Plant scale', sub: '1 : 1' },
  hairs: { group: hairsG, bg: '#15100c', fog: { color: 0x1a130e, density: 0.018 }, home: { pos: [-4, 11, 30], target: [-6, 0, 0] }, ctl: [4, 110], ao: 1.2, bar: 5, barLabel: '0.5 mm', title: 'Root-hair zone', sub: '≈ ×100' },
  membrane: { group: memG, bg: '#050913', fog: { color: 0x0a1226, density: 0.013 }, home: { pos: [20, 13, 28], target: [0, -0.5, 0] }, ctl: [5, 130], ao: 1.0, bar: 5, barLabel: '5 nm', title: 'Plasma membrane', sub: '≈ ×10⁶' }
};
let current = 'plant', busy = false;
function applyScale(name) {
  current = name; const S = SCALES[name];
  Object.values(SCALES).forEach(s => { s.group.visible = s === S; });
  scene.background = new THREE.Color(name === 'hairs' && ui.get('medium') === 'hydro' ? '#062a33' : S.bg);
  scene.fog = S.fog ? new THREE.FogExp2(name === 'hairs' && ui.get('medium') === 'hydro' ? 0x0a3642 : S.fog.color, S.fog.density) : null;
  controls.minDistance = S.ctl[0]; controls.maxDistance = S.ctl[1];
  stage.setHome(S.home.pos, S.home.target);
  if (stage.aoPass) stage.aoPass.updateGtaoMaterial({ radius: S.ao });
  hud.set('scale', `${S.title} <b>${S.sub}</b>`);
  ui.set('scale', name, true);
  refreshLegend();
  if (res) setTime(td);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fade(on, title = '', sub = '') { fader.querySelector('b').textContent = title; fader.querySelector('span').textContent = sub; fader.classList.toggle('on', on); await sleep(420); }
const ORDER = ['plant', 'hairs', 'membrane'];
let zoomPoint = null;
function focusFor(name) {
  if (name === 'plant') {
    const sys = ui.get('medium') === 'soil' ? soilRoots : hydroRoots;
    const tip = zoomPoint || sys.tips.filter(t => t.order === 1 && (ui.get('medium') !== 'soil' || t.pos.y > 0.06)).sort((a, b) => b.pos.z - a.pos.z)[3]?.pos || sys.tips[0].pos;
    return { pos: tip.clone().add(new THREE.Vector3(0.012, 0.006, 0.03)), target: tip.clone() };
  }
  if (name === 'hairs') return { pos: [-10, RR + 1.6, 4.5], target: [-10, RR, 0] };
  return null;
}
async function goScale(target) {
  if (busy || target === current) { ui.set('scale', current, true); return; }
  busy = true;
  try {
    while (current !== target) {
      const i = ORDER.indexOf(current), j = ORDER.indexOf(target); const next = ORDER[i + (j > i ? 1 : -1)];
      const S = SCALES[next];
      if (j > i) { const f = focusFor(current); await stage.flyTo(f.pos, f.target, 1.5); await fade(true, S.title, `zooming in ${S.sub}`); applyScale(next); const h = S.home; const far = new THREE.Vector3(...h.pos).sub(new THREE.Vector3(...h.target)).multiplyScalar(2.6).add(new THREE.Vector3(...h.target)); camera.position.copy(far); controls.target.set(...h.target); controls.update(); await fade(false); await stage.flyTo(h.pos, h.target, 1.6); }
      else { await fade(true, S.title, 'zooming out'); applyScale(next); const f = focusFor(next); camera.position.set(...(f.pos.toArray ? f.pos.toArray() : f.pos)); controls.target.set(...(f.target.toArray ? f.target.toArray() : f.target)); controls.update(); await fade(false); await stage.flyTo(S.home.pos, S.home.target, 1.5); }
    }
  } finally { busy = false; zoomPoint = null; }
}
async function tour() { if (current !== 'plant') await goScale('plant'); await sleep(300); await goScale('hairs'); await sleep(2500); await goScale('membrane'); }
stage.onPick({
  objects: () => current === 'plant' ? [ui.get('medium') === 'soil' ? soilRoots.mesh : hydroRoots.mesh] : current === 'hairs' ? [epidermis, ...(hairMesh ? [hairMesh] : [])] : proteins.map(p => p.g),
  onClick: hit => {
    if (!hit || busy) return;
    if (current === 'plant') { zoomPoint = hit.point.clone(); goScale('hairs'); }
    else if (current === 'hairs') goScale('membrane');
    else { let o = hit.object; while (o && o.userData.protein == null) o = o.parent; if (o) { const pr = proteins[o.userData.protein]; showProteinInfo(pr); } }
  }
});
function showProteinInfo(pr) { proteins.forEach(p => { p.label.element.classList.remove('lg'); p.label.element.innerHTML = p.info.name; }); pr.label.element.classList.add('lg'); pr.label.element.innerHTML = `${pr.info.name}<small>${pr.info.desc}</small>`; }

/* ================================================================ update */
let res = null, lastHairKey = '', lastMapT = 0;
function schedule() { cancelAnimationFrame(schedule.raf); schedule.raf = requestAnimationFrame(recompute); }
function recompute() {
  const p = ui.values();
  // show / hide controls that do not apply
  ['theta', 'b', 'lv', 'v0'].forEach(id => ui.enable(id, p.medium === 'soil')); ui.enable('delta', p.medium === 'hydro');
  ui.enable('lh', p.hairs); ui.enable('nh', p.hairs);
  tSlider.input.max = p.days; if (td > p.days) td = p.days;
  clock.speed = p.days / 12;
  res = runAll(p);
  hydroG.visible = p.medium === 'hydro'; soilG.visible = p.medium === 'soil';
  const hk = [p.hairs, p.lh, p.nh, p.medium].join('|');
  if (hk !== lastHairKey) {
    lastHairKey = hk;
    [hydroHair, soilHair].forEach(h => { if (h) { h.parent.remove(h); h.geometry.dispose(); } }); hydroHair = soilHair = null;
    if (p.hairs) { hydroHair = hairLines(hydroRoots.curves, p.lh, p.nh, 3); hydroG.add(hydroHair); soilHair = hairLines(soilRoots.curves, p.lh, p.nh, 4); soilG.add(soilHair); }
    buildHairScene(p);
  }
  if (current === 'hairs') applyScale('hairs');
  ionPts.material.color.setHex(IONS[p.ion].color);
  // static chart parts: MM curves and time series
  const xs = []; for (let i = 0; i <= 200; i++) xs.push(Math.pow(10, -1 + 5.477 * i / 200));
  ION_KEYS.forEach(k => { const s = ionState[k]; const Im = q10f(s.imax, p.q10, p.T, 20); mmPlot.line(k, xs, xs.map(c => mmJ(c, Im, s.km, s.cmin)), { color: IONS[k].css, width: k === p.ion ? 2.8 : 1.6, label: IONS[k].label + (k === p.ion ? ' (selected)' : ''), opacity: k === p.ion ? 1 : 0.65 }); });
  const soil = res[p.ion].soil, hyd = res[p.ion].hydro;
  cumPlot.line('soil', soil.t, soil.U, { color: '#a0672e', width: 2.6, label: 'Soil: cumulative', fill: 0.08 });
  cumPlot.line('hydro', hyd.t, hyd.U, { color: 'water', width: 2.4, dash: [7, 4], label: 'Solution: cumulative' });
  cumPlot.line('soilJ', soil.t, soil.J, { color: '#a0672e', width: 1.3, y2: true, label: 'Soil: influx', opacity: 0.7 });
  cumPlot.line('hydroJ', hyd.t, hyd.J, { color: 'water', width: 1.3, y2: true, dash: [2, 3], label: 'Solution: influx', opacity: 0.7 });
  cumPlot.setAxis('x', { min: 0, max: p.days });
  setTime(td);
}
function refreshLegend() {
  const p = ui.values();
  if (current === 'plant' && p.medium === 'soil') legend.innerHTML = `Depletion 1 − C/C<sub>b</sub> · ${IONS[p.ion].label}<div class="cbar" style="background:${DEP_GRADIENT}"></div><div class="cbar-ticks"><span>0</span><span>50 %</span><span>100 %</span></div>`;
  else if (current === 'hairs') legend.innerHTML = `C/C<sub>b</sub> of ${IONS[p.ion].label} (cross-section)<div class="cbar" style="background:${colormapGradient('viridis')}"></div><div class="cbar-ticks"><span>0</span><span>0.5</span><span>1</span></div>`;
  else if (current === 'membrane') legend.innerHTML = Object.entries(ION_TYPES).map(([k, t]) => `<span class="nu-key"><i style="background:#${new THREE.Color(t.color).getHexString()}"></i>${t.label}</span>`).join('');
  else legend.innerHTML = `Hydroponic solution: ${IONS[p.ion].label} supply is not diffusion-limited`;
}
function setTime(t, fromClock) {
  td = Math.max(0, Math.min(t, ui.get('days')));
  if (fromClock) ui.set('tday', td, true); else if (Math.abs(ui.get('tday') - td) > 1e-6) ui.set('tday', td, true);
  if (!res) return;
  const p = ui.values(); const I = IONS[p.ion];
  if (!res[p.ion] || !res[p.ion].soil || !res[p.ion][p.medium]) { recompute(); return; }   // results are stale for a newly chosen ion/medium
  const sim = res[p.ion][p.medium], soil = res[p.ion].soil, hyd = res[p.ion].hydro;
  const Jraw = at(sim, 'J', td), Cs = at(sim, 'Cs', td), U = at(sim, 'U', td), prof = profAt(sim, td), Cb = sim.K.Cb / UM;
  const Jh = hyd.J[0];
  const J = Jraw < 5e-4 ? 0 : Jraw;                     // below display resolution: no net uptake
  const exhausted = p.medium === 'soil' && J < 0.01 * Math.max(Jh, 1e-9);
  // readouts
  const rel = Cs / Cb;
  ro.set('J', J, J >= 0.5 * Jh ? 'ok' : J >= 0.15 * Jh ? 'warn' : 'bad', exhausted ? 'no net uptake: C at the root has fallen to C<sub>min</sub> — the soil between the roots is exhausted' : `${fmt(J / (Im20(p.ion)) * 100, 0)} % of bare-root I<sub>max</sub>`);
  ro.set('cs', Cs, rel > 0.5 ? 'ok' : rel > 0.1 ? 'warn' : 'bad', `${fmt(rel * 100, rel < 0.1 ? 1 : 0)} % of bulk (${fmtConc(Cb)})`);
  ro.set('supply', J / Math.max(1e-12, Jh) * 100, J / Jh > 0.7 ? 'ok' : J / Jh > 0.3 ? 'warn' : 'bad', p.medium === 'soil' ? (exhausted ? 'closed soil volume used up (no mineralisation or refill in the model)' : 'soil influx ÷ stirred-solution influx') : 'solution: supply not limiting');
  let dz = 0; for (let i = 0; i < 400; i++) { const d = (sim.R1 - R0) * i / 399; if (concAtR(sim, prof, Cs, R0 + d) >= 0.9 * Cb) { dz = d; break; } if (i === 399) dz = Infinity; }
  ro.set('dz', isFinite(dz) ? dz * 1e3 : (sim.R1 - R0) * 1e3, isFinite(dz) ? null : 'warn', isFinite(dz) ? `2√(D<sub>e</sub>t) = ${fmt(2 * Math.sqrt(sim.De * Math.max(td, 1e-6) * DAY) * 1e3, 2)} mm` : `whole soil between roots (r₁ = ${fmt(sim.R1 * 1e3, 1)} mm)`);
  ro.set('de', sim.De, null, p.medium === 'soil' ? `D<sub>e</sub> = D<sub>l</sub>θf/b (D<sub>l</sub> = ${sim.K.Dl.toExponential(2)})` : 'D<sub>l</sub> in water');
  ro.set('perm', J * PM * 2 * Math.PI * R0 * DAY * 1e6, null, `≈ ${fmt(J * 6022, 0)} ions µm⁻² s⁻¹`);
  ro.set('cum', U, null, `after ${fmt(td, 1)} d`);
  const mf = p.medium === 'soil' && !exhausted ? Math.min(100, p.v0 * 1e-2 * Cs * UM / Math.max(1e-30, J * PM) * 100) : NaN;
  ro.set('mf', p.medium === 'soil' && !exhausted ? mf : '—', null, p.medium === 'soil' ? (exhausted ? 'no net uptake to share' : `v₀C<sub>s</sub> vs influx`) : 'stirred solution');
  ro.set('reff', sim.a * 1e3, null, p.hairs ? (p.medium === 'soil' ? `hair cylinder, ×${fmt(sim.hg.cap * sim.a / R0, 2)} membrane area` : `hairs add ${fmt((sim.hg.cap - 1) * 100, 0)} % membrane area`) : 'no hairs: r₀ = 0.20 mm');
  hud.set('time', `Day <b>${fmt(td, 1)}</b> · ${I.label} · ${p.medium === 'soil' ? 'soil' : 'solution'}`);
  // profile chart
  const dmax = Math.min((sim.R1 - R0) * 1e3, p.ion === 'p' ? 3 : 20);
  const ds = []; for (let i = 0; i <= 240; i++) ds.push(dmax * i / 240);
  const prFn = (s, pr, cs) => ds.map(d => concAtR(s, pr, cs, R0 + d * 1e-3) / (s.K.Cb / UM));
  profPlot.line('soil', ds, prFn(soil, profAt(soil, td), at(soil, 'Cs', td)), { color: '#a0672e', width: 2.8, label: `Soil, day ${fmt(td, 1)}` });
  const t1 = td * 0.1, t2 = td * 0.4;
  profPlot.line('soil1', ds, prFn(soil, profAt(soil, t1), at(soil, 'Cs', t1)), { color: '#a0672e', width: 1.2, dash: [3, 3], label: `Soil, day ${fmt(t1, 1)}`, opacity: 0.55 });
  profPlot.line('soil2', ds, prFn(soil, profAt(soil, t2), at(soil, 'Cs', t2)), { color: '#a0672e', width: 1.4, dash: [6, 3], label: `Soil, day ${fmt(t2, 1)}`, opacity: 0.75 });
  profPlot.line('hydro', ds, prFn(hyd, hyd.prof[0], hyd.Cs[0]), { color: 'water', width: 2.4, label: 'Stirred solution' });
  if (p.hairs) profPlot.region('hz', 0, p.lh, { color: 'accent', alpha: 0.1, label: 'root-hair zone' }); else profPlot.remove('hz');
  profPlot.setAxis('x', { min: 0, max: dmax });
  // MM operating points
  ION_KEYS.forEach(k => { const s = res[k][p.medium]; if (!s) { mmPlot.remove('pt-' + k); return; } const cs = at(s, 'Cs', td); const Im = q10f(ionState[k].imax, p.q10, p.T, 20); mmPlot.point('pt-' + k, Math.max(0.1, cs), mmJ(cs, Im, ionState[k].km, ionState[k].cmin), { color: IONS[k].css, r: k === p.ion ? 6 : 4, label: k === p.ion ? 'Cₛ' : '' }); });
  { const Im = q10f(ionState[p.ion].imax, p.q10, p.T, 20); mmPlot.point('pt-bulk', Cb, mmJ(Cb, Im, ionState[p.ion].km, ionState[p.ion].cmin), { color: 'muted', r: 4, label: 'bulk' }); }
  cumPlot.vline('now', td, { color: 'magenta', label: `day ${fmt(td, 1)}` });
  // 3D: depletion map (throttled), hair-scene profile, membrane rates
  const now = performance.now();
  if (p.medium === 'soil' && (now - lastMapT > 120 || !fromClock)) { lastMapT = now; paintDepletionMap(soil, profAt(soil, td), at(soil, 'Cs', td)); }
  paintDisc(sim, prof, Cs);
  { // CDF for ion sampling (units: 0.1 mm)
    const rs = [], cs = [0]; let acc = 0; const n = 80; for (let i = 0; i <= n; i++) rs.push(RR + (DISC_RMAX - RR) * i / n);
    for (let i = 1; i <= n; i++) { const rm = (rs[i] + rs[i - 1]) / 2; acc += Math.max(0, concAtR(sim, prof, Cs, rm * 1e-4) / Cb) * rm; cs.push(acc); }
    ionCDF = { r: rs, c: cs.map(v => v / (acc || 1)) }; ionRin = sim.a * 1e4;
    ionAbsRate = 60 * Math.min(1.5, J / Im20(p.ion));
    if (!setTime.init) { setTime.init = true; ionSt.forEach(spawnIon); }
  }
  ION_KEYS.forEach(k => { const s = res[k][p.medium]; const cs = s ? at(s, 'Cs', td) : ionState[k].conc; const Im = q10f(ionState[k].imax, p.q10, p.T, 20); const Jm = mmJ(cs, Im, ionState[k].km, ionState[k].cmin); memRates[k] = Math.min(1.4, 0.06 * Jm); memCounts[k] = Math.max(2, Math.min(24, Math.round(3 + 4.5 * Math.log10(Math.max(cs, 0.1) / 0.1)))); });
  memRates.atp = 2 * memRates.no3 + 2 * memRates.p + memRates.k;
  if (current === 'membrane') hud.set('mem', `${I.label} influx ≈ <b>${fmt(mmJ(Cs, q10f(ionState[p.ion].imax, p.q10, p.T, 20), ionState[p.ion].km, ionState[p.ion].cmin) * 6022, 0)}</b> ions µm⁻² s⁻¹`); else hud.remove('mem');
  refreshLegend();
}
const Im20 = ion => q10f(ionState[ion].imax, ui.get('q10'), ui.get('T'), 20);

ui.onChange((s, id) => {
  if (id === 'scale') { goScale(s.scale); return; }
  if (id === 'tday') { clock.pause(); clock.reset(s.tday); setTime(s.tday); return; }
  if (applying) { schedule(); return; }
  if (id === 'ion') { const st = ionState[s.ion]; ['conc', 'imax', 'km', 'cmin', 'b'].forEach(k => ui.set(k, st[k], true)); curIon = s.ion; }
  else if (['conc', 'imax', 'km', 'cmin', 'b'].includes(id)) ionState[curIon][id] = s[id];
  if (id === 'days') { td = s.days; clock.reset(td); }
  if (id === 'medium' && current === 'hairs') setTimeout(() => applyScale('hairs'), 0);
  schedule();
});
applyScale('plant');
recompute();

/* ================================================================ animation */
const tmpV = new THREE.Vector3(), m4 = new THREE.Matrix4(), qI = new THREE.Quaternion(), sV = new THREE.Vector3();
let eventId = 0;
function memStep(dt, t) {
  // keep pools at the target counts (apoplast), plus a few cytosolic H⁺ and ATP
  const want = { no3: memCounts.no3, k: memCounts.k, p: memCounts.p, h: 34 };
  for (const k of ['no3', 'k', 'p', 'h']) { const free = pools[k].items.filter(i => i.side === 'apo' && !i.bound && i.grow >= 0); if (free.length < want[k]) newIon(k, 'apo'); else if (free.length > want[k] + 1) free[0].grow = -1; }
  if (pools.h.items.filter(i => i.side === 'cyt' && !i.bound).length < 3) newIon('h', 'cyt');
  if (pools.atp.items.filter(i => !i.bound && !i.adp).length < 6) newIon('atp', 'cyt');
  // transport events
  for (const pr of proteins) {
    const rate = pr.kind === 'atpase' ? memRates.atp / 2 : pr.kind === 'nrt' ? memRates.no3 : pr.kind === 'akt' ? memRates.k : memRates.p;
    if (!pr.busy) { pr.phase += rate * dt; if (pr.phase >= 1) { if (startEvent(pr)) pr.phase -= 1; else pr.phase = 1; } }
    else stepEvent(pr, dt);
    if (pr.parts.a) { const w = pr.busy && pr.busy.stage === 1 ? Math.sin(pr.busy.t / pr.busy.d * Math.PI) : 0; pr.parts.a.rotation.z = 0.16 * w; pr.parts.b.rotation.z = -0.16 * w; }
    if (pr.parts.N) pr.parts.N.rotation.z = pr.busy ? 0.25 * Math.sin(Math.min(1, pr.busy.t / 0.8) * Math.PI) : 0;
  }
  // free particle motion
  for (const [k, P] of Object.entries(pools)) {
    for (let i = P.items.length - 1; i >= 0; i--) {
      const it = P.items[i]; it.life += dt;
      it.s = Math.max(0, Math.min(1, it.s + it.grow * dt * 2));
      if (it.grow < 0 && it.s <= 0) { P.items.splice(i, 1); continue; }
      if (it.bound) continue;
      it.v.x += (Math.random() - 0.5) * dt * 6; it.v.y += (Math.random() - 0.5) * dt * 6; it.v.z += (Math.random() - 0.5) * dt * 6; it.v.multiplyScalar(Math.exp(-dt * 1.8));
      it.p.addScaledVector(it.v, dt);
      const B = it.side === 'apo' ? APO : CYT;
      if (it.p.y < B.y0 + 0.5) { it.p.y = B.y0 + 0.5; it.v.y = Math.abs(it.v.y); } if (it.p.y > B.y1) { it.p.y = B.y1; it.v.y = -Math.abs(it.v.y); }
      if (Math.abs(it.p.x) > PXH) { it.p.x = Math.sign(it.p.x) * PXH; it.v.x *= -1; } if (Math.abs(it.p.z) > PZH) { it.p.z = Math.sign(it.p.z) * PZH; it.v.z *= -1; }
      if (it.side === 'cyt' && it.life > 6 && k !== 'h' && k !== 'atp') it.grow = -1;          // imported ions diffuse away / are assimilated
      if (k === 'atp' && it.adp && it.life > 3) it.grow = -1;
      if (k === 'h' && it.side === 'cyt' && P.items.filter(x => x.side === 'cyt').length > 10 && it.life > 4) it.grow = -1;
    }
    const im = P.im; let n = 0;
    for (const it of P.items) { const sc = it.s * (it.small ? 0.5 : 1); sV.set(sc, sc, sc); m4.compose(it.p, qI, sV); im.setMatrixAt(n, m4); if (k === 'atp') { im.instanceColor.setXYZ(n, it.adp ? 1.0 : 1, it.adp ? 0.55 : 1, it.adp ? 0.35 : 1); } n++; }
    im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    const show = P.items.find(it => !it.bound && it.s > 0.9 && it.side === (k === 'atp' ? 'cyt' : 'apo'));
    if (show) { P.labelObj.position.copy(show.p); P.label.visible = true; } else P.label.visible = false;
  }
}
function takeFree(type, side, near) { const c = pools[type].items.filter(i => i.side === side && !i.bound && i.s > 0.8 && i.grow >= 0 && !i.adp); if (!c.length) return null; c.sort((a, b) => a.p.distanceToSquared(near) - b.p.distanceToSquared(near)); return c[0]; }
function startEvent(pr) {
  const top = new THREE.Vector3(pr.x, 3.4, pr.z), bot = new THREE.Vector3(pr.x, -3.6, pr.z);
  const cargo = [];
  if (pr.kind === 'atpase') {
    const h = takeFree('h', 'cyt', bot) || newIon('h', 'cyt'); const atp = takeFree('atp', 'cyt', bot); if (!h || !atp) return false;
    if (h.s === 0) h.s = 1;
    cargo.push({ it: h, from: h.p.clone(), a: bot.clone(), b: top.clone().add(new THREE.Vector3(0, 0.8, 0)), side: 'apo' });
    cargo.push({ it: atp, from: atp.p.clone(), a: new THREE.Vector3(pr.x + 2.6, -7.2, pr.z + 1.1), b: new THREE.Vector3(pr.x + 3.6, -8.5, pr.z + 1.6), side: 'cyt', atp: true });
  } else {
    const ion = pr.kind === 'nrt' ? 'no3' : pr.kind === 'akt' ? 'k' : 'p';
    const main = takeFree(ion, 'apo', top); if (!main) return false;
    cargo.push({ it: main, from: main.p.clone(), a: top.clone(), b: bot.clone(), side: 'cyt' });
    if (pr.kind !== 'akt') for (let j = 0; j < 2; j++) { const h = takeFree('h', 'apo', top); if (h) cargo.push({ it: h, from: h.p.clone(), a: top.clone().add(new THREE.Vector3(j ? 0.7 : -0.7, 0.3, 0.2)), b: bot.clone().add(new THREE.Vector3(j ? 0.5 : -0.5, -0.4, 0)), side: 'cyt' }); }
  }
  cargo.forEach(c => { c.it.bound = pr; });
  pr.busy = { stage: 0, t: 0, d: 0.9, cargo, id: ++eventId };
  return true;
}
function stepEvent(pr, dt) {
  const e = pr.busy; e.t += dt; const k = Math.min(1, e.t / e.d); const s = k * k * (3 - 2 * k);
  for (const c of e.cargo) {
    if (e.stage === 0) c.it.p.lerpVectors(c.from, c.a, s);
    else if (e.stage === 1) { c.it.p.lerpVectors(c.a, c.b, s); if (c.atp && k > 0.5) c.it.adp = true; }
  }
  if (k >= 1) {
    if (e.stage === 0) { e.stage = 1; e.t = 0; e.d = pr.kind === 'akt' ? 0.5 : 1.0; }
    else { e.cargo.forEach(c => { c.it.bound = null; c.it.side = c.side; c.it.life = 0; c.it.v.set((Math.random() - 0.5) * 1.5, c.side === 'cyt' ? -2.2 : 2.2, (Math.random() - 0.5) * 1.5); if (c.atp) { c.it.adp = true; const pi = newIon('p', 'cyt'); if (pi) { pi.p.copy(c.it.p); pi.small = true; pi.s = 1; pi.v.set(1, -1, 0.5); } } }); pr.busy = null; }
  }
}
function hairStep(dt, t) {
  const pos = ionPos; let absorbing = ionAbsRate * dt; const rin = Math.max(RR, ionRin);
  for (let i = 0; i < NION; i++) {
    const s = ionSt[i];
    if (s.m === 1) { s.t += dt; s.r -= dt * (s.r - RR + 1.2) * 2.2; if (s.r < RR - 0.6) spawnIon(s); }
    else {
      s.x += (Math.random() - 0.5) * dt * 3; s.th += (Math.random() - 0.5) * dt * 0.6 / Math.max(1, s.r * 0.3); s.r += (Math.random() - 0.5) * dt * 1.6;
      if (s.r < RR + 0.25) s.r = RR + 0.25; if (s.r > DISC_RMAX) s.r = DISC_RMAX;
      if (absorbing > 0 && s.r < rin + 1.2 && Math.random() < 0.08) { s.m = 1; absorbing -= 1; }
      if (s.x > XT + 4 || s.x < X0) s.x = X0 + Math.random() * (XT + 4 - X0);
    }
    pos[i * 3] = s.x; pos[i * 3 + 1] = s.r * Math.cos(s.th); pos[i * 3 + 2] = s.r * Math.sin(s.th);
  }
  if (absorbing > 1) { for (let i = 0; i < NION && absorbing > 1; i++) { const s = ionSt[(i * 37 + Math.floor(t * 100)) % NION]; if (s.m === 0 && s.r < rin + 4) { s.m = 1; absorbing--; } } }
  ionGeo.attributes.position.needsUpdate = true;
  if (streaks) { const a = streaks.geometry.attributes.position; for (let i = 0; i < a.count; i++) { let x = a.getX(i) - dt * 5; if (x < X0) x = XT + 8; a.setX(i, x); } a.needsUpdate = true; }
  // occasional respawn to keep the density close to the model profile
  for (let k = 0; k < 6; k++) { const s = ionSt[Math.floor(Math.random() * NION)]; if (s.m === 0) spawnIon(s); }
}
stage.onFrame((dt, t) => {
  if (current === 'plant') { if (hydroG.visible) { bubbles.update(dt); tank.update(t); flow.update(dt); } }
  else if (current === 'hairs') hairStep(dt, t);
  else memStep(Math.min(dt, 0.05), t);
  // scale bar
  const S = SCALES[current]; const dist = camera.position.distanceTo(controls.target);
  const px = S.bar / (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * stage.el.clientHeight;
  scaleBar.querySelector('i').style.width = Math.max(8, Math.min(260, px)) + 'px'; scaleBar.querySelector('span').textContent = S.barLabel;
});
