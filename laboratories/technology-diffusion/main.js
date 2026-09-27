/* Technology diffusion model — Bass (1969), generalised Bass (Bass, Krishnan & Jain 1994), Rogers categories,
   regulatory delay with cross-market spillover, nonlinear least-squares fitting (fitLM) and scenario comparison.
   Equations D1–D8 in the Derive tab; consistent with Eqs. 14.4.4–14.4.6 of /lessons/innovation-pathways/. */
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, downloadCSV } from '/assets/js/plot.js';
import { palette, withAlpha } from '/assets/js/colors.js';
import { fitLM, parseTable, mulberry32 } from '/assets/js/stats.js';

const $ = s => document.querySelector(s);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ============================================================ Bass model (closed forms, Eqs. D2–D5) */
export const Fb = (t, p, q) => t <= 0 ? 0 : (1 - Math.exp(-(p + q) * t)) / (1 + (q / p) * Math.exp(-(p + q) * t));
const tShare = (s, p, q) => Math.log((1 + (q / p) * s) / (1 - s)) / (p + q);
const tPeak = (p, q) => q > p ? Math.log(q / p) / (p + q) : 0;
const innShare = (p, q) => q > 1e-9 ? (p / q) * Math.log(1 + q / p) : 1;
const Icum = (T, p, q) => T <= 0 ? 0 : q > 1e-9 ? T - (1 / q) * Math.log((1 + q / p) / (1 + (q / p) * Math.exp(-(p + q) * T))) : T - (1 - Math.exp(-p * T)) / p;

/* generalised Bass: effective time X(t) = t + |βP|·g·min(t, t_parity) + βA·a·min(t, tA)  (Eq. D6) */
function X(t, P) {
  if (t <= 0) return 0;
  if (!P.gbm) return t;
  const tpar = P.g > 0 && P.P0 > 1 ? Math.log(P.P0) / (P.g / 100) : 0;
  return t + (-P.betaP) * (P.g / 100) * Math.min(t, tpar) + P.adv * Math.min(t, P.tA);
}
const xRate = (t, P) => { if (!P.gbm || t < 0) return 1; const tpar = P.g > 0 && P.P0 > 1 ? Math.log(P.P0) / (P.g / 100) : 0; return 1 + (t < tpar ? (-P.betaP) * (P.g / 100) : 0) + (t < P.tA ? P.adv : 0); };
const priceAt = (t, P) => { if (t <= 0) return P.P0; return Math.max(1, P.P0 * Math.exp(-(P.g / 100) * t)); };

/** Numerical solution on a grid (RK4): first market launched at t0, EU at t0 + d with cross-market spillover σ (Eq. D7). */
function simulateCurves(P, years) {
  const dt = 0.02, n = Math.round(years / dt) + 1, p = P.p, q = P.q;
  const t = new Float64Array(n), F1 = new Float64Array(n), F2 = new Float64Array(n), f1 = new Float64Array(n), inn1 = new Float64Array(n), f2 = new Float64Array(n);
  for (let i = 0; i < n; i++) { t[i] = i * dt - 1; F1[i] = Fb(X(t[i], P), p, q); }
  for (let i = 0; i < n; i++) { const x = xRate(t[i], P); f1[i] = t[i] < 0 ? 0 : (p + q * F1[i]) * (1 - F1[i]) * x; inn1[i] = t[i] < 0 ? 0 : p * (1 - F1[i]) * x; }
  // EU market: dF2/dt = (p + q F2 + σ q F1(t)) (1 − F2) · x(t − d), from t = d
  let F = 0; const d = P.delay, s = P.spill;
  const rhs = (tt, FF) => { const i = Math.min(n - 1, Math.max(0, Math.round((tt + 1) / dt))); const tl = tt - d; if (tl < 0) return 0; return (p + q * FF + s * q * F1[i]) * (1 - FF) * xRate(tl, P); };
  for (let i = 0; i < n; i++) {
    if (t[i] < d) { F2[i] = 0; f2[i] = 0; continue; }
    F2[i] = F; f2[i] = rhs(t[i], F);
    const k1 = rhs(t[i], F), k2 = rhs(t[i] + dt / 2, F + dt / 2 * k1), k3 = rhs(t[i] + dt / 2, F + dt / 2 * k2), k4 = rhs(t[i] + dt, F + dt * k3);
    F = Math.min(1, F + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4));
  }
  return { t, F1, F2, f1, f2, inn1, dt, n };
}
const crossing = (t, F, s) => { for (let i = 1; i < F.length; i++) if (F[i] >= s) { const a = F[i - 1], b = F[i]; return t[i - 1] + (s - a) / (b - a || 1) * (t[i] - t[i - 1]); } return NaN; };

/* ============================================================ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'peak', label: 'Peak adoption', unit: '', format: v => v })
  .add({ id: 'rate', label: 'Peak adoption rate', unit: '% of market a⁻¹', digits: 2 })
  .add({ id: 't16', label: '16 % of m reached (the "chasm")', format: v => v })
  .add({ id: 't50', label: '50 % of m reached', format: v => v })
  .add({ id: 'inn', label: 'Adopters via external influence', unit: '%', digits: 0 })
  .add({ id: 'f10', label: 'Adopted 10 years after launch', unit: '% of market', digits: 1 })
  .add({ id: 'delay', label: 'Lost to the regulatory delay by 2040', format: v => v })
  .add({ id: 'gbm', label: 'Marketing mix: time to 50 % of m', format: v => v });

ui.section('Bass model — Eq. D1');
ui.slider({ id: 'p', label: 'Coefficient of innovation p', min: 0.001, max: 0.3, log: true, value: 0.03, unit: 'a⁻¹', format: v => v.toFixed(3), help: 'External influence: media, marketing, a regulator\'s approval. Meta-analysis mean ≈ 0.03 a⁻¹.' });
ui.slider({ id: 'q', label: 'Coefficient of imitation q', min: 0, max: 1.2, step: 0.01, value: 0.38, unit: 'a⁻¹', help: 'Internal influence: word of mouth, visibility. Meta-analysis mean ≈ 0.38 a⁻¹.' });
ui.slider({ id: 'm', label: 'Market potential m', min: 1, max: 100, step: 1, value: 50, unit: '% of market', help: 'Share of the relevant market that will eventually adopt.' });
ui.slider({ id: 't0', label: 'Launch year (first market)', min: 1990, max: 2035, step: 1, value: 2026, format: v => String(Math.round(v)) });
ui.section('Marketing mix — generalised Bass, Eq. D6');
ui.toggle({ id: 'gbm', label: 'Include price and advertising effects', value: false });
ui.slider({ id: 'P0', label: 'Price at launch (× incumbent)', min: 1, max: 12, step: 0.1, value: 3, unit: '×' });
ui.slider({ id: 'g', label: 'Price decline until parity', min: 0, max: 30, step: 0.5, value: 8, unit: '% a⁻¹' });
ui.slider({ id: 'betaP', label: 'Price coefficient β<sub>P</sub>', min: -3, max: 0, step: 0.05, value: -1.5, unit: 'a', help: 'x(t) = 1 + β<sub>P</sub>·(dP/dt)/P: falling prices speed up adoption when β<sub>P</sub> &lt; 0.' });
ui.slider({ id: 'adv', label: 'Advertising push β<sub>A</sub>·(dA/dt)/A', min: 0, max: 0.6, step: 0.01, value: 0.15, help: 'Extra hazard factor while advertising spending grows.' });
ui.slider({ id: 'tA', label: 'Campaign duration', min: 0, max: 10, step: 0.5, value: 3, unit: 'a' });
ui.section('Regulation — Eq. D7');
ui.slider({ id: 'delay', label: 'Regulatory delay in the EU', min: 0, max: 10, step: 0.1, value: 3.3, unit: 'a', help: 'Launch in the EU d years after the first market (average EU novel-food procedure ≈ 3.3 a).' });
ui.slider({ id: 'spill', label: 'Cross-market spillover σ', min: 0, max: 0.6, step: 0.01, value: 0, help: 'Word of mouth from the first market also acts on EU non-adopters: hazard p + q(F_EU + σF_first).' });
ui.section('Display');
ui.slider({ id: 'hz', label: 'Years shown', min: 15, max: 60, step: 1, value: 30, unit: 'a' });
ui.toggle({ id: 'cats', label: "Shade Rogers' adopter categories", value: true });
ui.slider({ id: 'speed', label: 'Animation speed', min: 0.5, max: 12, step: 0.5, value: 4, unit: 'a s⁻¹', persist: false });
const [btnPlay] = ui.buttons([{ label: 'Pause', variant: 'primary', onClick: () => togglePlay() }, { label: 'Replay', onClick: () => { cursor = -1; clock.play(); } }]);
const SCEN = {
  vf: { name: 'Vertical farming', market: 'EU leafy greens and herbs', p: 0.005, q: 0.25, m: 10, t0: 2015, delay: 0, gbm: true, P0: 1.6, g: 3, betaP: -1.5, adv: 0, tA: 0, color: 'c0' },
  pf: { name: 'Precision-fermented dairy protein', market: 'EU dairy-protein ingredients', p: 0.01, q: 0.40, m: 15, t0: 2023, delay: 4, gbm: true, P0: 3, g: 10, betaP: -1.5, adv: 0.1, tA: 3, color: 'c1' },
  cm: { name: 'Cultivated meat', market: 'EU meat', p: 0.003, q: 0.30, m: 5, t0: 2020, delay: 7, gbm: true, P0: 10, g: 15, betaP: -1.5, adv: 0.1, tA: 3, color: 'c2' }
};
const scenValues = k => { const s = SCEN[k]; return { p: s.p, q: s.q, m: s.m, t0: s.t0, delay: s.delay, gbm: s.gbm, P0: s.P0, g: s.g, betaP: s.betaP, adv: s.adv, tA: s.tA, spill: 0 }; };
ui.presets([
  { label: 'Typical product (meta-analysis)', values: { p: 0.03, q: 0.38, m: 50, t0: 2026, gbm: false, delay: 3.3, spill: 0 } },
  { label: 'Word of mouth', values: { p: 0.005, q: 0.6, m: 50, t0: 2026, gbm: false, delay: 3.3, spill: 0 } },
  { label: 'Advertising-driven', values: { p: 0.08, q: 0.1, m: 50, t0: 2026, gbm: false, delay: 3.3, spill: 0 } },
  { label: 'GE maize, USA (fitted)', values: { p: 0.029, q: 0.30, m: 94, t0: 1996, gbm: false, delay: 0, spill: 0 } },
  { label: 'Vertical farming', values: scenValues('vf') },
  { label: 'Precision fermentation', values: scenValues('pf') },
  { label: 'Cultivated meat', values: scenValues('cm') }
]);
ui.saveButton('technology-diffusion', () => ro.values());

/* ============================================================ stage: adoption theatre */
const stageEl = $('#stage');
const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Animated Bass diffusion curve with Rogers adopter categories and a population of 400 potential adopters'); stageEl.appendChild(cv);
const hud = hudChips(stageEl);
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l11-7z"/></svg>';
stageToolbar(stageEl, { extra: [{ icon: ICON_PLAY, title: 'Play / pause', onClick: () => togglePlay() }], onReset: () => { cursor = -1; clock.play(); }, onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'bass-diffusion.png'; a.click(); } });
const SC = { bg: '#0d1512', grid: 'rgba(255,255,255,0.07)', axis: 'rgba(255,255,255,0.22)', text: '#e6eee9', muted: '#8fa39a', cum: '#f07ad0', ghost: 'rgba(230,238,233,0.55)', inn: 'rgba(255,255,255,0.55)' };
const CAT = [
  { name: 'Innovators', share: 0.025, color: '#ff8f6b' },
  { name: 'Early adopters', share: 0.135, color: '#f2b94b' },
  { name: 'Early majority', share: 0.34, color: '#6fd39a' },
  { name: 'Late majority', share: 0.34, color: '#5cc8ef' },
  { name: 'Laggards', share: 0.16, color: '#a792f0' }
];
const BOUNDS = [0.025, 0.16, 0.5, 0.84];
const catOf = u => u < 0.025 ? 0 : u < 0.16 ? 1 : u < 0.5 ? 2 : u < 0.84 ? 3 : 4;

/* 400 agents = the market potential; agent i adopts when F reaches its quantile u_i (Eq. D4) */
const NA = 400, rngA = mulberry32(7);
const order = Array.from({ length: NA }, (_, i) => i); for (let i = NA - 1; i > 0; i--) { const j = Math.floor(rngA() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
const agents = order.map((cell, rank) => ({ cell, u: (rank + 0.5) / NA, cat: catOf((rank + 0.5) / NA), r: rngA(), rj: rngA() }));
let S = null, cursor = -1;
const clock = new SimClock({ speed: 4, onStep: dt => { if (!S) return; cursor = Math.min(S.hz, cursor + dt); }, onFrame: () => { drawStage(); if (S && cursor >= S.hz) clock.pause(); } });
clock.onState(r => { btnPlay.textContent = r ? 'Pause' : 'Play'; });
function togglePlay() { if (S && cursor >= S.hz) cursor = -1; clock.toggle(); if (!clock.running) drawStage(); }

function prepare() {
  const v = ui.values();
  const P = { p: v.p, q: v.q, gbm: v.gbm, P0: v.P0, g: v.g, betaP: v.betaP, adv: v.adv, tA: v.tA, delay: v.delay, spill: v.spill };
  const C = simulateCurves(P, v.hz + 1.5);
  const tb = BOUNDS.map(s => crossing(C.t, C.F1, s));
  // agent adoption times, causes (innovation vs imitation) and influencers
  agents.forEach(a => {
    a.t = crossing(C.t, C.F1, a.u);
    const i = Number.isFinite(a.t) ? Math.min(C.n - 1, Math.max(0, Math.round((a.t + 1) / C.dt))) : 0;
    const hz = P.p + P.q * C.F1[i];
    a.inn = a.r < P.p / (hz || 1);
  });
  const adoptedSorted = agents.filter(a => Number.isFinite(a.t)).sort((a, b) => a.t - b.t);
  adoptedSorted.forEach((a, k) => { a.from = !a.inn && k > 0 ? adoptedSorted[Math.floor(a.rj * k)] : null; });
  S = { v, P, C, tb, hz: v.hz, m: v.m, t0: v.t0 };
}

function drawStage() {
  if (!S) return;
  const W = stageEl.clientWidth, H = stageEl.clientHeight; if (!W || !H) return;
  const d = Math.min(devicePixelRatio || 1, 2.5);
  if (cv.width !== Math.round(W * d) || cv.height !== Math.round(H * d)) { cv.width = Math.round(W * d); cv.height = Math.round(H * d); }
  const ctx = cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.fillStyle = SC.bg; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.3, H * 0.9, 10, W * 0.3, H * 0.9, W * 0.7); glow.addColorStop(0, 'rgba(111,211,154,0.07)'); glow.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  const { C, m, t0, hz, v } = S;
  const narrow = W < 720;
  const chartR = narrow ? W : W * 0.64;
  const L = 56, R = 54, T = narrow && W < 640 ? 76 : 104, B = 46;
  const PW = chartR - L - R, PH = H - T - B;
  const tmin = -1, tmax = hz;
  const Xp = t => L + (t - tmin) / (tmax - tmin) * PW;
  // scales: left = adoption rate (% of market per year), right = cumulative (% of market)
  let fmax = 0; for (let i = 0; i < C.n; i++) { if (C.t[i] > tmax) break; fmax = Math.max(fmax, C.f1[i], C.f2[i]); }
  const stepL = niceStep(Math.max(0.05, m * fmax * 1.1) / 4), stepR = niceStep(m * 1.02 / 4);
  const yL = stepL * Math.ceil(m * fmax * 1.1 / stepL - 1e-9), yR = stepR * Math.ceil(m * 1.02 / stepR - 1e-9);
  const nL = Math.round(yL / stepL), nR = Math.round(yR / stepR);
  const YL = y => T + PH * (1 - y / yL), YR = y => T + PH * (1 - y / yR);
  // grid and axes
  ctx.lineWidth = 1; ctx.font = "500 10.5px 'JetBrains Mono', monospace";
  const yearStep = hz > 40 ? 10 : 5;
  for (let yr = Math.ceil((t0 + tmin) / yearStep) * yearStep; yr <= t0 + tmax; yr += yearStep) { const x = Math.round(Xp(yr - t0)) + 0.5; ctx.strokeStyle = SC.grid; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + PH); ctx.stroke(); ctx.fillStyle = SC.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(String(yr), x, T + PH + 6); }
  for (let k = 0; k <= nL; k++) { const val = k * stepL, y = Math.round(YL(val)) + 0.5; ctx.strokeStyle = SC.grid; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + PW, y); ctx.stroke(); ctx.fillStyle = SC.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(fmtAx(val, stepL), L - 6, y); }
  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(240,122,208,0.85)';
  for (let k = 0; k <= nR; k++) { const val = k * stepR; ctx.fillText(fmtAx(val, stepR), L + PW + 6, YR(val)); }
  ctx.fillStyle = SC.text; ctx.font = '600 11.5px Inter, sans-serif';
  ctx.save(); ctx.translate(14, T + PH / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('New adopters (% of market per year)', 0, 0); ctx.restore();
  ctx.save(); ctx.translate(chartR - 12, T + PH / 2); ctx.rotate(Math.PI / 2); ctx.textAlign = 'center'; ctx.fillStyle = '#f07ad0'; ctx.fillText('Cumulative adoption (% of market)', 0, 0); ctx.restore();
  const cur = cursor;
  // categories: filled areas under f (revealed up to the cursor)
  const bnd = [0, ...S.tb.map(x => Number.isFinite(x) ? x : Infinity), Infinity];
  const clipEnd = Math.min(cur, tmax);
  for (let k = 0; k < 5; k++) {
    const a = Math.max(0, bnd[k]), b = Math.min(bnd[k + 1], clipEnd); if (!(b > a)) continue;
    ctx.beginPath(); ctx.moveTo(Xp(a), YL(0));
    for (let i = 0; i < C.n; i++) { const tt = C.t[i]; if (tt < a) continue; if (tt > b) break; ctx.lineTo(Xp(tt), YL(m * C.f1[i])); }
    const ib = Math.min(C.n - 1, Math.round((b + 1) / C.dt)); ctx.lineTo(Xp(b), YL(m * C.f1[ib])); ctx.lineTo(Xp(b), YL(0)); ctx.closePath();
    ctx.fillStyle = v.cats ? withAlpha(CAT[k].color, 0.62) : 'rgba(111,211,154,0.55)'; ctx.fill();
  }
  // innovation part p(1-F)x (hatched)
  if (clipEnd > 0) {
    ctx.save(); ctx.beginPath(); ctx.moveTo(Xp(0), YL(0)); for (let i = 0; i < C.n; i++) { const tt = C.t[i]; if (tt < 0) continue; if (tt > clipEnd) break; ctx.lineTo(Xp(tt), YL(m * C.inn1[i])); } ctx.lineTo(Xp(clipEnd), YL(0)); ctx.closePath(); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1; ctx.beginPath(); for (let x = L - PH; x < L + PW; x += 7) { ctx.moveTo(x, T + PH); ctx.lineTo(x + PH, T); } ctx.stroke(); ctx.restore();
  }
  // future (dashed outline) of the rate curve
  ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(230,238,233,0.35)'; ctx.lineWidth = 1.2; ctx.beginPath(); let started = false;
  for (let i = 0; i < C.n; i++) { const tt = C.t[i]; if (tt > tmax) break; if (tt < Math.max(clipEnd, tmin)) continue; const x = Xp(tt), y = YL(m * C.f1[i]); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
  ctx.stroke(); ctx.setLineDash([]);
  // EU (delayed) curves
  if (v.delay > 0) {
    ctx.strokeStyle = 'rgba(92,200,239,0.9)'; ctx.lineWidth = 1.6; ctx.setLineDash([6, 4]); ctx.beginPath(); started = false;
    for (let i = 0; i < C.n; i++) { const tt = C.t[i]; if (tt > Math.min(tmax, cur)) break; const x = Xp(tt), y = YR(m * C.F2[i]); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  // cumulative S-curve
  ctx.strokeStyle = SC.cum; ctx.lineWidth = 2.6; ctx.beginPath(); started = false;
  for (let i = 0; i < C.n; i++) { const tt = C.t[i]; if (tt > Math.min(tmax, cur)) break; const x = Xp(tt), y = YR(m * C.F1[i]); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(240,122,208,0.35)'; ctx.lineWidth = 1.4; ctx.setLineDash([3, 4]); ctx.beginPath(); started = false;
  for (let i = 0; i < C.n; i++) { const tt = C.t[i]; if (tt > tmax) break; if (tt < cur) continue; const x = Xp(tt), y = YR(m * C.F1[i]); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
  ctx.stroke(); ctx.setLineDash([]);
  // markers: chasm, 50 %, peak
  const mk = (t, lab, col, row) => { if (!Number.isFinite(t) || t > tmax) return; const x = Xp(t); const ly = T + 12 + row * 13; ctx.strokeStyle = col; ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, ly + 2); ctx.lineTo(x, T + PH); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = col; ctx.font = '600 10.5px Inter, sans-serif'; ctx.textAlign = row === 1 ? 'left' : 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(lab, x + (row === 1 ? 4 : -4), ly); };
  const tp = crossing(C.t, C.F1, 0.16), t5 = crossing(C.t, C.F1, 0.5);
  let ipk = 0; for (let i = 1; i < C.n; i++) if (C.f1[i] > C.f1[ipk]) ipk = i;
  mk(tp, 'chasm 16 %', 'rgba(242,185,75,0.95)', 0); mk(C.t[ipk], 'peak', 'rgba(230,238,233,0.85)', 1); mk(t5, '50 % of m', 'rgba(240,122,208,0.95)', 2);
  if (v.delay > 0 && v.delay < tmax) {
    const x = Xp(v.delay), lab = `EU launch +${fmt(v.delay, 1)} a`; ctx.font = '600 10.5px Inter, sans-serif'; const tw = ctx.measureText(lab).width;
    ctx.strokeStyle = 'rgba(92,200,239,0.7)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, T + 64); ctx.lineTo(x, T + PH); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(10,16,14,0.85)'; rr(ctx, x + 3, T + 50, tw + 12, 17, 6); ctx.fill(); ctx.strokeStyle = 'rgba(92,200,239,0.6)'; ctx.stroke(); ctx.fillStyle = 'rgba(92,200,239,1)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(lab, x + 9, T + 58.5);
  }
  // cursor
  if (cur >= tmin && cur <= tmax) { const x = Xp(cur); ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + PH); ctx.stroke(); const lab = String(Math.floor(t0 + cur)); ctx.font = "600 10.5px 'JetBrains Mono', monospace"; const tw = ctx.measureText(lab).width; ctx.fillStyle = '#e6eee9'; rr(ctx, x - tw / 2 - 6, T + PH + 2, tw + 12, 16, 5); ctx.fill(); ctx.fillStyle = '#0d1512'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(lab, x, T + PH + 10); }
  // legend (chart)
  ctx.font = '600 10.5px Inter, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  let lx = L + 2; const ly = T - 12;
  const leg = [['magenta', 'Cumulative (first market)'], ...(v.delay > 0 ? [['eu', 'Cumulative (EU, delayed)']] : []), ['hatch', 'via external influence p']];
  leg.forEach(([k, lab]) => { if (k === 'magenta') { ctx.strokeStyle = SC.cum; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 16, ly); ctx.stroke(); } else if (k === 'eu') { ctx.strokeStyle = 'rgba(92,200,239,0.9)'; ctx.setLineDash([5, 3]); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 16, ly); ctx.stroke(); ctx.setLineDash([]); } else { ctx.fillStyle = 'rgba(111,211,154,0.55)'; ctx.fillRect(lx, ly - 5, 16, 10); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); for (let z = 0; z < 16; z += 4) { ctx.moveTo(lx + z, ly + 5); ctx.lineTo(lx + z + 6, ly - 5); } ctx.stroke(); } ctx.fillStyle = SC.muted; ctx.fillText(lab, lx + 20, ly); lx += ctx.measureText(lab).width + 36; });
  // agent grid
  const Fnow = cur <= 0 ? 0 : C.F1[Math.min(C.n - 1, Math.round((cur + 1) / C.dt))];
  if (!narrow) {
    const gx0 = chartR + 14, gw = W - gx0 - 16, gy0 = T + 6, gh = PH - 70;
    const cell = Math.min(gw / 20, gh / 20), r = cell * 0.34, ox = gx0 + (gw - cell * 20) / 2, oy = gy0;
    ctx.fillStyle = SC.muted; ctx.font = '600 10.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`Market potential m = ${fmt(m, 0)} % of the market · 400 agents`, ox + cell * 10, oy - 6);
    const pos = a => [ox + (a.cell % 20 + 0.5) * cell, oy + (Math.floor(a.cell / 20) + 0.5) * cell];
    // links for recent imitators
    agents.forEach(a => { if (!(a.t <= cur) || !a.from) return; const age = cur - a.t; if (age > 0.9) return; const [x1, y1] = pos(a), [x0, y0] = pos(a.from); ctx.strokeStyle = `rgba(230,238,233,${0.55 * (1 - age / 0.9)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2 + (y1 - y0) * 0.2, (y0 + y1) / 2 - (x1 - x0) * 0.2, x1, y1); ctx.stroke(); });
    const counts = [0, 0, 0, 0, 0], viaInn = [0, 0];
    agents.forEach(a => {
      const [x, y] = pos(a); const on = a.t <= cur;
      if (on) { counts[a.cat]++; viaInn[a.inn ? 0 : 1]++; const age = cur - a.t; ctx.fillStyle = CAT[a.cat].color; ctx.beginPath(); ctx.arc(x, y, r * (age < 0.3 ? 1 + 0.6 * (1 - age / 0.3) : 1), 0, Math.PI * 2); ctx.fill(); if (a.inn && age < 0.6) { ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - age / 0.6)})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, r * (1.4 + 2.4 * age / 0.6), 0, Math.PI * 2); ctx.stroke(); } }
      else { ctx.strokeStyle = 'rgba(230,238,233,0.2)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); ctx.stroke(); }
    });
    // category legend with counts
    const ly0 = oy + cell * 20 + 12;
    ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const tot = [10, 54, 136, 136, 64];
    CAT.forEach((c, k) => { const col = k % 2, row = Math.floor(k / 2); const x = ox + col * cell * 10, y = ly0 + row * 14; ctx.fillStyle = c.color; ctx.beginPath(); ctx.arc(x + 4, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = SC.muted; ctx.fillText(`${c.name} ${counts[k]}/${tot[k]}`, x + 12, y); });
    const nAd = viaInn[0] + viaInn[1];
    ctx.fillStyle = SC.text; ctx.font = '600 10.5px Inter, sans-serif'; ctx.fillText(nAd ? `Adopted via media ${Math.round(100 * viaInn[0] / nAd)} % · word of mouth ${Math.round(100 * viaInn[1] / nAd)} %` : 'No adopters yet', ox, ly0 + 3 * 14 + 4);
    ctx.fillStyle = SC.muted; ctx.font = '500 10px Inter, sans-serif';
    ctx.fillText('Each circle = 0.25 % of m. Ripple: external influence (p);', ox, ly0 + 4 * 14 + 8); ctx.fillText('line from an earlier adopter: imitation (q).', ox, ly0 + 5 * 14 + 8);
  }
  // HUD
  const yr = t0 + Math.max(0, cur);
  hud.set('yr', `Year <b>${yr.toFixed(1)}</b> · ${cur < 0 ? 'before launch' : fmt(cur, 1) + ' a after launch'}`);
  hud.set('ad', `Adopted <b>${fmt(m * Fnow, 1)} %</b> of the market (${fmt(100 * Fnow, 0)} % of m)`);
  hud.set('who', `Now adopting: <b>${cur < 0 ? '—' : CAT[catOf(Math.min(0.999, Fnow))].name}</b>`);
}
function niceUp(v) { if (!(v > 0)) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))); const f = v / e; const st = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]; return st.find(s => f <= s + 1e-9) * e; }
function niceStep(raw) { const e = Math.pow(10, Math.floor(Math.log10(raw))); const f = raw / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; }
function fmtAx(v, step) { const dg = Math.min(3, ((+step.toPrecision(6)).toString().split('.')[1] || '').length); return v.toFixed(dg); }
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
new ResizeObserver(() => drawStage()).observe(stageEl);

/* ============================================================ readouts */
function updateReadouts() {
  const { v, C, P } = S;
  const p = v.p, q = v.q, yr = t => Math.floor(v.t0 + t);
  let ipk = 0; for (let i = 1; i < C.n; i++) if (C.f1[i] > C.f1[ipk]) ipk = i;
  const tpk = C.t[ipk];
  ro.set('peak', q > p || v.gbm ? String(yr(tpk)) : `${v.t0} (launch)`, null, `t* = ${fmt(tpk, 1)} a · ${fmt(100 * C.F1[ipk], 0)} % of m adopted at the peak`);
  ro.set('rate', v.m * C.f1[ipk], null, `${fmt(100 * C.f1[ipk], 1)} % of m per year`);
  const t16 = crossing(C.t, C.F1, 0.16), t50 = crossing(C.t, C.F1, 0.5);
  ro.set('t16', Number.isFinite(t16) ? String(yr(t16)) : '—', t16 > 10 ? 'warn' : 'ok', Number.isFinite(t16) ? `${fmt(t16, 1)} a after launch` : 'beyond the horizon');
  ro.set('t50', Number.isFinite(t50) ? String(yr(t50)) : '—', null, Number.isFinite(t50) ? `${fmt(t50, 1)} a after launch` : 'beyond the horizon');
  ro.set('inn', 100 * innShare(p, q), null, 'Eq. D5, plain Bass model');
  const i10 = Math.min(C.n - 1, Math.round(11 / C.dt));
  ro.set('f10', v.m * C.F1[i10], null, `${fmt(100 * C.F1[i10], 0)} % of the potential m`);
  const H = 2040 - v.t0, iH = Math.min(C.n - 1, Math.max(0, Math.round((H + 1) / C.dt)));
  if (v.delay > 0 && H > 0) {
    let yrsLost = 0; for (let i = 0; i < C.n && C.t[i] <= H; i++) if (C.t[i] >= 0) yrsLost += (C.F1[i] - C.F2[i]) * C.dt;
    ro.set('delay', `${fmt(v.m * (C.F1[iH] - C.F2[iH]), 1)} pp`, (C.F1[iH] - C.F2[iH]) > 0.2 ? 'bad' : 'warn', `EU ${fmt(v.m * C.F2[iH], 1)} % vs first market ${fmt(v.m * C.F1[iH], 1)} % in 2040 · ${fmt(v.m * yrsLost, 0)} %-years`);
  } else ro.set('delay', v.delay > 0 ? 'after 2040' : 'no delay', 'ok', v.delay > 0 ? 'launch is after 2040' : 'EU launch at the same time');
  const tb50 = Fb(1e9, p, q) >= 0.5 ? tShare(0.5, p, q) : NaN;
  if (v.gbm) ro.set('gbm', `${fmt(t50, 1)} a`, t50 < tb50 ? 'ok' : null, `plain Bass ${fmt(tb50, 1)} a — ${fmt(tb50 - t50, 1)} a saved`);
  else ro.set('gbm', 'off', null, `plain Bass: ${fmt(tb50, 1)} a to 50 % of m`);
}

/* ============================================================ charts */
const scenPlot = new Plot('#chart-scen', { x: { label: 'Year', min: 2010, max: 2060, format: v => String(Math.round(v)) }, y: { label: 'Adoption', unit: '% of each market', min: 0 }, legend: true });
const gbmPlot = new Plot('#chart-gbm', { x: { label: 'Years after launch', unit: 'a', min: 0 }, y: { label: 'Adopted', unit: '% of m', min: 0, max: 100 }, y2: { label: 'Price', unit: '× incumbent', min: 0 }, legend: true });
const hypePlot = new Plot('#chart-hype', { x: { label: 'Years after launch', unit: 'a', min: 0 }, y: { label: 'Level', unit: '% of maximum', min: 0, max: 118 }, legend: true });
function drawScenarios() {
  scenPlot.clear();
  const v = ui.values();
  Object.entries(SCEN).forEach(([k, s]) => {
    const P = { p: s.p, q: s.q, gbm: s.gbm, P0: s.P0, g: s.g, betaP: s.betaP, adv: s.adv, tA: s.tA, delay: s.delay, spill: 0 };
    const C = simulateCurves(P, 2061 - s.t0);
    const xs = [], y1 = [], y2 = [];
    for (let i = 0; i < C.n; i += 10) { const yr = s.t0 + C.t[i]; if (yr < 2010) continue; xs.push(yr); y1.push(s.m * C.F1[i]); y2.push(s.m * C.F2[i]); }
    scenPlot.line(k + '1', xs, y1, { color: s.color, width: 1.4, dash: [5, 4], label: `${s.name} — first market` });
    scenPlot.line(k + '2', xs, y2, { color: s.color, width: 2.6, label: `${s.name} — EU (+${s.delay} a)` });
  });
  scenPlot.vline('now', 2026.75, { color: 'muted', label: 'Sept 2026' });
}
function drawGBM() {
  const v = ui.values();
  const P = { p: v.p, q: v.q, gbm: true, P0: v.P0, g: v.g, betaP: v.betaP, adv: v.adv, tA: v.tA };
  const xs = [], fb = [], fg = [], pr = [];
  for (let t = 0; t <= v.hz; t += 0.25) { xs.push(t); fb.push(100 * Fb(t, v.p, v.q)); fg.push(100 * Fb(X(t, P), v.p, v.q)); pr.push(priceAt(t, P)); }
  gbmPlot.setAxis('x', { min: 0, max: v.hz });
  gbmPlot.line('bass', xs, fb, { color: 'muted', width: 2, dash: [5, 4], label: 'Bass (no marketing mix)' });
  gbmPlot.line('gbm', xs, fg, { color: 'accent', width: 2.6, label: 'Generalised Bass' });
  gbmPlot.line('price', xs, pr, { color: 'amber', width: 1.8, y2: true, label: 'Price (× incumbent)' });
}
function drawHype() {
  const v = ui.values(); const xs = [], ad = [], ex = [];
  const T = Math.min(v.hz, 40);
  let emax = 0; const E = t => 0.95 * Math.exp(-(((t - 2.2) / 1.5) ** 2)) + 0.6 * Fb(t, v.p, v.q);
  for (let t = 0; t <= T; t += 0.1) emax = Math.max(emax, E(t));
  let pk = 0, tr = null, prev = -1, falling = false;
  for (let t = 0; t <= T + 1e-9; t += 0.1) { xs.push(t); ad.push(100 * Fb(t, v.p, v.q)); const e = 100 * E(t) / emax; ex.push(e); if (e > (ex[pk] ?? -1)) pk = ex.length - 1; if (prev >= 0) { if (e < prev) falling = true; else if (falling && tr == null) tr = xs.length - 2; } prev = e; }
  hypePlot.setAxis('x', { min: 0, max: T });
  hypePlot.line('exp', xs, ex, { color: 'magenta', width: 2.4, label: 'Expectations / visibility (conceptual)' });
  hypePlot.line('ad', xs, ad, { color: 'accent', width: 2.4, label: 'Adoption F(t), Bass' });
  hypePlot.point('pk', xs[pk], ex[pk], { color: 'magenta', label: 'peak of inflated expectations' });
  if (tr != null) hypePlot.point('tr', xs[tr], ex[tr], { color: 'magenta', label: 'trough of disillusionment' }); else hypePlot.remove('tr');
}

/* ============================================================ fitting real data (Eq. D8) */
const DATA = {
  soy: { name: 'Herbicide-tolerant soybeans, USA (% of planted area)', launch: 1996, csv: 'year,percent\n1997,17\n' + [54, 68, 75, 81, 85, 87, 89, 91, 92, 91, 93, 94, 93, 93, 94, 94, 94, 94, 94, 94, 94, 95, 95, 95, 96, 96].map((v, i) => `${2000 + i},${v}`).join('\n') },
  maize: { name: 'Genetically engineered maize (all GE varieties), USA (% of planted area)', launch: 1996, csv: 'year,percent\n' + [25, 26, 34, 40, 47, 52, 61, 73, 80, 85, 86, 88, 88, 90, 93, 92, 92, 92, 92, 92, 92, 93, 93, 93, 94, 94].map((v, i) => `${2000 + i},${v}`).join('\n') },
  stacked: { name: 'Stacked-trait maize (HT + Bt), USA (% of planted area)', launch: 1999, csv: 'year,percent\n' + [1, 1, 2, 4, 6, 9, 15, 28, 40, 46, 47, 49, 52, 71, 76, 77, 76, 77, 80, 80, 79, 81, 81, 82, 83, 84].map((v, i) => `${2000 + i},${v}`).join('\n') },
  custom: { name: 'Your own data — synthetic example to replace', launch: 2015, csv: '' }
};
// synthetic example (clearly labelled): Bass with p = 0.02, q = 0.5, m = 50, launch 2015, plus fixed pseudo-random noise
{ const rng = mulberry32(3); DATA.custom.csv = 'year,synthetic_percent\n' + Array.from({ length: 10 }, (_, i) => { const yr = 2016 + i; return `${yr},${Math.max(0, 50 * Fb(yr - 2015, 0.02, 0.5) + (rng() - 0.5) * 1.6).toFixed(1)}`; }).join('\n'); }
const fitPlot = new Plot('#chart-fit', { x: { label: 'Year', format: v => String(Math.round(v)) }, y: { label: 'Adoption', unit: '%', min: 0 }, legend: true });
const fsel = $('#fit-ds'), fdata = $('#fit-data'), flaunch = $('#fit-launch'), ffree = $('#fit-t0');
fsel.innerHTML = Object.entries(DATA).map(([k, d]) => `<option value="${k}">${d.name}</option>`).join('');
let lastFit = null;
function loadDataset(k) { fsel.value = k; fdata.value = DATA[k].csv; flaunch.value = DATA[k].launch; runFit(); }
function runFit() {
  const tab = parseTable(fdata.value); const h = tab.headers;
  const xs = [], ys = [];
  tab.rows.forEach(r => { const x = +r[0], y = +r[1]; if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); } });
  const res = $('#fit-res');
  if (xs.length < 4) { res.innerHTML = '<p class="td-warn">At least four rows of <em>year, value</em> are needed.</p>'; return; }
  const free = ffree.checked, T0 = +flaunch.value, ymax = Math.max(...ys);
  const model = free ? (x, P) => P[2] * Fb(x - P[3], P[0], P[1]) : (x, P) => P[2] * Fb(x - T0, P[0], P[1]);
  const p0 = free ? [0.03, 0.4, ymax * 1.05, Math.min(...xs) - 1] : [0.03, 0.4, ymax * 1.05];
  const bounds = free ? [[1e-5, 1], [0, 3], [ymax * 0.8, ymax * 5], [Math.min(...xs) - 15, Math.min(...xs) - 0.01]] : [[1e-5, 1], [0, 3], [ymax * 0.8, ymax * 5]];
  let r; try { r = fitLM(model, xs, ys, p0, { bounds }); } catch (e) { res.innerHTML = '<p class="td-warn">The fit failed — check the data.</p>'; return; }
  const [p, q, m, t0f] = r.params, L0 = free ? t0f : T0;
  lastFit = { p, q, m, t0: L0, xs, ys, r, unit: h[1] || 'value' };
  const x0 = Math.min(L0, Math.min(...xs)) - 1, x1 = Math.max(...xs) + 8, gx = [], gy = [];
  for (let x = x0; x <= x1; x += 0.2) { gx.push(x); gy.push(model(x, r.params)); }
  fitPlot.clear();
  fitPlot.setAxis('x', { min: x0, max: x1 }); fitPlot.setAxis('y', { min: 0, max: Math.max(ymax, m) * 1.1 });
  fitPlot.line('fit', gx, gy, { color: 'accent', width: 2.4, label: `Bass fit (R² = ${fmt(r.r2, 3)})` });
  fitPlot.scatter('data', xs, ys, { color: 'magenta', r: 4, label: 'Data' });
  fitPlot.hline('m', m, { color: 'muted', label: `m = ${fmt(m, 1)}` });
  fitPlot.vline('t0', L0, { color: 'muted', label: `launch ${L0.toFixed(free ? 1 : 0)}` });
  const tpk = tPeak(p, q);
  res.innerHTML = `<table class="td-fit-tab"><tr><th>p (a⁻¹)</th><th>q (a⁻¹)</th><th>m</th>${free ? '<th>launch</th>' : ''}<th>R²</th><th>RMSE</th><th>q/p</th><th>peak</th></tr>
    <tr><td>${fmt(p, 4)} ± ${fmt(r.se[0], 4)}</td><td>${fmt(q, 3)} ± ${fmt(r.se[1], 3)}</td><td>${fmt(m, 1)} ± ${fmt(r.se[2], 1)}</td>${free ? `<td>${t0f.toFixed(1)} ± ${fmt(r.se[3], 1)}</td>` : ''}<td>${fmt(r.r2, 4)}</td><td>${fmt(r.rmse, 2)}</td><td>${fmt(q / p, 1)}</td><td>${q > p ? (L0 + tpk).toFixed(1) : 'at launch'}</td></tr></table>
    <p class="td-note">${r.converged ? 'Converged' : 'Not fully converged — try fixing the launch year'} after ${r.iterations} Levenberg–Marquardt iterations. ± = asymptotic standard errors. ${free ? 'The launch year is estimated too: expect wide errors when the data start late.' : 'Launch year fixed.'}</p>`;
}
fsel.addEventListener('change', () => loadDataset(fsel.value));
$('#fit-run').addEventListener('click', runFit);
ffree.addEventListener('change', runFit);
flaunch.addEventListener('change', runFit);
$('#fit-use').addEventListener('click', () => { if (!lastFit) return; const mm = Math.min(100, Math.max(1, lastFit.m)); ui.setMany({ p: Math.min(0.3, Math.max(0.001, +lastFit.p.toPrecision(3))), q: Math.min(1.2, +lastFit.q.toFixed(2)), m: Math.round(mm), t0: Math.round(lastFit.t0), gbm: false, delay: 0, spill: 0 }); window.FFP && FFP.toast && FFP.toast('Fitted parameters copied into the model'); });
$('#fit-csv').addEventListener('click', () => { if (!lastFit) return; const { p, q, m, t0, xs, ys } = lastFit; downloadCSV('bass-fit.csv', ['year', 'observed', 'fitted'], xs.map((x, i) => [x, ys[i], +(m * Fb(x - t0, p, q)).toFixed(3)])); });

/* ============================================================ wiring */
let raf = 0;
function update(restart) {
  const v = ui.values();
  ['P0', 'g', 'betaP', 'adv', 'tA'].forEach(k => ui.enable(k, v.gbm)); ui.enable('spill', v.delay > 0);
  prepare(); updateReadouts(); drawScenarios(); drawGBM(); drawHype();
  if (restart && !reduceMotion) { cursor = -1; clock.play(); }
  else { if (reduceMotion) cursor = S.hz; drawStage(); }
}
ui.onChange((s, id) => {
  if (id === 'speed') { clock.speed = s.speed; return; }
  cancelAnimationFrame(raf); raf = requestAnimationFrame(() => update(false));
});
clock.speed = ui.get('speed');
loadDataset('maize');
update(true);
