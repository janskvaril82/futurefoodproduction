/* ==========================================================================
   pH electrode calibration — the drawn laboratory bench (2D canvas)
   A bench-top pH meter, an electrode on a stand, buffer beakers and sample cups.
   Logical coordinates 1000 × 625, scaled to the stage.
   ========================================================================== */
import { SOLUTIONS } from './model.js';
import { isDark } from '/assets/js/colors.js';

const W = 1000, H = 625, TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/* layout */
const ROW = [{ base: 468, w: 88, h: 112, dip: 450 }, { base: 584, w: 70, h: 80, dip: 568 }];
const X0 = { store: 470, rinse: 575, b4: 680, b7: 785, b10: 890, nft: 450, dwc: 540, aqua: 630, acid: 720, rain: 810, custom: 900 };
const ARM_UP = 118, ROD_X = 370, ELEC_L = 196, METER = { x: 34, y: 236, w: 282, h: 252 };
const BTN = { cal: { x: 58, y: 444, w: 72, h: 32, label: 'CAL', col: '#2f6fd6' }, read: { x: 140, y: 444, w: 72, h: 32, label: 'READ', col: '#2f9e55' }, clr: { x: 222, y: 444, w: 72, h: 32, label: 'CLEAR', col: '#6b7178' } };

const SEG = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '', 'E': 'afged', 'r': 'eg', 'o': 'cdeg', 'L': 'fed', 'O': 'abcdef' };
function seg7(ctx, str, x, y, h, on, off) {
  const w = h * 0.5, t = h * 0.13; let cx = x;
  ctx.save(); ctx.transform(1, 0, -0.07, 1, (y + h) * 0.07, 0);
  const poly = (pts, lit) => { ctx.fillStyle = lit ? on : off; ctx.beginPath(); pts.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath(); ctx.fill(); };
  const hz = (x1, x2, yc) => [[x1, yc], [x1 + t / 2, yc - t / 2], [x2 - t / 2, yc - t / 2], [x2, yc], [x2 - t / 2, yc + t / 2], [x1 + t / 2, yc + t / 2]];
  const vt = (xc, y1, y2) => [[xc, y1], [xc + t / 2, y1 + t / 2], [xc + t / 2, y2 - t / 2], [xc, y2], [xc - t / 2, y2 - t / 2], [xc - t / 2, y1 + t / 2]];
  for (const ch of str) {
    if (ch === '.') { ctx.fillStyle = on; ctx.beginPath(); ctx.arc(cx - h * 0.13, y + h, t * 0.6, 0, TAU); ctx.fill(); continue; }
    const lit = SEG[ch] ?? ''; const g = 1.2;
    const S = { a: hz(cx + g, cx + w - g, y), g: hz(cx + g, cx + w - g, y + h / 2), d: hz(cx + g, cx + w - g, y + h), f: vt(cx, y + g, y + h / 2 - g), b: vt(cx + w, y + g, y + h / 2 - g), e: vt(cx, y + h / 2 + g, y + h - g), c: vt(cx + w, y + h / 2 + g, y + h - g) };
    Object.entries(S).forEach(([k, p]) => poly(p, lit.includes(k)));
    cx += w + h * 0.24;
  }
  ctx.restore();
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

export class PhBench {
  constructor(host, { onBeaker, onButton } = {}) {
    this.host = host; this.onBeaker = onBeaker; this.onButton = onButton;
    this.cv = document.createElement('canvas'); this.cv.style.width = '100%'; this.cv.style.height = '100%'; this.cv.style.display = 'block'; this.cv.setAttribute('role', 'img'); this.cv.setAttribute('aria-label', 'Laboratory bench with a pH meter, an electrode on a stand, three buffers, a rinse beaker and six samples. Click a beaker to dip the electrode.');
    host.appendChild(this.cv); this.ctx = this.cv.getContext('2d');
    this.hover = null; this.ripples = [];
    // electrode motion: x of the holder and tip depth
    this.at = 'store'; this.from = 'store'; this.to = 'store'; this.anim = 1;
    this.ex = X0.store; this.ey = ROW[0].dip - ELEC_L;
    this.state = {};
    const ro = new ResizeObserver(() => this.resize()); ro.observe(host); this.resize();
    const pos = e => { const r = this.cv.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
    this.cv.addEventListener('pointermove', e => { const [x, y] = pos(e); this.hover = this.hitTest(x, y); this.cv.style.cursor = this.hover ? 'pointer' : ''; });
    this.cv.addEventListener('pointerleave', () => { this.hover = null; });
    this.cv.addEventListener('click', e => { const [x, y] = pos(e); const h = this.hitTest(x, y); if (!h) return; if (h.type === 'beaker') this.onBeaker && this.onBeaker(h.id); else this.onButton && this.onButton(h.id); });
  }
  resize() { const r = this.host.getBoundingClientRect(); const d = Math.min(window.devicePixelRatio || 1, 2); this.cv.width = Math.max(10, Math.round(r.width * d)); this.cv.height = Math.max(10, Math.round(r.height * d)); this.scale = this.cv.width / W; this.sy = this.cv.height / H; }
  beakerRect(id) { const S = SOLUTIONS[id], R = ROW[S.row], x = X0[id]; return { x: x - R.w / 2, y: R.base - R.h, w: R.w, h: R.h, cx: x, R }; }
  hitTest(x, y) {
    for (const [id, b] of Object.entries(BTN)) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { type: 'button', id };
    for (const id of Object.keys(SOLUTIONS)) { const r = this.beakerRect(id); if (x >= r.x - 6 && x <= r.x + r.w + 6 && y >= r.y - 20 && y <= r.y + r.h + 30) return { type: 'beaker', id }; }
    return null;
  }
  /** Start moving the electrode to a beaker; returns the duration (s). */
  moveTo(id) { if (this.anim < 1 || id === this.at) return 0; this.from = this.at; this.to = id; this.at = null; this.anim = 0; return 1.5; }
  get moving() { return this.anim < 1; }
  tipPos() { return { x: this.ex, y: this.ey + ELEC_L }; }
  update(dtReal) {
    if (this.anim < 1) {
      this.anim = Math.min(1, this.anim + dtReal / 1.5);
      const a = this.anim, A = this.beakerRect(this.from), B = this.beakerRect(this.to);
      const upY = ARM_UP;
      const dipA = A.R.dip - ELEC_L, dipB = B.R.dip - ELEC_L;
      if (a < 0.3) { const k = ease(a / 0.3); this.ex = A.cx; this.ey = lerp(dipA, upY, k); }
      else if (a < 0.7) { const k = ease((a - 0.3) / 0.4); this.ex = lerp(A.cx, B.cx, k); this.ey = upY; }
      else { const k = ease((a - 0.7) / 0.3); this.ex = B.cx; this.ey = lerp(upY, dipB, k); }
      if (this.anim >= 1) { this.at = this.to; this.ripples.push({ x: B.cx, y: B.R.base - B.R.h * 0.7, r: 4, a: 1 }); }
    }
    this.ripples.forEach(r => { r.r += dtReal * 40; r.a -= dtReal * 0.9; }); this.ripples = this.ripples.filter(r => r.a > 0);
  }
  draw(st) {
    const ctx = this.ctx, dark = isDark();
    ctx.setTransform(this.scale, 0, 0, this.sy, 0, 0);
    // wall and bench
    let g = ctx.createLinearGradient(0, 0, 0, 300);
    g.addColorStop(0, dark ? '#172024' : '#e9eeec'); g.addColorStop(1, dark ? '#1d282d' : '#dfe6e3');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 300);
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)'; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 300); ctx.stroke(); }
    for (let y = 40; y < 300; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // shelf with a bottle row (context)
    ctx.fillStyle = dark ? '#2b353a' : '#cfd6d3'; ctx.fillRect(420, 120, 560, 10);
    [['#e0474c', 'pH 4.01'], ['#3fa85a', 'pH 7.00'], ['#3a6fd8', 'pH 10.01'], ['#dfe7ea', 'KCl 3 M']].forEach(([c, t], i) => {
      const x = 460 + i * 120; ctx.fillStyle = dark ? '#dfe3e0' : '#fbfbf8'; rr(ctx, x, 38, 62, 82, 8); ctx.fill();
      ctx.fillStyle = hexA(c, 0.9); rr(ctx, x + 6, 62, 50, 34, 4); ctx.fill(); ctx.fillStyle = i === 3 ? '#39424a' : '#fff'; ctx.font = '700 11px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(t, x + 31, 83);
      ctx.fillStyle = '#3a3f44'; rr(ctx, x + 18, 24, 26, 16, 3); ctx.fill();
    });
    g = ctx.createLinearGradient(0, 300, 0, H);
    g.addColorStop(0, dark ? '#2c363b' : '#d3dad8'); g.addColorStop(0.08, dark ? '#263034' : '#e3e8e6'); g.addColorStop(1, dark ? '#1c2427' : '#c9d1ce');
    ctx.fillStyle = g; ctx.fillRect(0, 300, W, H - 300);
    ctx.fillStyle = dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.08)'; ctx.fillRect(0, 300, W, 3);
    // stand base and rod
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(ROD_X, 478, 62, 9, 0, 0, TAU); ctx.fill();
    g = ctx.createLinearGradient(ROD_X - 55, 0, ROD_X + 55, 0); g.addColorStop(0, '#2a2f34'); g.addColorStop(0.5, '#454c53'); g.addColorStop(1, '#23272b');
    ctx.fillStyle = g; rr(ctx, ROD_X - 58, 460, 116, 16, 5); ctx.fill();
    g = ctx.createLinearGradient(ROD_X - 5, 0, ROD_X + 5, 0); g.addColorStop(0, '#8e959c'); g.addColorStop(0.45, '#e7eaed'); g.addColorStop(1, '#7c838a');
    ctx.fillStyle = g; ctx.fillRect(ROD_X - 5, 70, 10, 392);
    // meter (drawn before the cable ends)
    this.drawMeter(ctx, st, dark);
    // cable from the electrode cap to the meter
    const tip = this.tipPos(), capY = this.ey - 8;
    ctx.strokeStyle = '#1c1e21'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(this.ex, capY); ctx.bezierCurveTo(this.ex - 10, capY - 70, METER.x + METER.w + 70, METER.y - 90, METER.x + METER.w - 20, METER.y + 8); ctx.stroke();
    // back-row beakers
    const inRow = this.at ? SOLUTIONS[this.at].row : (this.anim > 0.7 ? SOLUTIONS[this.to].row : -1);
    ['store', 'rinse', 'b4', 'b7', 'b10'].forEach(id => this.drawBeaker(ctx, id, st, dark, 'back'));
    // arm + electrode when it hangs in the back row or is travelling
    const inFront = inRow === 1;
    if (!inFront) { this.drawArm(ctx); this.drawElectrode(ctx, st); ['store', 'rinse', 'b4', 'b7', 'b10'].forEach(id => this.drawBeaker(ctx, id, st, dark, 'front')); }
    else ['store', 'rinse', 'b4', 'b7', 'b10'].forEach(id => this.drawBeaker(ctx, id, st, dark, 'front'));
    ['nft', 'dwc', 'aqua', 'acid', 'rain', 'custom'].forEach(id => this.drawBeaker(ctx, id, st, dark, 'back'));
    if (inFront) { this.drawArm(ctx); this.drawElectrode(ctx, st); }
    ['nft', 'dwc', 'aqua', 'acid', 'rain', 'custom'].forEach(id => this.drawBeaker(ctx, id, st, dark, 'front'));
    // ripples
    this.ripples.forEach(r => { ctx.strokeStyle = `rgba(255,255,255,${0.7 * r.a})`; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r, r.r * 0.22, 0, 0, TAU); ctx.stroke(); });
    // hint
    ctx.fillStyle = dark ? 'rgba(230,238,233,0.6)' : 'rgba(40,50,46,0.6)'; ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(this.moving ? 'moving the electrode…' : 'Click a beaker to dip the electrode.', 34, 518);
    ctx.fillText('CAL records a buffer · READ records a sample', 34, 536);
  }
  drawArm(ctx) {
    const y = this.ey - 18;
    let g = ctx.createLinearGradient(0, y - 6, 0, y + 6); g.addColorStop(0, '#dfe3e6'); g.addColorStop(1, '#868d94');
    ctx.fillStyle = g; rr(ctx, ROD_X - 12, y - 6, this.ex - ROD_X + 12, 12, 4); ctx.fill();
    ctx.fillStyle = '#2b3035'; rr(ctx, ROD_X - 16, y - 12, 32, 24, 5); ctx.fill();
    ctx.fillStyle = '#9aa2a9'; ctx.beginPath(); ctx.arc(ROD_X + 20, y, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2b3035'; rr(ctx, this.ex - 20, y - 11, 40, 22, 6); ctx.fill();
    ctx.fillStyle = '#4a5157'; rr(ctx, this.ex - 20, y - 11, 40, 7, 6); ctx.fill();
  }
  drawElectrode(ctx, st) {
    const x = this.ex, y0 = this.ey, L = ELEC_L, w = 22;
    // cap
    let g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0); g.addColorStop(0, '#15171a'); g.addColorStop(0.45, '#3b4046'); g.addColorStop(1, '#101214');
    ctx.fillStyle = g; rr(ctx, x - w / 2 - 1, y0 - 10, w + 2, 36, 5); ctx.fill();
    ctx.fillStyle = '#2f6fd6'; ctx.fillRect(x - w / 2 - 1, y0 + 18, w + 2, 4);
    // glass shaft
    const top = y0 + 26, bot = y0 + L - 16;
    g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0); g.addColorStop(0, 'rgba(210,228,236,0.75)'); g.addColorStop(0.25, 'rgba(250,253,255,0.9)'); g.addColorStop(0.6, 'rgba(214,230,238,0.55)'); g.addColorStop(1, 'rgba(170,196,208,0.8)');
    ctx.fillStyle = g; rr(ctx, x - w / 2, top, w, bot - top, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(90,120,135,0.55)'; ctx.lineWidth = 1; rr(ctx, x - w / 2, top, w, bot - top, 4); ctx.stroke();
    // reference electrolyte (KCl) and inner tube
    ctx.fillStyle = 'rgba(200,225,240,0.35)'; ctx.fillRect(x - w / 2 + 2, top + 30, w - 4, bot - top - 32);
    ctx.strokeStyle = 'rgba(80,110,125,0.6)'; ctx.beginPath(); ctx.moveTo(x - 4, top + 6); ctx.lineTo(x - 4, bot + 4); ctx.moveTo(x + 4, top + 6); ctx.lineTo(x + 4, bot + 4); ctx.stroke();
    // Ag/AgCl wires
    ctx.strokeStyle = '#9aa0a6'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot + 8); ctx.moveTo(x - 7, top); ctx.lineTo(x - 7, top + 90); ctx.stroke();
    ctx.fillStyle = '#5b5f63'; ctx.fillRect(x - 1.8, bot - 8, 3.6, 14); ctx.fillRect(x - 8.8, top + 70, 3.6, 18);
    // junction (ceramic diaphragm) and fill hole
    ctx.fillStyle = '#b58b5a'; ctx.fillRect(x + w / 2 - 3, bot - 26, 4, 7);
    ctx.fillStyle = 'rgba(40,50,56,0.6)'; ctx.beginPath(); ctx.arc(x + w / 2 - 3, top + 14, 2.6, 0, TAU); ctx.fill();
    // glass bulb
    g = ctx.createRadialGradient(x - 4, bot + 6, 1, x, bot + 8, 13);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, 'rgba(206,232,226,0.8)'); g.addColorStop(1, 'rgba(120,170,160,0.85)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, bot + 6, 9.5, 12, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(60,110,100,0.7)'; ctx.lineWidth = 1; ctx.stroke();
    // highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - w / 2 + 4, top + 8); ctx.lineTo(x - w / 2 + 4, bot - 10); ctx.stroke();
    // label
    ctx.save(); ctx.translate(x + 1, top + 58); ctx.rotate(-Math.PI / 2); ctx.fillStyle = 'rgba(30,40,46,0.8)'; ctx.font = '700 9px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('pH  0–14  ATC', 0, 3); ctx.restore();
  }
  drawBeaker(ctx, id, st, dark, layer) {
    const S = SOLUTIONS[id], r = this.beakerRect(id), R = r.R, x = r.x, y = r.y, w = r.w, h = r.h;
    const level = y + h * 0.3, col = S.color;
    const hov = this.hover && this.hover.type === 'beaker' && this.hover.id === id;
    if (layer === 'back') {
      ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.beginPath(); ctx.ellipse(r.cx, R.base + 2, w * 0.55, 7, 0, 0, TAU); ctx.fill();
      // back wall of the glass and the liquid body
      ctx.fillStyle = dark ? 'rgba(200,220,230,0.07)' : 'rgba(210,228,236,0.35)'; rr(ctx, x, y, w, h, 7); ctx.fill();
      ctx.fillStyle = hexA(col, S.kind === 'buffer' ? 0.62 : 0.5); rr(ctx, x + 3, level, w - 6, R.base - level - 3, 6); ctx.fill();
      ctx.fillStyle = hexA(col, 0.9); ctx.beginPath(); ctx.ellipse(r.cx, level, (w - 6) / 2, 4.5, 0, 0, TAU); ctx.fill();
      return;
    }
    // front: glass wall with a translucent film of liquid colour over anything inside
    ctx.fillStyle = hexA(col, S.kind === 'buffer' ? 0.2 : 0.14); rr(ctx, x + 3, level + 3, w - 6, R.base - level - 6, 6); ctx.fill();
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.45)'); g.addColorStop(0.12, 'rgba(255,255,255,0.08)'); g.addColorStop(0.85, 'rgba(255,255,255,0.04)'); g.addColorStop(1, 'rgba(255,255,255,0.35)');
    ctx.fillStyle = g; rr(ctx, x, y, w, h, 7); ctx.fill();
    ctx.strokeStyle = hov ? (dark ? '#9be7b6' : '#1d7a4a') : (dark ? 'rgba(200,220,230,0.55)' : 'rgba(90,115,125,0.55)'); ctx.lineWidth = hov ? 2.4 : 1.3; rr(ctx, x, y, w, h, 7); ctx.stroke();
    ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x - 3, y + 1); ctx.lineTo(x + 6, y + 1); ctx.stroke();
    // graduations
    ctx.strokeStyle = dark ? 'rgba(230,240,245,0.4)' : 'rgba(60,80,90,0.35)'; ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { const yy = R.base - i * h * 0.18; ctx.beginPath(); ctx.moveTo(x + w - 14, yy); ctx.lineTo(x + w - 5, yy); ctx.stroke(); }
    // sticker label
    const lw = Math.min(w - 12, 70), lx = r.cx - lw / 2, ly = y + h * 0.52;
    ctx.fillStyle = dark ? 'rgba(245,247,245,0.92)' : 'rgba(255,255,255,0.95)'; rr(ctx, lx, ly, lw, 22, 4); ctx.fill();
    ctx.fillStyle = S.kind === 'buffer' ? col : '#2a3034'; ctx.font = `700 ${S.row ? 10 : 11.5}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(S.short, r.cx, ly + 11.5); ctx.textBaseline = 'alphabetic';
    // temperature tag under the beaker
    const T = st.temps ? st.temps[id] : null;
    ctx.fillStyle = dark ? 'rgba(230,238,233,0.75)' : 'rgba(40,50,46,0.75)'; ctx.font = '600 11px JetBrains Mono, monospace';
    if (T != null) ctx.fillText(`${T.toFixed(1)} °C`, r.cx, R.base + 17);
    if (st.done && st.done[id]) { ctx.fillStyle = '#2f9e55'; ctx.beginPath(); ctx.arc(x + w - 6, y + 8, 8, 0, TAU); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + w - 10, y + 8); ctx.lineTo(x + w - 7, y + 11); ctx.lineTo(x + w - 2, y + 4); ctx.stroke(); }
  }
  drawMeter(ctx, st, dark) {
    const m = METER;
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(m.x + m.w / 2, m.y + m.h + 4, m.w * 0.55, 10, 0, 0, TAU); ctx.fill();
    let g = ctx.createLinearGradient(0, m.y, 0, m.y + m.h); g.addColorStop(0, '#f7f8f6'); g.addColorStop(1, '#d4d8d4');
    ctx.fillStyle = g; rr(ctx, m.x, m.y, m.w, m.h, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1.2; rr(ctx, m.x, m.y, m.w, m.h, 16); ctx.stroke();
    ctx.fillStyle = '#2b3035'; rr(ctx, m.x + 14, m.y + 14, m.w - 28, 150, 10); ctx.fill();
    // LCD
    const lx = m.x + 24, ly = m.y + 24, lw = m.w - 48, lh = 130;
    g = ctx.createLinearGradient(0, ly, 0, ly + lh); g.addColorStop(0, '#c3ccb3'); g.addColorStop(1, '#a9b499');
    ctx.fillStyle = g; rr(ctx, lx, ly, lw, lh, 6); ctx.fill();
    const on = '#1d2419', off = 'rgba(40,52,32,0.07)';
    const d = st.display || {};
    const main = d.main ?? '7.00', H7 = 50, glyphs = [...main].filter(c => c !== '.').length;
    const right = lx + lw - 48;
    seg7(ctx, main, right - glyphs * H7 * 0.74 + H7 * 0.24, ly + 34, H7, on, off);
    ctx.fillStyle = on; ctx.textAlign = 'left'; ctx.font = '800 19px Inter, sans-serif'; ctx.fillText(d.unit || 'pH', lx + lw - 38, ly + 82);
    ctx.font = '700 13px JetBrains Mono, monospace'; ctx.fillText(d.mv || '', lx + 10, ly + 116);
    ctx.textAlign = 'right'; ctx.fillText(d.temp || '', lx + lw - 10, ly + 116);
    ctx.textAlign = 'left'; ctx.font = '800 10.5px Inter, sans-serif'; ctx.fillText(d.mode || '', lx + 10, ly + 16);
    ctx.textAlign = 'right'; ctx.fillText(d.cal || '', lx + lw - 10, ly + 16);
    // stability indicator (top centre, like the endpoint symbol of a real meter)
    ctx.textAlign = 'left'; ctx.font = '800 11px Inter, sans-serif';
    if (d.stable) { ctx.fillStyle = on; ctx.fillText('✓ STABLE', lx + 10, ly + 34); }
    else if (d.blink) { ctx.fillStyle = on; ctx.fillText('A …', lx + 10, ly + 34); }
    // brand-free label and message line
    ctx.fillStyle = '#555c62'; ctx.font = '700 11px Inter, sans-serif'; ctx.fillText('pH / mV / °C  METER', m.x + 18, m.y + 186);
    ctx.fillStyle = '#6c7379'; ctx.font = '600 10px Inter, sans-serif'; ctx.fillText(d.msg || '', m.x + 18, m.y + 202);
    // buttons
    Object.entries(BTN).forEach(([id, b]) => {
      const hov = this.hover && this.hover.type === 'button' && this.hover.id === id;
      g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h); g.addColorStop(0, hov ? '#ffffff' : '#f1f2ef'); g.addColorStop(1, hov ? '#e2e6e2' : '#cfd4cf');
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; rr(ctx, b.x, b.y + 2, b.w, b.h, 8); ctx.fill();
      ctx.fillStyle = g; rr(ctx, b.x, b.y, b.w, b.h, 8); ctx.fill();
      ctx.fillStyle = b.col; ctx.font = '800 12px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(b.label, b.x + b.w / 2, b.y + 21);
    });
    ctx.textAlign = 'left';
    // connector socket at the back
    ctx.fillStyle = '#3a3f44'; rr(ctx, m.x + m.w - 30, m.y - 4, 18, 12, 3); ctx.fill();
  }
}
