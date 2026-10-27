// S3: visual diff of PNG vs WebP strips.   node tools/scratch/s3webpdiff.mjs <distPng> <distWebp> [outDir]
// Both dists come from `BAKE_SPRITES=1 BAKE_FORMAT=png|webp vite build`. For every strip: composite PNG and WebP over a
// mid-grey background, report PSNR, mean / max channel difference and the share of pixels differing by > 8 levels;
// and write a side-by-side + 8x amplified difference image of the worst strip to outDir.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { launch } from './s3cdp.mjs';

const [a, b, out = tmpdir()] = process.argv.slice(2).map((p) => resolve(p));
const roots = { a, b };
const MIME = { '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.html': 'text/html' };
const server = createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/') return void res.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>');
  const m = /^\/([ab])\/(.*)$/.exec(u.pathname);
  const f = m && join(roots[m[1]], decodeURIComponent(m[2]));
  if (!f || !f.startsWith(roots[m[1]]) || !existsSync(f) || !statSync(f).isFile()) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
  createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const va = readdirSync(join(a, 'atlas'))[0];
const vb = readdirSync(join(b, 'atlas'))[0];

const bro = await launch(join(tmpdir(), `s3-diff-profile-${Date.now()}`));
await bro.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
await bro.sleep(500);
const result = await bro.evaluate(`(async () => {
  const base = (r, v) => '/' + r + '/atlas/' + v + '/';
  const ma = await (await fetch(base('a', '${va}') + 'manifest.json')).json();
  const mb = await (await fetch(base('b', '${vb}') + 'manifest.json')).json();
  const rows = [];
  let worst = null;
  const draw = (bmp) => {
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#808080';
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(bmp, 0, 0);
    return { c, d: x.getImageData(0, 0, c.width, c.height) };
  };
  let bytesA = 0, bytesB = 0;
  for (const key of Object.keys(mb.strips)) {
    const ea = ma.strips[key], eb = mb.strips[key];
    if (!ea || key.startsWith('ground')) continue;
    const [ba, bb] = await Promise.all([fetch(base('a', '${va}') + ea.file).then((r) => r.blob()), fetch(base('b', '${vb}') + eb.file).then((r) => r.blob())]);
    bytesA += ba.size; bytesB += bb.size;
    const [ia, ib] = await Promise.all([createImageBitmap(ba), createImageBitmap(bb)]);
    if (ia.width !== ib.width || ia.height !== ib.height) { rows.push({ key, err: 'size' }); continue; }
    const A = draw(ia), B = draw(ib);
    let se = 0, sum = 0, max = 0, over = 0, n = 0, op = 0;
    for (let i = 0; i < A.d.data.length; i += 4) {
      let hit = false;
      for (let k = 0; k < 3; k++) { const d = Math.abs(A.d.data[i + k] - B.d.data[i + k]); se += d * d; sum += d; if (d > max) max = d; if (d > 8) hit = true; }
      if (hit) over++;
      n += 3;
      op++;
    }
    const mse = se / n;
    const psnr = mse === 0 ? 99 : 10 * Math.log10(255 * 255 / mse);
    const row = { key, kbA: Math.round(ba.size / 1024), kbB: Math.round(bb.size / 1024), psnr: +psnr.toFixed(1), mean: +(sum / n).toFixed(3), max, over8: +(100 * over / op).toFixed(3) };
    rows.push(row);
    if (!worst || psnr < worst.psnr) worst = { ...row, A, B, w: ia.width, h: ia.height };
  }
  let img = null;
  if (worst) {
    // crop the top-left 760 px of the worst strip: PNG | WebP | |diff| x8
    const w = Math.min(760, worst.w), h = Math.min(400, worst.h);
    const c = new OffscreenCanvas(w * 3, h);
    const x = c.getContext('2d');
    const diff = new ImageData(w, h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const s = (yy * worst.w + xx) * 4, t = (yy * w + xx) * 4;
      for (let k = 0; k < 3; k++) diff.data[t + k] = Math.min(255, 8 * Math.abs(worst.A.d.data[s + k] - worst.B.d.data[s + k]));
      diff.data[t + 3] = 255;
    }
    x.putImageData(worst.A.d, 0, 0, 0, 0, w, h);
    x.putImageData(worst.B.d, w, 0, 0, 0, w, h);
    x.putImageData(diff, 2 * w, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    img = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
  }
  return JSON.stringify({ rows, bytesA, bytesB, worstKey: worst?.key, img });
})()`);
await bro.close();
server.close();
const r = JSON.parse(result);
mkdirSync(out, { recursive: true });
if (r.img) writeFileSync(join(out, 'webp-worst.png'), Buffer.from(r.img, 'base64'));
const rows = r.rows.sort((x, y) => x.psnr - y.psnr);
console.log('worst 6 strips (PSNR over grey, dB; over8 = % pixels with a channel off by > 8):');
for (const x of rows.slice(0, 6)) console.log(' ', JSON.stringify(x));
const avg = (k) => (rows.reduce((s, x) => s + x[k], 0) / rows.length).toFixed(2);
console.log(`strips ${rows.length}: mean PSNR ${avg('psnr')} dB, mean diff ${avg('mean')}, worst max ${Math.max(...rows.map((x) => x.max))}, png ${(r.bytesA / 1048576).toFixed(1)} MB, webp ${(r.bytesB / 1048576).toFixed(1)} MB`);
console.log('worst strip image:', join(out, 'webp-worst.png'), r.worstKey);
process.exit(0);
