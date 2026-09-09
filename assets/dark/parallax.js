/* parallax.js — scroll-driven parallax (vanilla, transform/CSS-var only)
   Usage:
     <el data-plx="0.12">                relative: drifts by (distance from viewport centre) × speed
     <el data-plx="0.3" data-plx-mode="fixed">  fixed layer: translateY(-scrollY × speed)
     <div class="hero-inner" data-plx-hero>     hero content: shifts + fades as it leaves
   All motion goes through --plx / --hero-y / --hero-o so it composes with .reveal transitions.
   Gates: prefers-reduced-motion -> no-op. Narrow screens -> speeds halved. */
(function () {
  "use strict";
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var docEl = document.documentElement;
  var vh = innerHeight, narrow = innerWidth < 760;
  var scale = narrow ? 0.5 : 1;

  function absTop(el) { var t = 0; while (el) { t += el.offsetTop; el = el.offsetParent; } return t; }

  var items = [];
  function collect() {
    items = [].slice.call(document.querySelectorAll("[data-plx]")).map(function (el) {
      return { el: el, speed: (parseFloat(el.dataset.plx) || 0) * scale,
               fixed: el.dataset.plxMode === "fixed", top: 0, h: 0, last: null };
    });
    measure();
  }
  function measure() {
    vh = innerHeight;
    items.forEach(function (it) {
      if (it.fixed) return;
      it.top = absTop(it.el); it.h = it.el.offsetHeight;
    });
  }

  var hero = document.querySelector("[data-plx-hero]");
  var heroWrap = hero ? hero.parentElement : null;
  var hint = document.querySelector(".scroll-hint");

  var ticking = false;
  function update() {
    ticking = false;
    var sy = scrollY || docEl.scrollTop;

    for (var i = 0; i < items.length; i++) {
      var it = items[i], y;
      if (it.fixed) {
        y = -sy * it.speed;
      } else {
        var top = it.top - sy;                       // element top in viewport coords
        if (top > vh * 1.3 || top + it.h < -vh * 0.3) continue;   // far away: skip
        var d = (top + it.h / 2) - vh / 2;           // distance of centre from viewport centre
        y = d * it.speed;
      }
      y = Math.round(y * 100) / 100;
      if (y !== it.last) { it.last = y; it.el.style.setProperty("--plx", y + "px"); }
    }

    if (hero) {
      var p = Math.min(sy / (vh * 0.9), 1);
      hero.style.setProperty("--hero-y", (sy * 0.32 * scale).toFixed(1) + "px");
      hero.style.setProperty("--hero-o", (1 - p * p).toFixed(3));
      if (hint) hint.style.opacity = Math.max(0, 1 - sy / (vh * 0.25)).toFixed(2);
    }
  }
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  collect();
  update();
  addEventListener("scroll", onScroll, { passive: true });
  var rto;
  addEventListener("resize", function () {
    clearTimeout(rto);
    rto = setTimeout(function () { narrow = innerWidth < 760; measure(); update(); }, 120);
  });
  /* layout can shift after images / <details> load: re-measure lazily */
  addEventListener("load", function () { measure(); update(); });
  document.querySelectorAll("details").forEach(function (d) {
    d.addEventListener("toggle", function () { measure(); update(); });
  });
  if ("ResizeObserver" in window) {
    new ResizeObserver(function () { measure(); update(); }).observe(document.body);
  }
})();
