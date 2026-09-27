/* Neophobia scales — take the Food Neophobia Scale (Pliner & Hobden, 1992) and the Food Technology
   Neophobia Scale (Cox & Evans, 2008), score them with reverse-coded items, compare with published
   population means, and explore reliability with simulated surveys: Cronbach's α with a Feldt interval,
   corrected item–total correlations, α if item deleted, careless responding, forgotten reverse coding,
   and how measurement error attenuates the link between neophobia and willingness to taste
   (Derive tab, Eqs. N1–N8). Answers stay in this browser (localStorage 'ffp-neophobia-v1'). */
import { Controls, Readouts, fmt } from '/assets/js/ui.js';
import { Plot, BarChart, linspace } from '/assets/js/plot.js';
import { withAlpha, resolveColor } from '/assets/js/colors.js';
import { cronbachAlpha, mean, sd, pearson, fInv, normCdf, normInv, mulberry32, randn, parseTable, tTestOne } from '/assets/js/stats.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = m => { if (window.FFP && FFP.toast) FFP.toast(m); };

/* =============================================================== the instruments */
const SCALES = {
  fns: {
    name: 'Food Neophobia Scale', short: 'FNS', ref: 'Pliner & Hobden (1992)', min: 10, max: 70,
    items: [
      ['I am constantly sampling new and different foods.', 1],
      ["I don't trust new foods.", 0],
      ["If I don't know what is in a food, I won't try it.", 0],
      ['I like foods from different countries.', 1],
      ['Ethnic food looks too weird to eat.', 0],
      ['At dinner parties, I will try a new food.', 1],
      ['I am afraid to eat things I have never had before.', 0],
      ['I am very particular about the foods I will eat.', 0],
      ['I will eat almost anything.', 1],
      ['I like to try new ethnic restaurants.', 1]
    ],
    // published means and SDs of total scores, as compiled by Szakály et al. (2021)
    refs: [
      { id: 'se-m', label: 'Sweden, mothers', m: 25.0, s: 7.5, src: 'Koivisto & Sjödén (1996)', nordic: true },
      { id: 'se-f', label: 'Sweden, fathers', m: 27.0, s: 9.1, src: 'Koivisto & Sjödén (1996)', nordic: true },
      { id: 'fi', label: 'Finland, adults', m: 33.9, s: 11.4, src: 'Tuorila et al. (2001)', nordic: true },
      { id: 'fi2', label: 'Finland, adults (other sample)', m: 38.0, s: 10.5, src: 'compiled by Szakály et al. (2021)', nordic: true },
      { id: 'ca', label: 'Canada, students', m: 34.51, s: 11.86, src: 'Pliner & Hobden (1992)' },
      { id: 'us', label: 'USA, students', m: 29.8, s: 11.7, src: 'Olabi et al. (2009)' },
      { id: 'lb', label: 'Lebanon, students', m: 36.4, s: 9.8, src: 'Olabi et al. (2009)' },
      { id: 'es', label: 'Spain, adults', m: 31.74, s: 10.98, src: 'Fernández-Ruiz et al. (2013)' },
      { id: 'hu', label: 'Hungary, adults', m: 39.75, s: 12.6, src: 'Szakály et al. (2021)' },
      { id: 'br', label: 'Brazil, students', m: 27.5, s: 11.1, src: 'Previato & Behrens (2015)' },
      { id: 'kr', label: 'Korea, adults 20–40', m: 33.5, s: 9.0, src: 'Choe & Cho (2011)' },
      { id: 'cn', label: 'China, students', m: 33.59, s: 8.14, src: 'Zhao et al. (2020)' }
    ]
  },
  ftns: {
    name: 'Food Technology Neophobia Scale', short: 'FTNS', ref: 'Cox & Evans (2008)', min: 13, max: 91,
    items: [
      ["There are plenty of tasty foods around so we don't need to use new food technologies to produce more.", 0],
      ['The benefits of new food technologies are often grossly overstated.', 0],
      ['New food technologies decrease the natural quality of food.', 0],
      ['There is no sense trying out high-tech food products because the ones I eat are already good enough.', 0],
      ['New foods are not healthier than traditional foods.', 0],
      ['New food technologies are something I am uncertain about.', 0],
      ['Society should not depend heavily on technologies to solve its food problems.', 0],
      ['New food technologies may have long term negative environmental effects.', 0],
      ['It can be risky to switch to new food technologies too quickly.', 0],
      ['New food technologies are unlikely to have long term negative health effects.', 1],
      ['New products using new food technologies can help people have a balanced diet.', 1],
      ['New food technologies give people more control over their food choices.', 1],
      ['The media usually provides a balanced and unbiased view of new food technologies.', 1]
    ],
    // item means ± SD (1–7) reported by Almli et al. (2019), converted to 13-item totals (×13)
    refs: [
      { id: 'no', label: 'Norway, adults', m: 13 * 4.18, s: 13 * 0.91, src: 'Almli et al. (2019)', nordic: true },
      { id: 'ro', label: 'Romania, adults', m: 13 * 4.60, s: 13 * 0.78, src: 'Almli et al. (2019)' },
      { id: 'tr', label: 'Turkey, adults', m: 13 * 4.43, s: 13 * 0.91, src: 'Almli et al. (2019)' }
    ]
  }
};
const ANCH = ['Strongly disagree', '', '', 'Neither', '', '', 'Strongly agree'];
const STORE = 'ffp-neophobia-v1';
let answers = { fns: new Array(10).fill(null), ftns: new Array(13).fill(null) };
try { const s = JSON.parse(localStorage.getItem(STORE) || 'null'); if (s && Array.isArray(s.fns) && Array.isArray(s.ftns) && s.fns.length === 10 && s.ftns.length === 13) answers = s; } catch (e) { /* storage unavailable */ }
const saveAnswers = () => { try { localStorage.setItem(STORE, JSON.stringify(answers)); } catch (e) { } };
/** Eqs. N1–N2: scored value of an item (reverse items: 8 − x) and the total. */
const scored = (x, rev) => rev ? 8 - x : x;
function scoreOf(key) {
  const S = SCALES[key], a = answers[key];
  const done = a.filter(v => v != null).length;
  const sN = S.items.reduce((s, [, r], i) => s + (!r && a[i] != null ? a[i] : 0), 0);
  const sR = S.items.reduce((s, [, r], i) => s + (r && a[i] != null ? a[i] : 0), 0);
  const nR = S.items.filter(([, r]) => r).length;
  return { done, k: S.items.length, sN, sR, nR, total: done === S.items.length ? sN + 8 * nR - sR : NaN };
}

/* =============================================================== controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ui.section('Questionnaire');
ui.segmented({ id: 'scale', label: 'Scale', options: [{ value: 'fns', label: 'FNS (10 items)' }, { value: 'ftns', label: 'FTNS (13 items)' }], value: 'fns', help: 'The analysis panels below follow the chosen scale.' });
ui.toggle({ id: 'showScore', label: 'Show how each answer is scored', value: true });
ui.buttons([{ label: 'Example answers', onClick: () => { answers.fns = [5, 2, 3, 6, 2, 5, 2, 4, 3, 6]; answers.ftns = [5, 3, 4, 3, 4, 5, 4, 5, 5, 4, 3, 3, 2]; saveAnswers(); renderQ(); update(); } }, { label: 'Clear my answers', onClick: () => { answers = { fns: new Array(10).fill(null), ftns: new Array(13).fill(null) }; saveAnswers(); renderQ(); update(); } }]);
ui.select({ id: 'refF', label: 'FNS reference population', options: SCALES.fns.refs.map(r => ({ value: r.id, label: `${r.label}: ${fmt(r.m, 1)} ± ${fmt(r.s, 1)}` })), value: 'se-f' });
ui.select({ id: 'refT', label: 'FTNS reference population', options: SCALES.ftns.refs.map(r => ({ value: r.id, label: `${r.label}: ${fmt(r.m, 1)} ± ${fmt(r.s, 1)}` })), value: 'no' });
ui.section('Survey data');
ui.segmented({ id: 'surv', label: 'Analyse', options: [{ value: 'sim', label: 'Simulated survey' }, { value: 'mine', label: 'My panel (pasted)' }], value: 'sim', help: 'My panel: paste raw answers (1–7) in the box below the readouts, one row per respondent.' });
ui.slider({ id: 'n', label: 'Respondents n', min: 10, max: 1000, step: 1, value: 60, log: true });
ui.slider({ id: 'lam', label: 'Typical item loading λ', min: 0.2, max: 0.9, step: 0.01, value: 0.66, help: 'How strongly each item reflects the trait (0.6–0.7 is typical of good scales).' });
ui.slider({ id: 'pmean', label: 'Population mean item score', min: 2, max: 6, step: 0.05, value: 3.0, unit: 'of 7', help: 'FNS total ≈ 10 × this; Swedish samples ≈ 2.5–2.7, Finnish ≈ 3.4–3.8.' });
ui.slider({ id: 'care', label: 'Careless respondents', min: 0, max: 40, step: 1, value: 0, unit: '%' });
ui.segmented({ id: 'ctype', label: 'Type of carelessness', options: [{ value: 'random', label: 'Random ticks' }, { value: 'straight', label: 'Straight-lining' }], value: 'straight' });
ui.toggle({ id: 'forget', label: 'Forget to reverse-code the R items', value: false });
ui.number({ id: 'seed', label: 'Random seed', min: 1, max: 99999, step: 1, value: 42 });
ui.buttons([{ label: 'New sample', onClick: () => ui.set('seed', 1 + Math.floor(Math.random() * 99998)) }, { label: '1000 replicate surveys', variant: 'primary', onClick: () => replicate(1000) }]);
ui.section('Neophobia and willingness to taste');
ui.slider({ id: 'rho', label: 'True correlation trait ↔ willingness ρ', min: -0.9, max: 0, step: 0.01, value: -0.5, help: 'Evans et al. (2010) observed r = −0.39 to −0.58 between FTNS and willingness to try.' });
ui.slider({ id: 'base', label: 'Share willing to taste (e.g., cricket bread)', min: 5, max: 95, step: 1, value: 60, unit: '%' });
ui.presets([
  { label: 'Student panel (60)', values: { n: 60, lam: 0.66, pmean: 3.0, care: 0, forget: false } },
  { label: 'Small class (20)', values: { n: 20, lam: 0.66, pmean: 3.0, care: 0, forget: false } },
  { label: 'National survey (1000)', values: { n: 1000, lam: 0.66, pmean: 3.4, care: 3, ctype: 'random' } },
  { label: 'Forgot reverse coding', values: { forget: true, care: 0 } },
  { label: 'Straight-liners (15 %)', values: { care: 15, ctype: 'straight', forget: false } }
]);
ui.saveButton('neophobia-scales', () => ro.values());

ro.add({ id: 'you', label: 'Your score', format: v => v })
  .add({ id: 'pct', label: 'Percentile in the reference', format: v => v })
  .add({ id: 'panel', label: 'Panel mean score ± SD', format: v => v })
  .add({ id: 'alpha', label: "Cronbach's α", digits: 3 })
  .add({ id: 'ci', label: 'Feldt 95 % interval for α', format: v => v })
  .add({ id: 'itc', label: 'Weakest corrected item–total r', format: v => v })
  .add({ id: 'robs', label: 'Observed r (score, willingness)', format: v => v })
  .add({ id: 'ptaste', label: 'Your predicted chance to taste', format: v => v });

/* =============================================================== questionnaire (stage) */
const stageEl = $('stage');
function renderQ() {
  const p = ui.values(), key = p.scale, S = SCALES[key], a = answers[key];
  const head = `<div class="nq-head"><div><div class="nq-kick">${esc(S.ref)} · 7-point agreement scale</div><h3>${S.name} (${S.short})</h3></div><div class="nq-note">Answer honestly — your answers stay in this browser. <b class="rb">R</b> = reverse-scored item.</div></div>`;
  const anchors = `<div class="nq-row nq-anchor"><span></span><span></span><div class="nq-opts">${ANCH.map((t, i) => `<span>${i + 1}<small>${t}</small></span>`).join('')}</div>${p.showScore ? '<span class="nq-sc">scored</span>' : ''}</div>`;
  const rows = S.items.map(([txt, rev], i) => {
    const v = a[i];
    return `<div class="nq-row${v == null ? '' : ' done'}"><span class="nq-num">${i + 1}</span><span class="nq-txt">${esc(txt)}${rev ? ' <b class="rb" title="Reverse-scored">R</b>' : ''}</span><div class="nq-opts" role="radiogroup" aria-label="Item ${i + 1}">${[1, 2, 3, 4, 5, 6, 7].map(x => `<button type="button" role="radio" aria-checked="${v === x}" aria-label="Item ${i + 1}: ${x} of 7" data-i="${i}" data-x="${x}" class="${v === x ? 'on' : ''}"></button>`).join('')}</div>${p.showScore ? `<span class="nq-sc">${v == null ? '–' : rev ? `<s>${v}</s> → <b>${8 - v}</b>` : `<b>${v}</b>`}</span>` : ''}</div>`;
  }).join('');
  const sc = scoreOf(key);
  const formula = key === 'fns' ? `FNS = S<sub>N</sub> + 40 − S<sub>R</sub> = ${sc.sN} + 40 − ${sc.sR}` : `FTNS = S<sub>N</sub> + 32 − S<sub>R</sub> = ${sc.sN} + 32 − ${sc.sR}`;
  const foot = `<div class="nq-foot"><div class="nq-prog"><div style="width:${100 * sc.done / sc.k}%"></div></div><div class="nq-score">${sc.done < sc.k ? `${sc.done} of ${sc.k} items answered` : `${formula} = <b>${sc.total}</b> <small>(range ${S.min}–${S.max}; higher = more neophobic)</small>`}</div></div>`;
  stageEl.innerHTML = head + `<div class="nq-list">${anchors}${rows}</div>` + foot;
}
stageEl.addEventListener('click', e => {
  const b = e.target.closest('button[data-i]'); if (!b) return;
  const key = ui.get('scale'), i = +b.dataset.i, x = +b.dataset.x;
  answers[key][i] = answers[key][i] === x ? null : x; saveAnswers(); renderQ(); update();
});

/* =============================================================== survey simulation (Eq. N6) */
function itemParams(key, lam, seed) {
  const S = SCALES[key], r = mulberry32(1000 + seed % 7), k = S.items.length;
  const loads = S.items.map(() => Math.min(0.95, Math.max(0.05, lam * (0.8 + 0.4 * r()))));
  const off = S.items.map(() => (r() - 0.5) * 1.0); const mo = mean(off);
  return { k, rev: S.items.map(([, rv]) => rv), loads, off: off.map(v => v - mo) };
}
function simulateSurvey(p, key, seed) {
  const r = mulberry32(seed), ip = itemParams(key, p.lam, p.seed), n = Math.round(p.n);
  const raw = [], theta = [], careless = [];
  for (let i = 0; i < n; i++) {
    const th = randn(r); theta.push(th);
    const isC = r() < p.care / 100; careless.push(isC);
    let row;
    if (isC && p.ctype === 'random') row = ip.rev.map(() => 1 + Math.floor(r() * 7));
    else if (isC) { const v = r() < 0.5 ? 4 : 1 + Math.floor(r() * 7); row = ip.rev.map(() => v); }
    else row = ip.loads.map((l, j) => { const z = l * th + Math.sqrt(1 - l * l) * randn(r); const s = Math.max(1, Math.min(7, Math.round(p.pmean + 1.5 * z + ip.off[j]))); return ip.rev[j] ? 8 - s : s; });
    raw.push(row);
  }
  const scoredRows = raw.map(row => row.map((x, j) => p.forget ? x : scored(x, ip.rev[j])));
  return { raw, scoredRows, theta, careless, ip, n, k: ip.k };
}
function reliability(rows) {
  const k = rows[0].length, n = rows.length, alpha = cronbachAlpha(rows);
  const tot = rows.map(r => r.reduce((a, b) => a + b, 0));
  const itc = [], aDel = [];
  for (let j = 0; j < k; j++) {
    const item = rows.map(r => r[j]), rest = tot.map((t, i) => t - item[i]);
    itc.push(sd(item) > 0 && sd(rest) > 0 ? pearson(item, rest).r : NaN);
    aDel.push(k > 2 ? cronbachAlpha(rows.map(r => r.filter((_, q) => q !== j))) : NaN);
  }
  const df1 = n - 1, df2 = (n - 1) * (k - 1);
  const ci = [1 - (1 - alpha) * fInv(0.975, df1, df2), 1 - (1 - alpha) * fInv(0.025, df1, df2)];
  return { alpha, itc, aDel, ci, tot, mean: mean(tot), sd: sd(tot) };
}
/** Pasted raw answers (respondents × items, 1–7; an ID column and extra columns are ignored). */
function parsePanel(text, key, forget) {
  const S = SCALES[key], k = S.items.length;
  const T = parseTable(text);
  if (!T.rows.length) throw new Error('No data found — paste one row per respondent with the raw answers 1–7.');
  const numCols = T.headers.map((_, j) => j).filter(j => T.rows.filter(r => typeof r[j] === 'number').length >= T.rows.length * 0.6);
  if (numCols.length < k) throw new Error(`Found ${numCols.length} numeric columns, but the ${S.short} has ${k} items.`);
  const cols = numCols.slice(0, k); let dropped = 0; const raw = [];
  T.rows.forEach(r => { const v = cols.map(j => r[j]); if (v.every(x => typeof x === 'number' && x >= 1 && x <= 7 && Math.round(x) === x)) raw.push(v); else dropped++; });
  if (raw.length < 3) throw new Error('Fewer than three complete respondents after cleaning.');
  const rev = S.items.map(([, rv]) => rv);
  return { raw, scoredRows: raw.map(row => row.map((x, j) => forget ? x : scored(x, rev[j]))), n: raw.length, k, dropped, cols: cols.map(j => T.headers[j]) };
}
/** Reliability (ω) of the sum of the continuous latent responses — the model's "true" reliability. */
function omega(ip) { const L = ip.loads.reduce((a, b) => a + b, 0); const U = ip.loads.reduce((a, l) => a + 1 - l * l, 0); return L * L / (L * L + U); }

/* =============================================================== charts */
const refPlot = new Plot('#chart-ref', { x: { label: 'Total score', unit: 'points' }, y: { label: 'Density', unit: '', min: 0 } });
const itemChart = new BarChart('#chart-items', { y: { label: 'Correlation / reliability', unit: '', min: -0.4, max: 1 } });
const aPlot = new Plot('#chart-alpha', { x: { label: 'Respondents n', min: 10, max: 1000, log: true }, y: { label: "Cronbach's α", unit: '', min: 0, max: 1 } });
const wPlot = new Plot('#chart-will', { x: { label: 'Score', unit: 'points' }, y: { label: 'Share willing to taste', unit: '', min: 0, max: 1 } });
let repResult = null;
function replicate(R) {
  const p = ui.values(), key = p.scale, vals = [];
  for (let r = 0; r < R; r++) { const s = simulateSurvey(p, key, 5000 + r); vals.push(cronbachAlpha(s.scoredRows)); }
  repResult = { key: [key, p.n, p.lam, p.pmean, p.care, p.ctype, p.forget].join('|'), vals };
  update(); toast(`${R} surveys simulated`);
}

/* =============================================================== update */
function update() {
  const p = ui.values(), key = p.scale, S = SCALES[key];
  renderQ();
  // --- your score vs references (Eqs. N1–N3)
  const sc = scoreOf(key), refs = S.refs, ref = refs.find(r => r.id === (key === 'fns' ? p.refF : p.refT)) || refs[0];
  ui.show('refF', key === 'fns'); ui.show('refT', key === 'ftns');
  if (isFinite(sc.total)) {
    const z = (sc.total - ref.m) / ref.s;
    ro.set('you', `${S.short} ${sc.total}`, null, `of ${S.min}–${S.max}; S<sub>N</sub> = ${sc.sN}, S<sub>R</sub> = ${sc.sR}`);
    ro.set('pct', `${fmt(100 * normCdf(z), 0)} %`, null, `z = ${fmt(z, 2)} vs ${esc(ref.label)} (${fmt(ref.m, 1)} ± ${fmt(ref.s, 1)})`);
  } else { ro.set('you', `${sc.done} / ${sc.k} items`, 'warn', 'answer all items to get a score'); ro.set('pct', '—', null, `reference: ${esc(ref.label)}`); }
  const xs = linspace(S.min, S.max, 241);
  refPlot.clear(); refPlot.setAxis('x', { min: S.min, max: S.max });
  refs.forEach((r, i) => { const on = r.id === ref.id; refPlot.line(r.id, xs, xs.map(x => Math.exp(-0.5 * ((x - r.m) / r.s) ** 2) / (r.s * Math.sqrt(2 * Math.PI))), { color: on ? 'accent' : r.nordic ? 'water' : 'muted', width: on ? 3 : 1.4, fill: on ? 0.14 : false, opacity: on ? 1 : 0.55, label: on ? `${r.label} (${r.src})` : undefined, dash: r.nordic || on ? null : [4, 3] }); });
  if (isFinite(sc.total)) refPlot.vline('you', sc.total, { color: 'magenta', label: `you: ${sc.total}` }); else refPlot.remove('you');
  // --- survey: simulated (Eqs. N4–N6) or the student's own panel
  const sim = simulateSurvey(p, key, p.seed), om = omega(sim.ip);
  if (svyAuto && svyKey !== key) fillExample(key);
  let mine = null;
  if (p.surv === 'mine') {
    try { mine = parsePanel($('svy').value, key, p.forget); $('svy-msg').textContent = `Your panel: ${mine.n} respondents × ${mine.k} items (${S.short})${mine.dropped ? `; ${mine.dropped} incomplete or invalid row(s) dropped` : ''}.`; $('svy-msg').className = 'pmsg ok'; }
    catch (e) { $('svy-msg').textContent = e.message + ' Showing the simulated survey instead.'; $('svy-msg').className = 'pmsg bad'; }
  } else { $('svy-msg').textContent = `The analysis currently uses the simulated survey. Choose “My panel (pasted)” to analyse the answers in this box (${S.short}: ${S.items.length} columns).`; $('svy-msg').className = 'pmsg'; }
  ['n', 'lam', 'pmean', 'care', 'ctype', 'seed'].forEach(id => ui.enable(id, !mine));
  const rel = reliability(mine ? mine.scoredRows : sim.scoredRows), nN = mine ? mine.n : sim.n;
  ro.set('alpha', rel.alpha, rel.alpha >= 0.8 ? 'ok' : rel.alpha >= 0.7 ? 'warn' : 'bad', `${mine ? 'your panel' : 'simulated'}: n = ${nN}, k = ${sim.k}${mine ? '' : `; model reliability ω = ${fmt(om, 2)}`}${p.forget ? ' — R items not reversed!' : ''}`);
  const tt = nN > 2 && rel.sd > 0 ? tTestOne(rel.tot, ref.m) : null;
  ro.set('panel', `${fmt(rel.mean, 1)} ± ${fmt(rel.sd, 1)}`, null, tt ? `${mine ? 'your panel' : 'simulated panel'} vs ${esc(ref.label)}: difference ${fmt(tt.diff, 1)}, t(${tt.df}) = ${fmt(tt.t, 2)}, p ${tt.p < 0.001 ? '< 0.001' : '= ' + fmt(tt.p, 3)}` : '');
  if (mine) refPlot.vline('panel', rel.mean, { color: 'amber', label: `your panel: ${fmt(rel.mean, 1)}` }); else refPlot.remove('panel');
  ro.set('ci', `${fmt(rel.ci[0], 2)} to ${fmt(rel.ci[1], 2)}`, null, `width ${fmt(rel.ci[1] - rel.ci[0], 2)} (Feldt, 1965)`);
  const worst = rel.itc.reduce((b, v, j) => (v < rel.itc[b] ? j : b), 0);
  ro.set('itc', `item ${worst + 1}: ${fmt(rel.itc[worst], 2)}`, rel.itc[worst] >= 0.3 ? 'ok' : rel.itc[worst] >= 0.2 ? 'warn' : 'bad', `α without it: ${fmt(rel.aDel[worst], 3)}`);
  itemChart.set(S.items.map(([, r], j) => `${j + 1}${r ? ' R' : ''}`), [
    { label: 'corrected item–total r', values: rel.itc, color: 'water', format: v => fmt(v, 2) },
    { label: 'α if item deleted', values: rel.aDel, color: 'amber', format: v => fmt(v, 2) }
  ]);
  itemChart.refLines([{ v: rel.alpha, label: `α = ${fmt(rel.alpha, 2)}`, color: 'magenta' }, { v: 0.3, label: 'r = 0.3', color: 'muted' }]);
  // --- precision of α across n (Feldt band around the model's expected α)
  const ns = []; for (let n = 10; n <= 1000; n = Math.round(n * 1.12) + 1) ns.push(n); ns.push(1000);
  const aExp = rel.alpha > 0 ? rel.alpha : 0.01;
  const lo = ns.map(n => 1 - (1 - aExp) * fInv(0.975, n - 1, (n - 1) * (sim.k - 1))), hi = ns.map(n => 1 - (1 - aExp) * fInv(0.025, n - 1, (n - 1) * (sim.k - 1)));
  aPlot.clear(); aPlot.setAxis('y', { min: Math.min(0, Math.floor(Math.min(...lo, rel.alpha) * 10) / 10), max: 1 });
  aPlot.band('band', ns, lo, hi, { color: 'accent', alpha: 0.16, label: `Feldt 95 % range if α = ${fmt(aExp, 2)}` });
  if (!mine) aPlot.hline('omega', om, { color: 'muted', label: `model ω = ${fmt(om, 2)}`, dash: [5, 4] });
  aPlot.scatter('now', [nN], [rel.alpha], { color: 'magenta', r: 6, yErr: [(rel.ci[1] - rel.ci[0]) / 2], label: mine ? 'your panel (± half-width)' : 'this survey (± half-width)' });
  const rk = [key, p.n, p.lam, p.pmean, p.care, p.ctype, p.forget].join('|');
  if (!mine && repResult && repResult.key === rk) {
    const v = [...repResult.vals].sort((a, b) => a - b), q = f => v[Math.floor(f * (v.length - 1))];
    aPlot.scatter('rep', [sim.n, sim.n], [q(0.025), q(0.975)], { color: 'ink', r: 4, shape: 'diamond', label: `2.5 % and 97.5 % of ${v.length} simulated surveys` });
    $('rep-note').textContent = `${v.length} replicate surveys of n = ${sim.n}: α ranged ${fmt(q(0.025), 3)}–${fmt(q(0.975), 3)} (central 95 %), median ${fmt(q(0.5), 3)}.`;
  } else $('rep-note').textContent = mine ? 'For your own panel the band shows how precisely α can be estimated with this number of respondents.' : 'Press “1000 replicate surveys” to see how much α varies between surveys of this size.';
  // --- willingness to taste (Eqs. N7–N8)
  const c = normInv(1 - p.base / 100), rhoT = p.rho, r2 = Math.sqrt(1 - rhoT * rhoT), rw = mulberry32(p.seed + 99);
  const tot = mine ? sim.scoredRows.map(r => r.reduce((a, b) => a + b, 0)) : rel.tot, W = sim.theta.map(th => rhoT * th + r2 * randn(rw));
  const wRating = W.map(w => Math.max(1, Math.min(7, Math.round(4 + 1.6 * w))));
  const taste = W.map(w => w > c ? 1 : 0);
  const pr = sd(tot) > 0 ? pearson(tot, wRating).r : NaN;
  const relA = Math.max(0, rel.alpha);
  if (mine) ro.set('robs', '—', null, 'needs willingness data — the chart uses the model with the α of your panel'); else ro.set('robs', `r = ${fmt(pr, 2)}`, null, `true ρ = ${fmt(rhoT, 2)}; Spearman: ρ√α ≈ ${fmt(rhoT * Math.sqrt(relA), 2)} (before rounding of the willingness rating)`);
  const mx = rel.mean, sx = rel.sd || 1;
  const pOf = x => normCdf((rhoT * Math.sqrt(relA) * (x - mx) / sx - c) / Math.sqrt(Math.max(1e-6, 1 - rhoT * rhoT * relA)));
  const gx = linspace(S.min, S.max, 121);
  wPlot.clear(); wPlot.setAxis('x', { min: S.min, max: S.max, label: `${S.short} total score` });
  // binned observed shares (quintiles of the score)
  const idx = tot.map((v, i) => i).sort((a, b) => tot[a] - tot[b]), nb = Math.min(8, Math.max(3, Math.floor(tot.length / 12)));
  const bx = [], by = [];
  for (let q = 0; q < nb; q++) { const part = idx.slice(Math.floor(q * idx.length / nb), Math.floor((q + 1) * idx.length / nb)); if (!part.length) continue; bx.push(mean(part.map(i => tot[i]))); by.push(mean(part.map(i => taste[i]))); }
  wPlot.line('model', gx, gx.map(pOf), { color: 'accent', width: 2.6, label: 'model: P(taste | score)' });
  if (!mine) wPlot.scatter('bins', bx, by, { color: 'water', r: 6, shape: 'square', label: `simulated respondents (${nb} score groups)` });
  wPlot.hline('base', p.base / 100, { color: 'muted', label: `overall ${p.base} %`, dash: [4, 4] });
  if (isFinite(sc.total) && !p.forget) { const pt = pOf(sc.total); wPlot.point('you', sc.total, pt, { color: 'magenta', label: `you: ${fmt(100 * pt, 0)} %`, guides: true }); ro.set('ptaste', `${fmt(100 * pt, 0)} %`, null, `if you belonged to the simulated population (base ${p.base} %)`); }
  else { wPlot.remove('you'); ro.set('ptaste', '—', null, isFinite(sc.total) ? 'switch reverse coding back on' : 'complete the questionnaire'); }
}
/* example panel data for the paste box (simulated, clearly labelled) */
let svyAuto = true, svyKey = '';
function fillExample(key) {
  const S = SCALES[key], s = simulateSurvey({ n: 24, lam: 0.66, pmean: 3.0, care: 0, ctype: 'random', forget: false, seed: 7 }, key, 7);
  $('svy').value = ['respondent,' + S.items.map((_, j) => 'item' + (j + 1)).join(','), ...s.raw.map((r, i) => 'R' + String(i + 1).padStart(2, '0') + ',' + r.join(','))].join('\n');
  svyKey = key;
}
$('svy').addEventListener('input', () => { svyAuto = false; });
$('svy-run').addEventListener('click', () => { if (ui.get('surv') !== 'mine') ui.set('surv', 'mine'); else update(); });
$('svy-reset').addEventListener('click', () => { svyAuto = true; fillExample(ui.get('scale')); update(); });
fillExample(ui.get('scale'));
ui.onChange((s, id) => { if (id === 'scale' || id === 'showScore') renderQ(); cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
let raf = 0;
update();
window.__neo = { SCALES, scoreOf, simulateSurvey, reliability, omega, get answers() { return answers; } };
