// S3: compare strip encodings (PNG vs lossless/lossy WebP) on one baked strip.   node tools/scratch/s3enc.mjs <baseUrl> <stripPath>
import { launch } from './s3cdp.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [base, strip] = process.argv.slice(2);
const b = await launch(join(tmpdir(), 's3-enc'));
await b.send('Page.navigate', { url: base + '/sw.js' });
await b.sleep(3000); console.log(await b.evaluate("location.href"));
const out = await b.evaluate(`(async () => {
  const rr = await fetch(location.origin + ${JSON.stringify(strip)}).catch((e) => ({ fail: String(e) })); if (rr.fail) return rr.fail; const blob = await rr.blob();
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
  const res = { png: blob.size, w: bmp.width, h: bmp.height };
  { const wb1 = await new Promise((r) => c.toBlob(r, 'image/webp', 1)); const b2 = await createImageBitmap(wb1); const c2 = document.createElement('canvas'); c2.width = c.width; c2.height = c.height; const x2 = c2.getContext('2d'); x2.drawImage(b2, 0, 0); const A = x.getImageData(0, 0, c.width, c.height).data, B = x2.getImageData(0, 0, c.width, c.height).data; let diff = 0, maxd = 0; for (let i = 0; i < A.length; i += 4) { if (A[i+3] !== B[i+3]) { diff++; continue; } if (A[i+3] === 0) continue; const d = Math.max(Math.abs(A[i]-B[i]), Math.abs(A[i+1]-B[i+1]), Math.abs(A[i+2]-B[i+2])); if (d) diff++; if (d > maxd) maxd = d; } res.mismatch = diff; res.maxd = maxd; }
  for (const q of [1]) {
    const t0 = performance.now();
    const wb = await new Promise((r) => c.toBlob(r, 'image/webp', q));
    res['webp' + q] = wb.size; res['enc' + q] = Math.round(performance.now() - t0);
    const t1 = performance.now(); await createImageBitmap(wb); res['dec' + q] = Math.round(performance.now() - t1);
  }
  const t2 = performance.now(); await createImageBitmap(blob); res.decPng = Math.round(performance.now() - t2);
  return JSON.stringify(res);
})()`);
console.log(out);
await b.close();
process.exit(0);
