// S3 load time: pre-baked sprite strips shipped with the build.
// `vite build` (in CI, or with BAKE_SPRITES=1) runs tools/bakeSprites.mjs: a headless browser opens bake.html, bakes every
// champion / minion / monster strip with the very same code the game uses (src/render/bakeEntry.ts) and the script
// writes them to dist/atlas/<ART_VER>/ plus a manifest. At runtime a strip that is neither in IndexedDB nor in this
// manifest is baked as before, so a build without the bake step (or the dev server) still works, just slower.

declare const __ATLAS_VER__: string | undefined;

/** Hash of the sprite renderer sources (vite.config.ts); null when the bundler did not define it (tests, odd setups). */
export const ART_VER: string | null = typeof __ATLAS_VER__ === 'string' ? __ATLAS_VER__ : null;

declare const __GROUND_VER__: string | undefined;
/** Hash of the files that decide how the painted ground looks (vite.config.ts); the shipped ground carries it. */
export const GROUND_ART_VER: string | null = typeof __GROUND_VER__ === 'string' ? __GROUND_VER__ : null;

export interface StaticManifest {
  ver: string;
  /** `ver`: own version of an entry that does not follow the sprite hash (the ground) */
  strips: Record<string, { file: string; top: number; ver?: string }>;
}

let manifest: Promise<StaticManifest | null> | null = null;
const urlOf = (rel: string): string => new URL(rel, document.baseURI).href;

/** The build's strip manifest (null in dev, without a bake step, or offline). Fetched once per session. */
export function staticManifest(): Promise<StaticManifest | null> {
  if (!ART_VER || import.meta.env.DEV || typeof document === 'undefined') return Promise.resolve(null);
  manifest ??= fetch(urlOf(`atlas/${ART_VER}/manifest.json`))
    .then((r) => (r.ok ? (r.json() as Promise<StaticManifest>) : null))
    .then((m) => (m && m.ver === ART_VER ? m : null))
    .catch(() => null);
  return manifest;
}

/** The shipped strip of `key` (WebP / PNG blob + head height), or null if the build does not contain it. */
export async function staticStrip(key: string, ver?: string | null): Promise<{ blob: Blob; top: number } | null> {
  const e = (await staticManifest())?.strips[key];
  if (!e || (ver !== undefined && e.ver !== ver)) return null;
  try {
    const r = await fetch(urlOf(`atlas/${ART_VER}/${e.file}`));
    return r.ok ? { blob: await r.blob(), top: e.top } : null;
  } catch {
    return null;
  }
}
