// Lysa Nadel hooks: thread run stacks (passive), range during Q, first-champion arrow (W), tripwire (E),
// global shot falloff (R).

import type { Sim } from '../sim';
import { sec } from '../types';
import { addBuff, removeBuffs } from '../buffs';
import type { ChampionHooks, ChampionVisuals } from './hooks';
import { peekState } from './util';
import { dir } from '../vec';
import { applyEffects, enemiesOnSegment, rv } from '../systems/abilities';
import { abilityOf, isChamp, stateMap, tickCtx } from './dagny';

interface Thread {
  target: number;
  serial: number;
  stacks: number;
  last: number;
}
const threads = (sim: Sim): Map<number, Thread> => stateMap<Thread>(sim, 'lysaThread');
const MAX_STACKS = 8;
/** ponytail: stacks (and their buffs) lapse after 4 s without hitting the same target. */
const STACK_TICKS = sec(4);

export const lysaStacks = (sim: Sim, eid: number): number => threads(sim).get(eid)?.stacks ?? 0;

/** E wire per Lysa: segment, end tick; `live` until the first enemy champion crosses it. */
interface Wire {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  rank: number;
  until: number;
  live: boolean;
}
const wires = (sim: Sim): Map<number, Wire> => stateMap<Wire>(sim, 'lysaWire');

/** Per-tick: the first enemy champion touching a live wire is rooted (generic E effects) and the wire vanishes. */
function wireTick(sim: Sim, eid: number): void {
  const w = wires(sim).get(eid);
  if (!w || !w.live) return;
  if (sim.tick >= w.until) return void (w.live = false);
  const ab = abilityOf(sim, eid, 2);
  const t = enemiesOnSegment(sim, eid, w.ax, w.ay, w.bx, w.by, (ab.width ?? 40) / 2).find((e) => isChamp(sim, e));
  if (t === undefined) return;
  w.live = false;
  applyEffects(sim, tickCtx(sim, eid, 2, w.rank, [t], sim.c.Pos.x[t]!, sim.c.Pos.y[t]!), 'hit');
}

/** R: champions pierced by the current shot. */
const pierced = (sim: Sim): Map<number, number> => stateMap<number>(sim, 'lysaPierced');


/**
 * Snapshot (read-only): P = thread stacks on the HUD badge (n/8, timer until they lapse) and as pips on the current
 * target. E's wire is already drawn by the generic zone event (telegraph HOOK_LINE 'perpendicular'); not duplicated.
 * The wire is visible to enemies like any zone (user decision 19.10.; the ability flag 'stealth' would hide it).
 */
function lysaVisuals(sim: Sim, eid: number): ChampionVisuals {
  const t = peekState<Thread>(sim, 'lysaThread')?.get(eid);
  const left = t ? STACK_TICKS - (sim.tick - t.last) : 0;
  if (!t || left <= 0 || t.stacks <= 0) return { passive: { stacks: 0, max: MAX_STACKS } };
  const alive = !!sim.c.Unit.alive[t.target] && sim.c.Unit.serial[t.target] === t.serial;
  return {
    passive: { stacks: t.stacks, max: MAX_STACKS, ready: t.stacks >= MAX_STACKS, cdLeft: left, cdTotal: STACK_TICKS },
    ...(alive ? { marks: [{ target: t.target, id: 'lysa_p_thread', n: t.stacks, max: MAX_STACKS, left }] } : {}),
  };
}

export const hooks: ChampionHooks = {
  visuals: lysaVisuals,
  onTick: wireTick,
  ownsHits: ['lysa_e', 'lysa_r'],
  passive: {
    lysa_thread_run: {
      onCast(sim, eid, slot) {
        if (slot === 3) pierced(sim).set(eid, 0);
      },
      onAutoHit(sim, eid, target) {
        const serial = sim.c.Unit.serial[target]!;
        let t = threads(sim).get(eid);
        if (!t || t.target !== target || t.serial !== serial || sim.tick - t.last > STACK_TICKS) {
          threads(sim).set(eid, (t = { target, serial, stacks: 0, last: sim.tick }));
          removeBuffs(sim, eid, (b) => b.id === 'lysa_thread');
        }
        t.stacks = Math.min(MAX_STACKS, t.stacks + 1);
        t.last = sim.tick;
        addBuff(sim, eid, { kind: 'stat', stat: 'as', id: 'lysa_thread', src: eid, pct: 4 * t.stacks, ticks: STACK_TICKS });
        const range = Math.min(100, 25 * Math.floor(t.stacks / 2));
        if (range > 0) addBuff(sim, eid, { kind: 'stat', stat: 'range', id: 'lysa_thread', src: eid, flat: range, ticks: STACK_TICKS });
      },
    },
  },
  effects: {
    lysa_q_range(sim, ctx) {
      addBuff(sim, ctx.caster, { kind: 'stat', stat: 'range', id: 'lysa_q', src: ctx.caster, flat: 20, ticks: sec(3) });
    },
    // No-op on purpose: W has no blocked_by_minions/pierce flag, so the line projectile already ignores minions and
    // monsters and stops at the first enemy champion (projectiles.lineCandidate).
    lysa_w_first_champion() {},
    lysa_e_tripwire(sim, ctx) {
      const w = wires(sim).get(ctx.caster);
      if (w && sim.tick <= w.until) return; // later zone resolutions of the same cast (incl. the one at the end tick)
      const { Pos } = sim.c;
      let [dx, dy] = [ctx.dx, ctx.dy];
      if (dx === 0 && dy === 0) [dx, dy] = dir(Pos.x[ctx.caster]!, Pos.y[ctx.caster]!, ctx.x, ctx.y);
      const half = ctx.ability.radius ?? 250;
      // perpendicular to the cast direction
      wires(sim).set(ctx.caster, { ax: ctx.x + dy * half, ay: ctx.y - dx * half, bx: ctx.x - dy * half, by: ctx.y + dx * half, rank: ctx.rank, until: sim.tick + sec(rv(ctx.ability.duration, ctx.rank)), live: true });
    },
    // Owned hits: each champion after the first takes 10 % less per champion already pierced (floor 50 %).
    lysa_r_falloff(sim, ctx) {
      let mult = 1;
      const n = pierced(sim).get(ctx.caster) ?? 0;
      for (let i = 0; i < n; i++) mult *= 0.9;
      applyEffects(sim, { ...ctx, dmgMult: Math.max(0.5, mult) }, 'hit');
      if (ctx.hits.some((t) => isChamp(sim, t))) pierced(sim).set(ctx.caster, n + 1);
    },
  },
};
