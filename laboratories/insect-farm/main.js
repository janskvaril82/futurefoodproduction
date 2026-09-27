/* Insect farm laboratory — UI, batch dynamics, charts, life cycle and carbon balance.
   Model: ./model.js (Derive tab, Eqs. I1–I11). Scene: ./scene.js. */
import { createStage, THREE, studioLights } from '/assets/js/lab3d.js';
import { Controls, Readouts, SimClock, fmt, hudChips } from '/assets/js/ui.js';
import { Plot, BarChart, Sankey, linspace } from '/assets/js/plot.js';
import { colormapGradient, palette, withAlpha } from '/assets/js/colors.js';
import { SPECIES, simulate, facility, lifeCycle, COMPARE, CRATE } from './model.js';
import { buildFarm } from './scene.js';

const dietOpts = sp => Object.entries(SPECIES[sp].diets).map(([value, d]) => ({ value, label: d.label + (d.eu === 'ok' ? '  ✓ EU' : '  ✗ not permitted in EU') }));

/* ------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'th', label: 'Harvest after', unit: 'd', digits: 0 })
  .add({ id: 'mf', label: 'Mean larval mass at harvest', unit: 'mg', digits: 0 })
  .add({ id: 'surv', label: 'Survival to harvest', unit: '%', digits: 0 })
  .add({ id: 'fcr', label: 'Feed conversion ratio (DM feed / fresh gain)', unit: 'kg kg⁻¹', digits: 2 })
  .add({ id: 'eci', label: 'ECI (dry gain / dry feed)', unit: '%', digits: 1 })
  .add({ id: 'fpp', label: 'Feed per kg larval protein', unit: 'kg kg⁻¹', digits: 1 })
  .add({ id: 'frass', label: 'Frass per kg larvae', unit: 'kg DM kg⁻¹', digits: 2 })
  .add({ id: 'co2', label: 'Respired CO₂ per kg larvae', unit: 'kg kg⁻¹', digits: 2 })
  .add({ id: 'tl', label: 'Peak larval-mass temperature', unit: '°C', digits: 1 })
  .add({ id: 'wkg', label: 'Metabolic heat (batch mean)', unit: 'W kg⁻¹', digits: 1 })
  .add({ id: 'heat', label: 'Heat load of the rearing room', unit: 'W m⁻² floor', digits: 0 })
  .add({ id: 'vent', label: 'Ventilation required', unit: 'm³ h⁻¹ m⁻²', digits: 0 })
  .add({ id: 'prot', label: 'Protein output', unit: 'kg m⁻² yr⁻¹', digits: 1 })
  .add({ id: 'eu', label: 'EU feed-law status of the substrate', unit: '', format: v => v });

ui.section('Species & substrate');
ui.segmented({ id: 'species', label: 'Species', options: [{ value: 'mealworm', label: 'Mealworm' }, { value: 'bsf', label: 'Black soldier fly' }], value: 'mealworm' });
ui.select({ id: 'dietMW', label: 'Mealworm substrate', options: dietOpts('mealworm'), value: 'bran_carrot' });
ui.select({ id: 'dietBSF', label: 'BSF substrate', options: dietOpts('bsf'), value: 'chicken' });
ui.section('Climate');
ui.slider({ id: 'Tair', label: 'Room air temperature', min: 15, max: 38, step: 0.5, value: 27, unit: '°C' });
ui.slider({ id: 'RH', label: 'Relative humidity', min: 40, max: 90, step: 1, value: 65, unit: '%' });
ui.slider({ id: 'v', label: 'Air speed over the crates', min: 0.1, max: 2.5, step: 0.05, value: 1.0, unit: 'm s⁻¹', help: 'Forced ventilation between stacked crates' });
ui.section('Stocking & facility');
ui.slider({ id: 'density', label: 'Stocking density (start of batch)', min: 0.2, max: 15, step: 0.1, value: 1.5, unit: 'larvae cm⁻²', help: '60 × 40 cm crate = 2400 cm²' });
ui.slider({ id: 'levels', label: 'Crates per stack', min: 4, max: 20, step: 1, value: 12 });
ui.slider({ id: 'area', label: 'Rearing floor area', min: 20, max: 2000, step: 1, value: 200, unit: 'm²', log: true });
ui.slider({ id: 'dTs', label: 'Supply air below room temperature', min: 2, max: 10, step: 0.5, value: 5, unit: 'K' });
ui.slider({ id: 'co2max', label: 'CO₂ limit in the room', min: 1000, max: 5000, step: 100, value: 3000, unit: 'ppm', help: 'EU/Swedish 8-h occupational limit: 5000 ppm' });
ui.section('Simulation & view');
const [playBtn] = ui.buttons([{ label: '❚❚ Pause', variant: 'primary', onClick: () => clock.toggle() }, { label: 'New batch', onClick: () => { tDay = 0; batches = 0; } }]);
ui.segmented({ id: 'speed', label: 'Days per second', options: [{ value: 0.5, label: '½' }, { value: 2, label: '2' }, { value: 8, label: '8' }], value: 2 });
ui.toggle({ id: 'thermal', label: 'Thermal view (crates coloured by larval temperature)', value: false });
ui.toggle({ id: 'labels', label: 'Show labels', value: true });
ui.buttons([{ label: 'Overview', onClick: () => tour('home') }, { label: 'Mealworms', onClick: () => tour('mw') }, { label: 'BSF & flies', onClick: () => tour('bsf') }, { label: 'Sieving', onClick: () => tour('sieve') }]);
ui.presets([
  { label: 'Mealworm, standard', values: { species: 'mealworm', dietMW: 'bran_carrot', Tair: 27, RH: 65, v: 1.0, density: 1.5, levels: 12 } },
  { label: 'Mealworm, crowded & hot', values: { species: 'mealworm', dietMW: 'bran_carrot', Tair: 31, RH: 60, v: 0.3, density: 5, levels: 16 } },
  { label: 'BSF on chicken feed', values: { species: 'bsf', dietBSF: 'chicken', Tair: 27, RH: 65, v: 1.0, density: 4, levels: 12 } },
  { label: 'BSF on food waste', title: 'Efficient, but catering waste is not a permitted substrate in the EU', values: { species: 'bsf', dietBSF: 'food_waste', Tair: 27, RH: 65, v: 1.0, density: 4, levels: 12 } },
  { label: 'BSF, no airflow', values: { species: 'bsf', dietBSF: 'chicken', Tair: 30, RH: 70, v: 0.1, density: 8, levels: 12 } }
]);
ui.saveButton('insect-farm', () => ro.values());

/* ------------------------------------------------------------ stage */
const stage = createStage('#stage', {
  background: '#0c1113', envIntensity: 0.5, exposure: 0.95,
  camera: { pos: [-0.5, 4.5, 9.4], target: [-0.5, 0.85, -1.1], fov: 46 },
  controls: { minDistance: 0.25, maxDistance: 16 },
  bloom: { strength: 0.3, radius: 0.4, threshold: 1.0 }, ao: { radius: 0.2, intensity: 0.7 }
});
const lights = studioLights(stage, { intensity: 0.85, shadowSize: 8, keyPos: [4, 9, 6] });
lights.key.target.position.set(0, 0, -1);
const farm = buildFarm(stage);
const hud = hudChips(stage.el);
const legend = document.createElement('div'); legend.className = 'stage-legend'; stage.el.appendChild(legend);

const labels = {};
const lab = (k, pos, cls) => (labels[k] = stage.addLabel(pos, '', cls ? { className: cls } : undefined));
lab('mw', farm.anchors.mwStack); lab('bsf', farm.anchors.bsfRack); lab('cage', farm.anchors.cage); lab('clim', farm.anchors.climate);
lab('sieve', farm.anchors.sieve); lab('mwc', farm.anchors.mwCrate); lab('bsfc', farm.anchors.bsfCrate);
const inspector = stage.addLabel([0, -10, 0], '', { className: 'label3d lg' }); inspector.visible = false;

/* ------------------------------------------------------------ model state */
let tDay = Math.max(0, +(new URLSearchParams(location.search).get('day')) || 0), batches = 0, resMW = null, resBSF = null, F = null, key = '';
const P = () => ui.values();
const params = (sp, p) => ({ species: sp, diet: sp === 'mealworm' ? p.dietMW : p.dietBSF, Tair: p.Tair, RH: p.RH, v: p.v, density: sp === p.species ? p.density : SPECIES[sp].density.def });
const facP = p => ({ levels: p.levels, area: p.area, dTsupply: p.dTs, co2max: p.co2max, Tair: p.Tair, RH: p.RH });
const active = () => (P().species === 'mealworm' ? resMW : resBSF);
function recompute() {
  const p = P(); const k = JSON.stringify([p.species, p.dietMW, p.dietBSF, p.Tair, p.RH, p.v, p.density, p.levels, p.area, p.dTs, p.co2max]);
  if (k === key) return; key = k;
  resMW = simulate(params('mealworm', p)); resBSF = simulate(params('bsf', p));
  F = facility(active(), facP(p));
  if (farm.mwLevels !== Math.min(16, p.levels)) farm.buildStacks(p.levels);
  if (tDay > active().tHarvest) tDay = 0;
  updateReadouts(); scheduleCharts();
}
function updateReadouts() {
  const p = P(), r = active(), sp = SPECIES[p.species];
  ro.set('th', r.tHarvest, null, `cycle ${fmt(r.cycle, 0)} d incl. ${sp.turnaround} d turnaround · ${fmt(F.cyclesYr, 1)} cycles yr⁻¹`);
  ro.set('mf', r.mFinal, null, `${fmt(r.Nfinal, 0)} larvae per crate`);
  ro.set('surv', r.survival * 100, r.survival > 0.85 ? 'ok' : r.survival > 0.65 ? 'warn' : 'bad');
  const lit = p.species === 'mealworm' ? [3.3, 5.3] : [1.2, 2.3];
  ro.set('fcr', r.FCR, r.FCR <= lit[1] ? 'ok' : r.FCR <= lit[1] * 1.4 ? 'warn' : 'bad', `good practice ≈ ${lit[0]}–${lit[1]} (see Sources)`);
  ro.set('eci', r.ECI * 100, null, p.species === 'mealworm' ? 'Oonincx et al. 2015: 8–21 %' : 'Oonincx et al. 2015: 23–27 %');
  ro.set('fpp', r.feedPerProtein, null, `larvae: ${fmt(sp.DM * 100, 0)} % DM, ${fmt(sp.prot * 100, 0)} % protein in DM`);
  ro.set('frass', r.frassPerKg, null, `${fmt(F.frassYr / 1000, 0)} t DM yr⁻¹ for the room`);
  ro.set('co2', r.co2PerKg, null, 'biogenic, from respiration (Eq. I6)');
  ro.set('tl', r.peakTl, r.peakTl < sp.stress ? 'ok' : r.peakTl < sp.stress + 2.5 ? 'warn' : 'bad', `air ${fmt(p.Tair, 1)} °C · stress above ≈ ${sp.stress} °C`);
  ro.set('wkg', r.meanWkg, null, `peak ${fmt(r.peakWkg, 0)} W kg⁻¹ (young larvae)`);
  ro.set('heat', F.heatPerM2, null, `${fmt(F.avgHeatW / 1000, 1)} kW metabolic for ${fmt(p.area, 0)} m²; evaporation takes ${fmt(F.latentW / 1000, 1)} kW (${fmt(F.evapKgDay, 0)} kg water d⁻¹)`);
  ro.set('vent', F.Vreq / p.area, null, `set by ${F.governs} · heat ${fmt(F.Vheat / p.area, 0)} · CO₂ ${fmt(F.Vco2 / p.area, 0)} · moisture ${fmt(Math.min(F.Vhum, 1e6) / p.area, 0)} m³ h⁻¹ m⁻²`);
  ro.set('prot', F.proteinPerM2, null, `${fmt(F.proteinYr / 1000, 1)} t protein yr⁻¹; ${fmt(F.cratesPerM2, 1)} crates m⁻²`);
  const d = r.diet; ro.set('eu', d.eu === 'ok' ? 'Permitted' : 'Not permitted', d.eu === 'ok' ? 'ok' : 'bad', d.note);
}
function sample(r, t) {
  const S = r.series; if (!S.t.length) return { m: r.mFinal, N: r.Nfinal, Tl: r.peakTl, flux: 0 };
  let i = S.t.findIndex(x => x > t); if (i < 0) i = S.t.length - 1; if (i === 0) i = 1;
  const f = Math.min(1, Math.max(0, (t - S.t[i - 1]) / Math.max(1e-9, S.t[i] - S.t[i - 1])));
  const L = (a) => a[i - 1] + (a[i] - a[i - 1]) * f;
  return { m: L(S.m), N: L(S.N), Tl: L(S.Tl), flux: L(S.flux) };
}

/* ------------------------------------------------------------ clock & frame loop */
const clock = new SimClock({
  speed: +P().speed, maxDt: 0.25,
  onStep: dt => { tDay += dt; const r = active(); if (r && tDay >= r.tHarvest) { tDay = 0; batches++; FFPtoast(`Harvest! Batch ${batches} sieved: larvae separated from frass.`); } }
});
function FFPtoast(msg) { try { window.FFP && FFP.toast && FFP.toast(msg); } catch (e) { } }
clock.onState(r => { playBtn.innerHTML = r ? '❚❚ Pause' : '▶ Run'; });
stage.onKey('space', () => clock.toggle());
let acc = 1;
stage.onFrame((dt, t) => {
  if (!resMW) return;
  const p = P();
  const sMW = sample(resMW, p.species === 'mealworm' ? tDay : (tDay / active().tHarvest) * resMW.tHarvest);
  const sB = sample(resBSF, p.species === 'bsf' ? tDay : (tDay / active().tHarvest) * resBSF.tHarvest);
  acc += dt;
  if (acc > 0.2) {
    acc = 0;
    const fMW = Math.min(1, sMW.m / resMW.mFinal), fB = Math.min(1, sB.m / resBSF.mFinal);
    farm.setState({ mwMass: sMW.m, bsfMass: sB.m, mwSurv: sMW.N / resMW.N0, bsfSurv: sB.N / resBSF.N0, mwFrac: fMW, bsfFrac: fB, mwTl: sMW.Tl, bsfTl: sB.Tl, thermal: p.thermal, airFlow: Math.min(1.5, p.v) });
    const r = active(), s = p.species === 'mealworm' ? sMW : sB, sp = SPECIES[p.species];
    hud.set('d', `Batch day <b>${fmt(tDay, 0)}</b> of ${fmt(r.tHarvest, 0)} · ${sp.label.toLowerCase()}`);
    hud.set('m', `Mean larva <b>${fmt(s.m, s.m < 10 ? 1 : 0)} mg</b> · alive <b>${fmt(s.N / r.N0 * 100, 0)} %</b>`);
    hud.set('T', `Larval mass <b>${fmt(s.Tl, 1)} °C</b> (air ${fmt(p.Tair, 1)} °C) · ${fmt(s.flux, 0)} W m⁻²`);
    updateLabels(sMW, sB);
    farm.setHMI({ T: p.Tair, RH: p.RH, co2: roomCO2(), V: F.Vreq, kW: F.avgHeatW / 1000 });
    growthPlot.vline('now', tDay, { color: 'magenta', label: `day ${fmt(tDay, 0)}` });
    drawLifeCycle();
  }
  farm.animate(dt, t, clock.running);
});
function roomCO2() { const g = F.co2Yr * 1000 / (365 * 24);  /* g h⁻¹ */ return 420 + g / 1808 / Math.max(1, F.Vreq) * 1e6; }
function updateLabels(sMW, sB) {
  const p = P(), on = p.labels;
  const cam = stage.camera.position; const near = { cage: 8, sieve: 8, mwc: 6, bsfc: 6 };
  Object.entries(labels).forEach(([k, l]) => { const lp = new THREE.Vector3(); l.getWorldPosition(lp); l.visible = on && (!near[k] || cam.distanceTo(lp) < near[k]); });
  labels.mw.element.innerHTML = `Mealworm crate stacks<small>${Math.min(16, p.levels)} crates high on dollies · larvae ${fmt(sMW.m, 0)} mg · ${fmt(sMW.Tl, 1)} °C</small>`;
  labels.bsf.element.innerHTML = `BSF larval racks<small>substrate crates, 6 shelves · larvae ${fmt(sB.m, 0)} mg · ${fmt(sB.Tl, 1)} °C</small>`;
  labels.cage.element.innerHTML = 'Adult fly cage<small>light-triggered mating · eggs laid in cardboard flutes</small>';
  labels.clim.element.innerHTML = `Air-handling unit<small>${fmt(F.Vreq, 0)} m³ h⁻¹ · ${fmt(F.avgHeatW / 1000, 1)} kW · CO₂ ${fmt(roomCO2(), 0)} ppm</small>`;
  labels.sieve.element.innerHTML = `Sieving station<small>larvae → crate · frass → big bag (${fmt(active().frassPerKg, 2)} kg DM per kg larvae)</small>`;
  labels.mwc.element.innerHTML = `Mealworms in wheat bran<small>${fmt(sMW.m, sMW.m < 10 ? 1 : 0)} mg · ${fmt(28 * Math.cbrt(Math.max(0.05, sMW.m) / 140), 0)} mm long</small>`;
  labels.bsfc.element.innerHTML = `BSF larvae in substrate<small>${fmt(sB.m, sB.m < 10 ? 1 : 0)} mg · ${fmt(22 * Math.cbrt(Math.max(0.05, sB.m) / 200), 0)} mm long</small>`;
  const lo = 18, hi = 42;
  legend.style.display = p.thermal ? '' : 'none';
  legend.innerHTML = `Larval-mass temperature (°C)<div class="cbar" style="background:${colormapGradient('turbo')}"></div><div class="cbar-ticks"><span>${lo}</span><span>${(lo + hi) / 2}</span><span>${hi}</span></div>`;
}
stage.onPick({
  objects: () => farm.pickRoots(),
  onClick: hit => {
    if (!hit) { inspector.visible = false; return; }
    let o = hit.object; while (o && !o.userData.info) o = o.parent;
    const info = o && o.userData.info; if (!info) { inspector.visible = false; return; }
    inspector.position.copy(hit.point).add(new THREE.Vector3(0, 0.08, 0)); inspector.visible = true;
    inspector.element.innerHTML = infoHTML(info.kind);
  }
});
function infoHTML(kind) {
  const p = P(), r = active();
  const map = {
    mwstack: () => `Mealworm crate (60 × 40 cm)<small>${fmt(resMW.N0, 0)} larvae at start · harvest ${fmt(resMW.biomass / 1000, 2)} kg after ${fmt(resMW.tHarvest, 0)} d</small>`,
    bsfrack: () => `BSF rearing crate<small>${fmt(resBSF.N0, 0)} larvae · ${fmt(resBSF.biomass / 1000, 2)} kg after ${fmt(resBSF.tHarvest, 0)} d · peak ${fmt(resBSF.peakTl, 1)} °C</small>`,
    cage: () => 'Adult black soldier flies<small>adults do not feed; they mate in light and lay 400–500 eggs each (Chia et al. 2018)</small>',
    climate: () => `Climate unit<small>sensible ${fmt(F.sensW / 1000, 1)} kW + latent ${fmt(F.latentW / 1000, 1)} kW · evaporates ${fmt(F.evapKgDay, 0)} kg water d⁻¹</small>`,
    sieve: () => `Vibrating sieve<small>separates larvae from frass (${fmt(F.frassYr / 1000, 0)} t DM yr⁻¹, a fertiliser)</small>`,
    mwcrate: () => `Mealworm crate on the inspection table<small>ECI ${fmt(resMW.ECI * 100, 1)} % · FCR ${fmt(resMW.FCR, 2)}</small>`,
    bsfcrate: () => `BSF crate<small>ECI ${fmt(resBSF.ECI * 100, 1)} % · FCR ${fmt(resBSF.FCR, 2)}</small>`
  };
  return (map[kind] || (() => ''))();
}
const VIEWS = { home: [[-0.5, 4.5, 9.4], [-0.5, 0.85, -1.1]], mw: [[-4.75, 1.45, 3.55], [-5.35, 0.96, 2.72]], bsf: [[3.0, 1.45, 3.55], [2.45, 0.86, 2.7]], sieve: [[-1.0, 1.9, 4.6], [-2.2, 0.95, 2.8]] };
function tour(k) { stage.flyTo(VIEWS[k][0], VIEWS[k][1], 1.5); }

/* ------------------------------------------------------------ charts */
const growthPlot = new Plot('#chart-growth', { x: { label: 'Day of batch', unit: 'd', min: 0 }, y: { label: 'Mean larval mass', unit: 'mg', min: 0 }, y2: { label: 'Survival', unit: '%', min: 0, max: 100 } });
const heatPlot = new Plot('#chart-heat', { x: { label: 'Stocking density', unit: 'larvae cm⁻²', min: 0 }, y: { label: 'Peak larval-mass temperature', unit: '°C' } });
const cmpChart = new BarChart('#chart-compare', { y: { label: '', unit: '', min: 0 }, horizontal: true, stacked: true, height: 250, legend: false });
const sankey = document.getElementById('sankey-carbon') ? new Sankey('#sankey-carbon', { unit: 'kg C', height: 240, digits: 2 }) : null;
let chartTimer = null;
function scheduleCharts() { clearTimeout(chartTimer); chartTimer = setTimeout(drawCharts, 120); }
function drawCharts() {
  const p = P(), sp = p.species, r = active();
  // growth curves at T−4, T, T+4
  [[-4, 'water', [6, 4], 'air − 4 °C'], [0, 'accent', null, `air ${fmt(p.Tair, 1)} °C`], [4, 'danger', [6, 4], 'air + 4 °C']].forEach(([dT, c, dash, labl], i) => {
    const rr = dT === 0 ? r : simulate(Object.assign(params(sp, p), { Tair: p.Tair + dT }));
    growthPlot.line('g' + i, rr.series.t, rr.series.m, { color: c, width: dT === 0 ? 2.6 : 1.8, dash, label: labl });
    if (dT === 0) growthPlot.line('s', rr.series.t, rr.series.N.map(n => n / rr.N0 * 100), { color: 'muted', width: 1.5, dash: [2, 3], label: 'survival (right axis)', y2: true });
  });
  growthPlot.setAxis('x', { min: 0, max: Math.ceil(Math.max(r.tHarvest * 1.25, 10)) });
  // heat vs density
  const D = SPECIES[sp].density; const ds = linspace(D.min, D.max, 14);
  const temps = sp === 'mealworm' ? [21, 24, 27, 30] : [20, 24, 28, 32];
  temps.forEach((T, i) => {
    const ys = ds.map(d => simulate(Object.assign(params(sp, p), { Tair: T, density: d }), { keepSeries: false, dt: sp === 'mealworm' ? 0.25 : 0.05 }).peakTl);
    heatPlot.line('h' + i, ds, ys, { color: ['water', 'c4', 'amber', 'danger'][i], width: 2, label: `air ${T} °C` });
  });
  heatPlot.hregion('stress', SPECIES[sp].stress, 46, { color: 'danger', alpha: 0.08, label: 'heat stress / mortality' });
  heatPlot.point('now', p.density, r.peakTl, { color: 'magenta', r: 6, label: 'now' });
  heatPlot.setAxis('x', { min: 0, max: D.max });
  drawCompare();
  if (sankey) {
    const kgL = r.biomass;                                             // g fresh larvae per crate → values per kg larvae
    const larvGain = (r.biomass - r.N0 * SPECIES[sp].m0 / 1000) * SPECIES[sp].DM * 0.5;   // g C per crate
    const larvC = larvGain / kgL, deadC = Math.max(0, r.gainC - larvGain) / kgL, co2C = r.co2C / kgL, frC = r.frassC / kgL;
    const nodes = [{ id: 'feed', label: 'Carbon in feed', color: 'amber' }, { id: 'lar', label: 'Harvested larvae', color: 'accent' }, { id: 'co2', label: 'CO₂ (respiration)', color: 'muted' }, { id: 'fr', label: 'Frass (egested)', color: 'c5' }];
    const links = [{ source: 'feed', target: 'lar', value: larvC, color: 'accent' }, { source: 'feed', target: 'co2', value: co2C, color: 'muted' }, { source: 'feed', target: 'fr', value: frC, color: 'c5' }];
    if (deadC > 0.01 * (larvC + co2C + frC)) { nodes.push({ id: 'dead', label: 'Dead larvae', color: 'danger' }); links.push({ source: 'feed', target: 'dead', value: deadC, color: 'danger' }); }
    sankey.set({ nodes, links });
    const s = document.getElementById('sankey-note'); if (s) s.textContent = `Per kg of harvested fresh ${SPECIES[sp].label.toLowerCase()} larvae: ${fmt(r.feed / r.biomass, 2)} kg feed dry matter containing ${fmt(r.feedC / r.biomass, 2)} kg C → ${fmt(larvC, 3)} kg C in larvae, ${fmt(co2C, 3)} kg C respired (${fmt(r.co2PerKg, 2)} kg CO₂), ${fmt(frC, 3)} kg C in frass${deadC > 0.001 ? `, ${fmt(deadC, 3)} kg C in larvae that died` : ''}.`;
  }
  drawLifeCycle(true);
}
const cmpSel = document.getElementById('cmp-metric');
if (cmpSel) cmpSel.addEventListener('change', drawCompare);
document.addEventListener('ffp:theme', () => { if (F) drawCompare(); });
function drawCompare() {
  const m = cmpSel ? cmpSel.value : 'feed'; const C = COMPARE[m]; const p = P(), r = active();
  const rows = C.rows.map(x => Object.assign({}, x));
  if (m === 'feed') rows.unshift({ k: `This farm (${SPECIES[p.species].label.toLowerCase()})`, lo: r.FCR, hi: r.FCR, model: true });
  if (m === 'land') rows.unshift({ k: 'This farm: rearing floor only', lo: 1 / Math.max(1e-6, F.proteinPerM2), hi: 1 / Math.max(1e-6, F.proteinPerM2), model: true });
  const insect = k => /farm|worm|cricket|BSF|Mealworm/i.test(k);
  cmpChart.y.label = C.label; cmpChart.y.unit = C.unit;
  cmpChart.set(rows.map(x => x.k), [
    { label: 'value (lower bound of range)', values: rows.map(x => x.lo), colors: rows.map(x => x.model ? 'magenta' : insect(x.k) ? 'accent' : 'amber') },
    { label: 'upper end of the reported range', values: rows.map(x => Math.max(0, x.hi - x.lo)), colors: rows.map(x => { const P_ = palette(); return withAlpha(x.model ? P_.magenta : insect(x.k) ? P_.accent : P_.amber, 0.42); }) }
  ]);
  const n = document.getElementById('cmp-note'); if (n) n.textContent = 'Dark bar: reported value (lower end of a range); light extension: upper end of the range. Magenta: this farm. ' + C.note + (m === 'feed' ? ' This farm: kg feed dry matter per kg fresh larvae (the whole larva is edible).' : m === 'land' ? ' This farm: m² of rearing floor per kg protein per year (feed land not included).' : '');
}

/* ------------------------------------------------------------ life-cycle diagram (SVG) */
const lcEl = document.getElementById('lifecycle');
let lcKey = '';
function drawLifeCycle(force) {
  if (!lcEl || !resMW) return;
  const p = P(), sp = p.species, r = active();
  const stages = lifeCycle(sp, p.Tair, r.tHarvest);
  const prog = Math.min(1, tDay / r.tHarvest);
  const k = [sp, p.Tair, Math.round(r.tHarvest), Math.round(prog * 40)].join('|');
  if (!force && k === lcKey) return; lcKey = k;
  const W = 520, H = 318, cx = 260, cy = 150, R = 108;
  const pos = [[cx, cy - R], [cx + R * 1.45, cy], [cx, cy + R], [cx - R * 1.45, cy]];
  const icon = (i, x, y) => {
    const mw = sp === 'mealworm';
    if (i === 0) return `<g transform="translate(${x},${y})">${[[-8, -2], [0, 4], [8, -3], [-2, -8], [6, 6]].map(([a, b]) => `<ellipse cx="${a}" cy="${b}" rx="4" ry="2.6" fill="#efe6cf" stroke="#b59f73" stroke-width="0.8"/>`).join('')}</g>`;
    if (i === 1) { const segs = 11; let s = ''; for (let j = 0; j < segs; j++) { const px = -26 + j * 5.2; s += `<ellipse cx="${px}" cy="${Math.sin(j * 0.7) * 2.5}" rx="3.6" ry="${mw ? 3.2 : 4.2}" fill="${mw ? '#c98a3c' : '#d9ceb4'}" stroke="${mw ? '#84501f' : '#9c8a68'}" stroke-width="0.7"/>`; } return `<g transform="translate(${x},${y})">${s}<circle cx="31" cy="1" r="2.6" fill="#3b2412"/></g>`; }
    if (i === 2) return mw ? `<g transform="translate(${x},${y})"><path d="M-14 6 Q-16 -8 0 -9 Q14 -8 14 0 Q13 9 0 9 Q-8 9 -14 6Z" fill="#efe3c8" stroke="#b59f73"/><path d="M-6 -8 L-6 8 M0 -9 L0 9 M6 -8 L6 8" stroke="#c9b48a" stroke-width="0.8"/></g>` : `<g transform="translate(${x},${y})"><ellipse cx="0" cy="0" rx="17" ry="7" fill="#3d2a1a" stroke="#241910"/><path d="M-10 -6 L-10 6 M-3 -7 L-3 7 M4 -7 L4 7 M11 -5 L11 5" stroke="#5b4430" stroke-width="0.8"/></g>`;
    return mw ? `<g transform="translate(${x},${y})"><ellipse cx="0" cy="2" rx="9" ry="13" fill="#2a1d14"/><line x1="0" y1="-10" x2="0" y2="15" stroke="#5a4636" stroke-width="0.8"/><ellipse cx="0" cy="-13" rx="5" ry="4" fill="#2a1d14"/><path d="M-9 -2 l-7 -4 M9 -2 l7 -4 M-9 5 l-7 3 M9 5 l7 3 M-8 11 l-6 6 M8 11 l6 6 M-3 -16 l-4 -6 M3 -16 l4 -6" stroke="#2a1d14" stroke-width="1.3"/></g>`
      : `<g transform="translate(${x},${y})"><ellipse cx="0" cy="0" rx="14" ry="4.5" fill="#111"/><ellipse cx="-2" cy="-6" rx="11" ry="4" fill="rgba(170,190,210,0.55)" stroke="#667"/><ellipse cx="-2" cy="6" rx="11" ry="4" fill="rgba(170,190,210,0.55)" stroke="#667"/><circle cx="14" cy="0" r="3.6" fill="#1b2a22"/><path d="M-8 -1 h6 M-3 1 h5" stroke="#eee" stroke-width="1.2"/></g>`;
  };
  const tot = stages.reduce((a, s) => a + (isFinite(s.days) ? s.days : 0), 0);
  let svg = `<svg class="dg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Life cycle of ${SPECIES[sp].label} at ${p.Tair} °C">`;
  svg += `<defs><marker id="lc-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker></defs>`;
  svg += `<ellipse cx="${cx}" cy="${cy}" rx="${R * 1.45}" ry="${R}" fill="none" class="stroke-muted" stroke-width="1.2" stroke-dasharray="4 5"/>`;
  // arrows between stages (quarter arcs)
  for (let i = 0; i < 4; i++) { const a0 = (-90 + i * 90 + 22) * Math.PI / 180, a1 = (-90 + (i + 1) * 90 - 22) * Math.PI / 180; const p0 = [cx + R * 1.45 * Math.cos(a0), cy + R * Math.sin(a0)], p1 = [cx + R * 1.45 * Math.cos(a1), cy + R * Math.sin(a1)]; svg += `<path d="M${p0[0]} ${p0[1]} A ${R * 1.45} ${R} 0 0 1 ${p1[0]} ${p1[1]}" fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#lc-ar)"/>`; }
  stages.forEach((s, i) => {
    const [x, y] = pos[i]; const isL = i === 1;
    svg += `<rect x="${x - 58}" y="${y - 26}" width="116" height="${isL ? 62 : 56}" rx="10" class="${isL ? 'fill-accent-soft' : 'fill-sunk'}" stroke="currentColor" stroke-width="${isL ? 1.6 : 0.8}"/>`;
    svg += `<g transform="translate(${x},${y - 10}) scale(0.78) translate(${-x},${-(y - 10)})">${icon(i, x, y - 10)}</g>`;
    svg += `<text x="${x}" y="${y + 14}" text-anchor="middle" style="font:600 12px Inter,sans-serif">${s.stage}</text>`;
    svg += `<text x="${x}" y="${y + 27}" text-anchor="middle" class="t-small t-mono">${isFinite(s.days) ? fmt(s.days, s.days < 10 ? 1 : 0) + ' d' : 'no development'}</text>`;
    if (isL) { svg += `<rect x="${x - 50}" y="${y + 31}" width="100" height="4" rx="2" class="fill-bg" stroke="currentColor" stroke-width="0.5"/><rect x="${x - 50}" y="${y + 31}" width="${100 * prog}" height="4" rx="2" class="fill-magenta"/>`; }
  });
  svg += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" style="font:600 13px Inter,sans-serif">${SPECIES[sp].latin}</text>`;
  svg += `<text x="${cx}" y="${cy + 14}" text-anchor="middle" class="t-small t-muted">egg to egg ≈ ${isFinite(tot) ? fmt(tot, 0) : '—'} d at ${fmt(p.Tair, 1)} °C</text>`;
  svg += `<text x="${cx}" y="${H - 6}" text-anchor="middle" class="t-small t-muted">${sp === 'mealworm' ? 'larval days from the model; other stages measured at 20–30 °C' : 'larval days from the model; other stages: degree-day model'}</text></svg>`;
  lcEl.innerHTML = svg;
}

/* ------------------------------------------------------------ wiring */
ui.onChange((s, id) => {
  if (id === 'speed') { clock.speed = +s.speed; return; }
  if (id === 'labels' || id === 'thermal') { acc = 1; return; }
  if (id === 'species') {
    ui.show('dietMW', s.species === 'mealworm'); ui.show('dietBSF', s.species === 'bsf');
    const D = SPECIES[s.species].density; if (s.density < D.min || s.density > D.max || Math.abs(s.density - SPECIES[s.species === 'bsf' ? 'mealworm' : 'bsf'].density.def) < 1e-6) ui.set('density', D.def, true);
    tDay = 0; tour(s.species === 'mealworm' ? 'mw' : 'bsf');
  }
  recompute();
});
ui.show('dietMW', P().species === 'mealworm'); ui.show('dietBSF', P().species === 'bsf');
recompute();
clock.play();
