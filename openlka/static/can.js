/* OpenLKA · CAN lab (05) and Access (10) behaviours. Vanilla JS, no dependencies.
   Loaded after openlka.js, which already binds .reveal, [data-count], [data-zoom], .tabs, .vcard,
   .tile--video and the two modals; nothing here touches those. The only global is window.OpenLKACan.
   Data contract: static/can/index.json → clips[].files.{video,poster,signals,track,frames}, dongles.json,
   routes_map.json, hero-trace.json (see openlka/pipeline). Nothing is fetched until #can is near the viewport,
   except the ≤ 8 KB hero trace, which loads in an idle callback after the page has loaded. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var dbg = function () { if (window.console && console.debug) console.debug.apply(console, ['[can]'].concat(Array.prototype.slice.call(arguments))); };
  var DPR = Math.min(2, window.devicePixelRatio || 1);
  var MPH = 2.23694, MONO = 'ui-monospace, Menlo, Consolas, monospace', SANS = 'Inter, system-ui, sans-serif';

  /* ---------- small helpers ---------- */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function fmtInt(v) { return Math.round(v).toLocaleString('en-US'); }
  function fmtClock(t) { t = Math.max(0, t || 0); var m = Math.floor(t / 60), s = Math.floor(t - m * 60); return m + ':' + (s < 10 ? '0' : '') + s; }
  function signed(v, dp) { return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(dp); }
  function setText(el, s) { if (el && el.textContent !== s) el.textContent = s; }
  function cssVar(el, name, fb) { var v = ''; try { v = getComputedStyle(el).getPropertyValue(name).trim(); } catch (e) { /* detached */ } return v || fb; }
  function fetchJSON(u, signal) {
    return fetch(u, { signal: signal, credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return r.json(); });
  }
  function onIdle(fn) { if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout: 2500 }); else setTimeout(fn, 800); }
  function afterLoad(fn) { if (document.readyState === 'complete') fn(); else window.addEventListener('load', fn, { once: true }); }
  /* first index whose key is > t (array sorted by key) */
  function upperBound(arr, t, key) { var lo = 0, hi = arr.length; while (lo < hi) { var mid = (lo + hi) >> 1; if (key(arr[mid]) <= t) lo = mid + 1; else hi = mid; } return lo; }
  function haversine(la1, lo1, la2, lo2) {
    var R = 6371000, p = Math.PI / 180, dLa = (la2 - la1) * p, dLo = (lo2 - lo1) * p;
    var a = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(la1 * p) * Math.cos(la2 * p) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  /* equirectangular projector with latitude cosine correction into a W×H box with fractional padding */
  function projector(bbox, W, H, pad) {
    var lat0 = (bbox[1] + bbox[3]) / 2, k = Math.cos(lat0 * Math.PI / 180) || 1;
    var dx = Math.max(1e-6, (bbox[2] - bbox[0]) * k), dy = Math.max(1e-6, bbox[3] - bbox[1]);
    var s = Math.min(W * (1 - 2 * pad) / dx, H * (1 - 2 * pad) / dy);
    var ox = (W - dx * s) / 2, oy = (H - dy * s) / 2;
    return { mPerPx: 111320 / s, xy: function (lon, lat) { return [ox + (lon - bbox[0]) * k * s, oy + (bbox[3] - lat) * s]; } };
  }
  function bboxOf(lonlat) { var b = [Infinity, Infinity, -Infinity, -Infinity]; lonlat.forEach(function (p) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; }); return b; }
  function pathD(xy) { var d = ''; for (var i = 0; i < xy.length; i++) d += (i ? 'L' : 'M') + xy[i][0].toFixed(1) + ' ' + xy[i][1].toFixed(1); return d; }
  function svgEl(tag, attrs) { var el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (var k in attrs) el.setAttribute(k, attrs[k]); return el; }
  /* backing store = CSS box × DPR (≤ 2); the fallbacks only matter when the stylesheet gave the canvas no box */
  function sizeCanvas(c, fbW, fbH) {
    var w = c.clientWidth || fbW, h = c.clientHeight || fbH; // can.css owns the box; the fallbacks only guard a missing stylesheet
    var bw = Math.round(w * DPR), bh = Math.round(h * DPR);
    if (c.width !== bw) c.width = bw; if (c.height !== bh) c.height = bh;
    return { w: w, h: h };
  }
  /* shared polyline helper (hero scope + Explorer strips): xs(i)/ys(i) give CSS px, a null/NaN y lifts the pen */
  function drawTrace(ctx, xs, ys, i0, i1, color, width, dash) {
    ctx.beginPath(); var pen = false;
    for (var i = i0; i <= i1; i++) { var y = ys(i); if (y == null || y !== y) { pen = false; continue; } var x = xs(i); if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; } }
    ctx.strokeStyle = color; ctx.lineWidth = width || 1.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
  }
  function hatch(ctx, color) { // 8 px diagonal hatch tile for the "openpilot transmitting" shading
    var c = document.createElement('canvas'); c.width = c.height = 8; var x = c.getContext('2d');
    x.strokeStyle = color; x.lineWidth = 1.5; x.beginPath(); x.moveTo(0, 8); x.lineTo(8, 0); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke();
    return ctx.createPattern(c, 'repeat');
  }

  /* ---------- data source: index.json is shared by the Explorer, the hero scope and the recorder cards ---------- */
  var sx = $('#sx'), srcOverride = null;
  try { var q = new URLSearchParams(location.search).get('canSrc'); if (q && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(q)) srcOverride = q; } catch (e) { /* no URLSearchParams */ }
  var indexSrc = srcOverride || (sx && sx.getAttribute('data-src')) || 'static/can/index.json';
  var base = indexSrc.replace(/[^\/]*$/, ''), indexP = null;
  function url(p) { return /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(p) ? p : base + p; }
  function loadIndex() {
    if (!indexP) indexP = fetchJSON(indexSrc).then(function (idx) { if (!idx || !Array.isArray(idx.clips) || !idx.clips.length) throw new Error('index.json has no clips[]'); return idx; });
    return indexP;
  }

  /* ---------- Access: swap the mailto card for the request form once a form URL is configured ---------- */
  (function () {
    var acc = $('#access'); if (!acc) return;
    var u = (acc.getAttribute('data-form-url') || '').trim();
    if (!u || u.indexOf('PLACEHOLDER') !== -1) return;
    var frame = $('#access-iframe'), form = $('#access-form'), req = $('#access-request'), status = $('#access-status');
    if (frame) frame.src = u;
    if (form) form.hidden = false;
    if (req) { req.href = u; req.target = '_blank'; req.rel = 'noopener'; }
    if (status) status.textContent = 'Request form: open. Last release: pre-release folders (Normal / Failure / Alert) on Dropbox.';
  })();

  /* ---------- availability matrix: column header buttons highlight one signal family ---------- */
  (function () {
    var mx = $('#mx'); if (!mx) return;
    var cols = $$('.mx__col', mx);
    cols.forEach(function (b) {
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        var col = b.getAttribute('data-col'), on = mx.getAttribute('data-hi') !== col;
        if (on) mx.setAttribute('data-hi', col); else mx.removeAttribute('data-hi');
        cols.forEach(function (x) { x.setAttribute('aria-pressed', String(on && x === b)); });
      });
    });
  })();

  /* ---------- spotlight tilt on .rec / .dec cards (ported from assets/dark/fx.js .tilt-card) ---------- */
  if (!reduce && window.matchMedia('(hover:hover) and (pointer:fine)').matches) {
    $$('.tilt').forEach(function (card) {
      card.addEventListener('pointermove', function (ev) {
        var r = card.getBoundingClientRect(); if (!r.width || !r.height) return;
        var mx = (ev.clientX - r.left) / r.width, my = (ev.clientY - r.top) / r.height;
        card.style.setProperty('--mx', (mx * 100).toFixed(1) + '%'); card.style.setProperty('--my', (my * 100).toFixed(1) + '%');
        card.style.transition = 'none';
        card.style.transform = 'perspective(900px) rotateX(' + ((0.5 - my) * 6).toFixed(2) + 'deg) rotateY(' + ((mx - 0.5) * 6).toFixed(2) + 'deg) translateY(-3px)';
      });
      card.addEventListener('pointerleave', function () { card.style.transition = 'transform .4s ease'; card.style.transform = ''; }); // soft snap-back
    });
  }

  /* ---------- Three recorders: numbers from dongles.json, route map from routes_map.json ---------- */
  var recGrid = $('#rec-grid'), recFoot = $('#rec-foot'), recmap = $('#recmap');
  var dongleOrder = $$('[data-dongle]', recGrid).map(function (a) { return a.getAttribute('data-dongle'); });
  if (!dongleOrder.length) dongleOrder = ['530075d26cad58e4', 'bdda168c0c35fad7', 'd5a6fb2f1b849a62'];
  /* accepts {<id>:{…}}, {dongles:{<id>:{…}}} or {dongles:[{dongle:<id>,…}]} → {<id>:{hours,km,routes}} */
  function dongleTable(d) {
    var out = {}; if (!d || typeof d !== 'object') return out;
    if (Array.isArray(d.dongles)) { d.dongles.forEach(function (r) { if (r && r.dongle) out[r.dongle] = r; }); return out; }
    var src = d.dongles && typeof d.dongles === 'object' ? d.dongles : d;
    Object.keys(src).forEach(function (k) { if (/^[0-9a-f]{8,}$/i.test(k) && src[k] && typeof src[k] === 'object') out[k] = src[k]; });
    return out;
  }
  /* route count: the aggregate writes `route_logs` (dataset directory count); older/other shapes use `routes` */
  function routesOf(r) { if (!r) return null; var v = [r.route_logs, r.routes, r.route_master_routes].filter(isNum)[0]; return isNum(v) ? v : null; }
  function fillDongles(d) {
    var tab = dongleTable(d), tot = { hours: 0, km: 0, routes: 0 }, any = false;
    $$('[data-dongle]', recGrid).forEach(function (card) {
      var r = tab[card.getAttribute('data-dongle')]; if (!r) return; any = true;
      var h = $('[data-rec="hours"]', card), k = $('[data-rec="km"]', card), n = $('[data-rec="routes"]', card), nr = routesOf(r);
      if (h && isNum(r.hours)) h.textContent = r.hours.toFixed(1);
      if (k && isNum(r.km)) k.textContent = fmtInt(r.km);
      if (n && isNum(nr)) n.textContent = fmtInt(nr);
    });
    Object.keys(tab).forEach(function (id) { var r = tab[id]; tot.hours += isNum(r.hours) ? r.hours : 0; tot.km += isNum(r.km) ? r.km : 0; tot.routes += routesOf(r) || 0; });
    var T = d.total || d.totals;
    if (T) { if (isNum(T.hours)) tot.hours = T.hours; if (isNum(T.km)) tot.km = T.km; var tr = routesOf(T); if (isNum(tr)) tot.routes = tr; }
    if (!any || !recFoot) return;
    var fh = $('[data-rec="total_hours"]', recFoot), fk = $('[data-rec="total_km"]', recFoot), fr = $('[data-rec="total_routes"]', recFoot);
    if (fh) fh.textContent = fmtInt(tot.hours); if (fk) fk.textContent = fmtInt(tot.km); if (fr) fr.textContent = fmtInt(tot.routes);
  }
  /* {bbox, dongles:{<id>:{routes:[{route,car_dir,coords|pts:[[lon,lat],…]}]}}} → one <path> per route, drawn as the figure scrolls in */
  function drawRecmap(data) {
    var svg = recmap && $('svg', recmap); if (!svg) return;
    recmap.hidden = true; if (!data) return; // stays hidden unless at least one route is drawable
    $$('.recmap__r, .recmap__label', svg).forEach(function (el) { svg.removeChild(el); }); // idempotent for OpenLKACan.reload()
    var D = data.dongles || {}, groups = [], all = [];
    if (Array.isArray(D)) D.forEach(function (g) { if (g && g.dongle) groups.push({ id: g.dongle, routes: g.routes || [] }); });
    else Object.keys(D).forEach(function (id) { groups.push({ id: id, routes: (D[id] && D[id].routes) || [] }); });
    groups.forEach(function (g) {
      g.lines = g.routes.map(function (r) { var c = (r && (r.coords || r.pts)) || (Array.isArray(r) ? r : []); return c.filter(function (p) { return p && isNum(p[0]) && isNum(p[1]); }); })
        .filter(function (c) { return c.length > 1; });
      g.lines.forEach(function (c) { all.push.apply(all, c); });
    });
    if (!all.length) return;
    recmap.hidden = false;
    var pr = projector(data.bbox && data.bbox.length === 4 ? data.bbox : bboxOf(all), 600, 400, 0.05), paths = [];
    groups.forEach(function (g, gi) {
      var k = dongleOrder.indexOf(g.id); if (k < 0) k = gi; k %= 3;
      g.lines.forEach(function (c) {
        var p = svgEl('path', { 'class': 'recmap__r recmap__r--' + k, d: pathD(c.map(function (q) { return pr.xy(q[0], q[1]); })), fill: 'none', 'data-dongle': g.id });
        svg.appendChild(p); paths.push(p);
      });
      var lbl = svgEl('text', { 'class': 'recmap__label recmap__label--' + k, x: 16, y: 22 + 16 * k, 'data-dongle': g.id });
      lbl.textContent = g.id.slice(0, 8) + '… · ' + g.lines.length + ' route' + (g.lines.length === 1 ? '' : 's'); svg.appendChild(lbl);
    });
    // progressive drawing: can.css transitions stroke-dashoffset from --len to 0 once .is-drawn is set (--i staggers, reduced motion overrides)
    var N = paths.length;
    paths.forEach(function (p, i) { var L = 0; try { L = p.getTotalLength(); } catch (e) { /* not rendered */ } p.style.setProperty('--len', (L || 1).toFixed(1)); p.style.setProperty('--i', (i * 12 / N).toFixed(2)); });
    var reveal = function () { paths.forEach(function (p) { p.classList.add('is-drawn'); }); recmap.classList.add('is-drawn'); };
    if (reduce || !('IntersectionObserver' in window)) { reveal(); return; }
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); requestAnimationFrame(reveal); } }, { threshold: 0.15 });
    io.observe(recmap);
  }

  /* ---------- hero oscilloscope: three real traces from hero-trace.json streamed right-to-left ---------- */
  function initHero() {
    var cv = $('#hero-scope'), hero = $('.hero'), tag = $('#hero-scope-tag');
    if (!cv || !hero || reduce || window.innerWidth < 768 || !cv.getContext) return;
    afterLoad(function () {
      onIdle(function () {
        loadIndex().then(function (idx) { return fetchJSON(url(idx.hero_trace || 'hero-trace.json')).then(function (tr) { return { idx: idx, tr: tr }; }); })
          .then(start).catch(function (e) { dbg('hero scope off:', e && e.message); });
      });
    });
    function start(r) {
      var cols = (r.tr && r.tr.cols) || {}, hz = (r.tr && r.tr.hz) || 10, root = document.documentElement;
      var series = [['steer_angle_deg', '--lk-blue-2', '#2563eb'], ['lane_dev_m', '--lk-orange', '#c2410c'], ['v_ego_mps', '--lk-green-mid', '#0a8f62']].map(function (s) {
        var a = cols[s[0]]; if (!Array.isArray(a) || a.length < 2) return null;
        var lo = Infinity, hi = -Infinity; a.forEach(function (v) { if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } });
        if (!isFinite(lo)) return null; if (!(hi > lo)) hi = lo + 1;
        return { a: a, lo: lo, hi: hi, color: cssVar(root, s[1], s[2]) };
      }).filter(Boolean);
      if (!series.length) return;
      var n = series[0].a.length, cyc = 2 * n, PX = 3; // px per sample; the trace ping-pongs through the data so the loop has no seam
      var clip = r.idx.clips.filter(function (c) { return c.id === (r.tr.clip || r.idx['default']); })[0] || r.idx.clips[0];
      if (tag && clip) tag.textContent = 'live · decoded CAN · ' + ([clip.make, clip.model].filter(Boolean).join(' ') || 'lab fleet') + ' · 100 Hz';
      hero.classList.add('scope-on');
      var ctx = cv.getContext('2d'), box = sizeCanvas(cv, 1200, 420), running = false, raf = 0, t0 = performance.now(), vis = true;
      function frame(now) {
        raf = 0; if (!running) return;
        var W = box.w, H = box.h; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(100,116,139,.28)'; ctx.lineWidth = 1; ctx.beginPath();
        for (var gx = 40.5; gx < W; gx += 80) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
        for (var gy = 0.5 + H / 6; gy < H; gy += H / 6) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
        ctx.stroke();
        var phase = (now - t0) / 1000 * hz, jEnd = Math.floor(phase), jStart = jEnd - Math.ceil(W / PX) - 2;
        series.forEach(function (s, k) {
          var top = H * k / 3 + 8, hgt = H / 3 - 16;
          drawTrace(ctx, function (j) { return W - (phase - j) * PX; }, function (j) {
            var m = ((j % cyc) + cyc) % cyc, v = s.a[m < n ? m : cyc - 1 - m];
            return isNum(v) ? top + (s.hi - v) / (s.hi - s.lo) * hgt : null;
          }, jStart, jEnd, s.color, 1.5);
        });
        raf = requestAnimationFrame(frame);
      }
      function run() { running = vis && !document.hidden; if (running && !raf) raf = requestAnimationFrame(frame); }
      if ('ResizeObserver' in window) { var rt = 0; new ResizeObserver(function () { clearTimeout(rt); rt = setTimeout(function () { box = sizeCanvas(cv, 1200, 420); }, 120); }).observe(cv); }
      if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { vis = es[es.length - 1].isIntersecting; run(); }, { threshold: 0 }).observe(hero);
      document.addEventListener('visibilitychange', run);
      run();
    }
  }

  /* =====================================================================
     Signal Explorer (#sx): one clip, every decoded channel on one clock
     ===================================================================== */
  var PX_PER_M = 82, LANE_CX = 180, DEFAULT_LANE_W = 3.66;
  var STRIPS = { // one canvas.sx__strip[data-sig] each; `c` names the colour read from the --sx-c-* tokens
    speed: { label: 'speed', unit: 'mph', col: 'v_ego_mps', c: 'speed' },
    steer: { label: 'steering angle', unit: 'deg · thin: assist torque', col: 'steer_angle_deg', c: 'angle', extra: 'steer_torque' },
    dev: { label: 'lane deviation', unit: 'm · + left', col: 'lane_dev_m', c: 'dev', bands: true },
    prob: { label: 'lane-line confidence', unit: 'L · R', col: 'op_prob_l', col2: 'op_prob_r', c: 'speed', c2: 'violet' }
  };
  var EV_GLYPH = { takeover: 'T', lka_on: '+', lka_off: '−', line_lost: 'L', line_back: 'L', dev_peak: 'D', brake: 'B', lane_change: '⇄' };
  var KEY_RX = /LKA|LFA|LKAS|STEER|TORQUE|LatCtl|LTA|HCA|EPS|DAS_|LANE|LINE/i; // messages that carry the plotted families

  function initExplorer(root) {
    var video = $('#sx-video', root); if (!video) return null;
    var playBtn = $('#sx-play', root), picker = $('#sx-picker', root), tip = $('#sx-tip', root), scrub = $('#sx-scrub', root);
    var lka = $('#sx-lka', root), codeL = $('#sx-codeL', root), codeR = $('#sx-codeR', root), speedEl = $('#sx-speed', root);
    var lineL = $('#sx-lineL', root), lineR = $('#sx-lineR', root), car = $('#sx-car', root), devTxt = $('#sx-dev-txt', root);
    var wheel = $('#sx-wheel', root), angleEl = $('#sx-angle', root), optx = $('#sx-optx', root), winBtn = $('#sx-window', root);
    var evList = $('#sx-events', root), tickRows = $('#sx-tick-rows', root), statusEl = $('#sx-status', root), errEl = $('#sx-error', root);
    var routeFig = $('#sx-route', root), routeAll = $('#sx-route-all', root), routeDone = $('#sx-route-done', root), routeDot = $('#sx-route-dot', root);
    var routeScale = $('#sx-route-scale', root), routeCap = $('#sx-route-cap', root), blurb = $('#sx-blurb', root), framesTbody = $('#sx-frames-table tbody', root);
    var meta = { dongle: $('#sx-m-dongle', root), car: $('#sx-m-car', root), route: $('#sx-m-route', root), system: $('#sx-m-system', root), decoder: $('#sx-m-decoder', root) };
    var st = { index: null, clip: null, sig: null, track: null, frames: null, t: 0, playing: false, visible: false, visible50: false, dirty: true,
      cache: new Map(), abort: null, hz: 10, n: 0, t0: 0, dur: 0, lkaRuns: [], txRuns: [], hasTx: false, events: [], ranges: {}, colors: {},
      hover: null, drag: null, fi: -1, tickT: -Infinity, userPaused: false, scrubbing: false, lastText: 0, prevT: 0, vfcOn: false, route: null, moment: null };
    var strips = $$('canvas.sx__strip', root).map(function (c) { var spec = STRIPS[c.getAttribute('data-sig')]; return spec && c.getContext ? { el: c, spec: spec, ctx: c.getContext('2d'), w: 0, h: 0 } : null; }).filter(Boolean);
    var tabs = [], evButtons = [], tickRowEls = [], raf = 0, vfcId = 0, annT = 0;

    /* ----- sampling ----- */
    function col(name) { return st.sig ? st.sig.cols[name] || null : null; }
    function tOf(i) { return st.t0 + i / st.hz; }
    function idxAt(t) { return st.n ? clamp(Math.round((t - st.t0) * st.hz), 0, st.n - 1) : 0; }
    function at(name, i) { var c = col(name); if (!c) return null; var v = c[i]; return v == null ? null : v; }
    function lerpAt(name, t) { // linear between neighbouring samples for the car and the wheel
      var c = col(name); if (!c || !st.n) return null;
      var f = (t - st.t0) * st.hz, i = clamp(Math.floor(f), 0, st.n - 1), j = Math.min(st.n - 1, i + 1), a = c[i], b = c[j];
      if (!isNum(a)) return isNum(b) ? b : null; if (!isNum(b)) return a; return a + (b - a) * clamp(f - i, 0, 1);
    }
    function runs(name) { // run-length [tStart, tEnd] intervals where a 0/1 column is 1
      var c = col(name), out = [], on = -1; if (!c) return out;
      for (var i = 0; i < st.n; i++) { var v = c[i] === 1 || c[i] === true; if (v && on < 0) on = i; if (!v && on >= 0) { out.push([tOf(on), tOf(i)]); on = -1; } }
      if (on >= 0) out.push([tOf(on), tOf(st.n)]); return out;
    }
    function rangeOf(name, symFloor) {
      var c = col(name), lo = Infinity, hi = -Infinity;
      if (c) for (var i = 0; i < c.length; i++) { var v = c[i]; if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      if (symFloor != null) { var m = Math.max(Math.abs(lo), Math.abs(hi), symFloor) * 1.1; return [-m, m]; }
      return [Math.min(0, lo), Math.max(hi * 1.1, lo + 1)];
    }
    function readColors() {
      st.colors = { speed: cssVar(root, '--sx-c-speed', '#33e0ff'), angle: cssVar(root, '--sx-c-angle', '#b07cff'), dev: cssVar(root, '--sx-c-dev', '#f0c34e'),
        lka: cssVar(root, '--sx-c-lka', '#33e0ff'), violet: cssVar(root, '--cl-violet', '#b07cff'), mute: cssVar(root, '--cl-text-mute', '#9fb2d6'),
        text: cssVar(root, '--cl-text', '#e8eefc'), ok: cssVar(root, '--cl-ok', '#3ddc97'), crit: cssVar(root, '--cl-crit', '#ff6b6b'), ev: cssVar(root, '--cl-gold', '#f0c34e') };
    }
    function windowAt(t) { if (st.drag && st.drag.win) return st.drag.win; return root.classList.contains('is-full') ? [0, st.dur || 1] : [t - 15, t + 5]; }

    /* ----- strips ----- */
    function sizeStrips() { strips.forEach(function (s) { var b = sizeCanvas(s.el, 600, 68); s.w = b.w; s.h = b.h; }); readColors(); st.dirty = true; kick(); }
    function valueText(spec, t) {
      if (!st.sig) return '—'; var i = idxAt(t);
      if (spec.col === 'v_ego_mps') { var v = at('v_ego_mps', i); return isNum(v) ? Math.round(v * MPH) + ' mph' : '—'; }
      if (spec.col === 'steer_angle_deg') { var a = at('steer_angle_deg', i), tq = at('steer_torque', i); return (isNum(a) ? signed(a, 1) + '°' : '—') + (isNum(tq) ? ' · τ ' + Math.round(tq) : ''); }
      if (spec.col === 'lane_dev_m') { var d = at('lane_dev_m', i); return isNum(d) ? signed(d, 2) + ' m' : '—'; }
      var l = at('op_prob_l', i), r = at('op_prob_r', i); return 'L ' + (isNum(l) ? l.toFixed(2) : '—') + ' · R ' + (isNum(r) ? r.toFixed(2) : '—');
    }
    function codeRibbons(ctx, i0, i1, xs, H) { // 3 px ribbons: the car's own line code (1 solid, 2 faded, 3 departure) for L (top) and R (bottom)
      var C = st.colors, map = { good: C.ok, mid: C.ev, bad: C.crit };
      [['line_code_l', 0], ['line_code_r', H - 3]].forEach(function (d) {
        var c = col(d[0]); if (!c) return; var run = i0, cur = c[i0];
        for (var i = i0 + 1; i <= i1 + 1; i++) {
          var v = i <= i1 ? c[i] : NaN;
          if (v !== cur) { var fill = map[levelOf(cur)]; if (fill) { ctx.globalAlpha = 0.7; ctx.fillStyle = fill; ctx.fillRect(xs(run), d[1], Math.max(1, xs(i) - xs(run)), 3); } run = i; cur = v; }
        }
      });
      ctx.globalAlpha = 1;
    }
    function drawStrip(s, t, win) {
      var ctx = s.ctx, W = s.w, H = s.h; if (!W || !H) return;
      var C = st.colors, spec = s.spec, w0 = win[0], w1 = win[1], span = (w1 - w0) || 1, TOP = 15, BOT = 4, PH = H - TOP - BOT;
      var rng = st.ranges[spec.col] || [0, 1], lo = rng[0], hi = rng[1];
      var xOfT = function (tt) { return (tt - w0) / span * W; }, yOf = function (v) { return TOP + (hi - v) / (hi - lo) * PH; };
      var shade = function (r) { if (r[1] < w0 || r[0] > w1) return; var a = xOfT(Math.max(r[0], w0)), b = xOfT(Math.min(r[1], w1)); ctx.fillRect(a, 0, Math.max(1, b - a), H); };
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = 0.12; ctx.fillStyle = C.lka; st.lkaRuns.forEach(shade);                      // 1. stock LKA active
      if (st.txRuns.length) { ctx.globalAlpha = 0.35; ctx.fillStyle = s.hatch || (s.hatch = hatch(ctx, C.violet)); st.txRuns.forEach(shade); } // 2. openpilot transmitting
      if (spec.bands) [[0.25, C.ok, 0.10], [0.65, C.crit, 0.08]].forEach(function (b) { ctx.globalAlpha = b[2]; ctx.fillStyle = b[1]; var y1 = yOf(b[0]); ctx.fillRect(0, y1, W, yOf(-b[0]) - y1); }); // 3. ±0.25 / ±0.65 m
      ctx.globalAlpha = 0.18; ctx.strokeStyle = C.mute; ctx.lineWidth = 1; ctx.beginPath();                   // 4. grid + zero line
      for (var g = 1; g <= 3; g++) { var gy = Math.round(TOP + PH * g / 4) + 0.5; ctx.moveTo(0, gy); ctx.lineTo(W, gy); } ctx.stroke();
      if (lo < 0 && hi > 0) { ctx.globalAlpha = 0.45; ctx.beginPath(); var zy = Math.round(yOf(0)) + 0.5; ctx.moveTo(0, zy); ctx.lineTo(W, zy); ctx.stroke(); }
      ctx.globalAlpha = 1;
      if (st.sig && st.n) {                                                                                    // 5. traces
        var i0 = clamp(Math.floor((w0 - st.t0) * st.hz) - 1, 0, st.n - 1), i1 = clamp(Math.ceil((w1 - st.t0) * st.hz) + 1, 0, st.n - 1);
        var xs = function (i) { return xOfT(tOf(i)); };
        var mk = function (name, r) { var c = col(name); return c ? function (i) { var v = c[i]; return isNum(v) ? TOP + (r[1] - v) / (r[1] - r[0]) * PH : null; } : null; };
        var yx = spec.extra && mk(spec.extra, st.ranges[spec.extra] || [-1, 1]); if (yx) drawTrace(ctx, xs, yx, i0, i1, C.violet, 1);
        var y1f = mk(spec.col, rng); if (y1f) drawTrace(ctx, xs, y1f, i0, i1, C[spec.c], 1.5);
        if (spec.col2) { var y2f = mk(spec.col2, rng); if (y2f) drawTrace(ctx, xs, y2f, i0, i1, C[spec.c2], 1.5); codeRibbons(ctx, i0, i1, xs, H); }
      }
      st.events.forEach(function (ev) {                                                                        // 6. event markers
        if (ev.t < w0 || ev.t > w1) return; var x = Math.round(xOfT(ev.t)) + 0.5;
        ctx.globalAlpha = 0.8; ctx.strokeStyle = C.ev; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]);
        if (s === strips[0]) { ctx.globalAlpha = 1; ctx.fillStyle = C.ev; ctx.fillRect(x - 6, 1, 12, 12); ctx.fillStyle = '#0a1428'; ctx.font = '700 9px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(EV_GLYPH[ev.kind] || '•', x, 7.5); }
      });
      if (st.hover != null && st.hover >= w0 && st.hover <= w1) {                                              // 7. hover + cursor
        var hx = Math.round(xOfT(st.hover)) + 0.5; ctx.globalAlpha = 0.7; ctx.strokeStyle = C.mute; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, H); ctx.stroke(); ctx.setLineDash([]);
      }
      var cx = Math.round(xOfT(t)) + 0.5; ctx.globalAlpha = 0.9; ctx.strokeStyle = C.text; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
      ctx.globalAlpha = 1; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = C.mute; ctx.font = '500 10.5px ' + SANS; // 8. label + value
      ctx.fillText(spec.label + ' · ' + spec.unit, 6, 3);
      ctx.textAlign = 'right'; ctx.fillStyle = C.text; ctx.font = '600 11px ' + MONO; ctx.fillText(valueText(spec, t), W - 6, 3);
    }

    /* ----- lane widget, wheel, HUD text ----- */
    function updateLane(t) {
      var dev = lerpAt('lane_dev_m', t), w = lerpAt('lane_width_m', t), ang = lerpAt('steer_angle_deg', t), i = idxAt(t);
      var half = (isNum(w) ? clamp(w, 2.5, 4.5) : DEFAULT_LANE_W) / 2 * PX_PER_M;
      [[lineL, LANE_CX - half, 'op_prob_l', 'line_code_l'], [lineR, LANE_CX + half, 'op_prob_r', 'line_code_r']].forEach(function (d) {
        var el = d[0]; if (!el) return; var x = d[1].toFixed(1); el.setAttribute('x1', x); el.setAttribute('x2', x);
        var p = at(d[2], i), code = at(d[3], i), faded = isNum(p) && p < 0.3;
        el.style.opacity = isNum(p) ? (0.25 + 0.75 * clamp(p, 0, 1)).toFixed(2) : '';
        el.classList.toggle('is-faded', faded); el.style.strokeDasharray = faded ? '4 6' : ''; // inline so it wins over the stylesheet's dash on the right line
        el.setAttribute('data-code', levelOf(code));
      });
      if (car) car.style.transform = 'translate(' + (isNum(dev) ? -clamp(dev, -1.5, 1.5) * PX_PER_M : 0).toFixed(1) + 'px, 0)'; // + dev = car left of centre
      if (wheel) wheel.style.transform = 'rotate(' + (isNum(ang) ? -ang : 0).toFixed(2) + 'deg)';                                  // + angle = left = counter-clockwise
      return { dev: dev, ang: ang };
    }
    var LEVEL_BY_LABEL = { solid: 'good', faded: 'mid', departure: 'bad', orange: 'bad', none: 'none', 'not detected': 'none' }, LEVEL_BY_CODE = { 0: 'none', 1: 'good', 2: 'mid', 3: 'bad' };
    function codeLabel(code) { var names = st.sig && st.sig.codes && st.sig.codes.line_code; return (names && names[String(code)]) || String(code); }
    function levelOf(code) { // make-aware severity: codes.line_code_level, else by label, else the paper's numeric convention; 'na' when the make has no codes
      if (!isNum(code) || code < 0) return 'na';
      var lv = st.sig && st.sig.codes && st.sig.codes.line_code_level, v = lv && lv[String(code)];
      if (v) return String(v);
      return LEVEL_BY_LABEL[String(codeLabel(code)).toLowerCase()] || LEVEL_BY_CODE[code] || 'none';
    }
    function codeText(el, side, code) {
      if (!el) return; var lv = levelOf(code);
      el.setAttribute('data-code', lv); setText(el, side + ' line ' + (lv === 'na' ? '—' : codeLabel(code)));
    }
    function updateText(t, lane) {
      var i = idxAt(t), v = at('v_ego_mps', i), on = at('lka_on', i), state = on === 1 ? 'on' : on === 0 ? 'off' : 'na';
      if (lka) { lka.setAttribute('data-state', state); setText(lka, state === 'on' ? 'LKA active' : state === 'off' ? 'LKA off' : 'LKA n/a' + (st.clip && st.clip.make ? ' (' + st.clip.make + ')' : '')); }
      codeText(codeL, 'L', at('line_code_l', i)); codeText(codeR, 'R', at('line_code_r', i));
      if (speedEl) { setText(speedEl, isNum(v) ? Math.round(v * MPH) + ' mph' : '— mph'); speedEl.title = isNum(v) ? v.toFixed(1) + ' m/s' : ''; }
      setText(angleEl, (isNum(lane.ang) ? lane.ang.toFixed(1) : '0.0') + '°');
      setText(devTxt, isNum(lane.dev) ? 'deviation ' + signed(lane.dev, 2) + ' m (' + (lane.dev >= 0 ? 'left' : 'right') + ')' : 'deviation — m');
      if (scrub && !st.scrubbing) {
        scrub.value = String(Math.round(t * 10));
        scrub.setAttribute('aria-valuetext', t.toFixed(1) + ' s of ' + Math.round(st.dur) + (state === 'on' ? '; LKA active' : state === 'off' ? '; LKA off' : '') +
          (isNum(lane.dev) ? '; ' + Math.abs(lane.dev).toFixed(2) + ' m ' + (lane.dev >= 0 ? 'left' : 'right') : ''));
      }
      evButtons.forEach(function (b) { var et = parseFloat(b.getAttribute('data-t')); b.classList.toggle('is-now', Math.abs(t - et) <= 1); b.classList.toggle('is-past', t > et + 1); });
      if (st.route && routeCap) setText(routeCap, 'GPS track at 1 Hz · bright = driven so far · ' + (st.route.distAt(t) / 1000).toFixed(1) + ' km driven');
    }

    /* ----- raw-frame ticker (14 recycled rows) and the static frames table ----- */
    function addrHex(f) { return f.addr_hex || ('0x' + (f.addr || 0).toString(16).toUpperCase().padStart(3, '0')); }
    function hexStr(d, maxBytes) { if (!d) return '—'; var s = String(d).replace(/\s+/g, ''), cut = s.length > maxBytes * 2; s = s.slice(0, maxBytes * 2).replace(/(..)/g, '$1 ').trim(); return cut ? s + ' …' : s; }
    function decoded(f) { var sg = f.signals; if (!sg || typeof sg !== 'object') return '—'; return Object.keys(sg).slice(0, 4).map(function (k) { var v = sg[k]; return k + '=' + (isNum(v) ? (Number.isInteger(v) ? v : v.toFixed(2)) : v); }).join(' · ') || '—'; }
    function isKey(f) { if (f._key == null) f._key = KEY_RX.test(f.msg || '') || !!(f.signals && Object.keys(f.signals).some(function (k) { return KEY_RX.test(k); })); return f._key; }
    function buildTicker() { // 14 recycled rows, created once a clip actually has frames (an empty list keeps the stylesheet's :empty state)
      if (!tickRows || tickRowEls.length) return;
      for (var k = 0; k < 14; k++) {
        var li = document.createElement('li'); li.className = 'tick__row'; li._c = {};
        ['tk__t', 'tk__addr', 'tk__name', 'tk__hex', 'tk__dec'].forEach(function (cls) { var sp = document.createElement('span'); sp.className = cls; li.appendChild(sp); li._c[cls] = sp; });
        tickRows.appendChild(li); tickRowEls.push(li);
      }
    }
    function fillRow(li, f) {
      var c = li._c; li.classList.toggle('is-key', !!f && isKey(f));
      if (!f) { Object.keys(c).forEach(function (k) { c[k].textContent = ''; }); return; }
      c.tk__t.textContent = f.t.toFixed(3); c.tk__addr.textContent = (f.bus == null ? '?' : f.bus) + ' · ' + addrHex(f); c.tk__name.textContent = f.msg || '—';
      c.tk__hex.textContent = hexStr(f.data, 8); c.tk__dec.textContent = decoded(f);
    }
    function tickerAt(t) { // rows show the last 14 frames with frames[i].t <= t; binary-search reset on seeks, sequential advance otherwise
      var fr = st.frames; if (!tickRowEls.length || !fr || !fr.length) return;
      var fi = st.fi;
      if (fi < 0 || t < st.tickT || t - st.tickT > 2) fi = upperBound(fr, t, function (f) { return f.t; }); else while (fi < fr.length && fr[fi].t <= t) fi++;
      st.tickT = t; if (fi === st.fi) return; st.fi = fi;
      var start = clamp(fi - 14, 0, Math.max(0, fr.length - 14)); // the last 14 frames ≤ t, padded with the next frames so the ticker is never empty
      for (var k = 0; k < 14; k++) { var f = fr[start + k] || null; fillRow(tickRowEls[k], f); tickRowEls[k].classList.toggle('is-future', !!f && f.t > t); }
    }
    function fillFramesTable(fr) {
      if (!framesTbody) return; framesTbody.innerHTML = ''; if (!fr || !fr.length) return;
      var m = st.moment != null ? st.moment : fr[fr.length >> 1].t;
      fr.slice().sort(function (a, b) { return Math.abs(a.t - m) - Math.abs(b.t - m); }).slice(0, 24).sort(function (a, b) { return a.t - b.t; }).forEach(function (f) {
        var tr = document.createElement('tr');
        [f.t.toFixed(3), f.bus == null ? '—' : f.bus, addrHex(f), f.msg || '—', hexStr(f.data, 16), decoded(f)].forEach(function (v) { var td = document.createElement('td'); td.textContent = String(v); tr.appendChild(td); });
        framesTbody.appendChild(tr);
      });
    }

    /* ----- GPS track: grey path, bright share by cumulative distance, dot via getPointAtLength ----- */
    function applyTrack(track) {
      st.route = null; if (routeDot) { routeDot.setAttribute('cx', -10); routeDot.setAttribute('cy', -10); } if (routeScale) routeScale.innerHTML = '';
      var pts = track && Array.isArray(track.pts) ? track.pts.filter(function (p) { return p && isNum(p[1]) && isNum(p[2]); }) : [];
      if (!routeFig || !routeAll || !routeDone || pts.length < 2) { if (routeFig) routeFig.hidden = true; return; }
      routeFig.hidden = false;
      var pr = projector(track.bbox && track.bbox.length === 4 ? track.bbox : bboxOf(pts.map(function (p) { return [p[2], p[1]]; })), 300, 200, 0.08);
      var d = pathD(pts.map(function (p) { return pr.xy(p[2], p[1]); })); routeAll.setAttribute('d', d); routeDone.setAttribute('d', d);
      var L = 0; try { L = routeDone.getTotalLength(); } catch (e) { /* not rendered */ } L = L || 1;
      routeDone.style.strokeDasharray = L + ' ' + L;
      var cum = [0]; for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1][1], pts[i - 1][2], pts[i][1], pts[i][2]));
      var total = cum[cum.length - 1] || 1, tArr = pts.map(function (p, k) { return isNum(p[0]) ? p[0] : k; });
      if (routeScale) { var bar = 500 / pr.mPerPx; if (bar >= 24 && bar <= 180) { routeScale.appendChild(svgEl('line', { x1: 12, y1: 190, x2: (12 + bar).toFixed(1), y2: 190 })); var tx = svgEl('text', { x: 12, y: 184 }); tx.textContent = '500 m'; routeScale.appendChild(tx); } }
      st.route = { L: L, total: total, distAt: function (t) { var k = upperBound(tArr, t, function (x) { return x; }); if (k <= 0) return 0; if (k >= tArr.length) return total; var a = tArr[k - 1], b = tArr[k]; return cum[k - 1] + (cum[k] - cum[k - 1]) * (b > a ? (t - a) / (b - a) : 0); } };
    }
    function routeAt(t) {
      var r = st.route; if (!r) return; var frac = clamp(r.distAt(t) / r.total, 0, 1);
      routeDone.style.strokeDashoffset = (r.L * (1 - frac)).toFixed(1);
      if (routeDot) { try { var p = routeDone.getPointAtLength(r.L * frac); routeDot.setAttribute('cx', p.x.toFixed(1)); routeDot.setAttribute('cy', p.y.toFixed(1)); } catch (e) { /* not rendered */ } }
    }

    /* ----- render + sync loop (requestVideoFrameCallback when available, rAF otherwise) ----- */
    function render(now) {
      var t = st.t, win = windowAt(t);
      strips.forEach(function (s) { drawStrip(s, t, win); });
      var lane = updateLane(t); tickerAt(t); routeAt(t);
      if (!st.playing || now - st.lastText >= 100) { st.lastText = now; updateText(t, lane); }
      if (st.playing) st.events.forEach(function (ev) { if (st.prevT < ev.t && ev.t <= t) announce(ev.label || ev.kind); });
      st.prevT = t;
    }
    function tick(now) {
      raf = 0;
      if (st.playing && !st.vfcOn) { st.t = video.currentTime || 0; st.dirty = true; }
      if (st.dirty) { st.dirty = false; render(now); }
      if (st.playing) raf = requestAnimationFrame(tick);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(tick); }
    function startVFC() {
      if (!video.requestVideoFrameCallback || vfcId) return; st.vfcOn = true;
      (function req() { vfcId = video.requestVideoFrameCallback(function (now, m) { vfcId = 0; st.t = m.mediaTime; st.dirty = true; kick(); if (st.playing) req(); else st.vfcOn = false; }); })();
    }
    function stopVFC() { if (vfcId && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(vfcId); vfcId = 0; st.vfcOn = false; }
    function announce(msg) { if (!statusEl) return; clearTimeout(annT); annT = setTimeout(function () { statusEl.textContent = msg; }, 150); }
    function setPlaying(on) {
      if (st.playing === on) return; st.playing = on; root.classList.toggle('is-playing', on);
      if (car) car.style.transition = on ? 'none' : ''; // per-frame updates while playing; the stylesheet's .25 s glide only for seeks when paused
      if (playBtn) { playBtn.setAttribute('aria-pressed', String(on)); playBtn.setAttribute('aria-label', on ? 'Pause clip' : 'Play clip'); }
      if (on) { startVFC(); kick(); announce('Playing' + (st.clip && st.clip.title ? ': ' + st.clip.title : '')); }
      else { stopVFC(); st.t = video.currentTime || st.t; st.dirty = true; kick(); announce('Paused at ' + st.t.toFixed(1) + ' s'); }
    }
    function modalOpen() { return ['#vmodal', '#lightbox'].some(function (s) { var m = $(s); return m && !m.hidden; }); }
    function play() {
      if (!video.getAttribute('src')) return; video.muted = true;
      var p = null; try { p = video.play(); } catch (e) { /* old API */ }
      if (p && p.catch) p.catch(function (e) { dbg('play() blocked:', e && e.name); setPlaying(false); });
    }
    function toggle() { if (st.playing) { st.userPaused = true; video.pause(); } else { st.userPaused = false; play(); } }
    function maybeAutoplay() {
      if (st.playing || st.userPaused || !st.sig || !st.visible50 || reduce || document.hidden || window.innerWidth < 768 || (navigator.connection && navigator.connection.saveData) || modalOpen()) return;
      play();
    }
    function seek(t, from) {
      t = clamp(+t || 0, 0, st.dur || video.duration || 0);
      try { video.currentTime = t; } catch (e) { /* no metadata yet: Chrome keeps it as the start position */ }
      st.t = t; st.dirty = true; kick();
      if (from !== 'scrub' && scrub) scrub.value = String(Math.round(t * 10));
      announce('Seeked to ' + t.toFixed(1) + ' s');
    }

    /* ----- picker, events list, meta ----- */
    function buildPicker(idx) {
      tabs = []; if (!picker) return; picker.innerHTML = ''; picker.hidden = false;
      idx.clips.forEach(function (c) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'sx__tab'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', 'false'); b.setAttribute('data-clip', c.id); b.tabIndex = -1;
        var img = document.createElement('img'); img.className = 'sx__tab-thumb'; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; if (c.files && c.files.poster) img.src = url(c.files.poster);
        var ti = document.createElement('span'); ti.className = 'sx__tab-title'; ti.textContent = c.title || c.id;
        var sub = document.createElement('span'); sub.className = 'sx__tab-sub';
        sub.textContent = [[c.make, c.model].filter(Boolean).join(' '), c.dongle ? String(c.dongle).slice(0, 8) + '…' : '', c.where].filter(Boolean).join(' · ');
        b.appendChild(img); b.appendChild(ti); b.appendChild(sub);
        b.addEventListener('click', function () { selectClip(c.id); });
        b.addEventListener('keydown', function (ev) {
          var i = tabs.indexOf(b), j = i;
          if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') j = (i + 1) % tabs.length; else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') j = (i - 1 + tabs.length) % tabs.length;
          else if (ev.key === 'Home') j = 0; else if (ev.key === 'End') j = tabs.length - 1; else return;
          ev.preventDefault(); tabs[j].focus(); selectClip(tabs[j].getAttribute('data-clip'));
        });
        picker.appendChild(b); tabs.push(b);
      });
    }
    function markTab(id) { tabs.forEach(function (b) { var on = b.getAttribute('data-clip') === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }); }
    function buildEvents(evs) {
      evButtons = []; if (!evList) return; evList.innerHTML = '';
      evs.forEach(function (ev) {
        var li = document.createElement('li'), b = document.createElement('button'); b.type = 'button'; b.className = 'sx__ev'; b.setAttribute('data-t', String(ev.t)); b.setAttribute('data-kind', ev.kind || 'custom');
        var tm = document.createElement('time'); tm.className = 'sx__ev-t'; tm.textContent = fmtClock(ev.t);
        var l = document.createElement('span'); l.className = 'sx__ev-l'; l.textContent = ev.label || ev.kind || 'event';
        b.appendChild(tm); b.appendChild(l); b.addEventListener('click', function () { seek(ev.t); });
        li.appendChild(b); evList.appendChild(li); evButtons.push(b);
      });
    }
    function fillMeta(c) {
      setText(meta.dongle, c.dongle || '—'); setText(meta.car, [c.make, c.model].filter(Boolean).join(' ') || '—');
      setText(meta.route, [c.route, c.start_eastern].filter(Boolean).join(' · ') || '—'); setText(meta.system, c.system_label || '—');
      setText(meta.decoder, [c.decoder, Array.isArray(c.dbc) ? c.dbc.join(', ') : c.dbc].filter(Boolean).join(' · ') || '—');
      if (blurb) blurb.textContent = c.blurb || '';
    }

    /* ----- clip data ----- */
    function applySignals(sig) {
      st.sig = sig && sig.cols && Array.isArray(sig.cols.t) && sig.cols.t.length ? sig : null;
      st.lkaRuns = []; st.txRuns = []; st.events = []; st.ranges = {}; st.hasTx = false; st.lastText = 0;
      if (!st.sig) { st.n = 0; st.hz = 10; st.t0 = 0; st.dur = video.duration || 0; root.classList.remove('is-live'); }
      else {
        var c = sig.cols; st.hz = sig.hz || 10; st.n = Math.min(sig.n || c.t.length, c.t.length); st.t0 = isNum(c.t[0]) ? c.t[0] : 0; st.dur = sig.duration_s || st.n / st.hz;
        st.lkaRuns = runs('lka_on'); st.txRuns = runs('op_tx'); st.hasTx = st.txRuns.length > 0;
        var sp = rangeOf('v_ego_mps');
        st.ranges = { v_ego_mps: [0, Math.max(sp[1], 5)], steer_angle_deg: rangeOf('steer_angle_deg', 5), steer_torque: rangeOf('steer_torque', 1), lane_dev_m: rangeOf('lane_dev_m', 0.8), op_prob_l: [0, 1], op_prob_r: [0, 1] };
        st.events = (sig.events || []).filter(function (e) { return e && isNum(e.t); }).sort(function (a, b) { return a.t - b.t; });
        root.classList.add('is-live');
      }
      buildEvents(st.events); if (optx) optx.hidden = !st.hasTx;
      if (scrub) { scrub.max = String(Math.max(1, Math.round(st.dur * 10))); scrub.step = '1'; scrub.value = '0'; }
      st.dirty = true; kick();
    }
    function applyFrames(fr) {
      st.frames = fr && Array.isArray(fr.frames) ? fr.frames.filter(function (f) { return f && isNum(f.t); }).sort(function (a, b) { return a.t - b.t; }) : null;
      st.moment = fr && fr.moment && isNum(fr.moment.t) ? fr.moment.t : null; st.fi = -1; st.tickT = -Infinity;
      var has = !!(st.frames && st.frames.length), ticker = $('#sx-ticker', root), det = $('#sx-frames', root);
      if (tickRows) { if (has) buildTicker(); else { tickRows.innerHTML = ''; tickRowEls = []; } }
      if (ticker) { // frames.json is dense around the key moment and sparse elsewhere; say so once
        ticker.hidden = !has;
        if (has && !$('.tick__cap', ticker)) { var cap = document.createElement('p'); cap.className = 'tick__cap'; cap.textContent = 'raw CAN · dense at the key moment, sampled elsewhere'; ticker.appendChild(cap); var head = $('.tick__head', ticker); if (head) head.title = cap.textContent; }
      }
      if (det) det.hidden = !has;
      fillFramesTable(st.frames); st.dirty = true; kick();
    }
    function loadClipData(clip, signal) {
      var f = clip.files || {}; if (!f.signals) return Promise.reject(new Error('clip ' + clip.id + ' has no signals file'));
      var soft = function (e) { if (!e || e.name !== 'AbortError') dbg('optional file skipped:', e && e.message); return null; };
      var trP = f.track ? fetchJSON(url(f.track), signal).catch(soft) : Promise.resolve(null);
      var frP = f.frames ? fetchJSON(url(f.frames), signal).catch(soft) : Promise.resolve(null);
      return fetchJSON(url(f.signals), signal).then(function (sig) { // render as soon as the signals land; track and frames fill in when they arrive
        var data = { sig: sig, track: null, frames: null };
        trP.then(function (tr) { data.track = tr; if (st.clip === clip && tr) applyTrack(tr); });
        frP.then(function (fr) { data.frames = fr; if (st.clip === clip && fr) applyFrames(fr); });
        return data;
      });
    }
    function selectClip(id) {
      var clip = (st.index && st.index.clips.filter(function (c) { return c.id === id; })[0]) || (st.index && st.index.clips[0]);
      if (!clip || clip === st.clip) return;
      if (st.abort) st.abort.abort();
      var ac = st.abort = window.AbortController ? new AbortController() : null, resume = st.playing && !st.userPaused, f = clip.files || {};
      st.clip = clip; st.userPaused = false; markTab(clip.id); stopVFC(); video.pause();
      if (f.poster) video.poster = url(f.poster); else video.removeAttribute('poster');
      if (f.video) video.src = url(f.video); else { video.removeAttribute('src'); try { video.load(); } catch (e) { /* ignore */ } }
      st.t = 0; st.prevT = 0; st.hover = null; if (tip) tip.hidden = true;
      fillMeta(clip); applySignals(null); applyTrack(null); applyFrames(null);
      root.classList.add('is-loading'); if (errEl) errEl.hidden = true;
      var cached = st.cache.get(clip.id);
      (cached ? Promise.resolve(cached) : loadClipData(clip, ac && ac.signal)).then(function (data) {
        if (st.clip !== clip) return; st.cache.set(clip.id, data); root.classList.remove('is-loading');
        applySignals(data.sig); if (data.track) applyTrack(data.track); if (data.frames) applyFrames(data.frames);
        if (resume) play(); else maybeAutoplay();
      }).catch(function (e) {
        if ((e && e.name === 'AbortError') || st.clip !== clip) return;
        dbg('clip data unavailable:', e && e.message); root.classList.remove('is-loading'); if (errEl) errEl.hidden = false; st.dirty = true; kick();
      });
    }
    function start(idx) { st.index = idx; root.classList.remove('is-error'); buildPicker(idx); st.clip = null; selectClip(idx['default'] || idx.clips[0].id); }
    function fail(e) { dbg('Signal Explorer disabled:', e && e.message); root.classList.remove('is-loading'); root.classList.add('is-error'); if (picker) picker.hidden = true; }
    function boot() { root.classList.add('is-loading'); loadIndex().then(start).catch(fail); }

    /* ----- interaction ----- */
    function bindStrip(s) {
      var el = s.el;
      function tAt(ev) { var r = el.getBoundingClientRect(), win = windowAt(st.t); return clamp(win[0] + (ev.clientX - r.left) / (r.width || 1) * (win[1] - win[0]), 0, st.dur || 0); }
      el.addEventListener('pointerdown', function (ev) {
        if (ev.pointerType === 'mouse' && ev.button !== 0) return; ev.preventDefault();
        st.drag = { win: windowAt(st.t) }; try { el.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } seek(tAt(ev));
      });
      el.addEventListener('pointermove', function (ev) {
        if (st.drag) { seek(tAt(ev)); return; } if (ev.pointerType !== 'mouse') return;
        var ht = tAt(ev); st.hover = ht; st.dirty = true; kick();
        if (tip) { var pr = (tip.parentNode || el).getBoundingClientRect(); tip.hidden = false; tip.style.setProperty('--x', (clamp((ev.clientX - pr.left) / (pr.width || 1), 0, 1) * 100).toFixed(2) + '%'); tip.style.setProperty('--y', el.offsetTop + 'px'); tip.textContent = fmtClock(ht) + '.' + Math.floor((ht % 1) * 10) + ' · ' + valueText(s.spec, ht); }
      });
      var end = function () { st.drag = null; }; el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
      el.addEventListener('pointerleave', function () { if (st.drag) return; st.hover = null; if (tip) tip.hidden = true; st.dirty = true; kick(); });
    }
    strips.forEach(bindStrip); sizeStrips();
    video.loop = true;
    if ('ResizeObserver' in window) { var rt = 0, ro = new ResizeObserver(function () { clearTimeout(rt); rt = setTimeout(sizeStrips, 100); }); strips.forEach(function (s) { ro.observe(s.el); }); }
    else window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(sizeStrips, 100); });
    video.addEventListener('play', function () { setPlaying(true); });
    video.addEventListener('pause', function () { setPlaying(false); });
    video.addEventListener('seeked', function () { st.t = video.currentTime; st.dirty = true; kick(); });
    video.addEventListener('error', function () { dbg('video element error', video.error && video.error.code); });
    if (playBtn) playBtn.addEventListener('click', toggle);
    if (winBtn) winBtn.addEventListener('click', function () { var on = winBtn.getAttribute('aria-pressed') !== 'true'; winBtn.setAttribute('aria-pressed', String(on)); root.classList.toggle('is-full', on); st.dirty = true; kick(); });
    if (scrub) { scrub.addEventListener('input', function () { st.scrubbing = true; seek(parseInt(scrub.value, 10) / 10, 'scrub'); }); scrub.addEventListener('change', function () { st.scrubbing = false; }); }
    root.addEventListener('keydown', function (ev) { // Space / K toggle playback anywhere inside the Explorer (Space keeps its native meaning on controls)
      if (ev.key !== ' ' && ev.key !== 'k' && ev.key !== 'K') return;
      if (ev.key === ' ' && ev.target && ev.target.closest && ev.target.closest('button, a, input, summary, select, textarea')) return;
      ev.preventDefault(); toggle();
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        var e = es[es.length - 1]; st.visible = e.isIntersecting; st.visible50 = e.intersectionRatio >= 0.5;
        if (!e.isIntersecting && st.playing) video.pause(); else if (st.visible50) maybeAutoplay();
      }, { threshold: [0, 0.5] }).observe(root);
    } else st.visible = st.visible50 = true;
    document.addEventListener('visibilitychange', function () { if (document.hidden && st.playing) video.pause(); });
    if ('MutationObserver' in window) ['#vmodal', '#lightbox'].forEach(function (sel) { // openlka.js toggles [hidden] on the modals
      var m = $(sel); if (m) new MutationObserver(function () { if (!m.hidden && st.playing) video.pause(); }).observe(m, { attributes: true, attributeFilter: ['hidden'] });
    });
    return { boot: boot, seek: seek, reset: function () { if (st.abort) st.abort.abort(); st.cache.clear(); st.clip = null; st.index = null; } };
  }

  /* ---------- boot: nothing in #can is fetched until the section is within 600 px of the viewport ---------- */
  var explorer = sx ? initExplorer(sx) : null, canSec = $('#can'), canStarted = false;
  function startCanLab() {
    if (canStarted) return; canStarted = true;
    if (explorer) explorer.boot();
    loadIndex().then(function (idx) { return [idx.dongles ? url(idx.dongles) : null, idx.route_map ? url(idx.route_map) : null]; })
      .catch(function () { return [null, null]; })
      .then(function (u) {
        var dU = u[0] || (recGrid && recGrid.getAttribute('data-src')), mU = u[1] || (recmap && recmap.getAttribute('data-src'));
        if (dU && recGrid) fetchJSON(dU).then(fillDongles).catch(function (e) { dbg('dongles.json skipped:', e && e.message); });
        if (recmap) { if (mU) fetchJSON(mU).then(drawRecmap).catch(function (e) { dbg('routes_map.json skipped:', e && e.message); recmap.hidden = true; }); else recmap.hidden = true; }
      });
  }
  if (canSec && 'IntersectionObserver' in window) {
    var cio = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { cio.disconnect(); startCanLab(); } }, { rootMargin: '600px 0px' });
    cio.observe(canSec);
  } else if (canSec) startCanLab();
  initHero();

  /* debug hooks: OpenLKACan.reload('static/can-fixture/index.json') re-reads an index; OpenLKACan.seek(31.4) jumps the Explorer */
  window.OpenLKACan = {
    reload: function (src) { if (src && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) { indexSrc = src; base = src.replace(/[^\/]*$/, ''); } indexP = null; canStarted = false; if (explorer) explorer.reset(); startCanLab(); },
    seek: function (t) { if (explorer) explorer.seek(t); }
  };
})();
