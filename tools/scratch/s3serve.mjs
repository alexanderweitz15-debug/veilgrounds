// S3 scratch: tiny static server for a dist folder.   node tools/scratch/s3serve.mjs <dir> <port>
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
const dir = resolve(process.argv[2]);
const port = Number(process.argv[3] ?? 4180);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  let f = join(dir, normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, ''));
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!f.startsWith(dir) || !existsSync(f)) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'cache-control': 'public, max-age=3600' });
  createReadStream(f).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`serving ${dir} on ${port}`));
