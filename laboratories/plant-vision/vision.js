/* ==========================================================================
   vision.js — classical image-analysis pipeline for plant phenotyping (ES module)
   RGB → (white balance) → chromatic coordinates → colour index (ExG, ExG−ExR,
   g, −a*, HSV) → threshold (Otsu or manual) → morphological opening (square
   structuring element, separable) → connected components (8-connectivity,
   union–find) → per-plant area; lesion pixels by an HSV colour rule.
   Equations: Lesson 10.3, Eqs. 10.3.1–10.3.7 (and PV1–PV8 in the Derive tab).
   ========================================================================== */

/** Float channels from ImageData, optionally multiplied by white-balance gains. */
export function channels(img, gains = [1, 1, 1]) {
  const n = img.width * img.height, d = img.data; const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) { R[i] = Math.min(255, d[j] * gains[0]); G[i] = Math.min(255, d[j + 1] * gains[1]); B[i] = Math.min(255, d[j + 2] * gains[2]); }
  return { R, G, B, W: img.width, H: img.height, n };
}
/** White-balance gains from a region known to be white/grey (e.g. the border of the reference card). */
export function whiteGains(img, rect, inner) {
  const W = img.width, d = img.data; let s = [0, 0, 0], c = 0;
  const x0 = Math.round(rect.x0), x1 = Math.round(rect.x1), y0 = Math.round(rect.y0), y1 = Math.round(rect.y1);
  const b = inner ? Math.round((x1 - x0) * (1 - inner) / 2) : 0; const m = 3;
  for (let y = y0 + m; y < y1 - m; y++) for (let x = x0 + m; x < x1 - m; x++) {
    const inBlue = inner && x > x0 + b - m && x < x1 - b + m && y > y0 + b - m && y < y1 - b + m; if (inBlue) continue;
    const j = (y * W + x) * 4; s[0] += d[j]; s[1] += d[j + 1]; s[2] += d[j + 2]; c++;
  }
  if (!c) return [1, 1, 1];
  const mu = s.map(v => v / c); const g = (mu[0] + mu[1] + mu[2]) / 3;
  return mu.map(v => (v > 1 ? g / v : 1));
}
/** Chromatic (normalised rgb) coordinates, Eq. 10.3.1. */
export function chromatic(C) {
  const { R, G, B, n } = C; const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const s = R[i] + G[i] + B[i]; if (s > 0) { r[i] = R[i] / s; g[i] = G[i] / s; b[i] = B[i] / s; } else { r[i] = g[i] = b[i] = 1 / 3; } }
  return { r, g, b };
}
/** HSV with H in degrees, S and V in 0–1 (Smith 1978). */
export function hsv(C) {
  const { R, G, B, n } = C; const Hh = new Float32Array(n), S = new Float32Array(n), V = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = R[i] / 255, g = G[i] / 255, b = B[i] / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn;
    let h = 0; if (dl > 1e-9) { if (mx === r) h = 60 * (((g - b) / dl) % 6); else if (mx === g) h = 60 * ((b - r) / dl + 2); else h = 60 * ((r - g) / dl + 4); }
    Hh[i] = h < 0 ? h + 360 : h; S[i] = mx > 0 ? dl / mx : 0; V[i] = mx;
  }
  return { H: Hh, S, V };
}
/** CIELAB a* (D65, sRGB), Eq. 10.3.3 — negative for green. */
export function labA(C) {
  const { R, G, B, n } = C; const a = new Float32Array(n);
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const LUT = new Float32Array(256); for (let i = 0; i < 256; i++) LUT[i] = lin(i);
  const f = t => (t > 0.008856 ? Math.cbrt(t) : t / 0.12842 + 4 / 29);
  for (let i = 0; i < n; i++) {
    const r = LUT[Math.round(R[i])], g = LUT[Math.round(G[i])], b = LUT[Math.round(B[i])];
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    a[i] = 500 * (f(X) - f(Y));
  }
  return a;
}
export const INDICES = {
  exg: { label: 'ExG = 2g − r − b', range: [-0.4, 0.8], def: 0.1 },
  exgr: { label: 'ExG − ExR', range: [-1.2, 1.2], def: 0 },
  gcc: { label: 'green chromatic g', range: [0.2, 0.7], def: 0.37 },
  lab: { label: '−a* (CIELAB)', range: [-40, 60], def: 8 },
  hsv: { label: 'HSV hue window', range: [0, 360], def: 60 }
};
/** Colour index image (higher = greener). */
export function colourIndex(kind, C, ch, hs) {
  const n = C.n; const I = new Float32Array(n); const { r, g, b } = ch;
  if (kind === 'exg') for (let i = 0; i < n; i++) I[i] = 2 * g[i] - r[i] - b[i];
  else if (kind === 'exgr') for (let i = 0; i < n; i++) I[i] = 3 * g[i] - 2.4 * r[i] - b[i];
  else if (kind === 'gcc') for (let i = 0; i < n; i++) I[i] = g[i];
  else if (kind === 'lab') { const a = labA(C); for (let i = 0; i < n; i++) I[i] = -a[i]; }
  else if (kind === 'hsv') for (let i = 0; i < n; i++) I[i] = hs.H[i];
  return I;
}
/** Histogram over [lo, hi]. */
export function hist(I, lo, hi, bins = 128) { const c = new Float64Array(bins), w = (hi - lo) / bins; for (let i = 0; i < I.length; i++) { let k = Math.floor((I[i] - lo) / w); if (k < 0) k = 0; else if (k >= bins) k = bins - 1; c[k]++; } return { counts: c, lo, hi, w, centres: Array.from({ length: bins }, (_, k) => lo + (k + 0.5) * w) }; }
/** Otsu (1979): threshold maximising the between-class variance σ_B²(t) = ω₀ω₁(μ₀ − μ₁)². */
export function otsu(h) {
  const { counts, centres } = h; const N = counts.reduce((s, v) => s + v, 0); let sumAll = 0; for (let k = 0; k < counts.length; k++) sumAll += counts[k] * centres[k];
  let w0 = 0, s0 = 0, best = -1, bestK = 0; const sb = new Float64Array(counts.length);
  for (let k = 0; k < counts.length - 1; k++) {
    w0 += counts[k]; s0 += counts[k] * centres[k]; const w1 = N - w0; if (w0 === 0 || w1 === 0) continue;
    const m0 = s0 / w0, m1 = (sumAll - s0) / w1; const v = (w0 / N) * (w1 / N) * (m0 - m1) ** 2; sb[k] = v;
    if (v > best) { best = v; bestK = k; }
  }
  return { t: h.lo + (bestK + 1) * h.w, sigmaB: sb, k: bestK };
}
/** Robust range (percentiles) of an index image, for histograms and colour maps. */
export function pRange(I, p0 = 0.005, p1 = 0.995) { const step = Math.max(1, Math.floor(I.length / 40000)); const s = []; for (let i = 0; i < I.length; i += step) s.push(I[i]); s.sort((a, b) => a - b); return [s[Math.floor(p0 * (s.length - 1))], s[Math.ceil(p1 * (s.length - 1))]]; }

/* ------------------------------------------------------------ binary morphology (square SE, separable) */
function pass(src, dst, W, H, r, erode, horizontal) {
  const len = horizontal ? W : H, lines = horizontal ? H : W; const pre = new Int32Array(len + 1);
  for (let l = 0; l < lines; l++) {
    pre[0] = 0;
    for (let k = 0; k < len; k++) pre[k + 1] = pre[k] + src[horizontal ? l * W + k : k * W + l];
    for (let k = 0; k < len; k++) {
      const a = Math.max(0, k - r), b = Math.min(len - 1, k + r); const cnt = pre[b + 1] - pre[a];
      const v = erode ? (cnt === b - a + 1 ? 1 : 0) : (cnt > 0 ? 1 : 0);
      dst[horizontal ? l * W + k : k * W + l] = v;
    }
  }
}
export function erode(m, W, H, r) { if (r <= 0) return m.slice(); const t = new Uint8Array(m.length), o = new Uint8Array(m.length); pass(m, t, W, H, r, true, true); pass(t, o, W, H, r, true, false); return o; }
export function dilate(m, W, H, r) { if (r <= 0) return m.slice(); const t = new Uint8Array(m.length), o = new Uint8Array(m.length); pass(m, t, W, H, r, false, true); pass(t, o, W, H, r, false, false); return o; }
export const opening = (m, W, H, r) => dilate(erode(m, W, H, r), W, H, r);

/** Fill holes: background pixels (4-connected) that cannot be reached from the image border become foreground. */
export function fillHoles(m, W, H) {
  const n = W * H; const seen = new Uint8Array(n); const q = new Int32Array(n); let qh = 0, qt = 0;
  const push = i => { if (!m[i] && !seen[i]) { seen[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (qh < qt) { const i = q[qh++]; const x = i % W; if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (i >= W) push(i - W); if (i < n - W) push(i + W); }
  const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = m[i] || !seen[i] ? 1 : 0;
  return out;
}

/* ------------------------------------------------------------ connected components (8-connectivity) */
export function components(m, W, H) {
  const L = new Int32Array(W * H); let parent = new Int32Array(4096); let next = 1;
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) { if (a < b) parent[b] = a; else parent[a] = b; } };
  const nb = new Int32Array(4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!m[i]) continue;
    let k = 0;
    if (x > 0 && L[i - 1]) nb[k++] = L[i - 1];
    if (y > 0) { const u = i - W; if (L[u]) nb[k++] = L[u]; if (x > 0 && L[u - 1]) nb[k++] = L[u - 1]; if (x < W - 1 && L[u + 1]) nb[k++] = L[u + 1]; }
    if (!k) { if (next >= parent.length) { const p2 = new Int32Array(parent.length * 2); p2.set(parent); parent = p2; } parent[next] = next; L[i] = next++; }
    else { let mn = nb[0]; for (let j = 1; j < k; j++) if (nb[j] < mn) mn = nb[j]; L[i] = mn; for (let j = 0; j < k; j++) if (nb[j] !== mn) unite(mn, nb[j]); }
  }
  const remap = new Int32Array(next); let count = 0;
  for (let k = 1; k < next; k++) { const r = find(k); if (!remap[r]) remap[r] = ++count; remap[k] = remap[r]; }
  const area = new Int32Array(count + 1), sx = new Float64Array(count + 1), sy = new Float64Array(count + 1);
  const bx0 = new Int32Array(count + 1).fill(1e9), by0 = new Int32Array(count + 1).fill(1e9), bx1 = new Int32Array(count + 1).fill(-1), by1 = new Int32Array(count + 1).fill(-1);
  for (let i = 0; i < L.length; i++) { if (!L[i]) continue; const l = remap[L[i]]; L[i] = l; area[l]++; const x = i % W, y = (i - x) / W; sx[l] += x; sy[l] += y; if (x < bx0[l]) bx0[l] = x; if (x > bx1[l]) bx1[l] = x; if (y < by0[l]) by0[l] = y; if (y > by1[l]) by1[l] = y; }
  const comps = []; for (let l = 1; l <= count; l++) comps.push({ label: l, area: area[l], cx: sx[l] / area[l], cy: sy[l] / area[l], bbox: [bx0[l], by0[l], bx1[l], by1[l]] });
  return { labels: L, comps };
}
/** Multi-source breadth-first growth of plant labels into lesion pixels (assigns each lesion pixel to the touching plant). */
export function growInto(labels, allow, W, H) {
  const out = labels.slice(); const q = new Int32Array(W * H); let qh = 0, qt = 0;
  for (let i = 0; i < out.length; i++) if (out[i] > 0) { const x = i % W; if ((x > 0 && allow[i - 1] && !out[i - 1]) || (x < W - 1 && allow[i + 1] && !out[i + 1]) || (i >= W && allow[i - W] && !out[i - W]) || (i < W * (H - 1) && allow[i + W] && !out[i + W])) q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++]; const x = i % W; const l = out[i];
    const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
    for (const j of nb) if (j >= 0 && j < out.length && allow[j] && !out[j]) { out[j] = l; q[qt++] = j; }
  }
  return out;
}
/** Blue reference square: pixels that are clearly blue; returns the largest blob. */
export function findBlueCard(C, ch) {
  const { R, G, B, W, H, n } = C; const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = ch.b[i] > 0.45 && B[i] > 60 && B[i] - R[i] > 40 && B[i] - G[i] > 20 ? 1 : 0;
  const cc = components(opening(m, W, H, 1), W, H); if (!cc.comps.length) return null;
  const best = cc.comps.reduce((a, c) => (c.area > a.area ? c : a));
  const [x0, y0, x1, y1] = best.bbox; const fill = best.area / ((x1 - x0 + 1) * (y1 - y0 + 1));
  if (best.area < 150 || fill < 0.6) return null;
  return { area: best.area, bbox: best.bbox, cx: best.cx, cy: best.cy };
}
