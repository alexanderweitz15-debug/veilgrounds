// S3 scratch helper: launch a headless Chromium (Edge/Chrome) and talk CDP over Node's global WebSocket. No dependencies.
// Used by s3measure.mjs (load-time runs) and s3shots.mjs (telegraph screenshots).
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export function findBrowser() {
  const c = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return c.find((p) => existsSync(p));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(profile, { width = 1280, height = 720, extra = [], fresh = true } = {}) {
  if (fresh) {
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  }
  mkdirSync(profile, { recursive: true });
  const exe = findBrowser();
  if (!exe) throw new Error('no Chrome/Edge found (set CHROME_PATH)');
  let proc;
  let port = 0;
  for (let attempt = 0; attempt < 3 && !port; attempt++) {
    for (const f of ['DevToolsActivePort', 'lockfile', 'SingletonLock']) {
      try {
        rmSync(join(profile, f));
      } catch {}
    }
    proc = spawn(
      exe,
      ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${width},${height}`, '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', ...extra, 'about:blank'],
      { stdio: 'ignore' },
    );
    for (let i = 0; i < 100 && !port; i++) {
      await sleep(100);
      try {
        port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
      } catch {}
    }
    if (!port) {
      try {
        execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
      } catch {}
      await sleep(2000);
    }
  }
  if (!port) throw new Error('browser did not start');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    } else if (m.method) for (const h of handlers.get(m.method) ?? []) h(m.params);
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const on = (method, fn) => handlers.set(method, [...(handlers.get(method) ?? []), fn]);
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const close = async () => {
    try {
      await Promise.race([send('Browser.close'), sleep(1500)]);
    } catch {}
    try {
      ws.close();
    } catch {}
    await sleep(300);
    try {
      if (process.platform === 'win32') execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
      else proc.kill();
    } catch {}
    await sleep(3000);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  return { send, on, evaluate, close, sleep };
}
