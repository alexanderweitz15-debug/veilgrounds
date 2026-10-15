// Cached sprite atlas builds for the game (baked in a worker pool, main-thread fallback).
import { buildChampionAtlasAsync, type ChampionAtlas } from './champions';

const cache = new Map<string, Promise<ChampionAtlas>>();
const makeWorker = (): Worker => new Worker(new URL('./spriteWorker.ts', import.meta.url), { type: 'module' });

/** Champion atlas for the champions of a match (Hark added when Ottilie plays). Cached per id set. */
export function getChampionAtlas(ids: string[], onProgress?: (done: number, total: number) => void): Promise<ChampionAtlas> {
  const list = [...new Set(ids)].sort();
  const key = list.join(',');
  let p = cache.get(key);
  if (!p) {
    const t0 = performance.now();
    p = buildChampionAtlasAsync(list, { master: 192, frame: 128, autoHark: true, worker: makeWorker, onProgress }).then((a) => {
      console.info(`champion atlas: ${list.length} champions, ${a.canvas.width}x${a.canvas.height} @${a.frameSize}px in ${Math.round(performance.now() - t0)} ms`);
      return a;
    });
    // ponytail: keep only the latest build (one match at a time)
    cache.clear();
    cache.set(key, p);
  }
  return p;
}
