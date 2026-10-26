// Pre-bakes the sprite strips of a finished build:   node tools/bakeSprites.mjs [distDir=dist]
// Serves distDir, opens dist/bake.html (src/render/bakeEntry.ts) in a headless Chrome / Edge, receives every baked
// strip as PNG and writes dist/atlas/<ver>/<file>.png + manifest.json (read at runtime by src/render/staticAtlas.ts).
// Run automatically by `vite build` in CI or with BAKE_SPRITES=1 (vite.config.ts). Exit code 0 = baked, 1 = failed,
// 2 = no browser found. Set CHROME_PATH to pick a browser.
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');
const TIMEOUT_MS = 20 * 60 * 1000;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

function findBrowser() {
  const c = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return c.find((p) => existsSync(p));
}

if (!existsSync(join(dist, 'bake.html'))) {
  console.error(`bakeSprites: ${join(dist, 'bake.html')} missing (run vite build first)`);
  process.exit(1);
}
const exe = findBrowser();
if (!exe) {
  console.warn('bakeSprites: no Chrome / Edge found - skipped (the game bakes its sprites at runtime). Set CHROME_PATH to bake.');
  process.exit(2);
}

let atlasDir = '';
let ver = '';
const strips = {};
let bytes = 0;
let finish;
const finished = new Promise((res) => (finish = res));

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method === 'POST' && url.pathname.startsWith('/__bake/')) {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const what = url.pathname.slice(8);
      const q = url.searchParams;
      try {
        if (what === 'start') {
          ver = q.get('ver') ?? '';
          if (!ver) throw new Error('bundle has no __ATLAS_VER__');
          atlasDir = join(dist, 'atlas', ver);
          rmSync(atlasDir, { recursive: true, force: true });
          mkdirSync(atlasDir, { recursive: true });
        } else if (what === 'strip') {
          const key = q.get('key');
          const body = Buffer.concat(chunks);
          const entryVer = q.get('ver'); // entries with their own version (ground) carry it in the file name: no stale HTTP cache
          const file = `${key.replace(/[^a-zA-Z0-9._-]/g, '_')}${entryVer ? `-${entryVer}` : ''}.${q.get('ext') ?? 'png'}`;
          writeFileSync(join(atlasDir, file), body);
          strips[key] = { file, top: Number(q.get('top')), ...(entryVer ? { ver: entryVer } : {}) };
          bytes += body.length;
        } else if (what === 'log') console.log(`  bake ${q.get('msg')}`);
        else if (what === 'error') finish({ ok: false, msg: q.get('msg') });
        else if (what === 'done') finish({ ok: true });
        res.writeHead(204).end();
      } catch (e) {
        res.writeHead(500).end(String(e));
        finish({ ok: false, msg: String(e) });
      }
    });
    return;
  }
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const file = join(dist, rel === '' ? 'bake.html' : rel);
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const profile = mkdtempSync(join(tmpdir(), 'veilgrounds-bake-'));
const flags = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--user-data-dir=${profile}`];
if (process.platform === 'linux') flags.push('--no-sandbox'); // CI containers / userns restrictions; the page is our own bundle
const t0 = Date.now();
console.log(`bakeSprites: ${exe}\n  serving ${dist} on :${port}`);
const proc = spawn(exe, [...flags, `http://127.0.0.1:${port}/bake.html`], { stdio: 'ignore' });
// Windows msedge.exe is a launcher stub: it starts the real browser detached and exits at once (code 0), so an early exit
// only counts as failure elsewhere; everywhere the page must report 'start' within 60 s.
if (process.platform !== 'win32') proc.on('exit', (code) => finish({ ok: false, msg: `browser exited early (${code})` }));
const timer = setTimeout(() => finish({ ok: false, msg: 'timeout' }), TIMEOUT_MS);
const startTimer = setTimeout(() => !ver && finish({ ok: false, msg: 'the page did not start within 60 s' }), 60000);

const r = await finished;
clearTimeout(timer);
clearTimeout(startTimer);
proc.removeAllListeners('exit');
try {
  // win32: the launcher pid is gone, so kill every browser process that uses the temp profile
  if (process.platform === 'win32') execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*veilgrounds-bake-*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' });
  else proc.kill('SIGKILL');
} catch {
  /* already gone */
}
server.close();
await new Promise((res) => setTimeout(res, 1500));
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  /* temp dir, the OS cleans it */
}
rmSync(join(dist, 'bake.html'), { force: true }); // tool page, not shipped

if (!r.ok) {
  if (atlasDir) rmSync(atlasDir, { recursive: true, force: true }); // no half manifest: the game bakes at runtime
  console.error(`bakeSprites: FAILED - ${r.msg}`);
  process.exit(1);
}
writeFileSync(join(atlasDir, 'manifest.json'), JSON.stringify({ ver, strips }));
console.log(`bakeSprites: ${Object.keys(strips).length} strips, ${(bytes / 1048576).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${atlasDir}`);
