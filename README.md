# Future Food Production

An open, laboratory-driven university course (first-cycle, environmental engineering, 7.5 ECTS) on the technologies shaping the future of food production: controlled environment agriculture (hydroponics, aquaponics, aeroponics, vertical farming), light and climate engineering, sensors, IoT and artificial intelligence, precision agriculture and remote sensing, alternative proteins, consumer acceptance and sensory science, EU novel-food regulation, and the assessment of sustainability, resilience and accessibility.

- **15 modules · 61 lessons · 60 interactive laboratories** (3D and 2D simulators, each with Observe / Explain / Derive / Investigate / Sources tabs)
- Every equation with derivation, symbol table, unit check and live calculator
- Quizzes with feedback, a randomised practice engine (477 problem generators) with spaced repetition, readings and references
- A course project: grow, monitor and evaluate your own soilless system and run a sensory study of a novel food — with a grow-log tool, a sensory-study designer, analysis guides and a report rubric
- Frontiers radar of emerging technologies, study guide, teacher's guide, accessibility statement

## Structure

```
index.html                  landing page (3D hero)
course/                     syllabus, learning outcomes, schedule, examination
lessons/<slug>/             61 lessons (slugs in assets/js/course-data.js)
laboratories/<slug>/        60 laboratories (index.html + main.js + model/scene modules)
practice/                   randomised problems (generators in assets/js/practice/<module>.js)
project/                    course project guide and tools (grow log, sensory designer, analysis, report)
frontiers/                  technology radar (reviewed each term)
study-guide/ about/ accessibility/ teaching/   guides for students and teachers
equations/ glossary/ references/   site-wide indexes built live from the lesson and lab pages
progress/ notebook/         personal progress and notes (stored only in the browser)
assets/css/main.css         design system (light/dark, WCAG AA colours)
assets/js/                  course-data.js (registry), site.js (runtime), plot.js, ui.js,
                            stats.js, physics.js, colors.js, lab3d.js (three.js kit), …
assets/img/labs/            catalogue thumbnails (rendered from the laboratories)
docs/                       authoring guide and 3D asset gallery (not deployed)
```

## Run locally

It is a static site with no build step. Serve the folder over HTTP (ES modules do not work from `file://`):

```bash
python -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>.

## Deploy (GitHub → Vercel)

**In the browser** (no git needed). GitHub's web uploader takes at most 100 files per upload (25 MB per file), so the site is uploaded in five packs of fewer than 100 files each (see "UPLOAD INSTRUCTIONS.txt" next to the packs):
1. On github.com create a new, empty repository (no README, no licence).
2. On the empty repository page click *uploading an existing file*. Open the first pack in File Explorer, select everything **inside** it (Ctrl+A) and drag it onto the page. Wait until all files are listed, then *Commit changes*.
3. Repeat for the other packs with *Add file → Upload files*. The repository root must show `index.html`, `assets/`, `lessons/`, `laboratories/` … directly (not the pack folder names).
4. In Vercel: *Add New… → Project → Import* the repository. Framework preset **Other**, no build command, output directory left as the root.

**With git on the command line:**
```bash
git init -b main && git add . && git commit -m "Future Food Production course"
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

Every push to `main` redeploys automatically. `vercel.json` enables clean URLs, trailing slashes, caching and security headers; `.vercelignore` keeps `docs/` out of production.

## Authoring

See `docs/AUTHORING.md` for templates, components (equation boxes, live calculators, worked examples, quizzes), the JavaScript libraries, gotchas collected from the authors and the testing procedure. Course structure (modules, lessons, labs, learning outcomes, schedule) lives in `assets/js/course-data.js`.

## Credits

Course design and development: Jan Skvaril. Built with three.js and KaTeX (loaded from jsDelivr). Models are simplified for teaching; values labelled "illustrative" or "assumption" in the laboratories are not measurements. Content is provided without warranty of accuracy or completeness.
