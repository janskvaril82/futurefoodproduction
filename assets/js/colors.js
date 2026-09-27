/* ==========================================================================
   colors.js — theme-aware palette, scientific colormaps, wavelength colours
   ES module. Used by plot.js, lab3d.js and individual laboratories.
   ========================================================================== */

/** Read a CSS custom property from :root (resolved for the current theme). */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Resolved theme palette. Call at draw time so theme switches are honoured. */
export function palette() {
  return {
    bg: cssVar('--bg'), bgElev: cssVar('--bg-elev'), bgSunk: cssVar('--bg-sunk'),
    ink: cssVar('--ink'), ink2: cssVar('--ink-2'), muted: cssVar('--muted'),
    line: cssVar('--line'), lineStrong: cssVar('--line-strong'),
    accent: cssVar('--accent'), magenta: cssVar('--magenta'), amber: cssVar('--amber'),
    water: cssVar('--water'), danger: cssVar('--danger'), ok: cssVar('--ok'), warn: cssVar('--warn')
  };
}

/** Categorical series colours (8), tuned for both themes. */
export function categorical(i) {
  const dark = isDark();
  const light = ['#1d7a4a', '#1c78a3', '#b23f8c', '#b86e0b', '#6a4fc2', '#c2573a', '#2e7d6b', '#6b6f2a'];
  const drk = ['#6fd39a', '#5cc8ef', '#f07ad0', '#f2b94b', '#a792f0', '#ff8f6b', '#4fd1b5', '#c9cf6a'];
  const arr = dark ? drk : light;
  return arr[((i % arr.length) + arr.length) % arr.length];
}

export function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t === 'dark';
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Resolve a colour spec: palette key ('accent', 'water', …), 'c3' categorical, integer, or any CSS colour. */
export function resolveColor(spec, fallbackIndex = 0) {
  if (spec == null) return categorical(fallbackIndex);
  if (typeof spec === 'number') return categorical(spec);
  const p = palette();
  if (p[spec]) return p[spec];
  if (/^c\d$/.test(spec)) return categorical(+spec.slice(1));
  return spec;
}

/* --------------------------------------------------------- colormaps */
const STOPS = {
  viridis: ['#440154', '#482475', '#414487', '#355f8d', '#2a788e', '#21918c', '#22a884', '#44bf70', '#7ad151', '#bddf26', '#fde725'],
  inferno: ['#000004', '#160b39', '#420a68', '#6a176e', '#932667', '#bc3754', '#dd513a', '#f37819', '#fca50a', '#f6d746', '#fcffa4'],
  magma: ['#000004', '#140e36', '#3b0f70', '#641a80', '#8c2981', '#b73779', '#de4968', '#f7705c', '#fe9f6d', '#fecf92', '#fcfdbf'],
  turbo: ['#30123b', '#4145ab', '#4675ed', '#39a2fc', '#1bcfd4', '#24eca6', '#61fc6c', '#a4fc3b', '#d1e834', '#f3c63a', '#fe9b2d', '#f36315', '#d93806', '#b11901', '#7a0402'],
  rdylgn: ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837'],
  rdbu: ['#67001f', '#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#f7f7f7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac', '#053061'],
  ndvi: ['#6b3a1e', '#8c5a2b', '#b8894a', '#d9c07a', '#e8e29a', '#bfdc7a', '#8cc55a', '#5aa83e', '#2f8a2c', '#136c1f', '#054d12'],
  blues: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'],
  greens: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#006d2c', '#00441b'],
  thermal: ['#0d0887', '#5b02a3', '#9a179b', '#cb4678', '#eb7852', '#fbb32f', '#f0f921'],
  water: ['#e9f6fb', '#bfe3f2', '#86c9e6', '#4aa8d6', '#1f7fb8', '#0f5a93', '#083a6b']
};
const cache = {};
function stopsRGB(name) {
  if (cache[name]) return cache[name];
  const s = (STOPS[name] || STOPS.viridis).map(hexToRgb);
  cache[name] = s; return s;
}
export const colormapNames = Object.keys(STOPS);

/** Sample a colormap at t∈[0,1]; returns [r,g,b] 0–255. */
export function colormap(name, t) {
  const s = stopsRGB(name);
  if (!isFinite(t)) t = 0;
  t = Math.min(1, Math.max(0, t));
  const x = t * (s.length - 1);
  const i = Math.min(s.length - 2, Math.floor(x));
  const f = x - i;
  const a = s[i], b = s[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
export function colormapCSS(name, t) { const c = colormap(name, t); return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }
/** CSS linear-gradient for legends. */
export function colormapGradient(name, dir = 'to right') {
  const n = 12; const parts = [];
  for (let i = 0; i <= n; i++) parts.push(`${colormapCSS(name, i / n)} ${(i / n * 100).toFixed(1)}%`);
  return `linear-gradient(${dir}, ${parts.join(', ')})`;
}

export function hexToRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
/** Mix a CSS hex colour with alpha → rgba() string. */
export function withAlpha(color, a) {
  if (color.startsWith('#')) { const [r, g, b] = hexToRgb(color); return `rgba(${r},${g},${b},${a})`; }
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `,${a})`);
  return color;
}

/**
 * Approximate perceived colour of monochromatic light (380–780 nm).
 * After Dan Bruton's piecewise approximation with intensity roll-off at the
 * edges of human vision. Returns [r,g,b] 0–255. Far-red (>700 nm) is shown
 * as a dim deep red, UV (<400 nm) as dim violet — both are nearly invisible.
 */
export function wavelengthToRGB(nm) {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
  else if (nm >= 440 && nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm >= 490 && nm < 510) { g = 1; b = -(nm - 510) / 20; }
  else if (nm >= 510 && nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm >= 580 && nm < 645) { r = 1; g = -(nm - 645) / 65; }
  else if (nm >= 645 && nm <= 780) { r = 1; }
  let f = 0;
  if (nm >= 380 && nm < 420) f = 0.3 + 0.7 * (nm - 380) / 40;
  else if (nm >= 420 && nm <= 700) f = 1;
  else if (nm > 700 && nm <= 780) f = 0.3 + 0.7 * (780 - nm) / 80;
  const gam = 0.8;
  const c = v => v === 0 ? 0 : Math.round(255 * Math.pow(v * f, gam));
  return [c(r), c(g), c(b)];
}
export function wavelengthCSS(nm, a = 1) { const [r, g, b] = wavelengthToRGB(nm); return `rgba(${r},${g},${b},${a})`; }
