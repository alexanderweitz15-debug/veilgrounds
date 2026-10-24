// Central preloader: one promise that loads everything a match needs to be drawn - champion atlas of the match's
// champions (+Hark), minion atlas, jungle monster/plant atlases, optionally the baked terrain - with ONE combined
// progress value. The sim must not start before it resolves. Every step has a watchdog and a time limit; a step that
// fails or times out is replaced by the pink/black checkerboard atlas (and a console.warn), and the real atlas is
// swapped in through `onLate` if it still finishes. Steps are shared per session: the classic loading screen and the
// game that follows join the same work.
import { ANIMS, BIG_MONSTER_IDS, CAMP_MONSTER_IDS, MINION_IDS, footOf, framesOf, worldSizeOf, type Anim, type ChampionAtlas } from '../champions';
import { planAtlas } from '../champions/atlas';
import { getChampionAtlas, getMinionAtlas, getMonsterAtlases } from '../sheets';
import { checkManifestOnce, type AssetIssue } from './manifest';
import { placeholderAtlas, type PlaceholderSpec } from './placeholder';
import { runSteps, StepRunner, type StepDef } from './pipeline';

/** Watchdog (no progress) and hard limit per step, in ms. A cold bake of everything takes ~40 s in a slow sandbox. */
export const LOAD_LIMITS = {
  champions: { stallMs: 30_000, hardMs: 150_000 },
  minions: { stallMs: 30_000, hardMs: 90_000 },
  monsters: { stallMs: 30_000, hardMs: 120_000 },
  terrain: { stallMs: 30_000, hardMs: 60_000 },
} as const;

export type LateKind = 'champions' | 'minions' | 'monsters';

export interface PreloadOptions {
  /** champion ids of the match (Hark is added for Ottilie) */
  champions: string[];
  /** combined progress 0..1, never decreasing */
  onProgress?: (k: number) => void;
  /** the real atlas, if a step was given up first and finished later (monsters: [big, camp]) */
  onLate?: (kind: LateKind, atlas: ChampionAtlas | [ChampionAtlas, ChampionAtlas]) => void;
  /** resolves when the baked terrain is on screen (src/render/terrain.ts); skipped when omitted */
  terrainReady?: () => Promise<void>;
}

export interface PreloadResult {
  champions: ChampionAtlas;
  minions: ChampionAtlas;
  monsters: [ChampionAtlas, ChampionAtlas];
  /** steps that fell back to placeholders (timeout or failure); empty = everything is the real art */
  degraded: string[];
  /** asset manifest problems (missing painter, no frames); those ids are checkerboards inside the real atlases */
  issues: AssetIssue[];
}

const runner = new StepRunner();

const specOf = (id: string): PlaceholderSpec => ({
  frames: Object.fromEntries(ANIMS.map((a) => [a, framesOf(id, a)])) as Record<Anim, number>,
  world: worldSizeOf(id),
  foot: footOf(id),
});

const withHark = (ids: string[]): string[] => (ids.includes('ottilie') && !ids.includes('hark') ? [...ids, 'hark'] : ids);
const jobs = (ids: string[]): number => planAtlas(ids, { autoHark: false }).jobs.length;

/** Loads everything the match needs; resolves (never rejects) once every step has a value, real or placeholder. */
export async function preloadMatch(o: PreloadOptions): Promise<PreloadResult> {
  const issues = checkManifestOnce();
  const ids = [...new Set(o.champions)].sort();
  const champIds = withHark(ids);

  const champs: StepDef<ChampionAtlas> = {
    key: `champions:${ids.join(',')}`,
    label: 'champion atlas',
    weight: jobs(champIds),
    ...LOAD_LIMITS.champions,
    start: (report) => getChampionAtlas(ids, (d, n) => report(n ? d / n : 1)),
    fallback: () => placeholderAtlas(champIds, specOf),
  };
  const minions: StepDef<ChampionAtlas> = {
    key: 'minions',
    label: 'minion atlas',
    weight: jobs(MINION_IDS),
    ...LOAD_LIMITS.minions,
    start: (report) => getMinionAtlas((d, n) => report(n ? d / n : 1)),
    fallback: () => placeholderAtlas(MINION_IDS, specOf),
  };
  const monsters: StepDef<[ChampionAtlas, ChampionAtlas]> = {
    key: 'monsters',
    label: 'monster atlases',
    weight: jobs(BIG_MONSTER_IDS) + jobs(CAMP_MONSTER_IDS),
    ...LOAD_LIMITS.monsters,
    start: (report) => getMonsterAtlases((d, n) => report(n ? d / n : 1)),
    fallback: () => [placeholderAtlas(BIG_MONSTER_IDS, specOf), placeholderAtlas(CAMP_MONSTER_IDS, specOf)],
  };
  const terrain: StepDef<void> | null = o.terrainReady
    ? { key: 'terrain', label: 'terrain', weight: 100, ...LOAD_LIMITS.terrain, start: (report) => o.terrainReady!().then(() => report(1)), fallback: () => undefined }
    : null;

  const kinds: LateKind[] = ['champions', 'minions', 'monsters'];
  const onLate = (i: number, v: unknown): void => {
    const kind = kinds[i];
    if (kind) o.onLate?.(kind, v as ChampionAtlas | [ChampionAtlas, ChampionAtlas]);
  };
  const steps = (terrain ? [champs, minions, monsters, terrain] : [champs, minions, monsters]) as [StepDef<ChampionAtlas>, StepDef<ChampionAtlas>, StepDef<[ChampionAtlas, ChampionAtlas]>];
  const r = await runSteps(runner, steps, o.onProgress, onLate);
  const [c, m, mo] = r.outcomes;
  return { champions: c.value, minions: m.value, monsters: mo.value, degraded: r.degraded, issues };
}
