/* CANTraj page · charts-failures.js — renderers for the failures and agent group: "topk" (V10a), "taxonomy" (V10b), "agent" (V13),
   "density" (V14) and "confidence" (V16). Plugs into the CtChart core (static/charts.js):
     CT.charts.register(kind, function render(inst, W) → { height, draw(svg), legend, twin, note })
   The core owns the chrome, data loading, the tooltip element, legend / note / twin rendering, fold swapping, resize and the first-render
   draw-in; this file only lays out and draws. Colours come solely from the --ct-* custom properties (series colour = var(--ct-sN) from the
   slot column, the ordinal ramp --ct-ord-1/2/3 and --ct-mute for the taxonomy parts, --ct-mono for the single-series agent chart); text
   wears text tokens. 2 px lines, markers ≥ 8 px with a 2 px surface ring, 2 px CI bars with 4 px end caps, hairline solid grid, hit targets
   ≥ 24 px (keyboard-reachable, aria-label = tooltip text), a crosshair with one tooltip on the top-K line chart, per-mark tooltips on
   dots / bars / segments / points, selective direct labels, no dual axis, reduced motion honoured. Identity (key, label, slot, style,
   marker) comes from the table/1 columns written by the export; nothing here hard-codes a method name or an identifier. */
(function (win, doc) {
  'use strict';
  var CT = win.CT;
  if (!CT || !CT.charts || typeof CT.charts.register !== 'function') return;
  var Proj = win.Proj || null;
  var NS = 'http://www.w3.org/2000/svg';
  var MINUS = '−', NBSP = ' ';
  var DASH = { online: '', offline: '7 4', nomap: '1.5 4.5', pub: '9 3 2 3', lineage: '9 3 2 3 2 3' };
  var FOLD_LABEL = { test: 'test drivers', few_shot_heldout: 'few-shot drivers' };
  var FOLD_SHORT = { test: 'test', few_shot_heldout: 'few-shot' };
  var LIFT_MS = 120;

  /* ================================================================== helpers: DOM */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function svgEl(tag, attrs) {
    var e = doc.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) { var v = attrs[k]; if (v == null) continue; if (k === 'fill' || k === 'stroke') e.style[k] = String(v); else e.setAttribute(k, typeof v === 'number' ? String(r1(v)) : String(v)); }
    return e;
  }
  function text(parent, x, y, s, o) {
    o = o || {}; var t = svgEl('text', { x: x, y: y, 'class': o.cls || null, 'text-anchor': o.anchor || null, dy: o.dy || null, 'font-size': o.size || null, 'font-weight': o.weight || null });
    t.textContent = s == null ? '' : String(s); if (parent) parent.appendChild(t); return t;
  }
  function halo(t) { t.style.paintOrder = 'stroke'; t.style.stroke = 'var(--ct-surface)'; t.style.strokeWidth = '3px'; t.style.strokeLinejoin = 'round'; return t; }
  function line(parent, x1, y1, x2, y2, cls, color, width) { var l = svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, 'class': cls || null, 'stroke-width': width || null }); if (color) l.style.stroke = color; if (parent) parent.appendChild(l); return l; }
  function pathD(pts) { var d = '', pen = false; pts.forEach(function (p) { if (!p || !isNum(p[0]) || !isNum(p[1])) { pen = false; return; } d += (pen ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1]); pen = true; }); return d; }
  function roundRight(x, y, w, h, r) { // bar body: square at the baseline (left), 4 px rounded data end (right)
    r = Math.min(r, w / 2, h / 2); if (!(w > 0)) return '';
    return 'M' + r1(x) + ' ' + r1(y) + 'H' + r1(x + w - r) + 'Q' + r1(x + w) + ' ' + r1(y) + ' ' + r1(x + w) + ' ' + r1(y + r) + 'V' + r1(y + h - r) + 'Q' + r1(x + w) + ' ' + r1(y + h) + ' ' + r1(x + w - r) + ' ' + r1(y + h) + 'H' + r1(x) + 'Z';
  }
  function reduced() { try { if (Proj && typeof Proj.reduced === 'function') return !!Proj.reduced(); return win.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return true; } }
  function uniq(a) { var out = []; a.forEach(function (v) { if (out.indexOf(v) < 0) out.push(v); }); return out; }
  function estW(s, px) { // text width estimate (11 px Inter ≈ 0.56 em per character); measured when the svg is live
    s = String(s == null ? '' : s); px = px || 11; var w = 0;
    for (var i = 0; i < s.length; i++) { var c = s[i]; w += /[iljtfI.,·:;'|!\s]/.test(c) ? 0.3 : /[mwMW%]/.test(c) ? 0.85 : /[A-Z]/.test(c) ? 0.68 : /[0-9]/.test(c) ? 0.58 : 0.55; }
    return w * px + 2;
  }
  function measure(svg, s, px) { // real width on the attached svg, estimate otherwise
    if (svg && svg.isConnected) { var t = svgEl('text', { x: -9999, y: -9999, 'font-size': px || null }); t.textContent = String(s == null ? '' : s); svg.appendChild(t); var w = 0; try { w = t.getComputedTextLength(); } catch (e) { w = 0; } svg.removeChild(t); if (w > 0) return w; }
    return estW(s, px);
  }
  function truncate(svg, s, maxPx, px) { s = String(s == null ? '' : s); if (measure(svg, s, px) <= maxPx) return s; while (s.length > 3 && measure(svg, s + '…', px) > maxPx) s = s.slice(0, -1); return s.replace(/[\s,·(]+$/, '') + '…'; }
  function splitLabel(label) { // two lines for the row labels: break at the first ", " when the label is long
    var s = String(label == null ? '' : label), i = s.indexOf(', ');
    if (i < 0 || i > s.length - 3) return [s];
    return [s.slice(0, i + 1), s.slice(i + 2)];
  }
  function spread(ys, gap, lo, hi) { // 1-D label de-collision that keeps order
    var idx = ys.map(function (y, i) { return i; }).sort(function (a, b) { return ys[a] - ys[b]; }), pos = ys.slice(), i, a, b;
    for (i = 1; i < idx.length; i++) { a = idx[i - 1]; b = idx[i]; if (pos[b] - pos[a] < gap) pos[b] = pos[a] + gap; }
    if (hi != null && idx.length) { var last = idx[idx.length - 1]; if (pos[last] > hi) pos[last] = hi; for (i = idx.length - 2; i >= 0; i--) { a = idx[i]; b = idx[i + 1]; if (pos[b] - pos[a] < gap) pos[a] = pos[b] - gap; } }
    if (lo != null && idx.length) { var first = idx[0]; if (pos[first] < lo) pos[first] = lo; for (i = 1; i < idx.length; i++) { a = idx[i - 1]; b = idx[i]; if (pos[b] - pos[a] < gap) pos[b] = pos[a] + gap; } }
    return pos;
  }

  /* ================================================================== helpers: core API with fallbacks (contract names of SPEC §4.7) */
  function util(inst) {
    var u = (inst && inst.util) || CT.charts.util || {}, f = u.fmt || {};
    function pick(fn, fb) { return typeof fn === 'function' ? fn : fb; }
    var num = pick(f.num, function (v, dp) { if (!isNum(v)) return '—'; dp = dp || 0; var p = Math.pow(10, dp), r = Math.round(Math.abs(v) * p) / p; return (v < 0 && r > 0 ? MINUS : '') + r.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }); });
    var mv = function (v) { return isNum(v) ? num(v, Math.abs(v) < 10 ? 1 : 0) : '—'; };
    var m = pick(f.m, function (v) { return isNum(v) ? mv(v) + ' m' : '—'; });
    return {
      color: pick(u.color, function (slot) { if (slot == null || slot === '') return 'var(--ct-mono)'; if (isNum(slot)) return slot === 0 ? 'var(--ct-mute)' : 'var(--ct-s' + slot + ')'; var s = String(slot); return s.indexOf('--') === 0 ? 'var(' + s + ')' : s; }),
      dash: pick(u.dash, function (s) { return DASH[s] || ''; }),
      marker: pick(u.marker, null),
      num: num, mv: mv, m: m,
      int: pick(f.int, function (v) { return num(v, 0); }),
      out: pick(f.out, function (v, g) { return v == null || (typeof v === 'number' && !isFinite(v)) ? 'no output' : (g || m)(v); }),
      pct: pick(f.pct, function (v, dp) { return isNum(v) ? num(v * 100, dp || 0) + NBSP + '%' : '—'; }),
      pct100: pick(f.pct100, function (v, dp) { return isNum(v) ? num(v, dp || 0) + NBSP + '%' : '—'; }),
      pp: pick(f.pp, function (v, dp) { if (!isNum(v)) return '—'; dp = dp == null ? 1 : dp; var r = Math.round(v * Math.pow(10, dp)); return (r > 0 ? '+' : '') + num(v, dp) + ' pp'; }),
      tick: pick(f.tick, function (v) { if (!isNum(v)) return ''; if (Math.abs(v) >= 1000) { var k = v / 1000; return num(k, Math.abs(k - Math.round(k)) > 1e-9 ? 1 : 0) + ' km'; } return num(v, 0) + ' m'; }),
      range: pick(f.range, function (lo, hi, g) { g = g || mv; return '[' + g(lo) + ', ' + g(hi) + ']'; }),
      fold: pick(f.fold, function (x) { return FOLD_LABEL[x] || String(x == null ? '' : x); }),
      foldShort: pick(f.foldShort, function (x) { return FOLD_SHORT[x] || String(x == null ? '' : x); }),
      s1: function (v) { return isNum(v) ? num(v, 1) + ' s' : '—'; }, // serial cost per window, one decimal (0.3 s · 36.4 s · 102.4 s)
      pct0: function (v) { return isNum(v) ? num(v, 0) + NBSP + '%' : '—'; } // already ×100, integer
    };
  }
  function foldOf(inst) { return inst.fold || (typeof CT.charts.fold === 'function' ? CT.charts.fold() : 'test') || 'test'; }
  function rows(data, kind, required) {
    var C = data && data.cols, n = data && data.n;
    if (!C || !isNum(n)) throw new Error(kind + ': cols missing');
    required.forEach(function (c) { if (!Array.isArray(C[c]) || C[c].length !== n) throw new Error(kind + ': ' + c + ' missing'); });
    var keys = Object.keys(C), out = new Array(n);
    for (var i = 0; i < n; i++) { var r = { _i: i }; for (var k = 0; k < keys.length; k++) r[keys[k]] = C[keys[k]][i]; out[i] = r; }
    return out;
  }
  function sig(r) { return String(r.slot) + '|' + String(r.style == null ? '' : r.style) + '|' + String(r.marker == null ? '' : r.marker); }
  function normKey(k) { return String(k == null ? '' : k).replace(/_(hp|hm|area|calib|offonline|online)$/, ''); } // protocol variants of one stem share the identity (ep_hp → ep); unrelated identities with one look stay apart
  function commonPrefix(labels) { if (!labels.length) return ''; var p = labels[0]; labels.forEach(function (s) { var i = 0; while (i < p.length && i < s.length && p[i] === s[i]) i++; p = p.slice(0, i); }); return p.replace(/[\s(,·:]+$/, ''); }
  /* identities of a chart: meta.series in legend order (or derived from the rows); rows map to an identity by key, then by signature
     (protocol variants of one stem share the identity); the legend label is the common prefix of the variants' labels */
  function identities(data, R) {
    var meta = (data && data.meta) || {}, list = [];
    function entry(s) { return { key: s.key, label: s.label, slot: s.slot, style: s.style == null ? null : s.style, marker: s.marker || null, aliases: [], labels: [s.label] }; }
    (Array.isArray(meta.series) ? meta.series : []).forEach(function (s) { // protocol variants listed separately collapse into one identity
      var e = entry(s), dup = null; list.forEach(function (t) { if (!dup && sig(t) === sig(e) && normKey(t.key) === normKey(e.key)) dup = t; });
      if (dup) { dup.aliases.push(e.key); if (dup.labels.indexOf(e.label) < 0) dup.labels.push(e.label); } else list.push(e);
    });
    R.forEach(function (r) { var s = identityOf(list, r); if (!s) { list.push(entry(r)); return; } if (s.labels.indexOf(r.label) < 0) s.labels.push(r.label); });
    list.forEach(function (s) { if (s.labels.length > 1) { var p = commonPrefix(s.labels); if (p.length >= 3) s.label = p; } });
    return list;
  }
  function identityOf(list, r) { var i; for (i = 0; i < list.length; i++) if (list[i].key === r.key || (list[i].aliases && list[i].aliases.indexOf(r.key) >= 0)) return list[i]; for (i = 0; i < list.length; i++) if (sig(list[i]) === sig(r) && normKey(list[i].key) === normKey(r.key)) return list[i]; return null; }
  function segHitsBox(ax, ay, bx, by, b) { // segment against an axis-aligned box (Liang–Barsky clip test)
    var t0 = 0, t1 = 1, dx = bx - ax, dy = by - ay, p = [-dx, dx, -dy, dy], q = [ax - b.x, b.x + b.w - ax, ay - b.y, b.y + b.h - ay];
    for (var i = 0; i < 4; i++) { if (p[i] === 0) { if (q[i] < 0) return false; } else { var t = q[i] / p[i]; if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } } }
    return true;
  }
  function curveHits(curves, b, pad) { // does any polyline cross the box {x, y, w, h} grown by pad?
    var bb = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
    for (var c = 0; c < curves.length; c++) { var pts = curves[c]; for (var i = 1; i < pts.length; i++) { var p0 = pts[i - 1], p1 = pts[i]; if (!p0 || !p1) continue; if (Math.max(p0[0], p1[0]) < bb.x || Math.min(p0[0], p1[0]) > bb.x + bb.w || Math.max(p0[1], p1[1]) < bb.y || Math.min(p0[1], p1[1]) > bb.y + bb.h) continue; if (segHitsBox(p0[0], p0[1], p1[0], p1[1], bb)) return true; } }
    return false;
  }

  /* ================================================================== helpers: marks, hit targets, tooltips, lift, controls */
  function localMarker(shape, x, y, r, hollow) {
    var e;
    if (shape === 'square') e = svgEl('rect', { x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: 1 });
    else if (shape === 'diamond') e = svgEl('path', { d: 'M' + r1(x) + ' ' + r1(y - 1.2 * r) + 'L' + r1(x + 1.2 * r) + ' ' + r1(y) + 'L' + r1(x) + ' ' + r1(y + 1.2 * r) + 'L' + r1(x - 1.2 * r) + ' ' + r1(y) + 'Z' });
    else if (shape === 'tri-up') e = svgEl('path', { d: 'M' + r1(x) + ' ' + r1(y - 1.15 * r) + 'L' + r1(x + 1.15 * r) + ' ' + r1(y + 0.85 * r) + 'L' + r1(x - 1.15 * r) + ' ' + r1(y + 0.85 * r) + 'Z' });
    else if (shape === 'tri-down') e = svgEl('path', { d: 'M' + r1(x) + ' ' + r1(y + 1.15 * r) + 'L' + r1(x + 1.15 * r) + ' ' + r1(y - 0.85 * r) + 'L' + r1(x - 1.15 * r) + ' ' + r1(y - 0.85 * r) + 'Z' });
    else e = svgEl('circle', { cx: x, cy: y, r: r });
    e.setAttribute('class', hollow ? 'ct-mark ct-mark--hollow' : 'ct-mark'); e.setAttribute('stroke-width', '2'); return e;
  }
  function mark(U, shape, x, y, r, color, hollow) { // ≥ 8 px marker: filled with the series colour + 2 px surface ring; hollow = surface fill, 2 px series stroke
    var e = null;
    if (U.marker) { try { var m = U.marker(shape, x, y, r, hollow, color); if (m && m.nodeType === 1) e = m; } catch (err) { e = null; } }
    if (!e) e = localMarker(shape, x, y, r, hollow);
    if (hollow) { e.style.stroke = color; e.style.fill = 'var(--ct-surface)'; } else { e.style.fill = color; e.style.stroke = 'var(--ct-surface)'; }
    e.classList.add('ct-lift'); return e;
  }
  function ciBar(parent, x1, x2, y, color) { // horizontal 2 px CI with 4 px end caps
    var g = svgEl('g', { 'class': 'ct-ci-g' });
    line(g, x1, y, x2, y, 'ct-ci', color); line(g, x1, y - 2, x1, y + 2, 'ct-ci', color); line(g, x2, y - 2, x2, y + 2, 'ct-ci', color);
    g.classList.add('ct-lift'); parent.appendChild(g); return g;
  }
  function ciBarV(parent, x, y1, y2, color) { // vertical 2 px CI with 4 px end caps
    var g = svgEl('g', { 'class': 'ct-ci-g' });
    line(g, x, y1, x, y2, 'ct-ci', color); line(g, x - 2, y1, x + 2, y1, 'ct-ci', color); line(g, x - 2, y2, x + 2, y2, 'ct-ci', color);
    g.classList.add('ct-lift'); parent.appendChild(g); return g;
  }
  function tipText(c) { var parts = []; if (c.title) parts.push(c.title); (c.rows || []).forEach(function (r) { if (typeof r === 'string') { parts.push(r); return; } parts.push([r.value, r.label].filter(function (x) { return x != null && x !== ''; }).join(' ')); }); return parts.join(' · '); }
  function showTip(inst, x, y, content) { if (inst.tip && typeof inst.tip.show === 'function') inst.tip.show(x, y, typeof content === 'function' ? content() : content); }
  function moveTip(inst, x, y, content) { if (inst.tip && typeof inst.tip.move === 'function') inst.tip.move(x, y); else showTip(inst, x, y, content); }
  function hideTip(inst) { if (inst.tip && typeof inst.tip.hide === 'function') inst.tip.hide(); }
  function lift(inst, svg, target) {
    if (typeof inst.lift === 'function') { inst.lift(target); return; }
    Array.prototype.forEach.call(svg.querySelectorAll('.ct-lift'), function (e) { if (!reduced() && !e.style.transition) e.style.transition = 'opacity ' + LIFT_MS + 'ms'; var inside = !!target && (e === target || (target.contains && target.contains(e)) || (e.contains && e.contains(target))); e.style.opacity = target ? (inside ? '1' : '0.6') : ''; });
  }
  /* transparent hit target ≥ 24 px: hover and focus show the same tooltip, Escape hides it, the hovered mark lifts (others to .6 for 120 ms) */
  function hit(inst, svg, parent, box, content, liftTarget) {
    var w = Math.max(24, box.w || 0), h = Math.max(24, box.h || 0), x = box.x - (w - (box.w || 0)) / 2, y = box.y - (h - (box.h || 0)) / 2;
    var r = svgEl('rect', { x: x, y: y, width: w, height: h, 'class': 'ct-hit', tabindex: '0', role: 'img' }); r.setAttribute('aria-label', tipText(typeof content === 'function' ? content() : content));
    function on(ev) { showTip(inst, ev.clientX, ev.clientY, content); lift(inst, svg, liftTarget || null); }
    function off() { hideTip(inst); lift(inst, svg, null); }
    r.addEventListener('pointerenter', on);
    r.addEventListener('pointermove', function (ev) { moveTip(inst, ev.clientX, ev.clientY, content); });
    r.addEventListener('pointerleave', off);
    r.addEventListener('focus', function () { var b = r.getBoundingClientRect(); showTip(inst, b.left + b.width / 2, b.top + Math.min(b.height / 2, 14), content); lift(inst, svg, liftTarget || null); });
    r.addEventListener('blur', off);
    r.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { off(); r.blur(); } });
    (parent || svg).appendChild(r); return r;
  }
  /* idempotent chip control in .ct-ctl (never the fold); uses the core's inst.control when present */
  function control(inst, name, spec) {
    var S = inst.state || (inst.state = {});
    if (typeof inst.control === 'function') return inst.control(name, spec);
    var opts = spec.options || []; if (S[name] == null) S[name] = spec.value != null ? spec.value : (opts[0] ? opts[0].value : null);
    var ctl = inst.ctl; if (!ctl) return S[name];
    var wrap = ctl.querySelector('[data-ctl="' + name + '"]');
    if (!wrap) {
      wrap = doc.createElement('div'); wrap.setAttribute('data-ctl', name); wrap.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px';
      if (spec.label) { var l = doc.createElement('span'); l.className = 'ct-ctl__lbl'; l.textContent = spec.label; wrap.appendChild(l); }
      var grp = doc.createElement('div'); grp.className = 'chips'; grp.setAttribute('role', 'radiogroup'); if (spec.label) grp.setAttribute('aria-label', spec.label);
      opts.forEach(function (o) {
        var b = doc.createElement('button'); b.type = 'button'; b.className = 'chip chip--sm'; b.setAttribute('role', 'radio'); b.setAttribute('data-value', String(o.value)); b.textContent = o.label;
        b.addEventListener('click', function () { if (String(S[name]) === String(o.value)) return; S[name] = o.value; sync(); if (typeof inst.render === 'function') inst.render(); });
        b.addEventListener('keydown', function (ev) { var bs = Array.prototype.slice.call(grp.querySelectorAll('button')), j = bs.indexOf(b); if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') j = (j + 1) % bs.length; else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') j = (j - 1 + bs.length) % bs.length; else return; ev.preventDefault(); bs[j].focus(); bs[j].click(); });
        grp.appendChild(b);
      });
      wrap.appendChild(grp); ctl.appendChild(wrap);
    }
    function sync() { var v = String(S[name]); Array.prototype.forEach.call(wrap.querySelectorAll('button'), function (b) { var on = b.getAttribute('data-value') === v; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; }); }
    sync(); return S[name];
  }
  function logGrid(g, ys, x0, x1, dom, U, labels) { // hairline gridlines at 1/2/5 steps; tick labels on decades, on 2/5 steps too when the spacing allows
    var ticks = [], e; for (e = Math.floor(Math.log10(dom[0])) - 1; e <= Math.ceil(Math.log10(dom[1])); e++) [1, 2, 5].forEach(function (mlt) { var v = mlt * Math.pow(10, e); if (v >= dom[0] * 0.999 && v <= dom[1] * 1.001) ticks.push(v); });
    var px = ticks.map(ys), minGap = Infinity; for (var i = 1; i < px.length; i++) minGap = Math.min(minGap, Math.abs(px[i] - px[i - 1]));
    var labelAll = minGap >= 15;
    ticks.forEach(function (v, i) {
      var yy = ys(v); line(g, x0, yy, x1, yy, 'ct-grid');
      var dec = Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-6;
      if (labels && (dec || labelAll)) text(g, x0 - 7, yy, U.tick(v), { anchor: 'end', dy: '0.35em', cls: dec ? null : 'ct-lbl--dim' });
    });
  }
  function panelTitle(g, x, y, s) { return text(g, x, y, s, { cls: 'ct-title' }); }

  /* ================================================================== V10a · topk — best of the first K candidate paths, two panels, crosshair */
  var TOPK_COLS = ['panel', 'stem', 'protocol', 'fold', 'key', 'label', 'slot', 'style', 'marker', 'top1', 'top3', 'top5', 'top10', 'best_first', 'n_expected', 'n_output', 'n_single_path'];
  function renderTopk(inst, W) {
    var D = inst.data, meta = D.meta || {}, U = util(inst);
    var R = rows(D, 'topk', TOPK_COLS), fold = foldOf(inst);
    var K = Array.isArray(meta.K) && meta.K.length ? meta.K : [1, 3, 5, 10], KCOL = K.map(function (k) { return 'top' + k; });
    KCOL.forEach(function (c) { if (!Array.isArray(D.cols[c])) throw new Error('topk: ' + c + ' missing'); });
    var ydom = Array.isArray(meta.y_domain) ? meta.y_domain : [10, 3000];
    var panels = Array.isArray(meta.panels) && meta.panels.length ? meta.panels : uniq(R.map(function (r) { return r.panel; }));
    var ids = identities(D, R);
    var sel = R.filter(function (r) { return r.fold === fold; }); if (!sel.length) sel = R.filter(function (r) { return r.fold === 'test'; });
    var side = W >= 720, nP = panels.length, GAP = 28, panelW = side ? (W - GAP * (nP - 1)) / nP : W;
    var TOPB = 26, AXB = 34, plotH = Math.round(clamp(0.6 * panelW, 210, 320)), blockH = TOPB + plotH + AXB, H = side ? blockH : blockH * nP + 10 * (nP - 1);
    var ML = 44, MR = 8, gutter = Math.round(clamp(0.36 * panelW, 64, 200));
    var legend = ids.map(function (s) { return { key: s.key, label: s.label, slot: s.slot, style: s.style, marker: s.marker }; });
    function orderIdx(r) { var s = identityOf(ids, r); return s ? ids.indexOf(s) : 99; }
    var out = { height: H, legend: legend.length > 1 ? legend : null, twin: topkTwin(R, K, KCOL, U), note: topkNote(sel, panels, ids, K, fold, U) };
    out.draw = function (svg) {
      panels.forEach(function (p, pi) {
        var ox = side ? pi * (panelW + GAP) : 0, oy = side ? 0 : pi * (blockH + 10);
        var px0 = ox + ML, px1 = ox + panelW - gutter - MR, py0 = oy + TOPB + 6, py1 = oy + TOPB + plotH;
        var g = svgEl('g', { 'class': 'ct-panel' }); svg.appendChild(g);
        panelTitle(g, ox, oy + 14, p);
        var ys = function (v) { var c = clamp(v, ydom[0], ydom[1]); return py1 - (Math.log(c) - Math.log(ydom[0])) / (Math.log(ydom[1]) - Math.log(ydom[0])) * (py1 - py0); };
        logGrid(g, ys, px0, px1, ydom, U, true);
        var step = (px1 - px0) / K.length, xs = K.map(function (k, i) { return px0 + (i + 0.5) * step; });
        line(g, px0, py1 + 0.5, px1, py1 + 0.5, 'ct-axis');
        xs.forEach(function (x, i) { text(g, x, py1 + 16, 'K = ' + K[i], { anchor: 'middle' }); });
        text(g, px1, py1 + 30, 'lowest-error path among the K highest-ranked candidates', { anchor: 'end', cls: 'ct-lbl--dim' });
        var ser = sel.filter(function (r) { return r.panel === p; }).sort(function (a, b) { return orderIdx(a) - orderIdx(b); }), ends = [];
        ser.forEach(function (r) {
          var id = identityOf(ids, r) || r, color = U.color(r.slot), sg = svgEl('g', { 'data-key': id.key, 'data-slot': r.slot }); sg.setAttribute('data-series', String(ids.indexOf(id)));
          var pts = KCOL.map(function (c, i) { return isNum(r[c]) ? [xs[i], ys(r[c])] : null; });
          var d = pathD(pts); if (d) { var path = svgEl('path', { d: d, 'class': 'ct-line' }); path.style.stroke = color; var da = U.dash(r.style); if (da) path.setAttribute('stroke-dasharray', da); sg.appendChild(path); }
          pts.forEach(function (pt) { if (pt) sg.appendChild(mark(U, r.marker || 'circle', pt[0], pt[1], 4.5, color, false)); });
          g.appendChild(sg);
          var last = r[KCOL[KCOL.length - 1]]; if (isNum(last)) ends.push({ y: ys(last), label: id.label, value: U.m(last), key: id.key });
        });
        // end labels at the last K: "label · 72 m" when the gutter has room, else the value only; de-collided with leader lines, never nudged into noise
        if (ends.length) {
          var lx = px1 + 10, room = ox + panelW - MR - lx, full = ends.every(function (e) { return measure(svg, e.label + ' · ' + e.value) <= room; });
          var pos = spread(ends.map(function (e) { return e.y; }), 13, py0 + 5, py1 - 1);
          ends.forEach(function (e, i) {
            var s = full ? e.label + ' · ' + e.value : e.value, yy = pos[i];
            if (Math.abs(yy - e.y) > 2) { var ld = line(g, px1 + 5, e.y, lx - 3, yy, null, 'var(--cl-text-mute)', 1); ld.style.opacity = '.6'; }
            var t = text(g, lx, yy, s, { cls: 'ct-lbl', dy: '0.35em' }); t.setAttribute('data-key', e.key); halo(t);
          });
        }
        // crosshair: one tooltip listing every series at the snapped K (best-first shares at K = 1, single-path outputs at the last K)
        var xh = line(g, px0, py0, px0, py1, 'ct-xhair'); xh.style.display = 'none';
        function content(i) {
          var rowsT = ser.map(function (r) { return { value: U.out(r[KCOL[i]], U.m), label: r.label, slot: r.slot, style: r.style }; });
          if (i === 0) ser.forEach(function (r) { if (isNum(r.best_first)) rowsT.push({ value: U.pct(r.best_first), label: 'best path ranked first · ' + r.label, slot: r.slot, style: r.style, dim: true }); });
          if (i === K.length - 1) ser.forEach(function (r) { if (isNum(r.n_single_path) && isNum(r.n_output) && r.n_output > 0 && r.n_single_path / r.n_output >= 0.05) rowsT.push({ value: U.int(r.n_single_path) + ' of ' + U.int(r.n_output), label: 'single-path outputs · ' + r.label, slot: r.slot, style: r.style, dim: true }); });
          return { title: 'K = ' + K[i] + ' · ' + p + ' · ' + U.fold(fold), rows: rowsT };
        }
        K.forEach(function (k, i) {
          var xa = i === 0 ? px0 - 10 : (xs[i - 1] + xs[i]) / 2, xb = i === K.length - 1 ? px1 + 10 : (xs[i] + xs[i + 1]) / 2;
          var c = content(i), h = svgEl('rect', { x: xa, y: py0, width: Math.max(24, xb - xa), height: Math.max(24, py1 - py0), 'class': 'ct-hit', tabindex: '0', role: 'img' }); h.setAttribute('aria-label', tipText(c)); g.appendChild(h);
          var shown = false;
          function show(cx, cy) { shown = true; xh.setAttribute('x1', r1(xs[i])); xh.setAttribute('x2', r1(xs[i])); xh.style.display = ''; showTip(inst, cx, cy, c); }
          function hide() { shown = false; xh.style.display = 'none'; hideTip(inst); }
          h.addEventListener('pointerenter', function (ev) { show(ev.clientX, ev.clientY); });
          h.addEventListener('pointermove', function (ev) { if (shown) moveTip(inst, ev.clientX, ev.clientY, c); else show(ev.clientX, ev.clientY); }); // a move without an enter (synthetic pointers) still gets the full readout
          h.addEventListener('pointerleave', hide);
          h.addEventListener('focus', function () { var b = svg.getBoundingClientRect(), k2 = b.width / (svg.viewBox.baseVal.width || b.width || 1); show(b.left + xs[i] * k2, b.top + (py0 + 12) * k2); });
          h.addEventListener('blur', hide);
          h.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { hide(); h.blur(); } });
        });
      });
    };
    return out;
  }
  function topkNote(sel, panels, ids, K, fold, U) {
    var parts = [];
    panels.forEach(function (p) {
      var ser = sel.filter(function (r) { return r.panel === p && isNum(r.best_first); });
      if (!ser.length) return;
      parts.push(p + ': ' + ser.map(function (r) { return U.pct(r.best_first) + ' ' + (identityOf(ids, r) || r).label; }).join(' · '));
    });
    if (!parts.length) return null;
    var body = parts.join('; ').replace(/\.$/, '');
    return 'Share of outputs whose best path is ranked first (' + U.fold(fold) + ') — ' + body + '. The lines show the median error of the lowest-error path among the K highest-ranked candidate paths; an output with a single path is its own top-K.';
  }
  function topkTwin(R, K, KCOL, U) {
    var head = ['method', 'start heading', 'drivers'].concat(K.map(function (k) { return 'K = ' + k; })).concat(['best path ranked first', 'single-path outputs', 'windows expected', 'with output', 'candidates (median)']);
    var body = R.map(function (r) {
      return [r.label, String(r.panel || '').replace(/^start heading\s*/, ''), U.foldShort(r.fold)].concat(KCOL.map(function (c) { return U.out(r[c], U.m); })).concat([U.pct(r.best_first), isNum(r.n_single_path) ? U.int(r.n_single_path) : '—', U.int(r.n_expected), U.int(r.n_output), isNum(r.n_candidates_median) ? U.num(r.n_candidates_median, 0) : '—']);
    });
    return { head: head, rows: body, caption: 'Median five-minute ADE (m) of the lowest-error path among the K highest-ranked candidate paths, both folds; an expected window without output counts as infinite ADE.' };
  }

  /* ================================================================== V10b · taxonomy — eight 100 % stacked bars in the ordinal ramp */
  var TAX_COLS = ['stem', 'protocol', 'fold', 'heading', 'key', 'label', 'n', 'top1_ok', 'ranking_miss', 'no_candidate', 'no_output', 'n_top1_ok', 'n_ranking_miss', 'n_no_candidate', 'n_no_output'];
  var TAX_PARTS = [{ key: 'top1_ok', label: 'top-1 within 50 m', color: '--ct-ord-1' }, { key: 'ranking_miss', label: 'lower-ranked candidate within 50 m (ranking failure)', color: '--ct-ord-2' }, { key: 'no_candidate', label: 'no candidate within 50 m (search failure)', color: '--ct-ord-3' }, { key: 'no_output', label: 'no output', color: '--ct-mute' }];
  var TAX_INK = { '--ct-ord-1': 'var(--cl-ink-deep)', '--ct-ord-2': 'var(--cl-text)', '--ct-ord-3': 'var(--cl-text)', '--ct-mute': 'var(--cl-ink-deep)' }; // label inside a fill: white or near-black by the fill's luminance
  function renderTaxonomy(inst, W) {
    var D = inst.data, meta = D.meta || {}, U = util(inst);
    var R = rows(D, 'taxonomy', TAX_COLS), fold = foldOf(inst);
    var parts = (Array.isArray(meta.parts) && meta.parts.length ? meta.parts : TAX_PARTS).map(function (p) { return { key: p.key, label: p.label, color: p.color, css: U.color(p.color) }; });
    parts.forEach(function (p) { if (!Array.isArray(D.cols[p.key])) throw new Error('taxonomy: ' + p.key + ' missing'); });
    var sel = R.filter(function (r) { return r.fold === fold; }); if (!sel.length) sel = R.filter(function (r) { return r.fold === 'test'; });
    var headings = uniq(sel.map(function (r) { return r.heading; }));
    var groups = headings.map(function (h) { return { heading: h, title: 'start heading ' + h, rows: sel.filter(function (r) { return r.heading === h; }) }; });
    var narrow = W < 560, labelW = narrow ? 0 : Math.round(clamp(0.27 * W, 150, 240)), rowH = narrow ? 40 : 26, barH = 16, headH = 24, bottom = 12;
    var nRows = sel.length, H = groups.length * headH + nRows * rowH + bottom;
    var legend = parts.map(function (p) { return { key: p.key, label: p.label, color: p.css, swatch: true }; });
    var out = { height: H, legend: legend, twin: taxTwin(R, parts, U), note: 'Threshold 50 m: every expected five-minute window falls into exactly one part; a percentage is printed inside a segment only where it fits, every value is in the table.' };
    out.draw = function (svg) {
      var y = 0;
      groups.forEach(function (grp) {
        panelTitle(svg, 0, y + 15, grp.title); y += headH;
        grp.rows.forEach(function (r) {
          var g = svgEl('g', { 'class': 'ct-row' }); svg.appendChild(g);
          var barY = narrow ? y + 20 : y + (rowH - barH) / 2, x0 = labelW, full = W - labelW;
          if (narrow) text(g, 0, y + 12, truncate(svg, r.label, W - 4), { cls: 'ct-lbl' });
          else text(g, labelW - 10, y + rowH / 2, truncate(svg, r.label, labelW - 14), { cls: 'ct-lbl', anchor: 'end', dy: '0.35em' });
          var cx = x0, lastIdx = -1; parts.forEach(function (p, i) { if (isNum(r[p.key]) && r[p.key] > 0) lastIdx = i; });
          parts.forEach(function (p, i) {
            var share = isNum(r[p.key]) ? r[p.key] : 0, w = share * full, count = r['n_' + p.key];
            if (w > 0.5) {
              var gap = i === lastIdx ? 0 : 2, segW = Math.max(0, w - gap);
              var seg = i === lastIdx ? svgEl('path', { d: roundRight(cx, barY, segW, barH, 4) }) : svgEl('rect', { x: cx, y: barY, width: segW, height: barH });
              seg.setAttribute('class', 'ct-seg-part ct-lift'); seg.setAttribute('data-key', p.key); seg.style.fill = p.css; g.appendChild(seg);
              if (segW >= 40) { var lbl = text(g, cx + segW / 2, barY + barH / 2, U.pct(r[p.key]), { anchor: 'middle', dy: '0.35em' }); lbl.style.fill = TAX_INK[p.color] || 'var(--cl-text)'; lbl.setAttribute('data-key', p.key); lbl.style.fontWeight = '600'; }
              var c = { title: r.label + ' · ' + grp.title + ' · ' + U.fold(fold), rows: [{ value: U.pct(r[p.key]), label: p.label, color: p.css, swatch: true }, { value: U.int(count) + ' of ' + U.int(r.n), label: 'windows' }] };
              hit(inst, svg, g, { x: cx, y: barY, w: Math.max(10, segW), h: barH }, c, seg);
            }
            cx += w;
          });
          y += rowH;
        });
      });
    };
    return out;
  }
  function taxTwin(R, parts, U) {
    var head = ['method', 'start heading', 'drivers', 'windows'].concat(parts.map(function (p) { return p.label; }));
    var body = R.map(function (r) { return [r.label, r.heading, U.foldShort(r.fold), U.int(r.n)].concat(parts.map(function (p) { return U.pct(r[p.key]) + ' (' + U.int(r['n_' + p.key]) + ')'; })); });
    return { head: head, rows: body, caption: 'Window taxonomy at the 50 m threshold: share (count) of the expected five-minute windows per part, both folds.' };
  }

  /* ================================================================== V13 · agent — route recovery with CIs, test and few-shot side by side, cost column, paired strip */
  var AGENT_COLS = ['config', 'label', 'order', 'fold', 'n', 'n_drivers', 'route_pct', 'route_lo', 'route_hi', 'ade_median', 'ade_lo', 'ade_hi', 'fde500_pct', 'cost_s', 'n_seeds', 'diagnostic'];
  function renderAgent(inst, W) {
    var D = inst.data, meta = D.meta || {}, U = util(inst);
    var R = rows(D, 'agent', AGENT_COLS);
    var folds = ['test', 'few_shot_heldout'].filter(function (f) { return R.some(function (r) { return r.fold === f; }); });
    uniq(R.map(function (r) { return r.fold; })).forEach(function (f) { if (folds.indexOf(f) < 0) folds.push(f); });
    var xdom = Array.isArray(meta.x_domain) ? meta.x_domain : [50, 100], cdom = Array.isArray(meta.cost_domain) ? meta.cost_domain : [0.1, 200];
    var configs = R.slice().sort(function (a, b) { return (a.order - b.order) || (a._i - b._i); }).reduce(function (acc, r) { if (!acc.some(function (c) { return c.config === r.config; })) acc.push({ config: r.config, label: r.label, order: r.order }); return acc; }, []);
    var pairs = Array.isArray(meta.pairs) ? meta.pairs.filter(function (p) { return p && isNum(p.diff_pp); }) : [];
    // layout: ≥ 720 px the two folds sit side by side with one shared label column; < 560 px ("narrow") labels sit above each row and the
    // cost column becomes a text readout in the label line (the dots need the width); in between, stacked panels with a label column each
    var narrow = W < 560, side = W >= 720 && folds.length > 1, nP = folds.length;
    var labelW = narrow ? 0 : Math.round(clamp(0.2 * W, 132, 200)), VALW = 44, GAP = 22;
    var COSTW = narrow ? 0 : Math.round(clamp(0.085 * W, 70, 96)), COSTPAD = narrow ? 0 : 36;
    var rowH = narrow ? 40 : 26, HEADH = 34, AXB = 30, panelH = HEADH + configs.length * rowH + AXB;
    var panelW = side ? (W - labelW - GAP * (nP - 1)) / nP : W;
    var pairRowH = narrow ? 36 : 22, PAIRT = 26, PAIRAX = 28, pairsH = pairs.length ? PAIRT + pairs.length * pairRowH + PAIRAX + 10 : 0;
    var mainH = side ? panelH : panelH * nP + 12 * (nP - 1), H = mainH + pairsH;
    var mono = U.color(null), dim = 'var(--cl-text-dim)', costHead = 'cost / window';
    var out = { height: H, legend: null, twin: agentTwin(R, pairs, U), note: agentNote(meta, U) };
    out.draw = function (svg) {
      folds.forEach(function (f, pi) {
        var ox = side ? labelW + pi * (panelW + GAP) : 0, oy = side ? 0 : pi * (panelH + 12), hasLabels = !narrow && (!side || pi === 0);
        var lx = side ? 0 : ox; // label column (shared on the left when side by side)
        var px0 = ox + (side ? 0 : labelW) + (narrow ? 16 : 6), costX1 = ox + panelW - COSTPAD, costX0 = costX1 - COSTW;
        var px1 = narrow ? ox + panelW - VALW - 10 : costX0 - 16 - VALW, rowEnd = narrow ? ox + panelW : costX1;
        var py0 = oy + HEADH, py1 = py0 + configs.length * rowH;
        var g = svgEl('g', { 'class': 'ct-panel' }); svg.appendChild(g);
        var fr = R.filter(function (r) { return r.fold === f; }), first = fr[0];
        var headX = narrow ? ox + panelW - 2 : costX1; text(g, headX, oy + 14, costHead, { anchor: 'end', cls: 'ct-lbl--dim' });
        var titleS = U.fold(f) + (first ? ' · ' + U.int(first.n) + ' windows' + (narrow ? '' : ' · ' + U.int(first.n_drivers) + ' drivers') : '');
        panelTitle(g, px0, oy + 14, truncate(svg, titleS, (narrow ? headX - measure(svg, costHead) - 10 : costX0 - 8) - px0, 12));
        var xs = function (v) { return px0 + (clamp(v, xdom[0], xdom[1]) - xdom[0]) / (xdom[1] - xdom[0]) * (px1 - px0); };
        var cs = function (v) { var c = clamp(v, cdom[0], cdom[1]); return costX0 + (Math.log(c) - Math.log(cdom[0])) / (Math.log(cdom[1]) - Math.log(cdom[0])) * (costX1 - costX0); };
        var stepPct = (px1 - px0) / (xdom[1] - xdom[0]) * 10 >= 36 ? 10 : 25;
        for (var v = xdom[0]; v <= xdom[1] + 1e-9; v += stepPct) { var xx = xs(v); line(g, xx, py0, xx, py1, 'ct-grid'); text(g, xx, py1 + 16, U.num(v, 0) + NBSP + '%', { anchor: 'middle' }); }
        line(g, px0, py1 + 0.5, px1, py1 + 0.5, 'ct-axis');
        text(g, px1, py1 + 29, 'route recovered · 95 % CI', { anchor: 'end', cls: 'ct-lbl--dim' });
        if (!narrow) {
          [0.1, 1, 10, 100].forEach(function (c) { if (c < cdom[0] * 0.999 || c > cdom[1] * 1.001) return; var cx2 = cs(c); line(g, cx2, py0, cx2, py1, 'ct-grid'); text(g, cx2, py1 + 16, c < 1 ? U.num(c, 1) : U.int(c), { anchor: 'middle', cls: 'ct-lbl--dim' }); });
          text(g, costX1, py1 + 29, 'seconds, log', { anchor: 'end', cls: 'ct-lbl--dim' });
        }
        configs.forEach(function (cfg, i) {
          var r = fr.filter(function (q) { return q.config === cfg.config; })[0], rowTop = py0 + i * rowH, cy = narrow ? rowTop + 28 : rowTop + rowH / 2;
          if (i > 0) line(g, hasLabels ? lx : px0, rowTop, rowEnd, rowTop, 'ct-grid').style.opacity = '.5';
          if (narrow) {
            text(g, px0, rowTop + 12, truncate(svg, cfg.label, panelW - 76), { cls: 'ct-lbl' });
            if (r) text(g, ox + panelW - 2, rowTop + 12, isNum(r.cost_s) ? U.s1(r.cost_s) : (r.diagnostic ? 'oracle' : '—'), { anchor: 'end', cls: 'ct-lbl--dim' });
          } else if (hasLabels) {
            var lines = splitLabel(cfg.label), maxW = labelW - 14;
            if (lines.length === 1 || measure(svg, cfg.label) <= maxW) text(g, lx + labelW - 10, cy, truncate(svg, cfg.label, maxW), { cls: 'ct-lbl', anchor: 'end', dy: '0.35em' });
            else { text(g, lx + labelW - 10, cy - 6, truncate(svg, lines[0], maxW), { cls: 'ct-lbl', anchor: 'end', dy: '0.35em' }); text(g, lx + labelW - 10, cy + 6, truncate(svg, lines[1], maxW), { cls: 'ct-lbl ct-lbl--dim', anchor: 'end', dy: '0.35em' }); }
          }
          if (!r) return;
          var rg = svgEl('g', { 'class': 'ct-row', 'data-config': r.config }); g.appendChild(rg);
          var col = r.diagnostic ? dim : mono, xv = xs(r.route_pct);
          if (isNum(r.route_lo) && isNum(r.route_hi)) ciBar(rg, xs(r.route_lo), xs(r.route_hi), cy, col);
          rg.appendChild(mark(U, r.diagnostic ? 'diamond' : 'circle', xv, cy, 4.5, col, !!r.diagnostic));
          // direct label: the route value at every dot ("83 % · diagnostic" for oracles when it fits, the value alone otherwise; never into the label column)
          var fullS = U.pct0(r.route_pct) + (r.diagnostic ? ' · diagnostic' : ''), shortS = U.pct0(r.route_pct), hiX = isNum(r.route_hi) ? xs(r.route_hi) : xv, loX = isNum(r.route_lo) ? xs(r.route_lo) : xv;
          if (hiX + 6 + measure(svg, fullS) <= px1 + VALW) halo(text(rg, hiX + 6, cy, fullS, { cls: 'ct-lbl', dy: '0.35em' }));
          else if (hiX + 6 + measure(svg, shortS) <= px1 + VALW) halo(text(rg, hiX + 6, cy, shortS, { cls: 'ct-lbl', dy: '0.35em' }));
          else if (loX - 6 - measure(svg, shortS) >= px0) halo(text(rg, loX - 6, cy, shortS, { cls: 'ct-lbl', anchor: 'end', dy: '0.35em' }));
          if (!narrow) {
            if (isNum(r.cost_s)) {
              var bw = Math.max(2, cs(r.cost_s) - costX0), bar = svgEl('path', { d: roundRight(costX0, cy - 5, bw, 10, 4), 'class': 'ct-lift' }); bar.style.fill = mono; rg.appendChild(bar);
              var cl = U.s1(r.cost_s), cw = measure(svg, cl);
              if (costX0 + bw + 4 + cw <= costX1 + COSTPAD - 2) text(rg, costX0 + bw + 4, cy, cl, { cls: 'ct-lbl', dy: '0.35em' });
              else { var tin = text(rg, costX0 + bw - 4, cy, cl, { cls: 'ct-lbl', anchor: 'end', dy: '0.35em' }); tin.style.fill = 'var(--cl-text)'; }
            } else text(rg, costX0, cy, r.diagnostic ? 'no cost · oracle' : '—', { cls: 'ct-lbl--dim', dy: '0.35em' });
          }
          var c = { title: r.label + ' · ' + U.fold(f), rows: [
            { value: U.pct0(r.route_pct) + ' ' + U.range(r.route_lo, r.route_hi, function (q) { return U.num(q, 0); }), label: 'route recovered · 95 % driver-clustered CI', slot: null, color: col, hollow: !!r.diagnostic, marker: r.diagnostic ? 'diamond' : 'circle' },
            { value: U.m(r.ade_median) + ' ' + U.range(r.ade_lo, r.ade_hi), label: 'median ADE, failure-aware' },
            { value: U.pct100(r.fde500_pct), label: 'of windows end more than 500 m off' },
            { value: isNum(r.cost_s) ? U.s1(r.cost_s) : (r.diagnostic ? 'none · diagnostic' : '—'), label: 'serial cost per window, reconstructed' },
            { value: U.int(r.n) + ' windows', label: U.int(r.n_drivers) + ' drivers' + (isNum(r.n_seeds) && r.n_seeds > 1 ? ' · ' + U.int(r.n_seeds) + ' seeds pooled' : '') } ] };
          hit(inst, svg, g, { x: hasLabels ? lx : px0, y: rowTop, w: rowEnd - (hasLabels ? lx : px0), h: rowH }, c, rg);
        });
      });
      if (pairs.length) { // paired differences around a zero line (percentage points); hollow when the interval includes 0
        var oy = mainH, g2 = svgEl('g', { 'class': 'ct-pairs' }); svg.appendChild(g2);
        var lo = Math.min(-4, Math.floor(Math.min.apply(null, pairs.map(function (p) { return isNum(p.lo_pp) ? p.lo_pp : p.diff_pp; })) - 0.5)), hi = Math.max(10, Math.ceil(Math.max.apply(null, pairs.map(function (p) { return isNum(p.hi_pp) ? p.hi_pp : p.diff_pp; })) + 0.5));
        var px0 = narrow ? 6 : labelW + 6, px1 = W - VALW - 24, py0 = oy + PAIRT, py1 = py0 + pairs.length * pairRowH;
        var xs2 = function (v) { return px0 + (clamp(v, lo, hi) - lo) / (hi - lo) * (px1 - px0); };
        var ptitle = 'Paired differences in route recovery (percentage points) · hollow = 95 % interval includes 0';
        if (measure(svg, ptitle, 12) > W - px0 - 2) ptitle = 'Paired differences (pp) · hollow: interval includes 0';
        if (measure(svg, ptitle, 12) > W - px0 - 2) ptitle = 'Paired differences (pp)';
        panelTitle(g2, px0, oy + 14, truncate(svg, ptitle, W - px0 - 2, 12));
        var stepPp = (px1 - px0) / (hi - lo) * 2 >= 30 ? 2 : 5;
        for (var v2 = Math.ceil(lo / stepPp) * stepPp; v2 <= hi + 1e-9; v2 += stepPp) { var x2 = xs2(v2); if (v2 !== 0) line(g2, x2, py0, x2, py1, 'ct-grid'); text(g2, x2, py1 + 15, (v2 > 0 ? '+' : '') + U.num(v2, 0), { anchor: 'middle' }); }
        line(g2, xs2(0), py0, xs2(0), py1, 'ct-zero'); line(g2, px0, py1 + 0.5, px1, py1 + 0.5, 'ct-axis');
        text(g2, px1, py1 + 27, 'percentage points, paired on the same windows', { anchor: 'end', cls: 'ct-lbl--dim' });
        pairs.forEach(function (p, i) {
          var rowTop = py0 + i * pairRowH, cy = narrow ? rowTop + 26 : rowTop + pairRowH / 2, inc0 = isNum(p.lo_pp) && isNum(p.hi_pp) && p.lo_pp <= 0 && p.hi_pp >= 0, lblP = p.pair + ' · ' + (p.fold === 'all' ? 'both folds' : U.foldShort(p.fold));
          if (narrow) text(g2, px0, rowTop + 11, truncate(svg, lblP, W - px0 - 4), { cls: 'ct-lbl' });
          else text(g2, labelW - 10, cy, truncate(svg, lblP, labelW - 14), { cls: 'ct-lbl', anchor: 'end', dy: '0.35em' });
          var rg = svgEl('g', { 'class': 'ct-row' }); g2.appendChild(rg);
          if (isNum(p.lo_pp) && isNum(p.hi_pp)) ciBar(rg, xs2(p.lo_pp), xs2(p.hi_pp), cy, mono);
          rg.appendChild(mark(U, 'circle', xs2(p.diff_pp), cy, 4.5, mono, inc0));
          var vx = isNum(p.hi_pp) ? xs2(p.hi_pp) : xs2(p.diff_pp); halo(text(rg, vx + 6, cy, U.pp(p.diff_pp), { cls: 'ct-lbl', dy: '0.35em' }));
          var c = { title: lblP, rows: [
            { value: U.pp(p.diff_pp) + ' ' + U.range(p.lo_pp, p.hi_pp, function (q) { return U.num(q, 1); }), label: 'route recovered, paired difference · 95 % CI', slot: null, color: mono, hollow: inc0, marker: 'circle' },
            { value: inc0 ? 'includes 0' : 'excludes 0', label: inc0 ? 'no clear evidence either way' : '95 % interval' },
            { value: isNum(p.n) ? U.int(p.n) + ' windows' : '—', label: 'paired' } ] };
          hit(inst, svg, g2, { x: 0, y: rowTop, w: W, h: pairRowH }, c, rg);
        });
      }
    };
    return out;
  }
  function agentNote(meta, U) {
    var parts = ['Dots: route recovery with 95 % driver-clustered intervals; hollow diamonds: pool oracles, a diagnostic ceiling, not a deployable selector.', 'Bars: reconstructed serial median cost per window' + (isNum(meta.live_ratio) ? ' (live runs took about ' + U.num(meta.live_ratio, 1) + '× the reconstruction)' : '') + '.'];
    if (Array.isArray(meta.pairs) && meta.pairs.length) parts.push('A paired 95 % interval that includes 0 is no clear evidence either way.');
    return parts.join(' ');
  }
  function agentTwin(R, pairs, U) {
    var head = ['configuration', 'drivers', 'windows', 'n drivers', 'route recovered', '95 % CI', 'median ADE', '95 % CI', 'end > 500 m off', 'cost per window', 'seeds', 'diagnostic'];
    var body = R.slice().sort(function (a, b) { return (a.fold === b.fold ? 0 : a.fold === 'test' ? -1 : 1) || (a.order - b.order); }).map(function (r) {
      return [r.label, U.foldShort(r.fold), U.int(r.n), U.int(r.n_drivers), U.pct100(r.route_pct, 1), U.num(r.route_lo, 1) + ' to ' + U.num(r.route_hi, 1) + NBSP + '%', U.m(r.ade_median), isNum(r.ade_lo) && isNum(r.ade_hi) ? U.mv(r.ade_lo) + ' to ' + U.mv(r.ade_hi) + ' m' : '—', U.pct100(r.fde500_pct, 1), isNum(r.cost_s) ? U.s1(r.cost_s) : '—', isNum(r.n_seeds) ? U.int(r.n_seeds) : '—', r.diagnostic ? 'yes' : 'no'];
    });
    var cap = 'Candidate selection on one five-minute window per evaluation drive, test and few-shot drivers.';
    if (pairs.length) cap += ' Paired differences in route recovery (pp, 95 % CI): ' + pairs.map(function (p) { return p.pair + ' · ' + (p.fold === 'all' ? 'both folds' : U.foldShort(p.fold)) + ': ' + U.pp(p.diff_pp) + ' ' + U.range(p.lo_pp, p.hi_pp, function (q) { return U.num(q, 1); }) + (isNum(p.n) ? ', n = ' + U.int(p.n) : ''); }).join('; ') + '.';
    return { head: head, rows: body, caption: cap };
  }

  /* ================================================================== V14 · density — four small multiples, dot + CI per tertile, 5 min filled / 15 min hollow, tail-lost bars */
  var DENS_COLS = ['stem', 'key', 'label', 'slot', 'style', 'protocol', 'win', 'level', 'level_label', 'level_order', 'n_episodes', 'n_drivers', 'n_platforms', 'ade_median', 'lo', 'hi', 'c100', 'lost_road'];
  function renderDensity(inst, W) {
    var D = inst.data, meta = D.meta || {}, U = util(inst);
    var R = rows(D, 'density', DENS_COLS);
    var wins = meta.wins && typeof meta.wins === 'object' ? meta.wins : { w05: '5 min', w15: '15 min' };
    var winKeys = uniq(R.map(function (r) { return r.win; })).sort(function (a, b) { return String(wins[a] || a).localeCompare(String(wins[b] || b), undefined, { numeric: true }); });
    var showWin = control(inst, 'win', { label: 'Windows', role: 'radiogroup', value: 'both', options: winKeys.map(function (w, i) { return { value: w, label: (i === 0 ? '● ' : '○ ') + (wins[w] || w) }; }).concat([{ value: 'both', label: 'both' }]) });
    var ydom = Array.isArray(meta.y_domain) ? meta.y_domain : [10, 20000];
    var ids = identities(D, R), stems = uniq(R.map(function (r) { return r.stem; }));
    var levels = R.slice().sort(function (a, b) { return a.level_order - b.level_order; }).reduce(function (acc, r) { if (!acc.some(function (l) { return l.level === r.level; })) acc.push({ level: r.level, label: r.level_label, order: r.level_order }); return acc; }, []);
    var cols = W >= 1100 ? Math.min(4, stems.length) : W >= 720 ? Math.min(2, stems.length) : 1, GAP = 24, panelW = (W - GAP * (cols - 1)) / cols, nRows = Math.ceil(stems.length / cols);
    var TITLEH = 24, AXB = 22, LOSTH = 34, plotH = Math.round(clamp(0.6 * panelW, 200, 280)), panelH = TITLEH + plotH + AXB + LOSTH, VGAP = 18, H = nRows * panelH + (nRows - 1) * VGAP;
    var ML0 = 46, MLn = 14, MR = 10;
    var legend = ids.map(function (s) { return { key: s.key, label: s.label, slot: s.slot, style: s.style, marker: null }; });
    legend.push({ label: 'filled ' + (wins[winKeys[0]] || winKeys[0]) + ' · hollow ' + (wins[winKeys[1]] || winKeys[1] || ''), note: true });
    var out = { height: H, legend: legend, twin: densTwin(R, wins, meta, U), note: densNote(meta, levels, U) };
    out.draw = function (svg) {
      stems.forEach(function (stem, i) {
        var c = i % cols, rr = Math.floor(i / cols), ox = c * (panelW + GAP), oy = rr * (panelH + VGAP), ML = c === 0 ? ML0 : MLn;
        var px0 = ox + ML, px1 = ox + panelW - MR, py0 = oy + TITLEH + 6, py1 = oy + TITLEH + plotH;
        var sr = R.filter(function (r) { return r.stem === stem; }), id = identityOf(ids, sr[0]) || sr[0], color = U.color(id.slot);
        var g = svgEl('g', { 'class': 'ct-panel', 'data-key': id.key, 'data-slot': id.slot }); svg.appendChild(g);
        var kl = line(g, ox + 1, oy + 10, ox + 19, oy + 10, 'ct-line', color); var da = U.dash(id.style); if (da) kl.setAttribute('stroke-dasharray', da);
        panelTitle(g, ox + 26, oy + 14, truncate(svg, id.label, panelW - 30, 12));
        var ys = function (v) { var cv = clamp(v, ydom[0], ydom[1]); return py1 - (Math.log(cv) - Math.log(ydom[0])) / (Math.log(ydom[1]) - Math.log(ydom[0])) * (py1 - py0); };
        logGrid(g, ys, px0, px1, ydom, U, c === 0);
        var colW = (px1 - px0) / levels.length, xs = levels.map(function (l, j) { return px0 + (j + 0.5) * colW; });
        line(g, px0, py1 + 0.5, px1, py1 + 0.5, 'ct-axis');
        levels.forEach(function (l, j) { text(g, xs[j], py1 + 15, String(l.label || l.level).replace(/\s*nodes\/km²\s*/, ''), { anchor: 'middle' }); });
        var lostTop = py1 + AXB;
        text(g, px0, lostTop + 8, 'tail lost · ' + (wins[winKeys[0]] || winKeys[0]), { cls: 'ct-lbl--dim' });
        text(g, px1, lostTop + 8, 'nodes/km²', { anchor: 'end', cls: 'ct-lbl--dim' });
        levels.forEach(function (l, j) {
          var both = showWin === 'both', drawn = winKeys.filter(function (w) { return both || w === showWin; });
          drawn.forEach(function (w, wi) {
            var r = sr.filter(function (q) { return q.level === l.level && q.win === w; })[0]; if (!r || !isNum(r.ade_median)) return;
            var x = xs[j] + (both && drawn.length > 1 ? (wi === 0 ? -7 : 7) : 0), hollow = wi > 0 || (!both && w !== winKeys[0]), yv = ys(r.ade_median);
            var mg = svgEl('g', { 'class': 'ct-markg' }); g.appendChild(mg);
            if (isNum(r.lo) && isNum(r.hi)) ciBarV(mg, x, ys(r.hi), ys(r.lo), color);
            mg.appendChild(mark(U, 'circle', x, yv, 4.5, color, hollow));
            var winLabel = wins[w] || w, tipc = { title: id.label + ' · ' + (l.label || l.level) + ' · ' + winLabel + ' windows', rows: [
              { value: U.m(r.ade_median) + ' ' + U.range(r.lo, r.hi), label: 'median ADE · 95 % driver-bootstrap CI', slot: id.slot, style: id.style, hollow: hollow, marker: 'circle' },
              { value: U.int(r.n_episodes) + ' windows', label: U.int(r.n_drivers) + ' drivers · ' + U.int(r.n_platforms) + ' platforms' },
              { value: U.pct(r.c100), label: 'c100 · seconds within 100 m' },
              { value: U.pct(r.lost_road), label: 'tail lost · share of windows' } ] };
            hit(inst, svg, g, { x: x - 12, y: yv - 12, w: 24, h: 24 }, tipc, mg);
          });
          // tail-lost bar row for the first window length (5 min): 8 px, --ct-mute, square at the baseline, rounded data end
          var r5 = sr.filter(function (q) { return q.level === l.level && q.win === winKeys[0]; })[0];
          if (r5 && isNum(r5.lost_road)) {
            var vl = U.pct(r5.lost_road), vw = measure(svg, vl), bx0 = xs[j] - colW / 2 + 6, bw = Math.max(1, r5.lost_road * Math.max(10, colW - 12 - vw - 6)), by = lostTop + 16;
            var bar = svgEl('path', { d: roundRight(bx0, by, bw, 8, 4), 'class': 'ct-lift' }); bar.style.fill = 'var(--ct-mute)'; g.appendChild(bar);
            text(g, bx0 + bw + 4, by + 4, vl, { cls: 'ct-lbl--dim', dy: '0.35em' });
            hit(inst, svg, g, { x: bx0 - 6, y: by - 8, w: colW, h: 24 }, { title: id.label + ' · ' + (l.label || l.level), rows: [{ value: U.pct(r5.lost_road), label: 'tail lost · share of ' + (wins[winKeys[0]] || winKeys[0]) + ' windows whose path leaves the reference road', slot: 0, swatch: true }, { value: U.int(r5.n_episodes), label: 'windows' }] }, bar);
          }
        });
      });
    };
    return out;
  }
  function densNote(meta, levels, U) {
    var cf = Array.isArray(meta.common_failure) ? meta.common_failure : [], parts = [];
    if (cf.length) parts.push('Common failure of all map methods by density: ' + cf.map(function (x) { return U.pct(x.share, 1); }).join(' → ') + ' of windows (' + cf.map(function (x) { return x.level; }).join(' → ') + ').');
    parts.push('Density is confounded with region, driver, speed and fold: these are associations, not effects.');
    return parts.join(' ');
  }
  function densTwin(R, wins, meta, U) {
    var head = ['method', 'window', 'density tertile', 'windows', 'drivers', 'platforms', 'median ADE', '95 % CI', 'c100', 'tail lost'];
    var body = R.map(function (r) { return [r.label, wins[r.win] || r.win, r.level_label || r.level, U.int(r.n_episodes), U.int(r.n_drivers), U.int(r.n_platforms), U.m(r.ade_median), isNum(r.lo) && isNum(r.hi) ? U.mv(r.lo) + ' to ' + U.mv(r.hi) + ' m' : '—', U.pct(r.c100), U.pct(r.lost_road)]; });
    var cap = 'Median ADE by road-density tertile around the start, five- and fifteen-minute windows, test and few-shot pooled.';
    var cf = Array.isArray(meta.common_failure) ? meta.common_failure : [];
    if (cf.length) cap += ' Common failure of all map methods (five-minute windows no map method recovers, 95 % CI): ' + cf.map(function (x) { return x.level + ' ' + U.pct(x.share, 1) + ' ' + U.range(x.lo, x.hi, function (q) { return U.pct(q, 1); }) + (isNum(x.n) ? ' of ' + U.int(x.n) : ''); }).join('; ') + '.';
    return { head: head, rows: body, caption: cap };
  }

  /* ================================================================== V16 · confidence — coverage against route rate among the accepted, two panels, τ labels, overall hairlines */
  var CONF_COLS = ['stem', 'protocol', 'heading', 'fold', 'key', 'label', 'slot', 'style', 'tau', 'n_accepted', 'coverage', 'route_rate_accepted', 'route_lo', 'route_hi', 'error_share_accepted', 'median_ade_accepted'];
  function renderConfidence(inst, W) {
    var D = inst.data, meta = D.meta || {}, U = util(inst);
    var R = rows(D, 'confidence', CONF_COLS), fold = foldOf(inst);
    var sel = R.filter(function (r) { return r.fold === fold; }); if (!sel.length) sel = R.filter(function (r) { return r.fold === 'test'; });
    var headings = uniq(sel.map(function (r) { return r.heading; })), panelName = function (h) { return 'start heading ' + h; };
    var ids = identities(D, R), summary = Array.isArray(meta.summary) ? meta.summary : [];
    function sumFor(r) { for (var i = 0; i < summary.length; i++) { var s = summary[i]; if (s && s.stem === r.stem && s.protocol === r.protocol && s.fold === r.fold) return s; } return null; }
    var labelTaus = Array.isArray(meta.label_taus) ? meta.label_taus : [0.5, 0.9, 1.0];
    var xdom = Array.isArray(meta.x_domain) ? meta.x_domain : [0, 1], ydom0 = Array.isArray(meta.y_domain) ? meta.y_domain : [0.4, 1];
    var yMin = ydom0[0]; sel.forEach(function (r) { if (isNum(r.route_rate_accepted)) yMin = Math.min(yMin, r.route_rate_accepted); var s = sumFor(r); if (s && isNum(s.route_overall)) yMin = Math.min(yMin, s.route_overall); });
    var ydom = [Math.max(0, Math.floor(yMin * 10 - 1e-9) / 10), ydom0[1]];
    var side = W >= 720, nP = headings.length, GAP = 28, panelW = side ? (W - GAP * (nP - 1)) / nP : W;
    var TOPB = 26, AXB = 36, plotH = Math.round(clamp(0.6 * panelW, 220, 320)), blockH = TOPB + plotH + AXB, H = side ? blockH : blockH * nP + 10 * (nP - 1);
    var ML = 44, MR = 14;
    // legend: one key per identity, AUROC [lo, hi] per heading from meta.summary
    var legend = ids.map(function (s) {
      var bits = [];
      headings.forEach(function (h) { var r = sel.filter(function (q) { return q.heading === h && (identityOf(ids, q) === s); })[0], sm = r ? sumFor(r) : null; if (sm && isNum(sm.auroc)) bits.push('AUROC ' + U.num(sm.auroc, 2) + (isNum(sm.auroc_lo) && isNum(sm.auroc_hi) ? ' [' + U.num(sm.auroc_lo, 2) + ', ' + U.num(sm.auroc_hi, 2) + ']' : '') + ' (heading ' + h + ')'); });
      return { key: s.key, label: s.label + (bits.length ? ' · ' + bits.join(' · ') : ''), slot: s.slot, style: s.style, marker: 'circle' };
    });
    var out = { height: H, legend: legend.length > 1 ? legend : null, twin: confTwin(R, summary, U), note: confNote(sel, ids, headings, summary, fold, U) };
    out.draw = function (svg) {
      headings.forEach(function (h, pi) {
        var ox = side ? pi * (panelW + GAP) : 0, oy = side ? 0 : pi * (blockH + 10);
        var px0 = ox + ML, px1 = ox + panelW - MR, py0 = oy + TOPB + 6, py1 = oy + TOPB + plotH;
        var g = svgEl('g', { 'class': 'ct-panel' }); svg.appendChild(g);
        panelTitle(g, ox, oy + 14, panelName(h));
        var xs = function (v) { return px0 + (clamp(v, xdom[0], xdom[1]) - xdom[0]) / (xdom[1] - xdom[0]) * (px1 - px0); };
        var ys = function (v) { return py1 - (clamp(v, ydom[0], ydom[1]) - ydom[0]) / (ydom[1] - ydom[0]) * (py1 - py0); };
        var yStep = (py1 - py0) / ((ydom[1] - ydom[0]) / 0.1) >= 22 ? 0.1 : 0.2;
        for (var v = ydom[0]; v <= ydom[1] + 1e-9; v = +(v + yStep).toFixed(6)) { var yy = ys(v); line(g, px0, yy, px1, yy, 'ct-grid'); text(g, px0 - 7, yy, U.pct(v), { anchor: 'end', dy: '0.35em' }); }
        [0, 0.25, 0.5, 0.75, 1].forEach(function (v2) { if (v2 < xdom[0] || v2 > xdom[1]) return; var xx = xs(v2); line(g, xx, py0, xx, py1, 'ct-grid'); text(g, xx, py1 + 15, U.pct(v2), { anchor: 'middle' }); });
        line(g, px0, py1 + 0.5, px1, py1 + 0.5, 'ct-axis');
        text(g, px1, py1 + 30, 'share of windows accepted', { anchor: 'end', cls: 'ct-lbl--dim' });
        var ycap = 'route rate among the accepted'; text(g, px0, py0 - 6, ycap, { cls: 'ct-lbl--dim' });
        var placed = [{ x: px0, y: py0 - 16, w: measure(svg, ycap), h: 14 }]; // occupied boxes: axis caption, markers, labels already placed
        function free(x, y, w, hgt) { if (x < px0 - 2 || x + w > ox + panelW || y < py0 - 2 || y + hgt > py1) return false; return !placed.some(function (b) { return x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + hgt > b.y; }); }
        function place(x, y, w, hgt) { placed.push({ x: x, y: y, w: w, h: hgt }); }
        function overlapArea(x, y, w, hgt) { var a = 0; placed.forEach(function (b) { var ix = Math.min(x + w, b.x + b.w) - Math.max(x, b.x), iy = Math.min(y + hgt, b.y + b.h) - Math.max(y, b.y); if (ix > 0 && iy > 0) a += ix * iy; }); return a; }
        var ser = ids.map(function (s) { return { id: s, pts: sel.filter(function (r) { return r.heading === h && identityOf(ids, r) === s; }).sort(function (a, b) { return a.tau - b.tau; }) }; }).filter(function (s) { return s.pts.length; });
        ser.forEach(function (s) { s.xy = s.pts.map(function (r) { return isNum(r.coverage) && isNum(r.route_rate_accepted) ? [xs(r.coverage), ys(r.route_rate_accepted)] : null; }); s.pts.forEach(function (r) { if (isNum(r.coverage) && isNum(r.route_rate_accepted)) place(xs(r.coverage) - 6, ys(r.route_rate_accepted) - 6, 12, 12); }); });
        var curves = ser.map(function (s) { return s.xy; });
        var tau1 = ser.map(function (s) { var k = -1; s.pts.forEach(function (r, i) { if (Math.abs(r.tau - 1) < 1e-6 && s.xy[i]) k = i; }); return k >= 0 ? s.xy[k] : null; });
        var skipTau1 = ser.map(function (s, i) { var p = tau1[i]; if (!p) return false; return tau1.some(function (q, j) { return j !== i && q && Math.abs(q[0] - p[0]) < 14 && Math.abs(q[1] - p[1]) < 14 && (q[0] < p[0] || (q[0] === p[0] && j < i)); }); }); // only the leftmost of coinciding τ = 1.0 points is labelled
        // overall route-rate hairlines first (under the curves): 1 px in the series colour, labelled "all windows · 88 %"
        ser.forEach(function (s) {
          var sm = sumFor(s.pts[0]); if (!sm || !isNum(sm.route_overall)) return;
          var yv = ys(sm.route_overall), color = U.color(s.id.slot);
          var hl = line(g, px0, yv, px1, yv, null, color, 1); hl.style.opacity = '.6'; hl.setAttribute('data-key', s.id.key);
          var lbl = 'all windows · ' + U.pct(sm.route_overall), w = measure(svg, lbl);
          var cands = []; [-4, 12, -16, 24].forEach(function (o) { [px0 + 4, px1 - 4 - w, (px0 + px1 - w) / 2].forEach(function (x) { cands.push([x, yv + o]); }); });
          cands = cands.filter(function (c) { return c[1] - 10 >= py0 - 2 && c[1] + 2 <= py1; });
          var pos = cands.filter(function (c) { return free(c[0], c[1] - 10, w, 12); })[0];
          if (!pos) { cands.sort(function (a, b) { return overlapArea(a[0], a[1] - 10, w, 12) - overlapArea(b[0], b[1] - 10, w, 12); }); pos = cands[0] || [px0 + 4, yv - 4]; }
          var t = text(g, pos[0], pos[1], lbl, { cls: 'ct-lbl--dim' }); t.setAttribute('data-key', s.id.key); halo(t); place(pos[0], pos[1] - 10, w, 12);
        });
        ser.forEach(function (s) {
          var color = U.color(s.id.slot), sg = svgEl('g', { 'data-key': s.id.key, 'data-slot': s.id.slot }); sg.setAttribute('data-series', String(ids.indexOf(s.id))); g.appendChild(sg);
          var pts = s.xy;
          var d = pathD(pts); if (d) { var path = svgEl('path', { d: d, 'class': 'ct-line' }); path.style.stroke = color; var da = U.dash(s.id.style); if (da) path.setAttribute('stroke-dasharray', da); sg.appendChild(path); }
          s.pts.forEach(function (r, i) {
            var pt = pts[i]; if (!pt) return;
            var mk = mark(U, 'circle', pt[0], pt[1], 4.5, color, false); sg.appendChild(mk);
            if (labelTaus.some(function (t) { return Math.abs(t - r.tau) < 1e-6; }) && !(Math.abs(r.tau - 1) < 1e-6 && skipTau1[ser.indexOf(s)])) {
              var lbl = 'τ ' + U.num(r.tau, 1), w = measure(svg, lbl), cand = [[pt[0] - w / 2, pt[1] - 20], [pt[0] + 9, pt[1] - 6], [pt[0] - w / 2, pt[1] + 9], [pt[0] - 9 - w, pt[1] - 6], [pt[0] + 9, pt[1] + 8], [pt[0] - 9 - w, pt[1] + 8], [pt[0] + 9, pt[1] - 20]]; // above, right, below, left, then the diagonals
              for (var k = 0; k < cand.length; k++) { if (free(cand[k][0], cand[k][1], w, 12) && !curveHits(curves, { x: cand[k][0], y: cand[k][1], w: w, h: 12 }, 2)) { var t = text(sg, cand[k][0], cand[k][1] + 10, lbl, { cls: 'ct-lbl' }); halo(t); place(cand[k][0], cand[k][1], w, 12); break; } } // no free spot: the label is dropped (τ is in the tooltip and the table)
            }
            var c = { title: s.id.label + ' · heading ' + h + ' · τ ' + U.num(r.tau, 1) + ' · ' + U.fold(fold), rows: [
              { value: U.pct(r.coverage), label: 'of windows accepted · ' + U.int(r.n_accepted) + ' windows', slot: s.id.slot, style: s.id.style, marker: 'circle' },
              { value: U.pct(r.route_rate_accepted) + ' ' + U.range(r.route_lo, r.route_hi, function (q) { return U.pct(q); }), label: 'route rate among the accepted · 95 % CI' },
              { value: U.pct(r.error_share_accepted), label: 'of the accepted are wrong (error share)' },
              { value: U.m(r.median_ade_accepted), label: 'median ADE of the accepted' } ] };
            hit(inst, svg, sg, { x: pt[0] - 12, y: pt[1] - 12, w: 24, h: 24 }, c, mk);
          });
        });
      });
    };
    return out;
  }
  function confNote(sel, ids, headings, summary, fold, U) {
    var bits = [];
    ids.forEach(function (s) {
      headings.forEach(function (h) {
        var r = sel.filter(function (q) { return q.heading === h && identityOf(ids, q) === s; })[0]; if (!r) return;
        var sm = null; for (var i = 0; i < summary.length; i++) { var x = summary[i]; if (x && x.stem === r.stem && x.protocol === r.protocol && x.fold === r.fold) { sm = x; break; } }
        if (sm && isNum(sm.share_prob_eq_1)) bits.push(U.pct(sm.share_prob_eq_1) + ' ' + s.label + ', heading ' + h);
      });
    });
    var s1 = bits.length ? 'Share of windows whose top candidate scores exactly 1 (' + U.fold(fold) + '): ' + bits.join(' · ') + '. ' : '';
    return s1 + 'AUROC 0.5 = chance at separating recovered from unrecovered routes. A confidence score, not a calibrated probability.';
  }
  function confTwin(R, summary, U) {
    var head = ['method', 'start heading', 'drivers', 'τ', 'accepted', 'coverage', 'route rate among accepted', '95 % CI', 'error share', 'median ADE of accepted'];
    var body = R.map(function (r) { return [r.label, r.heading, U.foldShort(r.fold), U.num(r.tau, 1), U.int(r.n_accepted), U.pct(r.coverage), U.pct(r.route_rate_accepted), isNum(r.route_lo) && isNum(r.route_hi) ? U.pct(r.route_lo) + ' to ' + U.pct(r.route_hi) : '—', U.pct(r.error_share_accepted), U.m(r.median_ade_accepted)]; });
    var cap = 'Accepting only windows whose top candidate score exceeds τ: coverage and route rate among the accepted, both folds.';
    if (summary.length) {
      var labelOf = {}; R.forEach(function (r) { labelOf[r.stem + '|' + r.protocol] = r.label + ' (heading ' + r.heading + ')'; });
      cap += ' Summary: ' + summary.map(function (s) { return (labelOf[s.stem + '|' + s.protocol] || s.stem) + ', ' + U.foldShort(s.fold) + ': AUROC ' + U.num(s.auroc, 2) + ' [' + U.num(s.auroc_lo, 2) + ', ' + U.num(s.auroc_hi, 2) + ']' + (isNum(s.spearman_ade) ? ', Spearman with ADE ' + U.num(s.spearman_ade, 2) : '') + (isNum(s.share_prob_eq_1) ? ', score 1 for ' + U.pct(s.share_prob_eq_1) : '') + (isNum(s.route_overall) ? ', route rate over all windows ' + U.pct(s.route_overall) : ''); }).join('; ') + '.';
    }
    return { head: head, rows: body, caption: cap };
  }

  /* ================================================================== register (then wake the core's waiting charts and boot any eager roots) */
  CT.charts.register('topk', renderTopk, { cols: TOPK_COLS });
  CT.charts.register('taxonomy', renderTaxonomy, { cols: TAX_COLS });
  CT.charts.register('agent', renderAgent, { cols: AGENT_COLS });
  CT.charts.register('density', renderDensity, { cols: DENS_COLS });
  CT.charts.register('confidence', renderConfidence, { cols: CONF_COLS });
  doc.dispatchEvent(new CustomEvent('ct:renderers'));
  if (Proj && typeof Proj.bootAll === 'function') Proj.bootAll(doc);
})(window, document);
