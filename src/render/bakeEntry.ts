// Build-time sprite bake (S3): loaded by bake.html inside the headless browser that tools/bakeSprites.mjs starts after
// `vite build`. Bakes every strip of BAKE_GROUPS through the game's own atlas code (worker pool, same cell sizes and
// keys) and POSTs each strip to the script's local server, which writes it into dist/atlas/<ART_VER>/.
import { buildChampionAtlasAsync, type AnyCanvas, type AtlasCellCache } from './champions';
import { BAKE_GROUPS, makeWorker } from './sheets';
import { ART_VER, GROUND_ART_VER } from './staticAtlas';
import { paintGroundFor } from './terrain';
import { loadMap } from '../sim/map';

const GROUND_QUALITY = 0.92;

const post = (path: string, body: BodyInit | null = null): Promise<Response> => fetch(`/__bake/${path}`, { method: 'POST', body });

const toBlob = (c: AnyCanvas): Promise<Blob | null> =>
  'convertToBlob' in c ? c.convertToBlob({ type: 'image/png' }) : new Promise((resolve) => (c as HTMLCanvasElement).toBlob(resolve, 'image/png'));

async function main(): Promise<void> {
  await post(`start?ver=${encodeURIComponent(ART_VER ?? '')}`);
  const uploads: Promise<unknown>[] = [];
  const cache: AtlasCellCache = {
    get: () => Promise.resolve(null),
    put(key, strip, top) {
      uploads.push(
        toBlob(strip).then((blob) => {
          if (!blob) throw new Error(`no PNG for ${key}`);
          return post(`strip?key=${encodeURIComponent(key)}&top=${top}`, blob);
        }),
      );
    },
  };
  const t0 = performance.now();
  let n = 0;
  const total = BAKE_GROUPS.reduce((s, g) => s + g.ids.length, 0);
  for (const g of BAKE_GROUPS) {
    for (const id of g.ids) {
      await buildChampionAtlasAsync([id], { master: g.master, frame: g.frame, autoHark: false, worker: makeWorker, cache });
      await new Promise((r) => setTimeout(r, 20)); // the strip is handed to the cache in a timeout
      await Promise.all(uploads.splice(0));
      void post(`log?msg=${encodeURIComponent(`${++n}/${total} ${id} (${Math.round(performance.now() - t0)} ms)`)}`);
    }
  }
  // the painted ground (2-4 s of main-thread painting at game start). Lossy WebP: opaque brush texture, ~10x smaller than PNG.
  const ground = paintGroundFor(loadMap(), 4096);
  const webp = await new Promise<Blob | null>((r) => ground.toBlob(r, 'image/webp', GROUND_QUALITY));
  if (!webp) throw new Error('no WebP for the ground');
  await post(`strip?key=ground-4096&top=0&ext=webp&ver=${GROUND_ART_VER}`, webp);
  await post('done');
}

main().catch((e) => post(`error?msg=${encodeURIComponent(String(e?.stack ?? e))}`));
