/* ==========================================================================
   tray.js — top-down 2D canvas of a floating raft with lettuce heads
   Each head is painted procedurally (overlapping obovate leaves with gradients,
   ruffled margins, veins, gloss and a soft shadow). Its projected radius comes from
   the model: cover per plant = f/ρ (the fraction of the plant's own ground area it
   intercepts), so the canvas closes exactly when the model's light interception → 1.
   ========================================================================== */
const TAU = Math.PI * 2;
function rng(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const PAL = {
  outerEdge: [58, 112, 36], outerMid: [112, 172, 62], outerBase: [205, 232, 150],
  innerEdge: [150, 200, 88], innerMid: [196, 228, 128], innerBase: [236, 246, 196]
};

/** Paint one head centred at (cx, cy) with projected radius R (px). g = maturity 0–1 (leaf number, head heart). */
function paintHead(ctx, cx, cy, R, g, seed) {
  const r = rng(seed * 7919 + 13);
  const n = Math.max(4, Math.round(5 + 19 * Math.pow(g, 0.8)));
  // soft cast shadow on the raft
  ctx.save(); ctx.translate(cx + R * 0.06, cy + R * 0.09);
  const sg = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 1.08); sg.addColorStop(0, 'rgba(20,30,15,0.38)'); sg.addColorStop(1, 'rgba(20,30,15,0)');
  ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, R * 1.08, 0, TAU); ctx.fill(); ctx.restore();
  for (let k = 0; k < n; k++) {
    const age = 1 - k / n;                                   // 1 = oldest, outermost
    const ang = k * 2.39996 + (r() - 0.5) * 0.35;
    const len = R * (0.34 + 0.66 * Math.pow(age, 0.85)) * (0.92 + r() * 0.14);
    const wid = len * (0.9 + r() * 0.25) * (age > 0.35 ? 1 : 0.8);
    const lift = (1 - age) * 0.35;                           // inner leaves are more upright → shorter in plan view
    drawLeaf(ctx, cx, cy, ang, len * (1 - lift * 0.5), wid, age, r, R);
  }
  // heart: tightly folded young leaves
  const hr = R * (0.1 + 0.1 * g);
  const hg = ctx.createRadialGradient(cx - hr * 0.3, cy - hr * 0.3, hr * 0.1, cx, cy, hr);
  hg.addColorStop(0, rgb(PAL.innerBase)); hg.addColorStop(0.7, rgb(PAL.innerMid)); hg.addColorStop(1, rgb(PAL.innerEdge, 0.9));
  ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(cx, cy, hr, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(120,170,70,0.5)'; ctx.lineWidth = Math.max(0.5, R * 0.012);
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx + (r() - 0.5) * hr * 0.4, cy + (r() - 0.5) * hr * 0.4, hr * (0.4 + i * 0.2), r() * 3, r() * 3 + 2.4); ctx.stroke(); }
}
function drawLeaf(ctx, cx, cy, ang, len, wid, age, r, R) {
  const edge = mix(PAL.innerEdge, PAL.outerEdge, age), mid = mix(PAL.innerMid, PAL.outerMid, age), base = mix(PAL.innerBase, PAL.outerBase, age);
  const ph = r() * 10, rf = 0.05 + 0.06 * r(), freq = 7 + Math.floor(r() * 5);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
  const b0 = R * 0.04;
  // outline: obovate blade, widest at ~65 % of its length, ruffled margin
  const pts = [];
  const M = 30;
  for (let i = 0; i <= M; i++) {
    const t = i / M; const hw = wid / 2 * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, 0.72))), 0.62);
    const rr = 1 + rf * Math.sin(freq * Math.PI * t + ph) * Math.pow(t, 1.5);
    pts.push([b0 + len * t, hw * rr]);
  }
  ctx.beginPath(); ctx.moveTo(b0, 0);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  for (let i = pts.length - 1; i >= 0; i--) { const [x, y] = pts[i]; const t = i / M; ctx.lineTo(x, -y * (1 + 0.08 * Math.sin(freq * 1.3 * Math.PI * t + ph * 1.7))); }
  ctx.closePath();
  // under-shadow (depth between overlapping leaves)
  ctx.save(); ctx.shadowColor = 'rgba(10,25,5,0.35)'; ctx.shadowBlur = R * 0.06; ctx.shadowOffsetX = R * 0.015; ctx.shadowOffsetY = R * 0.02;
  const gr = ctx.createLinearGradient(b0, 0, b0 + len, 0);
  gr.addColorStop(0, rgb(base)); gr.addColorStop(0.35, rgb(mix(base, mid, 0.8))); gr.addColorStop(0.75, rgb(mid)); gr.addColorStop(1, rgb(edge));
  ctx.fillStyle = gr; ctx.fill(); ctx.restore();
  // blistered (bullate) texture: faint light and dark spots
  ctx.save(); ctx.clip();
  for (let i = 0; i < 10; i++) { const x = b0 + len * (0.25 + r() * 0.7), y = (r() - 0.5) * wid * 0.7, s = R * (0.03 + r() * 0.05); const sp = ctx.createRadialGradient(x, y, 0, x, y, s); sp.addColorStop(0, r() < 0.5 ? 'rgba(255,255,230,0.18)' : 'rgba(20,60,10,0.12)'); sp.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = sp; ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill(); }
  // gloss
  const gl = ctx.createRadialGradient(b0 + len * 0.55, -wid * 0.12, 0, b0 + len * 0.55, -wid * 0.12, len * 0.45);
  gl.addColorStop(0, 'rgba(255,255,245,0.22)'); gl.addColorStop(1, 'rgba(255,255,245,0)'); ctx.fillStyle = gl; ctx.fillRect(b0, -wid, len, wid * 2);
  // veins: pale midrib and curved laterals
  ctx.strokeStyle = rgb(mix(base, [255, 255, 240], 0.25), 0.5); ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.6, R * 0.022 * (0.6 + age * 0.6));
  ctx.beginPath(); ctx.moveTo(b0, 0); ctx.quadraticCurveTo(b0 + len * 0.45, wid * 0.03, b0 + len * 0.72, 0); ctx.stroke();
  ctx.lineWidth = Math.max(0.4, R * 0.008); ctx.strokeStyle = rgb(mix(base, [255, 255, 240], 0.2), 0.28);
  for (let v = 1; v <= 5; v++) { const x0 = b0 + len * (0.12 + v * 0.14); [-1, 1].forEach(s => { ctx.beginPath(); ctx.moveTo(x0, 0); ctx.quadraticCurveTo(x0 + len * 0.1, s * wid * 0.18, x0 + len * 0.16, s * wid * 0.36 * Math.sin(Math.PI * Math.min(1, (x0 - b0) / len + 0.1))); ctx.stroke(); }); }
  ctx.restore();
  // margin
  ctx.strokeStyle = rgb(mix(edge, [20, 50, 10], 0.35), 0.5); ctx.lineWidth = Math.max(0.5, R * 0.008); ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------ cached head sprites */
const cache = new Map();
function headSprite(R, g, seed) {
  const Rq = Math.max(2, Math.round(R)), gq = Math.round(g * 20) / 20, key = `${Rq}|${gq}|${seed}`;
  let c = cache.get(key); if (c) return c;
  const S = Math.ceil(Rq * 2.5 + 6); c = document.createElement('canvas'); c.width = c.height = S;
  paintHead(c.getContext('2d'), S / 2, S / 2, Rq, gq, seed);
  if (cache.size > 400) cache.delete(cache.keys().next().value);
  cache.set(key, c); return c;
}

/* ------------------------------------------------------------ raft pattern */
let foam = null;
function foamPattern(ctx) {
  if (foam) return ctx.createPattern(foam, 'repeat');
  foam = document.createElement('canvas'); foam.width = foam.height = 160; const f = foam.getContext('2d');
  f.fillStyle = '#e9ebe4'; f.fillRect(0, 0, 160, 160);
  const r = rng(3);
  for (let i = 0; i < 1400; i++) { const v = 205 + r() * 50; f.fillStyle = `rgba(${v},${v},${v - 6},${0.35 + r() * 0.4})`; const s = 1 + r() * 2.6; f.beginPath(); f.arc(r() * 160, r() * 160, s, 0, TAU); f.fill(); }
  for (let i = 0; i < 260; i++) { f.fillStyle = `rgba(150,150,140,${0.06 + r() * 0.08})`; f.beginPath(); f.arc(r() * 160, r() * 160, 1 + r() * 3, 0, TAU); f.fill(); }
  return ctx.createPattern(foam, 'repeat');
}

/**
 * Draw the tray(s). panels: [{ label, dens, cover (m² per plant), fw (g), lai, f, color }]
 * opts: { light: bool (show light reaching the raft), dark: bool }
 */
export function drawTray(canvas, panels, opts = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const Wc = canvas.clientWidth, Hc = canvas.clientHeight; if (!Wc || !Hc) return;
  if (canvas.width !== Math.round(Wc * dpr) || canvas.height !== Math.round(Hc * dpr)) { canvas.width = Math.round(Wc * dpr); canvas.height = Math.round(Hc * dpr); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // background: dark growing-room floor with the raft floating in a tank
  ctx.fillStyle = '#16211c'; ctx.fillRect(0, 0, Wc, Hc);
  const pad = 14, gap = panels.length > 1 ? 12 : 0;
  const pw = (Wc - 2 * pad - gap * (panels.length - 1)) / panels.length, ph = Hc - 2 * pad - 30;
  const viewH = 0.75;                                       // metres of raft shown vertically
  const pxPerM = ph / viewH;
  panels.forEach((P, pi) => {
    const x0 = pad + pi * (pw + gap), y0 = pad;
    // tank rim + water gap
    ctx.fillStyle = '#243832'; roundRect(ctx, x0 - 4, y0 - 4, pw + 8, ph + 8, 10); ctx.fill();
    ctx.fillStyle = '#1f5a63'; roundRect(ctx, x0, y0, pw, ph, 7); ctx.fill();
    ctx.save(); roundRect(ctx, x0 + 3, y0 + 3, pw - 6, ph - 6, 5); ctx.clip();
    ctx.fillStyle = foamPattern(ctx); ctx.fillRect(x0, y0, pw, ph);
    // grid of plants (square spacing s = 1/√ρ), centred in the panel
    const s = 1 / Math.sqrt(P.dens) * pxPerM;
    const nx = Math.max(1, Math.floor((pw - 6) / s)), ny = Math.max(1, Math.floor((ph - 6) / s));
    const ox = x0 + (pw - (nx - 1) * s) / 2, oy = y0 + (ph - (ny - 1) * s) / 2;
    const R = Math.sqrt(Math.max(1e-8, P.cover) / Math.PI) * pxPerM * 1.45;   // painted silhouettes are irregular: scale so the canopy closes as f → 1
    const holeR = Math.min(0.025 * pxPerM, s * 0.3);
    if (opts.light) { ctx.fillStyle = 'rgba(255,186,48,0.42)'; ctx.fillRect(x0, y0, pw, ph); }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const cx = ox + i * s, cy = oy + j * s;
      // net pot in the raft
      ctx.fillStyle = 'rgba(40,44,46,0.9)'; ctx.beginPath(); ctx.arc(cx, cy, holeR, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#1b1e20'; ctx.lineWidth = Math.max(1, holeR * 0.25); ctx.stroke();
      ctx.fillStyle = '#c7ae78'; ctx.beginPath(); ctx.arc(cx, cy, holeR * 0.62, 0, TAU); ctx.fill();
    }
    const g = Math.min(1, Math.max(0, P.fw / 220));
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const cx = ox + i * s, cy = oy + j * s, seed = (i * 31 + j * 17 + pi * 7) % 12;
      const Ri = R * (0.93 + 0.14 * (((i * 13 + j * 7) % 5) / 4));
      const spr = headSprite(Ri, g, seed);
      const S2 = spr.width;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(((i * 37 + j * 11) % 12) * 0.52); ctx.drawImage(spr, -S2 / 2, -S2 / 2); ctx.restore();
    }
    ctx.restore();
    // panel label
    if (P.label) { ctx.font = '600 13px Inter, system-ui, sans-serif'; const tw = ctx.measureText(P.label).width, lx = x0 + pw - tw - 28, ly = y0 + ph - 40; ctx.fillStyle = 'rgba(8,14,11,0.72)'; roundRect(ctx, lx, ly, tw + 18, 24, 12); ctx.fill(); ctx.fillStyle = P.color || '#e6eee9'; ctx.fillText(P.label, lx + 9, ly + 17); }
  });
  // scale bar (10 cm) in the lower-left corner of the first panel
  const L = 0.1 * pxPerM, bx = pad + 16, by = pad + ph - 16;
  ctx.fillStyle = 'rgba(8,14,11,0.62)'; roundRect(ctx, bx - 8, by - 26, L + 16, 32, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(230,238,233,0.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by); ctx.lineTo(bx + L, by); ctx.lineTo(bx + L, by - 5); ctx.stroke();
  ctx.fillStyle = 'rgba(230,238,233,0.95)'; ctx.font = '500 11px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText('10 cm', bx + L / 2, by - 10); ctx.textAlign = 'left';
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
