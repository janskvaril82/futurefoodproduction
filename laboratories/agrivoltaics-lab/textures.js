/* Procedural textures for the agrivoltaic field: PV module faces and plant cards (alpha-tested).
   All painted on canvases at start-up; no external images. */
import { THREE, canvasTexture, rng, BufferGeometryUtils } from '/assets/js/lab3d.js';

/** Front (cells) or rear (bifacial glass / white backsheet) texture of a landscape module with 12 × 6 half-cut cells. */
export function moduleTexture(side = 'front', bifacial = true) {
  return canvasTexture(1024, 512, (ctx, W, H) => {
    const r = rng(side === 'front' ? 5 : 9);
    const nx = 12, ny = 6, cw = W / nx, ch = H / ny, gap = 5;
    // gaps between cells: light passes through glass–glass bifacial modules; white backsheet otherwise
    ctx.fillStyle = side === 'front' ? (bifacial ? '#3a4852' : '#dfe3e6') : (bifacial ? '#46535c' : '#eceeee');
    ctx.fillRect(0, 0, W, H);
    if (side === 'back' && !bifacial) {           // white backsheet with junction box
      ctx.fillStyle = 'rgba(0,0,0,0.06)'; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) ctx.fillRect(i * cw + gap, j * ch + gap, cw - 2 * gap, ch - 2 * gap);
      ctx.fillStyle = '#20252a'; ctx.fillRect(W * 0.46, H * 0.06, W * 0.08, H * 0.1); return;
    }
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const x = i * cw + gap / 2, y = j * ch + gap / 2, w = cw - gap, h = ch - gap;
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      if (side === 'front') { g.addColorStop(0, '#0d1b33'); g.addColorStop(0.5, '#132a4c'); g.addColorStop(1, '#0b1830'); }
      else { g.addColorStop(0, '#26303c'); g.addColorStop(1, '#1b232d'); }
      ctx.fillStyle = g;
      // mono cells with chamfered corners
      const c = 7; ctx.beginPath(); ctx.moveTo(x + c, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c); ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x + c, y + h); ctx.lineTo(x, y + h - c); ctx.lineTo(x, y + c); ctx.closePath(); ctx.fill();
      // crystalline shimmer
      for (let k = 0; k < 14; k++) { ctx.fillStyle = `rgba(${60 + r() * 60},${90 + r() * 60},${150 + r() * 70},${0.03 + r() * 0.05})`; ctx.fillRect(x + r() * w, y + r() * h, 2 + r() * 10, 2 + r() * 10); }
      // half-cut line
      ctx.fillStyle = side === 'front' ? 'rgba(160,175,190,0.35)' : 'rgba(150,160,170,0.3)'; ctx.fillRect(x, y + h / 2 - 1, w, 2);
      // busbars (multi-busbar, vertical) and fingers (horizontal, faint)
      ctx.fillStyle = side === 'front' ? 'rgba(205,212,220,0.55)' : 'rgba(190,196,204,0.45)';
      for (let b = 1; b <= 9; b++) ctx.fillRect(x + b * w / 10 - 0.6, y, 1.2, h);
      ctx.fillStyle = 'rgba(200,210,220,0.07)'; for (let f = 2; f < h; f += 4) ctx.fillRect(x, y + f, w, 1);
    }
    if (side === 'front') { // ribbon interconnect at the ends of each string
      ctx.fillStyle = 'rgba(210,214,220,0.6)'; ctx.fillRect(0, 0, W, 3); ctx.fillRect(0, H - 3, W, 3);
    }
  }, { key: 'pvmod-' + side + (bifacial ? '-bi' : '-mono'), anisotropy: 8 });
}

/* -------------------------------------------------------------- plant cards (RGBA, transparent background) */
function leafPath(ctx, cx, base, len, halfW, { bend = 0, ruffle = 0, ruffleF = 20, tipRound = 0.9, seed = 1 } = {}) {
  const r = rng(seed); const n = 48; const pts = [];
  for (let s = -1; s <= 1; s += 2) for (let i = 0; i <= n; i++) {
    const t = s < 0 ? i / n : 1 - i / n;
    let hw = halfW * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), tipRound);
    hw += ruffle * Math.sin(t * ruffleF + seed) * Math.min(1, t * 4) * (0.6 + 0.4 * r());
    const y = base - t * len; const x = cx + bend * t * t * len + s * Math.max(0, hw);
    pts.push([x, y]);
  }
  ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
}
export function lettuceLeafTexture() {
  return canvasTexture(256, 256, (ctx, W, H) => {
    ctx.clearRect(0, 0, W, H);
    leafPath(ctx, W / 2, H - 4, H - 12, W * 0.43, { ruffle: 5, ruffleF: 34, tipRound: 0.75, seed: 3 });
    const g = ctx.createLinearGradient(0, H, 0, 0); g.addColorStop(0, '#e6f0b8'); g.addColorStop(0.35, '#a8d15c'); g.addColorStop(1, '#6aa738');
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.clip();
    const r = rng(4); for (let i = 0; i < 500; i++) { ctx.fillStyle = `rgba(${40 + r() * 60},${90 + r() * 70},${20 + r() * 30},${0.05 + r() * 0.08})`; ctx.fillRect(r() * W, r() * H, 3 + r() * 6, 3 + r() * 6); }
    ctx.strokeStyle = 'rgba(245,250,225,0.8)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(W / 2, H); ctx.quadraticCurveTo(W / 2 + 3, H * 0.5, W / 2, 20); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(240,248,215,0.55)';
    for (let k = 0; k < 7; k++) { const y0 = H * (0.85 - k * 0.1); [-1, 1].forEach(s => { ctx.beginPath(); ctx.moveTo(W / 2, y0); ctx.quadraticCurveTo(W / 2 + s * 40, y0 - 25, W / 2 + s * 100, y0 - 55); ctx.stroke(); }); }
    ctx.restore();
  }, { key: 'card-lettuce', srgb: true });
}
export function potatoLeafTexture() {
  return canvasTexture(256, 384, (ctx, W, H) => {
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2; const col = ['#4f8a33', '#3f7a2a', '#5a9540'];
    ctx.strokeStyle = '#4a6b2c'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(cx, H); ctx.quadraticCurveTo(cx + 6, H * 0.5, cx, H * 0.12); ctx.stroke();
    const leaflet = (x, y, len, ang, w, seed) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      leafPath(ctx, 0, 0, len, w, { tipRound: 0.85, seed }); ctx.fillStyle = col[seed % 3]; ctx.fill();
      ctx.strokeStyle = 'rgba(200,225,160,0.45)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len * 0.92); ctx.stroke();
      ctx.restore();
    };
    leaflet(cx, H * 0.2, H * 0.19, 0, 34, 1);                               // terminal leaflet
    const ys = [0.3, 0.46, 0.62, 0.76];
    ys.forEach((f, i) => [-1, 1].forEach(s => { const L = H * (0.16 - i * 0.018); leaflet(cx, H * f, L, s * (1.15 - i * 0.05), 26 - i * 3, 2 + i * 2 + (s > 0 ? 1 : 0)); }));
    [0.38, 0.54, 0.69].forEach((f, i) => [-1, 1].forEach(s => leaflet(cx, H * f, H * 0.05, s * 1.35, 9, 11 + i)));   // interjected leaflets
  }, { key: 'card-potato', srgb: true });
}
export function grassTuftTexture(kind = 'grass') {
  const tall = kind !== 'grass';
  return canvasTexture(256, tall ? 512 : 256, (ctx, W, H) => {
    ctx.clearRect(0, 0, W, H); const r = rng(kind === 'grass' ? 21 : 33);
    const blades = kind === 'grass' ? 46 : 30;
    for (let i = 0; i < blades; i++) {
      const x0 = W / 2 + (r() - 0.5) * W * 0.3, lean = (r() - 0.5) * (kind === 'grass' ? 1.3 : 0.7), len = H * (0.55 + r() * 0.42);
      const x1 = x0 + lean * len * 0.6, y1 = H - len, wb = (kind === 'grass' ? 3.2 : 4) + r() * 2;
      const g = ctx.createLinearGradient(0, H, 0, y1);
      const hue = kind === 'cereal' ? 70 + r() * 18 : 82 + r() * 26, light = 33 + r() * 15;
      g.addColorStop(0, `hsl(${hue},48%,${light - 10}%)`); g.addColorStop(1, `hsl(${hue - 8},${kind === 'cereal' ? 45 : 60}%,${light + 12}%)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0 - wb, H); ctx.quadraticCurveTo(x0 + lean * len * 0.2, H - len * 0.55, x1, y1); ctx.quadraticCurveTo(x0 + lean * len * 0.2 + 1, H - len * 0.5, x0 + wb, H); ctx.closePath(); ctx.fill();
    }
    if (kind === 'cereal') { // barley ears with awns
      for (let i = 0; i < 14; i++) {
        const x = W * (0.25 + r() * 0.5), y = H * (0.07 + r() * 0.12), len = 44 + r() * 16, ang = (r() - 0.5) * 0.5;
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        ctx.strokeStyle = 'hsl(62,38%,48%)'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(0, len); ctx.lineTo(0, H * 0.4); ctx.stroke();
        for (let k = 0; k < 9; k++) { const yy = k * len / 9; ctx.fillStyle = `hsl(${60 + r() * 8},45%,${55 + r() * 10}%)`; ctx.beginPath(); ctx.ellipse((k % 2 ? 3 : -3), yy, 3.2, 5.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(215,205,140,0.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(k % 2 ? 3 : -3, yy); ctx.lineTo((k % 2 ? 3 : -3) + (k % 2 ? 6 : -6), yy - 48); ctx.stroke(); }
        ctx.restore();
      }
    }
  }, { key: 'card-' + kind, srgb: true });
}
export function maizeTexture() {
  return canvasTexture(256, 512, (ctx, W, H) => {
    ctx.clearRect(0, 0, W, H); const r = rng(51); const cx = W / 2;
    ctx.strokeStyle = '#6e8f3a'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(cx, H); ctx.lineTo(cx + 3, H * 0.08); ctx.stroke();
    for (let i = 0; i < 11; i++) {
      const y0 = H * (0.9 - i * 0.075), s = i % 2 ? 1 : -1, len = W * (0.42 + 0.1 * Math.sin(i * 0.7)) , droop = 60 + r() * 50;
      const g = ctx.createLinearGradient(cx, y0, cx + s * len, y0); g.addColorStop(0, '#5d8f2e'); g.addColorStop(1, '#8fbd4a');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, y0 - 5); ctx.quadraticCurveTo(cx + s * len * 0.55, y0 - 70, cx + s * len, y0 - 70 + droop); ctx.quadraticCurveTo(cx + s * len * 0.5, y0 - 48, cx, y0 + 6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(220,235,180,0.5)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx, y0); ctx.quadraticCurveTo(cx + s * len * 0.55, y0 - 62, cx + s * len * 0.98, y0 - 68 + droop); ctx.stroke();
    }
    // ear with silk
    ctx.fillStyle = '#a7c26a'; ctx.beginPath(); ctx.ellipse(cx + 12, H * 0.52, 9, 30, 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b58a4a'; ctx.lineWidth = 1; for (let k = 0; k < 8; k++) { ctx.beginPath(); ctx.moveTo(cx + 20, H * 0.47); ctx.lineTo(cx + 30 + r() * 10, H * 0.44 - r() * 18); ctx.stroke(); }
    // tassel
    ctx.strokeStyle = '#c8b073'; ctx.lineWidth = 2; for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.moveTo(cx + 3, H * 0.09); ctx.quadraticCurveTo(cx + (k - 3) * 9, H * 0.04, cx + (k - 3) * 16, H * 0.07 + r() * 10); ctx.stroke(); }
  }, { key: 'card-maize', srgb: true });
}
/** Merged card geometry for one plant; uv.y = 0 at the base so the wind shader can bend the tips. */
export function plantCards(kind) {
  const geos = []; const r = rng(kind.length * 13 + 7);
  const quad = (w, h, tiltOut, yaw, y0 = 0, off = 0) => {
    const g = new THREE.PlaneGeometry(w, h); g.translate(0, h / 2, 0);
    g.rotateX(-tiltOut); g.translate(0, y0, off); g.rotateY(yaw);
    const n = g.attributes.normal; for (let i = 0; i < n.count; i++) { n.setXYZ(i, n.getX(i) * 0.35, 0.94, n.getZ(i) * 0.35); }
    geos.push(g);
  };
  if (kind === 'lettuce') { for (let i = 0; i < 5; i++) quad(0.19, 0.2, 1.05 + r() * 0.25, i * 1.2566 + r() * 0.3, 0.0, 0.01); quad(0.12, 0.13, 0.35, 0.4, 0.02); }
  else if (kind === 'potato') { for (let i = 0; i < 7; i++) quad(0.34, 0.5, 0.55 + r() * 0.35, i * 0.8976 + r() * 0.3, 0.04, 0.02); quad(0.3, 0.42, 0.1, 0.3, 0.05); }
  else if (kind === 'grass') { for (let i = 0; i < 3; i++) quad(0.42, 0.5, 0.08, i * Math.PI / 3); }
  else if (kind === 'cereal') { for (let i = 0; i < 3; i++) quad(0.36, 0.95, 0.05, i * Math.PI / 3); }
  else { quad(1.0, 2.1, 0.02, 0); quad(1.0, 2.1, 0.02, Math.PI / 2); }
  const m = BufferGeometryUtils.mergeGeometries(geos); geos.forEach(g => g.dispose()); return m;
}
