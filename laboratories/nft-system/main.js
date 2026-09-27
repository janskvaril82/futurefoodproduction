/* NFT channel simulator — 3D scene, controls, readouts and charts.
   The model (model.js, Eqs. N1–N9) is solved for the whole crop cycle whenever a parameter changes;
   the day slider / ▶ button then replays the stored daily snapshots. */
import { createStage, THREE, addSky, makeGround, makeGreenhouse, FlowAlong, Bubbles, makeProbe, disposeDeep } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, linspace } from '/assets/js/plot.js';
import { colormap, colormapGradient } from '/assets/js/colors.js';
import { simulate, film, CROP, csT } from './model.js';
import { mats, makeGully, makeTote, makeSubmersiblePump, makeAirPump, makeAirStone, lettuceLite, sharedLeafMaterial, headScale, rootMatGeometry, rootMaterial, rootMatTexture, groundClothMaterial, netPotParts, makeBallValve, tube, box, cyl, stressTint } from '/laboratories/soilless-systems-3d/parts.js';

/* ================================================================== controls */
const ui = new Controls('#controls', { url: true });
ui.section('Gully geometry');
ui.slider({ id: 'slope', label: 'Slope', min: 0.5, max: 5, step: 0.1, value: 2.5, unit: '', help: '1:100 = 1 % · 1:40 = 2.5 % · 1:20 = 5 %', format: v => `${fmt(v, 1)} % (1:${fmt(100 / v, 0)})` });
ui.slider({ id: 'len', label: 'Gully length', min: 2, max: 30, step: 0.5, value: 10, unit: 'm' });
ui.slider({ id: 'sp', label: 'Plant spacing in the gully', min: 15, max: 30, step: 1, value: 20, unit: 'cm' });
ui.slider({ id: 'wid', label: 'Gully floor width', min: 6, max: 20, step: 0.5, value: 10, unit: 'cm' });
ui.slider({ id: 'ng', label: 'Number of gullies', min: 2, max: 6, step: 1, value: 4 });
ui.section('Flow and solution');
ui.slider({ id: 'flow', label: 'Flow per gully', min: 0.1, max: 4, step: 0.05, value: 1.5, unit: 'L min⁻¹', help: 'Guidance: ≈ 1 L min⁻¹, up to 2 (Graves 1983)' });
ui.slider({ id: 'imb', label: 'Manifold imbalance between gullies', min: 0, max: 50, step: 1, value: 0, unit: '%', help: 'First gully gets +x %, last gully −x %' });
ui.slider({ id: 'doIn', label: 'Inlet dissolved O₂', min: 3, max: 12, step: 0.1, value: 8.0, unit: 'mg L⁻¹' });
ui.slider({ id: 'nIn', label: 'Inlet NO₃-N', min: 2, max: 250, step: 1, value: 125, unit: 'mg L⁻¹', help: 'Cornell lettuce solution: 125 mg N L⁻¹' });
ui.slider({ id: 'kIn', label: 'Inlet K', min: 2, max: 350, step: 1, value: 215, unit: 'mg L⁻¹', help: 'Cornell lettuce solution: 215 mg K L⁻¹' });
ui.slider({ id: 'tIn', label: 'Solution temperature at the inlet', min: 10, max: 32, step: 0.5, value: 22, unit: '°C' });
ui.section('Greenhouse climate');
ui.slider({ id: 'tAir', label: 'Air temperature', min: 10, max: 38, step: 0.5, value: 24, unit: '°C' });
ui.slider({ id: 'sun', label: 'Solar radiation on the gullies', min: 0, max: 900, step: 10, value: 300, unit: 'W m⁻²' });
ui.slider({ id: 'ew', label: 'Crop water use', min: 1, max: 6, step: 0.1, value: 3.0, unit: 'L kg⁻¹ d⁻¹', help: 'Transpiration per kg of lettuce per day (≈ 3 reproduces 20 L kg⁻¹ over the crop)' });
ui.slider({ id: 'ell', label: 'Surface-renewal length ℓ', min: 0.05, max: 3, step: 0.05, value: 1.0, unit: 'm', help: 'Shorter = more ripples → faster re-aeration (Eq. N3)' });
ui.section('Crop cycle');
ui.slider({ id: 'day', label: 'Days after transplanting', min: 0, max: 24, step: 0.1, value: 24, unit: 'd', persist: false, digits: 1 });
const [playBtn] = ui.buttons([{ label: '▶ Grow the crop', variant: 'primary', onClick: () => { if (!clock.running && ui.get('day') >= 23.95) { ui.set('day', 0, true); clock.reset(0); } else clock.reset(ui.get('day')); clock.toggle(); } }]);
ui.section('Display');
ui.segmented({ id: 'view', label: 'View', options: [{ value: 'crop', label: 'Crop' }, { value: 'map', label: 'Film map' }], value: 'crop' });
ui.select({ id: 'col', label: 'Colour the film by', options: [{ value: 'do', label: 'Dissolved O₂' }, { value: 'temp', label: 'Temperature' }, { value: 'no3', label: 'NO₃-N (% of inlet)' }, { value: 'k', label: 'K (% of inlet)' }, { value: 'f', label: 'Growth factor f' }], value: 'do' });
ui.toggle({ id: 'labels', label: 'Component labels', value: true });
ui.buttons([{ label: 'Inlet', onClick: () => fly('inlet') }, { label: 'Outlet', onClick: () => fly('outlet') }, { label: 'Cut-away', onClick: () => fly('cut') }, { label: 'Overview', onClick: () => fly('home') }]).forEach((b, i) => b.id = 'nft-view-' + ['inlet', 'outlet', 'cut', 'home'][i]);
ui.presets([
  { label: 'Textbook design', title: '1.5 L min⁻¹, slope 1:40, 10 m gullies', values: { slope: 2.5, len: 10, sp: 20, wid: 10, ng: 4, flow: 1.5, imb: 0, doIn: 8, nIn: 125, kIn: 215, tIn: 22, tAir: 24, sun: 300, ew: 3, ell: 1 } },
  { label: 'Too long a gully', title: '30 m gullies at 1 L min⁻¹', values: { slope: 2.5, len: 30, sp: 20, wid: 10, ng: 4, flow: 1.0, imb: 0, doIn: 8, nIn: 125, kIn: 215, tIn: 22, tAir: 24, sun: 300, ew: 3, ell: 1 } },
  { label: 'Low flow', title: '0.25 L min⁻¹ in 12 m gullies', values: { slope: 2.5, len: 12, sp: 20, wid: 10, ng: 4, flow: 0.25, imb: 0, doIn: 8, nIn: 125, kIn: 215, tIn: 22, tAir: 24, sun: 300, ew: 3, ell: 1 } },
  { label: 'Hot summer', title: 'Warm solution, 33 °C air, strong sun', values: { slope: 2.5, len: 10, sp: 20, wid: 10, ng: 4, flow: 1.5, imb: 0, doIn: 7.5, nIn: 125, kIn: 215, tIn: 26, tAir: 33, sun: 700, ew: 5, ell: 1 } },
  { label: 'Unbalanced manifold', title: '±40 % flow between gullies at 0.6 L min⁻¹', values: { slope: 2.5, len: 12, sp: 20, wid: 10, ng: 4, flow: 0.6, imb: 40, doIn: 8, nIn: 125, kIn: 215, tIn: 22, tAir: 24, sun: 300, ew: 3, ell: 1 } }
]);
ui.saveButton('nft-system', () => ro.values());

const ro = new Readouts('#readouts');
ro.add({ id: 'h', label: 'Film thickness at the inlet', unit: 'mm', digits: 2 })
  .add({ id: 'u', label: 'Mean film velocity', unit: 'm s⁻¹', digits: 3 })
  .add({ id: 'tres', label: 'Residence time in a gully', unit: '', format: v => v })
  .add({ id: 'doOut', label: 'Outlet dissolved O₂', unit: 'mg L⁻¹', digits: 2 })
  .add({ id: 'tOut', label: 'Outlet solution temperature', unit: '°C', digits: 1 })
  .add({ id: 'nOut', label: 'Outlet NO₃-N', unit: 'mg L⁻¹', digits: 1 })
  .add({ id: 'kOut', label: 'Outlet K', unit: 'mg L⁻¹', digits: 1 })
  .add({ id: 'mass', label: 'Mean head fresh mass', unit: 'g', digits: 0 })
  .add({ id: 'unif', label: 'Last ÷ first plant (mass)', unit: '', digits: 2 })
  .add({ id: 'o2', label: 'O₂ used ÷ O₂ carried in', unit: '%', digits: 0 })
  .add({ id: 'water', label: 'Water uptake per gully', unit: 'L d⁻¹', digits: 1 })
  .add({ id: 'pump', label: 'Pump flow (all gullies)', unit: 'L min⁻¹', digits: 2 });

/* ================================================================== stage */
const stage = createStage('#stage', {
  background: null, envIntensity: 0.55, exposure: 1.0,
  camera: { pos: [-7.5, 2.1, 3.1], target: [-2.2, 0.85, -0.2], fov: 42 },
  controls: { minDistance: 0.25, maxDistance: 45, maxPolarAngle: Math.PI * 0.492 },
  bloom: false, ao: { radius: 0.16, intensity: 0.75 }
});
const { scene } = stage;
stage.renderer.localClippingEnabled = false;
const sky = addSky(stage, { elevation: 34, azimuth: 205, sunIntensity: 2.6, shadowSize: 9 });
const ground = makeGround({ size: 90, type: 'concrete' }); scene.add(ground);
const hud = hudChips(stage.el);
const legend = document.createElement('div'); legend.className = 'stage-legend'; stage.el.appendChild(legend);
const MT = mats();

/* ------------------------------------------------------------------ geometry state */
const GAP = 0.32, Y_OUT = 0.82;            // gully spacing (m), gully floor height at the outlet end (m)
let geo = null;                              // current build { x0, Lg, yIn, frames[], gullies[], … }
const world = new THREE.Group(); scene.add(world);
let gh = null;
/* level of detail (triangle budget): near = the cut-away gully, mid = other gullies, tiny = very long installations */
const lettuceFull = [lettuceLite({ radius: 0.12, leaves: 18, seed: 5, segU: 11, segV: 7 }), lettuceLite({ radius: 0.12, leaves: 17, seed: 11, segU: 11, segV: 7 })];
const lettuceGeos = [lettuceLite({ radius: 0.12, leaves: 12, seed: 5, segU: 7, segV: 5 }), lettuceLite({ radius: 0.12, leaves: 12, seed: 11, segU: 7, segV: 5 })];
const lettuceTiny = [lettuceLite({ radius: 0.12, leaves: 10, seed: 5, segU: 6, segV: 5 }), lettuceLite({ radius: 0.12, leaves: 10, seed: 11, segU: 6, segV: 5 })];
const rootGeo = rootMatGeometry({ seed: 4, length: 0.2, count: 12, yFloor: -0.0005 });
const rootMat = rootMaterial();
const matGeo = new THREE.PlaneGeometry(1, 1); matGeo.rotateX(-Math.PI / 2); matGeo.translate(0.5, 0, 0);
const matMat = new THREE.MeshStandardMaterial({ map: rootMatTexture(), transparent: true, alphaTest: 0.05, depthWrite: false, roughness: 0.8, side: THREE.DoubleSide });
{ const cloth = new THREE.Mesh(new THREE.PlaneGeometry(80, 12), groundClothMaterial([160, 24])); cloth.rotation.x = -Math.PI / 2; cloth.position.y = 0.004; cloth.receiveShadow = true; scene.add(cloth); }
const NP = netPotParts();
const flows = [];                            // FlowAlong objects
let bubbles = null, probe = null, probeLabel = null, probeX = null, probeG = null;
const labels = [];
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpC = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);

function label(target, html, offset = [0, 0, 0], cls = 'label3d', maxDist = 9) { const l = stage.addLabel(target, html, { offset, className: cls }); l.userData.maxDist = maxDist; labels.push(l); return l; }
const _lp = new THREE.Vector3();
function labelLOD() { const on = ui.get('labels'); labels.forEach(l => { l.getWorldPosition(_lp); l.visible = on && _lp.distanceTo(stage.camera.position) < l.userData.maxDist; }); }

function build(p, n) {
  // dispose old
  flows.length = 0; labels.forEach(l => { l.parent && l.parent.remove(l); l.element.remove(); }); labels.length = 0;
  if (probe) { probe.parent && probe.parent.remove(probe); probe = null; probeLabel = null; probeX = null; }
  world.children.slice().forEach(c => { world.remove(c); disposeDeep(c); });
  const s = p.sp / 100, Lg = n * s, W = p.wid / 100, slope = p.slope / 100, ng = p.ng;
  const x0 = -Lg / 2 - 0.3, yIn = Y_OUT + slope * Lg, ang = -Math.atan(slope);
  const zOf = j => (j - (ng - 1) / 2) * GAP;
  const zMin = zOf(0) - W / 2, zMax = zOf(ng - 1) + W / 2;
  const holes = Array.from({ length: n }, (_, i) => (i + 0.5) * s);
  const g = { x0, Lg, yIn, ang, s, W, ng, n, zOf, gullies: [], lettuce: [], pots: [], roots: null, films: [], zMin, zMax, slope };
  // ---- gullies
  for (let j = 0; j < ng; j++) {
    const cut = j === ng - 1;
    const gu = makeGully({ length: Lg, width: W, height: 0.05, holes, cut, clearLid: cut });
    gu.position.set(x0, yIn, zOf(j)); gu.rotation.z = ang; world.add(gu); gu.updateMatrixWorld(true);
    gu.userData.j = j; g.gullies.push(gu);
    // heat-map texture on the film
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 2;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    gu.film.material.map = tex; gu.film.material.emissiveMap = tex; gu.film.material.color.set(0xffffff); gu.film.material.emissive.set(0xffffff); gu.film.material.emissiveIntensity = 0.22; gu.film.material.needsUpdate = true;
    g.films.push({ cv, tex, ctx: cv.getContext('2d') });
    // lettuce, net pots (instanced, gully-local coordinates)
    const lets = (cut ? (n <= 60 ? lettuceFull : lettuceGeos) : n * ng > 220 ? lettuceTiny : lettuceGeos).map((lg, k) => { const im = new THREE.InstancedMesh(lg, sharedLeafMaterial(), Math.ceil(n / 2) + 1); im.castShadow = true; im.receiveShadow = true; im.count = 0; gu.add(im); im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((Math.ceil(n / 2) + 1) * 3).fill(1), 3); return im; });
    g.lettuce.push(lets);
    const pots = [new THREE.InstancedMesh(NP.cup, NP.mat, n), new THREE.InstancedMesh(NP.rim, NP.rimMat, n)];
    if (cut) pots.push(new THREE.InstancedMesh(NP.plug, NP.plugMat, n));      // plugs only show in the cut-away gully
    holes.forEach((x, i) => { tmpM.makeTranslation(x, 0.053, 0); pots.forEach(pm => pm.setMatrixAt(i, tmpM)); });
    pots.forEach(pm => { pm.castShadow = true; pm.receiveShadow = true; gu.add(pm); }); g.pots.push(pots);
    if (cut) {
      const rm = new THREE.InstancedMesh(rootGeo, rootMat, n); rm.castShadow = true; rm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3); gu.add(rm); g.roots = rm;
      g.rootStride = Math.max(1, Math.ceil(n / 30));          // at most ≈ 30 strand clusters (triangle budget); every plant keeps its flat mat
      const mm = new THREE.InstancedMesh(matGeo, matMat, n); mm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3); mm.renderOrder = 3; gu.add(mm); g.mats = mm;
    }
    // film flow particles
    const fa = new FlowAlong(new THREE.LineCurve3(gu.localToWorld(new THREE.Vector3(0.03, 0.0065, 0)), gu.localToWorld(new THREE.Vector3(Lg - 0.03, 0.0065, 0))), { count: Math.min(420, Math.round(16 * Lg)), speed: 0.15, size: 0.011, color: 0xcff3ff, jitter: W * 0.6, opacity: 0.85 });
    fa.off.forEach(o => { o.y = Math.abs(o.y) * 0.05; });
    world.add(fa.points); flows.push({ f: fa, kind: 'film', j });
  }
  world.updateMatrixWorld(true);
  // ---- trestles (galvanised stands every ≈ 2 m)
  const nT = Math.max(2, Math.round(Lg / 2) + 1);
  for (let k = 0; k < nT; k++) {
    const xl = 0.15 + k * (Lg - 0.3) / (nT - 1); const xw = x0 + xl * Math.cos(ang); const yb = yIn - xl * Math.sin(-ang) - 0.004;
    const zA = zMin - 0.14, zB = zMax + 0.14;
    world.add(box(0.04, 0.04, zB - zA + 0.04, MT.galv, xw, yb - 0.02, (zA + zB) / 2));
    [zA, zB].forEach(z => { world.add(box(0.04, yb - 0.04, 0.04, MT.galv, xw, (yb - 0.04) / 2, z)); world.add(box(0.12, 0.008, 0.12, MT.galv, xw, 0.004, z)); });
    world.add(box(0.03, 0.03, zB - zA, MT.galv, xw, 0.18, (zA + zB) / 2));
  }
  // ---- reservoir at the outlet end (the collector's drop pipe enters it near its −x wall)
  const xc = x0 + Lg * Math.cos(ang) + 0.07, yc = Y_OUT - 0.07;
  const xr = xc + 0.36;
  const tank = makeTote({ w: 0.8, d: Math.max(0.9, zMax - zMin + 0.35), h: 0.62, cut: true, level: 0.42, mat: MT.toteBlack, wall: 0.008 });
  tank.position.set(xr, 0, 0); world.add(tank); tank.updateMatrixWorld(true); g.tank = tank;
  const pump = makeSubmersiblePump({ scale: 1.6 }); pump.position.set(0.12, tank.floorY, -0.3); pump.rotation.y = Math.PI; tank.add(pump); pump.updateMatrixWorld(true);
  const stone = makeAirStone({ length: 0.12 }); stone.position.set(0.12, tank.floorY, 0.1); tank.add(stone);
  bubbles = new Bubbles({ emitters: [[0.08, 0.03, 0.1], [0.12, 0.03, 0.1], [0.16, 0.03, 0.1], [0.1, 0.03, 0.08], [0.14, 0.03, 0.12]], top: tank.levelY, rate: 22, size: 0.0035, spread: 0.03, speed: 0.3 });
  tank.add(bubbles.mesh);
  const air = makeAirPump(); air.position.set(xr + 0.2, 0.62 + 0.01, zMin - 0.05); air.rotation.y = Math.PI / 2; world.add(air);
  world.add(box(0.5, 0.012, 0.24, MT.galv, xr + 0.15, 0.622, zMin - 0.05));
  world.add(tube([[xr + 0.2, 0.67, zMin - 0.14], [xr + 0.2, 0.74, zMin - 0.2], [xr + 0.05, 0.72, zMin - 0.12], [xr + 0.0, 0.4, zMin + 0.05], [xr - 0.0, 0.05, 0.08], [xr + 0.05, 0.022, 0.1]], 0.0028, MT.silicone));
  // DO probe in the reservoir
  const pr = makeProbe({ cap: 0x2f6fd6, tip: 'steel' }); pr.position.set(xr + 0.28, 0.2, -0.2); world.add(pr);
  g.probeIn = pr;
  // ---- collector gutter under the gully spouts, and return drop into the tank
  const colLen = zMax - zMin + 0.3;
  const colGeo = new THREE.CylinderGeometry(0.055, 0.055, colLen, 28, 1, true, 0, Math.PI); colGeo.rotateX(Math.PI / 2); colGeo.rotateZ(Math.PI / 2);
  const col = new THREE.Mesh(colGeo, new THREE.MeshPhysicalMaterial({ color: 0xe8eae6, roughness: 0.35, clearcoat: 0.4, side: THREE.DoubleSide })); col.position.set(xc, yc, (zMin + zMax) / 2); col.castShadow = true; col.receiveShadow = true; world.add(col);
  [zMin - 0.15, zMax + 0.15].forEach(z => { const cap = new THREE.Mesh(new THREE.CircleGeometry(0.055, 24, Math.PI, Math.PI), MT.pvcGrey); cap.position.set(xc, yc, z); world.add(cap); });
  const colWater = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, colLen - 0.02), MT.water); colWater.position.set(xc, yc - 0.043, (zMin + zMax) / 2); world.add(colWater);
  world.add(tube([[xc, yc - 0.05, 0], [xc, 0.5, 0], [xc + 0.02, 0.3, 0.02]], 0.022, MT.pvc));
  [zMin + 0.1, zMax - 0.1].forEach(z => { world.add(box(0.012, 0.09, 0.012, MT.galv, xc - 0.06, yc + 0.02, z)); world.add(box(0.07, 0.01, 0.012, MT.galv, xc - 0.03, yc - 0.024, z)); });
  // return flow particles: along the collector towards the drop pipe, then down
  [[zMin - 0.05, 1], [zMax + 0.05, -1]].forEach(([z0]) => { const c = new THREE.CatmullRomCurve3([new THREE.Vector3(xc, yc - 0.038, z0), new THREE.Vector3(xc, yc - 0.042, 0), new THREE.Vector3(xc, yc - 0.1, 0), new THREE.Vector3(xc + 0.02, 0.36, 0.02)]); const fa = new FlowAlong(c, { count: 50, speed: 0.25, size: 0.013, color: 0xa8e6ff, jitter: 0.012 }); world.add(fa.points); flows.push({ f: fa, kind: 'return' }); });
  // ---- supply: pump → over the rim → floor main (behind) → riser at the inlet end → manifold → feed tubes
  const zb = zMin - 0.36, xm = x0 - 0.12, ym = yIn + 0.14;
  const pumpOut = pump.localToWorld(pump.outlet.clone());
  const supplyPts = [pumpOut, new THREE.Vector3(pumpOut.x, 0.55, pumpOut.z), new THREE.Vector3(pumpOut.x - 0.05, 0.7, zb + 0.1), new THREE.Vector3(pumpOut.x - 0.25, 0.3, zb), new THREE.Vector3(pumpOut.x - 0.4, 0.07, zb), new THREE.Vector3(xm + 0.3, 0.07, zb), new THREE.Vector3(xm, 0.08, zb), new THREE.Vector3(xm, ym - 0.1, zb), new THREE.Vector3(xm, ym, zb + 0.08)];
  const main = tube(supplyPts, 0.016, MT.tubeBlack, { tension: 0.02, segments: 260 }); world.add(main);
  const valve = makeBallValve({ r: 0.02 }); valve.rotation.z = Math.PI / 2; valve.position.set(xm, 0.75, zb); world.add(valve);
  const manLen = zMax - zMin + 0.5;
  const man = cyl(0.02, 0.02, manLen, MT.pvc, 20, xm, ym, (zMin + zMax) / 2 - 0.07); man.rotation.x = Math.PI / 2; world.add(man);
  [zMin - 0.32, zMax + 0.18].forEach(z => world.add(cyl(0.023, 0.023, 0.03, MT.pvcGrey, 20, xm, ym, z).rotateX(Math.PI / 2)));
  const fsupply = new FlowAlong(main.curve, { count: 140, speed: 0.3, size: 0.014, color: 0x8fdcff, jitter: 0.006 }); world.add(fsupply.points); flows.push({ f: fsupply, kind: 'supply' });
  for (let j = 0; j < ng; j++) {
    const gu = g.gullies[j]; const inl = gu.localToWorld(new THREE.Vector3(0.035, 0.058, 0));
    const pts = [new THREE.Vector3(xm, ym - 0.018, zOf(j)), new THREE.Vector3(xm + 0.01, ym - 0.06, zOf(j)), new THREE.Vector3((xm + inl.x) / 2, inl.y + 0.05, zOf(j)), new THREE.Vector3(inl.x, inl.y + 0.02, zOf(j)), new THREE.Vector3(inl.x + 0.005, inl.y - 0.04, zOf(j))];
    const ft = tube(pts, 0.004, MT.tubeBlack, { segments: 40 }); world.add(ft);
    const iv = makeBallValve({ r: 0.006 }); iv.position.copy(ft.curve.getPointAt(0.3)); iv.lookAt(ft.curve.getPointAt(0.34)); iv.rotateY(Math.PI / 2); world.add(iv);
    const ff = new FlowAlong(ft.curve, { count: 14, speed: 0.25, size: 0.01, color: 0x8fdcff, jitter: 0.002 }); world.add(ff.points); flows.push({ f: ff, kind: 'feed', j });
  }
  // ---- labels (few, so that the overview stays readable)
  g.lab = {
    inlet: label(g.gullies[ng - 1], '', [0.35, 0.3, 0.12], 'label3d', 7),
    outlet: label(g.gullies[ng - 1], '', [Lg - 0.2, 0.26, 0.12], 'label3d', 14),
    manifold: label([xm, ym + 0.12, zMin - 0.3], 'Feed manifold<small>one valve per gully</small>', [0, 0, 0], 'label3d', 5),
    tank: label([xr, 0.86, zMax + 0.25], '', [0, 0, 0], 'label3d', 5),
    film: label(g.gullies[ng - 1], '', [Math.min(Lg * 0.5, 3.2), 0.1, 0.1], 'label3d', 9)
  };
  // ---- Venlo greenhouse (3.2 m spans) around the installation, which sits in the middle span
  if (gh) { scene.remove(gh); disposeDeep(gh); }
  const ghL = Math.max(12, Math.ceil((Lg + 5) / 4) * 4);
  gh = makeGreenhouse({ spans: 3, spanWidth: 3.2, length: ghL, gutterHeight: 3.4, roofAngle: 22, bays: Math.round(ghL / 4), heatingPipes: false, glassOpacity: 0.06 });
  gh.rotation.y = Math.PI / 2; gh.position.set(x0 + Lg / 2 + 0.3, 0, 0); gh.setVents(0.35); scene.add(gh);
  gh.traverse(m => { if (m.isMesh && m.material.transparent) m.castShadow = false; });
  const cx = x0 + Lg / 2 + 0.3;
  sky.sun.target.position.set(cx, 0, 0); sky.sun.shadow.camera.left = -Math.max(9, Lg / 2 + 3); sky.sun.shadow.camera.right = Math.max(9, Lg / 2 + 3); sky.sun.shadow.camera.updateProjectionMatrix();
  geo = g;
  // camera home for this length
  const home = views().home; stage.setHome(home[0], home[1]);
  return g;
}
function views() {
  const g = geo; const x0 = g.x0, Lg = g.Lg;
  const zf = g.zOf(g.ng - 1);
  const floorAt = xl => g.yIn - xl * Math.sin(-g.ang);
  const xc = Math.min(Lg * 0.3, 2.5);
  return {
    home: [[x0 - 0.8 - Math.min(1.6, Lg * 0.05), g.yIn + 0.95 + Math.min(0.9, Lg * 0.03), 1.45], [x0 + Math.min(Lg * 0.42, 4.2), 0.72, -0.2]],
    inlet: [[x0 - 0.75, g.yIn + 0.5, zf + 0.85], [x0 + 0.35, g.yIn - 0.05, zf - 0.1]],
    outlet: [[x0 + Lg + 1.25, 1.35, 1.45], [x0 + Lg - 0.1, Y_OUT - 0.1, 0]],
    cut: [[x0 + xc + 0.32, floorAt(xc) + 0.36, zf + 0.5], [x0 + xc - 0.08, floorAt(xc) + 0.01, zf - 0.01]],
    map: [[x0 - 0.9, Math.min(3.0, g.yIn + 1.7), 1.0], [x0 + Math.min(Lg * 0.4, 4.5), 0.75, -0.1]]
  };
}
function fly(name) { if (!geo) return; const v = views()[name]; stage.flyTo(v[0], v[1], 1.4); }
/* test hook: jump the camera without animation */
window.__labView = name => { const v = views()[name]; stage.flyTo(v[0], v[1], 0.001); stage.camera.position.set(...v[0]); stage.controls.target.set(...v[1]); stage.controls.update(); };

/* ================================================================== simulation state */
let sim = null, lastGeoKey = '', lastSimKey = '';
function params(v = ui.values()) {
  return { slope: v.slope / 100, length: v.len, width: v.wid / 100, spacing: v.sp / 100, nGully: v.ng, Q: v.flow / 60000, imbalance: v.imb / 100, doIn: v.doIn, nIn: v.nIn, kIn: v.kIn, tIn: v.tIn, tAir: v.tAir, sun: v.sun, ew: v.ew, ell: v.ell, days: 24 };
}
function recompute() {
  const v = ui.values(); const p = params(v);
  const n = Math.max(1, Math.floor(p.length / p.spacing + 1e-9));
  const gk = [v.slope, v.len, v.sp, v.wid, v.ng].join('|');
  if (gk !== lastGeoKey) { build(v, n); lastGeoKey = gk; }
  const sk = JSON.stringify(p);
  if (sk !== lastSimKey) { sim = simulate(p); lastSimKey = sk; scheduleFilmChart(); }
  // sun position follows the radiation setting (visual only)
  const el = Math.round(12 + 58 * Math.min(1, v.sun / 850)); if (el !== lastSun) { sky.setSun(el, 205); lastSun = el; }
  lastChart = -1; show(ui.get('day'));
}
let lastSun = 34, lastChart = -1;

/* ------------------------------------------------------------------ colour maps for the film */
const COLS = {
  do: { cm: 'rdylgn', lo: 0, hi: 10, label: 'Dissolved O₂ (mg L⁻¹)', val: (pr, i) => pr.C[i], ticks: [0, 5, 10] },
  temp: { cm: 'thermal', lo: 15, hi: 35, label: 'Solution temperature (°C)', val: (pr, i) => pr.T[i], ticks: [15, 25, 35] },
  no3: { cm: 'viridis', lo: 80, hi: 110, label: 'NO₃-N (% of inlet)', val: (pr, i, p) => 100 * pr.N[i] / p.nIn, ticks: [80, 95, 110] },
  k: { cm: 'viridis', lo: 80, hi: 110, label: 'K (% of inlet)', val: (pr, i, p) => 100 * pr.K[i] / p.kIn, ticks: [80, 95, 110] },
  f: { cm: 'rdylgn', lo: 0, hi: 1, label: 'Growth factor f (–)', val: null, ticks: [0, 0.5, 1] }
};
/** Temperature scale adapted to the current profiles (at least 4 K wide); the other maps keep fixed scales. */
function tempRange(S0) {
  let a = Infinity, b = -Infinity; S0.ch.forEach(ch => ch.prof.T.forEach(v => { a = Math.min(a, v); b = Math.max(b, v); }));
  let lo = Math.floor(a - 0.5), hi = Math.ceil(b + 0.5); if (hi - lo < 4) { const m = (hi + lo) / 2; lo = Math.floor(m - 2); hi = lo + 4; }
  COLS.temp.lo = lo; COLS.temp.hi = hi; COLS.temp.ticks = [lo, fmt((lo + hi) / 2, 1), hi];
}
function paintFilm(fx, prof, plants, p, key, L) {
  const C = COLS[key]; const img = fx.ctx.createImageData(256, 2);
  for (let k = 0; k < 256; k++) {
    const x = (k + 0.5) / 256 * L; let v;
    if (key === 'f') { const i = Math.min(plants.length - 1, Math.floor(x / p.spacing)); v = plants[i].f; }
    else { let j = 0; while (j < prof.x.length - 2 && prof.x[j + 1] < x) j++; const t = Math.min(1, Math.max(0, (x - prof.x[j]) / ((prof.x[j + 1] - prof.x[j]) || 1))); v = C.val(prof, j, p) * (1 - t) + C.val(prof, j + 1, p) * t; }
    const c = colormap(C.cm, (v - C.lo) / (C.hi - C.lo));
    for (const r of [0, 1]) { const q = (r * 256 + k) * 4; img.data[q] = c[0]; img.data[q + 1] = c[1]; img.data[q + 2] = c[2]; img.data[q + 3] = 255; }
  }
  fx.ctx.putImageData(img, 0, 0); fx.tex.needsUpdate = true;
}

/* ------------------------------------------------------------------ show a day */
const LIMCOL = { none: 'accent', oxygen: 'water', temperature: 'amber', nitrogen: 'magenta', potassium: 'c4' };
function show(day) {
  if (!sim || !geo) return;
  const d0 = Math.min(sim.snaps.length - 1, Math.floor(day)), d1 = Math.min(sim.snaps.length - 1, d0 + 1), t = day - d0;
  const S0 = sim.snaps[d0], S1 = sim.snaps[d1], p = sim.p, v = ui.values();
  const massAt = (j, i) => { const a = S0.mass[sim.idx(j)][i], b = S1.mass[sim.idx(j)][i]; return a + (b - a) * t; };
  const n = sim.n, ng = sim.ng;
  if (v.col === 'temp') tempRange(S0);
  // --- 3D: plants, roots, films
  for (let j = 0; j < ng; j++) {
    const ch = S0.ch[sim.idx(j)]; const lets = geo.lettuce[j]; const cnt = [0, 0]; let rc = 0;
    for (let i = 0; i < n; i++) {
      const m = massAt(j, i); const k = (i * 7 + j * 3) % 2; const sc = headScale(m) * (0.96 + ((i * 13 + j * 5) % 9) * 0.01);
      tmpQ.setFromAxisAngle(UP, (i * 2.1 + j * 0.7) % 6.28); tmpS.set(sc, sc, sc); tmpP.set((i + 0.5) * geo.s, 0.056, 0);
      tmpM.compose(tmpP, tmpQ, tmpS); const im = lets[k]; im.setMatrixAt(cnt[k], tmpM);
      const pl = ch.plant[i]; const def = 1 - pl.f;
      stressTint(tmpC, { nDef: pl.limiter === 'nitrogen' || pl.limiter === 'potassium' ? def * 1.2 : 0, hypoxia: pl.limiter === 'oxygen' ? def * 1.3 : 0, heat: pl.limiter === 'temperature' ? def * 1.4 : 0 });
      im.setColorAt(cnt[k], tmpC); cnt[k]++;
      if (j === ng - 1 && geo.roots) {
        const rs = Math.max(0.15, Math.cbrt(m / 150));
        const brown = Math.max(0, Math.min(1, (4 - pl.C) / 3)) * 0.55 + Math.max(0, Math.min(1, (pl.T - 25) / 6)) * 0.35;
        tmpC.setRGB(1 - 0.35 * brown, 1 - 0.5 * brown, 1 - 0.75 * brown);
        if (i % geo.rootStride === 0) { tmpS.set(rs, Math.min(1, rs * 1.2), Math.min(1.3, rs * 1.1)); tmpQ.identity(); tmpP.set((i + 0.5) * geo.s, 0.0045, 0); tmpM.compose(tmpP, tmpQ, tmpS); geo.roots.setMatrixAt(rc, tmpM); geo.roots.setColorAt(rc, tmpC); rc++; }
        // flat fibrous mat lying in the film, reaching downstream towards the next plant
        const ml = Math.min(1.35, 0.25 + 1.2 * Math.cbrt(m / 150)) * geo.s, mw = geo.W * Math.min(0.92, 0.35 + 0.6 * Math.cbrt(m / 150));
        tmpQ.identity(); tmpS.set(ml, 1, mw); tmpP.set((i + 0.5) * geo.s - 0.01, 0.0035 + 0.0004 + 0.0018, 0); tmpM.compose(tmpP, tmpQ, tmpS); geo.mats.setMatrixAt(i, tmpM); geo.mats.setColorAt(i, tmpC);
      }
    }
    lets.forEach((im, k) => { im.count = cnt[k]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; });
    if (j === ng - 1 && geo.roots) { geo.roots.count = rc; geo.roots.instanceMatrix.needsUpdate = true; geo.roots.instanceColor.needsUpdate = true; geo.mats.count = n; geo.mats.instanceMatrix.needsUpdate = true; geo.mats.instanceColor.needsUpdate = true; }
    // film depth and colour
    const fl = film(sim.Qs[j], p.width, p.slope, p.tIn);
    geo.gullies[j].setFilm(fl.h);
    paintFilm(geo.films[j], ch.prof, ch.plant, p, v.col, geo.Lg);
    const fa = flows.find(o => o.kind === 'film' && o.j === j); if (fa) fa.f.speed = fl.us;
    flows.filter(o => o.kind === 'feed' && o.j === j).forEach(o => o.f.speed = Math.min(0.6, 0.12 + sim.Qs[j] * 60000 * 0.12));
  }
  const Qtot = sim.Qs.reduce((a, b) => a + b, 0) * 60000;
  flows.filter(o => o.kind === 'supply').forEach(o => o.f.speed = Math.min(1.2, 0.08 + Qtot * 0.05));
  flows.filter(o => o.kind === 'return').forEach(o => o.f.speed = Math.min(0.8, 0.06 + Qtot * 0.04));
  if (bubbles) bubbles.setRate(6 + 4 * Math.max(0, p.doIn - 5));
  // view mode
  const map = v.view === 'map';
  geo.gullies.forEach((gu, j) => {
    const fm = gu.film.material; gu.lid.visible = !map;
    if (fm.userData.map !== map) { fm.userData.map = map; fm.color.set(map ? 0x000000 : 0xffffff); fm.emissiveIntensity = map ? 1.0 : 0.3; fm.toneMapped = !map; fm.opacity = map ? 1 : 0.9; fm.needsUpdate = true; }
  });
  geo.lettuce.forEach(a => a.forEach(im => im.visible = !map)); geo.pots.forEach(a => a.forEach(im => im.visible = !map)); if (geo.roots) { geo.roots.visible = !map; geo.mats.visible = !map; }
  // --- readouts (worst-fed gully = last)
  const jw = ng - 1, chw = S0.ch[sim.idx(jw)], plw = chw.plant;
  const f0 = film(sim.Qs[jw], p.width, p.slope, p.tIn);
  ro.set('h', f0.h * 1000, f0.h * 1000 >= 0.8 && f0.h * 1000 <= 3 ? 'ok' : 'warn', f0.h * 1000 < 0.8 ? 'very thin: risk of dry patches' : f0.h * 1000 > 3 ? 'deep film: roots less aerated' : 'within 1–3 mm');
  ro.set('u', f0.u, null, `Re<sub>f</sub> = ${fmt(f0.Re, 0)} · ${f0.Re < 20 ? 'smooth laminar' : f0.Re < 1500 ? 'laminar with ripples' : 'turbulent'}`);
  const tres = chw.L / f0.u;
  ro.set('tres', tres < 120 ? `${fmt(tres, 0)}<small>s</small>` : `${fmt(tres / 60, 1)}<small>min</small>`, null, `ū = ${fmt(f0.u * 100, 1)} cm s⁻¹ over ${fmt(chw.L, 1)} m`);
  const doOut = chw.out.C;
  ro.set('doOut', doOut, doOut >= 4 ? 'ok' : doOut >= 3 ? 'warn' : 'bad', doOut >= 4 ? '≥ 4 mg L⁻¹ (Cornell guideline)' : doOut >= 3 ? 'below 4: growth inhibited' : '< 3: visible stress, crop failure risk');
  ro.set('tOut', chw.out.T, chw.out.T <= 25 ? 'ok' : chw.out.T <= 28 ? 'warn' : 'bad', `inlet ${fmt(p.tIn, 1)} °C · Cornell: ≤ 25 °C`);
  ro.set('nOut', chw.out.N, chw.out.N > 20 ? 'ok' : chw.out.N > 5 ? 'warn' : 'bad', `${fmt(100 * chw.out.N / p.nIn - 100, 1)} % vs inlet`);
  ro.set('kOut', chw.out.K, chw.out.K > 20 ? 'ok' : chw.out.K > 5 ? 'warn' : 'bad', `${fmt(100 * chw.out.K / p.kIn - 100, 1)} % vs inlet`);
  let sum = 0, cntAll = 0; for (let j = 0; j < ng; j++) for (let i = 0; i < n; i++) { sum += massAt(j, i); cntAll++; }
  const mean = sum / cntAll, ref = sim.ref[d0] + (sim.ref[d1] - sim.ref[d0]) * t;
  ro.set('mass', mean, mean >= 0.93 * ref ? 'ok' : mean >= 0.8 * ref ? 'warn' : 'bad', `unstressed: ${fmt(ref, 0)} g · target 150 g at day 24`);
  const U = massAt(jw, n - 1) / massAt(jw, 0);
  ro.set('unif', U, U >= 0.9 ? 'ok' : U >= 0.75 ? 'warn' : 'bad', `worst gully: ${fmt(massAt(jw, n - 1), 0)} g vs ${fmt(massAt(jw, 0), 0)} g`);
  const o2In = sim.Qs[jw] * 1000 * 3600 * p.doIn;   // mg h⁻¹ carried in
  const o2Ratio = 100 * chw.tot.o2 / o2In;
  ro.set('o2', o2Ratio, o2Ratio < 60 ? 'ok' : o2Ratio < 100 ? 'warn' : 'bad', `${fmt(chw.tot.o2, 0)} of ${fmt(o2In, 0)} mg h⁻¹ — the rest must come from re-aeration`);
  ro.set('water', chw.tot.w, null, `${fmt(100 * chw.tot.w / (sim.Qs[jw] * 1000 * 86400), 2)} % of the gully flow`);
  ro.set('pump', Qtot, null, `${fmt(Qtot * 60, 0)} L h⁻¹ for ${ng} gullies`);
  // --- labels
  const lb = geo.lab; const col = v.col;
  lb.inlet.element.innerHTML = `Inlet<small>DO ${fmt(p.doIn, 1)} mg L⁻¹ · ${fmt(p.tIn, 1)} °C · ${fmt(sim.Qs[jw] * 60000, 2)} L min⁻¹</small>`;
  lb.outlet.element.innerHTML = `Outlet<small>DO ${fmt(doOut, 1)} mg L⁻¹ · ${fmt(chw.out.T, 1)} °C</small>`;
  lb.film.element.innerHTML = `Nutrient film<small>h = ${fmt(f0.h * 1000, 2)} mm · ū = ${fmt(f0.u, 2)} m s⁻¹</small>`;
  lb.tank.element.innerHTML = `Reservoir · aerated<small>DO ${fmt(p.doIn, 1)} mg L⁻¹ · C* ${fmt(csT(p.tIn), 1)} mg L⁻¹</small>`;
  labelLOD();
  if (probe) updateProbe();
  // --- HUD & legend
  hud.set('day', `Day <b>${fmt(day, 1)}</b> after transplanting · ${n} plants × ${ng} gullies`);
  hud.set('film', `Film <b>${fmt(f0.h * 1000, 2)} mm</b> · DO <b>${fmt(p.doIn, 1)} → ${fmt(doOut, 1)}</b> mg L⁻¹`);
  const C = COLS[col];
  legend.innerHTML = `${C.label}<div class="cbar" style="background:${colormapGradient(C.cm)}"></div><div class="cbar-ticks">${C.ticks.map(x => `<span>${x}</span>`).join('')}</div>`;
  if (Math.abs(day - lastChart) >= 0.25 || !clock.running) { drawCharts(S0, S1, t, day); lastChart = day; }
}

/* ------------------------------------------------------------------ probe (click the film / gully) */
stage.onPick({
  objects: () => geo ? geo.gullies.flatMap(g => [g.film, g.lid, g.body]).concat(geo.roots ? [geo.roots] : []).concat(geo.lettuce.flat()) : [],
  onClick: hit => {
    if (!hit || !geo) return;
    let o = hit.object; while (o && o.userData.j === undefined) o = o.parent;
    if (!o) return; const loc = o.worldToLocal(hit.point.clone());
    probeX = Math.max(0.02, Math.min(geo.Lg - 0.02, loc.x)); probeG = o.userData.j; updateProbe();
  }
});
function updateProbe() {
  if (probeX == null || !sim) return;
  const gu = geo.gullies[probeG]; if (!gu) return;
  if (!probe) { probe = makeProbe({ cap: 0xe0902a, tip: 'steel', length: 0.16, radius: 0.006 }); probeLabel = stage.addLabel(probe, '', { offset: [0, 0.24, 0], className: 'label3d lg' }); }
  if (probe.parent !== gu) gu.add(probe);
  probe.position.set(probeX, 0.004, -geo.W * 0.25);
  const day = ui.get('day'); const S = sim.snaps[Math.min(sim.snaps.length - 1, Math.floor(day))]; const ch = S.ch[sim.idx(probeG)]; const pr = ch.prof;
  let j = 0; while (j < pr.x.length - 2 && pr.x[j + 1] < probeX) j++;
  const t = Math.min(1, Math.max(0, (probeX - pr.x[j]) / ((pr.x[j + 1] - pr.x[j]) || 1)));
  const I = k => pr[k][j] * (1 - t) + pr[k][j + 1] * t;
  const i = Math.min(ch.plant.length - 1, Math.floor(probeX / geo.s)); const pl = ch.plant[i];
  probeLabel.element.innerHTML = `Probe at ${fmt(probeX, 2)} m · gully ${probeG + 1}<small>DO ${fmt(I('C'), 2)} mg L⁻¹ · ${fmt(I('T'), 1)} °C · NO₃-N ${fmt(I('N'), 1)} · K ${fmt(I('K'), 1)} mg L⁻¹<br>film ${fmt(I('h') * 1000, 2)} mm · plant f = ${fmt(pl.f, 2)} (${pl.limiter === 'none' ? 'no stress' : pl.limiter + '-limited'})</small>`;
}

/* ================================================================== charts */
const chProf = new Plot('#chart-profile', { x: { label: 'Distance from the inlet', unit: 'm', min: 0 }, y: { label: 'Dissolved O₂', unit: 'mg L⁻¹', min: 0 }, y2: { label: 'Nutrient', unit: '% of inlet', min: 0, max: 120 } });
const chTemp = new Plot('#chart-temp', { x: { label: 'Distance from the inlet', unit: 'm', min: 0 }, y: { label: 'Solution temperature', unit: '°C' }, y2: { label: 'Growth factor f', unit: '–', min: 0, max: 1.05 } });
const chFilm = new Plot('#chart-film', { x: { label: 'Flow per gully Q', unit: 'L min⁻¹', min: 0, max: 4 }, y: { label: 'Film thickness h', unit: 'mm', min: 0 }, y2: { label: 'Mean velocity ū', unit: 'm s⁻¹', min: 0 } });
const chMass = new Plot('#chart-mass', { x: { label: 'Plant position from the inlet', unit: 'm', min: 0 }, y: { label: 'Head fresh mass', unit: 'g', min: 0 } });
function drawCharts(S0, S1, t, day) {
  const p = sim.p, jw = sim.ng - 1, ch = S0.ch[sim.idx(jw)], pr = ch.prof;
  chProf.setAxis('x', { min: 0, max: ch.L });
  chProf.line('cs', pr.x, pr.Cs, { color: 'muted', dash: [5, 4], width: 1.6, label: 'Saturation C*(T)' });
  chProf.line('do', pr.x, pr.C, { color: 'water', width: 2.8, label: 'Dissolved O₂', fill: false });
  chProf.hline('crit', 4, { color: 'danger', dash: [4, 4], label: '4 mg L⁻¹ guideline' });
  chProf.line('n', pr.x, pr.N.map(v => 100 * v / p.nIn), { color: 'accent', width: 2, y2: true, label: 'NO₃-N (% of inlet)' });
  chProf.line('k', pr.x, pr.K.map(v => 100 * v / p.kIn), { color: 'magenta', width: 2, dash: [7, 3], y2: true, label: 'K (% of inlet)' });
  chTemp.setAxis('x', { min: 0, max: ch.L });
  const Tmin = Math.min(p.tIn, p.tAir, ...pr.T) - 1, Tmax = Math.max(p.tIn, p.tAir, ...pr.T) + 1;
  chTemp.setAxis('y', { min: Math.floor(Tmin), max: Math.ceil(Tmax) });
  chTemp.hregion('opt', 21, 24, { color: 'accent', alpha: 0.1, label: 'optimum 21–24 °C' });
  chTemp.line('T', pr.x, pr.T, { color: 'amber', width: 2.8, label: 'Solution temperature' });
  chTemp.hline('air', p.tAir, { color: 'muted', dash: [5, 4], label: `air ${fmt(p.tAir, 1)} °C` });
  chTemp.line('f', ch.plant.map(q => q.x), ch.plant.map(q => q.f), { color: 'water', width: 1.8, y2: true, step: true, label: 'Growth factor f' });
  // mass by position
  const xs = ch.plant.map(q => q.x);
  const ms = ch.plant.map((q, i) => { const a = S0.mass[sim.idx(jw)][i], b = S1.mass[sim.idx(jw)][i]; return a + (b - a) * t; });
  const ref = sim.ref[Math.min(sim.ref.length - 1, Math.floor(day))];
  chMass.setAxis('x', { min: 0, max: ch.L }); chMass.setAxis('y', { min: 0, max: Math.max(175, Math.ceil(Math.max(ref, ...ms) * 1.15 / 25) * 25) });
  if (Math.abs(ref - 150) < 12) { chMass.remove('ref'); chMass.hline('target', 150, { color: 'ink', dash: [2, 3], label: `market 150 g ≈ unstressed (${fmt(ref, 0)} g)` }); }
  else { chMass.hline('ref', ref, { color: 'muted', dash: [5, 4], label: `unstressed ${fmt(ref, 0)} g` }); chMass.hline('target', 150, { color: 'ink', dash: [2, 3], label: 'market 150 g' }); }
  ['none', 'oxygen', 'temperature', 'nitrogen', 'potassium'].forEach(k => {
    const X = [], Y = []; ch.plant.forEach((q, i) => { if (q.limiter === k) { X.push(xs[i]); Y.push(ms[i]); } });
    if (X.length) chMass.scatter('m-' + k, X, Y, { color: LIMCOL[k], r: 3.6, label: k === 'none' ? 'no stress' : k + '-limited' }); else chMass.remove('m-' + k);
  });
}
let filmT = null;
function scheduleFilmChart() {
  clearTimeout(filmT);
  filmT = setTimeout(() => {
    const v = ui.values(); const W = v.wid / 100, T = v.tIn; const Qs = linspace(0.05, 4, 80);
    [[1, 'c1', [4, 4]], [2.5, 'c0', [8, 4]], [5, 'c3', [2, 3]]].forEach(([sl, c, dash]) => chFilm.line('s' + sl, Qs, Qs.map(q => film(q / 60000, W, sl / 100, T).h * 1000), { color: c, width: 1.5, dash, label: `slope ${sl} %` }));
    chFilm.line('cur', Qs, Qs.map(q => film(q / 60000, W, v.slope / 100, T).h * 1000), { color: 'water', width: 2.8, label: `current ${fmt(v.slope, 1)} %` });
    chFilm.line('u', Qs, Qs.map(q => film(q / 60000, W, v.slope / 100, T).u), { color: 'magenta', width: 1.6, dash: [6, 3], y2: true, label: 'ū (current slope)' });
    const f = film(v.flow / 60000, W, v.slope / 100, T); chFilm.point('pt', v.flow, f.h * 1000, { color: 'water', r: 6, label: `${fmt(f.h * 1000, 2)} mm` });
    chFilm.hregion('band', 1, 3, { color: 'accent', alpha: 0.08, label: 'typical 1–3 mm' });
  }, 60);
}

/* ================================================================== clock and loop */
const clock = new SimClock({ speed: 1.6, onFrame: tday => { let d = tday; if (d >= 24) { d = 24; clock.pause(); } ui.set('day', d, true); show(d); } });
clock.onState(r => { playBtn.innerHTML = r ? '❚❚ Pause' : '▶ Grow the crop'; });
let raf = 0;
ui.onChange((s, id) => {
  if (id === 'day') { clock.pause(); show(s.day); return; }
  if (id === 'view') { fly(s.view === 'map' ? 'map' : 'home'); show(ui.get('day')); return; }
  if (['col', 'labels'].includes(id)) { show(ui.get('day')); return; }
  cancelAnimationFrame(raf); raf = requestAnimationFrame(recompute);
});
recompute();
{ const h = views().home; stage.camera.position.set(...h[0]); stage.controls.target.set(...h[1]); stage.controls.update(); }
stage.onKey('space', () => playBtn.click());
let lodT = 0;
stage.onFrame((dt, t) => {
  lodT += dt; if (lodT > 0.25) { lodT = 0; labelLOD(); }
  flows.forEach(o => o.f.update(dt));
  if (bubbles) bubbles.update(dt);
  if (geo) { geo.gullies.forEach(g => g.update(t)); if (geo.tank) { MT.waterSurfTex.offset.set(t * 0.02, t * 0.013); } }
});
