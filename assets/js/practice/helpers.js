/* Helpers for randomised practice-problem generators (ES module).
   Each module file /assets/js/practice/<module-slug>.js exports:
     export default [ { id, title, lesson, difficulty, gen(rng) → problem }, … ]
   A numeric problem:  { q: html, answer: number, tol?: 0.02 (relative) | abstol?: number, unit?: string, solution: html }
   A choice problem:   { type: 'mcq', q: html, options: [html…], answer: index, solution: html }
   Use \( … \) for inline maths; in JS strings write '\\(' … '\\)'. */

/** Random number in [a, b] rounded to `step` (e.g., rand(rng, 100, 600, 10)). */
export function rand(rng, a, b, step = 1) { const v = a + rng() * (b - a); return +(Math.round(v / step) * step).toFixed(10); }
/** Random integer in [a, b]. */
export const randInt = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
/** Pick one element. */
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
/** Shuffle a copy. */
export function shuffle(rng, arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
/** Format a number for display in questions and solutions (significant figures). */
export function f(v, sig = 3) {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) { const e = Math.floor(Math.log10(a)); return `${(v / 10 ** e).toPrecision(sig)} × 10<sup>${e}</sup>`; }
  return (+v.toPrecision(sig)).toLocaleString('en-GB', { maximumFractionDigits: 10 });
}
/** Maths-safe number for use INSIDE \( … \): no thousands separators, LaTeX scientific notation (e.g. 3.2\times10^{-4}). */
export function fm(v, sig = 3) {
  if (!isFinite(v)) return '\\text{--}';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) { const e = Math.floor(Math.log10(a)); return `${(v / 10 ** e).toPrecision(sig)}\\times10^{${e}}`; }
  return String(+v.toPrecision(sig));
}
/** Build an ordered list of solution steps. */
export const steps = (...s) => `<ol class="steps">${s.map(x => `<li>${x}</li>`).join('')}</ol>`;
/** Build an MCQ with shuffled options; `correct` is the right option html, `wrong` an array of distractors. */
export function mcq(rng, q, correct, wrong, solution) {
  const opts = shuffle(rng, [correct, ...wrong]);
  return { type: 'mcq', q, options: opts, answer: opts.indexOf(correct), solution };
}
