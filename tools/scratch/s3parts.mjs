// S3: time the parts of a static-strip atlas assembly (fetch / blob / decode / blit) in a bare page.
//   node tools/scratch/s3parts.mjs <baseUrl> <atlasDir e.g. /atlas/0a50..> <id1,id2,...>
import { launch } from './s3cdp.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [base, dir, ids] = process.argv.slice(2);
const b = await launch(join(tmpdir(), 's3-parts'));
await b.send('Page.navigate', { url: base + '/sw.js' });
await b.sleep(3000);
const out = await b.evaluate(`(async () => {
  const ids = ${JSON.stringify(ids)}.split(',');
  const T = {};
  const t = (n, t0) => (T[n] = (T[n] || 0) + Math.round(performance.now() - t0));
  const t00 = performance.now();
  const atlas = document.createElement('canvas'); atlas.width = 8192; atlas.height = 4096;
  const actx = atlas.getContext('2d', { willReadFrequently: true });
  t('canvasAlloc', t00);
  const strips = await Promise.all(ids.map(async (id) => {
    let t0 = performance.now();
    const r = await fetch(location.origin + ${JSON.stringify(dir)} + '/' + id + '@240-152.png'.replace('@', '_'));
    const blob = await r.blob(); t('fetch+blob', t0);
    t0 = performance.now();
    const bmp = await createImageBitmap(blob); t('decode', t0);
    return bmp;
  }));
  T.parallelFetchDecode = Math.round(performance.now() - t00);
  const t1 = performance.now();
  let n = 0;
  for (const bmp of strips) for (let k = 0; k < 125; k++) { const sx = (k % 16) * 152, sy = Math.floor(k / 16) * 152; actx.drawImage(bmp, sx + 1, sy + 1, 150, 150, (n % 53) * 152 + 1, Math.floor(n / 53) * 152 + 1, 150, 150); n++; }
  T.blit = Math.round(performance.now() - t1);
  return JSON.stringify(T);
})()`);
console.log(out);
await b.close();
process.exit(0);
