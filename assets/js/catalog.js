/* catalog.js — shared card renderers for the home, course and laboratories pages (ES module). */
const C = () => window.FFP_COURSE;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function moduleProgress(m) {
  const st = window.FFP && FFP.store ? FFP.store : null;
  if (!st) return 0;
  const n = m.lessons.length + m.labs.length;
  const done = m.lessons.filter(l => st.isStudied(l.slug)).length + m.labs.filter(s => st.labDone(s)).length;
  return n ? done / n : 0;
}

export function moduleCard(m, { href } = {}) {
  const I = (window.FFP && FFP.icons) || {};
  const n3 = m.labs.map(s => C().labIndex[s]).filter(l => l && l.kind === '3D').length;
  const p = moduleProgress(m);
  return `<a class="card module-card" href="${href || '/course/#module-' + m.slug}" style="--mod-color:${m.color}">
    <span class="mod-bar"></span>
    <div class="mod-icon">${I[m.icon] || ''}</div>
    <div class="mod-num">MODULE ${String(m.n).padStart(2, '0')}</div>
    <h3>${esc(m.title)}</h3>
    <p>${esc(m.tagline)}</p>
    <div class="card-meta"><span class="tag">${m.lessons.length} lessons</span><span class="tag">${m.labs.length} labs${n3 ? ` · ${n3} in 3D` : ''}</span>${m.los.map(id => `<span class="tag tag-lo">${id}</span>`).join('')}</div>
    <div class="mod-progress" title="${Math.round(p * 100)}% complete"><i style="width:${Math.round(p * 100)}%"></i></div>
  </a>`;
}

/** Decorative thumbnail: real screenshot if present (assets/img/labs/<slug>.jpg), otherwise generative art. */
export function labThumb(l, color) {
  const seed = [...l.slug].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const r = i => ((Math.sin(seed * (i + 1) * 12.9898) * 43758.5453) % 1 + 1) % 1;
  let art = '';
  for (let i = 0; i < 7; i++) art += `<circle cx="${(r(i) * 100).toFixed(1)}%" cy="${(r(i + 9) * 100).toFixed(1)}%" r="${(8 + r(i + 17) * 40).toFixed(0)}" fill="${color}" opacity="${(0.12 + r(i + 3) * 0.25).toFixed(2)}"/>`;
  art += `<path d="M0 ${110 - r(30) * 40} C 80 ${60 + r(31) * 60}, 160 ${40 + r(32) * 80}, 400 ${50 + r(33) * 60}" stroke="${color}" stroke-width="2" fill="none" opacity=".7"/>`;
  return `<div class="lab-thumb">
    <svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${art}</svg>
    <img src="/assets/img/labs/${l.slug}.jpg" alt="" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" onerror="this.remove()">
    <span class="tag ${l.kind === '3D' ? 'tag-3d' : 'tag-2d'}">Interactive ${l.kind}</span>
  </div>`;
}

export function labCard(l) {
  const m = C().moduleIndex[l.module];
  const done = window.FFP && FFP.store && FFP.store.labDone(l.slug);
  return `<a class="card lab-card" href="${l.url}" style="--mod-color:${m.color}" data-module="${m.slug}" data-kind="${l.kind}">
    ${labThumb(l, m.color)}
    <div class="eyebrow">Module ${String(m.n).padStart(2, '0')} · ${esc(m.title.split(':')[0])}</div>
    <h3>${esc(l.title)}</h3>
    <p>${esc(l.summary)}</p>
    <div class="card-meta">${l.los.map(id => `<span class="tag tag-lo">${id}</span>`).join('')}${done ? '<span class="tag tag-done">Completed</span>' : ''}</div>
    <span class="lab-go">Enter the laboratory →</span>
  </a>`;
}
