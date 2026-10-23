// Scratch (agent S2): headless Edge screenshot via CDP. node tools/scratch/s2shot.mjs <url> <out.jpg> [waitMs] [evalJs] [width] [height]
// Runs evalJs (async) after the wait, waits again, captures a 1280x720 JPEG, closes Edge (no tab is left behind).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, waitMs = '4000', evalJs = '', w = '1280', h = '720'] = process.argv.slice(2);
const port = 9300 + Math.floor(Math.random() * 500);
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const prof = mkdtempSync(join(tmpdir(), 's2edge-'));
const proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', `--window-size=${w},${h}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let targets;
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) pending.get(d.id)(d);
    else if (d.method === 'Runtime.consoleAPICalled') console.log('[console]', d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
    else if (d.method === 'Runtime.exceptionThrown') console.log('[exception]', d.params.exceptionDetails.exception?.description?.slice(0, 400));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(+waitMs);
  if (evalJs) {
    const r = await send('Runtime.evaluate', { expression: evalJs, awaitPromise: true, returnByValue: true });
    console.log('[eval]', JSON.stringify(r.result?.result?.value ?? r.result).slice(0, 500));
    await sleep(+waitMs);
  }
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out);
  ws.close();
} finally {
  proc.kill();
}
process.exit(0);
