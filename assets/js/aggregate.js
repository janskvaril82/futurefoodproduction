/* aggregate.js — builds site-wide indexes (equations, glossary, references) by reading
   the lesson and laboratory pages themselves, so the reference pages never go stale.
   A pre-built JSON (/assets/data/site-index.json, produced by tools/build-index.mjs)
   is used when present; otherwise pages are crawled live in the browser. */

export async function loadIndex(onProgress) {
  // cache the crawl for this browser session so moving between reference pages is instant
  try { const c = sessionStorage.getItem('ffp-site-index'); if (c) { const j = JSON.parse(c); if (j.version === 1 && Date.now() - Date.parse(j.built) < 36e5) { onProgress && onProgress(1, 1); return j; } } } catch (e) { }
  const idx = await crawlIndex(onProgress);
  try { sessionStorage.setItem('ffp-site-index', JSON.stringify(idx)); } catch (e) { }
  return idx;
}

export async function crawlIndex(onProgress) {
  const C = window.FFP_COURSE;
  const pages = [
    ...C.flatLessons.map(l => ({ kind: 'lesson', slug: l.slug, url: l.url, title: l.title, code: l.code, module: l.module })),
    ...C.labs.map(l => ({ kind: 'lab', slug: l.slug, url: l.url, title: l.title, code: 'Lab', module: l.module }))
  ];
  const out = { version: 1, built: new Date().toISOString(), equations: [], terms: [], references: [], readings: [] };
  let done = 0; const parser = new DOMParser();
  const queue = pages.slice();
  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      try {
        const res = await fetch(p.url);
        if (res.ok) extract(parser.parseFromString(await res.text(), 'text/html'), p, out);
      } catch (e) { /* page missing */ }
      done++; onProgress && onProgress(done, pages.length);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  return out;
}

export function extract(doc, p, out) {
  const src = { kind: p.kind, slug: p.slug, url: p.url, title: p.title, code: p.code, module: p.module };
  doc.querySelectorAll('.eq-box').forEach((box, i) => {
    const main = box.querySelector('.eq-main'); if (!main) return;
    const sym = box.querySelector('table.symbols');
    out.equations.push(Object.assign({}, src, {
      id: box.id || '', label: (box.querySelector('.eq-label') || {}).textContent || 'Equation',
      num: (box.querySelector('.eq-num') || {}).textContent || '', tex: main.textContent.trim(),
      read: (box.querySelector('.eq-read') || {}).innerHTML || '', symbols: sym ? sym.outerHTML : '', order: i
    }));
  });
  doc.querySelectorAll('dl.key-terms').forEach(dl => {
    const dts = dl.querySelectorAll('dt');
    dts.forEach(dt => { let dd = dt.nextElementSibling; while (dd && dd.tagName !== 'DD') dd = dd.nextElementSibling; if (dd) out.terms.push(Object.assign({}, src, { term: dt.textContent.trim(), def: dd.innerHTML.trim() })); });
  });
  doc.querySelectorAll('ol.references > li').forEach(li => {
    const a = li.querySelector('a[href*="doi.org"]');
    out.references.push(Object.assign({}, src, { html: li.innerHTML.trim(), text: li.textContent.replace(/\s+/g, ' ').trim(), doi: a ? a.getAttribute('href').replace(/^https?:\/\/(dx\.)?doi\.org\//, '').toLowerCase() : '' }));
  });
  doc.querySelectorAll('ul.reading-list > li').forEach(li => {
    out.readings.push(Object.assign({}, src, { html: li.innerHTML.trim(), type: (li.querySelector('.r-type') || {}).textContent || '' }));
  });
}
