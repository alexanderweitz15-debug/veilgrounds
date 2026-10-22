// Engine-facing champion registry: data + hooks.
// Data: the roster registry in src/data/champions/index.ts (Agent D, validated via asChampion) plus mira.json.
// Hooks: src/sim/champions/<id>.ts exporting `hooks: ChampionHooks` (template: mira.ts), registered below.
// Static imports on purpose: import.meta.glob is unavailable under tsx (tools/botSim).

import type { ChampionData } from './schema';
import type { ChampionHooks, PassiveHook } from './hooks';
import type { Sim } from '../sim';
import { champions as roster } from '../../data/champions';
import { asChampion, hookIds, type Json } from '../../data/champions/validate';
import miraData from '../../data/champions/mira.json';
import { hooks as miraHooks } from './mira';
import { hooks as ilvaneHooks } from './ilvane';
import { hooks as thessalyHooks } from './thessaly';
import { hooks as kaelenHooks } from './kaelen';
import { hooks as bromHooks } from './brom';
import { hooks as olethHooks } from './oleth';
import { hooks as ferrisHooks } from './ferris';
import { hooks as gorvamHooks } from './gorvam';
import { hooks as vessaHooks } from './vessa';
import { hooks as nyxHooks } from './nyx';
import { hooks as harrowHooks } from './harrow';
import { hooks as seraphyneHooks } from './seraphyne';
import { hooks as rennHooks } from './renn';
import { hooks as isoldeHooks } from './isolde';
import { hooks as dagnyHooks } from './dagny';
import { hooks as grimaldHooks } from './grimald';
import { hooks as lioHooks } from './lio';
import { hooks as ottilieHooks } from './ottilie';
import { hooks as aurelHooks } from './aurel';
import { hooks as corvinHooks } from './corvin';
import { hooks as lysaHooks } from './lysa';
import { hooks as tobinHooks } from './tobin';
import { hooks as wrenHooks } from './wren';
import { hooks as hagenHooks } from './hagen';
import { hooks as kiranHooks } from './kiran';
import { hooks as odaHooks } from './oda';
import { hooks as sevHooks } from './sev';
import { extraHooksOf } from '../items/itemHooks';

export const CHAMPION_DATA: Record<string, ChampionData> = {
  ...roster,
  mira: asChampion(miraData satisfies Json<ChampionData>, 'mira.json'),
};

/** Hook modules by champion id. Add one line per champion with a hook file. */
export const CHAMPION_HOOKS: Record<string, ChampionHooks> = {
  mira: miraHooks,
  ilvane: ilvaneHooks,
  thessaly: thessalyHooks,
  kaelen: kaelenHooks,
  brom: bromHooks,
  oleth: olethHooks,
  ferris: ferrisHooks,
  gorvam: gorvamHooks,
  vessa: vessaHooks,
  nyx: nyxHooks,
  harrow: harrowHooks,
  seraphyne: seraphyneHooks,
  renn: rennHooks,
  isolde: isoldeHooks,
  dagny: dagnyHooks,
  grimald: grimaldHooks,
  lio: lioHooks,
  ottilie: ottilieHooks,
  aurel: aurelHooks,
  corvin: corvinHooks,
  lysa: lysaHooks,
  tobin: tobinHooks,
  wren: wrenHooks,
  hagen: hagenHooks,
  kiran: kiranHooks,
  oda: odaHooks,
  sev: sevHooks,
};

export const FALLBACK_CHAMPION = 'mira';

export function championData(id: string): ChampionData {
  return CHAMPION_DATA[id] ?? CHAMPION_DATA[FALLBACK_CHAMPION]!;
}

export function championHooks(id: string): ChampionHooks {
  return CHAMPION_HOOKS[id] ?? {};
}

/** Hook ids referenced by a champion's data that its hook module does not export (should be empty). */
export function missingHooks(id: string): string[] {
  const d = CHAMPION_DATA[id];
  if (!d) return [];
  const h = championHooks(id);
  const passive = new Set(d.passive.hooks);
  return hookIds(d).filter((k) => (passive.has(k) ? !h.passive?.[k] : !h.effects?.[k]));
}

/** Champion id of a champion entity ('' otherwise). */
export const champIdOf = (sim: Sim, eid: number): string => sim.championIds[sim.c.Unit.champ[eid]!] ?? '';

// Resolved passive hook lists per champion id (pure data, safe to cache across sims).
const passiveCache = new Map<string, PassiveHook[]>();

/** Passive hooks of a champion entity, in data order, then its item and rune hooks (empty for non-champions). */
export function passiveHooksOf(sim: Sim, eid: number): PassiveHook[] {
  if (sim.c.Unit.champ[eid]! < 0) return [];
  const id = champIdOf(sim, eid);
  let list = passiveCache.get(id);
  if (!list) {
    const h = championHooks(id).passive ?? {};
    list = championData(id).passive.hooks.flatMap((k) => (h[k] ? [h[k]!] : []));
    passiveCache.set(id, list);
  }
  const extra = extraHooksOf(sim, eid); // item + rune hooks (src/sim/items/itemHooks.ts)
  return extra.length ? list.concat(extra) : list;
}
