/* ==========================================================================
   Future Food Production — site runtime (classic script, loaded with defer)
   Header/footer, search, notebook, progress, lesson scaffolding, KaTeX,
   equation boxes, live mini-calculators, quizzes, tabs and task lists.
   ========================================================================== */
(function () {
  'use strict';
  const C = window.FFP_COURSE;
  const FFP = window.FFP = window.FFP || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  FFP.$ = $; FFP.$$ = $$; FFP.esc = esc;

  /* ---------------------------------------------------------------- icons */
  const I = {
    logo: '<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="bm-g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#1d7a4a"/><stop offset="1" stop-color="#6fd39a"/></linearGradient></defs><rect x="1" y="1" width="30" height="30" rx="9" fill="url(#bm-g)"/><path d="M16 25V14" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M16 17c-4.5 0-7-2.6-7-7 4.4 0 7 2.5 7 7Z" fill="#fff"/><path d="M16 15c0-4.6 2.8-7.5 8-7.5 0 4.9-3 7.5-8 7.5Z" fill="#fff" opacity=".85"/><circle cx="23.5" cy="23.5" r="2.2" fill="#f07ad0"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h11l3 3v15H5z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    progress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17 19 7"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z"/></svg>',
    // module icons
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z"/></svg>',
    leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15"/><path d="M5 19 14 10"/></svg>',
    flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/></svg>',
    droplet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10 12 3 12 3Z"/></svg>',
    fish: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 12c3-4 7-6 11-6s6 3 7 6c-1 3-3 6-7 6s-8-2-11-6Z"/><path d="M3 12 1 8M3 12l-2 4"/><circle cx="16.5" cy="11" r="1" fill="currentColor"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 4.5 9-4.5"/></svg>',
    thermo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0Z"/><path d="M12 9v7"/></svg>',
    sensor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="8" y="8" width="8" height="8" rx="2"/><path d="M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13M8.3 3M3 12h1M20 12h1"/></svg>',
    chip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/><path d="M10 10h4v4h-4z"/></svg>',
    satellite: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m9 9 6 6M7 11l6 6-2 2-6-6zM11 7l6 6 2-2-6-6z"/><path d="M4 20a6 6 0 0 1 0-6M16 3l5 5"/></svg>',
    protein: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="6" cy="7" r="2.5"/><circle cx="17" cy="6" r="2.5"/><circle cx="12" cy="17" r="2.5"/><path d="M8.3 8.2 10.6 15M14.6 7l-1.8 7.6M8.5 7h6"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.2c3 .2 5 2.3 5 5.3"/></svg>',
    scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7ZM19 7l-3 7a3 3 0 0 0 6 0l-3-7Z"/></svg>',
    compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/></svg>'
  };
  FFP.icons = I;

  /* ------------------------------------------------------------ storage */
  const KEY = 'ffp-progress-v1';
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  let state = load();
  ['studied', 'labs', 'quizzes', 'tasks', 'notes', 'practice', 'checks', 'snapshots'].forEach(k => { state[k] = state[k] || {}; });
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ } }
  FFP.store = {
    raw: () => state,
    save,
    isStudied: slug => !!state.studied[slug],
    setStudied(slug, on) { if (on) state.studied[slug] = Date.now(); else delete state.studied[slug]; save(); document.dispatchEvent(new CustomEvent('ffp:progress')); },
    labVisit(slug) { const l = state.labs[slug] = state.labs[slug] || { visits: 0 }; l.visits++; l.last = Date.now(); save(); },
    labDone: slug => !!(state.labs[slug] && state.labs[slug].done),
    setLabDone(slug, on) { const l = state.labs[slug] = state.labs[slug] || { visits: 0 }; l.done = on ? Date.now() : 0; save(); document.dispatchEvent(new CustomEvent('ffp:progress')); },
    quiz(id) { return state.quizzes[id]; },
    setQuiz(id, rec) { state.quizzes[id] = Object.assign(state.quizzes[id] || {}, rec); save(); },
    task(key) { return !!state.tasks[key]; },
    setTask(key, on) { if (on) state.tasks[key] = Date.now(); else delete state.tasks[key]; save(); },
    check(key) { return !!state.checks[key]; },
    setCheck(key, on) { if (on) state.checks[key] = 1; else delete state.checks[key]; save(); },
    note(path) { return (state.notes[path] && state.notes[path].text) || ''; },
    setNote(path, text, title) { if (text && text.trim()) state.notes[path] = { text, title: title || document.title, t: Date.now() }; else delete state.notes[path]; save(); },
    practice: () => state.practice,
    savePractice() { save(); },
    snapshots: () => state.snapshots,
    addSnapshot(slug, snap) { (state.snapshots[slug] = state.snapshots[slug] || []).push(Object.assign({ t: Date.now() }, snap)); save(); },
    exportJSON: () => JSON.stringify(state, null, 2),
    importJSON(text) { const s = JSON.parse(text); state = Object.assign(state, s); save(); },
    reset() { state = { studied: {}, labs: {}, quizzes: {}, tasks: {}, notes: {}, practice: {}, checks: {}, snapshots: {} }; save(); }
  };

  /* ------------------------------------------------------------- theme */
  function currentTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  FFP.theme = currentTheme;
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('ffp-theme', t); } catch (e) { }
    const b = $('#theme-toggle'); if (b) b.innerHTML = t === 'dark' ? I.sun : I.moon;
    document.dispatchEvent(new CustomEvent('ffp:theme', { detail: t }));
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!document.documentElement.getAttribute('data-theme')) document.dispatchEvent(new CustomEvent('ffp:theme', { detail: currentTheme() }));
  });

  /* ------------------------------------------------------------ toast */
  let toastT;
  FFP.toast = function (msg) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
  };

  /* ------------------------------------------------------ header/footer */
  function buildHeader() {
    const host = $('[data-site-header]');
    if (!host) return;
    const path = location.pathname;
    const nav = [
      ['Course', '/course/'], ['Laboratories', '/laboratories/'], ['Practice', '/practice/'],
      ['Project', '/project/'], ['Frontiers', '/frontiers/']
    ];
    const page = document.body.dataset.page || '';
    const isCur = href => path.startsWith(href) || (href === '/course/' && (page === 'lesson')) || (href === '/laboratories/' && page === 'lab');
    host.outerHTML = `
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="container">
        <a class="brand" href="/" aria-label="Future Food Production — home"><span class="brand-name">Future Food Production</span></a>
        <nav class="main-nav" id="main-nav" aria-label="Main">
          ${nav.map(([t, h]) => `<a href="${h}"${isCur(h) ? ' aria-current="page"' : ''}>${t}</a>`).join('')}
        </nav>
        <div class="header-tools">
          <button class="search-trigger" id="search-open" type="button" aria-label="Search the course">${I.search}<span>Search the course</span><kbd>/</kbd></button>
          <button class="icon-btn" id="notebook-open" type="button" title="Notebook (notes for this page)" aria-label="Open notebook">${I.note}</button>
          <a class="icon-btn" href="/progress/" title="Your progress" aria-label="Your progress">${I.progress}</a>
          <button class="icon-btn" id="theme-toggle" type="button" title="Toggle light/dark" aria-label="Toggle colour theme">${currentTheme() === 'dark' ? I.sun : I.moon}</button>
          <button class="icon-btn menu-toggle" id="menu-toggle" type="button" aria-label="Menu" aria-controls="main-nav" aria-expanded="false">${I.menu}</button>
        </div>
      </div>
    </header>`;
    $('#theme-toggle').addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
    $('#menu-toggle').addEventListener('click', e => {
      const n = $('#main-nav'); n.classList.toggle('open');
      e.currentTarget.setAttribute('aria-expanded', n.classList.contains('open'));
    });
    $('#search-open').addEventListener('click', openPalette);
    $('#notebook-open').addEventListener('click', openNotebook);
  }

  function buildFooter() {
    const host = $('[data-site-footer]');
    if (!host) return;
    const year = new Date().getFullYear();
    host.outerHTML = `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div>
            <a class="brand" href="/"><span class="brand-name">Future Food Production</span></a>
            <p style="margin-top:14px;max-width:360px">An open, laboratory-driven course on the technologies shaping how humanity will feed itself within the planetary boundaries.</p>
          </div>
          <div><h4>Learn</h4><ul>
            <li><a href="/course/">Course &amp; syllabus</a></li>
            <li><a href="/laboratories/">Laboratories</a></li>
            <li><a href="/practice/">Practice &amp; mastery</a></li>
            <li><a href="/project/">Course project</a></li>
            <li><a href="/frontiers/">Frontiers radar</a></li></ul></div>
          <div><h4>Reference</h4><ul>
            <li><a href="/study-guide/">Study guide</a></li>
            <li><a href="/equations/">Equation reference book</a></li>
            <li><a href="/glossary/">Glossary</a></li>
            <li><a href="/references/">References &amp; readings</a></li>
            <li><a href="/about/">Sources &amp; model assumptions</a></li>
            <li><a href="/teaching/">For teachers</a></li></ul></div>
          <div><h4>You</h4><ul>
            <li><a href="/progress/">Your progress</a></li>
            <li><a href="/notebook/">Your notebook</a></li>
            <li><a href="/accessibility/">Accessibility</a></li></ul></div>
        </div>
        <div class="footer-note">
          <span>© ${year} ${esc(C ? C.author : '')}. Developed for educational purposes. Models are simplified; content is provided without warranty of accuracy or completeness.</span>
          <span>Press <kbd>/</kbd> to search · <kbd>N</kbd> for notebook</span>
        </div>
      </div>
    </footer>`;
  }

  /* ------------------------------------------------------ search palette */
  let palette, paletteItems = [], palSel = 0;
  function searchIndex() {
    if (!C) return [];
    const out = [];
    C.modules.forEach(m => {
      out.push({ t: `Module ${m.n}: ${m.title}`, s: m.tagline, u: `/course/#module-${m.slug}`, k: 'Module' });
      m.lessons.forEach(l => out.push({ t: l.title, s: l.summary, u: l.url, k: 'Lesson ' + l.code }));
    });
    C.labs.forEach(l => out.push({ t: l.title, s: l.summary, u: l.url, k: 'Lab · ' + l.kind }));
    C.project.pages.forEach(p => out.push({ t: p.title, s: 'Course project', u: '/project/' + (p.slug ? p.slug + '/' : ''), k: 'Project' }));
    [['Equation reference book', '/equations/'], ['Glossary', '/glossary/'], ['References & readings', '/references/'], ['Study guide', '/study-guide/'], ['Practice & mastery', '/practice/'], ['Frontiers radar', '/frontiers/'], ['For teachers', '/teaching/'], ['Accessibility', '/accessibility/'], ['Sources & model assumptions', '/about/'], ['Your progress', '/progress/'], ['Your notebook', '/notebook/']]
      .forEach(([t, u]) => out.push({ t, s: '', u, k: 'Page' }));
    return out;
  }
  function openPalette() {
    if (!palette) {
      palette = document.createElement('div');
      palette.className = 'palette'; palette.setAttribute('role', 'dialog'); palette.setAttribute('aria-label', 'Search');
      palette.innerHTML = '<input type="text" placeholder="Search lessons, laboratories, topics…" aria-label="Search"><ul role="listbox"></ul>';
      document.body.appendChild(palette);
      const inp = $('input', palette);
      inp.addEventListener('input', () => renderPalette(inp.value));
      inp.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { palSel = Math.min(palSel + 1, paletteItems.length - 1); highlight(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { palSel = Math.max(palSel - 1, 0); highlight(); e.preventDefault(); }
        else if (e.key === 'Enter') { const it = paletteItems[palSel]; if (it) location.href = it.u; }
        else if (e.key === 'Escape') closePalette();
      });
    }
    scrim(true, closePalette);
    palette.classList.add('open');
    const inp = $('input', palette); inp.value = ''; renderPalette(''); setTimeout(() => inp.focus(), 10);
  }
  function closePalette() { if (palette) palette.classList.remove('open'); scrim(false); }
  function renderPalette(q) {
    const idx = searchIndex();
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    paletteItems = (words.length ? idx.filter(it => { const h = (it.t + ' ' + it.s + ' ' + it.k).toLowerCase(); return words.every(w => h.includes(w)); }) : idx.filter(i => i.k.startsWith('Module') || i.k === 'Page')).slice(0, 40);
    palSel = 0;
    $('ul', palette).innerHTML = paletteItems.length ? paletteItems.map((it, i) => `<li${i === 0 ? ' class="sel"' : ''}><a href="${it.u}"><span><b>${esc(it.t)}</b>${it.s ? `<span class="p-sum">${esc(it.s.slice(0, 120))}${it.s.length > 120 ? '…' : ''}</span>` : ''}</span><small>${esc(it.k)}</small></a></li>`).join('') : '<li style="padding:14px;color:var(--muted)">No matches.</li>';
  }
  function highlight() { $$('li', palette).forEach((li, i) => li.classList.toggle('sel', i === palSel)); const s = $$('li', palette)[palSel]; if (s) s.scrollIntoView({ block: 'nearest' }); }

  let scrimEl, scrimCb;
  function scrim(on, cb) {
    if (!scrimEl) { scrimEl = document.createElement('div'); scrimEl.className = 'scrim'; document.body.appendChild(scrimEl); scrimEl.addEventListener('click', () => scrimCb && scrimCb()); }
    scrimEl.classList.toggle('show', on); scrimCb = on ? cb : null;
  }

  /* ------------------------------------------------------------ notebook */
  let drawer;
  function openNotebook() {
    if (!drawer) {
      drawer = document.createElement('aside');
      drawer.className = 'drawer'; drawer.setAttribute('aria-label', 'Notebook');
      drawer.innerHTML = `<div class="drawer-head"><h3>Notebook</h3><button class="icon-btn" aria-label="Close notebook">${I.close}</button></div>
        <div class="drawer-body"><p class="muted" style="margin:0;font-size:.86rem">Notes for <b>${esc(document.title.split('·')[0].trim())}</b>. Saved automatically in this browser. See all notes in <a href="/notebook/">your notebook</a>.</p>
        <textarea aria-label="Notes for this page" placeholder="Write what you learned, questions to ask, numbers from the lab…"></textarea>
        <div style="display:flex;gap:8px"><button class="btn btn-sm" data-act="stamp">Insert page link</button><button class="btn btn-sm" data-act="export">Download all notes</button></div></div>`;
      document.body.appendChild(drawer);
      const ta = $('textarea', drawer);
      ta.value = FFP.store.note(location.pathname);
      ta.addEventListener('input', () => FFP.store.setNote(location.pathname, ta.value));
      $('.drawer-head button', drawer).addEventListener('click', closeNotebook);
      $('[data-act=stamp]', drawer).addEventListener('click', () => { ta.value += (ta.value ? '\n' : '') + `[${document.title.split('·')[0].trim()}](${location.pathname})\n`; ta.dispatchEvent(new Event('input')); });
      $('[data-act=export]', drawer).addEventListener('click', exportNotes);
    }
    drawer.classList.add('open'); scrim(true, closeNotebook);
    setTimeout(() => $('textarea', drawer).focus(), 50);
  }
  function closeNotebook() { if (drawer) drawer.classList.remove('open'); scrim(false); }
  function exportNotes() {
    const notes = FFP.store.raw().notes;
    const md = Object.keys(notes).map(p => `## ${notes[p].title}\n_${p} · ${new Date(notes[p].t).toLocaleString()}_\n\n${notes[p].text}\n`).join('\n');
    FFP.download('future-food-notes.md', '# My Future Food Production notebook\n\n' + md, 'text/markdown');
  }
  FFP.exportNotes = exportNotes;
  FFP.openNotebook = openNotebook;
  FFP.download = function (name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); openPalette(); }
    else if (e.key.toLowerCase() === 'n' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { openNotebook(); e.preventDefault(); }
    else if (e.key === 'Escape') { closePalette(); closeNotebook(); }
  });

  /* ---------------------------------------------------------- KaTeX */
  let katexPromise;
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  FFP.loadKatex = function () {
    if (katexPromise) return katexPromise;
    const v = '0.16.11';
    if (!$('link[href*="katex"]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet';
      l.href = `https://cdn.jsdelivr.net/npm/katex@${v}/dist/katex.min.css`; document.head.appendChild(l);
    }
    katexPromise = loadScript(`https://cdn.jsdelivr.net/npm/katex@${v}/dist/katex.min.js`)
      .then(() => loadScript(`https://cdn.jsdelivr.net/npm/katex@${v}/dist/contrib/auto-render.min.js`));
    return katexPromise;
  };
  FFP.renderMath = function (el) {
    el = el || document.body;
    return FFP.loadKatex().then(() => {
      window.renderMathInElement(el, {
        delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
        throwOnError: false, strict: 'ignore', trust: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'input'],
        macros: { '\\u': '\\,\\mathrm{#1}', '\\dd': '\\mathrm{d}' }
      });
    }).catch(() => { /* offline: leave source visible */ });
  };
  FFP.tex = function (src, display) {
    if (window.katex) return window.katex.renderToString(src, { throwOnError: false, displayMode: !!display });
    return esc(src);
  };

  /* --------------------------------------------------- lesson scaffolding */
  function moduleOf(slug) { const l = C.lessonIndex[slug]; return l ? C.moduleIndex[l.module] : null; }
  function loBadges(los) { return (los || []).map(id => `<span class="tag tag-lo" title="${esc((C.outcomes.find(o => o.id === id) || {}).text || '')}">${id}</span>`).join(''); }
  FFP.loBadges = loBadges;

  function scaffoldLesson() {
    const slug = document.body.dataset.slug;
    const L = C.lessonIndex[slug]; if (!L) return;
    const M = C.moduleIndex[L.module];
    document.documentElement.style.setProperty('--mod-color', M.color);
    const i = C.flatLessons.indexOf(L);
    const prev = C.flatLessons[i - 1], next = C.flatLessons[i + 1];

    // head
    const head = $('[data-lesson-head]');
    if (head) {
      const h1 = $('h1', head);
      const crumbs = document.createElement('div');
      crumbs.className = 'breadcrumb';
      crumbs.innerHTML = `<a href="/course/">Course</a><span>/</span><a href="/course/#module-${M.slug}">Module ${String(M.n).padStart(2, '0')} · ${esc(M.title)}</a>`;
      head.insertBefore(crumbs, head.firstChild);
      const eb = document.createElement('div'); eb.className = 'eyebrow'; eb.style.marginTop = '18px';
      eb.textContent = `Lesson ${L.code}`;
      head.insertBefore(eb, h1);
      const meta = document.createElement('div'); meta.className = 'meta';
      meta.innerHTML = `<span><b>${L.minutes} min</b> reading + activities</span><span>First-cycle · Year 1</span>${loBadges(M.los)}${FFP.store.isStudied(slug) ? '<span class="tag tag-done">Studied</span>' : ''}`;
      head.appendChild(meta);
    }
    // side nav
    const side = $('[data-lesson-side]');
    if (side) {
      side.innerHTML = `<h4>Module ${String(M.n).padStart(2, '0')}</h4>
        <p style="font-family:var(--font-serif);font-weight:600;font-size:1.02rem;line-height:1.3;margin:0 0 14px">${esc(M.title)}</p>
        <ol>${M.lessons.map(l => `<li><a href="${l.url}"${l.slug === slug ? ' aria-current="page"' : ''}><span class="n">${l.code}</span><span>${esc(l.title)}</span>${FFP.store.isStudied(l.slug) ? '<span class="done">✓</span>' : ''}</a></li>`).join('')}</ol>
        <h4>Laboratories</h4>
        <div class="side-labs">${M.labs.map(s => C.labIndex[s]).filter(Boolean).map(l => `<a href="${l.url}"><span class="tag ${l.kind === '3D' ? 'tag-3d' : 'tag-2d'}" style="margin-right:6px">${l.kind}</span>${esc(l.title)}</a>`).join('')}</div>
        <h4 style="margin-top:20px">Practice</h4>
        <div class="side-labs"><a href="/practice/?module=${M.slug}">Problem generator for this module →</a></div>`;
    }
    // number sections, build toc
    const body = $('[data-lesson-body]');
    const toc = $('[data-lesson-toc]');
    if (body) {
      const hs = $$(':scope > h2', body);
      hs.forEach((h, k) => {
        if (!h.id) h.id = h.textContent.trim().toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
        if (!h.querySelector('.sec-num') && !h.hasAttribute('data-nonum')) h.insertAdjacentHTML('afterbegin', `<span class="sec-num">${L.code}.${k + 1}</span>`);
      });
      if (toc) {
        toc.innerHTML = `<h4>In this lesson</h4><ol>${hs.map(h => `<li><a href="#${h.id}">${esc(h.textContent.replace(/^[\d.]+/, '').trim())}</a></li>`).join('')}</ol>
          <div class="toc-actions">
            <button class="btn btn-sm" data-act="studied"></button>
            <button class="btn btn-sm btn-ghost" data-act="print">${I.print} Print lesson</button>
            <button class="btn btn-sm btn-ghost" data-act="notes">${I.note} Notebook</button>
          </div>`;
        const links = $$('a', toc);
        const io = new IntersectionObserver(ents => {
          ents.forEach(en => {
            if (en.isIntersecting) { links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id)); }
          });
        }, { rootMargin: '-15% 0px -75% 0px' });
        hs.forEach(h => io.observe(h));
        $('[data-act=print]', toc).addEventListener('click', () => { $$('details').forEach(d => d.open = true); window.print(); });
        $('[data-act=notes]', toc).addEventListener('click', openNotebook);
        const sb = $('[data-act=studied]', toc);
        const upd = () => { const on = FFP.store.isStudied(slug); sb.innerHTML = on ? `${I.check} Studied` : 'Mark as studied'; sb.classList.toggle('btn-primary', on); };
        sb.addEventListener('click', () => { FFP.store.setStudied(slug, !FFP.store.isStudied(slug)); FFP.toast(FFP.store.isStudied(slug) ? 'Lesson marked as studied' : 'Mark removed'); });
        document.addEventListener('ffp:progress', upd);
        upd();
      }
    }
    // footer pager
    const foot = $('[data-lesson-foot]');
    if (foot) {
      foot.innerHTML = `<div class="lesson-foot">
          <button class="btn" data-act="studied2"></button>
          <a class="btn btn-ghost" href="/practice/?module=${M.slug}">Practise this module</a>
        </div>
        <nav class="pager" aria-label="Lesson navigation">
          ${prev ? `<a class="prev" href="${prev.url}"><small>← Previous · ${prev.code}</small>${esc(prev.title)}</a>` : '<span></span>'}
          ${next ? `<a class="next" href="${next.url}"><small>Next · ${next.code} →</small>${esc(next.title)}</a>` : `<a class="next" href="/project/"><small>Next →</small>Course project</a>`}
        </nav>`;
      const b = $('[data-act=studied2]', foot);
      const upd = () => { const on = FFP.store.isStudied(slug); b.innerHTML = on ? `${I.check} Studied — well done` : 'Mark lesson as studied'; b.classList.toggle('btn-primary', !on); };
      b.addEventListener('click', () => { FFP.store.setStudied(slug, !FFP.store.isStudied(slug)); FFP.toast(FFP.store.isStudied(slug) ? 'Lesson marked as studied' : 'Mark removed'); });
      document.addEventListener('ffp:progress', upd);
      upd();
    }
    document.title = document.title.includes('·') ? document.title : `${L.title} · Future Food Production`;
  }

  /* -------------------------------------------------------- lab scaffolding */
  function scaffoldLab() {
    const slug = document.body.dataset.slug;
    const L = C.labIndex[slug]; if (!L) return;
    const M = C.moduleIndex[L.module];
    document.documentElement.style.setProperty('--mod-color', M.color);
    FFP.store.labVisit(slug);
    const head = $('[data-lab-head]');
    if (head) {
      const h1 = $('h1', head);
      const crumbs = document.createElement('div'); crumbs.className = 'breadcrumb';
      crumbs.innerHTML = `<a href="/laboratories/">Laboratories</a><span>/</span><a href="/laboratories/?module=${M.slug}">Module ${String(M.n).padStart(2, '0')} · ${esc(M.title)}</a>`;
      head.insertBefore(crumbs, head.firstChild);
      const eb = document.createElement('div'); eb.className = 'eyebrow'; eb.style.marginTop = '14px';
      eb.textContent = `Laboratory · Interactive ${L.kind}`;
      head.insertBefore(eb, h1);
      const meta = document.createElement('div'); meta.className = 'card-meta';
      const related = M.lessons.map(l => `<a class="tag" style="text-decoration:none" href="${l.url}">${l.code} ${esc(l.title.split(':')[0])}</a>`).join('');
      meta.innerHTML = `<span class="tag ${L.kind === '3D' ? 'tag-3d' : 'tag-2d'}">Interactive ${L.kind}</span>${loBadges(L.los)}${related}
        <button class="tag" data-act="labdone" style="cursor:pointer"></button>`;
      head.appendChild(meta);
      const b = $('[data-act=labdone]', meta);
      const upd = () => { const on = FFP.store.labDone(slug); b.textContent = on ? '✓ Lab completed' : 'Mark lab completed'; b.classList.toggle('tag-done', on); };
      b.addEventListener('click', () => { FFP.store.setLabDone(slug, !FFP.store.labDone(slug)); upd(); });
      upd();
    }
    document.title = document.title.includes('·') ? document.title : `${L.title} · Future Food Production`;
  }

  /* ------------------------------------------------ generic doc pages (project, guides) */
  function scaffoldDoc() {
    const body = $('[data-doc-body]'), toc = $('[data-doc-toc]');
    if (body && toc) {
      const hs = $$(':scope > h2', body);
      hs.forEach(h => { if (!h.id) h.id = h.textContent.trim().toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, ''); });
      toc.innerHTML = `<h4>On this page</h4><ol>${hs.map(h => `<li><a href="#${h.id}">${esc(h.textContent.trim())}</a></li>`).join('')}</ol>
        <div class="toc-actions"><button class="btn btn-sm btn-ghost" data-act="print">${I.print} Print</button><button class="btn btn-sm btn-ghost" data-act="notes">${I.note} Notebook</button></div>`;
      const links = $$('a', toc);
      const io = new IntersectionObserver(ents => ents.forEach(en => { if (en.isIntersecting) links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id)); }), { rootMargin: '-15% 0px -75% 0px' });
      hs.forEach(h => io.observe(h));
      $('[data-act=print]', toc).addEventListener('click', () => { $$('details').forEach(d => d.open = true); window.print(); });
      $('[data-act=notes]', toc).addEventListener('click', openNotebook);
    }
    const ps = $('[data-project-side]');
    if (ps && C) {
      const cur = location.pathname.replace(/index\.html$/, '');
      ps.innerHTML = `<h4>Course project</h4><p style="font-family:var(--font-serif);font-weight:600;font-size:1.02rem;line-height:1.3;margin:0 0 14px">${esc(C.project.title)}</p>
        <ol>${C.project.pages.map((p, i) => { const u = '/project/' + (p.slug ? p.slug + '/' : ''); return `<li><a href="${u}"${u === cur ? ' aria-current="page"' : ''}><span class="n">P${i}</span><span>${esc(p.title)}</span></a></li>`; }).join('')}</ol>
        <h4>Key laboratories</h4><div class="side-labs">${['statistics-workbench', 'model-fitting', 'experiment-designer', 'triangle-test', 'hedonic-analysis', 'grow-room-lighting', 'nutrient-mixer'].map(s => C.labIndex[s]).filter(Boolean).map(l => `<a href="${l.url}"><span class="tag ${l.kind === '3D' ? 'tag-3d' : 'tag-2d'}" style="margin-right:6px">${l.kind}</span>${esc(l.title)}</a>`).join('')}</div>`;
    }
  }

  /* ------------------------------------------------ lab-link cards */
  function fillLabLinks() {
    $$('a.lab-link[data-lab]').forEach(a => {
      const L = C && C.labIndex[a.dataset.lab]; if (!L) return;
      const M = C.moduleIndex[L.module];
      a.href = L.url;
      if (!a.innerHTML.trim()) {
        a.innerHTML = `<div class="ll-thumb" style="background:radial-gradient(120% 120% at 20% 10%, ${M.color} 0%, #0b1210 75%)">${L.kind}</div>
          <div><div class="ll-kicker">Laboratory · Interactive ${L.kind}</div><div class="ll-title">${esc(L.title)}</div><div class="ll-text">${esc(a.dataset.why || L.summary)}</div></div>`;
      }
    });
  }

  /* ------------------------------------------------ equation boxes */
  function enhanceEquations() {
    $$('.eq-box').forEach((box, k) => {
      const main = $('.eq-main', box);
      if (main && !main.dataset.tex) main.dataset.tex = main.textContent.trim().replace(/^\\\[|\\\]$/g, '').trim();
      const head = $('.eq-head', box);
      if (head && !$('.eq-tools', head)) {
        const tools = document.createElement('div'); tools.className = 'eq-tools';
        tools.innerHTML = '<button type="button" data-act="copy" title="Copy LaTeX source">LaTeX</button>' + (box.id ? '<button type="button" data-act="link" title="Copy link to this equation">#</button>' : '');
        head.appendChild(tools);
        tools.addEventListener('click', e => {
          const act = e.target.dataset.act;
          if (act === 'copy') { navigator.clipboard && navigator.clipboard.writeText(main.dataset.tex); FFP.toast('LaTeX copied'); }
          if (act === 'link') { navigator.clipboard && navigator.clipboard.writeText(location.origin + location.pathname + '#' + box.id); FFP.toast('Link copied'); }
        });
      }
      $$('details', box).forEach(d => { if (!$('.d-body', d)) { const s = $('summary', d); const w = document.createElement('div'); w.className = 'd-body'; while (s.nextSibling) w.appendChild(s.nextSibling); d.appendChild(w); } });
    });
  }

  /* ------------------------------------------------ tables & images */
  function wrapTables() {
    $$('.prose table:not(.symbols), .tab-panel table:not(.symbols)').forEach(t => {
      if (t.parentElement.classList.contains('table-wrap')) return;
      const w = document.createElement('div'); w.className = 'table-wrap'; t.parentNode.insertBefore(w, t); w.appendChild(t);
    });
    $$('.eq-box > table.symbols').forEach(t => { const w = document.createElement('div'); w.className = 'table-wrap'; w.style.border = '0'; t.parentNode.insertBefore(w, t); w.appendChild(t); });
  }
  function imageFallbacks() {
    $$('img').forEach(img => {
      if (!img.hasAttribute('loading')) img.loading = 'lazy';
      if (!img.hasAttribute('referrerpolicy')) img.referrerPolicy = 'no-referrer';
      const fail = () => {
        const d = document.createElement('div'); d.className = 'img-missing';
        const src = img.getAttribute('src');
        d.innerHTML = `Image could not be loaded.<br>${img.alt ? esc(img.alt) + '<br>' : ''}<a href="${esc(src)}" target="_blank" rel="noopener">Open the original source ↗</a>`;
        img.replaceWith(d);
      };
      if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) fail(); else img.addEventListener('error', fail, { once: true });
    });
  }

  /* ------------------------------------------------ mini calculators */
  const MATH_NAMES = ['exp', 'log', 'log10', 'log2', 'sqrt', 'cbrt', 'pow', 'abs', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'min', 'max', 'floor', 'ceil', 'round', 'sign', 'hypot', 'PI', 'E'];
  const MATH_VALS = MATH_NAMES.map(n => Math[n]);
  /** Convert simple HTML labels (with <sub>/<sup>) to plain text for canvas axes, using Unicode sub/superscripts. */
  const SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ' };
  const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ' };
  const mapChars = (t, M, fallback) => { const c = [...t]; return c.every(ch => M[ch] || ch === ' ') ? c.map(ch => M[ch] || ch).join('') : fallback + t; };
  FFP.plainLabel = function (html) {
    const s = String(html || '').replace(/<sub>(.*?)<\/sub>/gi, (m, t) => mapChars(t.replace(/<[^>]+>/g, ''), SUB, '_')).replace(/<sup>(.*?)<\/sup>/gi, (m, t) => mapChars(t.replace(/<[^>]+>/g, ''), SUP, '^'));
    const d = document.createElement('div'); d.innerHTML = s.replace(/<[^>]+>/g, ''); return d.textContent;
  };  FFP.fmt = function (v, digits) {
    if (!isFinite(v)) return '—';
    const d = digits == null ? 3 : +digits;
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(Math.max(1, d - 1)).replace('e', '×10^').replace(/\^\+?(-?\d+)/, (m, e) => '^' + e).replace(/\^(-?\d+)/, (m, e) => supNum(e));
    return v.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: Math.min(d, a < 10 && d > 0 ? Math.min(d, 2) : 0) });
  };
  function supNum(e) { const m = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }; return String(e).split('').map(c => m[c] || c).join(''); }

  function buildMiniCalcs() {
    const calcs = $$('.mini-calc');
    if (!calcs.length) return;
    calcs.forEach(async el => {
      if (el.dataset.built) return; el.dataset.built = '1';
      const vars = $$('[data-var]', el).map(v => ({
        el: v, name: v.dataset.var, label: v.dataset.label || v.dataset.var, min: +v.dataset.min, max: +v.dataset.max,
        step: +(v.dataset.step || (+v.dataset.max - +v.dataset.min) / 100), value: +v.dataset.value, unit: v.dataset.unit || '',
        digits: v.dataset.digits != null ? +v.dataset.digits : null, log: v.dataset.scale === 'log'
      }));
      const names = vars.map(v => v.name);
      let fn;
      if (el.dataset.fn && window.FFP_CALC && window.FFP_CALC[el.dataset.fn]) {
        const f = window.FFP_CALC[el.dataset.fn]; fn = obj => f(obj);
      } else {
        try {
          const body = el.dataset.formula;
          // variables may shadow Math names (e.g., E for irradiance): drop clashing Math names
          const mNames = MATH_NAMES.filter(n => !names.includes(n)), mVals = mNames.map(n => Math[n]);
          const f = new Function(...mNames, ...names, `"use strict"; return (${body});`);
          fn = obj => f(...mVals, ...names.map(n => obj[n]));
        } catch (err) { console.error('mini-calc formula error', err, el); return; }
      }
      const outLabel = el.dataset.output || 'Result';
      const outUnit = el.dataset.unit || '';
      const digits = el.dataset.digits != null ? +el.dataset.digits : 3;
      const plotVar = el.dataset.plot;
      el.classList.toggle('no-plot', !plotVar);
      const title = el.dataset.title || 'Try it — live equation';
      el.innerHTML = `<div class="mini-calc-title">${title}</div><div class="mini-calc-grid"><div class="mc-inputs"></div>${plotVar ? '<div class="mc-plot"></div>' : ''}</div>`;
      const inputs = $('.mc-inputs', el);
      const state = {};
      vars.forEach(v => {
        state[v.name] = v.value;
        const w = document.createElement('div'); w.className = 'mc-var';
        w.innerHTML = `<div class="mc-lab"><span>${v.label}</span><output></output></div><input type="range" aria-label="${esc(v.label.replace(/<[^>]+>/g, ''))}">`;
        const r = $('input', w), o = $('output', w);
        const toR = x => v.log ? Math.log10(x) : x, fromR = x => v.log ? Math.pow(10, x) : x;
        r.min = toR(v.min); r.max = toR(v.max); r.step = v.log ? (toR(v.max) - toR(v.min)) / 200 : v.step; r.value = toR(v.value);
        const upd = () => {
          state[v.name] = fromR(+r.value);
          o.textContent = FFP.fmt(state[v.name], v.digits != null ? v.digits : (v.step < 1 ? Math.min(4, Math.ceil(-Math.log10(v.step))) : 0)) + (v.unit ? ' ' + v.unit : '');
          r.setAttribute('aria-valuetext', o.textContent); // screen readers announce the unit too
          r.style.setProperty('--fill', ((+r.value - +r.min) / (+r.max - +r.min) * 100) + '%');
        };
        r.addEventListener('input', () => { upd(); compute(); });
        upd(); inputs.appendChild(w);
      });
      const res = document.createElement('div'); res.className = 'mc-result';
      res.innerHTML = `<span class="mc-out-label">${outLabel}</span><span class="mc-out"></span>`;
      inputs.appendChild(res);
      const outEl = $('.mc-out', res);
      let plot = null;
      if (plotVar) {
        const pv = vars.find(v => v.name === plotVar);
        try {
          const mod = await import('/assets/js/plot.js');
          plot = new mod.Plot($('.mc-plot', el), {
            x: { label: FFP.plainLabel(pv.label), unit: pv.unit, min: pv.min, max: pv.max, log: pv.log },
            y: { label: FFP.plainLabel(outLabel), unit: outUnit, min: el.dataset.ymin != null ? +el.dataset.ymin : 'auto', max: el.dataset.ymax != null ? +el.dataset.ymax : 'auto' },
            legend: false, height: 220
          });
        } catch (e) { console.warn('plot unavailable', e); }
      }
      function compute() {
        let y; try { y = fn(Object.assign({}, state)); } catch (e) { y = NaN; }
        outEl.innerHTML = `${FFP.fmt(y, digits)}<small>${outUnit}</small>`;
        if (plot) {
          const pv = vars.find(v => v.name === plotVar);
          const N = 160, xs = [], ys = [];
          for (let i = 0; i <= N; i++) {
            const x = pv.log ? Math.pow(10, Math.log10(pv.min) + (Math.log10(pv.max) - Math.log10(pv.min)) * i / N) : pv.min + (pv.max - pv.min) * i / N;
            const o = Object.assign({}, state); o[plotVar] = x;
            let yy; try { yy = fn(o); } catch (e) { yy = NaN; }
            xs.push(x); ys.push(isFinite(yy) ? yy : NaN);
          }
          plot.line('f', xs, ys, { color: 'accent', width: 2.2 });
          plot.point('cur', state[plotVar], y, { color: 'magenta', r: 5.5 });
        }
      }
      compute();
    });
  }

  /* ------------------------------------------------------------ quizzes */
  function buildQuizzes() {
    $$('.quiz').forEach((qz, qi) => {
      if (qz.dataset.built) return;
      const src = $('script[type="application/json"]', qz);
      if (!src) return;
      let data;
      try { data = JSON.parse(src.textContent); } catch (e) { console.error('Quiz JSON error', e, qz); qz.innerHTML = '<p style="padding:16px;color:var(--danger)">Quiz data could not be parsed.</p>'; return; }
      qz.dataset.built = '1';
      const id = qz.dataset.quiz || (document.body.dataset.slug || location.pathname) + '-q' + qi;
      const qs = data.questions || [];
      const first = new Array(qs.length).fill(null);
      const prev = FFP.store.quiz(id);
      qz.innerHTML = `<div class="quiz-head"><div><div class="eyebrow">${esc(data.kicker || 'Check your understanding')}</div><div class="quiz-title">${data.title || 'Quiz'}</div></div><div class="quiz-score">${prev ? `Best: ${prev.best}/${qs.length}` : `${qs.length} questions`}</div></div>
        <div class="quiz-body"></div>
        <div class="quiz-foot"><span class="q-status">Answer each question, then press Check. You can retry — first attempts are scored.</span><button class="btn btn-sm" type="button" data-act="reset">Reset quiz</button></div>`;
      const body = $('.quiz-body', qz);
      qs.forEach((q, k) => body.appendChild(renderQ(q, k)));
      $('[data-act=reset]', qz).addEventListener('click', () => { qz.dataset.built = ''; qz.innerHTML = ''; qz.appendChild(src); buildQuizzes(); });
      FFP.renderMath(qz);

      function renderQ(q, k) {
        const w = document.createElement('div'); w.className = 'quiz-q';
        const type = q.type || (Array.isArray(q.answer) ? 'multi' : typeof q.answer === 'number' && !q.options ? 'numeric' : typeof q.answer === 'boolean' ? 'tf' : 'mcq');
        let opts = q.options || (type === 'tf' ? ['True', 'False'] : null);
        let order = opts ? opts.map((_, i) => i) : [];
        if (opts && q.shuffle !== false && type !== 'tf') order = shuffle(order);
        const name = `q-${qi}-${k}-${Math.random().toString(36).slice(2, 7)}`;
        w.innerHTML = `<div class="q-num">QUESTION ${k + 1}${type === 'multi' ? ' · SELECT ALL THAT APPLY' : ''}</div><div class="q-text">${q.q}</div>
          ${opts ? `<div class="quiz-opts">${order.map(i => `<label class="quiz-opt" data-i="${i}"><input type="${type === 'multi' ? 'checkbox' : 'radio'}" name="${name}" value="${i}"><span>${opts[i]}</span></label>`).join('')}</div>`
            : `<div class="quiz-num"><input type="text" inputmode="decimal" placeholder="Your answer" aria-label="Numeric answer">${q.unit ? `<span class="unit">${q.unit}</span>` : ''}</div>`}
          <div class="quiz-actions"><button class="btn btn-sm btn-primary" type="button" data-act="check">Check</button>${q.hint ? '<button class="btn btn-sm" type="button" data-act="hint">Hint</button>' : ''}<button class="btn btn-sm btn-ghost" type="button" data-act="retry" hidden>Try again</button></div>
          <div class="quiz-hint">${q.hint || ''}</div>
          <div class="quiz-feedback"></div>`;
        const fb = $('.quiz-feedback', w);
        $('[data-act=check]', w).addEventListener('click', () => {
          let ok = false, detail = '';
          if (type === 'numeric') {
            const raw = $('.quiz-num input', w).value.trim().replace(',', '.').replace(/\s/g, '').replace(/×10\^?/, 'e');
            const v = parseFloat(raw);
            if (!isFinite(v)) { FFP.toast('Enter a number'); return; }
            const ans = +q.answer;
            if (q.range) ok = v >= q.range[0] && v <= q.range[1];
            else if (q.abstol != null) ok = Math.abs(v - ans) <= q.abstol;
            else ok = Math.abs(v - ans) <= Math.abs(ans) * (q.tol != null ? q.tol : 0.02) + 1e-12;
            if (!ok) detail = v !== 0 && ans !== 0 && Math.abs(Math.log10(Math.abs(v / ans)) - Math.round(Math.log10(Math.abs(v / ans)))) < 0.01 && Math.round(Math.log10(Math.abs(v / ans))) !== 0 ? '<p>Your answer is off by a power of ten — check your unit conversions.</p>' : '';
          } else {
            const chosen = $$('input', w).filter(i => i.checked).map(i => +i.value);
            if (!chosen.length) { FFP.toast('Choose an answer'); return; }
            if (type === 'multi') { const a = [...q.answer].sort().join(','); ok = chosen.sort().join(',') === a; }
            else if (type === 'tf') ok = (chosen[0] === 0) === q.answer;
            else ok = chosen[0] === q.answer;
            $$('.quiz-opt', w).forEach(l => {
              const i = +l.dataset.i;
              const isAns = type === 'multi' ? q.answer.includes(i) : type === 'tf' ? (i === 0) === q.answer : i === q.answer;
              if (ok && isAns) l.classList.add('correct');
              if (!ok && chosen.includes(i) && !isAns) l.classList.add('wrong');
            });
            if (!ok && q.feedback) chosen.forEach(i => { if (q.feedback[i]) detail += `<p>${q.feedback[i]}</p>`; });
          }
          if (first[k] === null) first[k] = ok;
          fb.className = 'quiz-feedback show ' + (ok ? 'ok' : 'bad');
          fb.innerHTML = ok ? `<div class="fb-title">Correct.</div>${q.explain || ''}` : `<div class="fb-title">Not quite.</div>${detail}${q.hint && !$('.quiz-hint', w).classList.contains('show') ? '<p>Try the hint, then try again.</p>' : '<p>Re-read the relevant section and try again.</p>'}${q.revealOnWrong ? q.explain : ''}`;
          $('[data-act=retry]', w).hidden = ok;
          $$('input', w).forEach(i => i.disabled = true);
          $('[data-act=check]', w).disabled = true;
          FFP.renderMath(fb);
          updateScore();
        });
        const hb = $('[data-act=hint]', w); if (hb) hb.addEventListener('click', () => $('.quiz-hint', w).classList.add('show'));
        $('[data-act=retry]', w).addEventListener('click', () => {
          $$('input', w).forEach(i => { i.disabled = false; if (i.type !== 'text') i.checked = false; });
          $$('.quiz-opt', w).forEach(l => l.classList.remove('correct', 'wrong'));
          fb.className = 'quiz-feedback'; $('[data-act=check]', w).disabled = false; $('[data-act=retry]', w).hidden = true;
        });
        return w;
      }
      function updateScore() {
        const answered = first.filter(v => v !== null).length;
        const right = first.filter(v => v === true).length;
        $('.q-status', qz).textContent = `First-attempt score: ${right}/${answered} answered${answered === qs.length ? ' — complete.' : '.'}`;
        if (answered === qs.length) {
          const p = FFP.store.quiz(id) || {};
          FFP.store.setQuiz(id, { best: Math.max(p.best || 0, right), total: qs.length, attempts: (p.attempts || 0) + 1, last: right, page: location.pathname, t: Date.now() });
          $('.quiz-score', qz).textContent = `Best: ${Math.max(p.best || 0, right)}/${qs.length}`;
        }
      }
    });
  }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  FFP.shuffle = shuffle;
  FFP.buildQuizzes = buildQuizzes;

  /* --------------------------------------------------------------- tabs */
  function buildTabs() {
    $$('[data-tabs]').forEach(t => {
      if (t.dataset.built) return; t.dataset.built = '1';
      const panels = $$(':scope > [data-panel]', t);
      const list = document.createElement('div'); list.className = 'tab-list'; list.setAttribute('role', 'tablist');
      if (t.dataset.label) list.setAttribute('aria-label', t.dataset.label);
      panels.forEach((p, i) => {
        p.classList.add('tab-panel'); p.setAttribute('role', 'tabpanel');
        const pid = p.id || ('tabpanel-' + p.dataset.panel); if (!p.id) p.id = pid;
        const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab');
        b.id = 'tab-' + p.dataset.panel; b.setAttribute('aria-controls', pid); p.setAttribute('aria-labelledby', b.id);
        b.textContent = p.dataset.title || p.dataset.panel; b.dataset.target = p.dataset.panel;
        list.appendChild(b);
      });
      t.insertBefore(list, t.firstChild);
      const show = key => {
        panels.forEach(p => p.hidden = p.dataset.panel !== key);
        $$('button', list).forEach(b => { const on = b.dataset.target === key; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
        document.dispatchEvent(new CustomEvent('ffp:tab', { detail: key }));
      };
      const choose = b => { show(b.dataset.target); history.replaceState(null, '', '#' + b.dataset.target); };
      list.addEventListener('click', e => { const b = e.target.closest('button'); if (b) choose(b); });
      // WAI-ARIA tabs pattern: arrow keys move between tabs, Home/End jump to the ends
      list.addEventListener('keydown', e => {
        const bs = $$('button', list), i = bs.indexOf(document.activeElement); if (i < 0) return;
        const j = e.key === 'ArrowRight' ? (i + 1) % bs.length : e.key === 'ArrowLeft' ? (i - 1 + bs.length) % bs.length : e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : -1;
        if (j < 0) return; e.preventDefault(); bs[j].focus(); choose(bs[j]);
      });
      const h = location.hash.slice(1);
      show(panels.some(p => p.dataset.panel === h) ? h : panels[0].dataset.panel);
    });
  }

  /* ---------------------------------------------- task & check lists */
  function buildTasks() {
    const slug = document.body.dataset.slug || location.pathname;
    $$('.task-list > li').forEach((li, i) => {
      const key = slug + ':task' + i;
      const lab = document.createElement('label'); lab.className = 'task-check';
      lab.title = 'Tick when you have finished this task';
      lab.innerHTML = `<input type="checkbox" aria-label="Task ${i + 1} done"><span class="tc-box" aria-hidden="true"></span><span class="tc-text" aria-hidden="true"></span>`;
      li.appendChild(lab);
      const cb = $('input', lab); cb.checked = FFP.store.task(key); li.classList.toggle('done', cb.checked);
      cb.addEventListener('change', () => { FFP.store.setTask(key, cb.checked); li.classList.toggle('done', cb.checked); });
    });
    $$('.check-list > li').forEach((li, i) => {
      if ($('input', li)) return;
      const key = slug + ':check' + i;
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = FFP.store.check(key);
      cb.setAttribute('aria-label', 'I can do this');
      // wrap the statement so inline maths and links stay in one flex item
      const span = document.createElement('span'); while (li.firstChild) span.appendChild(li.firstChild);
      li.appendChild(cb); li.appendChild(span);
      cb.addEventListener('change', () => FFP.store.setCheck(key, cb.checked));
    });
  }

  /* ---------------------------------------------------------- boot */
  function boot() {
    buildHeader();
    buildFooter();
    const page = document.body.dataset.page;
    if (C && page === 'lesson') scaffoldLesson();
    if (C && page === 'lab') scaffoldLab();
    scaffoldDoc();
    if (C) fillLabLinks();
    enhanceEquations();
    wrapTables();
    imageFallbacks();
    buildTabs();
    buildTasks();
    buildQuizzes();
    buildMiniCalcs();
    const txt = document.body.textContent;
    if (txt.includes('\\(') || txt.includes('\\[')) FFP.renderMath(document.body).then(() => document.dispatchEvent(new CustomEvent('ffp:math')));
    if (location.hash) { const t = document.getElementById(location.hash.slice(1)); if (t) setTimeout(() => t.scrollIntoView(), 60); }
    document.dispatchEvent(new CustomEvent('ffp:ready'));
    FFP.ready = true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
