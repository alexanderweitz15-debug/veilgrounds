// Summoner spells (data: src/data/summoners.json). Cooldowns are applied by abilities.castSummoner;
// a per-player override (PlayerSetup.summonerCd, seconds) serves sandbox/trainers (e.g. Flash 5 s).

import { query } from 'bitecs';
import type { Sim } from './sim';
import { Kind, sec } from './types';
import raw from '../data/summoners.json';
import { addBuff, canAttack, canMove, healUnit } from './buffs';
import { dir, dist2 } from './vec';
import { landingPoint, nearestAlly, noteDashEnd, teleport } from './systems/abilities';
import { onMoveCommand } from './systems/attack';
import { dealDamage } from './damage';

export interface SummonerDef {
  id: string;
  name: { de: string; en: string };
  cooldown: number;
  range: number;
  /** Not implemented yet (e.g. "Phase 2"). */
  todo?: string;
}

export const SUMMONERS: SummonerDef[] = raw as SummonerDef[];

export const summonerDef = (id: string): SummonerDef | undefined => SUMMONERS.find((s) => s.id === id);

/** Linear by champion level 1..18. */
const byLevel = (sim: Sim, eid: number, lo: number, hi: number): number => lo + ((hi - lo) * (Math.max(1, sim.c.Champ.level[eid]!) - 1)) / 17;

/** Executes the spell; returns false if it could not be cast (no cooldown then). */
export function castSummonerSpell(sim: Sim, eid: number, id: string, x: number, y: number, target?: number): boolean {
  if (!canAttack(sim, eid)) return false; // stunned / airborne / suppressed
  const { Pos, Unit } = sim.c;
  switch (id) {
    case 'sprung': {
      if (!canMove(sim, eid)) return false; // rooted units cannot Flash
      const ox = Pos.x[eid]!;
      const oy = Pos.y[eid]!;
      const [dx, dy] = dir(ox, oy, x, y);
      const d = Math.min(400, Math.sqrt(dist2(x, y, ox, oy)));
      const p = landingPoint(sim, ox, oy, ox + dx * d, oy + dy * d);
      onMoveCommand(sim, eid); // Flash cancels an auto wind-up
      teleport(sim, eid, p.x, p.y);
      if (dx !== 0 || dy !== 0) {
        sim.c.Face.x[eid] = dx;
        sim.c.Face.y[eid] = dy;
      }
      noteDashEnd(sim, eid, -1);
      return true;
    }
    case 'heilen': {
      const amount = byLevel(sim, eid, 90, 345);
      const ally = nearestAlly(sim, eid, Pos.x[eid]!, Pos.y[eid]!, 850);
      for (const t of ally >= 0 ? [eid, ally] : [eid]) {
        healUnit(sim, t, amount);
        addBuff(sim, t, { kind: 'stat', stat: 'ms', id: 'heilen', src: eid, pct: 30, ticks: sec(1) });
      }
      return true;
    }
    case 'geist':
      addBuff(sim, eid, { kind: 'stat', stat: 'ms', id: 'geist', src: eid, pct: byLevel(sim, eid, 24, 48), ticks: sec(10) });
      return true;
    case 'entflammen': {
      const t = igniteTarget(sim, eid, x, y, target);
      if (t < 0) return false;
      const total = byLevel(sim, eid, 60, 410);
      addBuff(sim, t, { kind: 'dot', id: 'entflammen', src: eid, amount: total / 5, period: sec(1), dmgType: 'true', ticks: sec(5) });
      addBuff(sim, t, { kind: 'grievous', id: 'entflammen', src: eid, pct: 40, ticks: sec(5) });
      return true;
    }
    case 'bannen': {
      // Smite (Agent H): true damage to a monster or minion in range, nearest to the cursor if no target given.
      const ok = (t: number): boolean => {
        const k = Unit.kind[t]!;
        if (t < 0 || !Unit.alive[t] || Unit.untargetable[t] || Unit.team[t] === Unit.team[eid]) return false;
        if (k !== Kind.Monster && !(k >= Kind.MinionMelee && k <= Kind.MinionSuper)) return false;
        const r = 500 + Unit.radius[eid]! + Unit.radius[t]!;
        return dist2(Pos.x[t]!, Pos.y[t]!, Pos.x[eid]!, Pos.y[eid]!) <= r * r;
      };
      let t = target !== undefined && ok(target) ? target : -1;
      if (t < 0) {
        let bestD = 400 * 400;
        for (const e of query(sim.world, [Unit])) {
          if (!ok(e)) continue;
          const d = dist2(Pos.x[e]!, Pos.y[e]!, x, y);
          if (d < bestD) (bestD = d), (t = e);
        }
      }
      if (t < 0) return false;
      dealDamage(sim, eid, t, byLevel(sim, eid, 450, 900), 'true');
      return true;
    }
    default:
      return false; // TODO Phase 2: erschoepfen, reinigen, teleport
  }

  function igniteTarget(sim: Sim, eid: number, x: number, y: number, target?: number): number {
    const ok = (t: number): boolean => {
      if (t < 0 || !Unit.alive[t] || Unit.untargetable[t] || Unit.team[t] === Unit.team[eid]) return false;
      if (Unit.kind[t] !== Kind.Champion && Unit.kind[t] !== Kind.Dummy) return false;
      const r = 600 + Unit.radius[eid]! + Unit.radius[t]!;
      return dist2(Pos.x[t]!, Pos.y[t]!, Pos.x[eid]!, Pos.y[eid]!) <= r * r;
    };
    if (target !== undefined) return ok(target) ? target : -1;
    let best = -1;
    let bestD = 200 * 200;
    for (const t of query(sim.world, [Unit])) {
      if (!ok(t)) continue;
      const d = dist2(Pos.x[t]!, Pos.y[t]!, x, y);
      if (d < bestD) (bestD = d), (best = t);
    }
    return best;
  }
}
