/* fx.js — reveal / count-up / typewriter / tilt / nav / lazy embeds (vanilla) */
(function () {
  "use strict";
  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* nav scroll state + hamburger */
  var nav = document.querySelector(".dk-nav");
  if (nav) {
    var onScroll = function () { nav.classList.toggle("scrolled", scrollY > 24); };
    addEventListener("scroll", onScroll, { passive: true }); onScroll();
    var burger = nav.querySelector(".dk-burger");
    if (burger) burger.addEventListener("click", function () { nav.classList.toggle("open"); });
    nav.querySelectorAll(".dk-links a").forEach(function (a) {
      a.addEventListener("click", function () { nav.classList.remove("open"); });
      if (a.getAttribute("href") === location.pathname) a.classList.add("current");
    });
  }

  /* reveal on scroll */
  var revealEls = document.querySelectorAll(".reveal");
  if (reduced || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("on"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("on"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  }

  /* count-up: <b data-count="15000" data-suffix="+" data-decimals="0"> */
  function animateCount(el) {
    var target = parseFloat(el.dataset.count || "0");
    var dec = parseInt(el.dataset.decimals || "0", 10);
    var suffix = el.dataset.suffix || "";
    var t0 = null, DUR = 1600;
    function fmt(v) {
      var s = v.toFixed(dec);
      if (target >= 1000) s = Number(s).toLocaleString("en-US", { minimumFractionDigits: dec });
      return s + (suffix ? '<span class="plus">' + suffix + "</span>" : "");
    }
    if (reduced) { el.innerHTML = fmt(target); return; }
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / DUR, 1), e = 1 - Math.pow(1 - p, 3);
      el.innerHTML = fmt(target * e);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var counters = document.querySelectorAll("[data-count]");
  if (counters.length) {
    if (reduced || !("IntersectionObserver" in window)) counters.forEach(animateCount);
    else {
      var cio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { animateCount(e.target); cio.unobserve(e.target); }
        });
      }, { threshold: 0.4 });
      counters.forEach(function (el) { cio.observe(el); });
    }
  }

  /* typewriter: <span class="tw" data-lines='["a","b"]'> */
  document.querySelectorAll(".tw").forEach(function (el) {
    var lines;
    try { lines = JSON.parse(el.dataset.lines || "[]"); } catch (e) { lines = []; }
    if (!lines.length) return;
    if (reduced) { el.textContent = lines[0]; return; }
    var li = 0, ci = 0, del = false;
    (function tick() {
      var line = lines[li];
      el.textContent = line.slice(0, ci);
      var wait = del ? 26 : 46;
      if (!del && ci === line.length) { del = true; wait = 2300; }
      else if (del && ci === 0) { del = false; li = (li + 1) % lines.length; wait = 350; }
      ci += del ? -1 : 1;
      setTimeout(tick, wait);
    })();
  });

  /* 3D tilt cards */
  var canTilt = !reduced && matchMedia("(hover:hover) and (pointer:fine)").matches;
  if (canTilt) {
    document.querySelectorAll(".tilt-card").forEach(function (card) {
      card.addEventListener("pointermove", function (ev) {
        var r = card.getBoundingClientRect();
        var mx = (ev.clientX - r.left) / r.width, my = (ev.clientY - r.top) / r.height;
        card.style.setProperty("--mx", mx); card.style.setProperty("--my", my);
        card.style.transform = "rotateX(" + ((0.5 - my) * 8) + "deg) rotateY(" + ((mx - 0.5) * 8) + "deg) translateY(-3px)";
      });
      card.addEventListener("pointerleave", function () { card.style.transform = ""; });
    });
  }

  /* lazy third-party embeds: <div data-embed-src="..."> loads when near viewport */
  var lazies = document.querySelectorAll("[data-embed-src]");
  function loadEmbed(el) {
    var s = document.createElement("script");
    s.src = el.dataset.embedSrc; s.async = true;
    if (el.dataset.embedId) s.id = el.dataset.embedId;
    if (el.dataset.embedCharset) s.charset = el.dataset.embedCharset;
    el.appendChild(s);
  }
  if (lazies.length) {
    if (!("IntersectionObserver" in window)) lazies.forEach(loadEmbed);
    else {
      var eio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { loadEmbed(e.target); eio.unobserve(e.target); }
        });
      }, { rootMargin: "600px" });
      lazies.forEach(function (el) { eio.observe(el); });
    }
  }
})();
