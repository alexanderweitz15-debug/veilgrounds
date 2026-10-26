// Scratch dev-server config for the sprite labs: the normal config plus POST /__save?name=<path> which writes
// the request body to docs/style/<path> (contact sheets from tools/scratch/*.html).
//   npx vite --config tools/scratch/vite.lab.config.mjs --port 5190 --strictPort
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/** @type {import('vite').Plugin} */
const save = {
  name: 'lab-save',
  configureServer(server) {
    server.middlewares.use('/__save', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? '';
      if (req.method !== 'POST' || !/^[\w\-/]+\.(jpg|png)$/.test(name) || name.includes('..')) {
        res.statusCode = 400;
        res.end('bad name');
        return;
      }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const file = resolve(root, 'docs/style', name);
        mkdirSync(dirname(file), { recursive: true });
        // raw bytes, or a data: URL sent as text/plain (no-cors POST from another origin, e.g. the preview build)
        const body = Buffer.concat(chunks);
        const head = body.subarray(0, 5).toString();
        writeFileSync(file, head === 'data:' ? Buffer.from(body.toString().split(',')[1] ?? '', 'base64') : body);
        res.end(`saved ${file} (${Buffer.concat(chunks).length} bytes)`);
      });
    });
  },
};

export default mergeConfig(base, defineConfig({ root, plugins: [save] }));
