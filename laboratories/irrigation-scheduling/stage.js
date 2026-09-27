/* Irrigation scheduling — animated soil-profile cross-section (canvas 2D).
   Sky and weather of the day, crop canopy (cover from Kc, FAO-56 eq. 76), root system growing to Zr, root-zone water
   content coloured from wilting point (dry) to field capacity (wet), rain and irrigation drops, ET arrows, deep percolation
   and a "bucket" gauge of TAW, RAW and the depletion Dr. */
import { rng } from './weather.js';

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => c1.map((v, i) => Math.round(lerp(v, c2[i], Math.max(0, Math.min(1, t)))));
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const DRY = [214, 186, 140], WET = [92, 62, 38], SUB = [150, 118, 84];

export class SoilStage {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.drops = []; this.t = 0; this.roots = null; this.soilTex = null;
    this.clouds = Array.from({ length: 5 }, (_, i) => ({ x: Math.random(), y: 0.08 + 0.12 * Math.random(), s: 0.7 + 0.6 * Math.random() }));
  }
  setup({ crop, soil, zrMax, h, dark }) {
    this.crop = crop; this.soil = soil; this.zrMax = zrMax; this.h = h; this.dark = dark;
    const r = rng(crop.length * 17 + 5);
    // pre-generate root architecture: normalised polylines (depth 0..1) per plant
    const nPlants = crop === 'wheat' ? 13 : crop === 'lettuce' ? 8 : 6;
    this.nPlants = nPlants;
    this.roots = Array.from({ length: nPlants }, () => {
      const lines = [];
      const grow = (x, y, ang, len, depth, w) => {
        const pts = [[x, y]]; let px = x, py = y, a = ang;
        const steps = 8; for (let s = 0; s < steps; s++) { a += (r() - 0.5) * 0.5; px += Math.sin(a) * len / steps; py += Math.cos(a) * len / steps; pts.push([px, py]); }
        lines.push({ pts, w });
        if (depth < 3) { const nb = 2 + Math.floor(r() * 3); for (let b = 0; b < nb; b++) { const k = 2 + Math.floor(r() * (pts.length - 3)); grow(pts[k][0], pts[k][1], a + (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.7), len * (0.35 + r() * 0.25), depth + 1, w * 0.6); } }
      };
      const nMain = crop === 'wheat' ? 5 : crop === 'potato' ? 4 : 3;
      for (let m = 0; m < nMain; m++) grow(0, 0, (m / (nMain - 1 || 1) - 0.5) * (crop === 'wheat' ? 0.5 : 0.9), 1, 1, crop === 'wheat' ? 1.1 : 1.6);
      return lines;
    });
    this.soilTex = null;
  }
  /** state: { date, dap, stage, kc, kcMax, kcMin, zr, taw, raw, dr, ks, eta, etc, et0, rain, irr, dp, theta, fc, wp, sun, sys, stageFrac, harvest } */
  draw(S, dtReal = 0) {
    const cv = this.cv, ctx = this.ctx, dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); this.soilTex = null; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.t += dtReal;
    const GW = Math.min(170, W * 0.22), SW = W - GW;       // scene width, gauge width
    const y0 = Math.round(H * 0.4), dMax = Math.max(1.4, this.zrMax * 1.3), ppm = (H - y0 - 22) / dMax;
    // ---------- sky
    const cloud = Math.max(0, Math.min(1, 1 - (S.sun ?? 0.6) + (S.rain > 0.5 ? 0.35 : 0)));
    const g = ctx.createLinearGradient(0, 0, 0, y0);
    g.addColorStop(0, rgb(mix([74, 144, 226], [128, 138, 150], cloud))); g.addColorStop(1, rgb(mix([206, 232, 250], [206, 212, 218], cloud)));
    ctx.fillStyle = g; ctx.fillRect(0, 0, SW, y0);
    // sun
    const sunA = Math.max(0.15, 1 - cloud);
    const sx = SW * 0.84, sy = y0 * 0.22; const sg = ctx.createRadialGradient(sx, sy, 2, sx, sy, 60);
    sg.addColorStop(0, `rgba(255,248,220,${sunA})`); sg.addColorStop(0.25, `rgba(255,236,170,${0.8 * sunA})`); sg.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, 60, 0, Math.PI * 2); ctx.fill();
    // clouds
    this.clouds.forEach((c, i) => {
      const x = ((c.x + this.t * 0.006 * (0.6 + i * 0.15)) % 1.2 - 0.1) * SW, y = c.y * y0 * 2 + 6, s = c.s * (30 + 30 * cloud);
      ctx.fillStyle = rgba(mix([255, 255, 255], [150, 158, 168], cloud * 0.9), 0.25 + 0.7 * cloud);
      [[0, 0, 1], [0.8, 0.15, 0.8], [-0.8, 0.2, 0.75], [0.3, -0.35, 0.8]].forEach(([dx, dy, k]) => { ctx.beginPath(); ctx.ellipse(x + dx * s, y + dy * s, s * k, s * k * 0.62, 0, 0, Math.PI * 2); ctx.fill(); });
    });
    // ---------- soil profile
    const s = Math.max(0, Math.min(1, (S.theta - S.wp) / (S.fc - S.wp)));
    const rootCol = mix(DRY, WET, s), subCol = mix(SUB, WET, 0.72);
    const zrPx = S.zr * ppm;
    const sg2 = ctx.createLinearGradient(0, y0, 0, y0 + zrPx);
    sg2.addColorStop(0, rgb(mix(rootCol, [60, 40, 25], 0.12))); sg2.addColorStop(1, rgb(rootCol));
    ctx.fillStyle = sg2; ctx.fillRect(0, y0, SW, zrPx);
    ctx.fillStyle = rgb(subCol); ctx.fillRect(0, y0 + zrPx, SW, H - y0 - zrPx);
    // soil texture (grains, stones)
    if (!this.soilTex) {
      const tc = document.createElement('canvas'); tc.width = Math.max(1, Math.round(SW * dpr)); tc.height = Math.max(1, Math.round((H - y0) * dpr));
      const tx = tc.getContext('2d'); tx.scale(dpr, dpr); const r = rng(9);
      for (let i = 0; i < SW * (H - y0) / 55; i++) { const a = r(); tx.fillStyle = a < 0.5 ? `rgba(0,0,0,${0.04 + 0.08 * r()})` : `rgba(255,255,255,${0.03 + 0.06 * r()})`; const w = 1 + r() * 2.5; tx.fillRect(r() * SW, r() * (H - y0), w, w * (0.6 + r() * 0.6)); }
      for (let i = 0; i < SW * (H - y0) / 5000; i++) { tx.fillStyle = `rgba(120,110,100,${0.25 + 0.3 * r()})`; tx.beginPath(); tx.ellipse(r() * SW, r() * (H - y0), 3 + r() * 6, 2 + r() * 4, r() * 3, 0, Math.PI * 2); tx.fill(); }
      this.soilTex = tc;
    }
    ctx.drawImage(this.soilTex, 0, y0, SW, H - y0);
    // deep percolation below the root zone
    if (S.dp > 0.2) {
      ctx.strokeStyle = 'rgba(80,160,230,0.85)'; ctx.lineWidth = 2;
      const n = Math.min(14, 3 + Math.round(S.dp)); for (let i = 0; i < n; i++) { const x = (i + 0.5) * SW / n, ph = (this.t * 40 + i * 23) % 50; const yy = y0 + zrPx + 8 + ph; if (yy > H - 8) continue; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x, yy + 12); ctx.lineTo(x - 4, yy + 7); ctx.moveTo(x, yy + 12); ctx.lineTo(x + 4, yy + 7); ctx.stroke(); }
      ctx.fillStyle = 'rgba(20,60,110,0.85)'; ctx.font = '600 11.5px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`deep percolation ${S.dp.toFixed(1)} mm`, 10, Math.min(H - 8, y0 + zrPx + 22));
    }
    // ---------- plants and roots
    const kcMin = 0.15, kcMax = S.kcMax + 0.05;
    const fc = Math.max(0.02, Math.min(1, Math.pow(Math.max(0, (S.kc - kcMin) / (kcMax - kcMin)), 1 + 0.5 * this.h)));   // FAO-56 eq. 76
    const growth = S.stage === 0 ? Math.min(1, S.stageFrac * 0.6 + 0.15) : Math.min(1, 0.2 + 0.8 * Math.sqrt(fc));
    const senesce = S.stage === 3 ? S.stageFrac * (this.crop === 'wheat' ? 1 : this.crop === 'potato' ? 0.8 : 0.2) : 0;
    const wilt = 1 - S.ks;
    const leafC = mix(mix([62, 142, 52], [196, 172, 72], senesce), [128, 132, 80], wilt * 0.7);
    const leafD = mix(mix([34, 102, 36], [150, 118, 50], senesce), [96, 98, 60], wilt * 0.7);
    this.plantTop = 0;
    for (let p = 0; p < this.nPlants; p++) {
      const x = (p + 0.5) * SW / this.nPlants;
      // roots
      ctx.save(); ctx.translate(x, y0); ctx.strokeStyle = 'rgba(246,238,215,0.92)'; ctx.lineCap = 'round';
      const sc = zrPx, sx2 = SW / this.nPlants * (this.crop === 'wheat' ? 0.6 : 0.9);
      this.roots[p].forEach(l => { ctx.lineWidth = l.w; ctx.beginPath(); l.pts.forEach(([px, py], k) => { const X = px * sx2 * 0.5, Y = py * sc; k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke(); });
      ctx.restore();
      this.drawPlant(ctx, x, y0, growth, fc, leafC, leafD, wilt, SW / this.nPlants, p);
    }
    // ET arrows
    if (S.eta > 0.05) {
      const n = 5, len = 12 + 11 * S.eta;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
      for (let i = 0; i < n; i++) {
        const x = (i + 0.7) * SW / (n + 0.4), yb = y0 - 16 - this.plantTop, ph = (this.t * 0.8 + i * 0.37) % 1;
        ctx.globalAlpha = 0.25 + 0.75 * Math.sin(Math.PI * ph);
        ctx.beginPath(); for (let k = 0; k <= 12; k++) { const yy = yb - ph * 20 - k / 12 * len; const xx = x + Math.sin(k * 0.9 + this.t * 3) * 3; k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); } ctx.stroke();
        const yt = yb - ph * 20 - len; ctx.beginPath(); ctx.moveTo(x - 5, yt + 6); ctx.lineTo(x, yt); ctx.lineTo(x + 5, yt + 6); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // rain and irrigation drops
    this.updateDrops(S, SW, y0, dtReal);
    ctx.lineCap = 'round';
    this.drops.forEach(d => { ctx.strokeStyle = d.irr ? 'rgba(170,215,255,0.95)' : 'rgba(210,230,255,0.9)'; ctx.lineWidth = d.irr ? 1.8 : 1.3; ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.vx * 0.02, d.y + d.vy * 0.02); ctx.stroke(); });
    if (S.irr > 0) this.drawIrrigator(ctx, S, SW, y0);
    // ground line & root-zone boundary
    ctx.strokeStyle = 'rgba(40,30,20,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(SW, y0); ctx.stroke();
    ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, y0 + zrPx); ctx.lineTo(SW, y0 + zrPx); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(15,20,18,0.72)'; const lab = `root zone Zr = ${S.zr.toFixed(2)} m · θ = ${S.theta.toFixed(3)} m³ m⁻³`; ctx.font = '600 11.5px Inter, sans-serif';
    const lw = ctx.measureText(lab).width + 14; ctx.fillRect(8, y0 + zrPx - 22, lw, 18); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(lab, 15, y0 + zrPx - 13);
    // depth scale
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = "500 10.5px 'JetBrains Mono', monospace"; ctx.textAlign = 'right';
    for (let d = 0.25; d < dMax; d += 0.25) { const y = y0 + d * ppm; ctx.fillRect(SW - 10, y, 8, 1); if (Math.abs(d * 4 - Math.round(d * 4)) < 1e-6 && Math.round(d * 100) % 50 === 0) ctx.fillText(`${d.toFixed(1)} m`, SW - 14, y + 1); }
    // ---------- gauge (bucket)
    this.drawGauge(ctx, S, SW, GW, H);
  }
  drawPlant(ctx, x, y0, growth, fc, c1, c2, wilt, slot, idx) {
    const h = this.h * 170 * growth, droop = wilt * 0.8;
    this.plantTop = Math.max(this.plantTop || 0, h * 0.5);
    ctx.save(); ctx.translate(x, y0);
    if (this.crop === 'wheat') {
      const n = 7 + Math.round(6 * growth);
      for (let i = 0; i < n; i++) {
        const a = (i / (n - 1) - 0.5) * (0.5 + 0.3 * fc), L = h * (0.75 + 0.25 * Math.sin(i * 1.7 + idx));
        ctx.strokeStyle = rgb(i % 2 ? c1 : c2); ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(Math.sin(a) * L * 0.5, -L * 0.6, Math.sin(a + droop * Math.sign(a || 1)) * L * 0.8, -L * (1 - droop * 0.35)); ctx.stroke();
        if (growth > 0.85 && i % 2 === 0) { ctx.fillStyle = rgb(c1); ctx.beginPath(); ctx.ellipse(Math.sin(a) * L * 0.8, -L * (1 - droop * 0.35) - 6, 3, 9, a, 0, Math.PI * 2); ctx.fill(); }
      }
    } else if (this.crop === 'potato') {
      const R = Math.max(6, slot * 0.46 * Math.sqrt(fc) + 4), hh = Math.max(8, h * 0.8);
      ctx.strokeStyle = rgb(c2); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -hh * 0.6); ctx.stroke();
      for (let k = 0; k < 9; k++) { const a = (k / 8) * Math.PI, rx = Math.cos(a) * R * 0.9, ry = -hh * 0.5 - Math.sin(a) * hh * 0.5 + droop * 8; ctx.fillStyle = rgb(k % 2 ? c1 : c2); ctx.beginPath(); ctx.ellipse(rx, ry, R * 0.42, R * 0.3 * (1 - droop * 0.3), a - Math.PI / 2 + droop, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = rgb(c1); ctx.beginPath(); ctx.ellipse(0, -hh * 0.92 + droop * 8, R * 0.5, R * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      // tubers
      if (growth > 0.5) { ctx.fillStyle = 'rgba(214,186,120,0.95)'; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse((k - 1.5) * 9, 16 + (k % 2) * 8, 6 * growth, 4.5 * growth, 0.3, 0, Math.PI * 2); ctx.fill(); } }
    } else {
      const R = Math.max(5, slot * 0.36 * Math.sqrt(fc) + 3);
      for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; ctx.fillStyle = rgb(k % 2 ? c1 : c2); ctx.beginPath(); ctx.ellipse(Math.cos(a) * R * 0.55, -R * 0.35 - Math.abs(Math.sin(a)) * R * 0.25 + droop * 5, R * 0.55, R * 0.28, a * 0.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = rgb(mix(c1, [220, 240, 160], 0.3)); ctx.beginPath(); ctx.ellipse(0, -R * 0.6, R * 0.35, R * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  updateDrops(S, SW, y0, dt) {
    const rainRate = S.rain > 0.1 ? Math.min(260, 12 + S.rain * 9) : 0, irrRate = S.irr > 0 && S.sys !== 'drip' && S.sys !== 'surface' ? Math.min(220, 30 + S.irr * 6) : 0;
    const acc = (this._acc || 0) + (rainRate + irrRate) * Math.min(dt, 0.1) * 3; let n = Math.floor(acc); this._acc = acc - n;
    while (n-- > 0 && this.drops.length < 500) {
      if (Math.random() * (rainRate + irrRate) < rainRate) this.drops.push({ x: Math.random() * SW, y: -10, vx: -30, vy: 520 + Math.random() * 120, irr: false });
      else { const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.6; const v = 260 + Math.random() * 120; this.drops.push({ x: SW * 0.06, y: y0 - 70, vx: Math.cos(ang + Math.PI / 2) * v * 0.9 + 120, vy: -Math.abs(Math.sin(ang)) * v * 0.5, irr: true, g: 1 }); }
    }
    this.drops.forEach(d => { if (d.g) d.vy += 700 * Math.min(dt, 0.05); d.x += d.vx * Math.min(dt, 0.05); d.y += d.vy * Math.min(dt, 0.05); });
    this.drops = this.drops.filter(d => d.y < y0 && d.x > -20 && d.x < SW + 20);
  }
  drawIrrigator(ctx, S, SW, y0) {
    if (S.sys === 'drip') {
      ctx.strokeStyle = '#1f2326'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, y0 - 3); ctx.lineTo(SW, y0 - 3); ctx.stroke();
      for (let p = 0; p < this.nPlants; p++) { const x = (p + 0.5) * SW / this.nPlants + 10, ph = (this.t * 1.5 + p * 0.3) % 1; ctx.fillStyle = 'rgba(110,180,255,0.95)'; ctx.beginPath(); ctx.arc(x, y0 - 1 + ph * 6, 2.4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(90,150,220,0.35)'; ctx.beginPath(); ctx.ellipse(x, y0 + 12, 14, 10, 0, 0, Math.PI * 2); ctx.fill(); }
    } else if (S.sys === 'surface') {
      ctx.fillStyle = 'rgba(80,150,210,0.55)'; ctx.fillRect(0, y0 - 4, SW, 6);
    } else {
      ctx.fillStyle = '#6d747a'; ctx.fillRect(SW * 0.06 - 2, y0 - 70, 4, 70); ctx.fillStyle = '#2b3136'; ctx.fillRect(SW * 0.06 - 6, y0 - 74, 12, 6);
    }
    ctx.font = '600 11.5px Inter, sans-serif'; const t = `irrigation ${S.irr.toFixed(0)} mm net (${(S.irr / S.ea).toFixed(0)} mm gross)`; const w = ctx.measureText(t).width + 14;
    ctx.fillStyle = 'rgba(160,40,120,0.85)'; ctx.fillRect(SW - w - 12, 12, w, 20); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(t, SW - w - 5, 22);
  }
  drawGauge(ctx, S, SW, GW, H) {
    const x0 = SW, P = this.dark;
    ctx.fillStyle = P ? '#121a17' : '#f4f6f3'; ctx.fillRect(x0, 0, GW, H);
    ctx.strokeStyle = P ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.moveTo(x0 + 0.5, 0); ctx.lineTo(x0 + 0.5, H); ctx.stroke();
    const ink = P ? '#e6eee9' : '#1c2420', muted = P ? '#9fb0a8' : '#5d6b64';
    ctx.fillStyle = ink; ctx.font = '650 12.5px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('Root-zone bucket', x0 + GW / 2, 58);
    const bx = x0 + GW * 0.3, bw = GW * 0.4, top = 84, bot = H - 118, bh = bot - top;
    const tawMax = Math.max(S.tawMax || S.taw, 1), hT = bh * S.taw / tawMax;
    const yT = bot - hT;                                   // top of available water (field capacity)
    ctx.fillStyle = P ? '#1d2824' : '#e7ebe6'; ctx.fillRect(bx, top, bw, bh);
    const water = Math.max(0, S.taw - S.dr), yW = bot - hT * water / S.taw;
    const wg = ctx.createLinearGradient(0, yW, 0, bot); wg.addColorStop(0, '#5cb3ef'); wg.addColorStop(1, '#1f6fae');
    ctx.fillStyle = wg; ctx.fillRect(bx, yW, bw, bot - yW);
    ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.strokeRect(bx, yT, bw, hT);
    // RAW threshold
    const yR = yT + hT * S.raw / S.taw;
    ctx.strokeStyle = '#e0962c'; ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx - 8, yR); ctx.lineTo(bx + bw + 8, yR); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '600 10.5px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#c47a14';
    ctx.fillText('RAW', bx + bw + 10, yR);
    ctx.fillStyle = muted; ctx.fillText('FC', bx + bw + 10, yT); ctx.fillText('WP', bx + bw + 10, bot);
    ctx.textAlign = 'right'; ctx.fillStyle = ink; ctx.fillText(`${S.dr.toFixed(0)} mm`, bx - 6, (yT + yW) / 2 + (yW - yT < 14 ? -8 : 0));
    ctx.font = "500 10.5px 'JetBrains Mono', monospace"; ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const lines = [`TAW ${S.taw.toFixed(0)} mm`, `RAW ${S.raw.toFixed(0)} mm (p ${S.p.toFixed(2)})`, `Dr ${S.dr.toFixed(0)} mm`, `Ks ${S.ks.toFixed(2)}`];
    lines.forEach((t, i) => { ctx.fillStyle = i === 3 && S.ks < 0.999 ? '#d0493a' : i === 2 ? ink : muted; ctx.fillText(t, x0 + GW / 2, bot + 8 + i * 14); });
    ctx.save(); ctx.translate(bx - 30, (top + bot) / 2); ctx.rotate(-Math.PI / 2); ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.font = '500 10.5px Inter, sans-serif'; ctx.fillText('depletion Dr ↓', 0, 0); ctx.restore();
  }
}
