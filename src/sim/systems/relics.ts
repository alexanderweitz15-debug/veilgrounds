// Health relics (ARAM, rules.relics): honey-piece look-alikes on the lane. A living champion touching one heals a share
// of max HP and mana; it comes back after respawnS. Bots already walk to honey pieces (ai/bot/plants.ts).
import type { Sim } from '../sim';
import { despawn, isRef, spawnUnit } from '../sim';
import type { System } from './index';
import { Kind, Team, sec, variantIndex } from '../types';
import { MAP_SIZE, nearestWalkable } from '../map';
import { scalePt } from '../map';
import { healUnit } from '../buffs';
import { champions } from './economy';
import { dist2 } from '../vec';

interface Relic {
  x: number;
  y: number;
  eid: number;
  serial: number;
  respawnAt: number;
}

const relicsOf = (sim: Sim): Relic[] => (sim.state.relics ??= []) as Relic[];

function spawn(sim: Sim, r: Relic): void {
  const { Unit, Hp, Vision } = sim.c;
  const eid = spawnUnit(sim, Kind.Plant, Team.Neutral, r.x, r.y, 24);
  Unit.variant[eid] = variantIndex('honigstueck');
  Unit.untargetable[eid] = 1;
  Unit.invulnerable[eid] = 1;
  Hp.max[eid] = Hp.cur[eid] = 1;
  Vision.r[eid] = 0;
  r.eid = eid;
  r.serial = Unit.serial[eid]!;
  r.respawnAt = -1;
}

export const relicsSystem: System = {
  name: 'relics',
  init(sim) {
    const cfg = sim.config.rules?.relics;
    if (!cfg) return;
    const list = relicsOf(sim);
    for (const spot of cfg.spots) {
      const p = scalePt({ x: spot[0], y: spot[1] });
      for (const q of [p, { x: MAP_SIZE - p.x, y: MAP_SIZE - p.y }]) {
        const w = nearestWalkable(sim.map.nav, q.x, q.y);
        const r: Relic = { x: w.x, y: w.y, eid: -1, serial: 0, respawnAt: -1 };
        spawn(sim, r);
        list.push(r);
      }
    }
  },
  update(sim) {
    const cfg = sim.config.rules?.relics;
    if (!cfg) return;
    const { Unit, Pos, Hp, Mana } = sim.c;
    for (const r of relicsOf(sim)) {
      if (r.respawnAt >= 0) {
        if (sim.tick >= r.respawnAt) spawn(sim, r);
        continue;
      }
      if (!isRef(sim, r.eid, r.serial)) continue;
      for (const c of champions(sim)) {
        if (!Unit.alive[c]) continue;
        const rr = cfg.r + Unit.radius[c]!;
        if (dist2(Pos.x[c]!, Pos.y[c]!, r.x, r.y) > rr * rr) continue;
        healUnit(sim, c, Hp.max[c]! * cfg.healPct);
        Mana.cur[c] = Math.min(Mana.max[c]!, Mana.cur[c]! + Mana.max[c]! * cfg.manaPct);
        despawn(sim, r.eid);
        r.respawnAt = sim.tick + sec(cfg.respawnS);
        break;
      }
    }
  },
};
