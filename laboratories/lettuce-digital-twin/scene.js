/* Lettuce digital twin — 3D scene: the physical crop (deep-water-culture tray under LEDs, top-view camera)
   and its digital twin (holographic lettuce on a projection plinth with an ensemble gauge). Visual only. */
import { THREE, M, makeRoom, makeLEDBar, makeRaft, makeNetPot, lettuceGeometry, leafMaterial, FlowAlong, RoundedBoxGeometry, makePipe, canvasTexture, surfaceMaterial } from '/assets/js/lab3d.js';

const BENCH_TOP = 0.86;              // m, top of the tray water / raft
const TRAY_X = -0.55;                // tray centre x
const PLINTH = new THREE.Vector3(1.05, 0, 0.1);
const HOLO_SCALE = 1.9;

/** Growth parameter of lettuceGeometry for a fresh weight per head (g): radius ∝ FW^(1/3), 250 g ≈ growth 1. */
export function growthFromFW(fw) {
  const r = Math.cbrt(Math.max(0.01, fw) / 250);
  const g = Math.max(0.02, (r - 0.25) / 0.75);
  return Math.min(1.25, Math.pow(g, 1 / 0.7));
}
const geoCache = new Map();
function lettuceGeo(g, seed, variety = 'butterhead') {
  const q = Math.round(g * 50) / 50; const key = `${variety}|${seed}|${q}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const geo = lettuceGeometry({ radius: 0.12, growth: Math.max(0.02, q), leaves: 22, variety, seed });
  geoCache.set(key, geo);
  if (geoCache.size > 48) { const k0 = geoCache.keys().next().value; const g0 = geoCache.get(k0); geoCache.delete(k0); setTimeout(() => g0.dispose(), 2000); }
  return geo;
}

export function buildTwinScene(stage) {
  const { scene } = stage; const H = {};
  // ---------- room & lights
  const room = makeRoom({ w: 7, d: 6, h: 3.1, wallColor: 0x1b2024, floor: 'epoxy' });
  room.floor.material.color.set(0x5d6563); scene.add(room);
  const hemi = new THREE.HemisphereLight(0xb9cde0, 0x1a1d1f, 0.28); scene.add(hemi);
  const key = new THREE.SpotLight(0xe8f0ff, 6, 9, 0.9, 0.9, 1.6); key.position.set(1.6, 3.0, 2.4); key.target.position.set(0.2, 0.7, 0);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02; scene.add(key, key.target);

  // ---------- bench with deep-water-culture tray
  const bench = new THREE.Group(); bench.position.x = TRAY_X; scene.add(bench);
  const steel = M.steel();
  const top = new THREE.Mesh(new RoundedBoxGeometry(1.42, 0.04, 1.12, 2, 0.01), steel); top.position.y = 0.74; top.castShadow = true; top.receiveShadow = true; bench.add(top);
  [[-0.66, -0.51], [0.66, -0.51], [-0.66, 0.51], [0.66, 0.51]].forEach(([x, z]) => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.72, 0.045), steel); l.position.set(x, 0.36, z); l.castShadow = true; bench.add(l); });
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.02, 1.04), M.galvanised()); shelf.position.y = 0.16; shelf.receiveShadow = true; bench.add(shelf);
  const res = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.3, 0.45, 2, 0.02), M.plastic(0x2c3238, 0.5)); res.position.set(-0.3, 0.32, 0); res.castShadow = true; bench.add(res);
  const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 20), M.plasticBlack()); pump.position.set(0.25, 0.22, 0.1); bench.add(pump);
  bench.add(makePipe([[0.25, 0.27, 0.1], [0.4, 0.5, 0.2], [0.55, 0.8, 0.35]], { radius: 0.008, material: M.plasticBlack() }));
  const trayGroup = new THREE.Group(); bench.add(trayGroup);
  H.bench = bench;

  // ---------- LED fixture
  const fixture = new THREE.Group(); fixture.position.set(TRAY_X, BENCH_TOP + 0.62, 0); scene.add(fixture);
  const bars = [-0.36, -0.12, 0.12, 0.36].map(z => { const b = makeLEDBar({ length: 1.15, width: 0.08, color: 'full', light: 'rect', lightIntensity: 11 }); b.position.z = z; fixture.add(b); return b; });
  [-0.5, 0.5].forEach(x => { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.86), M.aluminium()); rail.position.set(x, 0.03, 0); fixture.add(rail); });
  [[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.4], [0.5, 0.4]].forEach(([x, z]) => { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 3.1 - BENCH_TOP - 0.62, 6), M.steel()); w.position.set(x, (3.1 - BENCH_TOP - 0.62) / 2 + 0.03, z); fixture.add(w); });
  H.fixture = fixture; H.bars = bars;

  // ---------- top-view camera on an arm between the bars
  const cam = new THREE.Group(); cam.position.set(TRAY_X, BENCH_TOP + 0.78, 0); scene.add(cam);
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.06, 0.1, 2, 0.008), M.anodised()); cam.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.04, 24), M.plasticBlack()); lens.position.y = -0.05; cam.add(lens);
  const glassL = new THREE.Mesh(new THREE.CircleGeometry(0.014, 24), new THREE.MeshPhysicalMaterial({ color: 0x10183a, roughness: 0.05, metalness: 0.3, clearcoat: 1, iridescence: 0.8 })); glassL.rotation.x = Math.PI / 2; glassL.position.y = -0.0705; cam.add(glassL);
  const camLed = new THREE.Mesh(new THREE.SphereGeometry(0.005, 10, 8), new THREE.MeshStandardMaterial({ color: 0x0b1a10, emissive: 0x39ff88, emissiveIntensity: 1.5 })); camLed.position.set(0.03, 0.0, 0.051); cam.add(camLed);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.62), M.aluminium()); arm.position.set(0, 0.04, -0.31 - 0.05); cam.add(arm);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.1 - (BENCH_TOP + 0.78)), M.aluminium()); mast.position.set(0, (3.1 - (BENCH_TOP + 0.78)) / 2 + 0.04, -0.67); cam.add(mast);
  cam.add(makePipe([[0.03, 0.02, -0.05], [0.05, 0.06, -0.3], [0.03, 0.06, -0.66], [0.03, 0.8, -0.68]], { radius: 0.003, material: M.plasticBlack() }));
  // capture frustum (shown briefly at each snapshot)
  const frGeo = new THREE.ConeGeometry(0.62, 0.72, 4, 1, true); frGeo.rotateY(Math.PI / 4); frGeo.translate(0, -0.36 - 0.07, 0);
  const frustum = new THREE.Mesh(frGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fffc8).multiplyScalar(1.6), transparent: true, opacity: 0, wireframe: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  frustum.scale.set(1.0, 1, 0.78); cam.add(frustum);
  const flash = new THREE.PointLight(0xe8fff2, 0, 2.5, 2); flash.position.y = -0.1; cam.add(flash);
  H.camera = cam;

  // ---------- digital-twin plinth with hologram and ensemble gauge
  const plinth = new THREE.Group(); plinth.position.copy(PLINTH); scene.add(plinth);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.72, 64), new THREE.MeshStandardMaterial({ color: 0x14191d, metalness: 0.6, roughness: 0.35 })); base.position.y = 0.36; base.castShadow = true; base.receiveShadow = true; plinth.add(base);
  const cyan = new THREE.Color(0x3fdcff);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.008, 12, 96), new THREE.MeshBasicMaterial({ color: cyan.clone().multiplyScalar(2.6) })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.722; plinth.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.29, 64), new THREE.MeshStandardMaterial({ color: 0x061015, emissive: 0x0c4a5a, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.4 })); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.721; plinth.add(disc);
  const beamTex = canvasTexture(8, 128, (ctx, w, h) => { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(90,220,255,0)'); g.addColorStop(1, 'rgba(90,220,255,0.55)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }, { key: 'twin-beam' });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.6, 48, 1, true), new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, opacity: 0.2 }));
  beam.position.y = 0.72 + 0.3; plinth.add(beam);
  const holo = new THREE.Group(); holo.position.y = 0.76; holo.scale.setScalar(HOLO_SCALE); plinth.add(holo);
  const holoWire = new THREE.Mesh(lettuceGeo(0.05, 3), new THREE.MeshBasicMaterial({ color: cyan.clone().multiplyScalar(1.35), wireframe: true, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending }));
  const holoFill = new THREE.Mesh(lettuceGeo(0.05, 3), new THREE.MeshStandardMaterial({ color: 0x06222a, emissive: 0x1aa8c8, emissiveIntensity: 0.55, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
  holo.add(holoFill, holoWire);
  const holoLight = new THREE.PointLight(0x46d8ff, 1.2, 1.8, 2); holoLight.position.y = 1.0; plinth.add(holoLight);
  // ensemble gauge: glass tube, target ring, member dots, mean ring, truth ring
  const GX = 0.5, G0 = 0.74, GH = 1.0;           // gauge x offset (local), base height, height of the target
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, GH + 0.25, 16), M.glassCheap(0.25)); tube.position.set(GX, G0 + (GH + 0.25) / 2, 0); plinth.add(tube);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.04, 24), new THREE.MeshStandardMaterial({ color: 0x14191d, metalness: 0.6, roughness: 0.35 })); foot.position.set(GX, 0.74, 0); plinth.add(foot);
  const standG = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.06), new THREE.MeshStandardMaterial({ color: 0x14191d, metalness: 0.6, roughness: 0.35 })); standG.position.set(GX - 0.11, 0.73, 0); plinth.add(standG);
  const mkRing = (col, r, th) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, th, 8, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(2.2), transparent: true, opacity: 0.95 })); m.rotation.x = Math.PI / 2; m.position.x = GX; plinth.add(m); return m; };
  const targetRing = mkRing(0xffb640, 0.05, 0.004); targetRing.position.y = G0 + GH;
  const meanRing = mkRing(0x46e0ff, 0.036, 0.004);
  const truthRing = mkRing(0x62ff9a, 0.043, 0.003);
  const NMAX = 200; const dotPos = new Float32Array(NMAX * 3); const dotGeo = new THREE.BufferGeometry(); dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3)); dotGeo.setDrawRange(0, 0);
  const dotTex = canvasTexture(64, 64, (ctx, w) => { const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, w); }, { key: 'twin-dot', srgb: false });
  const dots = new THREE.Points(dotGeo, new THREE.PointsMaterial({ color: new THREE.Color(0x8fefff).multiplyScalar(1.8), size: 0.03, map: dotTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); dots.frustumCulled = false; plinth.add(dots);
  const jit = Array.from({ length: NMAX }, (_, i) => [Math.cos(i * 2.39996) * (0.022 + 0.018 * ((i * 37) % 11) / 11), Math.sin(i * 2.39996) * (0.022 + 0.018 * ((i * 53) % 13) / 13)]);
  H.plinth = plinth; H.holo = holo;

  // ---------- data link camera → twin, and control link twin → lamps (closed loop)
  const worldCam = new THREE.Vector3(TRAY_X, BENCH_TOP + 0.84, 0);
  const linkCurve = new THREE.CatmullRomCurve3([worldCam.clone().add(new THREE.Vector3(0.05, 0.05, 0)), new THREE.Vector3(0.1, 2.3, 0.1), new THREE.Vector3(0.85, 2.1, 0.1), new THREE.Vector3(PLINTH.x, 1.9, PLINTH.z)]);
  const link = new FlowAlong(linkCurve, { count: 70, speed: 1.1, size: 0.035, color: 0x6fffc0, jitter: 0.01, opacity: 0 }); scene.add(link.points);
  const ctrlCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(PLINTH.x, 1.8, PLINTH.z - 0.05), new THREE.Vector3(0.9, 2.45, -0.3), new THREE.Vector3(0.0, 2.3, -0.35), new THREE.Vector3(TRAY_X + 0.55, BENCH_TOP + 0.66, -0.3)]);
  const ctrlLink = new FlowAlong(ctrlCurve, { count: 60, speed: 0.9, size: 0.03, color: 0xff7ad9, jitter: 0.01, opacity: 0 }); scene.add(ctrlLink.points);

  // ---------- physical crop (tray, raft, net pots, lettuce instances)
  const lmat = leafMaterial({ gloss: 0.45 });
  let crop = { key: '', ims: [], plants: [], grid: null };
  H.buildTray = (rhoP) => {
    const s = 1 / Math.sqrt(rhoP); const nx = Math.max(3, Math.min(7, Math.round(1.12 / s))), nz = Math.max(2, Math.min(6, Math.round(0.9 / s)));
    const key = `${nx}x${nz}@${s.toFixed(3)}`; if (key === crop.key) return;
    trayGroup.clear(); crop = { key, ims: [], plants: [], grid: { nx, nz, s } };
    const w = nx * s + 0.06, d = nz * s + 0.06;
    const tray = new THREE.Group();
    const tmat = M.plastic(0xf3f4f1, 0.35);
    const tb = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.012, d + 0.04), tmat); tb.position.y = 0.766; tb.receiveShadow = true; tray.add(tb);
    [[0, (d + 0.04) / 2, w + 0.04, 0.02], [0, -(d + 0.04) / 2, w + 0.04, 0.02]].forEach(([x, z, a, b]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(a, 0.1, b), tmat); m.position.set(x, 0.81, z); m.castShadow = true; tray.add(m); });
    [[(w + 0.04) / 2, 0], [-(w + 0.04) / 2, 0]].forEach(([x, z]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, d + 0.06), tmat); m.position.set(x, 0.81, z); m.castShadow = true; tray.add(m); });
    const water = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), M.waterCheap(0x2f7f96, 0.7)); water.position.y = 0.8; tray.add(water);
    trayGroup.add(tray);
    const raft = makeRaft({ w: nx * s, d: nz * s, thickness: 0.03, nx, nz, holeR: 0.026 }); raft.position.y = BENCH_TOP - 0.03; trayGroup.add(raft);
    const potGeoPos = [];
    raft.holes.forEach((hp, i) => { const pot = makeNetPot({ radius: 0.027, height: 0.05 }); pot.position.set(hp.x, BENCH_TOP + 0.003, hp.z); trayGroup.add(pot); potGeoPos.push([hp.x, hp.z, i]); });
    crop.plants = potGeoPos;
    crop.ims = [0, 1, 2].map(k => { const im = new THREE.InstancedMesh(lettuceGeo(0.05, 11 + k * 7), lmat, potGeoPos.length); im.castShadow = true; im.receiveShadow = true; im.count = 0; trayGroup.add(im); return im; });
    crop.g = -1;
  };
  H.setCrop = (fw) => {
    const g = growthFromFW(fw); const q = Math.round(g * 50) / 50; if (q === crop.g) return; crop.g = q;
    const buckets = [[], [], []]; crop.plants.forEach(p => buckets[p[2] % 3].push(p));
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3();
    crop.ims.forEach((im, k) => {
      im.geometry = lettuceGeo(q, 11 + k * 7);
      buckets[k].forEach(([x, z, i], j) => { qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.7); const v = 0.92 + ((i * 29) % 7) * 0.025; sc.set(v, v, v); m4.compose(new THREE.Vector3(x, BENCH_TOP + 0.02, z), qq, sc); im.setMatrixAt(j, m4); });
      im.count = buckets[k].length; im.instanceMatrix.needsUpdate = true;
    });
  };
  H.setHolo = (fw) => { const g = growthFromFW(fw); const geo = lettuceGeo(g, 3); if (holoWire.geometry !== geo) { holoWire.geometry = geo; holoFill.geometry = geo; } };
  /** Ensemble gauge: member fresh weights (g), target (g), mean, truth (or null). */
  H.setGauge = (fws, target, mean, truth) => {
    const n = Math.min(NMAX, fws.length); const hOf = fw => G0 + GH * Math.min(1.22, Math.max(0, fw / target));
    for (let i = 0; i < n; i++) { dotPos[i * 3] = GX + jit[i][0]; dotPos[i * 3 + 1] = hOf(fws[i]); dotPos[i * 3 + 2] = jit[i][1]; }
    dotGeo.setDrawRange(0, n); dotGeo.attributes.position.needsUpdate = true;
    meanRing.position.y = hOf(mean); truthRing.visible = truth != null; if (truth != null) truthRing.position.y = hOf(truth);
    targetRing.position.y = G0 + GH;
  };
  // ---------- wall-mounted dashboard screen (the twin's user interface)
  const dashCv = document.createElement('canvas'); dashCv.width = 640; dashCv.height = 380;
  const dashTex = new THREE.CanvasTexture(dashCv); dashTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Group(); screen.position.set(-0.05, 1.9, -2.93); scene.add(screen);
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(1.34, 0.8, 0.05, 2, 0.012), M.plasticBlack()); screen.add(bezel);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.28, 0.76), new THREE.MeshBasicMaterial({ map: dashTex, toneMapped: false })); panel.position.z = 0.026; screen.add(panel);
  const glowS = new THREE.PointLight(0x5ee0ff, 0.6, 2.5, 2); glowS.position.set(-0.05, 1.9, -2.5); scene.add(glowS);
  H.drawDashboard = fn => { fn(dashCv.getContext('2d'), dashCv.width, dashCv.height); dashTex.needsUpdate = true; };
  // ---------- animation state
  let flashT = 0, linkT = 0;
  H.snapshot = () => { flashT = 0.9; linkT = 2.2; };
  H.update = (dt, t, s) => {
    // s = { light (0..1 intensity), loop (bool) }
    bars.forEach(b => b.setIntensity(s.light));
    holo.rotation.y += dt * 0.35;
    holoWire.material.opacity = 0.26 + 0.06 * Math.sin(t * 3.1) + (Math.random() < 0.02 ? 0.12 : 0);
    ring.material.color.copy(cyan).multiplyScalar(2.2 + 0.5 * Math.sin(t * 2));
    flashT = Math.max(0, flashT - dt); linkT = Math.max(0, linkT - dt);
    frustum.material.opacity = flashT > 0 ? 0.55 * Math.min(1, flashT / 0.3) : 0; flash.intensity = flashT > 0.6 ? 3 * (flashT - 0.6) / 0.3 : 0;
    camLed.material.emissive.setHex(flashT > 0 ? 0xffffff : 0x39ff88); camLed.material.emissiveIntensity = flashT > 0 ? 4 : 1.5;
    link.points.material.opacity = Math.min(0.9, linkT * 0.8); link.update(dt);
    ctrlLink.points.material.opacity = s.loop ? 0.55 + 0.25 * Math.sin(t * 4) : 0; ctrlLink.update(dt);
  };
  H.parts = [
    { id: 'crop', obj: trayGroup, cam: [[TRAY_X + 0.55, 1.45, 1.05], [TRAY_X, BENCH_TOP, 0]] },
    { id: 'camera', obj: cam, cam: [[TRAY_X + 0.02, BENCH_TOP + 0.74, 0.02], [TRAY_X, BENCH_TOP - 0.2, 0]] },
    { id: 'twin', obj: plinth, cam: [[PLINTH.x + 0.1, 1.65, PLINTH.z + 1.35], [PLINTH.x + 0.15, 1.25, PLINTH.z]] },
    { id: 'lamps', obj: fixture, cam: [[TRAY_X + 0.9, 1.3, 1.1], [TRAY_X, BENCH_TOP + 0.55, 0]] }
  ];
  H.gaugeTop = () => new THREE.Vector3(PLINTH.x + GX, G0 + GH + 0.3, PLINTH.z);
  H.labelAnchors = { crop: new THREE.Vector3(TRAY_X - 0.2, BENCH_TOP + 0.36, 0.45), twin: new THREE.Vector3(PLINTH.x - 0.2, 1.5, PLINTH.z + 0.15), camera: new THREE.Vector3(TRAY_X + 0.06, BENCH_TOP + 0.9, 0.05), gauge: new THREE.Vector3(PLINTH.x + GX + 0.06, G0 + 0.3, PLINTH.z) };
  return H;
}
export const SCENE_CONST = { TRAY_X, BENCH_TOP, PLINTH };
