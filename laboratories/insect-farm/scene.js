/* Insect farm — 3-D facility: mealworm crate stacks, BSF racks, fly cage, climate unit, sieving station.
   Larvae are instanced, segmented bodies that wriggle (vertex shader) and crawl over the substrate. */
import { THREE, M, canvasTexture, makeRoom, makePipe, FlowAlong, RoundedBoxGeometry, BufferGeometryUtils, rng } from '/assets/js/lab3d.js';
import { colormap } from '/assets/js/colors.js';

const tcol = (T, lo = 18, hi = 42) => { const c = colormap('turbo', Math.min(1, Math.max(0, (T - lo) / (hi - lo)))); return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255); };
function box(w, h, d, mat, x, y, z, r = 0.004) { const m = new THREE.Mesh(r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)) : new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; }
function cyl(r0, r1, h, mat, seg = 20) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat); m.castShadow = m.receiveShadow = true; return m; }
const shadow = o => { o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };

/* ------------------------------------------------------------ geometry builders */
/** Open-top crate (outer w × d × h, wall t) as merged geometry, origin at the bottom centre. */
function crateGeometry(w, d, h, t = 0.006, detail = true) {
  const parts = [];
  const add = (sx, sy, sz, x, y, z, shade = 1) => { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(x, y, z); g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(shade), 3)); parts.push(g); };
  add(w, t, d, 0, t / 2, 0, 0.8);
  add(w, h, t, 0, h / 2, d / 2 - t / 2); add(w, h, t, 0, h / 2, -d / 2 + t / 2);
  add(t, h, d - 2 * t, w / 2 - t / 2, h / 2, 0); add(t, h, d - 2 * t, -w / 2 + t / 2, h / 2, 0);
  // stacking rim (darker) and a foot band, which make the stack read as individual crates
  add(w + 0.008, 0.014, t + 0.008, 0, h - 0.007, d / 2 - t / 2, 0.45); add(w + 0.008, 0.014, t + 0.008, 0, h - 0.007, -d / 2 + t / 2, 0.45);
  add(t + 0.008, 0.014, d, w / 2 - t / 2, h - 0.007, 0, 0.45); add(t + 0.008, 0.014, d, -w / 2 + t / 2, h - 0.007, 0, 0.45);
  add(w - 0.01, 0.01, t + 0.004, 0, 0.005, d / 2 - t / 2, 0.6); add(w - 0.01, 0.01, t + 0.004, 0, 0.005, -d / 2 + t / 2, 0.6);
  // hand-hold recesses and ribs on the long sides
  [-1, 1].forEach(s => { add(0.14, 0.028, 0.012, 0, h - 0.042, s * (d / 2 + 0.002), 0.3); if (detail) for (let k = -2; k <= 2; k++) add(0.012, h * 0.55, 0.008, k * 0.11, h * 0.4, s * (d / 2 + 0.002), 0.85); });
  const g = BufferGeometryUtils.mergeGeometries(parts); parts.forEach(p => p.dispose()); return g;
}
/** Segmented larva along +x (length 1, centred), with vertex colours. kind: 'mealworm' | 'bsf'. */
function larvaGeometry(kind) {
  const nU = 16, nR = 6;
  const segs = kind === 'bsf' ? 11 : 13;
  const R0 = kind === 'bsf' ? 0.13 : 0.065;
  const rad = u => {
    const taper = kind === 'bsf' ? Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + u * 0.97)), 0.55) * (0.55 + 0.45 * Math.min(1, u * 1.6)) : Math.pow(Math.sin(Math.PI * Math.min(1, 0.04 + u * 0.96)), 0.35) * (0.85 + 0.15 * Math.min(1, u * 3));
    const band = 0.5 + 0.5 * Math.cos(2 * Math.PI * u * segs);
    return Math.max(0.004, R0 * taper * (1 - 0.1 * Math.pow(band, 6)));
  };
  const pos = [], col = [], idx = [];
  const cBody = kind === 'bsf' ? new THREE.Color(0xd9ceb4) : new THREE.Color(0xb3661f);
  const cBand = kind === 'bsf' ? new THREE.Color(0x9c8a68) : new THREE.Color(0x5c3210);
  const cHead = kind === 'bsf' ? new THREE.Color(0x2a2118) : new THREE.Color(0x5a3312);
  const cBelly = kind === 'bsf' ? new THREE.Color(0xe6dcc4) : new THREE.Color(0xd08a3c);
  const c = new THREE.Color();
  for (let i = 0; i <= nU; i++) {
    const u = i / nU; const x = u - 0.5; const r = rad(u);
    const band = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * u * segs), 8);
    for (let j = 0; j < nR; j++) {
      const a = 2 * Math.PI * j / nR; const y = Math.cos(a) * r * (kind === 'bsf' ? 0.62 : 1), z = Math.sin(a) * r;
      pos.push(x, y, z);
      c.copy(cBody).lerp(cBelly, Math.max(0, -Math.cos(a)) * 0.5).lerp(cBand, band * 0.8);
      if (u > 0.93) c.lerp(cHead, (u - 0.93) / 0.07);
      if (u < 0.05 && kind === 'mealworm') c.lerp(cHead, 0.4 * (1 - u / 0.05));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < nU; i++) for (let j = 0; j < nR; j++) { const a = i * nR + j, b = i * nR + (j + 1) % nR, cc = a + nR, d = b + nR; idx.push(a, b, cc, b, d, cc); }
  // end caps
  const capTail = pos.length / 3; pos.push(-0.5 - 0.004, 0, 0); col.push(cHead.r, cHead.g, cHead.b);
  const capHead = pos.length / 3; pos.push(0.5 + 0.006, 0, 0); col.push(cHead.r, cHead.g, cHead.b);
  for (let j = 0; j < nR; j++) { idx.push(capTail, (j + 1) % nR, j); const o = nU * nR; idx.push(capHead, o + j, o + (j + 1) % nR); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** Material with a wriggling vertex shader (lateral travelling wave along the body). */
function larvaMaterial(uTime, gloss) {
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: gloss ? 0.32 : 0.55, clearcoat: gloss ? 0.7 : 0.25, clearcoatRoughness: 0.35, sheen: 0.2 });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
      float ph = instanceMatrix[3].x * 91.7 + instanceMatrix[3].z * 57.3;
      float u = position.x + 0.5;
      float amp = 0.05 + 0.04 * sin(uTime * 0.7 + ph);
      transformed.z += sin(u * 7.0 - uTime * 3.2 + ph) * amp * (0.35 + u);
      transformed.y += sin(u * 5.0 + uTime * 2.1 + ph * 1.3) * 0.012;
      #endif`);
  };
  return mat;
}
/** Adult black soldier fly (body + wings) along +x, ~15 mm. */
function flyGeometry() {
  const parts = [];
  const body = new THREE.SphereGeometry(1, 8, 6); body.scale(0.0075, 0.0022, 0.0025); body.translate(-0.002, 0, 0);
  const thorax = new THREE.SphereGeometry(1, 8, 6); thorax.scale(0.0028, 0.0026, 0.0026); thorax.translate(0.0045, 0.0005, 0);
  const head = new THREE.SphereGeometry(1, 6, 5); head.scale(0.0016, 0.0019, 0.0024); head.translate(0.0078, 0.0004, 0);
  [body, thorax, head].forEach(g => { g.deleteAttribute('uv'); const n = g.attributes.position.count; g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(0.05), 3)); parts.push(g); });
  [-1, 1].forEach(s => { const w = new THREE.PlaneGeometry(0.009, 0.0032); w.rotateX(-Math.PI / 2); w.translate(-0.001, 0.0024, s * 0.0034); w.deleteAttribute('uv'); const n = w.attributes.position.count; w.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(0.35), 3)); parts.push(w); });
  return BufferGeometryUtils.mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p));
}
function substrateTexture(kind) {
  const r = rng(kind === 'bran' ? 3 : 9);
  return canvasTexture(256, 256, (ctx, w, h) => {
    if (kind === 'bran') {
      ctx.fillStyle = '#c9a36b'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) { const l = 0.75 + r() * 0.5; ctx.fillStyle = `rgba(${Math.min(255, 215 * l) | 0},${Math.min(255, 170 * l) | 0},${Math.min(255, 110 * l) | 0},0.8)`; ctx.beginPath(); ctx.ellipse(r() * w, r() * h, 1 + r() * 3.5, 0.8 + r() * 2, r() * 3, 0, 7); ctx.fill(); }
      for (let i = 0; i < 700; i++) { ctx.fillStyle = `rgba(90,60,35,${0.2 + r() * 0.3})`; ctx.fillRect(r() * w, r() * h, 1.2, 1.2); }
    } else {
      ctx.fillStyle = '#4a3322'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 3000; i++) { const l = 0.6 + r() * 0.8; ctx.fillStyle = `rgba(${(95 * l) | 0},${(68 * l) | 0},${(42 * l) | 0},0.7)`; ctx.beginPath(); ctx.arc(r() * w, r() * h, 0.6 + r() * 2.4, 0, 7); ctx.fill(); }
      for (let i = 0; i < 200; i++) { ctx.fillStyle = `rgba(160,140,90,${0.25 + r() * 0.3})`; ctx.fillRect(r() * w, r() * h, 3 + r() * 5, 1 + r()); }
    }
  }, { key: 'sub-' + kind, repeat: [2, 2] });
}

/* ================================================================= build */
export function buildFarm(stage) {
  const { scene } = stage;
  const api = { anchors: {}, pickRoots: [] };
  const uTime = { value: 0 };
  const room = makeRoom({ w: 15, d: 10, h: 3.6, wallColor: 0xd3d8d2, floor: 'epoxy' });
  room.floor.material.color.set(0x8d9894); scene.add(room);
  const panelMat = new THREE.MeshBasicMaterial({ color: 0xfbfaf4 });
  for (let x = -6; x <= 6; x += 2.4) for (const z of [-3, 0, 2.8]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), panelMat); p.rotation.x = Math.PI / 2; p.position.set(x, 3.59, z); scene.add(p); }
  // floor markings (walkways)
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe0b91c, roughness: 0.55 });
  const mark = (x0, z0, x1, z1) => { const g = new THREE.PlaneGeometry(Math.hypot(x1 - x0, z1 - z0), 0.07); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, yellow); m.rotation.y = -Math.atan2(z1 - z0, x1 - x0); m.position.set((x0 + x1) / 2, 0.004, (z0 + z1) / 2); m.receiveShadow = true; scene.add(m); };
  mark(-7.2, 1.3, 7.2, 1.3); mark(-0.35, -4.9, -0.35, 1.3); mark(0.35, -4.9, 0.35, 1.3);

  const galv = M.galvanised(), steel = M.steel(), dark = M.paintedSteel(0x3b4650);
  const stain = new THREE.MeshStandardMaterial({ color: 0xc4c9cd, metalness: 1, roughness: 0.3 });
  const rackBlue = M.paintedSteel(0x2d5c8a), rackOrange = M.paintedSteel(0xd9782a);

  /* ---- mealworm stacks on dollies */
  const MW = { rows: [-3.9, -2.6, -1.3], xs: [-6.5, -5.8, -5.1, -4.4, -3.7, -3.0, -2.3, -1.6], cw: 0.60, cd: 0.40, ch: 0.14 };
  const mwCrateGeo = crateGeometry(MW.cw, MW.cd, MW.ch, 0.006, false);
  const mwCrateMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0 });
  const mwBaseCol = new THREE.Color(0xc9d3da);
  let mwCrates = null, mwTops = null, dollies = null, castors = null;
  const branTex = substrateTexture('bran'), bsfTex = substrateTexture('bsf');
  const branMat = new THREE.MeshStandardMaterial({ map: branTex, roughness: 0.95 });
  const bsfSubMat = new THREE.MeshPhysicalMaterial({ map: bsfTex, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.5 });
  const mwGroup = new THREE.Group(); scene.add(mwGroup);
  api.buildStacks = levels => {
    mwGroup.clear(); const nStack = MW.rows.length * MW.xs.length; const lv = Math.min(16, levels);
    mwCrates = new THREE.InstancedMesh(mwCrateGeo, mwCrateMat, nStack * lv); mwTops = new THREE.InstancedMesh(new THREE.PlaneGeometry(MW.cw - 0.02, MW.cd - 0.02).rotateX(-Math.PI / 2), branMat, nStack);
    dollies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.64, 0.04, 0.44), dark, nStack); castors = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12).rotateX(Math.PI / 2), M.rubber(), nStack * 4);
    const m4 = new THREE.Matrix4(); let k = 0, s = 0;
    MW.rows.forEach(z => MW.xs.forEach(x => {
      m4.makeTranslation(x, 0.085, z); dollies.setMatrixAt(s, m4);
      [[-0.28, -0.18], [0.28, -0.18], [-0.28, 0.18], [0.28, 0.18]].forEach(([dx, dz], j) => { m4.makeTranslation(x + dx, 0.035, z + dz); castors.setMatrixAt(s * 4 + j, m4); });
      for (let l = 0; l < lv; l++) { m4.makeTranslation(x, 0.105 + l * (MW.ch - 0.012), z); mwCrates.setMatrixAt(k, m4); mwCrates.setColorAt(k, mwBaseCol); k++; }
      m4.makeTranslation(x, 0.105 + (lv - 1) * (MW.ch - 0.012) + 0.05, z); mwTops.setMatrixAt(s, m4); s++;
    }));
    [mwCrates, mwTops, dollies, castors].forEach(m => { m.castShadow = true; m.receiveShadow = true; mwGroup.add(m); });
    mwCrates.userData.info = { kind: 'mwstack' }; mwTops.userData.info = { kind: 'mwstack' };
    api.anchors.mwStack = new THREE.Vector3(MW.xs[4], 0.105 + lv * (MW.ch - 0.012) + 0.25, MW.rows[2]);
    api.mwLevels = lv;
  };

  /* ---- BSF racks (pallet-rack frames with black crates on beams) */
  const BS = { rows: [-3.9, -2.4, -0.9], xs: [1.35, 3.45], shelves: 6, cw: 0.60, cd: 0.40, ch: 0.19, pitch: 0.33 };
  const bsfGroup = new THREE.Group(); scene.add(bsfGroup);
  const bsfCrateGeo = crateGeometry(BS.cw, BS.cd, BS.ch, 0.006, false);
  const bsfCrateMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.6 });
  const bsfBaseCol = new THREE.Color(0x3a3e42);
  const nB = BS.rows.length * BS.xs.length * BS.shelves * 3;
  const bsfCrates = new THREE.InstancedMesh(bsfCrateGeo, bsfCrateMat, nB); const bsfTops = new THREE.InstancedMesh(new THREE.PlaneGeometry(BS.cw - 0.02, BS.cd - 0.02).rotateX(-Math.PI / 2), bsfSubMat, nB);
  { const m4 = new THREE.Matrix4(); let k = 0;
    BS.rows.forEach(z => BS.xs.forEach(x0 => {
      const L = 2.0; // rack length
      [[-L / 2, -0.23], [L / 2, -0.23], [-L / 2, 0.23], [L / 2, 0.23]].forEach(([dx, dz]) => bsfGroup.add(box(0.06, 2.2, 0.05, rackBlue, x0 + dx, 1.1, z + dz, 0.004)));
      for (let s = 0; s < BS.shelves; s++) {
        const y = 0.18 + s * BS.pitch;
        [-0.23, 0.23].forEach(dz => bsfGroup.add(box(L + 0.06, 0.05, 0.04, rackOrange, x0, y - 0.03, z + dz, 0.004)));
        for (let c = 0; c < 3; c++) { m4.makeTranslation(x0 - 0.64 + c * 0.64, y, z); bsfCrates.setMatrixAt(k, m4); bsfCrates.setColorAt(k, bsfBaseCol); m4.makeTranslation(x0 - 0.64 + c * 0.64, y + 0.075, z); bsfTops.setMatrixAt(k, m4); k++; }
      }
    }));
  }
  [bsfCrates, bsfTops].forEach(m => { m.castShadow = true; m.receiveShadow = true; bsfGroup.add(m); });
  bsfCrates.userData.info = { kind: 'bsfrack' }; bsfTops.userData.info = { kind: 'bsfrack' };
  api.anchors.bsfRack = new THREE.Vector3(BS.xs[1] + 0.4, 2.35, BS.rows[2]);

  /* ---- fly cage with adult flies */
  const cage = new THREE.Group(); const CX = 5.9, CZ = -3.7, CW = 1.3, CH = 1.9, CD = 1.3;
  const alu = M.aluminium();
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => cage.add(box(0.03, CH, 0.03, alu, CX + a * CW / 2, CH / 2 + 0.1, CZ + b * CD / 2, 0.003)));
  [0.1, CH + 0.1].forEach(y => { cage.add(box(CW, 0.03, 0.03, alu, CX, y, CZ - CD / 2, 0.003), box(CW, 0.03, 0.03, alu, CX, y, CZ + CD / 2, 0.003), box(0.03, 0.03, CD, alu, CX - CW / 2, y, CZ, 0.003), box(0.03, 0.03, CD, alu, CX + CW / 2, y, CZ, 0.003)); });
  const netTex = canvasTexture(64, 64, (c, w) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, w); c.strokeStyle = '#fff'; c.lineWidth = 2; for (let i = 0; i <= w; i += 8) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, w); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(w, i); c.stroke(); } }, { srgb: false, key: 'net', repeat: [18, 26] });
  const netMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, alphaMap: netTex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, roughness: 0.9, depthWrite: false });
  const netFaces = [[CW, CH, 0, CZ + CD / 2, 0], [CW, CH, 0, CZ - CD / 2, Math.PI], [CD, CH, CX + CW / 2, 0, Math.PI / 2], [CD, CH, CX - CW / 2, 0, -Math.PI / 2]];
  netFaces.forEach(([w, h, x, z, ry]) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), netMat); p.position.set(x || CX, CH / 2 + 0.1, z || CZ); p.rotation.y = ry; cage.add(p); });
  const netTop = new THREE.Mesh(new THREE.PlaneGeometry(CW, CD), netMat); netTop.rotation.x = -Math.PI / 2; netTop.position.set(CX, CH + 0.1, CZ); cage.add(netTop);
  cage.add(box(CW + 0.1, 0.08, CD + 0.1, M.paintedSteel(0xe8e8e2), CX, 0.05, CZ, 0.01));
  const lamp = box(0.9, 0.04, 0.3, M.emissive(0xfff3dc, 1.6), CX, CH + 0.35, CZ, 0.006); cage.add(lamp);
  [-0.35, 0.35].forEach(dx => cage.add(box(0.008, 0.25, 0.008, steel, CX + dx, CH + 0.22, CZ, 0.001)));
  // egg-laying flutes (corrugated cardboard) hanging from a bar, and a water tray
  cage.add(box(0.9, 0.02, 0.02, steel, CX, CH - 0.15, CZ, 0.002));
  const card = M.plastic(0xb58e5a, 0.9);
  for (let i = 0; i < 5; i++) cage.add(box(0.08, 0.14, 0.006, card, CX - 0.3 + i * 0.15, CH - 0.25, CZ, 0.001));
  cage.add(box(0.3, 0.03, 0.2, M.plastic(0x2f6fd6, 0.4), CX + 0.35, 0.12, CZ + 0.35, 0.005));
  cage.traverse(m => { if (m.isMesh) m.userData.info = { kind: 'cage' }; });
  scene.add(cage);
  const NF = 110; const flyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.95 });
  const flies = new THREE.InstancedMesh(flyGeometry(), flyMat, NF); flies.userData.info = { kind: 'cage' };
  const flyState = []; const fr = rng(21);
  for (let i = 0; i < NF; i++) flyState.push({ p: new THREE.Vector3(CX + (fr() - 0.5) * (CW - 0.2), 0.3 + fr() * (CH - 0.3), CZ + (fr() - 0.5) * (CD - 0.2)), v: new THREE.Vector3(fr() - 0.5, (fr() - 0.5) * 0.3, fr() - 0.5).multiplyScalar(0.4), rest: fr() < 0.6 ? fr() * 8 : 0 });
  scene.add(flies);
  api.anchors.cage = new THREE.Vector3(CX, CH + 0.55, CZ);

  /* ---- climate: air-handling unit, ducts, diffusers, sensors */
  const clim = new THREE.Group(); scene.add(clim);
  clim.add(box(2.2, 2.3, 0.8, M.paintedSteel(0xc7ccc9), 0, 1.15, -4.55, 0.02));
  const grille = canvasTexture(128, 64, (c, w, h) => { c.fillStyle = '#2b2f33'; c.fillRect(0, 0, w, h); c.fillStyle = '#6b7178'; for (let y = 2; y < h; y += 6) c.fillRect(2, y, w - 4, 3); }, { key: 'grille', repeat: [1, 1] });
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.7), new THREE.MeshStandardMaterial({ map: grille, roughness: 0.6, metalness: 0.4 })); gl.position.set(0, 0.6, -4.145); clim.add(gl);
  const fans = [];
  [-0.5, 0.5].forEach(x => { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 10, 40), M.paintedSteel(0x3a4148)); ring.position.set(x, 1.65, -4.14); clim.add(ring); const hub = new THREE.Group(); hub.position.set(x, 1.65, -4.13); for (let b = 0; b < 5; b++) { const bl = box(0.26, 0.07, 0.01, M.aluminium(), 0.13, 0, 0, 0.004); bl.rotation.x = 0.4; const arm = new THREE.Group(); arm.rotation.z = b / 5 * Math.PI * 2; arm.add(bl); hub.add(arm); } hub.add(cyl(0.05, 0.05, 0.05, dark).rotateX(Math.PI / 2)); clim.add(hub); fans.push(hub); const back = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), M.plasticBlack()); back.position.set(x, 1.65, -4.145); clim.add(back); });
  const hmiC = document.createElement('canvas'); hmiC.width = 256; hmiC.height = 128; const hmiT = new THREE.CanvasTexture(hmiC); hmiT.colorSpace = THREE.SRGBColorSpace;
  const hmi = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), new THREE.MeshBasicMaterial({ map: hmiT, toneMapped: false })); hmi.position.set(0.75, 1.1, -4.14); clim.add(hmi);
  const ductMat = M.galvanised();
  const ducts = [makePipe([[0, 2.3, -4.5], [0, 3.1, -4.3], [0, 3.15, -3.6], [0, 3.15, -2.5]], { radius: 0.2, material: ductMat, tension: 0.2 }), makePipe([[-6.8, 3.15, -2.5], [6.8, 3.15, -2.5]], { radius: 0.2, material: ductMat, segments: 12 })];
  ducts.forEach(d => clim.add(d));
  const flows = []; const diffX = [-5.6, -3.6, -1.6, 1.8, 3.6, 5.4];
  diffX.forEach(x => {
    const dif = cyl(0.16, 0.2, 0.08, M.paintedSteel(0xe9ebe8), 28); dif.position.set(x, 2.93, -2.5); clim.add(dif);
    [-1, 1].forEach(s => { const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, 2.88, -2.5), new THREE.Vector3(x + s * 0.3, 2.4, -2.5 + s * 0.4), new THREE.Vector3(x + s * 0.5, 1.2, -2.5 + s * 0.9), new THREE.Vector3(x + s * 0.4, 0.2, -2.5 + s * 1.2)]); const fl = new FlowAlong(curve, { count: 24, speed: 0.5, size: 0.05, color: 0x7cc8ff, opacity: 0.55 }); scene.add(fl.points); flows.push(fl); });
  });
  const sensor = (x, z, ry) => { const g = new THREE.Group(); g.add(box(0.14, 0.2, 0.05, M.plasticWhite(), 0, 0, 0, 0.01)); const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.05), M.emissive(0x5cc8ef, 1.2)); scr.position.set(0, 0.04, 0.026); g.add(scr); g.position.set(x, 1.6, z); g.rotation.y = ry; clim.add(g); return g; };
  sensor(-3.0, -4.97, 0); sensor(3.0, -4.97, 0);
  clim.traverse(m => { if (m.isMesh) m.userData.info = { kind: 'climate' }; });
  shadow(clim);
  api.anchors.climate = new THREE.Vector3(1.0, 2.95, -4.1); api.anchors.sensorMW = new THREE.Vector3(-3.0, 1.85, -4.9); api.anchors.sensorBSF = new THREE.Vector3(3.0, 1.85, -4.9);

  /* ---- sieving station */
  const sieve = new THREE.Group(); const SX = -2.2, SZ = 2.9;
  [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]].forEach(([dx, dz]) => sieve.add(box(0.05, 0.8, 0.05, stain, SX + dx, 0.4, SZ + dz, 0.004)));
  const deck = new THREE.Group(); deck.position.set(SX, 0.95, SZ); deck.rotation.z = -0.12;
  deck.add(box(1.3, 0.04, 0.72, stain, 0, -0.03, 0, 0.004));
  const meshTex = canvasTexture(64, 64, (c, w) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, w); c.fillStyle = '#000'; for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) c.fillRect(i * 8 + 2, j * 8 + 2, 5, 5); }, { srgb: false, key: 'sieve', repeat: [26, 14] });
  const meshPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.62).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.4, alphaMap: meshTex, alphaTest: 0.5, side: THREE.DoubleSide })); meshPlane.position.y = 0.005; deck.add(meshPlane);
  [-0.36, 0.36].forEach(dz => deck.add(box(1.3, 0.1, 0.02, stain, 0, 0.04, dz, 0.003)));
  sieve.add(deck);
  sieve.add(box(0.22, 0.16, 0.2, M.paintedSteel(0x2c5a86), SX + 0.3, 0.72, SZ - 0.42, 0.01));
  const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.1, 0.3, 4, 1, true), stain); hop.rotation.y = Math.PI / 4; hop.position.set(SX - 0.55, 1.3, SZ); sieve.add(hop);
  const outCrate = new THREE.Mesh(crateGeometry(0.6, 0.4, 0.14), new THREE.MeshStandardMaterial({ color: 0xc9d3da, vertexColors: true, roughness: 0.55 })); outCrate.position.set(SX + 0.95, 0.62, SZ); sieve.add(outCrate);
  sieve.add(box(0.6, 0.02, 0.45, stain, SX + 0.95, 0.6, SZ, 0.003)); [[-0.25, -0.18], [0.25, -0.18], [-0.25, 0.18], [0.25, 0.18]].forEach(([dx, dz]) => sieve.add(box(0.03, 0.6, 0.03, stain, SX + 0.95 + dx, 0.3, SZ + dz, 0.003)));
  const bag = box(0.7, 0.55, 0.6, M.fabric(0xf1efe6, 1), SX, 0.3, SZ, 0.06); bag.material.transparent = false; sieve.add(bag);
  sieve.traverse(m => { if (m.isMesh) m.userData.info = { kind: 'sieve' }; });
  shadow(sieve); scene.add(sieve);
  const NFR = 220; const frPos = new Float32Array(NFR * 3); const frV = new Float32Array(NFR);
  for (let i = 0; i < NFR; i++) { frPos[i * 3] = SX + (Math.random() - 0.5) * 1.1; frPos[i * 3 + 1] = 0.6 + Math.random() * 0.3; frPos[i * 3 + 2] = SZ + (Math.random() - 0.5) * 0.55; frV[i] = 0.4 + Math.random() * 0.8; }
  const frGeo = new THREE.BufferGeometry(); frGeo.setAttribute('position', new THREE.BufferAttribute(frPos, 3));
  const frass = new THREE.Points(frGeo, new THREE.PointsMaterial({ color: 0x6b5236, size: 0.008 })); scene.add(frass);
  api.anchors.sieve = new THREE.Vector3(SX + 0.3, 1.5, SZ + 0.2);

  /* ---- inspection table (mealworm) and trolley (BSF) with open crates */
  const table = new THREE.Group(); const TX = -5.2, TZ = 2.7;
  table.add(box(1.5, 0.03, 0.8, stain, TX, 0.9, TZ, 0.006), box(1.4, 0.02, 0.7, stain, TX, 0.25, TZ, 0.004));
  [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]].forEach(([dx, dz]) => table.add(box(0.035, 0.9, 0.035, stain, TX + dx, 0.45, TZ + dz, 0.004)));
  const mwOpen = new THREE.Mesh(crateGeometry(0.6, 0.4, 0.14), new THREE.MeshStandardMaterial({ color: 0xc9d3da, vertexColors: true, roughness: 0.55 })); mwOpen.position.set(TX - 0.2, 0.915, TZ); table.add(mwOpen);
  const mwSub = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.38).rotateX(-Math.PI / 2), branMat.clone()); mwSub.position.set(TX - 0.2, 0.915 + 0.05, TZ); table.add(mwSub);
  table.add(box(0.28, 0.05, 0.28, M.plasticGrey(), TX + 0.48, 0.94, TZ - 0.1, 0.01));
  const scaleTop = box(0.26, 0.008, 0.26, stain, TX + 0.48, 0.97, TZ - 0.1, 0.002); table.add(scaleTop);
  table.traverse(m => { if (m.isMesh) m.userData.info = { kind: 'mwcrate' }; });
  shadow(table); scene.add(table);
  const trolley = new THREE.Group(); const BX = 2.6, BZ = 2.7;
  trolley.add(box(1.0, 0.03, 0.6, stain, BX, 0.78, BZ, 0.005), box(1.0, 0.03, 0.6, stain, BX, 0.3, BZ, 0.005));
  [[-0.47, -0.27], [0.47, -0.27], [-0.47, 0.27], [0.47, 0.27]].forEach(([dx, dz]) => { trolley.add(box(0.03, 0.75, 0.03, stain, BX + dx, 0.42, BZ + dz, 0.003)); const w = cyl(0.04, 0.04, 0.03, M.rubber(), 14); w.rotation.x = Math.PI / 2; w.position.set(BX + dx, 0.04, BZ + dz); trolley.add(w); });
  trolley.add(box(0.03, 0.4, 0.5, stain, BX + 0.52, 1.0, BZ, 0.003));
  const bsfOpen = new THREE.Mesh(crateGeometry(0.6, 0.4, 0.19), new THREE.MeshStandardMaterial({ color: 0x3a3e42, vertexColors: true, roughness: 0.6 })); bsfOpen.position.set(BX - 0.15, 0.795, BZ); trolley.add(bsfOpen);
  const bsfSub = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.38).rotateX(-Math.PI / 2), bsfSubMat.clone()); bsfSub.position.set(BX - 0.15, 0.795 + 0.07, BZ); trolley.add(bsfSub);
  trolley.traverse(m => { if (m.isMesh) m.userData.info = { kind: 'bsfcrate' }; });
  shadow(trolley); scene.add(trolley);
  api.anchors.mwCrate = new THREE.Vector3(TX - 0.2, 1.25, TZ); api.anchors.bsfCrate = new THREE.Vector3(BX - 0.15, 1.15, BZ);

  /* ---- larvae (instanced) */
  const geoMW = larvaGeometry('mealworm'), geoBSF = larvaGeometry('bsf');
  const matMW = larvaMaterial(uTime, true), matBSF = larvaMaterial(uTime, false);
  const makeSwarm = (geo, mat, n, cx, cy, cz, w, d, seed) => {
    const im = new THREE.InstancedMesh(geo, mat, n); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
    const r = rng(seed); const st = [];
    for (let i = 0; i < n; i++) st.push({ x: (r() - 0.5) * w, z: (r() - 0.5) * d, a: r() * Math.PI * 2, sp: 0.4 + r() * 0.8, bur: r() < 0.3 ? -r() * 0.5 : 0, tw: r() * 10 });
    const c = new THREE.Color(1, 1, 1); for (let i = 0; i < n; i++) im.setColorAt(i, c);
    scene.add(im); return { im, st, cx, cy, cz, w, d, n, visible: n, L: 0.02, tint: new THREE.Color(1, 1, 1) };
  };
  const swarms = {
    mw: makeSwarm(geoMW, matMW, 460, TX - 0.2, 0.915 + 0.052, TZ, 0.54, 0.34, 5),
    bsf: makeSwarm(geoBSF, matBSF, 420, BX - 0.15, 0.795 + 0.072, BZ, 0.54, 0.34, 7),
    sieve: makeSwarm(geoMW, matMW, 70, SX, 0.0, SZ, 1.1, 0.56, 11)
  };
  swarms.mw.im.userData.info = { kind: 'mwcrate' }; swarms.bsf.im.userData.info = { kind: 'bsfcrate' }; swarms.sieve.im.userData.info = { kind: 'sieve' };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  function updateSwarm(sw, dt, t, onDeck) {
    // level of detail: larvae are only drawn and animated when the camera is close enough to see them
    stage.camera.getWorldPosition(camPos); const far = camPos.distanceTo(new THREE.Vector3(sw.cx, onDeck ? 0.95 : sw.cy, sw.cz)) > 4.2;
    sw.im.visible = !far; if (far) return;
    const L = sw.L;
    for (let i = 0; i < sw.n; i++) {
      const s = sw.st[i];
      if (i >= sw.visible) { m4.makeScale(0, 0, 0); sw.im.setMatrixAt(i, m4); continue; }
      s.a += (Math.sin(t * 0.9 + s.tw) * 0.9 + (Math.random() - 0.5) * 1.5) * dt;
      const v = s.sp * L * 0.25;
      s.x += Math.cos(s.a) * v * dt; s.z += Math.sin(s.a) * v * dt;
      if (onDeck) { s.x += dt * 0.05; if (s.x > sw.w / 2) s.x = -sw.w / 2; }
      const hw = sw.w / 2 - L * 0.4, hd = sw.d / 2 - L * 0.4;
      if (s.x > hw || s.x < -hw) { s.x = Math.max(-hw, Math.min(hw, s.x)); s.a = Math.PI - s.a; }
      if (s.z > hd || s.z < -hd) { s.z = Math.max(-hd, Math.min(hd, s.z)); s.a = -s.a; }
      let y = sw.cy + s.bur * L * 0.12;
      if (onDeck) { y = 0.955 - 0.12 * s.x + 0.012 + Math.sin(t * 40) * 0.002; }
      e.set(0, -s.a, onDeck ? -0.12 : 0); q.setFromEuler(e); sc.set(L, L, L); pv.set(sw.cx + s.x, y, sw.cz + s.z);
      m4.compose(pv, q, sc); sw.im.setMatrixAt(i, m4);
    }
    sw.im.instanceMatrix.needsUpdate = true;
  }

  /* ---- API */
  /** state: { species, m (mg), frac (0–1 through batch), survival, Tl, Tair, thermal, stage: 'larva'|'prepupa' } */
  api.setState = st => {
    const Lmw = 0.028 * Math.cbrt(Math.max(0.05, st.mwMass) / 140), Lbs = 0.022 * Math.cbrt(Math.max(0.05, st.bsfMass) / 200);
    swarms.mw.L = Lmw; swarms.sieve.L = 0.028; swarms.bsf.L = Lbs;
    swarms.mw.visible = Math.round(swarms.mw.n * Math.min(1, st.mwSurv)); swarms.bsf.visible = Math.round(swarms.bsf.n * Math.min(1, st.bsfSurv));
    // BSF prepupae darken
    const dk = Math.max(0, Math.min(1, (st.bsfFrac - 0.9) / 0.1));
    const c = new THREE.Color(1, 1, 1).lerp(new THREE.Color(0.25, 0.2, 0.16), dk);
    for (let i = 0; i < swarms.bsf.n; i++) swarms.bsf.im.setColorAt(i, i % 3 === 0 ? c : new THREE.Color(1, 1, 1).lerp(c, dk * 0.7));
    swarms.bsf.im.instanceColor.needsUpdate = true;
    // substrate: bran → frass, BSF substrate darkens and dries
    mwSub.material.color.set(0xffffff).lerp(new THREE.Color(0.66, 0.58, 0.48), Math.min(1, st.mwFrac * 1.1));
    bsfSub.material.color.set(0xffffff).lerp(new THREE.Color(0.7, 0.62, 0.55), Math.min(1, st.bsfFrac)); bsfSub.material.roughness = 0.5 + 0.4 * st.bsfFrac;
    // thermal view: colour crates by larval temperature
    const cm = st.thermal ? tcol(st.mwTl) : mwBaseCol, cb = st.thermal ? tcol(st.bsfTl) : bsfBaseCol;
    if (mwCrates) { for (let i = 0; i < mwCrates.count; i++) mwCrates.setColorAt(i, cm); mwCrates.instanceColor.needsUpdate = true; }
    for (let i = 0; i < bsfCrates.count; i++) bsfCrates.setColorAt(i, cb); bsfCrates.instanceColor.needsUpdate = true;
    flows.forEach(f => { f.speed = 0.25 + st.airFlow * 1.2; f.points.material.opacity = 0.25 + 0.45 * Math.min(1, st.airFlow); });
  };
  api.setHMI = d => { const c = hmiC.getContext('2d'); c.fillStyle = '#0b1418'; c.fillRect(0, 0, 256, 128); c.fillStyle = '#9be7b6'; c.font = '600 17px Inter, sans-serif'; c.fillText('AHU · climate', 10, 22); c.font = '500 14px JetBrains Mono, monospace'; c.fillStyle = '#e6eee9'; c.fillText(`T  ${d.T.toFixed(1)} °C  RH ${d.RH.toFixed(0)} %`, 10, 50); c.fillText(`CO₂ ${d.co2.toFixed(0)} ppm`, 10, 74); c.fillText(`air ${d.V.toFixed(0)} m³/h`, 10, 98); c.fillStyle = '#86a3ad'; c.fillText(`heat ${d.kW.toFixed(1)} kW`, 10, 120); hmiT.needsUpdate = true; };
  api.animate = (dt, t, run) => {
    uTime.value = t;
    updateSwarm(swarms.mw, dt, t, false); updateSwarm(swarms.bsf, dt, t, false); updateSwarm(swarms.sieve, dt, t, true);
    fans.forEach(f => { f.rotation.z -= dt * 9; });
    deck.position.y = 0.95 + Math.sin(t * 40) * 0.0025;
    const pa = frGeo.attributes.position; for (let i = 0; i < NFR; i++) { let y = pa.getY(i) - dt * frV[i] * 0.5; if (y < 0.58) y = 0.9; pa.setY(i, y); } pa.needsUpdate = true;
    flows.forEach(f => f.update(dt));
    // flies: wander, some rest on the net
    for (let i = 0; i < NF; i++) {
      const f = flyState[i];
      if (f.rest > 0) { f.rest -= dt; } else {
        f.v.x += (Math.random() - 0.5) * dt * 2.5; f.v.y += (Math.random() - 0.5) * dt * 1.2; f.v.z += (Math.random() - 0.5) * dt * 2.5; f.v.clampLength(0.08, 0.5);
        f.p.addScaledVector(f.v, dt);
        const hx = CW / 2 - 0.04, hz = CD / 2 - 0.04;
        if (Math.abs(f.p.x - CX) > hx) { f.p.x = CX + Math.sign(f.p.x - CX) * hx; f.v.x *= -1; if (Math.random() < 0.3) f.rest = 1 + Math.random() * 5; }
        if (Math.abs(f.p.z - CZ) > hz) { f.p.z = CZ + Math.sign(f.p.z - CZ) * hz; f.v.z *= -1; if (Math.random() < 0.3) f.rest = 1 + Math.random() * 5; }
        if (f.p.y < 0.2 || f.p.y > CH) { f.p.y = Math.max(0.2, Math.min(CH, f.p.y)); f.v.y *= -1; }
      }
      e.set(0, Math.atan2(-f.v.z, f.v.x), 0); q.setFromEuler(e); sc.set(1, 1, 1); m4.compose(f.p, q, sc); flies.setMatrixAt(i, m4);
    }
    flies.instanceMatrix.needsUpdate = true;
  };
  api.pickRoots = () => [mwGroup, bsfGroup, cage, flies, clim, sieve, table, trolley, swarms.mw.im, swarms.bsf.im];
  api.buildStacks(12);
  return api;
}
