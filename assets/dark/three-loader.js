/* three-loader.js — one three.js (0.160.1) instance per page, shared by every module that needs it.
   loadThree(): cached promise; dynamic import from cdnjs first, then jsDelivr, each raced against an 8 s timeout. No import
   map, no add-ons, so a failed or stalled CDN simply falls through to the next one and gated clients never download the 170 KB build.
   hasWebGL(): context probe that releases its context again. reducedMotion(): media-query shortcut. */
const VERSION = '0.160.1';
const SOURCES = [
  `https://cdnjs.cloudflare.com/ajax/libs/three.js/${VERSION}/three.module.min.js`,
  `https://cdn.jsdelivr.net/npm/three@${VERSION}/build/three.module.min.js`,
];
const TIMEOUT_MS = 8000; // per source: a stalled connection must not leave the stage in 'loading' forever
let pending = null;

/** Settles like `p`, or rejects after `ms` (the underlying import keeps going but its result is ignored). */
export function withTimeout(p, ms, what = '') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`three: timeout after ${ms} ms ${what}`.trim())), ms);
    Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function loadThree() {
  if (!pending) {
    pending = SOURCES
      .reduce((chain, url) => chain.catch(() => withTimeout(import(/* webpackIgnore: true */ url), TIMEOUT_MS, url)), Promise.reject(new Error('three: no source')))
      .catch((err) => { pending = null; throw err; }); // allow a retry after a transient failure
  }
  return pending;
}

export function hasWebGL({ failIfMajorPerformanceCaveat = true } = {}) {
  try {
    const canvas = document.createElement('canvas');
    const attrs = { failIfMajorPerformanceCaveat, powerPreference: 'low-power' };
    const gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs);
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const THREE_VERSION = VERSION;
