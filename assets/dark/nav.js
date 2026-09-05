/* nav.js — inject the shared glass nav into standalone project pages (#site-nav) */
(function () {
  "use strict";
  var mount = document.getElementById("site-nav");
  if (!mount) return;
  var LINKS = [
    ["About Me", "/"], ["Projects", "/projects/"], ["Publications", "/publications/"],
    ["Awards", "/awards/"], ["Blogs", "/blogs/"], ["Teams", "/teams/"], ["Hobbies", "/hobbies/"]
  ];
  if (!document.querySelector('link[href="/assets/dark/site-dark.css"]')) {
    var l = document.createElement("link");
    l.rel = "stylesheet"; l.href = "/assets/dark/site-dark.css";
    document.head.appendChild(l);
  }
  var html = '<nav class="dk-nav"><div class="dk-nav-inner">' +
    '<a class="dk-brand" href="/">Yuhang <b>Wang</b></a>' +
    '<button class="dk-burger" aria-label="Menu"><span></span></button>' +
    '<ul class="dk-links">' +
    LINKS.map(function (x) { return '<li><a href="' + x[1] + '">' + x[0] + "</a></li>"; }).join("") +
    '<li><a class="cv-btn" href="/file/CV-Yuhang.pdf" target="_blank">CV</a></li></ul></div></nav>';
  mount.outerHTML = html;
  var nav = document.querySelector(".dk-nav");
  var onScroll = function () { nav.classList.toggle("scrolled", scrollY > 24); };
  addEventListener("scroll", onScroll, { passive: true }); onScroll();
  var burger = nav.querySelector(".dk-burger");
  if (burger) burger.addEventListener("click", function () { nav.classList.toggle("open"); });
})();
