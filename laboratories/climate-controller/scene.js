/* Climate controller tuning — 3D walk-in growth chamber (visual only; driven by the model in main.js).
   Interior 3.0 m × 2.4 m × 2.5 m of 100-mm insulated sandwich panels, front wall cut away (section view). */
import { THREE, M, makeRack, lettuceGeometry, leafMaterial, makeTank, Mist, FlowAlong, canvasTexture, RoundedBoxGeometry, surfaceMaterial, makePipe, ensureRectAreaLights, rng } from '/assets/js/lab3d.js';

export const ROOM = { L: 3.0, B: 2.4, H: 2.5, T: 0.1 };
const X0 = -ROOM.L / 2, X1 = ROOM.L / 2, Z0 = -ROOM.B / 2, Z1 = ROOM.B / 2;
const DOOR = { z0: -0.03, z1: 0.85, h: 2.0 };

/* ------------------------------------------------------------------ textures */
function panelTexture(repeat) {
  return canvasTexture(512, 1066, (ctx, w, h) => {
    ctx.fillStyle = '#eceeed'; ctx.fillRect(0, 0, w, h);
    const r = rng(5);
    for (let i = 0; i < 16000; i++) { const g = 222 + r() * 30; ctx.fillStyle = `rgba(${g},${g + 2},${g + 1},0.28)`; ctx.fillRect(r() * w, r() * h, 1.6, 1.6); }
    for (let i = 0; i < 70; i++) { ctx.fillStyle = `rgba(210,214,212,${0.05 + r() * 0.05})`; ctx.fillRect(0, r() * h, w, 1 + r() * 2); } // faint roll-forming ribs
    ctx.fillStyle = '#8f9693'; ctx.fillRect(0, 0, 3, h);            // panel joint (groove)
    ctx.fillStyle = '#ffffff'; ctx.fillRect(3, 0, 2, h);
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(w - 3, 0, 3, h);
    [0.45, 1.25, 2.05].forEach(yy => {                               // cam-lock cover caps
      const cy = h * (1 - yy / 2.5), cx = 16;
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.arc(cx + 1.5, cy + 1.5, 9, 0, Math.PI * 2); ctx.fill();
      const g = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, 9); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#d9dcda');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 8.5, 0, Math.PI * 2); ctx.fill();
    });
  }, { key: 'cc-panel', repeat });
}
function finTexture() {
  return canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#9ea4a6'; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 3) { ctx.fillStyle = x % 6 ? '#c9ced0' : '#6f7678'; ctx.fillRect(x, 0, 1.2, h); }
  }, { key: 'cc-fins', repeat: [6, 1] });
}
function drainTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#b9bec0'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1c1f20'; for (let i = 0; i < 7; i++) ctx.fillRect(14, 12 + i * 15, w - 28, 7);
    ctx.strokeStyle = '#e8ecee'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, w - 4, h - 4);
  }, { key: 'cc-drain' });
}

/* ------------------------------------------------------------------ geometry helpers */
function polyGeo(pts) { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return new THREE.ShapeGeometry(s); }
const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
/** Rectangle with a door notch at the bottom between u0 and u1 (height hd). */
const notched = (w, h, u0, u1, hd) => [[0, 0], [u0, 0], [u0, hd], [u1, hd], [u1, 0], [w, 0], [w, h], [0, h]];
function box(w, h, d, mat, x, y, z, parent) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; if (parent) parent.add(m); return m; }
function cyl(r0, r1, h, mat, seg = 20) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat); m.castShadow = true; m.receiveShadow = true; return m; }
function rod(a, b, r, mat) { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b); const m = cyl(r, r, A.distanceTo(B), mat, 8); m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); return m; }
class Helix extends THREE.Curve {
  constructor(len, r, turns) { super(); this.len = len; this.r = r; this.turns = turns; }
  getPoint(t, target = new THREE.Vector3()) { const a = t * this.turns * Math.PI * 2; return target.set(-this.len / 2 + t * this.len, this.r * Math.cos(a), this.r * Math.sin(a)); }
}

/* ------------------------------------------------------------------ build */
export function buildChamber(stage) {
  const { scene } = stage; ensureRectAreaLights();
  const H = {};                                        // handles returned to main.js
  const panelMat = rep => new THREE.MeshStandardMaterial({ map: panelTexture(rep), bumpMap: panelTexture(rep), bumpScale: 1.2, roughness: 0.48, metalness: 0.12, color: 0xffffff });
  const skinOut = new THREE.MeshStandardMaterial({ color: 0xdfe3e1, roughness: 0.55, metalness: 0.15 });
  const foam = new THREE.MeshStandardMaterial({ color: 0xe6cf86, roughness: 0.95 });
  const alu = M.aluminium(), steel = M.steel(), white = M.paintedSteel(0xf1f2f0), black = M.rubber();

  // ---------- ambient & service lighting
  scene.add(new THREE.HemisphereLight(0xe6eef5, 0x2c302e, 0.35));
  const svc = [];
  [[-0.65, 0.35], [0.75, 0.35]].forEach(([x, z]) => {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 0.6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e6, emissiveIntensity: 1.25 }));
    panel.position.set(x, ROOM.H - 0.012, z); scene.add(panel);
    const rl = new THREE.RectAreaLight(0xfff4e6, 2.4, 0.6, 0.6); rl.position.set(x, ROOM.H - 0.03, z); rl.lookAt(x, 0, z); scene.add(rl); svc.push(rl);
  });
  const key = new THREE.SpotLight(0xfff2e2, 9, 9, 1.05, 0.85, 1.6);
  key.position.set(0.3, ROOM.H - 0.05, 0.9); key.target.position.set(-0.1, 0, -0.4); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02; key.shadow.radius = 5;
  scene.add(key, key.target);

  // ---------- floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.L, ROOM.B), surfaceMaterial('epoxy', [3, 2.4], { color: 0xb3bcb8 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const drain = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshStandardMaterial({ map: drainTexture(), metalness: 0.85, roughness: 0.35 }));
  drain.rotation.x = -Math.PI / 2; drain.position.set(0.25, 0.002, 0.55); drain.receiveShadow = true; scene.add(drain);
  // outside floor (lab) in front of the section and corridor floor
  const labFloor = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), surfaceMaterial('concrete', [6, 4], { color: 0x7d807d }));
  labFloor.rotation.x = -Math.PI / 2; labFloor.position.set(0, -0.012, 4.8); labFloor.receiveShadow = true; scene.add(labFloor);
  const corrFloor = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 8.0), surfaceMaterial('concrete', [2, 8], { color: 0x8a8d8a }));
  corrFloor.rotation.x = -Math.PI / 2; corrFloor.position.set(X0 - ROOM.T - 1.0, -0.002, -0.8); corrFloor.receiveShadow = true; scene.add(corrFloor);

  // ---------- walls: inner skins (facing in), outer skins (facing out), section edges at the cut
  const back = new THREE.Mesh(polyGeo(rect(ROOM.L, ROOM.H)).translate(-ROOM.L / 2, 0, 0), panelMat([1 / 1.2, 1 / 2.5]));
  back.position.z = Z0; back.receiveShadow = true; scene.add(back);
  const backO = new THREE.Mesh(polyGeo(rect(ROOM.L + 2 * ROOM.T, ROOM.H + ROOM.T)).translate(-ROOM.L / 2 - ROOM.T, 0, 0), skinOut);
  backO.rotation.y = Math.PI; backO.position.z = Z0 - ROOM.T; scene.add(backO);
  // left wall (door) — inner: local x → world −z, shape u = z_local + 1.2
  const uL0 = ROOM.B / 2 - DOOR.z1, uL1 = ROOM.B / 2 - DOOR.z0;
  const left = new THREE.Mesh(polyGeo(notched(ROOM.B, ROOM.H, uL0, uL1, DOOR.h)).translate(-ROOM.B / 2, 0, 0), panelMat([1 / 1.2, 1 / 2.5]));
  left.rotation.y = Math.PI / 2; left.position.x = X0; left.receiveShadow = true; scene.add(left);
  const uO0 = ROOM.B / 2 + DOOR.z0, uO1 = ROOM.B / 2 + DOOR.z1;
  const leftO = new THREE.Mesh(polyGeo(notched(ROOM.B, ROOM.H + ROOM.T, uO0, uO1, DOOR.h)).translate(-ROOM.B / 2, 0, 0), skinOut);
  leftO.rotation.y = -Math.PI / 2; leftO.position.x = X0 - ROOM.T; scene.add(leftO);
  const right = new THREE.Mesh(polyGeo(rect(ROOM.B, ROOM.H)).translate(-ROOM.B / 2, 0, 0), panelMat([1 / 1.2, 1 / 2.5]));
  right.rotation.y = -Math.PI / 2; right.position.x = X1; right.receiveShadow = true; scene.add(right);
  const rightO = new THREE.Mesh(polyGeo(rect(ROOM.B, ROOM.H + ROOM.T)).translate(-ROOM.B / 2, 0, 0), skinOut);
  rightO.rotation.y = Math.PI / 2; rightO.position.x = X1 + ROOM.T; scene.add(rightO);
  const ceil = new THREE.Mesh(polyGeo(rect(ROOM.L, ROOM.B)).translate(-ROOM.L / 2, -ROOM.B / 2, 0), panelMat([1 / 1.2, 1 / 2.5]));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = ROOM.H; scene.add(ceil);
  const ceilO = new THREE.Mesh(polyGeo(rect(ROOM.L + 2 * ROOM.T, ROOM.B + ROOM.T)).translate(-ROOM.L / 2 - ROOM.T, -ROOM.B / 2 - ROOM.T, 0), skinOut);
  ceilO.rotation.x = -Math.PI / 2; ceilO.position.y = ROOM.H + ROOM.T; scene.add(ceilO);
  // section edges (100-mm panels: steel skins + PUR core) along the cut at z = Z1
  const sec = (w, h, x, y) => { const g = new THREE.Group(); g.add(box(w, h, 0.012, foam, 0, 0, 0)); g.position.set(x, y, Z1 + 0.006); scene.add(g); return g; };
  sec(ROOM.T, ROOM.H + ROOM.T, X0 - ROOM.T / 2, (ROOM.H + ROOM.T) / 2);
  sec(ROOM.T, ROOM.H + ROOM.T, X1 + ROOM.T / 2, (ROOM.H + ROOM.T) / 2);
  sec(ROOM.L + 2 * ROOM.T, ROOM.T, 0, ROOM.H + ROOM.T / 2);
  const skinStrip = (w, h, x, y) => box(w, h, 0.014, white, x, y, Z1 + 0.007, scene);
  skinStrip(0.004, ROOM.H + ROOM.T, X0 - 0.002, (ROOM.H + ROOM.T) / 2); skinStrip(0.004, ROOM.H + ROOM.T, X0 - ROOM.T + 0.002, (ROOM.H + ROOM.T) / 2);
  skinStrip(0.004, ROOM.H + ROOM.T, X1 + 0.002, (ROOM.H + ROOM.T) / 2); skinStrip(0.004, ROOM.H + ROOM.T, X1 + ROOM.T - 0.002, (ROOM.H + ROOM.T) / 2);
  skinStrip(ROOM.L + 2 * ROOM.T, 0.004, 0, ROOM.H + 0.002); skinStrip(ROOM.L + 2 * ROOM.T, 0.004, 0, ROOM.H + ROOM.T - 0.002);
  // hygienic floor cove (aluminium angle) along the inner walls
  [[0, 0.02, Z0 + 0.01, ROOM.L, 0.04, 0.02], [X0 + 0.01, 0.02, -0.66, 0.02, 0.04, 1.1], [X1 - 0.01, 0.02, 0, 0.02, 0.04, ROOM.B]].forEach(([x, y, z, w, h, d]) => box(w, h, d, alu, x, y, z, scene));

  // ---------- door frame, leaf with window, hardware
  const frameMat = alu;
  box(ROOM.T + 0.02, 0.05, 0.05, frameMat, X0 - ROOM.T / 2, DOOR.h + 0.025, (DOOR.z0 + DOOR.z1) / 2, scene).scale.z = (DOOR.z1 - DOOR.z0 + 0.1) / 0.05;
  [DOOR.z0 - 0.025, DOOR.z1 + 0.025].forEach(z => box(ROOM.T + 0.02, DOOR.h + 0.05, 0.05, frameMat, X0 - ROOM.T / 2, (DOOR.h + 0.05) / 2, z, scene));
  const pivot = new THREE.Group(); pivot.position.set(X0, 0.012, DOOR.z1); scene.add(pivot);
  const dw = DOOR.z1 - DOOR.z0 - 0.01, dh = DOOR.h - 0.02, dt = 0.08;
  const win = { u0: dw / 2 - 0.17, u1: dw / 2 + 0.17, v0: 1.26, v1: 1.72 };
  const ls = new THREE.Shape(); ls.moveTo(0, 0); ls.lineTo(dw, 0); ls.lineTo(dw, dh); ls.lineTo(0, dh); ls.closePath();
  const hp = new THREE.Path(); hp.moveTo(win.u0, win.v0); hp.lineTo(win.u1, win.v0); hp.lineTo(win.u1, win.v1); hp.lineTo(win.u0, win.v1); hp.closePath(); ls.holes.push(hp);
  const leafGeo = new THREE.ExtrudeGeometry(ls, { depth: dt, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 4 });
  leafGeo.rotateY(Math.PI / 2); leafGeo.translate(-dt, 0, 0);
  const leaf = new THREE.Mesh(leafGeo, M.paintedSteel(0xf3f4f2)); leaf.castShadow = true; leaf.receiveShadow = true; pivot.add(leaf);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(win.u1 - win.u0, win.v1 - win.v0), M.glassCheap(0.2));
  glass.rotation.y = Math.PI / 2; glass.position.set(-dt / 2, (win.v0 + win.v1) / 2, -(win.u0 + win.u1) / 2); pivot.add(glass);
  const gasketRing = (u0, u1, v0, v1, th) => { const s = new THREE.Shape(); s.moveTo(u0 - th, v0 - th); s.lineTo(u1 + th, v0 - th); s.lineTo(u1 + th, v1 + th); s.lineTo(u0 - th, v1 + th); s.closePath(); const p = new THREE.Path(); p.moveTo(u0, v0); p.lineTo(u1, v0); p.lineTo(u1, v1); p.lineTo(u0, v1); p.closePath(); s.holes.push(p); const g = new THREE.ExtrudeGeometry(s, { depth: dt + 0.012, bevelEnabled: false }); g.rotateY(Math.PI / 2); g.translate(-dt - 0.006, 0, 0); return new THREE.Mesh(g, black); };
  pivot.add(gasketRing(win.u0, win.u1, win.v0, win.v1, 0.014));
  // inner-face hardware (inner face is at local x = 0)
  const kick = box(0.004, 0.3, dw - 0.04, steel, 0.002, 0.17, -dw / 2, pivot);
  const rose = cyl(0.028, 0.028, 0.012, M.steel(), 24); rose.rotation.z = Math.PI / 2; rose.position.set(0.006, 1.05, -dw + 0.09); pivot.add(rose);
  const lever = box(0.018, 0.018, 0.13, M.steel(), 0.03, 1.05, -dw + 0.14, pivot);
  const release = cyl(0.03, 0.03, 0.03, new THREE.MeshStandardMaterial({ color: 0xffd21f, emissive: 0xffc400, emissiveIntensity: 0.35, roughness: 0.4 }), 24);
  release.rotation.z = Math.PI / 2; release.position.set(0.02, 1.28, -dw + 0.09); pivot.add(release);
  [0.28, 1.7].forEach(y => { const h = cyl(0.011, 0.011, 0.12, M.steel(), 16); h.position.set(-dt - 0.01, y, -0.01); pivot.add(h); });
  [[0.006, dh / 2, -0.006, 0.012, dh, 0.012], [0.006, dh / 2, -dw + 0.006, 0.012, dh, 0.012], [0.006, dh - 0.006, -dw / 2, 0.012, 0.012, dw]].forEach(([x, y, z, a, b, c]) => box(a, b, c, black, x, y, z, pivot));
  H.door = { pivot, angle: 0, target: 0, leaf };
  void kick; void lever;

  // ---------- corridor outside the door (visible through the window)
  const corrWall = new THREE.Mesh(new THREE.PlaneGeometry(8.0, 2.9), new THREE.MeshStandardMaterial({ color: 0xdfe4dc, roughness: 0.8 }));
  corrWall.rotation.y = Math.PI / 2; corrWall.position.set(X0 - ROOM.T - 2.0, 1.45, -0.8); corrWall.receiveShadow = true; scene.add(corrWall);
  const skirting = box(0.02, 0.1, 8.0, M.plasticGrey(), X0 - ROOM.T - 1.99, 0.05, -0.8, scene); void skirting;
  const corrLamp = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 1.4), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4fbff, emissiveIntensity: 1.6 }));
  corrLamp.position.set(X0 - ROOM.T - 1.0, 2.85, -1.2); scene.add(corrLamp);
  const corrRL = new THREE.RectAreaLight(0xf4fbff, 3.5, 1.4, 0.4); corrRL.position.set(X0 - ROOM.T - 1.0, 2.8, -1.2); corrRL.lookAt(X0 - ROOM.T - 1.0, 0, -1.2); scene.add(corrRL);
  const corrPL = new THREE.PointLight(0xf1f6ff, 7, 6, 1.6); corrPL.position.set(X0 - ROOM.T - 0.9, 2.3, -1.4); scene.add(corrPL);
  // corridor thermostat display on the corridor wall
  const corrCv = document.createElement('canvas'); corrCv.width = 256; corrCv.height = 128; const corrTex = new THREE.CanvasTexture(corrCv); corrTex.colorSpace = THREE.SRGBColorSpace;
  const corrDisp = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), new THREE.MeshBasicMaterial({ map: corrTex, toneMapped: false }));
  corrDisp.rotation.y = Math.PI / 2; corrDisp.position.set(X0 - ROOM.T - 1.985, 1.45, -2.35); scene.add(corrDisp);
  box(0.02, 0.14, 0.24, M.plasticWhite(), X0 - ROOM.T - 1.995, 1.45, -2.35, scene);
  H.corrDisplay = (T) => { const c = corrCv.getContext('2d'); c.fillStyle = '#0c1a2a'; c.fillRect(0, 0, 256, 128); c.fillStyle = '#9fd4ff'; c.font = '600 22px Inter, sans-serif'; c.fillText('CORRIDOR', 18, 34); c.font = '700 58px "JetBrains Mono", monospace'; c.fillText(T.toFixed(1) + '°', 16, 104); corrTex.needsUpdate = true; };

  // ---------- rack with lettuce trays and LED bars
  const rack = makeRack({ levels: 3, width: 1.9, depth: 0.55, levelHeight: 0.58, baseHeight: 0.32, lights: true, ledColor: 'full' });
  rack.position.set(-0.2, 0, -0.85); scene.add(rack);
  const lgeos = [0, 1, 2].map(s => lettuceGeometry({ radius: 0.115, growth: 0.8, leaves: 16, variety: s === 2 ? 'green' : 'butterhead', seed: 21 + s * 5 }));
  const lmat = leafMaterial({ gloss: 0.45 });
  const buckets = [[], [], []];
  rack.shelves.forEach((sh, l) => { for (let i = 0; i < 7; i++) for (let j = 0; j < 2; j++) buckets[(i + j + l) % 3].push([-0.2 - 0.78 + i * 0.26, sh.y + 0.005, -0.85 + (j ? 0.13 : -0.13), i * 7 + j * 3 + l]); });
  buckets.forEach((b, k) => {
    const im = new THREE.InstancedMesh(lgeos[k], lmat, b.length); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    b.forEach(([x, y, z, r], i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * 0.61); const sc = 0.88 + (r % 5) * 0.05; s.set(sc, sc, sc); m4.compose(new THREE.Vector3(x, y, z), q, s); im.setMatrixAt(i, m4); });
    im.castShadow = true; im.receiveShadow = true; scene.add(im);
  });
  const growLights = rack.shelves.map(sh => { const rl = new THREE.RectAreaLight(0xffeaf2, 2.2, 1.8, 0.45); rl.position.set(-0.2, sh.y + 0.5, -0.85); rl.lookAt(-0.2, 0, -0.85); scene.add(rl); return rl; });
  // nutrient tank under the bottom shelf + feed line
  const tank = makeTank({ w: 0.7, h: 0.2, d: 0.38, material: 'plastic', level: 0.75, color: 0x30353a }); tank.position.set(-0.55, 0.005, -0.85); scene.add(tank);
  const feed = makePipe([[-0.35, 0.18, -0.85], [-0.3, 0.3, -0.72], [-0.3, 0.44, -0.62]], { radius: 0.007, material: M.plasticBlack() }); scene.add(feed);
  H.rack = rack; H.growLights = growLights;

  // ---------- wall-mounted electric heater with open coils (back wall, right of the rack)
  const heater = new THREE.Group(); heater.position.set(1.12, 0.64, Z0); scene.add(heater);
  const hsg = M.paintedSteel(0xd4d7d5);
  box(0.46, 0.36, 0.012, hsg, 0, 0, 0.006, heater);                              // back plate
  box(0.46, 0.014, 0.17, hsg, 0, 0.173, 0.085, heater); box(0.46, 0.014, 0.17, hsg, 0, -0.173, 0.085, heater);
  box(0.014, 0.36, 0.17, hsg, -0.223, 0, 0.085, heater); box(0.014, 0.36, 0.17, hsg, 0.223, 0, 0.085, heater);
  const refl = box(0.43, 0.33, 0.004, new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 1, roughness: 0.22 }), 0, 0, 0.015, heater); void refl;
  const coilMat = new THREE.MeshStandardMaterial({ color: 0x4d3f38, metalness: 0.6, roughness: 0.45, emissive: 0xff4a10, emissiveIntensity: 0 });
  const coilGeo = new THREE.TubeGeometry(new Helix(0.38, 0.012, 28), 28 * 10, 0.0032, 6, false);
  [-0.09, 0, 0.09].forEach(y => { const c = new THREE.Mesh(coilGeo, coilMat); c.position.set(0, y, 0.075); heater.add(c); [-0.2, 0.2].forEach(x => { const ins = cyl(0.012, 0.012, 0.03, M.plasticWhite(), 12); ins.rotation.z = Math.PI / 2; ins.position.set(x, y, 0.075); heater.add(ins); }); });
  for (let i = 0; i < 9; i++) { const bar = cyl(0.0028, 0.0028, 0.44, M.steel(), 8); bar.rotation.z = Math.PI / 2; bar.position.set(0, -0.16 + i * 0.04, 0.165); heater.add(bar); }
  const tbox = box(0.09, 0.07, 0.07, hsg, 0.29, 0.13, 0.04, heater); void tbox;
  const conduit = makePipe([[1.41, 0.77, Z0 + 0.04], [1.41, 1.6, Z0 + 0.04], [1.41, ROOM.H - 0.02, Z0 + 0.04]], { radius: 0.012, material: M.plasticGrey() }); scene.add(conduit);
  const heatLight = new THREE.PointLight(0xff5a1f, 0, 1.8, 2); heatLight.position.set(1.12, 0.64, Z0 + 0.3); scene.add(heatLight);
  const warmCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(1.12, 0.84, Z0 + 0.12), new THREE.Vector3(1.1, 1.2, Z0 + 0.2), new THREE.Vector3(1.0, 1.7, Z0 + 0.35), new THREE.Vector3(0.8, 2.2, Z0 + 0.5)]);
  const warmFlow = new FlowAlong(warmCurve, { count: 46, speed: 0.35, size: 0.035, color: 0xff8a4a, jitter: 0.12, opacity: 0.0 }); scene.add(warmFlow.points);
  H.heater = { group: heater, coilMat, light: heatLight, flow: warmFlow };

  // ---------- evaporator (unit cooler) above the rack with two axial fans
  const evap = new THREE.Group(); evap.position.set(0.02, 2.3, Z0 + 0.235); scene.add(evap);
  const casing = new THREE.Mesh(new RoundedBoxGeometry(1.36, 0.3, 0.47, 3, 0.02), white); casing.castShadow = true; casing.receiveShadow = true; evap.add(casing);
  const fins = new THREE.MeshStandardMaterial({ map: finTexture(), metalness: 0.7, roughness: 0.4 });
  [-1, 1].forEach(s => { const f = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.26), fins); f.rotation.y = s * Math.PI / 2; f.position.set(s * 0.681, 0, 0); evap.add(f); });
  box(1.32, 0.018, 0.45, M.steel(), 0, -0.162, 0, evap);                               // drain pan
  const fans = [];
  [-0.34, 0.34].forEach(x => {
    const shroud = cyl(0.132, 0.132, 0.03, new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.8 }), 40); shroud.rotation.x = Math.PI / 2; shroud.position.set(x, 0, 0.227); evap.add(shroud);
    const fan = new THREE.Group(); fan.position.set(x, 0, 0.245); evap.add(fan);
    const hub = cyl(0.028, 0.028, 0.03, M.plasticGrey(), 20); hub.rotation.x = Math.PI / 2; fan.add(hub);
    const bladeShape = new THREE.Shape(); bladeShape.moveTo(0.02, -0.018); bladeShape.quadraticCurveTo(0.08, -0.05, 0.118, -0.02); bladeShape.quadraticCurveTo(0.12, 0.03, 0.02, 0.018); bladeShape.closePath();
    const bgeo = new THREE.ShapeGeometry(bladeShape, 6); const bmat = new THREE.MeshStandardMaterial({ color: 0x2c3033, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide });
    for (let k = 0; k < 5; k++) { const arm = new THREE.Group(); arm.rotation.z = k * Math.PI * 2 / 5; const b = new THREE.Mesh(bgeo, bmat); b.rotation.x = 0.4; arm.add(b); fan.add(arm); }
    const guard = new THREE.Group(); guard.position.set(x, 0, 0.262); evap.add(guard);
    [0.04, 0.08, 0.122].forEach(r => guard.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.0022, 6, 48), M.steel())));
    for (let k = 0; k < 8; k++) { const sp = cyl(0.0018, 0.0018, 0.124, M.steel(), 6); sp.rotation.z = k * Math.PI / 4; sp.position.set(Math.sin(-k * Math.PI / 4) * 0.062, Math.cos(k * Math.PI / 4) * 0.062, 0); guard.add(sp); }
    fans.push(fan);
  });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.05), new THREE.MeshStandardMaterial({ color: 0x9aa0a3, metalness: 0.8, roughness: 0.4 })); plate.position.set(0, -0.09, 0.2361); evap.add(plate);
  [-0.55, 0.55].forEach(x => { const rod = cyl(0.006, 0.006, 0.06, M.steel(), 8); rod.position.set(x, 0.18, 0); evap.add(rod); });
  const cu = makePipe([[0.7, 2.36, Z0 + 0.12], [0.8, 2.36, Z0 + 0.12], [0.84, 2.36, Z0 + 0.03], [0.84, 2.36, Z0 - 0.02]], { radius: 0.01, material: M.copper() }); scene.add(cu);
  const insul = makePipe([[0.7, 2.29, Z0 + 0.16], [0.82, 2.29, Z0 + 0.16], [0.88, 2.29, Z0 + 0.05], [0.88, 2.29, Z0 - 0.02]], { radius: 0.017, material: M.rubber() }); scene.add(insul);
  const condensate = makePipe([[-0.62, 2.13, Z0 + 0.2], [-0.72, 2.1, Z0 + 0.12], [-0.74, 2.05, Z0 + 0.03], [-0.74, 2.0, Z0 - 0.02]], { radius: 0.011, material: M.pvc() }); scene.add(condensate);
  const flows = [-0.34, 0.34].map(x => { const c = new THREE.CatmullRomCurve3([new THREE.Vector3(x + 0.02, 2.3, Z0 + 0.5), new THREE.Vector3(x + 0.04, 2.27, Z0 + 1.0), new THREE.Vector3(x + 0.08, 2.15, Z0 + 1.6), new THREE.Vector3(x + 0.12, 1.9, Z0 + 2.15)]); const f = new FlowAlong(c, { count: 55, speed: 0.9, size: 0.03, color: 0x9fd8ff, jitter: 0.09, opacity: 0 }); scene.add(f.points); return f; });
  H.evap = { group: evap, fans, flows };

  // ---------- ultrasonic humidifier with mist
  const hum = new THREE.Group(); hum.position.set(-1.2, 0, -0.28); scene.add(hum);
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.5, 0.26, 3, 0.035), M.plasticWhite()); body.position.y = 0.29; body.castShadow = true; body.receiveShadow = true; hum.add(body);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.plasticWhite()); cap.scale.set(1, 0.3, 0.86); cap.position.y = 0.54; hum.add(cap);
  const nozzle = cyl(0.03, 0.036, 0.07, M.plasticGrey(), 20); nozzle.position.set(0.04, 0.6, 0); nozzle.rotation.z = -0.35; hum.add(nozzle);
  const panelH = box(0.12, 0.07, 0.004, new THREE.MeshStandardMaterial({ color: 0x1b2330, roughness: 0.3 }), 0, 0.42, 0.131, hum); void panelH;
  const humLed = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8), new THREE.MeshStandardMaterial({ color: 0x0b1220, emissive: 0x3aa0ff, emissiveIntensity: 0 })); humLed.position.set(0.035, 0.42, 0.134); hum.add(humLed);
  [[-0.11, -0.09], [0.11, -0.09], [-0.11, 0.09], [0.11, 0.09]].forEach(([x, z]) => { const w = cyl(0.018, 0.018, 0.03, M.rubber(), 14); w.rotation.z = Math.PI / 2; w.position.set(x, 0.02, z); hum.add(w); });
  const hose = makePipe([[-1.2, 0.3, -0.41], [-1.35, 0.2, -0.45], [-1.49, 0.25, -0.45]], { radius: 0.006, material: M.pvc() }); scene.add(hose);
  const mist = new Mist({ nozzles: [{ pos: [-1.2 + 0.07, 0.64, -0.28], dir: [0.45, 1, 0.12] }], rate: 650, speed: 0.55, cone: 0.3, size: 0.085, life: 2.6, color: 0xd6e6f2, gravity: 0.04, drag: 1.0, max: 2000 });
  mist.mat.opacity = 0.5; mist.on = false; scene.add(mist.points);
  H.hum = { group: hum, mist, led: humLed };

  // ---------- temperature/RH sensor on a stand: aspirated radiation shield + backlit LCD
  const stand = new THREE.Group(); stand.position.set(0.62, 0, 0.18); scene.add(stand);
  for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3 + 0.3; stand.add(rod([0, 0.22, 0], [Math.cos(a) * 0.24, 0.006, Math.sin(a) * 0.24], 0.007, M.anodised())); }
  const pole = cyl(0.011, 0.011, 1.12, M.anodised(), 12); pole.position.y = 0.66; stand.add(pole);
  const housing = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.2, 0.085, 3, 0.012), M.plasticWhite()); housing.position.y = 1.3; housing.castShadow = true; stand.add(housing);
  for (let i = 0; i < 6; i++) [-1, 1].forEach(s => { const sl = box(0.004, 0.012, 0.07, M.plasticGrey(), s * 0.087, 1.235 + i * 0.024, 0, stand); sl.rotation.z = s * 0.4; });
  const shield = cyl(0.02, 0.02, 0.2, M.plasticWhite(), 20); shield.rotation.z = Math.PI / 2; shield.position.set(0.02, 1.17, 0); stand.add(shield);
  const fanCap = cyl(0.026, 0.026, 0.02, M.plasticGrey(), 20); fanCap.rotation.z = Math.PI / 2; fanCap.position.set(0.13, 1.17, 0); stand.add(fanCap);
  const dispCv = document.createElement('canvas'); dispCv.width = 320; dispCv.height = 176; const dispTex = new THREE.CanvasTexture(dispCv); dispTex.colorSpace = THREE.SRGBColorSpace;
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.135, 0.074), new THREE.MeshBasicMaterial({ map: dispTex, toneMapped: false })); disp.position.set(0, 1.325, 0.0434); stand.add(disp);
  const sLed = new THREE.Mesh(new THREE.SphereGeometry(0.005, 10, 8), new THREE.MeshStandardMaterial({ color: 0x0b1a10, emissive: 0x39ff88, emissiveIntensity: 1.2 })); sLed.position.set(0.07, 1.265, 0.043); stand.add(sLed);
  const cable = makePipe([[0.62, 1.2, 0.18], [0.62, 0.3, 0.19], [0.66, 0.02, 0.3], [1.3, 0.01, 0.4], [1.49, 0.05, 0.4]], { radius: 0.004, material: M.plasticBlack() }); scene.add(cable);
  H.sensor = { group: stand, draw: (T, rh, mode) => {
    const c = dispCv.getContext('2d'); const g = c.createLinearGradient(0, 0, 0, 176); g.addColorStop(0, '#0d2219'); g.addColorStop(1, '#07130e'); c.fillStyle = g; c.fillRect(0, 0, 320, 176);
    c.fillStyle = 'rgba(160,255,200,0.07)'; for (let y = 0; y < 176; y += 3) c.fillRect(0, y, 320, 1);
    c.fillStyle = '#a8ffd1'; c.font = '700 76px "JetBrains Mono", ui-monospace, monospace'; c.fillText(isFinite(T) ? T.toFixed(1) : '--.-', 14, 86);
    c.font = '600 30px Inter, sans-serif'; c.fillText('°C', 250, 60);
    c.fillStyle = '#7fe0ff'; c.font = '600 34px "JetBrains Mono", monospace'; c.fillText('RH ' + (isFinite(rh) ? rh.toFixed(0) : '--') + ' %', 16, 140);
    c.fillStyle = '#5f9c80'; c.font = '600 18px Inter, sans-serif'; c.fillText(mode || '', 200, 162);
    dispTex.needsUpdate = true;
  } };

  // ---------- electrical cabinet on the right wall
  const cab = new THREE.Group(); cab.position.set(X1, 1.45, 0.45); scene.add(cab);
  box(0.16, 0.5, 0.38, M.paintedSteel(0xc8cbc9), -0.08, 0, 0, cab); box(0.01, 0.46, 0.34, M.paintedSteel(0xd8dbd9), -0.165, 0, 0, cab);
  const knob = cyl(0.012, 0.012, 0.02, M.plasticBlack(), 12); knob.rotation.z = Math.PI / 2; knob.position.set(-0.175, 0, 0.13); cab.add(knob);
  const cond2 = makePipe([[X1 - 0.05, 1.7, 0.45], [X1 - 0.05, 2.1, 0.45], [X1 - 0.05, ROOM.H - 0.02, 0.45]], { radius: 0.013, material: M.plasticGrey() }); scene.add(cond2);

  // ---------- pickable parts
  H.parts = [
    { id: 'heater', obj: heater, cam: [[0.95, 0.95, 0.35], [1.12, 0.64, Z0]] },
    { id: 'evap', obj: evap, cam: [[0.25, 1.75, 0.75], [0.02, 2.28, Z0 + 0.2]] },
    { id: 'hum', obj: hum, cam: [[-0.35, 1.0, 0.75], [-1.2, 0.5, -0.3]] },
    { id: 'sensor', obj: stand, cam: [[0.72, 1.42, 0.95], [0.62, 1.28, 0.18]] },
    { id: 'door', obj: pivot, cam: [[0.55, 1.4, 1.75], [X0, 1.1, 0.4]] },
    { id: 'rack', obj: rack, cam: [[-0.1, 1.35, 1.45], [-0.2, 1.05, -0.85]] }
  ];

  // ---------- per-frame visual state
  let fanSpeed = 0.4;
  H.update = (dt, s) => {
    // s = { heatFrac, coilT, coolFrac, hum, door, lights }
    const glow = THREE.MathUtils.smoothstep(s.coilT, 430, 900);
    coilMat.emissiveIntensity = glow < 0.01 ? 0 : 0.15 + 5.5 * Math.pow(glow, 1.6);
    coilMat.emissive.setRGB(1, 0.18 + 0.32 * glow, 0.03 + 0.08 * glow * glow);
    heatLight.intensity = 1.8 * glow * glow;
    warmFlow.points.material.opacity = 0.35 * Math.min(1, s.heatFrac * 1.4); warmFlow.speed = 0.25 + 0.3 * s.heatFrac; warmFlow.update(dt);
    fanSpeed += (8 + 22 * s.coolFrac - fanSpeed) * Math.min(1, dt * 1.5);
    fans.forEach((f, i) => { f.rotation.z += (i ? -1 : 1) * fanSpeed * dt; });
    flows.forEach(f => { f.points.material.opacity = 0.5 * Math.min(1, s.coolFrac * 1.6); f.speed = 0.5 + 0.8 * s.coolFrac; f.update(dt); });
    mist.on = !!s.hum; mist.update(dt); humLed.material.emissiveIntensity = s.hum ? 2.5 : 0.15;
    H.door.target = s.door ? 1.25 : 0; H.door.angle += (H.door.target - H.door.angle) * Math.min(1, dt * 2.2); pivot.rotation.y = H.door.angle;
    const li = s.lights ? 0.42 : 0.01; rack.lights.forEach(b => b.setIntensity(li)); growLights.forEach(l => { l.intensity = s.lights ? 2.2 : 0; });
  };
  return H;
}
