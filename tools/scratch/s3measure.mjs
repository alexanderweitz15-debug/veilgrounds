// S3: load-time measurement of the built game in headless Chromium.
//   node tools/scratch/s3measure.mjs <baseUrl> cold|warm [runs=3] [label] [warmWaitS=0]
// cold: fresh profile per run (empty IndexedDB / HTTP cache / SW). warm: one profile, first a menu visit (waits for the
// menu precache line "sprite precache:" up to warmWaitS), then the browser is restarted on the same profile per run.
// Metric: ms from navigation start until the champion atlas is applied (".sprite-loading" removed) on /?play=classic.
import { launch } from './s3cdp.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [base, mode = 'cold', runs = '3', label = 'run', warmWait = '0'] = process.argv.slice(2);
const profile = join(tmpdir(), `s3-profile-${label}-${mode}`);

const INIT = `
(() => {
  const m = (window.__m = { t: {}, long: 0 });
  const mark = (n) => { if (!(n in m.t)) m.t[n] = Math.round(performance.now()); };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) m.long = Math.max(m.long, Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch {}
  const check = () => {
    const c = document.querySelector('.boot-cover');
    if (c) { mark('cover'); if (!c.querySelector('.sprite-loading')) mark('loadingGone'); if (c.classList.contains('done')) mark('coverDone'); }
    else if (m.t.cover) mark('coverRemoved');
  };
  const obs = new MutationObserver(check);
  const start = () => obs.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  document.documentElement ? start() : document.addEventListener('DOMContentLoaded', start);
  document.addEventListener('DOMContentLoaded', check);
  setInterval(check, 50);
})();`;

async function visit(url, { waitFor, maxMs, fresh }) {
  const b = await launch(profile, { fresh });
  const logs = [];
  b.on('Runtime.consoleAPICalled', (p) => {
    const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
    logs.push(text);
  });
  b.on('Runtime.exceptionThrown', (p) => logs.push('EXC ' + (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text)));
  if (process.env.NET_MBIT) {
    // e.g. NET_MBIT=50: 50 Mbit/s down, 20 ms latency (the local preview server is otherwise "infinitely" fast)
    await b.send('Network.enable');
    await b.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: (Number(process.env.NET_MBIT) * 1e6) / 8, uploadThroughput: 1e7 });
  }
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT });
  await b.send('Page.navigate', { url });
  const t0 = Date.now();
  let m = null;
  while (Date.now() - t0 < maxMs) {
    await b.sleep(250);
    m = await b.evaluate('JSON.stringify(window.__m || null)').then((s) => JSON.parse(s)).catch(() => null);
    if (waitFor(m, logs)) break;
  }
  await b.close();
  return { m, logs, wall: Date.now() - t0 };
}

const results = [];
if (mode === 'warm' && warmWait === 'game') {
  // warm-up = one game start in the profile (strips land in IndexedDB), then settle
  const v = await visit(base + '/?play=classic', { fresh: true, maxMs: 120000, waitFor: (m) => !!m?.t?.coverDone });
  console.log('warm-up game visit:', v.m?.t?.loadingGone, 'ms');
  await new Promise((r) => setTimeout(r, 2000));
} else if (mode === 'warm' && warmWait !== '-1') {
  const v = await visit(base + '/', { fresh: true, maxMs: Number(warmWait) * 1000 || 20000, waitFor: (m, logs) => logs.some((l) => l.startsWith('sprite precache:')) });
  console.log('warm-up visit:', v.logs.filter((l) => /atlas|precache|baked/.test(l)).join(' | '), `(${v.wall} ms)`);
}
for (let i = 0; i < Number(runs); i++) {
  const r = await visit(base + '/?play=classic', { fresh: mode === 'cold', maxMs: 180000, waitFor: (m) => !!m?.t?.coverDone });
  const t = r.m?.t ?? {};
  results.push(t.loadingGone ?? -1);
  console.log(`${label} ${mode} run ${i + 1}: champions ready ${t.loadingGone ?? 'TIMEOUT'} ms, cover done ${t.coverDone ?? '-'} ms, longest task ${r.m?.long ?? '-'} ms`);
  console.log('   ', r.logs.filter((l) => /atlas|precache|ground|bake|EXC/.test(l)).join(' | '));
}
console.log(`${label} ${mode}: [${results.join(', ')}] ms`);
process.exit(0);
