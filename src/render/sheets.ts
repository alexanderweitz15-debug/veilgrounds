// Cached sprite atlas builds for the game (baked in a worker pool, main-thread fallback).
// B7 load time: baked cells persist per sprite id in IndexedDB (PNG strips, src/render/atlasStore.ts), so a warm start
// only decodes them. Records carry a version derived from this module's built URL (content-hashed chunk: any art change
// in the bundle invalidates them); the dev server bakes every time. Not Cache Storage: the PWA service worker deletes
// every cache but its own on activate.
import { buildChampionAtlasAsync, BIG_MONSTER_IDS, CAMP_MONSTER_IDS, CHAMPION_IDS, MINION_IDS, PLANT_IDS, STRIP_COLS, stripKey, type AnyCanvas, type AtlasCellCache, type ChampionAtlas } from './champions';
import { buildVersion, loadStrip, saveStrip } from './atlasStore';
import { ART_VER, staticManifest, staticStrip } from './staticAtlas';

const cache = new Map<string, Promise<ChampionAtlas>>();
export const makeWorker = (): Worker => new Worker(new URL('./spriteWorker.ts', import.meta.url), { type: 'module' });

// Stored strips are valid as long as the sprite renderer sources are unchanged (hash from vite.config.ts); without it
// (tests) the content-hashed chunk URL stands in.
const ATLAS_VER = ART_VER ?? buildVersion(import.meta.url);

let cellCache: AtlasCellCache | undefined | null = null;
/**
 * Strip cache: IndexedDB first, then the strips shipped with the build (tools/bakeSprites.mjs, copied into IndexedDB so
 * the next start needs no network). Undefined in dev or without createImageBitmap: the game then bakes at runtime.
 */
function cellStore(): AtlasCellCache | undefined {
  if (cellCache !== null) return cellCache;
  if (import.meta.env.DEV || typeof createImageBitmap === 'undefined') return (cellCache = undefined);
  void staticManifest(); // start the (tiny) manifest request with the first atlas request
  const toBlob = (c: AnyCanvas): Promise<Blob | null> =>
    'convertToBlob' in c ? c.convertToBlob({ type: 'image/png' }) : new Promise((resolve) => (c as HTMLCanvasElement).toBlob(resolve, 'image/png'));
  return (cellCache = {
    async get(key) {
      let r = await loadStrip(key, ATLAS_VER);
      if (!r) {
        r = await staticStrip(key);
        if (r) void saveStrip(key, ATLAS_VER, r.blob, r.top);
      }
      return r ? { bmp: await createImageBitmap(r.blob), top: Number.isFinite(r.top) ? r.top : 0.2 } : null;
    },
    put(key, strip, top) {
      void toBlob(strip)
        .then((blob) => (blob ? saveStrip(key, ATLAS_VER, blob, top) : undefined))
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
    p = buildChampionAtlasAsync(list, { master: CHAMP_MASTER, frame: CHAMP_FRAME, maxSize: ATLAS_MAX, autoHark: true, worker: makeWorker, cache: cellStore(), onProgress }).then((a) => {
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

// Champion frames ~1:1 with their on-screen size (a 260-unit sprite is ~160 px tall at 1080p, max zoom-out): the
// old 128 px frames (shrunk to ~112 px when ten champions had to fit 4096x4096) were upscaled and looked blurry
// next to the native-resolution world. The atlas may grow to 8192 wide when the GPU allows it.
const CHAMP_MASTER = 240;
const CHAMP_FRAME = 152;
/** Largest atlas side this GPU takes (capped at 8192; 4096 without WebGL info, e.g. in tests). */
const ATLAS_MAX = ((): number => {
  try {
    const gl = typeof document !== 'undefined' ? document.createElement('canvas').getContext('webgl2') : null;
    return gl ? Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 4096;
  } catch {
    return 4096;
  }
})();
// Cell sizes of the other sprite groups (kept here so the build-time bake uses the same keys as the game).
const MINION_BAKE = { master: 144, frame: 96 };
const BIG_BAKE = { master: 320, frame: 200 };
const CAMP_BAKE = { master: 192, frame: 128 };
const PLANT_BAKE = CAMP_BAKE; // third atlas: same cells as the camp atlas
/** Every strip the build bakes (tools/bakeSprites.mjs via src/render/bakeEntry.ts): ids with their master / cell size. */
export const BAKE_GROUPS: { ids: string[]; master: number; frame: number }[] = [
  { ids: [...new Set([...CHAMPION_IDS, 'hark'])], master: CHAMP_MASTER, frame: CHAMP_FRAME },
  { ids: MINION_IDS, ...MINION_BAKE },
  { ids: BIG_MONSTER_IDS, ...BIG_BAKE },
  { ids: CAMP_MONSTER_IDS, ...CAMP_BAKE },
  { ids: PLANT_IDS, ...PLANT_BAKE },
];
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
    const shipped = (await staticManifest())?.strips ?? {};
    for (const id of CHAMPION_IDS) {
      if (gameRequested) break;
      const key = stripKey(id, CHAMP_MASTER, CHAMP_FRAME, true);
      if (shipped[key]) continue; // pre-baked with the build: fetched when a game needs it, never painted
      const hit = await store.get(key).catch(() => null);
      if (hit) {
        // a strip stored by a crowded 10-champion atlas has smaller cells: bake it again at full size
        const full = hit.bmp.width / STRIP_COLS >= CHAMP_FRAME;
        hit.bmp.close();
        if (full) continue;
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
    const p = buildChampionAtlasAsync(MINION_IDS, { ...MINION_BAKE, autoHark: false, worker: makeWorker, cache: cellStore(), onProgress }).then((a) => {
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

let monsters: Promise<ChampionAtlas[]> | null = null;
/**
 * Jungle monster + plant atlases, the same for every match: [big, camp, plants]. Buffs and epic objectives get a 200 px
 * cell (they are drawn 2.7-5x champion height), camps and plants 128 px; big = 4096², camp = 4096 x 2048, plants =
 * the four newer fruits / honey piece (the camp atlas is near its cell limit).
 */
export function getMonsterAtlases(onProgress?: (done: number, total: number) => void): Promise<ChampionAtlas[]> {
  if (!monsters) {
    const t0 = performance.now();
    const bake = (ids: string[], size: { master: number; frame: number }, from: number, span: number): Promise<ChampionAtlas> =>
      buildChampionAtlasAsync(ids, { ...size, autoHark: false, worker: makeWorker, cache: cellStore(), onProgress: (d, n) => onProgress?.(from + (d / n) * span, 1) });
    const p = bake(BIG_MONSTER_IDS, BIG_BAKE, 0, 0.4)
      .then((big) => bake(CAMP_MONSTER_IDS, CAMP_BAKE, 0.4, 0.45).then((camp) => [big, camp]))
      .then((two) => bake(PLANT_IDS, PLANT_BAKE, 0.85, 0.15).then((plants) => [...two, plants]))
      .then((a) => {
        console.info(`monster atlases: ${a.map((x) => `${x.canvas.width}x${x.canvas.height}`).join(' + ')} in ${Math.round(performance.now() - t0)} ms`);
        return a;
      });
    p.catch(() => {
      if (monsters === p) monsters = null;
    });
    monsters = p;
  }
  return monsters;
}
