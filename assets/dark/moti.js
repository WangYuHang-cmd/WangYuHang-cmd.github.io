/* moti.js — lifecycle, gates/tiers, input, reactions, speech bubbles, a11y and the window.__moti debug handle for the
   RoboCar mascot. Expects the stage markup of the plan (§3.7): #moti-stage[data-moti] > button.moti-hit > picture,
   plus sibling .moti-bubble (p.moti-bubble__text, a.moti-bubble__cta, button.moti-bubble__x) and p#moti-live.
   Modes on the stage: poster (default HTML) → loading → live | lost. Every failure path simply keeps the poster.
   Dev switches (hash): #moti-force skips the GL performance-caveat gate (headless SwiftShader), #moti-snapshot renders
   the 880² rest pose for the poster (→ __moti.snapshot()), #moti-debug adds a drag-to-orbit for tuning. */
import { loadThree, hasWebGL } from './three-loader.js';
let buildRig = null, K = null, ACCENTS = null; // moti-rig.js is imported in boot() once the gates pass, so gated clients never download it

const LINES = [ // ≤ 70 chars, each with a real link (plan §2d)
  ["Hi, I'm Moti — Yuhang's co-pilot. Ask me about his datasets.", '#about', 'About Yuhang'],
  ['New: VLAlert accepted at CoRL 2026, plus a $1,000 Travel Award!', '/vlalert/', 'VLAlert'],
  ['DriveMotion is headed to WACV 2027: 400 h of driver motion.', '/drivemotion/', 'DriveMotion'],
  ['DriveDNA: 4,121 drives, 465 drivers, 975 h of naturalistic driving.', '/drivedna/', 'DriveDNA'],
  ['ADAS-TO: 15,659 real takeovers from 327 drivers across 22 brands.', '/adasto/', 'ADAS-TO'],
  ['OpenLKA: lane keeping assist from 62 production vehicle models.', '/openlka/', 'OpenLKA'],
];
const CYCLE = ['honk', 'spin', 'wink'], SNAP_T = 1.3, TAU = Math.PI * 2;
const hash = location.hash;
const DEV = { snapshot: hash.includes('moti-snapshot'), debug: hash.includes('moti-debug') };
DEV.force = DEV.snapshot || hash.includes('moti-force');
const stage = document.getElementById('moti-stage');
const hit = stage?.querySelector('.moti-hit'), bubble = stage?.querySelector('.moti-bubble'), liveEl = document.getElementById('moti-live');
const rmq = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(pointer:fine)').matches && matchMedia('(hover:hover)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let mode = 'poster', running = false, THREE = null, renderer = null, rig = null, canvas = null;
const tier = (() => { if (DEV.force) return innerWidth < 768 ? 'low' : 'high';
  return innerWidth < 768 || (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4 ? 'low' : 'high'; })();
const VIS = { run: .2, idle: .6 }; // stage intersection ratios: render while ≥ 20 % of the stage is on screen, idle bubbles only at ≥ 60 %
const app = { visible: true, inView: true, tabVisible: !document.hidden, lost: false, hover: false, focus: false, tap: false,
  clickIdx: 0, lineIdx: 0, autoShows: 0, quiet: false, fps: 0 };
try { app.quiet = sessionStorage.getItem('moti:quiet') === '1'; } catch { /* storage blocked: never quiet */ }
// rest-pose projections of the head centre / bubble anchor as stage fractions (refreshed from the rig when live)
let headFrac = { x: .49, y: .5 }, anchorFrac = { x: .49, y: .213 };

/* ---------- tiny tween helper (no library) ---------- */
const tweens = new Set();
const ease = { linear: (p) => p, outCubic: (p) => 1 - (1 - p) ** 3, inQuad: (p) => p * p, outBack: (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2 };
const tween = (ms, fn, e = ease.outCubic, done) => { tweens.add({ t0: performance.now(), ms, fn, e, done }); };
function runTweens(now) { for (const tw of tweens) { const p = Math.min(1, (now - tw.t0) / tw.ms); tw.fn(tw.e(p), p); if (p >= 1) { tweens.delete(tw); tw.done?.(); } } }

/* ---------- speech bubble (works in every mode) ---------- */
let hideTimer = 0, dwellTimer = 0, idleTimer = 0;
const nextLine = () => (app.lineIdx % LINES.length) + 1; // first show is line 1, then sequential
function say(i = nextLine()) {
  if (!bubble) return false;
  const idx = (((i - 1) % LINES.length) + LINES.length) % LINES.length, [text, href, label] = LINES[idx];
  bubble.querySelector('.moti-bubble__text').textContent = text;
  const cta = bubble.querySelector('.moti-bubble__cta'); cta.href = href; cta.textContent = `${label} →`;
  bubble.hidden = false; bubble.classList.remove('is-in'); void bubble.offsetWidth; bubble.classList.add('is-in');
  placeBubble(); if (liveEl) liveEl.textContent = `Moti says: ${text}`;
  app.lineIdx = idx + 1; if (rig) rig.state.talk = 1.4;
  clearTimeout(hideTimer); if (!rmq.matches) hideTimer = setTimeout(tryHide, 7000);
  return true;
}
function tryHide() { // hold the bubble only while a fine pointer really hovers or keyboard focus is on Moti / inside the bubble — not for the
  // sticky :hover of touch or the non-visible focus a mouse click leaves on the button, which kept it open until the next click elsewhere
  const kbd = hit.matches(':focus-visible') || bubble.contains(document.activeElement), hov = finePointer && app.hover;
  if (hov || kbd) { hideTimer = setTimeout(tryHide, 1000); return; } hideBubble(); }
function hideBubble() { clearTimeout(hideTimer); if (bubble) bubble.hidden = true; }
function dismiss() { hideBubble(); app.quiet = true; clearTimeout(idleTimer); clearTimeout(dwellTimer); try { sessionStorage.setItem('moti:quiet', '1'); } catch { /* ignore */ } }
function placeBubble() {
  if (!bubble || bubble.hidden) return;
  const W = stage.clientWidth, H = stage.clientHeight, ax = anchorFrac.x * W, ay = anchorFrac.y * H, bw = bubble.offsetWidth || 220, bh = bubble.offsetHeight || 90;
  const cx = clamp(ax, bw / 2 + 8, Math.max(bw / 2 + 8, W - bw / 2 - 8)), by = Math.max(ay, bh + 18); // never leave the (overflow-hidden) stage
  bubble.style.setProperty('--bx', `${cx.toFixed(1)}px`); bubble.style.setProperty('--by', `${by.toFixed(1)}px`); bubble.style.setProperty('--tx', `${clamp(ax - (cx - bw / 2), 14, bw - 14).toFixed(1)}px`);
}
function armIdle(ms) { // idle lines: first at 6 s, then every 22–30 s, at most 3 per page view, never when quiet / reduced motion
  clearTimeout(idleTimer); if (rmq.matches || app.quiet || app.autoShows >= 3) return;
  idleTimer = setTimeout(() => { if (app.inView && app.tabVisible && bubble.hidden && !app.quiet) { app.autoShows++; say(); } armIdle(22000 + Math.random() * 8000); }, ms);
}

/* ---------- hover / focus / click reactions ---------- */
function applyHover() { if (!rig) return; const on = app.hover || app.focus || app.tap; if (on && !rig.state.hoverT) rig.state.earWiggle = 1; rig.state.hoverT = on ? 1 : 0; }
function startDwell() { clearTimeout(dwellTimer); if (app.quiet || rmq.matches || !bubble.hidden) return; dwellTimer = setTimeout(() => say(), 350); }
function react(name) {
  if (!rig) return false; const S = rig.state;
  if (name === 'honk') { // headlight ×5 (120 ms hold + 420 ms decay), excited eyes, halo burst + ripple, squash-and-stretch
    S.lampBoost = K.lampHonk - K.lampIdle; S.excite = .7; rig.burst();
    tween(120, () => {}, ease.linear, () => tween(420, (e) => { S.lampBoost = (K.lampHonk - K.lampIdle) * (1 - e); }));
    tween(500, (e) => { S.haloScale = 1 + .12 * Math.sin(Math.PI * e); }, ease.outBack, () => { S.haloScale = 1; });
    S.ripple = 0; tween(700, (e, p) => { S.ripple = p; }, ease.linear, () => { S.ripple = -1; });
    tween(180, (e) => { S.squash = 1 - .14 * e; }, ease.inQuad, () => tween(520, (e, p) => { S.squash = 1 - .14 * Math.cos(TAU * 1.5 * p) * Math.exp(-3 * p); }, ease.linear, () => { S.squash = 1; }));
  } else if (name === 'spin') { // 360° easeOutCubic 900 ms, head lags
    S.spinning = true; tween(900, (e, p) => { S.spin = TAU * e; S.headLag = -.5 * Math.sin(Math.PI * p) * (1 - .5 * p); }, ease.outCubic, () => { S.spin = 0; S.headLag = 0; S.spinning = false; });
  } else if (name === 'wink') { S.wink = .45; tween(450, (e, p) => { S.roll = .18 * Math.sin(Math.PI * p); }, ease.linear, () => { S.roll = 0; }); }
  else return false;
  return true;
}
function wireInput() {
  hit.addEventListener('click', () => { react(CYCLE[app.clickIdx++ % CYCLE.length]); say();
    if (!finePointer) { app.tap = true; applyHover(); setTimeout(() => { app.tap = false; applyHover(); }, 1200); } });
  if (finePointer) {
    stage.addEventListener('pointerenter', () => { app.hover = true; applyHover(); startDwell(); });
    stage.addEventListener('pointerleave', () => { app.hover = false; applyHover(); clearTimeout(dwellTimer); });
    window.addEventListener('pointermove', (e) => { // eyes lead, head follows, body turns — target relative to the head point
      if (!rig || DEV.snapshot) return; const r = stage.getBoundingClientRect();
      const nx = (e.clientX - (r.left + r.width * headFrac.x)) / Math.max(360, innerWidth * .45), ny = (e.clientY - (r.top + r.height * headFrac.y)) / Math.max(260, innerHeight * .45);
      rig.state.gazeX = clamp(nx * .9, -K.yawMax, K.yawMax); rig.state.gazeY = clamp(ny * .7, -K.pitchUp, K.pitchDown);
    }, { passive: true });
  }
  hit.addEventListener('focus', () => { if (!hit.matches(':focus-visible')) return; app.focus = true; applyHover(); startDwell(); });
  hit.addEventListener('blur', () => { app.focus = false; applyHover(); clearTimeout(dwellTimer); });
  bubble.querySelector('.moti-bubble__x').addEventListener('click', dismiss);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !bubble.hidden) dismiss(); });
  if (DEV.debug) { let drag = null;
    stage.addEventListener('pointerdown', (e) => { if (rig) drag = { x: e.clientX, y: e.clientY, ry: rig.root.rotation.y, cy: rig.camera.position.y }; });
    window.addEventListener('pointermove', (e) => { if (!drag) return; rig.root.rotation.y = drag.ry + (e.clientX - drag.x) * .01; rig.camera.position.y = clamp(drag.cy + (e.clientY - drag.y) * .01, .3, 5); rig.camera.lookAt(0, 1.25, .1); });
    window.addEventListener('pointerup', () => { drag = null; }); }
}

/* ---------- lifecycle ---------- */
const setMode = (m) => { mode = m; stage.dataset.moti = m; };
const shouldRun = () => mode === 'live' && app.visible && app.tabVisible && !app.lost && !DEV.snapshot;
let lastRender = 0;
function syncLoop() { const want = shouldRun(); if (!renderer || want === running) return; running = want; lastRender = performance.now(); renderer.setAnimationLoop(want ? frame : null); }
function frame(now) {
  const ms = now - lastRender; if (tier === 'low' && ms < 31) return; // 30 fps cap on the low tier
  lastRender = now; const dt = Math.min(.05, ms / 1000); app.fps = app.fps ? app.fps * .92 + (1000 / Math.max(1, ms)) * .08 : 60;
  runTweens(now); rig.state.rest = false; rig.update(dt, now / 1000); renderer.render(rig.scene, rig.camera);
}
function project(v) { // explicit matrix updates: resize() may run before the first render
  rig.scene.updateMatrixWorld(); rig.camera.updateMatrixWorld(); rig.camera.matrixWorldInverse.copy(rig.camera.matrixWorld).invert();
  const p = v.project(rig.camera); return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 }; }
function resize() {
  if (!renderer || DEV.snapshot) return; const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, tier === 'high' ? 1.75 : 1.25)); renderer.setSize(w, h, false);
  rig.camera.aspect = w / h; rig.camera.updateProjectionMatrix();
  headFrac = project(rig.headWorld()); anchorFrac = project(rig.anchorWorld()); placeBubble();
  if (!running) renderer.render(rig.scene, rig.camera);
}
function wireObservers() {
  let raf = 0; new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(resize); }).observe(stage);
  new IntersectionObserver((entries) => { // the stage's own visibility drives the loop (a viewport-based scrollY gate froze Moti in stacked layouts); last entry = newest
    const e = entries[entries.length - 1]; app.visible = e.isIntersecting && e.intersectionRatio >= VIS.run; app.inView = e.intersectionRatio >= VIS.idle; syncLoop();
  }, { threshold: [0, VIS.run, VIS.idle] }).observe(stage);
  document.addEventListener('visibilitychange', () => { app.tabVisible = !document.hidden; syncLoop(); });
  rmq.addEventListener('change', (e) => { if (e.matches && renderer) teardown('poster'); });
}
function teardown(to) { try { renderer?.setAnimationLoop(null); rig?.dispose(); renderer?.dispose(); canvas?.remove(); } catch { /* ignore */ } running = false; renderer = rig = canvas = null; setMode(to); }
function gateReason() {
  if (rmq.matches) return 'reduced-motion'; if (navigator.connection?.saveData) return 'save-data';
  if (!hasWebGL({ failIfMajorPerformanceCaveat: !DEV.force })) return 'no-webgl'; return '';
}
function accents() { try { const cs = getComputedStyle(stage); return ['tridrive', 'vlalert', 'adasto', 'openlka', 'baton', 'drivedna', 'drivemotion'].map((k, i) => cs.getPropertyValue(`--acc-${k}`).trim() || ACCENTS[i]); } catch { return ACCENTS; } }
async function start() {
  canvas = document.createElement('canvas'); canvas.className = 'moti-canvas'; canvas.setAttribute('aria-hidden', 'true');
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: true, antialias: true, powerPreference: 'low-power', failIfMajorPerformanceCaveat: !DEV.force });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.setClearColor(0x000000, 0);
  rig = buildRig(THREE, { tier, accents: accents(), renderer: tier === 'high' ? renderer : null });
  rig.state.autoGaze = !finePointer;
  if (DEV.force || DEV.debug) window.__motiRig = rig; // dev hashes only: lets the harness photograph reaction frames
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); app.lost = true; setMode('lost'); syncLoop(); });
  canvas.addEventListener('webglcontextrestored', () => { app.lost = false; setMode('live'); syncLoop(); });
  hit.appendChild(canvas);
  if (DEV.snapshot) { renderer.setPixelRatio(1); renderer.setSize(880, 880, false); rig.state.rest = true; rig.update(0, SNAP_T); renderer.render(rig.scene, rig.camera); setMode('live'); return; }
  resize(); rig.update(0, 0); renderer.render(rig.scene, rig.camera); // first frame is drawn before the cross-fade starts
  setMode('live'); syncLoop(); armIdle(6000);
}
async function boot() {
  wireInput(); wireObservers();
  const gate = gateReason(); if (gate) { if (!rmq.matches) armIdle(6000); return; }
  try {
    setMode('loading');
    const [three, rigMod] = await Promise.all([loadThree(), import('./moti-rig.js')]); THREE = three; ({ buildRig, K, ACCENTS } = rigMod);
    if (rmq.matches || navigator.connection?.saveData) { setMode('poster'); if (!rmq.matches) armIdle(6000); return; } // re-check: the gates may have flipped while loading
    await start();
  } catch (err) { console.warn('[moti] poster fallback:', err?.message || err); teardown('poster'); }
}

window.__moti = {
  get mode() { return mode; }, get tier() { return tier; }, get running() { return running; },
  stats() { if (!renderer) return null; const r = renderer.info.render; return { calls: r.calls, triangles: r.triangles, points: r.points, lines: r.lines, fps: Math.round(app.fps), dpr: renderer.getPixelRatio(), size: [canvas.width, canvas.height], tier, nodes: rig.nodeCount }; },
  react: (name) => react(name), say: (i) => say(i),
  snapshot() { if (!renderer) return null; const S = rig.state, prev = S.rest; S.rest = true; rig.update(0, SNAP_T); renderer.render(rig.scene, rig.camera); const url = canvas.toDataURL('image/png'); S.rest = prev; return url; },
};
if (stage && hit && bubble) boot();
