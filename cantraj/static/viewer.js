/* CANTraj · V01 interactive trajectory viewer (Canvas 2D) · registers the kit widget "ct-viewer" (SPEC §4.1, §4.7, §5 V01, §6).
   One root per window: the hero stage (data-mode="hero": own clock, window picker and transport rendered into the sibling
   div.ct-viewer__ctl[data-ct-ctl-for="hero"]) and six followers in #examples (data-mode="full", class ct-viewer--follow: no own clock,
   they draw on pj:time / pj:seek / pj:hover of their data-sync group, which the kit Scrubber owns). Frame: metres east (x) / north (y)
   of the window's given start; t = seconds after the window start (0–300). Data: traj_index + traj_ex1..6 (table/1, SPEC §3.1) through
   Proj.load('key:…', 'table'); speed/steering for the tooltip come from the Scrubber's loaded signals (Proj.get(root).st.sig).
   Colours only through the CSS custom properties of cantraj.css (--ct-s2, --ct-ink, --ct-road, --cl-bg, text tokens). */
(function (win, doc) {
  'use strict';
  var Proj = win.Proj; if (!Proj) return;
  var CT = win.CT = win.CT || {};
  if (CT.viewer && CT.viewer.version) return;

  /* ---------------------------------------------------------------- helpers */
  var $ = function (s, r) { return (r || doc).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };
  var dbg = function () { if (win.console && console.debug) console.debug.apply(console, ['[ct-viewer]'].concat(Array.prototype.slice.call(arguments))); };
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function svgEl(tag, attrs) { var e = doc.createElementNS('http://www.w3.org/2000/svg', tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function setText(node, s) { if (node && node.textContent !== s) node.textContent = s; }
  function debounce(fn, ms) { var h = 0; return function () { var a = arguments, s = this; clearTimeout(h); h = setTimeout(function () { fn.apply(s, a); }, ms); }; }
  function cssVar(name, fb) { var v = ''; try { v = getComputedStyle(doc.body).getPropertyValue(name).trim(); } catch (e) { /* detached */ } return v || fb; }
  function upperBound(arr, t) { var lo = 0, hi = arr.length; while (lo < hi) { var mid = (lo + hi) >> 1; if (arr[mid] <= t) lo = mid + 1; else hi = mid; } return lo; }
  function fmtInt(v) { return Math.round(v).toLocaleString('en-US'); }
  function fmtM(v) { return isNum(v) ? (Math.abs(v) >= 10 ? fmtInt(v) : v.toFixed(1)).replace('-', '−') + ' m' : 'no output'; }
  function fmtT(t) { return (Math.abs(t - Math.round(t)) < 0.05 ? String(Math.round(t)) : t.toFixed(1)) + ' s'; }
  function fmtSigned(v, dp) { return (v < 0 ? '−' : '') + Math.abs(v).toFixed(dp); }
  function fmtKm(v) { return isNum(v) ? v.toFixed(1) + ' km' : '—'; }
  function dotLabel(label) { return String(label || '').replace(/,\s*/g, ' · '); } // "urban, 2.9 km" → "urban · 2.9 km"
  /* backing-store scale capped at 1.5 (kit rule); read through media queries, which is all the cap needs */
  var DPR = win.matchMedia && win.matchMedia('(min-resolution: 1.5dppx)').matches ? 1.5 : win.matchMedia && win.matchMedia('(min-resolution: 1.25dppx)').matches ? 1.25 : 1;

  /* ---------------------------------------------------------------- constants */
  var WINDOW_S = 300, RATE = 10, HOLD_S = 1.5, PAD = 24, HIT_PX = 24, CLICK_PX = 48, SCALES = [200, 500, 1000, 2000];
  var INDEX_COLS = ['id', 'label', 'density_class', 'path_km', 'fold', 'fold_label', 'episode_id', 'nodes_per_km2', 'n_turns', 'ade_beam_m', 'ade_filter_m',
    'file_key', 'signals_key', 'clip_t0_rel_s', 'clip_dur_s', 'frame_t_rel_s', 'window_s', 'theta0_rad', 'box_m', 'n_ref'];
  var TRAJ_COLS = ['t_rel_s', 'ref_x', 'ref_y', 'beam_x', 'beam_y', 'filter_x', 'filter_y', 'err_beam_m', 'err_filter_m'];
  var SERIES = [{ key: 'ref', label: 'GNSS reference', slot: 'ink', style: 'online' }, { key: 'beam', label: 'offline beam', slot: 2, style: 'offline' }, { key: 'filter', label: 'online filter', slot: 2, style: 'online' }];

  /* ---------------------------------------------------------------- colours (cantraj.css tokens; fallbacks = the same hex values) */
  function colors() {
    return { ink: cssVar('--ct-ink', '#e8eefc'), s2: cssVar('--ct-s2', '#d95926'), road: cssVar('--ct-road', 'rgba(159,178,214,.35)'),
      bg: cssVar('--ct-surface', '') || cssVar('--cl-bg', '#070d1d'), mute: cssVar('--cl-text-mute', '#9fb2d6'), text: cssVar('--cl-text', '#e8eefc') };
  }

  /* ---------------------------------------------------------------- shape checks (the kit only checks the schema prefix) */
  function need(cond, msg) { if (!cond) throw new Error(msg); }
  function checkTable(o, key, cols) {
    need(o && typeof o === 'object' && o.cols && typeof o.cols === 'object', key + ': cols missing');
    need(isNum(o.n) && o.n >= 1, key + ': n missing');
    cols.forEach(function (c) { need(Array.isArray(o.cols[c]), key + ': ' + c + ' missing'); need(o.cols[c].length === o.n, key + ': ' + c + ' length ' + o.cols[c].length + ' ≠ ' + o.n); });
    return o;
  }
  function checkIndex(o) {
    checkTable(o, 'traj_index', INDEX_COLS);
    for (var i = 0; i < o.n; i++) need(Array.isArray(o.cols.box_m[i]) && o.cols.box_m[i].length === 4, 'traj_index: box_m[' + i + '] missing');
    return o;
  }
  function checkTraj(o, key) {
    checkTable(o, key, TRAJ_COLS);
    var T = o.cols.t_rel_s; for (var i = 1; i < o.n; i++) need(T[i] > T[i - 1], key + ': t_rel_s not increasing at ' + i);
    need(Array.isArray(o.roads), key + ': roads missing');
    if (o.candidates == null) o.candidates = []; need(Array.isArray(o.candidates), key + ': candidates missing');
    o.candidates.forEach(function (c, j) { need(c && Array.isArray(c.x) && Array.isArray(c.y) && c.x.length === o.n && c.y.length === o.n, key + ': candidates[' + j + '] missing'); });
    return o;
  }
  function rowOf(idx, i) { var r = {}; Object.keys(idx.cols).forEach(function (k) { r[k] = idx.cols[k][i]; }); return r; }

  /* ---------------------------------------------------------------- geometry: the paper's box fitted with equal aspect and PAD px */
  function fitBox(box, w, h) {
    var x0 = box[0], x1 = box[1], y0 = box[2], y1 = box[3], bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    var s = Math.max(1e-6, Math.min((w - 2 * PAD) / bw, (h - 2 * PAD) / bh));
    return { s: s, ox: w / 2 - (x0 + x1) / 2 * s, oy: h / 2 + (y0 + y1) / 2 * s, w: w, h: h };
  }
  function X(fit, x) { return fit.ox + x * fit.s; }
  function Y(fit, y) { return fit.oy - y * fit.s; }
  function scaleBar(fit, maxPx) { // the largest of 200 m / 500 m / 1 km / 2 km that fits in 80–160 px (narrow plots cap the bar at 30 % of their width)
    var hi = Math.max(60, Math.min(160, maxPx || 160)), lo = Math.min(80, hi * 0.5), pick = SCALES[0], i;
    for (i = 0; i < SCALES.length; i++) { var px = SCALES[i] * fit.s; if (px <= hi && px >= lo) pick = SCALES[i]; }
    if (pick * fit.s > hi || pick * fit.s < lo) { pick = SCALES[0]; for (i = 0; i < SCALES.length; i++) if (SCALES[i] * fit.s <= hi) pick = SCALES[i]; }
    return { m: pick, px: pick * fit.s, label: pick >= 1000 ? (pick / 1000) + ' km' : pick + ' m' };
  }

  /* ---------------------------------------------------------------- data access: positions and errors at a time t (linear between reference seconds) */
  function posAt(data, key, t, out) { // out = [x, y] in metres or null when the method has no output at t
    var T = data.cols.t_rel_s, xs = data.cols[key + '_x'], ys = data.cols[key + '_y'], n = data.n; t = clamp(t, T[0], T[n - 1]); var k = upperBound(T, t);
    if (k === 0) { return isNum(xs[0]) && isNum(ys[0]) ? (out[0] = xs[0], out[1] = ys[0], out) : null; }
    if (k >= n) { return isNum(xs[n - 1]) && isNum(ys[n - 1]) ? (out[0] = xs[n - 1], out[1] = ys[n - 1], out) : null; }
    var a = k - 1, u = (t - T[a]) / (T[k] - T[a]);
    if (!isNum(xs[a]) || !isNum(xs[k]) || !isNum(ys[a]) || !isNum(ys[k])) return null;
    out[0] = xs[a] + (xs[k] - xs[a]) * u; out[1] = ys[a] + (ys[k] - ys[a]) * u; return out;
  }
  function errAt(T, col, t) { // scalar column (errors), linear between reference seconds; null across gaps
    var n = T.length; t = clamp(t, T[0], T[n - 1]); var k = upperBound(T, t);
    if (k === 0) return isNum(col[0]) ? col[0] : null;
    if (k >= n) return isNum(col[n - 1]) ? col[n - 1] : null;
    var a = k - 1; if (!isNum(col[a]) || !isNum(col[k])) return null;
    return col[a] + (col[k] - col[a]) * (t - T[a]) / (T[k] - T[a]);
  }
  function nearestRef(data, fit, px, py) { // nearest reference second to a plot point (CSS px); { i, t, d } or null
    var T = data.cols.t_rel_s, xs = data.cols.ref_x, ys = data.cols.ref_y, best = -1, bd = Infinity;
    for (var i = 0; i < data.n; i++) { if (!isNum(xs[i]) || !isNum(ys[i])) continue; var dx = X(fit, xs[i]) - px, dy = Y(fit, ys[i]) - py, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
    return best < 0 ? null : { i: best, t: T[best], d: Math.sqrt(bd) };
  }

  /* ---------------------------------------------------------------- drawing primitives */
  function tracePath(ctx, fit, xs, ys, i0, i1, endPt) { // polyline through indices i0..i1 (pen up at nulls) plus an optional end point [x, y]
    var pen = false, drew = false;
    for (var i = i0; i <= i1; i++) { var x = xs[i], y = ys[i]; if (!isNum(x) || !isNum(y)) { pen = false; continue; } var px = X(fit, x), py = Y(fit, y); if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py); pen = true; drew = true; }
    if (endPt) { var ex = X(fit, endPt[0]), ey = Y(fit, endPt[1]); if (pen) ctx.lineTo(ex, ey); else ctx.moveTo(ex, ey); drew = true; }
    return drew;
  }
  function strokeStyle(ctx, color, width, dash, alpha) { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash(dash || []); ctx.globalAlpha = alpha == null ? 1 : alpha; }
  var P = [0, 0];
  function drawSeries(ctx, fit, data, key, t, color, width, dash, aheadAlpha) { // behind t at full strength, the remainder at aheadAlpha
    var T = data.cols.t_rel_s, xs = data.cols[key + '_x'], ys = data.cols[key + '_y'], n = data.n, k = upperBound(T, t), at = posAt(data, key, t, P);
    var end = at ? [at[0], at[1]] : null;
    if (k > 0) { ctx.beginPath(); if (tracePath(ctx, fit, xs, ys, 0, k - 1, end)) { strokeStyle(ctx, color, width, dash, 1); ctx.stroke(); } }
    if (k < n && aheadAlpha > 0) { ctx.beginPath(); var started = false; if (end) { ctx.moveTo(X(fit, end[0]), Y(fit, end[1])); started = true; }
      var pen = started; for (var i = k; i < n; i++) { var x = xs[i], y = ys[i]; if (!isNum(x) || !isNum(y)) { pen = false; continue; } var px = X(fit, x), py = Y(fit, y); if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py); pen = true; started = true; }
      if (started) { strokeStyle(ctx, color, width, dash, aheadAlpha); ctx.stroke(); } }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
  }
  function ring(ctx, x, y, r, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); }
  function markCircle(ctx, x, y, r, color, bg) { ring(ctx, x, y, r + 2, bg); ring(ctx, x, y, r, color); }
  function markSquare(ctx, x, y, size, color, bg) { var h = size / 2; ctx.fillStyle = bg; ctx.fillRect(x - h - 2, y - h - 2, size + 4, size + 4); ctx.fillStyle = color; ctx.fillRect(x - h, y - h, size, size); }
  function drawStart(ctx, fit, theta, C) { // the given start: white dot, 2 px ink ring, 14 px heading arrow from theta0 (radians from east, anticlockwise)
    var x = X(fit, 0), y = Y(fit, 0);
    ring(ctx, x, y, 9.5, C.bg); ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x, y, 7.5, 0, 6.2832); ctx.stroke(); ring(ctx, x, y, 5, '#ffffff');
    if (isNum(theta)) { var dx = Math.cos(theta), dy = -Math.sin(theta), x0 = x + dx * 9.5, y0 = y + dy * 9.5, x1 = x + dx * 23.5, y1 = y + dy * 23.5;
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      var nx = -dy, ny = dx; ctx.fillStyle = C.ink; ctx.beginPath(); ctx.moveTo(x1 + dx * 4, y1 + dy * 4); ctx.lineTo(x1 - dx * 2 + nx * 4, y1 - dy * 2 + ny * 4); ctx.lineTo(x1 - dx * 2 - nx * 4, y1 - dy * 2 - ny * 4); ctx.closePath(); ctx.fill(); }
  }
  function roadsLayer(data, fit, cw, ch, dpr, color) { // offscreen cache of the road polylines (1 px, --ct-road), redrawn on resize or window change
    var c = doc.createElement('canvas'); c.width = Math.max(1, cw); c.height = Math.max(1, ch); var o = c.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0);
    o.strokeStyle = color; o.lineWidth = 1; o.lineJoin = 'round'; o.lineCap = 'round'; o.beginPath();
    var roads = data.roads || []; for (var r = 0; r < roads.length; r++) { var pl = roads[r]; for (var i = 0; i < pl.length; i++) { var px = X(fit, pl[i][0]), py = Y(fit, pl[i][1]); if (i) o.lineTo(px, py); else o.moveTo(px, py); } }
    o.stroke(); return c;
  }

  /* ---------------------------------------------------------------- CT.viewer.drawFrame(ctx, data, opts): one frame at opts.t (pure; hero and followers share it)
     opts: { t, w, h, dpr, fit, roads (cached layer or null), showRoads, showCandidates, hover (t or null), colors, theta0 } */
  function drawFrame(ctx, data, o) {
    var w = o.w, h = o.h, dpr = o.dpr || 1, fit = o.fit || fitBox(data.meta && data.meta.box_m || [-1000, 1000, -1000, 1000], w, h), C = o.colors || colors(), t = isNum(o.t) ? o.t : WINDOW_S;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (o.showRoads !== false) { if (o.roads) ctx.drawImage(o.roads, 0, 0); else { ctx.drawImage(roadsLayer(data, fit, ctx.canvas.width, ctx.canvas.height, dpr, C.road), 0, 0); } }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var T = data.cols.t_rel_s, k = upperBound(T, t);
    if (o.showCandidates !== false && data.candidates && data.candidates.length && k > 0) { // the beam's other candidates, progressive, 1.5 px slot 2 at 30 %
      strokeStyle(ctx, C.s2, 1.5, null, 0.3);
      for (var c = 0; c < data.candidates.length; c++) { var cd = data.candidates[c]; ctx.beginPath(); if (tracePath(ctx, fit, cd.x, cd.y, 0, k - 1, null)) ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    drawSeries(ctx, fit, data, 'ref', t, C.ink, 2.6, null, 0.18);
    drawSeries(ctx, fit, data, 'beam', t, C.s2, 2, [7, 4], 0.18);
    drawSeries(ctx, fit, data, 'filter', t, C.s2, 2, null, 0.18);
    drawStart(ctx, fit, isNum(o.theta0) ? o.theta0 : (data.meta && data.meta.theta0_rad), C);
    if (o.hover != null && isNum(o.hover)) { var hp = posAt(data, 'ref', o.hover, P); if (hp) { var hx = X(fit, hp[0]), hy = Y(fit, hp[1]); ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.strokeStyle = C.bg; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(hx, hy, 8, 0, 6.2832); ctx.stroke(); ctx.strokeStyle = C.mute; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(hx, hy, 8, 0, 6.2832); ctx.stroke(); } }
    var pr = posAt(data, 'ref', t, P); if (pr) markCircle(ctx, X(fit, pr[0]), Y(fit, pr[1]), 4.5, C.ink, C.bg);
    var pb = posAt(data, 'beam', t, P); if (pb) markSquare(ctx, X(fit, pb[0]), Y(fit, pb[1]), 9, C.s2, C.bg);
    var pf = posAt(data, 'filter', t, P); if (pf) markCircle(ctx, X(fit, pf[0]), Y(fit, pf[1]), 4.5, C.s2, C.bg);
  }

  /* ---------------------------------------------------------------- legend keys (inline SVG; colours through the --ct-* properties) */
  function keySvg(style, slot, alpha) {
    var s = svgEl('svg', { width: 28, height: 12, viewBox: '0 0 28 12', 'aria-hidden': 'true' }), col = slot === 'ink' ? 'var(--ct-ink)' : slot === 'road' ? 'var(--ct-road)' : 'var(--ct-s' + slot + ')';
    s.style.cssText = 'display:inline-block;width:28px;height:12px;vertical-align:middle'; // .ct-plot svg{width:100%} is for chart SVGs, not these keys
    var ln = svgEl('line', { x1: 1, y1: 6, x2: 27, y2: 6, 'stroke-width': style === 'road' ? 1 : style === 'thin' ? 1.5 : 2, 'stroke-linecap': 'round' });
    ln.style.stroke = col; if (style === 'offline') ln.setAttribute('stroke-dasharray', '7 4'); if (alpha != null) ln.setAttribute('opacity', String(alpha)); s.appendChild(ln); return s;
  }
  function keyEntry(label, style, slot, alpha) { var sp = el('span'); sp.style.whiteSpace = 'nowrap'; sp.appendChild(keySvg(style, slot, alpha)); sp.appendChild(doc.createTextNode(' ' + label)); return sp; }

  /* ---------------------------------------------------------------- the widget */
  function CtViewer(root) {
    this.root = root; this.mode = root.getAttribute('data-mode') || 'full'; this.hero = this.mode === 'hero'; this.sync = root.getAttribute('data-sync') || null;
    this.sync0 = this.sync; this.follow = false; this.window = null; this.index = null; this.data = null; this.row = null; this.destroyed = false; this.visible = false; this.visible50 = false;
    this.st = { t: this.hero ? 0 : WINDOW_S, playing: false, dur: WINDOW_S, hover: null, showCandidates: true, showRoads: true, clock0: 0, raf: 0, dirty: true, userPaused: false, userStarted: false, lastText: 0 };
    root.classList.add('pj-w', 'is-js', 'ct-viewer'); root.setAttribute('data-mode', this.mode);
    if (!root.hasAttribute('role')) root.setAttribute('role', 'group');
    this.baseLabel = root.getAttribute('data-label') || 'Recovered window viewer';
    if (!root.hasAttribute('aria-label')) root.setAttribute('aria-label', this.baseLabel);
    if (!this.hero && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '0');
    this.body = $('.pj-w__body', root); if (!this.body) { this.body = el('div', 'pj-w__body'); var fb = $('.pj-fallback', root); if (fb) root.insertBefore(this.body, fb); else root.appendChild(this.body); }
    this.live = el('p', 'vh'); this.live.setAttribute('aria-live', 'polite'); root.appendChild(this.live);
    if (!this.hero) { this.twinEl = el('details', 'pj-twin'); this.twinEl.appendChild(el('summary', null, 'Data as text')); this.twinBody = el('div'); this.twinEl.appendChild(this.twinBody); root.appendChild(this.twinEl); }
    CT.viewer.instances.set(root, this);
  }
  CtViewer.prototype.name = 'ct-viewer';

  CtViewer.prototype.start = function () {
    var self = this, root = this.root; root.classList.add('is-loading');
    var src = root.getAttribute('data-src'); if (!src) throw new Error('data-src missing');
    this.buildChrome(); this.observe(); this.bindBus(); this.bindPointer(); this.bindKeys(); this.bindStage();
    Proj.load(src, 'table').then(function (idx) {
      self.index = checkIndex(idx);
      var id = root.getAttribute('data-window') || (idx.meta && idx.meta.default_window) || idx.cols.id[0];
      return self.setWindow(id);
    }).then(function () { if (self.destroyed) return; self.ok(); if (self.hero) self.maybeAutoplay(); }).catch(function (e) { self.fail(e); });
  };
  CtViewer.prototype.ok = function () { var r = this.root; r.classList.remove('is-loading', 'is-error'); r.classList.add('is-live'); var e = $('.pj-w__err', r); if (e) e.remove(); doc.dispatchEvent(new CustomEvent('pj:ready', { detail: { el: r, widget: this.name } })); };
  CtViewer.prototype.fail = function (err) {
    dbg(this.name, 'failed:', err && err.message); this.pause(); var r = this.root; r.classList.remove('is-loading', 'is-live'); r.classList.add('is-error');
    if (!$('.pj-w__err', r)) { var e = el('p', 'pj-w__err', 'Data unavailable — showing the static figure.'); e.setAttribute('role', 'note'); r.appendChild(e); }
    if (this.twinEl) this.twinEl.hidden = true; if (this.heroCtl) this.heroCtl.hidden = true;
  };
  CtViewer.prototype.announce = function (msg) { var self = this; clearTimeout(this.announceT); this.announceT = setTimeout(function () { self.live.textContent = msg; }, 150); };

  /* chrome: plot + canvas + HUD + tooltip inside the body; toggles (.ct-ctl) and transport (.ct-viewer__ctl) for non-hero; hero transport in the sibling container */
  CtViewer.prototype.buildChrome = function () {
    var self = this, body = this.body;
    this.plot = $('.ct-plot', body) || $('.pj-plot', body); if (!this.plot) { this.plot = el('div', 'pj-plot ct-plot'); body.appendChild(this.plot); } this.plot.classList.add('pj-plot', 'ct-plot');
    this.cv = $('canvas', this.plot) || el('canvas'); this.cv.setAttribute('aria-hidden', 'true'); if (!this.cv.parentNode) this.plot.appendChild(this.cv); this.ctx = this.cv.getContext('2d');
    var hud = this.hud = el('div', 'ct-viewer__hud'); hud.setAttribute('aria-hidden', 'true');
    this.hudTL = el('div', 'tl'); this.hudTR = el('div', 'tr'); this.hudBL = el('div', 'bl'); this.hudBR = el('div', 'br');
    this.hudTitle = el('b'); this.hudEp = el('span'); this.hudTL.appendChild(this.hudTitle); this.hudTL.appendChild(el('br')); this.hudTL.appendChild(this.hudEp);
    this.hudClock = el('b'); this.hudErr = el('span'); this.hudErrB = el('span'); this.hudSep = doc.createTextNode(' · '); this.hudBr = el('br'); this.hudBr.hidden = true; this.hudErrF = el('span');
    this.hudErr.appendChild(this.hudErrB); this.hudErr.appendChild(this.hudSep); this.hudErr.appendChild(this.hudBr); this.hudErr.appendChild(this.hudErrF);
    this.hudTR.appendChild(this.hudClock); this.hudTR.appendChild(el('br')); this.hudTR.appendChild(this.hudErr);
    this.hudScale = el('i', 'ct-scale'); this.hudScaleTxt = el('span'); this.hudBR.appendChild(this.hudScale); this.hudBR.appendChild(this.hudScaleTxt);
    hud.appendChild(this.hudTL); hud.appendChild(this.hudTR); hud.appendChild(this.hudBL); hud.appendChild(this.hudBR); this.plot.appendChild(hud);
    if (!this.hero) {
      this.tip = el('div', 'ct-tip'); this.tip.hidden = true; this.plot.appendChild(this.tip);
      this.ctl = $('.ct-ctl', body) || el('div', 'ct-ctl'); if (!this.ctl.parentNode) body.insertBefore(this.ctl, this.plot);
      this.roadsBtn = this.chipBtn('roads', true, function (on) { self.st.showRoads = on; self.redraw(); self.buildHudLegend(); self.announce(on ? 'Roads shown' : 'Roads hidden'); });
      this.candBtn = this.chipBtn('other beam candidates', true, function (on) { self.st.showCandidates = on; self.redraw(); self.buildHudLegend(); self.announce(on ? 'Other beam candidates shown' : 'Other beam candidates hidden'); });
      this.ctl.appendChild(this.roadsBtn); this.ctl.appendChild(this.candBtn);
      this.transport = el('div', 'ct-viewer__ctl'); body.appendChild(this.transport); this.buildTransport(this.transport, false);
    } else {
      var host = $('.ct-viewer__ctl[data-ct-ctl-for="hero"]'); if (!host) { host = el('div', 'ct-viewer__ctl'); host.setAttribute('data-ct-ctl-for', 'hero'); var a = this.root.closest('a.pj-hero__stage'); if (a && a.parentNode) a.parentNode.insertBefore(host, a.nextSibling); else this.root.parentNode.insertBefore(host, this.root.nextSibling); }
      this.heroCtl = host; host.textContent = ''; this.buildTransport(host, true);
    }
    if ('ResizeObserver' in win) { this.ro = new ResizeObserver(debounce(function () { self.size(); }, 100)); this.ro.observe(this.plot); }
  };
  CtViewer.prototype.chipBtn = function (label, on, fn) { var b = el('button', 'chip chip--sm', label); b.type = 'button'; b.setAttribute('aria-pressed', String(on)); b.addEventListener('click', function () { var now = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(now)); fn(now); }); return b; };
  CtViewer.prototype.buildTransport = function (host, withPicker) {
    var self = this;
    if (withPicker) { this.picker = el('div', 'chips'); this.picker.setAttribute('role', 'radiogroup'); this.picker.setAttribute('aria-label', 'Window'); host.appendChild(this.picker); }
    var play = this.playBtn = el('button', 'ct-viewer__play'); play.type = 'button'; play.setAttribute('aria-label', 'Play the five-minute window');
    this.icPlay = svgEl('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true' }); this.icPlay.appendChild(svgEl('path', { d: 'M7 5v14l12-7z', fill: 'currentColor' }));
    this.icPause = svgEl('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true' }); this.icPause.appendChild(svgEl('path', { d: 'M8 5v14M16 5v14', stroke: 'currentColor', 'stroke-width': 2.5, 'stroke-linecap': 'round', fill: 'none' })); this.icPause.setAttribute('hidden', '');
    play.appendChild(this.icPlay); play.appendChild(this.icPause); play.addEventListener('click', function () { self.toggle(true); }); host.appendChild(play);
    var sc = this.scrub = el('input', 'ct-viewer__scrub'); sc.type = 'range'; sc.min = '0'; sc.max = String(WINDOW_S); sc.step = '0.1'; sc.value = String(this.st.t); sc.setAttribute('aria-label', 'Window position (seconds after the start)');
    sc.addEventListener('input', function () { self.st.userStarted = true; self.seek(+sc.value, 'scrub'); });
    sc.addEventListener('pointerdown', function () { self.scrubbing = true; }); // the 10 Hz tick leaves the slider alone while it is dragged
    ['pointerup', 'pointercancel', 'change', 'blur'].forEach(function (t) { sc.addEventListener(t, function () { self.scrubbing = false; self.updateTransport(); }); });
    sc.addEventListener('keydown', function (ev) { var d = ev.key === 'ArrowRight' || ev.key === 'ArrowUp' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowDown' ? -1 : 0; if (!d) return; ev.preventDefault(); self.st.userStarted = true; self.seek(self.st.t + d * (ev.shiftKey ? 10 : 1)); });
    host.appendChild(sc); this.clock = el('span', 'ct-viewer__clock'); host.appendChild(this.clock);
    if (withPicker) host.addEventListener('keydown', function (ev) { if (ev.altKey || ev.ctrlKey || ev.metaKey) return; if (/^[1-6]$/.test(ev.key) && self.index) { var id = self.index.cols.id[+ev.key - 1]; if (id) { ev.preventDefault(); self.pick(id); } } });
    this.updateTransport();
  };
  CtViewer.prototype.buildPicker = function () {
    var self = this, idx = this.index; if (!this.picker || !idx) return; this.picker.textContent = '';
    for (var i = 0; i < idx.n; i++) (function (i) { var id = idx.cols.id[i], b = el('button', 'chip', (i + 1) + ' · ' + dotLabel(idx.cols.label[i])); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('data-window', id); b.setAttribute('aria-checked', String(id === self.window)); b.tabIndex = id === self.window ? 0 : -1;
      b.addEventListener('click', function () { self.pick(id); b.focus(); });
      b.addEventListener('keydown', function (ev) { var bs = $$('[role="radio"]', self.picker), j = bs.indexOf(b); if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') j = (j + 1) % bs.length; else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') j = (j - 1 + bs.length) % bs.length; else if (ev.key === 'Home') j = 0; else if (ev.key === 'End') j = bs.length - 1; else return; ev.preventDefault(); bs[j].focus(); bs[j].click(); });
      self.picker.appendChild(b); })(i);
  };
  CtViewer.prototype.pick = function (id) { var self = this; if (id === this.window) return Promise.resolve(); this.st.userStarted = true; return this.setWindow(id).then(function () { if (self.row) self.announce('Window ' + id + ' · ' + self.row.label); }).catch(function (e) { dbg('setWindow', id, e && e.message); self.announce('Window ' + id + ' is unavailable'); var b = self.picker && self.picker.querySelector('[data-window="' + id + '"]'); if (b) { b.setAttribute('aria-disabled', 'true'); b.title = 'Data unavailable'; } }); };
  CtViewer.prototype.updateTransport = function () { // every write is guarded: no attribute churn at 10 Hz (a changed aria-valuetext on a focused slider is announced)
    var st = this.st, tt = st.t.toFixed(1);
    if (this.scrub && this.scrubbing !== true) { if (+this.scrub.value !== +tt) this.scrub.value = tt; var vt = tt + ' s of ' + WINDOW_S + ' s'; if (this.scrub.getAttribute('aria-valuetext') !== vt) this.scrub.setAttribute('aria-valuetext', vt); }
    setText(this.clock, tt + ' s / ' + WINDOW_S + ' s');
    if (this.playBtn) { var lbl = st.playing ? 'Pause the five-minute window' : 'Play the five-minute window'; if (this.playBtn.getAttribute('aria-label') !== lbl) { this.playBtn.setAttribute('aria-label', lbl); if (st.playing) { this.icPlay.setAttribute('hidden', ''); this.icPause.removeAttribute('hidden'); } else { this.icPause.setAttribute('hidden', ''); this.icPlay.removeAttribute('hidden'); } } }
    if (this.root.classList.contains('is-playing') !== !!st.playing) this.root.classList.toggle('is-playing', !!st.playing);
  };
  CtViewer.prototype.buildHudLegend = function () {
    var bl = this.hudBL; if (!bl) return; bl.textContent = '';
    bl.appendChild(keyEntry(SERIES[0].label, 'online', 'ink')); bl.appendChild(doc.createTextNode(' ')); bl.appendChild(keyEntry(SERIES[1].label, 'offline', 2)); bl.appendChild(doc.createTextNode(' ')); bl.appendChild(keyEntry(SERIES[2].label, 'online', 2));
    if (this.st.showRoads) { bl.appendChild(doc.createTextNode(' ')); bl.appendChild(keyEntry('roads', 'road', 'road')); }
    if (this.st.showCandidates && this.data && this.data.candidates.length) { bl.appendChild(doc.createTextNode(' ')); bl.appendChild(keyEntry('other beam candidates', 'thin', 2, 0.45)); }
  };

  /* kit 1.0.0 stores clip time on 'seeked' (st.t = video.currentTime) while this page's signals start at t0 = 138 s: a seek while the clip is
     paused would leave the Scrubber in clip time (slider at 0, strips off the window, pj:time in clip time). Listeners run in registration
     order, so a second 'seeked' listener corrects st.t before the kit's rAF render and its bus emission. Inert once the kit adds t0 itself. */
  function fixSeeked(sc) {
    if (!sc || !sc.video || !sc.st || sc._ctSeekFix) return; sc._ctSeekFix = true;
    sc.video.addEventListener('seeked', function () { var s = sc.st; if (s && s.sig && isNum(s.t0) && s.t < s.t0 - 1e-6) { s.t = sc.video.currentTime + s.t0; s.prevT = s.t; s.dirty = true; if (typeof sc.kick === 'function') sc.kick(); } });
  }
  /* window selection: loads traj_<id>, switches the sync group, redraws, updates pill / aria label / picker / twin */
  CtViewer.prototype.setWindow = function (id) {
    var self = this, idx = this.index; if (!idx) return Promise.reject(new Error('traj_index: not loaded'));
    var i = idx.cols.id.indexOf(id); if (i < 0) return Promise.reject(new Error('traj_index: window ' + id + ' missing'));
    var key = idx.cols.file_key[i]; this.pendingWindow = id;
    return Proj.load('key:' + key, 'table').then(function (d) {
      if (self.pendingWindow !== id || self.destroyed) return;
      checkTraj(d, key);
      var row = rowOf(idx, i), st = self.st, wasPlaying = st.playing;
      self.window = id; self.row = row; self.data = d; self.sync = self.hero || !self.sync0 ? 'ct-' + id : self.sync0; self.root.setAttribute('data-sync', self.sync);
      self.follow = !self.hero && !!self.scrubberRoot(); fixSeeked(self.scrubber());
      st.dur = isNum(row.window_s) ? row.window_s : WINDOW_S; self.roads = null; self.fit = null;
      if (self.hero) { if (Proj.reduced()) { st.t = st.dur; } else if (wasPlaying) { st.t = 0; st.clock0 = performance.now(); } else st.t = clamp(st.t, 0, st.dur); }
      else st.t = clamp(st.t, 0, st.dur);
      self.root.setAttribute('aria-label', self.baseLabel + ' · ' + id + ' · ' + row.label);
      var a = self.root.closest('a.pj-hero__stage'); if (a) { var pill = $('.pj-stage__cap .pj-pill--live', a); if (pill) setText(pill, id + ' · ' + dotLabel(row.label)); }
      if (self.picker) { if (!self.picker.children.length) self.buildPicker(); $$('[role="radio"]', self.picker).forEach(function (b) { var on = b.getAttribute('data-window') === id; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }); }
      if (self.candBtn) self.candBtn.hidden = !d.candidates.length;
      if (self.transport) self.transport.hidden = self.follow;
      setText(self.hudTitle, id + ' · ' + row.label); setText(self.hudEp, row.episode_id || '');
      self.buildHudLegend(); self.buildTwin(); self.size(); self.updateTransport(); self.redraw();
    });
  };

  /* sizing: canvas backing store at DPR, fit of the box, cached roads, scale bar */
  CtViewer.prototype.size = function () {
    var w = this.plot.clientWidth, h = this.plot.clientHeight; if (!w || !h) { this.w = this.h = 0; return; }
    var bw = Math.round(w * DPR), bh = Math.round(h * DPR); if (this.cv.width !== bw) this.cv.width = bw; if (this.cv.height !== bh) this.cv.height = bh;
    this.w = w; this.h = h; this.C = colors(); var narrow = w < 460; if (narrow !== this.narrow) { this.narrow = narrow; this.hudSep.textContent = narrow ? '' : ' · '; this.hudBr.hidden = !narrow; }
    if (this.data) { var box = this.row && this.row.box_m || this.data.meta && this.data.meta.box_m; this.fit = fitBox(box, w, h); this.roads = roadsLayer(this.data, this.fit, bw, bh, DPR, this.C.road);
      var sb = scaleBar(this.fit, Math.min(160, Math.round(w * 0.3))); this.hudScale.style.width = Math.round(sb.px) + 'px'; setText(this.hudScaleTxt, sb.label); }
    this.st.dirty = true; this.kick();
  };

  /* render loop: rAF-coalesced; the hero advances its own clock (300 s in 30 s, 1.5 s hold, loop) */
  CtViewer.prototype.redraw = function () { this.st.dirty = true; this.kick(); };
  CtViewer.prototype.kick = function () { var self = this; if (!this.st.raf) this.st.raf = requestAnimationFrame(function (now) { self.tick(now); }); };
  CtViewer.prototype.tick = function (now) {
    var st = this.st; st.raf = 0; if (this.destroyed) return;
    if (st.playing) { if (Proj.modalOpen()) { this.autoPause(); } else { var period = st.dur / RATE + HOLD_S, u = ((now - st.clock0) / 1000) % period; st.t = Math.min(st.dur, u * RATE); st.dirty = true; } }
    if (st.dirty && this.data && this.w && this.h && (this.visible || !('IntersectionObserver' in win))) { st.dirty = false; this.draw(); if (!st.playing || now - st.lastText >= 100) { st.lastText = now; this.updateHud(); this.updateTransport(); } }
    if (st.playing) this.kick();
  };
  CtViewer.prototype.draw = function () {
    if (!this.data || !this.fit) return; var st = this.st;
    drawFrame(this.ctx, this.data, { t: st.t, w: this.w, h: this.h, dpr: DPR, fit: this.fit, roads: this.roads, showRoads: st.showRoads, showCandidates: st.showCandidates, hover: st.hover, colors: this.C, theta0: this.row && this.row.theta0_rad });
  };
  CtViewer.prototype.updateHud = function () {
    var d = this.data, st = this.st; if (!d) return; setText(this.hudClock, 't = ' + st.t.toFixed(1) + ' s');
    var T = d.cols.t_rel_s, eb = errAt(T, d.cols.err_beam_m, st.t), ef = errAt(T, d.cols.err_filter_m, st.t);
    setText(this.hudErrB, 'beam ' + fmtM(eb)); setText(this.hudErrF, 'filter ' + fmtM(ef));
  };

  /* clock (hero, or a full-mode root without a Scrubber in its group) */
  CtViewer.prototype.play = function () { if (this.follow || !this.data || Proj.modalOpen()) return; var st = this.st; if (st.playing) return; if (st.t >= st.dur - 1e-6) st.t = 0; st.playing = true; st.clock0 = performance.now() - (st.t / RATE) * 1000; this.updateTransport(); this.kick(); };
  CtViewer.prototype.pause = function () { var st = this.st; if (!st.playing) return; st.playing = false; st.dirty = true; this.updateTransport(); this.kick(); };
  CtViewer.prototype.toggle = function (user) {
    if (this.follow) { var sc = this.scrubber(); if (sc && sc.toggle) sc.toggle(); return; }
    var st = this.st; if (user) st.userStarted = true; if (st.playing) { if (user) st.userPaused = true; this.pause(); if (user) this.announce('Paused at ' + st.t.toFixed(1) + ' s'); } else { if (user) st.userPaused = false; this.play(); if (user && st.playing) this.announce('Playing'); }
  };
  CtViewer.prototype.autoPause = function () { if (this.st.playing) { this.st.userStarted = false; this.pause(); } };
  CtViewer.prototype.maybeAutoplay = function () { var st = this.st; if (!this.hero || st.playing || st.userPaused || !this.data || !this.visible50 || Proj.reduced() || doc.hidden || Proj.modalOpen()) return; this.play(); };
  CtViewer.prototype.onVisibility = function () { // also called by the kit on reduced-motion changes
    if (!this.visible || doc.hidden || Proj.modalOpen() || Proj.reduced()) this.autoPause(); else if (this.hero) this.maybeAutoplay();
    if (this.hero && Proj.reduced() && !this.st.userStarted && !this.st.playing && this.st.t !== this.st.dur) { this.st.t = this.st.dur; this.redraw(); }
    if (this.visible && this.data && (!this.fit || !this.w)) this.size(); // the data arrived while the root was hidden (tab panel): size now
    if (this.visible && this.st.dirty) this.kick();
  };
  CtViewer.prototype.seek = function (t, from) { // from: 'bus' (apply only) | 'scrub' (own range input) | undefined (user or API)
    var st = this.st; t = clamp(+t || 0, 0, st.dur); st.t = t; if (st.playing) st.clock0 = performance.now() - (t / RATE) * 1000; st.dirty = true; this.kick();
    if (from !== 'scrub') this.updateTransport(); else { setText(this.clock, t.toFixed(1) + ' s / ' + WINDOW_S + ' s'); this.scrub.setAttribute('aria-valuetext', t.toFixed(1) + ' s of ' + WINDOW_S + ' s'); }
    if (from !== 'bus' && this.follow && this.sync) Proj.seek(this.sync, t, false);
  };

  /* visibility (kit pattern: thresholds 0 and 0.5), modal state through body.pj-locked, document visibility */
  CtViewer.prototype.observe = function () {
    var self = this;
    if ('IntersectionObserver' in win) { this.io = new IntersectionObserver(function (es) { var e = es[es.length - 1]; self.visible = e.isIntersecting; self.visible50 = e.intersectionRatio >= 0.5; self.onVisibility(); }, { threshold: [0, 0.5] }); this.io.observe(this.root); }
    else { this.visible = this.visible50 = true; }
    this.onVis = function () { self.onVisibility(); }; doc.addEventListener('visibilitychange', this.onVis);
    if ('MutationObserver' in win) { this.mo = new MutationObserver(function () { self.onVisibility(); }); this.mo.observe(doc.body, { attributes: true, attributeFilter: ['class', 'data-motion'] }); }
  };

  /* bus (follower): pj:time / pj:seek / pj:hover of the current group; the hero ignores the bus and emits nothing while playing */
  CtViewer.prototype.scrubberRoot = function () { return this.sync ? $('[data-widget="scrubber"][data-sync="' + this.sync + '"]') : null; };
  CtViewer.prototype.scrubber = function () { var r = this.scrubberRoot(); return r ? Proj.get(r) : null; };
  CtViewer.prototype.bindBus = function () {
    var self = this; if (this.hero) return;
    this.offs = [
      Proj.bus.on('pj:time', function (ev) {
        var d = ev.detail; if (!d || d.group !== self.sync) return; var src = d.src, t = d.t; if (!isNum(t)) return; if (src && src.video) fixSeeked(src);
        if (src && src.st && src.st.sig === null) return; // a Scrubber that has not loaded its signals yet reports a meaningless 0
        if (src && src.video && src.st && isNum(src.st.t0) && t < src.st.t0 - 1e-6) t += src.st.t0; // kit 1.0.0 'seeked' handler reports clip time, not signal time
        self.st.t = clamp(t, 0, self.st.dur); if (d.hover !== undefined) self.st.hover = isNum(d.hover) ? d.hover : null; self.redraw();
      }),
      Proj.bus.on('pj:seek', function (ev) { var d = ev.detail; if (!d || d.group !== self.sync || !isNum(d.t)) return; fixSeeked(self.scrubber()); self.seek(d.t, 'bus'); }),
      Proj.bus.on('pj:hover', function (ev) { var d = ev.detail; if (!d || d.group !== self.sync) return; self.st.hover = isNum(d.t) ? d.t : null; self.redraw(); })
    ];
  };

  /* pointer (non-hero): nearest reference second within 24 px → hover marker + tooltip + bus hover; click → seek */
  CtViewer.prototype.plotPoint = function (ev) { var r = this.plot.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top, r]; };
  CtViewer.prototype.bindPointer = function () {
    var self = this; if (this.hero) return; var plot = this.plot;
    plot.addEventListener('pointermove', function (ev) { if (!self.data || !self.fit || ev.pointerType === 'touch') return; var p = self.plotPoint(ev), hit = nearestRef(self.data, self.fit, p[0], p[1]);
      if (hit && hit.d <= HIT_PX) { self.setHover(hit.t); self.showTip(hit, p[0], p[1]); } else { self.setHover(null); self.hideTip(); } });
    plot.addEventListener('pointerleave', function () { self.setHover(null); self.hideTip(); });
    plot.addEventListener('click', function (ev) { if (!self.data || !self.fit) return; var p = self.plotPoint(ev), hit = nearestRef(self.data, self.fit, p[0], p[1]); if (!hit || hit.d > CLICK_PX) return; self.st.userStarted = true; self.seek(hit.t); self.announce('Seeked to ' + fmtT(hit.t)); });
  };
  CtViewer.prototype.setHover = function (t) { var was = this.st.hover; if (was === t) return; this.st.hover = t; this.redraw(); if (this.follow && this.sync && Proj.bus && Proj.bus.hover) Proj.bus.hover(this.sync, t); };
  CtViewer.prototype.tipRow = function (value, label, slot, style) {
    var row = el('div', 'ct-tip__row'), key = el('i', 'ct-tip__key' + (style === 'offline' ? ' ct-tip__key--dash' : '')); key.style.setProperty('--k', slot === 'ink' ? 'var(--ct-ink)' : slot === 'none' ? 'transparent' : 'var(--ct-s' + slot + ')');
    row.appendChild(key); row.appendChild(el('span', 'ct-tip__val', value)); row.appendChild(el('span', 'ct-tip__lbl', label)); return row;
  };
  CtViewer.prototype.showTip = function (hit, px, py) {
    var tip = this.tip, d = this.data, i = hit.i; tip.textContent = ''; tip.appendChild(el('span', 'ct-tip__h', 't ' + fmtT(hit.t)));
    tip.appendChild(this.tipRow(fmtM(d.cols.err_beam_m[i]), 'beam error', 2, 'offline')); tip.appendChild(this.tipRow(fmtM(d.cols.err_filter_m[i]), 'filter error', 2, 'online'));
    var sc = this.scrubber(), sig = sc && sc.st && sc.st.sig; // speed / steering when the Scrubber's signals cover that second
    if (sig && sig.cols && Array.isArray(sig.cols.t) && sig.hz) { var k = Math.round((hit.t - sig.cols.t[0]) * sig.hz); if (k >= 0 && k < sig.n) { var v = sig.cols.v_ego_mps && sig.cols.v_ego_mps[k], s = sig.cols.steer_deg && sig.cols.steer_deg[k];
      if (isNum(v)) tip.appendChild(this.tipRow(v.toFixed(1) + ' m/s', 'speed', 'none')); if (isNum(s)) tip.appendChild(this.tipRow(fmtSigned(s, 1) + '°', 'steering', 'none')); } }
    tip.hidden = false; var H = this.h || this.plot.clientHeight, th = tip.offsetHeight || 60, top = py + 18; if (top + th > H - 6) top = Math.max(6, py - 14 - th);
    tip.style.setProperty('--x', (clamp(px / Math.max(1, this.w || this.plot.clientWidth), 0, 1) * 100).toFixed(2) + '%'); tip.style.setProperty('--y', Math.round(top) + 'px');
  };
  CtViewer.prototype.hideTip = function () { if (this.tip) this.tip.hidden = true; };

  /* keyboard (non-hero root): ←/→ ±0.5 s (Shift ±5 s) through the group, Space → the Scrubber's toggle (or the own clock), Escape clears the hover */
  CtViewer.prototype.bindKeys = function () {
    var self = this; if (this.hero) return; var KEYS = '[role="button"], [tabindex]:not(.pj-w), button, a, input, summary, select, textarea, [contenteditable]';
    this.root.addEventListener('keydown', function (ev) { if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey || Proj.modalOpen()) return; var tg = ev.target; if (tg && tg !== self.root && tg.closest && tg.closest(KEYS) && tg.tagName !== 'CANVAS') return; if (self.onKey(ev)) ev.preventDefault(); });
  };
  CtViewer.prototype.onKey = function (ev) {
    var k = ev.key, step = ev.shiftKey ? 5 : 0.5; if (!this.data) return false;
    if (k === 'ArrowLeft') { this.st.userStarted = true; this.seek(this.st.t - step); return true; } if (k === 'ArrowRight') { this.st.userStarted = true; this.seek(this.st.t + step); return true; }
    if (k === ' ' || k === 'k' || k === 'K') { this.toggle(true); return true; }
    if (k === 'Escape') { this.setHover(null); this.hideTip(); return true; }
    return false;
  };

  /* hero stage handoff (§6.4): after the kit's own handler (preventDefault, scroll, bus.seek), pause, activate the matching #examples tab, boot the pair, re-issue the seek */
  CtViewer.prototype.bindStage = function () {
    var self = this, a = this.root.closest('a.pj-hero__stage'); if (!a || !this.hero) return;
    a.addEventListener('click', function () {
      self.autoPause(); var id = self.window; if (!id) return; var group = 'ct-' + id;
      var tab = $('#examples [role="tab"][aria-controls="ex-' + id + '"]'); if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
      var panel = doc.getElementById('ex-' + id); if (panel) $$('[data-widget]', panel).forEach(function (w) { Proj.boot(w); });
      var t = self.st.t; requestAnimationFrame(function () { Proj.seek(group, t, true); });
    });
  };

  /* table twin (non-hero): window facts + per-10-second errors */
  CtViewer.prototype.buildTwin = function () {
    var tb = this.twinBody, d = this.data, r = this.row; if (!tb || !d || !r) return; tb.textContent = '';
    var t1 = el('table'), cap = el('caption', null, 'Window ' + r.id + ' · ' + r.label + ' · facts'); t1.appendChild(cap);
    var facts = [['window', r.id + ' · ' + r.label], ['episode', r.episode_id], ['fold', r.fold_label || r.fold], ['path', isNum(r.path_km) ? r.path_km.toFixed(2) + ' km' : '—'],
      ['road density', (isNum(r.nodes_per_km2) ? r.nodes_per_km2.toFixed(1) + ' nodes/km²' : '—') + ' · ' + (r.density_class || '')], ['turns', isNum(r.n_turns) ? String(r.n_turns) : '—'],
      ['window ADE · offline beam', isNum(r.ade_beam_m) ? r.ade_beam_m.toFixed(2) + ' m' : '—'], ['window ADE · online filter', isNum(r.ade_filter_m) ? r.ade_filter_m.toFixed(2) + ' m' : '—'],
      ['box (metres from the start)', 'x ' + fmtSigned(r.box_m[0], 0) + ' … ' + fmtSigned(r.box_m[1], 0) + ' · y ' + fmtSigned(r.box_m[2], 0) + ' … ' + fmtSigned(r.box_m[3], 0)],
      ['reference seconds', String(r.n_ref)], ['clip span', fmtT(r.clip_t0_rel_s) + ' to ' + fmtT(r.clip_t0_rel_s + r.clip_dur_s) + ' of the window · camera frame at ' + fmtT(r.frame_t_rel_s)],
      ['roads drawn', fmtInt(d.meta && isNum(d.meta.n_roads) ? d.meta.n_roads : d.roads.length) + ' polylines'], ['other beam candidates', String(d.candidates.length)]];
    facts.forEach(function (f) { var tr = el('tr'), th = el('th', null, f[0]); th.setAttribute('scope', 'row'); tr.appendChild(th); tr.appendChild(el('td', null, f[1])); t1.appendChild(tr); }); tb.appendChild(t1);
    var t2 = el('table'), cap2 = el('caption', null, 'Position error every 10 s (nearest reference second)'); t2.appendChild(cap2);
    var thead = el('thead'), hr = el('tr'); ['t', 'offline beam error', 'online filter error'].forEach(function (h) { var th2 = el('th', null, h); th2.setAttribute('scope', 'col'); hr.appendChild(th2); }); thead.appendChild(hr); t2.appendChild(thead);
    var tb2 = el('tbody'), T = d.cols.t_rel_s; for (var s = 10; s <= WINDOW_S; s += 10) { var k = upperBound(T, s), i = k >= d.n ? d.n - 1 : (k > 0 && s - T[k - 1] <= T[k] - s ? k - 1 : k); var tr2 = el('tr'); tr2.appendChild(el('td', null, fmtT(T[i]))); tr2.appendChild(el('td', null, fmtM(d.cols.err_beam_m[i]))); tr2.appendChild(el('td', null, fmtM(d.cols.err_filter_m[i]))); tb2.appendChild(tr2); }
    t2.appendChild(tb2); t2.style.fontVariantNumeric = t1.style.fontVariantNumeric = 'tabular-nums'; tb.appendChild(t2);
    var m = d.meta || {}; tb.appendChild(el('p', null, 'n = ' + fmtInt(d.n) + ' reference seconds' + (m.source ? ' · source: ' + m.source : '') + (m.benchmark ? ' · ' + m.benchmark : '') + (m.methods ? ' · beam: ' + m.methods.beam + ' · filter: ' + m.methods.filter : '')));
  };

  CtViewer.prototype.destroy = function () {
    this.destroyed = true; this.pause(); if (this.st.raf) cancelAnimationFrame(this.st.raf); (this.offs || []).forEach(function (off) { off(); }); if (this.io) this.io.disconnect(); if (this.ro) this.ro.disconnect(); if (this.mo) this.mo.disconnect(); if (this.onVis) doc.removeEventListener('visibilitychange', this.onVis);
    CT.viewer.instances.delete(this.root);
  };

  CT.viewer = { version: '1.0.0', instances: new Map(), get: function (root) { return CT.viewer.instances.get(root); }, drawFrame: drawFrame, fitBox: fitBox, CtViewer: CtViewer };
  Proj.register('ct-viewer', CtViewer);
  Proj.bootAll(doc);
})(window, document);
