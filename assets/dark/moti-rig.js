/* moti-rig.js — procedural three.js RoboCar "Moti" (MOTIF-Lab mascot): geometry, canvas textures, materials, the
   two-ring neural halo and the per-frame update. Pure scene code — no DOM, no renderer ownership (a renderer is only
   needed for the optional PMREM "night room" environment on the high tier). three.js is injected (see three-loader.js).
   buildRig(THREE, { tier, accents, seed, renderer }) → { scene, camera, root, chassis, headPivot, eyes, wheels, lamps,
   antenna, halo, shadow, road, ripple, state, update, burst, anchorWorld, headWorld, dispose }
   Units ≈ metres, +Z is Moti's front, root.rotation.y = -0.42 gives the three-quarter view facing the name. */

export const K = Object.freeze({
  bobAmp: .035, bobHz: .55, pitchAmp: .012,                       // idle motion
  wheelR: .32, vIdle: 1.3, vHover: 2.4, vSpin: 4.5,                // wheel ω = v / wheelR
  yawMax: .50, pitchUp: .28, pitchDown: .22, kEye: 14, kHead: 8,   // look-at: eyes lead, head follows
  bodyYaw: .14, bodyRoll: .05, eyeLead: .07,
  blinkMin: 2.4, blinkMax: 5.2, blinkMs: 140, doubleBlink: .2,
  ringA: { r: 1.25, n: 12, w: .22 }, ringB: { r: 1.00, n: 8, w: -.31 },     // high tier (20 nodes)
  ringALow: { r: 1.25, n: 8, w: .22 }, ringBLow: { r: 1.00, n: 6, w: -.31 }, // low tier (14 nodes)
  nodeR: .068, pulses: 12, pulseSpeed: [1.1, 1.9], hoverBoost: 1.8,
  lampIdle: 1.2, lampHover: 2.0, lampHonk: 5,
  antennaSway: [1.7, 2.9], dashTile: 6.4 / 3,
});
export const ACCENTS = ['#33e0ff', '#5c8bff', '#ff6b6b', '#ffb454', '#f0c34e', '#b07cff', '#3ddc97'];
const TAU = Math.PI * 2;
const mulberry32 = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);

/* roundedBox(): port of the maths in three.js examples/jsm/geometries/RoundedBoxGeometry.js (MIT © 2010-2024 three.js
   authors). A BoxGeometry with an odd segment count whose vertices are pushed onto a sphere-cornered shell; kept indexed,
   UVs left as the box's (no rounded part of Moti is textured). */
export function roundedBox(THREE, w, h, d, r, seg = 2) {
  const n = seg * 2 + 1; r = Math.min(w / 2, h / 2, d / 2, r);
  const g = new THREE.BoxGeometry(1, 1, 1, n, n, n);
  const pos = g.attributes.position.array, nor = g.attributes.normal.array;
  const box = new THREE.Vector3(w, h, d).multiplyScalar(.5).subScalar(r);
  const p = new THREE.Vector3(), q = new THREE.Vector3(), half = .5 / n;
  for (let i = 0; i < pos.length; i += 3) {
    p.fromArray(pos, i); q.copy(p);
    q.x -= Math.sign(q.x) * half; q.y -= Math.sign(q.y) * half; q.z -= Math.sign(q.z) * half; q.normalize();
    pos[i] = box.x * Math.sign(p.x) + q.x * r; pos[i + 1] = box.y * Math.sign(p.y) + q.y * r; pos[i + 2] = box.z * Math.sign(p.z) + q.z * r;
    nor[i] = q.x; nor[i + 1] = q.y; nor[i + 2] = q.z;
  }
  g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = true; g.computeBoundingSphere();
  return g;
}

/* ---------- canvas textures ---------- */
const canvas2d = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
const tex = (THREE, c, srgb = true) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

/** 4-frame eye atlas (open · happy · wink · excited), 128 px frames, cyan display-eye look. */
export function eyeAtlas(THREE) {
  const [c, g] = canvas2d(512, 128);
  const CY = '#33e0ff', MID = '#a4f3ff', CORE = '#f4feff';
  const frame = (i, fn) => { g.save(); g.translate(i * 128, 0); fn(); g.restore(); };
  const glow = (fn, blur = 14) => { g.save(); g.shadowColor = 'rgba(51,224,255,.9)'; g.shadowBlur = blur; fn(); g.restore(); };
  const lozenge = (w, h, r) => {
    glow(() => { g.fillStyle = CY; rr(g, 64 - w / 2, 64 - h / 2, w, h, r); g.fill(); });
    g.fillStyle = MID; rr(g, 64 - w * .36, 64 - h * .38, w * .72, h * .76, r * .7); g.fill();
    g.fillStyle = CORE; rr(g, 64 - w * .18, 64 - h * .30, w * .36, h * .42, r * .4); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(64 - w * .22, 64 - h * .27, w * .11, 0, TAU); g.fill();
  };
  const stroke = (lw, col, path) => { g.lineWidth = lw; g.lineCap = 'round'; g.strokeStyle = col; g.beginPath(); path(); g.stroke(); };
  frame(0, () => lozenge(60, 78, 26));
  frame(1, () => { const arc = () => g.arc(64, 84, 30, Math.PI * 1.12, Math.PI * 1.88); glow(() => stroke(16, CY, arc)); stroke(7, CORE, arc); });
  frame(2, () => { const line = () => { g.moveTo(34, 58); g.quadraticCurveTo(64, 86, 94, 58); }; glow(() => stroke(14, CY, line)); stroke(6, CORE, line); });
  frame(3, () => {
    lozenge(70, 90, 30); g.fillStyle = '#fff';
    const star = (x, y, s) => { g.beginPath(); g.moveTo(x, y - s); g.quadraticCurveTo(x, y, x + s, y); g.quadraticCurveTo(x, y, x, y + s); g.quadraticCurveTo(x, y, x - s, y); g.quadraticCurveTo(x, y, x, y - s); g.fill(); };
    star(84, 44, 11); star(46, 90, 6);
  });
  const t = tex(THREE, c); t.repeat.set(.25, 1); return t;
}
export function softDot(THREE) {
  const [c, g] = canvas2d(64, 64); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.3, 'rgba(255,255,255,.55)'); gr.addColorStop(.65, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return tex(THREE, c, false);
}
export function shadowTex(THREE) {
  const [c, g] = canvas2d(256, 256); const gr = g.createRadialGradient(128, 128, 8, 128, 128, 128);
  gr.addColorStop(0, 'rgba(3,7,18,1)'); gr.addColorStop(.42, 'rgba(3,7,18,.62)'); gr.addColorStop(1, 'rgba(3,7,18,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return tex(THREE, c);
}
export function dashTile(THREE) {
  const [c, g] = canvas2d(128, 256); g.fillStyle = '#fff'; g.shadowColor = 'rgba(255,255,255,.9)'; g.shadowBlur = 6;
  rr(g, 60, 52, 8, 152, 4); g.fill(); g.shadowBlur = 0; g.globalAlpha = .3; g.fillRect(14, 0, 2, 256); g.fillRect(112, 0, 2, 256);
  const t = tex(THREE, c, false); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 3); return t;
}
export function hubCap(THREE) {
  const [c, g] = canvas2d(128, 128); g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#33e0ff'; g.lineWidth = 7; g.beginPath(); g.arc(64, 64, 40, 0, TAU); g.stroke();
  g.fillStyle = 'rgba(51,224,255,.55)'; g.beginPath(); g.arc(64, 64, 7, 0, TAU); g.fill(); return tex(THREE, c);
}
/** PMREM "night room": a few emissive cards so the glossy shell / visor / paint pick up believable reflections. */
export function buildEnv(THREE, renderer) {
  const s = new THREE.Scene();
  const card = (hex, k, pos, w, h) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m); };
  card(0xfff4e6, 5, [4, 5, 4], 4, 3); card(0x33e0ff, 3, [-6, 2, -1], 6, 3); card(0x5c8bff, 1.5, [0, 8, 0], 10, 10); card(0x1a2a55, 1, [0, -3, 0], 12, 12);
  const gen = new THREE.PMREMGenerator(renderer); const env = gen.fromScene(s, .04).texture; gen.dispose();
  s.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); return env;
}

/* ---------- the rig ---------- */
export function buildRig(THREE, { tier = 'high', accents = ACCENTS, seed = 7, renderer = null } = {}) {
  const hi = tier === 'high', seg = hi ? 4 : 3, segS = hi ? 2 : 1, rnd = mulberry32(seed);
  const { Vector3: V3, Matrix4: M4, Quaternion: Quat, Color, MathUtils } = THREE;
  const tmpM = new M4(), tmpM2 = new M4(), tmpQ = new Quat(), tmpV = new V3(), tmpS = new V3(), tmpC = new Color();
  const ONE = new V3(1, 1, 1), X_AXIS = new V3(1, 0, 0), WHITE = new Color(0xffffff), IDQ = new Quat();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, .5, 40); camera.position.set(0, 2.1, 8.6); camera.lookAt(0, 1.38, .1);
  scene.add(new THREE.HemisphereLight(0x7fa6ff, 0x0a1428, 1.1));
  const light = (hex, i, x, y, z) => { const l = new THREE.DirectionalLight(hex, i); l.position.set(x, y, z); scene.add(l); };
  light(0xfff4e6, 2.6, 3.5, 5, 4); light(0x33e0ff, 1.6, -4, 2.5, -3); light(0xb07cff, .5, -3, 1, 4);
  if (hi && renderer) scene.environment = buildEnv(THREE, renderer);

  const dot = softDot(THREE), atlas = eyeAtlas(THREE), dash = dashTile(THREE);
  const std = (o) => new THREE.MeshStandardMaterial(o), flat = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o });
  const M = {
    paint: std({ color: 0x3d7bff, roughness: .42, metalness: .12, envMapIntensity: .6 }),
    shell: std({ color: 0xe8eefc, roughness: .35, metalness: 0, envMapIntensity: .7 }),
    hw: std({ color: 0x6f84ad, roughness: .5, metalness: .4, envMapIntensity: .6 }),
    visor: std({ color: 0x0a1428, roughness: .12, metalness: .35, envMapIntensity: 1.1 }),
    tire: std({ color: 0x141926, roughness: .95, metalness: 0 }),
    hub: std({ color: 0x8593b5, roughness: .35, metalness: .25, emissive: 0x33e0ff, emissiveMap: hubCap(THREE), emissiveIntensity: .9 }),
    lamp: std({ color: 0xf0c34e, emissive: 0xf0c34e, emissiveIntensity: K.lampIdle, roughness: .3, metalness: 0 }),
    cyan: flat({ color: 0x33e0ff }), coral: flat({ color: 0xff6b6b }),
  };
  const points = (arr, { size, color = 0xffffff, opacity = 1, colors = null, depthTest = true }) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3).setUsage(THREE.DynamicDrawUsage));
    if (colors) g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size, map: dot, color, vertexColors: !!colors, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, depthTest, toneMapped: false }));
    p.frustumCulled = false; return p;
  };
  const mesh = (geo, mat, x = 0, y = 0, z = 0, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.matrixAutoUpdate = false; m.updateMatrix(); parent.add(m); return m; };

  // ---- ground: contact shadow, scrolling dash strip, honk ripple
  const root = new THREE.Group(); root.rotation.y = -.42; scene.add(root);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: shadowTex(THREE), transparent: true, opacity: .6, depthWrite: false }));
  shadow.position.set(0, .006, .05); shadow.renderOrder = 2; root.add(shadow);
  const roadGeo = new THREE.PlaneGeometry(3.2, 6.4, 1, 8);
  { const p = roadGeo.attributes.position, col = new Float32Array(p.count * 4); // RGBA (USE_COLOR_ALPHA): the fade drives alpha, not the colour —
    // additive blending accumulates destination alpha, so an RGB-only fade left a ~56 % black slab where the strip had faded to black
    for (let i = 0; i < p.count; i++) { const f = Math.pow(Math.sin(Math.PI * (p.getY(i) + 3.2) / 6.4), .8); col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = 1; col[i * 4 + 3] = f; }
    roadGeo.setAttribute('color', new THREE.BufferAttribute(col, 4)); roadGeo.rotateX(-Math.PI / 2); }
  const road = mesh(roadGeo, new THREE.MeshBasicMaterial({ map: dash, color: 0x33e0ff, vertexColors: true, transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 0, .004, -.6, root);
  road.renderOrder = 1;
  const ripple = new THREE.Mesh(new THREE.RingGeometry(.95, 1.0, 48).rotateX(-Math.PI / 2), flat({ color: 0x33e0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ripple.position.y = .012; ripple.visible = false; root.add(ripple);

  // ---- chassis (pivot at the ground: bob / pitch / squash / spin live here)
  const chassis = new THREE.Group(); root.add(chassis);
  const WHEEL_POS = [[-.78, .32, .78], [.78, .32, .78], [-.78, .32, -.78], [.78, .32, -.78]].map((a) => new V3(...a));
  const tires = new THREE.InstancedMesh(new THREE.CylinderGeometry(.32, .32, .24, hi ? 24 : 16).rotateZ(Math.PI / 2), M.tire, 4);
  const hubs = new THREE.InstancedMesh(new THREE.CylinderGeometry(.20, .20, .26, hi ? 20 : 14).rotateZ(Math.PI / 2), M.hub, 4);
  chassis.add(tires, hubs);
  mesh(roundedBox(THREE, 1.60, .62, 2.40, .22, seg), M.paint, 0, .72, 0, chassis);                  // body
  mesh(roundedBox(THREE, 1.36, .14, .16, .05, segS), M.hw, 0, .50, 1.17, chassis);                  // bumper
  mesh(roundedBox(THREE, .58, .05, .06, .02, segS), M.cyan, 0, .76, 1.205, chassis);                // light bar
  mesh(roundedBox(THREE, 1.10, .07, .06, .03, segS), M.coral, 0, .82, -1.21, chassis);              // tail bar
  const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(.13, hi ? 18 : 12, hi ? 12 : 8), M.lamp, 2);
  [-.50, .50].forEach((x, i) => { tmpM.makeTranslation(x, .76, 1.19); lamps.setMatrixAt(i, tmpM); }); chassis.add(lamps);
  const lampGlow = points(new Float32Array([-.5, .76, 1.36, .5, .76, 1.36]), { size: .9, color: 0xf0c34e, opacity: .5, depthTest: false }); chassis.add(lampGlow);
  mesh(new THREE.CylinderGeometry(.17, .19, .22, 16), M.hw, 0, 1.08, .10, chassis);                 // neck

  // ---- head
  const headPivot = new THREE.Group(); headPivot.position.set(0, 1.19, .10); chassis.add(headPivot);
  mesh(roundedBox(THREE, 1.15, .90, .95, .30, seg), M.shell, 0, .45, 0, headPivot);
  mesh(roundedBox(THREE, .92, .46, .10, .05, segS), M.visor, 0, .47, .455, headPivot);
  const eyeGeo = new THREE.PlaneGeometry(.42, .42);
  const eye = (x) => { const t = atlas.clone(); t.needsUpdate = true; const m = new THREE.Mesh(eyeGeo, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false })); m.position.set(x, .49, .512); m.renderOrder = 3; headPivot.add(m); return m; };
  const eyes = { L: eye(-.22), R: eye(.22) };
  const EAR_POS = [new V3(-.60, .47, 0), new V3(.60, .47, 0)];
  const ears = new THREE.InstancedMesh(new THREE.CylinderGeometry(.11, .11, .10, 16).rotateZ(Math.PI / 2), M.hub, 2); headPivot.add(ears);
  const antenna = new THREE.Group(); antenna.position.set(.30, .90, -.08); headPivot.add(antenna);
  mesh(new THREE.CapsuleGeometry(.03, .38, 3, 8), M.hw, 0, .21, 0, antenna);
  mesh(new THREE.SphereGeometry(.095, 12, 8), M.coral, 0, .44, 0, antenna);
  const tipGlow = points(new Float32Array([0, .44, 0]), { size: .7, color: 0xff6b6b, opacity: .7, depthTest: false }); antenna.add(tipGlow);

  // ---- neural halo: two tilted rings of accent nodes, additive edges rebuilt per frame, glow (high) and pulses
  const halo = new THREE.Group(); halo.position.set(0, 1.64, .10); root.add(halo);
  const RA = hi ? K.ringA : K.ringALow, RB = hi ? K.ringB : K.ringBLow, nA = RA.n, N = nA + RB.n;
  const rings = [{ ...RA, tilt: new THREE.Euler(.55, 0, .22), m: new M4(), ang: 0 }, { ...RB, tilt: new THREE.Euler(-.78, 0, -.52), m: new M4(), ang: 0 }];
  const local = [], ringOf = [], base = [], adj = [];
  rings.forEach((R, ri) => { for (let i = 0; i < R.n; i++) { const a = i / R.n * TAU + (rnd() - .5) * .24, r = R.r + (rnd() - .5) * .10; local.push(new V3(Math.cos(a) * r, (rnd() - .5) * .14, Math.sin(a) * r)); ringOf.push(ri); } });
  for (let i = 0; i < N; i++) { base.push(new Color(accents[i % accents.length])); adj.push([]); }
  const nPos = new Float32Array(N * 3), flash = new Float32Array(N);
  const nodes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(K.nodeR, hi ? 1 : 0), flat({ color: 0xffffff }), N);
  nodes.frustumCulled = false; base.forEach((c, i) => nodes.setColorAt(i, c)); halo.add(nodes);
  const EMAX = N + RB.n, ePos = new Float32Array(EMAX * 6), eCol = new Float32Array(EMAX * 6), eGeo = new THREE.BufferGeometry();
  eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3).setUsage(THREE.DynamicDrawUsage));
  eGeo.setAttribute('color', new THREE.BufferAttribute(eCol, 3).setUsage(THREE.DynamicDrawUsage));
  const edges = new THREE.LineSegments(eGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  edges.frustumCulled = false; halo.add(edges);
  let glow = null;
  if (hi) { const gc = new Float32Array(N * 3); base.forEach((c, i) => { gc[i * 3] = c.r; gc[i * 3 + 1] = c.g; gc[i * 3 + 2] = c.b; }); glow = points(nPos, { size: .8, opacity: .4, colors: gc }); halo.add(glow); }
  const pPos = new Float32Array(K.pulses * 3).fill(-50), pulsePts = points(pPos, { size: .26, color: 0xe6fcff, opacity: .95 }); halo.add(pulsePts);
  const pulses = [];
  for (let i = 0; i < K.pulses; i++) { const ri = i % 2, R = rings[ri], off = ri ? nA : 0, k = (rnd() * R.n) | 0; pulses.push({ on: i < (hi ? 5 : 3), from: off + k, to: off + (k + 1) % R.n, t: rnd(), v: K.pulseSpeed[0] + rnd() * (K.pulseSpeed[1] - K.pulseSpeed[0]), hops: Infinity }); }

  const S = {
    rest: false, hover: 0, hoverT: 0, v: K.vIdle, vT: K.vIdle, lamp: K.lampIdle, lampBoost: 0, haloBoost: 1, haloScale: 1,
    gazeX: 0, gazeY: 0, eyeX: 0, eyeY: 0, headX: 0, headY: 0, autoGaze: false, glanceT: 9, glance: 0,
    spin: 0, spinning: false, headLag: 0, roll: 0, squash: 1, ripple: -1, earWiggle: 0, talk: 0, excite: 0, wink: 0,
    blink: 0, blinkT: 2 + rnd() * 2, blinkPhase: 0, wheelAng: 0,
  };

  function update(dt, t) {
    dt = Math.min(dt, .05); const rest = S.rest;
    const dmp = (a, b, k) => rest ? b : MathUtils.damp(a, b, k, dt);
    if (rest) Object.assign(S, { hoverT: 0, gazeX: 0, gazeY: 0, blink: 0, talk: 0, excite: 0, wink: 0, squash: 1, spin: 0, roll: 0, headLag: 0, lampBoost: 0, haloScale: 1, ripple: -1, earWiggle: 0, spinning: false });
    S.talk = Math.max(0, S.talk - dt); S.excite = Math.max(0, S.excite - dt); S.wink = Math.max(0, S.wink - dt); S.earWiggle = Math.max(0, S.earWiggle - dt * 1.4);
    if (S.autoGaze && !rest) { // coarse pointers: slow Lissajous gaze + a 1.8 s glance toward the name every 9–14 s
      S.glanceT -= dt; if (S.glanceT <= 0) { S.glance = 1.8; S.glanceT = 9 + rnd() * 5; }
      if (S.glance > 0) { S.glance -= dt; S.gazeX = -.45; S.gazeY = .04; } else { S.gazeX = .30 * Math.sin(.37 * t); S.gazeY = .10 * Math.sin(.53 * t + 1); }
    }
    S.hover = dmp(S.hover, S.hoverT, 10);
    S.vT = S.spinning ? K.vSpin : K.vIdle + (K.vHover - K.vIdle) * S.hover; S.v = dmp(S.v, S.vT, 5);
    S.lamp = dmp(S.lamp, K.lampIdle + (K.lampHover - K.lampIdle) * S.hover + S.lampBoost, 14);
    S.haloBoost = dmp(S.haloBoost, 1 + (K.hoverBoost - 1) * S.hover, 5);
    S.eyeX = dmp(S.eyeX, S.gazeX, K.kEye); S.eyeY = dmp(S.eyeY, S.gazeY, K.kEye); S.headX = dmp(S.headX, S.gazeX, K.kHead); S.headY = dmp(S.headY, S.gazeY, K.kHead);
    if (!rest) { // blink every U(2.4, 5.2) s for 140 ms, 20 % double-blink
      if (S.blinkPhase > 0) { S.blinkPhase -= dt; S.blink = Math.sin(Math.PI * Math.max(0, 1 - S.blinkPhase / (K.blinkMs / 1000))); }
      else { S.blink = 0; S.blinkT -= dt; if (S.blinkT <= 0) { S.blinkPhase = K.blinkMs / 1000; S.blinkT = rnd() < K.doubleBlink ? .33 : K.blinkMin + rnd() * (K.blinkMax - K.blinkMin); } }
    }
    // chassis: bob + pitch, body yaw/roll toward the gaze, spin, squash-and-stretch about the ground pivot
    const bobN = rest ? 0 : Math.sin(t * TAU * K.bobHz), sq = S.squash, sqi = 1 / Math.sqrt(sq);
    chassis.position.y = bobN * K.bobAmp * (1 + .5 * S.hover);
    chassis.rotation.set(rest ? 0 : Math.sin(t * TAU * K.bobHz + .7) * K.pitchAmp, S.headX * (K.bodyYaw / K.yawMax) + S.spin, -S.headX * (K.bodyRoll / K.yawMax));
    chassis.scale.set(sqi, sq, sqi);
    shadow.scale.set(sqi * (1 + .05 * bobN), 1, sqi * (1 + .05 * bobN)); shadow.material.opacity = .6 - .12 * bobN;
    headPivot.rotation.set(S.headY, S.headX * (1 - K.bodyYaw / K.yawMax) + S.headLag, S.roll);
    // eyes lead the gaze inside the visor; frames: 0 open · 1 happy (talking) · 2 wink · 3 excited (honk)
    const fL = S.excite > 0 ? 3 : S.talk > 0 ? 1 : 0, fR = S.wink > 0 ? 2 : fL, wide = 1 + .12 * S.hover, open = 1 - .92 * S.blink;
    [eyes.L, eyes.R].forEach((e, i) => { const f = i ? fR : fL; e.material.map.offset.x = f * .25; e.position.set((i ? .22 : -.22) + S.eyeX * K.eyeLead, .49 - S.eyeY * .06, .512); e.scale.set(wide, wide * (f === 0 ? open : 1), 1); });
    // wheels + dash strip
    S.wheelAng = rest ? 0 : S.wheelAng + S.v / K.wheelR * dt; tmpQ.setFromAxisAngle(X_AXIS, S.wheelAng);
    for (let i = 0; i < 4; i++) { tmpM.compose(WHEEL_POS[i], tmpQ, ONE); tires.setMatrixAt(i, tmpM); hubs.setMatrixAt(i, tmpM); }
    tires.instanceMatrix.needsUpdate = hubs.instanceMatrix.needsUpdate = true;
    dash.offset.y = rest ? 0 : dash.offset.y - S.v * dt / K.dashTile;
    const ea = Math.sin(t * TAU * 9) * .28 * S.earWiggle;
    for (let i = 0; i < 2; i++) { tmpM.compose(EAR_POS[i], tmpQ.setFromAxisAngle(X_AXIS, i ? ea : -ea), ONE); ears.setMatrixAt(i, tmpM); } ears.instanceMatrix.needsUpdate = true;
    // antenna: two-sine sway, perks forward on hover; coral tip pulses. Headlights + glow follow S.lamp.
    antenna.rotation.z = (.10 * Math.sin(t * K.antennaSway[0]) + .05 * Math.sin(t * K.antennaSway[1] + 1)) * (1 + S.hover);
    antenna.rotation.x = dmp(antenna.rotation.x, .32 * S.hover, 8);
    tipGlow.material.opacity = .45 + .22 * Math.sin(t * TAU * .9) + .3 * S.hover;
    M.lamp.emissiveIntensity = S.lamp; lampGlow.material.opacity = Math.min(1, .22 + .16 * S.lamp); lampGlow.material.size = .8 + .12 * S.lamp;
    if (S.ripple >= 0) { ripple.visible = true; const e = easeOutCubic(S.ripple); ripple.scale.setScalar(1 + 1.6 * e); ripple.material.opacity = .9 * (1 - S.ripple); } else ripple.visible = false;
    // halo: precession, ring spin (hover ×1.8), node flash decay, edges (ring neighbours + nearest cross link), pulses
    const boost = S.haloBoost;
    halo.rotation.set(.12 * Math.sin(.11 * t), .05 * t, .10 * Math.sin(.07 * t + 1)); halo.scale.setScalar(S.haloScale);
    for (const R of rings) { R.ang = rest ? R.w * t : R.ang + R.w * boost * dt; R.m.makeRotationFromEuler(R.tilt).multiply(tmpM2.makeRotationY(R.ang)); }
    for (let i = 0; i < N; i++) {
      tmpV.copy(local[i]).applyMatrix4(rings[ringOf[i]].m); nPos[i * 3] = tmpV.x; nPos[i * 3 + 1] = tmpV.y; nPos[i * 3 + 2] = tmpV.z;
      flash[i] = Math.max(0, flash[i] - dt * 3.2);
      tmpM.compose(tmpV, IDQ, tmpS.setScalar(1 + .9 * flash[i] + .2 * (boost - 1))); nodes.setMatrixAt(i, tmpM);
      nodes.setColorAt(i, tmpC.copy(base[i]).lerp(WHITE, flash[i] * .7).multiplyScalar(1 + .3 * (boost - 1)));
      adj[i].length = 0;
    }
    let E = 0;
    const addEdge = (a, b) => { const o = E * 6, fa = .5 * boost + flash[a] * .8, fb = .5 * boost + flash[b] * .8, ca = base[a], cb = base[b];
      ePos[o] = nPos[a * 3]; ePos[o + 1] = nPos[a * 3 + 1]; ePos[o + 2] = nPos[a * 3 + 2]; ePos[o + 3] = nPos[b * 3]; ePos[o + 4] = nPos[b * 3 + 1]; ePos[o + 5] = nPos[b * 3 + 2];
      eCol[o] = ca.r * fa; eCol[o + 1] = ca.g * fa; eCol[o + 2] = ca.b * fa; eCol[o + 3] = cb.r * fb; eCol[o + 4] = cb.g * fb; eCol[o + 5] = cb.b * fb;
      adj[a].push(b); adj[b].push(a); E++; };
    for (let i = 0; i < nA; i++) addEdge(i, (i + 1) % nA);
    for (let i = 0; i < RB.n; i++) addEdge(nA + i, nA + (i + 1) % RB.n);
    for (let j = nA; j < N; j++) { let best = 0, bd = Infinity; for (let i = 0; i < nA; i++) { const dx = nPos[i * 3] - nPos[j * 3], dy = nPos[i * 3 + 1] - nPos[j * 3 + 1], dz = nPos[i * 3 + 2] - nPos[j * 3 + 2], d2 = dx * dx + dy * dy + dz * dz; if (d2 < bd) { bd = d2; best = i; } } addEdge(j, best); }
    eGeo.setDrawRange(0, E * 2); eGeo.attributes.position.needsUpdate = eGeo.attributes.color.needsUpdate = true;
    pulses.forEach((p, i) => {
      if (!p.on) { pPos[i * 3 + 1] = -50; return; }
      p.t += p.v * dt * (boost > 1.2 ? boost * .8 : 1);
      if (p.t >= 1) { flash[p.to] = 1; if (--p.hops <= 0) { p.on = false; return; } const nb = adj[p.to]; p.from = p.to; p.to = nb.length ? nb[(rnd() * nb.length) | 0] : p.from; p.t = 0; }
      const e = p.t * p.t * (3 - 2 * p.t), a = p.from * 3, b = p.to * 3;
      pPos[i * 3] = nPos[a] + (nPos[b] - nPos[a]) * e; pPos[i * 3 + 1] = nPos[a + 1] + (nPos[b + 1] - nPos[a + 1]) * e; pPos[i * 3 + 2] = nPos[a + 2] + (nPos[b + 2] - nPos[a + 2]) * e;
    });
    pulsePts.geometry.attributes.position.needsUpdate = true; if (glow) glow.geometry.attributes.position.needsUpdate = true;
    nodes.instanceMatrix.needsUpdate = true; nodes.instanceColor.needsUpdate = true;
  }
  /** click burst: every node flashes and four extra pulses set off for a few hops */
  function burst() { flash.fill(1); let added = 0; for (const p of pulses) { if (p.on || added >= 4) continue; const n = (rnd() * N) | 0; Object.assign(p, { on: true, hops: 4, t: 0, from: n, to: adj[n][0] ?? n }); added++; } }
  const anchorWorld = () => root.localToWorld(new V3(0, 2.68, .10));   // rest-pose point just above the antenna tip (bubble tail)
  const headWorld = () => root.localToWorld(new V3(0, 1.45, .10));     // head centre (look-at origin)
  function dispose() { scene.traverse((o) => { o.geometry?.dispose(); const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { if (!m) return; m.map?.dispose(); m.emissiveMap?.dispose(); m.dispose(); }); }); scene.environment?.dispose(); }
  return { scene, camera, root, chassis, headPivot, eyes, wheels: { tires, hubs }, lamps, antenna, halo, shadow, road, ripple, state: S, nodeCount: N, update, burst, anchorWorld, headWorld, dispose };
}
