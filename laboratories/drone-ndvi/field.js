/* Drone NDVI survey — field, sensor, zoning and prescription model (pure ES module, no DOM, no three.js).
   1. Hidden "truth": a 300 m × 200 m wheat field on a 1 m grid with N-deficient patches, waterlogged hollows,
      compacted headlands, creeping-thistle patches, tramlines and an N-rich reference strip.
   2. Canopy reflectance per band: PROSPECT-D leaf optics (band-averaged) + Kubelka–Munk canopy over soil
      (same physics as the Spectral signatures lab, ../spectral-signatures/spectra.js).
   3. Observation: ground sampling distance GSD = H·p/f, radiometric noise averaged over GSD-sized pixels,
      or 10 m Sentinel-2 pixels.
   4. Management zones by k-means (Lloyd) on the smoothed index; nitrogen prescriptions (uniform, compensating
      linear rule of Lesson 11.1, sufficiency-index rule of Holland & Schepers 2010); agronomic and economic
      evaluation against the hidden truth with a quadratic-plateau yield response. */
import { prospectD, kmCanopy, SENSORS, bandWeights, WL, NWL } from '../spectral-signatures/spectra.js';
import { SOIL_DRY, SOIL_WET } from '../spectral-signatures/optics-data.js';

export const FIELD = { W: 300, D: 200, NX: 300, NZ: 200, tram: 24, track: 0.5, wheel: 1.8, head: 12 };
export const AREA_HA = FIELD.W * FIELD.D / 1e4;

/* ------------------------------------------------------------------ seeded noise */
export function rng(seed = 1) { let a = seed >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function randn(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function makeNoise(seed) {
  const r = rng(seed), P = new Uint8Array(512), p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const g = (h, x, y) => { switch (h & 7) { case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y; case 4: return x; case 5: return -x; case 6: return y; default: return -y; } };
  const n2 = (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y), a = P[X] + Y, b = P[X + 1] + Y;
    const l1 = g(P[a], x, y) + u * (g(P[b], x - 1, y) - g(P[a], x, y));
    const l2 = g(P[a + 1], x, y - 1) + u * (g(P[b + 1], x - 1, y - 1) - g(P[a + 1], x, y - 1));
    return (l1 + v * (l2 - l1)) * 0.9;
  };
  const fbm = (x, y, oct = 4) => { let s = 0, a = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { s += a * n2(x * f + o * 17.3, y * f - o * 9.1); n += a; a *= 0.5; f *= 2; } return s / n; };
  return { n2, fbm };
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------ scenarios and crop stages */
export const SCENARIOS = {
  mixed: { label: 'Typical Mälardalen field (mixed causes)', ndef: 0.85, wet: 0.8, compact: 0.8, weeds: 0.7, strip: true, seed: 11 },
  nitrogen: { label: 'Uneven nitrogen supply (manure history)', ndef: 1.25, wet: 0.1, compact: 0.35, weeds: 0.05, strip: true, seed: 5 },
  wet: { label: 'Wet spring: waterlogged hollows', ndef: 0.35, wet: 1.35, compact: 0.4, weeds: 0.15, strip: true, seed: 23 },
  traffic: { label: 'Heavy traffic: compacted headland and gateway', ndef: 0.25, wet: 0.2, compact: 1.45, weeds: 0.1, strip: true, seed: 31 },
  weeds: { label: 'Creeping-thistle patches', ndef: 0.3, wet: 0.2, compact: 0.3, weeds: 1.4, strip: true, seed: 47 },
  uniform: { label: 'Uniform, well-managed field', ndef: 0.12, wet: 0.08, compact: 0.15, weeds: 0.04, strip: true, seed: 3 }
};
export const STAGES = {
  tiller: { label: 'BBCH 25 · tillering', lai: 1.3, h: 0.2 },
  stem: { label: 'BBCH 31 · start of stem elongation', lai: 2.6, h: 0.36 },
  flag: { label: 'BBCH 37 · flag leaf visible', lai: 4.2, h: 0.55 },
  head: { label: 'BBCH 55 · heading', lai: 5.2, h: 0.78 }
};

/* ------------------------------------------------------------------ the hidden field */
/** Tramline wheel-track centre lines: { z: [...] (tracks along x, within the inner field), x: [...] (headland loop segments along z) }. */
export function tramlines() {
  const { W, D, tram, wheel, head } = FIELD, zs = [], xs = [];
  for (let zc = -D / 2 + head; zc <= D / 2 - head + 1e-6; zc += tram) zs.push(zc - wheel / 2, zc + wheel / 2);
  const zLast = -D / 2 + head + Math.floor((D - 2 * head) / tram) * tram;
  if (D / 2 - head - zLast > 4) zs.push(D / 2 - head - wheel / 2, D / 2 - head + wheel / 2);
  [-W / 2 + head, W / 2 - head].forEach(xc => xs.push(xc - wheel / 2, xc + wheel / 2));
  return { z: zs, x: xs, xmin: -W / 2 + head - wheel / 2, xmax: W / 2 - head + wheel / 2, zmin: -D / 2 + head - wheel / 2, zmax: D / 2 - head + wheel / 2 };
}
/** Distance (m) from (x,z) to the nearest wheel-track centre line (Infinity outside the tramline system). */
export function trackDistance(x, z, T = TRAM) {
  let d = Infinity;
  if (x >= T.xmin - 0.3 && x <= T.xmax + 0.3) for (const zc of T.z) d = Math.min(d, Math.abs(z - zc));
  if (z >= T.zmin - 0.3 && z <= T.zmax + 0.3) for (const xc of T.x) d = Math.min(d, Math.abs(x - xc));
  return d;
}
const TRAM = tramlines();
export const STRIP = { x0: -118, x1: -22, z0: -63, z1: -57 };   // N-rich reference strip (6 m × 96 m)
export const GATE = { x: -150 + 18, z: 100 };                    // field entrance by the farm track

/**
 * Build the hidden field. Returns typed arrays on the 1 m grid (index k = j·NX + i, cell centre x = −W/2 + i + 0.5,
 * z = −D/2 + j + 0.5) and a function at(x,z) for continuous sampling (used by the 3D scene).
 */
export function makeField({ scenario = 'mixed', stage = 'stem', seed } = {}) {
  const S = SCENARIOS[scenario] || SCENARIOS.mixed, G = STAGES[stage] || STAGES.stem;
  const sd = seed ?? S.seed; const r = rng(sd * 7919 + 17); const nz = makeNoise(sd * 31 + 7);
  const { W, D, NX, NZ } = FIELD;
  const blobs = (n, rmin, rmax, margin) => Array.from({ length: n }, () => ({
    x: -W / 2 + margin + r() * (W - 2 * margin), z: -D / 2 + margin + r() * (D - 2 * margin),
    rad: rmin + r() * (rmax - rmin), sev: 0.55 + 0.45 * r(), ax: 0.65 + 0.7 * r(), rot: r() * Math.PI
  }));
  const nBl = blobs(4 + Math.floor(r() * 3), 18, 40, 25);
  const hollows = blobs(2, 26, 40, 45);
  const thistles = blobs(6 + Math.floor(r() * 4), 5, 12, 12);
  const blobVal = (L, x, z, noiseAmp, sc) => {
    let v = 0;
    for (const b of L) {
      const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = x - b.x, dz = z - b.z;
      const u = (dx * c + dz * s) / (b.rad * b.ax), w = (-dx * s + dz * c) * b.ax / b.rad;
      const d2 = u * u + w * w; if (d2 > 6) continue;
      v = Math.max(v, b.sev * Math.exp(-d2 * (1 + noiseAmp * nz.fbm(x / sc + b.x, z / sc - b.z, 3))));
    }
    return v;
  };
  const truth = (x, z) => {
    // soil productivity texture (≈ ±12 %) and small-scale establishment variation (≈ ±4 %)
    const tex = 1 + 0.12 * nz.fbm(x / 70 + 3.1, z / 70 - 1.7, 4) + 0.04 * nz.n2(x / 6 + 0.3, z / 6 - 0.7);
    // nitrogen: extra deficiency in patches on top of a field-wide mild N stress relative to the N-rich strip
    const ndefP = clamp(S.ndef * blobVal(nBl, x, z, 0.6, 18), 0, 1);
    // waterlogging in hollows (elevation proxy)
    const elev = -blobVal(hollows, x, z, 0.35, 30) + 0.22 * nz.fbm(x / 60 - 7, z / 60 + 2, 3);
    const wet = clamp(S.wet * smooth(0.28, 0.75, -elev), 0, 1);
    // compaction: headland band + gateway
    const dEdge = Math.min(x + W / 2, W / 2 - x, z + D / 2, D / 2 - z);
    const dGate = Math.hypot(x - GATE.x, z - GATE.z);
    const comp = clamp(S.compact * (0.6 * Math.exp(-Math.max(0, dEdge - 3) / 10) + 0.9 * Math.exp(-((dGate / 28) ** 2))) * (0.85 + 0.3 * nz.n2(x / 9, z / 9)), 0, 1);
    // creeping-thistle patches (irregular, clumpy)
    const wb = blobVal(thistles, x, z, 0.9, 6);
    const weed = clamp(S.weeds * smooth(0.25, 0.75, wb + 0.25 * nz.n2(x / 3.1 + 11, z / 3.1 - 5)), 0, 1);
    const strip = S.strip && x >= STRIP.x0 && x <= STRIP.x1 && z >= STRIP.z0 && z <= STRIP.z1 ? 1 : 0;
    const ndef = strip ? 0 : clamp(0.28 + 0.72 * ndefP, 0, 1);  // N stress index: 0 = N-rich strip, 0.28 = rest of field before the dose
    // crop state (the N-rich strip shows the potential LAI of the stage)
    const lai = G.lai * tex * (1 - 0.5 * ndef) * (1 - 0.75 * wet) * (1 - 0.5 * comp) * (1 - 0.35 * weed);
    const cab = 58 * (1 - 0.5 * ndef) * (1 - 0.4 * wet) * (1 - 0.15 * comp);
    const laiW = 1.7 * weed * Math.sqrt(G.lai / 2.6);
    const h = G.h * (1 - 0.3 * ndef) * (1 - 0.55 * wet) * (1 - 0.35 * comp) * (0.95 + 0.1 * tex);
    const soilW = clamp(0.2 + 0.55 * wet + 0.4 * (1 - tex), 0, 0.85);
    // agronomic truth: yield potential (t/ha), supplementary N need (kg/ha), response curvature
    const Yp = 8.5 * tex * (1 - 0.55 * wet) * (1 - 0.3 * comp) * (1 - 0.32 * weed);
    const Nn = strip ? 0 : Math.max(0, 60 * Yp / 8.5 + 70 * ndefP + 10 * wet);
    const c = 0.08 + 0.3 * ndef;
    return { tex, ndef, ndefP: strip ? 0 : ndefP, wet, comp, weed, strip, lai, cab, laiW, h, soilW, Yp, Nn, c };
  };
  const N = NX * NZ, A = () => new Float32Array(N);
  const F = { scenario, stage, seed: sd, NX, NZ, W, D, G, S, lai: A(), laiW: A(), cab: A(), h: A(), soilW: A(), ndef: A(), ndefP: A(), wet: A(), comp: A(), weed: A(), strip: new Uint8Array(N), track: A(), Yp: A(), Nn: A(), c: A() };
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, x = -W / 2 + i + 0.5, z = -D / 2 + j + 0.5, t = truth(x, z);
    F.lai[k] = t.lai; F.laiW[k] = t.laiW; F.cab[k] = t.cab; F.h[k] = t.h; F.soilW[k] = t.soilW; F.ndef[k] = t.ndef; F.ndefP[k] = t.ndefP; F.wet[k] = t.wet; F.comp[k] = t.comp; F.weed[k] = t.weed; F.strip[k] = t.strip;
    F.Yp[k] = t.Yp; F.Nn[k] = t.Nn; F.c[k] = t.c;
    // fraction of the cell occupied by wheel tracks (0.5 m wide each)
    let ft = 0;
    if (x >= TRAM.xmin - 0.5 && x <= TRAM.xmax + 0.5) for (const zc of TRAM.z) ft += Math.max(0, Math.min(z + 0.5, zc + 0.25) - Math.max(z - 0.5, zc - 0.25));
    if (z >= TRAM.zmin - 0.5 && z <= TRAM.zmax + 0.5) for (const xc of TRAM.x) ft += Math.max(0, Math.min(x + 0.5, xc + 0.25) - Math.max(x - 0.5, xc - 0.25));
    F.track[k] = Math.min(1, ft);
  }
  F.at = truth;
  return F;
}

/* ------------------------------------------------------------------ leaf optics per band (lookup over chlorophyll) */
const LUT = new Map();
/** Band-averaged leaf r and t for chlorophyll 0–80 µg cm⁻² (step 1) and a thistle leaf; soil dry/wet band values. */
export function bandOptics(band) {
  const key = band.id + '|' + (band.c ?? band.lo) + '|' + (band.w ?? band.hi) + '|' + (band.shape || '');
  if (LUT.has(key)) return LUT.get(key);
  const W8 = bandWeights(band), idx = W8.map(o => o.i), wts = W8.map(o => o.w);
  const avg = arr => arr.reduce((s, v, q) => s + v * wts[q], 0);
  const r = new Float32Array(81), t = new Float32Array(81);
  for (let cab = 0; cab <= 80; cab++) { const L = prospectD({ N: 1.5, cab, car: cab / 4.5, cw: 0.015, cm: 0.005 }, idx); r[cab] = avg(L.R); t[cab] = avg(L.T); }
  const Lw = prospectD({ N: 1.8, cab: 48, car: 11, cw: 0.018, cm: 0.006 }, idx);
  const o = { r, t, rw: avg(Lw.R), tw: avg(Lw.T), sd: idx.reduce((s, i, q) => s + SOIL_DRY[i] * wts[q], 0), sw: idx.reduce((s, i, q) => s + SOIL_WET[i] * wts[q], 0) };
  LUT.set(key, o); return o;
}
const lerpLUT = (arr, cab) => { const c = clamp(cab, 0, 80), i = Math.min(79, Math.floor(c)), f = c - i; return arr[i] * (1 - f) + arr[i + 1] * f; };
/** Gap-fraction canopy cover seen from nadir (Beer's law, random leaf angles, k = 0.5; as Lesson 11.2, Eq. 11.2.10). */
export const coverOf = L => 1 - Math.exp(-0.5 * L);
/**
 * Reflectance of one 1 m cell in a band: a fraction fc of vegetated clumps (Kubelka–Munk canopy of crop + weed leaves with
 * local LAI L/fc over soil) and 1 − fc of visible soil between the rows; wheel tracks are bare soil mixed linearly.
 */
export function cellBand(F, k, O) {
  const cab = F.cab[k], Lc = F.lai[k], Lw = F.laiW[k], L = Lc + Lw;
  const rc = lerpLUT(O.r, cab), tc = lerpLUT(O.t, cab);
  const r = L > 0 ? (Lc * rc + Lw * O.rw) / L : rc, t = L > 0 ? (Lc * tc + Lw * O.tw) / L : tc;
  const w = F.soilW[k], Rs = (1 - w) * O.sd + w * O.sw;
  const fc = coverOf(L), Rveg = fc > 1e-4 ? kmCanopy(r, t, L / fc, Rs) : Rs;
  const Rcrop = fc * Rveg + (1 - fc) * Rs;
  const Rtrack = 0.92 * Rs;                               // compacted wheel track, slightly darker
  return (1 - F.track[k]) * Rcrop + F.track[k] * Rtrack;
}
/** True (noise-free) band maps for a sensor: { id: Float32Array } for the bands needed by NDVI and NDRE. */
export function truthBands(F, sensorKey) {
  const S = SENSORS[sensorKey], U = S.use, ids = [...new Set([U.red, U.nir, U.re, U.nirRE].filter(Boolean))];
  const out = {};
  ids.forEach(id => { const b = S.bands.find(bb => bb.id === id), O = bandOptics(b), m = new Float32Array(F.NX * F.NZ); for (let k = 0; k < m.length; k++) m[k] = cellBand(F, k, O); out[id] = m; });
  return out;
}
/** Approximate true-colour (linear RGB 0–1) of the dense crop, soil and weed leaves at a cell — used to paint the 3D field. */
const RGB_BANDS = [{ id: 'r', c: 645, w: 40 }, { id: 'g', c: 555, w: 40 }, { id: 'b', c: 470, w: 40 }];
export function colourOptics() { return RGB_BANDS.map(b => bandOptics(b)); }

/* ------------------------------------------------------------------ cameras and survey planning */
export const CAMERAS = {
  micasense: { sensor: 'micasense', name: 'MicaSense RedEdge-MX (5 bands)', pitch: 3.75e-6, focal: 5.4e-3, nx: 1280, ny: 960, minInterval: 1, endurance: 22 },
  mavic: { sensor: 'mavic', name: 'DJI Mavic 3M (4 multispectral bands)', pitch: 1, focal: 2170, nx: 2592, ny: 1944, minInterval: 2, endurance: 35 },
  s2: { sensor: 's2', name: 'Sentinel-2 MSI (satellite, 10 m)', satellite: true, gsd: 10 }
};
export const PAD = { x: -128, z: 112 };   // take-off point on the farm track
/**
 * Plan a lawn-mower survey. H flight height (m), fwd/side overlap (0–1), speed (m s⁻¹).
 * Returns geometry, timing and a timed path (segments) with capture events.
 */
export function planSurvey({ sensor = 'micasense', H = 80, fwd = 0.75, side = 0.75, speed = 8, turnSpeed = 4, climb = 3 }) {
  const cam = CAMERAS[sensor];
  if (cam.satellite) return { satellite: true, gsd: 10, cam, images: 1, flightTime: 0, batteries: 0 };
  const { W, D } = FIELD;
  const gsd = H * cam.pitch / cam.focal;                   // m per pixel
  const Wf = cam.nx * gsd, Lf = cam.ny * gsd;              // footprint across / along track (m)
  const spacing = Wf * (1 - side);
  const nLines = Math.ceil(D / spacing) + 1;
  const trig = Lf * (1 - fwd), dtNeed = trig / speed;
  const dt = Math.max(dtNeed, cam.minInterval), trigEff = dt * speed, fwdEff = 1 - trigEff / Lf;
  const lead = Lf / 2, x0 = -W / 2 - lead, x1 = W / 2 + lead, lineLen = x1 - x0;
  const zs = Array.from({ length: nLines }, (_, i) => -(nLines - 1) * spacing / 2 + i * spacing);
  // timed path
  const segs = []; let t = 0;
  const add = (a, b, v, kind) => { const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const d = len / v; segs.push({ a, b, t0: t, t1: t + d, kind, len }); t += d; };
  const p0 = [PAD.x, 0.3, PAD.z], up = [PAD.x, H, PAD.z];
  add(p0, up, climb, 'climb');
  let cur = up; const caps = [];
  zs.forEach((z, i) => {
    const dir = i % 2 === 0 ? 1 : -1, xa = dir > 0 ? x0 : x1, xb = dir > 0 ? x1 : x0;
    const start = [xa, H, z];
    if (i === 0) add(cur, start, speed, 'transit');
    else {
      // semicircular turn outside the field: centre between the two line ends, bulging in the previous flight direction
      const R = spacing / 2, cx = cur[0], cz = (cur[2] + z) / 2, n = 10, bulge = -dir;
      let prev = cur;
      for (let q = 1; q <= n; q++) {
        const th = Math.PI * q / n;
        const pt = q === n ? start : [cx + bulge * R * Math.sin(th), H, cz - R * Math.cos(th)];
        add(prev, pt, turnSpeed, 'turn'); prev = pt;
      }
    }
    const tStart = t; add(start, [xb, H, z], speed, 'line');
    const nCap = Math.floor(lineLen / trigEff) + 1;
    for (let c = 0; c < nCap; c++) { const s = c * trigEff; caps.push({ t: tStart + s / speed, x: xa + dir * s, z, dir, line: i }); }
    cur = [xb, H, z];
  });
  add(cur, [PAD.x, H, PAD.z], speed * 1.5, 'return');
  add([PAD.x, H, PAD.z], [PAD.x, 0.3, PAD.z], climb, 'land');
  const flightTime = t;
  const survey = segs.filter(s => s.kind === 'line' || s.kind === 'turn').reduce((s, g) => s + g.len, 0);
  return {
    cam, gsd, Wf, Lf, spacing, nLines, trig, dtNeed, dt, trigEff, fwd, fwdEff, side, speed, H, lineLen, zs, segs, caps,
    images: caps.length, flightTime, surveyDist: survey, batteries: Math.ceil(flightTime / (cam.endurance * 60)),
    limited: dtNeed < cam.minInterval, pixels: AREA_HA * 1e4 / (gsd * gsd)
  };
}
/** Drone position and heading at time t along a planned path. */
export function pathAt(plan, t) {
  const S = plan.segs; if (!S.length) return { p: [PAD.x, 0.3, PAD.z], dir: [1, 0, 0], kind: 'ground' };
  let s = S[S.length - 1];
  if (t <= S[0].t0) s = S[0]; else for (const g of S) if (t <= g.t1) { s = g; break; }
  const f = s.t1 > s.t0 ? clamp((t - s.t0) / (s.t1 - s.t0), 0, 1) : 1;
  const p = [0, 1, 2].map(q => s.a[q] + (s.b[q] - s.a[q]) * f);
  const d = [s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]]; const L = Math.hypot(d[0], d[2]) || 1;
  return { p, dir: [d[0] / L, 0, d[2] / L], kind: s.kind, done: t >= S[S.length - 1].t1 };
}

/* ------------------------------------------------------------------ observation */
/**
 * Simulated orthomosaic on the 1 m grid for one sensor: band reflectances with noise, then NDVI and NDRE.
 * Drone: σ_px = 0.003 + 0.02ρ per pixel, averaged over (1 m / GSD)² pixels per cell.
 * Sentinel-2: truth averaged over 10 m pixels (20 m for red-edge bands), σ = 0.003 + 0.02ρ.
 */
export function observe(F, sensorKey, gsd, seed = 1) {
  const S = SENSORS[sensorKey], U = S.use, TB = truthBands(F, sensorKey), N = F.NX * F.NZ, r = rng(seed * 104729 + 3);
  const noisy = {};
  const sat = CAMERAS[sensorKey]?.satellite;
  Object.entries(TB).forEach(([id, m]) => {
    const out = new Float32Array(N);
    if (!sat) {
      const f = Math.min(1, gsd);   // σ/√n with n = (1/GSD)² pixels per 1 m cell
      for (let k = 0; k < N; k++) out[k] = Math.max(0.001, m[k] + (0.003 + 0.02 * m[k]) * f * randn(r));
    } else {
      const b = S.bands.find(bb => bb.id === id), px = b.res || 10;
      for (let j0 = 0; j0 < F.NZ; j0 += px) for (let i0 = 0; i0 < F.NX; i0 += px) {
        let s = 0, n = 0;
        for (let j = j0; j < Math.min(F.NZ, j0 + px); j++) for (let i = i0; i < Math.min(F.NX, i0 + px); i++) { s += m[j * F.NX + i]; n++; }
        const v = Math.max(0.001, s / n + (0.003 + 0.02 * s / n) * randn(r));
        for (let j = j0; j < Math.min(F.NZ, j0 + px); j++) for (let i = i0; i < Math.min(F.NX, i0 + px); i++) out[j * F.NX + i] = v;
      }
    }
    noisy[id] = out;
  });
  const nd = (a, b) => { const o = new Float32Array(N); for (let k = 0; k < N; k++) o[k] = (a[k] - b[k]) / (a[k] + b[k]); return o; };
  return {
    NDVI: nd(noisy[U.nir], noisy[U.red]), NDRE: U.re && U.nirRE ? nd(noisy[U.nirRE], noisy[U.re]) : null,
    trueNDVI: nd(TB[U.nir], TB[U.red]), bands: noisy, used: { NDVI: [U.nir, U.red], NDRE: [U.nirRE, U.re] }
  };
}

/* ------------------------------------------------------------------ smoothing, k-means, zones */
/** Moving-average filter with a (2r+1)² window (summed-area table), NaN-aware. */
export function boxSmooth(m, NX, NZ, rad) {
  if (rad <= 0) return Float32Array.from(m);
  const S = new Float64Array((NX + 1) * (NZ + 1)), C = new Float64Array((NX + 1) * (NZ + 1));
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const v = m[j * NX + i], ok = Number.isFinite(v);
    const q = (j + 1) * (NX + 1) + i + 1;
    S[q] = (ok ? v : 0) + S[q - 1] + S[q - NX - 1] - S[q - NX - 2];
    C[q] = (ok ? 1 : 0) + C[q - 1] + C[q - NX - 1] - C[q - NX - 2];
  }
  const out = new Float32Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const i0 = Math.max(0, i - rad), i1 = Math.min(NX, i + rad + 1), j0 = Math.max(0, j - rad), j1 = Math.min(NZ, j + rad + 1);
    const a = j1 * (NX + 1) + i1, b = j0 * (NX + 1) + i1, c = j1 * (NX + 1) + i0, d = j0 * (NX + 1) + i0;
    const n = C[a] - C[b] - C[c] + C[d];
    out[j * NX + i] = n > 0 ? (S[a] - S[b] - S[c] + S[d]) / n : NaN;
  }
  return out;
}
/** k-means (Lloyd 1982) on scalar values; centres initialised at quantiles; returns sorted centres and labels. */
export function kmeans1D(vals, k, maxIter = 60) {
  const v = Array.from(vals).filter(Number.isFinite).sort((a, b) => a - b);
  let C = Array.from({ length: k }, (_, q) => v[Math.min(v.length - 1, Math.floor((q + 0.5) / k * v.length))]);
  const lab = new Uint8Array(vals.length);
  for (let it = 0; it < maxIter; it++) {
    const s = new Float64Array(k), n = new Float64Array(k); let moved = false;
    for (let q = 0; q < vals.length; q++) {
      const x = vals[q]; if (!Number.isFinite(x)) { lab[q] = 255; continue; }
      let b = 0, bd = Infinity; for (let c = 0; c < k; c++) { const d = (x - C[c]) ** 2; if (d < bd) { bd = d; b = c; } }
      if (lab[q] !== b) moved = true; lab[q] = b; s[b] += x; n[b]++;
    }
    C = C.map((c, q) => n[q] ? s[q] / n[q] : c);
    if (!moved && it > 0) break;
  }
  // sort zones from low to high index
  const order = C.map((c, q) => [c, q]).sort((a, b) => a[0] - b[0]), remap = new Uint8Array(k);
  order.forEach(([, q], rank) => { remap[q] = rank; });
  for (let q = 0; q < lab.length; q++) if (lab[q] !== 255) lab[q] = remap[lab[q]];
  return { centres: order.map(o => o[0]), labels: lab };
}
/** Majority (mode) filter on zone labels with a (2r+1)² window — removes speckle so a spreader can follow the zones. */
export function majority(lab, NX, NZ, k, rad = 2) {
  const out = new Uint8Array(lab.length), cnt = new Int32Array(k);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    cnt.fill(0);
    for (let jj = Math.max(0, j - rad); jj <= Math.min(NZ - 1, j + rad); jj++) for (let ii = Math.max(0, i - rad); ii <= Math.min(NX - 1, i + rad); ii++) { const l = lab[jj * NX + ii]; if (l < k) cnt[l]++; }
    let b = lab[j * NX + i], bc = -1; for (let c = 0; c < k; c++) if (cnt[c] > bc) { bc = cnt[c]; b = c; }
    out[j * NX + i] = b;
  }
  return out;
}
/** Zone statistics: area share, mean and SD of the index, variance explained by the zoning. */
export function zoneStats(vi, lab, k) {
  const n = new Float64Array(k), s = new Float64Array(k), s2 = new Float64Array(k); let N = 0, S = 0, S2 = 0;
  for (let q = 0; q < vi.length; q++) { const x = vi[q], z = lab[q]; if (!Number.isFinite(x) || z >= k) continue; n[z]++; s[z] += x; s2[z] += x * x; N++; S += x; S2 += x * x; }
  const zones = Array.from({ length: k }, (_, z) => { const m = n[z] ? s[z] / n[z] : NaN; return { n: n[z], share: n[z] / N, areaHa: n[z] / 1e4, mean: m, sd: n[z] > 1 ? Math.sqrt(Math.max(0, s2[z] / n[z] - m * m)) : 0 }; });
  const sst = S2 - S * S / N; const sse = zones.reduce((a, zz, z) => a + (n[z] ? s2[z] - s[z] * s[z] / n[z] : 0), 0);
  return { zones, mean: S / N, sd: Math.sqrt(Math.max(0, sst / N)), r2: sst > 0 ? 1 - sse / sst : 0 };
}

/* ------------------------------------------------------------------ nitrogen prescriptions */
/**
 * Rates per zone (kg N ha⁻¹). strategy: 'uniform' | 'linear' (Eq. 11.1.11; β > 0 compensating, β < 0 reinforcing)
 * | 'si' (sufficiency index, Holland & Schepers 2010). Rates are rounded to 5 kg N ha⁻¹ (spreader steps).
 */
export function prescribe(zs, { strategy = 'linear', Nbar = 60, beta = 1, Nopt = 90, dSI = 0.15, Vref = 1, backoff = true, Nmax = 150 } = {}) {
  const Z = zs.zones, Vbar = zs.mean;
  let rates;
  if (strategy === 'uniform') rates = Z.map(() => Nbar);
  else if (strategy === 'linear') {
    rates = Z.map(z => Nbar * (1 - beta * (z.mean - Vbar) / Vbar));
    // clip and restore the planned total (mass conservation) by rescaling the unclipped zones
    for (let it = 0; it < 6; it++) {
      rates = rates.map(v => clamp(v, 0, Nmax));
      const tot = Z.reduce((s, z, q) => s + z.share * rates[q], 0), free = Z.reduce((s, z, q) => s + (rates[q] > 0 && rates[q] < Nmax ? z.share * rates[q] : 0), 0);
      if (Math.abs(tot - Nbar) < 0.01 || free <= 0) break;
      const f = 1 + (Nbar - tot) / free; rates = rates.map(v => v > 0 && v < Nmax ? v * f : v);
    }
  } else {
    rates = Z.map(z => {
      const SI = z.mean / Vref; let N = Nopt * Math.sqrt(clamp((1 - SI) / dSI, 0, 1));
      const s0 = 1 - dSI;                                   // SI of an unfertilised crop
      if (backoff && SI < s0) N = Nopt * clamp(1 - (s0 - SI) / 0.08, 0, 1);  // low index not caused by N shortage
      return N;
    });
  }
  return rates.map(v => Math.round(clamp(v, 0, Nmax) / 5) * 5);
}
/** Evaluate a rate map against the hidden truth. rateOf(k) → kg N ha⁻¹ for cell k. Prices in € t⁻¹ grain and € kg⁻¹ N. */
export function evaluate(F, rateOf, { grain = 210, nPrice = 1.2 } = {}) {
  let Nkg = 0, Yt = 0, surplus = 0, deficit = 0; const cellHa = 1e-4;
  for (let k = 0; k < F.NX * F.NZ; k++) {
    const N = rateOf(k), Nn = F.Nn[k], Yp = F.Yp[k];
    const Y = Nn > 0 ? Yp * (1 - F.c[k] * (1 - Math.min(N, Nn) / Nn) ** 2) : Yp;
    Nkg += N * cellHa; Yt += Y * cellHa; surplus += Math.max(0, N - Nn) * cellHa; deficit += Math.max(0, Nn - N) * cellHa;
  }
  return { Nkg, Yt, surplus, deficit, revenue: Yt * grain, nCost: Nkg * nPrice, net: Yt * grain - Nkg * nPrice };
}
export { WL, NWL };
