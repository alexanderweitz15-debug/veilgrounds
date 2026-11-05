// Knarr Zangenfels hooks: Shell Stance (W toggles Fortress <-> Sidestep), Fortress taunt, Sidestep auto damage, Tidal armor.
// Fortress (default, from level 1): slow, high armor/MR, taunts enemy champions around him when entered. Sidestep: fast, harder autos, E leaps far.
// Numbers in knarr.values.json. State in sim.state; stats are rebuilt every tick before onComputeStats (no compounding).

import type { Sim } from '../sim';
import { Kind, sec } from '../types';
import { dist2 } from '../vec';
import { champAbil } from '../systems/abilities';
import { canTarget } from '../systems/attack';
import type { ChampionHooks, ChampionVisuals } from './hooks';
import { stateMap } from './dagny';
import { peekState } from './util';
import V from '../../data/champions/knarr.values.json';

interface Shell {
  sidestep: boolean;
  tauntUntil: number;
  tauntTotal: number;
}
const shells = (sim: Sim): Map<number, Shell> => stateMap<Shell>(sim, 'knarrShell');
const shell = (sim: Sim, eid: number): Shell => {
  let s = shells(sim).get(eid);
  if (!s) shells(sim).set(eid, (s = { sidestep: false, tauntUntil: 0, tauntTotal: 0 }));
  return s;
};

export const knarrSidestep = (sim: Sim, eid: number): boolean => shells(sim).get(eid)?.sidestep ?? false;
/** W rank for the stance numbers; the stances work from level 1 (rank 0 uses the rank-1 numbers). */
const wRank = (sim: Sim, eid: number): number => Math.max(1, champAbil(sim, eid).ranks[1] ?? 0);

/** Enemy champions of `eid` within r (alive), ascending slot. */
function enemyChampsNear(sim: Sim, eid: number, r: number): number[] {
  const { Unit, Pos } = sim.c;
  const out: number[] = [];
  for (const e of sim.slots) {
    if (e === undefined || e < 0 || !Unit.alive[e] || Unit.team[e] === Unit.team[eid] || Unit.kind[e] !== Kind.Champion) continue;
    if (dist2(Pos.x[e]!, Pos.y[e]!, Pos.x[eid]!, Pos.y[eid]!) <= r * r) out.push(e);
  }
  return out;
}

/** Taunted enemy champions attack Knarr (same order as an attack command) while the taunt lasts. */
function knarrTick(sim: Sim, eid: number): void {
  const s = shells(sim).get(eid);
  if (!s || sim.tick >= s.tauntUntil || !sim.c.Unit.alive[eid]) return;
  const { Atk, Move, Unit } = sim.c;
  for (const e of enemyChampsNear(sim, eid, V.fortress.tauntRadius)) {
    if (!canTarget(sim, e, eid)) continue;
    Atk.target[e] = eid;
    Atk.targetSerial[e] = Unit.serial[eid]!;
    Atk.attackMove[e] = 0;
    Move.mode[e] = 2;
  }
}

function knarrVisuals(sim: Sim, eid: number): ChampionVisuals {
  const s = peekState<Shell>(sim, 'knarrShell')?.get(eid);
  const side = s?.sidestep ?? false;
  const v: ChampionVisuals = { passive: { stacks: side ? 1 : 0, max: 1, ready: !side } };
  if (!side) v.aura = 1; // fortress: aura ring (snapshot `auras` has knarr_w; bots read it)
  if (s && sim.tick < s.tauntUntil) v.objects = [{ key: `${eid}`, tag: 'knarr_taunt', x: sim.c.Pos.x[eid]!, y: sim.c.Pos.y[eid]!, r: V.fortress.tauntRadius, shape: 'ring', left: s.tauntUntil - sim.tick, total: s.tauntTotal }];
  return v;
}

export const hooks: ChampionHooks = {
  visuals: knarrVisuals,
  onTick: knarrTick,
  passive: {
    knarr_shell: {
      onSpawn(sim, eid) {
        shell(sim, eid);
      },
      onComputeStats(sim, eid) {
        const { Stats } = sim.c;
        const tidal = Math.min(V.tidal.max, V.tidal.perEnemy * enemyChampsNear(sim, eid, V.tidal.radius).length);
        const rank = wRank(sim, eid);
        let res = tidal;
        if (shell(sim, eid).sidestep) Stats.ms[eid] = Stats.ms[eid]! * V.sidestep.msMult;
        else {
          Stats.ms[eid] = Stats.ms[eid]! * V.fortress.msMult;
          res += V.fortress.resist[rank - 1]!;
        }
        Stats.armor[eid] = Stats.armor[eid]! + res;
        Stats.mr[eid] = Stats.mr[eid]! + res;
      },
      modifyDamage(sim, eid, _target, amount, _type, isAuto) {
        const rank = wRank(sim, eid);
        return isAuto && shell(sim, eid).sidestep ? amount * (1 + V.sidestep.autoDmgPct[rank - 1]! / 100) : amount;
      },
    },
  },
  effects: {
    knarr_w_stance(sim, ctx) {
      const s = shell(sim, ctx.caster);
      s.sidestep = !s.sidestep;
      if (!s.sidestep) {
        s.tauntTotal = sec(V.fortress.tauntSec[ctx.rank - 1]!);
        s.tauntUntil = sim.tick + s.tauntTotal;
      } else s.tauntUntil = 0;
    },
    // E: Fortress shortens the dash and weakens the hit (listed before the damage effect).
    knarr_e_step(sim, ctx) {
      const fort = !shell(sim, ctx.caster).sidestep;
      if (ctx.phase === 'dashStart' && ctx.dash && fort) ctx.dash.distance = Math.min(ctx.dash.distance, V.fortress.stepDist);
      else if (ctx.phase === 'cast' && fort) ctx.dmgMult = (ctx.dmgMult ?? 1) * V.fortress.stepDmgMult;
    },
  },
};
