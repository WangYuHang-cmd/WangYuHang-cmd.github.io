---
layout: dark
permalink: /projects/index.html
title: Projects
---

# Projects & Datasets

My research builds large-scale, real-world datasets and benchmarks for driving automation —
lane-keeping assist, human takeovers, control transitions, driver behavior, and safety alerting.
Below is the full set of projects. Explore more of my work on
<a href="https://scholar.google.com/citations?user=2bYt9ZAAAAAJ&hl=en" target="_blank">Google Scholar</a>,
<a href="https://huggingface.co/HenryYHW" target="_blank">Hugging Face</a>,
<a href="https://www.researchgate.net/profile/Yuhang-Wang-72" target="_blank">ResearchGate</a>, and
<a href="https://github.com/WangYuHang-cmd" target="_blank">GitHub</a>.

<style>
.works-wrap{--accent:#2563eb}
.works-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1.4rem;margin:1.6rem 0 1rem}
.work-card{display:flex;flex-direction:column;background:#fff;border:1px solid #ececec;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.06);transition:transform .15s ease,box-shadow .15s ease}
.work-card:hover{transform:translateY(-3px);box-shadow:0 10px 26px rgba(0,0,0,.12)}
.work-card .thumb{display:block;aspect-ratio:16/9;overflow:hidden;background:#f2f4f8}
.work-card .thumb img{width:100%;height:100%;object-fit:cover;display:block}
.work-card .body{padding:1rem 1.1rem 1.2rem;display:flex;flex-direction:column;flex:1}
.work-card h3{margin:.1rem 0 .1rem;font-size:1.25rem}
.work-card h3 a{color:#1f2937;text-decoration:none}
.work-card h3 a:hover{color:var(--accent)}
.work-card .venue{font-size:.78rem;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:.03em;margin-bottom:.5rem}
.work-card p.blurb{font-size:.94rem;color:#4b5563;flex:1;margin:.1rem 0 .8rem}
.badges{display:flex;flex-wrap:wrap;gap:.4rem}
.badges a{font-size:.8rem;font-weight:600;text-decoration:none;padding:.28rem .7rem;border-radius:999px;border:1px solid #e2e6ee;color:#374151;background:#f8fafc}
.badges a:hover{background:var(--accent);border-color:var(--accent);color:#fff}
.badges a.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.badges a.primary:hover{background:#1d4ed8}
</style>

<div class="works-wrap" markdown="0">
<div class="works-grid">

  <div class="work-card">
    <a class="thumb" href="/openlka/"><img src="/images/th_openlka.jpg" alt="OpenLKA"></a>
    <div class="body">
      <div class="venue">IEEE ITSC 2025</div>
      <h3><a href="/openlka/">OpenLKA</a></h3>
      <p class="blurb">The first large-scale open dataset of Lane Keeping Assist from 62 production vehicle models under real-world driving, pairing decoded CAN-bus logs with synchronized 1080p video.</p>
      <div class="badges">
        <a class="primary" href="/openlka/">Project Page →</a>
        <a href="https://ieeexplore.ieee.org/document/11423194/" target="_blank">Paper</a>
        <a href="https://github.com/OpenLKA/OpenLKA" target="_blank">GitHub</a>
      </div>
    </div>
  </div>

  <div class="work-card">
    <a class="thumb" href="/adasto/"><img src="/images/th_adasto.jpg" alt="ADAS-TO"></a>
    <div class="body">
      <div class="venue">IEEE ITSC 2026</div>
      <h3><a href="/adasto/">ADAS-TO</a></h3>
      <p class="blurb">15,000+ real-world ADAS takeover events from 327 drivers across 22 brands — multimodal and vision-language-annotated — capturing the moment drivers reclaim control.</p>
      <div class="badges">
        <a class="primary" href="/adasto/">Project Page →</a>
        <a href="https://arxiv.org/abs/2603.06986" target="_blank">arXiv</a>
        <a href="https://github.com/OpenLKA/ADAS-TO" target="_blank">GitHub</a>
        <a href="https://huggingface.co/datasets/HenryYHW/ADAS-TO" target="_blank">🤗 Data</a>
      </div>
    </div>
  </div>

  <div class="work-card">
    <a class="thumb" href="/baton/"><img src="/images/th_baton.jpg" alt="BATON"></a>
    <div class="body">
      <div class="venue">Preprint 2026</div>
      <h3><a href="/baton/">BATON</a></h3>
      <p class="blurb">A multimodal benchmark for bidirectional human–automation control transitions: 136.6 h of naturalistic driving with video, CAN, radar and GPS, and three prediction tasks.</p>
      <div class="badges">
        <a class="primary" href="/baton/">Project Page →</a>
        <a href="https://arxiv.org/abs/2604.07263" target="_blank">arXiv</a>
        <a href="https://github.com/OpenLKA/BATON" target="_blank">GitHub</a>
        <a href="https://huggingface.co/datasets/HenryYHW/BATON" target="_blank">🤗 Data</a>
      </div>
    </div>
  </div>

  <div class="work-card">
    <a class="thumb" href="/drivedna/"><img src="/images/th_drivedna.jpg" alt="DriveDNA"></a>
    <div class="body">
      <div class="venue">Preprint 2026</div>
      <h3><a href="/drivedna/">DriveDNA</a></h3>
      <p class="blurb">A benchmark for driving-style identification — 4,121 drives from 465 drivers, 975 h — that isolates driver-specific behavior from vehicle, route and environment confounds.</p>
      <div class="badges">
        <a class="primary" href="/drivedna/">Project Page →</a>
        <a href="https://huggingface.co/papers/2607.23822" target="_blank">Paper</a>
        <a href="https://github.com/WangYuHang-cmd/DriveDNA" target="_blank">GitHub</a>
        <a href="https://huggingface.co/datasets/HenryYHW/DriveDNA" target="_blank">🤗 Data</a>
      </div>
    </div>
  </div>

  <div class="work-card">
    <a class="thumb" href="/drivemotion/"><img src="/images/th_drivemotion.jpg" alt="DriveMotion"></a>
    <div class="body">
      <div class="venue">Dataset 2026</div>
      <h3><a href="/drivemotion/">DriveMotion</a></h3>
      <p class="blurb">A multi-source benchmark for driver body-motion forecasting: 400 h of in-cabin skeleton motion (133 keypoints/frame, privacy-reduced) with an 8 s → 4 s prediction task.</p>
      <div class="badges">
        <a class="primary" href="/drivemotion/">Project Page →</a>
        <a href="https://huggingface.co/datasets/HenryYHW/DriveMotion" target="_blank">🤗 Data</a>
      </div>
    </div>
  </div>

  <div class="work-card">
    <a class="thumb" href="/vlalert/"><img src="/images/th_vlalert.jpg" alt="VLAlert"></a>
    <div class="body">
      <div class="venue">CoRL 2026</div>
      <h3><a href="/vlalert/">VLAlert</a></h3>
      <p class="blurb">A unified per-tick benchmark for driving-alert decisions — SILENT, OBSERVE or ALERT — integrating six driving-event datasets into 192,892 one-second labeled ticks.</p>
      <div class="badges">
        <a class="primary" href="/vlalert/">Project Page →</a>
        <a href="https://huggingface.co/datasets/HenryYHW/VLAlert" target="_blank">🤗 Data</a>
      </div>
    </div>
  </div>

</div>
</div>
