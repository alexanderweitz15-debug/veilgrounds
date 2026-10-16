// Cached sprite atlas builds for the game (baked in a worker pool, main-thread fallback).
import { buildChampionAtlasAsync, BIG_MONSTER_IDS, CAMP_MONSTER_IDS, MINION_IDS, type ChampionAtlas } from './champions';

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

let monsters: Promise<[ChampionAtlas, ChampionAtlas]> | null = null;
/**
 * Jungle monster + plant atlases, the same for every match: [big, camp]. Buffs and epic objectives get a 200 px
 * cell (they are drawn 2.7-5x champion height), camps and plants 128 px; big = 4096², camp = 4096 x 2048.
 */
export function getMonsterAtlases(onProgress?: (done: number, total: number) => void): Promise<[ChampionAtlas, ChampionAtlas]> {
  if (!monsters) {
    const t0 = performance.now();
    const p = buildChampionAtlasAsync(BIG_MONSTER_IDS, { master: 320, frame: 200, autoHark: false, worker: makeWorker, onProgress: (d, n) => onProgress?.(d * 0.4, n) })
      .then((big) => buildChampionAtlasAsync(CAMP_MONSTER_IDS, { master: 192, frame: 128, autoHark: false, worker: makeWorker, onProgress: (d, n) => onProgress?.(n * 0.4 + d * 0.6, n) }).then((camp) => [big, camp] as [ChampionAtlas, ChampionAtlas]))
      .then((a) => {
        console.info(`monster atlases: ${a[0].canvas.width}x${a[0].canvas.height} + ${a[1].canvas.width}x${a[1].canvas.height} in ${Math.round(performance.now() - t0)} ms`);
        return a;
      });
    p.catch(() => {
      if (monsters === p) monsters = null;
    });
    monsters = p;
  }
  return monsters;
}

