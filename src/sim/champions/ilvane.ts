// Ilvane hooks. Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
import { sec } from '../types';
import { dealDamage } from '../damage';
import { query } from 'bitecs';
import { addBuff, buffs, hasBuff, removeBuffs } from '../buffs';
import type { ChampionHooks, ChampionVisuals } from './hooks';
import { byLevel } from './util';

const MARK = 'ilvane_thread';

export const hooks: ChampionHooks = {
  // Snapshot (read-only). The thread marks are 'mark' buffs (generic diamond on the target). Badge: number of living
  // units carrying her mark (glows while an auto can consume one). E: 0.4 s projectile immunity has no stat value, so
  // it gets an explicit aura.
  visuals(sim, eid) {
    const { Unit } = sim.c;
    let marked = 0;
    for (const t of query(sim.world, [Unit])) {
      if (!Unit.alive[t]) continue;
      if (buffs(sim, t).some((b) => b.kind === 'mark' && b.id === MARK && b.src === eid && b.until > sim.tick)) marked++;
    }
    const v: ChampionVisuals = { passive: { stacks: marked, ready: marked > 0 } };
    if (Unit.alive[eid] && hasBuff(sim, eid, 'stat', 'ilvane_e')) v.aura = 2;
    return v;
  },
  passive: {
    // Thread mark: an auto on a marked target consumes the mark for bonus magic damage and 20 % MS for 1 s.
    ilvane_thread_mark: {
      onAutoHit(sim, eid, target) {
        if (!hasBuff(sim, target, 'mark', MARK)) return;
        removeBuffs(sim, target, (b) => b.kind === 'mark' && b.id === MARK);
        dealDamage(sim, eid, target, byLevel(sim, eid, 10, 40) + 0.2 * sim.c.Stats.ap[eid]!, 'magic');
        addBuff(sim, eid, { kind: 'stat', stat: 'ms', id: 'ilvane_thread_ms', src: eid, pct: 20, ticks: sec(1) });
      },
    },
  },
  effects: {
    // Backward hop; enemy projectiles pass through her for 0.4 s from the hop start.
    ilvane_e_backstep(sim, ctx) {
      if (ctx.phase !== 'dashStart' || !ctx.dash) return;
      ctx.dash.dx = -ctx.dash.dx;
      ctx.dash.dy = -ctx.dash.dy;
      addBuff(sim, ctx.caster, { kind: 'stat', stat: 'projImmune', id: 'ilvane_e', src: ctx.caster, ticks: sec(0.4) });
    },
    // Listed before R's own mark: roots targets that already carry a thread mark (consumed).
    ilvane_r_root_marked(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      for (const t of ctx.hits) {
        if (!hasBuff(sim, t, 'mark', MARK)) continue;
        removeBuffs(sim, t, (b) => b.kind === 'mark' && b.id === MARK);
        addBuff(sim, t, { kind: 'root', id: 'ilvane_r', src: ctx.caster, ticks: sec(1.2) });
      }
    },
  },
};
