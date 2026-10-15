// Perception: turns a fog-filtered snapshot into the bot's working view, applying reaction delay to enemy
// champions (an enemy that just appeared is not "noticed" until its sampled reaction time has passed).

import { Kind, isMinion } from '../../sim/types';
import { sampleReactionMs } from '../profiles';
import type { Rng } from '../../sim/rng';
import type { BotMemory, BotStatic, PlayerHud, SnapEntity, Snapshot } from './types';
import { dst } from './geo';
import { TOWER_RADIUS, TOWER_RANGE } from '../../sim/systems/towers';

export interface View {
  tick: number;
  time: number;
  me: PlayerHud;
  self: SnapEntity;
  hpPct: number;
  /** Auto-attack reach to a unit's centre (range + own radius; add target radius). */
  reach: number;
  /** Enemy champions the bot has noticed (reaction delay passed), alive and visible. */
  enemies: SnapEntity[];
  /** Enemy champions visible but not yet noticed. */
  unnoticed: SnapEntity[];
  allies: SnapEntity[];
  enemyMinions: SnapEntity[];
  ownMinions: SnapEntity[];
  monsters: SnapEntity[];
  enemyTowers: SnapEntity[];
  ownTowers: SnapEntity[];
  /** Other enemy structures (inhibitors, nexus) alive. */
  enemyStructures: SnapEntity[];
  snap: Snapshot;
}

export const ticksOfMs = (ms: number): number => Math.max(0, Math.round((ms * 30) / 1000));

export function perceive(snap: Snapshot, ctx: BotStatic, mem: BotMemory, rng: Rng): View | null {
  const me = snap.me;
  if (!me) return null;
  const self = snap.entities.find((e) => e.id === me.eid);
  if (!self) return null;
  const v: View = {
    tick: snap.tick,
    time: snap.time,
    me,
    self,
    hpPct: self.maxHp > 0 ? self.hp / self.maxHp : 0,
    reach: me.stats.range + self.radius,
    enemies: [],
    unnoticed: [],
    allies: [],
    enemyMinions: [],
    ownMinions: [],
    monsters: [],
    enemyTowers: [],
    ownTowers: [],
    enemyStructures: [],
    snap,
  };
  for (const e of snap.entities) {
    if (!e.alive || e.id === me.eid) continue;
    const own = e.team === ctx.team;
    if (e.kind === Kind.Champion) {
      if (own) v.allies.push(e);
      else {
        let a = mem.aware.get(e.serial);
        if (!a) {
          a = { from: snap.tick + ticksOfMs(sampleReactionMs(ctx.profile.behavior, rng)), lastSeen: snap.tick, x: e.x, y: e.y };
          mem.aware.set(e.serial, a);
        }
        a.lastSeen = snap.tick;
        a.x = e.x;
        a.y = e.y;
        (snap.tick >= a.from ? v.enemies : v.unnoticed).push(e);
      }
    } else if (isMinion(e.kind)) (own ? v.ownMinions : v.enemyMinions).push(e);
    else if (e.kind === Kind.Monster) v.monsters.push(e);
    else if (e.kind === Kind.Tower) (own ? v.ownTowers : v.enemyTowers).push(e);
    else if (!own && (e.kind === Kind.Inhibitor || e.kind === Kind.Nexus)) v.enemyStructures.push(e);
  }
  // forget enemies out of sight for 3 s: re-appearing costs a new reaction
  for (const [serial, a] of mem.aware) if (snap.tick - a.lastSeen > 90) mem.aware.delete(serial);
  return v;
}

/** Units of a list within r of p. */
export const near = <T extends { x: number; y: number }>(list: T[], p: { x: number; y: number }, r: number): T[] => list.filter((e) => dst(e, p) <= r);

/** Enemy tower whose shot range covers p (centre distance incl. radii). */
export const TOWER_DANGER = TOWER_RANGE + TOWER_RADIUS + 70;
export const towerCovering = (v: View, p: { x: number; y: number }): SnapEntity | undefined => v.enemyTowers.find((t) => dst(t, p) <= TOWER_DANGER);
