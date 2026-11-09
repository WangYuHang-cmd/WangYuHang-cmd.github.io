/* CANTraj page · custom chart core (CtChart). Vanilla JS, no dependencies; extends the project-page kit (window.Proj).
   Contract (SPEC §2.5, §4.1–§4.7): one widget `ct-chart` whose `data-ct` kind is drawn by a renderer registered with
     CT.charts.register(kind, function render(inst, W) { … return { height, draw(svg), legend, twin, note }; })
   Renderers live in charts-results.js (board, cdf, horizon), charts-signals.js (robust, gains, cost) and charts-failures.js
   (topk, taxonomy, agent, density, confidence); each registers, dispatches document event `ct:renderers`, then calls Proj.bootAll.
   The core owns: the widget chrome and lifecycle (is-loading / is-live / is-error, the fallback path, pj:ready), loading and
   validating table/1 data, the fold-filter row (#ct-fold, body[data-ct-fold], event ct:fold), the render loop (SVG with a CSS-pixel
   viewBox, legend, note, "Data as text" twin, fold swap, resize), tooltips, emphasis (legend hover/isolate, ct:highlight) and
   CT.charts.util (colours only through --ct-* custom properties; formatters; scales; marks; axes; hit targets; crosshair).
   Data strings reach the DOM only through textContent; nothing here names a place, a route or a raw identifier. */
(function (win, doc) {
  'use strict';
  if (!win.Proj) return;
  var Proj = win.Proj;
  var CT = win.CT = win.CT || {};
  if (CT.charts && CT.charts.version) return; // loaded twice: keep the first instance
  var SVGNS = 'http://www.w3.org/2000/svg';
  var VERSION = '1.0.0';
  var FOLDS = ['test', 'few_shot_heldout'];
  var FOLD_LABEL = { test: 'test drivers', few_shot_heldout: 'few-shot drivers' };
  var FOLD_SHORT = { test: 'test', few_shot_heldout: 'few-shot' };
  var KINDS = ['board', 'cdf', 'horizon', 'robust', 'topk', 'taxonomy', 'gains', 'cost', 'agent', 'density', 'confidence'];
  var DASH = { online: '', offline: '7 4', nomap: '1.5 4.5', pub: '9 3 2 3', lineage: '9 3 2 3 2 3' };
  var RENDERER_WAIT_MS = 8000, RESIZE_MS = 100, SWAP_HOLD_MS = 120, SWAP_MS = 160, DRAW_MS = 600, LIFT_MS = 120;
  var uid = 0;

  /* ====================================================================== helpers */
  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function dbg() { if (win.console && console.debug) console.debug.apply(console, ['[proj]'].concat(Array.prototype.slice.call(arguments))); }
  function reduced() { return !!(Proj.reduced && Proj.reduced()); }
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function setAttrs(e, attrs) {
    for (var k in attrs) {
      var v = attrs[k]; if (v == null) continue;
      if (k === 'fill' || k === 'stroke') e.style[k] = String(v); // colours are var(--ct-*) values: presentation attributes do not accept var()
      else if (k === 'text') e.textContent = String(v);
      else if (k === 'style') e.setAttribute('style', String(v));
      else e.setAttribute(k, String(v));
    }
    return e;
  }
  function svgEl(tag, attrs) { var e = doc.createElementNS(SVGNS, tag); if (attrs) setAttrs(e, attrs); return e; }
  function debounce(fn, ms) { var h = 0; return function () { var a = arguments, s = this; clearTimeout(h); h = setTimeout(function () { fn.apply(s, a); }, ms); }; }
  function cssEscape(s) { s = String(s); return win.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'); }
  function nextId(prefix) { return (prefix || 'ct') + '-' + (++uid); }

  /* ====================================================================== formatters (display rounding of SPEC §0.5 / §4.5; minus is U+2212) */
  function num(v, dp) {
    if (!isNum(v)) return '—';
    dp = dp == null ? 0 : dp;
    var p = Math.pow(10, dp), r = Math.round(Math.abs(v) * p) / p;
    var s = r.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return (v < 0 && r > 0 ? '\u2212' : '') + s;
  }
  function mv(v) { return isNum(v) ? num(v, Math.abs(v) < 10 ? 1 : 0) : '—'; } // metres, no unit
  var fmt = {
    num: num,
    int: function (v) { return num(v, 0); },
    mv: mv,
    m: function (v) { return isNum(v) ? mv(v) + ' m' : '—'; },
    tick: function (v) { // log-axis metres: 10 m · 100 m · 1 km · 10 km
      if (!isNum(v)) return '';
      if (Math.abs(v) >= 1000) { var k = v / 1000; return num(k, Math.abs(k - Math.round(k)) > 1e-9 ? 1 : 0) + ' km'; }
      return num(v, Math.abs(v) < 10 && Math.abs(v - Math.round(v)) > 1e-9 ? 1 : 0) + ' m';
    },
    pct: function (v, dp) { return isNum(v) ? num(v * 100, dp || 0) + '\u00a0%' : '—'; },       // share 0–1 → 88 %
    pct100: function (v, dp) { return isNum(v) ? num(v, dp || 0) + '\u00a0%' : '—'; },          // already ×100
    pp: function (v, dp) { if (!isNum(v)) return '—'; dp = dp == null ? 1 : dp; var r = Math.round(v * Math.pow(10, dp)); return (r > 0 ? '+' : '') + num(v, dp) + ' pp'; },
    signed: function (v, dp, unit) { if (!isNum(v)) return '—'; dp = dp == null ? 1 : dp; var r = Math.round(v * Math.pow(10, dp)); return (r > 0 ? '+' : '') + num(v, dp) + (unit ? ' ' + unit : ''); },
    s: function (v) { if (!isNum(v)) return '—'; if (v < 1) return num(v * 1000, 0) + ' ms'; if (v < 10) return num(v, 1) + ' s'; return num(v, 0) + ' s'; },
    range: function (lo, hi, f) { f = f || mv; return '[' + f(lo) + ', ' + f(hi) + ']'; },
    out: function (v, f) { return v == null || (typeof v === 'number' && !isFinite(v)) ? 'no output' : (f || fmt.m)(v); },
    fold: function (f) { return FOLD_LABEL[f] || String(f == null ? '' : f); },
    foldShort: function (f) { return FOLD_SHORT[f] || String(f == null ? '' : f); }
  };

  /* ====================================================================== scales and ticks */
  function ticksLin(domain, n) {
    n = n || 5; var lo = Math.min(domain[0], domain[1]), hi = Math.max(domain[0], domain[1]), span = hi - lo;
    if (!(span > 0)) return [lo];
    var raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = mag * 10;
    [1, 2, 2.5, 5, 10].some(function (m) { if (m * mag >= raw - 1e-12) { step = m * mag; return true; } return false; });
    var out = [], dp = Math.max(0, -Math.floor(Math.log10(step)) + 1);
    for (var v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(dp + 2));
    return out;
  }
  function ticksLog(domain, major) {
    var lo = Math.min(domain[0], domain[1]), hi = Math.max(domain[0], domain[1]), out = [];
    if (!(lo > 0) || !(hi > 0)) return out;
    var e = Math.floor(Math.log10(lo)) - 1, mults = major ? [1] : [1, 2, 5];
    for (; e <= Math.ceil(Math.log10(hi)); e++) {
      var base = Math.pow(10, e);
      for (var i = 0; i < mults.length; i++) { var v = +(mults[i] * base).toPrecision(12); if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) out.push(v); }
    }
    return out;
  }
  function lin(domain, range) {
    var d0 = domain[0], d1 = domain[1], r0 = range[0], r1 = range[1], k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
    var lo = Math.min(d0, d1), hi = Math.max(d0, d1);
    function f(v) { return r0 + (v - d0) * k; }
    f.invert = function (p) { return k === 0 ? d0 : d0 + (p - r0) / k; };
    f.domain = domain; f.range = range; f.type = 'lin';
    f.ticks = function (n) { return ticksLin(domain, n); };
    f.clamp = function (v) { if (!isNum(v)) return { v: null, x: null, out: 0 }; var c = clamp(v, lo, hi); return { v: c, x: f(c), out: v < lo ? -1 : v > hi ? 1 : 0 }; };
    return f;
  }
  function log(domain, range) {
    var l0 = Math.log10(domain[0]), l1 = Math.log10(domain[1]), r0 = range[0], r1 = range[1], k = l1 === l0 ? 0 : (r1 - r0) / (l1 - l0);
    var lo = Math.min(domain[0], domain[1]), hi = Math.max(domain[0], domain[1]);
    function f(v) { return r0 + (Math.log10(v) - l0) * k; }
    f.invert = function (p) { return Math.pow(10, k === 0 ? l0 : l0 + (p - r0) / k); };
    f.domain = domain; f.range = range; f.type = 'log';
    f.ticks = function (major) { return ticksLog(domain, major); };
    f.clamp = function (v) { if (!isNum(v) || !(v > 0)) return { v: null, x: null, out: v == null ? 0 : (v <= 0 ? -1 : 1) }; var c = clamp(v, lo, hi); return { v: c, x: f(c), out: v < lo ? -1 : v > hi ? 1 : 0 }; };
    return f;
  }

  /* ====================================================================== colour, dash, marks */
  function color(slot) { // slot 1–8 → var(--ct-sN); 0 → var(--ct-mute) (class F, hatched); '--name' → var(--name); null → var(--ct-mono)
    if (slot == null || slot === '') return 'var(--ct-mono)';
    if (isNum(slot)) return slot === 0 ? 'var(--ct-mute)' : 'var(--ct-s' + clamp(Math.round(slot), 1, 8) + ')';
    var s = String(slot); return s.indexOf('--') === 0 ? 'var(' + s + ')' : s;
  }
  function dash(style) { return DASH[style] || ''; }
  function hatchDefs(id) { // 45° hatch of --ct-mute at 50 % (class F reference rows)
    var defs = svgEl('defs'), p = svgEl('pattern', { id: id, patternUnits: 'userSpaceOnUse', width: 6, height: 6, patternTransform: 'rotate(45)' });
    p.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'var(--ct-mute)', 'stroke-width': 2, opacity: 0.5 }));
    defs.appendChild(p); return defs;
  }
  function marker(shape, x, y, r, hollow, col) { // ≥ 8 px, filled with the series colour + 2 px surface ring; hollow = surface fill, 2 px series stroke
    r = isNum(r) ? Math.max(4, r) : 4.5; var h = Math.max(4, r), s = 2 * h, e, d;
    if (shape === 'cross') {
      var g = svgEl('g', { class: 'ct-mark ct-mark--cross', 'data-shape': 'cross' });
      d = 'M' + (x - h) + ' ' + (y - h) + 'L' + (x + h) + ' ' + (y + h) + 'M' + (x + h) + ' ' + (y - h) + 'L' + (x - h) + ' ' + (y + h);
      g.appendChild(svgEl('path', { d: d, fill: 'none', stroke: 'var(--ct-surface)', 'stroke-width': 6, 'stroke-linecap': 'round' }));
      g.appendChild(svgEl('path', { d: d, fill: 'none', stroke: col || 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }));
      return g;
    }
    if (shape === 'square') e = svgEl('rect', { x: x - h, y: y - h, width: s, height: s, rx: 1 });
    else if (shape === 'tri-up') e = svgEl('path', { d: 'M' + x + ' ' + (y - h * 1.15) + 'L' + (x + h * 1.15) + ' ' + (y + h * 0.85) + 'L' + (x - h * 1.15) + ' ' + (y + h * 0.85) + 'Z' });
    else if (shape === 'tri-down') e = svgEl('path', { d: 'M' + x + ' ' + (y + h * 1.15) + 'L' + (x + h * 1.15) + ' ' + (y - h * 0.85) + 'L' + (x - h * 1.15) + ' ' + (y - h * 0.85) + 'Z' });
    else if (shape === 'diamond') e = svgEl('path', { d: 'M' + x + ' ' + (y - h * 1.2) + 'L' + (x + h * 1.2) + ' ' + y + 'L' + x + ' ' + (y + h * 1.2) + 'L' + (x - h * 1.2) + ' ' + y + 'Z' });
    else e = svgEl('circle', { cx: x, cy: y, r: h });
    e.setAttribute('class', hollow ? 'ct-mark ct-mark--hollow' : 'ct-mark');
    e.setAttribute('data-shape', shape || 'circle');
    e.setAttribute('stroke-width', '2');
    if (col) { if (hollow) { e.style.fill = 'var(--ct-surface)'; e.style.stroke = col; } else { e.style.fill = col; e.style.stroke = 'var(--ct-surface)'; } }
    return e;
  }
  function keySvg(style, slot, mk, opts) { // 28×12 legend key: the exact line style + marker in the series colour (also used at 14×10 in tooltips)
    opts = opts || {}; var w = opts.w || 28, h = opts.h || 12, col = opts.color || color(slot);
    var svg = svgEl('svg', { viewBox: '0 0 ' + w + ' ' + h, width: w, height: h, 'aria-hidden': 'true', focusable: 'false' });
    if (opts.swatch) {
      var rect = svgEl('rect', { x: 1, y: 1, width: w - 2, height: h - 2, rx: 3 });
      if (opts.hatch) { var pid = nextId('ct-hk'); svg.appendChild(hatchDefs(pid)); rect.style.fill = 'url(#' + pid + ')'; rect.style.stroke = 'var(--ct-mute)'; rect.setAttribute('stroke-width', '1'); }
      else rect.style.fill = col;
      svg.appendChild(rect); return svg;
    }
    if (style !== 'none') {
      var ln = svgEl('line', { x1: 1, y1: h / 2, x2: w - 1, y2: h / 2, stroke: col, 'stroke-width': 2, 'stroke-linecap': 'round' });
      var da = dash(style); if (da) ln.setAttribute('stroke-dasharray', da);
      svg.appendChild(ln);
    }
    if (mk) svg.appendChild(marker(mk, w / 2, h / 2, 4, !!opts.hollow, col));
    return svg;
  }

  /* ====================================================================== text, layout, data helpers */
  var measureCache = new Map();
  function textWidth(svg, str, cls, size) { // measured on the live svg; estimate when the svg is not rendered
    str = String(str == null ? '' : str); var key = (cls || '') + '|' + (size || '') + '|' + str, c = measureCache.get(key);
    if (c != null) return c;
    var w = 0;
    if (svg) {
      var t = svgEl('text', { x: -9999, y: -9999 }); if (cls) t.setAttribute('class', cls); if (size) t.setAttribute('font-size', size); t.textContent = str;
      svg.appendChild(t); try { w = t.getComputedTextLength(); } catch (e) { w = 0; } svg.removeChild(t);
    }
    if (!(w > 0)) return str.length * (size || 11) * 0.56; // not cached: the svg may become visible later
    if (measureCache.size > 4000) measureCache.clear();
    measureCache.set(key, w); return w;
  }
  function spread(ys, gap, lo, hi) { // 1-D label de-collision keeping order; returns adjusted positions in input order
    var idx = ys.map(function (y, i) { return i; }).sort(function (a, b) { return ys[a] - ys[b]; }), pos = ys.slice(), i, a, b;
    for (i = 1; i < idx.length; i++) { a = idx[i - 1]; b = idx[i]; if (pos[b] - pos[a] < gap) pos[b] = pos[a] + gap; }
    if (hi != null && idx.length) { var last = idx[idx.length - 1]; if (pos[last] > hi) pos[last] = hi; for (i = idx.length - 2; i >= 0; i--) { a = idx[i]; b = idx[i + 1]; if (pos[b] - pos[a] < gap) pos[a] = pos[b] - gap; } }
    if (lo != null && idx.length) { var first = idx[0]; if (pos[first] < lo) pos[first] = lo; for (i = 1; i < idx.length; i++) { a = idx[i - 1]; b = idx[i]; if (pos[b] - pos[a] < gap) pos[b] = pos[a] + gap; } }
    return pos;
  }
  function rows(data, pred) { // columnar table/1 → array of row objects (row._i = index)
    var cols = data.cols, keys = Object.keys(cols), out = [];
    for (var i = 0; i < data.n; i++) { var r = { _i: i }; for (var k = 0; k < keys.length; k++) r[keys[k]] = cols[keys[k]][i]; if (!pred || pred(r, i)) out.push(r); }
    return out;
  }
  function series(data) { return (data && data.meta && Array.isArray(data.meta.series)) ? data.meta.series : []; }
  function seriesMap(data) { var m = {}; series(data).forEach(function (s) { if (s && s.key != null) m[s.key] = s; }); return m; }
  function pathD(points) { // [[x, y] | null, …] → path data; null lifts the pen
    var d = '', pen = false;
    for (var i = 0; i < points.length; i++) { var p = points[i]; if (!p || !isNum(p[0]) || !isNum(p[1])) { pen = false; continue; } d += (pen ? 'L' : 'M') + (+p[0].toFixed(2)) + ' ' + (+p[1].toFixed(2)); pen = true; }
    return d;
  }
  function barD(x, y, w, h, r, dir) { // bar with a 4 px rounded data end and a square baseline; dir = right (default) | left | up | down
    if (!(w > 0) || !(h > 0)) return '';
    r = Math.max(0, Math.min(r == null ? 4 : r, dir === 'up' || dir === 'down' ? Math.min(w / 2, h) : Math.min(h / 2, w)));
    var x1 = x + w, y1 = y + h, a = 'A' + r + ' ' + r + ' 0 0 ';
    if (dir === 'left') return 'M' + x1 + ' ' + y + 'H' + (x + r) + a + '0 ' + x + ' ' + (y + r) + 'V' + (y1 - r) + a + '0 ' + (x + r) + ' ' + y1 + 'H' + x1 + 'Z';
    if (dir === 'up') return 'M' + x + ' ' + y1 + 'V' + (y + r) + a + '1 ' + (x + r) + ' ' + y + 'H' + (x1 - r) + a + '1 ' + x1 + ' ' + (y + r) + 'V' + y1 + 'Z';
    if (dir === 'down') return 'M' + x + ' ' + y + 'V' + (y1 - r) + a + '0 ' + (x + r) + ' ' + y1 + 'H' + (x1 - r) + a + '0 ' + x1 + ' ' + (y1 - r) + 'V' + y + 'Z';
    return 'M' + x + ' ' + y + 'H' + (x1 - r) + a + '1 ' + x1 + ' ' + (y + r) + 'V' + (y1 - r) + a + '1 ' + (x1 - r) + ' ' + y1 + 'H' + x + 'Z';
  }
  function text(parent, x, y, str, attrs) {
    attrs = attrs || {}; var t = svgEl('text', { x: x, y: y });
    if (attrs.cls) t.setAttribute('class', attrs.cls); if (attrs.anchor) t.setAttribute('text-anchor', attrs.anchor); if (attrs.dy != null) t.setAttribute('dy', attrs.dy);
    if (attrs.size) t.setAttribute('font-size', attrs.size); if (attrs.weight) t.setAttribute('font-weight', attrs.weight); if (attrs.baseline) t.setAttribute('dominant-baseline', attrs.baseline);
    t.textContent = String(str == null ? '' : str); if (parent) parent.appendChild(t); return t;
  }
  function panels(W, n, opts) { // small multiples: side by side when W ≥ 720, else stacked; each panel max(220, 0.6·panelW) high (capped)
    opts = opts || {}; var gap = opts.gap == null ? 24 : opts.gap, top = opts.top == null ? 0 : opts.top, boxes = [], i;
    if (W >= (opts.breakpoint || 720) && n > 1) {
      var pw = (W - gap * (n - 1)) / n, ph = Math.round(clamp(0.6 * pw, 220, opts.maxH || 420));
      for (i = 0; i < n; i++) boxes.push({ x: Math.round(i * (pw + gap)), y: top, w: Math.round(pw), h: ph });
      return { boxes: boxes, height: top + ph, stacked: false };
    }
    var ph2 = Math.round(clamp(0.6 * W, 220, opts.maxH || 360)), vgap = opts.vgap == null ? 28 : opts.vgap;
    for (i = 0; i < n; i++) boxes.push({ x: 0, y: top + i * (ph2 + vgap), w: W, h: ph2 });
    return { boxes: boxes, height: top + n * ph2 + (n - 1) * vgap, stacked: true };
  }
  function xyHeight(W) { return Math.round(clamp(0.56 * W, 260, 420)); }
  function rowsHeight(n, rowH, pad) { return n * (rowH || 26) + (pad == null ? 64 : pad); }

  /* ====================================================================== axes (1 px solid hairlines; text 11 px in text tokens via CSS) */
  function axisX(svg, scale, o) { // o: {y, ticks, fmt, grid:[y0,y1], label, major}
    o = o || {}; var g = svgEl('g', { class: 'ct-axis-x' }), ticks = o.ticks || scale.ticks(o.n || (scale.type === 'log' ? o.major : 5)), f = o.fmt || String;
    var x0 = Math.min(scale.range[0], scale.range[1]), x1 = Math.max(scale.range[0], scale.range[1]);
    g.appendChild(svgEl('line', { class: 'ct-axis', x1: x0, x2: x1, y1: o.y, y2: o.y }));
    ticks.forEach(function (v) {
      var x = scale(v); if (!isNum(x) || x < x0 - 0.5 || x > x1 + 0.5) return;
      if (o.grid) g.appendChild(svgEl('line', { class: 'ct-grid', x1: x, x2: x, y1: o.grid[0], y2: o.grid[1] }));
      text(g, x, o.y + 15, f(v), { anchor: 'middle' });
    });
    if (o.label) text(g, x1, o.y + 30, o.label, { anchor: 'end', cls: 'ct-lbl--dim' });
    svg.appendChild(g); return g;
  }
  function axisY(svg, scale, o) { // o: {x, ticks, fmt, grid:[x0,x1], label, major}
    o = o || {}; var g = svgEl('g', { class: 'ct-axis-y' }), ticks = o.ticks || scale.ticks(o.n || (scale.type === 'log' ? o.major : 5)), f = o.fmt || String;
    var y0 = Math.min(scale.range[0], scale.range[1]), y1 = Math.max(scale.range[0], scale.range[1]);
    g.appendChild(svgEl('line', { class: 'ct-axis', x1: o.x, x2: o.x, y1: y0, y2: y1 }));
    ticks.forEach(function (v) {
      var y = scale(v); if (!isNum(y) || y < y0 - 0.5 || y > y1 + 0.5) return;
      if (o.grid) g.appendChild(svgEl('line', { class: 'ct-grid', x1: o.grid[0], x2: o.grid[1], y1: y, y2: y }));
      text(g, o.x - 7, y, f(v), { anchor: 'end', dy: '0.35em' });
    });
    if (o.label) text(g, o.x, y0 - 8, o.label, { anchor: 'start', cls: 'ct-lbl--dim' });
    svg.appendChild(g); return g;
  }

  /* ====================================================================== tooltip (div.ct-tip in .ct-plot; --x %, --y px; kept off the pointer) */
  function Tip(inst) { this.inst = inst; this.el = null; this.content = null; }
  Tip.prototype.ensure = function () {
    if (!this.el || this.el.parentNode !== this.inst.plot) { this.el = el('div', 'ct-tip'); this.el.hidden = true; this.el.setAttribute('role', 'tooltip'); this.inst.plot.appendChild(this.el); }
    return this.el;
  };
  Tip.prototype.fill = function (c) {
    var t = this.ensure(); clear(t); this.content = c; if (!c) return;
    if (typeof c === 'string') c = { title: c };
    if (c.title) t.appendChild(el('b', 'ct-tip__h', c.title));
    (c.rows || []).forEach(function (row) {
      if (row == null) return; if (typeof row === 'string') row = { label: row };
      var d = el('div', 'ct-tip__row'), key;
      if (row.marker || row.hollow || row.swatch || row.hatch) { key = keySvg(row.style || (row.marker ? 'none' : 'online'), row.slot, row.marker, { w: 14, h: 10, hollow: row.hollow, color: row.color, swatch: row.swatch, hatch: row.hatch }); key.classList.add('ct-tip__k'); }
      else if (row.slot != null || row.color) {
        var st = row.style; key = el('i', 'ct-tip__key' + (st === 'offline' || st === 'pub' || st === 'lineage' ? ' ct-tip__key--dash' : st === 'nomap' ? ' ct-tip__key--dot' : ''));
        key.style.setProperty('--k', row.color || color(row.slot));
      } else key = el('span');
      d.appendChild(key);
      var val = el('span', 'ct-tip__val', row.value == null ? '—' : row.value); if (row.dim) val.style.fontWeight = '500';
      d.appendChild(val); d.appendChild(el('span', 'ct-tip__lbl', row.label == null ? '' : row.label)); t.appendChild(d);
    });
  };
  Tip.prototype.show = function (cx, cy, c) { this.fill(c); this.move(cx, cy); };
  Tip.prototype.move = function (cx, cy) {
    var t = this.ensure(), r = this.inst.plot.getBoundingClientRect(); if (!(r.width > 0)) return;
    if (!this.content) { t.hidden = true; return; } // never a bare box: show(content) first, move() after
    t.hidden = false;
    var x = cx - r.left, y = cy - r.top, h = t.offsetHeight || 40, yy = y + 18;
    if (yy + h > r.height - 2) yy = y - h - 14;
    if (yy < 0) yy = clamp(y + 18, 2, Math.max(2, r.height - h - 2));
    t.style.setProperty('--x', (clamp(x / r.width, 0, 1) * 100).toFixed(2) + '%');
    t.style.setProperty('--y', Math.round(yy) + 'px');
  };
  Tip.prototype.hide = function () { if (this.el) this.el.hidden = true; };
  function ariaText(c) { // the tooltip as one sentence (aria-label of hit targets)
    if (!c) return ''; if (typeof c === 'string') return c;
    var parts = [];
    (c.rows || []).forEach(function (r) { if (r == null) return; if (typeof r === 'string') { parts.push(r); return; } var v = r.value == null ? '—' : String(r.value), l = r.label == null ? '' : String(r.label); parts.push(l ? v + ' ' + l : v); });
    return (c.title ? c.title + (parts.length ? ': ' : '') : '') + parts.join('; ');
  }

  /* ====================================================================== hit targets (≥ 24 px, keyboard-reachable) and the crosshair */
  function hit(inst, parent, box, content, opts) { // box {x,y,w,h}; content = object or function → tooltip content; opts {focusable, label, onClick, lift}
    opts = opts || {}; var w = Math.max(24, box.w || 0), h = Math.max(24, box.h || 0), x = box.x - (w - (box.w || 0)) / 2, y = box.y - (h - (box.h || 0)) / 2;
    var get = typeof content === 'function' ? content : function () { return content; };
    var r = svgEl('rect', { class: 'ct-hit', x: x, y: y, width: w, height: h });
    if (opts.focusable !== false) { r.setAttribute('tabindex', '0'); r.setAttribute('role', 'img'); r.setAttribute('aria-label', opts.label || ariaText(get())); }
    function on(ev) { inst.tip.show(ev.clientX, ev.clientY, get()); if (opts.lift) inst.lift(opts.lift); }
    function off() { inst.tip.hide(); if (opts.lift) inst.lift(null); }
    r.addEventListener('pointerenter', on);
    r.addEventListener('pointermove', function (ev) { inst.tip.move(ev.clientX, ev.clientY); });
    r.addEventListener('pointerleave', off);
    r.addEventListener('focus', function () { var b = r.getBoundingClientRect(); inst.tip.show(b.left + b.width / 2, b.top + b.height / 2, get()); if (opts.lift) inst.lift(opts.lift); });
    r.addEventListener('blur', off);
    if (opts.onClick) {
      r.style.cursor = 'pointer';
      r.addEventListener('click', function (ev) { opts.onClick(ev); });
      r.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); opts.onClick(ev); } });
    }
    (parent || inst.svg).appendChild(r); return r;
  }
  function crosshair(inst, svg, o) { // o: {xs:[px], top, bottom, left, right, content(i) → tooltip content, label}; one tooltip for every series at the snapped x
    var xs = o.xs || [], cur = -1;
    var line = svgEl('line', { class: 'ct-xhair', x1: 0, x2: 0, y1: o.top, y2: o.bottom, visibility: 'hidden' });
    var r = svgEl('rect', { class: 'ct-hit ct-hit--xhair', x: o.left, y: o.top, width: Math.max(1, o.right - o.left), height: Math.max(1, o.bottom - o.top), tabindex: 0, role: 'img', 'aria-label': o.label || 'Chart values. Use the arrow keys to move along the x axis.' });
    function scaleX() { var b = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal; return { b: b, k: vb && vb.width ? b.width / vb.width : 1 }; }
    function nearest(px) { var best = 0, bd = Infinity; for (var i = 0; i < xs.length; i++) { var d = Math.abs(xs[i] - px); if (d < bd) { bd = d; best = i; } } return best; }
    function at(i, cy) {
      if (!xs.length) return; cur = i; var c = o.content(i), s = scaleX();
      line.setAttribute('x1', xs[i]); line.setAttribute('x2', xs[i]); line.setAttribute('visibility', 'visible');
      inst.tip.show(s.b.left + xs[i] * s.k, cy, c); r.setAttribute('aria-label', ariaText(c) || (o.label || ''));
      if (o.onIndex) o.onIndex(i);
    }
    function off() { cur = -1; line.setAttribute('visibility', 'hidden'); inst.tip.hide(); if (o.onIndex) o.onIndex(-1); }
    r.addEventListener('pointermove', function (ev) { var s = scaleX(), i = nearest((ev.clientX - s.b.left) / s.k); if (i !== cur) at(i, ev.clientY); else inst.tip.move(s.b.left + xs[i] * s.k, ev.clientY); });
    r.addEventListener('pointerleave', off);
    r.addEventListener('focus', function () { var b = r.getBoundingClientRect(); at(cur < 0 ? xs.length - 1 : cur, b.top + b.height / 2); });
    r.addEventListener('blur', off);
    r.addEventListener('keydown', function (ev) {
      var i = cur < 0 ? xs.length - 1 : cur;
      if (ev.key === 'ArrowLeft') i = Math.max(0, i - 1); else if (ev.key === 'ArrowRight') i = Math.min(xs.length - 1, i + 1);
      else if (ev.key === 'Home') i = 0; else if (ev.key === 'End') i = xs.length - 1; else if (ev.key === 'Escape') { off(); return; } else return;
      ev.preventDefault(); var b = r.getBoundingClientRect(); at(i, b.top + b.height / 2);
    });
    svg.appendChild(line); svg.appendChild(r);
    return { at: at, off: off, line: line, rect: r, index: function () { return cur; } };
  }

  /* ====================================================================== fold-filter row (SPEC §2.5) */
  var foldLive = null, foldT = 0; // one polite live region on the fold row (the charts stay silent: six identical announcements otherwise)
  function foldRow() { return doc.getElementById('ct-fold'); }
  function fold() { var f = doc.body.getAttribute('data-ct-fold'); return FOLDS.indexOf(f) >= 0 ? f : 'test'; }
  function applyFoldDom(f) {
    doc.body.setAttribute('data-ct-fold', f);
    var row = foldRow();
    if (row) $$('[role="radio"][data-fold]', row).forEach(function (b) { var on = b.getAttribute('data-fold') === f; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    $$('[data-ct-fold-label]').forEach(function (e) { e.textContent = FOLD_LABEL[f]; });
  }
  function setFold(f) {
    if (FOLDS.indexOf(f) < 0) return false;
    applyFoldDom(f);
    if (foldLive) { clearTimeout(foldT); foldT = setTimeout(function () { foldLive.textContent = 'Showing ' + FOLD_LABEL[f] + ' in the fold-aware charts'; }, 150); }
    doc.dispatchEvent(new CustomEvent('ct:fold', { detail: { fold: f } }));
    return true;
  }
  function initFoldRow() {
    var row = foldRow();
    if (!row) { if (FOLDS.indexOf(doc.body.getAttribute('data-ct-fold')) < 0) doc.body.setAttribute('data-ct-fold', 'test'); return; }
    if (row.hasAttribute('data-ct-ready')) return;
    row.setAttribute('data-ct-ready', '');
    foldLive = el('p', 'vh'); foldLive.setAttribute('aria-live', 'polite'); row.appendChild(foldLive);
    var radios = $$('[role="radio"][data-fold]', row);
    var checked = radios.filter(function (b) { return b.getAttribute('aria-checked') === 'true'; })[0];
    var init = doc.body.getAttribute('data-ct-fold');
    if (FOLDS.indexOf(init) < 0) init = checked ? checked.getAttribute('data-fold') : 'test';
    if (FOLDS.indexOf(init) < 0) init = 'test';
    applyFoldDom(init);
    radios.forEach(function (b, i) {
      b.addEventListener('click', function () { var f = b.getAttribute('data-fold'); if (FOLDS.indexOf(f) < 0) return; if (f !== fold()) setFold(f); else applyFoldDom(f); });
      b.addEventListener('keydown', function (ev) {
        var j = i;
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') j = (i + 1) % radios.length;
        else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') j = (i - 1 + radios.length) % radios.length;
        else if (ev.key === 'Home') j = 0; else if (ev.key === 'End') j = radios.length - 1;
        else if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); b.click(); return; }
        else return;
        ev.preventDefault(); radios[j].focus(); radios[j].click();
      });
    });
  }

  /* ====================================================================== renderer registry (renderers may arrive after boot: wait for ct:renderers, 8 s) */
  var renderers = {}, waiters = [];
  function pokeWaiters() { waiters.slice().forEach(function (w) { w(); }); }
  function register(kind, fn, opts) {
    if (typeof fn !== 'function') throw new Error('register: renderer for ' + kind + ' is not a function');
    renderers[kind] = fn; if (opts && opts.cols) fn.cols = opts.cols;
    pokeWaiters(); return fn;
  }
  function waitRenderer(kind) {
    if (typeof renderers[kind] === 'function') return Promise.resolve(renderers[kind]);
    return new Promise(function (res, rej) {
      var done = false, t = 0;
      function finish() { done = true; clearTimeout(t); var i = waiters.indexOf(check); if (i >= 0) waiters.splice(i, 1); }
      function check() { if (done) return; var f = renderers[kind]; if (typeof f === 'function') { finish(); res(f); } }
      t = setTimeout(function () { if (done) return; finish(); rej(new Error(kind + ': renderer missing')); }, RENDERER_WAIT_MS);
      waiters.push(check);
    });
  }
  doc.addEventListener('ct:renderers', pokeWaiters);

  /* ====================================================================== table/1 validation (schema, n, every column has n entries, meta.series shape) */
  function validate(o, kind) {
    if (!o || typeof o !== 'object') throw new Error(kind + ': payload missing');
    if (o.schema !== 'table/1') throw new Error(kind + ': schema table/1 missing');
    var n = o.n; if (!isNum(n) || n < 0 || Math.floor(n) !== n) throw new Error(kind + ': n missing');
    if (!o.cols || typeof o.cols !== 'object') throw new Error(kind + ': cols missing');
    for (var k in o.cols) { var c = o.cols[k]; if (!Array.isArray(c)) throw new Error(kind + ': column ' + k + ' missing'); if (c.length !== n) throw new Error(kind + ': column ' + k + ' length ' + c.length + ' ≠ ' + n); }
    if (o.meta != null && typeof o.meta !== 'object') throw new Error(kind + ': meta missing');
    if (!o.meta) o.meta = {};
    if (o.meta.series != null) {
      if (!Array.isArray(o.meta.series)) throw new Error(kind + ': meta.series missing');
      o.meta.series.forEach(function (s, i) { if (!s || s.key == null || s.label == null) throw new Error(kind + ': meta.series[' + i + '] key or label missing'); });
    }
    return o;
  }
  function checkCols(o, fn, kind) { (fn.cols || []).forEach(function (c) { if (!o.cols[c]) throw new Error(kind + ': column ' + c + ' missing'); }); }

  /* ====================================================================== CtChart widget */
  var instances = new Map(), pageHl = null; // the key last highlighted page-wide (ct:highlight), cleared by Escape in any chart
  function ensureChild(body, cls, after) { var e = $('.' + cls, body); if (e) return e; e = el('div', cls); if (after && after.nextSibling) body.insertBefore(e, after.nextSibling); else if (after) body.appendChild(e); else body.insertBefore(e, body.firstChild); return e; }
  function CtChart(root) {
    var self = this;
    this.root = root; this.mode = root.getAttribute('data-mode') || 'full'; this.hero = this.mode === 'hero'; this.sync = root.getAttribute('data-sync') || null;
    this.kind = root.getAttribute('data-ct') || ''; this.src = root.getAttribute('data-src') || ''; this.foldMode = root.getAttribute('data-fold') === 'filter' ? 'filter' : 'none';
    this.data = null; this.renderer = null; this.state = {}; this.util = util; this.st = { t: 0 };
    this.fold = fold(); this.W = 0; this.height = 0; this.svg = null; this.hatchId = null; this.error = null;
    this.isolated = null; this.hl = null; this.ready = false; this.dead = false; this.renders = 0;
    this._swapT = 0; this._annT = 0; this._unsub = []; this.ro = null;
    root.classList.add('pj-w', 'is-js', 'ct-chart'); root.setAttribute('data-mode', this.mode);
    if (!root.hasAttribute('role')) root.setAttribute('role', 'group');
    if (!root.hasAttribute('aria-label')) root.setAttribute('aria-label', root.getAttribute('data-label') || (this.kind ? this.kind + ' chart' : 'chart'));
    if (!this.hero && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '0');
    var body = $('.pj-w__body', root);
    if (!body) { body = el('div', 'pj-w__body'); var fb = $('.pj-fallback', root); if (fb) root.insertBefore(body, fb); else root.appendChild(body); }
    this.body = body;
    this.ctl = ensureChild(body, 'ct-ctl', null); this.ctl.setAttribute('data-ct-ctl', '');
    var plot = $('.ct-plot', body); if (!plot) { plot = el('div', 'pj-plot ct-plot'); body.insertBefore(plot, this.ctl.nextSibling); } this.plot = plot;
    var legend = $('.ct-legend', body); if (!legend) { legend = el('p', 'pj-legend ct-legend'); body.insertBefore(legend, plot.nextSibling); } this.legend = legend;
    var note = $('.ct-note', body); if (!note) { note = el('p', 'ct-note'); body.insertBefore(note, legend.nextSibling); } this.note = note;
    this.live = el('p', 'vh'); this.live.setAttribute('aria-live', 'polite'); root.appendChild(this.live);
    if (!this.hero) { this.twin = el('details', 'pj-twin'); this.twin.appendChild(el('summary', null, 'Data as text')); this.twinBody = el('div'); this.twin.appendChild(this.twinBody); root.appendChild(this.twin); }
    else { this.twin = null; this.twinBody = null; }
    this.tip = new Tip(this);
    instances.set(root, this);
    root.addEventListener('keydown', function (ev) { // Escape: hide the tooltip, clear isolation, clear the (page-wide) highlight
      if (ev.key !== 'Escape') return; self.tip.hide();
      if (self.isolated != null) self.isolate(null);
      if (self.hl != null || pageHl != null) { self.highlight(null); self.emitHighlight(null); }
    });
    if (!root.hasAttribute('aria-description')) root.setAttribute('aria-description', 'Interactive chart: Tab reaches its values, the arrow keys move between them, Escape hides the readout; every value is also in the table under Data as text.');
  }
  CtChart.prototype.name = 'ct-chart';
  CtChart.prototype.start = function () {
    var self = this;
    if (!this.kind || KINDS.indexOf(this.kind) < 0) throw new Error('unknown chart');
    if (!this.src) throw new Error(this.kind + ': data-src missing');
    this.root.classList.add('is-loading');
    Promise.all([Proj.load(this.src, 'table').then(function (o) { return validate(o, self.kind); }), waitRenderer(this.kind)])
      .then(function (r) { if (self.dead) return; self.data = r[0]; self.renderer = r[1]; checkCols(self.data, self.renderer, self.kind); self.wire(); self.draw(); self.ok(); })
      .catch(function (e) { self.fail(e); });
  };
  CtChart.prototype.wire = function () {
    var self = this;
    var onResize = debounce(function () { if (self.dead || !self.ready) return; var w = self.plot.clientWidth; if (w > 0 && Math.abs(w - self.W) >= 1) self.render(); }, RESIZE_MS);
    if ('ResizeObserver' in win) { this.ro = new ResizeObserver(onResize); this.ro.observe(this.plot); }
    else { win.addEventListener('resize', onResize); this._unsub.push(function () { win.removeEventListener('resize', onResize); }); }
    if (this.foldMode === 'filter') {
      var onFold = function () { if (self.dead) return; if (!self.root.isConnected) { self.destroy(); return; } self.swap(); };
      doc.addEventListener('ct:fold', onFold); this._unsub.push(function () { doc.removeEventListener('ct:fold', onFold); });
    }
    var onHl = function (ev) { if (self.dead || !self.ready) return; var d = ev.detail || {}, k = d.key; pageHl = k == null ? null : String(k); if (d.from === self.root) return; self.highlight(k != null && self.hasKey(k) ? k : null); };
    doc.addEventListener('ct:highlight', onHl); this._unsub.push(function () { doc.removeEventListener('ct:highlight', onHl); });
  };
  CtChart.prototype.render = function () { // public: safe re-render (controls, resize, fold); a renderer error routes to fail()
    if (this.dead || !this.renderer || !this.data) return;
    try { this.draw(); } catch (e) { this.fail(e); }
  };
  CtChart.prototype.draw = function () {
    var self = this, plot = this.plot, W = plot.clientWidth;
    if (!(W > 0)) W = this.W > 0 ? this.W : 720;
    this.W = W; this.fold = fold();
    var out = this.renderer(this, W);
    if (!out || !isNum(out.height) || typeof out.draw !== 'function') throw new Error(this.kind + ': renderer must return { height, draw }');
    var H = Math.max(24, Math.round(out.height));
    Array.prototype.slice.call(plot.children).forEach(function (k) { if (!k.classList.contains('ct-tip')) plot.removeChild(k); });
    this.tip.hide();
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, 'aria-label': this.root.getAttribute('data-label') || this.kind });
    var pid = nextId('ct-hatch'); svg.appendChild(hatchDefs(pid)); this.hatchId = pid;
    plot.insertBefore(svg, this.tip.el && this.tip.el.parentNode === plot ? this.tip.el : null);
    this.svg = svg; this.height = H;
    out.draw(svg);
    $$('.ct-hatch', svg).forEach(function (e) { e.style.fill = 'url(#' + pid + ')'; });
    var hits = $$('.ct-hit[tabindex="0"]', svg); // roving tabindex: one tab stop per chart, arrow keys walk the marks (a crosshair rect keeps its own ←/→ and preventDefaults them)
    hits.forEach(function (h, i) { if (i) h.setAttribute('tabindex', '-1'); });
    if (hits.length > 1) svg.addEventListener('keydown', function (ev) {
      if (ev.defaultPrevented) return; var i = hits.indexOf(ev.target); if (i < 0) return;
      var j = (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') ? i + 1 : (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') ? i - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? hits.length - 1 : -1;
      if (j < 0 || j >= hits.length) return; ev.preventDefault(); hits[i].tabIndex = -1; hits[j].tabIndex = 0; hits[j].focus();
    });
    this.renderLegend(out.legend); this.renderNote(out.note); this.renderTwin(out.twin);
    this.applyEmphasis();
    if (this.renders === 0 && !reduced()) { // one 600 ms ease-out draw-in on the first render
      svg.style.opacity = '0'; svg.style.transition = 'opacity ' + DRAW_MS + 'ms var(--ease-out)';
      requestAnimationFrame(function () { requestAnimationFrame(function () { svg.style.opacity = '1'; }); });
      setTimeout(function () { if (self.svg === svg) svg.style.transition = ''; }, DRAW_MS + 50);
    }
    this.renders++; this.root.setAttribute('data-ct-renders', String(this.renders));
  };
  CtChart.prototype.swap = function () { // fold change: hold the previous render at 50 % while swapping; no layout jump (height follows the data shape)
    if (!this.ready || this.dead) return; // a chart whose first draw failed keeps its fallback; the fold row announces the switch once for the page
    var self = this, plot = this.plot; clearTimeout(this._swapT);
    if (reduced()) { this.render(); return; }
    var prevH = this.height; plot.classList.add('is-swapping');
    this._swapT = setTimeout(function () {
      if (self.dead) return; self.render();
      if (self.height !== prevH) dbg('ct-chart', self.kind, 'height changed on fold swap:', prevH, '→', self.height);
      self._swapT = setTimeout(function () { plot.classList.remove('is-swapping'); }, SWAP_MS);
    }, SWAP_HOLD_MS);
  };
  CtChart.prototype.renderLegend = function (entries) { // entries in meta.series order: {key, label, slot, style, marker, hollow, color, swatch, hatch, note}
    var self = this, lg = this.legend; clear(lg);
    if (!entries || !entries.length) { lg.hidden = true; return; }
    lg.hidden = false;
    entries.forEach(function (en) {
      if (en == null) return; if (typeof en === 'string') en = { label: en, note: true };
      var key = en.key != null ? String(en.key) : (!en.note && (en.slot != null || en.marker || en.color) ? String(en.label) : null);
      var interactive = !en.note && key != null;
      var node = el(interactive ? 'button' : 'span', 'ct-key' + (en.note ? ' ct-key--note' : ''));
      if (interactive) { node.type = 'button'; node.setAttribute('data-key', key); node.setAttribute('aria-pressed', self.isolated === key ? 'true' : 'false'); }
      else node.style.cursor = 'default';
      if (!en.note) node.appendChild(keySvg(en.style || (en.marker ? 'none' : 'online'), en.slot, en.marker, { hollow: en.hollow, color: en.color, swatch: en.swatch, hatch: en.hatch }));
      node.appendChild(el('span', null, en.label == null ? '' : en.label));
      if (interactive) {
        node.addEventListener('mouseenter', function () { self.highlight(key); });
        node.addEventListener('mouseleave', function () { self.highlight(null); });
        node.addEventListener('focus', function () { self.highlight(key); });
        node.addEventListener('blur', function () { self.highlight(null); });
        node.addEventListener('click', function () { self.isolate(self.isolated === key ? null : key); });
      }
      lg.appendChild(node);
    });
  };
  CtChart.prototype.renderNote = function (note) { var n = this.note; clear(n); if (note == null || note === '') return; n.textContent = Array.isArray(note) ? note.join(' ') : String(note); };
  CtChart.prototype.renderTwin = function (tw) { // {head:[…], rows:[[…]], caption, n, foot, rowHead}; one row per data row of every fold for fold-filtered charts
    var tb = this.twinBody; if (!tb) return; clear(tb); if (!tw) return;
    var table = el('table'); table.style.fontVariantNumeric = 'tabular-nums';
    if (tw.caption) table.appendChild(el('caption', null, tw.caption));
    if (tw.head && tw.head.length) {
      var thead = el('thead'), tr0 = el('tr');
      tw.head.forEach(function (h) { var th = el('th', null, h == null ? '' : h); th.setAttribute('scope', 'col'); tr0.appendChild(th); });
      thead.appendChild(tr0); table.appendChild(thead);
    }
    var tbody = el('tbody'), numRx = /^[\u2212+\-]?[\d,]+(\.\d+)?/;
    (tw.rows || []).forEach(function (r) {
      var tr = el('tr');
      (r || []).forEach(function (c, j) {
        var head = j === 0 && tw.rowHead, cell = el(head ? 'th' : 'td', null, c == null ? '—' : c);
        if (head) cell.setAttribute('scope', 'row');
        if (isNum(c) || (typeof c === 'string' && numRx.test(c))) cell.style.textAlign = 'right';
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); tb.appendChild(table);
    var meta = (this.data && this.data.meta) || {}, bits = [];
    if (tw.n != null) bits.push('n = ' + (isNum(tw.n) ? fmt.int(tw.n) : String(tw.n))); else if (this.data && isNum(this.data.n)) bits.push(fmt.int(this.data.n) + ' rows');
    if (meta.source) bits.push('source: ' + meta.source); if (meta.benchmark) bits.push(meta.benchmark); if (tw.foot) bits.push(tw.foot);
    if (bits.length) tb.appendChild(el('p', null, bits.join(' · ')));
    if ((tw.rows || []).length > 400) dbg('ct-chart', this.kind, 'twin has', tw.rows.length, 'rows');
  };
  CtChart.prototype.active = function () { return this.isolated != null ? this.isolated : this.hl; };
  CtChart.prototype.applyEmphasis = function () { // elements carrying data-key (outermost only) dim to 25 % unless they are the active series
    var self = this, a = this.active(), svg = this.svg;
    if (svg) $$('[data-key]', svg).forEach(function (e) { var p = e.parentNode; if (p && p !== svg && p.closest && p.closest('[data-key]')) return; e.classList.toggle('is-dim', a != null && e.getAttribute('data-key') !== a); });
    $$('.ct-key[data-key]', this.legend).forEach(function (b) { b.setAttribute('aria-pressed', self.isolated != null && b.getAttribute('data-key') === self.isolated ? 'true' : 'false'); });
  };
  CtChart.prototype.isolate = function (key) { this.isolated = key == null ? null : String(key); this.applyEmphasis(); };
  CtChart.prototype.highlight = function (key) { this.hl = key == null ? null : String(key); this.applyEmphasis(); };
  CtChart.prototype.hasKey = function (key) {
    key = String(key);
    if (series(this.data).some(function (s) { return String(s.key) === key; })) return true;
    return !!(this.svg && this.svg.querySelector('[data-key="' + cssEscape(key) + '"]'));
  };
  CtChart.prototype.emitHighlight = function (key) { doc.dispatchEvent(new CustomEvent('ct:highlight', { detail: { key: key == null ? null : String(key), from: this.root } })); };
  CtChart.prototype.lift = function (target) { // hovered mark lifts: elements with class ct-lift other than the target go to .6 for 120 ms
    var svg = this.svg; if (!svg) return; var items = $$('.ct-lift', svg); if (!items.length) return;
    items.forEach(function (e) {
      if (!reduced() && !e.style.transition) e.style.transition = 'opacity ' + LIFT_MS + 'ms';
      var inside = !!target && (e === target || (target.contains && target.contains(e)) || (e.contains && e.contains(target)));
      e.style.opacity = target ? (inside ? '1' : '0.6') : '';
    });
  };
  CtChart.prototype.control = function (name, spec) { // idempotent chip group in .ct-ctl (never the fold); returns the current value; on change: spec.onChange(v) or render()
    var self = this, st = this.state, wrap = $('[data-ctl="' + cssEscape(name) + '"]', this.ctl), opts = spec.options || [];
    if (st[name] == null) st[name] = spec.value != null ? spec.value : (opts[0] ? opts[0].value : null);
    var radio = spec.role !== 'tablist';
    if (!wrap) {
      wrap = el('div', 'ct-ctl__group'); wrap.setAttribute('data-ctl', name); wrap.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px';
      if (spec.label) wrap.appendChild(el('span', 'ct-ctl__lbl', spec.label));
      var grp = el('div', 'chips'); grp.setAttribute('role', radio ? 'radiogroup' : 'tablist'); if (spec.label) grp.setAttribute('aria-label', spec.label);
      opts.forEach(function (o) {
        var b = el('button', 'chip chip--sm', o.label); b.type = 'button'; b.setAttribute('role', radio ? 'radio' : 'tab'); b.setAttribute('data-value', String(o.value)); if (o.title) b.title = o.title;
        b.addEventListener('click', function () { if (String(st[name]) === String(o.value)) return; st[name] = o.value; self.syncControl(name); if (spec.onChange) spec.onChange(o.value); else self.render(); });
        b.addEventListener('keydown', function (ev) {
          var bs = $$('button', grp), j = bs.indexOf(b);
          if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') j = (j + 1) % bs.length; else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') j = (j - 1 + bs.length) % bs.length;
          else if (ev.key === 'Home') j = 0; else if (ev.key === 'End') j = bs.length - 1; else return;
          ev.preventDefault(); bs[j].focus(); bs[j].click();
        });
        grp.appendChild(b);
      });
      wrap.appendChild(grp); this.ctl.appendChild(wrap);
    }
    this.syncControl(name);
    return st[name];
  };
  CtChart.prototype.syncControl = function (name) {
    var wrap = $('[data-ctl="' + cssEscape(name) + '"]', this.ctl); if (!wrap) return; var v = String(this.state[name]);
    $$('button', wrap).forEach(function (b) { var on = b.getAttribute('data-value') === v; b.setAttribute(b.getAttribute('role') === 'radio' ? 'aria-checked' : 'aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
  };
  CtChart.prototype.ok = function () {
    this.ready = true; this.error = null;
    this.root.classList.remove('is-loading', 'is-error'); this.root.classList.add('is-live');
    var e = $('.pj-w__err', this.root); if (e) e.remove(); if (this.twin) this.twin.hidden = false;
    doc.dispatchEvent(new CustomEvent('pj:ready', { detail: { el: this.root, widget: this.name } }));
  };
  CtChart.prototype.fail = function (err) {
    dbg(this.name, 'failed:', err && err.message); this.error = err || null;
    this.root.classList.remove('is-loading', 'is-live'); this.root.classList.add('is-error');
    if (!$('.pj-w__err', this.root)) { var e = el('p', 'pj-w__err', 'Data unavailable — showing the static figure.'); e.setAttribute('role', 'note'); this.root.appendChild(e); }
    if (this.twin) this.twin.hidden = true; this.tip.hide(); this.plot.classList.remove('is-swapping');
  };
  CtChart.prototype.announce = function (msg) { var self = this; clearTimeout(this._annT); this._annT = setTimeout(function () { if (self.live) self.live.textContent = msg; }, 150); };
  CtChart.prototype.onVisibility = function () { this.tip.hide(); };
  CtChart.prototype.setFold = function (f) { return setFold(f); };
  CtChart.prototype.destroy = function () { this.dead = true; if (this.ro) { this.ro.disconnect(); this.ro = null; } this._unsub.forEach(function (u) { u(); }); this._unsub = []; clearTimeout(this._swapT); instances.delete(this.root); };

  /* ====================================================================== public surfaces */
  var util = {
    color: color, dash: dash, marker: marker, keySvg: keySvg, hatchDefs: hatchDefs,
    fmt: fmt, num: num, log: log, lin: lin, ticksLog: ticksLog, ticksLin: ticksLin,
    tip: function (inst) { return inst.tip || (inst.tip = new Tip(inst)); }, ariaText: ariaText,
    svg: svgEl, attrs: setAttrs, el: el, text: text, pathD: pathD, barD: barD, textWidth: textWidth, spread: spread,
    rows: rows, series: series, seriesMap: seriesMap, panels: panels, xyHeight: xyHeight, rowsHeight: rowsHeight,
    axisX: axisX, axisY: axisY, hit: hit, crosshair: crosshair,
    clamp: clamp, isNum: isNum, debounce: debounce, uid: nextId, reduced: reduced,
    fold: fold, foldLabel: fmt.fold, foldShort: fmt.foldShort, FOLDS: FOLDS, KINDS: KINDS, DASH: DASH
  };
  CT.charts = {
    version: VERSION, fold: fold, setFold: setFold, FOLDS: FOLDS, KINDS: KINDS,
    instances: instances, get: function (root) { return instances.get(root); },
    renderers: renderers, register: register, util: util, CtChart: CtChart
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', initFoldRow); else initFoldRow();
  Proj.register('ct-chart', CtChart);
  Proj.bootAll(doc);
})(window, document);
