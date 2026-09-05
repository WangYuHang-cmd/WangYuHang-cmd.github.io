/* hero-bg.js — three.js point-cloud road background.
   Mount points: <div data-hero-bg data-mode="fixed|contained"></div>
   Gates: reduced motion / narrow screens / no WebGL -> CSS fallback stays. */
const mount = document.querySelector("[data-hero-bg]");
const gate = () => {
  if (!mount) return false;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (innerWidth < 768) return false;
  try {
    const c = document.createElement("canvas");
    if (!c.getContext("webgl2") && !c.getContext("webgl")) return false;
  } catch (e) { return false; }
  return true;
};

if (gate()) {
  const THREE = await import("https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.1/three.module.min.js")
    .catch(() => import("https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.min.js"));
  const mode = mount.dataset.mode || "fixed";
  const contained = mode === "contained";
  const density = contained ? 0.5 : 1;

  const host = contained ? mount.parentElement : document.body;
  const canvas = document.createElement("canvas");
  canvas.id = "hero-canvas";
  if (contained) {
    Object.assign(canvas.style, { position: "absolute", inset: "0", zIndex: "0",
      pointerEvents: "none", opacity: "0", transition: "opacity .6s ease" });
    host.style.position = host.style.position || "relative";
    host.prepend(canvas);
  } else {
    document.body.prepend(canvas);
  }

  const W = () => (contained ? host.clientWidth : innerWidth);
  const H = () => (contained ? host.clientHeight : innerHeight);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: contained });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W(), H());
  if (contained) renderer.setClearColor(0x000000, 0); else renderer.setClearColor(0x070d1d, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x070d1d, 30, 220);
  const camera = new THREE.PerspectiveCamera(60, W() / H(), 0.1, 260);
  camera.position.set(0, 2.4, 8);
  camera.lookAt(0, 1, -60);

  const ZMIN = -220, ZMAX = 8, ZSPAN = ZMAX - ZMIN;
  const mkPoints = (n, fill, size, opts = {}) => {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) fill(i, pos, col);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial(Object.assign({
      size, vertexColors: true, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, sizeAttenuation: true
    }, opts));
    return new THREE.Points(g, m);
  };
  const cLane = new THREE.Color(0x7fb0ff), cScat = new THREE.Color(0x3b5ba9),
        cViolet = new THREE.Color(0x7c6cf0), cSky = new THREE.Color(0x31538f);

  /* A — road point cloud */
  const NA = Math.round(1400 * density);
  const road = mkPoints(NA, (i, pos, col) => {
    let x, c;
    const z = ZMIN + Math.random() * ZSPAN;
    if (Math.random() < 0.7) {
      const lanes = [-5.4, -1.8, 1.8, 5.4];
      x = lanes[(Math.random() * 4) | 0] + (Math.random() - 0.5) * 0.3;
      if (((z % 8) + 8) % 8 > 4) { x += 100000; } // hide half for dashes (offscreen)
      c = cLane;
    } else { x = (Math.random() - 0.5) * 14; c = cScat; }
    const dim = 1 - (Math.abs(z) / 220) * 0.6;
    pos.set([x, 0.02, z], i * 3);
    col.set([c.r * dim, c.g * dim, c.b * dim], i * 3);
  }, 0.09);
  scene.add(road);
  const roadPos = road.geometry.attributes.position;

  /* B — driving trajectories (6 trails × 48 pts) */
  const TRAILS = Math.round(6 * density) || 3, TN = 48;
  const trails = [];
  for (let t = 0; t < TRAILS; t++) {
    const laneX = [-5.4, -1.8, 1.8, 5.4][t % 4];
    const cfg = { laneX, A: Math.random() * 2.2, f: 0.02 + Math.random() * 0.03,
      phi: Math.random() * 6.28, s: ZMIN + Math.random() * ZSPAN,
      v: 30 + Math.random() * 14, ring: new Float32Array(TN * 3), head: 0, tick: 0 };
    const color = t % 2 ? cViolet : cLane;
    const pts = mkPoints(TN, (i, pos, col) => {
      pos.set([laneX, 0.15, ZMIN], i * 3);
      const k = Math.pow(1 - i / TN, 2);
      col.set([color.r * k, color.g * k, color.b * k], i * 3);
    }, 0.14);
    scene.add(pts);
    trails.push({ cfg, pts, color });
  }

  /* C — sky dust */
  const NC = Math.round(600 * density);
  const sky = mkPoints(NC, (i, pos, col) => {
    const x = (Math.random() - 0.5) * 160, y = 4 + Math.random() * 56, z = ZMIN + Math.random() * ZSPAN;
    const c = Math.random() < 0.3 ? cLane : cSky, k = 0.35 + Math.random() * 0.4;
    pos.set([x, y, z], i * 3);
    col.set([c.r * k, c.g * k, c.b * k], i * 3);
  }, 0.12);
  scene.add(sky);

  /* interaction & loop */
  let mx = 0, my = 0;
  if (matchMedia("(hover:hover)").matches) {
    addEventListener("pointermove", (e) => {
      mx = (e.clientX / innerWidth) * 2 - 1;
      my = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });
  }
  const clock = new THREE.Clock();
  let paused = false, scrolledAway = false;

  const tick = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    for (let i = 0; i < NA; i++) {
      let z = roadPos.array[i * 3 + 2] + 26 * dt;
      if (z > ZMAX) z -= ZSPAN;
      roadPos.array[i * 3 + 2] = z;
    }
    roadPos.needsUpdate = true;
    for (const { cfg, pts } of trails) {
      cfg.s += cfg.v * dt;
      if (cfg.s > ZMAX) cfg.s -= ZSPAN;
      cfg.tick++;
      if (cfg.tick % 2 === 0) {
        const x = cfg.laneX + cfg.A * Math.sin(cfg.s * cfg.f + cfg.phi);
        cfg.ring.copyWithin(3, 0, (TN - 1) * 3);
        cfg.ring[0] = x; cfg.ring[1] = 0.15; cfg.ring[2] = cfg.s;
        pts.geometry.attributes.position.array.set(cfg.ring);
        pts.geometry.attributes.position.needsUpdate = true;
      }
    }
    sky.rotation.y += 0.004 * dt;
    camera.position.x += (mx * 0.9 - camera.position.x) * 0.04;
    camera.position.y += (2.4 + my * 0.4 - camera.position.y) * 0.04;
    camera.lookAt(0, 1, -60);
    renderer.render(scene, camera);
  };
  const setLoop = (on) => renderer.setAnimationLoop(on ? tick : null);
  setLoop(true);
  requestAnimationFrame(() => canvas.classList.add("on"));

  document.addEventListener("visibilitychange", () => {
    paused = document.hidden;
    setLoop(!paused && !scrolledAway);
  });
  if (!contained) {
    let rafPending = false;
    addEventListener("scroll", () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        const away = scrollY > innerHeight * 1.6;
        if (away !== scrolledAway) {
          scrolledAway = away;
          canvas.style.opacity = away ? "0.15" : "1";
          setLoop(!paused && !away);
        }
      });
    }, { passive: true });
  }
  let rto;
  addEventListener("resize", () => {
    clearTimeout(rto);
    rto = setTimeout(() => {
      camera.aspect = W() / H();
      camera.updateProjectionMatrix();
      renderer.setSize(W(), H());
    }, 150);
  });
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    canvas.style.display = "none";
    setLoop(false);
  });
}
