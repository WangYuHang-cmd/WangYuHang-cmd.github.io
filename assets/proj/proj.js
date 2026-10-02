/* Project-page kit · behaviours and data widgets. Vanilla JS, no dependencies; one global: window.Proj.
   Data contracts: assets/proj/CONTRACTS.md. Chrome ports: openlka/static/openlka.js (nav, reveal, count-up, tabs, modals, BibTeX),
   render/sync loop, promise cache and strip interaction ported from openlka/static/can.js.
   Widgets boot lazily from [data-widget] once within 600 px of the viewport; every widget renders its final chrome synchronously,
   then data. Failure of any kind (404, parse, shape) → .is-error → the author's <figure class="pj-fallback"> is shown. */
(function () {
  'use strict';
  var doc = document, win = window;
  var $ = function (s, r) { return (r || doc).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };
  var dbg = function () { if (win.console && console.debug) console.debug.apply(console, ['[proj]'].concat(Array.prototype.slice.call(arguments))); };
  var mqReduce = win.matchMedia('(prefers-reduced-motion: reduce)');
  function reduced() { return mqReduce.matches || doc.body.getAttribute('data-motion') === 'reduce'; }
  function saveData() { return !!(navigator.connection && navigator.connection.saveData); }
  var DPR = Math.min(1.5, win.devicePixelRatio || 1);
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', SANS = 'Inter, "Inter Fallback", system-ui, sans-serif';
  var MPH = 2.23694;

  /* ====================================================================== helpers */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function lerp(a, b, u) { return a + (b - a) * u; }
  function fmtInt(v) { return Math.round(v).toLocaleString('en-US'); }
  function fmtNum(v, dp) { return isNum(v) ? (dp === 0 ? fmtInt(v) : v.toFixed(dp == null ? 2 : dp)) : '—'; }
  function fmtClock(t) { t = Math.max(0, t || 0); var m = Math.floor(t / 60), s = Math.floor(t - m * 60); return m + ':' + (s < 10 ? '0' : '') + s; }
  function signed(v, dp) { return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(dp); }
  function setText(el, s) { if (el && el.textContent !== s) el.textContent = s; }
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function svgEl(tag, attrs) { var e = doc.createElementNS('http://www.w3.org/2000/svg', tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function cssVar(node, name, fb) { var v = ''; try { v = getComputedStyle(node).getPropertyValue(name).trim(); } catch (e) { /* detached */ } return v || fb; }
  function onIdle(fn) { if ('requestIdleCallback' in win) win.requestIdleCallback(fn, { timeout: 2500 }); else setTimeout(fn, 600); }
  function afterLoad(fn) { if (doc.readyState === 'complete') fn(); else win.addEventListener('load', fn, { once: true }); }
  function upperBound(arr, t, key) { var lo = 0, hi = arr.length; key = key || function (x) { return x; }; while (lo < hi) { var mid = (lo + hi) >> 1; if (key(arr[mid]) <= t) lo = mid + 1; else hi = mid; } return lo; }
  function debounce(fn, ms) { var h = 0; return function () { var a = arguments, s = this; clearTimeout(h); h = setTimeout(function () { fn.apply(s, a); }, ms); }; }
  function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.replace(/(.)/g, '$1$1'); var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgba(c, a) { if (!c) return 'rgba(255,255,255,' + a + ')'; if (c[0] === '#') { var r = hexToRgb(c); return 'rgba(' + r[0] + ',' + r[1] + ',' + r[2] + ',' + a + ')'; } var m = c.match(/^rgba?\(([^)]+)\)/); if (m) { var p = m[1].split(',').slice(0, 3).map(function (x) { return x.trim(); }); return 'rgba(' + p.join(',') + ',' + a + ')'; } return c; }
  var TOK = { accent: '--pj-accent', 'accent-2': '--pj-accent-2', blue: '--cl-blue', violet: '--cl-violet', gold: '--cl-gold', mint: '--cl-mint', coral: '--cl-coral', cyan: '--cl-cyan', mute: '--cl-text-mute', text: '--cl-text', ok: '--cl-ok', crit: '--cl-crit' };
  function tok(name, node) { if (!name) return cssVar(node || doc.body, '--pj-accent', '#33e0ff'); if (name === 'white') return '#ffffff'; if (name[0] === '#' || /^rgb/.test(name)) return name; var v = TOK[name]; return v ? cssVar(node || doc.body, v, '#9fb2d6') : name; }
  function b64Bytes(s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function b64I16(s) { var u = b64Bytes(s); return new Int16Array(u.buffer, u.byteOffset, u.byteLength >> 1); }
  function b64U16(s) { var u = b64Bytes(s); return new Uint16Array(u.buffer, u.byteOffset, u.byteLength >> 1); }
  function b64U8(s) { return b64Bytes(s); }
  function sizeCanvas(c, fbW, fbH) { var w = c.clientWidth || fbW || 600, h = c.clientHeight || fbH || 68, bw = Math.round(w * DPR), bh = Math.round(h * DPR); if (c.width !== bw) c.width = bw; if (c.height !== bh) c.height = bh; return { w: w, h: h }; }
  function drawTrace(ctx, xs, ys, i0, i1, color, width, dash) {
    ctx.beginPath(); var pen = false;
    for (var i = i0; i <= i1; i++) { var y = ys(i); if (y == null || y !== y) { pen = false; continue; } var x = xs(i); if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; } }
    ctx.strokeStyle = color; ctx.lineWidth = width || 1.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
  }
  function hatch(ctx, color) { var c = doc.createElement('canvas'); c.width = c.height = 8; var x = c.getContext('2d'); x.strokeStyle = color; x.lineWidth = 1.5; x.beginPath(); x.moveTo(0, 8); x.lineTo(8, 0); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke(); return ctx.createPattern(c, 'repeat'); }
  function fetchJSON(u, signal) { return fetch(u, { signal: signal, credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return r.json(); }); }

  /* ====================================================================== data: manifest, url, json cache, shape checks */
  var manifestP = null, jsonCache = new Map();
  function manifest() {
    if (manifestP) return manifestP;
    var src = doc.body.getAttribute('data-manifest');
    manifestP = src ? fetchJSON(src).catch(function (e) { dbg('manifest unavailable:', e.message); return null; }) : Promise.resolve(null);
    return manifestP;
  }
  function url(src) { // "key:name" → manifest entry (hash-busted); anything else is a path
    if (!src) return Promise.resolve(null);
    if (src.indexOf('key:') !== 0) return Promise.resolve(src);
    var key = src.slice(4);
    return manifest().then(function (m) { var f = m && m.files && m.files[key]; if (!f || !f.path) throw new Error('manifest has no file "' + key + '"'); return f.path + (f.sha256 ? '?v=' + String(f.sha256).slice(0, 8) : ''); });
  }
  function json(src, signal) { // memoised per resolved URL; a failure evicts itself so the next caller retries
    return url(src).then(function (u) {
      var c = jsonCache.get(u); if (c) return c;
      var p = fetchJSON(u, signal).catch(function (e) { if (jsonCache.get(u) === p) jsonCache.delete(u); throw e; });
      jsonCache.set(u, p); return p;
    });
  }
  function inlineJSON(id) { var s = id && doc.getElementById(id); if (!s) return null; try { return JSON.parse(s.textContent); } catch (e) { return null; } }
  function arr(a, n, name) { if (!Array.isArray(a)) throw new Error(name + ' missing'); if (n != null && a.length !== n) throw new Error(name + ' length ' + a.length + ' ≠ ' + n); return a; }
  function monotonic(t, hz) { var step = 1 / hz; for (var i = 1; i < t.length; i++) { if (!(t[i] > t[i - 1])) throw new Error('t not increasing at ' + i); if (hz && Math.abs(t[i] - t[i - 1] - step) > 1e-3 + step * 0.01) throw new Error('t step ≠ 1/hz at ' + i); } }
  function assertShape(kind, o) {
    if (!o || typeof o !== 'object') throw new Error('not an object');
    var sch = String(o.schema || ''); if (sch.indexOf(kind + '/1') !== 0) throw new Error('schema "' + sch + '" is not ' + kind + '/1');
    var n, k;
    if (kind === 'signals') {
      n = o.n; if (!isNum(n) || n < 2) throw new Error('n'); if (!isNum(o.hz) || o.hz <= 0) throw new Error('hz');
      if (!o.cols || !Array.isArray(o.cols.t)) throw new Error('cols.t missing'); for (k in o.cols) arr(o.cols[k], n, 'cols.' + k);
      monotonic(o.cols.t, o.hz);
      var t0 = o.cols.t[0], t1 = o.cols.t[n - 1];
      (o.events || []).forEach(function (e, i) { if (!isNum(e.t) || e.t < t0 - 1e-6 || e.t > t1 + 1 / o.hz + 1e-6) throw new Error('events[' + i + '].t outside clip'); });
      (o.series || []).forEach(function (s, i) { arr(s.t, null, 'series[' + i + '].t'); arr(s.v, s.t.length, 'series[' + i + '].v'); });
      (o.bands || []).forEach(function (b, i) { arr(b.t, null, 'bands[' + i + '].t'); for (k in (b.q || {})) arr(b.q[k], b.t.length, 'bands[' + i + '].q.' + k); });
      (o.fans || []).forEach(function (f, i) { if (!isNum(f.anchor_t) || !isNum(f.step_s) || !isNum(f.horizon_s)) throw new Error('fans[' + i + '] anchor/step/horizon'); arr(f.p, Math.round(f.horizon_s / f.step_s), 'fans[' + i + '].p'); });
    } else if (kind === 'timeline') {
      if (!Array.isArray(o.span) || !(o.span[0] < o.span[1])) throw new Error('span');
      arr(o.lanes, null, 'lanes').forEach(function (l, i) { arr(l.segs, null, 'lanes[' + i + '].segs').forEach(function (s) { if (!(s[0] <= s[1]) || s[0] < o.span[0] - 1e-6 || s[1] > o.span[1] + 1e-6) throw new Error('seg outside span'); }); (l.marks || []).forEach(function (m) { if (!isNum(m.t) || m.t < o.span[0] || m.t > o.span[1]) throw new Error('mark outside span'); }); });
    } else if (kind === 'embedding') {
      n = o.n; if (!isNum(n) || n < 1) throw new Error('n'); if (!Array.isArray(o.bbox) || o.bbox.length !== 4) throw new Error('bbox');
      var xy = b64I16(o.xy_i16); if (xy.length !== 2 * n) throw new Error('xy_i16 length ' + xy.length + ' ≠ 2n');
      for (k in (o.dims || {})) { var d = o.dims[k], idx = b64U16(d.idx); if (idx.length !== n) throw new Error('dims.' + k + '.idx length'); for (var i = 0; i < n; i++) if (idx[i] >= d.names.length) throw new Error('dims.' + k + ' idx ≥ names'); }
    } else if (kind === 'kpts') {
      n = o.n; var K = o.K || 133; if (!isNum(n) || n < 1) throw new Error('n'); if (!isNum(o.hz)) throw new Error('hz');
      if (b64I16(o.kpts).length !== n * K * 2) throw new Error('kpts length'); if (b64U8(o.score).length !== n * K) throw new Error('score length');
      if (!(o.aspect > 0)) throw new Error('aspect'); if (!Array.isArray(o.crop) || !(o.crop[0] < o.crop[2]) || !(o.crop[1] < o.crop[3])) throw new Error('crop');
      if (o.can) for (k in o.can) arr(o.can[k], n, 'can.' + k);
    } else if (kind === 'paired') { arr(o.groups, null, 'groups').forEach(function (g, i) { arr(g.rows, null, 'groups[' + i + '].rows'); }); if (!o.axis || !isNum(o.axis.min) || !isNum(o.axis.max)) throw new Error('axis'); }
    else if (kind === 'bars') { arr(o.rows, null, 'rows'); }
    else if (kind === 'hist') { if (!isNum(o.bin_w)) throw new Error('bin_w'); arr(o.groups, null, 'groups').forEach(function (g, i) { arr(g.counts, null, 'groups[' + i + '].counts'); }); }
    else if (kind === 'sources') { arr(o.sources, null, 'sources').forEach(function (s) { if (s.kind === 'unpublished') throw new Error('source ' + s.id + ' is unpublished'); }); }
    return o;
  }
  function load(src, kind, signal) { return json(src, signal).then(function (o) { return assertShape(kind, o); }); }

  /* ====================================================================== transport bus */
  var bus = (function () {
    var groups = {}, last = {};
    function g(name) { return groups[name] || (groups[name] = { t: 0, hover: null, owner: null }); }
    function emit(type, detail) { doc.dispatchEvent(new CustomEvent(type, { detail: detail })); }
    return {
      group: g,
      time: function (name, t, hover, src) { // ≤ 30 Hz per group
        if (!name) return; var G = g(name), now = performance.now(); G.t = t; G.hover = hover; G.owner = src || G.owner;
        if (now - (last[name] || 0) < 33 && hover == null) return; last[name] = now; emit('pj:time', { group: name, t: t, hover: hover, src: src });
      },
      seek: function (name, t, play) { if (name) { g(name).t = t; emit('pj:seek', { group: name, t: t, play: !!play }); } },
      hover: function (name, t) { if (name) { g(name).hover = t; emit('pj:hover', { group: name, t: t }); } },
      on: function (type, fn) { doc.addEventListener(type, fn); return function () { doc.removeEventListener(type, fn); }; }
    };
  })();

  /* ====================================================================== modal state (shared with widgets: everything pauses while a modal is open) */
  var modalsOpen = 0, modalWatchers = [];
  function modalOpen() { return modalsOpen > 0; }
  function onModal(fn) { modalWatchers.push(fn); }
  function setModal(delta) { modalsOpen = Math.max(0, modalsOpen + delta); modalWatchers.forEach(function (f) { f(modalOpen()); }); }

  /* ====================================================================== Widget base */
  var registry = {}, instances = new Map(), KEYS = '[role="button"], [tabindex]:not(.pj-w), button, a, input, summary, select, textarea, [contenteditable]';
  function Widget(root, opts) {
    this.root = root; this.opts = opts || {}; this.mode = root.getAttribute('data-mode') || 'full'; this.sync = root.getAttribute('data-sync') || null;
    this.hero = this.mode === 'hero'; this.visible = false; this.visible50 = false; this.announceT = 0; this.booted = false; this.destroyed = false;
    root.classList.add('pj-w', 'is-js'); root.setAttribute('data-mode', this.mode);
    if (!root.hasAttribute('tabindex') && !this.hero) root.setAttribute('tabindex', '0');
    if (!root.hasAttribute('role')) root.setAttribute('role', 'group');
    if (!root.hasAttribute('aria-label')) root.setAttribute('aria-label', root.getAttribute('data-label') || (this.name + ' widget'));
    this.body = $('.pj-w__body', root); if (!this.body) { this.body = el('div', 'pj-w__body'); var fb = $('.pj-fallback', root); if (fb) root.insertBefore(this.body, fb); else root.appendChild(this.body); }
    this.live = el('p', 'vh'); this.live.setAttribute('aria-live', 'polite'); root.appendChild(this.live);
    if (!this.hero) { this.twinEl = el('details', 'pj-twin'); var su = el('summary', null, 'Data as text'); this.twinEl.appendChild(su); this.twinBody = el('div'); this.twinEl.appendChild(this.twinBody); root.appendChild(this.twinEl); }
    var self = this;
    if ('IntersectionObserver' in win) {
      new IntersectionObserver(function (es) { var e = es[es.length - 1]; self.visible = e.isIntersecting; self.visible50 = e.intersectionRatio >= 0.5; self.onVisibility(); }, { threshold: [0, 0.5] }).observe(root);
    } else { this.visible = this.visible50 = true; }
    doc.addEventListener('visibilitychange', function () { self.onVisibility(); });
    onModal(function () { self.onVisibility(); });
    root.addEventListener('keydown', function (ev) { if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey || modalOpen()) return; var tg = ev.target; if (tg && tg !== root && tg.closest && tg.closest(KEYS) && tg.tagName !== 'CANVAS') return; if (self.onKey(ev)) ev.preventDefault(); });
  }
  Widget.prototype.name = 'widget';
  Widget.prototype.onVisibility = function () {};
  Widget.prototype.onKey = function () { return false; };
  Widget.prototype.setLoading = function (on) { this.root.classList.toggle('is-loading', !!on); };
  Widget.prototype.ok = function () { this.root.classList.remove('is-loading', 'is-error'); this.root.classList.add('is-live'); var e = $('.pj-w__err', this.root); if (e) e.remove(); doc.dispatchEvent(new CustomEvent('pj:ready', { detail: { el: this.root, widget: this.name } })); };
  Widget.prototype.fail = function (err) {
    dbg(this.name, 'failed:', err && err.message); this.root.classList.remove('is-loading', 'is-live'); this.root.classList.add('is-error');
    if (!$('.pj-w__err', this.root)) { var e = el('p', 'pj-w__err', 'Data unavailable — showing the static figure.'); e.setAttribute('role', 'note'); this.root.appendChild(e); }
    if (this.twinEl) this.twinEl.hidden = true;
  };
  Widget.prototype.announce = function (msg) { var self = this; clearTimeout(this.announceT); this.announceT = setTimeout(function () { self.live.textContent = msg; }, 150); };
  Widget.prototype.twin = function (node) { if (!this.twinBody) return; this.twinBody.innerHTML = ''; if (typeof node === 'string') this.twinBody.innerHTML = node; else if (node) this.twinBody.appendChild(node); };
  Widget.prototype.tip = function (host, xFrac, yPx, text) {
    if (!this.tipEl) { this.tipEl = el('div', 'pj-tip'); this.tipEl.hidden = true; host.appendChild(this.tipEl); }
    this.tipEl.hidden = false; this.tipEl.style.setProperty('--x', (clamp(xFrac, 0, 1) * 100).toFixed(2) + '%'); this.tipEl.style.setProperty('--y', Math.round(yPx) + 'px'); this.tipEl.textContent = text;
  };
  Widget.prototype.hideTip = function () { if (this.tipEl) this.tipEl.hidden = true; };
  Widget.prototype.colors = function () { var r = this.root; return { accent: tok('accent', r), accent2: tok('accent-2', r), blue: tok('blue', r), violet: tok('violet', r), gold: tok('gold', r), mint: tok('mint', r), coral: tok('coral', r), cyan: tok('cyan', r), mute: tok('mute', r), text: tok('text', r), ok: tok('ok', r), crit: tok('crit', r), grid: 'rgba(159,178,214,.18)' }; };
  function register(name, ctor) { registry[name] = ctor; ctor.prototype.name = name; }
  function boot(root) {
    if (instances.has(root)) return instances.get(root);
    var name = root.getAttribute('data-widget'), ctor = registry[name]; if (!ctor) { dbg('unknown widget', name); return null; }
    var w = new ctor(root); instances.set(root, w);
    try { w.start(); } catch (e) { w.fail(e); }
    return w;
  }
  function bootAll(scope) {
    var roots = $$('[data-widget]', scope);
    if (!('IntersectionObserver' in win)) { roots.forEach(boot); return; }
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); boot(e.target); } }); }, { rootMargin: '600px 0px' });
    roots.forEach(function (r) { if (instances.has(r)) return; if (r.hasAttribute('data-eager')) boot(r); else io.observe(r); });
  }

  /* ====================================================================== Scrubber */
  function Scrubber(root) { Widget.call(this, root); }
  Scrubber.prototype = Object.create(Widget.prototype);
  Scrubber.prototype.start = function () {
    var self = this, root = this.root, body = this.body;
    this.st = { sig: null, t: 0, playing: false, hover: null, drag: null, dirty: true, raf: 0, hz: 10, n: 0, t0: 0, dur: 0, events: [], ranges: {}, bandId: null, bandFrom: null, bandAt: 0, userStarted: false, userPaused: false, prevT: 0, clock0: 0, pendingSeek: null, full: false, clips: null, clip: null, abort: null, lastText: 0 };
    // media (author-provided or none)
    this.media = $('.pj-sc__media', root); this.video = this.media && $('video', this.media);
    if (this.media && this.media.parentNode !== body) body.appendChild(this.media);
    var stripsBox = $('.pj-sc__strips', root); if (!stripsBox) { stripsBox = el('div', 'pj-sc__strips'); } if (stripsBox.parentNode !== body) body.appendChild(stripsBox);
    this.stripsBox = stripsBox;
    if (this.media) { root.classList.toggle('pj-sc--side', root.hasAttribute('data-side')); var stage = el('div', 'pj-sc__stage'); body.insertBefore(stage, this.media); stage.appendChild(this.media); if (root.hasAttribute('data-side')) stage.appendChild(stripsBox); }
    if (this.media && !this.hero) {
      var pb = el('button', 'pj-sc__play'); pb.type = 'button'; pb.setAttribute('aria-label', 'Play clip');
      pb.innerHTML = '<svg class="ic ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l12-7z" fill="currentColor" stroke="none"/></svg><svg class="ic ic-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
      this.media.appendChild(pb); this.playBtn = pb; pb.addEventListener('click', function () { self.toggle(); });
    }
    if (this.media) { this.hud = $('.pj-sc__hud', this.media); if (!this.hud) { this.hud = el('div', 'pj-sc__hud'); this.media.appendChild(this.hud); } this.lamp = el('span', 'pj-sc__lamp'); this.lamp.setAttribute('aria-hidden', 'true'); this.media.appendChild(this.lamp); }
    // strips: authored canvases or generated from data-strips
    this.strips = $$('canvas.pj-strip', stripsBox).map(function (c) { return self.stripSpec(c); });
    this.authoredStrips = this.strips.length > 0;
    if (!this.hero) {
      this.scrub = el('input', 'pj-sc__scrub'); this.scrub.type = 'range'; this.scrub.min = '0'; this.scrub.max = '100'; this.scrub.step = '1'; this.scrub.value = '0'; this.scrub.setAttribute('aria-label', 'Clip position'); stripsBox.appendChild(this.scrub);
      var row = el('div', 'pj-sc__row'); this.legend = el('p', 'pj-legend'); row.appendChild(this.legend);
      this.winBtn = el('button', 'chip chip--sm', 'Full clip'); this.winBtn.type = 'button'; this.winBtn.setAttribute('aria-pressed', 'false'); row.appendChild(this.winBtn); stripsBox.appendChild(row);
      this.winBtn.addEventListener('click', function () { self.st.full = !self.st.full; self.winBtn.setAttribute('aria-pressed', String(self.st.full)); self.winBtn.textContent = self.st.full ? 'Zoom · 20 s' : 'Full clip'; root.classList.toggle('is-full', self.st.full); self.st.dirty = true; self.kick(); });
      this.scrub.addEventListener('input', function () { self.st.scrubbing = true; self.seek(+self.scrub.value / 10, 'scrub'); });
      this.scrub.addEventListener('change', function () { self.st.scrubbing = false; self.st.userStarted = true; self.seek(+self.scrub.value / 10); });
      this.tabs = $('.pj-sc__tabs', root); if (!this.tabs) { this.tabs = el('div', 'pj-sc__tabs'); this.tabs.setAttribute('role', 'tablist'); body.insertBefore(this.tabs, body.firstChild); }
      this.evList = el('ol', 'pj-sc__events'); body.appendChild(this.evList);
      var rib = root.getAttribute('data-ribbon'); if (rib) { var r = el('p', 'pj-ribbon'); r.innerHTML = rib; body.appendChild(r); }
      // compact transport for narrow screens
      var tr = el('div', 'pj-transport'); var tb = el('button', 'btn btn--sm', 'Play/Pause'); tb.type = 'button'; tb.addEventListener('click', function () { self.toggle(); }); var pe = el('button', 'btn btn--sm', '⟨ event'); pe.type = 'button'; pe.addEventListener('click', function () { self.jumpEvent(-1); }); var ne = el('button', 'btn btn--sm', 'event ⟩'); ne.type = 'button'; ne.addEventListener('click', function () { self.jumpEvent(1); }); tr.appendChild(pe); tr.appendChild(tb); tr.appendChild(ne); body.appendChild(tr);
    }
    if (this.video) {
      this.video.loop = true; this.video.muted = true; this.video.setAttribute('muted', ''); this.video.playsInline = true; this.video.setAttribute('playsinline', '');
      this.video.addEventListener('play', function () { self.setPlaying(true); }); this.video.addEventListener('pause', function () { self.setPlaying(false); });
      this.video.addEventListener('seeked', function () { self.st.t = self.video.currentTime; self.st.dirty = true; self.kick(); });
      this.video.addEventListener('loadedmetadata', function () { if (!self.st.sig && isNum(self.video.duration)) { self.st.dur = self.video.duration; self.st.dirty = true; self.kick(); } });
      if (this.hero) this.video.removeAttribute('controls');
    }
    // sync group
    if (this.sync) {
      bus.on('pj:seek', function (ev) { if (ev.detail.group !== self.sync || ev.detail.src === self) return; if (!self.st.sig) { self.st.pendingSeek = ev.detail; return; } self.seek(ev.detail.t, 'bus'); if (ev.detail.play) self.play(); });
      bus.on('pj:time', function (ev) { if (ev.detail.group !== self.sync || ev.detail.src === self || self.ownsClock()) return; self.st.t = ev.detail.t; self.st.hover = ev.detail.hover; self.st.dirty = true; self.kick(); });
      bus.on('pj:hover', function (ev) { if (ev.detail.group !== self.sync || ev.detail.src === self) return; self.st.hover = ev.detail.t; self.st.dirty = true; self.kick(); });
    }
    this.sizeStrips(); this.bindStrips();
    if ('ResizeObserver' in win) { var ro = new ResizeObserver(debounce(function () { self.sizeStrips(); }, 100)); ro.observe(stripsBox); }
    var src = root.getAttribute('data-src'); if (!src) throw new Error('data-src missing');
    this.setLoading(true);
    var bsrc = root.getAttribute('data-bands'); this.bandsP = bsrc ? json(bsrc).then(function (b) { return (b && b.bands) || []; }).catch(function (e) { dbg('bands skipped:', e.message); return []; }) : Promise.resolve(null);
    json(src).then(function (o) {
      if (o && Array.isArray(o.clips)) { self.st.clips = o.clips; self.buildTabs(o.clips); return self.selectClip(o['default'] || o.clips[0].id); }
      return self.withBands(assertShape('signals', o)).then(function (sig) { self.applySignals(sig); });
    }).catch(function (e) { self.fail(e); });
  };
  Scrubber.prototype.ownsClock = function () { return !!(this.video || this.hero || !this.sync || bus.group(this.sync).owner === this || !bus.group(this.sync).owner); };
  Scrubber.prototype.stripSpec = function (c) {
    var d = c.dataset, layers = {}; (d.layers || '').split(';').forEach(function (p) { var kv = p.split(':'); if (kv.length === 2 && kv[0].trim()) layers[kv[0].trim()] = kv[1].split(',').map(function (s) { return s.trim(); }).filter(Boolean); });
    return { el: c, ctx: c.getContext('2d'), col: d.col || null, label: d.label || d.col || '', unit: d.unit || '', fmt: d.fmt || null, min: d.min != null ? +d.min : null, max: d.max != null ? +d.max : null, sym: d.sym != null, color: d.color || 'accent', col2: d.col2 || null, color2: d.color2 || 'violet', layers: layers, w: 0, h: 0, binary: d.binary != null };
  };
  Scrubber.prototype.autoStrips = function (sig) {
    var self = this, want = (this.root.getAttribute('data-strips') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!want.length) { want = Object.keys(sig.cols).filter(function (k) { return k !== 't' && sig.cols[k].some(isNum); }).slice(0, this.hero ? 1 : 5); }
    this.stripsBox.querySelectorAll('canvas.pj-strip').forEach(function (c) { c.remove(); });
    this.strips = want.map(function (k, i) { var c = el('canvas', 'pj-strip'); c.setAttribute('data-col', k); c.setAttribute('data-label', (sig.labels && sig.labels[k]) || k); c.setAttribute('data-unit', (sig.units && sig.units[k]) || ''); c.setAttribute('data-color', i === 0 ? 'accent' : ['blue', 'violet', 'gold', 'mint'][(i - 1) % 4]); self.stripsBox.insertBefore(c, self.stripsBox.firstChild && self.stripsBox.firstChild.classList && self.stripsBox.firstChild.classList.contains('pj-sc__scrub') ? self.stripsBox.firstChild : (self.scrub || null)); return self.stripSpec(c); });
    this.sizeStrips(); this.bindStrips();
  };
  Scrubber.prototype.sizeStrips = function () { var self = this; this.strips.forEach(function (s) { var b = sizeCanvas(s.el, 600, 68); s.w = b.w; s.h = b.h; }); this.C = this.colors(); this.st.dirty = true; this.kick(); };
  Scrubber.prototype.buildTabs = function (clips) {
    var self = this; if (!this.tabs) return; this.tabs.innerHTML = '';
    clips.forEach(function (c, i) { var b = el('button', 'chip', c.title || c.id); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('data-clip', c.id); b.setAttribute('aria-selected', 'false'); b.tabIndex = -1; if (c.sub) { var s = el('small', null, ' ' + c.sub); b.appendChild(s); }
      b.addEventListener('click', function () { self.selectClip(c.id); }); b.addEventListener('keydown', function (ev) { var bs = $$('[role="tab"]', self.tabs), j = bs.indexOf(b); if (ev.key === 'ArrowRight') j = (j + 1) % bs.length; else if (ev.key === 'ArrowLeft') j = (j - 1 + bs.length) % bs.length; else return; ev.preventDefault(); bs[j].focus(); bs[j].click(); }); self.tabs.appendChild(b); });
  };
  Scrubber.prototype.selectClip = function (id) {
    var self = this, clip = this.st.clips.filter(function (c) { return c.id === id; })[0] || this.st.clips[0]; if (!clip || clip === this.st.clip) return Promise.resolve();
    if (this.st.abort) this.st.abort.abort(); var ac = this.st.abort = win.AbortController ? new AbortController() : null;
    var resume = this.st.playing && !this.st.userPaused; this.st.clip = clip; this.st.userPaused = false;
    if (this.tabs) $$('[role="tab"]', this.tabs).forEach(function (b) { var on = b.getAttribute('data-clip') === clip.id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    if (this.video) { this.video.pause(); if (clip.poster) this.video.poster = clip.poster; if (clip.video) this.video.src = clip.video; else { this.video.removeAttribute('src'); try { this.video.load(); } catch (e) { /* ignore */ } } }
    if (this.media && Array.isArray(clip.frames)) $$('img[data-frame]', this.media).forEach(function (im) { var f = clip.frames[+im.getAttribute('data-frame')]; if (f) im.src = f; });
    if (this.media && clip.drivers) $$('[data-driver]', this.media).forEach(function (e) { var d = clip.drivers[+e.getAttribute('data-driver')]; if (d) e.textContent = d; });
    this.setLoading(true); this.st.t = 0; this.st.prevT = 0;
    return load(clip.src || clip.signals, 'signals', ac && ac.signal).then(function (sig) { return self.withBands(sig); }).then(function (sig) { if (self.st.clip !== clip) return; self.applySignals(sig); if (resume) self.play(); }).catch(function (e) { if (e && e.name === 'AbortError') return; self.fail(e); });
  };
  Scrubber.prototype.withBands = function (sig) { var self = this; return this.bandsP.then(function (b) { if (b && b.length && !(sig.bands && sig.bands.length)) { var copy = Object.assign({}, sig); copy.bands = b; if (self.st.bandId && !b.some(function (x) { return self.bandGroup(x) === self.st.bandId; })) self.st.bandId = null; return copy; } return sig; });
  };
  Scrubber.prototype.applySignals = function (sig) {
    var st = this.st, self = this; st.sig = sig; st.hz = sig.hz; st.n = sig.n; st.t0 = sig.cols.t[0]; st.dur = sig.duration_s || st.n / st.hz; st.events = (sig.events || []).slice().sort(function (a, b) { return a.t - b.t; });
    if (!this.authoredStrips) this.autoStrips(sig);
    st.ranges = {}; this.strips.forEach(function (s) { if (s.col) st.ranges[s.col] = self.rangeOf(s); if (s.col2) st.ranges[s.col2] = st.ranges[s.col]; });
    st.shade = (sig.shade || []).map(function (sh) { return { runs: self.runs(sh.col), color: tok(sh.color || 'accent', self.root), alpha: sh.alpha || 0.12, label: sh.label || sh.col }; });
    st.bandId = sig.bands && sig.bands.length ? this.bandGroup(sig.bands[0]) : null; st.full = this.hero || st.dur <= 120; if (this.winBtn) { this.winBtn.hidden = st.dur <= 30; this.winBtn.textContent = st.full ? 'Zoom · 20 s' : 'Full clip'; this.winBtn.setAttribute('aria-pressed', String(st.full)); } this.root.classList.toggle('is-full', st.full);
    if (this.media && sig.media && !this.video && sig.media.poster) { var im = $('img.pj-sc__poster', this.media) || el('img', 'pj-sc__poster'); im.alt = ''; im.src = sig.media.poster; if (!im.parentNode) this.media.insertBefore(im, this.media.firstChild); if (sig.media.aspect) this.media.style.setProperty('--ar', sig.media.aspect); }
    if (this.scrub) { this.scrub.max = String(Math.max(1, Math.round(st.dur * 10))); this.scrub.value = '0'; }
    this.buildEvents(); this.buildBandChips(); this.buildLegend(); this.buildTwin(); this.ok();
    st.t = st.t0; st.prevT = st.t; st.dirty = true; this.kick();
    if (st.pendingSeek) { var p = st.pendingSeek; st.pendingSeek = null; this.seek(p.t, 'bus'); if (p.play) this.play(); }
    else this.maybeAutoplay();
  };
  Scrubber.prototype.col = function (k) { return this.st.sig ? this.st.sig.cols[k] || null : null; };
  Scrubber.prototype.tOf = function (i) { return this.st.t0 + i / this.st.hz; };
  Scrubber.prototype.idxAt = function (t) { return this.st.n ? clamp(Math.round((t - this.st.t0) * this.st.hz), 0, this.st.n - 1) : 0; };
  Scrubber.prototype.at = function (k, i) { var c = this.col(k); if (!c) return null; var v = c[i]; return v == null ? null : v; };
  Scrubber.prototype.runs = function (k) { var c = this.col(k), out = [], on = -1; if (!c) return out; for (var i = 0; i < this.st.n; i++) { var v = c[i] === 1 || c[i] === true; if (v && on < 0) on = i; if (!v && on >= 0) { out.push([this.tOf(on), this.tOf(i)]); on = -1; } } if (on >= 0) out.push([this.tOf(on), this.tOf(this.st.n)]); return out; };
  Scrubber.prototype.rangeOf = function (s) {
    var sig = this.st.sig, r = sig.ranges && sig.ranges[s.col]; if (s.min != null && s.max != null) return [s.min, s.max]; if (r && r.length === 2) return r;
    if (s.binary) return [0, 1];
    var lo = Infinity, hi = -Infinity, self = this; [s.col, s.col2].forEach(function (k) { var c = k && self.col(k); if (c) for (var i = 0; i < c.length; i++) { var v = c[i]; if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } } });
    (sig.series || []).forEach(function (se) { if ((s.layers.series || []).indexOf(se.id) < 0 && (s.layers.series || []).indexOf('*') < 0) return; se.v.forEach(function (v) { if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }); });
    if (!isFinite(lo)) { lo = 0; hi = 1; } if (s.min != null) lo = s.min; if (s.max != null) hi = s.max;
    if (s.sym) { var m = Math.max(Math.abs(lo), Math.abs(hi)) * 1.1 || 1; return [-m, m]; }
    if (hi === lo) hi = lo + 1; return [Math.min(0, lo), hi + (hi - Math.min(0, lo)) * 0.1];
  };
  Scrubber.prototype.windowAt = function (t) { if (this.st.drag && this.st.drag.win) return this.st.drag.win; var st = this.st; return st.full ? [st.t0, st.t0 + (st.dur || 1)] : [t - 15, t + 5]; };
  Scrubber.prototype.valueText = function (s, t) {
    var sig = this.st.sig; if (!sig) return '—'; var i = this.idxAt(t), v = this.at(s.col, i);
    if (s.fmt === 'mph') return isNum(v) ? Math.round(v * MPH) + ' mph' : '—';
    if (s.fmt === 'kmh') return isNum(v) ? Math.round(v * 3.6) + ' km/h' : '—';
    if (s.fmt === 'pct') return isNum(v) ? Math.round(v * 100) + ' %' : '—';
    if (s.fmt === 'bool') return v === 1 || v === true ? 'yes' : v === 0 || v === false ? 'no' : '—';
    if (s.fmt === 'code' && sig.codes && sig.codes[s.col]) return v == null ? '—' : (sig.codes[s.col][String(v)] || String(v));
    var cap = sig.caps && sig.caps[s.col]; if (v == null && cap != null) return '≥ ' + cap + (s.unit ? ' ' + s.unit : '');
    var txt = isNum(v) ? (s.sym ? signed(v, 1) : (Math.abs(v) >= 100 ? fmtInt(v) : v.toFixed(Math.abs(v) < 1 ? 2 : 1))) : '—'; if (s.col2) { var v2 = this.at(s.col2, i); txt += ' · ' + (isNum(v2) ? v2.toFixed(2) : '—'); }
    return txt + (s.unit && isNum(v) ? ' ' + s.unit : '');
  };
  Scrubber.prototype.drawStrip = function (s, t, win) {
    var ctx = s.ctx, W = s.w, H = s.h; if (!W || !H) return; var st = this.st, sig = st.sig, C = this.C, w0 = win[0], w1 = win[1], span = (w1 - w0) || 1, TOP = 15, BOT = 4, PH = H - TOP - BOT, self = this;
    var rng = st.ranges[s.col] || [0, 1], lo = rng[0], hi = rng[1], X = function (tt) { return (tt - w0) / span * W; }, Y = function (v) { return TOP + (hi - v) / (hi - lo || 1) * PH; };
    var L = s.layers, has = function (kind, id) { var l = L[kind]; return l && (l.indexOf('*') >= 0 || l.indexOf(id) >= 0); };
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    // 1. shade runs
    (st.shade || []).forEach(function (sh) { if (L.shade && !has('shade', sh.label) && L.shade.indexOf('*') < 0) return; ctx.globalAlpha = sh.alpha; ctx.fillStyle = sh.color; sh.runs.forEach(function (r) { if (r[1] < w0 || r[0] > w1) return; var a = X(Math.max(r[0], w0)), b = X(Math.min(r[1], w1)); ctx.fillRect(a, 0, Math.max(1, b - a), H); }); });
    ctx.globalAlpha = 1;
    // 2. caps hatch (values exported as null because they hit a cap)
    var cap = sig && sig.caps && sig.caps[s.col]; if (cap != null && s.col) { var c = this.col(s.col), i0c = clamp(Math.floor((w0 - st.t0) * st.hz), 0, st.n - 1), i1c = clamp(Math.ceil((w1 - st.t0) * st.hz), 0, st.n - 1), run = -1; ctx.fillStyle = s.hatch || (s.hatch = hatch(ctx, rgba(C.mute, .6))); for (var i = i0c; i <= i1c + 1; i++) { var isNull = i <= i1c && c[i] == null; if (isNull && run < 0) run = i; if (!isNull && run >= 0) { ctx.fillRect(X(this.tOf(run)), TOP, Math.max(1, X(this.tOf(i)) - X(this.tOf(run))), 6); run = -1; } } }
    // 3. bands (quantile polygons) with morph
    if (sig && sig.bands && L.bands) { var band = this.activeBand(s), q = band && band.q; if (band && q && (has('bands', band.id) || L.bands.indexOf('*') >= 0)) { var bc = tok(band.color || 'accent', this.root); this.poly(ctx, band.t, q['10'], q['90'], X, Y, w0, w1, rgba(bc, .07)); this.poly(ctx, band.t, q['25'], q['75'], X, Y, w0, w1, rgba(bc, .14)); if (q['50']) drawTrace(ctx, function (k) { return X(band.t[k]); }, function (k) { var v = q['50'][k]; return isNum(v) ? Y(v) : null; }, 0, band.t.length - 1, bc, 1.5); } }
    // 4. thresholds
    (sig && sig.thresholds || []).forEach(function (th) { if (th.col !== s.col && !has('thresholds', th.col || '*')) return; var y = Math.round(Y(th.v)) + .5; ctx.globalAlpha = .8; ctx.strokeStyle = tok(th.color || 'coral', self.root); ctx.lineWidth = 1; ctx.setLineDash(th.style === 'solid' ? [] : [4, 4]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]); if (th.label) { ctx.globalAlpha = 1; ctx.fillStyle = tok(th.color || 'coral', self.root); ctx.font = '600 9.5px ' + SANS; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(th.label, W - 6, y - 2); } });
    // 5. grid + zero
    ctx.globalAlpha = 1; ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); for (var g = 1; g <= 3; g++) { var gy = Math.round(TOP + PH * g / 4) + .5; ctx.moveTo(0, gy); ctx.lineTo(W, gy); } ctx.stroke();
    if (lo < 0 && hi > 0) { ctx.strokeStyle = rgba(C.mute, .45); ctx.beginPath(); var zy = Math.round(Y(0)) + .5; ctx.moveTo(0, zy); ctx.lineTo(W, zy); ctx.stroke(); }
    // 6. series (windowed scores: step/bars end at the window end, never interpolated)
    (sig && sig.series || []).forEach(function (se) { if (!has('series', se.id) && !(L.series && L.series.indexOf('*') >= 0)) return; var col = tok(se.color || 'accent', self.root), n = se.t.length, k0 = Math.max(0, upperBound(se.t, w0) - 2), k1 = Math.min(n - 1, upperBound(se.t, w1) + 1); ctx.globalAlpha = se.alpha != null ? se.alpha : 1; var lw = se.width || 1.5;
      if (se.style === 'bars') { ctx.globalAlpha = .55; ctx.fillStyle = col; for (var k = k0; k <= k1; k++) { var v = se.v[k]; if (!isNum(v)) continue; var x1 = X(se.t[k]), x0 = X(se.t[k] - (se.window_s || (k ? se.t[k] - se.t[k - 1] : 1))); ctx.fillRect(x0 + 1, Y(v), Math.max(1, x1 - x0 - 2), Y(lo) - Y(v)); } ctx.globalAlpha = 1; }
      else if (se.style === 'step') { ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = lw; var pen = false; for (var kk = k0; kk <= k1; kk++) { var vv = se.v[kk]; if (!isNum(vv)) { pen = false; continue; } var xx = X(se.t[kk]), yy = Y(vv), xp = X(se.t[kk] - (se.window_s || (kk ? se.t[kk] - se.t[kk - 1] : 0))); if (!pen) { ctx.moveTo(xp, yy); pen = true; } else ctx.lineTo(xp, yy); ctx.lineTo(xx, yy); } ctx.stroke(); }
      else drawTrace(ctx, function (k) { return X(se.t[k]); }, function (k) { var v = se.v[k]; return isNum(v) ? Y(v) : null; }, k0, k1, col, lw); ctx.globalAlpha = 1; });
    // 7. column trace(s)
    if (sig && st.n && s.col) { var i0 = clamp(Math.floor((w0 - st.t0) * st.hz) - 1, 0, st.n - 1), i1 = clamp(Math.ceil((w1 - st.t0) * st.hz) + 1, 0, st.n - 1), xs = function (i) { return X(self.tOf(i)); };
      var mk = function (k) { var c = self.col(k); return c ? function (i) { var v = c[i]; return isNum(v) ? Y(v) : null; } : null; };
      if (s.col2) { var y2 = mk(s.col2); if (y2) drawTrace(ctx, xs, y2, i0, i1, tok(s.color2, this.root), 1.5); }
      var y1 = mk(s.col); if (y1) { if (s.binary) { var cc = this.col(s.col); ctx.beginPath(); ctx.strokeStyle = tok(s.color, this.root); ctx.lineWidth = 1.5; var pen2 = false; for (var j = i0; j <= i1; j++) { var vj = cc[j]; if (vj == null) { pen2 = false; continue; } var yj = Y(vj ? 1 : 0); if (!pen2) { ctx.moveTo(xs(j), yj); pen2 = true; } else { ctx.lineTo(xs(j), ctx.__ly == null ? yj : ctx.__ly); ctx.lineTo(xs(j), yj); } ctx.__ly = yj; } ctx.__ly = null; ctx.stroke(); } else drawTrace(ctx, xs, y1, i0, i1, tok(s.color, this.root), 1.5); } }
    // 8. forecast fans (wedge anchor→anchor+horizon, upper edge = p[k]); passed wedges fade to ghosts
    (sig && sig.fans || []).forEach(function (f) { if (!has('fans', f.id)) return; var a = f.anchor_t, hz = f.horizon_s, acc = tok('accent', self.root), pEnd = f.p[f.p.length - 1] || 0, passed = t > a + hz, alpha = passed ? .08 : (.10 + .35 * pEnd);
      if (a + hz < w0 || a > w1) return; ctx.beginPath(); ctx.moveTo(X(a), Y(lo)); for (var k = 0; k < f.p.length; k++) ctx.lineTo(X(a + (k + 1) * f.step_s), Y(clamp(f.p[k], lo, hi))); ctx.lineTo(X(a + hz), Y(lo)); ctx.closePath(); ctx.globalAlpha = alpha; ctx.fillStyle = acc; ctx.fill(); ctx.globalAlpha = passed ? .3 : 1; ctx.strokeStyle = acc; ctx.lineWidth = 1.5; ctx.beginPath(); for (var k2 = 0; k2 < f.p.length; k2++) { var px = X(a + (k2 + 1) * f.step_s), py = Y(clamp(f.p[k2], lo, hi)); if (k2) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.stroke(); ctx.globalAlpha = 1;
      var ax = Math.round(X(a)) + .5; ctx.strokeStyle = rgba(acc, .7); ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(ax, TOP); ctx.lineTo(ax, H - BOT); ctx.stroke(); ctx.setLineDash([]); if (f.label && s === self.strips[0]) { ctx.fillStyle = acc; ctx.font = '600 9.5px ' + SANS; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(f.label, ax + 4, H - BOT - 1 - 11 * (sig.fans.indexOf(f) % 2)); } });
    // 9. events
    st.events.forEach(function (ev) { if (ev.t < w0 || ev.t > w1) return; var x = Math.round(X(ev.t)) + .5; ctx.globalAlpha = .8; ctx.strokeStyle = C.gold; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]); if (s === self.strips[0]) { ctx.globalAlpha = 1; ctx.fillStyle = C.gold; ctx.fillRect(x - 6, 1, 12, 12); ctx.fillStyle = '#0a1428'; ctx.font = '700 9px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ev.glyph || (ev.kind || '•')[0].toUpperCase(), x, 7.5); } });
    // 10. hover + cursor
    if (st.hover != null && st.hover >= w0 && st.hover <= w1) { var hx = Math.round(X(st.hover)) + .5; ctx.globalAlpha = .7; ctx.strokeStyle = C.mute; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, H); ctx.stroke(); ctx.setLineDash([]); }
    var cx = Math.round(X(t)) + .5; ctx.globalAlpha = .9; ctx.strokeStyle = C.text; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
    // 11. label + value
    ctx.globalAlpha = 1; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = C.mute; ctx.font = '500 10.5px ' + SANS; ctx.fillText(s.label + (s.unit ? ' · ' + s.unit : ''), 6, 3);
    ctx.textAlign = 'right'; ctx.fillStyle = C.text; ctx.font = '600 11px ' + MONO; ctx.fillText(this.valueText(s, t), W - 6, 3);
  };
  Scrubber.prototype.poly = function (ctx, tt, loA, hiA, X, Y, w0, w1, fill) { if (!loA || !hiA) return; ctx.beginPath(); var n = tt.length, started = false; for (var k = 0; k < n; k++) { if (tt[k] < w0 - 1 || tt[k] > w1 + 1 || !isNum(hiA[k])) continue; var x = X(tt[k]), y = Y(hiA[k]); if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; } } for (var j = n - 1; j >= 0; j--) { if (tt[j] < w0 - 1 || tt[j] > w1 + 1 || !isNum(loA[j])) continue; ctx.lineTo(X(tt[j]), Y(loA[j])); } ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
  Scrubber.prototype.bandGroup = function (b) { return b.group || b.id; };
  Scrubber.prototype.activeBand = function (strip) { // the band of the active group for this strip's column (or the group's only band); 320 ms morph from the previous group
    var sig = this.st.sig, st = this.st; if (!sig.bands || !sig.bands.length) return null; var self = this;
    var pick = function (gid) { var list = sig.bands.filter(function (b) { return self.bandGroup(b) === gid; }); if (!list.length) return null; return (strip && strip.col ? list.filter(function (b) { return !b.col || b.col === strip.col; })[0] : list[0]) || null; };
    var to = pick(st.bandId) || pick(this.bandGroup(sig.bands[0])); if (!to) return null; if (!st.bandFrom || reduced()) return to;
    var from = pick(st.bandFrom); if (!from) return to;
    var u = clamp((performance.now() - st.bandAt) / 320, 0, 1), e = u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; if (u >= 1) { st.bandFrom = null; return to; }
    var out = { id: to.id, color: to.color, t: to.t, q: {} }; Object.keys(to.q).forEach(function (k) { var a = from.q[k] || to.q[k], b = to.q[k]; out.q[k] = b.map(function (v, i) { return isNum(v) && isNum(a[i]) ? lerp(a[i], v, e) : v; }); }); st.dirty = true; this.kick(); return out;
  };
  Scrubber.prototype.buildBandChips = function () {
    var self = this, sig = this.st.sig; if (!this.tabs || !sig.bands) return; var groups = []; sig.bands.forEach(function (b) { var g = self.bandGroup(b); if (!groups.some(function (x) { return x.id === g; })) groups.push({ id: g, label: b.label || g, n: b.n }); }); if (groups.length < 2) return;
    var box = $('.pj-sc__bands', this.root) || el('div', 'pj-sc__tabs pj-sc__bands'); box.innerHTML = ''; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Group');
    groups.forEach(function (g) { var c = el('button', 'chip chip--sm', g.label); c.type = 'button'; c.setAttribute('aria-pressed', String(g.id === self.st.bandId)); if (isNum(g.n)) { var s = el('small', null, ' n = ' + fmtInt(g.n)); c.appendChild(s); } c.addEventListener('click', function () { if (self.st.bandId === g.id) return; self.st.bandFrom = self.st.bandId; self.st.bandAt = performance.now(); self.st.bandId = g.id; $$('.chip', box).forEach(function (x) { x.setAttribute('aria-pressed', String(x === c)); }); self.st.dirty = true; self.kick(); self.announce('Showing ' + g.label); }); box.appendChild(c); });
    if (!box.parentNode) this.body.insertBefore(box, this.stripsBox.parentNode === this.body ? this.stripsBox : this.body.children[1] || null);
  };
  Scrubber.prototype.buildLegend = function () {
    if (!this.legend) return; var sig = this.st.sig, items = [], self = this;
    (this.st.shade || []).forEach(function (sh) { items.push('<span><i class="sw" style="--sw:' + rgba(sh.color, .4) + '"></i>' + sh.label + '</span>'); });
    (sig.bands || []).length && items.push('<span><i class="sw" style="--sw:' + rgba(tok('accent', self.root), .3) + '"></i>p10–p90 · p25–p75 · median</span>');
    (sig.fans || []).length && items.push('<span><i class="sw" style="--sw:' + rgba(tok('accent', self.root), .35) + '"></i>forecast fan</span>');
    (sig.thresholds || []).forEach(function (th) { items.push('<span><i class="sw sw--dash" style="--sw:' + tok(th.color || 'coral', self.root) + '"></i>' + (th.label || 'threshold') + '</span>'); });
    this.st.events.length && items.push('<span><i class="sw" style="--sw:' + tok('gold', self.root) + '"></i>events</span>');
    this.legend.innerHTML = items.join('');
  };
  Scrubber.prototype.buildEvents = function () {
    var self = this; if (!this.evList) return; this.evList.innerHTML = ''; this.evBtns = [];
    this.st.events.forEach(function (ev) { var li = el('li'), b = el('button', 'pj-ev'); b.type = 'button'; b.setAttribute('data-t', String(ev.t)); var tm = el('time', null, fmtClock(ev.t - self.st.t0)); var l = el('span', null, ev.label || ev.kind || 'event'); b.appendChild(tm); b.appendChild(l); b.addEventListener('click', function () { self.st.userStarted = true; self.seek(ev.t); }); li.appendChild(b); self.evList.appendChild(li); self.evBtns.push(b); });
  };
  Scrubber.prototype.buildTwin = function () {
    if (!this.twinBody) return; var sig = this.st.sig, st = this.st, self = this, parts = [];
    parts.push('<p>' + (sig.id ? '<b>' + sig.id + '</b> · ' : '') + fmtNum(st.dur, 1) + ' s at ' + sig.hz + ' Hz · ' + (Object.keys(sig.cols).length - 1) + ' channels' + (st.events.length ? ' · ' + st.events.length + ' events' : '') + '.</p>');
    var rows = this.strips.filter(function (s) { return s.col; }).map(function (s) { var c = self.col(s.col) || [], vals = c.filter(isNum), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), nn = c.length - vals.length; return '<tr><td>' + s.label + '</td><td>' + (vals.length ? fmtNum(lo, 2) + ' … ' + fmtNum(hi, 2) : '—') + (s.unit ? ' ' + s.unit : '') + '</td><td>' + (nn ? nn + ' gaps' : '') + '</td></tr>'; });
    if (rows.length) parts.push('<table><tr><th>channel</th><th>range</th><th></th></tr>' + rows.join('') + '</table>');
    if (st.events.length) parts.push('<ul>' + st.events.map(function (e) { return '<li>' + fmtClock(e.t - st.t0) + ' — ' + (e.label || e.kind) + '</li>'; }).join('') + '</ul>');
    (sig.bands || []).length && parts.push('<p>Quantile bands: ' + sig.bands.map(function (b) { return (b.label || b.id) + (isNum(b.n) ? ' (n = ' + fmtInt(b.n) + ')' : ''); }).join(', ') + '.</p>');
    this.twin(parts.join(''));
  };
  Scrubber.prototype.render = function (now) {
    var st = this.st, t = st.t, win = this.windowAt(t), self = this; this.strips.forEach(function (s) { self.drawStrip(s, t, win); });
    if (this.hud && st.sig) this.updateHud(t);
    if (!st.playing || now - st.lastText >= 100) { st.lastText = now; this.updateText(t); }
    if (st.playing && st.userStarted && t >= st.prevT) st.events.forEach(function (ev) { if (st.prevT < ev.t && ev.t <= t) { self.announce(ev.label || ev.kind); self.pulseEvent(ev); } });
    else if (st.playing && t >= st.prevT) st.events.forEach(function (ev) { if (st.prevT < ev.t && ev.t <= t) self.pulseEvent(ev); });
    st.prevT = t; if (this.sync && this.ownsClock()) bus.time(this.sync, t, st.hover, this);
  };
  Scrubber.prototype.pulseEvent = function (ev) { (this.evBtns || []).forEach(function (b) { if (+b.getAttribute('data-t') === ev.t) { b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); } }); if (this.lamp && /alert|onset|takeover|warn/i.test(ev.kind || '')) { var l = this.lamp, m = this.media; l.classList.add('on'); m.classList.add('is-alert'); setTimeout(function () { l.classList.remove('on'); }, 220); setTimeout(function () { m.classList.remove('is-alert'); }, 1000); } };
  Scrubber.prototype.updateHud = function (t) {
    var sig = this.st.sig, hud = sig.hud || this.hudSpec(), i = this.idxAt(t), self = this; if (!hud) return;
    if (!this.hudEls) { this.hudEls = {}; this.hud.innerHTML = ''; hud.forEach(function (h) { var sp = el('span'); sp.setAttribute('data-hud', h.col); self.hud.appendChild(sp); self.hudEls[h.col] = sp; if (h.bars) { var bb = el('span', 'pj-hud-bars'); h.bars.forEach(function () { bb.appendChild(el('i')); }); sp.appendChild(bb); sp._bars = bb; } }); }
    hud.forEach(function (h) { var sp = self.hudEls[h.col], v = self.at(h.col, i), txt; if (h.fmt === 'mph') txt = isNum(v) ? Math.round(v * MPH) + ' mph' : '— mph'; else if (h.fmt === 'kmh') txt = isNum(v) ? Math.round(v * 3.6) + ' km/h' : '—'; else if (h.fmt === 'bool') { txt = h.label + (v === 1 || v === true ? ': on' : v === 0 || v === false ? ': off' : ': —'); sp.setAttribute('data-state', v === 1 || v === true ? (h.alert ? 'alert' : 'on') : 'off'); } else txt = (h.label ? h.label + ' ' : '') + (isNum(v) ? v.toFixed(2) : '—');
      if (sp._bars) { var kids = sp._bars.children; h.bars.forEach(function (c, k) { var bv = self.at(c, i); kids[k].style.setProperty('--v', isNum(bv) ? clamp(bv, 0, 1).toFixed(2) : 0); }); var lbl = sp.firstChild; if (!lbl || lbl.nodeType !== 3) sp.insertBefore(doc.createTextNode(txt), sp.firstChild); else lbl.textContent = txt; } else setText(sp, txt); });
  };
  Scrubber.prototype.hudSpec = function () { var h = this.root.getAttribute('data-hud'); if (!h) return null; try { return JSON.parse(h); } catch (e) { return h.split(';').map(function (p) { var a = p.split(':'); return { col: a[0].trim(), fmt: (a[1] || '').trim(), label: (a[2] || '').trim() }; }); } };
  Scrubber.prototype.updateText = function (t) {
    var st = this.st, rel = t - st.t0; if (this.scrub && !st.scrubbing) { this.scrub.value = String(Math.round(rel * 10)); var first = this.strips[0]; this.scrub.setAttribute('aria-valuetext', rel.toFixed(1) + ' s of ' + Math.round(st.dur) + (first && first.col ? '; ' + first.label + ' ' + this.valueText(first, t) : '')); }
    (this.evBtns || []).forEach(function (b) { var et = +b.getAttribute('data-t'); b.classList.toggle('is-now', Math.abs(t - et) <= 1); b.classList.toggle('is-past', t > et + 1); });
  };
  Scrubber.prototype.kick = function () { var self = this; if (!this.st.raf) this.st.raf = requestAnimationFrame(function (now) { self.tick(now); }); };
  Scrubber.prototype.tick = function (now) {
    var st = this.st; st.raf = 0;
    if (st.playing) { if (this.video) { if (!st.vfcOn) st.t = this.video.currentTime + (st.t0 || 0); } else { st.t = st.t0 + ((now - st.clock0) / 1000) % (st.dur || 1); } st.dirty = true; }
    if (st.dirty) { st.dirty = false; this.render(now); }
    if (st.playing) this.kick();
  };
  Scrubber.prototype.setPlaying = function (on) {
    var st = this.st; if (st.playing === on) return; st.playing = on; this.root.classList.toggle('is-playing', on);
    if (this.playBtn) this.playBtn.setAttribute('aria-label', on ? 'Pause clip' : 'Play clip');
    if (on) { if (this.video && this.video.requestVideoFrameCallback) this.startVFC(); else if (!this.video) st.clock0 = performance.now() - (st.t - st.t0) * 1000; this.kick(); } else { this.stopVFC(); if (this.video) st.t = this.video.currentTime + st.t0; st.dirty = true; this.kick(); }
    if (st.userStarted) this.announce(on ? 'Playing' : 'Paused at ' + (st.t - st.t0).toFixed(1) + ' s');
  };
  Scrubber.prototype.startVFC = function () { var self = this, v = this.video; if (this.vfcId) return; this.st.vfcOn = true; (function req() { self.vfcId = v.requestVideoFrameCallback(function (now, m) { self.vfcId = 0; self.st.t = m.mediaTime + self.st.t0; self.st.dirty = true; self.kick(); if (self.st.playing) req(); else self.st.vfcOn = false; }); })(); };
  Scrubber.prototype.stopVFC = function () { if (this.vfcId && this.video && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.vfcId); this.vfcId = 0; this.st.vfcOn = false; };
  Scrubber.prototype.play = function () { if (modalOpen()) return; if (this.video) { if (!this.video.getAttribute('src') && !this.video.querySelector('source')) return; this.video.muted = true; var p = this.video.play(); if (p && p.catch) p.catch(function () {}); } else this.setPlaying(true); };
  Scrubber.prototype.pause = function () { if (this.video) this.video.pause(); else this.setPlaying(false); };
  Scrubber.prototype.toggle = function () { if (modalOpen()) return; this.st.userStarted = true; if (this.st.playing) { this.st.userPaused = true; this.pause(); } else { this.st.userPaused = false; this.play(); } };
  Scrubber.prototype.autoPause = function () { if (this.st.playing) { this.st.userStarted = false; this.pause(); } };
  Scrubber.prototype.maybeAutoplay = function () {
    var st = this.st; if (st.playing || st.userPaused || !st.sig || !this.visible50 || reduced() || doc.hidden || modalOpen()) return;
    if (this.video && (win.innerWidth < 768 || saveData())) return; st.userStarted = false; this.play();
  };
  Scrubber.prototype.onVisibility = function () { if (!this.visible || doc.hidden || modalOpen()) this.autoPause(); else this.maybeAutoplay(); };
  Scrubber.prototype.seek = function (t, from) {
    var st = this.st; t = clamp(+t || 0, st.t0, st.t0 + (st.dur || 0)); if (this.video) { try { this.video.currentTime = t - st.t0; } catch (e) { /* no metadata yet */ } } else st.clock0 = performance.now() - (t - st.t0) * 1000;
    st.t = t; st.prevT = t; st.dirty = true; this.kick(); if (from !== 'scrub' && this.scrub) this.scrub.value = String(Math.round((t - st.t0) * 10));
    if (!from) this.announce('Seeked to ' + (t - st.t0).toFixed(1) + ' s'); if (this.sync && from !== 'bus') bus.seek(this.sync, t, false);
  };
  Scrubber.prototype.jumpEvent = function (dir) { var st = this.st, evs = st.events; if (!evs.length) return; var t = st.t, next = dir > 0 ? evs.filter(function (e) { return e.t > t + .05; })[0] : evs.filter(function (e) { return e.t < t - .05; }).pop(); if (next) { st.userStarted = true; this.seek(next.t); } };
  Scrubber.prototype.onKey = function (ev) {
    var st = this.st, k = ev.key, step = ev.shiftKey ? 1 : .1; if (this.hero) return false;
    if (k === ' ' || k === 'k' || k === 'K') { this.toggle(); return true; }
    if (k === 'ArrowLeft') { this.seek(st.t - step); return true; } if (k === 'ArrowRight') { this.seek(st.t + step); return true; }
    if (k === 'j' || k === 'J') { this.seek(st.t - 5); return true; } if (k === 'l' || k === 'L') { this.seek(st.t + 5); return true; }
    if (k === '[') { this.jumpEvent(-1); return true; } if (k === ']') { this.jumpEvent(1); return true; }
    if (k === ',') { this.seek(st.t - 1 / st.hz); return true; } if (k === '.') { this.seek(st.t + 1 / st.hz); return true; }
    if (k === 'Home') { this.seek(st.t0); return true; } if (k === 'End') { this.seek(st.t0 + st.dur); return true; }
    if (/^[1-9]$/.test(k) && this.tabs) { var bs = $$('[role="tab"]', this.tabs), b = bs[+k - 1]; if (b) { b.click(); return true; } }
    if (k === 'Escape') { st.hover = null; this.hideTip(); st.dirty = true; this.kick(); return true; }
    return false;
  };
  Scrubber.prototype.bindStrips = function () {
    var self = this; this.strips.forEach(function (s) { if (s.bound) return; s.bound = true; var c = s.el;
      function tAt(ev, r) { r = r || c.getBoundingClientRect(); var w = self.windowAt(self.st.t); return clamp(w[0] + (ev.clientX - r.left) / (r.width || 1) * (w[1] - w[0]), self.st.t0, self.st.t0 + (self.st.dur || 0)); }
      if (self.hero) return;
      c.addEventListener('pointerdown', function (ev) { if (ev.pointerType === 'mouse' && ev.button !== 0) return; ev.preventDefault(); if (ev.shiftKey && self.st.events.length) { var tt = tAt(ev), near = self.st.events.slice().sort(function (a, b) { return Math.abs(a.t - tt) - Math.abs(b.t - tt); })[0]; self.st.userStarted = true; self.seek(near.t); return; } self.st.drag = { win: self.windowAt(self.st.t) }; try { c.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } self.seek(tAt(ev), 'drag'); });
      c.addEventListener('pointermove', function (ev) { if (self.st.drag) { self.seek(tAt(ev), 'drag'); return; } if (ev.pointerType !== 'mouse') return; var r = c.getBoundingClientRect(), pr = self.stripsBox.getBoundingClientRect(), ht = tAt(ev, r); self.st.hover = ht; self.st.dirty = true; self.kick(); self.tip(self.stripsBox, (ev.clientX - pr.left) / (pr.width || 1), c.offsetTop + 6, fmtClock(ht - self.st.t0) + '.' + Math.floor(((ht - self.st.t0) % 1) * 10) + ' · ' + self.valueText(s, ht)); if (self.sync) bus.hover(self.sync, ht); });
      var end = function () { if (!self.st.drag) return; self.st.drag = null; self.announce('Seeked to ' + (self.st.t - self.st.t0).toFixed(1) + ' s'); }; c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
      c.addEventListener('pointerleave', function () { if (self.st.drag) return; self.st.hover = null; self.hideTip(); self.st.dirty = true; self.kick(); if (self.sync) bus.hover(self.sync, null); });
    });
  };
  register('scrubber', Scrubber);

  /* ====================================================================== Timeline */
  function Timeline(root) { Widget.call(this, root); }
  Timeline.prototype = Object.create(Widget.prototype);
  Timeline.prototype.start = function () {
    var self = this; this.root.classList.add('pj-tl'); if (this.hero) this.root.classList.add('pj-tl--hero');
    this.cv = el('canvas'); this.cv.setAttribute('aria-hidden', 'true'); this.body.appendChild(this.cv); this.ctx = this.cv.getContext('2d'); this.t = null; this.hover = null;
    var src = this.root.getAttribute('data-src'); if (!src) throw new Error('data-src missing'); this.setLoading(true);
    load(src, 'timeline').then(function (tl) { self.tl = tl; self.lanes = tl.lanes; self.cv.style.setProperty('--h', (14 + 26 * tl.lanes.length + (self.hero ? 0 : 8)) + 'px'); self.size(); self.buildTwin(); self.ok(); self.draw(); }).catch(function (e) { self.fail(e); });
    if ('ResizeObserver' in win) new ResizeObserver(debounce(function () { self.size(); self.draw(); }, 100)).observe(this.body);
    if (this.sync) { bus.on('pj:time', function (ev) { if (ev.detail.group !== self.sync) return; self.t = ev.detail.t; self.hover = ev.detail.hover; self.draw(); }); bus.on('pj:hover', function (ev) { if (ev.detail.group !== self.sync) return; self.hover = ev.detail.t; self.draw(); }); }
    if (!this.hero) { this.cv.addEventListener('pointermove', function (ev) { var r = self.cv.getBoundingClientRect(), tt = self.tAt(ev.clientX, r); self.hover = tt; self.draw(); var m = self.nearest(tt); self.tip(self.body, (ev.clientX - r.left) / r.width, 4, fmtClock(tt - self.tl.span[0]) + (m ? ' · ' + m.label : '')); if (self.sync) bus.hover(self.sync, tt); }); this.cv.addEventListener('pointerleave', function () { self.hover = null; self.hideTip(); self.draw(); if (self.sync) bus.hover(self.sync, null); }); this.cv.addEventListener('click', function (ev) { var tt = self.tAt(ev.clientX); if (self.sync) bus.seek(self.sync, tt, false); else { self.t = tt; self.draw(); } self.announce('Seeked to ' + fmtClock(tt - self.tl.span[0])); }); }
  };
  Timeline.prototype.size = function () { var b = sizeCanvas(this.cv, 600, 60); this.w = b.w; this.h = b.h; this.C = this.colors(); };
  Timeline.prototype.tAt = function (x, r) { r = r || this.cv.getBoundingClientRect(); var s = this.tl.span; return clamp(s[0] + (x - r.left - 8) / Math.max(1, r.width - 16) * (s[1] - s[0]), s[0], s[1]); };
  Timeline.prototype.nearest = function (t) { var best = null, d = Infinity; this.lanes.forEach(function (l) { (l.marks || []).forEach(function (m) { var dd = Math.abs(m.t - t); if (dd < d) { d = dd; best = m; } }); }); return d < (this.tl.span[1] - this.tl.span[0]) / 40 ? best : null; };
  Timeline.prototype.draw = function () {
    if (!this.tl) return; var ctx = this.ctx, W = this.w, H = this.h, C = this.C, s = this.tl.span, X = function (t) { return 8 + (t - s[0]) / (s[1] - s[0]) * (W - 16); }, self = this, LH = 26, top = 8;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    this.lanes.forEach(function (l, li) { var y = top + li * LH;
      ctx.fillStyle = C.mute; ctx.font = '600 9.5px ' + SANS; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(l.label || l.id, 8, y + 7);
      ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(8, y + 10, W - 16, 8);
      l.segs.forEach(function (sg) { var st = sg[2]; ctx.fillStyle = st === 'on' ? C.accent : st === 'off' ? 'rgba(159,178,214,.35)' : st === 'na' ? 'rgba(255,255,255,.08)' : tok(st, self.root); ctx.fillRect(X(sg[0]), y + 10, Math.max(1, X(sg[1]) - X(sg[0])), 8); });
      (l.marks || []).forEach(function (m) { var x = X(m.t), up = /hand|engage|activat/i.test(m.kind || ''), col = up ? C.accent : C.gold; ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 22); ctx.stroke(); ctx.fillStyle = col; ctx.beginPath(); if (up) { ctx.moveTo(x, y + 2); ctx.lineTo(x - 4, y + 8); ctx.lineTo(x + 4, y + 8); } else { ctx.moveTo(x, y + 24); ctx.lineTo(x - 4, y + 18); ctx.lineTo(x + 4, y + 18); } ctx.closePath(); ctx.fill(); });
    });
    if (!this.hero) { ctx.fillStyle = C.mute; ctx.font = '500 9px ' + MONO; ctx.textAlign = 'left'; ctx.fillText(fmtClock(0), 8, H - 2); ctx.textAlign = 'right'; ctx.fillText(fmtClock(s[1] - s[0]), W - 8, H - 2); }
    if (this.hover != null) { var hx = Math.round(X(this.hover)) + .5; ctx.strokeStyle = C.mute; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, H); ctx.stroke(); ctx.setLineDash([]); }
    if (this.t != null) { var cx = Math.round(X(this.t)) + .5; ctx.strokeStyle = C.text; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke(); }
  };
  Timeline.prototype.buildTwin = function () { var s = this.tl.span; this.twin('<ul>' + this.lanes.map(function (l) { var on = l.segs.filter(function (x) { return x[2] === 'on'; }).reduce(function (a, x) { return a + x[1] - x[0]; }, 0); return '<li><b>' + (l.label || l.id) + '</b>: on ' + Math.round(100 * on / (s[1] - s[0])) + ' % of ' + fmtClock(s[1] - s[0]) + (l.marks && l.marks.length ? '; ' + l.marks.map(function (m) { return m.label + ' at ' + fmtClock(m.t - s[0]); }).join(', ') : '') + '</li>'; }).join('') + '</ul>'); };
  register('timeline', Timeline);

  /* ====================================================================== Scatter */
  function Scatter(root) { Widget.call(this, root); }
  Scatter.prototype = Object.create(Widget.prototype);
  var PAL = ['#33e0ff', '#b07cff', '#f0c34e', '#3ddc97', '#ff6b6b', '#5c8bff', '#ff9f43', '#7bd389', '#f78fb3', '#8ecae6', '#c9b458', '#9fb2d6'];
  Scatter.prototype.start = function () {
    var self = this, root = this.root; root.classList.add('pj-scat'); this.ctl = el('div', 'pj-scat__ctl'); this.plot = el('div', 'pj-plot'); this.cv = el('canvas'); this.cv.setAttribute('aria-hidden', 'true'); this.plot.appendChild(this.cv); this.label = el('div', 'pj-scat__label'); this.plot.appendChild(this.label);
    if (!this.hero) this.body.appendChild(this.ctl); this.body.appendChild(this.plot); this.legend = el('p', 'pj-legend'); if (!this.hero) this.body.appendChild(this.legend); this.pur = el('div', 'pj-scat__pur'); if (!this.hero) this.body.appendChild(this.pur);
    this.ctx = this.cv.getContext('2d'); this.mode = root.getAttribute('data-color') || null; this.hi = null; this.hoverI = -1; this.pulseK = 0; this.pulseAt = 0; this.repI = -1;
    var src = root.getAttribute('data-src'); if (!src) throw new Error('data-src missing'); this.setLoading(true);
    load(src, 'embedding').then(function (e) { self.apply(e); }).catch(function (e) { self.fail(e); });
    if ('ResizeObserver' in win) new ResizeObserver(debounce(function () { self.size(); self.raster(); self.draw(); }, 100)).observe(this.plot);
    if (!this.hero) {
      this.cv.addEventListener('pointermove', function (ev) { if (!self.E) return; var r = self.cv.getBoundingClientRect(), i = self.hit(ev.clientX - r.left, ev.clientY - r.top); if (i !== self.hoverI) { self.hoverI = i; self.draw(); } if (i >= 0) self.tip(self.plot, (ev.clientX - r.left) / r.width, ev.clientY - r.top - 28, self.pointLabel(i)); else self.hideTip(); });
      this.cv.addEventListener('pointerleave', function () { self.hoverI = -1; self.hideTip(); self.draw(); });
      this.cv.addEventListener('click', function (ev) { if (!self.E) return; var r = self.cv.getBoundingClientRect(), i = self.hit(ev.clientX - r.left, ev.clientY - r.top); self.pin(i >= 0 ? i : -1); });
    }
  };
  Scatter.prototype.apply = function (E) {
    var self = this, n = E.n, xy = b64I16(E.xy_i16), bb = E.bbox; this.E = E; this.n = n; this.x = new Float32Array(n); this.y = new Float32Array(n);
    for (var i = 0; i < n; i++) { this.x[i] = (xy[2 * i] + 32000) / 64000; this.y[i] = 1 - (xy[2 * i + 1] + 32000) / 64000; }
    this.dims = {}; Object.keys(E.dims || {}).forEach(function (k) { var d = E.dims[k], idx = b64U16(d.idx), counts = new Uint32Array(d.names.length); for (var j = 0; j < n; j++) counts[idx[j]]++; var order = Array.from(counts.keys()).sort(function (a, b) { return counts[b] - counts[a]; }); self.dims[k] = { names: d.names, idx: idx, counts: counts, order: order }; });
    var keys = Object.keys(this.dims); if (!this.mode || !this.dims[this.mode]) this.mode = keys[0] || null;
    this.ctl.innerHTML = ''; keys.forEach(function (k) { var b = el('button', 'chip chip--sm', 'colour by ' + k); b.type = 'button'; b.setAttribute('aria-pressed', String(k === self.mode)); b.addEventListener('click', function () { self.mode = k; $$('.chip', self.ctl).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); self.raster(); self.legendFor(); self.draw(); self.announce('Coloured by ' + k); }); self.ctl.appendChild(b); });
    if (E.purity) { var P = E.purity; this.pur.innerHTML = ['driver', 'model', 'scenario'].filter(function (k) { return isNum(P[k]); }).map(function (k) { return '<span>' + k + ' <b>' + P[k].toFixed(2) + '</b></span>'; }).join('') + '<span>k = ' + (P.k || 10) + ' nearest-neighbour purity</span>'; }
    this.size(); this.raster(); this.legendFor(); this.buildTwin(); this.ok(); this.draw();
    if (this.hero || this.root.hasAttribute('data-pulse')) this.startPulse();
  };
  Scatter.prototype.size = function () { var b = sizeCanvas(this.cv, 600, 450); this.w = b.w; this.h = b.h; this.C = this.colors(); this.grid = null; };
  Scatter.prototype.px = function (i) { var pad = 14; return [pad + this.x[i] * (this.w - 2 * pad), pad + this.y[i] * (this.h - 2 * pad)]; };
  Scatter.prototype.catOf = function (i) { // category index in the ≤ 12 palette for the current mode (11 largest + "other")
    var d = this.dims[this.mode]; if (!d) return 0; var c = d.idx[i], rank = d.order.indexOf(c); return d.names.length <= 12 ? rank : (rank < 11 ? rank : 11);
  };
  Scatter.prototype.raster = function () { // base layer drawn once per colour mode
    if (!this.E) return; var off = this.off || (this.off = doc.createElement('canvas')); off.width = this.cv.width; off.height = this.cv.height; var o = off.getContext('2d'); o.setTransform(DPR, 0, 0, DPR, 0, 0); o.clearRect(0, 0, this.w, this.h);
    var d = this.dims[this.mode], many = d && d.names.length > 12, isDriver = this.mode === 'driver' || many;
    for (var i = 0; i < this.n; i++) { var p = this.px(i); o.fillStyle = isDriver ? rgba(this.C.accent, .35) : rgba(PAL[this.catOf(i)], .6); o.beginPath(); o.arc(p[0], p[1], this.n > 5000 ? 1.6 : 2.2, 0, 6.283); o.fill(); }
    // hit grid (8 px)
    var g = this.grid = { cell: 8, cols: Math.ceil(this.w / 8) + 1, map: {} }; for (var j = 0; j < this.n; j++) { var q = this.px(j), key = ((q[1] / 8) | 0) * g.cols + ((q[0] / 8) | 0); (g.map[key] || (g.map[key] = [])).push(j); }
  };
  Scatter.prototype.hit = function (x, y) { if (!this.grid) return -1; var g = this.grid, cx = (x / 8) | 0, cy = (y / 8) | 0, best = -1, bd = 64; for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var cell = g.map[(cy + dy) * g.cols + cx + dx]; if (!cell) continue; for (var k = 0; k < cell.length; k++) { var p = this.px(cell[k]), d = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y); if (d < bd) { bd = d; best = cell[k]; } } } return best; };
  Scatter.prototype.pointLabel = function (i) { var self = this; return Object.keys(this.dims).map(function (k) { var d = self.dims[k]; return d.names[d.idx[i]]; }).join(' · '); };
  Scatter.prototype.pin = function (i) { this.repLabel = ''; this.hi = i >= 0 ? { dim: this.mode, cat: this.dims[this.mode].idx[i] } : null; this.draw(); if (i >= 0) { var d = this.dims[this.mode]; this.announce(d.names[d.idx[i]] + ': ' + fmtInt(d.counts[d.idx[i]]) + ' points'); } };
  Scatter.prototype.legendFor = function () { var d = this.dims[this.mode], self = this; if (!d || this.hero) return; if (d.names.length > 12) { this.legend.innerHTML = '<span><i class="sw" style="--sw:' + rgba(this.C.accent, .5) + '"></i>' + fmtInt(d.names.length) + ' ' + this.mode + 's — hover or click a point to highlight one; ←/→ steps through representative ' + this.mode + 's</span>'; return; } this.legend.innerHTML = d.order.slice(0, 12).map(function (c, k) { return '<span><i class="sw" style="--sw:' + PAL[k < 11 || d.names.length <= 12 ? k : 11] + '"></i>' + d.names[c] + ' <small>' + fmtInt(d.counts[c]) + '</small></span>'; }).join(''); };
  Scatter.prototype.draw = function () {
    if (!this.E || !this.off) return; var ctx = this.ctx, W = this.w, H = this.h, self = this; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    var hl = this.hi || (this.hoverI >= 0 && this.dims[this.mode] ? { dim: this.mode, cat: this.dims[this.mode].idx[this.hoverI] } : null);
    ctx.globalAlpha = hl ? .28 : 1; ctx.drawImage(this.off, 0, 0); ctx.globalAlpha = 1; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (hl) { var d = this.dims[hl.dim], col = this.mode === 'driver' || d.names.length > 12 ? this.C.accent2 : PAL[this.catOf(this.firstOf(hl))]; ctx.fillStyle = col; var sx = 0, sy = 0, c = 0; for (var i = 0; i < this.n; i++) { if (d.idx[i] !== hl.cat) continue; var p = this.px(i); sx += p[0]; sy += p[1]; c++; ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, 6.283); ctx.fill(); }
      if (c) { var lx = 12, ly = H - 12, mx = sx / c, my = sy / c; ctx.strokeStyle = rgba(col, .7); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(lx + 40, ly - 10); ctx.lineTo(mx, my); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(mx, my, 2.5, 0, 6.283); ctx.fill(); this.label.textContent = this.repLabel || (d.names[hl.cat] + ' · ' + fmtInt(c) + ' windows'); } }
    else this.label.textContent = '';
    var M = this.E.meta || {}; (M.guides || []).forEach(function (g) { var x = 14 + (g.axis === 'x' ? g.v : 0) * (W - 28), y = 14 + (1 - g.v) * (H - 28); ctx.strokeStyle = rgba(self.C.coral, .7); ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.beginPath(); if (g.axis === 'x') { ctx.moveTo(x, 14); ctx.lineTo(x, H - 14); } else { ctx.moveTo(14, y); ctx.lineTo(W - 14, y); } ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = self.C.coral; ctx.font = '600 10px ' + SANS; if (g.axis === 'x') { ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(g.label || '', x + 4, 16); } else { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(g.label || '', W - 16, y - 3); } });
    if (M.axes && !this.hero) { ctx.fillStyle = this.C.mute; ctx.font = '500 10px ' + SANS; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(M.axes.x || '', W - 8, H - 4); ctx.save(); ctx.translate(12, 8); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(M.axes.y || '', 0, 0); ctx.restore(); }
    if (this.hoverI >= 0) { var hp = this.px(this.hoverI); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(hp[0], hp[1], 5, 0, 6.283); ctx.stroke(); }
  };
  Scatter.prototype.firstOf = function (hl) { var d = this.dims[hl.dim]; for (var i = 0; i < this.n; i++) if (d.idx[i] === hl.cat) return i; return 0; };
  Scatter.prototype.startPulse = function () { // hero/idle: representative points brighten in turn (2.4 s), label in the fixed slot
    var self = this, reps = (this.E.reps || []).filter(function (r) { return self.dims[r.dim]; }); if (!reps.length || reduced()) { if (reps.length) { this.showRep(reps[0]); } return; }
    var k = 0; function step() { if (self.destroyed) return; if (self.visible && !doc.hidden && !modalOpen()) { self.showRep(reps[k % reps.length]); k++; } self.pulseT = setTimeout(step, 2400); } step();
  };
  Scatter.prototype.showRep = function (r) { this.mode = r.dim; this.hi = { dim: r.dim, cat: this.dims[r.dim].idx[r.i] }; this.repLabel = r.label || ''; this.draw(); };
  Scatter.prototype.onKey = function (ev) { var reps = (this.E && this.E.reps) || []; if (!reps.length) return false; if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') { this.repI = (this.repI + (ev.key === 'ArrowRight' ? 1 : -1) + reps.length) % reps.length; this.showRep(reps[this.repI]); this.announce(reps[this.repI].label || reps[this.repI].name); return true; } if (ev.key === 'Escape') { this.hi = null; this.repLabel = ''; this.draw(); return true; } return false; };
  Scatter.prototype.buildTwin = function () { var self = this, E = this.E; this.twin('<p>' + fmtInt(this.n) + ' points.</p><ul>' + Object.keys(this.dims).map(function (k) { var d = self.dims[k]; return '<li><b>' + k + '</b>: ' + fmtInt(d.names.length) + ' categories; largest ' + d.order.slice(0, 3).map(function (c) { return d.names[c] + ' (' + fmtInt(d.counts[c]) + ')'; }).join(', ') + '</li>'; }).join('') + '</ul>' + (E.purity ? '<p>k-NN purity (k = ' + (E.purity.k || 10) + '): driver ' + fmtNum(E.purity.driver, 2) + ' · model ' + fmtNum(E.purity.model, 2) + ' · scenario ' + fmtNum(E.purity.scenario, 2) + '</p>' : '')); };
  register('scatter', Scatter);

  /* ====================================================================== Skeleton (COCO-WholeBody 133) */
  var BODY_BONES = [[0, 1], [0, 2], [1, 3], [2, 4], [5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];
  var FOOT_BONES = [[15, 17], [15, 18], [15, 19], [16, 20], [16, 21], [16, 22]];
  function handBones(b) { var out = [[b, b + 1], [b + 1, b + 2], [b + 2, b + 3], [b + 3, b + 4]]; for (var f = 0; f < 4; f++) { var s = b + 5 + f * 4; out.push([b, s], [s, s + 1], [s + 1, s + 2], [s + 2, s + 3]); } return out; }
  var HAND_L = handBones(91), HAND_R = handBones(112), FACE_JAW = []; for (var fj = 23; fj < 39; fj++) FACE_JAW.push([fj, fj + 1]);
  var PARTS = { body: [0, 17], feet: [17, 23], face: [23, 91], lhand: [91, 112], rhand: [112, 133] };
  function Skeleton(root) { Widget.call(this, root); }
  Skeleton.prototype = Object.create(Widget.prototype);
  Skeleton.prototype.start = function () {
    var self = this, root = this.root; root.classList.add('pj-sk'); this.grid = el('div', 'pj-sk__grid'); this.plot = el('div', 'pj-plot'); this.cv = el('canvas', 'pj-sk__cv'); this.cv.setAttribute('aria-hidden', 'true'); this.plot.appendChild(this.cv); this.grid.appendChild(this.plot); this.body.appendChild(this.grid);
    this.ctx = this.cv.getContext('2d'); this.st = { t: 0, playing: false, raf: 0, clock0: 0, trails: !root.hasAttribute('data-no-trails'), ghost: !this.hero, userStarted: false, userPaused: false, speedHist: [] };
    if (!this.hero) {
      this.side = el('div', 'pj-sk__side'); this.grid.appendChild(this.side);
      var hb = el('div', 'pj-sk__box'); hb.innerHTML = '<span class="pj-sub">head pose</span>'; this.headSvg = svgEl('svg', { 'class': 'pj-sk__head', viewBox: '0 0 72 72', 'aria-hidden': 'true' }); this.headSvg.innerHTML = '<circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,.15)"/><circle cx="36" cy="36" r="2" fill="#9fb2d6"/><line id="hp" x1="36" y1="36" x2="36" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle id="hc" cx="36" cy="12" r="4" fill="currentColor"/>'; this.headSvg.style.color = tok('accent', root); hb.appendChild(this.headSvg); this.headTxt = el('div', 'pj-sub'); hb.appendChild(this.headTxt); this.side.appendChild(hb);
      var lb = el('div', 'pj-sk__box'); lb.innerHTML = '<span class="pj-sub">parts tracked</span>'; this.leds = el('div', 'pj-leds'); lb.appendChild(this.leds); this.side.appendChild(lb);
      var gb = el('div', 'pj-sk__box'); gb.innerHTML = '<span class="pj-sub">' + (root.getAttribute('data-gauge-label') || 'this clip — wrist speed, last 2 s ÷ clip median') + '</span>'; this.gauge = el('div', 'pj-gauge'); this.gauge.appendChild(el('i')); gb.appendChild(this.gauge); this.gaugeTxt = el('span', 'num', '—'); gb.appendChild(this.gaugeTxt); this.side.appendChild(gb);
      this.ctl = el('div', 'pj-sk__ctl'); var pb = el('button', 'chip chip--sm', 'Play / pause'); pb.type = 'button'; pb.addEventListener('click', function () { self.toggle(); }); var tb = el('button', 'chip chip--sm', 'Trails'); tb.type = 'button'; tb.setAttribute('aria-pressed', String(this.st.trails)); tb.addEventListener('click', function () { self.st.trails = !self.st.trails; tb.setAttribute('aria-pressed', String(self.st.trails)); }); var gbt = el('button', 'chip chip--sm', 'Ground truth · +1 s'); gbt.type = 'button'; gbt.setAttribute('aria-pressed', String(this.st.ghost)); gbt.addEventListener('click', function () { self.st.ghost = !self.st.ghost; gbt.setAttribute('aria-pressed', String(self.st.ghost)); }); this.ctl.appendChild(pb); this.ctl.appendChild(tb); this.ctl.appendChild(gbt); this.body.appendChild(this.ctl);
      this.canBox = el('div', 'pj-sk__can'); this.canCv = el('canvas'); this.canCv.setAttribute('aria-hidden', 'true'); this.canBox.appendChild(this.canCv); this.body.appendChild(this.canBox); this.canCtx = this.canCv.getContext('2d');
    }
    var src = root.getAttribute('data-src'); if (!src) throw new Error('data-src missing'); this.setLoading(true);
    load(src, 'kpts').then(function (k) { self.apply(k); }).catch(function (e) { self.fail(e); });
    if ('ResizeObserver' in win) new ResizeObserver(debounce(function () { self.size(); self.dirty = true; self.kick(); }, 100)).observe(this.plot);
  };
  Skeleton.prototype.apply = function (K) {
    var self = this, n = K.n, k = K.K || 133; this.K = K; this.n = n; this.k = k; this.hz = K.hz; this.dur = n / K.hz; var raw = b64I16(K.kpts), sc = b64U8(K.score), s = K.scale || 10000; this.xs = new Float32Array(n * k); this.ys = new Float32Array(n * k); this.sc = sc;
    for (var i = 0; i < n * k; i++) { this.xs[i] = raw[2 * i] / s; this.ys[i] = raw[2 * i + 1] / s; }
    this.crop = K.crop; this.plot.style.setProperty('--ar', String((K.crop[2] - K.crop[0]) * K.aspect / (K.crop[3] - K.crop[1])));
    this.pv = K.part_valid ? { names: K.part_valid.names, v: b64U8(K.part_valid.v), P: K.part_valid.names.length } : null;
    if (this.leds) { this.leds.innerHTML = ''; this.ledEls = (this.pv ? this.pv.names : Object.keys(PARTS)).map(function (nm) { var d = el('span', 'pj-led', nm); self.leds.appendChild(d); return d; }); }
    // wrist speed per frame (normalised units / s) for the gauge; median over valid frames
    this.wspd = new Float32Array(n); var vals = []; for (var f = 1; f < n; f++) { var sp = 0, c = 0; [9, 10].forEach(function (j) { var a = (f - 1) * k + j, b = f * k + j; if (sc[a] && sc[b]) { sp += Math.hypot(self.xs[b] - self.xs[a], self.ys[b] - self.ys[a]) * self.hz; c++; } }); this.wspd[f] = c ? sp / c : NaN; if (c) vals.push(this.wspd[f]); }
    vals.sort(function (a, b) { return a - b; }); this.wmed = vals.length ? vals[vals.length >> 1] : NaN;
    if (this.canBox) { this.canBox.hidden = !K.can; if (K.can) { var b = sizeCanvas(this.canCv, 600, 52); this.cw = b.w; this.ch = b.h; } }
    this.size(); this.buildTwin(); this.ok(); this.dirty = true; this.kick(); this.maybeAutoplay();
  };
  Skeleton.prototype.size = function () { var b = sizeCanvas(this.cv, 600, 450); this.w = b.w; this.h = b.h; this.C = this.colors(); if (this.canCv && this.K && this.K.can) { var c = sizeCanvas(this.canCv, 600, 52); this.cw = c.w; this.ch = c.h; } };
  Skeleton.prototype.P = function (f, j) { // canvas position of joint j at frame f: the crop box is letterboxed into the canvas, aspect preserved
    var c = this.crop, x = (this.xs[f * this.k + j] - c[0]) / (c[2] - c[0]), y = (this.ys[f * this.k + j] - c[1]) / (c[3] - c[1]);
    if (!this.fit || this.fit.w !== this.w || this.fit.h !== this.h) { var cw = (c[2] - c[0]) * this.K.aspect, ch = c[3] - c[1], s = Math.min(this.w / cw, this.h / ch); this.fit = { w: this.w, h: this.h, sw: cw * s, sh: ch * s, ox: (this.w - cw * s) / 2, oy: (this.h - ch * s) / 2 }; }
    return [this.fit.ox + x * this.fit.sw, this.fit.oy + y * this.fit.sh];
  };
  Skeleton.prototype.frameAt = function (t) { return clamp(Math.floor(t * this.hz), 0, this.n - 1); };
  Skeleton.prototype.drawPose = function (ctx, t, alpha, color, lw) {
    var f = this.frameAt(t), f2 = Math.min(this.n - 1, f + 1), u = clamp(t * this.hz - f, 0, 1), k = this.k, sc = this.sc, self = this;
    var pos = new Array(k), ok = new Uint8Array(k);
    for (var j = 0; j < k; j++) { var a = sc[f * k + j], b = sc[f2 * k + j]; if (!a) continue; var p = this.P(f, j); if (b && f2 !== f) { var q = this.P(f2, j); p = [lerp(p[0], q[0], u), lerp(p[1], q[1], u)]; } pos[j] = p; ok[j] = 1; }
    ctx.globalAlpha = alpha; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var bone = function (list, w, col) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); list.forEach(function (bn) { if (ok[bn[0]] && ok[bn[1]]) { ctx.moveTo(pos[bn[0]][0], pos[bn[0]][1]); ctx.lineTo(pos[bn[1]][0], pos[bn[1]][1]); } }); ctx.stroke(); };
    bone(BODY_BONES, lw * 2.2, color); bone(FOOT_BONES, lw * 1.2, rgba(color, .7)); bone(HAND_L, lw * 1, this.C.accent2); bone(HAND_R, lw * 1, this.C.accent2); bone(FACE_JAW, lw * .8, rgba(color, .55));
    for (var jj = 0; jj < k; jj++) { if (!ok[jj]) continue; var conf = sc[f * k + jj] / 255, r = jj < 17 ? 3 : jj < 23 ? 2 : jj < 91 ? 1.2 : 1.6; ctx.globalAlpha = alpha * (0.3 + 0.7 * conf); ctx.fillStyle = jj < 17 ? '#fff' : jj < 91 ? rgba(color, .8) : this.C.accent2; ctx.beginPath(); ctx.arc(pos[jj][0], pos[jj][1], r, 0, 6.283); ctx.fill(); }
    ctx.globalAlpha = 1; return pos;
  };
  Skeleton.prototype.render = function () {
    var ctx = this.ctx, W = this.w, H = this.h, C = this.C, st = this.st, t = st.t, self = this; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = 1; ctx.beginPath(); for (var gx = .5; gx < W; gx += 40) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); } for (var gy = .5; gy < H; gy += 40) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); } ctx.stroke();
    if (st.trails) { var f = this.frameAt(t), f0 = Math.max(0, f - Math.round(2 * this.hz)), k = this.k; [0, 9, 10].forEach(function (j, idx) { ctx.beginPath(); var pen = false; for (var ff = f0; ff <= f; ff++) { if (!self.sc[ff * k + j]) { pen = false; continue; } var p = self.P(ff, j); if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; } } ctx.strokeStyle = rgba(idx ? C.accent : C.gold, .45); ctx.lineWidth = 2; ctx.stroke(); }); }
    if (st.ghost && t + 1 < this.dur) { this.drawPose(ctx, t + 1, .18, C.mute, 1.2); ctx.fillStyle = rgba(C.mute, .8); ctx.font = '600 9.5px ' + SANS; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText('ground truth · +1 s', W - 8, 6); }
    this.drawPose(ctx, t, 1, C.accent, 1.5);
    ctx.fillStyle = C.mute; ctx.font = '600 10px ' + MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(fmtClock(t) + '.' + Math.floor((t % 1) * 10) + ' / ' + fmtClock(this.dur), 8, 6);
    if (this.K.labels && !this.hero) { var lab = Object.keys(this.K.labels).map(function (kk) { return self.K.labels[kk]; }).join(' · '); ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = C.text; ctx.font = '600 10.5px ' + SANS; ctx.fillText(lab, 8, H - 6); }
    this.updateSide(t);
  };
  Skeleton.prototype.updateSide = function (t) {
    var f = this.frameAt(t), K = this.K, self = this; if (this.hero) return;
    if (K.head && this.headSvg) { var yaw = K.head.yaw[f], pitch = K.head.pitch[f]; if (isNum(yaw) && isNum(pitch)) { var x = 36 + Math.sin(yaw) * 24, y = 36 - Math.sin(pitch) * 24; $('#hp', this.headSvg).setAttribute('x2', x.toFixed(1)); $('#hp', this.headSvg).setAttribute('y2', y.toFixed(1)); $('#hc', this.headSvg).setAttribute('cx', x.toFixed(1)); $('#hc', this.headSvg).setAttribute('cy', y.toFixed(1)); setText(this.headTxt, 'yaw ' + signed(yaw * 57.3, 0) + '° · pitch ' + signed(pitch * 57.3, 0) + '°'); } else setText(this.headTxt, 'head: —'); } else if (this.headTxt) setText(this.headTxt, 'head pose not in this sequence');
    if (this.ledEls) { if (this.pv) this.ledEls.forEach(function (d, i) { d.classList.toggle('on', !!self.pv.v[f * self.pv.P + i]); }); else Object.keys(PARTS).forEach(function (nm, i) { var r = PARTS[nm], any = false; for (var j = r[0]; j < r[1]; j++) if (self.sc[f * self.k + j]) { any = true; break; } self.ledEls[i].classList.toggle('on', any); }); }
    if (this.gauge) { var f0 = Math.max(1, f - Math.round(2 * this.hz)), s = 0, c = 0; for (var ff = f0; ff <= f; ff++) if (isNum(this.wspd[ff]) && this.wspd[ff] === this.wspd[ff]) { s += this.wspd[ff]; c++; } var ratio = c && this.wmed ? (s / c) / this.wmed : NaN; this.gauge.firstChild.style.setProperty('--w', isNum(ratio) ? clamp(ratio / 4 * 100, 0, 100).toFixed(0) + '%' : '0%'); setText(this.gaugeTxt, isNum(ratio) ? ratio.toFixed(2) + '× clip median' : '—'); }
    if (K.can && this.canCtx) this.drawCan(t);
  };
  Skeleton.prototype.drawCan = function (t) {
    var ctx = this.canCtx, W = this.cw, H = this.ch, can = this.K.can, n = this.n, C = this.C, self = this; if (!W) return; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    var X = function (i) { return i / (n - 1) * W; }, series = [['v_ego_mps', C.accent, 'speed'], ['steer_deg', C.violet, 'steering']];
    series.forEach(function (sr, si) { var a = can[sr[0]]; if (!a) return; var lo = Infinity, hi = -Infinity; a.forEach(function (v) { if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }); if (!isFinite(lo)) return; if (hi === lo) hi = lo + 1; if (sr[0] === 'steer_deg') { var m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = -m; hi = m; } drawTrace(ctx, X, function (i) { var v = a[i]; return isNum(v) ? 12 + (hi - v) / (hi - lo) * (H - 16) : null; }, 0, n - 1, sr[1], 1.3); ctx.fillStyle = sr[1]; ctx.font = '600 9px ' + SANS; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(sr[2], 6 + si * 54, 2); });
    ['brake', 'gas'].forEach(function (k, bi) { var a = can[k]; if (!a) return; ctx.fillStyle = bi ? rgba(C.ok, .6) : rgba(C.crit, .6); for (var i = 0; i < n; i++) if (a[i]) ctx.fillRect(X(i), H - 4 - bi * 4, Math.max(1, W / n), 3); });
    var cx = Math.round(t / this.dur * W) + .5; ctx.strokeStyle = C.text; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
    var f = this.frameAt(t), v = can.v_ego_mps && can.v_ego_mps[f], sd = can.steer_deg && can.steer_deg[f]; ctx.fillStyle = C.text; ctx.font = '600 10px ' + MONO; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText((isNum(v) ? Math.round(v * MPH) + ' mph' : '—') + ' · ' + (isNum(sd) ? signed(sd, 0) + '°' : '—'), W - 6, 2);
  };
  Skeleton.prototype.kick = function () { var self = this; if (!this.st.raf) this.st.raf = requestAnimationFrame(function (now) { self.tick(now); }); };
  Skeleton.prototype.tick = function (now) { var st = this.st; st.raf = 0; if (st.playing) { st.t = ((now - st.clock0) / 1000) % this.dur; this.dirty = true; } if (this.dirty && this.K) { this.dirty = false; this.render(); } if (st.playing) this.kick(); };
  Skeleton.prototype.setPlaying = function (on) { var st = this.st; if (st.playing === on) return; st.playing = on; this.root.classList.toggle('is-playing', on); if (on) { st.clock0 = performance.now() - st.t * 1000; this.kick(); } if (st.userStarted) this.announce(on ? 'Playing' : 'Paused at ' + st.t.toFixed(1) + ' s'); };
  Skeleton.prototype.toggle = function () { this.st.userStarted = true; this.st.userPaused = this.st.playing; this.setPlaying(!this.st.playing); };
  Skeleton.prototype.maybeAutoplay = function () { if (this.st.playing || this.st.userPaused || !this.K || !this.visible || reduced() || doc.hidden || modalOpen()) return; this.setPlaying(true); };
  Skeleton.prototype.onVisibility = function () { if (!this.visible || doc.hidden || modalOpen()) { if (this.st.playing) { this.st.userStarted = false; this.setPlaying(false); } } else this.maybeAutoplay(); };
  Skeleton.prototype.seek = function (t) { this.st.t = clamp(t, 0, this.dur - 1e-3); this.st.clock0 = performance.now() - this.st.t * 1000; this.dirty = true; this.kick(); };
  Skeleton.prototype.onKey = function (ev) { var k = ev.key, st = this.st; if (this.hero) return false; if (k === ' ' || k === 'k') { this.toggle(); return true; } if (k === 'ArrowLeft') { this.seek(st.t - (ev.shiftKey ? 1 : .1)); return true; } if (k === 'ArrowRight') { this.seek(st.t + (ev.shiftKey ? 1 : .1)); return true; } if (k === ',') { this.seek(st.t - 1 / this.hz); return true; } if (k === '.') { this.seek(st.t + 1 / this.hz); return true; } if (k === 'Home') { this.seek(0); return true; } if (k === 'End') { this.seek(this.dur - .05); return true; } if (k === 't' || k === 'T') { this.st.trails = !this.st.trails; return true; } if (k === 'g' || k === 'G') { this.st.ghost = !this.st.ghost; return true; } return false; };
  Skeleton.prototype.buildTwin = function () { var K = this.K, self = this, n = this.n, k = this.k, parts = Object.keys(PARTS).map(function (nm) { var r = PARTS[nm], frames = 0; for (var f = 0; f < n; f++) { for (var j = r[0]; j < r[1]; j++) if (self.sc[f * k + j]) { frames++; break; } } return nm + ' ' + Math.round(100 * frames / n) + ' %'; }); this.twin('<p>' + (K.id ? '<b>' + K.id + '</b> · ' : '') + fmtNum(this.dur, 1) + ' s at ' + this.hz + ' Hz · ' + k + ' keypoints' + (K.labels ? ' · ' + Object.keys(K.labels).map(function (kk) { return kk + ': ' + K.labels[kk]; }).join(', ') : '') + '.</p><p>Frames with a tracked part: ' + parts.join(' · ') + '.' + (K.filtered_frames && K.filtered_frames.length ? ' ' + K.filtered_frames.length + ' frames masked by the tracker-jump filter.' : '') + (K.can ? ' CAN: speed, steering, pedals.' : ' No CAN channel in this sequence.') + '</p>'); };
  register('skeleton', Skeleton);

  /* ====================================================================== Paired (slope | dumbbell) */
  function Paired(root) { Widget.call(this, root); }
  Paired.prototype = Object.create(Widget.prototype);
  Paired.prototype.start = function () { var self = this, src = this.root.getAttribute('data-src'); this.root.classList.add('pj-pd'); if (!src) throw new Error('data-src missing'); this.setLoading(true); load(src, 'paired').then(function (p) { self.apply(p); }).catch(function (e) { self.fail(e); }); };
  Paired.prototype.apply = function (P) {
    var self = this; this.P = P; this.gi = 0; this.tabs = el('div', 'pj-sc__tabs'); this.tabs.setAttribute('role', 'tablist');
    if (P.groups.length > 1) { P.groups.forEach(function (g, i) { var b = el('button', 'chip chip--sm', g.label || g.id); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(i === 0)); b.addEventListener('click', function () { self.gi = i; $$('[role="tab"]', self.tabs).forEach(function (x, j) { x.setAttribute('aria-selected', String(j === i)); }); self.draw(); self.announce((g.label || g.id) + ' shown'); }); self.tabs.appendChild(b); }); this.body.appendChild(this.tabs); }
    this.svgBox = el('div', 'pj-plot'); this.body.appendChild(this.svgBox); this.sum = el('p', 'pj-pd__sum'); this.body.appendChild(this.sum); this.buildTwin(); this.ok(); this.draw();
  };
  Paired.prototype.draw = function () { var g = this.P.groups[this.gi]; this.svgBox.innerHTML = ''; if ((this.P.mode || 'slope') === 'dumbbell') this.drawDumbbell(g); else this.drawSlope(g); var s = []; if (isNum(g.delta)) s.push('Δ <b>' + signed(g.delta, 2) + '</b>'); if (g.ci) s.push('95 % CI <b>[' + fmtNum(g.ci[0], 2) + ', ' + fmtNum(g.ci[1], 2) + ']</b>'); if (isNum(g.p)) s.push('p <b>' + (g.p < .001 ? '< .001' : '= ' + g.p.toFixed(3).replace(/^0/, '')) + '</b>'); if (isNum(g.n)) s.push('n <b>' + g.n + '</b>'); if (g.note) s.push(g.note); this.sum.innerHTML = s.map(function (x) { return '<span>' + x + '</span>'; }).join(''); };
  Paired.prototype.drawSlope = function (g) {
    var P = this.P, ax = P.axis, W = 640, H = 300, L = 150, R = W - 150, T = 26, B = H - 30, Y = function (v) { return T + (ax.max - v) / (ax.max - ax.min) * (B - T); }, svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': (g.label || g.id) + ' slope chart' }), cost = !!g.cost;
    for (var v = ax.min; v <= ax.max; v++) { svg.appendChild(svgEl('line', { 'class': 'ax', x1: L, x2: R, y1: Y(v), y2: Y(v) })); var tl = svgEl('text', { 'class': 'ax-lbl', x: L - 10, y: Y(v) + 4, 'text-anchor': 'end' }); tl.textContent = v; svg.appendChild(tl); }
    [[L, P.from || 'before'], [R, P.to || 'after']].forEach(function (c) { var t = svgEl('text', { 'class': 'row-lbl emph', x: c[0], y: 16, 'text-anchor': 'middle' }); t.textContent = c[1]; svg.appendChild(t); });
    var pairs = {}, un = []; g.rows.forEach(function (r) { if (isNum(r.a) && isNum(r.b)) { var k = r.a + '→' + r.b; (pairs[k] || (pairs[k] = { a: r.a, b: r.b, ids: [] })).ids.push(r.id); } else un.push(r); });
    Object.keys(pairs).forEach(function (k) { var p = pairs[k], n = p.ids.length, better = cost ? p.b < p.a : p.b > p.a, cls = 'ln' + (cost ? ' cost' : '') + (!better && p.b !== p.a ? ' down' : ''); var ln = svgEl('line', { 'class': cls, x1: L, y1: Y(p.a), x2: R, y2: Y(p.b), 'stroke-width': 1.5 + Math.min(4, n - 1) * 1.2 }); var title = svgEl('title'); title.textContent = p.ids.join(', ') + ': ' + p.a + ' → ' + p.b; ln.appendChild(title); svg.appendChild(ln); svg.appendChild(svgEl('circle', { 'class': 'dot', cx: L, cy: Y(p.a), r: 4 })); svg.appendChild(svgEl('circle', { 'class': 'dot b', cx: R, cy: Y(p.b), r: 4 })); if (n > 1) { var tx = svgEl('text', { 'class': 'count', x: (L + R) / 2, y: (Y(p.a) + Y(p.b)) / 2 - 4, 'text-anchor': 'middle' }); tx.textContent = '×' + n; svg.appendChild(tx); } });
    un.forEach(function (r) { if (isNum(r.a)) svg.appendChild(svgEl('circle', { 'class': 'dot hollow', cx: L - 14, cy: Y(r.a), r: 4 })); if (isNum(r.b)) svg.appendChild(svgEl('circle', { 'class': 'dot hollow', cx: R + 14, cy: Y(r.b), r: 4 })); });
    var ma = mean(g.rows.map(function (r) { return r.a; })), mb = mean(g.rows.map(function (r) { return r.b; })); if (isNum(ma)) { var ta = svgEl('text', { 'class': 'val', x: L - 10, y: Y(ma) - 6, 'text-anchor': 'end' }); ta.textContent = 'mean ' + ma.toFixed(2); svg.appendChild(ta); } if (isNum(mb)) { var tb = svgEl('text', { 'class': 'val', x: R + 10, y: Y(mb) - 6 }); tb.textContent = 'mean ' + mb.toFixed(2); svg.appendChild(tb); }
    var al = svgEl('text', { 'class': 'ax-lbl', x: W / 2, y: H - 8, 'text-anchor': 'middle' }); al.textContent = ax.label || ''; svg.appendChild(al); this.svgBox.appendChild(svg);
  };
  Paired.prototype.drawDumbbell = function (g) {
    var P = this.P, ax = P.axis, rows = g.rows, RH = 26, W = 700, L = 190, R = W - 96, H = rows.length * RH + 46, X = function (v) { return L + (v - ax.min) / (ax.max - ax.min) * (R - L); }, svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': (g.label || g.id) + ' dumbbell chart' });
    var ticks = 5; for (var i = 0; i <= ticks; i++) { var v = ax.min + (ax.max - ax.min) * i / ticks, x = X(v); svg.appendChild(svgEl('line', { 'class': 'ax', x1: x, x2: x, y1: 20, y2: H - 24 })); var t = svgEl('text', { 'class': 'ax-lbl', x: x, y: H - 10, 'text-anchor': 'middle' }); t.textContent = v.toFixed(2).replace(/^0\./, '.'); svg.appendChild(t); }
    if (isNum(ax.chance)) { svg.appendChild(svgEl('line', { 'class': 'chance', x1: X(ax.chance), x2: X(ax.chance), y1: 20, y2: H - 24 })); var ct = svgEl('text', { 'class': 'ax-lbl', x: X(ax.chance) + 4, y: 30 }); ct.textContent = 'chance'; svg.appendChild(ct); }
    var gx = L; [[P.from || 'a', 'dot'], [P.to || 'b', 'dot b']].forEach(function (c) { svg.appendChild(svgEl('circle', { 'class': c[1], cx: gx, cy: 10, r: 4 })); var t = svgEl('text', { 'class': 'ax-lbl', x: gx + 8, y: 14 }); t.textContent = c[0]; svg.appendChild(t); gx += 8 + c[0].length * 6.2 + 22; });
    rows.forEach(function (r, i) { var y = 32 + i * RH, grp = svgEl('g', { 'class': r.emph === false ? 'dim' : '' }); var lbl = svgEl('text', { 'class': 'row-lbl' + (r.emph ? ' emph' : ''), x: L - 10, y: y + 4, 'text-anchor': 'end' }); lbl.textContent = r.label || r.id; grp.appendChild(lbl); if (isNum(r.a) && isNum(r.b)) grp.appendChild(svgEl('line', { 'class': 'ln' + (r.b < r.a ? ' down' : ''), x1: X(r.a), x2: X(r.b), y1: y, y2: y })); if (isNum(r.a)) grp.appendChild(svgEl('circle', { 'class': 'dot', cx: X(r.a), cy: y, r: 4.5 })); if (isNum(r.b)) grp.appendChild(svgEl('circle', { 'class': 'dot b', cx: X(r.b), cy: y, r: 4.5 })); var vt = svgEl('text', { 'class': 'val', x: R + 8, y: y + 4 }); vt.textContent = (isNum(r.a) ? r.a.toFixed(3).replace(/^0/, '') : '—') + '→' + (isNum(r.b) ? r.b.toFixed(3).replace(/^0/, '') : '—'); grp.appendChild(vt); svg.appendChild(grp); });
    this.svgBox.appendChild(svg);
  };
  function mean(a) { var v = a.filter(isNum); return v.length ? v.reduce(function (s, x) { return s + x; }, 0) / v.length : NaN; }
  Paired.prototype.onKey = function (ev) { if (!/^[1-9]$/.test(ev.key)) return false; var b = $$('[role="tab"]', this.tabs)[+ev.key - 1]; if (b) { b.click(); return true; } return false; };
  Paired.prototype.buildTwin = function () { var P = this.P; this.twin(P.groups.map(function (g) { return '<p><b>' + (g.label || g.id) + '</b>' + (isNum(g.delta) ? ' Δ ' + signed(g.delta, 2) : '') + (g.ci ? ' [' + g.ci[0] + ', ' + g.ci[1] + ']' : '') + (isNum(g.p) ? ' p = ' + g.p : '') + '</p><table><tr><th></th><th>' + (P.from || 'a') + '</th><th>' + (P.to || 'b') + '</th></tr>' + g.rows.map(function (r) { return '<tr><td>' + (r.label || r.id) + '</td><td>' + fmtNum(r.a, 2) + '</td><td>' + fmtNum(r.b, 2) + '</td></tr>'; }).join('') + '</table>'; }).join('')); };
  register('paired', Paired);

  /* ====================================================================== Bars */
  function Bars(root) { Widget.call(this, root); }
  Bars.prototype = Object.create(Widget.prototype);
  Bars.prototype.start = function () { var self = this, src = this.root.getAttribute('data-src'); this.root.classList.add('pj-bars'); if (!src) throw new Error('data-src missing'); this.setLoading(true); load(src, 'bars').then(function (b) { self.apply(b); }).catch(function (e) { self.fail(e); }); };
  Bars.prototype.apply = function (B) {
    var self = this, max = isNum(B.max) ? B.max : Math.max.apply(null, B.rows.map(function (r) { return isNum(r.v) ? r.v : 0; })) || 1, ol = el('ol'), lower = this.root.getAttribute('data-lower-better') != null;
    B.rows.forEach(function (r) { var li = el('li', r.emph ? 'emph' : ''), lbl = el('span', 'lbl', r.label); if (r.note) lbl.appendChild(el('small', null, r.note)); var tr = el('span', 'track'), fill = el('i', 'fill'); fill.style.setProperty('--w', clamp(r.v / max * 100, 0, 100).toFixed(1) + '%'); if (r.color) fill.style.setProperty('--sw', tok(r.color, self.root)); tr.appendChild(fill); var val = el('span', 'val', fmtNum(r.v, isNum(r.v) && Math.abs(r.v) >= 100 ? 0 : 2) + (B.unit ? ' ' + B.unit : '')); if (isNum(r.v2)) val.appendChild(el('small', null, ' / ' + fmtNum(r.v2, 3))); li.appendChild(lbl); li.appendChild(tr); li.appendChild(val); ol.appendChild(li); });
    this.body.appendChild(ol); if (lower) { var n = el('p', 'pj-legend'); n.textContent = 'lower is better'; this.body.appendChild(n); }
    this.twin('<table>' + B.rows.map(function (r) { return '<tr><td>' + r.label + '</td><td>' + fmtNum(r.v, 2) + (isNum(r.v2) ? ' / ' + fmtNum(r.v2, 3) : '') + '</td></tr>'; }).join('') + '</table>'); this.ok();
    var on = function () { self.root.classList.add('on'); }; if (reduced() || !('IntersectionObserver' in win)) on(); else { var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); on(); } }, { threshold: .3 }); io.observe(this.root); }
  };
  register('bars', Bars);

  /* ====================================================================== Hist */
  function Hist(root) { Widget.call(this, root); }
  Hist.prototype = Object.create(Widget.prototype);
  Hist.prototype.start = function () { var self = this, src = this.root.getAttribute('data-src'); this.root.classList.add('pj-hist'); if (!src) throw new Error('data-src missing'); this.setLoading(true); load(src, 'hist').then(function (h) { self.apply(h); }).catch(function (e) { self.fail(e); }); if ('ResizeObserver' in win) new ResizeObserver(debounce(function () { self.draw(); }, 100)).observe(this.body); };
  Hist.prototype.apply = function (Hh) {
    var self = this; this.H = Hh; this.rows = Hh.groups.map(function (g) { var row = el('div', 'pj-hist__row'), k = el('div', 'pj-hist__k'); k.innerHTML = '<b>' + g.label + '</b>' + (isNum(g.p50) ? 'p50 ' + fmtNum(g.p50, 1) + ' · p95 ' + fmtNum(g.p95, 1) + ' ' + (Hh.unit || '') : '') + (g.ref ? '<small>' + (g.ref.label || 'ref') + ': ' + fmtNum(g.ref.p50, 0) + ' / ' + fmtNum(g.ref.p95, 0) + '</small>' : '') + (isNum(g.n) ? '<small>n = ' + fmtInt(g.n) + '</small>' : ''); var cv = el('canvas'); cv.setAttribute('aria-hidden', 'true'); cv.style.setProperty('--h', '64px'); row.appendChild(k); row.appendChild(cv); self.body.appendChild(row); return { g: g, cv: cv, ctx: cv.getContext('2d') }; });
    this.twin('<table><tr><th>group</th><th>p50</th><th>p95</th><th>n</th></tr>' + Hh.groups.map(function (g) { return '<tr><td>' + g.label + '</td><td>' + fmtNum(g.p50, 1) + '</td><td>' + fmtNum(g.p95, 1) + '</td><td>' + (isNum(g.n) ? fmtInt(g.n) : '—') + '</td></tr>'; }).join('') + '</table>'); this.ok(); this.draw();
  };
  Hist.prototype.draw = function () {
    var self = this, Hh = this.H; if (!Hh) return; var C = this.colors(), xmax = Hh.x0 + Hh.bin_w * Math.max.apply(null, Hh.groups.map(function (g) { return g.counts.length; }));
    this.rows.forEach(function (r) { var b = sizeCanvas(r.cv, 500, 64), W = b.w, H = b.h, ctx = r.ctx, g = r.g, cmax = Math.max.apply(null, g.counts) || 1, X = function (x) { return (x - Hh.x0) / (xmax - Hh.x0) * W; }; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = rgba(C.accent, .55); g.counts.forEach(function (c, i) { if (!c) return; var x0 = X(Hh.x0 + i * Hh.bin_w), x1 = X(Hh.x0 + (i + 1) * Hh.bin_w), h = c / cmax * (H - 14); ctx.fillRect(x0, H - 4 - h, Math.max(1, x1 - x0 - .5), h); });
      (Hh.lines || []).forEach(function (l) { var x = Math.round(X(l.v)) + .5; ctx.strokeStyle = tok(l.color || 'coral', self.root); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = tok(l.color || 'coral', self.root); ctx.font = '600 9px ' + SANS; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(l.label || '', x + 3, 2); });
      [['p50', C.text], ['p95', C.gold]].forEach(function (m) { var v = g[m[0]]; if (!isNum(v)) return; var x = Math.round(X(v)) + .5; ctx.strokeStyle = m[1]; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, H - 4); ctx.stroke(); ctx.fillStyle = m[1]; ctx.font = '600 9px ' + MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(m[0], x + 3, 2); });
      if (g.ref) [['p50', C.text], ['p95', C.gold]].forEach(function (m) { var v = g.ref[m[0]]; if (!isNum(v)) return; var x = X(v); ctx.fillStyle = m[1]; ctx.beginPath(); ctx.moveTo(x, H - 4); ctx.lineTo(x - 4, H); ctx.lineTo(x + 4, H); ctx.closePath(); ctx.fill(); });
      ctx.fillStyle = C.mute; ctx.font = '500 9px ' + MONO; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(fmtInt(xmax) + ' ' + (Hh.unit || ''), W - 2, H - 5); });
  };
  register('hist', Hist);

  /* ====================================================================== chrome */
  function initNav() {
    var nav = $('.pj-nav'), progress = $('.pj-progress'), burger = $('.pj-burger'), ticking = false, totop = $('.totop');
    function onScroll() { if (ticking) return; ticking = true; requestAnimationFrame(function () { var h = doc.documentElement, max = h.scrollHeight - h.clientHeight; if (progress) progress.style.setProperty('--p', max > 0 ? (h.scrollTop / max).toFixed(4) : 0); if (totop) totop.hidden = h.scrollTop < 600; var hero = $('.pj-hero__grid'); if (hero && !reduced() && win.innerWidth >= 768) { var y = Math.min(h.scrollTop, 600); hero.style.setProperty('--hero-y', (y * .18).toFixed(1) + 'px'); hero.style.setProperty('--hero-o', (1 - y / 900).toFixed(3)); } ticking = false; }); }
    win.addEventListener('scroll', onScroll, { passive: true }); onScroll();
    var anchors = $$('.pj-anchors a'), sections = anchors.map(function (a) { return $(a.getAttribute('href')); }).filter(Boolean);
    if ('IntersectionObserver' in win && sections.length) { var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (!e.isIntersecting) return; anchors.forEach(function (a) { a.removeAttribute('aria-current'); }); var a = anchors.filter(function (x) { return x.getAttribute('href') === '#' + e.target.id; })[0]; if (a) a.setAttribute('aria-current', 'true'); }); }, { rootMargin: '-40% 0px -55% 0px' }); sections.forEach(function (s) { io.observe(s); }); }
    function closeMenu() { if (nav) nav.classList.remove('open'); if (burger) burger.setAttribute('aria-expanded', 'false'); }
    if (burger) burger.addEventListener('click', function () { var open = nav.classList.toggle('open'); burger.setAttribute('aria-expanded', String(open)); burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); });
    var dd = $('.pj-dd'), ddBtn = $('.pj-dd__btn');
    if (ddBtn) ddBtn.addEventListener('click', function (ev) { ev.stopPropagation(); var open = dd.classList.toggle('open'); ddBtn.setAttribute('aria-expanded', String(open)); });
    doc.addEventListener('click', function (ev) { if (dd && !dd.contains(ev.target)) { dd.classList.remove('open'); if (ddBtn) ddBtn.setAttribute('aria-expanded', 'false'); } if (nav && nav.classList.contains('open') && !nav.contains(ev.target)) closeMenu(); });
    $$('.pj-menu a').forEach(function (a) { a.addEventListener('click', function () { closeMenu(); if (dd) dd.classList.remove('open'); }); });
    doc.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { closeMenu(); if (dd) dd.classList.remove('open'); } });
    if (totop) totop.addEventListener('click', function () { win.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); });
  }
  function initReveal() {
    var items = $$('.reveal, .sec-head');
    if (reduced() || !('IntersectionObserver' in win)) { items.forEach(function (e) { e.classList.add('on'); }); return; }
    var ro = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('on'); ro.unobserve(e.target); } }); }, { threshold: .12, rootMargin: '0px 0px -8% 0px' });
    items.forEach(function (e) { ro.observe(e); });
  }
  function initCount() {
    function countUp(e) { var target = parseFloat(e.getAttribute('data-count')), dec = parseInt(e.getAttribute('data-decimals') || '0', 10), suffix = e.getAttribute('data-suffix') || '', prefix = e.getAttribute('data-prefix') || '', fin = e.getAttribute('data-final') || null, dur = 1200, t0 = null; function fmt(v) { var s = v.toFixed(dec); return prefix + (dec === 0 ? Number(s).toLocaleString('en-US') : s) + suffix; } function step(ts) { if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / dur), k = 1 - Math.pow(1 - p, 3); e.textContent = fmt(target * k); if (p < 1) requestAnimationFrame(step); else e.textContent = fin || fmt(target); } requestAnimationFrame(step); }
    var counters = $$('[data-count]'); if (reduced() || !('IntersectionObserver' in win)) return; // authored text already shows the final value
    var co = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); co.unobserve(e.target); } }); }, { threshold: .4 }); counters.forEach(function (e) { co.observe(e); });
  }
  function initTabs() {
    $$('.tabs').forEach(function (tabs) { var list = $$('[role="tab"]', tabs); function activate(tab) { list.forEach(function (t) { var on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; var p = doc.getElementById(t.getAttribute('aria-controls')); if (p) p.hidden = !on; }); $$('video', tabs).forEach(function (v) { if (v.closest('[hidden]')) v.pause(); }); bootAll(tabs); }
      list.forEach(function (t, i) { t.addEventListener('click', function () { activate(t); }); t.addEventListener('keydown', function (ev) { var j = i; if (ev.key === 'ArrowRight') j = (i + 1) % list.length; else if (ev.key === 'ArrowLeft') j = (i - 1 + list.length) % list.length; else if (ev.key === 'Home') j = 0; else if (ev.key === 'End') j = list.length - 1; else return; ev.preventDefault(); list[j].focus(); activate(list[j]); }); }); });
  }
  function initTilt() {
    if (reduced() || !win.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
    $$('.tilt').forEach(function (card) { card.addEventListener('pointermove', function (ev) { var r = card.getBoundingClientRect(); if (!r.width || !r.height) return; var mx = (ev.clientX - r.left) / r.width, my = (ev.clientY - r.top) / r.height; card.style.setProperty('--mx', (mx * 100).toFixed(1) + '%'); card.style.setProperty('--my', (my * 100).toFixed(1) + '%'); card.style.transition = 'none'; card.style.transform = 'perspective(900px) rotateX(' + ((.5 - my) * 4).toFixed(2) + 'deg) rotateY(' + ((mx - .5) * 4).toFixed(2) + 'deg) translateY(-2px)'; }); card.addEventListener('pointerleave', function () { card.style.transition = 'transform .4s ease'; card.style.transform = ''; }); });
  }
  /* modals: lightbox for [data-zoom] images, video modal for [data-video] triggers */
  var lastFocus = null;
  function lock(on) { doc.body.classList.toggle('pj-locked', on); ['main', '.pj-nav', '.pj-foot'].forEach(function (s) { var e = $(s); if (!e) return; if ('inert' in e) e.inert = on; else e.setAttribute('aria-hidden', on ? 'true' : 'false'); }); }
  function makeModal(cls) { var m = el('div', 'pj-modal ' + (cls || '')); m.hidden = true; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); var bd = el('div', 'pj-modal__backdrop'); bd.setAttribute('data-close', ''); m.appendChild(bd); doc.body.appendChild(m); m.addEventListener('click', function (ev) { if (ev.target.hasAttribute('data-close') || ev.target.closest('[data-close]')) closeModal(m); }); m.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.preventDefault(); closeModal(m); } if (ev.key === 'Tab') { var f = $$('button, [href], video, input, [tabindex]:not([tabindex="-1"])', m).filter(function (e) { return !e.hidden && e.offsetParent !== null; }); if (!f.length) return; var first = f[0], last = f[f.length - 1]; if (ev.shiftKey && doc.activeElement === first) { ev.preventDefault(); last.focus(); } else if (!ev.shiftKey && doc.activeElement === last) { ev.preventDefault(); first.focus(); } } }); return m; }
  function openModal(m) { lastFocus = doc.activeElement; m.hidden = false; lock(true); setModal(1); var c = $('[data-close]:not(.pj-modal__backdrop)', m); if (c) c.focus(); }
  function closeModal(m) { if (m.hidden) return; var v = $('video', m); if (v) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); } m.hidden = true; lock(false); setModal(-1); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  var closeSvg = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  function initLightbox() {
    var imgs = $$('[data-zoom]'); if (!imgs.length) return; var lb = makeModal('pj-lightbox'), panel = el('div', 'pj-lightbox__panel'), img = el('img'), cap = el('p'), close = el('button', 'iconbtn pj-lightbox__close'); close.type = 'button'; close.setAttribute('data-close', ''); close.setAttribute('aria-label', 'Close'); close.innerHTML = closeSvg; panel.appendChild(close); panel.appendChild(img); panel.appendChild(cap); lb.appendChild(panel); lb.setAttribute('aria-label', 'Enlarged figure');
    imgs.forEach(function (im) { im.setAttribute('tabindex', '0'); im.setAttribute('role', 'button'); im.setAttribute('aria-label', 'Enlarge: ' + (im.alt || 'figure')); function open() { img.src = im.getAttribute('data-zoom') !== '' && im.getAttribute('data-zoom') !== 'true' ? im.getAttribute('data-zoom') : (im.currentSrc || im.src); img.alt = im.alt; var fc = im.closest('figure') && $('figcaption', im.closest('figure')); cap.textContent = fc ? fc.textContent : im.alt; openModal(lb); } im.addEventListener('click', open); im.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } }); });
  }
  function initVideoModal() {
    var trig = $$('[data-video]'); if (!trig.length) return; var m = makeModal('pj-modal--video'), panel = el('div', 'pj-modal__panel'), head = el('div', 'pj-modal__head'), h = el('h3'), close = el('button', 'iconbtn'); close.type = 'button'; close.setAttribute('data-close', ''); close.setAttribute('aria-label', 'Close'); close.innerHTML = closeSvg; head.appendChild(h); head.appendChild(close); var media = el('div', 'pj-modal__media'), cap = el('p', 'pj-modal__cap'); panel.appendChild(head); panel.appendChild(media); panel.appendChild(cap); m.appendChild(panel); m.setAttribute('aria-label', 'Video');
    trig.forEach(function (b) { b.addEventListener('click', function (ev) { ev.preventDefault(); h.textContent = b.getAttribute('data-title') || b.textContent.trim(); cap.textContent = b.getAttribute('data-caption') || ''; media.style.setProperty('--ar', b.getAttribute('data-ar') || '16/9'); media.innerHTML = ''; var v = el('video'); v.controls = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'metadata'; if (b.getAttribute('data-poster')) v.poster = b.getAttribute('data-poster'); v.src = b.getAttribute('data-video'); v.setAttribute('aria-label', h.textContent); media.appendChild(v); openModal(m); if (!reduced()) { var p = v.play(); if (p && p.catch) p.catch(function () { var t = el('button', 'pj-modal__tap', 'Tap to play'); t.type = 'button'; t.addEventListener('click', function () { v.play(); t.remove(); }); media.appendChild(t); }); } }); });
  }
  function initBib() { $$('.bib').forEach(function (bib) { var btn = $('button', bib), pre = $('pre', bib); if (!btn || !pre) return; btn.addEventListener('click', function () { var text = pre.textContent, lbl = $('span', btn) || btn, orig = lbl.textContent; function done() { btn.classList.add('copied'); lbl.textContent = 'Copied'; setTimeout(function () { btn.classList.remove('copied'); lbl.textContent = orig; }, 2000); } function fb() { var ta = el('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; doc.body.appendChild(ta); ta.select(); try { doc.execCommand('copy'); done(); } catch (e) { /* ignore */ } doc.body.removeChild(ta); } if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(fb); else fb(); }); }); }
  function initStatLinks() { // proof stats → finding cards (.is-hit ring)
    function hit() { var id = location.hash.slice(1), t = id && doc.getElementById(id); if (!t || !t.classList.contains('finding')) return; t.classList.add('is-hit'); setTimeout(function () { t.classList.remove('is-hit'); }, 1800); }
    win.addEventListener('hashchange', hit); $$('a.stat[href^="#"]').forEach(function (a) { a.addEventListener('click', function () { setTimeout(hit, 50); }); });
  }
  function initHeroStage() { // click on the hero stage → boot the signature widget, hand over the clock position, scroll
    $$('.pj-hero__stage').forEach(function (a) { var w = $('[data-widget]', a); if (w) boot(w); a.addEventListener('click', function (ev) { var href = a.getAttribute('href'), target = href && href[0] === '#' && $(href); if (!target) return; ev.preventDefault(); var inst = w && instances.get(w), group = w && w.getAttribute('data-sync'); var tw = $('[data-widget]', target) || (target.hasAttribute('data-widget') ? target : null); if (tw) boot(tw); target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); if (group && inst && inst.st) bus.seek(group, inst.st.t, true); }); });
  }
  /* provenance chips */
  function initSources() {
    var nodes = $$('data.n[data-src]'); if (!nodes.length) return; var inline = inlineJSON('sources-json'), src = doc.body.getAttribute('data-sources');
    var p = inline ? Promise.resolve(inline) : src ? load(src, 'sources') : Promise.resolve(null);
    p.then(function (S) { if (!S) return; try { assertShape('sources', S); } catch (e) { dbg(e.message); return; } var byId = {}; S.sources.forEach(function (s) { byId[s.id] = s; }); var K = { arxiv: 'P', 'hf-card': 'R', 'hf-api': 'R', github: 'R', log: 'L' }, pop = null, popT = 0;
      function show(a, s) { if (!pop) { pop = el('div', 'pj-pop'); pop.setAttribute('role', 'tooltip'); doc.body.appendChild(pop); } pop.innerHTML = '<b>' + (s.kind === 'arxiv' ? 'arXiv ' + (s.url || '').replace(/.*\/abs\//, '') : s.kind === 'log' ? 'device log' : 'release') + (s.date ? ' · ' + s.date : '') + (s.locator ? ' · ' + s.locator : '') + '</b>' + (s.quote ? '<q>' + s.quote + '</q>' : '') + (s.url ? '<br><a href="' + s.url + '" target="_blank" rel="noopener">open source ↗</a>' : ''); pop.hidden = false; var r = a.getBoundingClientRect(); pop.style.left = clamp(r.left, 8, win.innerWidth - 376) + 'px'; pop.style.top = (r.bottom + 6) + 'px'; }
      function hide() { if (pop) pop.hidden = true; }
      nodes.forEach(function (d) { var s = byId[d.getAttribute('data-src')]; if (!s) return; var a = el('a', 'pj-src', K[s.kind] || 'R'); a.href = '#src-' + s.id; a.setAttribute('data-k', K[s.kind] || 'R'); a.setAttribute('aria-label', 'Source: ' + (s.locator || s.kind)); d.appendChild(a); a.addEventListener('mouseenter', function () { clearTimeout(popT); show(a, s); }); a.addEventListener('mouseleave', function () { popT = setTimeout(hide, 150); }); a.addEventListener('focus', function () { show(a, s); }); a.addEventListener('blur', hide); });
      var list = $('details.sources ol[data-auto]'); if (list) { list.innerHTML = ''; S.sources.forEach(function (s) { var li = el('li'); li.id = 'src-' + s.id; li.innerHTML = '<span class="k">' + (K[s.kind] || 'R') + '</span>' + (s.url ? '<a href="' + s.url + '" target="_blank" rel="noopener">' + (s.kind === 'arxiv' ? 'arXiv ' + s.url.replace(/.*\/abs\//, '') : s.url.replace(/^https?:\/\//, '')) + '</a>' : s.locator) + (s.version ? ' ' + s.version : '') + (s.date ? ' · ' + s.date : '') + (s.locator && s.url ? ' · ' + s.locator : '') + (s.quote ? ' — <q>' + s.quote + '</q>' : ''); list.appendChild(li); }); }
    }).catch(function (e) { dbg('sources:', e.message); });
  }

  /* ====================================================================== boot */
  function init() {
    doc.documentElement.classList.remove('no-js');
    initNav(); initReveal(); initCount(); initTabs(); initTilt(); initLightbox(); initVideoModal(); initBib(); initStatLinks(); initSources(); initHeroStage(); bootAll(doc);
    mqReduce.addEventListener && mqReduce.addEventListener('change', function () { instances.forEach(function (w) { w.onVisibility(); }); });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();

  win.Proj = { version: '1.0.0', url: url, json: json, load: load, assertShape: assertShape, bus: bus, boot: boot, bootAll: bootAll, get: function (e) { return instances.get(e); }, register: register, widgets: registry, tok: tok, reduced: reduced,
    seek: function (group, t, play) { bus.seek(group, t, play); }, modalOpen: modalOpen,
    reload: function () { jsonCache.clear(); manifestP = null; instances.forEach(function (w, root) { var clone = root.cloneNode(false); clone.innerHTML = ''; var kids = Array.prototype.slice.call(root.children); kids.forEach(function (k) { if (k.classList.contains('pj-fallback')) clone.appendChild(k); }); root.parentNode.replaceChild(clone, root); }); instances.clear(); bootAll(doc); } };
})();
