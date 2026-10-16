---
layout: dark
permalink: /awards/index.html
title: Awards
---

<style>
/* Awards — HUD timeline cards. Page-specific rules only; the primitives (.hud-frame, .hud-idx, .tl, .aw-glyph, .hud-chip) come from /assets/dark/hud.css */
.aw-head{position:relative;margin:0 0 .4rem}
.aw-head .hud-idx{margin:0 0 1.05rem}
.aw-head .aw-range{color:var(--text-mute);letter-spacing:.14em}
.dk-page .aw-head h1{margin:0 0 1.1rem;font-size:clamp(2.2rem,1.6rem + 2.4vw,3.1rem);line-height:1.05;letter-spacing:-.025em}
.dk-page .aw-tally{display:flex;flex-wrap:wrap;gap:.5rem;list-style:none;margin:0;padding:0}
.dk-page .aw-tally li{display:inline-flex;align-items:center;gap:.5rem;margin:0;padding:.46rem .75rem .46rem .55rem;border:1px solid var(--hud-line);border-radius:4px;background:var(--surface);font:600 var(--fs-xs)/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--text-mute)}
.aw-tally b{color:#fff;font-size:.98rem;font-variant-numeric:tabular-nums}
.aw-tally .aw-glyph{width:1.3rem;height:1.3rem;margin:0;vertical-align:0}
.aw-tally .aw-glyph svg{width:1.3rem;height:1.3rem}
/* "Last update" line as a mono status readout (browsers without :has() keep the site's default callout) */
.dk-page:has(.aw) > blockquote{margin:1.15rem 0 1.5rem;padding:.6rem .95rem;border-left:2px solid var(--hud-line-hi);border-radius:0 4px 4px 0;background:var(--surface);font:500 var(--fs-sm)/1.6 var(--mono);letter-spacing:.02em;color:var(--text-mute)}
.dk-page:has(.aw) > blockquote p{margin:0}
.dk-page:has(.aw) > blockquote a{white-space:nowrap}
/* panels */
.aw{gap:1.5rem;margin:1.4rem 0 2.6rem}
.aw .hud-panel{padding:clamp(1rem,.6rem + 1.4vw,1.7rem) clamp(1rem,.5rem + 1.7vw,2rem) clamp(1.1rem,.7rem + 1.4vw,1.75rem)}
.aw-conf{--acc:var(--gold)}
.aw-fund{--acc:var(--accent-2)}
.aw-comp{--acc:var(--accent)}
.aw .hud-panel__head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:.45rem 1rem;margin:0 0 .55rem;padding-bottom:.9rem;border-bottom:1px solid var(--hud-line)}
.aw .hud-panel__head .hud-count{grid-column:2;grid-row:1;margin-left:0;justify-self:end;white-space:nowrap}
.dk-page .aw .hud-panel h2{grid-column:1 / -1;margin:.1rem 0 0}
/* timeline refinements: hanging glyph so wrapped lines align with the title, dots centred on the first text line */
.aw .tl-item{padding:.85rem 0}
.aw .tl-date{padding-top:.12rem}
.aw .tl-dot::after{top:.5em}
.aw .tl-item:first-child .tl-dot::before{top:.5em}
.aw .tl-body{padding-left:1.95rem}
.aw .tl-body .aw-glyph svg{width:1.5rem;height:1.5rem}
.aw .tl-body p{line-height:1.6}
.aw .tl-body > p:first-child{text-indent:-1.95rem}
.aw .tl-body .tl-meta{display:flex;flex-wrap:wrap;gap:.4rem;margin:.55rem 0 0;text-indent:0}
.aw .tl-kind{display:inline-flex;align-items:center;font:600 .66rem/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--text-mute);padding:.4rem .55rem;border:1px dashed var(--hud-line);border-radius:4px}
.aw .hud-chip .ext{font-size:.8em;opacity:.8}
@media (max-width:640px){
  /* hud.css's desktop override (.hud-panel .tl-item) out-specifies its own ≤640px .tl-item rule, so restate the stacked grid here */
  .aw .hud-panel .tl-item{grid-template-columns:1.25rem minmax(0,1fr);column-gap:.65rem;padding:.75rem 0}
  .aw .tl-date{padding-top:0}
  .aw .tl-dot::after{top:.3em}
  .aw .tl-item:first-child .tl-dot::before{top:.3em}
  .aw .tl-body{padding-left:1.7rem}
  .aw .tl-body > p:first-child{text-indent:-1.7rem}
  .aw .tl-body .aw-glyph{margin-right:.35rem;width:1.35rem}
  .aw .tl-body .aw-glyph svg{width:1.35rem;height:1.35rem}
  /* narrow head: index label, title, then the count on its own line (keeps the mono tag on one line) */
  .aw .hud-panel__head{grid-template-columns:minmax(0,1fr);gap:.35rem}
  .aw .hud-panel__head .hud-count{grid-column:1;grid-row:3;justify-self:start;margin-top:.15rem}
  .aw .hud-rule{width:24px}
  .dk-page .aw-tally li{padding:.4rem .6rem .4rem .5rem}
}
</style>

<header class="aw-head" markdown="0">
<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false">
  <symbol id="aw-i-trophy" viewBox="0 0 24 24"><path d="M7 4h10v5.5a5 5 0 0 1-10 0z"/><path d="M7 6H5.5A1.5 1.5 0 0 0 4 7.5V8a3 3 0 0 0 3 3"/><path d="M17 6h1.5A1.5 1.5 0 0 1 20 7.5V8a3 3 0 0 1-3 3"/><path d="M12 14.5V17"/><path d="M8.5 20h7"/><path d="M10 17h4l.6 3H9.4z"/></symbol>
  <symbol id="aw-i-medal" viewBox="0 0 24 24"><circle cx="12" cy="15.5" r="5"/><path d="M9.3 11.4 6 3.5h4l2.2 5.2"/><path d="M14.7 11.4 18 3.5h-4l-2.2 5.2"/></symbol>
  <symbol id="aw-i-ribbon" viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="5.5"/><circle cx="12" cy="8.5" r="2.1"/><path d="M8.9 13.1 7.2 21l4.8-2.7 4.8 2.7-1.7-7.9"/></symbol>
</svg>
<p class="hud-idx"><span class="hud-tag">Honors &amp; Awards</span><span class="hud-rule" aria-hidden="true"></span><span class="aw-range">2020 – 2026</span></p>
<h1>Awards</h1>
<ul class="aw-tally" aria-label="Summary">
  <li><span class="aw-glyph" data-medal="trophy" aria-hidden="true"><svg><use href="#aw-i-trophy"/></svg></span><b>2</b> Conference awards</li>
  <li><span class="aw-glyph" data-medal="gold" aria-hidden="true"><svg><use href="#aw-i-medal"/></svg></span><b>2</b> Gold</li>
  <li><span class="aw-glyph" data-medal="silver" aria-hidden="true"><svg><use href="#aw-i-medal"/></svg></span><b>2</b> Silver</li>
  <li><span class="aw-glyph" data-medal="bronze" aria-hidden="true"><svg><use href="#aw-i-medal"/></svg></span><b>2</b> Bronze</li>
</ul>
</header>

> Last update: 16th October 2026 &nbsp; [中文版本 (Chinese Version)](https://Wangyuhang-cmd.github.io/file/awards-zh/)

<div class="hud-page aw" markdown="0">

<section class="hud-frame hud-panel aw-conf" id="conference-awards" aria-labelledby="aw-h-conference">
  <div class="hud-panel__head">
    <p class="hud-idx"><span class="hud-no">01</span><span class="hud-rule" aria-hidden="true"></span><span class="hud-tag">Conference Awards</span></p>
    <h2 id="aw-h-conference">Conference Awards</h2>
    <span class="hud-count">2 entries</span>
  </div>
  <ol class="tl" role="list">
    <li class="tl-item" data-kind="award">
      <time class="tl-date" datetime="2026-10">2026/10</time>
      <span class="tl-dot" aria-hidden="true"></span>
      <div class="tl-body"><p><span class="aw-glyph" data-medal="trophy" aria-hidden="true"><svg><use href="#aw-i-trophy"/></svg></span><b>CoRL 2026 Travel Award</b> ($1,000) — Conference on Robot Learning (CoRL 2026), for <a href="/vlalert/">Observe Before You Alert: Adaptive Driver Alerting with Vision–Language Models</a></p></div>
    </li>
    <li class="tl-item" data-kind="award">
      <time class="tl-date" datetime="2024-07">2024/07</time>
      <span class="tl-dot" aria-hidden="true"></span>
      <div class="tl-body"><p><span class="aw-glyph" data-medal="trophy" aria-hidden="true"><svg><use href="#aw-i-trophy"/></svg></span><b>Best Paper Award</b> — Shape Modeling International (SMI 2024), for <a href="https://doi.org/10.1016/j.cag.2024.103998" target="_blank" rel="noopener">Computational design of custom-fit PAP masks</a></p></div>
    </li>
  </ol>
</section>

<section class="hud-frame hud-panel aw-fund" id="scholarships-funding" aria-labelledby="aw-h-funding">
  <div class="hud-panel__head">
    <p class="hud-idx"><span class="hud-no">02</span><span class="hud-rule" aria-hidden="true"></span><span class="hud-tag">Scholarships &amp; Funding</span></p>
    <h2 id="aw-h-funding">Scholarships &amp; Funding</h2>
    <span class="hud-count">2 entries</span>
  </div>
  <ol class="tl" role="list">
    <li class="tl-item">
      <time class="tl-date" datetime="2021-09">2021/09</time>
      <span class="tl-dot" aria-hidden="true"></span>
      <div class="tl-body"><p><span class="aw-glyph" data-medal="ribbon" aria-hidden="true"><svg><use href="#aw-i-ribbon"/></svg></span><b>Nanjing University of Information Science and Technology First Prize</b></p><p class="tl-meta"><span class="tl-kind">Scholarship</span></p></div>
    </li>
    <li class="tl-item">
      <span class="tl-date">2020-2021</span>
      <span class="tl-dot" aria-hidden="true"></span>
      <div class="tl-body"><p><span class="aw-glyph" data-medal="ribbon" aria-hidden="true"><svg><use href="#aw-i-ribbon"/></svg></span><b>First prize</b>, bonus RMB 1,000 &amp; Free Business Startup Office Utilization right in university-level Entrepreneurship Plan Competition</p><p class="tl-meta"><span class="tl-kind">Fund Award</span></p></div>
    </li>
  </ol>
</section>

<section class="hud-frame hud-panel aw-comp" id="research-competition" aria-labelledby="aw-h-competition">
  <div class="hud-panel__head">
    <p class="hud-idx"><span class="hud-no">03</span><span class="hud-rule" aria-hidden="true"></span><span class="hud-tag">Research Competition</span></p>
    <h2 id="aw-h-competition">Research Competition</h2>
    <span class="hud-count">8 entries</span>
  </div>
  <ol class="tl" role="list">
    <li class="tl-item">
      <time class="tl-date" datetime="2023-10">2023/10</time>
      <span class="tl-dot" aria-hidden="true"></span>
      <div class="tl-body"><p><span class="aw-glyph" data-medal="silver" aria-hidden="true"><svg><use href="#aw-i-medal"/></svg></span><b>Silver Medal</b> in 2023 China Collegiate Programming Contest, Guilin site (Team: 廉颇老矣，尚能夺金)</p></div>
    </li>
    <li class="tl-item">
      <time class="tl-date" datetime="2023-05">2023/05</time>
      <span class="tl-dot" aria-hidden="true"></span>
      <div class="tl-body"><p><span class="aw-glyph" data-medal="gold" aria-hidden="true"><svg><use href="#aw-i-medal"/></svg></span><b>Gold Medal</b> in 2023 Jiangsu Collegiate Programming Contest</p></div>
    </li>
    <li class="tl-item">
      <time class="tl-date" datetime="2023-05">2023/05</time>
      <span class="tl-dot" aria-hidden="true"></span>
      <div class="tl-body"><p><span class="aw-glyph" data-medal="gold" aria-hidden="true"><svg><use href="#aw-i-medal"/></svg></span><b>Gold Medal</b> in 2023 ICPC Xi’an National Invitational Programming Contest (Team: Top dogs like real party)</p><p class="tl-meta"><a class="hud-chip" href="https://board.xcpcio.com/icpc/48th/xian-invitational?group=official" target="_blank" rel="noopener">Team board <span class="ext" aria-hidden="true">&#8599;</span></a></p></div>
    </li>
    <li class="tl-item">
      <time class="tl-date" datetime="2022-12">2022/12</time>
      <span class="tl-dot" aria-hidden="true"></span>
      <div class="tl-body"><p><span class="aw-glyph" data-medal="bronze" aria-hidden="true"><svg><use href="#aw-i-medal"/></svg></span><b>Bronze Medal</b> in 2022 ICPC Asia Hefei Regional Contest</p></div>
    </li>
    <li class="tl-item">
      <time class="tl-date" datetime="2022-12">2022/12</time>
      <span class="tl-dot" aria-hidden="true"></span>
      <div class="tl-body"><p><span class="aw-glyph" data-medal="bronze" aria-hidden="true"><svg><use href="#aw-i-medal"/></svg></span><b>Bronze Medal</b> in 2022 ICPC Asia Jinan Regional Contest</p></div>
    </li>
    <li class="tl-item">
      <time class="tl-date" datetime="2022-05">2022/05</time>
      <span class="tl-dot" aria-hidden="true"></span>
      <div class="tl-body"><p><span class="aw-glyph" data-medal="silver" aria-hidden="true"><svg><use href="#aw-i-medal"/></svg></span><b>Silver Medal</b> in 2022 Jiangsu Collegiate Programming Contest (Team: 生椰拿铁不拿铁)</p><p class="tl-meta"><a class="hud-chip" href="https://board.xcpcio.com/provincial-contest/2022/jiangsu?group=official" target="_blank" rel="noopener">Team board <span class="ext" aria-hidden="true">&#8599;</span></a></p></div>
    </li>
    <li class="tl-item">
      <time class="tl-date" datetime="2022-05">2022/05</time>
      <span class="tl-dot" aria-hidden="true"></span>
      <div class="tl-body"><p><span class="aw-glyph" data-medal="ribbon" aria-hidden="true"><svg><use href="#aw-i-ribbon"/></svg></span><b>1st Prize</b> in China College Group Programming Ladder Tournament (CCCC_GLPT)</p></div>
    </li>
    <li class="tl-item">
      <time class="tl-date" datetime="2020-12">2020/12</time>
      <span class="tl-dot" aria-hidden="true"></span>
      <div class="tl-body"><p><span class="aw-glyph" data-medal="ribbon" aria-hidden="true"><svg><use href="#aw-i-ribbon"/></svg></span><b>3rd place</b> in College Sports 1500 meters Game</p></div>
    </li>
  </ol>
</section>

</div>
