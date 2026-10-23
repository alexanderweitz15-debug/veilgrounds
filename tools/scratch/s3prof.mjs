// S3: main-thread CPU profile of a cold start.   node tools/scratch/s3prof.mjs <url> [seconds=12] [fresh=1]
import { launch } from './s3cdp.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [url, secs = '12', fresh = '1'] = process.argv.slice(2);
const b = await launch(join(tmpdir(), 's3-prof'), { fresh: fresh === '1' });
await b.send('Profiler.enable');
await b.send('Profiler.setSamplingInterval', { interval: 500 });
await b.send('Profiler.start');
await b.send('Page.navigate', { url });
await b.sleep(Number(secs) * 1000);
const { profile } = await b.send('Profiler.stop');
await b.close();
const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)));
const byFn = new Map();
for (const [id, us] of self) {
  const n = nodes.get(id);
  const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}:${n.callFrame.columnNumber}`;
  byFn.set(k, (byFn.get(k) ?? 0) + us);
}
const top = [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 18);
for (const [k, us] of top) console.log(String(Math.round(us / 1000)).padStart(6), 'ms', k);
// timeline of busy 100 ms buckets (non-idle samples)
const idle = new Set([...nodes.values()].filter((n) => ['(idle)', '(program)'].includes(n.callFrame.functionName)).map((n) => n.id));
let t = 0;
const buckets = [];
profile.samples.forEach((id, i) => {
  t += dt[i] ?? 0;
  const bi = Math.floor(t / 250000);
  buckets[bi] = (buckets[bi] ?? 0) + (idle.has(id) ? 0 : dt[i] ?? 0);
});
console.log('busy ms per 250 ms:', buckets.map((v) => Math.round((v ?? 0) / 1000)).join(' '));
process.exit(0);
