/* High-moisture extrusion — 3-D scene (twin-screw extruder, feeder, water dosing, cooling die, cutter).
   All dimensions in metres; the machine axis is +x, screws at y = Y0. */
import { THREE, M, canvasTexture, makeRoom, makePipe, FlowAlong, Mist, RoundedBoxGeometry, BufferGeometryUtils, rng, fbm2, heatmapTexture } from '/assets/js/lab3d.js';
import { colormap } from '/assets/js/colors.js';
import { G, SCREW, profileR } from './model.js';

export const Y0 = 1.05;              // screw axis height
const BW = 0.10, BH = 0.10;          // barrel block size (z, y)
const C = G.a / 2, RB = G.Rb;
const BETA = Math.acos(C / RB), YC = Math.sqrt(RB * RB - C * C);
export const X_DIE0 = G.L + G.adapter + 0.012;   // start of cooling die

/* ------------------------------------------------------------ helpers */
const tcol = (T, lo = 20, hi = 200) => { const c = colormap('inferno', Math.min(1, Math.max(0, (T - lo) / (hi - lo))) * 0.9 + 0.08); return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255); };
function arcPts(cx, cy, r, a0, a1, n) { const out = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a))); } return out; }
/** Cross-section of the lower (top = false) or upper half of a barrel block with a figure-eight bore. Shape coords (u = z, v = y). */
function halfShape(w, h, top) {
  const s = top ? -1 : 1; // build lower half, mirror for upper
  const pts = [new THREE.Vector2(-w / 2, -h / 2), new THREE.Vector2(w / 2, -h / 2), new THREE.Vector2(w / 2, 0), new THREE.Vector2(C + RB, 0)];
  pts.push(...arcPts(C, 0, RB, 0, -(Math.PI - BETA), 18).slice(1));
  pts.push(...arcPts(-C, 0, RB, -BETA, -Math.PI, 18).slice(1));
  pts.push(new THREE.Vector2(-w / 2, 0));
  const p2 = pts.map(p => new THREE.Vector2(p.x, s * p.y));
  if (top) p2.reverse();
  return new THREE.Shape(p2);
}
/** Upper half with a feed-port notch (two separate pieces). */
function notchedTopShapes(w, h, n) {
  const vN = Math.sqrt(Math.max(0, RB * RB - (n - C) ** 2));
  const aN = Math.atan2(vN, n - C);
  const right = [new THREE.Vector2(w / 2, 0), new THREE.Vector2(w / 2, h / 2), new THREE.Vector2(n, h / 2), new THREE.Vector2(n, vN), ...arcPts(C, 0, RB, aN, 0, 10).slice(1)];
  const left = right.map(p => new THREE.Vector2(-p.x, p.y)).reverse();
  return [new THREE.Shape(right.reverse()), new THREE.Shape(left.reverse())];
}
/** Extrude a (u,v) shape along +x from x0 over len; u → world z, v → world y. */
function extrudeX(shape, x0, len, curveSegments = 18) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments });
  g.rotateY(Math.PI / 2); g.translate(x0, Y0, 0);
  return g;
}
const shadow = o => { o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
function box(w, h, d, mat, x, y, z, r = 0.004) { const m = new THREE.Mesh(r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)) : new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; }
function cyl(r0, r1, h, mat, seg = 24) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat); m.castShadow = m.receiveShadow = true; return m; }

/* ------------------------------------------------------------ procedural textures */
function grooveTex() { return canvasTexture(256, 64, (ctx, w, h) => { ctx.fillStyle = '#bbb'; ctx.fillRect(0, 0, w, h); for (let i = 0; i < 16; i++) { const x = i * w / 16; const g = ctx.createLinearGradient(x, 0, x + w / 16, 0); g.addColorStop(0, '#666'); g.addColorStop(0.3, '#eee'); g.addColorStop(0.7, '#ddd'); g.addColorStop(1, '#666'); ctx.fillStyle = g; ctx.fillRect(x, 0, w / 16, h); } }, { srgb: false, key: 'ex-groove' }); }
const PRODUCT_TEX = {};
function productTextures(kind) {
  if (PRODUCT_TEX[kind]) return PRODUCT_TEX[kind];
  const r = rng(kind.length * 17 + 3);
  let map, bump, end;
  if (kind === 'fibrous') {
    map = canvasTexture(512, 128, (ctx, w, h) => {
      ctx.fillStyle = '#d9bb93'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) { const y = r() * h, x = r() * w - 40, L = 40 + r() * 260; const l = 0.55 + r() * 0.6; ctx.strokeStyle = `rgba(${Math.min(255, Math.round(200 * l))},${Math.min(255, Math.round(158 * l))},${Math.min(255, Math.round(112 * l))},${0.28 + r() * 0.4})`; ctx.lineWidth = 0.5 + r() * 1.8; ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + L / 3, y + (r() - 0.5) * 3, x + 2 * L / 3, y + (r() - 0.5) * 3, x + L, y + (r() - 0.5) * 2); ctx.stroke(); }
      for (let i = 0; i < 90; i++) { const y = r() * h, x = r() * w - 60, L = 80 + r() * 300; ctx.strokeStyle = 'rgba(120,80,45,0.45)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + L, y + (r() - 0.5) * 2); ctx.stroke(); }
    }, { repeat: [1, 1] });
    bump = canvasTexture(512, 128, (ctx, w, h) => { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h); for (let i = 0; i < 700; i++) { const y = r() * h, x = r() * w, L = 60 + r() * 260; ctx.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1 + r() * 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + L, y + (r() - 0.5) * 3); ctx.stroke(); } }, { srgb: false });
    end = canvasTexture(256, 64, (ctx, w, h) => { ctx.fillStyle = '#d9bb90'; ctx.fillRect(0, 0, w, h); for (let k = 0; k < 14; k++) { const y = (k + 0.5) * h / 14 + (r() - 0.5) * 2; ctx.fillStyle = `rgba(150,105,65,${0.25 + r() * 0.2})`; ctx.fillRect(0, y, w, 1.2); } for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(${140 + r() * 60},${100 + r() * 40},${60 + r() * 30},0.5)`; ctx.beginPath(); ctx.ellipse(r() * w, r() * h, 1.5 + r() * 3, 0.6 + r() * 0.8, 0, 0, 2 * Math.PI); ctx.fill(); } });
  } else if (kind === 'expanded') {
    map = canvasTexture(256, 256, (ctx, w, h) => { ctx.fillStyle = '#ecd6ad'; ctx.fillRect(0, 0, w, h); for (let i = 0; i < 520; i++) { const x = r() * w, y = r() * h, s = 1 + r() * 7; ctx.fillStyle = `rgba(150,110,60,${0.35 + r() * 0.4})`; ctx.beginPath(); ctx.ellipse(x, y, s * 1.3, s, 0, 0, 2 * Math.PI); ctx.fill(); } });
    bump = canvasTexture(256, 256, (ctx, w, h) => { ctx.fillStyle = '#9a9a9a'; ctx.fillRect(0, 0, w, h); for (let i = 0; i < 520; i++) { const x = r() * w, y = r() * h, s = 1 + r() * 7; ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.beginPath(); ctx.ellipse(x, y, s * 1.3, s, 0, 0, 2 * Math.PI); ctx.fill(); } }, { srgb: false });
    end = map;
  } else if (kind === 'none') {
    map = canvasTexture(256, 64, (ctx, w, h) => { ctx.fillStyle = '#d8b88c'; ctx.fillRect(0, 0, w, h); for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(${170 + r() * 40},${130 + r() * 30},${90 + r() * 25},0.18)`; ctx.fillRect(r() * w, r() * h, 2 + r() * 4, 2 + r() * 4); } });
    bump = canvasTexture(128, 32, (ctx, w, h) => { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h); for (let i = 0; i < 200; i++) { ctx.fillStyle = `rgba(${r() < 0.5 ? 255 : 0},${r() < 0.5 ? 255 : 0},0,0.08)`; ctx.fillRect(r() * w, r() * h, 3, 3); } }, { srgb: false });
    end = map;
  } else {
    map = canvasTexture(256, 64, (ctx, w, h) => { ctx.fillStyle = '#4a2a14'; ctx.fillRect(0, 0, w, h); for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(${20 + r() * 30},${10 + r() * 15},${5 + r() * 8},0.6)`; ctx.fillRect(r() * w, r() * h, 2 + r() * 6, 1 + r() * 3); } ctx.strokeStyle = 'rgba(10,5,2,0.8)'; for (let i = 0; i < 30; i++) { ctx.lineWidth = 0.6 + r(); ctx.beginPath(); let x = r() * w, y = r() * h; ctx.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 12; ctx.lineTo(x, y); } ctx.stroke(); } });
    bump = map; end = map;
  }
  return (PRODUCT_TEX[kind] = { map, bump, end });
}
const PRODUCT_MAT = {};
export function productMaterials(kind, brown = 0) {
  const b = Math.round(Math.min(1, Math.max(0, brown)) * 4);
  const key = kind + b;
  if (PRODUCT_MAT[key]) return PRODUCT_MAT[key];
  const t = productTextures(kind);
  const tint = new THREE.Color(1, 1, 1).lerp(new THREE.Color(0.62, 0.45, 0.3), kind === 'burnt' ? 0 : b / 4);
  const rough = kind === 'none' ? 0.38 : kind === 'expanded' ? 0.9 : kind === 'burnt' ? 0.85 : 0.62;
  const side = new THREE.MeshPhysicalMaterial({ color: tint, map: t.map, bumpMap: t.bump, bumpScale: kind === 'expanded' ? 3 : 1.4, roughness: rough, clearcoat: kind === 'none' ? 0.5 : 0.15, clearcoatRoughness: 0.4, sheen: 0.3, sheenColor: new THREE.Color(0xfff0dd) });
  const endM = new THREE.MeshPhysicalMaterial({ color: tint, map: t.end, roughness: 0.75, sheen: 0.2 });
  // BoxGeometry groups: +x, −x, +y, −y, +z, −z
  return (PRODUCT_MAT[key] = [endM, endM, side, side, side, side]);
}

/* ------------------------------------------------------------ screw geometry (Erdmenger profile) */
function screwGeometry(phase) {
  const Mseg = 56; const geos = [];
  const ring = (x, th) => { const a = []; for (let j = 0; j < Mseg; j++) { const t = 2 * Math.PI * j / Mseg; const r = profileR(t) - 0.00005; a.push(x, r * Math.cos(t + th), r * Math.sin(t + th)); } return a; };
  const cap = (x, th, dir) => { const pos = [x, 0, 0], idx = []; const rr = ring(x, th); pos.push(...rr); for (let j = 0; j < Mseg; j++) { const a = 1 + j, b = 1 + (j + 1) % Mseg; if (dir > 0) idx.push(0, a, b); else idx.push(0, b, a); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };
  const tube = (xs, ths) => { const pos = [], idx = []; xs.forEach((x, i) => pos.push(...ring(x, ths[i]))); for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < Mseg; j++) { const a = i * Mseg + j, b = i * Mseg + (j + 1) % Mseg, c = a + Mseg, d = b + Mseg; idx.push(a, b, c, b, d, c); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };
  let ang = phase;
  for (const e of SCREW) {
    if (e.type === 'conv' || e.type === 'pb') {
      const n = Math.max(2, Math.ceil((e.x1 - e.x0) / e.pitch * 16));
      const xs = [], ths = [];
      for (let i = 0; i <= n; i++) { const x = e.x0 + (e.x1 - e.x0) * i / n; xs.push(x); ths.push(ang - 2 * Math.PI * (x - e.x0) / e.pitch); }
      geos.push(tube(xs, ths), cap(e.x0, ths[0], -1), cap(e.x1, ths[n], 1));
      ang = ths[n];
    } else {
      const nd = 5, w = (e.x1 - e.x0) / nd, st = e.type === 'kb45' ? -Math.PI / 4 : Math.PI / 2;
      for (let k = 0; k < nd; k++) { const th = ang + (k + 1) * st, x0 = e.x0 + k * w + 0.0003, x1 = e.x0 + (k + 1) * w - 0.0003; geos.push(tube([x0, x1], [th, th]), cap(x0, th, -1), cap(x1, th, 1)); }
      ang += nd * st;
    }
  }
  // splined shaft end into the drive
  const shaft = new THREE.CylinderGeometry(0.0075, 0.0075, 0.13, 20); shaft.rotateZ(Math.PI / 2); shaft.translate(-0.065, 0, 0); shaft.deleteAttribute('uv');
  geos.push(shaft);
  const merged = BufferGeometryUtils.mergeGeometries(geos.map(g => { if (g.attributes.uv) g.deleteAttribute('uv'); return g.index ? g : g; }), false);
  geos.forEach(g => g.dispose());
  return merged;
}

/* ------------------------------------------------------------ material fill inside the bore */
const LOW = (() => { const pts = []; arcPts(-C, 0, RB, Math.PI, 2 * Math.PI - BETA, 16).forEach(p => pts.push([p.x, p.y])); arcPts(C, 0, RB, Math.PI + BETA, 2 * Math.PI, 16).slice(1).forEach(p => pts.push([p.x, p.y])); return pts; })();
function fillGeometry(stations, colours) {
  // stations: [{x, level}] ; loop = lower bore curve clamped at level + top chord
  const NT = 10, loopN = LOW.length + NT;
  const pos = [], col = [], uv = [], idx = [];
  stations.forEach((s, i) => {
    const yl = s.level;
    const loop = LOW.map(([z, y]) => [z, Math.min(y, yl)]);
    const zr = LOW[LOW.length - 1][0], zl = LOW[0][0];
    for (let k = 1; k <= NT; k++) loop.push([zr + (zl - zr) * k / (NT + 1), yl]);
    loop.forEach(([z, y], k) => { pos.push(s.x, Y0 + y, -z); uv.push(s.x / 0.035, k / loopN); const c = colours[i]; col.push(c.r, c.g, c.b); });
  });
  for (let i = 0; i < stations.length - 1; i++) for (let k = 0; k < loopN; k++) { const a = i * loopN + k, b = i * loopN + (k + 1) % loopN, c = a + loopN, d = b + loopN; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------ HMI screen */
function drawHMI(ctx, w, h, d) {
  ctx.fillStyle = '#0b1418'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#12303a'; ctx.fillRect(0, 0, w, 34);
  ctx.fillStyle = '#9be7b6'; ctx.font = '600 18px Inter, sans-serif'; ctx.fillText('HME LINE 1  ·  twin-screw 26 mm', 12, 23);
  ctx.fillStyle = d.run ? '#6fd39a' : '#f2b94b'; ctx.beginPath(); ctx.arc(w - 18, 17, 7, 0, 7); ctx.fill();
  const kv = [['Screw speed', d.N.toFixed(0) + ' rpm'], ['Torque', d.tq.toFixed(0) + ' %'], ['SME', d.sme.toFixed(0) + ' kWh/t'], ['Melt at die', d.Tm.toFixed(0) + ' °C'], ['Feed / water', d.qs.toFixed(1) + ' / ' + d.qw.toFixed(1) + ' kg/h'], ['Die exit core', d.Tex.toFixed(0) + ' °C']];
  ctx.font = '500 14px JetBrains Mono, monospace';
  kv.forEach(([k, v], i) => { const x = 12 + (i % 2) * 250, y = 60 + Math.floor(i / 2) * 26; ctx.fillStyle = '#86a3ad'; ctx.fillText(k, x, y); ctx.fillStyle = '#e6eee9'; ctx.fillText(v, x + 118, y); });
  // zone bars
  const x0 = 14, y0 = 146, bw = 58, bh = 110;
  ctx.fillStyle = '#86a3ad'; ctx.font = '500 12px Inter, sans-serif'; ctx.fillText('Barrel zones (set / actual °C)', x0, y0 - 8);
  d.zones.forEach((z, i) => {
    const x = x0 + i * (bw + 10), f = Math.min(1, Math.max(0, (z.act - 20) / 180)), fs = Math.min(1, Math.max(0, (z.set - 20) / 180));
    ctx.fillStyle = '#1b2a30'; ctx.fillRect(x, y0, bw, bh);
    const c = tcol(z.act); ctx.fillStyle = `rgb(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0})`; ctx.fillRect(x, y0 + bh * (1 - f), bw, bh * f);
    ctx.strokeStyle = '#e6eee9'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y0 + bh * (1 - fs)); ctx.lineTo(x + bw, y0 + bh * (1 - fs)); ctx.stroke();
    ctx.fillStyle = '#e6eee9'; ctx.font = '600 12px JetBrains Mono, monospace'; ctx.fillText(z.set.toFixed(0), x + 4, y0 + bh + 16); ctx.fillStyle = '#9be7b6'; ctx.fillText(z.act.toFixed(0), x + 30, y0 + bh + 16);
    ctx.fillStyle = '#86a3ad'; ctx.fillText('Z' + (i + 1), x + 18, y0 + bh + 32);
  });
  ctx.fillStyle = d.cls === 'fibrous' ? '#6fd39a' : d.cls === 'none' ? '#f2b94b' : '#ff8f6b';
  ctx.font = '600 15px Inter, sans-serif'; ctx.fillText('Product: ' + d.label, 12, h - 12);
}

/* ================================================================= build */
export function buildScene(stage) {
  const { scene, renderer } = stage;
  renderer.localClippingEnabled = true;
  const api = { pickables: [], anchors: {} };
  const room = makeRoom({ w: 9, d: 7, h: 3.6, wallColor: 0xc9d1cd, floor: 'epoxy' });
  room.floor.material.color.set(0x8c9892); room.position.x = 0.5; scene.add(room);
  // ceiling light panels
  const panelMat = new THREE.MeshBasicMaterial({ color: 0xfaf8f2 });
  [[-1.4, -1.2], [1.2, -1.2], [3.2, -1.2], [-1.4, 1.4], [1.2, 1.4], [3.2, 1.4]].forEach(([x, z]) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), panelMat); p.rotation.x = Math.PI / 2; p.position.set(x, 3.59, z); scene.add(p); });

  const paint = M.paintedSteel(0xb6beb9), dark = M.paintedSteel(0x3b4650), steel = M.steel(), alu = M.aluminium();
  const stain = new THREE.MeshStandardMaterial({ color: 0xc4c9cd, metalness: 1, roughness: 0.28 });
  const blueMotor = M.paintedSteel(0x2c5a86);

  /* ---- context: floor markings, electrical cabinet, sacks, utilities, work table */
  const ctxG = new THREE.Group(); scene.add(ctxG);
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe0b91c, roughness: 0.55 });
  const mark = (x0, z0, x1, z1) => { const g = new THREE.PlaneGeometry(Math.hypot(x1 - x0, z1 - z0), 0.06); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, yellow); m.rotation.y = -Math.atan2(z1 - z0, x1 - x0); m.position.set((x0 + x1) / 2, 0.004, (z0 + z1) / 2); m.receiveShadow = true; ctxG.add(m); };
  mark(-1.35, -1.0, 3.9, -1.0); mark(-1.35, 1.05, 3.9, 1.05); mark(-1.35, -1.0, -1.35, 1.05); mark(3.9, -1.0, 3.9, 1.05);
  const cab = new THREE.Group(); cab.position.set(-2.4, 0, -3.25);
  cab.add(box(0.8, 2.0, 0.4, M.paintedSteel(0xbfc4c6), 0, 1.0, 0, 0.01), box(0.012, 1.9, 0.01, dark, 0, 1.0, 0.203, 0.002), box(0.02, 0.18, 0.03, dark, 0.34, 1.05, 0.215, 0.004), box(0.8, 0.1, 0.4, dark, 0, 0.05, 0, 0.004));
  [0xff3b30, 0x34c759, 0xffcc00].forEach((c, i) => { const l = cyl(0.012, 0.012, 0.02, M.emissive(c, 2.2), 16); l.rotation.x = Math.PI / 2; l.position.set(-0.25 + i * 0.07, 1.78, 0.21); cab.add(l); });
  cab.add(box(0.2, 1.6, 0.1, M.galvanised(), 0, 2.8, 0, 0.004));
  ctxG.add(cab);
  const pallet = new THREE.Group(); pallet.position.set(-0.55, 0, -1.55);
  const wood = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.85 });
  [-0.35, 0, 0.35].forEach(z => pallet.add(box(1.2, 0.1, 0.1, wood, 0, 0.05, z, 0.004)));
  for (let i = 0; i < 7; i++) pallet.add(box(0.1, 0.022, 0.8, wood, -0.55 + i * 0.183, 0.111, 0, 0.003));
  const sackTex = canvasTexture(256, 160, (c, w, h) => { c.fillStyle = '#c8a877'; c.fillRect(0, 0, w, h); const r = rng(5); for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(90,60,30,${r() * 0.06})`; c.fillRect(r() * w, r() * h, 2, 2); } c.fillStyle = '#f4efe4'; c.fillRect(24, 40, w - 48, 80); c.fillStyle = '#2f6b3d'; c.font = '700 22px Inter, sans-serif'; c.fillText('SOY PROTEIN', 40, 72); c.fillText('CONCENTRATE', 40, 98); c.fillStyle = '#333'; c.font = '600 14px Inter, sans-serif'; c.fillText('25 kg · food grade', 40, 116); }, { key: 'ex-sack' });
  const sackMat = new THREE.MeshStandardMaterial({ map: sackTex, roughness: 0.9 });
  const sackGeo = new RoundedBoxGeometry(0.56, 0.13, 0.38, 3, 0.05);
  for (let l = 0; l < 3; l++) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const s = new THREE.Mesh(sackGeo, sackMat); s.position.set(-0.29 + i * 0.58 + (l % 2) * 0.02, 0.19 + l * 0.13, -0.2 + j * 0.4); s.rotation.y = (l % 2 ? 0.02 : -0.015) + (i + j) * 0.01; s.castShadow = s.receiveShadow = true; pallet.add(s); }
  ctxG.add(pallet);
  [[2.6, 0x2e7d4f, 0.03], [2.72, 0x2f6fd6, 0.022], [2.84, 0x8a8f94, 0.04]].forEach(([y, c, rad]) => ctxG.add(makePipe([[-4, y, -3.42], [5, y, -3.42]], { radius: rad, material: M.plastic(c, 0.4), segments: 8 })));
  for (let x = -3.5; x < 5; x += 1.5) ctxG.add(box(0.03, 0.34, 0.08, M.galvanised(), x, 2.72, -3.44, 0.003));
  const table = new THREE.Group(); table.position.set(3.4, 0, -3.0);
  table.add(box(1.6, 0.03, 0.75, stain, 0, 0.9, 0, 0.006), box(1.5, 0.02, 0.65, stain, 0, 0.2, 0, 0.004));
  [[-0.75, -0.33], [0.75, -0.33], [-0.75, 0.33], [0.75, 0.33]].forEach(([x, z]) => table.add(box(0.035, 0.9, 0.035, stain, x, 0.45, z, 0.004)));
  const board = box(0.45, 0.02, 0.3, M.plastic(0xf3f3ee, 0.5), -0.35, 0.925, 0.05, 0.005); table.add(board);
  const scale = box(0.3, 0.06, 0.3, M.plasticGrey(), 0.45, 0.945, 0, 0.01); table.add(scale);
  ctxG.add(table);
  api.tableTop = new THREE.Vector3(3.05, 0.94, -2.95);
  shadow(ctxG);

  /* ---- machine bed */
  const bed = new THREE.Group(); scene.add(bed);
  bed.add(box(1.95, 0.76, 0.56, paint, -0.12, 0.40, -0.02, 0.012));
  bed.add(box(1.97, 0.025, 0.58, stain, -0.12, 0.79, -0.02, 0.004));
  bed.add(box(1.9, 0.05, 0.5, dark, -0.12, 0.04, -0.02, 0.004));
  for (let i = 0; i < 3; i++) { const door = box(0.58, 0.56, 0.01, M.paintedSteel(0xd3d7d3), -0.78 + i * 0.62, 0.42, 0.265, 0.004); bed.add(door); const h = box(0.012, 0.12, 0.018, dark, -0.55 + i * 0.62, 0.45, 0.275, 0.003); bed.add(h); }
  [[-1.0, -0.26], [-1.0, 0.22], [0.75, -0.26], [0.75, 0.22]].forEach(([x, z]) => { const f = cyl(0.03, 0.035, 0.025, steel); f.position.set(x, 0.012, z); bed.add(f); });
  // barrel pedestals
  [0.18, 0.60].forEach(x => bed.add(box(0.07, Y0 - BH / 2 - 0.8, 0.12, dark, x, 0.8 + (Y0 - BH / 2 - 0.8) / 2, 0, 0.003)));

  /* ---- drive: motor, coupling, gearbox, lantern */
  const drive = new THREE.Group(); scene.add(drive);
  const motor = cyl(0.13, 0.13, 0.38, blueMotor, 40); motor.rotation.z = Math.PI / 2; motor.position.set(-0.8, 0.96, 0); drive.add(motor);
  const finGeo = new THREE.BoxGeometry(0.34, 0.03, 0.012); const fins = new THREE.InstancedMesh(finGeo, blueMotor, 28); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), a); m4.compose(new THREE.Vector3(-0.8, 0.96 + Math.cos(a) * 0.14, Math.sin(a) * 0.14), q, sc); fins.setMatrixAt(i, m4); }
  fins.castShadow = true; drive.add(fins);
  const fan = cyl(0.135, 0.135, 0.06, M.paintedSteel(0x234a70), 40); fan.rotation.z = Math.PI / 2; fan.position.set(-1.02, 0.96, 0); drive.add(fan);
  const grille = new THREE.Mesh(new THREE.CircleGeometry(0.12, 40), new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.6, alphaMap: canvasTexture(128, 128, (c, w) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, w); c.fillStyle = '#000'; for (let i = 0; i < 12; i++) { c.beginPath(); c.arc(64, 64, 8 + i * 4.6, 0, 7); c.lineWidth = 2; c.strokeStyle = '#000'; c.stroke(); } }, { srgb: false, key: 'ex-grille' }), alphaTest: 0.5, side: THREE.DoubleSide }));
  grille.rotation.y = -Math.PI / 2; grille.position.set(-1.051, 0.96, 0); drive.add(grille);
  drive.add(box(0.12, 0.08, 0.12, blueMotor, -0.8, 1.13, 0.0, 0.01));
  const coup = cyl(0.075, 0.075, 0.12, M.paintedSteel(0xe2b221), 30); coup.rotation.z = Math.PI / 2; coup.position.set(-0.55, 0.96, 0); drive.add(coup);
  const gear = box(0.36, 0.40, 0.34, M.paintedSteel(0x46525c), -0.30, 1.03, 0, 0.02); drive.add(gear);
  for (let i = 0; i < 6; i++) drive.add(box(0.30, 0.012, 0.35, M.paintedSteel(0x46525c), -0.30, 0.9 + i * 0.05, 0, 0.004));
  const sight = cyl(0.016, 0.016, 0.01, M.glassCheap(0.5)); sight.rotation.x = Math.PI / 2; sight.position.set(-0.24, 0.95, 0.172); drive.add(sight);
  // lantern with safety window
  drive.add(box(0.012, 0.16, 0.16, stain, -0.115, Y0, 0, 0.003));
  [-0.07, 0.07].forEach(z => { drive.add(box(0.105, 0.012, 0.012, stain, -0.06, Y0 + 0.07, z, 0.002)); drive.add(box(0.105, 0.012, 0.012, stain, -0.06, Y0 - 0.07, z, 0.002)); });
  const guard = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.13), M.glassCheap(0.12)); guard.position.set(-0.06, Y0, 0.075); drive.add(guard);
  shadow(drive);

  /* ---- barrel sections (bottom & top halves, heater bands, flanges) */
  const barrel = new THREE.Group(); scene.add(barrel);
  const topGroup = new THREE.Group(); scene.add(topGroup);
  const blockMat = new THREE.MeshStandardMaterial({ color: 0xb9bec2, metalness: 0.9, roughness: 0.34 });
  const blockMatTop = blockMat.clone();
  const flangeMat = new THREE.MeshStandardMaterial({ color: 0xc4c9cd, metalness: 1, roughness: 0.28 });
  const bandTex = grooveTex();
  const bands = [];
  const secBottom = [], secTop = [];
  for (let i = 0; i < G.nSec; i++) {
    const x0 = i * G.secLen + 0.003, len = G.secLen - 0.006;
    const b = new THREE.Mesh(extrudeX(halfShape(BW, BH, false), x0, len), blockMat); b.castShadow = b.receiveShadow = true; b.userData.info = { kind: 'zone', i }; barrel.add(b); secBottom.push(b);
    let tops;
    if (i === 0) {
      const xp0 = 0.034, xp1 = 0.074;
      const t1 = new THREE.Mesh(extrudeX(halfShape(BW, BH, true), x0, xp0 - x0), blockMatTop), t3 = new THREE.Mesh(extrudeX(halfShape(BW, BH, true), xp1, x0 + len - xp1), blockMatTop);
      const [sr, sl] = notchedTopShapes(BW, BH, 0.022);
      const t2 = new THREE.Mesh(extrudeX(sr, xp0, xp1 - xp0), blockMatTop), t4 = new THREE.Mesh(extrudeX(sl, xp0, xp1 - xp0), blockMatTop);
      tops = [t1, t2, t3, t4];
    } else tops = [new THREE.Mesh(extrudeX(halfShape(BW, BH, true), x0, len), blockMatTop)];
    tops.forEach(t => { t.castShadow = t.receiveShadow = true; t.userData.info = { kind: 'zone', i }; topGroup.add(t); });
    secTop.push(tops);
    // heater band: bottom U and top cap, colour coded
    const bm = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.55, roughness: 0.42, bumpMap: bandTex, bumpScale: 1.5, emissive: 0x000000 });
    const bl = G.secLen * 0.62, bx = i * G.secLen + G.secLen / 2, e = 0.008;
    const pb = [box(bl, e, BW + 2 * e, bm, bx, Y0 - BH / 2 - e / 2, 0, 0.003), box(bl, BH / 2 + e, e, bm, bx, Y0 - BH / 4 - e / 2, BW / 2 + e / 2, 0.003), box(bl, BH / 2 + e, e, bm, bx, Y0 - BH / 4 - e / 2, -BW / 2 - e / 2, 0.003)];
    const pt = [box(bl, e, BW + 2 * e, bm, bx, Y0 + BH / 2 + e / 2, 0, 0.003), box(bl, BH / 2 + e, e, bm, bx, Y0 + BH / 4 + e / 2, BW / 2 + e / 2, 0.003), box(bl, BH / 2 + e, e, bm, bx, Y0 + BH / 4 + e / 2, -BW / 2 - e / 2, 0.003)];
    pb.forEach(m => { m.userData.info = { kind: 'zone', i }; barrel.add(m); }); pt.forEach(m => { m.userData.info = { kind: 'zone', i }; topGroup.add(m); });
    if (i === 0) { pt[0].visible = false; }
    bands.push({ mat: bm, meshes: [...pb, ...pt] });
    // thermocouple on top
    if (i > 0) { const tc = cyl(0.005, 0.005, 0.04, steel, 12); tc.position.set(bx + bl / 2 + 0.012, Y0 + BH / 2 + 0.02, 0.02); topGroup.add(tc); const cab = makePipe([[bx + bl / 2 + 0.012, Y0 + BH / 2 + 0.04, 0.02], [bx + bl / 2 + 0.02, Y0 + BH / 2 + 0.09, -0.02], [bx + bl / 2 + 0.03, Y0 + 0.12, -0.09]], { radius: 0.0025, material: M.plasticBlack() }); topGroup.add(cab); }
    // cooling-water fittings + hoses (back side)
    const fit = cyl(0.006, 0.006, 0.02, M.brass(), 12); fit.rotation.x = Math.PI / 2; fit.position.set(bx - 0.03, Y0 - 0.02, -BW / 2 - 0.018); barrel.add(fit);
    const fit2 = fit.clone(); fit2.position.x = bx + 0.03; barrel.add(fit2);
    if (i < G.nSec - 1) barrel.add(makePipe([[bx + 0.03, Y0 - 0.02, -BW / 2 - 0.028], [bx + G.secLen / 2, Y0 - 0.06, -BW / 2 - 0.06], [bx + G.secLen - 0.03, Y0 - 0.02, -BW / 2 - 0.028]], { radius: 0.005, material: M.plastic(0x2f6fd6, 0.5) }));
  }
  // flanges with bolts
  const boltGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.006, 6); boltGeo.rotateZ(Math.PI / 2);
  const bolts = new THREE.InstancedMesh(boltGeo, steel, (G.nSec + 1) * 5), boltsT = new THREE.InstancedMesh(boltGeo, steel, (G.nSec + 1) * 3); let nb = 0, nt = 0;
  for (let k = 0; k <= G.nSec; k++) {
    const x = k * G.secLen; const fw = 0.118;
    const fb = new THREE.Mesh(extrudeX(halfShape(fw, fw, false), x - 0.003, 0.006), flangeMat); fb.castShadow = true; barrel.add(fb);
    const ft = new THREE.Mesh(extrudeX(halfShape(fw, fw, true), x - 0.003, 0.006), flangeMat); ft.castShadow = true; topGroup.add(ft);
    [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, -1.1], [0, 1.1], [-1.1, -0.3], [1.1, -0.3]].forEach(([u, v]) => { m4.makeTranslation(x + 0.004, Y0 + v * 0.047, u * 0.047); if (v > 0) boltsT.setMatrixAt(nt++, m4); else bolts.setMatrixAt(nb++, m4); });
  }
  bolts.count = nb; bolts.castShadow = true; barrel.add(bolts); boltsT.count = nt; boltsT.castShadow = true; topGroup.add(boltsT);
  // die adapter + die plate
  const adapt = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.07, G.adapter, 4, 1), flangeMat); adapt.rotation.z = -Math.PI / 2; adapt.rotation.x = Math.PI / 4; adapt.position.set(G.L + G.adapter / 2, Y0, 0); adapt.castShadow = true; barrel.add(adapt);
  const plate = box(0.012, 0.13, 0.13, flangeMat, X_DIE0 - 0.006, Y0, 0, 0.003); barrel.add(plate);
  const ptrans = cyl(0.008, 0.008, 0.05, steel, 16); ptrans.position.set(G.L + 0.02, Y0 + 0.07, 0); topGroup.add(ptrans);
  const ptcab = makePipe([[G.L + 0.02, Y0 + 0.095, 0], [G.L + 0.05, Y0 + 0.15, -0.03], [G.L + 0.02, Y0 + 0.2, -0.12]], { radius: 0.003, material: M.plastic(0xd8452f, 0.5) }); topGroup.add(ptcab);

  /* ---- screws */
  const screwMat = new THREE.MeshStandardMaterial({ color: 0xaab0b6, metalness: 1, roughness: 0.22 });
  const sA = new THREE.Mesh(screwGeometry(0), screwMat), sB = new THREE.Mesh(screwGeometry(Math.PI / 2), screwMat);
  sA.position.set(0, Y0, -C); sB.position.set(0, Y0, C); [sA, sB].forEach(s => { s.castShadow = true; s.receiveShadow = true; s.userData.info = { kind: 'screw' }; scene.add(s); });

  /* ---- material fill (powder, dough, melt) */
  const noiseTex = (key, base, amp, gran) => canvasTexture(256, 64, (ctx, w, h) => { ctx.fillStyle = base; ctx.fillRect(0, 0, w, h); const r = rng(key.length * 7); for (let i = 0; i < gran; i++) { const v = (r() - 0.5) * amp; ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3); } }, { key, repeat: [1, 1] });
  const fillMats = {
    powder: new THREE.MeshStandardMaterial({ vertexColors: true, map: noiseTex('ex-powder', '#ffffff', 0.5, 5000), roughness: 0.96, side: THREE.DoubleSide }),
    dough: new THREE.MeshPhysicalMaterial({ vertexColors: true, map: noiseTex('ex-dough', '#ffffff', 0.25, 1500), bumpMap: noiseTex('ex-doughb', '#808080', 0.6, 800), bumpScale: 2, roughness: 0.62, side: THREE.DoubleSide }),
    melt: new THREE.MeshPhysicalMaterial({ vertexColors: true, map: noiseTex('ex-melt', '#ffffff', 0.12, 700), roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25, side: THREE.DoubleSide })
  };
  const fillMeshes = {}; const fillGroup = new THREE.Group(); scene.add(fillGroup);
  Object.keys(fillMats).forEach(k => { const m = new THREE.Mesh(new THREE.BufferGeometry(), fillMats[k]); m.receiveShadow = true; m.userData.info = { kind: 'material' }; fillGroup.add(m); fillMeshes[k] = m; });
  api.setFill = (res, mode, mat) => {
    const groups = { powder: [], dough: [], melt: [] };
    const step = 2; // every 4 mm
    for (let i = 0; i < res.xs.length; i += step) {
      const s = res.state[i]; const key = s === 0 ? 'powder' : s === 1 ? 'dough' : 'melt';
      const f = res.fill[i]; const level = -RB + Math.min(1, 0.12 + 0.88 * f) * 2 * RB * (key === 'powder' ? 0.8 : 1);
      let c;
      if (mode === 'temp') c = tcol(res.T[i]);
      else if (key === 'powder') c = new THREE.Color(0.86, 0.79, 0.62);
      else if (key === 'dough') c = new THREE.Color(0.74, 0.58, 0.38);
      else { const t = Math.min(1, Math.max(0, (res.T[i] - 100) / 80)); c = new THREE.Color(0.62, 0.42, 0.22).lerp(new THREE.Color(0.45, 0.26, 0.11), t); }
      groups[key].push({ x: res.xs[i], level, c });
    }
    // make segments contiguous by sharing the boundary station
    const order = ['powder', 'dough', 'melt'];
    order.forEach((k, j) => { const nxt = order[j + 1]; if (nxt && groups[k].length && groups[nxt].length) groups[k].push(Object.assign({}, groups[nxt][0], { c: groups[k][groups[k].length - 1].c })); });
    order.forEach(k => { const g = groups[k]; const m = fillMeshes[k]; m.geometry.dispose(); if (g.length < 2) { m.visible = false; m.geometry = new THREE.BufferGeometry(); return; } m.visible = true; m.geometry = fillGeometry(g, g.map(s => s.c)); });
  };

  /* ---- feeder, hopper, chute */
  const feeder = new THREE.Group(); scene.add(feeder);
  const FX = 0.054;
  [[-0.1, -0.64], [0.2, -0.64], [-0.1, -0.26], [0.2, -0.26]].forEach(([x, z]) => feeder.add(box(0.03, 1.3, 0.03, stain, x, 0.65, z, 0.003)));
  feeder.add(box(0.34, 0.02, 0.42, stain, 0.05, 1.31, -0.45, 0.004));
  [[-0.05, -0.6], [0.15, -0.6], [-0.05, -0.3], [0.15, -0.3]].forEach(([x, z]) => feeder.add(box(0.04, 0.03, 0.04, dark, x, 1.335, z, 0.004)));
  const ftube = cyl(0.036, 0.036, 0.56, stain, 28); ftube.rotation.x = Math.PI / 2; ftube.position.set(FX, 1.42, -0.3); feeder.add(ftube);
  const fmot = cyl(0.05, 0.05, 0.12, blueMotor, 28); fmot.rotation.x = Math.PI / 2; fmot.position.set(FX, 1.42, -0.64); feeder.add(fmot);
  const hopMat = stain.clone(); hopMat.side = THREE.DoubleSide;
  const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.26, 48, 1, true), hopMat); hop.position.set(FX, 1.72, -0.38); feeder.add(hop);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.045, 0.14, 48, 1, true), hopMat); cone.position.set(FX, 1.52, -0.38); feeder.add(cone);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.006, 8, 48), stain); rim.rotation.x = Math.PI / 2; rim.position.set(FX, 1.85, -0.38); feeder.add(rim);
  // powder heap
  const heapGeo = new THREE.CircleGeometry(0.154, 48, 0, Math.PI * 2); heapGeo.rotateX(-Math.PI / 2);
  const hp = heapGeo.attributes.position; for (let i = 0; i < hp.count; i++) { const x = hp.getX(i), z = hp.getZ(i), r = Math.hypot(x, z); hp.setY(i, 0.035 * (1 - r / 0.154) + 0.006 * fbm2(x * 40, z * 40, 3)); } heapGeo.computeVertexNormals();
  const powderMat = new THREE.MeshStandardMaterial({ color: 0xeee2c0, map: noiseTex('ex-powder2', '#ffffff', 0.4, 6000), roughness: 0.98 });
  const heap = new THREE.Mesh(heapGeo, powderMat); heap.position.set(FX, 1.76, -0.38); heap.receiveShadow = true; feeder.add(heap);
  // chute to feed port (sight glass section)
  const chuteMetal = [box(0.05, 0.12, 0.05, stain, FX, 1.34, 0, 0.004), box(0.05, 0.06, 0.05, stain, FX, Y0 + BH / 2 + 0.03, 0, 0.004)];
  chuteMetal.forEach(m => feeder.add(m));
  feeder.add(box(0.05, 0.04, 0.34, stain, FX, 1.40, -0.15, 0.004));
  const glassTube = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.14, 0.046), M.glassCheap(0.2)); glassTube.position.set(FX, 1.21, 0); feeder.add(glassTube);
  [1.28, 1.14].forEach(y => feeder.add(box(0.058, 0.01, 0.058, stain, FX, y, 0, 0.002)));
  feeder.traverse(m => { if (m.isMesh) m.userData.info = { kind: 'feeder' }; });
  shadow(feeder);
  // falling powder particles
  const NPOW = 180; const powPos = new Float32Array(NPOW * 3); const powV = new Float32Array(NPOW);
  for (let i = 0; i < NPOW; i++) { powPos[i * 3] = FX + (Math.random() - 0.5) * 0.03; powPos[i * 3 + 1] = Y0 + 0.06 + Math.random() * 0.3; powPos[i * 3 + 2] = (Math.random() - 0.5) * 0.03; powV[i] = 0.5 + Math.random(); }
  const powGeo = new THREE.BufferGeometry(); powGeo.setAttribute('position', new THREE.BufferAttribute(powPos, 3));
  const powPts = new THREE.Points(powGeo, new THREE.PointsMaterial({ color: 0xf2e6c4, size: 0.004, sizeAttenuation: true })); scene.add(powPts);

  /* ---- water dosing */
  const water = new THREE.Group(); scene.add(water);
  const cartX = -0.35, cartZ = 0.62;
  water.add(box(0.5, 0.02, 0.36, stain, cartX, 0.72, cartZ, 0.004));
  water.add(box(0.5, 0.02, 0.36, stain, cartX, 0.25, cartZ, 0.004));
  [[-0.23, -0.16], [0.23, -0.16], [-0.23, 0.16], [0.23, 0.16]].forEach(([dx, dz]) => { water.add(box(0.02, 0.72, 0.02, stain, cartX + dx, 0.37, cartZ + dz, 0.002)); const w = cyl(0.025, 0.025, 0.02, M.rubber(), 16); w.rotation.x = Math.PI / 2; w.position.set(cartX + dx, 0.025, cartZ + dz); water.add(w); });
  water.add(box(0.16, 0.12, 0.12, M.paintedSteel(0x2f7fb8), cartX + 0.06, 0.79, cartZ, 0.01));
  const pm = cyl(0.045, 0.045, 0.12, M.paintedSteel(0x3a4a58), 24); pm.rotation.z = Math.PI / 2; pm.position.set(cartX + 0.2, 0.79, cartZ); water.add(pm);
  const phead = cyl(0.05, 0.05, 0.03, M.pvc(), 28); phead.rotation.z = Math.PI / 2; phead.position.set(cartX - 0.035, 0.79, cartZ); water.add(phead);
  const damp = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 14), steel); damp.position.set(cartX - 0.03, 0.88, cartZ); water.add(damp);
  const tank = box(0.16, 0.26, 0.16, M.plastic(0xe8eef2, 0.35), cartX - 0.15, 0.86, cartZ - 0.04, 0.02); tank.material.transparent = true; tank.material.opacity = 0.8; water.add(tank);
  const waterIn = box(0.14, 0.17, 0.14, M.waterCheap(0x6fb6d6, 0.6), cartX - 0.15, 0.815, cartZ - 0.04, 0.01); water.add(waterIn);
  water.traverse(m => { if (m.isMesh) m.userData.info = { kind: 'water' }; });
  const wPipe = makePipe([[cartX - 0.03, 0.9, cartZ], [cartX - 0.03, 1.32, cartZ - 0.1], [0.0, 1.34, 0.30], [G.xWater, 1.30, 0.12], [G.xWater, Y0 + BH / 2 + 0.07, 0.02], [G.xWater, Y0 + BH / 2 + 0.028, 0.0]], { radius: 0.004, material: stain, tension: 0.2 });
  wPipe.userData.info = { kind: 'water' }; water.add(wPipe);
  const nozzle = cyl(0.009, 0.009, 0.022, M.brass(), 6); nozzle.position.set(G.xWater, Y0 + BH / 2 + 0.013, 0); topGroup.add(nozzle);
  const wFlow = new FlowAlong(wPipe.curve, { count: 70, speed: 0.2, size: 0.012, color: 0x5cc8ef }); scene.add(wFlow.points);
  shadow(water);

  /* ---- HMI panel */
  const hmi = new THREE.Group(); scene.add(hmi);
  hmi.add(box(0.04, 0.5, 0.04, stain, -0.66, 1.03, 0.30, 0.004));
  const scrBody = box(0.40, 0.28, 0.04, M.plasticGrey(), 0, 0, 0, 0.012);
  const hmiCanvas = document.createElement('canvas'); hmiCanvas.width = 512; hmiCanvas.height = 320;
  const hmiTex = new THREE.CanvasTexture(hmiCanvas); hmiTex.colorSpace = THREE.SRGBColorSpace;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.37, 0.23), new THREE.MeshBasicMaterial({ map: hmiTex, toneMapped: false })); scr.position.z = 0.021;
  const hmiHead = new THREE.Group(); hmiHead.add(scrBody, scr); hmiHead.position.set(-0.66, 1.42, 0.32); hmiHead.rotation.set(-0.25, 0.35, 0); hmi.add(hmiHead);
  hmi.traverse(m => { if (m.isMesh) m.userData.info = { kind: 'hmi' }; });
  api.setHMI = d => { drawHMI(hmiCanvas.getContext('2d'), 512, 320, d); hmiTex.needsUpdate = true; };

  /* ---- cooling die, TCU, thermal slice (rebuilt when die geometry changes) */
  const dieGroup = new THREE.Group(); scene.add(dieGroup);
  const dieTop = new THREE.Group(); scene.add(dieTop);
  const sliceGroup = new THREE.Group(); scene.add(sliceGroup);
  const dieMat = new THREE.MeshStandardMaterial({ color: 0xc4c9cd, metalness: 1, roughness: 0.26 });
  const ribMat = M.paintedSteel(0x2f6fd6);
  const meltMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, clearcoat: 0.5 });
  let meltSlab = null, slice = null, sliceTexCur = null, dieLen = 0, dieGap = 0;
  const coolHoseMat = M.plastic(0x1b1d20, 0.6);
  api.buildDie = (Ld, Hd) => {
    [dieGroup, dieTop, sliceGroup].forEach(g => { g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); g.clear(); });
    dieLen = Ld; dieGap = Hd;
    const x0 = X_DIE0, xm = x0 + Ld / 2, W = G.Wd, H = Hd, DW = 0.09, DH = 0.07;
    const plateT = (DH - H) / 2;
    dieGroup.add(box(Ld, plateT, DW, dieMat, xm, Y0 - H / 2 - plateT / 2, 0, 0.003));
    [-1, 1].forEach(s => dieGroup.add(box(Ld, H + 0.0004, (DW - W) / 2, dieMat, xm, Y0, s * (W / 2 + (DW - W) / 4), 0.001)));
    const top = box(Ld, plateT, DW, dieMat, xm, Y0 + H / 2 + plateT / 2, 0, 0.003); dieTop.add(top);
    // clamps / jacket ribs
    const nr = Math.max(2, Math.round(Ld / 0.12));
    for (let k = 0; k <= nr; k++) { const x = x0 + 0.01 + (Ld - 0.02) * k / nr; dieGroup.add(box(0.012, DH / 2 + 0.006, DW + 0.012, ribMat, x, Y0 - DH / 4 - 0.003, 0, 0.002)); dieTop.add(box(0.012, DH / 2 + 0.006, DW + 0.012, ribMat, x, Y0 + DH / 4 + 0.003, 0, 0.002)); }
    // coolant ports + hoses to TCU (counter-current: in at exit end, out at die start)
    const tcu = new THREE.Group(); const tx = x0 + Ld / 2, tz = -0.55;
    tcu.add(box(0.4, 0.62, 0.36, M.paintedSteel(0xe7e9e6), tx, 0.31, tz, 0.012));
    const dispC = canvasTexture(128, 64, (c, w, h) => { c.fillStyle = '#0b1418'; c.fillRect(0, 0, w, h); c.fillStyle = '#5cc8ef'; c.font = '600 22px JetBrains Mono, monospace'; c.fillText('TCU', 8, 26); c.fillStyle = '#e6eee9'; c.font = '500 14px Inter, sans-serif'; c.fillText('oil / water', 8, 50); });
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.07), new THREE.MeshBasicMaterial({ map: dispC, toneMapped: false })); disp.position.set(tx - 0.08, 0.5, tz + 0.181); tcu.add(disp);
    dieGroup.add(tcu);
    const pIn = [x0 + Ld - 0.03, Y0 + DH / 2 + 0.012, -0.02], pOut = [x0 + 0.03, Y0 + DH / 2 + 0.012, -0.02];
    [pIn, pOut].forEach(p => { const f = cyl(0.007, 0.007, 0.02, M.brass(), 12); f.position.set(...p); dieTop.add(f); });
    dieGroup.add(makePipe([pIn, [pIn[0], Y0 + 0.12, -0.15], [tx + 0.1, 0.75, tz], [tx + 0.1, 0.63, tz]], { radius: 0.008, material: coolHoseMat }));
    dieGroup.add(makePipe([pOut, [pOut[0], Y0 + 0.14, -0.15], [tx - 0.1, 0.78, tz], [tx - 0.1, 0.63, tz]], { radius: 0.008, material: coolHoseMat }));
    // die stand
    [x0 + 0.08, x0 + Ld - 0.06].forEach(x => { dieGroup.add(box(0.03, Y0 - DH / 2 - 0.02, 0.03, stain, x, (Y0 - DH / 2) / 2, 0, 0.003)); dieGroup.add(box(0.2, 0.012, 0.16, stain, x, 0.006, 0, 0.002)); });
    // melt slab (vertex coloured by mean temperature)
    meltSlab = new THREE.Mesh(new THREE.BoxGeometry(Ld, H * 0.98, W * 0.98, 48, 1, 1), meltMat); meltSlab.position.set(xm, Y0, 0);
    const col = new Float32Array(meltSlab.geometry.attributes.position.count * 3); meltSlab.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3)); dieGroup.add(meltSlab);
    // thermal slice panel above the die (gap stretched)
    slice = new THREE.Mesh(new THREE.PlaneGeometry(Ld, 0.056), new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide }));
    slice.position.set(xm, Y0 + 0.13, 0); sliceGroup.add(slice);
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(Ld + 0.008, 0.064), new THREE.MeshBasicMaterial({ color: 0x1b2a30, side: THREE.DoubleSide })); frame.position.set(xm, Y0 + 0.13, -0.001); sliceGroup.add(frame);
    api.anchors.slice = new THREE.Vector3(xm, Y0 + 0.175, 0);
    dieGroup.traverse(m => { if (m.isMesh && !m.userData.info) m.userData.info = { kind: 'die' }; }); dieTop.traverse(m => { if (m.isMesh) m.userData.info = { kind: 'die' }; }); sliceGroup.traverse(m => { if (m.isMesh) m.userData.info = { kind: 'die' }; });
    shadow(dieGroup); shadow(dieTop); meltSlab.castShadow = false;
    api.buildConveyor(x0 + Ld);
  };
  api.setDieField = (res, Tlo, Thi) => {
    if (!meltSlab) return;
    const pa = meltSlab.geometry.attributes.position, ca = meltSlab.geometry.attributes.color; const L = dieLen;
    for (let i = 0; i < pa.count; i++) { const u = (pa.getX(i) + L / 2) / L; const j = Math.min(res.die.x.length - 1, Math.max(0, Math.round(u * (res.die.x.length - 1)))); const c = tcol(res.die.mean[j], Tlo, Thi); ca.setXYZ(i, c.r, c.g, c.b); }
    ca.needsUpdate = true;
    if (sliceTexCur) sliceTexCur.dispose();
    const cm = 'inferno';
    sliceTexCur = heatmapTexture(res.field.map(r => r.map(v => v)), { colormap: cm, min: Tlo, max: Thi });
    slice.material.map = sliceTexCur; slice.material.needsUpdate = true;
  };

  /* ---- conveyor, cutter, product */
  const conv = new THREE.Group(); scene.add(conv);
  const beltTex = canvasTexture(256, 64, (c, w, h) => { c.fillStyle = '#2a2d31'; c.fillRect(0, 0, w, h); c.strokeStyle = '#3a3e43'; c.lineWidth = 2; for (let i = 0; i < 16; i++) { c.beginPath(); c.moveTo(i * 16, 0); c.lineTo(i * 16, h); c.stroke(); } }, { key: 'ex-belt', repeat: [8, 1] });
  const beltMat = new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.8 });
  let belt = null, blade = null, knifeX = 0, beltX0 = 0, beltX1 = 0, exitX = 0;
  api.buildConveyor = xe => {
    conv.traverse(o => { if (o.geometry) o.geometry.dispose(); }); conv.clear();
    exitX = xe; beltX0 = xe + 0.015; beltX1 = xe + 0.95; knifeX = xe + 0.1;
    const yb = Y0 - dieGap / 2 - 0.004, L = beltX1 - beltX0, xm = (beltX0 + beltX1) / 2;
    belt = new THREE.Mesh(new THREE.BoxGeometry(L, 0.006, 0.12), beltMat); belt.position.set(xm, yb - 0.003, 0); belt.receiveShadow = true; conv.add(belt);
    [beltX0, beltX1].forEach(x => { const r = cyl(0.02, 0.02, 0.13, steel, 20); r.rotation.x = Math.PI / 2; r.position.set(x, yb - 0.022, 0); conv.add(r); });
    [-0.072, 0.072].forEach(z => conv.add(box(L + 0.06, 0.04, 0.012, alu, xm, yb - 0.02, z, 0.003)));
    [beltX0 + 0.05, beltX1 - 0.05].forEach(x => [-0.07, 0.07].forEach(z => conv.add(box(0.025, yb - 0.04, 0.025, alu, x, (yb - 0.04) / 2, z, 0.003))));
    // guillotine cutter
    const kf = new THREE.Group();
    [-0.075, 0.075].forEach(z => kf.add(box(0.025, 0.22, 0.02, stain, knifeX, yb + 0.1, z, 0.003)));
    kf.add(box(0.04, 0.03, 0.18, stain, knifeX, yb + 0.22, 0, 0.004));
    const cylA = cyl(0.016, 0.016, 0.12, alu, 20); cylA.position.set(knifeX, yb + 0.29, 0); kf.add(cylA);
    blade = box(0.004, 0.08, 0.14, new THREE.MeshStandardMaterial({ color: 0xd9dde0, metalness: 1, roughness: 0.15 }), knifeX, yb + 0.1, 0, 0.001); kf.add(blade);
    conv.add(kf);
    // collection tray
    const tray = new THREE.Group(); const tx = beltX1 + 0.18;
    tray.add(box(0.36, 0.012, 0.3, stain, tx, 0.62, 0, 0.004));
    [[-0.17, 0], [0.17, 0]].forEach(([dx]) => tray.add(box(0.012, 0.07, 0.3, stain, tx + dx, 0.655, 0, 0.003)));
    [-0.145, 0.145].forEach(z => tray.add(box(0.36, 0.07, 0.012, stain, tx, 0.655, z, 0.003)));
    tray.add(box(0.5, 0.6, 0.4, M.paintedSteel(0xd8dcd8), tx, 0.3, 0, 0.01));
    conv.add(tray);
    api.anchors.tray = new THREE.Vector3(tx, 0.7, 0);
    api.anchors.exit = new THREE.Vector3(xe, Y0, 0);
    conv.traverse(m => { if (m.isMesh) m.userData.info = { kind: 'cutter' }; });
    shadow(conv);
  };
  // strand and pieces
  const pieceGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
  const strand = new THREE.Mesh(pieceGeo, productMaterials('fibrous', 0.2)); strand.castShadow = true; strand.userData.info = { kind: 'product' }; scene.add(strand);
  const pieces = []; let strandLen = 0.0; const PIECE = 0.08;
  const steam = new Mist({ nozzles: [{ pos: [0, 0, 0], dir: [0.3, 1, 0] }], rate: 0, speed: 0.35, cone: 0.9, size: 0.03, life: 2.2, gravity: -0.05, drag: 1.2, color: 0xf4f6f7 });
  steam.mat.opacity = 0.35; scene.add(steam.points);
  let knifeT = 1;
  /** state: {ubar (m/s), kind, brown, H, puff} for the product currently leaving the die */
  api.updateProduct = (dt, st) => {
    const H = dieGap, W = G.Wd;
    const puff = st.kind === 'expanded' ? 1.55 : 1, sag = st.kind === 'none' ? 0.9 : 1;
    const v = st.ubar * (st.kind === 'expanded' ? 1.4 : 1);
    strandLen += v * dt;
    strand.material = productMaterials(st.kind, st.brown);
    strand.scale.set(Math.max(0.0005, strandLen), H * puff * sag, W * (st.kind === 'expanded' ? 1.25 : st.kind === 'none' ? 1.05 : 1));
    strand.position.set(exitX + strandLen / 2, Y0 - (H - H * puff * sag) / 2 + (puff - 1) * H * 0.5, 0);
    if (strandLen >= knifeX - exitX + PIECE && knifeT >= 1) knifeT = 0;
    if (knifeT < 1) {
      knifeT = Math.min(1, knifeT + dt * 5);
      const dy = Math.sin(knifeT * Math.PI) * 0.075; blade.position.y = Y0 - H / 2 + 0.1 - dy;
      if (knifeT >= 0.5 && strandLen > knifeX - exitX) {
        const cutL = strandLen - (knifeX - exitX);
        if (cutL > 0.01) {
          const p = pieces.find(p => !p.visible) || (pieces.length < 24 ? (() => { const m = new THREE.Mesh(pieceGeo, strand.material); m.castShadow = true; m.userData.info = { kind: 'product' }; scene.add(m); pieces.push(m); return m; })() : null);
          if (p) { p.visible = true; p.material = strand.material; p.scale.set(cutL, strand.scale.y, strand.scale.z); p.position.set(knifeX + cutL / 2 + 0.002, strand.position.y, 0); p.userData.v = Math.max(v * 1.6, 0.02); p.userData.drop = 0; p.rotation.set(0, (Math.random() - 0.5) * 0.12, 0); }
          strandLen = knifeX - exitX;
        }
      }
    }
    pieces.forEach(p => {
      if (!p.visible) return;
      p.position.x += p.userData.v * dt;
      if (p.position.x > beltX1 + 0.02) { // fall into tray
        p.userData.drop += dt; p.position.y -= p.userData.drop * 1.6 * dt * 10; p.rotation.z -= dt * 3;
        if (p.position.y < 0.64) p.visible = false;
      }
    });
    steam.on = st.kind === 'expanded'; steam.rate = st.kind === 'expanded' ? 60 : 0;
    steam.nozzles[0].pos.set(exitX + 0.01, Y0 + H / 2, 0);
    steam.update(dt);
  };

  /* ---- heater colours, view modes, animation */
  api.setZones = temps => temps.forEach((T, i) => { const c = tcol(T); bands[i].mat.color.copy(c); bands[i].mat.emissive.copy(c).multiplyScalar(Math.max(0, (T - 110) / 90) * 0.35); });
  api.setView = mode => {
    const xray = mode === 'xray', cut = mode === 'cut';
    topGroup.visible = !cut; dieTop.visible = !cut;
    [blockMat, blockMatTop, flangeMat, dieMat, ribMat].forEach(m => { m.transparent = xray; m.opacity = xray ? 0.18 : 1; m.depthWrite = !xray; m.needsUpdate = true; });
    bands.forEach(b => { b.mat.transparent = xray; b.mat.opacity = xray ? 0.28 : 1; b.mat.depthWrite = !xray; b.mat.needsUpdate = true; });
    bolts.visible = boltsT.visible = !xray;
    sA.visible = sB.visible = cut || xray;
    fillGroup.visible = cut || xray;
    sliceGroup.visible = cut || xray;
  };
  let screwAng = 0;
  api.animate = (dt, st) => {
    screwAng += dt * st.omegaVis; sA.rotation.x = screwAng; sB.rotation.x = screwAng;
    ['powder', 'dough', 'melt'].forEach((k, i) => { const mp = fillMats[k].map; if (mp) mp.offset.x -= dt * st.flowVis * (i === 0 ? 1.4 : 1); });
    wFlow.speed = st.waterVis; wFlow.update(dt);
    // powder particles
    const pa = powGeo.attributes.position; const rate = st.powderVis;
    for (let i = 0; i < NPOW; i++) { let y = pa.getY(i) - dt * powV[i] * rate; if (y < Y0 + 0.055) y = 1.28 - Math.random() * 0.02; pa.setY(i, y); }
    pa.needsUpdate = true; powPts.visible = rate > 0.01;
    beltTex.offset.x -= dt * st.beltVis * 8 / Math.max(0.1, beltX1 - beltX0);
  };
  api.screws = [sA, sB]; api.fill = fillMeshes; api.topGroup = topGroup; api.bands = bands;
  api.anchors.feeder = new THREE.Vector3(FX + 0.22, 1.66, -0.38); api.anchors.water = new THREE.Vector3(G.xWater, Y0 + 0.13, 0.03);
  api.anchors.kb1 = new THREE.Vector3(0.265, Y0 + 0.075, 0); api.anchors.kb2 = new THREE.Vector3(0.486, Y0 + 0.075, 0);
  api.anchors.zone = i => new THREE.Vector3(i * G.secLen + G.secLen / 2, Y0 + BH / 2 + 0.03, 0.06);
  api.pickRoots = () => [barrel, topGroup, feeder, water, hmi, dieGroup, dieTop, conv, strand, ...pieces, sA, sB];
  return api;
}
