// Minimal Chrome DevTools Protocol driver (Node ≥ 22, built-in WebSocket). Usage:
//   node cdp.mjs <url> <width>x<height> [--reduce] [--nojs] [--eval "<js expr>"] [--shot out.png] [--wait ms]
// Prints console messages + the eval result as JSON. Used by measure.mjs and ad-hoc checks.
import { spawn } from 'node:child_process'; import { writeFileSync, mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const args = process.argv.slice(2); const url = args[0]; const [W, H] = (args[1] || '1400x900').split('x').map(Number);
const flag = (n) => args.includes(n); const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const port = 9222 + Math.floor(Math.random() * 500); const prof = mkdtempSync(join(tmpdir(), 'cdp-'));
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let wsUrl = null; for (let i = 0; i < 50 && !wsUrl; i++) { await sleep(200); try { const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); wsUrl = list.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up yet */ } }
if (!wsUrl) { chrome.kill(); console.error('chrome did not start'); process.exit(2); }
const ws = new WebSocket(wsUrl); await new Promise(r => ws.onopen = r); let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 800 });
if (flag('--reduce')) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
if (flag('--nojs')) await send('Emulation.setScriptExecutionDisabled', { value: true });
await send('Page.navigate', { url }); await sleep(Number(val('--wait') || 2500));
if (flag('--scroll')) { // walk the page so IntersectionObservers (reveal, lazy widgets) fire, then return to the top
  const h = (await send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true })).result.result.value;
  for (let y = 0; y < h; y += Math.round(H * 0.7)) { await send('Runtime.evaluate', { expression: `window.scrollTo({top:${y},behavior:"instant"})` }); await sleep(250); }
  await send('Runtime.evaluate', { expression: 'window.scrollTo({top:0,behavior:"instant"})' }); await sleep(1500); }
const consoleMsgs = events.filter(e => e.method === 'Runtime.consoleAPICalled').map(e => ({ type: e.params.type, text: e.params.args.map(a => a.value ?? a.description ?? '').join(' ') }));
const errors = events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
const logs = events.filter(e => e.method === 'Log.entryAdded').map(e => `${e.params.entry.level}: ${e.params.entry.text}`);
const resp = events.filter(e => e.method === 'Network.responseReceived').map(e => ({ url: e.params.response.url, status: e.params.response.status, type: e.params.type }));
const fin = events.filter(e => e.method === 'Network.loadingFinished'); const bytesByReq = Object.fromEntries(fin.map(e => [e.params.requestId, e.params.encodedDataLength]));
const reqs = events.filter(e => e.method === 'Network.responseReceived').map(e => ({ url: e.params.response.url, status: e.params.response.status, type: e.params.type, bytes: bytesByReq[e.params.requestId] ?? 0 }));
let evalResult = null; if (val('--eval')) { const r = await send('Runtime.evaluate', { expression: val('--eval'), returnByValue: true, awaitPromise: true }); evalResult = r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? null; }
if (val('--shot')) { await send('Runtime.evaluate', { expression: 'document.getAnimations().forEach(a => { try { a.finish(); } catch (e) {} })' }); await sleep(100); const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !flag('--viewport-only') }); writeFileSync(val('--shot'), Buffer.from(s.result.data, 'base64')); }
console.log(JSON.stringify({ url, viewport: [W, H], console: consoleMsgs, exceptions: errors, logs: logs.filter(l => !/Autoplay|preload/.test(l)), requests: reqs, eval: evalResult }, null, 1));
ws.close(); chrome.kill(); process.exit(0);
