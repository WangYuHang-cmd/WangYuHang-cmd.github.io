/* CANTraj page · chart renderers, signals group (WP-D2): "robust" (V09 degraded-input sweep), "gains" (V11 signal-set study),
   "cost" (V12 cost against accuracy). Registered on CT.charts (charts.js); each renderer is render(inst, W) → { height, draw, legend, twin, note }.
   Colours only through the --ct-* custom properties; text in text tokens; the core owns the first-render draw-in and the fold swap; the only
   durations here are the 120–160 ms hover and fold-emphasis transitions (none under reduced motion). */
(function (win, doc) {
  'use strict';
  if (!win.CT || !win.CT.charts || typeof win.CT.charts.register !== 'function') return;
  var NS = 'http://www.w3.org/2000/svg', MINUS = '−';
  var reduced = function () { return !!(win.Proj && win.Proj.reduced && win.Proj.reduced()); };

  /* ------------------------------------------------------------------ helpers */
  function S(tag, attrs, parent) { var e = doc.createElementNS(NS, tag); if (attrs) for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function T(parent, x, y, s, cls, anchor, dy) { var t = S('text', { x: x, y: y, 'text-anchor': anchor || 'start', dy: dy || '.35em' }, parent); if (cls) t.setAttribute('class', cls); t.textContent = s; return t; }
  function H(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function rowsOf(d) { var out = [], c = d.cols, keys = Object.keys(c); for (var i = 0; i < d.n; i++) { var o = {}; for (var k = 0; k < keys.length; k++) o[keys[k]] = c[keys[k]][i]; out.push(o); } return out; }
  function need(d, key, cols) { if (!d || d.schema !== 'table/1' || !d.cols || typeof d.n !== 'number') throw new Error(key + ': table/1 shape missing'); for (var i = 0; i < cols.length; i++) { var a = d.cols[cols[i]]; if (!Array.isArray(a)) throw new Error(key + ': column ' + cols[i] + ' missing'); if (a.length !== d.n) throw new Error(key + ': column ' + cols[i] + ' length ' + a.length + ' ≠ n'); } }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function neg(s) { return String(s).replace(/-/g, MINUS); }
  function thousands(v) { return Math.round(v).toLocaleString('en-US'); }
  function fmtM(v) { if (!isNum(v)) return 'no output'; var a = Math.abs(v); return neg((a >= 10 ? thousands(v) : v.toFixed(1)) + ' m'); }
  function fmtMd(v) { if (!isNum(v)) return 'no output'; var a = Math.abs(v); return neg(a >= 10 ? thousands(v) : v.toFixed(1)); }
  function fmtPct(v, dp) { if (!isNum(v)) return '—'; return neg((dp ? (v * 100).toFixed(dp) : String(Math.round(v * 100)))) + ' %'; }
  function fmtPp(v, dp) { if (!isNum(v)) return '—'; return (v < 0 ? MINUS : '+') + Math.abs(v).toFixed(dp == null ? 1 : dp) + ' pp'; }
  function fmtS(v) { if (!isNum(v)) return '—'; return v < 1 ? Math.round(v * 1000) + ' ms' : (v < 10 ? v.toFixed(2) : v.toFixed(1)) + ' s'; }
  function ci(lo, hi, f) { return '[' + f(lo) + ', ' + f(hi) + ']'; }
  function colorOf(inst, slot) { var u = inst.util; if (u && typeof u.color === 'function') { try { var c = u.color(slot); if (c) return c; } catch (e) { /* fall through */ } } return slot === 0 || slot == null ? 'var(--ct-mute)' : 'var(--ct-s' + slot + ')'; }
  var MONO = 'var(--ct-mono)';
  function logScale(d, r) { var a = Math.log(d[0]), b = Math.log(d[1]); var f = function (v) { return r[0] + (Math.log(v) - a) / (b - a) * (r[1] - r[0]); }; f.invert = function (p) { return Math.exp(a + (p - r[0]) / (r[1] - r[0]) * (b - a)); }; f.domain = d; return f; }
  function linScale(d, r) { var f = function (v) { return r[0] + (v - d[0]) / (d[1] - d[0]) * (r[1] - r[0]); }; f.invert = function (p) { return d[0] + (p - r[0]) / (r[1] - r[0]) * (d[1] - d[0]); }; f.domain = d; return f; }
  var LOG_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  function ticksLog(d) { return LOG_STEPS.filter(function (v) { return v >= d[0] * 0.999 && v <= d[1] * 1.001; }); }
  function isDecade(v) { var l = Math.log10(v); return Math.abs(l - Math.round(l)) < 1e-9; }
  function lblM(v) { return v >= 1000 ? (v / 1000) + ' km' : v + ' m'; }
  function lblS(v) { return v >= 1 ? v + ' s' : Math.round(v * 1000) + ' ms'; }
  /* markers (§2.2): circle r 4.5 · square 9 · tri-up/down 10 · diamond 10 · cross 10 / 2 px; filled = series fill + 2 px surface ring (CSS .ct-mark), hollow = surface fill + 2 px series stroke */
  function marker(parent, shape, x, y, color, hollow) {
    var e;
    if (shape === 'square') e = S('rect', { x: x - 4.5, y: y - 4.5, width: 9, height: 9, rx: 1 });
    else if (shape === 'diamond') e = S('path', { d: 'M' + x + ' ' + (y - 5.5) + 'L' + (x + 5.5) + ' ' + y + 'L' + x + ' ' + (y + 5.5) + 'L' + (x - 5.5) + ' ' + y + 'Z' });
    else if (shape === 'tri-up') e = S('path', { d: 'M' + x + ' ' + (y - 5.5) + 'L' + (x + 5.5) + ' ' + (y + 4.5) + 'L' + (x - 5.5) + ' ' + (y + 4.5) + 'Z' });
    else if (shape === 'tri-down') e = S('path', { d: 'M' + x + ' ' + (y + 5.5) + 'L' + (x + 5.5) + ' ' + (y - 4.5) + 'L' + (x - 5.5) + ' ' + (y - 4.5) + 'Z' });
    else if (shape === 'cross') { // stroke-only mark: a 4 px surface-coloured cross beneath gives the ring
      var g = S('g', null, parent), d = 'M' + (x - 5) + ' ' + (y - 5) + 'L' + (x + 5) + ' ' + (y + 5) + 'M' + (x - 5) + ' ' + (y + 5) + 'L' + (x + 5) + ' ' + (y - 5);
      var ring = S('path', { d: d, fill: 'none', 'stroke-width': 5, 'stroke-linecap': 'round' }, g); ring.style.stroke = 'var(--ct-surface)';
      var p = S('path', { d: d, fill: 'none', 'stroke-width': 2, 'stroke-linecap': 'round' }, g); p.style.stroke = color; return g;
    } else e = S('circle', { cx: x, cy: y, r: 4.5 });
    e.setAttribute('class', hollow ? 'ct-mark ct-mark--hollow' : 'ct-mark');
    if (hollow) e.style.stroke = color; else e.style.fill = color;
    parent.appendChild(e); return e;
  }
  /* tooltip plumbing: per-mark focusable hit rects (keyboard) + nearest-mark pointer search on a panel-wide layer (≥ 24 px reach) */
  function hitRect(parent, x, y, w, h, label) { var r = S('rect', { 'class': 'ct-hit', x: x, y: y, width: w, height: h, tabindex: '0', role: 'img' }, parent); r.setAttribute('aria-label', label); return r; }
  function tipText(spec) { return (spec.title ? spec.title + ': ' : '') + spec.rows.map(function (r) { return (r.value == null ? 'no output' : r.value) + ' ' + (r.label || ''); }).join('; '); }
  function lift(marks, on) { for (var i = 0; i < marks.length; i++) { var el = marks[i].node; if (!el) continue; el.style.transition = reduced() ? 'none' : 'opacity 120ms'; el.style.opacity = on == null ? '' : (marks[i] === on ? '1' : '.6'); } }
  function wire(inst, svg, layer, marks, toClient) {
    // marks: [{x, y, node, spec, hit}] in svg user units; layer: the pointer-catching rect; toClient maps svg units → client px via the svg box
    var cur = null;
    function show(m, cx, cy) { cur = m; inst.tip.show(cx, cy, m.spec); lift(marks, m); }
    function hide() { cur = null; inst.tip.hide(); lift(marks, null); }
    function nearest(px, py) { var best = null, bd = 24 * 24; for (var i = 0; i < marks.length; i++) { var dx = marks[i].x - px, dy = marks[i].y - py, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = marks[i]; } } return best; }
    layer.addEventListener('pointermove', function (ev) { var p = toClient.inv(ev.clientX, ev.clientY), m = nearest(p[0], p[1]); if (!m) { if (cur) hide(); return; } if (m !== cur) { var c = toClient.fwd(m.x, m.y); show(m, c[0], c[1]); } });
    layer.addEventListener('pointerleave', function () { hide(); });
    marks.forEach(function (m) { if (!m.hit) return; m.hit.addEventListener('focus', function () { var c = toClient.fwd(m.x, m.y); show(m, c[0], c[1]); }); m.hit.addEventListener('blur', hide); m.hit.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { hide(); m.hit.blur(); } }); });
    svg.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') hide(); });
  }
  function mapper(svg) { // svg user units ↔ client px (viewBox is in CSS px, width 100 %, so the ratio is the rendered scale)
    return { fwd: function (x, y) { var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, k = r.width / (vb.width || r.width); return [r.left + x * k, r.top + y * k]; },
             inv: function (cx, cy) { var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, k = r.width / (vb.width || r.width); return [(cx - r.left) / k, (cy - r.top) / k]; } };
  }
  function foldLabel(f) { return f === 'few_shot_heldout' ? 'few-shot drivers' : 'test drivers'; }
  function seriesOf(d, rows, fields) { // meta.series when present, else derived from the rows in first-appearance order
    if (d.meta && Array.isArray(d.meta.series) && d.meta.series.length) return d.meta.series.slice();
    var seen = {}, out = []; rows.forEach(function (r) { if (seen[r.key]) return; seen[r.key] = 1; var o = {}; fields.forEach(function (f) { o[f] = r[f]; }); out.push(o); }); return out;
  }
  function textW(s, px) { return String(s).length * (px || 11) * 0.56; } // Inter at 11 px ≈ 6.2 px per glyph

  /* ================================================================== V09 · robust (degraded-input sweep) */
  var ROBUST_COLS = ['panel', 'stem', 'fold', 'tag', 'tag_label', 'tag_order', 'probe', 'perturbation', 'route_diff_pp', 'lo_pp', 'hi_pp', 'route_clean', 'route_pert', 'median_clean', 'median_pert', 'n_expected', 'key', 'label', 'slot', 'marker'];
  var PANEL_TITLE = { steer: 'steering signal degraded', speed: 'speed signal degraded' };
  function groupOf(tag) { if (/^sq|^pq/.test(tag)) return 'quantised to'; if (/hz$/.test(tag)) return 'sampled at'; if (/^sn/.test(tag)) return 'offset noise'; if (/^sd/.test(tag)) return 'timing probe'; return ''; }
  function robustNote(rows) {
    var mild = rows.filter(function (r) { return r.tag === 'sq10' || r.tag === 'sn5' || r.tag === 's1hz'; }), mx = 0; mild.forEach(function (r) { mx = Math.max(mx, Math.abs(r.route_diff_pp)); });
    var pq1 = rows.filter(function (r) { return r.tag === 'pq1'; }), inc0 = pq1.length > 0 && pq1.every(function (r) { return r.lo_pp <= 0 && r.hi_pp >= 0; }), pq1max = 0; pq1.forEach(function (r) { pq1max = Math.max(pq1max, Math.abs(r.route_diff_pp)); });
    var harsh = rows.filter(function (r) { return (r.tag === 'pq5' || r.tag === 's02hz') && r.stem !== 'map_beam_none__G1'; }), mn = 1; harsh.forEach(function (r) { mn = Math.min(mn, r.route_pert); });
    var s = 'Filled marks: test drivers; hollow: few-shot drivers (the fold switch dims the other group). ';
    if (mild.length) s += 'Mild steering levels (10°, ±5°, 1 Hz) change route recovery by at most ' + mx.toFixed(1) + ' points; ';
    if (pq1.length) s += inc0 ? 'speed quantised to 1 m/s changes no route rate measurably (every interval includes 0); ' : 'speed quantised to 1 m/s changes route rates by at most ' + pq1max.toFixed(1) + ' points; ';
    if (harsh.length) s += 'at the harshest levels (speed 5 m/s, steering 0.2 Hz) the speed + steering attacks still recover ' + (mn * 100).toFixed(1) + ' % or more of the routes.';
    return s;
  }
  function renderRobust(inst, W) {
    var d = inst.data; need(d, 'robust', ROBUST_COLS);
    var rows = rowsOf(d), meta = d.meta || {}, fold = inst.fold || 'test';
    var series = seriesOf(d, rows, ['key', 'label', 'slot', 'style', 'marker']);
    var order = meta.tag_order || { steer: [], speed: [] }, yDom = meta.y_domain || [-11, 4];
    var panels = ['steer', 'speed'].map(function (p) {
      var pr = rows.filter(function (r) { return r.panel === p; }); if (!pr.length) return null;
      var tags = (order[p] && order[p].length ? order[p] : []).slice(); pr.forEach(function (r) { if (tags.indexOf(r.tag) < 0) tags.push(r.tag); });
      tags = tags.filter(function (t) { return pr.some(function (r) { return r.tag === t; }); });
      var keys = series.map(function (s) { return s.key; }).filter(function (k) { return pr.some(function (r) { return r.key === k; }); });
      return { id: p, rows: pr, tags: tags, keys: keys, labels: tags.map(function (t) { var r = pr.filter(function (x) { return x.tag === t; })[0]; return { tag: t, label: r.tag_label, probe: !!r.probe, group: groupOf(t) }; }) };
    }).filter(Boolean);
    var colLayout = W >= 560, L = 44, R = 12, titleH = 22, marks = [];
    var geom = panels.map(function (p) {
      var nS = p.keys.length;
      if (colLayout) { var plotH = clamp(Math.round(W * 0.2), 170, 230); return { p: p, plotH: plotH, axisH: 40, h: titleH + plotH + 40 + 10 }; }
      var rowH = nS * 2 * 9 + 12; return { p: p, rowH: rowH, plotH: rowH * p.tags.length, axisH: 38, h: titleH + rowH * p.tags.length + 38 + 10 };
    });
    var height = geom.reduce(function (a, g) { return a + g.h; }, 0) + 6;
    function draw(svg) {
      var root = S('g', null, svg), y0 = 4, tip = [];
      geom.forEach(function (G) {
        var p = G.p, g = S('g', null, root), top = y0 + titleH, left = colLayout ? L : 118, width = W - left - R;
        T(g, left, y0 + 8, PANEL_TITLE[p.id] || p.id, 'ct-title');
        if (colLayout) T(g, left + textW(PANEL_TITLE[p.id] || p.id, 12) + 10, y0 + 8, '· change in five-minute route recovery, percentage points', 'ct-lbl--dim');
        else T(g, left + width / 2, top + G.plotH + 28, 'change in five-minute route recovery (pp)', 'ct-lbl--dim', 'middle').setAttribute('font-size', '10');
        var nS = p.keys.length, nL = p.tags.length;
        var val = colLayout ? linScale(yDom, [top + G.plotH, top]) : linScale(yDom, [left, left + width]);
        var lev = colLayout ? function (i) { return left + (i + 0.5) * width / nL; } : function (i) { return top + (i + 0.5) * G.rowH; };
        var levW = colLayout ? width / nL : G.rowH;
        var gapS = colLayout ? clamp(levW / (nS + 0.5), 16, 30) : 18, foldOff = colLayout ? clamp(gapS * 0.22, 3.5, 6.5) : 4.5;
        // grid + ticks (hairline solid), zero line in ink
        var ticks = [-10, -7.5, -5, -2.5, 0, 2.5, 5].filter(function (v) { return v >= yDom[0] && v <= yDom[1]; });
        ticks.forEach(function (v) {
          var pos = val(v), isZ = v === 0, cls = isZ ? 'ct-zero' : 'ct-grid';
          if (colLayout) { S('line', { 'class': cls, x1: left, x2: left + width, y1: pos, y2: pos }, g); T(g, left - 8, pos, (v > 0 ? '+' : '') + neg(String(v)), null, 'end'); }
          else { S('line', { 'class': cls, y1: top, y2: top + G.plotH, x1: pos, x2: pos }, g); T(g, pos, top + G.plotH + 14, (v > 0 ? '+' : '') + neg(String(v)) + (v === ticks[ticks.length - 1] ? ' pp' : ''), null, 'middle'); }
        });
        if (colLayout) T(g, left - 8, top - 2, 'pp', 'ct-lbl--dim', 'end', '0');
        // level labels, group captions, probe separator
        var lastGroup = null, gStart = 0;
        p.labels.forEach(function (lb, i) {
          var c = lev(i);
          if (colLayout) { T(g, c, top + G.plotH + 14, lb.label, 'ct-lbl', 'middle'); }
          else { var t = T(g, left - 8, c, lb.label, 'ct-lbl', 'end'); if (lb.group) T(g, left - 8, c + 13, lb.group, 'ct-lbl--dim', 'end').setAttribute('font-size', '10'); }
          if (lb.probe) { var sep = colLayout ? lev(i) - levW / 2 : lev(i) - levW / 2; if (colLayout) S('line', { 'class': 'ct-grid', x1: sep, x2: sep, y1: top, y2: top + G.plotH + 30 }, g); else S('line', { 'class': 'ct-grid', y1: sep, y2: sep, x1: left - 110, x2: left + width }, g); }
          if (colLayout && (lb.group !== lastGroup || i === p.labels.length - 1)) {
            if (lastGroup != null && lastGroup !== lb.group) { T(g, (lev(gStart) + lev(i - 1)) / 2, top + G.plotH + 30, lastGroup, 'ct-lbl--dim', 'middle').setAttribute('font-size', '10'); gStart = i; }
            if (i === p.labels.length - 1) { var from = lb.group === lastGroup ? gStart : i; T(g, (lev(from) + lev(i)) / 2, top + G.plotH + 30, lb.group, 'ct-lbl--dim', 'middle').setAttribute('font-size', '10'); }
            lastGroup = lb.group; if (i === 0) gStart = 0;
          } else if (colLayout && i === 0) { lastGroup = lb.group; gStart = 0; }
        });
        // marks: per level → per series → per fold (test filled, few-shot hollow); other fold dimmed to 35 %
        var hitG = S('g', null, g), map = mapper(svg);
        p.keys.forEach(function (key, si) {
          var sMeta = series.filter(function (s) { return s.key === key; })[0] || {}, col = colorOf(inst, sMeta.slot), sg = S('g', { 'data-key': key }, g), cS = (si - (nS - 1) / 2) * gapS;
          var perLevel = {}; // tag → one keyboard target covering both folds (≥ 24 px; the pointer layer keeps per-mark readouts)
          ['test', 'few_shot_heldout'].forEach(function (f, fi) {
            var fg = S('g', { 'data-fold': f }, sg); fg.style.transition = reduced() ? 'none' : 'opacity 160ms'; fg.style.opacity = f === fold ? '1' : '.35';
            p.rows.filter(function (r) { return r.key === key && r.fold === f; }).forEach(function (r) {
              var li = p.tags.indexOf(r.tag); if (li < 0) return; var off = cS + (fi ? foldOff : -foldOff), a = lev(li) + off, v = clamp(r.route_diff_pp, yDom[0], yDom[1]), lo = clamp(r.lo_pp, yDom[0], yDom[1]), hi = clamp(r.hi_pp, yDom[0], yDom[1]);
              var mg = S('g', null, fg), cl, x, y;
              if (colLayout) { cl = S('line', { 'class': 'ct-ci', x1: a, x2: a, y1: val(lo), y2: val(hi) }, mg); S('line', { 'class': 'ct-ci', x1: a - 2, x2: a + 2, y1: val(lo), y2: val(lo) }, mg).style.stroke = col; S('line', { 'class': 'ct-ci', x1: a - 2, x2: a + 2, y1: val(hi), y2: val(hi) }, mg).style.stroke = col; x = a; y = val(v); }
              else { cl = S('line', { 'class': 'ct-ci', y1: a, y2: a, x1: val(lo), x2: val(hi) }, mg); S('line', { 'class': 'ct-ci', y1: a - 2, y2: a + 2, x1: val(lo), x2: val(lo) }, mg).style.stroke = col; S('line', { 'class': 'ct-ci', y1: a - 2, y2: a + 2, x1: val(hi), x2: val(hi) }, mg).style.stroke = col; x = val(v); y = a; }
              cl.style.stroke = col; marker(mg, r.marker || sMeta.marker || 'circle', x, y, col, f === 'few_shot_heldout');
              var spec = { title: r.label + ' · ' + r.perturbation + ' · ' + foldLabel(f), rows: [
                { value: fmtPp(r.route_diff_pp) + ' ' + ci(r.lo_pp, r.hi_pp, function (v) { return fmtPp(v).replace(' pp', ''); }), label: 'change in route recovery · 95 % CI', slot: sMeta.slot, style: sMeta.style },
                { value: fmtPct(r.route_clean, 1) + ' → ' + fmtPct(r.route_pert, 1), label: 'route recovered, clean → degraded' },
                { value: fmtM(r.median_clean) + ' → ' + fmtM(r.median_pert), label: 'median ADE, clean → degraded' },
                { value: thousands(r.n_expected), label: 'windows' }] };
              tip.push({ x: x, y: y, node: mg, spec: spec, hit: null });
              var Lv = perLevel[r.tag] || (perLevel[r.tag] = { a: [], lo: Infinity, hi: -Infinity, rows: [], title: r.label + ' · ' + r.perturbation, cx: 0, cy: 0 });
              Lv.a.push(a); Lv.lo = Math.min(Lv.lo, val(lo), val(hi), val(v)); Lv.hi = Math.max(Lv.hi, val(lo), val(hi), val(v)); Lv.cx += x / 2; Lv.cy += y / 2;
              Lv.rows.push({ value: fmtPp(r.route_diff_pp) + ' ' + ci(r.lo_pp, r.hi_pp, function (q) { return fmtPp(q).replace(' pp', ''); }), label: foldLabel(f) + ' · route ' + fmtPct(r.route_clean, 1) + ' → ' + fmtPct(r.route_pert, 1), slot: sMeta.slot, style: sMeta.style, marker: r.marker || sMeta.marker || 'circle', hollow: f === 'few_shot_heldout' });
            });
          });
          Object.keys(perLevel).forEach(function (tag) {
            var Lv = perLevel[tag], spec = { title: Lv.title, rows: Lv.rows }, ca = Lv.a.reduce(function (s2, q) { return s2 + q; }, 0) / Lv.a.length, hr;
            if (colLayout) hr = hitRect(hitG, ca - 12, Math.min(Lv.lo, ca ? Lv.lo : Lv.lo) - 4, 24, Math.max(24, Lv.hi - Lv.lo + 8), tipText(spec));
            else hr = hitRect(hitG, Lv.lo - 12, ca - 12, Math.max(24, Lv.hi - Lv.lo + 24), 24, tipText(spec));
            hr.addEventListener('focus', function () { var c = map.fwd(Lv.cx, Lv.cy); inst.tip.show(c[0], c[1], spec); });
            hr.addEventListener('blur', function () { inst.tip.hide(); });
            hr.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { inst.tip.hide(); hr.blur(); } });
          });
        });
        var layer = S('rect', { 'class': 'ct-hit', x: 0, y: y0, width: W, height: G.h }, g); layer.removeAttribute('tabindex'); layer.style.cursor = 'crosshair'; g.insertBefore(layer, g.firstChild);
        wire(inst, svg, layer, tip.slice(), mapper(svg));
        y0 += G.h;
      });
    }
    var legend = series.map(function (s) { return { key: s.key, label: s.label, slot: s.slot, style: s.style || null, marker: s.marker || 'circle', hollow: false }; });
    legend.push({ label: 'filled: test drivers · hollow: few-shot drivers', note: true }); // text-only legend entry (core: {note:true} renders without a key and without emphasis)
    var twin = { caption: 'Change in five-minute route recovery under degraded inputs (percentage points, 95 % driver-clustered CI), both folds.',
      head: ['panel', 'level', 'degradation', 'method', 'fold', 'windows', 'route clean', 'route degraded', 'Δ pp [95 % CI]', 'median ADE clean', 'median ADE degraded'],
      rows: rows.map(function (r) { return [PANEL_TITLE[r.panel] || r.panel, r.tag_label, r.perturbation, r.label, foldLabel(r.fold), thousands(r.n_expected), fmtPct(r.route_clean, 1), fmtPct(r.route_pert, 1), fmtPp(r.route_diff_pp) + ' ' + ci(r.lo_pp, r.hi_pp, function (v) { return fmtPp(v).replace(' pp', ''); }), fmtM(r.median_clean), fmtM(r.median_pert)]; }) };
    return { height: height, draw: draw, legend: legend, twin: twin, note: robustNote(rows) };
  }

  /* ================================================================== V11 · gains (signal-set study) */
  var GAINS_COLS = ['setting', 'comparison', 'row_label', 'row_order', 'a', 'b', 'seed', 'n', 'n_drivers', 'median', 'median_lo', 'median_hi', 'mean', 'mean_lo', 'mean_hi', 'win_a'];
  function renderGains(inst, W) {
    var d = inst.data; need(d, 'gains', GAINS_COLS);
    var rows = rowsOf(d), meta = d.meta || {}, sets = Array.isArray(meta.sets) ? meta.sets : [], xd = meta.x_domain || {};
    var settings = ['map', 'no map'].filter(function (s) { return rows.some(function (r) { return r.setting === s; }); });
    var labels = []; rows.slice().sort(function (a, b) { return a.row_order - b.row_order; }).forEach(function (r) { if (!labels.some(function (l) { return l.order === r.row_order; })) labels.push({ order: r.row_order, label: r.row_label }); });
    var nR = labels.length, rowH = 30, side = W >= 720, labW = side ? 190 : 150, titleH = 22, axisH = side ? 34 : 46, R = 10, setRow = 32;
    var panelH = titleH + nR * rowH + axisH, setsH = titleH + 16 + sets.length * setRow + 8;
    var height = side ? Math.max(panelH, setsH) + 8 : panelH * settings.length + (sets.length ? setsH + 8 : 0) + 8;
    function domainFor(s) { var dm = xd[s]; if (Array.isArray(dm) && dm.length === 2) return dm; var lo = 0, hi = 0; rows.filter(function (r) { return r.setting === s; }).forEach(function (r) { lo = Math.min(lo, r.median_lo); hi = Math.max(hi, r.median_hi); }); return [Math.floor(lo / 50) * 50 - 20, Math.ceil(hi / 50) * 50 + 20]; }
    function ticksLin(dm) { var span = dm[1] - dm[0], step = span > 600 ? 200 : span > 250 ? 100 : 50, out = []; for (var v = Math.ceil(dm[0] / step) * step; v <= dm[1]; v += step) out.push(v); return out; }
    function draw(svg) {
      var root = S('g', null, svg), marks = [], map = mapper(svg);
      var setsW = side && sets.length ? clamp(Math.round(W * 0.26), 200, 300) : 0, avail = W - setsW - (side ? 24 : 0), panelW = side ? (avail - labW) / settings.length : W - labW - R;
      settings.forEach(function (s, pi) {
        var left = side ? labW + pi * panelW : labW, top = side ? 0 : pi * panelH, width = side ? panelW - 16 : panelW, g = S('g', null, root), dm = domainFor(s), x = linScale(dm, [left, left + width]);
        T(g, left, top + 8, s === 'map' ? 'with the road map' : 'without a map', 'ct-title');
        ticksLin(dm).forEach(function (v) { var px = x(v); S('line', { 'class': v === 0 ? 'ct-zero' : 'ct-grid', x1: px, x2: px, y1: top + titleH, y2: top + titleH + nR * rowH }, g); T(g, px, top + titleH + nR * rowH + 14, neg(String(v)), null, 'middle'); });
        if (!side) { T(g, left + width, top + titleH + nR * rowH + 27, 'paired median difference in five-minute ADE (m)', 'ct-lbl--dim', 'end').setAttribute('font-size', '10'); T(g, left + width, top + titleH + nR * rowH + 38, 'negative = lower error with the added signal', 'ct-lbl--dim', 'end').setAttribute('font-size', '10'); }
        else if (pi === settings.length - 1) T(g, left + width, top + titleH + nR * rowH + 28, 'paired median difference in five-minute ADE (m) · negative = lower error with the added signal', 'ct-lbl--dim', 'end').setAttribute('font-size', '10');
        if (pi === 0 || !side) labels.forEach(function (lb, i) { var cy = top + titleH + (i + 0.5) * rowH; var tx = T(g, (side ? labW : labW) - 10, cy, lb.label, 'ct-lbl', 'end'); if (lb.label.length * 6.2 > labW - 14) { tx.textContent = ''; var parts = lb.label.split(' added to '); T(g, labW - 10, cy - 6, parts[0] + ' added to', 'ct-lbl', 'end'); T(g, labW - 10, cy + 7, parts[1] || '', 'ct-lbl', 'end'); } });
        labels.forEach(function (lb, i) { if (i) S('line', { 'class': 'ct-grid', x1: side && pi === 0 ? 8 : left - (side ? 0 : labW - 8), x2: left + width, y1: top + titleH + i * rowH, y2: top + titleH + i * rowH }, g).style.opacity = '.6'; });
        var hitG = S('g', null, g);
        labels.forEach(function (lb, i) {
          var rr = rows.filter(function (r) { return r.setting === s && r.row_order === lb.order; }).sort(function (a, b) { return a.seed - b.seed; }), cy = top + titleH + (i + 0.5) * rowH;
          var rowSpec = { title: lb.label + ' · ' + (s === 'map' ? 'with the map' : 'without a map'), rows: [] }, xlo = Infinity, xhi = -Infinity;
          rr.forEach(function (r, k) {
            var off = rr.length > 1 ? (k - (rr.length - 1) / 2) * 5 : 0, y = cy + off, inc0 = r.median_lo <= 0 && r.median_hi >= 0, mg = S('g', null, g);
            var lo = clamp(r.median_lo, dm[0], dm[1]), hi = clamp(r.median_hi, dm[0], dm[1]), v = clamp(r.median, dm[0], dm[1]);
            var l = S('line', { 'class': 'ct-ci', x1: x(lo), x2: x(hi), y1: y, y2: y }, mg); l.style.stroke = MONO;
            S('line', { 'class': 'ct-ci', x1: x(lo), x2: x(lo), y1: y - 2, y2: y + 2 }, mg).style.stroke = MONO; S('line', { 'class': 'ct-ci', x1: x(hi), x2: x(hi), y1: y - 2, y2: y + 2 }, mg).style.stroke = MONO;
            if (r.median_lo < dm[0]) T(g, x(dm[0]) - 1, y, '‹', 'ct-lbl--dim', 'end'); if (r.median_hi > dm[1]) T(g, x(dm[1]) + 1, y, '›', 'ct-lbl--dim', 'start');
            marker(mg, 'circle', x(v), y, MONO, inc0);
            var spec = { title: lb.label + ' · ' + (s === 'map' ? 'with the map' : 'without a map') + ' · seed ' + r.seed + ' (' + r.a + ' vs ' + r.b + ')', rows: [
              { value: fmtM(r.median) + ' ' + ci(r.median_lo, r.median_hi, fmtMd), label: 'paired median difference · 95 % CI' + (inc0 ? ' · includes 0: no clear evidence either way' : '') },
              { value: fmtM(r.mean) + ' ' + ci(r.mean_lo, r.mean_hi, fmtMd), label: 'paired mean difference · 95 % CI' },
              { value: fmtPct(r.win_a), label: 'share of windows improved by the added signal' },
              { value: thousands(r.n) + ' · ' + r.n_drivers, label: 'windows · drivers' }] };
            marks.push({ x: x(v), y: y, node: mg, spec: spec, hit: null });
            rowSpec.rows.push({ value: fmtM(r.median) + ' ' + ci(r.median_lo, r.median_hi, fmtMd), label: 'seed ' + r.seed + (inc0 ? ' · includes 0: no clear evidence either way' : '') + ' · ' + fmtPct(r.win_a) + ' of windows improved', hollow: inc0, marker: 'circle', color: MONO });
            xlo = Math.min(xlo, x(lo), x(v)); xhi = Math.max(xhi, x(hi), x(v));
          });
          if (rr.length) { // one 24 px keyboard target per row (the pointer layer keeps the per-seed readout)
            var hr = hitRect(hitG, xlo - 12, cy - 12, Math.max(24, xhi - xlo + 24), 24, tipText(rowSpec));
            hr.addEventListener('focus', function () { var c = map.fwd((xlo + xhi) / 2, cy); inst.tip.show(c[0], c[1], rowSpec); });
            hr.addEventListener('blur', function () { inst.tip.hide(); });
            hr.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { inst.tip.hide(); hr.blur(); } });
          }
        });
        var layer = S('rect', { 'class': 'ct-hit', x: side ? (pi === 0 ? 0 : left) : 0, y: top, width: side ? (pi === 0 ? left + width : width) : W, height: panelH }, g); layer.removeAttribute('tabindex'); g.insertBefore(layer, g.firstChild);
        wire(inst, svg, layer, marks.slice(), map);
      });
      if (sets.length) { // third panel: seed-mean median ADE per signal set, with the map (single hue, 14 px bars, set label above each bar, value at the tip)
        var sLeft = side ? W - setsW + 8 : 0, sTop = side ? 0 : settings.length * panelH + 8, sg = S('g', null, root), sWidth = (side ? setsW - 8 : W) - R, mx = 0;
        sets.forEach(function (st) { mx = Math.max(mx, st.median_m || 0); }); var sx = linScale([0, Math.ceil(mx / 100) * 100 || 100], [sLeft, sLeft + sWidth - 52]);
        T(sg, sLeft, sTop + 8, 'median ADE per signal set', 'ct-title'); T(sg, sLeft, sTop + 22, 'with the map · seed mean · ' + (rows[0] ? thousands(rows[0].n) + ' windows' : ''), 'ct-lbl--dim').setAttribute('font-size', '10');
        var smarks = [], sHit = S('g', null, sg);
        sets.forEach(function (st, i) {
          var y = sTop + titleH + 16 + i * setRow, by = y + 13, w = Math.max(0, sx(st.median_m) - sx(0)), mg = S('g', null, sg);
          T(sg, sLeft, y + 4, st.set + ' · ' + st.label, 'ct-lbl');
          var p = S('path', { d: 'M' + sx(0) + ' ' + by + 'h' + Math.max(0, w - 4) + 'a4 4 0 0 1 4 4v6a4 4 0 0 1 -4 4h' + (-Math.max(0, w - 4)) + 'z' }, mg); p.style.fill = MONO;
          T(sg, sx(0) + w + 6, by + 7, fmtM(st.median_m), 'ct-lbl');
          var spec = { title: 'signal set ' + st.set + ' · ' + st.label + ' · with the map', rows: [
            { value: fmtM(st.median_m), label: 'median five-minute ADE, mean over seeds' },
            { value: (st.seeds || []).map(fmtMd).join(' / ') + ' m', label: 'per training seed' },
            { value: (st.route || []).map(function (v) { return fmtPct(v); }).join(' / '), label: 'route recovered per seed' }] };
          var hit = hitRect(sHit, sx(0) - 2, by - 5, Math.max(24, w + 4), 24, tipText(spec)); smarks.push({ x: sx(0) + w, y: by + 7, node: mg, spec: spec, hit: hit });
        });
        S('line', { 'class': 'ct-axis', x1: sx(0), x2: sx(0), y1: sTop + titleH + 12, y2: sTop + titleH + 16 + sets.length * setRow }, sg);
        var sLayer = S('rect', { 'class': 'ct-hit', x: sLeft, y: sTop, width: sWidth, height: setsH }, sg); sLayer.removeAttribute('tabindex'); sg.insertBefore(sLayer, sg.firstChild);
        wire(inst, svg, sLayer, smarks, mapper(svg));
      }
    }
    var twinRows = rows.map(function (r) { var inc0 = r.median_lo <= 0 && r.median_hi >= 0; return [r.setting === 'map' ? 'with the map' : 'without a map', r.row_label, String(r.seed), thousands(r.n), String(r.n_drivers), fmtM(r.median) + ' ' + ci(r.median_lo, r.median_hi, fmtMd), inc0 ? 'includes 0' : 'excludes 0', fmtM(r.mean) + ' ' + ci(r.mean_lo, r.mean_hi, fmtMd), fmtPct(r.win_a)]; });
    sets.forEach(function (st) { twinRows.push(['with the map', 'signal set ' + st.set + ' · ' + st.label + ' (median ADE, seed mean)', (st.seeds || []).map(fmtMd).join(' / '), rows[0] ? thousands(rows[0].n) : '', rows[0] ? String(rows[0].n_drivers) : '', fmtM(st.median_m), '—', '—', (st.route || []).map(function (v) { return fmtPct(v); }).join(' / ')]); });
    var twin = { caption: 'Signal-set study: paired median difference in five-minute ADE when one signal is added, per training seed; then the median ADE per signal set with the map.',
      head: ['setting', 'comparison', 'seed', 'windows', 'drivers', 'median difference [95 % CI]', 'interval', 'mean difference [95 % CI]', 'windows improved'], rows: twinRows };
    var note = (meta.rule || 'a 95 % interval that includes 0 is no clear evidence either way') + ' · hollow dot: the interval includes 0 · one dot per training seed, a single seed for the pressed-flag rows';
    return { height: height, draw: draw, legend: null, twin: twin, note: note };
  }

  /* ================================================================== V12 · cost (cost against accuracy) */
  var COST_COLS = ['tag', 'stem', 'key', 'label', 'slot', 'style', 'marker', 'protocol', 'subset', 'infer_median_s', 'infer_p90_s', 'n_w05', 'n_fail_w05', 'ade_median', 'route', 'peak_rss_gb', 'graph_build_s', 'hollow', 'pinned_top'];
  /* direct-label priority by §2.2 identity key (the caption-named methods first); meta.label_priority from the export overrides it */
  var COST_PRIORITY = ['beam', 'pf', 'opd2', 'spy_area', 'beam_b50', 'pf_n500', 'ct_area', 'macro', 'pf_gru', 'ep_hp', 'beam_speed', 'pf_speed', 'gru', 'dr_steer', 'straight', 'dewri_hp', 'spy_hp', 'spy', 'ep', 'dewri'];
  var FAMILY = { 1: 'speed-only methods', 2: 'speed + steering methods' }; // the two benchmark families of §2.2; published identities take their label from meta.series
  function commonPrefix(labels) { if (!labels.length) return ''; var p = labels[0]; labels.forEach(function (s) { var i = 0; while (i < p.length && i < s.length && p[i] === s[i]) i++; p = p.slice(0, i); }); return p.replace(/[\s(,·:]+$/, ''); }
  function familyLabel(slot, rr, meta) { // legend label of a colour family: meta.series labels' common prefix for published identities, the §2.2 family name for the benchmark slots
    var ser = (meta && Array.isArray(meta.series) ? meta.series : rr).filter(function (s) { return s.slot === slot; }), labels = ser.map(function (s) { return String(s.label); });
    if (FAMILY[slot] && !ser.some(function (s) { return s.style === 'pub'; })) return FAMILY[slot];
    var p = commonPrefix(labels); return p.length >= 3 ? p : (labels[0] || String(slot));
  }
  function costControls(inst) {
    inst.state.metric = inst.state.metric || 'ade'; var ctl = inst.ctl; if (!ctl || ctl.querySelector('[data-metric]')) return; /* idempotent: rebuilt only if the core emptied .ct-ctl */
    var lbl = H('span', 'ct-ctl__lbl', 'Vertical axis'); ctl.appendChild(lbl); var grp = H('div', 'chips'); grp.setAttribute('role', 'radiogroup'); grp.setAttribute('aria-label', 'Accuracy measure on the vertical axis'); ctl.appendChild(grp);
    [['ade', 'median ADE'], ['route', 'route recovered']].forEach(function (o) { var b = H('button', 'chip chip--sm', o[1]); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(inst.state.metric === o[0])); b.setAttribute('data-metric', o[0]);
      b.addEventListener('click', function () { if (inst.state.metric === o[0]) return; inst.state.metric = o[0]; Array.prototype.forEach.call(grp.querySelectorAll('[role="radio"]'), function (x) { x.setAttribute('aria-checked', String(x.getAttribute('data-metric') === o[0])); }); inst.render(); });
      b.addEventListener('keydown', function (ev) { if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') { ev.preventDefault(); var bs = Array.prototype.slice.call(grp.querySelectorAll('[role="radio"]')), j = (bs.indexOf(b) + (ev.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length; bs[j].focus(); bs[j].click(); } });
      grp.appendChild(b); });
  }
  function costChips(inst, chips) {
    var plot = inst.plot || inst.root.querySelector('.ct-plot'); if (!plot || !plot.parentNode) return;
    var box = inst.root.querySelector('.ct-chips'); if (!box) { box = H('div', 'ct-chips'); var after = inst.note && inst.note.parentNode === plot.parentNode ? inst.note : (inst.legend && inst.legend.parentNode === plot.parentNode ? inst.legend : plot); plot.parentNode.insertBefore(box, after.nextSibling); } // plot → legend → note → chips
    while (box.firstChild) box.removeChild(box.firstChild); (chips || []).forEach(function (c) { var ch = H('div', 'ct-chip'); ch.appendChild(H('b', null, c.value)); ch.appendChild(H('span', null, c.label + (c.detail ? ' · ' + c.detail : ''))); box.appendChild(ch); });
  }
  function renderCost(inst, W) {
    var d = inst.data; need(d, 'cost', COST_COLS);
    var rows = rowsOf(d), meta = d.meta || {}; costControls(inst); costChips(inst, meta.chips);
    var metric = inst.state.metric || 'ade', xd = meta.x_domain || [0.004, 10], yd = meta.y_domain || [10, 5000];
    var height = clamp(Math.round(0.56 * W), 260, 420), L = 46, R = 14, TOP = 22, BOT = 40, withValue = W >= 600;
    function draw(svg) {
      var root = S('g', null, svg), g = S('g', null, root), x = logScale(xd, [L, W - R]), y = metric === 'ade' ? logScale(yd, [height - BOT, TOP]) : linScale([0, 1], [height - BOT, TOP]);
      // grid and ticks: hairline at the decades, short ticks at the 2/5 steps; log labels 10 ms / 100 ms / 1 s / 10 s, 10 m / 100 m / 1 km (+ top)
      ticksLog(xd).forEach(function (v) { var px = x(v); if (isDecade(v)) { S('line', { 'class': 'ct-grid', x1: px, x2: px, y1: TOP, y2: height - BOT }, g); T(g, px, height - BOT + 14, lblS(v), null, 'middle'); } else S('line', { 'class': 'ct-axis', x1: px, x2: px, y1: height - BOT, y2: height - BOT + 4 }, g); });
      S('line', { 'class': 'ct-axis', x1: L, x2: W - R, y1: height - BOT, y2: height - BOT }, g);
      var xt = W < 480 ? 'inference time per window (log)' : 'median single-worker inference time per five-minute window (log)';
      if (textW(xt, 10) > W - R - L) T(g, L, height - 8, xt, 'ct-lbl--dim', 'start').setAttribute('font-size', '10'); else T(g, W - R, height - 8, xt, 'ct-lbl--dim', 'end').setAttribute('font-size', '10');
      if (metric === 'ade') { ticksLog(yd).forEach(function (v) { var py = y(v); if (isDecade(v) || v === yd[1]) { S('line', { 'class': 'ct-grid', x1: L, x2: W - R, y1: py, y2: py }, g); T(g, L - 8, py, lblM(v), null, 'end'); } else S('line', { 'class': 'ct-axis', x1: L - 4, x2: L, y1: py, y2: py }, g); }); T(g, 2, TOP - 12, 'median ADE (log)', 'ct-lbl--dim', 'start', '0').setAttribute('font-size', '10'); }
      else { [0, 0.25, 0.5, 0.75, 1].forEach(function (v) { var py = y(v); S('line', { 'class': 'ct-grid', x1: L, x2: W - R, y1: py, y2: py }, g); T(g, L - 8, py, Math.round(v * 100) + ' %', null, 'end'); }); T(g, 2, TOP - 12, 'route recovered', 'ct-lbl--dim', 'start', '0').setAttribute('font-size', '10'); }
      // points
      var pts = rows.map(function (r) {
        var px = x(clamp(r.infer_median_s, xd[0], xd[1])), py, pinned = false;
        if (metric === 'ade') { if (!isNum(r.ade_median)) { py = TOP; pinned = true; } else py = y(clamp(r.ade_median, yd[0], yd[1])); }
        else py = y(clamp(isNum(r.route) ? r.route : 0, 0, 1));
        return { r: r, x: px, y: py, pinned: pinned, color: colorOf(inst, r.slot), shape: r.marker || 'circle' };
      });
      var byFam = {}; pts.forEach(function (p) { var k = 'slot:' + p.r.slot; byFam[k] = byFam[k] || S('g', { 'data-key': k }, g); });
      var marks = [], hitG = S('g', null, g);
      pts.forEach(function (p) {
        var r = p.r, mg = S('g', null, byFam['slot:' + r.slot]); marker(mg, p.shape, p.x, p.y, p.color, !!r.hollow);
        var spec = { title: r.label + ' · ' + r.protocol, rows: [
          { value: fmtS(r.infer_median_s) + ' · p90 ' + fmtS(r.infer_p90_s), label: 'median inference time per window', slot: r.slot, style: r.style },
          { value: isNum(r.ade_median) ? fmtM(r.ade_median) : 'no finite median', label: 'median five-minute ADE' },
          { value: fmtPct(r.route), label: 'route recovered' },
          { value: r.n_fail_w05 + ' of ' + r.n_w05, label: 'windows without output' },
          { value: isNum(r.peak_rss_gb) ? r.peak_rss_gb.toFixed(2) + ' GB' : '—', label: 'peak memory' },
          { value: isNum(r.graph_build_s) ? r.graph_build_s.toFixed(1) + ' s' : '—', label: 'road graph build per drive (median)' },
          { value: r.subset, label: 'subset' }] };
        var hit = hitRect(hitG, p.x - 12, p.y - 12, 24, 24, tipText(spec)); marks.push({ x: p.x, y: p.y, node: mg, spec: spec, hit: hit });
      });
      // direct labels: priority order, greedy placement against marks, placed labels and the plot box; leader line when displaced; dropped when nothing fits
      var boxes = pts.map(function (p) { return [p.x - 7, p.y - 7, p.x + 7, p.y + 7]; }), lg = S('g', null, g);
      function fits(b) { if (b[0] < 2 || b[2] > W - 2 || b[1] < 2 || b[3] > height - BOT + 2) return false; for (var i = 0; i < boxes.length; i++) { var o = boxes[i]; if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return false; } return true; }
      var prio = Array.isArray(meta.label_priority) && meta.label_priority.length ? meta.label_priority : COST_PRIORITY;
      var ordered = pts.slice().sort(function (a, b) { var ia = prio.indexOf(a.r.key), ib = prio.indexOf(b.r.key); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
      ordered.forEach(function (p) {
        var r = p.r, val = metric === 'ade' ? (isNum(r.ade_median) ? fmtM(r.ade_median) : 'no finite median · ' + r.n_fail_w05 + ' of ' + r.n_w05 + ' without output') : fmtPct(r.route);
        var text = p.pinned ? (withValue ? 'CAN-Trace (area) · ' + val : 'CAN-Trace (area)') : (withValue ? r.label + ' · ' + val : r.label), tw = textW(text), th = 13;
        var cands = [[10, 0, 'start'], [-10, 0, 'end'], [0, -12, 'middle'], [0, 13, 'middle'], [14, -12, 'start'], [14, 12, 'start'], [-14, -12, 'end'], [-14, 12, 'end'], [22, -22, 'start'], [-22, -22, 'end'], [22, 22, 'start'], [-22, 22, 'end'], [0, -30, 'middle'], [0, 30, 'middle'], [40, -34, 'start'], [-40, -34, 'end'], [40, 34, 'start'], [-40, 34, 'end']];
        for (var i = 0; i < cands.length; i++) {
          var c = cands[i], lx = p.x + c[0], ly = p.y + c[1], b = c[2] === 'start' ? [lx, ly - th / 2, lx + tw, ly + th / 2] : c[2] === 'end' ? [lx - tw, ly - th / 2, lx, ly + th / 2] : [lx - tw / 2, ly - th / 2, lx + tw / 2, ly + th / 2];
          if (!fits(b)) continue;
          boxes.push(b); T(lg, lx, ly, text, 'ct-lbl', c[2]);
          if (i >= 2) { var ex = c[2] === 'start' ? b[0] - 2 : c[2] === 'end' ? b[2] + 2 : lx, ey = c[2] === 'middle' ? (c[1] < 0 ? b[3] + 1 : b[1] - 1) : ly; var ld = S('line', { x1: p.x + (ex > p.x ? 7 : ex < p.x ? -7 : 0), y1: p.y + (c[2] === 'middle' ? (c[1] < 0 ? -7 : 7) : 0), x2: ex, y2: ey, 'stroke-width': 1 }, lg); ld.style.stroke = 'var(--cl-text-mute)'; ld.style.opacity = '.7'; }
          break;
        }
      });
      var layer = S('rect', { 'class': 'ct-hit', x: 0, y: 0, width: W, height: height }, g); layer.removeAttribute('tabindex'); g.insertBefore(layer, g.firstChild);
      wire(inst, svg, layer, marks, mapper(svg));
    }
    var slots = []; rows.forEach(function (r) { if (slots.indexOf(r.slot) < 0) slots.push(r.slot); }); slots.sort(function (a, b) { return a - b; });
    var legend = slots.map(function (s) { var rr = rows.filter(function (r) { return r.slot === s; }), pub = rr.filter(function (r) { return r.style === 'pub'; })[0]; return { key: 'slot:' + s, label: familyLabel(s, rr, meta), slot: s, style: null, marker: pub ? (pub.marker || 'circle') : 'circle', hollow: false }; });
    var twin = { caption: 'Cost against accuracy on the validation subset: median single-worker inference time per five-minute window, median ADE and route recovery per method.',
      head: ['method', 'protocol', 'subset', 'median time', 'p90 time', 'windows', 'without output', 'median ADE', 'route recovered', 'peak memory', 'graph build per drive'],
      rows: rows.map(function (r) { return [r.label, r.protocol, r.subset, fmtS(r.infer_median_s), fmtS(r.infer_p90_s), String(r.n_w05), String(r.n_fail_w05), isNum(r.ade_median) ? fmtM(r.ade_median) : 'no finite median', fmtPct(r.route), isNum(r.peak_rss_gb) ? r.peak_rss_gb.toFixed(2) + ' GB' : '—', isNum(r.graph_build_s) ? r.graph_build_s.toFixed(1) + ' s' : '—']; }) };
    var note = (meta.note || '') + (meta.note ? ' · ' : '') + 'hollow mark: some windows without output · colour: method identity as elsewhere on the page · a label dropped for lack of room is in the tooltip and the table';
    return { height: height, draw: draw, legend: legend, twin: twin, note: note };
  }

  CT.charts.register('robust', renderRobust, { cols: ROBUST_COLS });
  CT.charts.register('gains', renderGains, { cols: GAINS_COLS });
  CT.charts.register('cost', renderCost, { cols: COST_COLS });
  doc.dispatchEvent(new CustomEvent('ct:renderers'));
  if (win.Proj && typeof win.Proj.bootAll === 'function') win.Proj.bootAll(doc);
})(window, document);
