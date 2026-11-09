/* CANTraj page · charts-results.js — renderers for the results group: "board" (V06), "cdf" (V07), "horizon" (V08).
   Plugs into the CtChart core (static/charts.js): CT.charts.register(kind, function render(inst, W) → { height, draw, legend, twin, note }).
   Colours only through the --ct-* custom properties (series colour = var(--ct-sN) from the slot column; text wears text tokens);
   2 px lines, markers ≥ 8 px with a 2 px surface ring, hairline solid grid, hit targets ≥ 24 px, crosshair tooltips on the line charts,
   per-row tooltips on the board, selective direct labels, reduced motion honoured (Proj.reduced()). No identifiers are hard-coded:
   identity (key, label, slot, style, marker) comes from the table/1 columns written by the export. */
(function (win, doc) {
  'use strict';
  var CT = win.CT;
  if (!CT || !CT.charts || typeof CT.charts.register !== 'function') return;
  var Proj = win.Proj || null;
  var NS = 'http://www.w3.org/2000/svg';
  var MINUS = '−';
  var DASH = { online: '', offline: '7 4', nomap: '1.5 4.5', pub: '9 3 2 3', lineage: '9 3 2 3 2 3' };
  var uid = 0;

  /* ================================================================== helpers */
  function svgEl(tag, attrs) { var e = doc.createElementNS(NS, tag); if (attrs) for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); return e; }
  function text(x, y, s, cls, anchor) { var t = svgEl('text', { x: x.toFixed ? x.toFixed(1) : x, y: y.toFixed ? y.toFixed(1) : y }); if (cls) t.setAttribute('class', cls); if (anchor) t.setAttribute('text-anchor', anchor); t.textContent = s == null ? '' : String(s); return t; }
  function halo(t) { t.style.paintOrder = 'stroke'; t.style.stroke = 'var(--ct-surface)'; t.style.strokeWidth = '3px'; t.style.strokeLinejoin = 'round'; return t; }
  function reduced() { try { if (Proj && typeof Proj.reduced === 'function') return !!Proj.reduced(); return win.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return true; } }
  function fmtInt(v) { return Math.round(v).toLocaleString('en-US'); }
  function neg(s) { return String(s).replace(/-/g, MINUS); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function mVal(v) { if (!isNum(v)) return null; return Math.abs(v) < 10 ? neg(v.toFixed(1)) : neg(fmtInt(v)); }
  function fallbackM(v) { var s = mVal(v); return s == null ? 'no output' : s + ' m'; }
  function fallbackPct(v) { return isNum(v) ? Math.round(v * 100) + ' %' : '—'; }
  function fallbackPp(v) { return isNum(v) ? (v < 0 ? MINUS : '+') + Math.abs(v).toFixed(1) + ' pp' : '—'; }
  function tickM(v) { return v >= 1000 ? neg(String(Math.round(v / 100) / 10)) + ' km' : fmtInt(v) + ' m'; }
  function isDecade(v) { var l = Math.log(v) / Math.LN10; return Math.abs(l - Math.round(l)) < 1e-6; }
  function sig2(v) { if (!isNum(v) || v <= 0) return v; var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10) - 1); return Math.round(v / p) * p; }
  function uniq(a) { var out = []; a.forEach(function (v) { if (out.indexOf(v) < 0) out.push(v); }); return out; }
  /* estimated text width for Inter at `px` (calibrated against getComputedTextLength: lowercase ≈ .52 em, caps and digits ≈ .62 em, narrow glyphs ≈ .32 em) */
  function estW(s, px) { s = String(s == null ? '' : s); px = px || 11; var w = 2; for (var i = 0; i < s.length; i++) { var c = s.charAt(i); w += /[A-Z0-9%+]/.test(c) ? 0.62 * px : /[ijlt.,:;'·…\s−()\[\]\-\/]/.test(c) ? 0.32 * px : /[mw]/.test(c) ? 0.74 * px : 0.52 * px; } return w; }
  function truncate(s, maxPx, px) {
    s = String(s == null ? '' : s); if (estW(s, px) <= maxPx) return s;
    var m = /^(.*\S)\s*\(([^()]*)\)\s*$/.exec(s); // first try dropping the interior of a trailing parenthetical: "Elastic Pathing (…)"
    if (m) { var alt = m[1] + ' (…)'; if (estW(alt, px) <= maxPx) return alt; }
    var n = s.length; while (n > 2 && estW(s.slice(0, n) + '…', px) > maxPx) n--;
    return n < 3 ? '…' : s.slice(0, n).replace(/[\s,·(]+$/, '') + '…';
  }
  function tickText(g, x, y, s, W) { var w = estW(s); if (x - w / 2 < 0) g.appendChild(text(0, y, s, null, 'start')); else if (x + w / 2 > W) g.appendChild(text(W, y, s, null, 'end')); else g.appendChild(text(x, y, s, null, 'middle')); }
  function fadeIn(el) { if (reduced() || !el || typeof el.animate !== 'function') return; try { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'cubic-bezier(.2,.7,.2,1)' }); } catch (e) { /* no WAAPI */ } }
  function foldOf(inst) { return inst.fold || (typeof CT.charts.fold === 'function' ? CT.charts.fold() : 'test') || 'test'; }
  function foldLabel(f) { return f === 'few_shot_heldout' ? 'few-shot' : f === 'test' ? 'test' : String(f); }
  function util(inst) {
    var u = (inst && inst.util) || CT.charts.util || {}, f = u.fmt || {};
    return {
      color: typeof u.color === 'function' ? u.color : function (slot) { return slot ? 'var(--ct-s' + slot + ')' : 'var(--ct-mute)'; },
      dash: typeof u.dash === 'function' ? function (s) { var d = u.dash(s); return d == null ? '' : String(d); } : function (s) { return DASH[s] || ''; },
      m: typeof f.m === 'function' ? f.m : fallbackM,
      pct: typeof f.pct === 'function' ? f.pct : fallbackPct,
      pp: typeof f.pp === 'function' ? f.pp : fallbackPp,
      marker: typeof u.marker === 'function' ? u.marker : null
    };
  }
  function logScale(domain, range) { var a = Math.log(domain[0]), b = Math.log(domain[1]), r0 = range[0], r1 = range[1]; var f = function (v) { return r0 + (Math.log(v) - a) / (b - a) * (r1 - r0); }; f.invert = function (p) { return Math.exp(a + (p - r0) / (r1 - r0) * (b - a)); }; return f; }
  function linScale(domain, range) { var d0 = domain[0], d1 = domain[1], r0 = range[0], r1 = range[1]; var f = function (v) { return r0 + (v - d0) / (d1 - d0) * (r1 - r0); }; f.invert = function (p) { return d0 + (p - r0) / (r1 - r0) * (d1 - d0); }; return f; }
  function ticksLog(domain) { var out = [], base = [1, 2, 5]; for (var e = -2; e <= 7; e++) for (var i = 0; i < 3; i++) { var v = base[i] * Math.pow(10, e); if (v >= domain[0] * 0.999 && v <= domain[1] * 1.001) out.push(v); } return out; }
  function clampTo(dom) { return function (v) { if (v < dom[0]) return { v: dom[0], clamped: -1 }; if (v > dom[1]) return { v: dom[1], clamped: 1 }; return { v: v, clamped: 0 }; }; }
  function rows(data, kind, required) {
    var C = data && data.cols, n = data && data.n;
    if (!C || !isNum(n)) throw new Error(kind + ': cols missing');
    required.forEach(function (c) { if (!Array.isArray(C[c]) || C[c].length !== n) throw new Error(kind + ': ' + c + ' missing'); });
    var keys = Object.keys(C), out = new Array(n);
    for (var i = 0; i < n; i++) { var r = {}; for (var k = 0; k < keys.length; k++) r[keys[k]] = C[keys[k]][i]; out[i] = r; }
    return out;
  }
  function metaLegend(meta) { return (meta && Array.isArray(meta.series) ? meta.series : []).map(function (s) { return { key: s.key, label: s.label, slot: s.slot, style: s.style == null ? null : s.style, marker: s.marker || null }; }); }
  function keyIndex(legend) { return function (key) { for (var i = 0; i < legend.length; i++) if (legend[i].key === key) return i; return -1; }; }
  function tipText(c) { var parts = []; if (c.title) parts.push(c.title); (c.rows || []).forEach(function (r) { parts.push([r.value, r.label].filter(Boolean).join(' ')); }); return parts.join(' · '); }
  function showTip(inst, x, y, content) { if (inst.tip && typeof inst.tip.show === 'function') inst.tip.show(x, y, typeof content === 'function' ? content() : content); }
  function hideTip(inst) { if (inst.tip && typeof inst.tip.hide === 'function') inst.tip.hide(); }
  function tipFromEl(inst, el, content) { var r = el.getBoundingClientRect(); showTip(inst, r.left + r.width / 2, r.top + Math.min(r.height / 2, 14), content); }
  function hitRect(x, y, w, h, label) { var r = svgEl('rect', { x: x, y: y, width: Math.max(0, w), height: Math.max(0, h), class: 'ct-hit', tabindex: '0', role: 'img' }); r.setAttribute('aria-label', label || ''); return r; }
  function bindTip(inst, hit, content) {
    hit.addEventListener('pointermove', function (ev) { showTip(inst, ev.clientX, ev.clientY, content); });
    hit.addEventListener('pointerleave', function () { hideTip(inst); });
    hit.addEventListener('focus', function () { tipFromEl(inst, hit, content); });
    hit.addEventListener('blur', function () { hideTip(inst); });
    hit.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { hideTip(inst); hit.blur(); } });
  }
  function localMarker(shape, x, y, r, hollow) {
    var e;
    if (shape === 'square') e = svgEl('rect', { x: (x - r).toFixed(1), y: (y - r).toFixed(1), width: (2 * r).toFixed(1), height: (2 * r).toFixed(1) });
    else if (shape === 'diamond') e = svgEl('path', { d: 'M' + x.toFixed(1) + ' ' + (y - 1.15 * r).toFixed(1) + 'L' + (x + 1.15 * r).toFixed(1) + ' ' + y.toFixed(1) + 'L' + x.toFixed(1) + ' ' + (y + 1.15 * r).toFixed(1) + 'L' + (x - 1.15 * r).toFixed(1) + ' ' + y.toFixed(1) + 'Z' });
    else if (shape === 'tri-up') e = svgEl('path', { d: 'M' + x.toFixed(1) + ' ' + (y - 1.2 * r).toFixed(1) + 'L' + (x + 1.15 * r).toFixed(1) + ' ' + (y + 0.9 * r).toFixed(1) + 'L' + (x - 1.15 * r).toFixed(1) + ' ' + (y + 0.9 * r).toFixed(1) + 'Z' });
    else if (shape === 'tri-down') e = svgEl('path', { d: 'M' + x.toFixed(1) + ' ' + (y + 1.2 * r).toFixed(1) + 'L' + (x + 1.15 * r).toFixed(1) + ' ' + (y - 0.9 * r).toFixed(1) + 'L' + (x - 1.15 * r).toFixed(1) + ' ' + (y - 0.9 * r).toFixed(1) + 'Z' });
    else if (shape === 'cross') { var c = r + 0.5; e = svgEl('path', { d: 'M' + (x - c).toFixed(1) + ' ' + (y - c).toFixed(1) + 'L' + (x + c).toFixed(1) + ' ' + (y + c).toFixed(1) + 'M' + (x - c).toFixed(1) + ' ' + (y + c).toFixed(1) + 'L' + (x + c).toFixed(1) + ' ' + (y - c).toFixed(1) }); }
    else e = svgEl('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: r });
    e.setAttribute('class', hollow ? 'ct-mark ct-mark--hollow' : 'ct-mark');
    return e;
  }
  /* a marker in the series colour with the 2 px surface ring (class ct-mark); the cross is a stroke mark and gets a surface halo under it */
  function mark(U, shape, x, y, r, color, hollow, hatchId) {
    var e = null, core = false;
    if (U.marker) { try { var m = U.marker(shape, x, y, r, hollow, color); if (m && m.nodeType === 1) { e = m; core = true; } else if (typeof m === 'string') { e = svgEl('path', { d: m }); e.setAttribute('class', hollow ? 'ct-mark ct-mark--hollow' : 'ct-mark'); } } catch (err) { e = null; } }
    if (!e) e = localMarker(shape, x, y, r, hollow);
    if (hatchId) { e.style.fill = 'url(#' + hatchId + ')'; e.style.stroke = 'var(--ct-mute)'; e.style.strokeWidth = '1'; e.classList.add('ct-hatch'); return e; }
    if (core) return e; // the core's marker already carries fill, ring and (for the cross) the surface halo
    if (shape === 'cross') {
      var g = svgEl('g'), under = localMarker('cross', x, y, r, false); under.setAttribute('class', ''); under.style.stroke = 'var(--ct-surface)'; under.style.strokeWidth = '6'; under.style.fill = 'none'; under.style.strokeLinecap = 'round';
      e.style.stroke = color; e.style.strokeWidth = '2'; e.style.fill = 'none'; g.appendChild(under); g.appendChild(e); return g;
    }
    if (hollow) { e.style.stroke = color; e.style.fill = 'var(--ct-surface)'; } else e.style.fill = color;
    return e;
  }
  function hatchPattern(svg) {
    var id = 'ct-hatch-' + (++uid), defs = svgEl('defs'), p = svgEl('pattern', { id: id, width: 3, height: 3, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    var bg = svgEl('rect', { width: 3, height: 3 }); bg.style.fill = 'var(--ct-surface)'; p.appendChild(bg);
    var l = svgEl('line', { x1: 0.6, y1: 0, x2: 0.6, y2: 3 }); l.style.stroke = 'var(--ct-mute)'; l.style.strokeWidth = '1.2'; l.style.opacity = '.6'; p.appendChild(l);
    defs.appendChild(p); svg.appendChild(defs); return id;
  }
  function emitHighlight(key) { doc.dispatchEvent(new CustomEvent('ct:highlight', { detail: { key: key } })); }
  function ciText(lo, hi) { return isNum(lo) && isNum(hi) ? ' [' + mVal(lo) + ', ' + mVal(hi) + ']' : ''; }
  function firstDraw(inst, svg) { var S = inst.state || (inst.state = {}); var was = S._drawn; S._drawn = true; if (!was && typeof inst.renders !== 'number') fadeIn(svg); } // the real core runs its own 600 ms draw-in (inst.renders)
  function hatchFor(inst, svg) { return typeof inst.hatchId === 'string' && inst.hatchId ? inst.hatchId : hatchPattern(svg); }
  function liftRows(inst, rows, on) {
    if (typeof inst.lift === 'function') { inst.lift(on); return; }
    rows.forEach(function (g) { if (!on) g.removeAttribute('opacity'); else g.setAttribute('opacity', g === on ? '1' : '.6'); });
  }

  /* ================================================================== V06 · board */
  var BOARD_COLS = ['stem', 'protocol', 'win', 'fold', 'family', 'label', 'key', 'slot', 'style', 'marker', 'n_expected', 'n_output', 'n_fail', 'ade_median', 'ade_lo', 'ade_hi', 'ade_driver_median', 'c100', 'route_ok', 'tail_lost100', 'terminal_lost100', 'n_seeds', 'is_reference'];
  function boardState(inst) {
    var S = inst.state || (inst.state = {});
    if (!S.win) S.win = 'w05'; if (!S.sort) S.sort = 'family';
    var ctl = inst.ctl;
    if (ctl) { // own controls in the DOM are the source of truth when they exist
      var sw = ctl.querySelector('[data-ct-board-win][aria-selected="true"]'); if (sw) S.win = sw.getAttribute('data-ct-board-win');
      var ss = ctl.querySelector('[data-ct-board-sort][aria-selected="true"]'); if (ss) S.sort = ss.getAttribute('data-ct-board-sort');
    }
    return S;
  }
  /* per-chart controls: horizon tabs (5 min · 15 min · whole drive) and the order toggle (by family · by median); the core's
     inst.control() when it exists (shared chrome), else an own idempotent chip tablist in .ct-ctl */
  function chipGroup(inst, name, label, opts, S) {
    var ctl = inst.ctl, wrap = ctl.querySelector('[data-ct-board="' + name + '"]');
    if (wrap) return;
    wrap = doc.createElement('div'); wrap.className = 'chips'; wrap.setAttribute('role', 'tablist'); wrap.setAttribute('aria-label', label); wrap.setAttribute('data-ct-board', name);
    function select(v, focus) {
      S[name] = v;
      Array.prototype.forEach.call(wrap.querySelectorAll('[data-ct-board-' + name + ']'), function (b) { var on = b.getAttribute('data-ct-board-' + name) === v; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
      if (typeof inst.render === 'function') inst.render();
    }
    opts.forEach(function (o, i) {
      var b = doc.createElement('button'); b.type = 'button'; b.className = 'chip chip--sm'; b.setAttribute('role', 'tab'); b.setAttribute('data-ct-board-' + name, o.value);
      b.setAttribute('aria-selected', String(o.value === S[name])); b.tabIndex = o.value === S[name] ? 0 : -1; b.textContent = o.label;
      b.addEventListener('click', function () { if (S[name] !== o.value) select(o.value, false); });
      b.addEventListener('keydown', function (ev) { var j = -1; if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') j = (i + 1) % opts.length; else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') j = (i + opts.length - 1) % opts.length; else if (ev.key === 'Home') j = 0; else if (ev.key === 'End') j = opts.length - 1; if (j < 0) return; ev.preventDefault(); select(opts[j].value, true); });
      wrap.appendChild(b);
    });
    ctl.appendChild(wrap);
  }
  function boardControls(inst, wins) {
    var S = inst.state || (inst.state = {}), keys = Object.keys(wins);
    if (keys.indexOf(S.win) < 0) S.win = keys[0]; if (S.sort !== 'median') S.sort = 'family';
    var winOpts = keys.map(function (w) { return { value: w, label: String(wins[w]) }; });
    var sortOpts = [{ value: 'family', label: 'by family' }, { value: 'median', label: 'by median' }];
    if (typeof inst.control === 'function') {
      var w = inst.control('win', { label: 'Window', options: winOpts, value: S.win }); if (w != null) S.win = String(w);
      var s = inst.control('sort', { label: 'Order', options: sortOpts, value: S.sort }); if (s != null) S.sort = String(s);
      return S;
    }
    if (!inst.ctl) return S;
    chipGroup(inst, 'win', 'Window length', winOpts, S);
    chipGroup(inst, 'sort', 'Row order', sortOpts, S);
    return S;
  }
  function boardTip(r, U) {
    var med = r.ade_median, rowsT = [];
    rowsT.push({ value: isNum(med) ? U.m(med) + ciText(r.ade_lo, r.ade_hi) : 'no finite median', label: isNum(med) ? 'median ADE · 95 % CI' : fmtInt(r.n_output) + ' of ' + fmtInt(r.n_expected) + ' windows with output', slot: r.slot, style: r.style });
    rowsT.push({ value: U.m(r.ade_driver_median), label: 'driver-equal median' });
    rowsT.push({ value: U.pct(r.route_ok), label: 'route recovered' });
    rowsT.push({ value: U.pct(r.c100), label: 'c100 · seconds within 100 m' });
    rowsT.push({ value: U.pct(r.tail_lost100), label: 'tail lost' });
    rowsT.push({ value: U.pct(r.terminal_lost100), label: 'terminal lost' });
    rowsT.push({ value: fmtInt(r.n_expected), label: 'windows expected' });
    rowsT.push({ value: fmtInt(r.n_fail), label: 'failures (no output)' });
    return { title: r.label + ' · ' + r.protocol, rows: rowsT };
  }
  function boardTwin(R, wins, U) {
    var head = ['method', 'protocol', 'window', 'drivers', 'family', 'median ADE', '95 % CI', 'driver-equal median', 'route recovered', 'c100', 'tail lost', 'terminal lost', 'windows expected', 'outputs', 'failures', 'seeds'];
    var body = R.map(function (r) { return [r.label, r.protocol, wins[r.win] || r.win, foldLabel(r.fold), r.family, isNum(r.ade_median) ? U.m(r.ade_median) : 'no finite median', isNum(r.ade_lo) && isNum(r.ade_hi) ? mVal(r.ade_lo) + ' to ' + mVal(r.ade_hi) + ' m' : '—', U.m(r.ade_driver_median), U.pct(r.route_ok), U.pct(r.c100), U.pct(r.tail_lost100), U.pct(r.terminal_lost100), fmtInt(r.n_expected), fmtInt(r.n_output), fmtInt(r.n_fail), isNum(r.n_seeds) ? fmtInt(r.n_seeds) : '—']; });
    return { head: head, rows: body, caption: 'Main board: every method, protocol, window length and fold (missing outputs count as infinite ADE and zero recovery).' };
  }
  function renderBoard(inst, W) {
    var D = inst.data, meta = D.meta || {}, U = util(inst);
    var R = rows(D, 'board', BOARD_COLS);
    var wins = meta.wins || { w05: '5 min', w15: '15 min', full: 'whole drive' };
    var S = boardState(inst); boardControls(inst, wins); S = boardState(inst);
    var fold = foldOf(inst);
    var fams = Array.isArray(meta.families) && meta.families.length ? meta.families : uniq(R.map(function (r) { return r.family; }));
    var xdom = Array.isArray(meta.x_domain) ? meta.x_domain : [10, 20000], clampX = clampTo(xdom);
    var sel = R.filter(function (r) { return r.fold === fold && r.win === S.win; });
    var groups = [];
    if (S.sort === 'median') groups.push({ title: null, rows: sel.slice().sort(function (a, b) { var an = isNum(a.ade_median), bn = isNum(b.ade_median); if (an !== bn) return an ? -1 : 1; return an ? a.ade_median - b.ade_median : 0; }) });
    else fams.forEach(function (f) { var g = sel.filter(function (r) { return r.family === f; }); if (g.length) groups.push({ title: f, rows: g }); });
    var narrow = W < 680;
    var TOP = 40, GH = 26, RH = narrow ? 40 : 26, AX = 34; // TOP holds the column header and a mirrored row of tick labels (the board is up to 1,100 px tall)
    var nG = S.sort === 'median' ? 0 : groups.length;
    var H = TOP + nG * GH + sel.length * RH + AX + (sel.length ? 0 : 30);
    var labelW = narrow ? 0 : Math.round(Math.min(330, Math.max(220, 0.3 * W)));
    var routeW = narrow ? 92 : 118, c100W = narrow ? 0 : 54, gap = narrow ? 10 : 14;
    var x0 = narrow ? 6 : labelW + 10, x1 = W - routeW - c100W - gap * (narrow ? 1 : 2);
    if (x1 - x0 < 120) { x1 = Math.max(x0 + 120, x1); }
    var xs = logScale(xdom, [x0, x1]);
    // legend = the slot identities of meta.series (dot keys) + the hatched reference entry; row groups carry the matching key for legend emphasis
    var legend = metaLegend(meta).map(function (e, i) { return { key: e.key != null ? e.key : 'slot' + (e.slot != null ? e.slot : i), label: e.label, slot: e.slot, style: null, marker: 'circle' }; });
    legend.push({ key: 'reference', label: 'hatched = reference, not CAN-only', slot: 0, style: null, marker: 'circle', swatch: true, hatch: true });
    function seriesIdx(r) { if (r.is_reference || r.slot === 0) return legend.length - 1; for (var i = 0; i < legend.length; i++) if (legend[i].slot === r.slot) return i; return -1; }
    var clampedAny = sel.some(function (r) { return (isNum(r.ade_median) && clampX(r.ade_median).clamped) || (isNum(r.ade_hi) && clampX(r.ade_hi).clamped); });
    var notes = [];
    if (S.win === 'full' && meta.full_duration_median_min) notes.push('Whole-drive windows: median duration ' + meta.full_duration_median_min.test + ' min (test) and ' + meta.full_duration_median_min.few_shot_heldout + ' min (few-shot).');
    if (S.sort === 'median') notes.push('Sorted by median ADE; rows without a finite median last.');
    if (clampedAny) notes.push('› marks a value beyond ' + tickM(xdom[1]) + ', drawn at the edge.');
    notes.push('Click or press Enter on a row to highlight that method in the distribution and horizon charts; Escape clears it.');
    var out = { height: H, legend: legend, twin: boardTwin(R, wins, U), note: notes.join(' ') };
    if (!S._hlSync) { // keep the pinned row in step with page-wide highlight changes (Escape in another chart clears it)
      S._hlSync = true;
      doc.addEventListener('ct:highlight', function (ev) { var d = ev.detail || {}; var k = d.key == null ? null : String(d.key); if (d.from === inst.root && k != null) return; if (k === S.hl) return; S.hl = (S._keys && S._keys.indexOf(k) >= 0) ? k : null; (S._rowGs || []).forEach(function (x) { x.classList.toggle('is-active', S.hl != null && x.getAttribute('data-method') === S.hl); }); });
    }
    S._keys = sel.map(function (r) { return r.key; });
    out.draw = function (svg) {
      var hatch = hatchFor(inst, svg);
      var g0 = svgEl('g', { class: 'ct-board' }); svg.appendChild(g0);
      g0.appendChild(text(x0, 15, 'median ADE (m, log) · 95 % CI', 'ct-lbl--dim', 'start'));
      g0.appendChild(text(x1 + gap, 15, narrow ? 'route' : 'route recovered', 'ct-lbl--dim', 'start'));
      if (!narrow) g0.appendChild(text(W - 2, 15, 'c100', 'ct-lbl--dim', 'end'));
      var yTop = TOP, yBot = H - AX;
      var ticks = ticksLog(xdom), labelAll = (x1 - x0) / ticks.length > 48;
      ticks.forEach(function (v) { if (!(labelAll || isDecade(v))) return; var x = xs(v); g0.appendChild(svgEl('line', { x1: x.toFixed(1), y1: yTop, x2: x.toFixed(1), y2: yBot, class: 'ct-grid' })); tickText(g0, x, yBot + 16, tickM(v), W); tickText(g0, x, yTop - 5, tickM(v), W); });
      g0.appendChild(svgEl('line', { x1: x0, y1: yBot + 0.5, x2: x1, y2: yBot + 0.5, class: 'ct-axis' }));
      g0.appendChild(svgEl('line', { x1: x0, y1: yTop - 0.5, x2: x1, y2: yTop - 0.5, class: 'ct-axis' }));
      if (!sel.length) { g0.appendChild(text(x0, TOP + 18, 'no rows for this fold and window', 'ct-lbl--dim', 'start')); return; }
      var rowGs = [], y = TOP, trans = reduced() ? '' : 'opacity 120ms'; S._rowGs = rowGs;
      function lift(on) { liftRows(inst, rowGs, on); }
      var HL_ON = ' · highlighted in the distribution and horizon charts', HL_OFF = ' · Enter or click highlights this method in the other charts';
      function setHl(k) { // toggle: a pinned row dims the other series in V07/V08 and shows its state here; emitted with from = this root so the board itself stays undimmed
        S.hl = k; if (typeof inst.emitHighlight === 'function') inst.emitHighlight(k); else emitHighlight(k);
        rowGs.forEach(function (x) { var on = k != null && x.getAttribute('data-method') === k; x.classList.toggle('is-active', on); var hr = x.querySelector('.ct-hit'); if (hr) hr.setAttribute('aria-label', hr.getAttribute('data-tip') + (on ? HL_ON : HL_OFF)); });
      }
      function cap(x, cy, color) { var c = svgEl('line', { x1: x.toFixed(1), y1: (cy - 4).toFixed(1), x2: x.toFixed(1), y2: (cy + 4).toFixed(1), class: 'ct-ci' }); c.style.stroke = color; return c; }
      function bar(x, yb, w, h) { var e; if (w < 4) e = svgEl('rect', { x: x.toFixed(1), y: yb.toFixed(1), width: w.toFixed(1), height: h }); else e = svgEl('path', { d: 'M' + x.toFixed(1) + ' ' + yb.toFixed(1) + 'H' + (x + w - 4).toFixed(1) + 'a4 4 0 0 1 4 4V' + (yb + h - 4).toFixed(1) + 'a4 4 0 0 1 -4 4H' + x.toFixed(1) + 'Z' }); e.style.fill = 'var(--ct-mono)'; return e; }
      groups.forEach(function (grp) {
        if (grp.title) { g0.appendChild(text(0, y + 17, grp.title, 'ct-title', 'start')); g0.appendChild(svgEl('line', { x1: 0, y1: y + GH - 0.5, x2: W, y2: y + GH - 0.5, class: 'ct-grid' })); y += GH; }
        grp.rows.forEach(function (r) {
          var si = seriesIdx(r), g = svgEl('g', { class: 'ct-row ct-lift', 'data-key': si >= 0 ? legend[si].key : r.key, 'data-method': r.key, 'data-slot': r.slot }); if (si >= 0) g.setAttribute('data-series', si);
          if (trans) g.style.transition = trans;
          var cy = narrow ? y + 29 : y + RH / 2, ly = narrow ? y + 14 : cy + 4;
          var ref = r.is_reference || r.slot === 0, color = ref ? 'var(--ct-mute)' : U.color(r.slot);
          var badges = [];
          if (isNum(r.n_seeds) && r.n_seeds > 1 && !/seed/i.test(r.label)) badges.push('· ' + fmtInt(r.n_seeds) + ' seeds');
          if (isNum(r.n_fail) && r.n_fail > 0) badges.push(fmtInt(r.n_fail) + ' fail');
          var badgeTxt = badges.join(' '), badgeW = badgeTxt ? estW(badgeTxt, 11) : 0, colR = narrow ? W - 4 : labelW - 8; // badges right-aligned in the label column
          var lab = truncate(r.label, colR - (badgeW ? badgeW + 12 : 0), 11);
          g.appendChild(text(0, ly, lab, 'ct-lbl', 'start'));
          if (badgeTxt) g.appendChild(text(colR, ly, badgeTxt, 'ct-lbl--dim', 'end'));
          var med = r.ade_median;
          if (!isNum(med)) {
            var nf = 'no finite median · ' + fmtInt(r.n_output) + ' of ' + fmtInt(r.n_expected) + ' windows with output';
            if (estW(nf) > x1 - x0 - 8) nf = 'no finite median · ' + fmtInt(r.n_output) + '/' + fmtInt(r.n_expected) + ' with output';
            g.appendChild(text(x0 + 4, cy + 4, truncate(nf, x1 - x0 - 8, 11), 'ct-lbl--dim', 'start'));
          } else {
            if (isNum(r.ade_lo) && isNum(r.ade_hi)) {
              var cl = clampX(r.ade_lo), ch = clampX(r.ade_hi), xl = xs(cl.v), xh = xs(ch.v);
              var ci = svgEl('line', { x1: xl.toFixed(1), y1: cy.toFixed(1), x2: xh.toFixed(1), y2: cy.toFixed(1), class: 'ct-ci' }); ci.style.stroke = color; g.appendChild(ci);
              if (!cl.clamped) g.appendChild(cap(xl, cy, color));
              if (!ch.clamped) g.appendChild(cap(xh, cy, color)); else g.appendChild(text(xh + 3, cy + 4, '›', 'ct-lbl--dim', 'start'));
            }
            var cm = clampX(med), xm = xs(cm.v);
            g.appendChild(mark(U, 'circle', xm, cy, 4.5, color, false, ref ? hatch : null));
            if (cm.clamped) g.appendChild(text(xm + 8, cy + 4, '›', 'ct-lbl', 'start'));
            else if ((r.key === 'beam' || r.key === 'pf') && /Hp$/.test(r.protocol)) { var lx = Math.max(xm, isNum(r.ade_hi) ? xs(clampX(r.ade_hi).v) : xm) + 8; g.appendChild(halo(text(lx, cy + 4, U.m(med), 'ct-lbl', 'start'))); }
          }
          var rx = x1 + gap, barMax = routeW - 36, rw = Math.max(0, Math.min(1, isNum(r.route_ok) ? r.route_ok : 0)) * barMax;
          g.appendChild(bar(rx, cy - 5, rw, 10));
          g.appendChild(text(rx + rw + 4, cy + 4, U.pct(r.route_ok), 'ct-lbl', 'start'));
          if (!narrow) { var c1 = text(W - 2, cy + 4, U.pct(r.c100), 'ct-lbl--dim', 'end'); c1.style.fontFamily = 'var(--cl-mono)'; g.appendChild(c1); }
          var content = boardTip(r, U), pinned = S.hl === r.key, hit = hitRect(0, y, W, RH, tipText(content) + (pinned ? HL_ON : HL_OFF)); hit.setAttribute('data-tip', tipText(content)); g.classList.toggle('is-active', pinned); g.appendChild(hit); bindTip(inst, hit, content);
          hit.addEventListener('pointerenter', function () { lift(g); }); hit.addEventListener('pointerleave', function () { lift(null); });
          hit.addEventListener('click', function () { setHl(S.hl === r.key ? null : r.key); });
          hit.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setHl(S.hl === r.key ? null : r.key); } });
          g0.appendChild(g); rowGs.push(g); y += RH;
        });
      });
      firstDraw(inst, svg);
    };
    return out;
  }

  /* ================================================================== V07 · cdf */
  var CDF_COLS = ['panel', 'stem', 'protocol', 'fold', 'key', 'label', 'slot', 'style', 'marker', 'n', 'fail', 'median', 'q'];
  function shareAt(q, x, step) { var lo = 0, hi = q.length; while (lo < hi) { var mid = (lo + hi) >> 1, v = q[mid]; if (v != null && v <= x) lo = mid + 1; else hi = mid; } return lo * step; }
  function cdfTwin(R, step, U) {
    var i90 = Math.round(0.9 / step) - 1;
    var body = R.map(function (r) { var p90 = Array.isArray(r.q) && i90 < r.q.length ? r.q[i90] : null; return [r.panel, r.label, r.protocol, foldLabel(r.fold), fmtInt(r.n), fmtInt(r.fail), U.m(r.median), p90 == null ? 'beyond coverage' : U.m(p90)]; });
    return { head: ['panel', 'method', 'protocol', 'drivers', 'windows expected', 'failures', 'median ADE', '90th percentile'], rows: body, caption: 'Five-minute ADE distribution per method and fold; expected but unanswered windows stay in the denominator.' };
  }
  function segHitsBox(ax, ay, bx, by, b) { // segment against an axis-aligned box (Liang–Barsky clip test)
    var t0 = 0, t1 = 1, dx = bx - ax, dy = by - ay, p = [-dx, dx, -dy, dy], q = [ax - b.l, b.r - ax, ay - b.t, b.b - ay];
    for (var i = 0; i < 4; i++) { if (p[i] === 0) { if (q[i] < 0) return false; } else { var t = q[i] / p[i]; if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } } }
    return true;
  }
  function curveHits(curves, b, pad) { // does any polyline cross the box (grown by pad)?
    var bb = { l: b.l - pad, r: b.r + pad, t: b.t - pad, b: b.b + pad };
    for (var c = 0; c < curves.length; c++) { var pts = curves[c]; for (var i = 1; i < pts.length; i++) { var p0 = pts[i - 1], p1 = pts[i]; if (!p0 || !p1) continue; if (Math.max(p0[0], p1[0]) < bb.l || Math.min(p0[0], p1[0]) > bb.r || Math.max(p0[1], p1[1]) < bb.t || Math.min(p0[1], p1[1]) > bb.b) continue; if (segHitsBox(p0[0], p0[1], p1[0], p1[1], bb)) return true; } }
    return false;
  }
  /* direct labels at the paper's label shares: beside the own curve when nothing is crossed, else right of the whole bundle at that share
     (1 px leader), else nudged one line up or down; a label that would still cross a mark or a label is dropped (SPEC §4.5) */
  function placeCdfLabels(g, cands, curves, px0, px1, py0, py1) {
    var placed = [], out = [], displaced = 0;
    function overlaps(b) { for (var i = 0; i < placed.length; i++) { var p = placed[i]; if (b.l < p.r && b.r > p.l && b.t < p.b && b.b > p.t) return true; } return false; }
    function ok(b) { return !(b.l < px0 || b.r > px1 || b.t < py0 || b.b > py1) && !overlaps(b) && !curveHits(curves, b, 2); }
    cands.forEach(function (c) {
      var w = estW(c.text, 11), xr = isNum(c.xr) ? Math.max(c.xr, c.x) : c.x, opts = [
        { l: c.x + 7, t: c.y - 7, lead: false }, { l: c.x - 7 - w, t: c.y - 7, lead: false, left: true },
        { l: xr + 10, t: c.y - 7, lead: true }, { l: xr + 10, t: c.y - 7 - 14, lead: true }, { l: xr + 10, t: c.y - 7 + 14, lead: true },
        { l: c.x + 9, t: c.y - 7 - 15, lead: true }, { l: c.x + 9, t: c.y - 7 + 15, lead: true },
        { l: c.x - 9 - w, t: c.y - 7 - 15, lead: true, left: true }, { l: c.x - 9 - w, t: c.y - 7 + 15, lead: true, left: true }];
      var chosen = null;
      for (var i = 0; i < opts.length && !chosen; i++) { var b = { l: opts[i].l, r: opts[i].l + w, t: opts[i].t, b: opts[i].t + 14, lead: opts[i].lead, left: !!opts[i].left }; if (ok(b)) chosen = b; }
      if (chosen) { placed.push(chosen); out.push({ c: c, b: chosen }); if (chosen.lead) displaced++; }
    });
    if (displaced >= 4) return; // four or more labels pushed off their curves: converging bundle, the legend carries identity
    out.forEach(function (o) {
      var b = o.b, c = o.c, t = halo(text(b.left ? b.r : b.l, b.t + 11, c.text, 'ct-lbl', b.left ? 'end' : 'start'));
      if (b.lead) { var lead = svgEl('line', { x1: c.x.toFixed(1), y1: c.y.toFixed(1), x2: (b.left ? b.r + 2 : b.l - 2).toFixed(1), y2: (b.t + 7).toFixed(1), class: 'ct-xhair' }); lead.style.opacity = '.7'; g.appendChild(lead); }
      g.appendChild(t);
    });
  }
  function renderCdf(inst, W) {
    var D = inst.data, meta = D.meta || {}, U = util(inst);
    var R = rows(D, 'cdf', CDF_COLS);
    if (!Array.isArray(R[0].q)) throw new Error('cdf: q missing');
    var fold = foldOf(inst), panels = Array.isArray(meta.panels) && meta.panels.length ? meta.panels : uniq(R.map(function (r) { return r.panel; }));
    var xdom = Array.isArray(meta.x_domain) ? meta.x_domain : [5, 30000], step = isNum(meta.share_step) ? meta.share_step : 0.005;
    var labelY = Array.isArray(meta.label_y) && meta.label_y.length ? meta.label_y : [0.18, 0.36, 0.54, 0.72, 0.9];
    var clampX = clampTo(xdom);
    var sel = R.filter(function (r) { return r.fold === fold; });
    var side = W >= 720, nP = panels.length, GAP = 24;
    var panelW = side ? (W - GAP * (nP - 1)) / nP : W;
    var TOPB = 24, AXB = 30, plotH = Math.round(Math.max(220, 0.6 * Math.min(panelW, 480)));
    var blockH = TOPB + plotH + AXB, H = side ? blockH : blockH * nP + 8 * (nP - 1);
    var ML = 30, MR = 8;
    var legend = metaLegend(meta), sIdx = keyIndex(legend);
    var SNAP = 64, lg = Math.log(xdom[1] / xdom[0]);
    function snapK(v) { return Math.max(0, Math.min(SNAP, Math.round(SNAP * Math.log(Math.max(xdom[0], Math.min(xdom[1], v)) / xdom[0]) / lg))); }
    function snapV(k) { return xdom[0] * Math.exp(lg * k / SNAP); }
    var out = { height: H, legend: legend.length > 1 ? legend : null, twin: cdfTwin(R, step, U), note: 'Short tick on each curve: the median. A curve ends at one minus the failure rate.' };
    out.draw = function (svg) {
      panels.forEach(function (p, pi) {
        var ox = side ? pi * (panelW + GAP) : 0, oy = side ? 0 : pi * (blockH + 8);
        var px0 = ox + ML, px1 = ox + panelW - MR, py0 = oy + TOPB + 4, py1 = oy + TOPB + plotH;
        var xs = logScale(xdom, [px0, px1]), ys = linScale([0, 1], [py1, py0]);
        var g = svgEl('g', { class: 'ct-panel' }); svg.appendChild(g);
        g.appendChild(text(ox, oy + 14, p, 'ct-title', 'start'));
        [0, 0.25, 0.5, 0.75, 1].forEach(function (v) { var yy = ys(v); g.appendChild(svgEl('line', { x1: px0, y1: yy.toFixed(1), x2: px1, y2: yy.toFixed(1), class: 'ct-grid' })); g.appendChild(text(px0 - 5, yy + 4, v === 0 ? '0' : v === 1 ? '1' : String(v).slice(1), null, 'end')); });
        var ticks = ticksLog(xdom), labelAll = (px1 - px0) / ticks.length > 48;
        ticks.forEach(function (v) { if (!(labelAll || isDecade(v))) return; var x = xs(v); g.appendChild(svgEl('line', { x1: x.toFixed(1), y1: py0, x2: x.toFixed(1), y2: py1, class: 'ct-grid' })); tickText(g, x, py1 + 16, tickM(v), W); });
        g.appendChild(svgEl('line', { x1: px0, y1: py1 + 0.5, x2: px1, y2: py1 + 0.5, class: 'ct-axis' }));
        var series = sel.filter(function (r) { return r.panel === p && Array.isArray(r.q); }), cands = [], curves = [];
        series.forEach(function (r, i) {
          var color = U.color(r.slot), sg = svgEl('g', { 'data-key': r.key, 'data-slot': r.slot }), si = sIdx(r.key); if (si >= 0) sg.setAttribute('data-series', si);
          var pts = [];
          for (var k = 0; k < r.q.length; k++) { var v = r.q[k]; if (v == null) break; pts.push([xs(clampX(v).v), ys((k + 1) * step)]); }
          if (!pts.length) return;
          curves.push(pts);
          var path = svgEl('path', { d: 'M' + pts.map(function (pt) { return pt[0].toFixed(1) + ' ' + pt[1].toFixed(1); }).join('L'), class: 'ct-line' });
          path.style.stroke = color; var da = U.dash(r.style); if (da) path.setAttribute('stroke-dasharray', da); sg.appendChild(path);
          var mi = Math.round(0.5 / step) - 1;
          if (mi < r.q.length && r.q[mi] != null) { var mx = xs(clampX(r.q[mi]).v), my = ys(0.5); var tk = svgEl('line', { x1: mx.toFixed(1), y1: (my - 3).toFixed(1), x2: mx.toFixed(1), y2: (my + 3).toFixed(1), 'stroke-width': 2 }); tk.style.stroke = color; sg.appendChild(tk); }
          if (r.style === 'pub' && r.marker) for (var s = 0.12; s < 0.999; s += 0.12) { var qi = Math.round(s / step) - 1; if (qi < r.q.length && r.q[qi] != null) sg.appendChild(mark(U, r.marker, xs(clampX(r.q[qi]).v), ys((qi + 1) * step), 4, color, false, null)); }
          g.appendChild(sg);
          var ly = labelY[i % labelY.length], li = Math.round(ly / step) - 1, last = pts[pts.length - 1];
          var xr = -Infinity; series.forEach(function (o) { if (li < o.q.length && o.q[li] != null) xr = Math.max(xr, xs(clampX(o.q[li]).v)); }); // right edge of the whole bundle at that share
          if (li < r.q.length && r.q[li] != null) cands.push({ x: xs(clampX(r.q[li]).v), y: ys(ly), text: r.label, xr: xr }); else cands.push({ x: last[0], y: last[1], text: r.label, xr: xr });
        });
        placeCdfLabels(g, cands, curves, px0, px1, py0, py1);
        var xh = svgEl('line', { x1: px0, y1: py0, x2: px0, y2: py1, class: 'ct-xhair' }); xh.style.display = 'none'; g.appendChild(xh);
        var aria = p + ': ' + series.map(function (r) { return r.label + ' median ' + U.m(r.median) + (r.fail > 0 ? ', ' + fmtInt(r.fail) + ' failures' : ''); }).join('; ');
        var hit = hitRect(px0, py0, px1 - px0, py1 - py0, aria); g.appendChild(hit);
        var k0 = series.length ? snapK(isNum(series[0].median) ? series[0].median : Math.sqrt(xdom[0] * xdom[1])) : Math.round(SNAP / 2), kCur = k0, shown = false;
        function content(k) { var xv = snapV(k); return { title: 'ADE ≤ ' + U.m(sig2(xv)), rows: series.map(function (r) { return { value: U.pct(shareAt(r.q, xv, step)), label: r.label, slot: r.slot, style: r.style, marker: r.style === 'pub' ? r.marker : null }; }) }; }
        function showAt(k, cx, cy) { kCur = k; shown = true; var x = xs(snapV(k)); xh.setAttribute('x1', x.toFixed(1)); xh.setAttribute('x2', x.toFixed(1)); xh.style.display = ''; var r = svg.getBoundingClientRect(); showTip(inst, cx != null ? cx : r.left + x, cy != null ? cy : r.top + (py0 + py1) / 2, content(k)); }
        function hide() { shown = false; xh.style.display = 'none'; hideTip(inst); }
        hit.addEventListener('pointermove', function (ev) { var r = svg.getBoundingClientRect(), k = snapK(xs.invert(ev.clientX - r.left)); if (!shown || k !== kCur) showAt(k, ev.clientX, ev.clientY); else if (inst.tip && typeof inst.tip.move === 'function') inst.tip.move(ev.clientX, ev.clientY); });
        hit.addEventListener('pointerleave', hide);
        hit.addEventListener('focus', function () { showAt(kCur); }); hit.addEventListener('blur', hide);
        hit.addEventListener('keydown', function (ev) { if (ev.key === 'ArrowRight') { ev.preventDefault(); showAt(Math.min(SNAP, kCur + 1)); } else if (ev.key === 'ArrowLeft') { ev.preventDefault(); showAt(Math.max(0, kCur - 1)); } else if (ev.key === 'Escape') { hide(); hit.blur(); } });
      });
      firstDraw(inst, svg);
    };
    return out;
  }

  /* ================================================================== V08 · horizon */
  var HZ_COLS = ['panel', 'stem', 'protocol', 'fold', 'horizon_s', 'n', 'n_output', 'n_drivers', 'ade_median', 'ade_lo', 'ade_hi', 'route_ok', 'key', 'label', 'slot', 'style', 'marker'];
  function hLabel(h) { return (h % 60 === 0 ? fmtInt(h / 60) + ' min' : fmtInt(h) + ' s'); }
  function groupSeries(list) {
    var out = [], idx = {};
    list.forEach(function (r) { var id = r.stem + '/' + r.protocol; if (!(id in idx)) { idx[id] = out.length; out.push({ id: id, key: r.key, label: r.label, slot: r.slot, style: r.style, marker: r.marker, pts: [] }); } out[idx[id]].pts.push(r); });
    out.forEach(function (s) { s.pts.sort(function (a, b) { return a.horizon_s - b.horizon_s; }); });
    return out;
  }
  function signedM(v, dp) { if (!isNum(v)) return '—'; var a = Math.abs(v); var s = dp === 0 ? fmtInt(a) : a.toFixed(dp); if (/^[0.]+$/.test(s)) return s; return (v < 0 ? MINUS : '+') + s; }
  function pairsNote(pairs, fold, h) {
    if (!Array.isArray(pairs)) return null;
    var p = null;
    pairs.forEach(function (q) { if (!p && q.comparison === 'beam vs PF' && q.fold === fold && q.horizon_s === h) p = q; });
    if (!p) return null;
    var clause = isNum(p.mean_hi) && p.mean_hi < 0 ? ' — the beam avoids some of the filter’s largest failures.' : isNum(p.mean_lo) && p.mean_lo > 0 ? ' — the filter avoids some of the beam’s largest failures.' : ' — no clear evidence either way on the mean.';
    return 'Paired on the same windows at ' + fmtInt(h / 60) + ' minutes, beam − filter: median ' + signedM(p.median, 1) + ' m [' + signedM(p.median_lo, 1) + ', ' + signedM(p.median_hi, 1) + '], mean ' + signedM(p.mean, 0) + ' m [' + signedM(p.mean_lo, 0) + ', ' + signedM(p.mean_hi, 0) + ']' + clause;
  }
  function horizonTwin(R, U) {
    var body = R.map(function (r) { return [r.panel, r.label, r.protocol, foldLabel(r.fold), hLabel(r.horizon_s), fmtInt(r.n), fmtInt(r.n_output), fmtInt(r.n_drivers), U.m(r.ade_median), isNum(r.ade_lo) && isNum(r.ade_hi) ? mVal(r.ade_lo) + ' to ' + mVal(r.ade_hi) + ' m' : '—', U.pct(r.route_ok)]; });
    return { head: ['panel', 'method', 'protocol', 'drivers', 'horizon', 'drives', 'outputs', 'n drivers', 'median ADE', '95 % band', 'route recovered'], rows: body, caption: 'Horizon cohort: median ADE 1, 5 and 15 minutes after the start, both folds.' };
  }
  function placeEndLabels(g, ends, lx, lxMax, py0, py1) {
    if (!ends.length) return;
    var BH = 26, items = ends.map(function (e) { return { e: e, y: e.y, nat: e.y }; }).sort(function (a, b) { return a.y - b.y; });
    var top = py0 + 12, bot = py1 - 14;
    for (var i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < BH) items[i].y = items[i - 1].y + BH;
    var over = items[items.length - 1].y - bot; if (over > 0) for (var j = 0; j < items.length; j++) items[j].y -= over;
    for (var k = items.length - 2; k >= 0; k--) if (items[k + 1].y - items[k].y < BH) items[k].y = items[k + 1].y - BH;
    if (items[0].y < top) { var shift = top - items[0].y; for (var m = 0; m < items.length; m++) items[m].y += shift; }
    var displaced = items.filter(function (it) { return Math.abs(it.y - it.nat) > 2; }).length;
    if (displaced > 4) return; // more than four converging labels: legend only
    var maxW = Math.max(40, lxMax - lx);
    items.forEach(function (it) {
      if (Math.abs(it.y - it.nat) > 2) { var lead = svgEl('line', { x1: (lx - 7).toFixed(1), y1: it.nat.toFixed(1), x2: (lx - 2).toFixed(1), y2: it.y.toFixed(1), class: 'ct-xhair' }); lead.style.opacity = '.7'; g.appendChild(lead); }
      g.appendChild(halo(text(lx, it.y - 2, truncate(it.e.label, maxW, 11), 'ct-lbl', 'start')));
      g.appendChild(halo(text(lx, it.y + 11, it.e.value, 'ct-lbl--dim', 'start')));
    });
  }
  function renderHorizon(inst, W) {
    var D = inst.data, meta = D.meta || {}, U = util(inst);
    var R = rows(D, 'horizon', HZ_COLS);
    var fold = foldOf(inst), panels = Array.isArray(meta.panels) && meta.panels.length ? meta.panels : uniq(R.map(function (r) { return r.panel; }));
    var ydom = Array.isArray(meta.y_domain) ? meta.y_domain : [5, 20000], clampY = clampTo(ydom);
    var sel = R.filter(function (r) { return r.fold === fold; });
    var hs = uniq(sel.map(function (r) { return r.horizon_s; })).filter(isNum).sort(function (a, b) { return a - b; });
    if (hs.length < 2) hs = [60, 300, 900];
    var side = W >= 720, nP = panels.length, GAP = 24, panelW = side ? (W - GAP * (nP - 1)) / nP : W;
    var TOPB = 24, AXB = 30, plotH = Math.round(Math.max(220, 0.6 * Math.min(panelW, 480)));
    var blockH = TOPB + plotH + AXB, H = side ? blockH : blockH * nP + 8 * (nP - 1);
    var maxLab = 0; sel.forEach(function (r) { maxLab = Math.max(maxLab, estW(r.label)); });
    var endLabels = W >= 480; // below 480 px the gutter would take half the panel: legend only, values stay in the tooltip and the table
    var ML = 40, MR = 6, gutter = endLabels ? Math.round(Math.min(0.52 * panelW, Math.max(90, maxLab + 16))) : 0; // the end-label gutter: as wide as the longest label, at most half the panel
    var legend = metaLegend(meta), sIdx = keyIndex(legend);
    var out = { height: H, legend: legend.length > 1 ? legend : null, twin: horizonTwin(R, U), note: pairsNote(meta.pairs, fold, hs[hs.length - 1]) };
    out.draw = function (svg) {
      panels.forEach(function (p, pi) {
        var ox = side ? pi * (panelW + GAP) : 0, oy = side ? 0 : pi * (blockH + 8);
        var px0 = ox + ML, px1 = ox + panelW - gutter - MR, py0 = oy + TOPB + 8, py1 = oy + TOPB + plotH;
        var xs = logScale([hs[0], hs[hs.length - 1]], [px0, px1]), ys = logScale(ydom, [py1, py0]);
        var g = svgEl('g', { class: 'ct-panel' }); svg.appendChild(g);
        g.appendChild(text(ox, oy + 14, p, 'ct-title', 'start'));
        ticksLog(ydom).forEach(function (v) { if (!isDecade(v)) return; var yy = ys(v); g.appendChild(svgEl('line', { x1: px0, y1: yy.toFixed(1), x2: px1, y2: yy.toFixed(1), class: 'ct-grid' })); g.appendChild(text(px0 - 6, yy + 4, tickM(v), null, 'end')); });
        hs.forEach(function (h) { var x = xs(h); g.appendChild(svgEl('line', { x1: x.toFixed(1), y1: py0, x2: x.toFixed(1), y2: py1, class: 'ct-grid' })); tickText(g, x, py1 + 16, hLabel(h), W); });
        g.appendChild(svgEl('line', { x1: px0, y1: py1 + 0.5, x2: px1, y2: py1 + 0.5, class: 'ct-axis' }));
        var ser = groupSeries(sel.filter(function (r) { return r.panel === p; })), ends = [];
        ser.forEach(function (s) {
          var color = U.color(s.slot), sg = svgEl('g', { 'data-key': s.key, 'data-slot': s.slot }), si = sIdx(s.key); if (si >= 0) sg.setAttribute('data-series', si);
          var up = [], dn = [];
          s.pts.forEach(function (r) { if (isNum(r.ade_lo) && isNum(r.ade_hi)) { up.push([xs(r.horizon_s), ys(clampY(r.ade_hi).v)]); dn.unshift([xs(r.horizon_s), ys(clampY(r.ade_lo).v)]); } });
          if (up.length > 1) { var band = svgEl('path', { d: 'M' + up.concat(dn).map(function (pt) { return pt[0].toFixed(1) + ' ' + pt[1].toFixed(1); }).join('L') + 'Z', class: 'ct-band' }); band.style.fill = color; sg.appendChild(band); }
          var lp = s.pts.filter(function (r) { return isNum(r.ade_median); }).map(function (r) { return [xs(r.horizon_s), ys(clampY(r.ade_median).v)]; });
          if (lp.length > 1) { var path = svgEl('path', { d: 'M' + lp.map(function (pt) { return pt[0].toFixed(1) + ' ' + pt[1].toFixed(1); }).join('L'), class: 'ct-line' }); path.style.stroke = color; var da = U.dash(s.style); if (da) path.setAttribute('stroke-dasharray', da); sg.appendChild(path); }
          lp.forEach(function (pt) { sg.appendChild(mark(U, s.style === 'pub' && s.marker ? s.marker : 'circle', pt[0], pt[1], 4.5, color, false, null)); });
          g.appendChild(sg);
          var last = s.pts[s.pts.length - 1];
          if (last && isNum(last.ade_median) && last.horizon_s === hs[hs.length - 1]) ends.push({ y: ys(clampY(last.ade_median).v), label: s.label, value: U.m(last.ade_median) });
        });
        if (endLabels) placeEndLabels(g, ends, px1 + 10, ox + panelW - MR, py0, py1);
        var xh = svgEl('line', { x1: px0, y1: py0, x2: px0, y2: py1, class: 'ct-xhair' }); xh.style.display = 'none'; g.appendChild(xh);
        function content(h) {
          return { title: hLabel(h) + ' after the start', rows: ser.map(function (s) { var r = null; s.pts.forEach(function (q) { if (q.horizon_s === h) r = q; }); var mk = s.style === 'pub' ? s.marker : null; if (!r) return { value: '—', label: s.label, slot: s.slot, style: s.style, marker: mk };
            return { value: U.m(r.ade_median) + ciText(r.ade_lo, r.ade_hi), label: s.label + ' · route ' + U.pct(r.route_ok) + (isNum(r.n_output) && isNum(r.n) && r.n_output < r.n ? ' · ' + fmtInt(r.n_output) + ' of ' + fmtInt(r.n) + ' with output' : ''), slot: s.slot, style: s.style, marker: mk }; }) };
        }
        hs.forEach(function (h, hi) {
          var xa = hi === 0 ? px0 - 12 : (xs(hs[hi - 1]) + xs(h)) / 2, xb = hi === hs.length - 1 ? px1 + 12 : (xs(h) + xs(hs[hi + 1])) / 2;
          var c = content(h), hit = hitRect(xa, py0, xb - xa, py1 - py0, tipText(c)); g.appendChild(hit);
          var shown = false;
          function show(cx, cy) { shown = true; var x = xs(h); xh.setAttribute('x1', x.toFixed(1)); xh.setAttribute('x2', x.toFixed(1)); xh.style.display = ''; showTip(inst, cx, cy, c); }
          function hide() { shown = false; xh.style.display = 'none'; hideTip(inst); }
          hit.addEventListener('pointerenter', function (ev) { show(ev.clientX, ev.clientY); });
          hit.addEventListener('pointermove', function (ev) { if (shown && inst.tip && typeof inst.tip.move === 'function') inst.tip.move(ev.clientX, ev.clientY); else show(ev.clientX, ev.clientY); });
          hit.addEventListener('pointerleave', hide);
          hit.addEventListener('focus', function () { var r = svg.getBoundingClientRect(); show(r.left + xs(h), r.top + (py0 + py1) / 2); });
          hit.addEventListener('blur', hide);
        });
      });
      firstDraw(inst, svg);
    };
    return out;
  }

  /* ================================================================== register */
  CT.charts.register('board', renderBoard, { cols: BOARD_COLS });
  CT.charts.register('cdf', renderCdf, { cols: CDF_COLS });
  CT.charts.register('horizon', renderHorizon, { cols: HZ_COLS });
  doc.dispatchEvent(new CustomEvent('ct:renderers'));
  if (Proj && typeof Proj.bootAll === 'function') Proj.bootAll(doc);
})(window, document);
