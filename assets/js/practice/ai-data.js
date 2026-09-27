/* ==========================================================================
   Practice generators — Module 10: Artificial intelligence and data-driven cultivation
   Lessons: data-to-models (10.1), machine-learning (10.2), computer-vision (10.3),
            control-optimisation (10.4), digital-twins (10.5)
   Every generator returns a fresh, randomised, auto-marked problem. Inputs are
   rounded before the answer is computed, so the numbers shown are exactly the
   numbers used. Equation numbers refer to the lessons.
   ========================================================================== */
import { rand, randInt, pick, f, steps, mcq } from './helpers.js';

const sum = a => a.reduce((s, v) => s + v, 0);
const mean = a => sum(a) / a.length;
const sigmoid = z => 1 / (1 + Math.exp(-z));

export default [
  /* ======================= 10.1 from data to models ======================= */
  {
    id: 'ai-ls-slope', title: 'Least-squares slope from five calibration plants', lesson: 'data-to-models', difficulty: 1,
    gen(rng) {
      const b = rand(rng, 0.25, 0.45, 0.01), a = rand(rng, -8, 6, 1);
      const X = [0, 1, 2, 3, 4].map(i => 100 + 70 * i + randInt(rng, -15, 15));
      const Y = X.map(x => +(a + b * x + rand(rng, -4, 4, 0.1)).toFixed(1));
      const mx = mean(X), my = mean(Y);
      const sxx = sum(X.map(x => (x - mx) ** 2)), sxy = sum(X.map((x, i) => (x - mx) * (Y[i] - my)));
      const slope = sxy / sxx;
      return {
        q: `Five lettuces were photographed and weighed. Projected area \\(x\\) (cm²): ${X.join(', ')}; fresh mass \\(y\\) (g): ${Y.join(', ')}. What is the least-squares slope \\(\\hat b\\)?`,
        answer: slope, tol: 0.01, unit: 'g cm⁻²',
        solution: steps(`Means: \\(\\bar x = ${f(mx, 5)}\\), \\(\\bar y = ${f(my, 5)}\\).`,
          `\\(S_{xx} = \\sum(x_i-\\bar x)^2 = ${f(sxx, 5)}\\) cm⁴; \\(S_{xy} = \\sum(x_i-\\bar x)(y_i-\\bar y) = ${f(sxy, 5)}\\) g cm².`,
          `\\(\\hat b = S_{xy}/S_{xx} = ${f(slope, 4)}\\) g cm⁻² (Eq. 10.1.2); the intercept follows as \\(\\hat a = \\bar y - \\hat b\\bar x = ${f(my - slope * mx, 3)}\\) g.`)
      };
    }
  },
  {
    id: 'ai-r2-rmse', title: 'R² or RMSE of a fitted model', lesson: 'data-to-models', difficulty: 2,
    gen(rng) {
      const obs = [0, 1, 2, 3, 4, 5].map(i => rand(rng, 20 + 30 * i, 40 + 30 * i, 1));
      const pred = obs.map(o => +(o + rand(rng, -9, 9, 0.5)).toFixed(1));
      const my = mean(obs), sse = sum(obs.map((o, i) => (o - pred[i]) ** 2)), sst = sum(obs.map(o => (o - my) ** 2));
      const askR2 = rng() < 0.5, ans = askR2 ? 1 - sse / sst : Math.sqrt(sse / obs.length);
      return {
        q: `A growth model predicted ${pred.join(', ')} cm² where ${obs.join(', ')} cm² were measured. What is the ${askR2 ? 'coefficient of determination \\(R^2\\)' : 'root-mean-square error (RMSE, divide by \\(n\\))'}?`,
        answer: ans, tol: askR2 ? 0.005 : 0.02, unit: askR2 ? '' : 'cm²',
        solution: steps(`Residuals \\(e_i = y_i-\\hat y_i\\): ${obs.map((o, i) => f(o - pred[i], 3)).join(', ')}; \\(\\text{SSE} = ${f(sse, 4)}\\).`,
          `\\(\\bar y = ${f(my, 4)}\\); \\(\\text{SST} = \\sum(y_i-\\bar y)^2 = ${f(sst, 5)}\\).`,
          askR2 ? `\\(R^2 = 1-\\text{SSE}/\\text{SST} = ${f(ans, 4)}\\) (Eq. 10.1.3).` : `\\(\\text{RMSE} = \\sqrt{\\text{SSE}/n} = \\sqrt{${f(sse, 4)}/6} = ${f(ans, 3)}\\) cm² (Eq. 10.1.3).`)
      };
    }
  },
  {
    id: 'ai-growth-curve', title: 'Evaluate a logistic or Gompertz growth curve', lesson: 'data-to-models', difficulty: 1,
    gen(rng) {
      const K = rand(rng, 300, 700, 10), r = rand(rng, 0.12, 0.3, 0.01), ti = rand(rng, 12, 22, 1), t = rand(rng, 5, 35, 1);
      const logi = rng() < 0.5, W = logi ? K / (1 + Math.exp(-r * (t - ti))) : K * Math.exp(-Math.exp(-r * (t - ti)));
      return {
        q: `A ${logi ? 'logistic' : 'Gompertz'} curve for projected leaf area has \\(K = ${K}\\) cm², \\(r = ${r}\\) d⁻¹ and \\(t_i = ${ti}\\) d. What is the predicted area on day ${t}?`,
        answer: W, tol: 0.02, unit: 'cm²',
        solution: logi
          ? steps(`Logistic (Eq. 10.1.5): \\(W = K/[1+e^{-r(t-t_i)}]\\).`, `\\(r(t-t_i) = ${r}\\times(${t}-${ti}) = ${f(r * (t - ti), 3)}\\); \\(e^{-${f(r * (t - ti), 3)}} = ${f(Math.exp(-r * (t - ti)), 4)}\\).`, `\\(W = ${K}/(1+${f(Math.exp(-r * (t - ti)), 4)}) = ${f(W, 4)}\\) cm².`)
          : steps(`Gompertz (Eq. 10.1.6): \\(W = K\\exp[-e^{-r(t-t_i)}]\\).`, `\\(e^{-r(t-t_i)} = e^{-${f(r * (t - ti), 3)}} = ${f(Math.exp(-r * (t - ti)), 4)}\\).`, `\\(W = ${K}\\times e^{-${f(Math.exp(-r * (t - ti)), 4)}} = ${f(W, 4)}\\) cm² (at \\(t = t_i\\) the Gompertz curve is at \\(K/e\\)).`)
      };
    }
  },
  {
    id: 'ai-rgr-fit', title: 'Relative growth rate from a log-linear fit', lesson: 'data-to-models', difficulty: 2,
    gen(rng) {
      const r = rand(rng, 0.12, 0.3, 0.01), W0 = rand(rng, 1, 5, 0.1), T = [0, 4, 8, 12];
      const W = T.map(t => +(W0 * Math.exp(r * t) * (1 + rand(rng, -0.06, 0.06, 0.01))).toFixed(2));
      const L = W.map(Math.log), mt = mean(T), ml = mean(L);
      const slope = sum(T.map((t, i) => (t - mt) * (L[i] - ml))) / sum(T.map(t => (t - mt) ** 2));
      return {
        q: `Mean fresh mass of harvested seedlings was ${W.join(', ')} g on days ${T.join(', ')}. Fit \\(\\ln W = \\ln W_0 + rt\\) by least squares. What is the relative growth rate \\(r\\)?`,
        answer: slope, tol: 0.02, unit: 'd⁻¹',
        solution: steps(`Take logarithms: \\(\\ln W\\) = ${L.map(v => f(v, 4)).join(', ')}.`,
          `\\(\\bar t = ${mt}\\), \\(S_{tt} = ${sum(T.map(t => (t - mt) ** 2))}\\) d²; \\(S_{t\\ell} = ${f(sum(T.map((t, i) => (t - mt) * (L[i] - ml))), 4)}\\) d.`,
          `\\(r = S_{t\\ell}/S_{tt} = ${f(slope, 4)}\\) d⁻¹ (Eq. 10.1.4); doubling time \\(\\ln 2/r = ${f(Math.LN2 / slope, 3)}\\) d.`)
      };
    }
  },
  {
    id: 'ai-harvest-day', title: 'Forecast the harvest day from a logistic fit', lesson: 'data-to-models', difficulty: 3,
    gen(rng) {
      const K = rand(rng, 400, 650, 10), r = rand(rng, 0.15, 0.3, 0.01), ti = rand(rng, 14, 22, 0.5), Wt = rand(rng, 0.6 * K, 0.9 * K, 10);
      const t = ti - Math.log(K / Wt - 1) / r;
      return {
        q: `A logistic fit to your grow log gives \\(K = ${K}\\) cm², \\(r = ${r}\\) d⁻¹ and \\(t_i = ${ti}\\) d. On which day will the plant reach the harvest size of ${Wt} cm²?`,
        answer: t, abstol: 0.15, unit: 'd',
        solution: steps(`Solve \\(W^* = K/[1+e^{-r(t^*-t_i)}]\\) for \\(t^*\\): \\(t^* = t_i - \\ln(K/W^*-1)/r\\) (Eq. 10.1.10).`,
          `\\(K/W^*-1 = ${f(K / Wt - 1, 4)}\\); \\(\\ln(\\cdot) = ${f(Math.log(K / Wt - 1), 4)}\\).`,
          `\\(t^* = ${ti} - (${f(Math.log(K / Wt - 1), 4)})/${r} = ${f(t, 4)}\\) d. Targets close to \\(K\\) are very sensitive to errors in \\(K\\).`)
      };
    }
  },
  /* ======================= 10.2 machine learning ======================= */
  {
    id: 'ai-confusion', title: 'Precision, recall or F1 from a confusion matrix', lesson: 'machine-learning', difficulty: 2,
    gen(rng) {
      const TP = randInt(rng, 40, 190), FN = randInt(rng, 5, 60), FP = randInt(rng, 10, 150), TN = randInt(rng, 800, 9500);
      const P = TP / (TP + FP), R = TP / (TP + FN), F1 = 2 * P * R / (P + R), k = pick(rng, ['precision', 'recall', 'F1']);
      const ans = k === 'precision' ? P : k === 'recall' ? R : F1;
      return {
        q: `A camera system for early downy mildew gave TP = ${TP}, FP = ${FP}, FN = ${FN} and TN = ${TN} on a validation set. What is its <b>${k}</b>?`,
        answer: ans, abstol: 0.005,
        solution: steps(`Precision \\(= TP/(TP+FP) = ${TP}/${TP + FP} = ${f(P, 4)}\\).`, `Recall \\(= TP/(TP+FN) = ${TP}/${TP + FN} = ${f(R, 4)}\\).`,
          `F1 \\(= 2PR/(P+R) = ${f(F1, 4)}\\) (Eq. 10.2.10). Accuracy \\(= ${f((TP + TN) / (TP + FP + FN + TN), 4)}\\) looks better than all three — the class imbalance hides the false alarms.`)
      };
    }
  },
  {
    id: 'ai-gd-step', title: 'One gradient-descent step', lesson: 'machine-learning', difficulty: 2,
    gen(rng) {
      const X = [1, 2, 3], wt = rand(rng, 1.5, 3, 0.1), Y = X.map(x => +(wt * x + rand(rng, -0.4, 0.4, 0.1)).toFixed(1));
      const w = rand(rng, 0, 1.5, 0.1), eta = pick(rng, [0.02, 0.05, 0.1]);
      const g = -2 / 3 * sum(X.map((x, i) => x * (Y[i] - w * x))), w1 = w - eta * g;
      return {
        q: `A one-parameter model \\(\\hat y = wx\\) is trained on \\((x,y)\\) = ${X.map((x, i) => `(${x}, ${Y[i]})`).join(', ')} by minimising the mean squared error. Starting from \\(w = ${w}\\) with learning rate \\(\\eta = ${eta}\\), what is \\(w\\) after one gradient-descent step?`,
        answer: w1, tol: 0.01,
        solution: steps(`\\(L = \\frac1n\\sum(y_i-wx_i)^2\\), so \\(\\partial L/\\partial w = -\\frac2n\\sum x_i(y_i-wx_i)\\).`,
          `Residuals at \\(w = ${w}\\): ${X.map((x, i) => f(Y[i] - w * x, 3)).join(', ')}; gradient \\(= ${f(g, 4)}\\).`,
          `\\(w \\leftarrow w - \\eta\\,\\partial L/\\partial w = ${w} - ${eta}\\times(${f(g, 4)}) = ${f(w1, 4)}\\) (Eq. 10.2.7).`)
      };
    }
  },
  {
    id: 'ai-neuron', title: 'Output of a single neuron (sigmoid or ReLU)', lesson: 'machine-learning', difficulty: 1,
    gen(rng) {
      const w1 = rand(rng, -2, 2, 0.1), w2 = rand(rng, -2, 2, 0.1), b = rand(rng, -1, 1, 0.1), x1 = rand(rng, -2, 2, 0.1), x2 = rand(rng, -2, 2, 0.1);
      const z = w1 * x1 + w2 * x2 + b, act = pick(rng, ['sigmoid', 'ReLU']), a = act === 'sigmoid' ? sigmoid(z) : Math.max(0, z);
      return {
        q: `A neuron with weights \\(w = (${w1}, ${w2})\\), bias \\(b = ${b}\\) and a <b>${act}</b> activation receives the inputs \\(x = (${x1}, ${x2})\\). What is its output?`,
        answer: a, abstol: 0.005,
        solution: steps(`Weighted sum: \\(z = ${w1}\\times${x1} + ${w2}\\times${x2} + ${b} = ${f(z, 4)}\\).`,
          act === 'sigmoid' ? `\\(\\sigma(z) = 1/(1+e^{-z}) = ${f(a, 4)}\\) (Eq. 10.2.5).` : `\\(\\text{ReLU}(z) = \\max(0, z) = ${f(a, 4)}\\) (Eq. 10.2.5).`)
      };
    }
  },
  /* ======================= 10.3 computer vision ======================= */
  {
    id: 'ai-exg', title: 'Excess-green index of a pixel', lesson: 'computer-vision', difficulty: 1,
    gen(rng) {
      const R = randInt(rng, 30, 160), G = randInt(rng, 40, 200), B = randInt(rng, 20, 120), s = R + G + B;
      const exg = (2 * G - R - B) / s;
      return {
        q: `A pixel has \\((R, G, B) = (${R}, ${G}, ${B})\\). Compute its excess-green index \\(\\text{ExG} = 2g-r-b\\) with chromatic coordinates.`,
        answer: exg, abstol: 0.005,
        solution: steps(`Sum \\(R+G+B = ${s}\\): \\(r = ${f(R / s, 4)}\\), \\(g = ${f(G / s, 4)}\\), \\(b = ${f(B / s, 4)}\\) (Eq. 10.3.1).`,
          `\\(\\text{ExG} = 2g-r-b = ${f(exg, 4)}\\) — equivalently \\(3g-1\\) (Eq. 10.3.4). ${exg > 0 ? 'Positive: greener than grey.' : 'Negative: not greener than grey.'}`)
      };
    }
  },
  {
    id: 'ai-exgr-class', title: 'Plant or background with ExG − ExR?', lesson: 'computer-vision', difficulty: 1,
    gen(rng) {
      const plant = rng() < 0.5;
      const R = plant ? randInt(rng, 40, 100) : randInt(rng, 90, 170), G = plant ? randInt(rng, 110, 190) : randInt(rng, 70, 130), B = randInt(rng, 30, 90), s = R + G + B;
      const v = (3 * G - 2.4 * R - B) / s, isPlant = v > 0;
      return mcq(rng, `A pixel reads \\((R, G, B) = (${R}, ${G}, ${B})\\). Using ExG − ExR \\(= 3g - 2.4r - b\\) with its built-in threshold of zero, how is it classified?`,
        isPlant ? 'plant' : 'background', [isPlant ? 'background' : 'plant', 'cannot be decided without Otsu’s threshold', 'plant only if its hue is above 180°'],
        steps(`\\(r = ${f(R / s, 3)}\\), \\(g = ${f(G / s, 3)}\\), \\(b = ${f(B / s, 3)}\\).`, `\\(3g-2.4r-b = ${f(v, 3)}\\) ${v > 0 ? '&gt; 0 → plant' : '≤ 0 → background'} (Eq. 10.3.4; Meyer &amp; Neto, 2008).`));
    }
  },
  {
    id: 'ai-pixel-area', title: 'Pixels to square centimetres with a reference card', lesson: 'computer-vision', difficulty: 1,
    gen(rng) {
      const L = pick(rng, [4, 5, 8, 10]), n = randInt(rng, 60, 420), N = randInt(rng, 20, 900) * 1000;
      const s = L / n, A = N * s * s;
      return {
        q: `A ${L} cm reference card spans ${n} pixels in a top-view photo (card and leaves at the same height). The segmented plant contains ${N.toLocaleString('en-GB')} pixels. What is the projected leaf area?`,
        answer: A, tol: 0.02, unit: 'cm²',
        solution: steps(`Pixel size \\(s = L/n = ${L}/${n} = ${f(s, 4)}\\) cm px⁻¹ (Eq. 10.3.7).`, `\\(A = N s^2 = ${N}\\times${f(s * s, 4)} = ${f(A, 4)}\\) cm².`)
      };
    }
  },
  {
    id: 'ai-perspective', title: 'Correct a projected area for perspective', lesson: 'computer-vision', difficulty: 2,
    gen(rng) {
      const D = rand(rng, 50, 150, 5), h = rand(rng, 5, 20, 1), A = rand(rng, 80, 600, 5);
      const fac = (D / (D - h)) ** 2, At = A / fac;
      return {
        q: `The scale of a photo was taken from a reference card lying on the tray ${D} cm below the camera, but the top of the lettuce canopy is ${h} cm above the tray. The uncorrected projected area is ${A} cm². Estimate the area at canopy height.`,
        answer: At, tol: 0.02, unit: 'cm²',
        solution: steps(`Leaves are at \\(D - h = ${D - h}\\) cm from the camera; they are imaged larger by \\(D/(D-h) = ${f(D / (D - h), 4)}\\) in length.`, `Area factor \\((D/(D-h))^2 = ${f(fac, 4)}\\) (Eq. 10.3.7).`, `\\(A_{\\text{true}} = ${A}/${f(fac, 4)} = ${f(At, 4)}\\) cm² — put the reference at canopy height to avoid this error.`)
      };
    }
  },
  {
    id: 'ai-otsu-variance', title: 'Between-class variance (Otsu)', lesson: 'computer-vision', difficulty: 2,
    gen(rng) {
      const w0 = rand(rng, 0.2, 0.8, 0.05), m0 = rand(rng, 0, 3, 0.1), m1 = rand(rng, 4, 7, 0.1), sB = w0 * (1 - w0) * (m1 - m0) ** 2;
      return {
        q: `A threshold splits an index histogram into a background class with fraction \\(\\omega_0 = ${w0}\\) and mean level \\(\\mu_0 = ${m0}\\), and a plant class with mean level \\(\\mu_1 = ${m1}\\). What is the between-class variance \\(\\sigma_B^2\\)?`,
        answer: sB, tol: 0.01, unit: 'level²',
        solution: steps(`\\(\\omega_1 = 1-\\omega_0 = ${f(1 - w0, 3)}\\).`, `\\(\\sigma_B^2 = \\omega_0\\omega_1(\\mu_0-\\mu_1)^2 = ${w0}\\times${f(1 - w0, 3)}\\times(${f(m1 - m0, 3)})^2 = ${f(sB, 4)}\\) (Eq. 10.3.5). Otsu chooses the threshold that maximises this quantity.`)
      };
    }
  },
  {
    id: 'ai-otsu-best', title: 'Which threshold would Otsu choose?', lesson: 'computer-vision', difficulty: 3,
    gen(rng) {
      const c = [randInt(rng, 8, 16), randInt(rng, 10, 20), randInt(rng, 3, 8), randInt(rng, 1, 4), randInt(rng, 6, 14), randInt(rng, 8, 18)];
      const n = sum(c), p = c.map(v => v / n), res = [];
      for (let t = 0; t < 5; t++) { const w0 = sum(p.slice(0, t + 1)), m0 = sum(p.slice(0, t + 1).map((v, i) => v * i)) / w0, m1 = sum(p.slice(t + 1).map((v, i) => v * (i + t + 1))) / (1 - w0); res.push(w0 * (1 - w0) * (m0 - m1) ** 2); }
      const best = res.indexOf(Math.max(...res)), opts = res.map((_, t) => `between levels ${t} and ${t + 1}`);
      return mcq(rng, `An ExG histogram with levels 0–5 has counts ${c.join(', ')}. Between which levels does Otsu’s method put the threshold?`,
        opts[best], opts.filter((_, i) => i !== best).slice(0, 3),
        steps(`For each split compute \\(\\sigma_B^2 = \\omega_0\\omega_1(\\mu_0-\\mu_1)^2\\) (Eq. 10.3.5).`, `Values for splits after levels 0…4: ${res.map(v => f(v, 3)).join(', ')}.`, `Maximum after level ${best}: the threshold lies ${opts[best]}.`));
    }
  },
  {
    id: 'ai-conv-layer', title: 'Size and parameters of a convolution layer', lesson: 'computer-vision', difficulty: 2,
    gen(rng) {
      const N = pick(rng, [64, 96, 128, 224, 256]), K = pick(rng, [3, 5, 7]), S = pick(rng, [1, 2]), P = pick(rng, [0, (K - 1) / 2]), C = pick(rng, [3, 16, 32, 64]), F = pick(rng, [16, 32, 64, 128]);
      const out = Math.floor((N - K + 2 * P) / S) + 1, par = (K * K * C + 1) * F, askOut = rng() < 0.5;
      return {
        q: `A convolution layer with ${F} filters of size ${K} × ${K}, stride ${S} and zero padding ${P} is applied to a ${N} × ${N} × ${C} input. ${askOut ? 'What is the width of the output feature maps?' : 'How many trainable parameters (weights and biases) does it have?'}`,
        answer: askOut ? out : par, abstol: 0.5, unit: askOut ? 'px' : '',
        solution: steps(`Output width \\(\\lfloor(N-K+2P)/S\\rfloor+1 = \\lfloor(${N}-${K}+${2 * P})/${S}\\rfloor+1 = ${out}\\).`, `Parameters \\((K^2C+1)F = (${K * K}\\times${C}+1)\\times${F} = ${par}\\) (Eq. 10.3.9) — independent of the image size.`)
      };
    }
  },
  {
    id: 'ai-iou', title: 'Intersection over union of two boxes', lesson: 'computer-vision', difficulty: 2,
    gen(rng) {
      const x1 = randInt(rng, 0, 40), y1 = randInt(rng, 0, 40), w = randInt(rng, 20, 50), h = randInt(rng, 20, 50);
      const dx = randInt(rng, -15, 15), dy = randInt(rng, -15, 15), w2 = w + randInt(rng, -8, 8), h2 = h + randInt(rng, -8, 8);
      const A = [x1, y1, x1 + w, y1 + h], B = [x1 + dx, y1 + dy, x1 + dx + w2, y1 + dy + h2];
      const iw = Math.max(0, Math.min(A[2], B[2]) - Math.max(A[0], B[0])), ih = Math.max(0, Math.min(A[3], B[3]) - Math.max(A[1], B[1])), I = iw * ih, U = w * h + w2 * h2 - I;
      return {
        q: `A detector predicts a tomato at box \\((x_1, y_1, x_2, y_2) = (${B.join(', ')})\\) pixels; the annotated fruit is at \\((${A.join(', ')})\\). What is the intersection over union?`,
        answer: I / U, abstol: 0.005,
        solution: steps(`Overlap width \\(= \\min(${A[2]}, ${B[2]}) - \\max(${A[0]}, ${B[0]}) = ${iw}\\) px; height \\(= ${ih}\\) px; intersection \\(= ${I}\\) px².`,
          `Union \\(= ${w * h} + ${w2 * h2} - ${I} = ${U}\\) px².`, `IoU \\(= ${I}/${U} = ${f(I / U, 3)}\\) (Eq. 10.3.10) — ${I / U >= 0.5 ? 'a true positive under the 0.5 criterion' : 'below 0.5: counted as a false positive (and the fruit as missed)'}.`)
      };
    }
  },
  /* ======================= 10.4 control and optimisation ======================= */
  {
    id: 'ai-pid-output', title: 'Output of a PID controller', lesson: 'control-optimisation', difficulty: 1,
    gen(rng) {
      const u0 = rand(rng, 0, 40, 5), Kc = rand(rng, 2, 20, 0.5), Ti = rand(rng, 100, 600, 20), Td = rand(rng, 0, 60, 5), e = rand(rng, -3, 3, 0.1), I = rand(rng, -600, 600, 10), de = rand(rng, -0.03, 0.03, 0.001);
      const u = u0 + Kc * (e + I / Ti + Td * de);
      return {
        q: `A heating controller has \\(u_0 = ${u0}\\) %, \\(K_c = ${Kc}\\) % °C⁻¹, \\(T_i = ${Ti}\\) s and \\(T_d = ${Td}\\) s. The error is ${e} °C, its integral ${I} °C s and its rate of change ${de} °C s⁻¹. What output does the PID law give (before clipping)?`,
        answer: u, abstol: 0.2, unit: '%',
        solution: steps(`Bracket: \\(e + \\frac{1}{T_i}\\int e\\,\\mathrm dt + T_d\\,\\dot e = ${e} + ${f(I / Ti, 4)} + ${f(Td * de, 4)} = ${f(e + I / Ti + Td * de, 4)}\\) °C.`, `\\(u = ${u0} + ${Kc}\\times${f(e + I / Ti + Td * de, 4)} = ${f(u, 4)}\\) % (Eq. 10.4.4)${u > 100 || u < 0 ? ' — outside 0–100 %, so the actuator would saturate' : ''}.`)
      };
    }
  },
  {
    id: 'ai-fopdt-response', title: 'Step response of a first-order-plus-dead-time process', lesson: 'control-optimisation', difficulty: 1,
    gen(rng) {
      const K = rand(rng, 0.05, 0.25, 0.01), du = rand(rng, 10, 60, 5), tau = rand(rng, 100, 900, 10), th = rand(rng, 10, 120, 5), y0 = rand(rng, 12, 20, 0.5);
      const t = Math.round(th + rand(rng, 0.3, 2.5, 0.1) * tau), y = y0 + K * du * (1 - Math.exp(-(t - th) / tau));
      return {
        q: `A growth chamber (\\(K = ${K}\\) °C %⁻¹, \\(\\tau = ${tau}\\) s, \\(\\theta = ${th}\\) s) is at ${y0} °C when its heater is stepped up by ${du} % at \\(t = 0\\). What is the temperature at \\(t = ${t}\\) s?`,
        answer: y, tol: 0.005, unit: '°C',
        solution: steps(`Final change \\(K\\Delta u = ${f(K * du, 4)}\\) °C.`, `\\((t-\\theta)/\\tau = (${t}-${th})/${tau} = ${f((t - th) / tau, 4)}\\); fraction reached \\(1-e^{-${f((t - th) / tau, 4)}} = ${f(1 - Math.exp(-(t - th) / tau), 4)}\\).`, `\\(y = ${y0} + ${f(K * du, 4)}\\times${f(1 - Math.exp(-(t - th) / tau), 4)} = ${f(y, 4)}\\) °C (Eq. 10.4.2).`)
      };
    }
  },
  {
    id: 'ai-two-point', title: 'Time constant and dead time from a step test', lesson: 'control-optimisation', difficulty: 2,
    gen(rng) {
      const t28 = rand(rng, 40, 300, 5), t63 = t28 + rand(rng, 60, 600, 5), tau = 1.5 * (t63 - t28), th = t63 - tau, askTau = rng() < 0.5 || th < 0;
      return {
        q: `In a step test the output reached 28.3 % of its final change ${t28} s after the step and 63.2 % after ${t63} s. What is the ${askTau ? 'time constant \\(\\tau\\)' : 'dead time \\(\\theta\\)'}?`,
        answer: askTau ? tau : th, abstol: 0.5, unit: 's',
        solution: steps(`\\(t_{28} = \\theta+\\tau/3\\) and \\(t_{63} = \\theta+\\tau\\), so \\(\\tau = 1.5(t_{63}-t_{28}) = 1.5\\times${f(t63 - t28, 4)} = ${f(tau, 4)}\\) s.`, `\\(\\theta = t_{63}-\\tau = ${t63}-${f(tau, 4)} = ${f(th, 4)}\\) s (Eq. 10.4.2)${th < 0 ? ' — a negative value means the data do not fit an FOPDT shape' : ''}.`)
      };
    }
  },
  {
    id: 'ai-simc', title: 'SIMC tuning of a PI controller', lesson: 'control-optimisation', difficulty: 2,
    gen(rng) {
      const K = rand(rng, 0.05, 0.3, 0.01), tau = rand(rng, 100, 1500, 10), th = rand(rng, 10, 200, 5), tc = pick(rng, [th, 2 * th]);
      const Kc = tau / (K * (tc + th)), Ti = Math.min(tau, 4 * (tc + th)), askKc = rng() < 0.6;
      return {
        q: `A process has \\(K = ${K}\\) °C %⁻¹, \\(\\tau = ${tau}\\) s and \\(\\theta = ${th}\\) s. Using the SIMC rules with \\(\\tau_c = ${tc}\\) s, what is the PI ${askKc ? 'gain \\(K_c\\)' : 'integral time \\(T_i\\)'}?`,
        answer: askKc ? Kc : Ti, tol: 0.01, unit: askKc ? '% °C⁻¹' : 's',
        solution: steps(`\\(K_c = \\tau/[K(\\tau_c+\\theta)] = ${tau}/[${K}\\times${tc + th}] = ${f(Kc, 4)}\\) % °C⁻¹.`, `\\(T_i = \\min\\{\\tau, 4(\\tau_c+\\theta)\\} = \\min\\{${tau}, ${4 * (tc + th)}\\} = ${f(Ti, 4)}\\) s (Eq. 10.4.6).`)
      };
    }
  },
  {
    id: 'ai-onoff-period', title: 'Cycle period of an on/off thermostat', lesson: 'control-optimisation', difficulty: 3,
    gen(rng) {
      const tau = rand(rng, 100, 900, 10), r = rand(rng, 18, 24, 0.5), h = rand(rng, 0.25, 1.5, 0.25), To = rand(rng, 4, r - 4, 0.5), Tinf = rand(rng, r + 4, r + 15, 0.5);
      const ton = tau * Math.log((Tinf - (r - h)) / (Tinf - (r + h))), toff = tau * Math.log((r + h - To) / (r - h - To));
      return {
        q: `A heater with a thermostat band of ±${h} °C keeps a chamber at ${r} °C. The chamber is first-order with \\(\\tau = ${tau}\\) s; with the heater off it would settle at ${To} °C, with it permanently on at ${Tinf} °C. Neglecting dead time, what is the cycle period?`,
        answer: ton + toff, tol: 0.02, unit: 's',
        solution: steps(`\\(t_{\\text{on}} = \\tau\\ln\\dfrac{T_\\infty-(r-h)}{T_\\infty-(r+h)} = ${tau}\\ln\\dfrac{${f(Tinf - (r - h), 4)}}{${f(Tinf - (r + h), 4)}} = ${f(ton, 4)}\\) s.`,
          `\\(t_{\\text{off}} = \\tau\\ln\\dfrac{(r+h)-T_o}{(r-h)-T_o} = ${tau}\\ln\\dfrac{${f(r + h - To, 4)}}{${f(r - h - To, 4)}} = ${f(toff, 4)}\\) s.`, `Period \\(= ${f(ton + toff, 4)}\\) s (Eq. 10.4.3); duty cycle ≈ ${f(ton / (ton + toff) * 100, 3)} %.`)
      };
    }
  },
  {
    id: 'ai-temp-integration', title: 'Night temperature for temperature integration', lesson: 'control-optimisation', difficulty: 2,
    gen(rng) {
      const Tt = rand(rng, 16, 22, 0.5), nd = rand(rng, 10, 18, 1), Td = rand(rng, Tt + 1, Tt + 5, 0.5), Tn = (24 * Tt - nd * Td) / (24 - nd);
      return {
        q: `A grower targets a 24-hour mean of ${Tt} °C. The ${nd}-hour day averaged ${Td} °C thanks to the sun. What mean night temperature keeps the daily mean on target?`,
        answer: Tn, abstol: 0.05, unit: '°C',
        solution: steps(`\\(\\bar T_{\\text{night}} = (24\\bar T_{\\text{target}} - n_d\\bar T_{\\text{day}})/(24-n_d)\\) (Eq. 10.4.7).`, `\\(= (24\\times${Tt} - ${nd}\\times${Td})/${24 - nd} = ${f(24 * Tt - nd * Td, 4)}/${24 - nd} = ${f(Tn, 4)}\\) °C.`)
      };
    }
  },
  {
    id: 'ai-qlearning', title: 'One Q-learning update', lesson: 'control-optimisation', difficulty: 2,
    gen(rng) {
      const Q = rand(rng, -6, -0.5, 0.1), r = rand(rng, -3, 0.5, 0.1), g = pick(rng, [0.9, 0.95, 0.97, 0.99]), m = rand(rng, -6, -0.5, 0.1), a = pick(rng, [0.05, 0.1, 0.2, 0.3]);
      const d = r + g * m - Q, Qn = Q + a * d;
      return {
        q: `An agent has \\(Q(s,a) = ${Q}\\). It takes action \\(a\\), receives reward ${r} and reaches \\(s'\\) where \\(\\max_{a'}Q(s',a') = ${m}\\). With \\(\\gamma = ${g}\\) and \\(\\alpha = ${a}\\), what is the updated \\(Q(s,a)\\)?`,
        answer: Qn, abstol: 0.005,
        solution: steps(`Temporal-difference error \\(\\delta = r + \\gamma\\max Q(s',\\cdot) - Q(s,a) = ${r} + ${g}\\times(${m}) - (${Q}) = ${f(d, 4)}\\).`, `\\(Q \\leftarrow Q + \\alpha\\delta = ${Q} + ${a}\\times${f(d, 4)} = ${f(Qn, 4)}\\) (Eq. 10.4.10).`)
      };
    }
  },
  /* ======================= 10.5 digital twins and responsible AI ======================= */
  {
    id: 'ai-kalman-gain', title: 'Kalman gain after a prediction step', lesson: 'digital-twins', difficulty: 1,
    gen(rng) {
      const P = rand(rng, 0.001, 0.05, 0.001), q = rand(rng, 0.0001, 0.01, 0.0001), R = rand(rng, 0.001, 0.05, 0.001), Pm = P + q, K = Pm / (Pm + R);
      return {
        q: `A scalar Kalman filter (random-walk model, \\(a = 1\\)) has variance \\(P = ${P}\\) after its last update. The process variance is \\(q = ${q}\\) per step and the measurement variance \\(R = ${R}\\). What is the Kalman gain at the next update?`,
        answer: K, abstol: 0.005,
        solution: steps(`Predict: \\(P^- = P + q = ${f(Pm, 4)}\\) (Eq. 10.5.2).`, `Gain: \\(K = P^-/(P^-+R) = ${f(Pm, 4)}/${f(Pm + R, 4)} = ${f(K, 4)}\\) (Eq. 10.5.3).`)
      };
    }
  },
  {
    id: 'ai-kalman-cycle', title: 'A full predict–update cycle of a lettuce twin', lesson: 'digital-twins', difficulty: 3,
    gen(rng) {
      const A0 = rand(rng, 20, 200, 1), rho = rand(rng, 0.1, 0.3, 0.01), sd0 = rand(rng, 0.03, 0.1, 0.01), sq = rand(rng, 0.01, 0.04, 0.01), sr = rand(rng, 0.05, 0.15, 0.01);
      const l0 = Math.log(A0), lm = l0 + rho, Am = Math.exp(lm), z = Math.round(Am * (1 + rand(rng, -0.12, 0.12, 0.01)));
      const Pm = sd0 * sd0 + sq * sq, R = sr * sr, K = Pm / (Pm + R), l = lm + K * (Math.log(z) - lm), A = Math.exp(l);
      return {
        q: `A lettuce twin tracks \\(\\ell = \\ln A\\). Yesterday's estimate was \\(A = ${A0}\\) cm² with SD ${sd0} on the log scale; the model assumes RGR = ${rho} d⁻¹, process-noise SD ${sq} and image-noise SD ${sr} (both on the log scale). Today's image gives ${z} cm². What is the twin's updated leaf-area estimate?`,
        answer: A, tol: 0.01, unit: 'cm²',
        solution: steps(`Predict: \\(\\hat\\ell^- = \\ln ${A0} + ${rho} = ${f(lm, 5)}\\) (${f(Am, 4)} cm²); \\(P^- = ${sd0}^2 + ${sq}^2 = ${f(Pm, 4)}\\).`,
          `Gain: \\(K = P^-/(P^-+R) = ${f(Pm, 4)}/(${f(Pm, 4)} + ${f(R, 4)}) = ${f(K, 4)}\\).`,
          `Update: \\(z = \\ln ${z} = ${f(Math.log(z), 5)}\\); \\(\\hat\\ell = ${f(lm, 5)} + ${f(K, 4)}\\times(${f(Math.log(z) - lm, 4)}) = ${f(l, 5)}\\) → \\(A = e^{\\hat\\ell} = ${f(A, 4)}\\) cm².`)
      };
    }
  },
  {
    id: 'ai-ess', title: 'Effective sample size of a particle filter', lesson: 'digital-twins', difficulty: 2,
    gen(rng) {
      const raw = [0, 1, 2, 3, 4].map(() => rand(rng, 0.1, 5, 0.1)), s = sum(raw), w = raw.map(v => v / s), ess = 1 / sum(w.map(v => v * v));
      return {
        q: `Five particles have unnormalised weights ${raw.join(', ')}. What is the effective sample size \\(N_{\\text{eff}}\\)?`,
        answer: ess, tol: 0.01,
        solution: steps(`Normalise by the sum ${f(s, 4)}: \\(w\\) = ${w.map(v => f(v, 3)).join(', ')}.`, `\\(\\sum w_i^2 = ${f(sum(w.map(v => v * v)), 4)}\\); \\(N_{\\text{eff}} = 1/\\sum w_i^2 = ${f(ess, 4)}\\) of 5 (Eq. 10.5.4)${ess < 2.5 ? ' — below N/2: resample' : ''}.`)
      };
    }
  },
  {
    id: 'ai-shapley', title: 'Shapley values for a model with an interaction', lesson: 'digital-twins', difficulty: 3,
    gen(rng) {
      const b0 = rand(rng, 1, 5, 0.5), b1 = rand(rng, -2, 4, 0.5), b2 = rand(rng, -2, 4, 0.5), b12 = rand(rng, -2, 2, 0.5), x1 = rand(rng, -2, 2, 0.5), x2 = rand(rng, -2, 2, 0.5);
      const fn = (a, b) => b0 + b1 * a + b2 * b + b12 * a * b, phi1 = 0.5 * ((fn(x1, 0) - fn(0, 0)) + (fn(x1, x2) - fn(0, x2))), phi2 = fn(x1, x2) - fn(0, 0) - phi1;
      const ask1 = rng() < 0.5;
      return {
        q: `A model predicts growth as \\(f = ${b0} + ${b1}x_1 + ${b2}x_2 + ${b12}x_1x_2\\) (g d⁻¹) with standardised features and baseline \\((0, 0)\\). What is the Shapley value of \\(x_${ask1 ? 1 : 2}\\) for the instance \\(x = (${x1}, ${x2})\\)?`,
        answer: ask1 ? phi1 : phi2, abstol: 0.01, unit: 'g d⁻¹',
        solution: steps(`\\(f(0,0) = ${f(fn(0, 0), 4)}\\), \\(f(x_1,0) = ${f(fn(x1, 0), 4)}\\), \\(f(0,x_2) = ${f(fn(0, x2), 4)}\\), \\(f(x_1,x_2) = ${f(fn(x1, x2), 4)}\\).`,
          `\\(\\phi_1 = \\tfrac12[(f(x_1,0)-f(0,0)) + (f(x_1,x_2)-f(0,x_2))] = ${f(phi1, 4)}\\); \\(\\phi_2 = \\tfrac12[(f(0,x_2)-f(0,0)) + (f(x_1,x_2)-f(x_1,0))] = ${f(phi2, 4)}\\) (Eq. 10.5.6).`,
          `Check: \\(\\phi_1+\\phi_2 = ${f(phi1 + phi2, 4)} = f(x)-f(0) \\) ✓ — the interaction \\(${b12}x_1x_2\\) is shared equally.`)
      };
    }
  },
  {
    id: 'ai-energy', title: 'Energy and emissions of an AI system', lesson: 'digital-twins', difficulty: 1,
    gen(rng) {
      const n = randInt(rng, 2, 30), P = rand(rng, 5, 40, 1), grid = pick(rng, [['the Swedish production mix', 0.035], ['the Nordic mix', 0.1], ['the EU-27 average', 0.211], ['the world average', 0.471]]);
      const E = n * P * 8760 / 1000, m = E * grid[1];
      return {
        q: `A greenhouse runs ${n} always-on edge computers of ${P} W each for camera analysis. What are their annual emissions on ${grid[0]} (${grid[1] * 1000} g CO₂e kWh⁻¹)?`,
        answer: m, tol: 0.02, unit: 'kg CO₂e',
        solution: steps(`\\(E = nP\\,t/1000 = ${n}\\times${P}\\times8760/1000 = ${f(E, 4)}\\) kWh (PUE ≈ 1 on the farm; Eq. 10.5.8).`, `\\(m = E\\cdot\\text{CI} = ${f(E, 4)}\\times${grid[1]} = ${f(m, 4)}\\) kg CO₂e.`)
      };
    }
  },
  {
    id: 'ai-act-category', title: 'Classify an agricultural AI system under the AI Act', lesson: 'digital-twins', difficulty: 1,
    gen(rng) {
      const cases = [
        ['an AI system that ranks applicants for seasonal harvest jobs', 'high risk (Annex III: employment)'],
        ['a camera system that infers the emotions of packing-house workers to monitor them', 'prohibited practice'],
        ['a reinforcement-learning controller for greenhouse heating and ventilation', 'minimal risk'],
        ['an LLM chatbot that answers farmers’ agronomic questions', 'transparency obligations (users must be told they are talking to AI)'],
        ['AI that scores the creditworthiness of farmers applying for loans', 'high risk (Annex III: access to essential services)'],
        ['a smartphone app that recognises leaf diseases', 'minimal risk']
      ];
      const [c, ans] = pick(rng, cases), all = ['prohibited practice', 'high risk (Annex III: employment)', 'high risk (Annex III: access to essential services)', 'transparency obligations (users must be told they are talking to AI)', 'minimal risk'];
      const wrong = all.filter(x => x !== ans && !(ans.startsWith('high') && x.startsWith('high'))).slice(0, 3);
      return mcq(rng, `Under the EU AI Act (Regulation (EU) 2024/1689, as amended in 2026), how is ${c} classified?`, ans, wrong,
        steps(`The AI Act classifies systems by their use, not their technology (Lesson 10.5, Section 10.5.8).`, `Answer: <b>${ans}</b>. Prohibitions apply since 2 February 2025; transparency duties from 2 August 2026; stand-alone high-risk obligations from 2 December 2027.`));
    }
  }
];
