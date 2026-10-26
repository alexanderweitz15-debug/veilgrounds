// Per-tick working view of the reflex layer. Same shape as perception.ts `View`, built from the per-tick reflex
// snapshot (fog-filtered by the runner with the same rule as buildSnapshot). Unlike perceive() it never samples a
// reaction time and never adds enemies to mem.aware: an enemy champion counts as noticed only if the latest
// decision already noticed it (reaction delays stay a think-cadence matter, §3: perception only in think).

import { Kind, isMinion } from '../../sim/types';
import type { BotMemory, BotStatic, SnapEntity, Snapshot } from '../bot/types';
import type { View } from '../bot/perception';
import { fooledBy } from '../humanize/deception';

interface Groups {
  champs: [SnapEntity[], SnapEntity[]];
  minions: [SnapEntity[], SnapEntity[]];
  towers: [SnapEntity[], SnapEntity[]];
  structures: [SnapEntity[], SnapEntity[]];
  monsters: SnapEntity[];
}

/** Alive entities by kind and team, once per entity list (the team's bots share one list per tick). */
const GROUPS = new WeakMap<readonly SnapEntity[], Groups>();

function groups(list: readonly SnapEntity[]): Groups {
  let g = GROUPS.get(list);
  if (g) return g;
  g = { champs: [[], []], minions: [[], []], towers: [[], []], structures: [[], []], monsters: [] };
  for (const e of list) {
    if (!e.alive) continue;
    if (e.kind === Kind.Monster) {
      g.monsters.push(e);
      continue;
    }
    if (e.team !== 0 && e.team !== 1) continue;
    const t: 0 | 1 = e.team === 1 ? 1 : 0;
    if (false) continue;
    else if (e.kind === Kind.Champion) g.champs[t].push(e);
    else if (isMinion(e.kind)) g.minions[t].push(e);
    else if (e.kind === Kind.Tower) g.towers[t].push(e);
    else if (e.kind === Kind.Inhibitor || e.kind === Kind.Nexus) g.structures[t].push(e);
  }
  GROUPS.set(list, g);
  return g;
}

export function reflexView(snap: Snapshot, ctx: BotStatic, mem: BotMemory): View | null {
  const me = snap.me;
  if (!me) return null;
  const g = groups(snap.entities);
  const own = ctx.team === 1 ? 1 : 0;
  const foe = own === 1 ? 0 : 1;
  let self: SnapEntity | null = null;
  for (const e of g.champs[own]) if (e.id === me.eid) self = e;
  if (!self) return null;
  const enemies: SnapEntity[] = [];
  const unnoticed: SnapEntity[] = [];
  for (const e of g.champs[foe]) {
    const a = mem.aware.get(e.serial);
    (a && snap.tick >= a.from ? enemies : unnoticed).push(e);
  }
  // decoys the latest decision took for the champion (verdict rolled in think)
  for (const e of snap.entities) {
    const d = e.kind === Kind.Pet && e.team !== ctx.team ? fooledBy(e, snap.tick, ctx, mem, null) : null;
    if (d && mem.aware.get(d.serial) && snap.tick >= mem.aware.get(d.serial)!.from) enemies.push(d);
  }
  return {
    tick: snap.tick,
    time: snap.time,
    me,
    self,
    hpPct: self.maxHp > 0 ? self.hp / self.maxHp : 0,
    reach: me.stats.range + self.radius,
    enemies,
    unnoticed,
    allies: g.champs[own].filter((e) => e !== self),
    enemyMinions: g.minions[foe],
    ownMinions: g.minions[own],
    monsters: g.monsters,
    enemyTowers: g.towers[foe],
    ownTowers: g.towers[own],
    enemyStructures: g.structures[foe],
    snap,
  };
}
