// Sister Oleth hooks. Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
import type { Sim } from '../sim';
import { sec } from '../types';
import { addBuff, addShield } from '../buffs';
import { lastDashEnd } from '../systems/abilities';
import { blockTerrain, wallCells } from '../summons';
import type { ChampionHooks } from './hooks';
import { hookState } from './util';

interface Faith {
  hits: { tick: number; amount: number }[];
  readyAt: number;
}

const faith = (sim: Sim, eid: number): Faith => {
  const m = hookState<Faith>(sim, 'olethFaith');
  let f = m.get(eid);
  if (!f) m.set(eid, (f = { hits: [], readyAt: 0 }));
  return f;
};

const WINDOW = sec(2);
const WALL_TICKS = sec(4);

export const hooks: ChampionHooks = {
  passive: {
    // >= 15 % max HP taken within 2 s: shield 8 % max HP for 3 s (cooldown 10 s).
    oleth_faith_wall: {
      onDamageTaken(sim, eid, _src, info) {
        const f = faith(sim, eid);
        f.hits = f.hits.filter((h) => sim.tick - h.tick < WINDOW);
        f.hits.push({ tick: sim.tick, amount: info.amount });
        if (sim.tick < f.readyAt || !sim.c.Unit.alive[eid]) return;
        const max = sim.c.Hp.max[eid]!;
        if (f.hits.reduce((s, h) => s + h.amount, 0) < 0.15 * max) return;
        f.hits = [];
        f.readyAt = sim.tick + sec(10);
        addShield(sim, eid, 0.08 * max, sec(3), 'oleth_faith_wall', eid);
      },
    },
  },
  effects: {
    // Q within 2 s after one of her dashes ended: 0.5 s stun.
    oleth_q_dash_stun(sim, ctx) {
      const t = ctx.hits[0];
      if (ctx.phase === 'cast' && t !== undefined && sim.tick - lastDashEnd(sim, ctx.caster) <= WINDOW) addBuff(sim, t, { kind: 'stun', id: 'oleth_q', src: ctx.caster, ticks: sec(0.5) });
    },
    // E stops at the first enemy its 100-wide path touches (that unit is the only hit).
    oleth_e_stop_on_enemy(_sim, ctx) {
      if (ctx.phase === 'dashStart' && ctx.dash) ctx.dash.stopAtEnemy = (ctx.ability.width ?? 100) / 2;
    },
    // R: line geometry comes from data (line: perpendicular); the wall blocks movement for 4 s.
    oleth_r_wall(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const r = ctx.ability.radius ?? 400;
      const [px, py] = [-ctx.dy * r, ctx.dx * r];
      blockTerrain(sim, wallCells(sim, ctx.x - px, ctx.y - py, ctx.x + px, ctx.y + py, ctx.ability.width ?? 100), WALL_TICKS);
    },
  },
};
