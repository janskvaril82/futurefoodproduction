/* ==========================================================================
   epidermis.js — procedural 3D close-up of a leaf epidermis (1 scene unit = 1 µm)
   · jigsaw pavement cells: domain-warped Voronoi cells with domed tops, grooved
     anticlinal walls, faint nuclei, cuticular striations (normal map) and the
     green mesophyll glowing through the transparent epidermis
   · anomocytic stomata: kidney-shaped guard-cell pairs (morph target = aperture)
     with chloroplasts and a nucleus in each guard cell, sitting over a dark
     sub-stomatal cavity
   · particle plumes of water vapour (and CO₂ entering) driven by the model fluxes
   ========================================================================== */
import { THREE, rng, noise2 } from '/assets/js/lab3d.js';
import { guardPairGeometry, SpriteCloud, glyphTexture } from '/laboratories/leaf-photosynthesis/anatomy.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Build the epidermis patch. Returns { group, stomata, density, guards, update(dt, t, s), pickables }.
 * W × D µm; nStomata placed with a minimum spacing (anomocytic arrangement).
 */
export function buildEpidermis({ W = 260, D = 180, seed = 11, nStomata = 6, pxPerUm = 3, GC = { L: 28, rMid: 5.2, rPole: 3.4, wMax: 9 } } = {}) {
  const R = rng(seed);
  const group = new THREE.Group();
  /* ---------------- 1. stomata (footprint ellipses) */
  const stomata = [];
  for (let k = 0; k < 8000 && stomata.length < nStomata; k++) {
    const x = -W / 2 + 26 + R() * (W - 52), z = -D / 2 + 24 + R() * (D - 48);
    if (stomata.every(s => Math.hypot(s.x - x, s.z - z) > 64)) stomata.push({ x, z, rot: (R() - 0.5) * Math.PI * 0.9 + (R() < 0.5 ? 0 : Math.PI / 2) * 0.35, a: GC.L / 2 + 1.2, b: GC.rPole + (GC.rMid - GC.rPole) + GC.rMid + 1.0 });
  }
  stomata.forEach(s => { s.c = Math.cos(s.rot); s.sn = Math.sin(s.rot); });
  /* ---------------- 2. pavement-cell seeds (Poisson disc) */
  const seeds = [];
  const X0 = -W / 2 - 40, Z0 = -D / 2 - 40, WW = W + 80, DD = D + 80;
  for (let k = 0; k < 30000 && seeds.length < 400; k++) {
    const x = X0 + R() * WW, z = Z0 + R() * DD;
    if (stomata.some(s => Math.hypot(s.x - x, s.z - z) < 26)) continue;
    if (seeds.every(q => (q.x - x) ** 2 + (q.z - z) ** 2 > 35 * 35)) seeds.push({ x, z, H: 3.2 + R() * 1.6, tint: R(), nx: (R() - 0.5) * 12, nz: (R() - 0.5) * 12, nr: R() * Math.PI, dir: R() * Math.PI });
  }
  const CELL = 32, GX = Math.ceil(WW / CELL), GZ = Math.ceil(DD / CELL);
  const buckets = Array.from({ length: GX * GZ }, () => []);
  seeds.forEach((s, i) => { const gx = Math.min(GX - 1, Math.floor((s.x - X0) / CELL)), gz = Math.min(GZ - 1, Math.floor((s.z - Z0) / CELL)); buckets[gz * GX + gx].push(i); });

  /* ---------------- 3. raster: height, colour, cell id */
  const TW = Math.round(W * pxPerUm), TH = Math.round(D * pxPerUm);
  const Hh = new Float32Array(TW * TH);   // geometry height (µm)
  const Hn = new Float32Array(TW * TH);   // height incl. micro-relief (for the normal map)
  const col = new Uint8ClampedArray(TW * TH * 4);
  const cBase = [198, 228, 180], cMeso = [106, 170, 82], cGap = [48, 92, 46], cWall = [104, 146, 96], cPit = [6, 14, 7], cNuc = [201, 194, 214];
  const lerp3 = (a, b, t, o) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };
  const tmp = [0, 0, 0], tmp2 = [0, 0, 0];
  // spongy-mesophyll pattern under the epidermis (independent, coarser cells)
  const meso = []; for (let k = 0; k < 20000 && meso.length < 300; k++) { const x = X0 + R() * WW, z = Z0 + R() * DD; if (meso.every(q => (q.x - x) ** 2 + (q.z - z) ** 2 > 21 * 21)) meso.push({ x, z }); }
  const MB = Array.from({ length: GX * GZ }, () => []);
  meso.forEach((s, i) => { const gx = Math.min(GX - 1, Math.floor((s.x - X0) / CELL)), gz = Math.min(GZ - 1, Math.floor((s.z - Z0) / CELL)); MB[gz * GX + gx].push(i); });
  for (let j = 0; j < TH; j++) {
    const z = -D / 2 + (j + 0.5) / pxPerUm;
    for (let i = 0; i < TW; i++) {
      const x = -W / 2 + (i + 0.5) / pxPerUm, idx = j * TW + i;
      // nearest stoma (elliptical distance)
      let e = 9, sId = -1, sAlong = 0, sAcross = 0;
      for (let k = 0; k < stomata.length; k++) {
        const s = stomata[k], dx = x - s.x, dz = z - s.z; if (Math.abs(dx) > 40 || Math.abs(dz) > 40) continue;
        const al = dx * s.c + dz * s.sn, ac = -dx * s.sn + dz * s.c;
        const ee = Math.sqrt((al / s.a) ** 2 + (ac / s.b) ** 2); if (ee < e) { e = ee; sId = k; sAlong = al; sAcross = ac; }
      }
      // domain warp → interlocking lobes of the anticlinal walls
      const wx = x + 10 * noise2(x / 14 + 3.1, z / 14 + 7.7) + 2.6 * noise2(x / 5.5 - 2.2, z / 5.5 + 9.4);
      const wz = z + 10 * noise2(x / 14 - 5.3, z / 14 + 1.9) + 2.6 * noise2(x / 5.5 + 4.4, z / 5.5 - 3.3);
      const gx = Math.floor((wx - X0) / CELL), gz = Math.floor((wz - Z0) / CELL);
      let d1 = 1e9, d2 = 1e9, i1 = 0, i2 = 0;
      for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
        const bx = gx + ox, bz = gz + oz; if (bx < 0 || bz < 0 || bx >= GX || bz >= GZ) continue;
        const B = buckets[bz * GX + bx];
        for (let q = 0; q < B.length; q++) { const s = seeds[B[q]]; const dd = (wx - s.x) ** 2 + (wz - s.z) ** 2; if (dd < d1) { d2 = d1; i2 = i1; d1 = dd; i1 = B[q]; } else if (dd < d2) { d2 = dd; i2 = B[q]; } }
      }
      const s1 = seeds[i1], s2 = seeds[i2];
      const sep = Math.hypot(s2.x - s1.x, s2.z - s1.z) || 1;
      let bdist = (d2 - d1) / (2 * sep);                       // distance to the Voronoi bisector (µm)
      const bSto = (e - 1) * 11;                                // distance to the stomatal complex outline
      const nearSto = bSto < bdist;
      bdist = Math.min(bdist, bSto);
      let h, hn;
      if (e < 1) {
        // inside the stomatal complex: dark pit under the guard cells
        h = -5 + 3.2 * smooth(0.6, 1.0, e); hn = h;
        const t2 = smooth(0.5, 1.0, e);
        lerp3(cPit, [30, 56, 28], t2, tmp);
        col[idx * 4] = tmp[0]; col[idx * 4 + 1] = tmp[1]; col[idx * 4 + 2] = tmp[2]; col[idx * 4 + 3] = 255;
        Hh[idx] = h; Hn[idx] = hn; continue;
      }
      const t = Math.min(1, Math.max(0, bdist / 4.2));
      const shoulder = 1 - Math.pow(1 - t, 3);
      const rr = Math.sqrt(d1) / 24;
      const dome = 1 - 0.3 * Math.min(1, rr * rr);
      const stoDip = 0.5 + 0.5 * smooth(1.0, 1.9, e);      // cells slope down towards the guard cells
      h = s1.H * shoulder * dome * stoDip - 0.35;
      // cuticular striations: per-cell direction, radiating around stomata
      let dir = s1.dir;
      if (sId >= 0 && e < 2.4) { const s = stomata[sId]; dir = Math.atan2(z - s.z, x - s.x) + Math.PI / 2; }
      const pr = (x * Math.cos(dir) + z * Math.sin(dir)) / 1.35 + 1.4 * noise2(x / 9, z / 9);
      const striae = 0.11 * Math.sin(Math.PI * 2 * pr) * smooth(0.15, 0.6, t) * (0.6 + 0.4 * noise2(x / 5 + 11, z / 5));
      hn = h + striae + 0.05 * noise2(x / 1.8, z / 1.8);
      Hh[idx] = h; Hn[idx] = hn;
      // colour: transparent epidermis over glowing mesophyll
      let m1 = 1e9, m2 = 1e9; const mgx = Math.floor((x - X0) / CELL), mgz = Math.floor((z - Z0) / CELL);
      for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) { const bx = mgx + ox, bz = mgz + oz; if (bx < 0 || bz < 0 || bx >= GX || bz >= GZ) continue; const B = MB[bz * GX + bx]; for (let q = 0; q < B.length; q++) { const s = meso[B[q]]; const dd = (x - s.x) ** 2 + (z - s.z) ** 2; if (dd < m1) { m2 = m1; m1 = dd; } else if (dd < m2) m2 = dd; } }
      const mEdge = (Math.sqrt(m2) - Math.sqrt(m1));        // small in the air gaps between mesophyll cells
      lerp3(cGap, cMeso, smooth(0.5, 5, mEdge), tmp);
      lerp3(tmp, cBase, 0.5 + 0.12 * (s1.tint - 0.5), tmp2);
      // darker anticlinal walls, darker ring over the sub-stomatal cavity
      const wall = 1 - smooth(0.0, 1.3, bdist);
      lerp3(tmp2, cWall, wall * (nearSto ? 0.35 : 0.75), tmp2);
      if (sId >= 0) { const sh = 1 - smooth(1.0, 1.75, e); tmp2[0] *= 1 - 0.28 * sh; tmp2[1] *= 1 - 0.22 * sh; tmp2[2] *= 1 - 0.28 * sh; }
      // nucleus (faint lilac ellipse)
      const ndx = wx - (s1.x + s1.nx), ndz = wz - (s1.z + s1.nz);
      const na = ndx * Math.cos(s1.nr) + ndz * Math.sin(s1.nr), nb = -ndx * Math.sin(s1.nr) + ndz * Math.cos(s1.nr);
      const nuc = 1 - smooth(0.75, 1.0, Math.sqrt((na / 4.2) ** 2 + (nb / 3.0) ** 2));
      if (nuc > 0) lerp3(tmp2, cNuc, nuc * 0.32, tmp2);
      // soft shading of the dome (fake subsurface: brighter tops)
      const glow = 0.92 + 0.1 * shoulder;
      col[idx * 4] = tmp2[0] * glow; col[idx * 4 + 1] = tmp2[1] * glow; col[idx * 4 + 2] = tmp2[2] * glow; col[idx * 4 + 3] = 255;
    }
  }
  /* ---------------- 4. textures */
  const colCanvas = document.createElement('canvas'); colCanvas.width = TW; colCanvas.height = TH;
  colCanvas.getContext('2d').putImageData(new ImageData(col, TW, TH), 0, 0);
  const nrm = new Uint8ClampedArray(TW * TH * 4);
  const sH = 3.2;   // normal strength (µm height per µm)
  for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
    const ix0 = Math.max(0, i - 1), ix1 = Math.min(TW - 1, i + 1), jz0 = Math.max(0, j - 1), jz1 = Math.min(TH - 1, j + 1);
    const hx = (Hn[j * TW + ix1] - Hn[j * TW + ix0]) * pxPerUm / (ix1 - ix0);
    const hv = (Hn[jz0 * TW + i] - Hn[jz1 * TW + i]) * pxPerUm / (jz1 - jz0);     // +v (texture up) = −z
    let nx = -hx * sH * 0.35, ny = -hv * sH * 0.35, nz = 1; const L = Math.hypot(nx, ny, nz);
    const k = (j * TW + i) * 4; nrm[k] = (nx / L * 0.5 + 0.5) * 255; nrm[k + 1] = (ny / L * 0.5 + 0.5) * 255; nrm[k + 2] = (nz / L * 0.5 + 0.5) * 255; nrm[k + 3] = 255;
  }
  const nCanvas = document.createElement('canvas'); nCanvas.width = TW; nCanvas.height = TH;
  nCanvas.getContext('2d').putImageData(new ImageData(nrm, TW, TH), 0, 0);
  const colTex = new THREE.CanvasTexture(colCanvas); colTex.colorSpace = THREE.SRGBColorSpace; colTex.anisotropy = 8;
  const nTex = new THREE.CanvasTexture(nCanvas); nTex.anisotropy = 8;
  /* ---------------- 5. surface mesh (1 µm vertex spacing, height from the raster) */
  const NX = Math.round(W), NZ = Math.round(D);
  const pos = new Float32Array((NX + 1) * (NZ + 1) * 3), uv = new Float32Array((NX + 1) * (NZ + 1) * 2), index = [];
  const hAt = (x, z) => { const fx = (x + W / 2) * pxPerUm - 0.5, fz = (z + D / 2) * pxPerUm - 0.5; const i0 = Math.max(0, Math.min(TW - 2, Math.floor(fx))), j0 = Math.max(0, Math.min(TH - 2, Math.floor(fz))); const tx = Math.min(1, Math.max(0, fx - i0)), tz = Math.min(1, Math.max(0, fz - j0)); const a = Hh[j0 * TW + i0], b = Hh[j0 * TW + i0 + 1], c = Hh[(j0 + 1) * TW + i0], d = Hh[(j0 + 1) * TW + i0 + 1]; return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz; };
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    const k = j * (NX + 1) + i, x = -W / 2 + W * i / NX, z = -D / 2 + D * j / NZ;
    pos[k * 3] = x; pos[k * 3 + 1] = hAt(x, z); pos[k * 3 + 2] = z; uv[k * 2] = i / NX; uv[k * 2 + 1] = 1 - j / NZ;
  }
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; index.push(a, c, b, b, c, d); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(index); geo.computeVertexNormals();
  const surfMat = new THREE.MeshPhysicalMaterial({ map: colTex, normalMap: nTex, normalScale: new THREE.Vector2(1, 1), roughness: 0.42, clearcoat: 0.75, clearcoatRoughness: 0.28, sheen: 0.35, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xe6ffd8) });
  const surface = new THREE.Mesh(geo, surfMat); surface.receiveShadow = true; surface.castShadow = true; surface.userData.kind = 'pavement';
  group.add(surface);
  // cut edges: curtains that follow the surface profile down to y = −22 µm, textured as a section through
  // the epidermis and the spongy mesophyll, so the patch reads as a piece of tissue
  const Y_BOT = -22;
  const secTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const ctx = cv.getContext('2d');
    const r2 = rng(77);
    ctx.fillStyle = '#16351a'; ctx.fillRect(0, 0, 512, 128);
    for (let k = 0; k < 90; k++) { const x = r2() * 512, y = 34 + r2() * 94, rx = 12 + r2() * 16, ry = 9 + r2() * 12; ctx.fillStyle = `rgb(${70 + r2() * 30},${130 + r2() * 40},${60 + r2() * 20})`; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, r2() * 3, 0, 6.3); ctx.fill(); ctx.strokeStyle = 'rgba(200,235,180,0.35)'; ctx.lineWidth = 1.5; ctx.stroke(); for (let c = 0; c < 6; c++) { ctx.fillStyle = 'rgba(40,110,30,0.9)'; const a = r2() * 6.3; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * rx * 0.7, y + Math.sin(a) * ry * 0.7, 2.6, 1.6, a, 0, 6.3); ctx.fill(); } }
    const g = ctx.createLinearGradient(0, 0, 0, 34); g.addColorStop(0, '#d9efcb'); g.addColorStop(0.8, '#bcdcaa'); g.addColorStop(1, '#8fbf7a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 30);
    ctx.strokeStyle = 'rgba(90,130,80,0.8)'; ctx.lineWidth = 2; for (let x = 0; x < 512; x += 36 + r2() * 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 30); ctx.stroke(); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
  })();
  const secMat = new THREE.MeshStandardMaterial({ map: secTex, roughness: 0.75, side: THREE.DoubleSide });
  const curtain = (pts) => {                     // pts: [x, z] along an edge
    const n = pts.length, P = new Float32Array(n * 2 * 3), U = new Float32Array(n * 2 * 2), I = [];
    let acc = 0;
    for (let q = 0; q < n; q++) {
      const [x, z] = pts[q]; if (q) acc += Math.hypot(x - pts[q - 1][0], z - pts[q - 1][1]);
      const top = hAt(x, z);
      P.set([x, top, z, x, Y_BOT, z], q * 6); U.set([acc / 120, 1, acc / 120, 0], q * 4);   // v = 1 at the surface, 0 at the bottom
      if (q) { const a = (q - 1) * 2, b = a + 1, c = q * 2, d = c + 1; I.push(a, b, c, c, b, d); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals();
    const m = new THREE.Mesh(g, secMat); m.receiveShadow = true; group.add(m);
  };
  const edgePts = (x0, z0, x1, z1) => { const n = Math.round(Math.hypot(x1 - x0, z1 - z0)); return Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]); };
  curtain(edgePts(-W / 2, D / 2, W / 2, D / 2)); curtain(edgePts(W / 2, D / 2, W / 2, -D / 2)); curtain(edgePts(W / 2, -D / 2, -W / 2, -D / 2)); curtain(edgePts(-W / 2, -D / 2, -W / 2, D / 2));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x0f2412, roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.y = Y_BOT; group.add(floor);

  /* ---------------- 6. guard cells with chloroplasts and nuclei */
  const gGeo = guardPairGeometry({ L: GC.L, rMid: GC.rMid, rPole: GC.rPole, wMax: GC.wMax, segT: 56, segR: 22, flatten: 0.8 });
  const GD = gGeo.userData;
  // guard-cell texture (u along the cell, v around it): chloroplasts seen through the thin wall, a nucleus,
  // and the radial micellation (cellulose microfibrils) that turns swelling into opening
  const gcTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const ctx = cv.getContext('2d');
    const r2 = rng(99);
    const bg = ctx.createLinearGradient(0, 0, 0, 128); bg.addColorStop(0, '#b4dc98'); bg.addColorStop(0.5, '#c9e9b0'); bg.addColorStop(1, '#b4dc98');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = 'rgba(240,255,225,0.45)'; ctx.lineWidth = 1.2;
    for (let x = 6; x < 512; x += 7) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 2 * Math.sin(x), 128); ctx.stroke(); }
    for (let k = 0; k < 26; k++) {
      const x = 50 + r2() * 412, y = r2() * 128, rx = 14 + r2() * 8, ry = 8 + r2() * 5, a = (r2() - 0.5) * 0.8;
      [0, 128, -128].forEach(dy => { const g = ctx.createRadialGradient(x - 3, y + dy - 2, 1, x, y + dy, rx); g.addColorStop(0, '#6ccb46'); g.addColorStop(0.55, '#2f8c22'); g.addColorStop(1, 'rgba(40,110,30,0.0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y + dy, rx, ry, a, 0, 6.3); ctx.fill(); });
    }
    const ng = ctx.createRadialGradient(256, 64, 2, 256, 64, 22); ng.addColorStop(0, 'rgba(214,206,232,0.95)'); ng.addColorStop(1, 'rgba(190,180,215,0)'); ctx.fillStyle = ng; ctx.beginPath(); ctx.ellipse(256, 64, 26, 17, 0, 0, 6.3); ctx.fill();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  })();
  const gMat = new THREE.MeshPhysicalMaterial({ map: gcTex, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.14, sheen: 0.5, sheenColor: new THREE.Color(0xeaffd6) });
  const guards = stomata.map(s => {
    const m = new THREE.Mesh(gGeo, gMat); m.position.set(s.x, -0.6, s.z); m.rotation.y = Math.PI / 2 - s.rot; m.morphTargetInfluences = [0.2];
    m.castShadow = true; m.receiveShadow = true; m.userData.kind = 'guard'; group.add(m); return m;
  });
  // distant glyph sprites must not sample low mip levels (their transparent-black backgrounds turn into dark squares)
  ['h2o', 'co2'].forEach(k => { const t = glyphTexture(k); t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; });

  /* ---------------- 7. particle plumes */
  const vap = new SpriteCloud(1400, { map: glyphTexture('dot') });
  const h2o = new SpriteCloud(160, { map: glyphTexture('h2o') });
  const co2 = new SpriteCloud(120, { map: glyphTexture('co2') });
  [vap, h2o, co2].forEach(c => { c.points.renderOrder = 5; group.add(c.points); });
  const P = { vap: [], h2o: [], co2: [] }; let acc = { vap: 0, h2o: 0, co2: 0 };
  const pores = () => stomata.map(s => new THREE.Vector3(s.x, 3.2, s.z));
  let porePts = pores();

  /* ---------------- 8. scale bar */
  const barMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(50, 0.6, 0.6), barMat); bar.position.set(W / 2 - 32, 1, D / 2 + 9); group.add(bar);
  [-25, 25].forEach(dx => { const tk = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3, 0.6), barMat); tk.position.set(W / 2 - 32 + dx, 1, D / 2 + 9); group.add(tk); });

  const area = W * D * 1e-12;                               // m²
  const density = stomata.length / area;                   // m⁻² (this side)
  let k = 0.2;

  /** Advance the animation. s: { k (0–1 aperture), E (mmol m⁻² s⁻¹), A (µmol m⁻² s⁻¹), wind (m s⁻¹), plumes, molecules }. */
  function update(dt, t, s, camera, heightPx) {
    // aperture (already smoothed by the caller); slight individual variation
    k = s.k;
    guards.forEach((g, i) => { g.morphTargetInfluences[0] = Math.max(0, Math.min(1, k * (0.9 + 0.2 * Math.sin(i * 2.3)))); });
    [vap, h2o, co2].forEach(c => c.setViewport(camera, heightPx));
    const open = Math.max(0.02, k);
    const drift = 3.5 * Math.log1p(4 * s.wind);            // µm s⁻¹ downwind (x), visual only
    // emission rates (visual scaling): ∝ transpiration and ∝ net CO₂ uptake
    acc.vap += dt * (s.plumes ? 40 * Math.max(0, s.E) : 0);
    acc.h2o += dt * (s.molecules ? 4 * Math.max(0, s.E) : 0);
    acc.co2 += dt * (s.molecules ? 0.6 * Math.max(0, s.A) : 0);
    const pick = () => porePts[Math.floor(Math.random() * porePts.length)];
    const nV = Math.floor(acc.vap), nH = Math.floor(acc.h2o), nC = Math.floor(acc.co2);
    for (let q = 0; q < nV && P.vap.length < 1400; q++) { const p = pick(); P.vap.push({ x: p.x + (Math.random() - 0.5) * 5, y: p.y, z: p.z + (Math.random() - 0.5) * 3, vx: 0, vy: 6 + Math.random() * 5, vz: 0, age: 0, life: 6 + Math.random() * 3, ph: Math.random() * 9 }); }
    for (let q = 0; q < nH && P.h2o.length < 160; q++) { const p = pick(); P.h2o.push({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 8 + Math.random() * 5, vz: 0, age: 0, life: 4 + Math.random() * 2, ph: Math.random() * 9 }); }
    for (let q = 0; q < nC && P.co2.length < 120; q++) { const p = pick(); P.co2.push({ tx: p.x, tz: p.z, x: p.x - 25 + (Math.random() - 0.5) * 40, y: 25 + Math.random() * 18, z: p.z + (Math.random() - 0.5) * 36, age: 0, life: 4.5, ph: Math.random() * 9 }); }
    acc.vap -= nV; acc.h2o -= nH; acc.co2 -= nC;
    const step = (list, cloud, size0, size1, alpha0, colr) => {
      let n = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]; p.age += dt; if (p.age > p.life) { list.splice(i, 1); continue; }
        p.x += (drift + 1.8 * Math.sin(t * 1.3 + p.ph)) * dt; p.y += p.vy * dt * (0.5 + 0.5 * Math.exp(-p.age * 0.6)); p.z += 1.6 * Math.cos(t * 1.1 + p.ph * 1.3) * dt;
      }
      for (const p of list) { const a = p.age / p.life; cloud.set(n++, p.x, p.y, p.z, size0 + (size1 - size0) * a, alpha0 * Math.min(1, a * 6) * (1 - a) ** 1.4, colr[0], colr[1], colr[2]); }
      cloud.commit(n);
    };
    step(P.vap, vap, 3, 16, 0.5 * Math.min(1, 0.45 + open), [0.62, 0.84, 1.0]);
    step(P.h2o, h2o, 3.6, 4.4, 0.95, [1, 1, 1]);
    // CO₂ glides towards a pore and disappears into it
    let n = 0;
    for (let i = P.co2.length - 1; i >= 0; i--) { const p = P.co2[i]; p.age += dt; const f = Math.min(1, p.age / p.life); if (f >= 1) { P.co2.splice(i, 1); continue; } }
    for (const p of P.co2) { const f = Math.min(1, p.age / p.life), e = f * f * (3 - 2 * f); const x = p.x + (p.tx - p.x) * e, z = p.z + (p.tz - p.z) * e, y = p.y + (1.5 - p.y) * e + 1.2 * Math.sin(t * 2 + p.ph); co2.set(n++, x, y, z, 5, Math.min(1, f * 5) * (1 - Math.max(0, f - 0.85) / 0.15), 1, 1, 1); }
    co2.commit(n);
  }
  return { group, stomata, guards, density, W, D, GC, update, surface, pickables: [surface, ...guards], hAt };
}
