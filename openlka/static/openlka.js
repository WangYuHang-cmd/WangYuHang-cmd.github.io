/* OpenLKA project page behaviours. Vanilla JS, no dependencies. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- nav: progress, active section, burger, dropdown ---------- */
  var nav = $('#lk-nav'), progress = $('.lk-progress'), burger = $('#lk-burger');
  var ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      if (progress) progress.style.setProperty('--p', max > 0 ? (h.scrollTop / max).toFixed(4) : 0);
      var tt = $('#totop'); if (tt) tt.hidden = h.scrollTop < 600;
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  var anchors = $$('.lk-anchors a');
  var sections = anchors.map(function (a) { return $(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && sections.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        anchors.forEach(function (a) { a.removeAttribute('aria-current'); });
        var a = anchors.filter(function (x) { return x.getAttribute('href') === '#' + e.target.id; })[0];
        if (a) a.setAttribute('aria-current', 'true');
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(function (s) { io.observe(s); });
  }
  function closeMenu() { if (nav) { nav.classList.remove('open'); } if (burger) burger.setAttribute('aria-expanded', 'false'); }
  if (burger) burger.addEventListener('click', function () {
    var open = nav.classList.toggle('open'); burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
  var dd = $('.lk-dd'), ddBtn = $('#lk-more');
  if (ddBtn) ddBtn.addEventListener('click', function (ev) {
    ev.stopPropagation(); var open = dd.classList.toggle('open'); ddBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', function (ev) {
    if (dd && !dd.contains(ev.target)) { dd.classList.remove('open'); if (ddBtn) ddBtn.setAttribute('aria-expanded', 'false'); }
    if (nav && nav.classList.contains('open') && !nav.contains(ev.target)) closeMenu();
  });
  $$('.lk-menu a').forEach(function (a) { a.addEventListener('click', function () { closeMenu(); dd && dd.classList.remove('open'); }); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { closeMenu(); if (dd) dd.classList.remove('open'); }
  });
  var totop = $('#totop');
  if (totop) totop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); });

  /* ---------- reveal ---------- */
  var reveals = $$('.reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('on'); });
  } else {
    var ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('on'); ro.unobserve(e.target); } });
    }, { threshold: 0.12 });
    reveals.forEach(function (el) { ro.observe(el); });
  }

  /* ---------- count-up ---------- */
  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var dec = parseInt(el.getAttribute('data-decimals') || '0', 10);
    var suffix = el.getAttribute('data-suffix') || '';
    var dur = 1400, t0 = null;
    function fmt(v) { var s = v.toFixed(dec); return (dec === 0 ? Number(s).toLocaleString('en-US') : s) + suffix; }
    function step(ts) {
      if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / dur); var e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * e); if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(target);
    }
    requestAnimationFrame(step);
  }
  var counters = $$('[data-count]');
  if (!reduce && 'IntersectionObserver' in window) {
    var co = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); co.unobserve(e.target); } });
    }, { threshold: 0.4 });
    counters.forEach(function (el) { co.observe(el); });
  }

  /* ---------- before/after sliders ---------- */
  function bindBA(fig) {
    var range = $('.ba__range', fig); if (!range) return;
    function set(v) { fig.style.setProperty('--pos', v + '%'); range.setAttribute('aria-valuetext', Math.round(v) + ' percent camera frame'); }
    range.addEventListener('input', function () { set(parseFloat(range.value)); });
    set(parseFloat(range.value));
    fig._setPos = function (v) { range.value = v; set(v); };
  }
  $$('.ba').forEach(bindBA);
  var heroBA = $('#hero-ba');
  if (heroBA && !reduce) {
    // one-time sweep so the comparison is discovered without interaction
    var start = null, from = 18, to = 72, rest = 50, dur = 1800, hold = 500;
    function sweep(ts) {
      if (!start) start = ts; var t = ts - start;
      if (t < dur) { var p = t / dur; var e = 0.5 - Math.cos(Math.PI * p) / 2; heroBA._setPos(from + (to - from) * e); requestAnimationFrame(sweep); }
      else if (t < dur + hold) { requestAnimationFrame(sweep); }
      else if (t < dur + hold + 700) { var q = (t - dur - hold) / 700; heroBA._setPos(to + (rest - to) * (0.5 - Math.cos(Math.PI * q) / 2)); requestAnimationFrame(sweep); }
      else heroBA._setPos(rest);
    }
    var swept = false;
    function go() { if (swept) return; swept = true; setTimeout(function () { requestAnimationFrame(sweep); }, 500); }
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
    heroBA.addEventListener('pointerdown', function () { swept = true; start = -1e9; });
  }

  /* ---------- scene chips (perception) ---------- */
  var scenes = {
    glare: { title: 'Sun glare', text: 'Low sun straight ahead on a Tampa interstate. The paint is still there, but the camera can barely separate it from the pavement.', l: 0.21, r: 0.26, lever: 'Glare cannot be fixed, but high-contrast, retroreflective markings keep the line visible longer into the sun.', altB: 'Sun glare on a Tampa interstate at sunset', altA: 'Sun glare frame with the lane detection overlay' },
    heavyrain: { title: 'Heavy rain', text: 'Spray from the vehicles ahead on a Tampa interstate. Both lines vanish into the mist, and lane keeping often hands control back in these conditions.', l: 0.13, r: 0.13, lever: 'Raised profile and wet-reflective markings keep some signal through rain and spray.', altB: 'Heavy rain and spray on a Tampa interstate hide the lane lines', altA: 'Heavy rain frame with the lane detection overlay' },
    wornout: { title: 'Worn markings', text: 'A faded yellow edge line on a concrete interstate section near an exit. The detector finds the line, but with half the confidence of a fresh one.', l: 0.48, r: 0.50, lever: 'Restriping on a shorter cycle for concrete sections, where the paint wears visibly faster.', altB: 'Worn yellow lane line on a concrete interstate section', altA: 'Worn markings frame with the lane detection overlay' },
    lowcontrast: { title: 'Low contrast', text: 'White lines on pale concrete beside a barrier wall. There is paint, but the camera sees almost no contrast between line and pavement.', l: 0.64, r: 0.49, lever: 'Contrast between paint and pavement: dark contrast borders or black backing on light concrete.', altB: 'White lane lines on pale concrete with little contrast', altA: 'Low-contrast frame with the lane detection overlay' },
    night: { title: 'Night', text: 'Only the headlight-lit stretch of line is visible. Beyond it, the detector is guessing.', l: 0.28, r: 0.19, lever: 'Retroreflectivity and lighting at interchanges extend how far ahead the line can be read.', altB: 'Night driving where only the headlight-lit stretch of lane line is visible', altA: 'Night frame with the lane detection overlay' },
    diverge: { title: 'Diverge', text: 'An exit splits off on the right. Two sets of lines diverge, and the car has to decide which one is its lane.', l: 0.34, r: 0.18, lever: 'Continuous edge lines and early lane assignment through the gore give the camera one clear answer.', altB: 'Interstate diverge where the lane lines split toward an exit', altA: 'Diverge frame with the lane detection overlay' },
    curve: { title: 'Rural curve', text: 'A two-lane rural road bends right with an oncoming car. The yellow center line is clear, but the curve is tight for a production system.', l: 0.22, r: 0.29, lever: 'Curve warning signs and advisory speeds matter here; the limit is steering authority, not paint.', altB: 'Rural two-lane road curving right with a yellow center line', altA: 'Rural curve frame with the lane detection overlay' },
    split: { title: 'Clear day (baseline)', text: 'A clear multi-lane interstate with fresh white lines. This is the easy case the systems are tuned for.', l: 0.55, r: 0.38, lever: 'This is the baseline every other condition is compared against.', altB: 'Clear-day interstate with fresh white lane lines', altA: 'Clear-day frame with the lane detection overlay' }
  };
  var chips = $$('#scene-chips .chip');
  function setScene(key) {
    var s = scenes[key]; if (!s) return;
    var fig = $('#scene-ba');
    $('#scene-before').src = 'static/images/olka_ba_' + key + '_before.jpg';
    $('#scene-after').src = 'static/images/olka_ba_' + key + '_after.jpg';
    $('#scene-before').alt = s.altB; $('#scene-after').alt = s.altA;
    $('#scene-title').textContent = s.title; $('#scene-text').textContent = s.text;
    $('#conf-l').style.setProperty('--w', Math.round(s.l * 100) + '%'); $('#conf-l-v').textContent = s.l.toFixed(2);
    $('#conf-r').style.setProperty('--w', Math.round(s.r * 100) + '%'); $('#conf-r-v').textContent = s.r.toFixed(2);
    $('#scene-lever').innerHTML = '<b>Lever:</b> ' + s.lever;
    chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-scene') === key)); });
    if (fig && fig._setPos) fig._setPos(50);
  }
  chips.forEach(function (c) { c.addEventListener('click', function () { setScene(c.getAttribute('data-scene')); }); });

  /* ---------- tabs ---------- */
  $$('.tabs').forEach(function (tabs) {
    var list = $$('[role="tab"]', tabs);
    function activate(tab) {
      list.forEach(function (t) {
        var on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
        var p = document.getElementById(t.getAttribute('aria-controls')); if (p) p.hidden = !on;
      });
      $$('video', tabs).forEach(function (v) { if (v.closest('[hidden]')) v.pause(); });
    }
    list.forEach(function (t, i) {
      t.addEventListener('click', function () { activate(t); });
      t.addEventListener('keydown', function (ev) {
        var j = i;
        if (ev.key === 'ArrowRight') j = (i + 1) % list.length; else if (ev.key === 'ArrowLeft') j = (i - 1 + list.length) % list.length;
        else if (ev.key === 'Home') j = 0; else if (ev.key === 'End') j = list.length - 1; else return;
        ev.preventDefault(); list[j].focus(); activate(list[j]);
      });
    });
  });

  /* ---------- inline looping videos: play when visible ---------- */
  var loops = $$('.tile--video video');
  if (!reduce && 'IntersectionObserver' in window) {
    var vo = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting && !v.closest('[hidden]')) { v.play().catch(function () {}); } else { v.pause(); }
      });
    }, { threshold: 0.5 });
    loops.forEach(function (v) { vo.observe(v); });
  }

  /* ---------- vehicle modal ---------- */
  var modal = $('#vmodal'), cards = $$('.vcard'), current = -1, clipNo = 1, lastFocus = null, video = null;
  var media = $('#vm-media'), bar = $('#vm-bar'), prog = $('#vm-prog'), toggle = $('#vm-toggle');
  function lock(on) {
    document.body.classList.toggle('lk-locked', on);
    var main = $('#main'); var hdr = $('#lk-nav');
    [main, hdr].forEach(function (el) { if (!el) return; if ('inert' in el) el.inert = on; else el.setAttribute('aria-hidden', on ? 'true' : 'false'); });
  }
  function clearVideo() {
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); video = null; }
    media.innerHTML = '';
  }
  function loadClip(idx, n) {
    var c = cards[idx]; if (!c) return; current = idx; clipNo = n;
    var slug = c.getAttribute('data-slug'); var suffix = n === 2 ? '-2' : '';
    var hasSecond = c.getAttribute('data-second') === '1';
    $('#vm-title').textContent = c.getAttribute('data-label') + (c.getAttribute('data-hours') ? ' · ' + c.getAttribute('data-hours') + ' in OpenLKA' : '');
    $('#vm-system').textContent = n === 2 ? (c.getAttribute('data-system2') || c.getAttribute('data-system')) : c.getAttribute('data-system');
    $('#vm-where').textContent = c.getAttribute('data-where');
    $('#vm-caption').textContent = n === 2 ? (c.getAttribute('data-caption2') || '') : c.getAttribute('data-caption');
    toggle.hidden = !hasSecond;
    $$('.chip', toggle).forEach(function (b) { b.setAttribute('aria-pressed', String(parseInt(b.getAttribute('data-clip'), 10) === n)); });
    bar.classList.toggle('no-tick', slug === 'kia-ev6');
    prog.style.setProperty('--p', '0%');
    clearVideo();
    video = document.createElement('video');
    video.muted = true; video.setAttribute('muted', ''); video.playsInline = true; video.setAttribute('playsinline', '');
    video.loop = true; video.controls = true; video.preload = 'auto'; video.autoplay = !reduce;
    video.width = 526; video.height = 330;
    video.poster = 'static/clips/' + slug + suffix + '.jpg';
    video.src = 'static/clips/' + slug + suffix + '.mp4';
    video.setAttribute('aria-label', c.getAttribute('data-label') + ' test clip');
    video.addEventListener('timeupdate', function () { var v = this; if (v === video && v.duration) prog.style.setProperty('--p', (100 * v.currentTime / v.duration).toFixed(1) + '%'); });
    media.appendChild(video);
    var p = video.play(); if (p && p.catch) p.catch(function () {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'lk-modal__tap'; b.textContent = 'Tap to play';
      b.addEventListener('click', function () { video.play(); b.remove(); }); media.appendChild(b);
    });
  }
  function openModal(idx) {
    lastFocus = cards[idx] || document.activeElement; modal.hidden = false; lock(true); loadClip(idx, 1); $('#vm-close').focus();
  }
  function closeModal() {
    clearVideo(); modal.hidden = true; lock(false); if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  cards.forEach(function (c, i) {
    c.addEventListener('click', function (ev) { ev.preventDefault(); openModal(i); });
  });
  if (modal) {
    $$('[data-close]', modal).forEach(function (el) { el.addEventListener('click', closeModal); });
    $('#vm-prev').addEventListener('click', function () { loadClip((current - 1 + cards.length) % cards.length, 1); });
    $('#vm-next').addEventListener('click', function () { loadClip((current + 1) % cards.length, 1); });
    $$('.chip', toggle).forEach(function (b) { b.addEventListener('click', function () { loadClip(current, parseInt(b.getAttribute('data-clip'), 10)); }); });
    modal.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); closeModal(); return; }
      if (ev.key === 'ArrowLeft' && ev.target.tagName !== 'VIDEO') { loadClip((current - 1 + cards.length) % cards.length, 1); }
      if (ev.key === 'ArrowRight' && ev.target.tagName !== 'VIDEO') { loadClip((current + 1) % cards.length, 1); }
      if (ev.key === 'Tab') {
        var f = $$('button, [href], video, input, [tabindex]:not([tabindex="-1"])', modal).filter(function (el) { return !el.hidden && el.offsetParent !== null; });
        if (!f.length) return; var first = f[0], last = f[f.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      }
    });
  }

  /* ---------- lightbox for figures ---------- */
  var lb = $('#lightbox'), lbImg = $('#lb-img'), lbCap = $('#lb-cap'), lbLast = null;
  function openLB(img) {
    lbLast = document.activeElement; lbImg.src = img.currentSrc || img.src; lbImg.alt = img.alt;
    var fc = img.closest('figure') ? $('figcaption', img.closest('figure')) : null;
    lbCap.textContent = fc ? fc.textContent : img.alt;
    lb.hidden = false; lock(true); $('.lk-lightbox__close').focus();
  }
  function closeLB() { lb.hidden = true; lbImg.src = ''; lock(false); if (lbLast && lbLast.focus) lbLast.focus(); }
  $$('[data-zoom]').forEach(function (img) {
    img.setAttribute('tabindex', '0'); img.setAttribute('role', 'button'); img.setAttribute('aria-label', 'Enlarge: ' + img.alt);
    img.addEventListener('click', function () { openLB(img); });
    img.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openLB(img); } });
  });
  if (lb) {
    $$('[data-close]', lb).forEach(function (el) { el.addEventListener('click', closeLB); });
    lb.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeLB(); if (ev.key === 'Tab') { ev.preventDefault(); $('.lk-lightbox__close').focus(); } });
  }

  /* ---------- curve widget ---------- */
  var cwR = $('#cw-r');
  if (cwR) {
    var SLOPE = 8.327, PX_PER_M = 82, MAX_M = 1.2;
    function updateCurve() {
      var R = parseFloat(cwR.value); var k = 1 / R; var d = SLOPE * k;
      $('#cw-r-out').textContent = R + ' m (' + Math.round(R * 3.281) + ' ft)';
      $('#cw-k').textContent = k.toFixed(3) + ' 1/m';
      $('#cw-d').textContent = d.toFixed(2) + ' m (' + (d * 3.281).toFixed(1) + ' ft)';
      var band = $('#cw-band'); var cls = 'badge ', txt;
      if (d <= 0.25) { cls += 'badge--ok'; txt = 'within the normal band (0.25 m)'; }
      else if (d <= 0.65) { cls += 'badge--warn'; txt = 'anomaly: above 0.25 m'; }
      else { cls += 'badge--crit'; txt = 'critical: above 0.65 m'; }
      band.className = cls; band.textContent = txt;
      var px = Math.min(MAX_M, d) * PX_PER_M; $('#cw-car').style.transform = 'translateX(' + px.toFixed(1) + 'px)';
    }
    cwR.addEventListener('input', updateCurve); updateCurve();
  }

  /* ---------- BibTeX copy ---------- */
  var copyBtn = $('#copy-bib');
  if (copyBtn) copyBtn.addEventListener('click', function () {
    var text = $('#bibtex-code').textContent;
    function done() { copyBtn.classList.add('copied'); $('span', copyBtn).textContent = 'Copied'; setTimeout(function () { copyBtn.classList.remove('copied'); $('span', copyBtn).textContent = 'Copy'; }, 2000); }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done).catch(fallback); } else fallback();
    function fallback() { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} document.body.removeChild(ta); }
  });
})();
