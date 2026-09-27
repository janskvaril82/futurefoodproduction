/* ==========================================================================
   wholeleaf.js — a whole lettuce leaf in an air stream (1 scene unit = 1 cm)
   · leaf blade whose width follows the "leaf width" slider, clamped on a stand
   · lab fan upstream (blade speed ∝ wind speed), flow tracers, vapour plume ∝ E
   · thermal-camera view: local leaf temperature from a local energy balance with
     a laminar boundary layer that thickens downstream (conductance ∝ x^−½)
   · translucent diffusion boundary layer (thickness computed by the model)
   · thermocouple and meter showing the modelled mean leaf temperature
   ========================================================================== */
import { THREE, M, RoundedBoxGeometry, makeLEDBar, rng, noise2, fbm2, canvasTexture } from '/assets/js/lab3d.js';
import { SpriteCloud, glyphTexture } from '/laboratories/leaf-photosynthesis/anatomy.js';
import { colormap } from '/assets/js/colors.js';
import * as SM from './model.js';

const NS = 56, NQ = 44;           // blade grid (along midrib × across)
const TEX_S = 72, TEX_Q = 56;     // thermal texture resolution

export function buildWholeLeaf(stage) {
  const group = new THREE.Group();
  const Y_TABLE = -16;
  /* ---------------- table + backdrop */
  const table = new THREE.Mesh(new THREE.PlaneGeometry(260, 160), new THREE.MeshStandardMaterial({ color: 0x1b211e, roughness: 0.92 }));
  table.rotation.x = -Math.PI / 2; table.position.y = Y_TABLE; table.receiveShadow = true; group.add(table);
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(260, 120), new THREE.MeshStandardMaterial({ color: 0x141a17, roughness: 1 }));
  backdrop.position.set(0, 44, -60); backdrop.receiveShadow = true; group.add(backdrop);

  /* ---------------- leaf blade */
  let W = 10, L = 10.5;
  // relative half-width along the blade: a broad, rounded butterhead-type leaf; never exactly zero (no degenerate triangles)
  const f = s => Math.max(0.035, Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(Math.min(1, s * 0.985 + 0.012), 0.72))), 0.55));
  const R = rng(5);
  const bump = [];                                                                     // bullate relief (lettuce leaves are blistered)
  for (let i = 0; i <= NS; i++) for (let j = 0; j <= NQ; j++) bump.push(fbm2(i / NS * 7 + 3, j / NQ * 6, 3));
  const bladeGeo = new THREE.BufferGeometry();
  const bPos = new Float32Array((NS + 1) * (NQ + 1) * 3), bUv = new Float32Array((NS + 1) * (NQ + 1) * 2), bIdx = [];
  for (let i = 0; i < NS; i++) for (let j = 0; j < NQ; j++) { const a = i * (NQ + 1) + j, b = a + 1, c = a + NQ + 1, d = c + 1; bIdx.push(a, c, b, b, c, d); }
  bladeGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3)); bladeGeo.setAttribute('uv', new THREE.BufferAttribute(bUv, 2)); bladeGeo.setIndex(bIdx);
  const surfPoint = (s, q, out) => {
    const hw = W / 2 * f(s);
    const x = q * hw, z = L / 2 - L * s;                           // base at +z (towards the stand … placed behind), tip at −z? (see below)
    let y = 0.085 * W * q * q * Math.pow(f(s), 1.2)               // cupping
      + 0.03 * L * Math.sin(Math.PI * s) * (1 - 0.3 * q * q)      // gentle arch
      + 0.016 * W * Math.pow(Math.abs(q), 3) * Math.sin(9 * Math.PI * s + 2.2 * q) * Math.min(1, s * 4) // marginal ruffles
      - 0.06 * W * Math.exp(-q * q * 60) * f(s);                   // midrib groove
    const k = (Math.round(s * NS) * (NQ + 1) + Math.round((q + 1) / 2 * NQ));
    y += 0.018 * W * (bump[k] || 0) * (1 - Math.exp(-q * q * 30));
    return out.set(x, y, -z);
  };
  const _p = new THREE.Vector3();
  function buildBlade(w) {
    W = w; L = 1.05 * w;
    for (let i = 0; i <= NS; i++) for (let j = 0; j <= NQ; j++) {
      const s = i / NS, q = j / NQ * 2 - 1, k = i * (NQ + 1) + j;
      surfPoint(s, q, _p); bPos[k * 3] = _p.x; bPos[k * 3 + 1] = _p.y; bPos[k * 3 + 2] = _p.z;
      bUv[k * 2] = j / NQ; bUv[k * 2 + 1] = s;
    }
    bladeGeo.attributes.position.needsUpdate = true; bladeGeo.attributes.uv.needsUpdate = true; bladeGeo.computeVertexNormals(); bladeGeo.computeBoundingSphere();
  }
  buildBlade(W);
  // natural colour + vein relief textures (u across = flow direction, v along midrib)
  const leafTex = canvasTexture(512, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#5f9f33'); g.addColorStop(0.3, '#86c247'); g.addColorStop(0.5, '#a8d766'); g.addColorStop(0.7, '#86c247'); g.addColorStop(1, '#5f9f33');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const r = rng(9);
    for (let i = 0; i < 2600; i++) { ctx.fillStyle = `rgba(${40 + r() * 60},${90 + r() * 60},${20 + r() * 40},${0.05 + r() * 0.07})`; const s = 3 + r() * 9; ctx.beginPath(); ctx.arc(r() * w, r() * h, s, 0, 6.3); ctx.fill(); }
    ctx.lineCap = 'round';
    for (let k = 0; k < 13; k++) { const y0 = h * (0.06 + k * 0.074); [-1, 1].forEach(sd => { ctx.strokeStyle = 'rgba(225,245,190,0.55)'; ctx.lineWidth = 5 - k * 0.25; ctx.beginPath(); ctx.moveTo(w / 2, y0); ctx.bezierCurveTo(w / 2 + sd * w * 0.14, y0 + h * 0.02, w / 2 + sd * w * 0.3, y0 + h * 0.06, w / 2 + sd * w * 0.49, y0 + h * 0.14); ctx.stroke(); }); }
    ctx.strokeStyle = 'rgba(220,240,190,0.22)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 520; i++) { const x = r() * w, y = r() * h; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 34, y + (r() - 0.5) * 34); ctx.stroke(); }
    const mg = ctx.createLinearGradient(w / 2 - 14, 0, w / 2 + 14, 0); mg.addColorStop(0, 'rgba(235,250,205,0)'); mg.addColorStop(0.5, 'rgba(238,252,210,0.95)'); mg.addColorStop(1, 'rgba(235,250,205,0)');
    ctx.fillStyle = mg; ctx.fillRect(w / 2 - 14, 0, 28, h);
  }, { key: 'st-leaf-col', anisotropy: 8 });
  const leafBump = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#7a7a7a'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { const v = 122 + 60 * fbm2(x / 38, y / 38, 3); ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x, y, 4, 4); }
    ctx.strokeStyle = '#d8d8d8'; ctx.lineCap = 'round';
    for (let k = 0; k < 13; k++) { const y0 = h * (0.06 + k * 0.074); [-1, 1].forEach(sd => { ctx.lineWidth = 6 - k * 0.3; ctx.beginPath(); ctx.moveTo(w / 2, y0); ctx.bezierCurveTo(w / 2 + sd * w * 0.14, y0 + h * 0.02, w / 2 + sd * w * 0.3, y0 + h * 0.06, w / 2 + sd * w * 0.49, y0 + h * 0.14); ctx.stroke(); }); }
    ctx.fillStyle = '#f0f0f0'; ctx.fillRect(w / 2 - 7, 0, 14, h);
  }, { key: 'st-leaf-bump', srgb: false, anisotropy: 8 });
  const natMat = new THREE.MeshPhysicalMaterial({ map: leafTex, bumpMap: leafBump, bumpScale: 1.4, roughness: 0.46, clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.35, sheenColor: new THREE.Color(0xd9f0b0), side: THREE.DoubleSide });
  const thermCanvas = document.createElement('canvas'); thermCanvas.width = TEX_Q; thermCanvas.height = TEX_S;
  const thermTex = new THREE.CanvasTexture(thermCanvas); thermTex.colorSpace = THREE.SRGBColorSpace; thermTex.magFilter = THREE.LinearFilter; thermTex.minFilter = THREE.LinearFilter;
  const thermMat = new THREE.MeshBasicMaterial({ map: thermTex, side: THREE.DoubleSide, toneMapped: false });
  const blade = new THREE.Mesh(bladeGeo, natMat); blade.castShadow = true; blade.receiveShadow = true; blade.userData.kind = 'leaf';
  const LEAF_Y = 0;
  blade.position.y = LEAF_Y; group.add(blade);

  /* ---------------- petiole, clamp and stand (behind the leaf, at −z) */
  const steel = M.steel(), black = M.plasticBlack();
  const petMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe7a0, roughness: 0.45, sheen: 0.4, sheenColor: new THREE.Color(0xf0ffd0) });
  let petiole = null, stand = new THREE.Group(); group.add(stand);
  function buildStand() {
    stand.clear(); if (petiole) { group.remove(petiole); petiole.geometry.dispose(); }
    const zb = -L / 2 - 0.2;
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, LEAF_Y - 0.1, zb + 0.6), new THREE.Vector3(0, LEAF_Y - 0.25, zb - 2), new THREE.Vector3(0, LEAF_Y - 0.6, zb - 4.5)]);
    petiole = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.32, 10, false), petMat); petiole.castShadow = true; group.add(petiole);
    const cz = zb - 5.2;
    const clampBody = new THREE.Mesh(new RoundedBoxGeometry(2.2, 1.6, 1.6, 2, 0.25), black); clampBody.position.set(0, LEAF_Y - 0.6, cz); stand.add(clampBody);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.4, 12), steel); screw.position.set(0, LEAF_Y + 0.6, cz); stand.add(screw);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.35, 20), black); knob.position.set(0, LEAF_Y + 1.8, cz); stand.add(knob);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 7, 14), steel); arm.rotation.x = Math.PI / 2; arm.position.set(0, LEAF_Y - 0.6, cz - 4.2); stand.add(arm);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, LEAF_Y - 0.6 - Y_TABLE + 1, 18), steel); rod.position.set(0, (LEAF_Y - 0.6 + Y_TABLE) / 2, cz - 7.8); stand.add(rod);
    const boss = new THREE.Mesh(new RoundedBoxGeometry(1.8, 1.8, 1.8, 2, 0.3), M.anodised()); boss.position.set(0, LEAF_Y - 0.6, cz - 7.8); stand.add(boss);
    const base = new THREE.Mesh(new RoundedBoxGeometry(12, 1.2, 9, 2, 0.4), M.paintedSteel(0x2c3136)); base.position.set(0, Y_TABLE + 0.6, cz - 7.8); stand.add(base);
    stand.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
  buildStand();

  /* ---------------- axial fan upstream (−x) */
  const fan = new THREE.Group(); group.add(fan);
  const fanBlades = new THREE.Group();
  const FAN_R = 6.5;
  {
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(FAN_R + 0.7, FAN_R + 0.7, 4, 48, 1, true), M.plastic(0xe7e9e6, 0.4)); housing.rotation.z = Math.PI / 2; housing.material.side = THREE.DoubleSide; fan.add(housing);
    [-2, 2].forEach(dx => { const lip = new THREE.Mesh(new THREE.TorusGeometry(FAN_R + 0.7, 0.35, 10, 48), M.plastic(0xe7e9e6, 0.4)); lip.rotation.y = Math.PI / 2; lip.position.x = dx; fan.add(lip); });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 2.8, 28), M.plasticGrey()); hub.rotation.z = Math.PI / 2; fanBlades.add(hub);
    const bladeShape = new THREE.Shape(); bladeShape.moveTo(0, -0.9); bladeShape.bezierCurveTo(3, -2.4, 6.5, -2.2, 7.6, -0.4); bladeShape.bezierCurveTo(6.8, 1.6, 3.2, 1.8, 0, 0.9); bladeShape.lineTo(0, -0.9);
    const bGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.18, bevelEnabled: false, curveSegments: 16 });
    // shape x (radial) → y, shape y (chord) → z, extrusion (thickness) → x (the fan axis); then pitch and move out to the hub
    bGeo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    bGeo.rotateY(0.5); bGeo.translate(0, 1.5, 0);
    const bMat = M.plastic(0x2a2e33, 0.45);
    for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(bGeo, bMat); b.rotation.x = k / 5 * Math.PI * 2; fanBlades.add(b); }
    fan.add(fanBlades);
    const guardMat = M.steel();
    for (let r = 2.5; r <= FAN_R; r += 1.5) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 6, 64), guardMat); ring.rotation.y = Math.PI / 2; ring.position.x = 2.6; fan.add(ring); }
    for (let k = 0; k < 8; k++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, FAN_R * 2, 6), guardMat); sp.position.x = 2.6; sp.rotation.x = k / 8 * Math.PI; fan.add(sp); }
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, Math.abs(Y_TABLE) - FAN_R + 1, 14), steel); post.position.y = -(FAN_R + (Math.abs(Y_TABLE) - FAN_R) / 2); fan.add(post);
    const fb = new THREE.Mesh(new RoundedBoxGeometry(9, 1, 7, 2, 0.35), M.paintedSteel(0x2c3136)); fb.position.y = Y_TABLE + 0.5; fan.add(fb);
    fan.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
  function placeFan() { fan.position.set(-W / 2 - 22, 0, 0); }
  placeFan();

  /* ---------------- flow tracers: short streaks with a bright head and a fading tail */
  const NF = 1100, fPos = new Float32Array(NF * 6), fCol = new Float32Array(NF * 6), fSeed = new Float32Array(NF);
  for (let i = 0; i < NF; i++) { fCol.set([0.5, 0.78, 1.0, 0, 0, 0], i * 6); }
  const fGeo = new THREE.BufferGeometry(); fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3)); fGeo.setAttribute('color', new THREE.BufferAttribute(fCol, 3));
  const dotTex = glyphTexture('dot');
  const flow = new THREE.LineSegments(fGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
  flow.frustumCulled = false; group.add(flow);
  const box = () => ({ x0: -W / 2 - 16, x1: W / 2 + 26, y0: -7, y1: 9, z0: -L / 2 - 4, z1: L / 2 + 4 });
  let B = box();
  const fBase = new Float32Array(NF * 3);
  for (let i = 0; i < NF; i++) { fBase[i * 3] = B.x0 + R() * (B.x1 - B.x0); fBase[i * 3 + 1] = B.y0 + R() * (B.y1 - B.y0); fBase[i * 3 + 2] = B.z0 + R() * (B.z1 - B.z0); fSeed[i] = R() * 10; }

  /* ---------------- vapour leaving the leaf */
  const vap = new SpriteCloud(1200, { map: dotTex });
  vap.points.renderOrder = 6; group.add(vap.points);
  const vp = []; let vAcc = 0;

  /* ---------------- boundary-layer shells */
  const blMat = new THREE.MeshPhysicalMaterial({ color: 0x8fdcff, transparent: true, opacity: 0.17, roughness: 0.15, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 });
  const blGeos = [0, 1].map(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bPos.length), 3)); g.setIndex(bIdx); return g; });
  const blMeshes = blGeos.map(g => { const m = new THREE.Mesh(g, blMat); m.renderOrder = 4; m.position.y = LEAF_Y; group.add(m); return m; });
  let blKey = '';
  function updateBL(deltaCm) {
    const key = deltaCm.toFixed(3) + '|' + W; if (key === blKey) return; blKey = key;
    const nrm = bladeGeo.attributes.normal;
    blGeos.forEach((g, side) => {
      const P = g.attributes.position;
      for (let i = 0; i <= NS; i++) for (let j = 0; j <= NQ; j++) {
        const k = i * (NQ + 1) + j, q = j / NQ * 2 - 1;
        const xr = (q + 1) / 2;                                   // fraction of the local chord from the leading edge
        const th = 2 * deltaCm * Math.sqrt(Math.max(0.004, xr)) * (i === 0 || i === NS || j === 0 || j === NQ ? 0.25 : 1);
        const sg = side ? -1 : 1;
        P.setXYZ(k, bPos[k * 3] + sg * nrm.getX(k) * th, bPos[k * 3 + 1] + sg * nrm.getY(k) * th, bPos[k * 3 + 2] + sg * nrm.getZ(k) * th);
      }
      P.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
    });
  }

  /* ---------------- thermocouple and meter */
  const meter = new THREE.Group(); group.add(meter);
  const meterBody = new THREE.Mesh(new RoundedBoxGeometry(7.5, 1.8, 11.5, 3, 0.6), M.plastic(0xf2b632, 0.5)); meter.add(meterBody);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.2), new THREE.MeshStandardMaterial({ color: 0x0b1a10, emissive: 0x3cff8a, emissiveIntensity: 0.18, roughness: 0.2 }));
  screen.rotation.x = -Math.PI / 2; screen.position.set(0, 0.92, -2.4); meter.add(screen);
  [-1.6, 0, 1.6].forEach(x => { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 16), M.plasticBlack()); b.position.set(x, 0.95, 2.2); meter.add(b); });
  meter.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  let wire = null;
  const meterLabel = stage.addLabel(meter, '', { className: 'label3d lg', offset: [0, 4.2, -2] });
  function placeMeter() {
    meter.position.set(W / 2 + 12, Y_TABLE + 0.9, -9);
    meter.rotation.y = -0.5;
    if (wire) { group.remove(wire); wire.geometry.dispose(); }
    // junction pressed against the underside of the blade, half-way out from the midrib
    const tip = surfPoint(0.42, 0.3, new THREE.Vector3()).add(new THREE.Vector3(0, LEAF_Y - 0.22, 0));
    const c = new THREE.CatmullRomCurve3([tip, tip.clone().add(new THREE.Vector3(0.8, -2.5, -0.5)), new THREE.Vector3(W / 2 + 5, Y_TABLE + 3, -4), meter.position.clone().add(new THREE.Vector3(-1.5, 0.6, -4.5))]);
    wire = new THREE.Mesh(new THREE.TubeGeometry(c, 60, 0.07, 6, false), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 })); group.add(wire);
    junction.position.copy(tip);
  }
  const junction = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), M.copper()); group.add(junction);
  placeMeter();

  /* ---------------- light fixtures */
  const leds = new THREE.Group(); group.add(leds);
  [-7, 7].forEach(z => { const bar = makeLEDBar({ length: 0.46, width: 0.07, color: 'full', light: false }); bar.scale.setScalar(100); bar.position.set(0, 34, z); leds.add(bar); });
  const ledRig = new THREE.Group(); leds.add(ledRig);
  [-1, 1].forEach(s => { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 26, 6), M.steel()); w.position.set(s * 20, 47, 0); ledRig.add(w); });

  /* ---------------- labels */
  const lab = {
    wind: stage.addLabel([-W / 2 - 20, 12, 0], ''),
    edge: stage.addLabel([-W / 2 - 0.5, 2.2, 0], 'Leading edge<small>thinnest boundary layer</small>'),
    bl: stage.addLabel([W / 2 + 1, 3, -L * 0.2], '')
  };
  Object.values(lab).forEach(l => group.add(l));

  /* ---------------- thermal image */
  let thermOn = false, lastT = null;
  function computeThermal(env, gs) {
    const rad = SM.radiation(env);
    const d = 0.72 * (W / 100);
    // scale factor so that the area-mean local forced conductance equals the whole-leaf mean (flat-plate theory)
    let sw = 0, sk = 0;
    for (let i = 0; i < TEX_S; i++) { const s = (i + 0.5) / TEX_S, c = W / 100 * f(s); if (c <= 0) continue; for (let j = 0; j < TEX_Q; j++) { const xr = (j + 0.5) / TEX_Q * c / d; sw += c; sk += c / Math.sqrt(xr); } }
    const scaleH = sw / sk;
    const T = new Float32Array(TEX_S * TEX_Q); let tmin = Infinity, tmax = -Infinity, mean = 0, nm = 0;
    for (let i = 0; i < TEX_S; i++) {
      const s = (i + 0.5) / TEX_S, c = Math.max(1e-4, W / 100 * f(s));
      for (let j = 0; j < TEX_Q; j++) {
        const xr = (j + 0.5) / TEX_Q * c / d;
        const t = SM.localLeafT(env, gs, xr, scaleH, rad);
        T[i * TEX_Q + j] = t; tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); mean += t * c; nm += c;
      }
    }
    return { T, tmin, tmax, mean: mean / nm };
  }
  function paintThermal(th, Ta) {
    let lo = Math.min(Ta, th.tmin) - 0.3, hi = Math.max(Ta, th.tmax) + 0.3;
    if (hi - lo < 2) { const m = (hi + lo) / 2; lo = m - 1; hi = m + 1; }
    const ctx = thermCanvas.getContext('2d'); const img = ctx.createImageData(TEX_Q, TEX_S);
    for (let i = 0; i < TEX_S; i++) for (let j = 0; j < TEX_Q; j++) {
      const c = colormap('inferno', (th.T[i * TEX_Q + j] - lo) / (hi - lo)); const k = ((TEX_S - 1 - i) * TEX_Q + j) * 4;
      img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0); thermTex.needsUpdate = true;
    return { lo, hi };
  }

  /* ---------------- per-frame update */
  const api = {
    group, blade, pickables: [blade, meterBody],
    get width() { return W; }, get length() { return L; },
    setWidth(wcm) { if (Math.abs(wcm - W) < 1e-6) return; buildBlade(wcm); buildStand(); placeFan(); placeMeter(); B = box(); for (let i = 0; i < NF; i++) { fBase[i * 3] = B.x0 + R() * (B.x1 - B.x0); fBase[i * 3 + 1] = B.y0 + R() * (B.y1 - B.y0); fBase[i * 3 + 2] = B.z0 + R() * (B.z1 - B.z0); } blKey = ''; lab.edge.position.set(-W / 2 - 0.5, 2.2, 0); lab.wind.position.set(-W / 2 - 20, 12, 0); lab.bl.position.set(W / 2 + 1, 3, -L * 0.2); },
    setThermal(on) { thermOn = on; blade.material = on ? thermMat : natMat; blMat.opacity = on ? 0.07 : 0.17; },
    setSource(src, ppfd) { leds.visible = src === 'led'; leds.children.forEach(b => b.setIntensity && b.setIntensity(ppfd > 0 ? Math.min(1, 0.25 + ppfd / 600) : 0)); },
    /** Recompute the thermal map (call when the state changes); returns {lo, hi, tmin, tmax, mean}. */
    thermal(env, gs) { const th = computeThermal(env, gs); const r = paintThermal(th, env.Ta); lastT = Object.assign(th, r); return lastT; },
    update(dt, t, s, camera, heightPx) {
      // s: { u, E (mmol), deltaMm, showFlow, showVapour, showBL, amphi, TL, Ta, dTfree }
      fanBlades.rotation.x -= dt * (2 + 26 * Math.sqrt(s.u));
      // tracers: visual speed grows with wind (not to scale)
      const v = 3 + 22 * Math.pow(s.u, 0.65);
      flow.visible = s.showFlow;
      if (s.showFlow) {
        const span = B.x1 - B.x0, len = 0.35 + 0.09 * v;
        const defl = (x, y, z) => { if (Math.abs(z) < L / 2 && x > -W / 2 - 4 && x < W / 2 + 10) { const dy = y - LEAF_Y; const g = Math.exp(-dy * dy / 3) * Math.exp(-Math.max(0, x + W / 2) / (W * 0.8)); return y + Math.sign(dy || 1) * 1.2 * g; } return y; };
        for (let i = 0; i < NF; i++) {
          let x = fBase[i * 3] + v * t * (0.8 + 0.4 * ((fSeed[i] * 7.3) % 1)); x = B.x0 + ((x - B.x0) % span + span) % span;
          const y = fBase[i * 3 + 1] + 0.25 * Math.sin(t * 1.7 + fSeed[i] * 3), z = fBase[i * 3 + 2] + 0.25 * Math.cos(t * 1.3 + fSeed[i]);
          const xt = Math.max(B.x0, x - len);
          fPos[i * 6] = x; fPos[i * 6 + 1] = defl(x, y, z); fPos[i * 6 + 2] = z;
          fPos[i * 6 + 3] = xt; fPos[i * 6 + 4] = defl(xt, y, z); fPos[i * 6 + 5] = z;
        }
        fGeo.attributes.position.needsUpdate = true;
      }
      // vapour plume from the leaf surfaces
      vap.setViewport(camera, heightPx);
      vAcc += dt * (s.showVapour ? 24 * Math.max(0, s.E) : 0);
      while (vAcc > 1 && vp.length < 1200) {
        vAcc -= 1; const sPar = 0.08 + Math.random() * 0.84, q = Math.random() * 2 - 1; surfPoint(sPar, q, _p);
        const up = s.amphi ? (Math.random() < 0.5 ? 1 : -1) : -1;
        vp.push({ x: _p.x, y: _p.y + LEAF_Y + up * 0.25, z: _p.z, up, age: 0, life: 1.8 + Math.random() * 1.6, ph: Math.random() * 9 });
      }
      if (vAcc > 1) vAcc = 0;
      const vx = 0.55 * v, buoy = 1.5 + 5 * (s.dTfree || 0);
      let n = 0;
      for (let i = vp.length - 1; i >= 0; i--) { const p = vp[i]; p.age += dt; if (p.age > p.life) { vp.splice(i, 1); continue; } p.x += vx * dt * Math.min(1, p.age * 2.5); p.y += (p.up * 0.9 * Math.exp(-p.age * 2) + buoy * 0.25 * p.age) * dt; p.z += 0.4 * Math.sin(t * 1.5 + p.ph) * dt; }
      for (const p of vp) { const a = p.age / p.life; vap.set(n++, p.x, p.y, p.z, 0.35 + 1.5 * a, 0.2 * Math.min(1, a * 5) * (1 - a) ** 1.3, 0.8, 0.93, 1.0); }
      vap.commit(n);
      // boundary layer
      blMeshes.forEach(m => { m.visible = s.showBL; });
      if (s.showBL) updateBL(s.deltaMm / 10);
      lab.bl.visible = s.showBL; if (s.showBL) lab.bl.element.innerHTML = `Boundary layer<small>δ ≈ ${s.deltaMm.toFixed(1)} mm (mean)</small>`;
      lab.wind.element.innerHTML = `Air stream<small>u = ${s.u.toFixed(2)} m s⁻¹</small>`;
      meterLabel.element.innerHTML = `Thermocouple<small>leaf ${s.TL.toFixed(1)} °C · air ${s.Ta.toFixed(1)} °C</small>`;
    }
  };
  return api;
}
