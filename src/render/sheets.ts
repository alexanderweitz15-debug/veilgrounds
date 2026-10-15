// Cached sprite atlas builds for the game (baked in a worker pool, main-thread fallback).
import { buildChampionAtlasAsync, MINION_IDS, type ChampionAtlas } from './champions';

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
    // a failed bake is not cached, so the game can retry after the loading screen
    p.catch(() => cache.get(key) === p && cache.delete(key));
    // ponytail: keep only the latest build (one match at a time)
    cache.clear();
    cache.set(key, p);
  }
  return p;
}

let minions: Promise<ChampionAtlas> | null = null;
/** Minion atlas (4 kinds x 2 teams), the same for every match: baked once per session. */
export function getMinionAtlas(onProgress?: (done: number, total: number) => void): Promise<ChampionAtlas> {
  if (!minions) {
    const t0 = performance.now();
    const p = buildChampionAtlasAsync(MINION_IDS, { master: 144, frame: 96, autoHark: false, worker: makeWorker, onProgress }).then((a) => {
      console.info(`minion atlas: ${MINION_IDS.length} sprites, ${a.canvas.width}x${a.canvas.height} @${a.frameSize}px in ${Math.round(performance.now() - t0)} ms`);
      return a;
    });
    p.catch(() => {
      if (minions === p) minions = null;
    });
    minions = p;
  }
  return minions;
}
