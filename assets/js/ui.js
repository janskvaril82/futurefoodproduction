/* ==========================================================================
   ui.js — laboratory control panels, readouts, simulation clock (ES module)

   import { Controls, Readouts, SimClock, fmt } from '/assets/js/ui.js';

   const ui = new Controls('#controls', { url: true });       // url:true → shareable ?param=… state
   ui.section('Fixtures');
   ui.slider({ id:'h', label:'Mounting height', min:0.2, max:1.5, step:0.05, value:0.6, unit:'m', help:'Distance LED → canopy', onInput: v => … });
   ui.select({ id:'crop', label:'Crop', options:[{value:'lettuce',label:'Lettuce'}], value:'lettuce', onChange });
   ui.toggle({ id:'map', label:'Show PPFD map', value:true, onChange });
   ui.segmented({ id:'view', label:'View', options:[{value:'3d',label:'3D'},{value:'top',label:'Top'}], value:'3d', onChange });
   ui.button({ label:'Reset', onClick, variant:'primary' }); ui.buttons([{…},{…}]);
   ui.presets([{ label:'Seedlings', values:{ h:0.3, … } }, …]);
   ui.html('<p class="ctl-help">…</p>');
   ui.get('h'); ui.set('h', 0.8); ui.values(); ui.onChange(state => …)  // any change
   ui.saveButton('lab-slug', () => ({ readouts }))  → "Save investigation" to notebook

   const ro = new Readouts('#readouts');
   ro.add({ id:'ppfd', label:'Mean PPFD', unit:'µmol m⁻² s⁻¹', digits:0, note:'target 200–250' });
   ro.set('ppfd', 231, 'ok'|'warn'|'bad'|null);
   ========================================================================== */

export function fmt(v, digits = 2) {
  if (v == null || (typeof v === 'number' && !isFinite(v))) return '—';
  if (typeof v !== 'number') return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e7 || a < Math.pow(10, -Math.max(digits, 3)))) return v.toExponential(2);
  return v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Controls {
  constructor(container, opts = {}) {
    this.el = typeof container === 'string' ? document.querySelector(container) : container;
    this.opts = opts;
    this.ctl = {};
    this.state = {};
    this.listeners = [];
    this.urlParams = new URLSearchParams(location.search);
  }
  _emit(id) { this.listeners.forEach(cb => cb(this.state, id)); if (this.opts.url) this._syncURL(); }
  _syncURL() {
    clearTimeout(this._ut);
    this._ut = setTimeout(() => {
      const p = new URLSearchParams();
      Object.entries(this.state).forEach(([k, v]) => { if (this.ctl[k] && this.ctl[k].persist !== false) p.set(k, typeof v === 'boolean' ? (v ? 1 : 0) : v); });
      history.replaceState(null, '', location.pathname + '?' + p.toString() + location.hash);
    }, 250);
  }
  _initial(id, value, parse) {
    if (this.opts.url && this.urlParams.has(id)) { const v = parse(this.urlParams.get(id)); if (v !== undefined && v !== null && !(typeof v === 'number' && isNaN(v))) return v; }
    return value;
  }
  onChange(cb) { this.listeners.push(cb); return this; }
  get(id) { return this.state[id]; }
  values() { return Object.assign({}, this.state); }
  set(id, v, silent) { const c = this.ctl[id]; if (!c) return; c.setValue(v); if (!silent) { c.fire && c.fire(); } return this; }
  setMany(obj) {
    Object.entries(obj).forEach(([k, v]) => this.set(k, v, true));
    Object.keys(obj).forEach(k => this.ctl[k] && this.ctl[k].fire && this.ctl[k].fire());
    // a change handler may itself have loaded other values (e.g. a mode switch that applies defaults):
    // re-assert the requested values so the result never depends on key order, then notify once more
    let changed = false;
    Object.entries(obj).forEach(([k, v]) => { const c = this.ctl[k]; if (c && String(this.state[k]) !== String(v)) { c.setValue(v); changed = true; } });
    if (changed) this._emit(Object.keys(obj)[0]);
    return this;
  }
  /** Replace the options of a select control: setOptions(id, [{value,label}], value?). Keeps the value if still offered. */
  setOptions(id, options, value) {
    const c = this.ctl[id]; if (!c) return this; const s = c.wrap.querySelector('select'); if (!s) return this;
    const keep = value != null ? value : this.state[id];
    s.innerHTML = options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    c.setValue(options.some(o => String(o.value) === String(keep)) ? keep : (options[0] && options[0].value)); return this;
  }
  /** Change a slider's range (and optionally step) after creation; the value is clamped into the new range. */
  setRange(id, { min, max, step } = {}) { const c = this.ctl[id]; if (c && c.setRange) c.setRange(min, max, step); return this; }
  enable(id, on = true) {
    const c = this.ctl[id]; if (!c) return;
    c.wrap.style.opacity = on ? '' : '.45';
    c.wrap.querySelectorAll('input,select,button').forEach(i => { i.disabled = !on; });
  }
  show(id, on = true) { const c = this.ctl[id]; if (c) c.wrap.style.display = on ? '' : 'none'; }

  section(title, right = '') { const d = document.createElement('div'); d.className = 'ctl-section'; d.innerHTML = `<span>${title}</span>${right}`; this.el.appendChild(d); return d; }
  html(h) { const d = document.createElement('div'); d.innerHTML = h; this.el.appendChild(d); return d; }

  slider({ id, label, min, max, step = 'any', value, unit = '', digits, help, log = false, format, onInput, onChange, persist }) {
    const wrap = document.createElement('div'); wrap.className = 'ctl';
    const dg = digits != null ? digits : (step === 'any' ? 2 : Math.max(0, Math.min(4, Math.ceil(-Math.log10(step) - 1e-9))));
    wrap.innerHTML = `<div class="ctl-lab"><label for="c-${id}">${label}</label><output></output></div><input id="c-${id}" type="range">${help ? `<div class="ctl-help">${help}</div>` : ''}`;
    const r = wrap.querySelector('input'), o = wrap.querySelector('output');
    const toR = v => log ? Math.log10(v) : v, fromR = v => log ? Math.pow(10, v) : v;
    let lo = min, hi = max;
    r.min = toR(lo); r.max = toR(hi); r.step = log ? 'any' : step;
    const show = v => { o.textContent = (format ? format(v) : fmt(v, dg)) + (unit ? ' ' + unit : ''); r.setAttribute('aria-valuetext', o.textContent); r.style.setProperty('--fill', ((toR(v) - toR(lo)) / (toR(hi) - toR(lo)) * 100) + '%'); };
    const setValue = v => { v = Math.min(hi, Math.max(lo, +v)); r.value = toR(v); this.state[id] = v; show(v); };
    setValue(this._initial(id, value, parseFloat));
    const fire = () => { onInput && onInput(this.state[id], this.state); onChange && onChange(this.state[id], this.state); this._emit(id); };
    const setRange = (a, b, s) => { if (a != null) lo = a; if (b != null) hi = b; r.min = toR(lo); r.max = toR(hi); if (s != null && !log) r.step = s; setValue(this.state[id]); };
    r.addEventListener('input', () => { let v = fromR(+r.value); if (log) v = +v.toPrecision(3); this.state[id] = v; show(v); onInput && onInput(v, this.state); this._emit(id); });
    r.addEventListener('change', () => { onChange && onChange(this.state[id], this.state); });
    this.el.appendChild(wrap);
    this.ctl[id] = { wrap, setValue, fire, persist, setRange };
    return { el: wrap, input: r, set: v => { setValue(v); fire(); } };
  }
  number({ id, label, min, max, step = 'any', value, unit = '', help, onChange, persist }) {
    const wrap = document.createElement('div'); wrap.className = 'ctl';
    wrap.innerHTML = `<div class="ctl-lab"><label for="c-${id}">${label}</label><span class="muted" style="font-size:.78rem">${unit}</span></div><input id="c-${id}" type="number" ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} step="${step}">${help ? `<div class="ctl-help">${help}</div>` : ''}`;
    const i = wrap.querySelector('input');
    const setValue = v => { i.value = v; this.state[id] = +v; };
    setValue(this._initial(id, value, parseFloat));
    const fire = () => { onChange && onChange(this.state[id], this.state); this._emit(id); };
    i.addEventListener('input', () => { if (i.value === '' || !isFinite(+i.value)) return; this.state[id] = +i.value; fire(); });
    this.el.appendChild(wrap); this.ctl[id] = { wrap, setValue, fire, persist };
    return { el: wrap, input: i };
  }
  select({ id, label, options, value, help, onChange, persist }) {
    const wrap = document.createElement('div'); wrap.className = 'ctl';
    wrap.innerHTML = `<div class="ctl-lab"><label for="c-${id}">${label}</label></div><select id="c-${id}">${options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>${help ? `<div class="ctl-help">${help}</div>` : ''}`;
    const s = wrap.querySelector('select');
    const setValue = v => { s.value = v; this.state[id] = s.value; };
    setValue(this._initial(id, value ?? options[0].value, x => x));
    const fire = () => { onChange && onChange(this.state[id], this.state); this._emit(id); };
    s.addEventListener('change', () => { this.state[id] = s.value; fire(); });
    this.el.appendChild(wrap); this.ctl[id] = { wrap, setValue, fire, persist };
    return { el: wrap, input: s };
  }
  toggle({ id, label, value = false, help, onChange, persist }) {
    const wrap = document.createElement('div'); wrap.className = 'ctl';
    wrap.innerHTML = `<label class="ctl-toggle"><span>${label}</span><span class="switch"><input id="c-${id}" type="checkbox"><span></span></span></label>${help ? `<div class="ctl-help">${help}</div>` : ''}`;
    const i = wrap.querySelector('input');
    const setValue = v => { i.checked = !!v; this.state[id] = !!v; };
    setValue(this._initial(id, value, x => x === '1' || x === 'true'));
    const fire = () => { onChange && onChange(this.state[id], this.state); this._emit(id); };
    i.addEventListener('change', () => { this.state[id] = i.checked; fire(); });
    this.el.appendChild(wrap); this.ctl[id] = { wrap, setValue, fire, persist };
    return { el: wrap, input: i };
  }
  segmented({ id, label, options, value, help, onChange, persist }) {
    const wrap = document.createElement('div'); wrap.className = 'ctl';
    wrap.innerHTML = `${label ? `<div class="ctl-lab"><span>${label}</span></div>` : ''}<div class="seg" role="group" aria-label="${esc(label || id)}">${options.map(o => `<button type="button" data-v="${esc(o.value)}" aria-pressed="false">${o.label}</button>`).join('')}</div>${help ? `<div class="ctl-help">${help}</div>` : ''}`;
    const btns = [...wrap.querySelectorAll('button')];
    const setValue = v => { btns.forEach(b => b.setAttribute('aria-pressed', b.dataset.v === String(v))); this.state[id] = v; };
    const typed = x => { const o = options.find(o => String(o.value) === String(x)); return o ? o.value : undefined; };
    setValue(this._initial(id, value ?? options[0].value, typed));
    const fire = () => { onChange && onChange(this.state[id], this.state); this._emit(id); };
    btns.forEach(b => b.addEventListener('click', () => { setValue(typed(b.dataset.v)); fire(); }));
    this.el.appendChild(wrap); this.ctl[id] = { wrap, setValue, fire, persist };
    return { el: wrap };
  }
  button({ label, onClick, variant = '', title = '' }) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm ' + (variant ? 'btn-' + variant : ''); b.innerHTML = label; if (title) b.title = title;
    b.addEventListener('click', onClick);
    const wrap = document.createElement('div'); wrap.className = 'ctl-buttons'; wrap.appendChild(b); this.el.appendChild(wrap);
    return b;
  }
  buttons(list) {
    const wrap = document.createElement('div'); wrap.className = 'ctl-buttons';
    const out = list.map(({ label, onClick, variant = '', title = '' }) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm ' + (variant ? 'btn-' + variant : ''); b.innerHTML = label; if (title) b.title = title; b.addEventListener('click', onClick); wrap.appendChild(b); return b; });
    this.el.appendChild(wrap); return out;
  }
  presets(list, title = 'Presets') {
    this.section(title);
    const wrap = document.createElement('div'); wrap.className = 'presets';
    list.forEach(p => { const b = document.createElement('button'); b.type = 'button'; b.textContent = p.label; if (p.title) b.title = p.title; b.addEventListener('click', () => { this.setMany(p.values); p.onApply && p.onApply(); window.FFP && FFP.toast && FFP.toast('Preset: ' + p.label); }); wrap.appendChild(b); });
    this.el.appendChild(wrap); return wrap;
  }
  /** "Save investigation" → stores parameters + readouts + note in the notebook and snapshot log. */
  saveButton(slug, extra) {
    return this.button({
      label: 'Save investigation', variant: '', title: 'Store the current settings and results in your notebook',
      onClick: () => {
        const data = { params: this.values(), results: extra ? extra() : {} };
        const lines = [`### Investigation — ${new Date().toLocaleString()}`, '', 'Parameters: ' + Object.entries(data.params).map(([k, v]) => `${k} = ${typeof v === 'number' ? +v.toPrecision(4) : v}`).join(', ')];
        if (data.results && Object.keys(data.results).length) lines.push('Results: ' + Object.entries(data.results).map(([k, v]) => `${k} = ${typeof v === 'number' ? +v.toPrecision(4) : v}`).join(', '));
        lines.push(`Link: ${location.href}`, '');
        if (window.FFP && FFP.store) {
          FFP.store.addSnapshot(slug, data);
          const prev = FFP.store.note(location.pathname);
          FFP.store.setNote(location.pathname, (prev ? prev + '\n\n' : '') + lines.join('\n'));
          FFP.toast('Saved to your notebook (press N to open)');
        }
      }
    });
  }
}

export class Readouts {
  constructor(container) { this.el = typeof container === 'string' ? document.querySelector(container) : container; this.items = {}; }
  add({ id, label, unit = '', digits = 2, note = '', format }) {
    const d = document.createElement('div'); d.className = 'readout';
    d.innerHTML = `<div class="ro-label">${label}</div><div class="ro-value">—<small>${unit}</small></div>${note ? `<div class="ro-note">${note}</div>` : ''}`;
    this.el.appendChild(d);
    this.items[id] = { el: d, v: d.querySelector('.ro-value'), unit, digits, format, n: d.querySelector('.ro-note') };
    return this;
  }
  set(id, value, status, note) {
    const it = this.items[id]; if (!it) return;
    it.value = value;
    it.v.innerHTML = `${it.format ? it.format(value) : fmt(value, it.digits)}<small>${it.unit}</small>`;
    it.el.classList.remove('ok', 'warn', 'bad'); if (status) it.el.classList.add(status);
    if (note != null) {
      if (!it.n) { it.n = document.createElement('div'); it.n.className = 'ro-note'; it.el.appendChild(it.n); }
      it.n.innerHTML = note;
    }
  }
  values() { const o = {}; Object.entries(this.items).forEach(([k, v]) => o[k] = v.value); return o; }
}

/**
 * Simulation clock with play/pause and speed. Calls step(dtSim, tSim) each animation frame.
 * const clock = new SimClock({ speed: 3600, onStep: (dt, t) => …, maxDt: 60 });
 * clock.play(); clock.pause(); clock.toggle(); clock.reset(); clock.speed = 7200;
 * `maxDt` sub-steps the integration so large speeds remain stable.
 */
export class SimClock {
  constructor({ speed = 1, onStep, onFrame, maxDt = Infinity, autoplay = false } = {}) {
    this.speed = speed; this.onStep = onStep; this.onFrame = onFrame; this.maxDt = maxDt;
    this.t = 0; this.running = false; this._last = null;
    this._loop = this._loop.bind(this);
    if (autoplay) this.play();
  }
  play() { if (this.running) return; this.running = true; this._last = performance.now(); requestAnimationFrame(this._loop); this._notify(); }
  pause() { this.running = false; this._notify(); }
  toggle() { this.running ? this.pause() : this.play(); }
  reset(t = 0) { this.t = t; this._notify(); }
  stepOnce(dtSim) { this._advance(dtSim); this.onFrame && this.onFrame(this.t); }
  onState(cb) { this._stateCb = cb; }
  _notify() { this._stateCb && this._stateCb(this.running); }
  _advance(total) {
    let rem = total;
    while (rem > 1e-12) { const d = Math.min(rem, this.maxDt); this.onStep && this.onStep(d, this.t); this.t += d; rem -= d; }
  }
  _loop(now) {
    if (!this.running) return;
    const dtReal = Math.min(0.1, (now - this._last) / 1000); this._last = now;
    this._advance(dtReal * this.speed);
    this.onFrame && this.onFrame(this.t);
    requestAnimationFrame(this._loop);
  }
}

/** Format seconds as d h:mm. */
export function fmtTime(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return (d ? `day ${d + 1} · ` : '') + `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Attach standard toolbar buttons (fullscreen, screenshot, reset view) to a .stage element. */
export function stageToolbar(stageEl, { onReset, onShot, extra = [] } = {}) {
  const I = {
    full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    shot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/></svg>'
  };
  const bar = document.createElement('div'); bar.className = 'stage-toolbar';
  const add = (html, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.innerHTML = html; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', fn); bar.appendChild(b); return b; };
  extra.forEach(e => add(e.icon, e.title, e.onClick));
  if (onReset) add(I.reset, 'Reset view', onReset);
  if (onShot) add(I.shot, 'Save screenshot', onShot);
  add(I.full, 'Fullscreen', () => { if (document.fullscreenElement) document.exitFullscreen(); else stageEl.requestFullscreen && stageEl.requestFullscreen(); });
  stageEl.appendChild(bar);
  return bar;
}

/** Small HUD chips overlay on a stage: const hud = hudChips(stage); hud.set('t', 'Time <b>12:00</b>'); */
export function hudChips(stageEl, { position = 'top-left', layout = 'column' } = {}) {
  const box = document.createElement('div'); box.className = 'stage-hud'; stageEl.appendChild(box);
  // layout: 'column' (default, chips stacked) | 'row' (chips side by side, wrapping)
  if (layout === 'row') Object.assign(box.style, { flexDirection: 'row', flexWrap: 'wrap', maxWidth: 'calc(100% - 120px)' });
  // position: 'top-left' (default) | 'top-right' | 'bottom-left' | 'bottom-right'
  if (position !== 'top-left') { const [v, h] = position.split('-'); Object.assign(box.style, { top: v === 'top' ? '12px' : 'auto', bottom: v === 'bottom' ? '12px' : 'auto', left: h === 'left' ? '12px' : 'auto', right: h === 'right' ? '12px' : 'auto', alignItems: h === 'right' ? 'flex-end' : 'flex-start' }); if (v === 'top' && h === 'right') box.style.top = '56px'; }
  const chips = {};
  return {
    el: box,
    set(id, html) { if (!chips[id]) { chips[id] = document.createElement('div'); chips[id].className = 'hud-chip'; box.appendChild(chips[id]); } chips[id].innerHTML = html; },
    remove(id) { if (chips[id]) { chips[id].remove(); delete chips[id]; } }
  };
}
