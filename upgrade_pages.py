#!/usr/bin/env python3
"""Apply the ADAS-TO dark-hero design system to the other five project pages."""
import re
from pathlib import Path

ROOT = Path(__file__).parent

CSS = """
    /* ---- cinematic dark hero (design system v2) ---- */
    .hero-dark{background:radial-gradient(1200px 500px at 70% -10%,rgba(37,99,235,.35),transparent 60%),linear-gradient(160deg,#0a1428 0%,#0f2044 55%,#0a1428 100%);color:#fff;position:relative;overflow:hidden}
    .hero-dark::after{content:"";position:absolute;inset:0;background:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><path d="M0 59h60M59 0v60" stroke="%23ffffff09" stroke-width="1"/></svg>');pointer-events:none}
    .hero-dark .publication-title{color:#fff!important;-webkit-text-fill-color:#fff;text-shadow:0 2px 24px rgba(0,0,0,.45)}
    .hero-dark .publication-authors,.hero-dark .publication-authors .author-block{color:#c7d5ef}
    .hero-dark .publication-authors a{color:#7fb0ff}
    .hero-dark .publication-authors a:hover{color:#fff}
    .venue-pill{display:inline-block;margin-top:.7rem;padding:.35rem 1.1rem;border:1px solid rgba(127,176,255,.45);border-radius:999px;color:#9ec2ff;font-weight:600;font-size:.95rem;letter-spacing:.02em;background:rgba(37,99,235,.12)}
    .hero-dark .button.is-dark{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);transition:transform .18s ease,background .18s ease,box-shadow .18s ease}
    .hero-dark .button.is-dark:hover{background:#2563eb;border-color:#2563eb;transform:translateY(-2px);box-shadow:0 8px 22px rgba(37,99,235,.45)}
    .filmstrip{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;max-width:1040px;margin:2.2rem auto .4rem;position:relative;z-index:2}
    .filmstrip.single{grid-template-columns:minmax(0,860px);justify-content:center}
    .film-card{position:relative;border-radius:14px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.5);transition:transform .25s ease,box-shadow .25s ease;border:1px solid rgba(255,255,255,.14);background:#fff}
    .film-card:hover{transform:translateY(-6px) scale(1.02);box-shadow:0 18px 50px rgba(37,99,235,.35)}
    .film-card img{display:block;width:100%;height:100%;object-fit:cover;aspect-ratio:16/9}
    .filmstrip.single .film-card img{aspect-ratio:auto;object-fit:contain}
    .film-card .tag-cap{position:absolute;left:0;right:0;bottom:0;padding:.5rem .8rem;font-size:.82rem;font-weight:600;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.75));letter-spacing:.02em}
    .film-card .rec{position:absolute;top:.55rem;left:.7rem;font-size:.7rem;font-weight:700;color:#fff;background:rgba(220,38,38,.92);border-radius:6px;padding:.15rem .5rem;letter-spacing:.06em;z-index:2}
    .hero-tagline{color:#c7d5ef;font-size:1.12rem;max-width:760px;margin:1.4rem auto 0;text-align:center}
    .hero-tagline b{color:#fff}
    .hero-dark .stat-band{display:flex;flex-wrap:wrap;justify-content:center;gap:2.6rem;margin:1.8rem 0 .6rem;position:relative;z-index:2}
    .hero-dark .stat{text-align:center;min-width:130px}
    .hero-dark .stat .num{font-size:2.5rem;font-weight:800;color:#7fb0ff;line-height:1.1;font-variant-numeric:tabular-nums}
    .hero-dark .stat .lbl{font-size:.82rem;color:#9fb2d6;text-transform:uppercase;letter-spacing:.08em;margin-top:.15rem}
    .section-title-accent{position:relative;display:inline-block}
    .section-title-accent::after{content:"";display:block;width:56px;height:4px;border-radius:2px;background:linear-gradient(90deg,#2563eb,#7fb0ff);margin:.5rem auto 0}
    .gif-card{transition:transform .22s ease,box-shadow .22s ease}
    .gif-card:hover{transform:translateY(-5px);box-shadow:0 14px 34px rgba(15,32,68,.18)}
    .reveal{opacity:0;transform:translateY(22px);transition:opacity .6s ease,transform .6s ease}
    .reveal.on{opacity:1;transform:none}
    @media (max-width:768px){.filmstrip{grid-template-columns:1fr 1fr}.filmstrip .film-card:nth-child(3){display:none}.filmstrip.single{grid-template-columns:1fr}}
"""

JS = """  <script>
    document.addEventListener("DOMContentLoaded", function () {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("on"); io.unobserve(e.target); } });
      }, { threshold: 0.12 });
      document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });

      function countUp(el) {
        var target = parseFloat(el.dataset.count), dec = +(el.dataset.decimals || 0),
            suf = el.dataset.suffix || "", dur = 1400, t0 = null;
        function fmt(v) { return dec ? v.toFixed(dec) : Math.round(v).toLocaleString(); }
        function step(t) {
          if (!t0) t0 = t;
          var p = Math.min((t - t0) / dur, 1), eased = 1 - Math.pow(1 - p, 3);
          el.textContent = fmt(target * eased) + suf;
          if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      }
      var io2 = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); io2.unobserve(e.target); } });
      }, { threshold: 0.4 });
      document.querySelectorAll(".stat .num[data-count]").forEach(function (el) { io2.observe(el); });
    });
  </script>
</body>"""

NOSCRIPT = '<noscript><style>.reveal{opacity:1!important;transform:none!important}</style></noscript>\n</head>'

PAGES = {
    "openlka": dict(
        pill="IEEE ITSC 2025", rec=True,
        gifs=[("olka_fail_glare.gif", "Sun glare, lane tracking lost"),
              ("olka_fail_night.gif", "Night, low-visibility markings"),
              ("olka_fail_faded.gif", "Faded lane paint")],
        stats=[('data-count="389" data-suffix=" h"', "0", "LKA driving"),
               ('data-count="62"', "0", "vehicle models"),
               ("", "1080p", "20 fps video"),
               ("", "MIT", "license")]),
    "baton": dict(
        pill="arXiv preprint · 2026", rec=True,
        gifs=[("baton_day.gif", "Daytime route, full sync"),
              ("baton_night.gif", "Night driving"),
              ("baton_sensors.gif", "Synchronized sensor streams")],
        stats=[('data-count="136.6" data-decimals="1" data-suffix=" h"', "0", "driving"),
               ('data-count="127"', "0", "drivers"),
               ('data-count="380"', "0", "routes"),
               ('data-count="3"', "0", "benchmark tasks")]),
    "drivedna": dict(
        pill="arXiv preprint · 2026", rec=False, single_img="static/images/drivedna_teaser.png",
        gifs=[],
        stats=[('data-count="4121"', "0", "drives"),
               ('data-count="465"', "0", "drivers"),
               ('data-count="975" data-suffix=" h"', "0", "driving @10 Hz"),
               ("", ".935", "re-ID AUROC")]),
    "drivemotion": dict(
        pill="Dataset &amp; Benchmark · 2026", rec=False,
        gifs=[("dm_motion_baton.gif", "Fleet cabin skeleton motion"),
              ("dm_overlay.gif", "Pose extraction overlay"),
              ("dm_motion_aide.gif", "AIDE semantic clips")],
        stats=[('data-count="400" data-suffix=" h"', "0", "in-cabin motion"),
               ('data-count="133"', "0", "keypoints/frame"),
               ('data-count="9010"', "0", "sequences"),
               ('data-count="360"', "0", "drivers")]),
    "vlalert": dict(
        pill="Dataset &amp; Benchmark · 2026", rec=True,
        gifs=[("vlalert_demo1.gif", "Per-tick alert decision"),
              ("vlalert_demo3.gif", "OBSERVE &rarr; ALERT escalation"),
              ("vlalert_demo9.gif", "Hazard-driven ALERT")],
        stats=[('data-count="13534"', "0", "videos"),
               ('data-count="192892"', "0", "1-s ticks"),
               ('data-count="3"', "0", "alert actions"),
               ('data-count="6"', "0", "source datasets")]),
}


def build_insert(cfg, tagline):
    if cfg["gifs"]:
        cards = "\n".join(
            f'              <div class="film-card">{"<span class=\'rec\'>● REC</span>" if cfg["rec"] else ""}'
            f'<img src="static/images/{g}" alt="{cap}"/><div class="tag-cap">{cap}</div></div>'
            for g, cap in cfg["gifs"])
        strip = f'            <div class="filmstrip">\n{cards}\n            </div>'
    else:
        strip = (f'            <div class="filmstrip single">\n'
                 f'              <div class="film-card"><img src="{cfg["single_img"]}" alt="Overview"/></div>\n'
                 f'            </div>')
    stats = "\n".join(
        f'              <div class="stat"><div class="num" {attrs}>{init}</div><div class="lbl">{lbl}</div></div>'
        if attrs else
        f'              <div class="stat"><div class="num">{init}</div><div class="lbl">{lbl}</div></div>'
        for attrs, init, lbl in cfg["stats"])
    return (f"\n{strip}\n\n"
            f'            <p class="hero-tagline">{tagline}</p>\n'
            f'            <div class="stat-band">\n{stats}\n            </div>\n')


for name, cfg in PAGES.items():
    p = ROOT / name / "index.html"
    s = p.read_text()
    orig = s

    # 1. css + noscript
    assert "</style>" in s
    s = s.replace("</style>", CSS + "  </style>", 1)
    s = s.replace("</head>", NOSCRIPT, 1)

    # 2. dark hero + widescreen container
    s = s.replace('<section class="hero">', '<section class="hero hero-dark">', 1)
    i = s.index("hero-dark")
    s = s[:i] + s[i:].replace("is-max-desktop", "is-max-widescreen", 1)

    # 3. venue pill
    m = re.search(r"MOTIF-Lab<br>(.*?)</span>", s, re.S)
    assert m, name
    s = s.replace(m.group(0), f'MOTIF-Lab</span><br>\n              <span class="venue-pill">{cfg["pill"]}</span>', 1)

    # 4. teaser: capture tagline, strip subtitle + stat band, keep image
    tm = re.search(r'<h2 class="subtitle has-text-centered" style="margin-top:1rem">\s*(.*?)\s*</h2>', s, re.S)
    assert tm, name
    tagline = re.sub(r"\s+", " ", tm.group(1))
    s = s.replace(tm.group(0), "", 1)
    sb = re.search(r'<div class="stat-band">.*?</div>\s*</div>\s*(?=\s*</div>)', s, re.S)
    if sb:
        s = s.replace(sb.group(0), "</div>", 1)
    else:
        sb2 = re.search(r'<div class="stat-band">.*?\n        </div>', s, re.S)
        assert sb2, name
        s = s.replace(sb2.group(0), "", 1)
    s = s.replace('<section class="hero teaser">', '<section class="hero teaser reveal">', 1)

    # 5. inject filmstrip + tagline + stats after publication-links wrapper
    pl = re.search(r'(<div class="publication-links">.*?</div>\s*</div>)', s, re.S)
    assert pl, name
    s = s.replace(pl.group(1), pl.group(1) + build_insert(cfg, tagline), 1)

    # drivedna: teaser image now lives in hero; drop the old teaser section image
    if not cfg["gifs"]:
        ts = re.search(r'<section class="hero teaser reveal">.*?</section>\s*', s, re.S)
        if ts:
            s = s.replace(ts.group(0), "", 1)

    # 6. accents + reveals
    s = s.replace('<h2 class="title is-3">Abstract</h2>', '<h2 class="title is-3 section-title-accent">Abstract</h2>')
    s = re.sub(r'<h2 class="title is-3 has-text-centered">([^<]+)</h2>',
               r'<h2 class="title is-3 has-text-centered"><span class="section-title-accent">\1</span></h2>', s)
    s = s.replace('<section class="section hero is-light">', '<section class="section hero is-light reveal">')
    s = s.replace('<section class="hero is-small">', '<section class="hero is-small reveal">')

    # 7. js
    s = s.replace("</body>", JS, 1)

    assert s != orig
    p.write_text(s)
    print(f"{name}: upgraded ({len(orig)} -> {len(s)} bytes)")
print("done")
