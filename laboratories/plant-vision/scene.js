/* ==========================================================================
   scene.js — procedural top-view images of a lettuce raft (ES module)
   Every image comes with pixel-exact ground truth: which plant each pixel
   belongs to, which pixels are necrotic, each plant's true projected area,
   its (synthetic) fresh mass and whether it is diseased.

   Geometry: 80 × 50 cm field of view on 960 × 600 px → 12 px cm⁻¹ at the tray.
   4 × 3 plants at 15 cm spacing; a 5 × 5 cm blue reference square with a white
   border lies on the bench at tray height.
   Growth: projected radius R(d) = R0 + (Rmax − R0)/(1 + exp(−k(d − dᵢ))).
   Fresh mass (SYNTHETIC ground truth): W = 0.122 · A^1.18 · e^(0.08 ε), A in cm² —
   the illustrative calibration of Lesson 10.3 (Worked example 4).
   ========================================================================== */
import { mulberry32, randn } from '/assets/js/stats.js';

export const FIELD = { wcm: 80, hcm: 50, W: 960, H: 600 };
export const PX_PER_CM = FIELD.W / FIELD.wcm;           // 12
export const CARD = { x: 69.5, y: 3, size: 7, inner: 5 }; // cm, white border square with 5 cm blue centre
export const ALLOMETRY = { a: 0.122, b: 1.18, sigma: 0.08 };
const COLS = 4, ROWS = 3, SPACING = 15, X0 = 9.5, Y0 = 10, RAFT_EDGE = 66;

/* Illumination in three broad bands (red, green, blue light) and the camera's channel cross-talk.
   Rendered colours are treated as band reflectances under white light; camera signal = M · (L ⊙ ρ).
   Band intensities and the cross-talk matrix are illustrative, not measured spectra. */
export const LIGHTS = {
  white: { label: 'White LED', band: [1, 1, 1] },
  warm: { label: 'Warm white / HPS', band: [1.15, 0.85, 0.35] },
  redblue: { label: 'Red + blue LED', band: [1.3, 0.05, 1.15] }
};
export const CAMERA_M = [[0.86, 0.12, 0.02], [0.08, 0.84, 0.08], [0.02, 0.12, 0.86]];

/** Plant layout and plant-level ground truth for one seed. */
export function makePlants({ seed = 1, cultivar = 'green', prevalence = 0.3, tipburn = true } = {}) {
  const rng = mulberry32(seed * 7919 + 13); const plants = [];
  let id = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const red = cultivar === 'red' || (cultivar === 'mixed' && (r + c) % 2 === 1);
    const diseased = rng() < prevalence;
    plants.push({
      id: id++, cx: X0 + c * SPACING + 0.6 * randn(rng), cy: Y0 + r * SPACING + 0.6 * randn(rng),
      R0: 2.4 + 0.5 * rng(), Rmax: 7.5 + 3 * rng(), di: Math.min(25, Math.max(14, 19 + 2.5 * randn(rng))), k: 0.16 + 0.06 * rng(),
      red, diseased, severity: diseased ? 0.35 + 0.65 * rng() : 0, tipburn: tipburn && rng() < 0.2,
      rot: rng() * Math.PI * 2, leafSeed: Math.floor(rng() * 1e9), fwNoise: randn(rng),
      hue: red ? 350 + 8 * rng() : 88 + 12 * rng(), light: red ? 30 + 6 * rng() : 38 + 8 * rng()
    });
  }
  return plants;
}
export const radiusAt = (p, day) => p.R0 + (p.Rmax - p.R0) / (1 + Math.exp(-p.k * (day - p.di)));
export const gridCentres = () => { const out = []; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) out.push({ x: (X0 + c * SPACING) * PX_PER_CM, y: (Y0 + r * SPACING) * PX_PER_CM }); return out; };

/* ------------------------------------------------------------ helpers */
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }

/** Leaf outline in plant-sprite coordinates: base at (0,0), pointing along angle ang. Returns closed point list. */
function leafOutline(len, wid, ang, bend, wavA, wavK, wavP, lobed) {
  const N = 42, pts = [], ca = Math.cos(ang), sa = Math.sin(ang);
  const half = u => {
    const blade = Math.sqrt(Math.max(0, 1 - ((u - 0.6) / 0.42) ** 2)) * wid / 2;
    const pet = u < 0.35 ? wid * 0.07 * (1 - u / 0.35) + wid * 0.04 : 0;
    let h = Math.max(blade, pet);
    const wave = lobed ? 1 + wavA * (Math.abs(Math.sin(Math.PI * wavK * u + wavP)) * 1.6 - 0.8) : 1 + wavA * Math.sin(2 * Math.PI * wavK * u + wavP);
    return h * wave;
  };
  const P = (u, side) => { const along = u * len, across = side * half(u) + bend * len * u * u; return [along * ca - across * sa, along * sa + across * ca]; };
  for (let i = 0; i <= N; i++) pts.push(P(i / N, 1));
  for (let i = N; i >= 0; i--) pts.push(P(i / N, -1));
  return { pts, P, half };
}
function pathPts(ctx, pts, ox, oy) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x, oy + y) : ctx.moveTo(ox + x, oy + y))); ctx.closePath(); }

/** Render one plant into its own sprite (colour + lesion ground truth). Scale: px per cm (already magnified). */
function renderPlant(p, day, pxcm) {
  const R = radiusAt(p, day); const Rp = R * pxcm; const S = Math.ceil(2 * Rp + 16); const o = S / 2;
  const cv = canvas(S, S), ctx = cv.getContext('2d');
  const lv = canvas(S, S), lctx = lv.getContext('2d');
  const rng = mulberry32(p.leafSeed);
  const nLeaves = Math.round(6 + 0.45 * day);
  // fixed per-leaf properties (independent of day → consistent growth)
  const leaves = [];
  for (let i = 0; i < 26; i++) leaves.push({ ang: p.rot + i * 2.39996 + 0.25 * (rng() - 0.5), lf: 0.85 + 0.15 * rng(), wf: (p.red ? 0.52 : 0.72) + 0.12 * rng(), bend: 0.12 * (rng() - 0.5), wavA: p.red ? 0.22 + 0.08 * rng() : 0.035 + 0.03 * rng(), wavK: p.red ? 3 + Math.floor(3 * rng()) : 4 + 5 * rng(), wavP: rng() * 6.28, dl: 5 * (rng() - 0.5), lesion: rng(), spots: Array.from({ length: 4 }, () => [0.45 + 0.45 * rng(), 0.55 * (rng() - 0.5), 0.35 + 0.6 * rng(), rng()]) });
  const n = Math.min(nLeaves, leaves.length);
  const young = new Set(); for (let i = Math.max(0, n - 4); i < n; i++) young.add(i);
  for (let i = 0; i < n; i++) {
    const L = leaves[i]; const rel = 1 - i / n;
    const len = Rp * (0.42 + 0.58 * Math.pow(rel, 0.55)) * L.lf; const wid = len * L.wf;
    const off = Rp * 0.06 * (1 - rel);
    const bx = o + off * Math.cos(L.ang + 1.3), by = o + off * Math.sin(L.ang + 1.3);
    const shape = leafOutline(len, wid, L.ang, L.bend, L.wavA, L.wavK, L.wavP, p.red);
    // colour: older leaves darker; inner leaves lighter and yellower
    const lightness = p.light + (1 - rel) * (p.red ? 6 : 11) + L.dl;
    const tip = p.red ? hsl(p.hue, 42, Math.max(16, lightness - 6)) : hsl(p.hue - (1 - rel) * 10, 52 + (1 - rel) * 8, lightness);
    const base = p.red ? hsl(92, 38, lightness + 12) : hsl(p.hue - 12, 60, Math.min(66, lightness + 12));
    const [tx, ty] = shape.P(1, 0);
    const g = ctx.createLinearGradient(bx, by, bx + tx, by + ty); g.addColorStop(0, base); g.addColorStop(p.red ? 0.45 : 0.55, p.red ? hsl(20, 30, lightness + 2) : tip); g.addColorStop(1, tip);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.38)'; ctx.shadowBlur = Math.max(2, Rp * 0.05); ctx.shadowOffsetX = 1.5; ctx.shadowOffsetY = 2.5;
    pathPts(ctx, shape.pts, bx, by); ctx.fillStyle = g; ctx.fill(); ctx.restore();
    // edge and veins
    pathPts(ctx, shape.pts, bx, by); ctx.strokeStyle = p.red ? 'rgba(40,10,15,0.35)' : 'rgba(20,50,10,0.28)'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.strokeStyle = p.red ? 'rgba(200,190,150,0.22)' : 'rgba(215,235,170,0.28)'; ctx.lineWidth = Math.max(0.7, wid * 0.028);
    ctx.beginPath(); for (let k = 0; k <= 10; k++) { const [x, y] = shape.P(k / 10 * 0.92, 0); k ? ctx.lineTo(bx + x, by + y) : ctx.moveTo(bx + x, by + y); } ctx.stroke();
    ctx.lineWidth = Math.max(0.5, wid * 0.012); ctx.strokeStyle = p.red ? 'rgba(200,190,150,0.12)' : 'rgba(215,235,170,0.16)';
    for (let k = 1; k <= 4; k++) { const u = 0.3 + k * 0.14; for (const sd of [-1, 1]) { const [x0, y0] = shape.P(u, 0), [x1, y1] = shape.P(Math.min(0.98, u + 0.12), sd * 0.85); ctx.beginPath(); ctx.moveTo(bx + x0, by + y0); ctx.lineTo(bx + x1, by + y1); ctx.stroke(); } }
    // lesion ground truth: this leaf hides lesions of older leaves below it
    pathPts(lctx, shape.pts, bx, by); lctx.fillStyle = '#000'; lctx.fill();
    // disease: necrotic spots with chlorotic halo on the older half of the leaves
    if (p.diseased && rel > 0.35 && L.lesion < 0.25 + 0.6 * p.severity) {
      const nSp = Math.min(L.spots.length, 1 + Math.floor(L.spots.length * p.severity * L.spots[0][3] + 0.8));
      for (let s = 0; s < nSp; s++) {
        const [u, v, rf, jr] = L.spots[s]; const [sx, sy] = shape.P(u, 0); const hw = shape.half(u);
        const ax = -Math.sin(L.ang), ay = Math.cos(L.ang);
        const cx = bx + sx + ax * v * hw * 1.4, cy = by + sy + ay * v * hw * 1.4;
        const rad = Math.max(1.5, pxcm * (0.25 + 0.55 * rf) * (0.5 + p.severity));
        ctx.save(); pathPts(ctx, shape.pts, bx, by); ctx.clip();
        const halo = ctx.createRadialGradient(cx, cy, rad * 0.6, cx, cy, rad * 1.8); halo.addColorStop(0, 'rgba(200,180,70,0.75)'); halo.addColorStop(1, 'rgba(200,180,70,0)');
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, rad * 1.8, 0, Math.PI * 2); ctx.fill();
        const blob = []; for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2, rr = rad * (0.75 + 0.45 * Math.abs(Math.sin(a * 3 + jr * 9))); blob.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
        const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad); core.addColorStop(0, '#3d2410'); core.addColorStop(0.7, '#6b4420'); core.addColorStop(1, '#8a6230');
        pathPts(ctx, blob, cx, cy); ctx.fillStyle = core; ctx.fill(); ctx.restore();
        lctx.save(); pathPts(lctx, shape.pts, bx, by); lctx.clip(); pathPts(lctx, blob, cx, cy); lctx.fillStyle = '#f00'; lctx.fill(); lctx.restore();
      }
    }
    // tipburn: necrotic margins at the tips of the youngest leaves
    if (p.tipburn && young.has(i) && day >= 14) {
      ctx.save(); pathPts(ctx, shape.pts, bx, by); ctx.clip();
      const band = Math.max(1.5, pxcm * 0.32);
      ctx.strokeStyle = '#5e3a18'; ctx.lineWidth = band * 2; ctx.beginPath();
      let started = false; for (let k = 0; k <= 30; k++) { const u = 0.72 + 0.28 * k / 30; const [x, y] = shape.P(u, 1); started ? ctx.lineTo(bx + x, by + y) : ctx.moveTo(bx + x, by + y); started = true; }
      for (let k = 30; k >= 0; k--) { const u = 0.72 + 0.28 * k / 30; const [x, y] = shape.P(u, -1); ctx.lineTo(bx + x, by + y); }
      ctx.stroke(); ctx.restore();
      lctx.save(); pathPts(lctx, shape.pts, bx, by); lctx.clip(); lctx.strokeStyle = '#f00'; lctx.lineWidth = band * 2; lctx.beginPath();
      started = false; for (let k = 0; k <= 30; k++) { const u = 0.72 + 0.28 * k / 30; const [x, y] = shape.P(u, 1); started ? lctx.lineTo(bx + x, by + y) : lctx.moveTo(bx + x, by + y); started = true; }
      for (let k = 30; k >= 0; k--) { const u = 0.72 + 0.28 * k / 30; const [x, y] = shape.P(u, -1); lctx.lineTo(bx + x, by + y); }
      lctx.stroke(); lctx.restore();
    }
  }
  // soft highlight on the heart of the rosette
  const hl = ctx.createRadialGradient(o, o, 0, o, o, Rp * 0.5); hl.addColorStop(0, 'rgba(255,255,220,0.07)'); hl.addColorStop(1, 'rgba(255,255,220,0)');
  ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = hl; ctx.fillRect(0, 0, S, S); ctx.restore();
  return { cv, lv, S, R };
}

/* ------------------------------------------------------------ background */
function renderBackground(ctx, type, plants, day, seed) {
  const { W, H } = FIELD; const k = PX_PER_CM; const rng = mulberry32(seed * 31 + 7);
  const colours = { black: '#1d201f', grey: '#8b908e', white: '#e6e6de', substrate: '#6a4a2e' };
  ctx.fillStyle = colours[type] || colours.black; ctx.fillRect(0, 0, W, H);
  if (type === 'substrate') {
    for (let i = 0; i < 9000; i++) { const x = rng() * W, y = rng() * H, a = rng() * Math.PI, l = 3 + 9 * rng(); ctx.strokeStyle = rng() < 0.5 ? 'rgba(40,25,12,0.5)' : 'rgba(150,110,70,0.35)'; ctx.lineWidth = 0.8 + rng(); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke(); }
  } else if (type === 'white') {
    for (let i = 0; i < 6000; i++) { ctx.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(180,180,170,0.25)'; ctx.beginPath(); ctx.arc(rng() * W, rng() * H, 1 + 2.5 * rng(), 0, Math.PI * 2); ctx.fill(); }
  } else if (type === 'grey') {
    for (let x = 0; x < W; x += 36) { ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x, 0, 3, H); }
    for (let i = 0; i < 2500; i++) { ctx.fillStyle = `rgba(0,0,0,${0.04 * rng()})`; ctx.fillRect(rng() * W, rng() * H, 2, 2); }
  } else {
    for (let i = 0; i < 5000; i++) { ctx.fillStyle = `rgba(255,255,255,${0.03 * rng()})`; ctx.fillRect(rng() * W, rng() * H, 2, 2); }
  }
  // bench strip beyond the raft edge (reference card lies here)
  ctx.fillStyle = '#b9bdb6'; ctx.fillRect(RAFT_EDGE * k, 0, W - RAFT_EDGE * k, H);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(RAFT_EDGE * k - 3, 0, 3, H);
  for (let i = 0; i < 1500; i++) { ctx.fillStyle = `rgba(0,0,0,${0.05 * rng()})`; ctx.fillRect(RAFT_EDGE * k + rng() * (W - RAFT_EDGE * k), rng() * H, 2, 2); }
  // planting holes, net pots and rock-wool cubes
  if (type !== 'substrate') plants.forEach(p => {
    const x = (X0 + (p.id % COLS) * SPACING) * k, y = (Y0 + Math.floor(p.id / COLS) * SPACING) * k;
    ctx.fillStyle = '#0c0d0d'; ctx.beginPath(); ctx.arc(x, y, 2.3 * k, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#4b4f4d'; ctx.lineWidth = 0.35 * k; ctx.beginPath(); ctx.arc(x, y, 1.95 * k, 0, Math.PI * 2); ctx.stroke();
    ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot * 0.3); ctx.fillStyle = '#cfc4a3'; ctx.fillRect(-1.6 * k, -1.6 * k, 3.2 * k, 3.2 * k); ctx.fillStyle = 'rgba(90,80,60,0.35)'; ctx.fillRect(-1.6 * k, -1.6 * k, 3.2 * k, 0.4 * k); ctx.restore();
  });
  // reference card: white square with a 5 × 5 cm blue centre
  const cx = CARD.x * k, cy = CARD.y * k, cs = CARD.size * k, bi = (CARD.size - CARD.inner) / 2 * k;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(cx + 3, cy + 4, cs, cs);
  ctx.fillStyle = '#f3f3ef'; ctx.fillRect(cx, cy, cs, cs);
  ctx.fillStyle = '#2350b8'; ctx.fillRect(cx + bi, cy + bi, CARD.inner * k, CARD.inner * k);
  ctx.fillStyle = '#1f2a44'; ctx.font = `600 ${Math.round(0.55 * k)}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('5 cm', cx + cs / 2, cy + cs + 0.8 * k);
}

/**
 * Render a complete scene. Returns { imageData, gtPlant (Int16, −1 none), gtLesion (Uint8), plants (with truth), cardRect, pxPerCm }.
 * opts: { seed, day, background, cultivar, prevalence, tipburn, light, brightness, gradient, noise, camH (cm) }
 */
export function renderScene(opts) {
  const o = Object.assign({ seed: 1, day: 24, background: 'black', cultivar: 'green', prevalence: 0.3, tipburn: true, light: 'white', brightness: 1, gradient: 0.25, noise: 4, camH: 100 }, opts);
  const { W, H } = FIELD; const k = PX_PER_CM;
  const plants = makePlants(o);
  const base = canvas(W, H); const bctx = base.getContext('2d');
  renderBackground(bctx, o.background, plants, o.day, o.seed);
  const img = bctx.getImageData(0, 0, W, H); const d = img.data;
  const gtPlant = new Int16Array(W * H).fill(-1); const gtLesion = new Uint8Array(W * H);
  const ox = W / 2, oy = H / 2;
  const order = plants.slice().sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  for (const p of order) {
    const R = radiusAt(p, o.day); const hc = 1.5 + 0.8 * R;                      // canopy height above the tray, cm
    const m = o.camH / Math.max(1, o.camH - hc);                                  // perspective magnification (pinhole)
    const spr = renderPlant(p, o.day, k * m);
    const sd = spr.cv.getContext('2d').getImageData(0, 0, spr.S, spr.S).data;
    const ld = spr.lv.getContext('2d').getImageData(0, 0, spr.S, spr.S).data;
    const cxp = ox + (p.cx * k - ox) * m, cyp = oy + (p.cy * k - oy) * m;       // plant centre moves away from the optical axis
    const x0 = Math.round(cxp - spr.S / 2), y0 = Math.round(cyp - spr.S / 2);
    let own = 0;
    for (let j = 0; j < spr.S; j++) {
      const y = y0 + j; if (y < 0 || y >= H) { for (let i = 0; i < spr.S; i++) if (sd[(j * spr.S + i) * 4 + 3] >= 128) own++; continue; }
      for (let i = 0; i < spr.S; i++) {
        const q = (j * spr.S + i) * 4; const a = sd[q + 3]; if (!a) continue;
        if (a >= 128) own++;
        const x = x0 + i; if (x < 0 || x >= W) continue;
        const t = (y * W + x), t4 = t * 4, al = a / 255;
        d[t4] = d[t4] * (1 - al) + sd[q] * al; d[t4 + 1] = d[t4 + 1] * (1 - al) + sd[q + 1] * al; d[t4 + 2] = d[t4 + 2] * (1 - al) + sd[q + 2] * al;
        if (a >= 128) { gtPlant[t] = p.id; gtLesion[t] = ld[q] >= 128 && ld[q + 3] >= 128 ? 1 : 0; }
      }
    }
    p.m = m; p.hc = hc; p.R = R;
    p.trueAreaCm2 = own / (k * m) ** 2;                                           // full projected area of the plant, unmagnified
    p.fw = ALLOMETRY.a * Math.pow(p.trueAreaCm2, ALLOMETRY.b) * Math.exp(ALLOMETRY.sigma * p.fwNoise);
    p.centre = [cxp, cyp];
  }
  // illumination spectrum × reflectance, camera cross-talk, uneven light, vignetting and sensor noise
  const Lb = (LIGHTS[o.light] || LIGHTS.white).band; const M = CAMERA_M; const rng = mulberry32(o.seed * 101 + Math.round(o.day));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t4 = (y * W + x) * 4;
    const gx = x / W, gy = y / H, rr = ((gx - 0.5) ** 2 + (gy - 0.5) ** 2) * 2;
    const f = o.brightness * (1 - o.gradient * (0.75 * gx + 0.25 * gy)) * (1 - 0.18 * rr);
    const e0 = d[t4] * Lb[0], e1 = d[t4 + 1] * Lb[1], e2 = d[t4 + 2] * Lb[2];
    for (let c = 0; c < 3; c++) {
      let v = (M[c][0] * e0 + M[c][1] * e1 + M[c][2] * e2) * f;
      if (o.noise > 0) v += o.noise * randn(rng);
      d[t4 + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  const cardRect = { x0: CARD.x * k, y0: CARD.y * k, x1: (CARD.x + CARD.size) * k, y1: (CARD.y + CARD.size) * k, inner: CARD.inner };
  return { imageData: img, W, H, gtPlant, gtLesion, plants, cardRect, pxPerCm: k, grid: gridCentres().map((g, i) => { const p = plants[i]; return { x: ox + (g.x - ox) * p.m, y: oy + (g.y - oy) * p.m }; }) };
}
