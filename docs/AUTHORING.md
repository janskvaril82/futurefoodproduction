# Future Food Production — authoring guide

This guide is the contract for everyone who writes lessons, laboratories and tools for the course. Read it completely before writing anything. **The quality bar is: the best university course on future food production in the world.** First-cycle (year 1) bachelor students in environmental engineering are the audience, so explanations must be accessible, but the content must be rigorous, quantitative, referenced and up to date (the current date is September 2026).

Project root: the folder that contains `index.html` and `vercel.json` (a static site deployed to Vercel; absolute URLs such as `/assets/css/main.css` resolve to the project root).

---

## 1. Ground rules

1. **Do not modify shared files**: anything in `/assets/` (CSS, `site.js`, `course-data.js`, `plot.js`, `ui.js`, `stats.js`, `physics.js`, `colors.js`, `lab3d.js`), `/docs/`, or other authors' pages. Many authors work in parallel. If you find a bug or a missing feature in a shared file, work around it locally (in your own page's script) and **report it in your final message**.
2. **Slugs are fixed** by `/assets/js/course-data.js`. Lessons live at `/lessons/<slug>/index.html`, labs at `/laboratories/<slug>/index.html` (+ optional `main.js` and other files in the same folder). Read `course-data.js` to see all module/lesson/lab slugs, titles and summaries — link to other lessons and labs freely using these URLs (they will exist).
3. **Copy the exemplars**: the model lesson is `/lessons/radiation-physics/index.html`; the model laboratory is `/laboratories/grow-room-lighting/` (`index.html` + `main.js`). Copy their `<head>` verbatim (changing only title/description), their body structure and their component markup. Match or exceed their depth.
4. **No build step, no npm packages.** Only the CDN libraries already used (three.js 0.170.0 via the import map, KaTeX loaded automatically by `site.js`). Everything else is vanilla JS/HTML/CSS/SVG written by you.
5. **English (British spelling)**, SI units, correct superscripts (m⁻², s⁻¹, CO₂ with Unicode sub/superscripts in HTML text). Use a thin space or normal space between number and unit.
6. **Accuracy over flourish.** Never invent statistics, studies, quotes or references. Every non-trivial factual claim or number should be traceable to a reference in the lesson's reference list. If you are not certain that a reference exists with the exact authors/year/journal/DOI, verify it with WebSearch or leave it out. Prefer landmark papers, review articles, FAO/IPCC/EFSA/EU documents and standard textbooks. Give DOIs as `https://doi.org/...` links. For regulation and fast-moving topics (novel foods, NGT regulation, cultivated meat approvals, vertical-farm companies), state "as of 2026" and verify with WebSearch.
7. **Everything visualised.** Each lesson section should have a diagram, chart, interactive figure or table. Prefer inline SVG diagrams (class `dg`, theme-aware) and interactive figures (plot.js) over static images.
9. **Privacy.** Never put the user's name, e-mail address or other personal data into HTTP requests, User-Agent/mailto headers, API parameters, scripts or pages. Use a generic User-Agent (e.g., `FFP-course-verification/1.0`) when querying Crossref, OpenAlex, Europe PMC or other APIs.
8. **Every equation explained in detail** — see §4.2. Go into more detail than seems necessary: derivation, assumptions, symbol table with units, unit check, a worked number and, where possible, a live calculator.

---

## 2. Page templates

### 2.1 Lesson (`/lessons/<slug>/index.html`)

```html
<!doctype html>
<html lang="en">
<head>
<!-- copy the <head> of /lessons/radiation-physics/index.html; change <title> and description -->
</head>
<body data-page="lesson" data-slug="<slug>">
<div data-site-header></div>
<div class="lesson-layout">
  <aside class="lesson-side" data-lesson-side aria-label="Module navigation"></aside>
  <main id="main">
    <header class="lesson-head" data-lesson-head>
      <h1>Exact lesson title from course-data.js</h1>
      <p class="lead">One engaging paragraph that motivates the lesson.</p>
    </header>
    <section class="objectives"><h2>What you will be able to do</h2><ul><li>… (LOx)</li></ul></section>
    <article class="prose" data-lesson-body>
      <h2 id="…">Section title</h2>  <!-- numbered automatically; site.js builds the table of contents -->
      …
    </article>
    <div data-lesson-foot></div>
  </main>
  <aside class="lesson-toc" data-lesson-toc aria-label="On this page"></aside>
</div>
<div data-site-footer></div>
<!-- optional: <script type="module"> for this lesson's interactive figures -->
</body>
</html>
```

`site.js` fills in the breadcrumb, lesson number, duration, LO badges, module sidebar, table of contents, section numbers, "mark as studied", previous/next navigation. Do not hard-code these.

**Required lesson anatomy** (in this order; headings may be adapted):

1. Lead paragraph + objectives (4–6 bullet points, each tagged with LO numbers).
2. 5–9 content sections (`<h2 id>` each), progressing from intuition to quantitative treatment to application. Include real-world and Swedish/Nordic/EU context where natural (e.g., Västerås at 59.6° N, Swedish electricity mix, EU policy).
3. Throughout the sections: **at least 3 equation boxes** (quantitative lessons: 5–10), **at least 3 worked examples**, **at least 2 interactive figures or live calculators**, several SVG diagrams/figures, callouts (key idea, misconception, history, frontier), tables.
4. Links to the module's laboratories with `<a class="lab-link" data-lab="<lab-slug>" data-why="…"></a>`.
5. `Check your understanding` — a quiz with **8–12 questions** mixing numeric, mcq, multi and tf, with per-option feedback, hints and explanations.
6. `Key terms` — `<dl class="key-terms">` with 8–15 terms (these are aggregated into the site glossary).
7. `Check your reasoning` — `<ul class="check-list">` of 4–6 "I can …" statements.
8. `Readings` — `<ul class="reading-list">`: 2 required (open access where possible) + 2–4 recommended, each with a one-sentence "why read this" (`r-why`).
9. `References` — `<ol class="references">`, APA style with DOI links. These are aggregated into the site reference list.

Length: 4,000–8,000 words of prose per lesson, plus components. Depth and correctness matter more than length.

### 2.2 Laboratory (`/laboratories/<slug>/index.html` + `main.js`)

Copy `/laboratories/grow-room-lighting/index.html` exactly (the import map must precede module scripts). Structure:

```html
<body data-page="lab" data-slug="<slug>">
<div data-site-header></div>
<main id="main" class="lab-page container">
  <header class="lab-head" data-lab-head><h1>Title from course-data.js</h1><p class="lead">…</p></header>
  <div class="lab-main">
    <div>
      <div class="stage" id="stage"></div>          <!-- 3D canvas, or a 2D canvas/SVG simulator -->
      <div class="readouts" id="readouts"></div>
    </div>
    <aside class="controls" id="controls" aria-label="Laboratory controls"></aside>
  </div>
  <div class="charts"> <div class="chart-card"><h3>…</h3><div class="chart-sub">…</div><div class="chart" id="…"></div></div> … </div>
  <div class="tabs" data-tabs>
    <section data-panel="observe" data-title="Observe" class="prose">…guided tour…</section>
    <section data-panel="explain" data-title="Explain" class="prose">…theory with figures…</section>
    <section data-panel="derive" data-title="Derive" class="prose">…eq-boxes of every model equation…</section>
    <section data-panel="investigate" data-title="Investigate" class="prose">…<ol class="task-list">…</ol> + quiz…</section>
    <section data-panel="sources" data-title="Assumptions &amp; sources" class="prose">…model assumptions + references…</section>
  </div>
</main>
<div data-site-footer></div>
```

Headings inside tab panels use `<h2 data-nonum>`. For 2D labs the `.stage` can host a canvas or an SVG you draw yourself (add class `light-stage` for a light background), or you can replace the stage with a large chart; keep the controls panel on the right.

**Required lab anatomy**
- A genuinely *physical/biological/chemical/economic model* (not a toy): state variables, equations and parameters from the literature, documented in the Derive tab with eq-boxes.
- Controls panel built with `Controls` from `ui.js` (sliders with units and help text, segmented choices, toggles), **presets** (3–5 realistic scenarios) and `ui.saveButton('<slug>', () => ro.values())`. Use `{ url: true }` so settings are shareable links.
- Readouts (`Readouts`) with status colours (`ok`/`warn`/`bad`) against meaningful thresholds.
- 2–4 live charts (`Plot`, `BarChart`, `Sankey`) updated in real time.
- Time-dependent models run with `SimClock` (play/pause, speed) and show simulated time in a HUD chip.
- Investigate tab: 4–6 open investigation tasks (`<ol class="task-list"><li><h4>…</h4><p>…</p></li></ol>`) + a quiz of 4–6 questions that require using the simulator.
- Assumptions & sources tab: honest list of simplifications + 4–8 references.

### 2.3 Other pages (project pages, guides, frontiers)

Use the lesson layout with generic hooks (no lesson automation):

```html
<body data-page="project">   <!-- or data-page="doc" -->
<div data-site-header></div>
<div class="lesson-layout">
  <aside class="lesson-side" data-project-side></aside>      <!-- project pages: auto side-nav of all project pages; other pages: write your own or leave empty -->
  <main id="main">
    <header class="lesson-head"><div class="breadcrumb"><a href="/project/">Course project</a><span>/</span><span>…</span></div>
      <div class="eyebrow" style="margin-top:18px">Project · Part 2</div><h1>…</h1><p class="lead">…</p></header>
    <article class="prose" data-doc-body> <h2 id="…">…</h2> … </article>
  </main>
  <aside class="lesson-toc" data-doc-toc></aside>            <!-- auto "On this page" from the h2s -->
</div>
<div data-site-footer></div>
```
Full-width tools (e.g., data-entry apps) may use `<main id="main" class="container">` instead of the three-column layout.

---

## 3. Laboratory quality — 3D

The 3D laboratories are the signature of the course; they must look **photorealistic and scientifically meaningful**. Use `/assets/js/lab3d.js` (three.js r170). Study `/docs/kit/index.html` (asset gallery: `?scene=plants|water|hardware|structures|field`) and `/laboratories/grow-room-lighting/main.js`.

- Start with `createStage('#stage', { … })`. It gives PBR rendering (ACES tone mapping, environment reflections), ambient occlusion (GTAO), optional bloom, soft shadows, CSS labels, toolbar (reset/screenshot/fullscreen), keyboard orbit, auto quality scaling and pause when off-screen.
- Lighting: `studioLights(stage)` for lab/indoor scenes, `addSky(stage, {elevation, azimuth})` for outdoor scenes (`setSun(el, az)` to animate the sun), or physical fixtures (`makeLEDBar({light:'rect'})`). Keep bloom threshold ≥ 1.0 so only emissive things glow.
- Use the procedural asset library (lettuce varieties at any growth stage, herbs, seedlings, roots, net pots, rock wool, tanks with animated water, rafts, NFT channels, pipes, flow particles, bubbles, mist, fish and fish schools, LED bars, greenhouses with vents/screens/heating pipes, racks, field crops with wind, drones, probes, arrows, heat-map textures, PBR surfaces). Build new models from three.js primitives with PBR materials (`M.*`) where needed — model real equipment faithfully (proportions, materials, details such as bolts, cables, labels, fittings).
- **The 3D scene must be driven by the model**: e.g., plant size follows the growth model, water level/flow/bubbles follow the hydraulics, colours map computed fields (heat-maps), arrows scale with fluxes, fish activity follows oxygen. Use `stage.addLabel(obj, html)` to annotate components and show live values.
- Interactivity: `stage.onPick({objects, onClick, onHover})` to inspect components; `stage.flyTo(pos, target)` for guided camera moves (e.g., "zoom into the root zone"); cut-away views (BackSide walls, clipping planes, transparency).
- Performance: use `InstancedMesh` or merged geometry for repeated plants (see `lettuceGeometry` + instancing in grow-room-lighting); avoid > ~200 k triangles and > ~20 lights; avoid many `transmission` materials (use `M.glassCheap`, `M.waterCheap`); rebuild geometry only when structural parameters change (cache keys), not every frame.
- Time-dependent scenes: advance the model with `SimClock` and animate the scene in `stage.onFrame((dt, t) => …)`.

## 3b. Laboratory quality — 2D

2D labs must be equally rich: custom canvas/SVG visualisations (e.g., an interactive psychrometric chart with draggable states, an animated Sankey, a spatial map with a colormap, a decision tree that highlights the path), plus plot.js charts. Use theme colours (`palette()` from `colors.js`) so they work in light and dark mode. Where students might analyse their **own data** (statistics, model fitting, sensory data, growth logs), provide a paste-CSV box (`parseTable` in `stats.js`) with example data preloaded, and CSV download (`downloadCSV` in `plot.js`).

---

## 4. Component catalogue (lessons and lab tabs)

### 4.1 Mathematics

- Inline maths `\( … \)`, display maths `\[ … \]`. **Never** use `$…$`. Rendered by KaTeX automatically.
- **Never put µ, °, ⁻ or other non-ASCII characters inside maths.** Write `\mu\text{mol}`, `^{\circ}\text{C}`, `\text{m}^{-2}`. (KaTeX cannot render `\text{µmol}`.) Units in running text outside maths can use Unicode (µmol m⁻² s⁻¹).
- Inside quiz JSON strings, backslashes must be doubled: `"\\(E = h\\nu\\)"`.
- Use `\text{…}` for multi-letter subscripts: `E_{\text{ph}}`.

### 4.2 Equation box (mandatory for every important equation)

```html
<div class="eq-box" id="eq-dli">
  <div class="eq-head"><span class="eq-label">Daily light integral</span><span class="eq-num">(4.2.1)</span></div>
  <div class="eq-main">\[ \text{DLI} = \frac{\text{PPFD}\,t\cdot 3600}{10^{6}} \]</div>
  <p class="eq-read">…the equation read aloud in plain words…</p>
  <table class="symbols">
    <tr><th>Symbol</th><th>Meaning</th><th>Unit</th></tr>   <!-- optional 4th column: typical value -->
    <tr><td>\(\text{DLI}\)</td><td>daily light integral</td><td>mol m⁻² d⁻¹</td></tr>
  </table>
  <details><summary>Follow the derivation</summary><ol class="steps"><li>…</li></ol></details>
  <details><summary>Assumptions and validity</summary><p>…</p></details>
  <div class="eq-units">…dimensional analysis showing the units cancel ✓</div>
  <div class="mini-calc" …>…</div>   <!-- live calculator, strongly recommended -->
</div>
```
Equation numbers: `(<lesson code>.<n>)`, e.g., lesson 5.2 → (5.2.1), (5.2.2) … Give each eq-box a unique `id` (it becomes a link in the site-wide equation reference book).

### 4.3 Live calculator (mini-calc) — every formula can become interactive

```html
<div class="mini-calc" data-formula="ppfd*t*3600/1e6" data-output="DLI" data-unit="mol m⁻² d⁻¹" data-digits="1" data-plot="ppfd" data-title="Try it">
  <div data-var="ppfd" data-label="PPFD" data-min="0" data-max="1000" data-step="5" data-value="250" data-unit="µmol m⁻² s⁻¹"></div>
  <div data-var="t" data-label="Photoperiod" data-min="4" data-max="24" data-step="0.5" data-value="16" data-unit="h"></div>
</div>
```
- `data-formula` is a JS expression in the variable names; Math functions are available without prefix (`exp, log, log10, sqrt, pow, abs, sin, cos, tan, atan, min, max, PI, E, …`).
- `data-plot="<var>"` draws the output against that variable (the current point is marked). `data-scale="log"` on a variable gives a logarithmic slider. `data-ymin`/`data-ymax` fix the y axis.
- For formulas too complex for one expression: define `window.FFP_CALC = window.FFP_CALC || {}; FFP_CALC.myFn = v => { … return y; }` in a classic `<script>` **before** the site scripts run (place it in `<head>` after the site scripts; they are deferred) and use `data-fn="myFn"` instead of `data-formula`.

### 4.4 Worked example

```html
<div class="worked-example">
  <div class="we-head"><span class="we-label">Worked example 2</span><span class="we-title">Short title</span></div>
  <div class="we-problem"><p>Problem statement with all data.</p></div>
  <details><summary>Reveal the reasoning</summary><div class="we-solution">
    <ol class="steps"><li><strong>Identify…</strong> …</li><li>…</li></ol>
    <span class="answer">Final answer with units</span>
  </div></details>
</div>
```
Use realistic data, show every unit conversion, end with a sanity check.

### 4.5 Quiz (iterative learning)

```html
<div class="quiz" data-quiz="<slug>-main">
<script type="application/json">
{"title":"…","kicker":"Check your understanding","questions":[
 {"type":"mcq","q":"…","options":["…","…","…","…"],"answer":1,"feedback":["why A is wrong","","why C is wrong","why D is wrong"],"hint":"…","explain":"<p>…</p>"},
 {"type":"multi","q":"…","options":["…","…","…"],"answer":[0,2],"explain":"…"},
 {"type":"numeric","q":"…","answer":14.26,"tol":0.02,"unit":"mol m⁻² d⁻¹","hint":"…","explain":"…"},
 {"type":"tf","q":"…","answer":false,"explain":"…"}
]}
</script>
</div>
```
`tol` is relative (default 0.02); use `abstol` for absolute tolerance or `range:[a,b]`. Options are shuffled (set `"shuffle": false` to keep order, e.g., for "all of the above"). JSON must be valid (double quotes, escaped backslashes, no trailing commas). Quiz ids must be unique site-wide: prefix with the page slug.

### 4.6 Callouts

```html
<div class="callout key"><div class="callout-title">Key idea</div><p>…</p></div>
```
Types: `key` (green), `note` (blue), `warn` (amber), `danger` (red), `history` (grey), `frontier` (magenta: research frontier / emerging technology 2024–2026), `misconception` (dashed red border, title "Common misconception").

### 4.7 Figures

- Inline SVG diagrams: `<figure class="figure"><div class="fig-body"><svg class="dg" viewBox="…" role="img" aria-label="…">…</svg></div><figcaption><b>Figure n.</b> …</figcaption></figure>`. Inside `.dg` use classes for theme-aware colours: text `t-muted t-small t-mono`; fills `fill-bg fill-sunk fill-accent fill-accent-soft fill-water fill-water-soft fill-magenta fill-magenta-soft fill-amber fill-amber-soft`; strokes `stroke stroke-muted stroke-accent stroke-water stroke-magenta stroke-amber stroke-danger` (set `stroke-width` as attribute). `currentColor` also works. Draw carefully: diagrams must be correct, labelled and legible (font ≥ 11 px), with arrows (`<marker>`) where flows are shown.
- Interactive figures: a `<figure class="figure">` with a container div and a `<script type="module">` at the end of the page importing `/assets/js/plot.js`, `/assets/js/physics.js` etc. (see Figures 2 and 3 of the model lesson).
- Web images: only from Wikimedia Commons (or NASA/ESA/USDA public domain) via `https://commons.wikimedia.org/wiki/Special:FilePath/<File_name.ext>?width=1200`, with a credit line (author, licence) in `<span class="credit">`. **Verify every image URL loads** (the test harness reports HTTP 404s). A broken image is replaced by a link, but avoid them.
- `class="figure wide"` makes a figure break out of the text column on wide screens. `.fig-row` places several figures side by side.

### 4.8 Other components

- Lab link card: `<a class="lab-link" data-lab="<lab-slug>" data-why="What the student will do there"></a>` (auto-filled).
- Tables: plain `<table>` with `<caption>`; numeric cells `class="num"`. They are wrapped for horizontal scroll automatically.
- Key terms: `<dl class="key-terms"><dt>Term</dt><dd>Definition.</dd>…</dl>`.
- Readings: `<ul class="reading-list"><li><span class="r-type">Required · open access</span>APA reference with DOI link<span class="r-why">Why/what to read.</span></li></ul>`.
- References: `<ol class="references"><li>APA reference with <a href="https://doi.org/…">doi:…</a></li></ol>`.
- Timeline: `<div class="timeline"><div><div class="t-date">2015</div><p>…</p></div>…</div>`.
- Key–value list: `<dl class="kv"><dt>…</dt><dd>…</dd></dl>`.
- Check list: `<ul class="check-list"><li>I can …</li></ul>` (checkboxes added automatically, saved per student).

---

## 5. JavaScript library reference (ES modules, import with absolute paths)

### `/assets/js/plot.js`
- `new Plot(el, { x:{label,unit,min,max,log,format}, y:{…}, y2:{…}, legend:true, crosshair:true, height })`
  - `.line(id, xs, ys, {color,width,dash,label,fill,y2,step})` or `.line(id, [[x,y],…], opts)`
  - `.scatter(id, xs, ys, {color,r,label,shape:'circle'|'square'|'triangle'|'diamond',yErr,colors,hollow})`
  - `.band(id, xs, lo, hi, {color,alpha,label})`, `.vline(id,x,{label,color,dash})`, `.hline(id,y,…)`, `.region(id,x0,x1,…)`, `.hregion(id,y0,y1,…)`, `.point(id,x,y,{label,r,guides})`, `.text(id,x,y,'txt',{align,dx,dy})`, `.heatmap(id,{z,x0,x1,y0,y1,colormap,min,max})`, `.custom(id,(ctx,plot,palette)=>…)` with `plot.px(x)`, `plot.py(y)`, `plot.xFromPx(px)`, `plot.plotRect`.
  - `.remove(id)`, `.clear()`, `.setAxis('x',{min,max})`, `.on('pointerdown'|'pointermove'|'pointerup'|'click', e => e.x, e.y, e.inside)` for draggable interactions.
  - Colours: palette keys `'accent'|'water'|'magenta'|'amber'|'danger'|'ink'|'muted'`, categorical `'c0'…'c7'`, integers, or any CSS colour.
- `new BarChart(el, { y:{label,unit,min}, horizontal, stacked, height }).set(categories, [{label, values, color, colors}])`, `.refLine(v,label)`.
- `new Sankey(el, { unit, height, digits, gap, flow: true, flowSpeed: 45 }).set({ nodes:[{id,label,color,col?}], links:[{source,target,value,color?}] })`. Bands are filled ribbons of constant thickness; labels get a halo, are relaxed per column so neighbours never overlap (with a leader line when moved) and stay inside the chart; `flow: true` animates particles along every band (paused off-screen and under reduced motion).
- `linspace(a,b,n)`, `downloadCSV(name, headers, rows)`, `colorbar(el,{colormap,min,max,label,unit})`, `niceTicks`.

### `/assets/js/ui.js`
- `new Controls('#controls', {url:true})`: `.section(title)`, `.slider({id,label,min,max,step,value,unit,help,log,digits,format})`, `.number(…)`, `.select({id,label,options:[{value,label}],value})`, `.toggle({id,label,value})`, `.segmented({id,label,options,value})`, `.button({label,onClick,variant:'primary'})`, `.buttons([...])`, `.presets([{label,values:{…}}])` (values are re-asserted after the change handlers run, so key order no longer matters), `.html(str)`, `.saveButton(slug, () => results)`, `.onChange(state => …)`, `.get(id)`, `.set(id,v)`, `.setMany({…})`, `.setRange(id,{min,max,step})` (sliders), `.values()`, `.enable(id,bool)`, `.show(id,bool)`. Every control's input has the id `c-<id>`.
- `new Readouts('#readouts').add({id,label,unit,digits,note,format}).set(id, value, 'ok'|'warn'|'bad'|null, noteHtml)`.
- `new SimClock({ speed, maxDt, onStep:(dt,t)=>…, onFrame:t=>… })` `.play() .pause() .toggle() .reset() .speed` — simulation seconds per real second; `maxDt` sub-steps integration.
- `fmt(v, digits)`, `fmtTime(seconds)`, `hudChips(stageEl).set(id, html)`, `stageToolbar(stageEl, {onReset,onShot,extra})` (for 2D stages).

### `/assets/js/stats.js`
`mean, sd, variance, se, median, quantile, describe, histogram, qqData, normPdf/Cdf/Inv, tPdf/tCdf/tInv, fCdf/fInv, chi2Cdf/chi2Inv, binomPmf/binomCdf/binomUpper/binomCritical, ptukey/qtukey, tTestOne/tTestPaired/tTestWelch/tTestPooled, anova1, tukeyHSD, anovaRCBD, leveneBF, binomTest, chiSquareTest, pearson, spearman, linreg (with ciMean, piObs), ols, fitLM (Levenberg–Marquardt → params, se, r2, rmse, aic, aicc, bic, converged, stalled, atBound, status, predict), aic/aicc/bic (all count the error variance, k + 1), crossValidate (random k-fold, `{k, mode:'ordered'}` for time series, `{groups}` for leave-one-group-out; returns rmse, mse, foldRmse), powerTwoSample, sampleSizeTwoSample, powerAnova, cronbachAlpha, movingAverage, ema, classificationMetrics, mulberry32 (seeded RNG), randn, shuffle, randInt, parseTable (paste CSV/TSV)`.

### `/assets/js/physics.js`
Constants `h, c, NA, kB, R, F, SIGMA, G0, P0, CP_AIR, CP_WATER, K0`; helpers `clamp, lerp, smoothstep, deg, rad`; light `photonEnergy, umolPerJoule, dli, ppfdForDli, SUN_PPFD_PER_WM2, mcCree, ledSpectrum, planck, pointIrradiance, canopyInterception`; psychrometrics `svp, svpSlope, vapourPressure, vpd, rhFromVp, dewPoint, humidityRatio, vpFromW, enthalpy, absoluteHumidity, airDensity, latentHeat, psychroConst, pressureAtElevation, wetBulb`; solar `dayOfYear, declination, earthSunFactor, sunsetHourAngle, dayLength, solarElevation, solarAzimuth, extraterrestrialRadiation, clearSkyRadiation, clearSkyIrradiance`; ET `et0PenmanMonteith, et0Hargreaves`; water chemistry `nh3Fraction, doSaturation, nernstSlope, electrodeMV, ec25, ecFromCations, phosphateSpecies, carbonateSpecies`; sensors `steinhartHart, thermistorR, beerLambert`; biology `nonRectHyperbola, q10, arrheniusPeaked, michaelisMenten, monod, logistic, gompertz`; numerics `rk4, integrate, noise1D, fbm1D`. Read the file for units and sources — reuse these rather than re-implementing, so that lessons and labs agree.

### `/assets/js/colors.js`
`palette()` (theme colours), `categorical(i)`, `resolveColor`, `colormap(name,t)` → [r,g,b], `colormapCSS`, `colormapGradient(name)`, `wavelengthToRGB(nm)`, `wavelengthCSS(nm,a)`, `withAlpha`. Colormaps: `viridis inferno magma turbo rdylgn rdbu ndvi blues greens thermal water`.

### `/assets/js/lab3d.js` (three.js r170; also re-exports `THREE`, `OrbitControls`, `CSS2DObject`, `BufferGeometryUtils`, `RoundedBoxGeometry`)
- Stage: `createStage(el, opts)` → `{scene, camera, renderer, controls, onFrame, addLabel, onPick, pickAt, flyTo, resetView, setHome, screenshot, setPaused, onKey('space', fn), quality, setQuality}`; lighting `studioLights(stage, {intensity, shadowSize})`, `addSky(stage, {elevation, azimuth}) → {sun, setSun}`, `fitShadow(light, size, target)`.
- Surfaces/materials: `surfaceMaterial(type, repeat)` (`soil tilled grass concrete epoxy gravel rockwool coir foam sand`), `M.aluminium() anodised() steel() galvanised() paintedSteel(c) plasticWhite() plasticBlack() plasticGrey() plastic(color, rough) pvc() rubber() copper() brass() glass() glassCheap(opacity) acrylic() water(tint) waterCheap(tint, opacity) foam() rockwool() coir() soil() concrete() epoxy() root() emissive(color, intensity) fabric(color, opacity)`, `canvasTexture(w,h,paint)`, `surfaceTextures(...)`, `noise2, fbm2, rng`.
- Structures: `makeGround({size,type})`, `makeRoom({w,d,h,wallColor,floor,ceiling})`, `makeBeam(a,b)`, `makePipe(points,{radius,material})` (has `.curve`), `makeGreenhouse({spans,spanWidth,length,gutterHeight,roofAngle,bays})` (`.setVents(f)`, `.setScreen(f)`, `.bounds`), `makeRack({levels,width,depth,levelHeight,ledColor})` (`.shelves`, `.lights`).
- Lighting fixtures: `makeLEDBar({length,width,color:'full'|'redblue'|'white'|'magenta'|[...], light:false|'rect'|'spot', lightIntensity})` (`.setIntensity(f)`).
- Plants: `makeLettuce({radius, growth 0–1, variety:'butterhead'|'green'|'red'|'oakleaf'|'romaine', seed})`, `lettuceGeometry(opts)` + `leafMaterial()` for instancing, `leafGeometry(opts)`, `makeHerb()`, `makeSeedling()`, `makeRoots({count,length,spread,style:'hanging'|'mat'})`, `makeNetPot()`, `makeRockwoolCube()`, `makeFieldCrop({width,depth,rowSpacing,plantSpacing,height,heightFn,colorFn})` (`.update(t)` wind, `.recolor(fn)`).
- Water: `makeTank({w,h,d,material:'plastic'|'glass'|'acrylic',level,waterTint})` (`.setLevel(f)`, `.update(t)`, `.inner`, `.levelY`), `makeRaft({w,d,nx,nz})` (`.holes`), `makeNFTChannel({length,width,holes})` (`.holes`, `.setFilm(depth)`, `.update(t)`), `new Bubbles({emitters,top,rate})` (`.mesh`, `.update(dt)`, `.setRate`), `new Mist({nozzles,rate,speed,size})` (`.points`, `.on`, `.update(dt)`), `new FlowAlong(curve,{count,speed,color})` (`.points`, `.speed`, `.update(dt)`).
- Animals & machines: `makeFish({length,color})` (`.swim(t)`), `new FishSchool(parent,{count,bounds,speed})` (`.activity`, `.update(dt,t)`), `makeDrone()` (`.update(dt)`), `makeProbe({cap})`, `makeArrow({from,to,color,thickness})` (`.set(from,to,thickness)`), `makeTextSprite(text)`, `heatmapTexture(values2D,{colormap,min,max})`, `grid(nx,nz,dx,dz,fn)`, `disposeDeep(obj)`.

### `/assets/js/practice/helpers.js` (for practice generators)
`rand(rng,a,b,step)`, `randInt`, `pick`, `shuffle`, `f(v, sig)`, `steps(...html)`, `mcq(rng, q, correct, wrongArray, solution)`.

---

### Gotchas collected from authors (September 2026)

- **Maths:** write `&lt;` for a less-than sign inside `\( \)`/`\[ \]` (a raw `<` followed by a letter is parsed as an HTML tag: the equation stays unrendered and later headings can vanish from the table of contents). Keep €, µ, ° and other non-ASCII characters outside maths. KaTeX 0.16 rejects a superscript directly after a thin space: write `25\,{}^{\circ}\text{C}`, not `25\,^{\circ}\text{C}`.
- **Duplicate ids:** inline SVG `<marker>`/`<linearGradient>` ids must be unique on the page — when a script draws several figures, suffix the id with the figure's id.
- **Light 2D stages:** give the stage the class `light-stage`; HUD chips, legends, toolbar buttons and the hint then follow the page theme automatically.
- **Tables:** in a 3-column `table.symbols` the last column wraps normally (only a middle "unit" column is kept on one line).
- **3D materials:** toggling `material.transparent` after the first render needs `material.needsUpdate = true`.
- **3D performance:** `lettuceGeometry({ …, detail: 0.5 })` cuts triangles to about a quarter — use 0.4–0.6 when hundreds of heads are instanced. `addSky(...).setSun()` may be called every frame; the environment map refreshes at most every 0.4 s.
- **Bar charts:** `refLines([{ v, label, inRange: false }])` keeps a far-off reference from squashing the bars (it is drawn as an edge marker with its value); long category names in horizontal charts wrap onto two lines; the y-axis margin grows with long tick labels; legends of series with per-bar `colors` show a striped swatch.
- **Layout helpers:** `.scroll-x` wraps a wide SVG/canvas that should scroll sideways on phones; `.full-card` (or `.full`) spans the whole `.charts` grid; `hudChips(stage, { layout: 'row' })` puts chips side by side.
- **Statistics speed:** `normCdf` uses Hart's double-precision algorithm and `qtukey` a bracketed Illinois search (~10 ms per call), so live Tukey letters no longer need debouncing. `parseTable` understands quoted CSV fields ("yellow, tipburn") and escaped quotes.
- **Axes and controls:** `new Plot(el, { y: { reverse: true } })` plots downwards (soil-water depletion); log axes over narrow ranges get 1–9 sub-ticks; `ui.setOptions(id, [{value,label}], value)` replaces a select's options.
- **Practice generators:** use `f()` for numbers in running text and `fm()` for numbers placed inside `\( \)` (no thousands separators; LaTeX scientific notation).
- **Mini-calcs:** variables may be named like Math functions/constants (`E`, `PI`, `exp`) — the clashing Math names are dropped automatically. `<sub>`/`<sup>` in labels are converted to Unicode sub/superscripts on the chart axes where possible.
- **Readouts:** `ro.set(id, value, status, note)` now always shows the note (a note element is created on demand).
- **Plots:** `vline` labels accept `{ labelAlign: 'right', labelY: 'bottom', labelDy: 14 }` to avoid collisions; legends that wrap shrink the plot automatically inside fixed-height `.chart` containers; `custom` layers are clipped to the plot area unless you pass `{ noClip: true }`; Sankey nodes without any positive link are omitted; BarChart reference-line labels have a background so tall bars cannot hide them.
- **Statistics:** `tukeyRCBD(m, names)` gives Tukey HSD after a randomised-block ANOVA (e.g., panellists as blocks).
- **Physics:** `clearSkyIrradiance` uses the Haurwitz model (as in pvlib); `carbonateSpecies(pH, T)` and `carbonatePK(T)` are temperature-dependent (Plummer & Busenberg 1982).
- **SVG diagrams:** `.dg text` sets a font size on every `<text>`, so put `t-small`/`t-muted`/`t-mono` on the `<text>` elements (classes on a `<g>` are also honoured now).
- **Tables:** lesson-local table styles need `.prose table.my-class` selectors to beat the default `.prose table:not(.symbols)` rule.
- **3D labels:** CSS2DRenderer rewrites each label's `style.display` every frame — hide labels with `label.visible = false`.
- **3D lighting:** call `ensureRectAreaLights()` before creating your own `THREE.RectAreaLight` (`makeLEDBar({light:'rect'})` does it for you). `addSky` raises the bloom threshold to ≥ 2.4 automatically so the HDR sky does not bloom.
- **3D camera:** the default `maxPolarAngle` (0.495π) stops the camera going below the horizon; interiors where students must look up can pass `controls: { maxPolarAngle: Math.PI * 0.95 }` and clamp the camera height themselves.
- **Screenshots:** headless full-page screenshots taller than ≈ 16,000 px repeat tiles — take element screenshots or scrolled viewports for long pages.

## 6. Practice generators (one file per module)

`/assets/js/practice/<module-slug>.js` — randomised, auto-marked problems for iterative mastery (the Practice page draws from these, tracks mastery per generator and schedules review):

```js
import { rand, randInt, pick, f, steps, mcq } from './helpers.js';
export default [
  {
    id: 'light-dli-from-ppfd',            // unique, prefixed by topic
    title: 'DLI from PPFD and photoperiod',
    lesson: 'daily-light-integral',       // lesson slug this practises
    difficulty: 1,                        // 1 recall/plug-in, 2 multi-step, 3 synthesis
    gen(rng) {
      const ppfd = rand(rng, 120, 400, 10), t = rand(rng, 12, 20, 1);
      const dli = ppfd * t * 3600 / 1e6;
      return {
        q: `An LED array gives a constant PPFD of ${ppfd} µmol m⁻² s⁻¹ for ${t} h per day. What is the DLI?`,
        answer: dli, tol: 0.02, unit: 'mol m⁻² d⁻¹',
        solution: steps(`\\(\\text{DLI} = \\text{PPFD}\\cdot t\\cdot 3600/10^6\\)`, `\\(= ${ppfd}\\times${t}\\times3600/10^6 = ${f(dli)}\\)`)
      };
    }
  },
  // … at least 10 generators per module, covering every lesson, difficulties 1–3, mostly numeric
];
```

---

## 7. Testing (mandatory)

A headless-Chrome test harness is available. Run from any directory:

```powershell
$T = '<folder with the QA scripts (check.mjs, content-qa.mjs, monkey.mjs, …); kept outside the repository>'
node "$T\check.mjs" "$T\out-<yourname>" /laboratories/<slug>/ /lessons/<slug>/ --wait=8000 --stage
# flags: --full (full-page screenshot), --stage (screenshot of .stage), --wait=ms, --dark, --click=<css selector>, --w=1400 --h=900
node "$T\eval.mjs" "/laboratories/<slug>/" "JSON.stringify(window.__stages?.length)" 6000   # evaluate JS in the page
```

It serves the project on a random port, loads each page, prints console errors, page errors and HTTP 404s, and writes screenshots (PNG) that you should **look at with the Read tool** to check the visual result (3D realism, layout, charts). Tall full-page screenshots can be cropped with Python/PIL:
`python -c "from PIL import Image; im=Image.open(r'<png>'); im.crop((0,0,1400,1800)).save(r'<out.png>')"`.

Requirements before you finish: **0 page errors and 0 console errors** (warnings about fonts or GPU are ignored), no 404s, KaTeX renders (no raw `\(` visible), quizzes parse, charts draw, 3D scene looks realistic. Headless rendering uses a software GPU, so it is slow; 3D frame rate there is not representative.

---

## 8. Final report

End with a short report: files created, a one-line description of each model/lesson, test status, and any problems with shared files (bugs, missing helpers) that the lead author should fix.
