/* ==========================================================================
   Growth-room experiment designer — 3D growth room with hidden gradients,
   four experimental designs, single runs with the correct ANOVA and Monte
   Carlo evaluation of bias, false-positive rate and power.
   Model and analyses: ./sim.js (Derive tab, Eqs. X1–X8); statistics: stats.js.
   ========================================================================== */
import { createStage, THREE, M, makeRoom, makeRack, makeLEDBar, leafGeometry, leafMaterial, BufferGeometryUtils, RoundedBoxGeometry, heatmapTexture, canvasTexture, FlowAlong, rng as lrng } from '/assets/js/lab3d.js';
import { Controls, Readouts, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, BarChart, linspace } from '/assets/js/plot.js';
import { palette, colormapGradient, colormapCSS, categorical, withAlpha } from '/assets/js/colors.js';
import * as S from '/assets/js/stats.js';
import * as SIM from './sim.js';
import { apaP, num, nlz, dfs } from './stats-extra.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const { GEOM, LEVELS, SLOTS, RACKS, TRT_COLORS } = SIM;
const B0 = 180;                                   // g, baseline fresh weight in an average position
const pFmt = v => (v == null || !isFinite(v)) ? '—' : v < 0.001 ? '< 0.001' : v.toFixed(3);
const sgn = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);

/* =====================================================================
   Controls and readouts
   ===================================================================== */
const ui = new Controls('#controls', { url: true });
ui.section('Treatments');
ui.segmented({ id: 'fac', label: 'Treatment factor', options: [{ value: 'spectrum', label: 'LED spectrum' }, { value: 'ec', label: 'Nutrient EC' }], value: 'spectrum', help: 'Spectrum: every tray has its own LED module in a light-tight compartment. EC: every tray has its own reservoir.' });
ui.slider({ id: 't', label: 'Number of treatments t', min: 2, max: 4, step: 1, value: 3 });
ui.slider({ id: 'delta', label: 'True effect of the best treatment', min: 0, max: 40, step: 1, value: 15, unit: '%', help: 'Increase in fresh weight over the control. 0 % = the null hypothesis is true.' });
ui.section('Replication');
ui.slider({ id: 'r', label: 'Replicate trays per treatment r', min: 2, max: 8, step: 1, value: 4, help: 'r trays per treatment fill r shelves (rack A top → bottom, then rack B). The pseudo-replicated design has one tray per treatment.' });
ui.segmented({ id: 'n', label: 'Plants per tray', options: [4, 6, 8, 12].map(v => ({ value: v, label: String(v) })), value: 6 });
ui.section('Layout');
ui.select({ id: 'design', label: 'Experimental design', options: SIM.DESIGN_KEYS.map(k => ({ value: k, label: SIM.DESIGNS[k].long })), value: 'rcbd' });
ui.buttons([{ label: '⟳ Re-randomise the layout', onClick: () => relayout(true) }]);
ui.section('Run the experiment');
const [bRun, bMC] = ui.buttons([{ label: '▶ Grow & harvest once', variant: 'primary', onClick: () => runOnce() }, { label: 'Run 1000 times', onClick: () => runMonteCarlo() }]);
ui.html('<div class="ctl-help" id="ed-mc-status">Monte Carlo: repeats the whole experiment 1000 times for every design (and 1000 times with no true effect) and sweeps the replication from 2 to 8.</div>');
ui.segmented({ id: 'alpha', label: 'Significance level α', options: [{ value: 0.01, label: '0.01' }, { value: 0.05, label: '0.05' }, { value: 0.1, label: '0.10' }], value: 0.05 });
ui.section('The growth room — hidden truth');
ui.slider({ id: 'G', label: 'Strength of the spatial gradients', min: 0, max: 2, step: 0.1, value: 1, help: '0 = a perfectly uniform room · 1 = a typical room · 2 = a poorly engineered room' });
ui.segmented({ id: 'reveal', label: 'Reveal as heat map', options: [{ value: 'none', label: 'Hidden' }, { value: 'ppfd', label: 'PPFD' }, { value: 'temp', label: 'Air temp.' }, { value: 'growth', label: 'Growth' }], value: 'none' });
ui.toggle({ id: 'air', label: 'Show air currents (door draught, warm air)', value: false });
ui.section('Random variation');
ui.slider({ id: 'sdTray', label: 'Tray-to-tray SD σ<sub>tray</sub>', min: 0, max: 30, step: 1, value: 10, unit: 'g', help: 'Differences between trays that have nothing to do with the treatment: reservoir, pump, handling, seed batch.' });
ui.slider({ id: 'sdPlant', label: 'Plant-to-plant SD σ<sub>plant</sub>', min: 5, max: 50, step: 1, value: 25, unit: 'g' });
ui.presets([
  { label: 'Textbook RCBD', values: { design: 'rcbd', fac: 'spectrum', t: 3, r: 4, n: 6, delta: 15, G: 1, sdTray: 10, sdPlant: 25 } },
  { label: 'Convenient but confounded', values: { design: 'systematic', fac: 'spectrum', t: 3, r: 4, n: 6, delta: 15, G: 1, sdTray: 10, sdPlant: 25 } },
  { label: 'Tempting shortcut: 1 tray each', values: { design: 'pseudo', fac: 'ec', t: 3, r: 4, n: 12, delta: 0, G: 1, sdTray: 10, sdPlant: 25 } },
  { label: 'Nothing to find (Δ = 0)', values: { design: 'crd', fac: 'ec', t: 3, r: 4, n: 6, delta: 0, G: 1, sdTray: 10, sdPlant: 25 } },
  { label: 'Perfectly uniform room', values: { design: 'systematic', fac: 'ec', t: 3, r: 4, n: 6, delta: 15, G: 0, sdTray: 0, sdPlant: 25 } },
  { label: 'Big spectrum trial', values: { design: 'rcbd', fac: 'spectrum', t: 4, r: 8, n: 6, delta: 15, G: 1.2, sdTray: 10, sdPlant: 25 } }
]);
let saveInfo = {};
ui.saveButton('experiment-designer', () => saveInfo);

const ro = new Readouts('#readouts');
ro.add({ id: 'units', label: 'Experimental units', unit: 'trays', digits: 0, note: '&nbsp;' })
  .add({ id: 'dfe', label: 'Error df of the valid analysis', unit: '', format: v => v, note: '&nbsp;' })
  .add({ id: 'truth', label: 'True effect, best − control', unit: 'g', digits: 1, note: '&nbsp;' })
  .add({ id: 'est', label: 'Estimated effect, this run', unit: 'g', format: v => isFinite(v) ? sgn(v) : '—', note: 'press Grow & harvest' })
  .add({ id: 'p', label: 'p-value, this run', unit: '', format: pFmt, note: '&nbsp;' })
  .add({ id: 'bias', label: 'Mean estimate, 1000 runs', unit: 'g', format: v => isFinite(v) ? sgn(v) : '—', note: 'press Run 1000 times' })
  .add({ id: 'power', label: 'Power (p < α when Δ > 0)', unit: '%', digits: 1, note: '1000 simulated experiments' })
  .add({ id: 'fpr', label: 'False positives when Δ = 0', unit: '%', digits: 1, note: 'should equal α' });

/* =====================================================================
   Parameters and state
   ===================================================================== */
const params = () => { const v = ui.values(); return { fac: v.fac, t: +v.t, r: +v.r, n: +v.n, design: v.design, alpha: +v.alpha, delta: v.delta / 100, G: +v.G, sdTray: +v.sdTray, sdPlant: +v.sdPlant, reveal: v.reveal, air: v.air }; };
const simP = p => ({ B: B0, delta: p.delta, G: p.G, sdTray: p.sdTray, sdPlant: p.sdPlant, n: p.n });
const trtNames = p => SIM.FACTORS[p.fac].levels[p.t];
let layout = null, runRes = null, runCount = 0, layoutSeed = 1;
let rngLayout = S.mulberry32(20260926);
const layoutKey = p => [p.design, p.t, p.r, p.n, p.fac].join('|');
const modelKey = p => [layoutKey(p), p.delta, p.G, p.sdTray, p.sdPlant].join('|');
const mcKey = p => [p.t, p.r, p.n, p.delta, p.G, p.sdTray, p.sdPlant, p.alpha].join('|');

/* =====================================================================
   3D stage: the growth room
   ===================================================================== */
// camera framing: rack A alone (r ≤ 4) or both racks (r > 4)
const CAM = { A: { pos: [0.1, 1.85, 1.0], target: [-1.45, 1.1, -2.0] }, AB: { pos: [1.3, 1.95, 2.3], target: [-0.45, 1.02, -1.95] } };
const camKey = r => (r <= 4 ? 'A' : 'AB');
let camNow = camKey(+ui.get('r'));
const stage = createStage('#stage', {
  background: '#0c1110', envIntensity: 0.2, exposure: 0.95,
  camera: { pos: CAM[camNow].pos, target: CAM[camNow].target, fov: 52 },
  controls: { minDistance: 0.5, maxDistance: 8, maxPolarAngle: Math.PI * 0.495 },
  bloom: { strength: 0.45, radius: 0.35, threshold: 1.6 }, ao: { radius: 0.16, intensity: 0.75 }   // high threshold: only the LED diodes glow, not the lit trays
});
const { scene } = stage;
const hud = hudChips(stage.el);
const legend = document.createElement('div'); legend.className = 'stage-legend'; stage.el.appendChild(legend);

// lighting: dim lab room, bright shelves
const hemi = new THREE.HemisphereLight(0xe8f0ff, 0x2a2622, 0.2); scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff4e6, 0.22); key.position.set(2.2, 6, 4.2); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 14 }); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; scene.add(key, key.target);
makeLEDBar({ length: 0.1, light: 'rect', lightIntensity: 0 });   // initialises RectAreaLight uniforms

// room with a rebuilt end wall that has a door opening
const room = makeRoom({ w: GEOM.roomW, d: GEOM.roomD, h: GEOM.roomH, wallColor: 0x4a524e, floor: 'epoxy' });
room.walls.geometry.groups = room.walls.geometry.groups.filter((g, i) => i !== 1);      // drop the −x wall
room.floor.material.color.set(0x6c7572);
scene.add(room);
const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a524e, roughness: 0.9 });
{
  const hz = GEOM.roomD / 2, dw = GEOM.doorW / 2, H = GEOM.roomH, dh = GEOM.doorH, dz = GEOM.doorZ;
  // the wall is drawn in its own (s, y) plane with s = −z (rotation.y = +90° maps shape x to world −z)
  const s0 = -(dz + dw), s1 = -(dz - dw);
  const sh = new THREE.Shape(); sh.moveTo(-hz, 0); sh.lineTo(s0, 0); sh.lineTo(s0, dh); sh.lineTo(s1, dh); sh.lineTo(s1, 0); sh.lineTo(hz, 0); sh.lineTo(hz, H); sh.lineTo(-hz, H); sh.lineTo(-hz, 0);
  const wall = new THREE.Mesh(new THREE.ShapeGeometry(sh), wallMat); wall.rotation.y = Math.PI / 2; wall.position.set(GEOM.doorX, 0, 0); wall.receiveShadow = true; scene.add(wall);
  // corridor behind the door (lit), frame, leaf ajar, handle, sign
  const corr = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.5, 1.9), new THREE.MeshStandardMaterial({ color: 0xc9cfcb, roughness: 0.85, side: THREE.BackSide })); corr.position.set(GEOM.doorX - 1.1, 1.25, dz); scene.add(corr);
  const corrLight = new THREE.PointLight(0xfff3e0, 2.4, 3.2, 1.8); corrLight.position.set(GEOM.doorX - 1.3, 2.2, dz); scene.add(corrLight);
  const frameM = M.paintedSteel(0xf1f1ed);
  [dz - dw - 0.03, dz + dw + 0.03].forEach(z => { const j = new THREE.Mesh(new THREE.BoxGeometry(0.1, dh, 0.06), frameM); j.position.set(GEOM.doorX + 0.01, dh / 2, z); scene.add(j); });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, GEOM.doorW + 0.12), frameM); head.position.set(GEOM.doorX + 0.01, dh + 0.03, dz); scene.add(head);
  const pivot = new THREE.Group(); pivot.position.set(GEOM.doorX + 0.03, 0, dz - dw + 0.01); scene.add(pivot);
  const L = GEOM.doorW - 0.03;
  const leaf = new THREE.Mesh(new RoundedBoxGeometry(0.045, dh - 0.02, L, 2, 0.008), M.paintedSteel(0xe6e8e4)); leaf.position.set(0.02, (dh - 0.02) / 2 + 0.005, L / 2); leaf.castShadow = true; pivot.add(leaf);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, 0.14), M.steel()); handle.position.set(0.06, 1.02, L - 0.09); pivot.add(handle);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.5), new THREE.MeshStandardMaterial({ color: 0x9bb0b8, roughness: 0.1, metalness: 0.3 })); win.rotation.y = Math.PI / 2; win.position.set(0.046, 1.55, L / 2); pivot.add(win);
  pivot.rotation.y = THREE.MathUtils.degToRad(17);   // ajar: the source of the draught
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.2), new THREE.MeshBasicMaterial({ map: canvasTexture(288, 160, (c, w, h) => { c.fillStyle = '#f6f3e8'; c.fillRect(0, 0, w, h); c.fillStyle = '#b3261e'; c.fillRect(0, 0, w, 34); c.fillStyle = '#fff'; c.font = '700 22px Inter, sans-serif'; c.fillText('GROWTH ROOM 2', 14, 25); c.fillStyle = '#1b2420'; c.font = '600 19px Inter, sans-serif'; c.fillText('Keep the door closed', 14, 72); c.font = '500 16px Inter, sans-serif'; c.fillText('Experiment in progress —', 14, 104); c.fillText('do not move trays', 14, 128); }) }));
  sign.rotation.y = Math.PI / 2; sign.position.set(GEOM.doorX + 0.005, 1.55, dz + dw + 0.4); scene.add(sign);
}
// ceiling luminaires (room light) and an air-conditioning unit on the right end wall
[[-1.6, -0.6], [1.4, -0.6]].forEach(([x, z]) => {
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.3), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff6ea, emissiveIntensity: 1.25 })); panel.position.set(x, GEOM.roomH - 0.02, z); scene.add(panel);
  const L = new THREE.RectAreaLight(0xfff4e8, 1.0, 1.2, 0.3); L.position.set(x, GEOM.roomH - 0.04, z); L.rotation.x = -Math.PI / 2; scene.add(L);
});
{
  const ac = new THREE.Group(); ac.position.set(GEOM.roomW / 2 - 0.13, GEOM.roomH - 0.36, -0.7);
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.3, 0.95, 3, 0.04), M.plasticWhite()); ac.add(body);
  for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.012, 0.86), M.plasticGrey()); s.position.set(-0.121, -0.1 + i * 0.012, 0); ac.add(s); }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), M.emissive(0x2cff6a, 4)); led.position.set(-0.121, 0.09, 0.38); ac.add(led);
  scene.add(ac);
}

// two racks (frame and shelf decks from lab3d; LED modules per tray position added below)
const rackGroups = GEOM.rackX.map((x, ri) => {
  const rk = makeRack({ levels: LEVELS, width: GEOM.rackW, depth: GEOM.rackD, levelHeight: GEOM.levelH, baseHeight: GEOM.baseH, lights: false });
  rk.position.set(x, 0, GEOM.rackZ); scene.add(rk);
  const deckMat = M.plastic(0x8f9692, 0.6); rk.shelves.forEach(s => { s.tray.material = deckMat; });   // grey shelf decks (less glare under the LEDs)
  const rail = M.paintedSteel(0xdedfdb); const top = GEOM.baseH + LEVELS * GEOM.levelH + 0.06;
  [-1, 1].forEach(s => { const b = new THREE.Mesh(new THREE.BoxGeometry(GEOM.rackW + 0.05, 0.04, 0.04), rail); b.position.set(0, top, s * (GEOM.rackD / 2 - 0.02)); b.castShadow = true; rk.add(b); });
  // cable tray on top and rack name plate
  const ct = new THREE.Mesh(new THREE.BoxGeometry(GEOM.rackW, 0.05, 0.14), M.galvanised()); ct.position.set(0, top + 0.05, 0); rk.add(ct);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), new THREE.MeshBasicMaterial({ map: canvasTexture(170, 100, (c, w, h) => { c.fillStyle = '#1d2a33'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = '700 64px Inter, sans-serif'; c.textAlign = 'center'; c.fillText(ri === 0 ? 'A' : 'B', w / 2, 74); }) }));
  plate.position.set(0, top + 0.13, GEOM.rackD / 2 - 0.05); rk.add(plate);
  return rk;
});
const slotWorld = (rack, level, slot) => new THREE.Vector3(SIM.slotX(rack, slot), SIM.shelfY(level) + 0.035, GEOM.rackZ);

// shelf labels (A1 … B4) at the door end of each shelf; extended with values when revealed
const shelfLabels = [];
for (let r = 0; r < RACKS; r++) for (let l = 0; l < LEVELS; l++) {
  const lab = stage.addLabel([GEOM.rackX[r] - GEOM.rackW / 2 - 0.08, SIM.shelfY(l) + 0.2, GEOM.rackZ + GEOM.rackD / 2 + 0.04], `${SIM.shelfName(r, l)}`, { className: 'label3d ed-shelf' });
  shelfLabels.push({ r, l, lab });
}

/* ---------- LED modules, light pools and shelf lights ---------- */
const lightGroup = new THREE.Group(); scene.add(lightGroup);
const shelfLights = [];
for (let r = 0; r < RACKS; r++) for (let l = 0; l < LEVELS; l++) {
  const L = new THREE.RectAreaLight(0xfff2e6, 0, GEOM.rackW - 0.1, GEOM.rackD - 0.16);
  L.position.set(GEOM.rackX[r], SIM.shelfY(l) + GEOM.levelH - 0.075, GEOM.rackZ); L.rotation.x = -Math.PI / 2; scene.add(L); shelfLights.push(L);
}
const poolTex = canvasTexture(128, 128, (c, w) => { const g = c.createRadialGradient(w / 2, w / 2, 4, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, w); }, { srgb: false });
const LIGHT_COL = { 'Red–blue': 0xff40c0, 'White': 0xfff2e2, 'White + red': 0xffd6c4, 'White + far-red': 0xffc6cc, ec: 0xfff0e2 };
// white partitions between the light compartments — drawn semi-transparent so that the trays stay visible
const dividerMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.92, side: THREE.DoubleSide, transparent: true, opacity: 0.38, depthWrite: false });
function buildLights(p) {
  lightGroup.children.slice().forEach(o => { lightGroup.remove(o); o.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material && m.material !== dividerMat) { if (m.material.map && m.material.map !== poolTex) m.material.map.dispose(); m.material.dispose(); } }); });
  const names = trtNames(p); const fac = SIM.FACTORS[p.fac];
  const used = new Map(); layout.trays.forEach(tr => used.set(SIM.posIndex(tr.rack, tr.level, tr.slot), tr));
  const shelfUsed = new Set(); layout.trays.forEach(tr => shelfUsed.add(tr.rack * LEVELS + tr.level));
  for (let r = 0; r < RACKS; r++) for (let l = 0; l < LEVELS; l++) {
    const shelfOn = shelfUsed.has(r * LEVELS + l);
    const colSum = new THREE.Color(0, 0, 0); let nOn = 0;
    for (let k = 0; k < SLOTS; k++) {
      const tr = used.get(SIM.posIndex(r, l, k));
      const nm = tr ? names[tr.trt] : null;
      const ledSpec = p.fac === 'spectrum' ? (nm ? fac.led[nm] : 'white') : 'full';
      const bar = makeLEDBar({ length: 0.46, width: 0.12, color: ledSpec, light: false, rows: 3 });
      const w = slotWorld(r, l, k); bar.position.set(w.x, SIM.shelfY(l) + GEOM.levelH - 0.06, w.z); bar.setIntensity(tr || (shelfOn && p.fac === 'ec') ? 1 : 0.02); lightGroup.add(bar);
      if (tr || (shelfOn && p.fac === 'ec')) {
        const cHex = p.fac === 'spectrum' ? LIGHT_COL[nm] : LIGHT_COL.ec; colSum.add(new THREE.Color(cHex)); nOn++;
        if (tr) { const pool = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.58), new THREE.MeshBasicMaterial({ map: poolTex, color: cHex, transparent: true, opacity: p.fac === 'spectrum' && nm === 'Red–blue' ? 0.26 : 0.1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })); pool.rotation.x = -Math.PI / 2; pool.position.set(w.x, w.y + 0.092, w.z); lightGroup.add(pool); }
      }
      // light-tight compartments for the spectrum experiment
      if (p.fac === 'spectrum' && shelfOn && k < SLOTS - 1) {
        const dv = new THREE.Mesh(new THREE.PlaneGeometry(GEOM.rackD - 0.04, GEOM.levelH - 0.1), dividerMat); dv.rotation.y = Math.PI / 2;
        dv.position.set(w.x + GEOM.rackW / SLOTS / 2, SIM.shelfY(l) + 0.035 + (GEOM.levelH - 0.1) / 2, w.z); dv.receiveShadow = true; lightGroup.add(dv);
      }
    }
    const L = shelfLights[r * LEVELS + l];
    if (nOn) { L.color.copy(colSum.multiplyScalar(1 / nOn)); L.intensity = 1.3 + 0.5 * nOn; } else L.intensity = 0;
  }
}

/* ---------- trays (persistent objects that glide to new positions) ---------- */
const trayGroup = new THREE.Group(); scene.add(trayGroup);
const trayMat = M.plastic(0x2b2f33, 0.55);
const trayGeo = new RoundedBoxGeometry(0.54, 0.075, 0.52, 2, 0.012);
const GRID = { 4: [2, 2], 6: [3, 2], 8: [4, 2], 12: [4, 3] };
const lidTex = {};
function lidTexture(n) {
  if (lidTex[n]) return lidTex[n];
  const [nx, nz] = GRID[n];
  lidTex[n] = canvasTexture(256, 248, (c, w, h) => {
    c.fillStyle = '#d3d7d0'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.03})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const x = (i + 0.5) * w / nx, y = (j + 0.5) * h / nz; c.fillStyle = '#1b1d1f'; c.beginPath(); c.arc(x, y, 17, 0, 7); c.fill(); c.fillStyle = '#6f5a3c'; c.beginPath(); c.arc(x, y, 12, 0, 7); c.fill(); }
  });
  return lidTex[n];
}
function labelTexture(text, col) {
  return canvasTexture(192, 72, (c, w, h) => { c.fillStyle = col; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(0, h - 8, w, 8); c.fillStyle = '#fff'; c.font = '700 40px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, w / 2, h / 2 - 2); });
}
const pool = new Map();     // key "trt-rep" → { group, from, to, t0 }
let glide = null;
function trayKey(tr) { return `${tr.trt}-${tr.rep}`; }
function makeTrayObject(tr, p) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(trayGeo, trayMat); body.position.y = 0.0375; body.castShadow = true; body.receiveShadow = true; g.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.48), new THREE.MeshStandardMaterial({ map: lidTexture(p.n), roughness: 0.85 })); lid.position.y = 0.081; lid.receiveShadow = true; g.add(lid);
  const col = TRT_COLORS[tr.trt];
  const rim = new THREE.Mesh(new THREE.BoxGeometry(0.545, 0.012, 0.525), new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 })); rim.position.y = 0.07; g.add(rim);
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.066), new THREE.MeshBasicMaterial({ map: labelTexture(`T${tr.trt + 1}·${tr.rep + 1}`, col) }));
  lab.position.set(0, 0.038, 0.262); g.add(lab); g.userData.lab = lab;
  g.userData.key = trayKey(tr); body.userData.tray = g; lid.userData.tray = g;
  return g;
}
function trayTarget(tr) { return { pos: slotWorld(tr.rack, tr.level, tr.slot), rotY: 0 }; }

/* ---------- lettuce: low-poly heads, instanced ---------- */
function headGeometry(seed) {
  const r = lrng(seed); const geos = []; const n = 9, R = 0.13;
  for (let k = 0; k < n; k++) {
    const age = 1 - k / n, inner = age < 0.3;
    const len = R * (0.52 + 0.8 * age) * (0.9 + r() * 0.2);
    const pitch = inner ? 0.14 + 0.5 * age + (r() - 0.5) * 0.1 : 0.38 + 0.95 * Math.pow(age, 1.2) + (r() - 0.5) * 0.16;
    const curl = inner ? -0.5 + 0.4 * age : 0.26 + 0.55 * age;
    const geo = leafGeometry({ length: len, width: len * 0.98, segU: 6, segV: 5, pitch, curl, cup: inner ? 0.8 : 0.62 - age * 0.3, ruffle: 0.004 * len / 0.1, ruffleFreq: 5 + r() * 3, shape: 'round', seed: seed * 100 + k, colors: inner ? ['#e3efac', '#e3efac', '#a2cd52'] : ['#e3efac', '#a2cd52', age > 0.55 ? '#62a032' : '#a2cd52'] });
    const m = new THREE.Matrix4().makeRotationY(k * 2.39996 + r() * 0.2); m.multiply(new THREE.Matrix4().makeTranslation(0, 0.004 * k / n, R * (inner ? 0.02 : 0.05) * age));
    geo.applyMatrix4(m); geos.push(geo);
  }
  const merged = BufferGeometryUtils.mergeGeometries(geos); geos.forEach(g => g.dispose()); return merged;
}
const MAXP = 32 * 12;
const headMat = leafMaterial({ gloss: 0.45 });
const heads = [3, 8, 13].map(sd => { const im = new THREE.InstancedMesh(headGeometry(sd), headMat, MAXP); im.count = 0; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; scene.add(im); return im; });
let plants = [];   // { tray (layout index), key, local:[x,z], rot, v (variant), sFinal, sNow, sFrom }
const baseScale = n => ({ 4: 1.0, 6: 0.88, 8: 0.64, 12: 0.6 }[n]);
const SEED_S = 0.26;
function buildPlants(p) {
  plants = []; const [nx, nz] = GRID[p.n]; const bs = baseScale(p.n); let k = 0;
  layout.trays.forEach((tr, ti) => {
    let jj = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const lx = -0.25 + (i + 0.5) * 0.5 / nx, lz = -0.24 + (j + 0.5) * 0.48 / nz;
      plants.push({ ti, j: jj++, key: trayKey(tr), local: [lx, lz], rot: (k * 2.1 + ti * 0.7) % 6.283, v: (k + ti) % 3, s: bs * SEED_S, sFrom: bs * SEED_S, sTo: bs * SEED_S });
      k++;
    }
  });
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function writePlants() {
  const cnt = [0, 0, 0];
  for (const pl of plants) {
    const obj = pool.get(pl.key); if (!obj) continue; const g = obj.group;
    const c = Math.cos(g.rotation.y), s = Math.sin(g.rotation.y);
    _v.set(g.position.x + pl.local[0] * c + pl.local[1] * s, g.position.y + 0.087, g.position.z - pl.local[0] * s + pl.local[1] * c);
    _q.setFromAxisAngle(_up, pl.rot); _s.set(pl.s, pl.s * (0.85 + 0.15 * Math.min(1, pl.s / 0.5)), pl.s); _m.compose(_v, _q, _s);
    heads[pl.v].setMatrixAt(cnt[pl.v]++, _m);
  }
  heads.forEach((im, i) => { im.count = cnt[i]; im.instanceMatrix.needsUpdate = true; });
}

/* ---------- heat maps of the hidden fields ---------- */
const heatGroup = new THREE.Group(); scene.add(heatGroup);
function fieldValue(kind, x, level, rack, G) {
  const f = SIM.fieldAt(x, level, rack, G);
  return kind === 'ppfd' ? f.ppfd : kind === 'temp' ? f.T : SIM.gField(x, level, rack, G);
}
function fieldRange(kind, G) {
  let lo = Infinity, hi = -Infinity;
  for (let r = 0; r < RACKS; r++) for (let l = 0; l < LEVELS; l++) for (const x of linspace(GEOM.rackX[r] - GEOM.rackW / 2, GEOM.rackX[r] + GEOM.rackW / 2, 25)) { const v = fieldValue(kind, x, l, r, G); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const minSpan = { ppfd: 30, temp: 1.5, growth: 0.12 }[kind]; const c = (lo + hi) / 2;
  if (hi - lo < minSpan) { lo = c - minSpan / 2; hi = c + minSpan / 2; }
  return [lo, hi];
}
const CMAP = { ppfd: 'turbo', temp: 'rdbu', growth: 'rdylgn' };
const UNIT = { ppfd: 'µmol m⁻² s⁻¹', temp: '°C', growth: '× room mean' };
const TITLE = { ppfd: 'PPFD at the canopy', temp: 'Air temperature at the canopy', growth: 'Growth potential g (light × temperature × draught)' };
function buildHeat(p) {
  heatGroup.children.slice().forEach(o => { heatGroup.remove(o); o.geometry.dispose(); o.material.map && o.material.map.dispose(); o.material.dispose(); });
  shelfLabels.forEach(({ r, l, lab }) => { lab.element.innerHTML = SIM.shelfName(r, l); });
  if (p.reveal === 'none') { renderLegend(p); return; }
  const kind = p.reveal; const [lo, hi] = fieldRange(kind, p.G); const NX = 60;
  for (let r = 0; r < RACKS; r++) for (let l = 0; l < LEVELS; l++) {
    const xs = linspace(GEOM.rackX[r] - GEOM.rackW / 2, GEOM.rackX[r] + GEOM.rackW / 2, NX);
    const row = xs.map(x => fieldValue(kind, x, l, r, p.G));
    const vals = kind === 'temp' ? [row.map(v => -v), row.map(v => -v)] : [row, row];
    const tex = heatmapTexture(vals, { colormap: CMAP[kind], min: kind === 'temp' ? -hi : lo, max: kind === 'temp' ? -lo : hi });
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(GEOM.rackW - 0.02, GEOM.rackD - 0.06), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.93, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    pl.rotation.x = -Math.PI / 2; pl.position.set(GEOM.rackX[r], SIM.shelfY(l) + 0.131, GEOM.rackZ); pl.renderOrder = 2; heatGroup.add(pl);
    const mn = Math.min(...row), mx = Math.max(...row);
    const f = v => kind === 'ppfd' ? fmt(v, 0) : kind === 'temp' ? fmt(v, 1) : fmt(v, 2);
    shelfLabels[r * LEVELS + l].lab.element.innerHTML = `${SIM.shelfName(r, l)}<small>${f(mn)}–${f(mx)} ${kind === 'growth' ? '×' : UNIT[kind]}</small>`;
  }
  renderLegend(p, [lo, hi]);
}

/* ---------- air currents ---------- */
const airGroup = new THREE.Group(); scene.add(airGroup); const flows = [];
{
  const dx = GEOM.doorX, dz = GEOM.doorZ, zr = GEOM.rackZ + GEOM.rackD / 2 - 0.08;
  // cold air enters low through the open door and spreads along the floor towards the racks
  [[[dx + 0.05, 0.1, dz + 0.2], [dx + 0.55, 0.12, dz - 0.2], [dx + 0.85, 0.22, zr + 0.35], [-2.3, 0.3, zr], [-1.6, 0.33, zr - 0.1], [-0.9, 0.3, zr]],
   [[dx + 0.05, 0.1, dz - 0.2], [dx + 0.6, 0.11, dz - 0.5], [dx + 0.8, 0.2, zr + 0.1], [-2.35, 0.78, zr], [-1.9, 0.8, zr - 0.15]],
   [[dx + 0.05, 0.14, dz], [dx + 0.9, 0.14, dz + 0.1], [-1.5, 0.12, -0.4], [-0.2, 0.15, -0.2], [1.2, 0.25, -0.1]],
   [[dx + 0.05, 0.45, dz + 0.1], [dx + 0.7, 0.5, dz], [dx + 0.95, 0.55, zr + 0.25], [-2.3, 0.3, zr + 0.15], [-1.3, 0.28, zr + 0.1]],
   [[dx + 0.05, 0.3, dz - 0.35], [dx + 0.5, 0.26, zr + 0.4], [-2.45, 0.28, zr + 0.05], [-2.0, 0.3, zr - 0.2]]
  ].forEach(pts => { const c = new THREE.CatmullRomCurve3(pts.map(q => new THREE.Vector3(...q))); const f = new FlowAlong(c, { count: 44, speed: 0.55, size: 0.03, color: 0x7cc8ff, jitter: 0.06, opacity: 0.9 }); airGroup.add(f.points); flows.push(f); });
  // warm air rises from the racks and drifts to the air-conditioning return on the right wall
  GEOM.rackX.forEach(xc => [-0.8, 0, 0.8].forEach(o => { const x = xc + o; const c = new THREE.CatmullRomCurve3([new THREE.Vector3(x, 2.2, GEOM.rackZ), new THREE.Vector3(x + 0.1, 2.5, GEOM.rackZ + 0.3), new THREE.Vector3(x + 0.5, 2.78, GEOM.rackZ + 0.9), new THREE.Vector3(Math.min(3.0, x + 1.6), 2.82, -0.8)]); const f = new FlowAlong(c, { count: 16, speed: 0.22, size: 0.032, color: 0xffa44a, jitter: 0.05, opacity: 0.8 }); airGroup.add(f.points); flows.push(f); }));
}
airGroup.visible = false;
const doorLabel = stage.addLabel([GEOM.doorX + 0.3, 2.25, GEOM.doorZ], 'Door<small>left ajar — cold draught</small>', { className: 'label3d' }); doorLabel.visible = false;

/* ---------- picking a tray ---------- */
let pickLabel = null, pickObj = null;
stage.onPick({
  objects: () => { const o = []; pool.forEach(v => v.group.children.forEach(c => { if (c.userData.tray) o.push(c); })); return o; },
  onClick: hit => {
    if (!hit) { if (pickLabel) { pickLabel.removeFromParent(); pickLabel = null; } return; }
    const g = hit.object.userData.tray; const ti = layout.trays.findIndex(tr => trayKey(tr) === g.userData.key); if (ti < 0) return;
    pickObj = { g, ti }; showPick();
  }
});
function showPick() {
  if (!pickObj) return; const { g, ti } = pickObj; const tr = layout.trays[ti]; if (!tr) return; const p = params(); const names = trtNames(p);
  const f = SIM.fieldAt(SIM.slotX(tr.rack, tr.slot), tr.level, tr.rack, p.G); const gf = SIM.gAt(p.G, tr.rack, tr.level, tr.slot);
  let html = `T${tr.trt + 1} ${esc(names[tr.trt])} · tray ${tr.rep + 1}<small>shelf ${SIM.shelfName(tr.rack, tr.level)}, position ${tr.slot + 1} from the door${p.design === 'rcbd' ? ` · block ${tr.block + 1}` : ''}</small>`;
  if (runRes && runRes.sim[ti]) { const s = runRes.sim[ti]; html += `<small>harvest: mean ${fmt(s.mean, 1)} g · plants ${Array.from(s.plants).map(v => Math.round(v)).join(', ')}</small>`; }
  if (p.reveal !== 'none') html += `<small>hidden truth: PPFD ${fmt(f.ppfd, 0)} · ${fmt(f.T, 1)} °C · growth ×${fmt(gf, 3)}</small>`;
  if (pickLabel) pickLabel.removeFromParent();
  pickLabel = stage.addLabel(g, html, { className: 'label3d lg', offset: [0, 0.34, 0] });
}

/* ---------- legend ---------- */
function renderLegend(p, range) {
  const names = trtNames(p);
  let h = `<div style="margin-bottom:4px"><b>${esc(SIM.FACTORS[p.fac].name)}</b> · ${esc(SIM.DESIGNS[p.design].name)}</div>` + names.map((nm, i) => `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:10px"><i style="width:10px;height:10px;border-radius:3px;background:${TRT_COLORS[i]};display:inline-block"></i>T${i + 1} ${esc(nm)}</span>`).join('');
  if (range && p.reveal !== 'none') {
    const k = p.reveal; const grad = k === 'temp' ? colormapGradient('rdbu', 'to left') : colormapGradient(CMAP[k]);
    const f = v => k === 'ppfd' ? fmt(v, 0) : k === 'temp' ? fmt(v, 1) : fmt(v, 2);
    h += `<div style="margin-top:6px">${TITLE[k]} (${UNIT[k]})</div><div class="cbar" style="background:${grad}"></div><div class="cbar-ticks"><span>${f(range[0])}</span><span>${f((range[0] + range[1]) / 2)}</span><span>${f(range[1])}</span></div>`;
  }
  legend.innerHTML = h;
}

/* =====================================================================
   Layout and the 2-D layout plan
   ===================================================================== */
function relayout(newRandom = false) {
  const p = params();
  if (newRandom) layoutSeed++;
  rngLayout = S.mulberry32(20260926 + 7919 * layoutSeed);
  const old = layout; layout = SIM.makeLayout(p.design, p.t, p.r, rngLayout); layout.fac = p.fac; layout.n = p.n;
  const ck = camKey(p.r); if (ck !== camNow) { camNow = ck; stage.setHome(CAM[ck].pos, CAM[ck].target); stage.flyTo(CAM[ck].pos, CAM[ck].target, 1.3); }
  runRes = null; pickObj = null; if (pickLabel) { pickLabel.removeFromParent(); pickLabel = null; }
  // trays: reuse objects with the same key (they glide), rebuild when the plant number or factor changed
  const rebuildAll = !old || old.n !== p.n || old.fac !== p.fac;
  const keep = new Set(layout.trays.map(trayKey));
  pool.forEach((v, k) => { if (rebuildAll || !keep.has(k)) { trayGroup.remove(v.group); v.group.traverse(m => { if (m.geometry && m.geometry !== trayGeo) m.geometry.dispose(); if (m.material && m.material !== trayMat) { if (m.material.map && !Object.values(lidTex).includes(m.material.map)) m.material.map.dispose(); m.material.dispose(); } }); pool.delete(k); } });
  const now = performance.now(); let moving = false;
  layout.trays.forEach(tr => {
    const k = trayKey(tr); const tg = trayTarget(tr);
    if (!pool.has(k)) { const g = makeTrayObject(tr, p); g.position.copy(tg.pos); g.rotation.y = tg.rotY; trayGroup.add(g); pool.set(k, { group: g, from: tg, to: tg }); }
    else { const o = pool.get(k); o.from = { pos: o.group.position.clone(), rotY: o.group.rotation.y }; o.to = tg; if (o.from.pos.distanceToSquared(tg.pos) > 1e-6) moving = true; }
  });
  glide = moving ? { t0: now, dur: 1100 } : null;
  buildPlants(p); writePlants(); buildLights(p); buildHeat(p);
  drawPlan(); updateStatic(); renderAnalysis(); markMCStale();
}
/** Front-elevation plan of both racks, drawn as SVG (theme-aware). */
function drawPlan() {
  const p = params(); const P = palette(); const el = $('#chart-plan'); const names = trtNames(p);
  const W = 640, H = 300, cw = 58, ch = 44, gx = 30, top = 42, left0 = 64;
  const rackLeft = r => left0 + r * (SLOTS * cw + 3 * 12 + gx + 26);
  const byPos = new Map(); layout.trays.forEach((tr, i) => byPos.set(SIM.posIndex(tr.rack, tr.level, tr.slot), i));
  const [glo, ghi] = fieldRange('growth', Math.max(p.G, 1e-6));
  let s = `<svg class="dg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Layout plan of the two racks with the treatment of every tray">`;
  s += `<defs><marker id="ed-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>`;
  for (let r = 0; r < RACKS; r++) {
    const x0 = rackLeft(r);
    s += `<text x="${x0 + (SLOTS * (cw + 12) - 12) / 2}" y="22" text-anchor="middle" font-weight="700" font-size="13">Rack ${SIM.rackName(r)}</text>`;
    s += `<text x="${x0 - 8}" y="${top - 8}" text-anchor="end" class="t-small t-muted">door ←</text>`;
    for (let l = LEVELS - 1; l >= 0; l--) {
      const y = top + (LEVELS - 1 - l) * (ch + 12);
      s += `<text x="${x0 - 8}" y="${y + ch / 2 + 4}" text-anchor="end" class="t-small t-mono">${SIM.shelfName(r, l)}</text>`;
      s += `<line x1="${x0 - 4}" y1="${y + ch + 3}" x2="${x0 + SLOTS * (cw + 12) - 8}" y2="${y + ch + 3}" stroke="currentColor" stroke-opacity=".35" stroke-width="2"/>`;
      for (let k = 0; k < SLOTS; k++) {
        const x = x0 + k * (cw + 12); const idx = byPos.get(SIM.posIndex(r, l, k));
        let bg = 'none';
        if (p.reveal !== 'none') { const g = SIM.gAt(p.G, r, l, k); const t = (g - glo) / (ghi - glo || 1); bg = cssColormap('rdylgn', t); }
        if (idx == null) { s += `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="7" fill="${bg === 'none' ? 'none' : bg}" fill-opacity="${bg === 'none' ? 0 : 0.35}" stroke="currentColor" stroke-opacity=".25" stroke-dasharray="4 3"/>`; continue; }
        const tr = layout.trays[idx]; const col = TRT_COLORS[tr.trt];
        if (bg !== 'none') s += `<rect x="${x - 3}" y="${y - 3}" width="${cw + 6}" height="${ch + 6}" rx="9" fill="${bg}"/>`;
        s += `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="7" fill="${col}" fill-opacity="0.2" stroke="${col}" stroke-width="2"/>`;
        s += `<text x="${x + cw / 2}" y="${y + 17}" text-anchor="middle" font-weight="700" font-size="13" fill="${col}">T${tr.trt + 1}</text>`;
        const sub = runRes ? `${Math.round(runRes.sim[idx].mean)} g` : p.design === 'rcbd' ? `block ${tr.block + 1}` : `tray ${tr.rep + 1}`;
        s += `<text x="${x + cw / 2}" y="${y + 34}" text-anchor="middle" class="t-small t-mono">${sub}</text>`;
      }
    }
  }
  const legendY = H - 16;
  s += names.map((nm, i) => `<g transform="translate(${left0 + i * 150}, ${legendY})"><rect x="0" y="-10" width="12" height="12" rx="3" fill="${TRT_COLORS[i]}"/><text x="18" y="0" class="t-small">T${i + 1} ${esc(nm)}</text></g>`).join('');
  s += `</svg>`;
  el.innerHTML = s;
  $('#plan-sub').innerHTML = runRes ? `Tray means of harvest ${runCount} (g). ${p.reveal !== 'none' ? 'Background: hidden growth potential (red = poor, green = good). ' : ''}Slot 1 of every shelf is nearest the door.` : `Where every tray goes in this ${{ systematic: 'systematic', crd: 'completely randomised', rcbd: 'randomised-block', pseudo: 'pseudo-replicated' }[p.design]} layout. ${p.reveal !== 'none' ? 'Background: hidden growth potential (red = poor, green = good). ' : 'Reveal the room to see the hidden growth potential behind each position. '}Slot 1 of every shelf is nearest the door.`;
}
const cssColormap = (name, t) => colormapCSS(name, t);

/* =====================================================================
   Run once: grow, harvest and analyse
   ===================================================================== */
function runOnce() {
  const p = params(); if (!layout) relayout();
  runCount++;
  const rng = S.mulberry32((Date.now() ^ (runCount * 2654435761)) >>> 0); const gauss = SIM.gaussian(rng);
  const sim = SIM.simulate(layout, simP(p), gauss);
  const A = SIM.analyse(layout, sim); const PL = SIM.plantLevel(layout, sim);
  runRes = { sim, A, PL, p, key: modelKey(p), exp: SIM.expectedEstimate(layout, simP(p)) };
  // plants grow from seedlings to their simulated harvest size
  const bs = baseScale(p.n);
  plants.forEach(pl => { const w = sim[pl.ti].plants[pl.j] ?? sim[pl.ti].mean; pl.sFrom = bs * SEED_S; pl.s = pl.sFrom; pl.sTo = bs * Math.max(0.45, Math.min(1.45, Math.pow(w / B0, 0.55))); });
  grow = { t0: performance.now(), dur: 2300 };
  drawPlan(); renderAnalysis(); updateStatic(); showPick();
  saveInfo = { design: SIM.DESIGNS[p.design].name, factor: SIM.FACTORS[p.fac].name, t: p.t, r: p.r, plants_per_tray: p.n, true_effect_pct: p.delta * 100, gradient_strength: p.G, run: runCount, F: +A.F.toFixed(3), df: `${A.df1}, ${A.df2}`, p: +A.p.toPrecision(3), estimate_g: +A.est.toFixed(2) };
}
let grow = null;

/* =====================================================================
   Analysis panel (HTML)
   ===================================================================== */
function anovaTable(rows, caption) {
  return `<div class="ed-scroll"><table class="ed-table"><caption>${caption}</caption><thead><tr><th>Source of variation</th><th class="num">df</th><th class="num">SS</th><th class="num">MS</th><th class="num">F</th><th class="num">p</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.cls || ''}"><td>${r.src}</td><td class="num">${r.df ?? ''}</td><td class="num">${r.ss != null ? num(r.ss, 1) : ''}</td><td class="num">${r.ms != null ? num(r.ms, 1) : ''}</td><td class="num">${r.F != null ? num(r.F, 2) : ''}</td><td class="num">${r.p != null ? (r.p < 0.001 ? '&lt; .001' : nlz(r.p, 3)) : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderAnalysis() {
  const p = params(); const el = $('#ed-analysis'); const names = trtNames(p); const fac = SIM.FACTORS[p.fac];
  $('#ed-an-design').textContent = SIM.DESIGNS[p.design].long;
  if (!runRes) {
    el.innerHTML = `<div class="ed-plan-note"><p><b>Plan ready.</b> ${planSummary(p)}</p><p class="muted">Press <em>Grow &amp; harvest once</em> to run the experiment: the plants grow, each head is weighed, and the analysis that matches the design appears here.</p></div>`;
    return;
  }
  const A = runRes.A, PL = runRes.PL, a = p.alpha, last = p.t - 1; const unit = 'g';
  const sig = A.p < a;
  let apa, table, extra = '';
  if (A.kind === 'rcbd') {
    const R = A.R; const b = p.r, t = p.t; const RE = ((b - 1) * R.block.ms + b * (t - 1) * R.error.ms) / ((b * t - 1) * R.error.ms);
    apa = `A randomised complete block ANOVA on tray means (shelf = block, ${b} blocks) ${sig ? 'showed' : 'did not show'} a significant effect of ${fac.unit}, <i>F</i>(${R.treatment.df}, ${R.error.df}) = ${num(R.treatment.F, 2)}, ${apaP(R.treatment.p)}. ${esc(names[last])} − ${esc(names[0])} = ${sgn(A.est)} g, 95 % CI [${num(A.ci[0], 1)}, ${num(A.ci[1], 1)}]. Shelves differed ${R.block.p < a ? 'significantly' : 'little'} (<i>F</i>(${R.block.df}, ${R.error.df}) = ${num(R.block.F, 2)}, ${apaP(R.block.p)}); relative efficiency of blocking RE = ${num(RE, 2)}.`;
    table = anovaTable([{ src: `Treatment (${esc(fac.unit)})`, df: R.treatment.df, ss: R.treatment.ss, ms: R.treatment.ms, F: R.treatment.F, p: R.treatment.p }, { src: 'Block (shelf)', df: R.block.df, ss: R.block.ss, ms: R.block.ms, F: R.block.F, p: R.block.p }, { src: 'Error (trays within blocks)', df: R.error.df, ss: R.error.ss, ms: R.error.ms }, { src: 'Total', df: R.total.df, ss: R.total.ss, cls: 'tot' }], `Randomised complete block ANOVA on tray means (unit = g²). Each tray mean averages ${p.n} plants.`);
  } else if (A.kind === 'oneway') {
    const T = A.A;
    apa = `A one-way ANOVA on tray means (${p.r} trays per treatment) ${sig ? 'showed' : 'did not show'} a significant effect of ${fac.unit}, <i>F</i>(${T.df1}, ${T.df2}) = ${num(T.F, 2)}, ${apaP(T.p)}, η² = ${nlz(T.eta2, 2)}. ${esc(names[last])} − ${esc(names[0])} = ${sgn(A.est)} g, 95 % CI [${num(A.ci[0], 1)}, ${num(A.ci[1], 1)}] (Welch).`;
    table = anovaTable([{ src: `Treatment (${esc(fac.unit)})`, df: T.df1, ss: T.ssb, ms: T.msb, F: T.F, p: T.p }, { src: 'Error (trays within treatments)', df: T.df2, ss: T.ssw, ms: T.msw }, { src: 'Total', df: T.N - 1, ss: T.sst, cls: 'tot' }], `One-way ANOVA on tray means (unit = g²). The tray is the experimental unit; each tray mean averages ${p.n} plants.`);
    if (p.design === 'systematic') extra = `<div class="callout warn"><div class="callout-title">Valid arithmetic, invalid comparison</div><p>The table is computed correctly, but the treatments were placed in groups on different shelves, so the treatment effect is <b>confounded</b> with position. No statistical method can separate the two afterwards.</p></div>`;
  } else {
    const T = A.A;
    apa = `<span class="ed-bad">Invalid analysis.</span> Treating the ${p.n} plants of each single tray as replicates, a one-way ANOVA gives <i>F</i>(${T.df1}, ${T.df2}) = ${num(T.F, 2)}, ${apaP(T.p)}. With one tray per treatment the treatment cannot be separated from the tray and its position: the valid error term (trays within treatments) has 0 degrees of freedom.`;
    table = anovaTable([{ src: `Treatment (${esc(fac.unit)})`, df: T.df1, ss: T.ssb, ms: T.msb, F: T.F, p: T.p }, { src: 'Plants within trays (used as error — wrong)', df: T.df2, ss: T.ssw, ms: T.msw, cls: 'bad' }, { src: 'Trays within treatments (the correct error)', df: '0', cls: 'bad' }, { src: 'Total', df: T.N - 1, ss: T.sst, cls: 'tot' }], 'Plant-level ANOVA of the pseudo-replicated design (unit = g²).');
    extra = `<div class="callout danger"><div class="callout-title">Pseudo-replication</div><p>The plants in one tray share its reservoir, its position in the room and everything that happened to it. They are <b>sub-samples</b>, not replicates (Hurlbert, 1984). The p-value above assumes ${T.df2} independent error degrees of freedom that do not exist. Run the Monte Carlo with Δ = 0 to see how often this analysis “finds” an effect that is not there.</p></div>`;
  }
  const means = `<div class="ed-scroll"><table class="ed-table"><caption>Treatment means of this harvest</caption><thead><tr><th>Treatment</th><th class="num">trays</th><th class="num">plants</th><th class="num">mean (g)</th><th class="num">true expected (g)</th></tr></thead><tbody>${names.map((nm, i) => { const idx = layout.trays.map((tr, j) => tr.trt === i ? j : -1).filter(j => j >= 0); const m = S.mean(idx.map(j => runRes.sim[j].mean)); const e = S.mean(idx.map(j => runRes.sim[j].mu)); return `<tr><td><i class="ed-dot" style="background:${TRT_COLORS[i]}"></i>T${i + 1} ${esc(nm)}</td><td class="num">${idx.length}</td><td class="num">${idx.length * p.n}</td><td class="num">${num(m, 1)}</td><td class="num">${num(e, 1)}</td></tr>`; }).join('')}</tbody></table></div>`;
  const truth = SIM.trueEffect(p.t, p.r, simP(p)); const bias = runRes.exp - truth;
  const truthBox = `<div class="ed-truth"><h4>The truth (only a simulator can show it)</h4><dl class="kv"><dt>True effect in these positions</dt><dd>${sgn(truth)} g</dd><dt>Your estimate</dt><dd>${sgn(A.est)} g</dd><dt>Expected estimate of this particular layout</dt><dd>${sgn(runRes.exp)} g (${Math.abs(bias) < 0.5 ? 'no bias' : `${p.design === 'systematic' ? 'bias' : 'chance imbalance'} ${sgn(bias)} g`})</dd><dt>Random error of this run</dt><dd>${sgn(A.est - runRes.exp)} g</dd>${A.kind !== 'pseudo' ? `<dt>Same data, plants wrongly used as replicates</dt><dd><i>F</i>(${PL.df1}, ${PL.df2}) = ${num(PL.F, 2)}, ${apaP(PL.p)}</dd>` : ''}</dl><p class="muted" style="margin:6px 0 0;font-size:.82rem">${p.design === 'systematic' ? 'A systematic layout has the same bias in every repetition — it never averages out.' : p.design === 'pseudo' ? 'With one tray per treatment the layout decides which tray (and position) represents each treatment: the “effect” includes the tray and position effects.' : 'Randomisation makes chance imbalances average to zero over many experiments: the estimate is unbiased.'}</p></div>`;
  el.innerHTML = `<div class="ed-apa"><p>${apa}</p></div><div class="ed-res-grid"><div>${table}${means}</div><div>${extra}${truthBox}</div></div>`;
}
function planSummary(p) {
  const d = p.design, t = p.t, r = p.r, n = p.n;
  if (d === 'pseudo') return `${t} trays (one per treatment) with ${n} plants each, placed at random within the ${r}-shelf area. The plants will be analysed as if they were ${n} replicates per treatment.`;
  if (d === 'rcbd') return `${t * r} trays: each of the ${r} shelves (blocks) holds every treatment once, in a random order. ${n} plants per tray; the analysis uses the ${t * r} tray means with shelf as block.`;
  if (d === 'crd') return `${t * r} trays: the ${t} treatments are assigned completely at random to the ${t * r} positions on ${r} shelves. ${n} plants per tray; the analysis uses the tray means.`;
  return `${t * r} trays placed in groups, treatment by treatment, filling the shelves from the top of rack A — the way a busy person loads a rack. ${n} plants per tray.`;
}

/* =====================================================================
   Readouts, HUD
   ===================================================================== */
function updateStatic() {
  const p = params(); const names = trtNames(p);
  const units = p.design === 'pseudo' ? p.t : p.t * p.r;
  ro.set('units', units, p.design === 'pseudo' ? 'bad' : 'ok', p.design === 'pseudo' ? 'one tray per treatment — no replication' : `${p.t} treatments × ${p.r} trays · ${p.n} plants each`);
  const dfe = p.design === 'rcbd' ? (p.t - 1) * (p.r - 1) : p.design === 'pseudo' ? 0 : p.t * (p.r - 1);
  ro.set('dfe', String(dfe), dfe === 0 ? 'bad' : dfe < 6 ? 'warn' : 'ok', p.design === 'pseudo' ? `the naive plant-level test pretends ${p.t * (p.n - 1)}` : p.design === 'systematic' ? 'but treatment is confounded with position' : p.design === 'rcbd' ? `(t − 1)(r − 1) · ${p.r - 1} df used by shelves` : 't(r − 1)');
  const truth = SIM.trueEffect(p.t, p.r, simP(p));
  ro.set('truth', truth, null, `${names[p.t - 1]} vs ${names[0]}: ${sgn(p.delta * 100, 0)} %`);
  if (runRes && runRes.key === modelKey(p)) {
    const A = runRes.A; ro.set('est', A.est, null, `95 % CI [${num(A.ci[0], 1)}, ${num(A.ci[1], 1)}] g`);
    ro.set('p', A.p, A.p < p.alpha ? (p.delta === 0 || p.design === 'pseudo' || p.design === 'systematic' ? 'bad' : 'ok') : null, A.p < p.alpha ? (p.delta === 0 ? 'significant — a false positive!' : 'significant at α') : 'not significant');
  } else { ro.set('est', NaN, null, 'press Grow & harvest'); ro.set('p', NaN, null, '&nbsp;'); }
  const mc = MC && MC.key === mcKey(p) ? MC : null;
  if (mc) {
    const d = mc.designs[p.design]; const te = mc.truth;
    ro.set('bias', d.meanEst, Math.abs(d.meanEst - te) > Math.max(1.5, 3 * d.sdEst / Math.sqrt(d.est.length)) ? 'bad' : 'ok', `true ${sgn(te)} g · SD of estimates ${fmt(d.sdEst, 1)} g`);
    ro.set('power', 100 * d.power, p.delta === 0 ? null : d.power >= 0.8 ? 'ok' : d.power >= 0.5 ? 'warn' : 'bad', p.delta === 0 ? 'Δ = 0: this is the false-positive rate' : p.design === 'pseudo' || p.design === 'systematic' ? 'not trustworthy for this design' : 'target ≥ 80 %');
    const lim = p.alpha + 2.6 * Math.sqrt(p.alpha * (1 - p.alpha) / 1000);
    ro.set('fpr', 100 * d.fpr, d.fpr > lim ? 'bad' : 'ok', `α = ${p.alpha} · ${d.fpr > lim ? `${fmt(d.fpr / p.alpha, 1)} × too many` : 'as it should be'}`);
  } else { ro.set('bias', NaN, null, 'press Run 1000 times'); ro.set('power', NaN, null, '1000 simulated experiments'); ro.set('fpr', NaN, null, `should equal α = ${p.alpha}`); }
  hud.set('d', `<b>${SIM.DESIGNS[p.design].name}</b> · ${p.t} × ${p.design === 'pseudo' ? 1 : p.r} trays · ${p.n} plants/tray`);
  hud.set('r', runRes ? `Harvest ${runCount}: <b>${A_txt(runRes.A)}</b>` : 'Planning · seedlings just transplanted');
}
const A_txt = A => `F(${A.df1}, ${A.df2}) = ${num(A.F, 2)}, p ${A.p < 0.001 ? '< .001' : '= ' + nlz(A.p, 3)}`;

/* =====================================================================
   Monte Carlo
   ===================================================================== */
let MC = null, mcBusy = false;
const cEst = new Plot('#chart-est', { x: { label: 'Estimated effect, best − control', unit: 'g' }, y: { label: '', min: -0.35, max: 4.05, format: () => '' }, legend: false, crosshair: false, padding: { left: 118 } });
const cFpr = new BarChart('#chart-fpr', { y: { label: 'False positives', unit: '%', min: 0 }, legend: false });
const cPow = new Plot('#chart-power', { x: { label: 'Replicates per treatment n (pseudo: plants in the single tray)', min: 2, max: 8 }, y: { label: 'Share of experiments with p < α', min: 0, max: 1, format: v => Math.round(v * 100) + '%' }, legend: true });
const DCOL = { systematic: 'c3', crd: 'c1', rcbd: 'c0', pseudo: 'danger' };
function markMCStale() {
  const p = params(); const stale = MC && MC.key !== mcKey(p);
  ['st-est', 'st-fpr', 'st-pow'].forEach(id => { const e = $('#' + id); if (e) e.innerHTML = !MC ? 'Press <b>Run 1000 times</b> to fill this chart.' : stale ? '<span class="ed-warn">Settings changed since this Monte Carlo — press Run 1000 times again.</span>' : ''; });
  updateStatic();
}
function nextFrame() { return new Promise(res => requestAnimationFrame(() => setTimeout(res, 0))); }
async function runMonteCarlo() {
  if (mcBusy) return; mcBusy = true; bMC.disabled = true; const status = $('#ed-mc-status');
  const p = params(); const P = simP(p); const RUNS = 1000, SWEEP = 300; const xs = [2, 3, 4, 5, 6, 7, 8];
  const jobs = [];
  SIM.DESIGN_KEYS.forEach(d => { jobs.push({ d, kind: 'main', runs: RUNS, P, r: p.r }); jobs.push({ d, kind: 'null', runs: RUNS, P: { ...P, delta: 0 }, r: p.r }); });
  SIM.DESIGN_KEYS.forEach(d => xs.forEach(x => { const Pn = d === 'pseudo' ? { ...P, n: x } : P; const rr = d === 'pseudo' ? p.r : x; jobs.push({ d, kind: 'sw1', x, runs: SWEEP, P: Pn, r: rr }); jobs.push({ d, kind: 'sw0', x, runs: SWEEP, P: { ...Pn, delta: 0 }, r: rr }); }));
  const total = jobs.reduce((s, j) => s + j.runs, 0); let done = 0; let seed = 1000 + Math.floor(Math.random() * 1e6);
  const res = { key: mcKey(p), designs: {}, sweep: {}, truth: SIM.trueEffect(p.t, p.r, P), alpha: p.alpha, delta: p.delta };
  SIM.DESIGN_KEYS.forEach(d => { res.designs[d] = {}; res.sweep[d] = { x: xs, pow: [], fpr: [] }; });
  let t0 = performance.now();
  for (const j of jobs) {
    const out = SIM.monteCarlo({ design: j.d, t: p.t, r: j.r, P: j.P, runs: j.runs, seed: seed++, alpha: p.alpha });
    if (j.kind === 'main') { const e = Array.from(out.est); Object.assign(res.designs[j.d], { est: e, meanEst: S.mean(e), sdEst: S.sd(e), power: out.rate }); }
    else if (j.kind === 'null') { res.designs[j.d].fpr = out.rate; res.designs[j.d].estNull = Array.from(out.est); }
    else if (j.kind === 'sw1') res.sweep[j.d].pow.push(out.rate); else res.sweep[j.d].fpr.push(out.rate);
    done += j.runs;
    if (performance.now() - t0 > 40) { status.innerHTML = `Simulating… <b>${Math.round(100 * done / total)} %</b> (${done.toLocaleString('en-GB')} experiments)`; await nextFrame(); t0 = performance.now(); }
  }
  MC = res; mcBusy = false; bMC.disabled = false;
  status.innerHTML = `Done: ${total.toLocaleString('en-GB')} simulated experiments. Change a setting and run again to compare.`;
  drawMC(); markMCStale();
}
function kde(vals, xs, bw) { const n = vals.length, k = 1 / (n * bw * Math.sqrt(2 * Math.PI)); return xs.map(x => { let s = 0; for (const v of vals) { const z = (x - v) / bw; s += Math.exp(-0.5 * z * z); } return s * k; }); }
function drawMC() {
  if (!MC) return; const p = params(); const P = palette(); const te = MC.truth;
  // 1. ridgeline of estimated effects
  const all = SIM.DESIGN_KEYS.flatMap(d => MC.designs[d].est); const lo = S.quantile(all, 0.003), hi = S.quantile(all, 0.997); const span = hi - lo || 1;
  const xs = linspace(lo - 0.08 * span, hi + 0.08 * span, 160);
  const dens = SIM.DESIGN_KEYS.map(d => { const e = MC.designs[d].est; const bw = 1.06 * Math.max(S.sd(e), 0.5) * Math.pow(e.length, -0.2); return kde(e, xs, bw); });
  const dmax = Math.max(...dens.flat());
  cEst.clear(); cEst.setAxis('x', { min: xs[0], max: xs[xs.length - 1] });
  cEst.custom('ridges', (ctx, pl, pal) => {
    SIM.DESIGN_KEYS.forEach((d, i) => {
      const row = 3 - i; const base = pl.py(row), top = pl.py(row + 0.92); const col = colorOf(DCOL[d], pal);
      ctx.beginPath(); ctx.moveTo(pl.px(xs[0]), base); xs.forEach((x, k) => ctx.lineTo(pl.px(x), base - (base - top) * dens[i][k] / dmax)); ctx.lineTo(pl.px(xs[xs.length - 1]), base); ctx.closePath();
      ctx.fillStyle = withAlpha(col, d === p.design ? 0.42 : 0.2); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = d === p.design ? 2.4 : 1.5; ctx.stroke();
      const D = MC.designs[d]; const mX = pl.px(D.meanEst);
      ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(mX, base); ctx.lineTo(mX, base - (base - top) * 0.55); ctx.stroke();
      ctx.strokeStyle = withAlpha(pal.muted.startsWith('#') ? pal.muted : '#888888', 0.45); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pl.plotRect.left, base + 0.5); ctx.lineTo(pl.plotRect.left + pl.plotRect.width, base + 0.5); ctx.stroke();
    });
  });
  // row labels are text items (drawn outside the clipped plot area)
  SIM.DESIGN_KEYS.forEach((d, i) => {
    const D = MC.designs[d]; const row = 3 - i;
    cEst.text('lab' + d, xs[0], row + 0.36, SIM.DESIGNS[d].short, { align: 'right', dx: -10, color: DCOL[d], size: 12.5, weight: d === p.design ? 750 : 650 });
    cEst.text('sub' + d, xs[0], row + 0.1, `${sgn(D.meanEst)} ± ${fmt(D.sdEst, 1)} g`, { align: 'right', dx: -10, color: 'muted', size: 10.5, weight: 500 });
  });
  cEst.vline('truth', te, { color: 'ink', dash: [5, 4], label: `true effect ${sgn(te)} g` });
  cEst.vline('zero', 0, { color: 'muted', dash: [2, 3], label: '' });
  // 2. false-positive rates
  const lim = p.alpha + 2.6 * Math.sqrt(p.alpha * (1 - p.alpha) / 1000);
  cFpr.set(SIM.DESIGN_KEYS.map(d => SIM.DESIGNS[d].short), [{ label: 'False positives', values: SIM.DESIGN_KEYS.map(d => 100 * MC.designs[d].fpr), colors: SIM.DESIGN_KEYS.map(d => MC.designs[d].fpr > lim ? 'danger' : DCOL[d]), format: v => v.toFixed(1) + ' %' }]);
  cFpr.refLine(100 * MC.alpha, `α = ${MC.alpha}`, 'amber');
  // 3. power and false positives versus replication
  cPow.clear();
  cPow.hline('alpha', MC.alpha, { color: 'amber', label: `α = ${MC.alpha}` });
  SIM.DESIGN_KEYS.forEach(d => {
    const s = MC.sweep[d]; const col = DCOL[d];
    if (MC.delta > 0) cPow.line('p' + d, s.x, s.pow, { color: col, width: d === p.design ? 3 : 2, label: SIM.DESIGNS[d].short });
    cPow.line('f' + d, s.x, s.fpr, { color: col, width: 1.6, dash: [5, 4], label: MC.delta > 0 ? '' : SIM.DESIGNS[d].short, noLegend: MC.delta > 0 });
    cPow.scatter('m' + d, s.x, MC.delta > 0 ? s.pow : s.fpr, { color: col, r: d === p.design ? 4 : 2.8 });
  });
  cPow.vline('now', p.r, { color: 'muted', label: `r = ${p.r}` });
  $('#pow-sub').innerHTML = MC.delta > 0 ? `Solid: power at the true effect (${sgn(MC.delta * 100, 0)} %). Dashed: false positives when Δ = 0. 300 experiments per point; binomial error ≈ ±5 percentage points.` : 'True effect Δ = 0, so every rejection is a false positive (dashed). 300 experiments per point.';
}
const colorOf = (k, pal) => (/^c\d$/.test(k) ? categorical(+k.slice(1)) : pal[k] || k);
document.addEventListener('ffp:theme', () => { drawPlan(); if (MC) drawMC(); });

/* =====================================================================
   Frame loop: gliding trays and growing plants
   ===================================================================== */
const easeIO = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
stage.onFrame((dt, t) => {
  let dirty = false; const now = performance.now();
  if (glide) {
    const k = Math.min(1, (now - glide.t0) / glide.dur), e = easeIO(k);
    pool.forEach(o => { if (!o.from || !o.to) return; o.group.position.lerpVectors(o.from.pos, o.to.pos, e); o.group.position.y += Math.sin(Math.PI * e) * 0.06 * (o.from.pos.distanceTo(o.to.pos) > 0.01 ? 1 : 0); o.group.rotation.y = o.from.rotY + (o.to.rotY - o.from.rotY) * e; });
    if (k >= 1) glide = null; dirty = true;
  }
  if (grow) {
    const k = Math.min(1, (now - grow.t0) / grow.dur), e = 1 - Math.pow(1 - k, 2.2);
    plants.forEach(pl => { pl.s = pl.sFrom + (pl.sTo - pl.sFrom) * e; });
    if (k >= 1) grow = null; dirty = true;
  }
  if (dirty) writePlants();
  if (airGroup.visible) flows.forEach(f => f.update(dt));
});

/* =====================================================================
   Wiring
   ===================================================================== */
let lastLayoutKey = '', lastModelKey = '';
ui.onChange(() => {
  const p = params();
  const lk = layoutKey(p), mk = modelKey(p);
  if (lk !== lastLayoutKey) { lastLayoutKey = lk; lastModelKey = mk; relayout(false); }
  else if (mk !== lastModelKey) { lastModelKey = mk; runRes = null; buildPlants(p); writePlants(); buildHeat(p); drawPlan(); renderAnalysis(); markMCStale(); }
  else { buildHeat(p); drawPlan(); showPick(); markMCStale(); }
  airGroup.visible = p.air; doorLabel.visible = p.air || p.reveal === 'temp';
  renderLegend(p, p.reveal !== 'none' ? fieldRange(p.reveal, p.G) : null);
});
{ const p = params(); lastLayoutKey = layoutKey(p); lastModelKey = modelKey(p); relayout(false); airGroup.visible = p.air; doorLabel.visible = p.air || p.reveal === 'temp'; markMCStale(); }
window.__ed = { SIM, params, get layout() { return layout; }, get run() { return runRes; }, get mc() { return MC; }, runOnce, runMonteCarlo };
