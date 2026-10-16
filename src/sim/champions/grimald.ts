// Grimald Fell hooks: traps from monster kills (passive), monster regen during W, attack-speed aura (R).

import type { Sim } from '../sim';
import { Kind, sec } from '../types';
import { addBuff, hasBuff, healUnit } from '../buffs';
import { enemiesInRadius } from '../systems/abilities';
import { addGroundObject, groundObjects, removeGroundObject } from '../summons';
import type { ChampionHooks, ChampionVisuals } from './hooks';
import { stateMap } from './dagny';
import { peekState } from './util';

const TRAP = 'grimald_trap';
const MAX_TRAPS = 3;
/** R attack-speed aura radius. */
const AURA_R = 300;

export const grimaldTraps = (sim: Sim, eid: number): { x: number; y: number }[] => groundObjects(sim, TRAP, eid).map((o) => ({ x: o.x, y: o.y }));

/** Last tick Grimald damaged a jungle monster. */
const monsterHits = (sim: Sim): Map<number, number> => stateMap<number>(sim, 'grimaldMonster');
const noteMonster = (sim: Sim, eid: number, t: number): void => {
  if (sim.c.Unit.kind[t] === Kind.Monster) monsterHits(sim).set(eid, sim.tick);
};

/** R aura end tick per Grimald. */
const auras = (sim: Sim): Map<number, number> => stateMap<number>(sim, 'grimaldAura');

function grimaldTick(sim: Sim, eid: number): void {
  const { Pos, Unit, Hp } = sim.c;
  // traps: an enemy champion stepping on one (radius 75) is rooted 0.5 s; the trap is consumed
  for (const o of groundObjects(sim, TRAP, eid)) {
    const victim = enemiesInRadius(sim, eid, o.x, o.y, o.r).find((e) => Unit.kind[e] === Kind.Champion);
    if (victim === undefined) continue;
    addBuff(sim, victim, { kind: 'root', id: TRAP, src: eid, ticks: sec(0.5) });
    removeGroundObject(sim, o.id);
  }
  if (!Unit.alive[eid]) return void auras(sim).delete(eid);
  // W: 2 % max HP per second while a monster was damaged within the last second
  const last = monsterHits(sim).get(eid);
  if (hasBuff(sim, eid, 'stat', 'grimald_w') && last !== undefined && sim.tick - last <= sec(1)) healUnit(sim, eid, (0.02 * Hp.max[eid]!) / 30);
  // R: aura radius 300 around Grimald, -20 % enemy attack speed
  const until = auras(sim).get(eid);
  if (until === undefined) return;
  if (sim.tick >= until) return void auras(sim).delete(eid);
  for (const e of enemiesInRadius(sim, eid, Pos.x[eid]!, Pos.y[eid]!, AURA_R)) addBuff(sim, e, { kind: 'stat', stat: 'as', id: 'grimald_r', src: eid, pct: -20, ticks: 2 });
}

export const hooks: ChampionHooks = {
  // Snapshot (read-only): trap count on the passive badge (the traps themselves are ground objects, hidden from enemies),
  // R attack-speed aura ring (300) with its timer while it lasts.
  visuals(sim, eid) {
    const { Pos, Unit } = sim.c;
    const traps = groundObjects(sim, TRAP, eid).length;
    const v: ChampionVisuals = { passive: { stacks: traps, max: MAX_TRAPS, ready: traps > 0 } };
    const until = peekState<number>(sim, 'grimaldAura')?.get(eid);
    if (until !== undefined && sim.tick < until && Unit.alive[eid]) {
      v.objects = [{ key: `${eid}`, tag: 'grimald_r_aura', x: Pos.x[eid]!, y: Pos.y[eid]!, r: AURA_R, shape: 'ring', left: until - sim.tick, total: sec(3) }];
      v.aura = 3;
    }
    return v;
  },
  onTick: grimaldTick,
  passive: {
    grimald_traps: {
      // each monster kill leaves an invisible trap for 60 s (max 3 active, oldest removed)
      onKill(sim, eid, victim) {
        if (sim.c.Unit.kind[victim] !== Kind.Monster) return;
        const { Pos } = sim.c;
        addGroundObject(sim, { owner: eid, tag: TRAP, x: Pos.x[victim]!, y: Pos.y[victim]!, r: 75, ticks: sec(60), stealth: true });
        const mine = groundObjects(sim, TRAP, eid);
        for (let i = 0; i < mine.length - MAX_TRAPS; i++) removeGroundObject(sim, mine[i]!.id);
      },
      onAutoHit(sim, eid, target) {
        noteMonster(sim, eid, target);
      },
      onAbilityHit(sim, eid, target) {
        noteMonster(sim, eid, target);
      },
    },
  },
  effects: {
    // the regen runs in grimaldTick while the W buff is active
    grimald_w_monster_regen() {},
    // dash end (landing): start the 3 s aura
    grimald_r_aura(sim, ctx) {
      if (ctx.phase === 'cast') auras(sim).set(ctx.caster, sim.tick + sec(3));
    },
  },
};
