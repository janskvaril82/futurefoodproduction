/* ==========================================================================
   plot.js — lightweight, theme-aware scientific plotting for the course
   ES module:  import { Plot, BarChart, Sankey } from '/assets/js/plot.js'

   const p = new Plot(el, {
     x: { label: 'PPFD', unit: 'µmol m⁻² s⁻¹', min: 0, max: 1500 },   // min/max number | 'auto'
     y: { label: 'A', unit: 'µmol m⁻² s⁻¹', min: 'auto', max: 'auto', log: false },
     y2: { label: 'T', unit: '°C' },            // optional right axis
     legend: true, crosshair: true, height: 260
   });
   p.line(id, xs, ys, opts) | p.line(id, [[x,y],…], opts)
       opts: { color, width, dash:[4,4], label, fill:true|number(alpha), y2:true, step:false, opacity }
   p.scatter(id, xs, ys | pts, { color, r, label, shape:'circle'|'square'|'triangle'|'diamond', yErr:[…], y2 })
   p.band(id, xs, lower, upper, { color, alpha, label })
   p.vline(id, x, { color, label, dash }); p.hline(id, y, {…})
   p.region(id, x0, x1, { color, alpha, label }); p.hregion(id, y0, y1, {…})
   p.point(id, x, y, { color, r, label });  p.text(id, x, y, 'text', { color, align, size })
   p.heatmap(id, { z:[[…]], x0, x1, y0, y1, colormap:'viridis', min, max })
   p.custom(id, (ctx, plot) => { … plot.px(x), plot.py(y) … })
   p.remove(id); p.clear(); p.setAxis('x', {min,max}); p.on('pointermove', e => e.x, e.y …)
   ========================================================================== */
import { palette, resolveColor, withAlpha, colormap } from './colors.js';

const DPR = () => Math.min(window.devicePixelRatio || 1, 2.5);
const FONT = (sz, w = 500) => `${w} ${sz}px Inter, system-ui, sans-serif`;
const MONO = sz => `500 ${sz}px 'JetBrains Mono', ui-monospace, monospace`;

/* ------------------------------------------------------ number helpers */
export function niceNum(range, round) {
  const exp = Math.floor(Math.log10(range));
  const f = range / Math.pow(10, exp);
  let nf;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * Math.pow(10, exp);
}
export function niceTicks(min, max, n = 6) {
  if (!isFinite(min) || !isFinite(max)) return [];
  if (min === max) { min -= 1; max += 1; }
  const range = niceNum(max - min, false);
  let step = niceNum(range / (n - 1), true);
  const gen = st => { const t0 = Math.ceil(min / st - 1e-9) * st, o = []; for (let v = t0; v <= max + st * 1e-6; v += st) o.push(Math.abs(v) < st * 1e-9 ? 0 : +v.toPrecision(12)); return o; };
  let out = gen(step);
  // narrow plots can end up with a single tick: refine the step until at least two ticks exist
  for (let k = 0; k < 4 && out.length < 2; k++) { step /= (k % 2 ? 2.5 : 2); out = gen(step); }
  return out;
}
export function fmtTick(v, step) {
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) {
    const e = Math.floor(Math.log10(a)); const m = v / Math.pow(10, e);
    return (Math.abs(m - Math.round(m)) < 1e-9 ? Math.round(m) : m.toFixed(1)) + 'e' + e;
  }
  const d = step ? Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9))) : 2;
  return v.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d > 0 && step < 1 ? d : 0 });
}
function arr2(xs, ys) {
  if (ys === undefined || (ys && !Array.isArray(ys) && !(ys instanceof Float64Array) && !(ys instanceof Float32Array) && typeof ys === 'object')) {
    // (pts, opts) signature
    return { xs: xs.map(p => p[0]), ys: xs.map(p => p[1]), opts: ys || {} };
  }
  return { xs: Array.from(xs), ys: Array.from(ys), opts: null };
}

/* ================================================================ Plot */
export class Plot {
  constructor(container, opts = {}) {
    this.el = typeof container === 'string' ? document.querySelector(container) : container;
    this.opts = Object.assign({ legend: true, crosshair: true, padding: null }, opts);
    this.ax = {
      x: Object.assign({ min: 'auto', max: 'auto', label: '', unit: '', log: false }, opts.x || {}),
      y: Object.assign({ min: 'auto', max: 'auto', label: '', unit: '', log: false }, opts.y || {}),
      y2: opts.y2 ? Object.assign({ min: 'auto', max: 'auto', label: '', unit: '', log: false }, opts.y2) : null
    };
    this.items = new Map();
    this.hidden = new Set();
    this.handlers = {};
    this.el.innerHTML = '';
    this.el.classList.add('plot-host');
    if (this.opts.legend) { this.legendEl = document.createElement('div'); this.legendEl.className = 'plot-legend'; this.el.appendChild(this.legendEl); }
    this.box = document.createElement('div'); this.box.className = 'plot';
    const legendH = this.legendEl ? 22 : 0, avail = this.el.clientHeight;
    let h = this.opts.height || (avail > 60 ? avail - legendH : 260);
    if (this.opts.height && avail > 60 && this.opts.height + legendH > avail) h = avail - legendH; // keep legend + plot inside a fixed-height container
    this._fit = (avail > 60 && (!this.opts.height || this.opts.height + legendH > avail)) ? avail : 0; // re-fit when the legend wraps
    this.box.style.height = h + 'px';
    this.el.appendChild(this.box);
    this.canvas = document.createElement('canvas'); this.box.appendChild(this.canvas);
    this.tip = document.createElement('div'); this.tip.className = 'plot-tip'; this.box.appendChild(this.tip);
    this.ctx = this.canvas.getContext('2d');
    this._queued = false;
    this.ro = new ResizeObserver(() => this.redraw());
    this.ro.observe(this.box);
    document.addEventListener('ffp:theme', () => this.redraw());
    this._bindPointer();
    this.redraw();
  }

  /* ---------- series API ---------- */
  _add(id, item) { item.id = id; if (!this.items.has(id)) item._order = this.items.size; else item._order = this.items.get(id)._order; this.items.set(id, item); this.redraw(); if (item.label) this._legend(); return this; }
  line(id, xs, ys, opts) { const a = arr2(xs, ys); return this._add(id, Object.assign({ type: 'line', xs: a.xs, ys: a.ys, width: 2 }, a.opts || opts || {})); }
  scatter(id, xs, ys, opts) { const a = arr2(xs, ys); return this._add(id, Object.assign({ type: 'scatter', xs: a.xs, ys: a.ys, r: 3.5 }, a.opts || opts || {})); }
  band(id, xs, lo, hi, opts = {}) { return this._add(id, Object.assign({ type: 'band', xs: Array.from(xs), lo: Array.from(lo), hi: Array.from(hi), alpha: 0.18 }, opts)); }
  vline(id, x, opts = {}) { return this._add(id, Object.assign({ type: 'vline', x, anno: true }, opts)); }
  hline(id, y, opts = {}) { return this._add(id, Object.assign({ type: 'hline', y, anno: true }, opts)); }
  region(id, x0, x1, opts = {}) { return this._add(id, Object.assign({ type: 'region', x0, x1, alpha: 0.1, anno: true }, opts)); }
  hregion(id, y0, y1, opts = {}) { return this._add(id, Object.assign({ type: 'hregion', y0, y1, alpha: 0.1, anno: true }, opts)); }
  point(id, x, y, opts = {}) { return this._add(id, Object.assign({ type: 'point', x, y, r: 5, anno: true }, opts)); }
  text(id, x, y, text, opts = {}) { return this._add(id, Object.assign({ type: 'text', x, y, text, anno: true }, opts)); }
  heatmap(id, opts) { return this._add(id, Object.assign({ type: 'heatmap', colormap: 'viridis' }, opts)); }
  custom(id, fn, opts = {}) { return this._add(id, Object.assign({ type: 'custom', fn, anno: true }, opts)); }
  remove(id) { this.items.delete(id); this._legend(); this.redraw(); return this; }
  clear() { this.items.clear(); this._legend(); this.redraw(); return this; }
  has(id) { return this.items.has(id); }
  setAxis(which, o) { Object.assign(this.ax[which], o); this.redraw(); return this; }
  on(evt, cb) { (this.handlers[evt] = this.handlers[evt] || []).push(cb); return this; }
  destroy() { this.ro.disconnect(); this.el.innerHTML = ''; }

  /* ---------- coordinate transforms (valid after a draw) ---------- */
  px(x) { const a = this.ax.x; const t = a.log ? (Math.log10(x) - Math.log10(this._x0)) / (Math.log10(this._x1) - Math.log10(this._x0)) : (x - this._x0) / (this._x1 - this._x0); return this._L + t * this._W; }
  py(y, right) { const a = right ? this.ax.y2 : this.ax.y; const y0 = right ? this._y20 : this._y0, y1 = right ? this._y21 : this._y1; const t = a.log ? (Math.log10(y) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0)) : (y - y0) / (y1 - y0); return this._T + (a.reverse ? t : 1 - t) * this._H; } // y: { reverse: true } plots downwards (e.g. soil-water depletion)
  xFromPx(px) { const t = (px - this._L) / this._W; return this.ax.x.log ? Math.pow(10, Math.log10(this._x0) + t * (Math.log10(this._x1) - Math.log10(this._x0))) : this._x0 + t * (this._x1 - this._x0); }
  yFromPx(py, right) { const rv = ((right ? this.ax.y2 : this.ax.y) || {}).reverse; const t = rv ? (py - this._T) / this._H : 1 - (py - this._T) / this._H; const y0 = right ? this._y20 : this._y0, y1 = right ? this._y21 : this._y1; const lg = right ? this.ax.y2.log : this.ax.y.log; return lg ? Math.pow(10, Math.log10(y0) + t * (Math.log10(y1) - Math.log10(y0))) : y0 + t * (y1 - y0); }
  get plotRect() { return { left: this._L, top: this._T, width: this._W, height: this._H }; }

  redraw() {
    if (this._queued) return;
    this._queued = true;
    requestAnimationFrame(() => { this._queued = false; this._draw(); });
  }
  drawNow() { this._draw(); }

  _legend() {
    if (!this.legendEl) return;
    const items = [...this.items.values()].filter(it => it.label && !it.noLegend && (!it.anno || it.legend)).sort((a, b) => a._order - b._order);
    this.legendEl.innerHTML = items.map(it => {
      const c = resolveColor(it.color, it._order);
      const dot = it.type === 'scatter' || it.type === 'point';
      const style = it.dash ? `background:repeating-linear-gradient(90deg,${c} 0 4px,transparent 4px 7px)` : `background:${c}`;
      return `<span data-id="${it.id}" class="${this.hidden.has(it.id) ? 'off' : ''}"><i class="${dot ? 'dot' : ''}" style="${style}"></i>${it.label}</span>`;
    }).join('');
    this.legendEl.querySelectorAll('span').forEach(s => s.addEventListener('click', () => {
      const id = s.dataset.id; if (this.hidden.has(id)) this.hidden.delete(id); else this.hidden.add(id);
      this._legend(); this.redraw();
    }));
    this.legendEl.style.display = items.length ? '' : 'none';
    if (this._fit) { const lh = items.length ? this.legendEl.offsetHeight || 0 : 0; this.box.style.height = Math.max(100, this._fit - lh - 2) + 'px'; }
  }

  _domain() {
    const acc = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], y2: [Infinity, -Infinity] };
    const push = (k, v) => { if (isFinite(v)) { if (k !== 'x' && this.ax[k === 'y2' ? 'y2' : 'y'] && this.ax[k === 'y2' ? 'y2' : 'y'].log && v <= 0) return; if (k === 'x' && this.ax.x.log && v <= 0) return; acc[k][0] = Math.min(acc[k][0], v); acc[k][1] = Math.max(acc[k][1], v); } };
    for (const it of this.items.values()) {
      if (this.hidden.has(it.id)) continue;
      const yk = it.y2 ? 'y2' : 'y';
      if (it.type === 'line' || it.type === 'scatter') {
        for (let i = 0; i < it.xs.length; i++) {
          if (!isFinite(it.ys[i])) continue;
          push('x', it.xs[i]);
          if (it.yErr) { push(yk, it.ys[i] - it.yErr[i]); push(yk, it.ys[i] + it.yErr[i]); } else push(yk, it.ys[i]);
        }
      } else if (it.type === 'band') { it.xs.forEach((x, i) => { push('x', x); push(yk, it.lo[i]); push(yk, it.hi[i]); }); }
      else if (it.type === 'heatmap') { push('x', it.x0); push('x', it.x1); push('y', it.y0); push('y', it.y1); }
      else if (it.type === 'point' && it.includeInDomain !== false) { push('x', it.x); push(yk, it.y); }
      else if (it.type === 'hline' && it.includeInDomain) push(yk, it.y);
    }
    const resolve = (k, a) => {
      let [lo, hi] = acc[k];
      if (!isFinite(lo)) { lo = a.log ? 1 : 0; hi = a.log ? 10 : 1; }
      if (a.log) {
        let L = a.min !== 'auto' && a.min != null ? a.min : Math.pow(10, Math.floor(Math.log10(lo)));
        let H = a.max !== 'auto' && a.max != null ? a.max : Math.pow(10, Math.ceil(Math.log10(hi)));
        if (H <= L) H = L * 10;
        return [L, H];
      }
      if (lo === hi) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
      let L = a.min !== 'auto' && a.min != null ? a.min : null, H = a.max !== 'auto' && a.max != null ? a.max : null;
      if (L == null || H == null) {
        const pad = k === 'x' ? 0 : (hi - lo) * 0.06;
        if (L == null) { L = lo - pad; if (lo >= 0 && L < 0 && a.zero !== false) L = 0; }
        if (H == null) H = hi + pad;
        if (k !== 'x' && a.nice !== false) { const t = niceTicks(L, H, 6); const st = t.length > 1 ? t[1] - t[0] : 1; if (a.min === 'auto' || a.min == null) L = Math.floor(L / st + 1e-9) * st; if (a.max === 'auto' || a.max == null) H = Math.ceil(H / st - 1e-9) * st; }
      }
      if (H <= L) H = L + 1;
      return [L, H];
    };
    [this._x0, this._x1] = resolve('x', this.ax.x);
    [this._y0, this._y1] = resolve('y', this.ax.y);
    if (this.ax.y2) [this._y20, this._y21] = resolve('y2', this.ax.y2);
  }

  _draw() {
    const w = this.box.clientWidth, h = this.box.clientHeight;
    if (!w || !h) return;
    const d = DPR();
    if (this.canvas.width !== Math.round(w * d) || this.canvas.height !== Math.round(h * d)) { this.canvas.width = Math.round(w * d); this.canvas.height = Math.round(h * d); }
    const ctx = this.ctx; ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h);
    const P = palette();
    this._domain();
    const pad = this.opts.padding || {};
    this._L = pad.left != null ? pad.left : 58; this._R = pad.right != null ? pad.right : (this.ax.y2 ? 58 : 16);
    this._T = pad.top != null ? pad.top : 12; this._B = pad.bottom != null ? pad.bottom : 44;
    this._W = w - this._L - this._R; this._H = h - this._T - this._B;
    if (this._W < 20 || this._H < 20) return;

    // ticks
    const xa = this.ax.x, ya = this.ax.y, y2a = this.ax.y2;
    const xt = xa.log ? logTicks(this._x0, this._x1) : niceTicks(this._x0, this._x1, Math.max(3, Math.min(9, Math.floor(this._W / 80))));
    const yt = ya.log ? logTicks(this._y0, this._y1) : niceTicks(this._y0, this._y1, Math.max(3, Math.min(8, Math.floor(this._H / 45))));
    const xs = xt.length > 1 ? xt[1] - xt[0] : 1, ys = yt.length > 1 ? yt[1] - yt[0] : 1;
    // y label width adaption
    ctx.font = MONO(10.5);
    const yLabW = Math.max(...yt.map(v => ctx.measureText(ya.format ? ya.format(v) : fmtTick(v, ys)).width), 10);
    if (pad.left == null && yLabW + 30 > this._L) { this._L = yLabW + 30; this._W = w - this._L - this._R; }

    // grid
    ctx.lineWidth = 1; ctx.strokeStyle = withAlpha(P.line.startsWith('#') ? P.line : '#888888', 0.9);
    ctx.beginPath();
    xt.forEach(v => { if (v < this._x0 || v > this._x1) return; const X = Math.round(this.px(v)) + 0.5; ctx.moveTo(X, this._T); ctx.lineTo(X, this._T + this._H); });
    yt.forEach(v => { if (v < this._y0 || v > this._y1) return; const Y = Math.round(this.py(v)) + 0.5; ctx.moveTo(this._L, Y); ctx.lineTo(this._L + this._W, Y); });
    ctx.stroke();

    // clip area
    ctx.save(); ctx.beginPath(); ctx.rect(this._L, this._T, this._W, this._H); ctx.clip();
    const order = [...this.items.values()].sort((a, b) => (a.z || 0) - (b.z || 0) || a._order - b._order);
    // background items first
    for (const it of order) if (!this.hidden.has(it.id) && (it.type === 'heatmap' || it.type === 'region' || it.type === 'hregion' || it.type === 'band')) this._drawItem(ctx, it, P);
    for (const it of order) if (!this.hidden.has(it.id) && !it.noClip && !(it.type === 'heatmap' || it.type === 'region' || it.type === 'hregion' || it.type === 'band' || it.type === 'text' || it.type === 'point')) this._drawItem(ctx, it, P);
    ctx.restore();
    for (const it of order) if (!this.hidden.has(it.id) && (it.type === 'point' || it.type === 'text' || (it.noClip && it.type === 'custom'))) this._drawItem(ctx, it, P);

    // axes frame
    ctx.strokeStyle = P.lineStrong || P.muted; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(this._L + .5, this._T); ctx.lineTo(this._L + .5, this._T + this._H + .5); ctx.lineTo(this._L + this._W, this._T + this._H + .5);
    if (y2a) { ctx.moveTo(this._L + this._W - .5, this._T); ctx.lineTo(this._L + this._W - .5, this._T + this._H); }
    ctx.stroke();

    // tick labels
    ctx.fillStyle = P.muted; ctx.font = MONO(10.5);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const logFmt = v => { const a = Math.abs(v); return a !== 0 && (a >= 1e5 || a < 1e-3) ? v.toExponential(0).replace('e+', 'e') : (+v.toPrecision(3)).toLocaleString('en-GB', { maximumFractionDigits: 4 }); };
    xt.forEach(v => { if (v < this._x0 - 1e-9 || v > this._x1 + 1e-9) return; const X = this.px(v); ctx.textAlign = X > this._L + this._W - 18 ? 'right' : X < this._L + 12 ? 'left' : 'center'; ctx.fillText(xa.format ? xa.format(v) : xa.log ? logFmt(v) : fmtTick(v, xs), X, this._T + this._H + 6); });
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    yt.forEach(v => { if (v < this._y0 - 1e-9 || v > this._y1 + 1e-9) return; ctx.fillText(ya.format ? ya.format(v) : ya.log ? logFmt(v) : fmtTick(v, ys), this._L - 6, this.py(v)); });
    if (y2a) {
      const y2t = y2a.log ? logTicks(this._y20, this._y21) : niceTicks(this._y20, this._y21, Math.max(3, Math.min(8, Math.floor(this._H / 45))));
      const s2 = y2t.length > 1 ? y2t[1] - y2t[0] : 1;
      ctx.textAlign = 'left';
      y2t.forEach(v => { if (v < this._y20 - 1e-9 || v > this._y21 + 1e-9) return; ctx.fillText(y2a.format ? y2a.format(v) : y2a.log ? logFmt(v) : fmtTick(v, s2), this._L + this._W + 6, this.py(v, true)); });
    }
    // axis labels
    ctx.fillStyle = P.ink2 || P.ink; ctx.font = FONT(12, 550);
    const lab = a => a.label + (a.unit ? ` (${a.unit})` : '');
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(lab(xa), this._L + this._W / 2, h - 4);
    ctx.save(); ctx.translate(13, this._T + this._H / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText(lab(ya), 0, 0); ctx.restore();
    if (y2a) { ctx.save(); ctx.translate(w - 11, this._T + this._H / 2); ctx.rotate(Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText(lab(y2a), 0, 0); ctx.restore(); }

    // crosshair
    if (this._hover) this._drawHover(ctx, P);
  }

  _drawItem(ctx, it, P) {
    const col = resolveColor(it.color, it._order);
    const right = !!it.y2;
    ctx.globalAlpha = it.opacity != null ? it.opacity : 1;
    switch (it.type) {
      case 'line': {
        ctx.strokeStyle = col; ctx.lineWidth = it.width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.setLineDash(it.dash || []);
        ctx.beginPath(); let pen = false; let lastY = null;
        for (let i = 0; i < it.xs.length; i++) {
          const y = it.ys[i];
          if (!isFinite(y) || (this.ax.y.log && y <= 0)) { pen = false; continue; }
          const X = this.px(it.xs[i]), Y = this.py(y, right);
          if (!pen) { ctx.moveTo(X, Y); pen = true; }
          else if (it.step) { ctx.lineTo(X, lastY); ctx.lineTo(X, Y); }
          else ctx.lineTo(X, Y);
          lastY = Y;
        }
        ctx.stroke(); ctx.setLineDash([]);
        if (it.fill) {
          ctx.fillStyle = withAlpha(col, typeof it.fill === 'number' ? it.fill : 0.14);
          ctx.beginPath(); let started = false; let firstX = 0, lastX = 0;
          const base = this.py(Math.max(right ? this._y20 : this._y0, it.fillTo != null ? it.fillTo : (this.ax.y.log ? (right ? this._y20 : this._y0) : Math.max(right ? this._y20 : this._y0, 0))), right);
          for (let i = 0; i < it.xs.length; i++) {
            if (!isFinite(it.ys[i])) continue;
            const X = this.px(it.xs[i]), Y = this.py(it.ys[i], right);
            if (!started) { ctx.moveTo(X, base); ctx.lineTo(X, Y); started = true; firstX = X; } else ctx.lineTo(X, Y);
            lastX = X;
          }
          ctx.lineTo(lastX, base); ctx.closePath(); ctx.fill();
        }
        break;
      }
      case 'scatter': {
        ctx.fillStyle = col; ctx.strokeStyle = col;
        for (let i = 0; i < it.xs.length; i++) {
          if (!isFinite(it.ys[i])) continue;
          const X = this.px(it.xs[i]), Y = this.py(it.ys[i], right);
          if (it.yErr) { ctx.lineWidth = 1.2; ctx.beginPath(); const e = it.yErr[i]; ctx.moveTo(X, this.py(it.ys[i] - e, right)); ctx.lineTo(X, this.py(it.ys[i] + e, right)); ctx.moveTo(X - 3, this.py(it.ys[i] - e, right)); ctx.lineTo(X + 3, this.py(it.ys[i] - e, right)); ctx.moveTo(X - 3, this.py(it.ys[i] + e, right)); ctx.lineTo(X + 3, this.py(it.ys[i] + e, right)); ctx.stroke(); }
          if (it.colors) ctx.fillStyle = it.colors[i] || col;
          marker(ctx, it.shape || 'circle', X, Y, it.r, it.hollow);
        }
        break;
      }
      case 'band': {
        ctx.fillStyle = withAlpha(col, it.alpha);
        ctx.beginPath();
        it.xs.forEach((x, i) => { const X = this.px(x), Y = this.py(it.hi[i], right); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
        for (let i = it.xs.length - 1; i >= 0; i--) ctx.lineTo(this.px(it.xs[i]), this.py(it.lo[i], right));
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'vline': case 'hline': {
        ctx.strokeStyle = col; ctx.lineWidth = it.width || 1.4; ctx.setLineDash(it.dash || [5, 4]);
        ctx.beginPath();
        if (it.type === 'vline') { const X = this.px(it.x); ctx.moveTo(X, this._T); ctx.lineTo(X, this._T + this._H); }
        else { const Y = this.py(it.y, right); ctx.moveTo(this._L, Y); ctx.lineTo(this._L + this._W, Y); }
        ctx.stroke(); ctx.setLineDash([]);
        if (it.label) {
          ctx.fillStyle = col; ctx.font = FONT(11, 600);
          if (it.type === 'vline') {
            // labelAlign: 'left' (default, text right of the line) | 'right'; labelY: 'top' (default) | 'bottom'; labelDy: extra offset
            const ra = it.labelAlign === 'right', top = it.labelY !== 'bottom', dy = it.labelDy || 0;
            ctx.textAlign = ra ? 'right' : 'left'; ctx.textBaseline = top ? 'top' : 'bottom';
            ctx.fillText(it.label, this.px(it.x) + (ra ? -4 : 4), top ? this._T + 4 + dy : this._T + this._H - 4 - dy);
          }
          else { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(it.label, this._L + this._W - 4, this.py(it.y, right) - 3); }
        }
        break;
      }
      case 'region': case 'hregion': {
        ctx.fillStyle = withAlpha(col, it.alpha);
        if (it.type === 'region') { const a = this.px(it.x0), b = this.px(it.x1); ctx.fillRect(Math.min(a, b), this._T, Math.abs(b - a), this._H); if (it.label) { ctx.fillStyle = col; ctx.font = FONT(11, 600); ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(it.label, (a + b) / 2, this._T + 4); } }
        else { const a = this.py(it.y0, right), b = this.py(it.y1, right); ctx.fillRect(this._L, Math.min(a, b), this._W, Math.abs(b - a)); if (it.label) { ctx.fillStyle = col; ctx.font = FONT(11, 600); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(it.label, this._L + 6, Math.min(a, b) + 3); } }
        break;
      }
      case 'point': {
        if (!isFinite(it.x) || !isFinite(it.y)) break;
        const X = this.px(it.x), Y = this.py(it.y, right);
        if (X < this._L - 1 || X > this._L + this._W + 1 || Y < this._T - 1 || Y > this._T + this._H + 1) break;
        if (it.guides) { ctx.strokeStyle = withAlpha(col, 0.5); ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X, this._T + this._H); ctx.moveTo(X, Y); ctx.lineTo(this._L, Y); ctx.stroke(); ctx.setLineDash([]); }
        ctx.fillStyle = P.bgElev || '#fff'; ctx.beginPath(); ctx.arc(X, Y, it.r + 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X, Y, it.r, 0, Math.PI * 2); ctx.fill();
        if (it.label) { ctx.font = FONT(11.5, 650); ctx.fillStyle = col; ctx.textAlign = X > this._L + this._W * 0.75 ? 'right' : 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(it.label, X + (ctx.textAlign === 'left' ? 8 : -8), Y - 6); }
        break;
      }
      case 'text': {
        ctx.fillStyle = col; ctx.font = FONT(it.size || 11.5, it.weight || 600);
        ctx.textAlign = it.align || 'left'; ctx.textBaseline = it.baseline || 'middle';
        ctx.fillText(it.text, this.px(it.x) + (it.dx || 0), this.py(it.y, right) + (it.dy || 0));
        break;
      }
      case 'heatmap': {
        const z = it.z; if (!z || !z.length) break;
        const ny = z.length, nx = z[0].length;
        let mn = it.min, mx = it.max;
        if (mn == null || mx == null) { let a = Infinity, b = -Infinity; z.forEach(r => r.forEach(v => { if (isFinite(v)) { a = Math.min(a, v); b = Math.max(b, v); } })); if (mn == null) mn = a; if (mx == null) mx = b; }
        if (!this._hmCanvas) this._hmCanvas = document.createElement('canvas');
        const hc = this._hmCanvas; hc.width = nx; hc.height = ny;
        const hctx = hc.getContext('2d'); const img = hctx.createImageData(nx, ny);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const v = z[j][i]; const k = ((ny - 1 - j) * nx + i) * 4;
          if (!isFinite(v)) { img.data[k + 3] = 0; continue; }
          const c = colormap(it.colormap, (v - mn) / (mx - mn || 1));
          img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255 * (it.alpha != null ? it.alpha : 1);
        }
        hctx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = it.smooth !== false;
        const X0 = this.px(it.x0), X1 = this.px(it.x1), Y0 = this.py(it.y0), Y1 = this.py(it.y1);
        ctx.drawImage(hc, Math.min(X0, X1), Math.min(Y0, Y1), Math.abs(X1 - X0), Math.abs(Y1 - Y0));
        break;
      }
      case 'custom': { ctx.save(); it.fn(ctx, this, P); ctx.restore(); break; }
    }
    ctx.globalAlpha = 1;
  }

  _bindPointer() {
    const c = this.canvas;
    const evt = (e, name) => {
      const r = c.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const inside = px >= this._L && px <= this._L + this._W && py >= this._T && py <= this._T + this._H;
      const o = { px, py, inside, x: this.xFromPx(px), y: this.yFromPx(py), y2: this.ax.y2 ? this.yFromPx(py, true) : null, event: e };
      (this.handlers[name] || []).forEach(cb => cb(o));
      return o;
    };
    c.addEventListener('pointermove', e => {
      const o = evt(e, 'pointermove');
      if (this.opts.crosshair) { this._hover = o.inside ? o : null; this.redraw(); }
    });
    c.addEventListener('pointerleave', () => { this._hover = null; this.tip.style.display = 'none'; this.redraw(); });
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); evt(e, 'pointerdown'); });
    c.addEventListener('pointerup', e => { evt(e, 'pointerup'); evt(e, 'click'); });
  }

  _drawHover(ctx, P) {
    const o = this._hover;
    const rows = [];
    let snapX = null;
    for (const it of this.items.values()) {
      if (this.hidden.has(it.id) || it.anno || it.noTip) continue;
      if (it.type !== 'line' && it.type !== 'scatter') continue;
      if (!it.xs.length) continue;
      // nearest index by x
      let best = -1, bd = Infinity;
      if (it.type === 'line' && it.xs.length > 30) {
        let lo = 0, hi = it.xs.length - 1; const asc = it.xs[hi] >= it.xs[0];
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if ((it.xs[m] < o.x) === asc) lo = m; else hi = m; }
        best = Math.abs(it.xs[lo] - o.x) < Math.abs(it.xs[hi] - o.x) ? lo : hi;
      } else {
        for (let i = 0; i < it.xs.length; i++) {
          const dx = this.px(it.xs[i]) - o.px, dy = it.type === 'scatter' ? this.py(it.ys[i], !!it.y2) - o.py : 0;
          const dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = i; }
        }
        if (it.type === 'scatter' && bd > 400) continue;
      }
      if (best < 0 || !isFinite(it.ys[best])) continue;
      const X = this.px(it.xs[best]), Y = this.py(it.ys[best], !!it.y2);
      if (snapX == null) snapX = X;
      const col = resolveColor(it.color, it._order);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X, Y, 4, 0, Math.PI * 2); ctx.fill();
      const ya = it.y2 ? this.ax.y2 : this.ax.y;
      rows.push({ col, lab: it.label || it.id, x: it.xs[best], y: it.ys[best], unit: ya.unit, extra: it.tipExtra ? it.tipExtra(best) : '' });
    }
    if (snapX != null) {
      ctx.strokeStyle = withAlpha(P.muted.startsWith('#') ? P.muted : '#888888', 0.6); ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(snapX, this._T); ctx.lineTo(snapX, this._T + this._H); ctx.stroke(); ctx.setLineDash([]);
    }
    if (!rows.length) { this.tip.style.display = 'none'; return; }
    const xa = this.ax.x;
    const fx = v => (xa.format ? xa.format(v) : sig(v));
    this.tip.innerHTML = `<div style="color:var(--muted)">${xa.label || 'x'} = ${fx(rows[0].x)}${xa.unit ? ' ' + xa.unit : ''}</div>` +
      rows.slice(0, 8).map(r => `<div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${r.col};margin-right:6px"></span>${r.lab}: <b>${sig(r.y)}</b>${r.unit ? ' ' + r.unit : ''}${r.extra ? ' ' + r.extra : ''}</div>`).join('');
    this.tip.style.display = 'block';
    const bw = this.box.clientWidth;
    const tw = this.tip.offsetWidth;
    let left = o.px + 14; if (left + tw > bw - 4) left = o.px - tw - 14;
    this.tip.style.left = Math.max(4, left) + 'px'; this.tip.style.top = Math.max(4, o.py - 20) + 'px';
  }
}

function sig(v) {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2);
  return (+v.toPrecision(4)).toLocaleString('en-GB', { maximumFractionDigits: 4 });
}
function logTicks(a, b) {
  const out = []; const e0 = Math.floor(Math.log10(a)), e1 = Math.ceil(Math.log10(b));
  for (let e = e0; e <= e1; e++) { const v = Math.pow(10, e); if (v >= a * 0.999 && v <= b * 1.001) out.push(v); }
  if (out.length < 3) { for (let e = e0; e <= e1; e++) [2, 5].forEach(m => { const v = m * Math.pow(10, e); if (v >= a && v <= b) out.push(v); }); out.sort((x, y) => x - y); }
  if (out.length < 3) { out.length = 0; for (let e = e0; e <= e1; e++) for (let m = 1; m <= 9; m++) { const v = m * Math.pow(10, e); if (v >= a * 0.999 && v <= b * 1.001) out.push(v); } }
  if (out.length < 3) return niceTicks(a, b, 4).filter(v => v > 0); // narrow range inside one decade: plain nice values
  return out;
}
function marker(ctx, shape, X, Y, r, hollow) {
  ctx.beginPath();
  if (shape === 'square') ctx.rect(X - r, Y - r, 2 * r, 2 * r);
  else if (shape === 'triangle') { ctx.moveTo(X, Y - r * 1.2); ctx.lineTo(X + r * 1.1, Y + r * .8); ctx.lineTo(X - r * 1.1, Y + r * .8); ctx.closePath(); }
  else if (shape === 'diamond') { ctx.moveTo(X, Y - r * 1.3); ctx.lineTo(X + r * 1.1, Y); ctx.lineTo(X, Y + r * 1.3); ctx.lineTo(X - r * 1.1, Y); ctx.closePath(); }
  else ctx.arc(X, Y, r, 0, Math.PI * 2);
  if (hollow) { ctx.lineWidth = 1.6; ctx.stroke(); } else ctx.fill();
}

/* ============================================================ BarChart */
/**
 * const b = new BarChart(el, { y: { label, unit, min: 0 }, horizontal: false, stacked: false, height: 260 });
 * b.set(['A','B','C'], [{ label: 'CO₂', values: [1,2,3], color: 'accent' }, …]);
 * b.refLine(value, 'Budget');   b.valueLabels = true;
 */
export class BarChart {
  constructor(container, opts = {}) {
    this.el = typeof container === 'string' ? document.querySelector(container) : container;
    this.opts = Object.assign({ stacked: false, horizontal: false, valueLabels: true, legend: true }, opts);
    this.y = Object.assign({ label: '', unit: '', min: 0, max: 'auto' }, opts.y || {});
    this.cats = []; this.series = []; this.refs = [];
    this.el.innerHTML = '';
    if (this.opts.legend) { this.legendEl = document.createElement('div'); this.legendEl.className = 'plot-legend'; this.el.appendChild(this.legendEl); }
    this.box = document.createElement('div'); this.box.className = 'plot';
    this.box.style.height = (this.opts.height || (this.el.clientHeight > 60 ? this.el.clientHeight - 22 : 260)) + 'px';
    this.el.appendChild(this.box);
    this.canvas = document.createElement('canvas'); this.box.appendChild(this.canvas);
    this.tip = document.createElement('div'); this.tip.className = 'plot-tip'; this.box.appendChild(this.tip);
    this.ctx = this.canvas.getContext('2d');
    new ResizeObserver(() => this.redraw()).observe(this.box);
    document.addEventListener('ffp:theme', () => this.redraw());
    this.canvas.addEventListener('pointermove', e => this._hover(e));
    this.canvas.addEventListener('pointerleave', () => { this.tip.style.display = 'none'; });
  }
  set(cats, series) { this.cats = cats; this.series = series; this._legend(); this.redraw(); return this; }
  refLine(v, label, color) { this.refs = v == null ? [] : [{ v, label, color }]; this.redraw(); return this; }
  refLines(arr) { this.refs = arr; this.redraw(); return this; }
  redraw() { if (this._q) return; this._q = true; requestAnimationFrame(() => { this._q = false; this._draw(); }); }
  _legend() {
    if (!this.legendEl) return;
    // series with per-bar colours get a striped swatch of those colours, so legend and bars never disagree
    const sw = (s, i) => { if (!s.colors) return resolveColor(s.color, i); const u = [...new Set(s.colors.map(c => resolveColor(c, i)))]; return u.length === 1 ? u[0] : `linear-gradient(90deg, ${u.map((c, k) => `${c} ${k / u.length * 100}% ${(k + 1) / u.length * 100}%`).join(', ')})`; };
    this.legendEl.innerHTML = this.series.length > 1 ? this.series.map((s, i) => `<span><i class="dot" style="background:${sw(s, i)}"></i>${s.label}</span>`).join('') : '';
  }
  _draw() {
    const w = this.box.clientWidth, h = this.box.clientHeight; if (!w || !h) return;
    const d = DPR(); this.canvas.width = Math.round(w * d); this.canvas.height = Math.round(h * d);
    const ctx = this.ctx; ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h);
    const P = palette(); const hz = this.opts.horizontal;
    const n = this.cats.length, m = this.series.length; if (!n || !m) return;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      if (this.opts.stacked) { let pos = 0, neg = 0; this.series.forEach(s => { const v = s.values[i] || 0; if (v >= 0) pos += v; else neg += v; }); hi = Math.max(hi, pos); lo = Math.min(lo, neg); }
      else this.series.forEach(s => { const v = s.values[i]; if (isFinite(v)) { hi = Math.max(hi, v); lo = Math.min(lo, v); } });
    }
    this.refs.forEach(r => { if (r.inRange === false) return; hi = Math.max(hi, r.v); lo = Math.min(lo, r.v); }); // { inRange:false }: never rescale the bars for this line
    let y0 = this.y.min !== 'auto' && this.y.min != null ? Math.min(this.y.min, lo) : Math.min(0, lo < 0 ? lo * 1.08 : 0);
    let y1 = this.y.max !== 'auto' && this.y.max != null ? this.y.max : Math.max(0, hi > 0 ? hi * 1.08 : 0);
    if (y1 <= y0) y1 = y0 + 1;
    const ticks = niceTicks(y0, y1, 6); const st = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    y0 = Math.min(y0, ticks[0]); if (this.y.max === 'auto' || this.y.max == null) y1 = Math.max(y1, ticks[ticks.length - 1]);
    ctx.font = FONT(11.5, 550);
    const catW = Math.max(...this.cats.map(c => ctx.measureText(c).width));
    ctx.font = MONO(10.5); const tickW = Math.max(...ticks.map(t => ctx.measureText(fmtTick(t, st)).width)); ctx.font = FONT(11.5, 550);
    // horizontal bars print their value to the right of the bar: reserve room so labels are never clipped
    ctx.font = MONO(10.5);
    const valW = hz && this.opts.valueLabels && !this.opts.stacked ? Math.max(0, ...this.series.flatMap(s => s.values.filter(Number.isFinite).map(v => ctx.measureText(s.format ? s.format(v) : sig(v)).width))) : 0;
    ctx.font = FONT(11.5, 550);
    const L = hz ? Math.min(w * 0.4, catW + 16) : Math.max(58, tickW + 30), R = hz ? Math.max(16, valW + 10) : 16, T = 10, B = hz ? 40 : 54; // room for long tick labels
    const W = w - L - R, H = h - T - B;
    this._geom = { L, T, W, H, y0, y1, hz };
    const V = v => hz ? L + (v - y0) / (y1 - y0) * W : T + (1 - (v - y0) / (y1 - y0)) * H;
    ctx.strokeStyle = P.line; ctx.lineWidth = 1; ctx.beginPath();
    ticks.forEach(t => { const p = Math.round(V(t)) + .5; if (hz) { ctx.moveTo(p, T); ctx.lineTo(p, T + H); } else { ctx.moveTo(L, p); ctx.lineTo(L + W, p); } });
    ctx.stroke();
    ctx.fillStyle = P.muted; ctx.font = MONO(10.5);
    ticks.forEach(t => { if (hz) { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(fmtTick(t, st), V(t), T + H + 6); } else { ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(fmtTick(t, st), L - 6, V(t)); } });
    const band = (hz ? H : W) / n; const inner = band * 0.72; const bw = this.opts.stacked ? inner : inner / m;
    this._bars = [];
    for (let i = 0; i < n; i++) {
      let pos = 0, neg = 0;
      this.series.forEach((s, k) => {
        const v = s.values[i]; if (!isFinite(v)) return;
        let a, b;
        if (this.opts.stacked) { if (v >= 0) { a = pos; b = pos + v; pos = b; } else { a = neg; b = neg + v; neg = b; } }
        else { a = 0; b = v; }
        const off = (band - inner) / 2 + (this.opts.stacked ? 0 : k * bw);
        const col = s.colors ? resolveColor(s.colors[i], k) : resolveColor(s.color, k);
        ctx.fillStyle = col;
        let rx, ry, rw, rh;
        if (hz) { rx = Math.min(V(a), V(b)); rw = Math.abs(V(b) - V(a)); ry = T + i * band + off; rh = bw; }
        else { rx = L + i * band + off; rw = bw; ry = Math.min(V(a), V(b)); rh = Math.abs(V(b) - V(a)); }
        roundRect(ctx, rx, ry, rw, rh, Math.min(4, rw / 3, rh / 2)); ctx.fill();
        this._bars.push({ rx, ry, rw, rh, cat: this.cats[i], s: s.label, v, col });
        if (this.opts.valueLabels && !this.opts.stacked && (hz ? rw > 0 : rh > 0)) {
          ctx.fillStyle = P.ink2; ctx.font = MONO(10.5);
          const txt = s.format ? s.format(v) : sig(v);
          if (hz) { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, rx + rw + 4, ry + rh / 2); }
          else if (bw > 22) { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(txt, rx + rw / 2, ry - 3); }
        }
      });
    }
    // category labels
    ctx.fillStyle = P.ink2; ctx.font = FONT(11.5, 550);
    // horizontal charts: long category names wrap onto two lines (ellipsis beyond that) instead of being cut off
    const wrap2 = (txt, maxW) => {
      if (ctx.measureText(txt).width <= maxW) return [txt];
      const words = String(txt).split(/\s+/); let a = '', i = 0;
      for (; i < words.length; i++) { const t = a ? a + ' ' + words[i] : words[i]; if (ctx.measureText(t).width > maxW && a) break; a = t; }
      let b = words.slice(i).join(' ');
      while (b && ctx.measureText(b).width > maxW) b = b.slice(0, -2) + '…';
      return b ? [a, b] : [a];
    };
    // many narrow categories: label every k-th one so the labels never overprint
    const every = Math.max(1, Math.ceil((hz ? 13 : (catW > band - 6 ? 15 : catW + 6)) / Math.max(1, band)));
    this.cats.forEach((c, i) => {
      if (i % every) return;
      if (hz) {
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        const lines = band >= 24 ? wrap2(c, L - 12) : [wrap2(c, L - 12)[0]], cy = T + i * band + band / 2, lh = 13;
        lines.forEach((ln, k) => ctx.fillText(ln, L - 8, cy + (k - (lines.length - 1) / 2) * lh));
      }
      else { ctx.save(); ctx.translate(L + i * band + band / 2, T + H + 8); const rot = catW > band - 6; if (rot) { ctx.rotate(-Math.PI / 7); ctx.textAlign = 'right'; } else ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(c, 0, 0); ctx.restore(); }
    });
    // refs
    this.refs.forEach(r => {
      const col = resolveColor(r.color || 'danger'); ctx.strokeStyle = col; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      const off = r.v > y1 ? 1 : r.v < y0 ? -1 : 0; // off-scale reference (inRange:false): marker at the edge
      const p = V(off > 0 ? y1 : off < 0 ? y0 : r.v);
      if (!off) { ctx.beginPath(); if (hz) { ctx.moveTo(p, T); ctx.lineTo(p, T + H); } else { ctx.moveTo(L, p); ctx.lineTo(L + W, p); } ctx.stroke(); }
      ctx.setLineDash([]);
      const text = off ? `${r.label ? r.label + ' ' : ''}${hz ? (off > 0 ? '→' : '←') : (off > 0 ? '↑' : '↓')} ${sig(r.v)}` : r.label;
      if (off) { // small arrowhead on the edge
        ctx.fillStyle = col; ctx.beginPath();
        if (hz) { const x = p + (off > 0 ? -1 : 1), y = T + 8; ctx.moveTo(x + off * 6, y); ctx.lineTo(x - off * 2, y - 5); ctx.lineTo(x - off * 2, y + 5); }
        else { const x = L + W - 6, y = p + (off > 0 ? 1 : -1); ctx.moveTo(x, y - off * 6); ctx.lineTo(x - 5, y + off * 2); ctx.lineTo(x + 5, y + off * 2); }
        ctx.closePath(); ctx.fill();
      }
      if (text) {
        ctx.font = FONT(11, 650); const tw = ctx.measureText(text).width;
        let bx = hz ? p + 3 : L + W - tw - 8 - (off ? 14 : 0), by = hz ? T + 1 : (off < 0 ? p - 17 : off > 0 ? p + 2 : p - 17);
        if (hz && bx + tw + 6 > L + W) bx = p - tw - 9;
        ctx.fillStyle = withAlpha(P.bgElev && P.bgElev.startsWith('#') ? P.bgElev : '#ffffff', 0.88); ctx.fillRect(bx, by, tw + 6, 15);
        ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(text, bx + 3, by + 2);
      }
    });
    // axis
    ctx.strokeStyle = P.lineStrong; ctx.beginPath(); const z = V(0);
    if (hz) { ctx.moveTo(z + .5, T); ctx.lineTo(z + .5, T + H); } else { ctx.moveTo(L, z + .5); ctx.lineTo(L + W, z + .5); } ctx.stroke();
    ctx.fillStyle = P.ink2; ctx.font = FONT(12, 550); ctx.textAlign = 'center';
    const lab = this.y.label + (this.y.unit ? ` (${this.y.unit})` : '');
    if (hz) { ctx.textBaseline = 'bottom'; ctx.fillText(lab, L + W / 2, h - 4); }
    else { ctx.save(); ctx.translate(13, T + H / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText(lab, 0, 0); ctx.restore(); }
  }
  _hover(e) {
    if (!this._bars) return;
    const r = this.canvas.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    const b = this._bars.find(b => x >= b.rx - 2 && x <= b.rx + b.rw + 2 && y >= b.ry - 2 && y <= b.ry + b.rh + 2);
    if (!b) { this.tip.style.display = 'none'; return; }
    this.tip.innerHTML = `<b>${b.cat}</b>${b.s ? ' · ' + b.s : ''}<br>${sig(b.v)} ${this.y.unit || ''}`;
    this.tip.style.display = 'block'; this.tip.style.left = Math.min(x + 12, this.box.clientWidth - this.tip.offsetWidth - 4) + 'px'; this.tip.style.top = (y - 10) + 'px';
  }
}
function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, r || 0); ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

/* ============================================================== Sankey */
/**
 * const s = new Sankey(el, { unit: 'kWh', height: 320, digits: 1, flow: true });
 * s.set({ nodes: [{ id:'grid', label:'Electricity', color:'amber', col?:0 }, …],
 *         links: [{ source:'grid', target:'led', value: 60, color? }, …] });
 * Columns are assigned by longest path from sources unless node.col is given.
 * flow: true animates particles along every band (density ∝ band width; paused off-screen
 * and under prefers-reduced-motion). flowSpeed (px s⁻¹, default 45) sets their speed.
 */
export class Sankey {
  constructor(container, opts = {}) {
    this.el = typeof container === 'string' ? document.querySelector(container) : container;
    this.opts = Object.assign({ unit: '', height: 320, nodeWidth: 14, gap: 14, digits: 1, flow: false, flowSpeed: 45 }, opts);
    this.el.innerHTML = '';
    this.box = document.createElement('div'); this.box.className = 'plot'; this.box.style.height = this.opts.height + 'px';
    this.el.appendChild(this.box);
    this.tip = document.createElement('div'); this.tip.className = 'plot-tip'; this.box.appendChild(this.tip);
    this.data = { nodes: [], links: [] };
    this._flows = [];
    if (this.opts.flow && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) this._initFlow();
    new ResizeObserver(() => this.redraw()).observe(this.box);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.redraw()); // label margins are measured with the web font
    document.addEventListener('ffp:theme', () => this.redraw());
  }
  _initFlow() {
    this.box.style.position = 'relative';
    const cv = this._cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    cv.setAttribute('aria-hidden', 'true');
    this.box.insertBefore(cv, this.tip);
    const ctx = cv.getContext('2d');
    let visible = true, last = performance.now();
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(this.box);
    const bez = (a, b, c, d, t) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; };
    const at = (f, s) => { const P = f.pts; let i = 1; while (i < P.length - 1 && P[i][2] < s) i++; const a = P[i - 1], b = P[i]; const t = (s - a[2]) / Math.max(1e-6, b[2] - a[2]); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
    this._buildFlow = links => {
      const old = this._flows;
      this._flows = links.map((l, k) => {
        const pts = []; let L = 0;
        for (let i = 0; i <= 40; i++) { const t = i / 40, x = bez(l.x0, l.xm, l.xm, l.x1, t), y = bez(l.y0, l.y0, l.y1, l.y1, t); if (pts.length) L += Math.hypot(x - pts[pts.length - 1][0], y - pts[pts.length - 1][1]); pts.push([x, y, L]); }
        const count = Math.max(1, Math.min(60, Math.round(L * Math.sqrt(l.w) / 120)));
        const prev = old[k] && old[k].parts.length === count ? old[k].parts : null; // keep particles when only values change
        const parts = prev || Array.from({ length: count }, () => ({ s: Math.random() * L, u: Math.random() - 0.5, v: 0.75 + Math.random() * 0.5, r: 0.9 + Math.random() * 1.1 }));
        return { pts, L, w: l.w, col: l.col, parts };
      });
    };
    const frame = now => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (visible && !document.hidden && this._flows.length) {
        const W = this.box.clientWidth, H = this.box.clientHeight, d = Math.min(2, window.devicePixelRatio || 1);
        if (cv.width !== Math.round(W * d) || cv.height !== Math.round(H * d)) { cv.width = Math.round(W * d); cv.height = Math.round(H * d); }
        ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, W, H);
        const sp = this.opts.flowSpeed;
        for (const f of this._flows) {
          ctx.fillStyle = f.col; ctx.globalAlpha = 0.85;
          for (const q of f.parts) {
            q.s += q.v * sp * dt; if (q.s > f.L) q.s -= f.L;
            const [x, y] = at(f, q.s);
            ctx.beginPath(); ctx.arc(x, y + q.u * Math.max(0, f.w - 2 * q.r - 1), q.r, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  set(data) { this.data = data; this.redraw(); return this; }
  redraw() { if (this._q) return; this._q = true; requestAnimationFrame(() => { this._q = false; this._draw(); }); }
  _draw() {
    const W = this.box.clientWidth, H = this.box.clientHeight; if (!W) return;
    const P = palette();
    const { nodes, links } = this.data;
    const N = new Map(nodes.map((n, i) => [n.id, Object.assign({}, n, { i, in: 0, out: 0, srcL: [], tgtL: [] })]));
    const L = links.filter(l => l.value > 0 && N.has(l.source) && N.has(l.target)).map(l => Object.assign({}, l));
    L.forEach(l => { N.get(l.source).out += l.value; N.get(l.target).in += l.value; N.get(l.source).srcL.push(l); N.get(l.target).tgtL.push(l); });
    [...N.keys()].forEach(id => { const n = N.get(id); if (!n.srcL.length && !n.tgtL.length && !(n.value > 0)) N.delete(id); });
    // columns
    const col = new Map();
    const depth = id => {
      if (col.has(id)) return col.get(id);
      const n = N.get(id); if (n.col != null) { col.set(id, n.col); return n.col; }
      col.set(id, 0);
      const d = n.tgtL.length ? Math.max(...n.tgtL.map(l => depth(l.source) + 1)) : 0;
      col.set(id, d); return d;
    };
    [...N.keys()].forEach(depth);
    // push sinks to the last column
    const maxC = Math.max(0, ...col.values());
    N.forEach((n, id) => { if (n.col == null && !n.srcL.length && n.tgtL.length && n.sinkRight !== false) col.set(id, maxC); });
    const cols = []; N.forEach((n, id) => { const c = col.get(id); (cols[c] = cols[c] || []).push(n); });
    const val = n => Math.max(n.in, n.out, n.value || 0);
    // label margins sized to the actual first- and last-column labels (value line included)
    const mctx = (this._mctx = this._mctx || document.createElement('canvas').getContext('2d'));
    mctx.font = "600 12px Inter, system-ui, sans-serif";
    const dgt = this.opts.digits, un = this.opts.unit;
    const wOf = n => 1.06 * Math.max(mctx.measureText(n.label || '').width, mctx.measureText((+val(n).toFixed(dgt)).toLocaleString('en-GB') + (un ? ' ' + un : '')).width * 0.9);
    const colW = cn => cn && cn.length ? Math.max(...cn.map(wOf)) : 40;
    const padL = Math.min(W * 0.34, Math.max(48, colW(cols[0]) + 14));
    const padR = Math.min(W * 0.34, Math.max(48, colW(cols[cols.length - 1]) + 14));
    const nw = this.opts.nodeWidth, padT = 10, padB = 10;
    const usableW = W - padL - padR;
    const cx = c => padL + (cols.length > 1 ? c / (cols.length - 1) * (usableW - nw) : 0);
    let scale = Infinity;
    cols.forEach(cn => { if (!cn) return; const tot = cn.reduce((s, n) => s + val(n), 0); const avail = H - padT - padB - this.opts.gap * (cn.length - 1); if (tot > 0) scale = Math.min(scale, avail / tot); });
    if (!isFinite(scale)) scale = 1;
    cols.forEach((cn, c) => {
      if (!cn) return;
      const tot = cn.reduce((s, n) => s + val(n), 0) * scale + this.opts.gap * (cn.length - 1);
      let y = padT + (H - padT - padB - tot) / 2;
      cn.forEach(n => { n.x = cx(c); n.y = y; n.h = Math.max(1.5, val(n) * scale); y += n.h + this.opts.gap; n.c = c; });
    });
    // link offsets
    N.forEach(n => {
      n.srcL.sort((a, b) => N.get(a.target).y - N.get(b.target).y);
      n.tgtL.sort((a, b) => N.get(a.source).y - N.get(b.source).y);
      let o = 0; n.srcL.forEach(l => { l.sy = n.y + o; o += l.value * scale; });
      o = 0; n.tgtL.forEach(l => { l.ty = n.y + o; o += l.value * scale; });
    });
    const svgNS = 'http://www.w3.org/2000/svg';
    let svg = this.box.querySelector('svg');
    if (!svg) { svg = document.createElementNS(svgNS, 'svg'); this.box.insertBefore(svg, this.tip); }
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const dg = this.opts.digits; const u = this.opts.unit;
    const fmt = v => (+v.toFixed(dg)).toLocaleString('en-GB') + (u ? ' ' + u : '');
    let html = '';
    const flowLinks = [];
    L.forEach((l, k) => {
      const s = N.get(l.source), t = N.get(l.target), th = Math.max(1, l.value * scale);
      // filled ribbon between two Bézier edges: constant vertical thickness, no pinching between close columns
      const x0 = s.x + nw, x1 = t.x, xm = (x0 + x1) / 2, a0 = l.sy, a1 = l.ty, b0 = a0 + th, b1 = a1 + th;
      const c = resolveColor(l.color || s.color, s.i);
      html += `<path data-k="${k}" d="M${x0},${a0} C${xm},${a0} ${xm},${a1} ${x1},${a1} L${x1},${b1} C${xm},${b1} ${xm},${b0} ${x0},${b0} Z" fill="${c}" fill-opacity="0.32" stroke="none"><title>${esc(s.label)} → ${esc(t.label)}: ${fmt(l.value)}</title></path>`;
      flowLinks.push({ x0, x1, xm, y0: a0 + th / 2, y1: a1 + th / 2, w: th, col: c });
    });
    if (this._buildFlow) this._buildFlow(flowLinks);
    // text halo in the colour of whatever is behind the chart, so labels stay legible over bands
    const halo = bgOf(this.box) || P.bgElev || P.bg;
    const hs = `paint-order:stroke;stroke:${halo};stroke-width:3px;stroke-linejoin:round`;
    // label placement: two-line blocks (name + value) centred on the node, then relaxed per column so that
    // small neighbouring nodes do not print on top of each other and no block leaves the chart
    const LH = 28, minY = 13, maxY = H - 15;
    const byCol = new Map();
    N.forEach(n => { n.ly = n.y + n.h / 2; if (!byCol.has(n.c)) byCol.set(n.c, []); byCol.get(n.c).push(n); });
    byCol.forEach(arr => {
      arr.sort((a, b) => a.ly - b.ly);
      for (let i = 1; i < arr.length; i++) arr[i].ly = Math.max(arr[i].ly, arr[i - 1].ly + LH);
      if (arr.length) arr[arr.length - 1].ly = Math.min(arr[arr.length - 1].ly, maxY);
      for (let i = arr.length - 2; i >= 0; i--) arr[i].ly = Math.min(arr[i].ly, arr[i + 1].ly - LH);
      if (arr.length && arr[0].ly < minY) { arr[0].ly = minY; for (let i = 1; i < arr.length; i++) arr[i].ly = Math.max(arr[i].ly, arr[i - 1].ly + LH); }
    });
    N.forEach(n => {
      const c = resolveColor(n.color, n.i);
      html += `<rect x="${n.x}" y="${n.y}" width="${nw}" height="${n.h}" rx="3" fill="${c}"><title>${esc(n.label)}: ${fmt(val(n))}</title></rect>`;
      const left = n.c === 0; const right = n.c === cols.length - 1;
      const tx = left ? n.x - 8 : right ? n.x + nw + 8 : n.x + nw + 6;
      const anchor = left ? 'end' : 'start';
      const cy = n.y + n.h / 2;
      if (Math.abs(n.ly - cy) > Math.max(5, n.h / 2)) { // label moved away from its node: draw a leader line
        const x0 = left ? n.x : n.x + nw, x1 = left ? tx + 3 : tx - 3;
        html += `<path d="M${x0},${cy} L${(x0 + x1) / 2},${cy} L${x1},${n.ly}" fill="none" stroke="${P.muted}" stroke-width="0.9" stroke-opacity="0.8"/>`;
      }
      html += `<text x="${tx}" y="${n.ly - 6}" text-anchor="${anchor}" dominant-baseline="middle" style="font:600 12px Inter,sans-serif;fill:${P.ink};${hs}">${esc(n.label)}</text>`;
      html += `<text x="${tx}" y="${n.ly + 8}" text-anchor="${anchor}" dominant-baseline="middle" style="font:500 10.5px 'JetBrains Mono',monospace;fill:${P.muted};${hs}">${fmt(val(n))}</text>`;
    });
    svg.innerHTML = html;
    svg.querySelectorAll('path[data-k]').forEach(p => {
      p.addEventListener('mouseenter', () => p.setAttribute('fill-opacity', '0.6'));
      p.addEventListener('mouseleave', () => p.setAttribute('fill-opacity', '0.32'));
    });
  }
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
/** First opaque background colour behind an element (for text halos). */
function bgOf(el) {
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    const c = getComputedStyle(e).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c)) return c;
  }
  return getComputedStyle(document.body).backgroundColor || null;
}

/* ------------------------------------------------------------ helpers */
/** Evenly spaced samples: linspace(0, 10, 101). */
export function linspace(a, b, n) { const out = new Array(n); for (let i = 0; i < n; i++) out[i] = a + (b - a) * i / (n - 1); return out; }
/** Download rows as CSV. */
export function downloadCSV(name, headers, rows) {
  const csv = [headers.join(','), ...rows.map(r => r.map(v => typeof v === 'string' && /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(','))].join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 300);
}
/** Colour-bar legend element for heatmaps. */
export function colorbar(container, { colormap: cm = 'viridis', min = 0, max = 1, label = '', unit = '', ticks = 5 } = {}) {
  import('./colors.js').then(({ colormapGradient }) => {
    const t = []; for (let i = 0; i < ticks; i++) t.push(min + (max - min) * i / (ticks - 1));
    container.innerHTML = `<div style="font-size:.76rem;color:var(--muted)">${label}${unit ? ` (${unit})` : ''}</div><div class="cbar" style="height:10px;border-radius:3px;background:${colormapGradient(cm)}"></div><div class="cbar-ticks" style="display:flex;justify-content:space-between;font:500 .7rem var(--font-mono);color:var(--muted)">${t.map(v => `<span>${sig(v)}</span>`).join('')}</div>`;
  });
}
