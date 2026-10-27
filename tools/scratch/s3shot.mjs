// S3: screenshot of the game after the loading cover is gone.   node tools/scratch/s3shot.mjs <url> <out.png> [maxS=120]
import { launch } from './s3cdp.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
const [url, out, maxS = '120'] = process.argv.slice(2);
const b = await launch(join(tmpdir(), `s3-shot-${Date.now()}`));
await b.send('Page.navigate', { url });
const t0 = Date.now();
while (Date.now() - t0 < Number(maxS) * 1000) {
  await b.sleep(500);
  const done = await b.evaluate("(() => { const c = document.querySelector('.boot-cover'); return !!document.querySelector('.game') && (!c || c.classList.contains('done')); })()").catch(() => false);
  if (done) break;
}
await b.sleep(1500);
const { data } = await b.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(data, 'base64'));
console.log('shot after', Date.now() - t0, 'ms ->', out);
await b.close();
process.exit(0);
