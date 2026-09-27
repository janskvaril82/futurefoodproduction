/* Hydroponic hardware kit shared by the two Module 5 laboratories
   (/laboratories/soilless-systems-3d/ and /laboratories/nft-system/).
   Everything is built from three.js primitives with the PBR materials of lab3d.js,
   at real-world dimensions (metres). */
import { THREE, M, RoundedBoxGeometry, BufferGeometryUtils, leafGeometry, leafMaterial, makeRoots, makePipe, canvasTexture, surfaceTextures, surfaceMaterial, rng } from '/assets/js/lab3d.js';

/* ------------------------------------------------------------------ materials (shared, created once) */
let _mat = null;
export function mats() {
  if (_mat) return _mat;
  _mat = {
    pvc: new THREE.MeshPhysicalMaterial({ color: 0xe8eae6, roughness: 0.34, clearcoat: 0.45, clearcoatRoughness: 0.3 }),
    pvcGrey: new THREE.MeshPhysicalMaterial({ color: 0x8d9296, roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.35 }),
    gullyIn: new THREE.MeshStandardMaterial({ color: 0x1d2023, roughness: 0.62 }),
    black: new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.55 }),
    tubeBlack: new THREE.MeshPhysicalMaterial({ color: 0x141618, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
    silicone: new THREE.MeshPhysicalMaterial({ color: 0xe6f2f2, roughness: 0.18, transparent: true, opacity: 0.5, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.1 }),
    galv: M.galvanised(),
    steel: M.steel(),
    alu: M.aluminium(),
    rubber: M.rubber(),
    section: new THREE.MeshStandardMaterial({ color: 0xd2553c, roughness: 0.55 }),
    toteBlack: new THREE.MeshPhysicalMaterial({ color: 0x2b3034, roughness: 0.62, clearcoat: 0.12, clearcoatRoughness: 0.6 }),
    toteGrey: new THREE.MeshPhysicalMaterial({ color: 0x5b646a, roughness: 0.6, clearcoat: 0.1, clearcoatRoughness: 0.6 }),
    toteBlue: new THREE.MeshPhysicalMaterial({ color: 0x27415e, roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.5 }),
    toteWhite: new THREE.MeshPhysicalMaterial({ color: 0xdfe2dd, roughness: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.5 }),
    lidWhite: new THREE.MeshPhysicalMaterial({ color: 0xeceeea, roughness: 0.45, clearcoat: 0.2, clearcoatRoughness: 0.5 }),
    water: new THREE.MeshPhysicalMaterial({ color: 0x3f8fa6, roughness: 0.06, transparent: true, opacity: 0.42, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide }),
    waterSurf: null,
    brass: M.brass(),
    rockwool: M.rockwool(),
    coir: surfaceMaterial('coir', [2, 2]),
    clay: surfaceMaterial('gravel', [3, 3], { color: 0xc8764a }),
    foam: M.foam(),
    label: new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.7 })
  };
  _mat.galv.color.set(0x979ea3); _mat.galv.roughness = 0.58;
  const nt = waterNormalTex().clone(); nt.repeat.set(3, 3); nt.needsUpdate = true;
  _mat.waterSurf = new THREE.MeshPhysicalMaterial({ color: 0x4f9fb6, roughness: 0.03, transparent: true, opacity: 0.55, normalMap: nt, normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false });
  _mat.waterSurfTex = nt;
  return _mat;
}
/** Tileable water normal map (shared with the lab3d kit through the texture cache). */
export function waterNormalTex() {
  return surfaceTextures({ key: 'waterN', size: 256, scale: 4, octaves: 4, palette: ['#888', '#999'], normalStrength: 1.4 }).normal;
}
export function shadowAll(obj, cast = true, receive = true) { obj.traverse(m => { if (m.isMesh) { m.castShadow = cast && !m.material.transparent; m.receiveShadow = receive; } }); return obj; }
export function box(w, h, d, mat, x = 0, y = 0, z = 0, r = 0) {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
export function cyl(r1, r2, h, mat, seg = 24, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
export function tube(points, radius, mat, opts = {}) { const p = makePipe(points, Object.assign({ radius, material: mat, tension: 0.05 }, opts)); return p; }

/* ------------------------------------------------------------------ lettuce (lighter geometry for large plantings) */
const BUTTER = { colors: ['#e3efac', '#a2cd52', '#62a032'], ruffle: 0.004, cup: 0.5, heart: 0.35 };
/** Butterhead lettuce head with adjustable mesh density (the kit's lettuceGeometry uses 18×12 segments per leaf). */
export function lettuceLite({ radius = 0.12, leaves = 16, seed = 3, segU = 9, segV = 6 } = {}) {
  const r = rng(seed); const geos = []; const golden = 2.39996; const V = BUTTER;
  for (let k = 0; k < leaves; k++) {
    const age = 1 - k / leaves; const inner = age < V.heart;
    const len = radius * (0.5 + 0.8 * age) * (0.9 + r() * 0.2);
    const pitch = inner ? 0.12 + 0.5 * age + (r() - 0.5) * 0.1 : 0.35 + 0.95 * Math.pow(age, 1.2) + (r() - 0.5) * 0.18;
    const curl = inner ? -0.55 + 0.4 * age : 0.25 + 0.55 * age;
    const geo = leafGeometry({ length: len, width: len * 0.98, pitch, curl, cup: V.cup * (inner ? 1.6 : 1.25 - age * 0.5), ruffle: V.ruffle * len / 0.1 * (inner ? 0.5 : 1), ruffleFreq: 5 + r() * 3, shape: 'round', seed: seed * 100 + k, colors: inner ? [V.colors[0], V.colors[0], V.colors[1]] : V.colors.map((c, i) => i === 2 ? (age > 0.55 ? c : V.colors[1]) : c), segU, segV });
    const m = new THREE.Matrix4().makeRotationY(k * golden + r() * 0.2);
    m.multiply(new THREE.Matrix4().makeTranslation(0, 0.004 * k / leaves, radius * (inner ? 0.02 : 0.05) * age));
    geo.applyMatrix4(m); geos.push(geo);
  }
  const merged = BufferGeometryUtils.mergeGeometries(geos, false); geos.forEach(g => g.dispose());
  return merged;
}
let _leafMat = null;
export function sharedLeafMaterial() { if (!_leafMat) _leafMat = leafMaterial({ gloss: 0.45 }); return _leafMat; }

/** Head fresh mass (g) → visual scale relative to a 150 g reference head (diameter ≈ 24 cm): size ∝ mass^(1/3). */
export const headScale = m => Math.max(0.12, Math.cbrt(Math.max(0.2, m) / 150));

/* ------------------------------------------------------------------ roots */
/** Root mat for an NFT gully: roots grow down from the pot, then spread downstream (+x) over the floor at yFloor (local). */
export function rootMatGeometry({ seed = 3, length = 0.2, count = 12, yFloor = -0.03, spread = 0.02, zMax = 0.042 } = {}) {
  const mesh = makeRoots({ count, length, spread, thickness: 0.0017, style: 'mat', seed, laterals: 1 });
  const g = mesh.geometry; mesh.material.dispose();
  g.rotateY(Math.PI / 2);                       // library 'mat' spreads along +z → turn to +x (flow direction)
  const p = g.attributes.position; const r = rng(seed * 7 + 1);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i); if (y < yFloor) p.setY(i, yFloor + 0.0015 + r() * 0.0025);
    const z = p.getZ(i); if (Math.abs(z) > zMax) p.setZ(i, Math.sign(z) * (zMax - r() * 0.004));   // keep the mat inside the gully
  }
  g.computeVertexNormals();
  return g;
}
export function rootMaterial() { const m = M.root(); m.color.set(0xf1e8cf); return m; }
/** Fibrous root-mat texture (cream strands flowing towards +u) for flat mats lying in the film. */
export function rootMatTexture() {
  return canvasTexture(512, 192, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h); const r = rng(77); ctx.lineCap = 'round';
    for (let k = 0; k < 520; k++) {
      const y0 = h * (0.5 + (r() - 0.5) * (0.35 + 0.6 * r())), x0 = r() * w * 0.25;
      const len = w * (0.35 + r() * 0.65); const a = 0.25 + r() * 0.55;
      ctx.strokeStyle = `rgba(${236 + r() * 19},${226 + r() * 22},${196 + r() * 30},${a})`; ctx.lineWidth = 0.6 + r() * 1.8;
      ctx.beginPath(); ctx.moveTo(x0, y0); let x = x0, y = y0;
      for (let s = 0; s < 8; s++) { x += len / 8; y += (r() - 0.5) * h * 0.09; y = Math.max(2, Math.min(h - 2, y)); ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }, { srgb: true, key: 'rootmat-tex', anisotropy: 4 });
}
/** Woven ground-cover texture (white horticultural ground cloth). */
export function groundClothMaterial(repeat = [20, 20]) {
  const t = canvasTexture(128, 128, (ctx, w) => {
    ctx.fillStyle = '#d9dcd8'; ctx.fillRect(0, 0, w, w); const r = rng(5);
    for (let i = 0; i < w; i += 4) { ctx.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.2})`; ctx.fillRect(0, i, w, 2); ctx.fillStyle = `rgba(120,125,120,${0.08 + r() * 0.08})`; ctx.fillRect(i, 0, 1, w); }
    ctx.strokeStyle = 'rgba(60,110,70,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(w, 64); ctx.stroke();
  }, { key: 'groundcloth', repeat });
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, color: 0xaeb3ad });
}

/* ------------------------------------------------------------------ NFT gully */
/**
 * Rectangular NFT gully along +x from x = 0 (inlet) to x = length, floor at y = 0 (outside bottom).
 * holes: array of x positions (local) for plant sites. cut: remove the front (+z) wall for a cut-away view.
 * Returns group with .film (Mesh), .lid, .holesY (y of lid top), .inner {w, h}, .setFilm(depth).
 */
let _clearLid = null;
export function makeGully({ length = 3, width = 0.1, height = 0.05, wall = 0.0035, holes = [], holeR = 0.026, cut = false, film = true, clearLid = false } = {}) {
  const mt = mats(); const g = new THREE.Group(); const W = width / 2, t = wall;
  const prof = new THREE.Shape();
  if (!cut) {
    prof.moveTo(-W, 0); prof.lineTo(W, 0); prof.lineTo(W, height); prof.lineTo(W - t, height); prof.lineTo(W - t, t); prof.lineTo(-W + t, t); prof.lineTo(-W + t, height); prof.lineTo(-W, height); prof.lineTo(-W, 0);
  } else { // floor + back wall only (back wall at +px → −z after rotation)
    prof.moveTo(-W + t, 0); prof.lineTo(W, 0); prof.lineTo(W, height); prof.lineTo(W - t, height); prof.lineTo(W - t, t); prof.lineTo(-W + t, t); prof.lineTo(-W + t, 0);
  }
  const bodyGeo = new THREE.ExtrudeGeometry(prof, { depth: length, bevelEnabled: false });
  const body = new THREE.Mesh(bodyGeo, [mt.pvc, mt.pvc]); body.rotation.y = Math.PI / 2; g.add(body);
  // dark inner liner (real NFT gullies are white outside, black inside to stop algae)
  const liner = new THREE.Mesh(new THREE.PlaneGeometry(length, width - 2 * t), mt.gullyIn); liner.rotation.x = -Math.PI / 2; liner.position.set(length / 2, t + 0.0003, 0); liner.receiveShadow = true; g.add(liner);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(length, height - t), mt.gullyIn); back.position.set(length / 2, t + (height - t) / 2, -W + t + 0.0003); back.receiveShadow = true; g.add(back);
  // two low floor ribs (they spread the film across the floor)
  [-width * 0.18, width * 0.18].forEach(z => { const rib = box(length, 0.002, 0.003, mt.gullyIn, length / 2, t + 0.001, z); rib.castShadow = false; g.add(rib); });
  // lid with plant holes
  const lidS = new THREE.Shape(); lidS.moveTo(0, -W); lidS.lineTo(length, -W); lidS.lineTo(length, W); lidS.lineTo(0, W); lidS.lineTo(0, -W);
  holes.forEach(x => { const hp = new THREE.Path(); hp.absarc(x, 0, holeR, 0, Math.PI * 2, true); lidS.holes.push(hp); });
  const lidG = new THREE.ExtrudeGeometry(lidS, { depth: 0.003, bevelEnabled: false, curveSegments: 18 }); lidG.rotateX(-Math.PI / 2);
  if (clearLid && !_clearLid) _clearLid = new THREE.MeshPhysicalMaterial({ color: 0xf4fbff, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide });
  const lid = new THREE.Mesh(lidG, clearLid ? _clearLid : mt.pvc); lid.position.y = height; if (clearLid) lid.renderOrder = 4; g.add(lid);
  // end caps (inlet cap closed, outlet cap with spout)
  const cap0 = box(0.008, height + 0.006, width + 0.008, mt.pvcGrey, -0.004, (height + 0.006) / 2, 0); g.add(cap0);
  const cap1 = box(0.008, height + 0.006, width + 0.008, mt.pvcGrey, length + 0.004, (height + 0.006) / 2, 0); g.add(cap1);
  const spout = cyl(0.011, 0.011, 0.05, mt.pvcGrey, 18); spout.rotation.z = Math.PI / 2; spout.position.set(length + 0.03, 0.012, 0); g.add(spout);
  let filmMesh = null;
  if (film) {
    const nt = waterNormalTex().clone(); nt.repeat.set(Math.max(1, length * 5), 1); nt.needsUpdate = true;
    const fm = new THREE.MeshStandardMaterial({ color: 0x69b7d3, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.88, normalMap: nt, normalScale: new THREE.Vector2(0.5, 0.5), emissive: 0x000000, depthWrite: false });
    filmMesh = new THREE.Mesh(new THREE.BoxGeometry(length - 0.004, 1, width - 2 * t - 0.0015), fm);
    filmMesh.position.x = length / 2; filmMesh.renderOrder = 2; g.add(filmMesh); filmMesh.userData.nt = nt;
  }
  g.traverse(m => { if (m.isMesh && m !== filmMesh) { m.castShadow = !m.material.transparent; m.receiveShadow = true; } });
  g.film = filmMesh; g.lid = lid; g.length = length; g.height = height; g.inner = { w: width - 2 * t, h: height - t }; g.wall = t; g.body = body;
  g.setFilm = depth => { if (!filmMesh) return; const d = Math.max(0.0004, depth); filmMesh.scale.y = d; filmMesh.position.y = t + 0.0004 + d / 2; };
  g.update = time => { if (filmMesh) filmMesh.userData.nt.offset.x = -time * 0.35; };
  g.setFilm(0.0015);
  return g;
}

/* ------------------------------------------------------------------ containers */
/**
 * Storage tote / reservoir with a lip, open top, optional front cut-away (+z wall removed, red section edges),
 * optional lid with plant holes, and a water volume. Origin: centre of the floor (outside bottom).
 */
export function makeTote({ w = 0.6, d = 0.4, h = 0.3, wall = 0.006, mat, cut = true, lid = false, lidHoles = [], holeR = 0.027, lidMat, level = 0.2, lip = 0.014 } = {}) {
  const mt = mats(); const g = new THREE.Group(); const m = mat || mt.toteBlack;
  const add = (o) => { g.add(o); return o; };
  add(box(w, wall, d, m, 0, wall / 2, 0));
  add(box(w, h, wall, m, 0, h / 2, -d / 2 + wall / 2));
  add(box(wall, h, d - (cut ? wall : 2 * wall), m, -w / 2 + wall / 2, h / 2, cut ? wall / 2 : 0));
  add(box(wall, h, d - (cut ? wall : 2 * wall), m, w / 2 - wall / 2, h / 2, cut ? wall / 2 : 0));
  if (!cut) add(box(w, h, wall, m, 0, h / 2, d / 2 - wall / 2));
  // lip flange around the rim
  add(box(w + 2 * lip, 0.008, lip, m, 0, h - 0.004, -d / 2 - lip / 2));
  add(box(lip, 0.008, d + (cut ? lip : 2 * lip), m, -w / 2 - lip / 2, h - 0.004, cut ? lip / 2 : 0));
  add(box(lip, 0.008, d + (cut ? lip : 2 * lip), m, w / 2 + lip / 2, h - 0.004, cut ? lip / 2 : 0));
  if (!cut) add(box(w + 2 * lip, 0.008, lip, m, 0, h - 0.004, d / 2 + lip / 2));
  if (cut) { // section highlights on the cut edges
    add(box(w, wall, 0.0014, mt.section, 0, wall / 2, d / 2 + 0.0007));
    add(box(wall, h, 0.0014, mt.section, -w / 2 + wall / 2, h / 2, d / 2 + 0.0007));
    add(box(wall, h, 0.0014, mt.section, w / 2 - wall / 2, h / 2, d / 2 + 0.0007));
  }
  const iw = w - 2 * wall - 0.001, id = d - 2 * wall - 0.001, ih = h - wall;
  const water = new THREE.Mesh(new THREE.BoxGeometry(iw, 1, id), mt.water); water.renderOrder = 1; g.add(water);
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(iw, id), mt.waterSurf); surf.rotation.x = -Math.PI / 2; surf.renderOrder = 2; g.add(surf);
  let lidMesh = null;
  if (lid) {
    const S = new THREE.Shape(); const lw = w + 2 * lip + 0.004, ld = d + 2 * lip + 0.004;
    S.moveTo(-lw / 2, -ld / 2); S.lineTo(lw / 2, -ld / 2); S.lineTo(lw / 2, ld / 2); S.lineTo(-lw / 2, ld / 2); S.lineTo(-lw / 2, -ld / 2);
    lidHoles.forEach(([x, z]) => { const p = new THREE.Path(); p.absarc(x, -z, holeR, 0, Math.PI * 2, true); S.holes.push(p); });
    const lg = new THREE.ExtrudeGeometry(S, { depth: 0.006, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1, curveSegments: 20 }); lg.rotateX(-Math.PI / 2);
    lidMesh = new THREE.Mesh(lg, lidMat || mt.lidWhite); lidMesh.position.y = h + 0.001; lidMesh.castShadow = true; lidMesh.receiveShadow = true; g.add(lidMesh);
  }
  g.water = water; g.surface = surf; g.lid = lidMesh; g.inner = { w: iw, d: id, h: ih }; g.floorY = wall; g.height = h;
  g.setLevel = lv => { const L = Math.max(0.002, Math.min(ih - 0.002, lv)); water.scale.y = L; water.position.y = wall + L / 2; surf.position.y = wall + L + 0.0006; g.levelY = wall + L; water.visible = surf.visible = lv > 0.0015; };
  g.setLevel(level);
  return g;
}

/* ------------------------------------------------------------------ pumps, aeration, controls */
/** Small submersible pump (≈ 20 W class): body, intake grille, outlet spigot, suction feet, cable. Outlet tip at .outlet (local). */
export function makeSubmersiblePump({ scale = 1 } = {}) {
  const mt = mats(); const g = new THREE.Group(); const s = scale;
  g.add(box(0.11 * s, 0.075 * s, 0.085 * s, mt.black, 0, 0.045 * s, 0, 0.012 * s));
  const grille = new THREE.Group();
  for (let i = 0; i < 7; i++) grille.add(box(0.006 * s, 0.045 * s, 0.004 * s, mt.tubeBlack, -0.036 * s + i * 0.012 * s, 0.045 * s, 0.0445 * s));
  g.add(grille);
  const motor = cyl(0.03 * s, 0.03 * s, 0.03 * s, mt.black, 24, 0.0, 0.095 * s, -0.01 * s); g.add(motor);
  const spig = cyl(0.009 * s, 0.009 * s, 0.05 * s, mt.pvcGrey, 16, 0.02 * s, 0.13 * s, 0.0); g.add(spig);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => g.add(cyl(0.009 * s, 0.012 * s, 0.008 * s, mt.silicone, 16, a * 0.04 * s, 0.004 * s, b * 0.03 * s)));
  const cable = tube([[-0.055 * s, 0.05 * s, -0.02 * s], [-0.09 * s, 0.05 * s, -0.03 * s], [-0.12 * s, 0.12 * s, -0.05 * s]], 0.0035 * s, mt.tubeBlack); g.add(cable);
  g.outlet = new THREE.Vector3(0.02 * s, 0.155 * s, 0);
  return shadowAll(g);
}
/** Aquarium diaphragm air pump with outlet nozzle. .outlet (local). */
export function makeAirPump() {
  const mt = mats(); const g = new THREE.Group();
  g.add(box(0.15, 0.065, 0.095, new THREE.MeshPhysicalMaterial({ color: 0xd7dbdc, roughness: 0.38, clearcoat: 0.4 }), 0, 0.04, 0, 0.018));
  g.add(box(0.11, 0.006, 0.07, mt.pvcGrey, 0, 0.074, 0, 0.003));
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => g.add(cyl(0.008, 0.008, 0.008, mt.rubber, 12, a * 0.055, 0.004, b * 0.032)));
  const noz = cyl(0.0035, 0.0035, 0.018, mt.pvcGrey, 12); noz.rotation.z = Math.PI / 2; noz.position.set(0.083, 0.04, 0); g.add(noz);
  const knob = cyl(0.012, 0.012, 0.008, mt.black, 20); knob.rotation.x = Math.PI / 2; knob.position.set(-0.04, 0.045, 0.05); g.add(knob);
  g.outlet = new THREE.Vector3(0.093, 0.04, 0);
  return shadowAll(g);
}
let _stoneMat = null;
/** Cylindrical air stone (porous ceramic). */
export function makeAirStone({ length = 0.08, r = 0.013 } = {}) {
  const mt = mats();
  if (!_stoneMat) _stoneMat = surfaceMaterial('gravel', [1, 1], { color: 0x9fb4c4 });
  const g = new THREE.Group(); const s = cyl(r, r, length, _stoneMat, 20); s.rotation.z = Math.PI / 2; s.position.y = r; g.add(s);
  const c = cyl(0.005, 0.005, 0.012, mt.pvcGrey, 12); c.rotation.z = Math.PI / 2; c.position.set(-length / 2 - 0.006, r, 0); g.add(c);
  g.inlet = new THREE.Vector3(-length / 2 - 0.012, r, 0);
  return shadowAll(g);
}
/** Plug-in segment timer (mechanical 24 h dial). */
export function makeTimer() {
  const mt = mats(); const g = new THREE.Group();
  g.add(box(0.07, 0.1, 0.06, new THREE.MeshPhysicalMaterial({ color: 0xf1f1ec, roughness: 0.4, clearcoat: 0.3 }), 0, 0.05, 0, 0.01));
  const dial = cyl(0.028, 0.028, 0.012, new THREE.MeshPhysicalMaterial({ color: 0x2f6fd6, roughness: 0.4, clearcoat: 0.4 }), 32); dial.rotation.x = Math.PI / 2; dial.position.set(0, 0.058, 0.033); g.add(dial);
  const tex = canvasTexture(128, 128, (ctx, w) => { ctx.fillStyle = '#e9edf2'; ctx.beginPath(); ctx.arc(64, 64, 60, 0, 7); ctx.fill(); ctx.strokeStyle = '#1a2230'; ctx.lineWidth = 3; for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(64 + Math.cos(a) * 44, 64 + Math.sin(a) * 44); ctx.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58); ctx.stroke(); } ctx.fillStyle = '#c0392b'; for (let i = 0; i < 12; i++) { if (i % 3) continue; const a = i / 12 * Math.PI * 2; ctx.fillRect(64 + Math.cos(a) * 46 - 3, 64 + Math.sin(a) * 46 - 3, 6, 6); } }, { key: 'timerdial' });
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.024, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 })); face.position.set(0, 0.058, 0.0395); g.add(face);
  return shadowAll(g);
}
/** Power strip with cable. */
export function makePowerStrip({ sockets = 4 } = {}) {
  const mt = mats(); const g = new THREE.Group(); const L = 0.06 * sockets + 0.04;
  g.add(box(L, 0.04, 0.06, new THREE.MeshPhysicalMaterial({ color: 0xf3f3ee, roughness: 0.42, clearcoat: 0.3 }), 0, 0.02, 0, 0.008));
  for (let i = 0; i < sockets; i++) { const s = cyl(0.019, 0.019, 0.004, mt.pvcGrey, 24); s.position.set(-L / 2 + 0.05 + i * 0.06, 0.041, 0); g.add(s); }
  const sw = box(0.018, 0.01, 0.026, new THREE.MeshStandardMaterial({ color: 0xc0392b, emissive: 0x401010, roughness: 0.4 }), L / 2 - 0.015, 0.043, 0); g.add(sw);
  return shadowAll(g);
}
/** Quarter-turn ball valve for a pipe along x, centred at the origin. */
export function makeBallValve({ r = 0.012 } = {}) {
  const mt = mats(); const g = new THREE.Group();
  const b = cyl(r * 1.35, r * 1.35, r * 3, mt.pvcGrey, 20); b.rotation.z = Math.PI / 2; g.add(b);
  const stem = cyl(r * 0.35, r * 0.35, r * 1.2, mt.pvcGrey, 12); stem.position.y = r * 1.6; g.add(stem);
  g.add(box(r * 3.2, r * 0.4, r * 0.9, new THREE.MeshStandardMaterial({ color: 0xd23b2f, roughness: 0.45 }), r * 1.2, r * 2.2, 0, r * 0.15));
  return shadowAll(g);
}
/** Net pot with a rock-wool plug. */
let _netpot = null;
export function netPotParts() {
  if (_netpot) return _netpot;
  const alpha = canvasTexture(128, 64, (ctx, w, h) => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#000'; for (let i = 0; i < 12; i++) for (let j = 0; j < 3; j++) ctx.fillRect(i * w / 12 + 2, 8 + j * 18, w / 12 - 5, 12); }, { srgb: false, key: 'netpot-alpha' });
  const mat = new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.6, alphaMap: alpha, alphaTest: 0.5, side: THREE.DoubleSide });
  const R = 0.026, H = 0.05;                     // light geometry: these are instanced by the hundred
  const cup = new THREE.CylinderGeometry(R, R * 0.78, H, 18, 1, true); cup.translate(0, -H / 2, 0);
  const rim = new THREE.TorusGeometry(R * 1.12, 0.0035, 4, 20); rim.rotateX(Math.PI / 2);
  const plug = new THREE.BoxGeometry(0.036, 0.04, 0.036); plug.translate(0, -0.02, 0);
  _netpot = { cup, rim, plug, mat, rimMat: new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.5 }), plugMat: M.rockwool(), H };
  return _netpot;
}
/** Single net pot + plug as a group (top of rim at y = 0). */
export function makeNetPotGroup() {
  const P = netPotParts(); const g = new THREE.Group();
  const cup = new THREE.Mesh(P.cup, P.mat); const rim = new THREE.Mesh(P.rim, P.rimMat); const plug = new THREE.Mesh(P.plug, P.plugMat);
  plug.position.y = -0.004; g.add(cup, rim, plug); return shadowAll(g);
}

/* ------------------------------------------------------------------ substrates */
/** Stone-wool slab wrapped in white polyethylene film with drain slits (origin: centre of the bottom). */
export function makeSlab({ L = 1.0, W = 0.15, H = 0.075, cutFront = true } = {}) {
  const mt = mats(); const g = new THREE.Group();
  const core = box(L - 0.01, H - 0.004, W - 0.006, mt.rockwool, 0, (H - 0.004) / 2 + 0.002, 0, 0.004); g.add(core);
  const foil = new THREE.MeshPhysicalMaterial({ color: 0xf3f4f0, roughness: 0.5, clearcoat: 0.2, side: THREE.DoubleSide, transparent: cutFront, opacity: cutFront ? 0.999 : 1 });
  // wrap: top, back, bottom and ends; front left open (cut-away) to show the stone wool
  g.add(box(L, 0.0012, W, foil, 0, H, 0));
  g.add(box(L, 0.0012, W, foil, 0, 0.0006, 0));
  g.add(box(L, H, 0.0012, foil, 0, H / 2, -W / 2));
  if (!cutFront) g.add(box(L, H, 0.0012, foil, 0, H / 2, W / 2));
  g.add(box(0.0012, H, W, foil, -L / 2, H / 2, 0)); g.add(box(0.0012, H, W, foil, L / 2, H / 2, 0));
  return shadowAll(g);
}
/** Square plastic pot with substrate (origin at pot bottom centre). */
export function makePot({ size = 0.09, h = 0.08, substrate = 'coir' } = {}) {
  const mt = mats(); const g = new THREE.Group();
  const potGeo = new THREE.CylinderGeometry(size * 0.72, size * 0.56, h, 4, 1, true); potGeo.rotateY(Math.PI / 4); potGeo.translate(0, h / 2, 0);
  const pot = new THREE.Mesh(potGeo, new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.6, side: THREE.DoubleSide })); g.add(pot);
  const bottom = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.79, size * 0.79), mt.black); bottom.rotation.x = -Math.PI / 2; bottom.position.y = 0.002; g.add(bottom);
  const topGeo = new THREE.PlaneGeometry(size * 0.98, size * 0.98); topGeo.rotateX(-Math.PI / 2);
  const top = new THREE.Mesh(topGeo, substrate === 'clay' ? mt.clay : mt.coir); top.position.y = h * 0.9; g.add(top);
  return shadowAll(g);
}

/* ------------------------------------------------------------------ signage */
/** Printed placard on a small stand (canvas texture — visible in screenshots). */
export function makePlacard(title, sub = '', { w = 0.42, h = 0.13, accent = '#2f8fb8' } = {}) {
  const mt = mats(); const g = new THREE.Group();
  const tex = canvasTexture(640, 200, (ctx, W, H) => {
    ctx.fillStyle = '#f7f7f3'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = accent; ctx.fillRect(0, 0, 16, H);
    ctx.fillStyle = '#16211d'; ctx.font = '700 64px Inter, Arial, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText(title, 40, sub ? 72 : 100);
    if (sub) { ctx.fillStyle = '#51605a'; ctx.font = '500 34px Inter, Arial, sans-serif'; ctx.fillText(sub, 42, 146); }
  }, { key: 'placard-' + title + sub });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  const board = box(w + 0.01, h + 0.01, 0.006, mt.black, 0, 0, -0.004); g.add(board); face.position.z = 0.0002; g.add(face);
  g.rotation.x = -0.5;
  const leg = box(0.012, 0.16, 0.012, mt.alu, 0, -0.1, -0.03); leg.rotation.x = 0.5; g.add(leg);
  return shadowAll(g);
}

/* ------------------------------------------------------------------ small helpers */
/** Tint helper for instanced lettuce: stress → yellow/grey multiplier. */
export function stressTint(color, { nDef = 0, hypoxia = 0, heat = 0 } = {}) {
  // nitrogen shortage → chlorotic yellow; hypoxia → dull, greyish-yellow (wilting); heat → pale, bleached
  const r = 1 + 0.25 * nDef + 0.12 * hypoxia + 0.08 * heat, gg = 1 - 0.05 * nDef - 0.22 * hypoxia - 0.1 * heat, b = 1 - 0.6 * nDef - 0.35 * hypoxia - 0.3 * heat;
  return color.setRGB(Math.max(0.4, r), Math.max(0.4, gg), Math.max(0.2, b));
}
export { THREE, M, canvasTexture, rng };
