// Scratch (agent D): receives canvas captures from the built game and saves them as files under docs/ist/.
// Run: node tools/scratch/shotServer.mjs  (port 4399). In the page (?bench exposes window.__vg):
//   __vg.frame(performance.now()); const url = __vg.world.canvas.toDataURL('image/jpeg', 0.9);
//   await fetch('http://localhost:4399/d1-name-after.jpg', { method: 'POST', body: url });
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const OUT = join(process.cwd(), 'docs', 'ist');
createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.end('ok');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const name = basename(decodeURIComponent(req.url ?? '/shot.jpg'));
    if (!/^[\w.-]+\.(jpg|png)$/.test(name)) return res.end('bad name');
    const data = Buffer.concat(chunks).toString().replace(/^data:image\/\w+;base64,/, '');
    writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
    console.log('saved', name);
    res.end('saved');
  });
}).listen(4399, () => console.log('shot server on 4399 ->', OUT));
