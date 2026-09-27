/* Soilless systems gallery — six hydroponic systems as real hardware in cut-away 3D,
   each driven by its quantitative model (models.js, Eqs. S1–S9). */
import { createStage, studioLights, THREE, makeGround, makeRaft, makeRoots, makeProbe, FlowAlong, Bubbles, canvasTexture, makeRockwoolCube } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, BarChart, linspace } from '/assets/js/plot.js';
import { SYS, NAMES, SHORT, HW, simulateGallery, dwcState, ebbLevel, wickCapacity, potentialMass } from './models.js';
import { film } from '/laboratories/nft-system/model.js';
import * as P from './parts.js';

const { mats, box, cyl, tube, makeGully, makeTote, makeSubmersiblePump, makeAirPump, makeAirStone, makeTimer, makePowerStrip, makeBallValve, makeSlab, makePot, makePlacard, lettuceLite, headScale, rootMatGeometry, rootMaterial, rootMatTexture, makeNetPotGroup, stressTint } = P;
const SYS_COL = { nft: '#2f8fb8', dwc: '#1f9e9a', ebb: '#b86e0b', drip: '#6a4fc2', wick: '#b23f8c', kratky: '#1d7a4a' };

/* ================================================================== controls */
const ui = new Controls('#controls', { url: true });
ui.segmented({ id: 'sys', label: 'System', options: [{ value: 'all', label: 'All six' }, { value: 'nft', label: 'NFT' }, { value: 'dwc', label: 'DWC' }, { value: 'ebb', label: 'Ebb & flow' }, { value: 'drip', label: 'Drip' }, { value: 'wick', label: 'Wick' }, { value: 'kratky', label: 'Kratky' }], value: 'all', help: 'Or click a system in the scene to fly to it' });
ui.section('Crop and climate');
ui.slider({ id: 'day', label: 'Days after transplanting', min: 0, max: 30, step: 0.1, value: 24, unit: 'd', digits: 1, persist: false });
const [playBtn] = ui.buttons([{ label: '▶ Grow the crop', variant: 'primary', onClick: () => { const d = ui.get('day'); if (!clock.running && d >= ui.get('days') - 0.05) { ui.set('day', 0, true); clock.reset(0); } else clock.reset(d); clock.toggle(); } }]);
ui.slider({ id: 'days', label: 'Harvest day', min: 18, max: 30, step: 1, value: 24, unit: 'd', help: 'Cornell schedule: 24 d after transplanting (35 d after seeding)' });
ui.slider({ id: 'ew', label: 'Crop water use', min: 1, max: 6, step: 0.1, value: 3.0, unit: 'L kg⁻¹ d⁻¹', help: 'Transpiration per kg of lettuce: ≈ 2 indoors, 3 greenhouse, 4–5 summer' });
ui.slider({ id: 'temp', label: 'Solution temperature', min: 14, max: 32, step: 0.5, value: 22, unit: '°C' });
const sec = {};
sec.nft = ui.section('NFT · 2 gullies × 1.2 m');
ui.slider({ id: 'nftQ', label: 'Flow per gully', min: 0.2, max: 3, step: 0.05, value: 1.0, unit: 'L min⁻¹' });
ui.slider({ id: 'nftSlope', label: 'Slope', min: 0.5, max: 5, step: 0.1, value: 2.5, unit: '%' });
sec.dwc = ui.section('Deep-water culture · 6 plants');
ui.slider({ id: 'dwcAir', label: 'Air flow of the air pump', min: 0, max: 6, step: 0.1, value: 2, unit: 'L min⁻¹' });
ui.slider({ id: 'dwcEff', label: 'O₂ transfer efficiency of the stones', min: 0.5, max: 5, step: 0.1, value: 2, unit: '%', help: '≈ 1–5 % in 15–30 cm deep tanks (Lesson 5.3)' });
ui.slider({ id: 'dwcDepth', label: 'Solution depth', min: 8, max: 25, step: 0.5, value: 20, unit: 'cm' });
sec.ebb = ui.section('Ebb-and-flow · 6 pots');
ui.slider({ id: 'ebbQ', label: 'Pump flow', min: 2, max: 20, step: 0.5, value: 8, unit: 'L min⁻¹' });
ui.slider({ id: 'ebbDepth', label: 'Flood depth (standpipe height)', min: 2, max: 7, step: 0.5, value: 4, unit: 'cm' });
ui.slider({ id: 'ebbDrain', label: 'Drain-back opening diameter', min: 8, max: 25, step: 1, value: 13, unit: 'mm' });
ui.slider({ id: 'ebbFloods', label: 'Floods per day (timer)', min: 1, max: 8, step: 1, value: 4 });
ui.slider({ id: 'ebbHold', label: 'Flood hold time', min: 0, max: 20, step: 1, value: 5, unit: 'min' });
sec.drip = ui.section('Drip on rock wool · 4 plants');
ui.slider({ id: 'dripQ', label: 'Emitter flow', min: 0.5, max: 4, step: 0.1, value: 2, unit: 'L h⁻¹' });
ui.slider({ id: 'dripPulses', label: 'Irrigation pulses per day', min: 1, max: 20, step: 1, value: 6 });
ui.slider({ id: 'dripMin', label: 'Pulse duration', min: 1, max: 10, step: 0.5, value: 3, unit: 'min' });
ui.segmented({ id: 'dripType', label: 'Emitter type', options: [{ value: 'pc', label: 'Pressure-compensating' }, { value: 'orifice', label: 'Orifice (x = 0.5)' }], value: 'pc' });
ui.slider({ id: 'dripDH', label: 'Pressure drop along the lateral', min: 0, max: 40, step: 1, value: 20, unit: '%' });
ui.toggle({ id: 'dripOpen', label: 'Open system (drain to waste)', value: true });
sec.wick = ui.section('Wick · 2 plants');
ui.slider({ id: 'wickN', label: 'Number of wicks', min: 1, max: 6, step: 1, value: 2 });
ui.slider({ id: 'wickD', label: 'Wick diameter', min: 4, max: 15, step: 0.5, value: 8, unit: 'mm' });
ui.slider({ id: 'wickKs', label: 'Wick saturated conductivity K_s', min: 1e-6, max: 3e-3, value: 1e-4, log: true, unit: 'm s⁻¹', format: v => v.toExponential(1), help: 'Fibreglass wicks: 6 × 10⁻⁴–4 × 10⁻³ (Knutson & Selker 1994); cotton rope: lower (assumed 10⁻⁴)' });
ui.slider({ id: 'wickHc', label: 'Capillary length h_c of the wick', min: 0.05, max: 0.5, step: 0.01, value: 0.15, unit: 'm', help: 'Measure it: the height water climbs up a hanging wick (Jurin, Eq. 5.1.1)' });
ui.slider({ id: 'wickFill', label: 'Initial reservoir depth', min: 5, max: 18, step: 0.5, value: 17, unit: 'cm' });
sec.kratky = ui.section('Kratky · 6 plants, 55 × 35 cm tote');
ui.slider({ id: 'kratFill', label: 'Initial solution depth', min: 6, max: 19, step: 0.5, value: 18.5, unit: 'cm', help: 'Lesson 5.1, Worked example 4: 18.5 cm = 36 L' });
ui.section('Energy, cost and comparison');
ui.slider({ id: 'pumpW', label: 'Water-pump power', min: 5, max: 60, step: 1, value: 20, unit: 'W', help: 'Small submersible pump (Lesson 5.4 example: 20 W)' });
ui.slider({ id: 'airW', label: 'Air-pump power', min: 1, max: 10, step: 0.5, value: 3, unit: 'W', help: 'Rated power of a small aquarium air pump' });
ui.slider({ id: 'price', label: 'Electricity price', min: 0.03, max: 0.5, step: 0.01, value: 0.15, unit: '€ kWh⁻¹' });
ui.toggle({ id: 'discard', label: 'Count solution discarded at harvest', value: true });
ui.select({ id: 'cmp', label: 'Compare the systems by', options: [{ value: 'water', label: 'Water use per kg of lettuce' }, { value: 'kwh', label: 'Electricity per kg' }, { value: 'cost', label: 'Electricity cost per kg' }, { value: 'power', label: 'Hours to damage after a power cut' }, { value: 'parts', label: 'Parts that can fail (complexity)' }, { value: 'mass', label: 'Head mass at harvest' }], value: 'water' });
ui.toggle({ id: 'labels', label: 'Component labels', value: true });
ui.presets([
  { label: 'Well designed', values: { ew: 3, temp: 22, nftQ: 1, nftSlope: 2.5, dwcAir: 2, dwcEff: 2, dwcDepth: 20, ebbQ: 8, ebbDepth: 4, ebbDrain: 13, ebbFloods: 4, ebbHold: 5, dripQ: 2, dripPulses: 6, dripMin: 3, dripType: 'pc', dripDH: 20, dripOpen: true, wickN: 4, wickD: 10, wickKs: 1e-4, wickHc: 0.15, wickFill: 17, kratFill: 18.5 } },
  { label: 'Indoor LED room', values: { ew: 2, temp: 21 } },
  { label: 'Hot summer', values: { ew: 5, temp: 27 } },
  { label: 'Under-designed', title: 'Thin wick, low air flow, too few floods and pulses, half-filled Kratky tote', values: { wickN: 1, wickD: 6, dwcAir: 0.3, ebbFloods: 2, dripPulses: 3, kratFill: 9, nftQ: 0.3 } }
]);
ui.saveButton('soilless-systems-3d', () => Object.assign({}, roAll.values(), ...Object.values(roSys).map(r => r.values())));

/* ------------------------------------------------------------------ readouts: overview + one set per system */
const roHost = document.getElementById('readouts');
const mkRO = key => { const d = document.createElement('div'); d.className = 'readouts'; d.style.margin = '0'; d.dataset.ro = key; roHost.appendChild(d); return new Readouts(d); };
roHost.style.margin = '16px 0';
const roAll = mkRO('all');
roAll.add({ id: 'mass', label: 'Unstressed head mass', unit: 'g', digits: 0 }).add({ id: 'E', label: 'Transpiration per head', unit: 'L d⁻¹', digits: 2 })
  .add({ id: 'nft', label: 'NFT · outlet dissolved O₂', unit: 'mg L⁻¹', digits: 1 }).add({ id: 'dwc', label: 'DWC · dissolved O₂', unit: 'mg L⁻¹', digits: 1 })
  .add({ id: 'ebb', label: 'Ebb & flow · water between floods', unit: '× need', digits: 2 }).add({ id: 'drip', label: 'Drip · drain fraction', unit: '%', digits: 0 })
  .add({ id: 'wick', label: 'Wick · supply ÷ demand', unit: '', digits: 2 }).add({ id: 'kratky', label: 'Kratky · solution left', unit: 'L', digits: 1 });
const roSys = {};
roSys.nft = mkRO('nft'); roSys.nft.add({ id: 'h', label: 'Film thickness', unit: 'mm', digits: 2 }).add({ id: 'u', label: 'Mean film velocity', unit: 'm s⁻¹', digits: 3 }).add({ id: 'tres', label: 'Residence time', unit: 's', digits: 0 }).add({ id: 'do', label: 'Outlet dissolved O₂', unit: 'mg L⁻¹', digits: 2 }).add({ id: 'fail', label: 'Time to damage if the pump stops', unit: 'h', digits: 1 }).add({ id: 'kwh', label: 'Pump electricity per kg', unit: 'kWh kg⁻¹', digits: 2 }).add({ id: 'wat', label: 'Water use per kg', unit: 'L kg⁻¹', digits: 0 });
roSys.dwc = mkRO('dwc'); roSys.dwc.add({ id: 'V', label: 'Solution per plant', unit: 'L', digits: 1 }).add({ id: 'kla', label: 'Aeration k_La', unit: 'h⁻¹', digits: 2 }).add({ id: 'our', label: 'Root O₂ uptake OUR', unit: 'mg L⁻¹ h⁻¹', digits: 2 }).add({ id: 'css', label: 'Steady-state dissolved O₂', unit: 'mg L⁻¹', digits: 2 }).add({ id: 'fail', label: 'Hours to 3 mg L⁻¹ if the air pump stops', unit: 'h', digits: 1 }).add({ id: 'kwh', label: 'Air-pump electricity per kg', unit: 'kWh kg⁻¹', digits: 2 }).add({ id: 'wat', label: 'Water use per kg', unit: 'L kg⁻¹', digits: 0 });
roSys.ebb = mkRO('ebb'); roSys.ebb.add({ id: 'fill', label: 'Fill time', unit: 'min', digits: 1 }).add({ id: 'drain', label: 'Drain time (Torricelli)', unit: 'min', digits: 1 }).add({ id: 'sub', label: 'Roots submerged per day', unit: 'h', digits: 2 }).add({ id: 'margin', label: 'Water stored ÷ used between floods', unit: '', digits: 2 }).add({ id: 'fail', label: 'Time to damage if the pump stops', unit: 'h', digits: 1 }).add({ id: 'kwh', label: 'Pump electricity per kg', unit: 'kWh kg⁻¹', digits: 2 }).add({ id: 'wat', label: 'Water use per kg', unit: 'L kg⁻¹', digits: 0 });
roSys.drip = mkRO('drip'); roSys.drip.add({ id: 'S', label: 'Supply per plant', unit: 'L d⁻¹', digits: 2 }).add({ id: 'DF', label: 'Drain fraction', unit: '%', digits: 0 }).add({ id: 'drainv', label: 'Drain per plant', unit: 'L d⁻¹', digits: 2 }).add({ id: 'n', label: 'Nitrogen to drain (open)', unit: 'mg plant⁻¹ d⁻¹', digits: 0 }).add({ id: 'last', label: 'Last ÷ first emitter flow', unit: '', digits: 2 }).add({ id: 'kwh', label: 'Pump electricity per kg', unit: 'kWh kg⁻¹', digits: 2 }).add({ id: 'wat', label: 'Water use per kg', unit: 'L kg⁻¹', digits: 0 });
roSys.wick = mkRO('wick'); roSys.wick.add({ id: 'cap', label: 'Wick capacity (Darcy)', unit: 'L d⁻¹', digits: 2 }).add({ id: 'need', label: 'Demand of both plants', unit: 'L d⁻¹', digits: 2 }).add({ id: 'ratio', label: 'Supply ÷ demand', unit: '', digits: 2 }).add({ id: 'Z', label: 'Lift above the water', unit: 'cm', digits: 1 }).add({ id: 'V', label: 'Water left in reservoir', unit: 'L', digits: 1 }).add({ id: 'mass', label: 'Head mass', unit: 'g', digits: 0 }).add({ id: 'wat', label: 'Water use per kg', unit: 'L kg⁻¹', digits: 0 });
roSys.kratky = mkRO('kratky'); roSys.kratky.add({ id: 'V', label: 'Solution left', unit: 'L', digits: 1 }).add({ id: 'drop', label: 'Level fall since planting', unit: 'cm', digits: 1 }).add({ id: 'gap', label: 'Air gap under the lid', unit: 'cm', digits: 1 }).add({ id: 'days', label: 'Days until the tote is empty', unit: 'd', digits: 0 }).add({ id: 'mass', label: 'Head mass', unit: 'g', digits: 0 }).add({ id: 'kwh', label: 'Electricity', unit: 'kWh', digits: 0 }).add({ id: 'wat', label: 'Water use per kg', unit: 'L kg⁻¹', digits: 0 });
const allRO = { all: roAll, ...roSys };

/* ================================================================== stage */
// two rows: taller systems at the back, low ones in front (metres)
const POS = { nft: [-2.35, -1.2], ebb: [0.05, -1.2], drip: [2.5, -1.2], dwc: [-2.15, 1.15], wick: [0.0, 1.15], kratky: [2.15, 1.15] };
const stage = createStage('#stage', {
  background: '#161d20', envIntensity: 0.5, exposure: 1.0,
  camera: { pos: [0.15, 3.35, 5.75], target: [0.1, 0.22, 0.05], fov: 40 },
  controls: { minDistance: 0.35, maxDistance: 16, maxPolarAngle: Math.PI * 0.49 },
  bloom: false, ao: { radius: 0.14, intensity: 0.85 }
});
const { scene } = stage;
const lights = studioLights(stage, { intensity: 1.0, shadowSize: 5.5, keyPos: [3.5, 8, 5] });
lights.key.shadow.mapSize.set(4096, 4096); lights.hemi.intensity = 0.75;
const floor = makeGround({ size: 40, type: 'epoxy' }); floor.material.color.set(0xa9b0ad); scene.add(floor);
{ const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 6), new THREE.MeshStandardMaterial({ color: 0x2f373b, roughness: 0.92 })); wall.position.set(0, 3, -2.75); wall.receiveShadow = true; scene.add(wall);
  const skirting = new THREE.Mesh(new THREE.BoxGeometry(40, 0.12, 0.02), new THREE.MeshStandardMaterial({ color: 0x1d2326, roughness: 0.6 })); skirting.position.set(0, 0.06, -2.74); scene.add(skirting); }
const hud = hudChips(stage.el);
const MT = mats();
const LETG = [0, 1, 2].map(s => lettuceLite({ radius: 0.12, leaves: 18, seed: 5 + s * 6, segU: 11, segV: 7 }));
const RL = 0.2, RB = 0.08;                   // generated lengths of the hanging and bushy root geometries (m)
const ROOT_HANG = [0, 1].map(s => makeRoots({ count: 18, length: RL, spread: 0.02, thickness: 0.0016, style: 'hanging', seed: 3 + s, laterals: 1 }).geometry);
const ROOT_BUSH = makeRoots({ count: 18, length: RB, spread: 0.028, thickness: 0.0011, style: 'hanging', seed: 9, laterals: 2 }).geometry;
const ROOT_MAT = rootMatGeometry({ seed: 4, length: 0.2, count: 14, yFloor: -0.0005 });
const rootMat = rootMaterial();
const matPlaneGeo = new THREE.PlaneGeometry(1, 1); matPlaneGeo.rotateX(-Math.PI / 2); matPlaneGeo.translate(0.5, 0, 0);
const matPlaneMat = new THREE.MeshStandardMaterial({ map: rootMatTexture(), transparent: true, alphaTest: 0.05, depthWrite: false, roughness: 0.8, side: THREE.DoubleSide });
const rubberMat = new THREE.MeshStandardMaterial({ color: 0x262b2e, roughness: 0.95 });

const stations = {}; const flows = []; const allLabels = [];
/** Station group at its floor position, with a rubber floor mat. */
function station(k, mw = 1.95, md = 1.2) { const g = new THREE.Group(); g.position.set(POS[k][0], 0, POS[k][1]); scene.add(g); const mat = new THREE.Mesh(new THREE.BoxGeometry(mw, 0.004, md), rubberMat); mat.position.y = 0.002; mat.receiveShadow = true; g.add(mat); g.updateMatrixWorld(true); return g; }
/** Label on an object, or at a local position inside a station group. */
function lab(sys, target, html, offset = [0, 0, 0], cls = 'label3d', parent = null) {
  if (Array.isArray(target) && parent) { const o = new THREE.Object3D(); o.position.set(...target); parent.add(o); target = o; }
  const l = stage.addLabel(target, html, { offset, className: cls }); l.userData.sys = sys; allLabels.push(l); return l;
}
function flow(sys, curve, opts, parent) { const f = new FlowAlong(curve, Object.assign({ count: 40, speed: 0.25, size: 0.011, color: 0x9fe3ff, jitter: 0.004, opacity: 0.9 }, opts)); f.userData = { sys }; (parent || scene).add(f.points); flows.push(f); return f; }
/** Point p given in object obj's frame, expressed in station g's frame. */
const loc = (g, obj, p) => { g.updateMatrixWorld(true); return g.worldToLocal(obj.localToWorld(p.clone())); };
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
function plant(parent, mat, pos, v, rot = 0) { const m = new THREE.Mesh(LETG[v % 3], mat); m.position.copy(pos); m.rotation.y = rot; m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }
function newLeafMat() { return P.sharedLeafMaterial().clone(); }
const focusOf = (k, cam, tgt) => [[POS[k][0] + cam[0], cam[1], POS[k][1] + cam[2]], [POS[k][0] + tgt[0], tgt[1], POS[k][1] + tgt[2]]];

/* ------------------------------------------------------------------ 1 · NFT */
function buildNFT() {
  const g = station('nft', 2.0, 1.1);
  const leaf = newLeafMat(); const plants = [], roots = [], mats2 = [];
  const tank = makeTote({ w: 0.5, d: 0.36, h: 0.3, cut: true, level: 0.2, mat: MT.toteBlack }); tank.position.set(0.5, 0, 0.02); g.add(tank);
  const pump = makeSubmersiblePump(); pump.position.set(0.12, tank.floorY, -0.06); pump.rotation.y = Math.PI; tank.add(pump);
  const gullies = []; const zs = [-0.1, 0.1]; const L = 1.2, x0 = -0.72; const holes = Array.from({ length: 6 }, (_, i) => 0.1 + i * 0.2);
  zs.forEach((z, j) => {
    const cut = j === 1; const gu = makeGully({ length: L, width: 0.1, height: 0.05, holes, cut, clearLid: cut });
    gu.position.set(x0, 0.45, z); g.add(gu); gullies.push(gu);
    holes.forEach((x, i) => {
      const np = makeNetPotGroup(); np.position.set(x, 0.053, 0); gu.add(np);
      plants.push(plant(gu, leaf, V3(x, 0.056, 0), i + j * 2, i * 1.3 + j));
      if (cut) { const r = new THREE.Mesh(ROOT_MAT, rootMat); r.position.set(x, 0.0045, 0); r.castShadow = true; gu.add(r); roots.push(r); const mp = new THREE.Mesh(matPlaneGeo, matPlaneMat); mp.position.set(x - 0.01, 0.0058, 0); mp.renderOrder = 3; gu.add(mp); mats2.push(mp); }
    });
  });
  [-0.6, 0.12].forEach(x => { g.add(box(0.03, 0.03, 0.34, MT.galv, x, 0.43, 0)); [-0.16, 0.16].forEach(z => { g.add(box(0.03, 0.43, 0.03, MT.galv, x, 0.215, z)); g.add(box(0.08, 0.006, 0.08, MT.galv, x, 0.009, z)); }); });
  const po = loc(g, pump, pump.outlet);
  const sup = tube([po, V3(po.x, 0.33, po.z), V3(po.x - 0.02, 0.38, -0.22), V3(po.x - 0.2, 0.2, -0.26), V3(-0.5, 0.12, -0.27), V3(-0.82, 0.14, -0.26), V3(-0.82, 0.56, -0.2), V3(-0.8, 0.58, -0.14)], 0.007, MT.tubeBlack, { segments: 180 }); g.add(sup);
  const man = cyl(0.012, 0.012, 0.3, MT.pvc, 16, -0.8, 0.58, 0); man.rotation.x = Math.PI / 2; g.add(man);
  const valve = makeBallValve({ r: 0.01 }); valve.rotation.y = Math.PI / 2; valve.position.set(-0.82, 0.4, -0.26); g.add(valve);
  const fs = flow('nft', sup.curve, { count: 70, speed: 0.35 }, g);
  const feeds = zs.map(z => { const t = tube([[-0.8, 0.57, z], [-0.76, 0.56, z], [-0.7, 0.53, z]], 0.004, MT.tubeBlack); g.add(t); return flow('nft', t.curve, { count: 8, speed: 0.2, size: 0.009 }, g); });
  const films = gullies.map(gu => flow('nft', new THREE.LineCurve3(loc(g, gu, V3(0.02, 0.0062, 0)), loc(g, gu, V3(L - 0.02, 0.0062, 0))), { count: 36, speed: 0.15, size: 0.009, jitter: 0.05, color: 0xd6f5ff }, g));
  films.forEach(f => f.off.forEach(o => { o.y = Math.abs(o.y) * 0.03; }));
  gullies.forEach(gu => { const a = loc(g, gu, V3(L + 0.05, 0.012, 0)); flow('nft', new THREE.LineCurve3(a, V3(a.x + 0.01, 0.21, a.z)), { count: 10, speed: 0.6, size: 0.01 }, g); });
  const labels = [
    lab('nft', gullies[1], '', [0.45, 0.3, 0.1]),
    lab('nft', [0.5, 0.42, 0.25], 'Reservoir 40 L<small>submersible pump inside</small>', [0, 0, 0], 'label3d', g),
    lab('nft', [-0.82, 0.72, -0.1], 'Feed manifold', [0, 0, 0], 'label3d', g),
    lab('nft', gullies[1], 'Clear lid · cut-away front<small>root mat lying in the film</small>', [0.9, 0.12, 0.08])
  ];
  const st = { key: 'nft', g, focus: focusOf('nft', [-0.3, 1.3, 1.65], [-0.1, 0.38, 0]), leaf, plants, gullies, labels };
  st.update = (S, D) => {
    const s = S.nft; const sc = headScale(s.m);
    plants.forEach((m, i) => m.scale.setScalar(sc * (0.97 + (i % 3) * 0.02)));
    const rs = Math.cbrt(Math.max(0.2, s.m) / 150); roots.forEach(r => r.scale.set(rs, Math.min(1, rs * 1.2), Math.min(1.2, rs * 1.1)));
    mats2.forEach(mp => mp.scale.set(Math.min(1.35, 0.25 + 1.2 * rs) * 0.2, 1, 0.1 * Math.min(0.92, 0.35 + 0.6 * rs)));
    stressTint(leaf.color, { hypoxia: 1 - s.f });
    const fl = film(D.p.nftQ / 60000, 0.1, D.p.nftSlope / 100, D.p.temp);
    gullies.forEach(gu => gu.setFilm(fl.h));
    films.forEach(f => f.speed = fl.us); fs.speed = 0.1 + D.p.nftQ * 0.25; feeds.forEach(f => f.speed = 0.08 + D.p.nftQ * 0.12);
    labels[0].element.innerHTML = `Gully · slope 1:${fmt(100 / D.p.nftSlope, 0)}<small>film ${fmt(fl.h * 1000, 2)} mm · DO out ${fmt(s.Cout, 1)} mg L⁻¹</small>`;
  };
  st.anim = (dt, t) => gullies.forEach(gu => gu.update(t));
  return st;
}

/* ------------------------------------------------------------------ 2 · DWC */
function buildDWC() {
  const g = station('dwc', 1.6, 1.0);
  const leaf = newLeafMat(); const plants = [], roots = [];
  const tank = makeTote({ w: 0.62, d: 0.42, h: 0.28, cut: true, level: 0.2, mat: MT.toteBlue, wall: 0.008 }); tank.position.set(-0.08, 0, 0); g.add(tank);
  const raft = makeRaft({ w: 0.585, d: 0.385, thickness: 0.03, nx: 3, nz: 2, holeR: 0.028 }); tank.add(raft);
  raft.holes.forEach((hp, i) => { const np = makeNetPotGroup(); np.position.set(hp.x, 0.033, hp.z); raft.add(np); plants.push(plant(raft, leaf, V3(hp.x, 0.036, hp.z), i, i * 1.7)); const r = new THREE.Mesh(ROOT_HANG[i % 2], rootMat); r.position.set(hp.x, -0.018, hp.z); r.castShadow = true; raft.add(r); roots.push(r); });
  [-0.15, 0.12].forEach(x => { const s = makeAirStone({ length: 0.09 }); s.position.set(x, 0.009, 0.02); tank.add(s); });
  const bub = new Bubbles({ emitters: [[-0.19, 0.03, 0.02], [-0.15, 0.03, 0.02], [-0.11, 0.03, 0.02], [0.08, 0.03, 0.02], [0.12, 0.03, 0.02], [0.16, 0.03, 0.02]], top: 0.2, rate: 12, size: 0.0035, spread: 0.035, speed: 0.28 });
  tank.add(bub.mesh);
  const air = makeAirPump(); air.position.set(0.44, 0, 0.22); air.rotation.y = -0.3; g.add(air);
  const ao = loc(g, air, air.outlet); const tp = -0.08;
  const line = tube([ao, V3(ao.x + 0.05, 0.08, ao.z), V3(0.3, 0.33, 0.12), V3(0.2, 0.32, 0.05), V3(0.18, 0.05, 0.03), V3(tp + 0.02, 0.022, 0.02), V3(tp - 0.2, 0.022, 0.02)], 0.0028, MT.silicone, { segments: 160 });
  g.add(line);
  const chk = cyl(0.006, 0.006, 0.03, new THREE.MeshPhysicalMaterial({ color: 0x3a78c9, roughness: 0.3, clearcoat: 0.5 }), 12); chk.position.copy(line.curve.getPointAt(0.18)); g.add(chk);
  const fa = flow('dwc', line.curve, { count: 40, speed: 0.5, size: 0.008, color: 0xffffff }, g);
  const probe = makeProbe({ cap: 0x2f6fd6, tip: 'steel', length: 0.2 }); probe.position.set(0.22, 0.12, -0.14); tank.add(probe);
  const labels = [lab('dwc', raft, 'Floating raft (EPS foam)', [-0.1, 0.2, 0.2]), lab('dwc', probe, '', [0, 0.3, 0]), lab('dwc', air, 'Air pump · check valve', [0, 0.15, 0]), lab('dwc', [-0.1, 0.08, 0.26], 'Air stones → bubbles', [0, 0, 0], 'label3d', g)];
  const st = { key: 'dwc', g, focus: focusOf('dwc', [0.2, 0.95, 1.15], [-0.05, 0.2, 0]), leaf, plants, labels, tank, raft, bub };
  st.update = (S, D) => {
    const s = S.dwc; const lvl = D.p.dwcDepth / 100; tank.setLevel(lvl); raft.position.y = tank.floorY + lvl - 0.012; bub.top = lvl + tank.floorY - 0.015;
    const sc = headScale(s.m); plants.forEach((m, i) => m.scale.setScalar(sc * (0.97 + (i % 3) * 0.02)));
    const gr = Math.cbrt(Math.max(0.2, s.m) / 150); const rl = Math.min(lvl - 0.02, 0.03 + 0.2 * gr); roots.forEach(r => r.scale.set(0.6 + 0.5 * gr, rl / RL, 0.6 + 0.5 * gr));
    stressTint(leaf.color, { hypoxia: 1 - s.f });
    bub.setRate(D.p.dwcAir * 6); fa.speed = 0.1 + D.p.dwcAir * 0.25; fa.points.visible = D.p.dwcAir > 0.05;
    labels[1].element.innerHTML = `DO probe<small>${fmt(s.Css, 1)} mg L⁻¹ · k<sub>L</sub>a ${fmt(s.kla, 2)} h⁻¹</small>`;
  };
  st.anim = dt => bub.update(dt);
  return st;
}

/* ------------------------------------------------------------------ 3 · Ebb-and-flow */
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function buildEbb() {
  const g = station('ebb', 1.6, 1.1);
  const leaf = newLeafMat(); const plants = [];
  const TY = 0.62;
  [[-0.44, -0.29], [0.44, -0.29], [-0.44, 0.29], [0.44, 0.29]].forEach(([x, z]) => { g.add(box(0.035, TY, 0.035, MT.galv, x, TY / 2, z)); g.add(box(0.07, 0.006, 0.07, MT.galv, x, 0.009, z)); });
  [-0.29, 0.29].forEach(z => g.add(box(0.92, 0.035, 0.035, MT.galv, 0, TY - 0.02, z)));
  [-0.44, 0.44].forEach(x => g.add(box(0.035, 0.035, 0.6, MT.galv, x, TY - 0.02, 0)));
  const tray = makeTote({ w: 0.9, d: 0.6, h: 0.09, cut: false, level: 0.0, mat: MT.black, wall: 0.006, lip: 0.02 }); tray.position.y = TY; g.add(tray);
  for (let i = -3; i <= 3; i++) g.add(box(0.86, 0.004, 0.012, MT.black, 0, TY + 0.008, i * 0.07));
  [[-0.2, -0.12], [0.02, -0.12], [0.24, -0.12], [-0.2, 0.13], [0.02, 0.13], [0.24, 0.13]].forEach(([x, z], i) => { const p = makePot({ size: 0.09, h: 0.08 }); p.position.set(x, TY + 0.006, z); g.add(p); plants.push(plant(g, leaf, V3(x, TY + 0.08, z), i + 1, i * 2.1)); });
  const fitX = -0.36, fitZ = -0.17;
  g.add(cyl(0.02, 0.022, 0.02, MT.pvcGrey, 18, fitX, TY + 0.016, fitZ));
  const stand = cyl(0.012, 0.012, 0.04, MT.pvc, 16, fitX + 0.05, TY + 0.026, fitZ + 0.06); g.add(stand);
  const tank = makeTote({ w: 0.55, d: 0.4, h: 0.3, cut: true, level: 0.17, mat: MT.toteBlack }); tank.position.set(-0.08, 0, 0); g.add(tank);
  const pump = makeSubmersiblePump(); pump.position.set(-0.18, tank.floorY, -0.08); pump.rotation.y = Math.PI; tank.add(pump);
  const po = loc(g, pump, pump.outlet);
  const fillT = tube([po, V3(po.x, 0.36, po.z), V3(fitX, 0.5, fitZ), V3(fitX, TY + 0.01, fitZ)], 0.007, MT.tubeBlack, { segments: 100 }); g.add(fillT);
  const ovT = tube([[fitX + 0.05, TY + 0.005, fitZ + 0.06], [fitX + 0.05, 0.45, fitZ + 0.06], [-0.3, 0.2, fitZ + 0.1]], 0.009, MT.pvc, { segments: 60 }); g.add(ovT);
  const fFill = flow('ebb', fillT.curve, { count: 50, speed: 0.4 }, g);
  const fOv = flow('ebb', ovT.curve, { count: 22, speed: 0.4 }, g);
  const strip = makePowerStrip(); strip.position.set(0.5, 0.006, 0.36); g.add(strip);
  const timer = makeTimer(); timer.position.set(0.44, 0.046, 0.36); g.add(timer);
  g.add(tube([[0.44, 0.066, 0.33], [0.3, 0.02, 0.25], [-0.15, 0.02, 0.25], [-0.24, 0.12, 0.06]], 0.003, MT.tubeBlack));
  const labels = [lab('ebb', [0.1, TY + 0.27, 0.32], 'Flood tray', [0, 0, 0], 'label3d', g), lab('ebb', [fitX + 0.05, TY + 0.13, fitZ + 0.06], 'Overflow standpipe<small>sets the flood depth</small>', [0, 0, 0], 'label3d', g), lab('ebb', timer, 'Timer', [0, 0.16, 0]), lab('ebb', [-0.08, 0.36, 0.24], 'Reservoir 30 L · pump', [0, 0, 0], 'label3d', g), lab('ebb', [0.36, TY + 0.02, 0.36], '', [0, 0, 0], 'label3d', g)];
  const st = { key: 'ebb', g, focus: focusOf('ebb', [0.25, 1.4, 1.35], [-0.05, 0.55, 0]), leaf, plants, labels, tray, stand };
  st.update = (S, D) => { const s = S.ebb; const sc = headScale(s.m); plants.forEach((m, i) => m.scale.setScalar(sc * (0.97 + (i % 3) * 0.02))); stressTint(leaf.color, { heat: 1 - s.f }); stand.scale.y = D.p.ebbDepth / 4; stand.position.y = TY + 0.006 + 0.02 * D.p.ebbDepth / 4; st.s = s; };
  st.anim = (dt, t, hydT) => {
    const s = st.s; if (!s) return;
    const cyc = s.tFill + s.tHold + s.tDrain + 180; const tau = hydT % cyc; const lvl = ebbLevel(s, tau);
    tray.setLevel(lvl); tray.water.visible = tray.surface.visible = lvl > 0.0008;
    const filling = tau < s.tFill, holding = tau >= s.tFill && tau < s.tFill + s.tHold, draining = tau >= s.tFill + s.tHold && tau < s.tFill + s.tHold + s.tDrain;
    fFill.points.visible = filling || holding || draining; fFill.speed = filling || holding ? 0.45 : -0.3; fOv.points.visible = holding;
    st.phaseText = filling ? `filling ${mmss(tau)} / ${mmss(s.tFill)}` : holding ? `flooded, overflow running ${mmss(tau - s.tFill)} / ${mmss(s.tHold)}` : draining ? `draining back through the pump ${mmss(tau - s.tFill - s.tHold)} / ${mmss(s.tDrain)}` : `drained — next flood in ${fmt(s.interval, 1)} h`;
    labels[4].element.innerHTML = `Water in tray<small>${fmt(lvl * 100, 1)} cm · ${st.phaseText.split(' ')[0]}</small>`;
  };
  return st;
}

/* ------------------------------------------------------------------ 4 · Drip on rock-wool slabs */
let _bucketMat = null; function bucketMat() { if (!_bucketMat) _bucketMat = new THREE.MeshPhysicalMaterial({ color: 0xf4f7f8, roughness: 0.15, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 }); return _bucketMat; }
function buildDrip() {
  const g = station('drip', 2.1, 1.0);
  const leaf = newLeafMat(); const plants = [], roots = [];
  const GY = 0.32, BT = GY + 0.004 + 0.075 + 0.065;              // gutter height; block top
  const gut = new THREE.Group(); gut.position.set(0.05, GY, 0); g.add(gut);
  gut.add(box(1.25, 0.004, 0.24, MT.pvc, 0, 0.002, 0)); gut.add(box(1.25, 0.06, 0.004, MT.pvc, 0, 0.03, -0.12)); gut.add(box(1.25, 0.06, 0.004, MT.pvc, 0, 0.03, 0.12));
  [-0.45, 0.45].forEach(x => { g.add(box(0.03, GY, 0.03, MT.galv, x + 0.05, GY / 2, 0)); g.add(box(0.03, 0.03, 0.3, MT.galv, x + 0.05, GY - 0.015, 0)); g.add(box(0.2, 0.006, 0.08, MT.galv, x + 0.05, 0.009, 0)); });
  const slab = makeSlab({ L: 1.0, W: 0.15, H: 0.075, cutFront: true }); slab.position.set(0.02, 0.004, 0); gut.add(slab);
  const drainWater = box(0.22, 0.004, 0.2, MT.water, 0.6, 0.006, 0); gut.add(drainWater);
  const XB = [-0.36, -0.12, 0.12, 0.36];
  XB.forEach((x, i) => { const b = makeRockwoolCube({ size: 0.1, height: 0.065 }); b.position.set(x + 0.02, 0.004 + 0.075 + 0.0325, 0); gut.add(b); plants.push(plant(gut, leaf, V3(x + 0.02, 0.004 + 0.075 + 0.065, 0), i + 2, i * 1.9)); const r = new THREE.Mesh(ROOT_HANG[i % 2], rootMat); r.position.set(x + 0.02, 0.004 + 0.074, 0.02); r.scale.set(1.3, 0.3, 1.3); gut.add(r); roots.push(r); });
  const tank = makeTote({ w: 0.36, d: 0.3, h: 0.3, cut: true, level: 0.2, mat: MT.toteBlack }); tank.position.set(-0.78, 0, -0.05); g.add(tank);
  const pump = makeSubmersiblePump(); pump.position.set(0, tank.floorY, 0); tank.add(pump);
  const po = loc(g, pump, pump.outlet); const ly = BT + 0.12, lz = -0.075;
  const mainT = tube([po, V3(po.x, 0.34, po.z), V3(po.x + 0.12, 0.36, -0.1), V3(-0.5, ly, lz), V3(0.55, ly, lz)], 0.008, MT.tubeBlack, { segments: 140 }); g.add(mainT);
  const filt = cyl(0.03, 0.03, 0.09, new THREE.MeshPhysicalMaterial({ color: 0x2a6ab8, roughness: 0.35, clearcoat: 0.5 }), 20); filt.position.copy(mainT.curve.getPointAt(0.3)); g.add(filt);
  const fMain = flow('drip', mainT.curve, { count: 60, speed: 0.4 }, g);
  const drops = [], emitters = [];
  XB.forEach((x, i) => {
    const ex = 0.05 + x + 0.02;
    const e = cyl(0.011, 0.011, 0.012, new THREE.MeshPhysicalMaterial({ color: 0x2d2f32, roughness: 0.4 }), 16); e.rotation.x = Math.PI / 2; e.position.set(ex - 0.04, ly, lz + 0.012); g.add(e); emitters.push(e);
    g.add(tube([[ex - 0.04, ly, lz + 0.02], [ex - 0.02, ly + 0.01, lz + 0.05], [ex, BT + 0.05, 0.03], [ex, BT + 0.02, 0.02]], 0.0022, MT.tubeBlack, { segments: 30 }));
    const stake = cyl(0.004, 0.002, 0.07, new THREE.MeshStandardMaterial({ color: 0x1d1f21, roughness: 0.5 }), 10); stake.position.set(ex, BT, 0.02); stake.rotation.x = 0.25; g.add(stake);
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 12, 10), MT.water); d.userData = { x: ex, y0: BT + 0.018, z: 0.03 }; d.visible = false; g.add(d); drops.push(d);
  });
  const drainT = tube([[0.68, GY + 0.004, 0], [0.72, GY - 0.05, 0], [0.78, 0.25, 0.05]], 0.012, MT.pvc); g.add(drainT);
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.24, 28, 1, true), bucketMat()); bucket.position.set(0.8, 0.126, 0.08); g.add(bucket);
  const bw = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.09, 1, 24), MT.water); bw.position.set(0.8, 0.05, 0.08); g.add(bw);
  const fDrain = flow('drip', drainT.curve, { count: 14, speed: 0.25 }, g);
  const labels = [lab('drip', emitters[3], 'PC emitter + drip stake', [0.02, 0.07, 0]), lab('drip', [-0.3, GY + 0.05, 0.17], 'Rock-wool slab (film-wrapped)', [0, 0, 0], 'label3d', g), lab('drip', bucket, '', [0, 0.2, 0]), lab('drip', [-0.78, 0.42, 0.14], 'Stock tank · pump · disc filter', [0, 0, 0], 'label3d', g)];
  const st = { key: 'drip', g, focus: focusOf('drip', [0.25, 1.1, 1.3], [0.0, 0.4, 0]), leaf, plants, labels, drops, fMain };
  st.update = (S, D) => {
    const s = S.drip; st.s = s; st.p = D.p; const sc = headScale(s.m); plants.forEach((m, i) => m.scale.setScalar(sc * (0.97 + (i % 3) * 0.02))); stressTint(leaf.color, { heat: 1 - s.f });
    roots.forEach(r => r.scale.set(1.3, Math.min(0.07, 0.015 + 0.055 * Math.cbrt(s.m / 150)) / RL, 1.3));
    labels[2].element.innerHTML = `Drain ${D.p.dripOpen ? 'to waste' : 'reused'}<small>DF ${fmt(s.DF * 100, 0)} % · ${fmt(s.drain, 2)} L plant⁻¹ d⁻¹</small>`;
    const lvl = Math.min(0.2, 0.01 + s.DF * 0.3); bw.scale.y = lvl; bw.position.y = 0.012 + lvl / 2; drainWater.visible = s.DF > 0.01; fDrain.points.visible = s.DF > 0.01;
  };
  st.anim = (dt, t, hydT) => {
    const s = st.s; if (!s) return; const pulse = st.p.dripMin * 60, cyc = pulse + 120; const tau = hydT % cyc; const on = tau < pulse;
    fMain.points.visible = on; st.phaseText = on ? `irrigation pulse ${mmss(tau)} / ${mmss(pulse)}` : `between pulses (every ${fmt(24 / st.p.dripPulses, 1)} h)`;
    drops.forEach((d, i) => { const q = st.p.dripQ * (i === 3 ? s.last : 1); const per = 0.9 / Math.max(0.3, q); const ph = ((t + i * 0.37) % per) / per; d.visible = on && ph < 0.6; d.position.set(d.userData.x, d.userData.y0 - ph / 0.6 * 0.03, d.userData.z); });
  };
  return st;
}

/* ------------------------------------------------------------------ 5 · Wick */
function buildWick() {
  const g = station('wick', 1.2, 0.9);
  const leaf = newLeafMat(); const plants = [], roots = [];
  const res = makeTote({ w: 0.42, d: 0.3, h: 0.2, cut: true, level: 0.16, mat: MT.toteWhite, wall: 0.006 }); g.add(res);
  const tray = new THREE.Group(); tray.position.y = 0.205; g.add(tray);
  tray.add(box(0.44, 0.006, 0.32, MT.toteGrey, 0, 0.003, 0)); tray.add(box(0.44, 0.12, 0.006, MT.toteGrey, 0, 0.06, -0.157)); tray.add(box(0.006, 0.12, 0.32, MT.toteGrey, -0.217, 0.06, 0)); tray.add(box(0.006, 0.12, 0.32, MT.toteGrey, 0.217, 0.06, 0));
  [[0.44, 0.006, 0.0014, 0, 0.003, 0.1607], [0.006, 0.12, 0.0014, -0.217, 0.06, 0.1607], [0.006, 0.12, 0.0014, 0.217, 0.06, 0.1607]].forEach(a => tray.add(box(a[0], a[1], a[2], MT.section, a[3], a[4], a[5])));
  tray.add(box(0.428, 0.1, 0.262, MT.coir, 0, 0.056, -0.021));      // substrate, cut back so the wicks on the section plane are visible
  [-0.1, 0.1].forEach((x, i) => { plants.push(plant(tray, leaf, V3(x, 0.106, 0.0), i + 3, i * 2)); const r = new THREE.Mesh(ROOT_HANG[i % 2], rootMat); r.position.set(x, 0.1, 0.05); r.scale.set(1, 0.4, 1); tray.add(r); roots.push(r); });
  const wickMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95 });
  const wickGroup = new THREE.Group(); g.add(wickGroup);
  const st = { key: 'wick', g, focus: focusOf('wick', [0.1, 0.82, 0.95], [0, 0.18, 0]), leaf, plants, res, wickFlows: [], nW: -1, dW: -1 };
  st.buildWicks = (n, dmm) => {
    wickGroup.children.slice().forEach(m => { wickGroup.remove(m); m.geometry.dispose(); });
    st.wickFlows.forEach(f => { f.points.parent && f.points.parent.remove(f.points); const i = flows.indexOf(f); if (i >= 0) flows.splice(i, 1); }); st.wickFlows = [];
    const xs = Array.from({ length: n }, (_, i) => -0.15 + (n === 1 ? 0.15 : i * 0.3 / (n - 1)));
    xs.forEach((x, i) => {
      const z = 0.118 - (i % 2) * 0.006;
      const pts = [[x, 0.012, z], [x + 0.005, 0.1, z], [x, 0.2, z], [x + 0.01, 0.235, z], [x + 0.05, 0.252, z], [x + 0.1, 0.258, z - 0.004]].map(a => V3(...a));
      const curve = new THREE.CatmullRomCurve3(pts); const geo = new THREE.TubeGeometry(curve, 48, dmm / 2000, 8, false);
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
      const m = new THREE.Mesh(geo, wickMat); m.castShadow = true; wickGroup.add(m);
      st.wickFlows.push(flow('wick', curve, { count: 10, speed: 0.01, size: 0.008, color: 0x8fdcff, jitter: 0.002 }, g));
    });
    st.nW = n; st.dW = dmm;
  };
  st.labels = [lab('wick', [-0.12, 0.34, 0.2], 'Capillary wick', [0, 0, 0], 'label3d', g), lab('wick', [0.13, 0.28, 0.2], 'Substrate (coir)', [0, 0, 0], 'label3d', g), lab('wick', [0, 0.08, 0.2], '', [0, 0, 0], 'label3d', g), lab('wick', [0.25, 0.44, 0], '', [0, 0, 0], 'label3d', g)];
  st.update = (S, D) => {
    const s = S.wick; if (st.nW !== D.p.wickN || st.dW !== D.p.wickD) st.buildWicks(D.p.wickN, D.p.wickD);
    res.setLevel(Math.max(0.001, s.level)); const sc = headScale(s.m); plants.forEach((m, i) => m.scale.setScalar(sc * (0.97 + i * 0.03)));
    stressTint(leaf.color, { heat: 1 - s.f }); roots.forEach(r => r.scale.set(0.8 + 0.4 * Math.cbrt(s.m / 150), (0.02 + 0.07 * Math.cbrt(s.m / 150)) / RL, 0.8));
    const wetTop = Math.min(1, s.margin); const lvlY = res.floorY + s.level;
    // wet cotton is dark grey-brown, dry cotton pale cream; the wet front climbs less far when the wick cannot keep up
    // (vertex colours are linear: dry ≈ sRGB #e8ddc3, wet ≈ sRGB #5a554f)
    wickGroup.children.forEach(m => { const pa = m.geometry.attributes.position, ca = m.geometry.attributes.color; for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); const u = Math.max(0, Math.min(1, (y - lvlY) / 0.26)); const wet = y < lvlY ? 1 : Math.max(0, 1 - u * (1.4 - wetTop)); ca.setXYZ(i, 0.80 - 0.70 * wet, 0.72 - 0.63 * wet, 0.55 - 0.47 * wet); } ca.needsUpdate = true; });
    st.wickFlows.forEach(f => f.speed = Math.min(0.04, 0.004 + 0.02 * Math.min(1, s.cap)));
    st.labels[2].element.innerHTML = `Reservoir<small>${fmt(s.V, 1)} L left</small>`;
    st.labels[3].element.innerHTML = `Supply ÷ demand ${fmt(s.margin, 2)}<small>capacity ${fmt(s.cap, 2)} · need ${fmt(s.need, 2)} L d⁻¹ · lift ${fmt(s.Z * 100, 1)} cm</small>`;
    st.labels[3].element.style.borderColor = s.margin >= 1 ? '' : '#e0564b';
  };
  return st;
}

/* ------------------------------------------------------------------ 6 · Kratky */
function buildKratky() {
  const g = station('kratky', 1.2, 0.9);
  const leaf = newLeafMat(); const plants = [], roots = [], bushes = [];
  const holes = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) holes.push([-0.18 + i * 0.18, -0.085 + j * 0.17]);
  const tank = makeTote({ w: 0.57, d: 0.37, h: 0.22, cut: true, level: 0.185, mat: MT.toteBlack, lid: true, lidHoles: holes, holeR: 0.027, lidMat: MT.lidWhite }); g.add(tank);
  holes.forEach(([x, z], i) => { const np = makeNetPotGroup(); np.position.set(x, 0.228, z); g.add(np); plants.push(plant(g, leaf, V3(x, 0.231, z), i + 1, i * 1.3));
    const r = new THREE.Mesh(ROOT_HANG[i % 2], rootMat); r.position.set(x, 0.18, z); r.castShadow = true; g.add(r); roots.push(r);
    const b = new THREE.Mesh(ROOT_BUSH, rootMat); b.position.set(x, 0.18, z); g.add(b); bushes.push(b); });
  const rt = canvasTexture(64, 512, (ctx, w, h) => { ctx.fillStyle = '#f1e8b8'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#222'; ctx.font = '600 22px Inter, Arial'; for (let cm = 0; cm <= 20; cm++) { const y = h - cm / 20 * h; ctx.fillRect(0, y - 1, cm % 5 ? 18 : 34, 2); if (cm % 5 === 0 && cm > 0 && cm < 20) ctx.fillText(String(cm), 36, y + 8); } }, { key: 'kratky-ruler' });
  const ruler = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.2), new THREE.MeshStandardMaterial({ map: rt, roughness: 0.6 })); ruler.position.set(0.24, 0.106, -0.176); g.add(ruler);
  const startMark = box(0.555, 0.002, 0.004, new THREE.MeshStandardMaterial({ color: 0x3aa0d8, emissive: 0x0a2a40 }), 0, 0.19, -0.178); g.add(startMark);
  const labels = [lab('kratky', [-0.28, 0.2, 0.21], '', [0, 0, 0], 'label3d', g), lab('kratky', [0.12, 0.05, 0.21], '', [0, 0, 0], 'label3d', g), lab('kratky', [0.3, 0.36, 0.05], 'No pump · no electricity', [0, 0, 0], 'label3d', g), lab('kratky', [0.33, 0.19, -0.16], 'start level', [0, 0, 0], 'label3d', g)];
  const st = { key: 'kratky', g, focus: focusOf('kratky', [0.05, 0.85, 1.05], [0, 0.16, 0]), leaf, plants, labels, tank };
  st.update = (S, D) => {
    const s = S.kratky; const lvl = Math.max(0.0015, s.level); tank.setLevel(lvl); const start = D.p.kratFill / 100; startMark.position.y = tank.floorY + start; labels[3].parent.position.y = tank.floorY + start;
    const sc = headScale(s.m); plants.forEach((m, i) => m.scale.setScalar(sc * (0.97 + (i % 3) * 0.02)));
    stressTint(leaf.color, { heat: s.f < 1 ? 0.9 : 0 });
    const top = 0.18, wy = tank.floorY + lvl; const gr = Math.cbrt(Math.max(0.3, s.m) / 150);
    const reach = Math.max(0.02, top - wy + 0.05 * gr + 0.01);
    roots.forEach(r => r.scale.set(0.6 + 0.5 * gr, Math.min(0.2, reach * Math.min(1, 0.3 + gr)) / RL, 0.6 + 0.5 * gr));
    const gap = top - wy; bushes.forEach(b => b.scale.set(0.7 + 0.7 * gr, Math.max(0.005, Math.min(gap * 0.85, 0.02 + 0.08 * gr)) / RB, 0.7 + 0.7 * gr));
    labels[0].element.innerHTML = `Air gap ${fmt(gap * 100, 1)} cm<small>“oxygen roots” in moist air</small>`;
    labels[1].element.innerHTML = `Solution ${fmt(s.V, 1)} L<small>water &amp; nutrient roots · level −${fmt((start - s.level) * 100, 1)} cm</small>`;
  };
  return st;
}

/* ------------------------------------------------------------------ build everything, placards and titles */
stations.nft = buildNFT(); stations.dwc = buildDWC(); stations.ebb = buildEbb(); stations.drip = buildDrip(); stations.wick = buildWick(); stations.kratky = buildKratky();
const SUBS = { nft: 'thin film in sloping gullies', dwc: 'floating raft on aerated solution', ebb: 'periodic flooding of pots', drip: 'emitters on stone-wool slabs', wick: 'passive capillary supply', kratky: 'passive, falling level' };
SYS.forEach(k => {
  const g = stations[k].g; const pl = makePlacard(SHORT[k], SUBS[k], { accent: SYS_COL[k] }); pl.position.set(0, 0.16, 0.62); g.add(pl);
  stations[k].title = lab('all', [0, k === 'ebb' ? 1.05 : 0.85, -0.05], `<span style="color:${SYS_COL[k]}">●</span> ${NAMES[k]}`, [0, 0, 0], 'label3d lg', g);
});

/* ================================================================== model state & display */
let D = null, lastKey = '';
function params() { const v = ui.values(); return Object.assign({}, v, { nConc: 125 }); }
function recompute() {
  const p = params(); const key = JSON.stringify(Object.assign({}, p, { day: 0, sys: 0, labels: 0, cmp: 0 }));
  if (key !== lastKey) { D = simulateGallery(p); lastKey = key; drawCompare(); drawMargins(); }
  if (ui.get('day') > p.days) ui.set('day', p.days, true);
  show(ui.get('day'));
}
function stateAt(day) {
  const out = D.out; const i = Math.max(0, Math.min(out.day.length - 1, Math.floor(day))); const j = Math.min(out.day.length - 1, i + 1); const t = Math.max(0, Math.min(1, day - i));
  const S = {}; SYS.forEach(k => { const a = out[k][i], b = out[k][j]; S[k] = Object.assign({}, a); for (const q in a) if (typeof a[q] === 'number' && typeof b[q] === 'number') S[k][q] = a[q] + (b[q] - a[q]) * t; });
  S.pot = out.pot[i] + (out.pot[j] - out.pot[i]) * t; return S;
}
const st3 = (v, ok, warn) => v >= ok ? 'ok' : v >= warn ? 'warn' : 'bad';
function show(day) {
  if (!D) return;
  const S = stateAt(day); const p = D.p; const M = D.metrics; const sys = ui.get('sys');
  SYS.forEach(k => stations[k].update(S, D));
  // overview readouts
  roAll.set('mass', S.pot, null, `day ${fmt(day, 1)} · 150 g at day 24 (Cornell)`);
  roAll.set('E', p.ew * S.pot / 1000, null, `${fmt(p.ew, 1)} L per kg per day`);
  roAll.set('nft', S.nft.Cout, st3(S.nft.Cout, 4, 3), `inlet ${fmt(S.nft.Cin, 1)} · film ${fmt(S.nft.h * 1000, 2)} mm`);
  roAll.set('dwc', S.dwc.Css, st3(S.dwc.Css, 4, 3), `k<sub>L</sub>a ${fmt(S.dwc.kla, 2)} h⁻¹`);
  roAll.set('ebb', S.ebb.margin, st3(S.ebb.margin, 1.2, 1), `${p.ebbFloods} floods per day`);
  roAll.set('drip', S.drip.DF * 100, S.drip.deficit > 0 ? 'bad' : S.drip.DF >= 0.1 && S.drip.DF <= 0.4 ? 'ok' : 'warn', S.drip.deficit > 0 ? `supply short by ${fmt(S.drip.deficit * 100, 0)} %` : 'target 10–40 %');
  roAll.set('wick', S.wick.margin, st3(S.wick.margin, 1.2, 1), `lift ${fmt(S.wick.Z * 100, 1)} cm`);
  roAll.set('kratky', S.kratky.V, st3(S.kratky.margin, 1.2, 1), `air gap ${fmt(S.kratky.airGap * 100, 1)} cm`);
  // per-system readouts
  const s = S;
  roSys.nft.set('h', s.nft.h * 1000, s.nft.h * 1000 >= 0.8 && s.nft.h * 1000 <= 3 ? 'ok' : 'warn'); roSys.nft.set('u', s.nft.u, null, `Re<sub>f</sub> ${fmt(s.nft.Re, 0)}`); roSys.nft.set('tres', s.nft.tres, null, '1.2 m gully');
  roSys.nft.set('do', s.nft.Cout, st3(s.nft.Cout, 4, 3), `C* ${fmt(s.nft.Cs, 2)} mg L⁻¹`);
  const hN = HW.nft.vAvail / Math.max(1e-9, s.nft.E / 24); roSys.nft.set('fail', hN, st3(hN, 12, 2), '40 mL per plant in film and root mat');
  roSys.nft.set('kwh', M.nft.kwhPerKg, null, `${fmt(M.nft.kwh, 1)} kWh per crop · ${fmt(M.nft.costPerKg, 2)} € kg⁻¹`); roSys.nft.set('wat', M.nft.waterPerKg, null, p.discard ? `incl. ${fmt(M.nft.discard, 0)} L discarded` : 'transpiration only');
  roSys.dwc.set('V', s.dwc.V / HW.dwc.plants, null, `${fmt(s.dwc.V, 0)} L in the tote`); roSys.dwc.set('kla', s.dwc.kla, null, `${fmt(p.dwcAir, 1)} L min⁻¹ at ${fmt(p.dwcEff, 1)} %`); roSys.dwc.set('our', s.dwc.OUR, null, `${fmt(s.dwc.R, 1)} mg h⁻¹ per plant`);
  roSys.dwc.set('css', s.dwc.Css, st3(s.dwc.Css, 4, 3), `C* ${fmt(s.dwc.Cs, 2)} mg L⁻¹`); roSys.dwc.set('fail', s.dwc.tFail, st3(s.dwc.tFail, 12, 3), 'Eqs. 5.1.8 and 5.3.5');
  roSys.dwc.set('kwh', M.dwc.kwhPerKg, null, `${fmt(M.dwc.kwh, 1)} kWh per crop`); roSys.dwc.set('wat', M.dwc.waterPerKg, null, p.discard ? `incl. ${fmt(M.dwc.discard, 0)} L discarded` : 'transpiration only');
  roSys.ebb.set('fill', s.ebb.tFill / 60, null, `${fmt(s.ebb.vFlood, 1)} L at ${fmt(p.ebbQ, 1)} L min⁻¹`); roSys.ebb.set('drain', s.ebb.tDrain / 60, s.ebb.tDrain / 60 <= 20 ? 'ok' : 'warn', `Ø ${p.ebbDrain} mm, C<sub>d</sub> 0.61`);
  roSys.ebb.set('sub', s.ebb.submerged, s.ebb.submerged <= 2 ? 'ok' : 'warn'); roSys.ebb.set('margin', s.ebb.margin, st3(s.ebb.margin, 1.2, 1), `${fmt(s.ebb.eaw * 1000, 0)} mL stored vs ${fmt(s.ebb.need * 1000, 0)} mL used`);
  const hE = HW.ebb.potL * HW.ebb.eawFrac / Math.max(1e-9, s.ebb.E / 24); roSys.ebb.set('fail', hE, st3(hE, 12, 4), 'easily available water in the pot'); roSys.ebb.set('kwh', M.ebb.kwhPerKg, null, `pump ${fmt(s.ebb.pumpH * 60, 0)} min d⁻¹`); roSys.ebb.set('wat', M.ebb.waterPerKg);
  roSys.drip.set('S', s.drip.S, null, `need ${fmt(s.drip.E, 2)} L d⁻¹`); roSys.drip.set('DF', s.drip.DF * 100, s.drip.deficit > 0 ? 'bad' : s.drip.DF >= 0.1 && s.drip.DF <= 0.4 ? 'ok' : 'warn', s.drip.deficit > 0 ? `deficit ${fmt(s.drip.deficit * 100, 0)} %` : 'Eq. 5.1.6'); roSys.drip.set('drainv', s.drip.drain);
  roSys.drip.set('n', s.drip.nLoss, p.dripOpen && s.drip.nLoss > 0 ? 'warn' : 'ok', p.dripOpen ? 'at 125 mg N L⁻¹' : 'closed: drain reused'); roSys.drip.set('last', s.drip.last, s.drip.last >= 0.9 ? 'ok' : 'warn', `emitter exponent x = ${s.drip.x}`);
  roSys.drip.set('kwh', M.drip.kwhPerKg, null, `pump ${fmt(s.drip.pumpH * 60, 0)} min d⁻¹`); roSys.drip.set('wat', M.drip.waterPerKg, null, p.dripOpen ? `incl. ${fmt(M.drip.drainTot * HW.drip.plants, 1)} L drained` : '');
  roSys.wick.set('cap', s.wick.cap, null, `${p.wickN} × Ø ${fmt(p.wickD, 1)} mm`); roSys.wick.set('need', s.wick.need); roSys.wick.set('ratio', s.wick.margin, st3(s.wick.margin, 1.2, 1));
  roSys.wick.set('Z', s.wick.Z * 100, s.wick.Z < 0.5 * p.wickHc ? 'ok' : 'warn', `h<sub>c</sub> = ${fmt(p.wickHc * 100, 0)} cm`); roSys.wick.set('V', s.wick.V); roSys.wick.set('mass', s.wick.m, st3(s.wick.m / S.pot, 0.93, 0.75), `unstressed ${fmt(S.pot, 0)} g`); roSys.wick.set('wat', M.wick.waterPerKg);
  const kd = daysLeft(); roSys.kratky.set('V', s.kratky.V, s.kratky.margin >= 1 ? 'ok' : 'bad'); roSys.kratky.set('drop', (p.kratFill / 100 - s.kratky.level) * 100, null, `from ${fmt(p.kratFill, 1)} cm`);
  roSys.kratky.set('gap', s.kratky.airGap * 100); roSys.kratky.set('days', kd, kd >= p.days ? 'ok' : 'bad', kd >= p.days ? 'lasts beyond harvest' : 'runs dry before harvest'); roSys.kratky.set('mass', s.kratky.m, s.kratky.m >= 0.93 * S.pot ? 'ok' : 'bad'); roSys.kratky.set('kwh', 0, 'ok', 'passive'); roSys.kratky.set('wat', M.kratky.waterPerKg, null, p.discard ? `incl. ${fmt(M.kratky.discard, 1)} L left over` : '');
  Object.entries(allRO).forEach(([k, r]) => { r.el.style.display = (sys === 'all' ? k === 'all' : k === sys) ? '' : 'none'; });
  labelVis();
  hud.set('day', `Day <b>${fmt(day, 1)}</b> after transplanting · head <b>${fmt(S.pot, 0)} g</b> (unstressed)`);
  drawDetail(S, day); markDay(day);
}
function daysLeft() { const o = D.out.kratky; for (let i = 0; i < o.length; i++) if (o[i].V <= 0.3) return D.out.day[i]; const last = o[o.length - 1]; const use = HW.kratky.plants * last.E; return D.out.day[o.length - 1] + last.V / Math.max(1e-6, use); }
function labelVis() { const on = ui.get('labels'), sys = ui.get('sys'); allLabels.forEach(l => { const k = l.userData.sys; l.visible = on && (k === 'all' ? sys === 'all' : sys === k); }); }

/* ================================================================== charts */
const cmpChart = new BarChart('#chart-compare', { y: { label: '', unit: '', min: 0 }, legend: false });
const CMP = {
  water: { label: 'Water use per kg of lettuce', axis: 'Water use', unit: 'L kg⁻¹', f: k => D.metrics[k].waterPerKg, fmt: 0 },
  kwh: { label: 'Pump electricity per kg', axis: 'Electricity', unit: 'kWh kg⁻¹', f: k => D.metrics[k].kwhPerKg, fmt: 2 },
  cost: { label: 'Electricity cost per kg', axis: 'Cost', unit: '€ kg⁻¹', f: k => D.metrics[k].costPerKg, fmt: 2 },
  power: { label: 'Hours to damage after a power cut (capped at 72 h)', axis: 'Time to damage', unit: 'h', f: k => Math.min(72, D.metrics[k].hoursPower), fmt: 1 },
  parts: { label: 'Parts that can fail', axis: 'Parts', unit: 'count', f: k => D.metrics[k].parts, fmt: 0 },
  mass: { label: 'Head fresh mass at harvest', axis: 'Head mass', unit: 'g', f: k => D.metrics[k].massEnd, fmt: 0 }
};
function drawCompare() {
  if (!D) return; const key = ui.get('cmp'), c = CMP[key];
  cmpChart.y.label = c.axis; cmpChart.y.unit = c.unit;
  cmpChart.set(SYS.map(k => SHORT[k]), [{ label: c.label, values: SYS.map(k => c.f(k)), colors: SYS.map(k => SYS_COL[k]), format: v => fmt(v, c.fmt) }]);
  if (key === 'mass') cmpChart.refLine(potentialMass(D.p.days), 'unstressed'); else if (key === 'power') cmpChart.refLine(12, 'overnight (12 h)'); else cmpChart.refLine(null);
  const extra = { water: 'Transpiration + drainage of open systems + (if selected) solution thrown away at harvest (Eq. 5.1.7).', power: 'Stored plant-available water ÷ transpiration, or stored oxygen ÷ uptake for DWC (Eq. 5.1.8).', parts: 'Pumps, timers, filters, emitters, air stones, feed tubes and wicks that can stop or clog.', kwh: 'Pumps only; a small pump running continuously dominates.', cost: `At ${fmt(D.p.price, 2)} € kWh⁻¹.`, mass: 'Compared with an unstressed head.' }[key] || '';
  document.getElementById('cmp-sub').textContent = `${c.label} at harvest (day ${D.p.days}) with the current settings. ${extra}`;
}
const mPlot = new Plot('#chart-margin', { x: { label: 'Days after transplanting', unit: 'd', min: 0 }, y: { label: 'Supply ÷ demand', unit: '–', log: true, min: 0.1, max: 20 } });
function drawMargins() {
  if (!D) return; const o = D.out;
  mPlot.setAxis('x', { min: 0, max: D.p.days });
  SYS.forEach(k => mPlot.line(k, o.day, o[k].map(s => Math.max(0.1, Math.min(20, s.margin))), { color: SYS_COL[k], width: ui.get('sys') === k ? 3.4 : 1.8, label: SHORT[k] }));
  mPlot.hline('one', 1, { color: 'danger', dash: [5, 4], label: 'supply = demand' });
}
function markDay(day) { mPlot.vline('now', day, { color: 'muted', dash: [2, 3] }); }
const dPlot = new Plot('#chart-detail', { x: { label: '' }, y: { label: '' } });
let detailKey = '';
const setAx = (ax, o) => Object.assign(ax, { min: 'auto', max: 'auto', log: false }, o);
function drawDetail(S, day) {
  const sys = ui.get('sys'), p = D.p; const h3 = document.getElementById('detail-title'), sub = document.getElementById('detail-sub');
  const key = sys + '|' + lastKey; const rebuild = key !== detailKey; detailKey = key;
  if (sys === 'all') {
    if (rebuild) { dPlot.clear(); setAx(dPlot.ax.x, { label: 'Days after transplanting', unit: 'd', min: 0, max: p.days }); setAx(dPlot.ax.y, { label: 'Head fresh mass', unit: 'g', min: 0 }); dPlot.ax.y2 = { min: 0, max: 'auto', label: 'Transpiration', unit: 'L d⁻¹', log: false };
      h3.textContent = 'The crop that every system must supply'; sub.textContent = 'Unstressed head mass (logistic, 150 g at day 24) and its transpiration (right axis). Water and oxygen demand grow with the plant — most failures happen in the last week.';
      dPlot.line('pot', D.out.day, D.out.pot, { color: 'accent', width: 2.8, label: 'head mass' }); dPlot.line('E', D.out.day, D.out.pot.map(m => p.ew * m / 1000), { color: 'water', width: 2, dash: [6, 4], y2: true, label: 'transpiration' }); }
    dPlot.vline('now', day, { color: 'muted', dash: [2, 3] }); return;
  }
  if (sys === 'nft') {
    if (rebuild) { h3.textContent = 'NFT: film thickness and residence time'; sub.textContent = 'Nusselt film thickness (left) and residence time in the 1.2 m gully (right) against flow per gully at the current slope and temperature (Eq. S1).';
      dPlot.clear(); setAx(dPlot.ax.x, { label: 'Flow per gully', unit: 'L min⁻¹', min: 0, max: 3 }); setAx(dPlot.ax.y, { label: 'Film thickness', unit: 'mm', min: 0 }); dPlot.ax.y2 = { min: 0, max: 'auto', label: 'Residence time', unit: 's', log: false };
      const qs = linspace(0.1, 3, 60); dPlot.line('h', qs, qs.map(q => film(q / 60000, 0.1, p.nftSlope / 100, p.temp).h * 1000), { color: 'water', width: 2.6, label: 'film thickness' }); dPlot.line('t', qs, qs.map(q => 1.2 / film(q / 60000, 0.1, p.nftSlope / 100, p.temp).u), { color: 'magenta', width: 2, dash: [6, 3], y2: true, label: 'residence time' }); dPlot.hregion('band', 1, 3, { color: 'accent', alpha: 0.08, label: '1–3 mm' }); }
    dPlot.point('pt', p.nftQ, S.nft.h * 1000, { color: 'water', r: 6, label: `${fmt(S.nft.h * 1000, 2)} mm` });
  } else if (sys === 'dwc') {
    h3.textContent = 'DWC: dissolved oxygen versus aeration'; sub.textContent = `Steady-state DO (Eq. S3) against the air flow for the crop on day ${fmt(day, 0)}, at the current temperature and 4 °C warmer; the dashed red line is the 4 mg L⁻¹ Cornell guideline.`;
    dPlot.clear(); setAx(dPlot.ax.x, { label: 'Air flow', unit: 'L min⁻¹', min: 0, max: 6 }); setAx(dPlot.ax.y, { label: 'Dissolved O₂', unit: 'mg L⁻¹', min: 0, max: 10 }); dPlot.ax.y2 = null;
    const qs = linspace(0.05, 6, 80); const m = S.dwc.m;
    dPlot.line('c', qs, qs.map(q => dwcState(Object.assign({}, p, { dwcAir: q }), m, p.temp).Css), { color: 'c1', width: 2.6, label: `${fmt(p.temp, 1)} °C` });
    dPlot.line('w', qs, qs.map(q => dwcState(Object.assign({}, p, { dwcAir: q }), m, p.temp + 4).Css), { color: 'amber', width: 2, dash: [6, 3], label: `${fmt(p.temp + 4, 1)} °C` });
    dPlot.hline('g', 4, { color: 'danger', dash: [4, 4], label: '4 mg L⁻¹' }); dPlot.point('pt', p.dwcAir, S.dwc.Css, { color: 'c1', r: 6 });
  } else if (sys === 'ebb') {
    if (rebuild || !dPlot.has('lv')) { h3.textContent = 'Ebb-and-flow: one flood event'; sub.textContent = 'Water depth in the tray during a flood: linear filling by the pump, hold while the overflow runs, then Torricelli drainage back through the pump (Eq. S4). The dot follows the animation.';
      dPlot.clear(); setAx(dPlot.ax.x, { label: 'Time since the timer switched on', unit: 'min', min: 0 }); setAx(dPlot.ax.y, { label: 'Water depth in tray', unit: 'cm', min: 0 }); dPlot.ax.y2 = null;
      const s = S.ebb; const T = s.tFill + s.tHold + s.tDrain; const ts = linspace(0, T * 1.05, 160); dPlot.line('lv', ts.map(t => t / 60), ts.map(t => ebbLevel(s, t) * 100), { color: 'c3', width: 2.6, label: 'depth' }); dPlot.hline('d', s.d * 100, { color: 'muted', dash: [4, 4], label: 'standpipe' }); }
  } else if (sys === 'drip') {
    if (rebuild) { h3.textContent = 'Drip: supply and demand through the crop'; sub.textContent = 'Daily supply per plant from the fixed irrigation schedule against the transpiration of the growing plant, and the resulting drain fraction (right axis). Where transpiration exceeds supply the slab dries out.';
      dPlot.clear(); setAx(dPlot.ax.x, { label: 'Days after transplanting', unit: 'd', min: 0, max: p.days }); setAx(dPlot.ax.y, { label: 'Water per plant', unit: 'L d⁻¹', min: 0 }); dPlot.ax.y2 = { min: 0, max: 100, label: 'Drain fraction', unit: '%', log: false };
      const o = D.out.drip; dPlot.line('S', D.out.day, o.map(s => s.S), { color: 'c4', width: 2.4, label: 'supply' }); dPlot.line('E', D.out.day, o.map(s => s.E), { color: 'water', width: 2.4, label: 'transpiration' }); dPlot.line('DF', D.out.day, o.map(s => s.DF * 100), { color: 'muted', dash: [5, 3], width: 1.6, y2: true, label: 'drain fraction' }); }
    dPlot.vline('now', day, { color: 'muted', dash: [2, 3] });
  } else if (sys === 'wick') {
    if (rebuild) { h3.textContent = 'Wick: capacity versus lift'; sub.textContent = 'Maximum water the wick set can deliver (Eq. S6: Darcy flow with exponential K(ψ)) against the lift from the water surface to the substrate, with the demand of both plants now (dotted) and at harvest (dashed).';
      dPlot.clear(); setAx(dPlot.ax.x, { label: 'Lift above the water surface', unit: 'cm', min: 0, max: 40 }); setAx(dPlot.ax.y, { label: 'Water supply', unit: 'L d⁻¹', min: 0 }); dPlot.ax.y2 = null;
      const zs = linspace(0.005, 0.4, 80); dPlot.line('cap', zs.map(z => z * 100), zs.map(z => wickCapacity(p, z)), { color: 'c2', width: 2.6, label: 'wick capacity' }); dPlot.hline('harv', HW.wick.plants * p.ew * potentialMass(p.days) / 1000, { color: 'danger', dash: [5, 4], label: 'demand at harvest' }); }
    const harv = HW.wick.plants * p.ew * potentialMass(p.days) / 1000;
    dPlot.hline('now', S.wick.need, { color: 'water', dash: [2, 3], label: Math.abs(S.wick.need - harv) > 0.15 * harv ? 'demand now' : '' }); dPlot.point('pt', S.wick.Z * 100, S.wick.cap, { color: 'c2', r: 6 });
  } else if (sys === 'kratky') {
    if (rebuild) { h3.textContent = 'Kratky: solution level through the crop'; sub.textContent = 'Solution depth in the tote as six plants transpire (Eq. S7), with the daily water use (right axis). The level only falls — it must never be raised above the oxygen roots (Kratky 2009).';
      dPlot.clear(); setAx(dPlot.ax.x, { label: 'Days after transplanting', unit: 'd', min: 0, max: p.days }); setAx(dPlot.ax.y, { label: 'Solution depth', unit: 'cm', min: 0, max: 20 }); dPlot.ax.y2 = { min: 0, max: 'auto', label: 'Water used per day', unit: 'L d⁻¹', log: false };
      const o = D.out.kratky; dPlot.line('lv', D.out.day, o.map(s => s.level * 100), { color: 'c0', width: 2.8, label: 'solution depth', fill: true }); dPlot.line('use', D.out.day, o.map(s => HW.kratky.plants * s.E * s.f), { color: 'water', width: 1.8, dash: [5, 3], y2: true, label: 'daily use' }); }
    dPlot.vline('now', day, { color: 'muted', dash: [2, 3] });
  }
}

/* ================================================================== selection, camera */
const HOME = [[0.15, 3.35, 5.75], [0.1, 0.22, 0.05]];
stage.setHome(HOME[0], HOME[1]);
const CTRL_IDS = { nft: ['nftQ', 'nftSlope'], dwc: ['dwcAir', 'dwcEff', 'dwcDepth'], ebb: ['ebbQ', 'ebbDepth', 'ebbDrain', 'ebbFloods', 'ebbHold'], drip: ['dripQ', 'dripPulses', 'dripMin', 'dripType', 'dripDH', 'dripOpen'], wick: ['wickN', 'wickD', 'wickKs', 'wickHc', 'wickFill'], kratky: ['kratFill'] };
function focusSys(k, instant = false) {
  const v = k === 'all' ? HOME : stations[k].focus;
  if (instant) { stage.flyTo(v[0], v[1], 0.001); stage.camera.position.set(...v[0]); stage.controls.target.set(...v[1]); stage.controls.update(); } else stage.flyTo(v[0], v[1], 1.3);
  Object.entries(CTRL_IDS).forEach(([q, list]) => { const on = k === 'all' || k === q; sec[q].style.display = on ? '' : 'none'; list.forEach(id => ui.show(id, on)); });
}
window.__labView = k => focusSys(k, true);
stage.onPick({
  objects: () => SYS.map(k => stations[k].g),
  onClick: hit => { if (!hit) return; let o = hit.object; while (o && !SYS.some(k => stations[k].g === o)) o = o.parent; if (!o) return; const k = SYS.find(q => stations[q].g === o); if (k && ui.get('sys') !== k) ui.set('sys', k); }
});

/* ================================================================== clock & loop */
const clock = new SimClock({ speed: 1.5, onFrame: t => { let d = t; const dm = ui.get('days'); if (d >= dm) { d = dm; clock.pause(); } ui.set('day', d, true); show(d); } });
clock.onState(r => { playBtn.innerHTML = r ? '❚❚ Pause' : '▶ Grow the crop'; });
let raf = 0;
ui.onChange((s, id) => {
  if (id === 'day') { clock.pause(); show(s.day); return; }
  if (id === 'sys') { focusSys(s.sys); drawMargins(); show(ui.get('day')); return; }
  if (id === 'labels') { labelVis(); return; }
  if (id === 'cmp') { drawCompare(); return; }
  cancelAnimationFrame(raf); raf = requestAnimationFrame(recompute);
});
recompute(); focusSys(ui.get('sys'), true);
stage.onKey('space', () => playBtn.click());
let hydT = 0;
stage.onFrame((dt, t) => {
  hydT += dt * 30;                                    // hydraulic animations at 30× real time
  flows.forEach(f => f.update(dt));
  SYS.forEach(k => stations[k].anim && stations[k].anim(dt, t, hydT));
  MT.waterSurfTex.offset.set(t * 0.02, t * 0.013);
  const sys = ui.get('sys');
  if (sys === 'ebb' && stations.ebb.phaseText) hud.set('phase', `Flood cycle (×30): <b>${stations.ebb.phaseText}</b>`);
  else if (sys === 'drip' && stations.drip.phaseText) hud.set('phase', `Drip (×30): <b>${stations.drip.phaseText}</b>`);
  else hud.remove('phase');
  if (sys === 'ebb' && D && dPlot.has('lv')) { const s = stations.ebb.s; if (s) { const cyc = s.tFill + s.tHold + s.tDrain + 180; const tau = hydT % cyc; if (tau <= s.tFill + s.tHold + s.tDrain) dPlot.point('pt', tau / 60, ebbLevel(s, tau) * 100, { color: 'c3', r: 6 }); } }
});
