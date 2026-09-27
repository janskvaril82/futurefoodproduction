/* ==========================================================================
   Practice generators — Module 11: Precision agriculture and remote sensing
   Lessons: precision-farming (11.1), remote-sensing (11.2), precision-irrigation (11.3),
            agricultural-robotics (11.4), agrivoltaics (11.5)
   Every generator returns a fresh, randomised, auto-marked problem.
   ET₀ uses et0PenmanMonteith() etc. from /assets/js/physics.js (FAO-56, Allen et al. 1998)
   so that lessons, laboratories and practice agree.
   ========================================================================== */
import { rand, randInt, pick, f, steps, mcq } from './helpers.js';
import { svp, svpSlope, psychroConst, et0PenmanMonteith } from '../physics.js';

const nd = (a, b) => (a - b) / (a + b);

export default [
  /* ======================= 11.1 Principles of precision farming ======================= */
  {
    id: 'pa-overlap-saving', title: 'Product saved by GNSS guidance (overlap)', lesson: 'precision-farming', difficulty: 1,
    gen(rng) {
      const w = pick(rng, [12, 18, 24, 28, 36]), om = rand(rng, 0.6, 2.0, 0.1), og = rand(rng, 0.02, 0.10, 0.01);
      const eM = om / (w - om), eG = og / (w - og), save = 100 * (1 - (1 + eG) / (1 + eM));
      return {
        q: `A ${w} m sprayer is driven by eye with a mean overlap of ${om} m between passes. With RTK auto-steer the mean overlap falls to ${og} m. By what percentage does guidance reduce the amount of product applied?`,
        answer: save, tol: 0.03, unit: '%',
        solution: steps(
          `Excess application: \\(E = o/(w-o)\\). Manual: \\(${om}/(${w}-${om}) = ${f(eM, 4)}\\); guided: \\(${og}/(${w}-${og}) = ${f(eG, 4)}\\).`,
          `Saving \\(= 1-(1+E_{\\text{guid}})/(1+E_{\\text{man}}) = 1-${f(1 + eG, 5)}/${f(1 + eM, 5)} = ${f(save / 100, 4)}\\) → ${f(save, 3)} %.`)
      };
    }
  },
  {
    id: 'pa-yield-moisture', title: 'Yield from grain mass flow, corrected to standard moisture', lesson: 'precision-farming', difficulty: 2,
    gen(rng) {
      const q = rand(rng, 4, 14, 0.1), vk = rand(rng, 3.6, 7.2, 0.1), w = pick(rng, [6, 7.5, 9, 10.5, 12]), M = rand(rng, 15, 24, 0.5), Ms = 14;
      const v = vk / 3.6, Yw = 10 * q / (v * w), Ys = Yw * (1 - M / 100) / (1 - Ms / 100);
      return {
        q: `A combine with a ${w} m header drives at ${vk} km h⁻¹ and measures a grain mass flow of ${q} kg s⁻¹ at ${M} % moisture. What is the yield at the standard moisture of 14 %?`,
        answer: Ys, tol: 0.02, unit: 't ha⁻¹',
        solution: steps(
          `Speed: \\(${vk}/3.6 = ${f(v, 4)}\\) m s⁻¹.`,
          `Wet yield: \\(Y = 10\\,q/(v\\,w) = 10\\times${q}/(${f(v, 4)}\\times${w}) = ${f(Yw, 4)}\\) t ha⁻¹.`,
          `Dry matter is conserved: \\(Y_{14} = Y\\,(1-M)/(1-0.14) = ${f(Yw, 4)}\\times${f(1 - M / 100, 3)}/0.86 = ${f(Ys, 4)}\\) t ha⁻¹.`)
      };
    }
  },
  {
    id: 'pa-idw-estimate', title: 'Inverse-distance weighting from three soil samples', lesson: 'precision-farming', difficulty: 2,
    gen(rng) {
      const z = [rand(rng, 5.2, 7.2, 0.1), rand(rng, 5.2, 7.2, 0.1), rand(rng, 5.2, 7.2, 0.1)], d = [randInt(rng, 8, 25), randInt(rng, 26, 45), randInt(rng, 46, 80)], p = pick(rng, [1, 2]);
      const wts = d.map(x => Math.pow(x, -p)), S = wts.reduce((a, b) => a + b, 0), est = wts.reduce((a, wv, i) => a + wv * z[i], 0) / S;
      return {
        q: `Three soil samples surround an unsampled point: pH ${z[0]} at ${d[0]} m, pH ${z[1]} at ${d[1]} m and pH ${z[2]} at ${d[2]} m. Estimate the pH at the point by inverse-distance weighting with power p = ${p}.`,
        answer: est, abstol: 0.02, unit: '',
        solution: steps(
          `Raw weights \\(d^{-${p}}\\): ${wts.map(x => f(x, 4)).join(', ')}; sum ${f(S, 4)}.`,
          `Normalised weights: ${wts.map(x => f(x / S, 4)).join(', ')} (they add up to 1).`,
          `Estimate \\(\\hat z = \\sum\\lambda_i z_i = ${f(est, 4)}\\).`)
      };
    }
  },
  {
    id: 'pa-vra-zone', title: 'Compensating variable-rate nitrogen for a zone', lesson: 'precision-farming', difficulty: 2,
    gen(rng) {
      const N = pick(rng, [40, 50, 60, 70, 80]), Vb = rand(rng, 0.55, 0.75, 0.01), V = rand(rng, Vb - 0.12, Vb + 0.12, 0.01), beta = pick(rng, [0.5, 1, 1.5]);
      const Ni = N * (1 - beta * (V - Vb) / Vb);
      return {
        q: `The planned mean supplementary N rate is ${N} kg N ha⁻¹ and the field's area-weighted mean vegetation index is ${Vb}. Using the compensating rule \\(N_i = \\bar N[1-\\beta(V_i-\\bar V)/\\bar V]\\) with β = ${beta}, what rate does a zone with index ${f(V, 3)} receive?`,
        answer: Ni, tol: 0.02, unit: 'kg N ha⁻¹',
        solution: steps(`Relative deviation: \\((${f(V, 3)}-${Vb})/${Vb} = ${f((V - Vb) / Vb, 4)}\\).`, `\\(N_i = ${N}\\times[1-${beta}\\times${f((V - Vb) / Vb, 4)}] = ${f(Ni, 4)}\\) kg N ha⁻¹.`)
      };
    }
  },

  /* ======================= 11.2 Remote sensing and vegetation indices ======================= */
  {
    id: 'rs-ndvi', title: 'NDVI from red and NIR reflectance', lesson: 'remote-sensing', difficulty: 1,
    gen(rng) {
      const red = rand(rng, 0.02, 0.15, 0.005), nir = rand(rng, 0.20, 0.55, 0.005), v = nd(nir, red);
      return {
        q: `A Sentinel-2 pixel has surface reflectance ${red} in band B4 (red) and ${nir} in band B8 (NIR). Calculate its NDVI.`,
        answer: v, abstol: 0.005, unit: '',
        solution: steps(`\\(\\text{NDVI} = (\\rho_{\\text{NIR}}-\\rho_{\\text{red}})/(\\rho_{\\text{NIR}}+\\rho_{\\text{red}}) = (${nir}-${red})/(${nir}+${red}) = ${f(nir - red, 4)}/${f(nir + red, 4)} = ${f(v, 4)}\\).`)
      };
    }
  },
  {
    id: 'rs-savi-evi', title: 'SAVI or EVI from band reflectances', lesson: 'remote-sensing', difficulty: 2,
    gen(rng) {
      const red = rand(rng, 0.03, 0.12, 0.005), nir = rand(rng, 0.25, 0.50, 0.005), blue = rand(rng, 0.03, 0.08, 0.005);
      if (rng() < 0.5) {
        const L = 0.5, v = (1 + L) * (nir - red) / (nir + red + L);
        return { q: `Calculate SAVI (L = 0.5) for red reflectance ${red} and NIR reflectance ${nir}.`, answer: v, abstol: 0.005, unit: '',
          solution: steps(`\\(\\text{SAVI} = (1+L)(\\rho_N-\\rho_R)/(\\rho_N+\\rho_R+L) = 1.5\\times${f(nir - red, 4)}/(${f(nir + red, 4)}+0.5) = ${f(v, 4)}\\).`) };
      }
      const den = nir + 6 * red - 7.5 * blue + 1, v = 2.5 * (nir - red) / den;
      return { q: `Calculate EVI (G = 2.5, C₁ = 6, C₂ = 7.5, L = 1) for blue ${blue}, red ${red} and NIR ${nir}.`, answer: v, abstol: 0.005, unit: '',
        solution: steps(`Denominator: \\(${nir}+6\\times${red}-7.5\\times${blue}+1 = ${f(den, 4)}\\).`, `\\(\\text{EVI} = 2.5\\times${f(nir - red, 4)}/${f(den, 4)} = ${f(v, 4)}\\).`) };
    }
  },
  {
    id: 'rs-nd-family', title: 'NDRE, GNDVI or NDWI from Sentinel-2 bands', lesson: 'remote-sensing', difficulty: 1,
    gen(rng) {
      const which = pick(rng, ['NDRE', 'GNDVI', 'NDWI']);
      const nir = rand(rng, 0.25, 0.50, 0.005);
      const other = which === 'NDRE' ? rand(rng, 0.08, 0.18, 0.005) : which === 'GNDVI' ? rand(rng, 0.05, 0.14, 0.005) : rand(rng, 0.18, 0.32, 0.005);
      const band = { NDRE: 'B5 (red edge, 705 nm)', GNDVI: 'B3 (green, 560 nm)', NDWI: 'B11 (SWIR, 1610 nm)' }[which];
      const v = nd(nir, other);
      return {
        q: `Using Sentinel-2 NIR reflectance ${nir} and ${band} reflectance ${other}, calculate the ${which}${which === 'NDWI' ? ' (Gao form)' : ''}.`,
        answer: v, abstol: 0.005, unit: '',
        solution: steps(`All three indices are normalised differences with NIR first: \\((${nir}-${other})/(${nir}+${other}) = ${f(v, 4)}\\).`,
          which === 'NDRE' ? 'NDRE tracks canopy chlorophyll (nitrogen) and saturates later than NDVI.' : which === 'GNDVI' ? 'GNDVI is sensitive to chlorophyll concentration.' : 'Gao’s NDWI indicates canopy liquid water; McFeeters’ NDWI (green, NIR) maps open water instead.')
      };
    }
  },
  {
    id: 'rs-gsd', title: 'Ground sampling distance of a drone camera', lesson: 'remote-sensing', difficulty: 1,
    gen(rng) {
      const H = randInt(rng, 30, 120), p = pick(rng, [2.4, 3.1, 3.45, 3.75, 4.8]), fl = pick(rng, [4.5, 5.4, 8.0, 8.8, 12]);
      if (rng() < 0.5) {
        const g = 0.1 * H * p / fl;
        return { q: `A multispectral camera with ${fl} mm focal length and ${p} µm pixels is flown at ${H} m above the ground. What is the ground sampling distance?`, answer: g, tol: 0.02, unit: 'cm',
          solution: steps(`\\(\\text{GSD} = Hp/f = ${H}\\times${p}\\times10^{-6}/${fl}\\times10^{-3} = ${f(g / 100, 4)}\\) m = ${f(g, 4)} cm.`) };
      }
      const target = rand(rng, 2, 8, 0.5), Hn = target * fl / (0.1 * p);
      return { q: `At what flying height must a camera with ${fl} mm focal length and ${p} µm pixels fly to obtain a GSD of ${target} cm? (Check whether this is within the 120 m open-category limit.)`, answer: Hn, tol: 0.02, unit: 'm',
        solution: steps(`\\(H = \\text{GSD}\\,f/p = ${target / 100}\\times${fl}\\times10^{-3}/(${p}\\times10^{-6}) = ${f(Hn, 4)}\\) m.`, Hn <= 120 ? 'This is below 120 m, so it is allowed in the EU open category.' : 'This exceeds 120 m: not allowed in the EU open category — choose a longer lens or accept a finer GSD.') };
    }
  },
  {
    id: 'rs-mixed-pixel', title: 'NDVI of a mixed crop–soil pixel', lesson: 'remote-sensing', difficulty: 3,
    gen(rng) {
      const fv = rand(rng, 0.2, 0.8, 0.05), rv = rand(rng, 0.025, 0.045, 0.001), nv = rand(rng, 0.38, 0.50, 0.005), rs = rand(rng, 0.12, 0.20, 0.005), ns = rand(rng, 0.16, 0.26, 0.005);
      const R = fv * rv + (1 - fv) * rs, N = fv * nv + (1 - fv) * ns, v = nd(N, R);
      return {
        q: `A 10 m pixel is ${f(fv * 100, 3)} % crop (red ${rv}, NIR ${nv}) and ${f(100 - fv * 100, 3)} % bare soil (red ${rs}, NIR ${ns}). Assuming linear spectral mixing, what is the pixel's NDVI?`,
        answer: v, abstol: 0.005, unit: '',
        solution: steps(`Mix the reflectances first: red \\(= ${fv}\\times${rv}+${f(1 - fv, 3)}\\times${rs} = ${f(R, 4)}\\); NIR \\(= ${fv}\\times${nv}+${f(1 - fv, 3)}\\times${ns} = ${f(N, 4)}\\).`,
          `NDVI \\(= (${f(N, 4)}-${f(R, 4)})/(${f(N, 4)}+${f(R, 4)}) = ${f(v, 4)}\\).`,
          `Compare the area-weighted mean of the component NDVIs, ${f(fv * nd(nv, rv) + (1 - fv) * nd(ns, rs), 4)}: NDVI does not mix linearly.`)
      };
    }
  },
  {
    id: 'rs-cloud-probability', title: 'Chance of at least one cloud-free image', lesson: 'remote-sensing', difficulty: 2,
    gen(rng) {
      const T = pick(rng, [10, 14, 15, 20, 21]), dt = pick(rng, [2, 3, 5]), pc = rand(rng, 0.15, 0.5, 0.05), n = Math.floor(T / dt), P = 100 * (1 - Math.pow(1 - pc, n));
      return {
        q: `A nitrogen decision must be made within ${T} days. The satellite revisits the field every ${dt} days, and each acquisition is cloud-free with probability ${pc} (assume independence). What is the probability of obtaining at least one usable image?`,
        answer: P, tol: 0.02, unit: '%',
        solution: steps(`Acquisitions: \\(n = \\lfloor ${T}/${dt}\\rfloor = ${n}\\).`, `\\(P = 1-(1-${pc})^{${n}} = 1-${f(Math.pow(1 - pc, n), 4)} = ${f(P / 100, 4)}\\) → ${f(P, 3)} %.`, 'Real cloud cover is autocorrelated, so the true chance is lower.')
      };
    }
  },
  {
    id: 'rs-cwsi', title: 'Crop water stress index from thermal data', lesson: 'remote-sensing', difficulty: 1,
    gen(rng) {
      const Tw = rand(rng, 18, 26, 0.1), Td = +(Tw + rand(rng, 5, 10, 0.1)).toFixed(1), Tc = +(Tw + rand(rng, 0.5, Td - Tw - 0.5, 0.1)).toFixed(1), c = (Tc - Tw) / (Td - Tw);
      return {
        q: `In a thermal image the sunlit canopy is ${Tc} °C, a wet reference surface ${Tw} °C and a dry (non-transpiring) reference ${Td} °C. Calculate the CWSI.`,
        answer: c, abstol: 0.01, unit: '',
        solution: steps(`\\(\\text{CWSI} = (T_c-T_{\\text{wet}})/(T_{\\text{dry}}-T_{\\text{wet}}) = (${Tc}-${Tw})/(${Td}-${Tw}) = ${f(c, 3)}\\).`, `Transpiration is roughly \\(1-\\text{CWSI} = ${f(1 - c, 3)}\\) of its potential rate.`)
      };
    }
  },
  {
    id: 'rs-index-choice', title: 'Choosing a vegetation index', lesson: 'remote-sensing', difficulty: 1,
    gen(rng) {
      const cases = [
        ['a dense winter-wheat canopy (LAI ≈ 5) in June, to map nitrogen status', 'NDRE (red edge)', ['NDVI', 'McFeeters NDWI', 'SAVI with L = 1']],
        ['a sparse spring cereal just after emergence on bright, dry soil', 'SAVI (or MSAVI2)', ['NDVI', 'NDRE', 'Gao NDWI']],
        ['canopy water content during a drought', 'Gao NDWI (NIR, SWIR)', ['GNDVI', 'NDRE', 'McFeeters NDWI']],
        ['mapping flooded parts of a field after heavy rain', 'McFeeters NDWI (green, NIR)', ['Gao NDWI', 'NDRE', 'EVI']]
      ];
      const [sit, ok, wrong] = pick(rng, cases);
      return mcq(rng, `Which index is the best first choice for ${sit}?`, ok, wrong, `<p>NDVI saturates in dense canopies (use red-edge indices), is soil-sensitive in sparse ones (use SAVI/MSAVI2); Gao's NDWI measures vegetation water, McFeeters' NDWI maps open water.</p>`);
    }
  },

  /* ======================= 11.3 Precision irrigation and nutrient management ======================= */
  {
    id: 'pi-et0', title: 'FAO-56 Penman–Monteith reference evapotranspiration', lesson: 'precision-irrigation', difficulty: 3,
    gen(rng) {
      const T = rand(rng, 10, 24, 0.5), RH = randInt(rng, 55, 85), u2 = rand(rng, 1, 4, 0.1), Rn = rand(rng, 6, 15, 0.5), P = 101.3;
      const es = svp(T), ea = es * RH / 100, D = svpSlope(T), g = psychroConst(P), et = et0PenmanMonteith({ T, Rn, G: 0, u2, es, ea, P });
      return {
        q: `Calculate ET₀ with the FAO-56 Penman–Monteith equation for a day with mean temperature ${T} °C, relative humidity ${RH} %, wind speed ${u2} m s⁻¹ at 2 m, net radiation ${Rn} MJ m⁻² d⁻¹, G = 0 and P = 101.3 kPa.`,
        answer: et, tol: 0.03, unit: 'mm d⁻¹',
        solution: steps(
          `\\(e_s = 0.6108\\exp[17.27T/(T+237.3)] = ${f(es, 4)}\\) kPa; \\(e_a = ${f(ea, 4)}\\) kPa; VPD = ${f(es - ea, 4)} kPa.`,
          `\\(\\Delta = 4098e_s/(T+237.3)^2 = ${f(D, 4)}\\); \\(\\gamma = 0.000665P = ${f(g, 4)}\\) kPa °C⁻¹.`,
          `Numerator: \\(0.408\\times${f(D, 4)}\\times${Rn} + ${f(g, 4)}\\times\\frac{900}{${T}+273}\\times${u2}\\times${f(es - ea, 4)} = ${f(0.408 * D * Rn, 4)}+${f(g * 900 / (T + 273) * u2 * (es - ea), 4)}\\).`,
          `Denominator: \\(${f(D, 4)}+${f(g, 4)}(1+0.34\\times${u2}) = ${f(D + g * (1 + 0.34 * u2), 4)}\\). ET₀ = ${f(et, 4)} mm d⁻¹.`)
      };
    }
  },
  {
    id: 'pi-kc-etc', title: 'Crop coefficient and crop evapotranspiration', lesson: 'precision-irrigation', difficulty: 2,
    gen(rng) {
      const crop = pick(rng, [{ n: 'potatoes', L: [30, 35, 50, 30], K: [0.5, 1.15, 0.75] }, { n: 'sugar beet', L: [50, 40, 50, 40], K: [0.35, 1.20, 0.70] }, { n: 'spring barley', L: [20, 25, 60, 30], K: [0.3, 1.15, 0.25] }]);
      const [a, b, c] = crop.L, day = randInt(rng, a + 2, a + b - 2), et0 = rand(rng, 2.5, 5, 0.1), kc = crop.K[0] + (crop.K[1] - crop.K[0]) * (day - a) / b, etc = kc * et0;
      return {
        q: `For ${crop.n} the FAO-56 stages are ${crop.L.join(', ')} days, with K<sub>c ini</sub> = ${crop.K[0]} and K<sub>c mid</sub> = ${crop.K[1]}. On day ${day} after planting ET₀ is ${et0} mm d⁻¹. Calculate ETc.`,
        answer: etc, tol: 0.02, unit: 'mm d⁻¹',
        solution: steps(`Day ${day} is in the development stage (days ${a}–${a + b}).`, `\\(K_c = ${crop.K[0]} + \\frac{${day}-${a}}{${b}}(${crop.K[1]}-${crop.K[0]}) = ${f(kc, 4)}\\).`, `\\(ET_c = K_c ET_0 = ${f(kc, 4)}\\times${et0} = ${f(etc, 4)}\\) mm d⁻¹.`)
      };
    }
  },
  {
    id: 'pi-taw-raw', title: 'Total and readily available water', lesson: 'precision-irrigation', difficulty: 1,
    gen(rng) {
      const fc = rand(rng, 0.14, 0.36, 0.01), wp = +(fc - rand(rng, 0.07, 0.17, 0.01)).toFixed(2), Zr = rand(rng, 0.4, 1.2, 0.05), p = pick(rng, [0.35, 0.45, 0.55]);
      const TAW = 1000 * (fc - wp) * Zr, RAW = p * TAW;
      return {
        q: `A soil has θ<sub>FC</sub> = ${fc} and θ<sub>WP</sub> = ${wp} m³ m⁻³. The crop roots to ${Zr} m and its depletion fraction is p = ${p}. How much readily available water (RAW) does the root zone hold?`,
        answer: RAW, tol: 0.02, unit: 'mm',
        solution: steps(`\\(\\text{TAW} = 1000(\\theta_{FC}-\\theta_{WP})Z_r = 1000\\times${f(fc - wp, 3)}\\times${Zr} = ${f(TAW, 4)}\\) mm.`, `\\(\\text{RAW} = p\\,\\text{TAW} = ${p}\\times${f(TAW, 4)} = ${f(RAW, 4)}\\) mm.`)
      };
    }
  },
  {
    id: 'pi-depletion-step', title: 'One day of the root-zone water balance', lesson: 'precision-irrigation', difficulty: 2,
    gen(rng) {
      const TAW = randInt(rng, 40, 120), p = pick(rng, [0.4, 0.5, 0.55]), RAW = p * TAW, D0 = rand(rng, 0.2 * TAW, 0.9 * TAW, 0.5), etc = rand(rng, 2, 5.5, 0.1), P = pick(rng, [0, 0, 4, 12, 25]);
      const ks = D0 <= RAW ? 1 : (TAW - D0) / (TAW - RAW), eta = ks * etc; let D1 = D0 - P + eta, DP = 0; if (D1 < 0) { DP = -D1; D1 = 0; }
      return {
        q: `TAW = ${TAW} mm and p = ${p}. At the start of the day the root-zone depletion is ${D0} mm. Unstressed crop ET is ${etc} mm and rain is ${P} mm (no runoff, no irrigation). What is the depletion at the end of the day?`,
        answer: D1, abstol: 0.15, unit: 'mm',
        solution: steps(`RAW = ${p}×${TAW} = ${f(RAW, 4)} mm. ${D0 <= RAW ? `Since D<sub>r</sub> ≤ RAW, K<sub>s</sub> = 1.` : `Since D<sub>r</sub> > RAW, \\(K_s = (${TAW}-${D0})/(${TAW}-${f(RAW, 4)}) = ${f(ks, 4)}\\).`}`,
          `Actual ET = ${f(ks, 4)}×${etc} = ${f(eta, 4)} mm.`, `\\(D_r = ${D0}-${P}+${f(eta, 4)} = ${f(D0 - P + eta, 4)}\\)${DP > 0 ? ` → negative, so D<sub>r</sub> = 0 and ${f(DP, 3)} mm percolates below the roots` : ''} mm.`)
      };
    }
  },
  {
    id: 'pi-irrigation-volume', title: 'Gross irrigation depth and pumped volume', lesson: 'precision-irrigation', difficulty: 1,
    gen(rng) {
      const dn = randInt(rng, 12, 35), m = pick(rng, [['surface', 0.60], ['sprinkler', 0.75], ['drip', 0.90]]), A = rand(rng, 2, 40, 0.5), V = 10 * A * dn / m[1];
      return {
        q: `A ${A} ha field needs a net irrigation of ${dn} mm, applied by ${m[0]} irrigation (FAO default application efficiency ${m[1] * 100} %). How many cubic metres of water must be pumped?`,
        answer: V, tol: 0.02, unit: 'm³',
        solution: steps(`Gross depth: \\(${dn}/${m[1]} = ${f(dn / m[1], 4)}\\) mm.`, `1 mm on 1 ha = 10 m³, so \\(V = 10\\times${A}\\times${f(dn / m[1], 4)} = ${f(V, 4)}\\) m³.`)
      };
    }
  },
  {
    id: 'pi-ky-loss', title: 'Yield loss under deficit irrigation (FAO-33)', lesson: 'precision-irrigation', difficulty: 1,
    gen(rng) {
      const c = pick(rng, [['potato', 1.1], ['spring wheat', 1.15], ['winter wheat', 1.05], ['sugar beet', 1.0], ['maize', 1.25], ['soybean', 0.85]]), r = randInt(rng, 60, 95), loss = 100 * c[1] * (1 - r / 100);
      return { q: `${c[0][0].toUpperCase() + c[0].slice(1)} (K<sub>y</sub> = ${c[1]}) receives water for ${r} % of its full seasonal evapotranspiration. What relative yield loss does FAO-33 predict?`, answer: loss, tol: 0.02, unit: '%',
        solution: steps(`\\(1-Y_a/Y_m = K_y(1-ET_a/ET_m) = ${c[1]}\\times${f(1 - r / 100, 3)} = ${f(loss / 100, 4)}\\) → ${f(loss, 3)} %.`) };
    }
  },
  {
    id: 'pi-n-balance', title: 'Field nitrogen surplus and NUE', lesson: 'precision-irrigation', difficulty: 2,
    gen(rng) {
      const F = randInt(rng, 110, 200), M = pick(rng, [0, 0, 30, 50]), D = randInt(rng, 5, 12), Nc = rand(rng, 1.6, 2.2, 0.05), In = F + M + D;
      const Ymax = Math.floor(0.92 * In / (1000 * 0.86 * Nc / 100) * 10) / 10;            // keep NUE below ≈ 92 % (no soil mining)
      const Y = Math.min(rand(rng, 5, 10, 0.1), Math.max(4, Ymax));
      const Nout = Y * 1000 * 0.86 * Nc / 100, nue = 100 * Nout / In;
      const askSurplus = rng() < 0.5;
      return {
        q: `Winter wheat receives ${F} kg N ha⁻¹ mineral fertiliser${M ? ` and ${M} kg N ha⁻¹ in manure` : ''}; deposition and seed add ${D} kg N ha⁻¹. The grain yield is ${Y} t ha⁻¹ at 14 % moisture with ${Nc} % N in the dry matter (straw stays on the field). ${askSurplus ? 'What is the nitrogen surplus?' : 'What is the nitrogen-use efficiency (harvested N / inputs)?'}`,
        answer: askSurplus ? In - Nout : nue, tol: 0.03, unit: askSurplus ? 'kg N ha⁻¹' : '%',
        solution: steps(`Harvested N: \\(${Y}\\times1000\\times0.86\\times${Nc / 100} = ${f(Nout, 4)}\\) kg N ha⁻¹.`, `Inputs: ${F}${M ? ' + ' + M : ''} + ${D} = ${In} kg N ha⁻¹.`,
          askSurplus ? `Surplus = ${In} − ${f(Nout, 4)} = ${f(In - Nout, 4)} kg N ha⁻¹.` : `NUE = ${f(Nout, 4)}/${In} = ${f(nue / 100, 4)} → ${f(nue, 3)} %.`)
      };
    }
  },
  {
    id: 'pi-eonr', title: 'Economic optimum nitrogen rate', lesson: 'precision-irrigation', difficulty: 3,
    gen(rng) {
      const b = randInt(rng, 35, 55), c = -rand(rng, 0.08, 0.16, 0.005), r = rand(rng, 5, 15, 0.5), a = randInt(rng, 3500, 5500), Nopt = (r - b) / (2 * c);
      return {
        q: `The yield response is \\(Y = ${a} + ${b}N ${c < 0 ? '-' : '+'} ${f(Math.abs(c), 3)}N^2\\) (kg grain ha⁻¹, N in kg ha⁻¹). Nitrogen costs ${r} times as much per kg as grain. What is the economic optimum N rate?`,
        answer: Nopt, tol: 0.02, unit: 'kg N ha⁻¹',
        solution: steps(`Profit is maximal where \\(dY/dN = b+2cN = p_N/p_Y\\).`, `\\(N^* = (p_N/p_Y-b)/(2c) = (${r}-${b})/(2\\times${f(c, 4)}) = ${f(Nopt, 4)}\\) kg N ha⁻¹.`, `The agronomic maximum would be \\(-b/2c = ${f(-b / (2 * c), 4)}\\) kg N ha⁻¹; the last kilograms add little yield but much leaching risk.`)
      };
    }
  },
  {
    id: 'pi-nitrate-conc', title: 'Nitrate concentration in drainage water', lesson: 'precision-irrigation', difficulty: 2,
    gen(rng) {
      const L = randInt(rng, 8, 60), D = randInt(rng, 100, 400), cN = 100 * L / D, c = cN * 62.004 / 14.007;
      return {
        q: `A field loses ${L} kg N ha⁻¹ by leaching over a winter in which ${D} mm of water drains below the root zone. What is the average nitrate (NO₃⁻) concentration of the drainage?`,
        answer: c, tol: 0.02, unit: 'mg NO₃ L⁻¹',
        solution: steps(`\\(C_{\\text{NO}_3\\text{-N}} = 100L/D = 100\\times${L}/${D} = ${f(cN, 4)}\\) mg L⁻¹.`, `\\(\\times 62.0/14.0 = ${f(c, 4)}\\) mg NO₃ L⁻¹ — ${c > 50 ? 'above' : 'below'} the 50 mg L⁻¹ limit.`)
      };
    }
  },

  /* ======================= 11.4 Agricultural robotics and automation ======================= */
  {
    id: 'ar-spot-spray', title: 'Herbicide saving of a spot sprayer', lesson: 'agricultural-robotics', difficulty: 3,
    gen(rng) {
      const lam = pick(rng, [1, 2, 5, 10, 20, 40]), side = pick(rng, [4, 6, 10, 25, 50]), r = rand(rng, 0.85, 0.99, 0.01), q = rand(rng, 0, 0.03, 0.005);
      const A = Math.pow(side / 100, 2), pw = 1 - Math.exp(-lam * A), fT = r * pw + q * (1 - pw), S = 100 * (1 - fT);
      return {
        q: `Weeds are randomly distributed at ${lam} weeds m⁻². A spot sprayer uses ${side} cm × ${side} cm cells, with recall ${r} and false-positive rate ${q}. What herbicide saving (%) does it achieve compared with broadcast spraying?`,
        answer: S, tol: 0.02, unit: '%',
        solution: steps(`\\(\\lambda a = ${lam}\\times${f(A, 4)} = ${f(lam * A, 4)}\\); \\(p_w = 1-e^{-\\lambda a} = ${f(pw, 4)}\\).`, `\\(f_T = r\\,p_w + q(1-p_w) = ${r}\\times${f(pw, 4)} + ${q}\\times${f(1 - pw, 4)} = ${f(fT, 4)}\\).`, `Saving \\(= 1-f_T = ${f(S / 100, 4)}\\) → ${f(S, 3)} %.`)
      };
    }
  },
  {
    id: 'ar-f1', title: 'Precision, recall and F1 of a weed detector', lesson: 'agricultural-robotics', difficulty: 1,
    gen(rng) {
      const W = randInt(rng, 80, 300), C = randInt(rng, 400, 1200), TP = randInt(rng, Math.round(0.7 * W), W - 2), FP = randInt(rng, 5, Math.round(0.1 * C));
      const P = TP / (TP + FP), R = TP / W, F1 = 2 * P * R / (P + R);
      return {
        q: `A detector is tested on ${W} weeds and ${C} crop plants. It finds ${TP} of the weeds and wrongly labels ${FP} crop plants as weeds. What is its F1 score?`,
        answer: F1, abstol: 0.005, unit: '',
        solution: steps(`Precision = ${TP}/(${TP}+${FP}) = ${f(P, 4)}; recall = ${TP}/${W} = ${f(R, 4)}.`, `\\(F_1 = 2PR/(P+R) = ${f(F1, 4)}\\). (Accuracy would be ${f((TP + C - FP) / (W + C), 3)} — flattering, because crop plants dominate.)`)
      };
    }
  },
  {
    id: 'ar-harvest-fleet', title: 'How many harvesting robots?', lesson: 'agricultural-robotics', difficulty: 2,
    gen(rng) {
      const s = rand(rng, 0.4, 0.8, 0.01), tc = rand(rng, 8, 30, 0.5), eta = rand(rng, 0.6, 0.9, 0.05), req = pick(rng, [500, 800, 1000, 1500, 2000]);
      const rate = 3600 * s / tc, N = Math.ceil(req / (rate * eta));
      return {
        q: `A harvesting robot has a cycle time of ${tc} s per attempt and a success rate of ${f(s * 100, 3)} %; it is productive ${f(eta * 100, 3)} % of the time. How many robots are needed to harvest ${req} fruits per hour?`,
        answer: N, abstol: 0.5, unit: 'robots',
        solution: steps(`Fruits per robot-hour: \\(3600\\times${s}/${tc} = ${f(rate, 4)}\\); effective \\(\\times${eta} = ${f(rate * eta, 4)}\\).`, `Robots: \\(\\lceil ${req}/${f(rate * eta, 4)}\\rceil = ${N}\\).`)
      };
    }
  },
  {
    id: 'ar-field-capacity', title: 'Effective field capacity of a machine', lesson: 'agricultural-robotics', difficulty: 1,
    gen(rng) {
      const w = rand(rng, 1.5, 12, 0.5), v = rand(rng, 0.8, 10, 0.2), e = rand(rng, 0.6, 0.9, 0.05), C = w * v * e / 10;
      return { q: `A weeding machine is ${w} m wide, works at ${v} km h⁻¹ and has a field efficiency of ${e}. What is its effective field capacity?`, answer: C, tol: 0.02, unit: 'ha h⁻¹',
        solution: steps(`\\(C_e = w\\,v\\,\\eta_f/10 = ${w}\\times${v}\\times${e}/10 = ${f(C, 4)}\\) ha h⁻¹ (1 m × 1 km = 0.1 ha).`) };
    }
  },
  {
    id: 'ar-stopping', title: 'Stopping distance of an autonomous machine', lesson: 'agricultural-robotics', difficulty: 2,
    gen(rng) {
      const vk = rand(rng, 2, 18, 0.5), tr = rand(rng, 0.2, 1.0, 0.05), a = rand(rng, 1, 3, 0.1), v = vk / 3.6, d = v * tr + v * v / (2 * a);
      return { q: `An autonomous machine travels at ${vk} km h⁻¹. Its detection-to-brake reaction time is ${tr} s and it can decelerate at ${a} m s⁻². What is its stopping distance?`, answer: d, tol: 0.02, unit: 'm',
        solution: steps(`\\(v = ${vk}/3.6 = ${f(v, 4)}\\) m s⁻¹.`, `\\(d = vt_r + v^2/2a = ${f(v * tr, 4)} + ${f(v * v / (2 * a), 4)} = ${f(d, 4)}\\) m.`) };
    }
  },

  /* ======================= 11.5 Agrivoltaics and multifunctional land use ======================= */
  {
    id: 'av-ler', title: 'Land equivalent ratio of an agrivoltaic system', lesson: 'agrivoltaics', difficulty: 1,
    gen(rng) {
      const y = randInt(rng, 60, 105), e = randInt(rng, 40, 90), L = y / 100 + e / 100;
      return { q: `An agrivoltaic system produces ${y} % of the crop yield of an open reference field and ${e} % of the electricity of a conventional solar park on the same area. What is its land equivalent ratio?`, answer: L, abstol: 0.01, unit: '',
        solution: steps(`\\(\\text{LER} = Y_{AV}/Y_{ref} + E_{AV}/E_{ref} = ${y / 100} + ${e / 100} = ${f(L, 3)}\\).`, `Separate production would need ${f((L - 1) * 100, 3)} % ${L >= 1 ? 'more' : 'less'} land.`) };
    }
  },
  {
    id: 'av-pv-temperature', title: 'PV module power with cell-temperature correction', lesson: 'agrivoltaics', difficulty: 2,
    gen(rng) {
      const eta = rand(rng, 19, 23, 0.1), A = rand(rng, 1.7, 2.2, 0.05), G = randInt(rng, 5, 11) * 100, Ta = randInt(rng, 5, 32), beta = rand(rng, 0.30, 0.45, 0.01), noct = pick(rng, [43, 44, 45, 46]);
      const Tc = Ta + (noct - 20) / 800 * G, P = eta / 100 * A * G * (1 - beta / 100 * (Tc - 25));
      return {
        q: `A ${A} m² module with ${eta} % STC efficiency, temperature coefficient −${beta} % K⁻¹ and NOCT ${noct} °C receives ${G} W m⁻² at an air temperature of ${Ta} °C. What is its power output?`,
        answer: P, tol: 0.02, unit: 'W',
        solution: steps(`\\(T_c = T_a + (\\text{NOCT}-20)/800\\times G = ${Ta} + ${noct - 20}/800\\times${G} = ${f(Tc, 4)}\\) °C.`, `\\(P = \\eta A G[1+\\beta(T_c-25)] = ${eta / 100}\\times${A}\\times${G}\\times[1-${beta / 100}\\times${f(Tc - 25, 4)}] = ${f(P, 4)}\\) W.`)
      };
    }
  },
  {
    id: 'av-gcr-power', title: 'Ground-coverage ratio and installed power per hectare', lesson: 'agrivoltaics', difficulty: 1,
    gen(rng) {
      const W = rand(rng, 1.8, 4, 0.1), d = rand(rng, 5, 20, 0.5), eta = rand(rng, 19, 23, 0.5), g = W / d, P = g * eta / 100 * 1000 * 10000 / 1e6;
      return { q: `Module rows with a collector width of ${W} m are spaced ${d} m apart; the modules are ${eta} % efficient. What peak power is installed per hectare of land?`, answer: P, tol: 0.02, unit: 'MWp ha⁻¹',
        solution: steps(`GCR = ${W}/${d} = ${f(g, 4)}.`, `Power per m²: \\(${f(g, 4)}\\times${eta / 100}\\times1000 = ${f(g * eta * 10, 4)}\\) Wp m⁻² → ×10 000 m² = ${f(P, 4)} MWp ha⁻¹.`) };
    }
  },
  {
    id: 'av-shadow', title: 'Shadow of a module row across the inter-row space', lesson: 'agrivoltaics', difficulty: 2,
    gen(rng) {
      const H = rand(rng, 2, 5.5, 0.1), el = randInt(rng, 15, 55), az = randInt(rng, 95, 150), rows = pick(rng, [['north–south', 0], ['east–west', 90]]);
      const s = H * Math.abs(Math.sin((az - rows[1]) * Math.PI / 180)) / Math.tan(el * Math.PI / 180);
      return { q: `The top edge of a module row is ${H} m above the ground and the rows run ${rows[0]}. The sun is at ${el}° elevation and ${az}° azimuth. How far does the shadow reach across the inter-row space?`, answer: s, tol: 0.02, unit: 'm',
        solution: steps(`\\(s_\\perp = H|\\sin(\\psi_s-\\psi_r)|/\\tan\\alpha_s = ${H}\\times|\\sin(${az}^\\circ-${rows[1]}^\\circ)|/\\tan${el}^\\circ\\).`, `\\(= ${H}\\times${f(Math.abs(Math.sin((az - rows[1]) * Math.PI / 180)), 4)}/${f(Math.tan(el * Math.PI / 180), 4)} = ${f(s, 4)}\\) m.`) };
    }
  }
];
