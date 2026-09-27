/* Diet footprint composer — model, plate visual and charts.
   Model (Derive tab, Eqs. D1–D8):
     daily footprint      F_k = Σ_i m_i /(1 − w) · e_ik          (Poore & Nemecek 2018, per kg retail weight)
     per-capita budget    b_k = B_k /(N · 365)                    (EAT–Lancet 2019 food-system boundaries)
     overshoot            O_k = F_k / b_k
     nutrition            E = Σ m_i ε_i ,  P = Σ m_i p_i ,  protein energy share 4P/E
     swaps                iso-protein / iso-energy / iso-mass substitution m_Y = m_X · q_X / q_Y            */
import { Controls, Readouts, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { BarChart, downloadCSV } from '/assets/js/plot.js';
import { palette, withAlpha } from '/assets/js/colors.js';
import { FOODS, PRESET_DIETS } from './data.js';

/* ------------------------------------------------------------ constants */
const GROUPS = [
  { id: 'grain', name: 'Grains & starches', col: '#e2b43f' },
  { id: 'plant', name: 'Legumes, nuts & soy', col: '#9b72d8' },
  { id: 'veg', name: 'Vegetables', col: '#45b86c' },
  { id: 'fruit', name: 'Fruit & berries', col: '#f08c3e' },
  { id: 'dairy', name: 'Dairy & eggs', col: '#5aa9e6' },
  { id: 'meat', name: 'Meat & fish', col: '#d0533f' },
  { id: 'extra', name: 'Oils, sweets & drinks', col: '#a7b0ba' }
];
const GI = Object.fromEntries(GROUPS.map((g, i) => [g.id, i]));
const KEYS = ['ghg', 'land', 'water', 'eut'];
const IND = {
  ghg: { short: 'Climate', name: 'Greenhouse-gas emissions', unit: 'kg CO₂e', dig: 2, yr: { f: 1 / 1000, unit: 't CO₂e', dig: 2 } },
  land: { short: 'Land', name: 'Land use', unit: 'm²·yr', dig: 1, yr: { f: 1, unit: 'm²', dig: 0 } },
  water: { short: 'Water', name: 'Freshwater withdrawals', unit: 'L', dig: 0, yr: { f: 1 / 1000, unit: 'm³', dig: 1 } },
  eut: { short: 'Eutrophication', name: 'Eutrophying emissions', unit: 'g PO₄³⁻e', dig: 1, yr: { f: 1 / 1000, unit: 'kg PO₄³⁻e', dig: 2 } }
};
/* EAT–Lancet (Willett et al., 2019) global food-system boundaries, per year */
const BOUND = { ghg: 5e12 /* kg CO₂e (CH₄ + N₂O) */, land: 13e12 /* m² cropland */, water: 2.5e15 /* L = 2500 km³ */ };
const STATIDX = { p10: 0, median: 1, mean: 2, p90: 3 };
const STATLAB = { p10: '10th-percentile', median: 'median', mean: 'mean', p90: '90th-percentile' };
const FOOD = Object.fromEntries(FOODS.map(f => [f.id, f]));
const PROTEIN_PRI = 0.83;     // g protein per kg body weight per day (EFSA 2012, adults)
const SWAPS = [
  ['beefB', 'pulses', 'prot'], ['beefB', 'chicken', 'prot'], ['beefB', 'beefD', 'mass'], ['beefB', 'tofu', 'prot'],
  ['beefD', 'pulses', 'prot'], ['beefD', 'chicken', 'prot'], ['lamb', 'pulses', 'prot'], ['lamb', 'chicken', 'prot'],
  ['pork', 'peas', 'prot'], ['pork', 'chicken', 'prot'], ['cheese', 'tofu', 'prot'], ['cheese', 'peanut', 'prot'],
  ['prawn', 'fish', 'prot'], ['prawn', 'peas', 'prot'], ['fish', 'pulses', 'prot'], ['fish', 'chicken', 'prot'],
  ['chicken', 'pulses', 'prot'], ['chicken', 'tofu', 'prot'], ['egg', 'tofu', 'prot'], ['milk', 'soydrink', 'mass'],
  ['rice', 'potato', 'kcal'], ['rice', 'pasta', 'kcal'], ['olive', 'rapeseed', 'mass'], ['palm', 'rapeseed', 'mass'],
  ['choc', 'nuts', 'kcal'], ['berries', 'apple', 'mass']
];

/* ------------------------------------------------------------ model */
function compute(grams, o) {
  const s = STATIDX[o.stat] ?? 1, wk = 1 / (1 - (o.waste || 0) / 100);
  const tot = { ghg: 0, land: 0, water: 0, eut: 0 };
  const grp = GROUPS.map(() => ({ ghg: 0, land: 0, water: 0, eut: 0, kcal: 0, prot: 0, mass: 0 }));
  const per = {};
  let kcal = 0, prot = 0, mass = 0, animal = 0;
  for (const f of FOODS) {
    const g = +grams[f.id] || 0; if (g <= 0) continue;
    const kg = g * wk / 1000, gi = GI[f.group], r = { g, kcal: g * f.kcal / 100, prot: g * f.prot / 100 };
    for (const k of KEYS) { const v = kg * f[k][s]; r[k] = v; tot[k] += v; grp[gi][k] += v; }
    kcal += r.kcal; prot += r.prot; mass += g;
    grp[gi].kcal += r.kcal; grp[gi].prot += r.prot; grp[gi].mass += g;
    if (f.group === 'dairy' || f.group === 'meat') animal += r.prot;
    per[f.id] = r;
  }
  return { tot, grp, per, kcal, prot, mass, animal };
}
/** Per-person daily budgets. basis 'eat': EAT–Lancet boundary shares (eutrophication: planetary-health-diet benchmark). */
function budgets(o) {
  const phd = compute(PRESET_DIETS.eat, { stat: o.stat, waste: 0 }).tot;
  if (o.basis === 'phd') return Object.assign({}, phd);
  const N = o.pop * 1e9;
  return { ghg: BOUND.ghg / N / 365, land: BOUND.land / N / 365, water: BOUND.water / N / 365, eut: phd.eut };
}
const gramsOf = v => Object.fromEntries(FOODS.map(f => [f.id, +v[f.id] || 0]));
const q = (f, basis) => basis === 'prot' ? f.prot : basis === 'kcal' ? f.kcal : 100;

/* ------------------------------------------------------------ food icons (colour emoji, painted fallbacks) */
const sprite = {}, iconURL = {};
const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
function emojiOK(e) {
  const c = document.createElement('canvas'); c.width = c.height = 40; const x = c.getContext('2d', { willReadFrequently: true });
  x.font = `30px ${EMOJI_FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(e, 20, 22);
  const d = x.getImageData(0, 0, 40, 40).data; let col = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 60) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (mx - mn > 50) col++; }
  return col > 12;
}
function makeSprite(f) {
  const S = 96, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  if (f.id === 'tofu') {         // painted block of firm tofu
    x.save(); x.translate(S / 2, S / 2 + 2); x.rotate(-0.22);
    x.fillStyle = '#d9cfb2'; x.beginPath(); x.moveTo(-30, -14); x.lineTo(-18, -30); x.lineTo(34, -30); x.lineTo(22, -14); x.closePath(); x.fill();
    x.fillStyle = '#c8bb97'; x.beginPath(); x.moveTo(22, -14); x.lineTo(34, -30); x.lineTo(34, 16); x.lineTo(22, 30); x.closePath(); x.fill();
    const gr = x.createLinearGradient(-30, -14, 22, 30); gr.addColorStop(0, '#fffdf5'); gr.addColorStop(1, '#ece3c9');
    x.fillStyle = gr; x.beginPath(); x.roundRect(-30, -14, 52, 44, 4); x.fill();
    x.fillStyle = 'rgba(150,130,90,.28)'; for (let i = 0; i < 12; i++) { x.beginPath(); x.arc(-22 + (i % 4) * 13, -4 + Math.floor(i / 4) * 12, 1.5, 0, 7); x.fill(); }
    x.restore(); return c;
  }
  if (f.id === 'peas') {        // painted dry peas
    [[-14, 8], [6, 12], [-4, -8], [16, -6], [-20, -12], [22, 14], [2, -24], [-26, 4]].forEach(([dx, dy], i) => {
      const r = 12.5 - (i % 3) * 1.2; const gr = x.createRadialGradient(S / 2 + dx - 4, S / 2 + dy - 4, 2, S / 2 + dx, S / 2 + dy, r);
      gr.addColorStop(0, '#f6f0a8'); gr.addColorStop(0.6, '#d9c24c'); gr.addColorStop(1, '#8f7a1f'); x.fillStyle = gr; x.beginPath(); x.arc(S / 2 + dx, S / 2 + dy, r, 0, 7); x.fill();
    });
    return c;
  }
  if (f.id === 'coffee') {      // painted cup of coffee (the ☕ glyph is monochrome on some systems)
    x.save(); x.translate(S / 2 - 4, S / 2 + 8);
    x.strokeStyle = 'rgba(230,230,230,.75)'; x.lineWidth = 3; x.lineCap = 'round';
    [-10, 2, 14].forEach(dx => { x.beginPath(); x.moveTo(dx, -22); x.bezierCurveTo(dx - 7, -30, dx + 7, -36, dx, -44); x.stroke(); });
    x.fillStyle = '#e9e4da'; x.beginPath(); x.ellipse(0, 26, 34, 7, 0, 0, 7); x.fill();
    const body = x.createLinearGradient(-26, 0, 26, 0); body.addColorStop(0, '#f4f1ea'); body.addColorStop(0.6, '#ffffff'); body.addColorStop(1, '#cfc8bb');
    x.fillStyle = body; x.beginPath(); x.moveTo(-26, -14); x.lineTo(26, -14); x.quadraticCurveTo(24, 20, 0, 22); x.quadraticCurveTo(-24, 20, -26, -14); x.fill();
    x.strokeStyle = '#e8e3d8'; x.lineWidth = 6; x.beginPath(); x.arc(28, 2, 9, -1.2, 1.4); x.stroke();
    x.fillStyle = '#5a3219'; x.beginPath(); x.ellipse(0, -14, 26, 6, 0, 0, 7); x.fill();
    x.fillStyle = '#8a5530'; x.beginPath(); x.ellipse(-4, -15, 14, 3, 0, 0, 7); x.fill();
    x.restore(); return c;
  }
  if (emojiOK(f.emoji)) {
    x.font = `${S * 0.74}px ${EMOJI_FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(f.emoji, S / 2, S / 2 + S * 0.04);
  } else {
    x.fillStyle = GROUPS[GI[f.group]].col; x.beginPath(); x.arc(S / 2, S / 2, S * 0.4, 0, 7); x.fill();
    x.fillStyle = '#fff'; x.font = `700 ${S * 0.3}px Inter, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(f.name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase(), S / 2, S / 2);
  }
  return c;
}
const getSprite = f => sprite[f.id] || (sprite[f.id] = makeSprite(f));
const icon = (f, cls = 'fi') => `<img class="${cls}" src="${iconURL[f.id] || (iconURL[f.id] = getSprite(f).toDataURL())}" alt="">`;

/* ------------------------------------------------------------ UI */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'ghg', label: 'Greenhouse gases', unit: 'kg CO₂e d⁻¹', digits: 2, note: '&nbsp;' })
  .add({ id: 'land', label: 'Land use', unit: 'm²·yr d⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'water', label: 'Freshwater withdrawals', unit: 'L d⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'eut', label: 'Eutrophying emissions', unit: 'g PO₄³⁻e d⁻¹', digits: 1, note: '&nbsp;' })
  .add({ id: 'kcal', label: 'Energy intake', unit: 'kcal d⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'prot', label: 'Protein intake', unit: 'g d⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'animal', label: 'Protein from animal foods', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'yr', label: 'Annual climate footprint', unit: 't CO₂e yr⁻¹', digits: 2, note: '&nbsp;' });

const ctlEl = document.getElementById('controls');
const zeroDiet = Object.fromEntries(FOODS.map(f => [f.id, 0]));
const presetVals = key => Object.assign({}, zeroDiet, PRESET_DIETS[key]);
ui.presets([
  { label: 'Average Swedish diet', title: 'Riksmaten 2010–11 adult means converted to retail weights (approximation, see Sources)', values: presetVals('sweden') },
  { label: 'EAT–Lancet planetary health diet', title: 'Willett et al. (2019) reference diet, 2500 kcal', values: presetVals('eat') },
  { label: 'Vegan (illustrative)', title: 'An example composition, not survey data', values: presetVals('vegan') },
  { label: 'High-meat (illustrative)', title: 'About 200 g meat per day; an example composition, not survey data', values: presetVals('highmeat') },
  { label: 'Empty plate', values: Object.assign({}, zeroDiet) }
], 'Diet presets');
ui.section('Budget and person');
ui.segmented({ id: 'basis', label: 'Compare with', options: [{ value: 'eat', label: 'Boundary share' }, { value: 'phd', label: 'Planetary health diet' }], value: 'eat', help: 'Boundary share: your slice of the EAT–Lancet food-system boundaries. Planetary health diet: the same footprint data applied to the EAT–Lancet reference diet.' });
ui.slider({ id: 'pop', label: 'People sharing the boundaries', min: 7, max: 11, step: 0.1, value: 10, unit: 'bn', help: 'EAT–Lancet assumed 10 billion people in 2050 (UN WPP 2024: ≈ 9.7 bn in 2050).' });
ui.slider({ id: 'kcalT', label: 'Energy requirement', min: 1400, max: 3600, step: 50, value: 2500, unit: 'kcal d⁻¹', help: 'EAT–Lancet reference person: 2500 kcal d⁻¹ (70 kg, 30 years, moderate activity).' });
ui.slider({ id: 'bw', label: 'Body weight', min: 40, max: 120, step: 1, value: 70, unit: 'kg', help: 'Protein requirement = 0.83 g kg⁻¹ d⁻¹ (EFSA population reference intake for adults).' });
ui.slider({ id: 'waste', label: 'Household food waste', min: 0, max: 40, step: 1, value: 0, unit: '%', help: 'Share of purchased food that is thrown away. P&N footprints include losses up to retail, not at home.' });
ui.segmented({ id: 'stat', label: 'Producer footprint', options: [{ value: 'p10', label: 'Low (P10)' }, { value: 'median', label: 'Median' }, { value: 'mean', label: 'Mean' }, { value: 'p90', label: 'High (P90)' }], value: 'median', help: 'Which point of the Poore & Nemecek distribution across 38,700 farms to use for every food.' });
ui.section('Plate view');
ui.select({ id: 'plate', label: 'Size foods on the plate by', options: [{ value: 'mass', label: 'Mass eaten (g)' }, { value: 'ghg', label: 'Greenhouse gases' }, { value: 'land', label: 'Land use' }, { value: 'water', label: 'Freshwater withdrawals' }, { value: 'eut', label: 'Eutrophying emissions' }, { value: 'kcal', label: 'Energy (kcal)' }, { value: 'prot', label: 'Protein' }], value: 'ghg' });
ui.select({ id: 'rank', label: 'Rank swap suggestions by', options: [{ value: 'all', label: 'All four footprints (budget-weighted)' }, { value: 'ghg', label: 'Greenhouse gases' }, { value: 'land', label: 'Land use' }, { value: 'water', label: 'Freshwater' }, { value: 'eut', label: 'Eutrophication' }], value: 'all' });

/* food sliders, grouped in collapsible sections */
const sliderEls = {};
GROUPS.forEach((g, gi) => {
  const det = document.createElement('details'); det.className = 'food-group'; det.open = gi < 2 || g.id === 'meat';
  det.innerHTML = `<summary><i style="background:${g.col}"></i><span class="fg-name">${g.name}</span><span class="fg-sum" id="fgs-${g.id}"></span></summary>`;
  ctlEl.appendChild(det); ui.el = det;
  FOODS.filter(f => f.group === g.id).forEach(f => {
    const step = f.max >= 600 ? 10 : f.max >= 150 ? 5 : 1;
    const r = ui.slider({ id: f.id, label: `${icon(f)}${f.name}`, min: 0, max: f.max, step, value: PRESET_DIETS.sweden[f.id] ?? 0, unit: 'g', digits: 0 });
    r.el.classList.add('food-ctl'); r.el.dataset.food = f.id; r.el.title = `${f.fu} (Poore & Nemecek: ${f.pn})`; sliderEls[f.id] = r.el;
  });
  ui.el = ctlEl;
});
ui.saveButton('diet-footprint', () => ro.values());
ui.button({ label: 'Download diet and footprints (CSV)', onClick: () => {
  const p = ui.values(), R = compute(gramsOf(p), p), B = budgets(p);
  const rows = FOODS.filter(f => R.per[f.id]).map(f => { const r = R.per[f.id]; return [f.name, GROUPS[GI[f.group]].name, r.g, +r.kcal.toFixed(1), +r.prot.toFixed(2), ...KEYS.map(k => +r[k].toPrecision(4)), f.pn]; });
  rows.push(['TOTAL', '', R.mass, +R.kcal.toFixed(0), +R.prot.toFixed(1), ...KEYS.map(k => +R.tot[k].toPrecision(4)), '']);
  rows.push(['BUDGET per day', p.basis, '', p.kcalT, +(p.bw * PROTEIN_PRI).toFixed(1), ...KEYS.map(k => +B[k].toPrecision(4)), `${p.pop} bn people`]);
  downloadCSV('diet-footprint.csv', ['food', 'group', 'grams_per_day', 'kcal', 'protein_g', 'ghg_kgCO2e', 'land_m2yr', 'water_L', 'eut_gPO4e', 'Poore_Nemecek_product'], rows);
} });

/* ------------------------------------------------------------ stage: plate + gauges */
const stageEl = document.getElementById('stage');
const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'A plate of foods sized by the chosen footprint, with gauges comparing the diet with its planetary budget');
stageEl.appendChild(cv);
const ctx = cv.getContext('2d');
const tip = document.createElement('div'); tip.className = 'df-tip'; stageEl.appendChild(tip);
const hud = hudChips(stageEl);
const legendEl = document.getElementById('df-groups');
if (legendEl) legendEl.innerHTML = GROUPS.map(g => `<span><i style="background:${g.col}"></i>${g.name}</span>`).join('') + '<span style="color:var(--muted)">· dashed outline: negative footprint (carbon stored by tree crops)</span>';
stageToolbar(stageEl, { onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'diet-plate.png'; a.click(); } });

let W = 0, H = 0, DPR = 1, L = null, bgCache = null;
function layout() {
  const narrow = W < 700;
  const pb = narrow ? { x: 0, y: 0, w: W, h: H * 0.64 } : { x: 0, y: 0, w: W * 0.62, h: H };
  const gb = narrow ? { x: 0, y: H * 0.64, w: W, h: H * 0.36 } : { x: W * 0.62, y: 0, w: W * 0.38, h: H };
  const R = Math.min(pb.w * 0.40, pb.h * 0.35);
  L = { narrow, pb, gb, cx: pb.x + pb.w * 0.5, cy: pb.y + pb.h * (narrow ? 0.54 : 0.52), R };
}
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = stageEl.clientWidth; H = stageEl.clientHeight; if (!W || !H) return;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cv.style.width = W + 'px'; cv.style.height = H + 'px';
  layout(); bgCache = null; if (target) setTargets(ui.values(), target.R, target.B); kick();
}
new ResizeObserver(resize).observe(stageEl);

/* background: dark oak table + linen placemat + gauge panel (cached) */
function paintBackground() {
  const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; const x = c.getContext('2d'); x.scale(DPR, DPR);
  const g0 = x.createLinearGradient(0, 0, 0, H); g0.addColorStop(0, '#2c1e14'); g0.addColorStop(1, '#1a120c'); x.fillStyle = g0; x.fillRect(0, 0, W, H);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 160; i++) {       // wood grain
    const y0 = rnd() * H * 1.1 - H * 0.05, amp = 2 + rnd() * 7, fr = 0.004 + rnd() * 0.01, ph = rnd() * 6;
    x.strokeStyle = `rgba(${rnd() < 0.5 ? '96,64,40' : '18,11,6'},${0.08 + rnd() * 0.16})`; x.lineWidth = 0.6 + rnd() * 2.2;
    x.beginPath(); for (let X = 0; X <= W; X += 8) { const Y = y0 + amp * Math.sin(X * fr + ph) + 2.2 * Math.sin(X * fr * 3.1 + ph * 2); X ? x.lineTo(X, Y) : x.moveTo(X, Y); } x.stroke();
  }
  x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 1.5; for (let y = H * 0.18; y < H; y += H * 0.27) { x.beginPath(); x.moveTo(0, y); x.lineTo(W, y + 3); x.stroke(); }
  const sp = x.createRadialGradient(L.cx - L.R * 0.3, L.cy - L.R * 0.6, L.R * 0.2, L.cx, L.cy, Math.max(W, H) * 0.85);
  sp.addColorStop(0, 'rgba(255,214,160,.22)'); sp.addColorStop(0.45, 'rgba(255,190,120,.06)'); sp.addColorStop(1, 'rgba(0,0,0,.55)');
  x.fillStyle = sp; x.fillRect(0, 0, W, H);
  const gb = L.gb;
  if (!L.narrow) { x.fillStyle = 'rgba(8,12,11,.58)'; x.beginPath(); x.roundRect(gb.x + 6, gb.y + 58, gb.w - 18, gb.h - 70, 16); x.fill(); x.strokeStyle = 'rgba(255,255,255,.08)'; x.lineWidth = 1; x.stroke(); }
  else { x.fillStyle = 'rgba(8,12,11,.62)'; x.fillRect(gb.x, gb.y, gb.w, gb.h); }
  return c;
}
function drawPlate(x, cx, cy, R) {
  const pm = R * 1.3;
  x.save(); x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 18; x.shadowOffsetY = 6;
  const lg = x.createLinearGradient(cx - pm, cy - pm, cx + pm, cy + pm); lg.addColorStop(0, '#617064'); lg.addColorStop(1, '#434e46');
  x.fillStyle = lg; x.beginPath(); x.roundRect(cx - pm, cy - pm * 0.92, pm * 2, pm * 1.84, 14); x.fill(); x.restore();
  x.save(); x.beginPath(); x.roundRect(cx - pm, cy - pm * 0.92, pm * 2, pm * 1.84, 14); x.clip();
  x.strokeStyle = 'rgba(255,255,255,.035)'; x.lineWidth = 1; for (let i = -pm; i < pm; i += 3) { x.beginPath(); x.moveTo(cx + i, cy - pm); x.lineTo(cx + i, cy + pm); x.stroke(); x.beginPath(); x.moveTo(cx - pm, cy + i); x.lineTo(cx + pm, cy + i); x.stroke(); }
  x.restore();
  x.save(); x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 26; x.shadowOffsetY = 10; x.fillStyle = '#e9e5dc'; x.beginPath(); x.arc(cx, cy, R * 1.12, 0, 7); x.fill(); x.restore();
  const rim = x.createRadialGradient(cx - R * 0.35, cy - R * 0.45, R * 0.2, cx, cy, R * 1.12);
  rim.addColorStop(0, '#ffffff'); rim.addColorStop(0.75, '#efece6'); rim.addColorStop(1, '#cfc9be');
  x.fillStyle = rim; x.beginPath(); x.arc(cx, cy, R * 1.12, 0, 7); x.fill();
  const well = x.createRadialGradient(cx + R * 0.2, cy + R * 0.25, R * 0.1, cx, cy, R);
  well.addColorStop(0, '#fbfaf7'); well.addColorStop(0.85, '#f1eee8'); well.addColorStop(1, '#ddd7cc');
  x.fillStyle = well; x.beginPath(); x.arc(cx, cy, R * 0.97, 0, 7); x.fill();
  x.strokeStyle = 'rgba(150,140,125,.35)'; x.lineWidth = 1.2; x.beginPath(); x.arc(cx, cy, R * 0.97, 0, 7); x.stroke();
  x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 2.2; x.beginPath(); x.arc(cx, cy, R * 1.05, Math.PI * 1.08, Math.PI * 1.42); x.stroke();
}

/* bubbles (one per food) — position-based dynamics in plate units (plate radius = 1) */
const bubbles = FOODS.map((f, i) => { const a = i * 2.39996, r = 0.2 + 0.8 * Math.sqrt(i / FOODS.length); return { f, x: Math.cos(a) * r * 0.6, y: Math.sin(a) * r * 0.6, r: 0, rt: 0, neg: false, v: 0 }; });
let zoom = 1, zoomT = 1, fill = 0;
function setTargets(p, R, B) {
  const mode = p.plate;
  let ref, vals;
  if (mode === 'mass') { ref = compute(PRESET_DIETS.eat, p).mass; vals = FOODS.map(f => R.per[f.id]?.g || 0); }
  else if (mode === 'kcal') { ref = p.kcalT; vals = FOODS.map(f => R.per[f.id]?.kcal || 0); }
  else if (mode === 'prot') { ref = p.bw * PROTEIN_PRI; vals = FOODS.map(f => R.per[f.id]?.prot || 0); }
  else { ref = B[mode]; vals = FOODS.map(f => R.per[f.id]?.[mode] || 0); }
  const PACK = 0.62;                               // share of the plate covered when the diet equals the reference
  fill = vals.reduce((a, v) => a + Math.max(0, v), 0) / (ref || 1);
  bubbles.forEach((b, i) => { const v = vals[i]; b.v = v; b.neg = v < 0; b.rt = Math.sqrt(Math.abs(v) / (ref || 1) * PACK); });
  const totA = bubbles.reduce((a, b) => a + b.rt * b.rt, 0);
  const need = Math.max(1.15, Math.sqrt(totA / 0.55) * 1.08);            // radius of the pile including voids
  const avail = Math.min(L.pb.w / 2 - 14, L.pb.h / 2 - 26) / L.R;       // screen space in plate units
  zoomT = Math.min(1, avail / need);
}
function step(dt) {
  let moving = false;
  const k = 1 - Math.exp(-dt * 7);
  zoom += (zoomT - zoom) * k; if (Math.abs(zoom - zoomT) > 1e-3) moving = true;
  for (const b of bubbles) { const nr = b.r + (b.rt - b.r) * k; if (Math.abs(nr - b.r) > 1e-4) moving = true; b.r = nr; }
  const act = bubbles.filter(b => b.r > 0.004);
  for (const b of act) { const s = 0.9 * dt; b.x -= b.x * s; b.y -= b.y * s; }
  for (let it = 0; it < 6; it++) {
    for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
      const a = act[i], c = act[j]; let dx = c.x - a.x, dy = c.y - a.y; let d = Math.hypot(dx, dy); const m = a.r + c.r + 0.012;
      if (d < m) {
        if (d < 1e-6) { dx = Math.cos(i + j); dy = Math.sin(i * j + 1); d = 1; }
        const push = (m - d) / 2, ux = dx / d, uy = dy / d, wa = c.r * c.r / (a.r * a.r + c.r * c.r + 1e-9);
        a.x -= ux * push * 2 * wa; a.y -= uy * push * 2 * wa; c.x += ux * push * 2 * (1 - wa); c.y += uy * push * 2 * (1 - wa); if (push > 2e-4) moving = true;
      }
    }
  }
  return moving;
}
let raf = 0, lastT = 0, visible = true, target = null, hover = null;
new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) kick(); }).observe(stageEl);
function kick() { if (!raf) raf = requestAnimationFrame(frame); }
function frame(now) {
  raf = 0; if (!visible || !W || !target) return;
  const dt = Math.min(0.05, (now - (lastT || now)) / 1000 || 0.016); lastT = now;
  let moving = step(dt);
  target.gauges.forEach(gg => { const nv = gg.shown + (gg.x - gg.shown) * (1 - Math.exp(-dt * 5)); if (Math.abs(nv - gg.x) > 1e-3 * Math.max(0.1, gg.x)) moving = true; gg.shown = nv; });
  draw();
  if (moving) raf = requestAnimationFrame(frame); else lastT = 0;
}
const toScreen = (x, y) => [L.cx + x * L.R * zoom, L.cy + y * L.R * zoom];
function valueLabel(p, b) {
  if (p.plate === 'mass') return `${fmt(b.v, 0)} g`;
  if (p.plate === 'kcal') return `${fmt(b.v, 0)} kcal`;
  if (p.plate === 'prot') return `${fmt(b.v, 1)} g`;
  return `${b.neg ? '−' : ''}${fmt(Math.abs(b.v), IND[p.plate].dig)}`;
}
function draw() {
  const x = ctx; x.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!bgCache) bgCache = paintBackground();
  x.drawImage(bgCache, 0, 0, W, H);
  const p = ui.values(), PR = L.R * zoom;
  drawPlate(x, L.cx, L.cy, PR);
  const order = bubbles.filter(b => b.r > 0.004).sort((a, b) => b.r - a.r);
  for (const b of order) {
    const [sx, sy] = toScreen(b.x, b.y), r = b.r * PR, g = GROUPS[GI[b.f.group]];
    x.save();
    x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = Math.min(14, r * 0.35); x.shadowOffsetY = Math.min(5, r * 0.12);
    const gr = x.createRadialGradient(sx - r * 0.35, sy - r * 0.4, r * 0.1, sx, sy, r);
    gr.addColorStop(0, withAlpha(g.col, b.neg ? 0.18 : 0.55)); gr.addColorStop(1, withAlpha(g.col, b.neg ? 0.08 : 0.9));
    x.fillStyle = gr; x.beginPath(); x.arc(sx, sy, r, 0, 7); x.fill(); x.restore();
    x.lineWidth = hover === b ? 3 : 1.4; x.strokeStyle = hover === b ? '#fff' : g.col; if (b.neg) x.setLineDash([4, 3]);
    x.beginPath(); x.arc(sx, sy, r, 0, 7); x.stroke(); x.setLineDash([]);
    if (r > 6) { const s = r * 1.25; x.globalAlpha = b.neg ? 0.55 : 1; x.drawImage(getSprite(b.f), sx - s / 2, sy - s / 2 - (r > 26 ? r * 0.12 : 0), s, s); x.globalAlpha = 1; }
    if (r > 26) {
      x.font = `650 ${Math.min(13, 8 + r * 0.09)}px Inter, system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
      const lab = valueLabel(p, b), tw = x.measureText(lab).width + 10;
      x.fillStyle = 'rgba(10,14,12,.62)'; x.beginPath(); x.roundRect(sx - tw / 2, sy + r * 0.42 - 8, tw, 16, 8); x.fill();
      x.fillStyle = '#fff'; x.fillText(lab, sx, sy + r * 0.42);
    }
  }
  // the plate (= the budget) drawn over the food, so the overflow is visible
  const over = fill > 1.001, ringR = PR * 0.97;
  x.save(); x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 4;
  x.strokeStyle = over ? 'rgba(255,150,130,.95)' : 'rgba(155,231,182,.95)'; x.lineWidth = 2.4; x.setLineDash([8, 6]);
  x.beginPath(); x.arc(L.cx, L.cy, ringR, 0, 7); x.stroke(); x.setLineDash([]); x.restore();
  const ang = -Math.PI * 0.28, lx = L.cx + Math.cos(ang) * ringR, ly = L.cy + Math.sin(ang) * ringR;
  x.font = '650 11px Inter, system-ui, sans-serif'; x.textAlign = 'left'; x.textBaseline = 'middle';
  const plab = p.plate === 'mass' ? 'plate = planetary health diet' : p.plate === 'kcal' ? 'plate = energy need' : p.plate === 'prot' ? 'plate = protein need' : (p.plate === 'eut' || p.basis === 'phd') ? 'plate = planetary health diet' : 'plate = your budget';
  const tw = x.measureText(plab).width + 14;
  x.fillStyle = 'rgba(10,14,12,.78)'; x.beginPath(); x.roundRect(lx + 6, ly - 10, tw, 20, 10); x.fill();
  x.fillStyle = over ? '#ffb4a3' : '#9be7b6'; x.fillText(plab, lx + 13, ly);
  // caption
  const cap = `This diet fills ${fmt(fill * 100, 0)} % of the plate`;
  x.font = '650 12.5px Inter, system-ui, sans-serif'; x.textAlign = 'center';
  const cw = x.measureText(cap).width + 22, cy = L.narrow ? L.pb.y + L.pb.h - 16 : H - 20;
  x.fillStyle = 'rgba(10,14,12,.72)'; x.beginPath(); x.roundRect(L.cx - cw / 2, cy - 12, cw, 24, 12); x.fill();
  x.fillStyle = over ? '#ffb4a3' : '#9be7b6'; x.fillText(cap, L.cx, cy);
  drawGauges(x, p);
}
function gaugeColour(v) { return v <= 1 ? '#3fbf6f' : v <= 2 ? '#f2b94b' : v <= 4 ? '#f07a3e' : '#e0453a'; }
const LG = v => Math.log2(Math.max(1 / 8, Math.min(16, v)));
function drawGauges(x, p) {
  const gb = L.gb, gs = target.gauges, cols = L.narrow ? 4 : 2, rows = L.narrow ? 1 : 2, pad = L.narrow ? 6 : 16;
  const areaTop = L.narrow ? gb.y + 4 : gb.y + 66, areaBot = L.narrow ? gb.y + gb.h * 0.62 : gb.y + gb.h - 116;
  const cw = (gb.w - 2 * pad - (L.narrow ? 0 : 12)) / cols, ch = (areaBot - areaTop) / rows;
  gs.forEach((gg, i) => {
    const col = i % cols, row = Math.floor(i / cols), top = areaTop + ch * row;
    const cx = gb.x + pad + (L.narrow ? 0 : 6) + cw * (col + 0.5);
    const R = Math.max(16, Math.min(cw * (L.narrow ? 0.3 : 0.33), (ch - 70) * 0.42));
    const cy = top + (L.narrow ? 24 : 36) + R;
    const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, ang = v => a0 + (a1 - a0) * (LG(v) + 3) / 7;   // log2 scale ⅛× … 16×
    [[1 / 8, 1, '#3fbf6f'], [1, 2, '#f2b94b'], [2, 4, '#f07a3e'], [4, 16, '#e0453a']].forEach(([lo, hi, c]) => { x.strokeStyle = withAlpha(c, 0.26); x.lineWidth = R * 0.2; x.beginPath(); x.arc(cx, cy, R, ang(lo), ang(hi)); x.stroke(); });
    const v = gg.shown; x.strokeStyle = gaugeColour(gg.x); x.lineWidth = R * 0.2; x.lineCap = 'round'; x.beginPath(); x.arc(cx, cy, R, a0, ang(Math.max(1 / 8, v))); x.stroke(); x.lineCap = 'butt';
    const ab = ang(1); x.strokeStyle = '#e8fff0'; x.lineWidth = 2; x.beginPath(); x.moveTo(cx + Math.cos(ab) * R * 0.78, cy + Math.sin(ab) * R * 0.78); x.lineTo(cx + Math.cos(ab) * R * 1.2, cy + Math.sin(ab) * R * 1.2); x.stroke();
    x.font = `600 ${Math.max(8, Math.min(10, R * 0.2))}px "JetBrains Mono", monospace`; x.fillStyle = 'rgba(232,255,240,.8)'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('1×', cx + Math.cos(ab) * R * 1.36 - 3, cy + Math.sin(ab) * R * 1.36);
    if (!L.narrow) { x.fillStyle = 'rgba(220,232,226,.45)'; x.fillText('1/8', cx + Math.cos(a0) * R * 1.02 - 10, cy + Math.sin(a0) * R * 1.02 + 9); x.fillText('16×', cx + Math.cos(a1) * R * 1.02 + 10, cy + Math.sin(a1) * R * 1.02 + 9); }
    const an = ang(Math.max(1 / 8, v)); x.strokeStyle = '#fff'; x.lineWidth = 2.2; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(an) * R * 0.8, cy + Math.sin(an) * R * 0.8); x.stroke();
    x.fillStyle = '#fff'; x.beginPath(); x.arc(cx, cy, 3.5, 0, 7); x.fill();
    x.fillStyle = '#e6eee9'; x.font = `650 ${L.narrow ? 11 : 13}px Inter, system-ui, sans-serif`; x.fillText(gg.title, cx, top + (L.narrow ? 8 : 6));
    x.fillStyle = gaugeColour(gg.x); x.font = `700 ${Math.max(12, Math.min(19, R * 0.4))}px "JetBrains Mono", monospace`; x.fillText(`${fmt(gg.x, gg.x < 10 ? 2 : 1)}×`, cx, L.narrow ? cy + R + 10 : cy + R * 0.5);
    if (!L.narrow) { x.fillStyle = 'rgba(220,232,226,.72)'; x.font = '500 10.5px "JetBrains Mono", monospace'; x.fillText(gg.sub, cx, cy + R + 16); }
  });
  const nx = gb.x + (L.narrow ? 16 : 24), nw = gb.w - (L.narrow ? 32 : 48), ny = L.narrow ? areaBot + 4 : gb.y + gb.h - 102;
  if (L.narrow && gb.y + gb.h - ny < 56) return;
  x.textAlign = 'left'; x.textBaseline = 'middle';
  if (!L.narrow) { x.fillStyle = 'rgba(220,232,226,.6)'; x.font = '700 10px "JetBrains Mono", monospace'; x.fillText('NUTRITION CHECK', nx, ny); }
  [['Energy', target.R.kcal, p.kcalT, 'kcal'], ['Protein', target.R.prot, p.bw * PROTEIN_PRI, 'g']].forEach(([lab, v, t, u], i) => {
    const y = L.narrow ? ny + 12 + i * 30 : ny + 22 + i * 36, max = Math.max(t * 1.6, v * 1.05), X = val => nx + nw * Math.min(1, val / max);
    x.fillStyle = 'rgba(255,255,255,.08)'; x.beginPath(); x.roundRect(nx, y + 6, nw, 9, 4.5); x.fill();
    const ok = lab === 'Energy' ? Math.abs(v / t - 1) <= 0.1 : v >= t;
    x.fillStyle = ok ? '#3fbf6f' : '#f2b94b'; x.beginPath(); x.roundRect(nx, y + 6, Math.max(2, X(v) - nx), 9, 4.5); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.moveTo(X(t), y + 2); x.lineTo(X(t), y + 19); x.stroke();
    x.fillStyle = '#e6eee9'; x.font = '600 11.5px Inter, system-ui, sans-serif'; x.fillText(lab, nx, y - 3);
    x.textAlign = 'right'; x.font = '500 11px "JetBrains Mono", monospace'; x.fillStyle = ok ? '#9be7b6' : '#ffd08a';
    x.fillText(`${fmt(v, 0)} / ${fmt(t, 0)} ${u}`, nx + nw, y - 3); x.textAlign = 'left';
  });
}
/* hover + click on foods */
function pick(ev) {
  const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
  let best = null;
  for (const b of bubbles) { if (b.r < 0.004) continue; const [sx, sy] = toScreen(b.x, b.y); if (Math.hypot(mx - sx, my - sy) <= b.r * L.R * zoom && (!best || b.r < best.r)) best = b; }
  return { best, mx, my };
}
cv.addEventListener('pointermove', ev => {
  if (!L || !target) return;
  const { best, mx, my } = pick(ev);
  if (best !== hover) { hover = best; draw(); }
  const rr = best && target.R.per[best.f.id];
  if (!rr) { tip.style.display = 'none'; cv.style.cursor = ''; return; }
  cv.style.cursor = 'pointer';
  const f = best.f, B = target.B;
  tip.innerHTML = `<b>${f.name}</b> · ${fmt(rr.g, 0)} g d⁻¹<br>${KEYS.map(k => `${IND[k].short}: <b>${fmt(rr[k], IND[k].dig)}</b> ${IND[k].unit} <span style="opacity:.7">(${fmt(100 * rr[k] / (target.R.tot[k] || 1), 0)} % of diet · ${fmt(100 * rr[k] / B[k], 0)} % of budget)</span>`).join('<br>')}<br>${fmt(rr.kcal, 0)} kcal · ${fmt(rr.prot, 1)} g protein<div style="margin-top:4px;opacity:.72">P&amp;N product: ${f.pn} · ${f.fu}. Click to edit.</div>`;
  tip.style.display = 'block';
  tip.style.left = Math.min(mx + 14, W - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(my + 12, H - tip.offsetHeight - 8) + 'px';
});
cv.addEventListener('pointerleave', () => { hover = null; tip.style.display = 'none'; if (target) draw(); });
cv.addEventListener('click', ev => {
  if (!L) return;
  const { best } = pick(ev); if (!best) return;
  const el = sliderEls[best.f.id]; if (!el) return;
  const det = el.closest('details'); if (det) det.open = true;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  const inp = el.querySelector('input'); if (inp) setTimeout(() => inp.focus({ preventScroll: true }), 350);
});

/* ------------------------------------------------------------ charts */
const stack = new BarChart('#chart-groups', { y: { label: 'Share of daily budget', unit: '%', min: 0 }, stacked: true, height: 300 });
function makeCanvas(sel, drawFn) {
  const el = document.querySelector(sel); const c = document.createElement('canvas'); el.appendChild(c);
  const o = { el, c, ctx: c.getContext('2d'), w: 0, h: 0, draw: oo => { if (oo.w > 40 && oo.h > 40) drawFn(oo); } };
  const rs = () => { const d = Math.min(2, window.devicePixelRatio || 1); o.w = el.clientWidth; o.h = el.clientHeight; if (!o.w || !o.h) return; c.width = o.w * d; c.height = o.h * d; c.style.width = o.w + 'px'; c.style.height = o.h + 'px'; o.ctx.setTransform(d, 0, 0, d, 0, 0); if (target) o.draw(o); };
  new ResizeObserver(rs).observe(el); document.addEventListener('ffp:theme', () => { if (target) o.draw(o); });
  return o;
}
/* radar: diet vs budget (log2 radial scale) */
const radar = makeCanvas('#chart-radar', o => {
  const c = o.ctx, P = palette(), p = ui.values(); c.clearRect(0, 0, o.w, o.h);
  const cx = o.w / 2, cy = o.h / 2 + 8, R = Math.max(20, Math.min(o.w * 0.3, (o.h - 116) / 2));
  const rOf = v => R * (Math.log2(Math.max(0.25, Math.min(16, v))) + 2) / 6;   // ¼× … 16×
  const ax = KEYS.map((k, i) => -Math.PI / 2 + i * Math.PI / 2);
  const okC = P.ok || '#2e9e5b';
  c.font = '500 10px "JetBrains Mono", monospace'; c.textAlign = 'left'; c.textBaseline = 'middle';
  [0.25, 0.5, 1, 2, 4, 8, 16].forEach(v => {
    c.strokeStyle = v === 1 ? okC : P.line; c.lineWidth = v === 1 ? 2 : 1; c.setLineDash(v === 1 ? [6, 4] : []);
    c.beginPath(); c.arc(cx, cy, rOf(v), 0, 7); c.stroke(); c.setLineDash([]);
    if (v > 0.25) { c.fillStyle = v === 1 ? okC : P.muted; c.fillText(v < 1 ? '½×' : `${v}×`, cx + 3 + rOf(v) * Math.cos(-Math.PI / 4), cy + rOf(v) * Math.sin(-Math.PI / 4) - 2); }
  });
  c.strokeStyle = P.line; ax.forEach(a => { c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); c.stroke(); });
  const poly = (vals, fillCol, strokeCol, dash) => {
    c.beginPath(); vals.forEach((v, i) => { const rr = rOf(v); const X = cx + Math.cos(ax[i]) * rr, Y = cy + Math.sin(ax[i]) * rr; i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.closePath();
    if (fillCol) { c.fillStyle = fillCol; c.fill(); } c.strokeStyle = strokeCol; c.lineWidth = 2.2; c.setLineDash(dash || []); c.stroke(); c.setLineDash([]);
  };
  if (p.basis === 'eat') { const phdTot = compute(PRESET_DIETS.eat, { stat: p.stat, waste: 0 }).tot; poly(KEYS.map(k => phdTot[k] / target.B[k]), null, P.muted, [5, 4]); }
  const d = KEYS.map(k => target.R.tot[k] / target.B[k]);
  poly(d, withAlpha(P.magenta, 0.18), P.magenta);
  d.forEach((v, i) => { const rr = rOf(v); c.fillStyle = P.magenta; c.beginPath(); c.arc(cx + Math.cos(ax[i]) * rr, cy + Math.sin(ax[i]) * rr, 4, 0, 7); c.fill(); });
  KEYS.forEach((k, i) => {
    const a = ax[i], s = Math.sin(a), co = Math.cos(a), X = cx + co * (R + 14), Y = cy + s * (R + 14);
    const al = Math.abs(co) < 0.3 ? 'center' : co > 0 ? 'left' : 'right';
    const y1 = s < -0.5 ? Y - 20 : s > 0.5 ? Y + 6 : Y - 8, y2 = y1 + 15;
    c.textAlign = al; c.textBaseline = 'middle';
    c.fillStyle = P.ink; c.font = '650 12px Inter, system-ui, sans-serif'; c.fillText(IND[k].short + (k === 'eut' && p.basis === 'eat' ? '*' : ''), X, y1);
    c.fillStyle = d[i] <= 1 ? okC : d[i] <= 2 ? (P.warn || '#b86e0b') : (P.danger || '#c0392b'); c.font = '650 11.5px "JetBrains Mono", monospace';
    c.fillText(`${fmt(d[i], 2)}×`, X, y2);
  });
  c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = '500 10.5px Inter, system-ui, sans-serif';
  c.fillStyle = P.magenta; c.fillRect(8, 9, 14, 3); c.fillStyle = P.muted; c.fillText('your diet', 26, 11);
  if (p.basis === 'eat') { c.strokeStyle = P.muted; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(88, 11); c.lineTo(102, 11); c.stroke(); c.setLineDash([]); c.fillText('planetary health diet', 106, 11); }
  c.strokeStyle = okC; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(p.basis === 'eat' ? 232 : 88, 11); c.lineTo(p.basis === 'eat' ? 246 : 102, 11); c.stroke(); c.setLineDash([]);
  c.fillText(p.basis === 'eat' ? '1× = boundary share' : '1× = planetary health diet', p.basis === 'eat' ? 250 : 106, 11);
});
/* nutrition check */
const nutri = makeCanvas('#chart-nutri', o => {
  const c = o.ctx, P = palette(), p = ui.values(), R = target.R; c.clearRect(0, 0, o.w, o.h);
  const Lx = 92, Rx = 16, Wd = o.w - Lx - Rx;
  const rows = [
    { lab: 'Energy', unit: 'kcal', key: 'kcal', v: R.kcal, t: p.kcalT, band: [0.9, 1.1] },
    { lab: 'Protein', unit: 'g', key: 'prot', v: R.prot, t: p.bw * PROTEIN_PRI, band: [1, 2.5] },
    { lab: 'Food mass', unit: 'g', key: 'mass', v: R.mass, t: null }
  ];
  rows.forEach((r, i) => {
    const y = 18 + i * 64, h = 20, max = Math.max(r.v, (r.t || 0) * (r.key === 'prot' ? 2.6 : 1.2)) * 1.08 || 1, X = v => Lx + Wd * Math.min(1, v / max);
    c.fillStyle = P.ink; c.font = '650 12px Inter, system-ui, sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(r.lab, Lx - 10, y + h / 2);
    c.fillStyle = P.bgSunk || '#eee'; c.fillRect(Lx, y, Wd, h);
    if (r.t) { c.fillStyle = withAlpha(P.accent, 0.16); c.fillRect(X(r.t * r.band[0]), y - 4, X(r.t * r.band[1]) - X(r.t * r.band[0]), h + 8); }
    let acc = 0; GROUPS.forEach((g, gi) => { const v = R.grp[gi][r.key]; if (v <= 0) return; c.fillStyle = g.col; c.fillRect(X(acc), y, Math.max(0.5, X(acc + v) - X(acc)), h); acc += v; });
    if (r.t) { c.strokeStyle = P.ink; c.lineWidth = 2; c.beginPath(); c.moveTo(X(r.t), y - 6); c.lineTo(X(r.t), y + h + 6); c.stroke(); }
    c.textAlign = 'left'; c.font = '500 11px "JetBrains Mono", monospace'; c.fillStyle = P.ink2 || P.ink;
    const status = r.t ? (r.key === 'kcal' ? (r.v < r.t * 0.9 ? ' · below requirement' : r.v > r.t * 1.1 ? ' · above requirement' : ' · within ±10 %') : (r.v >= r.t ? ' · requirement met' : ' · below requirement')) : '';
    c.fillText(`${fmt(r.v, 0)} ${r.unit}${r.t ? ` of ${fmt(r.t, 0)}` : ''}${status}`, Lx, y + h + 16);
  });
  const ep = R.kcal > 0 ? 400 * R.prot / R.kcal : 0, ap = R.prot > 0 ? 100 * R.animal / R.prot : 0;
  c.fillStyle = P.muted; c.font = '500 11.5px Inter, system-ui, sans-serif'; c.textAlign = 'left';
  c.fillText(`Protein supplies ${fmt(ep, 1)} % of energy (NNR 2023 range for adults: 10–20 %).`, 8, o.h - 26);
  c.fillText(`${fmt(ap, 0)} % of the protein comes from dairy, eggs, meat and fish.`, 8, o.h - 8);
});
/* per-kg footprint distribution (P10–P90, median, mean) */
let rangeInd = 'ghg', rangeFU = 'kg';
const rangeC = makeCanvas('#chart-range', o => {
  const c = o.ctx, P = palette(), R = target.R; c.clearRect(0, 0, o.w, o.h);
  const fuDiv = f => rangeFU === 'kg' ? 1 : rangeFU === 'prot' ? (f.prot >= 2 ? f.prot / 10 : null) : (f.kcal >= 20 ? f.kcal / 100 : null);
  const items = FOODS.map(f => { const dv = fuDiv(f); if (!dv) return null; return { f, v: f[rangeInd].map(v => v / dv) }; }).filter(Boolean).sort((a, b) => b.v[1] - a.v[1]);
  const Lx = 150, Rx = 18, T = 14, rowH = Math.min(18, (o.h - T - 40) / items.length), Wd = o.w - Lx - Rx;
  const sl = v => Math.sign(v) * Math.log10(1 + Math.abs(v) / 0.1);          // symmetric log (linear below 0.1)
  const lo = Math.min(-0.2, ...items.map(i => i.v[0])), hi = Math.max(...items.map(i => i.v[3])) * 1.1;
  const X = v => Lx + Wd * (sl(v) - sl(lo)) / (sl(hi) - sl(lo));
  const yEnd = T + items.length * rowH;
  c.font = '500 10px "JetBrains Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'top';
  [-10, -1, 0, 0.1, 1, 10, 100, 1000, 10000].filter(t => t >= lo && t <= hi).forEach(t => { c.strokeStyle = t === 0 ? P.lineStrong : P.line; c.lineWidth = 1; c.beginPath(); c.moveTo(X(t) + .5, T - 4); c.lineTo(X(t) + .5, yEnd + 2); c.stroke(); c.fillStyle = P.muted; c.fillText(t >= 1000 ? t.toLocaleString('en-GB') : String(t), X(t), yEnd + 6); });
  const unit = IND[rangeInd].unit + (rangeFU === 'kg' ? ' per kg' : rangeFU === 'prot' ? ' per 100 g protein' : ' per 1000 kcal');
  c.fillStyle = P.ink2 || P.ink; c.font = '600 11.5px Inter, system-ui, sans-serif'; c.fillText(`${IND[rangeInd].name} (${unit}; symmetric log axis)`, Lx + Wd / 2, yEnd + 22);
  items.forEach((it, i) => {
    const y = T + i * rowH + rowH / 2, inDiet = R.per[it.f.id], g = GROUPS[GI[it.f.group]];
    c.fillStyle = inDiet ? P.ink : P.muted; c.font = `${inDiet ? 650 : 500} 11px Inter, system-ui, sans-serif`; c.textAlign = 'right'; c.textBaseline = 'middle';
    c.fillText(it.f.name, Lx - 8, y);
    c.strokeStyle = withAlpha(g.col, inDiet ? 0.95 : 0.5); c.lineWidth = Math.min(7, rowH * 0.45); c.lineCap = 'round';
    c.beginPath(); c.moveTo(X(it.v[0]), y); c.lineTo(X(it.v[3]), y); c.stroke(); c.lineCap = 'butt';
    c.fillStyle = P.bgElev || '#fff'; c.strokeStyle = P.ink; c.lineWidth = 1.5; c.beginPath(); c.arc(X(it.v[1]), y, Math.min(4.2, rowH * 0.3), 0, 7); c.fill(); c.stroke();
    c.strokeStyle = P.ink; c.lineWidth = 1.2; c.beginPath(); c.moveTo(X(it.v[2]), y - rowH * 0.32); c.lineTo(X(it.v[2]), y + rowH * 0.32); c.stroke();
  });
});
document.querySelectorAll('#range-ind button').forEach(b => b.addEventListener('click', () => { rangeInd = b.dataset.v; document.querySelectorAll('#range-ind button').forEach(x => x.setAttribute('aria-pressed', x === b)); rangeC.draw(rangeC); }));
document.querySelectorAll('#range-fu button').forEach(b => b.addEventListener('click', () => { rangeFU = b.dataset.v; document.querySelectorAll('#range-fu button').forEach(x => x.setAttribute('aria-pressed', x === b)); rangeC.draw(rangeC); }));

/* swap suggestions */
const swapEl = document.getElementById('swaps');
function swapCandidates(p, R, B) {
  const wk = 1 / (1 - p.waste / 100), s = STATIDX[p.stat];
  const out = [];
  for (const [a, b, basis] of SWAPS) {
    const ga = +p[a] || 0; if (ga < 1) continue;
    const fa = FOOD[a], fb = FOOD[b], amt = Math.min(ga, 100), repl = amt * q(fa, basis) / q(fb, basis);
    if (!isFinite(repl) || repl <= 0) continue;
    const d = {}; KEYS.forEach(k => { d[k] = (amt * fa[k][s] - repl * fb[k][s]) * wk / 1000; });
    const score = p.rank === 'all' ? KEYS.reduce((acc, k) => acc + d[k] / B[k], 0) : d[p.rank] / B[p.rank];
    out.push({ a, b, basis, amt, repl, d, score });
  }
  out.sort((x, y) => y.score - x.score);
  const seen = new Set(), best = [];
  for (const o of out) { if (o.score <= 0 || seen.has(o.a)) continue; seen.add(o.a); best.push(o); if (best.length >= 5) break; }
  return best;
}
function renderSwaps(p, R, B) {
  const list = swapCandidates(p, R, B);
  if (!list.length) { swapEl.innerHTML = '<p class="muted" style="margin:6px 0">No swaps with a net saving for this diet. Add some animal products, rice, olive or palm oil, chocolate or berries to see suggestions.</p>'; return; }
  const basisTxt = { prot: 'same protein', kcal: 'same energy', mass: 'same mass' };
  swapEl.innerHTML = list.map((o, i) => {
    const fa = FOOD[o.a], fb = FOOD[o.b];
    const chips = KEYS.map(k => { const v = o.d[k], pct = 100 * v / (R.tot[k] || 1), good = v >= 0; return `<span class="sw-chip ${good ? 'good' : 'bad'}" title="${IND[k].name}">${IND[k].short} ${good ? '−' : '+'}${fmt(Math.abs(v), IND[k].dig)} ${IND[k].unit}${Math.abs(pct) >= 1 ? ` <em>(${good ? '−' : '+'}${fmt(Math.abs(pct), 0)} %)</em>` : ''}</span>`; }).join('');
    return `<div class="sw-card"><div class="sw-head"><span class="sw-emo">${icon(fa, 'sw-i')}<span class="sw-arrow">→</span>${icon(fb, 'sw-i')}</span><div><b>Replace ${fmt(o.amt, 0)} g ${fa.name.toLowerCase()}</b> with <b>${fmt(o.repl, 0)} g ${fb.name.toLowerCase()}</b><div class="sw-basis">${basisTxt[o.basis]} · per day; over a year this saves ${fmt(o.d.ghg * 365 / 1000, 2)} t CO₂e</div></div><button type="button" class="btn btn-sm" data-i="${i}">Apply</button></div><div class="sw-chips">${chips}</div></div>`;
  }).join('');
  swapEl.querySelectorAll('button[data-i]').forEach(btn => btn.addEventListener('click', () => {
    const o = list[+btn.dataset.i], v = ui.values();
    const nb = Math.min(FOOD[o.b].max, (+v[o.b] || 0) + o.repl);
    ui.setMany({ [o.a]: Math.max(0, (+v[o.a] || 0) - o.amt), [o.b]: Math.round(nb) });
    window.FFP && FFP.toast && FFP.toast(`Swapped ${FOOD[o.a].name} → ${FOOD[o.b].name}`);
  }));
}

/* ------------------------------------------------------------ update */
function update() {
  const p = ui.values(), grams = gramsOf(p), R = compute(grams, p), B = budgets(p);
  const O = Object.fromEntries(KEYS.map(k => [k, R.tot[k] / B[k]]));
  const st = v => v <= 1 ? 'ok' : v <= 2 ? 'warn' : 'bad';
  const bLabel = p.basis === 'phd' ? 'planetary health diet' : 'boundary share';
  KEYS.forEach(k => ro.set(k, R.tot[k], st(O[k]), `${fmt(O[k], 2)}× ${k === 'eut' && p.basis === 'eat' ? 'PHD benchmark' : bLabel} · ${fmt(R.tot[k] * 365 * IND[k].yr.f, IND[k].yr.dig)} ${IND[k].yr.unit} yr⁻¹`));
  const kT = p.kcalT, pT = p.bw * PROTEIN_PRI;
  ro.set('kcal', R.kcal, Math.abs(R.kcal / kT - 1) <= 0.1 ? 'ok' : 'warn', `requirement ${fmt(kT, 0)} kcal d⁻¹`);
  ro.set('prot', R.prot, R.prot >= pT ? 'ok' : 'bad', `requirement ${fmt(pT, 0)} g d⁻¹ · ${fmt(R.kcal ? 400 * R.prot / R.kcal : 0, 1)} % of energy`);
  ro.set('animal', R.prot ? 100 * R.animal / R.prot : 0, null, 'dairy, eggs, meat and fish');
  ro.set('yr', R.tot.ghg * 365 / 1000, st(O.ghg), `fair share ${fmt(B.ghg * 365 / 1000, 2)} t CO₂e yr⁻¹`);
  GROUPS.forEach((g, gi) => { const el = document.getElementById('fgs-' + g.id); if (el) el.textContent = `${fmt(R.grp[gi].mass, 0)} g · ${fmt(R.tot.ghg ? 100 * R.grp[gi].ghg / R.tot.ghg : 0, 0)} % CO₂e`; });
  const gauges = KEYS.map(k => ({ k, title: IND[k].short + (k === 'eut' && p.basis === 'eat' ? '*' : ''), x: O[k], sub: `${fmt(R.tot[k], IND[k].dig)} of ${fmt(B[k], IND[k].dig)} ${IND[k].unit}` }));
  gauges.forEach((gg, i) => { gg.shown = target ? target.gauges[i].shown : 0.125; });
  target = { R, B, gauges };
  if (L) setTargets(p, R, B);
  const pl = p.plate === 'mass' ? 'mass of the planetary health diet' : p.plate === 'kcal' ? 'energy requirement' : p.plate === 'prot' ? 'protein requirement' : `daily ${IND[p.plate].short.toLowerCase()} ${p.plate === 'eut' || p.basis === 'phd' ? 'benchmark' : 'budget'}`;
  hud.set('mode', `Plate = ${pl} · <b>${fmt(fill * 100, 0)} %</b> full`);
  hud.set('basis', `${p.basis === 'phd' ? 'vs <b>planetary health diet</b>' : `EAT–Lancet share, <b>${fmt(p.pop, 1)} bn</b> people`} · <b>${STATLAB[p.stat]}</b> producers${p.waste ? ` · +${p.waste} % waste` : ''}`);
  kick();
  stack.set(KEYS.map(k => IND[k].short + (k === 'eut' && p.basis === 'eat' ? '*' : '')), GROUPS.map((g, gi) => ({ label: g.name, color: g.col, values: KEYS.map(k => 100 * R.grp[gi][k] / B[k]) })));
  stack.refLine(100, '');
  radar.draw(radar); nutri.draw(nutri); rangeC.draw(rangeC);
  renderSwaps(p, R, B);
}
let pend = 0;
ui.onChange(() => { cancelAnimationFrame(pend); pend = requestAnimationFrame(update); });
resize();
update();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { bgCache = null; update(); });
