import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

/** Short hash of file contents (line endings normalised: same value on Windows and CI). */
function hashFiles(files: string[]): string {
  const h = createHash('sha1');
  for (const f of files) h.update(f).update(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex').slice(0, 12);
}

/** Everything that changes what a baked sprite looks like. */
const SPRITE_FILES = ['src/render/atlasStrip.ts', 'src/render/spriteWorker.ts', ...readdirSync('src/render/champions').sort().map((f) => `src/render/champions/${f}`)];
// ponytail: keep in sync with the imports of paintGround (src/render/terrain.ts); a missed file only means a stale ground until the next terrain.ts edit
const GROUND_FILES = ['terrain', 'coords', 'organic', 'palette', 'materials'].map((f) => `src/render/${f}.ts`).concat('src/sim/map.ts', 'src/sim/vec.ts', 'src/data/map.json');

/**
 * S3 load time: after the bundle is written, bake all sprite strips and the painted ground with a headless browser
 * (tools/bakeSprites.mjs) into dist/atlas/<ver>/. Default in CI, opt-in locally with BAKE_SPRITES=1 (see docs/agents/s3.md). Never fails the build: without
 * the strips the game bakes at runtime.
 */
function bakeSprites(): Plugin {
  let outDir = 'dist';
  return {
    name: 'veilgrounds-bake-sprites',
    apply: 'build',
    enforce: 'post',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        // CI (GitHub Pages deploy) bakes by default, local builds opt in with BAKE_SPRITES=1, BAKE_SPRITES=0 turns it off.
        // Strips are lossy WebP (~20 MB, 3x smaller than PNG): cold start beats the runtime bake also at 50 Mbit (docs/agents/s3.md)
        const want = process.env.BAKE_SPRITES === '1' || (process.env.BAKE_SPRITES !== '0' && !!process.env.CI);
        if (want && existsSync(join(outDir, 'bake.html'))) {
          const r = spawnSync(process.execPath, [resolve('tools/bakeSprites.mjs'), outDir], { stdio: 'inherit' });
          if (r.status !== 0) console.warn(`bakeSprites exited with ${r.status}: the build ships without pre-baked sprites`);
        }
        rmSync(join(outDir, 'bake.html'), { force: true });
      },
    },
  };
}

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  define: { __ATLAS_VER__: JSON.stringify(hashFiles(SPRITE_FILES)), __GROUND_VER__: JSON.stringify(hashFiles(GROUND_FILES)) },
  plugins: [bakeSprites()],
  // three.js as its own long-cached vendor chunk (~530 kB min, shared by the menu backdrop and the game view)
  build: { rollupOptions: { input: { main: 'index.html', bake: 'bake.html' }, output: { manualChunks: { three: ['three'] } } } },
  test: { include: ['tests/**/*.test.ts'] },
});
