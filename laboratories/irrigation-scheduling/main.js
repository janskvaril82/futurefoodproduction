/* Irrigation scheduling (FAO-56) — daily soil-water balance with Penman–Monteith ET₀, single crop coefficient, root growth,
   five scheduling strategies and FAO-33 yield response. Model: ./model.js; weather generator: ./weather.js; stage: ./stage.js.
   Derive tab: Eqs. I1–I9. */
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, downloadCSV } from '/assets/js/plot.js';
import { parseTable } from '/assets/js/stats.js';
import { isDark, palette, withAlpha } from '/assets/js/colors.js';
import { svp, dayLength } from '/assets/js/physics.js';
import * as WG from './weather.js';
import * as MD from './model.js';
import { SoilStage } from './stage.js';

const $ = s => document.querySelector(s);
const YEAR = 2026;
const doyLabel = d => WG.fmtDate(WG.dateOfDoy(YEAR, Math.round(d)));
const STRAT_KEYS = Object.keys(MD.STRATEGIES);

/* ================================================================ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'et0', label: 'Reference ET₀ over the season', unit: 'mm', digits: 0 })
  .add({ id: 'etc', label: 'Crop water need ETc (no stress)', unit: 'mm', digits: 0 })
  .add({ id: 'eta', label: 'Actual evapotranspiration ETa', unit: 'mm', digits: 0 })
  .add({ id: 'rain', label: 'Rain (effective)', unit: 'mm', digits: 0 })
  .add({ id: 'irr', label: 'Irrigation, net (gross)', format: v => v })
  .add({ id: 'dp', label: 'Drainage below the root zone', unit: 'mm', digits: 0 })
  .add({ id: 'stress', label: 'Days with water stress (Ks < 1)', unit: 'd', digits: 0 })
  .add({ id: 'yr', label: 'Relative yield Ya/Ym (FAO-33)', unit: '%', digits: 1 })
  .add({ id: 'iwp', label: 'Irrigation water productivity', unit: 'kg m⁻³', digits: 1 });

ui.section('Weather');
ui.select({ id: 'source', label: 'Weather', options: [{ value: 'vasteras', label: 'Västerås — synthetic (SMHI + NASA POWER statistics)' }, { value: 'almeria', label: 'Almería — synthetic (NASA POWER statistics)' }, { value: 'csv', label: 'My own data (paste below the charts)' }], value: 'vasteras' });
ui.slider({ id: 'year', label: 'Weather year (random seed)', min: 1, max: 40, step: 1, value: 1, help: 'Each seed is a different, statistically realistic season' });
ui.slider({ id: 'plant', label: 'Planting / sowing date', min: 1, max: 365, step: 1, value: 130, format: v => doyLabel(v) });
ui.section('Crop and soil (FAO-56 tables)');
ui.select({ id: 'crop', label: 'Crop', options: Object.entries(MD.CROPS).map(([value, c]) => ({ value, label: c.name })), value: 'potato' });
const calSel = ui.select({ id: 'cal', label: 'Stage lengths (FAO-56 Table 11)', options: MD.CROPS.potato.calendars.map((c, i) => ({ value: String(i), label: c.label })), value: '0' });
ui.select({ id: 'soil', label: 'Soil texture (FAO-56 Table 19)', options: Object.entries(MD.SOILS).map(([value, s]) => ({ value, label: `${s.name} · θFC ${s.fc} / θWP ${s.wp}` })), value: 'loamySand' });
ui.slider({ id: 'dr0', label: 'Depletion at planting', min: 0, max: 80, step: 5, value: 10, unit: '% of TAW' });
ui.toggle({ id: 'climadj', label: 'Adjust Kc mid/end for wind and humidity (FAO-56 eq. 62)', value: true });
ui.slider({ id: 'ym', label: 'Potential yield Y<sub>m</sub> (your expectation)', min: 1, max: 80, step: 0.5, value: 40, unit: 't ha⁻¹', help: 'Used only to express the relative yield in t ha⁻¹ and water productivity' });
ui.section('Irrigation schedule');
ui.select({ id: 'strat', label: 'Strategy', options: STRAT_KEYS.map(k => ({ value: k, label: MD.STRATEGIES[k] })), value: 'sensor' });
ui.select({ id: 'sys', label: 'Irrigation system', options: Object.entries(MD.SYSTEMS).map(([value, s]) => ({ value, label: `${s.name} · Ea ${Math.round(s.ea * 100)} %` })), value: 'sprinkler' });
ui.slider({ id: 'calInt', label: 'Interval', min: 2, max: 14, step: 1, value: 7, unit: 'd' });
ui.slider({ id: 'calDepth', label: 'Net depth per irrigation', min: 5, max: 50, step: 1, value: 25, unit: 'mm' });
ui.slider({ id: 'calStart', label: 'First irrigation', min: 0, max: 40, step: 1, value: 10, unit: 'd after planting' });
ui.slider({ id: 'trig', label: 'Trigger: depletion as share of RAW', min: 50, max: 150, step: 5, value: 100, unit: '%', help: '100 % = irrigate when Dr reaches RAW (the “management allowed depletion”)' });
ui.slider({ id: 'bias', label: 'Sensor bias', min: -0.05, max: 0.05, step: 0.005, value: 0, unit: 'm³ m⁻³', digits: 3 });
ui.slider({ id: 'noise', label: 'Sensor random error (1 SD)', min: 0, max: 0.04, step: 0.002, value: 0.01, unit: 'm³ m⁻³', digits: 3 });
ui.slider({ id: 'horizon', label: 'Forecast horizon', min: 1, max: 7, step: 1, value: 3, unit: 'd' });
ui.slider({ id: 'delta', label: 'Deficit trigger: share of the way from RAW to TAW', min: 0, max: 0.9, step: 0.05, value: 0.4 });
ui.slider({ id: 'refill', label: 'Refill share of the depletion', min: 0.3, max: 1, step: 0.05, value: 0.7 });
ui.slider({ id: 'stop', label: 'Stop irrigating before harvest', min: 0, max: 30, step: 1, value: 10, unit: 'd' });
ui.section('Display');
ui.segmented({ id: 'speed', label: 'Playback', options: [{ value: 3, label: '3 d s⁻¹' }, { value: 8, label: '8 d s⁻¹' }, { value: 20, label: '20 d s⁻¹' }], value: 8, persist: false });
ui.toggle({ id: 'showSensor', label: 'Show the sensor’s depletion estimate', value: true });
ui.presets([
  { label: 'Västerås potato on sand', values: { source: 'vasteras', crop: 'potato', cal: '0', plant: 130, soil: 'loamySand', strat: 'sensor', sys: 'sprinkler', ym: 40, dr0: 10 } },
  { label: 'Västerås spring wheat, silt loam', values: { source: 'vasteras', crop: 'wheat', cal: '0', plant: 115, soil: 'siltLoam', strat: 'rainfed', sys: 'sprinkler', ym: 6, dr0: 5 } },
  { label: 'Almería winter lettuce, drip', values: { source: 'almeria', crop: 'lettuce', cal: '1', plant: 305, soil: 'sandyLoam', strat: 'model', sys: 'drip', ym: 30, dr0: 40 } },
  { label: 'Almería spring potato, deficit', values: { source: 'almeria', crop: 'potato', cal: '2', plant: 15, soil: 'loam', strat: 'deficit', sys: 'drip', ym: 40, dr0: 50, delta: 0.4, refill: 0.7 } },
  { label: 'Calendar vs sensor on sand', values: { source: 'vasteras', crop: 'potato', cal: '0', plant: 130, soil: 'loamySand', strat: 'calendar', calInt: 7, calDepth: 25, sys: 'sprinkler' } }
]);
ui.buttons([{ label: 'Download season (CSV)', onClick: () => exportCSV() }]);
ui.saveButton('irrigation-scheduling', () => ro.values());

function syncControls() {
  const s = ui.get('strat');
  const vis = { calInt: s === 'calendar', calDepth: s === 'calendar', calStart: s === 'calendar', trig: s === 'sensor' || s === 'model', bias: s === 'sensor', noise: s === 'sensor', horizon: s === 'model', delta: s === 'deficit', refill: s === 'deficit', stop: s !== 'rainfed', sys: s !== 'rainfed' };
  Object.entries(vis).forEach(([id, v]) => ui.show(id, v));
  ui.enable('year', ui.get('source') !== 'csv'); ui.enable('plant', ui.get('source') !== 'csv');
}
let lastCrop = ui.get('crop');
function syncCalendars(force) {
  const crop = ui.get('crop'), C = MD.CROPS[crop];
  if (force || crop !== lastCrop || calSel.input.options.length !== C.calendars.length || calSel.input.options[0].text !== C.calendars[0].label) {
    const cur = +ui.get('cal');
    calSel.input.innerHTML = C.calendars.map((c, i) => `<option value="${i}">${c.label}</option>`).join('');
    ui.set('cal', String(cur < C.calendars.length ? cur : 0), true);
    if (crop !== lastCrop) ui.set('ym', C.ym, true);
    lastCrop = crop;
  }
}

/* ================================================================ weather (synthetic or pasted) */
let csvWeather = null, csvInfo = '';
function parseCSVWeather(text, lat, z) {
  const T = parseTable(text); if (!T.rows.length) throw new Error('no rows');
  const key = names => T.headers.findIndex(h => names.includes(String(h).trim().toLowerCase()));
  const iD = key(['date', 'day']), iX = key(['tmax', 't_max', 'tx']), iN = key(['tmin', 't_min', 'tn']), iDew = key(['tdew', 'dewpoint', 'td']), iRH = key(['rh', 'rhmean', 'rh_mean']);
  const iU = key(['u2', 'wind', 'wind2m']), iS = key(['sun', 'sun_hours', 'sunshine', 'n']), iRs = key(['rs', 'radiation', 'rs_mj']), iP = key(['rain', 'precip', 'p', 'precipitation']);
  if (iD < 0 || iX < 0 || iN < 0 || iP < 0) throw new Error('need at least the columns date, tmax, tmin and rain');
  const out = [];
  T.rows.forEach(r => {
    const date = new Date(String(r[iD]).trim() + 'T00:00:00Z'); if (isNaN(date)) return;
    const doy = WG.doyOf(date), tmax = +r[iX], tmin = +r[iN]; if (!isFinite(tmax) || !isFinite(tmin)) return;
    let tdew = iDew >= 0 ? +r[iDew] : NaN;
    if (!isFinite(tdew) && iRH >= 0 && isFinite(+r[iRH])) { const ea = +r[iRH] / 100 * (svp(tmax) + svp(tmin)) / 2; const a = Math.log(ea / 0.6108); tdew = 237.3 * a / (17.27 - a); }
    if (!isFinite(tdew)) tdew = tmin;                                             // FAO-56: Tdew ≈ Tmin where no humidity data
    const u2 = iU >= 0 && isFinite(+r[iU]) ? +r[iU] : 2;                          // FAO-56 default wind speed
    const N = dayLength(lat, doy);
    const sun = iS >= 0 && isFinite(+r[iS]) ? Math.min(1, +r[iS] / N) : null, rs = iRs >= 0 && isFinite(+r[iRs]) ? +r[iRs] : null;
    out.push({ date, doy, tmax, tmin, tdew, u2, sun, rs, rain: Math.max(0, +r[iP] || 0) });
  });
  if (out.length < 10) throw new Error('fewer than 10 valid days');
  return MD.withET0(out, lat, z);
}
function currentWeather(p) {
  if (p.source === 'csv' && csvWeather) return csvWeather;
  const site = p.source === 'csv' ? 'vasteras' : p.source, S = WG.SITES[site];
  return MD.withET0(WG.generate({ site, start: WG.dateOfDoy(YEAR, p.plant), days: 220, seed: p.year }), S.lat, S.z);
}

/* ================================================================ run */
let W = null, R = null, ALL = null, day = 0;
function strategiesFrom(p) {
  return {
    rainfed: { kind: 'rainfed' },
    calendar: { kind: 'calendar', interval: p.calInt, depth: p.calDepth, start: p.calStart },
    sensor: { kind: 'sensor', trig: p.trig / 100, bias: p.bias, noise: p.noise },
    model: { kind: 'model', trig: p.trig / 100, horizon: p.horizon },
    deficit: { kind: 'deficit', delta: p.delta, refill: p.refill }
  };
}
function run() {
  const p = ui.values();
  W = currentWeather(p);
  const C = MD.CROPS[p.crop], L = C.calendars[Math.min(C.calendars.length - 1, +p.cal)].L;
  const base = { weather: W, crop: p.crop, L, soil: p.soil, sys: p.sys, climAdj: p.climadj, dr0: p.dr0 / 100, seed: p.year, stopBefore: p.stop, ymax: p.ym };
  ALL = MD.runAll(base, strategiesFrom(p));
  R = ALL[p.strat];
  day = Math.min(day, R.n - 1);
  tl.max = R.n - 1;
  stageR.setup({ crop: p.crop, soil: p.soil, zrMax: C.zrMax, h: C.h, dark: isDark() });
  updateCharts(); updateReadouts(); updateTable(); updateYW(); setDay(day);
}

/* ================================================================ stage + timeline */
const stageEl = $('#stage'), cv = $('#soil');
const stageR = new SoilStage(cv);
const hud = hudChips(stageEl);
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'irrigation-scheduling.png'; a.click(); } });
const tl = $('#tl-day'), tlLab = $('#tl-label'), tlPlay = $('#tl-play');
const clock = new SimClock({ speed: 8, onFrame: t => { if (!R) return; if (t >= R.n - 1) { clock.pause(); t = R.n - 1; } setDay(t, true); } });
clock.onState(r => { tlPlay.textContent = r ? '❚❚' : '▶'; tlPlay.setAttribute('aria-label', r ? 'Pause the season' : 'Play the season'); });
tlPlay.addEventListener('click', () => { if (!clock.running && day >= R.n - 1.001) clock.reset(0); else clock.reset(day); clock.toggle(); });
tl.addEventListener('input', () => { clock.pause(); setDay(+tl.value); });
let lastDrawnDay = -1;
function setDay(t, fromClock) {
  day = Math.max(0, Math.min(R.n - 1, t)); const i = Math.floor(day);
  if (!fromClock || Math.abs(+tl.value - day) > 0.5) tl.value = day;
  const w = W[i];
  tlLab.textContent = `${WG.fmtDate(w.date)} · day ${i}`;
  if (i !== lastDrawnDay) { lastDrawnDay = i; [cDr, cWater, cET, cCum].forEach(c => c.vline('now', i, { color: 'muted' })); dayHud(i); }
}
const STAGE_NAMES = ['initial', 'development', 'mid-season', 'late season'];
function dayHud(i) {
  const w = W[i];
  hud.set('d', `<b>${WG.fmtDate(w.date)}</b> · day ${i} · ${STAGE_NAMES[R.stage[i]]} · Kc <b>${fmt(R.kc[i], 2)}</b>`);
  hud.set('w', `ET₀ <b>${fmt(R.et0[i], 1)}</b> mm · rain <b>${fmt(R.rain[i], 1)}</b> mm · ${fmt(w.tmax, 0)}/${fmt(w.tmin, 0)} °C`);
  hud.set('b', `ETa <b>${fmt(R.eta[i], 1)}</b> of ETc ${fmt(R.etc[i], 1)} mm · Ks <b>${fmt(R.ks[i], 2)}</b>${R.irr[i] > 0 ? ` · irrigated <b>${fmt(R.irr[i], 0)}</b> mm` : ''}`);
}
let lastT = performance.now();
function animate(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (R) {
    const i = Math.floor(day), p = ui.values(), S = MD.SOILS[p.soil], L = R.K.Lc;
    const st = R.stage[i], a = st === 0 ? 0 : L[st - 1], b = L[st];
    stageR.dark = isDark();
    stageR.draw({ date: W[i].date, dap: i, stage: st, stageFrac: (i - a) / Math.max(1, b - a), kc: R.kc[i], kcMax: R.K.kcMid, zr: R.zr[i], taw: R.taw[i], tawMax: R.taw[R.n - 1], raw: R.raw[i], p: R.p[i], dr: R.dr[i], ks: R.ks[i], eta: R.eta[i], etc: R.etc[i], et0: R.et0[i], rain: R.rain[i], irr: R.irr[i], ea: MD.SYSTEMS[p.sys].ea, dp: R.dp[i], theta: R.theta[i], fc: S.fc, wp: S.wp, sun: W[i].sun ?? Math.min(1, W[i].Rs / (W[i].Rso || 1)), sys: p.sys }, dt);
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

/* ================================================================ charts */
const cDr = new Plot('#chart-dr', { x: { label: 'Days after planting', unit: 'd', min: 0 }, y: { label: 'Root-zone depletion Dr', unit: 'mm', min: 0 } });
const cWater = new Plot('#chart-water', { x: { label: 'Days after planting', unit: 'd', min: 0 }, y: { label: 'Water input', unit: 'mm d⁻¹', min: 0 }, y2: { label: 'ET₀', unit: 'mm d⁻¹', min: 0 } });
const cET = new Plot('#chart-et', { x: { label: 'Days after planting', unit: 'd', min: 0 }, y: { label: 'Evapotranspiration', unit: 'mm d⁻¹', min: 0 }, y2: { label: 'Crop coefficient Kc', unit: '–', min: 0, max: 1.4 } });
const cCum = new Plot('#chart-cum', { x: { label: 'Days after planting', unit: 'd', min: 0 }, y: { label: 'Cumulative water', unit: 'mm', min: 0 } });
const cYW = new Plot('#chart-yw', { x: { label: 'Gross irrigation', unit: 'mm', min: 0 }, y: { label: 'Relative yield', unit: '%', min: 0, max: 105 }, legend: false });
const STRAT_COL = { rainfed: 'muted', calendar: 'amber', sensor: 'water', model: 'accent', deficit: 'magenta' };
const STRAT_SHORT = { rainfed: 'rainfed', calendar: 'calendar', sensor: 'sensor', model: 'model + forecast', deficit: 'deficit' };
function updateYW() {
  const p = ui.values(); const maxG = Math.max(50, ...STRAT_KEYS.map(k => ALL[k].season.gross)) * 1.15;
  cYW.setAxis('x', { min: 0, max: Math.ceil(maxG / 50) * 50 });
  cYW.setAxis('y', { min: 0, max: 125 });
  let prevX = -1e9, prevAbove = false;
  STRAT_KEYS.slice().sort((a, b) => ALL[a].season.gross - ALL[b].season.gross).forEach(k => {
    const s = ALL[k].season, r = 4 + Math.min(10, Math.sqrt(s.dp) * 0.7);
    const above = !(s.gross - prevX < 0.12 * maxG && prevAbove); prevX = s.gross; prevAbove = above;
    cYW.point('p-' + k, s.gross, 100 * s.yr, { color: STRAT_COL[k], r: k === p.strat ? r + 1.5 : r });
    cYW.text('t-' + k, s.gross, 100 * s.yr, STRAT_SHORT[k] + (k === p.strat ? ' ◀' : ''), { color: STRAT_COL[k], align: 'center', dy: above ? -10 - r : 14 + r });
  });
}
const range = n => Array.from({ length: n }, (_, i) => i);
function bars(plot, id, xs, ys, color, offset, label) {
  plot.custom(id, (ctx, pl, P) => {
    const col = color === 'water' ? P.water : color === 'magenta' ? P.magenta : color; ctx.fillStyle = withAlpha(col.startsWith('#') ? col : '#3b82c4', 0.8);
    const w = Math.max(1.5, (pl.px(1) - pl.px(0)) * 0.42);
    xs.forEach((x, k) => { const y = ys[k]; if (!(y > 0)) return; const X = pl.px(x) + offset * w, Y = pl.py(y), Y0 = pl.py(0); ctx.fillRect(X - w / 2, Y, w, Y0 - Y); });
  }, { label, color, legend: true });
}
function updateCharts() {
  const n = R.n, xs = range(n), p = ui.values(), P = palette();
  // depletion with RAW and TAW
  cDr.band('stress', xs, Array.from(R.raw), Array.from(R.taw), { color: 'danger', alpha: 0.1, label: 'Stress zone (RAW–TAW)' });
  cDr.line('taw', xs, Array.from(R.taw), { color: 'danger', width: 1.6, dash: [6, 4], label: 'TAW' });
  cDr.line('raw', xs, Array.from(R.raw), { color: 'amber', width: 1.8, dash: [5, 4], label: 'RAW' });
  cDr.line('dr', xs, Array.from(R.dr), { color: 'water', width: 2.6, label: 'Depletion Dr (end of day)' });
  const ev = xs.filter(i => R.irr[i] > 0);
  if (ev.length) cDr.scatter('ev', ev, ev.map(i => R.drStart[i]), { color: 'magenta', r: 4.5, shape: 'triangle', label: 'Irrigation' }); else cDr.remove('ev');
  if (p.strat === 'sensor' && p.showSensor) { const S = MD.SOILS[p.soil]; cDr.scatter('sens', xs, xs.map(i => Math.max(0, (S.fc - R.sensor[i]) * 1000 * R.zr[i])), { color: 'muted', r: 2, label: 'Sensor estimate of Dr', hollow: true }); } else cDr.remove('sens');
  cDr.setAxis('x', { min: 0, max: n - 1 });
  // rain & irrigation bars, ET0
  const maxIn = Math.max(10, ...Array.from(R.rain), ...Array.from(R.gross));
  cWater.setAxis('y', { min: 0, max: Math.ceil(maxIn / 5) * 5 });
  bars(cWater, 'rain', xs, Array.from(R.rain), 'water', -0.5, 'Rain');
  bars(cWater, 'irr', xs, Array.from(R.gross), 'magenta', 0.5, 'Irrigation (gross)');
  cWater.line('et0', xs, Array.from(R.et0), { color: 'amber', width: 1.6, y2: true, label: 'ET₀ (right axis)' });
  cWater.setAxis('x', { min: 0, max: n - 1 });
  // ETc vs ETa
  cET.line('etc', xs, Array.from(R.etc), { color: 'accent', width: 1.8, label: 'ETc (no stress)' });
  cET.line('eta', xs, Array.from(R.eta), { color: 'danger', width: 2.2, label: 'ETa (actual)' });
  cET.line('kc', xs, Array.from(R.kc), { color: 'muted', width: 1.4, dash: [5, 4], y2: true, label: 'Kc (right axis)' });
  cET.setAxis('x', { min: 0, max: n - 1 });
  // cumulative
  const cum = a => { let s = 0; return Array.from(a, v => (s += v)); };
  cCum.line('rain', xs, cum(R.rain), { color: 'water', width: 2, label: 'Rain' });
  cCum.line('irr', xs, cum(R.gross), { color: 'magenta', width: 2, label: 'Irrigation (gross)' });
  cCum.line('etc', xs, cum(R.etc), { color: 'accent', width: 1.6, dash: [6, 4], label: 'ETc' });
  cCum.line('eta', xs, cum(R.eta), { color: 'accent', width: 2.4, label: 'ETa' });
  cCum.line('dp', xs, cum(R.dp), { color: 'amber', width: 2, label: 'Drainage' });
  cCum.setAxis('x', { min: 0, max: n - 1 });
  lastDrawnDay = -1;
}
function updateReadouts() {
  const s = R.season, p = ui.values(), base = ALL.rainfed.season;
  ro.set('et0', s.ET0, null, `mean ${fmt(s.ET0 / R.n, 1)} mm d⁻¹ over ${R.n} d`);
  ro.set('etc', s.ETc, null, `Kc mid ${fmt(R.K.kcMid, 2)}${p.climadj ? ` (tabulated ${MD.CROPS[p.crop].kc[1]}, climate ${R.K.adjMid >= 0 ? '+' : '−'}${fmt(Math.abs(R.K.adjMid), 3)})` : ''}`);
  ro.set('eta', s.ETa, s.ratio > 0.97 ? 'ok' : s.ratio > 0.85 ? 'warn' : 'bad', `${fmt(100 * s.ratio, 1)} % of ETc`);
  ro.set('rain', s.pe, null, `${fmt(s.rain, 0)} mm fell; days with < 0.2 ET₀ ignored`);
  ro.set('irr', `${fmt(s.irr, 0)} (${fmt(s.gross, 0)}) mm`, null, `${s.events} irrigations · ${MD.SYSTEMS[p.sys].name.split(' (')[0].toLowerCase()} Ea ${Math.round(MD.SYSTEMS[p.sys].ea * 100)} %`);
  const input = s.pe + s.irr;
  ro.set('dp', s.dp, s.dp < 0.1 * input ? 'ok' : s.dp < 0.25 * input ? 'warn' : 'bad', `${fmt(100 * s.dp / Math.max(1, input), 0)} % of rain + net irrigation`);
  ro.set('stress', s.stressDays, s.stressDays < 5 ? 'ok' : s.stressDays < 20 ? 'warn' : 'bad');
  ro.set('yr', 100 * s.yr, s.yr > 0.95 ? 'ok' : s.yr > 0.8 ? 'warn' : 'bad', `Ky ${MD.CROPS[p.crop].ky} (${MD.CROPS[p.crop].kySrc}) → ${fmt(s.yield, 1)} t ha⁻¹`);
  const iwp = s.gross > 0 ? (s.yield - base.yield) * 1000 / (s.gross * 10) : null;
  ro.set('iwp', iwp, iwp == null ? null : iwp > 0 ? 'ok' : 'warn', iwp == null ? 'no irrigation' : 'extra yield per m³ of gross irrigation vs rainfed');
}
function updateTable() {
  const p = ui.values(), rows = STRAT_KEYS.map(k => [k, ALL[k].season]);
  const best = rows.filter(([k]) => k !== 'rainfed').reduce((b, r) => (r[1].yr > 0.95 && (!b || r[1].gross < b[1].gross)) ? r : b, null);
  const base = ALL.rainfed.season;
  $('#strategy-table').innerHTML = `<table class="cmp"><thead><tr><th>Strategy</th><th class="num">Irrigation net / gross</th><th class="num">Events</th><th class="num">Drainage</th><th class="num">ETa / ETc</th><th class="num">Stress days</th><th class="num">Relative yield</th><th class="num">Water productivity</th></tr></thead><tbody>${rows.map(([k, s]) => `<tr class="${k === p.strat ? 'cur' : ''}"><td>${MD.STRATEGIES[k]}${best && best[0] === k ? ' <span class="tag">least water ≥ 95 % yield</span>' : ''}</td><td class="num">${fmt(s.irr, 0)} / ${fmt(s.gross, 0)} mm</td><td class="num">${s.events}</td><td class="num">${fmt(s.dp, 0)} mm</td><td class="num">${fmt(100 * s.ratio, 1)} %</td><td class="num">${s.stressDays}</td><td class="num"><b>${fmt(100 * s.yr, 1)} %</b></td><td class="num">${s.gross > 0 ? fmt((s.yield - base.yield) * 1000 / (s.gross * 10), 1) + ' kg m⁻³' : '—'}</td></tr>`).join('')}</tbody></table>`;
}
function exportCSV() {
  const rows = range(R.n).map(i => [W[i].date.toISOString().slice(0, 10), i, R.stage[i], +R.kc[i].toFixed(3), +R.zr[i].toFixed(3), +R.et0[i].toFixed(2), +R.etc[i].toFixed(2), +R.eta[i].toFixed(2), +R.ks[i].toFixed(3), +R.rain[i].toFixed(1), +R.pe[i].toFixed(1), +R.irr[i].toFixed(1), +R.gross[i].toFixed(1), +R.dp[i].toFixed(1), +R.taw[i].toFixed(1), +R.raw[i].toFixed(1), +R.dr[i].toFixed(1)]);
  downloadCSV(`irrigation-${ui.get('crop')}-${ui.get('strat')}.csv`, ['date', 'dap', 'stage', 'Kc', 'Zr_m', 'ET0_mm', 'ETc_mm', 'ETa_mm', 'Ks', 'rain_mm', 'eff_rain_mm', 'irr_net_mm', 'irr_gross_mm', 'drainage_mm', 'TAW_mm', 'RAW_mm', 'Dr_mm'], rows);
}

/* ================================================================ pasted data */
const ta = $('#csv-text'), csvMsg = $('#csv-msg');
ta.value = WG.exampleCSV();
$('#csv-use').addEventListener('click', () => {
  try { csvWeather = parseCSVWeather(ta.value, +$('#csv-lat').value, +$('#csv-z').value); csvMsg.textContent = `Using ${csvWeather.length} days from ${WG.fmtDate(csvWeather[0].date)} (radiation from ${csvWeather[0].rsFrom}).`; csvMsg.className = 'csv-msg ok'; ui.set('source', 'csv'); }
  catch (e) { csvMsg.textContent = 'Could not read the data: ' + e.message; csvMsg.className = 'csv-msg bad'; }
});
$('#csv-example').addEventListener('click', () => { ta.value = WG.exampleCSV(); });

/* ================================================================ wiring */
let raf = 0;
ui.onChange((state, id) => {
  if (id === 'speed') { clock.speed = +state.speed; return; }
  if (id === 'source' && state.source === 'csv' && !csvWeather) { try { csvWeather = parseCSVWeather(ta.value, +$('#csv-lat').value, +$('#csv-z').value); csvMsg.textContent = `Using ${csvWeather.length} days of pasted data.`; csvMsg.className = 'csv-msg ok'; } catch (e) { csvMsg.textContent = e.message; csvMsg.className = 'csv-msg bad'; } }
  if (id === 'crop') syncCalendars();
  syncControls();
  cancelAnimationFrame(raf); raf = requestAnimationFrame(run);
});
syncCalendars(true); syncControls();
clock.speed = +ui.get('speed');
run();
document.addEventListener('ffp:theme', () => { stageR.dark = isDark(); stageR.soilTex = null; });
window.__irr = { get R() { return R; }, get ALL() { return ALL; }, setDay, clock };
