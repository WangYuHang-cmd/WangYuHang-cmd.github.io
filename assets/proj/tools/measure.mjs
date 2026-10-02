// measure.mjs <url> [--out budget.json]
// First-view and total transfer bytes at 1400×900 and 390×844 via CDP (Node ≥ 22, built-in WebSocket; no npm).
// First view = everything fetched before any scroll within 4 s; total = after scrolling to the bottom in steps.
// Fails (exit 1) when first view > 3 MB; warns > 2.5 MB. Also records console exceptions.
import { spawn } from 'node:child_process'; import { writeFileSync, mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const args = process.argv.slice(2); const url = args[0]; const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const FAIL = 3_000_000, WARN = 2_500_000; const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function run(W, H) {
  const port = 9300 + Math.floor(Math.random() * 500), prof = mkdtempSync(join(tmpdir(), 'measure-'));
  const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null; for (let i = 0; i < 50 && !wsUrl; i++) { await sleep(200); try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch { } }
  if (!wsUrl) { chrome.kill(); throw new Error('chrome did not start'); }
  const ws = new WebSocket(wsUrl); await new Promise(r => ws.onopen = r); let id = 0; const pending = new Map(); const reqs = new Map(); const exceptions = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === 'Network.responseReceived') reqs.set(d.params.requestId, { url: d.params.response.url, type: d.params.type, status: d.params.response.status, bytes: 0, phase: phase });
    if (d.method === 'Network.loadingFinished' && reqs.has(d.params.requestId)) reqs.get(d.params.requestId).bytes = d.params.encodedDataLength;
    if (d.method === 'Runtime.exceptionThrown') exceptions.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  let phase = 'first'; await send('Network.enable'); await send('Runtime.enable'); await send('Page.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 800 });
  await send('Page.navigate', { url }); await sleep(4000); phase = 'scroll';
  const height = (await send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true })).result.result.value;
  for (let y = 0; y < height; y += Math.round(H * 0.8)) { await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${y})` }); await sleep(350); }
  await sleep(2500);
  const list = [...reqs.values()].filter(r => r.status < 400 || r.status === 0);
  const sum = (f) => list.filter(f).reduce((a, r) => a + (r.bytes || 0), 0);
  const byType = {}; for (const r of list) { const k = r.type; byType[k] = (byType[k] || 0) + (r.bytes || 0); }
  const res = { viewport: [W, H], first_view_bytes: sum(r => r.phase === 'first'), total_bytes: sum(() => true), by_type: byType, requests: list.length,
    largest: list.sort((a, b) => b.bytes - a.bytes).slice(0, 8).map(r => ({ url: r.url.replace(/^https?:\/\/[^/]+/, ''), bytes: r.bytes, type: r.type, phase: r.phase })), exceptions };
  ws.close(); chrome.kill(); return res;
}
const out = { url, measured: null, results: [] };
for (const [W, H] of [[1400, 900], [390, 844]]) out.results.push(await run(W, H));
let bad = false;
for (const r of out.results) { const mb = (r.first_view_bytes / 1e6).toFixed(2); const flag = r.first_view_bytes > FAIL ? 'FAIL' : r.first_view_bytes > WARN ? 'WARN' : 'ok'; if (flag === 'FAIL' || r.exceptions.length) bad = true;
  console.log(`${r.viewport.join('x')}: first view ${mb} MB [${flag}] · total ${(r.total_bytes / 1e6).toFixed(2)} MB · ${r.requests} requests · exceptions ${r.exceptions.length}`);
  for (const l of r.largest) console.log(`   ${(l.bytes / 1024).toFixed(0).padStart(6)} KB  ${l.type.padEnd(10)} ${l.phase.padEnd(6)} ${l.url}`);
  for (const e of r.exceptions) console.log('   EXC', e.split('\n')[0]); }
if (outPath) writeFileSync(outPath, JSON.stringify(out, null, 1));
process.exit(bad ? 1 : 0);
