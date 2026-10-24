// Asset manifest: every procedural sprite id the game draws, with the atlas it is baked into and what must exist for it.
// There are no image files (docs/ART.md): an "asset" is an id for which a painter (paper-doll kit or custom drawer) and
// a frame count per animation exist in src/render/champions. The manifest is validated at startup and in
// tests/assetManifest.test.ts; a problem is a console.warn and a checkerboard sprite, never a crash or an invisible unit.
import { champions } from '../../data/champions';
import { MONSTER_TYPES, PLANT_TYPES } from '../../sim/types';
import { ANIMS, framesOf, rendererOf, type Anim } from '../champions/atlas';
import { BIG_MONSTER_IDS, CAMP_MONSTER_IDS, MINION_IDS, MONSTER_SPRITE } from '../champions';

export type AssetKind = 'champion' | 'pet' | 'minion' | 'monster' | 'plant';
/** The atlas (one texture) an asset is baked into: see src/render/sheets.ts. */
export type AtlasGroup = 'champions' | 'minions' | 'monstersBig' | 'monstersCamp';
export type Renderer = 'kit' | 'drawer' | 'wolf';

export interface AssetEntry {
  id: string;
  kind: AssetKind;
  atlas: AtlasGroup;
  /** painters allowed for this kind (champions: paper-doll kit, or a custom drawer like Vargrim) */
  renderers: Renderer[];
  /** animations that must have at least one frame; the others may be empty by design (e.g. no cast for minions) */
  requiredAnims: Anim[];
}

const ALL: Anim[] = [...ANIMS];
const NO_CAST: Anim[] = ['idle', 'run', 'attack', 'death'];
const MONSTER_ANIMS: Anim[] = ['idle', 'attack', 'death'];
const PLANT_ANIMS: Anim[] = ['idle', 'death'];

/** Ids that go into the champion atlas besides the roster. */
export const PET_IDS = ['hark'] as const;

/** All sprite assets, in bake order. Built from the registries, so a new champion or monster is picked up automatically. */
export function buildManifest(): AssetEntry[] {
  const out: AssetEntry[] = [];
  for (const id of Object.keys(champions)) out.push({ id, kind: 'champion', atlas: 'champions', renderers: ['kit', 'drawer'], requiredAnims: ALL });
  for (const id of PET_IDS) out.push({ id, kind: 'pet', atlas: 'champions', renderers: ['wolf'], requiredAnims: NO_CAST });
  for (const id of MINION_IDS) out.push({ id, kind: 'minion', atlas: 'minions', renderers: ['kit', 'drawer'], requiredAnims: NO_CAST });
  for (const id of BIG_MONSTER_IDS) out.push({ id, kind: 'monster', atlas: 'monstersBig', renderers: ['drawer'], requiredAnims: MONSTER_ANIMS });
  for (const id of CAMP_MONSTER_IDS) {
    const plant = (PLANT_TYPES as readonly string[]).includes(id);
    out.push({ id, kind: plant ? 'plant' : 'monster', atlas: 'monstersCamp', renderers: ['drawer'], requiredAnims: plant ? PLANT_ANIMS : MONSTER_ANIMS });
  }
  return out;
}

export type AssetProblem = 'no-renderer' | 'wrong-renderer' | 'no-frames' | 'unmapped-variant';
export interface AssetIssue {
  id: string;
  kind: AssetKind | 'variant';
  problem: AssetProblem;
  detail: string;
}

/** Checks the manifest against the renderer registries and the sim's monster/plant types. Pure, no canvas. */
export function validateManifest(entries: readonly AssetEntry[] = buildManifest()): AssetIssue[] {
  const issues: AssetIssue[] = [];
  const known = new Set(entries.map((e) => e.id));
  for (const e of entries) {
    const r = rendererOf(e.id);
    if (r === null) {
      issues.push({ id: e.id, kind: e.kind, problem: 'no-renderer', detail: `no ${e.renderers.join('/')} painter registered for '${e.id}' (${e.atlas} atlas): src/render/champions/kits.ts, minions.ts, monsters.ts` });
      continue;
    }
    if (!e.renderers.includes(r)) issues.push({ id: e.id, kind: e.kind, problem: 'wrong-renderer', detail: `'${e.id}' is painted by a ${r}, expected ${e.renderers.join('/')}` });
    for (const anim of e.requiredAnims) {
      const n = framesOf(e.id, anim);
      if (!(n > 0)) issues.push({ id: e.id, kind: e.kind, problem: 'no-frames', detail: `'${e.id}' has ${n} frames for '${anim}'` });
    }
  }
  // every monster/plant the sim can spawn must resolve to a baked sprite (units.ts: MONSTER_SPRITE[variant]?.id ?? variant)
  for (const v of [...MONSTER_TYPES, ...PLANT_TYPES] as string[]) {
    const id = MONSTER_SPRITE[v]?.id ?? v;
    if (!known.has(id)) issues.push({ id: v, kind: 'variant', problem: 'unmapped-variant', detail: `sim type '${v}' resolves to sprite '${id}', which is not in the manifest (drawn as a blob)` });
  }
  return issues;
}

let reported = false;
/** Startup check: logs every manifest problem once per session and returns the issues (empty = all assets present). */
export function checkManifestOnce(): AssetIssue[] {
  const issues = validateManifest();
  if (!reported) {
    reported = true;
    for (const i of issues) console.warn(`[assets] ${i.problem}: ${i.detail}`);
  }
  return issues;
}

/** Ids of an atlas group, in manifest order. */
export function idsOf(group: AtlasGroup, entries: readonly AssetEntry[] = buildManifest()): string[] {
  return entries.filter((e) => e.atlas === group).map((e) => e.id);
}
