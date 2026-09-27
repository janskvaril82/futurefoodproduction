/* Practice generators — Module 4 "Light: physics, measurement and engineering".
   Lessons: radiation-physics (4.1), daily-light-integral (4.2), led-lighting-design (4.3), spectral-quality (4.4). */
import { rand, randInt, pick, f, steps, mcq } from './helpers.js';

const H = 6.62607015e-34, C = 2.99792458e8, NA = 6.02214076e23;
const deg = Math.PI / 180;

export default [
  {
    id: 'light-photon-energy', title: 'Energy of a single photon', lesson: 'radiation-physics', difficulty: 1,
    gen(rng) {
      const l = randInt(rng, 400, 730);
      const E = H * C / (l * 1e-9) * 1e19;
      return {
        q: `Calculate the energy of one photon with a wavelength of ${l} nm. Give the answer in units of 10⁻¹⁹ J.`,
        answer: E, tol: 0.02, unit: '× 10⁻¹⁹ J',
        solution: steps(
          `Use the Planck–Einstein relation \\(E = hc/\\lambda\\) with \\(\\lambda\\) in metres: \\(${l}\\times10^{-9}\\) m.`,
          `\\(E = \\dfrac{6.626\\times10^{-34}\\times2.998\\times10^{8}}{${l}\\times10^{-9}} = ${f(E, 4)}\\times10^{-19}\\) J.`,
          `Check: shorter wavelengths carry more energy per photon, so a ${l} nm photon ${l < 550 ? 'has more' : 'has less'} energy than a green 550 nm photon (3.61 × 10⁻¹⁹ J).`)
      };
    }
  },
  {
    id: 'light-umol-per-joule', title: 'Photons per joule at one wavelength', lesson: 'radiation-physics', difficulty: 1,
    gen(rng) {
      const l = randInt(rng, 400, 740);
      const k = l * 1e-9 / (H * C * NA) * 1e6;
      return {
        q: `How many micromoles of photons are contained in one joule of monochromatic light at ${l} nm?`,
        answer: k, tol: 0.01, unit: 'µmol J⁻¹',
        solution: steps(
          `Photons per joule: \\(1/E_{\\text{ph}} = \\lambda/(hc)\\); divide by \\(N_A\\) to get moles.`,
          `\\(\\lambda/(hcN_A) = ${l}\\times10^{-9}/0.11963 = ${f(k / 1e6, 4)}\\) mol J⁻¹.`,
          `In micromoles: \\(${f(k, 4)}\\) µmol J⁻¹ (shortcut: \\(0.008359\\times\\lambda_{\\text{nm}}\\)).`)
      };
    }
  },
  {
    id: 'light-watts-to-ppfd', title: 'Radiant irradiance to PPFD (monochromatic)', lesson: 'radiation-physics', difficulty: 2,
    gen(rng) {
      const l = pick(rng, [450, 470, 630, 660, 680]);
      const W = rand(rng, 20, 120, 5);
      const ppfd = W * 0.0083594 * l;
      return {
        q: `A narrow-band LED array (${l} nm) delivers a radiant irradiance of ${W} W m⁻² at the canopy. What is the PPFD?`,
        answer: ppfd, tol: 0.02, unit: 'µmol m⁻² s⁻¹',
        solution: steps(
          `Photons per joule at ${l} nm: \\(0.008359\\times${l} = ${f(0.0083594 * l, 4)}\\) µmol J⁻¹.`,
          `${W} W m⁻² is ${W} J of light per m² per second.`,
          `PPFD \\(= ${W}\\times${f(0.0083594 * l, 4)} = ${f(ppfd, 4)}\\) µmol m⁻² s⁻¹.`)
      };
    }
  },
  {
    id: 'light-photon-ratio', title: 'Same watts, different photons', lesson: 'radiation-physics', difficulty: 2,
    gen(rng) {
      const a = pick(rng, [440, 450, 460]), b = pick(rng, [630, 660, 680]);
      const pct = (b / a - 1) * 100;
      return {
        q: `Two lamps deliver the same radiant energy (W m⁻²) to a canopy. Lamp A emits at ${a} nm, lamp B at ${b} nm. By how many percent does lamp B's PPFD exceed lamp A's?`,
        answer: pct, tol: 0.02, unit: '%',
        solution: steps(
          `Photons per joule are proportional to wavelength: \\(n/E\\propto\\lambda\\).`,
          `Ratio \\(B/A = ${b}/${a} = ${f(b / a, 4)}\\).`,
          `Lamp B delivers \\(${f(pct, 3)}\\) % more photons for the same energy.`)
      };
    }
  },
  {
    id: 'light-sun-ppfd', title: 'Global radiation to PPFD (sunlight)', lesson: 'radiation-physics', difficulty: 1,
    gen(rng) {
      const Rg = rand(rng, 150, 950, 10), fpar = pick(rng, [0.44, 0.45, 0.46, 0.48]);
      const p = fpar * 4.57 * Rg;
      return {
        q: `A pyranometer measures global solar radiation \\(R_g = ${Rg}\\) W m⁻². Assuming a PAR fraction of ${fpar} and 4.57 µmol J⁻¹ within PAR, estimate the outdoor PPFD.`,
        answer: p, tol: 0.02, unit: 'µmol m⁻² s⁻¹',
        solution: steps(`PAR energy: \\(${fpar}\\times${Rg} = ${f(fpar * Rg, 4)}\\) W m⁻².`, `PPFD \\(= ${f(fpar * Rg, 4)}\\times4.57 = ${f(p, 4)}\\) µmol m⁻² s⁻¹ (≈ 2 × R_g).`)
      };
    }
  },
  {
    id: 'light-dli', title: 'DLI from PPFD and photoperiod', lesson: 'daily-light-integral', difficulty: 1,
    gen(rng) {
      const ppfd = rand(rng, 120, 450, 10), t = randInt(rng, 10, 20);
      const dli = ppfd * t * 3600 / 1e6;
      return {
        q: `An LED fixture keeps a constant PPFD of ${ppfd} µmol m⁻² s⁻¹ for ${t} hours per day. What is the daily light integral?`,
        answer: dli, tol: 0.02, unit: 'mol m⁻² d⁻¹',
        solution: steps(`\\(\\text{DLI} = \\text{PPFD}\\cdot t\\cdot 3600/10^{6}\\).`, `\\(= ${ppfd}\\times${t}\\times3600/10^{6} = ${f(dli, 4)}\\) mol m⁻² d⁻¹.`)
      };
    }
  },
  {
    id: 'light-ppfd-for-dli', title: 'PPFD needed for a DLI target', lesson: 'daily-light-integral', difficulty: 1,
    gen(rng) {
      const dli = rand(rng, 10, 22, 1), t = randInt(rng, 12, 20);
      const p = dli * 1e6 / (3600 * t);
      return {
        q: `A lettuce crop should receive ${dli} mol m⁻² d⁻¹ from electric light alone with a ${t}-hour photoperiod. What constant PPFD is required?`,
        answer: p, tol: 0.02, unit: 'µmol m⁻² s⁻¹',
        solution: steps(`Rearrange the DLI equation: \\(\\text{PPFD} = \\text{DLI}\\times10^{6}/(3600\\,t)\\).`, `\\(= ${dli}\\times10^{6}/(3600\\times${t}) = ${f(p, 4)}\\) µmol m⁻² s⁻¹.`)
      };
    }
  },
  {
    id: 'light-supplement-hours', title: 'Hours of supplementary lighting', lesson: 'daily-light-integral', difficulty: 2,
    gen(rng) {
      const nat = rand(rng, 1, 8, 0.5), target = rand(rng, 12, 17, 1), lamp = rand(rng, 100, 250, 10);
      const h = (target - nat) * 1e6 / (3600 * lamp);
      return {
        q: `In a Swedish greenhouse in winter the natural DLI inside is ${nat} mol m⁻² d⁻¹. The target for lettuce is ${target} mol m⁻² d⁻¹, and the supplementary lamps give ${lamp} µmol m⁻² s⁻¹ at the canopy. How many hours per day must the lamps run?`,
        answer: h, tol: 0.02, unit: 'h d⁻¹',
        solution: steps(`Deficit: \\(${target}-${nat} = ${f(target - nat, 3)}\\) mol m⁻² d⁻¹.`, `One hour of lamps delivers \\(${lamp}\\times3600/10^{6} = ${f(lamp * 0.0036, 3)}\\) mol m⁻².`, `Hours \\(= ${f(target - nat, 3)}/${f(lamp * 0.0036, 3)} = ${f(h, 3)}\\) h d⁻¹.`)
      };
    }
  },
  {
    id: 'light-day-length', title: 'Day length from latitude and declination', lesson: 'daily-light-integral', difficulty: 2,
    gen(rng) {
      const lat = pick(rng, [55.6, 59.6, 63.8, 52.4, 45.0, 36.8]);
      const dec = pick(rng, [-23.44, -15.0, 0, 10.0, 23.44]);
      const x = -Math.tan(lat * deg) * Math.tan(dec * deg);
      const N = 24 / Math.PI * Math.acos(Math.max(-1, Math.min(1, x)));
      return {
        q: `Estimate the astronomical day length at latitude ${lat}° N on a day when the solar declination is ${dec}°. (Use \\(N = \\tfrac{24}{\\pi}\\arccos(-\\tan\\varphi\\tan\\delta)\\).)`,
        answer: N, tol: 0.015, unit: 'h',
        solution: steps(`\\(-\\tan(${lat}^{\\circ})\\tan(${dec}^{\\circ}) = ${f(x, 4)}\\).`, `\\(\\omega_s = \\arccos(${f(x, 4)}) = ${f(Math.acos(Math.max(-1, Math.min(1, x))), 4)}\\) rad.`, `\\(N = 24/\\pi\\times\\omega_s = ${f(N, 4)}\\) h.`)
      };
    }
  },
  {
    id: 'light-noon-elevation', title: 'Solar elevation at noon', lesson: 'daily-light-integral', difficulty: 1,
    gen(rng) {
      const lat = pick(rng, [55.6, 59.6, 63.8, 67.9, 52.4, 40.4]);
      const dec = pick(rng, [-23.44, -12.0, 0, 12.0, 23.44]);
      const a = 90 - Math.abs(lat - dec);
      return {
        q: `What is the sun's elevation above the horizon at solar noon at ${lat}° N when the declination is ${dec}°?`,
        answer: a, abstol: 0.3, unit: '°',
        solution: steps(`At solar noon \\(\\alpha = 90^{\\circ} - |\\varphi - \\delta|\\).`, `\\(= 90 - |${lat} - (${dec})| = ${f(a, 4)}^{\\circ}\\).`)
      };
    }
  },
  {
    id: 'light-inverse-square', title: 'Raising a lamp: the inverse-square law', lesson: 'led-lighting-design', difficulty: 1,
    gen(rng) {
      const e1 = rand(rng, 300, 900, 10), h1 = rand(rng, 0.3, 0.6, 0.05), h2 = +(h1 * pick(rng, [1.5, 2, 2.5])).toFixed(2);
      const e2 = e1 * (h1 / h2) ** 2;
      return {
        q: `Directly below a compact LED fixture the PPFD is ${e1} µmol m⁻² s⁻¹ at ${h1} m. Treating the fixture as a point source, what is the PPFD directly below it when it is raised to ${h2} m?`,
        answer: e2, tol: 0.02, unit: 'µmol m⁻² s⁻¹',
        solution: steps(`Directly below a point source \\(E\\propto 1/h^{2}\\).`, `\\(E_2 = E_1 (h_1/h_2)^2 = ${e1}\\times(${h1}/${h2})^2 = ${f(e2, 4)}\\) µmol m⁻² s⁻¹.`)
      };
    }
  },
  {
    id: 'light-lambertian-point', title: 'PPFD under a Lambertian fixture', lesson: 'led-lighting-design', difficulty: 2,
    gen(rng) {
      const ppf = rand(rng, 300, 1500, 50), h = rand(rng, 0.3, 1.0, 0.05);
      const E = ppf / (Math.PI * h * h);
      return {
        q: `A small fixture emits a photosynthetic photon flux of ${ppf} µmol s⁻¹ with a Lambertian (cosine) distribution. What is the PPFD on the canopy directly below it at ${h} m, ignoring walls?`,
        answer: E, tol: 0.02, unit: 'µmol m⁻² s⁻¹',
        solution: steps(`For a Lambertian emitter the on-axis intensity is \\(I_0 = \\Phi_p/\\pi\\).`, `Directly below, \\(E = I_0/h^2 = \\Phi_p/(\\pi h^2)\\).`, `\\(E = ${ppf}/(\\pi\\times${h}^2) = ${f(E, 4)}\\) µmol m⁻² s⁻¹.`)
      };
    }
  },
  {
    id: 'light-fixture-count', title: 'How many fixtures for a target PPFD?', lesson: 'led-lighting-design', difficulty: 2,
    gen(rng) {
      const A = rand(rng, 4, 20, 1), target = rand(rng, 180, 400, 10), ppf = rand(rng, 400, 1200, 50), cap = pick(rng, [0.7, 0.75, 0.8, 0.85]);
      const n = target * A / (ppf * cap);
      return {
        q: `A growing area of ${A} m² needs a mean PPFD of ${target} µmol m⁻² s⁻¹. Each fixture emits ${ppf} µmol s⁻¹ and ${Math.round(cap * 100)} % of the photons reach the canopy. How many fixtures are needed (give the exact value before rounding up)?`,
        answer: n, tol: 0.02, unit: 'fixtures',
        solution: steps(`Photons needed on the canopy: \\(${target}\\times${A} = ${f(target * A, 4)}\\) µmol s⁻¹.`, `Useful photons per fixture: \\(${ppf}\\times${cap} = ${f(ppf * cap, 4)}\\) µmol s⁻¹.`, `\\(N = ${f(target * A, 4)}/${f(ppf * cap, 4)} = ${f(n, 3)}\\) → install ${Math.ceil(n)} fixtures.`)
      };
    }
  },
  {
    id: 'light-efficacy', title: 'Photon efficacy of a fixture', lesson: 'led-lighting-design', difficulty: 1,
    gen(rng) {
      const P = rand(rng, 100, 700, 10), eff = rand(rng, 1.7, 3.5, 0.05), ppf = +(P * eff).toFixed(0);
      return {
        q: `An LED fixture draws ${P} W of electrical power and emits a PPF of ${ppf} µmol s⁻¹. What is its photon efficacy?`,
        answer: ppf / P, tol: 0.01, unit: 'µmol J⁻¹',
        solution: steps(`Photon efficacy \\(\\eta_{\\text{ph}} = \\text{PPF}/P\\) (1 W = 1 J s⁻¹).`, `\\(= ${ppf}/${P} = ${f(ppf / P, 4)}\\) µmol J⁻¹.`)
      };
    }
  },
  {
    id: 'light-kwh-per-mol', title: 'Electricity per mole of photons delivered', lesson: 'led-lighting-design', difficulty: 2,
    gen(rng) {
      const eff = rand(rng, 1.7, 3.6, 0.1), cap = pick(rng, [0.6, 0.7, 0.75, 0.8, 0.9]);
      const k = 0.27778 / (eff * cap);
      return {
        q: `A lighting system has a photon efficacy of ${eff} µmol J⁻¹, and ${Math.round(cap * 100)} % of the photons reach the leaves. How many kWh of electricity are needed per mole of photons delivered to the canopy?`,
        answer: k, tol: 0.02, unit: 'kWh mol⁻¹',
        solution: steps(`Joules per mole on the canopy: \\(10^{6}/(\\eta_{\\text{ph}}\\,\\eta_{\\text{cap}}) = 10^{6}/(${eff}\\times${cap}) = ${f(1e6 / (eff * cap), 4)}\\) J.`, `Divide by \\(3.6\\times10^{6}\\) J kWh⁻¹: \\(${f(k, 4)}\\) kWh mol⁻¹.`)
      };
    }
  },
  {
    id: 'light-annual-cost', title: 'Annual lighting cost of a DLI', lesson: 'led-lighting-design', difficulty: 3,
    gen(rng) {
      const dli = rand(rng, 12, 20, 1), eff = rand(rng, 2.2, 3.4, 0.1), cap = pick(rng, [0.7, 0.8, 0.85]), price = rand(rng, 0.06, 0.25, 0.01);
      const kwh = dli * 365 * 1e6 / (eff * cap) / 3.6e6, cost = kwh * price;
      return {
        q: `A vertical farm supplies a DLI of ${dli} mol m⁻² d⁻¹ all year with LEDs of ${eff} µmol J⁻¹ and ${Math.round(cap * 100)} % canopy capture. At ${price} € kWh⁻¹, what is the annual lighting electricity cost per square metre of cultivation area?`,
        answer: cost, tol: 0.02, unit: '€ m⁻² yr⁻¹',
        solution: steps(`Photons per year on the canopy: \\(${dli}\\times365 = ${f(dli * 365, 4)}\\) mol m⁻².`, `Electricity: \\(${f(dli * 365, 4)}\\times10^{6}/(${eff}\\times${cap})/3.6\\times10^{6} = ${f(kwh, 4)}\\) kWh m⁻² yr⁻¹.`, `Cost: \\(${f(kwh, 4)}\\times${price} = ${f(cost, 4)}\\) € m⁻² yr⁻¹.`)
      };
    }
  },
  {
    id: 'light-r-fr', title: 'Red : far-red ratio', lesson: 'spectral-quality', difficulty: 1,
    gen(rng) {
      const r = rand(rng, 20, 90, 1), fr = rand(rng, 5, 60, 1);
      return {
        q: `A spectroradiometer measures a photon flux of ${r} µmol m⁻² s⁻¹ in the 655–665 nm band and ${fr} µmol m⁻² s⁻¹ in the 725–735 nm band. What is the red : far-red ratio?`,
        answer: r / fr, tol: 0.01, unit: '',
        solution: steps(`R:FR is the ratio of photon fluxes in the two 10-nm bands.`, `\\(\\text{R:FR} = ${r}/${fr} = ${f(r / fr, 3)}\\). Sunlight is ≈ 1.1–1.2; under a leaf canopy it can fall below 0.3, which triggers shade-avoidance responses.`)
      };
    }
  },
  {
    id: 'light-pss', title: 'Phytochrome photostationary state', lesson: 'spectral-quality', difficulty: 3,
    gen(rng) {
      const nr = rand(rng, 50, 300, 10), nfr = rand(rng, 0, 150, 10);
      const sr660 = 0.85, sfr660 = 0.12, sr730 = 0.02, sfr730 = 0.65; // illustrative relative photoconversion cross-sections
      const A = nr * sr660 + nfr * sr730, B = nr * sfr660 + nfr * sfr730;
      const pss = A / (A + B);
      return {
        q: `A light source delivers ${nr} µmol m⁻² s⁻¹ at 660 nm and ${nfr} µmol m⁻² s⁻¹ at 730 nm. Assume relative photoconversion cross-sections σ(Pr) = ${sr660} and σ(Pfr) = ${sfr660} at 660 nm, and σ(Pr) = ${sr730} and σ(Pfr) = ${sfr730} at 730 nm. Calculate the phytochrome photostationary state PSS = Pfr/(Pr + Pfr).`,
        answer: pss, tol: 0.02, unit: '',
        solution: steps(
          `At photoequilibrium the rate Pr→Pfr equals the rate Pfr→Pr, giving \\(\\text{PSS} = \\dfrac{\\sum N\\sigma_{\\text{Pr}}}{\\sum N\\sigma_{\\text{Pr}} + \\sum N\\sigma_{\\text{Pfr}}}\\).`,
          `\\(\\sum N\\sigma_{\\text{Pr}} = ${nr}\\times${sr660} + ${nfr}\\times${sr730} = ${f(A, 4)}\\).`,
          `\\(\\sum N\\sigma_{\\text{Pfr}} = ${nr}\\times${sfr660} + ${nfr}\\times${sfr730} = ${f(B, 4)}\\).`,
          `PSS \\(= ${f(A, 4)}/(${f(A, 4)} + ${f(B, 4)}) = ${f(pss, 3)}\\). Adding far-red lowers the PSS and promotes stem and leaf elongation.`)
      };
    }
  },
  {
    id: 'light-ypf', title: 'Yield photon flux with the McCree weighting', lesson: 'spectral-quality', difficulty: 2,
    gen(rng) {
      const nb = rand(rng, 20, 120, 5), nr = rand(rng, 100, 400, 10), qb = 0.70, qr = 0.97;
      const ypf = nb * qb + nr * qr;
      return {
        q: `A fixture emits ${nb} µmol s⁻¹ of blue photons (450 nm, relative quantum efficiency ${qb}) and ${nr} µmol s⁻¹ of red photons (660 nm, RQE ${qr}). What is its yield photon flux (YPF)?`,
        answer: ypf, tol: 0.02, unit: 'µmol s⁻¹',
        solution: steps(`YPF weights each photon by McCree's relative quantum efficiency: \\(\\text{YPF} = \\sum N_\\lambda\\,\\text{RQE}(\\lambda)\\).`, `\\(= ${nb}\\times${qb} + ${nr}\\times${qr} = ${f(ypf, 4)}\\) µmol s⁻¹ (versus a PPF of ${nb + nr}).`)
      };
    }
  },
  {
    id: 'light-lux-pitfall', title: 'Why lux misleads for plants', lesson: 'radiation-physics', difficulty: 1,
    gen(rng) {
      return mcq(rng,
        'A red-and-blue LED fixture and a cool-white LED fixture give the same PPFD on a canopy. How do their lux meter readings compare?',
        'The red/blue fixture reads far fewer lux, because the eye (and a lux meter) is most sensitive to green-yellow light.',
        ['Both read the same number of lux, because PPFD is the same.', 'The red/blue fixture reads more lux, because red and blue photons carry more energy.', 'Lux cannot be measured under LEDs.'],
        '<p>Illuminance weights light by the photopic sensitivity curve V(λ), which peaks at 555 nm and is only a few percent of its peak at 450 and 660 nm. Equal photon counts therefore give very different lux values — use PPFD for plants.</p>');
    }
  }
];
