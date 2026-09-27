/* Solar-powered autonomous weeding robot (generic design, no brand):
   straddle frame over six 50 cm rows, four solar panels on the roof, four in-wheel-motor wheels,
   three downward cameras with LED ring flashes and a visible field-of-view frustum, a spot-spray
   boom with one solenoid valve and nozzle per spray cell, a tank and pump, raised inter-row hoes,
   RTK-GNSS antenna, beacon, emergency stops and a safety bumper.
   Robot frame: +x forward (direction of travel), y up, z lateral; origin on the ground at the centre. */
import { THREE, M, RoundedBoxGeometry, canvasTexture, BufferGeometryUtils } from '/assets/js/lab3d.js';

export const ROBOT = { length: 2.7, width: 3.3, frameY: 1.18, roofY: 1.46, wheelX: 0.9, wheelZ: 1.5, wheelR: 0.36, camX: 1.25, camY: 0.95, camZ: [-1.0, 0, 1.0], footX: 0.7, footZ: 1.0, nozzleX: 0.35, nozzleY: 0.3 };

function mesh(geo, mat, x = 0, y = 0, z = 0, parent) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; if (parent) parent.add(m); return m; }
function tube(a, b, r, mat, parent, radial = 10) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b); const d = B.clone().sub(A); const L = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, radial), mat); m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function box(a, b, w, h, mat, parent) { // box-section beam from a to b (square w × h)
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b); const d = B.clone().sub(A); const L = d.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, L), mat); m.position.copy(A).add(B).multiplyScalar(0.5);
  m.lookAt(B.clone().add(m.position).sub(A)); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function solarTexture() {
  return canvasTexture(512, 512, (ctx, W, H) => {
    ctx.fillStyle = '#d9dde0'; ctx.fillRect(0, 0, W, H);
    const nx = 6, ny = 6, cw = W / nx, ch = H / ny;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const x = i * cw + 3, y = j * ch + 3, w = cw - 6, h = ch - 6, c = 8;
      const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, '#0e1d36'); g.addColorStop(1, '#16305a'); ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x + c, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c); ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x + c, y + h); ctx.lineTo(x, y + h - c); ctx.lineTo(x, y + c); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(210,216,224,0.55)'; for (let b = 1; b <= 5; b++) ctx.fillRect(x + b * w / 6 - 0.7, y, 1.4, h);
    }
  }, { key: 'fr-solar' });
}
function warningLabel() {
  return canvasTexture(512, 128, (ctx, W, H) => {
    ctx.fillStyle = '#f2c300'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#111'; for (let i = -4; i < 20; i++) { ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32 + 16, 0); ctx.lineTo(i * 32 + 16 - 20, 22); ctx.lineTo(i * 32 - 20, 22); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(i * 32, H - 22); ctx.lineTo(i * 32 + 16, H - 22); ctx.lineTo(i * 32 - 4, H); ctx.lineTo(i * 32 - 20, H); ctx.closePath(); ctx.fill(); }
    ctx.font = '700 34px Inter, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('AUTONOMOUS MACHINE · KEEP 3 m CLEAR', W / 2, H / 2 + 1);
  }, { key: 'fr-warn' });
}
function tyreGeometry(R, w) {
  // tyre with chevron lugs: a torus-like lathe plus instanced lugs merged
  const prof = []; const n = 14;
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + Math.PI * i / n; prof.push(new THREE.Vector2(R - 0.09 + 0.09 * Math.cos(a) * 1.0, (w / 2) * Math.sin(a))); }
  const body = new THREE.LatheGeometry(prof, 40); body.rotateX(Math.PI / 2);
  const lugs = [];
  for (let k = 0; k < 22; k++) {
    const a = k / 22 * Math.PI * 2;
    [-1, 1].forEach(s => { const g = new THREE.BoxGeometry(0.05, 0.028, w * 0.42); g.rotateY(s * 0.45); g.translate(0, R + 0.004, s * w * 0.2); g.rotateZ(a + (s > 0 ? 0.07 : 0)); lugs.push(g); });
  }
  const lugG = BufferGeometryUtils.mergeGeometries(lugs.map(g => g.toNonIndexed())); lugs.forEach(g => g.dispose());
  const bodyNI = body.toNonIndexed(); body.dispose();
  ['uv'].forEach(a => { if (!lugG.attributes[a] || !bodyNI.attributes[a]) { lugG.deleteAttribute(a); bodyNI.deleteAttribute(a); } });
  const g = BufferGeometryUtils.mergeGeometries([bodyNI, lugG]); bodyNI.dispose(); lugG.dispose(); g.computeVertexNormals();
  return g;
}

export function buildRobot() {
  const R = ROBOT; const g = new THREE.Group(); g.name = 'robot';
  const white = M.paintedSteel(0xeef0ec), grey = M.plasticGrey(), black = M.plasticBlack(), alu = M.aluminium(), steel = M.steel(), rubber = M.rubber();
  const orange = M.plastic(0xe66a1f, 0.4), yellow = M.plastic(0xf2c300, 0.45), red = M.plastic(0xd21f1f, 0.35);
  /* ---- chassis: two side modules over the wheel tracks and a bridging frame ---- */
  const fy = R.frameY;
  [-1, 1].forEach(s => {
    const z = s * R.wheelZ;
    box([-1.3, fy, z], [1.3, fy, z], 0.12, 0.16, white, g);                         // longitudinal main beam
    box([-1.3, fy - 0.42, z], [1.3, fy - 0.42, z], 0.08, 0.08, white, g);           // lower beam
    [-R.wheelX, R.wheelX].forEach(x => {
      box([x, fy - 0.06, z], [x, R.wheelR + 0.12, z], 0.11, 0.11, white, g);        // wheel leg
      // steering/drive head with motor housing
      mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 20), grey, x, fy - 0.12, z, g);
      const fork = new THREE.Group(); fork.position.set(x, R.wheelR, z); g.add(fork);
      [-1, 1].forEach(t => mesh(new THREE.BoxGeometry(0.07, 0.22, 0.025), white, 0, 0.1, t * 0.12, fork));
      mesh(new THREE.BoxGeometry(0.1, 0.03, 0.27), white, 0, 0.22, 0, fork);
    });
    // side cover panel with ventilation slots and warning stripe
    const cover = mesh(new RoundedBoxGeometry(1.4, 0.34, 0.06, 2, 0.02), white, 0, fy - 0.22, z + s * 0.08, g);
    const lab = mesh(new THREE.PlaneGeometry(1.1, 0.13), new THREE.MeshStandardMaterial({ map: warningLabel(), roughness: 0.6 }), 0, fy - 0.22, z + s * 0.112, g);
    lab.rotation.y = s > 0 ? 0 : Math.PI;
    for (let k = 0; k < 6; k++) mesh(new THREE.BoxGeometry(0.1, 0.012, 0.01), black, -0.55 + k * 0.05, fy - 0.1, z + s * 0.112, g);
  });
  // cross beams (bridge over the six crop rows, high enough for the crop)
  [-1.25, -0.2, 1.1].forEach(x => box([x, fy, -R.wheelZ], [x, fy, R.wheelZ], 0.1, 0.12, white, g));
  box([-1.3, fy + 0.02, 0], [1.3, fy + 0.02, 0], 0.08, 0.08, alu, g);             // central spine
  /* ---- wheels ---- */
  const tyre = tyreGeometry(R.wheelR, 0.2);
  const rim = new THREE.CylinderGeometry(0.2, 0.2, 0.16, 24); rim.rotateX(Math.PI / 2);
  const hubG = new THREE.CylinderGeometry(0.11, 0.11, 0.22, 20); hubG.rotateX(Math.PI / 2);
  const rimMat = M.paintedSteel(0x3b3f44);
  g.wheels = [];
  [-1, 1].forEach(s => [-R.wheelX, R.wheelX].forEach(x => {
    const w = new THREE.Group(); w.position.set(x, R.wheelR, s * R.wheelZ); g.add(w);
    mesh(tyre, rubber, 0, 0, 0, w); mesh(rim, rimMat, 0, 0, 0, w); mesh(hubG, alu, 0, 0, 0, w);
    for (let b = 0; b < 6; b++) { const a = b / 6 * Math.PI * 2; mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.23, 8).rotateX(Math.PI / 2), steel, Math.cos(a) * 0.075, Math.sin(a) * 0.075, 0, w); }
    g.wheels.push(w);
  }));
  /* ---- solar roof: four framed panels on stand-offs ---- */
  const solarMat = new THREE.MeshPhysicalMaterial({ map: solarTexture(), roughness: 0.24, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.5 });
  const pw = 1.3, pd = 1.58; g.panels = [];
  [-0.66, 0.66].forEach(x => [-0.8, 0.8].forEach(z => {
    const p = new THREE.Group(); p.position.set(x, R.roofY, z); g.add(p);
    const glass = mesh(new THREE.BoxGeometry(pw, 0.012, pd), [alu, alu, solarMat, black, alu, alu], 0, 0.02, 0, p);
    [[0, pd / 2], [0, -pd / 2]].forEach(([a, b]) => mesh(new THREE.BoxGeometry(pw + 0.03, 0.035, 0.03), alu, a, 0.012, b, p));
    [[pw / 2, 0], [-pw / 2, 0]].forEach(([a, b]) => mesh(new THREE.BoxGeometry(0.03, 0.035, pd), alu, a, 0.012, b, p));
    g.panels.push(glass);
  }));
  [-1.2, 0, 1.2].forEach(x => [-1.45, 0, 1.45].forEach(z => tube([x, fy + 0.07, z], [x, R.roofY, z], 0.018, alu, g)));
  /* ---- electronics, battery, GNSS, beacon, e-stops, lidar ---- */
  const cab = mesh(new RoundedBoxGeometry(0.62, 0.3, 0.46, 3, 0.03), M.paintedSteel(0xc9ccc9), -0.6, fy + 0.2, 0, g);
  mesh(new THREE.BoxGeometry(0.3, 0.03, 0.2), black, -0.6, fy + 0.36, 0, g);                              // heat sink
  for (let k = 0; k < 4; k++) mesh(new THREE.SphereGeometry(0.012, 10, 8), M.emissive(k === 0 ? 0x33ff77 : k === 1 ? 0x33ff77 : 0x3fa9ff, 2.5), -0.29, fy + 0.26 - k * 0.04, 0.12, g);
  [-1, 1].forEach(s => mesh(new RoundedBoxGeometry(0.9, 0.22, 0.3, 2, 0.02), M.paintedSteel(0x2d3136), 0.1, fy + 0.13, s * 0.62, g));  // battery packs
  tube([-1.1, fy + 0.05, 0], [-1.1, 1.95, 0], 0.016, alu, g);
  mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.05, 24), M.plasticWhite(), -1.1, 1.97, 0, g);          // RTK-GNSS antenna
  mesh(new THREE.SphereGeometry(0.075, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.plasticWhite(), -1.1, 1.995, 0, g);
  tube([-1.1, 1.6, 0.06], [-1.1, 1.9, 0.14], 0.008, black, g);                                            // LTE antenna
  const beaconBase = mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.03, 20), black, 1.2, R.roofY + 0.06, -1.45, g);
  const beaconLamp = mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.1, 20), M.emissive(0xff9a1a, 0.4), 1.2, R.roofY + 0.13, -1.45, g);
  beaconLamp.material.transparent = true; beaconLamp.material.opacity = 0.92; g.beacon = beaconLamp;
  [[1.32, 1], [1.32, -1], [-1.32, 1], [-1.32, -1]].forEach(([x, s]) => {
    mesh(new RoundedBoxGeometry(0.1, 0.1, 0.07, 2, 0.01), yellow, x, fy + 0.04, s * (R.wheelZ + 0.14), g);
    mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.03, 20).rotateX(Math.PI / 2), red, x, fy + 0.05, s * (R.wheelZ + 0.19), g);
  });
  mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 24), black, 1.32, fy + 0.12, 0, g);                  // 2D safety lidar
  mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.025, 24), new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.05, clearcoat: 1 }), 1.32, fy + 0.12, 0, g);
  // front safety bumper (compliant foam bar on two arms)
  [-0.9, 0.9].forEach(z => box([1.25, fy - 0.3, z], [1.72, 0.42, z], 0.05, 0.05, white, g));
  mesh(new RoundedBoxGeometry(0.08, 0.1, 2.2, 3, 0.04), M.plastic(0x1d1f22, 0.8), 1.74, 0.4, 0, g);
  /* ---- camera bar with three camera modules (downward, LED ring flash) ---- */
  const camBar = box([R.camX, R.camY + 0.12, -1.45], [R.camX, R.camY + 0.12, 1.45], 0.06, 0.06, alu, g);
  [-1.45, 1.45].forEach(z => box([R.camX, R.camY + 0.12, z], [R.camX, fy, z], 0.05, 0.05, alu, g));
  g.cameras = [];
  R.camZ.forEach(z => {
    const c = new THREE.Group(); c.position.set(R.camX, R.camY, z); g.add(c);
    mesh(new RoundedBoxGeometry(0.16, 0.11, 0.13, 2, 0.015), M.anodised(), 0, 0.06, 0, c);
    mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.05, 24), black, 0, -0.01, 0, c);
    mesh(new THREE.CircleGeometry(0.024, 24).rotateX(Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x0a1030, roughness: 0.05, metalness: 0.3, clearcoat: 1, iridescence: 0.8 }), 0, -0.036, 0, c);
    const ring = mesh(new THREE.TorusGeometry(0.05, 0.009, 10, 32).rotateX(Math.PI / 2), M.emissive(0xeaf6ff, 1.2), 0, -0.012, 0, c); c.ring = ring;
    tube([0, 0.11, -0.05], [0, 0.18, -0.05], 0.006, black, c);
    g.cameras.push(c);
  });
  /* ---- spray tank, pump and hoses ---- */
  const tankMat = new THREE.MeshPhysicalMaterial({ color: 0xf1f3ee, roughness: 0.45, transmission: 0.25, thickness: 0.05, transparent: true, opacity: 0.94 });
  mesh(new RoundedBoxGeometry(0.46, 0.4, 0.78, 4, 0.06), tankMat, -1.0, fy - 0.2, 0, g);
  mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 20), M.plastic(0x2f6fd6, 0.4), -1.0, fy + 0.02, 0.18, g);
  const liquid = mesh(new RoundedBoxGeometry(0.43, 0.22, 0.75, 3, 0.05), M.waterCheap(0x7fb3d9, 0.55), -1.0, fy - 0.3, 0, g); g.liquid = liquid;
  mesh(new RoundedBoxGeometry(0.2, 0.14, 0.16, 2, 0.02), M.paintedSteel(0x2a2e33), -0.55, fy - 0.3, -0.3, g);   // pump
  /* ---- spray boom: stainless manifold, valves and nozzles (rebuilt with the cell size) ---- */
  const boom = new THREE.Group(); g.add(boom); g.boom = boom;
  box([R.nozzleX, R.nozzleY + 0.1, -1.55], [R.nozzleX, R.nozzleY + 0.1, 1.55], 0.045, 0.045, alu, g);           // boom carrier
  [-1.2, 0, 1.2].forEach(z => box([R.nozzleX, R.nozzleY + 0.12, z], [R.nozzleX - 0.3, fy - 0.42, z], 0.035, 0.035, alu, g));
  tube([R.nozzleX - 0.02, R.nozzleY + 0.05, -1.52], [R.nozzleX - 0.02, R.nozzleY + 0.05, 1.52], 0.012, steel, g); // manifold
  const hoseMat = M.plastic(0x2a2a2a, 0.7);
  const hoseCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.55, fy - 0.32, -0.3), new THREE.Vector3(-0.2, fy - 0.45, -0.25), new THREE.Vector3(0.2, R.nozzleY + 0.2, -0.1), new THREE.Vector3(R.nozzleX - 0.02, R.nozzleY + 0.06, 0)]);
  mesh(new THREE.TubeGeometry(hoseCurve, 30, 0.011, 8), hoseMat, 0, 0, 0, g);
  const valveG = new THREE.BoxGeometry(0.018, 0.034, 0.022), bodyG = new THREE.CylinderGeometry(0.006, 0.007, 0.022, 10), tipG = new THREE.CylinderGeometry(0.0065, 0.004, 0.01, 10);
  const valveMat = black, bodyMat = M.plastic(0x7a7f85, 0.4), tipMat = M.plastic(0xf2c300, 0.4);
  g.setNozzles = (cell, half = 1.5) => {
    boom.children.forEach(o => o.dispose && o.dispose()); boom.clear();
    const n = Math.max(1, Math.round(2 * half / cell)); const zs = [];
    for (let i = 0; i < n; i++) zs.push(-half + (i + 0.5) * 2 * half / n);
    const mk = (geo, mat, dy) => { const im = new THREE.InstancedMesh(geo, mat, n); zs.forEach((z, i) => im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(R.nozzleX - 0.02, R.nozzleY + dy, z))); im.castShadow = true; boom.add(im); };
    mk(valveG, valveMat, 0.075); mk(bodyG, bodyMat, 0.03); mk(tipG, tipMat, 0.016);
    g.nozzleZ = zs; g.nozzleTipY = R.nozzleY + 0.01;
  };
  /* ---- inter-row hoes on a parallelogram linkage (raised: spray-only mode) ---- */
  const hoeBar = -0.35; box([hoeBar, 0.78, -1.45], [hoeBar, 0.78, 1.45], 0.07, 0.07, M.paintedSteel(0x2d3136), g);
  for (let k = 0; k < 5; k++) {
    const z = -1.0 + k * 0.5;
    const h = new THREE.Group(); h.position.set(hoeBar, 0.78, z); g.add(h);
    [0.0, 0.1].forEach(dy => box([0, -dy, 0], [-0.32, -0.28 - dy, 0], 0.025, 0.025, M.paintedSteel(0x2d3136), h));
    box([-0.32, -0.26, 0], [-0.32, -0.52, 0], 0.03, 0.03, steel, h);
    const share = new THREE.Shape(); share.moveTo(0.08, 0); share.lineTo(-0.06, 0.09); share.lineTo(-0.03, 0); share.lineTo(-0.06, -0.09); share.lineTo(0.08, 0);
    const sm = mesh(new THREE.ExtrudeGeometry(share, { depth: 0.006, bevelEnabled: false }), steel, -0.32, -0.53, 0, h); sm.rotation.x = Math.PI / 2;
  }
  /* ---- field-of-view frustums (layer 1: visible in the main view, hidden from the robot's own cameras) ---- */
  const fr = new THREE.Group(); g.add(fr); g.frustums = fr;
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.9 });
  const faceMat = new THREE.MeshBasicMaterial({ color: 0x4fd0ff, transparent: true, opacity: 0.04, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const footMat = new THREE.MeshBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending });
  R.camZ.forEach(z => {
    const apex = new THREE.Vector3(R.camX, R.camY - 0.04, z), y0 = 0.045;
    const c = [[R.camX - R.footX / 2, y0, z - R.footZ / 2], [R.camX + R.footX / 2, y0, z - R.footZ / 2], [R.camX + R.footX / 2, y0, z + R.footZ / 2], [R.camX - R.footX / 2, y0, z + R.footZ / 2]].map(a => new THREE.Vector3(...a));
    const pts = []; c.forEach(v => pts.push(apex, v)); for (let i = 0; i < 4; i++) pts.push(c[i], c[(i + 1) % 4]);
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), edgeMat); lines.layers.set(1); fr.add(lines);
    const fg = new THREE.BufferGeometry(); const P = []; for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; P.push(apex.x, apex.y, apex.z, a.x, a.y, a.z, b.x, b.y, b.z); }
    fg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); const faces = new THREE.Mesh(fg, faceMat); faces.layers.set(1); fr.add(faces);
    const foot = new THREE.Mesh(new THREE.PlaneGeometry(R.footX, R.footZ).rotateX(-Math.PI / 2), footMat); foot.position.set(R.camX, y0 + 0.004, z); foot.layers.set(1); fr.add(foot);
  });
  g.traverse(o => { if (o.isMesh && o.layers.mask === 1) { o.castShadow = o.castShadow !== false; } });
  fr.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
  return g;
}
