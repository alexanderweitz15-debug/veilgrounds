// Cached sprite atlas builds for the game (baked in a worker pool, main-thread fallback).
// B7 load time: baked cells persist per sprite id in Cache Storage (PNG strips), so a warm start only decodes them.
// The cache name carries a version derived from this module's built URL (content-hashed chunk: any art change in the
// bundle invalidates it); the dev server bakes every time.
import { buildChampionAtlasAsync, BIG_MONSTER_IDS, CAMP_MONSTER_IDS, CHAMPION_IDS, MINION_IDS, stripKey, type AnyCanvas, type AtlasCellCache, type ChampionAtlas } from './champions';

const cache = new Map<string, Promise<ChampionAtlas>>();
const makeWorker = (): Worker => new Worker(new URL('./spriteWorker.ts', import.meta.url), { type: 'module' });

const CACHE_PREFIX = 'vg-atlas-';
/** Short hash of the built chunk URL (contains Vite's content hash). */
function versionOf(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
const CACHE_NAME = CACHE_PREFIX + versionOf(import.meta.url);

let cellCache: AtlasCellCache | undefined | null = null;
/** Cache Storage backed strip cache; undefined in dev, without Cache Storage or when it fails. */
function cellStore(): AtlasCellCache | undefined {
  if (cellCache !== null) return cellCache;
  if (import.meta.env.DEV || typeof caches === 'undefined' || typeof createImageBitmap === 'undefined') return (cellCache = undefined);
  const url = (key: string): string => new URL(`atlas-cache/${encodeURIComponent(key)}.png`, location.href).href;
  // drop strips of older builds once per session
  void caches
    .keys()
    .then((names) => Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME).map((n) => caches.delete(n))))
    .catch(() => undefined);
  const toBlob = (c: AnyCanvas): Promise<Blob | null> =>
    'convertToBlob' in c ? c.convertToBlob({ type: 'image/png' }) : new Promise((resolve) => (c as HTMLCanvasElement).toBlob(resolve, 'image/png'));
  return (cellCache = {
    async get(key) {
      const store = await caches.open(CACHE_NAME);
      const res = await store.match(url(key));
      if (!res) return null;
      const top = Number(res.headers.get('x-top') ?? '0.2');
      return { bmp: await createImageBitmap(await res.blob()), top: Number.isFinite(top) ? top : 0.2 };
    },
    put(key, strip, top) {
      void toBlob(strip)
        .then(async (blob) => {
          if (!blob) return;
          const store = await caches.open(CACHE_NAME);
          await store.put(url(key), new Response(blob, { headers: { 'content-type': 'image/png', 'x-top': String(top) } }));
        })
        .catch(() => undefined); // quota / private mode: the next start just bakes again
    },
  });
}

/** Champion atlas for the champions of a match (Hark added when Ottilie plays). Cached per id set. */
export function getChampionAtlas(ids: string[], onProgress?: (done: number, total: number) => void): Promise<ChampionAtlas> {
  const list = [...new Set(ids)].sort();
  const key = list.join(',');
  gameRequested = true; // stops the menu precache (the game needs the bake workers now)
  let p = cache.get(key);
  if (!p) {
    const t0 = performance.now();
    p = buildChampionAtlasAsync(list, { master: CHAMP_MASTER, frame: CHAMP_FRAME, autoHark: true, worker: makeWorker, cache: cellStore(), onProgress }).then((a) => {
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

const CHAMP_MASTER = 192;
const CHAMP_FRAME = 128;
let gameRequested = false;
let precaching = false;

/**
 * B7: while the main menu is idle (no game requested yet this session), bake every champion that is not in the
 * persistent cache, one at a time with two workers, so the first game of the next start - and usually this one -
 * only decodes strips. Stops as soon as a game asks for its champion atlas.
 */
async function precacheRoster(): Promise<void> {
  const store = cellStore();
  if (!store || precaching || gameRequested) return;
  precaching = true;
  const t0 = performance.now();
  let baked = 0;
  try {
    for (const id of CHAMPION_IDS) {
      if (gameRequested) break;
      const hit = await store.get(stripKey(id, CHAMP_MASTER, CHAMP_FRAME, true)).catch(() => null);
      if (hit) {
        hit.bmp.close();
        continue;
      }
      await buildChampionAtlasAsync([id], { master: CHAMP_MASTER, frame: CHAMP_FRAME, autoHark: false, worker: makeWorker, workers: 2, cache: store });
      baked++;
    }
  } catch {
    /* best effort: the game bakes what is missing */
  } finally {
    precaching = false;
    if (baked) console.info(`sprite precache: ${baked} champions baked in ${Math.round(performance.now() - t0)} ms`);
  }
}

let minions: Promise<ChampionAtlas> | null = null;
/** Minion atlas (4 kinds x 2 teams), the same for every match: baked once per session. */
export function getMinionAtlas(onProgress?: (done: number, total: number) => void): Promise<ChampionAtlas> {
  if (!minions) {
    const t0 = performance.now();
    const p = buildChampionAtlasAsync(MINION_IDS, { master: 144, frame: 96, autoHark: false, worker: makeWorker, cache: cellStore(), onProgress }).then((a) => {
      console.info(`minion atlas: ${MINION_IDS.length} sprites, ${a.canvas.width}x${a.canvas.height} @${a.frameSize}px in ${Math.round(performance.now() - t0)} ms`);
      // the menu backdrop asks for minions first: afterwards warm the champion cache while the player is in menus
      setTimeout(() => void precacheRoster(), 1500);
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
    const p = buildChampionAtlasAsync(BIG_MONSTER_IDS, { master: 320, frame: 200, autoHark: false, worker: makeWorker, cache: cellStore(), onProgress: (d, n) => onProgress?.(d * 0.4, n) })
      .then((big) => buildChampionAtlasAsync(CAMP_MONSTER_IDS, { master: 192, frame: 128, autoHark: false, worker: makeWorker, cache: cellStore(), onProgress: (d, n) => onProgress?.(n * 0.4 + d * 0.6, n) }).then((camp) => [big, camp] as [ChampionAtlas, ChampionAtlas]))
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

